// Boot test: runs the REAL browser ES modules (public/js + shared) inside a
// tiny DOM stub via vm.SourceTextModule. This is the test that catches the
// class of bugs that only appear in a browser — a broken import, a render-time
// crash, a dead first paint.
//
// It boots the app twice:
//   * server mode   — against a real spawned Shopline server, including a
//                     full "create a work order through the form" round trip;
//   * browser mode  — with fetch unavailable (what a static website or a
//                     double-clicked file looks like), proving the demo
//                     database seeds itself and renders.
//
// Run with:  node --experimental-vm-modules --test tests/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFileSync, rmSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const PORT = 4399;
const ORIGIN = `http://127.0.0.1:${PORT}`;

if (!vm.SourceTextModule) {
  throw new Error('Run tests with --experimental-vm-modules (npm test)');
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---- minimal DOM ----------------------------------------------------------
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
    this.children = this.childNodes;
  }
  get className() { return this._attrs.class || ''; }
  set className(v) { this._attrs.class = v; }
  get textContent() { return textOf(this).trim(); }
  set textContent(v) { this.childNodes = []; this.children = this.childNodes; this._text = String(v); }
  appendChild(child) { if (child == null) return child; this.childNodes.push(child); child.parentNode = this; return child; }
  append(...nodes) { nodes.forEach((n) => this.appendChild(n)); }
  replaceChildren(...nodes) { this.childNodes = []; this.children = this.childNodes; nodes.forEach((n) => this.appendChild(n)); }
  remove() { if (this.parentNode) this.parentNode.childNodes = this.parentNode.childNodes.filter((c) => c !== this); }
  setAttribute(k, v) { this._attrs[k] = String(v); }
  getAttribute(k) { return this._attrs[k]; }
  addEventListener(type, fn) { (this._listeners[type] = this._listeners[type] || []).push(fn); }
  dispatch(type, ev = {}) { for (const fn of this._listeners[type] || []) fn({ target: this, preventDefault() {}, stopPropagation() {}, ...ev }); }
  click() { this.dispatch('click'); }
  focus() {}
  blur() {}
  select() {}
  scrollIntoView() {}
  querySelector() { return null; }
  querySelectorAll() { return []; }
  get firstChild() { return this.childNodes[0] || null; }
}
function makeText(text) { const n = new Node(); n.nodeType = 3; n._text = String(text); return n; }
function textOf(node) {
  if (!node) return '';
  if (node.nodeType === 3) return node._text || '';
  let out = node._text || '';
  for (const c of node.childNodes || []) out += ' ' + textOf(c);
  return out;
}
const walk = (node, out = []) => { out.push(node); for (const c of node.childNodes || []) walk(c, out); return out; };

function makeSandbox({ fetchImpl, eventSourceOpens = true, origin = ORIGIN, href = `${ORIGIN}/` } = {}) {
  const registry = [];
  for (const id of ['sidebar', 'topbar', 'content', 'search-results', 'kiosk']) {
    const el = new FakeElement('div');
    el.setAttribute('id', id);
    registry.push(el);
  }
  const byId = Object.fromEntries(registry.map((el) => [el._attrs.id, el]));
  const storage = (() => {
    const map = new Map();
    return {
      getItem: (k) => (map.has(k) ? map.get(k) : null),
      setItem: (k, v) => { map.set(k, String(v)); },
      removeItem: (k) => { map.delete(k); },
      _map: map,
    };
  })();
  const document = {
    createElement: (t) => { const el = new FakeElement(t); registry.push(el); return el; },
    createElementNS: (ns, t) => { const el = new FakeElement(t); registry.push(el); return el; },
    createTextNode: (t) => makeText(t),
    getElementById: (id) => registry.find((el) => el._attrs?.id === id) || null,
    querySelector: () => null,
    querySelectorAll: () => [],
    addEventListener: () => {},
    removeEventListener: () => {},
    body: new FakeElement('body'),
    documentElement: (() => { const el = new FakeElement('html'); el.dataset = { theme: 'dark' }; return el; })(),
    activeElement: null,
    contains: () => false,
    fullscreenElement: null,
  };
  const windowListeners = {};
  const location = { protocol: new URL(href).protocol, origin, href, hash: '', search: '' };
  const sandbox = {
    Node, document, localStorage: storage, location,
    window: {
      addEventListener: (type, fn) => { (windowListeners[type] = windowListeners[type] || []).push(fn); },
      removeEventListener: () => {},
      open: () => {},
      location,
      __shoplineErrors: [],
    },
    navigator: { clipboard: { writeText: async () => {} } },
    requestAnimationFrame: (fn) => setTimeout(fn, 0),
    setTimeout, clearTimeout,
    setInterval: () => 0, clearInterval: () => {},
    console,
    fetch: fetchImpl || (() => Promise.reject(new Error('no server (browser demo mode)'))),
    EventSource: class {
      constructor(url) { this.url = url; if (eventSourceOpens) queueMicrotask(() => this.onopen?.()); }
      close() {}
    },
    URL, URLSearchParams, AbortController,
    alert: () => {}, confirm: () => true,
  };
  sandbox.globalThis = sandbox;
  return { sandbox, registry, windowListeners, storage };
}

