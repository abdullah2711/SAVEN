// AUTH-006 tenant-context boundary.
//
// Every business transaction runs on ONE checked-out client with transaction-local
// context:
//
//   SELECT set_config('app.current_tenant_id', $1, true)
//   SELECT set_config('app.current_user_id',   $2, true)
//
// `set_config(..., true)` is equivalent to SET LOCAL: the values live only for that
// transaction and cannot leak across COMMIT/ROLLBACK or into the next borrower of the
// connection. Session-level `SET` is forbidden. This is also what makes the boundary safe
// behind PgBouncer in transaction mode: no session state is assumed and the same client
// carries every statement of one transaction.
//
// The handler receives only the client and the verified context; this module never calls
// pool.query and never takes a second checkout while the business transaction is open.
// Company/resource policies are enforced by RLS on top of this tenant context, not
// replaced by it.

export class TenantContextError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function assertResolved(resolved) {
  if (!resolved || typeof resolved !== 'object') {
    throw new TenantContextError(409, 'TENANT_SELECTION_REQUIRED', 'Select a business before continuing.');
  }
  for (const field of ['userId', 'tenantId', 'membershipId']) {
    if (typeof resolved[field] !== 'string' || !UUID.test(resolved[field])) {
      throw new TenantContextError(403, 'TENANT_ACCESS_DENIED', 'Tenant access denied.');
    }
  }
  if (!Number.isSafeInteger(resolved.membershipEpoch) || resolved.membershipEpoch < 1) {
    throw new TenantContextError(409, 'TENANT_SELECTION_STALE', 'Your access changed. Select the business again.');
  }
}

export function createTenantContext({connect, resolveSelection, clock = () => new Date()} = {}) {
  if (typeof connect !== 'function') {
    throw new Error('createTenantContext requires a connect() function for the business pool.');
  }
  if (typeof resolveSelection !== 'function') {
    throw new Error('createTenantContext requires an authoritative resolveSelection(session) function.');
  }
  void clock;

  async function withTenantContext(session, handler, {expectedTenantId = null} = {}) {
    if (typeof handler !== 'function') throw new Error('withTenantContext requires a handler.');
    // Authoritative session/selection revalidation happens on the auth-service
    // connection (the business role cannot read auth.* by design). It completes before
    // the business client is checked out, so no second checkout is nested inside an
    // owned lease.
    const resolved = await resolveSelection(session);
    assertResolved(resolved);
    if (expectedTenantId !== null && expectedTenantId !== resolved.tenantId) {
      throw new TenantContextError(403, 'TENANT_ACCESS_DENIED', 'Tenant access denied.');
    }
    const context = Object.freeze({
      sessionId: resolved.sessionId ?? session?.id ?? null,
      userId: resolved.userId,
      tenantId: resolved.tenantId,
      membershipId: resolved.membershipId,
      membershipEpoch: resolved.membershipEpoch,
      roleId: resolved.roleId ?? null,
    });

    const client = await connect();
    if (!client || typeof client.query !== 'function') {
      throw new TenantContextError(503, 'TENANT_CONTEXT_UNAVAILABLE', 'Tenant context is unavailable.');
    }
    let begun = false;
    let destroy = false;
    try {
      await client.query('BEGIN');
      begun = true;
      await client.query('SELECT set_config($1, $2, true)', ['app.current_user_id', context.userId]);
      await client.query('SELECT set_config($1, $2, true)', ['app.current_tenant_id', context.tenantId]);
      const bound = await client.query(
        "SELECT current_setting('app.current_user_id', true) AS user_id, current_setting('app.current_tenant_id', true) AS tenant_id",
      );
      if (bound.rows[0]?.user_id !== context.userId || bound.rows[0]?.tenant_id !== context.tenantId) {
        throw new TenantContextError(403, 'TENANT_CONTEXT_DENIED', 'Tenant context could not be bound.');
      }
      // The accepted RLS guard also requires the canonical membership, tenant-local
      // principal and identity to be active. Re-check on the business client so a
      // revocation after resolution still fails closed.
      const admitted = await client.query(
        'SELECT tenant_data.session_admitted($1::uuid, $2::uuid) AS admitted',
        [context.tenantId, context.userId],
      );
      if (admitted.rows[0]?.admitted !== true) {
        throw new TenantContextError(403, 'TENANT_ACCESS_DENIED', 'Tenant access denied.');
      }
      const result = await handler(client, context);
      try {
        await client.query('COMMIT');
      } catch {
        try {
          await client.query('ROLLBACK');
        } catch {
          // Unknown state.
        }
        destroy = true;
        throw new TenantContextError(503, 'TENANT_CONTEXT_UNCERTAIN', 'The transaction outcome is unknown.');
      }
      return result;
    } catch (error) {
      if (begun) {
        try {
          await client.query('ROLLBACK');
        } catch {
          destroy = true;
        }
      } else {
        destroy = true;
      }
      throw error;
    } finally {
      try {
        await client.release?.(destroy ? true : undefined);
      } catch {
        // A release failure cannot be repaired here; the connection is never reused.
      }
    }
  }

  return {withTenantContext};
}
