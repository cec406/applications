// Single source of truth for the data model.
// Imported by the Node server (for validation + type coercion) and by the
// browser client (for rendering tables, forms and boards).

export const TYPES = {
  TEXT: 'text',
  TEXTAREA: 'textarea',
  NUMBER: 'number',
  CURRENCY: 'currency',
  DATE: 'date',
  SELECT: 'select',
  REF: 'ref', // reference to another collection
  BOOL: 'bool',
  URL: 'url',
  EMAIL: 'email',
  TEL: 'tel',
};

const PRIORITY = ['Low', 'Normal', 'High', 'Urgent'];
const WO_STATUS = ['Backlog', 'Scheduled', 'In Progress', 'Waiting Parts', 'Done'];

// A small palette used for status/priority chips in the UI.
export const COLORS = {
  Backlog: '#64748b',
  Scheduled: '#0ea5e9',
  'In Progress': '#f59e0b',
  'Waiting Parts': '#a855f7',
  Done: '#22c55e',
  Low: '#64748b',
  Normal: '#0ea5e9',
  High: '#f59e0b',
  Urgent: '#ef4444',
};

export const collections = [
  {
    name: 'workorders',
    label: 'Work Orders',
    singular: 'Work Order',
    icon: 'clipboard',
    primary: 'title',
    defaultSort: { key: 'due', dir: 'asc' },
    statusKey: 'status',
    fields: [
      { key: 'title', label: 'Title', type: TYPES.TEXT, required: true, width: 'wide' },
      { key: 'status', label: 'Status', type: TYPES.SELECT, options: WO_STATUS, default: 'Backlog' },
      { key: 'priority', label: 'Priority', type: TYPES.SELECT, options: PRIORITY, default: 'Normal' },
      { key: 'assetId', label: 'Asset', type: TYPES.REF, ref: 'assets', refLabel: 'name' },
      { key: 'assigneeId', label: 'Assigned To', type: TYPES.REF, ref: 'people', refLabel: 'name' },
      { key: 'type', label: 'Type', type: TYPES.SELECT, options: ['Corrective', 'Preventive', 'Inspection', 'Project', 'Safety'], default: 'Corrective' },
      { key: 'due', label: 'Due', type: TYPES.DATE },
      { key: 'estHours', label: 'Est. Hours', type: TYPES.NUMBER, step: 0.25 },
      { key: 'description', label: 'Description', type: TYPES.TEXTAREA, table: false },
    ],
  },
  {
    name: 'assets',
    label: 'Assets',
    singular: 'Asset',
    icon: 'machine',
    primary: 'name',
    defaultSort: { key: 'name', dir: 'asc' },
    statusKey: 'status',
    fields: [
      { key: 'name', label: 'Asset', type: TYPES.TEXT, required: true, width: 'wide' },
      { key: 'status', label: 'Status', type: TYPES.SELECT, options: ['Running', 'Down', 'Maintenance', 'Retired'], default: 'Running' },
      { key: 'workflowStatus', label: 'Workflow Status', type: TYPES.SELECT, options: ['Pending Triage', 'In Shop', 'Ready for Pickup', 'Completed'], default: 'Pending Triage' },
      { key: 'category', label: 'Category', type: TYPES.SELECT, options: ['Excavator', 'Loader', 'Dozer', 'Haul Truck', 'Lift', 'Service Truck', 'Power & Air', 'Facility', 'Other'], default: 'Other' },
      { key: 'criticality', label: 'Criticality', type: TYPES.SELECT, options: ['Low', 'Medium', 'High'], default: 'Medium' },
      { key: 'location', label: 'Location', type: TYPES.TEXT },
      { key: 'manufacturer', label: 'Make', type: TYPES.TEXT },
      { key: 'model', label: 'Model', type: TYPES.TEXT },
      { key: 'serial', label: 'Serial #', type: TYPES.TEXT },
      { key: 'installedOn', label: 'Installed', type: TYPES.DATE, table: false },
      { key: 'notes', label: 'Notes', type: TYPES.TEXTAREA, table: false },
    ],
  },
  {
    name: 'schedule',
    label: 'Maintenance Schedule',
    singular: 'Scheduled Task',
    icon: 'calendar',
    primary: 'task',
    defaultSort: { key: 'nextDue', dir: 'asc' },
    fields: [
      { key: 'task', label: 'Task', type: TYPES.TEXT, required: true, width: 'wide' },
      { key: 'nextDue', label: 'Next Due', type: 'computed' },
      { key: 'assetId', label: 'Asset', type: TYPES.REF, ref: 'assets', refLabel: 'name' },
      { key: 'frequencyDays', label: 'Every (days)', type: TYPES.NUMBER, step: 1, default: 30 },
      { key: 'lastDone', label: 'Last Done', type: TYPES.DATE },
      { key: 'assigneeId', label: 'Assigned To', type: TYPES.REF, ref: 'people', refLabel: 'name' },
      { key: 'priority', label: 'Priority', type: TYPES.SELECT, options: PRIORITY, default: 'Normal' },
      { key: 'notes', label: 'Notes', type: TYPES.TEXTAREA, table: false },
    ],
  },
  {
    name: 'parts',
    label: 'Parts & Inventory',
    singular: 'Part',
    icon: 'box',
    primary: 'name',
    defaultSort: { key: 'name', dir: 'asc' },
    fields: [
      { key: 'name', label: 'Part', type: TYPES.TEXT, required: true, width: 'wide' },
      { key: 'sku', label: 'SKU', type: TYPES.TEXT },
      { key: 'qty', label: 'Qty On Hand', type: TYPES.NUMBER, step: 1, default: 0 },
      { key: 'minQty', label: 'Min Qty', type: TYPES.NUMBER, step: 1, default: 0 },
      { key: 'unit', label: 'Unit', type: TYPES.SELECT, options: ['ea', 'ft', 'm', 'lb', 'kg', 'L', 'gal', 'box', 'roll'], default: 'ea' },
      { key: 'location', label: 'Bin / Location', type: TYPES.TEXT },
      { key: 'vendorId', label: 'Vendor', type: TYPES.REF, ref: 'vendors', refLabel: 'name' },
      { key: 'cost', label: 'Unit Cost', type: TYPES.CURRENCY },
      { key: 'category', label: 'Category', type: TYPES.TEXT, table: false },
      { key: 'notes', label: 'Notes', type: TYPES.TEXTAREA, table: false },
    ],
  },
  {
    name: 'people',
    label: 'People',
    singular: 'Person',
    icon: 'people',
    primary: 'name',
    defaultSort: { key: 'name', dir: 'asc' },
    fields: [
      { key: 'name', label: 'Name', type: TYPES.TEXT, required: true, width: 'wide' },
      { key: 'role', label: 'Role', type: TYPES.TEXT },
      { key: 'shift', label: 'Shift', type: TYPES.SELECT, options: ['Day', 'Swing', 'Night', 'On-call'], default: 'Day' },
      { key: 'status', label: 'Status', type: TYPES.SELECT, options: ['Available', 'On Job', 'Off'], default: 'Available' },
      { key: 'phone', label: 'Phone', type: TYPES.TEL },
      { key: 'email', label: 'Email', type: TYPES.EMAIL, table: false },
    ],
  },
  {
    name: 'vendors',
    label: 'Vendors',
    singular: 'Vendor',
    icon: 'truck',
    primary: 'name',
    defaultSort: { key: 'name', dir: 'asc' },
    fields: [
      { key: 'name', label: 'Vendor', type: TYPES.TEXT, required: true, width: 'wide' },
      { key: 'category', label: 'Supplies', type: TYPES.TEXT },
      { key: 'contact', label: 'Contact', type: TYPES.TEXT },
      { key: 'phone', label: 'Phone', type: TYPES.TEL },
      { key: 'email', label: 'Email', type: TYPES.EMAIL, table: false },
      { key: 'leadTimeDays', label: 'Lead Time (days)', type: TYPES.NUMBER, step: 1 },
      { key: 'notes', label: 'Notes', type: TYPES.TEXTAREA, table: false },
    ],
  },
  {
    name: 'resources',
    label: 'Shared Resources',
    singular: 'Resource',
    icon: 'folder',
    primary: 'title',
    defaultSort: { key: 'title', dir: 'asc' },
    fields: [
      { key: 'title', label: 'Title', type: TYPES.TEXT, required: true, width: 'wide' },
      { key: 'type', label: 'Type', type: TYPES.SELECT, options: ['Manual', 'SOP', 'Document', 'Drawing', 'Video', 'Folder', 'Link', 'Network Share'], default: 'Document' },
      { key: 'url', label: 'Path / URL', type: TYPES.URL, width: 'wide' },
      { key: 'category', label: 'Category', type: TYPES.TEXT },
      { key: 'owner', label: 'Owner / Dept', type: TYPES.TEXT },
      { key: 'notes', label: 'Notes', type: TYPES.TEXTAREA, table: false },
    ],
  },
];

