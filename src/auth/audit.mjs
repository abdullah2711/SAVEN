import {isIP} from 'node:net';
import catalogConfig from './audit-catalog.v1.json' with {type: 'json'};

// AUTH-009 append-only authentication audit.
//
// This module is the single writer for `auth.auth_audit` and owns four contract
// points that call sites must not re-implement:
//
//   1. EVENT CONFIGURATION. The event domain is a versioned JSON configuration
//      (`audit-catalog.v1.json`), validated here and loaded through the writer
//      boundary. Adding an event is a configuration change; writer logic does not
//      branch per event. A deployment may supply an equivalent validated catalog
//      (`createAuditWriter({auditCatalog})`); HTTP clients cannot register or
//      select one. Unknown events fail closed.
//   2. REDACTION. Detail payloads are allow-listed per event and type-bounded. A
//      key that looks like a credential is refused even if a catalog mistakenly
//      lists it, so a password, token, assertion, cookie or one-time code cannot
//      reach the ledger.
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
export const SUPPORTED_CATALOG_VERSIONS = Object.freeze([1]);

// `unknown` is not an application realm. It is the explicit, non-attributing realm
// used when a refusal happens before any exact origin/realm can be established
// (for example an unrecognized Host/Origin). Never use it for a request that did
// resolve to the customer or operator origin.
export const AUTH_AUDIT_REALMS = Object.freeze(['customer', 'operator', 'unknown']);

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

const OUTCOMES = Object.freeze(['success', 'failure', 'denied']);

const EVENT_NAME = /^[a-z][a-z0-9_]{0,119}$/;
const DETAIL_KEY = /^[a-z][a-z0-9_]{0,63}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const REQUEST_ID = /^[A-Za-z0-9._:-]{1,200}$/;
const MAX_DETAIL_STRING = 320;
const MAX_ACTOR_SUBJECT = 320;
const RESERVED_DETAIL_KEYS = Object.freeze(['actor_kind']);

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

// ADR03's required event set, independent of the configurable catalog. This map is
// the review/traceability source of truth: every entry is REQUIRED. Changing the JSON
// catalog alone cannot turn a missing producer into a claimed live one (or vice versa).
// A required event whose producer is null/absent is an unresolved gap reported against
// this contract, never a deferral and never satisfied by a synthetic row.
export const ADR03_REQUIRED_EVENTS = Object.freeze({
  login_success: Object.freeze({status: 'required'}),
  login_failure: Object.freeze({status: 'required'}),
  logout: Object.freeze({status: 'required'}),
  mfa_enrolled: Object.freeze({status: 'required'}),
  mfa_verified: Object.freeze({status: 'required'}),
  mfa_disabled: Object.freeze({status: 'required'}),
  password_changed: Object.freeze({status: 'required'}),
  password_reset_requested: Object.freeze({status: 'required'}),
  password_reset_completed: Object.freeze({status: 'required'}),
  sessions_revoked: Object.freeze({status: 'required'}),
  role_changed: Object.freeze({
    status: 'required',
    producerDeferredTo: 'IAM/membership administration contract',
    reason: 'Principal-approved narrowing (19 Nov 2026): AUTH-009 ships the vocabulary, validation and required map; the producer is deferred to the IAM/membership contract. The role-change flow is live on the legacy data layer (src/local/administration.mjs records BUSINESS_ROLE_SAVED); it is not covered by the new auth-audited PostgreSQL surface, and porting it is an IAM contract of its own. BUSINESS_ROLE_SAVED is carried forward, not dropped.',
  }),
  membership_invited: Object.freeze({
    status: 'required',
    producerDeferredTo: 'IAM/membership administration contract',
    reason: 'Principal-approved narrowing (19 Nov 2026): AUTH-009 ships the vocabulary, validation and required map; the producer is deferred to the IAM/membership contract. The invitation flow is live on the legacy data layer (src/operating.mjs invite()/membershipInvitation(), imported and routed by src/api.mjs); it is not covered by the new auth-audited PostgreSQL surface, and porting it is an IAM contract of its own.',
  }),
  membership_accepted: Object.freeze({
    status: 'required',
    producerDeferredTo: 'IAM/membership administration contract',
    reason: 'Principal-approved narrowing (19 Nov 2026): AUTH-009 ships the vocabulary, validation and required map; the producer is deferred to the IAM/membership contract. The acceptance flow is live on the legacy data layer (src/operating.mjs membershipInvitation(), imported and routed by src/api.mjs); it is not covered by the new auth-audited PostgreSQL surface, and porting it is an IAM contract of its own.',
  }),
});

