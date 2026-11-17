# WORKER-B checkpoint — PIVOT-005 complete and merged

Date: 17 November 2026 (Asia/Karachi). Written under the owner standing checkpoint
directive; this file is outside any contract TOUCH.

## Merge state

- Human Business Merge Request authorized; Codex **ACCEPT** at `d9e2bb1` for
  PIVOT-005-R5 (review `docs/contractor/reviews/PIVOT-005-R4-posted-immutability.md`).
- Source branch: `opencode/pivot-005-immutability` at
  `dc32978614999cea9c037cb03966bc294aed2490` (R5 correction).
- Target branch: `testing-1`; pre-merge head `1b9ff78`.
- Merge command: `git merge --no-ff origin/opencode/pivot-005-immutability`.
- **Merge commit: `32fef2beac91a73b2c8a5ae9c150603736993e97`.**
- Pushed `testing-1` to `origin` (`1b9ff78..32fef2b`); no main, no force, no other
  branch changed.
- This checkpoint is a follow-up documentation commit on `testing-1`; the merge SHA
  above remains the PIVOT-005 integration commit.

## Contract and delivery

- Contract: `docs/contractor/contracts/PIVOT-005-posted-immutability.md`.
- Implementation: `db/postgres/migrations/040-posted-immutability.sql`,
  `db/postgres/migrations/042-entry-voiding.sql`, `db/postgres/40-triggers.sql`,
  `db/postgres/README.md`.
- Tests: `tests/pivot-005-immutability.test.mjs` and the disclosed namespaced
  `saven_void_definer` support in `tests/helpers/pg-pivot-fixture.mjs`.
- Delivery report: `docs/contractor/deliveries/PIVOT-005-posted-immutability.md`
  (Revision 5; R1–R4 history retained and marked where superseded).
- Reference registration: `VOIDED`, `accounting.entry.void` and
  `accounting.voided_entries.read` in `contracts/postgres-business-rules-v1.json`.
- The 14 November owner direction remains binding: D-013 terminal void, D-014
  role-agnostic database reads, retained source bytes/numbers/evidence/audit, and no
  application UI/RBAC claim from this database contract.

## Review corrections closed

1. **Posted-only active inclusion, role-agnostic projections, atomic activation** —
   `active_general_ledger` requires the accepted command `POSTED` and no void record;
   040/042 guards are attached and validated by the dispatcher before the runtime
   interface is granted.
2. **Canonical authority and approval binding** — actor-bound approval transition;
   direct `APPROVED` inserts, requester-stamped deciders and decider changes refused;
   exact submission and canonical decision bound; independent approver revalidated at
   execution.
3. **Approver resource/amount completeness** — `immutability_040_approval_resource`
   resolves company/branch/accounts/minor amount from the void target, command journal
   or immutable accepted payload; no action-only fallback; one role must satisfy
   `journal.approve`, company, branch, every account and `maxMinor`; rechecked at
   execution.
4. **Policy identity semantics** — current version resolved within each
   `(policy_key, role scope)` identity first; role-specific/global precedence applied;
   every applicable current identity combined conservatively; cross-key version numbers
   never priority; all selected identities/versions/scopes bound into the snapshot;
   same-key supersession and stale-on-authority/policy-change retained.
5. **Both-ended correction protection** — original and reversal locked in deterministic
   order; original posted/non-voided; reversal non-final/non-voided; deferred commit
   check; late links to posted/voided reversals refused; neither linked end plain-voided.
6. **Fail-closed unsupported posting** — plain balanced journal is the supported
   PostgreSQL posting boundary; trade/stock shapes are refused before `POSTED`; retained
   operational dependencies are refused by the void primitive. This is an explicit
   PIVOT-013 limit, not operational parity.
7. **Restored regression evidence** — runtime posting, atomic effect rollback, exact
   receipt/audit/outbox retention, role-agnostic reads, tenant/context negatives,
   permissive widening, denial actor binding, correction/void races, same-key idempotency
   conflict, operational dependency refusal, interrupted/repeated activation, immutable
   payload re-application and five polluted-owner classes.

## Evidence recorded at delivery and merge verification

- Focused gate on the delivery branch: `node scripts/check.mjs` PASS;
  `node --test tests/pivot-005-immutability.test.mjs` → **18/18 pass**, exit 0.
- Merge verification on `testing-1` at `32fef2b`: `node scripts/check.mjs` PASS
  (164 JavaScript files); same focused PIVOT-005 file → **18/18 pass**.
- Full integration suite on `testing-1` at `32fef2b`: 298 tests, 296 pass, 2 fail:
  - `PIVOT-004 resists an extra permissive policy and an attacker permissive policy on auth`
    — the known out-of-TOUCH test that creates a policy with the literal global role
    `saven_customer_app` on a namespaced pristine cluster.
  - `AUTH-004-R2 locked replacement refuses before any password or factor derivation`
    — known fixture-teardown transient (`terminating connection due to administrator
    command`) under parallel load; a focused rerun of that test passed 1/1 immediately
    afterward.
  - Neither failure is in PIVOT-005 TOUCH; no PIVOT-004/AUTH-004 source or test was
    changed by this contract.
- Environment: dedicated disposable PostgreSQL 18.6 cluster on loopback
  `127.0.0.1:55435`, `SAVEN_PIVOT_TEST_CLUSTER=1`, local admin `esc`, Node v24.19.0 via
  `npm exec --yes --package=node@24.19.0`. No global `saven_*` roles were created; the
  fixture namespaced and removed its objects. Cluster stopped after verification.
- No application route/page/RBAC, AUTH-006 provenance, PIVOT-013 operational
  reconciliation, PIVOT-006 audit payload 041, Private packaging or production cutover
  is delivered or claimed.

## TOUCH used

`db/postgres/40-triggers.sql`, `db/postgres/migrations/040-posted-immutability.sql`,
`db/postgres/migrations/042-entry-voiding.sql`, `db/postgres/README.md`,
`tests/pivot-005-immutability.test.mjs`, the disclosed minimal
`tests/helpers/pg-pivot-fixture.mjs` namespaced-owner support,
`contracts/postgres-business-rules-v1.json` (VOIDED and void/read registration only),
the delivery report and this checkpoint. No native/application, accepted reference
schema, archive, production/server entry point or PIVOT-004 fixture repair was changed.

## Where I stopped

Last completed step: human-authorized merge of PIVOT-005 into `testing-1` at
`32fef2b`, push to `origin/testing-1`, merge verification and this checkpoint. No
PIVOT-006 (audit triggers) work, worktree creation, contract start, code change or test
authoring has begun.

## Exact next step

1. Await the dispatcher relay with the **exact PIVOT-006 assignment, worktree and base
   SHA**. Do not start PIVOT-006 before that relay.
2. On relay: fetch `origin`, read the PIVOT-006 contract and the latest review in full,
   confirm the assigned worktree is at the stated base SHA, and stay inside the PIVOT-006
   TOUCH.
3. PIVOT-006 must add immutable audit payload **041** and register it alongside 040/042
   in `40-triggers.sql`; it must not edit applied 040/042 bytes or load only the newest
   payload.
4. Run the contract gate, update the delivery report/BUILD_STATE as assigned, commit and
   push on the assigned branch only; do not merge (a human Business Merge Request is
   required for a database/auth/accounting ACCEPT).
