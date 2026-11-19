// PIVOT-014 Amendment A — AUTH-006 admission lock compatibility and retention.
//
// The admission principal read was narrowed from FOR UPDATE to FOR NO KEY UPDATE so the
// accepted terminal-void receipt (which takes a KEY SHARE lock on auth.users through
// entry_voids_actor_fkey) can commit while admission is still held. This file proves the
// two halves of that trade:
//
//   * compatibility — a KEY SHARE holder is not blocked by a held admission;
//   * retention     — every authority/lifecycle writer is still excluded while admission
//                     is held (principal NO KEY UPDATE blocks their row updates).
//
// It runs on its own disposable cluster so it is independent of the lifecycle test.

import test from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';

import {createDisposableCluster} from './helpers/pivot-014-disposable-postgres.mjs';
import {createAuthServer} from '../src/auth/server.mjs';
import {createTenantSelection} from '../src/auth/tenant-selection.mjs';
import {createAuditWriter} from '../src/auth/audit.mjs';
import {encodePassword} from '../src/passwords.mjs';
import {cookieName} from '../src/auth/routes.mjs';

const ORIGIN = 'https://app.example.test';
const OPERATOR_ORIGIN = 'https://ops.example.test';
const TENANT = '33333333-3333-4333-8333-333333333333';
const MEMBER_USER = '44444444-4444-4444-8444-444444444444';
const ACTOR = 'amendment-a-member';

function withRole(pool, role) {
  return {
    async connect() {
      const client = await pool.connect();
      await client.query(`SET ROLE ${role}`);
      return client;
    },
    async query(text, params) {
      const client = await pool.connect();
      try {
        await client.query(`SET ROLE ${role}`);
        return await client.query(text, params);
      } finally {
        client.release();
      }
    },
  };
}

