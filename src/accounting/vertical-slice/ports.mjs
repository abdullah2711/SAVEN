// PIVOT-014 — ports and shared vocabulary for the authenticated journal lifecycle.
//
// This module owns no database access and no transport. It defines the seams the
// application composes (auth session verification, tenant admission, journal
// persistence, security audit, clock) and the small pure helpers those seams share:
// the error taxonomy, the canonical action map, exact decimal arithmetic checks and
// redaction assertions.
//
// EXTENSION POINTS (see README.md): new actions are configuration, not new code in
// this file; a new persistence engine is a new `journal` port implementation; a new
// transport is a caller of `createVerticalSliceApplication`.

/** Versioned API surface. A breaking change is a new version, never a silent edit. */
export const API_VERSION = 'v1';
export const API_PREFIX = `/v1/accounting`;

/** Bumped only with a reviewed contract change; asserted by the permanent test. */
export const SLICE_VERSION = 1;

/**
 * Accepted canonical action identifiers come from
 * `contracts/postgres-business-rules-v1.json` (reference domain `action_type`).
 * They are configuration here, never an enum embedded in control flow: a caller may
 * inject a different map and the service follows it.
 */
export const CANONICAL_ACTIONS = Object.freeze({
  read: 'journal.read',
  prepare: 'journal.prepare',
  post: 'journal.post',
  // The accepted terminal-void action is the "delete" authority for a posted entry.
  // There is no `journal.delete` identifier in the accepted domain, and inventing one
  // here would be a new hardcoded vocabulary item.
  delete: 'accounting.entry.void',
  voidedRead: 'accounting.voided_entries.read',
});

/** Error taxonomy. Every refusal has a specific, stable code. */
export class SliceError extends Error {
  constructor(status, code, message, extra = {}) {
    super(message);
    this.name = 'SliceError';
    this.status = status;
    this.code = code;
    Object.assign(this, extra);
  }
}

export const refuse = {
  authRequired: () => new SliceError(401, 'AUTH_REQUIRED', 'Sign in to use the accounting service.'),
  sessionInvalid: () => new SliceError(401, 'SESSION_INVALID', 'This session is no longer valid.'),
  originUnrecognized: () => new SliceError(421, 'ORIGIN_UNRECOGNIZED', 'Unrecognized application origin.'),
  csrfRequired: () => new SliceError(403, 'CSRF_REQUIRED', 'A valid CSRF token is required for this request.'),
  tenantRequired: () => new SliceError(403, 'TENANT_SELECTION_REQUIRED', 'Select a business before using accounting.'),
  tenantResourceDenied: id => new SliceError(403, 'TENANT_RESOURCE_DENIED',
    'The requested entry is not accessible to this business.', {resourceId: id}),
  auditTenantDenied: id => new SliceError(403, 'AUDIT_TENANT_DENIED',
    'Audit history for another business is not accessible.', {resourceId: id}),
  permissionDenied: action => new SliceError(403, 'PERMISSION_DENIED',
    'Your assigned authority does not permit this action.', {action}),
  entryUnavailable: id => new SliceError(404, 'ENTRY_NOT_FOUND',
    'No such entry.', {resourceId: id}),
  invalidEntry: reason => new SliceError(422, 'JOURNAL_INVALID', reason),
  unbalanced: () => new SliceError(422, 'UNBALANCED_ENTRY',
    'Total debits must equal total credits in exact minor units.'),
  periodLocked: () => new SliceError(409, 'POSTING_PERIOD_LOCKED', 'The posting period is closed.'),
  idempotencyConflict: () => new SliceError(409, 'IDEMPOTENCY_CONFLICT',
    'This idempotency key was used for different content.'),
  unsupportedLinked: what => new SliceError(422, 'UNSUPPORTED_LINKED_CASE',
    `This vertical slice does not support ${what}.`),
  allocatorExhausted: () => new SliceError(409, 'ALLOCATOR_EXHAUSTED',
    'Document numbering for this scope is exhausted.'),
  entryNotPosted: () => new SliceError(409, 'ENTRY_NOT_POSTED', 'Only a posted entry can be voided.'),
  alreadyVoided: () => new SliceError(409, 'ENTRY_ALREADY_VOIDED', 'This entry is already voided.'),
  catalogMismatch: (expected, actual) => new SliceError(500, 'AUDIT_CATALOG_MISMATCH',
    `Security-audit catalog version ${actual} does not match the pinned version ${expected}.`),
};

