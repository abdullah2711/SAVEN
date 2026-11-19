# PIVOT-014 delivery — authenticated journal lifecycle vertical slice

Status: **DELIVERED, awaiting review.** No merge, no production activation, no database
cutover was performed. Nothing outside the contract TOUCH list was changed.

## Identity

| Item | Value |
|---|---|
| Contract | `docs/contractor/contracts/PIVOT-014-vertical-slice.md` |
| Branch | `opencode/pivot-014-vertical-slice` |
| Base SHA | `e0fa9fb` (testing-1, AUTH-009 merged) |
| Implementation SHA | `37399dac79264830ac3cc1a76f5047fa4039d637` |
| Report commit | `be2f76bd30f0304047b756b6334d25ef10499842` (this delivery, cover sheet and checkpoint; a later one-line commit records this SHA) |
| Worktree | `/home/esc/saven/wt-pivot-014` |

## Files changed vs TOUCH

| Path | Change |
|---|---|
| `src/accounting/vertical-slice/ports.mjs` | new — interfaces, error taxonomy, exact minor units, balance rule, canonical JSON |
| `src/accounting/vertical-slice/application.mjs` | new — versioned handler + composition helpers over the accepted auth modules |
| `src/accounting/vertical-slice/journal-service.mjs` | new — ordering/authorization/validation rules |
| `src/accounting/vertical-slice/pg-repository.mjs` | new — restricted-principal SQL, allocator, 042 call |
| `src/accounting/vertical-slice/README.md` | new — extension points |
| `tests/pivot-014-vertical-slice.test.mjs` | new — permanent focused test (9 subtests) |
| `tests/helpers/pivot-014-disposable-postgres.mjs` | new — disposable cluster + deterministic port + cleanup |
| `scripts/check.mjs` | existing checks preserved; mandatory execution of the focused test appended |
| `db/postgres/migrations/043-vertical-slice.sql` | new — narrow runtime grants only |

**No change** to 040/041/042/033 bytes, auth implementation, existing shared fixtures,
PIVOT-013 modules, native SQLite/reference code, production entry points, UI, dependencies
or deployment files.

## Why 043 was required

The accepted terminal-void primitive `tenant_data.void_posted_entry(...)` (042) and the two
accepted projections (`active_general_ledger`, `voided_entries`) were **never granted to the
tenant runtime role**, so no application request could use them without an administrator
connection, and a bespoke void implementation is forbidden. 043 is therefore the minimum
enabling change:

- `EXECUTE` on `tenant_data.void_posted_entry(uuid,text,text,text,text,text,text)` →
  `saven_customer_app`
- `SELECT` on `tenant_data.active_general_ledger`, `tenant_data.voided_entries` →
  `saven_customer_app`

It is gate-first (refuses when 042 objects are missing, when the void function is not owned by
`saven_void_definer`, or when the runtime role has privileged attributes), autonomous
(`BEGIN`/`COMMIT` inside the file), idempotent, records itself in
`operator.pg_schema_migrations` version 43, and grants nothing else — no ownership, no schema
CREATE, no role attributes, no BYPASSRLS, no cross-tenant authority.

## Gate evidence

Environment: Node **v24.19.0** (`~/.npm/_npx/.../node_modules/.bin/node`), PostgreSQL
**18.6** local binaries, disposable loopback cluster created by the test helper. No SSH,
cloud, shared database, environment skip or live credential. `node_modules` present locally
(the `pg` driver is a declared dependency); a missing driver or missing PostgreSQL binary
fails the gate nonzero with an actionable message.

Command 1 — full check (existing behaviour preserved, focused test mandatory):

```
$ node scripts/check.mjs
PASS: 178 JavaScript files parsed; package manifest valid.
▶ PIVOT-014 authenticated journal lifecycle (create → post → read → void → audit)
  ✔ S1 real application path and restricted principal (47.58ms)
  ✔ S3 cross-tenant refusal with permitted controls (71.83ms)
  ✔ S4 unbalanced request leaves no trace and consumes no number (34.93ms)
  ✔ S5 void is a state change with retained evidence (67.85ms)
  ✔ S6 complete lifecycle audit with enumerated change events (87.95ms)
  ✔ S7 idempotent replay and conflict refusal (61.54ms)
  ✔ S8 concurrent numbering and non-reusable allocation (95.10ms)
  ✔ S9 refusals are specific and paired with permitted controls (82.09ms)
✔ PIVOT-014 authenticated journal lifecycle (create → post → read → void → audit) (3333.90ms)
ℹ whole lifecycle completed in 3211ms of 240000ms budget
ℹ tests 9   ℹ pass 9   ℹ fail 0
PASS: PIVOT-014 vertical-slice lifecycle test executed and passed.
EXIT=0
```

Command 2 — focused test alone: `node --test tests/pivot-014-vertical-slice.test.mjs` →
**9/9 pass, exit 0** (same output as above).

