/* Deterministic fixture ledger. Everything the screens show is derived from
   one set of journal entries, so the dashboard, trial balance, ledger and
   statements agree with each other. No network, no randomness at runtime. */

export const BUSINESS = {
  name: 'Northwind Trading',
  legal: 'Northwind Trading (Pvt) Ltd',
  branch: 'Karachi — Head office',
  currency: 'PKR',
  fy: 'Jul 2026 – Jun 2027',
  period: 'Nov 2026',
  periodStart: '2026-11-01',
  periodEnd: '2026-11-30',
  today: '2026-11-20',
  user: { name: 'A. Rehman', role: 'Finance manager', initials: 'AR' },
};

export const ACCOUNTS = [
  // Assets — current
  { code: '1000', name: 'Cash on hand', type: 'asset', group: 'Current assets', side: 'D', opening: 48120 },
  { code: '1010', name: 'Standard Bank — current', type: 'asset', group: 'Current assets', side: 'D', opening: 364760.4 },
  { code: '1020', name: 'Petty cash — site B', type: 'asset', group: 'Current assets', side: 'D', opening: 12500 },
  { code: '1100', name: 'Trade receivables', type: 'asset', group: 'Current assets', side: 'D', opening: 268410, control: 'receivables' },
  { code: '1110', name: 'Allowance for doubtful debts', type: 'asset', group: 'Current assets', side: 'C', opening: 8400 },
  { code: '1200', name: 'Inventory — finished goods', type: 'asset', group: 'Current assets', side: 'D', opening: 412300 },
  { code: '1300', name: 'Prepayments', type: 'asset', group: 'Current assets', side: 'D', opening: 36000 },
  { code: '1400', name: 'Advances to suppliers', type: 'asset', group: 'Current assets', side: 'D', opening: 22750 },
  // Assets — non-current
  { code: '1500', name: 'Furniture & fixtures', type: 'asset', group: 'Non-current assets', side: 'D', opening: 486000 },
  { code: '1510', name: 'Accumulated depreciation — fixtures', type: 'asset', group: 'Non-current assets', side: 'C', opening: 128400 },
  { code: '1520', name: 'Motor vehicles', type: 'asset', group: 'Non-current assets', side: 'D', opening: 1240000 },
  { code: '1530', name: 'Accumulated depreciation — vehicles', type: 'asset', group: 'Non-current assets', side: 'C', opening: 396800 },
  { code: '1600', name: 'Computer equipment', type: 'asset', group: 'Non-current assets', side: 'D', opening: 268400 },
  { code: '1610', name: 'Accumulated depreciation — computers', type: 'asset', group: 'Non-current assets', side: 'C', opening: 104600 },

  // Liabilities
  { code: '2000', name: 'Trade payables', type: 'liability', group: 'Current liabilities', side: 'C', opening: 193204.75, control: 'payables' },
  { code: '2050', name: 'Accrued expenses', type: 'liability', group: 'Current liabilities', side: 'C', opening: 64300 },
  { code: '2100', name: 'Sales tax payable', type: 'liability', group: 'Current liabilities', side: 'C', opening: 41280 },
  { code: '2110', name: 'Withholding tax payable', type: 'liability', group: 'Current liabilities', side: 'C', opening: 18640 },
  { code: '2200', name: 'Payroll payable', type: 'liability', group: 'Current liabilities', side: 'C', opening: 96540 },
  { code: '2300', name: 'Customer advances', type: 'liability', group: 'Current liabilities', side: 'C', opening: 45000 },
  { code: '2500', name: 'Long-term loan — Standard Bank', type: 'liability', group: 'Non-current liabilities', side: 'C', opening: 800000 },

  // Equity — retained earnings is the balancing figure, set below.
  { code: '3000', name: 'Share capital', type: 'equity', group: 'Equity', side: 'C', opening: 500000 },
  { code: '3100', name: 'Retained earnings', type: 'equity', group: 'Equity', side: 'C', opening: 0 },

  // Revenue
  { code: '4000', name: 'Sales — goods', type: 'revenue', group: 'Revenue', side: 'C', opening: 0 },
  { code: '4010', name: 'Sales — services', type: 'revenue', group: 'Revenue', side: 'C', opening: 0 },
  { code: '4100', name: 'Other income', type: 'revenue', group: 'Revenue', side: 'C', opening: 0 },
  { code: '4200', name: 'Discount received', type: 'revenue', group: 'Revenue', side: 'C', opening: 0 },

  // Expenses
  { code: '5000', name: 'Cost of goods sold', type: 'expense', group: 'Cost of sales', side: 'D', opening: 0 },
  { code: '5100', name: 'Freight inward', type: 'expense', group: 'Cost of sales', side: 'D', opening: 0 },
  { code: '6000', name: 'Salaries & wages', type: 'expense', group: 'Operating expenses', side: 'D', opening: 0 },
  { code: '6100', name: 'Rent', type: 'expense', group: 'Operating expenses', side: 'D', opening: 0 },
  { code: '6200', name: 'Utilities', type: 'expense', group: 'Operating expenses', side: 'D', opening: 0 },
  { code: '6300', name: 'Professional fees', type: 'expense', group: 'Operating expenses', side: 'D', opening: 0 },
  { code: '6400', name: 'Depreciation', type: 'expense', group: 'Operating expenses', side: 'D', opening: 0 },
  { code: '6500', name: 'Bank charges', type: 'expense', group: 'Operating expenses', side: 'D', opening: 0 },
  { code: '6600', name: 'Repairs & maintenance', type: 'expense', group: 'Operating expenses', side: 'D', opening: 0 },
  { code: '6700', name: 'Marketing', type: 'expense', group: 'Operating expenses', side: 'D', opening: 0 },
  { code: '6800', name: 'Bad debts', type: 'expense', group: 'Operating expenses', side: 'D', opening: 0 },
];

