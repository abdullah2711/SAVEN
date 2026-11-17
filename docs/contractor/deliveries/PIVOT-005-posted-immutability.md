CONTRACT: docs/contractor/contracts/PIVOT-005-posted-immutability.md
STATUS: DONE (R4 revision: database contract and mechanism evidence; application route/page/RBAC limits recorded below)

## What was delivered

Rebuilt from scratch under D-013/D-014 and ADR04 after the two owner halts. The prior role-specific draft was discarded; nothing role-based was carried forward.

- `db/postgres/migrations/040-posted-immutability.sql` (new payload, never applied before): immutable trigger functions for retained posted sources, children, evidence, numbering and drafts. Attaches no trigger itself.
- `db/postgres/migrations/042-entry-voiding.sql` (new, administrator-applied): append-only `tenant_data.entry_voids`; append-only `tenant_data.void_denials`; canonical `tenant_data.active_general_ledger` and `tenant_data.voided_entries` projections; the single atomic `tenant_data.void_posted_entry()` primitive under a narrow NOLOGIN definer; payload 042 guards for the void record, the VOIDED receipt, the denial log and the void audit rows.
- `db/postgres/40-triggers.sql` (rewritten): explicit dispatcher that attaches **every** registered payload (040 and 042), picks the highest installed version per guard, refuses required-but-missing payloads and refuses installed-but-unregistered payloads.
- `db/postgres/README.md`: run order steps 10–12 and a PIVOT-005 section (record, projections, primitive, terminal rules, role-agnostic visibility, reference-registration follow-up, limits).
- `tests/pivot-005-immutability.test.mjs`: 10 tests covering the ADR04 acceptance matrix below.

Role-agnostic by owner direction: 042 contains no business role name, no eligibility table/column, no void-specific read restriction and no category-specific denial. Voided entries are readable at the database level by anyone with module access inside tenant/company/branch scope; fine-grained visibility is deferred to future application RBAC / User Access Settings.

## ADR04 PIVOT-005 acceptance matrix — evidence

| Required case | Test | Result |
| --- | --- | --- |
| Successful plain-journal void with exact balanced active totals and retained raw bytes/numbers | `PIVOT-005 void: exact active totals, retained source, atomic effects` | Active GL 2 rows / 250 before → 0 / 0 after; `voided_entries` 2 / 250; raw lines retained (2); source receipt stays `POSTED`; receipt/audit/audit_event/outbox created atomically (1 each) |
| Terminal no-update / no-delete / no-unvoid / no-new-children protection | `PIVOT-005 void is terminal: ...` | Void record edit/delete, receipt state change, receipt delete, void-audit delete, late line/evidence/journal on the void command and on the voided entry are all refused; physical source rows stay immutable |
| Rollback on audit/outbox/effect failure | `PIVOT-005 void effects are atomic: a failing effect leaves no trace` | Injected outbox failure aborts the void; zero void records, receipts, audits, outbox rows or audit_event rows remain; the entry stays active |
| Idempotent replay and duplicate/void-versus-post races | `PIVOT-005 void: ...` and `PIVOT-005 races: ...` | Same key/digest returns the same receipt with no second event; different key on a voided entry → `ENTRY_ALREADY_VOIDED`; key reuse with different input → `VOID_IDEMPOTENCY_CONFLICT`; void before posting → `VOID_ENTRY_NOT_POSTED`, then exactly one void after posting |
| Cross-tenant denial | `PIVOT-005 authority: ...` and `PIVOT-005 tenant isolation ...` | Tenant-one context cannot void a tenant-two entry (`VOID_TENANT_CONTEXT_MISMATCH`); the second tenant sees zero void records, voided rows, active rows or denials |
| Equal in-scope module-reader access regardless of business role labels, with no role-specific SQL predicates or eligibility hardcoding | `PIVOT-005 authority: ...` plus static and catalog tests | A read-only custom role ("Auditor") reads the same voided projection and raw void record as the authorized user; 042 contains no senior/junior/auditor/eligibility predicate; catalog has no eligibility object; only `saven_customer_app`/PUBLIC appear as policy targets |
| Module read alone cannot execute a void | `PIVOT-005 authority: ...` | The read-only user is refused with `VOID_ACTION_REQUIRED`; runtime has no INSERT/UPDATE/DELETE on `entry_voids`, so the primitive is the only path |
| Missing/spoofed tenant or action context denied | `PIVOT-005 authority: ...` | No context / malformed context → `VOID_CONTEXT_REQUIRED`; actor mismatch → `VOID_ACTOR_MISMATCH`; tenant mismatch → `VOID_TENANT_CONTEXT_MISMATCH` |
| Tenant isolation resistant to permissive-policy widening | `PIVOT-005 tenant isolation ...` | An injected `PERMISSIVE ... USING (true)` policy still returns zero rows for the foreign tenant (restrictive scope policy) |
| Explicit linked dependency refusal without partial effects | `PIVOT-005 rejects unsupported linked dependencies ...` | Trade-backed command → `VOID_DEPENDENCY_UNSUPPORTED`; journal that is one side of a posted correction → `VOID_LINKED_CORRECTION`; zero void records afterwards |
| Fresh install and upgrade preserving 040 checksums and attachments | `PIVOT-005 catalog: ...` | Both payloads attached (`immutability_040_*` and `immutability_042_*`); re-applying 040 is refused as immutable; dispatcher re-run preserves all attachments |
| Durable denial logging | `PIVOT-005 denials are durably loggable and append-only` | A denied attempt raises; the caller records it in a later transaction in `void_denials`; update/delete of the denial log is refused |

