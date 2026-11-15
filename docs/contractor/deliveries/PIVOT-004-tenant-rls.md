CONTRACT: docs/contractor/contracts/PIVOT-004-tenant-rls.md
STATUS: DONE

Revision 3 (PIVOT-004-R2) is recorded at the end of this report. It applies the three findings of the engineering review at `577423c`. Revision 2 (PIVOT-004-R1) applies the four findings of the review at `a253807` (`docs/contractor/reviews/PIVOT-004-tenant-rls.md`): forced membership isolation, a narrow dedicated admission owner, completed scoped references and full authority-boundary evidence. The earlier delivery body is retained unchanged as the original record.

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

## Revision 2 — PIVOT-004-R1 corrections

Contract: the `IF REVISE` block of `docs/contractor/reviews/PIVOT-004-tenant-rls.md` (engineer verdict at `a253807`). The delivered base `30-rls-policies.sql` and every earlier SQL byte are unchanged; all corrections are the additive `db/postgres/migrations/031-rls-corrections.sql`, applied by the separate offline administrator.

### Finding → change mapping

| Finding | Old state | New state |
| --- | --- | --- |
| 1. Required auth membership isolation was missing | `auth.tenant_membership` had no RLS; README claimed AUTH-002/006 owned it | `ENABLE` + `FORCE ROW LEVEL SECURITY` on `auth.tenant_membership` with exactly two permissive, role-scoped, non-`PUBLIC`, non-blanket policies: `tenant_membership_preselect` (`saven_auth_service`, `user_id =` verified `app.current_user_id`) and `tenant_membership_admission_lookup` (`saven_tenant_admission_definer`, `(tenant_id, user_id) =` the verified context pair). No policy on `auth.users`/`auth.sessions`; no blanket truth. Preselection still permits listing a multi-tenant user's memberships after credential verification, and unset/empty/malformed context yields nothing. Membership writes have no policy and fail closed until the contract that implements them adds its own reviewed policy. |
| 2. Admission ran with full migrator authority | `session_admitted()` was `SECURITY DEFINER` owned by `saven_migrator` | New `saven_tenant_admission_definer` (NOLOGIN, NOSUPERUSER, NOCREATEDB, NOCREATEROLE, NOINHERIT, NOBYPASSRLS, NOREPLICATION), validated/refused if pre-existing incompatible; granted only `USAGE` on `auth`/`tenant_data`, column-level `SELECT` on `auth.tenant_membership (tenant_id, user_id, status, suspended_at, revoked_at)`, `auth.users (id, status)` and `tenant_data.members (tenant_id, user_uuid, active)`, and `EXECUTE` on the two context helpers. The function body now also requires `p_tenant = current_tenant_id()` and `p_user = current_user_id()`, so an arbitrary-principal probe returns false. Ownership transferred to the dedicated role as the offline administrator; no runtime is a member of it. |
| 3. Scoped references incomplete | Only the two member FKs existed; `journals.company` and `periods.company` accepted unknown companies | Six represented company columns now reference `tenant_data.company_profiles (tenant_id, id)`: `journals`, `periods`, `journal_drafts`, `document_registry` (nullable), `trade_controls`, `trade_parties`. Each is added `NOT VALID` then `VALIDATE`d, so incompatible rows fail loudly. Lookup indexes added for the new parents. Payload-only company/branch fields and every branch string (no branch master exists) are inventoried in `db/postgres/README.md` as application-level, together with the transitive `trade_documents` party constraint. Catalog coverage checks now use `relkind IN ('r', 'p')`. |
| 4. Least privilege and evidence | Blanket `USAGE, SELECT ON ALL SEQUENCES`; tests encoded omissions; mismatch test could pass on either FK; no atomic-failure evidence | Blanket runtime sequence grant revoked; only `tenant_data.audit_id_seq` is granted (`audit_event_id_seq` withheld). Tests rewritten as real-role evidence: dedicated-owner attributes/ACL/ownership, denied role assumption, denied arbitrary-pair oracle, principal-bound preselection, membership write fail-closed, same-tenant wrong-parent company rejections, and an atomic-failure probe. The mapping-mismatch case now has a valid membership and a wrong text/UUID pair and must fail on `members_canonical_identity_fkey` specifically. |

### Fixture support (authorized TOUCH)

