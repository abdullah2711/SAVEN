import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import pg from 'pg';
import {withPivotDatabase} from './helpers/pg-pivot-fixture.mjs';
import {createSessionStore} from '../src/auth/session-store.mjs';
import {createAuthRoutes, cookieName} from '../src/auth/routes.mjs';
import {createAuditWriter} from '../src/auth/server.mjs';
import {createTenantSelection, TenantSelectionError} from '../src/auth/tenant-selection.mjs';
import {createTenantContext, TenantContextError} from '../src/db/tenant-context.mjs';

const {Pool, Client} = pg;
const origins = {customer: 'https://app.saven.test', operator: 'https://ops.saven.test'};
const customerCookie = cookieName('customer', true);

const T1 = '11111111-1111-4111-8111-111111111111';
const T2 = '22222222-2222-4222-8222-222222222222';
const T3 = '33333333-3333-4333-8333-333333333333';
const T4 = '44444444-4444-4444-8444-444444444444';
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
  'db/postgres/migrations/033-membership-admission-lock.sql',
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

// Splits a migration payload into executable statements while respecting dollar-quoted
// function/DO bodies and line comments. Used only to prove statement-by-statement atomic
// application in the disposable test database.
function splitSqlStatements(sql) {
  const statements = [];
  let buffer = '';
  let index = 0;
  let dollar = null;
  let lineComment = false;
  let single = false;
  while (index < sql.length) {
    const char = sql[index];
    if (lineComment) {
      buffer += char;
      if (char === '\n') lineComment = false;
      index += 1;
      continue;
    }
    if (single) {
      buffer += char;
      if (char === "'") {
        if (sql[index + 1] === "'") {
          buffer += "'";
          index += 2;
          continue;
        }
        single = false;
      }
      index += 1;
      continue;
    }
    if (!dollar && char === '-' && sql[index + 1] === '-') {
      lineComment = true;
      buffer += '--';
      index += 2;
      continue;
    }
    if (!dollar && char === "'") {
      single = true;
      buffer += char;
      index += 1;
      continue;
    }
    if (!dollar && char === '$') {
      const match = /^\$[A-Za-z_]*\$/.exec(sql.slice(index));
      if (match) {
        dollar = match[0];
        buffer += dollar;
        index += dollar.length;
        continue;
      }
    } else if (dollar && sql.startsWith(dollar, index)) {
      buffer += dollar;
      index += dollar.length;
      dollar = null;
      continue;
    }
    if (!dollar && char === ';') {
      const statement = buffer.trim();
      if (statement) statements.push(statement);
      buffer = '';
      index += 1;
      continue;
    }
    buffer += char;
    index += 1;
  }
  const tail = buffer.trim();
  if (tail) statements.push(tail);
  return statements;
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

test('AUTH-006-R1 a membership/epoch writer blocks until business completion (admission wins)', async () => {
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
        return 'admitted';
      });
      await gate.entered;
      const writer = db.adminQuery(
        'UPDATE auth.tenant_membership SET membership_epoch = membership_epoch + 1 WHERE tenant_id = $1::uuid AND user_id = $2::uuid',
        [T1, U1],
      );
      await assert.rejects(() => within(writer, 250, 'membership writer'), /timed out/, 'the authority gate blocks the writer');
      gate.release();
      assert.equal(await run, 'admitted');
      assert.equal(called, true);
      await writer;
      const effect = await db.adminQuery(
        "SELECT count(*)::int AS n FROM tenant_data.warehouses WHERE tenant_id = $1::uuid AND id = 'w-stale'",
        [T1],
      );
      assert.equal(effect.rows[0].n, 1, 'the admitted business effect commits');

      const normal = createTenantContext({connect: () => business.pool.connect(), resolveAuthority: selection.withAuthority});
      await assert.rejects(
        () => normal.withTenantContext(current, async () => {}),
        error => error instanceof TenantSelectionError && error.code === 'TENANT_SELECTION_STALE',
      );
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

// ---------------------------------------------------------------------------
// AUTH-006-R2: exact role provenance, pre-commit revalidation, new authority.
// ---------------------------------------------------------------------------

async function addAuditorRole(db) {
  await db.adminQuery(`
    INSERT INTO auth.roles(role_id, label, assurance_class, requires_mfa, is_operator, is_active, effective_from)
    VALUES ('auditor', 'Auditor', 'single_factor', false, false, true, now())
    ON CONFLICT (role_id) DO NOTHING
  `);
}

test('AUTH-006-R2 a selected-role writer blocks until business completion (admission wins)', async () => {
  await withPivotDatabase({sqlFiles: schemaFiles, adminSqlFiles}, async db => {
    await seed(db);
    await addAuditorRole(db);
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
          "INSERT INTO tenant_data.warehouses(tenant_id, company, id, branch, name, active) VALUES ($1, 'alpha', 'w-role-pause', 'main', 'Role pause', true)",
          [T1],
        );
        return 'admitted';
      });
      await gate.entered;
      const writer = db.adminQuery(
        "UPDATE auth.tenant_membership SET role_id = 'auditor' WHERE tenant_id = $1::uuid AND user_id = $2::uuid",
        [T1, U1],
      );
      await assert.rejects(() => within(writer, 250, 'role writer'), /timed out/, 'the authority gate blocks the role writer');
      gate.release();
      assert.equal(await run, 'admitted');
      assert.equal(called, true);
      await writer;
      const effect = await db.adminQuery(
        "SELECT count(*)::int AS n FROM tenant_data.warehouses WHERE tenant_id = $1::uuid AND id = 'w-role-pause'",
        [T1],
      );
      assert.equal(effect.rows[0].n, 1, 'the admitted business effect commits');

      const normal = createTenantContext({connect: () => business.pool.connect(), resolveAuthority: selection.withAuthority});
      await assert.rejects(
        () => normal.withTenantContext(current, async () => {}),
        error => error instanceof TenantSelectionError && error.code === 'TENANT_SELECTION_STALE',
      );
    } finally {
      await auth.close();
      await business.close();
    }
  });
});

