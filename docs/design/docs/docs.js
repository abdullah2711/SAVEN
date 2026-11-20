import { MODULES, SUMMARY, GROUP_ORDER } from '../shared/catalog.js';
import { icon } from '../shared/icons.js';
import { esc } from '../ui/ui.js';
import { amount, money, dateLong, dateShort, percent } from '../shared/format.js';

/* Where a requirement is visible in the working application today. */
const LIVE = {
  'ACC-001': ['Chart of accounts', '/app/#/accounting/chart'],
  'ACC-003': ['Journal preparation', '/app/#/accounting/journals/new'],
  'ACC-005': ['Journal register', '/app/#/accounting/journals'],
  'ACC-011': ['Close readiness', '/app/#/accounting'],
  'ACC-017': ['Financial statements', '/app/#/accounting/statements'],
  'ACC-018': ['Posting preview', '/app/#/accounting/journals/new'],
  'ACC-006': ['Cash position', '/app/#/accounting'],
  'SAL-003': ['Receivables', '/app/#/accounting/receivables'],
  'SAL-008': ['Receivables oversight', '/app/#/accounting/receivables'],
  'PUR-004': ['Payables', '/app/#/accounting/payables'],
  'PUR-008': ['Payable oversight', '/app/#/accounting/payables'],
  'AST-003': ['Depreciation schedule', '/app/#/accounting/aging'],
  'SAL-001': ['Customer balances', '/app/#/accounting/receivables'],
  'PUR-001': ['Supplier balances', '/app/#/accounting/payables'],
  'ACC-013': ['Aging & schedules', '/app/#/accounting/aging'],
};

const PAGES = [
  ['Overview', '/overview'], ['Modules', '/modules'], ['Screens', '/screens'],
  ['Design system', '/system'], ['Number & date rules', '/formats'], ['Delivery phases', '/roadmap'], ['Sources', '/sources'],
];

