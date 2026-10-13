// Wall display / kiosk. Rotates through live boards, updates over SSE, and
// needs no interaction. Keys: ← → change board, Space pause, F fullscreen.
import { h, append, clear, fmtDateShort, relTime, daysUntil } from './util.js?v=20261012-3';
import { icon } from './icons.js?v=20261012-3';
import { computeFields, COLORS } from '../../shared/schema.js?v=20261012-3';
import * as store from './store.js?v=20261012-3';

const root = document.getElementById('kiosk');
let views = ['overview', 'workorders', 'schedule', 'parts', 'assets'];
let index = 0;
let rotateSeconds = 12;
let paused = false;
let rotateTimer = null;
let tick = 0;

const TITLES = {
  overview: 'Shop Overview',
  workorders: 'Work Order Board',
  schedule: 'Preventive Maintenance',
  parts: 'Parts & Stock Alerts',
  assets: 'Asset Status',
  about: 'About This Dashboard',
};

store.subscribe((event) => {
  if (event.type === 'settings' || event.type === 'loaded') applySettings();
  render();
});

function applySettings() {
  const s = store.state.settings || {};
  rotateSeconds = Math.max(4, Number(s.rotateSeconds) || 12);
  if (typeof s.kioskViews === 'string' && s.kioskViews.trim()) {
    views = s.kioskViews.split(',').map((v) => v.trim()).filter((v) => TITLES[v]);
    if (!views.length) views = ['overview'];
    if (index >= views.length) index = 0;
  }
  restartTimer();
}

function restartTimer() {
  clearInterval(rotateTimer);
  rotateTimer = setInterval(() => { if (!paused) advance(1); }, rotateSeconds * 1000);
}

function advance(dir) {
  index = (index + dir + views.length) % views.length;
  render();
}

function render() {
  clear(root);
  const s = store.state.settings || {};
  const current = views[index] || 'overview';
  const live = store.state.mode === 'browser'
    ? { cls: 'ok', label: 'DEMO' }
    : store.state.connected
      ? { cls: 'ok', label: 'LIVE' }
      : { cls: 'bad', label: 'RECONNECTING' };

  // Header
  const clock = h('div', { class: 'kiosk-clock', id: 'kiosk-clock' }, timeString());
  const header = h('header', { class: 'kiosk-header' },
    h('div', { class: 'kiosk-brand' },
      h('span', { class: 'kiosk-logo' }, icon('activity', 30)),
      h('div', {},
        h('div', { class: 'kiosk-shop' }, s.shopName || 'Shopline'),
        h('div', { class: 'kiosk-sub' }, s.shopSubtitle || ''),
      ),
    ),
    h('div', { class: 'kiosk-center' },
      h('div', { class: 'kiosk-view-title' }, TITLES[current]),
      h('div', { class: 'kiosk-dots' }, views.map((v, i) => h('span', { class: `kdot ${i === index ? 'on' : ''}`, title: TITLES[v], onclick: () => { index = i; render(); } }))),
    ),
    h('div', { class: 'kiosk-right' },
      clock,
      h('div', { class: 'kiosk-date' }, new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })),
      h('div', { class: `kiosk-live ${live.cls}` }, h('span', { class: 'dot' }), live.label),
    ),
  );

  const body = h('main', { class: 'kiosk-main' }, VIEWS[current]());

  const ticker = h('footer', { class: 'kiosk-ticker' },
    h('span', { class: 'ticker-label' }, 'ACTIVITY'),
    h('div', { class: 'ticker-track' },
      h('div', { class: 'ticker-run' },
        ...store.state.activity.slice(0, 8).map((a) => h('span', { class: 'ticker-item' }, `${a.text} · ${relTime(a.at)}`)),
      ),
    ),
  );

  append(root, [header, body, ticker]);
}

// ---- clock ---------------------------------------------------------------
function timeString() {
  return new Date().toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}
setInterval(() => {
  const clock = document.getElementById('kiosk-clock');
  if (clock) clock.textContent = timeString();
}, 1000);

