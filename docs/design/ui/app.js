import { MODULES, GROUP_ORDER, SUMMARY } from '../shared/catalog.js';
import { mountAmbient } from '../shared/fx.js';
import { icon } from '../shared/icons.js';
import { esc, toast, modal, $, $$, badge } from './ui.js';
import { ACCOUNTS, BUSINESS, ENTRIES, CASH_POSITION, RECEIVABLES, PAYABLES, NET_POSITION, PROFIT_AND_LOSS, TRIAL_BALANCE, CASH_TREND, CLOSE_STEPS, APPROVALS, AR_AGING, AP_AGING, RECENT, PERIOD, BALANCE_SHEET } from './data.js';
import { amount, money, dateShort, dateLong, percent, relative, count } from '../shared/format.js';
import * as accounting from './accounting.js';

/* ------------------------------------------------------------------- routes */
const ROUTES = {
  '/accounting': accounting.dashboard,
  '/accounting/journals': accounting.register,
  '/accounting/journals/new': accounting.entry,
  '/accounting/chart': accounting.chart,
  '/accounting/ledger': accounting.ledger,
  '/accounting/trial-balance': accounting.trial,
  '/accounting/receivables': accounting.receivables,
  '/accounting/payables': accounting.payables,
  '/accounting/aging': accounting.aging,
  '/accounting/statements': accounting.statements,
  '/accounting/approvals': accounting.approvals,
};

const ACCOUNTING_NAV = [
  ['Overview', '/accounting'],
  ['Journal entries', '/accounting/journals'],
  ['Chart of accounts', '/accounting/chart'],
  ['General ledger', '/accounting/ledger'],
  ['Trial balance', '/accounting/trial-balance'],
  ['Receivables', '/accounting/receivables'],
  ['Payables', '/accounting/payables'],
  ['Aging & schedules', '/accounting/aging'],
  ['Financial statements', '/accounting/statements'],
  ['Approvals', '/accounting/approvals'],
];