const route = () => (location.hash.replace(/^#/, '') || '/overview');
const body = () => document.getElementById('docBody');

/* ------------------------------------------------------------------ layout */
function shell(title, content) {
  return `
  <div class="doc">
    <aside class="doc__rail" data-open="false" id="docRail">
      <div class="doc__brand">
        <svg viewBox="0 0 32 26" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><path d="M2 2h28M2 13h19M2 24h11"/><path d="M24 18v6M21 21h6"/></svg>
        <div><b>SA7EN</b><span>Design library</span></div>
      </div>
      <nav class="doc__nav">
        ${PAGES.map(([label, path]) => `<a href="#${path}" data-nav="${path}" ${route().startsWith(path) ? 'aria-current="page"' : ''}>${esc(label)}</a>`).join('')}
        <div class="doc__group">Modules</div>
        ${GROUP_ORDER.map((g) => `<div class="doc__group" style="padding-top:8px">${esc(g)}</div>
          ${MODULES.filter((m) => m.group === g).map((m) => `<a href="#/module/${m.id}" data-nav="/module/${m.id}" ${route() === '/module/' + m.id ? 'aria-current="page"' : ''}>${icon(m.icon)}<span>${esc(m.label)}</span></a>`).join('')}`).join('')}
      </nav>
      <div class="doc__foot"><a href="/app/">Open the application</a><br><span>${SUMMARY.screens} screens · ${SUMMARY.modules} modules</span></div>
    </aside>
    <div class="doc__main">
      <div class="doc__top">
        <button class="btn btn--ghost btn--icon btn--sm" id="docMenu" aria-label="Open navigation">${icon('menu')}</button>
        <h2>${esc(title)}</h2>
        <span class="spacer"></span>
        <a class="btn btn--sm" href="/app/">Open application ${icon('chevronRight')}</a>
      </div>
      <div class="doc__body" id="docBody">${content}</div>
    </div>
  </div>`;
}

/* ------------------------------------------------------------------- pages */
function overview() {
  const built = MODULES.filter((m) => m.building).reduce((n, m) => n + m.building, 0);
  return `
  <h1>Design library</h1>
  <p class="doc__lede">Every screen the product is required to have, the phase it lands in, and whether a design exists. This page set is the map; the working application is separate and linked from the top right.</p>
  <div class="doc__stats">
    <div class="doc__stat"><b>${SUMMARY.screens}</b><span>screen mappings</span><em>across ${SUMMARY.modules} module areas</em></div>
    <div class="doc__stat"><b>269</b><span>distinct requirements</span><em>13 requirements sit in two modules</em></div>
    <div class="doc__stat"><b>${SUMMARY.byPhase['MVP-1'].modules}</b><span>MVP 1 modules</span><em>${SUMMARY.byPhase['MVP-1'].screens} screens</em></div>
    <div class="doc__stat"><b>${SUMMARY.byPhase['MVP-2'].modules}</b><span>MVP 2 modules</span><em>${SUMMARY.byPhase['MVP-2'].screens} screens</em></div>
  </div>
  <div class="doc__card">
    <h2 style="margin-top:0">What is actually built</h2>
    <p>Accounting is the first module. Eleven working screens exist in the application: overview, journal register, new journal, chart of accounts, general ledger, trial balance, receivables, payables, ageing and schedules, financial statements and approvals. They are wired to one deterministic fixture ledger, so every figure reconciles: trial balance difference 0.00, assets equal liabilities plus equity.</p>
    <p>No other module has working screens yet. Each one has a page here that lists its screens and says plainly that it is not built.</p>
    <p style="margin-bottom:0"><a class="btn btn--primary" href="/app/">Open the accounting workspace ${icon('chevronRight')}</a></p>
  </div>
  <h2>Modules</h2>
  <div class="doc__modules">
    ${MODULES.map((m) => `<a class="doc__module" href="#/module/${m.id}">
      <b>${icon(m.icon)}${esc(m.label)}</b>
      <p>${esc(m.blurb)}</p>
      <div class="meta"><span class="tag">${esc(m.phase)}</span><span>${m.count} screens</span>${m.building ? `<span class="badge badge--caution">${m.building} in build</span>` : ''}</div>
    </a>`).join('')}
  </div>`;
}

function modules() {
  return `
  <h1>Modules</h1>
  <p class="doc__lede">Twenty-five module areas, grouped the way the navigation groups them. Screen counts come from the requirement inventory, not from this site.</p>
  ${GROUP_ORDER.map((g) => {
    const mods = MODULES.filter((m) => m.group === g);
    return `<h2>${esc(g)} <span class="muted" style="font-size:12px;font-weight:400">${mods.length} modules · ${mods.reduce((n, m) => n + m.count, 0)} screens</span></h2>
    <div class="doc__modules" style="margin-top:8px">
      ${mods.map((m) => `<a class="doc__module" href="#/module/${m.id}">
        <b>${icon(m.icon)}${esc(m.label)}</b>
        <p>${esc(m.blurb)}</p>
        <div class="meta"><span class="tag">${esc(m.phase)}</span><span>${m.count} screens</span>${m.building ? `<span class="badge badge--caution">${m.building} in build</span>` : ''}</div>
      </a>`).join('')}
    </div>`;
  }).join('')}`;
}

function modulePage(id) {
  const m = MODULES.find((x) => x.id === id);
  if (!m) return `<h1>Unknown module</h1><p>No module has the id <code>${esc(id)}</code>.</p>`;
  const built = m.screens.filter((s) => s.status === 'building').length;
  return `
  <p class="doc__lede" style="margin-bottom:6px">${esc(m.group)}</p>
  <h1>${esc(m.label)}</h1>
  <p class="doc__lede">${esc(m.blurb)}</p>
  <div class="doc__stats" style="grid-template-columns:repeat(3,minmax(0,1fr))">
    <div class="doc__stat"><b>${m.count}</b><span>screens</span><em>requirement inventory</em></div>
    <div class="doc__stat"><b>${built}</b><span>in build</span><em>${built ? 'design work started' : 'nothing started'}</em></div>
    <div class="doc__stat"><b>${esc(m.phase)}</b><span>delivery phase</span><em>${m.cross ? 'required in every phase' : 'see Delivery phases'}</em></div>
  </div>
  <div class="doc__card" style="padding:0;overflow:hidden">
    <div class="scroll" style="max-height:520px;overflow:auto">
      <table class="doc__table">
        <caption class="sr-only">Screens in ${esc(m.label)}</caption>
        <thead><tr><th scope="col" style="width:110px">Requirement</th><th scope="col">Screen</th><th scope="col" style="width:120px">Design</th><th scope="col" style="width:90px">Phase</th><th scope="col" style="width:110px">In application</th></tr></thead>
        <tbody>${m.screens.map((s) => `<tr>
          <td><span class="mono">${esc(s.id)}</span></td>
          <td>${esc(s.title)}</td>
          <td>${s.status === 'building' ? '<span class="badge badge--caution">In build</span>' : '<span class="badge badge--outline">Planned</span>'}</td>
          <td><span class="tag">${esc(m.phase)}</span></td>
          <td>${LIVE[s.id] ? `<a class="rowlink" href="${LIVE[s.id][1]}">${esc(LIVE[s.id][0])}</a>` : '<span class="muted">—</span>'}</td>
        </tr>`).join('')}</tbody>
      </table>
    </div>
  </div>
  <p style="font-size:12px;color:var(--muted)">“In build” means design work has started on this requirement, not that the workflow is finished or approved. Nothing in this inventory is approved for release.</p>`;
}

function screens() {
  const all = MODULES.flatMap((m) => m.screens.map((s) => ({ ...s, module: m.id, moduleLabel: m.label, phase: m.phase })));
  return `
  <h1>Screens</h1>
  <p class="doc__lede">All ${all.length} screen mappings. Filter by module, phase or design state. A requirement can appear in more than one module, which is why the count is higher than 269.</p>
  <div class="doc__filters">
    <input class="input input--sm" id="sSearch" type="search" placeholder="Search screen or requirement" style="width:280px" aria-label="Search screens">
    <select class="select select--sm" id="sPhase" aria-label="Phase"><option value="">All phases</option><option>MVP-1</option><option>MVP-2</option></select>
    <select class="select select--sm" id="sStatus" aria-label="Design state"><option value="">Any design state</option><option value="building">In build</option><option value="planned">Planned</option></select>
    <select class="select select--sm" id="sModule" aria-label="Module"><option value="">All modules</option>${MODULES.map((m) => `<option value="${m.id}">${esc(m.label)}</option>`).join('')}</select>
    <span class="tag" id="sCount" style="margin-left:auto">${all.length} shown</span>
  </div>
  <div class="doc__scroll">
    <table class="doc__table" id="sTable">
      <caption class="sr-only">All required screens</caption>
      <thead><tr><th scope="col" style="width:96px">ID</th><th scope="col">Screen</th><th scope="col" style="width:150px">Module</th><th scope="col" style="width:90px">Phase</th><th scope="col" style="width:110px">Design</th></tr></thead>
      <tbody>${all.map((s) => `<tr data-phase="${s.phase}" data-status="${s.status}" data-module="${s.module}">
        <td><span class="mono">${esc(s.id)}</span></td>
        <td>${esc(s.title)}</td>
        <td>${esc(s.moduleLabel)}</td>
        <td><span class="tag">${esc(s.phase)}</span></td>
        <td>${s.status === 'building' ? '<span class="badge badge--caution">In build</span>' : '<span class="badge badge--outline">Planned</span>'}</td>
      </tr>`).join('')}</tbody>
    </table>
  </div>`;
}

function swatch(name, token, role, contrast) {
  return `<div class="swatch"><i style="background:var(--${token})"></i><div><b>${esc(name)}</b><span>${esc(role)}</span><code>--${token}${contrast ? ' · ' + contrast : ''}</code></div></div>`;
}

function system() {
  return `
  <h1>Design system</h1>
  <p class="doc__lede">Plum and ash: warm paper, graphite ink, one brand plum, and three consequence colours. The rules below are enforced in the application, not just described here.</p>

  <h2>Colour roles</h2>
  <p>Colour carries a job, never decoration. The accent is the only saturated colour allowed on a large surface.</p>
  <div class="swatches">
    ${swatch('Paper', 'paper', 'Page ground between panels', 'ink 14.5:1')}
    ${swatch('Surface', 'surface', 'Cards, tables, inputs', 'ink 15.7:1')}
    ${swatch('Sunken', 'surface-sunken', 'Table head, sticky totals, tags')}
    ${swatch('Ink', 'ink', 'Primary text, amounts', '15.7:1 on surface')}
    ${swatch('Muted', 'muted', 'Labels, meta, secondary text', '5.4:1 on surface')}
    ${swatch('Plum', 'plum', 'Primary action, active tab, links, rails', '11.2:1 on paper')}
    ${swatch('Positive', 'positive', 'Posted, balanced, reconciled', '6.1:1 on surface')}
    ${swatch('Caution', 'caution', 'Draft, pending approval', '5.6:1 on surface')}
    ${swatch('Danger', 'danger', 'Rejected, overdue, destructive', '7.1:1 on surface')}
  </div>
  <ul>
    <li>Amounts never change colour to show sign. Parentheses carry sign; a dot plus a word carries state.</li>
    <li>Status badges pair a coloured dot with a word, so colour is redundant, never load-bearing.</li>
    <li>Contrast minimums: 4.5:1 for text, 3:1 for borders and focus rings. Every pair above is measured, not estimated.</li>
  </ul>

  <h2>Type</h2>
  <p>System stacks only — no webfonts, no network. The serif is used for page titles and the ambient band, never below 20px and never for numbers.</p>
  <div class="example">
    <dt>Display 38px serif</dt><dd style="font-family:var(--serif);font-size:38px;line-height:1.08">Accounting</dd>
    <dt>Page title 26px</dt><dd style="font-size:26px;letter-spacing:-.02em">Trial balance</dd>
    <dt>Panel title 14px</dt><dd style="font-size:14px;font-weight:600">Recent entries</dd>
    <dt>Body 14px</dt><dd style="font-size:14px">Every figure is built from posted journals.</dd>
    <dt>Table 13px</dt><dd style="font-size:13px">Supplier bill — Pak Print House</dd>
    <dt>Label 12px</dt><dd style="font-size:12px;color:var(--muted)">Must fall inside an open period.</dd>
    <dt>Column head 10.5px</dt><dd style="font-size:10.5px;letter-spacing:.09em;text-transform:uppercase;color:var(--muted);font-weight:600">Debit</dd>
    <dt>Amounts</dt><dd style="font-variant-numeric:tabular-nums">1,284,930.00 &nbsp; (193,204.75) &nbsp; 0.00</dd>
  </div>

  <h2>Space, radius, elevation</h2>
  <ul>
    <li>Spacing is a 4px scale (4, 8, 12, 16, 20, 24, 32, 40, 48, 64). Page padding 24px, card padding 18–20px, table cell 10–12px.</li>
    <li>Radius: 6px small controls, 8px inputs and buttons, 10px panels, 20px the ambient band. Nothing is pill-shaped except filter chips and count badges.</li>
    <li>Elevation is scarce: cards get one soft shadow, overlays get a heavier one. A card that sits on paper can also just be a hairline.</li>
  </ul>

  <h2>Components and states</h2>
  <div class="doc__card">
    <table class="doc__table">
      <thead><tr><th scope="col">Component</th><th scope="col">States covered</th></tr></thead>
      <tbody>
        <tr><td>Button</td><td>primary, secondary, ghost, danger, icon, sizes · hover, focus-visible, active, disabled, busy</td></tr>
        <tr><td>Input / select / textarea</td><td>default, hover, focus, invalid, readonly, disabled, numeric</td></tr>
        <tr><td>Checkbox</td><td>unchecked, checked, indeterminate, invalid, disabled</td></tr>
        <tr><td>Table</td><td>sticky head, sticky totals, row hover, selected, keyboard cursor, void row, empty, loading</td></tr>
        <tr><td>Tabs</td><td>selected, hover, disabled, counts, overflow scroll</td></tr>
        <tr><td>Modal / drawer</td><td>focus trap, escape, return focus, destructive variant</td></tr>
        <tr><td>Alert / toast</td><td>info, positive, caution, danger · dismiss, actions</td></tr>
        <tr><td>Badge / tag / chip</td><td>outline, positive, caution, danger, brand, pressed</td></tr>
        <tr><td>Empty / loading / error</td><td>first use, filtered empty, skeleton, spinner, inline error, panel error with retry</td></tr>
      </tbody>
    </table>
  </div>

  <h2>Focus and keyboard</h2>
  <ul>
    <li>Every interactive element has a 2px focus ring at 2px offset. On plum surfaces the ring switches to chalk.</li>
    <li>The register is one tab stop: arrow keys move a row cursor, Home/End jump, Enter opens, Escape leaves.</li>
    <li>Modals and drawers trap focus and return it to the control that opened them.</li>
    <li>Density: 38px standard rows, 32px dense rows in registers and schedules.</li>
  </ul>`;
}

function formats() {
  const rows = [
    ['Currency in prose', money(412880.4), 'Code before the amount, one space, no symbol confusion.'],
    ['Currency in a column', '412,880.40', 'The column header carries PKR once; cells stay bare so digits align.'],
    ['Decimals', amount(96000), 'Always two, even for whole amounts.'],
    ['Negative', amount(-24000), 'Parentheses only. Never a minus sign, never both.'],
    ['Thousands', amount(1284930), 'Comma every three digits.'],
    ['Zero in money', amount(0), 'Zero prints 0.00, never a dash.'],
    ['Not applicable', '—', 'A dash means the field does not apply, never that the value is zero.'],
    ['Empty matrix cell', '—', 'Inside an ageing matrix a dash means no item in that bucket; totals still print 0.00.'],
    ['Date, read by a person', dateLong('2026-11-20'), 'Day, short month, year.'],
    ['Date, dense column', dateShort('2026-11-20'), 'Two-digit year only inside a table column.'],
    ['Date input', '2026-11-20', 'Native controls and machine exchange use ISO 8601.'],
    ['Percentage', percent(0.175), 'One decimal, no space before the sign.'],
    ['Whole rate', percent(0.18, 0), 'Whole rates show no decimals.'],
    ['Count', '1,284', 'Counts group thousands but never show decimals.'],
  ];
  return `
  <h1>Number and date rules</h1>
  <p class="doc__lede">One rule per case, applied by every screen through one formatter. If a value looks different in two places, that is a defect.</p>
  <div class="doc__card" style="padding:0;overflow:hidden">
    <table class="doc__table">
      <thead><tr><th scope="col" style="width:210px">Case</th><th scope="col" style="width:180px">Rendered</th><th scope="col">Rule</th></tr></thead>
      <tbody>${rows.map(([c, v, r]) => `<tr><td>${esc(c)}</td><td style="font-variant-numeric:tabular-nums"><b>${esc(v)}</b></td><td style="white-space:normal;color:var(--muted)">${esc(r)}</td></tr>`).join('')}</tbody>
    </table>
  </div>
  <h2>Why parentheses</h2>
  <p>Brackets are unambiguous in a ledger column, survive black-and-white printing, and never collide with a minus sign typed by mistake. A single convention also means a column can be scanned vertically for the shape of a loss.</p>
  <h2>Alignment</h2>
  <p>Every amount uses tabular figures and right alignment. Decimal points line up vertically across a column, including inside parentheses. Currency codes never repeat in a column, because that would push the digits out of alignment.</p>`;
}

function roadmap() {
  const col = (phase) => {
    const mods = MODULES.filter((m) => m.phase === phase);
    const screens = mods.reduce((n, m) => n + m.count, 0);
    return `<div class="phase-col">
      <h3>${phase}<span class="tag">${screens} screens</span></h3>
      <p style="font-size:12px;color:var(--muted);margin:0">${phase === 'MVP-1' ? 'Managed accounting clients. Accounting first, then Settings, then the connected trading modules.' : 'Broader market release: operations, planning, HR, documents, integrations and AI.'}</p>
      <ul>${mods.map((m) => `<li><span>${esc(m.label)}</span><span class="muted">${m.count}</span></li>`).join('')}</ul>
    </div>`;
  };
  return `
  <h1>Delivery phases</h1>
  <p class="doc__lede">The requirement inventory has no phase field, so this mapping is derived from the governing revision. The rule used here, and the document it comes from, is stated below so it can be checked.</p>
  <div class="phase-cols">${col('MVP-1')}${col('MVP-2')}</div>
  <h2>Where the split comes from</h2>
  <div class="doc__card">
    <p><b>docs/50-accounting-dashboard-and-mvp1-revision.md</b> — the declared governing revision for delivery:</p>
    <ul>
      <li>MVP 1 is for managed consulting/accounting clients: “Finish Accounting in full first, then Settings, then the connected Selling, Buying, Payments, Customers &amp; suppliers, Taxes, Cash &amp; bank, Inventory, Assets and POS workflows.” Identity, authorisation, entitlement, backup and audit controls stay working throughout.</li>
      <li>MVP 2 is the broader market release: “Complete broader ops/commercial administration, remaining agreed Manufacturing, Reports, Finance &amp; planning, AI, Drive, Apps, CRM, Projects, HR and other baseline scope.”</li>
    </ul>
    <p style="margin-bottom:0">Two modules are marked <b>required in every phase</b>: Administration (security) and the Design system, because both are cross-cutting rather than deliverables that can wait.</p>
  </div>
  <h2>What the phases mean for design</h2>
  <ul>
    <li>A phase is not an approval. Nothing in this inventory is approved for release; every screen still carries <code>NOT_APPROVED</code>.</li>
    <li>Building a screen early does not move its module's phase. Accounting screens exist because accounting is first, not because the rest of MVP 1 is done.</li>
    <li>MVP 1 does not remove any MVP 2 requirement. The full market scope stays in the inventory.</li>
  </ul>`;
}

function sources() {
  const docs = [
    ['docs/ui-screen-inventory.json', 'The screen inventory this site is generated from: 282 mappings over 269 requirements in 25 module areas.'],
    ['docs/feature-catalog.json', 'The requirement catalogue: 269 requirements, 20 families, all marked commercial-release required.'],
    ['docs/50-accounting-dashboard-and-mvp1-revision.md', 'The governing revision that defines MVP 1 and MVP 2.'],
    ['docs/48-accounting-first-owner-revision.md', 'The ordered delivery: Accounting, Settings, connected modules, then broader scope.'],
    ['docs/40-frontend-module-completion-plan.md', 'The frontend completion order and honest planned-page requirement.'],
    ['docs/39-ui-first-brand-and-origin-revision.md', 'Brand, origin split and the palette rules this system follows.'],
    ['contracts/delivery-checklist.json', 'The operative task queue; its area ordering matches the delivery sequence.'],
    ['docs/design/DESIGN_SYSTEM.md', 'The written design rules, including contrast minimums and tab order.'],
    ['docs/design/NUMBER_AND_DATE_FORMATS.md', 'The written number and date conventions with examples.'],
  ];
  return `
  <h1>Sources</h1>
  <p class="doc__lede">Nothing on this site is invented. Screen counts, titles and identifiers are read directly from the repository inventory by <code>docs/design/build/make-catalog.mjs</code>. Phase assignment is derived and documented.</p>
  <div class="doc__card" style="padding:0;overflow:hidden">
    <table class="doc__table">
      <thead><tr><th scope="col" style="width:340px">Source</th><th scope="col">What it establishes</th></tr></thead>
      <tbody>${docs.map(([f, d]) => `<tr><td><code>${esc(f)}</code></td><td style="white-space:normal;color:var(--muted)">${esc(d)}</td></tr>`).join('')}</tbody>
    </table>
  </div>
  <h2>Known limits of this library</h2>
  <ul>
    <li>The application at <a href="/app/">/app/</a> runs on a deterministic fixture ledger. It is a design build, not a deployed product.</li>
    <li>Design status is coarse: in build or planned. It does not claim completeness or approval.</li>
    <li>Reporting and finance sit in MVP 2 per the governing revision even though they read as “accounting”; that assignment is deliberate and traceable above.</li>
  </ul>`;
}

/* ------------------------------------------------------------------ render */
function render() {
  const r = route();
  let title = 'Design library';
  let content;
  if (r === '/overview' || r === '/') content = overview();
  else if (r === '/modules') content = modules();
  else if (r.startsWith('/module/')) { const id = r.split('/')[2]; title = (MODULES.find((m) => m.id === id)?.label) || 'Module'; content = modulePage(id); }
  else if (r === '/screens') content = screens();
  else if (r === '/system') { title = 'Design system'; content = system(); }
  else if (r === '/formats') { title = 'Number and date rules'; content = formats(); }
  else if (r === '/roadmap') { title = 'Delivery phases'; content = roadmap(); }
  else if (r === '/sources') content = sources();
  else content = `<h1>Not found</h1><p><a href="#/overview">Back to the overview</a></p>`;

  document.getElementById('app').innerHTML = shell(title, content);
  document.title = title + ' · SA7EN design library';
  wire();
}

function wire() {
  document.getElementById('docMenu')?.addEventListener('click', () => {
    const rail = document.getElementById('docRail');
    rail.dataset.open = rail.dataset.open === 'true' ? 'false' : 'true';
  });

  const table = document.getElementById('sTable');
  if (table) {
    const q = document.getElementById('sSearch');
    const phase = document.getElementById('sPhase');
    const status = document.getElementById('sStatus');
    const mod = document.getElementById('sModule');
    const count = document.getElementById('sCount');
    const apply = () => {
      const text = q.value.trim().toLowerCase();
      let shown = 0;
      for (const tr of table.tBodies[0].rows) {
        const ok = (!text || tr.textContent.toLowerCase().includes(text))
          && (!phase.value || tr.dataset.phase === phase.value)
          && (!status.value || tr.dataset.status === status.value)
          && (!mod.value || tr.dataset.module === mod.value);
        tr.hidden = !ok;
        if (ok) shown++;
      }
      count.textContent = shown + ' shown';
    };
    [q, phase, status, mod].forEach((el) => el.addEventListener('input', apply));
  }
}

window.addEventListener('hashchange', render);
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', render);
else render();
