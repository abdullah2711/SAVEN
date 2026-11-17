// AUTH-006 tenant selection.
//
// A client may only ASK for a tenant/membership. The selector is resolved against the
// verified session's own active canonical memberships on the auth-service connection,
// then bound to the session row (membership id, tenant id, membership epoch). No
// client-supplied tenant/user id is ever trusted as authority, and none is copied into a
// database context here.
//
// All reads run inside an owned auth-service transaction that binds the verified user to
// transaction-local `app.current_user_id`; the accepted PIVOT-004/031/032 membership RLS
// therefore exposes only that principal's rows. Session revalidation and the selection
// write happen on the same transaction, with the session row locked.

export class TenantSelectionError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function requireUuid(value, code, message) {
  if (typeof value !== 'string' || !UUID.test(value)) throw new TenantSelectionError(400, code, message);
  return value;
}

export function createTenantSelection({store, clock = () => new Date()} = {}) {
  if (!store || typeof store.withTransaction !== 'function' ||
      typeof store.readSessionById !== 'function' || typeof store.setSessionSelection !== 'function') {
    throw new Error('createTenantSelection requires the transactional auth session store.');
  }
  const now = () => new Date(clock());

  async function bindVerifiedUser(executor, userId) {
    await executor.query("SELECT set_config('app.current_user_id', $1, true)", [userId]);
    const bound = await executor.query("SELECT current_setting('app.current_user_id', true) AS value");
    if (bound.rows[0]?.value !== userId) {
      throw new TenantSelectionError(503, 'TENANT_SELECTION_CONTEXT_FAILED', 'Tenant selection is unavailable.');
    }
  }

  function selectableMembership(row) {
    return Boolean(row) &&
      row.status === 'active' &&
      row.suspended_at === null &&
      row.revoked_at === null &&
      row.role_active === true &&
      Number(row.membership_epoch) > 0;
  }

  async function loadMembership(executor, {userId, membershipId = null, tenantId = null}) {
    const result = await executor.query(
      `SELECT tm.id, tm.tenant_id, tm.user_id, tm.role_id, tm.status, tm.membership_epoch,
              tm.suspended_at, tm.revoked_at, tm.accepted_at,
              r.is_active AS role_active,
              r.effective_from AS role_effective_from, r.effective_to AS role_effective_to
       FROM auth.tenant_membership tm
       JOIN auth.roles r ON r.role_id = tm.role_id
       WHERE tm.user_id = $1
         AND ($2::uuid IS NULL OR tm.id = $2::uuid)
         AND ($3::uuid IS NULL OR tm.tenant_id = $3::uuid)`,
      [userId, membershipId, tenantId],
    );
    const row = result.rows[0] ?? null;
    if (!selectableMembership(row)) return null;
    if (new Date(row.role_effective_from).getTime() > now().getTime()) return null;
    if (row.role_effective_to !== null && new Date(row.role_effective_to).getTime() <= now().getTime()) return null;
    return row;
  }

  function publicMembership(row) {
    return {
      tenantId: row.tenant_id,
      membershipId: row.id,
      roleId: row.role_id,
      membershipEpoch: Number(row.membership_epoch),
      acceptedAt: row.accepted_at === null ? null : new Date(row.accepted_at).toISOString(),
    };
  }

  // Lists only the verified session principal's selectable memberships.
  async function list(session) {
    if (!session || typeof session.id !== 'string') {
      throw new TenantSelectionError(401, 'SESSION_REQUIRED', 'Sign in required.');
    }
    return store.withTransaction(async executor => {
      const current = await store.readSessionById(session.id, {tx: executor, forUpdate: false});
      if (!current) throw new TenantSelectionError(401, 'SESSION_REQUIRED', 'Sign in required.');
      if (current.userId !== session.userId) throw new TenantSelectionError(403, 'TENANT_ACCESS_DENIED', 'Tenant access denied.');
      await bindVerifiedUser(executor, current.userId);
      const at = now().toISOString();
      const result = await executor.query(
        `SELECT tm.id, tm.tenant_id, tm.role_id, tm.membership_epoch, tm.accepted_at
         FROM auth.tenant_membership tm
         JOIN auth.roles r ON r.role_id = tm.role_id
         WHERE tm.user_id = $1
           AND tm.status = 'active'
           AND tm.suspended_at IS NULL
           AND tm.revoked_at IS NULL
           AND r.is_active
           AND r.effective_from <= $2::timestamptz
           AND (r.effective_to IS NULL OR r.effective_to > $2::timestamptz)
         ORDER BY tm.tenant_id`,
        [current.userId, at],
      );
      return {
        tenants: result.rows.map(publicMembership),
        selectedTenantId: current.selectedTenantId,
      };
    });
  }

  // Resolves a selector request against the verified principal's own active memberships
  // and binds it to the session. Exactly one of tenantId/membershipId is required.
  async function select(session, input = {}) {
    if (!session || typeof session.id !== 'string') {
      throw new TenantSelectionError(401, 'SESSION_REQUIRED', 'Sign in required.');
    }
    const hasTenant = input.tenantId !== undefined;
    const hasMembership = input.membershipId !== undefined;
    if (hasTenant === hasMembership) {
      throw new TenantSelectionError(400, 'TENANT_SELECTOR_INVALID', 'Provide exactly one of tenantId or membershipId.');
    }
    const tenantId = hasTenant ? requireUuid(input.tenantId, 'TENANT_SELECTOR_INVALID', 'A valid tenant is required.') : null;
    const membershipId = hasMembership ? requireUuid(input.membershipId, 'TENANT_SELECTOR_INVALID', 'A valid membership is required.') : null;
    return store.withTransaction(async executor => {
      const current = await store.readSessionById(session.id, {tx: executor, forUpdate: true});
      if (!current) throw new TenantSelectionError(401, 'SESSION_REQUIRED', 'Sign in required.');
      if (current.userId !== session.userId) throw new TenantSelectionError(403, 'TENANT_ACCESS_DENIED', 'Tenant access denied.');
      await bindVerifiedUser(executor, current.userId);
      const row = await loadMembership(executor, {userId: current.userId, tenantId, membershipId});
      if (!row) throw new TenantSelectionError(403, 'TENANT_ACCESS_DENIED', 'Tenant access denied.');
      const bound = await store.setSessionSelection(session.id, {
        membershipId: row.id,
        tenantId: row.tenant_id,
        membershipEpoch: Number(row.membership_epoch),
        roleId: row.role_id,
      }, {tx: executor});
      if (!bound) throw new TenantSelectionError(409, 'TENANT_SELECTION_STALE', 'Your access changed. Sign in again.');
      return {...publicMembership(row), selectedTenantId: row.tenant_id, selectedMembershipId: row.id};
    });
  }

  async function clear(session) {
    if (!session || typeof session.id !== 'string') {
      throw new TenantSelectionError(401, 'SESSION_REQUIRED', 'Sign in required.');
    }
    const cleared = await store.clearSessionSelection(session.id);
    if (!cleared) throw new TenantSelectionError(401, 'SESSION_REQUIRED', 'Sign in required.');
    return {cleared: true};
  }

  // Authoritative revalidation used by the DB context boundary. It locks the session row,
  // rechecks revoked/disabled/expiry/credential epoch, reloads the exact selected
  // membership under transaction-local user context and requires the same epoch.
  async function resolve(session) {
    if (!session || typeof session.id !== 'string') {
      throw new TenantSelectionError(401, 'SESSION_REQUIRED', 'Sign in required.');
    }
    return store.withTransaction(async executor => {
      const current = await store.readSessionById(session.id, {tx: executor, forUpdate: true});
      if (!current) throw new TenantSelectionError(401, 'SESSION_REQUIRED', 'Sign in required.');
      if (current.userId !== session.userId) throw new TenantSelectionError(403, 'TENANT_ACCESS_DENIED', 'Tenant access denied.');
      if (!current.selectedMembershipId || !current.selectedTenantId || current.membershipEpoch === null) {
        throw new TenantSelectionError(409, 'TENANT_SELECTION_REQUIRED', 'Select a business before continuing.');
      }
      await bindVerifiedUser(executor, current.userId);
      const row = await loadMembership(executor, {
        userId: current.userId,
        membershipId: current.selectedMembershipId,
        tenantId: current.selectedTenantId,
      });
      if (!row) throw new TenantSelectionError(403, 'TENANT_ACCESS_DENIED', 'Tenant access denied.');
      if (Number(row.membership_epoch) !== current.membershipEpoch) {
        throw new TenantSelectionError(409, 'TENANT_SELECTION_STALE', 'Your access changed. Select the business again.');
      }
      return {
        sessionId: current.id,
        userId: current.userId,
        tenantId: row.tenant_id,
        membershipId: row.id,
        membershipEpoch: Number(row.membership_epoch),
        roleId: row.role_id,
      };
    });
  }

  return {list, select, clear, resolve};
}
