import {isIP} from 'node:net';

// AUTH-009 append-only authentication audit.
//
// This module is the single writer for `auth.auth_audit`. It owns four contract
// points that call sites must not re-implement:
//
//   1. EVENT CATALOG. Only catalogued events may be written, and each event
//      declares its permitted actor semantics, outcomes and detail keys. The
//      catalog is inert data (no per-event branches), so a new event is added by
//      extending the catalog entry and, in the future, loading the same shape from
//      reference data. See "Extension points" in README.md.
//   2. REDACTION. Detail payloads are allow-listed and type-bounded. A key that
//      looks like a credential is refused even if a caller mistakenly allow-lists
//      it, so a password, token, assertion, cookie or one-time code cannot reach
//      the ledger.
//   3. ATOMICITY. `audit(event, {tx})` writes on the caller's transaction, so a
//      successful transition and its audit row commit or roll back together.
//   4. FAILURE DURABILITY. `audit.failure(event)` always acquires its own
//      connection outside the caller's transaction, so a rejected attempt is
//      recorded even though the attempt transaction rolls back. Durability
//      failures are counted and retained for operators instead of being swallowed.
//
// The ledger itself is append-only by database trigger (see db/postgres/
// 05-auth-schema.sql); this module never issues UPDATE or DELETE.

export const AUTH_AUDIT_VERSION = 1;
export const AUTH_AUDIT_REALMS = Object.freeze(['customer', 'operator']);

const AUTHENTICATED = 'authenticated';
const OPERATOR_ASSERTION = 'operator_assertion';
const UNVERIFIED_ATTEMPT = 'unverified_attempt';
const UNKNOWN = 'unknown';
const RECOVERY_TOKEN = 'recovery_token';

export const AUTH_AUDIT_ACTORS = Object.freeze({
  AUTHENTICATED,
  OPERATOR_ASSERTION,
  UNVERIFIED_ATTEMPT,
  UNKNOWN,
  RECOVERY_TOKEN,
});