### Whole-test budget and allocation/cleanup protocol (S2)

- **Declared budget: 240 000 ms** (`WHOLE_TEST_BUDGET_MS`), asserted at the end and enforced
  by the test runner timeout. Exhausting it fails the gate; cleanup still runs in `finally`.
- **Deterministic port allocation:** exactly one ephemeral bind on `127.0.0.1:0`; the port is
  closed and reused by the cluster. One allocation, no probing loop, no retry.
- **Cleanup:** `finally` closes the admin client and every pool, then `pg_ctl -m immediate stop`
  and removes the cluster directory. The test asserts nothing about residue because the helper
  fails loudly if stop/rm fails.
- **NO RETRY LOOP — explicit confirmation:** the focused test and the helper contain **no**
  retry of any operation and **no** retry-to-green path. The only loop is a bounded
  readiness wait (`waitReady`, 30 s) that polls `SELECT 1` until the server is up; it is a
  startup readiness probe, not a retry of a failed assertion, and it fails the run if the
  server never starts. Connection teardown, timeout and port-collision faults propagate as
  failures.

## Actual runtime database principal (S1)

| Evidence | Value |
|---|---|
| Business pool login (`session_user`) | `p014_app_login` |
| Effective principal (`current_user`) | `saven_customer_app` (NOLOGIN, NOSUPERUSER, NOCREATEDB, NOCREATEROLE, NOBYPASSRLS, no table ownership) |
| Auth pool login | `p014_auth_login` → `saven_auth_service` |
| Administrator connection | bootstrap/setup only (cluster init, schema lineage, synthetic identities/chart/company/period/reference rows, and independent verification queries). **Never** used for a lifecycle request. |

`SET ROLE saven_customer_app` is issued from a login that is a member of that single group
role and holds no owner/DDL/BYPASSRLS authority, so it is not "SET ROLE from an owner
connection". Tenant/user context is `SET LOCAL` inside each business transaction only.

The response `meta.principal` is asserted to equal `{current_user: 'saven_customer_app',
session_user: 'p014_app_login'}`, and `app.trace` is asserted to contain
`origin.verified → session.verified → tenant.admitted → csrf.verified → service.create →
principal.observed`. A no-cookie request returns `401 AUTH_REQUIRED` and never reaches the
service.

## S1–S9 assertion mapping (cover-sheet sentence → test → assertion)

| Property | Cover-sheet sentence (delivered file) | Test | Concrete assertion |
|---|---|---|---|
| **S1** | Real signed-in requests pass session verification, tenant admission and the journal service; bypass or admin connection fails. | `S1 real application path and restricted principal` | `app.trace` contains the six ordered steps; `meta.principal.current_user === 'saven_customer_app'`; `meta.principal.session_user === cluster.logins.app`; anonymous request `401 AUTH_REQUIRED`; wrong origin `421 ORIGIN_UNRECOGNIZED`. |
| **S2** | Runs automatically in the normal check command on a fresh disposable database; failure, budget overrun or hidden teardown fault fails the check. | `scripts/check.mjs` + helper | `check.mjs` exits nonzero when the test fails; `WHOLE_TEST_BUDGET_MS`/`elapsed < WHOLE_TEST_BUDGET_MS` assertion; no retry loop (see above); helper throws on missing prerequisite. |
| **S3** | Each tenant reads its own journal and audit while A is refused B's journal and B's audit; either forbidden success or permitted-control failure fails. | `S3 cross-tenant refusal with permitted controls` | A→B journal `403 TENANT_RESOURCE_DENIED`; A→B audit `403 AUDIT_TENANT_DENIED`; A's own audit non-empty and never mentions B's command; B's own read `200`; B's own audit contains B's command; B's tenant counts unchanged (`deepEqual` before/after); both refusals present in `auth.auth_audit` as `access_denied`. |
| **S4** | Balanced entry posts; unbalanced leaves no journal, line or business audit; wrong refusal reason or any surviving row fails. | `S4 unbalanced request leaves no trace and consumes no number` | `422 UNBALANCED_ENTRY`; `deepEqual` of journals/lines/audit/audit_event/document_numbers/document_sequences/command_inbox/outbox before and after; balanced twin posts `201 POSTED`. |
| **S5** | Void removes from active ledger, retains immutable history and evidence; active/again/mutated/missing-audit fails. | `S5 void is a state change with retained evidence` | `active_general_ledger` returns 0 rows for the entry; `voided_entries` returns both lines with the reason; journal row and both line rows are byte-identical (`to_jsonb` text) before/after; same-key retry adds no rows; new-key retry `409 ENTRY_ALREADY_VOIDED`; direct `UPDATE`/`DELETE` refused by the accepted guards; no tenant policy mentions the protected role name. |
| **S6** | Exactly one logical event per create/post/void plus the complete enumerated row-change evidence, correct tenant/actor/origin, redacted payloads. | `S6 complete lifecycle audit with enumerated change events` | create: `createExpected` (document_numbers/document_registry INSERT + document_sequences UPDATE, + INSERT when the row is new); post: 4 events (`journals`, 2×`journal_lines`, `document_registry` UPDATE); void: exactly `journal:ENTRY_VOIDED`; lifecycle 1/1/1 per command; actor = verified principal on every row; origin `human` where an origin column exists and `system` where 041 reports unavailable provenance; app audit path returns the same lifecycle and the complete 7–8 event window; session token and CSRF never appear; rollback probe (outbox INSERT revoked) leaves no journal, line or success audit. |
| **S7** | Retry preserves one journal/one logical event, adds no change events or allocation effects; duplication/incorrect conflict/failed control fails. | `S7 idempotent replay and conflict refusal` | replay `200` with `replayed: true` and identical tenant counts; concurrent replay identical counts; same key + different content `409 IDEMPOTENCY_CONFLICT`; foreign session `403`. |
| **S8** | Concurrent posts get different increasing numbers, cancelled allocations are never reused, gaps allowed. | `S8 concurrent numbering and non-reusable allocation` | measured peak concurrency `2`; distinct numbers; sequence uniqueness across `document_numbers`; abandoned reservation keeps its identity (`retry.reused === true`, same number); a later success advances past it; the abandoned identity belongs only to its own id; high-water regression `UPDATE` refused and `next_number` unchanged. |
| **S9** | Every refusal has a specific reason and working control, and a real guard-removal run must fail then pass. | `S9 refusals are specific and paired with permitted controls` + mutation run below | clerk may post but void `403 PERMISSION_DENIED` while the owner's void `200`; missing CSRF `403 CSRF_REQUIRED`; the three denial reasons present in `auth.auth_audit`; auth audit count strictly increased; mutation red/green recorded below. |

