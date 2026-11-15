import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {randomBytes, randomUUID} from 'node:crypto';
import {
  withAuthDatabase,
  connectAuthClusterAdmin,
  connectAuthDatabaseAdmin,
  authRoleNamesForSuffix,
  generatedAuthRoleNames,
  authRoleBootstrapSql,
  authSchemaSql,
  authTargetRoleKeys,
  combineAuthRunAndCleanupErrors,
} from './helpers/pg-auth-fixture.mjs';

const repoRoot = new URL('../', import.meta.url);
const tenantId = '11111111-1111-4111-8111-111111111111';
const otherTenantId = '22222222-2222-4222-8222-222222222222';
const quoteRole = name => `"${String(name).replaceAll('"', '""')}"`;
const hex64 = seed => Buffer.from(seed).toString('hex').padEnd(64, '0');
const scryptHash = '$scrypt$ln=15,r=8,p=1$c2FsdHZhbHVlMDE$dmVyaWZpZXJieXRlcw';
const argon2Hash = '$argon2id$v=19$m=65536,t=3,p=1$c2FsdHZhbHVlMDI$dmVyaWZpZXJieXRlcw';
const authTables = [
  'accounts',
  'auth_audit',
  'oauth_state',
  'recovery_codes',
  'reference_value',
  'roles',
  'sessions',
  'tenant_membership',
  'two_factor',
  'users',
  'verification',
].sort();

const suffixFor = prefix => prefix + randomBytes(4).toString('hex');