// Precise producer/transition map. This is reporting and review evidence, not a
// status that can relax the contract: `unresolved` means a REQUIRED ADR03 transition
// has no adapter flow and must not be treated as covered or deferred. It is kept in
// source, independent of the JSON catalog, so a catalog edit cannot change it.
export const ADR03_PRODUCER_MAP = Object.freeze({
  login_success: Object.freeze({
    status: 'live',
    transition: 'Verified credential or asserted operator identity creates a session.',
    producer: 'routes.login; access.exchange',
    route: 'POST /v1/auth/login; POST /v1/auth/operator/access',
  }),
  login_failure: Object.freeze({
    status: 'live',
    transition: 'A sign-in attempt is reserved, denied, or refused before reservation.',
    producer: 'routes.login; access.exchange; routes.refusalNet',
    route: 'POST /v1/auth/login; POST /v1/auth/operator/access',
  }),
  logout: Object.freeze({
    status: 'live',
    transition: 'The authenticated principal revokes the current session.',
    producer: 'routes.logout; routes.operatorLogoutRoute',
    route: 'POST /v1/auth/logout; POST /v1/auth/operator/logout',
  }),
  mfa_enrolled: Object.freeze({
    status: 'live',
    transition: 'TOTP enrollment starts, completes, or replaces an existing factor.',
    producer: 'routes.mfaEnrollRoute; routes.mfaEnrollVerifyRoute',
    route: 'POST /v1/auth/mfa/enroll; POST /v1/auth/mfa/enroll/verify',
  }),
  mfa_verified: Object.freeze({
    status: 'live',
    transition: 'A TOTP or recovery code verifies and raises session assurance.',
    producer: 'routes.mfaVerifyRoute',
    route: 'POST /v1/auth/mfa/verify',
  }),
  mfa_disabled: Object.freeze({
    status: 'live',
    transition: 'Factor disablement after reauthentication.',
    producer: 'routes.mfaDisableRoute',
    route: 'POST /v1/auth/mfa/disable',
  }),
  password_changed: Object.freeze({
    status: 'live',
    transition: 'Authenticated current-password reauthentication sets a new credential.',
    producer: 'routes.passwordChange',
    route: 'POST /v1/auth/password/change',
  }),
  password_reset_requested: Object.freeze({
    status: 'live',
    transition: 'A reset challenge request is reserved and, when configured, issued.',
    producer: 'routes.forgotPassword',
    route: 'POST /v1/auth/forgot-password',
  }),
  password_reset_completed: Object.freeze({
    status: 'live',
    transition: 'A single-use reset token consumes to a new credential generation.',
    producer: 'routes.resetPassword',
    route: 'POST /v1/auth/reset-password',
  }),
  sessions_revoked: Object.freeze({
    status: 'live',
    transition: 'Bulk revocation: reset or password change invalidates every session.',
    producer: 'routes.resetPassword; routes.passwordChange',
    route: 'POST /v1/auth/reset-password; POST /v1/auth/password/change',
  }),
  role_changed: Object.freeze({
    status: 'producer-deferred',
    transition: 'A tenant membership role is reassigned with current authority.',
    producer: null,
    route: null,
    deferredTo: 'IAM/membership administration contract',
    legacyProducer: 'src/local/administration.mjs records BUSINESS_ROLE_SAVED on the legacy data layer',
    absent: 'The transition exists on the legacy data layer but has no auth-audited PostgreSQL producer. AUTH-009 is not authorized to define role authority, epoch effects or session consequences; porting the transition is an IAM contract of its own. BUSINESS_ROLE_SAVED is carried forward, not dropped.',
  }),
  membership_invited: Object.freeze({
    status: 'producer-deferred',
    transition: 'A tenant administrator issues a pending membership invitation.',
    producer: null,
    route: null,
    deferredTo: 'IAM/membership administration contract',
    legacyProducer: 'src/operating.mjs invite()/membershipInvitation(), imported and routed by src/api.mjs',
    absent: 'The invitation workflow is live on the legacy data layer but has no auth-audited PostgreSQL producer. Porting it (authority, token lifetime, membership status) is an IAM contract of its own.',
  }),
  membership_accepted: Object.freeze({
    status: 'producer-deferred',
    transition: 'The invited identity authenticates and explicitly accepts the membership.',
    producer: null,
    route: null,
    deferredTo: 'IAM/membership administration contract',
    legacyProducer: 'src/operating.mjs membershipInvitation(), imported and routed by src/api.mjs',
    absent: 'The acceptance workflow is live on the legacy data layer but has no auth-audited PostgreSQL producer. Acceptance authority, issuer revalidation and token semantics belong to the IAM/membership contract.',
  }),
});

