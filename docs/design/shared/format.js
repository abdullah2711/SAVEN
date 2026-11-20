/* One formatting convention, used by every screen.
   Money: two decimals always, comma thousands, negatives in parentheses only.
   Never a minus sign and brackets together. Zero money prints 0.00. */

const nf = new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const nf0 = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });

/** 1234567.5 -> "1,234,567.50"; -1234 -> "(1,234.00)" */
export function amount(v) {
  const n = Number(v) || 0;
  const s = nf.format(Math.abs(n));
  return n < 0 ? `(${s})` : s;
}

/** Currency appears once, before the amount, separated by a space. */
export function money(v, code = 'PKR') {
  return `${code} ${amount(v)}`;
}

/** Whole-unit display for counts and quantities; never for money. */
export function count(v) {
  return nf0.format(Number(v) || 0);
}

/** 0.1749 -> "17.5%" (one decimal unless the rate is whole). */
export function percent(v, digits) {
  const n = Number(v) || 0;
  const d = digits === undefined ? (Math.abs(n * 100 - Math.round(n * 100)) < 0.01 ? 0 : 1) : digits;
  return `${(n * 100).toFixed(d)}%`;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** ISO date -> "20 Nov 2026". Used everywhere a date is read by a person. */
export function dateLong(iso) {
  if (!iso) return '—';
  const [y, m, d] = String(iso).slice(0, 10).split('-').map(Number);
  if (!y || !m || !d) return '—';
  return `${String(d).padStart(2, '0')} ${MONTHS[m - 1]} ${y}`;
}

/** ISO date -> "20 Nov 26". Only inside dense table columns. */
export function dateShort(iso) {
  if (!iso) return '—';
  const [y, m, d] = String(iso).slice(0, 10).split('-').map(Number);
  return `${String(d).padStart(2, '0')} ${MONTHS[m - 1]} ${String(y).slice(2)}`;
}

/** ISO weekday + short month for ledger sections. */
export function dateMedium(iso) {
  const [y, m, d] = String(iso).slice(0, 10).split('-').map(Number);
  return `${String(d).padStart(2, '0')} ${MONTHS[m - 1]} ${y}`;
}

export function daysBetween(a, b) {
  return Math.round((new Date(b) - new Date(a)) / 86400000);
}

/** "3 days ago" / "today" / "in 6 days" */
export function relative(iso, today) {
  const diff = daysBetween(iso, today);
  if (diff === 0) return 'today';
  if (diff === 1) return 'yesterday';
  if (diff > 1) return `${diff} days ago`;
  if (diff === -1) return 'tomorrow';
  return `in ${Math.abs(diff)} days`;
}

/** Accepts "1,234.50", "(1,234.50)", "1234.5" */
export function parseAmount(value) {
  const s = String(value ?? '').trim();
  if (!s) return 0;
  const negative = /^\(.*\)$/.test(s);
  const n = Number(s.replace(/[^0-9.]/g, '')) || 0;
  return negative ? -n : n;
}

export function addDays(iso, n) {
  const d = new Date(iso + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function isoToday() {
  return new Date().toISOString().slice(0, 10);
}
