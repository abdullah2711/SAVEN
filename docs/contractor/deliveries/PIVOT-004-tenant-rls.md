CONTRACT: docs/contractor/contracts/PIVOT-004-tenant-rls.md
STATUS: DONE

## What was delivered

`db/postgres/30-rls-policies.sql` is a single additive transaction that lands, together: the constrained canonical-principal projection, `ENABLE` + `FORCE ROW LEVEL SECURITY` on all 47 `tenant_data` tables, the three-policy isolation/admission model, and per-table least-privilege grants for `saven_customer_app`.

1. **Canonical principal projection.** `tenant_data.members` gains `user_uuid uuid NOT NULL` (added, checked for unmapped rows, then set NOT NULL), `UNIQUE (tenant_id, user_uuid)`, `FOREIGN KEY (tenant_id, user_uuid) → auth.tenant_membership (tenant_id, user_id)` and `FOREIGN KEY (user_uuid, user_id) → auth.users (id, legacy_id)`, plus the additive referenced pair key `auth.users (id, legacy_id)`. Native text `user_id` is unchanged. A mismatched text/UUID pair, a dangling UUID, a duplicate UUID inside a tenant, a null projection and a legacy-id rename under a bound principal are all rejected by the database.
2. **Context.** `tenant_data.current_tenant_id()` / `current_user_id()` are invoker `STABLE` SQL functions that return `NULL` for absent, empty or malformed GUCs (via `pg_input_is_valid`), so every policy fails closed instead of raising or falling back. They are not `SECURITY DEFINER`.
3. **Admission.** `tenant_data.session_admitted(tenant, user)` is a `STABLE SECURITY DEFINER` boolean that requires an active `tenant_data.members` row, an active `auth.tenant_membership` (status active, no `suspended_at`, no `revoked_at`) and an active `auth.users` row. Fixed `search_path = pg_catalog, auth, tenant_data`, schema-qualified body, no dynamic SQL, no document/credential/session reads, `EXECUTE` revoked from `PUBLIC` and granted only to `saven_customer_app`.
4. **Policies per table (47 × 3).** `<table>_tenant_isolation` PERMISSIVE `TO PUBLIC`, `<table>_tenant_scope` RESTRICTIVE `TO PUBLIC` (duplicate tenant predicate so an extra permissive policy cannot widen access), `<table>_runtime_admission` RESTRICTIVE targeting only `saven_customer_app` (tenant match **and** `session_admitted`). All three carry both `USING` and `WITH CHECK`. No policy addresses an auth or operator role; `auth`/`operator` receive no policy, RLS change or privilege here.
5. **Grants.** `saven_customer_app` is the only direct tenant runtime grantee, per table rather than blanket: append-only sources get `SELECT, INSERT`; `audit` gets `SELECT, INSERT`; `audit_event` and `source_store_migrations` are `SELECT` only; mutable business/configuration gets `SELECT, INSERT, UPDATE`; administration tables additionally get `DELETE`; `command_inbox` gets `SELECT, INSERT` plus column-scoped `UPDATE (state, lease_token, lease_until, error, approved_by, updated_at, updated_by)` so accepted bytes stay unwritable. No `TRUNCATE`, `REFERENCES`, `TRIGGER`, schema `CREATE` or ownership to any runtime role. `saven_auth_service`, `saven_auth_definer` and every operator role hold nothing; `PUBLIC` holds nothing.
6. **Validation.** The migration refuses to run on a partial prerequisite stack, refuses to overwrite an existing policy, refuses existing unmapped member rows, and at the end raises if any tenant table lacks forced RLS, lacks a permissive isolation policy, lacks two restrictive policies, or has a policy addressed to an auth/operator role.
7. **Index.** `tenant_data.assignments (tenant_id, role_id)` added for the role-lookup path that the PK does not lead with.

`db/postgres/README.md` documents run order step 7, the context contract, the policy model and why the tenant predicate is duplicated, the admission function and its ownership constraint, the principal projection, the full grant matrix, the functions/tables added, the remaining auth-side RLS gap, and the table-addition checklist.

`tests/pivot-004-rls.test.mjs` is one static contract test plus five disposable-cluster tests (catalog, grants, runtime behaviour, principal mapping, policy attack/role separation).

## FILES CHANGED