// ---- ES module loader (resolves specifiers exactly like a browser) --------
// A mount maps a real URL path to a file in the repo, so the tests reproduce
// each deployment shape: the server (app at the domain root, /shared served
// separately) and a static host like GitHub Pages (app under /<repo>/public/).
const serverMount = (p) => (p.startsWith('/shared/') ? join(ROOT, p.slice(1)) : join(ROOT, 'public', p.slice(1)));
const pagesMount = (prefix) => (p) => {
  const rel = (p.startsWith(prefix) ? p.slice(prefix.length) : p).replace(/^\/+/, '');
  return join(ROOT, rel);
};

async function bootModule(entryUrl, sandbox, resolveFile) {
  const context = vm.createContext(sandbox);
  const cache = new Map();
  function createModule(url) {
    if (cache.has(url)) return cache.get(url);
    const mod = new vm.SourceTextModule(readFileSync(resolveFile(new URL(url).pathname), 'utf8'), { identifier: url, context });
    cache.set(url, mod);
    return mod;
  }
  const entry = createModule(entryUrl);
  // The link callback returns (unlinked) modules; the vm resolves the whole
  // graph recursively from here — using real URL resolution, like a browser.
  await entry.link((specifier, referencing) => createModule(new URL(specifier, referencing.identifier).href));
  await entry.evaluate();
  return entry;
}

async function bootApp({ fetchImpl, entryUrl = `${ORIGIN}/js/app.js`, resolveFile = serverMount, origin = ORIGIN, href = `${ORIGIN}/` } = {}) {
  const { sandbox, windowListeners } = makeSandbox({ fetchImpl, origin, href });
  await bootModule(entryUrl, sandbox, resolveFile);
  await sleep(60);
  return {
    sandbox,
    content: sandbox.document.getElementById('content'),
    navigate(view) {
      sandbox.location.hash = `#/${view}`;
      for (const fn of windowListeners.hashchange || []) fn({});
    },
    text: () => textOf(sandbox.document.getElementById('content')),
    errors: () => sandbox.window.__shoplineErrors,
  };
}

function startServer() {
  const dataDir = mkdtempSync(join(tmpdir(), 'shopline-test-'));
  const child = spawn(process.execPath, [join(ROOT, 'server.js')], {
    env: { ...process.env, PORT: String(PORT), DATA_FILE: join(dataDir, 'db.json') },
    stdio: 'ignore',
  });
  const stop = () => {
    child.kill('SIGTERM');
    try { rmSync(dataDir, { recursive: true, force: true }); } catch { /* best effort */ }
  };
  return { child, stop };
}

