// Small DOM + formatting helpers. The whole client is plain ES modules with no
// framework, so this is the "runtime" everything else builds on.

export function h(tag, attrs, ...children) {
  const node = document.createElement(tag);
  if (attrs) {
    for (const [key, value] of Object.entries(attrs)) {
      if (value === null || value === undefined || value === false) continue;
      if (key === 'class') node.className = value;
      else if (key === 'dataset') Object.assign(node.dataset, value);
      else if (key === 'style' && typeof value === 'object') Object.assign(node.style, value);
      else if (key === 'html') node.innerHTML = value;
      else if (key === 'value') node.value = value;
      else if (key === 'checked') node.checked = Boolean(value);
      else if (key.startsWith('on') && typeof value === 'function') {
        node.addEventListener(key.slice(2).toLowerCase(), value);
      } else if (value === true) node.setAttribute(key, '');
      else node.setAttribute(key, value);
    }
  }
  append(node, children);
  return node;
}

export function append(node, children) {
  for (const child of children.flat(Infinity)) {
    if (child === null || child === undefined || child === false || child === true) continue;
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return node;
}

export function clear(node) {
  node.replaceChildren();
  return node;
}

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

export function debounce(fn, ms = 200) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

export function uid() {
  return Math.random().toString(36).slice(2, 10);
}

// ---- formatting ----------------------------------------------------------
export function fmtDate(value) {
  if (!value) return '';
  const d = new Date(value + (value.length === 10 ? 'T00:00:00' : ''));
  if (Number.isNaN(d.getTime())) return String(value);
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

export function fmtDateShort(value) {
  if (!value) return '';
  const d = new Date(value + (value.length === 10 ? 'T00:00:00' : ''));
  if (Number.isNaN(d.getTime())) return String(value);
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export function relTime(iso) {
  if (!iso) return '';
  const then = new Date(iso).getTime();
  const diff = Date.now() - then;
  const abs = Math.abs(diff);
  const mins = Math.round(abs / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return `${days}d ago`;
}

export function dueLabel(days) {
  if (days === null || days === undefined) return { text: '', tone: '' };
  if (days < 0) return { text: `${Math.abs(days)}d overdue`, tone: 'bad' };
  if (days === 0) return { text: 'Due today', tone: 'warn' };
  if (days === 1) return { text: 'Due tomorrow', tone: 'warn' };
  if (days <= 7) return { text: `In ${days}d`, tone: 'info' };
  return { text: `In ${days}d`, tone: '' };
}

export function money(n) {
  if (n === null || n === undefined || n === '') return '';
  const value = Number(n);
  if (!Number.isFinite(value)) return String(n);
  return value.toLocaleString(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: 2 });
}

export function daysUntil(dateStr) {
  if (!dateStr) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const target = new Date(dateStr + 'T00:00:00');
  if (Number.isNaN(target.getTime())) return null;
  return Math.round((target - today) / 86400000);
}

export function todayIso() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// Next half-hour mark, used as the default time for new appointments.
export function nextHalfHour() {
  const d = new Date();
  d.setMinutes(d.getMinutes() + 30, 0, 0);
  const mins = d.getMinutes() - (d.getMinutes() % 30);
  d.setMinutes(mins);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

// "Mon, Oct 12" style header for board dates.
export function fmtDayLong(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr + 'T12:00:00');
  if (Number.isNaN(d.getTime())) return String(dateStr);
  return d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
}

// "Mon 12" style label for week-strip day cards.
export function fmtDayStrip(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr + 'T12:00:00');
  if (Number.isNaN(d.getTime())) return String(dateStr);
  return d.toLocaleDateString(undefined, { weekday: 'short' }) + ' ' + d.getDate();
}

// Monday-based start of the week containing `dateStr` (defaults to today).
export function weekStart(dateStr = todayIso()) {
  const d = new Date(dateStr + 'T12:00:00');
  if (Number.isNaN(d.getTime())) return todayIso();
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function shiftDays(dateStr, days) {
  const d = new Date(dateStr + 'T12:00:00');
  if (Number.isNaN(d.getTime())) return dateStr;
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// Where the wall-board (kiosk) page lives. Opened as a plain file it is the
// sibling display.html; when the server serves the app it is the /display route.
export function kioskUrl() {
  try {
    if (location.protocol === 'file:') return new URL('display.html', location.href).href;
    return location.origin + '/display';
  } catch {
    return 'display.html';
  }
}

export function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

export function sortItems(items, sort, getters = {}) {
  if (!sort || !sort.key) return items;
  const dir = sort.dir === 'desc' ? -1 : 1;
  const get = getters[sort.key];
  return [...items].sort((a, b) => {
    let av = get ? get(a) : a[sort.key];
    let bv = get ? get(b) : b[sort.key];
    if (av === null || av === undefined || av === '') av = dir === 1 ? '\uffff' : '';
    if (bv === null || bv === undefined || bv === '') bv = dir === 1 ? '\uffff' : '';
    if (typeof av === 'number' && typeof bv === 'number') return (av - bv) * dir;
    return String(av).localeCompare(String(bv), undefined, { numeric: true }) * dir;
  });
}

export function download(filename, text, mime = 'application/json') {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = h('a', { href: url, download: filename });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function escapeHtml(str) {
  return String(str ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
