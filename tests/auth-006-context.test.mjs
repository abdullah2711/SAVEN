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

async function makeSession(store, userId) {
  const created = await store.createSession({userId, realm: 'customer', credentialVersion: 1});
  const session = await store.readSession(created.token);
  return {token: created.token, csrf: created.csrfToken, session};
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
        resolveSelection: selection.resolve,
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
      const context = createTenantContext({connect: () => business.pool.connect(), resolveSelection: selection.resolve});

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
      const context = createTenantContext({connect: () => business.pool.connect(), resolveSelection: selection.resolve});

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

      const context = createTenantContext({connect: () => business.pool.connect(), resolveSelection: selection.resolve});
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
        resolveSelection: selection.resolve,
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
