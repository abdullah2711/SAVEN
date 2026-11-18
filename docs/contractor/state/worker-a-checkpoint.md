# WORKER-A checkpoint — AUTH-007-R4 delivered, awaiting verdict

Date: 18 November 2026 (Asia/Karachi). Written under the owner standing checkpoint
directive; this file is outside any contract TOUCH.

## Context

- AUTH-006 merged at `0df990a73c883b67e22dbfacfcb4f90162eef910`; AUTH-007 opened from that
  `testing-1` head.
- AUTH-007 branch/worktree: `opencode/auth-007-operator-access` at
  `/home/esc/saven/wt-auth-007`.
- Round just delivered: **AUTH-007-R4**, correcting
  `docs/contractor/reviews/AUTH-007-R3-operator-access.md` at `f1bf221`.

## Exact contract

- Contract: `docs/contractor/contracts/AUTH-007-operator-access.md` — Cloud operator Access
  JWT validation and scoped local subject mapping without local Cloud operator passwords.
- TOUCH: `src/auth/access.mjs`, `src/auth/routes.mjs`, `src/auth/README.md`,
  `db/postgres/06-operator-identity.sql`, `tests/auth-007-access.test.mjs`.
- DONE WHEN: `node scripts/check.mjs && node --test tests/auth-007-access.test.mjs`.
- Implementation commit: `d09018e` (`app: validate operator allocator profile and prove
  post-reconciliation interruption [contract:AUTH-007-R4]`).
- Report + this checkpoint are the next commit; that commit is the pushed head at
  checkpoint time.

## TOUCH used

`db/postgres/06-operator-identity.sql`, `src/auth/README.md`,
`tests/auth-007-access.test.mjs`, delivery report and this checkpoint. No access/routes
delta this round; no other path, applied 033 byte or production credential.

## R4 corrections and status (review `f1bf221`)

1. **HIGH — allocator configuration validation. Closed.** The allocator DO block validates
   the supported profile before mutation: bigint, start 1, increment 1, min 1, max bigint,
   cache 1, no cycle, owner = authority-table owner. It takes the exclusive AUTH-006 gate
   for the installation transaction and documents the installation fence. Negative/cycling/
   cached/altered-bound/start/mis-owned profiles are refused with specific errors and
   unchanged high-water. Floor is numeric with bigint-maximum exhaustion failure before
   `setval`. Supported already-ahead reinstall succeeds.
2. **HIGH — interruption proof reaches the allocator. Closed.** The test splits the real 06
   payload, executes the allocator statement, asserts it ran, then injects failure before
   COMMIT. Disposable fixture sets the allocator behind retained binding evidence; successful
   reapplication advances strictly beyond it, interrupted reapplication advances
   non-transactionally and rollback cannot reduce it. Old session gets
   `OPERATOR_ACCESS_DENIED` after recreation; fresh exchange succeeds. Ahead-of-evidence
   success/interruption cases retained. BigInt comparisons; old live-only reseed is recorded
   as the mutation that would fail the test.

## Evidence recorded with the delivery

- Focused gate: `node scripts/check.mjs && node --test tests/auth-007-access.test.mjs`
  → PASS, 21/21, exit 0, Node v24.19.0, disposable PostgreSQL 18.6 on
  `127.0.0.1:55433` (55432 occupied), auth fixture + AUTH-006 033 + operator 06 applied as
  administrator with namespaced roles, real non-owner auth-service login.
- Regressions: AUTH-002 18/18, AUTH-003 27/27, AUTH-004 21/21, AUTH-005 27/27,
  AUTH-006 27/27.
- Combined serial run (`--test-concurrency=1`): 141 tests, 141 pass, 0 fail.
- R1–R3 MFA/realm, canonical replay, admission order/freshness, mapping generation and
  refresh-flight corrections remain closed.
- Cleanup: disposable cluster stopped and deleted; `node_modules` removed; worktree clean
  at checkpoint time.
- Merge state: AUTH-007 not merged.

## Where I stopped

Last completed step: committed `d09018e`, then the delivery report and this checkpoint.
No further code, tests, merges or new contracts started.

## Exact next step

1. Await the Codex verdict on AUTH-007-R4.
2. On **ACCEPT**: nothing further from me for AUTH-007; it queues for a human Business
   Merge Request (dispatcher issues any merge command separately).
3. On **REVISE within TOUCH**: fetch the rulings branch, apply only scoped corrections,
   re-run focused plus AUTH-002..006, update the report, commit/push on
   `opencode/auth-007-operator-access`, and stop without merging.

Open items/limits: `06-operator-identity.sql` depends on AUTH-006 `033`; allocator
validation/reconciliation is administrator-applied under the exclusive gate and installation
fence, with no rollback promise (profile refusal, non-regression, non-reuse, exact overflow
failure only). This is AUTH-007 allocator evidence, not codebase-wide D-016 or point-in-time
recovery completeness; external retained high-water reconciliation remains a recovery
procedure requirement. Gate is global for authority writes; custom MFA predicate is reviewed
deployment code; captured bearer first-presenter-wins; no live Access policy/DNS/tunnel/
network fetch; operator reads and complete audit remain PIVOT-007/AUTH-009; SQLite remains
production.
