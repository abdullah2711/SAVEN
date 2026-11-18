# WORKER-A checkpoint — AUTH-007-R3 delivered, awaiting verdict

Date: 18 November 2026 (Asia/Karachi). Written under the owner standing checkpoint
directive; this file is outside any contract TOUCH.

## Context

- AUTH-006 merged at `0df990a73c883b67e22dbfacfcb4f90162eef910`; AUTH-007 opened from that
  `testing-1` head.
- AUTH-007 branch/worktree: `opencode/auth-007-operator-access` at
  `/home/esc/saven/wt-auth-007`.
- Round just delivered: **AUTH-007-R3**, correcting
  `docs/contractor/reviews/AUTH-007-R2-operator-access.md` at `66aba74`.

## Exact contract

- Contract: `docs/contractor/contracts/AUTH-007-operator-access.md` — Cloud operator Access
  JWT validation and scoped local subject mapping without local Cloud operator passwords.
- TOUCH: `src/auth/access.mjs`, `src/auth/routes.mjs`, `src/auth/README.md`,
  `db/postgres/06-operator-identity.sql`, `tests/auth-007-access.test.mjs`.
- DONE WHEN: `node scripts/check.mjs && node --test tests/auth-007-access.test.mjs`.
- Implementation commit: `2821117` (`app: make operator mapping allocator advance-only on
  reapplication [contract:AUTH-007-R3]`).
- Report + this checkpoint are the next commit; that commit is the pushed head at
  checkpoint time.

## TOUCH used

`db/postgres/06-operator-identity.sql`, `src/auth/README.md`,
`tests/auth-007-access.test.mjs`, delivery report and this checkpoint. No access/routes
delta this round; no other path, applied 033 byte or production credential.

## R3 correction and status (review `66aba74`)

**HIGH — allocator reapplication/interruption must never reseed issued generations.
Closed.**

- 06 reconciliation is advance-only: floor = `GREATEST(max(live mapping generation),
  max(generation retained in session bindings)) + 1`; the sequence's current
  `last_value/is_called` is consulted, and `setval` runs only when the next value is below
  the floor. Deleted mappings retained by bindings still protect their generation.
- `setval` is non-transactional, so every adjustment moves forward only; a failed or
  interrupted install can leave the allocator advanced, never regressed.
- 06 is idempotent for its own objects (`CREATE OR REPLACE FUNCTION`, guarded trigger
  drop/recreate, `IF NOT EXISTS` tables/sequence/index, guarded column/default), so
  reapplication reaches and completes the allocator reconciliation rather than failing
  after it.
- Tests: install, issue generation, delete mapping (binding retains generation), reapply 06
  → allocator next does not regress and remains above the issued value; recreated mapping
  gets a fresh generation; old session denied; fresh exchange succeeds. Interrupted
  statement-by-statement reapplication after reconciliation + rollback → allocator never
  regresses and the issued generation cannot be reused; recovery uses a fresh generation.

## Evidence recorded with the delivery

- Focused gate: `node scripts/check.mjs && node --test tests/auth-007-access.test.mjs`
  → PASS, 20/20, exit 0, Node v24.19.0, disposable PostgreSQL 18.6 on
  `127.0.0.1:55433` (55432 occupied), auth fixture + AUTH-006 033 + operator 06 applied as
  administrator with namespaced roles, real non-owner auth-service login.
- Regressions: AUTH-002 18/18, AUTH-003 27/27, AUTH-004 21/21, AUTH-005 27/27,
  AUTH-006 27/27.
- Combined serial run (`--test-concurrency=1`): 140 tests, 140 pass, 0 fail.
- R1/R2 MFA/realm, canonical replay, lock order, mapping binding and refresh corrections
  remain closed.
- Cleanup: disposable cluster stopped and deleted; `node_modules` removed; worktree clean
  at checkpoint time.
- Merge state: AUTH-007 not merged.

## Where I stopped

Last completed step: committed `2821117`, then the delivery report and this checkpoint.
No further code, tests, merges or new contracts started.

## Exact next step

1. Await the Codex verdict on AUTH-007-R3.
2. On **ACCEPT**: nothing further from me for AUTH-007; it queues for a human Business
   Merge Request (dispatcher issues any merge command separately).
3. On **REVISE within TOUCH**: fetch the rulings branch, apply only scoped corrections,
   re-run focused plus AUTH-002..006, update the report, commit/push on
   `opencode/auth-007-operator-access`, and stop without merging.

Open items/limits: `06-operator-identity.sql` depends on AUTH-006 `033`; allocator
reconciliation is administrator-applied and advance-only (no rollback promise, only
non-regression); gate global for authority writes; custom MFA predicate is reviewed
deployment code; captured bearer first-presenter-wins; no live Access policy/DNS/tunnel/
network fetch; operator reads and complete audit remain PIVOT-007/AUTH-009; SQLite remains
production.
