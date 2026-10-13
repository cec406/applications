// Single source of truth for the data model.
// Imported by the Node server (for validation + type coercion) and by the
// browser client (for rendering tables, forms and boards).
//
// The shop runs on four core collections:
//   appointments - scheduled drop-offs / pickups, by unit + equipment type
//   units        - the roster of units that visit the shop (with POCs)
//   weapons      - arms-room inventory, counted by weapon type
//   notes        - the shop notes board
// plus `eqtypes`, the equipment-type dictionary used for suggestions.

export const TYPES = {
  TEXT: 'text',
  TEXTAREA: 'textarea',
  NUMBER: 'number',
  CURRENCY: 'currency',
  DATE: 'date',
  TIME: 'time',
  SELECT: 'select',
  REF: 'ref', // reference to another collection
  BOOL: 'bool',
  URL: 'url',
  EMAIL: 'email',
  TEL: 'tel',
  ITEMS: 'items', // nested list of equipment lines on an appointment
};

// Flow of goods: a unit brings equipment IN (drop-off) or collects it back
// (pickup). Life-cycle of an appointment on the board.
export const DIRECTIONS = ['Drop-off', 'Pickup'];
export const STATUSES = ['Scheduled', 'Arrived', 'Completed', 'No-show', 'Cancelled'];

// A small palette used for status/direction chips in the UI.
export const COLORS = {
  // appointment status
  Scheduled: '#0ea5e9',
  Arrived: '#f59e0b',
  Completed: '#22c55e',
  'No-show': '#ef4444',
  Cancelled: '#64748b',
  // flow direction
  'Drop-off': '#22c55e',
  Pickup: '#ef4444',
};

export const collections = [
  {
    name: 'appointments',
    label: 'Appointments',
    singular: 'Appointment',
    icon: 'calendar',
    primary: 'unitId',
    titleOf: (r) => {
      const when = [r.date, r.time].filter(Boolean).join(' ');
      return `${when} · ${r.unitName || 'Unit'} · ${r.direction || ''}`.trim();
    },
    defaultSort: { key: 'date', dir: 'asc' },
    statusKey: 'status',
    cardBits: [
      { key: 'direction', chip: true },
      { key: 'time', icon: 'clock' },
      { key: 'items', items: true },
    ],
    fields: [
      { key: 'date', label: 'Date', type: TYPES.DATE, required: true, showDue: true },
      { key: 'time', label: 'Time', type: TYPES.TIME, default: '09:00', tbd: true },
      { key: 'unitId', label: 'Unit', type: TYPES.REF, ref: 'units', refLabel: 'name', required: true, resolveByName: true, input: 'text', placeholder: 'Type a unit (e.g. A/2-1 IN) — new units are created automatically', width: 'wide' },
      { key: 'direction', label: 'Flow', type: TYPES.SELECT, options: DIRECTIONS, default: 'Drop-off' },
      { key: 'status', label: 'Status', type: TYPES.SELECT, options: STATUSES, default: 'Scheduled' },
      { key: 'items', label: 'Equipment', type: TYPES.ITEMS },
      { key: 'poc', label: 'POC (optional)', type: TYPES.TEXT, table: false },
      { key: 'notes', label: 'Notes', type: TYPES.TEXTAREA, table: false },
    ],
  },
  {
    name: 'units',
    label: 'Units',
    singular: 'Unit',
    icon: 'people',
    primary: 'name',
    defaultSort: { key: 'name', dir: 'asc' },
    fields: [
      { key: 'name', label: 'Unit', type: TYPES.TEXT, required: true, width: 'wide' },
      { key: 'poc', label: 'POC', type: TYPES.TEXT },
      { key: 'phone', label: 'Phone', type: TYPES.TEL },
      { key: 'notes', label: 'Notes', type: TYPES.TEXTAREA, table: false },
    ],
  },
  {
    name: 'weapons',
    label: 'Weapons',
    singular: 'Weapon',
    icon: 'target',
    primary: 'name',
    defaultSort: { key: 'name', dir: 'asc' },
    fields: [
      { key: 'name', label: 'Weapon Type', type: TYPES.TEXT, required: true, width: 'wide' },
      { key: 'count', label: 'On Hand', type: TYPES.NUMBER, step: 1, default: 0 },
      { key: 'notes', label: 'Notes', type: TYPES.TEXTAREA, table: false },
    ],
  },
  {
    name: 'notes',
    label: 'Shop Notes',
    singular: 'Note',
    icon: 'note',
    primary: 'message',
    defaultSort: { key: 'createdAt', dir: 'desc' },
    fields: [
      { key: 'message', label: 'Message', type: TYPES.TEXTAREA, required: true, width: 'wide' },
    ],
  },
  {
    name: 'eqtypes',
    label: 'Equipment Types',
    singular: 'Equipment Type',
    icon: 'tag',
    primary: 'name',
    defaultSort: { key: 'name', dir: 'asc' },
    fields: [
      { key: 'name', label: 'Type', type: TYPES.TEXT, required: true, width: 'wide' },
    ],
  },
];

