import { icon, esc, toast, modal, drawer, areaChart, stackBar, progress, badge, stateBadge } from './ui.js';
import {
  BUSINESS, ACCOUNTS, ENTRIES, account, balanceOf, TRIAL_BALANCE, PROFIT_AND_LOSS, BALANCE_SHEET,
  CASH_POSITION, RECEIVABLES, PAYABLES, NET_POSITION, CASH_TREND, CLOSE_STEPS, APPROVALS,
  CUSTOMERS, SUPPLIERS, AR_AGING, AP_AGING, DEPRECIATION, RECURRING, PREPAYMENTS, RECENT, PERIOD,
} from './data.js';
import { amount, money, dateShort, dateLong, percent, relative, count, parseAmount } from '../shared/format.js';

/* ------------------------------------------------------------------ helpers */
const crumb = (parts) => `<div class="crumbs">${parts.map((p, i) => i === parts.length - 1
  ? `<span>${esc(p[0])}</span>`
  : `<a href="#${p[1]}">${esc(p[0])}</a><span>/</span>`).join('')}</div>`;

const pagehead = (title, lede, actions = '') => `
  <div class="pagehead">
    <div><h1>${esc(title)}</h1>${lede ? `<p>${esc(lede)}</p>` : ''}</div>
    ${actions ? `<div class="pagehead__actions">${actions}</div>` : ''}
  </div>`;

const kpi = (label, value, meta, extra = '') => `
  <div class="kpi ${extra}">
    <div class="kpi__top"><span class="kpi__label">${esc(label)}</span></div>
    <div class="kpi__value num">${value}</div>
    <div class="kpi__meta">${meta}</div>
  </div>`;

const bucketColors = ['var(--positive)', 'var(--caution)', 'var(--plum)', '#8A5A3A', 'var(--danger)'];

/* --------------------------------------------------------------- 1 dashboard */
export function dashboard(ctx) {
  ctx.setTitle('Accounting');
  const s = TRIAL_BALANCE;
  const attention = [
    { tone: 'caution', title: `${PERIOD.approval} journals are waiting for you`, meta: 'Oldest submitted 2 days ago', to: '/accounting/approvals', action: 'Review' },
    { tone: 'danger', title: `${PERIOD.returned} drafts came back for correction`, meta: 'Returned with a reviewer note', to: '/accounting/journals', action: 'Open' },
    { tone: 'brand', title: 'Bank feed unreconciled since 14 Nov', meta: 'Standard Bank · 6 unmatched lines', to: '/m/banking', action: 'Reconcile' },
  ];
  const done = CLOSE_STEPS.filter((x) => x.state === 'done').length;

  const html = `
  <section class="ambient">
    <canvas class="ambient__canvas" data-shader></canvas>
    <canvas class="ambient__dust" data-dust></canvas>
    <div class="ambient__veil"></div>
    <div class="ambient__inner">
      <div class="ambient__row">
        <div>
          <div class="eyebrow" style="color:var(--on-dark-muted)">Accounting · ${esc(BUSINESS.period)}</div>
          <h1>Accounting</h1>
          <p>Ledger position as at ${esc(dateLong(BUSINESS.today))}. Every figure below is built from posted journals; nothing here is an estimate.</p>
        </div>
        <div class="row" style="gap:8px">
          <button class="btn" data-nav="/accounting/journals">Journal entries</button>
          <button class="btn btn--primary" data-nav="/accounting/journals/new">${icon('plus')}New journal</button>
        </div>
      </div>
      <div class="ambient__meta">
        <div>Period window<b>1 Nov – 30 Nov 2026</b></div>
        <div>Journals this period<b>${count(PERIOD.entries)}</b></div>
        <div>Posted value<b>${amount(PERIOD.postedValue)}</b></div>
        <div>Ledger check<b>${s.balanced ? 'Balanced' : 'Out by ' + amount(s.difference)}</b></div>
      </div>
    </div>
  </section>

  <div class="grid grid--4" style="margin-top:16px">
    ${kpi('Cash & bank', amount(CASH_POSITION), `<span class="muted">PKR · 3 accounts</span>`, 'kpi--brand')}
    ${kpi('Receivables', amount(RECEIVABLES), `<span class="muted">${CUSTOMERS.length} customers · ${amount(AR_AGING.totals['90+'])} over 90 days</span>`)}
    ${kpi('Payables', amount(PAYABLES), `<span class="muted">${SUPPLIERS.length} suppliers · ${amount(AP_AGING.totals['1–30'])} due this month</span>`)}
    ${kpi('Net position', amount(NET_POSITION), `<span class="muted">Assets ${amount(BALANCE_SHEET.totalAssets)} less liabilities</span>`)}
  </div>

  <div class="grid grid--2-1" style="margin-top:16px">
    <div class="stack">
      <div class="card">
        <div class="card__head">
          <div><h2>Cash movement</h2><p>Thirty days, all bank and cash accounts</p></div>
          <div class="chips"><button class="chip" aria-pressed="false">7D</button><button class="chip" aria-pressed="true">30D</button><button class="chip" aria-pressed="false">90D</button></div>
        </div>
        <div class="card__body" style="padding-bottom:8px">
          <div class="row row--between" style="align-items:flex-end;margin-bottom:10px">
            <div>
              <div class="muted" style="font-size:var(--t-12)">Closing balance</div>
              <div style="font-size:var(--t-26);letter-spacing:-.02em" class="num">${amount(CASH_TREND.now)}</div>
            </div>
            <div class="badge ${CASH_TREND.change >= 0 ? 'badge--positive' : 'badge--danger'}">${CASH_TREND.change >= 0 ? '+' : ''}${amount(CASH_TREND.change)} in 30 days</div>
          </div>
          ${areaChart(CASH_TREND.points, { height: 132, id: 'cash' })}
          <div class="row row--between" style="margin-top:6px;font-size:var(--t-11);color:var(--muted)">
            <span>${esc(dateLong(CASH_TREND.points[0].date))}</span><span>${esc(dateLong(CASH_TREND.points.at(-1).date))}</span>
          </div>
        </div>
      </div>

      <div class="card">
        <div class="card__head">
          <div><h2>Recent entries</h2><p>Latest posted journals across all books</p></div>
          <button class="btn btn--ghost btn--sm" data-nav="/accounting/journals">Open register ${icon('chevronRight')}</button>
        </div>
        <div class="card__body card__body--flush">
          <div class="tablewrap">
            <table class="tbl">
              <caption class="sr-only">Most recent posted journals</caption>
              <thead><tr><th scope="col" style="width:92px">Date</th><th scope="col">Entry</th><th scope="col" style="width:120px">Source</th><th scope="col" class="r" style="width:120px">Amount</th><th scope="col" style="width:120px">State</th></tr></thead>
              <tbody>${RECENT.map((e) => `<tr>
                <td>${esc(dateShort(e.date))}</td>
                <td><a class="rowlink" href="#/accounting/journals">${esc(e.id)}</a><span class="sub">${esc(e.narrative)}</span></td>
                <td>${esc(e.source)}</td>
                <td class="r num">${amount(e.debit)}</td>
                <td>${stateBadge(e.state)}</td>
              </tr>`).join('')}</tbody>
            </table>
          </div>
        </div>
      </div>
    </div>

    <div class="stack">
      <div class="card">
        <div class="card__head"><div><h2>Close readiness</h2><p>${done} of ${CLOSE_STEPS.length} steps complete</p></div><span class="badge badge--caution">Nov 2026</span></div>
        <div class="card__body" style="padding-top:6px">
          ${progress(done, CLOSE_STEPS.length)}
          <div class="stack--tight" style="display:grid;gap:2px;margin-top:14px">
            ${CLOSE_STEPS.map((step) => `<div class="row" style="align-items:flex-start;gap:10px;padding:8px 0;border-bottom:1px solid var(--hairline)">
              <span style="margin-top:2px;color:${step.state === 'done' ? 'var(--positive)' : step.state === 'attention' ? 'var(--danger)' : 'var(--muted-2)'}">${icon(step.state === 'done' ? 'check' : step.state === 'attention' ? 'alert' : 'clock')}</span>
              <div style="flex:1;min-width:0">
                <div style="font-size:var(--t-13);color:${step.state === 'done' ? 'var(--muted)' : 'var(--ink)'};text-decoration:${step.state === 'done' ? 'line-through' : 'none'}">${esc(step.label)}</div>
                <div class="muted" style="font-size:var(--t-12);margin-top:1px">${esc(step.detail)}</div>
              </div>
              ${step.count ? `<span class="tag num">${step.count}</span>` : ''}
            </div>`).join('')}
          </div>
        </div>
      </div>

      <div class="card">
        <div class="card__head"><div><h2>Needs attention</h2></div><span class="tag">3</span></div>
        <div class="card__body" style="padding-top:4px;padding-bottom:6px">
          ${attention.map((a) => `<div class="row" style="align-items:flex-start;gap:10px;padding:10px 0;border-bottom:1px solid var(--hairline)">
            <span style="width:6px;height:6px;border-radius:50%;margin-top:7px;background:${a.tone === 'danger' ? 'var(--danger)' : a.tone === 'caution' ? 'var(--caution)' : 'var(--plum)'}"></span>
            <div style="flex:1;min-width:0">
              <div style="font-size:var(--t-13)">${esc(a.title)}</div>
              <div class="muted" style="font-size:var(--t-12);margin-top:2px">${esc(a.meta)}</div>
            </div>
            <button class="btn btn--ghost btn--sm" data-nav="${a.to}">${esc(a.action)}</button>
          </div>`).join('')}
        </div>
      </div>
    </div>
  </div>

  <div class="grid grid--2" style="margin-top:16px">
    <div class="card">
      <div class="card__head"><div><h2>Receivables ageing</h2><p>${amount(AR_AGING.total)} across ${CUSTOMERS.length} customers</p></div><button class="btn btn--ghost btn--sm" data-nav="/accounting/aging">Open ageing</button></div>
      <div class="card__body">
        ${stackBar(AR_AGING.buckets.map((b, i) => ({ label: b, value: AR_AGING.totals[b], color: bucketColors[i] })))}
        <div class="row row--between" style="margin-top:12px;gap:12px;flex-wrap:wrap">
          ${AR_AGING.buckets.map((b, i) => `<div><div class="muted" style="font-size:var(--t-11);display:flex;align-items:center;gap:5px"><span style="width:6px;height:6px;border-radius:2px;background:${bucketColors[i]}"></span>${esc(b)}</div><div class="num" style="font-size:var(--t-13);margin-top:2px">${amount(AR_AGING.totals[b])}</div></div>`).join('')}
        </div>
      </div>
    </div>
    <div class="card">
      <div class="card__head"><div><h2>Payables ageing</h2><p>${amount(AP_AGING.total)} across ${SUPPLIERS.length} suppliers</p></div><button class="btn btn--ghost btn--sm" data-nav="/accounting/aging">Open ageing</button></div>
      <div class="card__body">
        ${stackBar(AP_AGING.buckets.map((b, i) => ({ label: b, value: AP_AGING.totals[b], color: bucketColors[i] })))}
        <div class="row row--between" style="margin-top:12px;gap:12px;flex-wrap:wrap">
          ${AP_AGING.buckets.map((b, i) => `<div><div class="muted" style="font-size:var(--t-11);display:flex;align-items:center;gap:5px"><span style="width:6px;height:6px;border-radius:2px;background:${bucketColors[i]}"></span>${esc(b)}</div><div class="num" style="font-size:var(--t-13);margin-top:2px">${amount(AP_AGING.totals[b])}</div></div>`).join('')}
        </div>
      </div>
    </div>
  </div>`;
  return { html };
}