- `db/postgres/30-rls-policies.sql`: new PIVOT-004 migration (projection, forced RLS, policies, grants, validation).
- `db/postgres/README.md`: run order, PIVOT-004 section, security bullets, extension points, gate description.
- `tests/pivot-004-rls.test.mjs`: static + live contract gate.
- `docs/contractor/deliveries/PIVOT-004-tenant-rls.md`: this report (contractor-role artefact, not a product path).

## GATE EVIDENCE

Environment: dedicated disposable local PostgreSQL 18.6 cluster on loopback `127.0.0.1:55433`, created for this run by `initdb` and stopped afterwards; `SAVEN_PIVOT_TEST_CLUSTER=1`, private generated test credential, no owner-server/SSH/production/shared-cluster access. The fixture created only `saven_pivot_*` objects and removed them (post-run counts: roles 0, databases 0).

Contract `DONE WHEN`:

```text
$ node scripts/check.mjs && node --test tests/pivot-004-rls.test.mjs
PASS: 150 JavaScript files parsed; package manifest valid.
TAP version 13
# Subtest: PIVOT-004 static contract: forced RLS, atomic grants and exact principal binding
ok 1 - PIVOT-004 static contract: forced RLS, atomic grants and exact principal binding
  ---
  duration_ms: 15.290683
  type: 'test'
  ...
# Subtest: PIVOT-004 catalog: every tenant table is forced and carries isolation plus admission
ok 2 - PIVOT-004 catalog: every tenant table is forced and carries isolation plus admission
# Subtest: PIVOT-004 grants: least privilege for the runtime, none for auth/operator/PUBLIC
ok 3 - PIVOT-004 grants: least privilege for the runtime, none for auth/operator/PUBLIC
# Subtest: PIVOT-004 runtime: verified context isolates reads and writes, missing context denies
ok 4 - PIVOT-004 runtime: verified context isolates reads and writes, missing context denies
# Subtest: PIVOT-004 principal mapping: exact text/UUID membership and identity binding
ok 5 - PIVOT-004 principal mapping: exact text/UUID membership and identity binding
# Subtest: PIVOT-004 resists an extra permissive policy and honours runtime role separation
ok 6 - PIVOT-004 resists an extra permissive policy and honours runtime role separation
1..6
# tests 6
# suites 0
# pass 6
# fail 0
# cancelled 0
# skipped 0
# todo 0
# duration_ms 3515.210248
EXIT=0
```

Full Node suite on the same cluster (nothing removed, skipped or weakened):

```text
$ node --test tests/*.test.mjs
1..175
# tests 175
# suites 0
# pass 175
# fail 0
# cancelled 0
# skipped 0
# todo 0
# duration_ms 11726.751582
EXIT=0
```

Fail-closed without the explicit dedicated-cluster opt-in (all `PG*` and `SAVEN_PIVOT_TEST_CLUSTER` unset). The static contract still runs; every database case refuses before mutation:

```text
$ node --test tests/pivot-004-rls.test.mjs
ok 1 - PIVOT-004 static contract: forced RLS, atomic grants and exact principal binding
not ok 2 - PIVOT-004 catalog: every tenant table is forced and carries isolation plus admission
  error: 'PIVOT-002 fixture refuses to run: set SAVEN_PIVOT_TEST_CLUSTER=1 for a dedicated disposable PostgreSQL cluster.'
... (tests 3-6 refuse identically)
EXIT=1
```

Behavioural evidence inside the live gate (actual `saven_customer_app` role, transaction-local context set by test scaffolding):

- Positive control: own tenant shows 2 accounts / 2 lines / debit 100; foreign tenant filter returns 0.
- Denial: missing, empty, malformed (`not-a-uuid`) and mismatched (valid tenant with a non-member user) context all return 0 rows; suspended membership, revoked membership, inactive principal and inactive identity each drop the visible set to 0.
- Writes: own-tenant insert/update/delete allowed within the granted classes; foreign-tenant insert and tenant-key change raise `row-level security`; unseen foreign rows update 0 rows; `journal_lines`/`journals` UPDATE or DELETE raise `permission denied`; `audit_event` INSERT is denied; a child row referencing another tenant command is refused.
- Owner: `saven_migrator` with tenant A context sees 2 own rows and 0 foreign rows, and `SET row_security = off` raises `query would be affected by row-level security policy`.
- Attack: an injected `PERMISSIVE ... TO saven_customer_app USING (true) WITH CHECK (true)` policy still yields own-only rows and still denies a non-admitted user.
- Separation: operator and auth roles get `permission denied for schema tenant_data`; the runtime cannot `CREATE TABLE` in the schema or `ALTER` a tenant table.

