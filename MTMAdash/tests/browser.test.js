// Headless "browser" test: runs the REAL built bundle (from index.html /
// display.html) inside a tiny DOM stub. This is the test that catches the
// class of bugs that only appear in a browser (a broken bundle reference, a
// render-time crash) — the moment the page goes blank.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { todayIso, shiftDays } from '../js/util.js';
import { STORAGE_KEY } from '../js/localdb.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
execFileSync(process.execPath, [join(ROOT, 'build.js')], { cwd: ROOT, stdio: 'ignore' });

function extractBundle(file) {
  const html = readFileSync(join(ROOT, file), 'utf8');
  const m = html.match(/<script type="module">([\s\S]*?)<\/script>/);
  assert.ok(m, `bundle script found in ${file}`);
  return m[1];
}

// ---- minimal DOM -----------------------------------------------------------
class Node {
  constructor() { this.childNodes = []; this.nodeType = 1; }
}
class FakeClassList {
  constructor() { this.set = new Set(); }
  add(...c) { c.forEach((x) => this.set.add(x)); }
  remove(...c) { c.forEach((x) => this.set.delete(x)); }
  toggle(c, force) { const on = force === undefined ? !this.set.has(c) : force; on ? this.set.add(c) : this.set.delete(c); return on; }
  contains(c) { return this.set.has(c); }
}
class FakeElement extends Node {
  constructor(tag) {
    super();
    this.tagName = String(tag || '').toUpperCase();
    this._attrs = {};
    this.dataset = {};
    this.style = {};
    this.classList = new FakeClassList();
    this._listeners = {};
    this._text = '';
    this.value = '';
    this.checked = false;
    this.innerHTML = '';
    this.children = [];
  }
  get className() { return this._attrs.class || ''; }
  set className(v) { this._attrs.class = v; }
  get textContent() { return textOf(this).trim(); }
  set textContent(v) { this.childNodes = []; this._text = String(v); }
  appendChild(child) { if (child == null) return child; this.childNodes.push(child); this.children = this.childNodes; child.parentNode = this; return child; }
  append(...nodes) { nodes.forEach((n) => this.appendChild(n)); }
  replaceChildren(...nodes) { this.childNodes = []; this.children = this.childNodes; nodes.forEach((n) => this.appendChild(n)); }
  remove() { if (this.parentNode) this.parentNode.childNodes = this.parentNode.childNodes.filter((c) => c !== this); }
  setAttribute(k, v) { this._attrs[k] = String(v); }
  getAttribute(k) { return this._attrs[k]; }
  addEventListener(type, fn) { (this._listeners[type] = this._listeners[type] || []).push(fn); }
  dispatch(type, ev = {}) { for (const fn of this._listeners[type] || []) fn({ target: this, preventDefault() {}, stopPropagation() {}, ...ev }); }
  click() { this.dispatch('click'); }
  focus() {}
  scrollIntoView() {}
  querySelector() { return null; }
  querySelectorAll() { return []; }
}
function makeText(text) { const n = new Node(); n.nodeType = 3; n._text = String(text); return n; }
function textOf(node) {
  if (!node) return '';
  if (node.nodeType === 3) return node._text || '';
  let out = node._text || '';
  for (const c of node.childNodes || []) out += ' ' + textOf(c);
  return out;
}

function makeSandbox(ids, fixture) {
  const registry = [];
  const byId = new Map();
  for (const id of ids) {
    const el = new FakeElement('div');
    el.setAttribute('id', id);
    registry.push(el);
    byId.set(id, el);
  }
  const localStorage = (() => {
    const map = new Map();
    if (fixture) map.set(STORAGE_KEY, JSON.stringify(fixture));
    return {
      getItem: (k) => (map.has(k) ? map.get(k) : null),
      setItem: (k, v) => map.set(k, String(v)),
      removeItem: (k) => map.delete(k),
      _map: map,
    };
  })();
  const document = {
    createElement: (t) => { const el = new FakeElement(t); registry.push(el); return el; },
    createElementNS: (ns, t) => { const el = new FakeElement(t); registry.push(el); return el; },
    createTextNode: (t) => makeText(t),
    getElementById: (id) => registry.find((el) => el._attrs && el._attrs.id === id) || null,
    querySelector: () => null,
    querySelectorAll: () => [],
    addEventListener: () => {},
    body: new FakeElement('body'),
    documentElement: (() => { const el = new FakeElement('html'); el.dataset = { theme: 'dark' }; return el; })(),
    activeElement: null,
    contains: () => false,
  };
  const sandbox = {
    Node, document, localStorage,
    location: { protocol: 'file:', hash: '', origin: 'file://', href: 'file:///index.html' },
    window: { addEventListener: () => {}, removeEventListener: () => {}, open: () => {}, __shoplineErrors: [] },
    navigator: { clipboard: { writeText: () => {} } },
    requestAnimationFrame: () => 0,
    setTimeout: () => 0, clearTimeout: () => {}, setInterval: () => 0, clearInterval: () => {},
    fetch: () => Promise.reject(new Error('no server in browser test')),
    EventSource: class { constructor() {} close() {} },
    console, registry, byId,
  };
  sandbox.globalThis = sandbox;
  return sandbox;
}

