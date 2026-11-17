// AUTH-006-R1 tenant-context boundary.
//
// Every business transaction runs on ONE checked-out business client with
// transaction-local context:
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
// Admission is not released before business work. `resolveAuthority` is an injected
// protocol (AUTH-006 tenant selection) that opens ONE auth-service transaction, locks and
// validates the principal, factor, session, memberships and roles, and keeps that
// transaction open while this wrapper runs the business transaction. A concurrent
// revoke/rotate/reset/factor/membership change either wins before those locks or blocks
// until the business transaction ends. The auth and business clients come from different
// pools; no second checkout is taken from an already-owned business pool.
//
// The handler receives only the business client and frozen verified context; this module
// never calls pool.query.
//
// Company/resource/approval authorization is the shared business authorization layer on
// top of this tenant context. Forced RLS tenant isolation complements that layer; it does
// not replace configurable per-tenant business rules, which stay in policy data.

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

export function createTenantContext({connect, resolveAuthority} = {}) {
  if (typeof connect !== 'function') {
    throw new Error('createTenantContext requires a connect() function for the business pool.');
  }
  if (typeof resolveAuthority !== 'function') {
    throw new Error('createTenantContext requires the authoritative resolveAuthority(session, action) protocol.');
  }

  async function withTenantContext(session, handler, {expectedTenantId = null} = {}) {
    if (typeof handler !== 'function') throw new Error('withTenantContext requires a handler.');
    return resolveAuthority(session, async ({resolved, assertAdmission}) => {
      assertResolved(resolved);
      if (expectedTenantId !== null && expectedTenantId !== resolved.tenantId) {
        throw new TenantContextError(403, 'TENANT_ACCESS_DENIED', 'Tenant access denied.');
      }
      if (typeof assertAdmission !== 'function') {
        throw new TenantContextError(503, 'TENANT_CONTEXT_UNAVAILABLE', 'Tenant admission is unavailable.');
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
        const admitted = await client.query(
          'SELECT tenant_data.session_admitted($1::uuid, $2::uuid) AS admitted',
          [context.tenantId, context.userId],
        );
        if (admitted.rows[0]?.admitted !== true) {
          throw new TenantContextError(403, 'TENANT_ACCESS_DENIED', 'Tenant access denied.');
        }
        // Final linearization point: the auth transaction is still open with its locks
        // held, so session expiry and locked assurance are rechecked, and membership/
        // role/epoch state is re-read here.
        await assertAdmission();
        const result = await handler(client, context);
        // Revalidate immediately before COMMIT: a membership/role/assurance change that
        // committed during handler execution discards the business effects.
        await assertAdmission();
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
    });
  }

  return {withTenantContext};
}
