// Inventory module: warehouses, stock, movements, receipts, issues, transfers,
// counts, adjustments, valuation, reorder and reports. Registers + form pages.
import {ITEMS, LOCATIONS} from './accounting-model.js';
import {WAREHOUSES, STOCK_MOVES, stockBalances, averageCost, stockOf, itemValue} from './ops-model.js';

const money = (n) => Number(n || 0).toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2});
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
const badge = (t, k = '') => `<span class="badge ${k}">${esc(t)}</span>`;
const itemName = (code) => (ITEMS.find((i) => i.code === code) || {}).name || code;
const whName = (code) => (WAREHOUSES.find((w) => w.code === code) || {}).name || code;
const tracked = () => ITEMS.filter((i) => i.tracked);
const F = {q: '', warehouse: '', type: ''};

const kpi = (label, value, basis) => `<section class="stat"><span class="stat-label">${esc(label)}</span><strong class="value numeric">${value}</strong><small>${esc(basis)}</small></section>`;
const filterBar = (placeholder, extra = '') => `<form class="filterbar" data-inv-filter>
  <label>Search<input type="search" name="q" value="${esc(F.q)}" placeholder="${esc(placeholder)}"></label>
  ${extra}
  <button class="button" type="button" data-inv-reset>Reset</button></form>`;
const exportBtn = '<button class="button" data-export-table>Export CSV</button>';
const hit = (...parts) => !F.q || parts.join(' ').toLowerCase().includes(F.q.toLowerCase());

function rowsForMovements() {
  return STOCK_MOVES.filter((m) => hit(m.id, m.reference, itemName(m.item), whName(m.warehouse), m.source, m.reason)
    && (!F.warehouse || m.warehouse === F.warehouse) && (!F.type || m.type === F.type))
    .sort((a, b) => b.date.localeCompare(a.date) || b.id.localeCompare(a.id));
}

