# AUTH-009 delivery (revision 5) — bounded round-2 correction, resubmitted

## Identity

- Contract: `docs/contractor/contracts/AUTH-009-auth-audit.md`
- Branch: `opencode/auth-009-audit`; worktree `/home/esc/saven/wt-auth-009`
- Base `testing-1` SHA: `c543ef7`
- Prior revisions: `eb6830a`, `de7d470`, `606c4e3`, `08f335c`
- Round-2 implementation commit: `0afeb5002d57806c058daa793ad323538181820f`
  (`app: revalidate MFA assurance inside password-change authority boundary
  [contract:AUTH-009]`)
- Report/checkpoint commit: this commit

Review state per the routed verdict (`87b7977` + amendment at the rulings head): finding 2
**CLOSED**, finding 3 **CLOSED**, finding 1 **AMENDED on the record** — the three
role/membership producers remain mandatory ADR03 requirements owned by the future IAM
contract, and their absence is no longer an AUTH-009 acceptance blocker (D-018). This round
performs only the remaining bounded correction.

## Bounded correction: password-change owned authority boundary

The generic pre-route MFA check is not treated as mutation authority. Inside the
password-change transaction (`src/auth/routes.mjs`, `passwordChange`):

1. **Shared authority gate first.** `acquireAuthorityGate(tx)` acquires the accepted shared
   gate (`pg_advisory_xact_lock_shared`, AUTH-006 033) before any principal/factor/session
   lock or authoritative read. The exported gate helper is the same contract used by tenant
   admission (extracted to module scope in `tenant-selection.mjs`; no behavior change there).
2. **Lifecycle lock order.** `assertMutationAuthority` locks principal then factor
   (users -> two_factor), then the session row is locked via
   `readSessionById(..., {forUpdate: true, realm})` — the accepted users -> factor -> sessions
   order, matching reset/rotation.
3. **Authoritative re-read after blocking acquisitions.** The locked session row supplies the
   current assurance; `mfaService.status` re-reads the current required-MFA authority
   (active/effective membership roles) and factor enrollment. The earlier pre-route
   snapshot is never treated as authority.
4. **Fail closed.** Unresolved authority -> `503 MFA_AUTHORITY_UNAVAILABLE`; required MFA with
   insufficient assurance or no enrolled factor -> `403 MFA_REQUIRED`, recorded as
   `assurance_denied` after rollback (actor from the verified session).
5. **Reserved authority held through commit.** The gate and row locks stay held through the
   credential `UPDATE`, session revocation, `password_changed` and `sessions_revoked` rows.
6. **Preserved invariants.** No selected business tenant required; customer realm only (no
   operator context); durable pre-KDF attempt reservation unchanged; token/realm/epoch/expiry
   checks still enforced; credential-generation advancement and success-audit atomicity
   unchanged; denied-attempt evidence preserved.

Proving test: `AUTH-009 password change revalidates required MFA assurance inside its owned
boundary`. A fresh pending single-factor session is combined with a store snapshot that
falsely claims `mfa_verified` so the pre-route gate passes; the owned boundary re-reads the
locked session, refuses with `MFA_REQUIRED`, leaves `credential_version` and password
unchanged, writes no `password_changed`/`sessions_revoked`, and commits exactly one
`assurance_denied` row. The test runs under the real non-owner `saven_auth_service` login with
033 installed.

Existing password-change tests were moved to the same non-owner composition:
`AUTH-009 password_changed is produced by the authenticated credential-change flow`,
`AUTH-009 a wrong current password is a durable, single refusal and changes nothing`,
`AUTH-009 a failed password_changed audit rolls the credential change and revokes back`.

## Findings 2 and 3 — no regression

All prior tests still pass, including:

- early refusals: `pre-reservation login refusals...`, `assurance, CSRF and session
  refusals...`, `email verification request/verify refusals...`, `composed refusals run under
  the real non-owner auth-service login`, `MFA route guards...`, `operator guard refusals...`,
  `every route family records its early security decision exactly once`;
- catalog: `event domain is an external, versioned, validated configuration`, `server
  composition validates and forwards the configured catalog`, `required-event map stays
  independent`, `producer/transition map...`.

The required map and producer map are unchanged from revision 4: all four ADR03 events
required; `password_changed` live; `role_changed`/`membership_invited`/`membership_accepted`
explicitly producer-deferred to IAM with `BUSINESS_ROLE_SAVED` carried forward. The corrected
premise (legacy flows are live; not covered by the audited PostgreSQL surface; porting is an
IAM contract) remains in README and this delivery.

## Files changed vs TOUCH

TOUCH: `src/auth/audit.mjs`; `src/auth/routes.mjs`; `src/auth/server.mjs`;
`src/auth/session-store.mjs`; `src/auth/password-policy.mjs`; `src/auth/rate-limit.mjs`;
`src/auth/factors.mjs`; `src/auth/recovery.mjs`; `src/auth/tenant-selection.mjs`;
`src/auth/access.mjs`; `src/auth/README.md`; `tests/auth-009-audit.test.mjs`.

This round: `tenant-selection.mjs` (gate helpers exported, no behavior change),
`routes.mjs` (owned-boundary revalidation), `README.md`, `tests/auth-009-audit.test.mjs`
(25 tests). No migration, grant, role, accepted-migration, SQLite or legacy-flow change.

## Gate

Node **v24.19.0**, PostgreSQL **18.6**, disposable loopback cluster `127.0.0.1:55439`,
`SAVEN_AUTH_TEST_CLUSTER=1` (+ `SAVEN_PIVOT_TEST_CLUSTER=1` for AUTH-006).

```
$ node scripts/check.mjs
PASS: 172 JavaScript files parsed; package manifest valid.
$ node --test tests/auth-009-audit.test.mjs
ℹ tests 25
ℹ pass 25
ℹ fail 0
```

Serial regression: AUTH-002 18/18, AUTH-003 27/27, AUTH-005 27/27, AUTH-006 27/27, AUTH-007
22/22. AUTH-004 hit the **pre-existing** shared-fixture transient
`terminating connection due to administrator command` once; the isolated rerun is 21/21, and
the same error was reproduced on unmodified base `c543ef7`. Not attributed to this change;
disclosed rather than rounded up.

## Limits

- Role/invitation/acceptance producers remain deferred by Principal amendment (D-018) and are
  not implemented here.
- Failure durability is best-effort under a total ledger outage (counted/exposed).
- No UI, active entry point, deployment, migration, cutover or merge; no live Access/IdP,
  SMTP, pooler or load claim.
