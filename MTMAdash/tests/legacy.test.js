// Tests for the legacy Streamlit CSV importer (shared/legacy.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseCsv, rowsToObjects, parseLegacyTime, mapDirection,
  parseEquipmentLines, mapLegacyCsv, importLegacyCsvFiles,
} from '../shared/legacy.js';

const FIXED_TODAY = new Date(2026, 5, 15); // Jun 15 2026

test('parseCsv handles quotes, embedded commas and newlines', () => {
  const csv = [
    'TIME,Unit,Equipment,Direction,Notes',
    '"12/25 07:30","A CO, 1PLT","Generator\nRadio x2","Incoming","Bring keys ""and"" forms"',
    '"12/26 09:00",B CO,"Optic","Outgoing",',
  ].join('\r\n');
  const rows = parseCsv(csv);
  assert.deepEqual(rows[0], ['TIME', 'Unit', 'Equipment', 'Direction', 'Notes']);
  assert.deepEqual(rows[1], ['12/25 07:30', 'A CO, 1PLT', 'Generator\nRadio x2', 'Incoming', 'Bring keys "and" forms']);
  assert.deepEqual(rows[2], ['12/26 09:00', 'B CO', 'Optic', 'Outgoing', '']);
});

test('parseCsv skips blank lines and strips the BOM', () => {
  const rows = parseCsv('\uFEFFMessage\n\nHello\n\nWorld\n');
  assert.deepEqual(rows, [['Message'], ['Hello'], ['World']]);
});

test('rowsToObjects maps headers case-insensitively and trims cells', () => {
  const objs = rowsToObjects([['Weapon', 'count'], ['M4', ' 7 '], ['', '']]);
  assert.deepEqual(objs[0], { weapon: 'M4', count: '7' });
  assert.deepEqual(objs[1], { weapon: '', count: '' });
});

test('parseLegacyTime parses "MM/DD HH:MM" and picks sensible years', () => {
  assert.deepEqual(parseLegacyTime('12/25 07:30', FIXED_TODAY), { date: '2026-12-25', time: '07:30' });
  assert.deepEqual(parseLegacyTime('6/1 13:05', FIXED_TODAY), { date: '2026-06-01', time: '13:05' });
  assert.deepEqual(parseLegacyTime('10/07', FIXED_TODAY), { date: '2026-10-07', time: '09:00' });
  assert.deepEqual(parseLegacyTime('3/2/2025 16:45', FIXED_TODAY), { date: '2025-03-02', time: '16:45' });
  // a stale future date more than ~180 days out rolls back a year
  assert.deepEqual(parseLegacyTime('12/25', new Date(2026, 0, 5)), { date: '2025-12-25', time: '09:00' });
  // garbage stays empty
  assert.equal(parseLegacyTime('whenever', FIXED_TODAY).date, '');
  assert.equal(parseLegacyTime('', FIXED_TODAY).date, '');
});

test('mapDirection converts the old vocabulary', () => {
  assert.equal(mapDirection('Incoming'), 'Drop-off');
  assert.equal(mapDirection('incoming'), 'Drop-off');
  assert.equal(mapDirection('Outgoing'), 'Pickup');
  assert.equal(mapDirection('Pickup'), 'Pickup');
  assert.equal(mapDirection('Drop-off'), 'Drop-off');
  assert.equal(mapDirection('weird'), 'Drop-off');
  assert.equal(mapDirection(''), 'Drop-off');
});

test('parseEquipmentLines splits lines and only honours x/× quantity markers', () => {
  assert.deepEqual(parseEquipmentLines('Generator x3\nRadio'), [
    { eqType: 'Generator', qty: 3, description: '' },
    { eqType: 'Radio', qty: 1, description: '' },
  ]);
  assert.deepEqual(parseEquipmentLines('Optic ×2'), [{ eqType: 'Optic', qty: 2, description: '' }]);
  // serial numbers must not become quantities
  assert.deepEqual(parseEquipmentLines('MEP-803A #7'), [{ eqType: 'MEP-803A #7', qty: 1, description: '' }]);
  assert.deepEqual(parseEquipmentLines('Trailer 3'), [{ eqType: 'Trailer 3', qty: 1, description: '' }]);
  // semicolons act as line separators too
  assert.equal(parseEquipmentLines('A;B').length, 2);
  assert.equal(parseEquipmentLines('').length, 0);
});