// Producer values document the real adapter path that consumes the event today.
// A null producer is an explicit, reported gap: the vocabulary exists so the
// future flow records it in one call, and no synthetic row is invented in the
// meantime.
export const AUTH_AUDIT_CATALOG = Object.freeze({
  login_success: Object.freeze({
    category: 'authentication',
    producer: 'routes.login+access.exchange',
    actors: [AUTHENTICATED, OPERATOR_ASSERTION],
    outcomes: ['success'],
    detail: [
      'assurance', 'rehashed', 'reservation_order',
      'throttle_account', 'throttle_network', 'attempt_at', 'attempt_order',
      'operator_subject', 'operator_role', 'access_issuer', 'access_audience', 'exchange',
    ],
  }),
  login_failure: Object.freeze({
    category: 'authentication',
    producer: 'routes.login+access.exchange',
    actors: [UNKNOWN, UNVERIFIED_ATTEMPT, OPERATOR_ASSERTION],
    outcomes: ['failure', 'denied'],
    detail: [
      'reason', 'retry_after_ms', 'phase',
      'throttle_account', 'throttle_network', 'attempt_at', 'attempt_order',
    ],
  }),
  logout: Object.freeze({
    category: 'session',
    producer: 'routes.logout+route.operatorLogout',
    actors: [AUTHENTICATED, OPERATOR_ASSERTION],
    outcomes: ['success'],
    detail: ['scope'],
  }),
  sessions_revoked: Object.freeze({
    category: 'session',
    producer: 'routes.resetPassword',
    actors: [AUTHENTICATED, RECOVERY_TOKEN],
    outcomes: ['success'],
    detail: ['scope', 'reason', 'revoked_count'],
  }),
  mfa_enrolled: Object.freeze({
    category: 'mfa',
    producer: 'routes.mfaEnroll+mfaEnrollVerify',
    actors: [AUTHENTICATED],
    outcomes: ['success'],
    detail: ['stage', 'recovery_codes_issued'],
  }),
  mfa_enroll_failed: Object.freeze({
    category: 'mfa',
    producer: 'routes.mfaEnroll+mfaEnrollVerify',
    actors: [AUTHENTICATED],
    outcomes: ['failure', 'denied'],
    detail: ['reason', 'stage', 'method'],
  }),
  mfa_verified: Object.freeze({
    category: 'mfa',
    producer: 'routes.mfaVerify',
    actors: [AUTHENTICATED],
    outcomes: ['success'],
    detail: ['method', 'assurance'],
  }),
  mfa_verification_failed: Object.freeze({
    category: 'mfa',
    producer: 'routes.mfaVerify+mfaDisable',
    actors: [AUTHENTICATED],
    outcomes: ['failure', 'denied'],
    detail: ['reason', 'stage', 'method'],
  }),
  mfa_disabled: Object.freeze({
    category: 'mfa',
    producer: 'routes.mfaDisable',
    actors: [AUTHENTICATED],
    outcomes: ['success'],
    detail: ['reenrollment_required'],
  }),
  password_reset_requested: Object.freeze({
    category: 'credential',
    producer: 'routes.forgotPassword',
    actors: [UNKNOWN],
    outcomes: ['success', 'failure', 'denied'],
    detail: ['reason', 'retry_after_ms', 'delivery', 'throttle_account', 'throttle_network', 'attempt_at', 'attempt_order'],
  }),
  password_reset_failed: Object.freeze({
    category: 'credential',
    producer: 'routes.resetPassword',
    actors: [UNKNOWN, RECOVERY_TOKEN],
    outcomes: ['failure', 'denied'],
    detail: ['reason'],
  }),
  password_reset_completed: Object.freeze({
    category: 'credential',
    producer: 'routes.resetPassword',
    actors: [RECOVERY_TOKEN],
    outcomes: ['success'],
    detail: ['purpose', 'sessions_revoked', 'credential_version'],
  }),
  password_changed: Object.freeze({
    category: 'credential',
    producer: null,
    actors: [AUTHENTICATED],
    outcomes: ['success'],
    detail: ['sessions_revoked'],
  }),
  email_verification_requested: Object.freeze({
    category: 'credential',
    producer: 'routes.emailVerificationRequest',
    actors: [AUTHENTICATED],
    outcomes: ['success', 'denied'],
    detail: ['delivery', 'retry_after_ms'],
  }),
  email_verified: Object.freeze({
    category: 'credential',
    producer: 'routes.emailVerifyRoute',
    actors: [RECOVERY_TOKEN],
    outcomes: ['success'],
    detail: ['already_verified'],
  }),
  email_verification_failed: Object.freeze({
    category: 'credential',
    producer: 'routes.emailVerifyRoute',
    actors: [UNKNOWN, RECOVERY_TOKEN],
    outcomes: ['failure', 'denied'],
    detail: ['reason'],
  }),
  tenant_selected: Object.freeze({
    category: 'membership',
    producer: 'tenant-selection.select',
    actors: [AUTHENTICATED],
    outcomes: ['success'],
    detail: ['membership_id', 'role_id'],
  }),
  tenant_cleared: Object.freeze({
    category: 'membership',
    producer: 'tenant-selection.clear',
    actors: [AUTHENTICATED],
    outcomes: ['success'],
    detail: [],
  }),
  tenant_selection_failed: Object.freeze({
    category: 'membership',
    producer: 'routes.selectTenant',
    actors: [AUTHENTICATED],
    outcomes: ['failure', 'denied'],
    detail: ['reason'],
  }),
  role_changed: Object.freeze({
    category: 'membership',
    producer: null,
    actors: [AUTHENTICATED],
    outcomes: ['success'],
    detail: ['role_id', 'previous_role_id'],
  }),
  membership_invited: Object.freeze({
    category: 'membership',
    producer: null,
    actors: [AUTHENTICATED],
    outcomes: ['success'],
    detail: ['membership_id', 'role_id'],
  }),
  membership_accepted: Object.freeze({
    category: 'membership',
    producer: null,
    actors: [AUTHENTICATED],
    outcomes: ['success'],
    detail: ['membership_id', 'role_id'],
  }),
});

// ADR03's required event set, mapped to the catalog names this module owns. The
// map is the traceability record for review: a required event with no producer is
// an explicit limitation, never a claim of coverage.
export const ADR03_REQUIRED_EVENTS = Object.freeze({
  login_success: 'login_success',
  login_failure: 'login_failure',
  logout: 'logout',
  mfa_enrolled: 'mfa_enrolled',
  mfa_verified: 'mfa_verified',
  mfa_disabled: 'mfa_disabled',
  password_changed: 'password_changed',
  password_reset_requested: 'password_reset_requested',
  password_reset_completed: 'password_reset_completed',
  sessions_revoked: 'sessions_revoked',
  role_changed: 'role_changed',
  membership_invited: 'membership_invited',
  membership_accepted: 'membership_accepted',
});

// A key is refused regardless of the per-event allow-list when its name could
// describe an authenticator, bearer value or one-time code. Substring matching is
// deliberately broad; a false positive costs one rename, a false negative is a
// leaked credential.
const SENSITIVE_SUBSTRINGS = Object.freeze([
  'password', 'passwd', 'secret', 'token', 'assertion', 'cookie', 'authorization', 'csrf', 'otp', 'totp',
]);
const SENSITIVE_EXACT = Object.freeze(new Set([
  'code', 'code_hash', 'recovery_code', 'recovery_codes', 'value_hash', 'hash', 'credential',
]));

