import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {withPivotDatabase} from './helpers/pg-pivot-fixture.mjs';

const repoRoot = new URL('../', import.meta.url);
// Apply the accepted PIVOT-002 base and this contract's schema so the gate proves
// the tenant skeleton lands on a real operator schema, not an empty database.
// AUTH-001 owns auth.* on a separate branch and is not a dependency of this file.
const schemaFiles = ['db/postgres/10-operator-schema.sql', 'db/postgres/20-tenant-schema.sql'];

const tenantA = '11111111-1111-4111-8111-111111111111';
const tenantB = '22222222-2222-4222-8222-222222222222';

// Every Purpose B/C table this skeleton must provide. Source tables follow
// docs/pivot-notes/02-three-purposes.md; the tail is the new Purpose C/B set.
const expectedTables = [
  'account_profiles',
  'accounts',
  'approval_policy',
  'approval_requests',
  'assignments',
  'audit',
  'audit_event',
  'business',
  'business_rule',
  'command_decisions',
  'command_files',
  'command_inbox',
  'company_profiles',
  'company_settings',
  'denials',
  'document_numbers',
  'document_registry',
  'document_revisions',
  'document_sequences',
  'inventory_controls',
  'journal_corrections',
  'journal_drafts',
  'journal_lines',
  'journals',
  'members',
  'outbox',
  'periods',
  'posting_constraint',
  'reference_values',
  'roles',
  'source_store_migrations',
  'stock_balances',
  'stock_items',
  'stock_movements',
  'stock_operations',
  'support_grants',
  'tax_profile',
  'trade_allocations',
  'trade_controls',
  'trade_credit_lines',
  'trade_credits',
  'trade_documents',
  'trade_lines',
  'trade_operations',
  'trade_parties',
  'verified_entitlement',
  'warehouses',
];

function tableBodies(sql) {
  const tables = new Map();
  const pattern = /CREATE TABLE tenant_data\.([a-z_]+) \(\n([\s\S]*?)\n\);/g;
  let match;
  while ((match = pattern.exec(sql)) !== null) tables.set(match[1], match[2]);
  return tables;
}

function tableColumns(body) {
  const columns = new Map();
  for (const rawLine of body.split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('--')) continue;
    if (/^(CONSTRAINT|PRIMARY KEY|FOREIGN KEY|UNIQUE|CHECK|REFERENCES)\b/.test(line)) continue;
    const match = /^([a-z_][a-z0-9_]*)\s+([a-z]+(?:\([^)]*\))?)/.exec(line);
    if (match) {
      const definition = line.slice(match[1].length).trim().replace(/,$/, '');
      columns.set(match[1], {type: match[2], definition});
    }
  }
  return columns;
}

const moneyColumns = new Set([
  'debit',
  'credit',
  'total',
  'amount',
  'value',
  'value_delta',
  'quantity',
  'quantity_delta',
  'byte_size',
  'max_self_approval_amount',
  'approval_threshold_amount',
]);

