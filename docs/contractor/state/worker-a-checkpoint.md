# WORKER-A checkpoint — AUTH-007-R2 delivered, awaiting verdict

Date: 18 November 2026 (Asia/Karachi). Written under the owner standing checkpoint
directive; this file is outside any contract TOUCH.

## Context

- AUTH-006 merged at `0df990a73c883b67e22dbfacfcb4f90162eef910`; AUTH-007 opened from that
  `testing-1` head.
- AUTH-007 branch/worktree: `opencode/auth-007-operator-access` at
  `/home/esc/saven/wt-auth-007`.

## Exact contract

- Contract: `docs/contractor/contracts/AUTH-007-operator-access.md` — Cloud operator Access
  JWT validation and scoped local subject mapping without local Cloud operator passwords.
- TOUCH: `src/auth/access.mjs`, `src/auth/routes.mjs`, `src/auth/README.md`,
  `db/postgres/06-operator-identity.sql`, `tests/auth-007-access.test.mjs`.
- DONE WHEN: `node scripts/check.mjs && node --test tests/auth-007-access.test.mjs`.
- Round just delivered: **AUTH-007-R2**, correcting
  `docs/contractor/reviews/AUTH-007-R1-operator-access.md` at `828401b`.
- Implementation commit: `9208e60` (`app: follow admission lock order and non-reusable
  mapping generations [contract:AUTH-007-R2]`).
- Report + this checkpoint are the next commit; that commit is the pushed head at
  checkpoint time.

## TOUCH used

`src/auth/access.mjs`, `src/auth/README.md`, `db/postgres/06-operator-identity.sql`,
`tests/auth-007-access.test.mjs`, delivery report and this checkpoint. No routes delta this
round; no other path, native source, applied 033 byte or production credential.

## R2 corrections and status (review `828401b`)

1. **HIGH — accepted lock order and fresh authority after waits. Closed.**
   `admitSession` resolves identity from the pre-read session, takes the shared gate, locks
   `auth.users` first, then re-reads the exact session under lock and revalidates
   revocation, local expiries, status and credential generation. Trusted time is sampled
   after the user/session locks; source expiry, mapping/role windows, assurance and
   configured source age are checked with that time. Tests: admission-first credential
   update blocks while admission holds the principal lock and applies afterwards;
   invalidation-first revocation refuses; user-lock and session-lock waits with source
   expiry advanced during the wait both refuse; clean next-request denial.
2. **HIGH — mapping incarnation cannot be reused. Closed.**
   `operator.access_identity` now takes a non-reusable sequence generation on every INSERT
   and UPDATE; bindings store it with `generation-v1`; legacy/null scheme fails closed.
   Delete/recreate and reassignment-return tests show old sessions denied, fresh exchange
   succeeds, unrelated subjects isolated. Installed-lineage upgrade adds the sequence
   default and nullable scheme column.
3. **MEDIUM — synchronous refresh cannot poison single-flight. Closed.**
   Flight state is published before the callback and cleared after settlement; sync throw,
   rejection and normal return are safe. Non-async throw-once test with injected clock:
   first attempt refuses, immediate retry respects cooldown, later retry invokes the source
   and succeeds; cached/coalesced behavior retained.

## Evidence recorded with the delivery

- Focused gate: `node scripts/check.mjs && node --test tests/auth-007-access.test.mjs`
  → PASS, 19/19, exit 0, Node v24.19.0, disposable PostgreSQL 18.6 on
  `127.0.0.1:55433` (55432 occupied), auth fixture + AUTH-006 033 + operator 06 applied as
  administrator with namespaced roles, real non-owner auth-service login.
- Regressions: AUTH-002 18/18, AUTH-003 27/27, AUTH-004 21/21, AUTH-005 27/27,
  AUTH-006 27/27.
- Combined serial run (`--test-concurrency=1`): 139 tests, 139 pass, 0 fail.
- One combined attempt hit the known disposable-fixture teardown transient in an unchanged
  AUTH-004 case; immediate serial rerun was 139/139.
- Cleanup: disposable cluster stopped and deleted; `node_modules` removed; worktree clean
  at checkpoint time.
- Merge state: AUTH-007 not merged.

## Where I stopped

Last completed step: committed `9208e60`, then the delivery report and this checkpoint.
No further code, tests, merges or new contracts started.

## Exact next step

1. Await the Codex verdict on AUTH-007-R2.
2. On **ACCEPT**: nothing further from me for AUTH-007; it queues for a human Business
   Merge Request (dispatcher issues any merge command separately).
3. On **REVISE within TOUCH**: fetch the rulings branch, apply only scoped corrections,
   re-run focused plus AUTH-002..006, update the report, commit/push on
   `opencode/auth-007-operator-access`, and stop without merging.

Open items/limits: `06-operator-identity.sql` depends on AUTH-006 `033`; gate is global for
authority writes (no throughput/SLA claim); custom MFA predicate is reviewed deployment code;
captured bearer exchange is first-presenter-wins; no live Access policy/DNS/tunnel/network
fetch; operator reads and complete audit remain PIVOT-007/AUTH-009; some pre-exchange guard
failures are not audited; SQLite remains production.
