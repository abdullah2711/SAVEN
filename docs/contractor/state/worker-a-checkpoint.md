# WORKER-A checkpoint — AUTH-005 delivered, awaiting verdict

Date: 17 November 2026 (Asia/Karachi). Written under the owner standing checkpoint
directive; this file is outside any contract TOUCH.

## Context

- AUTH-004 was human-merged into `testing-1` at merge commit
  `a81ce5903919797c12ae98c96eb4df542179db3e` (pushed `3e9d481..a81ce59`).
- AUTH-005 worktree was created from that SHA: `/home/esc/saven/wt-auth-005`, branch
  `opencode/auth-005-recovery`.

## Exact contract

- Contract: `docs/contractor/contracts/AUTH-005-verification-and-reset.md` — email
  verification and non-enumerating single-use password reset via a controlled mail
  adapter.
- TOUCH: `src/auth/recovery.mjs`, `src/auth/mail.mjs`, `src/auth/routes.mjs`,
  `src/auth/session-store.mjs`, `src/auth/README.md`, `tests/auth-005-recovery.test.mjs`.
- DONE WHEN: `node scripts/check.mjs && node --test tests/auth-005-recovery.test.mjs`.
- Base: `testing-1 @ a81ce59`.
- Implementation commit: `f8d4ca5` (`app: add single-use password reset and email
  verification [contract:AUTH-005]`).
- Report + this checkpoint are the next commit; that commit is the pushed head at
  checkpoint time.

## TOUCH used

`src/auth/recovery.mjs` (new), `src/auth/mail.mjs` (new), `src/auth/routes.mjs`,
`src/auth/README.md`, `tests/auth-005-recovery.test.mjs` (new), delivery report and this
checkpoint. `session-store.mjs` needed no delta: reset uses the existing
`revokeAllSessions` inside the owned transaction. Nothing else changed.

## What was delivered

1. **Challenge store (`recovery.mjs`)** — `auth.verification` rows hold only
   `sha256(token)`, bound to user/email/purpose/expiry; purpose is validated against the
   `token_purpose` reference domain. Consumption locks the row, checks `consumed_at` and
   expiry, then conditionally consumes. Reset consumes, writes the new verifier, advances
   `credential_version` and revokes every live session in one transaction. A token issued
   before a later `password_updated_at` is refused as stale.
2. **Mail adapter (`mail.mjs`)** — no built-in transport; construction requires an injected
   transport and base URL. Composes verification/reset links, never logs, and wraps
   provider failures without the token.
3. **Routes (`routes.mjs`)** — retained `forgot-password` (generic `202`, shared AUTH-003
   throttle); new `/v1/auth/reset-password`, `/v1/auth/email/verification/request`
   (session + CSRF, uses the session's own address) and `/v1/auth/email/verify`. With no
   mail adapter the reset route keeps the AUTH-003 `deferred_to_auth_005` no-delivery
   behaviour; with one, known active accounts get a single-use link and unknown/inactive
   accounts are indistinguishable.
4. **README** — routes, invariants, configuration/limits, extension points, non-claims.

## Evidence recorded with the delivery

- Focused gate: `node scripts/check.mjs && node --test tests/auth-005-recovery.test.mjs`
  → PASS, 11/11, exit 0, Node v24.19.0, disposable PostgreSQL 18.6 on
  `127.0.0.1:55432`.
- Regressions on the same cluster: AUTH-002 18/18, AUTH-003 27/27, AUTH-004 21/21.
- Combined serial run (`--test-concurrency=1`) of AUTH-002..005: 77 tests, 77 pass,
  0 fail.
- Real-role evidence: the full reset lifecycle runs under a namespaced
  `saven_auth_service` login (INHERIT, NOBYPASSRLS) with the production grants.
- Cleanup: disposable cluster stopped and deleted; `node_modules` removed; worktree clean
  at checkpoint time.
- Merge state: AUTH-005 not merged; `testing-1` remains `a81ce59`.

## Where I stopped

Last completed step: committed `f8d4ca5`, then the delivery report and this checkpoint.
No further code, tests, merges or new contracts started after that.

## Exact next step

1. Await the Codex verdict on AUTH-005 (expected on
   `origin/codex/pivot-003-rulings`).
2. On **ACCEPT**: nothing further from me for AUTH-005; it queues for a human Business
   Merge Request (dispatcher issues any merge command separately).
3. On **REVISE**: fetch the rulings branch, read the new review in full, apply exactly the
   scoped corrections inside the AUTH-005 TOUCH, re-run the focused gate plus
   AUTH-002/003/004, update `docs/contractor/deliveries/AUTH-005-recovery.md`, commit and
   push on `opencode/auth-005-recovery`, and stop without merging.

Open items still needing the engineer (not blocking this checkpoint): inject the reviewed
mail transport/base URL through a narrow composition contract; approve production TTLs;
AUTH-009 email-verification audit event and complete failure history; AUTH-006 business
assurance enforcement.
