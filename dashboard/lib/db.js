// Tiny JSON-file database with atomic writes and an in-memory cache.
// A shop-scale dataset fits comfortably in memory; every mutation is written
// to disk with a temp-file + rename so a crash can never leave a half file.
import { readFileSync, writeFileSync, renameSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { collections, collectionByName, coerceValue } from '../shared/schema.js';
import { buildSeed } from '../shared/seed.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, '..', 'data');
const DB_PATH = process.env.DATA_FILE || join(DATA_DIR, 'db.json');

let db = null;
let writeTimer = null;
const listeners = new Set();

export const ALLOWED = new Set(collections.map((c) => c.name));

function ensureDir() {
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
}

export function load() {
  try {
    db = JSON.parse(readFileSync(DB_PATH, 'utf8'));
  } catch {
    db = buildSeed();
    persistNow();
    console.log(`[db] seeded new database at ${DB_PATH}`);
  }
  // Make sure every collection key exists (forward compatible).
  for (const c of collections) if (!Array.isArray(db[c.name])) db[c.name] = [];
  if (!Array.isArray(db.activity)) db.activity = [];
  if (!db.settings || typeof db.settings !== 'object') db.settings = {};
  if (!db.meta) db.meta = { version: 1 };
  return db;
}

export function get() {
  return db;
}

function schedulePersist() {
  clearTimeout(writeTimer);
  writeTimer = setTimeout(persistNow, 60);
}

export function persistNow() {
  ensureDir();
  db.meta = { ...db.meta, version: 1, updatedAt: new Date().toISOString() };
  const tmp = `${DB_PATH}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(db, null, 2));
  renameSync(tmp, DB_PATH);
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

function coerceRecord(collectionName, input, base = {}) {
  const col = collectionByName[collectionName];
  const out = { ...base };
  for (const field of col.fields) {
    if (field.type === 'computed') continue;
    if (Object.prototype.hasOwnProperty.call(input, field.key)) {
      out[field.key] = coerceValue(field, input[field.key]);
    }
  }
  return out;
}

export function onChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function emit(event) {
  for (const fn of listeners) {
    try {
      fn(event);
    } catch (err) {
      console.error('[db] listener error', err);
    }
  }
}

export function logActivity(actor, text) {
  const entry = { id: newId('act'), at: new Date().toISOString(), actor: actor || 'unknown', text };
  db.activity.unshift(entry);
  db.activity = db.activity.slice(0, 300);
  return entry;
}

export function create(collectionName, input, actor) {
  const col = collectionByName[collectionName];
  const record = coerceRecord(collectionName, input, {});
  for (const field of col.fields) {
    if (record[field.key] === undefined && field.default !== undefined) record[field.key] = field.default;
  }
  record.id = newId(ID_PREFIX[collectionName] || 'rec');
  record.createdAt = new Date().toISOString();
  record.updatedAt = record.createdAt;
  db[collectionName].unshift(record);
  const label = record[col.primary] || record.id;
  const note = logActivity(actor, `Added ${col.singular.toLowerCase()} "${label}"`);
  schedulePersist();
  emit({ type: 'create', collection: collectionName, item: record, activity: note, actor });
  return record;
}

export function update(collectionName, id, patch, actor) {
  const col = collectionByName[collectionName];
  const record = db[collectionName].find((r) => r.id === id);
  if (!record) return null;
  const merged = coerceRecord(collectionName, patch, record);
  merged.updatedAt = new Date().toISOString();
  Object.assign(record, merged);
  const label = record[col.primary] || record.id;
  const note = logActivity(actor, `Updated ${col.singular.toLowerCase()} "${label}"`);
  schedulePersist();
  emit({ type: 'update', collection: collectionName, item: record, activity: note, actor });
  return record;
}

export function remove(collectionName, id, actor) {
  const col = collectionByName[collectionName];
  const idx = db[collectionName].findIndex((r) => r.id === id);
  if (idx === -1) return null;
  const [record] = db[collectionName].splice(idx, 1);
  const label = record[col.primary] || record.id;
  const note = logActivity(actor, `Deleted ${col.singular.toLowerCase()} "${label}"`);
  schedulePersist();
  emit({ type: 'delete', collection: collectionName, item: record, activity: note, actor });
  return record;
}

export function updateSettings(patch, actor) {
  db.settings = { ...db.settings, ...patch };
  const note = logActivity(actor, 'Updated shop settings');
  schedulePersist();
  emit({ type: 'settings', settings: db.settings, activity: note, actor });
  return db.settings;
}

// Hand-off helper: empty every collection but keep settings (shop name, kiosk
// config) and the activity log so the next owner starts with a clean board.
export function clear(actor) {
  for (const c of collections) db[c.name] = [];
  const note = logActivity(actor, 'Cleared all records — database is empty');
  persistNow();
  emit({ type: 'reload', actor, activity: note });
  return db;
}

export function replaceAll(incoming, actor) {
  const next = { ...incoming };
  for (const c of collections) {
    if (!Array.isArray(next[c.name])) next[c.name] = [];
  }
  if (!Array.isArray(next.activity)) next.activity = [];
  if (!next.settings || typeof next.settings !== 'object') next.settings = { ...db.settings };
  next.meta = { ...(next.meta || {}), version: 1, restoredAt: new Date().toISOString() };
  db = next;
  logActivity(actor, 'Restored database from backup');
  persistNow();
  emit({ type: 'reload', activity: db.activity[0], actor });
  return db;
}

export function snapshot() {
  return {
    collections: Object.fromEntries(collections.map((c) => [c.name, db[c.name]])),
    settings: db.settings,
    activity: db.activity.slice(0, 50),
    meta: db.meta,
    serverTime: new Date().toISOString(),
  };
}