`tests/helpers/pg-pivot-fixture.mjs` gained: an explicit `adminSqlFiles` opt-in that applies a correction as the fixture's private superuser after the migration files (needed for role provisioning and ownership transfer); a namespaced, preflight-checked `saven_tenant_admission_definer` extra role that is never part of the default seven-role bootstrap and is cleaned up; a `namespaceSql` export so a test applies a migration (or a deliberately failing variant) through the same role mapping; and simple-protocol `adminQuery` when no parameters are supplied, so multi-statement bodies with dollar-quoted blocks execute. Default behaviour for PIVOT-002/003 and the auth fixture is unchanged, and PIVOT-002 still passes in full.

### GATE EVIDENCE (R1)

Environment: dedicated disposable local PostgreSQL 18.6 cluster on loopback `127.0.0.1:55433`; `SAVEN_PIVOT_TEST_CLUSTER=1`; private generated test credential; Node **v24.19.0** supplied through `npm exec --package=node@24.19.0` (pinned range `>=24.13 <25`); no owner-server/SSH/production/shared-cluster access. Fixture created only `saven_pivot_%` objects; post-run counts: roles 0, databases 0.

```text
$ node scripts/check.mjs
PASS: 150 JavaScript files parsed; package manifest valid.

$ node --test tests/pivot-002-operator.test.mjs tests/pivot-003-schema.test.mjs tests/pivot-004-rls.test.mjs
✔ PIVOT-002 operator bootstrap enforces Purpose A authority boundaries
✔ PIVOT-002 fixture refuses pre-existing cluster roles before mutation
✔ PIVOT-002 checked-in role bootstrap refuses incompatible pre-existing roles atomically
✔ PIVOT-002 fixture namespaces isolate concurrent runs
✔ PIVOT-002 fixture reports run and cleanup failures together
✔ PIVOT-003 ... (three cases)
✔ PIVOT-004 static contract: forced RLS, atomic grants, membership isolation and exact binding
✔ PIVOT-004 catalog: tenant and membership isolation, no foreign policies, no bypass
✔ PIVOT-004 grants: dedicated admission owner, minimum sequences, no foreign access
✔ PIVOT-004 runtime: verified context isolates reads, writes and the admission oracle
✔ PIVOT-004 auth membership: principal-bound preselection and no cross-principal read
✔ PIVOT-004 scoped references: same-tenant wrong-parent and cross-tenant are both refused
✔ PIVOT-004 principal mapping: exact text/UUID membership and identity binding
✔ PIVOT-004 resists an extra permissive policy and an attacker permissive policy on auth
✔ PIVOT-004 correction 031 is atomic: a failing application leaves no partial state
ℹ tests 17
ℹ pass 17
ℹ fail 0
EXIT=0
```

Full Node suite on the same cluster and Node version (nothing removed, skipped or weakened):

```text
$ node --test tests/*.test.mjs
ℹ tests 178
ℹ pass 178
ℹ fail 0
EXIT=0
```

Behavioural evidence from the focused gate:

- **Membership preselection:** `saven_auth_service` with `app.current_user_id = U1` sees exactly U1's two memberships (T1 and T2) and none of U2's; with `U2` sees only U2's one; with no context or a malformed id sees zero. A membership INSERT as the auth service is refused by RLS.
- **Admission owner:** function owner is `saven_tenant_admission_definer`; `prosecdef` true; `proconfig = {search_path=pg_catalog, auth, tenant_data}`; customer `EXECUTE` true, auth service `EXECUTE` false, no `PUBLIC` execute; the role is `NOLOGIN`, no superuser/`BYPASSRLS`/`CREATEROLE`/inherit/replication; it holds column-level SELECT only (table-level SELECT false; no write, no tenant table other than `members`, no `CREATE` on the schema, no operator access); no runtime role is a member of it, and `SET LOCAL ROLE` to it is denied.
- **Oracle denial:** as the runtime with verified T1/U1 context, `session_admitted(T1,U1)` is true while `(T2,U2)`, `(T1,U2)` and `(T2,U1)` are false.
- **Scoped references:** unknown company in the same tenant is rejected for `journals`, `periods`, `journal_drafts`, `trade_controls`, `trade_parties` and `document_registry`; a party id that exists only in another tenant is rejected; a valid same-tenant parent is accepted.
- **Sequence least privilege:** runtime `USAGE` on `audit_id_seq` is true, on `audit_event_id_seq` false, and exactly one tenant sequence appears in its ACL.
- **Atomic failure:** a variant of `031` with an injected exception before `COMMIT` is rejected and the catalog snapshot (role existence, membership RLS, auth policy count, company constraints, sequence grant, function owner) is byte-identical before and after; the real `031` then applies cleanly, and a second application is refused with `031-rls-corrections.sql is already applied`.
- **Regression:** the earlier PIVOT-004 evidence still holds — three policies per tenant table, `FORCE` on the owner with `row_security = off` refused, missing/malformed/mismatched context denial, append-only privilege denials, tenant-key `WITH CHECK` refusals, and resistance to an injected extra permissive policy on both `tenant_data` and `auth.tenant_membership`.