/** Canonical JSON: stable key order, used for digests. */
export function canonicalJson(value) {
  if (typeof value === 'bigint') return `{"$bigint":"${value.toString()}"}`;
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const keys = Object.keys(value).sort();
  return `{${keys.map(key => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
}

/**
 * Exact minor-unit parser. Rejects floats, exponents, signs other than a leading
 * minus, and anything outside the accepted 0..999999999999 column bound. Returns a
 * BigInt so no rounding is possible anywhere in the slice.
 */
export function minorUnits(value, label) {
  if (typeof value === 'bigint') {
    if (value < 0n || value > 999999999999n) throw refuse.invalidEntry(`${label} is outside the accepted minor-unit range.`);
    return value;
  }
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value)) throw refuse.invalidEntry(`${label} must be an integer minor-unit amount.`);
    return minorUnits(BigInt(value), label);
  }
  if (typeof value !== 'string' || !/^(0|[1-9][0-9]{0,11})$/.test(value)) {
    throw refuse.invalidEntry(`${label} must be a non-negative integer minor-unit string.`);
  }
  const parsed = BigInt(value);
  if (parsed > 999999999999n) throw refuse.invalidEntry(`${label} is outside the accepted minor-unit range.`);
  return parsed;
}

/** A balanced entry needs at least two lines and equal exact debit/credit totals. */
export function assertBalanced(lines) {
  if (!Array.isArray(lines) || lines.length < 2) {
    throw refuse.invalidEntry('A journal needs at least two lines.');
  }
  if (lines.length > 200) throw refuse.invalidEntry('A journal may not exceed 200 lines in this slice.');
  let debit = 0n;
  let credit = 0n;
  const seen = new Set();
  const normalized = lines.map((line, index) => {
    if (!line || typeof line !== 'object') throw refuse.invalidEntry(`Line ${index + 1} is not an object.`);
    for (const key of Object.keys(line)) {
      if (!['account', 'debit', 'credit'].includes(key)) {
        // Linked trade/stock or arbitrary extra fields are explicitly unsupported here.
        if (['trade', 'stock', 'party', 'tax', 'currency', 'allocations'].includes(key)) {
          throw refuse.unsupportedLinked(`linked ${key} entries`);
        }
        throw refuse.invalidEntry(`Line ${index + 1} has an unsupported field "${key}".`);
      }
    }
    if (typeof line.account !== 'string' || !/^[A-Za-z0-9._-]{1,32}$/.test(line.account)) {
      throw refuse.invalidEntry(`Line ${index + 1} needs a valid account code.`);
    }
    if (seen.has(line.account)) throw refuse.invalidEntry('Each account may appear at most once in this slice.');
    seen.add(line.account);
    const d = minorUnits(line.debit ?? '0', `Line ${index + 1} debit`);
    const c = minorUnits(line.credit ?? '0', `Line ${index + 1} credit`);
    if ((d > 0n) === (c > 0n)) throw refuse.invalidEntry(`Line ${index + 1} must have exactly one side.`);
    debit += d;
    credit += c;
    return {account: line.account, debit: d, credit: c};
  });
  if (debit !== credit) throw refuse.unbalanced();
  if (debit === 0n) throw refuse.invalidEntry('A journal may not be zero-valued.');
  return {lines: normalized, debit, credit};
}

/** The single-currency, single-company envelope this slice accepts. */
export function assertEnvelope(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw refuse.invalidEntry('A JSON object payload is required.');
  }
  const allowed = new Set(['company', 'branch', 'postingDate', 'narrative', 'lines']);
  for (const key of Object.keys(payload)) {
    if (!allowed.has(key)) {
      if (['currency', 'tax', 'party', 'trade', 'stock', 'allocations', 'fx'].includes(key)) {
        throw refuse.unsupportedLinked(key);
      }
      throw refuse.invalidEntry(`Unsupported field "${key}".`);
    }
  }
  if (typeof payload.company !== 'string' || !payload.company.trim()) throw refuse.invalidEntry('A company is required.');
  if (typeof payload.branch !== 'string' || !payload.branch.trim()) throw refuse.invalidEntry('A branch is required.');
  if (typeof payload.postingDate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(payload.postingDate)) {
    throw refuse.invalidEntry('postingDate must be an ISO date.');
  }
  const narrative = typeof payload.narrative === 'string' ? payload.narrative.trim() : '';
  if (!narrative || narrative.length > 500) throw refuse.invalidEntry('A narrative of 1..500 characters is required.');
  return {
    company: payload.company.trim(),
    branch: payload.branch.trim(),
    postingDate: payload.postingDate,
    narrative,
    ...assertBalanced(payload.lines),
  };
}

/**
 * Recursively asserts a set of sentinel strings is absent from a JSON-ish value.
 * Used by the tests for both audit payloads and outward responses.
 */
export function containsSentinel(value, sentinels) {
  const text = typeof value === 'string' ? value : canonicalJson(value ?? null);
  return sentinels.some(sentinel => sentinel && text.includes(sentinel));
}

/** Structural check of the injected ports. Fails closed at composition time. */
export function assertPorts(ports) {
  const required = ['session', 'gate', 'journal', 'securityAudit', 'clock'];
  for (const name of required) {
    if (!ports || !ports[name]) throw new Error(`createVerticalSliceApplication requires the "${name}" port.`);
  }
  for (const fn of ['verify', 'csrfMatches']) {
    if (typeof ports.session[fn] !== 'function') throw new Error(`The session port must implement ${fn}().`);
  }
  if (typeof ports.gate.admit !== 'function') throw new Error('The gate port must implement admit().');
  for (const fn of ['transaction', 'reserveNumber', 'identity']) {
    if (typeof ports.journal[fn] !== 'function') throw new Error(`The journal port must implement ${fn}().`);
  }
  if (typeof ports.securityAudit.record !== 'function') throw new Error('The security-audit port must implement record().');
  if (typeof ports.securityAudit.version !== 'number') throw new Error('The security-audit port must declare its catalog version.');
  if (typeof ports.clock.now !== 'function') throw new Error('The clock port must implement now().');
  return ports;
}
