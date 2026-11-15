CONTRACT: docs/contractor/contracts/PIVOT-003-tenant-schema.md
STATUS: DONE — revised under PIVOT-003-R1. The tenant skeleton, canonical seed and gate are delivered; the PIVOT-003-R1 corrections (native empty-stock valuation, canonical tax default/notes, externalized severity domain, corrected claims) are applied and recorded in the revision section below.

## What was delivered

`db/postgres/20-tenant-schema.sql` creates the shared `tenant_data` schema with 47 Purpose B/C tables, plus `contracts/postgres-business-rules-v1.json` (canonical reference-domain seed and versioned JSON schemas) and `tests/pivot-003-schema.test.mjs` (static + live gate). No runtime code, no RLS, no triggers and no runtime grants.

Scope decisions taken strictly inside the contract:

- Every table, child and rule table carries `tenant_id uuid NOT NULL` as its first column, leads its primary key with `tenant_id`, and scopes every foreign key and unique key by `tenant_id` (plus the existing company/branch components). One table pair was *not* created: `business_member_operations` maps to `auth.business_member_operations` in `02-three-purposes.md`, so it belongs to the auth contracts, not to `tenant_data`.
- `tenant_data` is default-deny: PUBLIC, customer, auth and all operator roles have no schema/table/sequence privilege. Granting before PIVOT-004 policies exist would expose every tenant's rows, so grants must land together with policies.
- No cross-schema foreign keys (contract NOTES: finalized in PIVOT-004). `operator.*` is deliberately never referenced because the Fully Private composition omits it; `auth.users`/`auth.tenant_membership` (AUTH-001, separate unmerged branch) own the canonical UUID principal while `members.user_id` keeps the native text id, so the text-to-UUID mapping and composite membership link are PIVOT-004 work.
- No RLS (PIVOT-004), no immutability triggers (PIVOT-005), no audit triggers (PIVOT-006). The README states that the skeleton is not safe to serve before those land.
- Growing domains are reference data, never `CHECK ... IN` lists. Each configured column is annotated `reference domain: <name>` and the canonical seed is `contracts/postgres-business-rules-v1.json`; only structural/accounting invariants keep `CHECK` constraints (money bounds, debit XOR credit, positive amounts, one protected ultimate-owner role, one ultimate-owner assignment, effective-window ordering).
- Pending-document sidecars are `tenant_data.document_registry` (ordinary identity/type/status/revision/origin projection, statuses include `PENDING_APPROVAL`) and `tenant_data.document_revisions` (immutable submission revisions bound to `payload_digest` and `policy_snapshot`). There is no `ai_proposal` table; `ai_origin_direct_post_allowed` defaults to false and `editable_in_pending` to true.

## FILES CHANGED

- `db/postgres/20-tenant-schema.sql`: new Purpose B/C tenant schema skeleton — 47 tables, composite tenant PK/unique/FK keys, exact-money bounds, native text ids and epoch-ms integers preserved, reference/rule tables, pending-document sidecars, indexes, default-deny privileges.
- `db/postgres/README.md`: run order, Purpose B/C table inventory and compatibility rules, default-deny and deferral statements, extension points for reference data/policy/pending documents, and the PIVOT-003 gate description.
- `contracts/postgres-business-rules-v1.json`: canonical seed for the 17 reference domains annotated in the SQL, approval defaults (AI direct post false, editable in pending true), registered-handler registry (empty in this contract) and five versioned JSON Schemas.
- `tests/pivot-003-schema.test.mjs`: static SQL/JSON contract test plus two disposable-cluster tests (catalog, ownership, absence of RLS/triggers/grants, exact money, cross-tenant FK rejection, scoped numbering, owner-role/assignment uniqueness, policy defaults and versioning).

## GATE EVIDENCE

Environment: dedicated disposable local PostgreSQL 18.6 cluster on loopback `127.0.0.1:55432`, created for this run by `initdb` in a throwaway directory and stopped afterwards; `SAVEN_PIVOT_TEST_CLUSTER=1`, private generated postgres credential, no owner-server/SSH/production/shared-cluster access. Fixture created only `saven_pivot_*` objects and removed them (post-run counts: `saven_pivot_%` roles = 0, databases = 0).