const DETAIL_KEY = /^[a-z][a-z0-9_]{0,63}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const REQUEST_ID = /^[A-Za-z0-9._:-]{1,200}$/;
const MAX_DETAIL_STRING = 320;
const MAX_ACTOR_SUBJECT = 320;

export class AuditEventError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

export class AuditDurabilityError extends Error {
  constructor(message = 'The failure event was not durably recorded.', options) {
    super(message, options);
    this.code = 'AUDIT_DURABILITY_FAILED';
  }
}

function isSensitiveKey(key) {
  if (SENSITIVE_EXACT.has(key)) return true;
  return SENSITIVE_SUBSTRINGS.some(part => key.includes(part));
}

function header(request, name) {
  if (!request) return null;
  const headers = request.headers;
  if (!headers) return null;
  if (typeof headers.get === 'function') return headers.get(name);
  if (typeof headers === 'object') return headers[name] ?? headers[name.toLowerCase()] ?? null;
  return null;
}

function sanitizeHeaderValue(value, max) {
  if (typeof value !== 'string') return null;
  const cleaned = value.replace(/[\u0000-\u001f\u007f]/g, ' ').trim();
  return cleaned.length === 0 ? null : cleaned.slice(0, max);
}

function sanitizeDetail(detail, allowed) {
  if (detail == null) return {};
  if (typeof detail !== 'object' || Array.isArray(detail)) {
    throw new AuditEventError('AUDIT_DETAIL_INVALID', 'Audit detail must be a flat object.');
  }
  const out = {};
  for (const [key, value] of Object.entries(detail)) {
    if (isSensitiveKey(key)) {
      throw new AuditEventError('AUDIT_DETAIL_FORBIDDEN', `Audit detail may never contain "${key}".`);
    }
    if (!DETAIL_KEY.test(key) || !allowed.includes(key)) {
      throw new AuditEventError('AUDIT_DETAIL_UNKNOWN', `Audit detail key "${key}" is not declared for this event.`);
    }
    if (value === null) {
      out[key] = null;
    } else if (typeof value === 'boolean') {
      out[key] = value;
    } else if (typeof value === 'number') {
      if (!Number.isFinite(value)) {
        throw new AuditEventError('AUDIT_DETAIL_INVALID', `Audit detail "${key}" must be a finite number.`);
      }
      out[key] = value;
    } else if (typeof value === 'string') {
      out[key] = value.slice(0, MAX_DETAIL_STRING);
    } else {
      throw new AuditEventError('AUDIT_DETAIL_INVALID', `Audit detail "${key}" must be a scalar value.`);
    }
  }
  return out;
}

function normalizeActorKind(event, spec) {
  const fallback = event.user?.id ? AUTHENTICATED : UNKNOWN;
  const actorKind = event.actorKind ?? fallback;
  if (!spec.actors.includes(actorKind)) {
    throw new AuditEventError('AUDIT_ACTOR_INVALID', `Actor kind "${actorKind}" is not declared for this event.`);
  }
  return actorKind;
}