export const collectionByName = Object.fromEntries(collections.map((c) => [c.name, c]));

// Which fields get type-coerced on the server before persisting.
export function coerceValue(field, value) {
  if (value === null || value === undefined || value === '') {
    if (field.type === TYPES.NUMBER || field.type === TYPES.CURRENCY) return null;
    if (field.type === TYPES.BOOL) return false;
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
    default:
      return String(value);
  }
}

// Compute the derived fields (used by the client and available to the server).
export function computeFields(collectionName, item) {
  const out = {};
  if (collectionName === 'schedule') {
    const freq = Number(item.frequencyDays) || 0;
    if (item.lastDone && freq > 0) {
      const d = new Date(item.lastDone + 'T00:00:00');
      d.setDate(d.getDate() + freq);
      out.nextDue = d.toISOString().slice(0, 10);
    } else {
      out.nextDue = item.lastDone || '';
    }
    out.daysUntilDue = out.nextDue ? daysUntil(out.nextDue) : null;
  }
  return out;
}

export function daysUntil(dateStr) {
  if (!dateStr) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const target = new Date(dateStr + 'T00:00:00');
  if (Number.isNaN(target.getTime())) return null;
  return Math.round((target - today) / 86400000);
}

export function isOverdue(item) {
  const d = daysUntil(item.due ?? item.nextDue);
  return d !== null && d < 0 && !isClosed(item);
}