Contract `DONE WHEN` command:

```text
$ node scripts/check.mjs && node --test tests/pivot-003-schema.test.mjs
PASS: 147 JavaScript files parsed; package manifest valid.
TAP version 13
# Subtest: PIVOT-003 static schema contract: scoped tenant tables, exact money, no growing enums
ok 1 - PIVOT-003 static schema contract: scoped tenant tables, exact money, no growing enums
  ---
  duration_ms: 11.449173
  type: 'test'
  ...
# Subtest: PIVOT-003 tenant schema applies with scoped identity, no RLS yet and no runtime grants
ok 2 - PIVOT-003 tenant schema applies with scoped identity, no RLS yet and no runtime grants
  ---
  duration_ms: 477.79903
  type: 'test'
  ...
# Subtest: PIVOT-003 tenant constraints enforce scoped money, ownership and cross-tenant isolation
ok 3 - PIVOT-003 tenant constraints enforce scoped money, ownership and cross-tenant isolation
  ---
  duration_ms: 537.383841
  type: 'test'
  ...
1..3
# tests 3
# suites 0
# pass 3
# fail 0
# cancelled 0
# skipped 0
# todo 0
# duration_ms 1116.847783
EXIT=0
```

Full Node suite on the same cluster (no test removed, skipped or weakened):

```text
$ node --test tests/*.test.mjs
1..153
# tests 153
# suites 0
# pass 153
# fail 0
# cancelled 0
# skipped 0
# todo 0
# duration_ms 7232.152579
EXIT=0
```

Fail-closed behaviour without the explicit dedicated-cluster opt-in (all `PG*` and `SAVEN_PIVOT_TEST_CLUSTER` variables unset):

```text
$ node --test tests/pivot-003-schema.test.mjs
ok 1 - PIVOT-003 static schema contract: scoped tenant tables, exact money, no growing enums
not ok 2 - PIVOT-003 tenant schema applies with scoped identity, no RLS yet and no runtime grants
  error: 'PIVOT-002 fixture refuses to run: set SAVEN_PIVOT_TEST_CLUSTER=1 for a dedicated disposable PostgreSQL cluster.'
not ok 3 - PIVOT-003 tenant constraints enforce scoped money, ownership and cross-tenant isolation
  error: 'PIVOT-002 fixture refuses to run: set SAVEN_PIVOT_TEST_CLUSTER=1 for a dedicated disposable PostgreSQL cluster.'
# pass 1
# fail 2
EXIT=1
```

Forward-compatibility check against AUTH-001 (run while the shared worktree was briefly on the unmerged `opencode/auth-001` commit `09b1898`, i.e. with `db/postgres/05-auth-schema.sql` present). This is an extra observation, not part of this base's gate:

```text
$ psql -v ON_ERROR_STOP=1 -f db/postgres/00-roles.sql \
    -f db/postgres/05-auth-schema.sql -f db/postgres/10-operator-schema.sql \
    -f db/postgres/20-tenant-schema.sql
RUN-ORDER-OK
```

Read-only planning checks, for information (they do not write to the planning package):

```text
$ python3 tools/validate_plan.py
PASS: 269 unique specified requirements, 20 families, dependencies, scope, references and local links
$ python3 tools/checklist.py --check
{"actions": 204, "states": {"todo": 158, "in-progress": 4, "source-tested": 30, "browser-tested": 11, "released": 0, "blocked": 1}}
$ python3 tools/validate_project_skills.py
PASS: 17 skill entry points, four source pins and 271 exact files; not a full upstream or visual audit
```

## QUESTIONS FOR ENGINEER