const byCode = new Map(ACCOUNTS.map((a) => [a.code, a]));
export const account = (code) => byCode.get(code);

/* ------------------------------------------------------------------ entries */
const rnd = (() => {
  let seed = 0x9e3779b9;
  return () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };
})();

const round2 = (n) => Math.round(n * 100) / 100;

const CUSTOMER_NAMES = ['Crescent Textiles', 'Atlas Industrial', 'Blue Harbour Foods', 'Meridian Pharma', 'Orion Logistics', 'Sapphire Retail', 'Indus Packaging', 'Kestrel Engineering', 'Marina Hospitality', 'Zenith Electrical', 'Falcon Chemicals', 'Pearl Distributors', 'Summit Hardware', 'Cedar Interiors'];
const SUPPLIER_NAMES = ['Standard Bank', 'Gulberg Properties', 'K-Electric', 'Pak Print House', 'Al-Noor Freight', 'Metro Office Supply', 'Secure Line', 'Digital Systems', 'Crescent Packaging', 'Riverside Maintenance'];

const TEMPLATES = [
  // weight, source, narrative, debit legs [code, share], credit legs [code, share], amount range
  { w: 66, source: 'Sales', text: 'Sales invoice to {customer}', amt: [22000, 105000], dr: [['1100', 1]], cr: [['4000', 0.855], ['2100']] },
  { w: 52, source: 'Bank', text: 'Receipt from {customer}', amt: [22000, 90000], dr: [['1010', 1]], cr: [['1100']] },
  { w: 30, source: 'Purchases', text: 'Supplier bill — {supplier}', amt: [28000, 110000], dr: [['5000', 0.92], ['6600']], cr: [['2000']] },
  { w: 7, source: 'Purchases', text: 'Utility bill — {supplier}', amt: [9000, 26000], dr: [['6200', 1]], cr: [['2000']] },
  { w: 22, source: 'Bank', text: 'Payment to {supplier}', amt: [20000, 92000], dr: [['2000', 1]], cr: [['1010']] },
  { w: 12, source: 'Sales', text: 'Service invoice to {customer}', amt: [8000, 42000], dr: [['1100', 1]], cr: [['4010', 0.855], ['2100']] },
  { w: 6, source: 'Bank', text: 'Bank charges — Standard Bank', amt: [900, 4200], dr: [['6500', 1]], cr: [['1010']] },
  { w: 3, source: 'Manual', text: 'Marketing — trade publication', amt: [14000, 22000], dr: [['6700', 1]], cr: [['2000']] },
  { w: 3, source: 'Manual', text: 'Freight inward — shipment', amt: [9000, 15000], dr: [['5100', 1]], cr: [['2000']] },
  { w: 2, source: 'Manual', text: 'Professional fees — audit', amt: [42000, 48000], dr: [['6300', 1]], cr: [['2000']] },
  { w: 2, source: 'Tax', text: 'Sales tax paid to authority', amt: [96000, 144000], dr: [['2100', 1]], cr: [['1010']] },
  { w: 1, source: 'Manual', text: 'Office rent — head office', amt: [96000, 96000], dr: [['6100', 1]], cr: [['1010']], forced: 'posted' },
  { w: 1, source: 'Payroll', text: 'Payroll accrual — {month}', amt: [240000, 240000], dr: [['6000', 1]], cr: [['2200']], forced: 'posted' },
  { w: 1, source: 'Payroll', text: 'Payroll payment — {month}', amt: [232000, 232000], dr: [['2200', 1]], cr: [['1010']], forced: 'posted' },
  { w: 1, source: 'Manual', text: 'Depreciation — {month}', amt: [32666.67, 32666.67], dr: [['6400', 1]], cr: [['1510']], forced: 'posted' },
];

