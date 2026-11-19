# WORKER-B checkpoint — PIVOT-014 current assignment

Date: 19 November 2026 (Asia/Karachi).

## Current state — PIVOT-014 REVISION 4 (R3 corrections): PARTIAL

Date: 20 November 2026 (Asia/Karachi).

| Item | Value |
|---|---|
| Branch | `opencode/pivot-014-vertical-slice` |
| Implementation | `ee6caf070336bf4db58114bf7db3985cc9145459` |
| Gate | `node scripts/check.mjs` → 178 files, 17/17 lifecycle, exit 0 |
| Mutation | balance guard removed → `S4` red (15/2); restored → 17/17 |

### Per-finding (review 782ed6b)
| # | Status | Named proof / gap |
|---|---|---|
| 1 admission composition | PARTIAL | `S1`,`S3`,`S5`; accepted `tests/auth-006-context.test.mjs` **restored byte-identical** (1,943 lines/27 tests). Gap: env-gated suite not executed here; lock probes not appended to it. |
| 2 resource authority reservation | OPEN | `S2b` only. No denial/period reservation protocol or invalidation-first/mutation-first tests. |
| 3 consumed identities | PARTIAL (mechanism) | `S8`: nontransactional `nextval` source, rollback leaves a gap, hostile reuse conflict, 043 reapplication retains receipts/high-water. Gap: interrupted install, exhaustion, 043 profile validation. |
| 4 uncertain checkout | PARTIAL | `R1` ×4; uncertainty now marked **before** BEGIN, observer isolated. Gap: BEGIN-ack-loss and throwing-observer probes, size-one borrower. |
| 5 budget/cleanup | PARTIAL | setup-failure probe, stop verification, timeouts. Gap: one deadline incl. teardown. |
| 6 in-transaction refusal | PARTIAL | `S4` balance now checked inside the owned tx. Gap: concurrent initial same-key post race. |
| 7 truthful proof/cover | PARTIAL | cover re-issued; red/green re-run. Gap: overlap still request-counted, not lock-observed. |
| 8 catalog pin | CLOSED | catalog probe. |
| 9 accepted auth tests + 043 profile | PARTIAL | accepted suite restored; 043 payload/profile atomicity + receipt parents/provenance still missing. |

No merge. Worker owns 2, 5, 9 gaps next unless re-routed.

---

## Superseded — REVISION 3: both amendments implemented

Date: 20 November 2026 (Asia/Karachi).

| Item | Value |
|---|---|
| Branch | `opencode/pivot-014-vertical-slice` |
| Base | `e0fa9fb` |
| Revision implementation | `3d59e80bde960f681c68b7c5177a5ea4e3412fc3` |
| Gate | `node scripts/check.mjs` → 178 files, **17/17** lifecycle, **1/1** AUTH-006 context, exit 0 |
| Lineage | 00, 05, **006**, 10, 20, 021, 30, **031, 032**, 033, 040, 041, 042, 40-triggers, 043 |

### Amendment A (approved) — DONE
`src/auth/tenant-selection.mjs`: admission principal lock `FOR UPDATE` → `FOR NO KEY UPDATE`.
Gate-first principal→factor→session order, realm/role/epoch/MFA checks and
authority-through-completion unchanged; factor/session locks untouched.
Proof: `tests/auth-006-context.test.mjs` (KEY SHARE not blocked; NO KEY UPDATE / status /
credential / membership writers blocked `55P03`; permitted control after release) and void
committing under retained admission in `S5`.

### Amendment B (approved) — DONE
`043` adds immutable tenant-leading `tenant_data.document_allocations` (actor + request digest +
scope binding, forced RLS, narrow SELECT/INSERT, `ALLOCATION_RECEIPT_RETAINED` guard).
Proof: `S8` hostile reuse → `IDEMPOTENCY_CONFLICT`; real 043 reapplication retains receipts and
high-water; regression refused; gaps permitted.

