// Sample fleet data so the dashboard is useful the moment it starts.
// Relative dates are generated at seed time so the demo always looks current.
// Demo company: Montana Fleet Solutions LLC — construction equipment fleet
// service and repair.
//
// ALL sample contacts are fictional: phone numbers use the reserved 555-01XX
// block, email/URL domains use the reserved .example TLD, and serials,
// account numbers, people and vendor names are invented.
import { defaultSettings } from './schema.js';

function iso(offsetDays) {
  const d = new Date();
  d.setHours(12, 0, 0, 0);
  d.setDate(d.getDate() + offsetDays);
  return d.toISOString().slice(0, 10);
}

const uid = (p) => `${p}-${Math.random().toString(36).slice(2, 8)}`;

export function buildSeed() {
  const people = [
    { id: 'per-jo', name: 'Jo Ramirez', role: 'Service Manager', shift: 'Day', status: 'Available', phone: 'ext. 200', email: 'jo@mtfleet.example' },
    { id: 'per-dana', name: 'Dana Whitfield', role: 'Lead Mechanic', shift: 'Day', status: 'Available', phone: 'ext. 204', email: 'dana@mtfleet.example' },
    { id: 'per-miguel', name: 'Miguel Ortega', role: 'Diesel Mechanic', shift: 'Day', status: 'On Job', phone: 'ext. 211', email: 'miguel@mtfleet.example' },
    { id: 'per-sam', name: 'Sam Chen', role: 'Hydraulic Technician', shift: 'Swing', status: 'Available', phone: 'ext. 218', email: 'sam@mtfleet.example' },
    { id: 'per-riley', name: 'Riley Novak', role: 'Field Service Tech', shift: 'Swing', status: 'Available', phone: 'ext. 220', email: 'riley@mtfleet.example' },
    { id: 'per-kim', name: 'Kim Patel', role: 'Welder / Fabricator', shift: 'Night', status: 'Off', phone: 'ext. 226', email: 'kim@mtfleet.example' },
  ];

  const vendors = [
    { id: 'ven-bigsky', name: 'Big Sky Equipment Parts', category: 'Filters, fluids, wear parts', contact: 'R. Alvarez', phone: '555-0142', email: 'orders@bigsky-parts.example', leadTimeDays: 2, notes: 'Net-30 account #BSEP-4471' },
    { id: 'ven-yellow', name: 'Yellow Iron Hydraulics', category: 'Hoses, cylinders, pumps', contact: 'T. Brooks', phone: '555-0110', email: 'sales@yellowiron.example', leadTimeDays: 4, notes: 'Hose pressing drop-off before 3p for next-day.' },
    { id: 'ven-under', name: 'Underfoot Undercarriage Co.', category: 'Tracks, sprockets, G.E.T.', contact: 'L. Nguyen', phone: '555-0173', email: 'lnguyen@underfoot.example', leadTimeDays: 7, notes: 'Wear-measurement service available.' },
    { id: 'ven-fleetwest', name: 'Fleetwest Fleet Supply', category: 'General MRO, DEF, batteries', contact: 'Web order', phone: '555-0188', email: 'support@fleetwest.example', leadTimeDays: 1, notes: 'Will-call counter open 7a-6p' },
    { id: 'ven-battery', name: 'Northern Battery & Electric', category: 'Starters, alternators, batteries', contact: 'Front desk', phone: '555-0199', email: 'counter@northbattery.example', leadTimeDays: 3, notes: '' },
  ];

  const assets = [
    { id: 'ast-exc320', name: 'Cat 320 Excavator', status: 'Running', category: 'Excavator', criticality: 'High', location: 'Big Sky job site', manufacturer: 'Caterpillar', model: '320 GC', serial: 'CAT-320-88231', installedOn: iso(-1460), notes: 'Primary excavator — dedicated to digging and trench work.' },
    { id: 'ast-dozer', name: 'Cat D6 Dozer', status: 'Maintenance', category: 'Dozer', criticality: 'High', location: 'Shop bay 2', manufacturer: 'Caterpillar', model: 'D6 XE', serial: 'CAT-D6-55210', installedOn: iso(-900), notes: 'Final drive leak flagged on site walk-around.' },
    { id: 'ast-haul', name: 'Volvo A25G Haul Truck', status: 'Down', category: 'Haul Truck', criticality: 'High', location: 'Helena job site', manufacturer: 'Volvo', model: 'A25G', serial: 'VOL-A25-30114', installedOn: iso(-1100), notes: 'Brake warning light and slow pedal response. Trailer booked to bring it in.' },
    { id: 'ast-loader', name: 'Cat 950M Wheel Loader', status: 'Running', category: 'Loader', criticality: 'High', location: 'Gravel pit', manufacturer: 'Caterpillar', model: '950M', serial: 'CAT-950-11930', installedOn: iso(-2000), notes: 'Loading trucks full time. Bucket G.E.T. wearing fast.' },
    { id: 'ast-skid', name: 'Bobcat S76 Skid Steer', status: 'Running', category: 'Loader', criticality: 'Medium', location: 'Bozeman yard', manufacturer: 'Bobcat', model: 'S76', serial: 'BOB-S76-25001', installedOn: iso(-720), notes: 'Tires at wear limit on the left side.' },
    { id: 'ast-cmptrack', name: 'Bobcat T66 Track Loader', status: 'Running', category: 'Loader', criticality: 'Medium', location: 'Bozeman yard', manufacturer: 'Bobcat', model: 'T66', serial: 'BOB-T66-7740', installedOn: iso(-540), notes: '' },
    { id: 'ast-backhoe', name: 'Deere 310L Backhoe', status: 'Running', category: 'Loader', criticality: 'Medium', location: 'Bozeman yard', manufacturer: 'John Deere', model: '310L', serial: 'JD-310-0091', installedOn: iso(-3200), notes: 'Kingpost play noted — rebuild quoted.' },
    { id: 'ast-tele', name: 'JLG 1055 Telehandler', status: 'Running', category: 'Lift', criticality: 'Medium', location: 'Big Sky job site', manufacturer: 'JLG', model: '1055', serial: 'JLG-1055-4100', installedOn: iso(-400), notes: 'ANSI annual inspection due.' },
    { id: 'ast-servtruck', name: 'Ford F-550 Service Truck', status: 'Running', category: 'Service Truck', criticality: 'Medium', location: 'Shop', manufacturer: 'Ford', model: 'F-550 + IMT crane', serial: 'FD-F550-445', installedOn: iso(-400), notes: 'Field response unit #1. Air compressor on board.' },
    { id: 'ast-gen', name: 'Cummins 60kW Towable Generator', status: 'Running', category: 'Power & Air', criticality: 'Low', location: 'Shop', manufacturer: 'Cummins', model: 'C60', serial: 'CUM-C60-1930', installedOn: iso(-600), notes: 'Rented out on weekends — log hours after every return.' },
    { id: 'ast-liftold', name: 'Genie GS-1930 Scissor Lift', status: 'Retired', category: 'Lift', criticality: 'Low', location: 'Yard — for sale', manufacturer: 'Genie', model: 'GS-1930', serial: 'GEN-1930-201', installedOn: iso(-2800), notes: 'Replaced by the telehandler. Listed for sale.' },
  ];

  const workorders = [
    { id: uid('wo'), title: 'Replace hydraulic hoses on D6 dozer', status: 'In Progress', priority: 'Urgent', assetId: 'ast-dozer', assigneeId: 'per-dana', type: 'Corrective', due: iso(-1), estHours: 6, description: 'Boom hose burst on site. New hose set from Yellow Iron Hydraulics being pressed tonight.' },
    { id: uid('wo'), title: 'Haul truck brake system diagnosis', status: 'Waiting Parts', priority: 'High', assetId: 'ast-haul', assigneeId: 'per-miguel', type: 'Corrective', due: iso(1), estHours: 8, description: 'Brake accumulators and wear sensors on order. Truck down at Helena site.' },
    { id: uid('wo'), title: 'Cat 320 excavator 500-hr service', status: 'Scheduled', priority: 'Normal', assetId: 'ast-exc320', assigneeId: 'per-miguel', type: 'Preventive', due: iso(2), estHours: 4, description: 'Oil change, fuel filters, hydraulic samples, grease all pins.' },
    { id: uid('wo'), title: 'Wheel loader bucket teeth replacement', status: 'Waiting Parts', priority: 'High', assetId: 'ast-loader', assigneeId: 'per-sam', type: 'Corrective', due: iso(1), estHours: 3, description: 'Teeth and adapters on order from Underfoot. Keep loader on light duty until then.' },
    { id: uid('wo'), title: 'Telehandler annual ANSI inspection', status: 'Scheduled', priority: 'High', assetId: 'ast-tele', assigneeId: 'per-jo', type: 'Inspection', due: iso(5), estHours: 2, description: 'Third-party inspector confirmed for Friday morning.' },
    { id: uid('wo'), title: 'Backhoe kingpost rebuild', status: 'Backlog', priority: 'Normal', assetId: 'ast-backhoe', assigneeId: 'per-dana', type: 'Corrective', due: iso(12), estHours: 12, description: 'Bushings and shims kit quoted. Book a two-day bay slot.' },
    { id: uid('wo'), title: 'Skid steer tire replacement (x4)', status: 'Backlog', priority: 'Normal', assetId: 'ast-skid', assigneeId: 'per-riley', type: 'Corrective', due: iso(9), estHours: 4, description: 'Left-side tires at wear limit. Air-fit rings in shop.' },
    { id: uid('wo'), title: 'Track loader undercarriage measurement', status: 'Backlog', priority: 'Low', assetId: 'ast-cmptrack', assigneeId: 'per-riley', type: 'Inspection', due: iso(14), estHours: 2, description: 'Log wear % and quote by 60% rule.' },
    { id: uid('wo'), title: 'Generator 250-hr run test & PM', status: 'Scheduled', priority: 'Normal', assetId: 'ast-gen', assigneeId: 'per-miguel', type: 'Preventive', due: iso(3), estHours: 2, description: 'Load bank test, oil + filters, coolant check.' },
    { id: uid('wo'), title: 'Excavator boom crack weld repair', status: 'In Progress', priority: 'High', assetId: 'ast-exc320', assigneeId: 'per-kim', type: 'Corrective', due: iso(0), estHours: 5, description: 'Crack at boom pad. Weld prep complete, root pass tonight.' },
    { id: uid('wo'), title: 'Service truck crane load test & restock', status: 'Backlog', priority: 'Normal', assetId: 'ast-servtruck', assigneeId: 'per-kim', type: 'Safety', due: iso(10), estHours: 2, description: 'Annual crane certification test. Restock consumables after.' },
    { id: uid('wo'), title: 'Yard drainage washout repair', status: 'Backlog', priority: 'Low', assetId: null, assigneeId: 'per-riley', type: 'Project', due: iso(-2), estHours: 6, description: 'Spring runoff undermined the yard drain. Rent a mini-exc for a day.' },
    { id: uid('wo'), title: 'DOT annual inspection — service truck', status: 'Done', priority: 'Normal', assetId: 'ast-servtruck', assigneeId: 'per-jo', type: 'Inspection', due: iso(-4), estHours: 1, description: 'Passed. Sticker in the cab, file updated.' },
    { id: uid('wo'), title: 'Generator fuel polishing', status: 'Done', priority: 'Low', assetId: 'ast-gen', assigneeId: 'per-miguel', type: 'Preventive', due: iso(-8), estHours: 2, description: 'Samples sent to lab — results clean.' },
  ];

  const schedule = [
    { id: uid('pm'), task: 'Excavator 250-hr service', assetId: 'ast-exc320', frequencyDays: 30, lastDone: iso(-33), assigneeId: 'per-miguel', priority: 'High', notes: 'Engine oil, samples, grease. Log meter hours.' },
    { id: uid('pm'), task: 'Grease pins & bushings (all units)', assetId: null, frequencyDays: 7, lastDone: iso(-2), assigneeId: 'per-riley', priority: 'Normal', notes: 'Dozer and loader first — heavy pins.' },
    { id: uid('pm'), task: 'DEF system & emissions check', assetId: 'ast-haul', frequencyDays: 30, lastDone: iso(-35), assigneeId: 'per-miguel', priority: 'High', notes: '' },
    { id: uid('pm'), task: 'Undercarriage wear measurement', assetId: 'ast-cmptrack', frequencyDays: 90, lastDone: iso(-85), assigneeId: 'per-riley', priority: 'Normal', notes: 'Photograph rollers and idlers.' },
    { id: uid('pm'), task: 'Backhoe service & bucket pins', assetId: 'ast-backhoe', frequencyDays: 30, lastDone: iso(-25), assigneeId: 'per-dana', priority: 'Normal', notes: '' },
    { id: uid('pm'), task: 'Hydraulic oil sample & analysis', assetId: 'ast-exc320', frequencyDays: 60, lastDone: iso(-10), assigneeId: 'per-sam', priority: 'Normal', notes: 'Send to lab, file results in the folder.' },
    { id: uid('pm'), task: 'Wheel loader 500-hr service', assetId: 'ast-loader', frequencyDays: 60, lastDone: iso(-18), assigneeId: 'per-miguel', priority: 'High', notes: 'Order filters two weeks ahead.' },
    { id: uid('pm'), task: 'Generator load bank test', assetId: 'ast-gen', frequencyDays: 90, lastDone: iso(-70), assigneeId: 'per-miguel', priority: 'Normal', notes: '30-minute full-load run.' },
    { id: uid('pm'), task: 'Skid steer hydraulic filter change', assetId: 'ast-skid', frequencyDays: 30, lastDone: iso(-6), assigneeId: 'per-riley', priority: 'Normal', notes: '' },
    { id: uid('pm'), task: 'Fleet DOT inspections', assetId: 'ast-servtruck', frequencyDays: 180, lastDone: iso(-90), assigneeId: 'per-jo', priority: 'Normal', notes: 'All titled units + trailers.' },
    { id: uid('pm'), task: 'Shop air compressor service', assetId: null, frequencyDays: 90, lastDone: iso(-45), assigneeId: 'per-sam', priority: 'Normal', notes: 'Shop compressor, not on the asset list.' },
  ];

  const parts = [
    { id: uid('part'), name: 'Hydraulic Hose 3/4in x 48in', sku: 'HOSE-34-48', qty: 4, minQty: 8, unit: 'ea', location: 'Hyd rack', vendorId: 'ven-yellow', cost: 96, category: 'Hydraulics', notes: 'Pre-made with JIC ends. Dozer boom set uses two.' },
    { id: uid('part'), name: 'Bucket Tooth — Cat 320 style', sku: 'TOOTH-320', qty: 3, minQty: 12, unit: 'ea', location: 'Wear parts', vendorId: 'ven-under', cost: 62, category: 'G.E.T.', notes: 'Loader job needs six.' },
    { id: uid('part'), name: 'DEF — Diesel Exhaust Fluid (2.5 gal)', sku: 'DEF-25', qty: 6, minQty: 10, unit: 'ea', location: 'Fluid locker', vendorId: 'ven-fleetwest', cost: 14, category: 'Fluids', notes: 'Haul truck drinks fast in summer.' },
    { id: uid('part'), name: 'Hydraulic Return Filter (Cat 320)', sku: 'FLT-RET-320', qty: 3, minQty: 3, unit: 'ea', location: 'Filter shelf', vendorId: 'ven-bigsky', cost: 52, category: 'Filters', notes: '' },
    { id: uid('part'), name: 'Track Bolt Kit (T66)', sku: 'BOLT-T66', qty: 6, minQty: 5, unit: 'box', location: 'B12', vendorId: 'ven-under', cost: 110, category: 'Undercarriage', notes: '' },
    { id: uid('part'), name: 'CAT 1R-0749 Fuel Filter', sku: 'FLT-1R0749', qty: 9, minQty: 6, unit: 'ea', location: 'Filter shelf', vendorId: 'ven-bigsky', cost: 28, category: 'Filters', notes: 'Fits 320 and the 950M.' },
    { id: uid('part'), name: '15W-40 Heavy Duty Engine Oil (5 gal)', sku: 'OIL-15W40-5', qty: 12, minQty: 6, unit: 'ea', location: 'Fluid locker', vendorId: 'ven-bigsky', cost: 78, category: 'Fluids', notes: '' },
    { id: uid('part'), name: 'Group 31 Battery', sku: 'BAT-G31', qty: 5, minQty: 4, unit: 'ea', location: 'Battery room', vendorId: 'ven-battery', cost: 189, category: 'Electrical', notes: 'Keep one on the service truck.' },
    { id: uid('part'), name: 'Grease — EP2 (14 oz tube)', sku: 'GREASE-EP2', qty: 30, minQty: 12, unit: 'ea', location: 'Fluid locker', vendorId: 'ven-bigsky', cost: 4.8, category: 'Lubricants', notes: 'Weekly pin-greasing run.' },
    { id: uid('part'), name: 'Starter — Deere 310L', sku: 'STR-310', qty: 2, minQty: 1, unit: 'ea', location: 'B21', vendorId: 'ven-battery', cost: 420, category: 'Electrical', notes: '' },
    { id: uid('part'), name: 'Serpentine Belt — F-550', sku: 'BLT-F550', qty: 4, minQty: 2, unit: 'ea', location: 'B14', vendorId: 'ven-fleetwest', cost: 38, category: 'Belts', notes: '' },
    { id: uid('part'), name: 'Wheel Loader Air Dryer Cartridge', sku: 'DRY-950M', qty: 1, minQty: 2, unit: 'ea', location: 'Filter shelf', vendorId: 'ven-bigsky', cost: 145, category: 'Filters', notes: '' },
  ];

  const resources = [
    { id: uid('res'), title: 'Cat 320 Service Manual', type: 'Manual', url: '\\\\FILESRV\\fleet\\manuals\\cat-320-gc.pdf', category: 'Manuals', owner: 'Maintenance', notes: 'Rev D — includes torque specs and test groups.' },
    { id: uid('res'), title: 'Fleet PM Checklists', type: 'Folder', url: '\\\\FILESRV\\fleet\\pm', category: 'Planning', owner: 'Planner', notes: 'Master 250/500-hr checklists by model.' },
    { id: uid('res'), title: 'DOT Annual Inspection Files', type: 'Document', url: '\\\\FILESRV\\fleet\\compliance\\dot-2026', category: 'Compliance', owner: 'Jo Ramirez', notes: 'Certificates and sticker records by unit.' },
    { id: uid('res'), title: 'Hydraulic Hose Pressing SOP', type: 'SOP', url: '\\\\FILESRV\\fleet\\sops\\hose-press.pdf', category: 'Safety', owner: 'Sam Chen', notes: 'Includes fitting torque chart.' },
    { id: uid('res'), title: 'Undercarriage Wear Photos', type: 'Folder', url: '\\\\FILESRV\\fleet\\undercarriage\\scans', category: 'Inspection', owner: 'Riley Novak', notes: 'Monthly wear measurements by unit.' },
    { id: uid('res'), title: 'Parts Suppliers Portal', type: 'Link', url: 'https://bigsky-parts.example/account', category: 'Procurement', owner: 'Purchasing', notes: 'Net-30 login required.' },
    { id: uid('res'), title: 'Operator Daily Inspection Sheets', type: 'Document', url: '\\\\FILESRV\\fleet\\daily-inspections', category: 'Field Ops', owner: 'Jo Ramirez', notes: 'Operators turn these in weekly.' },
    { id: uid('res'), title: 'Telehandler Load Chart Video', type: 'Video', url: '\\\\FILESRV\\fleet\\training\\jlg-1055.mp4', category: 'Training', owner: 'Safety Committee', notes: 'Show to new operators.' },
  ];

  return {
    meta: { version: 1, seededAt: new Date().toISOString() },
    settings: { ...defaultSettings },
    people,
    vendors,
    assets,
    workorders,
    schedule,
    parts,
    resources,
    activity: [
      { id: uid('act'), at: new Date().toISOString(), actor: 'system', text: 'Database seeded with Montana Fleet Solutions sample data' },
    ],
  };
}
