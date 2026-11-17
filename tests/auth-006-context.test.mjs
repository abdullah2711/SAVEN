import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import pg from 'pg';
import {withPivotDatabase} from './helpers/pg-pivot-fixture.mjs';
import {createSessionStore} from '../src/auth/session-store.mjs';
import {createAuthRoutes, cookieName} from '../src/auth/routes.mjs';
import {createAuditWriter} from '../src/auth/server.mjs';
import {createTenantSelection, TenantSelectionError} from '../src/auth/tenant-selection.mjs';
import {createTenantContext, TenantContextError} from '../src/db/tenant-context.mjs';

const {Pool} = pg;
const origins = {customer: 'https://app.saven.test', operator: 'https://ops.saven.test'};
const customerCookie = cookieName('customer', true);

const T1 = '11111111-1111-4111-8111-111111111111';
const T2 = '22222222-2222-4222-8222-222222222222';
const T3 = '33333333-3333-4333-8333-333333333333';
const U1 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const U2 = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const U3 = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

const schemaFiles = [
  'db/postgres/05-auth-schema.sql',
  'db/postgres/migrations/006-auth-schema-corrections.sql',
  'db/postgres/10-operator-schema.sql',
  'db/postgres/20-tenant-schema.sql',
  'db/postgres/migrations/021-tenant-schema-corrections.sql',
  'db/postgres/30-rls-policies.sql',
];
const adminSqlFiles = [
  'db/postgres/migrations/031-rls-corrections.sql',
  'db/postgres/migrations/032-rls-hardening.sql',
];

function connectionConfig(database, overrides = {}) {
  return {
    host: process.env.PGHOST ?? '127.0.0.1',
    port: Number(process.env.PGPORT ?? 5432),
    user: process.env.PGUSER ?? 'postgres',
    password: process.env.PGPASSWORD ?? '',
    database,
    max: 4,
    application_name: 'saven-auth-006-test',
    ...overrides,
  };
}

function testClock(start = new Date()) {
  let now = new Date(start);
  return {
    clock: () => now,
    advance(ms) {
      now = new Date(now.getTime() + ms);
    },
    now: () => now,
  };
}

function makeGate() {
  let enter;
  let release;
  const entered = new Promise(resolve => {
    enter = resolve;
  });
  const gate = new Promise(resolve => {
    release = resolve;
  });
  return {entered, enter, gate, release};
}

function within(promise, ms, label) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(`${label} timed out`)), ms)),
  ]);
}

async function makeLoginPool(db, roleName, label, {max = 4} = {}) {
  const suffix = randomBytes(4).toString('hex');
  const login = `saven_auth006_${label}_${suffix}`;
  const password = randomBytes(24).toString('base64url');
  await db.adminQuery(
    `CREATE ROLE "${login}" LOGIN PASSWORD '${password}' NOSUPERUSER NOCREATEDB NOCREATEROLE INHERIT NOBYPASSRLS NOREPLICATION`,
  );
  await db.adminQuery(`GRANT "${roleName}" TO "${login}"`);
  const pool = new Pool(connectionConfig(db.database, {user: login, password, max}));
  return {
    pool,
    async close() {
      await pool.end().catch(() => {});
      await db.adminQuery(`DROP ROLE IF EXISTS "${login}"`).catch(() => {});
    },
  };
}

async function seed(db) {
  await db.adminQuery(`
    INSERT INTO tenant_data.business(tenant_id, id, state) VALUES
      ('${T1}', 'alpha', 'ACTIVE'), ('${T2}', 'beta', 'ACTIVE'), ('${T3}', 'gamma', 'ACTIVE');
    INSERT INTO tenant_data.company_profiles(tenant_id, id, name, currency, branch, created_at) VALUES
      ('${T1}', 'alpha', 'Alpha', 'PKR', 'main', 0),
      ('${T2}', 'beta', 'Beta', 'PKR', 'main', 0);
    INSERT INTO auth.users(id, legacy_id, email, status) VALUES
      ('${U1}', 'user-1', 'u1@example.test', 'active'),
      ('${U2}', 'user-2', 'u2@example.test', 'active');
    INSERT INTO auth.tenant_membership(tenant_id, user_id, role_id, status, invited_at, accepted_at) VALUES
      ('${T1}', '${U1}', 'member', 'active', now(), now()),
      ('${T2}', '${U1}', 'member', 'active', now(), now()),
      ('${T2}', '${U2}', 'member', 'active', now(), now());
    INSERT INTO auth.tenant_membership(tenant_id, user_id, role_id, status, invited_at, accepted_at, revoked_at)
      VALUES ('${T3}', '${U1}', 'member', 'revoked', now(), now(), now());
    INSERT INTO tenant_data.members(tenant_id, user_id, user_uuid, active) VALUES
      ('${T1}', 'user-1', '${U1}', true),
      ('${T2}', 'user-1', '${U1}', true),
      ('${T2}', 'user-2', '${U2}', true),
      ('${T3}', 'user-1', '${U1}', true);
    INSERT INTO tenant_data.accounts(tenant_id, code, title) VALUES
      ('${T1}', '1000', 'Cash A'), ('${T1}', '4000', 'Revenue A'), ('${T2}', '1000', 'Cash B');
  `);
}

function request(url, {method = 'GET', cookie, headers = {}, body} = {}) {
  const merged = {...headers};
  if (cookie) merged.cookie = cookie;
  if (body !== undefined) {
    merged['content-type'] = merged['content-type'] ?? 'application/json';
    return new Request(url, {method, headers: merged, body: JSON.stringify(body)});
  }
  return new Request(url, {method, headers: merged});
}

function listTenants(handler, token) {
  return handler(request(`${origins.customer}/v1/auth/tenants`, {
    headers: {cookie: `${customerCookie}=${token}`},
  }));
}

function selectTenant(handler, token, csrf, body, {origin = origins.customer, headers = {}} = {}) {
  return handler(request(`${origin}/v1/auth/tenant/select`, {
    method: 'POST',
    headers: {origin, cookie: `${customerCookie}=${token}`, ...(csrf ? {'x-csrf-token': csrf} : {}), ...headers},
    body,
  }));
}

