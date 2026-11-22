// Assets: categories, register, acquisitions, depreciation, impairment,
// transfers and disposals. Straight-line depreciation on the sample register.
import {ASSETS, ASSET_CATEGORIES, monthlyDepreciation, assetNbv} from './ops-model.js';
import {LOCATIONS} from './accounting-model.js';

const money = (n) => Number(n || 0).toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2});
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
const badge = (t, k = '') => `<span class="badge ${k}">${esc(t)}</span>`;
const cat = (code) => ASSET_CATEGORIES.find((c) => c.code === code) || {name: code, rate: 0};
const F = {q: '', category: '', status: ''};
const kpi = (l, v, b) => `<section class="stat"><span class="stat-label">${esc(l)}</span><strong class="value numeric">${v}</strong><small>${esc(b)}</small></section>`;
const hit = (...p) => !F.q || p.join(' ').toLowerCase().includes(F.q.toLowerCase());
const filterBar = (ph, extra = '') => `<form class="filterbar" data-as-filter><label>Search<input type="search" name="q" value="${esc(F.q)}" placeholder="${esc(ph)}"></label>${extra}<button class="button" type="button" data-as-reset>Reset</button></form>`;
const exportBtn = '<button class="button" data-export-table>Export CSV</button>';
const DEP_RUNS = [];