## GATE EVIDENCE

Environment: dedicated disposable local PostgreSQL 18.6 cluster on loopback `127.0.0.1:55434`; `SAVEN_PIVOT_TEST_CLUSTER=1`; private generated test credential; Node **v24.19.0** through `npm exec --package=node@24.19.0` (pinned range `>=24.13 <25`); no owner-server/SSH/production/shared-cluster access. Fixture created only `saven_pivot_%` objects and removed them (post-run counts: roles 0, databases 0).

```text
$ node scripts/check.mjs
PASS: 156 JavaScript files parsed; package manifest valid.

$ node --test tests/pivot-005-immutability.test.mjs
✔ PIVOT-005 static contract: retained sources, terminal void, role-agnostic projections
✔ PIVOT-005 catalog: forced new tables, projections, narrow primitive owner
✔ PIVOT-005 void: exact active totals, retained source, atomic effects
✔ PIVOT-005 void is terminal: no edit, unvoid, physical deletion or second deletion
✔ PIVOT-005 void effects are atomic: a failing effect leaves no trace
✔ PIVOT-005 authority: module read is separate from the void action, context is verified
✔ PIVOT-005 rejects unsupported linked dependencies without partial effects
✔ PIVOT-005 races: posting state is rechecked and duplicates yield exactly one void
✔ PIVOT-005 denials are durably loggable and append-only
✔ PIVOT-005 tenant isolation holds for the new tables and projections
ℹ tests 10
ℹ pass 10
ℹ fail 0
EXIT=0
```

Full branch suite on the same clean cluster and Node version (nothing removed, skipped or weakened):

```text
$ node --test tests/*.test.mjs
ℹ tests 215
ℹ pass 214
ℹ fail 1
EXIT=1
```

The single failure is **pre-existing outside this contract's TOUCH list**: `tests/pivot-004-rls.test.mjs` ("PIVOT-004 resists an extra permissive policy and an attacker permissive policy on auth") creates its attack policy with the literal name `saven_customer_app`:

```sql
CREATE POLICY pivot004_attack ON tenant_data.accounts AS PERMISSIVE FOR ALL TO saven_customer_app USING (true) ...
```

The fixture namespaces every role per disposable database, so on a clean cluster that role does not exist and PostgreSQL raises `role "saven_customer_app" does not exist`. It only passed in earlier local runs because a manual bootstrap had left the global `saven_*` roles in that test cluster. This is a defect in the merged PIVOT-004 test, not in 040/042/40 or the fixture change here (which touches only `extraRoleKeys`); fixing it means editing a file outside this contract's TOUCH, so it is reported as a question instead. The contract's own gate — `node scripts/check.mjs && node --test tests/pivot-005-immutability.test.mjs` — is green (10/10).

The gate exercises actual runtime roles (`saven_customer_app` under transaction-local context) for the void primitive and projections, not privileged migrator reads. Migrator/admin queries are used only for seeding and catalog inspection.

## Explicit limits (not delivered)

1. **No application integration.** No production route, command handler, Delete confirmation/reason flow or Deleted/Voided Entries page. AUTH-006 gates verified application identity/action authority; PIVOT-013 owns command/policy/adapter integration and the active query consumers; a UI contract owns the pages and settings.
2. **No fine-grained visibility policy.** Per D-014, Voided Entries visibility is future application RBAC / User Access Settings. The database intentionally has no eligibility model, role-name predicate or category denial; the future policy must cover page/API/detail/search/export/AI and audit drilldowns.
3. **Denial durability is application-side.** PostgreSQL has no autonomous transaction, so a denied void cannot persist its own audit row; `void_denials` is the durable store the kernel writes in a separate transaction. The database primitive raises distinct, non-leaking error codes.
4. **Dependency graph is the plain journal.** Trade-backed entries and corrected originals are refused explicitly; broader AR/AP/stock/tax reconciliation is a later reviewed operational workflow. Physical stock movement/custody is never undone by an accounting void.
5. **Reference registration follow-up.** The `VOIDED` state and `accounting.entry.void` / `accounting.voided_entries.read` action keys must be registered in `contracts/postgres-business-rules-v1.json` by that file's owner; 042 annotates them inline but does not edit that out-of-TOUCH file.
6. **Private packaging** must implement the same controls locally with no vendor authority; this Cloud schema does not approve a Private mapping.
7. PIVOT-006 still owns generic audit coverage (payload 041); 042 protects only its own void audit rows and the dispatcher refuses an installed-but-unregistered 041.