function clearTenant(handler, token, csrf) {
  return handler(request(`${origins.customer}/v1/auth/tenant/clear`, {
    method: 'POST',
    headers: {origin: origins.customer, cookie: `${customerCookie}=${token}`, 'x-csrf-token': csrf},
    body: {},
  }));
}

async function makeSession(store, userId, {assuranceLevel = 'single_factor', mfaVerifiedAt = null} = {}) {
  const created = await store.createSession({
    userId,
    realm: 'customer',
    credentialVersion: 1,
    assuranceLevel,
    mfaVerifiedAt,
  });
  const session = await store.readSession(created.token);
  return {token: created.token, csrf: created.csrfToken, session};
}

async function seedAdmin(db, {verified = false} = {}) {
  await db.adminQuery(`
    INSERT INTO auth.users(id, legacy_id, email, status) VALUES
      ('${U3}', 'user-3', 'u3-admin@example.test', 'active');
    INSERT INTO auth.tenant_membership(tenant_id, user_id, role_id, status, invited_at, accepted_at) VALUES
      ('${T1}', '${U3}', 'tenant_admin', 'active', now(), now());
    INSERT INTO tenant_data.members(tenant_id, user_id, user_uuid, active) VALUES
      ('${T1}', 'user-3', '${U3}', true);
  `);
  await setFactor(db, U3, {verified});
}

async function setFactor(db, userId, {verified = true} = {}) {
  await db.adminQuery(
    `INSERT INTO auth.two_factor(user_id, factor_type, secret_ciphertext, secret_algorithm, secret_key_version, verified_at)
     VALUES ($1::uuid, 'totp', $2, 'aes_256_gcm', 1, $3)
     ON CONFLICT (user_id, factor_type) DO UPDATE SET verified_at = EXCLUDED.verified_at, updated_at = now()`,
    [userId, 'a'.repeat(32), verified ? new Date() : null],
  );
}

function makeSelectionAndRoutes({store, authPool, clock, tenantSelection = null}) {
  const selection = tenantSelection ?? createTenantSelection({store, clock: clock.clock});
  const handler = createAuthRoutes({
    store,
    findUserByEmail: async () => null,
    audit: createAuditWriter(authPool),
    origins,
    secureCookies: true,
    clock: clock.clock,
    mfaConfig: {},
    tenantSelection: selection,
  });
  return {selection, handler};
}

test('AUTH-006 tenant list exposes only the verified principal active memberships', async () => {
  await withPivotDatabase({sqlFiles: schemaFiles, adminSqlFiles}, async db => {
    await seed(db);
    const auth = await makeLoginPool(db, db.roles.authService, 'auth');
    try {
      const clock = testClock();
      const store = createSessionStore({connect: () => auth.pool.connect(), clock: clock.clock});
      const {handler} = makeSelectionAndRoutes({store, authPool: auth.pool, clock});
      const session = await makeSession(store, U1);

      const response = await listTenants(handler, session.token);
      assert.equal(response.status, 200);
      const body = await response.json();
      assert.deepEqual(body.tenants.map(tenant => tenant.tenantId), [T1, T2], 'only U1 active memberships, not the revoked tenant');
      assert.equal(body.tenants.every(tenant => tenant.membershipEpoch === 1), true);
      assert.equal(body.selectedTenantId, null);

      const customerAuthPrivilege = await db.adminQuery(
        "SELECT has_table_privilege($1, 'auth.tenant_membership', 'SELECT') AS allowed",
        [db.roles.customerApp],
      );
      assert.equal(customerAuthPrivilege.rows[0].allowed, false, 'the business role has no auth.* shortcut');

      const operator = await handler(request(`${origins.operator}/v1/auth/tenants`, {
        headers: {cookie: `${customerCookie}=${session.token}`},
      }));
      assert.equal(operator.status, 403);
      assert.equal((await operator.json()).error.code, 'OPERATOR_ASSERTION_REQUIRED', 'no operator/admin shortcut into selection');
    } finally {
      await auth.close();
    }
  });
});

test('AUTH-006 selection binds a server-resolved membership and refuses forged selectors', async () => {
  await withPivotDatabase({sqlFiles: schemaFiles, adminSqlFiles}, async db => {
    await seed(db);
    const auth = await makeLoginPool(db, db.roles.authService, 'auth');
    try {
      const clock = testClock();
      const store = createSessionStore({connect: () => auth.pool.connect(), clock: clock.clock});
      const {handler} = makeSelectionAndRoutes({store, authPool: auth.pool, clock});
      const session = await makeSession(store, U1);
      const u2Membership = await db.adminQuery(
        "SELECT id::text AS id FROM auth.tenant_membership WHERE tenant_id = $1::uuid AND user_id = $2::uuid",
        [T2, U2],
      ).then(result => result.rows[0].id);

      const selected = await selectTenant(handler, session.token, session.csrf, {tenantId: T1});
      assert.equal(selected.status, 200);
      const selectedBody = await selected.json();
      assert.equal(selectedBody.selected.tenantId, T1);
      assert.equal(selectedBody.selected.membershipEpoch, 1);
      const current = await store.readSession(session.token);
      assert.equal(current.selectedTenantId, T1);
      assert.equal(current.membershipEpoch, 1);
      assert.equal(current.selectedRoleId, 'member');

      for (const [label, body] of [
        ['revoked tenant', {tenantId: T3}],
        ['another principal membership', {membershipId: u2Membership}],
        ['both selectors', {tenantId: T1, membershipId: u2Membership}],
        ['no selector', {}],
        ['non-uuid selector', {tenantId: 'not-a-uuid'}],
        ['unknown field', {tenantId: T1, userId: U1}],
      ]) {
        const response = await selectTenant(handler, session.token, session.csrf, body);
        assert.ok([400, 403].includes(response.status), `${label} must be refused`);
      }
      assert.equal((await selectTenant(handler, session.token, session.csrf, {tenantId: T1}, {origin: 'https://evil.example'})).status, 421);
      assert.equal((await selectTenant(handler, session.token, null, {tenantId: T1})).status, 403, 'CSRF is required');

      const selectedAgain = await store.readSession(session.token);
      assert.equal(selectedAgain.selectedTenantId, T1, 'refused selectors do not change the selection');

      // Query and header values are ignored; only the JSON body selector is considered,
      // and it is still resolved against the principal's own memberships.
      const queryHeader = await handler(request(`${origins.customer}/v1/auth/tenant/select?tenantId=${T3}`, {
        method: 'POST',
        headers: {
          origin: origins.customer,
          cookie: `${customerCookie}=${session.token}`,
          'x-csrf-token': session.csrf,
          'x-tenant-id': T3,
          'x-selected-tenant': T3,
        },
        body: {tenantId: T2},
      }));
      assert.equal(queryHeader.status, 200);
      assert.equal((await store.readSession(session.token)).selectedTenantId, T2, 'ignored header/query cannot choose a tenant');
      assert.equal((await selectTenant(handler, session.token, session.csrf, {tenantId: T1})).status, 200);

      const cleared = await clearTenant(handler, session.token, session.csrf);
      assert.equal(cleared.status, 200);
      assert.equal((await store.readSession(session.token)).selectedTenantId, null);
    } finally {
      await auth.close();
    }
  });
});