test('AUTH-006-R2 a writer cannot commit after the final validation but before business COMMIT', async () => {
  await withPivotDatabase({sqlFiles: schemaFiles, adminSqlFiles}, async db => {
    await seed(db);
    await addAuditorRole(db);
    const auth = await makeLoginPool(db, db.roles.authService, 'auth');
    const business = await makeLoginPool(db, db.roles.customerApp, 'business');
    try {
      const clock = testClock();
      const store = createSessionStore({connect: () => auth.pool.connect(), clock: clock.clock});
      const {selection, handler} = makeSelectionAndRoutes({store, authPool: auth.pool, clock});
      const session = await makeSession(store, U1);
      assert.equal((await selectTenant(handler, session.token, session.csrf, {tenantId: T1})).status, 200);
      const current = await store.readSession(session.token);

      const commitGate = makeGate();
      const businessClient = await business.pool.connect();
      const pausingClient = {
        query: async (text, params) => {
          const statement = typeof text === 'string' ? text.trim().toUpperCase() : '';
          if (statement === 'COMMIT') {
            commitGate.enter();
            await commitGate.gate;
          }
          return businessClient.query(text, params);
        },
        release: async destroy => {
          businessClient.release?.(destroy);
        },
      };
      const context = createTenantContext({connect: async () => pausingClient, resolveAuthority: selection.withAuthority});
      const run = context.withTenantContext(current, async client => {
        await client.query(
          "INSERT INTO tenant_data.warehouses(tenant_id, company, id, branch, name, active) VALUES ($1, 'alpha', 'w-role-final', 'main', 'Role final', true)",
          [T1],
        );
        return 'admitted';
      });
      await commitGate.entered;
      const writer = db.adminQuery(
        "UPDATE auth.tenant_membership SET role_id = 'auditor' WHERE tenant_id = $1::uuid AND user_id = $2::uuid",
        [T1, U1],
      );
      await assert.rejects(() => within(writer, 250, 'post-validation writer'), /timed out/, 'the shared gate is held through business COMMIT');
      commitGate.release();
      assert.equal(await run, 'admitted');
      await writer;
      const effect = await db.adminQuery(
        "SELECT count(*)::int AS n FROM tenant_data.warehouses WHERE tenant_id = $1::uuid AND id = 'w-role-final'",
        [T1],
      );
      assert.equal(effect.rows[0].n, 1, 'business admission wins and commits');
      const normal = createTenantContext({connect: () => business.pool.connect(), resolveAuthority: selection.withAuthority});
      await assert.rejects(
        () => normal.withTenantContext(current, async () => {}),
        error => error instanceof TenantSelectionError && error.code === 'TENANT_SELECTION_STALE',
      );
    } finally {
      await auth.close();
      await business.close();
    }
  });
});