async function runBundle(file, ids, fixture) {
  const sandbox = makeSandbox(ids, fixture);
  vm.createContext(sandbox);
  vm.runInContext(extractBundle(file), sandbox, { filename: file });
  // Let boot()'s awaited load() and the first render settle.
  await new Promise((r) => setTimeout(r, 30));
  return sandbox;
}

// A tiny populated shop, persisted the way the browser backend would.
function shopFixture() {
  const today = todayIso();
  return {
    meta: { version: 1 },
    settings: { shopName: 'Shop Ops', shopSubtitle: '', rotateSeconds: 14, kioskViews: 'board,schedule,weapons,notes' },
    units: [
      { id: 'unit-a', name: 'A/2-1 IN', poc: 'SGT Ruiz' },
      { id: 'unit-b', name: 'B/2-1 IN', poc: 'SPC Ortega' },
      { id: 'unit-c', name: 'C/3-1 IN', poc: 'CPL Chen' },
    ],
    eqtypes: [{ id: 'eqt-1', name: 'Generator' }],
    appointments: [{
      id: 'apt-1', date: today, time: '07:30', unitId: 'unit-a', unitName: 'A/2-1 IN',
      direction: 'Drop-off', status: 'Scheduled',
      items: [{ eqType: 'Generator', qty: 2, description: 'MEP-803A' }], poc: 'SGT Ruiz', notes: '',
    }, {
      id: 'apt-2', date: today, time: 'TBD', unitId: 'unit-a', unitName: 'A/2-1 IN',
      direction: 'Pickup', status: 'Scheduled', items: [], poc: '', notes: '',
    }, {
      // Scheduled for later this week: must already be on the board, for planning.
      id: 'apt-3', date: shiftDays(today, 3), time: '10:00', unitId: 'unit-b', unitName: 'B/2-1 IN',
      direction: 'Drop-off', status: 'Scheduled',
      items: [{ eqType: 'Generator', qty: 1, description: 'MEP-803A #9' }], poc: '', notes: '',
    }, {
      // Scheduled two days ago and never completed: still on the board (overdue).
      id: 'apt-4', date: shiftDays(today, -2), time: '09:00', unitId: 'unit-c', unitName: 'C/3-1 IN',
      direction: 'Pickup', status: 'Scheduled', items: [], poc: '', notes: '',
    }],
    weapons: [{ id: 'w1', name: 'M4 Carbine', count: 5 }],
    notes: [{ id: 'n1', message: 'Range closed Friday', createdAt: new Date().toISOString() }],
    activity: [],
  };
}

// ---- the app page ----------------------------------------------------------
test('the built app boots and renders stored data in a browser-like environment', async () => {
  const sandbox = await runBundle('index.html', ['sidebar', 'topbar', 'content', 'search-results'], shopFixture());
  const content = sandbox.byId.get('content');

  assert.equal(sandbox.window.__shoplineErrors.length, 0, `no runtime errors: ${sandbox.window.__shoplineErrors.join(' | ')}`);
  assert.ok(content.childNodes.length > 0, 'content area is not blank');

  const text = textOf(content);
  assert.match(text, /INBOUND/, 'inbound column rendered');
  assert.match(text, /OUTBOUND/, 'outbound column rendered');
  assert.match(text, /A\/2-1 IN/, 'stored appointment rendered');
  assert.match(text, /MEP-803A/, 'equipment line rendered');
  assert.match(text, /Weapons On Hand/, 'weapons KPI rendered');
  assert.match(text, /Range closed Friday/, 'shop note rendered');
  assert.match(text, /TBD/, 'a TBD time renders on the board');
  assert.match(text, /Open Appointments/, 'the planning KPI rendered');
  assert.match(text, /B\/2-1 IN/, 'a drop-off scheduled for later this week is already on the board');
  assert.match(text, /C\/3-1 IN/, 'an overdue pickup is still on the board');

  const sidebarText = textOf(sandbox.byId.get('sidebar'));
  for (const label of ['Daily Board', 'Schedule', 'Weapons', 'Shop Notes', 'Units', 'Settings']) {
    assert.match(sidebarText, new RegExp(label), `nav has ${label}`);
  }

  // The browser backend ran and persisted the data.
  const stored = sandbox.localStorage.getItem(STORAGE_KEY);
  assert.ok(stored, 'database written to browser storage');
  const db = JSON.parse(stored);
  assert.ok(db.settings.shopName);
});

