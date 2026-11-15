VERDICT: REVISE

WHY: Reviewed branch opencode/pivot-002 at c17fb108c2da4b9d5adf99e33fc18119534ec552, including the corrective implementation d5b7aaab12755ae7c835f4f158253f405bc736e3, its delivery report, the diff from the original delivery, and the combined branch against testing-1 at 9799ced94db422e1f3328561dd70a3bf0ef6b377. The entitlement immutability, TRUNCATE guards, explicit CI connection settings, namespaced fixture, cleanup-error aggregation, TLS verification and corrected policy/isolation wording address substantial parts of the earlier review. Acceptance is still blocked: the fixture substitutes its own role bootstrap and still uses a test login allowed to assume migrator authority; required separate-runtime-principal and object-owner assertions are absent; the unchanged deployment bootstrap still alters pre-existing roles; an outside-TOUCH change makes the general syntax/build command require PostgreSQL; and the explicitly required Verify SAVEN workflow has not passed. The report's local four-test and 149-test results are useful reported evidence, but do not satisfy every DONE WHEN and NOTES item. This is a source/evidence review; no database gate was independently rerun, no owner-server or credential file was accessed, and no branch was merged.

EXTENSIBILITY: compliant — no new hardcoded enums; no new coupling across module boundaries; no new one-way decisions without an ADR. Configurable reference domains remain rows, JSON values have version columns, and reference lookup, JSON-schema validation and entitlement activation are explicitly deferred and non-authoritative, as the corrective contract permitted. This limited finding does not certify those deferred features as implemented or waive the remaining security, scope and gate requirements.

## Findings against the existing contract

### B1 — Runtime separation and ownership evidence remain incomplete

In tests/helpers/pg-pivot-fixture.mjs:21–26 and 216–240, switchableRoleKeys includes migrator and the fixture grants all switchable roles to the same names.login principal used by asRole. Creating a separate migration connection earlier in the fixture does not remove this later grant. PostgreSQL checks role switching against session_user membership; NOINHERIT and a preceding SET LOCAL ROLE customerApp do not stop that login from switching to its granted migrator role. The current helper is a privileged test driver, not a representative runtime principal. This is a test-coverage/fixture boundary defect; it is not evidence that a deployed SAVEN customer has this login.

The test queries memberships where the member is one of the NOLOGIN target roles, so it misses grants to the actual login. It checks the disposable database owner at tests/pivot-002-operator.test.mjs:64–67, but does not assert schema, table, sequence or function owners. It has an operator-admin CREATE denial, but no required runtime ALTER/DROP or denied SET ROLE migrator/definer cases. These were explicit PIVOT-002b NOTES and ownership requirements, not newly requested product functionality.

Required: exercise customer, auth-service, operator-read and operator-admin through separate constrained login principals, without any direct or transitive migrator/definer membership. Keep the migration/test-owner connection separate. Assert the intended object owners and negative role-assumption/DDL behavior through those actual runtime connections. Retain the positive offline-migrator DDL case and existing privilege/immutability cases.

### B2 — The actual role bootstrap is bypassed and still rewrites existing roles

db/postgres/00-roles.sql is unchanged. Its ELSE branch still executes ALTER ROLE ... NOLOGIN NOCREATEDB NOCREATEROLE NOINHERIT for existing roles after checking only SUPERUSER/BYPASSRLS/REPLICATION. That can disable or otherwise change a pre-existing login. The prior review explicitly required unsafe pre-existing bootstrap definitions to be refused rather than silently reconfigured.

The revised fixture no longer executes 00-roles.sql. It creates replacement roles itself, while the test's static bootstrap checks only search for a customer-role name and absence of credential strings. Consequently the new refusal test proves namespaced fixture collision refusal, not preservation by the actual deployment bootstrap. It also snapshots selected attributes only; it establishes no before/after membership preservation case.

Required: make the actual bootstrap validate and refuse incompatible pre-existing target definitions before mutation, allowing a compatible no-op rerun without reconfiguring existing roles/memberships. Exercise the checked-in bootstrap SQL in the dedicated disposable cluster, using a documented namespaced rewrite if needed; do not substitute handwritten CREATE ROLE statements as the only bootstrap coverage. Test fresh creation, compatible re-entry and refusal with deliberately different pre-existing attributes plus membership snapshots. Keep all such objects isolated from owner/shared clusters.

### B3 — General syntax/build behavior was changed outside TOUCH