const STATE_POOL = [
  ...Array(132).fill('posted'),
  ...Array(34).fill('draft'),
  ...Array(26).fill('approval'),
  ...Array(8).fill('returned'),
];

const FORCED = TEMPLATES.filter((t) => t.forced);
const RANDOM = TEMPLATES.filter((t) => !t.forced);
const FORCED_DATES = ['2026-11-01', '2026-11-18', '2026-11-19', '2026-11-20'];

function pickTemplate() {
  const total = RANDOM.reduce((n, t) => n + t.w, 0);
  let r = rnd() * total;
  for (const t of RANDOM) { r -= t.w; if (r <= 0) return t; }
  return RANDOM[0];
}

function buildEntry(index, dateIso, state, template) {
  state = template.forced ?? state;
  const gross = round2(template.amt[0] + rnd() * (template.amt[1] - template.amt[0]));

  // The last debit leg takes the remainder, so shares always sum to the gross.
  const dr = [];
  let drRemaining = 1;
  template.dr.forEach(([code, share], i) => {
    const isLast = i === template.dr.length - 1;
    const s = isLast ? drRemaining : (share ?? 0);
    drRemaining = round2(drRemaining - s);
    dr.push({ code, debit: round2(gross * s), credit: 0 });
  });
  const drTotal = round2(dr.reduce((n, l) => n + l.debit, 0));

  let remaining = drTotal;
  const cr = template.cr.map(([code, share], i) => {
    const isLast = i === template.cr.length - 1;
    const amt = isLast ? remaining : round2(drTotal * (share ?? 0));
    remaining = round2(remaining - amt);
    return { code, debit: 0, credit: amt };
  });

  // Drafts and returned entries may be out of balance by a small amount.
  if (template.forced) state = template.forced;
  if (state === 'draft' || state === 'returned') {
    if (rnd() < 0.42) cr[cr.length - 1].credit = round2(cr[cr.length - 1].credit - round2(120 + rnd() * 9000));
  }

  const lines = [];
  for (const l of dr) lines.push({ account: l.code, debit: l.debit, credit: 0, memo: account(l.code)?.name ?? '' });
  for (const l of cr) lines.push({ account: l.code, debit: 0, credit: l.credit, memo: account(l.code)?.name ?? '' });

  const narrative = template.text
    .replace('{customer}', CUSTOMER_NAMES[index % CUSTOMER_NAMES.length])
    .replace('{supplier}', SUPPLIER_NAMES[index % SUPPLIER_NAMES.length])
    .replace('{month}', index % 2 ? 'November' : 'October');

  const debit = round2(lines.reduce((n, l) => n + l.debit, 0));
  const credit = round2(lines.reduce((n, l) => n + l.credit, 0));

  return {
    id: `JE-2026-${String(index + 1).padStart(4, '0')}`,
    date: dateIso,
    postedDate: state === 'posted' ? dateIso : null,
    journal: template.source,
    source: template.source,
    narrative,
    reference: template.source === 'Sales' ? `SI-${1100 + index}` : template.source === 'Purchases' ? `PB-${400 + (index % 60)}` : '',
    state,
    actor: index % 5 === 0 ? 'S. Iqbal' : 'A. Rehman',
    lines,
    debit,
    credit,
    net: round2(debit - credit),
    attachments: index % 6 === 0 ? 1 : 0,
  };
}