/* ---------------------------------------------------------------- 2 register */
const state_label = { posted: 'Posted', draft: 'Draft', approval: 'Awaiting approval', returned: 'Returned' };

export function register(ctx) {
  ctx.setTitle('Journal entries');
  const counts = { all: ENTRIES.length, draft: PERIOD.drafts, approval: PERIOD.approval, posted: PERIOD.posted, returned: PERIOD.returned };
  const rows = ENTRIES.map((e) => `<tr data-entry="${esc(e.id)}" ${e.state === 'returned' ? 'data-void="true"' : ''}>
      <td>${esc(dateShort(e.date))}</td>
      <td><a class="rowlink" href="#" data-open="${esc(e.id)}">${esc(e.id)}</a></td>
      <td class="cell-narrative">${esc(e.narrative)}<span class="sub">${esc(e.reference || e.journal)}</span></td>
      <td class="col-source">${esc(e.source)}</td>
      <td>${stateBadge(e.state)}</td>
      <td class="r num">${amount(e.debit)}</td>
      <td class="r num col-credit">${amount(e.credit)}</td>
      <td class="r num col-net">${amount(e.net)}</td>
    </tr>`).join('');

  const html = `
  ${crumb([['Accounting', '/accounting'], ['Journal entries']])}
  ${pagehead('Journal entries', 'Every journal in the period, posted or not. Drafts have no ledger effect until they are posted.', `
    <button class="btn btn--sm" data-export>${icon('download')}Export</button>
    <button class="btn btn--sm" data-print>${icon('printer')}Print</button>
    <button class="btn btn--primary btn--sm" data-nav="/accounting/journals/new">${icon('plus')}New journal</button>`)}

  <div class="card">
    <div class="card__head" style="padding-bottom:14px">
      <div class="chips" role="group" aria-label="Filter by state">
        ${['all', 'draft', 'approval', 'posted', 'returned'].map((k, i) => `<button class="chip" data-filter="${k}" aria-pressed="${i === 0}">${k === 'all' ? 'All' : state_label[k]}<span class="chip__count">${counts[k]}</span></button>`).join('')}
      </div>
      <div class="row" style="gap:8px">
        <div class="search" style="width:240px;height:32px">${icon('search')}<input id="regSearch" type="search" placeholder="Filter entries" aria-label="Filter entries"></div>
        <button class="btn btn--sm">${icon('filter')}More filters</button>
      </div>
    </div>
    <div class="tablewrap" id="regScroll" tabindex="0" role="region" aria-label="Journal entries. Use arrow keys to move between rows." style="--table-max:460px;outline-offset:-2px">
      <table class="tbl tbl--dense" id="regTable">
        <caption class="sr-only">Journal entries for November 2026</caption>
        <thead><tr>
          <th scope="col" style="width:94px">Date</th><th scope="col" style="width:118px">Entry</th><th scope="col">Narrative</th>
          <th scope="col" class="col-source" style="width:110px">Source</th><th scope="col" style="width:150px">State</th>
          <th scope="col" class="r" style="width:118px">Debit</th><th scope="col" class="r col-credit" style="width:118px">Credit</th><th scope="col" class="r col-net" style="width:112px">Net</th>
        </tr></thead>
        <tbody id="regBody">${rows}<tr class="spacer" aria-hidden="true"><td colspan="8"></td></tr></tbody>
        <tfoot><tr><td colspan="8"><div class="tbl-totals">
          <span class="tbl-totals__label">Total — <span id="regCount">${ENTRIES.length}</span> entries</span>
          <span><i>Debit</i><b class="num" id="regDr">${amount(ENTRIES.reduce((n, e) => n + e.debit, 0))}</b></span>
          <span class="col-credit"><i>Credit</i><b class="num" id="regCr">${amount(ENTRIES.reduce((n, e) => n + e.credit, 0))}</b></span>
          <span class="col-net"><i>Net</i><b class="num" id="regNet">${amount(ENTRIES.reduce((n, e) => n + e.net, 0))}</b></span>
        </div></td></tr></tfoot>
      </table>
    </div>
    <div class="card__foot" style="justify-content:flex-start;gap:16px">
      <span>Showing <b id="regShown">${ENTRIES.length}</b> of ${ENTRIES.length} entries</span>
      <span class="tag">All rows loaded</span>
      <span style="margin-left:auto" class="row" style="gap:8px">
        <span class="muted" style="font-size:var(--t-12)">Rows per page</span>
        <select class="select select--sm" style="width:auto" aria-label="Rows per page"><option>200</option><option>100</option><option>50</option></select>
      </span>
    </div>
  </div>
  <p class="muted" style="font-size:var(--t-12);margin-top:10px">
    <kbd class="tag">↑</kbd> <kbd class="tag">↓</kbd> move row · <kbd class="tag">Home</kbd> <kbd class="tag">End</kbd> first or last · <kbd class="tag">Enter</kbd> open · <kbd class="tag">Esc</kbd> leave the table
  </p>`;

  return {
    html,
    wire(view) {
      const body = view.querySelector('#regBody');
      const scroll = view.querySelector('#regScroll');
      let filter = 'all';
      let cursor = -1;

      const visible = () => [...body.querySelectorAll('tr')];
      const apply = () => {
        const q = view.querySelector('#regSearch').value.trim().toLowerCase();
        let shown = 0, dr = 0, cr = 0;
        for (const tr of body.querySelectorAll('tr')) {
          const e = ENTRIES.find((x) => x.id === tr.dataset.entry);
          const okState = filter === 'all' || e.state === filter;
          const okText = !q || (e.id + ' ' + e.narrative + ' ' + e.source + ' ' + e.reference).toLowerCase().includes(q);
          const show = okState && okText;
          tr.hidden = !show;
          if (show) { shown++; dr += e.debit; cr += e.credit; }
        }
        view.querySelector('#regShown').textContent = shown;
        view.querySelector('#regCount').textContent = shown;
        view.querySelector('#regDr').textContent = amount(dr);
        view.querySelector('#regCr').textContent = amount(cr);
        view.querySelector('#regNet').textContent = amount(dr - cr);
        cursor = -1;
      };

      view.querySelectorAll('[data-filter]').forEach((b) => b.addEventListener('click', () => {
        filter = b.dataset.filter;
        view.querySelectorAll('[data-filter]').forEach((x) => x.setAttribute('aria-pressed', x === b ? 'true' : 'false'));
        apply();
      }));
      view.querySelector('#regSearch').addEventListener('input', apply);

      const move = (n) => {
        const rows2 = visible().filter((r) => !r.hidden);
        if (!rows2.length) return;
        rows2.forEach((r) => r.classList.remove('is-cursor'));
        cursor = Math.max(0, Math.min(rows2.length - 1, n));
        rows2[cursor].classList.add('is-cursor');
        rows2[cursor].scrollIntoView({ block: 'nearest' });
      };
      scroll.addEventListener('keydown', (e) => {
        const rows2 = visible().filter((r) => !r.hidden);
        if (e.key === 'ArrowDown') { e.preventDefault(); move(cursor + 1); }
        else if (e.key === 'ArrowUp') { e.preventDefault(); move(cursor < 0 ? 0 : cursor - 1); }
        else if (e.key === 'Home') { e.preventDefault(); move(0); scroll.scrollTop = 0; }
        else if (e.key === 'End') { e.preventDefault(); move(rows2.length - 1); }
        else if (e.key === 'Escape') { scroll.blur(); }
        else if (e.key === 'Enter' && cursor >= 0) { e.preventDefault(); openEntry(rows2[cursor].dataset.entry); }
      });

      const openEntry = (id) => {
        const e = ENTRIES.find((x) => x.id === id);
        if (!e) return;
        drawer({
          title: e.id,
          subtitle: `${dateLong(e.date)} · ${e.journal} · ${state_label[e.state]}`,
          body: `
            <div class="row" style="justify-content:space-between;margin-bottom:12px">
              <span>${stateBadge(e.state)}</span>
              <span class="muted" style="font-size:var(--t-12)">Prepared by ${esc(e.actor)}</span>
            </div>
            <p style="font-size:var(--t-13)">${esc(e.narrative)}</p>
            <div class="tablewrap" style="margin-top:14px;border:1px solid var(--hairline);border-radius:10px">
              <table class="tbl tbl--dense"><thead><tr><th scope="col">Account</th><th scope="col" class="r">Debit</th><th scope="col" class="r">Credit</th></tr></thead>
              <tbody>${e.lines.map((l) => `<tr><td><span class="mono">${esc(l.account)}</span> ${esc(account(l.account)?.name ?? '')}</td><td class="r num">${l.debit ? amount(l.debit) : ''}</td><td class="r num">${l.credit ? amount(l.credit) : ''}</td></tr>`).join('')}</tbody>
              <tfoot><tr><td>Total</td><td class="r num">${amount(e.debit)}</td><td class="r num">${amount(e.credit)}</td></tr></tfoot></table>
            </div>
            ${e.net !== 0 ? `<div class="alert alert--danger" style="margin-top:14px">${icon('alert')}<div><b>Out of balance by ${amount(Math.abs(e.net))}</b><p>This ${e.state === 'draft' ? 'draft' : 'entry'} cannot be posted until debits equal credits.</p></div></div>` : ''}
            ${e.attachments ? `<div class="row" style="margin-top:14px;gap:8px;font-size:var(--t-12)"><span class="tag">${esc(e.attachments)} attachment</span><span class="muted">invoice scan.pdf</span></div>` : ''}`,
          foot: `<button class="btn btn--sm" data-close>Close</button>
                 ${e.state === 'approval' ? `<button class="btn btn--primary btn--sm" data-approve="${esc(e.id)}">Open approval</button>` : ''}
                 ${e.state === 'draft' ? `<button class="btn btn--primary btn--sm" data-nav="/accounting/journals/new">Open draft</button>` : ''}`,
        });
        document.querySelector('.drawer [data-approve]')?.addEventListener('click', () => { document.querySelector('.drawer')?.remove(); ctx.navigate('/accounting/approvals'); });
      };

      body.addEventListener('click', (e) => {
        const link = e.target.closest('[data-open], a.rowlink');
        const tr = e.target.closest('tr[data-entry]');
        if (link) { e.preventDefault(); openEntry(link.dataset.open || tr?.dataset.entry); }
        else if (tr) { const rows2 = visible().filter((r) => !r.hidden); move(rows2.indexOf(tr)); }
      });

      view.querySelector('[data-export]')?.addEventListener('click', () => toast('Export prepared', `${ENTRIES.length} entries, CSV. In this preview the file is not written.`));
      view.querySelector('[data-print]')?.addEventListener('click', () => window.print());
    },
  };
}

