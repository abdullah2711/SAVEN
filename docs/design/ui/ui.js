import { icon } from '../shared/icons.js';

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export { icon };

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

/* ------------------------------------------------------------------- toast */
let toastHost;
export function toast(title, body = '', kind = '') {
  if (!toastHost || !toastHost.isConnected) {
    toastHost = document.createElement('div');
    toastHost.className = 'toasts';
    toastHost.setAttribute('role', 'status');
    toastHost.setAttribute('aria-live', 'polite');
    document.body.appendChild(toastHost);
  }
  const el = document.createElement('div');
  el.className = `toast ${kind ? 'toast--' + kind : ''}`;
  el.innerHTML = `<div>${icon(kind === 'danger' ? 'alert' : kind === 'positive' ? 'check' : 'info')}<b>${esc(title)}</b>${body ? `<p>${esc(body)}</p>` : ''}</div>`;
  toastHost.appendChild(el);
  setTimeout(() => el.remove(), 6000);
}

/* ------------------------------------------------------------------ dialog */
let lastFocus = null;

export function modal({ title, body, confirm = 'Confirm', cancel = 'Cancel', danger = false, note = '', onConfirm, wide = false }) {
  closeModal();
  lastFocus = document.activeElement;
  const host = document.createElement('div');
  host.className = 'modal';
  host.innerHTML = `
    <div class="modal__box" role="dialog" aria-modal="true" aria-labelledby="m-title" style="${wide ? 'max-width:720px' : ''}">
      <div class="modal__head">
        <div style="flex:1">
          <h2 id="m-title">${esc(title)}</h2>
          ${body ? `<p>${esc(body)}</p>` : ''}
        </div>
        <button class="btn btn--ghost btn--icon btn--sm" data-close aria-label="Close dialog">${icon('x')}</button>
      </div>
      <div class="modal__body" id="m-body"></div>
      <div class="modal__foot">
        ${note ? `<span class="modal__note">${esc(note)}</span>` : ''}
        <button class="btn" data-close>${esc(cancel)}</button>
        <button class="btn ${danger ? 'btn--danger' : 'btn--primary'}" data-confirm>${esc(confirm)}</button>
      </div>
    </div>`;
  document.body.appendChild(host);
  const box = host.querySelector('.modal__box');
  host.addEventListener('click', (e) => {
    if (e.target === host || e.target.closest('[data-close]')) closeModal();
    if (e.target.closest('[data-confirm]')) { onConfirm?.(); closeModal(); }
  });
  document.addEventListener('keydown', trap);
  setTimeout(() => (box.querySelector('[data-confirm]') || box).focus?.(), 0);
  return { box, bodyEl: box.querySelector('#m-body') };
}

function trap(e) {
  if (e.key === 'Escape') return closeModal();
  if (e.key !== 'Tab') return;
  const host = $('.modal');
  if (!host) return;
  const items = $$('button,[href],input,select,textarea,[tabindex]:not([tabindex="-1"])', host).filter((n) => !n.disabled);
  if (!items.length) return;
  const first = items[0], last = items[items.length - 1];
  if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
  else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
}

export function closeModal() {
  document.removeEventListener('keydown', trap);
  $('.modal')?.remove();
  if (lastFocus?.focus) lastFocus.focus();
}

