import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash, generateKeyPairSync, randomBytes, sign} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import pg from 'pg';
import {withPivotDatabase, namespaceSql} from './helpers/pg-pivot-fixture.mjs';
import {createSessionStore} from '../src/auth/session-store.mjs';
import {createAccessValidator, createOperatorAccess} from '../src/auth/access.mjs';
import {createOperatorSupportRead} from '../src/operator/support-read.mjs';

const {Pool} = pg;

// PIVOT-007 revision 1. Every test runs against a disposable PostgreSQL cluster
// (SAVEN_PIVOT_TEST_CLUSTER=1) using the real installed roles, RLS and SQL.

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
  'db/postgres/06-operator-identity.sql',
  'db/postgres/50-functions.sql',
];
const fullSchemaFiles = [...schemaFiles, 'db/postgres/migrations/040-posted-immutability.sql'];
const fullAdminSqlFiles = [
  'db/postgres/migrations/031-rls-corrections.sql',
  'db/postgres/migrations/032-rls-hardening.sql',
  'db/postgres/migrations/033-membership-admission-lock.sql',
  'db/postgres/migrations/041-audit.sql',
  'db/postgres/migrations/042-entry-voiding.sql',
  'db/postgres/06-operator-identity.sql',
];

const READ_SQL =
  'SELECT operator.read_tenant_support($1::uuid,$2,$3,$4,$5,$6,$7,$8) AS result';
const DENY_SQL =
  'SELECT operator.log_operator_read_denial($1::uuid,$2,$3,$4,$5,$6,$7,$8)';

const T1 = '11111111-1111-4111-8111-111111111111';
const T2 = '22222222-2222-4222-8222-222222222222';
const U1 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const U2 = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const OP_USER = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const OP_USER_2 = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const SESSION = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const BEARER = 'pivot-007-operator-bearer-token-not-a-real-credential';
const PROOF = createHash('sha256').update(BEARER).digest('hex');
const SUBJECT = 'access-subject-1';
const ISSUER = 'https://saven.cloudflareaccess.com';
const AUDIENCE = 'saven-operator';
const ACTION = 'operator.tenant.read';
const READ_RESOURCES = [
  'business',
  'company_profiles',
  'accounts',
  'journals',
  'journal_lines',
];

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

const asOperator = (db, session, run, options = {}) =>
  db.asRole('operatorRead', async client => {
    if (session !== null && session !== undefined) {
      await client.query('SELECT set_config($1, $2, true)', ['app.operator_session_id', session]);
    }
    return run(client);
  }, options);

async function read(client, overrides = {}) {
  const response = await client.query(READ_SQL, [
    overrides.tenant ?? T1,
    overrides.proof ?? PROOF,
    overrides.resource ?? 'journals',
    overrides.action ?? ACTION,
    overrides.company ?? null,
    overrides.reason ?? 'support case 1',
    overrides.requestId ?? null,
    overrides.limit ?? 200,
  ]);
  return response.rows[0].result;
}

async function seedPolicy(db, {
  policyKey = 'operator_read',
  version = 1,
  issuer = ISSUER,
  audience = AUDIENCE,
  assurance = 'access_mfa',
  maxSourceAge = 300,
  maxSkew = 30,
  active = true,
  effectiveFrom = "now() - interval '1 hour'",
  effectiveTo = 'NULL',
} = {}) {
  await db.adminQuery(`
    INSERT INTO operator.access_read_policy(
      policy_key, version, issuer, audience, required_assurance,
      max_source_age_seconds, max_clock_skew_seconds, is_active,
      effective_from, effective_to)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, ${effectiveFrom}, ${effectiveTo})
  `, [policyKey, version, issuer, audience, assurance, maxSourceAge, maxSkew, active]);
}

async function seedTenant(db, {
  tenant = T1,
  user = U1,
  legacy = 'user-1',
  companies = ['alpha', 'beta'],
  journals = [],
  accounts = [
    ['1000', 'Cash'],
    ['4000', 'Revenue'],
  ],
} = {}) {
  await db.adminQuery(
    `INSERT INTO tenant_data.business(tenant_id, id, state) VALUES ($1::uuid, $2, 'ACTIVE')`,
    [tenant, companies[0]],
  );
  for (const company of companies) {
    await db.adminQuery(`
      INSERT INTO tenant_data.company_profiles(tenant_id, id, name, currency, branch, created_at)
      VALUES ($1::uuid, $2, $3, 'PKR', 'main', 0)
    `, [tenant, company, company.toUpperCase()]);
  }
  for (const [code, title] of accounts) {
    await db.adminQuery(
      'INSERT INTO tenant_data.accounts(tenant_id, code, title) VALUES ($1::uuid, $2, $3)',
      [tenant, code, title],
    );
  }
  await db.adminQuery(
    `INSERT INTO auth.users(id, legacy_id, email, status)
     VALUES ($1::uuid, $2, $3, 'active')`,
    [user, legacy, `${legacy}@example.test`],
  );
  await db.adminQuery(`
    INSERT INTO auth.tenant_membership(tenant_id, user_id, role_id, status, invited_at, accepted_at)
    VALUES ($1::uuid, $2::uuid, 'ultimate_owner', 'active', now(), now())
  `, [tenant, user]);
  await db.adminQuery(
    `INSERT INTO tenant_data.members(tenant_id, user_id, user_uuid, active)
     VALUES ($1::uuid, $2, $3::uuid, true)`,
    [tenant, legacy, user],
  );

  for (const journal of journals) {
    await db.adminQuery(`
      INSERT INTO tenant_data.command_inbox(tenant_id, id, actor, digest, payload, state, created_at)
      VALUES ($1::uuid, $2, $3, $4, '{}', 'POSTED', 0)
    `, [tenant, journal.id, legacy, `digest-${journal.id}`]);
    await db.adminQuery(`
      INSERT INTO tenant_data.journals(tenant_id, id, company, branch, posting_date, narrative)
      VALUES ($1::uuid, $2, $3, 'main', '2026-11-19', $4)
    `, [tenant, journal.id, journal.company, journal.narrative ?? journal.id]);
    for (const [index, line] of journal.lines.entries()) {
      await db.adminQuery(`
        INSERT INTO tenant_data.journal_lines(tenant_id, journal_id, line_no, account, debit, credit)
        VALUES ($1::uuid, $2, $3, $4, $5, $6)
      `, [tenant, journal.id, index + 1, line.account ?? '1000', line.debit ?? 0, line.credit ?? 0]);
    }
  }
}

async function seedOperator(db, {
  subject = SUBJECT,
  session = SESSION,
  user = OP_USER,
  role = 'operator_admin',
  assurance = 'access_mfa',
  issuer = ISSUER,
  audience = AUDIENCE,
  issuedAt = "now() - interval '2 minutes'",
  expiresAt = "now() + interval '30 minutes'",
  tokenProof = PROOF,
} = {}) {
  await db.adminQuery(
    `INSERT INTO auth.users(id, email, status) VALUES ($1::uuid, $2, 'active')`,
    [user, `operator-${subject}@example.test`],
  );
  await db.adminQuery(`
    INSERT INTO operator.access_identity(subject, user_id, email, operator_role_id, assurance_class, status)
    VALUES ($1, $2::uuid, $3, $4, $5, 'active')
  `, [subject, user, `operator-${subject}@example.test`, role, assurance]);
  await db.adminQuery(`
    INSERT INTO auth.sessions(
      id, user_id, token_hash, realm, role_id, assurance_level, credential_version,
      idle_expires_at, absolute_expires_at)
    VALUES ($1::uuid, $2::uuid, $3, 'operator', $4, 'access_asserted', 1,
            now() + interval '1 hour', now() + interval '2 hours')
  `, [session, user, tokenProof, role]);
  await db.adminQuery(`
    INSERT INTO operator.access_session_binding(
      session_id, subject, issuer, audience, mapping_epoch, operator_role_id,
      assurance_class, binding_scheme, source_issued_at, source_expires_at)
    SELECT $1::uuid, $2, $3, $4, mapping_epoch, operator_role_id,
           assurance_class, 'generation-v1', ${issuedAt}, ${expiresAt}
    FROM operator.access_identity WHERE subject = $2
  `, [session, subject, issuer, audience]);
}

async function syncBinding(db, {session = SESSION} = {}) {
  await db.adminQuery(`
    UPDATE operator.access_session_binding b
    SET mapping_epoch = ai.mapping_epoch,
        operator_role_id = ai.operator_role_id,
        assurance_class = ai.assurance_class
    FROM operator.access_identity ai
    WHERE ai.subject = b.subject AND b.session_id = $1::uuid
  `, [session]);
}

async function seedGrant(db, {
  tenant = T1,
  grantId = 'grant-1',
  subject = SUBJECT,
  grantedBy = 'user-1',
  scope = {version: 1, resources: READ_RESOURCES, companies: ['alpha']},
  scopeRaw = null,
  actions = [ACTION],
  actionsRaw = null,
  startsAt = "now() - interval '1 hour'",
  expiresAt = "now() + interval '1 hour'",
  revokedAt = 'NULL',
  active = true,
} = {}) {
  await db.adminQuery(`
    INSERT INTO tenant_data.support_grants(
      tenant_id, grant_id, grantee_actor_id, granted_by_user_id,
      scope_jsonb, actions_jsonb, reason, starts_at, expires_at, revoked_at, is_active)
    VALUES ($1::uuid, $2, $3, $4, $5::jsonb, $6::jsonb, 'support case 1',
            ${startsAt}, ${expiresAt}, ${revokedAt}, $7)
  `, [
    tenant,
    grantId,
    subject,
    grantedBy,
    scopeRaw ?? JSON.stringify(scope),
    actionsRaw ?? JSON.stringify(actions),
    active,
  ]);
}

const auditRows = async db => (await db.adminQuery(`
  SELECT actor_id, action, target_tenant_id::text AS tenant_id, reason, request_id, payload_jsonb
  FROM operator.operator_audit
  ORDER BY id
`)).rows;

const applyFunctionsPayload = async db => {
  const sql = await readFile(new URL('../db/postgres/50-functions.sql', import.meta.url), 'utf8');
  await db.adminQuery(namespaceSql(sql, db.roles));
};

