// Screens added on top of the retained saventesting build.
// Markup uses only the existing classes from ui/theme.css. No new styling,
// no shader, no animation. Every total that duplicates a ledger figure is
// derived from accounting-model.js so the screens cannot contradict it.
import {escape as e} from './model.js';
import {fixture,trial,statements,PROJECTS,LOCATIONS,COST_CENTRES,PARTIES,CASH_BANK,ITEMS,TAX_RULES,BANK_NAMES,CASH_NAMES,CUSTOM_FIELDS,NUMBERING,PARTY_GROUPS,ITEM_GROUPS} from './accounting-model.js';
import {icon} from './icons.js';
import {catalog} from './catalog.js';
import {PAGE} from './pages-map.js';

const num = (v) => Number(String(v ?? '').replace(/[^0-9.-]/g, '')) || 0;
const round2 = (n) => Math.round(n * 100) / 100;
const money = (n) => {
  const v = round2(Math.abs(Number(n) || 0));
  const s = v.toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2});
  return Number(n) < 0 ? `(${s})` : s;
};
const badge = (label, kind = '') => `<span class="badge ${kind}">${e(label)}</span>`;
const button = (label, action, extra = '', primary = false) => `<button type="button" class="button ${primary ? 'primary' : ''}" data-ac="${action}" ${extra}>${label}</button>`;
const textButton = (label, action, extra = '') => `<button type="button" class="text-button" data-ac="${action}" ${extra}>${label}</button>`;

// Which Setup section is open. Membership of projects and locations lives on
// the party and sub-account forms, not here.
let SETUP_TAB = 'numbering';


/* ------------------------------------------------------------------ projects */
export function projectTotals(company) {
  const docs = fixture(company);
  return PROJECTS.map((p) => {
    let revenue = 0, cost = 0, postings = 0;
    for (const d of docs) for (const l of d.lines) {
      if ((l.project || d.project || 'HO') !== p.code) continue;
      postings++;
      if (String(l.account).startsWith('4')) revenue += num(l.credit) - num(l.debit);
      if (String(l.account).startsWith('5') || String(l.account).startsWith('6')) cost += num(l.debit) - num(l.credit);
    }
    return {...p, revenue: round2(revenue), cost: round2(cost), net: round2(revenue - cost), postings};
  });
}

export function projectsScreen(company) {
  const rows = projectTotals(company);
  return `<section class="panel">
    <div class="panel-head"><h2>Projects</h2><span class="badge">${rows.length} projects</span></div>
    <div class="table-scroll">
      <table>
        <thead><tr><th>Code</th><th>Project</th><th>Manager</th><th>Status</th><th class="numeric">Accounts</th><th class="numeric">Postings</th><th class="numeric">Revenue</th><th class="numeric">Cost</th><th class="numeric">Net</th></tr></thead>
        <tbody>${rows.map((p) => `<tr>
          <td><span class="mono">${e(p.code)}</span></td>
          <td>${e(p.name)}</td>
          <td>${e(p.manager)}</td>
          <td><span class="badge ${p.status === 'active' ? 'good' : 'warn'}">${e(p.status)}</span></td>
          <td class="numeric">${p.accounts.length}</td>
          <td class="numeric">${p.postings}</td>
          <td class="numeric">${money(p.revenue)}</td>
          <td class="numeric">${money(p.cost)}</td>
          <td class="numeric">${money(p.net)}</td>
        </tr>`).join('')}</tbody>
        <tfoot><tr><td colspan="6">Total</td><td class="numeric">${money(rows.reduce((n, p) => n + p.revenue, 0))}</td><td class="numeric">${money(rows.reduce((n, p) => n + p.cost, 0))}</td><td class="numeric">${money(rows.reduce((n, p) => n + p.net, 0))}</td></tr></tfoot>
      </table>
    </div>
    <div class="table-footer">Totals come from the ledger lines tagged with each project. Head office is a project, so company costs have a home.</div>
  </section>
  <details class="gl-columns">
    <summary>New project</summary>
    <form id="project-form" class="form-grid">
      <label>Code<input name="code" required pattern="[A-Z0-9-]{2,20}" placeholder="PRJ-NORTH"></label>
      <label>Name<input name="name" required maxlength="60" placeholder="North depot"></label>
      <label>Manager<input name="manager" required maxlength="40" value="A. Rehman"></label>
      <label>Status<select name="status"><option>active</option><option>on hold</option></select></label>
      <div class="related"><button class="button primary">Add project</button></div>
    </form>
  </details>`;
}

export function bindProjectForm(rerender, notify) {
  document.querySelector('#project-form')?.addEventListener('submit', (ev) => {
    ev.preventDefault();
    const v = Object.fromEntries(new FormData(ev.target));
    if (PROJECTS.some((p) => p.code === v.code)) { notify('That project code already exists.'); return; }
    PROJECTS.push({code: v.code, name: v.name, status: v.status, manager: v.manager, accounts: []});
    notify('Project added for this session. It has no postings yet.');
    rerender();
  });
}

/* --------------------------------------------------------------------- taxes */
const TAX_TABS = [
  ['rules', 'Rules'],
  ['registers', 'Registers'],
  ['withholding', 'Withholding'],
  ['advance', 'Advance tax'],
  ['adjustments', 'Reconciliation'],
];
let TAX_ACTIVE = 'rules';
let PARTY_OPEN = '';
let PERIOD_LOCKED = false;
// Inline editing of master-data forms: the same form creates and updates.
const EDIT = {type: '', code: ''};
// Per-register filters. They survive a re-render because they live here.
const FILTERS = {
  cash: {q: '', kind: '', control: '', status: '', asof: ''},
  parties: {q: '', type: '', status: '', asof: '', balance: ''},
  items: {q: ''},
  tax: {q: ''},
  payments: {q: '', direction: ''},
  invoices: {q: ''},
};
const hit = (q, ...parts) => !q || parts.join(' ').toLowerCase().includes(String(q).toLowerCase());
const filterInput = (key, value, placeholder) => `<label>Search<input type="search" name="q" data-filter-focus="${key}" value="${e(value)}" placeholder="${e(placeholder)}"></label>`;
const editing = (type, code) => EDIT.type === type && EDIT.code === code;
const editRecord = (type, list) => (EDIT.type === type ? list.find((x) => x.code === EDIT.code) : null);
const cancelEdit = '<button type="button" class="button" data-edit-cancel>Cancel</button>';
const PEOPLE = [
  {name: 'A. Rehman', email: 'owner@northstar.pk', role: 'Business owner', scope: 'Every module', status: 'Active'},
  {name: 'S. Iqbal', email: 's.iqbal@northstar.pk', role: 'Accountant', scope: 'Accounting, reports', status: 'Active'},
  {name: 'N. Farooq', email: 'n.farooq@northstar.pk', role: 'Bookkeeper', scope: 'Accounting, no approval', status: 'Active'},
  {name: 'A. Khan', email: 'a.khan@northstar.pk', role: 'Cashier', scope: 'POS, cash', status: 'Active'},
  {name: 'S. Ali', email: 's.ali@northstar.pk', role: 'Storekeeper', scope: 'Inventory', status: 'Invited'},
];
const SAVED_VIEWS = [
  {name: 'November journals', scope: 'Journal entries', detail: 'Period 2026-11 · all states'},
  {name: 'Unposted drafts', scope: 'Journal entries', detail: 'State draft · newest first'},
  {name: 'Customer balances', scope: 'Parties', detail: 'Customers only · balance descending'},
];
const PRINT_TEMPLATES = [{name: 'A4 letterhead', size: 'A4', logo: true, qr: false, footer: 'Northstar Trading (Pvt) Ltd'}, {name: 'Thermal receipt', size: '80 mm', logo: false, qr: true, footer: 'Thank you'}];
let PAY_FORM = {direction: 'receive', party: '', account: '', amount: ''};
const PAYMENTS = [];
let PAY_SEQ = 1;
const INVOICES = [];
let INV_SEQ = 1;
let REPORT_TAB = 'ageing';

/** Generic "being built" page for any module in the page map. */
export function plannedPage(moduleId, pageId) {
  const entry = PAGE(moduleId, pageId);
  if (!entry) return '';
  const [id, label, spec, state] = entry;
  const module = catalog.modules.find((m) => m.id === moduleId);
  const kind = state === 'partial' ? 'Partly built' : 'Being built';
  return `<section class="panel">
    <div class="panel-head"><h2>${e(label)}</h2>${badge(kind)}</div>
    <div class="panel-body">
      <p>${e(spec)}</p>
      <p class="form-note">${e(module ? module.title : moduleId)} · ${e(label)} · ${e(state)}</p>
      <div class="callout"><strong>Not connected yet.</strong> This page is mapped in the module map. It does not read or write real records and it does not post.</div>
      <p class="form-note">Page map: docs/design/MODULE_MAP.md · backend contract: docs/design/BACKEND_CONTRACT.md · forms and views: docs/design/FORMS_AND_VIEWS.md.</p>
    </div>
  </section>`;
}

const CUSTOMERS = ['Atlas Studio','Linden Design','Harbor Workshop','Crescent Textiles','Meridian Pharma','Orion Logistics','Sapphire Retail','Indus Packaging','Kestrel Engineering','Marina Hospitality','Zenith Electrical','Falcon Chemicals','Pearl Distributors','Summit Hardware'];
const SUPPLIERS = ['Willow Supplies','Maple Packaging','Cedar Services','Pak Print House','Al-Noor Freight','Metro Office Supply','Secure Line','Digital Systems','Riverside Maintenance','Gulberg Properties'];

/* Deterministic spread of a control balance across parties. */
function spread(total, names, kind) {
  const weights = names.map((_, i) => 0.6 + ((i * 37) % 23) / 20);
  const sum = weights.reduce((a, b) => a + b, 0);
  const amounts = weights.map((w) => round2((total * w) / sum));
  const drift = round2(total - amounts.reduce((a, b) => a + b, 0));
  amounts[amounts.length - 1] = round2(amounts[amounts.length - 1] + drift);
  const ages = [12, 38, 5, 61, 96, 22, 47, -8, 15, 73, 31, 3, 54, 27];
  return names.map((name, i) => {
    const age = ages[i % ages.length];
    return {
      id: (kind === 'ar' ? 'C-' : 'S-') + String(101 + i),
      name,
      balance: amounts[i],
      overdue: age > 0 ? round2(amounts[i] * 0.72) : 0,
      age,
      docs: 1 + (i % 3),
    };
  }).sort((a, b) => b.balance - a.balance);
}

const bucketOf = (age) => (age <= 0 ? 'Current' : age <= 30 ? '1–30' : age <= 60 ? '31–60' : age <= 90 ? '61–90' : '90+');
const BUCKETS = ['Current', '1–30', '31–60', '61–90', '90+'];