test('AUTH-001 schema text keeps canonical authority and extensibility boundaries', async () => {
  const schemaSql = await readFile(new URL('db/postgres/05-auth-schema.sql', repoRoot), 'utf8');
  assert.doesNotMatch(schemaSql, /\bPASSWORD\s+(?:E)?'/i);
  assert.doesNotMatch(schemaSql, /CREATE\s+ROLE[^;]*PASSWORD/i);
  assert.doesNotMatch(schemaSql, /postgres(?:ql)?:\/\//i);
  assert.doesNotMatch(schemaSql, /BYPASSRLS/i);
  assert.doesNotMatch(
    schemaSql,
    /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?auth\.(?:user_identity|operator_membership)\b/i,
  );
  assert.doesNotMatch(schemaSql, /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?operator\./i);
  // Growing domains are reference rows, never CHECK IN (...) enumerations.
  assert.doesNotMatch(schemaSql, /CHECK\s*\([^)]*\bIN\s*\(/i);
  assert.match(schemaSql, /AUTH_RECORD_IMMUTABLE/);
  assert.match(schemaSql, /AUTH_SESSION_ABSOLUTE_EXPIRY_IMMUTABLE/);
  assert.match(schemaSql, /auth\.reference_value/);
  assert.match(schemaSql, /Extension points \(AUTH-001\)/);
  assert.match(schemaSql, /credential_version/);
  assert.match(schemaSql, /legacy_id/);
  assert.doesNotMatch(schemaSql, /^\s*CREATE\s+TABLE\s+[^;]*\bpassword\s+text/im);
  assert.doesNotMatch(schemaSql, /^\s*CREATE\s+TABLE\s+[^;]*\btoken\s+text/im);

  // AUTH-001-R1 correction: additive, validated, privilege-neutral.
  const correctionSql = await readFile(
    new URL('db/postgres/migrations/006-auth-schema-corrections.sql', repoRoot),
    'utf8',
  );
  assert.match(correctionSql, /ADD CONSTRAINT oauth_state_pkce_key_binding_chk/);
  assert.match(correctionSql, /CHECK \(code_verifier_ciphertext IS NULL OR \(/);
  assert.match(correctionSql, /code_verifier_key_version IS NOT NULL AND code_verifier_key_version > 0/);
  assert.match(correctionSql, /NOT VALID/);
  assert.match(correctionSql, /VALIDATE CONSTRAINT oauth_state_pkce_key_binding_chk/);
  assert.doesNotMatch(correctionSql, /DROP\s+CONSTRAINT|DROP\s+TABLE|ALTER\s+COLUMN|DROP\s+COLUMN/i);
  assert.doesNotMatch(correctionSql, /^\s*(?:GRANT|REVOKE|CREATE\s+ROLE)\s/im);
  assert.doesNotMatch(correctionSql, /\bPASSWORD\s+(?:E)?'|postgres(?:ql)?:\/\//i);
});

test('AUTH-001 canonical auth schema applies with constrained ownership and no duplicate registries', async () => {
  await withAuthDatabase(async db => {
    const actualTables = (
      await db.adminQuery(
        `SELECT c.relname AS table_name
         FROM pg_class c
         JOIN pg_namespace n ON n.oid = c.relnamespace
         WHERE n.nspname = 'auth' AND c.relkind = 'r'
         ORDER BY c.relname`,
      )
    ).rows.map(row => row.table_name);
    assert.deepEqual(actualTables, authTables);

    const duplicateRegistry = (
      await db.adminQuery(
        `SELECT c.relname AS table_name, n.nspname AS schema_name
         FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
         WHERE c.relname IN ('user_identity', 'tenant_membership')
           AND n.nspname IN ('operator', 'auth')
         ORDER BY n.nspname, c.relname`,
      )
    ).rows;
    assert.deepEqual(duplicateRegistry, [{table_name: 'tenant_membership', schema_name: 'auth'}]);

    const schemaOwner = (
      await db.adminQuery(`SELECT nspowner::regrole::text AS owner FROM pg_namespace WHERE nspname = 'auth'`)
    ).rows[0].owner;
    assert.equal(schemaOwner, db.roles.migrator);

    const relationOwners = (
      await db.adminQuery(
        `SELECT c.relkind, c.relowner::regrole::text AS owner
         FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
         WHERE n.nspname = 'auth' AND c.relkind IN ('r', 'i', 'S')`,
      )
    ).rows;
    assert.ok(relationOwners.length > 0);
    assert.ok(
      relationOwners.every(row => row.owner === db.roles.migrator),
      'All auth relations and sequences must be owned by the offline migrator',
    );

    const functionOwners = (
      await db.adminQuery(
        `SELECT p.proname, p.proowner::regrole::text AS owner
         FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
         WHERE n.nspname = 'auth'`,
      )
    ).rows;
    assert.ok(functionOwners.length > 0);
    assert.ok(
      functionOwners.every(row => row.owner === db.roles.migrator),
      'All auth functions must be owned by the offline migrator',
    );

    const runtimeOids = (
      await db.adminQuery('SELECT oid FROM pg_roles WHERE rolname = ANY($1)', [[...db.runtimeRoles, ...db.runtimeLogins]])
    ).rows.map(row => row.oid);
    const runtimeRelations = (
      await db.adminQuery(
        `SELECT count(*)::int AS n
         FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
         WHERE n.nspname = 'auth' AND c.relowner = ANY($1::oid[])`,
        [runtimeOids],
      )
    ).rows[0].n;
    assert.equal(runtimeRelations, 0, 'Runtime roles/logins must not own auth relations');
    const runtimeFunctions = (
      await db.adminQuery(
        `SELECT count(*)::int AS n
         FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
         WHERE n.nspname = 'auth' AND p.proowner = ANY($1::oid[])`,
        [runtimeOids],
      )
    ).rows[0].n;
    assert.equal(runtimeFunctions, 0, 'Runtime roles/logins must not own auth functions');

    for (const role of [...db.runtimeRoles, ...db.runtimeLogins]) {
      for (const targetKey of ['migrator', 'authDefiner', 'operatorDefiner']) {
        const allowed = (
          await db.adminQuery('SELECT pg_has_role($1, $2, $3) AS allowed', [role, db.roles[targetKey], 'SET'])
        ).rows[0].allowed;
        assert.equal(allowed, false, `${role} must not be able to SET ROLE ${db.roles[targetKey]}`);
      }
    }
    await assert.rejects(
      () => db.asLogin('authService', client => client.query(`SET ROLE ${quoteRole(db.roles.migrator)}`)),
      /permission denied|must be member/,
    );
    await assert.rejects(
      () => db.asRole('authService', client => client.query('ALTER TABLE auth.users ADD COLUMN probe integer')),
      /permission denied|must be owner/,
    );
    await assert.rejects(
      () => db.asRole('authService', client => client.query('DROP TABLE auth.users')),
      /permission denied|must be owner/,
    );

    const rlsState = (
      await db.adminQuery(
        `SELECT c.relname, c.relrowsecurity
         FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
         WHERE n.nspname = 'auth' AND c.relkind = 'r' ORDER BY c.relname`,
      )
    ).rows;
    assert.ok(
      rlsState.every(row => row.relrowsecurity === false),
      'AUTH-001 creates no RLS; tenant isolation policies belong to PIVOT-004',
    );

    const floatingColumns = (
      await db.adminQuery(
        `SELECT table_name, column_name
         FROM information_schema.columns
         WHERE table_schema = 'auth' AND data_type IN ('real', 'double precision')`,
      )
    ).rows;
    assert.deepEqual(floatingColumns, []);
  });
});

test('AUTH-001 stores only digests, ciphertext and versioned verifiers', async () => {
  await withAuthDatabase(async db => {
    const columns = (
      await db.adminQuery(
        `SELECT table_name, column_name
         FROM information_schema.columns
         WHERE table_schema = 'auth' ORDER BY table_name, column_name`,
      )
    ).rows;
    const forbiddenPlaintext = {
      users: ['password'],
      sessions: ['token'],
      verification: ['value', 'token'],
      two_factor: ['secret', 'seed'],
      recovery_codes: ['code'],
      oauth_state: ['state', 'nonce', 'code_verifier'],
      accounts: ['access_token', 'refresh_token', 'id_token'],
    };
    for (const [table, names] of Object.entries(forbiddenPlaintext)) {
      const present = columns
        .filter(row => row.table_name === table && names.includes(row.column_name))
        .map(row => row.column_name);
      assert.deepEqual(present, [], `auth.${table} must not persist plaintext ${names.join('/')}`);
    }

    const required = [
      ['users', 'password_hash'],
      ['users', 'password_scheme'],
      ['users', 'credential_version'],
      ['users', 'legacy_id'],
      ['sessions', 'token_hash'],
      ['sessions', 'idle_expires_at'],
      ['sessions', 'absolute_expires_at'],
      ['sessions', 'selected_membership_id'],
      ['sessions', 'membership_epoch'],
      ['verification', 'value_hash'],
      ['two_factor', 'secret_ciphertext'],
      ['two_factor', 'secret_key_version'],
      ['two_factor', 'last_used_step'],
      ['recovery_codes', 'code_hash'],
      ['recovery_codes', 'hash_key_version'],
      ['oauth_state', 'state_hash'],
      ['oauth_state', 'nonce_hash'],
      ['oauth_state', 'code_verifier_ciphertext'],
      ['auth_audit', 'event_type'],
      ['auth_audit', 'outcome'],
      ['tenant_membership', 'membership_epoch'],
    ];
    const present = new Set(columns.map(row => `${row.table_name}.${row.column_name}`));
    for (const [table, column] of required) {
      assert.ok(present.has(`${table}.${column}`), `auth.${table}.${column} must exist`);
    }
    assert.equal(present.has('users.tenant_id'), false, 'identity is global; membership owns tenant admission');
  });
});

test('AUTH-001 privileges deny customer, operator and destructive auth-service access', async () => {
  await withAuthDatabase(async db => {
    const schemaPrivilege = async (role, privilege) => (
      await db.adminQuery('SELECT has_schema_privilege($1, $2, $3) AS allowed', [role, 'auth', privilege])
    ).rows[0].allowed;
    const tablePrivilege = async (role, table, privilege) => (
      await db.adminQuery('SELECT has_table_privilege($1, $2, $3) AS allowed', [role, `auth.${table}`, privilege])
    ).rows[0].allowed;

    for (const role of [db.roles.customerApp, db.roles.operatorRead, db.roles.operatorAdmin, db.roles.operatorDefiner]) {
      assert.equal(await schemaPrivilege(role, 'USAGE'), false);
      for (const table of authTables) {
        assert.equal(await tablePrivilege(role, table, 'SELECT'), false, `${role} must not read auth.${table}`);
        assert.equal(await tablePrivilege(role, table, 'INSERT'), false, `${role} must not write auth.${table}`);
      }
    }
    assert.equal(await schemaPrivilege(db.roles.authService, 'USAGE'), true);
    assert.equal(await schemaPrivilege(db.roles.authService, 'CREATE'), false);
    assert.equal(await schemaPrivilege(db.roles.authDefiner, 'USAGE'), true);
    for (const table of authTables) {
      assert.equal(await tablePrivilege(db.roles.authService, table, 'DELETE'), false, `auth service must not DELETE auth.${table}`);
      assert.equal(await tablePrivilege(db.roles.authService, table, 'TRUNCATE'), false, `auth service must not TRUNCATE auth.${table}`);
    }
    assert.equal(await tablePrivilege(db.roles.authService, 'sessions', 'UPDATE'), true);
    assert.equal(await tablePrivilege(db.roles.authService, 'auth_audit', 'INSERT'), true);
    assert.equal(await tablePrivilege(db.roles.authService, 'auth_audit', 'UPDATE'), false);
    assert.equal(await tablePrivilege(db.roles.authService, 'roles', 'INSERT'), false);
    assert.equal(await tablePrivilege(db.roles.authService, 'reference_value', 'INSERT'), false);

    await assert.rejects(
      () => db.asRole('customerApp', client => client.query('SELECT count(*) FROM auth.users')),
      /permission denied for schema auth/,
    );
    await assert.rejects(
      () => db.asRole('operatorAdmin', client => client.query('SELECT count(*) FROM auth.users')),
      /permission denied for schema auth/,
    );
    await assert.rejects(
      () => db.asRole('authService', client => client.query(`INSERT INTO auth.reference_value(domain, value, label) VALUES('probe', 'probe', 'Probe')`)),
      /permission denied/,
    );
    await db.asRole('authService', async client => {
      await assert.rejects(() => client.query('DELETE FROM auth.users'), /permission denied/);
    });
    await db.asRole('authService', async client => {
      await assert.rejects(() => client.query('TRUNCATE auth.sessions'), /permission denied/);
    });
    await db.asRole('authService', async client => {
      await assert.rejects(() => client.query('UPDATE auth.auth_audit SET outcome = $1', ['failure']), /permission denied/);
    });
  });
});

test('AUTH-001 append-only audit rejects mutation even for the owner', async () => {
  await withAuthDatabase(async db => {
    await db.asRole('authService', client => client.query(
      `INSERT INTO auth.auth_audit(event_type, outcome, request_id, detail_jsonb)
       VALUES('login_failure', 'failure', 'req-1', '{"reason":"unknown_user"}'::jsonb)`,
    ), {commit: true});

    const immutableStatements = [
      ['UPDATE auth.auth_audit SET outcome = $1', ['success']],
      ['DELETE FROM auth.auth_audit', []],
      ['TRUNCATE auth.auth_audit', []],
    ];
    for (const [sql, params] of immutableStatements) {
      await db.asRole('migrator', async client => {
        await assert.rejects(() => client.query(sql, params), /AUTH_RECORD_IMMUTABLE/);
      });
      await db.asRole('authService', async client => {
        await assert.rejects(() => client.query(sql, params), /AUTH_RECORD_IMMUTABLE|permission denied/);
      });
    }
    const count = await db.asRole('authService', client => (
      client.query(`SELECT count(*)::int AS n FROM auth.auth_audit WHERE event_type = 'login_failure'`)
    )).then(result => result.rows[0].n);
    assert.equal(count, 1);
  });
});

test('AUTH-001 identity, membership and credential uniqueness hold', async () => {
  await withAuthDatabase(async db => {
    const userId = randomUUID();
    const otherUserId = randomUUID();
    await db.asRole('authService', async client => {
      await client.query(
        `INSERT INTO auth.users(id, legacy_id, email, password_hash, password_scheme, password_updated_at)
         VALUES($1, 'native-user-1', 'Owner@Example.com', $2, 'scrypt', now())`,
        [userId, scryptHash],
      );
      await client.query(
        `INSERT INTO auth.users(id, email, password_hash, password_scheme, password_updated_at)
         VALUES($1, 'second@example.com', $2, 'argon2id', now())`,
        [otherUserId, argon2Hash],
      );
      await client.query(
        `INSERT INTO auth.tenant_membership(tenant_id, user_id, role_id, status, invited_at, accepted_at, invited_by)
         VALUES($1, $2, 'tenant_admin', 'active', now(), now(), 'owner-1')`,
        [tenantId, userId],
      );
      await client.query(
        `INSERT INTO auth.accounts(user_id, provider_id, account_id, is_primary)
         VALUES($1, 'generic_oauth', 'subject-1', true)`,
        [userId],
      );
    }, {commit: true});

    await assert.rejects(
      () => db.asRole('authService', client => client.query(
        `INSERT INTO auth.users(email, password_hash, password_scheme, password_updated_at)
         VALUES('owner@example.com', $1, 'scrypt', now())`,
        [scryptHash],
      )),
      /duplicate key value violates unique constraint/,
    );
    await assert.rejects(
      () => db.asRole('authService', client => client.query(
        `INSERT INTO auth.users(legacy_id, email) VALUES('native-user-1', 'unique@example.com')`,
      )),
      /duplicate key value violates unique constraint/,
    );
    await assert.rejects(
      () => db.asRole('authService', client => client.query(
        `INSERT INTO auth.tenant_membership(tenant_id, user_id, role_id, status)
         VALUES($1, $2, 'member', 'active')`,
        [tenantId, userId],
      )),
      /duplicate key value violates unique constraint/,
    );
    await assert.rejects(
      () => db.asRole('authService', client => client.query(
        `INSERT INTO auth.accounts(user_id, provider_id, account_id) VALUES($1, 'generic_oauth', 'subject-1')`,
        [otherUserId],
      )),
      /duplicate key value violates unique constraint/,
    );
    await assert.rejects(
      () => db.asRole('authService', client => client.query(
        `INSERT INTO auth.users(email, password_hash) VALUES('no-scheme@example.com', $1)`,
        [scryptHash],
      )),
      /violates check constraint/,
    );

    // Retained scrypt verifiers stay verifiable, and an unknown future scheme is
    // data, not a schema change: the reference domain is not a CHECK list.
    const schemes = await db.asRole('authService', client => client.query(
      `SELECT email, password_scheme FROM auth.users WHERE password_scheme IS NOT NULL ORDER BY email`,
    )).then(result => result.rows);
    assert.deepEqual(schemes, [
      {email: 'Owner@Example.com', password_scheme: 'scrypt'},
      {email: 'second@example.com', password_scheme: 'argon2id'},
    ]);
    await db.asRole('authService', client => client.query(
      `INSERT INTO auth.users(email, password_hash, password_scheme, password_updated_at)
       VALUES('future@example.com', $1, 'future_scheme_v2', now())`,
      [scryptHash],
    ), {commit: true});

    const legacy = await db.asRole('authService', client => client.query(
      `SELECT length(legacy_id) AS legacy_length, email_verified FROM auth.users WHERE legacy_id = 'native-user-1'`,
    )).then(result => result.rows[0]);
    assert.deepEqual(legacy, {legacy_length: 13, email_verified: false});
  });
});

test('AUTH-001 sessions persist only token digests and never extend the absolute ceiling', async () => {
  await withAuthDatabase(async db => {
    const userId = randomUUID();
    const membershipId = randomUUID();
    const sessionId = randomUUID();
    const tokenHash = hex64('session-token-one');
    const csrfHash = hex64('csrf-token-one');
    await db.asRole('authService', async client => {
      await client.query(`INSERT INTO auth.users(id, email) VALUES($1, 'session@example.com')`, [userId]);
      await client.query(
        `INSERT INTO auth.tenant_membership(id, tenant_id, user_id, role_id, status, invited_at, accepted_at)
         VALUES($1, $2, $3, 'member', 'active', now(), now())`,
        [membershipId, tenantId, userId],
      );
      await client.query(
        `INSERT INTO auth.sessions(
           id, user_id, token_hash, realm, role_id, selected_membership_id, selected_tenant_id,
           membership_epoch, csrf_token_hash, credential_version, idle_expires_at, absolute_expires_at)
         VALUES($1, $2, $3, 'customer', 'member', $4, $5, 1, $6, 1, now() + interval '30 days', now() + interval '90 days')`,
        [sessionId, userId, tokenHash, membershipId, tenantId, csrfHash],
      );
    }, {commit: true});

    const stored = await db.asRole('authService', client => client.query(
      `SELECT token_hash, csrf_token_hash, realm, assurance_level, selected_tenant_id::text AS tenant
       FROM auth.sessions WHERE id = $1`,
      [sessionId],
    )).then(result => result.rows[0]);
    assert.deepEqual(stored, {
      token_hash: tokenHash,
      csrf_token_hash: csrfHash,
      realm: 'customer',
      assurance_level: 'single_factor',
      tenant: tenantId,
    });
    assert.equal(stored.token_hash.includes('session-token-one'), false, 'no plaintext token may reach the table');

    // A raw opaque token (base64url, not a 64-char hex digest) is refused.
    await assert.rejects(
      () => db.asRole('authService', client => client.query(
        `INSERT INTO auth.sessions(user_id, token_hash, credential_version, idle_expires_at, absolute_expires_at)
         VALUES($1, 'raw-opaque-session-token-abcdefghijklmnop', 1, now() + interval '1 day', now() + interval '2 days')`,
        [userId],
      )),
      /violates check constraint/,
    );
    await assert.rejects(
      () => db.asRole('authService', client => client.query(
        `INSERT INTO auth.sessions(user_id, token_hash, credential_version, idle_expires_at, absolute_expires_at)
         VALUES($1, $2, 1, now() + interval '4 days', now() + interval '3 days')`,
        [userId, hex64('session-token-two')],
      )),
      /violates check constraint/,
    );
    await assert.rejects(
      () => db.asRole('authService', client => client.query(
        `INSERT INTO auth.sessions(user_id, token_hash, credential_version, selected_tenant_id, idle_expires_at, absolute_expires_at)
         VALUES($1, $2, 1, $3, now() + interval '1 day', now() + interval '2 days')`,
        [userId, hex64('session-token-three'), tenantId],
      )),
      /violates check constraint/,
    );

    // Activity may extend idle expiry but the absolute ceiling is immutable.
    await assert.rejects(
      () => db.asRole('authService', client => client.query(
        `UPDATE auth.sessions SET absolute_expires_at = absolute_expires_at + interval '1 day' WHERE id = $1`,
        [sessionId],
      )),
      /AUTH_SESSION_ABSOLUTE_EXPIRY_IMMUTABLE/,
    );
    await assert.rejects(
      () => db.asRole('migrator', client => client.query(
        `UPDATE auth.sessions SET absolute_expires_at = absolute_expires_at + interval '1 day' WHERE id = $1`,
        [sessionId],
      )),
      /AUTH_SESSION_ABSOLUTE_EXPIRY_IMMUTABLE/,
    );
    const refreshed = await db.asRole('authService', client => client.query(
      `UPDATE auth.sessions
       SET last_seen_at = now(), idle_expires_at = absolute_expires_at
       WHERE id = $1 AND revoked_at IS NULL
       RETURNING round(extract(epoch FROM (absolute_expires_at - idle_expires_at)))::int AS headroom`,
      [sessionId],
    )).then(result => result.rows[0]);
    assert.deepEqual(refreshed, {headroom: 0});

    const revoked = await db.asRole('authService', client => client.query(
      `UPDATE auth.sessions SET revoked_at = now(), revoked_reason = 'logout'
       WHERE token_hash = $1 AND revoked_at IS NULL RETURNING id`,
      [tokenHash],
    ), {commit: true});
    assert.equal(revoked.rowCount, 1);
    const secondRevoke = await db.asRole('authService', client => client.query(
      `UPDATE auth.sessions SET revoked_at = now(), revoked_reason = 'logout'
       WHERE token_hash = $1 AND revoked_at IS NULL RETURNING id`,
      [tokenHash],
    ), {commit: true});
    assert.equal(secondRevoke.rowCount, 0, 'revocation must be idempotent, not silently repeated');
  });
});

test('AUTH-001 verification, recovery and OAuth tokens are single-use and hash-only', async () => {
  await withAuthDatabase(async db => {
    const userId = randomUUID();
    const verificationHash = hex64('verification-token');
    const recoveryHash = hex64('recovery-code');
    const stateHash = hex64('oauth-state');
    await db.asRole('authService', async client => {
      await client.query(`INSERT INTO auth.users(id, email) VALUES($1, 'single-use@example.com')`, [userId]);
      await client.query(
        `INSERT INTO auth.verification(user_id, identifier, purpose, value_hash, expires_at)
         VALUES($1, 'single-use@example.com', 'password_reset', $2, now() + interval '30 minutes')`,
        [userId, verificationHash],
      );
      await client.query(
        `INSERT INTO auth.recovery_codes(user_id, code_hash, hash_key_version, batch_id)
         VALUES($1, $2, 1, $3)`,
        [userId, recoveryHash, randomUUID()],
      );
      await client.query(
        `INSERT INTO auth.oauth_state(provider_id, purpose, state_hash, nonce_hash, expires_at)
         VALUES('generic_oauth', 'login', $1, $2, now() + interval '10 minutes')`,
        [stateHash, hex64('oauth-nonce')],
      );
    }, {commit: true});

    const consumeVerification = () => db.asRole('authService', client => client.query(
      `UPDATE auth.verification SET consumed_at = now()
       WHERE value_hash = $1 AND consumed_at IS NULL AND expires_at > now() RETURNING id`,
      [verificationHash],
    ), {commit: true}).then(result => result.rowCount);
    assert.equal(await consumeVerification(), 1);
    assert.equal(await consumeVerification(), 0, 'a verification token must be single-use');

    const consumeRecovery = () => db.asRole('authService', client => client.query(
      `UPDATE auth.recovery_codes SET used_at = now()
       WHERE user_id = $1 AND code_hash = $2 AND used_at IS NULL RETURNING id`,
      [userId, recoveryHash],
    ), {commit: true}).then(result => result.rowCount);
    assert.equal(await consumeRecovery(), 1);
    assert.equal(await consumeRecovery(), 0, 'a recovery code must be single-use');

    const consumeState = () => db.asRole('authService', client => client.query(
      `UPDATE auth.oauth_state SET consumed_at = now()
       WHERE state_hash = $1 AND consumed_at IS NULL AND expires_at > now() RETURNING id`,
      [stateHash],
    ), {commit: true}).then(result => result.rowCount);
    assert.equal(await consumeState(), 1);
    assert.equal(await consumeState(), 0, 'an OAuth state row must be single-use');

    await assert.rejects(
      () => db.asRole('authService', client => client.query(
        `INSERT INTO auth.verification(identifier, purpose, value_hash, expires_at)
         VALUES('plain@example.com', 'email_verification', 'plaintext-token-value', now() + interval '1 hour')`,
      )),
      /violates check constraint/,
    );
    await assert.rejects(
      () => db.asRole('authService', client => client.query(
        `INSERT INTO auth.oauth_state(provider_id, state_hash, expires_at)
         VALUES('generic_oauth', $1, now() + interval '1 minute')`,
        [hex64('oauth-state')],
      )),
      /duplicate key value violates unique constraint/,
    );
  });
});

test('AUTH-001 PKCE ciphertext requires a positive key version', async () => {
  await withAuthDatabase(async db => {
    const constraint = (
      await db.adminQuery(
        `SELECT convalidated, pg_get_constraintdef(oid) AS definition
         FROM pg_constraint
         WHERE conname = 'oauth_state_pkce_key_binding_chk'
           AND conrelid = 'auth.oauth_state'::regclass`,
      )
    ).rows[0];
    assert.ok(constraint, 'the additive AUTH-001-R1 key-binding constraint must exist');
    assert.equal(constraint.convalidated, true, 'the key-binding constraint must be validated, not left NOT VALID');
    assert.match(constraint.definition, /code_verifier_key_version IS NOT NULL/);
    assert.match(constraint.definition, /code_verifier_key_version > 0/);
    assert.match(constraint.definition, /code_verifier_ciphertext IS NULL/);

    const insertState = (hashSeed, ciphertext, keyVersion) => db.asRole('authService', client => client.query(
      `INSERT INTO auth.oauth_state(
         provider_id, purpose, state_hash, code_verifier_ciphertext, code_verifier_key_version, expires_at)
       VALUES('generic_oauth', 'login', $1, $2, $3, now() + interval '10 minutes')`,
      [hex64(hashSeed), ciphertext, keyVersion],
    ), {commit: true});

    for (const [label, version] of [['null', null], ['zero', 0], ['negative', -1]]) {
      await assert.rejects(
        () => insertState('pkce-bad-' + label, 'envelope-ciphertext-value', version),
        /violates check constraint/,
        `a ${label} key version must not carry a PKCE ciphertext`,
      );
    }

    // Valid optional row (no PKCE verifier at all) and valid encrypted row.
    await insertState('pkce-none', null, null);
    await insertState('pkce-good', 'envelope-ciphertext-value', 1);

    const optionalRow = await db.asRole('authService', client => client.query(
      `SELECT id FROM auth.oauth_state WHERE state_hash = $1`,
      [hex64('pkce-none')],
    )).then(result => result.rows[0]);
    const encryptedRow = await db.asRole('authService', client => client.query(
      `SELECT id FROM auth.oauth_state WHERE state_hash = $1`,
      [hex64('pkce-good')],
    )).then(result => result.rows[0]);

    // UPDATE path: adding ciphertext without a key binding, or clearing the key
    // binding of an encrypted verifier, is refused.
    await assert.rejects(
      () => db.asRole('authService', client => client.query(
        `UPDATE auth.oauth_state SET code_verifier_ciphertext = 'envelope-ciphertext-value' WHERE id = $1`,
        [optionalRow.id],
      )),
      /violates check constraint/,
    );
    await assert.rejects(
      () => db.asRole('authService', client => client.query(
        `UPDATE auth.oauth_state SET code_verifier_key_version = NULL WHERE id = $1`,
        [encryptedRow.id],
      )),
      /violates check constraint/,
    );
    await assert.rejects(
      () => db.asRole('authService', client => client.query(
        `UPDATE auth.oauth_state SET code_verifier_key_version = 0 WHERE id = $1`,
        [encryptedRow.id],
      )),
      /violates check constraint/,
    );

    const bound = await db.asRole('authService', client => client.query(
      `UPDATE auth.oauth_state
       SET code_verifier_ciphertext = 'envelope-ciphertext-value', code_verifier_key_version = 2
       WHERE id = $1
       RETURNING code_verifier_key_version`,
      [optionalRow.id],
    ), {commit: true});
    assert.deepEqual(bound.rows, [{code_verifier_key_version: 2}]);

    // VALIDATE refuses invalid pre-existing rows and never repairs them. A
    // rolled-back probe table proves that behaviour without touching auth state.
    await assert.rejects(
      () => db.asRole('migrator', async client => {
        await client.query(
          `CREATE TABLE auth.oauth_state_validation_probe (
             code_verifier_ciphertext text,
             code_verifier_key_version integer)`,
        );
        // Pre-existing invalid row, then a NOT VALID constraint (no scan), then an
        // explicit VALIDATE that must refuse the row rather than repair it.
        await client.query(
          `INSERT INTO auth.oauth_state_validation_probe VALUES ('envelope-ciphertext-value', NULL)` ,
        );
        await client.query(
          `ALTER TABLE auth.oauth_state_validation_probe
             ADD CONSTRAINT probe_pkce_key_binding
             CHECK (code_verifier_ciphertext IS NULL OR (code_verifier_key_version IS NOT NULL AND code_verifier_key_version > 0))
             NOT VALID`,
        );
        await client.query(
          `ALTER TABLE auth.oauth_state_validation_probe VALIDATE CONSTRAINT probe_pkce_key_binding`,
        );
      }),
      /violated by some row/,
    );
    const probe = await db.adminQuery(
      `SELECT count(*)::int AS n
       FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'auth' AND c.relname = 'oauth_state_validation_probe'`,
    ).then(result => result.rows[0].n);
    assert.equal(probe, 0, 'the validation probe transaction must roll back');
  });
});

test('AUTH-001 second factors keep encrypted seeds and one factor per type', async () => {
  await withAuthDatabase(async db => {
    const userId = randomUUID();
    await db.asRole('authService', async client => {
      await client.query(`INSERT INTO auth.users(id, email) VALUES($1, 'mfa@example.com')`, [userId]);
      await client.query(
        `INSERT INTO auth.two_factor(user_id, factor_type, secret_ciphertext, secret_key_version)
         VALUES($1, 'totp', 'v1.base64-nonce-and-ciphertext-envelope', 1)`,
        [userId],
      );
    }, {commit: true});

    const factor = await db.asRole('authService', client => client.query(
      `SELECT factor_type, secret_algorithm, secret_key_version, verified_at, last_used_step
       FROM auth.two_factor WHERE user_id = $1`,
      [userId],
    )).then(result => result.rows[0]);
    assert.deepEqual(factor, {
      factor_type: 'totp',
      secret_algorithm: 'aes_256_gcm',
      secret_key_version: 1,
      verified_at: null,
      last_used_step: null,
    });
    await assert.rejects(
      () => db.asRole('authService', client => client.query(
        `INSERT INTO auth.two_factor(user_id, factor_type, secret_ciphertext, secret_key_version)
         VALUES($1, 'totp', 'second-envelope-ciphertext', 1)`,
        [userId],
      )),
      /duplicate key value violates unique constraint/,
    );
    await assert.rejects(
      () => db.asRole('authService', client => client.query(
        `INSERT INTO auth.two_factor(user_id, factor_type, secret_ciphertext, secret_key_version)
         VALUES($1, 'totp', 'zero-key-envelope-ciphertext', 0)`,
        [userId],
      )),
      /violates check constraint/,
    );
  });
});

test('AUTH-001 audit supports independent failure durability and atomic success', async () => {
  await withAuthDatabase(async db => {
    // The fixture owns BEGIN/ROLLBACK. The action proves both rows exist inside the
    // transaction and the fixture then rolls the whole transaction back. Nothing is
    // suppressed: any unexpected INSERT or assertion failure rethrows and fails the
    // test instead of yielding a false green.
    const inTransaction = await db.asRole('authService', async client => {
      await client.query(`INSERT INTO auth.users(email) VALUES('atomic@example.com')`);
      await client.query(
        `INSERT INTO auth.auth_audit(event_type, outcome, request_id) VALUES('login_success', 'success', 'req-atomic')`,
      );
      const inside = await client.query(`SELECT
        (SELECT count(*)::int FROM auth.users WHERE email = 'atomic@example.com') AS users,
        (SELECT count(*)::int FROM auth.auth_audit WHERE request_id = 'req-atomic') AS audits`);
      assert.deepEqual(inside.rows[0], {users: 1, audits: 1}, 'both rows must exist inside the rolled-back transaction');
      return inside.rows[0];
    });
    assert.deepEqual(inTransaction, {users: 1, audits: 1});

    const afterRollback = await db.asRole('authService', client => (
      client.query(`SELECT
        (SELECT count(*)::int FROM auth.users WHERE email = 'atomic@example.com') AS users,
        (SELECT count(*)::int FROM auth.auth_audit WHERE request_id = 'req-atomic') AS audits`)
    )).then(result => result.rows[0]);
    assert.deepEqual(afterRollback, {users: 0, audits: 0}, 'the fixture rollback must leave neither the transition nor its audit row');

    // An explicit, expected mid-transaction failure must surface as that failure and
    // persist nothing. Only the intended error is accepted by this assertion.
    await assert.rejects(
      () => db.asRole('authService', async client => {
        await client.query(`INSERT INTO auth.users(email) VALUES('expected-failure@example.com')`);
        await client.query(`INSERT INTO auth.auth_audit(event_type, outcome, request_id)
          VALUES('login_success', 'success', 'req-expected-failure')`);
        await client.query('SELECT 1 / 0');
      }),
      (error) => {
        assert.match(error.message, /division by zero/);
        return true;
      },
    );
    const afterFailure = await db.asRole('authService', client => (
      client.query(`SELECT
        (SELECT count(*)::int FROM auth.users WHERE email = 'expected-failure@example.com') AS users,
        (SELECT count(*)::int FROM auth.auth_audit WHERE request_id = 'req-expected-failure') AS audits`)
    )).then(result => result.rows[0]);
    assert.deepEqual(afterFailure, {users: 0, audits: 0}, 'an aborted transition must persist neither row');

    // A failed login is recorded on its own durable path even when business work rolls back.
    await db.asRole('authService', async client => {
      await client.query(
        `INSERT INTO auth.auth_audit(event_type, outcome, request_id) VALUES('login_failure', 'failure', 'req-fail')`,
      );
    }, {commit: true});
    const failed = await db.asRole('authService', client => (
      client.query(`SELECT outcome FROM auth.auth_audit WHERE request_id = 'req-fail'`)
    )).then(result => result.rows);
    assert.deepEqual(failed, [{outcome: 'failure'}]);
  });
});

test('AUTH-001 reference data and assurance roles are extensible rows', async () => {
  await withAuthDatabase(async db => {
    const roles = await db.asRole('authService', client => (
      client.query(`SELECT role_id, assurance_class, requires_mfa, is_operator FROM auth.roles ORDER BY role_id`)
    )).then(result => result.rows);
    assert.deepEqual(roles, [
      {role_id: 'member', assurance_class: 'single_factor', requires_mfa: false, is_operator: false},
      {role_id: 'operator_admin', assurance_class: 'access_asserted', requires_mfa: true, is_operator: true},
      {role_id: 'tenant_admin', assurance_class: 'mfa_verified', requires_mfa: true, is_operator: false},
      {role_id: 'ultimate_owner', assurance_class: 'mfa_verified', requires_mfa: true, is_operator: false},
    ]);

    const domains = await db.asRole('authService', client => (
      client.query(`SELECT domain, count(*)::int AS n FROM auth.reference_value GROUP BY domain ORDER BY domain`)
    )).then(result => result.rows);
    const byDomain = Object.fromEntries(domains.map(row => [row.domain, row.n]));
    for (const domain of [
      'assurance_level',
      'audit_outcome',
      'auth_event_type',
      'membership_status',
      'session_revocation_reason',
      'token_purpose',
    ]) {
      assert.ok(byDomain[domain] > 0, `${domain} must be seeded as reference data`);
    }
    const eventTypes = await db.asRole('authService', client => (
      client.query(`SELECT value FROM auth.reference_value WHERE domain = 'auth_event_type' ORDER BY value`)
    )).then(result => result.rows.map(row => row.value));
    for (const eventType of [
      'login_success',
      'login_failure',
      'logout',
      'mfa_enrolled',
      'mfa_verified',
      'mfa_disabled',
      'password_changed',
      'password_reset_requested',
      'password_reset_completed',
      'session_revoked',
      'sessions_revoked_all',
      'role_changed',
      'membership_invited',
      'membership_accepted',
    ]) {
      assert.ok(eventTypes.includes(eventType), `${eventType} must be a declared auth event type`);
    }

    // A new growing value is a row, not a migration or a code constant.
    await db.asRole('migrator', client => client.query(
      `INSERT INTO auth.reference_value(domain, value, label) VALUES('auth_event_type', 'step_up_verified', 'Step-up verified')`,
    ), {commit: true});
    await db.asRole('migrator', client => client.query(
      `INSERT INTO auth.roles(role_id, label, assurance_class, requires_mfa) VALUES('security_auditor', 'Security auditor', 'mfa_verified', true)`,
    ), {commit: true});
    const extended = await db.asRole('authService', client => (
      client.query(`SELECT count(*)::int AS n FROM auth.roles WHERE role_id = 'security_auditor'`)
    )).then(result => result.rows[0].n);
    assert.equal(extended, 1);
  });
});

test('AUTH-001 fixture refuses pre-existing cluster roles before mutation', async () => {
  const suffix = suffixFor('refuse');
  const names = authRoleNamesForSuffix(suffix);
  const allRoles = generatedAuthRoleNames(names);
  const cluster = await connectAuthClusterAdmin();
  let created = false;
  try {
    await cluster.query(
      `CREATE ROLE ${quoteRole(names.authService)} NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS NOREPLICATION`,
    );
    created = true;
    const before = (
      await cluster.query(
        'SELECT rolname, rolsuper, rolbypassrls, rolcreatedb, rolcreaterole, rolcanlogin, rolinherit, rolreplication FROM pg_roles WHERE rolname = $1',
        [names.authService],
      )
    ).rows[0];
    await assert.rejects(
      () => withAuthDatabase({namespaceSuffix: suffix}, async () => {
        throw new Error('fixture callback must not run after a pre-flight refusal');
      }),
      /pre-flight refused/i,
    );
    const after = (
      await cluster.query(
        'SELECT rolname, rolsuper, rolbypassrls, rolcreatedb, rolcreaterole, rolcanlogin, rolinherit, rolreplication FROM pg_roles WHERE rolname = $1',
        [names.authService],
      )
    ).rows[0];
    assert.deepEqual(after, before, 'pre-existing role attributes must remain unchanged');
    const database = await cluster.query('SELECT datname FROM pg_database WHERE datname = $1', [names.database]);
    assert.equal(database.rowCount, 0, 'pre-flight refusal must not create the disposable database');
    const otherRoles = await cluster.query(
      'SELECT rolname FROM pg_roles WHERE rolname = ANY($1) AND rolname <> $2',
      [allRoles, names.authService],
    );
    assert.equal(otherRoles.rowCount, 0, 'pre-flight refusal must not create any other fixture role');
  } finally {
    if (created) await cluster.query(`DROP ROLE IF EXISTS ${quoteRole(names.authService)}`);
    await cluster.end();
  }
});

test('AUTH-001 checked-in role bootstrap refuses incompatible pre-existing roles atomically', async () => {
  const suffix = suffixFor('boot');
  const names = authRoleNamesForSuffix(suffix);
  const targetNames = authTargetRoleKeys.map(key => names[key]);
  const unrelated = names.database + '_unrelated';
  const tempLogin = names.database + '_bootstrap_login';
  const bootstrapSql = await authRoleBootstrapSql(names);
  const cluster = await connectAuthClusterAdmin();
  let databaseAdmin;
  let primaryError = null;
  try {
    await cluster.query(`CREATE DATABASE ${quoteRole(names.database)}`);
    databaseAdmin = await connectAuthDatabaseAdmin(names.database);
    await cluster.query(
      `CREATE ROLE ${quoteRole(names.authService)} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS NOREPLICATION`,
    );
    await cluster.query(
      `CREATE ROLE ${quoteRole(unrelated)} NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS NOREPLICATION`,
    );
    await cluster.query(
      `CREATE ROLE ${quoteRole(tempLogin)} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS NOREPLICATION`,
    );
    await cluster.query(`GRANT ${quoteRole(names.authService)} TO ${quoteRole(tempLogin)}`);

    const watchedRoles = [...targetNames, unrelated, tempLogin];
    const snapshot = async () => ({
      roles: (
        await cluster.query(
          `SELECT rolname, rolcanlogin, rolsuper, rolcreatedb, rolcreaterole, rolinherit, rolbypassrls, rolreplication
           FROM pg_roles WHERE rolname = ANY($1) ORDER BY rolname`,
          [watchedRoles],
        )
      ).rows,
      memberships: (
        await cluster.query(
          `SELECT r.rolname AS member, g.rolname AS granted
           FROM pg_auth_members m
           JOIN pg_roles r ON r.oid = m.member
           JOIN pg_roles g ON g.oid = m.roleid
           WHERE r.rolname = ANY($1) OR g.rolname = ANY($1)
           ORDER BY r.rolname, g.rolname`,
          [watchedRoles],
        )
      ).rows,
    });
    const before = await snapshot();
    await assert.rejects(() => databaseAdmin.query(bootstrapSql), /SAVEN bootstrap refused incompatible/);
    const after = await snapshot();
    assert.deepEqual(after, before, 'refused bootstrap must leave every role and membership unchanged');
    const otherTargets = await cluster.query(
      'SELECT rolname FROM pg_roles WHERE rolname = ANY($1) AND rolname <> $2 ORDER BY rolname',
      [targetNames, names.authService],
    );
    assert.equal(otherTargets.rowCount, 0, 'refused bootstrap must not create any other target role');
  } catch (error) {
    primaryError = error;
  }
  const cleanupErrors = [];
  if (databaseAdmin) await databaseAdmin.end().catch(error => cleanupErrors.push(error));
  await cluster.query(`DROP DATABASE IF EXISTS ${quoteRole(names.database)} WITH (FORCE)`)
    .catch(error => cleanupErrors.push(error));
  for (const role of [tempLogin, unrelated, ...targetNames]) {
    await cluster.query(`DROP ROLE IF EXISTS ${quoteRole(role)}`).catch(error => cleanupErrors.push(error));
  }
  await cluster.end().catch(error => cleanupErrors.push(error));
  // Cleanup failures are surfaced and aggregated with the primary failure; they
  // never leave cluster objects behind while reporting success.
  const combined = combineAuthRunAndCleanupErrors(primaryError, cleanupErrors);
  if (combined) throw combined;
});

test('AUTH-001 fixture namespaces isolate concurrent runs', async () => {
  const suffixA = suffixFor('isoa');
  const suffixB = suffixFor('isob');
  const [a, b] = await Promise.all([
    withAuthDatabase({namespaceSuffix: suffixA}, async db => ({
      database: db.database,
      authService: db.roles.authService,
      current: (await db.asRole('authService', client => client.query('SELECT current_database() AS db'))).rows[0].db,
    })),
    withAuthDatabase({namespaceSuffix: suffixB}, async db => ({
      database: db.database,
      authService: db.roles.authService,
      current: (await db.asRole('authService', client => client.query('SELECT current_database() AS db'))).rows[0].db,
    })),
  ]);
  assert.equal(a.database, 'saven_auth_' + suffixA);
  assert.equal(b.database, 'saven_auth_' + suffixB);
  assert.equal(a.current, a.database);
  assert.equal(b.current, b.database);
  assert.notEqual(a.authService, b.authService);
});

test('AUTH-001 fixture reports run and cleanup failures together', () => {
  const runError = new Error('run failed');
  const combined = combineAuthRunAndCleanupErrors(runError, [new Error('cleanup failed')]);
  assert.ok(combined instanceof AggregateError);
  assert.equal(combined.errors[0], runError);
  assert.match(combined.errors[1].message, /cleanup failed/);
  assert.equal(combineAuthRunAndCleanupErrors(runError, []), runError);
  const cleanupOnly = combineAuthRunAndCleanupErrors(null, [new Error('cleanup failed')]);
  assert.match(cleanupOnly.message, /cleanup failed/);
});
