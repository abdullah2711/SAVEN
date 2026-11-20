// Screens added on top of the retained saventesting build.
// Markup uses only the existing classes from ui/theme.css. No new styling,
// no shader, no animation. Every total that duplicates a ledger figure is
// derived from accounting-model.js so the screens cannot contradict it.
import {escape as e} from './model.js';
import {fixture,trial,statements} from './accounting-model.js';
import {icon} from './icons.js';
import {catalog} from './catalog.js';

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

export function createScreens({getCompany, range, navigate, notify}) {
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

  /* ------------------------------------------------------------------ overview */
  // A 30-day cash series computed from the same documents the ledger uses.
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

  function sparkline() {
    const points = cashSeries();
    const w = 560, h = 132, min = Math.min(...points.map((p) => p.value)), max = Math.max(...points.map((p) => p.value));
    const span = max - min || 1;
    const x = (i) => (i / (points.length - 1)) * w;
    const y = (v) => h - ((v - min) / span) * (h - 12) - 6;
    const line = points.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.value).toFixed(1)}`).join(' ');
    const area = `${line} L${w},${h} L0,${h} Z`;
    return `<svg viewBox="0 0 ${w} ${h}" width="100%" height="${h}" preserveAspectRatio="none" role="img" aria-label="Cash movement for November 2026">
      <path d="${area}" fill="var(--accent)" opacity="0.08"></path>
      <path d="${line}" fill="none" stroke="var(--accent)" stroke-width="1.8" stroke-linejoin="round" stroke-linecap="round"></path>
      <circle cx="${x(points.length - 1)}" cy="${y(points[points.length - 1].value)}" r="3.2" fill="var(--accent)"></circle>
    </svg>
    <div class="ledger-basis"><span>1 Nov 2026</span><span>30 Nov 2026</span></div>`;
  }

  const MODULE_ACTIONS = {
    accounting: [['Journal entry', 'accounting', 'editor'], ['General ledger', 'accounting', 'ledger'], ['Trial balance', 'accounting', 'trial'], ['Chart of accounts', 'accounting', 'coa']],
    banking: [['Cash and bank', 'banking', 'workspace'], ['Reconciliation', 'banking', 'workspace']],
    payments: [['Receipts', 'payments', 'workspace'], ['Supplier payments', 'payments', 'workspace'], ['Allocations', 'payments', 'workspace']],
    sales: [['Invoices', 'sales', 'workspace'], ['Quotations', 'sales', 'workspace'], ['Customers', 'sales', 'workspace']],
    purchases: [['Bills', 'purchases', 'workspace'], ['Orders', 'purchases', 'workspace'], ['Suppliers', 'purchases', 'workspace']],
    tax: [['Withholding', 'tax', 'workspace'], ['Sales tax', 'tax', 'workspace'], ['Reconciliation', 'tax', 'workspace']],
    inventory: [['Stock balances', 'inventory', 'workspace'], ['Items', 'inventory', 'workspace'], ['Movements', 'inventory', 'workspace']],
    manufacturing: [['Work orders', 'manufacturing', 'workspace'], ['BOM', 'manufacturing', 'workspace']],
    pos: [['Checkout', 'pos', 'workspace'], ['Till sessions', 'pos', 'workspace']],
    assets: [['Asset register', 'assets', 'workspace'], ['Depreciation', 'assets', 'workspace']],
    people: [['Employees', 'people', 'workspace'], ['Payroll', 'people', 'workspace']],
    projects: [['Projects', 'projects', 'workspace'], ['Time and expenses', 'projects', 'workspace']],
    crm: [['Leads', 'crm', 'workspace'], ['Opportunities', 'crm', 'workspace']],
    finance: [['Cash position', 'finance', 'workspace'], ['Forecast', 'finance', 'workspace']],
    reports: [['Standard reports', 'reports', 'workspace'], ['Statement packs', 'reports', 'workspace']],
    drive: [['Folders', 'drive', 'workspace'], ['Evidence links', 'drive', 'workspace']],
    apps: [['API contracts', 'apps', 'workspace'], ['App registry', 'apps', 'workspace']],
    assistant: [['Ask a question', 'assistant', 'workspace'], ['Usage', 'assistant', 'workspace']],
    settings: [['Business', 'settings', 'workspace'], ['People and roles', 'settings', 'workspace']],
    admin: [['Audit', 'admin', 'workspace'], ['Access', 'admin', 'workspace']],
    subscription: [['Your plan', 'subscription', 'workspace'], ['Invoices', 'subscription', 'workspace']],
    offline: [['Connectivity', 'offline', 'workspace'], ['Queue', 'offline', 'workspace']],
  };

  function moduleGrid() {
    const modules = catalog.modules.filter((m) => m.id !== 'operator' && m.id !== 'commerce' && m.id !== 'design');
    return `<div class="module-grid">${modules.map((m) => {
      const actions = MODULE_ACTIONS[m.id] || [['Open', m.id, 'workspace']];
      return `<section class="module-card">
        <div class="card-icon"><span aria-hidden="true">${icon(m.id)}</span>${m.interactive ? badge('Interactive example') : badge('Specification brief')}</div>
        <h3>${e(m.title)}</h3>
        <p>${e(m.description)}</p>
        <div class="related card-actions">${actions.map(([label, module, tab]) => `<button class="text-button" data-module="${module}" data-tab="${tab}">${e(label)}</button>`).join('')}</div>
      </section>`;
    }).join('')}</div>`;
  }

  function overview() {
    const st = s();
    const ar = AR(), ap = AP();
    const recent = fixture(getCompany()).slice(-6).reverse();
    const actions = [['Journal register', 'accounting', 'register'], ['Trial balance', 'accounting', 'trial'], ['Chart of accounts', 'accounting', 'coa'], ['Receivables', 'accounting', 'receivables'], ['Payables', 'accounting', 'payables'], ['Ageing', 'accounting', 'ageing']];
    return `<div class="related overview-actions">${actions.map(([label, module, tab, primary]) => `<button class="button ${primary ? 'primary' : ''}" data-module="${module}" data-tab="${tab}">${e(label)}</button>`).join('')}</div>

    <div class="stats">
      <section class="stat"><span class="stat-label">Cash &amp; bank</span><strong class="value numeric">${money(CASH())}</strong><small>PKR · sample bank controls</small></section>
      <section class="stat"><span class="stat-label">Receivables</span><strong class="value numeric">${money(ar)}</strong><small>${CUSTOMERS.length} sample customers</small></section>
      <section class="stat"><span class="stat-label">Payables</span><strong class="value numeric">${money(ap)}</strong><small>${SUPPLIERS.length} sample suppliers</small></section>
      <section class="stat"><span class="stat-label">Profit for the period</span><strong class="value numeric">${money(num(st.profit))}</strong><small>${e(range().from)} to ${e(range().to)}</small></section>
    </div>

    <div class="two-column">
      <section class="panel overview-panel">
        <div class="panel-head"><h2>Cash movement</h2>${badge('November 2026')}</div>
        <div class="panel-body">${sparkline()}
          <div class="statement-line"><span>Revenue</span><strong class="numeric">${money(num(st.income))}</strong></div>
          <div class="statement-line"><span>Expenses</span><strong class="numeric">${money(num(st.expenses))}</strong></div>
          <div class="statement-line total"><span>Profit for the period</span><strong class="numeric">${money(num(st.profit))}</strong></div>
          <p class="form-note">Cash movement and the period result both derive from the same posted sample documents as the ledger.</p>
        </div>
      </section>
      <section class="panel overview-panel">
        <div class="panel-head"><h2>Close readiness</h2>${badge('1 of 5 complete')}</div>
        <div class="panel-body">
          ${[['Trial balance','Closing debits equal credits',1],['Bank reconciliation','Outstanding items need evidence',0],['Receivables review','Items over 60 days need a plan',0],['Depreciation','Draft charge ready for review',0],['Statements','Not started',0]].map(([title, note, done]) => `<div class="quiet-row"><div><strong>${e(title)}</strong><small>${e(note)}</small></div>${done ? badge('Done', 'good') : badge('Open', 'warn')}</div>`).join('')}
          <p class="form-note">A period lock requires reconciliation evidence, sign-off and an immutable snapshot.</p>
        </div>
      </section>
    </div>

    <div class="two-column overview-stack">
      <section class="panel overview-panel">
        <div class="panel-head"><h2>Recent journals</h2>${textButton('Open register','', 'data-module="accounting" data-tab="register"')}</div>
        <div class="table-scroll"><table><thead><tr><th>Date</th><th>Voucher</th><th>Narrative</th><th class="numeric">Debit PKR</th><th>State</th></tr></thead>
        <tbody>${recent.map((j) => `<tr>
          <td>${e(j.date)}</td>
          <td><button class="text-button" data-ac="source" data-value="${e(j.id)}">${e(j.id)}</button></td>
          <td>${e(j.narrative)}<small class="secondary">${e(j.party)}</small></td>
          <td class="numeric">${money(j.lines.reduce((n, l) => n + num(l.debit), 0))}</td>
          <td>${badge('Posted', 'good')}</td>
        </tr>`).join('')}</tbody></table></div>
      </section>
      <section class="panel overview-panel">
        <div class="panel-head"><h2>Ageing</h2>${textButton('Open ageing','', 'data-module="accounting" data-tab="ageing"')}</div>
        <div class="panel-body">${ageingTable(ar, ap)}</div>
      </section>
    </div>

    <section class="panel">
      <div class="panel-head"><h2>Accounting actions</h2>${badge('Grouped like ERPNext card breaks')}</div>
      <div class="panel-body">
        <div class="action-groups">
          ${[
            ['Financial statements', [['Profit or loss', 'statements'], ['Financial position', 'statements'], ['Notes and schedules', 'statements'], ['Trial balance', 'trial']]],
            ['Receivables and payables', [['Receivables', 'receivables'], ['Payables', 'payables'], ['Ageing', 'ageing'], ['Approvals', 'approvals']]],
            ['Registers and close', [['Journal register', 'register'], ['Chart of accounts', 'coa'], ['General ledger', 'ledger'], ['Period close', 'close']]],
          ].map(([title, links]) => `<div><div class="eyebrow">${e(title)}</div>${links.map(([label, tab]) => `<div class="quiet-row quiet-row--tight"><strong>${e(label)}</strong><button class="text-button" data-module="accounting" data-tab="${tab}">Open</button></div>`).join('')}</div>`).join('')}
        </div>
      </div>
    </section>

    <div class="home-section-title"><h2>Every module</h2><span class="muted">Actions open the module; accounting actions open the working screen</span></div>
    ${moduleGrid()}`;
  }

  function ageingTable(ar, ap) {
    const split = (value, names, kind) => {
      const parts = spread(value, names, kind);
      const out = Object.fromEntries(BUCKETS.map((b) => [b, 0]));
      for (const p of parts) out[bucketOf(p.age)] = round2(out[bucketOf(p.age)] + p.balance);
      return out;
    };
    const a = split(ar, CUSTOMERS, 'ar');
    const p = split(ap, SUPPLIERS, 'ap');
    return `<div class="table-scroll"><table>
      <thead><tr><th>Bucket</th><th class="numeric">Receivable PKR</th><th class="numeric">Payable PKR</th></tr></thead>
      <tbody>${BUCKETS.map((b) => `<tr><td>${b}</td><td class="numeric">${a[b] ? money(a[b]) : '—'}</td><td class="numeric">${p[b] ? money(p[b]) : '—'}</td></tr>`).join('')}</tbody>
      <tfoot><tr><td><strong>Total</strong></td><td class="numeric"><strong>${money(ar)}</strong></td><td class="numeric"><strong>${money(ap)}</strong></td></tr></tfoot>
    </table></div>
    <p class="form-note">Party spread is illustrative; each column reconciles to its control account.</p>`;
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

/* --------------------------------------------------------------- planned */
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

  return {overview, receivables: () => partyScreen('ar'), payables: () => partyScreen('ap'), ageing, approvals, planned};

}