### Per-finding status
| # | Status | Proof |
|---|---|---|
| 1 AUTH-006 composition + canonical lineage | **DONE** | `S1`, `S3`, `AUTH-006 …` |
| 2 canonical resource permissions | **PARTIAL** | `S2b`, `S3`, `S4`, `S6`, `S7` (no dedicated race test) |
| 3 immutable allocation identity | **DONE** | `S8` |
| 4 uncertain-checkout destruction | **DONE** | `R1 …` |
| 5 S2 setup/cleanup/budget | **PARTIAL** | setup-failure probe; teardown not in budget |
| 6 transactional validation + post key | **DONE** | `S4`, `S7` |
| 7 proof breadth | **PARTIAL** | `S3`, `S5`, `S6`, `S8` (overlap still promise-counted) |
| 8 active catalog pin | **DONE** | catalog probe |

---

## Superseded — REVISION 2: PARTIAL, findings 1 and 3 blocked on engineer amendments

Date: 20 November 2026 (Asia/Karachi).

| Item | Value |
|---|---|
| Branch | `opencode/pivot-014-vertical-slice` |
| Base | `e0fa9fb` |
| Revision implementation | `2af8fae254dc7f62e76156692d3b78ba9f31a020` |
| Revision report | `550378cea01a376afc15311afc8b69287f29bb65` (+ SHA-record commit) |
| Gate | `node scripts/check.mjs` → 178 files + **16/16**, exit 0, ~3.1 s of 240 s |

**LABEL: PARTIAL.** Findings 4, 8 DONE; 5, 2, 6, 7 PARTIAL; 1 and 3 OPEN and blocked on
engineer-owned amendments. Per-finding table with named tests is in the delivery §"Revision 2".

- **Amendment A requested:** AUTH-006 admission holds `FOR UPDATE` on `auth.users`; accepted
  042 `entry_voids_actor_fkey` needs `KEY SHARE` on the same row → the void blocks
  (`canceling statement due to statement timeout`) when the accepted gate is held across the
  business transaction. Options and blast radius are in the delivery.
- **Amendment B requested:** bounded additive 043 table `tenant_data.document_allocations`
  (+RLS+grants) to bind the permanent identity to verified actor/tenant/company/kind/request
  digest. Until approved, hostile different-actor reuse of a failed request's number remains
  possible and is disclosed, not hidden.
- Applying accepted `031`/`032` to the disposable lineage makes every request fail
  `TENANT_SELECTION_REQUIRED`; `006` is fine. 031/032 are therefore not in the delivered
  lineage; completing finding 1 needs the accepted composed path under Amendment A.

---

## Current state — PIVOT-014 vertical slice DELIVERED, awaiting review

- Contract: `docs/contractor/contracts/PIVOT-014-vertical-slice.md`.
- Branch `opencode/pivot-014-vertical-slice`, worktree `/home/esc/saven/wt-pivot-014`,
  base **`e0fa9fb`** (testing-1, AUTH-009 merged).
- Implementation commit: **`37399dac79264830ac3cc1a76f5047fa4039d637`**.
- Delivery report: `docs/contractor/deliveries/PIVOT-014-vertical-slice.md`;
  delivered cover sheet: `docs/contractor/deliveries/PIVOT-014-vertical-slice-cover-sheet.md`.
- Gates (Node 24.19.0, local PostgreSQL 18.6, disposable loopback cluster):
  `node scripts/check.mjs` → 178 files parsed + focused test **9/9 pass**, exit 0;
  focused test alone → 9/9, exit 0. Whole-test budget 240 s, measured ~3.2 s.
- Not merged; no production/cloud/shared database touched; no credential committed.

## Per-finding enumeration (round 1 — no prior review findings)

