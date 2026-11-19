// AUTH-006-R1 tenant selection and authoritative business admission.
//
// Selection is a request, never authority. The selector is resolved against the verified
// session principal's own active canonical memberships on the auth-service connection,
// then bound to the session row.
//
// `withAuthority` is the admission boundary used by the business transaction wrapper. It
// does NOT commit before business work: it opens one auth-service transaction, locks and
// validates the complete read authority (principal, factor, session, memberships and
// their roles), then keeps that transaction and its locks open while the caller runs the
// business transaction. A concurrent revoke/rotate/reset/factor or membership change
// therefore either wins before these locks or blocks until the business transaction ends.
// This serializes against the AUTH-004/005 lifecycle order (users -> two_factor ->
// sessions) without a nested checkout on the business pool.
//
// Requirement data is reference-driven: any active/effective membership whose auth role
// has requires_mfa makes MFA mandatory. A required session must carry mfa_verified
// assurance and a currently verified factor; unresolved authority fails closed.

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

const AUTHORITY_GATE_KEY = 'saven.auth.authority_gate';
const AUTHORITY_GATE_BINDINGS = Object.freeze([
  {table: 'tenant_membership', name: 'tenant_membership_authority_gate_insert', event: 4},
  {table: 'tenant_membership', name: 'tenant_membership_authority_gate_update', event: 16},
  {table: 'tenant_membership', name: 'tenant_membership_authority_gate_delete', event: 8},
  {table: 'roles', name: 'roles_authority_gate_insert', event: 4},
  {table: 'roles', name: 'roles_authority_gate_update', event: 16},
  {table: 'roles', name: 'roles_authority_gate_delete', event: 8},
]);
const AUTHORITY_GATE_TRIGGERS = Object.freeze(AUTHORITY_GATE_BINDINGS.map(binding => binding.name));