## QUESTIONS FOR ENGINEER

1. The void primitive is `SECURITY DEFINER` owned by the dedicated `saven_void_definer` (created by the admin-applied 042, validated for flags/memberships/ownership/ACL). Confirm the exact grant list is acceptable as the minimal authority, or name any column-level narrowing you want.
2. Denied attempts: is `void_denials` written by the kernel (PIVOT-013) acceptable as the durable security audit, given PostgreSQL has no autonomous transaction, or should a separate non-transactional logger be contracted?
3. The dispatcher now refuses any installed-but-unregistered payload. Confirm that PIVOT-006 will register 041 in `40-triggers.sql` (and README) rather than loading only the newest payload.
4. Voiding a posted entry in a locked period is allowed and records the period-lock snapshot for attribution; confirm that matches the intended policy, or name the policy that should block it.

## DEVIATIONS FROM CONTRACT

1. 042 is applied by the **offline administrator (superuser)** because it provisions a NOLOGIN role and transfers one function's ownership; the guard refuses any other principal. It is registered in the README run order and the fixture's `adminSqlFiles` hook.
2. A dedicated `saven_void_definer` role was added (fixture namespace `saven_pivot_<suffix>_void_definer`) so the primitive never runs as the all-schema migrator and never reuses the admission definer, per ADR04.
3. The dispatcher's model changed from "newest payload" to explicit registration of every payload; that is the ADR04 requirement ("apply every required payload, never only newest") and is enforced fail-closed.
4. 040 was authored fresh from the discarded draft: the original source-protection logic was kept and extended so the structural terminal `VOIDED` receipt is also final and cannot receive late effects. No applied bytes existed at any point (nothing was committed or pushed before the halt).
5. The reference-data JSON was not edited because it is outside this contract's TOUCH list; the registration is recorded as a follow-up instead of silently extending scope.
6. **Out-of-TOUCH fixture support (disclosed for scope review).** `tests/helpers/pg-pivot-fixture.mjs` gained one entry in its existing `extraRoleKeys` mechanism so the new `saven_void_definer` NOLOGIN owner is namespaced per disposable database, preflight-checked and cleaned up like the existing admission definer. Without it, 042's `CREATE ROLE` would create a cluster-global role outside the fixture namespace, leak between runs and violate the fixture's "never touch unrelated cluster objects" guarantee; the alternative would be a broad migrator-owned definer, which ADR04 forbids. The file is not in this contract's TOUCH list; the change is minimal (two mapped names) and recorded here for an explicit scope decision. No other fixture behaviour changed and PIVOT-002/003/004 still pass.

## EXTENSIBILITY

compliant: no growing hardcoded state/domain list in 042 (only the structural `POSTED`/`VOIDED`/`DRAFT` terminal names are mapped explicitly, matching the accepted command-state reference data); no role names or eligibility hardcoding; the void dependency graph is an explicit refusal point behind a future workflow; the projections are views, not duplicated storage; the dispatcher is version-aware and additive; all source/evidence/numbers/applied bytes and the SQLite/reference code remain preserved.

## GIT

branch=opencode/pivot-005-immutability base=testing-1 @ 70dde6b commits=recorded in the delivery message pushed=yes merged=no


---

## Revision 2 — PIVOT-005 R1 corrections (verdict 950b22c)

> Historical section. Its test names, counts and `215/215` claim are superseded by Revision 3 below. The R2 full-suite number was produced on a cluster that already had manually bootstrapped global `saven_*` roles; it was not a pristine-cluster result. See the R3 gate evidence and the explicit PIVOT-004 explanation.

Finding-by-finding closure, all inside the existing TOUCH paths plus the review-authorized fixture and reference-seed additions.