const route = () => {
  const r = location.hash.replace(/^#/, '');
  return !r || r === '/' ? '/accounting' : r;
};
const state = {
  route: route(),
  collapsed: localStorage.getItem('saven.rail') === 'collapsed',
  expanded: localStorage.getItem('saven.acct') !== 'closed',
  theme: localStorage.getItem('saven.theme') || 'light',
  kill: null,
};

/* -------------------------------------------------------------------- shell */
function applyTheme() {
  document.documentElement.dataset.theme = state.theme;
  const btn = $('#themeBtn');
  if (btn) {
    btn.innerHTML = icon(state.theme === 'dark' ? 'sun' : 'moon');
    btn.setAttribute('aria-label', state.theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme');
    btn.title = state.theme === 'dark' ? 'Light theme' : 'Dark theme';
  }
}

function railMarkup() {
  let html = '';
  for (const group of GROUP_ORDER) {
    const mods = MODULES.filter((m) => m.group === group);
    if (!mods.length) continue;
    html += `<div class="rail__group"><div class="rail__label">${esc(group)}</div>`;
    for (const m of mods) {
      if (m.id === 'accounting') {
        const open = state.expanded;
        html += `<button class="rail__item" data-nav="/accounting" aria-current="${state.route.startsWith('/accounting') ? 'page' : 'false'}" aria-expanded="${open}" data-acct-toggle>
            ${icon('ledger')}<span>${esc(m.label)}</span>
            <span class="rail__chev">${icon('chevronRight', 'ic')}</span>
          </button>`;
        html += `<div class="rail__sub" ${open ? '' : 'hidden'}>` + ACCOUNTING_NAV.map(([label, path]) =>
          `<button class="rail__sublink" data-nav="${path}" aria-current="${state.route === path ? 'page' : 'false'}">${esc(label)}</button>`).join('') + '</div>';
      } else {
        const active = state.route === `/m/${m.id}`;
        html += `<button class="rail__item" data-nav="/m/${m.id}" aria-current="${active ? 'page' : 'false'}">
            ${icon(m.icon)}<span>${esc(m.label)}</span>
            ${m.phase === 'MVP-1' ? '' : `<span class="rail__count">${m.count}</span>`}
          </button>`;
      }
    }
    html += '</div>';
  }
  return html;
}

function shell(view) {
  return `
  <a class="skip" href="#view">Skip to content</a>
  <div class="app ${state.collapsed ? 'is-collapsed' : ''}" id="app">
    <aside class="rail" id="rail" aria-label="Modules">
      <div class="rail__top">
        <svg class="rail__mark" viewBox="0 0 32 26" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><path d="M2 2h28M2 13h19M2 24h11"/><path d="M24 18v6M21 21h6"/></svg>
        <div><div class="rail__word">SA7EN</div></div>
      </div>
      <nav class="rail__scroll" id="railNav">${railMarkup()}</nav>
      <div class="rail__foot">
        <button class="rail__biz" data-biz>
          <span class="rail__avatar">NT</span>
          <span class="rail__bizmeta"><b>${esc(BUSINESS.name)}</b><span>${esc(BUSINESS.branch)}</span></span>
          <span class="rail__dot" title="Connected"></span>
        </button>
      </div>
    </aside>

    <div class="main">
      <header class="topbar">
        <button class="topbar__icon rail-toggle" id="railToggle" aria-label="Open navigation" aria-expanded="false">${icon('menu')}</button>
        <button class="topbar__icon" id="collapseBtn" aria-label="Collapse navigation">${icon('panel')}</button>
        <div class="search" id="searchBox">
          ${icon('search')}
          <input id="searchInput" type="search" placeholder="Search entries, accounts, people" aria-label="Search" autocomplete="off">
          <kbd>⌘K</kbd>
          <div class="search__panel" id="searchPanel" hidden></div>
        </div>
        <div class="topbar__right">
          <button class="topbar__chip topbar__chip--hide" data-period>${icon('calendar')} Nov 2026</button>
          <button class="topbar__chip topbar__chip--hide" data-biz>${icon('building')} ${esc(BUSINESS.branch.split(' — ')[0])}</button>
          <button class="topbar__icon" id="themeBtn" aria-label="Switch theme">${icon('moon')}</button>
          <button class="topbar__icon" id="bellBtn" aria-label="Notifications">${icon('bell')}</button>
          <span class="avatar" title="${esc(BUSINESS.user.name)} — ${esc(BUSINESS.user.role)}">${esc(BUSINESS.user.initials)}</span>
        </div>
      </header>
      <main class="content" id="view"></main>
    </div>
  </div>`;
}

/* ---------------------------------------------------------------------- nav */
function navigate(path) {
  const [route, query] = path.split('?');
  state.acctParam = query ? new URLSearchParams(query).get('account') : state.acctParam;
  state.route = route;
  history.pushState({}, '', '#' + route);
  render();
}

function paintNav() {
  const nav = $('#railNav');
  if (!nav) return;
  nav.innerHTML = railMarkup();
  $('#app')?.classList.toggle('is-collapsed', state.collapsed);
  $('#rail')?.setAttribute('data-open', 'false');
}

/* ------------------------------------------------------------------- render */
function render() {
  state.kill?.();
  const path = state.route;
  const screen = ROUTES[path] || (path.startsWith('/m/') ? modulePage : null);
  document.body.innerHTML = shell();
  applyTheme();
  const ctx = { navigate, rerender: render, refreshNav: paintNav, setTitle: (t) => { document.title = `${t} · SA7EN`; } };
  const view = $('#view');
  if (!screen) { view.innerHTML = notFound(); bind(); return; }
  const out = screen(ctx);
  view.innerHTML = typeof out === 'string' ? out : out.html;
  view.dataset.route = path;
  bind();
  if (typeof out === 'object' && out.wire) out.wire(view, ctx);
  state.kill = mountAmbient(document.querySelector('.ambient') || document.createElement('div'));
  window.scrollTo(0, 0);
}

function bind() {
  $('#themeBtn')?.addEventListener('click', () => {
    state.theme = state.theme === 'dark' ? 'light' : 'dark';
    localStorage.setItem('saven.theme', state.theme);
    applyTheme();
  });
  $('#collapseBtn')?.addEventListener('click', () => {
    state.collapsed = !state.collapsed;
    localStorage.setItem('saven.rail', state.collapsed ? 'collapsed' : 'open');
    $('#app').classList.toggle('is-collapsed', state.collapsed);
  });
  $('#railToggle')?.addEventListener('click', () => {
    const rail = $('#rail');
    const open = rail.dataset.open !== 'true';
    rail.dataset.open = open ? 'true' : 'false';
    $('#railToggle').setAttribute('aria-expanded', open ? 'true' : 'false');
  });
  $('#bellBtn')?.addEventListener('click', () => {
    const items = APPROVALS.slice(0, 4);
    const host = document.createElement('div');
    host.className = 'modal';
    host.innerHTML = `<div class="modal__box" role="dialog" aria-modal="true" aria-labelledby="n-title" style="max-width:420px">
      <div class="modal__head"><div style="flex:1"><h2 id="n-title">Notifications</h2><p>${items.length} items need your attention</p></div>
      <button class="btn btn--ghost btn--icon btn--sm" data-close aria-label="Close">${icon('x')}</button></div>
      <div class="modal__body" style="display:grid;gap:12px">
        ${items.map((a) => `<div class="row" style="align-items:flex-start;gap:10px">
          <span style="width:6px;height:6px;border-radius:50%;background:var(--caution);margin-top:7px"></span>
          <div style="flex:1"><b style="display:block;font-size:var(--t-13)">${esc(a.entry.id)} needs approval</b>
          <span class="muted" style="font-size:var(--t-12)">${esc(a.reason)} · ${esc(dateShort(a.entry.date))} · ${money(a.entry.debit)}</span></div></div>`).join('')}
      </div>
      <div class="modal__foot"><button class="btn" data-close>Close</button>
      <button class="btn btn--primary" data-goto="/accounting/approvals">Open approvals</button></div></div>`;
    document.body.appendChild(host);
    host.addEventListener('click', (e) => {
      if (e.target === host || e.target.closest('[data-close]')) host.remove();
      const go = e.target.closest('[data-goto]');
      if (go) { host.remove(); navigate(go.dataset.goto); }
    });
  });

  if (!bind.bound) {
    bind.bound = true;
    document.addEventListener('click', navClick);
    document.addEventListener('click', acctToggle, true);
    bindSearch();
  }
}

function navClick(e) {
  const go = e.target.closest('[data-nav]');
  if (!go) return;
  e.preventDefault();
  navigate(go.dataset.nav);
}

function acctToggle(e) {
  const t = e.target.closest('[data-acct-toggle]');
  if (!t) return;
  e.preventDefault();
  e.stopPropagation();
  state.expanded = !state.expanded;
  localStorage.setItem('saven.acct', state.expanded ? 'open' : 'closed');
  paintNav();
}

/* ------------------------------------------------------------------ search */
let searchIndex = null;
function index() {
  if (searchIndex) return searchIndex;
  const built = [
    ['Accounting overview', '/accounting'], ['Journal entries', '/accounting/journals'], ['New journal', '/accounting/journals/new'],
    ['Chart of accounts', '/accounting/chart'], ['General ledger', '/accounting/ledger'], ['Trial balance', '/accounting/trial-balance'],
    ['Receivables', '/accounting/receivables'], ['Payables', '/accounting/payables'], ['Aging & schedules', '/accounting/aging'],
    ['Financial statements', '/accounting/statements'], ['Approvals', '/accounting/approvals'],
  ].map(([label, path]) => ({ label, path, kind: 'Page' }));
  const accounts = (awaitAccounts()).map((a) => ({ label: `${a.code} · ${a.name}`, path: '/accounting/chart?account=' + a.code, kind: 'Account' }));
  const screens = MODULES.flatMap((m) => m.screens.map((s) => ({ label: s.title, path: `/m/${m.id}`, kind: m.label + ' · ' + s.id })));
  searchIndex = [...built, ...accounts, ...screens];
  return searchIndex;
}

let accountsCache = null;
function awaitAccounts() { accountsCache ||= ACCOUNTS; return accountsCache; }

function bindSearch() {
  const box = $('#searchBox');
  const input = $('#searchInput');
  const panel = $('#searchPanel');
  if (!box || !input) return;

  const close = () => { panel.hidden = true; };
  const draw = () => {
    const q = input.value.trim().toLowerCase();
    if (!q) { panel.hidden = true; return; }
    const hits = index().filter((i) => i.label.toLowerCase().includes(q) || i.kind.toLowerCase().includes(q)).slice(0, 8);
    panel.innerHTML = hits.length
      ? hits.map((h, i) => `<button data-goto="${esc(h.path)}" data-i="${i}">${icon(h.kind === 'Account' ? 'ledger' : h.kind === 'Page' ? 'doc' : 'grid')}<span style="margin-left:0">${esc(h.label)}</span><span>${esc(h.kind)}</span></button>`).join('')
      : `<div style="padding:12px;font-size:var(--t-12);color:var(--muted)">No page or account matches “${esc(input.value)}”.</div>`;
    panel.hidden = false;
  };

  input.addEventListener('input', draw);
  input.addEventListener('focus', draw);
  input.addEventListener('keydown', (e) => {
    const items = $$('button', panel);
    const active = panel.querySelector('[data-active="true"]');
    if (e.key === 'Escape') { close(); input.blur(); }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!items.length) return;
      let i = items.indexOf(active);
      i = e.key === 'ArrowDown' ? Math.min(items.length - 1, i + 1) : Math.max(0, i - 1);
      items.forEach((n) => n.removeAttribute('data-active'));
      items[i].setAttribute('data-active', 'true');
      items[i].scrollIntoView({ block: 'nearest' });
    }
    if (e.key === 'Enter') {
      const target = active || items[0];
      if (target) { e.preventDefault(); close(); navigate(target.dataset.goto); }
    }
  });
  panel.addEventListener('click', (e) => {
    const b = e.target.closest('[data-goto]');
    if (!b) return;
    close();
    navigate(b.dataset.goto);
  });
  box.addEventListener('focusout', (e) => { if (!box.contains(e.relatedTarget)) close(); });

  document.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); input.focus(); input.select(); }
    if (e.key === '/' && document.activeElement?.tagName !== 'INPUT' && document.activeElement?.tagName !== 'TEXTAREA') {
      e.preventDefault(); input.focus();
    }
  });
}

