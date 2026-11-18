# WORKER-A checkpoint — AUTH-007-R5 delivered, awaiting verdict

Date: 18 November 2026 (Asia/Karachi). Written under the owner standing checkpoint
directive; this file is outside any contract TOUCH.

## Context

- AUTH-006 merged at `0df990a73c883b67e22dbfacfcb4f90162eef910`; AUTH-007 opened from that
  `testing-1` head.
- AUTH-007 branch/worktree: `opencode/auth-007-operator-access` at
  `/home/esc/saven/wt-auth-007`.
- Round just delivered: **AUTH-007-R5**, correcting
  `docs/contractor/reviews/AUTH-007-R4-operator-access.md` at `6924727`.

## Exact contract

- Contract: `docs/contractor/contracts/AUTH-007-operator-access.md` — Cloud operator Access
  JWT validation and scoped local subject mapping without local Cloud operator passwords.
- TOUCH: `src/auth/access.mjs`, `src/auth/routes.mjs`, `src/auth/README.md`,
  `db/postgres/06-operator-identity.sql`, `tests/auth-007-access.test.mjs`.
- DONE WHEN: `node scripts/check.mjs && node --test tests/auth-007-access.test.mjs`.
- Implementation commit: `cfc54ac` (`app: take installer authority gate before DDL and prove
  allocator mutation [contract:AUTH-007-R5]`).
- Report + this checkpoint are the next commit; that commit is the pushed head at
  checkpoint time.

## TOUCH used

`db/postgres/06-operator-identity.sql`, `src/auth/README.md`,
`tests/auth-007-access.test.mjs`, delivery report and this checkpoint. No access/routes
delta this round; no other path, applied 033 byte or production credential.

## R5 corrections and status (review `6924727`)

1. **HIGH — installer gate before table DDL. Closed.** 06 now takes the exclusive AUTH-006
   authority gate immediately after `SET LOCAL ROLE`, before any table/sequence DDL, and
   holds it to COMMIT. The allocator block no longer acquires it after table alterations.
   A deadlock-triangle test pauses admission before its binding/mapping SELECT (holding the
   shared gate and principal/session locks), starts reapplication, proves reapplication
   waits at the gate before DDL, resumes admission to completion, then completes
   reapplication — no participant abort, allocator not regressed, operator session usable.
2. **MEDIUM — regression evidence completed and claims corrected. Closed.**
   - Interrupted already-ahead case added: allocator executes, no advance needed, rollback
     leaves it ahead.
   - Binding-only interrupted case retained and reaches the allocator.
   - Old-credential assertions now run after mapping recreation and assert
     `OPERATOR_ACCESS_DENIED` (generation mismatch), not only while mapping is absent.
   - True mutation proof performed and documented: live-only floor mutation makes the
     focused reapplication test fail on “binding-only reconciliation advances strictly
     beyond issued evidence”; restoring the binding-aware floor makes it pass. Mutation not
     committed.
   - Delivery claims distinguish executed allocator statements from the earlier
     pre-allocator injection.

## Evidence recorded with the delivery

- Focused gate: `node scripts/check.mjs && node --test tests/auth-007-access.test.mjs`
  → PASS, 22/22, exit 0, Node v24.19.0, disposable PostgreSQL 18.6 on
  `127.0.0.1:55433` (55432 occupied), auth fixture + AUTH-006 033 + operator 06 applied as
  administrator with namespaced roles, real non-owner auth-service login.
- Regressions: AUTH-002 18/18, AUTH-003 27/27, AUTH-004 21/21, AUTH-005 27/27,
  AUTH-006 27/27.
- Combined serial run (`--test-concurrency=1`): 142 tests, 142 pass, 0 fail.
- Mutation proof: live-only floor → focused reapplication test fails at the binding-only
  assertion; restored binding-aware floor → 1/1 pass. Mutation not committed.
- Cleanup: disposable cluster stopped and deleted; `node_modules` removed; worktree clean
  at checkpoint time.
- Merge state: AUTH-007 not merged.

## Where I stopped

Last completed step: committed `cfc54ac`, then the delivery report and this checkpoint.
No further code, tests, merges or new contracts started.

## Exact next step

1. Await the Codex verdict on AUTH-007-R5.
2. On **ACCEPT**: nothing further from me for AUTH-007; it queues for a human Business
   Merge Request (dispatcher issues any merge command separately).
3. On **REVISE within TOUCH**: fetch the rulings branch, apply only scoped corrections,
   re-run focused plus AUTH-002..006, update the report, commit/push on
   `opencode/auth-007-operator-access`, and stop without merging.

Open items/limits: `06-operator-identity.sql` depends on AUTH-006 `033`; installation must
run with no external allocator writer; allocator is advance-only with profile refusal,
non-regression, non-reuse and exact overflow failure, no sequence rollback promise. This is
AUTH-007 allocator evidence, not codebase-wide D016 or PITR completeness. Earlier MFA/realm,
canonical replay, admission order/freshness, mapping generation and refresh-flight
corrections remain closed. No live Access policy/DNS/tunnel/network fetch; operator reads and
complete audit remain PIVOT-007/AUTH-009; SQLite remains production.