// ---- boards --------------------------------------------------------------
const VIEWS = {
  overview() {
    const wos = store.col('workorders');
    const open = wos.filter((w) => w.status !== 'Done');
    const overdueWo = open.filter((w) => { const d = daysUntil(w.due); return d !== null && d < 0; });
    const parts = store.col('parts');
    const low = parts.filter((p) => Number(p.qty) <= Number(p.minQty));
    const schedule = store.col('schedule').map((r) => ({ ...r, ...computeFields('schedule', r) }));
    const overduePm = schedule.filter((s) => { const d = daysUntil(s.nextDue); return d !== null && d < 0; });
    const duePm = schedule.filter((s) => { const d = daysUntil(s.nextDue); return d !== null && d >= 0 && d <= 7; });
    const down = store.col('assets').filter((a) => a.status === 'Down' || a.status === 'Maintenance');

    const tiles = h('div', { class: 'k-tiles' },
      kTile('Open Work Orders', open.length, 'accent'),
      kTile('Overdue', overdueWo.length + overduePm.length, 'bad'),
      kTile('PM Due 7d', duePm.length, 'warn'),
      kTile('Low Stock', low.length, 'warn'),
      kTile('Assets Attention', down.length, 'bad'),
      kTile('On Shift', store.col('people').filter((p) => p.status !== 'Off').length, ''),
    );

    const attention = h('div', { class: 'k-panel' },
      h('div', { class: 'k-panel-head' }, icon('alert', 24), 'Attention Needed'),
      h('ul', { class: 'k-list' },
        ...[
          ...overdueWo.map((w) => ({ tone: 'bad', title: w.title, sub: `${w.priority} · ${overdueText(w.due)} overdue`, owner: ownerName(w.assigneeId) })),
          ...overduePm.map((s) => ({ tone: 'bad', title: s.task, sub: `${overdueText(s.nextDue)} overdue PM`, owner: ownerName(s.assigneeId) })),
          ...low.map((p) => ({ tone: 'warn', title: p.name, sub: `${p.qty} ${p.unit} on hand · min ${p.minQty}`, owner: p.location || '' })),
          ...down.map((a) => ({ tone: 'warn', title: a.name, sub: a.status, owner: a.location || '' })),
        ].slice(0, 9).map((row) => h('li', { class: `k-row ${row.tone}` },
          h('span', { class: `pulse ${row.tone}` }),
          h('div', { class: 'k-row-body' }, h('div', { class: 'k-row-title' }, row.title), h('div', { class: 'k-row-sub' }, row.sub)),
          h('div', { class: 'k-row-owner' }, row.owner),
        )),
        (!overdueWo.length && !overduePm.length && !low.length && !down.length)
          ? h('li', { class: 'k-row ok' }, icon('check', 22), h('div', { class: 'k-row-title' }, 'All clear'))
          : null,
      ),
    );

    return h('div', { class: 'k-overview' }, tiles, attention);
  },

  workorders() {
    const wos = store.col('workorders');
    const statuses = ['Backlog', 'Scheduled', 'In Progress', 'Waiting Parts', 'Done'];
    const board = h('div', { class: 'k-board' });
    for (const status of statuses) {
      const cards = wos.filter((w) => (w.status || 'Backlog') === status);
      const col = h('div', { class: 'k-col' },
        h('div', { class: 'k-col-head', style: { '--chip': COLORS[status] } }, h('span', {}, status), h('span', { class: 'k-count' }, cards.length)),
      );
      const shown = cards.slice(0, 7);
      for (const w of shown) {
        col.append(h('div', { class: `k-card ${daysUntil(w.due) !== null && daysUntil(w.due) < 0 && status !== 'Done' ? 'bad' : ''}` },
          h('div', { class: 'k-card-title' }, w.title),
          h('div', { class: 'k-card-meta' },
            h('span', { class: 'k-chip', style: { '--chip': COLORS[w.priority] } }, w.priority),
            w.due ? h('span', { class: 'k-due' }, fmtDateShort(w.due)) : null,
          ),
          h('div', { class: 'k-card-sub' }, [ownerName(w.assigneeId), w.assetId ? store.label('assets', w.assetId) : ''].filter(Boolean).join(' · ')),
        ));
      }
      if (cards.length > shown.length) col.append(h('div', { class: 'k-more' }, `+${cards.length - shown.length} more`));
      if (!shown.length) col.append(h('div', { class: 'k-more muted' }, '—'));
      board.append(col);
    }
    return board;
  },

  schedule() {
    const schedule = store.col('schedule').map((r) => ({ ...r, ...computeFields('schedule', r) }));
    const rows = schedule
      .filter((s) => { const d = daysUntil(s.nextDue); return d !== null && d <= 14; })
      .sort((a, b) => String(a.nextDue).localeCompare(String(b.nextDue)));
    return h('div', { class: 'k-panel wide' },
      h('div', { class: 'k-panel-head' }, icon('calendar', 24), `Due in the next 2 weeks (${rows.length})`),
      h('ul', { class: 'k-list big' }, rows.slice(0, 12).map((s) => {
        const d = daysUntil(s.nextDue);
        return h('li', { class: `k-row ${d < 0 ? 'bad' : d <= 3 ? 'warn' : ''}` },
          h('span', { class: 'k-date' }, fmtDateShort(s.nextDue)),
          h('div', { class: 'k-row-body' }, h('div', { class: 'k-row-title' }, s.task), h('div', { class: 'k-row-sub' }, s.assetId ? store.label('assets', s.assetId) : 'General')),
          h('div', { class: 'k-row-owner' }, d < 0 ? `${Math.abs(d)}d overdue` : d === 0 ? 'TODAY' : `in ${d}d`),
        );
      })),
      !rows.length ? h('div', { class: 'k-more' }, 'Nothing due — all caught up.') : null,
    );
  },

  parts() {
    const parts = store.col('parts');
    const low = parts.filter((p) => Number(p.qty) <= Number(p.minQty)).sort((a, b) => (Number(a.qty) / (Number(a.minQty) || 1)) - (Number(b.qty) / (Number(b.minQty) || 1)));
    return h('div', { class: 'k-panel wide' },
      h('div', { class: 'k-panel-head' }, icon('box', 24), `Parts to reorder (${low.length})`),
      h('ul', { class: 'k-list big' }, low.slice(0, 12).map((p) => h('li', { class: `k-row ${Number(p.qty) === 0 ? 'bad' : 'warn'}` },
        h('span', { class: 'k-qty' }, `${p.qty}`),
        h('div', { class: 'k-row-body' },
          h('div', { class: 'k-row-title' }, p.name),
          h('div', { class: 'k-row-sub' }, `${p.sku || 'no sku'} · min ${p.minQty} ${p.unit}${p.location ? ' · ' + p.location : ''}`),
        ),
        h('div', { class: 'k-row-owner' }, vendorName(p.vendorId)),
      ))),
      !low.length ? h('div', { class: 'k-more' }, 'Stock levels are healthy.') : null,
    );
  },

  assets() {
    const assets = store.col('assets');
    const order = { Down: 0, Maintenance: 1, Running: 2, Retired: 3 };
    const sorted = [...assets].sort((a, b) => (order[a.status] ?? 9) - (order[b.status] ?? 9));
    return h('div', { class: 'k-assets' }, sorted.map((a) => h('div', { class: `k-asset ${a.status === 'Down' ? 'bad' : a.status === 'Maintenance' ? 'warn' : ''}` },
      h('div', { class: 'k-asset-top' }, h('span', { class: 'k-dot', style: { background: COLORS[a.status] || '#64748b' } }), h('span', { class: 'k-asset-status' }, a.status)),
      h('div', { class: 'k-asset-name' }, a.name),
      h('div', { class: 'k-asset-sub' }, [a.location, a.criticality && `${a.criticality} crit`].filter(Boolean).join(' · ')),
    )));
  },

  // Closing slide for the wall board / website demo: what this product is.
  about() {
    const s = store.state.settings || {};
    const demo = store.state.mode === 'browser';
    const rows = [
      { title: s.brandName || 'Shopline', sub: s.brandTagline || 'Maintenance operations software', owner: s.brandUrl ? 'website' : '' },
      { title: 'What it tracks', sub: 'Work orders · preventive maintenance · parts & stock alerts · asset status · crew & vendors', owner: '' },
      { title: 'How it runs', sub: demo
        ? 'Demo mode — the whole shop runs right here in the browser, no server required'
        : 'Live mode — every screen on the shop network updates in real time', owner: '' },
      { title: 'Want one?', sub: s.brandUrl || s.shopSubtitle || 'Fully editable in place, on any shop PC or TV', owner: '' },
    ];
    return h('div', { class: 'k-panel wide' },
      h('div', { class: 'k-panel-head' }, icon('activity', 24), s.shopName || 'Shopline — Maintenance Dashboard'),
      h('ul', { class: 'k-list big' }, rows.map((row) => h('li', { class: 'k-row' },
        h('div', { class: 'k-row-body' },
          h('div', { class: 'k-row-title' }, row.title),
          h('div', { class: 'k-row-sub' }, row.sub),
        ),
        h('div', { class: 'k-row-owner' }, row.owner),
      ))),
    );
  },
};