const CATEGORY = (n) => {
  if (n === 0) return 'Tax';
  if (n === 1) return 'Sales';
  if (n === 2) return 'Bank';
  if (n === 3) return 'Purchases';
  if (n === 4) return 'Bank';
  if (n === 5) return 'Payroll';
  return 'General';
};

export const ENTRIES = (() => {
  const out = [];
  const start = new Date('2026-11-20T00:00:00Z');
  // Fisher-Yates with the seeded generator: identical in every engine.
  const states = [...STATE_POOL];
  for (let i = states.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [states[i], states[j]] = [states[j], states[i]];
  }
  const randomCount = 200 - FORCED.length;
  for (let i = 0; i < randomCount; i++) {
    const dayOffset = Math.floor(i / 7);
    const d = new Date(start);
    d.setUTCDate(d.getUTCDate() - dayOffset);
    const dateIso = d.toISOString().slice(0, 10);
    const t = pickTemplate();
    const e = buildEntry(i, dateIso, states[i], t);
    out.push({ ...e, category: CATEGORY(TEMPLATES.indexOf(t)) });
  }
  // Period-end items always exist, exactly once, and are always posted.
  FORCED.forEach((t, k) => {
    const e = buildEntry(randomCount + k, FORCED_DATES[k] ?? '2026-11-20', 'posted', t);
    out.push({ ...e, category: 'General' });
  });
  return out.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : a.id < b.id ? 1 : -1));
})();

/* ------------------------------------------------------- derived accounting */
const POSTED = ENTRIES.filter((e) => e.state === 'posted');

export const BALANCES = (() => {
  const map = new Map(ACCOUNTS.map((a) => [a.code, { dr: 0, cr: 0, opening: a.side === 'D' ? a.opening : -a.opening }]));
  for (const e of POSTED) for (const l of e.lines) {
    const b = map.get(l.account);
    if (!b) continue;
    b.dr += l.debit; b.cr += l.credit;
  }
  const out = new Map();
  for (const a of ACCOUNTS) {
    const b = map.get(a.code);
    out.set(a.code, round2(b.opening + b.dr - b.cr));
  }
  // Retained earnings absorbs the opening difference so the opening position balances.
  const assets = ACCOUNTS.filter((a) => a.type === 'asset').reduce((n, a) => n + (a.side === 'D' ? a.opening : -a.opening), 0);
  const liab = ACCOUNTS.filter((a) => a.type === 'liability').reduce((n, a) => n + a.opening, 0);
  const capital = ACCOUNTS.filter((a) => a.code === '3000').reduce((n, a) => n + a.opening, 0);
  out.set('3100', round2(-(assets - liab - capital)));
  return out;
})();

export const balanceOf = (code) => BALANCES.get(code) ?? 0;

