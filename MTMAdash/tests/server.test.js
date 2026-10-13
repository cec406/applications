// Integration tests: boot the real server and exercise the HTTP API.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const base = existsSync('/tmp/opencode') ? '/tmp/opencode' : tmpdir();
const dir = mkdtempSync(join(base, 'shopline-srv-'));
const DATA_FILE = join(dir, 'db.json');
const PORT = 40000 + (process.pid % 20000);
const URLBASE = `http://127.0.0.1:${PORT}`;

let child = null;
let logs = '';

async function waitReady() {
  for (let i = 0; i < 100; i++) {
    try {
      const res = await fetch(`${URLBASE}/api/state`);
      if (res.ok) return;
    } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`server did not start; logs:\n${logs}`);
}

before(async () => {
  // The server serves the built single-file apps; make sure they exist.
  execFileSync(process.execPath, [join(ROOT, 'build.js')], { cwd: ROOT, stdio: 'ignore' });
  child = spawn(process.execPath, [join(ROOT, 'server.js')], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(PORT), HOST: '127.0.0.1', DATA_FILE },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', (d) => { logs += d.toString(); });
  child.stderr.on('data', (d) => { logs += d.toString(); });
  await waitReady();
});

after(() => {
  child?.kill();
  try { rmSync(dir, { recursive: true, force: true }); } catch { /* windows locks */ }
});

const json = async (path, opts = {}) => {
  const res = await fetch(`${URLBASE}${path}`, {
    headers: { 'X-Actor': 'test-runner', ...(opts.body ? { 'Content-Type': 'application/json' } : {}) },
    ...opts,
  });
  return { status: res.status, data: await res.json().catch(() => null) };
};

test('serves the built single-file app shell', async () => {
  const home = await fetch(`${URLBASE}/`);
  assert.equal(home.status, 200);
  const html = await home.text();
  assert.match(html, /<style>/, 'CSS inlined');
  assert.match(html, /type="module"/, 'bundle inlined');
  assert.match(html, /id="content"/);
  assert.match(html, /Shop Ops · Dashboard/);
  assert.doesNotMatch(html, /\/js\/app\.js/, 'no external module fetches');
  // Modular sources are still served for development.
  for (const path of ['/css/styles.css', '/js/views.js', '/js/components.js', '/shared/schema.js', '/shared/legacy.js', '/favicon.svg']) {
    const res = await fetch(`${URLBASE}${path}`);
    assert.equal(res.status, 200, `${path} should be served`);
  }
});

test('serves the built kiosk display page', async () => {
  const res = await fetch(`${URLBASE}/display`);
  assert.equal(res.status, 200);
  const html = await res.text();
  assert.match(html, /id="kiosk"/);
  assert.match(html, /Shop Ops · Wall Board/);
});

test('unknown paths fall back to the SPA shell', async () => {
  const res = await fetch(`${URLBASE}/definitely-not-a-page`);
  assert.equal(res.status, 200);
  assert.match(await res.text(), /js\/app\.js/);
});

test('server-only files and traversal cannot leak over HTTP', async () => {
  for (const path of ['/%2e%2e/server.js', '/server.js', '/data/db.json', '/data', '/lib/db.js', '/tests/db.test.js', '/package.json']) {
    const res = await fetch(`${URLBASE}${path}`);
    const text = await res.text();
    assert.ok(!text.includes('http.createServer'), `server source must not leak via ${path}`);
    assert.ok(!text.includes('"appointments"'), `database must not leak via ${path}`);
    if (res.status !== 200) continue; // SPA-shell fallbacks are fine, contents were checked
    assert.ok(!text.includes('http.createServer') && !text.includes('"appointments"'));
  }
});

test('GET /api/state returns a snapshot', async () => {
  const { status, data } = await json('/api/state');
  assert.equal(status, 200);
  for (const name of ['appointments', 'units', 'weapons', 'notes', 'eqtypes']) {
    assert.ok(Array.isArray(data.collections[name]), `${name} is an array`);
  }
  assert.ok(data.settings.shopName);
  assert.equal(typeof data.clients, 'number');
});

test('appointment lifecycle: create (by unit name) -> patch -> delete', async () => {
  const unitsBefore = (await json('/api/units')).data.length;

  const created = await json('/api/appointments', {
    method: 'POST',
    body: JSON.stringify({
      date: '2031-06-01', time: '08:30', unitId: 'K/9-1 CAV',
      direction: 'Drop-off', status: 'Scheduled', poc: 'SGT Test',
      items: [{ eqType: 'Generator', qty: 2, description: 'MEP-803A' }, 'Radio'],
      notes: 'api test',
    }),
  });
  assert.equal(created.status, 201);
  assert.equal(created.data.unitName, 'K/9-1 CAV');
  assert.deepEqual(created.data.items, [
    { eqType: 'Generator', qty: 2, description: 'MEP-803A' },
    { eqType: 'Radio', qty: 1, description: '' },
  ]);
  assert.equal((await json('/api/units')).data.length, unitsBefore + 1, 'unit auto-created');

  const id = created.data.id;
  const patched = await json(`/api/appointments/${id}`, {
    method: 'PATCH', body: JSON.stringify({ status: 'Arrived' }),
  });
  assert.equal(patched.status, 200);
  assert.equal(patched.data.status, 'Arrived');

  const got = await fetch(`${URLBASE}/api/appointments/${id}`);
  assert.equal(got.status, 200);
  assert.equal((await got.json()).status, 'Arrived');

  const removed = await json(`/api/appointments/${id}`, { method: 'DELETE' });
  assert.equal(removed.status, 200);
  assert.equal((await fetch(`${URLBASE}/api/appointments/${id}`)).status, 404);
});

