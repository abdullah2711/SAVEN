# WORKER-A checkpoint — AUTH-004-R2 delivered, awaiting verdict

Date: 17 November 2026 (Asia/Karachi). Written under the owner standing checkpoint
directive; this file is outside any contract TOUCH.

## Exact contract

- Contract: `docs/contractor/contracts/AUTH-004-mfa.md` (enforced tenant-admin TOTP,
  recovery codes and factor lifecycle behind the auth adapter).
- Round just delivered: **AUTH-004-R2**, correcting review `AUTH-004-R1-mfa.md` at
  `ef16f72`, which follows the original review `c0540f0`.
- Amended TOUCH at `ef16f72`: `src/auth/factors.mjs`, `src/auth/routes.mjs`,
  `src/auth/session-store.mjs`, `src/auth/README.md`, `tests/auth-004-mfa.test.mjs`,
  plus `tests/auth-002-sessions.test.mjs` **for the affected transaction-phase
  uncertainty case only**. DONE WHEN additionally includes
  `node --test tests/auth-002-sessions.test.mjs`.
- Branch: `opencode/auth-004-mfa` (base `testing-1 @ 34747ee`).
- Implementation commit: `3c693d9` (`app: revalidate lifecycle authority and order
  replacement admission [contract:AUTH-004-R2]`).
- Report + this checkpoint are the next commit; that commit is the pushed head at
  checkpoint time.

## TOUCH used

`src/auth/factors.mjs`, `src/auth/routes.mjs`, `src/auth/README.md`,
`tests/auth-004-mfa.test.mjs`, `tests/auth-002-sessions.test.mjs` (only the
`unknown commit outcomes` test and its in-test `makePool`), delivery report and this
checkpoint. `session-store.mjs` needed no R2 delta. Nothing else changed.

## R2 corrections and status (review `ef16f72`)

1. **HIGH — replacement admission before KDF.** Status: **closed**. Enrolled-factor
   replacement calls `checkLocked` (durable lock check under the `users → two_factor`
   locks) before `policy.verify`/`verifyTotp`/`verifyRecovery`; locked requests start no
   derivation, while wrong-password failure accounting still commits. Instrumented lock
   tests cover correct/wrong password × TOTP/recovery, cross-session bursts and cooldown
   recovery, with observed password-verify count 0 and no factor-derivation start while
   locked.
2. **HIGH — session/principal revalidated inside the owned transaction.** Status:
   **closed**. New `assertMutationAuthority` re-reads the session and joined user after
   the lifecycle locks (no session row lock, no nested checkout) and refuses
   revoked/expired/disabled/epoch-changed/realm-mismatched sessions before
   reauthentication or factor mutation; wired into enroll, enroll/verify, verify and
   disable. Interleaving tests cover revoke/expire/disable/credential-rotation after the
   non-transactional read for initial enrollment and authorized replacement, asserting
   refusal, no KDF and unchanged seed/recovery/assurance/audit; an old-password snapshot
   across a credential change is refused. Replacement completes on a `max:1` pool.
3. **MEDIUM — AUTH-002 uncertainty targets the real phase.** Status: **closed**. Failure
   injection is classified from observed statements/events (`reservation` audit,
   `authority` set_config, `success` session INSERT/success audit) instead of a global
   COMMIT count. Independent reservation, authority and success cases are retained;
   success asserts the session INSERT and success audit were reached before the injected
   COMMIT, credentials are withheld, the client is destroyed and the persisted outcome
   is reported as ambiguous. Logout rollback and raw-token protections untouched.

## Evidence recorded with the delivery

- Focused gate: `node scripts/check.mjs && node --test tests/auth-004-mfa.test.mjs` →
  PASS, 21/21, exit 0, Node v24.19.0, disposable PostgreSQL 18.6 on `127.0.0.1:55432`.
- AUTH-002 suite: 18/18. AUTH-003 regression: 27/27.
- Combined serial run (`--test-concurrency=1`) of AUTH-004 + AUTH-002 + AUTH-003:
  66 tests, 66 pass, 0 fail.
- Honest limit: node's default parallel file concurrency produced one transient
  `terminating connection due to administrator command` fixture-teardown failure in an
  unchanged AUTH-002 case (and once on the new AUTH-004 case on its first run); both
  passed in isolation and in the serial combined run. Stated in the report.
- Cleanup: disposable cluster stopped and deleted; worktree clean at checkpoint time.
- Merge state: AUTH-004 not merged; `testing-1` remains `34747ee`.

## Where I stopped

Last completed step: committed R2 implementation `3c693d9`, then this delivery report and
checkpoint. No further code, tests, merges or new contracts started after that.

## Exact next step

1. Await the Codex verdict on AUTH-004-R2 (expected on
   `origin/codex/pivot-003-rulings`).
2. On **ACCEPT**: nothing further from me for AUTH-004; it queues for a human Business
   Merge Request (dispatcher issues any merge command separately).
3. On **REVISE**: fetch the rulings branch, read the new review in full, apply exactly the
   scoped corrections inside the amended AUTH-004 TOUCH, re-run the focused gate plus
   AUTH-002/AUTH-003, update `docs/contractor/deliveries/AUTH-004-mfa.md`, commit and push
   on `opencode/auth-004-mfa`, and stop without merging.

Open items still needing the engineer (not blocking this checkpoint): deployment
key/config composition via a narrow `server.mjs` contract; reviewed numeric MFA policy
values; AUTH-009 complete failed-attempt audit history; AUTH-006 enforcement of the
pre-MFA assurance decision before business routes.