1. Branch naming: the prompt requires `testing-1/opencode/<slug>`, but a local branch named `testing-1` already exists, so git refuses to create `refs/heads/testing-1/opencode/pivot-003` (directory/file ref conflict). I used `opencode/pivot-003`, matching the accepted PIVOT-002 convention. Confirm this is the intended convention for all subsequent contracts.
2. PIVOT-004 ownership of access: I left `tenant_data` with zero runtime grants so nothing is readable before policies exist. Confirm PIVOT-004's TOUCH should add `GRANT` statements together with `ENABLE`/`FORCE ROW LEVEL SECURITY` and the policies, and confirm `saven_customer_app` is the only tenant runtime grantee (does the checked-in auth service need any `tenant_data` read for membership projection?).
3. Principal mapping: `tenant_data.members.user_id` keeps the native text id and `auth.users` has `id uuid` + `legacy_id text`. Should PIVOT-004 add a stored `user_uuid`/`legacy_id` mapping column on `tenant_data.members`, or resolve through `auth.users.legacy_id` and enforce the composite FK only on the UUID side?
4. Reference-domain convention: the SQL annotates configured columns as `reference domain: <name>` and `contracts/postgres-business-rules-v1.json` seeds all 17 domains. Confirm the engineer wants that annotation + JSON file kept as the canonical mechanism (and extended) rather than one domain registry table.
5. Retention split: `tenant_data.audit` (native command-linked audit, `bigint` epoch-ms `happened_at`) is retained alongside the new `tenant_data.audit_event` sidecar (timestamptz, origin metadata). Confirm there is no requirement to deduplicate or backfill native audit rows into `audit_event` before PIVOT-006.

## DEVIATIONS FROM CONTRACT

1. Branch base and name (both disclosed above): the working tree was on the unmerged `opencode/auth-001` commit when I created the branch, so the first commit accidentally included AUTH-001 history in its ancestry. I rebuilt the branch on `testing-1` (`6c8bc25`) and the delivered diff contains only the four contract files. Branch name is `opencode/pivot-003` because `testing-1/...` is not creatable.
2. No runtime grants: the contract did not ask for grants and PIVOT-004 owns policies, so `tenant_data` is default-deny rather than granting a runtime role that could read cross-tenant rows. Documented in the SQL, README and report. No new grant file was created.
3. Native `INTEGER` 0/1 flags are represented as `boolean`, and native epoch-millisecond integers remain `bigint` epoch milliseconds while new Purpose C tables use `timestamptz`/`numeric`. This is a documented, lossless adapter mapping, not a column rename or a silent type substitution; the README states it.
4. `db/postgres/README.md` is a shared file: besides the PIVOT-003 sections I corrected its run order and identity wording only where PIVOT-003 made them inaccurate. No AUTH-001 content was added; the file explicitly records that AUTH-001 lands on a separate branch.
5. `business_member_operations` was intentionally not created in `tenant_data` (inventory maps it to `auth.business_member_operations`). This is a mapping citation, not a scope reduction.
6. Rerunning `20-tenant-schema.sql` is refused by PostgreSQL (plain `CREATE`) instead of matching PIVOT-002's `IF NOT EXISTS`. Rationale: silently skipping a changed table definition would hide drift; later changes are additive files in `operator.pg_schema_migrations`. Disclosed in case the engineer prefers the `IF NOT EXISTS` style.

## EXTENSIBILITY

compliant, with these explicit narrowing notes:

- No new hardcoded enums: the only fixed identifier is the single immutable ultimate-owner role id, which the owner mandate requires to be one definition rather than a growing domain; every other configured domain is a `tenant_data.reference_values` row seeded from `contracts/postgres-business-rules-v1.json`.
- No new coupling across module boundaries: this contract adds SQL, one JSON data file and one test only; no module imports or application code change.
- No new one-way decisions without an ADR: the deferred cross-schema FKs, the shared-schema model and the text-id preservation follow ADR01 (`docs/pivot-notes/01-adr-postgresql-pivot.md`) and contract NOTES; the deferred links are additive later (PIVOT-004) without a rewrite.
- Narrowing accepted: `tenant_data` cannot serve traffic until PIVOT-004/005/006 and AUTH-006 land. This narrowing is required by the invariants (no RLS means no safe tenant access) and is reversible by adding those contracts; nothing in the schema prevents them.
- Reversibility: the file is additive, owned by `saven_migrator`, contains no credentials or client data, deletes nothing and changes no SQLite/reference source or applied migration bytes.