export const MOVEMENT = (() => {
  const map = new Map();
  for (const e of POSTED) for (const l of e.lines) {
    const m = map.get(l.account) ?? { dr: 0, cr: 0 };
    m.dr += l.debit; m.cr += l.credit;
    map.set(l.account, m);
  }
  return map;
})();

/** Trial balance: positive signed balances sit in the debit column. */
export const TRIAL_BALANCE = (() => {
  const rows = ACCOUNTS.map((a) => {
    const signed = balanceOf(a.code);
    return {
      ...a,
      signed,
      debit: signed > 0 ? signed : 0,
      credit: signed < 0 ? -signed : 0,
      movement: MOVEMENT.get(a.code) ?? { dr: 0, cr: 0 },
    };
  });
  const debit = round2(rows.reduce((n, r) => n + r.debit, 0));
  const credit = round2(rows.reduce((n, r) => n + r.credit, 0));
  return { rows, debit, credit, difference: round2(debit - credit), balanced: Math.abs(debit - credit) < 0.005 };
})();

const sumType = (type, matcher = () => true) =>
  round2(ACCOUNTS.filter((a) => a.type === type && matcher(a)).reduce((n, a) => n - balanceOf(a.code), 0));

export const PROFIT_AND_LOSS = (() => {
  const revenue = sumType('revenue');
  const cost = round2(ACCOUNTS.filter((a) => a.type === 'expense' && a.group === 'Cost of sales').reduce((n, a) => n + balanceOf(a.code), 0));
  const operating = round2(ACCOUNTS.filter((a) => a.type === 'expense' && a.group === 'Operating expenses').reduce((n, a) => n + balanceOf(a.code), 0));
  const gross = round2(revenue - cost);
  const net = round2(gross - operating);
  return { revenue, cost, gross, operating, net, margin: revenue ? net / revenue : 0 };
})();

export const BALANCE_SHEET = (() => {
  const group = (type, g) => round2(ACCOUNTS.filter((a) => a.type === type && a.group === g)
    .reduce((n, a) => n + (type === 'asset' ? balanceOf(a.code) : -balanceOf(a.code)), 0));
  const currentAssets = group('asset', 'Current assets');
  const nonCurrentAssets = group('asset', 'Non-current assets');
  const currentLiabilities = group('liability', 'Current liabilities');
  const nonCurrentLiabilities = group('liability', 'Non-current liabilities');
  const equity = round2(ACCOUNTS.filter((a) => a.type === 'equity').reduce((n, a) => n - balanceOf(a.code), 0));
  // equity accounts are credit balances, so this reads positive.
  const result = PROFIT_AND_LOSS.net;
  return {
    currentAssets, nonCurrentAssets,
    totalAssets: round2(currentAssets + nonCurrentAssets),
    currentLiabilities, nonCurrentLiabilities,
    totalLiabilities: round2(currentLiabilities + nonCurrentLiabilities),
    equity, result,
    totalEquity: round2(equity + result),
  };
})();

/** Cash movement per day, so the trend line and the cash balance agree. */
export const CASH_TREND = (() => {
  const CASH = ['1000', '1010', '1020'];
  const start = new Date('2026-10-22T00:00:00Z');
  const perDay = new Map();
  for (const e of POSTED) for (const l of e.lines) {
    if (!CASH.includes(l.account)) continue;
    perDay.set(e.date, round2((perDay.get(e.date) ?? 0) + l.debit - l.credit));
  }
  const now = CASH.reduce((n, c) => n + balanceOf(c), 0);
  // Walk backwards from today's balance so the last point is the real closing figure.
  const days = [];
  for (let i = 0; i < 30; i++) {
    const d = new Date(start);
    d.setUTCDate(d.getUTCDate() + i);
    days.push(d.toISOString().slice(0, 10));
  }
  const points = new Array(days.length);
  let running = now;
  for (let i = days.length - 1; i >= 0; i--) {
    points[i] = { date: days[i], value: round2(running) };
    running = round2(running - (perDay.get(days[i]) ?? 0));
  }
  const first = points[0]?.value ?? now;
  return { points, now: round2(now), change: round2(now - first) };
})();