/* ------------------------------------------------------------------- 3 entry */
const ACCOUNT_OPTIONS = ACCOUNTS.map((a) => `${a.code} ${a.name}`);

export function entry(ctx) {
  ctx.setTitle('New journal');
  const draft = [
    { acc: '6100 Rent', desc: 'Office rent and utilities — November', dr: 96000, cr: 0 },
    { acc: '6200 Utilities', desc: 'Electricity — head office', dr: 38200, cr: 0 },
    { acc: '6200 Utilities', desc: 'Water and internet — head office', dr: 12400, cr: 0 },
    { acc: '2100 Sales tax payable', desc: 'Sales tax on rent', dr: 0, cr: 21500 },
    { acc: '1100 Trade receivables', desc: 'Recharge to tenant — unit 4', dr: 0, cr: 124950 },
    { acc: '', desc: '', dr: 0, cr: 150 },
  ];

  const lineRow = (l, i) => `<tr>
      <td><select class="select select--sm" data-line="${i}" data-field="acc" aria-label="Account for line ${i + 1}" ${l.acc ? '' : 'aria-invalid="true"'} style="min-width:178px">
        <option value="">Choose an account</option>
        ${ACCOUNTS.map((a) => `<option value="${esc(a.code)} ${esc(a.name)}" ${l.acc === `${a.code} ${a.name}` ? 'selected' : ''}>${esc(a.code)} · ${esc(a.name)}</option>`).join('')}
      </select></td>
      <td><input class="input input--sm" data-line="${i}" data-field="desc" value="${esc(l.desc)}" aria-label="Description for line ${i + 1}" placeholder="What this line is for" style="min-width:150px"></td>
      <td><input class="input input--sm input--num" data-line="${i}" data-field="dr" value="${l.dr ? amount(l.dr) : ''}" inputmode="decimal" aria-label="Debit for line ${i + 1}" style="width:112px"></td>
      <td><input class="input input--sm input--num" data-line="${i}" data-field="cr" value="${l.cr ? amount(l.cr) : ''}" inputmode="decimal" aria-label="Credit for line ${i + 1}" style="width:112px"></td>
      <td class="r"><button class="btn btn--ghost btn--icon btn--sm" data-remove="${i}" aria-label="Remove line ${i + 1}" style="width:30px">${icon('trash')}</button></td>
    </tr>`;

  const html = `
  ${crumb([['Accounting', '/accounting'], ['Journal entries', '/accounting/journals'], ['New journal']])}
  ${pagehead('New journal', 'A draft with no ledger effect. Number is assigned when the entry is submitted.', `
    <button class="btn btn--sm" data-save>Save draft</button>
    <button class="btn btn--primary btn--sm" id="postBtn" disabled>Post entry</button>`)}

  <div class="grid grid--2-1">
    <div class="card">
      <div class="card__body" style="border-bottom:1px solid var(--hairline)">
        <div class="grid grid--2" style="gap:14px 16px">
          <label class="field"><span class="label">Entry date <span class="req">*</span></span>
            <input class="input" type="date" value="2026-11-20" aria-describedby="dateHint">
            <span class="hint" id="dateHint">Must fall inside an open period.</span></label>
          <label class="field"><span class="label">Journal</span>
            <select class="select"><option>General</option><option>Sales</option><option>Purchases</option><option>Cash &amp; bank</option></select>
            <span class="hint">Determines the number series.</span></label>
          <label class="field"><span class="label">Reference <span class="opt">optional</span></span>
            <input class="input" value="RENT-NOV" placeholder="Cross-reference"></label>
          <label class="field"><span class="label">Currency</span>
            <select class="select"><option>PKR — Pakistan rupee</option></select></label>
          <label class="field" style="grid-column:1/-1"><span class="label">Narrative <span class="req">*</span></span>
            <input class="input" value="Office rent and utilities — November 2026"></label>
          <label class="field" style="grid-column:1/-1"><span class="label">Internal note <span class="opt">not printed</span></span>
            <input class="input" placeholder="Visible to reviewers only"></label>
        </div>
      </div>
      <div class="tablewrap" style="max-height:340px">
        <table class="tbl tbl--dense" id="linesTable">
          <caption class="sr-only">Journal lines</caption>
          <thead><tr><th scope="col">Account</th><th scope="col">Description</th><th scope="col" class="r" style="width:120px">Debit</th><th scope="col" class="r" style="width:120px">Credit</th><th scope="col" style="width:48px"><span class="sr-only">Remove</span></th></tr></thead>
          <tbody id="linesBody">${draft.map(lineRow).join('')}</tbody>
          <tfoot><tr>
            <td colspan="2">Totals <span class="muted" id="lineCount" style="font-weight:400">${draft.length} lines</span></td>
            <td class="r num" id="totalDr">0.00</td><td class="r num" id="totalCr">0.00</td><td></td>
          </tr></tfoot>
        </table>
      </div>
      <div class="card__foot">
        <button class="btn btn--ghost btn--sm" id="addLine">${icon('plus')}Add line</button>
        <span id="lineError" class="err" role="status"></span>
        <span>Debits must equal credits before posting.</span>
      </div>
    </div>

    <aside class="stack">
      <div class="card">
        <div class="card__head"><h2>Balance</h2><span class="badge badge--danger" id="balBadge">Out of balance</span></div>
        <div class="card__body">
          <div class="row row--between" style="padding:6px 0;font-size:var(--t-13)"><span class="muted">Debits</span><b class="num" id="sumDr">0.00</b></div>
          <div class="row row--between" style="padding:6px 0;font-size:var(--t-13)"><span class="muted">Credits</span><b class="num" id="sumCr">0.00</b></div>
          <hr class="divider" style="margin:8px 0">
          <div class="row row--between" style="padding:6px 0;font-size:var(--t-13)"><span class="muted">Difference</span><b class="num" id="sumDiff" style="color:var(--danger)">0.00</b></div>
          <div class="hint" style="margin-top:8px" id="balanceHint">Assign an account to line 6 to include its 150.00.</div>
        </div>
      </div>
      <div id="imbalanceSlot"></div>
      <div class="card">
        <div class="card__head"><h2>Approval path</h2></div>
        <div class="card__body">
          <dl class="dl">
            <dt>Prepared by</dt><dd>${esc(BUSINESS.user.name)}</dd>
            <dt>Reviewer</dt><dd>Finance manager</dd>
            <dt>Posting</dt><dd>Direct — no review required</dd>
            <dt>Period</dt><dd>Nov 2026, open</dd>
          </dl>
        </div>
      </div>
      <div class="card">
        <div class="card__head"><h2>Evidence</h2></div>
        <div class="card__body">
          <div style="border:1px dashed var(--hairline-2);border-radius:10px;padding:18px;text-align:center;font-size:var(--t-12);color:var(--muted)">
            ${icon('paperclip')}<div style="margin-top:6px">Drop a receipt or invoice<br><span style="font-size:var(--t-11)">PDF or image, up to 10 MB</span></div>
          </div>
        </div>
      </div>
    </aside>
  </div>`;

  return {
    html,
    wire(view) {
      const body = view.querySelector('#linesBody');
      const rows = () => [...body.querySelectorAll('tr')];
      const read = (tr) => {
        const acc = tr.querySelector('[data-field="acc"]').value;
        return {
          acc,
          dr: parseAmount(tr.querySelector('[data-field="dr"]').value),
          cr: parseAmount(tr.querySelector('[data-field="cr"]').value),
        };
      };

      const recalc = () => {
        let dr = 0, cr = 0;
        for (const tr of rows()) {
          const l = read(tr);
          if (l.acc) { dr += l.dr; cr += l.cr; }
        }
        const diff = Math.round((dr - cr) * 100) / 100;
        view.querySelector('#totalDr').textContent = amount(dr);
        view.querySelector('#totalCr').textContent = amount(cr);
        view.querySelector('#sumDr').textContent = amount(dr);
        view.querySelector('#sumCr').textContent = amount(cr);
        view.querySelector('#sumDiff').textContent = amount(diff);
        view.querySelector('#lineCount').textContent = rows().length + ' lines';
        const balanced = Math.abs(diff) < 0.005;
        view.querySelector('#postBtn').disabled = !balanced;
        const badgeEl = view.querySelector('#balBadge');
        badgeEl.className = 'badge ' + (balanced ? 'badge--positive' : 'badge--danger');
        badgeEl.textContent = balanced ? 'Balanced' : 'Out of balance';
        view.querySelector('#sumDiff').style.color = balanced ? 'var(--positive)' : 'var(--danger)';
        view.querySelector('#imbalanceSlot').innerHTML = balanced ? '' : `<div class="alert alert--danger">${icon('alert')}<div><b>${diff > 0 ? 'Debits exceed credits' : 'Credits exceed debits'} by ${amount(Math.abs(diff))}</b><p>You can save this as a draft. Posting stays blocked until the difference is zero.</p></div></div>`;
        const hint = view.querySelector('#balanceHint');
        hint.textContent = balanced ? 'Entry balances. It can be posted.' : 'Assign an account to line 6 to include its 150.00.';
        const missing = rows().filter((tr) => !tr.querySelector('select').value).length;
        const err = view.querySelector('#lineError');
        if (err) err.innerHTML = missing ? icon('alert') + '<span>' + missing + ' line' + (missing > 1 ? 's have' : ' has') + ' no account and is excluded from the totals.</span>' : '';
      };

      body.addEventListener('input', recalc);
      body.addEventListener('change', (e) => {
        const sel = e.target.closest('select[data-field="acc"]');
        if (sel) {
          if (sel.value) sel.removeAttribute('aria-invalid');
          else sel.setAttribute('aria-invalid', 'true');
        }
        recalc();
      });
      body.addEventListener('blur', (e) => {
        if (e.target.matches('[data-field="dr"],[data-field="cr"]') && e.target.value.trim()) {
          e.target.value = amount(parseAmount(e.target.value));
          recalc();
        }
      }, true);
      body.addEventListener('click', (e) => {
        const rm = e.target.closest('[data-remove]');
        if (!rm) return;
        if (rows().length <= 2) { toast('Two lines minimum', 'A journal needs at least one debit and one credit.'); return; }
        rm.closest('tr').remove();
        recalc();
      });

      view.querySelector('#addLine').addEventListener('click', () => {
        const i = rows().length;
        body.insertAdjacentHTML('beforeend', lineRow({ acc: '', desc: '', dr: 0, cr: 0 }, i));
        body.querySelectorAll('tr')[i].querySelector('select').focus();
        recalc();
      });

      view.querySelector('#postBtn').addEventListener('click', () => {
        modal({
          title: 'Post this journal?',
          body: 'Posting writes an immutable entry to the general ledger. A later correction needs a reversing entry.',
          confirm: 'Post entry',
          note: 'Recorded against ' + BUSINESS.user.name,
          onConfirm: () => toast('Entry posted', 'The ledger has been updated and the register is now 201 entries.', 'positive'),
        });
      });
      view.querySelector('[data-save]').addEventListener('click', () => toast('Draft saved', 'No ledger effect until it is posted.'));

      recalc();
    },
  };
}