test('weapons counts adjust through the API', async () => {
  const w = await json('/api/weapons', { method: 'POST', body: JSON.stringify({ name: 'M240B', count: 9 }) });
  assert.equal(w.status, 201);
  const bumped = await json(`/api/weapons/${w.data.id}`, { method: 'PATCH', body: JSON.stringify({ count: 10 }) });
  assert.equal(bumped.data.count, 10);
  await json(`/api/weapons/${w.data.id}`, { method: 'DELETE' });
});

test('unknown collection and bad payloads are rejected', async () => {
  assert.equal((await json('/api/aliens')).status, 404);
  const bad = await fetch(`${URLBASE}/api/appointments`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: 'not-json',
  });
  assert.equal(bad.status, 400);
  const missing = await json('/api/appointments/apt-nope', { method: 'PATCH', body: JSON.stringify({ status: 'Arrived' }) });
  assert.equal(missing.status, 404);
});

test('notes feed works', async () => {
  const n = await json('/api/notes', { method: 'POST', body: JSON.stringify({ message: 'Range closed Friday' }) });
  assert.equal(n.status, 201);
  assert.ok(n.data.createdAt);
  const list = await json('/api/notes');
  assert.ok(list.data.some((r) => r.message === 'Range closed Friday'));
});

test('SSE stream responds with an event stream', async () => {
  const controller = new AbortController();
  const res = await fetch(`${URLBASE}/api/events`, { signal: controller.signal });
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /text\/event-stream/);
  const reader = res.body.getReader();
  const { value } = await reader.read();
  assert.match(new TextDecoder().decode(value), /retry:|data:/);
  controller.abort();
});

test('settings PATCH persists', async () => {
  const { data } = await json('/api/settings', { method: 'PATCH', body: JSON.stringify({ shopName: 'API Shop' }) });
  assert.equal(data.shopName, 'API Shop');
  assert.equal((await json('/api/state')).data.settings.shopName, 'API Shop');
});

test('JSON backup export and import round-trip', async () => {
  // Make sure there is something to export.
  await json('/api/appointments', {
    method: 'POST',
    body: JSON.stringify({ date: '2031-07-01', time: '09:00', unitId: 'Export CO', direction: 'Drop-off' }),
  });

  const exportRes = await fetch(`${URLBASE}/api/export`);
  assert.equal(exportRes.status, 200);
  assert.match(exportRes.headers.get('content-disposition'), /attachment/);
  const backup = await exportRes.json();
  assert.ok(backup.appointments.length > 0);

  const before = (await json('/api/weapons')).data.length;
  backup.weapons.push({ id: 'wpn-rt', name: 'Roundtrip Weapon', count: 3 });
  const imported = await json('/api/import', { method: 'POST', body: JSON.stringify(backup) });
  assert.equal(imported.status, 200);
  const weapons = (await json('/api/weapons')).data;
  assert.equal(weapons.length, before + 1);
  assert.ok(weapons.some((w) => w.name === 'Roundtrip Weapon'));
});

test('legacy CSV flow: parse with shared/legacy.js and push through the API', async () => {
  const { mapLegacyCsv } = await import('../shared/legacy.js');
  const csv = 'TIME,Unit,Equipment,Direction,Notes\n7/1 08:00,Imported Unit,Generator x2,Incoming,from csv';
  const mapped = mapLegacyCsv(csv);
  assert.equal(mapped.kind, 'appointments');
  const created = await json('/api/appointments', { method: 'POST', body: JSON.stringify(mapped.records[0]) });
  assert.equal(created.status, 201);
  assert.equal(created.data.unitName, 'Imported Unit');
  assert.equal(created.data.items.length, 1);
  assert.equal(created.data.items[0].qty, 2);
});

test('POST /api/clear empties the shop but keeps settings and equipment types', async () => {
  await json('/api/settings', { method: 'PATCH', body: JSON.stringify({ shopName: 'Cleared Shop' }) });
  const cleared = await json('/api/clear', { method: 'POST' });
  assert.equal(cleared.status, 200);
  const state = (await json('/api/state')).data;
  assert.deepEqual(state.collections.appointments, []);
  assert.deepEqual(state.collections.weapons, []);
  assert.deepEqual(state.collections.units, []);
  assert.ok(state.collections.eqtypes.length > 0, 'equipment types kept');
  assert.equal(state.settings.shopName, 'Cleared Shop', 'settings kept');
});