scripts/check.mjs is not in the PIVOT-002b TOUCH list, but d5b7aaa adds unconditional PostgreSQL environment checks and launches the focused database test there. package.json maps both check and build to this script. As a result ordinary npm run check/build now fail without the PG opt-in, and the specified three-command gate runs the focused test redundantly. This broadens the dependency of existing native/offline checks without being necessary for the requested explicit PostgreSQL test or CI wiring.

Required: restore scripts/check.mjs exactly to its testing-1 baseline at 9799ced. Keep dedicated-cluster opt-in/failure behavior in the PostgreSQL fixture/test. The explicit focused test and full-suite test remain mandatory and must fail clearly when their PG environment is absent. The ordinary parser/build command must retain its previous database-independent behavior. This review grants only restoration permission for that otherwise outside-TOUCH path.

The new delivery-report path is accepted as reporting for this owner-requested review. Merging testing-1 documentation into the contractor branch in 493049b is accepted; preserving published commits was appropriate and is not an integration merge of contractor code into testing-1.

### B4 — DONE WHEN is only partially evidenced

The report records the three requested commands against a local embedded-postgres 18.6 dedicated loopback cluster, four focused tests, 149 full-suite tests, no skips/failures, and subsequent role/database/temporary-directory cleanup. That environment is an acceptable replacement for the earlier owner-server tunnel. Cleanup remains contractor-reported rather than independently observed by this review.

However, the revised contract separately requires the existing Verify SAVEN workflow to pass. The report explicitly leaves that result pending, and the GitHub Actions runs query for opencode/pivot-002 returned zero runs during this review. The three Node commands are not the entire workflow, which also contains PostgreSQL verification scripts and Python/generated-document checks. An unmerged pull request targeting testing-1 can trigger the existing workflow; a production or integration merge is not necessary to obtain this evidence.

Required: after the remaining fixes, provide a successful Verify SAVEN Actions run for an unmerged PR containing the corrected code, identify its tested head/merge SHA, and retain exact local commands, dedicated-cluster configuration identity and cleanup results in the delivery report. A report-only follow-up commit may follow that tested implementation if clearly distinguished. Do not replace the workflow requirement with an unsupported claim of local equivalence, skip tests, weaken checks or merge to obtain a green run.

## Ownership and test-infrastructure decisions

- The offline saven_migrator owning operator DDL remains the intended design. The SQL implements that intent; the missing owner/runtime-isolation assertions above still prevent closing its evidence requirement. NOLOGIN is not sufficient if a runtime login can assume that role.
- Namespaced disposable roles/databases, pre-flight collision refusal, explicit test-cluster opt-in, cleanup aggregation and retained TLS verification are accepted improvements. No owner-server tunnel exception is needed or granted for this corrective run.
- The original report now distinguishes business-row isolation from cluster-wide role changes. That correction is accepted; historical remote cleanup is still not independently verified.
- The prior SSH credential transition remains a separate owner-managed action. PIVOT-002b reports no SSH use; this review does not make credential-file removal a new acceptance gate or authorize reading/deleting it.
- Immutable entitlement rows superseded by a new version, statement-level TRUNCATE refusal and deferred reference/JSON policy wording are accepted. Do not rebuild those fixes or add speculative tables, roles, policy engines or consumers.

## IF REVISE: bounded continuation of PIVOT-002b

The following revises only the remaining fix. It does not start PIVOT-003, AUTH-001 or a new product contract. Preserve delivered commits and append corrective commits on opencode/pivot-002. The standard seven-field contract is complete below.