export const collectionByName = Object.fromEntries(collections.map((c) => [c.name, c]));

// Which fields get type-coerced on the server before persisting.
export function coerceValue(field, value) {
  if (value === null || value === undefined || value === '') {
    if (field.type === TYPES.NUMBER || field.type === TYPES.CURRENCY) return null;
    if (field.type === TYPES.BOOL) return false;
    if (field.type === TYPES.ITEMS) return [];
    return value === undefined ? '' : value;
  }
  switch (field.type) {
    case TYPES.NUMBER:
    case TYPES.CURRENCY: {
      const n = Number(value);
      return Number.isFinite(n) ? n : null;
    }
    case TYPES.BOOL:
      return value === true || value === 'true' || value === 1 || value === '1';
    case TYPES.ITEMS:
      return normalizeItems(value);
    default:
      return String(value);
  }
}

// Equipment lines on an appointment: [{ eqType, qty, description }].
export function normalizeItems(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map((raw) => {
      if (raw === null || raw === undefined) return null;
      if (typeof raw === 'string') return { eqType: raw.trim(), qty: 1, description: '' };
      const qty = Math.max(1, Math.min(9999, Math.round(Number(raw.qty) || 1)));
      return {
        eqType: String(raw.eqType ?? '').trim(),
        qty,
        description: String(raw.description ?? '').trim(),
      };
    })
    .filter((it) => it && (it.eqType || it.description))
    .slice(0, 50);
}

// Human summary of an item list, e.g. "2× Generator · 1× Radio ASIP".
export function itemSummary(items) {
  return normalizeItems(items)
    .map((it) => {
      const desc = it.description ? ` — ${it.description}` : '';
      return `${it.qty}× ${it.eqType || 'Equipment'}${desc}`;
    })
    .join(' · ');
}

export function titleOf(collectionName, record) {
  const meta = collectionByName[collectionName];
  if (!meta) return record?.id || '';
  if (meta.titleOf) return meta.titleOf(record);
  return record[meta.primary] || record.name || record.message || record.id;
}

// Appointment helpers -------------------------------------------------------

// The appointment's unit name, resolved through the units collection.
export function unitNameOf(record, units = []) {
  if (record.unitName) return record.unitName;
  const unit = units.find((u) => u.id === record.unitId);
  return unit ? unit.name : '';
}

// Is a scheduled appointment past due? (date/time in the past, still "Scheduled")
export function isApptOverdue(record, now = new Date()) {
  if (record.status !== 'Scheduled' || !record.date) return false;
  const p2 = (n) => String(n).padStart(2, '0');
  const nowKey = `${now.getFullYear()}-${p2(now.getMonth() + 1)}-${p2(now.getDate())} ${p2(now.getHours())}:${p2(now.getMinutes())}`;
  const key = `${record.date} ${record.time || '23:59'}`;
  return key < nowKey;
}

// Compute the derived fields (used by the client and available to the server).
export function computeFields(collectionName, item) {
  const out = {};
  if (collectionName === 'appointments') {
    out.totalQty = normalizeItems(item.items).reduce((n, it) => n + it.qty, 0);
    out.itemCount = normalizeItems(item.items).length;
    out.overdue = isApptOverdue(item);
  }
  return out;
}

export const settingsSchema = [
  { key: 'shopName', label: 'Shop name', type: TYPES.TEXT, default: 'Shop Ops' },
  { key: 'shopSubtitle', label: 'Shop subtitle / location', type: TYPES.TEXT, default: 'Drop-off & Pickup · Arms Room · Shop Notes' },
  { key: 'rotateSeconds', label: 'Wall board rotation (seconds)', type: TYPES.NUMBER, default: 14 },
  { key: 'kioskViews', label: 'Wall board views', type: TYPES.TEXT, default: 'board,schedule,weapons,notes' },
];

export const KIOSK_VIEWS = {
  board: 'Drop-offs & Pickups',
  schedule: 'Schedule (7 days)',
  weapons: 'Weapons on Hand',
  notes: 'Shop Notes',
  overview: 'Shop Overview',
};

export const defaultSettings = Object.fromEntries(
  settingsSchema.map((s) => [s.key, s.default]),
);
