// Manufacturing: BOMs, routings, work centres, planning, work orders, scrap,
// subcontracting, costing and reports. Session documents on stock movements.
import {ITEMS} from './accounting-model.js';
import {WAREHOUSES, WORK_CENTRES, BOMS, WORK_ORDERS, STOCK_MOVES, stockOf, averageCost} from './ops-model.js';

const money = (n) => Number(n || 0).toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2});
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
const badge = (t, k = '') => `<span class="badge ${k}">${esc(t)}</span>`;
const itemName = (c) => (ITEMS.find((i) => i.code === c) || {}).name || c;
const centreName = (c) => (WORK_CENTRES.find((w) => w.code === c) || {}).name || c;
const F = {q: '', status: ''};
const kpi = (l, v, b) => `<section class="stat"><span class="stat-label">${esc(l)}</span><strong class="value numeric">${v}</strong><small>${esc(b)}</small></section>`;
const hit = (...p) => !F.q || p.join(' ').toLowerCase().includes(F.q.toLowerCase());
const filterBar = (ph, extra = '') => `<form class="filterbar" data-mf-filter><label>Search<input type="search" name="q" value="${esc(F.q)}" placeholder="${esc(ph)}"></label>${extra}<button class="button" type="button" data-mf-reset>Reset</button></form>`;
const exportBtn = '<button class="button" data-export-table>Export CSV</button>';

function orderCost(o) {
  const bom = BOMS.find((b) => b.code === o.bom) || {operations: []};
  const material = (o.issued || 0) * averageCost(o.item);
  const labour = bom.operations.reduce((n, op) => n + ((WORK_CENTRES.find((w) => w.code === op.centre) || {}).rate || 0) * (op.minutes || 0) / 60 * (o.qty / Math.max(bom.outputQty, 1)), 0);
  return {material: Math.round(material * 100) / 100, labour: Math.round(labour * 100) / 100, total: Math.round((material + labour) * 100) / 100};
}

