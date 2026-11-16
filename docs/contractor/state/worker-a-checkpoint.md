# WORKER-A checkpoint — AUTH-004-R1 delivered, awaiting verdict

Date: 17 November 2026 (Asia/Karachi). Written under the owner standing checkpoint
directive; this file is outside any contract TOUCH.

## Exact contract

- Contract: `docs/contractor/contracts/AUTH-004-mfa.md` (enforced tenant-admin TOTP,
  recovery codes and factor lifecycle behind the auth adapter).
- Round just delivered: **AUTH-004-R1**, correcting review `c0540f0`.
- Branch: `opencode/auth-004-mfa` (base `testing-1 @ 34747ee0a8af604c01297eb471fdc5c3c2e68c7`).
- Implementation commit: `4db4f0a` (`app: authorize factor replacement, bind authority
  and serialize lifecycle [contract:AUTH-004-R1]`).
- Report commit: `3c81ad2` (`docs: record AUTH-004-R1 correction evidence`), which is the
  current pushed head at checkpoint time.
- TOUCH used: `src/auth/factors.mjs`, `src/auth/routes.mjs`, `src/auth/session-store.mjs`,
  `src/auth/README.md`, `tests/auth-004-mfa.test.mjs`, delivery report. Nothing else.

## Codex review findings being fixed (review `c0540f0`) and status

1. **CRITICAL — password-only enrollment replaced a verified factor.** Status: **closed**.
   Initial enrollment only without a verified factor; replacement requires password plus
   a current TOTP/recovery proof in the same transaction; proven by a password-only
   pending session receiving `403 MFA_REAUTH_REQUIRED` with seed/verification/recovery
   state unchanged, plus authorized-replacement success and lifecycle audit stages.
2. **CRITICAL — authority lookup ignored forced membership RLS context.** Status:
   **closed**. `authority()` binds the verified user to transaction-local
   `app.current_user_id` inside an owned transaction and returns explicit
   `resolved:true|false`; unresolved fails closed. Proven with a real non-owner
   auth-service login against the accepted PIVOT-004/031/032 stack (admin, ordinary
   member, promotion, revocation, malformed/unavailable authority, size-one pooled reuse).
3. **HIGH — lifecycle changes did not invalidate assurance across sessions / races.**
   Status: **closed**. Deterministic `users → two_factor → sessions` lock order;
   replacement and disable downgrade all live sessions; pending now also requires a
   verified factor; two-session disable race, stale TOTP/recovery after disable, stale
   seed after replacement covered.
4. **HIGH — retry accounting bypassable on enrollment/recovery and under concurrency.**
   Status: **closed**. Every relevant endpoint checks the lock and increments
   `failed_attempts` atomically, committed even on refusal; restart preserves lock and
   counters; disable-password failures counted; cross-session bursts bounded with exact
   durable counts; cooldown recovery tested.
5. **HIGH — disable recreated a nested pool checkout.** Status: **closed**. MFA mutation
   sessions are read without row locks; reauthentication and lifecycle writes run on the
   owned transaction; restricted auth-service `max:1` disable bounded to 15 s, concurrent
   disables serialized.
6. **MEDIUM — crypto configuration lacked entropy/version validation.** Status:
   **closed**. `secretBytes` 20–64 and `recoveryCodeBytes` 10–32 enforced; duplicate key
   versions and missing active recovery version rejected; truthful `hash_key_version`
   with retained-version verification; RFC 6238 appendix B vectors covered.

## Evidence recorded with the delivery

- Focused gate: `node scripts/check.mjs && node --test tests/auth-004-mfa.test.mjs` →
  PASS, 18/18, exit 0, node v24.19.0, disposable PostgreSQL 18.6.
- Regressions: AUTH-002 18/18, AUTH-003 27/27.
- Combined branch suite: 250 tests, 249 pass, 1 fail — only the pre-existing PIVOT-004
  fixture prerequisite (`role "saven_customer_app" does not exist`), untouched/out of
  scope. One earlier combined run showed a transient "asynchronous activity after the
  test ended" teardown error in an AUTH-003 case; not reproduced in two later runs; stated
  in the report.
- Cleanup: disposable cluster stopped and deleted (including residue from interrupted
  runs), `node_modules` symlink removed, worktree clean at checkpoint time.
- Merge state: AUTH-004 not merged; `testing-1` remains `34747ee`, `main` `b9bdf75`.

## Where I stopped

Last completed step: pushed `3c81ad2` (AUTH-004-R1 implementation `4db4f0a` plus delivery
report) to `origin/opencode/auth-004-mfa`. No further code, tests, merges or new contracts
started after that push.

## Exact next step

1. Await the Codex verdict on AUTH-004-R1 (expected on `origin/codex/pivot-003-rulings`).
2. On **ACCEPT**: nothing further from me for AUTH-004; it queues for a human Business
   Merge Request (dispatcher will issue any merge command separately).
3. On **REVISE**: fetch the rulings branch, read the new review in full, apply exactly the
   scoped corrections inside the amended AUTH-004 TOUCH, re-run the focused gate plus
   AUTH-002/003 regressions, update `docs/contractor/deliveries/AUTH-004-mfa.md`, commit and
   push on `opencode/auth-004-mfa`, and stop without merging.

Open items still needing the engineer (not blocking the checkpoint): deployment key/config
composition via a narrow `server.mjs` contract; reviewed numeric MFA policy values;
AUTH-009 complete failed-attempt audit history; AUTH-006 enforcement of the pre-MFA
assurance decision before business routes.