test('AUTH-006 a nonmember principal cannot select or learn another tenant', async () => {
  await withPivotDatabase({sqlFiles: schemaFiles, adminSqlFiles}, async db => {
    await seed(db);
    const auth = await makeLoginPool(db, db.roles.authService, 'auth');
    try {
      const clock = testClock();
      const store = createSessionStore({connect: () => auth.pool.connect(), clock: clock.clock});
      const {handler} = await makeSelectionAndRoutes({store, authPool: auth.pool, clock});
      const u2 = await makeSession(store, U2);

      const list = await listTenants(handler, u2.token);
      const body = await list.json();
      assert.deepEqual(body.tenants.map(tenant => tenant.tenantId), [T2]);

      assert.equal((await selectTenant(handler, u2.token, u2.csrf, {tenantId: T1})).status, 403);
      assert.equal((await selectTenant(handler, u2.token, u2.csrf, {tenantId: T3})).status, 403);
      assert.equal((await store.readSession(u2.token)).selectedTenantId, null);
    } finally {
      await auth.close();
    }
  });
});

test('AUTH-006 selection revalidates a read-valid-then-stale session inside its transaction', async () => {
  await withPivotDatabase({sqlFiles: schemaFiles, adminSqlFiles}, async db => {
    await seed(db);
    const auth = await makeLoginPool(db, db.roles.authService, 'auth');
    try {
      const clock = testClock();
      const baseStore = createSessionStore({connect: () => auth.pool.connect(), clock: clock.clock});
      const hook = {current: null};
      const store = {...baseStore};
      store.readSession = async (token, options) => {
        const session = await baseStore.readSession(token, options);
        if (session && hook.current) {
          const mutate = hook.current;
          hook.current = null;
          await mutate(session);
        }
        return session;
      };
      const {handler} = await makeSelectionAndRoutes({store, authPool: auth.pool, clock});
      const session = await makeSession(baseStore, U1);

      hook.current = candidate => db.adminQuery('UPDATE auth.sessions SET revoked_at = now() WHERE id = $1::uuid', [candidate.id]);
      const refused = await selectTenant(handler, session.token, session.csrf, {tenantId: T1});
      assert.equal(refused.status, 401, 'the revoked session cannot acquire a selection');
      assert.equal((await baseStore.readSession(session.token)), null);
    } finally {
      await auth.close();
    }
  });
});

test('AUTH-006 context isolates business reads, writes and the admission guard on one client', async () => {
  await withPivotDatabase({sqlFiles: schemaFiles, adminSqlFiles}, async db => {
    await seed(db);
    const auth = await makeLoginPool(db, db.roles.authService, 'auth');
    const business = await makeLoginPool(db, db.roles.customerApp, 'business');
    try {
      const clock = testClock();
      const store = createSessionStore({connect: () => auth.pool.connect(), clock: clock.clock});
      const {selection, handler} = await makeSelectionAndRoutes({store, authPool: auth.pool, clock});
      const session = await makeSession(store, U1);
      assert.equal((await selectTenant(handler, session.token, session.csrf, {tenantId: T1})).status, 200);
      const current = await store.readSession(session.token);

      const context = createTenantContext({
        connect: () => business.pool.connect(),
        resolveAuthority: selection.withAuthority,
      });
      const seen = await context.withTenantContext(current, async (client, bound) => {
        assert.equal(bound.tenantId, T1);
        assert.equal(bound.userId, U1);
        const accounts = await client.query('SELECT tenant_id::text AS tenant_id, code FROM tenant_data.accounts ORDER BY code');
        const foreign = await client.query('SELECT count(*)::int AS n FROM tenant_data.company_profiles WHERE tenant_id = $1::uuid', [T2]);
        const admitted = await client.query('SELECT tenant_data.session_admitted($1::uuid, $2::uuid) AS ok', [T1, U1]);
        await client.query("INSERT INTO tenant_data.accounts(tenant_id, code, title) VALUES ($1::uuid, '5000', 'Expense A')", [T1]);
        return {
          accounts: accounts.rows,
          foreignCompanies: foreign.rows[0].n,
          admitted: admitted.rows[0].ok,
        };
      });
      assert.deepEqual(seen.accounts.map(row => row.tenant_id), [T1, T1]);
      assert.equal(seen.foreignCompanies, 0, 'another tenant company is invisible');
      assert.equal(seen.admitted, true);

      await assert.rejects(
        () => context.withTenantContext(current, async client => {
          await client.query("INSERT INTO tenant_data.accounts(tenant_id, code, title) VALUES ($1::uuid, '5000', 'Foreign')", [T2]);
        }),
        /row-level security|new row violates/i,
        'a write into another tenant is refused by RLS',
      );
      await assert.rejects(
        () => context.withTenantContext(current, async () => {}, {expectedTenantId: T2}),
        error => error instanceof TenantContextError && error.code === 'TENANT_ACCESS_DENIED',
      );

      // No session-level context may survive the transaction or a pooled reuse.
      const leaked = await business.pool.query('SELECT count(*)::int AS n FROM tenant_data.accounts');
      assert.equal(leaked.rows[0].n, 0, 'commit cannot leak tenant context to the next borrower');
    } finally {
      await auth.close();
      await business.close();
    }
  });
});