test('PIVOT-007 installs exactly the reviewed definer authority surface and EXECUTE allow-list', async () => {
  await withPivotDatabase({sqlFiles: schemaFiles, adminSqlFiles}, async db => {
    const functions = (await db.adminQuery(`
      SELECT p.proname, pg_get_userbyid(p.proowner) AS owner_name, p.prosecdef, p.proconfig, p.oid,
             p.proacl, p.proowner
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'operator'
        AND p.proname IN ('read_tenant_support', 'log_operator_read_denial',
                          'assert_read_authority_protocol')
      ORDER BY p.proname
    `)).rows;
    assert.equal(functions.length, 3);
    for (const fn of functions) {
      assert.equal(fn.owner_name, db.roles.operatorDefiner, `${fn.proname} owner`);
      assert.equal(fn.prosecdef, true, `${fn.proname} must be SECURITY DEFINER`);
      assert.deepEqual(fn.proconfig, ['search_path=pg_catalog, operator, tenant_data']);
    }

    for (const name of ['read_tenant_support', 'log_operator_read_denial']) {
      const fn = functions.find(row => row.proname === name);
      assert.equal(
        (await db.adminQuery('SELECT has_function_privilege($1, $2, $3) AS ok',
          [db.roles.operatorRead, fn.oid, 'EXECUTE'])).rows[0].ok,
        true,
      );
      for (const role of [db.roles.operatorAdmin, db.roles.customerApp, db.roles.authService]) {
        assert.equal(
          (await db.adminQuery('SELECT has_function_privilege($1, $2, $3) AS ok',
            [role, fn.oid, 'EXECUTE'])).rows[0].ok,
          false,
          `${name} must not be executable by ${role}`,
        );
      }
    }

    const protocol = functions.find(row => row.proname === 'assert_read_authority_protocol');
    assert.equal(
      (await db.adminQuery('SELECT has_function_privilege($1, $2, $3) AS ok',
        [db.roles.operatorRead, protocol.oid, 'EXECUTE'])).rows[0].ok,
      false,
    );

    for (const fn of functions) {
      const publicExecute = (await db.adminQuery(`
        SELECT 1 AS present
        FROM pg_proc p,
             LATERAL aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
        WHERE p.oid = $1 AND a.grantee = 0 AND a.privilege_type = 'EXECUTE'
      `, [fn.oid])).rowCount;
      assert.equal(publicExecute, 0, `${fn.proname} must not grant EXECUTE to PUBLIC`);
    }

    const definer = (await db.adminQuery(`
      SELECT rolcanlogin, rolsuper, rolcreatedb, rolcreaterole, rolinherit, rolbypassrls,
             rolreplication, rolconfig
      FROM pg_roles WHERE rolname = $1
    `, [db.roles.operatorDefiner])).rows[0];
    assert.deepEqual(definer, {
      rolcanlogin: false,
      rolsuper: false,
      rolcreatedb: false,
      rolcreaterole: false,
      rolinherit: false,
      rolbypassrls: false,
      rolreplication: false,
      rolconfig: null,
    });
    assert.equal((await db.adminQuery(
      'SELECT count(*)::int AS n FROM pg_auth_members WHERE member = (SELECT oid FROM pg_roles WHERE rolname = $1) OR roleid = (SELECT oid FROM pg_roles WHERE rolname = $1)',
      [db.roles.operatorDefiner],
    )).rows[0].n, 0);
    assert.equal((await db.adminQuery(
      'SELECT count(*)::int AS n FROM pg_class WHERE relowner = (SELECT oid FROM pg_roles WHERE rolname = $1)',
      [db.roles.operatorDefiner],
    )).rows[0].n, 0);

    const surfaces = (await db.adminQuery(`
      SELECT
        has_schema_privilege($1, 'tenant_data', 'USAGE') AS schema_usage,
        has_schema_privilege($1, 'tenant_data', 'CREATE') AS schema_create,
        has_table_privilege($1, 'operator.operator_audit', 'SELECT') AS audit_select,
        has_table_privilege($1, 'operator.operator_audit', 'INSERT') AS audit_insert,
        has_table_privilege($1, 'tenant_data.journals', 'SELECT') AS journals_table_select,
        has_column_privilege($1, 'tenant_data.journals', 'narrative', 'SELECT') AS journals_column_select,
        has_sequence_privilege($1, 'operator.operator_audit_id_seq', 'USAGE') AS audit_seq_usage,
        has_table_privilege($1, 'operator.tenant', 'SELECT') AS tenant_select
    `, [db.roles.operatorDefiner])).rows[0];
    assert.deepEqual(surfaces, {
      schema_usage: true,
      schema_create: false,
      audit_select: false,
      audit_insert: true,
      journals_table_select: false,
      journals_column_select: true,
      audit_seq_usage: true,
      tenant_select: false,
    });

    const operatorReadSurfaces = (await db.adminQuery(`
      SELECT
        has_schema_privilege($1, 'tenant_data', 'USAGE') AS schema_usage,
        has_table_privilege($1, 'tenant_data.journals', 'SELECT') AS journals_select,
        has_table_privilege($1, 'tenant_data.support_grants', 'SELECT') AS grants_select,
        has_table_privilege($1, 'operator.operator_audit', 'INSERT') AS audit_insert,
        has_table_privilege($1, 'operator.access_read_policy', 'SELECT') AS policy_select
    `, [db.roles.operatorRead])).rows[0];
    assert.deepEqual(operatorReadSurfaces, {
      schema_usage: false,
      journals_select: false,
      grants_select: false,
      audit_insert: false,
      policy_select: false,
    });
  });
});

test('PIVOT-007 reads a granted tenant only with the bearer-derived proof and commits one audit', async () => {
  await withPivotDatabase({sqlFiles: schemaFiles, adminSqlFiles}, async db => {
    await seedPolicy(db);
    await seedTenant(db, {
      journals: [
        {id: 'journal-a1', company: 'alpha', lines: [{debit: 100}, {account: '4000', credit: 100}]},
      ],
    });
    await seedOperator(db);
    await seedGrant(db);

    const result = await asOperator(db, SESSION, client => read(client), {commit: true});
    assert.equal(result.tenantId, T1);
    assert.equal(result.resource, 'journals');
    assert.equal(result.grantId, 'grant-1');
    assert.equal(result.rowCount, 1);
    assert.equal(result.rows[0].id, 'journal-a1');

    const audit = await auditRows(db);
    assert.equal(audit.length, 1);
    assert.equal(audit[0].actor_id, OP_USER);
    assert.equal(audit[0].action, 'OPERATOR_READ');
    assert.equal(audit[0].tenant_id, T1);
    assert.equal(audit[0].payload_jsonb.operatorSubject, SUBJECT);
    assert.equal(audit[0].payload_jsonb.issuer, ISSUER);
    assert.equal(audit[0].payload_jsonb.audience, AUDIENCE);
    assert.equal(audit[0].payload_jsonb.sessionId, SESSION);
    assert.equal(audit[0].payload_jsonb.rowCount, 1);
  });
});

test('PIVOT-007 requires a bearer-derived proof, not a caller-nominated session UUID', async () => {
  await withPivotDatabase({sqlFiles: schemaFiles, adminSqlFiles}, async db => {
    await seedPolicy(db);
    await seedTenant(db, {journals: [{id: 'j1', company: 'alpha', lines: [{debit: 1}, {account: '4000', credit: 1}]}]});
    await seedOperator(db);
    await seedGrant(db);

    await assert.rejects(asOperator(db, null, client => read(client)), /OPERATOR_CONTEXT_REQUIRED/);
    await assert.rejects(
      asOperator(db, '99999999-9999-4999-8999-999999999999', client => read(client)),
      /OPERATOR_CONTEXT_REQUIRED/,
    );
    await assert.rejects(
      asOperator(db, SESSION, client => read(client, {
        proof: createHash('sha256').update('different-bearer').digest('hex'),
      })),
      /OPERATOR_CONTEXT_REQUIRED/,
    );
    await assert.rejects(
      asOperator(db, SESSION, client => read(client, {proof: 'not-a-digest'})),
      /OPERATOR_CONTEXT_REQUIRED/,
    );
    assert.equal((await auditRows(db)).length, 0);
  });
});

test('PIVOT-007 revalidates credential epochs and session liveness exactly', async () => {
  await withPivotDatabase({sqlFiles: schemaFiles, adminSqlFiles}, async db => {
    await seedPolicy(db);
    await seedTenant(db, {journals: [{id: 'j1', company: 'alpha', lines: [{debit: 1}, {account: '4000', credit: 1}]}]});
    await seedOperator(db);
    await seedGrant(db);

    await db.adminQuery(`UPDATE auth.users SET credential_version = 2 WHERE id = $1::uuid`, [OP_USER]);
    await assert.rejects(asOperator(db, SESSION, client => read(client)), /OPERATOR_ACCESS_DENIED/);
    await db.adminQuery(`UPDATE auth.users SET credential_version = 1 WHERE id = $1::uuid`, [OP_USER]);

    await db.adminQuery(`UPDATE auth.sessions SET revoked_at = now() WHERE id = $1::uuid`, [SESSION]);
    await assert.rejects(asOperator(db, SESSION, client => read(client)), /OPERATOR_ACCESS_EXPIRED/);
    await db.adminQuery(`UPDATE auth.sessions SET revoked_at = NULL WHERE id = $1::uuid`, [SESSION]);

    await db.adminQuery(`
      UPDATE auth.sessions SET idle_expires_at = now() - interval '1 minute'
      WHERE id = $1::uuid
    `, [SESSION]);
    await assert.rejects(asOperator(db, SESSION, client => read(client)), /OPERATOR_ACCESS_EXPIRED/);
    await db.adminQuery(`
      UPDATE auth.sessions SET idle_expires_at = now() + interval '1 hour'
      WHERE id = $1::uuid
    `, [SESSION]);

    await db.adminQuery(`UPDATE auth.sessions SET realm = 'customer' WHERE id = $1::uuid`, [SESSION]);
    await assert.rejects(asOperator(db, SESSION, client => read(client)), /OPERATOR_ACCESS_EXPIRED/);
    await db.adminQuery(`UPDATE auth.sessions SET realm = 'operator' WHERE id = $1::uuid`, [SESSION]);
  });
});

test('PIVOT-007 enforces configured issuer, audience, exact assurance, source age and policy state', async () => {
  await withPivotDatabase({sqlFiles: schemaFiles, adminSqlFiles}, async db => {
    await seedTenant(db, {journals: [{id: 'j1', company: 'alpha', lines: [{debit: 1}, {account: '4000', credit: 1}]}]});
    await seedOperator(db);
    await seedGrant(db);

    await assert.rejects(asOperator(db, SESSION, client => read(client)), /OPERATOR_POLICY_REQUIRED/);
    await seedPolicy(db, {active: false});
    await assert.rejects(asOperator(db, SESSION, client => read(client)), /OPERATOR_POLICY_REQUIRED/);
    await db.adminQuery(`UPDATE operator.access_read_policy SET is_active = true`);
    assert.equal((await asOperator(db, SESSION, client => read(client))).rowCount, 1);

    await db.adminQuery(`
      UPDATE operator.access_read_policy SET issuer = 'https://wrong.example' WHERE policy_key = 'operator_read'
    `);
    await assert.rejects(asOperator(db, SESSION, client => read(client)), /OPERATOR_ACCESS_DENIED/);
    await db.adminQuery(`
      UPDATE operator.access_read_policy SET issuer = $1 WHERE policy_key = 'operator_read'
    `, [ISSUER]);

    await db.adminQuery(`
      UPDATE operator.access_read_policy SET audience = 'wrong-audience' WHERE policy_key = 'operator_read'
    `);
    await assert.rejects(asOperator(db, SESSION, client => read(client)), /OPERATOR_ACCESS_DENIED/);
    await db.adminQuery(`
      UPDATE operator.access_read_policy SET audience = $1 WHERE policy_key = 'operator_read'
    `, [AUDIENCE]);

    // A coherent weaker-label policy is rejected at the schema boundary; the fixed
    // access_mfa invariant is not configurable.
    await assert.rejects(
      db.adminQuery(`UPDATE operator.access_read_policy SET required_assurance = 'mfa_verified' WHERE policy_key = 'operator_read'`),
      /access_read_policy_assurance_access_mfa|access_mfa/,
    );

    await db.adminQuery(`
      UPDATE operator.access_read_policy SET max_source_age_seconds = 30 WHERE policy_key = 'operator_read'
    `);
    await assert.rejects(asOperator(db, SESSION, client => read(client)), /OPERATOR_ACCESS_EXPIRED/);
    await db.adminQuery(`
      UPDATE operator.access_read_policy SET max_source_age_seconds = 300 WHERE policy_key = 'operator_read'
    `);

    // Assurance is matched exactly against the configured policy, not merely non-null.
    await db.adminQuery(`
      UPDATE operator.access_identity SET assurance_class = 'mfa_verified' WHERE subject = $1
    `, [SUBJECT]);
    await syncBinding(db);
    await assert.rejects(asOperator(db, SESSION, client => read(client)), /OPERATOR_ACCESS_DENIED/);
  });
});

