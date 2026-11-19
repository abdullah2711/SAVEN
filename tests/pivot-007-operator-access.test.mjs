import test from 'node:test';
import assert from 'node:assert/strict';
import {withPivotDatabase} from './helpers/pg-pivot-fixture.mjs';

// PIVOT-007: function-mediated, customer-granted operator reads with durable
// accountability. Every test runs against a disposable PostgreSQL cluster
// (SAVEN_PIVOT_TEST_CLUSTER=1) and exercises the real installed roles/SQL.

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

const READ_SQL =
  'SELECT operator.read_tenant_support($1::uuid,$2,$3,$4,$5,$6,$7) AS result';
const DENY_SQL =
  'SELECT operator.log_operator_read_denial($1::uuid,$2,$3,$4,$5,$6,$7)';

const T1 = '11111111-1111-4111-8111-111111111111';
const T2 = '22222222-2222-4222-8222-222222222222';
const U1 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const U2 = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const OP_USER = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const SESSION = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const SUBJECT = 'access-subject-1';
const ACTION = 'operator.tenant.read';
const READ_RESOURCES = [
  'business',
  'company_profiles',
  'accounts',
  'journals',
  'journal_lines',
];

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
    overrides.resource ?? 'journals',
    overrides.action ?? ACTION,
    overrides.company ?? null,
    overrides.reason ?? 'support case 1',
    overrides.requestId ?? null,
    overrides.limit ?? 200,
  ]);
  return response.rows[0].result;
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
    VALUES ($1::uuid, $2::uuid, repeat('a', 64), 'operator', $3, 'access_asserted', 1,
            now() + interval '1 hour', now() + interval '2 hours')
  `, [session, user, role]);
  await db.adminQuery(`
    INSERT INTO operator.access_session_binding(
      session_id, subject, issuer, audience, mapping_epoch, operator_role_id,
      assurance_class, binding_scheme, source_issued_at, source_expires_at)
    SELECT $1::uuid, $2, 'https://saven.cloudflareaccess.com', 'saven-operator',
           mapping_epoch, operator_role_id, assurance_class, 'generation-v1',
           now() - interval '5 minutes', now() + interval '30 minutes'
    FROM operator.access_identity WHERE subject = $2
  `, [session, subject]);
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

const functionOid = async (db, name) => (await db.adminQuery(`
  SELECT p.oid
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'operator' AND p.proname = $1
`, [name])).rows[0]?.oid;

test('PIVOT-007 installs two definer functions with a fixed search_path and a read-only EXECUTE allow-list', async () => {
  await withPivotDatabase({sqlFiles: schemaFiles, adminSqlFiles}, async db => {
    const functions = (await db.adminQuery(`
      SELECT p.proname, pg_get_userbyid(p.proowner) AS owner_name, p.prosecdef, p.proconfig, p.oid
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'operator'
        AND p.proname IN ('read_tenant_support', 'log_operator_read_denial')
      ORDER BY p.proname
    `)).rows;
    assert.equal(functions.length, 2);
    for (const fn of functions) {
      assert.equal(fn.owner_name, db.roles.operatorDefiner, `${fn.proname} owner`);
      assert.equal(fn.prosecdef, true, `${fn.proname} must be SECURITY DEFINER`);
      assert.deepEqual(fn.proconfig, ['search_path=pg_catalog, operator, tenant_data']);
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
          `${fn.proname} must not be executable by ${role}`,
        );
      }
      const publicExecute = (await db.adminQuery(`
        SELECT 1 AS present
        FROM pg_proc p,
             LATERAL aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
        WHERE p.oid = $1 AND a.grantee = 0 AND a.privilege_type = 'EXECUTE'
      `, [fn.oid])).rowCount;
      assert.equal(publicExecute, 0, `${fn.proname} must not grant EXECUTE to PUBLIC`);
    }

    const definer = (await db.adminQuery(`
      SELECT rolcanlogin, rolsuper, rolcreatedb, rolcreaterole, rolinherit, rolbypassrls, rolreplication
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
    });

    const surfaces = (await db.adminQuery(`
      SELECT
        has_schema_privilege($1, 'tenant_data', 'USAGE') AS schema_usage,
        has_table_privilege($1, 'tenant_data.journals', 'SELECT') AS journals_select,
        has_table_privilege($1, 'tenant_data.support_grants', 'SELECT') AS grants_select,
        has_table_privilege($1, 'operator.operator_audit', 'INSERT') AS audit_insert
    `, [db.roles.operatorRead])).rows[0];
    assert.deepEqual(surfaces, {
      schema_usage: false,
      journals_select: false,
      grants_select: false,
      audit_insert: false,
    });

    // The read function's actor column is the local operator identity; the verified Access
    // subject is retained in the payload rather than trusted as an argument.
    const readOid = await functionOid(db, 'read_tenant_support');
    assert.ok(readOid);
    const denyOid = await functionOid(db, 'log_operator_read_denial');
    assert.ok(denyOid);
  });
});