export const CASH_POSITION = round2(['1000', '1010', '1020'].reduce((n, c) => n + balanceOf(c), 0));
export const RECEIVABLES = round2(balanceOf('1100') + balanceOf('1110'));
export const PAYABLES = round2(-balanceOf('2000'));
export const NET_POSITION = round2(BALANCE_SHEET.totalAssets - BALANCE_SHEET.totalLiabilities);

/* ------------------------------------------------------------ AR and AP ----- */
function distribute(total, count) {
  const weights = Array.from({ length: count }, () => 0.5 + rnd());
  const sum = weights.reduce((a, b) => a + b, 0);
  const out = weights.map((w) => round2((total * w) / sum));
  const drift = round2(total - out.reduce((a, b) => a + b, 0));
  out[out.length - 1] = round2(out[out.length - 1] + drift);
  return out;
}

function invoiceSet(names, total, kind) {
  const amounts = distribute(total, names.length);
  return names.map((name, i) => {
    const n = 1 + (i % 2);
    const parts = n === 2 ? [round2(amounts[i] * 0.6), round2(amounts[i] * 0.4)] : [amounts[i]];
    const invoices = parts.map((amt, j) => {
      const dueOffset = [-8, 12, -35, 74, 5, -102, 22, -47][(i + j) % 8];
      const due = new Date('2026-11-20T00:00:00Z');
      due.setUTCDate(due.getUTCDate() + dueOffset);
      const age = -dueOffset;
      return {
        id: (kind === 'ar' ? 'SI-' : 'PB-') + String(1000 + i * 3 + j),
        amount: amt,
        due: due.toISOString().slice(0, 10),
        overdueDays: age > 0 ? age : 0,
        status: age > 45 ? 'overdue' : age > 0 ? 'due' : 'current',
      };
    });
    return {
      id: (kind === 'ar' ? 'C-' : 'S-') + String(100 + i),
      name,
      balance: round2(invoices.reduce((n, x) => n + x.amount, 0)),
      overdue: round2(invoices.reduce((n, x) => n + (x.overdueDays > 0 ? x.amount : 0), 0)),
      oldestDays: invoices.reduce((n, x) => Math.max(n, x.overdueDays), 0),
      invoices,
    };
  }).sort((a, b) => b.balance - a.balance);
}

export const CUSTOMERS = invoiceSet(CUSTOMER_NAMES, RECEIVABLES, 'ar');
export const SUPPLIERS = invoiceSet(SUPPLIER_NAMES, PAYABLES, 'ap');

const BUCKETS = ['Current', '1–30', '31–60', '61–90', '90+'];
const bucketOf = (days) => (days <= 0 ? 'Current' : days <= 30 ? '1–30' : days <= 60 ? '31–60' : days <= 90 ? '61–90' : '90+');

function agingOf(parties) {
  const rows = parties.map((p) => {
    const cells = Object.fromEntries(BUCKETS.map((b) => [b, 0]));
    for (const inv of p.invoices) cells[bucketOf(inv.overdueDays)] = round2(cells[bucketOf(inv.overdueDays)] + inv.amount);
    return { id: p.id, name: p.name, cells, total: p.balance };
  });
  const totals = Object.fromEntries(BUCKETS.map((b) => [b, round2(rows.reduce((n, r) => n + r.cells[b], 0))]));
  return { rows, totals, buckets: BUCKETS, total: round2(rows.reduce((n, r) => n + r.total, 0)) };
}

export const AR_AGING = agingOf(CUSTOMERS);
export const AP_AGING = agingOf(SUPPLIERS);

