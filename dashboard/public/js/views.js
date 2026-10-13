// All application views. Each returns a DOM node; app.js decides which to mount.
import { h, append, clear, sortItems, fmtDate, fmtDateShort, daysUntil, relTime, debounce, todayIso, download } from './util.js?v=20261012-3';
import { icon } from './icons.js?v=20261012-3';
import {
  collections, collectionByName, settingsSchema, computeFields, COLORS, TYPES,
} from '../../shared/schema.js?v=20261012-3';
import * as store from './store.js?v=20261012-3';
import { getActor, setActor } from './api.js?v=20261012-3';
import {
  chip, statusChip, dueBadge, dataTable, workBoard, openForm, iconButton,
  sectionHeader, activityList, kpi, barChart, confirmDialog, toast, displayValue, fieldControl,
} from './components.js?v=20261012-3';

// ---- shared helpers ------------------------------------------------------
function ui(ctx, key, defaults) {
  if (!ctx.ui[key]) ctx.ui[key] = { ...defaults };
  return ctx.ui[key];
}

function matchesSearch(record, meta, query) {
  if (!query) return true;
  const q = query.toLowerCase();
  for (const field of meta.fields) {
    const value = record[field.key];
    if (value === null || value === undefined) continue;
    if (String(value).toLowerCase().includes(q)) return true;
    if (field.type === TYPES.REF) {
      const label = store.label(field.ref, value);
      if (label && label.toLowerCase().includes(q)) return true;
    }
  }
  return false;
}

function toolbar(ctx, key, { searchPlaceholder, filters = [], right = [] }) {
  const u = ctx.ui[key] || (ctx.ui[key] = {});
  const search = h('input', {
    class: 'input search-input',
    type: 'search',
    placeholder: searchPlaceholder,
    value: u.search || '',
    oninput: debounce((e) => { u.search = e.target.value; ctx.rerender(); }, 180),
  });
  const bar = h('div', { class: 'toolbar' },
    h('div', { class: 'toolbar-left' }, h('span', { class: 'search-wrap' }, icon('search', 16), search)),
  );
  for (const filter of filters) {
    const select = h('select', {
      class: 'input compact',
      onchange: (e) => { u[filter.key] = e.target.value; ctx.rerender(); },
    });
    select.append(h('option', { value: '' }, filter.label));
    for (const opt of filter.options) {
      select.append(h('option', { value: opt.value, selected: u[filter.key] === opt.value }, opt.label));
    }
    bar.append(select);
  }
  if (right.length) bar.append(h('div', { class: 'toolbar-right' }, right));
  return bar;
}

function addButton(collection) {
  const meta = collectionByName[collection];
  return h('button', { class: 'btn primary', onclick: () => openForm({ collection }) },
    icon('plus', 16), `Add ${meta.singular}`);
}

