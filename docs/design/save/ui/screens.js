// Screens added on top of the retained saventesting build.
// Markup uses only the existing classes from ui/theme.css. No new styling,
// no shader, no animation. Every total that duplicates a ledger figure is
// derived from accounting-model.js so the screens cannot contradict it.
import {escape as e} from './model.js';
import {fixture,trial,statements,PROJECTS,LOCATIONS,COST_CENTRES,PARTIES,CASH_BANK,ITEMS,TAX_RULES,BANK_NAMES,CASH_NAMES,CUSTOM_FIELDS,NUMBERING,PARTY_GROUPS,ITEM_GROUPS,CURRENCIES,EXTRA_JOURNALS,chart} from './accounting-model.js';
import {icon} from './icons.js';
import {catalog} from './catalog.js';
import {PAGE} from './pages-map.js';


const ACCOUNT_CLASSES = [['asset', 'Assets'], ['liability', 'Liabilities'], ['equity', 'Equity'], ['income', 'Income'], ['expense', 'Expenses']];
const ACCOUNT_GROUPS = [
  {id: 'asset-01', class: 'asset', code: '01', name: 'Cash and bank', description: 'Cash tills and bank accounts', active: true},
  {id: 'asset-02', class: 'asset', code: '02', name: 'Receivables and advances', description: 'Trade receivables, advance tax and supplier advances', active: true},
  {id: 'asset-03', class: 'asset', code: '03', name: 'Inventory', description: 'Stock and work in progress', active: true},
  {id: 'asset-04', class: 'asset', code: '04', name: 'Tax assets', description: 'Recoverable input tax and tax receivables', active: true},
  {id: 'asset-05', class: 'asset', code: '05', name: 'Fixed assets', description: 'Property, vehicles and equipment at cost', active: true},
  {id: 'asset-06', class: 'asset', code: '06', name: 'Accumulated depreciation', description: 'Accumulated depreciation by asset class', active: true},
  {id: 'asset-07', class: 'asset', code: '07', name: 'Other assets', description: 'Prepayments and other assets', active: true},
  {id: 'liability-01', class: 'liability', code: '01', name: 'Payables', description: 'Trade payables to suppliers', active: true},
  {id: 'liability-02', class: 'liability', code: '02', name: 'Tax liabilities', description: 'Output tax, withholding and sales tax withheld', active: true},
  {id: 'liability-03', class: 'liability', code: '03', name: 'Advances', description: 'Customer advances received', active: true},
  {id: 'liability-04', class: 'liability', code: '04', name: 'Clearing', description: 'Goods received clearing', active: true},
  {id: 'liability-05', class: 'liability', code: '05', name: 'Loans and other', description: 'Borrowings and other liabilities', active: true},
  {id: 'equity-01', class: 'equity', code: '01', name: 'Capital and reserves', description: 'Capital, opening equity, retained earnings and revaluation', active: true},
  {id: 'income-01', class: 'income', code: '01', name: 'Sales — goods', description: 'Sale of inventory goods', active: true},
  {id: 'income-02', class: 'income', code: '02', name: 'Sales — services', description: 'Service income', active: true},
  {id: 'income-03', class: 'income', code: '03', name: 'Other income', description: 'Non-operating income', active: true},
  {id: 'income-04', class: 'income', code: '04', name: 'Sales returns', description: 'Contra income for returned goods', active: true},
  {id: 'expense-01', class: 'expense', code: '01', name: 'Cost of sales', description: 'Cost of goods and services sold', active: true},
  {id: 'expense-02', class: 'expense', code: '02', name: 'Operating expenses', description: 'Administration, selling and general', active: true},
  {id: 'expense-03', class: 'expense', code: '03', name: 'Payroll', description: 'Salaries, wages and benefits', active: true},
  {id: 'expense-04', class: 'expense', code: '04', name: 'Impairment and tax', description: 'Impairment, tax expense and other', active: true},
  {id: 'expense-05', class: 'expense', code: '05', name: 'Purchase returns', description: 'Contra expense for returned purchases', active: true},
];
const ACCOUNT_GROUP_MAP = {1000: 'Cash and bank', 1010: 'Cash and bank', 1020: 'Cash and bank', 1100: 'Receivables and advances', 1024: 'Receivables and advances', 1400: 'Receivables and advances', 1200: 'Inventory', 1300: 'Tax assets', 2100: 'Payables', 2150: 'Tax liabilities', 2200: 'Tax liabilities', 2210: 'Tax liabilities', 2300: 'Advances', 2400: 'Clearing', 3000: 'Capital and reserves', 3100: 'Capital and reserves', 4000: 'Sales — services', 4100: 'Sales returns', 5000: 'Operating expenses', 5100: 'Cost of sales', 5200: 'Purchase returns'};
function accountGroupFor(a) { return ACCOUNT_GROUP_MAP[a.code] || a.group || ''; }
function nextGroupCode(cls) {
  const nums = ACCOUNT_GROUPS.filter((g) => g.class === cls).map((g) => Number(g.code) || 0);
  return String((nums.length ? Math.max(...nums) : 0) + 1).padStart(2, '0');
}
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
  ['authorities', 'Authorities'],
  ['entries', 'Tax entries'],
  ['reconciliation', 'Parties'],
  ['defaults', 'Default accounts'],
];
let TAX_DEFAULTS = {output: '2200', input: '1300', withholdingIncome: '2150', withholdingSales: '2210', advanceIncome: '1400', advanceSales: '1024'};
let TAX_DEFAULT_AUTHORITIES = {output: 'AUTH-FBR', input: 'AUTH-FBR', advance_income: 'AUTH-FBR', advance_sales: 'AUTH-SRB', withholding_income: 'AUTH-FBR', withholding_sales: 'AUTH-SRB'};
const TAX_FIXTURE_AUTHORITIES = {...TAX_DEFAULT_AUTHORITIES};
let TAX_RULE_SEQ = 5;
let TAX_AFTER_DISCOUNT = true;
const TAX_KINDS = [
  ['input', 'Input tax'],
  ['output', 'Output tax'],
  ['advance_income', 'Advance income tax'],
  ['advance_sales', 'Advance sales tax'],
  ['withholding_income', 'Withholding — income tax'],
  ['withholding_sales', 'Withholding — sales tax'],
];
const TAX_NATURE_META = {
  input: {defaultKey: 'input', side: 'asset', party: '2100', fallback: '1300'},
  output: {defaultKey: 'output', side: 'liability', party: '1100', fallback: '2200'},
  advance_income: {defaultKey: 'advanceIncome', side: 'asset', party: '1100', fallback: '1400'},
  advance_sales: {defaultKey: 'advanceSales', side: 'asset', party: '1100', fallback: '1024'},
  withholding_income: {defaultKey: 'withholdingIncome', side: 'liability', party: '2100', fallback: '2150'},
  withholding_sales: {defaultKey: 'withholdingSales', side: 'liability', party: '2100', fallback: '2210'},
};
const TAX_AUTHORITIES = [
  {id: 'AUTH-FBR', name: 'FBR', jurisdiction: 'Federal', registration: 'FBR-STRN-001', frequency: 'Monthly', kinds: ['input', 'output', 'advance_income', 'withholding_income'], active: true},
  {id: 'AUTH-SRB', name: 'SRB — Sindh', jurisdiction: 'Sindh', registration: 'SRB-STRN-014', frequency: 'Monthly', kinds: ['input', 'output', 'advance_sales', 'withholding_sales'], active: true},
  {id: 'AUTH-PRA', name: 'PRA — Punjab', jurisdiction: 'Punjab', registration: 'PRA-STRN-022', frequency: 'Monthly', kinds: ['input', 'output', 'advance_sales', 'withholding_sales'], active: true},
];
let TAX_AUTH_SEQ = 4;
const TAX_RECONCILIATIONS = [];
let TAX_RECON_SEQ = 1;
const TAX_RECON_OPEN = new Set();
let TAX_AUTH_FILTER = {q: '', asof: '', cf: {}, sort: {key: 'name', dir: 'asc'}};
let TAX_PARTY_FILTER = {q: '', cf: {}, sort: {key: 'party', dir: 'asc'}};
const TAX_PARTY_STATUS = new Map();
let TAX_AUTH_TAB = 'output';
let TAX_PARTY_TAB = 'output';
let TAX_RECON_TAB = 'balances';
let TAX_RULE_FILTER = {q: '', cf: {}, sort: {key: 'code', dir: 'asc'}};
const TAX_ENTRY_FILTER = {q: '', from: '2026-11-01', to: '2026-11-30', cf: {}, sort: {key: 'date', dir: 'desc'}};
const TAX_RECON_FILTER = {q: '', from: '2026-11-01', to: '2026-11-30', cf: {}, sort: {key: 'date', dir: 'desc'}};
let REV_TAB = 'customer';
let ADV_PICK = '';
let ADV_TAB = 'balances';
let ADV_APPLY_PARTY = '';
let ADV_FILTER_PARTY = '';
const ADVANCES = [
  {id: 'ADV-2026-0001', party: 'Atlas Studio', direction: 'receive', date: '2026-11-10', amount: 25000, applied: 5000, method: 'Bank transfer', account: 'Standard Bank — current 0123456789', notes: 'Advance against the November programme'},
  {id: 'ADV-2026-0002', party: 'Willow Supplies', direction: 'pay', date: '2026-11-11', amount: 10000, applied: 0, method: 'Bank transfer', account: 'Meezan Bank — current 0987654321', notes: 'Advance for packaging materials'},
  {id: 'ADV-2026-0003', party: 'Sapphire Retail', direction: 'receive', date: '2026-11-14', amount: 4000, applied: 0, method: 'Cash', account: 'Front desk — A. Khan', notes: 'Counter advance'},
];
const ADVANCE_APPLIED = [
  {id: 'ADVA-2026-0001', advanceId: 'ADV-2026-0001', docId: 'DEMO-SI-291', party: 'Atlas Studio', amount: 5000, date: '2026-11-12'},
];
let ADV_SEQ = 4;
let ADV_APP_SEQ = 2;
function nextAdvanceAppId() { return 'ADVA-2026-' + String(ADV_APP_SEQ++).padStart(4, '0'); }
let TAX_ACTIVE = 'rules';
let PARTY_OPEN = '';
let PERIOD_LOCKED = false;
// Inline editing of master-data forms: the same form creates and updates.
const EDIT = {type: '', code: ''};
// Per-register filters. They survive a re-render because they live here.
const FILTERS = {
  cash: {q: '', kind: '', control: '', status: '', asof: '', location: '', cf: {}, sort: {key: 'code', dir: 'asc'}},
  parties: {q: '', type: '', status: '', asof: '', balance: '', cf: {}, sort: {key: 'code', dir: 'asc'}},
  items: {q: '', group: '', stock: '', status: ''},
  tax: {q: ''},
  payments: {q: '', direction: '', party: '', from: '', to: '', cf: {}, sort: {key: 'date', dir: 'desc'}},
  invoices: {q: '', party: '', from: '', to: '', cf: {}, sort: {key: 'date', dir: 'desc'}},
  invoiceReturns: {q: '', from: '', to: '', cf: {}, sort: {key: 'date', dir: 'desc'}},
  heads: {q: ''},
  projects: {q: ''},
  locations: {q: ''},
  centres: {q: ''},
  partygroups: {q: ''},
  itemgroups: {q: ''},
  people: {q: '', status: ''},
  views: {q: ''},
  print: {q: ''},
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
const PRINT_DOCUMENTS = ['Journal entry', 'Sales invoice', 'Purchase bill', 'Receipt', 'Payment', 'Delivery note', 'Goods receipt', 'Stock transfer', 'Stock count', 'Stock adjustment', 'Work order', 'Bill of material', 'Asset register', 'Depreciation schedule', 'Party statement', 'Trial balance', 'Financial statements'];
const PRINT_TEMPLATES = PRINT_DOCUMENTS.map((doc) => ({document: doc, name: doc + ' template', size: doc === 'Receipt' || doc === 'Payment' ? '80 mm' : 'A4', logo: true, qr: doc !== 'Journal entry', copies: doc === 'Sales invoice' || doc === 'Delivery note' ? 2 : 1, margin: 12, footer: 'Northstar Trading (Pvt) Ltd'}));
let PAY_FORM = {direction: 'receive', party: '', date: '2026-11-30', notes: '', lines: [{doc: '', method: 'bank', account: '', amount: ''}]};
const PAYMENTS = [];
const INVOICES = [];
const INV_TAB = {sales: 'invoices', purchase: 'invoices'};
const RETURNS = {sales: [], purchase: []};
const RET_SEQ = {sales: 301, purchase: 301};
const INV_PAY = {sales: false, purchase: false};
const INV_TENDERS = {sales: [{method: 'bank', account: '', amount: ''}], purchase: [{method: 'bank', account: '', amount: ''}]};
const RET_DRAFT = {
  sales: {invoice: '', date: '2026-11-30', reason: 'Damaged goods', notes: '', lines: []},
  purchase: {invoice: '', date: '2026-11-30', reason: 'Damaged goods', notes: '', lines: []},
};
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

export function createScreens({getCompany, range, navigate, notify, accounts, trialView}) {
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
    cf: {},
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
    const cf = GL.cf || {};
    return out.filter((r) => Object.entries(cf).every(([k, v]) => !v || !v.length || v.includes(String(colValue(r, k)))));
  }

  function colValue(r, key) {
    const map = {date: r.date, account: `${r.account} ${r.accountName}`, description: r.narrative, debit: r.debit, credit: r.credit, balance: r.balance, type: r.source, subtype: r.subtype, voucher: r.id, against: r.against, partyType: r.partyType, party: r.party, project: r.project, location: r.location, centre: r.centre, againstVoucher: r.againstVoucher, supplierRef: r.supplierRef};
    return map[key] !== undefined ? map[key] : r[key];
  }
  function colValueLabel(key, value) {
    if (['debit', 'credit', 'balance'].includes(key)) return money(Number(value) || 0);
    return value;
  }
  function colValueList(key) {
    const saved = GL.cf;
    GL.cf = {};
    const rows = ledgerRows();
    GL.cf = saved;
    const values = [...new Set(rows.map((r) => String(colValue(r, key) ?? '')).filter((v) => v !== ''))].sort((a, b) => a.localeCompare(b, undefined, {numeric: true}));
    return values.slice(0, 200);
  }
  function sortRows(rows, sort) {
    const dir = sort.dir === 'desc' ? -1 : 1;
    return rows.slice().sort((a, b) => {
      const x = colValue(a, sort.key), y = colValue(b, sort.key);
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
  function ms(name, label, options, selected, attr, emptyText) {
    const chosen = options.filter(([v]) => selected.includes(v));
    let text;
    if (attr) text = chosen.length === options.length ? 'All columns' : `${chosen.length} of ${options.length}`;
    else if (chosen.length === 0) text = emptyText || `All ${label.toLowerCase()}`;
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
          panel.style.left = Math.round(r.left) + 'px';
          panel.style.minWidth = Math.round(Math.max(r.width, 240)) + 'px';
          const below = window.innerHeight - r.bottom - 12;
          const above = r.top - 12;
          const height = Math.min(420, Math.max(180, panel.scrollHeight || 320));
          if (below < Math.min(height, 260) && above > below) {
            const h = Math.min(height, above);
            panel.style.top = Math.round(r.top - h - 6) + 'px';
            panel.style.maxHeight = h + 'px';
          } else {
            panel.style.top = Math.round(r.bottom + 6) + 'px';
            panel.style.maxHeight = Math.min(height, Math.max(below, 200)) + 'px';
          }
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
            <thead><tr>${cols.map(([key, label, , cls]) => {
              const sel = (GL.cf && GL.cf[key]) || [];
              const panel = key === 'date' ? '' : `<div class="col-filter-panel" data-glpp="${key}" hidden>
                  <div class="gl-sortrow"><span class="gl-sortlabel">Sort</span><button type="button" class="sort-toggle ${GL.sort.key === key ? 'active' : ''}" data-glptoggle="${key}" aria-label="Toggle sort" title="Toggle sort">${GL.sort.key === key ? (GL.sort.dir === 'asc' ? '↑' : '↓') : '↕'}</button></div>
                  <div class="ms-searchrow"><input class="ms-search col-filter-search" type="search" placeholder="Search values" aria-label="Search ${e(label)} values"></div>
                  <div class="ms-head"><button type="button" class="text-button" data-glpall="${key}">Select all</button><span class="ms-count">${colValueList(key).length}</span><button type="button" class="text-button" data-glpnone="${key}">Clear</button></div>
                  <div class="ms-list">${colValueList(key).map((v) => `<label class="ms-row"><input class="check" type="checkbox" value="${e(v)}" ${sel.includes(v) ? 'checked' : ''}><span>${e(colValueLabel(key, v))}</span></label>`).join('') || '<div class="ms-empty">No values</div>'}</div>
                  <div class="ms-empty" hidden>No match</div>
                  <div class="gl-applyrow"><button type="button" class="button primary" data-glpapply="${key}">Apply filter</button></div>
                </div>`;
              return `<th class="col col-${key} ${cls || ''}"><div class="th-flex"><button class="sortable" data-gl-sort="${key}" aria-sort="${GL.sort.key === key ? (GL.sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}">${label}<span class="sort-mark">${GL.sort.key === key ? (GL.sort.dir === 'asc' ? '▲' : '▼') : ''}</span></button>${key === 'date' ? '' : `<button type="button" class="col-filter-btn" data-glpf="${key}" aria-label="Filter ${e(label)}" aria-expanded="false">${icon('chevron')}${sel.length ? `<b>${sel.length}</b>` : ''}</button>`}</div>${panel}</th>`;
            }).join('')}</tr></thead>
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
    const has = (n) => Boolean(form.querySelector(`.ms[data-ms="${n}"]`));
    if (has('account')) GL.accounts = pick('account');
    if (has('party')) GL.parties = pick('party');
    if (has('project')) GL.projects = pick('project');
    if (has('location')) GL.locations = pick('location');
    if (has('centre')) GL.centres = pick('centre');
    if (has('type')) GL.types = pick('type');
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
    let glTimer = 0;
    filter?.querySelector('[name="q"]')?.addEventListener('input', (ev) => {
      GL.q = ev.target.value;
      const pos = ev.target.selectionStart;
      clearTimeout(glTimer);
      glTimer = setTimeout(() => {
        rerender();
        requestAnimationFrame(() => {
          const again = document.querySelector('#gl-filter [name="q"]');
          if (!again) return;
          again.focus({preventScroll: true});
          try { again.setSelectionRange(pos, pos); } catch {}
        });
      }, 150);
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
    let openFilter = '';
    const closePanels = (except) => {
      document.querySelectorAll('.col-filter-panel').forEach((p) => { if (p !== except) p.hidden = true; });
      document.querySelectorAll('[data-glpf]').forEach((b) => b.setAttribute('aria-expanded', 'false'));
    };
    const openPanel = (key) => {
      const btn = document.querySelector(`[data-glpf="${key}"]`);
      const panel = document.querySelector(`[data-glpp="${key}"]`);
      if (!btn || !panel) return;
      closePanels(panel);
      panel.hidden = false;
      btn.setAttribute('aria-expanded', 'true');
      const r = btn.getBoundingClientRect();
      panel.classList.add('col-filter-panel--fixed');
      const width = 270;
      const left = r.left > window.innerWidth / 2 ? r.right - width : r.left;
      panel.style.left = Math.round(Math.min(Math.max(8, left), window.innerWidth - width - 8)) + 'px';
      const top = Math.round(r.bottom + 4);
      const room = window.innerHeight - top - 12;
      panel.style.top = top + 'px';
      panel.style.maxHeight = Math.max(220, Math.min(380, room)) + 'px';
      const search = panel.querySelector('.col-filter-search');
      if (search) { search.value = ''; search.focus(); }
      openFilter = key;
    };
    document.querySelectorAll('[data-glpf]').forEach((btn) => btn.addEventListener('click', (ev) => {
      ev.stopPropagation();
      if (openFilter === btn.dataset.glpf) { closePanels(); openFilter = ''; GL.openFilter = ''; return; }
      GL.openFilter = btn.dataset.glpf;
      openPanel(btn.dataset.glpf);
    }));
    document.addEventListener('click', (ev) => {
      if (ev.target.closest('.col-filter-panel') || ev.target.closest('[data-glpf]')) return;
      closePanels();
      openFilter = '';
      GL.openFilter = '';
    }, {once: false});
    document.querySelectorAll('.col-filter-panel').forEach((panel) => {
      panel.addEventListener('click', (ev) => ev.stopPropagation());
      panel.querySelector('.col-filter-search')?.addEventListener('input', (ev) => {
        const q = ev.target.value.toLowerCase();
        panel.querySelectorAll('.ms-row').forEach((row) => { row.hidden = q && !row.textContent.toLowerCase().includes(q); });
        const empty = panel.querySelector('.ms-list ~ .ms-empty');
        if (empty) empty.hidden = [...panel.querySelectorAll('.ms-row')].some((r) => !r.hidden);
      });
      panel.querySelectorAll('input[type=checkbox]').forEach((box) => box.addEventListener('change', () => {
        panel.dataset.dirty = '1';
      }));
      panel.querySelector('[data-glpall]')?.addEventListener('click', () => {
        panel.querySelectorAll('input[type=checkbox]').forEach((b) => { if (!b.closest('.ms-row').hidden) b.checked = true; });
        panel.dataset.dirty = '1';
      });
      panel.querySelector('[data-glpnone]')?.addEventListener('click', () => {
        panel.querySelectorAll('input[type=checkbox]').forEach((b) => { b.checked = false; });
        panel.dataset.dirty = '1';
      });
    });
    document.querySelectorAll('[data-glpapply]').forEach((b) => b.addEventListener('click', () => {
      const key = b.dataset.glpapply;
      const panel = document.querySelector(`[data-glpp="${key}"]`);
      GL.cf = {...(GL.cf || {}), [key]: [...panel.querySelectorAll('input[type=checkbox]:checked')].map((x) => x.value)};
      GL.openFilter = '';
      rerender();
    }));
    document.querySelectorAll('[data-glptoggle]').forEach((b) => b.addEventListener('click', () => {
      const key = b.dataset.glptoggle;
      const dir = GL.sort.key === key && GL.sort.dir === 'asc' ? 'desc' : 'asc';
      GL.sort = {key, dir};
      closePanels();
      GL.openFilter = '';
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
      Object.assign(GL, {from: '2026-11-01', to: '2026-11-30', accounts: [], parties: [], projects: [], locations: [], centres: [], types: [], q: '', open: '', cf: {}, openFilter: ''});
      rerender();
    });
    document.querySelector('[data-jr-reset]')?.addEventListener('click', () => {
      Object.assign(J, {parties: [], subtypes: [], projects: [], locations: [], centres: [], q: '', cf: {}, from: '2026-11-01', to: '2026-11-30'});
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
    parties: [], projects: [], locations: [], centres: [], subtypes: [], q: '', from: '2026-11-01', to: '2026-11-30',
    sort: {key: 'date', dir: 'desc'}, record: '', session: [], removed: new Set(), cf: {}, openFilter: '',
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

  function journalColValue(r, key) {
    if (key.startsWith('custom:')) return r.doc['custom_' + key.slice(7).toLowerCase().replace(/[^a-z0-9]+/g, '_')] || '';
    const map = {date: r.date, voucher: r.id, description: r.narrative, debit: r.debit, credit: r.credit, state: r.state, type: r.doc.source, subtype: r.subtype, party: r.party, project: r.project, location: r.location, centre: r.centre};
    return map[key] !== undefined ? map[key] : r[key];
  }
  function sortRowsJ(rows, sort) {
    const dir = sort.dir === 'desc' ? -1 : 1;
    return rows.slice().sort((a, b) => {
      const x = journalColValue(a, sort.key), y = journalColValue(b, sort.key);
      if (typeof x === 'number' && typeof y === 'number') return (x - y) * dir;
      return String(x ?? '').localeCompare(String(y ?? '')) * dir;
    });
  }
  function journalColValues(key) {
    const saved = J.cf; J.cf = {};
    const rows = journalRows();
    J.cf = saved;
    return [...new Set(rows.map((r) => String(journalColValue(r, key) ?? '')).filter((v) => v !== ''))].sort((a, b) => a.localeCompare(b, undefined, {numeric: true})).slice(0, 200);
  }

  function journalRegister() {
    if (J.record) return recordPage(J.record);
    const cf = J.cf || {};
    const rows = journalRows().filter((r) => r.date >= J.from && r.date <= J.to && Object.entries(cf).every(([k, v]) => !v || !v.length || v.includes(String(journalColValue(r, k)))));
    const sortedRows = sortRowsJ(rows, J.sort);
    const customCols = CUSTOM_FIELDS.filter((f) => f.form === 'Journal entry').map((f) => [`custom:${f.name}`, f.name, (r) => e(r.doc['custom_' + f.name.toLowerCase().replace(/[^a-z0-9]+/g, '_')] || '—')]);
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
      ...customCols,
    ];
    const sortable = new Set(['date', 'voucher', 'description', 'debit', 'credit', 'subtype', 'party', 'project', 'location', 'centre']);

    const partyOpts = [...new Set(journalDocs().map((d) => d.party))].sort().map((x) => [x, x]);
    const subtypeOpts = [...new Set(journalDocs().map((d) => subtypeOf(d)))].sort().map((x) => [x, x]);
    const projectOpts = [['', 'No project'], ...PROJECTS.map((p2) => [p2.code, p2.code])];
    const locOpts = LOCATIONS.map((l) => [l.code, l.code]);
    const centreOpts = COST_CENTRES.map((c) => [c.name, c.name]);
    const extras = [['subtype', 'Subtype'], ['party', 'Party'], ['project', 'Project'], ['location', 'Location'], ['centre', 'Cost centre']];

    return `<form id="jr-filter" class="filterbar gl-filter">
        <label>From<input name="from" type="date" value="${e(J.from)}"></label>
        <label>To<input name="to" type="date" value="${e(J.to)}"></label>
        <label>Search<input name="q" type="search" value="${e(J.q)}" placeholder="Voucher, party or description"></label>
        <button class="button" type="button" data-jr-reset>Reset</button>
      </form>

      <div class="gl-toolrow">
        ${ms('columns', 'Columns', extras, [...J.extras], 'jr-col')}
        <span class="form-note"><span id="jr-col-count">${cols.length}</span> of ${cols.length} columns visible. Date, voucher, description, amounts and state are always shown; fields added to the entry form appear here automatically.</span>
      </div>

      <section class="panel">
        <div class="panel-head"><h2>Journals</h2><div class="related"><span class="badge">${rows.length} entries</span><button class="button" data-jr-export>Export CSV</button><button class="button" data-jr-print>Print</button></div></div>
        <div class="table-scroll gl-scroll" data-hscroll>
          <table class="gl-table jr-table" data-hide="${['subtype', 'party', 'project', 'location', 'centre'].filter((k) => !J.extras.has(k)).join(' ')}">
            <thead><tr>${cols.map(([key, label, , cls]) => {
              const sel = (J.cf && J.cf[key]) || [];
              return `<th class="col col-${key} ${cls || ''}"><div class="th-flex"><button class="sortable" data-jr-sort="${key}" aria-sort="${J.sort.key === key ? (J.sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}">${label}<span class="sort-mark">${J.sort.key === key ? (J.sort.dir === 'asc' ? '▲' : '▼') : ''}</span></button><button type="button" class="col-filter-btn" data-jrf="${key}" aria-label="Filter ${e(label)}" aria-expanded="false">${icon('chevron')}${sel.length ? `<b>${sel.length}</b>` : ''}</button></div>
                <div class="col-filter-panel" data-jrp="${key}" hidden>
                  <div class="gl-sortrow"><span class="gl-sortlabel">Sort</span><button type="button" class="sort-toggle ${J.sort.key === key ? 'active' : ''}" data-jrtoggle="${key}">${J.sort.key === key ? (J.sort.dir === 'asc' ? '↑' : '↓') : '↕'}</button></div>
                  <div class="ms-searchrow"><input class="ms-search jr-filter-search" type="search" placeholder="Search values"></div>
                  <div class="ms-head"><button type="button" class="text-button" data-jrall="${key}">Select all</button><span class="ms-count">${journalColValues(key).length}</span><button type="button" class="text-button" data-jrnone="${key}">Clear</button></div>
                  <div class="ms-list">${journalColValues(key).map((v) => `<label class="ms-row"><input class="check" type="checkbox" value="${e(v)}" ${sel.includes(v) ? 'checked' : ''}><span>${e(v)}</span></label>`).join('') || '<div class="ms-empty">No values</div>'}</div>
                  <div class="gl-applyrow"><button type="button" class="button primary" data-jrapply="${key}">Apply filter</button></div>
                </div></th>`;
            }).join('')}</tr></thead>
            <tbody id="jr-rows">${sortedRows.map((r) => `<tr data-jr-row="${e(r.id)}">
                ${cols.map(([key, , cell, cls]) => `<td class="col col-${key} ${cls || ''}">${cell(r)}</td>`).join('')}
              </tr>`).join('') || `<tr><td colspan="${cols.length}"><div class="empty"><div class="empty-mark">?</div><h2>No journals</h2><p>No entry matches these filters.</p></div></td></tr>`}</tbody>
            <tfoot><tr><td colspan="${cols.findIndex(([k]) => k === 'debit')}">Total</td><td class="numeric">${money(sortedRows.reduce((n, r) => n + r.debit, 0))}</td><td class="numeric">${money(sortedRows.reduce((n, r) => n + r.credit, 0))}</td><td colspan="${Math.max(0, cols.length - cols.findIndex(([k]) => k === 'debit') - 2)}"></td></tr></tfoot>
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
  function reverseJournalDoc(id) {
    const src = journalDocs().find((x) => x.id === id);
    if (!src) return '';
    const copy = {...src, id: 'JE-2026-R' + String(J.session.length + 101), state: 'draft', narrative: 'Reversal of ' + src.id, lines: src.lines.map((l) => ({...l, debit: l.credit, credit: l.debit}))};
    J.session.push(copy);
    return copy.id;
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
    const jrForm = document.querySelector('#jr-filter');
    jrForm?.querySelector('[name="from"]')?.addEventListener('change', (ev) => { J.from = ev.target.value; rerender(); });
    jrForm?.querySelector('[name="to"]')?.addEventListener('change', (ev) => { J.to = ev.target.value; rerender(); });
    let jrSearchTimer = 0;
    jrForm?.querySelector('[name="q"]')?.addEventListener('input', (ev) => {
      const pos = ev.target.selectionStart;
      J.q = ev.target.value;
      clearTimeout(jrSearchTimer);
      jrSearchTimer = setTimeout(() => {
        rerender();
        requestAnimationFrame(() => {
          const again = document.querySelector('#jr-filter [name="q"]');
          if (!again) return;
          again.focus({preventScroll: true});
          try { again.setSelectionRange(pos, pos); } catch {}
        });
      }, 150);
    });
    let jrOpen = '';
    const closeJrMenus = (except) => {
      document.querySelectorAll('[data-jrp]').forEach((p) => { if (p !== except) p.hidden = true; });
      document.querySelectorAll('[data-jrf]').forEach((b) => b.setAttribute('aria-expanded', 'false'));
    };
    const openJrMenu = (key) => {
      const btn = document.querySelector(`[data-jrf="${key}"]`);
      const panel = document.querySelector(`[data-jrp="${key}"]`);
      if (!btn || !panel) return;
      closeJrMenus(panel);
      panel.hidden = false;
      btn.setAttribute('aria-expanded', 'true');
      const r = btn.getBoundingClientRect();
      panel.classList.add('col-filter-panel--fixed');
      const left = r.left > window.innerWidth / 2 ? r.right - 270 : r.left;
      panel.style.left = Math.round(Math.min(Math.max(8, left), window.innerWidth - 278)) + 'px';
      const top = Math.round(r.bottom + 4);
      panel.style.top = top + 'px';
      panel.style.maxHeight = Math.max(220, Math.min(380, window.innerHeight - top - 12)) + 'px';
      const search = panel.querySelector('.jr-filter-search');
      if (search) { search.value = ''; search.focus(); }
      jrOpen = key;
    };
    document.querySelectorAll('[data-jrf]').forEach((b) => b.addEventListener('click', (ev) => {
      ev.stopPropagation();
      if (jrOpen === b.dataset.jrf) { closeJrMenus(); jrOpen = ''; return; }
      openJrMenu(b.dataset.jrf);
    }));
    document.addEventListener('click', (ev) => {
      if (ev.target.closest('.col-filter-panel') || ev.target.closest('[data-jrf]')) return;
      closeJrMenus(); jrOpen = '';
    });
    document.querySelectorAll('[data-jrp]').forEach((panel) => {
      panel.addEventListener('click', (ev) => ev.stopPropagation());
      panel.querySelector('.jr-filter-search')?.addEventListener('input', (ev) => {
        const q = ev.target.value.toLowerCase();
        panel.querySelectorAll('.ms-row').forEach((row) => { row.hidden = q && !row.textContent.toLowerCase().includes(q); });
      });
      panel.querySelector('[data-jrall]')?.addEventListener('click', () => { panel.querySelectorAll('input[type=checkbox]').forEach((b) => { if (!b.closest('.ms-row').hidden) b.checked = true; }); });
      panel.querySelector('[data-jrnone]')?.addEventListener('click', () => { panel.querySelectorAll('input[type=checkbox]').forEach((b) => { b.checked = false; }); });
    });
    document.querySelectorAll('[data-jrapply]').forEach((b) => b.addEventListener('click', () => {
      const key = b.dataset.jrapply;
      const panel = document.querySelector(`[data-jrp="${key}"]`);
      J.cf = {...(J.cf || {}), [key]: [...panel.querySelectorAll('input[type=checkbox]:checked')].map((x) => x.value)};
      closeJrMenus(); jrOpen = '';
      rerender();
    }));
    document.querySelectorAll('[data-jrtoggle]').forEach((b) => b.addEventListener('click', () => {
      const key = b.dataset.jrtoggle;
      J.sort = {key, dir: J.sort.key === key && J.sort.dir === 'asc' ? 'desc' : 'asc'};
      closeJrMenus(); jrOpen = '';
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
    const exportBtn = '<button class="button" data-export-table>Export CSV</button>';
    const editorLink = (form, code) => `data-settings-edit="${form}:${e(code)}"`;
    const headRows = accounts().filter((a) => hit(FILTERS.heads.q, a.code, a.name, a.type, a.group, a.description)).map((a) => `<tr class="row-link" ${editorLink('heads', a.code)}><td class="mono">${e(a.code)}</td><td>${e(a.name)}</td><td>${e(a.type)}</td><td>${e(a.group)}</td><td>${control(a)}</td><td class="numeric">${money(bal(a.code, 'opening'))}</td><td class="numeric">${money(bal(a.code, 'closingDebit') - bal(a.code, 'closingCredit'))}</td><td>${badge(a.active ? 'Active' : 'Archived', a.active ? 'good' : 'warn')}</td><td class="row-go">›</td></tr>`).join('');
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
          ${field('Payment prefix', NUMBERING.payment.prefix, `Number looks like ${NUMBERING.payment.prefix}-MM-YYYY-0001`, 'paymentPrefix')}
          ${field('Next payment number', String(NUMBERING.payment.next).padStart(NUMBERING.payment.padding || 4, '0'), '', 'paymentNext')}
          ${field('Receipt prefix', NUMBERING.receipt.prefix, `Number looks like ${NUMBERING.receipt.prefix}-MM-YYYY-0001`, 'receiptPrefix')}
          ${field('Next receipt number', String(NUMBERING.receipt.next).padStart(NUMBERING.receipt.padding || 4, '0'), '', 'receiptNext')}
          ${field('Number padding', String(NUMBERING.journal.padding), 'Digits after the prefix', 'padding')}
          <div class="related"><button class="button primary">Save numbering</button></div>
        </form>
        <div class="panel-body"><p class="form-note">A series is frozen once its first document exists; a deleted or cancelled number is never reused. Changing a prefix only affects documents that have not been created yet.</p></div>
      </section>`,
      accounts: `<section class="panel">
        <div class="panel-head"><h2>Control accounts</h2><span class="badge">From chart flags</span></div>
        <form class="panel-body form-grid" data-settings-save="defaults">
          <label>Trade receivables control<select name="ar" class="inline-input">${accounts().filter((a) => a.type === 'asset').map((a) => `<option value="${a.code}" ${a.code === '1100' ? 'selected' : ''}>${a.code} · ${e(a.name)}</option>`).join('')}</select></label>
          <label>Trade payables control<select name="ap" class="inline-input">${accounts().filter((a) => a.type === 'liability').map((a) => `<option value="${a.code}" ${a.code === '2100' ? 'selected' : ''}>${a.code} · ${e(a.name)}</option>`).join('')}</select></label>
          <label>Inventory account<select name="inventory" class="inline-input">${accounts().filter((a) => a.type === 'asset').map((a) => `<option value="${a.code}" ${a.code === '1200' ? 'selected' : ''}>${a.code} · ${e(a.name)}</option>`).join('')}</select></label>
          <label>Rounding / bank charges<select name="rounding" class="inline-input">${accounts().filter((a) => a.type === 'expense').map((a) => `<option value="${a.code}" ${a.code === '6500' ? 'selected' : ''}>${a.code} · ${e(a.name)}</option>`).join('')}</select></label>
          <label>Default bank control<select name="bank" class="inline-input">${accounts().filter((a) => a.control === 'bank').map((a) => `<option value="${a.code}">${a.code} · ${e(a.name)}</option>`).join('')}</select></label>
          <label>Default cash control<select name="cash" class="inline-input">${accounts().filter((a) => a.control === 'cash').map((a) => `<option value="${a.code}" ${a.code === '1000' ? 'selected' : ''}>${a.code} · ${e(a.name)}</option>`).join('')}</select></label>
          <div class="related"><button class="button primary">Save defaults</button></div>
        </form>
        <div class="panel-body"><p class="form-note">These are the general ledger controls: receivables, payables, inventory, rounding, bank and cash. Tax control accounts and authorities live in the <strong>Taxes</strong> module, so there is one source for each. A control account requires a party or sub-account on every line that uses it.</p></div>
      </section>`,
      heads: `<section class="panel">
        <div class="panel-head"><h2>Accounting heads</h2><div class="related"><span class="badge">${headRows.length} of ${accounts().length} heads</span>${exportBtn}${newBtn('New head', 'heads')}</div></div>
        <form class="filterbar" data-filter="heads">${filterInput('heads', FILTERS.heads.q, 'Code, name, accounting head, group')}<button class="button" type="button" data-filter-reset="heads">Reset</button></form>
        <div class="table-scroll" data-hscroll><table><thead><tr><th>Code</th><th>Account name</th><th>Accounting head</th><th>Accounting group</th><th>Control</th><th class="numeric">Opening</th><th class="numeric">Closing</th><th>State</th><th></th></tr></thead><tbody>${headRows}</tbody></table></div>
        <div class="table-footer">A head is the account itself. Its class decides where it appears in the trial balance; its control flag decides whether every line needs a party. Click a row to edit it.</div>
      </section>`,
      projects: `<section class="panel">
        <div class="panel-head"><h2>Projects</h2><div class="related"><span class="badge">${PROJECTS.filter((p) => hit(FILTERS.projects.q, p.code, p.name, p.manager)).length} of ${PROJECTS.length} projects</span>${exportBtn}${newBtn('New project', 'project')}</div></div>
        <form class="filterbar" data-filter="projects">${filterInput('projects', FILTERS.projects.q, 'Code, project, manager')}<button class="button" type="button" data-filter-reset="projects">Reset</button></form>
        <div class="table-scroll" data-hscroll><table><thead><tr><th>Code</th><th>Project</th><th>Manager</th><th>State</th><th>Start</th><th>End</th><th class="numeric">Budget</th><th></th></tr></thead><tbody>${PROJECTS.filter((p) => hit(FILTERS.projects.q, p.code, p.name, p.manager, p.status)).map((p) => `<tr class="row-link" ${editorLink('project', p.code)}><td class="mono">${e(p.code)}</td><td>${e(p.name)}</td><td>${e(p.manager || '—')}</td><td>${badge(p.status, p.status === 'active' ? 'good' : 'warn')}</td><td>${e(p.start || '—')}</td><td>${e(p.end || '—')}</td><td class="numeric">${money(p.budget || 0)}</td><td class="row-go">›</td></tr>`).join('') || '<tr><td colspan="8">No projects yet.</td></tr>'}</tbody></table></div>
        <div class="table-footer">Projects are a data field on transactions. They slice reports and never hold a balance.</div>
      </section>`,
      locations: `<section class="panel">
        <div class="panel-head"><h2>Locations</h2><div class="related"><span class="badge">${LOCATIONS.filter((l) => hit(FILTERS.locations.q, l.code, l.name, l.kind)).length} of ${LOCATIONS.length} locations</span>${exportBtn}${newBtn('New location', 'location')}</div></div>
        <form class="filterbar" data-filter="locations">${filterInput('locations', FILTERS.locations.q, 'Code, location, kind, address')}<button class="button" type="button" data-filter-reset="locations">Reset</button></form>
        <div class="table-scroll" data-hscroll><table><thead><tr><th>Code</th><th>Location</th><th>Kind</th><th>Address</th><th>Contact</th><th></th></tr></thead><tbody>${LOCATIONS.filter((l) => hit(FILTERS.locations.q, l.code, l.name, l.kind, l.address, l.contact)).map((l) => `<tr class="row-link" ${editorLink('location', l.code)}><td class="mono">${e(l.code)}</td><td>${e(l.name)}</td><td>${e(l.kind)}</td><td>${e(l.address || '—')}</td><td>${e(l.contact || '—')}</td><td class="row-go">›</td></tr>`).join('')}</tbody></table></div>
        <div class="table-footer">A branch is a location whose kind is branch. There is no separate branch field.</div>
      </section>`,
      centres: `<section class="panel">
        <div class="panel-head"><h2>Cost centres</h2><div class="related"><span class="badge">${COST_CENTRES.filter((c) => hit(FILTERS.centres.q, c.code, c.name)).length} of ${COST_CENTRES.length} cost centres</span>${exportBtn}${newBtn('New cost centre', 'centre')}</div></div>
        <form class="filterbar" data-filter="centres">${filterInput('centres', FILTERS.centres.q, 'Code, cost centre')}<button class="button" type="button" data-filter-reset="centres">Reset</button></form>
        <div class="table-scroll" data-hscroll><table><thead><tr><th>Code</th><th>Cost centre</th><th>Description</th><th>State</th><th></th></tr></thead><tbody>${COST_CENTRES.filter((c) => hit(FILTERS.centres.q, c.code, c.name, c.description)).map((c) => `<tr class="row-link" ${editorLink('centre', c.code)}><td class="mono">${e(c.code)}</td><td>${e(c.name)}</td><td>${e(c.description || '—')}</td><td>${badge(c.archived ? 'Archived' : 'Active', c.archived ? 'warn' : 'good')}</td><td class="row-go">›</td></tr>`).join('')}</tbody></table></div>
        <div class="table-footer">Cost centres slice expense and activity for internal reporting. They never hold a balance.</div>
      </section>`,
      partygroups: `<section class="panel">
        <div class="panel-head"><h2>Party groups</h2><div class="related"><span class="badge">${PARTY_GROUPS.filter((g) => hit(FILTERS.partygroups.q, g.code, g.name)).length} of ${PARTY_GROUPS.length} groups</span>${exportBtn}${newBtn('New party group', 'partygroups')}</div></div>
        <form class="filterbar" data-filter="partygroups">${filterInput('partygroups', FILTERS.partygroups.q, 'Code, group, description')}<button class="button" type="button" data-filter-reset="partygroups">Reset</button></form>
        <div class="table-scroll" data-hscroll><table><thead><tr><th>Code</th><th>Group</th><th>Applies to</th><th>Description</th><th></th></tr></thead><tbody>${PARTY_GROUPS.filter((g) => hit(FILTERS.partygroups.q, g.code, g.name, g.kind, g.description)).map((g) => `<tr class="row-link" ${editorLink('partygroups', g.code)}><td class="mono">${e(g.code)}</td><td>${e(g.name)}</td><td>${e(g.kind || 'both')}</td><td>${e(g.description || '—')}</td><td class="row-go">›</td></tr>`).join('')}</tbody></table></div>
        <div class="table-footer">Groups classify customers and suppliers for reporting and default terms. A party can belong to one group.</div>
      </section>`,
      itemgroups: `<section class="panel">
        <div class="panel-head"><h2>Item groups</h2><div class="related"><span class="badge">${ITEM_GROUPS.filter((g) => hit(FILTERS.itemgroups.q, g.code, g.name)).length} of ${ITEM_GROUPS.length} groups</span>${exportBtn}${newBtn('New item group', 'itemgroups')}</div></div>
        <form class="filterbar" data-filter="itemgroups">${filterInput('itemgroups', FILTERS.itemgroups.q, 'Code, group, description')}<button class="button" type="button" data-filter-reset="itemgroups">Reset</button></form>
        <div class="table-scroll" data-hscroll><table><thead><tr><th>Code</th><th>Group</th><th>Description</th><th></th></tr></thead><tbody>${ITEM_GROUPS.filter((g) => hit(FILTERS.itemgroups.q, g.code, g.name, g.description)).map((g) => `<tr class="row-link" ${editorLink('itemgroups', g.code)}><td class="mono">${e(g.code)}</td><td>${e(g.name)}</td><td>${e(g.description || '—')}</td><td class="row-go">›</td></tr>`).join('')}</tbody></table></div>
        <div class="table-footer">Item groups drive reporting and default accounts or tax rules. Inventory keeps the stock detail; this is the accounting view.</div>
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
    const order = [['numbering', 'Numbering'], ['accounts', 'Control accounts'], ['projects', 'Projects'], ['locations', 'Locations'], ['centres', 'Cost centres'], ['partygroups', 'Party groups'], ['itemgroups', 'Item groups'], ['approval', 'Approvals']];
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
      SETUP_TAB = form === 'heads' ? 'heads' : form === 'project' ? 'projects' : form === 'location' ? 'locations' : form === 'centre' ? 'centres' : form === 'partygroups' ? 'partygroups' : form === 'itemgroups' ? 'itemgroups' : SETUP_TAB;
      navigate({module: 'settings', tab: 'accounting', mode: 'editor', form, code: ''});
    }));
    document.querySelectorAll('[data-settings-edit]').forEach((tr) => tr.addEventListener('click', () => {
      const [form, code] = tr.dataset.settingsEdit.split(':');
      SETUP_TAB = form === 'heads' ? 'heads' : form === 'project' ? 'projects' : form === 'location' ? 'locations' : form === 'centre' ? 'centres' : form === 'partygroups' ? 'partygroups' : form === 'itemgroups' ? 'itemgroups' : SETUP_TAB;
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

  function nextCashCode() {
    const nums = CASH_BANK.filter((s) => /^CB-\d+$/.test(s.code)).map((s) => Number(s.code.slice(3)) || 0);
    return 'CB-' + String((nums.length ? Math.max(...nums) : 0) + 1).padStart(4, '0');
  }
  function cashColValue(x, key) {
    if (key === 'projects') return scopeText(x.projects);
    if (key === 'locations') return scopeText(x.locations);
    if (key === 'status') return x.status || 'Active';
    return x[key];
  }
  function cashColValues(key) {
    const rows = cashAccountRows(FILTERS.cash.asof || '');
    return [...new Set(rows.map((x) => String(cashColValue(x, key) ?? '')).filter((v) => v !== ''))].sort((a, b) => a.localeCompare(b, undefined, {numeric: true})).slice(0, 200);
  }
  function cashColLabel(key, v) {
    if (key === 'balance') return money(Number(v) || 0);
    if (key === 'control') { const head = accounts().find((a) => a.code === v); return head ? `${v} · ${head.name}` : v; }
    return v;
  }

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
    const tab = CASH_TAB === 'recon' ? 'recon' : 'register';
    const tabs = `<div class="tabs" role="tablist" aria-label="Cash and bank views"><button role="tab" aria-selected="${tab === 'register'}" data-cash-tab="register">Register</button><button role="tab" aria-selected="${tab === 'recon'}" data-cash-tab="recon">Reconciliation</button></div>`;
    if (tab === 'recon') return tabs + reconView('cash');
    const f = FILTERS.cash;
    const asOf = f.asof || '';
    const list = cashAccountRows(asOf);
    const head = (code) => accounts().find((a) => a.code === code);
    let rows = list.filter((x) => hit(f.q, x.code, x.name, x.reference, x.kind, head(x.control) ? head(x.control).name : '', x.projects.join(' '), x.locations.join(' '))
      && Object.entries(f.cf || {}).every(([k, v]) => !v || !v.length || v.includes(String(cashColValue(x, k)))));
    rows = rows.slice().sort((a, b) => {
      const x = cashColValue(a, f.sort.key), y = cashColValue(b, f.sort.key);
      const d = typeof x === 'number' && typeof y === 'number' ? x - y : String(x ?? '').localeCompare(String(y ?? ''), undefined, {numeric: true});
      return f.sort.dir === 'desc' ? -d : d;
    });
    const cols = [['code', 'Code'], ['name', 'Account'], ['kind', 'Kind'], ['control', 'Control head'], ['status', 'Status'], ['postings', 'Postings', 'numeric'], ['balance', 'Balance', 'numeric'], ['projects', 'Projects'], ['locations', 'Locations']];
    const cells = {
      code: (x) => `<td class="col col-code mono">${e(x.code)}</td>`,
      name: (x) => `<td class="col col-name">${e(x.name)}<small class="secondary">${e(x.reference || '')}</small></td>`,
      kind: (x) => `<td class="col col-kind">${badge(x.kind, x.kind === 'bank' ? 'plum' : '')}</td>`,
      control: (x) => `<td class="col col-control">${e(x.control)} · ${e(head(x.control) ? head(x.control).name : 'Unknown head')}</td>`,
      status: (x) => `<td class="col col-status">${badge(x.status || 'Active', (x.status || 'Active') === 'Active' ? 'good' : 'warn')}</td>`,
      postings: (x) => `<td class="col col-postings numeric">${x.postings}</td>`,
      balance: (x) => `<td class="col col-balance numeric">${money(x.balance)}${asOf ? `<small class="secondary">current ${money(x.current)}</small>` : ''}</td>`,
      projects: (x) => `<td class="col col-projects">${e(scopeText(x.projects))}</td>`,
      locations: (x) => `<td class="col col-locations">${e(scopeText(x.locations))}</td>`,
    };
    return tabs + `<form class="filterbar" data-filter="cash" data-cash-filter>
        ${filterInput('cash', f.q, 'Code, name, reference, project, location')}
        <label>Balances as at<input type="date" name="asof" value="${e(asOf)}" max="2026-12-31"></label>
        <button class="button" type="button" data-cash-reset>Reset to current</button>
      </form>
      <section class="panel">
        <div class="panel-head"><h2>Cash and bank sub-accounts</h2><div class="related"><span class="badge">${rows.length} of ${list.length} accounts</span><span class="badge">${asOf ? `balances as at ${e(asOf)}` : 'current balances'}</span><button class="button" data-export-table>Export CSV</button></div></div>
        <div class="table-scroll" data-hscroll><table>
          <thead><tr>${cols.map(([key, label, cls]) => {
            const sel = (f.cf && f.cf[key]) || [];
            return `<th class="col col-${key} ${cls || ''}"><div class="th-flex"><button class="sortable" data-cash-sort="${key}" aria-sort="${f.sort.key === key ? (f.sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}">${label}<span class="sort-mark">${f.sort.key === key ? (f.sort.dir === 'asc' ? '▲' : '▼') : ''}</span></button><button type="button" class="col-filter-btn" data-cashf="${key}" aria-label="Filter ${e(label)}" aria-expanded="false">${icon('chevron')}${sel.length ? `<b>${sel.length}</b>` : ''}</button></div>
              <div class="col-filter-panel" data-cashp="${key}" hidden><div class="gl-sortrow"><span class="gl-sortlabel">Sort</span><button type="button" class="sort-toggle ${f.sort.key === key ? 'active' : ''}" data-cashtoggle="${key}">${f.sort.key === key ? (f.sort.dir === 'asc' ? '↑' : '↓') : '↕'}</button></div>
              <div class="ms-searchrow"><input class="ms-search cash-filter-search" type="search" placeholder="Search values"></div>
              <div class="ms-head"><button type="button" class="text-button" data-cashall="${key}">Select all</button><span class="ms-count">${cashColValues(key).length}</span><button type="button" class="text-button" data-cashnone="${key}">Clear</button></div>
              <div class="ms-list">${cashColValues(key).map((v) => `<label class="ms-row"><input class="check" type="checkbox" value="${e(v)}" ${sel.includes(v) ? 'checked' : ''}><span>${e(cashColLabel(key, v))}</span></label>`).join('') || '<div class="ms-empty">No values</div>'}</div>
              <div class="gl-applyrow"><button type="button" class="button primary" data-cashapply="${key}">Apply filter</button></div></div></th>`;
          }).join('')}<th>Ledger</th></tr></thead>
          <tbody>${rows.map((x) => `<tr class="row-link" data-edit="cash:${e(x.code)}">${cols.map(([key]) => cells[key](x)).join('')}<td><button class="text-button" data-cash-ledger="${e(x.name)}">Open</button></td></tr>`).join('') || `<tr><td colspan="10">No cash or bank sub-account matches these filters.</td></tr>`}</tbody>
          <tfoot><tr><td colspan="6">Total shown · ${rows.length} of ${list.length}${asOf ? ` · as at ${e(asOf)}` : ' · current'}</td><td class="numeric">${money(round2(rows.reduce((n, x) => n + x.balance, 0)))}</td><td colspan="3"></td></tr></tfoot>
        </table></div>
        <div class="table-footer">A sub-account is the party inside a control head. Any head flagged as a bank or cash control can hold sub-accounts. Click a row to open its form. Set a date to see the balance as it stood then; the small figure under it stays the current balance. Reset returns to current.</div>
      </section>`;
  }

  /* -------------------------------------------------- reconciliations */
  let CASH_TAB = 'register';
  let PARTY_TAB = 'register';
  const RECONCILIATIONS = {cash: [], party: []};
  const PARTY_CHANGES = [];
  const PARTY_FILES = {};
  const CASH_FILES = {};
  const RECON_FILTER = {q: '', from: '', to: '', cf: {}, sort: {key: 'date', dir: 'desc'}, kind: ''};
  const RECON_FORM = {
    cash: {account: '', date: '2026-11-30', original: '', diffs: [{reason: '', reference: '', amount: ''}], files: []},
    party: {account: '', date: '2026-11-30', original: '', diffs: [{reason: '', reference: '', amount: ''}], files: []},
  };

  function systemBalanceCash(name, date) {
    const row = cashAccountRows(date).find((r) => r.name === name);
    return row ? round2(row.balance) : 0;
  }
  function systemBalanceParty(name, date) {
    const row = partyRows(date).find((p) => p.name === name);
    return row ? round2(row.balance) : 0;
  }
  function reconRows(kind) { return RECONCILIATIONS[kind].slice().sort((a, b) => b.date.localeCompare(a.date)); }
  function reconState(r) { return r.state === 'cancelled' ? 'Cancelled' : Math.abs(r.unreconciled) < 0.01 ? 'Reconciled' : 'Difference'; }
  function reconColValue(r, key) {
    if (key === 'state') return reconState(r);
    if (key === 'account' || key === 'date') return r[key];
    return round2(Number(r[key]) || 0);
  }
  function reconColValues(kind, key) {
    return [...new Set(reconRows(kind).map((r) => String(reconColValue(r, key))))].sort((a, b) => a.localeCompare(b, undefined, {numeric: true})).slice(0, 200);
  }
  function reconColLabel(key, v) { return ['system', 'diffTotal', 'original', 'unreconciled'].includes(key) ? money(Number(v) || 0) : v; }
  function reconSystem(kind, account, date) { return kind === 'cash' ? systemBalanceCash(account, date) : systemBalanceParty(account, date); }
  function reconTotal(form) { return round2((form.diffs || []).reduce((n, d) => n + (Number(d.amount) || 0), 0)); }
  function reconUnreconciled(kind, form) { const system = form.account ? reconSystem(kind, form.account, form.date) : 0; return round2((Number(form.original) || 0) - (system + reconTotal(form))); }

  function reconView(kind) {
    const isCash = kind === 'cash';
    const rf = RECON_FILTER;
    if (rf.kind !== kind) { rf.kind = kind; rf.cf = {}; rf.sort = {key: 'date', dir: 'desc'}; }
    const cols = [['date', 'Date'], ['account', isCash ? 'Cash / bank account' : 'Party'], ['system', 'System balance', 'numeric'], ['diffTotal', 'Differences', 'numeric'], ['original', 'Original balance', 'numeric'], ['unreconciled', 'Unreconciled', 'numeric'], ['state', 'State']];
    let rows = reconRows(kind).filter((r) => (!rf.q || (r.id + ' ' + r.account + ' ' + r.date).toLowerCase().includes(rf.q.toLowerCase()))
      && (!rf.from || r.date >= rf.from) && (!rf.to || r.date <= rf.to)
      && Object.entries(rf.cf || {}).every(([k, v]) => !v || !v.length || v.includes(String(reconColValue(r, k)))));
    rows = rows.slice().sort((a, b) => { const x = reconColValue(a, rf.sort.key), y = reconColValue(b, rf.sort.key); const d = typeof x === 'number' && typeof y === 'number' ? x - y : String(x ?? '').localeCompare(String(y ?? '')); return rf.sort.dir === 'desc' ? -d : d; });
    return `<form class="filterbar" data-recon-filter>
        <label>Search<input type="search" name="q" value="${e(rf.q)}" placeholder="Record, account, date"></label>
        <label>From<input type="date" name="from" value="${e(rf.from)}"></label>
        <label>To<input type="date" name="to" value="${e(rf.to)}"></label>
        <button class="button" type="button" data-recon-reset>Reset</button>
      </form>
      <section class="panel">
      <div class="panel-head"><h2>${isCash ? 'Cash and bank reconciliations' : 'Party reconciliations'}</h2><div class="related"><span class="badge">${rows.length} records</span><button class="button" data-export-table>Export CSV</button><button class="button" data-recon-print-all>Print register</button><button class="button" data-recon-new="${kind}">New reconciliation</button></div></div>
      <div class="table-scroll" data-hscroll><table><thead><tr>${cols.map(([key, label, cls]) => {
        const sel = (rf.cf && rf.cf[key]) || [];
        return `<th class="col col-${key} ${cls || ''}"><div class="th-flex"><button class="sortable" data-recon-sort="${key}" aria-sort="${rf.sort.key === key ? (rf.sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}">${label}<span class="sort-mark">${rf.sort.key === key ? (rf.sort.dir === 'asc' ? '▲' : '▼') : ''}</span></button><button type="button" class="col-filter-btn" data-reconf="${key}" aria-label="Filter ${e(label)}" aria-expanded="false">${icon('chevron')}${sel.length ? `<b>${sel.length}</b>` : ''}</button></div>
          <div class="col-filter-panel" data-reconp="${key}" hidden><div class="gl-sortrow"><span class="gl-sortlabel">Sort</span><button type="button" class="sort-toggle ${rf.sort.key === key ? 'active' : ''}" data-recontoggle="${key}">${rf.sort.key === key ? (rf.sort.dir === 'asc' ? '↑' : '↓') : '↕'}</button></div>
          <div class="ms-searchrow"><input class="ms-search recon-filter-search" type="search" placeholder="Search values"></div>
          <div class="ms-head"><button type="button" class="text-button" data-reconall="${key}">Select all</button><span class="ms-count">${reconColValues(kind, key).length}</span><button type="button" class="text-button" data-reconnone="${key}">Clear</button></div>
          <div class="ms-list">${reconColValues(kind, key).map((v) => `<label class="ms-row"><input class="check" type="checkbox" value="${e(v)}" ${sel.includes(v) ? 'checked' : ''}><span>${e(reconColLabel(key, v))}</span></label>`).join('') || '<div class="ms-empty">No values</div>'}</div>
          <div class="gl-applyrow"><button type="button" class="button primary" data-reconapply="${key}">Apply filter</button></div></div></th>`;
      }).join('')}</tr></thead>
      <tbody>${rows.map((r) => `<tr class="row-link" data-recon-open="${kind}:${e(r.id)}"><td>${r.date}</td><td>${e(r.account)}</td><td class="numeric">${money(r.system)}</td><td class="numeric">${money(r.diffTotal)}</td><td class="numeric">${money(r.original)}</td><td class="numeric">${money(r.unreconciled)}</td><td>${badge(reconState(r), r.state === 'cancelled' ? 'warn' : Math.abs(r.unreconciled) < 0.01 ? 'good' : 'warn')}</td></tr>`).join('') || `<tr><td colspan="7">No ${isCash ? 'cash' : 'party'} reconciliations recorded yet.</td></tr>`}</tbody></table></div>
      <div class="table-footer">A reconciliation records what was checked, when, against which balance, with each difference and its reference. Click a row to open it; it is a record, not an automatic matching engine.</div></section>`;
  }

  function reconEditor(kind, code) {
    const isCash = kind === 'cash';
    const editing = code ? RECONCILIATIONS[kind].find((r) => r.id === code) : null;
    if (editing && !RECON_FORM[kind].editingId) {
      RECON_FORM[kind] = {editingId: editing.id, account: editing.account, date: editing.date, original: String(editing.original), diffs: (editing.diffs || []).map((d) => ({...d})), files: (editing.files || []).slice()};
    }
    if (!editing) RECON_FORM[kind].editingId = '';
    const f = RECON_FORM[kind];
    const options = isCash ? CASH_BANK.map((c) => [c.name, `${c.name} · ${c.control}`]) : PARTIES.map((p) => [p.name, `${p.name} · ${p.code}`]);
    const system = f.account ? reconSystem(kind, f.account, f.date) : 0;
    const total = reconTotal(f);
    const unrec = round2((Number(f.original) || 0) - (system + total));
    return `<section class="panel">
      <div class="panel-head"><h2>${editing ? 'Edit reconciliation' : 'New reconciliation'}</h2><span class="badge">${isCash ? 'Cash / bank' : 'Party'}</span></div>
      <form data-recon-form="${kind}" class="panel-body form-grid">
        <input type="hidden" name="editingCode" value="${e(f.editingId || '')}">
        <label>${isCash ? 'Cash / bank sub-account' : 'Party'}<select name="account" class="inline-input" required><option value="">Choose</option>${options.map(([v, l]) => `<option value="${e(v)}" ${v === f.account ? 'selected' : ''}>${e(l)}</option>`).join('')}</select></label>
        <label>Date<input name="date" type="date" value="${e(f.date)}" required></label>
        <label>System closing balance<input id="recon-system" value="${f.account ? system.toFixed(2) : 'Choose an account first'}" readonly></label>
        <label>Original balance ${isCash ? '(statement)' : '(party statement)'}<input name="original" id="recon-original" inputmode="decimal" value="${e(f.original)}" placeholder="0.00" required></label>
        <div class="wide"><div class="section-title">Differences</div>
          <div class="table-scroll"><table class="invoice-lines"><thead><tr><th>Reason</th><th>Reference</th><th class="numeric">Amount</th><th></th></tr></thead><tbody id="recon-diffs">
            ${f.diffs.map((d, i) => `<tr data-recon-diff="${i}"><td class="recon-reason"><input data-rd="reason" value="${e(d.reason)}" placeholder="Bank charges, timing, error"></td><td class="recon-ref"><input data-rd="reference" value="${e(d.reference)}" placeholder="Slip or document"></td><td class="recon-amt"><input class="numeric" data-rd="amount" value="${e(d.amount)}" inputmode="decimal"></td><td class="recon-remove"><button type="button" class="text-button" data-recon-remove="${i}">Remove</button></td></tr>`).join('')}
          </tbody></table></div>
          <div class="related"><button type="button" class="button" data-recon-add>Add difference row</button></div>
          <p class="form-note">Differences explain the gap; unreconciled = original − (system + differences).</p>
        </div>
        <div class="wide"><div class="record-summary recon-summary" id="recon-summary"><div><small>System</small>${money(system)}</div><div><small>Differences</small>${money(total)}</div><div><small>Original</small>${money(Number(f.original) || 0)}</div><div><small>Unreconciled</small><span class="badge ${Math.abs(unrec) < 0.01 ? 'good' : 'warn'}">${money(unrec)}</span></div></div></div>
        <div class="wide"><span class="ms-label">Supporting files</span><div class="related"><label class="button">Choose files<input type="file" multiple data-recon-files class="sr-only"></label><span class="form-note">PDF, image or CSV</span></div></div>
        ${f.files.length ? `<div class="wide"><ul class="contract-list file-list">${f.files.map((n, i) => `<li><span>${e(n)}</span>${button('Remove', 'recon-file', 'data-value="' + i + '"')}</li>`).join('')}</ul></div>` : ''}
        <div class="related"><button class="button primary">Save reconciliation</button>${editing ? `<button type="button" class="button" data-recon-cancel-rec>Cancel record</button><button type="button" class="button" data-recon-delete-rec>Delete record</button>` : ''}<button type="button" class="button" data-recon-cancel>Close</button><button type="button" class="button" onclick="window.print()">Print</button></div>
      </form>
    </section>`;
  }

  function captureRecon(kind, form) {
    const v = Object.fromEntries(new FormData(form));
    RECON_FORM[kind] = {
      ...RECON_FORM[kind],
      account: v.account,
      date: v.date,
      original: v.original,
      diffs: [...form.querySelectorAll('[data-recon-diff]')].map((tr) => ({reason: tr.querySelector('[data-rd="reason"]').value, reference: tr.querySelector('[data-rd="reference"]').value, amount: tr.querySelector('[data-rd="amount"]').value})),
    };
    return v;
  }
  function bindRecon(rerender, notify, navigate) {
    const rf = document.querySelector('[data-recon-filter]');
    if (rf) {
      let reconTimer = 0;
      rf.querySelector('[name="q"]')?.addEventListener('input', (ev) => {
        RECON_FILTER.q = ev.target.value;
        const pos = ev.target.selectionStart;
        clearTimeout(reconTimer);
        reconTimer = setTimeout(() => {
          rerender();
          requestAnimationFrame(() => { const a = document.querySelector('[data-recon-filter] [name="q"]'); if (!a) return; a.focus({preventScroll: true}); try { a.setSelectionRange(pos, pos); } catch {} });
        }, 150);
      });
      rf.querySelector('[name="from"]')?.addEventListener('change', (ev) => { RECON_FILTER.from = ev.target.value; rerender(); });
      rf.querySelector('[name="to"]')?.addEventListener('change', (ev) => { RECON_FILTER.to = ev.target.value; rerender(); });
      rf.querySelector('[data-recon-reset]')?.addEventListener('click', () => { Object.assign(RECON_FILTER, {q: '', from: '', to: '', cf: {}}); rerender(); });
    }
    document.querySelectorAll('[data-cash-tab]').forEach((b) => b.addEventListener('click', () => { CASH_TAB = b.dataset.cashTab; rerender(); }));
    document.querySelectorAll('[data-party-tab]').forEach((b) => b.addEventListener('click', () => { PARTY_TAB = b.dataset.partyTab; rerender(); }));
    document.querySelectorAll('[data-recon-sort]').forEach((b) => b.addEventListener('click', () => {
      const key = b.dataset.reconSort;
      RECON_FILTER.sort = {key, dir: RECON_FILTER.sort.key === key && RECON_FILTER.sort.dir === 'asc' ? 'desc' : 'asc'};
      rerender();
    }));
    let reconOpen = '';
    const closeReconMenus = (except) => {
      document.querySelectorAll('[data-reconp]').forEach((p) => { if (p !== except) p.hidden = true; });
      document.querySelectorAll('[data-reconf]').forEach((b) => b.setAttribute('aria-expanded', 'false'));
    };
    const openReconMenu = (key) => {
      const btn = document.querySelector(`[data-reconf="${key}"]`);
      const panel = document.querySelector(`[data-reconp="${key}"]`);
      if (!btn || !panel) return;
      closeReconMenus(panel);
      panel.hidden = false;
      btn.setAttribute('aria-expanded', 'true');
      const r = btn.getBoundingClientRect();
      panel.classList.add('col-filter-panel--fixed');
      const left = r.left > window.innerWidth / 2 ? r.right - 270 : r.left;
      panel.style.left = Math.round(Math.min(Math.max(8, left), window.innerWidth - 278)) + 'px';
      const top = Math.round(r.bottom + 4);
      panel.style.top = top + 'px';
      panel.style.maxHeight = Math.max(220, Math.min(380, window.innerHeight - top - 12)) + 'px';
      const search = panel.querySelector('.recon-filter-search');
      if (search) { search.value = ''; search.focus(); }
      reconOpen = key;
    };
    document.querySelectorAll('[data-reconf]').forEach((b) => b.addEventListener('click', (ev) => {
      ev.stopPropagation();
      if (reconOpen === b.dataset.reconf) { closeReconMenus(); reconOpen = ''; return; }
      openReconMenu(b.dataset.reconf);
    }));
    document.addEventListener('click', (ev) => {
      if (ev.target.closest('.col-filter-panel') || ev.target.closest('[data-reconf]')) return;
      closeReconMenus(); reconOpen = '';
    });
    document.querySelectorAll('[data-reconp]').forEach((panel) => {
      panel.addEventListener('click', (ev) => ev.stopPropagation());
      panel.querySelector('.recon-filter-search')?.addEventListener('input', (ev) => {
        const q = ev.target.value.toLowerCase();
        panel.querySelectorAll('.ms-row').forEach((row) => { row.hidden = q && !row.textContent.toLowerCase().includes(q); });
      });
      panel.querySelector('[data-reconall]')?.addEventListener('click', () => { panel.querySelectorAll('input[type=checkbox]').forEach((b) => { if (!b.closest('.ms-row').hidden) b.checked = true; }); });
      panel.querySelector('[data-reconnone]')?.addEventListener('click', () => { panel.querySelectorAll('input[type=checkbox]').forEach((b) => { b.checked = false; }); });
    });
    document.querySelectorAll('[data-reconapply]').forEach((b) => b.addEventListener('click', () => {
      const key = b.dataset.reconapply;
      const panel = document.querySelector(`[data-reconp="${key}"]`);
      RECON_FILTER.cf = {...(RECON_FILTER.cf || {}), [key]: [...panel.querySelectorAll('input[type=checkbox]:checked')].map((x) => x.value)};
      closeReconMenus(); reconOpen = '';
      rerender();
    }));
    document.querySelectorAll('[data-recontoggle]').forEach((b) => b.addEventListener('click', () => {
      const key = b.dataset.recontoggle;
      const dir = RECON_FILTER.sort.key === key && RECON_FILTER.sort.dir === 'asc' ? 'desc' : 'asc';
      RECON_FILTER.sort = {key, dir};
      closeReconMenus(); reconOpen = '';
      rerender();
    }));
    document.querySelectorAll('[data-recon-new]').forEach((b) => b.addEventListener('click', () => {
      const kind = b.dataset.reconNew;
      RECON_FORM[kind] = {account: '', date: '2026-11-30', original: '', diffs: [{reason: '', reference: '', amount: ''}], files: []};
      navigate({module: 'accounting', tab: kind === 'cash' ? 'cash' : 'parties', mode: 'editor', form: 'recon'});
    }));
    document.querySelectorAll('[data-recon-open]').forEach((b) => b.addEventListener('click', () => {
      const [kind, id] = b.dataset.reconOpen.split(':');
      RECON_FORM[kind] = {editingId: id, account: '', date: '2026-11-30', original: '', diffs: [], files: []};
      navigate({module: 'accounting', tab: kind === 'cash' ? 'cash' : 'parties', mode: 'editor', form: 'recon', code: id});
    }));
    document.querySelector('[data-recon-cancel]')?.addEventListener('click', () => {
      const kind = document.querySelector('[data-recon-form]')?.dataset.reconForm || 'cash';
      navigate({module: 'accounting', tab: kind === 'cash' ? 'cash' : 'parties'});
    });
    document.querySelector('[data-recon-print-all]')?.addEventListener('click', () => window.print());
    document.querySelector('[data-recon-cancel-rec]')?.addEventListener('click', () => {
      const form = document.querySelector('[data-recon-form]'); if (!form) return;
      const kind = form.dataset.reconForm, id = RECON_FORM[kind].editingId;
      const rec = RECONCILIATIONS[kind].find((r) => r.id === id);
      if (rec) { rec.state = 'cancelled'; notify('Reconciliation cancelled; it stays in the register.'); }
      navigate({module: 'accounting', tab: kind === 'cash' ? 'cash' : 'parties'});
    });
    document.querySelector('[data-recon-delete-rec]')?.addEventListener('click', () => {
      const form = document.querySelector('[data-recon-form]'); if (!form) return;
      const kind = form.dataset.reconForm, id = RECON_FORM[kind].editingId;
      const index = RECONCILIATIONS[kind].findIndex((r) => r.id === id);
      if (index >= 0) { RECONCILIATIONS[kind].splice(index, 1); notify('Reconciliation deleted from the register.'); }
      navigate({module: 'accounting', tab: kind === 'cash' ? 'cash' : 'parties'});
    });
    const form = document.querySelector('[data-recon-form]');
    if (!form) return;
    const kind = form.dataset.reconForm;
    form.querySelector('[name="account"]')?.addEventListener('change', () => { captureRecon(kind, form); rerender(); });
    form.querySelector('[name="date"]')?.addEventListener('change', () => { captureRecon(kind, form); rerender(); });
    form.querySelector('[data-recon-add]')?.addEventListener('click', () => { captureRecon(kind, form); RECON_FORM[kind].diffs.push({reason: '', reference: '', amount: ''}); rerender(); });
    form.querySelectorAll('[data-recon-remove]').forEach((b) => b.addEventListener('click', () => { captureRecon(kind, form); RECON_FORM[kind].diffs.splice(Number(b.dataset.reconRemove), 1); rerender(); }));
    form.querySelector('[data-recon-files]')?.addEventListener('change', (ev) => { captureRecon(kind, form); RECON_FORM[kind].files.push(...[...ev.target.files].map((f) => f.name)); ev.target.value = ''; rerender(); });
    document.querySelectorAll('[data-recon-remove-file], [data-ac="recon-file"]').forEach((b) => b.addEventListener('click', () => { captureRecon(kind, form); RECON_FORM[kind].files.splice(Number(b.dataset.value), 1); rerender(); }));
    form.addEventListener('input', (ev) => {
      if (!ev.target.matches('[data-rd="amount"], #recon-original')) return;
      captureRecon(kind, form);
      const f = RECON_FORM[kind];
      const system = f.account ? reconSystem(kind, f.account, f.date) : 0;
      const unrec = round2((Number(f.original) || 0) - (system + reconTotal(f)));
      const box = document.getElementById('recon-summary');
      if (box) box.innerHTML = `<div><small>System</small>${money(system)}</div><div><small>Differences</small>${money(reconTotal(f))}</div><div><small>Original</small>${money(Number(f.original) || 0)}</div><div><small>Unreconciled</small><span class="badge ${Math.abs(unrec) < 0.01 ? 'good' : 'warn'}">${money(unrec)}</span></div>`;
    });
    form.addEventListener('submit', (ev) => {
      ev.preventDefault();
      if (!form.reportValidity()) return;
      const v = captureRecon(kind, form);
      if (!v.account) { notify('Choose the account or party first.'); return; }
      const system = reconSystem(kind, v.account, v.date);
      const diffs = RECON_FORM[kind].diffs.filter((d) => Number(d.amount) || d.reason).map((d) => ({reason: d.reason, reference: d.reference, amount: Number(d.amount) || 0}));
      const diffTotal = round2(diffs.reduce((n, d) => n + d.amount, 0));
      const original = round2(Number(v.original) || 0);
      const unreconciled = round2(original - (system + diffTotal));
      const rec = {id: RECON_FORM[kind].editingId || (kind === 'cash' ? 'BCR-' : 'PRC-') + String(101 + RECONCILIATIONS[kind].length), kind, account: v.account, date: v.date, system, diffTotal, original, unreconciled, diffs, files: RECON_FORM[kind].files.slice(), state: Math.abs(unreconciled) < 0.01 ? 'reconciled' : 'difference'};
      const editing = RECON_FORM[kind].editingId;
      if (editing) { const t = RECONCILIATIONS[kind].find((x) => x.id === editing); if (t) Object.assign(t, rec); }
      else RECONCILIATIONS[kind].push(rec);
      RECON_FORM[kind] = {account: '', date: '2026-11-30', original: '', diffs: [{reason: '', reference: '', amount: ''}], files: []};
      if (kind === 'cash') CASH_TAB = 'recon'; else PARTY_TAB = 'recon';
      notify(Math.abs(unreconciled) < 0.01 ? 'Reconciliation saved and agrees.' : `Reconciliation saved with a difference of ${unreconciled.toFixed(2)}.`);
      navigate({module: 'accounting', tab: kind === 'cash' ? 'cash' : 'parties'});
    });
  }

  function cashEditor(code) {
    const controls = accounts().filter((a) => a.control === 'bank' || a.control === 'cash');
    const editingRow = code ? (CASH_BANK.find((s) => s.code === code) || {}) : {};
    const v = (key, fallback = '') => (editingRow[key] !== undefined ? editingRow[key] : fallback);
    return `<section class="panel">
      <div class="panel-head"><h2>${editingRow.code ? e(editingRow.name) : 'New cash or bank sub-account'}</h2><span class="badge">${editingRow.code ? `Editing ${e(editingRow.code)}` : 'Blank access means all'}</span></div>
      <form data-cash-form class="panel-body form-grid">
        <input type="hidden" name="editingCode" value="${e(editingRow.code || '')}">
        <label>Sub-account no. (system)<input name="code" required readonly value="${e(v('code', nextCashCode()))}"><small class="secondary">Assigned in order, CB-0001, CB-0002, …</small></label>
        <label>Name<input name="name" required maxlength="70" value="${e(v('name'))}" placeholder="HBL — current 1234"></label>
        <label>Control head<select name="control" class="inline-input" required>${controls.map((a) => `<option value="${a.code}" ${a.code === v('control', '1010') ? 'selected' : ''}>${a.code} · ${e(a.name)} (${a.control})</option>`).join('')}</select></label>
        <label>Kind<select name="kind" class="inline-input"><option value="bank" ${v('kind') === 'bank' ? 'selected' : ''}>Bank</option><option value="cash" ${v('kind') === 'cash' ? 'selected' : ''}>Cash</option></select></label>
        <label>Bank name<input name="bank" maxlength="60" value="${e(v('bank'))}" placeholder="Habib Bank"></label>
        <label>Branch<input name="branch" maxlength="60" value="${e(v('branch'))}" placeholder="Clifton"></label>
        <label>Account / IBAN / till<input name="reference" maxlength="40" value="${e(v('reference'))}" placeholder="PK00XXXX0000000000000000"></label>
        <label>Opening balance<input name="opening" inputmode="decimal" value="${e(v('opening', '0.00'))}"></label>
        <label>Status<select name="status" class="inline-input"><option ${v('status', 'Active') === 'Active' ? 'selected' : ''}>Active</option><option ${v('status') === 'Closed' ? 'selected' : ''}>Closed</option></select></label>
        <label class="wide">Notes<input name="notes" maxlength="120" value="${e(v('notes'))}" placeholder="Authorised signatories, cut-off, card machine"></label>
          ${ms('cb-projects', 'Allowed projects', PROJECTS.map((p) => [p.code, `${p.code} · ${p.name}`]), v('projects', []))}
          ${ms('cb-locations', 'Allowed locations', LOCATIONS.map((l) => [l.code, `${l.code} · ${l.name}`]), v('locations', []))}
        ${evidenceSection('cash', CASH_FILES[code || 'new'] || [])}
        ${ledgerIllustration('Illustrative opening entry', (() => {
          const opening = round2(Number(v('opening', '0')) || 0);
          if (!opening) return [];
          return [{account: v('control', '1010'), party: v('name', 'Sub-account'), debit: opening, credit: 0}, {account: '3100', party: '', debit: 0, credit: opening}];
        })(), 'Only recorded when an opening balance is entered; the control head and the sub-account move together.')}
        <div class="related"><button class="button primary">${editingRow.code ? 'Save changes' : 'Add sub-account'}</button><button type="button" class="button" data-form-cancel>Cancel</button></div>
      </form>
      <div class="panel-body"><p class="form-note">The control head decides where the balance sits; the kind decides which journal lines may pick the sub-account. A bank control takes bank lines, a cash control takes cash lines, and the chosen projects and locations narrow it further.</p></div>
    </section>`;
  }

  function bindCashBank(rerender, notify, navigate) {
    const goBack = () => navigate({module: 'accounting', tab: 'cash'});
    document.querySelector('[data-cash-reset]')?.addEventListener('click', () => {
      Object.assign(FILTERS.cash, {q: '', asof: '', kind: '', control: '', status: '', location: '', cf: {}});
      rerender();
    });
    document.querySelectorAll('[data-cash-sort]').forEach((b) => b.addEventListener('click', () => {
      const key = b.dataset.cashSort;
      FILTERS.cash.sort = {key, dir: FILTERS.cash.sort.key === key && FILTERS.cash.sort.dir === 'asc' ? 'desc' : 'asc'};
      rerender();
    }));
    let cashOpen = '';
    const closeCashMenus = (except) => {
      document.querySelectorAll('[data-cashp]').forEach((p) => { if (p !== except) p.hidden = true; });
      document.querySelectorAll('[data-cashf]').forEach((b) => b.setAttribute('aria-expanded', 'false'));
    };
    const openCashMenu = (key) => {
      const btn = document.querySelector(`[data-cashf="${key}"]`);
      const panel = document.querySelector(`[data-cashp="${key}"]`);
      if (!btn || !panel) return;
      closeCashMenus(panel);
      panel.hidden = false;
      btn.setAttribute('aria-expanded', 'true');
      const r = btn.getBoundingClientRect();
      panel.classList.add('col-filter-panel--fixed');
      const left = r.left > window.innerWidth / 2 ? r.right - 270 : r.left;
      panel.style.left = Math.round(Math.min(Math.max(8, left), window.innerWidth - 278)) + 'px';
      const top = Math.round(r.bottom + 4);
      panel.style.top = top + 'px';
      panel.style.maxHeight = Math.max(220, Math.min(380, window.innerHeight - top - 12)) + 'px';
      const search = panel.querySelector('.cash-filter-search');
      if (search) { search.value = ''; search.focus(); }
      cashOpen = key;
    };
    document.querySelectorAll('[data-cashf]').forEach((b) => b.addEventListener('click', (ev) => {
      ev.stopPropagation();
      if (cashOpen === b.dataset.cashf) { closeCashMenus(); cashOpen = ''; return; }
      openCashMenu(b.dataset.cashf);
    }));
    document.addEventListener('click', (ev) => {
      if (ev.target.closest('.col-filter-panel') || ev.target.closest('[data-cashf]')) return;
      closeCashMenus(); cashOpen = '';
    });
    document.querySelectorAll('[data-cashp]').forEach((panel) => {
      panel.addEventListener('click', (ev) => ev.stopPropagation());
      panel.querySelector('.cash-filter-search')?.addEventListener('input', (ev) => {
        const q = ev.target.value.toLowerCase();
        panel.querySelectorAll('.ms-row').forEach((row) => { row.hidden = q && !row.textContent.toLowerCase().includes(q); });
      });
      panel.querySelector('[data-cashall]')?.addEventListener('click', () => { panel.querySelectorAll('input[type=checkbox]').forEach((b) => { if (!b.closest('.ms-row').hidden) b.checked = true; }); });
      panel.querySelector('[data-cashnone]')?.addEventListener('click', () => { panel.querySelectorAll('input[type=checkbox]').forEach((b) => { b.checked = false; }); });
    });
    document.querySelectorAll('[data-cashapply]').forEach((b) => b.addEventListener('click', () => {
      const key = b.dataset.cashapply;
      const panel = document.querySelector(`[data-cashp="${key}"]`);
      FILTERS.cash.cf = {...(FILTERS.cash.cf || {}), [key]: [...panel.querySelectorAll('input[type=checkbox]:checked')].map((x) => x.value)};
      closeCashMenus(); cashOpen = '';
      rerender();
    }));
    document.querySelectorAll('[data-cashtoggle]').forEach((b) => b.addEventListener('click', () => {
      const key = b.dataset.cashtoggle;
      FILTERS.cash.sort = {key, dir: FILTERS.cash.sort.key === key && FILTERS.cash.sort.dir === 'asc' ? 'desc' : 'asc'};
      closeCashMenus(); cashOpen = '';
      rerender();
    }));
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
    const cashFileKey = document.querySelector('[data-cash-form] [name="editingCode"]')?.value || 'new';
    if (!CASH_FILES[cashFileKey]) CASH_FILES[cashFileKey] = [];
    bindEvidenceZone('cash', CASH_FILES[cashFileKey], rerender);
    document.querySelector('[data-cash-form] [data-form-cancel]')?.addEventListener('click', goBack);
    document.querySelector('[data-cash-form]')?.addEventListener('submit', (ev) => {
      ev.preventDefault();
      const form = ev.target;
      if (!form.reportValidity()) return;
      const v2 = Object.fromEntries(new FormData(form));
      const editingCode = v2.editingCode || '';
      if (!editingCode && CASH_BANK.some((s) => s.code === v2.code || s.name.trim().toLowerCase() === v2.name.trim().toLowerCase())) { notify('That code or name already exists.'); return; }
      const [proj, loc] = form.querySelectorAll('.ms');
      const record = {code: v2.code, name: v2.name.trim(), kind: v2.kind, control: v2.control, reference: v2.reference || '', bank: v2.bank || '', branch: v2.branch || '', currency: v2.currency || CURRENCIES.primary, rate: Number(v2.rate) || 1, opening: round2(Number(v2.opening) || 0), status: v2.status || 'Active', notes: v2.notes || '', projects: picked(proj), locations: picked(loc)};
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
  function nextPartyCode() {
    const nums = PARTIES.filter((p) => /^Party-\d+$/.test(p.code)).map((p) => Number(p.code.slice(6)) || 0);
    return 'Party-' + String((nums.length ? Math.max(...nums) : 0) + 1).padStart(4, '0');
  }
  function partyControlOptions(type) {
    return accounts().filter((a) => a.control === (type === 'customer' ? 'receivable' : 'payable'));
  }
  function postPartyOpening(party) {
    EXTRA_JOURNALS.splice(0, EXTRA_JOURNALS.length, ...EXTRA_JOURNALS.filter((d) => d.id !== 'OB-' + party.code));
    const opening = round2(Number(party.opening) || 0);
    if (opening <= 0) return;
    const control = party.control || partyControl(party.type);
    const debit = party.type === 'customer' ? control : '3100';
    const credit = party.type === 'customer' ? '3100' : control;
    EXTRA_JOURNALS.push({id: 'OB-' + party.code, date: '2026-07-01', subtype: 'Opening', project: '', location: 'HQ', party: party.name, partyType: party.type === 'customer' ? 'Customer' : 'Supplier', source: 'Opening balance', supplierRef: '', againstVoucher: '', lines: [
      {account: debit, debit: opening.toFixed(2), credit: '0.00', party: party.name, project: '', location: 'HQ', costCentre: ''},
      {account: credit, debit: '0.00', credit: opening.toFixed(2), party: '', project: '', location: 'HQ', costCentre: ''},
    ]});
  }
  function partyRows(asOf = '') {
    return PARTIES.map((p) => {
      const code = p.control || partyControl(p.type);
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
  function partyColValue(p, key) {
    const map = {code: p.code, name: p.name, type: p.type, group: p.group, terms: p.terms, limit: p.limit, balance: p.balance, status: p.status};
    return map[key] !== undefined ? map[key] : p[key];
  }
  function partyColValues(key) {
    const rows = partyRows(FILTERS.parties.asof || '');
    return [...new Set(rows.map((p) => String(partyColValue(p, key) ?? '')).filter((v) => v !== ''))].sort((a, b) => a.localeCompare(b, undefined, {numeric: true})).slice(0, 200);
  }
  function partyColLabel(key, v) {
    if (['limit', 'balance', 'terms'].includes(key)) return key === 'terms' ? v : money(Number(v) || 0);
    return v;
  }

  function partiesView() {
    const tab = PARTY_TAB === 'recon' ? 'recon' : 'register';
    const tabs = `<div class="tabs" role="tablist" aria-label="Party views"><button role="tab" aria-selected="${tab === 'register'}" data-party-tab="register">Register</button><button role="tab" aria-selected="${tab === 'recon'}" data-party-tab="recon">Reconciliation</button></div>`;
    if (tab === 'recon') return tabs + reconView('party');
    const f = FILTERS.parties;
    const pf = f;
    const asOf = f.asof || '';
    const all = partyRows(asOf);
    let rows = all.filter((p) => hit(f.q, p.code, p.name, p.group, p.contact, p.email, p.phone)
      && (!f.type || p.type === f.type) && (!f.status || p.status === f.status)
      && (!f.balance || (f.balance === 'debit' ? p.balance > 0 : f.balance === 'credit' ? p.balance < 0 : Math.abs(p.balance) < 0.01))
      && Object.entries(pf.cf || {}).every(([k, v]) => !v || !v.length || v.includes(String(partyColValue(p, k)))));
    rows = rows.slice().sort((a, b) => { const x = partyColValue(a, pf.sort.key), y = partyColValue(b, pf.sort.key); const d = typeof x === 'number' && typeof y === 'number' ? x - y : String(x ?? '').localeCompare(String(y ?? '')); return pf.sort.dir === 'desc' ? -d : d; });
    const receivable = round2(all.filter((p) => p.type === 'customer').reduce((n, p) => n + p.balance, 0));
    const payable = round2(all.filter((p) => p.type === 'supplier').reduce((n, p) => n + p.balance, 0));
    return tabs + `<form class="filterbar" data-filter="parties">
        ${filterInput('parties', f.q, 'Code, name, group, contact, email')}
        <label>Balances as at<input type="date" name="asof" value="${e(asOf)}" max="2026-12-31"></label>
        <button class="button" type="button" data-filter-reset="parties">Reset to current</button>
      </form>
      <section class="panel">
        <div class="panel-head"><h2>Parties</h2><div class="related"><span class="badge">${rows.length} of ${all.length} records</span><span class="badge">${asOf ? `balances as at ${e(asOf)}` : 'current balances'}</span><button class="button" data-export-table>Export CSV</button></div></div>
        <div class="table-scroll" data-hscroll><table>
          <thead><tr>${[['code','Code'],['name','Name'],['type','Type'],['group','Group'],['terms','Terms'],['limit','Limit'],['balance','Balance'],['status','Status']].map(([key,label]) => {
            const sel = (pf.cf && pf.cf[key]) || [];
            return `<th class="col col-${key} ${['terms','limit','balance'].includes(key) ? 'numeric' : ''}"><div class="th-flex"><button class="sortable" data-party-sort="${key}" aria-sort="${pf.sort.key === key ? (pf.sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}">${label}<span class="sort-mark">${pf.sort.key === key ? (pf.sort.dir === 'asc' ? '▲' : '▼') : ''}</span></button><button type="button" class="col-filter-btn" data-partf="${key}" aria-label="Filter ${label}" aria-expanded="false">${icon('chevron')}${sel.length ? `<b>${sel.length}</b>` : ''}</button></div>
              <div class="col-filter-panel" data-partp="${key}" hidden><div class="gl-sortrow"><span class="gl-sortlabel">Sort</span><button type="button" class="sort-toggle ${pf.sort.key === key ? 'active' : ''}" data-parttoggle="${key}">${pf.sort.key === key ? (pf.sort.dir === 'asc' ? '↑' : '↓') : '↕'}</button></div>
              <div class="ms-searchrow"><input class="ms-search party-filter-search" type="search" placeholder="Search values"></div>
              <div class="ms-head"><button type="button" class="text-button" data-partall="${key}">Select all</button><span class="ms-count">${partyColValues(key).length}</span><button type="button" class="text-button" data-partnone="${key}">Clear</button></div>
              <div class="ms-list">${partyColValues(key).map((v) => `<label class="ms-row"><input class="check" type="checkbox" value="${e(v)}" ${sel.includes(v) ? 'checked' : ''}><span>${e(partyColLabel(key, v))}</span></label>`).join('') || '<div class="ms-empty">No values</div>'}</div>
              <div class="gl-applyrow"><button type="button" class="button primary" data-partapply="${key}">Apply filter</button></div></div></th>`;
          }).join('')}<th>Ledger</th></tr></thead>
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
        <label>Party no. (system)<input name="code" required value="${e(v('code', nextPartyCode()))}" readonly></label>
        <label>Name<input name="name" required maxlength="70" value="${e(v('name'))}" placeholder="New customer"></label>
        <label>Type<select name="type" class="inline-input"><option value="customer" ${v('type') !== 'supplier' ? 'selected' : ''}>Customer</option><option value="supplier" ${v('type') === 'supplier' ? 'selected' : ''}>Supplier</option></select></label>
        <label>Group<select name="group" class="inline-input">${PARTY_GROUPS.map((g) => `<option value="${e(g.name)}" ${g.name === v('group') ? 'selected' : ''}>${e(g.name)}</option>`).join('')}</select></label>
        <label>Contact person<input name="contact" maxlength="50" value="${e(v('contact'))}" placeholder="Finance manager"></label>
        <label>Phone<input name="phone" maxlength="30" value="${e(v('phone'))}" placeholder="+92 300 0000000"></label>
        <label>Email<input name="email" type="email" maxlength="70" value="${e(v('email'))}" placeholder="accounts@customer.pk"></label>
        <label>Control account<select name="control" class="inline-input">${partyControlOptions(v('type', 'customer')).map((a) => `<option value="${a.code}" ${a.code === v('control', partyControl(v('type', 'customer'))) ? 'selected' : ''}>${a.code} · ${e(a.name)}</option>`).join('')}</select></label>
        <label>Payment terms (days)<input name="terms" type="number" min="0" max="365" value="${e(v('terms', ''))}" placeholder="Optional"><small class="secondary">Optional, especially for suppliers.</small></label>
        <label>Credit limit<input name="limit" inputmode="decimal" value="${e(v('limit', ''))}" placeholder="Optional"><small class="secondary">Change it here when an invoice raises the exposure; the change is logged.</small></label>
        <label>Opening balance<input name="opening" inputmode="decimal" value="${e(v('opening', '0.00'))}"></label>
        <label>Tax identity<input name="taxId" maxlength="30" value="${e(v('taxId'))}" placeholder="NTN-"></label>
        <label>Status<select name="status" class="inline-input"><option ${v('status', 'Active') === 'Active' ? 'selected' : ''}>Active</option><option ${v('status') === 'Hold' ? 'selected' : ''}>Hold</option><option ${v('status') === 'Blocked' ? 'selected' : ''}>Blocked</option></select></label>
        <label>Billing address<input name="address" maxlength="90" value="${e(v('address'))}" placeholder="Street, city"></label>
        <label>Bank name<input name="bankName" maxlength="60" value="${e(v('bankName'))}" placeholder="Party bank name"></label>
        <label>Bank account / IBAN<input name="bankAccount" maxlength="40" value="${e(v('bankAccount'))}"></label>
        <label class="wide">Notes<input name="notes" maxlength="120" value="${e(v('notes'))}" placeholder="Delivery instructions, special terms"></label>
        ${ms('party-projects', 'Allowed projects', PROJECTS.map((p) => [p.code, `${p.code} · ${p.name}`]), v('projects', []))}
        ${ms('party-locations', 'Allowed locations', LOCATIONS.map((l) => [l.code, `${l.code} · ${l.name}`]), v('locations', []))}
        ${evidenceSection('party', PARTY_FILES[code || 'new'] || [])}
        ${ledgerIllustration('Illustrative opening entry', (() => {
          const opening = round2(Number(v('opening', '0')) || 0);
          if (!opening) return [];
          const control = v('control', partyControl(v('type', 'customer')));
          return v('type', 'customer') === 'customer'
            ? [{account: control, party: v('name', 'Party'), debit: opening, credit: 0}, {account: '3100', party: '', debit: 0, credit: opening}]
            : [{account: '3100', party: '', debit: opening, credit: 0}, {account: control, party: v('name', 'Party'), debit: 0, credit: opening}];
        })(), 'Only recorded when an opening balance is entered; it posts at the business start against 3100 Opening balance equity.')}
        <div class="related"><button class="button primary">${editingRow.code ? 'Save changes' : 'Add party'}</button><button type="button" class="button" data-form-cancel>Cancel</button></div>
      </form>
      <div class="panel-body"><p class="form-note">A customer or supplier is a sub-account of its control account. The journal only offers a party where its account kind and its allowed projects and locations agree.</p>
        ${code && PARTY_CHANGES.some((c) => c.party === (PARTIES.find((p) => p.code === code) || {}).name) ? `<div class="section-title">Recent policy changes</div><ul class="contract-list">${PARTY_CHANGES.filter((c) => c.party === (PARTIES.find((p) => p.code === code) || {}).name).slice(-5).reverse().map((c) => `<li>${e(c.field)}: ${e(String(c.from))} → ${e(String(c.to))} <small class="secondary">${c.at} · ${e(c.by)}</small></li>`).join('')}</ul>` : ''}
      </div>
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
    document.querySelectorAll('[data-party-sort]').forEach((b) => b.addEventListener('click', () => {
      const key = b.dataset.partySort;
      FILTERS.parties.sort = {key, dir: FILTERS.parties.sort.key === key && FILTERS.parties.sort.dir === 'asc' ? 'desc' : 'asc'};
      rerender();
    }));
    let partyOpen = '';
    const closePartyMenus = (except) => {
      document.querySelectorAll('[data-partp]').forEach((p) => { if (p !== except) p.hidden = true; });
      document.querySelectorAll('[data-partf]').forEach((b) => b.setAttribute('aria-expanded', 'false'));
    };
    const openPartyMenu = (key) => {
      const btn = document.querySelector(`[data-partf="${key}"]`);
      const panel = document.querySelector(`[data-partp="${key}"]`);
      if (!btn || !panel) return;
      closePartyMenus(panel);
      panel.hidden = false;
      btn.setAttribute('aria-expanded', 'true');
      const r = btn.getBoundingClientRect();
      panel.classList.add('col-filter-panel--fixed');
      const left = r.left > window.innerWidth / 2 ? r.right - 270 : r.left;
      panel.style.left = Math.round(Math.min(Math.max(8, left), window.innerWidth - 278)) + 'px';
      const top = Math.round(r.bottom + 4);
      panel.style.top = top + 'px';
      panel.style.maxHeight = Math.max(220, Math.min(380, window.innerHeight - top - 12)) + 'px';
      const search = panel.querySelector('.party-filter-search');
      if (search) { search.value = ''; search.focus(); }
      partyOpen = key;
    };
    document.querySelectorAll('[data-partf]').forEach((b) => b.addEventListener('click', (ev) => {
      ev.stopPropagation();
      if (partyOpen === b.dataset.partf) { closePartyMenus(); partyOpen = ''; return; }
      openPartyMenu(b.dataset.partf);
    }));
    document.addEventListener('click', (ev) => {
      if (ev.target.closest('.col-filter-panel') || ev.target.closest('[data-partf]')) return;
      closePartyMenus(); partyOpen = '';
    });
    document.querySelectorAll('[data-partp]').forEach((panel) => {
      panel.addEventListener('click', (ev) => ev.stopPropagation());
      panel.querySelector('.party-filter-search')?.addEventListener('input', (ev) => {
        const q = ev.target.value.toLowerCase();
        panel.querySelectorAll('.ms-row').forEach((row) => { row.hidden = q && !row.textContent.toLowerCase().includes(q); });
      });
      panel.querySelector('[data-partall]')?.addEventListener('click', () => { panel.querySelectorAll('input[type=checkbox]').forEach((b) => { if (!b.closest('.ms-row').hidden) b.checked = true; }); });
      panel.querySelector('[data-partnone]')?.addEventListener('click', () => { panel.querySelectorAll('input[type=checkbox]').forEach((b) => { b.checked = false; }); });
    });
    document.querySelectorAll('[data-partapply]').forEach((b) => b.addEventListener('click', () => {
      const key = b.dataset.partapply;
      const panel = document.querySelector(`[data-partp="${key}"]`);
      FILTERS.parties.cf = {...(FILTERS.parties.cf || {}), [key]: [...panel.querySelectorAll('input[type=checkbox]:checked')].map((x) => x.value)};
      closePartyMenus(); partyOpen = '';
      rerender();
    }));
    document.querySelectorAll('[data-parttoggle]').forEach((b) => b.addEventListener('click', () => {
      const key = b.dataset.parttoggle;
      FILTERS.parties.sort = {key, dir: FILTERS.parties.sort.key === key && FILTERS.parties.sort.dir === 'asc' ? 'desc' : 'asc'};
      closePartyMenus(); partyOpen = '';
      rerender();
    }));

    const partyFileKey = document.querySelector('[data-party-form] [name="editingCode"]')?.value || 'new';
    if (!PARTY_FILES[partyFileKey]) PARTY_FILES[partyFileKey] = [];
    bindEvidenceZone('party', PARTY_FILES[partyFileKey], rerender);
    document.querySelector('[data-party-form] [name="type"]')?.addEventListener('change', (ev) => {
      const control = document.querySelector('[data-party-form] [name="control"]');
      if (!control) return;
      const type = ev.target.value;
      const fallback = partyControl(type);
      control.innerHTML = partyControlOptions(type).map((a) => `<option value="${a.code}" ${a.code === fallback ? 'selected' : ''}>${a.code} · ${e(a.name)}</option>`).join('');
      control.dispatchEvent(new Event('change', {bubbles: true}));
    });
    document.querySelector('[data-party-form]')?.addEventListener('submit', (ev) => {
      ev.preventDefault();
      const form = ev.target;
      if (!form.reportValidity()) return;
      const v2 = Object.fromEntries(new FormData(form));
      const editingCode = v2.editingCode || '';
      if (!editingCode && PARTIES.some((p) => p.code === v2.code || p.name.trim().toLowerCase() === v2.name.trim().toLowerCase())) { notify('That code or name already exists.'); return; }
      const [proj, loc] = form.querySelectorAll('.ms');
      const record = {code: v2.code, name: v2.name.trim(), type: v2.type, group: v2.group || 'General', control: v2.control || partyControl(v2.type), terms: Number(v2.terms) || 0, limit: round2(Number(v2.limit) || 0), opening: round2(Number(v2.opening) || 0), status: v2.status || 'Active', taxId: v2.taxId || '', contact: v2.contact || '', phone: v2.phone || '', email: v2.email || '', address: v2.address || '', bankName: v2.bankName || '', bankAccount: v2.bankAccount || '', currency: CURRENCIES.primary, notes: v2.notes || '', projects: picked(proj), locations: picked(loc)};
      if (editingCode) {
        const target = PARTIES.find((p) => p.code === editingCode);
        if (target) {
          ['control', 'terms', 'limit'].forEach((field) => {
            if (String(target[field]) !== String(record[field])) PARTY_CHANGES.push({party: target.name, field, from: target[field], to: record[field], at: '2026-11-25', by: 'A. Rehman'});
          });
          Object.assign(target, record);
        }
        notify('Party updated for this session. Policy changes are logged.');
      } else {
        PARTIES.push(record);
        notify('Party added for this session. It is available in the journal and in payments.');
      }
      postPartyOpening(record);
      goBack();
    });
  }

  /* ----------------------------------------------------------- payments */
  function nextDocNumber(key, date) {
    const n = NUMBERING[key] || {prefix: key === 'receipt' ? 'RCPT' : 'PAY', next: 1, padding: 4};
    const fallback = new Date('2026-11-30T00:00:00');
    const d = date ? new Date(date + 'T00:00:00') : fallback;
    const when = Number.isNaN(d.getTime()) ? fallback : d;
    const mm = String(when.getMonth() + 1).padStart(2, '0');
    return `${n.prefix}-${mm}-${when.getFullYear()}-${String(n.next).padStart(n.padding || 4, '0')}`;
  }
  function openItems(party) {
    if (!party) return [];
    const isCustomer = party.type === 'customer';
    const code = isCustomer ? '1100' : '2100';
    const docs = fixture(getCompany());
    return docs
      .filter((d) => d.party === party.name && (d.subtype === 'Invoice' || d.subtype === 'Bill'))
      .map((d) => {
        const total = round2(d.lines.filter((l) => l.account === code).reduce((n, l) => n + (isCustomer ? num(l.debit) - num(l.credit) : num(l.credit) - num(l.debit)), 0));
        const fromFixture = round2(docs.filter((x) => x.againstVoucher === d.id).reduce((n, x) => n + x.lines.filter((l) => l.account === code).reduce((m, l) => m + (isCustomer ? num(l.credit) - num(l.debit) : num(l.debit) - num(l.credit)), 0), 0));
        const fromSession = round2(PAYMENTS.reduce((n, p) => n + (p.allocations || []).filter((a) => a.id === d.id).reduce((m, a) => m + (Number(a.amount) || 0), 0), 0));
        const fromAdvance = round2(ADVANCE_APPLIED.filter((a) => a.docId === d.id).reduce((n, a) => n + Number(a.amount || 0), 0));
        const paid = round2(Math.min(total, fromFixture + fromSession + fromAdvance));
        return {id: d.id, date: d.date, total, paid, outstanding: round2(Math.max(total - paid, 0))};
      })
      .concat(INVOICES.filter((i) => i.kind === (isCustomer ? 'sales' : 'purchase') && i.party === party.name).map((i) => {
        const total = round2(i.netDue ?? i.gross);
        const paid = paidFor(i.kind, i.id);
        return {id: i.id, date: i.date, total, paid: round2(Math.min(paid, total)), outstanding: round2(Math.max(total - paid, 0))};
      }))
      .filter((x) => x.outstanding > 0)
      .sort((a, b) => a.date.localeCompare(b.date));
  }
  function paymentRows() {
    const isReceipt = (d) => d.lines.some((l) => ['1010', '1000', '1020'].includes(l.account) && num(l.debit) > 0);
    const fromFixture = fixture(getCompany()).filter((d) => d.source === 'Payment').map((d) => {
      const bank = d.lines.find((l) => ['1010', '1000', '1020'].includes(l.account));
      const amount = round2(Math.abs(num(bank ? bank.debit : 0) - num(bank ? bank.credit : 0)));
      const account = bank ? bank.party || '' : '';
      return {id: d.id, date: d.date, party: d.party, account, amount, withheld: 0, net: amount, direction: isReceipt(d) ? 'receive' : 'pay', method: 'Bank transfer', against: d.againstVoucher || '', advanced: 0, allocations: d.againstVoucher ? [{id: d.againstVoucher, amount, method: 'bank', account}] : [], notes: d.narrative || '', tenders: [{method: 'bank', account, reference: d.againstVoucher || '', amount}], session: false};
    });
    return PAYMENTS.concat(fromFixture).sort((a, b) => b.date.localeCompare(a.date) || b.id.localeCompare(a.id));
  }
  function payColValue(r, key) {
    if (key === 'type') return r.direction === 'receive' ? 'receipt' : 'payment';
    if (key === 'state') return r.session ? 'Session' : 'Posted';
    if (key === 'method') return (r.tenders && r.tenders.length > 1) ? `${r.tenders.length} methods` : (r.method || '—');
    if (key === 'withheld') return round2(Number(r.withheld) || 0);
    if (key === 'net') return round2(Number(r.net ?? r.amount) || 0);
    if (key === 'amount') return round2(Number(r.amount) || 0);
    if (key === 'against') return r.against || 'Advance / on account';
    if (key === 'account') return r.account || '—';
    return r[key] ?? '';
  }
  function payColValues(key) {
    return [...new Set(paymentRows().map((r) => String(payColValue(r, key))))].sort((a, b) => a.localeCompare(b, undefined, {numeric: true})).slice(0, 200);
  }
  function payColLabel(key, v) {
    if (['amount', 'withheld', 'net'].includes(key)) return money(Number(v) || 0);
    if (key === 'type') return v === 'receive' ? 'Receipt' : 'Payment';
    return v;
  }
  function paymentsView() {
    const all = paymentRows();
    const f = FILTERS.payments;
    const cols = [['date', 'Date'], ['id', 'Number'], ['type', 'Type'], ['party', 'Party'], ['method', 'Method'], ['account', 'Cash / bank'], ['against', 'Settled'], ['amount', 'Amount', 'numeric'], ['state', 'State']];
    let rows = all.filter((r) => hit(f.q, r.id, r.party, r.account, r.against, r.reference)
      && (!f.from || r.date >= f.from) && (!f.to || r.date <= f.to)
      && Object.entries(f.cf || {}).every(([k, v]) => !v || !v.length || v.includes(String(payColValue(r, k)))));
    rows = rows.slice().sort((a, b) => {
      const x = payColValue(a, f.sort.key), y = payColValue(b, f.sort.key);
      const d = typeof x === 'number' && typeof y === 'number' ? x - y : String(x ?? '').localeCompare(String(y ?? ''), undefined, {numeric: true});
      return f.sort.dir === 'desc' ? -d : d;
    });
    const cells = {
      date: (r) => `<td class="col col-date">${e(r.date)}</td>`,
      id: (r) => `<td class="col col-id mono">${e(r.id)}</td>`,
      type: (r) => `<td class="col col-type">${badge(r.direction === 'receive' ? 'receipt' : 'payment', r.direction === 'receive' ? 'good' : '')}</td>`,
      party: (r) => `<td class="col col-party">${e(r.party)}</td>`,
      method: (r) => `<td class="col col-method">${e(payColValue(r, 'method'))}</td>`,
      account: (r) => `<td class="col col-account" title="${e(payColValue(r, 'account'))}">${e(payColValue(r, 'account'))}</td>`,
      against: (r) => `<td class="col col-against" title="${e(payColValue(r, 'against'))}">${e(payColValue(r, 'against'))}</td>`,
      amount: (r) => `<td class="col col-amount numeric">${money(r.amount)}</td>`,
      state: (r) => `<td class="col col-state">${r.state === 'cancelled' ? badge('Cancelled', 'warn') : r.session ? badge('Session', 'plum') : badge('Posted', 'good')}</td>`,
    };
    return `<form class="filterbar" data-filter="payments" data-pay-filter>
        ${filterInput('payments', f.q, 'Reference, party, account, document')}
        <label>From<input type="date" name="from" value="${e(f.from || '')}"></label>
        <label>To<input type="date" name="to" value="${e(f.to || '')}"></label>
        <button class="button" type="button" data-pay-reset>Reset</button>
      </form>
      <section class="panel">
        <div class="panel-head"><h2>Payments and receipts</h2><div class="related"><span class="badge">${rows.length} of ${all.length} documents</span><button class="button" data-export-table>Export CSV</button></div></div>
        <div class="table-scroll" data-hscroll><table class="pay-register inv-register">
          <thead><tr>${cols.map(([key, label, cls]) => {
            const sel = (f.cf && f.cf[key]) || [];
            return `<th class="col col-${key} ${cls || ''}"><div class="th-flex"><button class="sortable" data-pay-sort="${key}" aria-sort="${f.sort.key === key ? (f.sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}">${label}<span class="sort-mark">${f.sort.key === key ? (f.sort.dir === 'asc' ? '▲' : '▼') : ''}</span></button><button type="button" class="col-filter-btn" data-payf="${key}" aria-label="Filter ${e(label)}" aria-expanded="false">${icon('chevron')}${sel.length ? `<b>${sel.length}</b>` : ''}</button></div>
              <div class="col-filter-panel" data-payp="${key}" hidden><div class="gl-sortrow"><span class="gl-sortlabel">Sort</span><button type="button" class="sort-toggle ${f.sort.key === key ? 'active' : ''}" data-paytoggle="${key}">${f.sort.key === key ? (f.sort.dir === 'asc' ? '↑' : '↓') : '↕'}</button></div>
              <div class="ms-searchrow"><input class="ms-search pay-filter-search" type="search" placeholder="Search values"></div>
              <div class="ms-head"><button type="button" class="text-button" data-payall="${key}">Select all</button><span class="ms-count">${payColValues(key).length}</span><button type="button" class="text-button" data-paynone="${key}">Clear</button></div>
              <div class="ms-list">${payColValues(key).map((v) => `<label class="ms-row"><input class="check" type="checkbox" value="${e(v)}" ${sel.includes(v) ? 'checked' : ''}><span>${e(payColLabel(key, v))}</span></label>`).join('') || '<div class="ms-empty">No values</div>'}</div>
              <div class="gl-applyrow"><button type="button" class="button primary" data-payapply="${key}">Apply filter</button></div></div></th>`;
          }).join('')}</tr></thead>
          <tbody>${rows.map((r) => `<tr class="row-link" data-pay-open="${e(r.id)}">${cols.map(([key]) => cells[key](r)).join('')}</tr>`).join('') || '<tr><td colspan="11">No payments match these filters.</td></tr>'}</tbody>
          <tfoot><tr><td colspan="7">Total shown · ${rows.length} of ${all.length}</td><td class="numeric">${money(round2(rows.reduce((n, r) => n + r.amount, 0)))}</td><td></td></tr></tfoot>
        </table></div>
        <div class="table-footer">A receipt brings money in, a payment sends it out. The document may use more than one method — bank, cash or an existing advance — and the total is allocated across the party's open invoices, oldest first. Anything left is an advance.</div>
      </section>`;
  }

  function paymentEntryLines(direction, party, lines) {
    const isReceipt = direction === 'receive';
    const byAccount = {};
    (lines || []).forEach((l) => {
      if (!l.account || !Number(l.amount)) return;
      const sub = CASH_BANK.find((c) => c.name === l.account);
      const code = sub ? sub.control : l.account;
      const partyName = sub ? sub.name : '';
      const key = code + '|' + partyName;
      if (!byAccount[key]) byAccount[key] = {code, party: partyName, amount: 0};
      byAccount[key].amount = round2(byAccount[key].amount + Number(l.amount));
    });
    const out = [];
    const total = round2(Object.values(byAccount).reduce((n, x) => n + x.amount, 0));
    if (total <= 0) return out;
    if (isReceipt) {
      Object.values(byAccount).forEach((x) => out.push({account: x.code, party: x.party, debit: x.amount, credit: 0}));
      out.push({account: '1100', party, debit: 0, credit: total});
    } else {
      out.push({account: '2100', party, debit: total, credit: 0});
      Object.values(byAccount).forEach((x) => out.push({account: x.code, party: x.party, debit: 0, credit: x.amount}));
    }
    return out;
  }
  function paymentRecord(code) {
    const p = paymentRows().find((r) => r.id === code);
    if (!p) return `<section class="panel"><div class="panel-body"><p>That document is not in this register.</p><div class="related"><button type="button" class="button" data-pay-close>Back to register</button></div></div></section>`;
    const cancelled = p.state === 'cancelled';
    const methodName = (m) => ({bank: 'Bank transfer', cash: 'Cash'}[m] || m || '—');
    return `<section class="panel">
      <div class="panel-head"><h2>${e(p.id)}</h2><div class="related">${badge(p.direction === 'receive' ? 'receipt' : 'payment', p.direction === 'receive' ? 'good' : '')}${cancelled ? badge('Cancelled', 'warn') : p.session ? badge('Session', 'plum') : badge('Posted', 'good')}</div></div>
      <div class="panel-body"><div class="record-summary"><div><small>Party</small>${e(p.party)}</div><div><small>Date</small>${e(p.date)}</div><div><small>Amount</small>${money(p.amount)}</div><div><small>Method</small>${e(p.method || '—')}</div></div>
        ${p.notes ? `<p class="form-note">${e(p.notes)}</p>` : ''}
      </div>
      <div class="table-scroll"><table><thead><tr><th>Document</th><th>Method</th><th>Cash / bank</th><th class="numeric">Amount set off</th></tr></thead><tbody>
        ${(p.allocations || []).map((a) => `<tr><td><button type="button" class="text-button mono" data-pay-doc="${e(a.id)}">${e(a.id)}</button></td><td>${e(methodName(a.method))}</td><td>${e(a.account || '—')}</td><td class="numeric">${money(a.amount)}</td></tr>`).join('') || '<tr><td colspan="4">This fixture document does not carry allocation rows.</td></tr>'}
      </tbody></table></div>
      <div class="panel-body"><div class="related">
        ${p.session && !cancelled ? '<button type="button" class="button" data-pay-cancel-rec>Cancel record</button><button type="button" class="button" data-pay-delete-rec>Delete record</button>' : ''}
        <button type="button" class="button" data-pay-print>Print voucher</button>
        <button type="button" class="button" data-pay-close>Close</button>
      </div><p class="form-note">This is the separate ${p.direction === 'receive' ? 'receipt' : 'payment'} voucher; the invoice or bill stays its own document. A cancelled record stays in the register and loses its effect; a deleted session record is removed. Fixture documents are read-only.</p></div>
    </section>`;
  }
  function paymentEditor(code) {
    if (code) return paymentRecord(code);
    const isReceipt = PAY_FORM.direction === 'receive';
    const parties = PARTIES.filter((p) => (isReceipt ? p.type === 'customer' : p.type === 'supplier'));
    const party = PARTIES.find((p) => p.name === PAY_FORM.party);
    const items = party ? openItems(party) : [];
    const total = round2(PAY_FORM.lines.reduce((n, l) => n + (Number(l.amount) || 0), 0));
    const outstanding = round2(items.reduce((n, x) => n + x.outstanding, 0));
    const methodOptions = [['bank', 'Bank transfer'], ['cash', 'Cash']];
    const lineHtml = (l, i) => {
      const item = items.find((x) => x.id === l.doc);
      const accounts = CASH_BANK.filter((c) => (l.method === 'cash' ? c.kind === 'cash' : c.kind === 'bank'));
      return `<tr data-pay-line="${i}">
        <td><select data-line-field="doc" class="inline-input"><option value="">Choose document</option>${items.map((x) => `<option value="${e(x.id)}" ${x.id === l.doc ? 'selected' : ''} >${e(x.id)} · ${e(x.date)} · ${money(x.outstanding)} due</option>`).join('')}</select></td>
        <td><select data-line-field="method" class="inline-input">${methodOptions.map(([k, label]) => `<option value="${k}" ${l.method === k ? 'selected' : ''}>${label}</option>`).join('')}</select></td>
        <td><select data-line-field="account" class="inline-input"><option value="">Choose sub-account</option>${accounts.map((c) => `<option value="${e(c.name)}" ${c.name === l.account ? 'selected' : ''}>${e(c.name)} · ${e(c.control)}</option>`).join('')}</select></td>
        <td class="numeric" data-line-outstanding>${item ? money(item.outstanding) : '—'}</td>
        <td><input class="numeric" data-line-field="amount" value="${e(l.amount)}" inputmode="decimal" placeholder="0.00" aria-label="Amount set off"></td>
        <td><button type="button" class="text-button" data-pay-line-remove="${i}" ${PAY_FORM.lines.length === 1 ? 'disabled' : ''}>Remove</button></td>
      </tr>`;
    };
    return `<section class="panel">
      <div class="panel-head"><h2>${isReceipt ? 'New receipt' : 'New payment'}</h2><span class="badge">${nextDocNumber(isReceipt ? 'receipt' : 'payment', PAY_FORM.date)}</span></div>
      <form data-pay-form>
        <div class="panel-body form-grid">
          <label>Type<select name="direction" class="inline-input"><option value="receive" ${isReceipt ? 'selected' : ''}>Receipt — money in</option><option value="pay" ${!isReceipt ? 'selected' : ''}>Payment — money out</option></select></label>
          <label>Party<select name="party" class="inline-input" required><option value="">Choose a party</option>${parties.map((p) => `<option value="${e(p.name)}" ${p.name === PAY_FORM.party ? 'selected' : ''}>${e(p.name)} · ${e(p.code)}</option>`).join('')}</select></label>
          <label>Date<input name="date" type="date" value="${e(PAY_FORM.date || '2026-11-30')}" required></label>
          <label>Party outstanding<input readonly value="${party ? money(outstanding) : 'Choose a party first'}"></label>
          <label class="wide">Notes<input name="notes" maxlength="100" value="${e(PAY_FORM.notes || '')}" placeholder="What this money is for"></label>
        </div>
        <div class="panel-body">
          <div class="section-title">Documents settled${party ? ` · ${money(outstanding)} outstanding for ${e(party.name)}` : ''}</div>
          <div class="table-scroll"><table class="invoice-lines pay-lines">
            <thead><tr><th>Invoice or bill</th><th>Method</th><th>Cash / bank sub-account</th><th class="numeric">Outstanding</th><th class="numeric">Amount set off</th><th></th></tr></thead>
            <tbody>${PAY_FORM.lines.map(lineHtml).join('')}</tbody>
            <tfoot><tr><td colspan="4">Total set off</td><td class="numeric" data-pay-total>${money(total)}</td><td></td></tr></tfoot>
          </table></div>
          <div class="related"><button type="button" class="button" data-pay-add>Add document row</button></div>
          <p class="form-note">Each row settles the receivable or payable the invoice created, not its gross total — tax sits in its own control account. A row may be part-paid, and one payment can settle several documents.</p>
        </div>
        <div class="panel-body form-grid">${evidenceSection('payment', PAY_FILES)}${ledgerIllustration(isReceipt ? 'Illustrative entry on save' : 'Illustrative entry on save', paymentEntryLines(PAY_FORM.direction, PAY_FORM.party, PAY_FORM.lines), isReceipt ? 'Money received debits the cash or bank sub-account and credits the party receivable.' : 'Money paid debits the party payable and credits the cash or bank sub-account.')}</div>
        <div class="panel-body"><div class="related"><button class="button primary">Save for this session</button><button type="button" class="button" data-form-cancel>Cancel</button></div>
          <p class="form-note">Nothing here posts to the ledger in this build.</p></div>
      </form>
    </section>`;
  }

  function capturePay(form) {
    const v = Object.fromEntries(new FormData(form));
    const lines = [...document.querySelectorAll('[data-pay-line]')].map((tr) => ({
      doc: tr.querySelector('[data-line-field="doc"]')?.value || '',
      method: tr.querySelector('[data-line-field="method"]')?.value || 'bank',
      account: tr.querySelector('[data-line-field="account"]')?.value || '',
      amount: tr.querySelector('[data-line-field="amount"]')?.value || '',
    }));
    PAY_FORM = {direction: v.direction, party: v.party, date: v.date, notes: v.notes || '', lines};
    return {...v, lines};
  }
  function bindPayments(rerender, notify, navigate) {
    const goBack = () => navigate({module: 'accounting', tab: 'payments'});
    document.querySelector('[data-pay-reset]')?.addEventListener('click', () => {
      Object.assign(FILTERS.payments, {q: '', from: '', to: '', direction: '', party: '', cf: {}});
      rerender();
    });
    document.querySelectorAll('[data-pay-sort]').forEach((b) => b.addEventListener('click', () => {
      const key = b.dataset.paySort;
      FILTERS.payments.sort = {key, dir: FILTERS.payments.sort.key === key && FILTERS.payments.sort.dir === 'asc' ? 'desc' : 'asc'};
      rerender();
    }));
    let payOpen = '';
    const closePayMenus = (except) => {
      document.querySelectorAll('[data-payp]').forEach((p) => { if (p !== except) p.hidden = true; });
      document.querySelectorAll('[data-payf]').forEach((b) => b.setAttribute('aria-expanded', 'false'));
    };
    const openPayMenu = (key) => {
      const btn = document.querySelector(`[data-payf="${key}"]`);
      const panel = document.querySelector(`[data-payp="${key}"]`);
      if (!btn || !panel) return;
      closePayMenus(panel);
      panel.hidden = false;
      btn.setAttribute('aria-expanded', 'true');
      const r = btn.getBoundingClientRect();
      panel.classList.add('col-filter-panel--fixed');
      const left = r.left > window.innerWidth / 2 ? r.right - 270 : r.left;
      panel.style.left = Math.round(Math.min(Math.max(8, left), window.innerWidth - 278)) + 'px';
      const top = Math.round(r.bottom + 4);
      panel.style.top = top + 'px';
      panel.style.maxHeight = Math.max(220, Math.min(380, window.innerHeight - top - 12)) + 'px';
      const search = panel.querySelector('.pay-filter-search');
      if (search) { search.value = ''; search.focus(); }
      payOpen = key;
    };
    document.querySelectorAll('[data-payf]').forEach((b) => b.addEventListener('click', (ev) => {
      ev.stopPropagation();
      if (payOpen === b.dataset.payf) { closePayMenus(); payOpen = ''; return; }
      openPayMenu(b.dataset.payf);
    }));
    document.addEventListener('click', (ev) => {
      if (ev.target.closest('.col-filter-panel') || ev.target.closest('[data-payf]')) return;
      closePayMenus(); payOpen = '';
    });
    document.querySelectorAll('[data-payp]').forEach((panel) => {
      panel.addEventListener('click', (ev) => ev.stopPropagation());
      panel.querySelector('.pay-filter-search')?.addEventListener('input', (ev) => {
        const q = ev.target.value.toLowerCase();
        panel.querySelectorAll('.ms-row').forEach((row) => { row.hidden = q && !row.textContent.toLowerCase().includes(q); });
      });
      panel.querySelector('[data-payall]')?.addEventListener('click', () => { panel.querySelectorAll('input[type=checkbox]').forEach((b) => { if (!b.closest('.ms-row').hidden) b.checked = true; }); });
      panel.querySelector('[data-paynone]')?.addEventListener('click', () => { panel.querySelectorAll('input[type=checkbox]').forEach((b) => { b.checked = false; }); });
    });
    document.querySelectorAll('[data-payapply]').forEach((b) => b.addEventListener('click', () => {
      const key = b.dataset.payapply;
      const panel = document.querySelector(`[data-payp="${key}"]`);
      FILTERS.payments.cf = {...(FILTERS.payments.cf || {}), [key]: [...panel.querySelectorAll('input[type=checkbox]:checked')].map((x) => x.value)};
      closePayMenus(); payOpen = '';
      rerender();
    }));
    document.querySelectorAll('[data-paytoggle]').forEach((b) => b.addEventListener('click', () => {
      const key = b.dataset.paytoggle;
      FILTERS.payments.sort = {key, dir: FILTERS.payments.sort.key === key && FILTERS.payments.sort.dir === 'asc' ? 'desc' : 'asc'};
      closePayMenus(); payOpen = '';
      rerender();
    }));
    document.querySelector('[data-pay-close]')?.addEventListener('click', goBack);
    document.querySelector('[data-pay-print]')?.addEventListener('click', () => window.print());
    document.querySelectorAll('[data-pay-doc]').forEach((b) => b.addEventListener('click', () => {
      const id = b.dataset.payDoc;
      const sales = /SI/i.test(id);
      navigate({module: 'accounting', tab: sales ? 'sales-invoices' : 'purchase-invoices', mode: 'editor', form: 'invoice', code: id});
    }));
    document.querySelectorAll('[data-pay-open]').forEach((b) => b.addEventListener('click', () => {
      navigate({module: 'accounting', tab: 'payments', mode: 'editor', code: b.dataset.payOpen});
    }));
    document.querySelector('[data-pay-cancel-rec]')?.addEventListener('click', () => {
      const code = document.querySelector('.panel-head h2')?.textContent.trim();
      const rec = PAYMENTS.find((p) => p.id === code);
      if (rec) { rec.state = 'cancelled'; notify('Payment cancelled; it stays in the register.'); }
      goBack();
    });
    document.querySelector('[data-pay-delete-rec]')?.addEventListener('click', () => {
      const code = document.querySelector('.panel-head h2')?.textContent.trim();
      const i = PAYMENTS.findIndex((p) => p.id === code);
      if (i >= 0) { PAYMENTS.splice(i, 1); notify('Payment deleted from the register.'); }
      goBack();
    });
    const form = document.querySelector('[data-pay-form]');
    if (!form) return;
    document.querySelector('[data-form-cancel]')?.addEventListener('click', goBack);
    const syncTotal = () => {
      const total = round2([...document.querySelectorAll('[data-pay-line]')].reduce((n, tr) => n + (Number(tr.querySelector('[data-line-field="amount"]')?.value) || 0), 0));
      const cell = document.querySelector('[data-pay-total]');
      if (cell) cell.textContent = money(total);
    };
    form.addEventListener('input', (ev) => {
      if (!ev.target.matches('[data-line-field="amount"], [name="notes"]')) return;
      capturePay(form);
      syncTotal();
    });
    form.addEventListener('change', (ev) => {
      if (!ev.target.matches('select')) return;
      const field = ev.target.dataset.lineField;
      const tr = ev.target.closest('[data-pay-line]');
      const i = tr ? Number(tr.dataset.payLine) : -1;
      capturePay(form);
      if (field === 'doc' && i >= 0) {
        const party = PARTIES.find((p) => p.name === PAY_FORM.party);
        const item = party ? openItems(party).find((x) => x.id === PAY_FORM.lines[i].doc) : null;
        if (item) {
          const others = round2(PAY_FORM.lines.reduce((n, l, j) => (j !== i && l.doc === item.id ? n + (Number(l.amount) || 0) : n), 0));
          PAY_FORM.lines[i].amount = Math.max(0, round2(item.outstanding - others)).toFixed(2);
        }
      }
      if (field === 'method' && i >= 0) {
        const line = PAY_FORM.lines[i];
        const acc = CASH_BANK.find((c) => c.name === line.account);
        if (acc && (line.method === 'cash' ? acc.kind !== 'cash' : acc.kind !== 'bank')) PAY_FORM.lines[i].account = '';
      }
      rerender();
    });
    document.querySelector('[data-pay-add]')?.addEventListener('click', () => {
      capturePay(form);
      PAY_FORM.lines.push({doc: '', method: 'bank', account: '', amount: ''});
      rerender();
    });
    document.querySelectorAll('[data-pay-line-remove]').forEach((b) => b.addEventListener('click', () => {
      capturePay(form);
      PAY_FORM.lines.splice(Number(b.dataset.payLineRemove), 1);
      if (!PAY_FORM.lines.length) PAY_FORM.lines.push({doc: '', method: 'bank', account: '', amount: ''});
      rerender();
    }));
    const zone = document.querySelector('[data-evidence="payment"]');
    const fileInput = zone?.querySelector('[data-evidence-input]');
    zone?.addEventListener('click', (ev) => { if (ev.target.closest('label, button, input')) return; fileInput?.click(); });
    fileInput?.addEventListener('change', (ev) => { PAY_FILES.push(...[...ev.target.files].map((f) => ({name: f.name, size: f.size}))); ev.target.value = ''; rerender(); });
    zone?.addEventListener('dragover', (ev) => ev.preventDefault());
    zone?.addEventListener('drop', (ev) => { ev.preventDefault(); PAY_FILES.push(...[...ev.dataTransfer.files].map((f) => ({name: f.name, size: f.size}))); rerender(); });
    form.addEventListener('paste', (ev) => { const files = ev.clipboardData ? [...ev.clipboardData.files] : []; if (!files.length) return; ev.preventDefault(); PAY_FILES.push(...files.map((f) => ({name: f.name, size: f.size}))); rerender(); });
    document.querySelectorAll('[data-evidence-remove]').forEach((b) => b.addEventListener('click', () => { PAY_FILES.splice(Number(b.dataset.evidenceRemove), 1); rerender(); }));
    form.addEventListener('submit', (ev) => {
      ev.preventDefault();
      if (!form.reportValidity()) return;
      const v = capturePay(form);
      const party = PARTIES.find((p) => p.name === v.party);
      if (!party) { notify('Choose a party first.'); return; }
      const items = openItems(party);
      const lines = v.lines.filter((l) => l.doc && Number(l.amount) > 0);
      if (!lines.length) { notify('Add at least one document and an amount to set off.'); return; }
      const sums = {};
      for (const line of lines) {
        const item = items.find((x) => x.id === line.doc);
        if (!item) { notify(`${line.doc} is not open for ${party.name}.`); return; }
        if (!line.account) { notify(`Choose the cash or bank sub-account for ${line.doc}.`); return; }
        sums[line.doc] = round2((sums[line.doc] || 0) + Number(line.amount));
        if (sums[line.doc] > item.outstanding + 0.005) { notify(`The amount for ${line.doc} is more than the ${item.outstanding.toFixed(2)} outstanding.`); return; }
      }
      const total = round2(lines.reduce((n, l) => n + Number(l.amount), 0));
      const key = v.direction === 'receive' ? 'receipt' : 'payment';
      const number = nextDocNumber(key, v.date);
      NUMBERING[key].next = (NUMBERING[key].next || 1) + 1;
      const methodLabel = (m) => ({bank: 'Bank transfer', cash: 'Cash'}[m] || m);
      PAYMENTS.push({
        id: number, date: v.date, party: v.party, direction: v.direction,
        account: lines.length > 1 ? `${lines.length} accounts` : lines[0].account,
        amount: total, withheld: 0, net: total,
        method: (() => { const ids = [...new Set(lines.map((l) => l.doc))]; return ids.length === 1 && lines.length > 1 ? 'Split across methods' : lines.length > 1 ? `${ids.length} documents` : methodLabel(lines[0].method); })(),
        reference: '', notes: v.notes || '',
        against: [...new Set(lines.map((l) => l.doc))].join(', '),
        allocations: lines.map((l) => ({id: l.doc, amount: round2(Number(l.amount)), method: l.method, account: l.account})),
        advance: 0,
        tenders: lines.map((l) => ({method: l.method, account: l.account, reference: '', amount: l.amount})),
        files: PAY_FILES.slice(),
        session: true,
      });
      notify(`Saved ${number}: ${lines.length} document${lines.length > 1 ? 's' : ''}, ${money(total)}.`);
      PAY_FORM = {direction: 'receive', party: '', date: '2026-11-30', notes: '', lines: [{doc: '', method: 'bank', account: '', amount: ''}]};
      goBack();
    });
  }

  /* -------------------------------------------------- invoices and bills */
  const invKey = (kind) => (kind === 'sales' ? 'sales' : 'purchase');
  const INV_DRAFT = {
    sales: {party: '', date: '2026-11-30', due: '2026-12-30', terms: '30', reference: '', location: 'HQ', description: 'Service invoiced',
      lines: [{item: '', account: '4000', project: '', qty: '1', price: '0.00', discountType: '', discountValue: '', tax: '10'}], withholding: [{type: 'advance_income', rate: '', basis: 'net', custom: ''}], taxAuthority: '', stockMove: 'no', warehouse: 'HQ', advances: []},
    purchase: {party: '', date: '2026-11-30', due: '2026-12-30', terms: '30', reference: '', location: 'HQ', description: 'Supplier bill',
      lines: [{item: '', account: '5000', project: '', qty: '1', price: '0.00', discountType: '', discountValue: '', tax: '10'}], withholding: [{type: 'withholding_income', rate: '', basis: 'net', custom: ''}], taxAuthority: '', stockMove: 'no', warehouse: 'HQ', advances: []},
  };
  const INV_FILES = {sales: [], purchase: []};
const STOCK_MOVES = [];
const ITEM_ACCOUNT_RULES = [
  {event: 'inventory', group: '', account: '1200'},
  {event: 'cogs', group: '', account: '5100'},
  {event: 'income', group: '', account: '4000'},
  {event: 'expense', group: '', account: '5000'},
  {event: 'clearing', group: '', account: '2400'},
];
  const PAY_FILES = [];
  if (!PAY_FORM.pay) PAY_FORM.pay = {enabled: false, lines: [{method: 'bank', account: '', amount: ''}]};

  function invLineBase(l) { return round2((Number(l.qty) || 0) * (Number(l.price) || 0)); }
  function invLineDiscount(l) {
    const base = invLineBase(l);
    if (l.discountType === 'customPct') return round2(base * (Number(l.discountValue) || 0) / 100);
    if (l.discountType === 'customAmt') return round2(Math.min(Number(l.discountValue) || 0, base));
    if (l.discountType) return round2(base * (Number(l.discountType) || 0) / 100);
    return 0;
  }
  function invLineNet(l) { return round2(invLineBase(l) - invLineDiscount(l)); }
  function invTaxBase(l) { return TAX_AFTER_DISCOUNT ? invLineNet(l) : invLineBase(l); }
  function invLineTax(l) { return round2(invTaxBase(l) * (Number(l.tax) || 0) / 100); }
  function invLineGross(l) { return round2(invLineNet(l) + invLineTax(l)); }
  function invoiceTotals(kind, lines) {
    const base = round2(lines.reduce((n, l) => n + invLineBase(l), 0));
    const discount = round2(lines.reduce((n, l) => n + invLineDiscount(l), 0));
    const net = round2(base - discount);
    const tax = round2(lines.reduce((n, l) => n + invLineTax(l), 0));
    return {base, discount, net, tax, gross: round2(net + tax), rate: 0};
  }
  function whtBaseValue(basis, totals) { return basis === 'gross' ? totals.gross : basis === 'tax' ? totals.tax : totals.net; }
  function whtAmount(w, totals) {
    if (w.rate === 'custom') return round2(Number(w.custom) || 0);
    return round2((whtBaseValue(w.basis, totals) * (Number(w.rate) || 0)) / 100);
  }
  function invoiceWhtTotal(withholding, totals) { return round2((withholding || []).reduce((n, w) => n + whtAmount(w, totals), 0)); }
  function invoiceNetDue(totals, withholding) { return round2(Math.max(totals.gross - invoiceWhtTotal(withholding, totals), 0)); }
  function ruleApplies(rule, item) {
    if (!item) return rule.scope === 'all';
    if (rule.scope === 'all') return true;
    const groups = rule.groups && rule.groups.length ? rule.groups : (rule.group ? [rule.group] : []);
    if (groups.length) return groups.includes(item.group || 'General');
    if (rule.scope === 'items' || rule.scopeType === 'items') return Array.isArray(rule.items) && rule.items.includes(item.code);
    return rule.scopeValue === item.group || rule.scopeValue === item.code;
  }
  function defaultWhtRule(itemCode, kind) {
    const item = ITEMS.find((i) => i.code === itemCode);
    if (!item) return null;
    const desired = kind === 'sales' ? 'advance_income' : 'withholding_income';
    return TAX_RULES.find((r) => r.kind === desired && (r.status || 'Active') === 'Active'
      && ruleApplies(r, item)
      && (!r.from || r.from <= (INV_DRAFT[invKey(kind)].date || '2026-11-30'))) || null;
  }
  function invTaxRateFor(itemCode, kind) {
    const item = ITEMS.find((i) => i.code === itemCode);
    const rule = item ? TAX_RULES.find((r) => r.code === item.tax && r.kind === (kind === 'sales' ? 'output' : 'input')) : null;
    return rule ? String(rule.rate) : '';
  }
  function evidenceSection(key, files, label = 'Supporting documents') {
    return `<div class="wide"><div class="section-title">${e(label)}</div>
      <div class="evidence-drop" data-evidence="${key}">
        <p>Drop files here, or <label class="button">Choose files<input type="file" multiple class="sr-only" data-evidence-input></label></p>
        <small>Any file type · PDF, image, spreadsheet, CSV, video · names and sizes are recorded in this build; bytes are not stored.</small>
      </div>
      <ul class="contract-list file-list" data-evidence-list>${(files || []).map((f, i) => `<li><span>${e(f.name)} <small class="secondary">${Math.max(1, Math.round(f.size / 1024))} KB</small></span><button type="button" class="text-button" data-evidence-remove="${i}">Remove</button></li>`).join('') || '<li class="muted">No file attached.</li>'}</ul></div>`;
  }
  function bindEvidenceZone(key, files, rerender) {
    const zone = document.querySelector(`[data-evidence="${key}"]`);
    if (!zone) return;
    const input = zone.querySelector('[data-evidence-input]');
    const form = zone.closest('form');
    zone.addEventListener('click', (ev) => { if (ev.target.closest('label, button, input')) return; input?.click(); });
    input?.addEventListener('change', (ev) => { files.push(...[...ev.target.files].map((f) => ({name: f.name, size: f.size}))); ev.target.value = ''; rerender(); });
    zone.addEventListener('dragover', (ev) => ev.preventDefault());
    zone.addEventListener('drop', (ev) => { ev.preventDefault(); files.push(...[...ev.dataTransfer.files].map((f) => ({name: f.name, size: f.size}))); rerender(); });
    form?.addEventListener('paste', (ev) => {
      const dropped = ev.clipboardData ? [...ev.clipboardData.files] : [];
      if (!dropped.length) return;
      ev.preventDefault();
      files.push(...dropped.map((f) => ({name: f.name, size: f.size})));
      rerender();
    });
    zone.parentElement.querySelectorAll('[data-evidence-remove]').forEach((b) => b.addEventListener('click', () => {
      files.splice(Number(b.dataset.evidenceRemove), 1);
      rerender();
    }));
  }
  function ledgerIllustration(title, lines, note) {
    if (!lines || !lines.length) {
      return `<div class="wide"><div class="section-title">${e(title)}</div><p class="form-note">No ledger effect from this form as filled.</p></div>`;
    }
    const debit = round2(lines.reduce((n, l) => n + Number(l.debit || 0), 0));
    const credit = round2(lines.reduce((n, l) => n + Number(l.credit || 0), 0));
    const withAuthority = lines.some((l) => l.authority);
    return `<div class="wide"><div class="section-title">${e(title)}</div>
      <div class="table-scroll"><table class="invoice-lines"><thead><tr><th>Account</th><th>Party / sub-account</th>${withAuthority ? '<th>Authority</th>' : ''}<th class="numeric">Debit</th><th class="numeric">Credit</th></tr></thead><tbody>
        ${lines.map((l) => `<tr><td>${e(l.account)} · ${e((accounts().find((a) => a.code === l.account) || {}).name || 'Unknown account')}</td><td>${e(l.party || '—')}</td>${withAuthority ? `<td>${e(l.authority || '—')}</td>` : ''}<td class="numeric">${l.debit ? money(l.debit) : '—'}</td><td class="numeric">${l.credit ? money(l.credit) : '—'}</td></tr>`).join('')}
      </tbody><tfoot><tr><td colspan="${withAuthority ? 3 : 2}">Balanced illustration${Math.abs(debit - credit) > 0.005 ? ' · check' : ''}</td><td class="numeric">${money(debit)}</td><td class="numeric">${money(credit)}</td></tr></tfoot></table></div>
      <p class="form-note">${e(note || 'Illustrative only; nothing posts to the ledger in this build.')}</p></div>`;
  }
  function invoiceEntryLines(kind, draft, totals, withholding) {
    const isSales = kind === 'sales';
    const lines = [];
    const byAccount = {};
    (draft.lines || []).forEach((l) => { if (!l.account) return; byAccount[l.account] = round2((byAccount[l.account] || 0) + invLineNet(l)); });
    Object.entries(byAccount).forEach(([account, amount]) => lines.push({account, party: '', debit: isSales ? 0 : amount, credit: isSales ? amount : 0}));
    if (totals.tax) {
      const taxAuth = (draft.taxAuthority && TAX_AUTHORITIES.find((a) => a.id === draft.taxAuthority)) || defaultAuthorityFor(isSales ? 'output' : 'input');
      lines.push({account: isSales ? TAX_DEFAULTS.output : TAX_DEFAULTS.input, party: '', authority: taxAuth.name, debit: isSales ? 0 : totals.tax, credit: isSales ? totals.tax : 0});
    }
    const wht = invoiceWhtTotal(withholding, totals);
    const due = invoiceNetDue(totals, withholding);
    lines.push({account: isSales ? '1100' : '2100', party: draft.party, debit: isSales ? due : 0, credit: isSales ? 0 : due});
    const byWht = {};
    (withholding || []).forEach((w) => {
      if (!w.rate) return;
      const account = w.type === 'advance' || w.type === 'advance_income' ? TAX_DEFAULTS.advanceIncome : w.type === 'advance_sales' ? TAX_DEFAULTS.advanceSales : w.type === 'sales' || w.type === 'withholding_sales' ? TAX_DEFAULTS.withholdingSales : TAX_DEFAULTS.withholdingIncome;
      byWht[account] = round2((byWht[account] || 0) + whtAmount(w, totals));
    });
    Object.entries(byWht).forEach(([account, amount]) => lines.push({account, party: draft.party, debit: isSales ? amount : 0, credit: isSales ? 0 : amount}));
    const grouped = [];
    const byKey = {};
    lines.forEach((l) => {
      const key = l.account + '|' + (l.party || '');
      if (!byKey[key]) { byKey[key] = {account: l.account, party: l.party || '', debit: 0, credit: 0}; grouped.push(byKey[key]); }
      byKey[key].debit = round2(byKey[key].debit + Number(l.debit || 0));
      byKey[key].credit = round2(byKey[key].credit + Number(l.credit || 0));
    });
    return grouped.filter((l) => l.debit || l.credit);
  }

  function returnedFor(kind, id) {
    return round2(RETURNS[kind].filter((r) => r.invoiceId === id).reduce((n, r) => n + r.gross, 0));
  }
  function paidFor(kind, id) {
    const fromSession = PAYMENTS.reduce((n, p) => n + (p.allocations || []).filter((a) => a.id === id).reduce((m, a) => m + a.amount, 0), 0);
    const fromAdvance = round2(ADVANCE_APPLIED.filter((a) => a.docId === id).reduce((n, a) => n + Number(a.amount || 0), 0));
    const control = kind === 'sales' ? '1100' : '2100';
    const fromFixture = fixture(getCompany()).filter((d) => d.againstVoucher === id).reduce((n, d) => n + d.lines.filter((l) => l.account === control).reduce((m, l) => m + (kind === 'sales' ? num(l.credit) - num(l.debit) : num(l.debit) - num(l.credit)), 0), 0);
    return round2(fromSession + fromFixture + fromAdvance);
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
        const byAccount = {};
        d.lines.filter((l) => (isSales ? String(l.account).startsWith('4') : String(l.account).startsWith('5'))).forEach((l) => {
          const value = round2(isSales ? num(l.credit) - num(l.debit) : num(l.debit) - num(l.credit));
          if (!byAccount[l.account]) byAccount[l.account] = {value: 0, project: l.project || ''};
          byAccount[l.account].value = round2(byAccount[l.account].value + value);
        });
        const taxRate = net ? round2((tax / net) * 100) : 0;
        const lines = Object.entries(byAccount).map(([account, x]) => ({item: '', account, project: x.project, qty: '1', price: String(x.value), discountType: '', discountValue: '', tax: String(taxRate)}));
        const withholding = [];
        d.lines.forEach((l) => {
          if (l.account === TAX_DEFAULTS.advanceIncome) withholding.push({type: 'advance_income', rate: 'custom', custom: String(round2(num(l.debit) - num(l.credit))), basis: 'net'});
          if (l.account === TAX_DEFAULTS.withholdingIncome) withholding.push({type: 'withholding_income', rate: 'custom', custom: String(round2(num(l.credit) - num(l.debit))), basis: 'net'});
          if (l.account === TAX_DEFAULTS.withholdingSales) withholding.push({type: 'withholding_sales', rate: 'custom', custom: String(round2(num(l.credit) - num(l.debit))), basis: 'net'});
        });
        return {id: d.id, date: d.date, party: d.party, due, net, tax, gross, project: d.project || '', returned: returnedFor(kind, d.id), paid: paidFor(kind, d.id), session: false, lines, withholding, taxAuthority: TAX_FIXTURE_AUTHORITIES[isSales ? 'output' : 'input'], description: d.narrative || '', location: d.location || 'HQ', reference: d.supplierRef || ''};
      });
    const session = INVOICES.filter((x) => x.kind === kind).map((x) => ({id: x.id, date: x.date, party: x.party, due: x.due, net: x.net, tax: x.tax, gross: x.gross, netDue: x.netDue ?? x.gross, project: (x.lines && x.lines[0] && x.lines[0].project) || '', returned: returnedFor(kind, x.id), paid: paidFor(kind, x.id), state: x.state || 'posted', session: true, lines: x.lines || [], withholding: x.withholding || [], advances: x.advances || [], taxAuthority: x.taxAuthority || '', description: x.description || '', location: x.location || 'HQ', reference: x.reference || '', terms: x.terms || '30'}));
    return session.concat(fromFixture)
      .map((r) => ({...r, balance: round2(Math.max((r.netDue ?? r.gross) - r.returned - (r.paid || 0), 0))}))
      .sort((a, b) => b.date.localeCompare(a.date) || b.id.localeCompare(a.id));
  }
  function invoiceEditor(kind, code) {
    const isSales = kind === 'sales';
    const source = code ? invoiceRows(kind).find((r) => r.id === code) : null;
    const locked = Boolean(source && !source.session);
    const draft = source && source.session
      ? {party: source.party, date: source.date, due: source.due, terms: source.terms || '30', reference: source.reference || '', location: source.location || 'HQ', description: source.description || '', lines: source.lines || [], withholding: source.withholding || [], advances: source.advances || [], taxAuthority: source.taxAuthority || ''}
      : source ? null : INV_DRAFT[invKey(kind)];
    const lines = draft ? draft.lines : [];
    const withholding = draft ? (draft.withholding || []) : [];
    const totals = source ? {net: source.net, tax: source.tax, gross: source.gross, rate: 0} : invoiceTotals(kind, lines);
    const whtTotal = invoiceWhtTotal(withholding, totals);
    const netDue = invoiceNetDue(totals, withholding);
    const parties = PARTIES.filter((p) => (isSales ? p.type === 'customer' : p.type === 'supplier'));
    const incomeAccounts = accounts().filter((a) => (isSales ? a.type === 'income' : (a.type === 'expense' || a.code === '2400' || a.code === '1200' || a.subtype === 'clearing')));
    const taxKind = isSales ? 'output' : 'input';
    const taxAuthority = (draft && draft.taxAuthority) || TAX_DEFAULT_AUTHORITIES[taxKind] || '';
    const taxAuthorityOptions = TAX_AUTHORITIES.filter((a) => authorityHas(a, taxKind) && a.active !== false);
    const whtRates = [...new Set(['0.5', '1', '2', '4.5', '7.5', '10', '15', ...TAX_RULES.filter((r) => ['withholding_income', 'withholding_sales', 'advance_income', 'advance_sales'].includes(r.kind)).map((r) => String(r.rate))])];
    const party = PARTIES.find((p) => p.name === (draft ? draft.party : ''));
    const openAdvances = party ? ADVANCES.filter((a) => a.party === party.name && a.direction === (isSales ? 'receive' : 'pay') && advanceOpen(a) > 0) : [];
    const advanceApplied = round2((draft ? (draft.advances || []) : []).reduce((n, a) => n + (Number(a.amount) || 0), 0));
    const typeOptions = isSales
      ? [['advance_income', 'Advance income tax withheld by customer'], ['advance_sales', 'Advance sales tax withheld by customer']]
      : [['withholding_income', 'Income tax withholding'], ['withholding_sales', 'Sales tax withholding']];
    const lineRows = lines.map((l, i) => `<tr data-inv-line="${i}">
      <td><select data-inv-field="item" class="inline-input"><option value="">Choose item</option>${ITEMS.map((it) => `<option value="${e(it.code)}" ${it.code === l.item ? 'selected' : ''}>${e(it.code)} · ${e(it.name)}</option>`).join('')}</select></td>
      <td><select data-inv-field="account" class="inline-input">${incomeAccounts.map((a) => `<option value="${a.code}" ${a.code === l.account ? 'selected' : ''}>${a.code} · ${e(a.name)}</option>`).join('')}</select></td>
      <td><select data-inv-field="project" class="inline-input">${['', ...PROJECTS.map((p) => p.code)].map((p) => `<option value="${p}" ${p === (l.project || '') ? 'selected' : ''}>${p || 'No project'}</option>`).join('')}</select></td>
      <td><input class="numeric" data-inv-field="qty" value="${e(l.qty)}" inputmode="decimal" aria-label="Line ${i + 1} quantity"></td>
      <td><input class="numeric" data-inv-field="price" value="${e(l.price)}" inputmode="decimal" aria-label="Line ${i + 1} unit price"></td>
      <td class="discount-cell"><select data-inv-field="discountType" class="inline-input" aria-label="Line ${i + 1} discount">
        <option value="">No discount</option>
        ${['5', '10', '15', '20'].map((d) => `<option value="${d}" ${l.discountType === d ? 'selected' : ''}>${d}%</option>`).join('')}
        <option value="customPct" ${l.discountType === 'customPct' ? 'selected' : ''}>Custom %</option>
        <option value="customAmt" ${l.discountType === 'customAmt' ? 'selected' : ''}>Custom amount</option>
      </select>${l.discountType === 'customPct' || l.discountType === 'customAmt' ? `<input class="discount-input" data-inv-field="discountValue" value="${e(l.discountValue)}" inputmode="decimal" placeholder="${l.discountType === 'customPct' ? 'Percent' : 'Amount'}" aria-label="Line ${i + 1} discount value">` : ''}</td>
      <td class="numeric" data-line-net>${money(invLineNet(l))}</td>
      <td><input class="numeric" data-inv-field="tax" value="${e(l.tax)}" inputmode="decimal" aria-label="Line ${i + 1} tax rate"></td>
      <td class="numeric" data-line-gross>${money(invLineGross(l))}</td>
      <td><button type="button" class="text-button" data-inv-line-remove="${i}" ${lines.length === 1 ? 'disabled' : ''}>Remove</button></td>
    </tr>`).join('');
    const whtRows = withholding.map((w, i) => `<tr data-inv-wht="${i}">
      <td><select data-wht-field="type" class="inline-input">${typeOptions.map(([k, label]) => `<option value="${k}" ${w.type === k ? 'selected' : ''}>${label}</option>`).join('')}</select></td>
      <td class="wht-rate-cell"><select data-wht-field="rate" class="inline-input"><option value="custom" ${w.rate === 'custom' ? 'selected' : ''}>Custom amount</option><option value="" ${!w.rate ? 'selected' : ''}>Choose rate</option>${whtRates.map((r) => `<option value="${r}" ${w.rate === r ? 'selected' : ''}>${r}%</option>`).join('')}</select>${w.rate === 'custom' ? `<input class="wht-custom" data-wht-field="custom" value="${e(w.custom || '')}" inputmode="decimal" placeholder="Amount" aria-label="Custom withholding amount">` : ''}</td>
      <td><select data-wht-field="basis" class="inline-input"><option value="net" ${w.basis === 'net' ? 'selected' : ''}>Before sales tax</option><option value="gross" ${w.basis === 'gross' ? 'selected' : ''}>After sales tax</option><option value="tax" ${w.basis === 'tax' ? 'selected' : ''}>Sales tax only</option></select></td>
      <td class="numeric" data-wht-amount>${money(whtAmount(w, totals))}</td>
      <td><button type="button" class="text-button" data-wht-remove="${i}">Remove</button></td>
    </tr>`).join('');
    const tenders = INV_TENDERS[kind];
    const tenderTotal = round2(tenders.reduce((n, t) => n + (Number(t.amount) || 0), 0));
    const balanceAfter = round2(Math.max(netDue - Math.min(tenderTotal, netDue) - advanceApplied, 0));
    const tenderRows = tenders.map((t, i) => `<tr data-inv-tender="${i}">
      <td><select data-inv-tender-field="method" class="inline-input"><option value="bank" ${t.method === 'bank' ? 'selected' : ''}>Bank transfer</option><option value="cash" ${t.method === 'cash' ? 'selected' : ''}>Cash</option></select></td>
      <td><select data-inv-tender-field="account" class="inline-input"><option value="">Choose sub-account</option>${CASH_BANK.filter((c) => (t.method === 'cash' ? c.kind === 'cash' : c.kind === 'bank')).map((c) => `<option value="${e(c.name)}" ${c.name === t.account ? 'selected' : ''}>${e(c.name)}</option>`).join('')}</select></td>
      <td><input class="numeric" data-inv-tender-field="amount" value="${e(t.amount)}" inputmode="decimal" aria-label="Payment ${i + 1} amount"></td>
      <td><button type="button" class="text-button" data-inv-tender-remove="${i}" ${tenders.length === 1 ? 'disabled' : ''}>Remove</button></td>
    </tr>`).join('');
    const entry = invoiceEntryLines(kind, draft || {lines, party: ''}, totals, withholding);
    const trackedLines = lines.filter((l) => (ITEMS.find((i) => i.code === l.item) || {}).tracked);
    const stockValue = round2(trackedLines.reduce((n, l) => {
      if (!isSales) return n + invLineNet(l);
      const item = ITEMS.find((i) => i.code === l.item) || {};
      const unitCost = Number(item.purchasePrice) || Number(l.price) || 0;
      return n + (Number(l.qty) || 0) * unitCost;
    }, 0));
    const stockEntry = draft && draft.stockMove === 'yes' && stockValue
      ? (isSales
        ? [{account: itemAccountFor('cogs'), party: '', debit: stockValue, credit: 0}, {account: itemAccountFor('inventory'), party: '', debit: 0, credit: stockValue}]
        : [{account: itemAccountFor('inventory'), party: '', debit: stockValue, credit: 0}, {account: itemAccountFor('clearing') || '2400', party: '', debit: 0, credit: stockValue}])
      : [];
    return `<section class="panel">
      <div class="panel-head"><h2>${source ? e(source.id) : isSales ? 'Sales invoice' : 'Purchase bill'}</h2><div class="related">${locked ? '<span class="badge good">Posted · read-only</span>' : `<span class="badge" data-inv-badge>${isSales ? 'Receivable' : 'Payable'} ${money(netDue)}</span>`}
        <details class="form-menu"><summary class="icon-button" aria-label="More document options">${icon('more')}</summary><div class="menu">
          ${source ? `<button type="button" data-inv-menu-return>Return</button><button type="button" data-inv-menu-duplicate>Duplicate</button>` : ''}
          ${source && source.session ? `<button type="button" data-inv-menu-cancel>Cancel document</button><button type="button" data-inv-menu-delete>Delete document</button>` : ''}
          ${source ? `<button type="button" data-inv-menu-payment>Create payment / receipt</button><button type="button" data-inv-menu-stock>Record inventory</button>` : ''}<button type="button" data-inv-menu-print>Print</button>
        </div></details></div></div>
      ${locked ? `<div class="panel-body"><div class="callout"><strong>Posted document.</strong> The complete document is shown read-only. Create a return to reduce its balance; partial returns are allowed.</div>
        <div class="record-summary"><div><small>${isSales ? 'Customer' : 'Supplier'}</small>${e(source.party)}</div><div><small>Date</small>${e(source.date)}</div><div><small>Due</small>${e(source.due)}</div><div><small>Location</small>${e(source.location || 'HQ')}</div></div>
        ${source.description ? `<p class="form-note">${e(source.description)}</p>` : ''}
        <div class="record-summary invoice-subsummary"><div><small>Net</small>${money(totals.net)}</div><div><small>Tax</small>${money(totals.tax)}</div><div><small>Gross</small>${money(totals.gross)}</div><div><small>Returned</small>${money(source.returned)}</div><div><small>Balance</small>${money(source.balance)}</div></div></div>
        <div class="panel-body"><div class="section-title">Items</div>
          <div class="table-scroll"><table class="invoice-lines inv-items"><thead><tr><th>Item</th><th>Account</th><th>Project</th><th class="numeric">Qty</th><th class="numeric">Unit price</th><th>Discount</th><th class="numeric">Total</th><th class="numeric">Tax %</th><th class="numeric">Total after tax</th><th></th></tr></thead>
          <tbody>${(source.lines || []).map((l) => `<tr><td>${e(l.item || '—')}</td><td>${e(l.account)} · ${e((accounts().find((a) => a.code === l.account) || {}).name || '')}</td><td>${e(l.project || '—')}</td><td class="numeric">${e(l.qty)}</td><td class="numeric">${money(l.price)}</td><td>${l.discountType ? e(l.discountType === 'customAmt' ? money(l.discountValue) : l.discountValue + '%') : '—'}</td><td class="numeric">${money(invLineNet(l))}</td><td class="numeric">${e(l.tax)}%</td><td class="numeric">${money(invLineGross(l))}</td><td></td></tr>`).join('') || '<tr><td colspan="10">Line detail is not in the fixture.</td></tr>'}</tbody></table></div>
        </div>
        ${(source.withholding || []).length ? `<div class="panel-body"><div class="section-title">Withholding</div><div class="table-scroll"><table class="invoice-lines inv-wht"><thead><tr><th>Type</th><th>Rate / amount</th><th>Withholding base</th><th class="numeric">Amount</th><th></th></tr></thead><tbody>${source.withholding.map((w) => `<tr><td>${e(w.type === 'advance' || w.type === 'advance_income' ? 'Advance income tax withheld' : w.type === 'advance_sales' ? 'Advance sales tax withheld' : w.type === 'sales' || w.type === 'withholding_sales' ? 'Sales tax withheld' : 'Income tax withholding')}</td><td>${w.rate === 'custom' ? money(w.custom) : e(w.rate) + '%'}</td><td>${e(w.basis === 'net' ? 'Before sales tax' : w.basis === 'gross' ? 'After sales tax' : 'Sales tax only')}</td><td class="numeric">${money(whtAmount(w, totals))}</td><td></td></tr>`).join('')}</tbody></table></div></div>` : ''}
        <div class="panel-body form-grid">${ledgerIllustration(isSales ? 'Illustrative invoice entry' : 'Illustrative bill entry', invoiceEntryLines(kind, {lines: source.lines || [], withholding: source.withholding || [], party: source.party, taxAuthority: source.taxAuthority}, totals, source.withholding || []), 'Derived from the posted document; this build does not re-post.')}</div>`
      : `<form data-invoice-form="${kind}">
        <input type="hidden" name="editingCode" value="${e(source ? source.id : '')}">
        <div class="panel-body form-grid">
          <label>${isSales ? 'Customer' : 'Supplier'}<select name="party" class="inline-input" required><option value="">Choose a party</option>${parties.map((p) => `<option value="${e(p.name)}" ${p.name === (draft && draft.party) ? 'selected' : ''}>${e(p.name)} · ${e(p.code)}</option>`).join('')}</select></label>
          <label>Date<input name="date" type="date" value="${e(draft ? draft.date : '2026-11-30')}" required></label>
          <label>Due date<input name="due" type="date" value="${e(draft ? draft.due : '2026-12-30')}"></label>
          <label>Terms (days)<input name="terms" type="number" min="0" max="365" value="${e(draft ? draft.terms || '30' : '30')}"></label>
          <label>${isSales ? 'Customer reference' : 'Supplier invoice no'}<input name="reference" maxlength="40" value="${e(draft ? draft.reference || '' : '')}"></label>
          <label>Location<select name="location" class="inline-input">${LOCATIONS.map((l) => `<option value="${e(l.code)}" ${draft && l.code === (draft.location || 'HQ') ? 'selected' : ''}>${e(l.code)} · ${e(l.name)}</option>`).join('')}</select></label>
          <label class="wide">Description<textarea name="description" maxlength="200" placeholder="What this document is for">${e(draft ? draft.description || '' : '')}</textarea></label>
          
        </div>
        <div class="panel-body">
          <div class="section-title">Items</div>
          <div class="table-scroll"><table class="invoice-lines inv-items">
            <thead><tr><th>Item</th><th>Account</th><th>Project</th><th class="numeric">Qty</th><th class="numeric">Unit price</th><th>Discount</th><th class="numeric">Total</th><th class="numeric">Tax %</th><th class="numeric">Total after tax</th><th></th></tr></thead>
            <tbody>${lineRows}</tbody>
            <tfoot>
              <tr><td colspan="6">Original total</td><td class="numeric" data-inv-base>${money(totals.base)}</td><td></td><td class="numeric" data-inv-base2>${money(totals.base)}</td><td></td></tr>
              <tr><td colspan="6">Discount total</td><td class="numeric" data-inv-discount>${totals.discount ? '−' : ''}${money(totals.discount)}</td><td></td><td class="numeric" data-inv-discount2>${totals.discount ? '−' : ''}${money(totals.discount)}</td><td></td></tr>
              <tr><td colspan="6">Net total</td><td class="numeric" data-inv-net>${money(totals.net)}</td><td></td><td class="numeric" data-inv-net2>${money(totals.net)}</td><td></td></tr>
              <tr><td colspan="4">${isSales ? 'Sales tax authority' : 'Purchase tax authority'}</td><td colspan="4"><select name="taxAuthority" class="inline-input" data-inv-tax-authority aria-label="Tax authority">${taxAuthorityOptions.map((a) => `<option value="${e(a.id)}" ${a.id === taxAuthority ? 'selected' : ''}>${e(a.name)}${a.registration ? ' · ' + e(a.registration) : ''}</option>`).join('')}</select></td><td class="numeric" data-inv-tax>${money(totals.tax)}</td><td></td></tr>
              <tr><td colspan="6">Invoice total</td><td colspan="2"></td><td class="numeric" data-inv-gross><strong>${money(totals.gross)}</strong></td><td></td></tr>
            </tfoot>
          </table></div>
          <div class="related"><button type="button" class="button" data-inv-add-line>Add item row</button></div>
        </div>
        <div class="panel-body">
          <div class="record-summary invoice-due"><div><small>Gross ${isSales ? 'receivable' : 'payable'}</small><span data-inv-gross2>${money(totals.gross)}</span></div><div><small>Withholding</small><span data-inv-wht-total>${money(whtTotal)}</span></div><div><small>Net ${isSales ? 'receivable' : 'payable'}</small><strong data-inv-due>${money(netDue)}</strong></div><div><small>Advances applied</small><span data-inv-adv-total>${money(advanceApplied)}</span></div><div><small>Balance after advances</small><strong data-inv-balance>${money(balanceAfter)}</strong></div></div>
          <div class="section-title">${isSales ? 'Withholding by customer' : 'Withholding from supplier'}</div>
          <div class="table-scroll"><table class="invoice-lines inv-wht">
            <thead><tr><th>Type</th><th>Rate / amount</th><th>Withholding base</th><th class="numeric">Amount</th><th></th></tr></thead>
            <tbody>${whtRows}</tbody>
          </table></div>
          <div class="related"><button type="button" class="button" data-inv-add-wht>Add withholding row</button></div>
          <p class="form-note">${isSales ? 'Advance tax withheld by the customer reduces what we receive; it is our asset, not a cost.' : 'Withholding from a supplier is money we deduct and owe to the authority.'} Net ${isSales ? 'receivable' : 'payable'} after withholding is the amount the control account carries.</p>
        </div>
        <div class="panel-body form-grid">${evidenceSection('invoice-' + kind, INV_FILES[kind])}${ledgerIllustration(isSales ? 'Illustrative invoice entry on save' : 'Illustrative bill entry on save', entry, isSales ? 'Receivable carries the net due after customer withholding; tax and advance tax sit in their own accounts.' : 'Payable carries the net due after withholding; input tax and withholding payable sit in their own accounts.')}
          ${INV_PAY[kind] && tenderTotal > 0 ? ledgerIllustration(isSales ? 'Illustrative receipt voucher' : 'Illustrative payment voucher', paymentEntryLines(isSales ? 'receive' : 'pay', draft ? draft.party : '', tenders.map((t) => ({account: t.account, amount: t.amount}))), `Creates ${nextDocNumber(isSales ? 'receipt' : 'payment', draft ? draft.date : '2026-11-30')} as a separate document.${tenderTotal > netDue ? ` Total received exceeds the net due by ${money(round2(tenderTotal - netDue))}; the excess is kept as an advance and is not part of this entry.` : ''}`) : ''}
          ${stockEntry.length ? ledgerIllustration(isSales ? 'Illustrative inventory issue' : 'Illustrative inventory receipt', stockEntry, isSales ? 'Goods issued at cost: cost of sales against inventory, using the item default accounts. This is the cost side of the sale; the invoice line carries the revenue.' : 'Goods received at the amount after discount and before sales tax: inventory against goods received clearing, using the item default accounts. The bill itself debits clearing, so the clearing account nets out.') : ''}
          ${advanceApplied > 0 ? ledgerIllustration('Illustrative advance application', isSales ? [{account: '2300', party: draft ? draft.party : '', debit: advanceApplied, credit: 0}, {account: '1100', party: draft ? draft.party : '', debit: 0, credit: advanceApplied}] : [{account: '2100', party: draft ? draft.party : '', debit: advanceApplied, credit: 0}, {account: '1250', party: draft ? draft.party : '', debit: 0, credit: advanceApplied}], 'Applying an advance moves value already received or paid onto this document; it does not create a new cash movement.') : ''}</div>
        <div class="panel-body"><div class="related"><button type="button" class="button primary" data-inv-save>Save for this session</button><button type="button" class="button" data-form-cancel>Cancel</button></div>
          <p class="form-note">A saved document is numbered in the session series and appears in the register; no ledger entry is written in this build.</p></div>
      </form>`}
    </section>`;
  }

  function invoiceStatus(r) { if (r.state === 'cancelled') return 'cancelled'; return r.returned >= r.gross && r.gross > 0 ? 'returned' : r.returned > 0 ? 'partly returned' : 'posted'; }
  function invoiceColValue(r, key) { return key === 'state' ? invoiceStatus(r) : (r[key] ?? ''); }
  function invoiceColValues(kind, key) {
    return [...new Set(invoiceRows(kind).map((r) => String(invoiceColValue(r, key))))].sort((a, b) => a.localeCompare(b, undefined, {numeric: true})).slice(0, 200);
  }
  function invoiceColLabel(key, v) { return ['net', 'tax', 'gross', 'returned', 'paid', 'balance'].includes(key) ? money(Number(v) || 0) : v; }
  function returnColValue(r, key) { return r[key] ?? ''; }
  function returnColValues(key) {
    return [...new Set(RETURNS.sales.concat(RETURNS.purchase).map((r) => String(returnColValue(r, key))))].sort((a, b) => a.localeCompare(b, undefined, {numeric: true})).slice(0, 200);
  }
  function returnColLabel(key, v) { return ['net', 'tax', 'gross'].includes(key) ? money(Number(v) || 0) : v; }
  function stockEditor(kind, code) {
    const isSales = kind === 'sales';
    const inv = invoiceRows(kind).find((r) => r.id === code);
    if (!inv) return `<section class="panel"><div class="panel-body"><p>That document is not in the register.</p><div class="related"><button type="button" class="button" data-stock-cancel>Back</button></div></div></section>`;
    const tracked = (inv.lines || []).filter((l) => (ITEMS.find((i) => i.code === l.item) || {}).tracked);
    const value = round2(tracked.reduce((n, l) => n + invLineNet(l), 0));
    const entry = isSales
      ? [{account: itemAccountFor('cogs'), party: '', debit: value, credit: 0}, {account: itemAccountFor('inventory'), party: '', debit: 0, credit: value}]
      : [{account: itemAccountFor('inventory'), party: '', debit: value, credit: 0}, {account: itemAccountFor('clearing') || '2400', party: '', debit: 0, credit: value}];
    return `<section class="panel">
      <div class="panel-head"><h2>${isSales ? 'Goods issue' : 'Goods receipt'} · ${e(inv.id)}</h2><span class="badge">Separate stock voucher</span></div>
      <form data-stock-form="${kind}"><input type="hidden" name="invoice" value="${e(inv.id)}">
        <div class="panel-body form-grid">
          <label>Party<input readonly value="${e(inv.party)}"></label>
          <label>Date<input name="date" type="date" value="2026-11-30" required></label>
          <label>Warehouse<select name="warehouse" class="inline-input">${LOCATIONS.map((l) => `<option value="${e(l.code)}" ${l.code === (inv.location || 'HQ') ? 'selected' : ''}>${e(l.code)} · ${e(l.name)}</option>`).join('')}</select></label>
        </div>
        <div class="panel-body"><div class="section-title">Tracked items</div>
          <div class="table-scroll"><table class="invoice-lines"><thead><tr><th>Item</th><th>Name</th><th class="numeric">Quantity</th><th class="numeric">Value</th></tr></thead><tbody>${tracked.map((l) => { const item = ITEMS.find((i) => i.code === l.item) || {}; return `<tr><td class="mono">${e(l.item)}</td><td>${e(item.name || '')}</td><td class="numeric">${l.qty}</td><td class="numeric">${money(invLineNet(l))}</td></tr>`; }).join('') || '<tr><td colspan="4">No tracked items on this document.</td></tr>'}</tbody></table></div>
        </div>
        <div class="panel-body form-grid">${ledgerIllustration(isSales ? 'Illustrative goods issue' : 'Illustrative goods receipt', tracked.length ? entry : [], 'The stock voucher moves the exact quantities shown. Inventory quantities and valuation are updated when the inventory ledger is connected.')}</div>
        <div class="panel-body"><div class="related"><button class="button primary">Record ${isSales ? 'issue' : 'receipt'}</button><button type="button" class="button" data-stock-cancel>Cancel</button></div></div>
      </form>
    </section>`;
  }
  function invoicesView(kind) {
    const isSales = kind === 'sales';
    const tab = INV_TAB[kind] === 'returns' ? 'returns' : 'invoices';
    const tabs = `<div class="tabs" role="tablist" aria-label="${isSales ? 'Sales invoice' : 'Purchase bill'} views"><button role="tab" aria-selected="${tab === 'invoices'}" data-inv-tab="${kind}:invoices">${isSales ? 'Invoices' : 'Purchase bills'}</button><button role="tab" aria-selected="${tab === 'returns'}" data-inv-tab="${kind}:returns">Returns</button></div>`;
    if (tab === 'returns') {
      const f = FILTERS.invoiceReturns;
      let returns = RETURNS[kind].slice().filter((r) => hit(f.q, r.id, r.invoiceId, r.party, r.date, r.reason)
        && (!f.from || r.date >= f.from) && (!f.to || r.date <= f.to)
        && Object.entries(f.cf || {}).every(([k, v]) => !v || !v.length || v.includes(String(returnColValue(r, k)))));
      returns = returns.sort((a, b) => { const x = returnColValue(a, f.sort.key), y = returnColValue(b, f.sort.key); const d = typeof x === 'number' && typeof y === 'number' ? x - y : String(x ?? '').localeCompare(String(y ?? ''), undefined, {numeric: true}); return f.sort.dir === 'desc' ? -d : d; });
      const cols = [['date', 'Date'], ['id', 'Return'], ['invoiceId', 'Original'], ['party', 'Party'], ['net', 'Net', 'numeric'], ['tax', 'Tax', 'numeric'], ['gross', 'Gross', 'numeric'], ['reason', 'Reason']];
      const cells = {
        date: (r) => `<td class="col col-date">${e(r.date)}</td>`,
        id: (r) => `<td class="col col-id mono">${e(r.id)}</td>`,
        invoiceId: (r) => `<td class="col col-invoiceId mono">${e(r.invoiceId)}</td>`,
        party: (r) => `<td class="col col-party">${e(r.party)}</td>`,
        net: (r) => `<td class="col col-net numeric">${money(r.net)}</td>`,
        tax: (r) => `<td class="col col-tax numeric">${money(r.tax)}</td>`,
        gross: (r) => `<td class="col col-gross numeric">${money(r.gross)}</td>`,
        reason: (r) => `<td class="col col-reason">${e(r.reason)}</td>`,
      };
      return tabs + `<form class="filterbar" data-filter="invoiceReturns" data-inv-filter="returns">
          ${filterInput('invoiceReturns', f.q, 'Return number, party, invoice')}
          <label>From<input type="date" name="from" value="${e(f.from || '')}"></label>
          <label>To<input type="date" name="to" value="${e(f.to || '')}"></label>
          <button class="button" type="button" data-inv-reset="${kind}:returns">Reset</button>
          <button class="button primary" type="button" data-new-return="${kind}">New return</button>
        </form>
        <section class="panel">
          <div class="panel-head"><h2>Returns</h2><div class="related"><span class="badge">${returns.length} of ${RETURNS[kind].length} documents</span><button class="button" data-export-table>Export CSV</button></div></div>
          <div class="table-scroll" data-hscroll><table class="pay-register">
            <thead><tr>${cols.map(([key, label, cls]) => {
              const sel = (f.cf && f.cf[key]) || [];
              return `<th class="col col-${key} ${cls || ''}"><div class="th-flex"><button class="sortable" data-inv-sort="returns:${key}" aria-sort="${f.sort.key === key ? (f.sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}">${label}<span class="sort-mark">${f.sort.key === key ? (f.sort.dir === 'asc' ? '▲' : '▼') : ''}</span></button><button type="button" class="col-filter-btn" data-invf="returns:${key}" aria-label="Filter ${e(label)}" aria-expanded="false">${icon('chevron')}${sel.length ? `<b>${sel.length}</b>` : ''}</button></div>
                <div class="col-filter-panel" data-invp="returns:${key}" hidden><div class="gl-sortrow"><span class="gl-sortlabel">Sort</span><button type="button" class="sort-toggle ${f.sort.key === key ? 'active' : ''}" data-invtoggle="returns:${key}">${f.sort.key === key ? (f.sort.dir === 'asc' ? '↑' : '↓') : '↕'}</button></div>
                <div class="ms-searchrow"><input class="ms-search inv-filter-search" type="search" placeholder="Search values"></div>
                <div class="ms-head"><button type="button" class="text-button" data-invall="returns:${key}">Select all</button><span class="ms-count">${returnColValues(key).length}</span><button type="button" class="text-button" data-invnone="returns:${key}">Clear</button></div>
                <div class="ms-list">${returnColValues(key).map((v) => `<label class="ms-row"><input class="check" type="checkbox" value="${e(v)}" ${sel.includes(v) ? 'checked' : ''}><span>${e(returnColLabel(key, v))}</span></label>`).join('') || '<div class="ms-empty">No values</div>'}</div>
                <div class="gl-applyrow"><button type="button" class="button primary" data-invapply="returns:${key}">Apply filter</button></div></div></th>`;
            }).join('')}</tr></thead>
            <tbody>${returns.map((r) => `<tr>${cols.map(([key]) => cells[key](r)).join('')}</tr>`).join('') || '<tr><td colspan="8">No returns match these filters.</td></tr>'}</tbody>
            <tfoot><tr><td colspan="4">Total shown</td><td class="numeric">${money(round2(returns.reduce((n, r) => n + r.net, 0)))}</td><td class="numeric">${money(round2(returns.reduce((n, r) => n + r.tax, 0)))}</td><td class="numeric">${money(round2(returns.reduce((n, r) => n + r.gross, 0)))}</td><td></td></tr></tfoot>
          </table></div>
          <div class="table-footer">A return reduces the original document's balance. Partial returns are allowed; the original stays posted and keeps its number.</div>
        </section>`;
    }
    const f = FILTERS.invoices;
    const all = invoiceRows(kind);
    const cols = [['date', 'Date'], ['id', 'Number'], ['party', isSales ? 'Customer' : 'Supplier'], ['project', 'Project'], ['due', 'Due'], ['net', 'Net', 'numeric'], ['tax', 'Tax', 'numeric'], ['gross', 'Gross', 'numeric'], ['returned', 'Returned', 'numeric'], ['paid', 'Paid', 'numeric'], ['balance', 'Balance', 'numeric'], ['state', 'State']];
    let rows = all.filter((r) => hit(f.q, r.id, r.party, r.date, r.due)
      && (!f.from || r.date >= f.from) && (!f.to || r.date <= f.to)
      && Object.entries(f.cf || {}).every(([k, v]) => !v || !v.length || v.includes(String(invoiceColValue(r, k)))));
    rows = rows.slice().sort((a, b) => { const x = invoiceColValue(a, f.sort.key), y = invoiceColValue(b, f.sort.key); const d = typeof x === 'number' && typeof y === 'number' ? x - y : String(x ?? '').localeCompare(String(y ?? ''), undefined, {numeric: true}); return f.sort.dir === 'desc' ? -d : d; });
    const cells = {
      date: (r) => `<td class="col col-date">${e(r.date)}</td>`,
      id: (r) => `<td class="col col-id mono">${e(r.id)}</td>`,
      party: (r) => `<td class="col col-party" title="${e(r.party)}">${e(r.party)}</td>`,
      project: (r) => `<td class="col col-project" title="${e(r.project || '')}">${e(r.project || '—')}</td>`,
      due: (r) => `<td class="col col-due">${e(r.due || '—')}</td>`,
      net: (r) => `<td class="col col-net numeric">${money(r.net)}</td>`,
      tax: (r) => `<td class="col col-tax numeric">${money(r.tax)}</td>`,
      gross: (r) => `<td class="col col-gross numeric">${money(r.gross)}</td>`,
      returned: (r) => `<td class="col col-returned numeric">${r.returned ? money(r.returned) : '—'}</td>`,
      paid: (r) => `<td class="col col-paid numeric">${r.paid ? money(r.paid) : '—'}</td>`,
      balance: (r) => `<td class="col col-balance numeric">${money(r.balance)}</td>`,
      state: (r) => `<td class="col col-state">${badge(invoiceStatus(r), invoiceStatus(r) === 'posted' ? 'good' : 'warn')}</td>`,
    };
    return tabs + `<form class="filterbar" data-filter="invoices" data-inv-filter="main">
        ${filterInput('invoices', f.q, 'Number, party, date')}
        <label>From<input type="date" name="from" value="${e(f.from || '')}"></label>
        <label>To<input type="date" name="to" value="${e(f.to || '')}"></label>
        <button class="button" type="button" data-inv-reset="${kind}:main">Reset</button>
      </form>
      <section class="panel">
        <div class="panel-head"><h2>${isSales ? 'Sales invoices' : 'Purchase bills'}</h2><div class="related"><span class="badge">${rows.length} of ${all.length} documents</span><button class="button" data-export-table>Export CSV</button></div></div>
        <div class="table-scroll" data-hscroll><table class="pay-register inv-register">
          <thead><tr>${cols.map(([key, label, cls]) => {
            const sel = (f.cf && f.cf[key]) || [];
            return `<th class="col col-${key} ${cls || ''}"><div class="th-flex"><button class="sortable" data-inv-sort="main:${key}" aria-sort="${f.sort.key === key ? (f.sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}">${label}<span class="sort-mark">${f.sort.key === key ? (f.sort.dir === 'asc' ? '▲' : '▼') : ''}</span></button><button type="button" class="col-filter-btn" data-invf="main:${key}" aria-label="Filter ${e(label)}" aria-expanded="false">${icon('chevron')}${sel.length ? `<b>${sel.length}</b>` : ''}</button></div>
              <div class="col-filter-panel" data-invp="main:${key}" hidden><div class="gl-sortrow"><span class="gl-sortlabel">Sort</span><button type="button" class="sort-toggle ${f.sort.key === key ? 'active' : ''}" data-invtoggle="main:${key}">${f.sort.key === key ? (f.sort.dir === 'asc' ? '↑' : '↓') : '↕'}</button></div>
              <div class="ms-searchrow"><input class="ms-search inv-filter-search" type="search" placeholder="Search values"></div>
              <div class="ms-head"><button type="button" class="text-button" data-invall="main:${key}">Select all</button><span class="ms-count">${invoiceColValues(kind, key).length}</span><button type="button" class="text-button" data-invnone="main:${key}">Clear</button></div>
              <div class="ms-list">${invoiceColValues(kind, key).map((v) => `<label class="ms-row"><input class="check" type="checkbox" value="${e(v)}" ${sel.includes(v) ? 'checked' : ''}><span>${e(invoiceColLabel(key, v))}</span></label>`).join('') || '<div class="ms-empty">No values</div>'}</div>
              <div class="gl-applyrow"><button type="button" class="button primary" data-invapply="main:${key}">Apply filter</button></div></div></th>`;
          }).join('')}<th></th></tr></thead>
          <tbody>${rows.map((r) => `<tr class="row-link" data-inv-row="${kind}:${e(r.id)}">${cols.map(([key]) => cells[key](r)).join('')}<td><details class="form-menu"><summary class="icon-button" aria-label="Actions">${icon('more')}</summary><div class="menu"><button type="button" data-inv-open="${kind}:${e(r.id)}">Open</button><button type="button" data-inv-return="${kind}:${e(r.id)}">Return</button></div></details></td></tr>`).join('') || '<tr><td colspan="13">No documents match these filters.</td></tr>'}</tbody>
          <tfoot><tr><td colspan="5">Total shown · ${rows.length} of ${all.length}</td><td class="numeric">${money(round2(rows.reduce((n, r) => n + r.net, 0)))}</td><td class="numeric">${money(round2(rows.reduce((n, r) => n + r.tax, 0)))}</td><td class="numeric">${money(round2(rows.reduce((n, r) => n + r.gross, 0)))}</td><td class="numeric">${money(round2(rows.reduce((n, r) => n + r.returned, 0)))}</td><td class="numeric">${money(round2(rows.reduce((n, r) => n + (r.paid || 0), 0)))}</td><td class="numeric">${money(round2(rows.reduce((n, r) => n + r.balance, 0)))}</td><td colspan="2"></td></tr></tfoot>
        </table></div>
        <div class="table-footer">Returned, Paid and Balance follow every return and receipt, partial or complete. Click a row to open the document; the menu also offers its return.</div>
      </section>`;
  }

  function defaultReturnLines(inv) {
    return (inv.lines || []).map((l) => ({item: l.item || '', account: l.account || '', qty: l.qty || '1', returnQty: l.qty || '1', price: String(round2(invLineNet(l) / (Number(l.qty) || 1))), tax: l.tax || '0', discountType: '', discountValue: '', added: false}));
  }
  function retLineCalc(l) {
    const net = round2((Number(l.returnQty) || 0) * (Number(l.price) || 0));
    const tax = round2(net * (Number(l.tax) || 0) / 100);
    return {net, tax, gross: round2(net + tax)};
  }
  function returnEditor(kind, invoiceId) {
    const isSales = kind === 'sales';
    const open = invoiceRows(kind).filter((r) => r.balance > 0);
    const draft = RET_DRAFT[kind];
    if (invoiceId && draft.invoice !== invoiceId) {
      const inv = open.find((r) => r.id === invoiceId);
      draft.invoice = invoiceId;
      draft.lines = inv ? defaultReturnLines(inv) : [];
    }
    const selected = open.find((r) => r.id === draft.invoice) || null;
    const lines = selected ? (draft.lines.length ? draft.lines : defaultReturnLines(selected)) : [];
    const totals = lines.reduce((n, l) => { const c = retLineCalc(l); return {net: round2(n.net + c.net), tax: round2(n.tax + c.tax), gross: round2(n.gross + c.gross)}; }, {net: 0, tax: 0, gross: 0});
    const rows = lines.map((l, i) => `<tr data-ret-line="${i}">
      <td><input data-ret-field="item" value="${e(l.item || '')}" placeholder="Item or service" aria-label="Return line ${i + 1} item"></td>
      <td><select data-ret-field="account" class="inline-input">${accounts().filter((a) => (isSales ? a.type === 'income' : a.type === 'expense')).map((a) => `<option value="${a.code}" ${a.code === l.account ? 'selected' : ''}>${a.code} · ${e(a.name)}</option>`).join('')}</select></td>
      <td class="numeric">${e(l.qty)}</td>
      <td><input class="numeric" data-ret-field="returnQty" value="${e(l.returnQty)}" inputmode="decimal" aria-label="Return quantity ${i + 1}"></td>
      <td class="numeric" data-price="${e(l.price)}">${l.added ? `<input class="numeric" data-ret-field="price" value="${e(l.price)}" inputmode="decimal" aria-label="Return unit price ${i + 1}">` : money(l.price)}</td>
      <td class="numeric" data-ret-net>${money(retLineCalc(l).net)}</td>
      <td><input class="numeric" data-ret-field="tax" value="${e(l.tax)}" inputmode="decimal" aria-label="Return tax rate ${i + 1}"></td>
      <td class="numeric" data-ret-tax>${money(retLineCalc(l).tax)}</td>
      <td class="numeric" data-ret-gross>${money(retLineCalc(l).gross)}</td>
      <td><button type="button" class="text-button" data-ret-remove="${i}">Remove</button></td>
    </tr>`).join('');
    return `<section class="panel">
      <div class="panel-head"><h2>New ${isSales ? 'sales return' : 'purchase return'}</h2><span class="badge">Against the original document</span></div>
      <form data-return-form="${kind}">
        <div class="panel-body form-grid">
          <label>Original document<select name="invoice" class="inline-input" required><option value="">Choose a document</option>${open.map((r) => `<option value="${e(r.id)}" ${selected && selected.id === r.id ? 'selected' : ''}>${e(r.id)} · ${e(r.party)} · ${e(r.date)}</option>`).join('')}</select></label>
          <label>Date<input name="date" type="date" value="${e(draft.date)}" required></label>
          <label>Reason<select name="reason" class="inline-input">${['Damaged goods', 'Wrong item', 'Over-delivery', 'Price correction', 'Other'].map((r) => `<option ${draft.reason === r ? 'selected' : ''}>${r}</option>`).join('')}</select></label>
          <label class="wide">Notes<input name="notes" maxlength="120" value="${e(draft.notes || '')}" placeholder="What is being returned"></label>
        </div>
        ${selected ? `<div class="panel-body"><div class="record-summary"><div><small>${isSales ? 'Customer' : 'Supplier'}</small>${e(selected.party)}</div><div><small>Invoice</small>${e(selected.id)}</div><div><small>Invoice total</small>${money(selected.gross)}</div><div><small>Already returned</small>${money(selected.returned)}</div></div>
          <p class="form-note">The complete document is loaded below. Change the returned quantity or amount per row. The refund or credit goes to the party's own control account (${isSales ? 'receivable' : 'payable'}); if the document was already paid, the party balance becomes a credit rather than a separate refund account.</p></div>
          <div class="panel-body"><div class="section-title">Lines returned</div>
            <div class="table-scroll"><table class="invoice-lines ret-items"><thead><tr><th>Item</th><th>Account</th><th class="numeric">Qty sold</th><th class="numeric">Return qty</th><th class="numeric">Unit price</th><th class="numeric">Net</th><th class="numeric">Tax %</th><th class="numeric">Tax</th><th class="numeric">Total</th><th></th></tr></thead>
            <tbody>${rows || '<tr><td colspan="10">This document has no lines.</td></tr>'}</tbody>
            <tfoot><tr><td colspan="5">Return total</td><td class="numeric" data-ret-total-net>${money(totals.net)}</td><td></td><td class="numeric" data-ret-total-tax>${money(totals.tax)}</td><td class="numeric" data-ret-total-gross><strong>${money(totals.gross)}</strong></td><td></td></tr></tfoot></table></div>
            <div class="related"><button type="button" class="button" data-ret-add>Add return row</button></div>
          </div>
          <div class="panel-body form-grid">${(() => {
            const retAuthority = (TAX_AUTHORITIES.find((a) => a.id === selected.taxAuthority) || defaultAuthorityFor(isSales ? 'output' : 'input')).name;
            const entry = isSales
              ? [{account: '4100', party: '', debit: totals.net, credit: 0}, {account: TAX_DEFAULTS.output, party: '', authority: retAuthority, debit: totals.tax, credit: 0}, {account: '1100', party: selected.party, debit: 0, credit: totals.gross}]
              : (() => {
                const trackedNet = round2(lines.filter((l) => (ITEMS.find((i) => i.code === l.item) || {}).tracked).reduce((n, l) => n + retLineCalc(l).net, 0));
                const otherNet = round2(totals.net - trackedNet);
                const rows = [{account: '2100', party: selected.party, debit: totals.gross, credit: 0}, {account: TAX_DEFAULTS.input, party: '', authority: retAuthority, debit: 0, credit: totals.tax}];
                if (otherNet) rows.push({account: '5200', party: '', debit: 0, credit: otherNet});
                if (trackedNet) rows.push({account: itemAccountFor('inventory'), party: '', debit: 0, credit: trackedNet});
                return rows;
              })();
            const tracked = lines.filter((l) => (ITEMS.find((i) => i.code === l.item) || {}).tracked);
            const invValue = round2(tracked.reduce((n, l) => n + retLineCalc(l).net, 0));
            return ledgerIllustration(isSales ? 'Illustrative sales return' : 'Illustrative purchase return', entry, isSales ? 'Sales returns and output tax reverse against the customer receivable. Inventory and cost of sales reverse separately below.' : 'The payable is debited; input tax is credited. Non-tracked lines credit purchase returns, tracked lines credit inventory at their net amount.');
          })()}${(() => {
            if (!isSales) return '';
            const tracked = lines.filter((l) => (ITEMS.find((i) => i.code === l.item) || {}).tracked);
            const invValue = round2(tracked.reduce((n, l) => n + retLineCalc(l).net, 0));
            return invValue ? ledgerIllustration('Illustrative inventory reversal', [{account: '1200', party: '', debit: invValue, credit: 0}, {account: '5100', party: '', debit: 0, credit: invValue}], 'Returned goods come back into inventory at their cost, reversing cost of sales.') : '';
          })()}</div>` : '<div class="panel-body"><p class="form-note">Choose the original document first; its complete line detail then appears here.</p></div>'}
        <div class="panel-body"><div class="related"><button class="button primary" ${selected ? '' : 'disabled'}>Save return</button><button type="button" class="button" data-form-cancel>Cancel</button></div>
          <p class="form-note">A return keeps the original document and reduces its balance. It is numbered in the return series. Inventory cost and refund posting are recorded as session data in this build; nothing posts to the ledger.</p></div>
      </form>
    </section>`;
  }
  function captureInvoice(kind, root) {
    const form = root.querySelector('[data-invoice-form]');
    const draft = INV_DRAFT[invKey(kind)];
    if (!form) return draft;
    const val = (tr, sel) => { const el = tr.querySelector(sel); return el ? el.value : ''; };
    const v = Object.fromEntries(new FormData(form));
    const lines = [...root.querySelectorAll('[data-inv-line]')].map((tr) => ({
      item: val(tr, '[data-inv-field="item"]'),
      account: val(tr, '[data-inv-field="account"]'),
      project: val(tr, '[data-inv-field="project"]'),
      qty: val(tr, '[data-inv-field="qty"]'),
      price: val(tr, '[data-inv-field="price"]'),
      discountType: val(tr, '[data-inv-field="discountType"]'),
      discountValue: val(tr, '[data-inv-field="discountValue"]'),
      tax: val(tr, '[data-inv-field="tax"]'),
    }));
    const withholding = [...root.querySelectorAll('[data-inv-wht]')].map((tr) => ({
      type: val(tr, '[data-wht-field="type"]'),
      rate: val(tr, '[data-wht-field="rate"]'),
      custom: val(tr, '[data-wht-field="custom"]'),
      basis: val(tr, '[data-wht-field="basis"]'),
    }));
    INV_PAY[kind] = v.recordPayment === 'yes';
    const tenderRows = [...root.querySelectorAll('[data-inv-tender]')].map((tr) => ({
      method: val(tr, '[data-inv-tender-field="method"]'),
      account: val(tr, '[data-inv-tender-field="account"]'),
      amount: val(tr, '[data-inv-tender-field="amount"]'),
    }));
    if (tenderRows.length) INV_TENDERS[kind] = tenderRows;
    const advances = [...root.querySelectorAll('[data-inv-adv-row]')].map((tr) => ({
      advance: (tr.querySelector('[data-inv-adv]') || {}).value || '',
      amount: (tr.querySelector('[data-inv-adv-amount]') || {}).value || '',
    }));
    Object.assign(draft, {party: v.party, date: v.date, due: v.due, terms: v.terms, reference: v.reference, location: v.location, description: v.description, lines, withholding, advances, taxAuthority: v.taxAuthority || draft.taxAuthority || '', stockMove: v.stockMove || 'no', warehouse: v.warehouse || 'HQ'});
    return draft;
  }
  function bindInvoices(kind, rerender, notify, navigate) {
    const tabOf = kind === 'sales' ? 'sales-invoices' : 'purchase-invoices';
    const goBack = () => navigate({module: 'accounting', tab: tabOf});
    document.querySelectorAll('[data-inv-tab]').forEach((b) => b.addEventListener('click', () => {
      const [k, t] = b.dataset.invTab.split(':');
      if (k !== kind) return;
      INV_TAB[kind] = t;
      rerender();
    }));
    const invFilter = (scope) => scope === 'returns' ? FILTERS.invoiceReturns : FILTERS.invoices;
    document.querySelector('[data-inv-reset]')?.addEventListener('click', () => {
      const scope = document.querySelector('[data-inv-reset]').dataset.invReset.split(':')[1];
      if (scope === 'returns') Object.assign(FILTERS.invoiceReturns, {q: '', from: '', to: '', cf: {}});
      else Object.assign(FILTERS.invoices, {q: '', from: '', to: '', party: '', cf: {}});
      rerender();
    });
    document.querySelectorAll('[data-inv-sort]').forEach((b) => b.addEventListener('click', () => {
      const [scope, key] = b.dataset.invSort.split(':');
      const f = invFilter(scope);
      f.sort = {key, dir: f.sort.key === key && f.sort.dir === 'asc' ? 'desc' : 'asc'};
      rerender();
    }));
    let invOpen = '';
    const closeInvMenus = (except) => {
      document.querySelectorAll('[data-invp]').forEach((p) => { if (p !== except) p.hidden = true; });
      document.querySelectorAll('[data-invf]').forEach((b) => b.setAttribute('aria-expanded', 'false'));
    };
    const openInvMenu = (scope, key) => {
      const btn = document.querySelector(`[data-invf="${scope}:${key}"]`);
      const panel = document.querySelector(`[data-invp="${scope}:${key}"]`);
      if (!btn || !panel) return;
      closeInvMenus(panel);
      panel.hidden = false;
      btn.setAttribute('aria-expanded', 'true');
      const r = btn.getBoundingClientRect();
      panel.classList.add('col-filter-panel--fixed');
      const left = r.left > window.innerWidth / 2 ? r.right - 270 : r.left;
      panel.style.left = Math.round(Math.min(Math.max(8, left), window.innerWidth - 278)) + 'px';
      const top = Math.round(r.bottom + 4);
      panel.style.top = top + 'px';
      panel.style.maxHeight = Math.max(220, Math.min(380, window.innerHeight - top - 12)) + 'px';
      const search = panel.querySelector('.inv-filter-search');
      if (search) { search.value = ''; search.focus(); }
      invOpen = scope + ':' + key;
    };
    document.querySelectorAll('[data-invf]').forEach((b) => b.addEventListener('click', (ev) => {
      ev.stopPropagation();
      const [scope, key] = b.dataset.invf.split(':');
      if (invOpen === b.dataset.invf) { closeInvMenus(); invOpen = ''; return; }
      openInvMenu(scope, key);
    }));
    document.addEventListener('click', (ev) => {
      if (ev.target.closest('.col-filter-panel') || ev.target.closest('[data-invf]')) return;
      closeInvMenus(); invOpen = '';
    });
    document.querySelectorAll('[data-invp]').forEach((panel) => {
      panel.addEventListener('click', (ev) => ev.stopPropagation());
      panel.querySelector('.inv-filter-search')?.addEventListener('input', (ev) => {
        const q = ev.target.value.toLowerCase();
        panel.querySelectorAll('.ms-row').forEach((row) => { row.hidden = q && !row.textContent.toLowerCase().includes(q); });
      });
      panel.querySelector('[data-invall]')?.addEventListener('click', () => { panel.querySelectorAll('input[type=checkbox]').forEach((b) => { if (!b.closest('.ms-row').hidden) b.checked = true; }); });
      panel.querySelector('[data-invnone]')?.addEventListener('click', () => { panel.querySelectorAll('input[type=checkbox]').forEach((b) => { b.checked = false; }); });
    });
    document.querySelectorAll('[data-invapply]').forEach((b) => b.addEventListener('click', () => {
      const [scope, key] = b.dataset.invapply.split(':');
      const panel = document.querySelector(`[data-invp="${scope}:${key}"]`);
      const f = invFilter(scope);
      f.cf = {...(f.cf || {}), [key]: [...panel.querySelectorAll('input[type=checkbox]:checked')].map((x) => x.value)};
      closeInvMenus(); invOpen = '';
      rerender();
    }));
    document.querySelectorAll('[data-invtoggle]').forEach((b) => b.addEventListener('click', () => {
      const [scope, key] = b.dataset.invtoggle.split(':');
      const f = invFilter(scope);
      f.sort = {key, dir: f.sort.key === key && f.sort.dir === 'asc' ? 'desc' : 'asc'};
      closeInvMenus(); invOpen = '';
      rerender();
    }));
    document.querySelectorAll('[data-inv-row]').forEach((tr) => tr.addEventListener('click', (ev) => {
      if (ev.target.closest('details, button, select, input, a')) return;
      const [k, id] = tr.dataset.invRow.split(':');
      if (k !== kind) return;
      navigate({module: 'accounting', tab: tabOf, mode: 'editor', form: 'invoice', code: id});
    }));
    document.querySelectorAll('[data-inv-open]').forEach((b) => b.addEventListener('click', () => {
      const [k, id] = b.dataset.invOpen.split(':');
      if (k !== kind) return;
      navigate({module: 'accounting', tab: tabOf, mode: 'editor', code: id});
    }));
    document.querySelectorAll('[data-inv-return]').forEach((b) => b.addEventListener('click', () => {
      const [k, id] = b.dataset.invReturn.split(':');
      if (k !== kind) return;
      navigate({module: 'accounting', tab: tabOf, mode: 'editor', form: 'return', code: id});
    }));
    document.querySelectorAll('[data-new-return]').forEach((b) => b.addEventListener('click', () => {
      if (b.dataset.newReturn !== kind) return;
      navigate({module: 'accounting', tab: tabOf, mode: 'editor', form: 'return', code: ''});
    }));
    document.querySelectorAll('[data-inv-open-return]').forEach((b) => b.addEventListener('click', () => {
      const [k, id] = b.dataset.invOpenReturn.split(':');
      if (k !== kind) return;
      navigate({module: 'accounting', tab: tabOf, mode: 'editor', form: 'return', code: id});
    }));

    const root = document.querySelector(`[data-invoice-form="${kind}"]`)?.closest('section');
    if (root) {
      const form = root.querySelector(`[data-invoice-form="${kind}"]`);
      document.querySelector('[data-form-cancel]')?.addEventListener('click', goBack);
      form?.addEventListener('submit', (ev) => ev.preventDefault());
      const editingCode = form?.querySelector('[name="editingCode"]')?.value || root.querySelector('.panel-head h2')?.textContent.trim() || '';
      const sourceNow = editingCode ? invoiceRows(kind).find((r) => r.id === editingCode) : null;
      root.querySelector('[data-inv-menu-return]')?.addEventListener('click', () => { if (sourceNow) navigate({module: 'accounting', tab: tabOf, mode: 'editor', form: 'return', code: sourceNow.id}); });
      root.querySelector('[data-inv-menu-duplicate]')?.addEventListener('click', () => { if (!sourceNow) return; const copy = {...sourceNow, id: (kind === 'sales' ? 'SI-2026-' : 'PI-2026-') + String(300 + INV_SEQ++), date: '2026-11-30', due: '2026-12-30', session: true, state: 'draft'}; INVOICES.push({...copy, kind, net: sourceNow.net, tax: sourceNow.tax, gross: sourceNow.gross, netDue: sourceNow.netDue ?? sourceNow.gross}); notify('Document duplicated into a new draft.'); navigate({module: 'accounting', tab: tabOf, mode: 'editor', form: 'invoice', code: copy.id}); });
      root.querySelector('[data-inv-menu-cancel]')?.addEventListener('click', () => { const target = INVOICES.find((x) => x.id === editingCode); if (target) { target.state = 'cancelled'; notify('Document cancelled; it stays in the register.'); } goBack(); });
      root.querySelector('[data-inv-menu-delete]')?.addEventListener('click', () => { const i = INVOICES.findIndex((x) => x.id === editingCode); if (i >= 0) { INVOICES.splice(i, 1); notify('Document deleted from the register.'); } goBack(); });
      root.querySelector('[data-inv-menu-payment]')?.addEventListener('click', () => {
        if (!sourceNow) return;
        PAY_FORM = {direction: kind === 'sales' ? 'receive' : 'pay', party: sourceNow.party, date: sourceNow.date || '2026-11-30', notes: `Settlement of ${sourceNow.id}`, lines: [{doc: sourceNow.id, method: 'bank', account: '', amount: (sourceNow.balance ?? sourceNow.netDue ?? sourceNow.gross).toFixed(2)}]};
        notify('Payment form prepared from ' + sourceNow.id + '. Choose the account and save.');
        navigate({module: 'accounting', tab: 'payments', mode: 'editor'});
      });
      root.querySelector('[data-inv-menu-stock]')?.addEventListener('click', () => {
        if (!sourceNow) return;
        navigate({module: 'accounting', tab: tabOf, mode: 'editor', form: 'stock', code: sourceNow.id});
      });
      root.querySelector('[data-inv-menu-print]')?.addEventListener('click', () => window.print());
      const recalc = () => {
        const d = captureInvoice(kind, root);
        const t = invoiceTotals(kind, d.lines);
        const wht = invoiceWhtTotal(d.withholding, t);
        const due = invoiceNetDue(t, d.withholding);
        root.querySelectorAll('[data-inv-line]').forEach((tr, i) => {
          const net = tr.querySelector('[data-line-net]'); if (net) net.textContent = money(invLineNet(d.lines[i]));
          const gross = tr.querySelector('[data-line-gross]'); if (gross) gross.textContent = money(invLineGross(d.lines[i]));
        });
        const put = (sel, value) => root.querySelectorAll(sel).forEach((el) => { el.textContent = value; });
        put('[data-inv-base]', money(t.base));
        put('[data-inv-base2]', money(t.base));
        put('[data-inv-discount]', (t.discount ? '−' : '') + money(t.discount));
        put('[data-inv-discount2]', (t.discount ? '−' : '') + money(t.discount));
        put('[data-inv-net]', money(t.net));
        put('[data-inv-net2]', money(t.net));
        put('[data-inv-tax]', money(t.tax));
        put('[data-inv-gross]', money(t.gross));
        put('[data-inv-gross2]', money(t.gross));
        put('[data-inv-wht-total]', money(wht));
        const tenders = [...root.querySelectorAll('[data-inv-tender]')].map((tr) => Number(tr.querySelector('[data-inv-tender-field="amount"]').value) || 0);
        const paid = round2(tenders.reduce((n, x) => n + x, 0));
        const advTotal = round2((d.advances || []).reduce((n, a) => n + (Number(a.amount) || 0), 0));
        put('[data-inv-due]', money(due));
        put('[data-inv-adv-total]', money(advTotal));
        put('[data-inv-balance]', money(round2(Math.max(due - Math.min(paid, due) - advTotal, 0))));
        put('[data-inv-diff]', money(round2(Math.max(due - Math.min(paid, due) - advTotal, 0))));
        put('[data-inv-paid]', money(paid));
        root.querySelectorAll('[data-inv-badge]').forEach((el) => { el.textContent = (kind === 'sales' ? 'Receivable' : 'Payable') + ' ' + money(due); });
        root.querySelectorAll('[data-inv-wht]').forEach((tr, i) => { const cell = tr.querySelector('[data-wht-amount]'); if (cell) cell.textContent = money(whtAmount(d.withholding[i], t)); });
      };
      form?.addEventListener('input', (ev) => {
        if (!ev.target.matches('[data-inv-field="qty"], [data-inv-field="price"], [data-inv-field="discountValue"], [data-inv-field="tax"], [data-wht-field="custom"], [data-inv-tender-field="amount"], [data-inv-adv], [data-inv-adv-amount]')) return;
        captureInvoice(kind, root);
        recalc();
      });
      form?.addEventListener('change', (ev) => {
        const isSelect = ev.target.matches('select');
        const numeric = ev.target.matches('[data-inv-field="qty"], [data-inv-field="price"], [data-inv-field="discountValue"], [data-inv-field="tax"], [data-wht-field="custom"], [data-inv-tender-field="amount"], [data-inv-adv], [data-inv-adv-amount]');
        if (!isSelect && !numeric) return;
        const before = captureInvoice(kind, root);
        if (isSelect && ev.target.matches('[data-inv-field="item"]')) {
          const tr = ev.target.closest('[data-inv-line]');
          const i = Number(tr.dataset.invLine);
          const item = ITEMS.find((x) => x.code === before.lines[i].item);
          if (item) {
            before.lines[i].account = kind === 'sales' ? (itemAccountFor('income', item) || item.income) : (item.tracked ? (itemAccountFor('clearing', item) || '2400') : (itemAccountFor('expense', item) || item.expense));
            const rate = invTaxRateFor(item.code, kind);
            if (rate !== '') before.lines[i].tax = rate;
            const rule = defaultWhtRule(item.code, kind);
            if (rule) {
              if (!before.withholding.length) before.withholding.push({type: kind === 'sales' ? 'advance_income' : 'withholding_income', rate: '', basis: 'net', custom: ''});
              before.withholding.forEach((w) => {
                if (w.rate) return;
                w.rate = String(rule.rate);
                w.basis = 'net';
                w.type = rule.kind === 'advance_income' ? 'advance_income' : 'withholding_income';
              });
            }
          }
        }
        if (isSelect && ev.target.matches('[data-inv-tender-field="method"]')) {
          const tr = ev.target.closest('[data-inv-tender]');
          const i = Number(tr.dataset.invTender);
          INV_TENDERS[kind][i].account = '';
        }
        rerender();
      });
      root.querySelector('[data-inv-add-line]')?.addEventListener('click', () => {
        const d = captureInvoice(kind, root);
        d.lines.push({item: '', account: kind === 'sales' ? '4000' : '5000', project: '', qty: '1', price: '0.00', discountType: '', discountValue: '', tax: '10'});
        rerender();
      });
      root.querySelectorAll('[data-inv-line-remove]').forEach((b) => b.addEventListener('click', () => {
        const d = captureInvoice(kind, root);
        d.lines.splice(Number(b.dataset.invLineRemove), 1);
        if (!d.lines.length) d.lines.push({item: '', account: kind === 'sales' ? '4000' : '5000', project: '', qty: '1', price: '0.00', discountType: '', discountValue: '', tax: '10'});
        rerender();
      }));
      root.querySelector('[data-inv-add-wht]')?.addEventListener('click', () => {
        const d = captureInvoice(kind, root);
        d.withholding.push({type: kind === 'sales' ? 'advance_income' : 'withholding_income', rate: '', basis: 'net', custom: ''});
        rerender();
      });
      root.querySelectorAll('[data-wht-remove]').forEach((b) => b.addEventListener('click', () => {
        const d = captureInvoice(kind, root);
        d.withholding.splice(Number(b.dataset.whtRemove), 1);
        rerender();
      }));
      root.querySelector('[data-inv-add-tender]')?.addEventListener('click', () => {
        captureInvoice(kind, root);
        INV_TENDERS[kind].push({method: 'bank', account: '', amount: ''});
        rerender();
      });
      root.querySelectorAll('[data-inv-tender-remove]').forEach((b) => b.addEventListener('click', () => {
        captureInvoice(kind, root);
        INV_TENDERS[kind].splice(Number(b.dataset.invTenderRemove), 1);
        if (!INV_TENDERS[kind].length) INV_TENDERS[kind].push({method: 'bank', account: '', amount: ''});
        rerender();
      }));
      root.querySelector('[data-inv-adv-add]')?.addEventListener('click', () => {
        const d = captureInvoice(kind, root);
        d.advances = d.advances || [];
        d.advances.push({advance: '', amount: ''});
        rerender();
      });
      root.querySelectorAll('[data-inv-adv-remove]').forEach((b) => b.addEventListener('click', () => {
        const d = captureInvoice(kind, root);
        (d.advances || []).splice(Number(b.dataset.invAdvRemove), 1);
        rerender();
      }));
      const zone = root.querySelector('[data-evidence]');
      const fileInput = zone?.querySelector('[data-evidence-input]');
      zone?.addEventListener('click', (ev) => {
        if (ev.target.closest('label, button, input')) return;
        fileInput?.click();
      });
      fileInput?.addEventListener('change', (ev) => {
        INV_FILES[kind].push(...[...ev.target.files].map((f) => ({name: f.name, size: f.size})));
        ev.target.value = '';
        rerender();
      });
      form?.addEventListener('paste', (ev) => {
        const files = ev.clipboardData ? [...ev.clipboardData.files] : [];
        if (!files.length) return;
        ev.preventDefault();
        INV_FILES[kind].push(...files.map((f) => ({name: f.name, size: f.size})));
        rerender();
      });
      zone?.addEventListener('dragover', (ev) => ev.preventDefault());
      zone?.addEventListener('drop', (ev) => {
        ev.preventDefault();
        INV_FILES[kind].push(...[...ev.dataTransfer.files].map((f) => ({name: f.name, size: f.size})));
        rerender();
      });
      root.querySelectorAll('[data-evidence-remove]').forEach((b) => b.addEventListener('click', () => {
        INV_FILES[kind].splice(Number(b.dataset.evidenceRemove), 1);
        rerender();
      }));
      root.querySelector('[data-inv-save]')?.addEventListener('click', () => {
        const draft = captureInvoice(kind, root);
        if (!draft.party) { notify('Choose a party first.'); return; }
        const totals = invoiceTotals(kind, draft.lines);
        if (totals.net <= 0) { notify('Enter at least one item with a quantity and a price.'); return; }
        const wht = invoiceWhtTotal(draft.withholding, totals);
        const netDue = invoiceNetDue(totals, draft.withholding);
        const editing = form.querySelector('[name="editingCode"]')?.value || '';
        let invId = editing;
        if (editing) {
          const target = INVOICES.find((x) => x.id === editing);
          if (target) Object.assign(target, {party: draft.party, date: draft.date, due: draft.due, terms: draft.terms, reference: draft.reference, location: draft.location, description: draft.description, lines: draft.lines, withholding: draft.withholding, advances: draft.advances || [], taxAuthority: draft.taxAuthority || '', discount: totals.discount, net: totals.net, tax: totals.tax, gross: totals.gross, netDue, session: true});
          notify('Document updated for this session.');
        } else {
          invId = (kind === 'sales' ? 'SI-2026-' : 'PI-2026-') + String(300 + INV_SEQ++);
          INVOICES.push({id: invId, kind, party: draft.party, date: draft.date, due: draft.due, terms: draft.terms, reference: draft.reference, location: draft.location, description: draft.description, lines: draft.lines, withholding: draft.withholding, advances: draft.advances || [], taxAuthority: draft.taxAuthority || '', discount: totals.discount, net: totals.net, tax: totals.tax, gross: totals.gross, netDue, files: INV_FILES[kind].slice(), session: true});
          notify(`Saved for this session: ${draft.party} · ${kind === 'sales' ? 'net receivable' : 'net payable'} ${netDue.toFixed(2)}.`);
        }
        if (INV_PAY[kind]) {
          const tenders = INV_TENDERS[kind].filter((t) => Number(t.amount) > 0);
          const total = round2(tenders.reduce((n, t) => n + Number(t.amount), 0));
          if (tenders.length && total > 0) {
            const applied = Math.min(total, netDue);
            const key = kind === 'sales' ? 'receipt' : 'payment';
            const number = nextDocNumber(key, draft.date);
            NUMBERING[key].next = (NUMBERING[key].next || 1) + 1;
            let left = applied;
            const allocations = tenders.map((t) => {
              const amount = round2(Math.min(Number(t.amount) || 0, left));
              left = round2(left - amount);
              return {id: invId, amount, method: t.method, account: t.account || ''};
            }).filter((a) => a.amount > 0);
            PAYMENTS.push({id: number, date: draft.date, party: draft.party, account: tenders.length > 1 ? `${tenders.length} accounts` : (tenders[0].account || ''), amount: total, direction: kind === 'sales' ? 'receive' : 'pay', method: tenders.length > 1 ? `${tenders.length} rows` : tenders[0].method, reference: '', notes: '', against: invId, allocations, advance: round2(total - applied), tenders, session: true});
          }
          INV_PAY[kind] = false;
          INV_TENDERS[kind] = [{method: 'bank', account: '', amount: ''}];
        }
        const advLines = (draft.advances || []).filter((a) => a.advance && Number(a.amount) > 0);
        if (advLines.length) {
          if (editing) {
            ADVANCE_APPLIED.filter((x) => x.docId === editing).forEach((x) => { const a = ADVANCES.find((y) => y.id === x.advanceId); if (a) a.applied = round2(a.applied - x.amount); });
            for (let i = ADVANCE_APPLIED.length - 1; i >= 0; i--) if (ADVANCE_APPLIED[i].docId === editing) ADVANCE_APPLIED.splice(i, 1);
          }
          const paidByCash = Math.min(round2(INV_TENDERS[kind].reduce((n, t) => n + (Number(t.amount) || 0), 0)), netDue);
          const advTotal = round2(advLines.reduce((n, a) => n + Number(a.amount), 0));
          if (paidByCash + advTotal > netDue + 0.005) { notify('Payments and advances together are more than the net due.'); return; }
          for (const row of advLines) {
            const advance = ADVANCES.find((a) => a.id === row.advance);
            if (!advance) { notify('Choose a valid advance.'); return; }
            if (Number(row.amount) > advanceOpen(advance) + 0.005) { notify(`The amount is more than ${advance.id} has available.`); return; }
            advance.applied = round2(advance.applied + Number(row.amount));
            ADVANCE_APPLIED.push({id: nextAdvanceAppId(), advanceId: advance.id, docId: invId, party: draft.party, amount: round2(Number(row.amount)), date: draft.date});
          }
        }
        if (draft.stockMove === 'yes') {
          const tracked = (draft.lines || []).filter((l) => (ITEMS.find((i) => i.code === l.item) || {}).tracked);
          if (tracked.length) STOCK_MOVES.push({id: 'STK-2026-' + String(100 + STOCK_MOVES.length), kind, date: draft.date, party: draft.party, warehouse: draft.warehouse || 'HQ', invoice: invId, lines: tracked.map((l) => ({item: l.item, qty: l.qty, cost: l.price}))});
        }
        INV_FILES[kind] = [];
        INV_DRAFT[invKey(kind)] = {...INV_DRAFT[invKey(kind)], party: '', description: kind === 'sales' ? 'Service invoiced' : 'Supplier bill',
          lines: [{item: '', account: kind === 'sales' ? '4000' : '5000', project: '', qty: '1', price: '0.00', discountType: '', discountValue: '', tax: '10'}],
          withholding: [{type: kind === 'sales' ? 'advance_income' : 'withholding_income', rate: '', basis: 'net', custom: ''}], advances: [], taxAuthority: '', stockMove: 'no', warehouse: 'HQ'};
        goBack();
      });
    }

    const stockForm = document.querySelector('[data-stock-form]');
    stockForm?.querySelector('[data-stock-cancel]')?.addEventListener('click', goBack);
    stockForm?.addEventListener('submit', (ev) => {
      ev.preventDefault();
      if (!stockForm.reportValidity()) return;
      const v = Object.fromEntries(new FormData(stockForm));
      const inv = invoiceRows(kind).find((r) => r.id === v.invoice);
      if (!inv) { notify('The document is not in the register.'); return; }
      const tracked = (inv.lines || []).filter((l) => (ITEMS.find((i) => i.code === l.item) || {}).tracked);
      if (!tracked.length) { notify('No tracked items on this document.'); return; }
      STOCK_MOVES.push({id: 'STK-2026-' + String(100 + STOCK_MOVES.length), kind, date: v.date, party: inv.party, warehouse: v.warehouse, invoice: inv.id, direction: kind === 'sales' ? 'issue' : 'receipt', lines: tracked.map((l) => ({item: l.item, qty: l.qty, value: invLineNet(l)}))});
      notify(`${kind === 'sales' ? 'Goods issue' : 'Goods receipt'} recorded for ${inv.id}; the inventory ledger will apply the exact quantities.`);
      goBack();
    });
    if (!document.querySelector(`[data-invoice-form="${kind}"]`)) {
      const sec = document.querySelector('.form-menu')?.closest('section');
      const codeNow = sec?.querySelector('.panel-head h2')?.textContent.trim() || '';
      const src = codeNow ? invoiceRows(kind).find((r) => r.id === codeNow) : null;
      sec?.querySelector('[data-inv-menu-return]')?.addEventListener('click', () => { if (src) navigate({module: 'accounting', tab: tabOf, mode: 'editor', form: 'return', code: src.id}); });
      sec?.querySelector('[data-inv-menu-payment]')?.addEventListener('click', () => {
        if (!src) return;
        PAY_FORM = {direction: kind === 'sales' ? 'receive' : 'pay', party: src.party, date: src.date || '2026-11-30', notes: `Settlement of ${src.id}`, lines: [{doc: src.id, method: 'bank', account: '', amount: (src.balance ?? src.netDue ?? src.gross).toFixed(2)}]};
        notify('Payment form prepared from ' + src.id + '. Choose the account and save.');
        navigate({module: 'accounting', tab: 'payments', mode: 'editor'});
      });
      sec?.querySelector('[data-inv-menu-stock]')?.addEventListener('click', () => { if (src) navigate({module: 'accounting', tab: tabOf, mode: 'editor', form: 'stock', code: src.id}); });
      sec?.querySelector('[data-inv-menu-duplicate]')?.addEventListener('click', () => {
        if (!src) return;
        const id = (kind === 'sales' ? 'SI-2026-' : 'PI-2026-') + String(300 + INV_SEQ++);
        INVOICES.push({...src, id, kind, date: '2026-11-30', due: '2026-12-30', state: 'draft', session: true, netDue: src.netDue ?? src.gross, lines: src.lines || [], withholding: src.withholding || []});
        navigate({module: 'accounting', tab: tabOf, mode: 'editor', form: 'invoice', code: id});
      });
      sec?.querySelector('[data-inv-menu-print]')?.addEventListener('click', () => window.print());
    }
    const retForm = document.querySelector(`[data-return-form="${kind}"]`);
    document.querySelector(`[data-return-form="${kind}"] [data-form-cancel]`)?.addEventListener('click', goBack);
    const captureRet = () => {
      if (!retForm) return {v: {}, lines: []};
      const v = Object.fromEntries(new FormData(retForm));
      const lines = [...retForm.querySelectorAll('[data-ret-line]')].map((tr) => ({
        item: (tr.querySelector('[data-ret-field="item"]') || {}).value || '',
        account: (tr.querySelector('[data-ret-field="account"]') || {}).value || '',
        qty: (tr.querySelector('[data-ret-field="qty"]') || {}).value || '1',
        returnQty: (tr.querySelector('[data-ret-field="returnQty"]') || {}).value || '',
        price: (tr.querySelector('[data-ret-field="price"]') || {}).value || (tr.querySelector('[data-price]') || {}).dataset?.price || '0',
        tax: (tr.querySelector('[data-ret-field="tax"]') || {}).value || '0',
      }));
      RET_DRAFT[kind] = {...RET_DRAFT[kind], invoice: v.invoice || '', date: v.date, reason: v.reason, notes: v.notes || '', lines};
      return {v, lines};
    };
    retForm?.querySelector('[name="invoice"]')?.addEventListener('change', (ev) => {
      const inv = invoiceRows(kind).find((r) => r.id === ev.target.value);
      RET_DRAFT[kind] = {...RET_DRAFT[kind], invoice: ev.target.value, lines: inv ? defaultReturnLines(inv) : []};
      rerender();
    });
    retForm?.querySelector('[data-ret-add]')?.addEventListener('click', () => {
      captureRet();
      RET_DRAFT[kind].lines.push({item: '', account: kind === 'sales' ? '4000' : '5000', qty: '1', returnQty: '1', price: '0.00', tax: '0', added: true});
      rerender();
    });
    retForm?.querySelectorAll('[data-ret-remove]').forEach((b) => b.addEventListener('click', () => {
      captureRet();
      RET_DRAFT[kind].lines.splice(Number(b.dataset.retRemove), 1);
      rerender();
    }));
    retForm?.addEventListener('input', (ev) => {
      if (!ev.target.matches('[data-ret-field="returnQty"], [data-ret-field="price"], [data-ret-field="tax"]')) return;
      const tr = ev.target.closest('[data-ret-line]');
      const l = captureRet().lines[Number(tr.dataset.retLine)];
      const c = retLineCalc(l);
      tr.querySelector('[data-ret-net]').textContent = money(c.net);
      tr.querySelector('[data-ret-tax]').textContent = money(c.tax);
      tr.querySelector('[data-ret-gross]').textContent = money(c.gross);
      const all = captureRet().lines;
      const totals = all.reduce((n, x) => { const y = retLineCalc(x); return {net: round2(n.net + y.net), tax: round2(n.tax + y.tax), gross: round2(n.gross + y.gross)}; }, {net: 0, tax: 0, gross: 0});
      retForm.querySelector('[data-ret-total-net]').textContent = money(totals.net);
      retForm.querySelector('[data-ret-total-tax]').textContent = money(totals.tax);
      retForm.querySelector('[data-ret-total-gross]').innerHTML = `<strong>${money(totals.gross)}</strong>`;
    });
    retForm?.addEventListener('submit', (ev) => {
      ev.preventDefault();
      if (!retForm.reportValidity()) return;
      const {v, lines} = captureRet();
      const inv = invoiceRows(kind).find((r) => r.id === v.invoice);
      if (!inv) { notify('Choose a document to return against.'); return; }
      const totals = lines.reduce((n, l) => { const c = retLineCalc(l); return {net: round2(n.net + c.net), tax: round2(n.tax + c.tax), gross: round2(n.gross + c.gross)}; }, {net: 0, tax: 0, gross: 0});
      if (totals.gross <= 0) { notify('Enter at least one returned quantity or amount.'); return; }
      if (totals.gross > inv.gross - inv.returned + 0.005) { notify('The return is more than the document still carries.'); return; }
      RETURNS[kind].push({id: (kind === 'sales' ? 'SR-2026-' : 'PR-2026-') + String(RET_SEQ[kind]++), invoiceId: inv.id, date: v.date, party: inv.party, net: totals.net, tax: totals.tax, gross: totals.gross, reason: v.reason, notes: v.notes || '', lines, session: true, taxAuthority: inv.taxAuthority || TAX_DEFAULT_AUTHORITIES[kind === 'sales' ? 'output' : 'input']});
      const trackedBack = (lines || []).filter((l) => (ITEMS.find((i) => i.code === l.item) || {}).tracked && Number(l.returnQty) > 0);
      if (trackedBack.length) STOCK_MOVES.push({id: 'STK-2026-' + String(100 + STOCK_MOVES.length), kind, date: v.date, party: inv.party, warehouse: inv.location || 'HQ', invoice: inv.id, direction: kind === 'sales' ? 'receipt' : 'issue', lines: trackedBack.map((l) => ({item: l.item, qty: l.returnQty, value: retLineCalc(l).net}))});
      INV_TAB[kind] = 'returns';
      notify(`Return saved: ${inv.id} · ${totals.gross.toFixed(2)}. Its balance is now ${round2(inv.balance - totals.gross).toFixed(2)}.`);
      goBack();
    });
  }

  /* ------------------------------------------------------------- items */
  function itemAccountFor(event, item) {
    const rules = ITEM_ACCOUNT_RULES.filter((r) => r.event === event && (!r.group || r.group === (item ? item.group : '')));
    const specific = rules.find((r) => r.group);
    return (specific || rules[0] || {}).account || '';
  }
  function itemDefaultsView() {
    const events = [['inventory', 'Inventory asset'], ['cogs', 'Cost of sales'], ['income', 'Sales income'], ['expense', 'Purchase expense'], ['clearing', 'Goods received clearing']];
    const groups = [...new Set([...ITEM_GROUPS.map((g) => g.name), ...ITEMS.map((i) => i.group).filter(Boolean)])];
    return `<section class="panel">
      <div class="panel-head"><h2>Default item accounts</h2><span class="badge">Rules by event and group</span></div>
      <div class="table-scroll"><table><thead><tr><th>Default account for</th><th>Item group</th><th>Account</th><th></th></tr></thead>
        <tbody>${ITEM_ACCOUNT_RULES.map((r, i) => `<tr data-item-rule="${i}"><td><select data-rule-field="event" class="inline-input">${events.map(([k, l]) => `<option value="${k}" ${r.event === k ? 'selected' : ''}>${l}</option>`).join('')}</select></td>
          <td><select data-rule-field="group" class="inline-input"><option value="">All items</option>${groups.map((g) => `<option value="${e(g)}" ${r.group === g ? 'selected' : ''}>${e(g)}</option>`).join('')}</select></td>
          <td><select data-rule-field="account" class="inline-input">${accounts().map((a) => `<option value="${a.code}" ${a.code === r.account ? 'selected' : ''}>${a.code} · ${e(a.name)}</option>`).join('')}</select></td>
          <td><button type="button" class="text-button" data-rule-remove="${i}">Remove</button></td></tr>`).join('')}</tbody></table></div>
      <div class="related"><button type="button" class="button" data-rule-add>Add rule</button><button type="button" class="button primary" data-rule-save>Save defaults</button></div>
      <div class="table-footer">A group rule wins over the all-items rule. These accounts fill item lines and the inventory and cost-of-sales entries; an item form can still name its own income or expense head. Stored for this session.</div>
    </section>`;
  }
  function bindItemDefaults(rerender, notify) {
    document.querySelector('[data-rule-add]')?.addEventListener('click', () => { ITEM_ACCOUNT_RULES.push({event: 'inventory', group: '', account: '1200'}); rerender(); });
    document.querySelectorAll('[data-rule-remove]').forEach((b) => b.addEventListener('click', () => { ITEM_ACCOUNT_RULES.splice(Number(b.dataset.ruleRemove), 1); rerender(); }));
    document.querySelector('[data-rule-save]')?.addEventListener('click', () => {
      document.querySelectorAll('[data-item-rule]').forEach((tr, i) => { ITEM_ACCOUNT_RULES[i] = {event: tr.querySelector('[data-rule-field="event"]').value, group: tr.querySelector('[data-rule-field="group"]').value, account: tr.querySelector('[data-rule-field="account"]').value}; });
      notify('Default item accounts saved for this session.');
      rerender();
    });
  }
  function itemsView() {
    const f = FILTERS.items;
    const rows = ITEMS.filter((i) => hit(f.q, i.code, i.name, i.group, i.unit, i.description)
      && (!f.group || i.group === f.group) && (!f.stock || (f.stock === 'tracked' ? i.tracked : !i.tracked)) && (!f.status || (i.status || 'Active') === f.status));
    const accountName = (code) => (accounts().find((a) => a.code === code) || {}).name || code;
    const ruleName = (code) => (TAX_RULES.find((r) => r.code === code) || {}).name || 'No tax';
    const tracked = ITEMS.filter((i) => i.tracked).length;
    const editingRow = editRecord('item', ITEMS) || {};
    const v = (key, fallback = '') => (editingRow[key] !== undefined ? editingRow[key] : fallback);
    return `<form class="filterbar" data-filter="items">
        ${filterInput('items', f.q, 'Code, name, group, description')}
        <label>Group<select name="group"><option value="">All groups</option>${ITEM_GROUPS.map((g) => `<option value="${e(g.name)}" ${f.group === g.name ? 'selected' : ''}>${e(g.name)}</option>`).join('')}</select></label>
        <label>Stock<select name="stock"><option value="">All items</option><option value="tracked" ${f.stock === 'tracked' ? 'selected' : ''}>Tracked</option><option value="service" ${f.stock === 'service' ? 'selected' : ''}>Service / untracked</option></select></label>
        <label>Status<select name="status"><option value="">All states</option><option ${f.status === 'Active' ? 'selected' : ''}>Active</option><option ${f.status === 'Archived' ? 'selected' : ''}>Archived</option></select></label>
        <button class="button" type="button" data-filter-reset="items">Reset</button>
      </form>
      <section class="panel">
        <div class="panel-head"><h2>Items</h2><div class="related"><span class="badge">${rows.length} of ${ITEMS.length}</span><button class="button" data-export-table>Export CSV</button></div></div>
        <div class="table-scroll" data-hscroll><table>
          <thead><tr><th>Code</th><th>Barcode</th><th>Item</th><th>Group</th><th>Unit</th><th>Income head</th><th>Expense head</th><th>Sales tax</th><th>Purchase tax</th><th>Stock</th><th></th></tr></thead>
          <tbody>${rows.map((i) => `<tr class="row-link" data-edit="item:${e(i.code)}"><td class="mono">${e(i.code)}</td><td>${e(i.barcode || '—')}</td><td>${e(i.name)}</td><td>${e(i.group || 'General')}</td><td>${e(i.unit)}</td><td>${e(i.income)} · ${e(accountName(i.income))}</td><td>${e(i.expense)} · ${e(accountName(i.expense))}</td><td>${e(ruleName(i.salesTax || i.tax))}</td><td>${e(ruleName(i.purchaseTax || i.tax))}</td><td>${i.tracked ? badge('Tracked', 'good') : badge('Service')}</td><td class="row-go">›</td></tr>`).join('')}</tbody>
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
        <label>Barcode<input name="barcode" maxlength="30" value="${e(v('barcode'))}"></label>
        <label>Name<input name="name" required maxlength="70" value="${e(v('name'))}" placeholder="Shipping box"></label>
        <label>Group<input name="group" maxlength="30" value="${e(v('group'))}" placeholder="Packaging"></label>
        <label>Unit<input name="unit" required maxlength="10" value="${e(v('unit', 'piece'))}"></label>
        <label class="wide">Description<input name="description" maxlength="120" value="${e(v('description'))}" placeholder="What the item is; prints on documents"></label>
        <label>Income head<select name="income" class="inline-input">${accounts().filter((a) => a.type === 'income').map((a) => `<option value="${a.code}" ${a.code === v('income', '4000') ? 'selected' : ''}>${a.code} · ${e(a.name)}</option>`).join('')}</select></label>
        <label>Expense head<select name="expense" class="inline-input">${accounts().filter((a) => a.type === 'expense').map((a) => `<option value="${a.code}" ${a.code === v('expense', '5000') ? 'selected' : ''}>${a.code} · ${e(a.name)}</option>`).join('')}</select></label>
        <label>Sales tax default<select name="salesTax" class="inline-input"><option value="">No tax</option>${TAX_RULES.filter((r) => r.kind === 'output').map((r) => `<option value="${r.code}" ${r.code === v('salesTax', v('tax')) ? 'selected' : ''}>${e(r.name)} · ${r.rate}%</option>`).join('')}</select></label>
        <label>Purchase tax default<select name="purchaseTax" class="inline-input"><option value="">No tax</option>${TAX_RULES.filter((r) => r.kind === 'input').map((r) => `<option value="${r.code}" ${r.code === v('purchaseTax', v('tax')) ? 'selected' : ''}>${e(r.name)} · ${r.rate}%</option>`).join('')}</select></label>
        <label>Stock<select name="tracked" class="inline-input"><option value="no" ${v('tracked') ? '' : 'selected'}>Service or untracked</option><option value="yes" ${v('tracked') ? 'selected' : ''}>Tracked in Inventory</option></select></label>
        <label>Sale price<input name="salePrice" inputmode="decimal" value="${e(v('salePrice', '0.00'))}"></label>
        <label>Purchase price<input name="purchasePrice" inputmode="decimal" value="${e(v('purchasePrice', '0.00'))}"></label>
        <label>Status<select name="status" class="inline-input"><option ${v('status', 'Active') === 'Active' ? 'selected' : ''}>Active</option><option ${v('status') === 'Archived' ? 'selected' : ''}>Archived</option></select></label>
        <div class="related"><button class="button primary">${editingRow.code ? 'Save changes' : 'Add item'}</button><button type="button" class="button" data-form-cancel>Cancel</button></div>
      </form>
    </section>`;
  }

  function bindItems(rerender, notify, navigate) {
    const goBack = () => navigate({module: 'inventory', tab: 'items'});
    document.querySelectorAll('[data-edit]').forEach((b) => b.addEventListener('click', () => {
      const [type, code] = b.dataset.edit.split(':');
      if (type !== 'item') return;
      navigate({module: 'inventory', tab: 'items', mode: 'editor', code});
    }));
    document.querySelector('[data-item-form] [data-form-cancel]')?.addEventListener('click', goBack);
    document.querySelector('[data-item-form]')?.addEventListener('submit', (ev) => {
      ev.preventDefault();
      const form = ev.target;
      if (!form.reportValidity()) return;
      const v2 = Object.fromEntries(new FormData(form));
      const editingCode = v2.editingCode || '';
      if (!editingCode && ITEMS.some((i) => i.code === v2.code)) { notify('That item code already exists.'); return; }
      const record = {code: v2.code, name: v2.name, barcode: v2.barcode || '', group: v2.group || 'General', unit: v2.unit, description: v2.description || '', income: v2.income, expense: v2.expense, tax: v2.salesTax || v2.tax, salesTax: v2.salesTax || '', purchaseTax: v2.purchaseTax || '', tracked: v2.tracked === 'yes', salePrice: round2(Number(v2.salePrice) || 0), purchasePrice: round2(Number(v2.purchasePrice) || 0), status: v2.status || 'Active'};
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
  /* ---- shared register formatting for the tax module ------------------ */
  function taxColumnValue(row, key) { return row[key] ?? ''; }
  function taxColumnValues(rows, key, valueFn) {
    const value = valueFn || taxColumnValue;
    return [...new Set(rows.map((r) => String(value(r, key) ?? '')).filter((v) => v !== ''))].sort((a, b) => a.localeCompare(b, undefined, {numeric: true})).slice(0, 200);
  }
  function taxColumnLabel(key, value) {
    if (['amount', 'tax', 'base', 'balance'].includes(key)) return money(Number(value) || 0);
    if (key === 'rate') return value === 'custom' ? 'Custom' : value === 'adjustment' ? 'Adjustment' : value + '%';
    return value;
  }
  function taxTableHead(prefix, state, cols, rows, valueFn) {
    const value = valueFn || taxColumnValue;
    return `<thead><tr>${cols.map(([key, label, cls, filterable = true]) => {
      const selected = (state.cf && state.cf[key]) || [];
      const values = filterable ? taxColumnValues(rows, key, value) : [];
      const panel = filterable ? `<div class="col-filter-panel" data-col-panel="${key}" data-col-prefix="${prefix}" hidden>
        <div class="gl-sortrow"><span class="gl-sortlabel">Sort</span><button type="button" class="sort-toggle ${state.sort.key === key ? 'active' : ''}" data-col-toggle="${key}" data-col-prefix="${prefix}">${state.sort.key === key ? (state.sort.dir === 'asc' ? '↑' : '↓') : '↕'}</button></div>
        <div class="ms-searchrow"><input class="ms-search col-menu-search" type="search" placeholder="Search values" aria-label="Search ${e(label)} values"></div>
        <div class="ms-head"><button type="button" class="text-button" data-col-all="${key}" data-col-prefix="${prefix}">Select all</button><span class="ms-count">${values.length}</span><button type="button" class="text-button" data-col-none="${key}" data-col-prefix="${prefix}">Clear</button></div>
        <div class="ms-list">${values.map((v) => `<label class="ms-row"><input class="check" type="checkbox" value="${e(v)}" ${selected.includes(v) ? 'checked' : ''}><span>${e(taxColumnLabel(key, v))}</span></label>`).join('') || '<div class="ms-empty">No values</div>'}</div>
        <div class="gl-applyrow"><button type="button" class="button primary" data-col-apply="${key}" data-col-prefix="${prefix}">Apply filter</button></div>
      </div>` : '';
      return `<th class="col col-${key} ${cls || ''}"><div class="th-flex"><button class="sortable" data-col-sort="${key}" data-col-prefix="${prefix}" aria-sort="${state.sort.key === key ? (state.sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}">${label}<span class="sort-mark">${state.sort.key === key ? (state.sort.dir === 'asc' ? '▲' : '▼') : ''}</span></button>${filterable ? `<button type="button" class="col-filter-btn" data-col-filter="${key}" data-col-prefix="${prefix}" aria-label="Filter ${e(label)}" aria-expanded="false">${icon('chevron')}${selected.length ? `<b>${selected.length}</b>` : ''}</button>` : ''}</div>${panel}</th>`;
    }).join('')}</tr></thead>`;
  }
  function taxFilterRows(rows, state, valueFn) {
    const value = valueFn || taxColumnValue;
    return rows.filter((row) => Object.entries(state.cf || {}).every(([key, selected]) => !selected || !selected.length || selected.includes(String(value(row, key) ?? ''))));
  }
  function taxSortRows(rows, state, valueFn) {
    const value = valueFn || taxColumnValue;
    return rows.slice().sort((a, b) => {
      const x = value(a, state.sort.key), y = value(b, state.sort.key);
      const d = typeof x === 'number' && typeof y === 'number' ? x - y : String(x ?? '').localeCompare(String(y ?? ''), undefined, {numeric: true});
      return state.sort.dir === 'desc' ? -d : d;
    });
  }
  function bindTaxColumnMenus(prefix, state, rerender) {
    let open = '';
    const close = (except) => {
      document.querySelectorAll(`[data-col-panel][data-col-prefix="${prefix}"]`).forEach((p) => { if (p !== except) p.hidden = true; });
      document.querySelectorAll(`[data-col-filter][data-col-prefix="${prefix}"]`).forEach((b) => b.setAttribute('aria-expanded', 'false'));
      open = '';
    };
    const openMenu = (key) => {
      const btn = document.querySelector(`[data-col-filter="${key}"][data-col-prefix="${prefix}"]`);
      const panel = document.querySelector(`[data-col-panel="${key}"][data-col-prefix="${prefix}"]`);
      if (!btn || !panel) return;
      close(panel);
      panel.hidden = false;
      btn.setAttribute('aria-expanded', 'true');
      const r = btn.getBoundingClientRect();
      panel.classList.add('col-filter-panel--fixed');
      const left = r.left > window.innerWidth / 2 ? r.right - 270 : r.left;
      panel.style.left = Math.round(Math.min(Math.max(8, left), window.innerWidth - 278)) + 'px';
      const top = Math.round(r.bottom + 4);
      panel.style.top = top + 'px';
      panel.style.maxHeight = Math.max(220, Math.min(380, window.innerHeight - top - 12)) + 'px';
      const search = panel.querySelector('.col-menu-search');
      if (search) { search.value = ''; search.focus(); }
      open = key;
    };
    document.querySelectorAll(`[data-col-filter][data-col-prefix="${prefix}"]`).forEach((b) => b.addEventListener('click', (ev) => {
      ev.stopPropagation();
      const key = b.dataset.colFilter;
      if (open === key) { close(); return; }
      openMenu(key);
    }));
    document.addEventListener('click', (ev) => {
      if (ev.target.closest(`[data-col-panel][data-col-prefix="${prefix}"]`) || ev.target.closest(`[data-col-filter][data-col-prefix="${prefix}"]`)) return;
      close();
    });
    document.querySelectorAll(`[data-col-panel][data-col-prefix="${prefix}"]`).forEach((panel) => {
      panel.addEventListener('click', (ev) => ev.stopPropagation());
      panel.querySelector('.col-menu-search')?.addEventListener('input', (ev) => {
        const q = ev.target.value.toLowerCase();
        panel.querySelectorAll('.ms-row').forEach((row) => { row.hidden = q && !row.textContent.toLowerCase().includes(q); });
      });
    });
    document.querySelectorAll(`[data-col-all][data-col-prefix="${prefix}"]`).forEach((b) => b.addEventListener('click', () => {
      const panel = document.querySelector(`[data-col-panel="${b.dataset.colAll}"][data-col-prefix="${prefix}"]`);
      panel?.querySelectorAll('input[type=checkbox]').forEach((box) => { if (!box.closest('.ms-row').hidden) box.checked = true; });
    }));
    document.querySelectorAll(`[data-col-none][data-col-prefix="${prefix}"]`).forEach((b) => b.addEventListener('click', () => {
      const panel = document.querySelector(`[data-col-panel="${b.dataset.colNone}"][data-col-prefix="${prefix}"]`);
      panel?.querySelectorAll('input[type=checkbox]').forEach((box) => { box.checked = false; });
    }));
    document.querySelectorAll(`[data-col-apply][data-col-prefix="${prefix}"]`).forEach((b) => b.addEventListener('click', () => {
      const key = b.dataset.colApply;
      const panel = document.querySelector(`[data-col-panel="${key}"][data-col-prefix="${prefix}"]`);
      state.cf = {...(state.cf || {}), [key]: [...panel.querySelectorAll('input[type=checkbox]:checked')].map((x) => x.value)};
      close();
      rerender();
    }));
    document.querySelectorAll(`[data-col-sort][data-col-prefix="${prefix}"]`).forEach((b) => b.addEventListener('click', () => {
      const key = b.dataset.colSort;
      state.sort = {key, dir: state.sort.key === key && state.sort.dir === 'asc' ? 'desc' : 'asc'};
      close();
      rerender();
    }));
    document.querySelectorAll(`[data-col-toggle][data-col-prefix="${prefix}"]`).forEach((b) => b.addEventListener('click', () => {
      const key = b.dataset.colToggle;
      state.sort = {key, dir: state.sort.key === key && state.sort.dir === 'asc' ? 'desc' : 'asc'};
      close();
      rerender();
    }));
  }

  function nextTaxRuleCode() { return 'TAX-' + String(TAX_RULE_SEQ).padStart(4, '0'); }
  function ruleScopeOf(rule) {
    const groups = (rule.groups && rule.groups.length ? rule.groups : (rule.group ? [rule.group] : (rule.scope === 'group' && rule.scopeValue ? [rule.scopeValue] : [])));
    const items = rule.items || [];
    if (rule.scope === 'items' || rule.scopeType === 'items' || (items.length && !groups.length)) return {type: 'items', items};
    if (groups.length) return {type: 'groups', groups};
    return {type: 'all'};
  }
  function itemGroupOf(code) { const item = ITEMS.find((i) => i.code === code); return (item && item.group) || 'General'; }
  function scopeOverlap(a, b) {
    if (a.type === 'all' && b.type === 'all') return ['All items'];
    if (a.type === 'all' || b.type === 'all') return [];
    if (a.type === 'groups' && b.type === 'groups') return a.groups.filter((g) => b.groups.includes(g));
    if (a.type === 'items' && b.type === 'items') return a.items.filter((i) => b.items.includes(i));
    const groups = a.type === 'groups' ? a.groups : b.groups;
    const items = a.type === 'items' ? a.items : b.items;
    return items.filter((i) => groups.includes(itemGroupOf(i))).map((i) => `${i} (${itemGroupOf(i)})`);
  }
  function taxRuleConflicts(candidate, editingCode) {
    const candidateScope = ruleScopeOf(candidate);
    const conflicts = [];
    TAX_RULES.forEach((rule) => {
      if (rule.code === editingCode) return;
      if ((rule.status || 'Active') !== 'Active') return;
      if (rule.kind !== candidate.kind) return;
      const from = candidate.from, to = candidate.to || '9999-12-31';
      const otherFrom = rule.from, otherTo = rule.to || '9999-12-31';
      if (!(from <= otherTo && otherFrom <= to)) return;
      const overlaps = scopeOverlap(candidateScope, ruleScopeOf(rule));
      if (overlaps.length) conflicts.push({rule, overlaps});
    });
    return conflicts;
  }
  function ruleConflictMessage(conflicts) {
    const first = conflicts[0];
    const labels = first.overlaps.join(', ');
    const more = conflicts.length > 1 ? ` It also conflicts with ${conflicts.slice(1).map((c) => c.rule.code).join(', ')}.` : '';
    return `This rule overlaps ${first.rule.code} (${first.rule.name}) on: ${labels}. Remove ${labels} from ${first.rule.code} or remove it from this rule.${more}`;
  }
  function taxRulesPanel() {
    const f = TAX_RULE_FILTER;
    const all = TAX_RULES.map((r) => ({
      ...r,
      nature: taxKindLabel(r.kind),
      scopeLabel: (() => { const s = ruleScopeOf(r); return s.type === 'items' ? 'Specific items' : s.type === 'groups' ? 'Groups · ' + s.groups.join(', ') : 'All items'; })(),
      effective: r.from + (r.to ? ' → ' + r.to : ''),
      statusLabel: r.status || 'Active',
    }));
    const searched = all.filter((r) => !f.q || (r.code + ' ' + r.name + ' ' + r.nature + ' ' + r.scopeLabel + ' ' + (r.description || '')).toLowerCase().includes(f.q.toLowerCase()));
    const rows = taxSortRows(taxFilterRows(searched, f), f);
    const cols = [['code', 'Rule no.', '', false], ['name', 'Rule'], ['nature', 'Nature'], ['rate', 'Rate', 'numeric', false], ['scopeLabel', 'Scope'], ['effective', 'Effective', '', false], ['statusLabel', 'Status']];
    return `<form class="filterbar" data-tax-rule-filter>
        <label>Search<input type="search" name="q" value="${e(f.q)}" placeholder="Rule number, name, nature, scope"></label>
        <button class="button" type="button" data-tax-rule-reset>Reset</button>
      </form>
      <section class="panel">
      <div class="panel-head"><h2>Tax rules</h2><div class="related"><span class="badge">${rows.length} of ${TAX_RULES.length} rules</span><button class="button" data-export-table>Export CSV</button></div></div>
      <div class="table-scroll" data-hscroll><table class="tax-register">
        ${taxTableHead('taxrule', f, cols, all)}
        <tbody>${rows.map((r) => `<tr class="row-link" data-edit="tax:${e(r.code)}"><td class="mono">${e(r.code)}</td><td>${e(r.name)}${r.description ? `<small class="secondary">${e(r.description)}</small>` : ''}</td><td>${e(r.nature)}</td><td class="numeric">${r.rate}%</td><td>${e(r.scopeLabel)}</td><td>${e(r.effective)}</td><td>${badge(r.statusLabel, r.statusLabel === 'Active' ? 'good' : 'warn')}</td></tr>`).join('') || '<tr><td colspan="7">No tax rule matches these filters.</td></tr>'}</tbody>
      </table></div>
      <div class="table-footer">A rule is a default. The number is assigned by the system; the name is yours. The authority is not part of the rule: it comes from Taxes → Default accounts, and a document can override it. Any document line may still override the rate or switch tax off.</div>
    </section>`;
  }

  function taxEditor(code) {
    const editingRow = code ? (TAX_RULES.find((r) => r.code === code) || {}) : {};
    const v = (key, fallback = '') => (editingRow[key] !== undefined ? editingRow[key] : fallback);
    const existingScope = ruleScopeOf(editingRow);
    const scopeType = editingRow.code ? existingScope.type : 'groups';
    const existingGroups = existingScope.type === 'groups' ? existingScope.groups : [];
    const ruleNumber = editingRow.code || nextTaxRuleCode();
    return `<section class="panel">
      <div class="panel-head"><h2>${editingRow.code ? e(editingRow.name) : 'New tax rule'}</h2><span class="badge">${editingRow.code ? `Editing ${e(editingRow.code)}` : 'System numbered'}</span></div>
      <form data-tax-form class="panel-body form-grid">
        <input type="hidden" name="editingCode" value="${e(editingRow.code || '')}">
        <label>Rule no. (system)<input name="code" readonly value="${e(ruleNumber)}"><small class="secondary">Assigned in order, TAX-0001, TAX-0002, …</small></label>
        <label>Name<input name="name" required maxlength="70" value="${e(v('name'))}" placeholder="Sales tax 10%"></label>
        <label>Nature<select name="kind" class="inline-input">${TAX_KINDS.map(([k, l]) => `<option value="${k}" ${v('kind', 'output') === k ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
        <label>Rate %<input name="rate" required inputmode="decimal" value="${e(v('rate', '10.00'))}"></label>
        <div class="wide"><p class="form-note">Price basis: <strong>tax exclusive</strong>. The line price is net; tax is added. There is no inclusive-price mode. The control account and default authority for this nature are set under <strong>Default accounts</strong>; a document can change the authority.</p></div>
        <label>Applies to<select name="scopeType" class="inline-input"><option value="all" ${scopeType === 'all' ? 'selected' : ''}>All items (fallback)</option><option value="groups" ${scopeType === 'groups' ? 'selected' : ''}>Item groups</option><option value="items" ${scopeType === 'items' ? 'selected' : ''}>Specific items</option></select></label>
        ${ms('tax-groups', 'Item groups', ITEM_GROUPS.map((g) => [g.name, `${g.name} · ${g.description}`]), existingGroups, '', 'Choose item groups')}
        ${ms('tax-items', 'Items', ITEMS.map((it) => [it.code, `${it.code} · ${it.name}`]), v('items', []), '', 'Choose items')}
        <div class="wide" data-tax-rule-conflict hidden></div>
        <label>Effective from<input name="from" type="date" value="${e(v('from', '2026-11-01'))}" required></label>
        <label>Effective to<input name="to" type="date" value="${e(v('to'))}"></label>
        <label>Status<select name="status" class="inline-input"><option ${v('status', 'Active') === 'Active' ? 'selected' : ''}>Active</option><option ${v('status') === 'Archived' ? 'selected' : ''}>Archived</option></select></label>
        <label>Override on a line<select name="override" class="inline-input"><option value="yes" ${v('override', 'yes') === 'yes' ? 'selected' : ''}>Allowed</option><option value="no" ${v('override') === 'no' ? 'selected' : ''}>Not allowed</option></select></label>
        <label class="wide">Description<input name="description" maxlength="100" value="${e(v('description'))}" placeholder="What the rule covers and where it comes from"></label>
        ${ms('tax-projects', 'Allowed projects', PROJECTS.map((p) => [p.code, `${p.code} · ${p.name}`]), v('projects', []))}
        ${ms('tax-locations', 'Allowed locations', LOCATIONS.map((l) => [l.code, `${l.code} · ${l.name}`]), v('locations', []))}
        <div class="related"><button class="button primary">${editingRow.code ? 'Save changes' : 'Add tax rule'}</button><button type="button" class="button" data-form-cancel>Cancel</button></div>
      </form>
      <div class="panel-body"><p class="form-note">Scope narrows where the rule is offered; the effective dates decide when it applies. The rule number is generated and never reused. <strong>All items</strong> is the fallback; specific group or item rules must not overlap each other for the same nature and effective period. Rules never post on their own — they fill a document line, and the document posts the tax with its authority.</p></div>
    </section>`;
  }

  function taxPanel(id) {
    if (id === 'authorities') return taxAuthoritiesPanel();
    if (id === 'entries') return taxEntriesPanel();
    if (id === 'parties') { TAX_RECON_TAB = 'balances'; return taxReconciliationPage(); }
    if (id === 'reconciliation') return taxReconciliationPage();
    if (id === 'defaults') return taxDefaultsPanel();
    return taxRulesPanel();
  }
  function taxDefaultsPanel() {
    const accountOption = (code, side) => accounts().filter((a) => a.subtype === 'tax' && a.type === side).map((a) => `<option value="${a.code}" ${a.code === code ? 'selected' : ''}>${a.code} · ${e(a.name)}</option>`).join('');
    const authorityOption = (kind, id) => `<option value="">Use no default</option>${TAX_AUTHORITIES.filter((a) => authorityHas(a, kind) && a.active !== false).map((a) => `<option value="${e(a.id)}" ${a.id === id ? 'selected' : ''}>${e(a.name)}${a.registration ? ' · ' + e(a.registration) : ''}</option>`).join('')}`;
    const side = {input: 'asset', output: 'liability', advance_income: 'asset', advance_sales: 'asset', withholding_income: 'liability', withholding_sales: 'liability'};
    return `<section class="panel">
      <div class="panel-head"><h2>Default tax accounts and authorities</h2><span class="badge">Used by documents</span></div>
      <form class="panel-body" data-tax-defaults>
        <div class="table-scroll"><table class="invoice-lines"><thead><tr><th>Tax nature</th><th>Control account</th><th>Default authority</th></tr></thead><tbody>
          ${TAX_KINDS.map(([kind, label]) => `<tr><td>${e(label)}</td><td><select name="${kind}" class="inline-input" aria-label="${e(label)} control account">${accountOption(TAX_DEFAULTS[taxNatureMeta(kind).defaultKey], side[kind])}</select></td><td><select name="${kind}Authority" class="inline-input" aria-label="${e(label)} default authority">${authorityOption(kind, TAX_DEFAULT_AUTHORITIES[kind])}</select></td></tr>`).join('')}
        </tbody></table></div>
        <div class="related"><button class="button primary">Save default accounts</button></div>
      </form>
      <div class="panel-body"><div class="section-title">Sales tax basis for calculation</div>
        <form class="form-grid" data-tax-calc>
          <label>Sales tax and discounts<select name="afterDiscount" class="inline-input"><option value="yes" ${TAX_AFTER_DISCOUNT ? 'selected' : ''}>Tax the discounted amount</option><option value="no" ${TAX_AFTER_DISCOUNT ? '' : 'selected'}>Tax the original amount</option></select></label>
          <div class="wide"><p class="form-note">Some authorities tax the original price before a discount, others tax what the customer pays. This is a policy, not a document choice.</p></div>
          <div class="related"><button class="button primary">Save tax calculation</button></div>
        </form></div>
        <div class="panel-body"><p class="form-note">Each nature has one control account and one default authority. Only tax-subtype accounts of the correct side are offered, and only authorities assigned to that nature. These defaults fill invoices, bills and rules; a document can change its authority. Stored for this session.</p></div>
    </section>`;
  }
  function advanceOpen(a) { return round2(Number(a.amount || 0) - Number(a.applied || 0)); }
  function advanceEntryLines(direction, party, account, amount) {
    const amt = round2(Number(amount) || 0);
    const sub = CASH_BANK.find((c) => c.name === account);
    const code = sub ? sub.control : account;
    if (!amt || !code) return [];
    return direction === 'receive'
      ? [{account: code, party: sub ? sub.name : '', debit: amt, credit: 0}, {account: '2300', party, debit: 0, credit: amt}]
      : [{account: '1250', party, debit: amt, credit: 0}, {account: code, party: sub ? sub.name : '', debit: 0, credit: amt}];
  }
  function advanceApplicationLines(advance, amount) {
    const amt = round2(Number(amount) || 0);
    if (!advance || !amt) return [];
    return advance.direction === 'receive'
      ? [{account: '2300', party: advance.party, debit: amt, credit: 0}, {account: '1100', party: advance.party, debit: 0, credit: amt}]
      : [{account: '2100', party: advance.party, debit: amt, credit: 0}, {account: '1250', party: advance.party, debit: 0, credit: amt}];
  }
  function advancesView() {
    const tab = ADV_TAB === 'transactions' ? 'transactions' : 'balances';
    const tabs = `<div class="tabs" role="tablist" aria-label="Advance views"><button type="button" role="tab" aria-selected="${tab === 'balances'}" data-adv-tab="balances">Balances <span class="badge">${ADVANCES.length}</span></button><button type="button" role="tab" aria-selected="${tab === 'transactions'}" data-adv-tab="transactions">Transactions <span class="badge">${ADVANCES.length + ADVANCE_APPLIED.length}</span></button></div>`;
    const rows = ADVANCES.slice();
    if (tab === 'transactions') {
      const tx = [
        ...rows.map((a) => ({date: a.date, ref: a.id, party: a.party, type: a.direction === 'receive' ? 'Advance received' : 'Advance paid', amount: a.amount, doc: '—', state: advanceOpen(a) > 0 ? 'Open' : 'Applied'})),
        ...ADVANCE_APPLIED.map((x) => { const a = ADVANCES.find((y) => y.id === x.advanceId) || {}; return {date: x.date, ref: x.id || x.advanceId, party: x.party || a.party || '', type: 'Applied ' + x.advanceId, amount: x.amount, doc: x.docId, state: 'Applied'}; }),
      ].filter((t) => !ADV_FILTER_PARTY || t.party === ADV_FILTER_PARTY).sort((a, b) => b.date.localeCompare(a.date) || b.ref.localeCompare(a.ref));
      return tabs + `<section class="panel">
        <div class="panel-head"><h2>Advance transactions</h2><div class="related">${ADV_FILTER_PARTY ? `<button type="button" class="text-button" data-adv-clear-party>Party · ${e(ADV_FILTER_PARTY)} ×</button>` : ''}<span class="badge">${tx.length} entries</span><button type="button" class="button" data-adv-apply-new>Apply to invoice</button></div></div>
        <div class="table-scroll"><table><thead><tr><th>Date</th><th>Reference</th><th>Party</th><th>Type</th><th class="numeric">Amount</th><th>Document</th><th>State</th></tr></thead>
          <tbody>${tx.map((t) => `<tr class="row-link" data-adv-open="${e(t.ref)}"><td>${e(t.date)}</td><td class="mono">${e(t.ref)}</td><td>${e(t.party)}</td><td>${e(t.type)}</td><td class="numeric">${money(t.amount)}</td><td class="mono">${e(t.doc)}</td><td>${badge(t.state, t.state === 'Applied' ? 'good' : 'warn')}</td></tr>`).join('') || '<tr><td colspan="7">No advance activity yet. Record an advance or apply one to an invoice.</td></tr>'}</tbody></table></div>
        <div class="table-footer">Every advance voucher and every application to an invoice appears here. Open means money is still unapplied.</div>
      </section>`;
    }
    const byParty = new Map();
    rows.forEach((a) => {
      const key = a.party + '|' + a.direction;
      const row = byParty.get(key) || {party: a.party, direction: a.direction, count: 0, total: 0, applied: 0, balance: 0};
      row.count++; row.total = round2(row.total + a.amount); row.applied = round2(row.applied + a.applied); row.balance = round2(row.balance + advanceOpen(a));
      byParty.set(key, row);
    });
    const list = [...byParty.values()].sort((a, b) => a.party.localeCompare(b.party));
    return tabs + `<section class="panel">
      <div class="panel-head"><h2>Advance balances by party</h2><div class="related"><span class="badge">${list.length} parties</span><button type="button" class="button" data-adv-apply-new>Apply to invoice</button></div></div>
      <div class="table-scroll"><table><thead><tr><th>Party</th><th>Type</th><th class="numeric">Advances</th><th class="numeric">Total</th><th class="numeric">Applied</th><th class="numeric">Balance</th></tr></thead>
        <tbody>${list.map((r) => `<tr class="row-link" data-adv-party="${e(r.party)}"><td>${e(r.party)}</td><td>${r.direction === 'receive' ? 'Received from customer' : 'Paid to supplier'}</td><td class="numeric">${r.count}</td><td class="numeric">${money(r.total)}</td><td class="numeric">${money(r.applied)}</td><td class="numeric">${money(r.balance)}</td></tr>`).join('') || '<tr><td colspan="6">No advances recorded yet. Use New advance.</td></tr>'}</tbody>
        <tfoot><tr><td colspan="2">Total</td><td class="numeric">${list.reduce((n, r) => n + r.count, 0)}</td><td class="numeric">${money(round2(list.reduce((n, r) => n + r.total, 0)))}</td><td class="numeric">${money(round2(list.reduce((n, r) => n + r.applied, 0)))}</td><td class="numeric">${money(round2(list.reduce((n, r) => n + r.balance, 0)))}</td></tr></tfoot></table></div>
      <div class="table-footer">Balances are per party and direction. A customer advance is money we hold; a supplier advance is money they hold. Applying one reduces the balance and the invoice.</div>
    </section>`;
  }
  function applyAdvanceEditor() {
    const open = ADVANCES.filter((a) => advanceOpen(a) > 0);
    const parties = [...new Set(open.map((a) => a.party))];
    const party = ADV_APPLY_PARTY || (open[0] ? open[0].party : '');
    const advances = open.filter((a) => a.party === party);
    const docs = (party ? openItems(PARTIES.find((p) => p.name === party)) : []).filter((d) => party);
    return `<section class="panel">
      <div class="panel-head"><h2>Apply an advance</h2><span class="badge">Against an invoice or bill</span></div>
      ${advances.length ? `<form data-adv-apply class="panel-body form-grid">
        <label>Party<select name="party" class="inline-input">${parties.map((p) => `<option ${p === party ? 'selected' : ''}>${e(p)}</option>`).join('')}</select></label>
        <label>Advance<select name="advance" class="inline-input">${advances.map((a) => `<option value="${a.id}">${e(a.id)} · ${money(advanceOpen(a))} available</option>`).join('')}</select></label>
        <label>Document<select name="doc" class="inline-input">${docs.map((d) => `<option value="${d.id}">${e(d.id)} · ${money(d.outstanding)} due</option>`).join('') || '<option value="">No open document</option>'}</select></label>
        <label>Amount to apply<input name="amount" inputmode="decimal" placeholder="0.00" required></label>
        <label>Date<input name="date" type="date" value="2026-11-30"></label>
        <div class="related"><button class="button primary">Apply advance</button><button type="button" class="button" data-form-cancel>Cancel</button></div>
      </form><div class="panel-body form-grid" data-adv-apply-preview>${ledgerIllustration('Illustrative advance application', [], 'Choose an advance and amount to preview the application.')}</div><div class="panel-body"><p class="form-note">The advance balance and the document outstanding both reduce. No new cash moves; this is an application of money already received or paid.</p></div>`
      : '<div class="panel-body"><p class="form-note">There is no open advance to apply.</p><div class="related"><button type="button" class="button" data-form-cancel>Cancel</button></div></div>'}
    </section>`;
  }
  function advanceRecord(code) {
    const app = ADVANCE_APPLIED.find((x) => x.id === code);
    const advance = app ? ADVANCES.find((a) => a.id === app.advanceId) : ADVANCES.find((a) => a.id === code);
    if (!advance) return `<section class="panel"><div class="panel-body"><p>That advance is not in the register.</p><div class="related"><button type="button" class="button" data-adv-record-close>Back to advances</button></div></div></section>`;
    const apps = ADVANCE_APPLIED.filter((x) => x.advanceId === advance.id);
    return `<section class="panel">
      <div class="panel-head"><h2>${e(app ? app.id : advance.id)}</h2><div class="related">${badge(app ? 'Advance application' : advance.direction === 'receive' ? 'Advance received' : 'Advance paid', app ? 'plum' : '')}</div></div>
      <div class="panel-body"><div class="record-summary">
        <div><small>${app ? 'Advance' : 'Party'}</small>${e(app ? app.advanceId : advance.party)}</div>
        <div><small>Date</small>${e(app ? app.date : advance.date)}</div>
        <div><small>Amount</small>${money(app ? app.amount : advance.amount)}</div>
        <div><small>${app ? 'Document' : 'Applied'}</small>${app ? `<button type="button" class="text-button mono" data-adv-record-doc="${e(app.docId)}">${e(app.docId)}</button>` : money(advance.applied)}</div>
      </div>
      ${!app ? `<div class="record-summary invoice-subsummary"><div><small>Unapplied</small>${money(advanceOpen(advance))}</div><div><small>Method</small>${e(advance.method || '—')}</div><div><small>Account</small>${e(advance.account || '—')}</div></div>` : ''}
      ${advance.notes ? `<p class="form-note">${e(advance.notes)}</p>` : ''}
      </div>
      ${!app ? `<div class="table-scroll"><table><thead><tr><th>Application</th><th>Date</th><th>Document</th><th class="numeric">Amount</th></tr></thead><tbody>${apps.map((x) => `<tr class="row-link" data-adv-open="${e(x.id)}"><td class="mono">${e(x.id)}</td><td>${e(x.date)}</td><td class="mono">${e(x.docId)}</td><td class="numeric">${money(x.amount)}</td></tr>`).join('') || '<tr><td colspan="4">Not applied to any document yet.</td></tr>'}</tbody></table></div>` : ''}
      <div class="panel-body"><div class="related">
        ${!app && advanceOpen(advance) > 0 ? `<button type="button" class="button" data-adv-record-apply="${e(advance.id)}">Apply to invoice</button>` : ''}
        <button type="button" class="button" data-adv-record-print>Print</button>
        <button type="button" class="button" data-adv-record-close>Close</button>
      </div><p class="form-note">Read-only record. The voucher and its applications are separate documents; printing uses the browser.</p></div>
    </section>`;
  }
  function advanceEditor() {
    const parties = PARTIES;
    const method0 = 'bank';
    return `<section class="panel">
      <div class="panel-head"><h2>New advance</h2><span class="badge">Separate voucher</span></div>
      <form data-adv-form class="panel-body form-grid">
        <label>Party<select name="party" class="inline-input" required><option value="">Choose a party</option>${parties.map((p) => `<option value="${e(p.name)}">${e(p.name)} · ${e(p.code)}</option>`).join('')}</select></label>
        <label>Direction<select name="direction" class="inline-input"><option value="receive">Received from customer</option><option value="pay">Paid to supplier</option></select></label>
        <label>Date<input name="date" type="date" value="2026-11-30" required></label>
        <label>Amount<input name="amount" inputmode="decimal" placeholder="0.00" required></label>
        <label>Method<select name="method" class="inline-input"><option value="bank">Bank transfer</option><option value="cash">Cash</option></select></label>
        <label>Cash / bank sub-account<select name="account" class="inline-input"><option value="">Choose sub-account</option>${CASH_BANK.filter((c) => (method0 === 'cash' ? c.kind === 'cash' : c.kind === 'bank')).map((c) => `<option value="${e(c.name)}">${e(c.name)} · ${c.control}</option>`).join('')}</select></label>
        <label class="wide">Notes<input name="notes" maxlength="100" placeholder="What this advance is for"></label>
        <div class="related"><button class="button primary">Record advance</button><button type="button" class="button" data-form-cancel>Cancel</button></div>
      </form>
      <div class="panel-body form-grid" data-adv-preview>${ledgerIllustration('Illustrative advance voucher', [], 'Fill the party, amount and account to preview the voucher.')}</div>
      <div class="panel-body"><p class="form-note">The voucher is numbered ADV-YYYY-nnnn and appears in the advances register. It is not applied to any invoice until you use Adjust against a document.</p></div>
    </section>`;
  }
  function bindAdvances(rerender, notify, navigate) {
    const goBack = () => navigate({module: 'accounting', tab: 'advances'});
    document.querySelectorAll('[data-adv-tab]').forEach((b) => b.addEventListener('click', () => {
      ADV_TAB = b.dataset.advTab;
      rerender();
      try { window.scrollTo({top: 0, behavior: 'auto'}); } catch {}
    }));
    document.querySelectorAll('[data-adv-apply-new]').forEach((b) => b.addEventListener('click', () => navigate({module: 'accounting', tab: 'advances', mode: 'editor', form: 'apply'})));
    document.querySelectorAll('[data-adv-open]').forEach((tr) => tr.addEventListener('click', (ev) => {
      if (ev.target.closest('button, a, select, input')) return;
      navigate({module: 'accounting', tab: 'advances', mode: 'editor', code: tr.dataset.advOpen});
    }));
    document.querySelectorAll('[data-adv-party]').forEach((tr) => tr.addEventListener('click', () => { ADV_FILTER_PARTY = tr.dataset.advParty; ADV_TAB = 'transactions'; rerender(); window.scrollTo({top: 0}); }));
    document.querySelector('[data-adv-clear-party]')?.addEventListener('click', () => { ADV_FILTER_PARTY = ''; rerender(); });
    document.querySelector('[data-adv-record-close]')?.addEventListener('click', goBack);
    document.querySelector('[data-adv-record-print]')?.addEventListener('click', () => window.print());
    document.querySelector('[data-adv-record-apply]')?.addEventListener('click', (ev) => { ADV_APPLY_PARTY = (ADVANCES.find((a) => a.id === ev.target.dataset.advRecordApply) || {}).party || ''; navigate({module: 'accounting', tab: 'advances', mode: 'editor', form: 'apply'}); });
    document.querySelectorAll('[data-adv-record-doc]').forEach((b) => b.addEventListener('click', () => { const id = b.dataset.advRecordDoc; const sales = /SI/i.test(id); navigate({module: 'accounting', tab: sales ? 'sales-invoices' : 'purchase-invoices', mode: 'editor', form: 'invoice', code: id}); }));
    document.querySelector('[data-adv-form] [data-form-cancel]')?.addEventListener('click', goBack);
    document.querySelector('[data-adv-form]')?.addEventListener('submit', (ev) => {
      ev.preventDefault();
      const form = ev.target;
      if (!form.reportValidity()) return;
      const v = Object.fromEntries(new FormData(form));
      const amount = round2(Number(v.amount) || 0);
      if (amount <= 0) { notify('Enter an amount greater than zero.'); return; }
      if (!v.account) { notify('Choose the cash or bank sub-account.'); return; }
      ADVANCES.push({id: 'ADV-2026-' + String(ADV_SEQ++).padStart(4, '0'), party: v.party, direction: v.direction, date: v.date, amount, applied: 0, method: v.method === 'cash' ? 'Cash' : 'Bank transfer', account: v.account, notes: v.notes || ''});
      notify('Advance recorded.');
      goBack();
    });
    const advForm = document.querySelector('[data-adv-form]');
    const recalcAdv = () => {
      if (!advForm) return;
      const v = Object.fromEntries(new FormData(advForm));
      const box = document.querySelector('[data-adv-preview]');
      if (box) box.innerHTML = ledgerIllustration('Illustrative advance voucher', advanceEntryLines(v.direction, v.party, v.account, v.amount), 'Received money debits the cash or bank account and credits customer advances; paid money debits supplier advances and credits cash or bank.');
    };
    advForm?.addEventListener('input', recalcAdv);
    advForm?.addEventListener('change', (ev) => {
      if (ev.target.name === 'method') {
        const kind = ev.target.value === 'cash' ? 'cash' : 'bank';
        const acc = advForm.querySelector('[name="account"]');
        acc.innerHTML = '<option value="">Choose sub-account</option>' + CASH_BANK.filter((c) => c.kind === kind).map((c) => `<option value="${e(c.name)}">${e(c.name)} · ${c.control}</option>`).join('');
      }
      recalcAdv();
    });
    document.querySelector('[data-adv-apply] [name="party"]')?.addEventListener('change', (ev) => { ADV_APPLY_PARTY = ev.target.value; rerender(); });
    const applyBox = () => {
      const f = document.querySelector('[data-adv-apply]');
      if (!f) return;
      const v = Object.fromEntries(new FormData(f));
      const advance = ADVANCES.find((a) => a.id === v.advance);
      const box = document.querySelector('[data-adv-apply-preview]');
      if (box) box.innerHTML = ledgerIllustration('Illustrative advance application', advanceApplicationLines(advance, v.amount), 'Applying an advance moves value already received or paid onto the document; no new cash moves.');
    };
    document.querySelector('[data-adv-apply]')?.addEventListener('input', applyBox);
    document.querySelector('[data-adv-apply]')?.addEventListener('change', applyBox);
    document.querySelector('[data-adv-apply]')?.addEventListener('submit', (ev) => {
      ev.preventDefault();
      const form = ev.target;
      const v = Object.fromEntries(new FormData(form));
      const advance = ADVANCES.find((a) => a.id === v.advance);
      const amount = round2(Number(v.amount) || 0);
      if (!advance) { notify('Choose an advance.'); return; }
      if (!v.doc) { notify('Choose an open document.'); return; }
      if (amount <= 0) { notify('Enter an amount greater than zero.'); return; }
      if (amount > advanceOpen(advance) + 0.005) { notify('The amount is more than the advance available.'); return; }
      const party = PARTIES.find((p) => p.name === advance.party);
      const doc = openItems(party).find((d) => d.id === v.doc);
      if (!doc) { notify('That document is not open for this party.'); return; }
      if (amount > doc.outstanding + 0.005) { notify('The amount is more than the document outstanding.'); return; }
      advance.applied = round2(advance.applied + amount);
      ADVANCE_APPLIED.push({id: nextAdvanceAppId(), advanceId: advance.id, docId: v.doc, party: advance.party, amount, date: v.date || advance.date});
      notify(`Applied ${amount.toFixed(2)} from ${advance.id} to ${v.doc}.`);
      goBack();
    });
  }
  function revenueRows() { return invoiceRows('sales'); }
  function itemSalesRows() {
    return INVOICES.filter((x) => x.kind === 'sales').flatMap((inv) => (inv.lines || []).filter((l) => l.item).map((l) => ({
      party: inv.party, item: l.item, qty: Number(l.qty) || 0, net: invLineNet(l), tax: invLineTax(l), gross: invLineGross(l),
    })));
  }
  function revenuePage() {
    const invoices = revenueRows();
    const itemRows = itemSalesRows();
    const net = round2(invoices.reduce((n, r) => n + r.net, 0));
    const tax = round2(invoices.reduce((n, r) => n + r.tax, 0));
    const gross = round2(invoices.reduce((n, r) => n + r.gross, 0));
    const parties = new Set(invoices.map((r) => r.party));
    const byParty = new Map();
    invoices.forEach((r) => {
      const row = byParty.get(r.party) || {party: r.party, count: 0, net: 0, tax: 0, gross: 0, paid: 0, balance: 0};
      row.count++; row.net = round2(row.net + r.net); row.tax = round2(row.tax + r.tax); row.gross = round2(row.gross + r.gross);
      row.paid = round2(row.paid + (r.paid || 0)); row.balance = round2(row.balance + r.balance);
      byParty.set(r.party, row);
    });
    const byItem = new Map();
    itemRows.forEach((r) => {
      const item = ITEMS.find((i) => i.code === r.item);
      const row = byItem.get(r.item) || {item: r.item, name: item ? item.name : r.item, qty: 0, net: 0, tax: 0, gross: 0, invoices: new Set(), customers: new Set()};
      row.qty = round2(row.qty + r.qty); row.net = round2(row.net + r.net); row.tax = round2(row.tax + r.tax); row.gross = round2(row.gross + r.gross);
      row.invoices.add(r.party + '|' + r.gross); row.customers.add(r.party);
      byItem.set(r.item, row);
    });
    const partyList = [...byParty.values()].sort((a, b) => b.net - a.net);
    const itemList = [...byItem.values()].sort((a, b) => b.net - a.net);
    const topParty = partyList[0];
    const topItem = itemList[0];
    return `<div class="dash-stats">${[['Revenue · net', money(net)], ['Sales tax', money(tax)], ['Gross invoiced', money(gross)], ['Customers', String(parties.size)], ['Items sold', String(round2(itemRows.reduce((n, r) => n + r.qty, 0)))], ['Top customer', topParty ? topParty.party : '—'], ['Top item', topItem ? topItem.name : '—']].map(([label, value]) => `<div class="stat"><span class="stat-label">${label}</span><strong class="value">${value}</strong></div>`).join('')}</div>
      <div class="tabs" role="tablist" aria-label="Revenue views"><button role="tab" aria-selected="${REV_TAB === 'customer'}" data-rev-tab="customer">By customer</button><button role="tab" aria-selected="${REV_TAB === 'item'}" data-rev-tab="item">By item</button></div>
      ${REV_TAB === 'item' ? `<section class="panel"><div class="panel-head"><h2>Sales by item</h2><span class="badge">${itemList.length} items</span></div>
        <div class="table-scroll"><table><thead><tr><th>Item</th><th>Name</th><th class="numeric">Qty</th><th class="numeric">Net</th><th class="numeric">Tax</th><th class="numeric">Gross</th><th class="numeric">Customers</th><th class="numeric">Invoices</th></tr></thead>
        <tbody>${itemList.map((r) => `<tr><td class="mono">${e(r.item)}</td><td>${e(r.name)}</td><td class="numeric">${r.qty}</td><td class="numeric">${money(r.net)}</td><td class="numeric">${money(r.tax)}</td><td class="numeric">${money(r.gross)}</td><td class="numeric">${r.customers.size}</td><td class="numeric">${r.invoices.size}</td></tr>`).join('') || '<tr><td colspan="8">No item lines yet. Save a sales invoice with items to populate this view; fixture invoices carry accounts, not item codes.</td></tr>'}</tbody>
        <tfoot><tr><td colspan="2">Total</td><td class="numeric">${round2(itemList.reduce((n, r) => n + r.qty, 0))}</td><td class="numeric">${money(round2(itemList.reduce((n, r) => n + r.net, 0)))}</td><td class="numeric">${money(round2(itemList.reduce((n, r) => n + r.tax, 0)))}</td><td class="numeric">${money(round2(itemList.reduce((n, r) => n + r.gross, 0)))}</td><td colspan="2"></td></tr></tfoot></table></div>
        <div class="table-footer">Every saved sales invoice line is kept with its item, quantity and values, so item-wise statistics work for inventory and non-inventory items alike. Cancelled or returned documents need their own adjustment; returns are not netted here yet.</div></section>`
      : `<section class="panel"><div class="panel-head"><h2>Sales by customer</h2><span class="badge">${partyList.length} customers</span></div>
        <div class="table-scroll"><table><thead><tr><th>Customer</th><th class="numeric">Invoices</th><th class="numeric">Net</th><th class="numeric">Tax</th><th class="numeric">Gross</th><th class="numeric">Paid</th><th class="numeric">Balance</th><th class="numeric">Share</th></tr></thead>
        <tbody>${partyList.map((r) => `<tr><td>${e(r.party)}</td><td class="numeric">${r.count}</td><td class="numeric">${money(r.net)}</td><td class="numeric">${money(r.tax)}</td><td class="numeric">${money(r.gross)}</td><td class="numeric">${money(r.paid)}</td><td class="numeric">${money(r.balance)}</td><td class="numeric">${net ? (Math.round((r.net / net) * 1000) / 10).toFixed(1) : '0.0'}%</td></tr>`).join('') || '<tr><td colspan="8">No sales yet.</td></tr>'}</tbody>
        <tfoot><tr><td>Total</td><td class="numeric">${partyList.reduce((n, r) => n + r.count, 0)}</td><td class="numeric">${money(net)}</td><td class="numeric">${money(tax)}</td><td class="numeric">${money(gross)}</td><td class="numeric">${money(round2(partyList.reduce((n, r) => n + r.paid, 0)))}</td><td class="numeric">${money(round2(partyList.reduce((n, r) => n + r.balance, 0)))}</td><td class="numeric">100%</td></tr></tfoot></table></div>
        <div class="table-footer">Net, tax and gross come from the invoice register; Paid and Balance follow receipts and returns. Fixture invoices are included by customer even though they carry no item codes.</div></section>`}`;
  }
  function reportPage(id) {
    if (id === 'revenue') return revenuePage();
    if (id === 'trial') return trialView ? trialView() : '';
    if (id === 'profit') return reportProfit();
    if (id === 'position') return reportPosition();
    if (id === 'cashflow') return reportCashflow();
    if (id === 'equity') return reportEquity();
    return ageing();
  }
  function taxPage(id) {
    if (id === 'parties') { TAX_ACTIVE = 'reconciliation'; TAX_RECON_TAB = 'balances'; }
    else if (TAX_TABS.some(([k]) => k === id)) TAX_ACTIVE = id;
    return `<div id="tax-panel">${taxPanel(TAX_ACTIVE)}</div>`;
  }
  function taxKindLabel(kind) {
    const row = TAX_KINDS.find(([k]) => k === kind);
    return row ? row[1] : kind;
  }
  function authorityHas(a, kind) { return (a.kinds || []).includes(kind); }
  function taxNatureMeta(kind) { return TAX_NATURE_META[kind] || TAX_NATURE_META.input; }
  function taxControlAccount(kind) { const meta = taxNatureMeta(kind); return TAX_DEFAULTS[meta.defaultKey] || meta.fallback; }
  function suggestedOffsetAccount(kind) {
    return taxNatureMeta(kind).side === 'asset' ? '5300' : '4200';
  }
  function legacyOffsetAccount(record) {
    return record.offsetAccount || (record.offset === 'party' ? taxNatureMeta(record.kind).party : suggestedOffsetAccount(record.kind));
  }
  function taxOffsetAccountLabel(code) {
    if (!code) return '—';
    const account = accounts().find((a) => a.code === code);
    return account ? `${code} · ${account.name}` : code;
  }
  function taxAdjustmentEntry(kind, party, direction, amount, offsetAccount, authority) {
    const meta = taxNatureMeta(kind);
    const control = taxControlAccount(kind);
    const increase = direction === 'increase';
    const debitControl = meta.side === 'asset' ? increase : !increase;
    const offset = offsetAccount || suggestedOffsetAccount(kind);
    const authorityName = (TAX_AUTHORITIES.find((a) => a.id === authority) || {}).name || '';
    return [
      {account: control, party: party || '', authority: authorityName, debit: debitControl ? amount : 0, credit: debitControl ? 0 : amount},
      {account: offset, party: party || '', authority: '', debit: debitControl ? 0 : amount, credit: debitControl ? amount : 0},
    ];
  }
  function defaultAuthorityFor(kind) {
    return TAX_AUTHORITIES.find((a) => a.id === TAX_DEFAULT_AUTHORITIES[kind] && a.active !== false && authorityHas(a, kind))
      || TAX_AUTHORITIES.find((a) => authorityHas(a, kind) && a.active !== false)
      || {id: '', name: '—', registration: ''};
  }
  function documentAuthority(doc, kind) {
    return (doc && TAX_AUTHORITIES.find((a) => a.id === doc.taxAuthority)) || defaultAuthorityFor(kind);
  }
  function taxEntries() {
    const entries = [];
    INVOICES.forEach((inv) => {
      const totals = invoiceTotals(inv.kind, inv.lines || []);
      const kind = inv.kind === 'sales' ? 'output' : 'input';
      (inv.lines || []).forEach((l, i) => {
        const amount = invLineTax(l);
        if (!amount) return;
        const authority = documentAuthority(inv, kind);
        entries.push({id: 'TE-' + inv.id + '-' + i, date: inv.date, document: inv.id, docKind: inv.kind, party: inv.party, kind, authority: authority.id, authorityName: authority.name, base: invLineNet(l), rate: l.tax, amount, period: inv.date.slice(0, 7)});
      });
      (inv.withholding || []).forEach((w, i) => {
        if (!w.rate) return;
        const amount = whtAmount(w, totals);
        if (!amount) return;
        const k = w.type === 'advance_sales' ? 'advance_sales' : w.type === 'advance' || w.type === 'advance_income' ? 'advance_income' : w.type === 'sales' || w.type === 'withholding_sales' ? 'withholding_sales' : 'withholding_income';
        const auth = (TAX_AUTHORITIES.find((a) => a.id === inv.taxAuthority && authorityHas(a, k))) || defaultAuthorityFor(k);
        entries.push({id: 'TE-' + inv.id + '-W' + i, date: inv.date, document: inv.id, docKind: inv.kind, party: inv.party, kind: k, authority: auth.id, authorityName: auth.name, base: totals.net, rate: w.rate === 'custom' ? 'custom' : w.rate, amount, period: inv.date.slice(0, 7)});
      });
    });
    fixture(getCompany()).forEach((d) => {
      if (d.subtype !== 'Invoice' && d.subtype !== 'Bill') return;
      const sale = d.subtype === 'Invoice';
      const kind = sale ? 'output' : 'input';
      const authority = TAX_AUTHORITIES.find((a) => a.id === TAX_FIXTURE_AUTHORITIES[kind]) || defaultAuthorityFor(kind);
      const taxLine = d.lines.find((l) => l.account === (sale ? '2200' : '1300'));
      const base = round2(d.lines.filter((l) => (sale ? String(l.account).startsWith('4') : String(l.account).startsWith('5'))).reduce((n, l) => n + (sale ? num(l.credit) - num(l.debit) : num(l.debit) - num(l.credit)), 0));
      const amount = round2(taxLine ? (sale ? num(taxLine.credit) - num(taxLine.debit) : num(taxLine.debit) - num(taxLine.credit)) : 0);
      if (amount) entries.push({id: 'TE-' + d.id, date: d.date, document: d.id, docKind: sale ? 'sales' : 'purchase', party: d.party, kind, authority: authority.id, authorityName: authority.name, base, rate: base ? round2(amount / base * 100) : 0, amount, period: d.date.slice(0, 7)});
      d.lines.forEach((l, i) => {
        const map = {'1400': 'advance_income', '1024': 'advance_sales', '2150': 'withholding_income', '2210': 'withholding_sales'};
        if (!map[l.account]) return;
        const amt = round2(sale ? num(l.debit) - num(l.credit) : num(l.credit) - num(l.debit));
        if (!amt) return;
        const whtAuth = TAX_AUTHORITIES.find((a) => a.id === TAX_FIXTURE_AUTHORITIES[map[l.account]]) || defaultAuthorityFor(map[l.account]); entries.push({id: 'TE-' + d.id + '-W' + i, date: d.date, document: d.id, docKind: sale ? 'sales' : 'purchase', party: d.party, kind: map[l.account], authority: whtAuth.id, authorityName: whtAuth.name, base: amt, rate: 'custom', amount: amt, period: d.date.slice(0, 7)});
      });
    });
    RETURNS.sales.concat(RETURNS.purchase).forEach((r) => {
      const sale = r.id.startsWith('SR-');
      const kind = sale ? 'output' : 'input';
      const authority = documentAuthority(r, kind);
      const rate = r.net ? round2((r.tax / r.net) * 100) : 0;
      entries.push({id: 'TE-' + r.id, date: r.date, document: r.id, docKind: sale ? 'sales-return' : 'purchase-return', party: r.party, kind, authority: authority.id, authorityName: authority.name, base: r.net, rate, amount: -round2(r.tax), period: r.date.slice(0, 7)});
    });
    TAX_RECONCILIATIONS.forEach((r) => {
      const authority = TAX_AUTHORITIES.find((a) => a.id === r.authority) || {name: '—'};
      entries.push({id: 'TE-' + r.id, date: r.date, document: r.id, docKind: 'adjustment', party: r.party, kind: r.kind, authority: r.authority, authorityName: authority.name, base: 0, rate: 'adjustment', amount: r.direction === 'decrease' ? -r.amount : r.amount, period: r.date.slice(0, 7)});
    });
    return entries.sort((a, b) => b.date.localeCompare(a.date) || b.id.localeCompare(a.id));
  }
  function taxAuthoritiesPanel() {
    const entries = taxEntries();
    const kind = TAX_AUTH_TAB;
    const f = TAX_AUTH_FILTER;
    const all = TAX_AUTHORITIES.filter((a) => authorityHas(a, kind)).map((a) => {
      const mine = entries.filter((e) => e.kind === kind && e.authority === a.id && (!f.asof || e.date <= f.asof));
      return {...a, count: mine.length, base: round2(mine.reduce((n, e) => n + Number(e.base || 0), 0)), tax: round2(mine.reduce((n, e) => n + Number(e.amount || 0), 0))};
    });
    const searched = all.filter((a) => !f.q || (a.name + ' ' + a.registration + ' ' + (a.jurisdiction || '') + ' ' + a.frequency).toLowerCase().includes(f.q.toLowerCase()));
    const rows = taxSortRows(taxFilterRows(searched, f), f);
    const cols = [['name', 'Authority'], ['registration', 'Registration'], ['jurisdiction', 'Jurisdiction'], ['frequency', 'Frequency'], ['count', 'Entries', 'numeric', false], ['base', 'Taxable base', 'numeric', false], ['tax', 'Tax balance', 'numeric', false]];
    const control = taxControlAccount(kind);
    const controlName = (accounts().find((a) => a.code === control) || {}).name || 'Unknown account';
    return `<div class="tabs" role="tablist" aria-label="Authority tax kinds">${TAX_KINDS.map(([k, label]) => `<button type="button" role="tab" aria-selected="${kind === k}" data-tax-auth-kind="${k}">${label}</button>`).join('')}</div>
      <form class="filterbar" data-tax-auth-filter>
        <label>Search<input type="search" name="q" value="${e(f.q)}" placeholder="Authority, registration, jurisdiction"></label>
        <label>Balances as at<input type="date" name="asof" value="${e(f.asof)}"></label>
        <button class="button" type="button" data-tax-auth-reset>Reset</button>
        <button class="button primary" type="button" data-tax-auth-new>New authority</button>
      </form>
      <section class="panel"><div class="panel-head"><h2>${e(taxKindLabel(kind))} authorities</h2><div class="related"><span class="badge">Control ${e(control)} · ${e(controlName)}</span><span class="badge">${rows.length} of ${all.length} authorities</span><button class="button" data-export-table>Export CSV</button></div></div>
      <div class="table-scroll"><table class="tax-register">
        ${taxTableHead('taxauth', f, cols, all)}
        <tbody>${rows.map((a) => `<tr class="row-link" data-tax-auth-open="${e(a.id)}"><td>${e(a.name)}${a.active === false ? ' · archived' : ''}</td><td class="mono">${e(a.registration)}</td><td>${e(a.jurisdiction || '—')}</td><td>${e(a.frequency)}</td><td class="numeric">${a.count}</td><td class="numeric">${money(a.base)}</td><td class="numeric">${money(a.tax)}</td></tr>`).join('') || '<tr><td colspan="7">No authority for this kind.</td></tr>'}</tbody>
      <tfoot><tr><td colspan="4">Total</td><td class="numeric">${rows.reduce((n, a) => n + a.count, 0)}</td><td class="numeric">${money(round2(rows.reduce((n, a) => n + a.base, 0)))}</td><td class="numeric">${money(round2(rows.reduce((n, a) => n + a.tax, 0)))}</td></tr></tfoot></table></div>
      <div class="table-footer">An authority can serve several tax natures; it appears in every tab it is assigned to. Balance is the sum of tax entries up to the chosen date. These authority balances add up to the nature's control account; the Parties tab shows the same entries by party. Click a row to edit the authority.</div></section>`;
  }
  function taxAuthorityEditor(code) {
    const a = code ? TAX_AUTHORITIES.find((x) => x.id === code) : null;
    const v = (k, d = '') => (a && a[k] !== undefined ? a[k] : d);
    return `<section class="panel">
      <div class="panel-head"><h2>${a ? e(a.name) : 'New tax authority'}</h2><span class="badge">Global register</span></div>
      <form data-tax-authority-form class="panel-body form-grid">
        <input type="hidden" name="editingId" value="${e(a ? a.id : '')}">
        <label>Name<input name="name" required maxlength="70" value="${e(v('name'))}" placeholder="FBR"></label>
        <label>Jurisdiction<input name="jurisdiction" maxlength="60" value="${e(v('jurisdiction'))}" placeholder="Federal, Sindh, Dubai"></label>
        <label>Registration<input name="registration" maxlength="40" value="${e(v('registration'))}" placeholder="STRN / VAT number"></label>
        <label>Filing frequency<select name="frequency" class="inline-input">${['Monthly', 'Quarterly', 'Yearly', 'On demand'].map((x) => `<option ${v('frequency', 'Monthly') === x ? 'selected' : ''}>${x}</option>`).join('')}</select></label>
        <label>Status<select name="status" class="inline-input"><option ${v('active', true) ? 'selected' : ''}>Active</option><option ${v('active', true) ? '' : 'selected'}>Archived</option></select></label>
        <div class="wide"><span class="ms-label">Applies to tax natures</span><div class="checkgrid" data-auth-kinds>${TAX_KINDS.map(([k, l]) => `<label class="checkgrid-row"><input type="checkbox" value="${k}" ${(v('kinds', []) || []).includes(k) ? 'checked' : ''}><span>${l}</span></label>`).join('')}</div></div>
        <div class="related"><button class="button primary">${a ? 'Save changes' : 'Add authority'}</button><button type="button" class="button" data-tax-authority-cancel>Cancel</button></div>
      </form>
      <div class="panel-body"><p class="form-note">One authority can cover all six natures or only some. Authorities are sub-accounts of the tax-nature control. The default authority per nature is set under Default accounts; invoices and bills can override it.</p></div>
    </section>`;
  }
  function taxEntriesPanel() {
    const f = TAX_ENTRY_FILTER;
    const all = taxEntries().map((e) => ({...e, kindLabel: taxKindLabel(e.kind), authorityLabel: e.authorityName || '—', rateLabel: e.rate === 'custom' ? 'Custom' : e.rate === 'adjustment' ? 'Adjustment' : e.rate + '%'}));
    const searched = all.filter((e) => (!f.q || (e.document + ' ' + e.party + ' ' + e.authorityLabel).toLowerCase().includes(f.q.toLowerCase()))
      && (!f.from || e.date >= f.from) && (!f.to || e.date <= f.to));
    const rows = taxSortRows(taxFilterRows(searched, f), f);
    const cols = [['date', 'Date', '', false], ['document', 'Document'], ['party', 'Party'], ['kindLabel', 'Kind'], ['authorityLabel', 'Authority'], ['base', 'Taxable base', 'numeric', false], ['rateLabel', 'Rate'], ['amount', 'Tax', 'numeric', false], ['period', 'Period']];
    return `<form class="filterbar" data-tax-entry-filter>
        <label>Search<input type="search" name="q" value="${e(f.q)}" placeholder="Document, party, authority"></label>
        <label>From<input type="date" name="from" value="${e(f.from)}"></label>
        <label>To<input type="date" name="to" value="${e(f.to)}"></label>
        <button class="button" type="button" data-tax-entry-reset>Reset</button>
      </form>
      <section class="panel"><div class="panel-head"><h2>Tax entries</h2><div class="related"><span class="badge">${rows.length} of ${all.length} entries</span><button class="button" data-export-table>Export CSV</button></div></div>
      <div class="table-scroll"><table class="tax-register">
        ${taxTableHead('taxentry', f, cols, all)}
        <tbody>${rows.map((e) => `<tr class="row-link" data-tax-doc="${e.docKind}:${e.document}"><td>${e.date}</td><td class="mono">${e.document}</td><td>${e.party}</td><td>${e.kindLabel}</td><td>${e.authorityLabel}</td><td class="numeric">${e.base ? money(e.base) : '—'}</td><td class="numeric">${e.rateLabel}</td><td class="numeric">${money(e.amount)}</td><td>${e.period}</td></tr>`).join('') || '<tr><td colspan="9">No tax entries match these filters.</td></tr>'}</tbody>
      <tfoot><tr><td colspan="5">Total shown</td><td class="numeric">${money(round2(rows.reduce((n, e) => n + e.base, 0)))}</td><td></td><td class="numeric">${money(round2(rows.reduce((n, e) => n + e.amount, 0)))}</td><td></td></tr></tfoot></table></div>
      <div class="table-footer">Entries come from invoices, bills, returns and tax reconciliations; they are never typed here. Click a row to open the document that created it, or the reconciliation for an adjustment.</div></section>`;
  }
  function taxReconciliationPage() {
    const tab = TAX_RECON_TAB === 'balances' ? 'balances' : 'register';
    return `<div class="tabs" role="tablist" aria-label="Reconciliation views">
        <button type="button" role="tab" aria-selected="${tab === 'balances'}" data-tax-recon-tab="balances">Party balances</button>
        <button type="button" role="tab" aria-selected="${tab === 'register'}" data-tax-recon-tab="register">Reconciliations</button>
      </div>
      ${tab === 'balances' ? taxPartyBalancesPanel() : taxReconciliationRegisterPanel()}`;
  }
  function taxPartyBalancesPanel() {
    const f = TAX_PARTY_FILTER;
    const kind = TAX_PARTY_TAB;
    const entries = taxEntries().filter((e) => e.kind === kind);
    const map = new Map();
    entries.forEach((e) => {
      const key = e.party + '|' + e.kind;
      const row = map.get(key) || {key, party: e.party, kind: e.kind, base: 0, tax: 0, count: 0};
      row.base = round2(row.base + e.base); row.tax = round2(row.tax + e.amount); row.count++;
      map.set(key, row);
    });
    const all = [...map.values()].map((r) => ({...r, kindLabel: taxKindLabel(r.kind), status: TAX_PARTY_STATUS.get(r.key) === 'Verified' ? 'Verified' : 'Unverified'}));
    const searched = all.filter((r) => !f.q || r.party.toLowerCase().includes(f.q.toLowerCase()));
    const rows = taxSortRows(taxFilterRows(searched, f), f);
    const cols = [['party', 'Party'], ['count', 'Entries', 'numeric', false], ['base', 'Base', 'numeric', false], ['tax', 'Tax', 'numeric', false], ['status', 'Verification']];
    const totalTax = round2(rows.reduce((n, r) => n + r.tax, 0));
    const control = taxControlAccount(kind);
    const controlName = (accounts().find((a) => a.code === control) || {}).name || 'Unknown account';
    return `<div class="tabs" role="tablist" aria-label="Party balance tax natures">${TAX_KINDS.map(([k, label]) => `<button type="button" role="tab" aria-selected="${kind === k}" data-tax-party-kind="${k}">${label}</button>`).join('')}</div>
      <form class="filterbar" data-tax-party-filter>
        <label>Search<input type="search" name="q" value="${e(f.q)}" placeholder="Party"></label>
        <button class="button" type="button" data-tax-party-reset>Reset</button>
      </form>
      <section class="panel"><div class="panel-head"><h2>${e(taxKindLabel(kind))} party balances</h2><div class="related"><span class="badge">${rows.length} of ${all.length} parties</span><span class="badge">${money(totalTax)}</span><button class="button" data-export-table>Export CSV</button></div></div>
      <div class="table-scroll"><table class="tax-register">
        ${taxTableHead('taxparty', f, cols, all)}
        <tbody>${rows.map((r) => `<tr><td>${e(r.party)}</td><td class="numeric">${r.count}</td><td class="numeric">${money(r.base)}</td><td class="numeric">${money(r.tax)}</td><td><div class="status-actions">${badge(r.status, r.status === 'Verified' ? 'good' : '')}<button type="button" class="text-button" data-tax-party="${e(r.key)}">${r.status === 'Verified' ? 'Mark unverified' : 'Mark verified'}</button></div></td></tr>`).join('') || '<tr><td colspan="5">No party tax entries for this nature yet.</td></tr>'}</tbody>
        <tfoot><tr><td>Total</td><td class="numeric">${rows.reduce((n, r) => n + r.count, 0)}</td><td class="numeric">${money(round2(rows.reduce((n, r) => n + r.base, 0)))}</td><td class="numeric">${money(totalTax)}</td><td></td></tr></tfoot></table></div>
      <div class="table-footer">${e(taxKindLabel(kind))} control account: <strong>${e(control)} · ${e(controlName)}</strong>. A party balance is the net of that party's entries for this nature; the authority balance is the same entries grouped by authority; the control is the total of both. Mark a row verified or unverified. Use the Reconciliations tab to adjust a party and its authority when a claim is invalid or a filing changes.</div></section>`;
  }
  function taxReconciliationRegisterPanel() {
    const f = TAX_RECON_FILTER;
    const authorityName = (id) => (TAX_AUTHORITIES.find((a) => a.id === id) || {}).name || '—';
    const all = TAX_RECONCILIATIONS.map((r) => ({...r, kindLabel: taxKindLabel(r.kind), authorityLabel: authorityName(r.authority), offsetLabel: taxOffsetAccountLabel(legacyOffsetAccount(r)), signed: (r.direction === 'decrease' ? -1 : 1) * r.amount}));
    const searched = all.filter((r) => (!f.q || (r.id + ' ' + r.party + ' ' + r.authorityLabel + ' ' + r.reason).toLowerCase().includes(f.q.toLowerCase()))
      && (!f.from || r.date >= f.from) && (!f.to || r.date <= f.to));
    const rows = taxSortRows(taxFilterRows(searched, f), f);
    const cols = [['date', 'Date', '', false], ['id', 'Reference'], ['kindLabel', 'Nature'], ['party', 'Party'], ['authorityLabel', 'Authority'], ['signed', 'Amount', 'numeric', false], ['offsetLabel', 'Offset'], ['reason', 'Reason']];
    return `<form class="filterbar" data-tax-recon-filter>
        <label>Search<input type="search" name="q" value="${e(f.q)}" placeholder="Reference, party, authority, reason"></label>
        <label>From<input type="date" name="from" value="${e(f.from)}"></label>
        <label>To<input type="date" name="to" value="${e(f.to)}"></label>
        <button class="button" type="button" data-tax-recon-reset>Reset</button>
        <button class="button primary" type="button" data-tax-recon-new>New reconciliation</button>
      </form>
      <section class="panel"><div class="panel-head"><h2>Tax reconciliations</h2><div class="related"><span class="badge">${rows.length} of ${all.length} adjustments</span><button class="button" data-export-table>Export CSV</button></div></div>
      <div class="table-scroll"><table class="recon-register tax-register">
        ${taxTableHead('taxrecon', f, cols, all)}
        <tbody>${rows.map((r) => {
          const open = TAX_RECON_OPEN.has(r.id);
          const entry = r.entry || taxAdjustmentEntry(r.kind, r.party, r.direction, r.amount, legacyOffsetAccount(r), r.authority);
          const detail = open ? `<tr class="entry-detail"><td colspan="8">${ledgerIllustration('Adjustment ' + r.id, entry, 'A separate voucher: the tax control line carries authority ' + authorityName(r.authority) + '; both lines carry party ' + r.party + '. The original document and its tax entry are unchanged.')}</td></tr>` : '';
          return `<tr class="row-link" data-tax-recon-toggle="${e(r.id)}" aria-expanded="${open}"><td>${r.date}</td><td class="mono">${r.id}</td><td>${e(r.kindLabel)}</td><td>${e(r.party)}</td><td>${e(r.authorityLabel)}</td><td class="numeric" title="${r.direction === 'decrease' ? 'Decrease' : 'Increase'}">${r.direction === 'decrease' ? '−' : '+'}${money(r.amount)}</td><td>${e(r.offsetLabel)}</td><td>${e(r.reason)}</td></tr>${detail}`;
        }).join('') || '<tr><td colspan="8">No tax reconciliations yet. Use New reconciliation to record one.</td></tr>'}</tbody></table></div>
      <div class="table-footer">A reconciliation adjusts the party and the authority sub-account without editing the original invoice or bill. Click a row to show or hide its debit and credit entry. The form opens on its own page.</div></section>`;
  }
  function taxReconciliationEditor(code) {
    const r = code ? TAX_RECONCILIATIONS.find((x) => x.id === code) : null;
    const v = (key, fallback = '') => (r && r[key] !== undefined ? r[key] : fallback);
    const defaultKind = v('kind', 'input');
    const defaultAuth = v('authority', TAX_DEFAULT_AUTHORITIES[defaultKind] || '');
    const offsetAccount = v('offsetAccount', r ? legacyOffsetAccount(r) : suggestedOffsetAccount(defaultKind));
    const accountOptions = accounts().filter((a) => a.active !== false).map((a) => `<option value="${a.code}" ${a.code === offsetAccount ? 'selected' : ''}>${a.code} · ${e(a.name)}</option>`).join('');
    return `<section class="panel">
      <div class="panel-head"><h2>${r ? e(r.id) : 'New tax reconciliation'}</h2><span class="badge">Adjustment voucher</span></div>
      <form class="panel-body form-grid" data-tax-recon-form data-editing="${r ? e(r.id) : ''}">
        <label>Tax nature<select name="kind" class="inline-input">${TAX_KINDS.map(([k, l]) => `<option value="${k}" ${defaultKind === k ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
        <label>Authority<select name="authority" class="inline-input"><option value="">Choose authority</option>${TAX_AUTHORITIES.map((a) => `<option value="${e(a.id)}" ${defaultAuth === a.id ? 'selected' : ''}>${e(a.name)} · ${(a.kinds || []).map(taxKindLabel).join(', ')}</option>`).join('')}</select></label>
        <label>Party<select name="party" class="inline-input" required><option value="">Choose party</option>${PARTIES.map((p) => `<option value="${e(p.name)}" ${v('party') === p.name ? 'selected' : ''}>${e(p.name)} · ${e(p.code)}</option>`).join('')}</select></label>
        <label>Date<input name="date" type="date" value="${e(v('date', '2026-11-30'))}" required></label>
        <label>Direction<select name="direction" class="inline-input"><option value="decrease" ${v('direction', 'decrease') === 'decrease' ? 'selected' : ''}>Decrease the tax balance</option><option value="increase" ${v('direction') === 'increase' ? 'selected' : ''}>Increase the tax balance</option></select></label>
        <label>Amount<input name="amount" inputmode="decimal" placeholder="0.00" value="${e(v('amount'))}" required></label>
        <label class="wide">Reason<input name="reason" maxlength="100" value="${e(v('reason'))}" placeholder="Supplier default, rejected claim, filing correction" required></label>
        <div class="wide recon-target">
          <div class="section-title">Tax balance being adjusted</div>
          <div class="record-summary">
            <div><small>Control account</small><strong data-recon-control>—</strong></div>
            <div><small>Party</small><span data-recon-party>Choose party</span></div>
            <div><small>Authority</small><span data-recon-authority>Choose authority</span></div>
          </div>
        </div>
        <label class="wide">Offset account<select name="offsetAccount" class="inline-input" required>${accountOptions}</select><small class="secondary">The other side of the voucher. Search by code or name; any active account is allowed, but not the tax control itself.</small></label>
        <div class="wide" data-tax-recon-preview></div>
        <div class="related"><button class="button primary">${r ? 'Save changes' : 'Record adjustment'}</button><button type="button" class="button" data-form-cancel>Cancel</button></div>
      </form>
      <div class="panel-body"><p class="form-note">The tax side is fixed by the nature: its control account, the selected party and the selected authority. The offset account is where the debit or credit lands. The voucher never edits the source document.</p></div>
    </section>`;
  }
  function taxesView() {
    const current = TAX_TABS.some(([k]) => k === TAX_ACTIVE) ? TAX_ACTIVE : 'rules';
    return `<div class="tabs" role="tablist" aria-label="Tax views">${TAX_TABS.map(([id, label]) => `<button role="tab" aria-selected="${current === id}" data-tax-tab="${id}">${label}</button>`).join('')}</div>
      <div id="tax-panel">${taxPanel(current)}</div>`;
  }
  function bindTaxes(rerender, notify, navigate) {
    const goRules = () => navigate({module: 'tax', tab: 'rules'});
    const goRecon = () => navigate({module: 'tax', tab: 'reconciliation'});
    document.querySelectorAll('[data-tax-tab]').forEach((btn) => btn.addEventListener('click', () => {
      TAX_ACTIVE = btn.dataset.taxTab;
      rerender();
    }));
    document.querySelectorAll('[data-edit]').forEach((b) => b.addEventListener('click', () => {
      const [type, code] = b.dataset.edit.split(':');
      if (type !== 'tax') return;
      navigate({module: 'tax', tab: 'rules', mode: 'editor', code});
    }));
    const ruleFilter = document.querySelector('[data-tax-rule-filter]');
    if (ruleFilter) {
      let timer = 0;
      ruleFilter.addEventListener('input', (ev) => {
        TAX_RULE_FILTER.q = ev.target.value;
        clearTimeout(timer); timer = setTimeout(() => rerender(), 150);
      });
    }
    document.querySelector('[data-tax-rule-reset]')?.addEventListener('click', () => { Object.assign(TAX_RULE_FILTER, {q: '', cf: {}}); rerender(); });
    bindTaxColumnMenus('taxrule', TAX_RULE_FILTER, rerender);
    document.querySelector('[data-tax-form] [data-form-cancel]')?.addEventListener('click', goRules);
    const scopeSel = document.querySelector('[data-tax-form] [name="scopeType"]');
    if (scopeSel) {
      const groupsBox = document.querySelector('.ms[data-ms="tax-groups"]');
      const itemsBox = document.querySelector('.ms[data-ms="tax-items"]');
      const syncScope = () => {
        const mode = scopeSel.value;
        if (groupsBox) groupsBox.classList.toggle('scope-off', mode !== 'groups');
        if (itemsBox) itemsBox.classList.toggle('scope-off', mode !== 'items');
      };
      scopeSel.addEventListener('change', syncScope);
      syncScope();
    }
    const ruleForm = document.querySelector('[data-tax-form]');
    ruleForm?.addEventListener('input', () => { const box = ruleForm.querySelector('[data-tax-rule-conflict]'); if (box) { box.hidden = true; box.innerHTML = ''; } });
    ruleForm?.addEventListener('change', () => { const box = ruleForm.querySelector('[data-tax-rule-conflict]'); if (box) { box.hidden = true; box.innerHTML = ''; } });
    document.querySelectorAll('[data-tax-auth-kind]').forEach((b) => b.addEventListener('click', () => { TAX_AUTH_TAB = b.dataset.taxAuthKind; rerender(); }));
    const af = document.querySelector('[data-tax-auth-filter]');
    if (af) {
      const apply = () => {
        const v = Object.fromEntries(new FormData(af));
        TAX_AUTH_FILTER.q = v.q || '';
        TAX_AUTH_FILTER.asof = v.asof || '';
      };
      af.addEventListener('input', (ev) => { apply(); if (ev.target.type === 'search') { clearTimeout(af._t); af._t = setTimeout(() => rerender(), 150); } });
      af.addEventListener('change', () => { apply(); rerender(); });
    }
    document.querySelector('[data-tax-auth-reset]')?.addEventListener('click', () => { Object.assign(TAX_AUTH_FILTER, {q: '', asof: '', cf: {}}); rerender(); });
    document.querySelector('[data-tax-auth-new]')?.addEventListener('click', () => navigate({module: 'tax', tab: 'authorities', mode: 'editor', form: 'authority', code: ''}));
    document.querySelectorAll('[data-tax-auth-open]').forEach((tr) => tr.addEventListener('click', (ev) => { if (ev.target.closest('button')) return; navigate({module: 'tax', tab: 'authorities', mode: 'editor', form: 'authority', code: tr.dataset.taxAuthOpen}); }));
    bindTaxColumnMenus('taxauth', TAX_AUTH_FILTER, rerender);
    const authorityForm = document.querySelector('[data-tax-authority-form]');
    authorityForm?.querySelector('[data-tax-authority-cancel]')?.addEventListener('click', () => navigate({module: 'tax', tab: 'authorities'}));
    authorityForm?.addEventListener('submit', (ev) => {
      ev.preventDefault();
      if (!authorityForm.reportValidity()) return;
      const v = Object.fromEntries(new FormData(authorityForm));
      const kinds = [...authorityForm.querySelectorAll('[data-auth-kinds] input:checked')].map((b) => b.value);
      if (!kinds.length) { notify('Choose at least one tax nature for the authority.'); return; }
      const editing = v.editingId || '';
      if (editing) {
        const target = TAX_AUTHORITIES.find((a) => a.id === editing);
        if (target) Object.assign(target, {name: v.name, jurisdiction: v.jurisdiction || '', registration: v.registration || '', frequency: v.frequency, kinds, active: v.status === 'Active'});
        notify('Tax authority updated for this session.');
      } else {
        TAX_AUTHORITIES.push({id: 'AUTH-' + String(TAX_AUTH_SEQ++), name: v.name, jurisdiction: v.jurisdiction || '', registration: v.registration || '', frequency: v.frequency, kinds, active: v.status === 'Active'});
        notify('Tax authority added for this session.');
      }
      navigate({module: 'tax', tab: 'authorities'});
    });
    const ef = document.querySelector('[data-tax-entry-filter]');
    if (ef) {
      const apply = () => {
        const v = Object.fromEntries(new FormData(ef));
        TAX_ENTRY_FILTER.q = v.q || '';
        TAX_ENTRY_FILTER.from = v.from || '';
        TAX_ENTRY_FILTER.to = v.to || '';
      };
      let timer = 0;
      ef.addEventListener('input', (ev) => {
        apply();
        if (ev.target.matches('input[type="search"], input[type="text"]')) { clearTimeout(timer); timer = setTimeout(() => rerender(), 150); return; }
        rerender();
      });
      ef.addEventListener('change', () => { apply(); rerender(); });
    }
    document.querySelector('[data-tax-entry-reset]')?.addEventListener('click', () => { Object.assign(TAX_ENTRY_FILTER, {q: '', from: '', to: '', cf: {}}); rerender(); });
    document.querySelectorAll('[data-tax-doc]').forEach((tr) => tr.addEventListener('click', () => {
      const [kind, id] = tr.dataset.taxDoc.split(':');
      if (kind === 'sales-return' || kind === 'purchase-return') {
        INV_TAB[kind.startsWith('sales') ? 'sales' : 'purchase'] = 'returns';
        navigate({module: 'accounting', tab: kind.startsWith('sales') ? 'sales-invoices' : 'purchase-invoices'});
        return;
      }
      if (kind === 'adjustment') {
        TAX_RECON_OPEN.add(id);
        TAX_RECON_TAB = 'register';
        navigate({module: 'tax', tab: 'reconciliation'});
        return;
      }
      navigate({module: 'accounting', tab: kind === 'sales' ? 'sales-invoices' : 'purchase-invoices', mode: 'editor', form: 'invoice', code: id});
    }));
    bindTaxColumnMenus('taxentry', TAX_ENTRY_FILTER, rerender);
    document.querySelectorAll('[data-tax-recon-tab]').forEach((b) => b.addEventListener('click', () => {
      TAX_RECON_TAB = b.dataset.taxReconTab;
      rerender();
      try { window.scrollTo({top: 0, behavior: 'auto'}); } catch {}
    }));
    document.querySelectorAll('[data-tax-party-kind]').forEach((b) => b.addEventListener('click', () => {
      TAX_PARTY_TAB = b.dataset.taxPartyKind;
      rerender();
    }));
    const pf = document.querySelector('[data-tax-party-filter]');
    if (pf) {
      let timer = 0;
      pf.addEventListener('input', (ev) => {
        TAX_PARTY_FILTER.q = ev.target.value;
        clearTimeout(timer); timer = setTimeout(() => rerender(), 150);
      });
    }
    document.querySelector('[data-tax-party-reset]')?.addEventListener('click', () => { Object.assign(TAX_PARTY_FILTER, {q: '', cf: {}}); rerender(); });
    bindTaxColumnMenus('taxparty', TAX_PARTY_FILTER, rerender);
    const rf = document.querySelector('[data-tax-recon-filter]');
    if (rf) {
      const apply = () => {
        const v = Object.fromEntries(new FormData(rf));
        TAX_RECON_FILTER.q = v.q || '';
        TAX_RECON_FILTER.from = v.from || '';
        TAX_RECON_FILTER.to = v.to || '';
      };
      let timer = 0;
      rf.addEventListener('input', (ev) => {
        apply();
        if (ev.target.matches('input[type="search"], input[type="text"]')) { clearTimeout(timer); timer = setTimeout(() => rerender(), 150); return; }
        rerender();
      });
      rf.addEventListener('change', () => { apply(); rerender(); });
    }
    document.querySelector('[data-tax-recon-reset]')?.addEventListener('click', () => { Object.assign(TAX_RECON_FILTER, {q: '', from: '', to: '', cf: {}}); rerender(); });
    document.querySelector('[data-tax-recon-new]')?.addEventListener('click', () => navigate({module: 'tax', tab: 'reconciliation', mode: 'editor', form: 'reconciliation', code: ''}));
    bindTaxColumnMenus('taxrecon', TAX_RECON_FILTER, rerender);
    document.querySelectorAll('[data-tax-recon-toggle]').forEach((tr) => tr.addEventListener('click', (ev) => {
      if (ev.target.closest('button, a, input, select')) return;
      const id = tr.dataset.taxReconToggle;
      if (TAX_RECON_OPEN.has(id)) TAX_RECON_OPEN.delete(id); else TAX_RECON_OPEN.add(id);
      rerender();
    }));
    document.querySelectorAll('[data-tax-party]').forEach((b) => b.addEventListener('click', () => {
      const key = b.dataset.taxParty;
      TAX_PARTY_STATUS.set(key, TAX_PARTY_STATUS.get(key) === 'Verified' ? 'Unverified' : 'Verified');
      rerender();
    }));
    const reconForm = document.querySelector('[data-tax-recon-form]');
    if (reconForm) {
      const preview = () => {
        const v = Object.fromEntries(new FormData(reconForm));
        const box = reconForm.querySelector('[data-tax-recon-preview]');
        if (!box) return;
        const control = taxControlAccount(v.kind);
        const controlAccount = accounts().find((a) => a.code === control);
        const authority = TAX_AUTHORITIES.find((a) => a.id === v.authority);
        const controlLabel = control + ' · ' + (controlAccount ? controlAccount.name : 'Unknown account');
        const target = reconForm.querySelector('[data-recon-control]');
        if (target) target.textContent = controlLabel;
        const partyLabel = reconForm.querySelector('[data-recon-party]');
        if (partyLabel) partyLabel.textContent = v.party || 'Choose party';
        const authLabel = reconForm.querySelector('[data-recon-authority]');
        if (authLabel) authLabel.textContent = authority ? authority.name : 'Choose authority';
        const amount = round2(Number(v.amount) || 0);
        if (!amount) {
          box.innerHTML = ledgerIllustration('Illustrative adjustment entry', [], 'Choose the nature, party, amount and offset account to see the debit and credit.');
          return;
        }
        const entry = taxAdjustmentEntry(v.kind, v.party, v.direction, amount, v.offsetAccount, v.authority);
        const taxLine = entry[0];
        const offsetLine = entry[1];
        const taxSide = taxLine.debit ? 'debited' : 'credited';
        const offsetSide = offsetLine.debit ? 'debit' : 'credit';
        box.innerHTML = ledgerIllustration('Illustrative adjustment entry', entry, `The tax control (${controlLabel}) is ${taxSide} ${money(amount)} with authority ${authority ? authority.name : '—'}. The offset account takes the ${offsetSide} and carries the party.`);
      };
      reconForm.addEventListener('input', preview);
      reconForm.addEventListener('change', (ev) => {
        if (ev.target.name === 'kind') {
          const kind = ev.target.value;
          const auth = reconForm.querySelector('[name="authority"]');
          const current = TAX_AUTHORITIES.find((a) => a.id === auth.value);
          if (!current || !authorityHas(current, kind)) { auth.value = TAX_DEFAULT_AUTHORITIES[kind] || ''; auth.dispatchEvent(new Event('change', {bubbles: true})); }
          const offset = reconForm.querySelector('[name="offsetAccount"]');
          if (!offset.value || offset.value === '5300' || offset.value === '4200') {
            offset.value = suggestedOffsetAccount(kind);
            offset.dispatchEvent(new Event('change', {bubbles: true}));
          }
        }
        preview();
      });
      preview();
      reconForm.querySelector('[data-form-cancel]')?.addEventListener('click', goRecon);
      reconForm.addEventListener('submit', (ev) => {
        ev.preventDefault();
        if (!reconForm.reportValidity()) return;
        const v = Object.fromEntries(new FormData(reconForm));
        const amount = round2(Number(v.amount) || 0);
        if (amount <= 0) { notify('Enter an amount greater than zero.'); return; }
        if (!v.authority) { notify('Choose the tax authority.'); return; }
        const auth = TAX_AUTHORITIES.find((a) => a.id === v.authority);
        if (auth && !authorityHas(auth, v.kind)) { notify('That authority does not handle this tax nature.'); return; }
        const offset = accounts().find((a) => a.code === v.offsetAccount && a.active !== false);
        if (!offset) { notify('Choose an active offset account.'); return; }
        if (v.offsetAccount === taxControlAccount(v.kind)) { notify('The offset account must be different from the tax control account.'); return; }
        const entry = taxAdjustmentEntry(v.kind, v.party, v.direction, amount, v.offsetAccount, v.authority);
        const editing = reconForm.dataset.editing || '';
        const record = TAX_RECONCILIATIONS.find((x) => x.id === editing);
        const id = record ? record.id : 'TXR-2026-' + String(TAX_RECON_SEQ++).padStart(4, '0');
        const values = {id, date: v.date, kind: v.kind, authority: v.authority, party: v.party, direction: v.direction, amount, offsetAccount: v.offsetAccount, reason: v.reason, entry};
        if (record) Object.assign(record, values); else TAX_RECONCILIATIONS.push(values);
        TAX_RECON_OPEN.add(id);
        TAX_RECON_TAB = 'register';
        notify('Tax reconciliation recorded. The entry moves the party and authority balances together; the source document is unchanged.');
        goRecon();
      });
    }
    document.querySelector('[data-tax-defaults]')?.addEventListener('submit', (ev) => {
      ev.preventDefault();
      const v = Object.fromEntries(new FormData(ev.target));
      const next = {...TAX_DEFAULTS};
      TAX_KINDS.forEach(([kind]) => {
        next[taxNatureMeta(kind).defaultKey] = v[kind];
        TAX_DEFAULT_AUTHORITIES[kind] = v[kind + 'Authority'] || '';
      });
      TAX_DEFAULTS = next;
      notify('Default tax accounts and authorities saved for this session.');
      rerender();
    });
    document.querySelector('[data-tax-calc]')?.addEventListener('submit', (ev) => {
      ev.preventDefault();
      const v = Object.fromEntries(new FormData(ev.target));
      TAX_AFTER_DISCOUNT = v.afterDiscount !== 'no';
      notify(TAX_AFTER_DISCOUNT ? 'Tax will be calculated after discounts.' : 'Tax will be calculated on the original amount.');
      rerender();
    });
    document.querySelector('[data-tax-form]')?.addEventListener('submit', (ev) => {
      ev.preventDefault();
      const form = ev.target;
      if (!form.reportValidity()) return;
      const v = Object.fromEntries(new FormData(form));
      const editingCode = v.editingCode || '';
      const box = (n) => form.querySelector(`.ms[data-ms="${n}"]`);
      const groups = box('tax-groups') ? picked(box('tax-groups')) : [];
      const items = box('tax-items') ? picked(box('tax-items')) : [];
      const scopeType = ['all', 'groups', 'items'].includes(v.scopeType) ? v.scopeType : 'all';
      if (scopeType === 'groups' && !groups.length) { notify('Choose at least one item group, or use All items.'); return; }
      if (scopeType === 'items' && !items.length) { notify('Choose at least one item, or use All items.'); return; }
      const code = editingCode || nextTaxRuleCode();
      const record = {code, name: v.name, kind: v.kind, rate: Number(v.rate), basis: 'exclusive', scopeType, groups: scopeType === 'groups' ? groups : [], group: scopeType === 'groups' ? (groups[0] || '') : '', items: scopeType === 'items' ? items : [], scope: scopeType, scopeValue: '', from: v.from, to: v.to || '', status: v.status || 'Active', override: v.override || 'yes', description: v.description || '', projects: box('tax-projects') ? picked(box('tax-projects')) : [], locations: box('tax-locations') ? picked(box('tax-locations')) : []};
      const conflicts = taxRuleConflicts(record, editingCode);
      if (conflicts.length) {
        const message = ruleConflictMessage(conflicts);
        const conflictBox = form.querySelector('[data-tax-rule-conflict]');
        if (conflictBox) { conflictBox.hidden = false; conflictBox.innerHTML = `<div class="callout callout--error"><strong>Conflicting tax rule</strong><p>${e(message)}</p></div>`; }
        notify(message);
        return;
      }
      if (editingCode) {
        const target = TAX_RULES.find((r) => r.code === editingCode);
        if (target) Object.assign(target, record);
        notify('Tax rule updated for this session.');
      } else {
        TAX_RULES.push(record);
        TAX_RULE_SEQ++;
        notify(`Tax rule ${code} added for this session.`);
      }
      goRules();
    });
  }

  /* ------------------------------------------------------------ reports */
  const REPORT_TABS = [['ageing', 'Ageing'], ['trial', 'Trial balance'], ['profit', 'Profit & loss'], ['position', 'Financial position'], ['cashflow', 'Cash flow'], ['equity', 'Equity']];
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
    const body = current === 'trial' ? (trialView ? trialView() : '') : current === 'profit' ? reportProfit() : current === 'position' ? reportPosition() : current === 'cashflow' ? reportCashflow() : current === 'equity' ? reportEquity() : ageing();
    return `<div class="tabs" role="tablist" aria-label="Report views">${REPORT_TABS.map(([id, label]) => `<button role="tab" aria-selected="${current === id}" data-report-tab="${id}">${label}</button>`).join('')}</div>
      <div id="report-panel">${body}</div>`;
  }

  function bindReports(rerender) {
    document.querySelectorAll('[data-report-tab]').forEach((b) => b.addEventListener('click', () => {
      REPORT_TAB = b.dataset.reportTab;
      rerender();
      document.querySelectorAll('[data-rev-tab]').forEach((b) => b.addEventListener('click', () => {
      REV_TAB = b.dataset.revTab;
      rerender();
    }));
  }));
    document.querySelectorAll('[data-rev-tab]').forEach((b) => b.addEventListener('click', () => {
      REV_TAB = b.dataset.revTab;
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
  const SETTINGS_TABS = [['company', 'Company'], ['accounting', 'Accounting'], ['inventory', 'Inventory'], ['manufacturing', 'Manufacturing'], ['people', 'People & access'], ['periods', 'Periods'], ['forms', 'Forms & fields'], ['views', 'Saved views'], ['print', 'Print & templates']];
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
        <label>Accounting group<select name="group" class="inline-input">${ACCOUNT_GROUPS.map((g) => `<option value="${e(g.name)}" ${g.name === (v('group') || (ACCOUNT_GROUPS.find((x) => x.class === v('type', 'expense')) || {}).name) ? 'selected' : ''}>${e((ACCOUNT_CLASSES.find(([k]) => k === g.class) || [g.class, g.class])[1])} · ${e(g.name)}</option>`).join('')}</select></label>
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

  function accountGroupsView() {
    const groups = ACCOUNT_GROUPS.slice().sort((a, b) => a.class.localeCompare(b.class) || a.code.localeCompare(b.code));
    const classLabel = (c) => (ACCOUNT_CLASSES.find(([k]) => k === c) || [c, c])[1];
    return `<section class="panel">
      <div class="panel-head"><h2>Accounting groups</h2><div class="related"><span class="badge">${groups.length} groups</span><button class="button" data-ac="new-group-page">New group</button></div></div>
      <div class="table-scroll"><table><thead><tr><th>Class</th><th>Group no</th><th>Name</th><th>Description</th><th class="numeric">Accounts</th><th>Status</th><th></th></tr></thead>
      <tbody>${groups.map((g) => `<tr class="row-link" data-ac="open-group" data-value="${e(g.id)}"><td>${e(classLabel(g.class))}</td><td class="mono">${e(g.code)}</td><td>${e(g.name)}</td><td>${e(g.description || '')}</td><td class="numeric">${accounts().filter((a) => accountGroupFor(a) === g.name).length}</td><td>${badge(g.active ? 'Active' : 'Archived', g.active ? 'good' : 'warn')}</td><td class="row-go">›</td></tr>`).join('')}</tbody></table></div>
      <div class="table-footer">Accounting heads are only Assets, Liabilities, Equity, Income and Expenses. Every account belongs to one group inside its class; the group number becomes the middle segment of the six-digit account code.</div>
    </section>`;
  }
  function accountGroupEditor(code) {
    const g = code ? ACCOUNT_GROUPS.find((x) => x.id === code) : null;
    const cls = g ? g.class : 'asset';
    const v = (k, d = '') => (g && g[k] !== undefined ? g[k] : d);
    return `<section class="panel">
      <div class="panel-head"><h2>${g ? e(g.name) : 'New accounting group'}</h2><span class="badge">${g ? 'Editing ' + e(g.class) + ' ' + e(g.code) : 'Next number by class'}</span></div>
      <form data-group-form class="panel-body form-grid">
        <input type="hidden" name="editingId" value="${e(g ? g.id : '')}">
        <label>Accounting head<select name="class" class="inline-input">${ACCOUNT_CLASSES.map(([k, l]) => `<option value="${k}" ${k === cls ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
        <label>Group no<input name="code" readonly value="${e(g ? g.code : nextGroupCode('asset'))}"></label>
        <label>Name<input name="name" required maxlength="60" value="${e(v('name'))}" placeholder="Fixed assets"></label>
        <label>Status<select name="status" class="inline-input"><option ${v('active', true) ? 'selected' : ''}>Active</option><option ${v('active', true) ? '' : 'selected'}>Archived</option></select></label>
        <label class="wide">Description<input name="description" maxlength="120" value="${e(v('description'))}"></label>
        <div class="related"><button class="button primary">${g ? 'Save changes' : 'Add group'}</button><button type="button" class="button" data-group-cancel>Cancel</button></div>
      </form>
      <div class="panel-body"><p class="form-note">The group number is assigned in sequence inside the accounting head and is never reused. The six-digit account code will be head + group number + account number.</p></div>
    </section>`;
  }
  function bindAccountGroups(rerender, notify, navigate) {
    const form = document.querySelector('[data-group-form]');
    form?.querySelector('[data-group-cancel]')?.addEventListener('click', () => navigate({module: 'accounting', tab: 'coa'}));
    form?.querySelector('[name="class"]')?.addEventListener('change', (ev) => {
      form.querySelector('[name="code"]').value = nextGroupCode(ev.target.value);
    });
    form?.addEventListener('submit', (ev) => {
      ev.preventDefault();
      if (!form.reportValidity()) return;
      const v = Object.fromEntries(new FormData(form));
      const editing = v.editingId || '';
      if (editing) {
        const target = ACCOUNT_GROUPS.find((g) => g.id === editing);
        if (target) Object.assign(target, {name: v.name, description: v.description || '', active: v.status === 'Active'});
        notify('Accounting group updated for this session.');
      } else {
        const code = nextGroupCode(v.class);
        ACCOUNT_GROUPS.push({id: v.class + '-' + code, class: v.class, code, name: v.name, description: v.description || '', active: v.status === 'Active'});
        notify('Accounting group added for this session.');
      }
      navigate({module: 'accounting', tab: 'coa'});
    });
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
        <label>Accounting group<select name="group" class="inline-input">${ACCOUNT_GROUPS.map((g) => `<option value="${e(g.name)}" ${g.name === (v('group') || (ACCOUNT_GROUPS.find((x) => x.class === v('type', 'expense')) || {}).name) ? 'selected' : ''}>${e((ACCOUNT_CLASSES.find(([k]) => k === g.class) || [g.class, g.class])[1])} · ${e(g.name)}</option>`).join('')}</select></label>
        <label>Control<select name="control" class="inline-input">${[['', 'Ordinary posting account'], ['receivable', 'Receivable control — customer on every line'], ['payable', 'Payable control — supplier on every line'], ['bank', 'Bank control — needs a bank sub-account'], ['cash', 'Cash control — needs a cash sub-account']].map(([k, l]) => `<option value="${k}" ${v('control') === k ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
        <label>Subtype<select name="subtype" class="inline-input"><option value="" ${v('subtype') === '' ? 'selected' : ''}>Ordinary</option><option value="tax" ${v('subtype') === 'tax' ? 'selected' : ''}>Tax account</option><option value="control" ${v('subtype') === 'control' ? 'selected' : ''}>Control account</option><option value="bank" ${v('subtype') === 'bank' ? 'selected' : ''}>Bank account</option><option value="cash" ${v('subtype') === 'cash' ? 'selected' : ''}>Cash account</option><option value="advance" ${v('subtype') === 'advance' ? 'selected' : ''}>Advance account</option></select></label>
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
      const chosenGroup = ACCOUNT_GROUPS.find((g) => g.name === v.group);
      if (chosenGroup && chosenGroup.class !== v.type) { notify('Choose an accounting group inside the selected accounting head.'); return; }
      const group = v.group || {asset: 'Other assets', liability: 'Loans and other', equity: 'Capital and reserves', income: 'Other income', expense: 'Operating expenses'}[v.type];
      const record = {code: v.code, name: v.name, type: v.type, group, control: v.control || '', subtype: v.subtype || '', description: v.description || '', currency: 'PKR', active: v.status === 'Active'};
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
      : current === 'inventory' ? `<section class="panel">
          <div class="panel-head"><h2>Inventory defaults</h2><span class="badge">Session values</span></div>
          <form class="panel-body form-grid" data-settings-save="inventory">
            <label>Costing method<select name="costing" class="inline-input"><option>Weighted average</option><option>FIFO</option></select></label>
            <label>Negative stock<select name="negative" class="inline-input"><option>Not allowed</option><option>Warn only</option><option>Allowed</option></select></label>
            ${field('Default warehouse', 'WH-KHI · Central warehouse', '', 'warehouse')}
            ${field('Default receipt warehouse', 'WH-KHI', '', 'receiptWarehouse')}
            ${field('Inventory account', '1200 · Inventory — finished goods', '', 'inventoryAccount')}
            ${field('Goods received not invoiced', '2150 · Withholding tax payable', 'Placeholder until the clearing account exists', 'grniAccount')}
            ${field('Issue / cost of sales', '5000 · Operating expenses', '', 'issueAccount')}
            ${field('Stock adjustment', '5000 · Operating expenses', '', 'adjustAccount')}
            <label>Capitalise landed cost<select name="landed" class="inline-input"><option>Yes, into stock value</option><option>No, expense</option></select></label>
            <label>Count tolerance %<input name="tolerance" value="2" inputmode="decimal"></label>
            <div class="related"><button class="button primary">Save inventory defaults</button></div>
          </form>
          <div class="panel-body"><p class="form-note">These defaults are read by the inventory forms. The accounts will be validated against the chart when posting is connected.</p></div>
        </section>`
      : current === 'manufacturing' ? `<section class="panel">
          <div class="panel-head"><h2>Manufacturing defaults</h2><span class="badge">Session values</span></div>
          <form class="panel-body form-grid" data-settings-save="manufacturing">
            <label>Material issue<select name="issue" class="inline-input"><option>Manual from the work order</option><option>Automatic on release</option></select></label>
            <label>BOM required<select name="bomRequired" class="inline-input"><option>Yes</option><option>No, allow ad-hoc</option></select></label>
            ${field('Default work centre', 'WC-PRINT · Printing', '', 'centre')}
            ${field('Scrap account', '5000 · Operating expenses', '', 'scrapAccount')}
            ${field('Labour account', '5000 · Operating expenses', '', 'labourAccount')}
            ${field('Overhead account', '5000 · Operating expenses', '', 'overheadAccount')}
            ${field('WIP account', '1200 · Inventory — finished goods', 'Placeholder until WIP exists', 'wipAccount')}
            <label>Close order after output<select name="autoClose" class="inline-input"><option>No, close manually</option><option>Yes</option></select></label>
            <div class="related"><button class="button primary">Save manufacturing defaults</button></div>
          </form>
          <div class="panel-body"><p class="form-note">These defaults drive the BOM and work-order forms. Posting to the accounts is backend work.</p></div>
        </section>`
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
          <div class="table-scroll" data-hscroll><table><thead><tr><th>Document</th><th>Template</th><th>Size</th><th>Logo</th><th>QR</th><th class="numeric">Copies</th><th class="numeric">Margin</th><th>Footer</th><th></th></tr></thead><tbody>${PRINT_TEMPLATES.filter((t) => hit(FILTERS.print.q, t.document, t.name, t.size, t.footer)).map((t) => `<tr class="row-link" data-print-edit="${e(t.name)}"><td>${e(t.document)}</td><td>${e(t.name)}</td><td>${e(t.size)}</td><td>${t.logo ? 'Yes' : 'No'}</td><td>${t.qr ? 'Yes' : 'No'}</td><td class="numeric">${t.copies || 1}</td><td class="numeric">${t.margin || 12}</td><td>${e(t.footer)}</td><td class="row-go">›</td></tr>`).join('')}</tbody></table></div>
          <form data-print-form class="panel-body form-grid">
            <input type="hidden" name="editingName" value="">
            <label>Document<select name="document" class="inline-input">${PRINT_DOCUMENTS.map((d) => `<option>${d}</option>`).join('')}</select></label>
            <label>Template name<input name="name" required maxlength="40" placeholder="A5 invoice"></label>
            <label>Size<select name="size" class="inline-input"><option>A4</option><option>A5</option><option>80 mm</option></select></label>
            <label>Copies<input name="copies" type="number" min="1" max="5" value="1"></label>
            <label>Footer<input name="footer" maxlength="70" value="Northstar Trading (Pvt) Ltd"></label>
            <label>Show logo<select name="logo" class="inline-input"><option value="yes">Yes</option><option value="no">No</option></select></label>
            <label>Show QR<select name="qr" class="inline-input"><option value="no">No</option><option value="yes">Yes</option></select></label>
            <label>Margin (mm)<input name="margin" type="number" min="0" max="30" value="12"></label>
            <div class="related"><button class="button primary">Save template</button><button type="button" class="button" data-print-cancel>Cancel</button></div>
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
              <label>Primary currency<select name="currency" class="inline-input">${['PKR','USD','GBP','AED','EUR','SAR','CNY'].map((c) => `<option value="${c}" ${c === CURRENCIES.primary ? 'selected' : ''}>${c}</option>`).join('')}</select></label>
              ${field('Fiscal year', 'Jul 2026 – Jun 2027', '', 'fiscalYear')}
              ${field('Current period', 'Nov 2026', '', 'currentPeriod')}
              ${field('Week starts', 'Monday', '', 'weekStart')}
              ${ms('currency-allowed', 'Allowed currencies', ['PKR','USD','GBP','AED','EUR','SAR','CNY'].map((c) => [c, c]), CURRENCIES.allowed)}
              <p class="form-note wide">Every document can use an allowed currency; the exchange rate is entered on the document and the ledger keeps the primary currency.</p>
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

  function bindTableExports() {
    document.querySelectorAll('[data-export-table]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const panel = btn.closest('section') || document;
        const table = panel.querySelector('table');
        if (!table) return;
        const rows = [...table.querySelectorAll('tr')].map((tr) => [...tr.children].map((td) => td.textContent.replace(/\s+/g, ' ').trim()));
        const csv = rows.map((r) => r.map((c) => `"${String(c ?? '').replaceAll('"', '""')}"`).join(',')).join('\r\n');
        const url = URL.createObjectURL(new Blob([csv], {type: 'text/csv;charset=utf-8'}));
        const a = document.createElement('a');
        a.href = url;
        a.download = `SA7EN-${(table.closest('section')?.querySelector('h2')?.textContent || 'register').toLowerCase().replace(/[^a-z0-9]+/g, '-')}.csv`;
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      });
    });
  }

  /* Single-select polish: the native select stays in the form (value, required
     validation, FormData) but the visible control is our own button and list. */
  let ssBound = false;
  function filterSS(panel) {
    const q = (panel.querySelector('.ss-search')?.value || '').trim().toLowerCase();
    panel.querySelectorAll('.ss-option').forEach((b) => { b.hidden = Boolean(q) && !b.textContent.toLowerCase().includes(q); });
    const any = [...panel.querySelectorAll('.ss-option')].some((b) => !b.hidden);
    let empty = panel.querySelector('.ss-empty');
    if (!empty) { empty = document.createElement('span'); empty.className = 'ss-empty'; empty.textContent = 'No match'; panel.querySelector('.ss-options')?.appendChild(empty); }
    if (empty) empty.hidden = any;
  }
  function enhanceSelects() {
    document.querySelectorAll('select').forEach((sel) => {
      if (sel.dataset.ss || sel.multiple || sel.size > 1) return;
      if (sel.closest('.ss') || sel.closest('.topbar') || sel.closest('.sidebar') || sel.closest('dialog')) return;
      if (sel.hidden || sel.closest('[hidden]')) return;
      const wrap = document.createElement('span');
      wrap.className = 'ss';
      sel.parentNode.insertBefore(wrap, sel);
      wrap.appendChild(sel);
      sel.classList.add('ss-native');
      sel.dataset.ss = '1';
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'ss-trigger';
      btn.setAttribute('aria-haspopup', 'listbox');
      btn.setAttribute('aria-expanded', 'false');
      const text = document.createElement('span');
      text.className = 'ss-text';
      const caret = document.createElement('span');
      caret.className = 'ss-caret';
      caret.setAttribute('aria-hidden', 'true');
      btn.append(text, caret);
      const panel = document.createElement('div');
      panel.className = 'ss-panel';
      panel.setAttribute('role', 'listbox');
      panel.hidden = true;
      wrap.append(btn, panel);
      const sync = () => {
        const opt = sel.options[sel.selectedIndex];
        text.textContent = opt ? opt.textContent.replace(/\s+/g, ' ').trim() : '';
        text.classList.toggle('is-placeholder', !sel.value);
        btn.disabled = sel.disabled;
      };
      const build = () => {
        panel.innerHTML = '<div class="ss-searchrow"><input class="ss-search" type="search" placeholder="Search" aria-label="Search options" autocomplete="off"></div><div class="ss-options"></div>';
        const list = panel.querySelector('.ss-options');
        [...sel.options].forEach((opt, i) => {
          if (opt.hidden) return;
          const b = document.createElement('button');
          b.type = 'button';
          b.className = 'ss-option' + (i === sel.selectedIndex ? ' is-selected' : '');
          b.setAttribute('role', 'option');
          b.setAttribute('aria-selected', String(i === sel.selectedIndex));
          b.dataset.index = String(i);
          if (opt.disabled) b.disabled = true;
          const span = document.createElement('span');
          span.textContent = opt.textContent.replace(/\s+/g, ' ').trim();
          b.appendChild(span);
          list.appendChild(b);
        });
        if (!list.children.length) {
          const none = document.createElement('span');
          none.className = 'ss-empty';
          none.textContent = 'No options';
          list.appendChild(none);
        }
      };
      const close = () => {
        panel.hidden = true;
        btn.setAttribute('aria-expanded', 'false');
        if (panel.dataset.ssFloat && panel.parentElement === document.body && wrap.isConnected) {
          wrap.appendChild(panel);
          delete panel.dataset.ssFloat;
        }
      };
      const open = () => {
        if (sel.disabled) return;
        document.querySelectorAll('.ss-panel').forEach((p) => { if (p !== panel) p.hidden = true; });
        build();
        if (panel.parentElement !== document.body) {
          const id = 'ssp-' + Math.random().toString(36).slice(2, 9);
          panel.id = id;
          panel.dataset.ssOwner = id;
          panel.dataset.ssFloat = '1';
          document.body.appendChild(panel);
        }
        panel.hidden = false;
        btn.setAttribute('aria-expanded', 'true');
        panel.classList.add('ss-panel--fixed');
        const r = btn.getBoundingClientRect();
        const vw = window.innerWidth;
        const vh = window.innerHeight;
        const width = Math.max(220, Math.min(r.width, vw - 16));
        panel.style.width = Math.round(width) + 'px';
        panel.style.left = Math.round(Math.min(Math.max(8, r.left), Math.max(8, vw - width - 8))) + 'px';
        const below = Math.round(vh - r.bottom - 8);
        const above = Math.round(r.top - 8);
        const wanted = Math.min(340, Math.max(120, panel.scrollHeight || 240));
        const placeAbove = below < Math.min(wanted, 220) && above > below;
        const room = Math.max(120, placeAbove ? above : below);
        const height = Math.min(wanted, room);
        panel.style.maxHeight = Math.round(height) + 'px';
        panel.style.top = Math.round(placeAbove ? Math.max(8, r.top - height - 4) : Math.min(r.bottom + 4, vh - height - 8)) + 'px';
        const search = panel.querySelector('.ss-search');
        if (search) { search.value = ''; search.focus(); }
        filterSS(panel);
        panel.querySelector('.is-selected')?.scrollIntoView({block: 'nearest'});
      };
      btn.addEventListener('click', (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        if (panel.hidden) open(); else close();
      });
      panel.addEventListener('click', (ev) => {
        ev.stopPropagation();
        const opt = ev.target.closest('.ss-option');
        if (!opt) return;
        sel.selectedIndex = Number(opt.dataset.index);
        sel.dispatchEvent(new Event('change', {bubbles: true}));
        sync();
        close();
      });
      panel.addEventListener('input', (ev) => { if (ev.target.classList.contains('ss-search')) filterSS(panel); });
      sel.addEventListener('change', sync);
      sync();
    });
  }
  function bindSelects() {
    document.querySelectorAll('body > .ss-panel').forEach((p) => p.remove());
    if (!ssBound) {
      ssBound = true;
      document.addEventListener('click', (ev) => {
        document.querySelectorAll('.form-menu[open]').forEach((d) => {
          if (!d.contains(ev.target) || ev.target.closest('.menu button')) d.open = false;
        });
        if (ev.target.closest('.ss') || ev.target.closest('.ss-panel')) return;
        document.querySelectorAll('.ss-panel').forEach((p) => { p.hidden = true; });
      });
      document.addEventListener('keydown', (ev) => {
        if (ev.key !== 'Escape') return;
        document.querySelectorAll('.ss-panel').forEach((p) => { p.hidden = true; });
      });
      window.addEventListener('resize', () => {
        document.querySelectorAll('.ss-panel').forEach((p) => { p.hidden = true; });
      });
      window.addEventListener('scroll', (ev) => {
        const inside = ev.target && ev.target.nodeType === 1 && ev.target.closest('.ss-panel');
        if (inside) return;   // scrolling the option list is not leaving the control
        document.querySelectorAll('.ss-panel').forEach((p) => {
          p.hidden = true;
          if (p.dataset.ssFloat && p.parentElement === document.body) p.remove();
        });
      }, true);
    }
    enhanceSelects();
  }

  function bindRegisterFilters(rerender) {
    document.querySelectorAll('[data-filter]').forEach((form) => {
      const key = form.dataset.filter;
      if (!FILTERS[key]) return;
      const apply = () => { FILTERS[key] = {...FILTERS[key], ...Object.fromEntries(new FormData(form))}; };
      let searchTimer = 0;
      form.addEventListener('input', (ev) => {
        apply();
        const {name} = ev.target;
        const pos = ev.target.selectionStart;
        const restore = () => {
          const again = document.querySelector(`[data-filter="${key}"] [name="${name}"]`);
          if (!again) return;
          again.focus({preventScroll: true});
          try { again.setSelectionRange(pos, pos); } catch {}
        };
        if (ev.target.matches('input[type="search"], input[type="text"]')) {
          clearTimeout(searchTimer);
          searchTimer = setTimeout(() => { rerender(); requestAnimationFrame(restore); }, 150);
          return;
        }
        rerender();
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
      if (f.dataset.settingsSave === 'company') {
        const v = Object.fromEntries(new FormData(f));
        const box = f.querySelector('.ms');
        const chosen = box ? [...box.querySelectorAll('input[type=checkbox]:checked')].map((b) => b.value) : CURRENCIES.allowed;
        CURRENCIES.primary = v.currency || CURRENCIES.primary;
        CURRENCIES.allowed = chosen.length ? [...new Set([CURRENCIES.primary, ...chosen])] : [CURRENCIES.primary];
        notify('Company settings saved for this session.');
        rerender();
        return;
      }
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
        set('payment', v.paymentPrefix || 'PAY', v.paymentNext);
        set('receipt', v.receiptPrefix || 'RCPT', v.receiptNext);
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
    document.querySelectorAll('[data-print-edit]').forEach((tr) => tr.addEventListener('click', () => {
      const t = PRINT_TEMPLATES.find((x) => x.name === tr.dataset.printEdit);
      const form = document.querySelector('[data-print-form]');
      if (!t || !form) return;
      form.elements.editingName.value = t.name;
      form.elements.document.value = t.document;
      form.elements.name.value = t.name;
      form.elements.size.value = t.size;
      form.elements.copies.value = t.copies || 1;
      form.elements.footer.value = t.footer;
      form.elements.logo.value = t.logo ? 'yes' : 'no';
      form.elements.qr.value = t.qr ? 'yes' : 'no';
      form.elements.margin.value = t.margin || 12;
    }));
    document.querySelector('[data-print-cancel]')?.addEventListener('click', () => rerender());
    document.querySelector('[data-print-form]')?.addEventListener('submit', (ev) => {
      ev.preventDefault();
      const form = ev.target;
      if (!form.reportValidity()) return;
      const v = Object.fromEntries(new FormData(form));
      const rec = {document: v.document, name: v.name, size: v.size, logo: v.logo === 'yes', qr: v.qr === 'yes', copies: Number(v.copies) || 1, margin: Number(v.margin) || 12, footer: v.footer};
      const editing = v.editingName;
      if (editing) { const t = PRINT_TEMPLATES.find((x) => x.name === editing); if (t) Object.assign(t, rec); notify('Print template updated for this session.'); }
      else { if (PRINT_TEMPLATES.some((t) => t.name === rec.name)) { notify('That template name already exists.'); return; } PRINT_TEMPLATES.push(rec); notify('Print template added for this session.'); }
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
    payments: ['Payments', 'Money in and money out settled against the party\'s open invoices or bills. Each row picks the document, the method and the cash or bank sub-account, shows the system outstanding and records the amount set off, so one payment can settle several documents in full or in part. Tax belongs to the invoice, not here.', ['Receipts and supplier payments', 'A row per invoice or bill, fetched by party', 'System outstanding, partial or full set-off', 'Numbered PAY- and RCPT- in month and year order']],
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
  return {overview, dashboard, gl, bindGL, journalRegister, bindJournal, journalDocById, updateJournalDoc, cancelJournalDoc, deleteJournalDoc, duplicateJournalDoc, reverseJournalDoc, setup, bindSetup, bindDimension, taxesView, bindTaxes, taxPage, taxAuthorityEditor, taxReconciliationEditor, reportPage, advances: advancesView, advanceEditor, advanceRecord, applyAdvanceEditor, stockEditor, bindAdvances, itemDefaults: itemDefaultsView, bindItemDefaults, accountGroups: accountGroupsView, accountGroupEditor, bindAccountGroups, accountGroupFor, cashBank: cashBankView, cashEditor, bindCashBank, cashReconView: () => reconView('cash'), partyReconView: () => reconView('party'), cashReconEditor: (code) => reconEditor('cash', code), partyReconEditor: (code) => reconEditor('party', code), bindRecon, items: itemsView, itemEditor, bindItems, partyEditor, taxEditor, paymentEditor, invoiceEditor, reports: reportsView, bindReports, parties: partiesView, bindParties, payments: paymentsView, bindPayments, invoices: invoicesView, invoiceEditor, returnEditor, bindInvoices, close: closeView, bindClose, settings: settingsView, settingsEditor, chartAccountEditor, bindChartAccount, bindSettings: bindSettingsView, bindSettingsEditors, bindRegisterFilters, bindSelects, bindTableExports, projectsView, bindProjectForm, receivables: () => partyScreen('ar'), payables: () => partyScreen('ap'), ageing, approvals, planned};

}