/* ------------------------------------------------------------------- 4 chart */
let selectedAccount = null;

export function chart(ctx) {
  ctx.setTitle('Chart of accounts');
  const groups = [...new Set(ACCOUNTS.map((a) => a.group))];
  const current = ctx.acctParam || selectedAccount || '1100';
  selectedAccount = current;

  const html = `
  ${crumb([['Accounting', '/accounting'], ['Chart of accounts']])}
  ${pagehead('Chart of accounts', 'The accounts everything posts into, grouped by statement section.', `
    <button class="btn btn--sm" data-export>${icon('download')}Export</button>
    <button class="btn btn--primary btn--sm" data-new>${icon('plus')}New account</button>`)}

  <div class="grid grid--1-2">
    <div class="card">
      <div class="card__body" style="padding-bottom:10px">
        <div class="search" style="width:100%;height:34px">${icon('search')}<input id="coaSearch" type="search" placeholder="Search code or account" aria-label="Search accounts"></div>
      </div>
      <div class="card__body card__body--flush" style="max-height:560px;overflow:auto" id="coaList">
        ${groups.map((g) => {
          const rows = ACCOUNTS.filter((a) => a.group === g);
          const total = rows.reduce((n, a) => n + balanceOf(a.code), 0);
          return `<div class="coa-group" data-group="${esc(g)}">
            <div class="row row--between" style="padding:10px 16px 6px;background:var(--surface-sunken)">
              <span class="eyebrow" style="font-size:10px">${esc(g)}</span>
              <span class="num" style="font-size:var(--t-11);color:var(--muted)">${amount(total)}</span>
            </div>
            ${rows.map((a) => `<button class="coa-item" data-account="${esc(a.code)}" aria-current="${a.code === current ? 'true' : 'false'}">
              <span class="mono">${esc(a.code)}</span><span>${esc(a.name)}</span><span class="num">${amount(balanceOf(a.code))}</span>
            </button>`).join('')}
          </div>`;
        }).join('')}
      </div>
    </div>
    <div id="coaDetail">${accountDetail(current)}</div>
  </div>`;

  return {
    html,
    wire(view) {
      const list = view.querySelector('#coaList');
      const search = view.querySelector('#coaSearch');
      search.addEventListener('input', () => {
        const q = search.value.trim().toLowerCase();
        view.querySelectorAll('.coa-item').forEach((b) => {
          b.hidden = q && !b.textContent.toLowerCase().includes(q);
        });
        view.querySelectorAll('.coa-group').forEach((g) => {
          g.hidden = ![...g.querySelectorAll('.coa-item')].some((b) => !b.hidden);
        });
      });
      list.addEventListener('click', (e) => {
        const b = e.target.closest('[data-account]');
        if (!b) return;
        selectedAccount = b.dataset.account;
        list.querySelectorAll('.coa-item').forEach((x) => x.setAttribute('aria-current', x === b ? 'true' : 'false'));
        view.querySelector('#coaDetail').innerHTML = accountDetail(selectedAccount);
        wireDetail(view);
      });
      view.querySelectorAll('[data-new]').forEach((b) => b.addEventListener('click', () => {
        const m = modal({
          title: 'New account',
          body: 'Accounts are added to a statement group. The code must be unique.',
          confirm: 'Create account',
          onConfirm: () => toast('Account created', 'The new account is available for posting.', 'positive'),
        });
        m.bodyEl.innerHTML = `
          <div class="grid grid--2" style="gap:14px">
            <label class="field"><span class="label">Code</span><input class="input" value="6700"></label>
            <label class="field"><span class="label">Type</span><select class="select"><option>Expense</option><option>Asset</option><option>Liability</option><option>Equity</option><option>Revenue</option></select></label>
            <label class="field" style="grid-column:1/-1"><span class="label">Name</span><input class="input" placeholder="Travel & accommodation"></label>
            <label class="field" style="grid-column:1/-1"><span class="label">Statement group</span><select class="select"><option>Operating expenses</option><option>Cost of sales</option><option>Current assets</option></select></label>
          </div>`;
      }));
      view.querySelector('[data-export]')?.addEventListener('click', () => toast('Export prepared', 'Chart of accounts, CSV.'));
      wireDetail(view);
      function wireDetail(root) {
        root.querySelectorAll('[data-goto-ledger]').forEach((b) => b.addEventListener('click', () => ctx.navigate('/accounting/ledger')));
      }
    },
  };

  function accountDetail(code) {
    const a = account(code);
    if (!a) return '';
    const bal = balanceOf(code);
    const mv = ENTRIES.filter((e) => e.state === 'posted' && e.lines.some((l) => l.account === code)).slice(0, 6);
    const typeLabel = { asset: 'Asset', liability: 'Liability', equity: 'Equity', revenue: 'Revenue', expense: 'Expense' }[a.type];
    return `<div class="card">
      <div class="card__head" style="align-items:flex-start">
        <div>
          <div class="row" style="gap:8px;margin-bottom:4px"><span class="mono">${esc(a.code)}</span><span class="badge badge--outline badge--plain">${typeLabel}</span>${a.control ? badge('Control account', 'brand') : ''}</div>
          <h2 style="font-family:var(--serif);font-size:var(--t-26);font-weight:400;letter-spacing:-.02em">${esc(a.name)}</h2>
          <p>${esc(a.group)} · balance as at ${esc(dateLong(BUSINESS.today))}</p>
        </div>
        <div class="right">
          <div class="muted" style="font-size:var(--t-12)">${a.side === 'D' ? 'Debit' : 'Credit'} balance</div>
          <div class="num" style="font-size:var(--t-26)">${amount(Math.abs(bal))}</div>
        </div>
      </div>
      <div class="card__body">
        <dl class="dl" style="grid-template-columns:auto 1fr">
          <dt>Opening balance</dt><dd>${amount(Math.abs(a.opening))}</dd>
          <dt>Movement this period</dt><dd>${amount(bal - (a.side === 'D' ? a.opening : -a.opening))}</dd>
          <dt>Postable</dt><dd>${a.control ? 'No — posted through the subledger' : 'Yes'}</dd>
          <dt>Tax treatment</dt><dd>${a.type === 'expense' ? 'Input tax applicable' : '—'}</dd>
        </dl>
      </div>
      <div class="card__head" style="padding-bottom:8px"><h3>Recent movement</h3><button class="btn btn--ghost btn--sm" data-goto-ledger>Open ledger ${icon('chevronRight')}</button></div>
      <div class="card__body card__body--flush">
        <div class="tablewrap" style="max-height:230px">
          <table class="tbl tbl--dense"><thead><tr><th scope="col" style="width:92px">Date</th><th scope="col">Entry</th><th scope="col" class="r" style="width:110px">Debit</th><th scope="col" class="r" style="width:110px">Credit</th></tr></thead>
          <tbody>${mv.map((e) => {
            const l = e.lines.find((x) => x.account === code);
            return `<tr><td>${esc(dateShort(e.date))}</td><td><span class="rowlink">${esc(e.id)}</span><span class="sub">${esc(e.narrative)}</span></td><td class="r num">${l.debit ? amount(l.debit) : ''}</td><td class="r num">${l.credit ? amount(l.credit) : ''}</td></tr>`;
          }).join('')}</tbody></table>
        </div>
      </div>
    </div>`;
  }
}

