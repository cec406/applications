// Central reactive store. Two backends, one interface:
//   * server mode — loads a snapshot over REST and stays live via SSE.
//   * browser mode (demo) — runs entirely in this browser against a seeded
//     localStorage database, so the dashboard works as a static site, in a
//     demo, or opened straight from disk.
// Views subscribe and re-render on change.
import { api, getActor } from './api.js?v=20261012-3';
import { collections, collectionByName } from '../../shared/schema.js?v=20261012-3';
import { localDb, watchStorage } from './localdb.js?v=20261012-3';

const listeners = new Set();

export const state = {
  collections: {},
  settings: {},
  activity: [],
  meta: {},
  connected: false,
  lastSync: null,
  clients: 0,
  mode: null, // 'server' | 'browser'
};

for (const c of collections) state.collections[c.name] = [];

let ready = false;
let es = null;
let modeDecided = null;

export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function notify(event) {
  for (const fn of listeners) {
    try {
      fn(event, state);
    } catch (err) {
      console.error('[store] listener failed', err);
    }
  }
}

export function isReady() {
  return ready;
}

// Decide once how this page is running: is there a live Shopline server here,
// or should we self-host the demo in this browser?
async function detectMode() {
  if (modeDecided) return modeDecided;
  try {
    if (location.protocol === 'file:') return (modeDecided = 'browser');
    const params = new URLSearchParams(location.search);
    if (params.has('demo')) return (modeDecided = 'browser');
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 2500);
    const res = await fetch('/api/state', { signal: ctrl.signal, headers: { accept: 'application/json' } });
    clearTimeout(timer);
    const data = await res.json();
    modeDecided = data && typeof data === 'object' && data.collections ? 'server' : 'browser';
    return modeDecided;
  } catch {
    return (modeDecided = 'browser');
  }
}

export async function load() {
  const mode = await detectMode();
  state.mode = mode;
  const snap = mode === 'server' ? await api.state() : localDb.snapshot();
  state.collections = snap.collections;
  state.settings = snap.settings || {};
  state.activity = snap.activity || [];
  state.meta = snap.meta || {};
  state.clients = snap.clients || (mode === 'browser' ? 1 : 0);
  state.lastSync = new Date();
  ready = true;
  notify({ type: 'loaded', mode });
}

function upsert(collectionName, item) {
  const list = state.collections[collectionName];
  if (!list) return;
  const idx = list.findIndex((r) => r.id === item.id);
  if (idx === -1) list.unshift(item);
  else list[idx] = { ...list[idx], ...item };
}

function drop(collectionName, id) {
  const list = state.collections[collectionName];
  if (!list) return;
  const idx = list.findIndex((r) => r.id === id);
  if (idx !== -1) list.splice(idx, 1);
}

function addActivity(entry) {
  if (!entry) return;
  if (state.activity.some((a) => a.id === entry.id)) return;
  state.activity.unshift(entry);
  state.activity = state.activity.slice(0, 300);
}

export function applyEvent(event) {
  switch (event.type) {
    case 'create':
    case 'update':
      upsert(event.collection, event.item);
      break;
    case 'delete':
      drop(event.collection, event.item.id);
      break;
    case 'settings':
      state.settings = event.settings;
      break;
    case 'reload':
    case 'hello':
      // Reconnected or restored — pull a fresh snapshot to be safe.
      load().catch((err) => console.error(err));
      return;
  }
  if (event.activity) addActivity(event.activity);
  state.lastSync = new Date();
  notify(event);
}

export function connect() {
  if (state.mode === 'browser') {
    // Local edits arrive through the local database's change events; other
    // tabs of the same browser surface through the storage event.
    state.connected = true;
    localDb.onChange((event) => applyEvent(event));
    watchStorage(() => load().catch(() => {}));
    notify({ type: 'connection', connected: true });
    return null;
  }
  if (es) es.close();
  es = new EventSource('/api/events');
  es.onopen = () => {
    state.connected = true;
    notify({ type: 'connection', connected: true });
  };
  es.onerror = () => {
    state.connected = false;
    notify({ type: 'connection', connected: false });
  };
  es.onmessage = (ev) => {
    try {
      applyEvent(JSON.parse(ev.data));
    } catch (err) {
      console.error('[store] bad event', err);
    }
  };
  return es;
}

// ---- selectors -----------------------------------------------------------
export function col(name) {
  return state.collections[name] || [];
}

export function byId(name, id) {
  if (!id) return null;
  return col(name).find((r) => r.id === id) || null;
}

export function label(name, id) {
  const rec = byId(name, id);
  if (!rec) return '';
  const meta = collectionByName[name];
  return rec[meta?.primary] || rec.name || rec.title || rec.id;
}

export function options(name) {
  const meta = collectionByName[name];
  if (!meta) return [];
  const fieldName = meta.primary;
  return col(name)
    .map((r) => ({ value: r.id, label: r[fieldName] || r.id }))
    .sort((a, b) => String(a.label).localeCompare(String(b.label), undefined, { numeric: true }));
}

// ---- actions ---------------------------------------------------------------
// Server mode: REST is the source of truth and SSE echoes the change back.
// Browser mode: the local database emits the same change events, which the
// connect() listener funnels through applyEvent — so callers stay identical.
export async function save(collectionName, id, patch) {
  const actor = getActor() || 'Operator';
  if (state.mode === 'browser') {
    const record = id
      ? localDb.update(collectionName, id, patch, actor)
      : localDb.create(collectionName, patch, actor);
    if (!record) throw new Error('Not found');
    return record;
  }
  if (id) {
    const updated = await api.update(collectionName, id, patch);
    upsert(collectionName, updated);
    notify({ type: 'update', collection: collectionName, item: updated, local: true });
    return updated;
  }
  const created = await api.create(collectionName, patch);
  upsert(collectionName, created);
  notify({ type: 'create', collection: collectionName, item: created, local: true });
  return created;
}

export async function remove(collectionName, id) {
  const actor = getActor() || 'Operator';
  if (state.mode === 'browser') {
    const removed = localDb.remove(collectionName, id, actor);
    if (!removed) throw new Error('Not found');
    return removed;
  }
  await api.remove(collectionName, id);
  drop(collectionName, id);
  notify({ type: 'delete', collection: collectionName, item: { id }, local: true });
}

export async function saveSettings(patch) {
  const actor = getActor() || 'Operator';
  if (state.mode === 'browser') {
    return localDb.updateSettings(patch, actor);
  }
  const settings = await api.settings(patch);
  state.settings = settings;
  notify({ type: 'settings', local: true });
  return settings;
}

// ---- whole-database helpers (both modes) -----------------------------------
export function backupJson() {
  return JSON.stringify({
    collections: state.collections,
    settings: state.settings,
    meta: state.meta,
  }, null, 2);
}

export async function importAll(data) {
  if (state.mode === 'browser') {
    localDb.replaceAll(data, getActor() || 'Operator');
    return;
  }
  await api.importAll(data);
  await load();
}

// Demo only: put the pristine sample shop back.
export async function resetDemo() {
  if (state.mode !== 'browser') throw new Error('Reset is only available in demo mode');
  localDb.wipe(getActor() || 'Operator');
}

// Server mode only: empty every collection, keep settings — hand-off / start clean.
export async function clearAll() {
  if (state.mode !== 'server') throw new Error('Clear is only available in server mode');
  await api.clear();
  await load();
}
