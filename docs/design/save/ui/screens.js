// Screens added on top of the retained saventesting build.
// Markup uses only the existing classes from ui/theme.css. No new styling,
// no shader, no animation. Every total that duplicates a ledger figure is
// derived from accounting-model.js so the screens cannot contradict it.
import {escape as e} from './model.js';
import {fixture,trial,statements} from './accounting-model.js';
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
  const filters = {from: '2026-11-01', to: '2026-11-30', account: '1010', party: '', type: '', q: '', open: ''};

  function ledgerRows() {
    const docs = fixture(getCompany()).filter((d) => d.date >= filters.from && d.date <= filters.to)
      .sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
    const rows = [];
    for (const d of docs) {
      if (filters.party && d.party !== filters.party) continue;
      if (filters.type && d.source !== filters.type) continue;
      for (const l of d.lines) {
        if (filters.account !== 'all' && l.account !== filters.account) continue;
        const acc = accounts().find((a) => a.code === l.account);
        const hay = `${d.id} ${d.narrative} ${d.party} ${l.account} ${acc ? acc.name : ''}`.toLowerCase();
        if (filters.q && !hay.includes(filters.q.toLowerCase())) continue;
        rows.push({id: d.id, date: d.date, party: d.party, source: d.source, narrative: d.narrative,
          account: l.account, accountName: acc ? acc.name : l.account,
          debit: num(l.debit), credit: num(l.credit), doc: d});
      }
    }
    return rows;
  }

  function openingBalance() {
    if (filters.account === 'all') return 0;
    return round2(fixture(getCompany()).filter((d) => d.date < filters.from)
      .reduce((n, d) => n + d.lines.filter((l) => l.account === filters.account)
        .reduce((m, l) => m + num(l.debit) - num(l.credit), 0), 0));
  }

  function gl() {
    const rows = ledgerRows();
    const opening = openingBalance();
    const debit = round2(rows.reduce((n, r) => n + r.debit, 0));
    const credit = round2(rows.reduce((n, r) => n + r.credit, 0));
    const single = filters.account !== 'all';
    const cols = single ? 8 : 9;
    let run = opening;
    const body = rows.map((r) => {
      if (single) run = round2(run + r.debit - r.credit);
      const open = filters.open === r.id + ':' + r.account;
      return `<tr data-gl-row="${e(r.id)}:${e(r.account)}" class="${open ? 'gl-open' : ''}">
          <td>${e(r.date)}</td>
          ${single ? '' : `<td><button class="text-button" data-gl-account="${e(r.account)}">${e(r.account)}</button></td>`}
          <td>${e(r.party)}</td>
          <td>${e(r.source)}</td>
          <td><button class="text-button" data-ac="source" data-value="${e(r.id)}">${e(r.id)}</button></td>
          <td class="gl-desc">${e(r.narrative)}${single ? '' : `<small class="secondary">${e(r.accountName)}</small>`}</td>
          <td class="numeric">${r.debit ? money(r.debit) : ''}</td>
          <td class="numeric">${r.credit ? money(r.credit) : ''}</td>
          ${single ? `<td class="numeric">${money(run)}</td>` : ''}
        </tr>` + (open ? detailRow(r, single) : '');
    }).join('');

    const accountOptions = [['all', 'All accounts'], ...accounts().filter((a) => a.active).map((a) => [a.code, a.code + ' - ' + a.name])];
    const parties = [...new Set(fixture(getCompany()).map((d) => d.party))].sort();
    const types = [...new Set(fixture(getCompany()).map((d) => d.source))].sort();

    return `<form id="gl-filter" class="filterbar gl-filter">
        <label>From<input name="from" type="date" value="${e(filters.from)}" required></label>
        <label>To<input name="to" type="date" value="${e(filters.to)}" required></label>
        <label>Account<select name="account">${accountOptions.map(([v, t]) => `<option value="${v}" ${v === filters.account ? 'selected' : ''}>${e(t)}</option>`).join('')}</select></label>
        <label>Party<select name="party"><option value="">All parties</option>${parties.map((p2) => `<option ${p2 === filters.party ? 'selected' : ''}>${e(p2)}</option>`).join('')}</select></label>
        <label>Voucher type<select name="type"><option value="">All types</option>${types.map((t) => `<option ${t === filters.type ? 'selected' : ''}>${e(t)}</option>`).join('')}</select></label>
        <label>Search<input name="q" type="search" value="${e(filters.q)}" placeholder="Voucher, party or description"></label>
        <button class="button primary">Apply</button>
      </form>

      <div class="stats gl-stats">
        <section class="stat"><span class="stat-label">Opening</span><strong class="value numeric">${money(opening)}</strong><small>${single ? 'Before ' + e(filters.from) : 'All accounts'}</small></section>
        <section class="stat"><span class="stat-label">Debit</span><strong class="value numeric">${money(debit)}</strong><small>${rows.length} lines</small></section>
        <section class="stat"><span class="stat-label">Credit</span><strong class="value numeric">${money(credit)}</strong><small>${e(filters.from)} to ${e(filters.to)}</small></section>
        <section class="stat"><span class="stat-label">Closing</span><strong class="value numeric">${money(round2(opening + debit - credit))}</strong><small>Opening + debit − credit</small></section>
      </div>

      <section class="panel">
        <div class="panel-head"><h2>${filters.account === 'all' ? 'All accounts' : e((accounts().find((a) => a.code === filters.account) || {}).name || filters.account)}</h2><div class="related"><span class="badge">${rows.length} lines</span><button class="button" data-gl-export="csv">Export CSV</button><button class="button" data-gl-print>Print</button></div></div>
        <div class="table-scroll gl-scroll">
          <table class="gl-table">
            <thead><tr>
              <th>Date</th>${single ? '' : '<th>Account</th>'}<th>Party</th><th>Voucher type</th><th>Voucher no</th><th class="gl-desc">Description</th>
              <th class="numeric">Debit</th><th class="numeric">Credit</th>${single ? '<th class="numeric">Balance</th>' : ''}
            </tr></thead>
            <tbody id="gl-rows">${body || `<tr><td colspan="${cols}"><div class="empty"><div class="empty-mark">?</div><h2>No ledger lines</h2><p>No posted line matches these filters.</p></div></td></tr>`}</tbody>
            <tfoot><tr><td colspan="5">Total</td><td class="numeric">${money(debit)}</td><td class="numeric">${money(credit)}</td>${single ? `<td class="numeric">${money(round2(opening + debit - credit))}</td>` : ''}</tr></tfoot>
          </table>
        </div>
        <div class="table-footer">Opening ${money(opening)} + debit ${money(debit)} − credit ${money(credit)} = ${money(round2(opening + debit - credit))}. Click any row for the full transaction.</div>
      </section>`;
  }

  function detailRow(r, single) {
    const d = r.doc;
    return `<tr class="gl-detail"><td colspan="9">
      <div class="gl-detail-grid">
        <div>
          <div class="eyebrow">Source document</div>
          <div class="record-summary">
            <div><small>Voucher</small>${e(d.id)}</div>
            <div><small>Date</small>${e(d.date)}</div>
            <div><small>Type</small>${e(d.source)}</div>
            <div><small>Party</small>${e(d.party)}</div>
          </div>
          <p class="form-note">${e(d.narrative)}</p>
        </div>
        <div>
          <div class="eyebrow">All lines in this document</div>
          <table class="compact-table"><thead><tr><th>Account</th><th class="numeric">Debit</th><th class="numeric">Credit</th></tr></thead>
          <tbody>${d.lines.map((l) => `<tr><td>${e(l.account)} ${e((accounts().find((a) => a.code === l.account) || {}).name || '')}</td><td class="numeric">${num(l.debit) ? money(num(l.debit)) : ''}</td><td class="numeric">${num(l.credit) ? money(num(l.credit)) : ''}</td></tr>`).join('')}</tbody>
          <tfoot><tr><td>Total</td><td class="numeric">${money(d.lines.reduce((n, l) => n + num(l.debit), 0))}</td><td class="numeric">${money(d.lines.reduce((n, l) => n + num(l.credit), 0))}</td></tr></tfoot></table>
        </div>
      </div>
    </td></tr>`;
  }

  function bindGL(rerender) {
    const form = document.querySelector('#gl-filter');
    if (form) form.addEventListener('submit', (ev) => {
      ev.preventDefault();
      Object.assign(filters, Object.fromEntries(new FormData(ev.target)));
      filters.open = '';
      rerender();
    });
    document.querySelector('#gl-rows')?.addEventListener('click', (ev) => {
      const acc = ev.target.closest('[data-gl-account]');
      if (acc) { filters.account = acc.dataset.glAccount; rerender(); return; }
      if (ev.target.closest('[data-ac]')) return;
      const tr = ev.target.closest('[data-gl-row]');
      if (!tr) return;
      filters.open = filters.open === tr.dataset.glRow ? '' : tr.dataset.glRow;
      rerender();
    });
    document.querySelector('[data-gl-print]')?.addEventListener('click', () => window.print());
    document.querySelector('[data-gl-export]')?.addEventListener('click', () => {
      const rows = ledgerRows();
      const lines = [['Date', 'Account', 'Party', 'Voucher type', 'Voucher no', 'Description', 'Debit', 'Credit'],
        ...rows.map((r) => [r.date, r.account, r.party, r.source, r.id, r.narrative, r.debit.toFixed(2), r.credit.toFixed(2)])];
      const csv = lines.map((l) => l.map((c) => `"${String(c).replaceAll('"', '""')}"`).join(',')).join('\r\n');
      const url = URL.createObjectURL(new Blob([csv], {type: 'text/csv;charset=utf-8'}));
      const a = document.createElement('a');
      a.href = url; a.download = 'SA7EN-general-ledger.csv'; a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    });
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

  const overview = dashboard;
  return {overview, dashboard, gl, bindGL, receivables: () => partyScreen('ar'), payables: () => partyScreen('ap'), ageing, approvals, planned};

}