| Finding | Correction | Evidence |
| --- | --- | --- |
| 1. Active GL included unposted sources | `active_general_ledger` now joins `command_inbox` and requires `state = 'POSTED'` **and** no void record; voided journals keep their historical POSTED receipt but are excluded as a whole | `active GL follows the source lifecycle...`: accepted (999) and failed (777) sources excluded, posted 250 included, voided excluded and retained in `voided_entries`/raw lines |
| 2. Invented permission shape, no denials/scope/policy/approval, locked periods allowed, unbound denial actor | New reviewed decision helper evaluates the **canonical** contract: `actions` + `companies`/`branches`/`accounts` + `maxMinor` + `review`, plus explicit `denials` (including `*`) and the effective `approval_policy`; the primitive stores the decision digest. Review-required voids need an APPROVED `approval_requests` row bound to the exact request digest with a different approver and a matching decision digest (stale binding refused). Locked periods are refused (`VOID_PERIOD_LOCKED`). The denial-log trigger overwrites actor/UUID from verified context | `void authority uses canonical permissions...`, `review-required voids need an independent, digest-bound approval` |
| 3. Races and concurrent replay unprotected; no correction guard | Shared advisory lock (`immutability_040_lock_key`) taken by command posting, journal/line/child inserts, correction links and voids; idempotency re-checked **after** the lock (same key replays the same receipt, including concurrently); a deferred constraint trigger re-checks both ends of correction references at commit; `journal_corrections` now has a dispatcher guard and is immutable | `concurrent replay and duplicate void...` (two real connections, `pg_sleep`), `corrections and voids serialize with commit-time invariants` (correction commits first → void refused) |
| 4. Runtime posting not proven; helper not granted | 040 grants EXECUTE on `assert_posted_effects` and the lock helper to the runtime; a test posts accepted → journal/lines/audit/outbox → POSTED **as `saven_customer_app`** and asserts missing-audit refusal | `runtime role posts through effects and rejects incomplete postings` |
| 5. Reused definer authority incomplete; grants too broad; silent repair | 042 grants an enumerated column-level minimum only (no blanket INSERT, `trade_documents` removed), validates the **complete** authority surface (flags, direct/transitive memberships, ownership of relations/schemas/functions/databases/tablespaces, schema ACL exactly `USAGE` on `tenant_data`, no `CREATE`, empty table/sequence ACLs, exact column ACLs, exact function ACLs, no default privileges) after transfer and rolls back on any mismatch; no schema-wide REVOKE sweeps. A polluted pre-existing role is refused and left untouched (its unrelated grant preserved) | `refuses a polluted pre-existing void owner without repairing it`, plus catalog assertions in the activation test |
| 6. Runtime exposure preceded protection | 042 grants the runtime **nothing**; `40-triggers.sql` is now the activation step: it attaches all guards (including the deferred correction constraint), validates them, then grants the primitive/projections/denial log and re-validates. Applying 040+042 without 40 leaves the primitive non-executable and the projections unreadable | `activation is fail-closed until the dispatcher installs guards` |
| Reference registration | `VOIDED`, `accounting.entry.void` and `accounting.voided_entries.read` added to `contracts/postgres-business-rules-v1.json`; guards use only structural terminal states | static contract test |

JSON addition is bounded to the reference domains and the authority note. No role-name or eligibility rule was reintroduced; D-014 remains binding.

### Gate evidence (R2)

Environment unchanged: disposable loopback PostgreSQL 18.6, `SAVEN_PIVOT_TEST_CLUSTER=1`, Node 24.19.0.

```text
$ node scripts/check.mjs
PASS: 156 JavaScript files parsed; package manifest valid.

$ node --test tests/pivot-005-immutability.test.mjs
✔ 10 focused cases (lifecycle, canonical authority, approval binding, runtime posting,
  terminal/replay, correction serialization, activation, polluted owner, static contract,
  concurrent replay) — tests 10, pass 10, fail 0

$ node --test tests/*.test.mjs
ℹ tests 215
ℹ pass 215
ℹ fail 0
```

Remaining limits: no application route/page/RBAC (AUTH-006, PIVOT-013, UI contract); denial durability is the kernel's separate `void_denials` write (PostgreSQL has no autonomous transaction); supported dependency graph is the plain journal; Private packaging and representative-volume measurements remain out of scope. PIVOT-006 must register payload 041 alongside 040/042.

---

## Revision 3 — PIVOT-005 R2 corrections (verdict 63a25a, review PIVOT-005-R2)

> Historical section. Its test names, counts and results are superseded by Revision 4 below. Its `15/15` focused and `219/220` full-suite numbers remain accurate for that revision but do not cover the R3 review's approval-scope/policy-applicability cases.

All four required corrections are implemented inside the contract TOUCH paths. 040 is still the new, never-applied payload, so its correction is in-place; no actually applied payload bytes were rewritten and no additive 043 was needed. 042 remains additive and re-applied in this disposable evidence environment.

### Finding-by-finding closure