### QUESTIONS FOR ENGINEER

1. `031` requires the **offline administrator (superuser)** because it provisions a role and transfers function ownership; the ordinary migration login cannot do either under the accepted mutual non-membership role model. The file refuses any other principal and says so in its first guard. Confirm that an administrator-applied correction is the intended deployment step (README run order 8 records it).
2. Membership **writes** (invite, accept, role change, revocation) have no policy in this correction, so they fail closed. That is deliberate: a policy allowing them needs the verified inviter/administrator context that the contract implementing those flows owns. Confirm the invitation/acceptance contract is expected to add that narrow policy rather than this one.
3. `auth.users` and `auth.sessions` are global principal/service records and still have no tenant RLS. The review's finding explicitly did not require blanket tenant policies there; their isolation is stated as a separate authority boundary. Confirm that this is the accepted boundary rather than an omission.
4. The sequence grant is now exactly `audit_id_seq`. If a later kernel schema adds identity-backed tenant inserts, it must grant its own sequence explicitly; there is no default privilege. Confirm that is the intended least-privilege convention.
5. No operator FK was added (the review confirms Private excludes vendor tables); tenant identity remains a service-contract relationship. The full company/branch/payload inventory is in the README so the application-level validation work is visible.

### DEVIATIONS (R1)

1. A fifth path was used as authorized: `tests/helpers/pg-pivot-fixture.mjs` (the correction contract lists it in TOUCH) for the administrator hook, the extra-role namespace/preflight/cleanup and the SQL namespace export.
2. `031` transfers only the function owner and grants column-level privileges; it creates no runtime principal, no membership and no login. `saven_tenant_admission_definer` is provisioned only if absent and is validated/refused if a pre-existing definition is unconstrained.
3. The membership write path is intentionally not granted. That is a narrow, reversible omission recorded as a question rather than a security relaxation.
4. The sequence privilege change revokes a grant made by `30`, not a semantic change to `30`'s file; the delivered SQL bytes are untouched.
5. Test context is still set with `set_config(..., true)` inside the disposable fixture transaction; the auth service preselection test does the same for `app.current_user_id`. This is scaffolding for proving policy behaviour, not a claim that application context is verified — AUTH-002/006 gate that, and the README says so.

### EXTENSIBILITY (R1)

compliant: no new hardcoded business enums or domain lists; the only new literal role is the dedicated non-login admission owner required by the ruling; the policies are predicates over verified context, not business rules; the correction is additive, transactional and reversible; the auth-side boundary and the invitation-write path are recorded as explicit extension points with named future owners rather than silently closed.

### GIT (R1)

branch=opencode/pivot-004-tenant-rls base=testing-1 @ d0a50cd previous=ed87e81 (reviewed) commits=recorded in the delivery message pushed=yes merged=no

## Revision 3 — PIVOT-004-R2 corrections

Contract: the `IF REVISE` block of `docs/contractor/reviews/PIVOT-004-R1-tenant-rls.md` (engineer verdict at `577423c`). The delivered `00/05/10/20/30/006/021/031` bytes are unchanged; all corrections are the additive, administrator-applied `db/postgres/migrations/032-rls-hardening.sql` plus authorized fixture, test, README and report updates.

### Finding → change mapping