test('PIVOT-007 samples trusted time after blocking acquisitions and denies a session that expires while waiting', async () => {
  await withPivotDatabase({sqlFiles: schemaFiles, adminSqlFiles}, async db => {
    await seedPolicy(db);
    await seedTenant(db, {journals: [{id: 'j1', company: 'alpha', lines: [{debit: 1}, {account: '4000', credit: 1}]}]});
    await seedOperator(db);
    await seedGrant(db);

    await db.adminQuery('BEGIN');
    await db.adminQuery("SELECT pg_advisory_xact_lock(hashtextextended('saven.auth.authority_gate', 0))");
    await db.adminQuery(`
      UPDATE auth.sessions SET idle_expires_at = now() + interval '1 second'
      WHERE id = $1::uuid
    `, [SESSION]);
    const pending = asOperator(db, SESSION, client => read(client));
    await sleep(1800);
    await db.adminQuery('COMMIT');
    await assert.rejects(pending, /OPERATOR_ACCESS_EXPIRED/);
    assert.equal((await auditRows(db)).length, 0);
  });
});

test('PIVOT-007 fails closed when the installed authority/consent writer protocol is disabled, replica-only or misbound', async () => {
  await withPivotDatabase({sqlFiles: schemaFiles, adminSqlFiles}, async db => {
    await seedPolicy(db);
    await seedTenant(db, {journals: [{id: 'j1', company: 'alpha', lines: [{debit: 1}, {account: '4000', credit: 1}]}]});
    await seedOperator(db);
    await seedGrant(db);

    await db.adminQuery(
      `ALTER TABLE auth.tenant_membership DISABLE TRIGGER tenant_membership_authority_gate_insert`,
    );
    await assert.rejects(asOperator(db, SESSION, client => read(client)), /OPERATOR_AUTHORITY_PROTOCOL_INVALID/);
    await db.adminQuery(
      `ALTER TABLE auth.tenant_membership ENABLE TRIGGER tenant_membership_authority_gate_insert`,
    );

    await db.adminQuery(
      `ALTER TABLE auth.roles ENABLE REPLICA TRIGGER roles_authority_gate_update`,
    );
    await assert.rejects(asOperator(db, SESSION, client => read(client)), /OPERATOR_AUTHORITY_PROTOCOL_INVALID/);
    await db.adminQuery(
      `ALTER TABLE auth.roles ENABLE TRIGGER roles_authority_gate_update`,
    );

    await db.adminQuery(
      `ALTER TABLE operator.access_identity DISABLE TRIGGER access_identity_authority_gate_update`,
    );
    await assert.rejects(asOperator(db, SESSION, client => read(client)), /OPERATOR_AUTHORITY_PROTOCOL_INVALID/);
    await db.adminQuery(
      `ALTER TABLE operator.access_identity ENABLE TRIGGER access_identity_authority_gate_update`,
    );

    await db.adminQuery(
      `ALTER TABLE tenant_data.support_grants DISABLE TRIGGER support_grants_consent_gate_update`,
    );
    await assert.rejects(asOperator(db, SESSION, client => read(client)), /OPERATOR_AUTHORITY_PROTOCOL_INVALID/);
    await db.adminQuery(
      `ALTER TABLE tenant_data.support_grants ENABLE TRIGGER support_grants_consent_gate_update`,
    );

    await db.adminQuery(
      `ALTER TABLE operator.access_read_policy DISABLE TRIGGER access_read_policy_policy_gate_update`,
    );
    await assert.rejects(asOperator(db, SESSION, client => read(client)), /OPERATOR_AUTHORITY_PROTOCOL_INVALID/);
    await db.adminQuery(
      `ALTER TABLE operator.access_read_policy ENABLE TRIGGER access_read_policy_policy_gate_update`,
    );

    await db.adminQuery(`
      CREATE FUNCTION auth.probe_gate() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN PERFORM pg_advisory_xact_lock(hashtextextended('saven.auth.authority_gate', 0)); RETURN NULL; END $$;
    `);
    await db.adminQuery(`DROP TRIGGER members_consent_gate_update ON tenant_data.members`);
    await db.adminQuery(`
      CREATE TRIGGER members_consent_gate_update BEFORE UPDATE ON tenant_data.members
      FOR EACH STATEMENT EXECUTE FUNCTION auth.probe_gate();
    `);
    await assert.rejects(asOperator(db, SESSION, client => read(client)), /OPERATOR_AUTHORITY_PROTOCOL_INVALID/);
    await db.adminQuery(`DROP TRIGGER members_consent_gate_update ON tenant_data.members`);
    await db.adminQuery(`
      CREATE TRIGGER members_consent_gate_update BEFORE UPDATE ON tenant_data.members
      FOR EACH STATEMENT EXECUTE FUNCTION operator.lock_consent_gate();
    `);
    await db.adminQuery(`DROP FUNCTION auth.probe_gate()`);

    // Tampered gate body: a shared-lock replacement no longer serializes writers.
    await db.adminQuery(`
      CREATE OR REPLACE FUNCTION auth.lock_authority_gate() RETURNS trigger
      LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog AS $$
      BEGIN
        PERFORM pg_advisory_xact_lock_shared(hashtextextended('saven.auth.authority_gate', 0));
        RETURN NULL;
      END $$;
    `);
    await assert.rejects(asOperator(db, SESSION, client => read(client)), /OPERATOR_AUTHORITY_PROTOCOL_INVALID/);
    await db.adminQuery(`
      CREATE OR REPLACE FUNCTION auth.lock_authority_gate() RETURNS trigger
      LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog AS $$
      BEGIN
        PERFORM pg_advisory_xact_lock(hashtextextended('saven.auth.authority_gate', 0));
        RETURN NULL;
      END $$;
    `);
    await db.adminQuery(`ALTER FUNCTION auth.lock_authority_gate() OWNER TO "${db.roles.migrator}"`);
    await db.adminQuery(`REVOKE ALL ON FUNCTION auth.lock_authority_gate() FROM PUBLIC`);

    // A runtime membership drift on the definer itself also fails closed.
    await db.adminQuery(`GRANT "${db.roles.authService}" TO "${db.roles.operatorDefiner}"`);
    await assert.rejects(asOperator(db, SESSION, client => read(client)), /OPERATOR_AUTHORITY_PROTOCOL_INVALID/);
    await db.adminQuery(`REVOKE "${db.roles.authService}" FROM "${db.roles.operatorDefiner}"`);
  });
});

test('PIVOT-007 validates scope JSON typing exactly and declares tenant-wide resources', async () => {
  await withPivotDatabase({sqlFiles: schemaFiles, adminSqlFiles}, async db => {
    await seedPolicy(db);
    await seedTenant(db, {
      journals: [
        {id: 'j-alpha', company: 'alpha', lines: [{debit: 1}, {account: '4000', credit: 1}]},
      ],
    });
    await seedOperator(db);
    await seedGrant(db, {scope: {version: 1, resources: ['journals'], companies: ['alpha']}});

    for (const scopeRaw of [
      JSON.stringify({version: '1', resources: ['journals'], companies: ['alpha']}),
      JSON.stringify({version: 1, resources: ['journals', 5], companies: ['alpha']}),
      JSON.stringify({version: 1, resources: 'journals', companies: ['alpha']}),
      JSON.stringify({version: 1, resources: ['journals'], companies: ['alpha', 7]}),
      JSON.stringify({version: 1, resources: ['journals'], companies: 'alpha'}),
      JSON.stringify({version: 1, resources: ['journals'], companies: ['alpha'], extra: true}),
    ]) {
      await db.adminQuery(`
        UPDATE tenant_data.support_grants SET scope_jsonb = $2::jsonb
        WHERE tenant_id = $1::uuid AND grant_id = 'grant-1'
      `, [T1, scopeRaw]);
      await assert.rejects(asOperator(db, SESSION, client => read(client)), /OPERATOR_GRANT_REQUIRED/);
    }

    await db.adminQuery(`
      UPDATE tenant_data.support_grants SET scope_jsonb = $2::jsonb
      WHERE tenant_id = $1::uuid AND grant_id = 'grant-1'
    `, [T1, JSON.stringify({version: 1, resources: ['journals'], companies: ['alpha']})]);
    await db.adminQuery(`
      UPDATE tenant_data.support_grants SET actions_jsonb = '["operator.tenant.read", 3]'::jsonb
      WHERE tenant_id = $1::uuid AND grant_id = 'grant-1'
    `, [T1]);
    await assert.rejects(asOperator(db, SESSION, client => read(client)), /OPERATOR_GRANT_REQUIRED/);

    await db.adminQuery(`
      UPDATE tenant_data.support_grants SET actions_jsonb = $2::jsonb
      WHERE tenant_id = $1::uuid AND grant_id = 'grant-1'
    `, [T1, JSON.stringify([ACTION])]);
    await db.adminQuery(`
      UPDATE tenant_data.support_grants SET scope_jsonb = $2::jsonb
      WHERE tenant_id = $1::uuid AND grant_id = 'grant-1'
    `, [T1, JSON.stringify({version: 1, resources: ['business', 'accounts'], companies: ['alpha']})]);

    // Tenant-wide resources reject a company selector rather than pretending to filter.
    await assert.rejects(
      asOperator(db, SESSION, client => read(client, {resource: 'business', company: 'alpha'})),
      /OPERATOR_ARGUMENT_INVALID/,
    );
    await assert.rejects(
      asOperator(db, SESSION, client => read(client, {resource: 'accounts', company: 'alpha'})),
      /OPERATOR_ARGUMENT_INVALID/,
    );
    assert.equal((await asOperator(db, SESSION, client => read(client, {resource: 'business'}))).rowCount, 1);
  });
});