test('AUTH-006 rollback, no-selection and stale membership all fail closed', async () => {
  await withPivotDatabase({sqlFiles: schemaFiles, adminSqlFiles}, async db => {
    await seed(db);
    const auth = await makeLoginPool(db, db.roles.authService, 'auth');
    const business = await makeLoginPool(db, db.roles.customerApp, 'business');
    try {
      const clock = testClock();
      const store = createSessionStore({connect: () => auth.pool.connect(), clock: clock.clock});
      const {selection, handler} = await makeSelectionAndRoutes({store, authPool: auth.pool, clock});
      const session = await makeSession(store, U1);
      const context = createTenantContext({connect: () => business.pool.connect(), resolveAuthority: selection.withAuthority});

      const unselected = await store.readSession(session.token);
      await assert.rejects(
        () => context.withTenantContext(unselected, async () => {}),
        error => error instanceof TenantSelectionError && error.code === 'TENANT_SELECTION_REQUIRED',
      );

      assert.equal((await selectTenant(handler, session.token, session.csrf, {tenantId: T1})).status, 200);
      const selected = await store.readSession(session.token);

      await assert.rejects(
        () => context.withTenantContext(selected, async client => {
          await client.query("INSERT INTO tenant_data.accounts(tenant_id, code, title) VALUES ($1::uuid, '6000', 'Rolled back')", [T1]);
          throw new Error('handler failed');
        }),
        /handler failed/,
      );
      const rolledBack = await db.adminQuery(
        "SELECT count(*)::int AS n FROM tenant_data.accounts WHERE code = '6000'",
      );
      assert.equal(rolledBack.rows[0].n, 0, 'the failed transaction is rolled back');
      const afterRollbackLeak = await business.pool.query('SELECT count(*)::int AS n FROM tenant_data.accounts');
      assert.equal(afterRollbackLeak.rows[0].n, 0, 'rollback cannot leak tenant context either');

      await db.adminQuery('UPDATE auth.tenant_membership SET membership_epoch = membership_epoch + 1 WHERE tenant_id = $1::uuid AND user_id = $2::uuid', [T1, U1]);
      await assert.rejects(
        () => context.withTenantContext(selected, async () => {}),
        error => error instanceof TenantSelectionError && error.code === 'TENANT_SELECTION_STALE',
      );

      await db.adminQuery('UPDATE auth.tenant_membership SET status = $3, revoked_at = now() WHERE tenant_id = $1::uuid AND user_id = $2::uuid', [T1, U1, 'revoked']);
      await assert.rejects(
        () => context.withTenantContext(selected, async () => {}),
        error => error instanceof TenantSelectionError && ['TENANT_ACCESS_DENIED', 'TENANT_SELECTION_STALE'].includes(error.code),
      );
    } finally {
      await auth.close();
      await business.close();
    }
  });
});

test('AUTH-006 the session object is not authority and a stale session cannot bind context', async () => {
  await withPivotDatabase({sqlFiles: schemaFiles, adminSqlFiles}, async db => {
    await seed(db);
    const auth = await makeLoginPool(db, db.roles.authService, 'auth');
    const business = await makeLoginPool(db, db.roles.customerApp, 'business');
    try {
      const clock = testClock();
      const store = createSessionStore({connect: () => auth.pool.connect(), clock: clock.clock});
      const {selection, handler} = await makeSelectionAndRoutes({store, authPool: auth.pool, clock});
      const session = await makeSession(store, U1);
      assert.equal((await selectTenant(handler, session.token, session.csrf, {tenantId: T1})).status, 200);
      const current = await store.readSession(session.token);
      const context = createTenantContext({connect: () => business.pool.connect(), resolveAuthority: selection.withAuthority});

      // A fabricated object claiming another tenant is ignored; the stored selection wins.
      const forged = {...current, selectedTenantId: T2, selectedMembershipId: '99999999-9999-4999-8999-999999999999', membershipEpoch: 99};
      const bound = await context.withTenantContext(forged, async (client, resolved) => resolved.tenantId);
      assert.equal(bound, T1, 'only the locked session row is authoritative');

      // A credential-epoch change invalidates the session before any business client.
      await db.adminQuery('UPDATE auth.users SET credential_version = credential_version + 1 WHERE id = $1::uuid', [U1]);
      await assert.rejects(
        () => context.withTenantContext(current, async () => {}),
        error => error instanceof TenantSelectionError && error.code === 'SESSION_REQUIRED',
      );
    } finally {
      await auth.close();
      await business.close();
    }
  });
});

test('AUTH-006 context works on a size-one business pool and destroys an uncertain client', async () => {
  await withPivotDatabase({sqlFiles: schemaFiles, adminSqlFiles}, async db => {
    await seed(db);
    const auth = await makeLoginPool(db, db.roles.authService, 'auth');
    const business = await makeLoginPool(db, db.roles.customerApp, 'business', {max: 1});
    try {
      const clock = testClock();
      const store = createSessionStore({connect: () => auth.pool.connect(), clock: clock.clock});
      const {selection, handler} = await makeSelectionAndRoutes({store, authPool: auth.pool, clock});
      const session = await makeSession(store, U1);
      assert.equal((await selectTenant(handler, session.token, session.csrf, {tenantId: T1})).status, 200);
      const current = await store.readSession(session.token);

      const context = createTenantContext({connect: () => business.pool.connect(), resolveAuthority: selection.withAuthority});
      const count = await Promise.race([
        context.withTenantContext(current, async client => (
          await client.query('SELECT count(*)::int AS n FROM tenant_data.accounts')
        ).rows[0].n),
        new Promise((_, reject) => setTimeout(() => reject(new Error('context timed out on max=1')), 15000)),
      ]);
      assert.equal(count, 2);

      let released;
      const real = await business.pool.connect();
      const uncertainClient = {
        query: async (text, params) => {
          if (typeof text === 'string' && text.trim().toUpperCase() === 'COMMIT') throw new Error('commit acknowledgement lost');
          return real.query(text, params);
        },
        release: async destroy => {
          released = destroy === true;
          real.release?.(destroy);
        },
      };
      const uncertain = createTenantContext({
        connect: async () => uncertainClient,
        resolveAuthority: selection.withAuthority,
      });
      await assert.rejects(
        () => uncertain.withTenantContext(current, async () => {}),
        error => error instanceof TenantContextError && error.code === 'TENANT_CONTEXT_UNCERTAIN',
      );
      assert.equal(released, true, 'an uncertain client is destroyed, not pooled');
    } finally {
      await auth.close();
      await business.close();
    }
  });
});

