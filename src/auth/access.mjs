import {createHash, createPublicKey, verify as verifySignature} from 'node:crypto';

// AUTH-007-R1 Cloud operator Access validation and scoped subject mapping.
//
// The validator trusts ONE configured issuer, audience, algorithm set and key source. It
// never fetches a key from a token-supplied URL (jku/x5u are ignored), and only consults
// the injected fixed key set/refresh callback with a concurrency-safe cooldown.
//
// Mandatory operator MFA is explicit: only positively verified multi-factor evidence
// (default: the RFC 8176 `mfa` AMR value) yields access_mfa. Individual methods such as
// otp/hwk/swk are never inferred as MFA. The operator policy is fixed to access_mfa; a
// configuration label cannot weaken it.
//
// Exchange and subsequent operator admission run inside one owned auth transaction, take
// the accepted AUTH-006 shared authority gate before reading mapping/role authority, bind
// the verified issuer/subject/audience/mapping/role/assurance/source-expiry to the session,
// and revalidate current authority on every operator use.

export class AccessError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

const SUPPORTED_ALGORITHMS = Object.freeze(['RS256', 'RS384', 'RS512']);
const ALGORITHM_DIGEST = Object.freeze({RS256: 'RSA-SHA256', RS384: 'RSA-SHA384', RS512: 'RSA-SHA512'});
const BASE64URL = /^[A-Za-z0-9_-]+$/;
const REQUIRED_OPERATOR_ASSURANCE = 'access_mfa';
const AUTHORITY_GATE_KEY = 'saven.auth.authority_gate';
const OPERATOR_GATE_BINDINGS = Object.freeze([
  {table: 'access_identity', name: 'access_identity_authority_gate_insert', event: 4},
  {table: 'access_identity', name: 'access_identity_authority_gate_update', event: 16},
  {table: 'access_identity', name: 'access_identity_authority_gate_delete', event: 8},
]);
const AUTH_GATE_BINDINGS = Object.freeze([
  {table: 'tenant_membership', name: 'tenant_membership_authority_gate_insert', event: 4},
  {table: 'tenant_membership', name: 'tenant_membership_authority_gate_update', event: 16},
  {table: 'tenant_membership', name: 'tenant_membership_authority_gate_delete', event: 8},
  {table: 'roles', name: 'roles_authority_gate_insert', event: 4},
  {table: 'roles', name: 'roles_authority_gate_update', event: 16},
  {table: 'roles', name: 'roles_authority_gate_delete', event: 8},
]);

function invalid(message = 'The operator assertion is invalid.') {
  return new AccessError(401, 'OPERATOR_ACCESS_INVALID', message);
}

function gateUnavailable() {
  return new AccessError(503, 'OPERATOR_AUTHORITY_UNAVAILABLE', 'Operator authority serialization is unavailable.');
}

function decodePart(part, label) {
  if (typeof part !== 'string' || part.length === 0 || !BASE64URL.test(part)) throw invalid(`The ${label} is malformed.`);
  let buffer;
  try {
    buffer = Buffer.from(part, 'base64url');
  } catch {
    throw invalid(`The ${label} is malformed.`);
  }
  // Require canonical JOSE base64url. Alternate encodings of the same bytes (unused final
  // bits, padding or other non-canonical forms) are refused so replay identity cannot vary.
  if (buffer.toString('base64url') !== part) throw invalid(`The ${label} is not canonical.`);
  return buffer;
}

function parseJson(buffer, label) {
  try {
    const value = JSON.parse(buffer.toString('utf8'));
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('not an object');
    return value;
  } catch {
    throw invalid(`The ${label} is malformed.`);
  }
}

function normalizeKey(entry) {
  if (!entry || typeof entry !== 'object') throw new Error('Access keys must be objects.');
  const kid = entry.kid;
  if (typeof kid !== 'string' || kid.length === 0 || kid.length > 200) throw new Error('Access keys require a kid.');
  let key;
  if (entry.key && typeof entry.key === 'object' && entry.key.type) {
    key = entry.key;
  } else if (typeof entry.key === 'string' || Buffer.isBuffer(entry.key)) {
    key = createPublicKey(entry.key);
  } else if (entry.key && typeof entry.key === 'object') {
    key = createPublicKey({key: entry.key, format: 'jwk'});
  } else if (entry.jwk && typeof entry.jwk === 'object') {
    key = createPublicKey({key: entry.jwk, format: 'jwk'});
  } else {
    throw new Error('Access keys require a public key.');
  }
  return {kid, key};
}

