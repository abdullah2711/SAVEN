VERDICT: REVISE

WHY: Reviewed the complete five-file implementation diff in 244752cff23ab1b78e84755ba9d7c2d527f1cf29 and delivery report in cd1f83307c5db6abb0b930fd8df4426c0cf64394, against the actual PIVOT-002 contract and purpose inventory at 932cea83a8bc7e6c4c16d5eb3edc06b7677ab86d. The constrained roles, UUID/legacy-id mapping, absent duplicate identity tables and initial privilege tests are useful work. Acceptance is blocked by a fixture that can mutate pre-existing cluster-wide roles/memberships, missing full-suite CI configuration, and incomplete preservation of append-only/issued records. The reported remote 1/1 pass is evidence of one execution, not proof of the required isolation or of integration readiness. The engineer changed no implementation files, reran no database gates, opened no SSH connection and performed no merge or review of another contract.

EXTENSIBILITY: VIOLATED — configuration/reference rows avoid growing CHECK enums and source/native module boundaries are preserved, but issued entitlement claims remain mutable under their existing version, and the reference/configuration enforcement claims exceed what is implemented. Required standard: no new hardcoded enums; no new coupling across module boundaries; no new one-way decisions without an ADR. Correct these bounded gaps without rebuilding unrelated modules.

## Scope ruling: the actual contract controls

The submitted schema contains 11 operator tables, not four plus five, and no table literally named migration_ledgers or placement. The contract explicitly says inventory control tables must match the purpose map, names that map as PATTERN, and requires separate auth service/non-login definer owners. The four examples in the original pivot spec are not the whole authorized PIVOT-002 scope.

| Addition | Ruling | Existing authority / intended later dependency |
| --- | --- | --- |
| saven_auth_service | Retain; authorized role boundary | PIVOT-002 NOTES explicitly separates auth service from operator privileges; reserved for the AUTH lane, not a new login mechanism here |
| saven_operator_definer | Retain as constrained NOLOGIN function owner | PIVOT-002 INVARIANTS; intended PIVOT-007 audited functions |
| saven_auth_definer | Retain as constrained NOLOGIN function owner | PIVOT-002 INVARIANTS and purpose-map auth bootstrap boundary; no auth implementation reviewed here |
| operator.tenant_placement | Retain schema-only | Purpose map explicitly maps native fleet.placements; future fencing/placement work must have its own contract |
| operator.jobs | Retain schema-only | Purpose map maps native jobs.jobs; orchestration must not replace the owning business inbox/outbox |
| operator.ai_requests | Retain redacted metadata only | Purpose map maps native jobs.ai_requests; no prompt/body/proposal storage or AI execution is authorized |
| operator.migration_events | Retain append-only | Purpose map maps native migration history; later verification records evidence, not automatic cutover |
| operator.source_store_migrations | Retain append-only provenance | Purpose map explicitly separates native fingerprints from PG migration application |
| operator.pg_schema_migrations | Retain append-only target ledger | Purpose map explicitly defines the new PG migration lineage |
| operator.reference_value | Retain with corrected enforcement/documentation | Standing extensibility mandate permits growing reference domains; an unused lookup catalog must not be described as enforced effective-dated policy |

**No listed addition must be removed merely to reduce the count, and no new ADR is needed to justify these already documented schema/role placeholders.** This is permission to retain definitions, not a guarantee that every table is already consumed, necessary to the current running app, or will be used by a numbered near-term contract. Background job execution, fleet scheduling and AI metering are not delivered by empty tables; activation or materially different semantics needs a later scoped contract/ADR. Do not create new speculative tables or consumers in the fix. The delivery report is allowed for this owner-requested review; no other outside-TOUCH implementation file was changed in the submitted diff.

## Blocking findings

### R1 — Disposable database does not isolate cluster roles

tests/helpers/pg-pivot-fixture.mjs snapshots only target role names, executes 00-roles.sql even when those roles already exist, and grants saven_migrator to the administrative user. PostgreSQL roles and role memberships are cluster-wide. The comment that membership is granted only inside the disposable database is incorrect. 00-roles.sql alters existing roles to NOLOGIN/NOCREATEDB/NOCREATEROLE/NOINHERIT. If a target role pre-exists, cleanup deliberately keeps it and does not restore its original attributes or revoke the new administrative membership. The default PGADMIN_DATABASE=postgres and a loopback/SSH-forwarded address do not prove an isolated cluster.

