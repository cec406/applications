// Browser-local database. When the app is opened as a plain file (double-click
// index.html) there is no server and no shared JSON file — so records are kept
// in this browser's localStorage instead. Semantics mirror lib/db.js exactly:
// schema coercion, unit lookup by name, timestamps and an activity log, so the
// rest of the app cannot tell the two modes apart.
//
// Editing anywhere saves instantly; other open tabs pick the change up through
// the browser 'storage' event.
import {
  collections, collectionByName, coerceValue, titleOf, normalizeItems,
} from '../shared/schema.js';
import { buildSeed } from '../shared/seed.js';

export const STORAGE_KEY = 'shopops.db.v2';

// A tiny Storage-compatible shim for environments without localStorage
// (tests, private-mode edge cases) so the app still works in-memory.
export function memoryStorage() {
  const map = new Map();
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => { map.set(k, String(v)); },
    removeItem: (k) => { map.delete(k); },
    _map: map,
  };
}

export function browserStorage() {
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem('shopops.probe', '1');
      localStorage.removeItem('shopops.probe');
      return localStorage;
    }
  } catch { /* blocked */ }
  return memoryStorage();
}

const newId = (prefix) => `${prefix}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

const ID_PREFIX = {
  appointments: 'apt',
  units: 'unit',
  weapons: 'wpn',
  notes: 'note',
  eqtypes: 'eqt',
};

export function makeLocalDb(storage = browserStorage(), key = STORAGE_KEY) {
  let db = null;
  const listeners = new Set();

  function persist() {
    try {
      db.meta = { ...db.meta, version: 1, updatedAt: new Date().toISOString() };
      storage.setItem(key, JSON.stringify(db));
    } catch (err) {
      console.error('[localdb] could not save', err);
    }
  }

  function emit(event) {
    for (const fn of listeners) {
      try { fn(event); } catch (err) { console.error('[localdb] listener error', err); }
    }
  }

  function load() {
    try {
      const raw = storage.getItem(key);
      if (raw) db = JSON.parse(raw);
    } catch { db = null; }
    if (!db || typeof db !== 'object') {
      db = buildSeed();
      persist();
    }
    for (const c of collections) if (!Array.isArray(db[c.name])) db[c.name] = [];
    if (!Array.isArray(db.activity)) db.activity = [];
    if (!db.settings || typeof db.settings !== 'object') db.settings = {};
    if (!db.meta) db.meta = { version: 1 };
    syncAllUnitNames();
    return db;
  }

  function syncUnitName(record) {
    if (!record) return record;
    if (!record.unitId) { record.unitName = record.unitName || ''; return record; }
    const unit = (db.units || []).find((u) => u.id === record.unitId);
    if (unit && unit.name !== record.unitName) record.unitName = unit.name;
    return record;
  }
  function syncAllUnitNames() {
    for (const appt of db.appointments || []) syncUnitName(appt);
  }

  function resolveRefByName(refName, raw) {
    const list = db[refName] || [];
    const existing = list.find((r) => r.id === raw)
      || list.find((r) => String(r.name).toLowerCase() === raw.toLowerCase());
    if (existing) return existing.id;
    const refMeta = collectionByName[refName];
    const created = {
      id: newId(ID_PREFIX[refName] || 'ref'),
      [refMeta?.primary === 'message' ? 'message' : 'name']: raw,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    list.unshift(created);
    logActivity('system', `Added ${refMeta?.singular.toLowerCase() || refName} "${raw}" (referenced by another record)`);
    return created.id;
  }

  function coerceRecord(collectionName, input, base = {}) {
    const col = collectionByName[collectionName];
    const out = { ...base };
    for (const field of col.fields) {
      if (!Object.prototype.hasOwnProperty.call(input, field.key)) continue;
      let value = input[field.key];
      if (field.resolveByName && typeof value === 'string' && value.trim()) {
        value = resolveRefByName(field.ref, value.trim());
      }
      out[field.key] = coerceValue(field, value);
    }
    return out;
  }

  function logActivity(actor, text) {
    const entry = { id: newId('act'), at: new Date().toISOString(), actor: actor || 'browser', text };
    db.activity.unshift(entry);
    db.activity = db.activity.slice(0, 300);
    return entry;
  }

  function create(collectionName, input, actor) {
    const col = collectionByName[collectionName];
    const record = coerceRecord(collectionName, input, {});
    for (const field of col.fields) {
      if (record[field.key] === undefined && field.default !== undefined) record[field.key] = field.default;
    }
    record.id = newId(ID_PREFIX[collectionName] || 'rec');
    record.createdAt = new Date().toISOString();
    record.updatedAt = record.createdAt;
    if (collectionName === 'appointments') syncUnitName(record);
    db[collectionName].unshift(record);
    const note = logActivity(actor, `Added ${col.singular.toLowerCase()} "${titleOf(collectionName, record)}"`);
    persist();
    emit({ type: 'create', collection: collectionName, item: record, activity: note, actor });
    return record;
  }

  function update(collectionName, id, patch, actor) {
    const col = collectionByName[collectionName];
    const record = db[collectionName].find((r) => r.id === id);
    if (!record) return null;
    const merged = coerceRecord(collectionName, patch, record);
    merged.updatedAt = new Date().toISOString();
    Object.assign(record, merged);
    if (collectionName === 'appointments') syncUnitName(record);
    if (collectionName === 'units') {
      for (const appt of db.appointments || []) {
        if (appt.unitId === id && appt.unitName !== record.name) appt.unitName = record.name;
      }
    }
    const note = logActivity(actor, `Updated ${col.singular.toLowerCase()} "${titleOf(collectionName, record)}"`);
    persist();
    emit({ type: 'update', collection: collectionName, item: record, activity: note, actor });
    return record;
  }

  function remove(collectionName, id, actor) {
    const col = collectionByName[collectionName];
    const idx = db[collectionName].findIndex((r) => r.id === id);
    if (idx === -1) return null;
    const [record] = db[collectionName].splice(idx, 1);
    const note = logActivity(actor, `Deleted ${col.singular.toLowerCase()} "${titleOf(collectionName, record)}"`);
    persist();
    emit({ type: 'delete', collection: collectionName, item: record, activity: note, actor });
    return record;
  }

  function updateSettings(patch, actor) {
    db.settings = { ...db.settings, ...patch };
    const note = logActivity(actor, 'Updated shop settings');
    persist();
    emit({ type: 'settings', settings: db.settings, activity: note, actor });
    return db.settings;
  }

  function replaceAll(incoming, actor) {
    const next = { ...incoming };
    for (const c of collections) {
      if (!Array.isArray(next[c.name])) next[c.name] = [];
    }
    if (!Array.isArray(next.activity)) next.activity = [];
    if (!next.settings || typeof next.settings !== 'object') next.settings = { ...db.settings };
    next.meta = { ...(next.meta || {}), version: 1, restoredAt: new Date().toISOString() };
    db = next;
    syncAllUnitNames();
    logActivity(actor, 'Restored database from backup');
    persist();
    emit({ type: 'reload', actor });
    return db;
  }

  function wipe(actor) {
    const keepSettings = { ...db.settings };
    const keepTypes = [...(db.eqtypes || [])];
    db = buildSeed();
    db.settings = keepSettings;
    if (keepTypes.length) db.eqtypes = keepTypes;
    logActivity(actor, 'Cleared all data');
    persist();
    emit({ type: 'reload' });
    return db;
  }

  function snapshot() {
    return {
      collections: Object.fromEntries(collections.map((c) => [c.name, db[c.name]])),
      settings: db.settings,
      activity: db.activity.slice(0, 50),
      meta: db.meta,
      serverTime: new Date().toISOString(),
      clients: 1,
      mode: 'browser',
    };
  }

  load();

  return {
    mode: 'browser',
    load,
    snapshot,
    create,
    update,
    remove,
    updateSettings,
    replaceAll,
    wipe,
    onChange: (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    state: () => snapshot(),
    // REST-like aliases so the store can treat both backends identically.
    items: (collectionName) => db[collectionName],
    // Raw access for tests.
    _db: () => db,
  };
}

// The singleton used by the app.
export const localDb = makeLocalDb();

// React to edits made in OTHER tabs of the same browser.
export function watchStorage(onChange) {
  if (typeof window === 'undefined') return () => {};
  const handler = (e) => {
    if (e.key === STORAGE_KEY || e.key === null) onChange(e);
  };
  window.addEventListener('storage', handler);
  return () => window.removeEventListener('storage', handler);
}