| Review finding | Correction | Focused evidence |
| --- | --- | --- |
| 1. Approval metadata is not authority; policy units/selection incomplete | `immutability_040_approver_authority()` is the single canonical approver check: current active independent tenant member, `journal.approve` (or protected owner) grant scoped to the command resource, explicit denial refused. `approval_requests` may no longer be inserted as `APPROVED`; the transition is actor-bound to the verified member (`decided_by` must equal the current principal), `decided_by` and the bound digest become immutable, and the accepted command digest must match. 042 requires the pre-registered command's actor/digest/full submission to equal the void request, requires the approved canonical decision to equal the current decision exactly (entry, request digest, amount, currency, policy key/version, ordered role identities), and revalidates the approver at execution. `entry_voids.approver_actor`, `approval_digest` and the real policy `approval_version` are retained. Policy selection filters by the company currency, takes the highest active/effective version, fails closed on a same-version multi-key ambiguity or a currency mismatch, defines thresholds as exact minor units (non-integral/negative/out-of-bound invalid), and orders role identities deterministically with ids in the digest. Malformed `maxMinor`/`review` fails closed instead of becoming unlimited. | `rejects fabricated, self, unauthorised, wrong-submission and stale approvals`; `approval policy is currency-matched, deterministic, exact and revalidated at execution`; `void authority uses canonical permissions, explicit denials, scope, locked periods and maxMinor` |
| 2. Correction guards protect only the original | `immutability_040_correction_guard` takes both command locks in one deterministic order, rejects self-reference, requires a posted non-voided original **and** a non-final, non-voided reversal, and rejects a late link onto a posted or voided reversal. The deferred `correction_committed` rechecks both ends. The native accept-then-execute flow stays valid: the link is created while the reversal is pending and the commit-time check accepts it. | `correction links protect both ends, require link-before-post and refuse late links`; `correction and void writers serialize on both ends` |
| 3. Operational posting reconciliation is shallow | `assert_posted_effects` no longer accepts any stock/trade shape. A command carrying `trade_operations`, trade documents/lines/allocations/credits or `stock_operations`/`stock_movements` is refused before `POSTED` with `POSTED_OPERATION_UNSUPPORTED`. The supported boundary is the plain balanced journal; retained/imported operational rows are also refused by the void primitive with `VOID_DEPENDENCY_UNSUPPORTED`. This is an explicit fail-closed limitation, not a parity claim. | `runtime posting is exact for a plain journal and refuses unreconciled trade/stock shapes`; `refuses voiding retained operational dependencies without partial effects` |
| 4. Required regression evidence removed | Restored: runtime plain-journal posting; missing audit/outbox refusal; atomic injected outbox failure with zero partial void effects; exact `entry_voids`/`audit`/`audit_event`/`outbox` counts and receipt retention; role-agnostic module-reader positive; cross-tenant and missing/spoofed-context negatives; permissive-policy widening resistance; denial-log durability and actor binding; terminal mutations under runtime and administrative roles; same-source replay and same-key/different-entry conflict; both correction directions and late-child/late-line/evidence cases; interrupted/atomic activation; repeat dispatcher install; immutable re-application; five polluted-owner classes (extra table ACL, schema CREATE, membership, relation ownership, default privilege). Admin seeding/catalog checks are separated from runtime proofs. | The 15 focused cases below |
| Additional idempotency contract | The void primitive now takes a deterministic ordered pair of entry and idempotency-key locks, so same-key/different-entry concurrency returns `VOID_IDEMPOTENCY_CONFLICT` instead of a raw unique-index failure. | `replay, duplicate and same-key/different-entry races follow the idempotency contract` |

### Acceptance matrix (R3, actual runs)

| Required case | Focused test |
| --- | --- |
| Successful plain-journal void, exact active totals, retained bytes/numbers, atomic receipt/audit/audit_event/outbox | `active GL follows the POSTED lifecycle...` |
| Terminal no-update/no-delete/no-unvoid/no-late-child under runtime and administrative roles | `void is terminal under runtime and administrative roles...` |
| Injected effect failure leaves zero partial void effects | `void is terminal under runtime and administrative roles...` (pre-existing outbox id collision) |
| Idempotent replay, duplicate void, concurrent replay and same-key/different-entry conflict | `replay, duplicate and same-key/different-entry races...` |
| Canonical action/scope/denial/locked-period/maxMinor authority, malformed limit fail-closed | `void authority uses canonical permissions...` |
| Independent actor-bound approval; reject direct APPROVED insert, requester-stamped decider, self, unauthorised, wrong-submission, stale and revoked approval | `rejects fabricated, self, unauthorised, wrong-submission and stale approvals` |
| Currency-matched deterministic policy, threshold boundary, exact minor units, ambiguous key/currency/integral failure, real approval version, revocation between approval and execution | `approval policy is currency-matched, deterministic, exact and revalidated at execution` |
| Plain-journal posting and fail-closed unsupported trade/stock shapes | `runtime posting is exact for a plain journal...` |
| Both-ended correction protection, link-before-post positive, late-link-to-posted/voided refusal, void-versus-post | `correction links protect both ends...` |
| Correction/void serialization in both directions | `correction and void writers serialize on both ends` |
| Retained/imported operational dependency refusal without partial effects | `refuses voiding retained operational dependencies...` |
| Cross-tenant, missing/malformed/spoofed context, permissive widening, role-agnostic reader | `tenant isolation, missing/spoofed context...`; `active GL follows...` |
| Durable denial log, append-only, verified actor binding | `denial log is durable, append-only and bound to verified context` |
| Fail-closed/interrupted/atomic activation, repeat install, immutable payload re-application | `activation is fail-closed, atomic and repeatable` |
| Polluted owner classes refuse without repair | `refuses every polluted pre-existing void owner class...` |
| Static contract structure, canonical authority, reference registration | `static contract: lifecycle predicate, both-ended corrections...` |

