# WORKER-A checkpoint — AUTH-007 delivered, awaiting verdict

Date: 18 November 2026 (Asia/Karachi). Written under the owner standing checkpoint
directive; this file is outside any contract TOUCH.

## Context

- AUTH-006 merged at `0df990a73c883b67e22dbfacfcb4f90162eef910`; `testing-1` at the same
  SHA when AUTH-007 opened.
- AUTH-007 branch/worktree: `opencode/auth-007-operator-access` at
  `/home/esc/saven/wt-auth-007`, based on `0df990a`.

## Exact contract

- Contract: `docs/contractor/contracts/AUTH-007-operator-access.md` — Cloud operator Access
  JWT validation and scoped local subject mapping without local Cloud operator passwords.
- TOUCH: `src/auth/access.mjs`, `src/auth/routes.mjs`, `src/auth/README.md`,
  `db/postgres/06-operator-identity.sql`, `tests/auth-007-access.test.mjs`.
- DONE WHEN: `node scripts/check.mjs && node --test tests/auth-007-access.test.mjs`.
- Implementation commit: `a67feed` (`app: add Access operator exchange and scoped subject
  mapping [contract:AUTH-007]`).
- Report + this checkpoint are the next commit; that commit is the pushed head at
  checkpoint time.

## TOUCH used

`src/auth/access.mjs` (new), `src/auth/routes.mjs`, `src/auth/README.md`,
`db/postgres/06-operator-identity.sql` (new), `tests/auth-007-access.test.mjs` (new),
delivery report and this checkpoint. Nothing else changed; no local SQLite/reference source,
existing entry point or applied migration byte.

## What was delivered

1. **Access validator (`access.mjs`)** — fixed issuer/audience/RS algorithm/key set;
   signature and exp/nbf/iat/iss/aud/subject checks with bounded skew; `jku`/`x5u` ignored;
   fixed-source key refresh with cooldown and fail-closed unknown keys.
2. **Operator exchange** — explicit active `operator.access_identity` mapping to a local
   auth identity + active/effective `is_operator` role; required `access_mfa` assurance must
   match both claim-derived assurance and mapping class; one-time SHA-256 nonce ledger
   (`operator.access_exchange`); operator-realm session with `access_asserted` assurance;
   success audit inside the transaction, failure audit independently with generic reasons.
3. **Schema (`06-operator-identity.sql`)** — additive mapping/nonce tables, narrow auth
   service SELECT on identity and SELECT/INSERT on exchange; no UPDATE/DELETE, RLS change,
   local password/TOTP column or universal support subject.
4. **Routes** — `/v1/auth/operator/access`, `/v1/auth/operator/me`,
   `/v1/auth/operator/logout`; operator origin/realm guards; exchange accepts no body fields.
5. **Docs** — AUTH-007 section in `src/auth/README.md` and this delivery report.

## Evidence recorded with the delivery

- Focused gate: `node scripts/check.mjs && node --test tests/auth-007-access.test.mjs`
  → PASS, 7/7, exit 0, Node v24.19.0, disposable PostgreSQL 18.6 on
  `127.0.0.1:55433` (55432 was occupied), auth/PIVOT-004/031/032/033/06 fixtures, real
  non-owner auth-service login.
- Regressions: AUTH-002 18/18, AUTH-003 27/27, AUTH-004 21/21, AUTH-005 27/27,
  AUTH-006 27/27.
- Combined serial run (`--test-concurrency=1`): 127 tests, 127 pass, 0 fail.
- One combined attempt hit the known disposable-fixture teardown transient in an unchanged
  AUTH-004 case; immediate serial rerun was 127/127.
- Coverage: valid lifecycle; missing/expired/wrong issuer/audience/not-yet-valid/tampered/
  unmapped; revoked mapping, expired effective window, suspended local identity, non-operator
  role; no-MFA/stale assurance; key rollover/fixed-source refresh/attacker `jku`/no-refresh
  fail-closed; nonce replay vs reusable bearer validation; customer-realm refusal; operator
  login/password-body refusal; no password/TOTP columns; narrow grants; unavailable service.
- Cleanup: disposable cluster stopped and deleted; `node_modules` removed; worktree clean
  at checkpoint time.
- Merge state: AUTH-007 not merged.

## Where I stopped

Last completed step: committed `a67feed`, then the delivery report and this checkpoint.
No further code, tests, merges or new contracts started.

## Exact next step

1. Await the Codex verdict on AUTH-007.
2. On **ACCEPT**: nothing further from me for AUTH-007; it queues for a human Business
   Merge Request (dispatcher issues any merge command separately).
3. On **REVISE within TOUCH**: fetch the rulings branch, apply only scoped corrections,
   re-run focused plus AUTH-002..006, update the report, commit/push on
   `opencode/auth-007-operator-access`, and stop without merging.

Open items/limits: no live Access policy/DNS/tunnel/network key fetch or production
credential; operator data reads and complete operator audit taxonomy remain PIVOT-007/
AUTH-009; captured unexpired bearer exchange is first-writer-wins (no impossible replay-proof
claim); deployment must supply fixed issuer/audience/keys and MFA-assurance claim; SQLite
remains production; no profile/cutover/onboarding.
