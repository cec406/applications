// Application shell: navigation, hash routing, global search, theme, and the
// render loop that re-draws the active view whenever the store changes.
import { h, append, clear, debounce, fmtDateShort, relTime, daysUntil } from './util.js?v=20261012-3';
import { icon, brandMark } from './icons.js?v=20261012-3';
import { collections, collectionByName, computeFields } from '../../shared/schema.js?v=20261012-3';
import * as store from './store.js?v=20261012-3';
import { openForm, toast, statusChip } from './components.js?v=20261012-3';
import {
  overviewView, workordersView, collectionView, activityView, settingsView,
} from './views.js?v=20261012-3';

const NAV = [
  { id: 'overview', label: 'Overview', icon: 'dashboard' },
  { id: 'workorders', label: 'Work Orders', icon: 'clipboard' },
  { id: 'schedule', label: 'Schedule', icon: 'calendar' },
  { id: 'parts', label: 'Parts', icon: 'box' },
  { id: 'assets', label: 'Assets', icon: 'machine' },
  { id: 'people', label: 'People', icon: 'people' },
  { id: 'vendors', label: 'Vendors', icon: 'truck' },
  { id: 'resources', label: 'Resources', icon: 'folder' },
  { id: 'activity', label: 'Activity', icon: 'activity' },
  { id: 'settings', label: 'Settings', icon: 'settings' },
];

const CONTENT = document.getElementById('content');
const SIDEBAR = document.getElementById('sidebar');
const SEARCH_RESULTS = document.getElementById('search-results');

const ctx = {
  view: 'overview',
  ui: {},
  pendingFocus: null,
  rerender: () => render(),
  navigate,
  focusRecord,
};

let pendingRender = false;