function normalizeKeys(entries) {
  if (!Array.isArray(entries) || entries.length === 0) throw new Error('Access requires at least one trusted key.');
  const byKid = new Map();
  for (const entry of entries) {
    const normalized = normalizeKey(entry);
    if (byKid.has(normalized.kid)) throw new Error('Access key ids must be unique.');
    byKid.set(normalized.kid, normalized.key);
  }
  return byKid;
}

// Explicit multi-factor evidence only. `otp`, `hwk`, `swk` etc. are single methods and are
// not promoted to MFA. A deployment may supply a reviewed issuer-controlled predicate.
function defaultMfaEvidence(claims) {
  return Array.isArray(claims.amr) && claims.amr.some(value => value === 'mfa');
}

function sha256(value) {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

export function createAccessValidator({
  issuer,
  audience,
  algorithms = ['RS256'],
  keys,
  refreshKeys = null,
  clock = () => new Date(),
  skewSeconds = 30,
  requiredType = null,
  maxTokenAgeSeconds = null,
  refreshCooldownMs = 30_000,
  mfaEvidence = defaultMfaEvidence,
} = {}) {
  if (typeof issuer !== 'string' || issuer.length === 0) throw new Error('Access issuer is required.');
  if (typeof audience !== 'string' || audience.length === 0) throw new Error('Access audience is required.');
  if (!Array.isArray(algorithms) || algorithms.length === 0 ||
      algorithms.some(algorithm => !SUPPORTED_ALGORITHMS.includes(algorithm))) {
    throw new Error('Access algorithms must be a non-empty subset of RS256/RS384/RS512.');
  }
  if (typeof clock !== 'function') throw new Error('Access clock must be a function.');
  if (!Number.isInteger(skewSeconds) || skewSeconds < 0 || skewSeconds > 300) throw new Error('Access skew must be 0 to 300 seconds.');
  if (refreshKeys !== null && typeof refreshKeys !== 'function') throw new Error('Access refreshKeys must be a function when provided.');
  if (maxTokenAgeSeconds !== null && (!Number.isInteger(maxTokenAgeSeconds) || maxTokenAgeSeconds < 1)) {
    throw new Error('Access maxTokenAgeSeconds must be a positive integer.');
  }
  if (!Number.isInteger(refreshCooldownMs) || refreshCooldownMs < 0 || refreshCooldownMs > 60 * 60 * 1000) {
    throw new Error('Access refresh cooldown must be between 0 and one hour.');
  }
  if (typeof mfaEvidence !== 'function') throw new Error('Access mfaEvidence must be a function.');

  let trustedKeys = normalizeKeys(keys);
  const allowedAlgorithms = new Set(algorithms);
  const now = () => new Date(clock());
  let lastRefreshAt = -Infinity;
  let lastRefreshFailureAt = -Infinity;
  let refreshInFlight = null;

  function keyFor(kid) {
    return trustedKeys.get(kid) ?? null;
  }

  // Concurrency-safe fixed-source refresh: publish the flight before invoking, coalesce
  // callers, retain known-good keys on failure, and apply a retry cooldown. The flight is
  // a deliberately settled-on-completion promise; a synchronous throw in the callback
  // cannot overwrite it with a settled promise after the fact.
  async function refreshOnce() {
    if (refreshInFlight) return refreshInFlight;
    const at = now().getTime();
    if (at - lastRefreshAt < refreshCooldownMs) return false;
    if (at - lastRefreshFailureAt < refreshCooldownMs) return false;
    let release;
    const flight = new Promise(resolve => {
      release = resolve;
    });
    refreshInFlight = flight;
    (async () => {
      try {
        const refreshed = await refreshKeys();
        trustedKeys = normalizeKeys(refreshed);
        lastRefreshAt = now().getTime();
      } catch {
        lastRefreshFailureAt = now().getTime();
      } finally {
        // Clear only this flight. Assignment above happens before the callback runs, so a
        // synchronous throw cannot leave a settled promise latched here.
        refreshInFlight = null;
        release(true);
      }
    })();
    return flight;
  }

  function assertFresh(claims, at = now()) {
    const atSeconds = at.getTime() / 1000;
    if (typeof claims.exp !== 'number' || !Number.isFinite(claims.exp)) throw invalid('The operator assertion expiry is missing.');
    if (claims.exp + skewSeconds <= atSeconds) {
      throw new AccessError(401, 'OPERATOR_ACCESS_EXPIRED', 'The operator assertion has expired.');
    }
    if (claims.nbf !== undefined) {
      if (typeof claims.nbf !== 'number' || !Number.isFinite(claims.nbf)) throw invalid('The operator assertion not-before time is invalid.');
      if (claims.nbf > atSeconds + skewSeconds) {
        throw new AccessError(401, 'OPERATOR_ACCESS_NOT_YET_VALID', 'The operator assertion is not yet valid.');
      }
    }
    if (claims.iat !== undefined) {
      if (typeof claims.iat !== 'number' || !Number.isFinite(claims.iat)) throw invalid('The operator assertion issue time is invalid.');
      if (claims.iat > atSeconds + skewSeconds) throw invalid('The operator assertion issue time is invalid.');
      if (typeof claims.exp === 'number' && claims.exp <= claims.iat) throw invalid('The operator assertion lifetime is invalid.');
      if (maxTokenAgeSeconds !== null && atSeconds - claims.iat > maxTokenAgeSeconds + skewSeconds) {
        throw new AccessError(401, 'OPERATOR_ACCESS_STALE', 'The operator assertion is too old.');
      }
    } else if (maxTokenAgeSeconds !== null) {
      throw invalid('The operator assertion issue time is required.');
    }
  }

  function assertSourceFresh(issuedAt, at = now()) {
    if (maxTokenAgeSeconds === null) return;
    if (!(issuedAt instanceof Date) || Number.isNaN(issuedAt.getTime())) {
      throw new AccessError(401, 'OPERATOR_ACCESS_STALE', 'Operator assertion age cannot be established.');
    }
    const age = at.getTime() / 1000 - issuedAt.getTime() / 1000;
    if (age > maxTokenAgeSeconds + skewSeconds || age < -skewSeconds) {
      throw new AccessError(401, 'OPERATOR_ACCESS_STALE', 'The operator assertion is too old.');
    }
  }

  async function validate(token) {
    if (typeof token !== 'string' || token.length < 20 || token.length > 16384) throw invalid();
    const parts = token.split('.');
    if (parts.length !== 3) throw invalid();
    const headerBuffer = decodePart(parts[0], 'header');
    const payloadBuffer = decodePart(parts[1], 'payload');
    const signature = decodePart(parts[2], 'signature');
    const header = parseJson(headerBuffer, 'header');
    const payload = parseJson(payloadBuffer, 'payload');

    if (typeof header.alg !== 'string' || !allowedAlgorithms.has(header.alg)) {
      throw new AccessError(401, 'OPERATOR_ACCESS_ALGORITHM', 'The operator assertion algorithm is not accepted.');
    }
    if (typeof header.kid !== 'string' || header.kid.length === 0) throw invalid();
    // jku/x5u and any token-supplied key URL are deliberately ignored.
    let key = keyFor(header.kid);
    if (!key && refreshKeys) {
      await refreshOnce();
      key = keyFor(header.kid);
    }
    if (!key) throw invalid('The operator assertion key is not trusted.');

    let verified = false;
    try {
      verified = verifySignature(ALGORITHM_DIGEST[header.alg], Buffer.from(`${parts[0]}.${parts[1]}`, 'utf8'), key, signature);
    } catch {
      verified = false;
    }
    if (!verified) throw invalid('The operator assertion signature is invalid.');

    assertFresh(payload);
    if (payload.iss !== issuer) {
      throw new AccessError(401, 'OPERATOR_ACCESS_ISSUER', 'The operator assertion issuer is not trusted.');
    }
    const audiences = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
    if (!audiences.includes(audience)) {
      throw new AccessError(401, 'OPERATOR_ACCESS_AUDIENCE', 'The operator assertion audience is not accepted.');
    }
    if (typeof payload.sub !== 'string' || payload.sub.trim().length === 0 || payload.sub.length > 320) {
      throw invalid('The operator assertion subject is missing.');
    }
    if (requiredType !== null && payload.type !== requiredType) {
      throw new AccessError(403, 'OPERATOR_ACCESS_TYPE', 'The operator assertion type is not accepted.');
    }
    const mfa = mfaEvidence(payload);
    if (typeof mfa !== 'boolean') throw invalid('The operator MFA evidence is invalid.');
    const assurance = mfa ? REQUIRED_OPERATOR_ASSURANCE : 'access_asserted';
    const canonicalAssertion = `${parts[0]}.${parts[1]}.${parts[2]}`;

    return Object.freeze({
      subject: payload.sub,
      email: typeof payload.email === 'string' ? payload.email : null,
      issuer: payload.iss,
      audience,
      mfa,
      assurance,
      identityNonce: typeof payload.identity_nonce === 'string' ? payload.identity_nonce : null,
      expiresAt: new Date(payload.exp * 1000),
      issuedAt: typeof payload.iat === 'number' ? new Date(payload.iat * 1000) : null,
      canonicalDigest: sha256(canonicalAssertion),
      claims: Object.freeze({...payload}),
    });
  }

  // Immutable, secret-free descriptor of the policy actually captured by this validator.
  // Operator-read composition compares these real values (never an expected copy) with the
  // final SQL policy and refuses drift. This is metadata only: it changes no validation,
  // admission, replay or lifetime behavior.
  const capturedPolicy = Object.freeze({
    issuer,
    audience,
    requiredAssurance: REQUIRED_OPERATOR_ASSURANCE,
    maxSourceAgeSeconds: maxTokenAgeSeconds,
    maxClockSkewSeconds: skewSeconds,
  });

  return {
    validate,
    assertFresh,
    assertSourceFresh,
    algorithms: Object.freeze([...allowedAlgorithms]),
    issuer,
    audience,
    requiredAssurance: REQUIRED_OPERATOR_ASSURANCE,
    policy: capturedPolicy,
  };
}

function normalizeNonce(claims) {
  // Canonical, issuer/audience/subject-scoped replay identity. Never hash raw JWT text.
  if (typeof claims.identityNonce === 'string' && claims.identityNonce.length > 0) {
    return sha256(`nonce:${claims.issuer}|${claims.audience}|${claims.subject}|${claims.identityNonce}`);
  }
  return sha256(`assertion:${claims.issuer}|${claims.audience}|${claims.subject}|${claims.canonicalDigest}`);
}

// Explicit, scoped operator identity mapping. No local operator password/TOTP exists in
// this path; a session is created only from a validated assertion plus an active mapping to
// an active operator role and an active local identity.
export function createOperatorAccess({validator, store, clock = () => new Date(), policy = {}} = {}) {
  if (!validator || typeof validator.validate !== 'function' ||
      typeof validator.assertFresh !== 'function' || typeof validator.assertSourceFresh !== 'function') {
    throw new Error('createOperatorAccess requires an Access validator with freshness checks.');
  }
  if (!store || typeof store.withTransaction !== 'function' || typeof store.createSession !== 'function') {
    throw new Error('createOperatorAccess requires the transactional auth session store.');
  }
  const requiredAssurance = policy.requiredAssurance ?? REQUIRED_OPERATOR_ASSURANCE;
  if (requiredAssurance !== REQUIRED_OPERATOR_ASSURANCE) {
    throw new Error('Operator policy must require access_mfa; assertion-only assurance cannot be configured.');
  }
  const now = () => new Date(clock());

  async function assertAuthorityGate(executor) {
    let functionResult;
    let operatorTriggerResult;
    let authTriggerResult;
    try {
      functionResult = await executor.query(
        `SELECT p.oid AS oid, p.pronargs,
                p.prorettype = 'trigger'::regtype AS returns_trigger,
                p.prosecdef, p.proconfig,
                r.rolcanlogin AS owner_login, r.rolsuper AS owner_super,
                r.rolbypassrls AS owner_bypass,
                pg_has_role(current_user, p.proowner, 'MEMBER') AS owner_reachable
         FROM pg_proc p
         JOIN pg_namespace n ON n.oid = p.pronamespace
         JOIN pg_roles r ON r.oid = p.proowner
         WHERE n.nspname = 'auth' AND p.proname = 'lock_authority_gate'`,
      );
      operatorTriggerResult = await executor.query(
        `SELECT c.relname AS table_name, t.tgname, t.tgtype, t.tgenabled, t.tgfoid,
                (t.tgqual IS NULL) AS unconditional, t.tgnargs, t.tgconstraint,
                t.tgdeferrable, t.tginitdeferred, t.tgattr::text AS columns
         FROM pg_trigger t
         JOIN pg_class c ON c.oid = t.tgrelid
         JOIN pg_namespace n ON n.oid = c.relnamespace
         WHERE n.nspname = 'operator' AND c.relname = 'access_identity'
           AND NOT t.tgisinternal AND t.tgname = ANY($1)`,
        [OPERATOR_GATE_BINDINGS.map(binding => binding.name)],
      );
      authTriggerResult = await executor.query(
        `SELECT c.relname AS table_name, t.tgname, t.tgtype, t.tgenabled, t.tgfoid,
                (t.tgqual IS NULL) AS unconditional, t.tgnargs, t.tgconstraint,
                t.tgdeferrable, t.tginitdeferred, t.tgattr::text AS columns
         FROM pg_trigger t
         JOIN pg_class c ON c.oid = t.tgrelid
         JOIN pg_namespace n ON n.oid = c.relnamespace
         WHERE n.nspname = 'auth' AND c.relname IN ('tenant_membership', 'roles')
           AND NOT t.tgisinternal AND t.tgname = ANY($1)`,
        [AUTH_GATE_BINDINGS.map(binding => binding.name)],
      );
    } catch {
      throw gateUnavailable();
    }
    if (functionResult.rowCount !== 1) throw gateUnavailable();
    const fn = functionResult.rows[0];
    if (Number(fn.pronargs) !== 0 || fn.returns_trigger !== true || fn.prosecdef !== false ||
        fn.owner_login !== false || fn.owner_super !== false || fn.owner_bypass !== false ||
        fn.owner_reachable !== false || !Array.isArray(fn.proconfig) ||
        fn.proconfig.length !== 1 || fn.proconfig[0] !== 'search_path=pg_catalog') {
      throw gateUnavailable();
    }

    const assertBindings = (rows, bindings) => {
      if (rows.length !== bindings.length) throw gateUnavailable();
      for (const expected of bindings) {
        const matches = rows.filter(row => row.table_name === expected.table && row.tgname === expected.name);
        if (matches.length !== 1) throw gateUnavailable();
        const trigger = matches[0];
        if (Number(trigger.tgtype) !== (2 | expected.event) ||
            (trigger.tgenabled !== 'O' && trigger.tgenabled !== 'A') ||
            Number(trigger.tgfoid) !== Number(fn.oid) ||
            trigger.unconditional !== true ||
            Number(trigger.tgnargs) !== 0 ||
            Number(trigger.tgconstraint) !== 0 ||
            trigger.tgdeferrable !== false ||
            trigger.tginitdeferred !== false ||
            trigger.columns !== '') {
          throw gateUnavailable();
        }
      }
    };
    assertBindings(operatorTriggerResult.rows, OPERATOR_GATE_BINDINGS);
    assertBindings(authTriggerResult.rows, AUTH_GATE_BINDINGS);
  }

  async function acquireGate(executor) {
    await assertAuthorityGate(executor);
    try {
      await executor.query('SELECT pg_advisory_xact_lock_shared(hashtextextended($1, 0))', [AUTHORITY_GATE_KEY]);
    } catch {
      throw gateUnavailable();
    }
  }

  async function loadMapping(executor, subject, at) {
    const result = await executor.query(
      `SELECT ai.subject, ai.user_id, ai.email, ai.operator_role_id, ai.assurance_class,
              ai.status, ai.mapping_epoch, ai.effective_from, ai.effective_to,
              u.status AS user_status, u.credential_version,
              r.is_operator, r.is_active AS role_active,
              r.effective_from AS role_effective_from, r.effective_to AS role_effective_to
       FROM operator.access_identity ai
       JOIN auth.users u ON u.id = ai.user_id
       JOIN auth.roles r ON r.role_id = ai.operator_role_id
       WHERE ai.subject = $1`,
      [subject],
    );
    if (result.rowCount !== 1) return null;
    const mapping = result.rows[0];
    const usable = mapping.status === 'active' &&
      mapping.user_status === 'active' &&
      mapping.role_active === true &&
      mapping.is_operator === true &&
      mapping.assurance_class === REQUIRED_OPERATOR_ASSURANCE &&
      new Date(mapping.effective_from).getTime() <= at.getTime() &&
      (mapping.effective_to === null || new Date(mapping.effective_to).getTime() > at.getTime()) &&
      new Date(mapping.role_effective_from).getTime() <= at.getTime() &&
      (mapping.role_effective_to === null || new Date(mapping.role_effective_to).getTime() > at.getTime());
    return usable ? mapping : null;
  }

  async function exchange(assertion, {ipAddress = null, userAgent = null, requestId = null, onSuccess = null} = {}) {
    const claims = await validator.validate(assertion);
    if (claims.mfa !== true || claims.assurance !== REQUIRED_OPERATOR_ASSURANCE) {
      throw new AccessError(403, 'OPERATOR_MFA_REQUIRED', 'Operator MFA assurance is required.');
    }
    return store.withTransaction(async tx => {
      await acquireGate(tx);
      let at = now();
      validator.assertFresh(claims.claims, at);

      // Read mapping under the shared gate, then lock the local principal in the accepted
      // gate -> user -> session order. Re-sample the trusted clock after the lock for the
      // final freshness/window decision.
      const mapping = await loadMapping(tx, claims.subject, at);
      if (!mapping) throw new AccessError(403, 'OPERATOR_ACCESS_DENIED', 'Operator access is not authorized.');
      const user = await tx.query(
        'SELECT id, status, credential_version FROM auth.users WHERE id = $1 FOR SHARE',
        [mapping.user_id],
      );
      if (user.rowCount !== 1 || user.rows[0].status !== 'active') {
        throw new AccessError(403, 'OPERATOR_ACCESS_DENIED', 'Operator access is not authorized.');
      }
      at = now();
      validator.assertFresh(claims.claims, at);
      const finalMapping = await loadMapping(tx, claims.subject, at);
      if (!finalMapping || Number(finalMapping.mapping_epoch) !== Number(mapping.mapping_epoch)) {
        throw new AccessError(403, 'OPERATOR_ACCESS_DENIED', 'Operator access is not authorized.');
      }

      const nonceHash = normalizeNonce(claims);
      const consumed = await tx.query(
        `INSERT INTO operator.access_exchange(nonce_hash, subject, token_expires_at, request_id)
         VALUES ($1, $2, $3::timestamptz, $4)
         ON CONFLICT (nonce_hash) DO NOTHING
         RETURNING nonce_hash`,
        [nonceHash, finalMapping.subject, claims.expiresAt.toISOString(), requestId],
      );
      if (consumed.rowCount !== 1) {
        throw new AccessError(409, 'OPERATOR_EXCHANGE_REPLAY', 'This operator assertion has already been exchanged.');
      }

      const created = await store.createSession({
        userId: finalMapping.user_id,
        realm: 'operator',
        roleId: finalMapping.operator_role_id,
        assuranceLevel: 'access_asserted',
        ipAddress,
        userAgent,
        credentialVersion: Number(user.rows[0].credential_version),
      }, {tx});
      await tx.query(
        `INSERT INTO operator.access_session_binding(
           session_id, subject, issuer, audience, mapping_epoch, binding_scheme,
           operator_role_id, assurance_class, source_issued_at, source_expires_at, admitted_at)
         VALUES ($1::uuid, $2, $3, $4, $5, 'generation-v1', $6, $7, $8::timestamptz, $9::timestamptz, $10::timestamptz)`,
        [
          created.session.id,
          finalMapping.subject,
          claims.issuer,
          claims.audience,
          Number(finalMapping.mapping_epoch),
          finalMapping.operator_role_id,
          REQUIRED_OPERATOR_ASSURANCE,
          claims.issuedAt ? claims.issuedAt.toISOString() : null,
          claims.expiresAt.toISOString(),
          at.toISOString(),
        ],
      );
      await onSuccess?.({tx, claims, mapping: finalMapping, session: created, admittedAt: at});

      return {
        token: created.token,
        csrfToken: created.csrfToken,
        session: created.session,
        subject: finalMapping.subject,
        roleId: finalMapping.operator_role_id,
        assurance: REQUIRED_OPERATOR_ASSURANCE,
        sourceExpiresAt: claims.expiresAt,
      };
    });
  }

  // Reusable operator admission for the current session and any future PIVOT-007 privileged
  // read. Must be called inside the same owned transaction as the read. Revalidates the
  // bound issuer/subject/audience, current mapping epoch/role/assurance, principal, source
  // expiry and local session liveness under the shared authority gate.
  async function admitSession(session, {tx} = {}) {
    if (!tx) throw new Error('Operator admission requires an owned transaction client.');
    if (!session || typeof session.id !== 'string' || typeof session.userId !== 'string') {
      throw new AccessError(401, 'SESSION_REQUIRED', 'Sign in required.');
    }
    await acquireGate(tx);

    // Resolve identity from the pre-read session object, but do NOT lock the session first.
    // Accepted order: gate -> principal/lifecycle -> session. This avoids the
    // reset lifecycle's users -> sessions order deadlocking with admission.
    const user = await tx.query(
      'SELECT id, status, credential_version FROM auth.users WHERE id = $1 FOR SHARE',
      [session.userId],
    );
    if (user.rowCount !== 1 || user.rows[0].status !== 'active') {
      throw new AccessError(401, 'SESSION_REQUIRED', 'Sign in required.');
    }

    // Re-read the exact session under lock after the principal lock. readSessionById
    // revalidates revocation, both expiries, status and credential generation against the
    // locked principal, so a reset/credential update that won before this point fails
    // closed; one that arrives after blocks on the user lock.
    const current = await store.readSessionById(session.id, {tx, forUpdate: true, realm: 'operator'});
    if (!current) throw new AccessError(401, 'SESSION_REQUIRED', 'Sign in required.');
    if (current.userId !== session.userId) throw new AccessError(403, 'OPERATOR_ACCESS_DENIED', 'Operator access is not authorized.');

    // Trusted time is sampled only after all blocking authority acquisitions.
    const at = now();

    const bindingResult = await tx.query(
      `SELECT session_id, subject, issuer, audience, mapping_epoch, binding_scheme,
              operator_role_id, assurance_class, source_issued_at, source_expires_at, admitted_at
       FROM operator.access_session_binding WHERE session_id = $1::uuid`,
      [current.id],
    );
    if (bindingResult.rowCount !== 1) throw new AccessError(403, 'OPERATOR_ACCESS_DENIED', 'Operator access is not authorized.');
    const binding = bindingResult.rows[0];
    if (binding.binding_scheme !== 'generation-v1' ||
        binding.issuer !== validator.issuer ||
        binding.audience !== validator.audience ||
        binding.assurance_class !== REQUIRED_OPERATOR_ASSURANCE) {
      throw new AccessError(403, 'OPERATOR_ACCESS_DENIED', 'Operator access is not authorized.');
    }
    if (new Date(binding.source_expires_at).getTime() <= at.getTime()) {
      throw new AccessError(401, 'OPERATOR_ACCESS_EXPIRED', 'The operator assertion has expired.');
    }
    validator.assertSourceFresh(
      binding.source_issued_at === null ? null : new Date(binding.source_issued_at),
      at,
    );
    const mapping = await loadMapping(tx, binding.subject, at);
    if (!mapping ||
        String(mapping.user_id) !== String(current.userId) ||
        mapping.operator_role_id !== binding.operator_role_id ||
        Number(mapping.mapping_epoch) !== Number(binding.mapping_epoch) ||
        mapping.assurance_class !== binding.assurance_class) {
      throw new AccessError(403, 'OPERATOR_ACCESS_DENIED', 'Operator access is not authorized.');
    }
    return {
      session: current,
      binding,
      mapping,
      roleId: binding.operator_role_id,
      assurance: binding.assurance_class,
      sourceExpiresAt: new Date(binding.source_expires_at),
      admittedAt: at,
      policy: validator.policy,
    };
  }

  async function inspectSession(token) {
    if (typeof token !== 'string' || token.length < 16) throw new AccessError(401, 'SESSION_REQUIRED', 'Sign in required.');
    const session = await store.readSession(token, {realm: 'operator'});
    if (!session) throw new AccessError(401, 'SESSION_REQUIRED', 'Sign in required.');
    return store.withTransaction(tx => admitSession(session, {tx}));
  }

  return {exchange, admitSession, inspectSession, requiredAssurance, policy: validator.policy};
}
