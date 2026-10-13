// Seed data.
//
// buildSeed() creates an EMPTY shop: no appointments, units, weapons or notes.
// It only sets sensible defaults plus a starter list of equipment types (pure
// suggestions in the appointment form — editable in Settings).
//
// buildSample() returns the demo dataset that used to seed the app; it is kept
// for the test suite and for anyone who wants a populated demo.
import { defaultSettings } from './schema.js';

const sid = (p) => `${p}-${Math.random().toString(36).slice(2, 8)}`;

// Common suggestions for the "equipment type" field. Free text always works.
const STARTER_EQTYPES = [
  'Generator', 'Radio', 'Optic', 'Weapon Case', 'Vehicle Kit', 'Computer',
  'Tool Kit', 'Comms', 'Tent', 'Water Buffalo', 'Night Vision',
];

export function buildSeed() {
  return {
    meta: { version: 1, seededAt: new Date().toISOString() },
    settings: { ...defaultSettings },
    units: [],
    eqtypes: STARTER_EQTYPES.map((name) => ({ id: sid('eqt'), name })),
    appointments: [],
    weapons: [],
    notes: [],
    activity: [
      { id: sid('act'), at: new Date().toISOString(), actor: 'system', text: 'Empty workspace created' },
    ],
  };
}

function iso(offsetDays) {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// A populated demo shop (used by tests; you can wire it to a "load sample data"
// button later if you ever want it back).
export function buildSample() {
  const units = [
    { id: 'unit-a', name: 'A/2-1 IN', poc: 'SGT Ruiz', phone: 'kx 2105', notes: 'Turn-ins usually Tue/Thu mornings.' },
    { id: 'unit-b', name: 'B/2-1 IN', poc: 'SSG Calloway', phone: 'kx 2210', notes: '' },
    { id: 'unit-hhc', name: 'HHC', poc: 'SFC Delgado', phone: 'kx 2001', notes: '' },
    { id: 'unit-ccc', name: 'C/2-1 IN', poc: 'SPD Vance', phone: 'kx 2318', notes: 'Draws comms gear ahead of JRTC.' },
  ];

  const appointments = [
    {
      id: sid('apt'), date: iso(0), time: '07:30', unitId: 'unit-a', direction: 'Drop-off', status: 'Scheduled',
      items: [
        { eqType: 'Generator', qty: 1, description: 'MEP-831B — 400Hz fault' },
        { eqType: 'Vehicle Kit', qty: 1, description: 'M1152 tool kit, lost jack' },
      ],
      poc: 'SGT Ruiz', notes: 'Gate pass filed under MTM-0117.',
    },
    {
      id: sid('apt'), date: iso(0), time: '09:00', unitId: 'unit-b', direction: 'Pickup', status: 'Scheduled',
      items: [
        { eqType: 'Optic', qty: 4, description: 'TA31ECOS — zero confirmation done' },
        { eqType: 'Weapon Case', qty: 2, description: '' },
      ],
      poc: 'SSG Calloway', notes: 'Bring DD Form 314s.',
    },
    {
      id: sid('apt'), date: iso(0), time: 'TBD', unitId: 'unit-hhc', direction: 'Drop-off', status: 'Scheduled',
      items: [{ eqType: 'Comms', qty: 1, description: 'JBCP Suite — annual PMCS' }],
      poc: 'SFC Delgado', notes: 'Time to be confirmed.',
    },
    {
      id: sid('apt'), date: iso(1), time: '08:00', unitId: 'unit-b', direction: 'Drop-off', status: 'Scheduled',
      items: [{ eqType: 'Generator', qty: 3, description: 'TES subset — 100hr services' }],
      poc: 'SSG Calloway', notes: '',
    },
    {
      id: sid('apt'), date: iso(2), time: '10:30', unitId: 'unit-a', direction: 'Pickup', status: 'Scheduled',
      items: [{ eqType: 'Generator', qty: 2, description: 'MEP-803A — fuel leak repaired' }],
      poc: 'SGT Ruiz', notes: '',
    },
  ];

  const weapons = [
    { id: sid('wpn'), name: 'M4 Carbine', count: 42, notes: '12 allocated to ranges this month.' },
    { id: sid('wpn'), name: 'M17', count: 24, notes: '' },
    { id: sid('wpn'), name: 'M249 SAW', count: 7, notes: '2 in transit to DS for barrel swap.' },
    { id: sid('wpn'), name: 'M240B', count: 9, notes: '' },
  ];

  const notes = [
    { message: 'Range 12 closed Friday 0800–1600 — no scheduled draws that day.' },
    { message: 'Turn-in NCO this week: SGT Ruiz (kx 2105).' },
  ];

  return {
    ...buildSeed(),
    units,
    appointments,
    weapons,
    notes,
  };
}