/* ----------------------------------------------------------- registers */
function dashboard() {
  const balances = stockBalances();
  const value = balances.reduce((n, r) => n + Math.abs(r.value), 0);
  const byWh = WAREHOUSES.map((w) => ({...w, value: balances.filter((r) => r.warehouse === w.code).reduce((n, r) => n + Math.abs(r.value), 0)}));
  const low = tracked().filter((i) => stockOf(i.code) < (i.reorder || 50));
  const recent = STOCK_MOVES.slice(-8).reverse();
  return `<div class="stats">
      ${kpi('Stock value', money(value), 'Average cost × quantity')}
      ${kpi('Warehouses', String(WAREHOUSES.length), 'One location each')}
      ${kpi('Below reorder', String(low.length), 'Tracked items')}
      ${kpi('Movements', String(STOCK_MOVES.length), 'Receipts and issues')}
    </div>
    <div class="dash-grid">
      <section class="panel dash-span2"><div class="panel-head"><h2>Value by warehouse</h2></div>
        <div class="table-scroll" data-hscroll><table><thead><tr><th>Warehouse</th><th>Location</th><th>Custodian</th><th class="numeric">Value</th></tr></thead><tbody>${byWh.map((w) => `<tr><td>${esc(w.name)}</td><td>${esc(w.location)}</td><td>${esc(w.custodian)}</td><td class="numeric">${money(w.value)}</td></tr>`).join('')}</tbody></table></div>
      </section>
      <section class="panel"><div class="panel-head"><h2>Below reorder</h2><span class="badge warn">${low.length}</span></div><div class="panel-body">${low.map((i) => `<div class="quiet-row"><div><strong>${esc(i.name)}</strong><small>${stockOf(i.code)} on hand · reorder at ${i.reorder || 50}</small></div></div>`).join('') || '<p class="form-note">Nothing below its reorder point.</p>'}</div></section>
    </div>
    <section class="panel"><div class="panel-head"><h2>Recent movements</h2><button class="text-button" data-module="inventory" data-tab="movements">Open register ↗</button></div>
      <div class="table-scroll" data-hscroll><table><thead><tr><th>Date</th><th>Reference</th><th>Item</th><th>Warehouse</th><th class="numeric">Qty</th><th class="numeric">Value</th></tr></thead><tbody>${recent.map((m) => `<tr><td>${m.date}</td><td class="mono">${esc(m.reference)}</td><td>${esc(itemName(m.item))}</td><td>${esc(whName(m.warehouse))}</td><td class="numeric">${m.qty}</td><td class="numeric">${money(m.value)}</td></tr>`).join('')}</tbody></table></div></section>`;
}
function itemsPage() {
  const rows = tracked().filter((i) => hit(i.code, i.name, i.group));
  return filterBar('Code, item, group') + `<section class="panel"><div class="panel-head"><h2>Items</h2><div class="related"><span class="badge">${rows.length} tracked</span>${exportBtn}</div></div>
    <div class="table-scroll" data-hscroll><table><thead><tr><th>Code</th><th>Item</th><th>Unit</th><th class="numeric">On hand</th><th class="numeric">Avg cost</th><th class="numeric">Value</th><th class="numeric">Reorder</th><th>Status</th></tr></thead>
    <tbody>${rows.map((i) => `<tr><td class="mono">${esc(i.code)}</td><td>${esc(i.name)}</td><td>${esc(i.unit)}</td><td class="numeric">${stockOf(i.code)}</td><td class="numeric">${money(averageCost(i.code))}</td><td class="numeric">${money(itemValue(i.code))}</td><td class="numeric">${i.reorder || 50}</td><td>${badge(stockOf(i.code) < (i.reorder || 50) ? 'Below reorder' : 'In stock', stockOf(i.code) < (i.reorder || 50) ? 'warn' : 'good')}</td></tr>`).join('')}</tbody></table></div>
    <div class="table-footer">The item master is shared with Accounting. Stock fields (reorder point) live here; quantities and value are derived from movements.</div></section>`;
}
function warehousesPage() {
  const rows = WAREHOUSES.filter((w) => hit(w.code, w.name, w.location, w.custodian));
  return filterBar('Code, warehouse, location, custodian') + `<section class="panel"><div class="panel-head"><h2>Warehouses</h2><div class="related"><span class="badge">${rows.length} stores</span>${exportBtn}<button class="button" data-inv-new="warehouse">New warehouse</button></div></div>
    <div class="table-scroll" data-hscroll><table><thead><tr><th>Code</th><th>Warehouse</th><th>Location</th><th>Address</th><th>Custodian</th><th>Bins</th><th>State</th><th></th></tr></thead>
    <tbody>${rows.map((w) => `<tr class="row-link" data-inv-edit="warehouse:${esc(w.code)}"><td class="mono">${esc(w.code)}</td><td>${esc(w.name)}</td><td>${esc(w.location)}</td><td>${esc(w.address)}</td><td>${esc(w.custodian)}</td><td>${esc(w.bins)}</td><td>${badge(w.active ? 'Active' : 'Closed', w.active ? 'good' : 'warn')}</td><td class="row-go">›</td></tr>`).join('')}</tbody></table></div>
    <div class="table-footer">A warehouse is a physical store attached to an accounting location. Stock never leaves the company.</div></section>`;
}
function groupsPage() {
  return `<section class="panel"><div class="panel-head"><h2>Item groups</h2><span class="badge">Managed in Settings</span></div><div class="panel-body"><p class="form-note">Item groups are shared with Accounting and are edited in Settings → Accounting → Item groups. Each group can carry default accounts and tax defaults.</p><div class="related"><button class="text-button" data-module="settings" data-tab="accounting">Open item groups ↗</button></div></div></section>`;
}
function balancesPage() {
  const rows = stockBalances().filter((r) => hit(itemName(r.item), whName(r.warehouse), r.item, r.warehouse) && (!F.warehouse || r.warehouse === F.warehouse));
  return filterBar('Item or warehouse', `<label>Warehouse<select name="warehouse"><option value="">All warehouses</option>${WAREHOUSES.map((w) => `<option value="${esc(w.code)}" ${F.warehouse === w.code ? 'selected' : ''}>${esc(w.name)}</option>`).join('')}</select></label>`) + `<section class="panel"><div class="panel-head"><h2>Stock balances</h2><div class="related"><span class="badge">${rows.length} lines</span>${exportBtn}</div></div>
    <div class="table-scroll" data-hscroll><table><thead><tr><th>Item</th><th>Warehouse</th><th class="numeric">Quantity</th><th class="numeric">Average cost</th><th class="numeric">Value</th><th>Last movement</th></tr></thead>
    <tbody>${rows.map((r) => `<tr><td class="mono">${esc(r.item)} · ${esc(itemName(r.item))}</td><td>${esc(whName(r.warehouse))}</td><td class="numeric">${r.qty}</td><td class="numeric">${money(r.avg)}</td><td class="numeric">${money(Math.abs(r.value))}</td><td>${esc(r.last)}</td></tr>`).join('') || '<tr><td colspan="6">No stock matches these filters.</td></tr>'}</tbody>
    <tfoot><tr><td colspan="4">Total value</td><td class="numeric">${money(rows.reduce((n, r) => n + Math.abs(r.value), 0))}</td><td></td></tr></tfoot></table></div></section>`;
}
function movementsPage() {
  const rows = rowsForMovements().slice(0, 120);
  return filterBar('Reference, item, source', `<label>Warehouse<select name="warehouse"><option value="">All warehouses</option>${WAREHOUSES.map((w) => `<option value="${esc(w.code)}" ${F.warehouse === w.code ? 'selected' : ''}>${esc(w.name)}</option>`).join('')}</select></label><label>Direction<select name="type"><option value="">In and out</option><option value="receipt" ${F.type === 'receipt' ? 'selected' : ''}>In</option><option value="issue" ${F.type === 'issue' ? 'selected' : ''}>Out</option></select></label>`) + `<section class="panel"><div class="panel-head"><h2>Stock movements</h2><div class="related"><span class="badge">${rowsForMovements().length} movements</span>${exportBtn}</div></div>
    <div class="table-scroll" data-hscroll><table><thead><tr><th>Date</th><th>Movement</th><th>Source</th><th>Item</th><th>Warehouse</th><th class="numeric">Qty</th><th class="numeric">Unit cost</th><th class="numeric">Value</th><th>Project</th><th>Reason</th></tr></thead>
    <tbody>${rows.map((m) => `<tr><td>${m.date}</td><td class="mono">${esc(m.id)}</td><td>${esc(m.source)}<small class="secondary">${esc(m.reference)}</small></td><td>${esc(itemName(m.item))}</td><td>${esc(whName(m.warehouse))}</td><td class="numeric">${m.qty}</td><td class="numeric">${money(m.unitCost)}</td><td class="numeric">${money(m.value)}</td><td>${esc(m.project || '—')}</td><td>${esc(m.reason || '—')}</td></tr>`).join('')}</tbody></table></div>
    <div class="table-footer">Every quantity that moves is a movement line with its source document. Balances are derived from these lines only.</div></section>`;
}
function valuationPage() {
  const rows = tracked().map((i) => ({...i, qty: stockOf(i.code), cost: averageCost(i.code), value: itemValue(i.code)}));
  return `<section class="panel"><div class="panel-head"><h2>Valuation &amp; costing</h2><div class="related"><span class="badge">Average cost</span>${exportBtn}</div></div>
    <div class="table-scroll" data-hscroll><table><thead><tr><th>Item</th><th>Method</th><th class="numeric">Quantity</th><th class="numeric">Average cost</th><th class="numeric">Value</th><th class="numeric">Last purchase</th></tr></thead>
    <tbody>${rows.map((i) => `<tr><td class="mono">${esc(i.code)} · ${esc(i.name)}</td><td>Weighted average</td><td class="numeric">${i.qty}</td><td class="numeric">${money(i.cost)}</td><td class="numeric">${money(i.value)}</td><td class="numeric">${money(i.purchasePrice || 0)}</td></tr>`).join('')}</tbody>
    <tfoot><tr><td colspan="4">Total</td><td class="numeric">${money(rows.reduce((n, r) => n + r.value, 0))}</td><td></td></tr></tfoot></table></div>
    <div class="table-footer">Weighted average is the method in this build. Revaluation, NRV write-down and landed cost will extend this page; nothing here posts to the ledger yet.</div></section>`;
}
function reorderPage() {
  const rows = tracked().filter((i) => stockOf(i.code) < (i.reorder || 50));
  return `<section class="panel"><div class="panel-head"><h2>Reorder &amp; alerts</h2><div class="related"><span class="badge">${rows.length} items</span>${exportBtn}</div></div>
    <div class="table-scroll" data-hscroll><table><thead><tr><th>Item</th><th class="numeric">On hand</th><th class="numeric">Reorder at</th><th class="numeric">Suggested</th><th>Warehouse</th></tr></thead>
    <tbody>${rows.map((i) => `<tr><td class="mono">${esc(i.code)} · ${esc(i.name)}</td><td class="numeric">${stockOf(i.code)}</td><td class="numeric">${i.reorder || 50}</td><td class="numeric">${Math.max(0, (i.reorder || 50) * 2 - stockOf(i.code))}</td><td>${esc(warehousesPageFor(i.code))}</td></tr>`).join('') || '<tr><td colspan="5">Nothing below its reorder point.</td></tr>'}</tbody></table></div></section>`;
}
function warehousesPageFor(item) {
  const b = stockBalances().filter((r) => r.item === item).sort((a, b2) => b2.qty - a.qty)[0];
  return b ? whName(b.warehouse) : '—';
}
function reportsPage() {
  const balances = stockBalances();
  const byItem = tracked().map((i) => ({name: i.name, qty: stockOf(i.code), value: itemValue(i.code)}));
  return `<div class="two-column">
    <section class="panel"><div class="panel-head"><h2>Value by item</h2>${exportBtn}</div><div class="table-scroll" data-hscroll><table><thead><tr><th>Item</th><th class="numeric">Qty</th><th class="numeric">Value</th></tr></thead><tbody>${byItem.map((r) => `<tr><td>${esc(r.name)}</td><td class="numeric">${r.qty}</td><td class="numeric">${money(r.value)}</td></tr>`).join('')}</tbody><tfoot><tr><td>Total</td><td></td><td class="numeric">${money(byItem.reduce((n, r) => n + r.value, 0))}</td></tr></tfoot></table></div></section>
    <section class="panel"><div class="panel-head"><h2>Movement summary</h2>${exportBtn}</div><div class="table-scroll" data-hscroll><table><thead><tr><th>Warehouse</th><th class="numeric">In</th><th class="numeric">Out</th><th class="numeric">Net</th></tr></thead><tbody>${WAREHOUSES.map((w) => { const ins = STOCK_MOVES.filter((m) => m.warehouse === w.code && m.qty > 0).reduce((n, m) => n + m.qty, 0); const outs = STOCK_MOVES.filter((m) => m.warehouse === w.code && m.qty < 0).reduce((n, m) => n - m.qty, 0); return `<tr><td>${esc(w.name)}</td><td class="numeric">${ins}</td><td class="numeric">${outs}</td><td class="numeric">${ins - outs}</td></tr>`; }).join('')}</tbody></table></div></section>
  </div>
  <section class="panel"><div class="panel-head"><h2>Stock ageing</h2><span class="badge">By last movement</span></div><div class="panel-body"><p class="form-note">${balances.filter((r) => r.qty > 0).length} positive balance lines; ${balances.filter((r) => r.qty <= 0).length} at or below zero. Costing runs on weighted average; a full ageing report arrives with the reporting increment.</p></div></section>`;
}
function settingsPage() {
  return `<section class="panel"><div class="panel-head"><h2>Inventory settings</h2><span class="badge">Session defaults</span></div>
    <div class="panel-body form-grid">
      <label>Costing method<select class="inline-input"><option>Weighted average</option><option>FIFO</option></select></label>
      <label>Allow negative stock<select class="inline-input"><option>No</option><option>Warn only</option><option>Yes</option></select></label>
      <label>Receipt clearing account<input value="103001 · Inventory"></label>
      <label>Issue / cost account<input value="502001 · Operating expenses"></label>
      <label>Stock adjustment account<input value="502001 · Operating expenses"></label>
      <label>Default warehouse<select class="inline-input">${WAREHOUSES.map((w) => `<option>${esc(w.code)} · ${esc(w.name)}</option>`).join('')}</select></label>
    </div>
    <div class="panel-body"><p class="form-note">These are session defaults. They will live in Settings → Inventory when the settings module is expanded.</p></div></section>`;
}

