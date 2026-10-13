// Reusable UI building blocks: chips, toasts, modal forms, inline-editable
// data tables and the drag-and-drop work order board.
import { h, append, clear, fmtDate, fmtDateShort, daysUntil, dueLabel, money, relTime } from './util.js?v=20261012-3';
import { icon } from './icons.js?v=20261012-3';
import { COLORS, collectionByName, TYPES } from '../../shared/schema.js?v=20261012-3';
import * as store from './store.js?v=20261012-3';

// ---- chips / badges ------------------------------------------------------
export function chip(text, color) {
  if (!text) return h('span', { class: 'muted' }, '—');
  return h('span', { class: 'chip', style: color ? { '--chip': color } : null }, text);
}

export function statusChip(value) {
  return chip(value, COLORS[value]);
}

export function dueBadge(days) {
  const { text, tone } = dueLabel(days);
  if (!text) return h('span', { class: 'muted' }, '—');
  return h('span', { class: `badge ${tone}` }, text);
}

// ---- toasts --------------------------------------------------------------
let toastHost = null;
export function toast(message, tone = 'ok') {
  if (!toastHost) {
    toastHost = h('div', { class: 'toast-host' });
    document.body.append(toastHost);
  }
  const node = h('div', { class: `toast ${tone}` }, icon(tone === 'error' ? 'alert' : 'check', 16), h('span', {}, message));
  toastHost.append(node);
  setTimeout(() => {
    node.classList.add('out');
    setTimeout(() => node.remove(), 300);
  }, 2600);
}

// ---- confirm dialog ------------------------------------------------------
export function confirmDialog({ title = 'Are you sure?', message = '', confirmLabel = 'Delete' } = {}) {
  return new Promise((resolve) => {
    const overlay = h('div', { class: 'overlay' });
    const close = (val) => {
      overlay.remove();
      document.removeEventListener('keydown', onKey);
      resolve(val);
    };
    const onKey = (e) => {
      if (e.key === 'Escape') close(false);
    };
    document.addEventListener('keydown', onKey);
    const dialog = h('div', { class: 'dialog small', role: 'dialog', 'aria-modal': 'true' },
      h('div', { class: 'dialog-head' }, h('h3', {}, title)),
      message ? h('div', { class: 'dialog-body' }, h('p', {}, message)) : null,
      h('div', { class: 'dialog-foot' },
        h('button', { class: 'btn ghost', onclick: () => close(false) }, 'Cancel'),
        h('button', { class: 'btn danger', onclick: () => close(true) }, confirmLabel),
      ),
    );
    overlay.append(dialog);
    overlay.addEventListener('mousedown', (e) => { if (e.target === overlay) close(false); });
    document.body.append(overlay);
    dialog.querySelector('.btn.danger').focus();
  });
}