test('PIVOT-007 reads a granted tenant and commits exactly one atomic operator audit row', async () => {
  await withPivotDatabase({sqlFiles: schemaFiles, adminSqlFiles}, async db => {
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
    assert.equal(result.truncated, false);
    assert.equal(result.rows.length, 1);
    assert.equal(result.rows[0].id, 'journal-a1');

    const audit = await auditRows(db);
    assert.equal(audit.length, 1);
    assert.equal(audit[0].actor_id, OP_USER);
    assert.equal(audit[0].action, 'OPERATOR_READ');
    assert.equal(audit[0].tenant_id, T1);
    assert.equal(audit[0].reason, 'support case 1');
    assert.equal(audit[0].payload_jsonb.action, ACTION);
    assert.equal(audit[0].payload_jsonb.grantId, 'grant-1');
    assert.equal(audit[0].payload_jsonb.operatorSubject, SUBJECT);
    assert.equal(audit[0].payload_jsonb.rowCount, 1);
    assert.equal(audit[0].payload_jsonb.sessionId, SESSION);
  });
});

test('PIVOT-007 denies missing, forged, stale and expired operator identity', async () => {
  await withPivotDatabase({sqlFiles: schemaFiles, adminSqlFiles}, async db => {
    await seedTenant(db, {journals: [{id: 'j1', company: 'alpha', lines: [{debit: 1}, {account: '4000', credit: 1}]}]});
    await seedOperator(db);
    await seedGrant(db);

    await assert.rejects(asOperator(db, null, client => read(client)), /OPERATOR_CONTEXT_REQUIRED/);
    await assert.rejects(
      asOperator(db, '99999999-9999-4999-8999-999999999999', client => read(client)),
      /OPERATOR_CONTEXT_REQUIRED/,
    );

    // Forged actor: the session binding points at an unmapped subject.
    await db.adminQuery(
      `UPDATE operator.access_session_binding SET subject = 'forged-subject' WHERE session_id = $1::uuid`,
      [SESSION],
    );
    await assert.rejects(asOperator(db, SESSION, client => read(client)), /OPERATOR_CONTEXT_REQUIRED/);
    await db.adminQuery(
      `UPDATE operator.access_session_binding SET subject = $2 WHERE session_id = $1::uuid`,
      [SESSION, SUBJECT],
    );

    // Stale mapping generation: a current-role change invalidates the bound session.
    await db.adminQuery(`
      UPDATE operator.access_identity SET operator_role_id = 'member' WHERE subject = $1
    `, [SUBJECT]);
    await assert.rejects(asOperator(db, SESSION, client => read(client)), /OPERATOR_ACCESS_DENIED/);
    await db.adminQuery(`
      UPDATE operator.access_identity SET operator_role_id = 'operator_admin' WHERE subject = $1
    `, [SUBJECT]);
    await syncBinding(db);

    // Revoked local session.
    await db.adminQuery(`UPDATE auth.sessions SET revoked_at = now() WHERE id = $1::uuid`, [SESSION]);
    await assert.rejects(asOperator(db, SESSION, client => read(client)), /OPERATOR_ACCESS_EXPIRED/);
    await db.adminQuery(`UPDATE auth.sessions SET revoked_at = NULL WHERE id = $1::uuid`, [SESSION]);

    // Expired Access source assertion.
    await db.adminQuery(`
      UPDATE operator.access_session_binding
      SET created_at = now() - interval '2 hours',
          source_expires_at = now() - interval '1 minute'
      WHERE session_id = $1::uuid
    `, [SESSION]);
    await assert.rejects(asOperator(db, SESSION, client => read(client)), /OPERATOR_ACCESS_EXPIRED/);
    await db.adminQuery(`
      UPDATE operator.access_session_binding
      SET source_expires_at = now() + interval '30 minutes'
      WHERE session_id = $1::uuid
    `, [SESSION]);

    // Inactive local principal.
    await db.adminQuery(`UPDATE auth.users SET status = 'inactive' WHERE id = $1::uuid`, [OP_USER]);
    await assert.rejects(asOperator(db, SESSION, client => read(client)), /OPERATOR_ACCESS_DENIED/);
    await db.adminQuery(`UPDATE auth.users SET status = 'active' WHERE id = $1::uuid`, [OP_USER]);

    // A non-operator or non-MFA role grants no read authority.
    await db.adminQuery(`
      UPDATE operator.access_identity SET operator_role_id = 'member' WHERE subject = $1
    `, [SUBJECT]);
    await syncBinding(db);
    await assert.rejects(asOperator(db, SESSION, client => read(client)), /OPERATOR_ACCESS_DENIED/);
    await db.adminQuery(`
      UPDATE operator.access_identity SET operator_role_id = 'operator_admin' WHERE subject = $1
    `, [SUBJECT]);
    await syncBinding(db);
    await db.adminQuery(`UPDATE auth.roles SET requires_mfa = false WHERE role_id = 'operator_admin'`);
    await assert.rejects(asOperator(db, SESSION, client => read(client)), /OPERATOR_ACCESS_DENIED/);
    await db.adminQuery(`UPDATE auth.roles SET requires_mfa = true WHERE role_id = 'operator_admin'`);

    // First-factor-only assurance never satisfies the operator boundary.
    await db.adminQuery(`
      UPDATE operator.access_identity SET assurance_class = 'single_factor' WHERE subject = $1
    `, [SUBJECT]);
    await syncBinding(db);
    await assert.rejects(asOperator(db, SESSION, client => read(client)), /OPERATOR_ACCESS_DENIED/);
  });
});