/* --------------------------------------------------------------- forms */
export const DRAFT = {
  warehouse: {code: '', name: '', location: 'WH-KHI', address: '', custodian: '', bins: '', active: 'yes'},
  receipt: {date: '2026-11-30', warehouse: 'WH-KHI', party: '', reference: '', lines: [{item: 'ITM-PACK', qty: '10', cost: '0.00'}, {item: '', qty: '', cost: ''}]},
  issue: {date: '2026-11-30', warehouse: 'WH-KHI', party: '', reference: '', lines: [{item: 'ITM-PACK', qty: '1'}, {item: '', qty: ''}]},
  transfer: {date: '2026-11-30', from: 'WH-KHI', to: 'WH-OUT', lines: [{item: 'ITM-PACK', qty: '1'}, {item: '', qty: ''}]},
  adjust: {date: '2026-11-30', warehouse: 'WH-KHI', item: 'ITM-PACK', qty: '0', reason: 'Count difference', notes: ''},
  count: {date: '2026-11-30', warehouse: 'WH-KHI', lines: [{item: 'ITM-PACK', counted: ''}, {item: '', counted: ''}]},
};

export function view(tab) {
  if (tab === 'items') return itemsPage();
  if (tab === 'groups') return groupsPage();
  if (tab === 'warehouses') return warehousesPage();
  if (tab === 'balances') return balancesPage();
  if (tab === 'movements') return movementsPage();
  if (tab === 'receipts') return movementsPage().replace('Stock movements', 'Goods receipts') + newNote('receipts');
  if (tab === 'delivery') return movementsPage().replace('Stock movements', 'Delivery notes') + newNote('issue');
  if (tab === 'transfers') return movementsPage().replace('Stock movements', 'Transfers') + newNote('transfer');
  if (tab === 'counts') return movementsPage().replace('Stock movements', 'Stock counts') + newNote('count');
  if (tab === 'adjustments') return movementsPage().replace('Stock movements', 'Adjustments') + newNote('adjust');
  if (tab === 'valuation') return valuationPage();
  if (tab === 'reorder') return reorderPage();
  if (tab === 'reports') return reportsPage();
  if (tab === 'settings') return settingsPage();
  return dashboard();
}