test('the built app shows a friendly getting-started panel when empty', async () => {
  const sandbox = await runBundle('index.html', ['sidebar', 'topbar', 'content', 'search-results']);
  assert.equal(sandbox.window.__shoplineErrors.length, 0, `no runtime errors: ${sandbox.window.__shoplineErrors.join(' | ')}`);
  const text = textOf(sandbox.byId.get('content'));
  assert.match(text, /Welcome — your board is empty/);
  assert.match(text, /type the unit name/i);
  assert.match(text, /TBD/);
});

// ---- the kiosk page --------------------------------------------------------
test('the built kiosk page boots and renders the wall board', async () => {
  const sandbox = await runBundle('display.html', ['kiosk'], shopFixture());
  const kiosk = sandbox.byId.get('kiosk');

  assert.equal(sandbox.window.__shoplineErrors.length, 0, `no runtime errors: ${sandbox.window.__shoplineErrors.join(' | ')}`);
  assert.ok(kiosk.childNodes.length > 0, 'kiosk area is not blank');
  const text = textOf(kiosk);
  assert.match(text, /INBOUND/);
  assert.match(text, /OUTBOUND/);
  assert.match(text, /A\/2-1 IN/);
  assert.match(text, /B\/2-1 IN/, 'the wall board shows upcoming drop-offs too');
});

// ---- driving the real form: typed unit + TBD time --------------------------
function walk(node, out = []) {
  out.push(node);
  for (const c of node.childNodes || []) walk(c, out);
  return out;
}
const inputsOf = (root) => walk(root).filter((n) => n.tagName === 'INPUT');

test('a new appointment can be created by typing a unit and ticking TBD', async () => {
  const sandbox = await runBundle('index.html', ['sidebar', 'topbar', 'content', 'search-results']);
  assert.equal(sandbox.window.__shoplineErrors.length, 0);

  // Open the "New Appointment" form (the welcome panel offers one on an empty board).
  const newButtons = walk(sandbox.byId.get('content')).filter((n) => n.tagName === 'BUTTON' && /New Appointment/.test(textOf(n)));
  assert.ok(newButtons.length > 0, 'a New Appointment button exists');
  newButtons[0].click();

  const formInputs = inputsOf(sandbox.document.body);
  const unitInput = formInputs.find((i) => i._attrs.list === 'units-datalist');
  const itemType = formInputs.find((i) => i._attrs.list === 'eqtypes-datalist');
  const tbdBox = formInputs.find((i) => i._attrs.type === 'checkbox');
  assert.ok(unitInput, 'the Unit field is a typed input (datalist), not a dropdown');
  assert.ok(itemType, 'the equipment editor offers type-ahead suggestions');
  assert.ok(tbdBox, 'the time field offers a TBD checkbox');

  unitInput.value = 'Z CO 5-1';
  tbdBox.checked = true;

  // Submit the form and let the async save settle.
  const form = walk(sandbox.document.body).find((n) => n.tagName === 'FORM');
  assert.ok(form, 'the dialog form exists');
  form.dispatch('submit');
  await new Promise((r) => setTimeout(r, 20));

  const saved = JSON.parse(sandbox.localStorage.getItem(STORAGE_KEY));
  const appt = saved.appointments[saved.appointments.length - 1];
  assert.equal(appt.unitName, 'Z CO 5-1', 'the typed unit was saved (and created)');
  assert.equal(appt.time, 'TBD', 'the TBD time was saved');
  assert.ok(saved.units.some((u) => u.name === 'Z CO 5-1'), 'the new unit was added to the roster');
  assert.equal(sandbox.window.__shoplineErrors.length, 0, 'no errors during the flow');
});

// ---- sanity: the two entries do not run on each other's page ---------------
test('the app entry does not hijack the kiosk page and vice-versa', async () => {
  const kioskPage = await runBundle('display.html', ['kiosk']);
  // app.js is bundled but guarded: with no #content it must not have built a sidebar.
  assert.equal(kioskPage.byId.get('sidebar'), undefined, 'no app sidebar on the kiosk page');
});