test('PIVOT-007 requires a current customer grant and denies expired, revoked or inactive consent', async () => {
  await withPivotDatabase({sqlFiles: schemaFiles, adminSqlFiles}, async db => {
    await seedTenant(db, {journals: [{id: 'j1', company: 'alpha', lines: [{debit: 1}, {account: '4000', credit: 1}]}]});
    await seedOperator(db);

    await assert.rejects(asOperator(db, SESSION, client => read(client)), /OPERATOR_GRANT_REQUIRED/);

    await seedGrant(db);
    assert.equal((await asOperator(db, SESSION, client => read(client))).rowCount, 1);

    await db.adminQuery(`
      UPDATE tenant_data.support_grants
      SET starts_at = now() - interval '2 hours', expires_at = now() - interval '1 hour'
      WHERE tenant_id = $1::uuid AND grant_id = 'grant-1'
    `, [T1]);
    await assert.rejects(asOperator(db, SESSION, client => read(client)), /OPERATOR_GRANT_REQUIRED/);
    await db.adminQuery(`
      UPDATE tenant_data.support_grants
      SET expires_at = now() + interval '1 hour' WHERE tenant_id = $1::uuid AND grant_id = 'grant-1'
    `, [T1]);

    await db.adminQuery(`
      UPDATE tenant_data.support_grants SET revoked_at = now()
      WHERE tenant_id = $1::uuid AND grant_id = 'grant-1'
    `, [T1]);
    await assert.rejects(asOperator(db, SESSION, client => read(client)), /OPERATOR_GRANT_REQUIRED/);
    await db.adminQuery(`
      UPDATE tenant_data.support_grants SET revoked_at = NULL
      WHERE tenant_id = $1::uuid AND grant_id = 'grant-1'
    `, [T1]);

    await db.adminQuery(`
      UPDATE tenant_data.support_grants SET is_active = false
      WHERE tenant_id = $1::uuid AND grant_id = 'grant-1'
    `, [T1]);
    await assert.rejects(asOperator(db, SESSION, client => read(client)), /OPERATOR_GRANT_REQUIRED/);
    await db.adminQuery(`
      UPDATE tenant_data.support_grants SET is_active = true
      WHERE tenant_id = $1::uuid AND grant_id = 'grant-1'
    `, [T1]);

    // Consent is customer-authored: an inactive authoring principal no longer authorizes.
    await db.adminQuery(`
      UPDATE tenant_data.members SET active = false WHERE tenant_id = $1::uuid AND user_id = 'user-1'
    `, [T1]);
    await assert.rejects(asOperator(db, SESSION, client => read(client)), /OPERATOR_GRANT_REQUIRED/);
    await db.adminQuery(`
      UPDATE tenant_data.members SET active = true WHERE tenant_id = $1::uuid AND user_id = 'user-1'
    `, [T1]);

    // A reason string is never consent: with the grant removed the same reason and
    // operator/action still fail closed.
    await db.adminQuery('DELETE FROM tenant_data.support_grants');
    await assert.rejects(
      asOperator(db, SESSION, client => read(client, {reason: 'urgent customer request'})),
      /OPERATOR_GRANT_REQUIRED/,
    );
  });
});

