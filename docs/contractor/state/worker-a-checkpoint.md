# WORKER-A checkpoint — AUTH-009 delivered, awaiting review

Date: 19 November 2026 (Asia/Karachi). Written under the owner standing checkpoint
directive; this file is outside any contract TOUCH.

## Exact contract

- Contract: `docs/contractor/contracts/AUTH-009-auth-audit.md` — complete append-only auth
  event instrumentation with correct failed-event durability and redaction.
- TOUCH: `src/auth/audit.mjs`; `src/auth/routes.mjs`; `src/auth/server.mjs`;
  `src/auth/session-store.mjs`; `src/auth/password-policy.mjs`; `src/auth/rate-limit.mjs`;
  `src/auth/factors.mjs`; `src/auth/recovery.mjs`; `src/auth/tenant-selection.mjs`;
  `src/auth/access.mjs`; `src/auth/README.md`; `tests/auth-009-audit.test.mjs`.
- DONE WHEN: `node scripts/check.mjs && node --test tests/auth-009-audit.test.mjs`.
- Depends on AUTH-002..007 (all merged; AUTH-007 at `9b9d47f`). Base `testing-1`: `c543ef7`.

## Round delivered

- Branch `opencode/auth-009-audit`, worktree `/home/esc/saven/wt-auth-009`.
- Implementation commit: `857324cb902c1b64f951207fbd481d893515b645`
  (`app: centralize append-only auth audit with durable failure recording
  [contract:AUTH-009]`).
- Delivery report: `docs/contractor/deliveries/AUTH-009-auth-audit.md` (this commit).
- Status: **delivered, not merged**. No review verdict exists yet.

## TOUCH used

`src/auth/audit.mjs` (new), `src/auth/routes.mjs`, `src/auth/server.mjs`,
`src/auth/tenant-selection.mjs`, `src/auth/README.md`,
`tests/auth-009-audit.test.mjs` (new), plus this checkpoint/report as protocol artifacts.
Allowed-but-unused: `session-store.mjs`, `password-policy.mjs`, `rate-limit.mjs`,
`factors.mjs`, `recovery.mjs`, `access.mjs`.

## Failure evidence

- Active failures: **none**. Gate exit 0.
- Exact gate output (Node v24.19.0, PostgreSQL 18.6, disposable loopback cluster port 55439,
  `SAVEN_AUTH_TEST_CLUSTER=1`):
  `PASS: 172 JavaScript files parsed; package manifest valid.` then AUTH-009
  `tests 13 / pass 13 / fail 0`.
- Regression: AUTH-002 18/18, 003 27/27, 004 21/21, 005 27/27, 006 27/27, 007 22/22
  (combined auth chain 155/155).
- Environment caveat: host default Node was v22.23.5; Node v24.19.0 was fetched to
  `/tmp/auth009-node` for the gate. PostgreSQL ran from a disposable cluster at
  `/tmp/auth009-pg` (port 55439), not the system cluster.

## Known limits carried to review

- `password_changed`, `role_changed`, `membership_invited`, `membership_accepted` have no
  producing flow; catalogued with `producer: null`, no synthetic rows, listed in README,
  report and tests.
- `email_verification_failed` is instrumented but untested in this round.
- MFA success atomicity uses the same in-transaction writer; only login/reset fault matrices
  were injected.
- Failure durability is best-effort under a total ledger outage (counted, not delivered).

## Exact next step

1. Await Codex review of `857324c` against `docs/contractor/reviews/`.
2. On REVISE: fix finding-by-finding in this worktree, re-run the gate, update the delivery
   report and this checkpoint, commit, push.
3. Never merge; the dispatcher relays the human-approved merge command.