/* -------------------------------------------------------------- module page */
function modulePage(ctx) {
  const id = state.route.replace('/m/', '');
  const m = MODULES.find((x) => x.id === id);
  if (!m) return notFound();
  ctx.setTitle(m.label);
  const rows = m.screens.map((s) => `<tr>
      <td><span class="mono">${esc(s.id)}</span></td>
      <td class="strong">${esc(s.title)}</td>
      <td>${s.status === 'building' ? badge('In build', 'caution') : badge('Planned', 'outline')}</td>
      <td class="r"><span class="tag">${m.phase}</span></td>
    </tr>`).join('');
  return `
  <div class="crumbs"><a href="#/accounting">Workspace</a><span>/</span><span>${esc(m.label)}</span></div>
  <div class="pagehead">
    <div>
      <h1>${esc(m.label)}</h1>
      <p>${esc(m.blurb)}</p>
    </div>
    <div class="pagehead__actions">
      <span class="badge badge--outline badge--plain">${esc(m.phase)}</span>
      <span class="badge ${m.building ? 'badge--caution' : 'badge--outline'}">${m.building ? m.building + ' in build' : 'Not started'}</span>
    </div>
  </div>
  <div class="card">
    <div class="card__head">
      <div><h2>${m.count} screens in scope</h2><p>Defined in the requirement inventory. Working screens are being built module by module, accounting first.</p></div>
      <span class="badge badge--outline badge--plain">${esc(m.id)}</span>
    </div>
    <div class="card__body card__body--flush">
      <div class="tablewrap">
        <table class="tbl tbl--dense">
          <caption class="sr-only">Screens in ${esc(m.label)}</caption>
          <thead><tr><th scope="col" style="width:120px">Requirement</th><th scope="col">Screen</th><th scope="col" style="width:140px">Design</th><th scope="col" class="r" style="width:90px">Phase</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    </div>
    <div class="card__foot">
      <span>This module is not built yet. The page exists so the scope is visible, not hidden.</span>
      <button class="btn btn--sm" data-nav="/accounting">Go to Accounting</button>
    </div>
  </div>`;
}

function notFound() {
  return `<div class="card" style="margin-top:40px"><div class="empty">
    <div class="empty__mark">${icon('search')}</div>
    <h3>That page does not exist</h3>
    <p>The link may be out of date. Everything built today lives under Accounting.</p>
    <div class="empty__actions"><button class="btn btn--primary" data-nav="/accounting">Open Accounting</button></div>
  </div></div>`;
}

/* ------------------------------------------------------------------- start */
window.addEventListener('popstate', () => {
  state.route = route();
  render();
});
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', render);
else render();