test('PIVOT-007 refuses wrong tenant, company, action, resource and malformed scope', async () => {
  await withPivotDatabase({sqlFiles: schemaFiles, adminSqlFiles}, async db => {
    await seedTenant(db, {
      journals: [
        {id: 'j-alpha', company: 'alpha', lines: [{debit: 1}, {account: '4000', credit: 1}]},
        {id: 'j-beta', company: 'beta', lines: [{debit: 2}, {account: '4000', credit: 2}]},
      ],
    });
    await seedOperator(db);
    await seedGrant(db, {
      scope: {version: 1, resources: ['journals'], companies: ['alpha']},
    });

    await assert.rejects(
      asOperator(db, SESSION, client => read(client, {tenant: T2})),
      /OPERATOR_GRANT_REQUIRED/,
    );
    await assert.rejects(
      asOperator(db, SESSION, client => read(client, {company: 'beta'})),
      /OPERATOR_GRANT_REQUIRED/,
    );
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
    await assert.rejects(
      asOperator(db, SESSION, client => read(client, {reason: '   '})),
      /OPERATOR_ARGUMENT_INVALID/,
    );
    await assert.rejects(
      asOperator(db, SESSION, client => read(client, {limit: 0})),
      /OPERATOR_ARGUMENT_INVALID/,
    );
    await assert.rejects(
      asOperator(db, SESSION, client => read(client, {limit: 501})),
      /OPERATOR_ARGUMENT_INVALID/,
    );

    // Malformed or unversioned scope data never widens authority.
    for (const scopeRaw of [
      JSON.stringify({version: 1, resources: ['journals'], companies: ['alpha'], extra: true}),
      JSON.stringify({resources: ['journals'], companies: ['alpha']}),
      JSON.stringify({version: 2, resources: ['journals'], companies: ['alpha']}),
      JSON.stringify({version: 1, resources: 'journals', companies: ['alpha']}),
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
      UPDATE tenant_data.support_grants SET actions_jsonb = '"operator.tenant.read"'::jsonb
      WHERE tenant_id = $1::uuid AND grant_id = 'grant-1'
    `, [T1]);
    await assert.rejects(asOperator(db, SESSION, client => read(client)), /OPERATOR_GRANT_REQUIRED/);
  });
});

test('PIVOT-007 applies company scope, exact minor-unit money and bounded row limits', async () => {
  await withPivotDatabase({sqlFiles: schemaFiles, adminSqlFiles}, async db => {
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
    assert.equal(limited.rows.length, 1);
  });
});

test('PIVOT-007 ignores caller search_path and temporary relation shadows', async () => {
  await withPivotDatabase({sqlFiles: schemaFiles, adminSqlFiles}, async db => {
    await seedTenant(db, {
      journals: [
        {id: 'real-journal', company: 'alpha', lines: [{debit: 1}, {account: '4000', credit: 1}]},
      ],
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

test('PIVOT-007 rolls back read and audit together and records denials in an independent transaction', async () => {
  await withPivotDatabase({sqlFiles: schemaFiles, adminSqlFiles}, async db => {
    await seedTenant(db, {
      journals: [
        {id: 'j1', company: 'alpha', lines: [{debit: 1}, {account: '4000', credit: 1}]},
      ],
    });
    await seedOperator(db);
    await seedGrant(db);

    // Default fixture behaviour commits nothing: the read result is visible to the caller,
    // but the read and its audit row are rolled back together.
    const rolledBack = await asOperator(db, SESSION, client => read(client));
    assert.equal(rolledBack.rowCount, 1);
    assert.equal((await auditRows(db)).length, 0);

    // A successful read cannot exist without its audit row: with the definer's audit
    // INSERT revoked, the whole call fails and returns nothing.
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

    // A fresh transaction writes durable denial evidence. A preceding in-transaction
    // insert is never asserted to survive; this call is separate by construction.
    await asOperator(db, SESSION, client => client.query(DENY_SQL, [
      T1, 'journals', ACTION, null, 'OPERATOR_GRANT_REQUIRED', 'support grant expired', 'req-deny-1',
    ]), {commit: true});

    const audit = await auditRows(db);
    assert.equal(audit.length, 1);
    assert.equal(audit[0].action, 'OPERATOR_READ_DENIED');
    assert.equal(audit[0].actor_id, OP_USER);
    assert.equal(audit[0].tenant_id, T1);
    assert.equal(audit[0].payload_jsonb.denialCode, 'OPERATOR_GRANT_REQUIRED');
    assert.equal(audit[0].payload_jsonb.durability, 'independent-transaction');
    assert.equal(audit[0].payload_jsonb.claimedSessionId, SESSION);
  });
});

test('PIVOT-007 keeps tenant rows unreachable except through the mediated read and ignores caller tenant context', async () => {
  await withPivotDatabase({sqlFiles: schemaFiles, adminSqlFiles}, async db => {
    await seedTenant(db, {
      companies: ['alpha'],
      journals: [
        {id: 't1-journal', company: 'alpha', lines: [{debit: 1}, {account: '4000', credit: 1}]},
      ],
    });
    await seedTenant(db, {
      tenant: T2,
      user: U2,
      legacy: 'user-2',
      companies: ['beta'],
      journals: [
        {id: 't2-journal', company: 'beta', lines: [{debit: 2}, {account: '4000', credit: 2}]},
      ],
    });
    await seedOperator(db);
    await seedGrant(db, {scope: {version: 1, resources: ['journals'], companies: ['alpha']}});
    await seedGrant(db, {
      tenant: T2,
      grantId: 'grant-2',
      grantedBy: 'user-2',
      scope: {version: 1, resources: ['journals'], companies: ['beta']},
    });

    const crossTenant = await asOperator(db, SESSION, async client => {
      await client.query('SELECT set_config($1, $2, true)', ['app.current_tenant_id', T1]);
      await client.query('SELECT set_config($1, $2, true)', ['app.current_user_id', U1]);
      const result = await read(client, {tenant: T2});
      const after = (await client.query(
        "SELECT current_setting('app.current_tenant_id', true) AS value",
      )).rows[0].value;
      return {result, after};
    }, {commit: true});
    assert.equal(crossTenant.result.tenantId, T2);
    assert.deepEqual(crossTenant.result.rows.map(row => row.id), ['t2-journal']);
    assert.equal(crossTenant.after, T1, 'the caller transaction context must be restored');

    await assert.rejects(
      db.asRole('operatorRead', client => client.query('SELECT id FROM tenant_data.journals LIMIT 1')),
      /permission denied/,
    );
    await assert.rejects(
      db.asRole('operatorRead', client => client.query(
        "INSERT INTO operator.operator_audit(actor_id, action) VALUES ('forged', 'FORGED')",
      )),
      /permission denied/,
    );
    await assert.rejects(
      db.asRole('operatorRead', client => client.query(`SET LOCAL ROLE "${db.roles.operatorDefiner}"`)),
      /permission denied/,
    );

    // The append-only operator audit accepts no UPDATE even from an administrator.
    await assert.rejects(
      db.adminQuery('UPDATE operator.operator_audit SET action = action'),
      /OPERATOR_RECORD_IMMUTABLE/,
    );
  });
});