// ---- Overview ------------------------------------------------------------
export function overviewView(ctx) {
  const wos = store.col('workorders');
  const schedule = store.col('schedule').map((r) => ({ ...r, ...computeFields('schedule', r) }));
  const parts = store.col('parts');
  const assets = store.col('assets');
  const people = store.col('people');

  const openWos = wos.filter((w) => w.status !== 'Done');
  const overdueWos = openWos.filter((w) => { const d = daysUntil(w.due); return d !== null && d < 0; });
  const dueSoonWos = openWos.filter((w) => { const d = daysUntil(w.due); return d !== null && d >= 0 && d <= 7; });
  const lowParts = parts.filter((p) => Number(p.qty) <= Number(p.minQty));
  const downAssets = assets.filter((a) => a.status === 'Down' || a.status === 'Maintenance');
  const staleDays = Number(store.state.settings.staleDays) || 7;
  const idleWos = openWos.filter((w) => idleDays(w) > staleDays);
  const overduePm = schedule.filter((s) => { const d = daysUntil(s.nextDue); return d !== null && d < 0; });
  const dueWeekPm = schedule.filter((s) => { const d = daysUntil(s.nextDue); return d !== null && d >= 0 && d <= 7; });

  const root = h('div', { class: 'view overview' });

  const kpis = h('div', { class: 'kpi-row' },
    kpi('Open Work Orders', openWos.length, 'accent', `${dueSoonWos.length} due this week`),
    kpi('Overdue', overdueWos.length + overduePm.length, overdueWos.length + overduePm.length ? 'bad' : '', 'work orders + PM'),
    kpi('PM Due (7d)', dueWeekPm.length, dueWeekPm.length ? 'warn' : '', `${schedule.length} scheduled total`),
    kpi('Low Stock', lowParts.length, lowParts.length ? 'warn' : '', `${parts.length} SKUs tracked`),
    kpi('Assets Attention', downAssets.length, downAssets.length ? 'bad' : '', `${assets.length} registered`),
    kpi('On Shift', people.filter((p) => p.status !== 'Off').length, '', `${people.length} crew`),
  );
  root.append(kpis);

  const grid = h('div', { class: 'grid-2' });

  // Attention needed
  const attention = h('div', { class: 'panel' });
  attention.append(h('div', { class: 'panel-head' }, icon('alert', 17), h('h3', {}, 'Attention Needed')));
  const attList = h('ul', { class: 'list' });
  const push = (tone, text, sub, onClick) => attList.append(h('li', { class: `list-item ${tone}`, onclick: onClick },
    h('span', { class: `pulse ${tone}` }),
    h('div', { class: 'li-body' }, h('div', { class: 'li-title' }, text), sub ? h('div', { class: 'muted small' }, sub) : null),
    onClick ? icon('chevron', 16) : null,
  ));
  for (const w of overdueWos.slice(0, 6)) push('bad', w.title, `${w.priority} · ${absDays(w.due)} overdue · ${w.status}`, () => ctx.focusRecord('workorders', w.id, 'board'));
  for (const w of idleWos.slice(0, 4)) push('warn', w.title, `${w.status} · idle ${idleDays(w)}d`, () => ctx.focusRecord('workorders', w.id, 'board'));
  for (const s of overduePm.slice(0, 5)) push('bad', s.task, `${absDays(s.nextDue)} overdue PM${s.assetId ? ' · ' + store.label('assets', s.assetId) : ''}`, () => ctx.focusRecord('schedule', s.id, 'table'));
  for (const p of lowParts.slice(0, 6)) push('warn', p.name, `${p.qty} ${p.unit} on hand · min ${p.minQty}${p.location ? ' · ' + p.location : ''}`, () => ctx.focusRecord('parts', p.id, 'table'));
  for (const a of downAssets.slice(0, 5)) push('warn', a.name, `${a.status} · ${a.category}${a.location ? ' · ' + a.location : ''}`, () => ctx.focusRecord('assets', a.id, 'table'));
  if (!attList.children.length) attList.append(h('li', { class: 'list-item empty-ok' }, icon('check', 16), h('div', {}, 'All clear — nothing needs attention.')));
  attention.append(attList);
  grid.append(attention);

  // Upcoming
  const upcoming = h('div', { class: 'panel' });
  upcoming.append(h('div', { class: 'panel-head' }, icon('calendar', 17), h('h3', {}, 'Upcoming (14 days)')));
  const upList = h('ul', { class: 'list' });
  const events = [
    ...openWos.filter((w) => { const d = daysUntil(w.due); return d !== null && d >= 0 && d <= 14; }).map((w) => ({ date: w.due, label: w.title, kind: 'WO', tone: w.priority === 'Urgent' || w.priority === 'High' ? 'warn' : '', onClick: () => ctx.focusRecord('workorders', w.id, 'board') })),
    ...schedule.filter((s) => { const d = daysUntil(s.nextDue); return d !== null && d >= 0 && d <= 14; }).map((s) => ({ date: s.nextDue, label: s.task, kind: 'PM', tone: '', onClick: () => ctx.focusRecord('schedule', s.id, 'table') })),
  ].sort((a, b) => String(a.date).localeCompare(String(b.date)));
  for (const e of events.slice(0, 12)) {
    upList.append(h('li', { class: `list-item ${e.tone}`, onclick: e.onClick },
      h('span', { class: `tag ${e.kind === 'PM' ? 'pm' : 'wo'}` }, e.kind),
      h('div', { class: 'li-body' }, h('div', { class: 'li-title' }, e.label), h('div', { class: 'muted small' }, fmtDateShort(e.date))),
      dueBadge(daysUntil(e.date)),
    ));
  }
  if (!upList.children.length) upList.append(h('li', { class: 'list-item' }, h('div', { class: 'muted' }, 'Nothing scheduled in the next two weeks.')));
  upcoming.append(upList);
  grid.append(upcoming);

  // Charts
  const charts = h('div', { class: 'panel' });
  charts.append(h('div', { class: 'panel-head' }, icon('activity', 17), h('h3', {}, 'Work Orders by Status')));
  const statusEntries = ['Backlog', 'Scheduled', 'In Progress', 'Waiting Parts', 'Done'].map((s) => ({
    label: s, value: wos.filter((w) => w.status === s).length, color: COLORS[s],
  }));
  charts.append(barChart(statusEntries));
  grid.append(charts);

  // Activity
  const activity = h('div', { class: 'panel' });
  activity.append(h('div', { class: 'panel-head' }, icon('clock', 17), h('h3', {}, 'Recent Activity'), h('span', { class: 'spacer' }), h('span', { class: 'muted small' }, `${store.state.clients} screen${store.state.clients === 1 ? '' : 's'} connected`)));
  activity.append(activityList(store.state.activity, 10));
  grid.append(activity);

  root.append(grid);
  return root;
}