function kTile(label, value, tone) {
  return h('div', { class: `k-tile ${tone}` }, h('div', { class: 'k-tile-value' }, String(value)), h('div', { class: 'k-tile-label' }, label));
}

function ownerName(id) {
  return store.label('people', id) || '';
}
function vendorName(id) {
  return store.label('vendors', id) || '';
}
function overdueText(dateStr) {
  const d = daysUntil(dateStr);
  return d === null ? '' : `${Math.abs(d)}d`;
}

// ---- controls ------------------------------------------------------------
document.addEventListener('keydown', (e) => {
  if (e.key === 'ArrowRight') advance(1);
  else if (e.key === 'ArrowLeft') advance(-1);
  else if (e.key === ' ') { e.preventDefault(); paused = !paused; render(); }
  else if (e.key.toLowerCase() === 'f') {
    if (document.fullscreenElement) document.exitFullscreen();
    else document.documentElement.requestFullscreen?.();
  }
});

(async function start() {
  window.__shoplineErrors = [];
  window.addEventListener('error', (e) => window.__shoplineErrors.push(String(e.error?.stack || e.message)));
  window.addEventListener('unhandledrejection', (e) => window.__shoplineErrors.push('unhandled: ' + String(e.reason?.stack || e.reason)));
  try {
    await store.load();
    applySettings();
    store.connect();
    render();
  } catch (err) {
    root.innerHTML = '';
    append(root, [h('div', { class: 'kiosk-loading' }, 'Cannot reach the server: ' + err.message)]);
  }
})();