const EQUIPMENT_CSV = [
  'TIME,Unit,Equipment,Direction,Notes',
  '12/25 07:30,A/2-1 IN,"Generator x2\nRadio",Incoming,Gate pass filed',
  '1/10 09:00,B CO,Optic,Outgoing,',
  ',No Time Unit,,Incoming,',
].join('\n');

test('mapLegacyCsv maps an equipment.csv into appointments', () => {
  const mapped = mapLegacyCsv(EQUIPMENT_CSV, FIXED_TODAY);
  assert.equal(mapped.kind, 'appointments');
  assert.equal(mapped.records.length, 3);
  const first = mapped.records[0];
  assert.equal(first.date, '2026-12-25'); // < 9 months out -> stays this year
  assert.equal(first.status, 'Scheduled'); // future date
  assert.equal(first.unitId, 'A/2-1 IN');
  assert.equal(first.direction, 'Drop-off');
  assert.deepEqual(first.items, [
    { eqType: 'Generator', qty: 2, description: '' },
    { eqType: 'Radio', qty: 1, description: '' },
  ]);
  assert.equal(first.notes, 'Gate pass filed');
  const second = mapped.records[1];
  assert.equal(second.status, 'Completed'); // Jan 10 is before Jun 15
  assert.equal(second.direction, 'Pickup');
  // unreadable time falls back to today with a warning
  assert.equal(mapped.records[2].date, '2026-06-15');
  assert.ok(mapped.warnings.some((w) => w.includes('Unreadable time')));
});

test('mapLegacyCsv maps weapons.csv and shop_notes.csv', () => {
  const weapons = mapLegacyCsv('Weapon,Count\nM4 Carbine,42\nM17,24\n,0\n', FIXED_TODAY);
  assert.equal(weapons.kind, 'weapons');
  assert.deepEqual(weapons.records, [
    { name: 'M4 Carbine', count: 42, notes: '' },
    { name: 'M17', count: 24, notes: '' },
  ]);

  const notes = mapLegacyCsv('Message\nRange closed Friday\n\nKeys signed out\n', FIXED_TODAY);
  assert.equal(notes.kind, 'notes');
  assert.deepEqual(notes.records, [{ message: 'Range closed Friday' }, { message: 'Keys signed out' }]);
});

test('mapLegacyCsv returns null for unrecognized files', () => {
  assert.equal(mapLegacyCsv('Foo,Bar\n1,2\n', FIXED_TODAY), null);
  assert.equal(mapLegacyCsv('', FIXED_TODAY), null);
});

test('importLegacyCsvFiles aggregates files, dedupes and warns', () => {
  const payload = importLegacyCsvFiles([
    { name: 'equipment.csv', text: EQUIPMENT_CSV },
    { name: 'weapons.csv', text: 'Weapon,Count\nM4,10\n' },
    { name: 'weapons again.csv', text: 'Weapon,Count\nM4,12\nm17,3\n' },
    { name: 'shop_notes.csv', text: 'Message\nRange closed\nRange closed\n' },
    { name: 'random.csv', text: 'Foo,Bar\n1,2\n' },
  ], FIXED_TODAY);
  assert.equal(payload.appointments.length, 3);
  assert.deepEqual(payload.weapons.map((w) => [w.name, w.count]), [['M4', 12], ['m17', 3]]);
  assert.deepEqual(payload.notes, [{ message: 'Range closed' }]);
  assert.equal(payload.detected.length, 4);
  assert.ok(payload.warnings.some((w) => w.includes('random.csv')));
});
