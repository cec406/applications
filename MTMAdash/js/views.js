// All application views. Each returns a DOM node; app.js decides which to mount.
import { h, append, clear, sortItems, fmtDate, fmtDateShort, fmtDayLong, fmtDayStrip, weekStart, shiftDays, daysUntil, relTime, debounce, todayIso, download, kioskUrl } from './util.js';
import { icon } from './icons.js';
import {
  collections, collectionByName, settingsSchema, computeFields, COLORS, TYPES,
  itemSummary, titleOf, unitNameOf, STATUSES, DIRECTIONS,
} from '../shared/schema.js';
import * as store from './store.js';
import { getActor, setActor } from './api.js';
import {
  chip, statusChip, dueBadge, dataTable, workBoard, openForm, iconButton,
  sectionHeader, activityList, kpi, barChart, confirmDialog, toast, displayValue, fieldControl,
} from './components.js';
import { importLegacyCsvFiles } from '../shared/legacy.js';

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
    const text = field.type === TYPES.ITEMS ? itemSummary(value) : String(value);
    if (text.toLowerCase().includes(q)) return true;
    if (field.type === TYPES.REF) {
      const label = store.label(field.ref, value) || record.unitName || '';
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

const byTime = (a, b) => String(a.time || '').localeCompare(String(b.time || '')) || String(a.date).localeCompare(String(b.date));
const byDateTime = (a, b) => `${a.date} ${a.time}`.localeCompare(`${b.date} ${b.time}`);

function withComputed(records) {
  return records.map((r) => ({ ...r, ...computeFields('appointments', r) }));
}

function unitLabel(record) {
  return record.unitName || store.label('units', record.unitId) || '—';
}

// ---- Appointment cards & actions ------------------------------------------

// Contextual quick actions for an appointment's current status.
function statusActions(record, extra = []) {
  const actions = [...extra];
  const advance = (status, label, ic, cls = '') => h('button', {
    class: `mini-btn ${cls}`,
    onclick: async () => {
      await store.save('appointments', record.id, { status });
      toast(`Marked ${label.toLowerCase()}`);
    },
  }, icon(ic, 14), label);

  if (record.status === 'Scheduled') {
    actions.push(advance('Arrived', 'Arrived', 'check', 'good'));
    actions.push(advance('No-show', 'No-show', 'x', 'danger'));
  } else if (record.status === 'Arrived') {
    actions.push(advance('Completed', 'Complete', 'check', 'good'));
    actions.push(advance('Scheduled', 'Reset', 'undo'));
  } else {
    actions.push(advance('Scheduled', 'Reopen', 'undo'));
  }
  return actions;
}

function deleteButton(record, label = 'Appointment') {
  return iconButton('trash', async () => {
    if (await confirmDialog({ title: `Delete ${label}?`, message: `"${unitLabel(record)} — ${fmtDateShort(record.date)} ${record.time}" will be removed.` })) {
      await store.remove('appointments', record.id);
      toast('Deleted');
    }
  }, 'Delete', 'danger-hover');
}

// Full appointment card used on the daily board and in the overdue banner.
function apptCard(record, { compact = false, planning = false } = {}) {
  const dirIcon = record.direction === 'Drop-off' ? 'arrowdown' : 'arrowup';
  const due = daysUntil(record.date);
  const card = h('div', { class: `appt ${record.status === 'Completed' || record.status === 'Cancelled' ? 'dim' : ''}`, dataset: { id: record.id } });
  card.append(h('div', { class: 'appt-row' },
    h('span', { class: `appt-time mono-time ${String(record.time).toUpperCase() === 'TBD' ? 'tbd' : ''}` }, record.time || '--:--'),
    h('span', { class: 'chip', style: { '--chip': COLORS[record.direction] } }, icon(dirIcon, 13), record.direction),
    statusChip(record.status),
    // Overdue stays red; on the planning board upcoming visits show "In 3d" etc.
    record.overdue || (planning && due > 0) ? dueBadge(due) : null,
  ));
  const unitLine = h('div', { class: 'appt-unit' }, unitLabel(record));
  if (record.poc) unitLine.append(h('span', { class: 'muted small' }, ` · POC ${record.poc}`));
  if (!compact && record.date !== todayIso()) unitLine.append(h('span', { class: 'muted small' }, ` · ${fmtDateShort(record.date)}`));
  card.append(unitLine);

  if (record.items?.length) {
    const list = h('ul', { class: 'appt-items' });
    for (const it of record.items) {
      list.append(h('li', {}, h('b', {}, `${it.qty}×`), ` ${it.eqType || 'Equipment'}`, it.description ? h('span', { class: 'muted' }, ` — ${it.description}`) : null));
    }
    card.append(list);
  }
  if (record.notes) card.append(h('div', { class: 'appt-notes' }, record.notes));

  const actions = h('div', { class: 'appt-actions' }, statusActions(record));
  actions.append(
    iconButton('edit', () => openForm({ collection: 'appointments', record }), 'Edit'),
    deleteButton(record),
  );
  card.append(actions);
  return card;
}

// ---- Daily Board (default view) -------------------------------------------
export function boardView(ctx) {
  const u = ui(ctx, 'board', { date: todayIso() });
  const all = withComputed(store.col('appointments'));
  const weapons = store.col('weapons');
  const today = todayIso();
  const history = u.date < today;

  // Planning mode (today or a future date): every appointment is on the board
  // from the day it is scheduled until it is dropped off or picked up —
  // upcoming visits included, so the shop can plan ahead. History mode (a past
  // date): that day's record, completed visits included.
  const open = all.filter((r) => r.status === 'Scheduled' || r.status === 'Arrived');
  const day = history
    ? all.filter((r) => r.date === u.date && r.status !== 'Cancelled')
    : open;
  const inbound = day.filter((r) => r.direction === 'Drop-off').sort(byDateTime);
  const outbound = day.filter((r) => r.direction === 'Pickup').sort(byDateTime);
  const overdue = all.filter((r) => r.overdue).sort(byDateTime);
  const inboundQty = inbound.reduce((n, r) => n + r.totalQty, 0);
  const outboundQty = outbound.reduce((n, r) => n + r.totalQty, 0);

  const root = h('div', { class: 'view board-view' });

  // Date navigation
  const nav = h('div', { class: 'toolbar board-nav' },
    h('div', { class: 'toolbar-left' },
      h('button', { class: 'btn ghost', onclick: () => { u.date = shiftDays(u.date, -1); ctx.rerender(); } }, icon('chevron', 16), 'Prev'),
      h('input', { class: 'input compact', type: 'date', value: u.date, onchange: (e) => { u.date = e.target.value || todayIso(); ctx.rerender(); } }),
      h('button', { class: 'btn ghost', onclick: () => { u.date = shiftDays(u.date, 1); ctx.rerender(); } }, 'Next', icon('chevron', 16)),
      u.date !== todayIso() ? h('button', { class: 'btn', onclick: () => { u.date = todayIso(); ctx.rerender(); } }, 'Today') : null,
      h('span', { class: `board-day-label ${u.date === today ? 'today' : ''}` },
        fmtDayLong(u.date)
        + (u.date === today ? ' · TODAY' : history ? '' : ' · showing all open'),
      ),
    ),
    h('div', { class: 'toolbar-right' },
      h('button', { class: 'btn primary', onclick: () => openForm({ collection: 'appointments', record: { date: u.date, direction: 'Drop-off', status: 'Scheduled' } }) },
        icon('plus', 16), 'New Appointment'),
    ),
  );
  root.append(nav);

  root.append(h('div', { class: 'kpi-row kpi-row-5' },
    ...(history ? [
      kpi('Appointments', day.length, day.length ? 'accent' : '', `${inbound.length} in · ${outbound.length} out`),
      kpi('Inbound Items', inboundQty, inboundQty ? 'good' : '', 'drop-offs that day'),
      kpi('Outbound Items', outboundQty, outboundQty ? 'warn' : '', 'pickups that day'),
    ] : [
      kpi('Open Appointments', day.length, day.length ? 'accent' : '', `${inbound.length} drop-offs · ${outbound.length} pickups`),
      kpi('Incoming Items', inboundQty, inboundQty ? 'good' : '', 'scheduled, not yet dropped off'),
      kpi('Outgoing Items', outboundQty, outboundQty ? 'warn' : '', 'scheduled, not yet picked up'),
    ]),
    kpi('Overdue', overdue.length, overdue.length ? 'bad' : '', 'scheduled, past due'),
    kpi('Weapons On Hand', weapons.reduce((n, w) => n + (Number(w.count) || 0), 0), '', `${weapons.length} types`),
  ));

  // Friendly first-run guidance while the workspace is still empty.
  if (!all.length && !weapons.length && !store.col('units').length) {
    root.append(h('div', { class: 'panel welcome' },
      h('div', { class: 'panel-head' }, icon('activity', 17), h('h3', {}, 'Welcome — your board is empty')),
      h('div', { class: 'panel-body' },
        h('ul', { class: 'welcome-tips' },
          h('li', {}, h('b', {}, 'Add your first appointment'), ' — set the date, then type the unit name (e.g. ', h('code', {}, 'A/2-1 IN'), '). New units are created automatically as you type.'),
          h('li', {}, h('b', {}, 'Pick a time, or mark it TBD'), ' — if the slot isn\'t pinned down yet, tick ' , h('b', {}, 'TBD'), ' and the card shows it without counting as overdue.'),
          h('li', {}, h('b', {}, 'Drop-off or Pickup'), ' — each appointment is one flow, with any number of equipment lines (type + qty + description).'),
          h('li', {}, h('b', {}, 'Track weapons'), ' — add each weapon type with a count; use − / ＋ on the Weapons page as arms move.'),
          h('li', {}, h('b', {}, 'Bring over your old data'), ' — Settings → Import from the old Streamlit tracker takes your equipment/weapons/notes CSVs.'),
        ),
        h('div', { class: 'row-actions' },
          h('button', { class: 'btn primary', onclick: () => openForm({ collection: 'appointments', record: { date: u.date } }) }, icon('plus', 16), 'New Appointment'),
          h('button', { class: 'btn ghost', onclick: () => openForm({ collection: 'weapons' }) }, icon('target', 16), 'Add Weapon Type'),
          h('button', { class: 'btn ghost', onclick: () => { location.hash = '#/settings'; } }, icon('upload', 16), 'Import CSVs'),
        ),
      ),
    ));
  }

  if (overdue.length) {
    const banner = h('div', { class: 'overdue-banner' },
      h('div', { class: 'overdue-head' }, icon('alert', 18), `Overdue — ${overdue.length} appointment${overdue.length === 1 ? '' : 's'} still open`),
      h('div', { class: 'overdue-list' },
        ...overdue.slice(0, 6).map((r) => h('div', { class: 'overdue-row' },
          h('span', { class: 'mono-time' }, r.time),
          h('span', { class: 'strong' }, unitLabel(r)),
          h('span', { class: 'chip', style: { '--chip': COLORS[r.direction] } }, r.direction),
          h('span', { class: 'muted small' }, fmtDateShort(r.date)),
          h('span', { class: 'spacer' }),
          h('button', { class: 'mini-btn good', onclick: async () => { await store.save('appointments', r.id, { status: 'Arrived' }); toast('Marked arrived'); } }, icon('check', 14), 'Arrived'),
          h('button', {
            class: 'mini-btn', title: 'Push one day forward',
            onclick: async () => { await store.save('appointments', r.id, { date: shiftDays(r.date, 1) }); toast('Moved to next day'); },
          }, icon('move', 14), '+1 day'),
          iconButton('edit', () => openForm({ collection: 'appointments', record: r }), 'Edit'),
        )),
        overdue.length > 6 ? h('div', { class: 'muted small overdue-more' }, `+${overdue.length - 6} more — see Schedule`) : null,
      ),
    );
    root.append(banner);
  }

  // Inbound / outbound columns
  const columns = h('div', { class: 'board-cols' });
  const makeCol = (title, sub, dirIcon, tone, cards) => {
    const col = h('div', { class: 'board-col' });
    col.append(h('div', { class: `board-col-title ${tone}` }, icon(dirIcon, 18), h('span', {}, title), h('span', { class: 'count' }, cards.length), h('span', { class: 'muted small col-sub' }, sub)));
    const body = h('div', { class: 'board-col-body' });
    if (!cards.length) {
      body.append(h('div', { class: 'board-empty-day' }, history
        ? `Nothing ${tone === 'in' ? 'dropping off' : 'being picked up'} on this date.`
        : `No open ${tone === 'in' ? 'drop-offs' : 'pickups'} — new ones appear here the moment they're scheduled.`));
    }
    let lastDate = '';
    for (const r of cards) {
      // Planning mode groups the pipeline by day so upcoming visits read at a glance.
      if (!history && r.date !== lastDate) {
        lastDate = r.date;
        body.append(h('div', { class: `col-day-sep ${r.date === today ? 'today' : ''}` }, r.date === today ? 'TODAY' : fmtDayStrip(r.date)));
      }
      body.append(apptCard(r, { planning: !history }));
    }
    col.append(body);
    return col;
  };
  columns.append(makeCol('INBOUND', history ? 'units dropping equipment off' : 'from scheduled until dropped off', 'arrowdown', 'in', inbound));
  columns.append(makeCol('OUTBOUND', history ? 'units picking equipment up' : 'from scheduled until picked up', 'arrowup', 'out', outbound));
  root.append(columns);

  // Shop notes strip
  const notes = store.col('notes').slice(0, 6);
  if (notes.length) {
    const panel = h('div', { class: 'panel' });
    panel.append(h('div', { class: 'panel-head' },
      icon('note', 17), h('h3', {}, 'Shop Notes'),
      h('span', { class: 'spacer' }),
      h('button', { class: 'btn ghost mini', onclick: () => { location.hash = '#/notes'; } }, 'All notes'),
    ));
    const grid = h('div', { class: 'note-strip' });
    for (const n of notes) {
      grid.append(h('div', { class: 'note-card' },
        h('div', { class: 'note-text' }, n.message),
        h('div', { class: 'muted small' }, relTime(n.createdAt)),
      ));
    }
    panel.append(h('div', { class: 'panel-body' }, grid));
    root.append(panel);
  }

  return root;
}

// ---- Schedule (appointments) ----------------------------------------------
export function appointmentsView(ctx) {
  const u = ui(ctx, 'appointments', {
    mode: 'week', search: '', status: '', direction: '', unit: '',
    weekStart: weekStart(todayIso()), sort: { key: 'date', dir: 'asc' },
  });
  const meta = collectionByName.appointments;
  const root = h('div', { class: 'view' });

  root.append(sectionHeader('Schedule', 'Drop-offs and pickups by unit and equipment type',
    h('div', { class: 'segmented' },
      h('button', { class: `seg ${u.mode === 'week' ? 'active' : ''}`, onclick: () => { u.mode = 'week'; ctx.rerender(); } }, icon('calendar', 15), 'Week'),
      h('button', { class: `seg ${u.mode === 'board' ? 'active' : ''}`, onclick: () => { u.mode = 'board'; ctx.rerender(); } }, icon('grid', 15), 'Status Board'),
      h('button', { class: `seg ${u.mode === 'table' ? 'active' : ''}`, onclick: () => { u.mode = 'table'; ctx.rerender(); } }, icon('list', 15), 'Table'),
    ),
    addButton('appointments'),
  ));

  root.append(toolbar(ctx, 'appointments', {
    searchPlaceholder: 'Search unit, equipment, notes…',
    filters: [
      { key: 'unit', label: 'All units', options: store.options('units') },
      { key: 'direction', label: 'All flows', options: DIRECTIONS.map((v) => ({ value: v, label: v })) },
      { key: 'status', label: 'All statuses', options: STATUSES.map((v) => ({ value: v, label: v })) },
    ],
  }));

  let items = withComputed(store.col('appointments')).filter((r) => matchesSearch(r, meta, u.search));
  if (u.status) items = items.filter((r) => r.status === u.status);
  if (u.direction) items = items.filter((r) => r.direction === u.direction);
  if (u.unit) items = items.filter((r) => r.unitId === u.unit);
  const allCount = items.length;

  const body = h('div', { class: 'view-body' });

  if (u.mode === 'week') {
    // Week navigation
    body.append(h('div', { class: 'toolbar week-nav' },
      h('div', { class: 'toolbar-left' },
        h('button', { class: 'btn ghost', onclick: () => { u.weekStart = shiftDays(u.weekStart, -7); ctx.rerender(); } }, icon('chevron', 16), 'Prev week'),
        h('button', { class: 'btn', onclick: () => { u.weekStart = weekStart(todayIso()); ctx.rerender(); } }, 'This week'),
        h('button', { class: 'btn ghost', onclick: () => { u.weekStart = shiftDays(u.weekStart, 7); ctx.rerender(); } }, 'Next week', icon('chevron', 16)),
      ),
      h('span', { class: 'muted small' }, `${fmtDayStrip(u.weekStart)} – ${fmtDayStrip(shiftDays(u.weekStart, 6))} · drag cards on the Status Board to change status`),
    ));

    // Filters apply to the strip as well
    const weekItems = items;
    const days = [...Array(7)].map((_, i) => shiftDays(u.weekStart, i));
    const strip = h('div', { class: 'day-strip' });
    for (const dayIso of days) {
      const dayAppts = weekItems
        .filter((r) => r.date === dayIso && r.status !== 'Cancelled')
        .sort(byTime);
      const isToday = dayIso === todayIso();
      const card = h('div', { class: `day-card ${isToday ? 'today' : ''}` });
      card.append(h('div', { class: 'day-head' },
        h('span', { class: 'day-name' }, fmtDayStrip(dayIso)),
        h('span', { class: `count ${dayAppts.length ? '' : 'zero'}` }, dayAppts.length),
      ));
      for (const r of dayAppts) {
        const dirIcon = r.direction === 'Drop-off' ? 'arrowdown' : 'arrowup';
        card.append(h('button', {
          class: `day-chip ${r.status === 'Completed' ? 'dim' : ''}`,
          style: { '--chip': COLORS[r.direction] },
          title: `${r.time} ${unitLabel(r)} — ${itemSummary(r.items) || 'no equipment listed'}`,
          onclick: () => openForm({ collection: 'appointments', record: r }),
        },
          h('span', { class: 'day-chip-time mono-time' }, r.time),
          h('span', { class: 'day-chip-unit' }, unitLabel(r)),
          h('span', { class: 'day-chip-items muted small' }, itemSummary(r.items) || '—'),
          icon(dirIcon, 13),
        ));
      }
      if (!dayAppts.length) card.append(h('div', { class: 'day-empty' }, '—'));
      strip.append(card);
    }
    body.append(strip);
  } else if (u.mode === 'board') {
    body.append(workBoard({ collection: 'appointments', onOpen: (record) => openForm({ collection: 'appointments', record }) }));
  } else {
    items = sortItems(items, u.sort, { date: (r) => `${r.date || ''} ${r.time || ''}` });
    body.append(h('div', { class: 'table-wrap' }, dataTable({
      collection: 'appointments',
      items,
      sort: u.sort,
      onSort: (key) => { u.sort = { key, dir: u.sort?.key === key && u.sort.dir === 'asc' ? 'desc' : 'asc' }; ctx.rerender(); },
      extraActions: (r) => statusActions(r).slice(0, 1),
      rowClass: (r) => r.overdue ? 'row-bad' : r.status === 'Arrived' ? 'row-warn' : r.status === 'Completed' ? 'row-done' : '',
    })));
  }

  root.append(body);
  root.append(h('div', { class: 'muted small' }, `${allCount} appointment${allCount === 1 ? '' : 's'} shown`));
  return root;
}

// ---- Weapons ---------------------------------------------------------------
export function weaponsView(ctx) {
  const u = ui(ctx, 'weapons', { search: '' });
  const root = h('div', { class: 'view' });
  const weapons = store.col('weapons');
  const total = weapons.reduce((n, w) => n + (Number(w.count) || 0), 0);
  const biggest = [...weapons].sort((a, b) => (Number(b.count) || 0) - (Number(a.count) || 0))[0];

  root.append(sectionHeader('Weapons', 'Arms-room inventory by weapon type',
    h('button', { class: 'btn primary', onclick: () => openForm({ collection: 'weapons' }) }, icon('plus', 16), 'Add Weapon Type'),
  ));

  // Quick add row
  const nameInput = h('input', { class: 'input', placeholder: 'Weapon type — e.g. M4 Carbine' });
  const countInput = h('input', { class: 'input compact', type: 'number', min: '0', step: '1', placeholder: 'Count', style: { maxWidth: '110px' } });
  const quickAdd = h('div', { class: 'toolbar' },
    h('div', { class: 'toolbar-left' },
      h('span', { class: 'search-wrap' }, icon('target', 16), nameInput),
      countInput,
      h('button', {
        class: 'btn primary', onclick: async () => {
          const name = nameInput.value.trim();
          if (!name) { toast('Give the weapon type a name', 'error'); nameInput.focus(); return; }
          await store.save('weapons', null, { name, count: Math.max(0, Math.round(Number(countInput.value) || 0)) });
          toast(`Added ${name}`);
          nameInput.value = ''; countInput.value = '';
          ctx.rerender();
        },
      }, icon('plus', 16), 'Add'),
    ),
  );
  root.append(quickAdd);

  root.append(h('div', { class: 'kpi-row kpi-row-3' },
    kpi('Types Tracked', weapons.length, weapons.length ? 'accent' : ''),
    kpi('Total On Hand', total, total ? '' : 'warn', 'all weapon types'),
    kpi('Largest Type', biggest ? biggest.count : 0, '', biggest ? biggest.name : '—'),
  ));

  // Distribution chart
  if (weapons.length) {
    const chart = h('div', { class: 'panel' });
    chart.append(h('div', { class: 'panel-head' }, icon('activity', 17), h('h3', {}, 'Count by Weapon Type')));
    chart.append(barChart([...weapons]
      .sort((a, b) => (Number(b.count) || 0) - (Number(a.count) || 0))
      .map((w) => ({ label: w.name, value: Number(w.count) || 0, color: 'var(--accent)' }))));
    root.append(chart);
  }

  // Search + card grid
  const q = (u.search || '').toLowerCase();
  const list = weapons
    .filter((w) => !q || String(w.name).toLowerCase().includes(q) || String(w.notes || '').toLowerCase().includes(q))
    .sort((a, b) => String(a.name).localeCompare(String(b.name), undefined, { numeric: true }));

  if (!weapons.length) {
    root.append(h('div', { class: 'panel' }, h('div', { class: 'panel-body muted' },
      'No weapon types yet — add the first one above. Use −/＋ on each card to adjust counts as arms are signed in and out.')));
  } else if (!list.length) {
    root.append(h('div', { class: 'panel' }, h('div', { class: 'panel-body muted' }, `No weapon types match "${u.search}".`)));
  } else {
    const grid = h('div', { class: 'weapon-grid' });
    for (const w of list) {
      const card = h('div', { class: 'weapon-card', dataset: { id: w.id } });
      card.append(h('div', { class: 'weapon-name' }, icon('target', 15), w.name));
      card.append(h('div', { class: 'weapon-count' }, String(Number(w.count) || 0)));
      if (w.notes) card.append(h('div', { class: 'weapon-notes muted small', title: w.notes }, w.notes));
      const actions = h('div', { class: 'weapon-actions' },
        iconButton('minus', async () => {
          await store.save('weapons', w.id, { count: Math.max(0, (Number(w.count) || 0) - 1) });
        }, 'Remove one'),
        h('span', { class: 'muted small' }, 'on hand'),
        iconButton('plus', async () => {
          await store.save('weapons', w.id, { count: (Number(w.count) || 0) + 1 });
        }, 'Add one'),
        h('span', { class: 'spacer' }),
        iconButton('edit', () => openForm({ collection: 'weapons', record: w }), 'Edit'),
        iconButton('trash', async () => {
          if (await confirmDialog({ title: `Delete ${w.name}?`, message: 'The weapon type and its count will be removed.' })) {
            await store.remove('weapons', w.id);
            toast('Deleted');
          }
        }, 'Delete', 'danger-hover'),
      );
      card.append(actions);
      grid.append(card);
    }
    root.append(grid);
  }
  return root;
}

// ---- Shop notes -------------------------------------------------------------
export function notesView(ctx) {
  const root = h('div', { class: 'view' });
  const notes = store.col('notes');

  root.append(sectionHeader('Shop Notes', 'The pass-down board — everything the shop needs to remember'));

  // Composer
  const input = h('textarea', { class: 'input', rows: 2, placeholder: 'Write a note for the shop… (Enter to post, Shift+Enter for a new line)' });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); form.requestSubmit(); }
  });
  const form = h('form', {
    class: 'note-composer', onsubmit: async (e) => {
      e.preventDefault();
      const message = input.value.trim();
      if (!message) return;
      await store.save('notes', null, { message });
      toast('Note posted');
      input.value = '';
      ctx.rerender();
    },
  }, input, h('button', { class: 'btn primary', type: 'submit' }, icon('pin', 16), 'Post Note'));
  root.append(form);

  const list = h('div', { class: 'notes-list' });
  if (!notes.length) {
    list.append(h('div', { class: 'panel' }, h('div', { class: 'panel-body muted' }, 'No notes yet — post the first one above.')));
  }
  for (const n of notes) {
    const card = h('div', { class: 'note-card wide', dataset: { id: n.id } },
      h('div', { class: 'note-text' }, n.message),
      h('div', { class: 'note-foot' },
        h('span', { class: 'muted small' }, fmtDate((n.createdAt || '').slice(0, 10)), ` · posted ${relTime(n.createdAt)}`),
        h('span', { class: 'spacer' }),
        iconButton('edit', () => openForm({ collection: 'notes', record: n }), 'Edit'),
        iconButton('trash', async () => {
          if (await confirmDialog({ title: 'Delete note?', message: `"${n.message.slice(0, 60)}${n.message.length > 60 ? '…' : ''}" will be removed.` })) {
            await store.remove('notes', n.id);
            toast('Deleted');
          }
        }, 'Delete', 'danger-hover'),
      ),
    );
    list.append(card);
  }
  root.append(list);
  return root;
}