## GIT

branch=opencode/pivot-003 commits=f6d3821 (implementation, based on testing-1 @ 6c8bc25), plus this report commit pushed=<recorded in the delivery message>


# PIVOT-003-R1 revision — 15 November 2026

Verdict and corrections: `docs/contractor/reviews/PIVOT-003-tenant-schema.md` delivered at `50b67491cf44d47b488545968a6093b59f32c9ac` on `codex/pivot-003-rulings`. Contract executed: the `IF REVISE` block of that review, on branch `opencode/pivot-003`, after AUTH-001-R1 completed.

## README serialization

The shared `db/postgres/README.md` is serialized. Commit `aa7638d` first carried the completed AUTH-001-R1 README sections (auth schema, run-order steps 3–4, auth boundaries, auth fixture) onto this branch; commit `73a9cfa` then applied the PIVOT-003-R1 corrections. No AUTH-001 text was removed or rewritten, and no AUTH implementation file was added to this branch. Both edits can merge in either order without conflict.

## Correction 1 — native empty-stock valuation restored

`db/postgres/migrations/021-tenant-schema-corrections.sql` is additive and applied after `20`:

```text
ALTER TABLE tenant_data.stock_balances
  ADD CONSTRAINT stock_balances_quantity_value_chk
  CHECK (quantity > 0 OR value = 0)
  NOT VALID;

ALTER TABLE tenant_data.stock_balances
  VALIDATE CONSTRAINT stock_balances_quantity_value_chk;
```

- This restores native `src/local/schema.mjs` `stock_balances` `CHECK(quantity>0 OR value=0)`; the target had kept only independent nonnegative bounds, so `(quantity=0, value=100, version=1)` was accepted where SQLite rejects it.
- Live cases: `INSERT` with `quantity = 0, value = 100` rejected; `INSERT` with `0/0` accepted; `UPDATE` adding value to an empty balance rejected; `UPDATE` to `0/0` accepted; positive quantity with zero value accepted (free stock). `convalidated = true` and the exact predicate are asserted from `pg_constraint`.
- `NOT VALID` + explicit `VALIDATE` refuses invalid pre-existing rows instead of repairing them. A rolled-back probe table inserts `(0, 100)` before the constraint, then proves `VALIDATE` fails with `violated by some row`.
- Not bill-and-hold custody: the affected table is the native owned-stock balance, and PIVOT-005/013 were not treated as a reason to omit a native structural CHECK.

## Correction 2 — tax default and notes reconciled

- `ALTER TABLE tenant_data.tax_profile ALTER COLUMN tax_type SET DEFAULT 'SALES_TAX'`. A defaulted profile now returns `SALES_TAX`, which is an actual seeded `tax_type` value; the previous lower-case `sales_tax` default could not resolve.
- The JSON authority note now says `origin_type ai` (the seeded value) instead of `origin_type AI`.
- Consistency coverage was extended beyond domain names: the static test resolves every `COMMENT ON COLUMN … reference domain:` annotation to its table column, applies `SET DEFAULT` overrides from the correction file, and fails if an effective default is not a seeded value of that domain. It also checks `document_status`/`origin_type` tokens quoted in `authority_notes` against their seeds, so defaults and canonical notes cannot silently drift. This check found exactly one mismatch before the fix (`tax_type`) and passes after it.

## Correction 3 — configurable severity externalized