### GATE EVIDENCE (R3)

Environment: dedicated disposable PostgreSQL 18.6 cluster created for this run on loopback `127.0.0.1:55435` with `initdb --auth=trust`, local admin principal `esc`, no SSH/owner-server/production/shared cluster. `SAVEN_PIVOT_TEST_CLUSTER=1`; Node **v24.19.0** via `npm exec --yes --package=node@24.19.0`. The fixture created only `saven_pivot_%` objects and dropped each database/role after the test; no global `saven_*` role was created.

```text
$ node scripts/check.mjs
PASS: 156 JavaScript files parsed; package manifest valid.

$ node --test tests/pivot-005-immutability.test.mjs
✔ PIVOT-005 active GL follows the POSTED lifecycle, retains source bytes and exposes a filterable voided projection
✔ PIVOT-005 void authority uses canonical permissions, explicit denials, scope, locked periods and maxMinor
✔ PIVOT-005 rejects fabricated, self, unauthorised, wrong-submission and stale approvals
✔ PIVOT-005 approval policy is currency-matched, deterministic, exact and revalidated at execution
✔ PIVOT-005 runtime posting is exact for a plain journal and refuses unreconciled trade/stock shapes
✔ PIVOT-005 void is terminal under runtime and administrative roles, and a failing effect leaves no trace
✔ PIVOT-005 correction links protect both ends, require link-before-post and refuse late links
✔ PIVOT-005 correction and void writers serialize on both ends
✔ PIVOT-005 replay, duplicate and same-key/different-entry races follow the idempotency contract
✔ PIVOT-005 refuses voiding retained operational dependencies without partial effects
✔ PIVOT-005 tenant isolation, missing/spoofed context and permissive-widening resistance hold
✔ PIVOT-005 denial log is durable, append-only and bound to verified context
✔ PIVOT-005 activation is fail-closed, atomic and repeatable
✔ PIVOT-005 refuses every polluted pre-existing void owner class without repairing it
✔ PIVOT-005 static contract: lifecycle predicate, both-ended corrections, fail-closed posting, role-agnostic activation
ℹ tests 15
ℹ pass 15
ℹ fail 0
EXIT=0
```

Full branch suite on the same clean cluster and Node version:

```text
$ node --test tests/*.test.mjs
ℹ tests 220
ℹ pass 219
ℹ fail 1
EXIT=1
```

The single failure is pre-existing and outside this contract's TOUCH: `tests/pivot-004-rls.test.mjs` → `PIVOT-004 resists an extra permissive policy and an attacker permissive policy on auth`. It executes:

```sql
CREATE POLICY pivot004_attack ON tenant_data.accounts AS PERMISSIVE FOR ALL TO saven_customer_app USING (true) WITH CHECK (true)
```

The fixture namespaces every role per disposable database, so on a pristine cluster the literal global role `saven_customer_app` does not exist and PostgreSQL raises `role "saven_customer_app" does not exist` (42704). This is the same out-of-TOUCH PIVOT-004 test defect disclosed in R2. It is **not** caused by 040/042/40 and was not repaired here.

**Correction to the R2 evidence claim:** R2's `215/215` was produced on a cluster that already carried manually bootstrapped global `saven_*` roles, which made that literal-role test pass. It was not a pristine-cluster result. R3 uses a fresh cluster, creates no global SAVEN roles, and therefore reports the unchanged prerequisite failure honestly instead of reproducing the earlier environment. No PIVOT-004 source or test change is part of this delivery.

An earlier full-suite run also showed `AUTH-002-R2 concurrent revoke and rotation linearize to at most one live session` timing out once under 220-test parallel load; a focused rerun of that test passed and the final full run above passed it. It is a pre-existing timing-sensitive test outside TOUCH, not a PIVOT-005 change.

### Explicit limits (unchanged or narrowed)

1. **No application integration.** No production route, command handler, Delete confirmation/reason flow or Deleted/Voided Entries page. AUTH-006 gates verified application identity/action authority; PIVOT-013 owns command/policy/adapter integration and active query consumers; a UI contract owns the pages and settings.
2. **No fine-grained visibility policy.** Per D-014, Voided Entries visibility is future application RBAC / User Access Settings. The database intentionally has no eligibility model, role-name predicate or category denial.
3. **Denial durability is application-side.** PostgreSQL has no autonomous transaction; a denied void cannot write its own audit row. `void_denials` is the durable store the kernel writes in a separate transaction.
4. **Operational reconciliation is not claimed.** The PostgreSQL posting boundary supports the plain balanced journal and fails closed on trade/stock shapes. PIVOT-013 owns the reviewed operational adapter/reconciliation workflow. Voiding never undoes physical stock/custody.
5. **Approval execution revalidates tenant-local membership and approval/resource authority.** Auth-session admission of the approver is checked at the approval decision (AUTH-006 session context); execution does not re-probe another principal's auth session, preserving the admission helper's anti-oracle rule. Revoking the tenant-local member/role or changing policy/roles invalidates execution.
6. **Locked-period policy.** Voiding a posted entry in a locked period is refused rather than silently overriding the period lock. A future policy may define an authorized exception with its own evidence.
7. **Reference registration** remains `VOIDED`, `accounting.entry.void` and `accounting.voided_entries.read`; no new domain or role-name rule was added.
8. **Private packaging** must implement the same controls locally with no vendor authority; this Cloud schema does not approve a Private mapping.
9. **PIVOT-006** still owns generic audit coverage (payload 041); 042 protects only its own void audit rows and the dispatcher refuses an installed-but-unregistered 041.