// ---- Overview ---------------------------------------------------------------
export function overviewView(ctx) {
  const all = withComputed(store.col('appointments'));
  const today = todayIso();
  const day = all.filter((r) => r.date === today && r.status !== 'Cancelled');
  const overdue = all.filter((r) => r.overdue);
  const noShows = all.filter((r) => r.status === 'No-show');
  const weapons = store.col('weapons');
  const notes = store.col('notes');

  const inboundQty = day.filter((r) => r.direction === 'Drop-off').reduce((n, r) => n + r.totalQty, 0);
  const outboundQty = day.filter((r) => r.direction === 'Pickup').reduce((n, r) => n + r.totalQty, 0);
  const totalWeapons = weapons.reduce((n, w) => n + (Number(w.count) || 0), 0);

  const root = h('div', { class: 'view overview' });

  root.append(h('div', { class: 'kpi-row' },
    kpi("Today's Appointments", day.length, day.length ? 'accent' : '', `${fmtDateShort(today)}`),
    kpi('Inbound Items', inboundQty, inboundQty ? 'good' : '', 'drop-offs today'),
    kpi('Outbound Items', outboundQty, outboundQty ? 'warn' : '', 'pickups today'),
    kpi('Overdue', overdue.length, overdue.length ? 'bad' : '', 'still scheduled, past due'),
    kpi('Weapons On Hand', totalWeapons, '', `${weapons.length} types tracked`),
    kpi('Open Notes', notes.length, notes.length ? '' : '', 'on the pass-down board'),
  ));

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
  for (const r of overdue.slice(0, 6)) push('bad', `${unitLabel(r)} — ${r.direction}`, `${fmtDateShort(r.date)} ${r.time} · ${itemSummary(r.items) || 'no items'}`, () => ctx.focusRecord('appointments', r.id));
  for (const r of noShows.slice(0, 4)) push('warn', `${unitLabel(r)} — no-show`, `${fmtDateShort(r.date)} ${r.time} · reschedule?`, () => ctx.focusRecord('appointments', r.id));
  if (!attList.children.length) attList.append(h('li', { class: 'list-item empty-ok' }, icon('check', 16), h('div', {}, 'All clear — nothing needs attention.')));
  attention.append(attList);
  grid.append(attention);

  // Upcoming (7 days)
  const upcoming = h('div', { class: 'panel' });
  upcoming.append(h('div', { class: 'panel-head' }, icon('calendar', 17), h('h3', {}, 'Next 7 Days')));
  const upList = h('ul', { class: 'list' });
  const horizon = shiftDays(today, 7);
  const events = all
    .filter((r) => r.date >= today && r.date <= horizon && r.status !== 'Cancelled')
    .sort(byDateTime)
    .slice(0, 12);
  for (const r of events) {
    upList.append(h('li', { class: 'list-item', onclick: () => ctx.focusRecord('appointments', r.id) },
      h('span', { class: 'tag', style: { '--chip': COLORS[r.direction] } }, r.direction === 'Drop-off' ? 'IN' : 'OUT'),
      h('div', { class: 'li-body' },
        h('div', { class: 'li-title' }, `${unitLabel(r)} · ${r.time}`),
        h('div', { class: 'muted small' }, `${fmtDateShort(r.date)} · ${itemSummary(r.items) || 'no equipment listed'}`),
      ),
      dueBadge(daysUntil(r.date)),
    ));
  }
  if (!events.length) upList.append(h('li', { class: 'list-item' }, h('div', { class: 'muted' }, 'Nothing scheduled in the next seven days.')));
  upcoming.append(upList);
  grid.append(upcoming);

  // Weapons chart
  const chartPanel = h('div', { class: 'panel' });
  chartPanel.append(h('div', { class: 'panel-head' }, icon('target', 17), h('h3', {}, 'Weapons on Hand by Type')));
  const sorted = [...weapons].sort((a, b) => (Number(b.count) || 0) - (Number(a.count) || 0));
  chartPanel.append(sorted.length
    ? barChart(sorted.map((w) => ({ label: w.name, value: Number(w.count) || 0, color: 'var(--accent)' })))
    : h('div', { class: 'panel-body muted' }, 'No weapon types tracked yet.'));
  grid.append(chartPanel);

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

// ---- Generic collection view (units, equipment types) ----------------------
export function collectionView(ctx, collection) {
  const meta = collectionByName[collection];
  const defaults = { search: '', sort: meta.defaultSort, status: '' };
  const u = ui(ctx, collection, defaults);
  const root = h('div', { class: 'view' });

  const filters = [];
  if (meta.statusKey) {
    const field = meta.fields.find((f) => f.key === meta.statusKey);
    filters.push({ key: 'status', label: `All ${field.label.toLowerCase()}`, options: field.options.map((v) => ({ value: v, label: v })) });
  }

  // Units show how many open appointments reference them.
  const right = [];
  if (collection === 'units') {
    right.push(h('button', { class: 'btn primary', onclick: () => openForm({ collection: 'appointments' }) }, icon('calendar', 16), 'New Appointment'));
  }
  right.push(addButton(collection));

  root.append(sectionHeader(meta.label, meta.label === 'Units' ? 'Units you type when scheduling are added here automatically' : '', ...right));
  root.append(toolbar(ctx, collection, {
    searchPlaceholder: `Search ${meta.label.toLowerCase()}…`,
    filters,
  }));

  if (collection === 'units') {
    const appts = store.col('appointments');
    const units = store.col('units');
    const openAppts = appts.filter((r) => r.status !== 'Completed' && r.status !== 'Cancelled');
    root.append(h('div', { class: 'mini-kpis mini-kpis-3' },
      kpi('Units on Roster', units.length, 'accent'),
      kpi('Open Appointments', openAppts.length, openAppts.length ? 'warn' : ''),
      kpi('Units with Open Items', new Set(openAppts.map((r) => r.unitId)).size, ''),
    ));
  }

  let items = store.col(collection).filter((r) => matchesSearch(r, meta, u.search));
  if (u.status && meta.statusKey) items = items.filter((r) => r[meta.statusKey] === u.status);
  items = sortItems(items, u.sort);

  const extraActions = collection === 'units'
    ? (r) => [h('button', {
        class: 'mini-btn', title: 'Schedule for this unit',
        onclick: () => openForm({ collection: 'appointments', record: { unitId: r.id } }),
      }, icon('plus', 14), 'Schedule')]
    : null;

  const wrap = h('div', { class: 'table-wrap' }, dataTable({
    collection,
    items,
    sort: u.sort,
    onSort: (key) => { u.sort = { key, dir: u.sort?.key === key && u.sort.dir === 'asc' ? 'desc' : 'asc' }; ctx.rerender(); },
    extraActions,
    rowClass: () => '',
  }));
  root.append(h('div', { class: 'view-body' }, wrap));
  return root;
}

// ---- Activity --------------------------------------------------------------
export function activityView(ctx) {
  const root = h('div', { class: 'view' });
  root.append(sectionHeader('Activity', 'Everything that has changed, newest first'));
  const panel = h('div', { class: 'panel' });
  panel.append(activityList(store.state.activity, store.state.activity.length));
  root.append(h('div', { class: 'view-body' }, panel));
  return root;
}

// ---- Settings --------------------------------------------------------------
export function settingsView(ctx) {
  const s = store.state.settings;
  const root = h('div', { class: 'view' });
  root.append(sectionHeader('Settings', 'Shop identity, equipment types, wall display and data management'));
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
  kiosk.append(h('div', { class: 'panel-body' },
    h('p', { class: 'muted' }, 'Open the kiosk on any TV or spare monitor connected to the shop network. It rotates through the Today board, Schedule, Weapons and Notes and updates live as records change.'),
    h('div', { class: 'setting-row' },
      h('div', {}, h('div', { class: 'strong' }, 'Kiosk URL'), h('code', { class: 'path-text' }, kioskUrl())),
      h('div', { class: 'row-actions' },
        h('button', { class: 'btn ghost', onclick: () => { navigator.clipboard?.writeText(kioskUrl()); toast('Kiosk URL copied'); } }, icon('link', 16), 'Copy URL'),
        h('button', { class: 'btn primary', onclick: () => window.open(kioskUrl(), '_blank') }, icon('external', 16), 'Open Kiosk'),
      ),
    ),
    h('div', { class: 'setting-row' },
      h('div', {}, h('div', { class: 'strong' }, 'Network address'), h('code', { class: 'path-text' }, location.origin)),
      h('div', { class: 'row-actions' }, h('span', { class: 'muted small' }, 'Share this address with everyone on the shop LAN')),
    ),
    h('div', { class: 'setting-row' },
      h('div', {}, h('div', { class: 'strong' }, 'Board rotation'), h('div', { class: 'muted small' }, `Views: ${s.kioskViews} · every ${s.rotateSeconds}s`)),
    ),
  ));
  body.append(kiosk);

  // Identity
  const me = h('div', { class: 'panel' });
  me.append(h('div', { class: 'panel-head' }, icon('people', 17), h('h3', {}, 'Your Name (for the activity log)')));
  const nameInput = h('input', { class: 'input', value: getActor(), placeholder: 'e.g. SGT Ruiz' });
  me.append(h('div', { class: 'panel-body' },
    h('label', { class: 'field full' }, h('span', { class: 'field-label' }, 'Signed in as'), nameInput),
  ));
  me.append(h('div', { class: 'panel-foot' }, h('button', { class: 'btn primary', onclick: () => { setActor(nameInput.value.trim()); toast('Name saved'); } }, icon('save', 16), 'Save Name')));
  body.append(me);

  // Equipment types
  const eq = h('div', { class: 'panel' });
  eq.append(h('div', { class: 'panel-head' }, icon('tag', 17), h('h3', {}, 'Equipment Types'),
    h('span', { class: 'spacer' }), h('span', { class: 'muted small' }, 'suggestions in the appointment form')));
  const eqInput = h('input', { class: 'input', placeholder: 'New type — e.g. Generator' });
  const eqList = h('div', { class: 'eqtype-list' });
  const renderEqList = () => {
    clear(eqList);
    const types = [...store.col('eqtypes')].sort((a, b) => String(a.name).localeCompare(String(b.name)));
    if (!types.length) eqList.append(h('span', { class: 'muted small' }, 'No types yet — free text still works in the form.'));
    for (const t of types) {
      eqList.append(h('span', { class: 'eqtype-chip' },
        t.name,
        iconButton('x', async () => { await store.remove('eqtypes', t.id); toast('Removed'); renderEqList(); }, 'Remove type', 'tiny danger-hover'),
      ));
    }
  };
  eq.append(h('div', { class: 'panel-body' },
    h('div', { class: 'toolbar' },
      h('div', { class: 'toolbar-left' },
        h('span', { class: 'search-wrap' }, icon('tag', 16), eqInput),
        h('button', {
          class: 'btn primary', onclick: async () => {
            const name = eqInput.value.trim();
            if (!name) return;
            const dupe = store.col('eqtypes').some((t) => t.name.toLowerCase() === name.toLowerCase());
            if (dupe) { toast('That type already exists', 'error'); return; }
            await store.save('eqtypes', null, { name });
            toast(`Added ${name}`);
            eqInput.value = '';
            renderEqList();
          },
        }, icon('plus', 16), 'Add'),
      ),
    ),
    h('div', { class: 'eqtype-wrap' }, eqList),
  ));
  renderEqList();
  body.append(eq);

  // Data & backups
  const data = h('div', { class: 'panel' });
  data.append(h('div', { class: 'panel-head' }, icon('box', 17), h('h3', {}, 'Data & Backups')));
  const fileInput = h('input', { type: 'file', accept: 'application/json', style: { display: 'none' }, onchange: async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const text = await file.text();
      const parsed = JSON.parse(text);
      if (await confirmDialog({ title: 'Restore backup?', message: 'This replaces ALL current data with the contents of the file.', confirmLabel: 'Restore' })) {
        await store.restoreBackup(parsed);
        toast('Backup restored');
        ctx.rerender();
      }
    } catch (err) {
      toast('Could not read backup: ' + err.message, 'error');
    }
    e.target.value = '';
  } });

  // Legacy CSV import (from the old Streamlit tracker)
  const csvInput = h('input', { type: 'file', accept: '.csv,text/csv', multiple: true, style: { display: 'none' }, onchange: async (e) => {
    const files = [...e.target.files];
    e.target.value = '';
    if (!files.length) return;
    const texts = [];
    for (const f of files) texts.push({ name: f.name, text: await f.text() });
    let payload;
    try { payload = importLegacyCsvFiles(texts); } catch (err) { toast('Import failed: ' + err.message, 'error'); return; }
    const total = payload.appointments.length + payload.weapons.length + payload.notes.length;
    if (!total) { toast('No recognizable rows found (expected equipment.csv, weapons.csv or shop_notes.csv)', 'error'); return; }
    const summary = `${payload.appointments.length} appointments, ${payload.weapons.length} weapon type${payload.weapons.length === 1 ? '' : 's'}, ${payload.notes.length} note${payload.notes.length === 1 ? '' : 's'}. Units are created from the CSV automatically. Existing records are kept.`;
    const warn = payload.warnings.length ? ` Warnings: ${payload.warnings.slice(0, 3).join(' | ')}` : '';
    if (!(await confirmDialog({ title: 'Import legacy data?', message: summary + warn, confirmLabel: 'Import' }))) return;
    try {
      for (const w of payload.weapons) await store.save('weapons', null, w);
      for (const n of payload.notes) await store.save('notes', null, n);
      for (const a of payload.appointments) await store.save('appointments', null, a);
      await store.refresh();
      toast(`Imported ${total} records`);
      ctx.rerender();
    } catch (err) {
      toast('Import failed: ' + err.message, 'error');
    }
  } });

  data.append(h('div', { class: 'panel-body' },
    h('div', { class: 'setting-row' },
      h('div', {},
        h('div', { class: 'strong' }, 'Storage'),
        h('div', { class: 'muted small' }, store.mode === 'browser'
          ? 'Browser mode — opened as a file, so records are saved in this browser (localStorage). Run "node server.js" and open it over the network to share data live between shop screens.'
          : 'Server mode — records are shared live with every connected screen and stored in data/db.json on the host.'),
      ),
      h('div', { class: 'row-actions' }, h('span', { class: 'chip', style: { '--chip': store.mode === 'browser' ? '#f59e0b' : '#22c55e' } }, store.mode === 'browser' ? 'THIS BROWSER' : 'LIVE SERVER')),
    ),
    h('p', { class: 'muted' }, 'Everything is stored in a single place (data/db.json on the host, or this browser in file mode). Download a backup any time, or restore one to move the shop to a new machine.'),
    h('div', { class: 'row-actions' },
      h('button', { class: 'btn ghost', onclick: async () => {
        download(`shop-ops-backup-${todayIso()}.json`, store.backupJson());
        toast('Backup downloaded');
      } }, icon('download', 16), 'Download backup'),
      h('button', { class: 'btn ghost', onclick: () => fileInput.click() }, icon('upload', 16), 'Restore backup'),
      fileInput,
    ),
    h('div', { class: 'setting-row' },
      h('div', {},
        h('div', { class: 'strong' }, 'Import from the old Streamlit tracker'),
        h('div', { class: 'muted small' }, 'Select equipment.csv, weapons.csv and/or shop_notes.csv. Units and appointments are rebuilt automatically (Incoming → Drop-off, Outgoing → Pickup).'),
      ),
      h('div', { class: 'row-actions' },
        h('button', { class: 'btn ghost', onclick: () => csvInput.click() }, icon('upload', 16), 'Import CSVs'),
        csvInput,
      ),
    ),
    h('div', { class: 'setting-row' },
      h('div', {},
        h('div', { class: 'strong' }, 'Clear all data'),
        h('div', { class: 'muted small' }, 'Remove every appointment, unit, weapon and note and start fresh. Equipment-type suggestions are kept.'),
      ),
      h('div', { class: 'row-actions' },
        h('button', {
          class: 'btn danger ghost-soft',
          onclick: async () => {
            if (await confirmDialog({ title: 'Clear all data?', message: 'Every appointment, unit, weapon and note will be removed. This cannot be undone.', confirmLabel: 'Clear everything' })) {
              await store.clearAll();
              toast('All data cleared');
              ctx.rerender();
            }
          },
        }, icon('trash', 16), 'Clear all data'),
      ),
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