| Finding | Status | Proving test |
|---|---|---|
| S1 real application path / restricted principal | **DONE** | `S1 real application path and restricted principal` |
| S2 permanent automated test, no flakiness, budget, cleanup | **DONE** | `scripts/check.mjs` + `S2` budget assertion, helper cleanup |
| S3 cross-tenant refusal with permitted controls | **DONE** | `S3 cross-tenant refusal with permitted controls` |
| S4 balanced posts; unbalanced leaves no trace | **DONE** | `S4 unbalanced request leaves no trace and consumes no number` |
| S5 void is a state change with retained evidence | **DONE** | `S5 void is a state change with retained evidence` |
| S6 complete lifecycle audit with enumerated change events | **DONE** | `S6 complete lifecycle audit with enumerated change events` |
| S7 idempotency and conflict refusal | **DONE** | `S7 idempotent replay and conflict refusal` |
| S8 numbering under concurrency, D-016 | **DONE** | `S8 concurrent numbering and non-reusable allocation` |
| S9 no dishonest pass + mutation proof | **DONE** | `S9 refusals are specific and paired with permitted controls` + recorded red/green run |
| Principal directive: S1–S9 assertion mapping in delivery | **DONE** | delivery §"S1–S9 assertion mapping" |
| Principal directive: mutation red/green evidence | **DONE** | delivery §"Mutation red/green evidence" (S4 red `500 !== 422`, restored 9/9) |
| Principal directive: actual runtime principal recorded | **DONE** | delivery §"Actual runtime database principal" (`p014_app_login` → `saven_customer_app`) |
| Principal directive: confirmation no retry loop in the gate | **DONE** | delivery §"NO RETRY LOOP — explicit confirmation"; helper has one bounded readiness probe only |
| PIVOT-006 review pin: catalog version 1 via active writer default for S3/S6 | **DONE** | `S6` asserts `AUTH_AUDIT_CATALOG_VERSION === PINNED_CATALOG_VERSION === 1`; composition fails closed on mismatch |

**PARTIAL / UNTOUCHED:** none within the contract. Explicitly **not implemented** (contract
exclusions, not gaps): approval-policy review workflow and AI-origin no-direct-post rules
(refused `APPROVAL_REQUIRED`, never silently posted); UI, reports, tax, multi-currency,
reconciliation, inventory/trade, PIVOT-013 parity, recovery tooling, operator support,
production onboarding.

## Disclosed limitations

1. Post/read authority is evaluated in JavaScript mirroring the accepted 042 policy shape; the
   void decision comes from the accepted 042 function. A later contract may share one function.
2. 041 gives sequence-counter and number-row change events no entity id, so the app audit path
   exposes both `commandId` (entity) and `since` (id window); the test asserts the complete
   inventory through the window.
3. `document_sequences` is per `(tenant, company, kind)`; the accepted schema has no branch
   dimension, so numbering is not branch-scoped.
4. 043 was required and is limited to `EXECUTE` on the accepted void primitive and `SELECT` on
   the two accepted projections for `saven_customer_app`.

## Where I stopped

Delivered and pushed; no further work started. Awaiting engineer review, then the dispatcher's
verdict relay. **Not merged.**

## Cross-reference

The PIVOT-006 allocator/restore inventory (D-016 base) lives on `opencode/pivot-006-audit` at
`de1ecb0`; it is not on this branch. Any repository-wide inventory rebase after this
tree-changing merge is D-017 follow-up work, not performed here.

---

# WORKER-B checkpoint — PIVOT-006 R3 delivered, ACCEPTED, awaiting human merge

Date: 18 November 2026 (Asia/Karachi). Written under the owner standing checkpoint
directive; this file is outside any contract TOUCH.

## Current state

- PIVOT-005 is complete and human-merged into `testing-1` at
  `32fef2beac91a73b2c8a5ae9c150603736993e97`; post-merge checkpoint `e671882`.
- PIVOT-006 branch: `opencode/pivot-006-audit`.
- Worktree: `/home/esc/saven/wt-pivot-006`, based on `32fef2b`.
- **PIVOT-006 R3 delivered at `5d909a78dcb2258cb87b012f7195214b7edf3826`**
  (`docs: record PIVOT-006 R3 intermediate failure evidence`; implementation
  `cb81f11cc9f29c9dec5acccb16cb06c20df8337f`).
- **Codex ACCEPT at `26f8263` (02:45 PKT, 18 November 2026).**
- PIVOT-006 is **awaiting the human merge decision** and is a merge-queue item. It is not
  merged; no main/other branch was changed and no force was used.
- Worker status: **idle, not looping**, since approximately **02:00 PKT** awaiting the
  verdict. No new work was started after that point.