// ---- the app page: server mode ---------------------------------------------
test('boots against the real server, renders the overview and saves a work order end to end', async (t) => {
  const { child, stop } = startServer();
  t.after(stop);
  for (let i = 0; i < 50; i++) {
    try { const r = await fetch(`${ORIGIN}/api/state`); if (r.ok) break; } catch { /* retry */ }
    await sleep(100);
  }

  const app = await bootApp({ fetchImpl: (path, opts) => fetch(new URL(path, ORIGIN).href, opts) });
  assert.equal(app.errors().length, 0, `no runtime errors: ${app.errors().join(' | ')}`);

  const text = app.text();
  assert.match(text, /Open Work Orders/, 'overview KPI rendered');
  assert.match(text, /Attention Needed/, 'attention list rendered');
  assert.match(text, /Replace hydraulic hoses on D6 dozer/, 'seeded work order visible');

  // Navigate to Work Orders and create one through the real modal form.
  app.navigate('workorders');
  await sleep(30);
  assert.match(app.text(), /Backlog/, 'work order board rendered');

  const addBtn = walk(app.content).find((n) => n.tagName === 'BUTTON' && /Add Work Order/.test(textOf(n)));
  assert.ok(addBtn, 'Add Work Order button exists');
  addBtn.click();

  const body = app.sandbox.document.body;
  const form = walk(body).find((n) => n.tagName === 'FORM');
  assert.ok(form, 'the record form opened');
  const inputs = walk(form).filter((n) => n.tagName === 'INPUT');
  const titleInput = inputs.find((i) => i._attrs.type !== 'number' && i._attrs.type !== 'date');
  assert.ok(titleInput, 'title input found');
  titleInput.value = 'Test work order from the browser test';

  form.dispatch('submit');
  await sleep(120);

  // The server must have persisted it.
  const snap = await (await fetch(`${ORIGIN}/api/state`)).json();
  assert.ok(snap.collections.workorders.some((w) => w.title === 'Test work order from the browser test'), 'work order reached the server');
  assert.equal(app.errors().length, 0, 'no runtime errors after the save');
});

// ---- the app page: demo mode, deployed under a /<repo>/public/ subpath ----
// This is the GitHub Pages shape that broke first: the app is NOT at the
// domain root, so ../shared/* must still resolve to the repo's shared/ folder.
test('boots as a browser demo from a static subpath (GitHub Pages layout), seeded and fully rendered', async (t) => {
  const PAGES = { origin: 'https://user.github.io', href: 'https://user.github.io/dashboard/public/' };
  const app = await bootApp({
    fetchImpl: () => Promise.reject(new Error('offline')),
    entryUrl: 'https://user.github.io/dashboard/public/js/app.js',
    resolveFile: pagesMount('/dashboard'),
    ...PAGES,
  });
  assert.equal(app.errors().length, 0, `no runtime errors: ${app.errors().join(' | ')}`);

  const text = app.text();
  assert.match(text, /Open Work Orders/, 'overview KPI rendered in demo mode');
  assert.match(text, /Replace hydraulic hoses on D6 dozer/, 'seeded demo data visible');

  const stored = app.sandbox.localStorage.getItem('shopline.db.v1');
  assert.ok(stored, 'demo database persisted to browser storage');
  const db = JSON.parse(stored);
  assert.ok(db.workorders.length > 0, 'demo database seeded with work orders');
  assert.equal(db.settings.shopName, 'Montana Fleet Solutions LLC', 'the demo is branded for the client');
});

// ---- the kiosk page ---------------------------------------------------------
test('boots the kiosk wall board from a static subpath and shows the about view', async () => {
  const { sandbox } = makeSandbox({
    fetchImpl: () => Promise.reject(new Error('offline')),
    origin: 'https://user.github.io',
    href: 'https://user.github.io/dashboard/public/',
  });
  await bootModule('https://user.github.io/dashboard/public/js/display.js', sandbox, pagesMount('/dashboard'));
  await sleep(60);
  assert.equal(sandbox.window.__shoplineErrors.length, 0, `no runtime errors: ${sandbox.window.__shoplineErrors.join(' | ')}`);
  const text = textOf(sandbox.document.getElementById('kiosk'));
  assert.match(text, /Shop Overview/, 'kiosk renders the overview board');
  assert.match(text, /Attention Needed/, 'attention rows on the wall board');
  assert.match(text, /DEMO/, 'demo status shown on the wall board');
});
