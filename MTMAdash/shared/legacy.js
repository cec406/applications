// Legacy import: migrate data from the old Streamlit shop tracker.
// The old app used three CSV files with these shapes:
//
//   equipment.csv   TIME,Unit,Equipment,Direction,Notes
//                   TIME is "MM/DD HH:MM"; Equipment may hold several lines.
//   weapons.csv     Weapon,Count
//   shop_notes.csv  Message
//
// Everything here is pure (no DOM, no fetch) so it can be unit-tested in Node
// and reused by the browser importer.

export function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  const src = String(text ?? '').replace(/^\uFEFF/, '');
  let i = 0;
  const push = () => {
    row.push(field);
    field = '';
  };
  const endRow = () => {
    // Drop truly blank lines (no cells, or the leftover of a trailing newline).
    if (row.length && !(row.length === 1 && row[0] === '')) rows.push(row);
    row = [];
  };
  while (i < src.length) {
    const c = src[i];
    if (inQuotes) {
      if (c === '"') {
        if (src[i + 1] === '"') { field += '"'; i += 2; continue; }
        inQuotes = false; i += 1; continue;
      }
      field += c; i += 1; continue;
    }
    if (c === '"') { inQuotes = true; i += 1; continue; }
    if (c === ',') { push(); i += 1; continue; }
    if (c === '\r') { i += 1; continue; }
    if (c === '\n') { push(); endRow(); i += 1; continue; }
    field += c; i += 1;
  }
  push();
  endRow();
  return rows;
}

export function rowsToObjects(rows) {
  if (!rows.length) return [];
  const header = rows[0].map((h) => h.trim().toLowerCase());
  return rows.slice(1).map((cells) => {
    const obj = {};
    header.forEach((key, i) => { obj[key] = (cells[i] ?? '').trim(); });
    return obj;
  });
}

function pad(n) { return String(n).padStart(2, '0'); }

// "MM/DD HH:MM" (optionally "MM/DD/YYYY HH:MM", time optional) -> { date, time }
// Legacy files usually carry no year: use the current year, but if that would
// land more than ~9 months in the future assume the entry belongs to last year.
export function parseLegacyTime(raw, today = new Date()) {
  const out = { date: '', time: '09:00' };
  const text = String(raw ?? '').trim();
  if (!text) return out;
  const m = text.match(/^(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\s*,?\s*(?:(\d{1,2}):(\d{2}))?/);
  if (!m) return out;
  const month = Number(m[1]);
  const day = Number(m[2]);
  let year = m[3] ? Number(m[3]) : null;
  if (year !== null && year < 100) year += 2000;
  if (m[4] !== undefined) out.time = `${pad(Number(m[4]) % 24)}:${pad(Number(m[5]))}`;
  if (!(month >= 1 && month <= 12 && day >= 1 && day <= 31)) return out;

  if (year === null) {
    year = today.getFullYear();
    const candidate = new Date(year, month - 1, day, 12);
    const diffDays = (candidate.getTime() - new Date(today.getFullYear(), today.getMonth(), today.getDate(), 12).getTime()) / 86400000;
    if (diffDays > 270) year -= 1; // stale rows from last year
  }
  out.date = `${year}-${pad(month)}-${pad(day)}`;
  return out;
}

const DIRECTION_MAP = {
  incoming: 'Drop-off', inbound: 'Drop-off', dropoff: 'Drop-off', 'drop-off': 'Drop-off',
  outgoing: 'Pickup', outbound: 'Pickup', pickup: 'Pickup', 'pick-up': 'Pickup',
};

export function mapDirection(raw) {
  return DIRECTION_MAP[String(raw ?? '').trim().toLowerCase()] || 'Drop-off';
}

// Split a legacy "Equipment" cell (one line per item) into item objects.
// Quantities need an explicit marker ("Generator x3" / "Radio ×2") so serial
// numbers like "MEP-803A #7" or "Trailer 3" stay untouched.
export function parseEquipmentLines(raw) {
  return String(raw ?? '')
    .split(/\r?\n|;+/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const m = line.match(/^(.*?)(?:\s+[xX×]\s*|\s*×\s*)(\d{1,4})$/);
      if (m && m[1].trim()) {
        return { eqType: m[1].trim().replace(/[,;]$/, ''), qty: Math.min(9999, Number(m[2])), description: '' };
      }
      return { eqType: line.replace(/[,;]$/, ''), qty: 1, description: '' };
    })
    .slice(0, 50);
}

function isoOf(d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/**
 * Detect the kind of CSV from its header and map it onto this app's records.
 * Returns { kind, records, warnings } or null when the header is unrecognized.
 */
export function mapLegacyCsv(text, today = new Date()) {
  const rows = rowsToObjects(parseCsv(text));
  if (!rows.length) return null;
  const keys = Object.keys(rows[0]);
  const has = (k) => keys.includes(k);
  const warnings = [];

  if (has('time') && has('unit') && has('equipment')) {
    const records = [];
    for (const row of rows) {
      const { date, time } = parseLegacyTime(row['time'], today);
      const unit = (row['unit'] || '').trim();
      const equipment = row['equipment'] ?? '';
      const notes = (row['notes'] || '').trim();
      const direction = mapDirection(row['direction']);
      if (!unit && !equipment) continue;
      const items = parseEquipmentLines(equipment);
      if (!items.length && unit) { /* keep unit-only appointment */ }
      if (!date) warnings.push(`Unreadable time "${row['time']}" — defaulted date`);
      const status = date && date < isoOf(today) ? 'Completed' : 'Scheduled';
      records.push({ date: date || isoOf(today), time, unitId: unit, direction, status, items, poc: '', notes });
    }
    return { kind: 'appointments', records, warnings };
  }

  if (has('weapon')) {
    const records = [];
    for (const row of rows) {
      const name = (row['weapon'] || '').trim();
      if (!name) continue;
      const count = Math.max(0, Math.round(Number(row['count']) || 0));
      records.push({ name, count, notes: (row['notes'] || '').trim() });
    }
    return { kind: 'weapons', records, warnings };
  }

  if (has('message')) {
    const records = [];
    for (const row of rows) {
      const message = (row['message'] || '').trim();
      if (!message) continue;
      records.push({ message });
    }
    return { kind: 'notes', records, warnings };
  }

  return null;
}

/** Map several CSV files at once: [{ name, text }] -> combined payload. */
export function importLegacyCsvFiles(files, today = new Date()) {
  const payload = { appointments: [], weapons: [], notes: [], warnings: [], detected: [] };
  for (const file of files || []) {
    try {
      const mapped = mapLegacyCsv(file.text, today);
      if (!mapped) {
        payload.warnings.push(`${file.name}: unrecognized columns — skipped`);
        continue;
      }
      payload.detected.push(`${file.name} → ${mapped.kind} (${mapped.records.length} rows)`);
      payload[mapped.kind].push(...mapped.records);
      payload.warnings.push(...mapped.warnings.map((w) => `${file.name}: ${w}`));
    } catch (err) {
      payload.warnings.push(`${file.name}: ${err.message}`);
    }
  }
  // De-duplicate weapon names (last one wins) and note texts.
  payload.weapons = [...new Map(payload.weapons.map((r) => [r.name.toLowerCase(), r])).values()];
  payload.notes = [...new Set(payload.notes.map((r) => r.message))].map((message) => ({ message }));
  return payload;
}