// Validates the reviewed gate contract, not merely object counts:
//   * exactly one zero-argument trigger function in auth, plpgsql, SECURITY INVOKER,
//     fixed search_path=pg_catalog, owned by the authority-table owner;
//   * each required trigger bound to the exact table, event, BEFORE STATEMENT timing,
//     that function OID, no WHEN predicate/arguments/constraint/deferral/column list;
//   * firing mode origin or always (replica-only/disabled is refused).
// Privileged function-body tampering by the owning DDL authority is outside what names
// and catalog flags can prove; that trust boundary is documented in the module README.
export async function assertAuthorityGateInstalled(executor) {
  let functionResult;
  let triggerResult;
  try {
    functionResult = await executor.query(
      `SELECT p.oid AS oid,
              p.pronargs,
              p.prorettype = 'trigger'::regtype AS returns_trigger,
              p.prosecdef,
              p.proconfig,
              p.prolang = (SELECT oid FROM pg_language WHERE lanname = 'plpgsql') AS is_plpgsql,
              r.rolcanlogin AS owner_login,
              r.rolsuper AS owner_super,
              r.rolbypassrls AS owner_bypass,
              pg_has_role(current_user, p.proowner, 'MEMBER') AS owner_reachable
       FROM pg_proc p
       JOIN pg_namespace n ON n.oid = p.pronamespace
       JOIN pg_roles r ON r.oid = p.proowner
       WHERE n.nspname = 'auth' AND p.proname = 'lock_authority_gate'`,
    );
    triggerResult = await executor.query(
      `SELECT c.relname AS table_name, t.tgname, t.tgtype, t.tgenabled, t.tgfoid,
              (t.tgqual IS NULL) AS unconditional,
              t.tgnargs, t.tgconstraint, t.tgdeferrable, t.tginitdeferred,
              t.tgattr::text AS columns
       FROM pg_trigger t
       JOIN pg_class c ON c.oid = t.tgrelid
       JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'auth'
         AND c.relname IN ('tenant_membership', 'roles')
         AND NOT t.tgisinternal
         AND t.tgname = ANY($1)`,
      [AUTHORITY_GATE_TRIGGERS],
    );
  } catch {
    throw new TenantSelectionError(503, 'TENANT_AUTHORITY_GATE_UNAVAILABLE', 'Tenant authority serialization is not installed.');
  }

  if (functionResult.rowCount !== 1) throw new TenantSelectionError(503, 'TENANT_AUTHORITY_GATE_UNAVAILABLE', 'Tenant authority serialization is not installed.');
  const fn = functionResult.rows[0];
  if (Number(fn.pronargs) !== 0 ||
      fn.returns_trigger !== true ||
      fn.prosecdef !== false ||
      fn.is_plpgsql !== true ||
      fn.owner_login !== false ||
      fn.owner_super !== false ||
      fn.owner_bypass !== false ||
      fn.owner_reachable !== false ||
      !Array.isArray(fn.proconfig) ||
      fn.proconfig.length !== 1 ||
      fn.proconfig[0] !== 'search_path=pg_catalog') {
    throw new TenantSelectionError(503, 'TENANT_AUTHORITY_GATE_UNAVAILABLE', 'Tenant authority serialization is not installed.');
  }

  if (triggerResult.rowCount !== AUTHORITY_GATE_BINDINGS.length) throw new TenantSelectionError(503, 'TENANT_AUTHORITY_GATE_UNAVAILABLE', 'Tenant authority serialization is not installed.');
  for (const expected of AUTHORITY_GATE_BINDINGS) {
    const matches = triggerResult.rows.filter(row => row.table_name === expected.table && row.tgname === expected.name);
    if (matches.length !== 1) throw new TenantSelectionError(503, 'TENANT_AUTHORITY_GATE_UNAVAILABLE', 'Tenant authority serialization is not installed.');
    const trigger = matches[0];
    // BEFORE = 2, statement-level = no row bit, exactly one event bit.
    if (Number(trigger.tgtype) !== (2 | expected.event)) throw new TenantSelectionError(503, 'TENANT_AUTHORITY_GATE_UNAVAILABLE', 'Tenant authority serialization is not installed.');
    if (trigger.tgenabled !== 'O' && trigger.tgenabled !== 'A') throw new TenantSelectionError(503, 'TENANT_AUTHORITY_GATE_UNAVAILABLE', 'Tenant authority serialization is not installed.');
    if (Number(trigger.tgfoid) !== Number(fn.oid)) throw new TenantSelectionError(503, 'TENANT_AUTHORITY_GATE_UNAVAILABLE', 'Tenant authority serialization is not installed.');
    if (trigger.unconditional !== true ||
        Number(trigger.tgnargs) !== 0 ||
        Number(trigger.tgconstraint) !== 0 ||
        trigger.tgdeferrable !== false ||
        trigger.tginitdeferred !== false ||
        trigger.columns !== '') {
      throw new TenantSelectionError(503, 'TENANT_AUTHORITY_GATE_UNAVAILABLE', 'Tenant authority serialization is not installed.');
    }
  }
}

// SHARED admission gate, acquired before any authority read or row lock and held until
// the owning auth transaction ends. Membership/role writers take the same key
// exclusively in BEFORE STATEMENT triggers, so authority cannot change while admitted
// business work is in flight.
export async function acquireAuthorityGate(executor) {
  await assertAuthorityGateInstalled(executor);
  try {
    await executor.query(
      "SELECT pg_advisory_xact_lock_shared(hashtextextended($1, 0))",
      [AUTHORITY_GATE_KEY],
    );
  } catch {
    throw new TenantSelectionError(503, 'TENANT_AUTHORITY_UNAVAILABLE', 'Tenant authority could not be verified.');
  }
}

