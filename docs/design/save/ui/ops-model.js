// Operational fixtures: warehouses, stock, manufacturing and assets.
// Every balance is derived from movements; nothing is stored twice.
import {ITEMS, COST_CENTRES, PROJECTS, LOCATIONS} from './accounting-model.js';

export const WAREHOUSES = [
  {code: 'WH-KHI', name: 'Central warehouse', location: 'WH-KHI', address: 'Korangi Industrial Area', custodian: 'S. Ali', bins: 'A1-A12', active: true},
  {code: 'WH-OUT', name: 'Outlet store', location: 'OUT-KHI-01', address: 'Clifton outlet back room', custodian: 'A. Khan', bins: 'S1-S4', active: true},
  {code: 'WH-SITE', name: 'Site store', location: 'HQ', address: 'Head office store', custodian: 'N. Farooq', bins: 'H1-H3', active: true},
];

export const WORK_CENTRES = [
  {code: 'WC-PRINT', name: 'Printing', rate: 850, capacity: 480, calendar: 'Mon–Sat'},
  {code: 'WC-PACK', name: 'Packing', rate: 450, capacity: 600, calendar: 'Mon–Sat'},
  {code: 'WC-FIN', name: 'Finishing', rate: 600, capacity: 300, calendar: 'Mon–Fri'},
];

const seeded = (() => { let x = 0x9e3779b9; return () => { x = (x * 1103515245 + 12345) >>> 0; return x / 4294967296; }; })();
const r2 = (n) => Math.round(n * 100) / 100;
const day = (i) => String(1 + Math.floor(i * 26 / 40)).padStart(2, '0');

export const STOCK_MOVES = (() => {
  const tracked = ['ITM-PACK', 'ITM-INK'];
  const out = [];
  let n = 0;
  for (let i = 0; i < 40; i++) {
    const item = tracked[i % tracked.length];
    const warehouse = WAREHOUSES[i % WAREHOUSES.length].code;
    const type = i % 3 === 0 ? 'receipt' : 'issue';
    const qty = type === 'receipt' ? 20 + Math.floor(seeded() * 60) : 5 + Math.floor(seeded() * 25);
    const cost = item === 'ITM-PACK' ? r2(18 + seeded() * 10) : r2(420 + seeded() * 120);
    out.push({
      id: 'MV-' + String(1001 + n++), date: '2026-11-' + day(i), type, item, warehouse,
      qty: type === 'receipt' ? qty : -qty, unitCost: cost, value: r2(cost * (type === 'receipt' ? qty : -qty)),
      source: type === 'receipt' ? 'Goods receipt' : 'Delivery note', reference: (type === 'receipt' ? 'GRN-' : 'DN-') + String(2001 + i),
      project: PROJECTS[i % PROJECTS.length].code, location: WAREHOUSES[i % WAREHOUSES.length].location, reason: '',
    });
  }
  return out;
})();

export function stockBalances() {
  const map = new Map();
  for (const m of STOCK_MOVES) {
    const key = m.item + '|' + m.warehouse;
    const row = map.get(key) || {item: m.item, warehouse: m.warehouse, qty: 0, value: 0, last: ''};
    row.qty += m.qty;
    row.value = r2(row.value + (m.type === 'receipt' ? m.unitCost * m.qty : m.unitCost * m.qty));
    row.last = m.date > row.last ? m.date : row.last;
    map.set(key, row);
  }
  return [...map.values()].map((r) => ({...r, avg: r.qty ? r2(Math.abs(r.value / r.qty)) : 0}));
}
export function averageCost(item) {
  const ins = STOCK_MOVES.filter((m) => m.item === item && m.type === 'receipt');
  const qty = ins.reduce((n, m) => n + m.qty, 0);
  const value = ins.reduce((n, m) => n + m.qty * m.unitCost, 0);
  return qty ? r2(value / qty) : 0;
}
export function stockOf(item) { return r2(stockBalances().filter((r) => r.item === item).reduce((n, r) => n + r.qty, 0)); }
export function itemValue(item) { return r2(averageCost(item) * stockOf(item)); }

export const BOMS = [
  {code: 'BOM-PACK-1', item: 'ITM-PACK', version: 1, outputQty: 100, components: [{item: 'ITM-INK', qty: 0.5}], operations: [{centre: 'WC-PRINT', minutes: 30}, {centre: 'WC-PACK', minutes: 45}], active: true},
  {code: 'BOM-INK-1', item: 'ITM-INK', version: 1, outputQty: 20, components: [{item: 'ITM-PACK', qty: 2}], operations: [{centre: 'WC-PRINT', minutes: 20}], active: true},
];

export const WORK_ORDERS = [
  {id: 'WO-2026-001', date: '2026-11-04', item: 'ITM-PACK', bom: 'BOM-PACK-1', qty: 500, warehouse: 'WH-KHI', due: '2026-11-18', status: 'in progress', issued: 2.5, produced: 200, scrap: 4, centre: 'WC-PRINT'},
  {id: 'WO-2026-002', date: '2026-11-12', item: 'ITM-INK', bom: 'BOM-INK-1', qty: 120, warehouse: 'WH-KHI', due: '2026-11-26', status: 'released', issued: 0, produced: 0, scrap: 0, centre: 'WC-PRINT'},
];

export const ASSET_CATEGORIES = [
  {code: 'CAT-FF', name: 'Furniture & fixtures', method: 'straight line', rate: 15, life: 7, assetAccount: '105001', depAccount: '106001', expenseAccount: '504001'},
  {code: 'CAT-VEH', name: 'Motor vehicles', method: 'straight line', rate: 20, life: 5, assetAccount: '105002', depAccount: '106002', expenseAccount: '504001'},
  {code: 'CAT-IT', name: 'Computer equipment', method: 'straight line', rate: 25, life: 4, assetAccount: '105003', depAccount: '106003', expenseAccount: '504001'},
];

export const ASSETS = [
  {code: 'AST-001', name: 'Office furniture set', category: 'CAT-FF', location: 'HQ', custodian: 'A. Rehman', date: '2026-07-05', cost: 486000, residual: 0, accum: 128400, status: 'in use'},
  {code: 'AST-002', name: 'Delivery van', category: 'CAT-VEH', location: 'WH-KHI', custodian: 'S. Ali', date: '2026-07-12', cost: 1240000, residual: 0, accum: 396800, status: 'in use'},
  {code: 'AST-003', name: 'Laptops (4)', category: 'CAT-IT', location: 'HQ', custodian: 'N. Farooq', date: '2026-08-03', cost: 268400, residual: 0, accum: 104600, status: 'in use'},
  {code: 'AST-004', name: 'Printing press', category: 'CAT-FF', location: 'WH-KHI', custodian: 'S. Ali', date: '2026-09-15', cost: 830000, residual: 0, accum: 0, status: 'in use'},
];

export function monthlyDepreciation(asset) {
  const cat = ASSET_CATEGORIES.find((c) => c.code === asset.category) || {rate: 0};
  return r2(((asset.cost - asset.residual) * cat.rate) / 100 / 12);
}
export function assetNbv(asset) { return r2(asset.cost - asset.accum); }