function dashboard() {
  const open = WORK_ORDERS.filter((o) => o.status !== 'closed');
  const output = WORK_ORDERS.reduce((n, o) => n + (o.produced || 0), 0);
  const scrap = WORK_ORDERS.reduce((n, o) => n + (o.scrap || 0), 0);
  const shortages = BOMS.flatMap((b) => b.components.filter((c) => stockOf(c.item) < c.qty).map((c) => ({bom: b.code, item: c.item, need: c.qty, have: stockOf(c.item)})));
  return `<div class="stats">
      ${kpi('Open work orders', String(open.length), 'Planned, released or in progress')}
      ${kpi('Produced', String(output), 'Units received')}
      ${kpi('Scrap', String(scrap), 'Units lost')}
      ${kpi('Material shortages', String(shortages.length), 'Component below requirement')}
    </div>
    <section class="panel"><div class="panel-head"><h2>Work orders</h2><button class="text-button" data-module="manufacturing" data-tab="orders">Open register ↗</button></div>
      <div class="table-scroll" data-hscroll><table><thead><tr><th>Order</th><th>Item</th><th class="numeric">Qty</th><th class="numeric">Produced</th><th>Due</th><th>Status</th><th class="numeric">Cost</th></tr></thead><tbody>${WORK_ORDERS.slice(0, 6).map((o) => { const c = orderCost(o); return `<tr><td class="mono">${esc(o.id)}</td><td>${esc(itemName(o.item))}</td><td class="numeric">${o.qty}</td><td class="numeric">${o.produced}</td><td>${o.due}</td><td>${badge(o.status, o.status === 'closed' ? 'good' : o.status === 'planned' ? '' : 'plum')}</td><td class="numeric">${money(c.total)}</td></tr>`; }).join('')}</tbody></table></div></section>
    <section class="panel"><div class="panel-head"><h2>Shortages</h2><span class="badge warn">${shortages.length}</span></div><div class="panel-body">${shortages.map((s) => `<div class="quiet-row"><div><strong>${esc(itemName(s.item))}</strong><small>${esc(s.bom)} needs ${s.need} · ${s.have} on hand</small></div></div>`).join('') || '<p class="form-note">No component shortage for the active BOMs.</p>'}</div></section>`;
}
function bomsPage() {
  const rows = BOMS.filter((b) => hit(b.code, itemName(b.item), b.version));
  return filterBar('BOM, item') + `<section class="panel"><div class="panel-head"><h2>Bills of material</h2><div class="related"><span class="badge">${rows.length} BOMs</span>${exportBtn}<button class="button" data-mf-new="bom">New BOM</button></div></div>
    <div class="table-scroll" data-hscroll><table><thead><tr><th>Code</th><th>Finished item</th><th class="numeric">Version</th><th class="numeric">Output qty</th><th>Components</th><th>Operations</th><th>State</th><th></th></tr></thead>
    <tbody>${rows.map((b) => `<tr class="row-link" data-mf-edit="bom:${esc(b.code)}"><td class="mono">${esc(b.code)}</td><td>${esc(itemName(b.item))}</td><td class="numeric">${b.version}</td><td class="numeric">${b.outputQty}</td><td>${b.components.map((c) => `${esc(itemName(c.item))} × ${c.qty}`).join(', ')}</td><td>${b.operations.map((o) => `${esc(centreName(o.centre))} ${o.minutes}m`).join(', ')}</td><td>${badge(b.active ? 'Active' : 'Draft', b.active ? 'good' : 'warn')}</td><td class="row-go">›</td></tr>`).join('')}</tbody></table></div>
    <div class="table-footer">A BOM is a versioned recipe: what goes in, how long each operation takes, and what comes out.</div></section>`;
}
function routingsPage() {
  const rows = BOMS.flatMap((b) => b.operations.map((o, i) => ({bom: b.code, item: b.item, step: i + 1, centre: o.centre, minutes: o.minutes})));
  return `<section class="panel"><div class="panel-head"><h2>Routings</h2><span class="badge">${rows.length} operations</span>${exportBtn}</div><div class="table-scroll" data-hscroll><table><thead><tr><th>BOM</th><th>Item</th><th class="numeric">Step</th><th>Work centre</th><th class="numeric">Minutes</th><th class="numeric">Rate</th></tr></thead><tbody>${rows.map((r) => `<tr><td class="mono">${esc(r.bom)}</td><td>${esc(itemName(r.item))}</td><td class="numeric">${r.step}</td><td>${esc(centreName(r.centre))}</td><td class="numeric">${r.minutes}</td><td class="numeric">${money((WORK_CENTRES.find((w) => w.code === r.centre) || {}).rate || 0)}</td></tr>`).join('')}</tbody></table></div><div class="table-footer">Routings come from the operations on each BOM. Editing a BOM edits its routing.</div></section>`;
}
function centresPage() {
  const rows = WORK_CENTRES.filter((c) => hit(c.code, c.name));
  return filterBar('Code, work centre') + `<section class="panel"><div class="panel-head"><h2>Work centres</h2><div class="related"><span class="badge">${rows.length} centres</span>${exportBtn}<button class="button" data-mf-new="centre">New work centre</button></div></div>
    <div class="table-scroll" data-hscroll><table><thead><tr><th>Code</th><th>Work centre</th><th class="numeric">Rate / hour</th><th class="numeric">Capacity / month</th><th>Calendar</th><th></th></tr></thead><tbody>${rows.map((c) => `<tr class="row-link" data-mf-edit="centre:${esc(c.code)}"><td class="mono">${esc(c.code)}</td><td>${esc(c.name)}</td><td class="numeric">${money(c.rate)}</td><td class="numeric">${c.capacity}</td><td>${esc(c.calendar)}</td><td class="row-go">›</td></tr>`).join('')}</tbody></table></div></section>`;
}
function planningPage() {
  const rows = BOMS.filter((b) => b.active).map((b) => {
    const stock = stockOf(b.item);
    const need = Math.max(0, 500 - stock);
    const componentShort = b.components.some((c) => stockOf(c.item) < c.qty * (need / Math.max(b.outputQty, 1)));
    return {bom: b.code, item: b.item, stock, need, componentShort, runs: Math.ceil(need / Math.max(b.outputQty, 1))};
  });
  return `<section class="panel"><div class="panel-head"><h2>Planning</h2><span class="badge">Suggestions</span>${exportBtn}</div><div class="table-scroll" data-hscroll><table><thead><tr><th>Item</th><th class="numeric">On hand</th><th class="numeric">Suggested qty</th><th class="numeric">Runs</th><th>Components</th><th>BOM</th></tr></thead><tbody>${rows.map((r) => `<tr><td>${esc(itemName(r.item))}</td><td class="numeric">${r.stock}</td><td class="numeric">${r.need}</td><td class="numeric">${r.runs}</td><td>${r.componentShort ? badge('Short', 'warn') : badge('Ready', 'good')}</td><td class="mono">${esc(r.bom)}</td></tr>`).join('')}</tbody></table></div><div class="table-footer">Suggested quantity brings the item to 500 units; the next step is a work order. Nothing is created automatically.</div></section>`;
}
function ordersPage() {
  const rows = WORK_ORDERS.filter((o) => hit(o.id, itemName(o.item), o.status) && (!F.status || o.status === F.status));
  return filterBar('Order, item, status', `<label>Status<select name="status"><option value="">All states</option>${['planned', 'released', 'in progress', 'closed'].map((s) => `<option value="${s}" ${F.status === s ? 'selected' : ''}>${s}</option>`).join('')}</select></label>`) +
    `<section class="panel"><div class="panel-head"><h2>Work orders</h2><div class="related"><span class="badge">${rows.length} orders</span>${exportBtn}<button class="button" data-mf-new="order">New work order</button></div></div>
    <div class="table-scroll" data-hscroll><table><thead><tr><th>Order</th><th>Item</th><th class="numeric">Qty</th><th class="numeric">Issued</th><th class="numeric">Produced</th><th class="numeric">Scrap</th><th>Due</th><th>Status</th><th>Actions</th></tr></thead>
    <tbody>${rows.map((o) => `<tr><td class="mono">${esc(o.id)}</td><td>${esc(itemName(o.item))}</td><td class="numeric">${o.qty}</td><td class="numeric">${o.issued}</td><td class="numeric">${o.produced}</td><td class="numeric">${o.scrap}</td><td>${o.due}</td><td>${badge(o.status, o.status === 'closed' ? 'good' : o.status === 'planned' ? '' : 'plum')}</td><td><div class="related"><button class="text-button" data-mf-action="release:${esc(o.id)}">Release</button><button class="text-button" data-mf-action="issue:${esc(o.id)}">Issue</button><button class="text-button" data-mf-action="produce:${esc(o.id)}">Produce</button><button class="text-button" data-mf-action="close:${esc(o.id)}">Close</button></div></td></tr>`).join('')}</tbody></table></div>
    <div class="table-footer">Release locks the plan; Issue consumes components; Produce receives output; Close ends the order. Each action writes stock movements.</div></section>`;
}
function scrapPage() {
  const rows = WORK_ORDERS.filter((o) => (o.scrap || 0) > 0 || o.status !== 'closed');
  return `<section class="panel"><div class="panel-head"><h2>Scrap &amp; rework</h2><div class="related"><span class="badge">${rows.length} orders</span>${exportBtn}<button class="button" data-mf-new="scrap">Record scrap</button></div></div>
    <div class="table-scroll" data-hscroll><table><thead><tr><th>Order</th><th>Item</th><th class="numeric">Scrap</th><th class="numeric">Produced</th><th>Yield</th></tr></thead><tbody>${rows.map((o) => `<tr><td class="mono">${esc(o.id)}</td><td>${esc(itemName(o.item))}</td><td class="numeric">${o.scrap || 0}</td><td class="numeric">${o.produced}</td><td>${o.produced + (o.scrap || 0) ? Math.round((o.produced / (o.produced + (o.scrap || 0))) * 100) + '%' : '—'}</td></tr>`).join('')}</tbody></table></div><div class="table-footer">Scrap is recorded against the order and reduces yield; its cost stays with the order.</div></section>`;
}
function subcontractPage() {
  return `<section class="panel"><div class="panel-head"><h2>Subcontracting</h2><div class="related"><span class="badge">0 documents</span>${exportBtn}<button class="button" data-mf-new="subcontract">New subcontract</button></div></div>
    <div class="panel-body"><p class="form-note">Send components to a subcontractor and receive the finished item back. Each step writes a stock movement: an issue to the subcontractor and a receipt of the finished item. No subcontract document exists yet in the sample data.</p></div></section>`;
}
function costingPage() {
  const rows = WORK_ORDERS.map((o) => { const c = orderCost(o); const standard = Math.round(((BOMS.find((b) => b.code === o.bom) || {outputQty: 1}).outputQty ? 0 : 0)); return {...o, ...c, variance: Math.round((c.total - standard) * 100) / 100}; });
  return `<section class="panel"><div class="panel-head"><h2>Costing</h2><span class="badge">Material + labour</span>${exportBtn}</div>
    <div class="table-scroll" data-hscroll><table><thead><tr><th>Order</th><th>Item</th><th class="numeric">Material</th><th class="numeric">Labour</th><th class="numeric">Total</th><th class="numeric">Per unit</th><th>Status</th></tr></thead><tbody>${rows.map((o) => `<tr><td class="mono">${esc(o.id)}</td><td>${esc(itemName(o.item))}</td><td class="numeric">${money(o.material)}</td><td class="numeric">${money(o.labour)}</td><td class="numeric">${money(o.total)}</td><td class="numeric">${o.produced ? money(o.total / o.produced) : '—'}</td><td>${badge(o.status, o.status === 'closed' ? 'good' : '')}</td></tr>`).join('')}</tbody></table></div>
    <div class="table-footer">Material is issued quantity × average cost; labour is the routing minutes × work-centre rate scaled to the order quantity. Standard cost comparison arrives with the costing review.</div></section>`;
}
function reportsPage() {
  return `<div class="two-column">
    <section class="panel"><div class="panel-head"><h2>Order status</h2>${exportBtn}</div><div class="table-scroll" data-hscroll><table><thead><tr><th>Status</th><th class="numeric">Orders</th><th class="numeric">Qty</th></tr></thead><tbody>${['planned', 'released', 'in progress', 'closed'].map((s) => { const list = WORK_ORDERS.filter((o) => o.status === s); return `<tr><td>${s}</td><td class="numeric">${list.length}</td><td class="numeric">${list.reduce((n, o) => n + o.qty, 0)}</td></tr>`; }).join('')}</tbody></table></div></section>
    <section class="panel"><div class="panel-head"><h2>Material consumption</h2>${exportBtn}</div><div class="table-scroll" data-hscroll><table><thead><tr><th>Item</th><th class="numeric">Issued</th><th class="numeric">Produced</th><th>Yield</th></tr></thead><tbody>${WORK_ORDERS.map((o) => `<tr><td>${esc(itemName(o.item))}</td><td class="numeric">${o.issued}</td><td class="numeric">${o.produced}</td><td>${o.issued ? Math.round((o.produced / o.issued) * 100) + '%' : '—'}</td></tr>`).join('')}</tbody></table></div></section>
  </div>`;
}

