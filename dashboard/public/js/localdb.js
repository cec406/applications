// Browser-local database. When the dashboard is opened as a plain file or
// hosted as a static site (e.g. as a live demo on a website) there is no
// Node server and no shared JSON file — so records are kept in this browser's
// localStorage instead. Semantics mirror lib/db.js exactly: schema coercion,
// timestamps and an activity log, so the rest of the app cannot tell the two
// modes apart.
//
// First run is seeded with the sample shop (shared/seed.js), so the demo is
// populated the moment it loads. Edits save instantly; other open tabs pick
// the change up through the browser 'storage' event.
// NOTE on the import depth: this module is loaded both by the browser (served
// at /js/localdb.js, so ../.. normalizes to the site root where /shared lives)
// and directly by Node (tests), where ../.. really is the project root.
import { collections, collectionByName, coerceValue } from '../../shared/schema.js?v=20261012-3';
import { buildSeed } from '../../shared/seed.js?v=20261012-3';

export const STORAGE_KEY = 'shopline.db.v1';

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
      localStorage.setItem('shopline.probe', '1');
      localStorage.removeItem('shopline.probe');
      return localStorage;
    }
  } catch { /* blocked */ }
  return memoryStorage();
}

const newId = (prefix) => `${prefix}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

const ID_PREFIX = {
  workorders: 'wo',
  assets: 'ast',
  schedule: 'pm',
  parts: 'part',
  people: 'per',
  vendors: 'ven',
  resources: 'res',
};

// A demo nobody has touched quietly refreshes itself after this long, so a
// website showcase never shows stale dates. Once any edit is made the data
// belongs to the visitor and is kept until "Reset demo data".
const SEED_TTL_DAYS = 45;

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

  function freshSeed() {
    const seed = buildSeed();
    seed.meta = { ...seed.meta, version: 1, seededOn: new Date().toISOString().slice(0, 10) };
    return seed;
  }

  function load() {
    try {
      const raw = storage.getItem(key);
      if (raw) db = JSON.parse(raw);
    } catch { db = null; }
    if (!db || typeof db !== 'object') db = freshSeed();
    for (const c of collections) if (!Array.isArray(db[c.name])) db[c.name] = [];
    if (!Array.isArray(db.activity)) db.activity = [];
    if (!db.settings || typeof db.settings !== 'object') db.settings = {};
    if (!db.meta || typeof db.meta !== 'object') db.meta = { version: 1 };
    const seededOn = Date.parse(db.meta.seededOn || '');
    const ageOk = !Number.isNaN(seededOn) && (Date.now() - seededOn) < SEED_TTL_DAYS * 86400000;
    if (!db.meta.userModified && !ageOk) {
      db = freshSeed();
    }
    persist();
    return db;
  }

  function coerceRecord(collectionName, input, base = {}) {
    const col = collectionByName[collectionName];
    const out = { ...base };
    for (const field of col.fields) {
      if (field.type === 'computed') continue;
      if (!Object.prototype.hasOwnProperty.call(input, field.key)) continue;
      out[field.key] = coerceValue(field, input[field.key]);
    }
    return out;
  }

  function logActivity(actor, text) {
    const entry = { id: newId('act'), at: new Date().toISOString(), actor: actor || 'this browser', text };
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
    db[collectionName].unshift(record);
    db.meta = { ...db.meta, userModified: true };
    const note = logActivity(actor, `Added ${col.singular.toLowerCase()} "${record[col.primary] || record.id}"`);
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
    db.meta = { ...db.meta, userModified: true };
    const note = logActivity(actor, `Updated ${col.singular.toLowerCase()} "${record[col.primary] || record.id}"`);
    persist();
    emit({ type: 'update', collection: collectionName, item: record, activity: note, actor });
    return record;
  }

  function remove(collectionName, id, actor) {
    const col = collectionByName[collectionName];
    const idx = db[collectionName].findIndex((r) => r.id === id);
    if (idx === -1) return null;
    const [record] = db[collectionName].splice(idx, 1);
    db.meta = { ...db.meta, userModified: true };
    const note = logActivity(actor, `Deleted ${col.singular.toLowerCase()} "${record[col.primary] || record.id}"`);
    persist();
    emit({ type: 'delete', collection: collectionName, item: record, activity: note, actor });
    return record;
  }

  function updateSettings(patch, actor) {
    db.settings = { ...db.settings, ...patch };
    db.meta = { ...db.meta, userModified: true };
    const note = logActivity(actor, 'Updated dashboard settings');
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
    next.meta = { ...(next.meta || {}), version: 1, restoredAt: new Date().toISOString(), userModified: true };
    db = next;
    const note = logActivity(actor, 'Restored database from backup');
    persist();
    emit({ type: 'reload', actor, activity: note });
    return db;
  }

  // "Reset demo data": put the pristine sample shop back.
  function wipe(actor) {
    const keepSettings = { ...db.settings };
    db = freshSeed();
    db.settings = keepSettings;
    const note = logActivity(actor || 'this browser', 'Reset demo data — sample shop restored');
    persist();
    emit({ type: 'reload', actor, activity: note });
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
