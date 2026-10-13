// Tests for the browser-local database (js/localdb.js) — the backend used when
// index.html is opened as a plain file. Runs in Node with a memory storage shim.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeLocalDb, memoryStorage, STORAGE_KEY } from '../js/localdb.js';

test('seeds an empty workspace on first run and persists every write', () => {
  const storage = memoryStorage();
  const db = makeLocalDb(storage);
  assert.deepEqual(db._db().appointments, [], 'starts empty');
  assert.ok(db._db().eqtypes.length > 0, 'equipment type suggestions provided');
  assert.ok(storage.getItem(STORAGE_KEY), 'written to storage');

  const created = db.create('appointments', {
    date: '2030-04-01', time: 'TBD', unitId: 'FILE MODE CO',
    direction: 'Drop-off', items: [{ eqType: 'Radio', qty: 2 }],
  }, 'tester');
  assert.equal(created.unitName, 'FILE MODE CO');
  assert.equal(created.time, 'TBD');
  assert.ok(db._db().units.some((u) => u.name === 'FILE MODE CO'), 'unit auto-created');

  // A fresh instance over the same storage sees the edit (like a page reload).
  const again = makeLocalDb(storage);
  assert.ok(again._db().appointments.some((r) => r.unitName === 'FILE MODE CO'));
});

test('wipe clears records but keeps settings and equipment types', () => {
  const db = makeLocalDb(memoryStorage());
  db.updateSettings({ shopName: 'Keep Me' }, 'tester');
  db.create('weapons', { name: 'Temp', count: 2 }, 'tester');
  db.wipe('tester');
  assert.deepEqual(db._db().weapons, []);
  assert.ok(db._db().eqtypes.length > 0);
  assert.equal(db._db().settings.shopName, 'Keep Me');
});

test('update / remove / settings / backup restore work like the server db', () => {
  const db = makeLocalDb(memoryStorage());
  const w = db.create('weapons', { name: 'M4', count: 5 }, 'tester');
  db.update('weapons', w.id, { count: 6 }, 'tester');
  assert.equal(db._db().weapons.find((r) => r.id === w.id).count, 6);
  db.remove('weapons', w.id, 'tester');
  assert.ok(!db._db().weapons.some((r) => r.id === w.id));

  db.updateSettings({ shopName: 'Local Shop' }, 'tester');
  assert.equal(db.snapshot().settings.shopName, 'Local Shop');

  db.replaceAll({
    appointments: [{ id: 'apt-z', date: '2031-01-01', time: '09:00', unitName: 'Z CO', direction: 'Pickup', status: 'Scheduled', items: [] }],
  }, 'tester');
  assert.equal(db._db().appointments.length, 1);
  assert.deepEqual(db._db().units, []);
});

test('listeners receive change events', () => {
  const db = makeLocalDb(memoryStorage());
  const events = [];
  const off = db.onChange((e) => events.push(e));
  const n = db.create('notes', { message: 'hello' }, 'tester');
  db.remove('notes', n.id, 'tester');
  off();
  db.create('notes', { message: 'not tracked' }, 'tester');
  assert.deepEqual(events.map((e) => e.type), ['create', 'delete']);
});