function absDays(dateStr) {
  const d = daysUntil(dateStr);
  if (d === null) return '';
  const n = Math.abs(d);
  return `${n} day${n === 1 ? '' : 's'}`;
}

function idleDays(record) {
  if (!record.updatedAt) return 0;
  return Math.floor((Date.now() - new Date(record.updatedAt).getTime()) / 86400000);
}

// ---- Work orders ---------------------------------------------------------
export function workordersView(ctx) {
  const u = ui(ctx, 'workorders', { mode: 'board', search: '', status: '', priority: '', assignee: '' });
  const meta = collectionByName.workorders;
  const root = h('div', { class: 'view' });
  root.append(sectionHeader('Work Orders', `${store.col('workorders').length} total`,
    h('div', { class: 'segmented' },
      h('button', { class: `seg ${u.mode === 'board' ? 'active' : ''}`, onclick: () => { u.mode = 'board'; ctx.rerender(); } }, icon('grid', 15), 'Board'),
      h('button', { class: `seg ${u.mode === 'table' ? 'active' : ''}`, onclick: () => { u.mode = 'table'; ctx.rerender(); } }, icon('list', 15), 'Table'),
    ),
    addButton('workorders'),
  ));

  root.append(toolbar(ctx, 'workorders', {
    searchPlaceholder: 'Search work orders…',
    filters: [
      { key: 'status', label: 'All statuses', options: meta.fields.find((f) => f.key === 'status').options.map((v) => ({ value: v, label: v })) },
      { key: 'priority', label: 'All priorities', options: meta.fields.find((f) => f.key === 'priority').options.map((v) => ({ value: v, label: v })) },
      { key: 'assignee', label: 'All people', options: store.options('people') },
    ],
  }));

  let items = store.col('workorders').filter((r) => matchesSearch(r, meta, u.search));
  if (u.status) items = items.filter((r) => r.status === u.status);
  if (u.priority) items = items.filter((r) => r.priority === u.priority);
  if (u.assignee) items = items.filter((r) => r.assigneeId === u.assignee);

  const body = h('div', { class: 'view-body' });
  if (u.mode === 'board') {
    body.append(workBoard({ collection: 'workorders', onOpen: (record) => openForm({ collection: 'workorders', record }) }));
  } else {
    items = sortItems(items, u.sort || { key: 'due', dir: 'asc' });
    body.append(h('div', { class: 'table-wrap' }, dataTable({
      collection: 'workorders',
      items,
      sort: u.sort || { key: 'due', dir: 'asc' },
      onSort: (key) => { u.sort = { key, dir: u.sort?.key === key && u.sort.dir === 'asc' ? 'desc' : 'asc' }; ctx.rerender(); },
      rowClass: (r) => { const d = daysUntil(r.due); return d !== null && d < 0 && r.status !== 'Done' ? 'row-bad' : r.priority === 'Urgent' ? 'row-warn' : ''; },
    })));
  }
  root.append(body);
  return root;
}