export function createTenantSelection({store, clock = () => new Date(), audit = async () => {}} = {}) {
  if (!store || typeof store.withTransaction !== 'function' ||
      typeof store.readSessionById !== 'function' || typeof store.setSessionSelection !== 'function') {
    throw new Error('createTenantSelection requires the transactional auth session store.');
  }
  const now = () => new Date(clock());

  function authorityUnavailable() {
    return new TenantSelectionError(503, 'TENANT_AUTHORITY_UNAVAILABLE', 'Tenant authority could not be verified.');
  }

  function gateUnavailable() {
    return new TenantSelectionError(503, 'TENANT_AUTHORITY_GATE_UNAVAILABLE', 'Tenant authority serialization is not installed.');
  }

  function mfaRequired() {
    return new TenantSelectionError(403, 'MFA_REQUIRED', 'Multi-factor verification is required before business access.');
  }

  function sessionRequired() {
    return new TenantSelectionError(401, 'SESSION_REQUIRED', 'Sign in required.');
  }

  async function bindVerifiedUser(executor, userId) {
    await executor.query("SELECT set_config('app.current_user_id', $1, true)", [userId]);
    const bound = await executor.query("SELECT current_setting('app.current_user_id', true) AS value");
    if (bound.rows[0]?.value !== userId) throw authorityUnavailable();
  }

  function roleEffective(row, at) {
    if (row.role_is_active !== true) return false;
    if (new Date(row.role_effective_from).getTime() > at.getTime()) return false;
    if (row.role_effective_to !== null && new Date(row.role_effective_to).getTime() <= at.getTime()) return false;
    return true;
  }

  function membershipUsable(row, at) {
    return row.status === 'active' &&
      row.suspended_at === null &&
      row.revoked_at === null &&
      Number(row.membership_epoch) > 0 &&
      roleEffective(row, at);
  }

  function evaluate(memberships, at) {
    const active = memberships.filter(row => membershipUsable(row, at));
    return {active, required: active.some(row => row.requires_mfa === true)};
  }

  function assertAssurance(current, factor, required) {
    if (!required) return;
    if (!factor || factor.verified_at === null || factor.verified_at === undefined) throw mfaRequired();
    if (current.assuranceLevel !== 'mfa_verified' || !current.mfaVerifiedAt) throw mfaRequired();
  }

  function assertSessionUnexpired(current, at) {
    if (new Date(current.absoluteExpiresAt).getTime() <= at.getTime() ||
        new Date(current.idleExpiresAt).getTime() <= at.getTime()) {
      throw sessionRequired();
    }
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

  // Membership rows are read without a row lock: the accepted membership RLS exposes
  // them through SELECT policies only, so a locking SELECT would be filtered/denied for
  // the runtime. They are re-read at the admission point below, so a committed
  // membership/role/epoch change is observed and fails closed. Principal, factor and
  // session rows are lockable and are locked in lifecycle order.
  async function readMemberships(executor, userId) {
    try {
      return await executor.query(
        `SELECT tm.id, tm.tenant_id, tm.user_id, tm.role_id, tm.status, tm.membership_epoch,
                tm.suspended_at, tm.revoked_at, tm.accepted_at,
                r.is_active AS role_is_active, r.requires_mfa,
                r.effective_from AS role_effective_from, r.effective_to AS role_effective_to
         FROM auth.tenant_membership tm
         JOIN auth.roles r ON r.role_id = tm.role_id
         WHERE tm.user_id = $1`,
        [userId],
      );
    } catch {
      throw authorityUnavailable();
    }
  }

  // Locks and validates the complete authority set used for admission. Lock order is
  // users -> two_factor -> sessions, matching AUTH-004's lifecycle order and serializing
  // against AUTH-005 credential resets and selection writes. Membership/role/epoch state
  // is re-read at admission because it cannot be row-locked by the runtime under the
  // accepted RLS.
  async function loadAuthority(executor, session) {
    // Gate first: no authority snapshot or row lock may be taken before the shared
    // admission gate is held. Membership/role writers serialize exclusively behind it.
    await acquireAuthorityGate(executor);
    const initial = await store.readSessionById(session.id, {tx: executor, forUpdate: false});
    if (!initial) throw sessionRequired();
    if (initial.userId !== session.userId) throw new TenantSelectionError(403, 'TENANT_ACCESS_DENIED', 'Tenant access denied.');

    const user = await executor.query(
      // PIVOT-014 Amendment A: the admission principal lock is narrowed to
      // NO KEY UPDATE. It still excludes every authority/lifecycle writer (status,
      // credential version, membership, role, session, factor) and still serializes this
      // admission, but it no longer conflicts with the KEY SHARE lock that a business
      // write must take for its auth.users foreign key (the accepted 042 void receipt).
      // The factor and session locks below remain FOR UPDATE and the gate-first order
      // (principal -> factor -> session) is unchanged.
      'SELECT id, status, credential_version FROM auth.users WHERE id = $1 FOR NO KEY UPDATE',
      [initial.userId],
    );
    if (user.rowCount !== 1 || user.rows[0].status !== 'active') throw sessionRequired();

    const factor = await executor.query(
      `SELECT id, verified_at, locked_until FROM auth.two_factor
       WHERE user_id = $1 AND factor_type = 'totp' FOR UPDATE`,
      [initial.userId],
    );

    // Re-read under lock: a revocation/rotation/reset committed while we acquired the
    // principal lock is visible here and fails closed.
    const current = await store.readSessionById(session.id, {tx: executor, forUpdate: true});
    if (!current) throw sessionRequired();
    if (current.userId !== initial.userId) throw new TenantSelectionError(403, 'TENANT_ACCESS_DENIED', 'Tenant access denied.');

    await bindVerifiedUser(executor, current.userId);
    const memberships = await readMemberships(executor, current.userId);

    const at = now();
    assertSessionUnexpired(current, at);
    const verdict = evaluate(memberships.rows, at);
    assertAssurance(current, factor.rows[0] ?? null, verdict.required);
    return {current, factor: factor.rows[0] ?? null, memberships: memberships.rows, at};
  }

  // Lists only the verified principal's selectable memberships.
  async function list(session) {
    if (!session || typeof session.id !== 'string') throw sessionRequired();
    return store.withTransaction(async executor => {
      const authority = await loadAuthority(executor, session);
      const verdict = evaluate(authority.memberships, authority.at);
      const selected = verdict.active.find(row => row.id === authority.current.selectedMembershipId) ?? null;
      return {
        tenants: verdict.active.map(publicMembership),
        selectedTenantId: selected ? selected.tenant_id : null,
        assuranceLevel: authority.current.assuranceLevel,
        mfaRequired: verdict.required,
      };
    });
  }

  // Resolves exactly one selector against the principal's own active memberships and
  // binds it. The same authoritative assurance check runs here, so a missing route-level
  // guard is not the sole defence. The success event is written inside this transaction
  // (AUTH-009), so the bound membership and its audit row commit together.
  async function select(session, input = {}, context = {}) {
    if (!session || typeof session.id !== 'string') throw sessionRequired();
    const hasTenant = input.tenantId !== undefined;
    const hasMembership = input.membershipId !== undefined;
    if (hasTenant === hasMembership) {
      throw new TenantSelectionError(400, 'TENANT_SELECTOR_INVALID', 'Provide exactly one of tenantId or membershipId.');
    }
    const tenantId = hasTenant ? requireUuid(input.tenantId, 'TENANT_SELECTOR_INVALID', 'A valid tenant is required.') : null;
    const membershipId = hasMembership ? requireUuid(input.membershipId, 'TENANT_SELECTOR_INVALID', 'A valid membership is required.') : null;
    return store.withTransaction(async executor => {
      const authority = await loadAuthority(executor, session);
      const verdict = evaluate(authority.memberships, authority.at);
      const row = verdict.active.find(candidate =>
        (tenantId === null || candidate.tenant_id === tenantId) &&
        (membershipId === null || candidate.id === membershipId));
      if (!row) throw new TenantSelectionError(403, 'TENANT_ACCESS_DENIED', 'Tenant access denied.');
      const bound = await store.setSessionSelection(session.id, {
        membershipId: row.id,
        tenantId: row.tenant_id,
        membershipEpoch: Number(row.membership_epoch),
        roleId: row.role_id,
      }, {tx: executor});
      if (!bound) throw new TenantSelectionError(409, 'TENANT_SELECTION_STALE', 'Your access changed. Sign in again.');
      await audit({
        eventType: 'tenant_selected',
        outcome: 'success',
        actorKind: 'authenticated',
        realm: context.realm ?? 'customer',
        user: {id: session.userId},
        sessionId: session.id,
        tenantId: row.tenant_id,
        request: context.request ?? null,
        detail: {membership_id: row.id, role_id: row.role_id},
      }, {tx: executor});
      return {...publicMembership(row), selectedTenantId: row.tenant_id, selectedMembershipId: row.id};
    });
  }

  async function clear(session, context = {}) {
    if (!session || typeof session.id !== 'string') throw sessionRequired();
    return store.withTransaction(async executor => {
      await loadAuthority(executor, session);
      const cleared = await store.clearSessionSelection(session.id, {tx: executor});
      if (!cleared) throw sessionRequired();
      await audit({
        eventType: 'tenant_cleared',
        outcome: 'success',
        actorKind: 'authenticated',
        realm: context.realm ?? 'customer',
        user: {id: session.userId},
        sessionId: session.id,
        request: context.request ?? null,
        detail: {},
      }, {tx: executor});
      return {cleared: true};
    });
  }

  // Authoritative admission. The auth transaction and its locks stay open until `action`
  // (which runs the business transaction) completes. `assertAdmission` rechecks the time
  // bound and the locked assurance/selection state immediately before business work.
  async function withAuthority(session, action) {
    if (!session || typeof session.id !== 'string') throw sessionRequired();
    if (typeof action !== 'function') throw new Error('withAuthority requires an action.');
    return store.withTransaction(async executor => {
      const authority = await loadAuthority(executor, session);
      const current = authority.current;
      if (!current.selectedMembershipId || !current.selectedTenantId || current.membershipEpoch === null) {
        throw new TenantSelectionError(409, 'TENANT_SELECTION_REQUIRED', 'Select a business before continuing.');
      }
      const selected = authority.memberships.find(row => row.id === current.selectedMembershipId) ?? null;
      if (!selected ||
          selected.tenant_id !== current.selectedTenantId ||
          Number(selected.membership_epoch) !== current.membershipEpoch ||
          current.selectedRoleId !== selected.role_id ||
          !membershipUsable(selected, authority.at)) {
        throw new TenantSelectionError(409, 'TENANT_SELECTION_STALE', 'Your access changed. Select the business again.');
      }
      assertAssurance(current, authority.factor, evaluate(authority.memberships, authority.at).required);

      const resolved = Object.freeze({
        sessionId: current.id,
        userId: current.userId,
        tenantId: selected.tenant_id,
        membershipId: selected.id,
        membershipEpoch: Number(selected.membership_epoch),
        roleId: selected.role_id,
      });
      const resolvedRoleId = selected.role_id;

      const assertAdmission = async () => {
        const at = now();
        assertSessionUnexpired(current, at);
        // Membership/role/epoch state is re-read here because those rows cannot be
        // row-locked by the runtime under the accepted RLS. A committed change during a
        // paused resolution or during handler execution is therefore observed and fails
        // closed before the business transaction may commit.
        const fresh = (await readMemberships(executor, current.userId)).rows;
        const selectedNow = fresh.find(row => row.id === current.selectedMembershipId) ?? null;
        if (!selectedNow ||
            selectedNow.tenant_id !== current.selectedTenantId ||
            Number(selectedNow.membership_epoch) !== current.membershipEpoch ||
            selectedNow.role_id !== resolvedRoleId ||
            !membershipUsable(selectedNow, at)) {
          throw new TenantSelectionError(409, 'TENANT_SELECTION_STALE', 'Your access changed. Select the business again.');
        }
        assertAssurance(current, authority.factor, evaluate(fresh, at).required);
      };

      // Admission is checked before business work and again immediately before the
      // business transaction commits, so an authority change committed during handler
      // execution rolls the business effects back instead of retaining an earlier role.
      await assertAdmission();
      return action({resolved, assertAdmission});
    });
  }

  return {list, select, clear, withAuthority};
}