### EXTENSIBILITY

compliant: no new hardcoded business-role or eligibility rule; policy/role identity is data with deterministic ordering and versioning; approval policy is currency/unit explicit and fails closed on malformed/ambiguous configuration; corrections and voids use one shared lock protocol; the dispatcher remains version-aware and additive; all source/evidence/numbers/applied bytes and the SQLite/reference code remain preserved. The operational fail-closed refusal is an explicit boundary for a later reviewed adapter, not concrete cross-module coupling.

### GIT

branch=opencode/pivot-005-immutability base=testing-1 @ 70dde6b (R2 delivery 1ee28b9) commits=pushed with this report merged=no

---

## Revision 4 — PIVOT-005 R3 corrections (verdict af333f5, review PIVOT-005-R3)

Both remaining approval-authority corrections are implemented inside the existing TOUCH paths. 040 remains the new, never-applied payload (corrected in place); 042 remains the additive void payload (corrected in this disposable evidence environment). No applied production lineage was rewritten and no additive 043 was required.

### Finding-by-finding closure

| Review finding | Correction | New focused evidence |
| --- | --- | --- |
| 1. Approver resource/amount authority broader than its canonical grant; action-only fallback on unresolved resources | New `immutability_040_approval_resource()` resolves the exact company, branch, accounts and minor-unit amount from (a) the authoritative target of a terminal-void command, (b) the command's own journal rows, or (c) the immutable accepted payload's company/branch/lines for a pending command that has no journal yet. Missing, incomplete or malformed data fails closed with `APPROVAL_RESOURCE_UNRESOLVED`; there is no action-only fallback. `immutability_040_approver_authority()` now requires **one** role to satisfy `journal.approve`, company, branch, every account and `maxMinor` independently. Malformed arrays, non-numeric/non-integral/negative/out-of-bound `maxMinor`, and malformed payload line amounts fail closed. The same helper is called by the approval transition and re-run at void execution. | `approver authority applies the reviewer exact accounts and maxMinor at decision and execution` |
| 2. Policy selection ignores role applicability and can skip required review | `immutability_042_policy_decision()` now resolves policy against the requester's matching current role ids. Precedence is explicit: a role-specific policy overrides the global policy for that role; a matching role without a specific policy falls back to global. Selected policies combine conservatively (lowest threshold controls; any `requires_different_approver` wins), so an unrelated or higher-version high-threshold policy cannot mask another applicable role's required review. Two policy keys at the same maximum version for the same role/global scope fail closed as `VOID_POLICY_AMBIGUOUS`. The decision binds ordered `matchingRoleIds` and the full selected `policies` array (role id, policy key, scope `ROLE`/`GLOBAL`, version, currency, threshold, different-approver flag), so role or policy changes invalidate the approval. Only `approval_policy.role_id` was added to the dedicated owner's exact column grant/allow-list. The minor-unit convention remains limited to `accounting.entry.void`. | `approval policy applies only to matching current role identities` |

### Closure accounting for af333f5

- Finding 2 (both-ended correction protection) remains closed; no change was needed in R4.
- Finding 3 remains closed by the permitted fail-closed posting scope; no operational reconciliation is claimed.
- Finding 4 remains materially closed. The R4 report does **not** claim a concurrent reverse-arrival correction race: the late-link-to-voided-reversal and void-versus-post checks are controlled sequential assertions, while the correction-first/void-original-second case is the concurrent two-connection proof. Administrator queries remain used for seeding, policy setup and catalog/retention probes; runtime `SET ROLE customerApp` remains used for posting, approval transitions, void execution, isolation and concurrency.

### Acceptance matrix additions (R4)

| Required case | Test |
| --- | --- |
| Valid scoped reviewer with exact account scope and `maxMinor` boundary; approval transition + void execution | `approver authority applies the reviewer exact accounts and maxMinor...` |
| Reviewer account mismatch refuses approval | same test |
| `maxMinor` excess refuses approval; malformed `maxMinor` fails closed | same test |
| Pending accepted command resolves payload company/branch/lines; out-of-company reviewer refused; valid reviewer passes | same test |
| Missing/malformed accepted resource fails closed (no action-only fallback) | same test |
| Reviewer narrowed by account or amount after approval cannot execute | same test |
| Unrelated higher-version role policy does not apply or mask a required review | `approval policy applies only to matching current role identities` |
| Multi-role global + role-specific precedence and conservative combination | same test |
| Same-role/global maximum-version policy ambiguity fails closed | same test |
| Role change between approval and execution invalidates the approval | same test |