function parseHash() {
  const raw = location.hash.replace(/^#\/?/, '');
  const [view, ...rest] = raw.split('/');
  return view || 'overview';
}

function navigate(view, opts = {}) {
  location.hash = `#/${view}`;
  if (opts.focus) pendingFocusSet = opts.focus;
  if (!location.hash.includes(view) || location.hash === `#/${view}`) render();
}

// focus request that survives until the next mount of that view
let pendingFocusSet = null;
function focusRecord(collection, id, mode) {
  const u = ctx.ui[collection] || (ctx.ui[collection] = {});
  if (mode) u.mode = mode;
  u.focus = id;
  pendingFocusSet = { collection, id };
  if (parseHash() === collection) render();
  else location.hash = `#/${collection}`;
}

function isEditing() {
  const el = document.activeElement;
  if (!el || !CONTENT.contains(el)) return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA' || el.isContentEditable;
}

function render() {
  if (isEditing()) {
    pendingRender = true;
    return;
  }
  pendingRender = false;
  const view = parseHash();
  ctx.view = view;

  let node;
  if (view === 'overview') node = overviewView(ctx);
  else if (view === 'workorders') node = workordersView(ctx);
  else if (view === 'activity') node = activityView(ctx);
  else if (view === 'settings') node = settingsView(ctx);
  else if (collectionByName[view]) node = collectionView(ctx, view);
  else node = h('div', { class: 'view' }, h('div', { class: 'panel' }, h('p', {}, 'Not found.')));

  clear(CONTENT);
  CONTENT.append(node);
  CONTENT.scrollTop = 0;
  updateNav(view);
  updateTopbar();
  applyPendingFocus();
}

function applyPendingFocus() {
  const target = pendingFocusSet || (ctx.ui[ctx.view]?.focus ? { collection: ctx.view, id: ctx.ui[ctx.view].focus } : null);
  if (!target) return;
  pendingFocusSet = null;
  requestAnimationFrame(() => {
    const el = CONTENT.querySelector(`[data-id="${target.id}"]`);
    if (el) {
      el.scrollIntoView({ block: 'center', behavior: 'smooth' });
      el.classList.add('flash');
      setTimeout(() => el.classList.remove('flash'), 1800);
    }
  });
}

function updateNav(active) {
  document.querySelectorAll('.nav-item').forEach((el) => {
    el.classList.toggle('active', el.dataset.nav === active);
  });
  document.getElementById('sidebar').classList.remove('open');
}

function updateTopbar() {
  const s = store.state.settings;
  document.getElementById('shop-name').textContent = s.shopName || 'Shopline';
  document.getElementById('shop-sub').textContent = s.shopSubtitle || '';

  const dot = document.getElementById('conn-dot');
  const label = document.getElementById('conn-label');
  if (store.state.mode === 'browser') {
    dot.className = 'dot ok';
    label.textContent = 'Demo';
    document.getElementById('last-sync').textContent = 'saved in this browser';
  } else if (store.state.connected) {
    dot.className = 'dot ok';
    label.textContent = 'Live';
    document.getElementById('last-sync').textContent = store.state.lastSync ? `synced ${relTime(store.state.lastSync.toISOString())}` : '';
  } else {
    dot.className = 'dot bad';
    label.textContent = 'Reconnecting…';
    document.getElementById('last-sync').textContent = '';
  }

  // Sidebar badges
  const wos = store.col('workorders').filter((w) => w.status !== 'Done');
  const overdue = wos.filter((w) => { const d = daysUntil(w.due); return d !== null && d < 0; }).length;
  setBadge('workorders', overdue || wos.length, overdue ? 'bad' : '');
  const low = store.col('parts').filter((p) => Number(p.qty) <= Number(p.minQty)).length;
  setBadge('parts', low, low ? 'warn' : '');
  const down = store.col('assets').filter((a) => a.status === 'Down').length;
  setBadge('assets', down, down ? 'bad' : '');
  const pmDue = store.col('schedule').filter((r) => { const d = daysUntil(computeFields('schedule', r).nextDue); return d !== null && d <= 3; }).length;
  setBadge('schedule', pmDue, pmDue ? 'warn' : '');
}

function setBadge(id, count, tone) {
  const item = document.querySelector(`.nav-item[data-nav="${id}"] .nav-badge`);
  if (!item) return;
  item.textContent = count ? String(count) : '';
  item.className = `nav-badge ${count ? tone : ''}`;
  item.style.display = count ? '' : 'none';
}

// ---- build chrome --------------------------------------------------------
function buildSidebar() {
  clear(SIDEBAR);
  const brand = h('div', { class: 'brand' },
    h('div', { class: 'brand-mark' }, icon('activity', 20)),
    h('div', {}, h('div', { class: 'brand-name' }, 'Shopline'), h('div', { class: 'brand-tag' }, 'Maintenance OS')),
  );
  SIDEBAR.append(brand);
  const nav = h('nav', { class: 'nav' });
  for (const item of NAV) {
    nav.append(h('a', {
      class: 'nav-item', href: `#/${item.id}`, dataset: { nav: item.id },
      onclick: () => { document.getElementById('sidebar').classList.remove('open'); },
    }, icon(item.icon, 18), h('span', {}, item.label), h('span', { class: 'nav-badge', style: { display: 'none' } })));
  }
  SIDEBAR.append(nav);
  SIDEBAR.append(h('div', { class: 'sidebar-foot' },
    h('div', { class: 'muted small' }, 'Shopline v1.0'),
    h('div', { class: 'muted small' }, 'Local · network-shared'),
  ));
}

function buildTopbar() {
  const topbar = document.getElementById('topbar');
  clear(topbar);

  const menuBtn = h('button', { class: 'icon-btn menu-btn', title: 'Menu', onclick: () => document.getElementById('sidebar').classList.toggle('open') }, icon('list', 20));

  const titleWrap = h('div', { class: 'topbar-title' },
    h('h1', { id: 'shop-name' }, 'Shopline'),
    h('p', { id: 'shop-sub' }, ''),
  );

  const searchInput = h('input', {
    class: 'input', type: 'search', placeholder: 'Search everything…', id: 'global-search',
    oninput: debounce((e) => runSearch(e.target.value), 160),
    onfocus: (e) => { if (e.target.value) runSearch(e.target.value); },
  });
  const searchWrap = h('div', { class: 'global-search' }, icon('search', 16), searchInput);
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.global-search')) clear(SEARCH_RESULTS);
  });

  const conn = h('div', { class: 'conn', title: 'Live sync status' },
    h('span', { class: 'dot', id: 'conn-dot' }),
    h('div', { class: 'conn-text' }, h('span', { id: 'conn-label' }, 'Connecting…'), h('span', { class: 'muted small', id: 'last-sync' }, '')),
  );

  const newBtn = h('button', { class: 'btn ghost', onclick: openNewMenu }, icon('plus', 16), 'New');
  const kioskBtn = h('button', { class: 'btn primary', onclick: () => window.open('display.html', '_blank') }, icon('monitor', 16), 'Kiosk');
  const themeBtn = h('button', { class: 'icon-btn', title: 'Toggle theme', onclick: () => toggleTheme(themeBtn) },
    icon(currentTheme() === 'light' ? 'sun' : 'moon', 18));

  topbar.append(menuBtn, titleWrap, h('div', { class: 'spacer' }), searchWrap, conn, newBtn, kioskBtn, themeBtn);
  topbar.append(SEARCH_RESULTS);
}

function openNewMenu() {
  clear(SEARCH_RESULTS);
  const menu = h('div', { class: 'popover' });
  for (const c of collections) {
    menu.append(h('button', { class: 'popover-item', onclick: () => { clear(SEARCH_RESULTS); openForm({ collection: c.name }); } },
      icon(c.icon, 16), `New ${c.singular}`));
  }
  SEARCH_RESULTS.append(menu);
}