// ---- modal form ----------------------------------------------------------
export function openForm({ collection, record = null, onSaved }) {
  const meta = collectionByName[collection];
  const isEdit = Boolean(record?.id);
  const draft = {};
  for (const field of meta.fields) {
    if (field.type === 'computed') continue;
    draft[field.key] = record ? record[field.key] : field.default ?? '';
  }
  const inputs = new Map();
  const overlay = h('div', { class: 'overlay' });

  const close = () => {
    overlay.remove();
    document.removeEventListener('keydown', onKey);
  };
  const onKey = (e) => {
    if (e.key === 'Escape') close();
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) submit();
  };
  document.addEventListener('keydown', onKey);

  async function submit() {
    const patch = {};
    for (const [key, input] of inputs) patch[key] = readInput(input);
    try {
      await store.save(collection, isEdit ? record.id : null, patch);
      toast(`${isEdit ? 'Saved' : 'Added'} ${meta.singular.toLowerCase()}`);
      close();
      onSaved?.();
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  const form = h('form', { class: 'dialog', role: 'dialog', 'aria-modal': 'true', onsubmit: (e) => { e.preventDefault(); submit(); } });
  form.append(
    h('div', { class: 'dialog-head' },
      h('h3', {}, isEdit ? `Edit ${meta.singular}` : `New ${meta.singular}`),
      iconButton('x', close, 'Close'),
    ),
  );
  const grid = h('div', { class: 'form-grid' });
  for (const field of meta.fields) {
    if (field.type === 'computed') continue;
    const input = fieldControl(field, draft[field.key]);
    inputs.set(field.key, input);
    grid.append(h('label', { class: `field ${field.type === TYPES.TEXTAREA ? 'full' : ''}` },
      h('span', { class: 'field-label' }, field.label, field.required ? h('em', {}, '*') : null),
      input,
    ));
  }
  form.append(h('div', { class: 'dialog-body' }, grid));
  form.append(
    h('div', { class: 'dialog-foot' },
      isEdit ? h('button', {
        type: 'button', class: 'btn danger ghost-soft',
        onclick: async () => {
          if (await confirmDialog({ title: `Delete ${meta.singular}?`, message: 'This cannot be undone.' })) {
            await store.remove(collection, record.id);
            toast('Deleted');
            close();
            onSaved?.();
          }
        },
      }, icon('trash', 16), 'Delete') : h('span', {}),
      h('span', { class: 'spacer' }),
      h('button', { type: 'button', class: 'btn ghost', onclick: close }, 'Cancel'),
      h('button', { type: 'submit', class: 'btn primary' }, icon('save', 16), isEdit ? 'Save Changes' : `Add ${meta.singular}`),
    ),
  );

  overlay.append(form);
  overlay.addEventListener('mousedown', (e) => { if (e.target === overlay) close(); });
  document.body.append(overlay);
  const first = grid.querySelector('input, select, textarea');
  first?.focus();
}

function readInput(input) {
  if (input.dataset.kind === 'bool') return input.checked;
  return input.value;
}

// A form control for a schema field, editable in the modal.
export function fieldControl(field, value) {
  const common = { id: `f-${field.key}`, class: 'input' };
  switch (field.type) {
    case TYPES.TEXTAREA:
      return h('textarea', { ...common, rows: 3, value: value ?? '' });
    case TYPES.SELECT: {
      const sel = h('select', common);
      sel.append(h('option', { value: '' }, '—'));
      for (const opt of field.options || []) sel.append(h('option', { value: opt, selected: opt === value }, opt));
      return sel;
    }
    case TYPES.REF: {
      const sel = h('select', common);
      sel.dataset.kind = 'text';
      sel.append(h('option', { value: '' }, '— none —'));
      for (const opt of store.options(field.ref)) sel.append(h('option', { value: opt.value, selected: opt.value === value }, opt.label));
      return sel;
    }
    case TYPES.NUMBER:
      return h('input', { ...common, type: 'number', step: field.step ?? 'any', value: value ?? '' });
    case TYPES.CURRENCY:
      return h('input', { ...common, type: 'number', step: '0.01', min: 0, value: value ?? '' });
    case TYPES.DATE:
      return h('input', { ...common, type: 'date', value: value ?? '' });
    case TYPES.BOOL: {
      const wrap = h('label', { class: 'switch' });
      const input = h('input', { type: 'checkbox', checked: Boolean(value) });
      input.dataset.kind = 'bool';
      wrap.append(input, h('span', { class: 'track' }), h('span', { class: 'switch-label' }, value ? 'On' : 'Off'));
      return wrap;
    }
    case TYPES.EMAIL:
      return h('input', { ...common, type: 'email', value: value ?? '' });
    case TYPES.TEL:
      return h('input', { ...common, type: 'tel', value: value ?? '' });
    case TYPES.URL:
      return h('input', { ...common, type: 'text', placeholder: 'https:// or \\\\server\\share', value: value ?? '' });
    default:
      return h('input', { ...common, type: 'text', value: value ?? '' });
  }
}

export function iconButton(name, onClick, title, extraClass = '') {
  return h('button', { type: 'button', class: `icon-btn ${extraClass}`, title, 'aria-label': title, onclick: onClick }, icon(name, 17));
}

// ---- value rendering -----------------------------------------------------
export function displayValue(field, record) {
  const raw = record[field.key];
  switch (field.type) {
    case 'computed': {
      if (field.key === 'nextDue') {
        const days = record.daysUntilDue;
        return h('span', { class: 'inline-gap' }, h('span', {}, fmtDateShort(raw)), dueBadge(days));
      }
      return String(raw ?? '');
    }
    case TYPES.SELECT:
      return statusChip(raw);
    case TYPES.REF:
      return store.label(field.ref, raw) || h('span', { class: 'muted' }, '—');
    case TYPES.DATE: {
      if (field.key === 'due') {
        return h('span', { class: 'inline-gap' }, h('span', {}, fmtDateShort(raw)), dueBadge(daysUntil(raw)));
      }
      return fmtDateShort(raw) || h('span', { class: 'muted' }, '—');
    }
    case TYPES.CURRENCY:
      return money(raw) || h('span', { class: 'muted' }, '—');
    case TYPES.BOOL:
      return raw ? icon('check', 16) : h('span', { class: 'muted' }, '—');
    case TYPES.URL:
      return urlCell(raw);
    case TYPES.NUMBER:
      return raw === null || raw === undefined || raw === '' ? h('span', { class: 'muted' }, '—') : String(raw);
    default:
      return raw === '' || raw === null || raw === undefined ? h('span', { class: 'muted' }, '—') : String(raw);
  }
}

function urlCell(url) {
  if (!url) return h('span', { class: 'muted' }, '—');
  const isWeb = /^https?:\/\//i.test(url);
  const label = h('span', { class: 'path-text', title: url }, url);
  const node = h('span', { class: 'path-cell' }, label);
  if (isWeb) {
    node.append(iconButton('external', () => window.open(url, '_blank', 'noopener'), 'Open link', 'tiny'));
  } else {
    node.append(iconButton('link', async () => {
      try {
        await navigator.clipboard.writeText(url);
        toast('Path copied to clipboard');
      } catch {
        toast('Copy failed', 'error');
      }
    }, 'Copy network path', 'tiny'));
  }
  return node;
}

// ---- inline editable table ----------------------------------------------
export function dataTable({ collection, items, sort, onSort, rowClass, extraActions, hiddenColumns = [] }) {
  const meta = collectionByName[collection];
  const columns = meta.fields.filter((f) => f.table !== false && !hiddenColumns.includes(f.key));
  const table = h('table', { class: 'data-table' });

  const thead = h('thead');
  const headRow = h('tr');
  for (const field of columns) {
    const active = sort?.key === field.key;
    headRow.append(h('th', {
      class: `${field.width === 'wide' ? 'wide' : ''} ${active ? 'sorted' : ''} sortable`,
      onclick: () => onSort?.(field.key),
      title: 'Sort by ' + field.label,
    }, h('span', {}, field.label), active ? h('span', { class: 'sort-arrow' }, sort.dir === 'desc' ? '▾' : '▴') : null));
  }
  headRow.append(h('th', { class: 'actions-col' }, ''));
  thead.append(headRow);
  table.append(thead);

  const tbody = h('tbody');
  if (!items.length) {
    tbody.append(h('tr', {}, h('td', { colspan: columns.length + 1, class: 'empty' },
      `No ${meta.label.toLowerCase()} yet — click "Add ${meta.singular}" to create one.`)));
  }
  for (const record of items) {
    const tr = h('tr', { class: rowClass ? rowClass(record) : '', dataset: { id: record.id } });
    for (const field of columns) {
      tr.append(editableCell(collection, record, field));
    }
    const actions = h('td', { class: 'actions-col' });
    if (extraActions) append(actions, extraActions(record));
    actions.append(
      iconButton('edit', () => openForm({ collection, record }), 'Edit'),
      iconButton('trash', async () => {
        if (await confirmDialog({ title: `Delete ${meta.singular}?`, message: `"${record[meta.primary]}" will be removed.` })) {
          await store.remove(collection, record.id);
          toast('Deleted');
        }
      }, 'Delete', 'danger-hover'),
    );
    tr.append(actions);
    tbody.append(tr);
  }
  table.append(tbody);
  return table;
}

function editableCell(collection, record, field) {
  const td = h('td', { class: `${field.width === 'wide' ? 'wide' : ''} editable`, tabindex: '0' });
  const render = () => {
    clear(td);
    td.append(displayValue(field, record));
  };
  td.append(displayValue(field, record));

  const enterEdit = () => {
    if (field.type === 'computed') return;
    const input = inlineControl(field, record[field.key]);
    clear(td);
    td.append(input);
    input.focus();
    if (input.select) input.select();

    let done = false;
    const commit = async (save) => {
      if (done) return;
      done = true;
      const value = readInput(input);
      render();
      if (save && String(value) !== String(record[field.key] ?? '')) {
        try {
          await store.save(collection, record.id, { [field.key]: value });
        } catch (err) {
          toast(err.message, 'error');
        }
      }
    };
    input.addEventListener('blur', () => commit(true));
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); input.blur(); }
      if (e.key === 'Escape') { e.preventDefault(); done = true; render(); }
    });
    if (input.tagName === 'SELECT') input.addEventListener('change', () => commit(true));
  };

  td.addEventListener('click', (e) => {
    if (td.classList.contains('editing')) return;
    if (e.target.closest('.icon-btn')) return;
    enterEdit();
  });
  td.addEventListener('keydown', (e) => { if (e.key === 'Enter') enterEdit(); });
  return td;
}