/* ------------------------------------------------------------------ 5 ledger */
export function ledger(ctx) {
  ctx.setTitle('General ledger');
  const code = ctx.acctParam || selectedAccount || '1010';
  selectedAccount = code;

  const html = `
  ${crumb([['Accounting', '/accounting'], ['General ledger']])}
  ${pagehead('General ledger', 'One account at a time: opening position, every posted movement, and the closing balance.', `
    <button class="btn btn--sm" data-print>${icon('printer')}Print</button>
    <button class="btn btn--sm" data-export>${icon('download')}Export</button>`)}

  <div class="card" style="margin-bottom:16px">
    <div class="card__body" style="display:flex;gap:12px;flex-wrap:wrap;align-items:flex-end">
      <label class="field" style="min-width:280px"><span class="label">Account</span>
        <select class="select" id="ledgerAccount">${ACCOUNTS.map((a) => `<option value="${a.code}" ${a.code === code ? 'selected' : ''}>${esc(a.code)} · ${esc(a.name)}</option>`).join('')}</select></label>
      <label class="field" style="min-width:180px"><span class="label">Period</span>
        <select class="select"><option>Nov 2026</option><option>Oct 2026</option></select></label>
      <div class="spacer"></div>
      <div class="row" style="gap:20px">
        <div><div class="muted" style="font-size:var(--t-11)">Opening</div><div class="num" id="lgOpen">—</div></div>
        <div><div class="muted" style="font-size:var(--t-11)">Closing</div><div class="num" id="lgClose" style="font-weight:600">—</div></div>
      </div>
    </div>
  </div>
  <div class="card">
    <div class="card__head"><div><h2 id="lgTitle">—</h2><p id="lgSub">—</p></div><span class="badge badge--outline badge--plain" id="lgCount">—</span></div>
    <div class="card__body card__body--flush">
      <div class="tablewrap" id="lgWrap" style="max-height:520px">
        <table class="tbl tbl--dense">
          <caption class="sr-only">Ledger movements</caption>
          <thead><tr><th scope="col" style="width:92px">Date</th><th scope="col" style="width:118px">Entry</th><th scope="col">Description</th><th scope="col" class="r" style="width:118px">Debit</th><th scope="col" class="r" style="width:118px">Credit</th><th scope="col" class="r" style="width:128px">Balance</th></tr></thead>
          <tbody id="lgBody"></tbody>
          <tfoot><tr><td colspan="3">Closing balance</td><td class="r num" id="lgDrTotal"></td><td class="r num" id="lgCrTotal"></td><td class="r num" id="lgFinal"></td></tr></tfoot>
        </table>
      </div>
    </div>
    <div class="card__foot"><span id="lgBasis">Posted entries only. Drafts and entries awaiting approval have no ledger effect.</span></div>
  </div>`;

  return {
    html,
    wire(view) {
      const draw = () => {
        const c = view.querySelector('#ledgerAccount').value;
        selectedAccount = c;
        const a = account(c);
        const opening = a.side === 'D' ? a.opening : -a.opening;
        const moves = ENTRIES.filter((e) => e.state === 'posted' && e.lines.some((l) => l.account === c)).slice().reverse();
        let running = opening;
        let dr = 0, cr = 0;
        view.querySelector('#lgBody').innerHTML = (moves.map((e) => {
          const l = e.lines.find((x) => x.account === c);
          running = Math.round((running + l.debit - l.credit) * 100) / 100;
          dr += l.debit; cr += l.credit;
          return `<tr><td>${esc(dateShort(e.date))}</td><td><span class="mono">${esc(e.id)}</span></td><td>${esc(e.narrative)}<span class="sub">${esc(e.source)}</span></td><td class="r num">${l.debit ? amount(l.debit) : ''}</td><td class="r num">${l.credit ? amount(l.credit) : ''}</td><td class="r num">${amount(running)}</td></tr>`;
        }).join('') || `<tr><td colspan="6"><div class="empty" style="padding:32px"><div class="empty__mark">${icon('ledger')}</div><h3>No posted movement</h3><p>This account has an opening balance but nothing posted in November.</p></div></td></tr>`) + '<tr class="spacer" aria-hidden="true"><td colspan="6"></td></tr>';
        view.querySelector('#lgTitle').textContent = `${a.code} · ${a.name}`;
        view.querySelector('#lgSub').textContent = `${a.group} · ${a.control ? 'control account' : 'postable account'}`;
        view.querySelector('#lgCount').textContent = `${moves.length} entries`;
        view.querySelector('#lgOpen').textContent = amount(opening);
        view.querySelector('#lgClose').textContent = amount(running);
        view.querySelector('#lgDrTotal').textContent = amount(dr);
        view.querySelector('#lgCrTotal').textContent = amount(cr);
        view.querySelector('#lgFinal').textContent = amount(running);
        view.querySelector('#lgBasis').textContent = `Opening ${amount(opening)} + debits ${amount(dr)} − credits ${amount(cr)} = ${amount(running)}. Posted entries only.`;
      };
      view.querySelector('#ledgerAccount').addEventListener('change', draw);
      view.querySelector('[data-export]').addEventListener('click', () => toast('Export prepared', 'Ledger extract, CSV.'));
      view.querySelector('[data-print]').addEventListener('click', () => window.print());
      draw();
    },
  };
}

/* ------------------------------------------------------------ 6 trial balance */
export function trial(ctx) {
  ctx.setTitle('Trial balance');
  const tb = TRIAL_BALANCE;
  const groups = [...new Set(tb.rows.map((r) => r.group))];

  const body = groups.map((g) => {
    const rows = tb.rows.filter((r) => r.group === g);
    const dr = rows.reduce((n, r) => n + r.debit, 0);
    const cr = rows.reduce((n, r) => n + r.credit, 0);
    return rows.filter((r) => r.debit || r.credit).map((r) => `<tr data-acct="${esc(r.code)}">
        <td><span class="mono">${esc(r.code)}</span></td>
        <td><a class="rowlink" href="#/accounting/ledger" data-ledger="${esc(r.code)}">${esc(r.name)}</a></td>
        <td class="r num">${r.debit ? amount(r.debit) : ''}</td>
        <td class="r num">${r.credit ? amount(r.credit) : ''}</td>
      </tr>`).join('') + `<tr style="background:var(--surface-sunken)">
        <td colspan="2" style="font-size:var(--t-11);letter-spacing:.08em;text-transform:uppercase;color:var(--muted)">${esc(g)}</td>
        <td class="r num strong">${amount(dr)}</td><td class="r num strong">${amount(cr)}</td>
      </tr>`;
  }).join('');

  const html = `
  ${crumb([['Accounting', '/accounting'], ['Trial balance']])}
  ${pagehead('Trial balance', `As at ${dateLong(BUSINESS.today)}. Every posted journal, sorted into debit and credit balances.`, `
    <button class="btn btn--sm" data-export>${icon('download')}Export</button>
    <button class="btn btn--sm" data-print>${icon('printer')}Print</button>`)}

  <div class="grid grid--4" style="margin-bottom:16px">
    ${kpi('Total debits', amount(tb.debit), '<span class="muted">All accounts</span>')}
    ${kpi('Total credits', amount(tb.credit), '<span class="muted">All accounts</span>')}
    ${kpi('Difference', amount(tb.difference), tb.balanced ? '<span class="badge badge--positive">Balanced</span>' : '<span class="badge badge--danger">Out of balance</span>', tb.balanced ? '' : 'kpi--alert')}
    ${kpi('Accounts with a balance', String(tb.rows.filter((r) => r.debit || r.credit).length), `<span class="muted">of ${ACCOUNTS.length} in the chart</span>`)}
  </div>

  <div class="card">
    <div class="card__head" style="padding-bottom:12px">
      <div><h2>Balances by statement group</h2><p>Subtotals are per group; the difference at the foot must be zero.</p></div>
      <label class="checkline" style="font-size:var(--t-12)"><input class="check" type="checkbox" id="hideZero"> Hide accounts with no balance</label>
    </div>
    <div class="card__body card__body--flush">
      <div class="tablewrap" style="max-height:520px">
        <table class="tbl" id="tbTable">
          <caption class="sr-only">Trial balance for November 2026</caption>
          <thead><tr><th scope="col" style="width:90px">Code</th><th scope="col">Account</th><th scope="col" class="r" style="width:150px">Debit</th><th scope="col" class="r" style="width:150px">Credit</th></tr></thead>
          <tbody>${body}<tr class="spacer" aria-hidden="true"><td colspan="4"></td></tr></tbody>
          <tfoot><tr><td colspan="2">Total</td><td class="r num">${amount(tb.debit)}</td><td class="r num">${amount(tb.credit)}</td></tr></tfoot>
        </table>
      </div>
    </div>
    <div class="card__foot">
      <span>${tb.balanced ? 'Debits equal credits. The ledger is internally consistent.' : `Debits and credits differ by ${amount(tb.difference)}.`}</span>
      <span class="badge ${tb.balanced ? 'badge--positive' : 'badge--danger'}">${tb.balanced ? 'Balanced' : 'Out of balance'}</span>
    </div>
  </div>`;

  return {
    html,
    wire(view) {
      view.querySelector('#hideZero')?.addEventListener('change', (e) => {
        view.querySelectorAll('#tbTable tbody tr').forEach((tr) => {
          if (!tr.dataset.acct) return;
          const cells = tr.querySelectorAll('td');
          const empty = !cells[2].textContent.trim() && !cells[3].textContent.trim();
          tr.hidden = e.target.checked && empty;
        });
      });
      view.querySelector('#tbTable').addEventListener('click', (e) => {
        const a = e.target.closest('[data-ledger]');
        if (a) { e.preventDefault(); ctx.acctParam = a.dataset.ledger; ctx.navigate('/accounting/ledger'); }
      });
      view.querySelector('[data-export]').addEventListener('click', () => toast('Export prepared', 'Trial balance, CSV.'));
      view.querySelector('[data-print]').addEventListener('click', () => window.print());
    },
  };
}