// ---------------------------------------------------------------------------
// AUTH-006-R1: authoritative admission, MFA/realm authority, pause/interleaving
// and same-tenant business authorization composition.
// ---------------------------------------------------------------------------

test('AUTH-006-R1 selection and business admission enforce customer realm and required MFA', async () => {
  await withPivotDatabase({sqlFiles: schemaFiles, adminSqlFiles}, async db => {
    await seed(db);
    await seedAdmin(db, {verified: false});
    const auth = await makeLoginPool(db, db.roles.authService, 'auth');
    const business = await makeLoginPool(db, db.roles.customerApp, 'business');
    try {
      const clock = testClock();
      const store = createSessionStore({connect: () => auth.pool.connect(), clock: clock.clock});
      const {selection, handler} = makeSelectionAndRoutes({store, authPool: auth.pool, clock});
      const context = createTenantContext({connect: () => business.pool.connect(), resolveAuthority: selection.withAuthority});
      const membership = await db.adminQuery(
        "SELECT id::text AS id, membership_epoch FROM auth.tenant_membership WHERE tenant_id = $1::uuid AND user_id = $2::uuid",
        [T1, U3],
      ).then(result => result.rows[0]);

      const pending = await makeSession(store, U3);
      const pendingList = await listTenants(handler, pending.token);
      assert.equal(pendingList.status, 403);
      assert.equal((await pendingList.json()).error.code, 'MFA_REQUIRED');
      const pendingSelect = await selectTenant(handler, pending.token, pending.csrf, {tenantId: T1});
      assert.equal(pendingSelect.status, 403);
      assert.equal((await pendingSelect.json()).error.code, 'MFA_REQUIRED');

      // Even a selection written directly to the row cannot bypass admission.
      await store.setSessionSelection(pending.session.id, {
        membershipId: membership.id,
        tenantId: T1,
        membershipEpoch: Number(membership.membership_epoch),
        roleId: 'tenant_admin',
      });
      const pendingCurrent = await store.readSession(pending.token);
      let called = false;
      await assert.rejects(
        () => context.withTenantContext(pendingCurrent, async () => {
          called = true;
        }),
        error => error instanceof TenantSelectionError && error.code === 'MFA_REQUIRED',
      );
      assert.equal(called, false, 'a pending/enrollment-only admin never reaches business work');

      // Verified factor + mfa_verified session is the positive path.
      await setFactor(db, U3, {verified: true});
      const verified = await makeSession(store, U3, {assuranceLevel: 'mfa_verified', mfaVerifiedAt: clock.now()});
      const verifiedSelect = await selectTenant(handler, verified.token, verified.csrf, {tenantId: T1});
      assert.equal(verifiedSelect.status, 200);
      const verifiedCurrent = await store.readSession(verified.token);
      const positive = await context.withTenantContext(verifiedCurrent, async () => 'business-ok');
      assert.equal(positive, 'business-ok');

      // Operator sessions are never business authority.
      const operatorCreated = await store.createSession({userId: U1, realm: 'operator', credentialVersion: 1});
      const operatorSession = await store.readSession(operatorCreated.token, {realm: 'operator'});
      await assert.rejects(
        () => selection.list(operatorSession),
        error => error instanceof TenantSelectionError && error.code === 'SESSION_REQUIRED',
      );

      // Unresolved requirement data fails closed.
      const failingStore = {...store};
      failingStore.withTransaction = action => store.withTransaction(tx => action({
        query: async (text, params) => {
          if (typeof text === 'string' && /requires_mfa/i.test(text)) throw new Error('role authority unavailable');
          return tx.query(text, params);
        },
      }));
      const failingSelection = createTenantSelection({store: failingStore, clock: clock.clock});
      await assert.rejects(
        () => failingSelection.list(pending.session),
        error => error instanceof TenantSelectionError && error.code === 'TENANT_AUTHORITY_UNAVAILABLE',
      );
    } finally {
      await auth.close();
      await business.close();
    }
  });
});

test('AUTH-006-R1 promotion, factor disable and assurance downgrade invalidate admission', async () => {
  await withPivotDatabase({sqlFiles: schemaFiles, adminSqlFiles}, async db => {
    await seed(db);
    await seedAdmin(db, {verified: true});
    const auth = await makeLoginPool(db, db.roles.authService, 'auth');
    const business = await makeLoginPool(db, db.roles.customerApp, 'business');
    try {
      const clock = testClock();
      const store = createSessionStore({connect: () => auth.pool.connect(), clock: clock.clock});
      const {selection, handler} = makeSelectionAndRoutes({store, authPool: auth.pool, clock});
      const context = createTenantContext({connect: () => business.pool.connect(), resolveAuthority: selection.withAuthority});

      // Member selects, then is promoted to an MFA-requiring role without an epoch bump.
      const member = await makeSession(store, U1);
      assert.equal((await selectTenant(handler, member.token, member.csrf, {tenantId: T1})).status, 200);
      const memberCurrent = await store.readSession(member.token);
      assert.equal(await context.withTenantContext(memberCurrent, async () => 'before'), 'before');
      await db.adminQuery(
        "UPDATE auth.tenant_membership SET role_id = 'tenant_admin' WHERE tenant_id = $1::uuid AND user_id = $2::uuid",
        [T1, U1],
      );
      let called = false;
      await assert.rejects(
        () => context.withTenantContext(memberCurrent, async () => {
          called = true;
        }),
        error => error instanceof TenantSelectionError && error.code === 'MFA_REQUIRED',
      );
      assert.equal(called, false, 'promotion to an MFA role is enforced at admission');
      await db.adminQuery(
        "UPDATE auth.tenant_membership SET role_id = 'member' WHERE tenant_id = $1::uuid AND user_id = $2::uuid",
        [T1, U1],
      );

      // Verified admin selects; factor disable and assurance downgrade then deny.
      const admin = await makeSession(store, U3, {assuranceLevel: 'mfa_verified', mfaVerifiedAt: clock.now()});
      assert.equal((await selectTenant(handler, admin.token, admin.csrf, {tenantId: T1})).status, 200);
      const adminCurrent = await store.readSession(admin.token);
      assert.equal(await context.withTenantContext(adminCurrent, async () => 'admin-ok'), 'admin-ok');

      await setFactor(db, U3, {verified: false});
      await assert.rejects(
        () => context.withTenantContext(adminCurrent, async () => {}),
        error => error instanceof TenantSelectionError && error.code === 'MFA_REQUIRED',
      );

      await setFactor(db, U3, {verified: true});
      await store.setSessionAssurance(admin.session.id, 'single_factor');
      const downgraded = await store.readSession(admin.token);
      assert.equal(downgraded.assuranceLevel, 'single_factor');
      await assert.rejects(
        () => context.withTenantContext(downgraded, async () => {}),
        error => error instanceof TenantSelectionError && error.code === 'MFA_REQUIRED',
      );
    } finally {
      await auth.close();
      await business.close();
    }
  });
});