## Review corrections closed (d8fe104, R1 review and R2 review)

1. **Dedicated least-privileged audit owner.** 041 is now an offline-admin payload that
   provisions `saven_audit_definer` (`NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE
   NOINHERIT NOBYPASSRLS NOREPLICATION`). It owns only the audit writer, native-audit
   guard, serializer, row-key and origin helper. Exact authority: `tenant_data` USAGE;
   enumerated `members` and `reference_values` mapping reads; enumerated `audit_event`
   column INSERT; `audit_event_id_seq` USAGE; exact context/admission helper EXECUTE.
   Install validates attributes, memberships, ownership, schema/table/sequence/column/
   function ACLs, default privileges and exact function configuration, refusing polluted
   roles without repair. No runtime business/evidence grant, table ownership, schema
   CREATE, broad auth/operator read or admission-owner expansion.
2. **Native audit actor binding.** A new `immutability_041_audit_native_guard` attaches
   BEFORE INSERT on `tenant_data.audit` and requires the admitted canonical tenant/actor
   (`AUDIT_ACTOR_MISMATCH` on spoof/invented actor, `AUDIT_CONTEXT_REQUIRED` on missing
   context). Historical ids/bytes/timestamps/counts are not rewritten or backfilled.
   Tests cover runtime success, spoofed/invented actor, missing context, rollback and the
   existing void-definer ENTRY_VOIDED path.
3. **Versioned secret-safe serialization.** Version 1 serializer retains structured
   scalars and reviewed business text; JSONB and unreviewed text become a redacted digest
   marker and are listed in `redactedColumns`; unsupported column types fail closed with
   `AUDIT_SERIALIZATION_UNSUPPORTED`. Tests cover JSONB/text secret INSERT/UPDATE/DELETE
   negatives, safe business-value positives and a synthetic `bytea` fail-closed case.
   Original financial/source bytes remain intact.
4. **Validated provenance, no manufactured human origin.** Document origin columns are
   validated against active canonical `origin_type` reference values; AI retains
   model/version and requires a tenant-member proposer; human cannot name a model and
   falls back only to the verified actor when no origin user is supplied; integration
   requires identity/model. Generic changes record unavailable provenance as `system`
   with `detail_jsonb.provenance='unavailable'`, keeping `actor_id` as the verified
   acting principal. AI/human/integration positives and spoof negatives are tested; a
   client GUC cannot manufacture origin.
5. **Standard delivery report + activation/quiescence evidence.** The delivery report
   records exact branch/base/implementation/report identities, gates, covered/excluded
   tables, guarantees vs evidence and limits. Failed, partial and interrupted 041/40
   activation tests prove the dispatcher transaction leaves no partial audit trigger set;
   the 041-without-dispatcher window is explicitly unaudited and requires write
   quiescence. 040/042 bytes are untouched and 040/042-only compatibility remains
   honestly non-PIVOT-006 coverage.
6. **R1 serialization/schema correction.** The serializer now classifies supported base
   types by catalog type identity, preserving exact parameterized numerics
   (`numeric(20,4)` on `approval_policy` thresholds/self-approval and `numeric(9,6)` on
   `tax_profile.rate`) without float casts/rounding. Every registered table has an exact
   reviewed schema fingerprint over ordered column names, base types and typmods; new,
   renamed or retyped columns raise `AUDIT_SERIALIZATION_SCHEMA_CHANGED`, unknown base
   types raise `AUDIT_SERIALIZATION_UNSUPPORTED`, and both roll back. Real
   customer-role INSERT/UPDATE tests cover both decimal tables with exact before/after
   values; rollback and context-bound DELETE/rollback are tested. Catalog-driven coverage
   asserts all 42 registered table fingerprints, a new allow-listed-name column and a
   supported base-type change both fail closed. Reviewed business free text remains
   explicitly retained with the documented non-universal-secret-free limit.