test('PIVOT-007 refuses wrong tenant, company, action, resource and malformed arguments', async () => {
  await withPivotDatabase({sqlFiles: schemaFiles, adminSqlFiles}, async db => {
    await seedPolicy(db);
    await seedTenant(db, {
      journals: [
        {id: 'j-alpha', company: 'alpha', lines: [{debit: 1}, {account: '4000', credit: 1}]},
        {id: 'j-beta', company: 'beta', lines: [{debit: 2}, {account: '4000', credit: 2}]},
      ],
    });
    await seedOperator(db);
    await seedGrant(db, {scope: {version: 1, resources: ['journals'], companies: ['alpha']}});

    await assert.rejects(asOperator(db, SESSION, client => read(client, {tenant: T2})), /OPERATOR_GRANT_REQUIRED/);
    await assert.rejects(asOperator(db, SESSION, client => read(client, {company: 'beta'})), /OPERATOR_GRANT_REQUIRED/);
    await assert.rejects(
      asOperator(db, SESSION, client => read(client, {action: 'operator.tenant.export'})),
      /OPERATOR_GRANT_REQUIRED/,
    );
    await assert.rejects(
      asOperator(db, SESSION, client => read(client, {resource: 'accounts'})),
      /OPERATOR_GRANT_REQUIRED/,
    );
    await assert.rejects(
      asOperator(db, SESSION, client => read(client, {resource: 'pg_authid'})),
      /OPERATOR_RESOURCE_UNSUPPORTED/,
    );
    await assert.rejects(asOperator(db, SESSION, client => read(client, {reason: '   '})), /OPERATOR_ARGUMENT_INVALID/);
    await assert.rejects(asOperator(db, SESSION, client => read(client, {limit: 0})), /OPERATOR_ARGUMENT_INVALID/);
    await assert.rejects(asOperator(db, SESSION, client => read(client, {limit: 501})), /OPERATOR_ARGUMENT_INVALID/);
  });
});

test('PIVOT-007 applies company scope, exact minor-unit money and bounded row limits', async () => {
  await withPivotDatabase({sqlFiles: schemaFiles, adminSqlFiles}, async db => {
    await seedPolicy(db);
    await seedTenant(db, {
      journals: [
        {id: 'j-alpha-1', company: 'alpha', lines: [{debit: 999999999999}, {account: '4000', credit: 1}]},
        {id: 'j-alpha-2', company: 'alpha', lines: [{debit: 5}, {account: '4000', credit: 5}]},
        {id: 'j-beta-1', company: 'beta', lines: [{debit: 7}, {account: '4000', credit: 7}]},
      ],
    });
    await seedOperator(db);
    await seedGrant(db, {scope: {version: 1, resources: READ_RESOURCES, companies: ['alpha']}});

    const journals = await asOperator(db, SESSION, client => read(client));
    assert.equal(journals.rowCount, 2);
    assert.deepEqual(journals.rows.map(row => row.id).sort(), ['j-alpha-1', 'j-alpha-2']);

    const companies = await asOperator(db, SESSION, client => read(client, {resource: 'company_profiles'}));
    assert.deepEqual(companies.rows.map(row => row.id), ['alpha']);

    const lines = await asOperator(db, SESSION, client => read(client, {resource: 'journal_lines'}));
    assert.equal(lines.rowCount, 4);
    const largeLine = lines.rows.find(row => row.journal_id === 'j-alpha-1' && row.line_no === 1);
    assert.equal(largeLine.debit, 999999999999);
    assert.equal(largeLine.credit, 0);
    assert.equal(typeof largeLine.debit, 'number');

    const limited = await asOperator(db, SESSION, client => read(client, {limit: 1}));
    assert.equal(limited.rowCount, 1);
    assert.equal(limited.truncated, true);
  });
});

test('PIVOT-007 ignores caller search_path and temporary relation shadows', async () => {
  await withPivotDatabase({sqlFiles: schemaFiles, adminSqlFiles}, async db => {
    await seedPolicy(db);
    await seedTenant(db, {
      journals: [{id: 'real-journal', company: 'alpha', lines: [{debit: 1}, {account: '4000', credit: 1}]}],
    });
    await seedOperator(db);
    await seedGrant(db);

    await assert.rejects(asOperator(db, SESSION, async client => {
      await client.query(`
        CREATE TEMP TABLE support_grants(
          tenant_id uuid, grant_id text, grantee_actor_id text, granted_by_user_id text,
          scope_jsonb jsonb, actions_jsonb jsonb, starts_at timestamptz, expires_at timestamptz,
          revoked_at timestamptz, is_active boolean)
      `);
      await client.query(`
        INSERT INTO support_grants VALUES (
          $1::uuid, 'evil-grant', $2, 'user-2',
          '{"version":1,"resources":["journals"],"companies":["beta"]}'::jsonb,
          '["operator.tenant.read"]'::jsonb,
          now() - interval '1 hour', now() + interval '1 hour', NULL, true)
      `, [T2, SUBJECT]);
      await client.query('SET LOCAL search_path = pg_temp');
      return read(client, {tenant: T2});
    }), /OPERATOR_GRANT_REQUIRED/);

    const result = await asOperator(db, SESSION, async client => {
      await client.query(`
        CREATE TEMP TABLE journals(
          tenant_id uuid, id text, company text, branch text, posting_date text, narrative text)
      `);
      await client.query(`
        INSERT INTO journals VALUES ($1::uuid, 'fake-journal', 'alpha', 'main', '2026-11-19', 'fake')
      `, [T1]);
      await client.query('SET LOCAL search_path = pg_temp');
      return read(client);
    });
    assert.deepEqual(result.rows.map(row => row.id), ['real-journal']);
  });
});

test('PIVOT-007 commits read and audit together and records denials with independent durability', async () => {
  await withPivotDatabase({sqlFiles: schemaFiles, adminSqlFiles}, async db => {
    await seedPolicy(db);
    await seedTenant(db, {journals: [{id: 'j1', company: 'alpha', lines: [{debit: 1}, {account: '4000', credit: 1}]}]});
    await seedOperator(db);
    await seedGrant(db);

    const rolledBack = await asOperator(db, SESSION, client => read(client));
    assert.equal(rolledBack.rowCount, 1);
    assert.equal((await auditRows(db)).length, 0);

    await db.adminQuery(`REVOKE INSERT ON operator.operator_audit FROM "${db.roles.operatorDefiner}"`);
    await assert.rejects(asOperator(db, SESSION, client => read(client)), /permission denied/);
    assert.equal((await auditRows(db)).length, 0);
    await db.adminQuery(`GRANT INSERT ON operator.operator_audit TO "${db.roles.operatorDefiner}"`);

    await db.adminQuery(`
      UPDATE tenant_data.support_grants SET expires_at = now() - interval '1 minute'
      WHERE tenant_id = $1::uuid AND grant_id = 'grant-1'
    `, [T1]);
    await assert.rejects(asOperator(db, SESSION, client => read(client)), /OPERATOR_GRANT_REQUIRED/);
    assert.equal((await auditRows(db)).length, 0);

    await asOperator(db, SESSION, client => client.query(DENY_SQL, [
      T1, PROOF, 'journals', ACTION, null, 'OPERATOR_GRANT_REQUIRED', 'support grant expired', 'req-deny-1',
    ]), {commit: true});

    const audit = await auditRows(db);
    assert.equal(audit.length, 1);
    assert.equal(audit[0].action, 'OPERATOR_READ_DENIED');
    assert.equal(audit[0].actor_id, OP_USER);
    assert.equal(audit[0].payload_jsonb.attribution, 'verified');
    assert.equal(audit[0].payload_jsonb.denialCode, 'OPERATOR_GRANT_REQUIRED');
    assert.equal(audit[0].payload_jsonb.durability, 'independent-transaction');
  });
});

test('PIVOT-007 serializes customer consent writes against in-flight reads', async () => {
  await withPivotDatabase({sqlFiles: schemaFiles, adminSqlFiles}, async db => {
    await seedPolicy(db);
    await seedTenant(db, {
      journals: [
        {id: 'j-alpha', company: 'alpha', lines: [{debit: 1}, {account: '4000', credit: 1}]},
        {id: 'j-beta', company: 'beta', lines: [{debit: 2}, {account: '4000', credit: 2}]},
      ],
    });
    await seedOperator(db);
    await seedGrant(db, {scope: {version: 1, resources: ['journals'], companies: ['alpha', 'beta']}});

    // Read-first: the read holds the consent gate shared, so a concurrent revocation
    // cannot commit until the read transaction ends.
    const outcome = await asOperator(db, SESSION, async client => {
      const result = await read(client);
      await db.adminQuery(`SET lock_timeout = '250ms'`);
      let blocked;
      try {
        await db.adminQuery(`
          UPDATE tenant_data.support_grants SET revoked_at = now()
          WHERE tenant_id = $1::uuid AND grant_id = 'grant-1'
        `, [T1]);
        blocked = null;
      } catch (error) {
        blocked = error;
      } finally {
        await db.adminQuery('RESET lock_timeout');
      }
      return {result, blocked};
    });
    assert.equal(outcome.result.rowCount, 2);
    assert.ok(outcome.blocked, 'the consent writer must block behind the in-flight read');
    assert.equal(outcome.blocked.code, '55P03');

    // The read rolled back, so the grant is still active. Committed revocation is now
    // observed by the next read (invalidation-first).
    await db.adminQuery(`
      UPDATE tenant_data.support_grants SET revoked_at = now()
      WHERE tenant_id = $1::uuid AND grant_id = 'grant-1'
    `, [T1]);
    await assert.rejects(asOperator(db, SESSION, client => read(client)), /OPERATOR_GRANT_REQUIRED/);
    await asOperator(db, SESSION, client => client.query(DENY_SQL, [
      T1, PROOF, 'journals', ACTION, null, 'OPERATOR_GRANT_REQUIRED', 'revoked by customer', null,
    ]), {commit: true});
    const denial = (await auditRows(db)).at(-1);
    assert.equal(denial.action, 'OPERATOR_READ_DENIED');
    assert.equal(denial.payload_jsonb.attribution, 'verified');
    await db.adminQuery(`
      UPDATE tenant_data.support_grants SET revoked_at = NULL
      WHERE tenant_id = $1::uuid AND grant_id = 'grant-1'
    `, [T1]);

    // Scope narrowing commits between reads and is observed immediately.
    await db.adminQuery(`
      UPDATE tenant_data.support_grants SET scope_jsonb = $2::jsonb
      WHERE tenant_id = $1::uuid AND grant_id = 'grant-1'
    `, [T1, JSON.stringify({version: 1, resources: ['journals'], companies: ['alpha']})]);
    const narrowed = await asOperator(db, SESSION, client => read(client));
    assert.deepEqual(narrowed.rows.map(row => row.id), ['j-alpha']);

    // Author deactivation removes consent.
    await db.adminQuery(`
      UPDATE tenant_data.members SET active = false WHERE tenant_id = $1::uuid AND user_id = 'user-1'
    `, [T1]);
    await assert.rejects(asOperator(db, SESSION, client => read(client)), /OPERATOR_GRANT_REQUIRED/);
  });
});

