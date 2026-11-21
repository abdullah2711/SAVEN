// Screens added on top of the retained saventesting build.
// Markup uses only the existing classes from ui/theme.css. No new styling,
// no shader, no animation. Every total that duplicates a ledger figure is
// derived from accounting-model.js so the screens cannot contradict it.
import {escape as e} from './model.js';
import {fixture,trial,statements,PROJECTS,LOCATIONS,COST_CENTRES} from './accounting-model.js';
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
  ['rules', 'Rules', 'Every tax rule the business applies: kind (sales tax, purchase tax, withholding, advance tax), rate, inclusive or exclusive, the account it posts to, and what it applies to — everything, a group of items, or one item or service. A rule is a default: any document line can override the rate or switch tax off.', ['Rule kind and rate', 'Inclusive or exclusive pricing', 'Account per rule, different for sales and purchases', 'Scope: all items, a group, or a single item', 'Effective from and to', 'Override allowed per document line']],
  ['registers', 'Registers', 'Every tax line produced by a document, split into output (sales) and input (purchases), filterable by period, party, rule and document. Totals must agree with the tax control accounts, and the page says so when they do not.', ['Output tax lines', 'Input tax lines', 'Recoverable and blocked portions', 'Filter by period, party, rule', 'Reconciliation against control accounts']],
  ['withholding', 'Withholding', 'Tax we deduct from a supplier and owe to the authority on their behalf. It is a liability from the moment we withhold, cleared when we pay the authority. Shown separately from purchase tax because the money is never ours.', ['Purchase sales-tax withholding', 'Purchase income-tax withholding', 'Expected against actual', 'Liability by period', 'Paid to authority, cleared against the liability']],
  ['advance', 'Advance tax', 'Tax a customer deducts from our invoice and pays to the authority on our behalf. It is our tax paid in advance: an asset until the return claims it.', ['Sales sales-tax deducted by customer', 'Sales income-tax deducted by customer', 'Asset by period', 'Claimed on the return', 'Reconciled against the certificate the customer issues']],
  ['adjustments', 'Reconciliation & adjustments', 'Where recorded tax and actual tax differ — rounding, a rate applied late, a credit note, a filing adjustment. Each adjustment carries a reason, the period it belongs to, the account and the evidence, and posts to the tax control accounts.', ['Reason code per adjustment', 'Period it belongs to', 'Debit or credit to a tax account', 'Evidence and approval', 'Reconciliation view: recorded, adjusted, filed']],
];

function taxPanel(id) {
  const tab = TAX_TABS.find(([k]) => k === id) || TAX_TABS[0];
  const [, label, text, contains] = tab;
  return `<section class="panel">
    <div class="panel-head"><h2>${e(label)}</h2>${badge('Being built')}</div>
    <div class="panel-body">
      <p>${e(text)}</p>
      <div class="section-title">What it will contain</div>
      <ul class="contract-list">${contains.map((c) => `<li>${e(c)}</li>`).join('')}</ul>
      <div class="callout"><strong>Not connected yet.</strong> These tabs are mapped and specified. Nothing here posts, files or changes a balance.</div>
      <p class="form-note">Tax rules can also be entered as a custom line on any document with an account flagged as a tax account, so the business can run without this page.</p>
    </div>
  </section>`;
}

function taxesScreen(tab = 'codes') {
  const current = TAX_TABS.some(([k]) => k === tab) ? tab : 'codes';
  return `<div class="tabs" role="tablist" aria-label="Tax views">
      ${TAX_TABS.map(([id, label]) => `<button role="tab" aria-selected="${current === id}" data-tax-tab="${id}">${label}</button>`).join('')}
    </div>
    <div id="tax-panel">${taxPanel(current)}</div>`;
}