No deployment, production restore, data migration or reference-cluster action was performed.

## QUESTIONS FOR ENGINEER

1. **Definer ownership.** `session_admitted()` is owned by `saven_migrator` because `00-roles.sql` makes target roles mutually non-member (asserted by the PIVOT-002 gate), so the migration principal cannot `ALTER FUNCTION ... OWNER TO saven_auth_definer`. The body is fixed, has no dynamic SQL and reads only auth status columns plus the members projection. Confirm this is acceptable for PIVOT-004, or specify the role-membership provisioning a later contract should add so a dedicated least-privileged owner can take it.
2. **Auth-side forced RLS.** `auth.tenant_membership`, `auth.users` and `auth.sessions` still have no RLS. Enabling `FORCE` here would break the canonical membership lookup used by `session_admitted()` (the definer would be subject to policies with no auth-service session context) or require a migration-wide bypass policy that defeats the purpose. I recorded this as an explicit remaining requirement owned by AUTH-002/006 rather than half-implementing it. Confirm that split, or amend PIVOT-004's TOUCH if it must land here.
3. **Tenant → operator reference.** `tenant_data` still has no FK to `operator.tenant` (Fully Private omits vendor operator tables); tenant identity is validated by the operator/tenant service contract, not the database. PIVOT-004's "complete scoped references" could also mean adding that optional, profile-dependent FK. Confirm it is intentionally out of scope.
4. **Policy growth.** Every new tenant table now requires three policies, an explicit grant row and PIVOT-008 coverage (documented as a checklist). If the engineer prefers a generated/default-policy approach for future tables, that is a deliberate design change worth its own decision.
5. **Admission cost.** The restrictive admission predicate calls `session_admitted()` per row-evaluation for the runtime role. It is index-backed (`auth.tenant_membership` unique pair, `members` unique pair) and acceptable for the empty Phase-1 skeleton; representative load measurement belongs to PIVOT-009/010 and the retirement gate, not to this contract.

## DEVIATIONS FROM CONTRACT

1. One extra path: `docs/contractor/deliveries/PIVOT-004-tenant-rls.md` (contractor delivery report). No other file was created or modified.
2. The contract's PATTERN file `postgresql/002_row_security.sql` does not exist on this base; the closest accepted conventions live in `postgresql/002_controls.sql` (helper functions, per-table policies, owner-bypass commentary), which I read and mirrored for style. No file under `postgresql/` was modified.
3. `session_admitted()` ownership is the offline DDL role, not a dedicated definer role (question 1). This is a deviation from the ADR's "least-privileged non-login owner" preference, forced by the accepted role model and disclosed in both the SQL and README.
4. The additive key on `auth.users (id, legacy_id)` is the only statement in this file that touches another schema; no RLS, policy or privilege change is applied to `auth`/`operator` (question 2).
5. Test-only context is set with `set_config(..., true)` inside the disposable fixture transaction. That is scaffolding for proving policy behaviour, not a claim that application context is verified; AUTH-006 still gates shipping, and the runbook/README say so.
6. `UPDATE`/`DELETE` are withheld by grant for posted/accepted sources even though the PIVOT-005 triggers do not exist yet. That is deliberate defence in depth, not a claim that immutability is fully delivered.

## EXTENSIBILITY

compliant:

- No new hardcoded domains: policies reference only `tenant_id`, the context helpers and the boolean admission function; no document type, action type, role list or jurisdiction is encoded in a policy. The one literal role name in a policy target is `saven_customer_app`, the accepted single runtime grantee, not a business domain.
- No coupling across module boundaries: one SQL migration, README text and one test; no application code, no new imports. Cross-schema coupling is limited to the exact FK target ruled by 43666dc and the additive pair key it requires.
- No new one-way decisions without an ADR: the auth-side RLS split, the definer-ownership limitation and the (absent) operator FK are recorded as open decisions rather than silently fixed; each is reversible by an additive migration.
- Reversibility: the migration is additive and transactional, rewrites no delivered SQL byte, changes no money/posting/audit semantics, adds no superuser or `BYPASSRLS`, and can be superseded by a later additive file that adds auth-side isolation or transfers function ownership.

## GIT

branch=opencode/pivot-004-tenant-rls base=testing-1 @ d0a50cd commits=recorded in the delivery message pushed=yes merged=no