- New reference domain `posting_constraint_severity` with values `block` (Block posting) and `warn` (Warn and allow posting), a documented validation rule (effective-dated `tenant_data.reference_values` rows, interpreted only by the registered deterministic handler named in `handler_key`, unknown value/handler fails closed) and the table annotation `tenant_data.posting_constraint (nested rule_jsonb.severity)`.
- The JSON Schema for `posting_constraint.rule_jsonb.severity` is now a structural string (`minLength 1`, `maxLength 40`) whose description names the reference domain; the inline `enum` is gone.
- `021` annotates the domain on `tenant_data.posting_constraint.rule_jsonb` so the SQL annotation set and the canonical seed remain equal.
- The static test recursively rejects any `enum` anywhere in `json_schemas` (not only top level), asserts the severity domain is seeded with exactly `block`/`warn`, and asserts the annotation/seed match. A new reference value still cannot install executable policy.

## Corrected claims

- README no longer claims "append-only policy versions". It now states that a duplicate policy-version key is rejected — uniqueness only — and that existing versions are not immutable until PIVOT-005/006.
- README no longer implies exactly one active owner. It states that the skeleton proves at most one protected role and at most one owner assignment; existence of exactly one active owner after activation is not enforced by a trigger-free skeleton.
- The live test label for the duplicate-version case says "key uniqueness only; existing versions are not yet immutable".

## DONE WHEN evidence

Environment: `node v24.19.0` (`.nvmrc`, required `>=24.13 <25`), dedicated disposable PostgreSQL 18.6 cluster from `initdb`, loopback `127.0.0.1:55439`, trust-local test-only admin `postgres`. Variables exported before the gate so the opt-in reaches the test process.

```text
$ node --version
v24.19.0
$ node scripts/check.mjs && node --test tests/pivot-003-schema.test.mjs
PASS: 147 JavaScript files parsed; package manifest valid.
✔ PIVOT-003 static schema contract: scoped tenant tables, exact money, no growing enums (12.971292ms)
✔ PIVOT-003 tenant schema applies with scoped identity, no RLS yet and no runtime grants (372.688505ms)
✔ PIVOT-003 tenant constraints enforce scoped money, ownership and cross-tenant isolation (519.141381ms)
ℹ tests 3
ℹ pass 3
ℹ fail 0
ℹ skipped 0
```

Exit status `0`. Full Node suite on the same runtime and cluster: `153` tests, `153` pass, `0` fail, `0` skipped (this branch does not carry the AUTH-001 test; the combined suite is 166 on `opencode/auth-001`). Fail-closed without the opt-in remains as previously recorded: the two fixture-backed cases refuse before mutation and the static case passes.

Documented full run order verified with AUTH-001 applied as well (`05`/`006` read from `opencode/auth-001` commit `991bc06`):

```text
$ psql -v ON_ERROR_STOP=1 -f db/postgres/00-roles.sql -f db/postgres/10-operator-schema.sql \
    -f 05-auth-schema.sql -f 006-auth-schema-corrections.sql \
    -f db/postgres/20-tenant-schema.sql -f db/postgres/migrations/021-tenant-schema-corrections.sql
RUN_ORDER_EXIT=0
schemas: auth,operator,tenant_data
```

`db/postgres/20-tenant-schema.sql` is byte-identical to `62405d2` (`8562311802a6204353964ec63a754a978123e7a5`); `00`/`10` are unchanged. The only changed paths versus `62405d2` are this report, `db/postgres/README.md`, `db/postgres/migrations/021-tenant-schema-corrections.sql`, `contracts/postgres-business-rules-v1.json` and `tests/pivot-003-schema.test.mjs`.

## R1 questions and deviations

- Questions: none outstanding. The review settled the schema/default/severity findings and the already-accepted deferrals. README ownership was serialized as instructed.
- Deviations: `db/postgres/migrations/` is now the additive-correction location (`006` from AUTH-001-R1, `021` here), exactly as both reviews require. The static default-consistency check considers correction-file `SET DEFAULT` overrides, because the base `20` bytes must not change. No RLS, grant, trigger, policy, identity authority or runtime privilege was added; no existing rows were rewritten.
- Cleanup: the disposable cluster was stopped and its data directory deleted; loopback port 55439 is closed; no `saven_pivot_%` role or database remains. Evidence logs stay in git-ignored `var/`.