function newNote(form) {
  const label = {receipts: 'New goods receipt', issue: 'New delivery note', transfer: 'New transfer', count: 'New stock count', adjust: 'New adjustment'}[form];
  return `<div class="panel-body"><div class="related"><button class="button primary" data-inv-new="${form}">${label}</button></div></div>`;
}

export function editor(form, code) {
  if (form === 'warehouse') {
    const w = code ? (WAREHOUSES.find((x) => x.code === code) || {}) : DRAFT.warehouse;
    return `<section class="panel"><div class="panel-head"><h2>${w.code ? esc(w.name) : 'New warehouse'}</h2><span class="badge">${w.code ? 'Editing' : 'Store'}</span></div>
      <form data-ops-form="warehouse" class="panel-body form-grid">
        <input type="hidden" name="editingCode" value="${esc(w.code || '')}">
        <label>Code<input name="code" required pattern="[A-Z0-9-]{2,20}" value="${esc(w.code || '')}" ${w.code ? 'readonly' : ''}></label>
        <label>Name<input name="name" required value="${esc(w.name || '')}"></label>
        <label>Location<select name="location" class="inline-input">${LOCATIONS.map((l) => `<option value="${esc(l.code)}" ${l.code === (w.location || 'HQ') ? 'selected' : ''}>${esc(l.code)} · ${esc(l.name)}</option>`).join('')}</select></label>
        <label>Address<input name="address" value="${esc(w.address || '')}"></label>
        <label>Custodian<input name="custodian" value="${esc(w.custodian || '')}"></label>
        <label>Bins<input name="bins" value="${esc(w.bins || '')}"></label>
        <label>State<select name="active" class="inline-input"><option value="yes" ${w.active !== false ? 'selected' : ''}>Active</option><option value="no" ${w.active === false ? 'selected' : ''}>Closed</option></select></label>
        <div class="related"><button class="button primary">Save</button><button type="button" class="button" data-ops-cancel>Cancel</button></div>
      </form></section>`;
  }
  const map = {
    receipt: ['Goods receipt', 'Items received into a warehouse; raises stock and, in the accounting build, the inventory and payable entries.'],
    issue: ['Delivery note', 'Items leaving a warehouse; reduces stock at average cost.'],
    transfer: ['Stock transfer', 'Moves quantity between warehouses at unchanged total value.'],
    adjust: ['Stock adjustment', 'Corrects one item in one warehouse with a reason.'],
    count: ['Stock count', 'Records counted quantity per item; the variance becomes an adjustment.'],
  };
  const [title, note] = map[form] || ['Stock document', 'Choose a stock document.'];
  return `<section class="panel"><div class="panel-head"><h2>${title}</h2><span class="badge">${form === 'count' ? 'Variance becomes an adjustment' : 'Stock movement'}</span></div>
    <form data-ops-form="${form}" class="panel-body form-grid">
      <label>Date<input name="date" type="date" value="2026-11-30" required></label>
      ${form === 'transfer' ? `<label>From warehouse<select name="from" class="inline-input">${WAREHOUSES.map((w) => `<option value="${esc(w.code)}">${esc(w.code)} · ${esc(w.name)}</option>`).join('')}</select></label><label>To warehouse<select name="to" class="inline-input">${WAREHOUSES.map((w) => `<option value="${esc(w.code)}" ${w.code === 'WH-OUT' ? 'selected' : ''}>${esc(w.code)} · ${esc(w.name)}</option>`).join('')}</select></label>` : `<label>Warehouse<select name="warehouse" class="inline-input">${WAREHOUSES.map((w) => `<option value="${esc(w.code)}">${esc(w.code)} · ${esc(w.name)}</option>`).join('')}</select></label>`}
      ${form === 'receipt' ? `<label>Party<input name="party" value="" placeholder="Supplier or customer" required></label><label>Reference<input name="reference" placeholder="GRN or bill"></label>` : ''}
      ${form === 'issue' ? `<label>Party<input name="party" placeholder="Customer or department" required></label><label>Reference<input name="reference" placeholder="DN or invoice"></label>` : ''}
      ${form === 'adjust' ? `<label>Item<select name="item" class="inline-input">${tracked().map((i) => `<option value="${esc(i.code)}">${esc(i.code)} · ${esc(i.name)}</option>`).join('')}</select></label><label>Quantity change<input name="qty" value="0" inputmode="decimal" required></label><label>Reason<select name="reason" class="inline-input"><option>Count difference</option><option>Damage</option><option>Expiry</option><option>Write-off</option></select></label><label class="wide">Notes<input name="notes"></label>` : ''}
      <div class="related"><button class="button primary">${form === 'count' ? 'Record count' : 'Save for this session'}</button><button type="button" class="button" data-ops-cancel>Cancel</button><button type="button" class="button" data-inv-back>Back to register</button></div>
    </form>
    ${form !== 'adjust' ? `<div class="table-scroll"><table class="invoice-lines"><thead><tr><th>Item</th><th>${form === 'count' ? 'Counted quantity' : 'Quantity'}</th>${form === 'receipt' ? '<th>Unit cost</th>' : ''}</tr></thead><tbody>${(form === 'count' ? DRAFT.count.lines : DRAFT[form].lines).map((l, i) => `<tr data-ops-line="${i}"><td><select class="inline-input" data-ops-field="item">${tracked().map((it) => `<option value="${esc(it.code)}" ${it.code === l.item ? 'selected' : ''}>${esc(it.code)} · ${esc(it.name)}</option>`).join('')}</select></td><td><input class="numeric" data-ops-field="${form === 'count' ? 'counted' : 'qty'}" value="${esc(l[form === 'count' ? 'counted' : 'qty'] || '')}" inputmode="decimal"></td>${form === 'receipt' ? `<td><input class="numeric" data-ops-field="cost" value="${esc(l.cost || '')}" inputmode="decimal"></td>` : ''}</tr>`).join('')}</tbody></table></div>` : ''}
    <div class="panel-body"><p class="form-note">${esc(note)}</p></div></section>`;
}

