// Tests for the JSON-file database layer (lib/db.js) against the shop schema.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const base = existsSync('/tmp/opencode') ? '/tmp/opencode' : tmpdir();
const dir = mkdtempSync(join(base, 'shopline-db-'));
process.env.DATA_FILE = join(dir, 'db.json');

const { load, create, update, remove, get, updateSettings, replaceAll, wipe, snapshot, persistNow } = await import('../lib/db.js');

before(() => { load(); });
after(async () => {
  // Let the debounced persist timer flush before the temp dir disappears.
  await new Promise((r) => setTimeout(r, 150));
  rmSync(dir, { recursive: true, force: true });
});

test('load seeds an empty shop workspace by default', () => {
  const db = get();
  assert.deepEqual(db.appointments, []);
  assert.deepEqual(db.units, []);
  assert.deepEqual(db.weapons, []);
  assert.deepEqual(db.notes, []);
  assert.ok(db.eqtypes.length >= 8, 'starter equipment types are provided as suggestions');
  assert.equal(db.settings.shopName, 'Shop Ops');
});

test('create appointment with a unit NAME auto-creates the unit', () => {
  const record = create('appointments', {
    date: '2030-01-05', time: '10:00',
    unitId: 'D CO 3-1 CAV', direction: 'Pickup', status: 'Scheduled',
    items: [{ eqType: 'Radio', qty: 2, description: 'ASIP' }, { eqType: '', qty: 3, description: '' }],
    notes: 'created by test',
  }, 'tester');
  assert.ok(record.id.startsWith('apt-'));
  assert.equal(record.unitName, 'D CO 3-1 CAV');
  assert.ok(get().units.some((u) => u.name === 'D CO 3-1 CAV'), 'unit record created');
  // empty items (no type, no description) are dropped
  assert.deepEqual(record.items, [{ eqType: 'Radio', qty: 2, description: 'ASIP' }]);
  // the unit shows up as an option (id-based)
  assert.ok(get().units.some((u) => u.id === record.unitId));
});

test('re-using an existing unit name does not duplicate the unit', () => {
  const before = get().units.length;
  const a = create('appointments', { date: '2030-01-06', time: '09:00', unitId: 'd co 3-1 cav', direction: 'Drop-off' }, 'tester');
  const b = create('appointments', { date: '2030-01-06', time: '11:00', unitId: 'D CO 3-1 CAV', direction: 'Drop-off' }, 'tester');
  assert.equal(get().units.length, before);
  assert.equal(a.unitId, b.unitId);
});

test('update patches fields and normalizes items', () => {
  const appt = get().appointments.find((r) => r.notes === 'created by test');
  const updated = update('appointments', appt.id, { status: 'Arrived', items: 'garbage' }, 'tester');
  assert.equal(updated.status, 'Arrived');
  assert.deepEqual(updated.items, []);
  update('appointments', appt.id, { status: 'Scheduled', items: [{ eqType: 'Tent', qty: -5 }] }, 'tester');
  assert.equal(get().appointments.find((r) => r.id === appt.id).items[0].qty, 1);
});

test('renaming a unit cascades to appointment labels; deleting keeps the snapshot', () => {
  const unit = get().units.find((u) => u.name === 'D CO 3-1 CAV');
  update('units', unit.id, { name: 'D/3-1 CAV' }, 'tester');
  const appt = get().appointments.find((r) => r.notes === 'created by test');
  assert.equal(appt.unitName, 'D/3-1 CAV');
  remove('units', unit.id, 'tester');
  const afterDelete = get().appointments.find((r) => r.id === appt.id);
  assert.equal(afterDelete.unitName, 'D/3-1 CAV', 'snapshot survives unit deletion');
});

test('weapons support counts and quick edits', () => {
  const w = create('weapons', { name: 'M9', count: 12 }, 'tester');
  assert.ok(w.id.startsWith('wpn-'));
  update('weapons', w.id, { count: 13 }, 'tester');
  assert.equal(get().weapons.find((r) => r.id === w.id).count, 13);
  update('weapons', w.id, { count: -3 }, 'tester'); // number coerce -> null? no: -3 is finite
  assert.equal(get().weapons.find((r) => r.id === w.id).count, -3);
  remove('weapons', w.id, 'tester');
});

test('notes and eqtypes CRUD', () => {
  const n = create('notes', { message: 'Fuel point closed Monday' }, 'tester');
  assert.ok(n.createdAt);
  update('notes', n.id, { message: 'Fuel point closed Tuesday' }, 'tester');
  assert.equal(get().notes.find((r) => r.id === n.id).message, 'Fuel point closed Tuesday');
  remove('notes', n.id, 'tester');

  const t = create('eqtypes', { name: 'Forklift' }, 'tester');
  assert.ok(get().eqtypes.some((r) => r.id === t.id));
  remove('eqtypes', t.id, 'tester');
});

test('settings can be updated', () => {
  const s = updateSettings({ shopName: 'Test Shop', rotateSeconds: 7 }, 'tester');
  assert.equal(s.shopName, 'Test Shop');
  assert.equal(s.rotateSeconds, 7);
  assert.ok(snapshot().settings.shopName === 'Test Shop');
});

test('replaceAll restores a minimal backup safely', () => {
  replaceAll({
    appointments: [{ id: 'apt-x', date: '2031-02-03', time: '08:00', unitName: 'X CO', direction: 'Drop-off', status: 'Scheduled', items: [] }],
    weapons: [{ id: 'wpn-x', name: 'M16A4', count: 5 }],
  }, 'tester');
  const db = get();
  assert.equal(db.appointments.length, 1);
  assert.equal(db.weapons.length, 1);
  assert.deepEqual(db.units, []); // missing collections become empty arrays
  assert.ok(Array.isArray(db.notes));
  assert.ok(Array.isArray(db.activity));
});

test('data persists to disk (atomic file)', () => {
  persistNow();
  const raw = JSON.parse(readFileSync(process.env.DATA_FILE, 'utf8'));
  assert.equal(raw.appointments.length, get().appointments.length);
  assert.equal(raw.weapons[0].name, 'M16A4');
});

test('wipe resets to an empty workspace but keeps settings and types', () => {
  updateSettings({ shopName: 'Keep Me' }, 'tester');
  create('appointments', { date: '2031-03-03', time: 'TBD', unitId: 'WIPE CO', direction: 'Drop-off' }, 'tester');
  create('weapons', { name: 'Temp Gun', count: 3 }, 'tester');
  wipe('tester');
  const db = get();
  assert.deepEqual(db.appointments, []);
  assert.deepEqual(db.weapons, []);
  assert.deepEqual(db.units, []);
  assert.ok(db.eqtypes.length >= 8, 'equipment types kept');
  assert.equal(db.settings.shopName, 'Keep Me', 'settings kept');
});
