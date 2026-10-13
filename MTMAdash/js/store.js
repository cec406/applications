// Central reactive store. Two backends, identical surface:
//   server  - REST + Server-Sent Events when the app is served by node server.js
//             (data lives in data/db.json and is shared across the LAN, live)
//   browser - localStorage when the app is opened as a plain file (double-click
//             index.html); edits save instantly in this browser, and other open
//             tabs sync through the browser 'storage' event.
// Views subscribe and re-render on change.
import { api, getActor } from './api.js';
import { collections, collectionByName } from '../shared/schema.js';
import { localDb, watchStorage } from './localdb.js';

// file:// pages have no server; everything else talks to the REST backend.
export let mode = (typeof location !== 'undefined' && location.protocol === 'file:') ? 'browser' : 'server';
let backend = mode === 'browser' ? localDb : api;

const listeners = new Set();

export const state = {
  collections: {},
  settings: {},
  activity: [],
  meta: {},
  connected: false,
  lastSync: null,
  clients: 0,
};

for (const c of collections) state.collections[c.name] = [];

let ready = false;
let es = null;

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

export async function load() {
  let snap;
  try {
    snap = await backend.state();
  } catch (err) {
    // Opened over http(s) but no API answered (e.g. a plain static host)?
    // Fall back to browser storage so the page still works everywhere.
    if (mode === 'server' && !ready && backend === api) {
      console.warn('[store] server API unreachable — falling back to browser storage');
      mode = 'browser';
      backend = localDb;
      snap = backend.state();
    } else {
      throw err;
    }
  }
  state.collections = snap.collections;
  state.settings = snap.settings || {};
  state.activity = snap.activity || [];
  state.meta = snap.meta || {};
  state.clients = snap.clients || (mode === 'browser' ? 1 : 0);
  state.lastSync = new Date();
  ready = true;
  notify({ type: 'loaded' });
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
      load().catch((err) => console.error(err));
      return;
    case 'hello':
      // Reconnected - pull a fresh snapshot to be safe.
      load().catch((err) => console.error(err));
      return;
  }
  if (event.activity) addActivity(event.activity);
  state.lastSync = new Date();
  notify(event);
}

export function connect() {
  if (mode === 'browser') {
    // "Live sync" across tabs comes from the browser storage event.
    state.connected = true;
    watchStorage(() => load().catch((err) => console.error(err)));
    return null;
  }
  if (es) es.close();
  es = new EventSource('/api/events');  es.onopen = () => {
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
  return rec[meta?.primary] || rec.name || rec.message || rec.id;
}

export function options(name) {
  const meta = collectionByName[name];
  if (!meta) return [];
  const fieldName = meta.primary;
  return col(name)
    .map((r) => ({ value: r.id, label: r[fieldName] || r.id }))
    .sort((a, b) => String(a.label).localeCompare(String(b.label), undefined, { numeric: true }));
}

// ---- actions (the backend is the source of truth; SSE/storage echoes back) --
export async function save(collectionName, id, patch) {
  const actor = getActor() || (mode === 'browser' ? 'this browser' : 'Operator');
  if (id) {
    const updated = await backend.update(collectionName, id, patch, actor);
    upsert(collectionName, updated);
    notify({ type: 'update', collection: collectionName, item: updated, local: true });
    return updated;
  }
  const created = await backend.create(collectionName, patch, actor);
  upsert(collectionName, created);
  notify({ type: 'create', collection: collectionName, item: created, local: true });
  return created;
}

export async function remove(collectionName, id) {
  const actor = getActor() || 'Operator';
  await backend.remove(collectionName, id, actor);
  drop(collectionName, id);
  notify({ type: 'delete', collection: collectionName, item: { id }, local: true });
}

export async function saveSettings(patch) {
  const settings = await backend.updateSettings(patch, getActor() || 'Operator');
  state.settings = settings;
  notify({ type: 'settings', local: true });
  return settings;
}

// ---- backups (work in both modes) -----------------------------------------
export function backupJson() {
  return JSON.stringify({
    collections: Object.fromEntries(collections.map((c) => [c.name, col(c.name)])),
    settings: state.settings,
    meta: state.meta,
  }, null, 2);
}

export async function restoreBackup(data) {
  if (mode === 'browser') {
    localDb.replaceAll(data, getActor() || 'this browser');
  } else {
    await api.importAll(data);
  }
  await load();
}

// Kick a full refresh (used after bulk imports).
export async function refresh() {
  await load();
}

// Remove every record and start fresh (keeps settings + equipment types).
export async function clearAll() {
  if (mode === 'browser') {
    localDb.wipe(getActor() || 'this browser');
  } else {
    await api.clear();
  }
  await load();
}