test('PIVOT-007 denial attribution never invents a current actor from a stale binding', async () => {
  await withPivotDatabase({sqlFiles: schemaFiles, adminSqlFiles}, async db => {
    await seedPolicy(db);
    await seedTenant(db, {journals: [{id: 'j1', company: 'alpha', lines: [{debit: 1}, {account: '4000', credit: 1}]}]});
    await seedOperator(db);
    await seedGrant(db);

    const deny = () => asOperator(db, SESSION, client => client.query(DENY_SQL, [
      T1, PROOF, 'journals', ACTION, null, 'OPERATOR_GRANT_REQUIRED', 'denied', null,
    ]), {commit: true});

    // Reassignment: the subject now maps to a different principal; the old binding must
    // not be attributed to the new principal.
    await db.adminQuery(`INSERT INTO auth.users(id, email, status) VALUES ($1::uuid, 'op2@example.test', 'active')`, [OP_USER_2]);
    await db.adminQuery(`UPDATE operator.access_identity SET user_id = $2::uuid WHERE subject = $1`, [SUBJECT, OP_USER_2]);
    await deny();
    let row = (await auditRows(db)).at(-1);
    assert.equal(row.actor_id, 'unverified');
    assert.equal(row.payload_jsonb.attribution, 'unverified');
    assert.equal(row.payload_jsonb.verifiedSubject, null);
    assert.equal(row.payload_jsonb.verifiedRoleId, null);
    assert.equal(row.payload_jsonb.claimedSubject, SUBJECT);

    // Restore the mapping and binding continuity, then verify a positive attribution.
    await db.adminQuery(`UPDATE operator.access_identity SET user_id = $2::uuid WHERE subject = $1`, [SUBJECT, OP_USER]);
    await syncBinding(db);
    await deny();
    row = (await auditRows(db)).at(-1);
    assert.equal(row.actor_id, OP_USER);
    assert.equal(row.payload_jsonb.attribution, 'verified');
    assert.equal(row.payload_jsonb.verifiedSubject, SUBJECT);

    // Epoch-stale binding.
    await db.adminQuery(`UPDATE operator.access_identity SET status = 'active' WHERE subject = $1`, [SUBJECT]);
    await deny();
    row = (await auditRows(db)).at(-1);
    assert.equal(row.actor_id, 'unverified');
    assert.equal(row.payload_jsonb.attribution, 'unverified');

    // Revoked session.
    await syncBinding(db);
    await db.adminQuery(`UPDATE auth.sessions SET revoked_at = now() WHERE id = $1::uuid`, [SESSION]);
    await deny();
    row = (await auditRows(db)).at(-1);
    assert.equal(row.actor_id, 'unverified');

    // Unknown/claimed session.
    await db.adminQuery(`UPDATE auth.sessions SET revoked_at = NULL WHERE id = $1::uuid`, [SESSION]);
    await asOperator(db, '99999999-9999-4999-8999-999999999999', client => client.query(DENY_SQL, [
      T1, PROOF, 'journals', ACTION, null, 'OPERATOR_CONTEXT_REQUIRED', 'unknown session', null,
    ]), {commit: true});
    row = (await auditRows(db)).at(-1);
    assert.equal(row.actor_id, 'unverified');
    assert.equal(row.payload_jsonb.claimedSubject, null);
  });
});

test('PIVOT-007 refuses a poisoned definer profile before installation and preserves it', async () => {
  await withPivotDatabase({
    sqlFiles: schemaFiles,
    adminSqlFiles: [
      'db/postgres/migrations/031-rls-corrections.sql',
      'db/postgres/migrations/032-rls-hardening.sql',
      'db/postgres/migrations/033-membership-admission-lock.sql',
      'db/postgres/06-operator-identity.sql',
    ],
  }, async db => {
    const definer = `"${db.roles.operatorDefiner}"`;
    const migrator = `"${db.roles.migrator}"`;
    const attempt = async () => {
      await assert.rejects(applyFunctionsPayload(db), /PIVOT-007/);
      await db.adminQuery('ROLLBACK').catch(() => {});
    };

    // Direct membership into a privileged role.
    await db.adminQuery(`GRANT ${migrator} TO ${definer}`);
    await attempt();
    assert.equal((await db.adminQuery(
      `SELECT count(*)::int AS n FROM pg_auth_members
       WHERE member = (SELECT oid FROM pg_roles WHERE rolname = $1)`,
      [db.roles.operatorDefiner],
    )).rows[0].n, 1);
    await db.adminQuery(`REVOKE ${migrator} FROM ${definer}`);

    // Unexpected column ACL.
    await db.adminQuery(`GRANT SELECT (created_by) ON tenant_data.accounts TO ${definer}`);
    await attempt();
    assert.equal((await db.adminQuery(
      `SELECT count(*)::int AS n FROM pg_attribute a, aclexplode(a.attacl) x
       WHERE a.attrelid = 'tenant_data.accounts'::regclass AND a.attname = 'created_by'
         AND x.grantee = (SELECT oid FROM pg_roles WHERE rolname = $1)`,
      [db.roles.operatorDefiner],
    )).rows[0].n, 1);
    await db.adminQuery(`REVOKE SELECT (created_by) ON tenant_data.accounts FROM ${definer}`);

    // Schema CREATE.
    await db.adminQuery(`GRANT CREATE ON SCHEMA operator TO ${definer}`);
    await attempt();
    await db.adminQuery(`REVOKE CREATE ON SCHEMA operator FROM ${definer}`);

    // Object ownership.
    await db.adminQuery(`CREATE TABLE operator.probe_owned(id integer)`);
    await db.adminQuery(`ALTER TABLE operator.probe_owned OWNER TO ${definer}`);
    await attempt();
    assert.equal((await db.adminQuery(
      `SELECT pg_get_userbyid(relowner) AS owner FROM pg_class WHERE oid = 'operator.probe_owned'::regclass`,
    )).rows[0].owner, db.roles.operatorDefiner);
    await db.adminQuery('DROP TABLE operator.probe_owned');

    // A default privilege that would silently widen the definer.
    await db.adminQuery(`
      ALTER DEFAULT PRIVILEGES FOR ROLE ${migrator} IN SCHEMA tenant_data
      GRANT SELECT ON TABLES TO ${definer}
    `);
    await attempt();
    await db.adminQuery(`
      ALTER DEFAULT PRIVILEGES FOR ROLE ${migrator} IN SCHEMA tenant_data
      REVOKE SELECT ON TABLES FROM ${definer}
    `);

    // A role-level session setting is itself an authority path.
    await db.adminQuery(`ALTER ROLE ${definer} SET search_path = public`);
    await attempt();
    await db.adminQuery(`ALTER ROLE ${definer} RESET search_path`);

    // A PUBLIC-executable SECURITY DEFINER function would be a reachable path.
    await db.adminQuery(`
      CREATE FUNCTION operator.probe_public() RETURNS integer
      LANGUAGE sql SECURITY DEFINER AS $$ SELECT 1 $$;
    `);
    await attempt();
    await db.adminQuery('DROP FUNCTION operator.probe_public()');

    // Incompatible (login) role definition.
    await db.adminQuery(`ALTER ROLE ${definer} LOGIN`);
    await attempt();
    await db.adminQuery(`ALTER ROLE ${definer} NOLOGIN`);

    // A clean profile installs.
    await applyFunctionsPayload(db);
  });
});

test('PIVOT-007 composes with the accepted 040/041/042 stack and audits customer consent writes', async () => {
  await withPivotDatabase({sqlFiles: fullSchemaFiles, adminSqlFiles: fullAdminSqlFiles}, async db => {
    await seedTenant(db, {
      journals: [{id: 'j1', company: 'alpha', lines: [{debit: 1}, {account: '4000', credit: 1}]}],
    });
    await seedOperator(db);
    await seedGrant(db);

    const dispatcher = await readFile(new URL('../db/postgres/40-triggers.sql', import.meta.url), 'utf8');
    await db.adminQuery(namespaceSql(dispatcher, db.roles));
    await applyFunctionsPayload(db);
    await seedPolicy(db);

    const result = await asOperator(db, SESSION, client => read(client), {commit: true});
    assert.equal(result.rowCount, 1);

    // A post-activation customer consent write is audited by 041 and serialized by the
    // PIVOT-007 consent gate.
    await db.asRole('customerApp', async client => {
      await client.query('SELECT set_config($1, $2, true)', ['app.current_tenant_id', T1]);
      await client.query('SELECT set_config($1, $2, true)', ['app.current_user_id', U1]);
      return client.query(`
        UPDATE tenant_data.support_grants SET reason = 'narrowed after review'
        WHERE tenant_id = $1::uuid AND grant_id = 'grant-1'
      `, [T1]);
    }, {commit: true});

    const events = (await db.adminQuery(`
      SELECT actor_id, event, entity_type
      FROM tenant_data.audit_event
      WHERE tenant_id = $1::uuid AND entity_type = 'support_grants'
      ORDER BY id
    `, [T1])).rows;
    assert.equal(events.length, 1);
    assert.equal(events[0].actor_id, 'user-1');
    assert.equal(events[0].event, 'TENANT_CHANGE_UPDATE');

    assert.equal((await asOperator(db, SESSION, client => read(client))).rowCount, 1);
  });
});


// ---------------------------------------------------------------------------
// Adapter test harness (real AUTH-007 exchange + restricted logins)
// ---------------------------------------------------------------------------

function connectionConfig(database, overrides = {}) {
  return {
    host: process.env.PGHOST ?? '127.0.0.1',
    port: Number(process.env.PGPORT ?? 5432),
    user: process.env.PGUSER ?? 'postgres',
    password: process.env.PGPASSWORD ?? '',
    database,
    max: 4,
    application_name: 'saven-pivot-007-test',
    ...overrides,
  };
}

async function makeLoginPool(db, roleName, label, {max = 4} = {}) {
  const login = `saven_p007_${label}_${randomBytes(5).toString('hex')}`;
  const password = randomBytes(24).toString('base64url');
  await db.adminQuery(
    `CREATE ROLE "${login}" LOGIN PASSWORD '${password}' NOSUPERUSER NOCREATEDB NOCREATEROLE INHERIT NOBYPASSRLS NOREPLICATION`,
  );
  await db.adminQuery(`GRANT "${roleName}" TO "${login}"`);
  const pool = new Pool(connectionConfig(db.database, {user: login, password, max}));
  return {
    login,
    pool,
    async close() {
      await pool.end().catch(() => {});
      await db.adminQuery(`DROP ROLE IF EXISTS "${login}"`).catch(async () => {
        await db.adminQuery(`REVOKE "${roleName}" FROM "${login}"`).catch(() => {});
        await db.adminQuery(`DROP ROLE IF EXISTS "${login}"`).catch(() => {});
      });
    },
  };
}

function makeKeys(kid = 'pivot-007-key') {
  const {publicKey, privateKey} = generateKeyPairSync('rsa', {modulusLength: 2048});
  return {kid, key: publicKey, publicKey, privateKey};
}

function encode(value) {
  return Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');
}

function makeAssertion({key, subject = SUBJECT, claims = {}} = {}) {
  const at = Math.floor(Date.now() / 1000);
  const payload = {
    iss: ISSUER,
    aud: AUDIENCE,
    sub: subject,
    email: 'operator@example.test',
    iat: at,
    nbf: at - 1,
    exp: at + 300,
    type: 'app',
    amr: ['mfa'],
    identity_nonce: randomBytes(12).toString('hex'),
    ...claims,
  };
  const head = {alg: 'RS256', kid: key.kid, typ: 'JWT'};
  const signingInput = `${encode(head)}.${encode(payload)}`;
  const signature = sign('RSA-SHA256', Buffer.from(signingInput, 'utf8'), key.privateKey);
  return `${signingInput}.${signature.toString('base64url')}`;
}