// ---- Generic collection view --------------------------------------------
export function collectionView(ctx, collection) {
  const meta = collectionByName[collection];
  const defaults = { search: '', sort: meta.defaultSort, status: '', lowOnly: false };
  const u = ui(ctx, collection, defaults);
  const root = h('div', { class: 'view' });

  const filters = [];
  if (meta.statusKey) {
    const field = meta.fields.find((f) => f.key === meta.statusKey);
    filters.push({ key: 'status', label: `All ${field.label.toLowerCase()}`, options: field.options.map((v) => ({ value: v, label: v })) });
  }

  const right = [];
  if (collection === 'parts') {
    right.push(h('label', { class: 'check' },
      h('input', { type: 'checkbox', checked: u.lowOnly, onchange: (e) => { u.lowOnly = e.target.checked; ctx.rerender(); } }),
      'Low stock only',
    ));
  }
  right.push(addButton(collection));

  root.append(sectionHeader(meta.label, `${store.col(collection).length} records`));
  root.append(toolbar(ctx, collection, {
    searchPlaceholder: `Search ${meta.label.toLowerCase()}…`,
    filters,
    right,
  }));

  if (collection === 'parts') root.append(partsSummary(store.col('parts')));
  if (collection === 'assets') root.append(assetsSummary(store.col('assets')));

  let items = store.col(collection).filter((r) => matchesSearch(r, meta, u.search));
  if (u.status && meta.statusKey) items = items.filter((r) => r[meta.statusKey] === u.status);
  if (collection === 'parts' && u.lowOnly) items = items.filter((p) => Number(p.qty) <= Number(p.minQty));
  if (collection === 'schedule') items = items.map((r) => ({ ...r, ...computeFields('schedule', r) }));
  items = sortItems(items, u.sort, collection === 'schedule' ? { nextDue: (r) => r.nextDue } : {});

  const extraActions = collection === 'schedule'
    ? (r) => [h('button', { class: 'mini-btn', title: 'Mark serviced today', onclick: async () => {
        await store.save('schedule', r.id, { lastDone: todayIso() });
        toast('Marked serviced — next due recalculated');
      } }, icon('check', 15), 'Serviced')]
    : collection === 'parts'
      ? (r) => [
          iconButton('minus', async () => { await store.save('parts', r.id, { qty: Math.max(0, Number(r.qty) - 1) }); }, 'Remove one'),
          h('span', { class: 'qty-pill' }, `${r.qty}`),
          iconButton('plus', async () => { await store.save('parts', r.id, { qty: Number(r.qty) + 1 }); }, 'Add one'),
        ]
      : null;

  const sortGetters = collection === 'schedule' ? { nextDue: (r) => r.nextDue } : {};

  const wrap = h('div', { class: 'table-wrap' }, dataTable({
    collection,
    items,
    sort: u.sort,
    onSort: (key) => { u.sort = { key, dir: u.sort?.key === key && u.sort.dir === 'asc' ? 'desc' : 'asc' }; ctx.rerender(); },
    extraActions,
    rowClass: (r) => {
      if (collection === 'parts' && Number(r.qty) <= Number(r.minQty) && store.state.settings.lowStockAlerts !== false) return 'row-warn';
      if (meta.statusKey && (r[meta.statusKey] === 'Down')) return 'row-bad';
      if (meta.statusKey && r[meta.statusKey] === 'Maintenance') return 'row-warn';
      if (collection === 'schedule') { const d = daysUntil(r.nextDue); return d !== null && d < 0 ? 'row-bad' : d !== null && d <= 3 ? 'row-warn' : ''; }
      return '';
    },
  }));
  root.append(h('div', { class: 'view-body' }, wrap));
  return root;
}

function partsSummary(parts) {
  const low = parts.filter((p) => Number(p.qty) <= Number(p.minQty));
  const value = parts.reduce((sum, p) => sum + (Number(p.qty) || 0) * (Number(p.cost) || 0), 0);
  return h('div', { class: 'mini-kpis' },
    kpi('SKUs', parts.length),
    kpi('Low / Out', low.length, low.length ? 'warn' : ''),
    kpi('Inventory Value', value.toLocaleString(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })),
  );
}

