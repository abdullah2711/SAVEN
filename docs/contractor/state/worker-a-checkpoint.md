# WORKER-A checkpoint — AUTH-006-R1 delivered, awaiting verdict

Date: 17 November 2026 (Asia/Karachi). Written under the owner standing checkpoint
directive; this file is outside any contract TOUCH.

## Context

- AUTH-005-R2 was human-merged into `testing-1` at
  `1b9ff78a1a29b994a6d77389b035f6b8cd692e76` (previous round).
- AUTH-006 branch/worktree: `opencode/auth-006-context` at
  `/home/esc/saven/wt-auth-006`, based on `1b9ff78`.

## Exact contract

- Contract: `docs/contractor/contracts/AUTH-006-tenant-context.md` — bind verified
  selected membership to every PG business transaction on one checked-out client.
- Round just delivered: **AUTH-006-R1**, correcting review
  `docs/contractor/reviews/AUTH-006-tenant-context.md` at `dc183a2`.
- TOUCH: `src/db/tenant-context.mjs`, `src/db/README.md`,
  `src/auth/tenant-selection.mjs`, `src/auth/routes.mjs`,
  `src/auth/session-store.mjs`, `src/auth/README.md`,
  `tests/auth-006-context.test.mjs`.
- DONE WHEN: `node scripts/check.mjs && node --test tests/auth-006-context.test.mjs`.
- Implementation commit: `e5eb06e` (`app: make tenant admission authoritative with MFA and
  held locks [contract:AUTH-006-R1]`).
- Report + this checkpoint are the next commit; that commit is the pushed head at
  checkpoint time.

## TOUCH used

`src/auth/tenant-selection.mjs`, `src/db/tenant-context.mjs`, `src/auth/session-store.mjs`,
`src/auth/README.md`, `src/db/README.md`, `tests/auth-006-context.test.mjs`, delivery
report and this checkpoint. `src/auth/routes.mjs` needed no R1 delta. Nothing else changed;
no schema/migration/grant/dependency/entry point.

## R1 corrections and status (review `dc183a2`)

1. **HIGH — authoritative admission boundary. Closed within current RLS/role limits,
   amendment requested.** `withAuthority` opens one auth transaction, row-locks
   users -> two_factor -> sessions, validates customer realm/principal/credential
   generation/session/selected membership+tenant+epoch, and keeps locks open while the
   business transaction runs. Revocation/rotation/credential reset/factor changes block or
   fail closed. Membership/role/epoch authority is re-read at admission. Pause tests cover
   blocked revoke/credential/clear, membership-epoch change winning, expiry, factor
   disable, and BEGIN/rollback/lost-ack uncertainty. **Amendment dependency:** membership
   rows cannot be row-locked under the accepted SELECT-only RLS; a narrowly reviewed
   definer lock/validation interface is requested before full membership serialization.
   Until then a change committing after the admission re-read and during handler execution
   is caught by the next request. Documented in both READMEs and the report.
2. **CRITICAL — realm + MFA admission. Closed.** `readSessionById` filters customer realm
   and exposes `mfa_verified_at`. Requirements derive from active/effective roles with
   `requires_mfa`; admission requires a verified factor + `mfa_verified` session assurance;
   unresolved authority returns 503. Applied inside list/select/clear/withAuthority, not
   only routes. Tests: pending/enrollment-only admin, verified admin positive, promotion,
   factor disable, assurance downgrade, operator realm, unresolved authority.
3. **MEDIUM — same-tenant company evidence + guidance. Closed.** README now says forced
   RLS complements (never replaces) the shared business authorization layer; configurable
   rules stay in versioned policy data. Same-tenant `business_rule` company allow/deny test
   through the boundary; denied write leaves no effects. Production authorization engine
   identified as the acceptance dependency; wrapper is not claimed as that engine.

## Evidence recorded with the delivery

- Focused gate: `node scripts/check.mjs && node --test tests/auth-006-context.test.mjs`
  → PASS, 16/16, exit 0, Node v24.19.0, disposable PostgreSQL 18.6 on
  `127.0.0.1:55432`, accepted PIVOT-004/031/032 RLS stack with real non-owner
  auth-service and customer-app logins.
- Regressions: AUTH-002 18/18, AUTH-003 27/27, AUTH-004 21/21, AUTH-005 27/27.
- Combined serial run (`--test-concurrency=1`): 109 tests, 109 pass, 0 fail.
- Cleanup: disposable cluster stopped and deleted; `node_modules` removed; worktree clean
  at checkpoint time.
- Merge state: AUTH-006 not merged; `testing-1` remains `1b9ff78`.

## Where I stopped

Last completed step: committed `e5eb06e` (amended to include the uncertainty test), then
the delivery report and this checkpoint. No further code, tests, merges or new contracts
started after that.

## Exact next step

1. Await the Codex verdict on AUTH-006-R1 (expected on
   `origin/codex/pivot-003-rulings`).
2. On **ACCEPT**: nothing further from me for AUTH-006; it queues for a human Business
   Merge Request (dispatcher issues any merge command separately).
3. On **REVISE**: fetch the rulings branch, read the new review in full, apply exactly the
   scoped corrections inside the AUTH-006 TOUCH, re-run the focused gate plus
   AUTH-002..005, update `docs/contractor/deliveries/AUTH-006-tenant-context.md`, commit and
   push on `opencode/auth-006-context`, and stop without merging.

Open items: the requested narrow membership-locking amendment; AUTH-009 tenant-selection
audit vocabulary; the production company/resource authorization engine as an acceptance
dependency; future business feature wiring. No load/PgBouncer-instance claim is made.