// Pure row builder. Exported so the redaction and attribution rules can be proven
// without a database, and so a future reference-data catalog reuses the contract.
export function prepareAuditRow(event, {realms = AUTH_AUDIT_REALMS} = {}) {
  if (!event || typeof event !== 'object') {
    throw new AuditEventError('AUDIT_EVENT_INVALID', 'An audit event object is required.');
  }
  const eventType = event.eventType;
  if (typeof eventType !== 'string' || !Object.hasOwn(AUTH_AUDIT_CATALOG, eventType)) {
    throw new AuditEventError('AUDIT_EVENT_UNKNOWN', 'The audit event is not in the catalog.');
  }
  const spec = AUTH_AUDIT_CATALOG[eventType];
  const outcome = event.outcome ?? 'success';
  if (!spec.outcomes.includes(outcome)) {
    throw new AuditEventError('AUDIT_OUTCOME_INVALID', `Outcome "${outcome}" is not declared for ${eventType}.`);
  }
  const realm = event.realm ?? null;
  if (!realms.includes(realm)) {
    throw new AuditEventError('AUDIT_REALM_INVALID', 'A known authentication realm is required.');
  }
  const userId = event.user?.id ?? null;
  if (userId !== null && (typeof userId !== 'string' || !UUID.test(userId))) {
    throw new AuditEventError('AUDIT_ACTOR_INVALID', 'The authenticated actor must be a verified principal id.');
  }
  const tenantId = event.tenantId ?? null;
  if (tenantId !== null && (typeof tenantId !== 'string' || !UUID.test(tenantId))) {
    throw new AuditEventError('AUDIT_METADATA_INVALID', 'A tenant id must be a UUID.');
  }
  const actorSubject = event.actorSubject == null ? null : String(event.actorSubject).slice(0, MAX_ACTOR_SUBJECT);
  const sessionId = event.sessionId == null ? null : String(event.sessionId).slice(0, 200);
  const requestIdHeader = header(event.request, 'x-request-id');
  const requestId = typeof requestIdHeader === 'string' && REQUEST_ID.test(requestIdHeader) ? requestIdHeader : null;
  const candidateIp = event.ipAddress ?? header(event.request, 'cf-connecting-ip');
  const ipAddress = typeof candidateIp === 'string' && isIP(candidateIp) !== 0 ? candidateIp : null;
  const userAgent = sanitizeHeaderValue(header(event.request, 'user-agent'), 1000);
  const actorKind = normalizeActorKind(event, spec);
  const detail = sanitizeDetail(event.detail ?? {}, spec.detail);
  detail.actor_kind = actorKind;

  return {
    event_type: eventType,
    outcome,
    user_id: userId,
    actor_subject: actorSubject,
    tenant_id: tenantId,
    realm,
    role_id: null,
    session_id: sessionId,
    request_id: requestId,
    ip_address: ipAddress,
    user_agent: userAgent,
    detail_jsonb: JSON.stringify(detail),
    detail_schema_version: AUTH_AUDIT_VERSION,
  };
}

const INSERT_SQL = `
  INSERT INTO auth.auth_audit(
    event_type, outcome, user_id, actor_subject, tenant_id, realm, role_id,
    session_id, request_id, ip_address, user_agent, detail_jsonb, detail_schema_version)
  VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::jsonb, $13)
  RETURNING id`;

function params(row) {
  return [
    row.event_type,
    row.outcome,
    row.user_id,
    row.actor_subject,
    row.tenant_id,
    row.realm,
    row.role_id,
    row.session_id,
    row.request_id,
    row.ip_address,
    row.user_agent,
    row.detail_jsonb,
    row.detail_schema_version,
  ];
}

export function createAuditWriter(pool, {
  onDurabilityFailure = null,
  failureHistoryLimit = 50,
  realms = AUTH_AUDIT_REALMS,
} = {}) {
  if (!pool || typeof pool.query !== 'function') {
    throw new Error('createAuditWriter requires a PostgreSQL pool with query().');
  }
  const history = [];
  let durabilityFailures = 0;
  let lastFailure = null;

  function noteDurabilityFailure(event, error) {
    durabilityFailures += 1;
    lastFailure = {eventType: event?.eventType ?? null, code: error?.code ?? 'AUDIT_DURABILITY_FAILED'};
    history.push({...lastFailure, at: new Date().toISOString()});
    if (history.length > failureHistoryLimit) history.splice(0, history.length - failureHistoryLimit);
    if (typeof onDurabilityFailure === 'function') {
      try {
        onDurabilityFailure({...lastFailure, error});
      } catch {
        // An operator notifier must never change the authentication outcome.
      }
    }
  }

  async function insert(executor, event) {
    const row = prepareAuditRow(event, {realms});
    const result = await executor.query(INSERT_SQL, params(row));
    return {recorded: true, id: result?.rows?.[0]?.id ?? null, eventType: row.event_type};
  }

  // Success transitions pass the caller's transaction so the row is atomic with the
  // transition. Without `tx` the single statement is its own committed transaction.
  async function audit(event, {tx} = {}) {
    return insert(tx ?? pool, event);
  }

  // Failed attempts must survive the rollback of the attempt they describe, so this
  // path never accepts a transaction and never runs inside one. It acquires an
  // independent connection. A failure here is surfaced through stats() and the
  // optional notifier; the caller reports the authentication decision unchanged.
  audit.failure = async function failure(event) {
    const attempt = {...event, outcome: event?.outcome ?? 'failure'};
    try {
      return await insert(pool, attempt);
    } catch (error) {
      noteDurabilityFailure(attempt, error);
      throw error instanceof AuditEventError ? error : new AuditDurabilityError(undefined, {cause: error});
    }
  };

  audit.stats = () => ({
    durabilityFailures,
    lastFailure: lastFailure ? {...lastFailure} : null,
    history: history.map(entry => ({...entry})),
  });

  return audit;
}