function inlineControl(field, value) {
  const input = fieldControl(field, value);
  input.classList.add('inline-input');
  return input;
}

// ---- kanban board --------------------------------------------------------
export function workBoard({ collection = 'workorders', onOpen }) {
  const meta = collectionByName[collection];
  const statusField = meta.fields.find((f) => f.key === meta.statusKey);
  const columns = statusField.options;
  const board = h('div', { class: 'board' });
  const all = store.col(collection);

  for (const status of columns) {
    const cards = all.filter((r) => (r[meta.statusKey] || columns[0]) === status);
    const columnEl = h('div', { class: 'board-col', dataset: { status } });
    columnEl.append(h('div', { class: 'board-col-head' },
      statusChip(status),
      h('span', { class: 'count' }, cards.length),
    ));
    const bodyEl = h('div', { class: 'board-col-body' });
    for (const record of cards) bodyEl.append(boardCard(meta, record, onOpen));
    bodyEl.append(h('div', { class: 'board-empty' }, cards.length ? '' : 'Drop here'));
    columnEl.append(bodyEl);
    enableDropTarget(columnEl, meta, status);
    board.append(columnEl);
  }
  return board;
}

function boardCard(meta, record, onOpen) {
  const card = h('article', { class: 'card', draggable: 'true', dataset: { id: record.id } });
  card.append(h('div', { class: 'card-top' }, statusChip(record.priority)));
  card.append(h('h4', { class: 'card-title' }, record[meta.primary]));
  const bits = [];
  if (record.assetId) bits.push(h('span', { class: 'card-bit' }, icon('machine', 13), store.label('assets', record.assetId)));
  if (record.assigneeId) bits.push(h('span', { class: 'card-bit' }, icon('people', 13), store.label('people', record.assigneeId)));
  if (record.due) bits.push(h('span', { class: 'card-bit' }, icon('calendar', 13), fmtDateShort(record.due)));
  if (bits.length) card.append(h('div', { class: 'card-bits' }, bits));
  if (record.due) card.append(dueBadge(daysUntil(record.due)));
  card.addEventListener('dragstart', (e) => {
    e.dataTransfer.setData('text/plain', record.id);
    e.dataTransfer.effectAllowed = 'move';
    card.classList.add('dragging');
  });
  card.addEventListener('dragend', () => card.classList.remove('dragging'));
  card.addEventListener('click', () => onOpen?.(record));
  return card;
}

