// PIVOT-007 operator support read — bounded publishing adapter.
//
// This module is the only authorized path that may return customer tenant rows to an
// operator caller. It composes the accepted AUTH-007 operator inspection boundary as a
// completed preflight with the constrained PIVOT-007 SQL boundary as the final authority,
// keeps rows private until COMMIT, and records refusals in a separate transaction after
// releasing the read client.
//
// Boundaries it does NOT own (all injected):
//   * AUTH-007 bearer/session verification (`inspectSession`);
//   * the restricted operator-read database login/pool (`connectOperator`);
//   * deployment policy values shared with `operator.access_read_policy`.
//
// It never receives a caller-supplied operator id or tenant-authority claim. The tenant,
// action, resource and company are request targets that the SQL boundary must match to a
// current customer grant. Raw bearer values and bearer-equivalent digests are never logged,
// stored in results or included in errors.

import {createHash} from 'node:crypto';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DIGEST = /^[0-9a-f]{64}$/;
const REQUIRED_ASSURANCE = 'access_mfa';

const READ_SQL =
  'SELECT operator.read_tenant_support($1::uuid,$2,$3,$4,$5,$6,$7,$8) AS result';
const DENY_SQL =
  'SELECT operator.log_operator_read_denial($1::uuid,$2,$3,$4,$5,$6,$7,$8)';

export class OperatorSupportReadError extends Error {
  constructor(code, message, {status = 503, cause = null, denialEvidence = null} = {}) {
    super(message, cause ? {cause} : undefined);
    this.name = 'OperatorSupportReadError';
    this.code = code;
    this.status = status;
    this.denialEvidence = denialEvidence;
    this.denialLoggingFailed = denialEvidence ? denialEvidence.committed !== true : null;
  }
}

// Canonical policy identity shared with the SQL boundary. Any difference between the
// configured adapter policy and the row the SQL boundary actually used is a refusal.
export function policyFingerprint(policy) {
  const canonical = [
    'operator_read',
    `v${policy.version ?? 1}`,
    policy.issuer,
    policy.audience,
    policy.requiredAssurance,
    policy.maxSourceAgeSeconds,
    policy.maxClockSkewSeconds,
  ].join('|');
  return createHash('sha256').update(canonical, 'utf8').digest('hex');
}

function assertPolicy(policy) {
  if (!policy || typeof policy !== 'object') {
    throw new TypeError('createOperatorSupportRead requires an expectedPolicy object.');
  }
  for (const field of ['issuer', 'audience']) {
    if (typeof policy[field] !== 'string' || policy[field].length < 1 || policy[field].length > 320) {
      throw new TypeError(`expectedPolicy.${field} must be a bounded non-empty string.`);
    }
  }
  if (policy.requiredAssurance !== REQUIRED_ASSURANCE) {
    throw new TypeError('expectedPolicy.requiredAssurance must be access_mfa; weaker labels are not configurable.');
  }
  if (!Number.isSafeInteger(policy.maxSourceAgeSeconds) || policy.maxSourceAgeSeconds < 1) {
    throw new TypeError('expectedPolicy.maxSourceAgeSeconds must be a positive integer.');
  }
  if (!Number.isSafeInteger(policy.maxClockSkewSeconds) || policy.maxClockSkewSeconds < 0) {
    throw new TypeError('expectedPolicy.maxClockSkewSeconds must be a non-negative integer.');
  }
}