test('AUTH-006-R1 a paused admission blocks revocation, credential reset and clearing', async () => {
  await withPivotDatabase({sqlFiles: schemaFiles, adminSqlFiles}, async db => {
    await seed(db);
    const auth = await makeLoginPool(db, db.roles.authService, 'auth');
    const business = await makeLoginPool(db, db.roles.customerApp, 'business');
    const adminPool = new Pool(connectionConfig(db.database));
    try {
      const clock = testClock();
      const store = createSessionStore({connect: () => auth.pool.connect(), clock: clock.clock});
      const {selection, handler} = makeSelectionAndRoutes({store, authPool: auth.pool, clock});
      const session = await makeSession(store, U1);
      assert.equal((await selectTenant(handler, session.token, session.csrf, {tenantId: T1})).status, 200);
      const current = await store.readSession(session.token);

      const gate = makeGate();
      const context = createTenantContext({
        connect: async () => {
          gate.enter();
          await gate.gate;
          return business.pool.connect();
        },
        resolveAuthority: selection.withAuthority,
      });
      let called = false;
      const run = context.withTenantContext(current, async client => {
        called = true;
        await client.query(
          "INSERT INTO tenant_data.warehouses(tenant_id, company, id, branch, name, active) VALUES ($1, 'alpha', 'w-pause', 'main', 'Paused', true)",
          [T1],
        );
        return 'done';
      });
      await gate.entered;

      const blockers = [
        adminPool.query('UPDATE auth.sessions SET revoked_at = now() WHERE id = $1::uuid', [current.id]),
        adminPool.query('UPDATE auth.users SET credential_version = credential_version + 1 WHERE id = $1::uuid', [U1]),
        adminPool.query(
          `UPDATE auth.sessions
           SET selected_membership_id = NULL, selected_tenant_id = NULL,
               selected_role_id = NULL, membership_epoch = NULL
           WHERE id = $1::uuid`,
          [current.id],
        ),
      ];
      for (const blocker of blockers) {
        await assert.rejects(() => within(blocker, 250, 'blocked change'), /timed out/, 'the held admission locks serialize the change');
      }

      gate.release();
      assert.equal(await run, 'done', 'business admission wins while the conflicting change is blocked');
      assert.equal(called, true);
      const effect = await adminPool.query(
        "SELECT count(*)::int AS n FROM tenant_data.warehouses WHERE tenant_id = $1::uuid AND id = 'w-pause'",
        [T1],
      );
      assert.equal(effect.rows[0].n, 1, 'the winning business effect is committed');
      await Promise.allSettled(blockers);

      let afterCalled = false;
      await assert.rejects(
        () => context.withTenantContext(current, async () => {
          afterCalled = true;
        }),
        error => ['SESSION_REQUIRED', 'TENANT_SELECTION_STALE'].includes(error.code),
      );
      assert.equal(afterCalled, false, 'the invalidation applies to the next request');
    } finally {
      await adminPool.end().catch(() => {});
      await auth.close();
      await business.close();
    }
  });
});

test('AUTH-006-R1 a membership/epoch change committed during a pause wins admission', async () => {
  await withPivotDatabase({sqlFiles: schemaFiles, adminSqlFiles}, async db => {
    await seed(db);
    const auth = await makeLoginPool(db, db.roles.authService, 'auth');
    const business = await makeLoginPool(db, db.roles.customerApp, 'business');
    try {
      const clock = testClock();
      const store = createSessionStore({connect: () => auth.pool.connect(), clock: clock.clock});
      const {selection, handler} = makeSelectionAndRoutes({store, authPool: auth.pool, clock});
      const session = await makeSession(store, U1);
      assert.equal((await selectTenant(handler, session.token, session.csrf, {tenantId: T1})).status, 200);
      const current = await store.readSession(session.token);

      const gate = makeGate();
      const context = createTenantContext({
        connect: async () => {
          gate.enter();
          await gate.gate;
          return business.pool.connect();
        },
        resolveAuthority: selection.withAuthority,
      });
      let called = false;
      const run = context.withTenantContext(current, async client => {
        called = true;
        await client.query(
          "INSERT INTO tenant_data.warehouses(tenant_id, company, id, branch, name, active) VALUES ($1, 'alpha', 'w-stale', 'main', 'Stale', true)",
          [T1],
        );
      });
      await gate.entered;
      await db.adminQuery(
        'UPDATE auth.tenant_membership SET membership_epoch = membership_epoch + 1 WHERE tenant_id = $1::uuid AND user_id = $2::uuid',
        [T1, U1],
      );
      gate.release();
      await assert.rejects(
        () => run,
        error => error instanceof TenantSelectionError && error.code === 'TENANT_SELECTION_STALE',
      );
      assert.equal(called, false, 'the handler is not invoked when membership admission fails');
      const effect = await db.adminQuery(
        "SELECT count(*)::int AS n FROM tenant_data.warehouses WHERE tenant_id = $1::uuid AND id = 'w-stale'",
        [T1],
      );
      assert.equal(effect.rows[0].n, 0, 'no business effect commits');
    } finally {
      await auth.close();
      await business.close();
    }
  });
});