function enableDropTarget(columnEl, meta, status) {
  columnEl.addEventListener('dragover', (e) => {
    e.preventDefault();
    columnEl.classList.add('over');
  });
  columnEl.addEventListener('dragleave', () => columnEl.classList.remove('over'));
  columnEl.addEventListener('drop', async (e) => {
    e.preventDefault();
    columnEl.classList.remove('over');
    const id = e.dataTransfer.getData('text/plain');
    const record = store.byId(meta.name, id);
    if (!record || record[meta.statusKey] === status) return;
    try {
      await store.save(meta.name, id, { [meta.statusKey]: status });
      if (status === 'Done') toast(`"${record[meta.primary]}" marked done`);
    } catch (err) {
      toast(err.message, 'error');
    }
  });
}

// ---- misc ----------------------------------------------------------------
export function sectionHeader(title, subtitle, ...actions) {
  return h('div', { class: 'section-head' },
    h('div', {}, h('h2', {}, title), subtitle ? h('p', { class: 'muted' }, subtitle) : null),
    h('div', { class: 'section-actions' }, ...actions),
  );
}

export function activityList(items, limit = 12) {
  const list = h('ul', { class: 'activity' });
  for (const item of items.slice(0, limit)) {
    list.append(h('li', {},
      h('span', { class: 'dot' }),
      h('div', {},
        h('div', {}, item.text),
        h('div', { class: 'muted small' }, `${item.actor || 'unknown'} · ${relTime(item.at)}`),
      ),
    ));
  }
  if (!items.length) list.append(h('li', { class: 'muted' }, 'No activity yet.'));
  return list;
}

export function kpi(label, value, tone = '', sub = '') {
  return h('div', { class: `kpi ${tone}` },
    h('div', { class: 'kpi-value' }, String(value)),
    h('div', { class: 'kpi-label' }, label),
    sub ? h('div', { class: 'kpi-sub' }, sub) : null,
  );
}

export function barChart(entries) {
  const max = Math.max(1, ...entries.map((e) => e.value));
  const wrap = h('div', { class: 'bars' });
  for (const e of entries) {
    wrap.append(h('div', { class: 'bar-row' },
      h('span', { class: 'bar-label' }, e.label),
      h('div', { class: 'bar-track' }, h('div', { class: 'bar-fill', style: { width: `${(e.value / max) * 100}%`, background: e.color || 'var(--accent)' } })),
      h('span', { class: 'bar-value' }, String(e.value)),
    ));
  }
  return wrap;
}