function digestOf(token) {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

function denialCode(error, fallback) {
  const text = typeof error?.message === 'string' ? error.message : '';
  const match = /\b(OPERATOR_[A-Z_]+)\b/.exec(text);
  return match ? match[1] : fallback;
}

function annotate(error, denialEvidence) {
  if (error && typeof error === 'object') {
    error.denialEvidence = denialEvidence;
    error.denialLoggingFailed = denialEvidence ? denialEvidence.committed !== true : null;
  }
  return error;
}

export function createOperatorSupportRead({
  connectOperator,
  inspectSession,
  expectedPolicy,
  maxRows = 200,
} = {}) {
  if (typeof connectOperator !== 'function') {
    throw new TypeError('createOperatorSupportRead requires connectOperator() returning a checked-out client.');
  }
  if (typeof inspectSession !== 'function') {
    throw new TypeError('createOperatorSupportRead requires the accepted AUTH-007 inspectSession(token) interface.');
  }
  assertPolicy(expectedPolicy);
  if (!Number.isSafeInteger(maxRows) || maxRows < 1 || maxRows > 500) {
    throw new TypeError('maxRows must be an integer between 1 and 500.');
  }
  const fingerprint = policyFingerprint({...expectedPolicy, version: expectedPolicy.version ?? 1});

  // Denial evidence is written only after any read client has been released/destroyed, so
  // a size-one operator pool cannot starve. Failure to commit is returned to the caller as
  // an observable condition instead of being swallowed.
  async function recordDenial({
    sessionId = null,
    proof = null,
    tenantId = null,
    resource = null,
    action = null,
    company = null,
    code,
    reason = null,
    requestId = null,
  }) {
    let client = null;
    let released = false;
    try {
      client = await connectOperator();
      await client.query('BEGIN');
      if (typeof sessionId === 'string' && UUID.test(sessionId)) {
        await client.query('SELECT set_config($1, $2, true)', ['app.operator_session_id', sessionId]);
      }
      await client.query(DENY_SQL, [
        tenantId, proof, resource, action, company, code, reason, requestId,
      ]);
      await client.query('COMMIT');
      return {committed: true, code};
    } catch {
      if (client) {
        try {
          await client.query('ROLLBACK');
        } catch {
          // The client is destroyed below; rollback failure is not suppressed silently.
        }
        try {
          client.release(true);
          released = true;
        } catch {
          released = true;
        }
      }
      return {committed: false, code: 'OPERATOR_DENIAL_LOG_FAILED'};
    } finally {
      if (client && !released) {
        try {
          client.release();
        } catch {
          // Pool release failures are surfaced by the caller's original error path.
        }
      }
    }
  }

  function safeText(value, max) {
    return typeof value === 'string' && value.length > 0 && value.length <= max ? value : null;
  }

  function safeTenant(value) {
    return typeof value === 'string' && UUID.test(value) ? value : null;
  }

  async function refuseEarly(input, message) {
    const denial = await recordDenial({
      code: 'OPERATOR_CONTEXT_REQUIRED',
      tenantId: safeTenant(input?.tenantId),
      resource: safeText(input?.resource, 80),
      action: safeText(input?.action, 120),
      company: safeText(input?.company, 120),
      reason: safeText(input?.reason, 1000),
      requestId: safeText(input?.requestId, 200),
    });
    throw new OperatorSupportReadError('OPERATOR_CONTEXT_REQUIRED', message, {
      status: 401,
      denialEvidence: denial,
    });
  }

  async function read(input = {}) {
    const {
      token,
      tenantId,
      resource,
      action,
      company = null,
      reason,
      requestId = null,
      limit = maxRows,
    } = input;

    // A missing/short/oversize bearer is an authentication refusal, not a successful
    // logging boundary: record independent unverified denial evidence before throwing.
    if (typeof token !== 'string' || token.length < 16 || token.length > 16384) {
      await refuseEarly(input, 'A verified operator bearer is required.');
    }
    if (typeof tenantId !== 'string' || !UUID.test(tenantId)) {
      throw new OperatorSupportReadError('OPERATOR_ARGUMENT_INVALID', 'A target tenant is required.', {status: 400});
    }
    if (typeof resource !== 'string' || typeof action !== 'string' || typeof reason !== 'string') {
      throw new OperatorSupportReadError('OPERATOR_ARGUMENT_INVALID', 'Resource, action and reason are required.', {status: 400});
    }
    if (company !== null && typeof company !== 'string') {
      throw new OperatorSupportReadError('OPERATOR_ARGUMENT_INVALID', 'The company scope is malformed.', {status: 400});
    }
    if (requestId !== null && typeof requestId !== 'string') {
      throw new OperatorSupportReadError('OPERATOR_ARGUMENT_INVALID', 'The request id is malformed.', {status: 400});
    }
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > maxRows) {
      throw new OperatorSupportReadError('OPERATOR_ARGUMENT_INVALID', 'The row limit is out of range.', {status: 400});
    }

    const proof = digestOf(token);

    // Completed AUTH-007 preflight. It owns and releases its own transaction; the result is
    // never treated as the final authority for the operator-read boundary.
    let admitted;
    try {
      admitted = await inspectSession(token);
    } catch (error) {
      const denial = await recordDenial({
        code: denialCode(error, 'OPERATOR_ADMISSION_DENIED'),
        tenantId,
        resource,
        action,
        company,
        reason,
        requestId,
      });
      throw new OperatorSupportReadError(
        denialCode(error, 'OPERATOR_ADMISSION_DENIED'),
        'Operator admission was refused.',
        {status: error?.status ?? 403, cause: error, denialEvidence: denial},
      );
    }

    const binding = admitted?.binding;
    const sessionId = admitted?.session?.id;
    if (!binding || !sessionId || typeof sessionId !== 'string' || !UUID.test(sessionId)) {
      const denial = await recordDenial({
        code: 'OPERATOR_POLICY_DRIFT',
        tenantId, resource, action, company, reason, requestId,
      });
      throw new OperatorSupportReadError('OPERATOR_POLICY_DRIFT', 'Operator admission did not return verifiable current authority.', {
        status: 403,
        denialEvidence: denial,
      });
    }
    const actualPolicy = admitted.policy;
    if (!actualPolicy
        || actualPolicy.issuer !== expectedPolicy.issuer
        || actualPolicy.audience !== expectedPolicy.audience
        || actualPolicy.requiredAssurance !== REQUIRED_ASSURANCE
        || actualPolicy.maxSourceAgeSeconds !== expectedPolicy.maxSourceAgeSeconds
        || actualPolicy.maxClockSkewSeconds !== expectedPolicy.maxClockSkewSeconds
        || admitted.assurance !== expectedPolicy.requiredAssurance
        || binding.issuer !== expectedPolicy.issuer
        || binding.audience !== expectedPolicy.audience
        || binding.assurance_class !== expectedPolicy.requiredAssurance) {
      const denial = await recordDenial({
        sessionId, proof, code: 'OPERATOR_POLICY_DRIFT',
        tenantId, resource, action, company, reason, requestId,
      });
      throw new OperatorSupportReadError('OPERATOR_POLICY_DRIFT', 'Operator admission policy differs from the configured read policy.', {
        status: 403,
        denialEvidence: denial,
      });
    }

    let client = null;
    let phase = 'connect';
    let payload = null;
    try {
      client = await connectOperator();
      phase = 'begin';
      await client.query('BEGIN');
      phase = 'context';
      await client.query('SELECT set_config($1, $2, true)', ['app.operator_session_id', sessionId]);
      phase = 'read';
      const response = await client.query(READ_SQL, [
        tenantId, proof, resource, action, company, reason, requestId, limit,
      ]);
      payload = response?.rows?.[0]?.result ?? null;
      if (!payload || typeof payload !== 'object' || !Array.isArray(payload.rows)) {
        throw new OperatorSupportReadError('OPERATOR_READ_UNAVAILABLE', 'The constrained read returned no publishable result.');
      }

      // Compare the policy the SQL boundary actually used against the configured policy
      // and the preflight identity before committing anything.
      if (payload.policy?.fingerprint !== fingerprint
          || payload.policy?.requiredAssurance !== expectedPolicy.requiredAssurance
          || payload.operator?.subject !== binding.subject
          || payload.operator?.roleId !== binding.operator_role_id
          || payload.operator?.assurance !== expectedPolicy.requiredAssurance) {
        throw new OperatorSupportReadError('OPERATOR_POLICY_DRIFT', 'The SQL authority policy or actor identity drifted from the preflight.');
      }

      phase = 'commit';
      await client.query('COMMIT');
      phase = 'committed';
    } catch (error) {
      const commitUncertain = phase === 'commit';
      if (client && phase !== 'committed') {
        try {
          await client.query('ROLLBACK');
        } catch {
          // Destroy the exact client below; rows remain private and unpublished.
        }
      }
      if (client) {
        try {
          client.release(true);
        } catch {
          // Release failure must not replace the original failure.
        }
        client = null;
      }
      payload = null;
      const code = commitUncertain
        ? 'OPERATOR_PUBLICATION_UNCERTAIN'
        : (error instanceof OperatorSupportReadError
          ? error.code
          : denialCode(error, 'OPERATOR_READ_FAILED'));
      const denial = await recordDenial({
        sessionId, proof, code, tenantId, resource, action, company, reason, requestId,
      });
      if (commitUncertain) {
        throw new OperatorSupportReadError(
          'OPERATOR_PUBLICATION_UNCERTAIN',
          'The operator read outcome is uncertain; no rows were published.',
          {status: 503, cause: error, denialEvidence: denial},
        );
      }
      if (error instanceof OperatorSupportReadError) {
        error.denialEvidence = denial;
        error.denialLoggingFailed = denial.committed !== true;
        throw error;
      }
      throw annotate(new OperatorSupportReadError(code, 'The operator read was refused.', {
        status: 503,
        cause: error,
        denialEvidence: denial,
      }), denial);
    } finally {
      if (client) {
        try {
          client.release(phase !== 'committed');
        } catch {
          // A release failure after COMMIT is not a disclosure; the rows were already
          // returned only after this point.
        }
      }
    }

    return payload;
  }

  return {read};
}