// ---- global search -------------------------------------------------------
function runSearch(query) {
  const q = query.trim().toLowerCase();
  clear(SEARCH_RESULTS);
  if (q.length < 2) return;
  const results = [];
  for (const c of collections) {
    const meta = c;
    for (const record of store.col(c.name)) {
      const hay = [
        record[meta.primary],
        ...meta.fields.filter((f) => f.type === 'text' || f.type === 'textarea').map((f) => record[f.key]),
      ].filter(Boolean).join(' ').toLowerCase();
      if (hay.includes(q)) results.push({ collection: c.name, record, label: record[meta.primary] });
    }
  }
  const panel = h('div', { class: 'search-panel' });
  if (!results.length) panel.append(h('div', { class: 'search-empty' }, `No matches for "${query}"`));
  for (const r of results.slice(0, 12)) {
    const meta = collectionByName[r.collection];
    panel.append(h('button', { class: 'search-hit', onclick: () => {
      clear(SEARCH_RESULTS);
      document.getElementById('global-search').value = '';
      focusRecord(r.collection, r.record.id, r.record.status ? 'table' : undefined);
    } },
      icon(meta.icon, 16),
      h('span', { class: 'hit-label' }, r.label),
      h('span', { class: 'hit-type' }, meta.singular),
    ));
  }
  if (results.length > 12) panel.append(h('div', { class: 'search-empty' }, `+${results.length - 12} more…`));
  SEARCH_RESULTS.append(panel);
}

// ---- theme ---------------------------------------------------------------
function currentTheme() {
  return document.documentElement.dataset.theme === 'light' ? 'light' : 'dark';
}

function toggleTheme(button) {
  const next = currentTheme() === 'light' ? 'dark' : 'light';
  document.documentElement.dataset.theme = next;
  localStorage.setItem('shopline.theme', next);
  button?.replaceChildren(icon(next === 'light' ? 'sun' : 'moon', 18));
}

function initTheme() {
  const saved = localStorage.getItem('shopline.theme') || 'dark';
  document.documentElement.dataset.theme = saved;
}

// ---- welcome (demo mode) ---------------------------------------------------
// A one-time intro for people opening the dashboard as a demo / static site,
// so the first thing a visitor sees explains that everything is clickable.
function showWelcome() {
  const overlay = h('div', { class: 'overlay' });
  const close = () => {
    overlay.remove();
    document.removeEventListener('keydown', onKey);
  };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', onKey);

  const dialog = h('div', { class: 'dialog welcome-dialog', role: 'dialog', 'aria-modal': 'true' },
    h('div', { class: 'dialog-head' },
      h('div', { class: 'welcome-mark' }, brandMark(44)),
      h('div', {},
        h('h3', {}, store.state.settings.shopName || 'Shopline'),
        h('div', { class: 'muted' }, store.state.settings.brandTagline || 'Live maintenance operations dashboard'),
      ),
    ),
    h('div', { class: 'dialog-body welcome-body' },
      h('p', {}, 'This is a fully interactive demo — everything is clickable, and your changes are saved right in this browser.'),
      h('ul', { class: 'welcome-list' },
        h('li', {}, h('b', {}, 'Edit anything'), ' — click a table cell to change it, drag work orders across the board, or open a full record form.'),
        h('li', {}, h('b', {}, 'Watch the wall board'), ' — the Kiosk button opens a TV view that rotates through the shop’s live status.'),
        h('li', {}, h('b', {}, 'Reset any time'), ' — Settings → Reset demo data puts the sample shop back.'),
      ),
    ),
    h('div', { class: 'dialog-foot' },
      h('span', { class: 'muted small' }, 'Run your own shop with it: node server.js'),
      h('span', { class: 'spacer' }),
      h('button', { class: 'btn primary', onclick: close }, 'Start exploring'),
    ),
  );
  overlay.append(dialog);
  overlay.addEventListener('mousedown', (e) => { if (e.target === overlay) close(); });
  document.body.append(overlay);
}

function maybeShowWelcome() {
  if (store.state.mode !== 'browser') return;
  if (store.state.settings.showWelcome === false) return;
  let seen = '';
  try { seen = localStorage.getItem('shopline.welcomeSeen') || ''; } catch { /* blocked */ }
  if (seen) return;
  try { localStorage.setItem('shopline.welcomeSeen', new Date().toISOString()); } catch { /* blocked */ }
  showWelcome();
}

// ---- boot ----------------------------------------------------------------
function installErrorReporting() {
  window.__shoplineErrors = window.__shoplineErrors || [];
  window.addEventListener('error', (e) => {
    window.__shoplineErrors.push(String(e.error?.stack || e.message));
    console.error('[shopline]', e.error || e.message);
  });
  window.addEventListener('unhandledrejection', (e) => {
    window.__shoplineErrors.push('unhandled: ' + String(e.reason?.stack || e.reason));
    console.error('[shopline] unhandled rejection', e.reason);
  });
}

async function boot() {
  installErrorReporting();
  initTheme();
  buildSidebar();
  buildTopbar();

  store.subscribe(() => {
    updateTopbar();
    render();
  });

  window.addEventListener('hashchange', render);
  document.addEventListener('focusout', () => {
    setTimeout(() => {
      if (pendingRender && !isEditing()) render();
    }, 30);
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === '/' && !isEditing()) { e.preventDefault(); document.getElementById('global-search')?.focus(); }
  });

  try {
    await store.load();
    store.connect();
  } catch (err) {
    CONTENT.append(h('div', { class: 'panel' }, h('p', {}, 'Could not reach the server: ' + err.message)));
  }
  render();
  maybeShowWelcome();
}

boot();