export const DRAFT = {bom: {code: '', item: 'ITM-PACK', outputQty: '100', component: 'ITM-INK', componentQty: '1', centre: 'WC-PRINT', minutes: '30'}, centre: {code: '', name: '', rate: '0.00', capacity: '480', calendar: 'Mon–Sat'}, order: {item: 'ITM-PACK', bom: 'BOM-PACK-1', qty: '100', due: '2026-12-15', warehouse: 'WH-KHI'}, scrap: {order: 'WO-2026-001', qty: '1', reason: 'Damaged in process'}, subcontract: {}};

export function view(tab) {
  if (tab === 'boms') return bomsPage();
  if (tab === 'routings') return routingsPage();
  if (tab === 'work-centres') return centresPage();
  if (tab === 'planning') return planningPage();
  if (tab === 'orders') return ordersPage();
  if (tab === 'scrap') return scrapPage();
  if (tab === 'subcontracting') return subcontractPage();
  if (tab === 'costing') return costingPage();
  if (tab === 'reports') return reportsPage();
  return dashboard();
}
export function editor(form, code) {
  if (form === 'bom') {
    const b = code ? BOMS.find((x) => x.code === code) : DRAFT.bom;
    return `<section class="panel"><div class="panel-head"><h2>${b.code ? esc(b.code) : 'New bill of material'}</h2><span class="badge">Recipe</span></div>
      <form data-mf-form="bom" class="panel-body form-grid"><input type="hidden" name="editingCode" value="${esc(b.code || '')}">
        <label>Code<input name="code" required value="${esc(b.code || '')}" ${b.code ? 'readonly' : ''}></label>
        <label>Finished item<select name="item" class="inline-input">${ITEMS.map((i) => `<option value="${esc(i.code)}" ${i.code === b.item ? 'selected' : ''}>${esc(i.name)}</option>`).join('')}</select></label>
        <label>Output quantity<input name="outputQty" value="${b.outputQty || 100}" inputmode="decimal"></label>
        <label>Component<select name="component" class="inline-input">${ITEMS.map((i) => `<option value="${esc(i.code)}">${esc(i.name)}</option>`).join('')}</select></label>
        <label>Component quantity<input name="componentQty" value="${(b.components && b.components[0] && b.components[0].qty) || 1}" inputmode="decimal"></label>
        <label>Operation centre<select name="centre" class="inline-input">${WORK_CENTRES.map((c) => `<option value="${esc(c.code)}">${esc(c.name)}</option>`).join('')}</select></label>
        <label>Operation minutes<input name="minutes" value="${(b.operations && b.operations[0] && b.operations[0].minutes) || 30}" inputmode="decimal"></label>
        <div class="related"><button class="button primary">Save BOM</button><button type="button" class="button" data-mf-cancel>Cancel</button></div></form></section>`;
  }
  if (form === 'centre') {
    const c = code ? WORK_CENTRES.find((x) => x.code === code) : DRAFT.centre;
    return `<section class="panel"><div class="panel-head"><h2>${c.code ? esc(c.name) : 'New work centre'}</h2></div>
      <form data-mf-form="centre" class="panel-body form-grid"><input type="hidden" name="editingCode" value="${esc(c.code || '')}">
        <label>Code<input name="code" required value="${esc(c.code || '')}" ${c.code ? 'readonly' : ''}></label><label>Name<input name="name" required value="${esc(c.name || '')}"></label>
        <label>Rate / hour<input name="rate" value="${c.rate || 0}" inputmode="decimal"></label><label>Capacity / month<input name="capacity" value="${c.capacity || 480}" inputmode="numeric"></label>
        <label>Calendar<input name="calendar" value="${esc(c.calendar || 'Mon–Sat')}"></label>
        <div class="related"><button class="button primary">Save</button><button type="button" class="button" data-mf-cancel>Cancel</button></div></form></section>`;
  }
  if (form === 'order') {
    return `<section class="panel"><div class="panel-head"><h2>New work order</h2><span class="badge">Plan</span></div>
      <form data-mf-form="order" class="panel-body form-grid">
        <label>Item<select name="item" class="inline-input">${ITEMS.map((i) => `<option value="${esc(i.code)}">${esc(i.name)}</option>`).join('')}</select></label>
        <label>BOM<select name="bom" class="inline-input">${BOMS.map((b) => `<option value="${esc(b.code)}">${esc(b.code)} · ${esc(itemName(b.item))}</option>`).join('')}</select></label>
        <label>Quantity<input name="qty" value="100" inputmode="decimal"></label><label>Due date<input name="due" type="date" value="2026-12-15"></label>
        <label>Warehouse<select name="warehouse" class="inline-input">${WAREHOUSES.map((w) => `<option value="${esc(w.code)}">${esc(w.name)}</option>`).join('')}</select></label>
        <div class="related"><button class="button primary">Create order</button><button type="button" class="button" data-mf-cancel>Cancel</button></div></form></section>`;
  }
  if (form === 'scrap') {
    return `<section class="panel"><div class="panel-head"><h2>Record scrap</h2></div>
      <form data-mf-form="scrap" class="panel-body form-grid">
        <label>Work order<select name="order" class="inline-input">${WORK_ORDERS.map((o) => `<option value="${esc(o.id)}">${esc(o.id)} · ${esc(itemName(o.item))}</option>`).join('')}</select></label>
        <label>Quantity<input name="qty" value="1" inputmode="decimal"></label>
        <label>Reason<select name="reason" class="inline-input"><option>Damaged in process</option><option>Material defect</option><option>Machine fault</option><option>Rework</option></select></label>
        <div class="related"><button class="button primary">Record</button><button type="button" class="button" data-mf-cancel>Cancel</button></div></form></section>`;
  }
  return `<section class="panel"><div class="panel-head"><h2>Subcontracting</h2></div><div class="panel-body"><p class="form-note">The subcontract document is the next increment: send components, receive the finished item, reconcile the cost.</p><div class="related"><button class="button" data-mf-cancel>Back</button></div></div></section>`;
}

