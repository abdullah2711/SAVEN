CONTRACT: docs/contractor/contracts/PIVOT-005-posted-immutability.md
STATUS: DONE (R2 revision: database contract and mechanism evidence; application route/page/RBAC limits recorded below)

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