function assetsSummary(assets) {
  return h('div', { class: 'mini-kpis' },
    kpi('Total Assets', assets.length),
    kpi('Down', assets.filter((a) => a.status === 'Down').length, assets.some((a) => a.status === 'Down') ? 'bad' : ''),
    kpi('In Maintenance', assets.filter((a) => a.status === 'Maintenance').length, 'warn'),
    kpi('High Criticality', assets.filter((a) => a.criticality === 'High').length),
  );
}

// ---- Activity ------------------------------------------------------------
export function activityView(ctx) {
  const root = h('div', { class: 'view' });
  root.append(sectionHeader('Activity', 'Everything that has changed, newest first'));
  const panel = h('div', { class: 'panel' });
  panel.append(activityList(store.state.activity, store.state.activity.length));
  root.append(h('div', { class: 'view-body' }, panel));
  return root;
}

// ---- Settings ------------------------------------------------------------
export function settingsView(ctx) {
  const s = store.state.settings;
  const root = h('div', { class: 'view' });
  root.append(sectionHeader('Settings', 'Shop identity, display options and data management'));
  const body = h('div', { class: 'view-body settings-grid' });

  // Shop settings
  const card = h('div', { class: 'panel' });
  card.append(h('div', { class: 'panel-head' }, icon('settings', 17), h('h3', {}, 'Shop & Display')));
  const form = h('form', { class: 'form-grid', onsubmit: async (e) => {
    e.preventDefault();
    const patch = {};
    for (const field of settingsSchema) {
      const input = form.querySelector(`[name="${field.key}"]`);
      if (!input) continue;
      patch[field.key] = field.type === TYPES.BOOL ? input.checked : (field.type === TYPES.NUMBER ? Number(input.value) : input.value);
    }
    await store.saveSettings(patch);
    toast('Settings saved');
    ctx.rerender();
  } });
  for (const field of settingsSchema) {
    form.append(h('label', { class: `field ${field.type === TYPES.TEXTAREA ? 'full' : ''}` },
      h('span', { class: 'field-label' }, field.label),
      controlForSettings(field, s[field.key]),
    ));
  }
  card.append(h('div', { class: 'panel-body' }, form));
  card.append(h('div', { class: 'panel-foot' }, h('button', { class: 'btn primary', onclick: () => form.requestSubmit() }, icon('save', 16), 'Save Settings')));
  body.append(card);

  // Kiosk + network
  const kiosk = h('div', { class: 'panel' });
  kiosk.append(h('div', { class: 'panel-head' }, icon('monitor', 17), h('h3', {}, 'Wall Display / Kiosk')));
  const kioskUrl = new URL('display.html', location.href).href;
  kiosk.append(h('div', { class: 'panel-body' },
    h('p', { class: 'muted' }, 'Open the kiosk on any TV or spare monitor connected to the shop network. It rotates through the boards below and updates live as work is edited.'),
    h('div', { class: 'setting-row' },
      h('div', {}, h('div', { class: 'strong' }, 'Kiosk URL'), h('code', { class: 'path-text' }, kioskUrl)),
      h('div', { class: 'row-actions' },
        h('button', { class: 'btn ghost', onclick: () => { navigator.clipboard?.writeText(kioskUrl); toast('Kiosk URL copied'); } }, icon('link', 16), 'Copy URL'),
        h('button', { class: 'btn primary', onclick: () => window.open('display.html', '_blank') }, icon('external', 16), 'Open Kiosk'),
      ),
    ),
    store.state.mode === 'server' ? h('div', { class: 'setting-row' },
      h('div', {}, h('div', { class: 'strong' }, 'Network address'), h('code', { class: 'path-text' }, location.origin)),
      h('div', { class: 'row-actions' }, h('span', { class: 'muted small' }, 'Share this address with everyone on the shop LAN')),
    ) : null,
    h('div', { class: 'setting-row' },
      h('div', {}, h('div', { class: 'strong' }, 'Board rotation'), h('div', { class: 'muted small' }, `Views: ${s.kioskViews} · every ${s.rotateSeconds}s`)),
    ),
  ));
  body.append(kiosk);

  // Identity
  const me = h('div', { class: 'panel' });
  me.append(h('div', { class: 'panel-head' }, icon('people', 17), h('h3', {}, 'Your Name (for the activity log)')));
  const nameInput = h('input', { class: 'input', value: getActor(), placeholder: 'e.g. Dana' });
  me.append(h('div', { class: 'panel-body' },
    h('label', { class: 'field full' }, h('span', { class: 'field-label' }, 'Signed in as'), nameInput),
  ));
  me.append(h('div', { class: 'panel-foot' }, h('button', { class: 'btn primary', onclick: () => { setActor(nameInput.value.trim()); toast('Name saved'); } }, icon('save', 16), 'Save Name')));
  body.append(me);

  // Data management
  const data = h('div', { class: 'panel' });
  data.append(h('div', { class: 'panel-head' }, icon('box', 17), h('h3', {}, 'Data & Backups')));
  const fileInput = h('input', { type: 'file', accept: 'application/json', style: { display: 'none' }, onchange: async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const text = await file.text();
      const parsed = JSON.parse(text);
      if (await confirmDialog({ title: 'Restore backup?', message: 'This replaces ALL current data with the contents of the file.', confirmLabel: 'Restore' })) {
        await store.importAll(parsed);
        await store.load();
        toast('Backup restored');
        ctx.rerender();
      }
    } catch (err) {
      toast('Could not read backup: ' + err.message, 'error');
    }
    e.target.value = '';
  } });
  data.append(h('div', { class: 'panel-body' },
    h('div', { class: 'setting-row' },
      h('div', {},
        h('div', { class: 'strong' }, 'Storage'),
        h('div', { class: 'muted small' }, store.state.mode === 'browser'
          ? 'Demo mode — the sample shop runs entirely in this browser (localStorage). Deploy the folder to any website and it works as a live demo; run "node server.js" to switch to a shared, real-time shop database.'
          : 'Server mode — records are shared live with every connected screen and stored in data/db.json on the host.'),
      ),
      h('div', { class: 'row-actions' }, h('span', { class: 'chip', style: { '--chip': store.state.mode === 'browser' ? '#f59e0b' : '#22c55e' } }, store.state.mode === 'browser' ? 'DEMO · THIS BROWSER' : 'LIVE SERVER')),
    ),
    h('p', { class: 'muted' }, 'Everything is stored in a single place (data/db.json on the host, or this browser in demo mode). Download a backup any time, or restore one to move the shop to a new machine.'),
    h('div', { class: 'row-actions' },
      h('button', { class: 'btn ghost', onclick: () => {
        download(`shopline-backup-${todayIso()}.json`, store.backupJson());
        toast('Backup downloaded');
      } }, icon('download', 16), 'Download backup'),
      h('button', { class: 'btn ghost', onclick: () => fileInput.click() }, icon('upload', 16), 'Restore backup'),
      store.state.mode === 'browser' ? h('button', { class: 'btn ghost', onclick: async () => {
        if (await confirmDialog({ title: 'Reset demo data?', message: 'The sample shop will be restored and your edits in this browser will be removed.', confirmLabel: 'Reset demo' })) {
          await store.resetDemo();
          toast('Demo data reset');
          ctx.rerender();
        }
      } }, icon('refresh', 16), 'Reset demo data') : h('button', { class: 'btn ghost', onclick: async () => {
        if (await confirmDialog({ title: 'Clear all records?', message: 'Every work order, asset, part, person, vendor and resource will be removed. Settings and backups are kept. This cannot be undone.', confirmLabel: 'Clear everything' })) {
          await store.clearAll();
          toast('All records cleared');
          ctx.rerender();
        }
      } }, icon('trash', 16), 'Clear all records'),
      fileInput,
    ),
    h('p', { class: 'muted small' }, `${Object.values(store.state.collections).reduce((n, list) => n + list.length, 0)} records · last synced ${relTime(store.state.lastSync?.toISOString())}`),
  ));
  body.append(data);

  root.append(body);
  return root;
}

function controlForSettings(field, value) {
  const input = fieldControl(field, value);
  if (field.type === TYPES.BOOL) {
    input.querySelector('input').setAttribute('name', field.key);
    return input;
  }
  input.setAttribute('name', field.key);
  return input;
}