| Finding | Old state | New state |
| --- | --- | --- |
| 1. Pre-flight refusal could delete a pre-existing role | The fixture's `finally` block dropped every untracked extra-role name unconditionally, so a refusal caused by an already-existing `saven_tenant_admission_definer` could delete it | Cleanup is now ownership-tracked and gated on a `preflightPassed` flag set only after the existing-object check passes. A refused pre-flight performs **no** object cleanup — no database drop, no role drop — and a completed pre-flight only drops objects this run created. New tests pre-create the namespaced owner with a membership, a role setting and a comment, snapshot attributes/memberships/settings/comment, force a pre-flight refusal, and assert byte-identical preservation plus no database creation. A second test fails the administrator hook after it creates the role and proves the database and role are removed while the primary error propagates. |
| 2. Extra permissive policies bypassed membership isolation | `031` installed only PERMISSIVE membership policies; an added `PERMISSIVE … TO saven_auth_service USING (true)` would OR past preselection | `032` adds independent RESTRICTIVE partners carrying the same predicate: `tenant_membership_preselect_scope` (auth service, verified `app.current_user_id`) and `tenant_membership_admission_scope` (admission owner, verified `(tenant_id, user_id)` pair). Each privileged role now has exactly one permissive and one restrictive policy, so a permissive addition is AND-ed against the restrictive predicate. The attack test now creates a real `USING (true)` policy **targeting the auth service**, then proves own-user preselection still works (T1+T2 for U1), a foreign principal and missing/empty/malformed context return zero, and the policy is dropped afterwards. `031`'s permissive-only expectation is superseded by `032`'s validator; no applied bytes were edited. |
| 3. A flag-compatible reused definer could retain excessive authority | `031` checked role flags and four named direct memberships only; table-level revokes did not clear independent column grants | `032` runs an exact allow-list validator before and after its policy work, inside the same rollback-on-failure transaction: role flags; direct and transitive outbound memberships (nothing it can `SET ROLE` into); inbound SAVEN principal paths (excluding the offline superuser); object ownership (only `tenant_data.session_admitted`); schema ACLs (exactly `USAGE` on `auth` and `tenant_data`, no `CREATE`, no `operator`); empty table/sequence ACLs; exactly the ten reviewed column `SELECT` grants; exactly the two helper `EXECUTE` grants plus the owner's own entry; no default-privilege path; no database or tablespace ownership. It refuses and rolls back rather than revoking, so unrelated grants are never silently stripped. The test exercises eight excess cases (column grant, table-level grant, schema `CREATE`, `operator` access, inbound runtime path, privileged outbound path, owned relation, owned function), proves each refusal adds no policy, then removes the excess and applies `032` cleanly. |

Accepted decisions retained: administrator-applied corrections, the narrow NOLOGIN owner with principal-bound SELECT-only preselection, fail-closed membership writes (ownership of invitation/acceptance policies stays with that future contract), separate `auth.users`/`auth.sessions` service/principal boundary, `audit_id_seq` as the only runtime sequence, and no vendor operator FK.

### Fixture support (authorized TOUCH)

`tests/helpers/pg-pivot-fixture.mjs` gained: `preflightPassed` gating all object cleanup; ownership-tracked dropping (created roles plus the namespaced extra owner only after a completed pre-flight); an `adminSql` option for inline administrator SQL under the same role namespace (used to simulate a hook failure); and documentation of the rule that a refused pre-flight never mutates cluster objects. Default PIVOT-002/003 behaviour and the auth fixture are unchanged, and the PIVOT-002 suite still passes in full.

### GATE EVIDENCE (R2)

Environment: dedicated disposable local PostgreSQL 18.6 cluster on loopback `127.0.0.1:55433`; `SAVEN_PIVOT_TEST_CLUSTER=1`; private generated test credential; Node **v24.19.0** supplied through `npm exec --package=node@24.19.0` (pinned range `>=24.13 <25`); no owner-server/SSH/production/shared-cluster access. Fixture created only `saven_pivot_%` objects; post-run counts: roles 0, databases 0.

```text
$ node scripts/check.mjs
PASS: 150 JavaScript files parsed; package manifest valid.

$ node --test tests/pivot-002-operator.test.mjs tests/pivot-003-schema.test.mjs tests/pivot-004-rls.test.mjs
✔ PIVOT-002 operator bootstrap enforces Purpose A authority boundaries
✔ PIVOT-002 fixture refuses pre-existing cluster roles before mutation
✔ PIVOT-002 checked-in role bootstrap refuses incompatible pre-existing roles atomically
✔ PIVOT-002 fixture namespaces isolate concurrent runs
✔ PIVOT-002 fixture reports run and cleanup failures together
✔ PIVOT-003 ... (three cases)
✔ PIVOT-004 static contract: forced RLS, atomic grants, membership isolation and exact binding
✔ PIVOT-004 catalog: tenant and membership isolation, no foreign policies, no bypass
✔ PIVOT-004 grants: dedicated admission owner, minimum sequences, no foreign access
✔ PIVOT-004 runtime: verified context isolates reads, writes and the admission oracle
✔ PIVOT-004 auth membership: principal-bound preselection and no cross-principal read
✔ PIVOT-004 scoped references: same-tenant wrong-parent and cross-tenant are both refused
✔ PIVOT-004 principal mapping: exact text/UUID membership and identity binding
✔ PIVOT-004 resists an extra permissive policy and an attacker permissive policy on auth
✔ PIVOT-004 correction 031 is atomic: a failing application leaves no partial state
✔ PIVOT-004-R2 fixture preflight never mutates a pre-existing extra role
✔ PIVOT-004-R2 fixture cleans role and database after an administrator hook failure
✔ PIVOT-004-R2 refuses excessive admission-owner authority without repairing it
ℹ tests 20
ℹ pass 20
ℹ fail 0
EXIT=0
```