export function bind(render, notify, navigate) {
  document.querySelectorAll('[data-mf-filter]').forEach((form) => {
    form.querySelector('[name="q"]')?.addEventListener('input', (ev) => { F.q = ev.target.value; render(); const a = document.querySelector('[data-mf-filter] [name="q"]'); if (a) a.focus(); });
    form.querySelector('[name="status"]')?.addEventListener('change', (ev) => { F.status = ev.target.value; render(); });
  });
  document.querySelector('[data-mf-reset]')?.addEventListener('click', () => { F.q = ''; F.status = ''; render(); });
  document.querySelectorAll('[data-mf-new]').forEach((b) => b.addEventListener('click', () => navigate({module: 'manufacturing', tab: tabFor(b.dataset.mfNew), mode: 'editor', form: b.dataset.mfNew, code: ''})));
  document.querySelectorAll('[data-mf-edit]').forEach((tr) => tr.addEventListener('click', () => { const [form, code] = tr.dataset.mfEdit.split(':'); navigate({module: 'manufacturing', tab: tabFor(form), mode: 'editor', form, code}); }));
  document.querySelector('[data-mf-cancel]')?.addEventListener('click', () => navigate({module: 'manufacturing', tab: 'dashboard'}));
  document.querySelectorAll('[data-mf-action]').forEach((b) => b.addEventListener('click', () => {
    const [act, id] = b.dataset.mfAction.split(':');
    const o = WORK_ORDERS.find((x) => x.id === id);
    if (!o) return;
    if (act === 'release') { o.status = 'released'; notify(`${id} released.`); }
    if (act === 'issue') { const bom = BOMS.find((b2) => b2.code === o.bom); const qty = bom ? bom.components.reduce((n, c) => n + c.qty * (o.qty / Math.max(bom.outputQty, 1)), 0) : 0; (bom ? bom.components : []).forEach((c, i) => STOCK_MOVES.push({id: 'MV-WO-' + STOCK_MOVES.length, date: '2026-11-30', type: 'issue', item: c.item, warehouse: o.warehouse, qty: -c.qty * (o.qty / Math.max(bom.outputQty, 1)), unitCost: averageCost(c.item), value: Math.round(-averageCost(c.item) * c.qty * (o.qty / Math.max(bom.outputQty, 1)) * 100) / 100, source: 'Work order issue', reference: id, project: '', location: '', reason: ''})); o.issued = Math.round((o.issued + qty) * 100) / 100; o.status = 'in progress'; notify(`${id}: components issued.`); }
    if (act === 'produce') { const qty = Math.round(o.qty - o.produced); if (qty > 0) { STOCK_MOVES.push({id: 'MV-WO-' + STOCK_MOVES.length, date: '2026-11-30', type: 'receipt', item: o.item, warehouse: o.warehouse, qty, unitCost: averageCost(o.item), value: Math.round(averageCost(o.item) * qty * 100) / 100, source: 'Production receipt', reference: id, project: '', location: '', reason: ''}); o.produced += qty; } o.status = 'in progress'; notify(`${id}: output received.`); }
    if (act === 'close') { o.status = 'closed'; notify(`${id} closed.`); }
    render();
  }));
  document.querySelectorAll('[data-mf-form]').forEach((form) => form.addEventListener('submit', (ev) => {
    ev.preventDefault();
    if (!form.reportValidity()) return;
    const kind = form.dataset.mfForm;
    const v = Object.fromEntries(new FormData(form));
    if (kind === 'bom') {
      const editing = v.editingCode || '';
      const rec = {code: v.code, item: v.item, version: 1, outputQty: Number(v.outputQty), components: [{item: v.component, qty: Number(v.componentQty)}], operations: [{centre: v.centre, minutes: Number(v.minutes)}], active: true};
      if (editing) { Object.assign(BOMS.find((b) => b.code === editing), rec); notify('BOM updated.'); }
      else { BOMS.push(rec); notify('BOM added.'); }
      navigate({module: 'manufacturing', tab: 'boms'}); return;
    }
    if (kind === 'centre') {
      const editing = v.editingCode || '';
      const rec = {code: v.code, name: v.name, rate: Number(v.rate), capacity: Number(v.capacity), calendar: v.calendar};
      if (editing) { Object.assign(WORK_CENTRES.find((c) => c.code === editing), rec); notify('Work centre updated.'); }
      else { WORK_CENTRES.push(rec); notify('Work centre added.'); }
      navigate({module: 'manufacturing', tab: 'work-centres'}); return;
    }
    if (kind === 'order') {
      WORK_ORDERS.push({id: 'WO-2026-' + String(100 + WORK_ORDERS.length), date: '2026-11-30', item: v.item, bom: v.bom, qty: Number(v.qty), warehouse: v.warehouse, due: v.due, status: 'planned', issued: 0, produced: 0, scrap: 0});
      notify('Work order created.'); navigate({module: 'manufacturing', tab: 'orders'}); return;
    }
    if (kind === 'scrap') {
      const o = WORK_ORDERS.find((x) => x.id === v.order);
      if (o) { o.scrap = (o.scrap || 0) + Number(v.qty); notify('Scrap recorded.'); }
      navigate({module: 'manufacturing', tab: 'scrap'});
    }
  }));
}
function tabFor(form) { return {bom: 'boms', centre: 'work-centres', order: 'orders', scrap: 'scrap', subcontract: 'subcontracting'}[form] || 'dashboard'; }
