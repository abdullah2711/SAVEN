import { requireThat } from './errors.mjs';

// Amounts cross the API as decimal strings. BigInt performs all arithmetic;
// only range-checked integer minor units enter SQLite/D1 (never floating money).
export const MAX_MINOR = 999_999_999_999;
export function minor(value, { positive = false } = {}) {
  requireThat(typeof value === 'string' && /^(0|[1-9]\d{0,9})(\.\d{1,2})?$/.test(value), 422, 'INVALID_AMOUNT', 'Use a decimal amount with at most two decimal places.');
  const [whole, fraction = ''] = value.split('.');
  const amount = BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0'));
  requireThat(amount <= BigInt(MAX_MINOR) && (!positive || amount > 0n), 422, 'INVALID_AMOUNT', 'Amount must be within the supported range and greater than zero.');
  return Number(amount);
}
export function decimal(value) {
  const amount = BigInt(value), sign = amount < 0n ? '-' : '', absolute = amount < 0n ? -amount : amount;
  return `${sign}${absolute / 100n}.${String(absolute % 100n).padStart(2, '0')}`;
}
export function quantity(value) {
  requireThat(typeof value === 'string' && /^[1-9]\d{0,5}$/.test(value), 422, 'INVALID_QUANTITY', 'This first stock workflow supports positive whole units, up to 999999.');
  return Number(value);
}
export function multiplied(amount, units) {
  const total = BigInt(amount) * BigInt(units);
  requireThat(total <= BigInt(MAX_MINOR), 422, 'AMOUNT_RANGE', 'The total exceeds the supported amount range.');
  return Number(total);
}