async function buildAdapterHarness(db, {
  operatorPoolMax = 4,
  validatorSkew = 30,
  validatorMaxAge = 300,
  expectedPolicyOverrides = {},
} = {}) {
  const auth = await makeLoginPool(db, db.roles.authService, 'auth', {max: 4});
  const operator = await makeLoginPool(db, db.roles.operatorRead, 'op', {max: operatorPoolMax});
  const clock = () => new Date();
  const keys = makeKeys();
  const validator = createAccessValidator({
    issuer: ISSUER,
    audience: AUDIENCE,
    keys: [keys],
    clock,
    skewSeconds: validatorSkew,
    maxTokenAgeSeconds: validatorMaxAge,
  });
  const store = createSessionStore({connect: () => auth.pool.connect(), clock});
  const access = createOperatorAccess({
    validator,
    store,
    clock,
    policy: {requiredAssurance: 'access_mfa'},
  });
  const expectedPolicy = {
    version: 1,
    issuer: ISSUER,
    audience: AUDIENCE,
    requiredAssurance: 'access_mfa',
    maxSourceAgeSeconds: validatorMaxAge,
    maxClockSkewSeconds: validatorSkew,
    ...expectedPolicyOverrides,
  };
  const adapter = createOperatorSupportRead({
    connectOperator: () => operator.pool.connect(),
    inspectSession: access.inspectSession,
    expectedPolicy,
  });
  return {
    access,
    adapter,
    expectedPolicy,
    keys,
    auth,
    operator,
    async token(claims = null) {
      const exchanged = await access.exchange(makeAssertion({key: keys, ...(claims ? {claims} : {})}));
      return exchanged.token;
    },
    async close() {
      await operator.close();
      await auth.close();
    },
  };
}

// ---------------------------------------------------------------------------
// Finding 2 residuals: final-clock revalidation and exact writer contract
// ---------------------------------------------------------------------------

test('PIVOT-007 revalidates the whole authority set after the consent-gate wait', async () => {
  await withPivotDatabase({sqlFiles: schemaFiles, adminSqlFiles}, async db => {
    await seedPolicy(db);
    await seedTenant(db, {journals: [{id: 'j1', company: 'alpha', lines: [{debit: 1}, {account: '4000', credit: 1}]}]});
    await seedOperator(db);
    await seedGrant(db);

    // Expiry while blocked on the consent gate: the final clock is sampled after the wait.
    await db.adminQuery('BEGIN');
    await db.adminQuery("SELECT pg_advisory_xact_lock(hashtextextended('saven.operator.consent_gate', 0))");
    await db.adminQuery(`
      UPDATE auth.sessions SET idle_expires_at = now() + interval '1 second'
      WHERE id = $1::uuid
    `, [SESSION]);
    const expiring = asOperator(db, SESSION, client => read(client));
    await sleep(1800);
    await db.adminQuery('COMMIT');
    await assert.rejects(expiring, /OPERATOR_ACCESS_EXPIRED/);

    // Permitted control: the same wait with a still-current session publishes.
    await db.adminQuery(`
      UPDATE auth.sessions SET idle_expires_at = now() + interval '1 hour'
      WHERE id = $1::uuid
    `, [SESSION]);
    await db.adminQuery('BEGIN');
    await db.adminQuery("SELECT pg_advisory_xact_lock(hashtextextended('saven.operator.consent_gate', 0))");
    const permitted = asOperator(db, SESSION, client => read(client));
    await sleep(600);
    await db.adminQuery('COMMIT');
    assert.equal((await permitted).rowCount, 1);
  });
});

test('PIVOT-007 rejects conditional, column-scoped or re-profiled writer triggers/functions', async () => {
  await withPivotDatabase({sqlFiles: schemaFiles, adminSqlFiles}, async db => {
    await seedPolicy(db);
    await seedTenant(db, {journals: [{id: 'j1', company: 'alpha', lines: [{debit: 1}, {account: '4000', credit: 1}]}]});
    await seedOperator(db);
    await seedGrant(db);

    // Same binding and function, but WHEN (false): no lock is acquired.
    await db.adminQuery(`DROP TRIGGER support_grants_consent_gate_update ON tenant_data.support_grants`);
    await db.adminQuery(`
      CREATE TRIGGER support_grants_consent_gate_update
      BEFORE UPDATE ON tenant_data.support_grants
      FOR EACH STATEMENT WHEN (false)
      EXECUTE FUNCTION operator.lock_consent_gate();
    `);
    await assert.rejects(asOperator(db, SESSION, client => read(client)), /OPERATOR_AUTHORITY_PROTOCOL_INVALID/);
    await db.adminQuery(`DROP TRIGGER support_grants_consent_gate_update ON tenant_data.support_grants`);
    await db.adminQuery(`
      CREATE TRIGGER support_grants_consent_gate_update
      BEFORE UPDATE ON tenant_data.support_grants
      FOR EACH STATEMENT EXECUTE FUNCTION operator.lock_consent_gate();
    `);

    // Re-profiled gate function (changed search_path) is refused.
    await db.adminQuery(`ALTER FUNCTION operator.lock_consent_gate() SET search_path = public`);
    await assert.rejects(asOperator(db, SESSION, client => read(client)), /OPERATOR_AUTHORITY_PROTOCOL_INVALID/);
    await db.adminQuery(`ALTER FUNCTION operator.lock_consent_gate() SET search_path = pg_catalog`);

    // A conditional auth/identity trigger is refused as well.
    await db.adminQuery(`DROP TRIGGER access_identity_authority_gate_update ON operator.access_identity`);
    await db.adminQuery(`
      CREATE TRIGGER access_identity_authority_gate_update
      BEFORE UPDATE ON operator.access_identity
      FOR EACH STATEMENT WHEN (false)
      EXECUTE FUNCTION auth.lock_authority_gate();
    `);
    await assert.rejects(asOperator(db, SESSION, client => read(client)), /OPERATOR_AUTHORITY_PROTOCOL_INVALID/);
    await db.adminQuery(`DROP TRIGGER access_identity_authority_gate_update ON operator.access_identity`);
    await db.adminQuery(`
      CREATE TRIGGER access_identity_authority_gate_update
      BEFORE UPDATE ON operator.access_identity
      FOR EACH STATEMENT EXECUTE FUNCTION auth.lock_authority_gate();
    `);
  });
});

test('PIVOT-007 denial role evidence is current, never historical authorization', async () => {
  await withPivotDatabase({sqlFiles: schemaFiles, adminSqlFiles}, async db => {
    await seedPolicy(db);
    await seedTenant(db, {journals: [{id: 'j1', company: 'alpha', lines: [{debit: 1}, {account: '4000', credit: 1}]}]});
    await seedOperator(db);
    await seedGrant(db, {expiresAt: "now() - interval '1 minute'", startsAt: "now() - interval '2 hours'"});

    const deny = () => asOperator(db, SESSION, client => client.query(DENY_SQL, [
      T1, PROOF, 'journals', ACTION, null, 'OPERATOR_GRANT_REQUIRED', 'expired grant', null,
    ]), {commit: true});

    await deny();
    let row = (await auditRows(db)).at(-1);
    assert.equal(row.payload_jsonb.attribution, 'verified');

    await db.adminQuery(`UPDATE auth.roles SET is_active = false WHERE role_id = 'operator_admin'`);
    await deny();
    row = (await auditRows(db)).at(-1);
    assert.equal(row.actor_id, 'unverified');
    assert.equal(row.payload_jsonb.attribution, 'unverified');
    await db.adminQuery(`UPDATE auth.roles SET is_active = true WHERE role_id = 'operator_admin'`);

    await db.adminQuery(`UPDATE auth.roles SET is_operator = false WHERE role_id = 'operator_admin'`);
    await deny();
    row = (await auditRows(db)).at(-1);
    assert.equal(row.payload_jsonb.attribution, 'unverified');
    await db.adminQuery(`UPDATE auth.roles SET is_operator = true WHERE role_id = 'operator_admin'`);

    await db.adminQuery(`UPDATE auth.roles SET requires_mfa = false WHERE role_id = 'operator_admin'`);
    await deny();
    row = (await auditRows(db)).at(-1);
    assert.equal(row.payload_jsonb.attribution, 'unverified');
    await db.adminQuery(`UPDATE auth.roles SET requires_mfa = true WHERE role_id = 'operator_admin'`);

    await db.adminQuery(`
      UPDATE auth.roles SET effective_from = now() - interval '1 hour', effective_to = now() - interval '1 minute'
      WHERE role_id = 'operator_admin'
    `);
    await deny();
    row = (await auditRows(db)).at(-1);
    assert.equal(row.payload_jsonb.attribution, 'unverified');
    await db.adminQuery(`
      UPDATE auth.roles SET effective_from = now(), effective_to = NULL WHERE role_id = 'operator_admin'
    `);

    await deny();
    row = (await auditRows(db)).at(-1);
    assert.equal(row.payload_jsonb.attribution, 'verified');
  });
});

// ---------------------------------------------------------------------------
// Finding 1: publication adapter
// ---------------------------------------------------------------------------

test('PIVOT-007 adapter publishes rows only after COMMIT through real AUTH-007 exchange', async () => {
  await withPivotDatabase({sqlFiles: fullSchemaFiles, adminSqlFiles: fullAdminSqlFiles}, async db => {
    await seedTenant(db, {journals: [{id: 'adapter-j1', company: 'alpha', lines: [{debit: 1}, {account: '4000', credit: 1}]}]});
    await seedOperator(db);
    await seedGrant(db);
    const dispatcher = await readFile(new URL('../db/postgres/40-triggers.sql', import.meta.url), 'utf8');
    await db.adminQuery(namespaceSql(dispatcher, db.roles));
    await applyFunctionsPayload(db);
    await seedPolicy(db);

    const harness = await buildAdapterHarness(db);
    try {
      const token = await harness.token();
      const order = [];
      let commitSeen = false;
      const adapter = createOperatorSupportRead({
        connectOperator: async () => {
          const client = await harness.operator.pool.connect();
          return {
            query: async (sql, params) => {
              order.push(sql.trim().split(/\s+/)[0].toUpperCase());
              if (sql === 'COMMIT') commitSeen = true;
              return client.query(sql, params);
            },
            release: destroy => client.release(destroy),
          };
        },
        inspectSession: harness.access.inspectSession,
        expectedPolicy: harness.expectedPolicy,
      });

      const result = await adapter.read({
        token, tenantId: T1, resource: 'journals', action: ACTION, reason: 'support case adapter',
      });
      assert.deepEqual(result.rows.map(row => row.id), ['adapter-j1']);
      assert.equal(commitSeen, true);
      assert.deepEqual(order, ['BEGIN', 'SELECT', 'SELECT', 'COMMIT']);

      const audit = await auditRows(db);
      assert.equal(audit.length, 1);
      assert.equal(audit[0].action, 'OPERATOR_READ');
    } finally {
      await harness.close();
    }
  });
});