test('AUTH-006-R2 a new MFA-requiring membership INSERT blocks until business completion', async () => {
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
          "INSERT INTO tenant_data.warehouses(tenant_id, company, id, branch, name, active) VALUES ($1, 'alpha', 'w-new-mfa', 'main', 'New MFA', true)",
          [T1],
        );
        return 'admitted';
      });
      await gate.entered;
      // A genuinely new membership association (not an activation) that makes MFA
      // mandatory. The BEFORE INSERT trigger takes the exclusive gate.
      const writer = db.adminQuery(
        `INSERT INTO auth.tenant_membership(tenant_id, user_id, role_id, status, invited_at, accepted_at)
         VALUES ($1::uuid, $2::uuid, 'tenant_admin', 'active', now(), now())`,
        [T4, U1],
      );
      await assert.rejects(() => within(writer, 250, 'membership insert'), /timed out/, 'the gate blocks the new association');
      gate.release();
      assert.equal(await run, 'admitted');
      assert.equal(called, true);
      await writer;
      const effect = await db.adminQuery(
        "SELECT count(*)::int AS n FROM tenant_data.warehouses WHERE tenant_id = $1::uuid AND id = 'w-new-mfa'",
        [T1],
      );
      assert.equal(effect.rows[0].n, 1, 'the admitted business effect commits');

      const normal = createTenantContext({connect: () => business.pool.connect(), resolveAuthority: selection.withAuthority});
      await assert.rejects(
        () => normal.withTenantContext(current, async () => {}),
        error => error instanceof TenantSelectionError && error.code === 'MFA_REQUIRED',
      );
    } finally {
      await auth.close();
      await business.close();
    }
  });
});

test('AUTH-006-R2 an ineffective selected role fails admission', async () => {
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
      await db.adminQuery(
        "UPDATE auth.roles SET is_active = false WHERE role_id = 'member'",
      );
      const context = createTenantContext({connect: () => business.pool.connect(), resolveAuthority: selection.withAuthority});
      let called = false;
      await assert.rejects(
        () => context.withTenantContext(current, async () => {
          called = true;
        }),
        error => error instanceof TenantSelectionError && error.code === 'TENANT_SELECTION_STALE',
      );
      assert.equal(called, false);
    } finally {
      await auth.close();
      await business.close();
    }
  });
});

// ---------------------------------------------------------------------------
// AUTH-006-R3: authorized authority gate, writer serialization, installation
// and failure evidence.
// ---------------------------------------------------------------------------

async function selectedMember({db, auth, business, clock}) {
  const store = createSessionStore({connect: () => auth.pool.connect(), clock: clock.clock});
  const {selection, handler} = makeSelectionAndRoutes({store, authPool: auth.pool, clock});
  const session = await makeSession(store, U1);
  assert.equal((await selectTenant(handler, session.token, session.csrf, {tenantId: T1})).status, 200);
  const current = await store.readSession(session.token);
  return {store, selection, handler, session, current};
}

