# WORKER-A checkpoint — AUTH-007-R1 delivered, awaiting verdict

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
- Round just delivered: **AUTH-007-R1**, correcting
  `docs/contractor/reviews/AUTH-007-operator-access.md` at `26f8263`.
- Implementation commit: `b458b55` (`app: bind operator authority and canonicalize Access
  exchange [contract:AUTH-007-R1]`).
- Report + this checkpoint are the next commit; that commit is the pushed head at
  checkpoint time.

## TOUCH used

`src/auth/access.mjs`, `src/auth/routes.mjs`, `src/auth/README.md`,
`db/postgres/06-operator-identity.sql`, `tests/auth-007-access.test.mjs`, delivery report
and this checkpoint. No other path; no local SQLite/reference source, existing entry point or
applied migration byte.

## R1 corrections and status (review `26f8263`)

1. **CRITICAL — explicit MFA only. Closed.** Default assurance requires the RFC 8176 `mfa`
   AMR value; otp/hwk/swk/pwd/pwd+otp alone are denied. A reviewed issuer-controlled
   `mfaEvidence` predicate may handle a signed custom claim. Policy is fixed to `access_mfa`
   (misconfiguration throws); mapping assurance must equal it. Tests cover each single method,
   absent/malformed AMR, valid `mfa`, custom-policy positive/negative, stale mapping class and
   policy misconfiguration.
2. **HIGH — mapping authority reserved and bound. Closed.** Exchange/operator admission take
   the AUTH-006 shared authority gate before mapping/role reads and lock the local principal
   in gate -> user -> session order. `06` installs BEFORE STATEMENT gate triggers on
   `operator.access_identity`; `033` covers auth-role changes. Session binding records
   issuer/subject/audience, mapping epoch/role/assurance and source expiry; every current
   operator use revalidates current mapping/role/assurance/epoch/principal/expiry. Tests cover
   post-issuance revocation, role/effective/assurance/epoch changes, same-user/different-
   subject isolation, source expiry, invalidation-first and admission-first interleavings,
   and audit/nonce/session rollback. `admitSession(session,{tx})` is the future PIVOT-007
   interface.
3. **HIGH — canonical replay identity. Closed.** JOSE segments must be canonical base64url;
   noncanonical unused-bit/padded encodings are rejected. Fallback identity is namespaced by
   issuer/audience/subject and uses the canonical assertion digest, never raw JWT text. Tests
   alter unused signature bits (same bytes) and run simultaneous no-nonce exchanges with at
   most one committed exchange/session/binding.
4. **HIGH — freshness at owned admission. Closed.** Validation plus a second trusted-clock
   check inside the owned transaction after gate/user lock cover source expiry, mapping/role
   windows and configured max age; a configured max age requires a finite `iat`. Paused-
   checkout tests prove zero nonce/session/binding/success-audit commits on expiry/staleness.
5. **MEDIUM — concurrency-safe refresh. Closed.** Refresh admission is reserved before
   awaiting, in-flight calls coalesce, failures retain known-good keys and start a retry
   cooldown. Tests cover cached keys, simultaneous unknown kids, slow/rejected refresh,
   recovery and no token/URL-directed fetch.

## Evidence recorded with the delivery

- Focused gate: `node scripts/check.mjs && node --test tests/auth-007-access.test.mjs`
  → PASS, 13/13, exit 0, Node v24.19.0, disposable PostgreSQL 18.6 on
  `127.0.0.1:55433` (55432 occupied), auth fixture + AUTH-006 033 + operator 06 applied as
  administrator with namespaced roles, real non-owner auth-service login.
- Regressions: AUTH-002 18/18, AUTH-003 27/27, AUTH-004 21/21, AUTH-005 27/27,
  AUTH-006 27/27.
- Combined serial run (`--test-concurrency=1`): 133 tests, 133 pass, 0 fail.
- Cleanup: disposable cluster stopped and deleted; `node_modules` removed; worktree clean
  at checkpoint time.
- Merge state: AUTH-007 not merged.

## Where I stopped

Last completed step: committed `b458b55`, then the delivery report and this checkpoint.
No further code, tests, merges or new contracts started.

## Exact next step

1. Await the Codex verdict on AUTH-007-R1.
2. On **ACCEPT**: nothing further from me for AUTH-007; it queues for a human Business
   Merge Request (dispatcher issues any merge command separately).
3. On **REVISE within TOUCH**: fetch the rulings branch, apply only scoped corrections,
   re-run focused plus AUTH-002..006, update the report, commit/push on
   `opencode/auth-007-operator-access`, and stop without merging.

Open items/limits: `06-operator-identity.sql` depends on AUTH-006 `033`; the authority gate
is global for authority writes (no throughput/SLA claim); a custom MFA predicate is reviewed
deployment code, not client input; captured unexpired bearer exchange is first-presenter-wins
(no impossible replay-proof claim); no live Access policy/DNS/tunnel/network fetch or
production credential; operator reads and complete audit taxonomy remain PIVOT-007/AUTH-009;
some pre-exchange route guard failures are not audited; SQLite remains production.