test('AUTH-006 Amendment A: admission lock compatibility and retention', {timeout: 120_000}, async t => {
  let cluster;
  const pools = [];
  let admin;
  try {
    cluster = await createDisposableCluster({label: 'pivot014-auth'});
    const connection = {host: cluster.host, port: cluster.port, database: cluster.database};
    const authPool = new pg.Pool({...connection, user: cluster.logins.auth, password: cluster.logins.authPassword, max: 8});
    const probePool = new pg.Pool({...connection, user: cluster.logins.auth, password: cluster.logins.authPassword, max: 4});
    pools.push(authPool, probePool);
    const authService = withRole(authPool, 'saven_auth_service');
    const probe = withRole(probePool, 'saven_auth_service');
    admin = new pg.Client({...connection, user: process.env.USER});
    await admin.connect();

    const passwordHash = await encodePassword('amendment-a-password');
    await admin.query(`INSERT INTO auth.users (id, legacy_id, email, email_verified, status,
                         password_hash, password_scheme, password_updated_at, credential_version)
                       VALUES ($1, $2, 'a@example.test', true, 'active', $3, 'scrypt', now(), 1)`,
    [MEMBER_USER, ACTOR, passwordHash]);
    await admin.query(`INSERT INTO auth.tenant_membership
                         (id, tenant_id, user_id, role_id, status, membership_epoch, invited_at, accepted_at)
                       VALUES (gen_random_uuid(), $1, $2, 'member', 'active', 1, now(), now())`,
    [TENANT, MEMBER_USER]);
    await admin.query('BEGIN');
    await admin.query(`SELECT set_config('app.current_tenant_id', $1, true),
                              set_config('app.current_user_id', $2, true)`, [TENANT, MEMBER_USER]);
    await admin.query(`INSERT INTO tenant_data.members (tenant_id, user_id, user_uuid, active)
                         VALUES ($1, $2, $3, true)`, [TENANT, ACTOR, MEMBER_USER]);
    await admin.query(`INSERT INTO tenant_data.roles (tenant_id, id, name, protected, permissions)
                         VALUES ($1, 'ultimate_business_admin', 'Owner', true, '{}')`, [TENANT]);
    await admin.query(`INSERT INTO tenant_data.assignments (tenant_id, user_id, role_id)
                         VALUES ($1, $2, 'ultimate_business_admin')`, [TENANT, ACTOR]);
    await admin.query('COMMIT');

    const auth = createAuthServer({
      pool: authService, clock: () => new Date(),
      origins: {customer: ORIGIN, operator: OPERATOR_ORIGIN},
      secureCookies: false, audit: createAuditWriter(authService),
    });
    const selection = createTenantSelection({store: auth.store, audit: createAuditWriter(authService)});
    const membershipId = (await admin.query(
      'SELECT id FROM auth.tenant_membership WHERE user_id = $1', [MEMBER_USER])).rows[0].id;

    // Real login and tenant selection, exactly as a request would.
    const loginResponse = await auth.handler(new Request(`${ORIGIN}/v1/auth/login`, {
      method: 'POST',
      headers: {'origin': ORIGIN, 'content-type': 'application/json'},
      body: JSON.stringify({email: 'a@example.test', password: 'amendment-a-password'}),
    }));
    assert.equal(loginResponse.status, 200, await loginResponse.clone().text());
    const loginBody = await loginResponse.json();
    const cookie = loginResponse.headers.getSetCookie()
      .find(value => value.startsWith(`${cookieName('customer', false)}=`));
    const token = cookie.split(';')[0].split('=')[1];

    const selectResponse = await auth.handler(new Request(`${ORIGIN}/v1/auth/tenant/select`, {
      method: 'POST',
      headers: {
        'origin': ORIGIN, 'content-type': 'application/json',
        'cookie': `${cookieName('customer', false)}=${token}`,
        'x-csrf-token': loginBody.csrfToken,
      },
      body: JSON.stringify({tenantId: TENANT}),
    }));
    assert.equal(selectResponse.status, 200, await selectResponse.clone().text());

    const session = await auth.store.readSession(token, {realm: 'customer'});
    assert.ok(session?.id && session.selectedTenantId === TENANT, 'a selected real session is required');

    // Each probe runs in its own transaction so SET LOCAL lock_timeout actually applies.
    const attempt = async (sql, params = [], {lockTimeout = '400ms'} = {}) => {
      const client = await probePool.connect();
      try {
        await client.query('SET ROLE saven_auth_service');
        await client.query('BEGIN');
        await client.query(`SET LOCAL lock_timeout = '${lockTimeout}'`);
        await client.query(sql, params);
        await client.query('ROLLBACK');
        return null;
      } catch (error) {
        await client.query('ROLLBACK').catch(() => {});
        return error;
      } finally {
        client.release();
      }
    };

    await selection.withAuthority(session, async () => {
      // Compatibility: a KEY SHARE holder is not blocked (this is what the 042 void FK needs).
      const shared = await attempt('SELECT 1 FROM auth.users WHERE id = $1 FOR KEY SHARE', [MEMBER_USER],
        {lockTimeout: '3s'});
      assert.equal(shared, null, `KEY SHARE must not be blocked by admission: ${shared?.message}`);

      // Retention: every authority writer is still excluded while admission is held.
      const writers = [
        ['status', `UPDATE auth.users SET status = 'suspended' WHERE id = $1`],
        ['credential', `UPDATE auth.users SET credential_version = credential_version + 1 WHERE id = $1`],
        ['principal lock', 'SELECT 1 FROM auth.users WHERE id = $1 FOR NO KEY UPDATE'],
        ['membership revoke', `UPDATE auth.tenant_membership SET status = 'revoked', revoked_at = now() WHERE user_id = $1`],
      ];
      for (const [label, sql] of writers) {
        const error = await attempt(sql, [MEMBER_USER]);
        assert.ok(error, `${label} writer must be excluded while admission is held`);
        assert.equal(error.code, '55P03', `${label} must fail on lock timeout, got ${error.code}`);
      }
    });

    // Permitted control after release: the same writer succeeds.
    const afterRelease = await attempt(`UPDATE auth.users SET status = 'active' WHERE id = $1`, [MEMBER_USER]);
    assert.equal(afterRelease, null);
  } finally {
    if (admin) await admin.end().catch(() => {});
    for (const pool of pools) await pool.end().catch(() => {});
    if (cluster) await cluster.stop();
  }
});