/* ------------------------------------------------------------------ drawer */
export function drawer({ title, subtitle = '', body = '', foot = '' }) {
  closeDrawer();
  const host = document.createElement('aside');
  host.className = 'drawer';
  host.setAttribute('role', 'dialog');
  host.setAttribute('aria-modal', 'true');
  host.innerHTML = `
    <div class="drawer__head">
      <div style="flex:1">
        <h2 style="font-family:var(--serif);font-size:var(--t-20);font-weight:400">${esc(title)}</h2>
        ${subtitle ? `<p class="muted" style="font-size:var(--t-12);margin-top:4px">${esc(subtitle)}</p>` : ''}
      </div>
      <button class="btn btn--ghost btn--icon btn--sm" data-close aria-label="Close panel">${icon('x')}</button>
    </div>
    <div class="drawer__body">${body}</div>
    ${foot ? `<div class="drawer__foot">${foot}</div>` : ''}`;
  const scrim = document.createElement('button');
  scrim.className = 'scrim';
  scrim.dataset.open = 'true';
  scrim.setAttribute('aria-label', 'Close panel');
  document.body.append(scrim, host);
  requestAnimationFrame(() => host.dataset.open = 'true');
  const close = () => closeDrawer();
  scrim.addEventListener('click', close);
  host.addEventListener('click', (e) => { if (e.target.closest('[data-close]')) close(); });
  document.addEventListener('keydown', onKey);
  function onKey(e) { if (e.key === 'Escape') close(); }
  host.dataset.close = '1';
  return host;
}

export function closeDrawer() {
  $$('.drawer').forEach((d) => d.remove());
  $$('.scrim').forEach((s) => s.remove());
}

/* ------------------------------------------------------------------- chart */
/** Smooth area chart from [{value}], returns SVG markup. */
export function areaChart(points, { width = 640, height = 150, id = 'a' } = {}) {
  if (!points.length) return '';
  const values = points.map((p) => p.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const pad = (max - min) * 0.18 || 1;
  const lo = min - pad, hi = max + pad;
  const x = (i) => (i / (points.length - 1)) * width;
  const y = (v) => height - ((v - lo) / (hi - lo)) * height;

  const d = points.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.value).toFixed(1)}`).join(' ');
  const area = `${d} L${width},${height} L0,${height} Z`;
  const last = points[points.length - 1];
  return `<svg viewBox="0 0 ${width} ${height}" width="100%" height="${height}" preserveAspectRatio="none" role="img" aria-label="Cash balance trend">
    <defs>
      <linearGradient id="g-${id}" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="var(--plum)" stop-opacity=".20"/>
        <stop offset="100%" stop-color="var(--plum)" stop-opacity="0"/>
      </linearGradient>
    </defs>
    <path d="${area}" fill="url(#g-${id})"/>
    <path d="${d}" fill="none" stroke="var(--plum)" stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round" vector-effect="non-scaling-stroke"/>
    <circle cx="${x(points.length - 1)}" cy="${y(last.value)}" r="3" fill="var(--plum)" stroke="var(--surface)" stroke-width="2" vector-effect="non-scaling-stroke"/>
  </svg>`;
}

/** Horizontal proportion bar used for aging. */
export function stackBar(parts) {
  const total = parts.reduce((n, p) => n + p.value, 0) || 1;
  return `<div style="display:flex;height:8px;border-radius:99px;overflow:hidden;background:var(--surface-sunken)">
    ${parts.map((p) => `<span title="${esc(p.label)}" style="width:${((p.value / total) * 100).toFixed(2)}%;background:${p.color}"></span>`).join('')}
  </div>`;
}

export function progress(value, total) {
  const pct = total ? Math.min(100, (value / total) * 100) : 0;
  return `<div style="height:6px;border-radius:99px;background:var(--surface-sunken);overflow:hidden">
    <span style="display:block;height:100%;width:${pct.toFixed(1)}%;background:var(--plum);border-radius:99px"></span>
  </div>`;
}

/* ------------------------------------------------------------------ helpers */
export const badge = (label, kind = '') =>
  `<span class="badge ${kind ? 'badge--' + kind : ''}">${esc(label)}</span>`;

const STATES = {
  posted: ['Posted', 'positive'],
  approval: ['Awaiting approval', 'caution'],
  draft: ['Draft', ''],
  returned: ['Returned', 'danger'],
  reversed: ['Reversed', 'outline'],
};
export function stateBadge(state) {
  const [label, kind] = STATES[state] ?? [state, ''];
  return badge(label, kind);
}

export function mountAmbientSlot(el) {
  // Filled by the router after the screen is in the document.
  return el;
}

export { $, $$ };