```text
TASK: PIVOT-002b follow-up — close B1–B4: prove runtime/DDL separation and actual-bootstrap safety, restore the general syntax/build check, and supply the missing CI evidence; retain accepted schema and fixture fixes.
TOUCH: db/postgres/00-roles.sql; db/postgres/README.md; tests/helpers/pg-pivot-fixture.mjs; tests/pivot-002-operator.test.mjs; .github/workflows/verify.yml only if needed for the existing test environment; scripts/check.mjs only to restore its exact 9799ced baseline; docs/contractor/deliveries/PIVOT-002b-operator-schema-fixes.md.
FORBIDDEN: Every other path, including schema changes to the already-corrected 10-operator-schema.sql, engineer reviews/original contracts/ADRs, AUTH or tenant implementation, native/reference/archive code or applied migrations, production/client data, credentials and server configuration; no new product roles/tables/consumers, protected-ref writes, history rewriting, deployment or merge. Fixture-only disposable principals are permitted for the required isolation tests.
DONE WHEN: The dedicated disposable local/CI setup passes node scripts/check.mjs && node --test tests/pivot-002-operator.test.mjs && node --test tests/*.test.mjs, with no skipped PIVOT-002 cases or weakened existing checks; general node scripts/check.mjs also succeeds without PG settings; the existing Verify SAVEN workflow succeeds on an unmerged PR targeting testing-1 for the corrected implementation. The report identifies commands, test counts, exact tested commits/run URL, cluster identity/opt-in, before/after preservation evidence and cleanup outcome without credentials. Missing PG must fail the explicit database tests before mutation, without remote fallback.
INVARIANTS: Separate real runtime and offline migration principals; runtime owns no DDL and cannot assume migrator/definer authority directly or transitively; customer/auth retain zero operator access; verify schema/table/sequence/function owners; actual bootstrap leaves pre-existing definitions and memberships unchanged or refuses atomically before mutation; preserve fixture isolation/concurrency/cleanup reporting, issued entitlement immutability and append-only UPDATE/DELETE/TRUNCATE guards; preserve native/applied bytes and all accepted module boundaries; no SUPERUSER/BYPASSRLS grant to runtime, secrets, invented evidence or owner/shared-cluster access.
PATTERN: Submitted PIVOT-002b at c17fb108, original revised contract at 9799ced, and B1–B4 in this review. Use the actual checked-in 00-roles.sql for bootstrap coverage, namespaced inside the isolated fixture if necessary. Keep the constrained migration connection separate from runtime connections.
NOTES: Add separate runtime-login negative SET ROLE migrator/operator-definer/auth-definer and ALTER/DROP tests, object-owner assertions, actual-bootstrap fresh/no-op/incompatible-role tests, and before/after membership checks. Do not rely on a multi-role owner-capable driver as runtime evidence. Open or update an unmerged PR solely to run the existing workflow; do not merge or weaken trigger/check behavior. No additional schema/policy functionality or credential transition is requested. Update reporting honestly; keep published history and accept the existing documentation-sync merge.
```

IF REJECT: Not applicable. Keep the useful corrective work; restore only the out-of-scope scripts/check.mjs change as specified above.

## Requested acceptance confirmations

| Requested confirmation | Review result |
| --- | --- |
| Full PIVOT-002 + PIVOT-002b branch may merge as one unit | Not approved. testing-1 is an ancestor of c17fb108 and the combined diff was inspected, but technical ancestry does not satisfy the remaining acceptance conditions. |
| PIVOT-003 and AUTH-001 may proceed on this schema without amendment | Not cleared by this verdict. No new product-schema amendment is demanded here; finish and re-review the existing role/bootstrap and gate requirements first. This is not a review of either downstream implementation. |
| Report satisfies the revised DONE WHEN list | No. Local Node-gate evidence is reported; required Verify SAVEN success and several specified security cases are missing. |
| Earlier ownership/test-infrastructure notes resolved or accepted | Partly. Offline ownership design, local dedicated-cluster topology and completed schema protections are accepted; bootstrap preservation and ownership/runtime evidence remain open. |

## Evidence

- Reviewed delivery: https://github.com/abdullah2711/SAVEN/blob/c17fb108c2da4b9d5adf99e33fc18119534ec552/docs/contractor/deliveries/PIVOT-002b-operator-schema-fixes.md
- Corrective implementation: https://github.com/abdullah2711/SAVEN/commit/d5b7aaab12755ae7c835f4f158253f405bc736e3
- Governing revised contract: https://github.com/abdullah2711/SAVEN/blob/9799ced94db422e1f3328561dd70a3bf0ef6b377/docs/contractor/contracts/PIVOT-002b-operator-schema-fixes.md
- Earlier review: https://github.com/abdullah2711/SAVEN/blob/9799ced94db422e1f3328561dd70a3bf0ef6b377/docs/contractor/reviews/PIVOT-002-operator-schema.md
- PostgreSQL 18 role membership and SET semantics: https://www.postgresql.org/docs/18/role-membership.html and https://www.postgresql.org/docs/18/sql-set-role.html
- GitHub evidence query: https://api.github.com/repos/abdullah2711/SAVEN/actions/runs?branch=opencode%2Fpivot-002&per_page=20 — zero runs returned at review time.

Review date: 15 November 2026, Asia/Karachi. Only the engineer review file was written. No implementation fix, database test, SSH session, PR creation or merge was performed by this review.