/* -------------------------------------------------- 7/8 receivables & payables */
function partyScreen(kind) {
  const isAr = kind === 'ar';
  const parties = isAr ? CUSTOMERS : SUPPLIERS;
  const aging = isAr ? AR_AGING : AP_AGING;
  const total = isAr ? RECEIVABLES : PAYABLES;

  const html = (ctx) => `
  ${crumb([['Accounting', '/accounting'], [isAr ? 'Receivables' : 'Payables']])}
  ${pagehead(isAr ? 'Receivables' : 'Payables',
    isAr ? 'Customer balances, ageing and what to chase this week.' : 'Supplier balances, due dates and the next payment run.',
    `${isAr ? '<button class="btn btn--sm" data-remind>' + icon('bell') + 'Send reminders</button>' : '<button class="btn btn--primary btn--sm" data-run>' + icon('arrows') + 'Payment run</button>'}`)}

  <div class="grid grid--4" style="margin-bottom:16px">
    ${kpi(isAr ? 'Total receivable' : 'Total payable', amount(total), `<span class="muted">${parties.length} ${isAr ? 'customers' : 'suppliers'}</span>`)}
    ${kpi('Overdue', amount(parties.reduce((n, p) => n + p.overdue, 0)), `<span class="muted">${parties.filter((p) => p.overdue > 0).length} parties</span>`, parties.some((p) => p.overdue > 0) ? 'kpi--alert' : '')}
    ${kpi('Over 60 days', amount(aging.totals['61–90'] + aging.totals['90+']), '<span class="muted">Escalate or provide for</span>')}
    ${kpi(isAr ? 'Oldest item' : 'Next payment', String(Math.max(...parties.map((p) => p.oldestDays))) + ' days', '<span class="muted">Ageing basis: due date</span>')}
  </div>

  <div class="card">
    <div class="card__head" style="padding-bottom:12px">
      <div><h2>${isAr ? 'Customer balances' : 'Supplier balances'}</h2><p>${isAr ? 'Open invoices only' : 'Unpaid bills only'}</p></div>
      <div class="search" style="width:260px;height:32px">${icon('search')}<input id="partySearch" type="search" placeholder="Search ${isAr ? 'customers' : 'suppliers'}" aria-label="Search"></div>
    </div>
    <div class="card__body card__body--flush">
      <div class="tablewrap" style="max-height:520px">
        <table class="tbl" id="partyTable">
          <caption class="sr-only">${isAr ? 'Customer' : 'Supplier'} balances</caption>
          <thead><tr>
            <th scope="col">${isAr ? 'Customer' : 'Supplier'}</th>
            <th scope="col" class="r" style="width:130px">Current</th>
            <th scope="col" class="r" style="width:130px">Overdue</th>
            <th scope="col" class="r" style="width:110px">Oldest</th>
            <th scope="col" class="r" style="width:140px">Balance</th>
            <th scope="col" style="width:44px"><span class="sr-only">Open</span></th>
          </tr></thead>
          <tbody>${parties.map((p) => `<tr data-party="${esc(p.id)}">
            <td><span class="rowlink">${esc(p.name)}</span><span class="sub">${p.invoices.length} ${isAr ? 'invoice' : 'bill'}${p.invoices.length > 1 ? 's' : ''}</span></td>
            <td class="r num">${amount(p.balance - p.overdue)}</td>
            <td class="r num" style="color:${p.overdue ? 'var(--danger)' : 'inherit'}">${p.overdue ? amount(p.overdue) : '0.00'}</td>
            <td class="r">${p.oldestDays ? `<span class="badge badge--danger">${p.oldestDays}d</span>` : '<span class="muted">—</span>'}</td>
            <td class="r num strong">${amount(p.balance)}</td>
            <td class="r"><button class="btn btn--ghost btn--icon btn--sm" data-open-party="${esc(p.id)}" aria-label="Open ${esc(p.name)}">${icon('chevronRight')}</button></td>
          </tr>`).join('')}<tr class="spacer" aria-hidden="true"><td colspan="6"></td></tr></tbody>
          <tfoot><tr><td>Total</td><td class="r num">${amount(parties.reduce((n, p) => n + (p.balance - p.overdue), 0))}</td><td class="r num">${amount(parties.reduce((n, p) => n + p.overdue, 0))}</td><td></td><td class="r num">${amount(total)}</td><td></td></tr></tfoot>
        </table>
      </div>
    </div>
  </div>`;

  return {
    html: (ctx) => html(ctx),
    wire(view, ctx) {
      const open = (id) => {
        const p = parties.find((x) => x.id === id);
        if (!p) return;
        drawer({
          title: p.name,
          subtitle: `${isAr ? 'Customer' : 'Supplier'} ${p.id} · ${amount(p.balance)} open`,
          body: `
            <div class="row" style="gap:8px;margin-bottom:14px">
              ${p.overdue ? badge(`${amount(p.overdue)} overdue`, 'danger') : badge('All current', 'positive')}
              <span class="tag">Ageing by due date</span>
            </div>
            <div class="tablewrap" style="border:1px solid var(--hairline);border-radius:10px">
              <table class="tbl tbl--dense"><thead><tr><th scope="col">Document</th><th scope="col" style="width:100px">Due</th><th scope="col" class="r" style="width:110px">Amount</th><th scope="col" style="width:100px">Age</th></tr></thead>
              <tbody>${p.invoices.map((inv) => `<tr>
                <td><span class="mono">${esc(inv.id)}</span></td>
                <td>${esc(dateShort(inv.due))}</td>
                <td class="r num">${amount(inv.amount)}</td>
                <td>${inv.overdueDays ? `<span class="badge badge--danger">${inv.overdueDays}d</span>` : badge('Current', 'positive')}</td>
              </tr>`).join('')}</tbody>
              <tfoot><tr><td colspan="2">Total</td><td class="r num">${amount(p.balance)}</td><td></td></tr></tfoot>
            </table>
          </div>
          <div class="alert alert--info" style="margin-top:14px">${icon('info')}<div><b>${isAr ? 'Collection note' : 'Payment terms'}</b><p>${isAr ? 'Statements are sent on the 1st. Anything over 60 days needs a written plan.' : 'Standard terms 30 days. Early settlement discount is 1.5% within 10 days.'}</p></div></div>`,
          foot: `<button class="btn btn--sm" data-close>Close</button><button class="btn btn--primary btn--sm" data-action>${isAr ? 'Record receipt' : 'Prepare payment'}</button>`,
        });
        document.querySelector('.drawer [data-action]')?.addEventListener('click', () => {
          toast(isAr ? 'Receipt drafted' : 'Payment staged', `${p.name} · ${amount(p.balance)}. Nothing is posted until it is approved.`);
        });
      };
      view.querySelector('#partyTable').addEventListener('click', (e) => {
        const b = e.target.closest('[data-open-party]') || e.target.closest('tr[data-party]');
        if (b) open(b.dataset.openParty || b.dataset.party);
      });
      view.querySelector('#partySearch').addEventListener('input', (e) => {
        const q = e.target.value.toLowerCase();
        view.querySelectorAll('#partyTable tbody tr').forEach((tr) => {
          tr.hidden = !tr.textContent.toLowerCase().includes(q);
        });
      });
      view.querySelector('[data-remind]')?.addEventListener('click', () => toast('Reminders queued', '4 customers with items over 60 days. Nothing is sent from this preview.'));
      view.querySelector('[data-run]')?.addEventListener('click', () => {
        const due = suppliers.filter((s) => s.overdue > 0);
        modal({
          title: 'Prepare payment run',
          body: `${due.length} suppliers with overdue bills. Payments are staged, never sent automatically.`,
          confirm: 'Stage payments',
          note: 'Requires approval above 100,000.00',
          onConfirm: () => toast('Payment run staged', `${due.length} payments, ${amount(due.reduce((n, s) => n + s.overdue, 0))}.`),
          wide: true,
        }).bodyEl.innerHTML = `<div class="tablewrap" style="border:1px solid var(--hairline);border-radius:10px">
          <table class="tbl tbl--dense"><thead><tr><th scope="col">Supplier</th><th scope="col" class="r">Overdue</th><th scope="col" class="r">Balance</th></tr></thead>
          <tbody>${due.map((s) => `<tr><td>${esc(s.name)}</td><td class="r num">${amount(s.overdue)}</td><td class="r num">${amount(s.balance)}</td></tr>`).join('')}</tbody>
          <tfoot><tr><td>Total</td><td class="r num">${amount(due.reduce((n, s) => n + s.overdue, 0))}</td><td class="r num">${amount(due.reduce((n, s) => n + s.balance, 0))}</td></tr></tfoot></table></div>`;
      });
    },
  };
}

export const receivables = (ctx) => partyScreen('ar').html(ctx) && attach(partyScreen('ar'), ctx);
export const payables = (ctx) => attach(partyScreen('ap'), ctx);

function attach(screen, ctx) {
  const out = screen.html(ctx);
  return { html: out, wire: (view) => screen.wire(view, ctx) };
}