function bindTaxes(rerender) {
  document.querySelectorAll('[data-tax-tab]').forEach((btn) => btn.addEventListener('click', () => {
    TAX_ACTIVE = btn.dataset.taxTab;
    rerender();
  }));
}
let TAX_ACTIVE = 'codes';

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
      <div class="table-scroll"><table>
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
        <div class="table-scroll"><table>
          <thead><tr><th>Party</th>${BUCKETS.map((b) => `<th class="numeric">${b}</th>`).join('')}<th class="numeric">Total</th></tr></thead>
          <tbody>${parts.map((p) => `<tr><td>${e(p.name)}</td>${BUCKETS.map((b) => `<td class="numeric">${bucketOf(p.age) === b ? money(p.balance) : '—'}</td>`).join('')}<td class="numeric">${money(p.balance)}</td></tr>`).join('')}</tbody>
          <tfoot><tr><td><strong>Total</strong></td>${BUCKETS.map((b) => `<td class="numeric"><strong>${money(totals[b])}</strong></td>`).join('')}<td class="numeric"><strong>${money(grand)}</strong></td></tr></tfoot>
        </table></div>
      </section>`;
    };
    return matrix(ar, 'Receivables ageing') + matrix(ap, 'Payables ageing')
      + `<section class="panel">
        <div class="panel-head"><h2>Depreciation schedule</h2>${badge('November charge drafted')}</div>
        <div class="table-scroll"><table>
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
    const docs = fixture(getCompany()).filter((d) => d.date >= GL.from && d.date <= GL.to);
    const out = [];
    for (const d of docs) {
      if (!inSet(GL.parties, d.party)) continue;
      if (!inSet(GL.types, d.source)) continue;
      if (!inSet(GL.projects, d.project || '')) continue;
      if (!inSet(GL.locations, d.location || '')) continue;
      for (const l of d.lines) {
        if (GL.accounts.length && !GL.accounts.includes(l.account)) continue;
        if (GL.centres.length && !GL.centres.includes(l.costCentre)) continue;
        const acc = accounts().find((a) => a.code === l.account);
        const hay = `${d.id} ${d.narrative} ${d.party} ${l.account} ${acc ? acc.name : ''} ${l.project} ${l.location} ${l.costCentre}`.toLowerCase();
        if (GL.q && !hay.includes(GL.q.toLowerCase())) continue;
        out.push({
          id: d.id, date: d.date, party: d.party,
          partyType: d.partyType || (acc && acc.control === 'receivable' ? 'Customer' : acc && acc.control === 'payable' ? 'Supplier' : ''),
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
    return round2(fixture(getCompany()).filter((d) => d.date < GL.from)
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
        <div class="ms-head">
          <button type="button" class="text-button" data-ms-all>Select all</button>
          <button type="button" class="text-button" data-ms-none>Clear</button>
        </div>
        <div class="ms-list">${options.map(([value, label2]) => `<label class="ms-row"><input class="check" type="checkbox" ${attr ? `data-${attr}="${e(value)}"` : `name="${name}"`} value="${e(value)}" ${selected.includes(value) ? 'checked' : ''}><span>${e(label2)}</span></label>`).join('')}</div>
      </div>
    </div>`;
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
  function bindMS() {
    if (msBound) return;
    msBound = true;
    const closeAll = (except) => document.querySelectorAll('.ms').forEach((box) => {
      if (box === except) return;
      box.querySelector('.ms-panel').hidden = true;
      box.querySelector('.ms-trigger').setAttribute('aria-expanded', 'false');
    });
    document.addEventListener('click', (ev) => {
      const trigger = ev.target.closest('.ms-trigger');
      if (trigger) {
        const box = trigger.closest('.ms');
        const panel = box.querySelector('.ms-panel');
        const open = panel.hidden;
        closeAll(box);
        panel.hidden = !open;
        trigger.setAttribute('aria-expanded', String(open));
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
        box.querySelectorAll('input[type=checkbox]').forEach((b) => { b.checked = Boolean(all); b.dispatchEvent(new Event('change', {bubbles: true})); });
        return;
      }
      if (!ev.target.closest('.ms-panel')) closeAll();
    });
    document.addEventListener('keydown', (ev) => { if (ev.key === 'Escape') closeAll(); });
    document.addEventListener('change', (ev) => {
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
    cols.push(['party', 'Party', (r) => e(r.party)]);
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
    const cols = glColumns();
    const sortable = new Set(['date', 'account', 'description', 'debit', 'credit', 'type', 'subtype', 'voucher', 'party', 'project', 'location', 'centre']);

    const body = rows.map((r) => {
      const open = GL.open === r.id + ':' + r.account;
      return `<tr data-gl-row="${e(r.id)}:${e(r.account)}" class="${open ? 'gl-open' : ''}">
          ${cols.map(([key, , cell, cls]) => `<td class="col col-${key} ${cls || ''}">${cell(r)}</td>`).join('')}
        </tr>` + (open ? detailRow(r, cols.length) : '');
    }).join('');

    const accountOpts = accounts().filter((a) => a.active).map((a) => [a.code, `${a.code} ${a.name}`]);
    const partyOpts = [...new Set(fixture(getCompany()).map((d) => d.party))].sort().map((p2) => [p2, p2]);
    const projectOpts = [['', 'No project'], ...PROJECTS.map((p2) => [p2.code, `${p2.code} · ${p2.name}`])];
    const locOpts = LOCATIONS.map((l) => [l.code, `${l.code} · ${l.name}`]);
    const centreOpts = COST_CENTRES.map((c) => [c, c]);
    const typeOpts = [...new Set(fixture(getCompany()).map((d) => d.source))].sort().map((t) => [t, t]);
    const extras = [['subtype', 'Voucher subtype'], ['against', 'Against account'], ['partyType', 'Party type'], ['project', 'Project'], ['location', 'Location'], ['centre', 'Cost centre'], ['againstVoucher', 'Against voucher'], ['supplierRef', 'Supplier invoice no']];

    return `<form id="gl-filter" class="filterbar gl-filter">
        <label>From<input name="from" type="date" value="${e(GL.from)}" required></label>
        <label>To<input name="to" type="date" value="${e(GL.to)}" required></label>
        ${ms('account', 'Accounts', accountOpts, GL.accounts)}
        ${ms('party', 'Parties', partyOpts, GL.parties)}
        ${ms('project', 'Projects', projectOpts, GL.projects)}
        ${ms('location', 'Locations', locOpts, GL.locations)}
        ${ms('centre', 'Cost centres', centreOpts, GL.centres)}
        ${ms('type', 'Voucher types', typeOpts, GL.types)}
        <label>Search<input name="q" type="search" value="${e(GL.q)}" placeholder="Voucher, party or description"></label>
        <button class="button primary">Apply</button>
      </form>

      <div class="gl-toolrow">
        ${ms('columns', 'Columns', extras, [...GL.extras], 'gl-col')}
        <span class="form-note"><span id="gl-col-count">${cols.length}</span> of ${cols.length} columns visible. Posting date, account, description, amounts, voucher and party are always shown.</span>
      </div>

      <section class="panel">
        <div class="panel-head"><h2>${GL.accounts.length === 1 ? e((accounts().find((a) => a.code === GL.accounts[0]) || {}).name || GL.accounts[0]) : GL.accounts.length ? GL.accounts.length + ' accounts' : 'All accounts'}</h2><div class="related"><span class="badge">${rows.length} lines</span><button class="button" data-gl-export="csv">Export CSV</button><button class="button" data-gl-print>Print</button></div></div>
        <div class="table-scroll gl-scroll">
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

  function bindGL(rerender) {
    bindMS();
    document.querySelector('#gl-filter')?.addEventListener('submit', (ev) => {
      ev.preventDefault();
      readMulti(ev.target);
      GL.from = ev.target.from.value; GL.to = ev.target.to.value; GL.q = ev.target.q.value;
      GL.open = '';
      rerender();
    });
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
      const tr = ev.target.closest('[data-gl-row]');
      if (!tr) return;
      GL.open = GL.open === tr.dataset.glRow ? '' : tr.dataset.glRow;
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
  const J = {
    parties: [], projects: [], locations: [], centres: [], subtypes: [], q: '',
    sort: {key: 'date', dir: 'desc'}, record: '', session: [], removed: new Set(),
    extras: new Set(['subtype', 'project', 'location', 'centre', 'party']),
  };

  function journalDocs() {
    return fixture(getCompany()).filter((d) => !J.removed.has(d.id)).concat(J.session);
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
        state: d.state || 'posted', doc: d,
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
    const centreOpts = COST_CENTRES.map((c) => [c, c]);
    const extras = [['subtype', 'Subtype'], ['party', 'Party'], ['project', 'Project'], ['location', 'Location'], ['centre', 'Cost centre']];

    return `<form id="jr-filter" class="filterbar gl-filter">
        ${ms('party', 'Parties', partyOpts, J.parties)}
        ${ms('subtype', 'Subtypes', subtypeOpts, J.subtypes)}
        ${ms('project', 'Projects', projectOpts, J.projects)}
        ${ms('location', 'Locations', locOpts, J.locations)}
        ${ms('centre', 'Cost centres', centreOpts, J.centres)}
        <label>Search<input name="q" type="search" value="${e(J.q)}" placeholder="Voucher, party or description"></label>
        <button class="button primary">Apply</button>
      </form>

      <div class="gl-toolrow">
        ${ms('columns', 'Columns', extras, [...J.extras], 'jr-col')}
        <span class="form-note"><span id="jr-col-count">${cols.length}</span> of ${cols.length} columns visible. Date, voucher, description, amounts and state are always shown; fields added to the entry form appear here automatically.</span>
      </div>

      <section class="panel">
        <div class="panel-head"><h2>Journals</h2><div class="related"><span class="badge">${rows.length} entries</span><button class="button" data-jr-print>Print</button></div></div>
        <div class="table-scroll gl-scroll">
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
    const state = d.state || 'posted';
    const editable = state === 'draft';
    const totals = d.lines.reduce((n, l) => n + num(l.debit), 0);
    return `<div class="related gl-actions">
        <button class="button" data-jr-back>← Back to register</button>
        <span class="badge ${state === 'posted' ? 'good' : 'warn'}">${e(state)}</span>
        <span class="spacer"></span>
        ${editable ? '<button class="button" data-jr-edit>Edit draft</button>' : ''}
        <button class="button" data-jr-duplicate>Duplicate</button>
        ${editable ? '<button class="button" data-jr-delete>Delete</button>' : ''}
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
        <div class="table-footer">${state === 'posted' ? 'Posted entries are immutable: corrections are made by a reversing entry, and only an administrator may delete (soft delete, kept in the audit log).' : 'Draft: editable, can be submitted, duplicated or deleted.'}</div>
      </section>`;
  }

  function bindJournal(rerender, notify) {
    bindMS();
    const form = document.querySelector('#jr-filter');
    if (form) form.addEventListener('submit', (ev) => {
      ev.preventDefault();
      const pick = (n) => [...form.querySelectorAll(`input[name="${n}"]:checked`)].map((x) => x.value);
      J.parties = pick('party'); J.subtypes = pick('subtype'); J.projects = pick('project');
      J.locations = pick('location'); J.centres = pick('centre');
      J.q = ev.target.q.value;
      rerender();
    });
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
      if (open) { J.record = open.dataset.jrOpen; rerender(); return; }
      const row = ev.target.closest('[data-jr-row]');
      if (row) { J.record = row.dataset.jrRow; rerender(); }
    });
    document.querySelector('[data-jr-back]')?.addEventListener('click', () => { J.record = ''; rerender(); });
    document.querySelector('[data-jr-print]')?.addEventListener('click', () => window.print());
    document.querySelector('[data-jr-duplicate]')?.addEventListener('click', () => {
      const src = journalDocs().find((x) => x.id === J.record);
      if (!src) return;
      const copy = {...src, id: 'JE-2026-D' + String(J.session.length + 101), state: 'draft', narrative: src.narrative + ' (copy)'};
      J.session.push(copy);
      notify('Duplicated into a new draft. Edit and submit when ready.');
      J.record = copy.id;
      rerender();
    });
    document.querySelector('[data-jr-delete]')?.addEventListener('click', () => {
      const src = journalDocs().find((x) => x.id === J.record);
      if (!src) return;
      if (J.session.includes(src)) J.session = J.session.filter((x) => x !== src);
      else J.removed.add(src.id);
      notify('Removed for this session. A real deployment keeps a soft delete and an audit entry.');
      J.record = '';
      rerender();
    });
    document.querySelector('[data-jr-edit]')?.addEventListener('click', () => {
      notify('The draft editor opens with this record loaded once the backend is connected.');
    });
  }

  /* ------------------------------------------------------------------ setup */
  function setup() {
    const byControl = (kind) => accounts().filter((a) => a.control === kind).map((a) => `${a.code} ${a.name}`).join(', ') || 'Not set';
    const taxAccounts = accounts().filter((a) => ['1300', '2200'].includes(a.code)).map((a) => `${a.code} ${a.name}`).join(', ');
    const field = (label, value, hint = '') => `<label>${e(label)}<input value="${e(value)}">${hint ? `<small class="secondary">${e(hint)}</small>` : ''}</label>`;
    const row = (label, value) => `<div class="quiet-row"><div><strong>${e(label)}</strong></div><span>${e(value)}</span></div>`;
    return `<div class="two-column">
      <section class="panel">
        <div class="panel-head"><h2>Organisation</h2><span class="badge">Saved in this session only</span></div>
        <div class="panel-body form-grid">
          ${field('Legal name', 'Northstar Trading (Pvt) Ltd')}
          ${field('Base currency', 'PKR')}
          ${field('Fiscal year', 'Jul 2026 – Jun 2027')}
          ${field('Current period', 'Nov 2026')}
          ${field('Default payment terms', '30')}
          ${field('Credit limit behaviour', 'Warn, allow with approval')}
        </div>
      </section>
      <section class="panel">
        <div class="panel-head"><h2>Numbering</h2></div>
        <div class="panel-body form-grid">
          ${field('Journal prefix', 'JE-2026-')}
          ${field('Sales invoice prefix', 'SI-')}
          ${field('Purchase invoice prefix', 'PI-')}
          ${field('Payment prefix', 'PMT-')}
          ${field('Receipt prefix', 'RCT-')}
          ${field('Next journal number', '0201')}
        </div>
      </section>
    </div>

    <div class="two-column">
      <section class="panel">
        <div class="panel-head"><h2>Default accounts</h2><span class="badge">From chart flags</span></div>
        <div class="panel-body">
          ${row('Trade receivables control', byControl('receivable'))}
          ${row('Trade payables control', byControl('payable'))}
          ${row('Tax accounts', taxAccounts)}
          ${row('Inventory account', '1200 Inventory — finished goods')}
          ${row('Bank account', '1010 Operating bank')}
          ${row('Cash account', '1000 Cash')}
          ${row('Rounding account', '6500 Bank charges')}
          <p class="form-note">Control and tax accounts are set on the account itself, so a new account of that type appears here automatically.</p>
        </div>
      </section>
      <section class="panel">
        <div class="panel-head"><h2>Dimensions</h2></div>
        <div class="panel-body">
          <div class="section-title">Projects</div>
          <ul class="contract-list">${PROJECTS.map((p) => `<li>${e(p.code)} · ${e(p.name)} <span class="badge ${p.status === 'active' ? 'good' : ''}">${e(p.status)}</span></li>`).join('')}</ul>
          <div class="section-title">Cost centres</div>
          <ul class="contract-list">${COST_CENTRES.map((c) => `<li>${e(c)}</li>`).join('')}</ul>
          <p class="form-note">Every journal, invoice and payment line carries a project and a cost centre. Head office is a project, not the absence of one.</p>
        </div>
      </section>
    </div>

    <section class="panel">
      <div class="panel-head"><h2>Approvals and periods</h2></div>
      <div class="panel-body form-grid">
        ${field('Review required above', '100,000.00', 'Debits above this need an independent reviewer')}
        ${field('Self approval', 'Not permitted')}
        ${field('Period lock', 'Requires checklist and sign-off')}
        ${field('Reopen authority', 'Business administrator only')}
        ${field('Post into closed period', 'Administrator, with reason')}
        ${field('Correction route', 'Reversal document, or soft delete by an administrator')}
      </div>
    </section>`;
  }

  const projectsView = () => projectsScreen(getCompany());
  const taxesView = () => taxesScreen(TAX_ACTIVE);

  const PLANNED = {
    parties: ['Parties', 'One register for customers and suppliers: type, group, tax identity, currency, credit limit, payment terms, opening and current balance, overdue amount and status. Opening a party shows its ledger, its documents and its ageing in one place.', ['Credit limits and payment terms per party', 'Opening balance and running ledger', 'Documents, allocations and ageing', 'Hold, block and reactivate']],
    registers: ['Registers', 'Document registers by type — sales invoices, purchase invoices, payments and journals — filtered by party, date range, amount and state. This answers “every transaction with this party in this period” without opening the ledger.', ['Filter by party, type, period, amount, state', 'Column totals and export', 'Row opens the document']],
    payments: ['Payments', 'Money in and money out with a party, a bank or cash account, a reference and an allocation table. Allocation can follow oldest first, newest first or a manual selection across several documents, with any remainder kept as an advance.', ['Receipts and supplier payments', 'Allocation against open invoices or bills', 'Advance and on-account balances', 'Posts the ledger entry and the allocation together']],
    banking: ['Banking & cash', 'Bank and cash accounts with balances and a cash-flow strip, a register per account, and reconciliation with statement import, suggested matches and unmatched lines. A reconciliation cannot be closed with a difference.', ['Bank and cash account list', 'Cash-flow summary', 'Account register', 'Statement import and reconciliation']],
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
  return {overview, dashboard, gl, bindGL, journalRegister, bindJournal, setup, taxesView, bindTaxes, projectsView, bindProjectForm, receivables: () => partyScreen('ar'), payables: () => partyScreen('ap'), ageing, approvals, planned};

}