test('AUTH-006-R3 authority writers block after final validation until business COMMIT', async () => {
  await withPivotDatabase({sqlFiles: schemaFiles, adminSqlFiles}, async db => {
    await seed(db);
    await addAuditorRole(db);
    const auth = await makeLoginPool(db, db.roles.authService, 'auth');
    const business = await makeLoginPool(db, db.roles.customerApp, 'business');
    try {
      const clock = testClock();
      const {selection, current} = await selectedMember({db, auth, business, clock});
      const cases = [
        {
          label: 'membership revocation',
          write: `UPDATE auth.tenant_membership SET status = 'revoked', revoked_at = now()
                  WHERE tenant_id = '${T1}'::uuid AND user_id = '${U1}'::uuid`,
          reset: `UPDATE auth.tenant_membership SET status = 'active', revoked_at = NULL
                  WHERE tenant_id = '${T1}'::uuid AND user_id = '${U1}'::uuid`,
          expected: ['TENANT_SELECTION_STALE', 'TENANT_ACCESS_DENIED'],
        },
        {
          label: 'membership epoch change',
          write: `UPDATE auth.tenant_membership SET membership_epoch = membership_epoch + 1
                  WHERE tenant_id = '${T1}'::uuid AND user_id = '${U1}'::uuid`,
          reset: `UPDATE auth.tenant_membership SET membership_epoch = 1
                  WHERE tenant_id = '${T1}'::uuid AND user_id = '${U1}'::uuid`,
          expected: ['TENANT_SELECTION_STALE'],
        },
        {
          label: 'role requires_mfa change',
          write: "UPDATE auth.roles SET requires_mfa = true WHERE role_id = 'member'",
          reset: "UPDATE auth.roles SET requires_mfa = false WHERE role_id = 'member'",
          expected: ['MFA_REQUIRED'],
        },
        {
          label: 'activation of a revoked membership',
          write: `UPDATE auth.tenant_membership SET status = 'active', revoked_at = NULL, accepted_at = now()
                  WHERE tenant_id = '${T3}'::uuid AND user_id = '${U1}'::uuid`,
          reset: `UPDATE auth.tenant_membership SET status = 'revoked', revoked_at = now()
                  WHERE tenant_id = '${T3}'::uuid AND user_id = '${U1}'::uuid`,
          expected: null,
        },
      ];

      let index = 0;
      for (const entry of cases) {
        index += 1;
        const commitGate = makeGate();
        const client = await business.pool.connect();
        const pausingClient = {
          query: async (text, params) => {
            const statement = typeof text === 'string' ? text.trim().toUpperCase() : '';
            if (statement === 'COMMIT') {
              commitGate.enter();
              await commitGate.gate;
            }
            return client.query(text, params);
          },
          release: async destroy => {
            client.release?.(destroy);
          },
        };
        const context = createTenantContext({connect: async () => pausingClient, resolveAuthority: selection.withAuthority});
        const warehouse = `w-writer-${index}`;
        const run = context.withTenantContext(current, async businessClient => {
          await businessClient.query(
            'INSERT INTO tenant_data.warehouses(tenant_id, company, id, branch, name, active) VALUES ($1, $2, $3, $4, $3, true)',
            [T1, 'alpha', warehouse, 'main'],
          );
          return 'admitted';
        });
        await commitGate.entered;
        const writer = db.adminQuery(entry.write);
        await assert.rejects(
          () => within(writer, 250, `${entry.label} writer`),
          /timed out/,
          `${entry.label} cannot commit after the final validation`,
        );
        commitGate.release();
        assert.equal(await run, 'admitted');
        await writer;
        const effect = await db.adminQuery(
          'SELECT count(*)::int AS n FROM tenant_data.warehouses WHERE tenant_id = $1::uuid AND id = $2',
          [T1, warehouse],
        );
        assert.equal(effect.rows[0].n, 1, `${entry.label}: the admitted business effect commits`);

        if (entry.expected) {
          const normal = createTenantContext({connect: () => business.pool.connect(), resolveAuthority: selection.withAuthority});
          await assert.rejects(
            () => normal.withTenantContext(current, async () => {}),
            error => error instanceof TenantSelectionError && entry.expected.includes(error.code),
          );
        }
        await db.adminQuery(entry.reset);
      }
    } finally {
      await auth.close();
      await business.close();
    }
  });
});

test('AUTH-006-R3 mixed role+membership writer transactions block in both table orders', async () => {
  await withPivotDatabase({sqlFiles: schemaFiles, adminSqlFiles}, async db => {
    await seed(db);
    const auth = await makeLoginPool(db, db.roles.authService, 'auth');
    const business = await makeLoginPool(db, db.roles.customerApp, 'business');
    const adminPool = new Pool(connectionConfig(db.database));
    try {
      const clock = testClock();
      const {selection, current} = await selectedMember({db, auth, business, clock});
      const orders = [
        [
          "UPDATE auth.roles SET requires_mfa = requires_mfa WHERE role_id = 'member'",
          `UPDATE auth.tenant_membership SET membership_epoch = membership_epoch
           WHERE tenant_id = '${T1}'::uuid AND user_id = '${U1}'::uuid`,
        ],
        [
          `UPDATE auth.tenant_membership SET membership_epoch = membership_epoch
           WHERE tenant_id = '${T1}'::uuid AND user_id = '${U1}'::uuid`,
          "UPDATE auth.roles SET requires_mfa = requires_mfa WHERE role_id = 'member'",
        ],
      ];
      let index = 0;
      for (const statements of orders) {
        index += 1;
        const commitGate = makeGate();
        const client = await business.pool.connect();
        const pausingClient = {
          query: async (text, params) => {
            const statement = typeof text === 'string' ? text.trim().toUpperCase() : '';
            if (statement === 'COMMIT') {
              commitGate.enter();
              await commitGate.gate;
            }
            return client.query(text, params);
          },
          release: async destroy => {
            client.release?.(destroy);
          },
        };
        const context = createTenantContext({connect: async () => pausingClient, resolveAuthority: selection.withAuthority});
        const run = context.withTenantContext(current, async businessClient => {
          await businessClient.query(
            "INSERT INTO tenant_data.warehouses(tenant_id, company, id, branch, name, active) VALUES ($1, 'alpha', $2, 'main', $2, true)",
            [T1, `w-order-${index}`],
          );
          return 'admitted';
        });
        await commitGate.entered;
        const writerClient = await adminPool.connect();
        const writer = (async () => {
          try {
            await writerClient.query('BEGIN');
            for (const statement of statements) await writerClient.query(statement);
            await writerClient.query('COMMIT');
          } catch (error) {
            await writerClient.query('ROLLBACK').catch(() => {});
            throw error;
          } finally {
            writerClient.release();
          }
        })();
        await assert.rejects(
          () => within(writer, 250, `mixed writer order ${index}`),
          /timed out/,
          'the first authority statement takes the exclusive gate',
        );
        commitGate.release();
        assert.equal(await run, 'admitted');
        await writer;
      }
    } finally {
      await adminPool.end().catch(() => {});
      await auth.close();
      await business.close();
    }
  });
});