7. **R2/R3 catalog type identity and schema inventory.** 041 now resolves type identity
   through `pg_catalog` OIDs, type kind and recursive domain-base resolution; no
   `typname` or type-name literal comparison remains. Custom domains over text still
   redact; custom domains over `numeric(20,4)` still write/audit exact money values.
   Every registered table has an exact fingerprint over column names, resolved base OID
   and effective typmod. The activation pipeline refuses a changed fingerprint or a
   column base type outside the exact representable OID allow-list. The focused test
   enumerates every column type actually present and fails if the reviewed type set
   changes. The unrepresentable-type decision is explicitly fail-closed (no
   redact-and-warn).

## Intermediate failure evidence (R3)

- First R3 activation run failed with exact text
  `PIVOT-006: unreviewed schema change on audit table account_profiles`.
  Hypothesis: `immutability_041_resolve_type` is `RETURNS TABLE` but used bare `RETURN;`,
  so it emitted zero rows; the fingerprint aggregate was NULL for every table. Fix:
  `RETURN QUERY SELECT v_type, v_mod; RETURN;`. The same resolver failure made the new
  schema-wide type enumeration initially return an empty actual-OID set. After the fix,
  the catalog fingerprint, decimal, domain and pipeline-alarm tests passed.

## Hardening directive status

- (i) schema-wide column-type enumeration: implemented in
  `tests/pivot-006-audit.test.mjs` (`actualTypeOids`/`expectedTypeOids` and zero
  unsupported columns), backed by `immutability_041_resolve_type`/`type_supported`.
- (ii) unrepresentable-type decision: explicitly fail-closed in
  `db/postgres/README.md` and the delivery report; no redact-and-warn.
- (iii) pipeline alarm: implemented in the `40-triggers.sql` activation block
  (fingerprint + resolved-base-type checks) and proven by the new-column/new-type
  activation negatives in the focused test.

## Evidence

- `node scripts/check.mjs` → PASS, 165 JavaScript files.
- Focused `node --test tests/pivot-006-audit.test.mjs` → **12/12 pass**.
- PIVOT-005 regression → **18/18 pass**.
- Serial full suite → **308/310 pass**; failures are the known out-of-TOUCH
  PIVOT-004 literal-global-role prerequisite and the unchanged AUTH-004-R1
  fixture-teardown transient under the combined run. No PIVOT-006 focused or PIVOT-005
  test failed.
- Environment: dedicated disposable PostgreSQL 18.6 on loopback `127.0.0.1:55435`,
  `SAVEN_PIVOT_TEST_CLUSTER=1`, local admin `esc`, Node v24.19.0 via
  `npm exec --yes --package=node@24.19.0`. No global `saven_*` role was created; the
  fixture namespaced and removed every object. Cluster stopped after verification.
- AUTH-006 remains required for final application acceptance. Fixture `SET ROLE`/GUCs
  are not verified application provenance. Failed-attempt durability and operational
  reconciliation remain PIVOT-013.

## TOUCH used

`db/postgres/40-triggers.sql`, `db/postgres/migrations/041-audit.sql`,
`db/postgres/README.md`, `tests/pivot-006-audit.test.mjs`,
`tests/helpers/pg-pivot-fixture.mjs` (namespaced audit-definer support only, per the
ENGINEER R1 amendment), the required delivery report and this checkpoint. 040/042
payload bytes, native/reference source, archive, production/server entry points and
PIVOT-004 fixtures/tests are untouched.

## Where I stopped

PIVOT-006 R3 was delivered, pushed and accepted. I have been idle since approximately
02:00 PKT awaiting the verdict and did not start any new work; the ACCEPT arrived at
02:45 PKT but was not relayed until now. No review corrections, vertical slice, contract
work or merge action is in progress.

## Exact next step

1. **Await the dispatcher's post-merge assignment** after a fresh reload: either the next
   vertical slice or the next contract, with its exact worktree and base SHA.
2. Do not start new work, merge PIVOT-006, or reopen the accepted branch without the
   dispatcher's explicit instruction. PIVOT-006 remains a human merge-queue item.
3. PIVOT-006 application acceptance remains gated by AUTH-006; failed-attempt durability
   and operational parity remain separate PIVOT-013/PIVOT-009/010 work.
