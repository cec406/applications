// Wall display / kiosk. Rotates through live boards, updates over SSE, and
// needs no interaction. Keys: ← → change board, Space pause, F fullscreen.
import { h, append, clear, fmtDateShort, fmtDayStrip, relTime, daysUntil, todayIso, shiftDays } from './util.js';
import { icon } from './icons.js';
import { computeFields, COLORS, itemSummary, KIOSK_VIEWS } from '../shared/schema.js';
import * as store from './store.js';

const root = document.getElementById('kiosk');
let views = ['board', 'schedule', 'weapons', 'notes'];
let index = 0;
let rotateSeconds = 14;
let paused = false;
let rotateTimer = null;

const TITLES = KIOSK_VIEWS;

store.subscribe((event) => {
  if (event.type === 'settings' || event.type === 'loaded') applySettings();
  render();
});

function applySettings() {
  const s = store.state.settings || {};
  rotateSeconds = Math.max(4, Number(s.rotateSeconds) || 14);
  if (typeof s.kioskViews === 'string' && s.kioskViews.trim()) {
    views = s.kioskViews.split(',').map((v) => v.trim()).filter((v) => TITLES[v]);
    if (!views.length) views = ['board'];
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
  const current = views[index] || 'board';

  // Header
  const clock = h('div', { class: 'kiosk-clock', id: 'kiosk-clock' }, timeString());
  const header = h('header', { class: 'kiosk-header' },
    h('div', { class: 'kiosk-brand' },
      h('span', { class: 'kiosk-logo' }, icon('activity', 30)),
      h('div', {},
        h('div', { class: 'kiosk-shop' }, s.shopName || 'Shop Ops'),
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
      h('div', { class: `kiosk-live ${store.state.connected ? 'ok' : 'bad'}` }, h('span', { class: 'dot' }), store.state.connected ? 'LIVE' : 'RECONNECTING'),
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

// ---- appointment helpers ---------------------------------------------------
function withComputed() {
  return store.col('appointments').map((r) => ({ ...r, ...computeFields('appointments', r) }));
}

function unitLabel(record) {
  return record.unitName || store.label('units', record.unitId) || '—';
}

// ---- boards --------------------------------------------------------------
const VIEWS = {
  // The star of the wall: every open drop-off / pickup, on the board from the
  // day it is scheduled until it is dropped off or picked up.
  board() {
    const today = todayIso();
    const all = withComputed();
    const open = all.filter((r) => r.status === 'Scheduled' || r.status === 'Arrived');
    const byWhen = (a, b) => `${a.date} ${a.time}`.localeCompare(`${b.date} ${b.time}`);
    const inbound = open.filter((r) => r.direction === 'Drop-off').sort(byWhen);
    const outbound = open.filter((r) => r.direction === 'Pickup').sort(byWhen);
    const overdue = all.filter((r) => r.overdue);

    const makeCol = (title, sub, dirIcon, cards) => {
      const col = h('div', { class: 'k-col k-col2' },
        h('div', { class: 'k-col-head', style: { '--chip': title === 'INBOUND' ? COLORS['Drop-off'] : COLORS['Pickup'] } },
          h('span', {}, icon(dirIcon, 20), ' ', title),
          h('span', { class: 'k-count' }, cards.length),
        ),
        h('div', { class: 'k-col-sub' }, sub),
      );
      const shown = cards.slice(0, 8);
      for (const r of shown) {
        const card = h('div', { class: `k-appt ${r.overdue ? 'bad' : ''}` },
          h('div', { class: 'k-appt-top' },
            h('span', { class: 'k-appt-time mono-time' }, r.time),
            h('span', { class: 'k-chip', style: { '--chip': COLORS[r.direction] } }, r.direction),
            h('span', { class: 'k-chip', style: { '--chip': COLORS[r.status] } }, r.status),
            r.date !== today ? h('span', { class: 'k-appt-date' }, fmtDateShort(r.date)) : null,
          ),
          h('div', { class: 'k-appt-unit' }, unitLabel(r)),
          r.items?.length ? h('div', { class: 'k-appt-items' },
            ...r.items.slice(0, 3).map((it) => h('div', {}, h('b', {}, `${it.qty}×`), ` ${it.eqType}${it.description ? ' — ' + it.description : ''}`)),
            r.items.length > 3 ? h('div', { class: 'muted' }, `+${r.items.length - 3} more lines`) : null,
          ) : null,
          r.notes ? h('div', { class: 'k-appt-notes' }, r.notes) : null,
        );
        col.append(card);
      }
      if (!shown.length) col.append(h('div', { class: 'k-more' }, title === 'INBOUND' ? 'No open drop-offs right now.' : 'No open pickups right now.'));
      if (cards.length > shown.length) col.append(h('div', { class: 'k-more' }, `+${cards.length - shown.length} more`));
      return col;
    };

    const wrap = h('div', { class: 'k-board2' });
    wrap.append(makeCol('INBOUND', 'scheduled & open until dropped off', 'arrowdown', inbound));
    wrap.append(makeCol('OUTBOUND', 'scheduled & open until picked up', 'arrowup', outbound));
    if (overdue.length) {
      wrap.append(h('div', { class: 'k-overdue-bar' },
        icon('alert', 20),
        `${overdue.length} OVERDUE — still scheduled from earlier days: ${overdue.slice(0, 4).map((r) => `${unitLabel(r)} (${fmtDateShort(r.date)})`).join(' · ')}`,
      ));
    }
    return wrap;
  },

  // Next seven days.
  schedule() {
    const today = todayIso();
    const horizon = shiftDays(today, 7);
    const all = withComputed()
      .filter((r) => r.date >= today && r.date <= horizon && r.status !== 'Cancelled')
      .sort((a, b) => `${a.date} ${a.time}`.localeCompare(`${b.date} ${b.time}`));
    const list = h('ul', { class: 'k-list big' });
    let lastDate = '';
    for (const r of all.slice(0, 18)) {
      if (r.date !== lastDate) {
        lastDate = r.date;
        list.append(h('li', { class: 'k-day-row' }, fmtDayStrip(r.date), r.date === today ? ' · TODAY' : ''));
      }
      const dirIcon = r.direction === 'Drop-off' ? 'arrowdown' : 'arrowup';
      list.append(h('li', { class: `k-row ${r.overdue ? 'bad' : r.date === today ? '' : ''}` },
        h('span', { class: 'k-date mono-time' }, r.time),
        h('span', { class: 'k-chip', style: { '--chip': COLORS[r.direction] } }, icon(dirIcon, 14), ' ', r.direction),
        h('div', { class: 'k-row-body' },
          h('div', { class: 'k-row-title' }, unitLabel(r)),
          h('div', { class: 'k-row-sub' }, itemSummary(r.items) || 'No equipment listed'),
        ),
        h('div', { class: 'k-row-owner' }, r.status),
      ));
    }
    if (!all.length) list.append(h('li', { class: 'k-row' }, h('div', { class: 'k-row-title muted' }, 'Nothing scheduled this week.')));
    return h('div', { class: 'k-panel wide' },
      h('div', { class: 'k-panel-head' }, icon('calendar', 24), `Next 7 days (${all.length})`),
      list,
    );
  },

  // Arms-room inventory.
  weapons() {
    const weapons = [...store.col('weapons')]
      .sort((a, b) => (Number(b.count) || 0) - (Number(a.count) || 0));
    const total = weapons.reduce((n, w) => n + (Number(w.count) || 0), 0);
    return h('div', { class: 'k-weapons' },
      h('div', { class: 'k-weapon-total' },
        h('div', { class: 'k-weapon-total-value' }, String(total)),
        h('div', { class: 'k-weapon-total-label' }, 'TOTAL ON HAND'),
      ),
      weapons.map((w) => h('div', { class: 'k-weapon' },
        h('div', { class: 'k-weapon-name' }, icon('target', 18), ' ', w.name),
        h('div', { class: 'k-weapon-count' }, String(Number(w.count) || 0)),
        w.notes ? h('div', { class: 'k-weapon-notes' }, w.notes) : null,
      )),
      !weapons.length ? h('div', { class: 'k-more' }, 'No weapon types tracked yet.') : null,
    );
  },

  // Shop notes pass-down board.
  notes() {
    const notes = store.col('notes').slice(0, 12);
    return h('div', { class: 'k-panel wide' },
      h('div', { class: 'k-panel-head' }, icon('note', 24), `Shop Notes (${store.col('notes').length})`),
      h('ul', { class: 'k-list big k-notes' }, notes.map((n, i) => h('li', { class: 'k-row' },
        h('span', { class: 'k-note-num' }, String(i + 1)),
        h('div', { class: 'k-row-body' },
          h('div', { class: 'k-note-text' }, n.message),
          h('div', { class: 'k-row-sub' }, relTime(n.createdAt)),
        ),
      ))),
      !notes.length ? h('div', { class: 'k-more' }, 'No notes posted.') : null,
    );
  },

  // Compact overview: numbers + attention list.
  overview() {
    const all = withComputed();
    const today = todayIso();
    const day = all.filter((r) => r.date === today && r.status !== 'Cancelled');
    const inbound = day.filter((r) => r.direction === 'Drop-off').reduce((n, r) => n + r.totalQty, 0);
    const outbound = day.filter((r) => r.direction === 'Pickup').reduce((n, r) => n + r.totalQty, 0);
    const overdue = all.filter((r) => r.overdue);
    const noShows = all.filter((r) => r.status === 'No-show');
    const weapons = store.col('weapons');
    const armsTotal = weapons.reduce((n, w) => n + (Number(w.count) || 0), 0);

    const tiles = h('div', { class: 'k-tiles k-tiles-6' },
      kTile("Today's Appts", day.length, 'accent'),
      kTile('Inbound Items', inbound, ''),
      kTile('Outbound Items', outbound, ''),
      kTile('Overdue', overdue.length, overdue.length ? 'bad' : ''),
      kTile('Weapons On Hand', armsTotal, ''),
      kTile('Weapon Types', weapons.length, ''),
    );

    const rows = [
      ...overdue.slice(0, 6).map((r) => ({ tone: 'bad', title: `${unitLabel(r)} — ${r.direction}`, sub: `${fmtDateShort(r.date)} ${r.time} · ${itemSummary(r.items) || 'no items'}` })),
      ...noShows.slice(0, 4).map((r) => ({ tone: 'warn', title: `${unitLabel(r)} — no-show`, sub: `${fmtDateShort(r.date)} ${r.time} · reschedule?` })),
      ...weapons.slice(0, 3).map((w) => ({ tone: '', title: w.name, sub: `${w.count} on hand`, owner: '' })),
    ].slice(0, 9);

    const attention = h('div', { class: 'k-panel' },
      h('div', { class: 'k-panel-head' }, icon('alert', 24), 'Attention Needed'),
      h('ul', { class: 'k-list' },
        ...rows.map((row) => h('li', { class: `k-row ${row.tone}` },
          h('span', { class: `pulse ${row.tone}` }),
          h('div', { class: 'k-row-body' }, h('div', { class: 'k-row-title' }, row.title), h('div', { class: 'k-row-sub' }, row.sub)),
          h('div', { class: 'k-row-owner' }, row.owner || ''),
        ))),
      (!overdue.length && !noShows.length)
        ? h('li', { class: 'k-row ok' }, icon('check', 22), h('div', { class: 'k-row-title' }, 'All clear — every appointment handled'))
        : null,
    );

    return h('div', { class: 'k-overview' }, tiles, attention);
  },
};

function kTile(label, value, tone) {
  return h('div', { class: `k-tile ${tone}` }, h('div', { class: 'k-tile-value' }, String(value)), h('div', { class: 'k-tile-label' }, label));
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