/* --------------------------------------------------------------- binds */
export function bind(render, notify, navigate) {
  document.querySelectorAll('[data-inv-filter]').forEach((form) => {
    form.querySelector('[name="q"]')?.addEventListener('input', (ev) => {
      F.q = ev.target.value; const pos = ev.target.selectionStart; render();
      const again = document.querySelector('[data-inv-filter] [name="q"]'); if (again) { again.focus(); try { again.setSelectionRange(pos, pos); } catch {} }
    });
    form.querySelector('[name="warehouse"]')?.addEventListener('change', (ev) => { F.warehouse = ev.target.value; render(); });
    form.querySelector('[name="type"]')?.addEventListener('change', (ev) => { F.type = ev.target.value; render(); });
  });
  document.querySelector('[data-inv-reset]')?.addEventListener('click', () => { F.q = ''; F.warehouse = ''; F.type = ''; render(); });
  document.querySelectorAll('[data-inv-new]').forEach((b) => b.addEventListener('click', () => navigate({module: 'inventory', tab: routeTab(b.dataset.invNew), mode: 'editor', form: b.dataset.invNew, code: ''})));
  document.querySelectorAll('[data-inv-edit]').forEach((tr) => tr.addEventListener('click', () => { const [form, code] = tr.dataset.invEdit.split(':'); navigate({module: 'inventory', tab: form === 'warehouse' ? 'warehouses' : 'dashboard', mode: 'editor', form, code}); }));
  document.querySelector('[data-ops-cancel]')?.addEventListener('click', () => navigate({module: 'inventory', tab: 'movements'}));
  document.querySelector('[data-inv-back]')?.addEventListener('click', () => navigate({module: 'inventory', tab: 'movements'}));
  document.querySelectorAll('[data-ops-form]').forEach((form) => form.addEventListener('submit', (ev) => {
    ev.preventDefault();
    if (!form.reportValidity()) return;
    const kind = form.dataset.opsForm;
    const v = Object.fromEntries(new FormData(form));
    if (kind === 'warehouse') {
      const editing = v.editingCode || '';
      if (!editing && WAREHOUSES.some((w) => w.code === v.code)) { notify('That warehouse code already exists.'); return; }
      const rec = {code: v.code, name: v.name, location: v.location, address: v.address || '', custodian: v.custodian || '', bins: v.bins || '', active: v.active === 'yes'};
      if (editing) { Object.assign(WAREHOUSES.find((w) => w.code === editing), rec); notify('Warehouse updated.'); }
      else { WAREHOUSES.push(rec); notify('Warehouse added for this session.'); }
      navigate({module: 'inventory', tab: 'warehouses'}); return;
    }
    const lines = [...(form.closest('section').querySelectorAll('[data-ops-line]') || [])].map((tr) => ({
      item: tr.querySelector('[data-ops-field="item"]').value,
      qty: tr.querySelector('[data-ops-field="qty"]')?.value,
      cost: tr.querySelector('[data-ops-field="cost"]')?.value,
      counted: tr.querySelector('[data-ops-field="counted"]')?.value,
    })).filter((l) => l.item && Number(l.qty || l.counted || 0) > 0);
    if (!lines.length) { notify('Add at least one line with a quantity.'); return; }
    const date = v.date;
    if (kind === 'receipt') lines.forEach((l, i) => STOCK_MOVES.push({id: 'MV-' + (2000 + STOCK_MOVES.length + i), date, type: 'receipt', item: l.item, warehouse: v.warehouse, qty: Number(l.qty), unitCost: Number(l.cost) || averageCost(l.item), value: round2((Number(l.cost) || averageCost(l.item)) * Number(l.qty)), source: 'Manual receipt', reference: v.reference || '—', project: '', location: '', reason: ''}));
    if (kind === 'issue') lines.forEach((l, i) => STOCK_MOVES.push({id: 'MV-' + (2000 + STOCK_MOVES.length + i), date, type: 'issue', item: l.item, warehouse: v.warehouse, qty: -Number(l.qty), unitCost: averageCost(l.item), value: round2(-averageCost(l.item) * Number(l.qty)), source: 'Delivery note', reference: v.reference || '—', project: '', location: '', reason: ''}));
    if (kind === 'transfer') lines.forEach((l, i) => { STOCK_MOVES.push({id: 'MV-' + (2000 + STOCK_MOVES.length + i * 2), date, type: 'transfer', item: l.item, warehouse: v.from, qty: -Number(l.qty), unitCost: averageCost(l.item), value: round2(-averageCost(l.item) * Number(l.qty)), source: 'Transfer', reference: 'TR-' + (5000 + i), project: '', location: '', reason: ''}); STOCK_MOVES.push({id: 'MV-' + (2001 + STOCK_MOVES.length + i * 2), date, type: 'transfer', item: l.item, warehouse: v.to, qty: Number(l.qty), unitCost: averageCost(l.item), value: round2(averageCost(l.item) * Number(l.qty)), source: 'Transfer', reference: 'TR-' + (5000 + i), project: '', location: '', reason: ''}); });
    if (kind === 'adjust') { const l = lines[0]; STOCK_MOVES.push({id: 'MV-' + (2000 + STOCK_MOVES.length), date, type: 'adjustment', item: l.item, warehouse: v.warehouse, qty: Number(v.qty), unitCost: averageCost(l.item), value: round2(averageCost(l.item) * Number(v.qty)), source: 'Adjustment', reference: 'ADJ-' + (6000 + STOCK_MOVES.length), project: '', location: '', reason: v.reason || ''}); }
    if (kind === 'count') lines.forEach((l, i) => { const system = stockBalances().filter((r) => r.item === l.item && r.warehouse === v.warehouse).reduce((n, r) => n + r.qty, 0); const diff = round2(Number(l.counted) - system); if (diff) STOCK_MOVES.push({id: 'MV-' + (2000 + STOCK_MOVES.length + i), date, type: 'adjustment', item: l.item, warehouse: v.warehouse, qty: diff, unitCost: averageCost(l.item), value: round2(averageCost(l.item) * diff), source: 'Stock count', reference: 'CNT-' + (7000 + i), project: '', location: '', reason: 'Count difference'}); });
    notify('Stock document saved for this session. Balances are updated from the movement lines.');
    navigate({module: 'inventory', tab: routeTab(kind)});
  }));
}

function routeTab(form) { return {receipt: 'receipts', issue: 'delivery', transfer: 'transfers', adjust: 'adjustments', count: 'counts', warehouse: 'warehouses'}[form] || 'movements'; }
function round2(n) { return Math.round(n * 100) / 100; }
