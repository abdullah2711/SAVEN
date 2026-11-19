# WORKER-A checkpoint — AUTH-009 revision 6: boundary evidence completed

Date: 19 November 2026 (Asia/Karachi). Checkpoint directive; outside any contract TOUCH.

## Exact contract

- `docs/contractor/contracts/AUTH-009-auth-audit.md`
- Base `testing-1` @ `c543ef7`; prior revisions through `ba948cf`.
- Branch/worktree: `opencode/auth-009-audit` @ `/home/esc/saven/wt-auth-009`.
- Round-3 test commit: `d3d595c0a7663016f59728fa276fe4e7e0504692`.
- Review `121de7e`: implementation accepted as built; three boundary-evidence scenarios
  required. D-018 and findings 2/3 remain closed.

## Per-finding enumeration (this round)

### Scenario 1 — invalidation-first — DONE

- Named test: `AUTH-009 invalidation-first committed membership requirement denies password
  change` (real committed membership INSERT after the early check).
- Named test: `AUTH-009 invalidation-first committed session assurance loss denies password
  change` (real stored session assurance UPDATE, not a false pre-read snapshot).
- Asserted: exact `MFA_REQUIRED`, unchanged password/epoch, no revocation/success audit, one
  durable non-duplicated `assurance_denied` + one reservation.

### Scenario 2 — mutation-first — DONE

- Named test: `AUTH-009 mutation-first writer cannot commit until the password transaction
  ends` (barrier after final authority, before COMMIT; real writer blocks; proof via
  `pg_stat_activity` advisory wait, not sleep; subsequent authority asserted).
- Positive controls: `AUTH-009 authorized positive controls: ordinary user and current-MFA
  administrator`.

### Scenario 3 — owned client and failure boundary — DONE

- `AUTH-009 password change runs on a size-one auth pool without a nested checkout` (max 1,
  bounded race, two durable attempt rows).
- `AUTH-009 password-change success COMMIT uncertainty destroys the client and serves a clean
  borrower` (503 SESSION_TRANSACTION_UNCERTAIN, release(true), credential state unknown,
  clean borrower).
- `AUTH-009 password-change rollback uncertainty destroys the client and serves a clean
  borrower` (503 AUTH_ACCOUNTING_UNAVAILABLE, release(true), unknown credential state, clean
  borrower).

## Gate / failure evidence

- Focused: `node scripts/check.mjs` PASS (172); `node --test
  tests/auth-009-audit.test.mjs` → **32/32** pass, 0 fail.
- Serial regression this run: 002 18/18, 003 27/27, 004 21/21, 005 27/27, 006 27/27,
  007 22/22 → combined **174/174**.
- Known pre-existing transient `terminating connection due to administrator command`
  (AUTH-004/006 fixture teardown) is disclosed; reproduced on unmodified base `c543ef7`; not
  observed in this run.
- Environment: Node v24.19.0, PostgreSQL 18.6, disposable loopback cluster 55439.

## Exact next step

1. Codex reviews `d3d595c` for the three boundary-evidence scenarios.
2. No runtime source changed this round; keep D-018 producer markers and closed findings.
3. Never merge; the dispatcher relays the human-approved merge command.