test('AUTH-006-R1 expiry during a pause is refused before business work', async () => {
  await withPivotDatabase({sqlFiles: schemaFiles, adminSqlFiles}, async db => {
    await seed(db);
    const auth = await makeLoginPool(db, db.roles.authService, 'auth');
    const business = await makeLoginPool(db, db.roles.customerApp, 'business');
    try {
      const clock = testClock();
      const store = createSessionStore({connect: () => auth.pool.connect(), clock: clock.clock});
      const {selection, handler} = makeSelectionAndRoutes({store, authPool: auth.pool, clock});
      const session = await makeSession(store, U1);
      assert.equal((await selectTenant(handler, session.token, session.csrf, {tenantId: T1})).status, 200);
      const current = await store.readSession(session.token);

      const gate = makeGate();
      const context = createTenantContext({
        connect: async () => {
          gate.enter();
          await gate.gate;
          return business.pool.connect();
        },
        resolveAuthority: selection.withAuthority,
      });
      let called = false;
      const run = context.withTenantContext(current, async client => {
        called = true;
        await client.query(
          "INSERT INTO tenant_data.warehouses(tenant_id, company, id, branch, name, active) VALUES ($1, 'alpha', 'w-expired', 'main', 'Expired', true)",
          [T1],
        );
      });
      await gate.entered;
      clock.advance(31 * 24 * 60 * 60 * 1000);
      gate.release();
      await assert.rejects(
        () => run,
        error => error instanceof TenantSelectionError && error.code === 'SESSION_REQUIRED',
      );
      assert.equal(called, false);
      const effect = await db.adminQuery(
        "SELECT count(*)::int AS n FROM tenant_data.warehouses WHERE tenant_id = $1::uuid AND id = 'w-expired'",
        [T1],
      );
      assert.equal(effect.rows[0].n, 0);
    } finally {
      await auth.close();
      await business.close();
    }
  });
});

test('AUTH-006-R1 a factor disable during a pause is blocked until business admission wins', async () => {
  await withPivotDatabase({sqlFiles: schemaFiles, adminSqlFiles}, async db => {
    await seed(db);
    await seedAdmin(db, {verified: true});
    const auth = await makeLoginPool(db, db.roles.authService, 'auth');
    const business = await makeLoginPool(db, db.roles.customerApp, 'business');
    const adminPool = new Pool(connectionConfig(db.database));
    try {
      const clock = testClock();
      const store = createSessionStore({connect: () => auth.pool.connect(), clock: clock.clock});
      const {selection, handler} = makeSelectionAndRoutes({store, authPool: auth.pool, clock});
      const admin = await makeSession(store, U3, {assuranceLevel: 'mfa_verified', mfaVerifiedAt: clock.now()});
      assert.equal((await selectTenant(handler, admin.token, admin.csrf, {tenantId: T1})).status, 200);
      const current = await store.readSession(admin.token);

      const gate = makeGate();
      const context = createTenantContext({
        connect: async () => {
          gate.enter();
          await gate.gate;
          return business.pool.connect();
        },
        resolveAuthority: selection.withAuthority,
      });
      const run = context.withTenantContext(current, async () => 'admin-business');
      await gate.entered;
      const disable = adminPool.query(
        'UPDATE auth.two_factor SET verified_at = NULL, updated_at = now() WHERE user_id = $1::uuid',
        [U3],
      );
      await assert.rejects(() => within(disable, 250, 'factor disable'), /timed out/);
      gate.release();
      assert.equal(await run, 'admin-business');
      await disable;

      await assert.rejects(
        () => context.withTenantContext(current, async () => {}),
        error => error instanceof TenantSelectionError && error.code === 'MFA_REQUIRED',
      );
    } finally {
      await adminPool.end().catch(() => {});
      await auth.close();
      await business.close();
    }
  });
});

test('AUTH-006-R1 same-tenant company authorization composes with the tenant boundary', async () => {
  await withPivotDatabase({sqlFiles: schemaFiles, adminSqlFiles}, async db => {
    await seed(db);
    await db.adminQuery(`
      INSERT INTO tenant_data.company_profiles(tenant_id, id, name, currency, branch, created_at)
        VALUES ('${T1}', 'beta', 'Beta branch', 'PKR', 'main', 0);
      INSERT INTO tenant_data.business_rule(tenant_id, rule_key, version, scope_type, scope_id, config_jsonb, is_active)
        VALUES
          ('${T1}', 'company.write', 1, 'company', 'alpha', '{"allow": true}'::jsonb, true),
          ('${T1}', 'company.write', 2, 'company', 'beta', '{"allow": false}'::jsonb, true);
    `);
    const auth = await makeLoginPool(db, db.roles.authService, 'auth');
    const business = await makeLoginPool(db, db.roles.customerApp, 'business');
    try {
      const clock = testClock();
      const store = createSessionStore({connect: () => auth.pool.connect(), clock: clock.clock});
      const {selection, handler} = makeSelectionAndRoutes({store, authPool: auth.pool, clock});
      const session = await makeSession(store, U1);
      assert.equal((await selectTenant(handler, session.token, session.csrf, {tenantId: T1})).status, 200);
      const current = await store.readSession(session.token);
      const context = createTenantContext({connect: () => business.pool.connect(), resolveAuthority: selection.withAuthority});

      // Test-local composition of the shared business authorization layer: a company
      // rule from tenant_data.business_rule is evaluated inside the verified tenant
      // transaction. This is not the future policy engine; it proves the boundary carries
      // the same tenant context into that layer.
      const authorize = async (client, company) => {
        const result = await client.query(
          `SELECT config_jsonb->>'allow' AS allow
           FROM tenant_data.business_rule
           WHERE rule_key = 'company.write' AND scope_type = 'company' AND scope_id = $1
             AND is_active AND effective_from <= now()
             AND (effective_to IS NULL OR effective_to > now())
           ORDER BY version DESC LIMIT 1`,
          [company],
        );
        return result.rows[0]?.allow === 'true';
      };
      const post = (company, id) => context.withTenantContext(current, async client => {
        if (!(await authorize(client, company))) {
          throw new TenantContextError(403, 'BUSINESS_ACCESS_DENIED', 'Company access denied.');
        }
        await client.query(
          `INSERT INTO tenant_data.warehouses(tenant_id, company, id, branch, name, active)
           VALUES ($1, $2, $3, 'main', $3, true)`,
          [T1, company, id],
        );
        return 'posted';
      });

      assert.equal(await post('alpha', 'w-alpha'), 'posted');
      const allowed = await db.adminQuery(
        "SELECT count(*)::int AS n FROM tenant_data.warehouses WHERE tenant_id = $1::uuid AND id = 'w-alpha'",
        [T1],
      );
      assert.equal(allowed.rows[0].n, 1, 'the authorized same-tenant company write commits');

      await assert.rejects(
        () => post('beta', 'w-beta'),
        error => error instanceof TenantContextError && error.code === 'BUSINESS_ACCESS_DENIED',
      );
      const denied = await db.adminQuery(
        "SELECT count(*)::int AS n FROM tenant_data.warehouses WHERE tenant_id = $1::uuid AND id = 'w-beta'",
        [T1],
      );
      assert.equal(denied.rows[0].n, 0, 'the denied same-tenant company write leaves no effects');
    } finally {
      await auth.close();
      await business.close();
    }
  });
});