/* --------------------------------------------------------------- schedules */
export const DEPRECIATION = [
  { code: '1500', name: 'Furniture & fixtures', cost: 486000, rate: 0.15, method: 'Reducing balance', from: '2023-08-01', monthly: 6075, accumulated: 128400 },
  { code: '1520', name: 'Motor vehicles', cost: 1240000, rate: 0.2, method: 'Reducing balance', from: '2024-02-01', monthly: 20666.67, accumulated: 396800 },
  { code: '1600', name: 'Computer equipment', cost: 268400, rate: 0.25, method: 'Straight line', from: '2025-01-01', monthly: 5591.67, accumulated: 104600 },
].map((r) => ({ ...r, nbv: round2(r.cost - r.accumulated) }));

export const RECURRING = [
  { id: 'RJ-001', name: 'Head office rent', account: '6100', amount: 96000, frequency: 'Monthly', next: '2026-12-01', state: 'active' },
  { id: 'RJ-002', name: 'Insurance premium', account: '1300', amount: 18400, frequency: 'Monthly', next: '2026-12-01', state: 'active' },
  { id: 'RJ-003', name: 'Software subscriptions', account: '6300', amount: 12750, frequency: 'Monthly', next: '2026-11-28', state: 'active' },
  { id: 'RJ-004', name: 'Vehicle lease', account: '6100', amount: 62800, frequency: 'Monthly', next: '2026-11-30', state: 'review' },
  { id: 'RJ-005', name: 'Retainer — Atlas Industrial', account: '4010', amount: 85000, frequency: 'Quarterly', next: '2027-01-05', state: 'active' },
];

export const PREPAYMENTS = [
  { id: 'PP-014', name: 'Annual insurance', total: 220800, consumed: 147200, remaining: 73600, monthsLeft: 4 },
  { id: 'PP-015', name: 'Warehouse lease deposit', total: 480000, consumed: 96000, remaining: 384000, monthsLeft: 20 },
  { id: 'PP-016', name: 'Software licence — 12 months', total: 153000, consumed: 63750, remaining: 89250, monthsLeft: 7 },
];

/* --------------------------------------------------------------- approvals */
const reasonFor = (e) =>
  e.state === 'returned' ? 'Returned for correction'
  : e.debit > 100000 ? 'Amount exceeds branch limit'
  : e.source === 'Purchases' ? 'Supplier bill matching'
  : e.source === 'Sales' ? 'Credit check required'
  : e.source === 'Payroll' ? 'Payroll approval'
  : 'Manual journal';

export const APPROVALS = ENTRIES.filter((e) => e.state === 'approval' || e.state === 'returned')
  .slice(0, 7)
  .map((e) => ({
    entry: e,
    submittedBy: e.actor,
    submitted: e.date,
    reason: reasonFor(e),
  }));

/* ------------------------------------------------------------- close steps */
export const CLOSE_STEPS = [
  { id: 1, label: 'Post all journals', detail: '34 drafts, 26 awaiting approval', state: 'open', count: 60 },
  { id: 2, label: 'Reconcile bank accounts', detail: '2 of 3 reconciled', state: 'open', count: 1 },
  { id: 3, label: 'Review receivables', detail: '4 invoices over 60 days', state: 'attention', count: 4 },
  { id: 4, label: 'Run depreciation', detail: 'November charge drafted', state: 'done', count: 0 },
  { id: 5, label: 'Accrue expenses', detail: '3 recurring journals due', state: 'open', count: 3 },
  { id: 6, label: 'Review statements', detail: 'Not started', state: 'todo', count: 0 },
];

/* ------------------------------------------------------------ period totals */
export const PERIOD = {
  entries: ENTRIES.length,
  posted: POSTED.length,
  drafts: ENTRIES.filter((e) => e.state === 'draft').length,
  approval: ENTRIES.filter((e) => e.state === 'approval').length,
  returned: ENTRIES.filter((e) => e.state === 'returned').length,
  postedValue: round2(POSTED.reduce((n, e) => n + e.debit, 0)),
};

export const RECENT = POSTED.slice(0, 7);
