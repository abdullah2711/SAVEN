--- BEGIN PIVOT SPEC ---

PHASE 0 — READ, DO NOT WRITE YET

Before you touch any file, read these in this exact order and record a one-paragraph
summary of each in `docs/pivot-notes/00-reading-log.md` (redundant with the
engineer reading log; you may point to it and note "see
docs/contractor/00-engineer-reading-log.md" to avoid duplication):

1. AGENTS.md
2. docs/CURRENT_HANDOFF.md
3. docs/sources/SAVEN-mandate-v2.3.md
4. docs/sources/SAVEN-agent-handoff-v2.3.md
5. docs/48-accounting-first-owner-revision.md
6. docs/49-compatible-tenant-upgrades.md
7. docs/35-native-sqlite-local-first-v2.3.md
8. contracts/delivery-checklist.json
9. BUILD_STATE
10. docs/07-architecture-decisions.md (or whichever file holds ADRs)

Then inspect, without modifying: existing SQLite schema files, the tenant model
and tenant id column names, the accounting posting kernel, immutability triggers,
audit-trail implementation, approval and idempotency tables, `scripts/check.mjs`,
`tests/`, `tools/build_feature_catalog.py`, `tools/build_design_library.py`,
`tools/checklist.py`, `tools/validate_plan.py`.

PHASE 1 — ADR AND SCOPE OVERRIDE

`AGENTS.md` currently forbids a PostgreSQL dependency. This pivot is an
owner-authorized override. Do not silently change the mandate. Create
`docs/pivot-notes/01-adr-postgresql-pivot.md` with:

- Status: Proposed
- Date: today
- Owner authorization: "This ADR is authorized by the project owner. It overrides
  the 'Native SQLite is the sole selected next database engine' clause in AGENTS.md
  for the purpose of a controlled PostgreSQL pivot."
- Context: multi-tenant SaaS, operator control plane, RLS-enforced isolation,
  per-tenant business rules
- Decision: shared database, shared schema, `tenant_id` column, RLS enforced,
  FORCE RLS on every tenant-scoped table
- Consequences: one migration path, one pool, one backup target; schema-per-tenant
  rejected; database-per-tenant reserved for Fully Private deployments
- SQLite retirement gate: SQLite remains production until (a) parity harness
  passes, (b) RLS coverage is CI-enforced, (c) a timed restore drill from
  PostgreSQL has been performed, (d) the owner explicitly authorizes cutover
- Reversibility: SQLite code and data are preserved; no destructive migration is
  performed in this ADR

Add one line to `AGENTS.md` under the relevant rule: "See
docs/pivot-notes/01-adr-postgresql-pivot.md for the owner-authorized PostgreSQL
pivot. SQLite remains the production path until the retirement gate in that ADR is
satisfied." Do not delete the existing SQLite rule; annotate it.

Commit as `docs: ADR for PostgreSQL pivot with SQLite retirement gate`.

PHASE 2 — THE THREE POSTGRESQL PURPOSES

Design three clearly separated logical areas. Do not merge them. Document each in
`docs/pivot-notes/02-three-purposes.md`.

PURPOSE A — OPERATOR / SAAS CONTROL PLANE
Tables owned by SAVEN-the-operator, not tenants:
- `operator.tenant` (tenant_id uuid PK, legal_name, status, plan, created_at,
  updated_at, suspended_at)
- `operator.entitlement` (tenant_id, tier, public_key, signature, issued_at) —
  supports Cloud vs Fully Private
- `operator.operator_audit` (actor_id, action, target_tenant_id, reason, at,
  payload_jsonb) — append-only
- `operator.feature_flag` (key, tenant_scope, enabled, updated_at)

Note: `operator.user_identity` and `operator.tenant_membership` from earlier drafts
are SUPERSEDED by `auth.users` and `auth.tenant_membership` (see IDENTITY TABLE
RESOLUTION at the end of this prompt). Do not create them.

Rules:
- This schema is cross-tenant by nature. It is not subject to tenant RLS.
- The customer application role has zero privileges on `operator.*`. Revoke all.
  Only the operator application role and audited `SECURITY DEFINER` functions may
  read it.
- Every cross-tenant read from the operator app writes one row to
  `operator.operator_audit` in the same transaction.

PURPOSE B — TENANT BUSINESS DATABASE
One schema, `tenant_data`, shared by all tenants. Every table carries a non-null
`tenant_id uuid` as the leading column of its primary key or as a non-null column
with a composite index. RLS enabled and forced on every table. This is the default
SAVEN Cloud model.

Migration rule for every existing SQLite tenant table: preserve the exact column
names, add `tenant_id uuid NOT NULL`, add `created_at`/`updated_at` if missing, add
immutability triggers for accounting documents, add audit triggers for state
changes, and add an RLS policy. Do not rename columns. Do not renumber historical
documents.

PURPOSE C — PER-TENANT BUSINESS RULES
Tenant-scoped data, protected by the same RLS as Purpose B, representing
configurable policy not transaction data. Suggested tables in `tenant_data`:
- `business_rule` (tenant_id, rule_key, scope_type, scope_id, config_jsonb,
  effective_from, effective_to, created_by, created_at)
- `approval_policy` (tenant_id, policy_key, action_type, role_id,
  max_self_approval_amount, approval_threshold_amount, currency,
  requires_different_approver, ai_origin_direct_post_allowed (default false),
  editable_in_pending (default true), active, effective_from, effective_to)
- `posting_constraint` (tenant_id, constraint_key, applies_to_doc_type,
  rule_jsonb, active)
- `tax_profile` (tenant_id, jurisdiction, rate, effective_from, effective_to) —
  FBR and any other localization

These tables are themselves RLS-protected. The application reads them after setting
tenant context, then evaluates the rule in application code. Do not encode
arbitrary per-tenant business rules into RLS policies. RLS enforces isolation; the
application enforces rule semantics.

Write `02-three-purposes.md` with a table listing every table, which purpose it
belongs to, whether it carries `tenant_id`, and whether it has an RLS policy.

PHASE 3 — POSTGRESQL DDL WITH RLS

Create `db/postgres/` with:
- `00-roles.sql` — role creation
- `10-operator-schema.sql` — Purpose A
- `20-tenant-schema.sql` — Purpose B and C
- `30-rls-policies.sql` — RLS enablement and policies
- `40-triggers.sql` — immutability and audit triggers
- `50-functions.sql` — SECURITY DEFINER operator functions
- `99-ci-rls-coverage.sql` — coverage check

ROLES
- `saven_customer_app` — no BYPASSRLS, no superuser, no table ownership
- `saven_operator_read` — read access to `operator.*` and tenant data only via
  SECURITY DEFINER functions. No BYPASSRLS.
- `saven_operator_admin` — write access to `operator.*`. Cross-tenant tenant reads
  still through functions. No BYPASSRLS.
- `saven_migrator` — DDL only, used offline.

Do not grant BYPASSRLS to any role.

RLS PATTERN — for every tenant-scoped table:

```
ALTER TABLE tenant_data.<table> ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_data.<table> FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON tenant_data.<table>
  USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

GRANT SELECT, INSERT, UPDATE, DELETE ON tenant_data.<table> TO saven_customer_app;
```

`FORCE ROW LEVEL SECURITY` is mandatory. Table owners bypass RLS by default;
without FORCE, policies are silently ineffective.

Every column referenced in USING or WITH CHECK must be indexed. Create at minimum:
`(tenant_id, id)` and `(tenant_id, <filter_column>)`.

Child tables (invoice lines, journal lines, approval history, audit details) carry
their own `tenant_id` and their own policy. RLS is per-table and does not follow
foreign keys.

IMMUTABILITY TRIGGERS — for every posted accounting document (journal entry,
invoice, bill, payment, credit note, stock movement after posting):

```
CREATE OR REPLACE FUNCTION tenant_data.forbid_posted_mutation() RETURNS trigger AS $$
BEGIN
  IF OLD.status = 'posted' THEN
    RAISE EXCEPTION 'Posted documents are immutable; create a reversal or adjustment instead';
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER <table>_immutable
  BEFORE UPDATE OR DELETE ON tenant_data.<table>
  FOR EACH ROW EXECUTE FUNCTION tenant_data.forbid_posted_mutation();
```

Audit triggers write append-only rows to `tenant_data.audit_event` with tenant_id,
actor, action, target table, target id, before_jsonb, after_jsonb, at. Audit rows
must never be updated or deleted; enforce with a trigger that raises on UPDATE or
DELETE on `audit_event`.

OPERATOR ACCESS FUNCTIONS — cross-tenant reads by the operator role must be
function-mediated and audited. Example:

```
CREATE OR REPLACE FUNCTION operator.read_tenant_ledger(
  p_operator_id uuid,
  p_tenant_id uuid,
  p_reason text
) RETURNS TABLE (...) AS $$
BEGIN
  IF p_reason IS NULL OR length(p_reason) < 10 THEN
    RAISE EXCEPTION 'Operator cross-tenant read requires a reason';
  END IF;
  INSERT INTO operator.operator_audit(actor_id, action, target_tenant_id, reason, at)
    VALUES (p_operator_id, 'read_tenant_ledger', p_tenant_id, p_reason, now());
  PERFORM set_config('app.current_tenant_id', p_tenant_id::text, true);
  RETURN QUERY SELECT ... FROM tenant_data.ledger_entry WHERE tenant_id = p_tenant_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
```

Note the order: audit row first, then the read. If the read fails, the audit row
still records the attempt. Revoke all direct SELECT on tenant tables from
`saven_operator_read`; grant only EXECUTE on these functions.

RLS COVERAGE CHECK (`99-ci-rls-coverage.sql`) — must return zero rows:

```
SELECT c.relname AS missing_rls
FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'tenant_data' AND c.relkind = 'r' AND NOT c.relrowsecurity
UNION ALL
SELECT c.relname AS missing_force_rls
FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'tenant_data' AND c.relkind = 'r' AND c.relrowsecurity
  AND NOT c.relforcerowsecurity
UNION ALL
SELECT c.relname AS missing_policy
FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'tenant_data' AND c.relkind = 'r' AND c.relrowsecurity
  AND NOT EXISTS (SELECT 1 FROM pg_policy p WHERE p.polrelid = c.oid);
```

Wire into `scripts/check.mjs` as an additional step. The build fails if the query
returns any row.

PHASE 4 — SESSION CONTEXT AND APPLICATION INTEGRATION

SESSION CONTEXT MIDDLEWARE
Create `src/db/tenant-context.{js,mjs,ts}` (match the repo's Node.js). The
middleware:
1. Extracts tenant id and user id from the authenticated session, never from user
   input.
2. Opens a transaction.
3. Runs `SELECT set_config('app.current_tenant_id', $1, true)` and
   `SELECT set_config('app.current_user_id', $1, true)` with the ids as
   parameters. `set_config(..., true)` is transaction-scoped and equivalent to
   `SET LOCAL`; it is parameterized and safe against injection.
4. Runs the handler.
5. Commits or rolls back.

If the repo uses PgBouncer in transaction mode, add a comment at the top of the
file explaining why transaction-scoped setting is mandatory and session-scoped
`SET` is forbidden.

TENANT-LESS REQUESTS
Some requests are legitimately tenant-less (login, tenant selection, operator
admin). For those, do not set the context. They connect as `saven_operator_read`
or `saven_operator_admin` depending on the route, or as `saven_customer_app` with
no context (RLS returns zero rows for tenant tables, which is correct).

ACCOUNTING KERNEL
The existing SQLite posting kernel is the reference. Port to PostgreSQL without
changing semantics:
- One transaction per posting.
- Debit = credit enforced before commit.
- High-water document numbers via a sequence or an atomic allocation table with
  `SELECT ... FOR UPDATE`. Never `MAX(id)+1`.
- Idempotency keys stored and checked inside the same transaction as the posting.
- Approval, rejection, and return are durable rows, not status overwrites.

Do not delete the SQLite implementation. Keep it runnable so the parity harness can
compare both.

PHASE 5 — PARITY HARNESS

Create `tests/parity/` with:
- `seed.sql` — three tenants, two users each, chart of accounts, opening balances
- `scenarios/post-journal.{js,mjs}`
- `scenarios/post-invoice.{js,mjs}`
- `scenarios/post-bill.{js,mjs}`
- `scenarios/post-payment.{js,mjs}`
- `scenarios/post-credit.{js,mjs}`
- `scenarios/stock-movement.{js,mjs}`
- `scenarios/period-close.{js,mjs}`
- `scenarios/reversal.{js,mjs}`
- `scenarios/approval-and-rejection.{js,mjs}`
- `scenarios/rls-cross-tenant-leak.{js,mjs}` — attempt to read tenant B as
  tenant A; assert zero rows returned
- `run-parity.mjs` — run each scenario against SQLite and PostgreSQL, diff

The parity report includes, per scenario: trial balance per tenant, document
sequence numbers, audit trail row count and hash, RLS isolation result.

The harness fails the build if any diff is non-empty. Do not "fix" the diff by
relaxing the assertion. Fix the code.

PHASE 6 — BACKUP, RESTORE, AND VERIFICATION

BACKUP AND RESTORE RUNBOOK — `docs/pivot-notes/06-backup-restore-runbook.md`:
- `wal_level = replica`, `archive_mode = on`, `archive_command` writing to an
  off-server encrypted location
- `pg_basebackup` schedule and destination
- off-site copy procedure (the backup must leave the server; a backup on the same
  disk is not a backup)
- step-by-step restore drill: stop app, restore base backup, replay WAL, start
  app, verify trial balance matches the pre-drill snapshot, record elapsed time
- a signed "drill performed" line with date and elapsed time, which the OWNER
  fills in before any client data is loaded. Do not mark the drill as performed
  on the owner's behalf.

VERIFICATION COMMANDS — run in this order, paste output into
`docs/pivot-notes/07-verification-evidence.md`:

```
node scripts/check.mjs
node --test tests/*.test.mjs
node tests/parity/run-parity.mjs
python tools/build_feature_catalog.py
python tools/build_design_library.py
python tools/checklist.py --check
python tools/validate_plan.py
```

Plus the RLS coverage query from Phase 3, run against a live PostgreSQL instance,
showing zero rows.

The build is not "done" until every command exits zero and the RLS coverage query
returns zero rows. If any fails, fix the cause. Do not skip, comment out, or reduce
the test set.

BUILD_STATE UPDATE — append a new section titled "PostgreSQL pivot — Phase 1"
with:
- which SQLite tables have a PostgreSQL counterpart
- which SQLite tables are still SQLite-only
- parity harness pass/fail per scenario
- RLS coverage result
- backup/restore drill status: NOT PERFORMED until the owner signs it
- explicit next gate: owner authorization to proceed to Phase 2 (data migration)
  and Phase 3 (cutover gate)

HARD PROHIBITIONS

- Do not delete SQLite code, schema, tests, or data.
- Do not run a destructive migration against any production or client database.
- Do not grant BYPASSRLS to any role.
- Do not use session-level `SET` for tenant context behind a connection pooler.
- Do not encode configurable per-tenant business rules into RLS policies.
- Do not migrate production client data. Phase 1 is schema, RLS, and parity only.
- Do not describe the pivot as complete. The production database remains SQLite
  until the owner authorizes cutover.
- Do not touch the archived testing frontend or the frozen `saventesting`
  deployment.
- Do not spawn subagents, invoke other models, or write orchestration scripts.
- Do not open any inbound port for PostgreSQL. It binds to `127.0.0.1` only.
  Cloudflare Tunnel carries only the app's HTTP/S endpoint.
- Do not commit secrets, connection strings, or keys.

--- END PIVOT SPEC ---
