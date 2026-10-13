// Unit tests for the browser-local demo database (public/js/localdb.js).
// It must mirror lib/db.js semantics so the app cannot tell the modes apart.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeLocalDb, memoryStorage, STORAGE_KEY } from '../public/js/localdb.js';
import { collections } from '../shared/schema.js';

function fresh() {
  const storage = memoryStorage();
  const db = makeLocalDb(storage, STORAGE_KEY);
  return { storage, db };
}

test('seeds the sample shop on first run and persists it', () => {
  const { storage, db } = fresh();
  for (const c of collections) assert.ok(Array.isArray(db.items(c.name)), `${c.name} present`);
  assert.ok(db.items('workorders').length > 0, 'work orders seeded');
  assert.ok(db.items('people').length > 0, 'people seeded');
  assert.ok(JSON.parse(storage.getItem(STORAGE_KEY)).workorders.length > 0, 'written to storage');
  assert.equal(db.state().mode, 'browser');
});

test('create / update / remove behave like the server database', async () => {
  const { db } = fresh();
  const created = db.create('workorders', { title: 'Fix gearbox' }, 'tester');
  assert.ok(created.id.startsWith('wo-'), 'work order id prefix');
  assert.ok(created.createdAt, 'timestamps set');
  const before = created.title;
  const updated = db.update('workorders', created.id, { status: 'In Progress', priority: 'High' }, 'tester');
  assert.equal(updated.status, 'In Progress');
  assert.equal(updated.title, before, 'untouched fields survive the patch');
  assert.ok(updated.updatedAt >= updated.createdAt, 'updatedAt bumped');
  await new Promise((r) => setTimeout(r, 5));
  const prev = updated.updatedAt;
  const again = db.update('workorders', created.id, { priority: 'Urgent' }, 'tester');
  assert.ok(again.updatedAt > prev, 'later edits strictly bump updatedAt');

  const removed = db.remove('workorders', created.id, 'tester');
  assert.equal(removed.id, created.id);
  assert.equal(db.update('workorders', created.id, { status: 'Done' }, 'tester'), null, 'updating a deleted record returns null');
  const activity = db.state().activity.map((a) => a.text).join(' ');
  assert.match(activity, /Added work order/i);
  assert.match(activity, /Updated work order/i);
  assert.match(activity, /Deleted work order/i);
});

test('schema coercion and defaults apply on create', () => {
  const { db } = fresh();
  const part = db.create('parts', { name: 'M6 bolt', qty: '5', minQty: 10 }, 'tester');
  assert.equal(part.qty, 5, 'numeric strings coerced');
  assert.equal(part.unit, 'ea', 'select default applied');
  const asset = db.create('assets', { name: 'Press' }, 'tester');
  assert.equal(asset.status, 'Running', 'asset default status');
});

test('updateSettings merges and activity logs', () => {
  const { db } = fresh();
  const s = db.updateSettings({ shopName: 'Custom Shop' }, 'tester');
  assert.equal(s.shopName, 'Custom Shop');
  assert.ok(s.rotateSeconds, 'other settings kept');
});

test('replaceAll restores a backup; wipe returns the pristine demo', () => {
  const { db } = fresh();
  db.replaceAll({ workorders: [], settings: { shopName: 'Restored' } }, 'tester');
  assert.equal(db.items('workorders').length, 0, 'replaced collections emptied');
  assert.equal(db.items('people').length, 0, 'missing collections default to empty');
  assert.equal(db.state().settings.shopName, 'Restored');

  const wiped = db.wipe('tester');
  assert.ok(wiped.workorders.length > 0, 'sample shop back after reset');
  assert.ok(wiped.activity.some((a) => /Reset demo data/.test(a.text)), 'reset is logged');
});

test('a stale, untouched demo quietly re-seeds; an edited one is kept', () => {
  const stale = memoryStorage();
  stale.setItem(STORAGE_KEY, JSON.stringify({
    meta: { version: 1, seededOn: '2020-01-01' },
    settings: {},
    people: [{ id: 'per-x', name: 'Old Data' }],
    workorders: [], assets: [], schedule: [], parts: [], vendors: [], resources: [], activity: [],
  }));
  const db1 = makeLocalDb(stale, STORAGE_KEY);
  assert.ok(db1.items('people').some((p) => p.name !== 'Old Data'), 'stale untouched demo refreshed');

  const edited = memoryStorage();
  edited.setItem(STORAGE_KEY, JSON.stringify({
    meta: { version: 1, seededOn: '2020-01-01', userModified: true },
    settings: {},
    people: [{ id: 'per-x', name: 'My Real Edit' }],
    workorders: [], assets: [], schedule: [], parts: [], vendors: [], resources: [], activity: [],
  }));
  const db2 = makeLocalDb(edited, STORAGE_KEY);
  assert.ok(db2.items('people').some((p) => p.name === 'My Real Edit'), 'edited demo data is never replaced');
});