## Mutation red/green evidence (S9, actually performed)

Guard removed: the balance rule in `src/accounting/vertical-slice/ports.mjs`
(`if (debit !== credit) throw refuse.unbalanced();` commented out in the working copy only;
never committed).

```
RED   $ node --test tests/pivot-014-vertical-slice.test.mjs
  ✖ S4 unbalanced request leaves no trace and consumes no number (29.16ms)
  AssertionError [ERR_ASSERTION]: Expected values to be strictly equal:
  500 !== 422
  ℹ tests 9   ℹ pass 7   ℹ fail 2      (exit 1)

GUARD RESTORED
GREEN $ node --test tests/pivot-014-vertical-slice.test.mjs
  ✔ S4 unbalanced request leaves no trace and consumes no number (35.02ms)
  ℹ tests 9   ℹ pass 9   ℹ fail 0      (exit 0)
```

The mutation was not committed (`grep -c 'MUTATION PROBE'` → 0 after restore).

## Coverage and limits

**Proven:** the nine properties above, on real sessions, the real tenant gate, the real
service and the restricted principal.

**Excluded by contract (stated, not implied):** approval-policy review workflow and AI-origin
no-direct-post rules (a review-required authority is refused `APPROVAL_REQUIRED` rather than
silently posted); UI, reports, tax, multi-currency, reconciliation, inventory, trade, broad
PIVOT-013 parity, recovery tooling, operator support, production onboarding. Multi-line
journals are supported and audited, but the permanent test uses two-line entries.

**Known limitations, disclosed:**

1. Authority evaluation for post/read is implemented in JavaScript mirroring the accepted 042
   policy shape; the void decision itself comes from the accepted 042 function. A future
   contract may collapse both onto a shared database function.
2. 041 gives no entity id to sequence-counter and number-row change events, so the app audit
   path offers both correlations: `commandId` (entity) and `since` (id window). The test uses
   both and asserts the complete inventory through the window.
3. `document_sequences` is per `(tenant, company, kind)` and shared across branches; the
   accepted schema has no branch dimension, so numbering is not branch-scoped.
4. The security-audit pin asserts catalog version 1 against the active writer
   (`AUTH_AUDIT_CATALOG_VERSION`) and fails closed at composition on any mismatch.
5. Wasteful extra round trip: the create path runs a validation transaction before allocation
   so that a pre-allocation refusal cannot consume a number. This is deliberate for S4.

## Deviations

- **043 added**, as authorized for a narrow additive interface, with grants limited to the
  three accepted objects listed above. No payload rewrite, no privilege beyond the lifecycle.
- The two-login pattern (`p014_app_login` → `saven_customer_app`, `p014_auth_login` →
  `saven_auth_service`) follows the accepted deployment rule that membership is granted by
  the deployment administrator; no owner connection is used at runtime.

EXTENSIBILITY: no new hardcoded enums (actions are configuration from the accepted
`action_type` domain; document kinds are a map; reference values are rows); module boundaries
are the four ports; the one narrowing decision (043 grants) is recorded here and can be
extended by a later reviewed grant without a rewrite.