export function createScreens({getCompany, range, navigate, notify, accounts}) {
  const rows = () => trial(fixture(getCompany()), range());
  const accountBalance = (code) => {
    const row = rows().find((r) => r.code === code);
    if (!row) return 0;
    return round2(num(row.closingDebit) - num(row.closingCredit));
  };
  const total = (code, sign = 1) => round2(sign * accountBalance(code));

  const AR = () => total('1100');
  const AP = () => total('2100', -1);
  const CASH = () => round2(total('1010') + total('1000') + total('1020'));
  const s = () => statements(fixture(getCompany()), range());

  /* --------------------------------------------------------------- dashboard */
  function cashSeries() {
    const docs = fixture(getCompany()).filter((d) => d.date >= '2026-11-01' && d.date <= '2026-11-30');
    const byDay = new Map();
    for (const d of docs) {
      const flow = d.lines.filter((l) => l.account === '1010' || l.account === '1000')
        .reduce((n, l) => n + num(l.debit) - num(l.credit), 0);
      byDay.set(d.date, (byDay.get(d.date) || 0) + flow);
    }
    const out = [];
    let run = 0;
    for (let i = 1; i <= 30; i++) {
      const key = '2026-11-' + String(i).padStart(2, '0');
      run = round2(run + (byDay.get(key) || 0));
      out.push({ date: key, value: run });
    }
    return out;
  }

  function chart() {
    const points = cashSeries();
    const w = 720, h = 176, padL = 74, padR = 16, padT = 14, padB = 26;
    const values = points.map((p) => p.value);
    const min = Math.min(...values), max = Math.max(...values);
    const x = (i) => padL + (i / (points.length - 1)) * (w - padL - padR);
    const y = (v) => h - padB - ((v - min) / ((max - min) || 1)) * (h - padT - padB);
    const short = (v) => Math.abs(v) >= 1e6 ? (v / 1e6).toFixed(2) + 'm' : Math.abs(v) >= 1000 ? Math.round(v / 1000) + 'k' : Math.round(v);
    const line = points.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.value).toFixed(1)}`).join(' ');
    const area = `${line} L${x(points.length - 1)},${h - padB} L${padL},${h - padB} Z`;
    const grid = [0, 0.5, 1].map((f) => {
      const value = max - f * (max - min);
      const gy = y(value).toFixed(1);
      return `<line x1="${padL}" y1="${gy}" x2="${w - padR}" y2="${gy}" stroke="var(--line)" stroke-width="1"></line>
        <text x="${padL - 10}" y="${Number(gy) + 3}" font-size="10" text-anchor="end" fill="var(--muted)">${money(value)}</text>`;
    }).join('');
    return `<svg viewBox="0 0 ${w} ${h}" width="100%" height="${h}" role="img" aria-label="Cash movement for November">
      ${grid}
      <path d="${area}" fill="var(--accent)" opacity="0.07"></path>
      <path d="${line}" fill="none" stroke="var(--accent)" stroke-width="1.8" stroke-linejoin="round" stroke-linecap="round"></path>
      <circle cx="${x(points.length - 1)}" cy="${y(points[points.length - 1].value)}" r="3.2" fill="var(--accent)"></circle>
      <text x="${padL}" y="${h - 8}" font-size="10" fill="var(--muted)">1 Nov</text>
      <text x="${w - padR}" y="${h - 8}" font-size="10" text-anchor="end" fill="var(--muted)">30 Nov</text>
      <text x="${w - padR}" y="${y(points[points.length - 1].value) - 8}" font-size="10" text-anchor="end" fill="var(--accent)">${short(points[points.length - 1].value)}</text>
    </svg>`;
  }

  function bucketsOf(value, names, kind) {
    const parts = spread(value, names, kind);
    const out = Object.fromEntries(BUCKETS.map((b) => [b, 0]));
    for (const p of parts) out[bucketOf(p.age)] = round2(out[bucketOf(p.age)] + p.balance);
    return { parts, out };
  }

  function dashboard() {
    const st = s();
    const ar = AR(), ap = AP();
    const arB = bucketsOf(ar, CUSTOMERS, 'ar');
    const apB = bucketsOf(ap, SUPPLIERS, 'ap');
    const recent = fixture(getCompany()).slice(-6).reverse();
    const overdueAr = round2(arB.parts.reduce((n, p) => n + p.overdue, 0));
    const overdueAp = round2(apB.parts.reduce((n, p) => n + p.overdue, 0));
    const over60 = round2(arB.out['61–90'] + arB.out['90+']);
    const balanced = Math.abs(cashSeries().at(-1).value - CASH()) < 0.01;

    const kpi = (label, value, basis) => `<section class="stat"><span class="stat-label">${e(label)}</span><strong class="value numeric">${value}</strong><small>${e(basis)}</small></section>`;

    return `<div class="stats dash-stats">
        ${kpi('Cash & bank', money(CASH()), 'PKR · 3 accounts · posted only')}
        ${kpi('Receivables', money(ar), `${CUSTOMERS.length} customers · ${money(overdueAr)} overdue`)}
        ${kpi('Payables', money(ap), `${SUPPLIERS.length} suppliers · ${money(overdueAp)} overdue`)}
        ${kpi('Result for the period', money(num(st.profit)), `${e(range().from)} to ${e(range().to)}`)}
      </div>

      <div class="dash-grid">
        <section class="panel dash-span2">
          <div class="panel-head"><h2>Cash movement</h2><span class="badge">${e(range().from)} to ${e(range().to)}</span></div>
          <div class="panel-body dash-chart">${chart()}</div>
        </section>
        <section class="panel">
          <div class="panel-head"><h2>Ageing</h2><button class="text-button" data-module="accounting" data-tab="reports">Open reports ↗</button></div>
          <div class="panel-body compact-table">
            <table>
              <thead><tr><th>Bucket</th><th class="numeric">Receivable</th><th class="numeric">Payable</th></tr></thead>
              <tbody>${BUCKETS.map((b) => `<tr><td>${b}</td><td class="numeric">${arB.out[b] ? money(arB.out[b]) : '—'}</td><td class="numeric">${apB.out[b] ? money(apB.out[b]) : '—'}</td></tr>`).join('')}</tbody>
              <tfoot><tr><td>Total</td><td class="numeric">${money(ar)}</td><td class="numeric">${money(ap)}</td></tr></tfoot>
            </table>
          </div>
        </section>
      </div>

      <div class="dash-grid">
        <section class="panel dash-span2">
          <div class="panel-head"><h2>Recent journals</h2><button class="text-button" data-module="accounting" data-tab="journals">Open register ↗</button></div>
          <div class="table-scroll">
            <table>
              <thead><tr><th>Date</th><th>Voucher</th><th>Party</th><th>Narrative</th><th class="numeric">Amount PKR</th></tr></thead>
              <tbody>${recent.map((j) => `<tr>
                <td>${e(j.date)}</td>
                <td><button class="text-button" data-ac="source" data-value="${e(j.id)}">${e(j.id)}</button></td>
                <td>${e(j.party)}</td>
                <td>${e(j.narrative)}</td>
                <td class="numeric">${money(j.lines.reduce((n, l) => n + num(l.debit), 0))}</td>
              </tr>`).join('')}</tbody>
            </table>
          </div>
        </section>
        <section class="panel">
          <div class="panel-head"><h2>What needs attention</h2><span class="badge ${[overdueAr, over60, overdueAp, balanced ? 0 : 1].filter(Boolean).length ? 'warn' : 'good'}">${[overdueAr, over60, overdueAp, balanced ? 0 : 1].filter(Boolean).length || 'Clear'}${[overdueAr, over60, overdueAp, balanced ? 0 : 1].filter(Boolean).length ? ' items' : ''}</span></div>
          <div class="panel-body">
            <div class="quiet-row"><div><strong>${money(overdueAr)} receivable overdue</strong><small>${arB.parts.filter((p) => p.overdue > 0).length} customers past due</small></div><button class="text-button" data-module="accounting" data-tab="reports">Open</button></div>
            <div class="quiet-row"><div><strong>${money(over60)} over 60 days</strong><small>Escalate or provide for</small></div><button class="text-button" data-module="accounting" data-tab="reports">Open</button></div>
            <div class="quiet-row"><div><strong>${money(overdueAp)} payable overdue</strong><small>${apB.parts.filter((p) => p.overdue > 0).length} suppliers past due</small></div><button class="text-button" data-module="accounting" data-tab="reports">Open</button></div>
            <div class="quiet-row"><div><strong>Trial balance ${balanced ? 'agrees' : 'does not agree'}</strong><small>Closing debits against credits</small></div><button class="text-button" data-module="accounting" data-tab="trial">Open</button></div>
          </div>
        </section>
      </div>

      <div class="dash-grid">
        <section class="panel">
          <div class="panel-head"><h2>Largest customers</h2><button class="text-button" data-module="accounting" data-tab="parties">All parties ↗</button></div>
          <div class="panel-body compact-table">
            <table><thead><tr><th>Customer</th><th class="numeric">Balance</th><th>Oldest</th></tr></thead>
            <tbody>${arB.parts.slice(0, 5).map((p) => `<tr><td>${e(p.name)}</td><td class="numeric">${money(p.balance)}</td><td>${p.age > 0 ? `<span class="badge ${p.age > 60 ? 'warn' : ''}">${p.age}d</span>` : '<span class="badge good">Current</span>'}</td></tr>`).join('')}</tbody></table>
          </div>
        </section>
        <section class="panel">
          <div class="panel-head"><h2>Largest suppliers</h2><button class="text-button" data-module="accounting" data-tab="parties">All parties ↗</button></div>
          <div class="panel-body compact-table">
            <table><thead><tr><th>Supplier</th><th class="numeric">Balance</th><th>Oldest</th></tr></thead>
            <tbody>${apB.parts.slice(0, 5).map((p) => `<tr><td>${e(p.name)}</td><td class="numeric">${money(p.balance)}</td><td>${p.age > 0 ? `<span class="badge ${p.age > 60 ? 'warn' : ''}">${p.age}d</span>` : '<span class="badge good">Current</span>'}</td></tr>`).join('')}</tbody></table>
          </div>
        </section>
        <section class="panel">
          <div class="panel-head"><h2>Close readiness</h2><span class="badge">${balanced ? '1 of 3' : '0 of 3'}</span></div>
          <div class="panel-body">
            <div class="quiet-row"><div><strong>Trial balance proof</strong><small>Closing debits equal credits</small></div><span class="badge ${balanced ? 'good' : 'warn'}">${balanced ? 'Done' : 'Open'}</span></div>
            <div class="quiet-row"><div><strong>Receivables review</strong><small>${money(over60)} past 60 days</small></div><span class="badge ${over60 ? 'warn' : 'good'}">${over60 ? 'Review' : 'Clear'}</span></div>
            <div class="quiet-row"><div><strong>Statements</strong><small>Profit or loss and position</small></div><span class="badge">Ready</span></div>
          </div>
        </section>
      </div>

      <div class="dash-actions">
        <button class="button primary" data-module="accounting" data-tab="journals" data-mode="editor">New journal</button>
        <button class="button" data-module="accounting" data-tab="payments">Record a payment</button>
        <button class="button" data-module="accounting" data-tab="sales-invoices">Raise an invoice</button>
        <button class="button" data-module="accounting" data-tab="ledger">Open the ledger</button>
        <button class="button" data-module="accounting" data-tab="reports">Reports</button>
      </div>`;
  }

  function ageingLines(value, kind) {
    const parts = spread(value, kind === 'ar' ? CUSTOMERS : SUPPLIERS, kind);
    const buckets = Object.fromEntries(BUCKETS.map((b) => [b, 0]));
    for (const p of parts) buckets[bucketOf(p.age)] = round2(buckets[bucketOf(p.age)] + p.balance);
    return BUCKETS.map((b) => `<div class="statement-line"><span>${b}</span><strong class="numeric">${money(buckets[b])}</strong></div>`).join('')
      + `<div class="statement-line total"><span>Total</span><strong class="numeric">${money(value)}</strong></div>`;
  }

  /* -------------------------------------------------------------- receivables */
  function partyScreen(kind) {
    const isAr = kind === 'ar';
    const value = isAr ? AR() : AP();
    const parts = spread(value, isAr ? CUSTOMERS : SUPPLIERS, kind);
    const overdue = round2(parts.reduce((n, p) => n + p.overdue, 0));
    const over60 = round2(parts.filter((p) => p.age > 60).reduce((n, p) => n + p.balance, 0));
    return `<div class="stats">
      <section class="stat"><span class="stat-label">${isAr ? 'Total receivable' : 'Total payable'}</span><strong class="value numeric">${money(value)}</strong><small>${parts.length} sample ${isAr ? 'customers' : 'suppliers'}</small></section>
      <section class="stat"><span class="stat-label">Overdue</span><strong class="value numeric">${money(overdue)}</strong><small>${parts.filter((p) => p.overdue > 0).length} parties with overdue items</small></section>
      <section class="stat"><span class="stat-label">Over 60 days</span><strong class="value numeric">${money(over60)}</strong><small>Escalate or provide for</small></section>
      <section class="stat"><span class="stat-label">Oldest item</span><strong class="value">${Math.max(...parts.map((p) => p.age))} days</strong><small>Ageing basis: due date</small></section>
    </div>
    <section class="panel">
      <div class="panel-head"><h2>${isAr ? 'Customer balances' : 'Supplier balances'}</h2>${badge('Open documents only')}</div>
      <div class="table-scroll" data-hscroll><table>
        <thead><tr><th>${isAr ? 'Customer' : 'Supplier'}</th><th>Documents</th><th class="numeric">Current</th><th class="numeric">Overdue</th><th>Oldest</th><th class="numeric">Balance PKR</th></tr></thead>
        <tbody>${parts.map((p) => `<tr>
          <td>${e(p.name)}<small class="secondary">${e(p.id)}</small></td>
          <td>${p.docs}</td>
          <td class="numeric">${money(round2(p.balance - p.overdue))}</td>
          <td class="numeric">${p.overdue ? money(p.overdue) : '—'}</td>
          <td>${p.age > 60 ? badge(p.age + ' days', 'warn') : p.age > 0 ? badge(p.age + ' days') : badge('Current', 'good')}</td>
          <td class="numeric">${money(p.balance)}</td>
        </tr>`).join('')}</tbody>
        <tfoot><tr><td colspan="5"><strong>Total</strong></td><td class="numeric"><strong>${money(value)}</strong></td></tr></tfoot>
      </table></div>
      <div class="table-footer">Party spread is illustrative; the total reconciles to the control account in the trial balance. Nothing here posts or allocates.</div>
    </section>`;
  }

  /* ------------------------------------------------------------------- ageing */
  function ageing() {
    const ar = spread(AR(), CUSTOMERS, 'ar');
    const ap = spread(AP(), SUPPLIERS, 'ap');
    const matrix = (parts, label) => {
      const totals = Object.fromEntries(BUCKETS.map((b) => [b, 0]));
      for (const p of parts) totals[bucketOf(p.age)] = round2(totals[bucketOf(p.age)] + p.balance);
      const grand = round2(parts.reduce((n, p) => n + p.balance, 0));
      return `<section class="panel">
        <div class="panel-head"><h2>${label}</h2>${badge('Age measured from due date')}</div>
        <div class="table-scroll" data-hscroll><table>
          <thead><tr><th>Party</th>${BUCKETS.map((b) => `<th class="numeric">${b}</th>`).join('')}<th class="numeric">Total</th></tr></thead>
          <tbody>${parts.map((p) => `<tr><td>${e(p.name)}</td>${BUCKETS.map((b) => `<td class="numeric">${bucketOf(p.age) === b ? money(p.balance) : '—'}</td>`).join('')}<td class="numeric">${money(p.balance)}</td></tr>`).join('')}</tbody>
          <tfoot><tr><td><strong>Total</strong></td>${BUCKETS.map((b) => `<td class="numeric"><strong>${money(totals[b])}</strong></td>`).join('')}<td class="numeric"><strong>${money(grand)}</strong></td></tr></tfoot>
        </table></div>
      </section>`;
    };
    return matrix(ar, 'Receivables ageing') + matrix(ap, 'Payables ageing')
      + `<section class="panel">
        <div class="panel-head"><h2>Depreciation schedule</h2>${badge('November charge drafted')}</div>
        <div class="table-scroll" data-hscroll><table>
          <thead><tr><th>Asset</th><th class="numeric">Cost</th><th class="numeric">Rate</th><th class="numeric">Monthly</th><th class="numeric">Accumulated</th><th class="numeric">Net book value</th></tr></thead>
          <tbody>${[
            ['Furniture & fixtures', 486000, '15.0%', 6075, 128400],
            ['Motor vehicles', 1240000, '20.0%', 20666.67, 396800],
            ['Computer equipment', 268400, '25.0%', 5591.67, 104600],
          ].map(([name, cost, rate, monthly, acc]) => `<tr><td>${e(name)}</td><td class="numeric">${money(cost)}</td><td class="numeric">${rate}</td><td class="numeric">${money(monthly)}</td><td class="numeric">${money(acc)}</td><td class="numeric">${money(cost - acc)}</td></tr>`).join('')}</tbody>
          <tfoot><tr><td><strong>Total</strong></td><td class="numeric"><strong>${money(1994400)}</strong></td><td></td><td class="numeric"><strong>${money(32333.34)}</strong></td><td class="numeric"><strong>${money(629800)}</strong></td><td class="numeric"><strong>${money(1364600)}</strong></td></tr></tfoot>
        </table></div>
        <div class="table-footer">Schedule is illustrative. Posting depreciation requires the asset register, effective dates and approval.</div>
      </section>`;
  }

  /* ---------------------------------------------------------------- approvals */
  function approvals() {
    const queue = fixture(getCompany()).slice(0, 5);
    return `<div class="two-column">
      <section class="panel">
        <div class="panel-head"><h2>Waiting for review</h2>${badge(String(queue.length) + ' items', 'warn')}</div>
        <div class="panel-body">${queue.map((j, i) => `<div class="activity-item"><span class="activity-dot"></span><div class="grow"><button class="text-button" data-ac="source" data-value="${e(j.id)}">${e(j.id)} · ${e(j.narrative)}</button><small>${e(j.party)} · ${money(j.lines.reduce((n, l) => n + num(l.debit), 0))} · ${i === 0 ? 'today' : (i + 1) + ' days ago'}</small></div>${badge(i % 2 ? 'Returned' : 'Awaiting review', i % 2 ? 'warn' : '')}</div>`).join('')}</div>
      </section>
      <section class="panel">
        <div class="panel-head"><h2>Review policy</h2>${badge('Illustrative')}</div>
        <div class="panel-body">
          <div class="statement-line"><span>Direct posting</span><strong>Allowed when authorised</strong></div>
          <div class="statement-line"><span>Independent review</span><strong>Above 100,000.00</strong></div>
          <div class="statement-line"><span>Self approval</span><strong>Not permitted</strong></div>
          <div class="statement-line total"><span>Evidence</span><strong>Required for manual journals</strong></div>
          <p class="form-note">Approval writes an immutable decision with the reviewer, note and version. Nothing on this page posts.</p>
          <div class="related">${button('Review a sample entry','', 'data-module="accounting" data-tab="register"')}</div>
        </div>
      </section>
    </div>`;
  }

  /* ---------------------------------------------------------- general ledger */
  const GL = {
    from: '2026-11-01', to: '2026-11-30',
    accounts: [], parties: [], projects: [], locations: [], centres: [], types: [],
    q: '', open: '', sort: {key: 'date', dir: 'asc'},
    extras: new Set(['subtype', 'against', 'partyType', 'project', 'location', 'centre', 'againstVoucher', 'supplierRef']),
  };

  const subtypeOf = (d) => d.subtype || d.source;
  const againstType = (id) => !id ? '' : id.includes('SI') ? 'Sales Invoice' : id.includes('PI') ? 'Purchase Invoice' : '';
  const againstAccount = (d, l) => {
    const wantDebit = num(l.credit) > 0;
    const other = d.lines.find((x) => x !== l && (wantDebit ? num(x.debit) > 0 : num(x.credit) > 0));
    return other ? other.account : '';
  };
  const OPTIONAL = ['subtype', 'against', 'partyType', 'project', 'location', 'centre', 'againstVoucher', 'supplierRef'];
  const inSet = (list, value) => !list.length || list.includes(value);

  function ledgerRows() {
    const docs = fixture(getCompany()).filter((d) => d.date >= GL.from && d.date <= GL.to && !CANCELLED.has(d.id) && !DELETED.has(d.id));
    const out = [];
    for (const d of docs) {
      if (!inSet(GL.types, d.source)) continue;
      if (!inSet(GL.projects, d.project || '')) continue;
      if (!inSet(GL.locations, d.location || '')) continue;
      for (const l of d.lines) {
        if (!inSet(GL.parties, l.party || d.party)) continue;
        if (GL.accounts.length && !GL.accounts.includes(l.account)) continue;
        if (GL.centres.length && !GL.centres.includes(l.costCentre)) continue;
        const acc = accounts().find((a) => a.code === l.account);
        const hay = `${d.id} ${d.narrative} ${d.party} ${l.account} ${acc ? acc.name : ''} ${l.project} ${l.location} ${l.costCentre}`.toLowerCase();
        if (GL.q && !hay.includes(GL.q.toLowerCase())) continue;
        out.push({
          id: d.id, date: d.date, party: l.party || d.party,
          partyType: (l.party ? (acc && acc.control === 'bank' ? 'Bank' : acc && acc.control === 'cash' ? 'Cash' : acc && acc.control === 'receivable' ? 'Customer' : acc && acc.control === 'payable' ? 'Supplier' : '') : '') || d.partyType || (acc && acc.control === 'receivable' ? 'Customer' : acc && acc.control === 'payable' ? 'Supplier' : ''),
          source: d.source, subtype: subtypeOf(d), narrative: d.narrative, doc: d, line: l,
          account: l.account, accountName: acc ? acc.name : l.account,
          against: againstAccount(d, l), againstVoucher: l.againstVoucher || d.againstVoucher || '',
          supplierRef: d.supplierRef || '', project: l.project || d.project || '', location: l.location || d.location || '',
          centre: l.costCentre || '', debit: num(l.debit), credit: num(l.credit), balance: 0,
        });
      }
    }
    return out;
  }

  function sortRows(rows, sort) {
    const dir = sort.dir === 'desc' ? -1 : 1;
    return rows.slice().sort((a, b) => {
      const x = a[sort.key], y = b[sort.key];
      if (typeof x === 'number' && typeof y === 'number') return (x - y) * dir;
      return String(x ?? '').localeCompare(String(y ?? '')) * dir;
    });
  }

  function openingBalance(codes) {
    if (!codes.length) return 0;
    return round2(fixture(getCompany()).filter((d) => d.date < GL.from && !CANCELLED.has(d.id) && !DELETED.has(d.id))
      .reduce((n, d) => n + d.lines.filter((l) => codes.includes(l.account))
        .reduce((m, l) => m + num(l.debit) - num(l.credit), 0), 0));
  }

  /* One multi-select control, used by every filter and by the column chooser. */
  function ms(name, label, options, selected, attr) {
    const chosen = options.filter(([v]) => selected.includes(v));
    let text;
    if (attr) text = chosen.length === options.length ? 'All columns' : `${chosen.length} of ${options.length}`;
    else if (chosen.length === 0) text = `All ${label.toLowerCase()}`;
    else if (chosen.length === 1) text = chosen[0][1];
    else if (chosen.length === 2) text = `${chosen[0][1]}, ${chosen[1][1]}`;
    else text = `${chosen[0][1]} +${chosen.length - 1} more`;
    return `<div class="ms" data-ms="${name}"${attr ? ' data-ms-columns="1"' : ''} data-placeholder="All ${e(label.toLowerCase())}">
      <span class="ms-label">${e(label)}</span>
      <button type="button" class="ms-trigger" aria-expanded="false" aria-haspopup="listbox">
        <span class="ms-text" title="${e(text)}">${e(text)}</span><span class="ms-caret" aria-hidden="true">▾</span>
      </button>
      <div class="ms-panel" hidden>
        <div class="ms-searchrow">
          <input class="ms-search" type="search" placeholder="Search ${e(label.toLowerCase())}" aria-label="Search ${e(label)}" autocomplete="off">
        </div>
        <div class="ms-head">
          <button type="button" class="text-button" data-ms-all>Select all</button>
          <span class="ms-count">${options.length}</span>
          <button type="button" class="text-button" data-ms-none>Clear</button>
        </div>
        <div class="ms-list">${options.map(([value, label2]) => `<label class="ms-row"><input class="check" type="checkbox" ${attr ? `data-${attr}="${e(value)}"` : `name="${name}"`} value="${e(value)}" ${selected.includes(value) ? 'checked' : ''}><span>${e(label2)}</span></label>`).join('')}</div>
        <div class="ms-empty" hidden>No match</div>
      </div>
    </div>`;
  }

  function restoreMS() {
    if (!openMS) return;
    const box = document.querySelector(`.ms[data-ms="${openMS}"]`);
    if (!box) { openMS = ''; return; }
    box.querySelector('.ms-panel').hidden = false;
    box.querySelector('.ms-trigger').setAttribute('aria-expanded', 'true');
  }

  function applyColumnVisibility(kind) {
    const boxes = [...document.querySelectorAll(`[data-${kind}-col]`)];
    const hidden = boxes.filter((b) => !b.checked).map((b) => b.dataset[`${kind}Col`]);
    const table = document.querySelector(kind === 'gl' ? '.gl-table' : '.jr-table');
    if (table) table.dataset.hide = hidden.join(' ');
    const count = document.getElementById(kind + '-col-count');
    if (count && table) count.textContent = String(table.querySelectorAll('thead th.col').length - hidden.length);
  }

  let msBound = false;
  let openMS = '';
  function filterRows(box) {
    const q = (box.querySelector('.ms-search')?.value || '').trim().toLowerCase();
    const rows = [...box.querySelectorAll('.ms-row')];
    let visible = 0;
    rows.forEach((row) => {
      const hit = !q || row.textContent.toLowerCase().includes(q);
      row.hidden = !hit;
      if (hit) visible++;
    });
    const empty = box.querySelector('.ms-empty');
    if (empty) empty.hidden = visible > 0;
    const count = box.querySelector('.ms-count');
    if (count) count.textContent = q ? `${visible} of ${rows.length}` : String(rows.length);
  }

  function bindMS() {
    if (msBound) return;
    msBound = true;
    const closeAll = (except) => {
      document.querySelectorAll('.ms').forEach((box) => {
        if (box === except) return;
        box.querySelector('.ms-panel').hidden = true;
        box.querySelector('.ms-trigger').setAttribute('aria-expanded', 'false');
      });
      if (!except) openMS = '';
    };
    document.addEventListener('click', (ev) => {
      const trigger = ev.target.closest('.ms-trigger');
      if (trigger) {
        const box = trigger.closest('.ms');
        const panel = box.querySelector('.ms-panel');
        const open = panel.hidden;
        closeAll(box);
        panel.hidden = !open;
        trigger.setAttribute('aria-expanded', String(open));
        openMS = open ? box.dataset.ms : '';
        if (open) {
          const r = trigger.getBoundingClientRect();
          panel.classList.add('ms-panel--fixed');
          panel.style.top = Math.round(r.bottom + 6) + 'px';
          panel.style.left = Math.round(r.left) + 'px';
          panel.style.minWidth = Math.round(Math.max(r.width, 240)) + 'px';
          const search = panel.querySelector('.ms-search');
          if (search) { search.value = ''; filterRows(box); search.focus(); }
          box.dispatchEvent(new CustomEvent('ms:open', {bubbles: true}));
        }
        if (open) {
          panel.classList.remove('ms-panel--right');
          const rect = panel.getBoundingClientRect();
          if (rect.right > window.innerWidth - 12) panel.classList.add('ms-panel--right');
        }
        return;
      }
      const all = ev.target.closest('[data-ms-all]');
      const none = ev.target.closest('[data-ms-none]');
      if (all || none) {
        const box = (all || none).closest('.ms');
        box.querySelectorAll('input[type=checkbox]').forEach((b) => {
          if (all && b.closest('.ms-row').hidden) return;   // Select all respects the search
          b.checked = Boolean(all);
          b.dispatchEvent(new Event('change', {bubbles: true}));
        });
        return;
      }
      if (!ev.target.closest('.ms-panel')) closeAll();
    });
    document.addEventListener('keydown', (ev) => { if (ev.key === 'Escape') closeAll(); });
    document.addEventListener('input', (ev) => {
      if (!ev.target.classList.contains('ms-search')) return;
      filterRows(ev.target.closest('.ms'));
    });
    document.addEventListener('change', (ev) => {
      if (ev.target.type !== 'checkbox') return;   // single-selects set their own label
      const box = ev.target.closest('.ms');
      if (!box) return;
      const boxes = [...box.querySelectorAll('input[type=checkbox]')];
      const chosen = boxes.filter((b) => b.checked);
      const labelOf = (b) => (b.parentElement.querySelector('span')?.textContent || '').trim();
      let text;
      if (box.dataset.msColumns) text = chosen.length === boxes.length ? 'All columns' : `${chosen.length} of ${boxes.length}`;
      else if (chosen.length === 0) text = box.dataset.placeholder || 'All';
      else if (chosen.length === 1) text = labelOf(chosen[0]);
      else if (chosen.length === 2) text = `${labelOf(chosen[0])}, ${labelOf(chosen[1])}`;
      else text = `${labelOf(chosen[0])} +${chosen.length - 1} more`;
      const el = box.querySelector('.ms-text');
      if (el) { el.textContent = text; el.title = text; }
    });
  }

  function glColumns() {
    const single = GL.accounts.length === 1;
    const cols = [
      ['date', 'Posting date', (r) => e(r.date)],
      ['account', 'Account', (r) => `<span class="mono">${e(r.account)}</span> ${e(r.accountName)}`],
      ['description', 'Description', (r) => e(r.narrative), 'gl-desc'],
      ['debit', 'Debit', (r) => r.debit ? money(r.debit) : '', 'numeric'],
      ['credit', 'Credit', (r) => r.credit ? money(r.credit) : '', 'numeric'],
    ];
    if (single) cols.push(['balance', 'Balance', (r) => money(r.balance), 'numeric']);
    cols.push(['type', 'Voucher type', (r) => e(r.source)]);
    cols.push(['subtype', 'Voucher subtype', (r) => e(r.subtype)]);
    cols.push(['voucher', 'Voucher no', (r) => `<button class="text-button" data-ac="source" data-value="${e(r.id)}">${e(r.id)}</button>`]);
    cols.push(['against', 'Against account', (r) => e(r.against)]);
    cols.push(['partyType', 'Party type', (r) => e(r.partyType)]);
    cols.push(['party', 'Party / sub-account', (r) => e(r.party)]);
    cols.push(['project', 'Project', (r) => e(r.project)]);
    cols.push(['location', 'Location', (r) => e(r.location)]);
    cols.push(['centre', 'Cost centre', (r) => e(r.centre)]);
    cols.push(['againstVoucher', 'Against voucher', (r) => e(r.againstVoucher ? againstType(r.againstVoucher) + ' ' + r.againstVoucher : '')]);
    cols.push(['supplierRef', 'Supplier invoice no', (r) => e(r.supplierRef)]);
    return cols;
  }

  function gl() {
    let rows = ledgerRows();
    rows = sortRows(rows, GL.sort);
    const opening = openingBalance(GL.accounts);
    const single = GL.accounts.length === 1;
    let run = opening;
    for (const r of rows) { if (single) { run = round2(run + r.debit - r.credit); r.balance = run; } }
    const debit = round2(rows.reduce((n, r) => n + r.debit, 0));
    const credit = round2(rows.reduce((n, r) => n + r.credit, 0));
    const net = round2(debit - credit);
    const netLabel = net === 0 ? 'Net' : net > 0 ? 'Net debit' : 'Net credit';
    const cols = glColumns();
    const sortable = new Set(['date', 'account', 'description', 'debit', 'credit', 'type', 'subtype', 'voucher', 'party', 'project', 'location', 'centre']);
    const wholePeriod = (() => {
      let lines = 0, dr = 0, cr = 0;
      for (const d of fixture(getCompany())) {
        if (d.date < GL.from || d.date > GL.to || CANCELLED.has(d.id) || DELETED.has(d.id)) continue;
        for (const l of d.lines) { lines++; dr += num(l.debit); cr += num(l.credit); }
      }
      return {lines, debit: round2(dr), credit: round2(cr)};
    })();
    const filtered = Boolean(GL.accounts.length || GL.parties.length || GL.projects.length || GL.locations.length || GL.centres.length || GL.types.length || GL.q);

    const body = rows.map((r) => {
      const open = GL.open === r.id + ':' + r.account;
      const dest = r.source === 'Sales invoice' ? `sales-invoices:${r.id}` : r.source === 'Supplier bill' ? `purchase-invoices:${r.id}` : r.source === 'Payment' ? `payments:${r.id}` : `journals:${r.id}`;
      return `<tr class="row-link" data-gl-row="${e(r.id)}:${e(r.account)}" data-gl-go="${e(dest)}" class="${open ? 'gl-open' : ''}">
          ${cols.map(([key, , cell, cls]) => `<td class="col col-${key} ${cls || ''}">${cell(r)}</td>`).join('')}
        </tr>` + (open ? detailRow(r, cols.length) : '');
    }).join('');

    const accountOpts = accounts().filter((a) => a.active).map((a) => [a.code, `${a.code} ${a.name}`]);
    const partyOpts = [...new Set(fixture(getCompany()).flatMap((d) => [d.party, ...d.lines.map((l) => l.party)]).filter(Boolean))].sort().map((p2) => [p2, p2]);
    const projectOpts = [['', 'No project'], ...PROJECTS.map((p2) => [p2.code, `${p2.code} · ${p2.name}`])];
    const locOpts = LOCATIONS.map((l) => [l.code, `${l.code} · ${l.name}`]);
    const centreOpts = COST_CENTRES.map((c) => [c.name, c.name]);
    const typeOpts = [...new Set(fixture(getCompany()).map((d) => d.source))].sort().map((t) => [t, t]);
    const extras = [['subtype', 'Voucher subtype'], ['against', 'Against account'], ['partyType', 'Party type'], ['project', 'Project'], ['location', 'Location'], ['centre', 'Cost centre'], ['againstVoucher', 'Against voucher'], ['supplierRef', 'Supplier invoice no']];

    return `<form id="gl-filter" class="filterbar gl-filter">
        <label>From<input name="from" type="date" value="${e(GL.from)}" required></label>
        <label>To<input name="to" type="date" value="${e(GL.to)}" required></label>
        ${ms('account', 'Accounts', accountOpts, GL.accounts)}
        ${ms('party', 'Party / sub-account', partyOpts, GL.parties)}
        ${ms('project', 'Projects', projectOpts, GL.projects)}
        ${ms('location', 'Locations', locOpts, GL.locations)}
        ${ms('centre', 'Cost centres', centreOpts, GL.centres)}
        ${ms('type', 'Voucher types', typeOpts, GL.types)}
        <label>Search<input name="q" type="search" value="${e(GL.q)}" placeholder="Voucher, party or description"></label>
        <button class="button" type="button" data-gl-reset>Reset</button><button class="button primary">Apply</button>
      </form>

      <div class="gl-toolrow">
        ${ms('columns', 'Columns', extras, [...GL.extras], 'gl-col')}
        <span class="form-note"><span id="gl-col-count">${cols.length}</span> of ${cols.length} columns visible. Posting date, account, description, amounts, voucher and party are always shown.</span>
      </div>

      <section class="panel">
        <div class="panel-head"><h2>${GL.accounts.length === 1 ? e((accounts().find((a) => a.code === GL.accounts[0]) || {}).name || GL.accounts[0]) : GL.accounts.length ? GL.accounts.length + ' accounts' : 'All accounts'}</h2><div class="related"><span class="badge">${rows.length} lines</span><button class="button" data-gl-export="csv">Export CSV</button><button class="button" data-gl-print>Print</button></div></div>
        <div class="gl-totals">
          <div><span>Lines</span><strong class="numeric">${rows.length}</strong><small>${filtered ? `of ${wholePeriod.lines} in the period` : 'in this period'}</small></div>
          <div><span>Total debit</span><strong class="numeric">${money(debit)}</strong><small>${filtered ? 'filtered' : 'whole period'}</small></div>
          <div><span>Total credit</span><strong class="numeric">${money(credit)}</strong><small>${filtered ? 'filtered' : 'whole period'}</small></div>
          <div><span>${netLabel}</span><strong class="numeric">${money(Math.abs(net))}</strong><small>${net === 0 ? 'in balance' : filtered ? 'balance of the filtered lines' : 'balance of the period'}</small></div>
        </div>
        <div class="table-scroll gl-scroll" data-hscroll>
          <table class="gl-table" data-hide="${[...OPTIONAL.filter((k) => !GL.extras.has(k))].join(' ')}">
            <thead><tr>${cols.map(([key, label, , cls]) => sortable.has(key)
              ? `<th class="col col-${key} ${cls || ''}"><button class="sortable" data-gl-sort="${key}" aria-sort="${GL.sort.key === key ? (GL.sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}">${label}<span class="sort-mark">${GL.sort.key === key ? (GL.sort.dir === 'asc' ? '▲' : '▼') : ''}</span></button></th>`
              : `<th class="col col-${key} ${cls || ''}">${label}</th>`).join('')}</tr></thead>
            <tbody id="gl-rows">${body || `<tr><td colspan="${cols.length}"><div class="empty"><div class="empty-mark">?</div><h2>No ledger lines</h2><p>No posted line matches these filters.</p></div></td></tr>`}</tbody>
            <tfoot><tr>
              <td colspan="${cols.findIndex(([k]) => k === 'debit')}">Total</td>
              <td class="numeric">${money(debit)}</td>
              <td class="numeric">${money(credit)}</td>
              <td colspan="${Math.max(0, cols.length - cols.findIndex(([k]) => k === 'debit') - 2)}"></td>
            </tr></tfoot>
          </table>
        </div>
        <div class="table-footer">${rows.length} lines from ${e(GL.from)} to ${e(GL.to)}. Click any row for the complete transaction.</div>
      </section>`;
  }

  function detailRow(r, span) {
    const d = r.doc;
    return `<tr class="gl-detail"><td colspan="${span}">
      <div class="gl-detail-grid">
        <div>
          <div class="eyebrow">Source document</div>
          <div class="record-summary">
            <div><small>Voucher</small>${e(d.id)}</div>
            <div><small>Date</small>${e(d.date)}</div>
            <div><small>Type</small>${e(r.subtype)}</div>
            <div><small>Party</small>${e(d.party)}</div>
            <div><small>Project</small>${e(r.project || 'None')}</div>
            <div><small>Location</small>${e(r.location || '—')}</div>
          </div>
          <p class="form-note">${e(d.narrative)}</p>
          ${r.againstVoucher ? `<p class="form-note">Settles ${e(r.againstVoucher)} · ${e(againstType(r.againstVoucher))}</p>` : ''}
          ${r.supplierRef ? `<p class="form-note">Supplier invoice ${e(r.supplierRef)}</p>` : ''}
        </div>
        <div>
          <div class="eyebrow">All lines in this document</div>
          <table class="compact-table"><thead><tr><th>Account</th><th>Project</th><th>Location</th><th class="numeric">Debit</th><th class="numeric">Credit</th></tr></thead>
          <tbody>${d.lines.map((l) => `<tr><td>${e(l.account)} ${e((accounts().find((a) => a.code === l.account) || {}).name || '')}</td><td>${e(l.project || '—')}</td><td>${e(l.location || '—')}</td><td class="numeric">${num(l.debit) ? money(num(l.debit)) : ''}</td><td class="numeric">${num(l.credit) ? money(num(l.credit)) : ''}</td></tr>`).join('')}</tbody>
          <tfoot><tr><td colspan="3">Total</td><td class="numeric">${money(d.lines.reduce((n, l) => n + num(l.debit), 0))}</td><td class="numeric">${money(d.lines.reduce((n, l) => n + num(l.credit), 0))}</td></tr></tfoot></table>
        </div>
      </div>
    </td></tr>`;
  }

  function readMulti(form) {
    const pick = (n) => [...form.querySelectorAll(`input[name="${n}"]:checked`)].map((x) => x.value);
    GL.accounts = pick('account'); GL.parties = pick('party'); GL.projects = pick('project');
    GL.locations = pick('location'); GL.centres = pick('centre'); GL.types = pick('type');
  }

  function syncGL(form) {
    GL.from = form.from.value; GL.to = form.to.value; GL.q = form.q.value;
    readMulti(form);
    GL.open = '';
  }

  function bindGL(rerender, navigate) {
    bindMS();
    const filter = document.querySelector('#gl-filter');
    filter?.addEventListener('submit', (ev) => { ev.preventDefault(); syncGL(ev.target); rerender(); });
    document.querySelectorAll('[data-gl-col]').forEach((box) => box.addEventListener('change', () => {
      box.checked ? GL.extras.add(box.dataset.glCol) : GL.extras.delete(box.dataset.glCol);
      applyColumnVisibility('gl');
    }));
    document.querySelectorAll('[data-gl-sort]').forEach((btn) => btn.addEventListener('click', () => {
      const k = btn.dataset.glSort;
      GL.sort = {key: k, dir: GL.sort.key === k && GL.sort.dir === 'asc' ? 'desc' : 'asc'};
      rerender();
    }));
    document.querySelector('#gl-rows')?.addEventListener('click', (ev) => {
      if (ev.target.closest('[data-ac]')) return;
      const tr = ev.target.closest('[data-gl-go]');
      if (!tr) return;
      const [tab, id] = tr.dataset.glGo.split(':');
      if (tab === 'journals') { navigate({module: 'accounting', tab, mode: 'editor', code: id}); return; }
      const key = tab === 'payments' ? 'payments' : 'invoices';
      FILTERS[key].q = id;
      navigate({module: 'accounting', tab});
    });
    restoreMS();
    document.querySelector('[data-gl-reset]')?.addEventListener('click', () => {
      Object.assign(GL, {from: '2026-11-01', to: '2026-11-30', accounts: [], parties: [], projects: [], locations: [], centres: [], types: [], q: '', open: ''});
      rerender();
    });
    document.querySelector('[data-jr-reset]')?.addEventListener('click', () => {
      Object.assign(J, {parties: [], subtypes: [], projects: [], locations: [], centres: [], q: ''});
      rerender();
    });
    document.querySelector('[data-gl-print]')?.addEventListener('click', () => window.print());
    document.querySelector('[data-gl-export]')?.addEventListener('click', () => {
      const rows = sortRows(ledgerRows(), GL.sort);
      const head = ['Posting date', 'Account', 'Description', 'Debit', 'Credit', 'Voucher type', 'Voucher subtype', 'Voucher no', 'Against account', 'Party type', 'Party', 'Project', 'Location', 'Cost centre', 'Against voucher type', 'Against voucher', 'Supplier invoice no'];
      const lines = [head, ...rows.map((r) => [r.date, r.account, r.narrative, r.debit.toFixed(2), r.credit.toFixed(2), r.source, r.subtype, r.id, r.against, r.partyType, r.party, r.project, r.location, r.centre, againstType(r.againstVoucher), r.againstVoucher, r.supplierRef])];
      const csv = lines.map((l) => l.map((c) => `"${String(c ?? '').replaceAll('"', '""')}"`).join(',')).join('\r\n');
      const url = URL.createObjectURL(new Blob([csv], {type: 'text/csv;charset=utf-8'}));
      const a = document.createElement('a');
      a.href = url; a.download = 'SA7EN-general-ledger.csv'; a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    });
  }

  /* --------------------------------------------------------- journal register */
  const CANCELLED = new Set();
  const DELETED = new Set();

  const J = {
    parties: [], projects: [], locations: [], centres: [], subtypes: [], q: '',
    sort: {key: 'date', dir: 'desc'}, record: '', session: [], removed: new Set(),
    extras: new Set(['subtype', 'project', 'location', 'centre', 'party']),
  };

  function journalDocs() {
    return fixture(getCompany()).filter((d) => !J.removed.has(d.id) && !DELETED.has(d.id)).concat(J.session);
  }

  function journalRows() {
    const rows = [];
    for (const d of journalDocs()) {
      if (d.date < range().from || d.date > range().to) continue;
      if (!inSet(J.parties, d.party)) continue;
      if (!inSet(J.subtypes, subtypeOf(d))) continue;
      if (!inSet(J.projects, d.project || '')) continue;
      if (!inSet(J.locations, d.location || '')) continue;
      const centre = d.lines[0] ? d.lines[0].costCentre : '';
      if (J.centres.length && !J.centres.includes(centre)) continue;
      const hay = `${d.id} ${d.narrative} ${d.party} ${subtypeOf(d)}`.toLowerCase();
      if (J.q && !hay.includes(J.q.toLowerCase())) continue;
      rows.push({
        id: d.id, date: d.date, subtype: subtypeOf(d), party: d.party, partyType: d.partyType || '',
        project: d.project || '', location: d.location || '', centre, narrative: d.narrative,
        debit: round2(d.lines.reduce((n, l) => n + num(l.debit), 0)),
        credit: round2(d.lines.reduce((n, l) => n + num(l.credit), 0)),
        state: CANCELLED.has(d.id) ? 'cancelled' : (d.state || 'posted'), doc: d,
      });
    }
    return sortRows(rows, J.sort);
  }

  function journalRegister() {
    if (J.record) return recordPage(J.record);
    const rows = journalRows();
    const cols = [
      ['date', 'Date', (r) => e(r.date)],
      ['voucher', 'Voucher', (r) => `<button class="text-button" data-jr-open="${e(r.id)}">${e(r.id)}</button>`],
      ['description', 'Description', (r) => e(r.narrative), 'gl-desc'],
      ['debit', 'Debit', (r) => money(r.debit), 'numeric'],
      ['credit', 'Credit', (r) => money(r.credit), 'numeric'],
      ['state', 'State', (r) => `<span class="badge ${r.state === 'posted' ? 'good' : r.state === 'draft' ? '' : 'warn'}">${e(r.state)}</span>`],
      ['type', 'Voucher type', (r) => e(r.doc.source)],
      ['subtype', 'Subtype', (r) => e(r.subtype)],
      ['party', 'Party', (r) => e(r.party)],
      ['project', 'Project', (r) => e(r.project || '—')],
      ['location', 'Location', (r) => e(r.location || '—')],
      ['centre', 'Cost centre', (r) => e(r.centre || '—')],
    ];
    const sortable = new Set(['date', 'voucher', 'description', 'debit', 'credit', 'subtype', 'party', 'project', 'location', 'centre']);

    const partyOpts = [...new Set(journalDocs().map((d) => d.party))].sort().map((x) => [x, x]);
    const subtypeOpts = [...new Set(journalDocs().map((d) => subtypeOf(d)))].sort().map((x) => [x, x]);
    const projectOpts = [['', 'No project'], ...PROJECTS.map((p2) => [p2.code, p2.code])];
    const locOpts = LOCATIONS.map((l) => [l.code, l.code]);
    const centreOpts = COST_CENTRES.map((c) => [c.name, c.name]);
    const extras = [['subtype', 'Subtype'], ['party', 'Party'], ['project', 'Project'], ['location', 'Location'], ['centre', 'Cost centre']];

    return `<form id="jr-filter" class="filterbar gl-filter">
        ${ms('party', 'Parties', partyOpts, J.parties)}
        ${ms('subtype', 'Subtypes', subtypeOpts, J.subtypes)}
        ${ms('project', 'Projects', projectOpts, J.projects)}
        ${ms('location', 'Locations', locOpts, J.locations)}
        ${ms('centre', 'Cost centres', centreOpts, J.centres)}
        <label>Search<input name="q" type="search" value="${e(J.q)}" placeholder="Voucher, party or description"></label>
        <button class="button" type="button" data-jr-reset>Reset</button><button class="button primary">Apply</button>
      </form>

      <div class="gl-toolrow">
        ${ms('columns', 'Columns', extras, [...J.extras], 'jr-col')}
        <span class="form-note"><span id="jr-col-count">${cols.length}</span> of ${cols.length} columns visible. Date, voucher, description, amounts and state are always shown; fields added to the entry form appear here automatically.</span>
      </div>

      <section class="panel">
        <div class="panel-head"><h2>Journals</h2><div class="related"><span class="badge">${rows.length} entries</span><button class="button" data-jr-export>Export CSV</button><button class="button" data-jr-print>Print</button></div></div>
        <div class="table-scroll gl-scroll" data-hscroll>
          <table class="gl-table jr-table" data-hide="${['subtype', 'party', 'project', 'location', 'centre'].filter((k) => !J.extras.has(k)).join(' ')}">
            <thead><tr>${cols.map(([key, label, , cls]) => sortable.has(key)
              ? `<th class="col col-${key} ${cls || ''}"><button class="sortable" data-jr-sort="${key}" aria-sort="${J.sort.key === key ? (J.sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}">${label}<span class="sort-mark">${J.sort.key === key ? (J.sort.dir === 'asc' ? '▲' : '▼') : ''}</span></button></th>`
              : `<th class="col col-${key} ${cls || ''}">${label}</th>`).join('')}</tr></thead>
            <tbody id="jr-rows">${rows.map((r) => `<tr data-jr-row="${e(r.id)}">
                ${cols.map(([key, , cell, cls]) => `<td class="col col-${key} ${cls || ''}">${cell(r)}</td>`).join('')}
              </tr>`).join('') || `<tr><td colspan="${cols.length}"><div class="empty"><div class="empty-mark">?</div><h2>No journals</h2><p>No entry matches these filters.</p></div></td></tr>`}</tbody>
            <tfoot><tr><td colspan="${cols.findIndex(([k]) => k === 'debit')}">Total</td><td class="numeric">${money(rows.reduce((n, r) => n + r.debit, 0))}</td><td class="numeric">${money(rows.reduce((n, r) => n + r.credit, 0))}</td><td colspan="${Math.max(0, cols.length - cols.findIndex(([k]) => k === 'debit') - 2)}"></td></tr></tfoot>
          </table>
        </div>
        <div class="table-footer">${rows.length} entries. Click a voucher to open the complete record.</div>
      </section>`;
  }

  function recordPage(id) {
    const d = journalDocs().find((x) => x.id === id);
    if (!d) { J.record = ''; return journalRegister(); }
    const state = CANCELLED.has(d.id) ? 'cancelled' : (d.state || 'posted');
    const editable = state === 'draft';
    const totals = d.lines.reduce((n, l) => n + num(l.debit), 0);
    return `<div class="related gl-actions">
        <button class="button" data-jr-back>← Back to register</button>
        <span class="badge ${state === 'posted' ? 'good' : 'warn'}">${e(state)}</span>
        <span class="spacer"></span>
        ${editable ? '<button class="button" data-jr-edit>Edit draft</button>' : ''}
        <button class="button" data-jr-duplicate>Duplicate</button>
        ${state !== 'cancelled' ? '<button class="button" data-jr-cancel>Cancel entry</button>' : ''}
        ${state === 'draft' || state === 'cancelled' ? '<button class="button" data-jr-delete>Delete</button>' : ''}
        ${state === 'posted' ? '<button class="button" data-jr-reverse>Reverse</button>' : ''}
        <button class="button" data-jr-print>Print</button>
      </div>
      <section class="panel">
        <div class="panel-head"><div><div class="eyebrow">${e(d.source)} · ${e(subtypeOf(d))}</div><h2>${e(d.id)}</h2></div><span class="badge">${e(d.date)}</span></div>
        <div class="panel-body">
          <div class="record-summary">
            <div><small>Date</small>${e(d.date)}</div>
            <div><small>Party</small>${e(d.party)}</div>
            <div><small>Project</small>${e(d.project || 'None')}</div>
            <div><small>Location</small>${e(d.location || '—')}</div>
            <div><small>Total</small>${money(totals)}</div>
            <div><small>State</small>${e(state)}</div>
          </div>
          <p class="form-note">${e(d.narrative)}</p>
          <div class="table-scroll">
            <table class="gl-table"><thead><tr><th>Account</th><th>Description</th><th>Project</th><th>Location</th><th>Cost centre</th><th class="numeric">Debit</th><th class="numeric">Credit</th></tr></thead>
            <tbody>${d.lines.map((l) => `<tr><td><span class="mono">${e(l.account)}</span> ${e((accounts().find((a) => a.code === l.account) || {}).name || '')}</td><td>${e(d.narrative)}</td><td>${e(l.project || '—')}</td><td>${e(l.location || '—')}</td><td>${e(l.costCentre || '—')}</td><td class="numeric">${num(l.debit) ? money(num(l.debit)) : ''}</td><td class="numeric">${num(l.credit) ? money(num(l.credit)) : ''}</td></tr>`).join('')}</tbody>
            <tfoot><tr><td colspan="5">Total</td><td class="numeric">${money(totals)}</td><td class="numeric">${money(d.lines.reduce((n, l) => n + num(l.credit), 0))}</td></tr></tfoot></table>
          </div>
        </div>
        <div class="table-footer">${state === 'posted'
          ? 'Posted: immutable. Cancel removes its ledger effect and keeps it in the register; delete then removes it from the register. A reversal entry is optional and only needed when the correction must stay visible in the ledger.'
          : state === 'cancelled'
            ? 'Cancelled: no ledger effect, still visible in the register. Delete removes it from the register; the number is never reused and the audit log keeps the record.'
            : 'Draft: editable, can be submitted, duplicated or deleted. Nothing reaches the ledger.'}</div>
      </section>`;
  }

  function journalDocById(id) {
    const d = journalDocs().find((x) => x.id === id);
    if (!d) return null;
    return {...d, state: CANCELLED.has(id) ? 'cancelled' : (d.state || 'posted')};
  }
  function updateJournalDoc(id, patch) {
    const i = J.session.findIndex((x) => x.id === id);
    if (i < 0) return false;
    J.session[i] = {...J.session[i], ...patch};
    return true;
  }
  function cancelJournalDoc(id) { CANCELLED.add(id); }
  function deleteJournalDoc(id) {
    CANCELLED.add(id);
    DELETED.add(id);
    J.session = J.session.filter((x) => x.id !== id);
  }
  function duplicateJournalDoc(id) {
    const src = journalDocs().find((x) => x.id === id);
    if (!src) return '';
    const copy = {...src, id: 'JE-2026-D' + String(J.session.length + 101), state: 'draft', narrative: src.narrative + ' (copy)'};
    J.session.push(copy);
    return copy.id;
  }

  function syncJ(form) {
    const pick = (n) => [...form.querySelectorAll(`input[name="${n}"]:checked`)].map((x) => x.value);
    J.parties = pick('party'); J.subtypes = pick('subtype'); J.projects = pick('project');
    J.locations = pick('location'); J.centres = pick('centre');
    J.q = form.q.value;
  }

  function bindJournal(rerender, notify, navigate) {
    bindMS();
    const form = document.querySelector('#jr-filter');
    if (form) form.addEventListener('submit', (ev) => { ev.preventDefault(); syncJ(form); rerender(); });
    document.querySelectorAll('[data-jr-col]').forEach((box) => box.addEventListener('change', () => {
      box.checked ? J.extras.add(box.dataset.jrCol) : J.extras.delete(box.dataset.jrCol);
      applyColumnVisibility('jr');
    }));
    document.querySelectorAll('[data-jr-sort]').forEach((btn) => btn.addEventListener('click', () => {
      const k = btn.dataset.jrSort;
      J.sort = {key: k, dir: J.sort.key === k && J.sort.dir === 'asc' ? 'desc' : 'asc'};
      rerender();
    }));
    document.querySelector('#jr-rows')?.addEventListener('click', (ev) => {
      const open = ev.target.closest('[data-jr-open]');
      const row = ev.target.closest('[data-jr-row]');
      const id = open ? open.dataset.jrOpen : row ? row.dataset.jrRow : '';
      if (!id) return;
      navigate({module: 'accounting', tab: 'journals', mode: 'editor', code: id});
    });
    document.querySelector('[data-jr-back]')?.addEventListener('click', () => { J.record = ''; rerender(); });
    restoreMS();
    document.querySelector('[data-jr-print]')?.addEventListener('click', () => window.print());
    document.querySelector('[data-jr-export]')?.addEventListener('click', () => {
      const list = sortRows(journalRows(), J.sort);
      const head = ['Date', 'Voucher', 'Description', 'Debit', 'Credit', 'State', 'Voucher type', 'Subtype', 'Party / sub-account', 'Project', 'Location', 'Cost centre'];
      const body = list.map((r) => [r.date, r.id, r.narrative, r.debit.toFixed(2), r.credit.toFixed(2), r.state, r.doc.source, r.subtype, r.party, r.project, r.location, r.centre]);
      const csv = [head, ...body].map((l) => l.map((c) => `"${String(c ?? '').replaceAll('"', '""')}"`).join(',')).join('\r\n');
      const url = URL.createObjectURL(new Blob([csv], {type: 'text/csv;charset=utf-8'}));
      const a = document.createElement('a'); a.href = url; a.download = 'SA7EN-journal-register.csv'; a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    });
    document.querySelector('[data-jr-duplicate]')?.addEventListener('click', () => {
      const src = journalDocs().find((x) => x.id === J.record);
      if (!src) return;
      const copy = {...src, id: 'JE-2026-D' + String(J.session.length + 101), state: 'draft', narrative: src.narrative + ' (copy)'};
      J.session.push(copy);
      notify('Duplicated into a new draft. Edit and submit when ready.');
      J.record = copy.id;
      rerender();
    });
    document.querySelector('[data-jr-cancel]')?.addEventListener('click', () => {
      if (!J.record) return;
      CANCELLED.add(J.record);
      notify('Entry cancelled: removed from the ledger, kept in the register. Its number is not reused.');
      rerender();
    });
    document.querySelector('[data-jr-reverse]')?.addEventListener('click', () => {
      if (!J.record) return;
      notify('Reversal drafted. Reversal is optional: cancel already removes the ledger effect.');
    });
    document.querySelector('[data-jr-delete]')?.addEventListener('click', () => {
      const src = journalDocs().find((x) => x.id === J.record);
      if (!src) return;
      if (J.session.includes(src)) J.session = J.session.filter((x) => x !== src);
      else DELETED.add(src.id);
      notify('Deleted from the register. The voucher number is never reused and the audit log keeps the record.');
      J.record = '';
      rerender();
    });
    document.querySelector('[data-jr-edit]')?.addEventListener('click', () => {
      notify('The draft editor opens with this record loaded once the backend is connected.');
    });
  }

  /* Project and location master data lives in Setup; there are no separate
     pages for them. This is the only shared piece: the create-form handler. */
  function bindDimension(kind, rerender) {
    document.querySelectorAll('[data-edit]').forEach((b) => b.addEventListener('click', () => {
      const [type, code] = b.dataset.edit.split(':');
      if (type !== kind) return;
      EDIT.type = kind; EDIT.code = code;
      rerender();
    }));
    document.querySelector('[data-edit-cancel]')?.addEventListener('click', () => { EDIT.type = ''; EDIT.code = ''; rerender(); });
    document.querySelectorAll(`[data-dim-form="${kind}"]`).forEach((form) => form.addEventListener('submit', (ev) => {
      ev.preventDefault();
      const v = Object.fromEntries(new FormData(form));
      if (kind === 'project') {
        if (!EDIT.code && PROJECTS.some((p) => p.code === v.code)) { notify('That project code already exists.'); return; }
        const record = {code: v.code, name: v.name, status: v.status, manager: v.manager, start: v.start || '', end: v.end || '', budget: round2(Number(v.budget) || 0), description: v.description || ''};
        if (EDIT.code) { Object.assign(PROJECTS.find((p) => p.code === EDIT.code), record); notify('Project updated for this session.'); }
        else { PROJECTS.push({...record, accounts: []}); notify('Project added for this session. It has no postings yet.'); }
      } else {
        if (!EDIT.code && LOCATIONS.some((l) => l.code === v.code)) { notify('That location code already exists.'); return; }
        const record = {code: v.code, name: v.name, kind: v.kind, address: v.address || '', contact: v.contact || '', phone: v.phone || '', notes: v.notes || ''};
        if (EDIT.code) { Object.assign(LOCATIONS.find((l) => l.code === EDIT.code), record); notify('Location updated for this session.'); }
        else { LOCATIONS.push(record); notify('Location added for this session. A branch is simply a location with kind branch.'); }
      }
      EDIT.type = ''; EDIT.code = '';
      rerender();
    }));
  }

  /* ------------------------------------------------------------------ setup */
  function setup() {
    const field = (label, value, hint = '', name = '') => `<label>${e(label)}<input ${name ? `name="${name}"` : ''} value="${e(value)}">${hint ? `<small class="secondary">${e(hint)}</small>` : ''}</label>`;
    const tb = rows();
    const bal = (code, key) => { const a = tb.find((r) => r.code === code); return a ? round2(num(a[key])) : 0; };
    const control = (a) => (a.control ? badge(a.control, 'plum') : '—');
    const newBtn = (label, form) => `<button class="text-button" data-settings-new="${form}">${label}</button>`;
    const editorLink = (form, code) => `data-settings-edit="${form}:${e(code)}"`;
    const headRows = accounts().map((a) => `<tr class="row-link" ${editorLink('heads', a.code)}><td class="mono">${e(a.code)}</td><td>${e(a.name)}</td><td>${e(a.type)}</td><td>${e(a.group)}</td><td>${control(a)}</td><td class="numeric">${money(bal(a.code, 'opening'))}</td><td class="numeric">${money(bal(a.code, 'closingDebit') - bal(a.code, 'closingCredit'))}</td><td>${badge(a.active ? 'Active' : 'Archived', a.active ? 'good' : 'warn')}</td><td class="row-go">›</td></tr>`).join('');
    const sections = {
      numbering: `<section class="panel">
        <div class="panel-head"><h2>Numbering</h2><span class="badge">Fixed after the first entry</span></div>
        <form class="panel-body form-grid" data-settings-save="numbering">
          ${field('Journal prefix', NUMBERING.journal.prefix, `Number looks like ${NUMBERING.journal.prefix}-MM-YYYY-${'0'.repeat((NUMBERING.journal.padding || 4) - 1)}1`, 'journalPrefix')}
          ${field('Next journal number', String(NUMBERING.journal.next).padStart(NUMBERING.journal.padding || 4, '0'), '', 'journalNext')}
          ${field('Sales invoice prefix', NUMBERING.sales.prefix, '', 'salesPrefix')}
          ${field('Next sales number', String(NUMBERING.sales.next).padStart(NUMBERING.sales.padding || 4, '0'), '', 'salesNext')}
          ${field('Purchase invoice prefix', NUMBERING.purchase.prefix, '', 'purchasePrefix')}
          ${field('Next purchase number', String(NUMBERING.purchase.next).padStart(NUMBERING.purchase.padding || 4, '0'), '', 'purchaseNext')}
          ${field('Payment prefix', NUMBERING.payment.prefix, '', 'paymentPrefix')}
          ${field('Next payment number', String(NUMBERING.payment.next).padStart(NUMBERING.payment.padding || 4, '0'), '', 'paymentNext')}
          ${field('Receipt prefix', NUMBERING.receipt.prefix, '', 'receiptPrefix')}
          ${field('Next receipt number', String(NUMBERING.receipt.next).padStart(NUMBERING.receipt.padding || 4, '0'), '', 'receiptNext')}
          ${field('Number padding', String(NUMBERING.journal.padding), 'Digits after the prefix', 'padding')}
          <div class="related"><button class="button primary">Save numbering</button></div>
        </form>
        <div class="panel-body"><p class="form-note">A series is frozen once its first document exists; a deleted or cancelled number is never reused. Changing a prefix only affects documents that have not been created yet.</p></div>
      </section>`,
      accounts: `<section class="panel">
        <div class="panel-head"><h2>Default accounts</h2><span class="badge">From chart flags</span></div>
        <form class="panel-body form-grid" data-settings-save="defaults">
          <label>Trade receivables control<select name="ar" class="inline-input">${accounts().filter((a) => a.type === 'asset').map((a) => `<option value="${a.code}" ${a.code === '1100' ? 'selected' : ''}>${a.code} · ${e(a.name)}</option>`).join('')}</select></label>
          <label>Trade payables control<select name="ap" class="inline-input">${accounts().filter((a) => a.type === 'liability').map((a) => `<option value="${a.code}" ${a.code === '2100' ? 'selected' : ''}>${a.code} · ${e(a.name)}</option>`).join('')}</select></label>
          <label>Input tax account<select name="inputTax" class="inline-input">${accounts().filter((a) => a.type === 'asset').map((a) => `<option value="${a.code}" ${a.code === '1300' ? 'selected' : ''}>${a.code} · ${e(a.name)}</option>`).join('')}</select></label>
          <label>Output tax account<select name="outputTax" class="inline-input">${accounts().filter((a) => a.type === 'liability').map((a) => `<option value="${a.code}" ${a.code === '2200' ? 'selected' : ''}>${a.code} · ${e(a.name)}</option>`).join('')}</select></label>
          <label>Inventory account<select name="inventory" class="inline-input">${accounts().filter((a) => a.type === 'asset').map((a) => `<option value="${a.code}" ${a.code === '1200' ? 'selected' : ''}>${a.code} · ${e(a.name)}</option>`).join('')}</select></label>
          <label>Rounding / bank charges<select name="rounding" class="inline-input">${accounts().filter((a) => a.type === 'expense').map((a) => `<option value="${a.code}" ${a.code === '6500' ? 'selected' : ''}>${a.code} · ${e(a.name)}</option>`).join('')}</select></label>
          <label>Default bank control<select name="bank" class="inline-input">${accounts().filter((a) => a.control === 'bank').map((a) => `<option value="${a.code}">${a.code} · ${e(a.name)}</option>`).join('')}</select></label>
          <label>Default cash control<select name="cash" class="inline-input">${accounts().filter((a) => a.control === 'cash').map((a) => `<option value="${a.code}" ${a.code === '1000' ? 'selected' : ''}>${a.code} · ${e(a.name)}</option>`).join('')}</select></label>
          <div class="related"><button class="button primary">Save defaults</button></div>
        </form>
        <div class="panel-body"><p class="form-note">Control and tax accounts are set on the account itself, so a new account of that type appears here automatically. A control head requires a party or sub-account on every line that uses it.</p></div>
      </section>`,
      heads: `<section class="panel">
        <div class="panel-head"><h2>Accounting heads</h2><div class="related"><span class="badge">${accounts().length} heads</span>${newBtn('New head', 'heads')}</div></div>
        <div class="table-scroll" data-hscroll><table><thead><tr><th>Code</th><th>Account name</th><th>Accounting head</th><th>Accounting group</th><th>Control</th><th class="numeric">Opening</th><th class="numeric">Closing</th><th>State</th><th></th></tr></thead><tbody>${headRows}</tbody></table></div>
        <div class="table-footer">A head is the account itself. Its class decides where it appears in the trial balance; its control flag decides whether every line needs a party. Click a row to edit it.</div>
      </section>`,
      projects: `<section class="panel">
        <div class="panel-head"><h2>Projects</h2><div class="related"><span class="badge">${PROJECTS.length} projects</span>${newBtn('New project', 'project')}</div></div>
        <div class="table-scroll" data-hscroll><table><thead><tr><th>Code</th><th>Project</th><th>Manager</th><th>State</th><th>Start</th><th>End</th><th class="numeric">Budget</th><th></th></tr></thead><tbody>${PROJECTS.map((p) => `<tr class="row-link" ${editorLink('project', p.code)}><td class="mono">${e(p.code)}</td><td>${e(p.name)}</td><td>${e(p.manager || '—')}</td><td>${badge(p.status, p.status === 'active' ? 'good' : 'warn')}</td><td>${e(p.start || '—')}</td><td>${e(p.end || '—')}</td><td class="numeric">${money(p.budget || 0)}</td><td class="row-go">›</td></tr>`).join('') || '<tr><td colspan="8">No projects yet.</td></tr>'}</tbody></table></div>
        <div class="table-footer">Projects are a data field on transactions. They slice reports and never hold a balance.</div>
      </section>`,
      locations: `<section class="panel">
        <div class="panel-head"><h2>Locations</h2><div class="related"><span class="badge">${LOCATIONS.length} locations</span>${newBtn('New location', 'location')}</div></div>
        <div class="table-scroll" data-hscroll><table><thead><tr><th>Code</th><th>Location</th><th>Kind</th><th>Address</th><th>Contact</th><th></th></tr></thead><tbody>${LOCATIONS.map((l) => `<tr class="row-link" ${editorLink('location', l.code)}><td class="mono">${e(l.code)}</td><td>${e(l.name)}</td><td>${e(l.kind)}</td><td>${e(l.address || '—')}</td><td>${e(l.contact || '—')}</td><td class="row-go">›</td></tr>`).join('')}</tbody></table></div>
        <div class="table-footer">A branch is a location whose kind is branch. There is no separate branch field.</div>
      </section>`,
      centres: `<section class="panel">
        <div class="panel-head"><h2>Cost centres</h2><div class="related"><span class="badge">${COST_CENTRES.length} cost centres</span>${newBtn('New cost centre', 'centre')}</div></div>
        <div class="table-scroll" data-hscroll><table><thead><tr><th>Code</th><th>Cost centre</th><th>Description</th><th>State</th><th></th></tr></thead><tbody>${COST_CENTRES.map((c) => `<tr class="row-link" ${editorLink('centre', c.code)}><td class="mono">${e(c.code)}</td><td>${e(c.name)}</td><td>${e(c.description || '—')}</td><td>${badge(c.archived ? 'Archived' : 'Active', c.archived ? 'warn' : 'good')}</td><td class="row-go">›</td></tr>`).join('')}</tbody></table></div>
        <div class="table-footer">Cost centres slice expense and activity for internal reporting. They never hold a balance.</div>
      </section>`,
      partygroups: `<section class="panel">
        <div class="panel-head"><h2>Party groups</h2><div class="related"><span class="badge">${PARTY_GROUPS.length} groups</span>${newBtn('New party group', 'partygroups')}</div></div>
        <div class="table-scroll" data-hscroll><table><thead><tr><th>Code</th><th>Group</th><th>Applies to</th><th>Description</th><th></th></tr></thead><tbody>${PARTY_GROUPS.map((g) => `<tr class="row-link" ${editorLink('partygroups', g.code)}><td class="mono">${e(g.code)}</td><td>${e(g.name)}</td><td>${e(g.kind || 'both')}</td><td>${e(g.description || '—')}</td><td class="row-go">›</td></tr>`).join('')}</tbody></table></div>
        <div class="table-footer">Groups classify customers and suppliers for reporting and default terms. A party can belong to one group.</div>
      </section>`,
      itemgroups: `<section class="panel">
        <div class="panel-head"><h2>Item groups</h2><div class="related"><span class="badge">${ITEM_GROUPS.length} groups</span>${newBtn('New item group', 'itemgroups')}</div></div>
        <div class="table-scroll" data-hscroll><table><thead><tr><th>Code</th><th>Group</th><th>Description</th><th></th></tr></thead><tbody>${ITEM_GROUPS.map((g) => `<tr class="row-link" ${editorLink('itemgroups', g.code)}><td class="mono">${e(g.code)}</td><td>${e(g.name)}</td><td>${e(g.description || '—')}</td><td class="row-go">›</td></tr>`).join('')}</tbody></table></div>
        <div class="table-footer">Item groups drive reporting and default accounts or tax rules. Inventory keeps the stock detail; this is the accounting view.</div>
      </section>`,
      taxes: `<section class="panel">
        <div class="panel-head"><h2>Tax rules</h2><div class="related"><span class="badge">${TAX_RULES.length} rules</span>${newBtn('New tax rule', 'tax')}</div></div>
        <div class="table-scroll" data-hscroll><table><thead><tr><th>Code</th><th>Rule</th><th>Kind</th><th class="numeric">Rate</th><th>Basis</th><th>Account</th><th>Effective</th><th>Status</th><th></th></tr></thead><tbody>${TAX_RULES.map((r) => `<tr class="row-link" ${editorLink('tax', r.code)}><td class="mono">${e(r.code)}</td><td>${e(r.name)}</td><td>${e(r.kind)}</td><td class="numeric">${r.rate}%</td><td>${e(r.basis)}</td><td>${e(r.account)}</td><td>${e(r.from)}${r.to ? ` → ${e(r.to)}` : ''}</td><td>${badge(r.status || 'Active', (r.status || 'Active') === 'Active' ? 'good' : 'warn')}</td><td class="row-go">›</td></tr>`).join('')}</tbody></table></div>
        <div class="table-footer">Rules are defaults for document lines; they never post on their own. The tax registers and returns belong to the comprehensive tax module that comes later.</div>
      </section>
      <section class="panel">
        <div class="panel-head"><h2>Default withholding</h2><span class="badge">Applied to payment and receipt defaults</span></div>
        <form class="panel-body form-grid" data-settings-save="withholding">
          ${field('Sales tax withheld on receipts %', '0.00', 'Deducted by the customer and paid to the authority', 'salesTaxWithheld')}
          ${field('Income tax withheld on receipts %', '0.00', 'Advance tax deducted by the customer', 'incomeTaxWithheld')}
          ${field('Sales tax withheld on payments %', '0.00', 'We deduct from a supplier', 'salesTaxPayable')}
          ${field('Income tax withheld on payments %', '4.50', 'We deduct and owe to the authority', 'incomeTaxPayable')}
          <div class="related"><button class="button primary">Save withholding defaults</button></div>
        </form>
        <div class="panel-body"><p class="form-note">These are defaults only; a payment or invoice line can change them. The four figures are stored for this session.</p></div>
      </section>`,
      approval: `<section class="panel">
        <div class="panel-head"><h2>Approvals and periods</h2></div>
        <form class="panel-body form-grid" data-settings-save="approvals">
          ${field('Review required above', '100,000.00', 'Debits above this need an independent reviewer', 'reviewAbove')}
          <label>Self approval<select name="selfApproval" class="inline-input"><option>Not permitted</option><option>Allowed below the threshold</option><option>Allowed with reason</option></select></label>
          <label>Period lock<select name="periodLock" class="inline-input"><option>Requires checklist and sign-off</option><option>Automatic on close</option><option>Manual only</option></select></label>
          ${field('Reopen authority', 'Business administrator only', '', 'reopenAuthority')}
          ${field('Post into closed period', 'Administrator, with reason', '', 'closedPeriod')}
          ${field('Correction route', 'Cancel, then delete; a reversal only when the correction must stay visible', '', 'correction')}
          <div class="related"><button class="button primary">Save policy</button></div>
        </form>
      </section>`
    };
    const order = [['numbering', 'Numbering'], ['accounts', 'Default accounts'], ['heads', 'Accounting heads'], ['projects', 'Projects'], ['locations', 'Locations'], ['centres', 'Cost centres'], ['partygroups', 'Party groups'], ['itemgroups', 'Item groups'], ['taxes', 'Taxes'], ['approval', 'Approvals']];
    let current = order.some(([id]) => id === SETUP_TAB) ? SETUP_TAB : 'numbering';
    try { const saved = sessionStorage.getItem('sa7en:settings-tab'); if (saved && order.some(([id]) => id === saved)) current = saved; } catch {}
    SETUP_TAB = current;
    return `<div class="tabs" role="tablist" aria-label="Accounting settings">${order.map(([id, label]) => `<button role="tab" aria-selected="${current === id}" data-setup-tab="${id}">${label}</button>`).join('')}</div>
      <div id="setup-panel">${sections[current]}</div>`;
  }

  function bindSetup(rerender, navigate) {
    document.querySelectorAll('[data-setup-tab]').forEach((b) => b.addEventListener('click', () => {
      SETUP_TAB = b.dataset.setupTab;
      try { sessionStorage.setItem('sa7en:settings-tab', SETUP_TAB); } catch {}
      rerender();
    }));
    document.querySelectorAll('[data-settings-new]').forEach((b) => b.addEventListener('click', () => {
      const form = b.dataset.settingsNew;
      SETUP_TAB = form === 'heads' ? 'heads' : form === 'project' ? 'projects' : form === 'location' ? 'locations' : form === 'centre' ? 'centres' : form === 'partygroups' ? 'partygroups' : form === 'itemgroups' ? 'itemgroups' : form === 'tax' ? 'taxes' : SETUP_TAB;
      navigate({module: 'settings', tab: 'accounting', mode: 'editor', form, code: ''});
    }));
    document.querySelectorAll('[data-settings-edit]').forEach((tr) => tr.addEventListener('click', () => {
      const [form, code] = tr.dataset.settingsEdit.split(':');
      SETUP_TAB = form === 'heads' ? 'heads' : form === 'project' ? 'projects' : form === 'location' ? 'locations' : form === 'centre' ? 'centres' : form === 'partygroups' ? 'partygroups' : form === 'itemgroups' ? 'itemgroups' : form === 'tax' ? 'taxes' : SETUP_TAB;
      navigate({module: 'settings', tab: 'accounting', mode: 'editor', form, code});
    }));
  }

  /* ------------------------------------------------------ cash and bank */
  const picked = (box) => [...box.querySelectorAll('input[type=checkbox]:checked')].map((b) => b.value);
  const ledgerBalance = (code) => {
    const a = rows().find((r) => r.code === code);
    return a ? round2(num(a.closingDebit) - num(a.closingCredit)) : 0;
  };
  const scopeText = (list) => (list && list.length ? list.join(', ') : 'All');

  function cashAccountRows(asOf = '') {
    return CASH_BANK.map((s) => {
      let postings = 0, dr = 0, cr = 0, current = 0;
      for (const d of fixture(getCompany())) for (const l of d.lines) {
        if (l.party !== s.name) continue;
        const movement = num(l.debit) - num(l.credit);
        current += movement;
        if (!asOf || d.date <= asOf) { postings++; dr += num(l.debit); cr += num(l.credit); }
      }
      return {...s, postings, balance: round2(dr - cr), current: round2(current)};
    });
  }

  function cashBankView() {
    const controls = accounts().filter((a) => a.control === 'bank' || a.control === 'cash');
    const f = FILTERS.cash;
    const asOf = f.asof || '';
    const list = cashAccountRows(asOf);
    const rows = list.filter((x) => {
      const head = accounts().find((a) => a.code === x.control);
      return hit(f.q, x.code, x.name, x.reference, x.kind, head ? head.name : '', x.projects.join(' '), x.locations.join(' '))
        && (!f.kind || x.kind === f.kind) && (!f.control || x.control === f.control) && (!f.status || (x.status || 'Active') === f.status);
    });
    return `<form class="filterbar" data-filter="cash">
        ${filterInput('cash', f.q, 'Code, name, reference, project, location')}
        <label>Kind<select name="kind"><option value="">All kinds</option><option value="bank" ${f.kind === 'bank' ? 'selected' : ''}>Bank</option><option value="cash" ${f.kind === 'cash' ? 'selected' : ''}>Cash</option></select></label>
        <label>Control head<select name="control"><option value="">All control heads</option>${controls.map((a) => `<option value="${a.code}" ${f.control === a.code ? 'selected' : ''}>${a.code} · ${e(a.name)}</option>`).join('')}</select></label>
        <label>Status<select name="status"><option value="">All states</option><option ${f.status === 'Active' ? 'selected' : ''}>Active</option><option ${f.status === 'Closed' ? 'selected' : ''}>Closed</option></select></label>
        <label>Balances as at<input type="date" name="asof" value="${e(asOf)}" max="2026-12-31"></label>
        <button class="button" type="button" data-filter-reset="cash">Reset to current</button>
      </form>
      <section class="panel">
        <div class="panel-head"><h2>Cash and bank sub-accounts</h2><span class="badge">${rows.length} of ${list.length} accounts</span><span class="badge">${asOf ? `balances as at ${e(asOf)}` : 'current balances'}</span></div>
        <div class="table-scroll" data-hscroll><table>
          <thead><tr><th>Code</th><th>Account</th><th>Kind</th><th>Control head</th><th>Status</th><th class="numeric">Postings</th><th class="numeric">Balance</th><th>Projects</th><th>Locations</th><th>Ledger</th></tr></thead>
          <tbody>${rows.map((s) => { const head = accounts().find((a) => a.code === s.control); return `<tr class="row-link" data-edit="cash:${e(s.code)}"><td class="mono">${e(s.code)}</td><td>${e(s.name)}<small class="secondary">${e(s.reference || '')}</small></td><td>${badge(s.kind, s.kind === 'bank' ? 'plum' : '')}</td><td>${e(s.control)} · ${e(head ? head.name : 'Unknown head')}</td><td>${badge(s.status || 'Active', (s.status || 'Active') === 'Active' ? 'good' : 'warn')}</td><td class="numeric">${s.postings}</td><td class="numeric">${money(s.balance)}${asOf ? `<small class="secondary">current ${money(s.current)}</small>` : ''}</td><td>${e(scopeText(s.projects))}</td><td>${e(scopeText(s.locations))}</td><td><button class="text-button" data-cash-ledger="${e(s.name)}">Open</button></td></tr>`; }).join('')}</tbody>
          <tfoot><tr><td colspan="6">Total shown · ${rows.length} of ${list.length}${asOf ? ` · as at ${e(asOf)}` : ' · current'}</td><td class="numeric">${money(round2(rows.reduce((n, s) => n + s.balance, 0)))}</td><td colspan="3"></td></tr></tfoot>
        </table></div>
        <div class="table-footer">A sub-account is the party inside a control head. Any head flagged as a bank or cash control can hold sub-accounts. Click a row to open its form. Set a date to see the balance as it stood then; the small figure under it stays the current balance. Reset returns to current.</div>
      </section>`;
  }

  function cashEditor(code) {
    const controls = accounts().filter((a) => a.control === 'bank' || a.control === 'cash');
    const editingRow = code ? (CASH_BANK.find((s) => s.code === code) || {}) : {};
    const v = (key, fallback = '') => (editingRow[key] !== undefined ? editingRow[key] : fallback);
    return `<section class="panel">
      <div class="panel-head"><h2>${editingRow.code ? e(editingRow.name) : 'New cash or bank sub-account'}</h2><span class="badge">${editingRow.code ? `Editing ${e(editingRow.code)}` : 'Blank access means all'}</span></div>
      <form data-cash-form class="panel-body form-grid">
        <input type="hidden" name="editingCode" value="${e(editingRow.code || '')}">
        <label>Code<input name="code" required pattern="[A-Z0-9-]{2,20}" value="${e(v('code'))}" ${editingRow.code ? 'readonly' : ''} placeholder="BANK-HBL"></label>
        <label>Name<input name="name" required maxlength="70" value="${e(v('name'))}" placeholder="HBL — current 1234"></label>
        <label>Control head<select name="control" class="inline-input" required>${controls.map((a) => `<option value="${a.code}" ${a.code === v('control', '1010') ? 'selected' : ''}>${a.code} · ${e(a.name)} (${a.control})</option>`).join('')}</select></label>
        <label>Kind<select name="kind" class="inline-input"><option value="bank" ${v('kind') === 'bank' ? 'selected' : ''}>Bank</option><option value="cash" ${v('kind') === 'cash' ? 'selected' : ''}>Cash</option></select></label>
        <label>Bank name<input name="bank" maxlength="60" value="${e(v('bank'))}" placeholder="Habib Bank"></label>
        <label>Branch<input name="branch" maxlength="60" value="${e(v('branch'))}" placeholder="Clifton"></label>
        <label>Account / IBAN / till<input name="reference" maxlength="40" value="${e(v('reference'))}" placeholder="PK00XXXX0000000000000000"></label>
        <label>Currency<input name="currency" maxlength="3" value="${e(v('currency', 'PKR'))}"></label>
        <label>Opening balance<input name="opening" inputmode="decimal" value="${e(v('opening', '0.00'))}"></label>
        <label>Status<select name="status" class="inline-input"><option ${v('status', 'Active') === 'Active' ? 'selected' : ''}>Active</option><option ${v('status') === 'Closed' ? 'selected' : ''}>Closed</option></select></label>
        <label class="wide">Notes<input name="notes" maxlength="120" value="${e(v('notes'))}" placeholder="Authorised signatories, cut-off, card machine"></label>
        ${ms('cb-projects', 'Allowed projects', PROJECTS.map((p) => [p.code, `${p.code} · ${p.name}`]), v('projects', []))}
        ${ms('cb-locations', 'Allowed locations', LOCATIONS.map((l) => [l.code, `${l.code} · ${l.name}`]), v('locations', []))}
        <div class="related"><button class="button primary">${editingRow.code ? 'Save changes' : 'Add sub-account'}</button><button type="button" class="button" data-form-cancel>Cancel</button></div>
      </form>
      <div class="panel-body"><p class="form-note">The control head decides where the balance sits; the kind decides which journal lines may pick the sub-account. A bank control takes bank lines, a cash control takes cash lines, and the chosen projects and locations narrow it further.</p></div>
    </section>`;
  }

  function bindCashBank(rerender, notify, navigate) {
    const goBack = () => navigate({module: 'accounting', tab: 'cash'});
    document.querySelectorAll('[data-cash-ledger]').forEach((b) => b.addEventListener('click', (ev) => {
      ev.stopPropagation();
      GL.parties = [b.dataset.cashLedger];
      GL.q = '';
      navigate({module: 'accounting', tab: 'ledger'});
    }));
    document.querySelectorAll('[data-edit]').forEach((b) => b.addEventListener('click', () => {
      const [type, code] = b.dataset.edit.split(':');
      if (type !== 'cash') return;
      navigate({module: 'accounting', tab: 'cash', mode: 'editor', code});
    }));
    document.querySelector('[data-cash-form] [data-form-cancel]')?.addEventListener('click', goBack);
    document.querySelector('[data-cash-form]')?.addEventListener('submit', (ev) => {
      ev.preventDefault();
      const form = ev.target;
      if (!form.reportValidity()) return;
      const v2 = Object.fromEntries(new FormData(form));
      const editingCode = v2.editingCode || '';
      if (!editingCode && CASH_BANK.some((s) => s.code === v2.code || s.name.trim().toLowerCase() === v2.name.trim().toLowerCase())) { notify('That code or name already exists.'); return; }
      const [proj, loc] = form.querySelectorAll('.ms');
      const record = {code: v2.code, name: v2.name.trim(), kind: v2.kind, control: v2.control, reference: v2.reference || '', bank: v2.bank || '', branch: v2.branch || '', currency: v2.currency || 'PKR', opening: round2(Number(v2.opening) || 0), status: v2.status || 'Active', notes: v2.notes || '', projects: picked(proj), locations: picked(loc)};
      if (editingCode) {
        const target = CASH_BANK.find((s) => s.code === editingCode);
        if (target) Object.assign(target, record);
        notify('Sub-account updated for this session.');
      } else {
        CASH_BANK.push(record);
        notify('Sub-account added for this session. It is available in the journal and belongs to the chosen projects and locations.');
      }
      goBack();
    });
  }

  /* ------------------------------------------------------------ parties */
  function partyControl(type) { return type === 'customer' ? '1100' : '2100'; }
  function partyRows(asOf = '') {
    return PARTIES.map((p) => {
      const code = partyControl(p.type);
      let debit = 0, credit = 0, count = 0, current = 0;
      for (const d of fixture(getCompany())) {
        if (d.party !== p.name) continue;
        for (const l of d.lines) if (l.account === code) {
          const move = p.type === 'customer' ? num(l.debit) - num(l.credit) : num(l.credit) - num(l.debit);
          current += move;
          if (!asOf || d.date <= asOf) { debit += num(l.debit); credit += num(l.credit); count++; }
        }
      }
      const balance = p.type === 'customer' ? round2(debit - credit) : round2(credit - debit);
      return {...p, balance, current: round2(current), postings: count};
    });
  }
  function partyStatement(p) {
    const code = partyControl(p.type);
    const lines = [];
    let run = 0;
    for (const d of fixture(getCompany())) {
      if (d.party !== p.name) continue;
      for (const l of d.lines) {
        if (l.account !== code) continue;
        const dr = num(l.debit), cr = num(l.credit);
        run = round2(run + (p.type === 'customer' ? dr - cr : cr - dr));
        lines.push({date: d.date, id: d.id, source: d.source, dr, cr, balance: run});
      }
    }
    return lines.sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
  }
  function partiesView() {
    const f = FILTERS.parties;
    const asOf = f.asof || '';
    const all = partyRows(asOf);
    const rows = all.filter((p) => hit(f.q, p.code, p.name, p.group, p.contact, p.email, p.phone)
      && (!f.type || p.type === f.type) && (!f.status || p.status === f.status)
      && (!f.balance || (f.balance === 'debit' ? p.balance > 0 : f.balance === 'credit' ? p.balance < 0 : Math.abs(p.balance) < 0.01)));
    const receivable = round2(all.filter((p) => p.type === 'customer').reduce((n, p) => n + p.balance, 0));
    const payable = round2(all.filter((p) => p.type === 'supplier').reduce((n, p) => n + p.balance, 0));
    return `<form class="filterbar" data-filter="parties">
        ${filterInput('parties', f.q, 'Code, name, group, contact, email')}
        <label>Type<select name="type"><option value="">All types</option><option value="customer" ${f.type === 'customer' ? 'selected' : ''}>Customers</option><option value="supplier" ${f.type === 'supplier' ? 'selected' : ''}>Suppliers</option></select></label>
        <label>Status<select name="status"><option value="">All states</option><option ${f.status === 'Active' ? 'selected' : ''}>Active</option><option ${f.status === 'Hold' ? 'selected' : ''}>Hold</option><option ${f.status === 'Blocked' ? 'selected' : ''}>Blocked</option></select></label>
        <label>Balance<select name="balance"><option value="">Any balance</option><option value="debit" ${f.balance === 'debit' ? 'selected' : ''}>They owe us / debit</option><option value="credit" ${f.balance === 'credit' ? 'selected' : ''}>We owe them / credit</option><option value="zero" ${f.balance === 'zero' ? 'selected' : ''}>Zero</option></select></label>
        <label>Balances as at<input type="date" name="asof" value="${e(asOf)}" max="2026-12-31"></label>
        <button class="button" type="button" data-filter-reset="parties">Reset to current</button>
      </form>
      <section class="panel">
        <div class="panel-head"><h2>Parties</h2><span class="badge">${rows.length} of ${all.length} records</span><span class="badge">${asOf ? `balances as at ${e(asOf)}` : 'current balances'}</span></div>
        <div class="table-scroll" data-hscroll><table>
          <thead><tr><th>Code</th><th>Name</th><th>Type</th><th>Group</th><th class="numeric">Terms</th><th class="numeric">Limit</th><th class="numeric">Balance</th><th>Status</th><th>Ledger</th></tr></thead>
          <tbody>${rows.map((p) => `<tr class="row-link" data-edit="party:${e(p.code)}"><td class="mono">${e(p.code)}</td><td>${e(p.name)}</td><td>${e(p.type)}</td><td>${e(p.group)}</td><td class="numeric">${p.terms || '—'}</td><td class="numeric">${p.limit ? money(p.limit) : '—'}</td><td class="numeric">${money(p.balance)}${asOf ? `<small class="secondary">current ${money(p.current)}</small>` : ''}</td><td>${badge(p.status, p.status === 'Active' ? 'good' : 'warn')}</td><td><button class="text-button" data-party-ledger="${e(p.name)}">Open</button></td></tr>`).join('') || '<tr><td colspan="9">No parties match these filters.</td></tr>'}</tbody>
          <tfoot><tr><td colspan="6">Totals shown · receivables ${money(receivable)} · payables ${money(payable)}</td><td class="numeric">${money(round2(rows.reduce((n, p) => n + p.balance, 0)))}</td><td colspan="2"></td></tr></tfoot>
        </table></div>
        <div class="table-footer">Balance is the party's position on its control account, read at the chosen date or today. <strong>Open</strong> leads to the general ledger with that party already filtered, so you can set the dates yourself. Click the row to edit the party.</div>
      </section>`;
  }

  function partyEditor(code) {
    const editingRow = code ? (PARTIES.find((p) => p.code === code) || {}) : {};
    const v = (key, fallback = '') => (editingRow[key] !== undefined ? editingRow[key] : fallback);
    return `<section class="panel">
      <div class="panel-head"><h2>${editingRow.code ? e(editingRow.name) : 'New party'}</h2><span class="badge">${editingRow.code ? `Editing ${e(editingRow.code)}` : 'Access is set here'}</span></div>
      <form data-party-form class="panel-body form-grid">
        <input type="hidden" name="editingCode" value="${e(editingRow.code || '')}">
        <label>Code<input name="code" required pattern="[A-Z0-9-]{2,20}" value="${e(v('code'))}" ${editingRow.code ? 'readonly' : ''} placeholder="CUS-130"></label>
        <label>Name<input name="name" required maxlength="70" value="${e(v('name'))}" placeholder="New customer"></label>
        <label>Type<select name="type" class="inline-input"><option value="customer" ${v('type') !== 'supplier' ? 'selected' : ''}>Customer</option><option value="supplier" ${v('type') === 'supplier' ? 'selected' : ''}>Supplier</option></select></label>
        <label>Group<input name="group" maxlength="30" value="${e(v('group'))}" placeholder="Wholesale"></label>
        <label>Contact person<input name="contact" maxlength="50" value="${e(v('contact'))}" placeholder="Finance manager"></label>
        <label>Phone<input name="phone" maxlength="30" value="${e(v('phone'))}" placeholder="+92 300 0000000"></label>
        <label>Email<input name="email" type="email" maxlength="70" value="${e(v('email'))}" placeholder="accounts@customer.pk"></label>
        <label>Currency<input name="currency" maxlength="3" value="${e(v('currency', 'PKR'))}"></label>
        <label>Payment terms (days)<input name="terms" type="number" min="0" max="365" value="${e(v('terms', '30'))}"></label>
        <label>Credit limit<input name="limit" inputmode="decimal" value="${e(v('limit', '0.00'))}"></label>
        <label>Opening balance<input name="opening" inputmode="decimal" value="${e(v('opening', '0.00'))}"></label>
        <label>Tax identity<input name="taxId" maxlength="30" value="${e(v('taxId'))}" placeholder="NTN-"></label>
        <label>Status<select name="status" class="inline-input"><option ${v('status', 'Active') === 'Active' ? 'selected' : ''}>Active</option><option ${v('status') === 'Hold' ? 'selected' : ''}>Hold</option><option ${v('status') === 'Blocked' ? 'selected' : ''}>Blocked</option></select></label>
        <label>Billing address<input name="address" maxlength="90" value="${e(v('address'))}" placeholder="Street, city"></label>
        <label class="wide">Notes<input name="notes" maxlength="120" value="${e(v('notes'))}" placeholder="Delivery instructions, special terms"></label>
        ${ms('party-projects', 'Allowed projects', PROJECTS.map((p) => [p.code, `${p.code} · ${p.name}`]), v('projects', []))}
        ${ms('party-locations', 'Allowed locations', LOCATIONS.map((l) => [l.code, `${l.code} · ${l.name}`]), v('locations', []))}
        <div class="related"><button class="button primary">${editingRow.code ? 'Save changes' : 'Add party'}</button><button type="button" class="button" data-form-cancel>Cancel</button></div>
      </form>
      <div class="panel-body"><p class="form-note">A customer or supplier is a sub-account of 1100 or 2100. The journal only offers a party where its account kind and its allowed projects and locations agree.</p></div>
    </section>`;
  }

  function bindParties(rerender, notify, navigate) {
    const goBack = () => navigate({module: 'accounting', tab: 'parties'});
    document.querySelectorAll('[data-edit]').forEach((b) => b.addEventListener('click', () => {
      const [type, code] = b.dataset.edit.split(':');
      if (type !== 'party') return;
      navigate({module: 'accounting', tab: 'parties', mode: 'editor', code});
    }));
    document.querySelectorAll('[data-party-ledger]').forEach((b) => b.addEventListener('click', (ev) => {
      ev.stopPropagation();
      GL.parties = [b.dataset.partyLedger];
      GL.q = '';
      navigate({module: 'accounting', tab: 'ledger'});
    }));
    document.querySelector('[data-party-form] [data-form-cancel]')?.addEventListener('click', goBack);
    document.querySelector('[data-party-form]')?.addEventListener('submit', (ev) => {
      ev.preventDefault();
      const form = ev.target;
      if (!form.reportValidity()) return;
      const v2 = Object.fromEntries(new FormData(form));
      const editingCode = v2.editingCode || '';
      if (!editingCode && PARTIES.some((p) => p.code === v2.code || p.name.trim().toLowerCase() === v2.name.trim().toLowerCase())) { notify('That code or name already exists.'); return; }
      const [proj, loc] = form.querySelectorAll('.ms');
      const record = {code: v2.code, name: v2.name.trim(), type: v2.type, group: v2.group || 'General', terms: Number(v2.terms) || 0, limit: round2(Number(v2.limit) || 0), opening: round2(Number(v2.opening) || 0), status: v2.status || 'Active', taxId: v2.taxId || '', contact: v2.contact || '', phone: v2.phone || '', email: v2.email || '', address: v2.address || '', currency: v2.currency || 'PKR', notes: v2.notes || '', projects: picked(proj), locations: picked(loc)};
      if (editingCode) {
        const target = PARTIES.find((p) => p.code === editingCode);
        if (target) Object.assign(target, record);
        notify('Party updated for this session.');
      } else {
        PARTIES.push(record);
        notify('Party added for this session. It is available in the journal and in payments.');
      }
      goBack();
    });
  }

  /* ----------------------------------------------------------- payments */
  function openItems(party) {
    if (!party) return [];
    const isCustomer = party.type === 'customer';
    const code = isCustomer ? '1100' : '2100';
    const docs = fixture(getCompany());
    return docs
      .filter((d) => d.party === party.name && (d.subtype === 'Invoice' || d.subtype === 'Bill'))
      .map((d) => {
        const total = round2(d.lines.filter((l) => l.account === code).reduce((n, l) => n + (isCustomer ? num(l.debit) - num(l.credit) : num(l.credit) - num(l.debit)), 0));
        const paid = round2(docs.filter((x) => x.againstVoucher === d.id).reduce((n, x) => n + x.lines.filter((l) => l.account === code).reduce((m, l) => m + (isCustomer ? num(l.credit) - num(l.debit) : num(l.debit) - num(l.credit)), 0), 0));
        return {id: d.id, date: d.date, total, paid: Math.min(paid, total), outstanding: round2(Math.max(total - paid, 0))};
      })
      .filter((x) => x.outstanding > 0)
      .sort((a, b) => a.date.localeCompare(b.date));
  }
  function autoAllocate(party, amount) {
    let left = round2(Number(amount) || 0);
    const rows = [];
    for (const item of openItems(party)) {
      if (left <= 0) break;
      const take = Math.min(left, item.outstanding);
      if (take > 0) { rows.push({id: item.id, amount: round2(take)}); left = round2(left - take); }
    }
    return {rows, left};
  }
  function paymentRows() {
    const isReceipt = (d) => d.lines.some((l) => ['1010', '1000', '1020'].includes(l.account) && num(l.debit) > 0);
    const fromFixture = fixture(getCompany()).filter((d) => d.source === 'Payment').map((d) => {
      const bank = d.lines.find((l) => ['1010', '1000', '1020'].includes(l.account));
      return {id: d.id, date: d.date, party: d.party, account: bank ? bank.party || '' : '', amount: round2(Math.abs(num(bank ? bank.debit : 0) - num(bank ? bank.credit : 0))), direction: isReceipt(d) ? 'receive' : 'pay', against: d.againstVoucher || '', session: false};
    });
    return PAYMENTS.concat(fromFixture).sort((a, b) => b.date.localeCompare(a.date) || b.id.localeCompare(a.id));
  }
  function paymentsView() {
    const all = paymentRows();
    const f = FILTERS.payments;
    const rows = all.filter((r) => hit(f.q, r.id, r.party, r.account, r.against, r.reference, r.method) && (!f.direction || r.direction === f.direction));
    const parties = PARTIES.filter((p) => (PAY_FORM.direction === 'receive' ? p.type === 'customer' : p.type === 'supplier'));
    const party = PARTIES.find((p) => p.name === PAY_FORM.party);
    const amount = round2(Number(PAY_FORM.amount) || 0);
    const allocation = party && amount ? autoAllocate(party, amount) : {rows: [], left: 0};
    const outstanding = party ? round2(openItems(party).reduce((n, x) => n + x.outstanding, 0)) : 0;
    const received = round2(rows.filter((r) => r.direction === 'receive').reduce((n, r) => n + r.amount, 0));
    const paid = round2(rows.filter((r) => r.direction === 'pay').reduce((n, r) => n + r.amount, 0));
    const kpi = (label, value, basis) => `<section class="stat"><span class="stat-label">${e(label)}</span><strong class="value numeric">${value}</strong><small>${e(basis)}</small></section>`;
    return `<div class="stats">
        ${kpi('Received', money(received), `${rows.filter((r) => r.direction === 'receive').length} receipts`)}
        ${kpi('Paid', money(paid), `${rows.filter((r) => r.direction === 'pay').length} payments`)}
        ${kpi('Open with this party', party ? money(outstanding) : '—', party ? party.name : 'Choose a party in the form')}
      </div>
      <form class="filterbar" data-filter="payments">
        ${filterInput('payments', f.q, 'Reference, party, account, document')}
        <label>Direction<select name="direction"><option value="">Both</option><option value="receive" ${f.direction === 'receive' ? 'selected' : ''}>Receipts</option><option value="pay" ${f.direction === 'pay' ? 'selected' : ''}>Payments</option></select></label>
        <button class="button" type="button" data-filter-reset="payments">Reset</button>
      </form>
      <section class="panel">
        <div class="panel-head"><h2>Receipts and payments</h2><span class="badge">${rows.length} of ${all.length} documents</span></div>
        <div class="table-scroll" data-hscroll><table>
          <thead><tr><th>Date</th><th>Reference</th><th>Direction</th><th>Party</th><th>Cash / bank account</th><th class="numeric">Amount</th><th>Against</th><th>State</th></tr></thead>
          <tbody>${rows.map((r) => `<tr><td>${e(r.date)}</td><td class="mono">${e(r.id)}</td><td>${badge(r.direction === 'receive' ? 'receipt' : 'payment', r.direction === 'receive' ? 'good' : '')}</td><td>${e(r.party)}</td><td>${e(r.account || '—')}</td><td class="numeric">${money(r.amount)}</td><td>${e(r.against || '—')}</td><td>${r.session ? badge('Session', 'plum') : badge('Posted', 'good')}</td></tr>`).join('') || '<tr><td colspan="8">No payments yet.</td></tr>'}</tbody>
          <tfoot><tr><td colspan="5">Total</td><td class="numeric">${money(received + paid)}</td><td colspan="2"></td></tr></tfoot>
        </table></div>
        <div class="table-footer">Money in is a receipt, money out is a payment. The document posts the bank or cash sub-account and the party control together; the allocation decides which open documents it settles and what remains as an advance.</div>
      </section>`;
  }

  function paymentEditor() {
    const parties = PARTIES.filter((p) => (PAY_FORM.direction === 'receive' ? p.type === 'customer' : p.type === 'supplier'));
    const party = PARTIES.find((p) => p.name === PAY_FORM.party);
    const amount = round2(Number(PAY_FORM.amount) || 0);
    const allocation = party && amount ? autoAllocate(party, amount) : {rows: [], left: 0};
    const outstanding = party ? round2(openItems(party).reduce((n, x) => n + x.outstanding, 0)) : 0;
    return `<section class="panel">
      <div class="panel-head"><h2>New receipt or payment</h2><span class="badge">${party ? e(party.name) : 'Choose a party'}</span></div>
      <form data-pay-form class="panel-body form-grid">
        <label>Direction<select name="direction" class="inline-input"><option value="receive" ${PAY_FORM.direction === 'receive' ? 'selected' : ''}>Receive money</option><option value="pay" ${PAY_FORM.direction === 'pay' ? 'selected' : ''}>Pay money</option></select></label>
        <label>Party<select name="party" class="inline-input" required><option value="">Choose a party</option>${parties.map((p) => `<option value="${e(p.name)}" ${p.name === PAY_FORM.party ? 'selected' : ''}>${e(p.name)} · ${e(p.code)}</option>`).join('')}</select></label>
        <label>Cash / bank<select name="account" class="inline-input" required><option value="">Choose a sub-account</option>${CASH_BANK.map((c) => `<option value="${e(c.name)}" ${c.name === PAY_FORM.account ? 'selected' : ''}>${e(c.name)} · ${e(c.control)}</option>`).join('')}</select></label>
        <label>Date<input name="date" type="date" value="2026-11-30" required></label>
        <label>Method<select name="method" class="inline-input"><option>Bank transfer</option><option>Cheque</option><option>Cash</option><option>Card</option><option>Online</option></select></label>
        <label>Reference<input name="reference" maxlength="40" placeholder="Cheque, transfer or slip"></label>
        <label>Instrument number<input name="instrument" maxlength="30" placeholder="Cheque / transaction number"></label>
        <label>Instrument date<input name="instrumentDate" type="date" value="2026-11-30"></label>
        <label>Amount<input name="amount" inputmode="decimal" value="${PAY_FORM.amount || ''}" placeholder="0.00" required></label>
        <label class="wide">Notes<input name="notes" maxlength="100" placeholder="What this money is for"></label>
        <div class="related"><button type="button" class="button" data-pay-calc>Show allocation</button><button class="button primary">Save for this session</button><button type="button" class="button" data-form-cancel>Cancel</button></div>
      </form>
      ${party ? `<div class="panel-body"><div class="section-title">Open documents · ${e(party.name)} · ${money(outstanding)} outstanding</div>
        <div class="table-scroll" data-hscroll><table>
          <thead><tr><th>Date</th><th>Document</th><th class="numeric">Total</th><th class="numeric">Settled</th><th class="numeric">Outstanding</th><th class="numeric">This payment</th></tr></thead>
          <tbody>${openItems(party).map((x) => { const hit = allocation.rows.find((a) => a.id === x.id); return `<tr><td>${e(x.date)}</td><td class="mono">${e(x.id)}</td><td class="numeric">${money(x.total)}</td><td class="numeric">${money(x.paid)}</td><td class="numeric">${money(x.outstanding)}</td><td class="numeric">${hit ? money(hit.amount) : '—'}</td></tr>`; }).join('') || '<tr><td colspan="6">Nothing open.</td></tr>'}</tbody>
          <tfoot><tr><td colspan="5">Allocated ${money(round2(amount - allocation.left))} · advance or unallocated ${money(allocation.left)}</td><td class="numeric">${money(amount)}</td></tr></tfoot>
        </table></div></div>` : ''}
      <div class="panel-body"><p class="form-note">The preview settles the oldest open documents first. Anything left over is an advance on account. Nothing in this build posts to the ledger; a saved document lives in this session only.</p></div>
    </section>`;
  }

  function capturePay(form) {
    const v = Object.fromEntries(new FormData(form));
    PAY_FORM = {direction: v.direction, party: v.party, account: v.account, amount: v.amount};
    return v;
  }
  function bindPayments(rerender, notify, navigate) {
    const goBack = () => navigate({module: 'accounting', tab: 'payments'});
    const form = document.querySelector('[data-pay-form]');
    if (!form) return;
    document.querySelector('[data-pay-form] [data-form-cancel]')?.addEventListener('click', goBack);
    form.addEventListener('submit', (ev) => {
      ev.preventDefault();
      if (!form.reportValidity()) return;
      const v = capturePay(form);
      const party = PARTIES.find((p) => p.name === v.party);
      if (!party) { notify('Choose a party first.'); return; }
      const amount = round2(Number(v.amount) || 0);
      if (amount <= 0) { notify('Enter an amount greater than zero.'); return; }
      const allocation = autoAllocate(party, amount);
      PAYMENTS.push({id: (v.direction === 'receive' ? 'RCT-' : 'PMT-') + String(200 + PAY_SEQ++), date: v.date, party: v.party, account: v.account, amount, direction: v.direction, method: v.method || '', reference: v.reference || '', instrument: v.instrument || '', instrumentDate: v.instrumentDate || '', notes: v.notes || '', against: allocation.rows.map((a) => a.id).join(', '), allocations: allocation.rows, advance: allocation.left, session: true});
      notify(`Saved for this session: ${allocation.rows.length} documents settled${allocation.left ? `, ${allocation.left.toFixed(2)} left as an advance` : ''}.`);
      PAY_FORM = {direction: 'receive', party: '', account: '', amount: ''};
      goBack();
    });
    form.addEventListener('change', (ev) => {
      if (!ev.target.matches('select')) return;
      capturePay(form);
      rerender();
    });
    form.querySelector('[data-pay-calc]')?.addEventListener('click', () => { capturePay(form); rerender(); });
  }

  /* -------------------------------------------------- invoices and bills */
  const invKey = (kind) => (kind === 'sales' ? 'sales' : 'purchase');
  const INV_DRAFT = {
    sales: {party: '', date: '2026-11-30', due: '2026-12-30', terms: '30', reference: '', location: 'HQ', narration: 'Service invoiced', notes: '', lines: [
      {account: '4000', description: 'Service', qty: '1', price: '0.00'},
      {account: '4000', description: '', qty: '1', price: '0.00'},
      {account: '4000', description: '', qty: '1', price: '0.00'},
    ]},
    purchase: {party: '', date: '2026-11-30', due: '2026-12-30', terms: '30', reference: '', location: 'HQ', narration: 'Supplier bill', notes: '', lines: [
      {account: '5000', description: 'Service', qty: '1', price: '0.00'},
      {account: '5000', description: '', qty: '1', price: '0.00'},
      {account: '5000', description: '', qty: '1', price: '0.00'},
    ]},
  };

  function invoiceTotals(kind, lines) {
    const rate = kind === 'sales' ? 10 : 10;
    const net = round2(lines.reduce((n, l) => n + (Number(l.qty) || 0) * (Number(l.price) || 0), 0));
    const tax = round2((net * rate) / 100);
    return {net, tax, gross: round2(net + tax), rate};
  }
  function invoiceRows(kind) {
    const isSales = kind === 'sales';
    const control = isSales ? '1100' : '2100';
    const fromFixture = fixture(getCompany())
      .filter((d) => (isSales ? d.subtype === 'Invoice' : d.subtype === 'Bill'))
      .map((d) => {
        const net = round2(d.lines.filter((l) => (isSales ? String(l.account).startsWith('4') : String(l.account).startsWith('5'))).reduce((n, l) => n + (isSales ? num(l.credit) - num(l.debit) : num(l.debit) - num(l.credit)), 0));
        const tax = round2(d.lines.filter((l) => l.account === (isSales ? '2200' : '1300')).reduce((n, l) => n + (isSales ? num(l.credit) - num(l.debit) : num(l.debit) - num(l.credit)), 0));
        const gross = round2(d.lines.filter((l) => l.account === control).reduce((n, l) => n + (isSales ? num(l.debit) - num(l.credit) : num(l.credit) - num(l.debit)), 0));
        const due = new Date(new Date(d.date + 'T00:00:00Z').getTime() + 30 * 86400000).toISOString().slice(0, 10);
        return {id: d.id, date: d.date, party: d.party, due, net, tax, gross, session: false};
      });
    const session = INVOICES.filter((x) => x.kind === kind).map((x) => ({id: x.id, date: x.date, party: x.party, due: x.due, net: x.net, tax: x.tax, gross: x.gross, session: true}));
    return session.concat(fromFixture).sort((a, b) => b.date.localeCompare(a.date) || b.id.localeCompare(a.id));
  }
  function invoicesView(kind) {
    const isSales = kind === 'sales';
    const f = FILTERS.invoices;
    const draft = INV_DRAFT[invKey(kind)];
    const all = invoiceRows(kind);
    const rows = all.filter((r) => hit(f.q, r.id, r.party, r.date, r.due));
    const totals = invoiceTotals(kind, draft.lines);
    const parties = PARTIES.filter((p) => (isSales ? p.type === 'customer' : p.type === 'supplier'));
    const open = round2(rows.reduce((n, r) => n + r.gross, 0));
    const kpi = (label, value, basis) => `<section class="stat"><span class="stat-label">${e(label)}</span><strong class="value numeric">${value}</strong><small>${e(basis)}</small></section>`;
    return `<div class="stats">
        ${kpi(isSales ? 'Invoiced' : 'Billed', money(open), `${rows.length} documents`)}
        ${kpi(isSales ? 'Receivable' : 'Payable', money(Math.abs(ledgerBalance(isSales ? '1100' : '2100'))), 'Control account balance')}
        ${kpi('In this draft', money(totals.gross), 'Net plus tax')}
      </div>
      <form class="filterbar" data-filter="invoices">
        ${filterInput('invoices', f.q, 'Number, party, date')}
        <button class="button" type="button" data-filter-reset="invoices">Reset</button>
      </form>
      <section class="panel">
        <div class="panel-head"><h2>${isSales ? 'Sales invoices' : 'Purchase invoices'}</h2><span class="badge">${rows.length} of ${all.length} documents</span></div>
        <div class="table-scroll" data-hscroll><table>
          <thead><tr><th>Date</th><th>Number</th><th>${isSales ? 'Customer' : 'Supplier'}</th><th>Due</th><th class="numeric">Net</th><th class="numeric">Tax</th><th class="numeric">Gross</th><th>State</th></tr></thead>
          <tbody>${rows.map((r) => `<tr><td>${e(r.date)}</td><td class="mono">${e(r.id)}</td><td>${e(r.party)}</td><td>${e(r.due || '—')}</td><td class="numeric">${money(r.net)}</td><td class="numeric">${money(r.tax)}</td><td class="numeric">${money(r.gross)}</td><td>${r.session ? badge('Session', 'plum') : badge('Posted', 'good')}</td></tr>`).join('') || '<tr><td colspan="8">No documents yet.</td></tr>'}</tbody>
          <tfoot><tr><td colspan="4">Total</td><td class="numeric">${money(round2(rows.reduce((n, r) => n + r.net, 0)))}</td><td class="numeric">${money(round2(rows.reduce((n, r) => n + r.tax, 0)))}</td><td class="numeric">${money(open)}</td><td></td></tr></tfoot>
        </table></div>
        <div class="table-footer">${isSales ? 'A posted invoice debits receivables and credits income plus output tax.' : 'A posted bill debits expense and input tax and credits payables.'} Session documents exist only in this browser.</div>
      </section>
    </section>`;
  }

  function invoiceEditor(kind) {
    const isSales = kind === 'sales';
    const draft = INV_DRAFT[invKey(kind)];
    const totals = invoiceTotals(kind, draft.lines);
    const parties = PARTIES.filter((p) => (isSales ? p.type === 'customer' : p.type === 'supplier'));
    return `<section class="panel">
      <div class="panel-head"><h2>${isSales ? 'Sales invoice' : 'Purchase bill'}</h2><span class="badge">Tax ${totals.rate}%</span></div>
      <form data-invoice-form="${kind}" class="panel-body form-grid">
        <label>${isSales ? 'Customer' : 'Supplier'}<select name="party" class="inline-input" required><option value="">Choose a party</option>${parties.map((p) => `<option value="${e(p.name)}" ${p.name === draft.party ? 'selected' : ''}>${e(p.name)} · ${e(p.code)}</option>`).join('')}</select></label>
        <label>Date<input name="date" type="date" value="${e(draft.date)}" required></label>
        <label>Due date<input name="due" type="date" value="${e(draft.due)}" required></label>
        <label>Terms (days)<input name="terms" type="number" min="0" max="365" value="${e(draft.terms || '30')}"></label>
        <label>${isSales ? 'Customer reference' : 'Supplier invoice no'}<input name="reference" maxlength="40" value="${e(draft.reference || '')}" placeholder="PO or their document number"></label>
        <label>Location<select name="location" class="inline-input">${LOCATIONS.map((l) => `<option value="${e(l.code)}" ${e(l.code) === (draft.location || 'HQ') ? 'selected' : ''}>${e(l.code)} · ${e(l.name)}</option>`).join('')}</select></label>
        <label>Narration<input name="narration" maxlength="80" value="${e(draft.narration)}"></label>
        <label class="wide">Notes<input name="notes" maxlength="100" value="${e(draft.notes || '')}" placeholder="What the document covers"></label>
      </form>
      <div class="table-scroll"><table class="invoice-lines">
        <thead><tr><th>Line</th><th>Account</th><th>Description</th><th class="numeric">Qty</th><th class="numeric">Unit price</th><th class="numeric">Net</th></tr></thead>
        <tbody>${draft.lines.map((l, i) => `<tr data-inv-line="${i}"><td>${i + 1}</td><td><select class="inline-input" data-inv-field="account">${accounts().filter((a) => (isSales ? a.type === 'income' : a.type === 'expense')).map((a) => `<option value="${a.code}" ${a.code === l.account ? 'selected' : ''}>${a.code} · ${e(a.name)}</option>`).join('')}</select></td><td><input data-inv-field="description" value="${e(l.description)}" aria-label="Line ${i + 1} description"></td><td><input class="numeric" data-inv-field="qty" value="${e(l.qty)}" inputmode="decimal" aria-label="Line ${i + 1} quantity"></td><td><input class="numeric" data-inv-field="price" value="${e(l.price)}" inputmode="decimal" aria-label="Line ${i + 1} unit price"></td><td class="numeric">${money((Number(l.qty) || 0) * (Number(l.price) || 0))}</td></tr>`).join('')}</tbody>
        <tfoot><tr><td colspan="5">Net ${money(totals.net)} · tax ${money(totals.tax)} · gross <strong>${money(totals.gross)}</strong></td><td class="numeric">${money(totals.gross)}</td></tr></tfoot>
      </table></div>
      <div class="panel-body"><div class="related"><button type="button" class="button" data-inv-calc>Calculate</button><button type="button" class="button primary" data-inv-save>Save for this session</button><button type="button" class="button" data-form-cancel>Cancel</button></div>
        <p class="form-note">Enter quantity and price, then Calculate to refresh the totals. A saved document is numbered in the session series and appears in the register; no ledger entry is written in this build.</p></div>
    </section>`;
  }

  function captureInvoice(kind, root) {
    const form = root.querySelector('[data-invoice-form]');
    const draft = INV_DRAFT[invKey(kind)];
    if (!form) return draft;
    const v = Object.fromEntries(new FormData(form));
    const lines = [...root.querySelectorAll('[data-inv-line]')].map((tr) => ({
      account: tr.querySelector('[data-inv-field="account"]').value,
      description: tr.querySelector('[data-inv-field="description"]').value,
      qty: tr.querySelector('[data-inv-field="qty"]').value,
      price: tr.querySelector('[data-inv-field="price"]').value,
    }));
    Object.assign(draft, {party: v.party, date: v.date, due: v.due, terms: v.terms, reference: v.reference, location: v.location, narration: v.narration, notes: v.notes, lines});
    return draft;
  }
  function bindInvoices(kind, rerender, notify, navigate) {
    const goBack = () => navigate({module: 'accounting', tab: kind === 'sales' ? 'sales-invoices' : 'purchase-invoices'});
    const root = document.querySelector(`[data-invoice-form="${kind}"]`)?.closest('section');
    if (!root) return;
    root.querySelector('[data-form-cancel]')?.addEventListener('click', goBack);
    root.querySelector('[data-inv-calc]')?.addEventListener('click', () => { captureInvoice(kind, root); rerender(); });
    root.querySelector('[data-inv-save]')?.addEventListener('click', () => {
      const draft = captureInvoice(kind, root);
      if (!draft.party) { notify('Choose a party first.'); return; }
      const totals = invoiceTotals(kind, draft.lines);
      if (totals.net <= 0) { notify('Enter at least one line with a quantity and a price.'); return; }
      INVOICES.push({id: (kind === 'sales' ? 'SI-2026-' : 'PI-2026-') + String(300 + INV_SEQ++), kind, party: draft.party, date: draft.date, due: draft.due, terms: draft.terms, reference: draft.reference, location: draft.location, narration: draft.narration, notes: draft.notes, lines: draft.lines, net: totals.net, tax: totals.tax, gross: totals.gross, session: true});
      notify(`Saved for this session: ${draft.party} · gross ${totals.gross.toFixed(2)}.`);
      INV_DRAFT[invKey(kind)] = {...INV_DRAFT[invKey(kind)], party: '', lines: INV_DRAFT[invKey(kind)].lines.map((l) => ({...l, price: '0.00', qty: '1'}))};
      goBack();
    });
  }

  /* ------------------------------------------------------------- items */
  function itemsView() {
    const f = FILTERS.items;
    const rows = ITEMS.filter((i) => hit(f.q, i.code, i.name, i.group, i.unit, i.description));
    const accountName = (code) => (accounts().find((a) => a.code === code) || {}).name || code;
    const ruleName = (code) => (TAX_RULES.find((r) => r.code === code) || {}).name || 'No tax';
    const tracked = ITEMS.filter((i) => i.tracked).length;
    const editingRow = editRecord('item', ITEMS) || {};
    const v = (key, fallback = '') => (editingRow[key] !== undefined ? editingRow[key] : fallback);
    const kpi = (label, value, basis) => `<section class="stat"><span class="stat-label">${e(label)}</span><strong class="value numeric">${value}</strong><small>${e(basis)}</small></section>`;
    return `<div class="stats">
        ${kpi('Items', String(ITEMS.length), 'Shared with Inventory')}
        ${kpi('Tracked', String(tracked), 'Inventory would value these')}
        ${kpi('Services', String(ITEMS.length - tracked), 'Never valued or counted')}
      </div>
      <form class="filterbar" data-filter="items">
        ${filterInput('items', f.q, 'Code, name, group, description')}
        <button class="button" type="button" data-filter-reset="items">Reset</button>
      </form>
      <section class="panel">
        <div class="panel-head"><h2>Items</h2><span class="badge">${rows.length} of ${ITEMS.length}</span></div>
        <div class="table-scroll" data-hscroll><table>
          <thead><tr><th>Code</th><th>Item</th><th>Group</th><th>Unit</th><th>Income head</th><th>Expense head</th><th>Sales tax</th><th>Purchase tax</th><th>Stock</th><th></th></tr></thead>
          <tbody>${rows.map((i) => `<tr class="row-link" data-edit="item:${e(i.code)}"><td class="mono">${e(i.code)}</td><td>${e(i.name)}</td><td>${e(i.group || 'General')}</td><td>${e(i.unit)}</td><td>${e(i.income)} · ${e(accountName(i.income))}</td><td>${e(i.expense)} · ${e(accountName(i.expense))}</td><td>${e(ruleName(i.salesTax || i.tax))}</td><td>${e(ruleName(i.purchaseTax || i.tax))}</td><td>${i.tracked ? badge('Tracked', 'good') : badge('Service')}</td><td class="row-go">›</td></tr>`).join('')}</tbody>
        </table></div>
        <div class="table-footer">The item master is shared with Inventory. Accounting stores the accounts and the tax default; Inventory owns quantity, valuation and movement. An item line appears in the ledger only when an invoice or bill is posted.</div>
      </section>
`;
  }

  function itemEditor(code) {
    const editingRow = code ? (ITEMS.find((i) => i.code === code) || {}) : {};
    const v = (key, fallback = '') => (editingRow[key] !== undefined ? editingRow[key] : fallback);
    return `<section class="panel">
      <div class="panel-head"><h2>${editingRow.code ? e(editingRow.name) : 'New item'}</h2><span class="badge">${editingRow.code ? `Editing ${e(editingRow.code)}` : 'Accounts and tax default'}</span></div>
      <form data-item-form class="panel-body form-grid">
        <input type="hidden" name="editingCode" value="${e(editingRow.code || '')}">
        <label>Code<input name="code" required pattern="[A-Z0-9-]{2,20}" value="${e(v('code'))}" ${editingRow.code ? 'readonly' : ''} placeholder="ITM-BOX"></label>
        <label>Name<input name="name" required maxlength="70" value="${e(v('name'))}" placeholder="Shipping box"></label>
        <label>Group<input name="group" maxlength="30" value="${e(v('group'))}" placeholder="Packaging"></label>
        <label>Unit<input name="unit" required maxlength="10" value="${e(v('unit', 'piece'))}"></label>
        <label class="wide">Description<input name="description" maxlength="120" value="${e(v('description'))}" placeholder="What the item is; prints on documents"></label>
        <label>Income head<select name="income" class="inline-input">${accounts().filter((a) => a.type === 'income').map((a) => `<option value="${a.code}" ${a.code === v('income', '4000') ? 'selected' : ''}>${a.code} · ${e(a.name)}</option>`).join('')}</select></label>
        <label>Expense head<select name="expense" class="inline-input">${accounts().filter((a) => a.type === 'expense').map((a) => `<option value="${a.code}" ${a.code === v('expense', '5000') ? 'selected' : ''}>${a.code} · ${e(a.name)}</option>`).join('')}</select></label>
        <label>Sales tax default<select name="salesTax" class="inline-input"><option value="">No tax</option>${TAX_RULES.filter((r) => r.kind === 'sales').map((r) => `<option value="${r.code}" ${r.code === v('salesTax', v('tax')) ? 'selected' : ''}>${e(r.name)} · ${r.rate}%</option>`).join('')}</select></label>
        <label>Purchase tax default<select name="purchaseTax" class="inline-input"><option value="">No tax</option>${TAX_RULES.filter((r) => r.kind === 'purchase').map((r) => `<option value="${r.code}" ${r.code === v('purchaseTax', v('tax')) ? 'selected' : ''}>${e(r.name)} · ${r.rate}%</option>`).join('')}</select></label>
        <label>Stock<select name="tracked" class="inline-input"><option value="no" ${v('tracked') ? '' : 'selected'}>Service or untracked</option><option value="yes" ${v('tracked') ? 'selected' : ''}>Tracked in Inventory</option></select></label>
        <label>Sale price<input name="salePrice" inputmode="decimal" value="${e(v('salePrice', '0.00'))}"></label>
        <label>Purchase price<input name="purchasePrice" inputmode="decimal" value="${e(v('purchasePrice', '0.00'))}"></label>
        <label>Status<select name="status" class="inline-input"><option ${v('status', 'Active') === 'Active' ? 'selected' : ''}>Active</option><option ${v('status') === 'Archived' ? 'selected' : ''}>Archived</option></select></label>
        <div class="related"><button class="button primary">${editingRow.code ? 'Save changes' : 'Add item'}</button><button type="button" class="button" data-form-cancel>Cancel</button></div>
      </form>
    </section>`;
  }

  function bindItems(rerender, notify, navigate) {
    const goBack = () => navigate({module: 'accounting', tab: 'items'});
    document.querySelectorAll('[data-edit]').forEach((b) => b.addEventListener('click', () => {
      const [type, code] = b.dataset.edit.split(':');
      if (type !== 'item') return;
      navigate({module: 'accounting', tab: 'items', mode: 'editor', code});
    }));
    document.querySelector('[data-item-form] [data-form-cancel]')?.addEventListener('click', goBack);
    document.querySelector('[data-item-form]')?.addEventListener('submit', (ev) => {
      ev.preventDefault();
      const form = ev.target;
      if (!form.reportValidity()) return;
      const v2 = Object.fromEntries(new FormData(form));
      const editingCode = v2.editingCode || '';
      if (!editingCode && ITEMS.some((i) => i.code === v2.code)) { notify('That item code already exists.'); return; }
      const record = {code: v2.code, name: v2.name, group: v2.group || 'General', unit: v2.unit, description: v2.description || '', income: v2.income, expense: v2.expense, tax: v2.salesTax || v2.tax, salesTax: v2.salesTax || '', purchaseTax: v2.purchaseTax || '', tracked: v2.tracked === 'yes', salePrice: round2(Number(v2.salePrice) || 0), purchasePrice: round2(Number(v2.purchasePrice) || 0), status: v2.status || 'Active'};
      if (editingCode) {
        const target = ITEMS.find((i) => i.code === editingCode);
        if (target) Object.assign(target, record);
        notify('Item updated for this session.');
      } else {
        ITEMS.push(record);
        notify('Item added for this session. Its accounts and tax default are ready for invoices.');
      }
      goBack();
    });
  }

  /* -------------------------------------------------------------- taxes */
  function taxRule(code) { return TAX_RULES.find((r) => r.code === code) || {}; }
  function taxLinesOf(kind) {
    const acc = kind === 'sales' ? '2200' : '1300';
    const out = [];
    for (const d of fixture(getCompany())) {
      const tax = d.lines.filter((l) => l.account === acc);
      if (!tax.length) continue;
      const base = round2(d.lines.filter((l) => (kind === 'sales' ? String(l.account).startsWith('4') : (String(l.account).startsWith('5') || String(l.account).startsWith('6'))))
        .reduce((n, l) => n + (kind === 'sales' ? num(l.credit) - num(l.debit) : num(l.debit) - num(l.credit)), 0));
      for (const l of tax) out.push({id: d.id, date: d.date, party: d.party, base, tax: round2(kind === 'sales' ? num(l.credit) - num(l.debit) : num(l.debit) - num(l.credit)), project: l.project || d.project || '', location: l.location || d.location || ''});
    }
    return out.sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
  }
  function taxRegisterPanel(kind) {
    const lines = taxLinesOf(kind);
    const base = round2(lines.reduce((n, l) => n + l.base, 0));
    const tax = round2(lines.reduce((n, l) => n + l.tax, 0));
    const effective = base ? round2((tax / base) * 100) : 0;
    return `<section class="panel">
      <div class="panel-head"><h2>${kind === 'sales' ? 'Output tax' : 'Input tax'} register</h2><span class="badge">${lines.length} tax lines</span></div>
      <div class="table-scroll" data-hscroll><table>
        <thead><tr><th>Date</th><th>Voucher</th><th>Party</th><th class="numeric">Base</th><th class="numeric">Tax</th><th>Project</th><th>Location</th></tr></thead>
        <tbody>${lines.map((l) => `<tr><td>${e(l.date)}</td><td><button class="text-button" data-ac="source" data-value="${e(l.id)}">${e(l.id)}</button></td><td>${e(l.party)}</td><td class="numeric">${money(l.base)}</td><td class="numeric">${money(l.tax)}</td><td>${e(l.project || '—')}</td><td>${e(l.location || '—')}</td></tr>`).join('') || '<tr><td colspan="7">No tax lines in this period.</td></tr>'}</tbody>
        <tfoot><tr><td colspan="3">Total · effective ${effective}%</td><td class="numeric">${money(base)}</td><td class="numeric">${money(tax)}</td><td colspan="2"></td></tr></tfoot>
      </table></div>
    </section>`;
  }
  function taxRulesPanel() {
    const f = FILTERS.tax;
    const rules = TAX_RULES.filter((r) => hit(f.q, r.code, r.name, r.kind, r.scope, r.description));
    const accountName = (code) => (accounts().find((a) => a.code === code) || {}).name || code;
    return `<form class="filterbar" data-filter="tax">
        ${filterInput('tax', f.q, 'Code, name, kind, scope')}
        <button class="button" type="button" data-filter-reset="tax">Reset</button>
      </form>
      <section class="panel">
      <div class="panel-head"><h2>Tax rules</h2><span class="badge">${rules.length} of ${TAX_RULES.length} rules</span></div>
      <div class="table-scroll" data-hscroll><table>
        <thead><tr><th>Code</th><th>Rule</th><th>Kind</th><th class="numeric">Rate</th><th>Basis</th><th>Account</th><th>Scope</th><th>Effective</th><th>Projects</th><th>Locations</th><th>Status</th><th></th></tr></thead>
        <tbody>${rules.map((r) => `<tr class="row-link" data-edit="tax:${e(r.code)}"><td class="mono">${e(r.code)}</td><td>${e(r.name)}${r.description ? `<small class="secondary">${e(r.description)}</small>` : ''}</td><td>${e(r.kind)}</td><td class="numeric">${r.rate}%</td><td>${e(r.basis)}</td><td>${e(r.account)} · ${e(accountName(r.account))}</td><td>${e(r.scope)}</td><td>${e(r.from)}${r.to ? ` → ${e(r.to)}` : ''}</td><td>${e(scopeText(r.projects))}</td><td>${e(scopeText(r.locations))}</td><td>${badge(r.status || 'Active', (r.status || 'Active') === 'Active' ? 'good' : 'warn')}</td><td class="row-go">›</td></tr>`).join('')}</tbody>
      </table></div>
      <div class="table-footer">A rule is a default. Any document line may override the rate or switch tax off. Withholding and advance rules post to their own liability and asset accounts. Click a row to open its form.</div>
    </section>`;
  }

  function taxEditor(code) {
    const editingRow = code ? (TAX_RULES.find((r) => r.code === code) || {}) : {};
    const v = (key, fallback = '') => (editingRow[key] !== undefined ? editingRow[key] : fallback);
    const ordering = (a, b) => Number(/tax/i.test(b.name)) - Number(/tax/i.test(a.name));
    return `<section class="panel">
      <div class="panel-head"><h2>${editingRow.code ? e(editingRow.name) : 'New tax rule'}</h2><span class="badge">${editingRow.code ? `Editing ${e(editingRow.code)}` : 'Blank access means all'}</span></div>
      <form data-tax-form class="panel-body form-grid">
        <input type="hidden" name="editingCode" value="${e(editingRow.code || '')}">
        <label>Code<input name="code" required pattern="[A-Z0-9-]{2,20}" value="${e(v('code'))}" ${editingRow.code ? 'readonly' : ''} placeholder="STD-SALE"></label>
        <label>Name<input name="name" required maxlength="70" value="${e(v('name'))}" placeholder="Sales tax 10%"></label>
        <label>Kind<select name="kind" class="inline-input"><option value="sales" ${v('kind', 'sales') === 'sales' ? 'selected' : ''}>Sales tax</option><option value="purchase" ${v('kind') === 'purchase' ? 'selected' : ''}>Purchase tax</option><option value="withholding" ${v('kind') === 'withholding' ? 'selected' : ''}>Withholding</option><option value="advance" ${v('kind') === 'advance' ? 'selected' : ''}>Advance tax</option></select></label>
        <label>Rate %<input name="rate" required inputmode="decimal" value="${e(v('rate', '10.00'))}"></label>
        <label>Basis<select name="basis" class="inline-input"><option value="exclusive" ${v('basis', 'exclusive') === 'exclusive' ? 'selected' : ''}>Tax exclusive</option><option value="inclusive" ${v('basis') === 'inclusive' ? 'selected' : ''}>Tax inclusive</option></select></label>
        <label>Account<select name="account" class="inline-input">${accounts().filter((a) => a.type === 'liability' || a.type === 'asset').sort(ordering).map((a) => `<option value="${a.code}" ${a.code === v('account', '2200') ? 'selected' : ''}>${a.code} · ${e(a.name)}</option>`).join('')}</select></label>
        <label>Scope<select name="scope" class="inline-input"><option value="all" ${v('scope', 'all') === 'all' ? 'selected' : ''}>Everything</option><option value="group" ${v('scope') === 'group' ? 'selected' : ''}>An item group</option><option value="item" ${v('scope') === 'item' ? 'selected' : ''}>One item or service</option></select></label>
        <label>Effective from<input name="from" type="date" value="${e(v('from', '2026-11-01'))}" required></label>
        <label>Effective to<input name="to" type="date" value="${e(v('to'))}"></label>
        <label>Status<select name="status" class="inline-input"><option ${v('status', 'Active') === 'Active' ? 'selected' : ''}>Active</option><option ${v('status') === 'Archived' ? 'selected' : ''}>Archived</option></select></label>
        <label>Override on a line<select name="override" class="inline-input"><option value="yes" ${v('override', 'yes') === 'yes' ? 'selected' : ''}>Allowed</option><option value="no" ${v('override') === 'no' ? 'selected' : ''}>Not allowed</option></select></label>
        <label class="wide">Description<input name="description" maxlength="100" value="${e(v('description'))}" placeholder="What the rule covers and where it comes from"></label>
        ${ms('tax-projects', 'Allowed projects', PROJECTS.map((p) => [p.code, `${p.code} · ${p.name}`]), v('projects', []))}
        ${ms('tax-locations', 'Allowed locations', LOCATIONS.map((l) => [l.code, `${l.code} · ${l.name}`]), v('locations', []))}
        <div class="related"><button class="button primary">${editingRow.code ? 'Save changes' : 'Add tax rule'}</button><button type="button" class="button" data-form-cancel>Cancel</button></div>
      </form>
      <div class="panel-body"><p class="form-note">Scope narrows where the rule is offered; the effective dates decide when it applies. Rules never post on their own — they fill a document line, and the document posts the tax.</p></div>
    </section>`;
  }

  function withholdingPanel() {
    const base = round2(fixture(getCompany()).filter((d) => d.date >= range().from && d.date <= range().to)
      .reduce((n, d) => n + d.lines.filter((l) => String(l.account).startsWith('5')).reduce((m, l) => m + num(l.debit) - num(l.credit), 0), 0));
    const recorded = ledgerBalance('2150');
    const rules = TAX_RULES.filter((r) => r.kind === 'withholding');
    const expected = round2(rules.reduce((n, r) => n + (base * r.rate) / 100, 0));
    return `<section class="panel">
      <div class="panel-head"><h2>Withholding</h2><span class="badge ${recorded === 0 && expected > 0 ? 'warn' : 'good'}">${recorded === 0 && expected > 0 ? 'Expected, nothing withheld yet' : 'Reconciled'}</span></div>
      <div class="table-scroll" data-hscroll><table>
        <thead><tr><th>Rule</th><th class="numeric">Rate</th><th class="numeric">Taxable base</th><th class="numeric">Expected</th><th class="numeric">Recorded</th><th class="numeric">Difference</th></tr></thead>
        <tbody>${rules.map((r) => `<tr><td>${e(r.name)}</td><td class="numeric">${r.rate}%</td><td class="numeric">${money(base)}</td><td class="numeric">${money((base * r.rate) / 100)}</td><td class="numeric">${money(recorded)}</td><td class="numeric">${money((base * r.rate) / 100 - recorded)}</td></tr>`).join('')}</tbody>
        <tfoot><tr><td>Total</td><td></td><td class="numeric">${money(base)}</td><td class="numeric">${money(expected)}</td><td class="numeric">${money(recorded)}</td><td class="numeric">${money(expected - recorded)}</td></tr></tfoot>
      </table></div>
      <div class="table-footer">Withholding is money we deduct from a supplier and owe to the authority; it is never ours. The expected column applies the rule to this period's expense base. Nothing is withheld in the fixture, so the liability is zero and the difference is shown rather than hidden.</div>
    </section>`;
  }
  function advancePanel() {
    const base = round2(fixture(getCompany()).filter((d) => d.date >= range().from && d.date <= range().to)
      .reduce((n, d) => n + d.lines.filter((l) => String(l.account).startsWith('4')).reduce((m, l) => m + num(l.credit) - num(l.debit), 0), 0));
    const recorded = ledgerBalance('1400');
    const rules = TAX_RULES.filter((r) => r.kind === 'advance');
    const expected = round2(rules.reduce((n, r) => n + (base * r.rate) / 100, 0));
    return `<section class="panel">
      <div class="panel-head"><h2>Advance tax</h2><span class="badge">${recorded === 0 && expected > 0 ? 'Expected, nothing recorded yet' : 'Reconciled'}</span></div>
      <div class="table-scroll" data-hscroll><table>
        <thead><tr><th>Rule</th><th class="numeric">Rate</th><th class="numeric">Taxable base</th><th class="numeric">Expected</th><th class="numeric">Recorded</th><th class="numeric">Difference</th></tr></thead>
        <tbody>${rules.map((r) => `<tr><td>${e(r.name)}</td><td class="numeric">${r.rate}%</td><td class="numeric">${money(base)}</td><td class="numeric">${money((base * r.rate) / 100)}</td><td class="numeric">${money(recorded)}</td><td class="numeric">${money((base * r.rate) / 100 - recorded)}</td></tr>`).join('')}</tbody>
        <tfoot><tr><td>Total</td><td></td><td class="numeric">${money(base)}</td><td class="numeric">${money(expected)}</td><td class="numeric">${money(recorded)}</td><td class="numeric">${money(expected - recorded)}</td></tr></tfoot>
      </table></div>
      <div class="table-footer">Advance tax is tax a customer deducts from our invoice and pays to the authority for us. It is our asset until a return claims it. The fixture records none, so the balance is zero and the gap is visible.</div>
    </section>`;
  }
  function taxReconPanel() {
    const out = round2(taxLinesOf('sales').reduce((n, l) => n + l.tax, 0));
    const inp = round2(taxLinesOf('purchase').reduce((n, l) => n + l.tax, 0));
    const rows = [
      ['2200 Output tax', out, Math.abs(ledgerBalance('2200'))],
      ['1300 Input tax', inp, Math.abs(ledgerBalance('1300'))],
      ['2150 Withholding payable', 0, Math.abs(ledgerBalance('2150'))],
      ['1400 Advance tax', 0, Math.abs(ledgerBalance('1400'))],
    ];
    return `<section class="panel">
      <div class="panel-head"><h2>Reconciliation</h2><span class="badge">${rows.every((r) => round2(r[1] - r[2]) === 0) ? 'Agrees' : 'Differences to review'}</span></div>
      <div class="table-scroll" data-hscroll><table>
        <thead><tr><th>Tax account</th><th class="numeric">Register</th><th class="numeric">Ledger</th><th class="numeric">Difference</th><th>Status</th></tr></thead>
        <tbody>${rows.map(([name, reg, led]) => { const diff = round2(reg - led); return `<tr><td>${e(name)}</td><td class="numeric">${money(reg)}</td><td class="numeric">${money(led)}</td><td class="numeric">${money(diff)}</td><td>${diff === 0 ? badge('Agrees', 'good') : badge('Review', 'warn')}</td></tr>`; }).join('')}</tbody>
      </table></div>
      <div class="table-footer">The register is built from the tax lines on documents; the ledger figure is the account balance. They must be equal. Withholding and advance show zero because the fixture records none — that is a visible gap, not a hidden one.</div>
    </section>`;
  }
  function taxPanel(id) {
    if (id === 'registers') return taxRegisterPanel('sales') + taxRegisterPanel('purchase');
    if (id === 'withholding') return withholdingPanel();
    if (id === 'advance') return advancePanel();
    if (id === 'adjustments') return taxReconPanel();
    return taxRulesPanel();
  }
  function taxesView() {
    const current = TAX_TABS.some(([k]) => k === TAX_ACTIVE) ? TAX_ACTIVE : 'rules';
    return `<div class="tabs" role="tablist" aria-label="Tax views">${TAX_TABS.map(([id, label]) => `<button role="tab" aria-selected="${current === id}" data-tax-tab="${id}">${label}</button>`).join('')}</div>
      <div id="tax-panel">${taxPanel(current)}</div>`;
  }
  function bindTaxes(rerender, notify, navigate) {
    const goBack = () => navigate({module: 'settings', tab: 'accounting'});
    document.querySelectorAll('[data-tax-tab]').forEach((btn) => btn.addEventListener('click', () => {
      TAX_ACTIVE = btn.dataset.taxTab;
      rerender();
    }));
    document.querySelectorAll('[data-edit]').forEach((b) => b.addEventListener('click', () => {
      const [type, code] = b.dataset.edit.split(':');
      if (type !== 'tax') return;
      navigate({module: 'accounting', tab: 'taxes', mode: 'editor', code});
    }));
    document.querySelector('[data-tax-form] [data-form-cancel]')?.addEventListener('click', goBack);
    document.querySelector('[data-tax-form]')?.addEventListener('submit', (ev) => {
      ev.preventDefault();
      const form = ev.target;
      if (!form.reportValidity()) return;
      const v = Object.fromEntries(new FormData(form));
      const editingCode = v.editingCode || '';
      if (!editingCode && TAX_RULES.some((r) => r.code === v.code)) { notify('That tax rule code already exists.'); return; }
      const [proj, loc] = form.querySelectorAll('.ms');
      const record = {code: v.code, name: v.name, kind: v.kind, rate: Number(v.rate), basis: v.basis, account: v.account, scope: v.scope, from: v.from, to: v.to || '', status: v.status || 'Active', override: v.override || 'yes', description: v.description || '', projects: picked(proj), locations: picked(loc)};
      if (editingCode) {
        const target = TAX_RULES.find((r) => r.code === editingCode);
        if (target) Object.assign(target, record);
        notify('Tax rule updated for this session.');
      } else {
        TAX_RULES.push(record);
        notify('Tax rule added for this session. It is available to documents from its effective date.');
      }
      goBack();
    });
  }

  /* ------------------------------------------------------------ reports */
  const REPORT_TABS = [['ageing', 'Ageing'], ['profit', 'Profit & loss'], ['position', 'Financial position'], ['cashflow', 'Cash flow'], ['equity', 'Equity']];
  const line = (label, value, cls = '') => `<div class="statement-line ${cls}"><span>${e(label)}</span><strong class="numeric">${value}</strong></div>`;

  function reportProfit() {
    const tb = rows();
    const income = tb.filter((a) => a.type === 'income');
    const expense = tb.filter((a) => a.type === 'expense');
    const amount = (a) => (a.type === 'income' ? round2(num(a.credit) - num(a.debit)) : round2(num(a.debit) - num(a.credit)));
    const totalIncome = round2(income.reduce((n, a) => n + amount(a), 0));
    const totalExpense = round2(expense.reduce((n, a) => n + amount(a), 0));
    const profit = round2(totalIncome - totalExpense);
    return `<section class="panel">
      <div class="panel-head"><h2>Profit & loss</h2><span class="badge">${e(range().from)} to ${e(range().to)}</span></div>
      <div class="panel-body">
        <div class="section-title">Income</div>
        ${income.map((a) => line(`${a.code} · ${a.name}`, money(amount(a)))).join('') || line('No income accounts', money(0))}
        ${line('Total income', money(totalIncome), 'total')}
        <div class="section-title">Expenses</div>
        ${expense.map((a) => line(`${a.code} · ${a.name}`, money(amount(a)))).join('') || line('No expense accounts', money(0))}
        ${line('Total expenses', money(totalExpense), 'total')}
        ${line('Result for the period', money(profit), 'total')}
      </div>
      <div class="table-footer">Built from the same ledger as the trial balance, so the totals cannot disagree. No statutory presentation, comparative or tax computation is implied.</div>
    </section>`;
  }

  function reportPosition() {
    const tb = rows();
    const value = (a) => round2(num(a.closingDebit) - num(a.closingCredit));
    const assets = tb.filter((a) => a.type === 'asset');
    const liabilities = tb.filter((a) => a.type === 'liability');
    const equity = tb.filter((a) => a.type === 'equity');
    const st = statements(fixture(getCompany()), range());
    const totalAssets = round2(assets.reduce((n, a) => n + value(a), 0));
    const totalLiabilities = round2(liabilities.reduce((n, a) => n - value(a), 0));
    const totalCapital = round2(equity.reduce((n, a) => n - value(a), 0));
    const accumulated = round2(num(st.accumulatedProfit));
    const totalEquity = round2(totalCapital + accumulated);
    const balanced = Math.abs(totalAssets - (totalLiabilities + totalEquity)) < 0.01;
    return `<section class="panel">
      <div class="panel-head"><h2>Financial position</h2><span class="badge ${balanced ? 'good' : 'warn'}">${balanced ? 'Assets = liabilities + equity' : 'Difference to investigate'}</span></div>
      <div class="panel-body">
        <div class="section-title">Assets</div>
        ${assets.map((a) => line(`${a.code} · ${a.name}`, money(value(a)))).join('')}
        ${line('Total assets', money(totalAssets), 'total')}
        <div class="section-title">Liabilities</div>
        ${liabilities.map((a) => line(`${a.code} · ${a.name}`, money(-value(a)))).join('')}
        ${line('Total liabilities', money(totalLiabilities), 'total')}
        <div class="section-title">Equity</div>
        ${equity.map((a) => line(`${a.code} · ${a.name}`, money(-value(a)))).join('')}
        ${line('Accumulated result', money(accumulated))}
        ${line('Total equity', money(totalEquity), 'total')}
      </div>
      <div class="table-footer">All history through ${e(range().to)}. Accumulated result is the income less expenses of every period, not just this one.</div>
    </section>`;
  }

  function reportCashflow() {
    const cashAcc = new Set(['1010', '1000', '1020']);
    const docs = fixture(getCompany());
    let opening = 0, inflow = 0, outflow = 0;
    const bySource = new Map();
    for (const d of docs) {
      const flow = round2(d.lines.filter((l) => cashAcc.has(l.account)).reduce((n, l) => n + num(l.debit) - num(l.credit), 0));
      if (d.date < range().from) { opening += flow; continue; }
      if (d.date > range().to) continue;
      inflow += d.lines.filter((l) => cashAcc.has(l.account)).reduce((n, l) => n + num(l.debit), 0);
      outflow += d.lines.filter((l) => cashAcc.has(l.account)).reduce((n, l) => n + num(l.credit), 0);
      bySource.set(d.source, round2((bySource.get(d.source) || 0) + flow));
    }
    inflow = round2(inflow); outflow = round2(outflow);
    const closing = round2(opening + inflow - outflow);
    return `<section class="panel">
      <div class="panel-head"><h2>Cash flow</h2><span class="badge">Direct, from the cash accounts</span></div>
      <div class="panel-body">
        ${line('Opening cash and bank', money(opening))}
        ${line('Receipts', money(inflow))}
        ${line('Payments', `(${money(outflow)})`)}
        ${line('Net movement', money(inflow - outflow), 'total')}
        ${line('Closing cash and bank', money(closing), 'total')}
        <div class="section-title">Net movement by document type</div>
        ${[...bySource.entries()].sort((a, b) => Math.abs(b[1]) - Math.abs(a[1])).map(([source, value]) => line(source, money(value))).join('')}
      </div>
      <div class="table-footer">Only accounts 1000, 1010 and 1020 are cash. Transfers between them cancel out. A full indirect statement would need working-capital schedules, which are not built.</div>
    </section>`;
  }

  function reportEquity() {
    const tb = rows();
    const value = (a) => round2(num(a.closingDebit) - num(a.closingCredit));
    const equity = tb.filter((a) => a.type === 'equity');
    const st = statements(fixture(getCompany()), range());
    const capital = round2(equity.reduce((n, a) => n - value(a), 0));
    const accumulated = round2(num(st.accumulatedProfit));
    return `<section class="panel">
      <div class="panel-head"><h2>Equity</h2><span class="badge">${equity.length} accounts</span></div>
      <div class="panel-body">
        ${equity.map((a) => line(`${a.code} · ${a.name}`, money(-value(a)))).join('')}
        ${line('Capital introduced', money(capital), 'total')}
        ${line('Accumulated result', money(accumulated))}
        ${line('Total equity', money(capital + accumulated), 'total')}
      </div>
      <div class="table-footer">Capital and accumulated result only. Dividends, drawings and equity movements would need their own accounts before they can appear here.</div>
    </section>`;
  }

  function reportsView() {
    const current = REPORT_TABS.some(([k]) => k === REPORT_TAB) ? REPORT_TAB : 'ageing';
    const body = current === 'profit' ? reportProfit() : current === 'position' ? reportPosition() : current === 'cashflow' ? reportCashflow() : current === 'equity' ? reportEquity() : ageing();
    return `<div class="tabs" role="tablist" aria-label="Report views">${REPORT_TABS.map(([id, label]) => `<button role="tab" aria-selected="${current === id}" data-report-tab="${id}">${label}</button>`).join('')}</div>
      <div id="report-panel">${body}</div>`;
  }

  function bindReports(rerender) {
    document.querySelectorAll('[data-report-tab]').forEach((b) => b.addEventListener('click', () => {
      REPORT_TAB = b.dataset.reportTab;
      rerender();
    }));
  }

  /* ------------------------------------------------------ period close */
  const CLOSE_STEPS = [
    ['tb', 'Trial balance agrees', 'Closing debits equal credits'],
    ['tax', 'Tax registers agree', 'Output and input tax against their control accounts'],
    ['ar', 'Party control schedules', 'Receivable and payable balances against the party ledgers'],
    ['bank', 'Bank and cash proof', 'Statement reconciliation is not built yet'],
    ['drafts', 'No unposted drafts', 'Drafts are visible in the journal register'],
    ['signoff', 'Named sign-off', 'The person who locks the period'],
  ];
  function closeView() {
    const tb = rows();
    const dr = round2(tb.reduce((n, a) => n + num(a.closingDebit), 0));
    const cr = round2(tb.reduce((n, a) => n + num(a.closingCredit), 0));
    const balanced = Math.abs(dr - cr) < 0.01;
    const kpi = (label, value, basis) => `<section class="stat"><span class="stat-label">${e(label)}</span><strong class="value numeric">${value}</strong><small>${e(basis)}</small></section>`;
    return `<div class="stats">
        ${kpi('Closing debit', money(dr), 'All heads')}
        ${kpi('Closing credit', money(cr), balanced ? 'Agrees' : 'Difference to investigate')}
        ${kpi('Period', 'Nov 2026', PERIOD_LOCKED ? 'Locked' : 'Open')}
      </div>
      <section class="panel">
        <div class="panel-head"><h2>Close checklist</h2><span class="badge ${balanced ? 'good' : 'warn'}">${balanced ? 'Trial balance agrees' : 'Trial balance differs'}</span></div>
        <div class="panel-body">
          <ul class="close-list">${CLOSE_STEPS.map(([id, title, detail]) => `<li><div><strong>${e(title)}</strong><small class="secondary">${e(detail)}</small></div><label class="check-inline"><input type="checkbox" data-close-step="${id}" ${id === 'tb' && balanced ? 'checked' : ''} ${PERIOD_LOCKED ? 'disabled' : ''}> Done</label></li>`).join('')}</ul>
        </div>
        <form class="panel-body form-grid" data-close-form>
          <label>Signed off by<input name="signoff" maxlength="60" placeholder="Name of the person closing" ${PERIOD_LOCKED ? 'disabled' : ''}></label>
          <label>Lock date<input name="lockdate" type="date" value="2026-11-30" ${PERIOD_LOCKED ? 'disabled' : ''}></label>
          <div class="related"><button class="button primary" data-close-lock ${PERIOD_LOCKED ? 'disabled' : ''}>${PERIOD_LOCKED ? 'Period locked' : 'Lock November 2026'}</button><button type="button" class="button" data-close-reopen ${PERIOD_LOCKED ? '' : 'disabled'}>Reopen for this session</button></div>
        </form>
        <div class="panel-body"><p class="form-note">Locking is a session state here. In the real build it writes an immutable close record, blocks posting into the period and requires the business administrator to reopen with a reason. Bank reconciliation is the one checklist line that cannot be ticked yet.</p></div>
      </section>`;
  }
  function bindClose(rerender, notify) {
    document.querySelector('[data-close-lock]')?.addEventListener('click', () => {
      if (!document.querySelector('[data-close-form]')?.reportValidity()) return;
      if (!document.querySelector('[data-close-step="signoff"]')?.checked) {
        document.querySelector('[data-close-step="signoff"]').checked = true;
        rerender();
        notify('Signed off. Lock the period now.');
        return;
      }
      PERIOD_LOCKED = true;
      notify('November 2026 locked for this session. Posting into it should now be refused.');
      rerender();
    });
    document.querySelector('[data-close-reopen]')?.addEventListener('click', () => {
      PERIOD_LOCKED = false;
      notify('Period reopened for this session. A real reopen needs a reason and an administrator.');
      rerender();
    });
  }

  /* ----------------------------------------------------------- settings */
  const SETTINGS_TABS = [['company', 'Company'], ['accounting', 'Accounting'], ['people', 'People & access'], ['periods', 'Periods'], ['forms', 'Forms & fields'], ['views', 'Saved views'], ['print', 'Print & templates']];
  const field = (label, value, hint = '', name = '') => `<label>${e(label)}<input ${name ? `name="${name}"` : ''} value="${e(value)}">${hint ? `<small class="secondary">${e(hint)}</small>` : ''}</label>`;
  /* -------------------------------------- settings master-data editors */
  function accountEditor(code) {
    const a = code ? (accounts().find((x) => x.code === code) || {}) : {};
    const v = (k, d = '') => (a[k] !== undefined ? a[k] : d);
    return `<section class="panel">
      <div class="panel-head"><h2>${a.code ? e(a.name) : 'New accounting head'}</h2><span class="badge">${a.code ? `Editing ${e(a.code)}` : 'Adds to the chart'}</span></div>
      <form data-settings-form="heads" class="panel-body form-grid">
        <input type="hidden" name="editingCode" value="${e(a.code || '')}">
        <label>Code<input name="code" required pattern="[0-9]{4,8}" value="${e(v('code'))}" ${a.code ? 'readonly' : ''} placeholder="5100"></label>
        <label>Name<input name="name" required maxlength="80" value="${e(v('name'))}" placeholder="Marketing expense"></label>
        <label>Accounting head<select name="type" class="inline-input">${['expense', 'income', 'asset', 'liability', 'equity'].map((t) => `<option value="${t}" ${v('type', 'expense') === t ? 'selected' : ''}>${t}</option>`).join('')}</select></label>
        <label>Accounting group<select name="group" class="inline-input">${['Assets', 'Liabilities', 'Equity', 'Income', 'Expenses'].map((g) => `<option value="${g}" ${(v('group') || '').toLowerCase().startsWith(g.slice(0, 5).toLowerCase()) ? 'selected' : ''}>${g}</option>`).join('')}</select></label>
        <label>Control<select name="control" class="inline-input">${[['', 'Ordinary posting account'], ['receivable', 'Receivable control — customer on every line'], ['payable', 'Payable control — supplier on every line'], ['bank', 'Bank control — needs a bank sub-account'], ['cash', 'Cash control — needs a cash sub-account']].map(([k, l]) => `<option value="${k}" ${v('control') === k ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
        <label class="wide">Description<input name="description" maxlength="100" value="${e(v('description'))}" placeholder="What this head is used for"></label>
        <label>State<select name="status" class="inline-input"><option ${v('active', true) ? 'selected' : ''}>Active</option><option ${v('active', true) ? '' : 'selected'}>Archived</option></select></label>
        <div class="related"><button class="button primary">${a.code ? 'Save changes' : 'Add head'}</button><button type="button" class="button" data-settings-cancel>Cancel</button></div>
      </form>
      <div class="panel-body"><p class="form-note">The class decides where the head sits in the trial balance; the control flag decides whether every line needs a party. A new head is available in the chart, the journal picker and the reports immediately.</p></div>
    </section>`;
  }

  function projectEditorForm(code) {
    const p = code ? (PROJECTS.find((x) => x.code === code) || {}) : {};
    const v = (k, d = '') => (p[k] !== undefined ? p[k] : d);
    return `<section class="panel">
      <div class="panel-head"><h2>${p.code ? e(p.name) : 'New project'}</h2><span class="badge">${p.code ? `Editing ${e(p.code)}` : 'Data field'}</span></div>
      <form data-settings-form="project" class="panel-body form-grid">
        <input type="hidden" name="editingCode" value="${e(p.code || '')}">
        <label>Code<input name="code" required pattern="[A-Z0-9-]{2,20}" value="${e(v('code'))}" ${p.code ? 'readonly' : ''} placeholder="PRJ-NORTH"></label>
        <label>Name<input name="name" required maxlength="60" value="${e(v('name'))}" placeholder="North depot"></label>
        <label>Manager<input name="manager" maxlength="40" value="${e(v('manager'))}"></label>
        <label>State<select name="status" class="inline-input">${['active', 'on hold', 'closed'].map((x) => `<option value="${x}" ${v('status', 'active') === x ? 'selected' : ''}>${x}</option>`).join('')}</select></label>
        <label>Start date<input name="start" type="date" value="${e(v('start'))}"></label>
        <label>End date<input name="end" type="date" value="${e(v('end'))}"></label>
        <label>Budget<input name="budget" inputmode="decimal" value="${e(v('budget', '0.00'))}"></label>
        <label class="wide">Description<input name="description" maxlength="100" value="${e(v('description'))}"></label>
        <div class="related"><button class="button primary">${p.code ? 'Save changes' : 'Add project'}</button><button type="button" class="button" data-settings-cancel>Cancel</button></div>
      </form>
    </section>`;
  }

  function locationEditorForm(code) {
    const l = code ? (LOCATIONS.find((x) => x.code === code) || {}) : {};
    const v = (k, d = '') => (l[k] !== undefined ? l[k] : d);
    return `<section class="panel">
      <div class="panel-head"><h2>${l.code ? e(l.name) : 'New location'}</h2><span class="badge">${l.code ? `Editing ${e(l.code)}` : 'A branch is a kind'}</span></div>
      <form data-settings-form="location" class="panel-body form-grid">
        <input type="hidden" name="editingCode" value="${e(l.code || '')}">
        <label>Code<input name="code" required pattern="[A-Z0-9-]{2,20}" value="${e(v('code'))}" ${l.code ? 'readonly' : ''} placeholder="BR-KHI-03"></label>
        <label>Name<input name="name" required maxlength="60" value="${e(v('name'))}" placeholder="Saddar branch"></label>
        <label>Kind<select name="kind" class="inline-input">${['branch', 'office', 'outlet', 'warehouse', 'site'].map((x) => `<option value="${x}" ${v('kind', 'branch') === x ? 'selected' : ''}>${x}</option>`).join('')}</select></label>
        <label>Address<input name="address" maxlength="80" value="${e(v('address'))}"></label>
        <label>Contact<input name="contact" maxlength="50" value="${e(v('contact'))}"></label>
        <label>Phone<input name="phone" maxlength="30" value="${e(v('phone'))}"></label>
        <label class="wide">Notes<input name="notes" maxlength="100" value="${e(v('notes'))}"></label>
        <div class="related"><button class="button primary">${l.code ? 'Save changes' : 'Add location'}</button><button type="button" class="button" data-settings-cancel>Cancel</button></div>
      </form>
    </section>`;
  }

  function groupEditor(kind, code) {
    const list = kind === 'party' ? PARTY_GROUPS : ITEM_GROUPS;
    const g = code ? (list.find((x) => x.code === code) || {}) : {};
    const v = (k, d = '') => (g[k] !== undefined ? g[k] : d);
    return `<section class="panel">
      <div class="panel-head"><h2>${g.code ? e(g.name) : kind === 'party' ? 'New party group' : 'New item group'}</h2><span class="badge">${g.code ? `Editing ${e(g.code)}` : 'Group'}</span></div>
      <form data-settings-form="${kind === 'party' ? 'partygroups' : 'itemgroups'}" class="panel-body form-grid">
        <input type="hidden" name="editingCode" value="${e(g.code || '')}">
        <label>Code<input name="code" required pattern="[A-Z0-9-]{2,20}" value="${e(v('code'))}" ${g.code ? 'readonly' : ''} placeholder="RET"></label>
        <label>Name<input name="name" required maxlength="50" value="${e(v('name'))}" placeholder="Retail"></label>
        ${kind === 'party' ? `<label>Applies to<select name="kind" class="inline-input">${[['customer', 'Customers'], ['supplier', 'Suppliers'], ['both', 'Both']].map(([k, l]) => `<option value="${k}" ${v('kind', 'both') === k ? 'selected' : ''}>${l}</option>`).join('')}</select></label>` : ''}
        <label class="wide">Description<input name="description" maxlength="100" value="${e(v('description'))}"></label>
        <div class="related"><button class="button primary">${g.code ? 'Save changes' : 'Add group'}</button><button type="button" class="button" data-settings-cancel>Cancel</button></div>
      </form>
    </section>`;
  }

  function chartAccountEditor(code) {
    const a = code ? (accounts().find((x) => x.code === code) || {}) : {};
    const v = (k, d = '') => (a[k] !== undefined ? a[k] : d);
    return `<section class="panel">
      <div class="panel-head"><h2>${a.code ? e(a.name) : 'New account'}</h2><span class="badge">${a.code ? `Editing ${e(a.code)}` : 'Adds to the chart'}</span></div>
      <form data-chart-form class="panel-body form-grid">
        <input type="hidden" name="editingCode" value="${e(a.code || '')}">
        <label>Code<input name="code" required pattern="[0-9]{4,8}" value="${e(v('code'))}" ${a.code ? 'readonly' : ''} placeholder="5100"></label>
        <label>Name<input name="name" required maxlength="80" value="${e(v('name'))}" placeholder="Marketing expense"></label>
        <label>Accounting head<select name="type" class="inline-input">${['expense', 'income', 'asset', 'liability', 'equity'].map((t) => `<option value="${t}" ${v('type', 'expense') === t ? 'selected' : ''}>${t}</option>`).join('')}</select></label>
        <label>Accounting group<select name="group" class="inline-input">${['Assets', 'Liabilities', 'Equity', 'Income', 'Expenses'].map((g) => `<option value="${g}" ${(v('group') || '').toLowerCase().startsWith(g.slice(0, 5).toLowerCase()) ? 'selected' : ''}>${g}</option>`).join('')}</select></label>
        <label>Control<select name="control" class="inline-input">${[['', 'Ordinary posting account'], ['receivable', 'Receivable control — customer on every line'], ['payable', 'Payable control — supplier on every line'], ['bank', 'Bank control — needs a bank sub-account'], ['cash', 'Cash control — needs a cash sub-account']].map(([k, l]) => `<option value="${k}" ${v('control') === k ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
        <label class="wide">Description<input name="description" maxlength="100" value="${e(v('description'))}" placeholder="What this account is used for"></label>
        <label>State<select name="status" class="inline-input"><option ${v('active', true) ? 'selected' : ''}>Active</option><option ${v('active', true) ? '' : 'selected'}>Archived</option></select></label>
        <div class="related"><button class="button primary">${a.code ? 'Save changes' : 'Add account'}</button><button type="button" class="button" data-chart-cancel>Cancel</button></div>
      </form>
      <div class="panel-body"><p class="form-note">The class decides the trial balance section; the control flag decides whether every line needs a party or sub-account. A new account is available in the journal picker immediately.</p></div>
    </section>`;
  }

  function bindChartAccount(rerender, notify, navigate) {
    const back = () => navigate({module: 'accounting', tab: 'coa'});
    document.querySelector('[data-chart-cancel]')?.addEventListener('click', back);
    document.querySelector('[data-chart-form]')?.addEventListener('submit', (ev) => {
      ev.preventDefault();
      const form = ev.target;
      if (!form.reportValidity()) return;
      const v = Object.fromEntries(new FormData(form));
      const editing = v.editingCode || '';
      if (!editing && accounts().some((a) => a.code === v.code)) { notify('That account code already exists.'); return; }
      const group = {asset: 'Assets', liability: 'Liabilities', equity: 'Equity', income: 'Income', expense: 'Expenses'}[v.type];
      const record = {code: v.code, name: v.name, type: v.type, group, control: v.control || '', description: v.description || '', currency: 'PKR', active: v.status === 'Active'};
      if (editing) { const target = accounts().find((a) => a.code === editing); if (target) Object.assign(target, record); notify('Account updated for this session.'); }
      else { accounts().push(record); notify('Account added for this session.'); }
      back();
    });
  }

  function centreEditorForm(code) {
    const c = code ? (COST_CENTRES.find((x) => x.code === code) || {}) : {};
    const v = (k, d = '') => (c[k] !== undefined ? c[k] : d);
    return `<section class="panel">
      <div class="panel-head"><h2>${c.code ? e(c.name) : 'New cost centre'}</h2><span class="badge">${c.code ? `Editing ${e(c.code)}` : 'Data field'}</span></div>
      <form data-settings-form="centre" class="panel-body form-grid">
        <input type="hidden" name="editingCode" value="${e(c.code || '')}">
        <label>Code<input name="code" required pattern="[A-Z0-9-]{2,20}" value="${e(v('code'))}" ${c.code ? 'readonly' : ''} placeholder="CC-ADM"></label>
        <label>Name<input name="name" required maxlength="50" value="${e(v('name'))}" placeholder="Administration"></label>
        <label>State<select name="status" class="inline-input"><option ${v('archived') ? '' : 'selected'}>Active</option><option ${v('archived') ? 'selected' : ''}>Archived</option></select></label>
        <label class="wide">Description<input name="description" maxlength="100" value="${e(v('description'))}"></label>
        <div class="related"><button class="button primary">${c.code ? 'Save changes' : 'Add cost centre'}</button><button type="button" class="button" data-settings-cancel>Cancel</button></div>
      </form>
    </section>`;
  }

  function settingsEditor(form, code) {
    if (form === 'heads') return accountEditor(code);
    if (form === 'project') return projectEditorForm(code);
    if (form === 'location') return locationEditorForm(code);
    if (form === 'partygroups') return groupEditor('party', code);
    if (form === 'itemgroups') return groupEditor('item', code);
    if (form === 'centre') return centreEditorForm(code);
    if (form === 'tax') return taxEditor(code);
    return `<section class="panel"><div class="panel-head"><h2>Unknown form</h2></div><div class="panel-body"><p class="form-note">This settings form does not exist.</p></div></section>`;
  }

  function bindSettingsEditors(rerender, notify, navigate) {
    const back = () => navigate({module: 'settings', tab: 'accounting'});
    document.querySelector('[data-settings-cancel]')?.addEventListener('click', back);
    document.querySelectorAll('[data-settings-form]').forEach((form) => form.addEventListener('submit', (ev) => {
      ev.preventDefault();
      if (!form.reportValidity()) return;
      const kind = form.dataset.settingsForm;
      const v = Object.fromEntries(new FormData(form));
      const editing = v.editingCode || '';
      if (kind === 'heads') {
        if (!editing && accounts().some((a) => a.code === v.code)) { notify('That head code already exists.'); return; }
        const record = {code: v.code, name: v.name, type: v.type, group: v.group || 'Assets', control: v.control || '', description: v.description || '', currency: 'PKR', active: v.status === 'Active'};
        if (editing) { const target = accounts().find((a) => a.code === editing); if (target) Object.assign(target, record); notify('Accounting head updated for this session.'); }
        else { accounts().push(record); notify('Accounting head added. It is available in the chart and the journal picker.'); }
        SETUP_TAB = 'heads';
      } else if (kind === 'project') {
        if (!editing && PROJECTS.some((p) => p.code === v.code)) { notify('That project code already exists.'); return; }
        const record = {code: v.code, name: v.name, manager: v.manager || '', status: v.status, start: v.start || '', end: v.end || '', budget: round2(Number(v.budget) || 0), description: v.description || ''};
        if (editing) { Object.assign(PROJECTS.find((p) => p.code === editing), record); notify('Project updated for this session.'); }
        else { PROJECTS.push({...record, accounts: []}); notify('Project added for this session.'); }
        SETUP_TAB = 'projects';
      } else if (kind === 'location') {
        if (!editing && LOCATIONS.some((l) => l.code === v.code)) { notify('That location code already exists.'); return; }
        const record = {code: v.code, name: v.name, kind: v.kind, address: v.address || '', contact: v.contact || '', phone: v.phone || '', notes: v.notes || ''};
        if (editing) { Object.assign(LOCATIONS.find((l) => l.code === editing), record); notify('Location updated for this session.'); }
        else { LOCATIONS.push(record); notify('Location added for this session.'); }
        SETUP_TAB = 'locations';
      } else if (kind === 'centre') {
        if (!editing && COST_CENTRES.some((c) => c.code === v.code)) { notify('That cost centre code already exists.'); return; }
        const record = {code: v.code, name: v.name, description: v.description || '', archived: v.status === 'Archived'};
        if (editing) { Object.assign(COST_CENTRES.find((c) => c.code === editing), record); notify('Cost centre updated for this session.'); }
        else { COST_CENTRES.push(record); notify('Cost centre added for this session.'); }
        SETUP_TAB = 'centres';
      } else if (kind === 'partygroups' || kind === 'itemgroups') {
        const list = kind === 'partygroups' ? PARTY_GROUPS : ITEM_GROUPS;
        if (!editing && list.some((g) => g.code === v.code)) { notify('That group code already exists.'); return; }
        const record = {code: v.code, name: v.name, description: v.description || ''};
        if (kind === 'partygroups') record.kind = v.kind || 'both';
        if (editing) { Object.assign(list.find((g) => g.code === editing), record); notify('Group updated for this session.'); }
        else { list.push(record); notify('Group added for this session.'); }
        SETUP_TAB = kind === 'partygroups' ? 'partygroups' : 'itemgroups';
      }
      try { sessionStorage.setItem('sa7en:settings-tab', SETUP_TAB); } catch {}
      back();
    }));
  }

  function settingsView(page) {
    const current = SETTINGS_TABS.some(([k]) => k === page) ? page : 'company';
    const body = current === 'accounting' ? setup()
      : current === 'people' ? `<section class="panel">
          <div class="panel-head"><h2>People &amp; access</h2><span class="badge">${PEOPLE.length} people</span></div>
          <div class="table-scroll" data-hscroll><table><thead><tr><th>Name</th><th>Email</th><th>Phone</th><th>Role</th><th>Scope</th><th>Status</th></tr></thead><tbody>${PEOPLE.map((p) => `<tr><td>${e(p.name)}</td><td>${e(p.email)}</td><td>${e(p.phone || '—')}</td><td>${e(p.role)}</td><td>${e(p.scope)}</td><td>${badge(p.status, p.status === 'Active' ? 'good' : 'warn')}</td></tr>`).join('')}</tbody></table></div>
          <form data-people-form class="panel-body form-grid">
            <label>Name<input name="name" required maxlength="50"></label>
            <label>Email<input name="email" type="email" required maxlength="70"></label>
            <label>Phone<input name="phone" maxlength="30" placeholder="+92 300 0000000"></label>
            <label>Role<select name="role" class="inline-input"><option>Accountant</option><option>Bookkeeper</option><option>Cashier</option><option>Storekeeper</option><option>Auditor (read only)</option></select></label>
            <label>Scope<input name="scope" maxlength="50" value="Accounting"></label>
            <label>Status<select name="status" class="inline-input"><option>Invited</option><option>Active</option><option>Suspended</option></select></label>
            <div class="related"><button class="button primary">Invite</button></div>
          </form>
          <div class="panel-body"><p class="form-note">Roles grant what the role grants; a custom role name grants nothing protected. One active owner per business. Invitations are session-only in this build.</p></div>
        </section>`
      : current === 'periods' ? `<section class="panel">
          <div class="panel-head"><h2>Periods</h2><span class="badge ${PERIOD_LOCKED ? 'good' : ''}">${PERIOD_LOCKED ? 'November locked' : 'November open'}</span></div>
          <div class="table-scroll" data-hscroll><table><thead><tr><th>Period</th><th>From</th><th>To</th><th>State</th><th></th></tr></thead><tbody>
            ${[['Jul 2026', '2026-07-01', '2026-07-31'], ['Aug 2026', '2026-08-01', '2026-08-31'], ['Sep 2026', '2026-09-01', '2026-09-30'], ['Oct 2026', '2026-10-01', '2026-10-31'], ['Nov 2026', '2026-11-01', '2026-11-30']].map(([label, from, to]) => {
              const locked = label === 'Nov 2026' && PERIOD_LOCKED;
              return `<tr><td>${label}</td><td>${from}</td><td>${to}</td><td>${badge(locked ? 'Locked' : 'Open', locked ? 'good' : '')}</td><td>${label === 'Nov 2026' ? `<button class="text-button" data-period-toggle>${locked ? 'Reopen' : 'Lock'}</button>` : ''}</td></tr>`;
            }).join('')}
          </tbody></table></div>
          <div class="panel-body"><p class="form-note">The close checklist lives in Accounting → Period close. This page is the list of periods and their state; locking here and there is the same switch.</p></div>
        </section>`
      : current === 'forms' ? `<section class="panel">
          <div class="panel-head"><h2>Forms &amp; fields</h2><span class="badge">Versioned per business</span></div>
          <div class="table-scroll" data-hscroll><table><thead><tr><th>Form</th><th class="numeric">Standard fields</th><th>Custom fields</th><th>Last change</th></tr></thead><tbody>
            ${[['Journal entry', 12], ['Sales invoice', 9], ['Purchase bill', 9], ['Receipt / payment', 7], ['Party', 9], ['Item', 7], ['Cash / bank sub-account', 6]].map(([name, count]) => `<tr><td>${e(name)}</td><td class="numeric">${count}</td><td>${CUSTOM_FIELDS.filter((f) => f.form === name).map((f) => `${e(f.name)}${f.required ? ' (required)' : ''}`).join(', ') || '—'}</td><td>This session</td></tr>`).join('')}
          </tbody></table></div>
          <form data-field-form class="panel-body form-grid">
            <label>Form<select name="form" class="inline-input">${['Journal entry', 'Sales invoice', 'Purchase bill', 'Receipt / payment', 'Party', 'Item', 'Cash / bank sub-account'].map((n) => `<option>${n}</option>`).join('')}</select></label>
            <label>Field label<input name="name" required maxlength="40" placeholder="Cost centre note"></label>
            <label>Type<select name="type" class="inline-input"><option>Text</option><option>Number</option><option>Date</option><option>Yes / no</option><option>Choice</option></select></label>
            <label>Required<select name="required" class="inline-input"><option value="no">Optional</option><option value="yes">Required</option></select></label>
            <label>Help text<input name="help" maxlength="70" placeholder="Shown under the field"></label>
            <div class="related"><button class="button primary">Add field</button></div>
          </form>
          <div class="panel-body"><p class="form-note">Custom fields are added to the form and stored with the document. On the journal they appear on the More info tab. Field permissions, required rules and version history are enforced by the backend, not by this page.</p></div>
        </section>`
      : current === 'views' ? `<section class="panel">
          <div class="panel-head"><h2>Saved views</h2><span class="badge">${SAVED_VIEWS.length} views</span></div>
          <div class="table-scroll" data-hscroll><table><thead><tr><th>Name</th><th>Scope</th><th>Columns, filters, sort</th></tr></thead><tbody>${SAVED_VIEWS.map((v) => `<tr><td>${e(v.name)}</td><td>${e(v.scope)}</td><td>${e(v.detail)}</td></tr>`).join('')}</tbody></table></div>
          <form data-view-form class="panel-body form-grid">
            <label>Name<input name="name" required maxlength="40" placeholder="Overdue customers"></label>
            <label>Scope<select name="scope" class="inline-input">${['Journal entries', 'General ledger', 'Parties', 'Payments', 'Items', 'Taxes'].map((n) => `<option>${n}</option>`).join('')}</select></label>
            <label>Detail<input name="detail" maxlength="70" placeholder="Filter, columns and sort"></label>
            <label>Shared<select name="shared" class="inline-input"><option value="yes">Everyone in the business</option><option value="no">Only me</option></select></label>
            <div class="related"><button class="button primary">Save view</button></div>
          </form>
        </section>`
      : current === 'print' ? `<section class="panel">
          <div class="panel-head"><h2>Print &amp; templates</h2><span class="badge">${PRINT_TEMPLATES.length} templates</span></div>
          <div class="table-scroll" data-hscroll><table><thead><tr><th>Template</th><th>Size</th><th>Logo</th><th>QR</th><th>Footer</th></tr></thead><tbody>${PRINT_TEMPLATES.map((t) => `<tr><td>${e(t.name)}</td><td>${e(t.size)}</td><td>${t.logo ? 'Yes' : 'No'}</td><td>${t.qr ? 'Yes' : 'No'}</td><td>${e(t.footer)}</td></tr>`).join('')}</tbody></table></div>
          <form data-print-form class="panel-body form-grid">
            <label>Name<input name="name" required maxlength="40" placeholder="A5 invoice"></label>
            <label>Size<select name="size" class="inline-input"><option>A4</option><option>A5</option><option>80 mm</option></select></label>
            <label>Footer<input name="footer" maxlength="70" value="Northstar Trading (Pvt) Ltd"></label>
            <label>Show logo<select name="logo" class="inline-input"><option value="yes">Yes</option><option value="no">No</option></select></label>
            <label>Show QR<select name="qr" class="inline-input"><option value="no">No</option><option value="yes">Yes</option></select></label>
            <label>Margin (mm)<input name="margin" type="number" min="0" max="30" value="12"></label>
            <div class="related"><button class="button primary">Add template</button></div>
          </form>
          <div class="panel-body"><p class="form-note">The journal print action uses the browser print sheet today. A template selection, letterhead upload and QR prove the document without a server round trip.</p></div>
        </section>`
      : `<form class="two-column" data-settings-save="company">
          <section class="panel">
            <div class="panel-head"><h2>Business identity</h2><span class="badge">Session only</span></div>
            <div class="panel-body form-grid">
              ${field('Legal name', 'Northstar Trading (Pvt) Ltd', '', 'legalName')}
              ${field('Trading name', 'Northstar Trading', '', 'tradingName')}
              ${field('Tax identity', 'NTN-4100000', '', 'taxId')}
              ${field('Registration', 'SECP-0188221', '', 'registration')}
              ${field('Base currency', 'PKR', '', 'currency')}
              ${field('Fiscal year', 'Jul 2026 – Jun 2027', '', 'fiscalYear')}
              ${field('Current period', 'Nov 2026', '', 'currentPeriod')}
              ${field('Week starts', 'Monday', '', 'weekStart')}
              ${field('Time zone', 'Asia/Karachi', '', 'timezone')}
              ${field('Date format', 'DD MMM YYYY', 'Prints on documents', 'dateFormat')}
            </div>
          </section>
          <section class="panel">
            <div class="panel-head"><h2>Addresses and contact</h2></div>
            <div class="panel-body form-grid">
              ${field('Registered address', 'Office 4, Clifton Block 5', '', 'address')}
              ${field('City', 'Karachi', '', 'city')}
              ${field('Country', 'Pakistan', '', 'country')}
              ${field('Phone', '+92 21 000 0000', '', 'phone')}
              ${field('Email', 'accounts@northstar.pk', '', 'email')}
              ${field('Website', 'northstar.pk', '', 'website')}
            </div>
            <div class="panel-body"><div class="related"><button class="button primary">Save company settings</button></div>
              <p class="form-note">The business is chosen once at sign-in. Its identity prints on every document; changing the base currency or fiscal year after posting needs a migration, not a form.</p></div>
          </section>
        </form>`;
    return `<div class="tabs" role="tablist" aria-label="Settings sections">${SETTINGS_TABS.map(([id, label]) => `<button role="tab" aria-selected="${current === id}" data-module="settings" data-tab="${id}">${label}</button>`).join('')}</div>
      <div id="settings-panel">${body}</div>`;
  }

  function bindRegisterFilters(rerender) {
    document.querySelectorAll('[data-filter]').forEach((form) => {
      const key = form.dataset.filter;
      if (!FILTERS[key]) return;
      const apply = () => { FILTERS[key] = {...FILTERS[key], ...Object.fromEntries(new FormData(form))}; };
      form.addEventListener('input', (ev) => {
        apply();
        const {name} = ev.target;
        const pos = ev.target.selectionStart;
        rerender();
        const again = document.querySelector(`[data-filter="${key}"] [name="${name}"]`);
        if (again) { again.focus(); try { again.setSelectionRange(pos, pos); } catch {} }
      });
      form.addEventListener('change', () => { apply(); rerender(); });
    });
    document.querySelectorAll('[data-filter-reset]').forEach((b) => b.addEventListener('click', () => {
      const key = b.dataset.filterReset;
      FILTERS[key] = Object.fromEntries(Object.keys(FILTERS[key] || {}).map((k) => [k, '']));
      rerender();
    }));
  }

  function bindSettingsView(rerender, notify) {
    document.querySelectorAll('[data-settings-save]').forEach((f) => f.addEventListener('submit', (ev) => {
      ev.preventDefault();
      if (f.dataset.settingsSave === 'numbering') {
        const v = Object.fromEntries(new FormData(f));
        const set = (name, prefix, next) => {
          NUMBERING[name].prefix = prefix;
          NUMBERING[name].next = Math.max(1, Number(next) || 1);
          NUMBERING[name].padding = Math.max(2, Math.min(8, Number(v.padding) || 4));
        };
        set('journal', v.journalPrefix || 'JV', v.journalNext);
        set('sales', v.salesPrefix || 'SI-', v.salesNext);
        set('purchase', v.purchasePrefix || 'PI-', v.purchaseNext);
        set('payment', v.paymentPrefix || 'PMT-', v.paymentNext);
        set('receipt', v.receiptPrefix || 'RCT-', v.receiptNext);
        notify(`Numbering saved. The next journal is ${NUMBERING.journal.prefix}-MM-YYYY-${String(NUMBERING.journal.next).padStart(NUMBERING.journal.padding, '0')}.`);
        rerender();
        return;
      }
      notify('Settings saved for this session. A real deployment versions these values and applies them from their effective date.');
      rerender();
    }));
    document.querySelector('[data-people-form]')?.addEventListener('submit', (ev) => {
      ev.preventDefault();
      const form = ev.target;
      if (!form.reportValidity()) return;
      const v = Object.fromEntries(new FormData(form));
      PEOPLE.push({name: v.name, email: v.email, phone: v.phone || '', role: v.role, scope: v.scope || '—', status: v.status || 'Invited'});
      notify('Invitation recorded for this session. Delivery and acceptance need the backend.');
      rerender();
    });
    document.querySelector('[data-field-form]')?.addEventListener('submit', (ev) => {
      ev.preventDefault();
      const form = ev.target;
      if (!form.reportValidity()) return;
      const v = Object.fromEntries(new FormData(form));
      CUSTOM_FIELDS.push({form: v.form, name: v.name, type: v.type, required: v.required === 'yes', help: v.help || ''});
      notify('Custom field added for this session.');
      rerender();
    });
    document.querySelector('[data-view-form]')?.addEventListener('submit', (ev) => {
      ev.preventDefault();
      const form = ev.target;
      if (!form.reportValidity()) return;
      const v = Object.fromEntries(new FormData(form));
      SAVED_VIEWS.push({name: v.name, scope: v.scope, detail: (v.detail || 'Default columns') + (v.shared === 'no' ? ' · private' : ' · shared')});
      notify('View saved for this session.');
      rerender();
    });
    document.querySelector('[data-print-form]')?.addEventListener('submit', (ev) => {
      ev.preventDefault();
      const form = ev.target;
      if (!form.reportValidity()) return;
      const v = Object.fromEntries(new FormData(form));
      PRINT_TEMPLATES.push({name: v.name, size: v.size, logo: v.logo === 'yes', qr: v.qr === 'yes', margin: Number(v.margin) || 12, footer: v.footer});
      notify('Print template added for this session.');
      rerender();
    });
    document.querySelector('[data-period-toggle]')?.addEventListener('click', () => {
      PERIOD_LOCKED = !PERIOD_LOCKED;
      notify(PERIOD_LOCKED ? 'November 2026 locked for this session.' : 'November 2026 reopened for this session.');
      rerender();
    });
  }

  const projectsView = () => projectsScreen(getCompany());

  const PLANNED = {
    parties: ['Parties', 'One register for customers and suppliers: type, group, tax identity, currency, credit limit, payment terms, opening and current balance, overdue amount and status. Opening a party shows its ledger, its documents and its ageing in one place.', ['Credit limits and payment terms per party', 'Allowed projects and locations, chosen on the party form', 'Opening balance and running ledger', 'Documents, allocations and ageing', 'Hold, block and reactivate']],
    registers: ['Registers', 'Document registers by type — sales invoices, purchase invoices, payments and journals — filtered by party, date range, amount and state. This answers “every transaction with this party in this period” without opening the ledger.', ['Filter by party, type, period, amount, state', 'Column totals and export', 'Row opens the document']],
    payments: ['Payments', 'Money in and money out with a party, a bank or cash account, a reference and an allocation table. Allocation can follow oldest first, newest first or a manual selection across several documents, with any remainder kept as an advance.', ['Receipts and supplier payments', 'Allocation against open invoices or bills', 'Advance and on-account balances', 'Posts the ledger entry and the allocation together']],
    banking: ['Banking & cash', 'Bank and cash accounts with balances and a cash-flow strip, a register per account, and reconciliation with statement import, suggested matches and unmatched lines. A reconciliation cannot be closed with a difference.', ['Bank and cash account list', 'Each bank or cash sub-account records its allowed projects and locations', 'Cash-flow summary', 'Account register', 'Statement import and reconciliation']],
    items: ['Items', 'Light item master for accounting: code, name, unit, income account, expense account, tax treatment and an “inventory tracked” flag. Tracked items are the only ones the Inventory module will value.', ['Sell and buy accounts per item', 'Tax treatment', 'Inventory-tracked flag', 'No quantities or valuation here']],
    sales: ['Sales invoices', 'Customer invoice with item or free-text lines, tax, due date and payment terms. Posting creates a receivable open item, updates the party balance and writes the ledger entry.', ['Line items with tax', 'Due date and terms', 'Submit, cancel with reversal, print', 'Credit note against the original']],
    purchases: ['Purchase invoices', 'Supplier bill mirroring the sales invoice, posting to payables and to expense or inventory-clearing. Used for expenses when the Buying module is off, and as the accounting record of a bill when it is on.', ['Line items with tax', 'Due date and terms', 'Expense or inventory clearing', 'Cancel with reversal']],
  };

  function planned(id) {
    const [title, text, contains] = PLANNED[id] || ['Being built', 'This page is mapped but not built yet.', []];
    return `<section class="panel">
      <div class="panel-head"><h2>${e(title)}</h2>${badge('Being built')}</div>
      <div class="panel-body">
        <p>${e(text)}</p>
        <div class="section-title">What it will contain</div>
        <ul class="contract-list">${contains.map((c) => `<li>${e(c)}</li>`).join('')}</ul>
        <div class="callout"><strong>Not connected yet.</strong> This page is part of the agreed accounting map. It does not post, allocate or change any balance.</div>
        <p class="form-note">Full page map: docs/design/ACCOUNTING_MODULE_MAP.md.</p>
      </div>
    </section>`;
  }

  const overview = dashboard;
  return {overview, dashboard, gl, bindGL, journalRegister, bindJournal, journalDocById, updateJournalDoc, cancelJournalDoc, deleteJournalDoc, duplicateJournalDoc, setup, bindSetup, bindDimension, taxesView, bindTaxes, cashBank: cashBankView, cashEditor, bindCashBank, items: itemsView, itemEditor, bindItems, partyEditor, taxEditor, paymentEditor, invoiceEditor, reports: reportsView, bindReports, parties: partiesView, bindParties, payments: paymentsView, bindPayments, invoices: invoicesView, bindInvoices, close: closeView, bindClose, settings: settingsView, settingsEditor, chartAccountEditor, bindChartAccount, bindSettings: bindSettingsView, bindSettingsEditors, bindRegisterFilters, projectsView, bindProjectForm, receivables: () => partyScreen('ar'), payables: () => partyScreen('ap'), ageing, approvals, planned};

}