function dashboard() {
  const nbv = ASSETS.filter((a) => a.status !== 'disposed').reduce((n, a) => n + assetNbv(a), 0);
  const cost = ASSETS.reduce((n, a) => n + a.cost, 0);
  const accum = ASSETS.reduce((n, a) => n + a.accum, 0);
  const charge = ASSETS.filter((a) => a.status !== 'disposed').reduce((n, a) => n + monthlyDepreciation(a), 0);
  return `<div class="stats">
      ${kpi('Net book value', money(nbv), `${ASSETS.length} assets`)}
      ${kpi('Cost', money(cost), 'Capitalised')}
      ${kpi('Accumulated depreciation', money(accum), 'To date')}
      ${kpi('Monthly charge', money(charge), 'Straight line')}
    </div>
    <section class="panel"><div class="panel-head"><h2>Assets</h2><button class="text-button" data-module="assets" data-tab="register">Open register ↗</button></div>
      <div class="table-scroll" data-hscroll><table><thead><tr><th>Code</th><th>Asset</th><th>Category</th><th>Location</th><th class="numeric">Cost</th><th class="numeric">NBV</th><th>Status</th></tr></thead><tbody>${ASSETS.slice(0, 6).map((a) => `<tr><td class="mono">${esc(a.code)}</td><td>${esc(a.name)}</td><td>${esc(a.serial || '—')}</td><td>${esc(cat(a.category).name)}</td><td>${esc(a.location)}</td><td class="numeric">${money(a.cost)}</td><td class="numeric">${money(assetNbv(a))}</td><td>${badge(a.status, a.status === 'disposed' ? 'warn' : 'good')}</td></tr>`).join('')}</tbody></table></div></section>`;
}
function registerPage() {
  const rows = ASSETS.filter((a) => hit(a.code, a.name, a.custodian, a.location, cat(a.category).name) && (!F.category || a.category === F.category) && (!F.status || a.status === F.status));
  return filterBar('Code, asset, custodian', `<label>Category<select name="category"><option value="">All categories</option>${ASSET_CATEGORIES.map((c) => `<option value="${esc(c.code)}" ${F.category === c.code ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select></label><label>Status<select name="status"><option value="">All states</option><option ${F.status === 'in use' ? 'selected' : ''}>in use</option><option ${F.status === 'disposed' ? 'selected' : ''}>disposed</option></select></label>`) +
    `<section class="panel"><div class="panel-head"><h2>Asset register</h2><div class="related"><span class="badge">${rows.length} assets</span>${exportBtn}<button class="button" data-as-new="asset">New asset</button></div></div>
    <div class="table-scroll" data-hscroll><table><thead><tr><th>Code</th><th>Asset</th><th>Serial</th><th>Category</th><th>Location</th><th>Custodian</th><th>Acquired</th><th class="numeric">Cost</th><th class="numeric">Accumulated</th><th class="numeric">NBV</th><th>Status</th><th></th></tr></thead>
    <tbody>${rows.map((a) => `<tr class="row-link" data-as-edit="asset:${esc(a.code)}"><td class="mono">${esc(a.code)}</td><td>${esc(a.name)}</td><td>${esc(a.serial || '—')}</td><td>${esc(cat(a.category).name)}</td><td>${esc(a.location)}</td><td>${esc(a.custodian)}</td><td>${a.date}</td><td class="numeric">${money(a.cost)}</td><td class="numeric">${money(a.accum)}</td><td class="numeric">${money(assetNbv(a))}</td><td>${badge(a.status, a.status === 'disposed' ? 'warn' : 'good')}</td><td class="row-go">›</td></tr>`).join('')}</tbody></table></div>
    <div class="table-footer">Cost less accumulated depreciation is net book value. A disposed asset stays in the register with its gain or loss.</div></section>`;
}
function categoriesPage() {
  return `<section class="panel"><div class="panel-head"><h2>Categories</h2><div class="related"><span class="badge">${ASSET_CATEGORIES.length} categories</span>${exportBtn}<button class="button" data-as-new="category">New category</button></div></div>
    <div class="table-scroll" data-hscroll><table><thead><tr><th>Code</th><th>Category</th><th>Method</th><th class="numeric">Rate</th><th class="numeric">Life</th><th>Asset account</th><th>Depreciation account</th><th></th></tr></thead><tbody>${ASSET_CATEGORIES.map((c) => `<tr class="row-link" data-as-edit="category:${esc(c.code)}"><td class="mono">${esc(c.code)}</td><td>${esc(c.name)}</td><td>${esc(c.method)}</td><td class="numeric">${c.rate}%</td><td class="numeric">${c.life}</td><td class="mono">${esc(c.assetAccount)}</td><td class="mono">${esc(c.depAccount)}</td><td class="row-go">›</td></tr>`).join('')}</tbody></table></div><div class="table-footer">The category carries the depreciation method and the accounts. Asset codes and accounts will link to the chart when posting is added.</div></section>`;
}
function acquisitionsPage() {
  return `<section class="panel"><div class="panel-head"><h2>Acquisitions &amp; capital work in progress</h2><div class="related"><span class="badge">${ASSETS.length} capitalised</span>${exportBtn}<button class="button" data-as-new="asset">Capitalise an asset</button></div></div>
    <div class="table-scroll" data-hscroll><table><thead><tr><th>Date</th><th>Asset</th><th>Category</th><th class="numeric">Cost</th><th>Status</th></tr></thead><tbody>${ASSETS.slice().sort((a, b) => b.date.localeCompare(a.date)).map((a) => `<tr><td>${a.date}</td><td>${esc(a.name)}</td><td>${esc(cat(a.category).name)}</td><td class="numeric">${money(a.cost)}</td><td>${badge(a.status, a.status === 'disposed' ? 'warn' : 'good')}</td></tr>`).join('')}</tbody></table></div><div class="table-footer">An acquisition creates the asset. Capital work in progress arrives with the project module; the form accepts the capitalised cost today.</div></section>`;
}
function depreciationPage() {
  const rows = ASSETS.filter((a) => a.status !== 'disposed').map((a) => ({...a, charge: monthlyDepreciation(a)}));
  return `<section class="panel"><div class="panel-head"><h2>Depreciation</h2><div class="related"><span class="badge">${DEP_RUNS.length} runs</span>${exportBtn}<button class="button primary" data-as-run>Run November charge</button></div></div>
    <div class="table-scroll" data-hscroll><table><thead><tr><th>Asset</th><th>Category</th><th class="numeric">Cost</th><th class="numeric">Accumulated</th><th class="numeric">Monthly charge</th><th class="numeric">NBV after</th></tr></thead><tbody>${rows.map((a) => `<tr><td class="mono">${esc(a.code)} · ${esc(a.name)}</td><td>${esc(cat(a.category).name)}</td><td class="numeric">${money(a.cost)}</td><td class="numeric">${money(a.accum)}</td><td class="numeric">${money(a.charge)}</td><td class="numeric">${money(a.cost - a.accum - a.charge)}</td></tr>`).join('')}</tbody><tfoot><tr><td colspan="4">Charge for the period</td><td class="numeric">${money(rows.reduce((n, a) => n + a.charge, 0))}</td><td></td></tr></tfoot></table></div>
    <div class="table-footer">Straight line: (cost − residual) × rate ÷ 12. Running the charge updates accumulated depreciation for this session; nothing posts to the ledger yet.</div></section>`;
}
function impairmentPage() {
  return `<section class="panel"><div class="panel-head"><h2>Impairment &amp; revaluation</h2><div class="related"><span class="badge">Evidence required</span>${exportBtn}<button class="button" data-as-new="impair">Record impairment</button></div></div>
    <div class="panel-body"><p class="form-note">An impairment writes the asset down with a reason and evidence; a revaluation moves it up or down against the revaluation reserve. Both need approval and are recorded against the asset's history.</p></div></section>`;
}
function transfersPage() {
  return `<section class="panel"><div class="panel-head"><h2>Transfers</h2><div class="related"><span class="badge">Custody</span>${exportBtn}<button class="button" data-as-new="transfer">Transfer an asset</button></div></div><div class="panel-body"><p class="form-note">Transfers move custody or location without changing cost, depreciation or the register identity.</p></div></section>`;
}
function disposalsPage() {
  return `<section class="panel"><div class="panel-head"><h2>Disposals</h2><div class="related"><span class="badge">Sale or scrap</span>${exportBtn}<button class="button" data-as-new="dispose">Dispose an asset</button></div></div>
    <div class="table-scroll" data-hscroll><table><thead><tr><th>Asset</th><th>Date</th><th class="numeric">Cost</th><th class="numeric">Accumulated</th><th class="numeric">Proceeds</th><th class="numeric">Gain / (loss)</th></tr></thead><tbody>${ASSETS.filter((a) => a.status === 'disposed').map((a) => `<tr><td class="mono">${esc(a.code)} · ${esc(a.name)}</td><td>${esc(a.disposedOn || '')}</td><td class="numeric">${money(a.cost)}</td><td class="numeric">${money(a.accum)}</td><td class="numeric">${money(a.proceeds || 0)}</td><td class="numeric">${money((a.proceeds || 0) - assetNbv(a))}</td></tr>`).join('') || '<tr><td colspan="6">No disposals yet.</td></tr>'}</tbody></table></div></section>`;
}
function reportsPage() {
  const rows = ASSETS.map((a) => ({...a, charge: monthlyDepreciation(a), nbv: assetNbv(a)}));
  const next12 = rows.reduce((n, a) => n + a.charge * 12, 0);
  return `<div class="two-column">
    <section class="panel"><div class="panel-head"><h2>Movement schedule</h2>${exportBtn}</div><div class="table-scroll" data-hscroll><table><thead><tr><th>Category</th><th class="numeric">Cost</th><th class="numeric">Accumulated</th><th class="numeric">NBV</th></tr></thead><tbody>${ASSET_CATEGORIES.map((c) => { const list = rows.filter((a) => a.category === c.code); return `<tr><td>${esc(c.name)}</td><td class="numeric">${money(list.reduce((n, a) => n + a.cost, 0))}</td><td class="numeric">${money(list.reduce((n, a) => n + a.accum, 0))}</td><td class="numeric">${money(list.reduce((n, a) => n + a.nbv, 0))}</td></tr>`; }).join('')}</tbody></table></div></section>
    <section class="panel"><div class="panel-head"><h2>Depreciation forecast</h2><span class="badge">Next 12 months</span></div><div class="panel-body"><div class="statement-line total"><span>Charge</span><strong>${money(next12)}</strong></div><p class="form-note">Forecast assumes every asset stays in use for the next twelve months at its current rate.</p></div></section>
  </div>`;
}

export function view(tab) {
  if (tab === 'register') return registerPage();
  if (tab === 'categories') return categoriesPage();
  if (tab === 'acquisitions') return acquisitionsPage();
  if (tab === 'depreciation') return depreciationPage();
  if (tab === 'impairment') return impairmentPage();
  if (tab === 'transfers') return transfersPage();
  if (tab === 'disposals') return disposalsPage();
  if (tab === 'reports') return reportsPage();
  return dashboard();
}

export function editor(form, code) {
  if (form === 'asset') {
    const a = code ? ASSETS.find((x) => x.code === code) : {code: '', name: '', category: 'CAT-FF', location: 'HQ', custodian: '', date: '2026-11-30', cost: 0, residual: 0, accum: 0, status: 'in use'};
    return `<section class="panel"><div class="panel-head"><h2>${a.code ? esc(a.name) : 'New asset'}</h2><span class="badge">${a.code ? 'Editing' : 'Capitalise'}</span></div>
      <form data-as-form="asset" class="panel-body form-grid"><input type="hidden" name="editingCode" value="${esc(a.code || '')}">
        <label>Code<input name="code" required value="${esc(a.code || '')}" ${a.code ? 'readonly' : ''}></label>
        <label>Name<input name="name" required value="${esc(a.name || '')}"></label>
        <label>Serial number<input name="serial" value="${esc(a.serial || '')}"></label>
        <label>Supplier<input name="supplier" value="${esc(a.supplier || '')}"></label>
        <label>Purchase document<input name="invoiceRef" value="${esc(a.invoiceRef || '')}"></label>
        <label>Category<select name="category" class="inline-input">${ASSET_CATEGORIES.map((c) => `<option value="${esc(c.code)}" ${c.code === a.category ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select></label>
        <label>Location<select name="location" class="inline-input">${LOCATIONS.map((l) => `<option value="${esc(l.code)}" ${l.code === a.location ? 'selected' : ''}>${esc(l.code)} · ${esc(l.name)}</option>`).join('')}</select></label>
        <label>Custodian<input name="custodian" value="${esc(a.custodian || '')}"></label>
        <label>Acquired<input name="date" type="date" value="${a.date}" required></label>
        <label>Cost<input name="cost" value="${a.cost || 0}" inputmode="decimal"></label>
        <label>Residual<input name="residual" value="${a.residual || 0}" inputmode="decimal"></label>
        <label>Accumulated depreciation<input name="accum" value="${a.accum || 0}" inputmode="decimal"></label>
        <label>Status<select name="status" class="inline-input"><option ${a.status === 'in use' ? 'selected' : ''}>in use</option><option ${a.status === 'disposed' ? 'selected' : ''}>disposed</option></select></label>
        <div class="related"><button class="button primary">Save asset</button><button type="button" class="button" data-as-cancel>Cancel</button></div></form></section>`;
  }
  if (form === 'category') {
    const c = code ? cat(code) : {code: '', name: '', method: 'straight line', rate: 15, life: 7, assetAccount: '', depAccount: '', expenseAccount: ''};
    return `<section class="panel"><div class="panel-head"><h2>${c.code ? esc(c.name) : 'New category'}</h2></div>
      <form data-as-form="category" class="panel-body form-grid"><input type="hidden" name="editingCode" value="${esc(c.code || '')}">
        <label>Code<input name="code" required value="${esc(c.code || '')}" ${c.code ? 'readonly' : ''}></label><label>Name<input name="name" required value="${esc(c.name || '')}"></label>
        <label>Method<select name="method" class="inline-input"><option>straight line</option><option>reducing balance</option></select></label>
        <label>Rate %<input name="rate" value="${c.rate || 0}" inputmode="decimal"></label><label>Life (years)<input name="life" value="${c.life || 0}" inputmode="numeric"></label>
        <label>Asset account<input name="assetAccount" value="${esc(c.assetAccount || '')}"></label><label>Depreciation account<input name="depAccount" value="${esc(c.depAccount || '')}"></label><label>Expense account<input name="expenseAccount" value="${esc(c.expenseAccount || '')}"></label>
        <div class="related"><button class="button primary">Save</button><button type="button" class="button" data-as-cancel>Cancel</button></div></form></section>`;
  }
  if (form === 'impair') return `<section class="panel"><div class="panel-head"><h2>Record impairment</h2></div><form data-as-form="impair" class="panel-body form-grid"><label>Asset<select name="asset" class="inline-input">${ASSETS.map((a) => `<option value="${esc(a.code)}">${esc(a.code)} · ${esc(a.name)}</option>`).join('')}</select></label><label>Amount<input name="amount" value="0" inputmode="decimal"></label><label class="wide">Reason<input name="reason" placeholder="Evidence reference"></label><div class="related"><button class="button primary">Record</button><button type="button" class="button" data-as-cancel>Cancel</button></div></form></section>`;
  if (form === 'transfer') return `<section class="panel"><div class="panel-head"><h2>Transfer asset</h2></div><form data-as-form="transfer" class="panel-body form-grid"><label>Asset<select name="asset" class="inline-input">${ASSETS.map((a) => `<option value="${esc(a.code)}">${esc(a.code)} · ${esc(a.name)}</option>`).join('')}</select></label><label>Location<select name="location" class="inline-input">${LOCATIONS.map((l) => `<option value="${esc(l.code)}">${esc(l.name)}</option>`).join('')}</select></label><label>Custodian<input name="custodian"></label><div class="related"><button class="button primary">Transfer</button><button type="button" class="button" data-as-cancel>Cancel</button></div></form></section>`;
  if (form === 'dispose') return `<section class="panel"><div class="panel-head"><h2>Dispose asset</h2></div><form data-as-form="dispose" class="panel-body form-grid"><label>Asset<select name="asset" class="inline-input">${ASSETS.filter((a) => a.status !== 'disposed').map((a) => `<option value="${esc(a.code)}">${esc(a.code)} · ${esc(a.name)} · NBV ${money(assetNbv(a))}</option>`).join('')}</select></label><label>Date<input name="date" type="date" value="2026-11-30"></label><label>Proceeds<input name="proceeds" value="0" inputmode="decimal"></label><div class="related"><button class="button primary">Dispose</button><button type="button" class="button" data-as-cancel>Cancel</button></div></form></section>`;
  return '';
}

export function bind(render, notify, navigate) {
  document.querySelectorAll('[data-as-filter]').forEach((form) => {
    form.querySelector('[name="q"]')?.addEventListener('input', (ev) => { F.q = ev.target.value; render(); const a = document.querySelector('[data-as-filter] [name="q"]'); if (a) a.focus(); });
    form.querySelector('[name="category"]')?.addEventListener('change', (ev) => { F.category = ev.target.value; render(); });
    form.querySelector('[name="status"]')?.addEventListener('change', (ev) => { F.status = ev.target.value; render(); });
  });
  document.querySelector('[data-as-reset]')?.addEventListener('click', () => { F.q = ''; F.category = ''; F.status = ''; render(); });
  document.querySelectorAll('[data-as-new]').forEach((b) => b.addEventListener('click', () => navigate({module: 'assets', tab: tabFor(b.dataset.asNew), mode: 'editor', form: b.dataset.asNew, code: ''})));
  document.querySelectorAll('[data-as-edit]').forEach((tr) => tr.addEventListener('click', () => { const [form, code] = tr.dataset.asEdit.split(':'); navigate({module: 'assets', tab: tabFor(form), mode: 'editor', form, code}); }));
  document.querySelector('[data-as-cancel]')?.addEventListener('click', () => navigate({module: 'assets', tab: 'register'}));
  document.querySelector('[data-as-run]')?.addEventListener('click', () => {
    const charge = ASSETS.filter((a) => a.status !== 'disposed').reduce((n, a) => n + monthlyDepreciation(a), 0);
    ASSETS.filter((a) => a.status !== 'disposed').forEach((a) => { a.accum = Math.round((a.accum + monthlyDepreciation(a)) * 100) / 100; });
    DEP_RUNS.push({period: '2026-11', charge: Math.round(charge * 100) / 100});
    notify(`November depreciation run: ${charge.toFixed(2)}. Accumulated values updated.`);
    render();
  });
  document.querySelectorAll('[data-as-form]').forEach((form) => form.addEventListener('submit', (ev) => {
    ev.preventDefault();
    if (!form.reportValidity()) return;
    const kind = form.dataset.asForm;
    const v = Object.fromEntries(new FormData(form));
    if (kind === 'asset') {
      const editing = v.editingCode || '';
      if (!editing && ASSETS.some((a) => a.code === v.code)) { notify('That asset code already exists.'); return; }
      const rec = {code: v.code, name: v.name, serial: v.serial || '', supplier: v.supplier || '', invoiceRef: v.invoiceRef || '', category: v.category, location: v.location, custodian: v.custodian || '', date: v.date, cost: Number(v.cost) || 0, residual: Number(v.residual) || 0, accum: Number(v.accum) || 0, status: v.status};
      if (editing) { Object.assign(ASSETS.find((a) => a.code === editing), rec); notify('Asset updated.'); }
      else { ASSETS.push(rec); notify('Asset capitalised for this session.'); }
      navigate({module: 'assets', tab: 'register'}); return;
    }
    if (kind === 'category') {
      const editing = v.editingCode || '';
      const rec = {code: v.code, name: v.name, method: v.method, rate: Number(v.rate), life: Number(v.life), assetAccount: v.assetAccount, depAccount: v.depAccount, expenseAccount: v.expenseAccount};
      if (editing) { Object.assign(ASSET_CATEGORIES.find((c) => c.code === editing), rec); notify('Category updated.'); }
      else { ASSET_CATEGORIES.push(rec); notify('Category added.'); }
      navigate({module: 'assets', tab: 'categories'}); return;
    }
    if (kind === 'impair') {
      const a = ASSETS.find((x) => x.code === v.asset);
      const amount = Number(v.amount) || 0;
      if (a && amount > 0) { a.accum = Math.round((a.accum + amount) * 100) / 100; a.impairment = v.reason || ''; notify(`Impairment of ${amount.toFixed(2)} recorded against ${a.code}.`); }
      navigate({module: 'assets', tab: 'impairment'}); return;
    }
    if (kind === 'transfer') {
      const a = ASSETS.find((x) => x.code === v.asset);
      if (a) { a.location = v.location; a.custodian = v.custodian || a.custodian; notify('Transfer recorded.'); }
      navigate({module: 'assets', tab: 'transfers'}); return;
    }
    if (kind === 'dispose') {
      const a = ASSETS.find((x) => x.code === v.asset);
      if (a) { a.status = 'disposed'; a.disposedOn = v.date; a.proceeds = Number(v.proceeds) || 0; notify(`Disposed. Gain or loss ${((a.proceeds || 0) - assetNbv(a)).toFixed(2)}.`); }
      navigate({module: 'assets', tab: 'disposals'});
    }
  }));
}
function tabFor(form) { return {asset: 'register', category: 'categories', impair: 'impairment', transfer: 'transfers', dispose: 'disposals'}[form] || 'register'; }