test('AUTH-006-R3 authority gate installation, privileges and conflict guard', async () => {
  await withPivotDatabase({sqlFiles: schemaFiles, adminSqlFiles}, async db => {
    await seed(db);
    const functionRow = await db.adminQuery(
      `SELECT p.prosecdef, p.proconfig, p.proowner::regrole::text AS owner,
              has_function_privilege($1, p.oid, 'EXECUTE') AS auth_exec,
              has_function_privilege($2, p.oid, 'EXECUTE') AS customer_exec,
              has_function_privilege($3, p.oid, 'EXECUTE') AS operator_exec
       FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname = 'auth' AND p.proname = 'lock_authority_gate'`,
      [db.roles.authService, db.roles.customerApp, db.roles.operatorAdmin],
    ).then(result => result.rows[0]);
    assert.equal(functionRow.prosecdef, false, 'trigger function is SECURITY INVOKER');
    assert.deepEqual(functionRow.proconfig, ['search_path=pg_catalog']);
    assert.equal(functionRow.owner, db.roles.migrator);
    assert.equal(functionRow.auth_exec, false);
    assert.equal(functionRow.customer_exec, false);
    assert.equal(functionRow.operator_exec, false);

    const triggers = await db.adminQuery(
      `SELECT c.relname, t.tgname, t.tgtype
       FROM pg_trigger t
       JOIN pg_class c ON c.oid = t.tgrelid
       JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'auth' AND c.relname IN ('tenant_membership', 'roles')
         AND NOT t.tgisinternal
         AND t.tgname = ANY($1)
       ORDER BY c.relname, t.tgname`,
      [[
        'tenant_membership_authority_gate_insert',
        'tenant_membership_authority_gate_update',
        'tenant_membership_authority_gate_delete',
        'roles_authority_gate_insert',
        'roles_authority_gate_update',
        'roles_authority_gate_delete',
      ]],
    );
    assert.equal(triggers.rowCount, 6);
    for (const trigger of triggers.rows) {
      assert.equal(trigger.tgtype & 1, 0, `${trigger.tgname} is a statement trigger`);
      assert.equal(trigger.tgtype & 2, 2, `${trigger.tgname} is BEFORE`);
      assert.ok([4, 8, 16].includes(trigger.tgtype & 28), `${trigger.tgname} targets INSERT/UPDATE/DELETE`);
    }

    const sql = await readFile(new URL('../db/postgres/migrations/033-membership-admission-lock.sql', import.meta.url), 'utf8');
    const statements = sql.split('\n').filter(line => !line.trim().startsWith('--'));
    assert.match(sql, /RAISE EXCEPTION 'AUTH-006 033 refuses pre-existing/);
    assert.equal(statements.some(line => /^\s*GRANT\b/i.test(line)), false, 'no GRANT statement');
    assert.equal(statements.some(line => /SECURITY DEFINER/i.test(line)), false);
    assert.equal(statements.some(line => /BYPASSRLS/i.test(line)), false);
    assert.equal(statements.some(line => /^\s*(ALTER TABLE|CREATE POLICY|DROP POLICY)\b/i.test(line)), false);
  });
});

test('AUTH-006-R3 missing or failed gate fails closed without poisoning the pool', async () => {
  await withPivotDatabase({sqlFiles: schemaFiles, adminSqlFiles}, async db => {
    await seed(db);
    const auth = await makeLoginPool(db, db.roles.authService, 'auth');
    const business = await makeLoginPool(db, db.roles.customerApp, 'business');
    try {
      const clock = testClock();
      const store = createSessionStore({connect: () => auth.pool.connect(), clock: clock.clock});
      const {selection, current} = await selectedMember({db, auth, business, clock});

      // Failed shared-gate acquisition fails closed; the auth pool stays usable.
      const failingStore = {...store};
      failingStore.withTransaction = action => store.withTransaction(tx => action({
        query: async (text, params) => {
          if (typeof text === 'string' && /pg_advisory_xact_lock_shared/i.test(text)) throw new Error('gate unavailable');
          return tx.query(text, params);
        },
      }));
      const failingSelection = createTenantSelection({store: failingStore, clock: clock.clock});
      await assert.rejects(
        () => failingSelection.list(current),
        error => error instanceof TenantSelectionError && error.code === 'TENANT_AUTHORITY_UNAVAILABLE',
      );
      const afterFailure = await selection.list(current);
      assert.equal(Array.isArray(afterFailure.tenants), true, 'the auth pool is reusable after a failed gate acquisition');

      // A missing/misinstalled gate is not an accepted deployment profile.
      await db.adminQuery('DROP FUNCTION auth.lock_authority_gate() CASCADE');
      await assert.rejects(
        () => selection.list(current),
        error => error instanceof TenantSelectionError && error.code === 'TENANT_AUTHORITY_GATE_UNAVAILABLE',
      );
      let called = false;
      const context = createTenantContext({connect: () => business.pool.connect(), resolveAuthority: selection.withAuthority});
      await assert.rejects(
        () => context.withTenantContext(current, async () => {
          called = true;
        }),
        error => error instanceof TenantSelectionError && error.code === 'TENANT_AUTHORITY_GATE_UNAVAILABLE',
      );
      assert.equal(called, false);
    } finally {
      await auth.close();
      await business.close();
    }
  });
});

test('AUTH-006-R3 composed boundary works on smallest separate auth/business pools', async () => {
  await withPivotDatabase({sqlFiles: schemaFiles, adminSqlFiles}, async db => {
    await seed(db);
    const auth = await makeLoginPool(db, db.roles.authService, 'auth', {max: 1});
    const business = await makeLoginPool(db, db.roles.customerApp, 'business', {max: 1});
    try {
      const clock = testClock();
      const store = createSessionStore({connect: () => auth.pool.connect(), clock: clock.clock});
      const {selection, handler} = makeSelectionAndRoutes({store, authPool: auth.pool, clock});
      const session = await makeSession(store, U1);
      assert.equal((await selectTenant(handler, session.token, session.csrf, {tenantId: T1})).status, 200);
      const current = await store.readSession(session.token);
      const context = createTenantContext({connect: () => business.pool.connect(), resolveAuthority: selection.withAuthority});
      const count = await Promise.race([
        context.withTenantContext(current, async client => (
          await client.query('SELECT count(*)::int AS n FROM tenant_data.accounts')
        ).rows[0].n),
        new Promise((_, reject) => setTimeout(() => reject(new Error('smallest-pool context timed out')), 15000)),
      ]);
      assert.equal(count, 2);
    } finally {
      await auth.close();
      await business.close();
    }
  });
});

// ---------------------------------------------------------------------------
// AUTH-006-R4: exact gate-contract negatives and atomic 033 installation.
// ---------------------------------------------------------------------------

test('AUTH-006-R4 wrong gate bindings are refused and a valid profile recovers', async () => {
  await withPivotDatabase({sqlFiles: schemaFiles, adminSqlFiles}, async db => {
    await seed(db);
    const auth = await makeLoginPool(db, db.roles.authService, 'auth');
    const business = await makeLoginPool(db, db.roles.customerApp, 'business');
    try {
      const clock = testClock();
      const {selection, current} = await selectedMember({db, auth, business, clock});

      const gateTriggers = {
        tenant_membership_authority_gate_insert: {table: 'auth.tenant_membership', event: 'INSERT'},
        tenant_membership_authority_gate_update: {table: 'auth.tenant_membership', event: 'UPDATE'},
        tenant_membership_authority_gate_delete: {table: 'auth.tenant_membership', event: 'DELETE'},
        roles_authority_gate_insert: {table: 'auth.roles', event: 'INSERT'},
        roles_authority_gate_update: {table: 'auth.roles', event: 'UPDATE'},
        roles_authority_gate_delete: {table: 'auth.roles', event: 'DELETE'},
      };
      const dropTrigger = async name => {
        const def = gateTriggers[name];
        await db.adminQuery(`DROP TRIGGER IF EXISTS ${name} ON ${def.table}`);
      };
      const createTrigger = async (name, {table, event, row = false, when = null, fn = 'auth.lock_authority_gate'}) => {
        const filter = when === null ? '' : `WHEN (${when}) `;
        await db.adminQuery(
          `CREATE TRIGGER ${name} BEFORE ${event} ON ${table} FOR EACH ${row ? 'ROW' : 'STATEMENT'} ${filter}EXECUTE FUNCTION ${fn}()`,
        );
      };
      const restoreTrigger = async name => {
        const def = gateTriggers[name];
        await dropTrigger(name);
        await createTrigger(name, def);
      };
      const expectRefused = async label => {
        await assert.rejects(
          () => selection.list(current),
          error => error instanceof TenantSelectionError && error.code === 'TENANT_AUTHORITY_GATE_UNAVAILABLE',
          label,
        );
        let called = false;
        const context = createTenantContext({connect: () => business.pool.connect(), resolveAuthority: selection.withAuthority});
        await assert.rejects(
          () => context.withTenantContext(current, async () => {
            called = true;
          }),
          error => error instanceof TenantSelectionError && error.code === 'TENANT_AUTHORITY_GATE_UNAVAILABLE',
          label,
        );
        assert.equal(called, false, `${label}: no handler/effects`);
      };
      const expectRecovered = async label => {
        const listed = await selection.list(current);
        assert.equal(listed.tenants.length, 2, `${label}: valid profile recovers`);
      };

      // Replica-only firing mode: present by name/count, but does not fire in origin.
      await db.adminQuery(
        'ALTER TABLE auth.tenant_membership ENABLE REPLICA TRIGGER tenant_membership_authority_gate_insert',
      );
      await expectRefused('replica-only trigger');
      await db.adminQuery(
        'ALTER TABLE auth.tenant_membership ENABLE TRIGGER tenant_membership_authority_gate_insert',
      );
      await expectRecovered('replica-only trigger');

      // Same name/count but bound to a no-op function.
      await db.adminQuery(
        `CREATE FUNCTION auth.noop_gate() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog
         AS $fn$ BEGIN RETURN NULL; END; $fn$`,
      );
      await dropTrigger('roles_authority_gate_update');
      await createTrigger('roles_authority_gate_update', {
        table: 'auth.roles', event: 'UPDATE', fn: 'auth.noop_gate',
      });
      await expectRefused('wrong trigger function');
      await restoreTrigger('roles_authority_gate_update');
      await db.adminQuery('DROP FUNCTION auth.noop_gate()');
      await expectRecovered('wrong trigger function');

      // Same name/count but on the wrong table.
      await dropTrigger('roles_authority_gate_delete');
      await createTrigger('roles_authority_gate_delete', {table: 'auth.tenant_membership', event: 'DELETE'});
      await expectRefused('wrong trigger table');
      await db.adminQuery('DROP TRIGGER roles_authority_gate_delete ON auth.tenant_membership');
      await restoreTrigger('roles_authority_gate_delete');
      await expectRecovered('wrong trigger table');

      // Same name/count but on the wrong event.
      await dropTrigger('tenant_membership_authority_gate_insert');
      await createTrigger('tenant_membership_authority_gate_insert', {table: 'auth.tenant_membership', event: 'UPDATE'});
      await expectRefused('wrong trigger event');
      await restoreTrigger('tenant_membership_authority_gate_insert');
      await expectRecovered('wrong trigger event');

      // Row-level conditional binding instead of BEFORE STATEMENT.
      await dropTrigger('tenant_membership_authority_gate_update');
      await createTrigger('tenant_membership_authority_gate_update', {
        table: 'auth.tenant_membership', event: 'UPDATE', row: true, when: 'false',
      });
      await expectRefused('row-level conditional trigger');
      await restoreTrigger('tenant_membership_authority_gate_update');
      await expectRecovered('row-level conditional trigger');

      // Reviewed function configuration is part of the contract.
      await db.adminQuery('ALTER FUNCTION auth.lock_authority_gate() SECURITY DEFINER');
      await expectRefused('SECURITY DEFINER function');
      await db.adminQuery('ALTER FUNCTION auth.lock_authority_gate() SECURITY INVOKER');
      await expectRecovered('SECURITY DEFINER function');

      await db.adminQuery('ALTER FUNCTION auth.lock_authority_gate() SET search_path = public');
      await expectRefused('wrong search_path');
      await db.adminQuery('ALTER FUNCTION auth.lock_authority_gate() SET search_path = pg_catalog');
      await expectRecovered('wrong search_path');
    } finally {
      await auth.close();
      await business.close();
    }
  });
});

test('AUTH-006-R4 migration 033 is atomic, refuses foreign conflicts and retries cleanly', async () => {
  await withPivotDatabase({
    sqlFiles: schemaFiles,
    adminSqlFiles: adminSqlFiles.filter(file => !file.includes('033-')),
  }, async db => {
    await seed(db);
    const raw = await readFile(new URL('../db/postgres/migrations/033-membership-admission-lock.sql', import.meta.url), 'utf8');
    const sql = raw.replaceAll('saven_migrator', db.roles.migrator);
    const statements = splitSqlStatements(sql);
    assert.ok(statements.length >= 12);
    assert.match(statements[0], /BEGIN/);

    const gateObjects = async () => db.adminQuery(
      `SELECT
         (SELECT count(*)::int FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
           WHERE n.nspname = 'auth' AND p.proname = 'lock_authority_gate') AS functions,
         (SELECT count(*)::int FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
           JOIN pg_namespace n ON n.oid = c.relnamespace
           WHERE n.nspname = 'auth' AND c.relname IN ('tenant_membership', 'roles')
             AND NOT t.tgisinternal AND t.tgname LIKE '%authority_gate%') AS triggers`,
    ).then(result => result.rows[0]);

    // Pre-existing foreign authority-gate-like objects are refused, not repaired.
    await db.adminQuery(
      `CREATE FUNCTION auth.noop_gate() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog
       AS $fn$ BEGIN RETURN NULL; END; $fn$`,
    );
    await db.adminQuery(
      'CREATE TRIGGER tenant_membership_authority_gate_insert BEFORE INSERT ON auth.tenant_membership FOR EACH STATEMENT EXECUTE FUNCTION auth.noop_gate()',
    );
    const conflictClient = new Client(connectionConfig(db.database));
    await conflictClient.connect();
    try {
      await assert.rejects(async () => {
        for (const statement of statements) await conflictClient.query(statement);
      }, /AUTH-006 033 refuses pre-existing/);
      await conflictClient.query('ROLLBACK').catch(() => {});
    } finally {
      await conflictClient.end().catch(() => {});
    }
    assert.deepEqual(await gateObjects(), {functions: 0, triggers: 1}, 'only the foreign trigger remains');
    await db.adminQuery('DROP TRIGGER tenant_membership_authority_gate_insert ON auth.tenant_membership');
    await db.adminQuery('DROP FUNCTION auth.noop_gate()');

    // Interrupted statement-by-statement installation rolls back all gate objects.
    const interrupted = new Client(connectionConfig(db.database));
    await interrupted.connect();
    try {
      await assert.rejects(async () => {
        for (const statement of statements) {
          await interrupted.query(statement);
          if (statement.includes('ALTER FUNCTION') && statement.includes('OWNER TO')) {
            throw new Error('injected interruption after DDL');
          }
        }
      }, /injected interruption/);
      await interrupted.query('ROLLBACK').catch(() => {});
    } finally {
      await interrupted.end().catch(() => {});
    }
    assert.deepEqual(await gateObjects(), {functions: 0, triggers: 0}, 'interrupted installation left no gate objects');

    // A clean retry succeeds and the installed protocol composes with admission.
    const installClient = new Client(connectionConfig(db.database));
    await installClient.connect();
    try {
      for (const statement of statements) await installClient.query(statement);
    } finally {
      await installClient.end().catch(() => {});
    }
    assert.deepEqual(await gateObjects(), {functions: 1, triggers: 6});

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
      const count = await context.withTenantContext(current, async client => (
        await client.query('SELECT count(*)::int AS n FROM tenant_data.accounts')
      ).rows[0].n);
      assert.equal(count, 2);
    } finally {
      await auth.close();
      await business.close();
    }
  });
});
