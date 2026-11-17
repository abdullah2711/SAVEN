import {createHash, createPublicKey, verify as verifySignature} from 'node:crypto';

// AUTH-007 Cloud operator Access validation and scoped subject mapping.
//
// The validator trusts ONE configured issuer, audience, algorithm set and key source. It
// never fetches a key from a token-supplied URL (jku/x5u are ignored), and it only consults
// the injected fixed key set/refresh callback. A token that names an unknown key id fails
// closed unless the fixed refresh callback returns the new set.
//
// A valid assertion alone is not MFA proof. The exchange service requires the configured
// assurance class (default access_mfa) to be derived from a verified claim, and maps the
// Access subject to an explicit active operator identity row. There is no local Cloud
// operator password/TOTP and no wildcard/universal support subject.

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

function invalid(message = 'The operator assertion is invalid.') {
  return new AccessError(401, 'OPERATOR_ACCESS_INVALID', message);
}

function decodePart(part, label) {
  if (typeof part !== 'string' || part.length === 0 || !BASE64URL.test(part)) throw invalid(`The ${label} is malformed.`);
  try {
    return Buffer.from(part, 'base64url');
  } catch {
    throw invalid(`The ${label} is malformed.`);
  }
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

function defaultAssurance(claims) {
  const amr = Array.isArray(claims.amr) ? claims.amr.map(value => String(value).toLowerCase()) : [];
  const explicit = claims?.custom?.assurance;
  if (typeof explicit === 'string' && explicit.length > 0) return explicit;
  if (amr.some(value => ['mfa', 'otp', 'hwk', 'swk'].includes(value))) return 'access_mfa';
  return 'access_asserted';
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
  assuranceFromClaims = defaultAssurance,
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
  if (typeof assuranceFromClaims !== 'function') throw new Error('Access assuranceFromClaims must be a function.');

  let trustedKeys = normalizeKeys(keys);
  let lastRefreshAt = -Infinity;
  const allowedAlgorithms = new Set(algorithms);
  const now = () => new Date(clock());

  function keyFor(kid) {
    return trustedKeys.get(kid) ?? null;
  }

  async function validate(token) {
    if (typeof token !== 'string' || token.length < 20 || token.length > 16384) throw invalid();
    const parts = token.split('.');
    if (parts.length !== 3) throw invalid();
    const header = parseJson(decodePart(parts[0], 'header'), 'header');
    const payload = parseJson(decodePart(parts[1], 'payload'), 'payload');

    if (typeof header.alg !== 'string' || !allowedAlgorithms.has(header.alg)) {
      throw new AccessError(401, 'OPERATOR_ACCESS_ALGORITHM', 'The operator assertion algorithm is not accepted.');
    }
    if (typeof header.kid !== 'string' || header.kid.length === 0) throw invalid();
    // jku/x5u and any token-supplied key URL are deliberately ignored.
    let key = keyFor(header.kid);
    if (!key && refreshKeys) {
      const atRefresh = now().getTime();
      if (atRefresh - lastRefreshAt >= refreshCooldownMs) {
        const refreshed = await refreshKeys();
        trustedKeys = normalizeKeys(refreshed);
        lastRefreshAt = atRefresh;
        key = keyFor(header.kid);
      }
    }
    if (!key) throw invalid('The operator assertion key is not trusted.');

    const signature = decodePart(parts[2], 'signature');
    let verified = false;
    try {
      verified = verifySignature(ALGORITHM_DIGEST[header.alg], Buffer.from(`${parts[0]}.${parts[1]}`, 'utf8'), key, signature);
    } catch {
      verified = false;
    }
    if (!verified) throw invalid('The operator assertion signature is invalid.');

    const at = now();
    const nowSeconds = at.getTime() / 1000;
    if (typeof payload.exp !== 'number' || !Number.isFinite(payload.exp)) throw invalid('The operator assertion expiry is missing.');
    if (payload.exp + skewSeconds <= nowSeconds) {
      throw new AccessError(401, 'OPERATOR_ACCESS_EXPIRED', 'The operator assertion has expired.');
    }
    if (payload.nbf !== undefined && (typeof payload.nbf !== 'number' || payload.nbf > nowSeconds + skewSeconds)) {
      throw new AccessError(401, 'OPERATOR_ACCESS_NOT_YET_VALID', 'The operator assertion is not yet valid.');
    }
    if (payload.iat !== undefined && (typeof payload.iat !== 'number' || payload.iat > nowSeconds + skewSeconds)) {
      throw invalid('The operator assertion issue time is invalid.');
    }
    if (maxTokenAgeSeconds !== null && typeof payload.iat === 'number' && nowSeconds - payload.iat > maxTokenAgeSeconds + skewSeconds) {
      throw new AccessError(401, 'OPERATOR_ACCESS_STALE', 'The operator assertion is too old.');
    }
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
    const assurance = assuranceFromClaims(payload);
    if (typeof assurance !== 'string' || assurance.length === 0) throw invalid('The operator assurance claim is invalid.');

    return Object.freeze({
      subject: payload.sub,
      email: typeof payload.email === 'string' ? payload.email : null,
      issuer: payload.iss,
      audience,
      assurance,
      identityNonce: typeof payload.identity_nonce === 'string' ? payload.identity_nonce : null,
      expiresAt: new Date(payload.exp * 1000),
      issuedAt: typeof payload.iat === 'number' ? new Date(payload.iat * 1000) : null,
      claims: Object.freeze({...payload}),
    });
  }

  return {validate, algorithms: Object.freeze([...allowedAlgorithms]), issuer, audience};
}

function normalizeNonce(claims, assertion) {
  const source = typeof claims.identityNonce === 'string' && claims.identityNonce.length > 0
    ? `nonce:${claims.identityNonce}`
    : `assertion:${assertion}`;
  return createHash('sha256').update(source, 'utf8').digest('hex');
}

// Explicit, scoped operator identity mapping. No local operator password/TOTP exists in
// this path; a session is created only from a validated assertion plus an active mapping to
// an active operator role and an active local identity.
export function createOperatorAccess({validator, store, clock = () => new Date(), policy = {}} = {}) {
  if (!validator || typeof validator.validate !== 'function') throw new Error('createOperatorAccess requires an Access validator.');
  if (!store || typeof store.withTransaction !== 'function' || typeof store.createSession !== 'function') {
    throw new Error('createOperatorAccess requires the transactional auth session store.');
  }
  const requiredAssurance = policy.requiredAssurance ?? 'access_mfa';
  if (typeof requiredAssurance !== 'string' || requiredAssurance.length === 0) {
    throw new Error('Operator assurance policy must name a required assurance class.');
  }
  const now = () => new Date(clock());

  async function exchange(assertion, {ipAddress = null, userAgent = null, requestId = null, onSuccess = null} = {}) {
    const claims = await validator.validate(assertion);
    if (claims.assurance !== requiredAssurance) {
      throw new AccessError(403, 'OPERATOR_MFA_REQUIRED', 'Operator MFA assurance is required.');
    }
    const at = now();
    return store.withTransaction(async tx => {
      const mappingResult = await tx.query(
        `SELECT ai.subject, ai.user_id, ai.email, ai.operator_role_id, ai.assurance_class,
                ai.status, ai.effective_from, ai.effective_to,
                u.status AS user_status, u.credential_version,
                r.is_operator, r.is_active AS role_active,
                r.effective_from AS role_effective_from, r.effective_to AS role_effective_to
         FROM operator.access_identity ai
         JOIN auth.users u ON u.id = ai.user_id
         JOIN auth.roles r ON r.role_id = ai.operator_role_id
         WHERE ai.subject = $1`,
        [claims.subject],
      );
      if (mappingResult.rowCount !== 1) {
        throw new AccessError(403, 'OPERATOR_ACCESS_DENIED', 'Operator access is not authorized.');
      }
      const mapping = mappingResult.rows[0];
      const active = mapping.status === 'active' &&
        mapping.user_status === 'active' &&
        mapping.role_active === true &&
        mapping.is_operator === true &&
        new Date(mapping.effective_from).getTime() <= at.getTime() &&
        (mapping.effective_to === null || new Date(mapping.effective_to).getTime() > at.getTime()) &&
        new Date(mapping.role_effective_from).getTime() <= at.getTime() &&
        (mapping.role_effective_to === null || new Date(mapping.role_effective_to).getTime() > at.getTime()) &&
        mapping.assurance_class === requiredAssurance;
      if (!active) throw new AccessError(403, 'OPERATOR_ACCESS_DENIED', 'Operator access is not authorized.');

      const nonceHash = normalizeNonce(claims, assertion);
      const consumed = await tx.query(
        `INSERT INTO operator.access_exchange(nonce_hash, subject, token_expires_at, request_id)
         VALUES ($1, $2, $3::timestamptz, $4)
         ON CONFLICT (nonce_hash) DO NOTHING
         RETURNING nonce_hash`,
        [nonceHash, mapping.subject, claims.expiresAt.toISOString(), requestId],
      );
      if (consumed.rowCount !== 1) {
        throw new AccessError(409, 'OPERATOR_EXCHANGE_REPLAY', 'This operator assertion has already been exchanged.');
      }

      const created = await store.createSession({
        userId: mapping.user_id,
        realm: 'operator',
        roleId: mapping.operator_role_id,
        assuranceLevel: 'access_asserted',
        ipAddress,
        userAgent,
        credentialVersion: Number(mapping.credential_version),
      }, {tx});
      await onSuccess?.({tx, claims, mapping, session: created});

      return {
        token: created.token,
        csrfToken: created.csrfToken,
        session: created.session,
        subject: mapping.subject,
        roleId: mapping.operator_role_id,
        assurance: claims.assurance,
      };
    });
  }

  return {exchange, requiredAssurance};
}