/* ------------------------------------------------------------------- 9 aging */
export function aging(ctx) {
  ctx.setTitle('Ageing & schedules');
  const tab = ctx.acctParam || 'ar';

  const html = `
  ${crumb([['Accounting', '/accounting'], ['Ageing & schedules']])}
  ${pagehead('Ageing & schedules', 'Where the balance sits by age, and the schedules that will move it next month.')}
  <div class="card">
    <div class="card__body" style="padding-bottom:0">
      <div class="tabs" role="tablist" aria-label="Ageing and schedules">
        <button class="tab" role="tab" data-tab="ar" aria-selected="${tab === 'ar'}">Receivables ageing</button>
        <button class="tab" role="tab" data-tab="ap" aria-selected="${tab === 'ap'}">Payables ageing</button>
        <button class="tab" role="tab" data-tab="dep" aria-selected="${tab === 'dep'}">Depreciation</button>
        <button class="tab" role="tab" data-tab="rec" aria-selected="${tab === 'rec'}">Recurring journals</button>
        <button class="tab" role="tab" data-tab="pre" aria-selected="${tab === 'pre'}">Prepayments</button>
      </div>
    </div>
    <div id="agingPane"></div>
  </div>`;

  return {
    html,
    wire(view) {
      const pane = view.querySelector('#agingPane');
      const draw = (which) => {
        view.querySelectorAll('[data-tab]').forEach((t) => t.setAttribute('aria-selected', t.dataset.tab === which));
        pane.innerHTML = which === 'ar' || which === 'ap' ? ageingTable(which) : which === 'dep' ? depTable() : which === 'rec' ? recurringTable() : prepayTable();
        if (which === 'dep') pane.querySelectorAll('[data-dep]').forEach((b) => b.addEventListener('click', () => toast('Schedule opened', 'Depreciation line detail is part of the asset register.')));
      };
      view.addEventListener('click', (e) => {
        const t = e.target.closest('[data-tab]');
        if (t) draw(t.dataset.tab);
      });
      draw(tab);
    },
  };

  function ageingTable(kind) {
    const a = kind === 'ar' ? AR_AGING : AP_AGING;
    return `<div class="tablewrap" style="max-height:520px">
      <table class="tbl">
        <caption class="sr-only">${kind === 'ar' ? 'Receivables' : 'Payables'} ageing by bucket</caption>
        <thead><tr><th scope="col">${kind === 'ar' ? 'Customer' : 'Supplier'}</th>${a.buckets.map((b) => `<th scope="col" class="r" style="width:120px">${esc(b)}</th>`).join('')}<th scope="col" class="r" style="width:140px">Total</th></tr></thead>
        <tbody>${a.rows.map((r) => `<tr><td>${esc(r.name)}</td>${a.buckets.map((b) => `<td class="r num" style="${b !== 'Current' && r.cells[b] ? 'color:var(--danger)' : ''}">${r.cells[b] ? amount(r.cells[b]) : '—'}</td>`).join('')}<td class="r num strong">${amount(r.total)}</td></tr>`).join('')}</tbody>
        <tfoot><tr><td>Total</td>${a.buckets.map((b) => `<td class="r num">${amount(a.totals[b])}</td>`).join('')}<td class="r num">${amount(a.total)}</td></tr></tfoot>
      </table></div>
      <div class="card__foot"><span>Age is measured from the due date, not the document date.</span>
      <span class="badge ${a.totals['90+'] ? 'badge--danger' : 'badge--positive'}">${amount(a.totals['90+'])} over 90 days</span></div>`;
  }

  function depTable() {
    const totalCost = DEPRECIATION.reduce((n, d) => n + d.cost, 0);
    const totalAcc = DEPRECIATION.reduce((n, d) => n + d.accumulated, 0);
    const totalMonth = DEPRECIATION.reduce((n, d) => n + d.monthly, 0);
    return `<div class="tablewrap" style="max-height:520px">
      <table class="tbl">
        <caption class="sr-only">Depreciation schedule</caption>
        <thead><tr><th scope="col" style="width:88px">Code</th><th scope="col">Asset</th><th scope="col" class="r" style="width:130px">Cost</th><th scope="col" class="r" style="width:90px">Rate</th><th scope="col" class="r" style="width:130px">Monthly</th><th scope="col" class="r" style="width:140px">Accumulated</th><th scope="col" class="r" style="width:130px">Net book value</th></tr></thead>
        <tbody>${DEPRECIATION.map((d) => `<tr>
          <td><span class="mono">${esc(d.code)}</span></td>
          <td>${esc(d.name)}<span class="sub">${esc(d.method)} · from ${esc(dateShort(d.from))}</span></td>
          <td class="r num">${amount(d.cost)}</td>
          <td class="r num">${percent(d.rate)}</td>
          <td class="r num">${amount(d.monthly)}</td>
          <td class="r num">${amount(d.accumulated)}</td>
          <td class="r num strong">${amount(d.nbv)}</td>
        </tr>`).join('')}</tbody>
        <tfoot><tr><td colspan="2">Total</td><td class="r num">${amount(totalCost)}</td><td></td><td class="r num">${amount(totalMonth)}</td><td class="r num">${amount(totalAcc)}</td><td class="r num">${amount(totalCost - totalAcc)}</td></tr></tfoot>
      </table></div>
      <div class="card__foot"><span>November charge is drafted and posts with the close.</span><span class="badge badge--caution">1 journal pending</span></div>`;
  }

  function recurringTable() {
    return `<div class="tablewrap" style="max-height:520px">
      <table class="tbl">
        <caption class="sr-only">Recurring journals</caption>
        <thead><tr><th scope="col" style="width:90px">Ref</th><th scope="col">Template</th><th scope="col" style="width:110px">Account</th><th scope="col" class="r" style="width:130px">Amount</th><th scope="col" style="width:110px">Frequency</th><th scope="col" style="width:120px">Next run</th><th scope="col" style="width:120px">State</th></tr></thead>
        <tbody>${RECURRING.map((r) => `<tr>
          <td><span class="mono">${esc(r.id)}</span></td>
          <td>${esc(r.name)}</td>
          <td><span class="mono">${esc(r.account)}</span></td>
          <td class="r num">${amount(r.amount)}</td>
          <td>${esc(r.frequency)}</td>
          <td>${esc(dateShort(r.next))}</td>
          <td>${r.state === 'active' ? badge('Active', 'positive') : badge('Needs review', 'caution')}</td>
        </tr>`).join('')}</tbody>
        <tfoot><tr><td colspan="3">Total monthly equivalent</td><td class="r num">${amount(RECURRING.reduce((n, r) => n + (r.frequency === 'Monthly' ? r.amount : r.amount / 3), 0))}</td><td colspan="3"></td></tr></tfoot>
      </table></div>
      <div class="card__foot"><span>Templates never post automatically without an approval rule.</span><span class="badge badge--outline">5 templates</span></div>`;
  }

  function prepayTable() {
    return `<div class="tablewrap">
      <table class="tbl">
        <caption class="sr-only">Prepayments</caption>
        <thead><tr><th scope="col" style="width:90px">Ref</th><th scope="col">Prepayment</th><th scope="col" class="r" style="width:130px">Total</th><th scope="col" class="r" style="width:130px">Consumed</th><th scope="col" class="r" style="width:140px">Remaining</th><th scope="col" style="width:200px">Progress</th></tr></thead>
        <tbody>${PREPAYMENTS.map((p) => `<tr>
          <td><span class="mono">${esc(p.id)}</span></td>
          <td>${esc(p.name)}<span class="sub">${p.monthsLeft} months remaining</span></td>
          <td class="r num">${amount(p.total)}</td>
          <td class="r num">${amount(p.consumed)}</td>
          <td class="r num strong">${amount(p.remaining)}</td>
          <td>${progress(p.consumed, p.total)}</td>
        </tr>`).join('')}</tbody>
        <tfoot><tr><td colspan="2">Total</td><td class="r num">${amount(PREPAYMENTS.reduce((n, p) => n + p.total, 0))}</td><td class="r num">${amount(PREPAYMENTS.reduce((n, p) => n + p.consumed, 0))}</td><td class="r num">${amount(PREPAYMENTS.reduce((n, p) => n + p.remaining, 0))}</td><td></td></tr></tfoot>
      </table></div>
      <div class="card__foot"><span>Amortised monthly to the expense account on each schedule.</span></div>`;
  }
}