export function isClosed(item) {
  return item.status === 'Done' || item.status === 'Retired';
}

export const settingsSchema = [
  { key: 'shopName', label: 'Shop name', type: TYPES.TEXT, default: 'Montana Fleet Solutions LLC' },
  { key: 'shopSubtitle', label: 'Shop subtitle / location', type: TYPES.TEXT, default: 'Construction Equipment Fleet Service' },
  { key: 'shiftPattern', label: 'Shift pattern', type: TYPES.TEXT, default: 'Day 6a-2p · Swing 2p-10p · On-call weekends' },
  { key: 'brandName', label: 'Company / brand name', type: TYPES.TEXT, default: 'Montana Fleet Solutions LLC' },
  { key: 'brandTagline', label: 'Brand tagline', type: TYPES.TEXT, default: 'Heavy equipment fleet maintenance & repair' },
  { key: 'brandUrl', label: 'Company website URL', type: TYPES.TEXT, default: '' },
  { key: 'showWelcome', label: 'Show intro on first visit', type: TYPES.BOOL, default: true },
  { key: 'lowStockAlerts', label: 'Highlight low-stock parts', type: TYPES.BOOL, default: true },
  { key: 'staleDays', label: 'Flag work orders idle after (days)', type: TYPES.NUMBER, default: 7 },
  { key: 'rotateSeconds', label: 'Wall board rotation (seconds)', type: TYPES.NUMBER, default: 14 },
  { key: 'kioskViews', label: 'Wall board views', type: TYPES.TEXT, default: 'overview,workorders,schedule,parts,assets,about' },
];

export const KIOSK_VIEWS = {
  overview: 'Shop Overview',
  workorders: 'Work Order Board',
  schedule: 'Preventive Maintenance',
  parts: 'Parts & Stock Alerts',
  assets: 'Asset Status',
  about: 'About This Demo',
};

export const defaultSettings = Object.fromEntries(
  settingsSchema.map((s) => [s.key, s.default]),
);
