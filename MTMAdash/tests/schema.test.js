// Tests for the shared data model (shared/schema.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  collections, collectionByName, coerceValue, normalizeItems, itemSummary,
  computeFields, isApptOverdue, titleOf, defaultSettings,
} from '../shared/schema.js';
import { daysUntil, todayIso } from '../js/util.js';

test('schema exposes the shop collections', () => {
  const names = collections.map((c) => c.name);
  assert.deepEqual(names, ['appointments', 'units', 'weapons', 'notes', 'eqtypes']);
  for (const c of collections) {
    assert.ok(c.fields.length >= 1, `${c.name} has fields`);
    assert.ok(c.singular, `${c.name} has a singular label`);
  }
  assert.ok(collectionByName.appointments.fields.some((f) => f.key === 'items'));
  assert.ok(collectionByName.appointments.fields.some((f) => f.key === 'unitId' && f.required));
  assert.ok(collectionByName.weapons.fields.some((f) => f.key === 'count'));
});

test('coerceValue normalizes equipment item lists', () => {
  const field = { type: 'items' };
  assert.deepEqual(coerceValue(field, undefined), []);
  assert.deepEqual(coerceValue(field, 'nope'), []);
  assert.deepEqual(coerceValue(field, [
    { eqType: ' Generator ', qty: '3', description: 'MEP-803A' },
    { eqType: '', qty: 9, description: 'only a description' },
    { eqType: '   ', qty: 0, description: '' }, // dropped: all empty
    { eqType: 'Radio', qty: 0, description: '' }, // qty 0 -> 1
  ]), [
    { eqType: 'Generator', qty: 3, description: 'MEP-803A' },
    { eqType: '', qty: 9, description: 'only a description' },
    { eqType: 'Radio', qty: 1, description: '' },
  ]);
  // plain strings become items
  assert.deepEqual(coerceValue(field, ['Tent']), [{ eqType: 'Tent', qty: 1, description: '' }]);
  // capped at 50 lines
  assert.equal(coerceValue(field, Array.from({ length: 80 }, (_, i) => ({ eqType: `T${i}` }))).length, 50);
});

test('normalizeItems clamps quantities', () => {
  assert.equal(normalizeItems([{ eqType: 'X', qty: -4 }])[0].qty, 1);
  assert.equal(normalizeItems([{ eqType: 'X', qty: 100000 }])[0].qty, 9999);
  assert.equal(normalizeItems([{ eqType: 'X', qty: 2.6 }])[0].qty, 3);
});

test('itemSummary renders quantities and descriptions', () => {
  assert.equal(itemSummary([]), '');
  assert.equal(
    itemSummary([{ eqType: 'Generator', qty: 2, description: 'MEP-803A' }, { eqType: 'Radio', qty: 1, description: '' }]),
    '2× Generator — MEP-803A · 1× Radio',
  );
});

test('computeFields sums quantities and flags overdue appointments', () => {
  const past = { status: 'Scheduled', date: '2000-01-01', time: '07:30', items: [{ eqType: 'A', qty: 2 }, { eqType: 'B', qty: 3 }] };
  const future = { status: 'Scheduled', date: '2999-01-01', time: '07:30', items: [] };
  const done = { status: 'Completed', date: '2000-01-01', time: '07:30', items: [{ eqType: 'A', qty: 4 }] };
  const pf = computeFields('appointments', past);
  assert.equal(pf.totalQty, 5);
  assert.equal(pf.itemCount, 2);
  assert.equal(pf.overdue, true);
  assert.equal(computeFields('appointments', future).overdue, false);
  assert.equal(computeFields('appointments', done).overdue, false);
  // completed past appointments are not overdue even when computed live
  assert.equal(isApptOverdue(done), false);
});

test('isApptOverdue honours a provided clock', () => {
  const appt = { status: 'Scheduled', date: '2026-05-01', time: '12:00' };
  const before = new Date(2026, 4, 1, 11, 0);
  const after = new Date(2026, 4, 1, 13, 0);
  assert.equal(isApptOverdue(appt, before), false);
  assert.equal(isApptOverdue(appt, after), true);
});

test('titleOf produces readable labels', () => {
  const appt = { date: '2026-01-02', time: '09:00', unitName: 'A/2-1 IN', direction: 'Drop-off', id: 'apt-1' };
  assert.equal(titleOf('appointments', appt), '2026-01-02 09:00 · A/2-1 IN · Drop-off');
  assert.equal(titleOf('weapons', { name: 'M4 Carbine' }), 'M4 Carbine');
  assert.equal(titleOf('notes', { message: 'Check the boiler' }), 'Check the boiler');
});

test('daysUntil and todayIso are local-date safe', () => {
  const today = todayIso();
  assert.equal(daysUntil(today), 0);
  assert.ok(/^[A-Za-z]{3}\s+\d{1,2}\s+[A-Za-z]{3}$|^.*$/.test('sanity'));
  assert.match(today, /^\d{4}-\d{2}-\d{2}$/);
});

test('appointment fields support typed units and a TBD time', () => {
  const appt = collectionByName.appointments;
  const unit = appt.fields.find((f) => f.key === 'unitId');
  const time = appt.fields.find((f) => f.key === 'time');
  assert.equal(unit.input, 'text', 'unit is a typed field');
  assert.equal(unit.resolveByName, true, 'typed unit names resolve/create a unit');
  assert.equal(time.tbd, true, 'time offers a TBD option');
});

test('a TBD appointment is not overdue on its own day but is on a past day', () => {
  const today = todayIso();
  const noTime = { status: 'Scheduled', date: today, time: 'TBD' };
  assert.equal(isApptOverdue(noTime, new Date(`${today}T23:00:00`)), false, 'TBD today is not overdue');
  const yesterday = { status: 'Scheduled', date: '2000-01-01', time: 'TBD' };
  assert.equal(isApptOverdue(yesterday), true, 'TBD on a past day is overdue');
});

test('default settings match the shop domain', () => {
  assert.equal(defaultSettings.kioskViews, 'board,schedule,weapons,notes');
  assert.ok(defaultSettings.shopName);
});