test('PIVOT-007 adapter withholds rows until COMMIT and discards them on COMMIT failure', async () => {
  await withPivotDatabase({sqlFiles: schemaFiles, adminSqlFiles}, async db => {
    await seedPolicy(db);
    await seedTenant(db, {journals: [{id: 'j1', company: 'alpha', lines: [{debit: 1}, {account: '4000', credit: 1}]}]});
    await seedOperator(db);
    await seedGrant(db);

    const harness = await buildAdapterHarness(db);
    try {
      const token = await harness.token();

      // Hold COMMIT; the adapter promise must stay unresolved and rows private.
      let releaseCommit;
      let enterCommit;
      const commitGate = new Promise(resolve => {
        releaseCommit = resolve;
      });
      const commitEntered = new Promise(resolve => {
        enterCommit = resolve;
      });
      let resolved = false;
      const gated = createOperatorSupportRead({
        connectOperator: async () => {
          const client = await harness.operator.pool.connect();
          return {
            query: async (sql, params) => {
              if (sql === 'COMMIT') {
                enterCommit();
                await commitGate;
              }
              return client.query(sql, params);
            },
            release: destroy => client.release(destroy),
          };
        },
        inspectSession: harness.access.inspectSession,
        expectedPolicy: harness.expectedPolicy,
      });
      const pending = gated.read({token, tenantId: T1, resource: 'journals', action: ACTION, reason: 'gate'})
        .then(value => {
          resolved = true;
          return value;
        });
      await commitEntered;
      assert.equal(resolved, false, 'rows must not be published before COMMIT');
      releaseCommit();
      assert.equal((await pending).rowCount, 1);

      // COMMIT failure: rows are discarded, the client destroyed and the failure observable.
      let commitAttempts = 0;
      const failing = createOperatorSupportRead({
        connectOperator: async () => {
          const client = await harness.operator.pool.connect();
          return {
            query: async (sql, params) => {
              if (sql === 'COMMIT' && commitAttempts++ === 0) {
                throw new Error('simulated COMMIT uncertainty');
              }
              return client.query(sql, params);
            },
            release: destroy => client.release(destroy),
          };
        },
        inspectSession: harness.access.inspectSession,
        expectedPolicy: harness.expectedPolicy,
      });
      await assert.rejects(
        failing.read({token, tenantId: T1, resource: 'journals', action: ACTION, reason: 'commit failure'}),
        error => error.code === 'OPERATOR_PUBLICATION_UNCERTAIN' && Array.isArray(error.denialEvidence) === false,
      );
      const audit = await auditRows(db);
      assert.equal(audit.filter(row => row.action === 'OPERATOR_READ').length, 1);
      assert.equal(audit.filter(row => row.action === 'OPERATOR_READ_DENIED').length, 1);
      assert.equal(audit.at(-1).payload_jsonb.denialCode, 'OPERATOR_PUBLICATION_UNCERTAIN');
    } finally {
      await harness.close();
    }
  });
});

test('PIVOT-007 adapter logs refusals durably and reuses a size-one clean borrower', async () => {
  await withPivotDatabase({sqlFiles: schemaFiles, adminSqlFiles}, async db => {
    await seedPolicy(db);
    await seedTenant(db, {journals: [{id: 'j1', company: 'alpha', lines: [{debit: 1}, {account: '4000', credit: 1}]}]});
    await seedOperator(db);
    await seedGrant(db);

    const harness = await buildAdapterHarness(db, {operatorPoolMax: 1});
    try {
      const token = await harness.token();

      await db.adminQuery(`
        UPDATE tenant_data.support_grants SET revoked_at = now()
        WHERE tenant_id = $1::uuid AND grant_id = 'grant-1'
      `, [T1]);
      await assert.rejects(
        harness.adapter.read({token, tenantId: T1, resource: 'journals', action: ACTION, reason: 'revoked'}),
        error => error.code === 'OPERATOR_GRANT_REQUIRED' && error.denialEvidence?.committed === true,
      );
      let audit = await auditRows(db);
      assert.equal(audit.length, 1);
      assert.equal(audit[0].action, 'OPERATOR_READ_DENIED');
      assert.equal(audit[0].payload_jsonb.attribution, 'verified');
      const serialized = JSON.stringify(audit[0]);
      assert.equal(serialized.includes(PROOF), false);
      assert.equal(serialized.includes(BEARER), false);

      await db.adminQuery(`
        UPDATE tenant_data.support_grants SET revoked_at = NULL
        WHERE tenant_id = $1::uuid AND grant_id = 'grant-1'
      `, [T1]);
      const result = await harness.adapter.read({
        token, tenantId: T1, resource: 'journals', action: ACTION, reason: 'clean borrower',
      });
      assert.equal(result.rowCount, 1);
      audit = await auditRows(db);
      assert.equal(audit.filter(row => row.action === 'OPERATOR_READ').length, 1);
    } finally {
      await harness.close();
    }
  });
});

test('PIVOT-007 adapter exposes denial-logging failure without suppressing the refusal', async () => {
  await withPivotDatabase({sqlFiles: schemaFiles, adminSqlFiles}, async db => {
    await seedPolicy(db);
    await seedTenant(db, {journals: [{id: 'j1', company: 'alpha', lines: [{debit: 1}, {account: '4000', credit: 1}]}]});
    await seedOperator(db);
    await seedGrant(db, {expiresAt: "now() - interval '1 minute'", startsAt: "now() - interval '2 hours'"});

    const harness = await buildAdapterHarness(db);
    try {
      const token = await harness.token();
      await db.adminQuery(`REVOKE INSERT ON operator.operator_audit FROM "${db.roles.operatorDefiner}"`);
      await assert.rejects(
        harness.adapter.read({token, tenantId: T1, resource: 'journals', action: ACTION, reason: 'denial failure'}),
        error => error.code === 'OPERATOR_GRANT_REQUIRED'
          && error.denialLoggingFailed === true
          && error.denialEvidence?.committed === false,
      );
      assert.equal((await auditRows(db)).length, 0);
      await db.adminQuery(`GRANT INSERT ON operator.operator_audit TO "${db.roles.operatorDefiner}"`);
    } finally {
      await harness.close();
    }
  });
});

test('PIVOT-007 adapter refuses policy drift before COMMIT and keeps rows private', async () => {
  await withPivotDatabase({sqlFiles: schemaFiles, adminSqlFiles}, async db => {
    await seedPolicy(db);
    await seedTenant(db, {journals: [{id: 'j1', company: 'alpha', lines: [{debit: 1}, {account: '4000', credit: 1}]}]});
    await seedOperator(db);
    await seedGrant(db);

    const harness = await buildAdapterHarness(db);
    try {
      const token = await harness.token();
      const drifted = createOperatorSupportRead({
        connectOperator: () => harness.operator.pool.connect(),
        inspectSession: harness.access.inspectSession,
        expectedPolicy: {...harness.expectedPolicy, maxSourceAgeSeconds: 60},
      });
      await assert.rejects(
        drifted.read({token, tenantId: T1, resource: 'journals', action: ACTION, reason: 'drift'}),
        error => error.code === 'OPERATOR_POLICY_DRIFT' && error.denialEvidence?.committed === true,
      );
      const audit = await auditRows(db);
      assert.equal(audit.filter(row => row.action === 'OPERATOR_READ').length, 0);
      assert.equal(audit.at(-1).payload_jsonb.denialCode, 'OPERATOR_POLICY_DRIFT');
    } finally {
      await harness.close();
    }
  });
});

test('PIVOT-007 adapter rejects unverified bearers and never exposes bearer material', async () => {
  await withPivotDatabase({sqlFiles: schemaFiles, adminSqlFiles}, async db => {
    await seedPolicy(db);
    await seedTenant(db, {journals: [{id: 'j1', company: 'alpha', lines: [{debit: 1}, {account: '4000', credit: 1}]}]});
    await seedOperator(db);
    await seedGrant(db);

    const harness = await buildAdapterHarness(db);
    try {
      const forged = 'forged-bearer-value-that-is-not-a-session';
      let failure;
      try {
        await harness.adapter.read({token: forged, tenantId: T1, resource: 'journals', action: ACTION, reason: 'forged'});
      } catch (error) {
        failure = error;
      }
      assert.ok(failure);
      assert.equal(failure.code, 'OPERATOR_ADMISSION_DENIED');
      assert.equal(failure.denialEvidence?.committed, true);
      assert.equal(failure.denialLoggingFailed, false);
      const serialized = JSON.stringify({message: failure.message, code: failure.code});
      assert.equal(serialized.includes(forged), false);
      const audit = await auditRows(db);
      assert.equal(audit.length, 1);
      assert.equal(audit[0].actor_id, 'unverified');
      assert.equal(audit[0].payload_jsonb.claimedSubject, null);
    } finally {
      await harness.close();
    }
  });
});


test('PIVOT-007 adapter reserves customer consent through publication COMMIT', async () => {
  await withPivotDatabase({sqlFiles: schemaFiles, adminSqlFiles}, async db => {
    await seedPolicy(db);
    await seedTenant(db, {journals: [{id: 'j1', company: 'alpha', lines: [{debit: 1}, {account: '4000', credit: 1}]}]});
    await seedOperator(db);
    await seedGrant(db);

    const harness = await buildAdapterHarness(db);
    try {
      const token = await harness.token();
      let releaseCommit;
      let enterCommit;
      const commitGate = new Promise(resolve => {
        releaseCommit = resolve;
      });
      const commitEntered = new Promise(resolve => {
        enterCommit = resolve;
      });
      const adapter = createOperatorSupportRead({
        connectOperator: async () => {
          const client = await harness.operator.pool.connect();
          return {
            query: async (sql, params) => {
              if (sql === 'COMMIT') {
                enterCommit();
                await commitGate;
              }
              return client.query(sql, params);
            },
            release: destroy => client.release(destroy),
          };
        },
        inspectSession: harness.access.inspectSession,
        expectedPolicy: harness.expectedPolicy,
      });

      const pending = adapter.read({
        token, tenantId: T1, resource: 'journals', action: ACTION, reason: 'reservation through commit',
      });
      await commitEntered;

      // The read holds the consent gate until COMMIT, so revocation must block.
      await db.adminQuery(`SET lock_timeout = '250ms'`);
      await assert.rejects(
        db.adminQuery(`
          UPDATE tenant_data.support_grants SET revoked_at = now()
          WHERE tenant_id = $1::uuid AND grant_id = 'grant-1'
        `, [T1]),
        /lock timeout/,
      );
      await db.adminQuery('RESET lock_timeout');

      releaseCommit();
      const result = await pending;
      assert.equal(result.rowCount, 1);
      assert.equal((await auditRows(db)).filter(row => row.action === 'OPERATOR_READ').length, 1);

      // After publication COMMIT the writer proceeds and the next read observes it.
      await db.adminQuery(`
        UPDATE tenant_data.support_grants SET revoked_at = now()
        WHERE tenant_id = $1::uuid AND grant_id = 'grant-1'
      `, [T1]);
      await assert.rejects(
        harness.adapter.read({token, tenantId: T1, resource: 'journals', action: ACTION, reason: 'after revoke'}),
        error => error.code === 'OPERATOR_GRANT_REQUIRED',
      );
    } finally {
      await harness.close();
    }
  });
});