test('AUTH-006-R1 BEGIN, rollback and lost-ack uncertainty destroy the business client', async () => {
  await withPivotDatabase({sqlFiles: schemaFiles, adminSqlFiles}, async db => {
    await seed(db);
    const auth = await makeLoginPool(db, db.roles.authService, 'auth');
    const business = await makeLoginPool(db, db.roles.customerApp, 'business');
    try {
      const clock = testClock();
      const store = createSessionStore({connect: () => auth.pool.connect(), clock: clock.clock});
      const {selection, handler} = makeSelectionAndRoutes({store, authPool: auth.pool, clock});
      const session = await makeSession(store, U1);
      assert.equal((await selectTenant(handler, session.token, session.csrf, {tenantId: T1})).status, 200);
      const current = await store.readSession(session.token);

      // BEGIN uncertainty: the client is destroyed and no handler runs.
      let beginReleased;
      const beginFail = {
        query: async text => {
          if (typeof text === 'string' && text.trim().toUpperCase() === 'BEGIN') throw new Error('begin failed');
          throw new Error('unexpected statement');
        },
        release: async destroy => {
          beginReleased = destroy === true;
        },
      };
      const beginContext = createTenantContext({connect: async () => beginFail, resolveAuthority: selection.withAuthority});
      let beginCalled = false;
      await assert.rejects(
        () => beginContext.withTenantContext(current, async () => {
          beginCalled = true;
        }),
        /begin failed/,
      );
      assert.equal(beginReleased, true);
      assert.equal(beginCalled, false);

      // Rollback failure after a handler error: destroy, no effect.
      const rollbackClient = await business.pool.connect();
      let rollbackReleased;
      const rollbackFail = {
        query: async (text, params) => {
          if (typeof text === 'string' && text.trim().toUpperCase() === 'ROLLBACK') throw new Error('rollback failed');
          return rollbackClient.query(text, params);
        },
        release: async destroy => {
          rollbackReleased = destroy === true;
          rollbackClient.release?.(destroy);
        },
      };
      const rollbackContext = createTenantContext({connect: async () => rollbackFail, resolveAuthority: selection.withAuthority});
      await assert.rejects(
        () => rollbackContext.withTenantContext(current, async client => {
          await client.query(
            "INSERT INTO tenant_data.warehouses(tenant_id, company, id, branch, name, active) VALUES ($1, 'alpha', 'w-rb', 'main', 'Rollback', true)",
            [T1],
          );
          throw new Error('handler failed');
        }),
        /handler failed/,
      );
      assert.equal(rollbackReleased, true);
      const rolledBack = await db.adminQuery(
        "SELECT count(*)::int AS n FROM tenant_data.warehouses WHERE tenant_id = $1::uuid AND id = 'w-rb'",
        [T1],
      );
      assert.equal(rolledBack.rows[0].n, 0);

      // COMMIT persisted but its acknowledgement was lost: the transaction is ambiguous,
      // the client is destroyed, the effect may have committed, and the caller gets 503.
      const ackClient = await business.pool.connect();
      let ackReleased;
      const lostAck = {
        query: async (text, params) => {
          const statement = typeof text === 'string' ? text.trim().toUpperCase() : '';
          if (statement === 'COMMIT') {
            await ackClient.query('COMMIT');
            throw new Error('commit acknowledgement lost');
          }
          return ackClient.query(text, params);
        },
        release: async destroy => {
          ackReleased = destroy === true;
          ackClient.release?.(destroy);
        },
      };
      const ackContext = createTenantContext({connect: async () => lostAck, resolveAuthority: selection.withAuthority});
      await assert.rejects(
        () => ackContext.withTenantContext(current, async client => {
          await client.query(
            "INSERT INTO tenant_data.warehouses(tenant_id, company, id, branch, name, active) VALUES ($1, 'alpha', 'w-ack', 'main', 'Ack', true)",
            [T1],
          );
        }),
        error => error instanceof TenantContextError && error.code === 'TENANT_CONTEXT_UNCERTAIN',
      );
      assert.equal(ackReleased, true, 'an uncertain client is destroyed');
      const ambiguous = await db.adminQuery(
        "SELECT count(*)::int AS n FROM tenant_data.warehouses WHERE tenant_id = $1::uuid AND id = 'w-ack'",
        [T1],
      );
      assert.equal(ambiguous.rows[0].n, 1, 'a persisted COMMIT with a lost acknowledgement is reported as uncertain, not undone');
    } finally {
      await auth.close();
      await business.close();
    }
  });
});