Full Node suite on the same cluster and Node version:

```text
$ node --test tests/*.test.mjs
ℹ tests 181
ℹ pass 181
ℹ fail 0
EXIT=0
```

Behavioural evidence:

- **Pre-flight preservation:** a pre-existing owner role with a membership, `ALTER ROLE … SET search_path`, and a comment survives a refused `withPivotDatabase` with identical `pg_roles` row (including `rolconfig`), identical membership rows and identical comment; the disposable database is not created.
- **Hook failure:** administrator SQL that creates the owner role and then raises `division by zero` leaves neither the role nor the database behind; the division-by-zero error is what surfaces.
- **Permissive widening:** with a `PERMISSIVE … TO auth_service USING (true)` policy installed, the auth service still sees exactly its own principal's memberships (positive control T1+T2 for U1), zero for another principal, and zero with empty or malformed context.
- **Authority refusal:** each of the eight excess cases is refused with an `R2-AUTHORITY` message, the transaction rolls back leaving the original two membership policies, and the excess is undone; the clean stack then applies `032` and has the four-policy pair set, and a re-application is refused as already applied.
- **Regression:** all earlier PIVOT-004 evidence (tenant three-policy model, `FORCE` owner enforcement, context denial, append-only privileges, scoped references, mapping constraints) still passes.

### QUESTIONS FOR ENGINEER (R2)

1. `032` treats the owner's own `EXECUTE` entry on `session_admitted` (materialised in `proacl` by `ALTER FUNCTION … OWNER TO`) as part of the allow-list, since it is an ownership artifact rather than a grant. Confirm that reading is correct, or require an owner-entry check of a different shape.
2. The inbound-membership check exempts superusers because `pg_has_role` always answers true for them; the offline administrator is otherwise not a runtime path. If a non-superuser administrator role is introduced later, it should be added to the SAVEN-prefix check rather than exempted.
3. `032` refuses on any excess rather than stripping it, so a reused owner role with stale grants needs an operator decision. Confirm that refusal (with the `R2-AUTHORITY` detail) is the preferred operational failure instead of automatic revocation.
4. The new restrictive membership policies are `FOR ALL` with matching `WITH CHECK`, so they also constrain future writes if membership write policies are added. Confirm that is intended, or scope them to `FOR SELECT` once write flows are specified.

### DEVIATIONS (R2)

1. No delivered SQL byte was edited; the correction is the new `032` file, applied by the offline administrator through the existing fixture hook.
2. `032` contains no `GRANT`/`REVOKE`: it validates and refuses rather than repairing, per the finding. Privileges are only validated; the hardening consists solely of two restrictive policies.
3. The fixture's cleanup semantics changed in a security-relevant way (refusal now performs no cleanup). That is the correction, not a behavioural convenience; it is documented in the README and covered by regression tests.
4. The test suite grew to twelve cases and the per-run cost grew accordingly (about 5–6 s of fixture work); each refused 032 attempt is executed on a disposable database, never an owner/shared cluster.

### EXTENSIBILITY (R2)

compliant: no new hardcoded business domains; the only literals are the dedicated role name and the reviewed allow-list columns/functions required by the ruling; the authority validator is an explicit, replaceable policy rather than implicit trust; membership access now has a documented permissive+restrictive pattern for future roles; and the additive correction is reversible by a dated migration without rewriting applied bytes.

### GIT (R2)

branch=opencode/pivot-004-tenant-rls base=testing-1 @ d0a50cd previous=3769dda (reviewed) commits=recorded in the delivery message pushed=yes merged=no