Required: dedicated disposable PG cluster for automated gates, explicit test-cluster identity/opt-in, no owner/shared cluster fallback, and fail before role-changing DDL if unexpected/pre-existing target roles or memberships are present. Test safe re-entry only within a fixture-owned lifetime. Serialize or isolate concurrent fixtures using the fixed role names; a second fixture must not alter/drop another fixture's roles. Prove before/after catalog preservation on refused/pre-existing cases. Refuse unsafe pre-existing bootstrap role definitions rather than silently reconfiguring them. Propagate cleanup failures alongside the original test failure; current finally suppresses cleanup errors whenever runError is present. Do not disable certificate verification with rejectUnauthorized:false when TLS is requested.

### R2 — The submitted focused pass is not full-suite integration evidence

.github/workflows/verify.yml runs node --test tests/*.test.mjs without PGUSER/PGPASSWORD/PGHOST for that step. The new unconditionally discovered test connects as postgres with an empty password by default; the service is configured with a different test password, supplied only to later steps. Therefore the focused remotely configured pass does not establish that the repository test command will work in its declared CI environment. This is a source/configuration finding, not a claimed observed CI failure.

Required: wire explicit disposable-cluster configuration into the full-suite CI step, preserving existing tests. Do not skip the test when PG is absent or silently borrow owner-server credentials. Provide the focused gate and full existing Node-suite results from the same clean isolated setup. Any required test environment variables and safe cluster lifecycle must be documented.

### R3 — Append-only and issued-claim guarantees are incomplete

10-operator-schema.sql lines 338–352 guard UPDATE/DELETE on operator_audit, pg_schema_migrations, source_store_migrations and migration_events, but do not guard TRUNCATE. TRUNCATE does not invoke row DELETE triggers. Runtime roles currently lack that privilege, which is good; nevertheless the offline owner can accidentally truncate the supposedly append-only histories and the tests cover only UPDATE/DELETE. Add statement-level truncate refusal and explicit runtime privilege-denial tests. Do not claim protection against a privileged owner deliberately altering/dropping guards.

Lines 382–389 grant unrestricted entitlement UPDATE to saven_operator_admin. The same issued version's signature, claims, source, tier or write boundary can be changed in place, contrary to the table's stated supersede-not-rewrite contract. Protect issued semantic fields against in-place UPDATE/DELETE; renewals/corrections create a new version. Narrow allowed lifecycle changes and audit them rather than granting arbitrary claims mutation.

reference_value is currently not referenced by tenant.status/plan, entitlement.tier or job/placement/AI state fields; those columns merely have length checks. JSON schema-version comments likewise do not constitute validation, and feature_flag.value_jsonb has no documented version binding. In this fix, supply the minimal reference/configuration checks and documented shapes that these bootstrap fields claim to support, or explicitly label unimplemented policy behavior as deferred and non-authoritative. Do not assert full effective-dated policy enforcement or financial entitlement activation from this bootstrap. No enum CHECK lists or unrelated policy engine are requested.

## Ownership decision

**saven_migrator owning the target DDL objects is the intended offline-DDL design.** The original contract NOTE's unqualified no ownership wording was too broad; it applies to runtime roles/logins, not the offline schema owner or narrowly scoped function-owner roles. PostgreSQL objects necessarily have owners. Retain NOLOGIN/NOSUPERUSER/NOBYPASSRLS on the migrator, keep its membership/credentials out of every runtime login, and prove actual schema/table/sequence/function ownership plus negative runtime ALTER/DROP/SET ROLE tests. The target roles must not own the cluster/disposable database. Definer owners own their later functions only under separately reviewed grants. Ownership can alter/drop guards; it is an operational trust boundary, not tamper-proof audit storage.

## Remote gate exception ruling

Record the reported run as **owner-server, tunneled loopback, disposable-database evidence**, not a developer-local disposable-cluster gate. No production-table write is established by this review, and no harm is asserted. However cluster-wide role/grant changes are real even when business database rows are untouched. I do not accept that topology as the repeatable gate exception for future contracts. Repeat on a dedicated disposable local/CI cluster. Any future remote alternative needs a separately authorized, isolated test cluster and equivalent isolation proof before use.

The claim no existing database or role was touched and the reported final cleanup are not independently verified. Correct the report to distinguish existing business-row isolation from global catalog changes, state the actual temporary principals/objects and cleanup checks without secrets, and expose any cleanup uncertainty. Do not reconnect to or alter the owner server under this revision without separate authority.

## SSH credential-file ruling

Metadata-only inspection found the specified local file exists, inheritance is disabled, owner is the current user, and its listed ACL grants only that user FullControl. Its contents were not read, copied, logged or committed; encryption, credential lifetime and successful revocation were not verified. The ACL is a useful restriction, not a substitute for credential lifecycle control.

For ongoing automation, replace a reusable SSH password/plaintext-secret file with an SSH agent using a passphrase-protected key or an approved OS-backed credential store. An ACL-restricted file is only a short-lived bootstrap exception with explicit expiry/removal after migration, not standing permission for every contractor task. No automatic deletion, key installation, credential rotation or new server access is authorized by this review. The local file stays outside Git and outside the revised contract TOUCH list; owner-managed credential transition is recorded as pending. No evidence of compromise is asserted.

## IF REVISE — fresh bounded PIVOT-002b

This is a **fresh PIVOT-002b corrective contract**, not a silent subset of 002: CI wiring adds one file outside the original closed TOUCH list. It supersedes no other contract, does not authorize AUTH-001, and does not authorize new product functionality. Commit corrections after cd1f833 without rewriting the delivered commits. PIVOT-002 remains unaccepted until this revision is reviewed.

```text
TASK: PIVOT-002b — Correct PIVOT-002 fixture/CI isolation and preservation guarantees; retain the already-authorized schema/role inventory and return verifiable corrected evidence.
TOUCH: db/postgres/00-roles.sql; db/postgres/10-operator-schema.sql; db/postgres/README.md; tests/helpers/pg-pivot-fixture.mjs; tests/pivot-002-operator.test.mjs; .github/workflows/verify.yml; docs/contractor/deliveries/PIVOT-002-operator-schema.md
FORBIDDEN: All other paths, including this engineer review, original contracts/ADRs, AUTH code/schema, tenant_data implementation, src/local, postgresql, archive, BUILD_STATE, production/client data, host credentials, owner-server configuration, protected refs and history rewriting; no new product tables, roles or background consumers.
DONE WHEN: In a documented dedicated disposable local/CI cluster, node scripts/check.mjs && node --test tests/pivot-002-operator.test.mjs && node --test tests/*.test.mjs exits zero; the existing Verify SAVEN workflow passes with explicit isolated PG configuration, no skipped PIVOT-002 tests and no weakening of existing tests. Report exact commands/environment identity/results and cleanup evidence; absence of the required test cluster must fail clearly, not fall back remotely.
INVARIANTS: Preserve customer/auth zero operator privileges, runtime nonownership and no SUPERUSER/BYPASSRLS/elevation; offline migrator owns DDL only; pre-existing roles/memberships remain byte-for-byte semantically unchanged or execution refuses before mutation; fixture concurrency/cleanup is safe and failures visible; issued semantic entitlement versions and audit/provenance histories cannot be rewritten/truncated through normal paths; keep native/reference/applied migration bytes, source ids and module boundaries unchanged; no secrets or invented evidence.
PATTERN: Existing submitted PIVOT-002 files at 244752c; original PIVOT-002 contract and purpose map at 932cea8; follow this review's R1–R3 and ownership clarification, not a new implementation of another contract.
NOTES: Add focused cases for pre-existing-role refusal/unchanged catalogs, fixture collision/cleanup failure, runtime inability to assume migrator/definer authority using representative separate runtime principals, actual object owners, append-only UPDATE/DELETE/TRUNCATE and immutable issued claims. Preserve normal lifecycle changes only through narrowly allowed attributable transitions. Remove false database-local role-grant and enforcement claims. For reference/configuration behavior explicitly distinguish implemented validation from deferred policy; no speculative consumer is required. Do not reapply changed SQL to any accepted/shared installation: this branch is unmerged bootstrap work, and later applied releases require new immutable migrations. SSH-agent/credential-store transition is a separate owner action, not a gate requiring new remote access here.
```

## Downstream status

PIVOT-003 is **not cleared to proceed on this schema unchanged**. It may be drafted against the documented inventory, but acceptance/merge must wait for reviewed 002b and any resulting explicit schema-interface changes. No promise is made that each placeholder already has a live consumer. No merge has been performed. Return only corrected PIVOT-002b diff and gate report for the next review; no other contract is reviewed here.

## Evidence references

- Original contract: https://github.com/abdullah2711/SAVEN/blob/932cea83a8bc7e6c4c16d5eb3edc06b7677ab86d/docs/contractor/contracts/PIVOT-002-operator-schema.md
- Implementation: https://github.com/abdullah2711/SAVEN/commit/244752cff23ab1b78e84755ba9d7c2d527f1cf29
- Report: https://github.com/abdullah2711/SAVEN/blob/cd1f83307c5db6abb0b930fd8df4426c0cf64394/docs/contractor/deliveries/PIVOT-002-operator-schema.md
- PostgreSQL role scope: https://www.postgresql.org/docs/current/database-roles.html
- PostgreSQL ownership/privileges: https://www.postgresql.org/docs/current/ddl-priv.html
- PostgreSQL role membership: https://www.postgresql.org/docs/current/role-membership.html
- PostgreSQL truncate semantics: https://www.postgresql.org/docs/current/sql-truncate.html

Review date: 15 November 2026, Asia/Karachi. Engineer source review; contractor gate output remains reported evidence, not an independently rerun result.
