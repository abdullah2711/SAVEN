# AUTH-009 delivery (revision 6) — boundary evidence completed, resubmitted

## Identity

- Contract: `docs/contractor/contracts/AUTH-009-auth-audit.md`
- Branch: `opencode/auth-009-audit`; worktree `/home/esc/saven/wt-auth-009`
- Base `testing-1` SHA: `c543ef7`
- Prior revisions: `eb6830a`, `de7d470`, `606c4e3`, `08f335c`, `ba948cf`
- Round-3 test commit: `d3d595c0a7663016f59728fa276fe4e7e0504692`
  (`test: prove password-change authority and owned-client boundaries [contract:AUTH-009]`)
- Report/checkpoint commit: this commit

Review state (verdict `121de7e`): the owned-authority implementation is accepted as built;
D-018 producer narrowing, early-refusal coverage and external configuration remain closed.
This round adds only the three previously required boundary-evidence scenarios. **No runtime
source changed**; the delta is test code.

## Scenario 1 — invalidation-first (DONE)

Tests:

1. `AUTH-009 invalidation-first committed membership requirement denies password change`
   - A wrapped store observes the early handler transaction, then a **real committed**
     `auth.tenant_membership` INSERT (`tenant_admin`, requiring MFA) runs after that early
     check and before the mutation's final authority read.
   - Asserts exactly `403 MFA_REQUIRED`; password hash and `credential_version` unchanged; no
     session revoked; no `password_changed` / `sessions_revoked`; exactly one
     `assurance_denied` (reason `MFA_REQUIRED`, route `/v1/auth/password/change`, actor from
     the verified session); exactly one durable `password_change_failed` reservation.
2. `AUTH-009 invalidation-first committed session assurance loss denies password change`
   - A fully enrolled administrator with an `mfa_verified` session passes the early check;
     the test then performs a **real stored** `UPDATE auth.sessions SET
     assurance_level='single_factor'` and the owned boundary re-reads it and refuses.
   - Asserts `403 MFA_REQUIRED`, unchanged credential, no success audit, exactly one
     `assurance_denied`. This is not the earlier false pre-read snapshot case.

## Scenario 2 — mutation-first (DONE)

Test: `AUTH-009 mutation-first writer cannot commit until the password transaction ends`

- The success audit pauses on a bounded in-test barrier **after final authority validation and
  the credential/revocation writes, before COMMIT**.
- A cooperating real membership writer (`auth_service` client) starts `BEGIN; INSERT
  auth.tenant_membership ...` on its own connection.
- Blocking is proven by polling `pg_stat_activity` until that PID reports
  `wait_event_type='Lock'`, `wait_event='advisory'`; the test also asserts the writer promise
  is still unsettled. A wall-clock sleep alone is not used as proof.
- Releasing the barrier lets the password transaction commit; only then does the writer
  commit. The membership row is asserted present.
- Subsequent-request authority is asserted: a fresh sign-in is pending MFA, and the next
  password-change request is refused with `MFA_REQUIRED` and one `assurance_denied`.
- Positive controls: `AUTH-009 authorized positive controls: ordinary user and current-MFA
  administrator` proves an ordinary user and an `mfa_verified` administrator both change
  password successfully (two `password_changed` rows).

## Scenario 3 — owned client and failure boundary (DONE)

Tests:

1. `AUTH-009 password change runs on a size-one auth pool without a nested checkout`
   - Real non-owner `saven_auth_service` pool with `max: 1`, 033 installed: successful change
     and a wrong-current-password refusal both complete within a bounded 15 s race; exactly
     two durable `password_change_failed` reservations (success attempt + refusal).
2. `AUTH-009 password-change success COMMIT uncertainty destroys the client and serves a
   clean borrower`
   - The accepted AUTH-002 phase-injection writer pattern is reused at the owned boundary:
     the COMMIT of the credential/audit transaction throws after `UPDATE auth.users`.
   - Asserts `503 SESSION_TRANSACTION_UNCERTAIN`; the checked-out connection is destroyed
     (`release(true)` observed); the credential version is treated as **unknown**
     (`old` or `old+1` accepted, never claimed rolled back); exactly one durable reservation
     is distinguished from the later credential commit; a subsequent borrower gets a clean
     connection.
3. `AUTH-009 password-change rollback uncertainty destroys the client and serves a clean
   borrower`
   - The success audit throws and ROLLBACK also fails; the lease is marked uncertain and the
     connection destroyed.
   - Asserts `503 AUTH_ACCOUNTING_UNAVAILABLE`, destruction, unknown credential state,
     retained attempt accounting, and a clean subsequent borrower.

No new membership policy, privilege, schema change, grant or production operation was added.

## Findings 2 and 3 — no regression

All prior closed tests remain green, including early-refusal coverage
(`pre-reservation login refusals...`, `assurance, CSRF and session refusals...`, `email
verification request/verify refusals...`, `composed refusals run under the real non-owner
auth-service login`, `MFA route guards...`, `operator guard refusals...`, `every route family
records its early security decision exactly once`) and catalog boundary tests (`event domain
is an external, versioned, validated configuration`, `server composition validates and
forwards the configured catalog`, required/producer maps).

## Files changed vs TOUCH

This round: `tests/auth-009-audit.test.mjs` only (32 focused tests). No runtime source,
schema, migration, grant or legacy file changed. Prior approved new file
`src/auth/audit-catalog.v1.json` and the revision-2..5 source remain as reviewed.

## Gate

Node **v24.19.0**, PostgreSQL **18.6**, disposable loopback cluster `127.0.0.1:55439`,
`SAVEN_AUTH_TEST_CLUSTER=1` (+ `SAVEN_PIVOT_TEST_CLUSTER=1` for AUTH-006).

```
$ node scripts/check.mjs
PASS: 172 JavaScript files parsed; package manifest valid.
$ node --test tests/auth-009-audit.test.mjs
ℹ tests 32
ℹ pass 32
ℹ fail 0
```

Serial regression in this run: AUTH-002 18/18, AUTH-003 27/27, AUTH-004 21/21, AUTH-005 27/27,
AUTH-006 27/27, AUTH-007 22/22 — combined **174/174**. Earlier runs intermittently hit the
pre-existing shared-fixture transient `terminating connection due to administrator command`
in AUTH-004/006 (reproduced on unmodified base `c543ef7`); this run was uninterrupted, and the
transient remains disclosed rather than guaranteed absent.

## Limits

- The concurrency tests exercise one writer kind (membership INSERT) against the shared gate;
  role-requirement updates use the same trigger contract and are not separately raced.
- COMMIT uncertainty is asserted as genuinely unknown, not as a rollback guarantee.
- No live IdP, mail, pooler, production load, cutover or restore evidence is claimed.
- No merge.