test('PIVOT-003 static schema contract: scoped tenant tables, exact money, no growing enums', async () => {
  const sql = await readFile(new URL('db/postgres/20-tenant-schema.sql', repoRoot), 'utf8');
  const rules = JSON.parse(await readFile(new URL('contracts/postgres-business-rules-v1.json', repoRoot), 'utf8'));

  // No secrets, no DSNs, no privileged escape hatch, no duplicated identity.
  assert.doesNotMatch(sql, /\bPASSWORD\b|postgres(?:ql)?:\/\//i);
  assert.doesNotMatch(sql, /BYPASSRLS|SUPERUSER/i);
  assert.doesNotMatch(sql, /CREATE TABLE[^;]*\bai_proposal\b/i);
  assert.doesNotMatch(sql, /CREATE TABLE[^;]*\b(?:user_identity|tenant_membership)\b/i);
  assert.doesNotMatch(sql, /CREATE TABLE (?:IF NOT EXISTS )?(?:auth|operator)\./i);

  // Cross-schema foreign keys are deliberately deferred to PIVOT-004 so the
  // Fully Private composition never depends on vendor operator tables.
  assert.doesNotMatch(sql, /REFERENCES\s+(?:operator|auth)\./i);

  // One tenant schema, no second business schema.
  assert.equal((sql.match(/CREATE SCHEMA /g) ?? []).length, 1);
  assert.match(sql, /CREATE SCHEMA tenant_data;/);

  // RLS policies, runtime grants, immutability triggers and audit triggers are
  // later contracts; this skeleton must stay default-deny.
  assert.doesNotMatch(sql, /(?:ENABLE|FORCE)\s+ROW\s+LEVEL\s+SECURITY/i);
  assert.doesNotMatch(sql, /CREATE\s+POLICY/i);
  assert.doesNotMatch(sql, /CREATE\s+(?:OR\s+REPLACE\s+)?(?:TRIGGER|FUNCTION)/i);
  assert.doesNotMatch(
    sql,
    /GRANT\s+[^;]*\bTO\s+saven_(?:customer_app|auth_service|auth_definer|operator_read|operator_admin|operator_operator_definer)\b/i,
  );
  assert.match(sql, /REVOKE ALL ON SCHEMA tenant_data FROM saven_customer_app/);
  assert.match(sql, /REVOKE ALL ON SCHEMA tenant_data FROM saven_operator_read, saven_operator_admin/);

  // Growing domains are reference rows, never CHECK ... IN lists.
  assert.doesNotMatch(sql, /\bIN\s*\(\s*'/i);

  const tables = tableBodies(sql);
  assert.deepEqual([...tables.keys()].sort(), [...expectedTables].sort());

  for (const [table, body] of tables) {
    const columns = tableColumns(body);
    const first = [...columns.keys()][0];
    assert.equal(first, 'tenant_id', `${table} must lead with tenant_id`);
    assert.match(columns.get('tenant_id').definition, /^uuid NOT NULL$/, `${table}.tenant_id must be uuid NOT NULL`);
    assert.ok(columns.has('created_at'), `${table} must have created_at`);
    assert.ok(columns.has('updated_at'), `${table} must have updated_at`);
    assert.match(
      body,
      /PRIMARY KEY \(tenant_id(?:,| )/,
      `${table} primary key must lead with tenant_id`,
    );
    for (const match of body.matchAll(/UNIQUE \(([^)]*)\)/g)) {
      assert.equal(match[1].split(',')[0].trim(), 'tenant_id', `${table} unique key must include tenant_id`);
    }
    for (const match of body.matchAll(/REFERENCES tenant_data\.[a-z_]+ \(([^)]*)\)/g)) {
      assert.equal(
        match[1].split(',')[0].trim(),
        'tenant_id',
        `${table} foreign key must be tenant-scoped: ${match[0]}`,
      );
    }
    for (const match of body.matchAll(/FOREIGN KEY \(([^)]*)\)/g)) {
      assert.equal(match[1].split(',')[0].trim(), 'tenant_id', `${table} foreign key must lead with tenant_id`);
    }
    assert.doesNotMatch(body, /\b(?:real|double precision|money)\b/i, `${table} must not use floating-point money`);
    for (const [name, column] of columns) {
      if (moneyColumns.has(name) && !(table === 'reference_values' && name === 'value')) {
        assert.match(
          column.type,
          /^(?:bigint|integer|numeric\([0-9]+,\s*[0-9]+\))$/,
          `${table}.${name} must be exact (bigint/integer/numeric), found ${column.type}`,
        );
      }
    }
  }

  // Source-compatible financial columns and preserved bytes.
  const commandInbox = tableColumns(tables.get('command_inbox'));
  assert.equal(commandInbox.get('payload').type, 'text');
  assert.equal(commandInbox.get('digest').type, 'text');
  assert.equal(commandInbox.get('created_at').type, 'bigint');
  assert.equal(commandInbox.get('lease_until').type, 'bigint');
  const journalLines = tableColumns(tables.get('journal_lines'));
  assert.equal(journalLines.get('debit').type, 'bigint');
  assert.equal(journalLines.get('credit').type, 'bigint');
  assert.match(tables.get('journal_lines'), /journal_lines_debit_bounds CHECK \(debit >= 0 AND debit <= 999999999999\)/);
  assert.match(tables.get('journal_lines'), /journal_lines_one_side CHECK/);
  assert.match(tables.get('trade_documents'), /trade_documents_total_positive CHECK \(total > 0 AND total <= 999999999999\)/);
  assert.match(tables.get('document_numbers'), /UNIQUE \(tenant_id, company, kind, sequence\)/);
  assert.match(tables.get('document_numbers'), /UNIQUE \(tenant_id, company, number\)/);
  assert.match(tables.get('journal_drafts'), /journal_drafts_revision_positive CHECK \(revision > 0\)/);
  assert.match(tables.get('roles'), /roles_protected_is_ultimate_owner CHECK \(protected = \(id = 'ultimate_business_admin'\)\)/);
  assert.match(sql, /CREATE UNIQUE INDEX roles_one_protected_idx ON tenant_data\.roles \(tenant_id\) WHERE protected/);
  assert.match(
    sql,
    /CREATE UNIQUE INDEX assignments_one_ultimate_owner_idx ON tenant_data\.assignments \(tenant_id\)\n  WHERE role_id = 'ultimate_business_admin'/,
  );

  // Pending-document sidecars exist as ordinary tables; the accepted command
  // bytes stay where they are.
  const registry = tableColumns(tables.get('document_registry'));
  assert.equal(registry.get('document_status').type, 'text');
  assert.equal(registry.get('origin_type').type, 'text');
  const revisions = tableColumns(tables.get('document_revisions'));
  assert.equal(revisions.get('payload').type, 'text');
  assert.equal(revisions.get('payload_digest').type, 'text');
  assert.equal(revisions.get('policy_snapshot').type, 'jsonb');
  assert.match(tables.get('document_revisions'), /PRIMARY KEY \(tenant_id, document_id, revision\)/);
  assert.match(
    tables.get('document_registry'),
    /document_registry_current_command_fkey FOREIGN KEY \(tenant_id, source_command_id\)/,
  );

  // Phase 1 AI defaults are fail-safe at the schema level.
  assert.match(tables.get('approval_policy'), /ai_origin_direct_post_allowed boolean NOT NULL DEFAULT false/);
  assert.match(tables.get('approval_policy'), /editable_in_pending boolean NOT NULL DEFAULT true/);
  assert.match(tables.get('approval_policy'), /requires_different_approver boolean NOT NULL DEFAULT false/);

  // Reference domains: SQL annotations and the canonical seed must agree.
  const annotated = new Set([...sql.matchAll(/reference domain: ([a-z_]+)/g)].map(match => match[1]));
  const seeded = new Set(Object.keys(rules.reference_domains));
  assert.deepEqual([...annotated].sort(), [...seeded].sort());
  for (const [domain, definition] of Object.entries(rules.reference_domains)) {
    assert.ok(definition.values.length > 0, `${domain} must seed at least one value`);
    const values = definition.values.map(entry => entry.value);
    assert.equal(new Set(values).size, values.length, `${domain} values must be unique`);
  }
  assert.equal(rules.version, 1);
  assert.equal(rules.contract, 'saven.postgres-business-rules');
  assert.ok(rules.reference_domains.document_status.values.some(entry => entry.value === 'PENDING_APPROVAL'));
  assert.ok(rules.reference_domains.origin_type.values.some(entry => entry.value === 'ai'));
  assert.ok(rules.reference_domains.origin_type.values.some(entry => entry.value === 'human'));
  assert.equal(rules.approval_defaults.ai_origin_direct_post_allowed, false);
  assert.equal(rules.approval_defaults.editable_in_pending, true);
  assert.match(rules.extension_rule, /reference_values row, not a migration/);
  for (const [name, schema] of Object.entries(rules.json_schemas)) {
    assert.ok(schema.schema_version >= 1, `${name} must be versioned`);
    assert.equal(schema.$schema, 'https://json-schema.org/draft/2020-12/schema', `${name} must declare its schema dialect`);
    assert.ok(schema.$id, `${name} must be identified`);
    assert.ok(['object', 'array'].includes(schema.type), `${name} must declare a type`);
  }
  // The lowercase origin default in SQL must be a seeded domain value.
  assert.match(tables.get('audit_event'), /origin_type text NOT NULL DEFAULT 'human'/);
  assert.match(tables.get('document_registry'), /origin_type text NOT NULL DEFAULT 'human'/);
});

test('PIVOT-003 tenant schema applies with scoped identity, no RLS yet and no runtime grants', async () => {
  await withPivotDatabase({sqlFiles: schemaFiles}, async db => {
    const catalog = (
      await db.adminQuery(
        `SELECT c.relname, c.relrowsecurity, c.relforcerowsecurity, c.relowner::regrole::text AS owner
         FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
         WHERE n.nspname = 'tenant_data' AND c.relkind = 'r'
         ORDER BY c.relname`,
      )
    ).rows;
    assert.deepEqual(
      catalog.map(row => row.relname),
      [...expectedTables].sort(),
    );
    assert.ok(catalog.every(row => row.owner === db.roles.migrator), 'tenant tables must be owned by the offline migrator');
    assert.ok(
      catalog.every(row => row.relrowsecurity === false && row.relforcerowsecurity === false),
      'RLS is PIVOT-004; this skeleton must not claim tenant isolation',
    );

    const policyCount = (
      await db.adminQuery(
        `SELECT count(*)::int AS n
         FROM pg_policy p
         JOIN pg_class c ON c.oid = p.polrelid
         JOIN pg_namespace n ON n.oid = c.relnamespace
         WHERE n.nspname = 'tenant_data'`,
      )
    ).rows[0].n;
    assert.equal(policyCount, 0, 'no tenant policies may exist before PIVOT-004');

    const triggerCount = (
      await db.adminQuery(
        `SELECT count(*)::int AS n
         FROM pg_trigger t
         JOIN pg_class c ON c.oid = t.tgrelid
         JOIN pg_namespace n ON n.oid = c.relnamespace
         WHERE n.nspname = 'tenant_data' AND NOT t.tgisinternal`,
      )
    ).rows[0].n;
    assert.equal(triggerCount, 0, 'immutability/audit triggers belong to PIVOT-005/006');

    const tenantColumns = (
      await db.adminQuery(
        `SELECT c.relname, a.attname, a.attnotnull, format_type(a.atttypid, a.atttypmod) AS type, a.attnum
         FROM pg_class c
         JOIN pg_namespace n ON n.oid = c.relnamespace
         JOIN pg_attribute a ON a.attrelid = c.oid AND a.attname = 'tenant_id' AND a.attnum > 0
         WHERE n.nspname = 'tenant_data' AND c.relkind = 'r'
         ORDER BY c.relname`,
      )
    ).rows;
    assert.equal(tenantColumns.length, expectedTables.length, 'every tenant table must carry tenant_id');
    for (const column of tenantColumns) {
      assert.equal(column.attnotnull, true, `${column.relname}.tenant_id must be NOT NULL`);
      assert.equal(column.type, 'uuid', `${column.relname}.tenant_id must be uuid`);
      assert.equal(column.attnum, 1, `${column.relname}.tenant_id must be the leading column`);
    }

    const leadingKeys = (
      await db.adminQuery(
        `SELECT c.relname, a.attname
         FROM pg_index i
         JOIN pg_class c ON c.oid = i.indrelid
         JOIN pg_namespace n ON n.oid = c.relnamespace
         CROSS JOIN LATERAL unnest(i.indkey) WITH ORDINALITY AS k(attnum, ord)
         JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum = k.attnum
         WHERE n.nspname = 'tenant_data' AND i.indisprimary AND k.ord = 1
         ORDER BY c.relname`,
      )
    ).rows;
    assert.equal(leadingKeys.length, expectedTables.length, 'every tenant table must have a primary key');
    assert.ok(leadingKeys.every(row => row.attname === 'tenant_id'), 'every primary key must lead with tenant_id');

    const floating = (
      await db.adminQuery(
        `SELECT table_name, column_name, data_type FROM information_schema.columns
         WHERE table_schema = 'tenant_data' AND data_type IN ('real', 'double precision', 'money')`,
      )
    ).rows;
    assert.deepEqual(floating, [], 'tenant schema must not use floating-point or money types');

    const forbidden = (
      await db.adminQuery(
        `SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
         WHERE n.nspname = 'tenant_data' AND c.relname IN ('ai_proposal', 'user_identity', 'tenant_membership')`,
      )
    ).rows;
    assert.deepEqual(forbidden, [], 'no ai_proposal or duplicated identity/membership table may exist');

    const schemas = (
      await db.adminQuery(
        `SELECT nspname FROM pg_namespace WHERE nspname IN ('auth', 'tenant_data', 'operator') ORDER BY nspname`,
      )
    ).rows.map(row => row.nspname);
    assert.deepEqual(schemas, ['operator', 'tenant_data'], 'PIVOT-003 applies on the PIVOT-002 base and creates no competing schema');

    // The native text principal id is preserved; the UUID mapping and the
    // cross-schema link to auth.tenant_membership are PIVOT-004.
    const membersPrincipal = (
      await db.adminQuery(
        `SELECT format_type(a.atttypid, a.atttypmod) AS type
         FROM pg_attribute a
         JOIN pg_class c ON c.oid = a.attrelid
         JOIN pg_namespace n ON n.oid = c.relnamespace
         WHERE n.nspname = 'tenant_data' AND c.relname = 'members' AND a.attname = 'user_id'`,
      )
    ).rows[0].type;
    assert.equal(membersPrincipal, 'text', 'native text user ids must not be cast to uuid in the tenant skeleton');

    const crossSchemaKeys = (
      await db.adminQuery(
        `SELECT con.conname, n2.nspname AS parent_schema
         FROM pg_constraint con
         JOIN pg_class c ON c.oid = con.conrelid
         JOIN pg_namespace n1 ON n1.oid = c.relnamespace
         JOIN pg_class p ON p.oid = con.confrelid
         JOIN pg_namespace n2 ON n2.oid = p.relnamespace
         WHERE con.contype = 'f' AND n1.nspname = 'tenant_data'`,
      )
    ).rows;
    assert.ok(crossSchemaKeys.length > 20, 'tenant_data must carry its composite foreign keys');
    assert.ok(
      crossSchemaKeys.every(row => row.parent_schema === 'tenant_data'),
      'PIVOT-003 creates no cross-schema foreign key; PIVOT-004 finalizes the auth link',
    );

    await assert.rejects(
      () => db.asRole('customerApp', client => client.query('SELECT count(*) FROM tenant_data.accounts')),
      /permission denied for schema tenant_data/,
    );
    await assert.rejects(
      () => db.asRole('customerApp', client => client.query(
        `INSERT INTO tenant_data.business(tenant_id, id, state) VALUES('${tenantA}', 'alpha', 'ACTIVE')`,
      )),
      /permission denied for schema tenant_data/,
    );
    await assert.rejects(
      () => db.asRole('operatorRead', client => client.query('SELECT count(*) FROM tenant_data.accounts')),
      /permission denied for schema tenant_data/,
    );
    await assert.rejects(
      () => db.asRole('operatorAdmin', client => client.query('ALTER TABLE tenant_data.accounts ADD COLUMN probe integer')),
      /permission denied for schema tenant_data|must be owner/,
    );
  });
});

test('PIVOT-003 tenant constraints enforce scoped money, ownership and cross-tenant isolation', async () => {
  await withPivotDatabase({sqlFiles: schemaFiles}, async db => {
    await db.asRole(
      'migrator',
      async client => {
        await client.query(
          `INSERT INTO tenant_data.business(tenant_id, id, state) VALUES ($1, 'alpha', 'ACTIVE'), ($2, 'beta', 'ACTIVE')`,
          [tenantA, tenantB],
        );
        await client.query(
          `INSERT INTO tenant_data.members(tenant_id, user_id, active)
           VALUES ($1, 'owner-a', true), ($1, 'junior-a', true), ($2, 'owner-b', true)`,
          [tenantA, tenantB],
        );
        await client.query(
          `INSERT INTO tenant_data.roles(tenant_id, id, name, protected, permissions) VALUES
             ($1, 'ultimate_business_admin', 'Ultimate business owner', true, '{}'),
             ($1, 'clerk', 'Clerk', false, '{"journal.prepare":true}'),
             ($2, 'ultimate_business_admin', 'Ultimate business owner', true, '{}')`,
          [tenantA, tenantB],
        );
        await client.query(
          `INSERT INTO tenant_data.assignments(tenant_id, user_id, role_id)
           VALUES ($1, 'owner-a', 'ultimate_business_admin'), ($2, 'owner-b', 'ultimate_business_admin')`,
          [tenantA, tenantB],
        );
        await client.query(
          `INSERT INTO tenant_data.accounts(tenant_id, code, title)
           VALUES ($1, '1000', 'Cash'), ($1, '4000', 'Revenue'), ($2, '1000', 'Cash'), ($2, '9999', 'Only Beta')`,
          [tenantA, tenantB],
        );
        await client.query(
          `INSERT INTO tenant_data.company_profiles(tenant_id, id, name, currency, branch, created_at)
           VALUES ($1, 'alpha', 'Alpha', 'PKR', 'main', 0), ($2, 'beta', 'Beta', 'PKR', 'main', 0)`,
          [tenantA, tenantB],
        );
        await client.query(
          `INSERT INTO tenant_data.command_inbox(tenant_id, id, actor, digest, payload, state, created_at)
           VALUES ($1, 'cmd-a', 'owner-a', 'digest-a', '{"company":"alpha"}', 'ACCEPTED_PENDING', 0),
                  ($2, 'cmd-b', 'owner-b', 'digest-b', '{"company":"beta"}', 'ACCEPTED_PENDING', 0)`,
          [tenantA, tenantB],
        );
        await client.query(
          `INSERT INTO tenant_data.journals(tenant_id, id, company, branch, posting_date, narrative)
           VALUES ($1, 'cmd-a', 'alpha', 'main', '2026-11-15', 'Opening entry')`,
          [tenantA],
        );
        await client.query(
          `INSERT INTO tenant_data.journal_lines(tenant_id, journal_id, line_no, account, debit, credit)
           VALUES ($1, 'cmd-a', 1, '1000', 100, 0), ($1, 'cmd-a', 2, '4000', 0, 100)`,
          [tenantA],
        );
        await client.query(
          `INSERT INTO tenant_data.document_numbers(tenant_id, id, company, kind, sequence, number)
           VALUES ($1, 'num-a-1', 'alpha', 'JRN', 1, 'JRN-000001'), ($2, 'num-b-1', 'beta', 'JRN', 1, 'JRN-000001')`,
          [tenantA, tenantB],
        );
        await client.query(
          `INSERT INTO tenant_data.document_sequences(tenant_id, company, kind, next_number)
           VALUES ($1, 'alpha', 'JRN', 2)`,
          [tenantA],
        );
        const policy = (
          await client.query(
            `INSERT INTO tenant_data.approval_policy(tenant_id, policy_key, version, action_type, role_id, currency)
             VALUES ($1, 'journal-standard', 1, 'journal.post', 'clerk', 'PKR')
             RETURNING ai_origin_direct_post_allowed, editable_in_pending, requires_different_approver,
                       max_self_approval_amount::text AS max_self,
                       approval_threshold_amount::text AS threshold`,
            [tenantA],
          )
        ).rows[0];
        assert.deepEqual(policy, {
          ai_origin_direct_post_allowed: false,
          editable_in_pending: true,
          requires_different_approver: false,
          max_self: '0.0000',
          threshold: '0.0000',
        });
        await client.query(
          `INSERT INTO tenant_data.document_registry(tenant_id, document_id, document_type, document_status, company, branch, origin_type, origin_user_id, origin_model, origin_model_version)
           VALUES ($1, 'doc-ai-1', 'JOURNAL', 'PENDING_APPROVAL', 'alpha', 'main', 'ai', 'owner-a', 'test-model', '1')`,
          [tenantA],
        );
        await client.query(
          `INSERT INTO tenant_data.document_revisions(tenant_id, document_id, revision, document_type, document_status, payload, payload_digest, policy_snapshot, origin_type, origin_user_id)
           VALUES ($1, 'doc-ai-1', 1, 'JOURNAL', 'PENDING_APPROVAL', '{"lines":[]}', 'digest-1', '{"review_required":true}'::jsonb, 'ai', 'owner-a')`,
          [tenantA],
        );
        await client.query(
          `INSERT INTO tenant_data.reference_values(tenant_id, domain, value, label)
           VALUES ($1, 'document_status', 'PENDING_APPROVAL', 'Pending approval')`,
          [tenantA],
        );
        await client.query(
          `INSERT INTO tenant_data.trade_parties(tenant_id, company, branch, id, kind, name)
           VALUES ($1, 'alpha', 'main', 'party-a', 'customer', 'Alpha Customer'),
                  ($2, 'beta', 'main', 'party-b', 'customer', 'Beta Customer')`,
          [tenantA, tenantB],
        );
        await client.query(
          `INSERT INTO tenant_data.trade_operations(tenant_id, command_id, input_digest, payload)
           VALUES ($1, 'cmd-a', 'trade-digest-a', '{}')`,
          [tenantA],
        );
        await client.query(
          `INSERT INTO tenant_data.warehouses(tenant_id, company, id, branch, name, active)
           VALUES ($1, 'alpha', 'wh-a', 'main', 'Alpha Warehouse', true)`,
          [tenantA],
        );
        await client.query(
          `INSERT INTO tenant_data.stock_items(tenant_id, company, id, name, uom, inventory_account, expense_account, receipt_account, active)
           VALUES ($1, 'alpha', 'item-a', 'Item A', 'unit', '1000', '4000', '4000', true)`,
          [tenantA],
        );
        await client.query(
          `INSERT INTO tenant_data.stock_balances(tenant_id, company, warehouse, item, quantity, value, version)
           VALUES ($1, 'alpha', 'wh-a', 'item-a', 10, 1000, 1)`,
          [tenantA],
        );
        await client.query(
          `INSERT INTO tenant_data.audit_event(tenant_id, actor_id, event, entity_type, entity_id, origin_type, origin_model, origin_model_version)
           VALUES ($1, 'owner-a', 'DOCUMENT_SUBMITTED', 'document', 'doc-ai-1', 'ai', 'test-model', '1')`,
          [tenantA],
        );
      },
      {commit: true},
    );

    const check = async (sql, params, pattern, label) => {
      await assert.rejects(() => db.asRole('migrator', client => client.query(sql, params)), pattern, label);
    };

    // Exact money and one-sided lines.
    await check(
      `INSERT INTO tenant_data.journal_lines(tenant_id, journal_id, line_no, account, debit, credit)
       VALUES ($1, 'cmd-a', 3, '1000', 50, 50)`,
      [tenantA],
      /journal_lines_one_side/,
      'a line may not be both debit and credit',
    );
    await check(
      `INSERT INTO tenant_data.journal_lines(tenant_id, journal_id, line_no, account, debit, credit)
       VALUES ($1, 'cmd-a', 3, '1000', -1, 0)`,
      [tenantA],
      /journal_lines_debit_bounds/,
      'negative money must be rejected',
    );
    await check(
      `INSERT INTO tenant_data.journal_lines(tenant_id, journal_id, line_no, account, debit, credit)
       VALUES ($1, 'cmd-a', 3, '1000', 1000000000000, 0)`,
      [tenantA],
      /journal_lines_debit_bounds/,
      'money above the native bound must be rejected',
    );

    // Cross-tenant references are rejected by composite foreign keys.
    await check(
      `INSERT INTO tenant_data.journal_lines(tenant_id, journal_id, line_no, account, debit, credit)
       VALUES ($1, 'cmd-a', 3, '9999', 10, 0)`,
      [tenantA],
      /journal_lines_account_fkey/,
      'a tenant may not post to another tenant account code',
    );
    await check(
      `INSERT INTO tenant_data.journals(tenant_id, id, company, branch, posting_date, narrative)
       VALUES ($1, 'cmd-b', 'alpha', 'main', '2026-11-15', 'Cross tenant')`,
      [tenantA],
      /journals_command_fkey/,
      'a journal may not reference another tenant command',
    );
    await check(
      `INSERT INTO tenant_data.command_inbox(tenant_id, id, actor, digest, payload, state, created_at)
       VALUES ($1, 'cmd-a2', 'owner-b', 'digest-a2', '{}', 'ACCEPTED_PENDING', 0)`,
      [tenantA],
      /command_inbox_actor_fkey/,
      'a command actor must belong to the same tenant',
    );
    await check(
      `INSERT INTO tenant_data.trade_documents(tenant_id, command_id, company, branch, party_id, kind, reference, posting_date, due_date, total)
       VALUES ($1, 'cmd-a', 'alpha', 'main', 'party-b', 'invoice', 'INV-1', '2026-11-15', '2026-12-15', 100)`,
      [tenantA],
      /trade_documents_party_fkey/,
      'a document may not reference another tenant party',
    );
    await check(
      `INSERT INTO tenant_data.document_revisions(tenant_id, document_id, revision, document_type, document_status, payload, payload_digest)
       VALUES ($1, 'doc-missing', 1, 'JOURNAL', 'PENDING_APPROVAL', '{}', 'digest-2')`,
      [tenantA],
      /document_revisions_registry_fkey/,
      'a revision must belong to a registered document in the same tenant',
    );

    // Scoped uniqueness and numbering.
    await check(
      `INSERT INTO tenant_data.document_numbers(tenant_id, id, company, kind, sequence, number)
       VALUES ($1, 'num-a-2', 'alpha', 'JRN', 2, 'JRN-000001')`,
      [tenantA],
      /document_numbers_company_number_key/,
      'document numbers are unique per tenant and company',
    );
    await check(
      `INSERT INTO tenant_data.document_sequences(tenant_id, company, kind, next_number)
       VALUES ($1, 'alpha', 'INV', 0)`,
      [tenantA],
      /document_sequences_next_positive/,
      'a document sequence must stay positive',
    );

    // One immutable ultimate-owner role and one owner assignment.
    await check(
      `INSERT INTO tenant_data.roles(tenant_id, id, name, protected, permissions)
       VALUES ($1, 'shadow_owner', 'Shadow owner', true, '{}')`,
      [tenantA],
      /roles_protected_is_ultimate_owner/,
      'only the single ultimate-owner role may be protected',
    );
    await check(
      `INSERT INTO tenant_data.assignments(tenant_id, user_id, role_id)
       VALUES ($1, 'junior-a', 'ultimate_business_admin')`,
      [tenantA],
      /assignments_one_ultimate_owner_idx/,
      'a tenant may hold only one ultimate-owner assignment',
    );

    // Effective-dated reference data supersedes rather than inverts windows.
    await check(
      `INSERT INTO tenant_data.reference_values(tenant_id, domain, value, label, effective_from, effective_to)
       VALUES ($1, 'document_status', 'OLD', 'Old', now(), now() - interval '1 day')`,
      [tenantA],
      /reference_values_effective_order/,
      'an effective window must move forward',
    );
    await check(
      `INSERT INTO tenant_data.business_rule(tenant_id, rule_key, version, effective_from, effective_to)
       VALUES ($1, 'late_fee', 1, now() + interval '1 day', now())`,
      [tenantA],
      /business_rule_effective_order/,
      'a rule window must move forward',
    );

    // Purpose C buckets stay version-scoped.
    await check(
      `INSERT INTO tenant_data.approval_policy(tenant_id, policy_key, version, action_type, currency)
       VALUES ($1, 'journal-standard', 1, 'journal.post', 'PKR')`,
      [tenantA],
      /approval_policy_pkey/,
      'policy versions are append-only identities',
    );

    const counts = (
      await db.asRole('migrator', async client => (
        await client.query(
          `SELECT
             (SELECT count(*)::int FROM tenant_data.members WHERE tenant_id = $1) AS members,
             (SELECT count(*)::int FROM tenant_data.journal_lines WHERE tenant_id = $1) AS lines,
             (SELECT count(*)::int FROM tenant_data.document_revisions WHERE tenant_id = $1) AS revisions,
             (SELECT count(*)::int FROM tenant_data.document_revisions WHERE tenant_id = $2) AS other_revisions`,
          [tenantA, tenantB],
        )
      ).rows[0])
    );
    assert.deepEqual(counts, {members: 2, lines: 2, revisions: 1, other_revisions: 0});
  });
});