### GATE EVIDENCE (R4)

Environment: dedicated disposable PostgreSQL 18.6 cluster recreated for this run on loopback `127.0.0.1:55435` (`initdb --auth=trust`, local admin `esc`), no SSH/owner-server/production/shared cluster. `SAVEN_PIVOT_TEST_CLUSTER=1`; Node **v24.19.0** via `npm exec --yes --package=node@24.19.0`. No global `saven_*` role was created; the fixture namespaced and removed every object.

```text
$ node scripts/check.mjs
PASS: 156 JavaScript files parsed; package manifest valid.

$ node --test tests/pivot-005-immutability.test.mjs
✔ PIVOT-005 active GL follows the POSTED lifecycle, retains source bytes and exposes a filterable voided projection
✔ PIVOT-005 void authority uses canonical permissions, explicit denials, scope, locked periods and maxMinor
✔ PIVOT-005 rejects fabricated, self, unauthorised, wrong-submission and stale approvals
✔ PIVOT-005 approval policy is currency-matched, deterministic, exact and revalidated at execution
✔ PIVOT-005 approver authority applies the reviewer exact accounts and maxMinor at decision and execution
✔ PIVOT-005 approval policy applies only to matching current role identities
✔ PIVOT-005 runtime posting is exact for a plain journal and refuses unreconciled trade/stock shapes
✔ PIVOT-005 void is terminal under runtime and administrative roles, and a failing effect leaves no trace
✔ PIVOT-005 correction links protect both ends, require link-before-post and refuse late links
✔ PIVOT-005 correction and void writers serialize on both ends
✔ PIVOT-005 replay, duplicate and same-key/different-entry races follow the idempotency contract
✔ PIVOT-005 refuses voiding retained operational dependencies without partial effects
✔ PIVOT-005 tenant isolation, missing/spoofed context and permissive-widening resistance hold
✔ PIVOT-005 denial log is durable, append-only and bound to verified context
✔ PIVOT-005 activation is fail-closed, atomic and repeatable
✔ PIVOT-005 refuses every polluted pre-existing void owner class without repairing it
✔ PIVOT-005 static contract: lifecycle predicate, both-ended corrections, fail-closed posting, role-agnostic activation
ℹ tests 17
ℹ pass 17
ℹ fail 0
EXIT=0
```

Full branch suite on the same clean cluster and Node version:

```text
$ node --test tests/*.test.mjs
ℹ tests 222
ℹ pass 221
ℹ fail 1
EXIT=1
```

The single failure remains the pre-existing out-of-TOUCH PIVOT-004 test that creates a policy with the literal global role `saven_customer_app` on a namespaced pristine cluster. It is unchanged from R3 and was not repaired here. No global SAVEN roles were created to mask it.

### Explicit limits (R4)

1. **No application integration or UI.** AUTH-006 gates verified application context; PIVOT-013 owns command/policy/adapter integration; a UI contract owns Delete/Voided pages and RBAC settings.
2. **Approval resource support is the plain-journal/void shape.** The resolver deliberately fails closed on other command shapes until a later reviewed adapter defines their canonical resource; it does not infer authority from the action alone.
3. **Auth-session admission of the approver is checked at the approval decision.** Execution revalidates the tenant-local membership and current approval/resource authority without becoming a cross-principal auth-session oracle. AUTH-006 owns server-side session identity.
4. **No fine-grained void visibility.** D-014 role-agnostic database reads remain; application RBAC owns visibility.
5. **Denial durability is application-side.** PostgreSQL has no autonomous transaction; the kernel writes `void_denials` in a separate transaction.
6. **Operational posting/void reconciliation remains a PIVOT-013 limit.** The plain-journal boundary is explicit, not parity.
7. **Locked-period voiding is refused.** A future authorized exception requires its own evidence.
8. **PIVOT-006** still owns generic audit payload 041; 042 protects only its own void audit rows.
9. **Private packaging** must implement the same controls locally without vendor authority.

### EXTENSIBILITY

compliant: no business-role names or read-visibility predicates were added; approver authority and policy applicability are data-driven, versioned and fail closed on malformed/ambiguous configuration; the selected policy identities and matching role ids are bound into the snapshot rather than inferred later; the dedicated owner received only the exact `approval_policy.role_id` column grant; source/native/reference code, applied bytes, numbering and audit retention remain preserved. The plain-journal approval/resource boundary is an explicit extension point for a later reviewed adapter.

### GIT

branch=opencode/pivot-005-immutability base=testing-1 @ 70dde6b (R3 delivery 09a25ac) commits=pushed with this report merged=no