export class AuditEventError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

export class AuditConfigurationError extends Error {
  constructor(message) {
    super(`Audit catalog configuration refused: ${message}`);
    this.code = 'AUDIT_CATALOG_INVALID';
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

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function stringArray(value, label, pattern, {allowEmpty = false} = {}) {
  if (!Array.isArray(value) || (!allowEmpty && value.length === 0)) {
    throw new AuditConfigurationError(`${label} must be a non-empty array.`);
  }
  const seen = new Set();
  for (const entry of value) {
    if (typeof entry !== 'string' || !pattern.test(entry)) {
      throw new AuditConfigurationError(`${label} contains an invalid value.`);
    }
    if (seen.has(entry)) throw new AuditConfigurationError(`${label} contains a duplicate value.`);
    seen.add(entry);
  }
  return Object.freeze([...value]);
}

// Validates and normalizes a catalog document. Throws AuditConfigurationError, so a
// bad configuration fails at composition/startup rather than writing unvalidated
// rows. Callers may supply the returned shape but cannot mutate it.
export function validateAuditCatalog(config) {
  if (!isPlainObject(config)) throw new AuditConfigurationError('the catalog must be an object.');
  if (!Number.isSafeInteger(config.catalogVersion) || !SUPPORTED_CATALOG_VERSIONS.includes(config.catalogVersion)) {
    throw new AuditConfigurationError(`catalogVersion must be one of ${SUPPORTED_CATALOG_VERSIONS.join(', ')}.`);
  }
  if (config.description !== undefined && (typeof config.description !== 'string' || config.description.length > 4000)) {
    throw new AuditConfigurationError('description must be a string of at most 4000 characters.');
  }
  if (!isPlainObject(config.events) || Object.keys(config.events).length === 0) {
    throw new AuditConfigurationError('events must be a non-empty object.');
  }
  const events = {};
  for (const [name, spec] of Object.entries(config.events)) {
    if (!EVENT_NAME.test(name)) throw new AuditConfigurationError(`event name "${name}" is invalid.`);
    if (!isPlainObject(spec)) throw new AuditConfigurationError(`event "${name}" must be an object.`);
    if (typeof spec.category !== 'string' || spec.category.trim().length === 0 || spec.category.length > 80) {
      throw new AuditConfigurationError(`event "${name}" needs a category of 1-80 characters.`);
    }
    if (spec.producer !== null && (typeof spec.producer !== 'string' || spec.producer.length > 320)) {
      throw new AuditConfigurationError(`event "${name}" producer must be null or a string of at most 320 characters.`);
    }
    const actors = stringArray(spec.actors, `event "${name}" actors`, EVENT_NAME);
    for (const actor of actors) {
      if (!Object.values(AUTH_AUDIT_ACTORS).includes(actor)) {
        throw new AuditConfigurationError(`event "${name}" declares unknown actor "${actor}".`);
      }
    }
    const outcomes = stringArray(spec.outcomes, `event "${name}" outcomes`, EVENT_NAME);
    for (const outcome of outcomes) {
      if (!OUTCOMES.includes(outcome)) {
        throw new AuditConfigurationError(`event "${name}" declares unknown outcome "${outcome}".`);
      }
    }
    const detail = stringArray(spec.detail, `event "${name}" detail`, DETAIL_KEY, {allowEmpty: true});
    for (const key of detail) {
      if (RESERVED_DETAIL_KEYS.includes(key)) {
        throw new AuditConfigurationError(`event "${name}" may not declare reserved detail key "${key}".`);
      }
      if (isSensitiveKey(key)) {
        throw new AuditConfigurationError(`event "${name}" may not declare credential-shaped detail key "${key}".`);
      }
    }
    events[name] = Object.freeze({
      category: spec.category,
      producer: spec.producer,
      actors,
      outcomes,
      detail,
    });
  }
  return Object.freeze({
    catalogVersion: config.catalogVersion,
    ...(config.description === undefined ? {} : {description: config.description}),
    events: Object.freeze(events),
  });
}

const DEFAULT_CATALOG = validateAuditCatalog(catalogConfig);

// Backwards-compatible named view of the validated default configuration. Prefer
// passing a catalog through `createAuditWriter`/`prepareAuditRow`.
export const AUTH_AUDIT_CATALOG = DEFAULT_CATALOG.events;
export const AUTH_AUDIT_CATALOG_VERSION = DEFAULT_CATALOG.catalogVersion;

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

// Pure row builder. Exported so the redaction, attribution and configuration rules
// can be proven without a database.
export function prepareAuditRow(event, {realms = AUTH_AUDIT_REALMS, catalog = AUTH_AUDIT_CATALOG} = {}) {
  if (!event || typeof event !== 'object') {
    throw new AuditEventError('AUDIT_EVENT_INVALID', 'An audit event object is required.');
  }
  const eventType = event.eventType;
  if (typeof eventType !== 'string' || !Object.hasOwn(catalog, eventType)) {
    throw new AuditEventError('AUDIT_EVENT_UNKNOWN', 'The audit event is not in the configured catalog.');
  }
  const spec = catalog[eventType];
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
  auditCatalog = DEFAULT_CATALOG,
  onDurabilityFailure = null,
  failureHistoryLimit = 50,
  realms = AUTH_AUDIT_REALMS,
} = {}) {
  if (!pool || typeof pool.query !== 'function') {
    throw new Error('createAuditWriter requires a PostgreSQL pool with query().');
  }
  // Fail closed at composition: an invalid or unsupported catalog means no writer.
  const catalog = validateAuditCatalog(auditCatalog);
  for (const realm of realms) {
    if (typeof realm !== 'string' || realm.length === 0) throw new AuditConfigurationError('realms must be non-empty strings.');
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
    const row = prepareAuditRow(event, {realms, catalog: catalog.events});
    const result = await executor.query(INSERT_SQL, params(row));
    return {recorded: true, id: result?.rows?.[0]?.id ?? null, eventType: row.event_type};
  }

  // Success transitions pass the caller's transaction so the row is atomic with the
  // transition. Without `tx` the single statement is its own committed transaction.
  async function audit(event, {tx} = {}) {
    return insert(tx ?? pool, event);
  }

  // Failed attempts must survive the rollback of the attempt they describe, so this
  // path never accepts a transaction and never runs inside one. A failure here is
  // surfaced through stats() and the optional notifier; the caller reports the
  // authentication decision unchanged.
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
    catalogVersion: catalog.catalogVersion,
    durabilityFailures,
    lastFailure: lastFailure ? {...lastFailure} : null,
    history: history.map(entry => ({...entry})),
  });

  audit.catalog = () => catalog;

  return audit;
}