/* -------------------------------------------------------------- 10 statements */
export function statements(ctx) {
  ctx.setTitle('Financial statements');
  const tab = ctx.acctParam || 'pl';
  const p = PROFIT_AND_LOSS;
  const b = BALANCE_SHEET;

  const html = `
  ${crumb([['Accounting', '/accounting'], ['Financial statements']])}
  ${pagehead('Financial statements', `For the period 1 Nov – 30 Nov 2026. Comparative periods arrive with the close.`, `
    <button class="btn btn--sm" data-print>${icon('printer')}Print</button>
    <button class="btn btn--sm" data-export>${icon('download')}Export pack</button>`)}
  <div class="card">
    <div class="card__body" style="padding-bottom:0">
      <div class="tabs" role="tablist" aria-label="Statements">
        <button class="tab" role="tab" data-stab="pl" aria-selected="${tab === 'pl'}">Profit or loss</button>
        <button class="tab" role="tab" data-stab="bs" aria-selected="${tab === 'bs'}">Financial position</button>
      </div>
    </div>
    <div id="stmtPane"></div>
  </div>`;

  return {
    html,
    wire(view) {
      const pane = view.querySelector('#stmtPane');
      const draw = (which) => {
        view.querySelectorAll('[data-stab]').forEach((t) => t.setAttribute('aria-selected', t.dataset.stab === which));
        pane.innerHTML = which === 'pl' ? pnlMarkup() : bsMarkup();
      };
      view.addEventListener('click', (e) => {
        const t = e.target.closest('[data-stab]');
        if (t) draw(t.dataset.stab);
      });
      view.querySelector('[data-print]').addEventListener('click', () => window.print());
      view.querySelector('[data-export]').addEventListener('click', () => toast('Export prepared', 'Statement pack, PDF outline.'));
      draw(tab);
    },
  };

  function pnlMarkup() {
    const rows = (type, group) => ACCOUNTS.filter((a) => a.type === type && a.group === group).map((a) => {
      const v = type === 'revenue' ? -balanceOf(a.code) : balanceOf(a.code);
      if (!v) return '';
      return `<tr><td><span class="mono">${esc(a.code)}</span></td><td>${esc(a.name)}</td><td class="r num">${amount(v)}</td><td class="r num muted">${percent(p.revenue ? v / p.revenue : 0, 1)}</td></tr>`;
    }).join('');
    return `<div class="tablewrap"><table class="tbl">
      <caption class="sr-only">Profit or loss</caption>
      <thead><tr><th scope="col" style="width:90px">Code</th><th scope="col">Line</th><th scope="col" class="r" style="width:150px">Nov 2026</th><th scope="col" class="r" style="width:110px">% revenue</th></tr></thead>
      <tbody>
        <tr><td colspan="4" class="eyebrow" style="background:var(--surface-sunken);height:30px">Revenue</td></tr>
        ${rows('revenue', 'Revenue')}
        <tr style="background:var(--surface)"><td></td><td class="strong">Total revenue</td><td class="r num strong">${amount(p.revenue)}</td><td class="r num muted">100.0%</td></tr>
        <tr><td colspan="4" class="eyebrow" style="background:var(--surface-sunken);height:30px">Cost of sales</td></tr>
        ${rows('expense', 'Cost of sales')}
        <tr><td></td><td class="strong">Gross profit</td><td class="r num strong">${amount(p.gross)}</td><td class="r num muted">${percent(p.revenue ? p.gross / p.revenue : 0)}</td></tr>
        <tr><td colspan="4" class="eyebrow" style="background:var(--surface-sunken);height:30px">Operating expenses</td></tr>
        ${rows('expense', 'Operating expenses')}
        <tr><td></td><td class="strong">Operating result</td><td class="r num strong">${amount(p.net)}</td><td class="r num muted">${percent(p.revenue ? p.net / p.revenue : 0)}</td></tr>
      </tbody>
      <tfoot><tr><td colspan="2">Net profit for the period</td><td class="r num">${amount(p.net)}</td><td class="r num">${percent(p.margin)}</td></tr></tfoot>
    </table></div>
    <div class="card__foot"><span>Figures are derived from posted journals only.</span><span class="badge badge--positive">Margin ${percent(p.margin)}</span></div>`;
  }

  function bsMarkup() {
    const line = (label, value, strong = false, indent = false) => `<tr><td style="padding-left:${indent ? 28 : 12}px" class="${strong ? 'strong' : ''}">${esc(label)}</td><td class="r num ${strong ? 'strong' : ''}">${amount(value)}</td></tr>`;
    return `<div class="tablewrap"><table class="tbl">
      <caption class="sr-only">Statement of financial position</caption>
      <thead><tr><th scope="col">Position</th><th scope="col" class="r" style="width:170px">As at 20 Nov 2026</th></tr></thead>
      <tbody>
        <tr><td colspan="2" class="eyebrow" style="background:var(--surface-sunken);height:30px">Assets</td></tr>
        ${line('Current assets', b.currentAssets, true)}
        ${ACCOUNTS.filter((a) => a.type === 'asset' && a.group === 'Current assets').map((a) => line(`${a.code}  ${a.name}`, -balanceOf(a.code), false, true)).join('')}
        ${line('Non-current assets', b.nonCurrentAssets, true)}
        ${ACCOUNTS.filter((a) => a.type === 'asset' && a.group === 'Non-current assets').map((a) => line(`${a.code}  ${a.name}`, -balanceOf(a.code), false, true)).join('')}
        ${line('Total assets', b.totalAssets, true)}
        <tr><td colspan="2" class="eyebrow" style="background:var(--surface-sunken);height:30px">Liabilities</td></tr>
        ${line('Current liabilities', b.currentLiabilities, true)}
        ${line('Non-current liabilities', b.nonCurrentLiabilities, true)}
        ${line('Total liabilities', b.totalLiabilities, true)}
        <tr><td colspan="2" class="eyebrow" style="background:var(--surface-sunken);height:30px">Equity</td></tr>
        ${line('Share capital', b.equity - balanceOf('3100'))}
        ${line('Retained earnings brought forward', balanceOf('3100'))}
        ${line('Result for the period', b.result)}
        ${line('Total equity', b.totalEquity, true)}
      </tbody>
      <tfoot><tr><td>Total liabilities and equity</td><td class="r num">${amount(b.totalLiabilities + b.totalEquity)}</td></tr></tfoot>
    </table></div>
    <div class="card__foot">
      <span>${Math.abs(b.totalAssets - (b.totalLiabilities + b.totalEquity)) < 0.005 ? 'Assets equal liabilities plus equity.' : 'Position does not balance — investigate before close.'}</span>
      <span class="badge ${Math.abs(b.totalAssets - (b.totalLiabilities + b.totalEquity)) < 0.005 ? 'badge--positive' : 'badge--danger'}">${Math.abs(b.totalAssets - (b.totalLiabilities + b.totalEquity)) < 0.005 ? 'Balanced' : 'Out of balance'}</span>
    </div>`;
  }
}

/* --------------------------------------------------------------- 11 approvals */
export function approvals(ctx) {
  ctx.setTitle('Approvals');
  let queue = APPROVALS.slice();
  let selected = queue[0]?.entry.id;

  const html = `
  ${crumb([['Accounting', '/accounting'], ['Approvals']])}
  ${pagehead('Approvals', 'Journals that need a second pair of eyes before they reach the ledger.', `<span class="badge badge--caution">${queue.length} waiting</span>`)}
  <div class="grid grid--1-2">
    <div class="card">
      <div class="card__head"><h2>Queue</h2><span class="tag" id="queueCount">${queue.length}</span></div>
      <div class="card__body card__body--flush" id="queueList">${queueMarkup()}</div>
    </div>
    <div id="approvalDetail">${detailMarkup(selected)}</div>
  </div>`;

  function queueMarkup() {
    return queue.map((a) => `<button class="queue-item" data-item="${esc(a.entry.id)}" aria-current="${a.entry.id === selected ? 'true' : 'false'}">
      <div class="row row--between" style="gap:8px"><span class="mono">${esc(a.entry.id)}</span><span class="num strong">${amount(a.entry.debit)}</span></div>
      <div style="font-size:var(--t-12);color:var(--muted);margin-top:3px">${esc(a.entry.narrative)}</div>
      <div class="row" style="gap:8px;margin-top:6px"><span class="tag">${esc(a.reason)}</span><span class="tag">${esc(relative(a.submitted, BUSINESS.today))}</span></div>
    </button>`).join('') || `<div class="empty"><div class="empty__mark">${icon('check')}</div><h3>Queue is clear</h3><p>Nothing is waiting for review.</p></div>`;
  }

  function detailMarkup(id) {
    const a = queue.find((x) => x.entry.id === id);
    if (!a) return `<div class="card"><div class="empty"><div class="empty__mark">${icon('check')}</div><h3>Nothing selected</h3><p>Pick an item from the queue.</p></div></div>`;
    const e = a.entry;
    return `<div class="card">
      <div class="card__head" style="align-items:flex-start">
        <div>
          <div class="row" style="gap:8px;margin-bottom:4px">${stateBadge(e.state)}<span class="tag">${esc(e.source)}</span></div>
          <h2 style="font-family:var(--serif);font-size:var(--t-26);font-weight:400">${esc(e.narrative)}</h2>
          <p>${esc(e.id)} · ${esc(dateLong(e.date))} · prepared by ${esc(a.submittedBy)}</p>
        </div>
        <div class="right"><div class="muted" style="font-size:var(--t-12)">Entry value</div><div class="num" style="font-size:var(--t-26)">${amount(e.debit)}</div></div>
      </div>
      <div class="card__body" style="padding-top:0">
        <div class="alert alert--info" style="margin-bottom:14px">${icon('info')}<div><b>${esc(a.reason)}</b><p>Submitted ${esc(relative(a.submitted, BUSINESS.today))}. Approval posts the entry to the ledger.</p></div></div>
        <div class="tablewrap" style="border:1px solid var(--hairline);border-radius:10px">
          <table class="tbl tbl--dense"><thead><tr><th scope="col">Account</th><th scope="col" class="r">Debit</th><th scope="col" class="r">Credit</th></tr></thead>
          <tbody>${e.lines.map((l) => `<tr><td><span class="mono">${esc(l.account)}</span> ${esc(account(l.account)?.name ?? '')}</td><td class="r num">${l.debit ? amount(l.debit) : ''}</td><td class="r num">${l.credit ? amount(l.credit) : ''}</td></tr>`).join('')}</tbody>
          <tfoot><tr><td>Total</td><td class="r num">${amount(e.debit)}</td><td class="r num">${amount(e.credit)}</td></tr></tfoot></table>
        </div>
        ${e.net !== 0 ? `<div class="alert alert--danger" style="margin-top:12px">${icon('alert')}<div><b>This entry does not balance</b><p>It cannot be approved until debits equal credits.</p></div></div>` : ''}
      </div>
      <div class="card__foot">
        <button class="btn btn--sm" data-return>Return for correction</button>
        <div class="row" style="gap:8px"><button class="btn btn--sm" data-note>Add note</button><button class="btn btn--primary btn--sm" data-approve ${e.net !== 0 ? 'disabled' : ''}>Approve and post</button></div>
      </div>
    </div>`;
  }

  return {
    html,
    wire(view) {
      const redraw = () => {
        view.querySelector('#queueList').innerHTML = queueMarkup();
        view.querySelector('#queueCount').textContent = queue.length;
        view.querySelector('#approvalDetail').innerHTML = detailMarkup(selected);
      };
      view.addEventListener('click', (e) => {
        const item = e.target.closest('[data-item]');
        if (item) { selected = item.dataset.item; view.querySelectorAll('[data-item]').forEach((b) => b.setAttribute('aria-current', b === item ? 'true' : 'false')); view.querySelector('#approvalDetail').innerHTML = detailMarkup(selected); return; }
        if (e.target.closest('[data-approve]')) {
          modal({
            title: 'Approve and post?',
            body: 'The entry becomes immutable once posted. A correction needs a reversal.',
            confirm: 'Approve and post',
            note: 'Recorded against ' + BUSINESS.user.name,
            onConfirm: () => {
              queue = queue.filter((x) => x.entry.id !== selected);
              selected = queue[0]?.entry.id;
              redraw();
              toast('Entry approved', 'Posted to the general ledger.', 'positive');
            },
          });
          return;
        }
        if (e.target.closest('[data-return]')) {
          modal({
            title: 'Return for correction?',
            body: 'The preparer gets it back with your note. Nothing posts.',
            confirm: 'Return entry',
            danger: true,
            onConfirm: () => {
              queue = queue.filter((x) => x.entry.id !== selected);
              selected = queue[0]?.entry.id;
              redraw();
              toast('Returned to preparer', 'A note was added to the entry trail.');
            },
          }).bodyEl.innerHTML = `<label class="field"><span class="label">What needs correcting <span class="req">*</span></span><textarea class="textarea" placeholder="Be specific: the preparer sees only this note."></textarea></label>`;
          return;
        }
        if (e.target.closest('[data-note]')) toast('Note added', 'Visible on the entry trail, not on the printed voucher.');
      });
    },
  };
}
