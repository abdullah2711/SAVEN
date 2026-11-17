# WORKER-A checkpoint — AUTH-005-R2 delivered, awaiting verdict

Date: 17 November 2026 (Asia/Karachi). Written under the owner standing checkpoint
directive; this file is outside any contract TOUCH.

## Context

- AUTH-004 was human-merged into `testing-1` at merge commit
  `a81ce5903919797c12ae98c96eb4df542179db3e`.
- AUTH-005 branch/worktree: `opencode/auth-005-recovery` at
  `/home/esc/saven/wt-auth-005`, based on `a81ce59`.

## Exact contract

- Contract: `docs/contractor/contracts/AUTH-005-verification-and-reset.md` — email
  verification and non-enumerating single-use password reset via a controlled mail
  adapter.
- Round just delivered: **AUTH-005-R2**, correcting review
  `docs/contractor/reviews/AUTH-005-recovery.md` at `700a4d2`.
- TOUCH: `src/auth/recovery.mjs`, `src/auth/mail.mjs`, `src/auth/routes.mjs`,
  `src/auth/session-store.mjs`, `src/auth/README.md`, `tests/auth-005-recovery.test.mjs`.
- DONE WHEN: `node scripts/check.mjs && node --test tests/auth-005-recovery.test.mjs`.
- Implementation commit: `d088f47` (`app: bind recovery to address and credential
  generation [contract:AUTH-005-R2]`).
- Report + this checkpoint are the next commit; that commit is the pushed head at
  checkpoint time.

## TOUCH used

`src/auth/recovery.mjs`, `src/auth/mail.mjs`, `src/auth/routes.mjs`, `src/auth/README.md`,
`tests/auth-005-recovery.test.mjs`, delivery report and this checkpoint.
`session-store.mjs` still needed no delta. Nothing else changed.

## R2 corrections and status (review `700a4d2`)

1. **HIGH — immutable address binding + transactional request authority. Closed.**
   Issuance locks the account and resolves the current active email on the owned
   transaction. Verification/reset consume compare the challenge identifier with the
   locked current normalized email. `emailVerificationRequest` runs AUTH-004
   `assertMutationAuthority` inside the issuance transaction (revocation/expiry/status/
   epoch). Tests cover old-address verification/reset, current-address issuance, and
   read-valid-then-stale revoke/expire/disable/credential request probes.
2. **HIGH — generation-bound stale reset. Closed.** Reset tokens are
   `<random>.<credential-generation>`; the generation is digest-covered and rechecked
   under the principal lock. Purpose validity is rechecked at consumption. Tests cover
   older-start/later-commit, two-links-one-generation, reset-vs-credential-change race,
   audit/revocation rollback, unknown COMMIT, and zero-KDF stale refusal.
3. **HIGH — max=1 deadlock. Closed.** Forgot-password lookup runs on the limiter lease
   (`loadUserByEmail(lease, email)`), challenge insert on `lease.transaction`; no nested
   checkout. Real-role `max:1` known/unknown and `max:2` concurrent tests pass without
   raising pool size.
4. **MEDIUM — non-enumerating response boundary. Closed.** Bounded, drainable
   `createMailDispatcher` decouples provider latency from the response/lease; failures
   count and invalidate via callback. Slow/blocked transport tests return 202 before
   delivery; cleanup-failure residual boundary is tested and reported honestly.
5. **MEDIUM — verification admission. Closed.** Durable challenge-row budget with
   purpose/account/network scoping, transaction advisory locks, `429 MAIL_THROTTLED` and
   no challenge/mail on denial. Repeated, concurrent, cooldown and store-failure tests.

## Evidence recorded with the delivery

- Focused gate: `node scripts/check.mjs && node --test tests/auth-005-recovery.test.mjs`
  → PASS, 27/27, exit 0, Node v24.19.0, disposable PostgreSQL 18.6 on
  `127.0.0.1:55432`.
- Regressions: AUTH-002 18/18, AUTH-003 27/27, AUTH-004 21/21.
- Combined serial run (`--test-concurrency=1`): 93 tests, 93 pass, 0 fail.
- Honest limit: one combined attempt hit the known fixture-teardown transient
  (`terminating connection due to administrator command`) in an unchanged AUTH-004 case;
  the immediate serial rerun was 93/93.
- Cleanup: disposable cluster stopped and deleted; `node_modules` removed; worktree clean
  at checkpoint time.
- Merge state: AUTH-005 not merged; `testing-1` remains `a81ce59`.

## Where I stopped

Last completed step: committed `d088f47`, then the delivery report and this checkpoint.
No further code, tests, merges or new contracts started after that.

## Exact next step

1. Await the Codex verdict on AUTH-005-R2 (expected on
   `origin/codex/pivot-003-rulings`).
2. On **ACCEPT**: nothing further from me for AUTH-005; it queues for a human Business
   Merge Request (dispatcher issues any merge command separately).
3. On **REVISE**: fetch the rulings branch, read the new review in full, apply exactly the
   scoped corrections inside the AUTH-005 TOUCH, re-run the focused gate plus
   AUTH-002/003/004, update `docs/contractor/deliveries/AUTH-005-recovery.md`, commit and
   push on `opencode/auth-005-recovery`, and stop without merging.

Open items still needing the engineer (not blocking this checkpoint): inject the reviewed
mail transport/base URL and own dispatcher shutdown; approve production TTL/admission
values; AUTH-009 email-verification audit vocabulary and complete failure history;
AUTH-006 business assurance enforcement. Undelivered-challenge cleanup is best effort; a
failed invalidation can leave a token live until expiry.