test('PIVOT-007 adapter survives a rollback fault and still records the refusal', async () => {
  await withPivotDatabase({sqlFiles: schemaFiles, adminSqlFiles}, async db => {
    await seedPolicy(db);
    await seedTenant(db, {journals: [{id: 'j1', company: 'alpha', lines: [{debit: 1}, {account: '4000', credit: 1}]}]});
    await seedOperator(db);
    await seedGrant(db, {expiresAt: "now() - interval '1 minute'", startsAt: "now() - interval '2 hours'"});

    const harness = await buildAdapterHarness(db);
    try {
      const token = await harness.token();
      let rollbackAttempts = 0;
      const adapter = createOperatorSupportRead({
        connectOperator: async () => {
          const client = await harness.operator.pool.connect();
          return {
            query: async (sql, params) => {
              if (sql === 'ROLLBACK' && rollbackAttempts++ === 0) {
                throw new Error('simulated rollback failure');
              }
              return client.query(sql, params);
            },
            release: destroy => client.release(destroy),
          };
        },
        inspectSession: harness.access.inspectSession,
        expectedPolicy: harness.expectedPolicy,
      });

      await assert.rejects(
        adapter.read({token, tenantId: T1, resource: 'journals', action: ACTION, reason: 'rollback fault'}),
        error => error.code === 'OPERATOR_GRANT_REQUIRED'
          && error.denialEvidence?.committed === true,
      );
      const audit = await auditRows(db);
      assert.equal(audit.filter(row => row.action === 'OPERATOR_READ').length, 0);
      assert.equal(audit.filter(row => row.action === 'OPERATOR_READ_DENIED').length, 1);
      assert.equal(audit.at(-1).payload_jsonb.attribution, 'verified');
    } finally {
      await harness.close();
    }
  });
});


test('PIVOT-007 adapter compares the actual AUTH-007 age/skew descriptor, not expected values', async () => {
  await withPivotDatabase({sqlFiles: schemaFiles, adminSqlFiles}, async db => {
    await seedPolicy(db, {maxSkew: 60});
    await seedTenant(db, {journals: [{id: 'j1', company: 'alpha', lines: [{debit: 1}, {account: '4000', credit: 1}]}]});
    await seedOperator(db);
    await seedGrant(db);

    // The real validator captures skew 30; SQL/adapter expect 60. Matching expected objects
    // cannot repair an unobserved mismatch with the actual validator configuration.
    const harness = await buildAdapterHarness(db, {
      validatorSkew: 30,
      expectedPolicyOverrides: {maxClockSkewSeconds: 60},
    });
    try {
      assert.deepEqual(harness.access.policy, {
        issuer: ISSUER,
        audience: AUDIENCE,
        requiredAssurance: 'access_mfa',
        maxSourceAgeSeconds: 300,
        maxClockSkewSeconds: 30,
      });
      const token = await harness.token();
      await assert.rejects(
        harness.adapter.read({token, tenantId: T1, resource: 'journals', action: ACTION, reason: 'skew drift'}),
        error => error.code === 'OPERATOR_POLICY_DRIFT' && error.denialEvidence?.committed === true,
      );
      assert.equal((await auditRows(db)).filter(row => row.action === 'OPERATOR_READ').length, 0);

      // Source-age drift is independent of skew.
      await db.adminQuery(`
        UPDATE operator.access_read_policy SET max_source_age_seconds = 200 WHERE policy_key = 'operator_read'
      `);
      const ageHarness = await buildAdapterHarness(db, {
        validatorMaxAge: 300,
        expectedPolicyOverrides: {maxSourceAgeSeconds: 200},
      });
      try {
        const ageToken = await ageHarness.token();
        await assert.rejects(
          ageHarness.adapter.read({token: ageToken, tenantId: T1, resource: 'journals', action: ACTION, reason: 'age drift'}),
          error => error.code === 'OPERATOR_POLICY_DRIFT',
        );
      } finally {
        await ageHarness.close();
      }
    } finally {
      await harness.close();
    }
  });
});

test('PIVOT-007 adapter refuses post-preflight source-age boundary crossing with a permitted control', async () => {
  await withPivotDatabase({sqlFiles: schemaFiles, adminSqlFiles}, async db => {
    await seedPolicy(db, {maxSourceAge: 5, maxSkew: 2});
    await seedTenant(db, {journals: [{id: 'j1', company: 'alpha', lines: [{debit: 1}, {account: '4000', credit: 1}]}]});
    await seedOperator(db);
    await seedGrant(db);

    const harness = await buildAdapterHarness(db, {validatorMaxAge: 5, validatorSkew: 2});
    try {
      const at = Math.floor(Date.now() / 1000);
      const delayed = delayMs => {
        const read = harness.access.inspectSession;
        return async token => {
          const admitted = await read(token);
          await sleep(delayMs);
          return admitted;
        };
      };

      // Preflight passes at age 6 (ceiling 5+2); after the wait SQL sees >7 and refuses.
      const near = await harness.token({iat: at - 6, nbf: at - 6, exp: at + 300});
      const crossing = createOperatorSupportRead({
        connectOperator: () => harness.operator.pool.connect(),
        inspectSession: delayed(2000),
        expectedPolicy: harness.expectedPolicy,
      });
      await assert.rejects(
        crossing.read({token: near, tenantId: T1, resource: 'journals', action: ACTION, reason: 'crossing'}),
        error => error.code === 'OPERATOR_ACCESS_EXPIRED',
      );
      assert.equal((await auditRows(db)).filter(row => row.action === 'OPERATOR_READ').length, 0);

      // Permitted control: inside the same configured window after the wait.
      const inside = await harness.token({iat: at - 2, nbf: at - 2, exp: at + 300});
      const permitted = createOperatorSupportRead({
        connectOperator: () => harness.operator.pool.connect(),
        inspectSession: delayed(500),
        expectedPolicy: harness.expectedPolicy,
      });
      assert.equal((await permitted.read({
        token: inside, tenantId: T1, resource: 'journals', action: ACTION, reason: 'permitted',
      })).rowCount, 1);
    } finally {
      await harness.close();
    }
  });
});

test('PIVOT-007 revalidates policy expiry after the consent-gate wait and serializes policy writers', async () => {
  await withPivotDatabase({sqlFiles: schemaFiles, adminSqlFiles}, async db => {
    await seedPolicy(db);
    await seedTenant(db, {journals: [{id: 'j1', company: 'alpha', lines: [{debit: 1}, {account: '4000', credit: 1}]}]});
    await seedOperator(db);
    await seedGrant(db);

    await db.adminQuery('BEGIN');
    await db.adminQuery("SELECT pg_advisory_xact_lock(hashtextextended('saven.operator.consent_gate', 0))");
    await db.adminQuery(`
      UPDATE operator.access_read_policy SET effective_to = now() + interval '1 second'
      WHERE policy_key = 'operator_read'
    `);
    const pending = asOperator(db, SESSION, client => read(client));
    await sleep(1800);
    await db.adminQuery('COMMIT');
    await assert.rejects(pending, /OPERATOR_POLICY_REQUIRED/);
    assert.equal((await auditRows(db)).filter(row => row.action === 'OPERATOR_READ').length, 0);

    // Permitted control: a still-effective policy with the same wait.
    await db.adminQuery(`
      UPDATE operator.access_read_policy SET effective_to = now() + interval '1 hour'
      WHERE policy_key = 'operator_read'
    `);
    await db.adminQuery('BEGIN');
    await db.adminQuery("SELECT pg_advisory_xact_lock(hashtextextended('saven.operator.consent_gate', 0))");
    const permitted = asOperator(db, SESSION, client => read(client));
    await sleep(500);
    await db.adminQuery('COMMIT');
    assert.equal((await permitted).rowCount, 1);

    // The adapter holds the policy gate through publication COMMIT: a policy write blocks.
    const harness = await buildAdapterHarness(db);
    try {
      const token = await harness.token();
      let releaseCommit;
      let enterCommit;
      const commitGate = new Promise(resolve => {
        releaseCommit = resolve;
      });
      const commitEntered = new Promise(resolve => {
        enterCommit = resolve;
      });
      const adapter = createOperatorSupportRead({
        connectOperator: async () => {
          const client = await harness.operator.pool.connect();
          return {
            query: async (sql, params) => {
              if (sql === 'COMMIT') {
                enterCommit();
                await commitGate;
              }
              return client.query(sql, params);
            },
            release: destroy => client.release(destroy),
          };
        },
        inspectSession: harness.access.inspectSession,
        expectedPolicy: harness.expectedPolicy,
      });
      const publishing = adapter.read({
        token, tenantId: T1, resource: 'journals', action: ACTION, reason: 'policy writer block',
      });
      await commitEntered;
      await db.adminQuery(`SET lock_timeout = '250ms'`);
      await assert.rejects(
        db.adminQuery(`
          UPDATE operator.access_read_policy SET effective_to = now() + interval '2 hours'
          WHERE policy_key = 'operator_read'
        `),
        /lock timeout/,
      );
      await db.adminQuery('RESET lock_timeout');
      releaseCommit();
      assert.equal((await publishing).rowCount, 1);
    } finally {
      await harness.close();
    }
  });
});

test('PIVOT-007 adapter records early bearer refusals and exposes logging outage', async () => {
  await withPivotDatabase({sqlFiles: schemaFiles, adminSqlFiles}, async db => {
    await seedPolicy(db);
    await seedTenant(db, {journals: [{id: 'j1', company: 'alpha', lines: [{debit: 1}, {account: '4000', credit: 1}]}]});
    await seedOperator(db);
    await seedGrant(db);

    const harness = await buildAdapterHarness(db);
    try {
      const base = {tenantId: T1, resource: 'journals', action: ACTION, reason: 'bearer shape'};
      for (const token of [null, 'short-token', 'x'.repeat(20000)]) {
        await assert.rejects(
          harness.adapter.read({...base, token}),
          error => error.code === 'OPERATOR_CONTEXT_REQUIRED' && error.denialEvidence?.committed === true,
        );
      }
      let audit = await auditRows(db);
      assert.equal(audit.length, 3);
      for (const row of audit) {
        assert.equal(row.action, 'OPERATOR_READ_DENIED');
        assert.equal(row.actor_id, 'unverified');
        assert.equal(row.payload_jsonb.attribution, 'unverified');
        assert.equal(row.payload_jsonb.claimedSubject, null);
      }
      assert.equal(JSON.stringify(audit).includes('x'.repeat(64)), false);

      const token = await harness.token();
      assert.equal((await harness.adapter.read({...base, token})).rowCount, 1);
      assert.equal((await auditRows(db)).filter(row => row.action === 'OPERATOR_READ').length, 1);

      // Logging outage preserves the original authentication refusal and is observable.
      await db.adminQuery(`REVOKE INSERT ON operator.operator_audit FROM "${db.roles.operatorDefiner}"`);
      await assert.rejects(
        harness.adapter.read({...base, token: 'short-token'}),
        error => error.code === 'OPERATOR_CONTEXT_REQUIRED'
          && error.denialLoggingFailed === true
          && error.denialEvidence?.committed === false,
      );
      await db.adminQuery(`GRANT INSERT ON operator.operator_audit TO "${db.roles.operatorDefiner}"`);
    } finally {
      await harness.close();
    }
  });
});
