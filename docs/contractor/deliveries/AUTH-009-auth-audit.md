# AUTH-009 delivery — complete append-only auth event instrumentation

## Identity

- Contract: `docs/contractor/contracts/AUTH-009-auth-audit.md`
- Branch: `opencode/auth-009-audit`
- Worktree: `/home/esc/saven/wt-auth-009`
- Base `testing-1` SHA: `c543ef7` (AUTH-007 merged at `9b9d47f`, governance head `c543ef7`)
- Implementation commit: `857324cb902c1b64f951207fbd481d893515b645`
  (`app: centralize append-only auth audit with durable failure recording
  [contract:AUTH-009]`)
- Report/checkpoint commit: this commit

Owner sequencing, D-012 (digest-only sessions), D-016 (advance-only allocators) and D-017
(inventory base SHA) are unchanged and not reopened. No allocator, session-list payload,
SQLite/reference source, applied migration or production data was modified. There is no
repository-wide inventory in this delivery; where a base is cited, it is the SHA above.

## Files changed vs TOUCH

TOUCH: `src/auth/audit.mjs`; `src/auth/routes.mjs`; `src/auth/server.mjs`;
`src/auth/session-store.mjs`; `src/auth/password-policy.mjs`; `src/auth/rate-limit.mjs`;
`src/auth/factors.mjs`; `src/auth/recovery.mjs`; `src/auth/tenant-selection.mjs`;
`src/auth/access.mjs`; `src/auth/README.md`; `tests/auth-009-audit.test.mjs`.

Changed:

- `src/auth/audit.mjs` — **new**. Event catalog, `prepareAuditRow` (redaction/attribution),
  `createAuditWriter` (atomic success path + independent durable failure path + observable
  durability stats), `ADR03_REQUIRED_EVENTS`.
- `src/auth/routes.mjs` — every real flow now writes through the catalog; independent failure
  recording for MFA refusals, reset refusals, verification refusals, tenant-selection refusals
  and every operator exchange guard; `sessions_revoked` event; `handle.auditDurability()`.
- `src/auth/server.mjs` — composes the audit module; re-exports `createAuditWriter` for
  existing composition roots/tests.
- `src/auth/tenant-selection.mjs` — optional `audit` injection; `tenant_selected` /
  `tenant_cleared` commit inside the selection transaction; optional request context.
- `src/auth/README.md` — AUTH-009 section (catalog, invariants, extension points, explicit
  gaps); corrected the now-stale AUTH-006 and AUTH-007 audit non-claims.
- `tests/auth-009-audit.test.mjs` — **new**, 13 tests.

Not changed although allowed: `session-store.mjs`, `password-policy.mjs`, `rate-limit.mjs`,
`factors.mjs`, `recovery.mjs`, `access.mjs`. The existing transactions and the AUTH-007
exchange already expose the success boundary these events join, so no signature change was
needed. Details are recorded by the route (which owns the request/actor view) and, for
selection, inside the service transaction.

Protocol artifacts outside TOUCH (required by `CONTRACTOR_ROLE.md` §5): this report and
`docs/contractor/state/worker-a-checkpoint.md`.

## Gate

Environment identity:

- Node **v24.19.0** (package engine `>=24.13 <25`; downloaded from nodejs.org into
  `/tmp/auth009-node` because the host default was v22.23.5).
- PostgreSQL **18.6** on a disposable loopback-only cluster created for this round at
  `127.0.0.1:55439` (`initdb`/`pg_ctl` under `/tmp/auth009-pg`), `SAVEN_AUTH_TEST_CLUSTER=1`,
  administrative `PGUSER=postgres`, disposable database created and dropped by the fixture.
- Exactly the contract command:

```
$ node --version
v24.19.0
$ node scripts/check.mjs
PASS: 172 JavaScript files parsed; package manifest valid.
$ node --test tests/auth-009-audit.test.mjs
✔ AUTH-009 catalog covers every ADR03 event and reports its real producer honestly
✔ AUTH-009 redaction refuses unknown events, credential-shaped detail and unverified actors
✔ AUTH-009 failure-audit durability faults are counted and notified, never swallowed
✔ AUTH-009 login success is atomic with its audit row and publishes no credential on an audit fault
✔ AUTH-009 failed sign-ins are independently committed, attributed and repeatable
✔ AUTH-009 client-supplied actor fields never influence audit attribution
✔ AUTH-009 reset completion, all-session revocation and audit commit together
✔ AUTH-009 a failed reset audit rolls back the credential change and every revoke
✔ AUTH-009 MFA refusals are recorded durably while the lifecycle transaction keeps its invariants
✔ AUTH-009 operator guard refusals are audited before the assertion is exchanged
✔ AUTH-009 authentication audit stays distinct from operator audit history
✔ AUTH-009 tenant selection and clearing are audited atomically with the binding
✔ AUTH-009 the ledger refuses UPDATE, DELETE and TRUNCATE for every principal
ℹ tests 13
ℹ pass 13
ℹ fail 0
ℹ duration_ms 6948.144106
```

Additional regression evidence (same environment, serial):

```
auth-002-sessions: tests 18 pass 18 fail 0
auth-003-passwords: tests 27 pass 27 fail 0
auth-004-mfa:        tests 21 pass 21 fail 0
auth-005-recovery:   tests 27 pass 27 fail 0
auth-006-context:    tests 27 pass 27 fail 0
auth-007-access:     tests 22 pass 22 fail 0
```

Combined auth chain: **155/155** (142 prior + 13 new). No failure, transient or skipped test
in these runs. The larger default suite (`tests/*.test.mjs`) and the PIVOT suites were not run
in this round; they are not part of DONE WHEN.

## Coverage

Proven by execution:

1. **Catalog completeness.** Every ADR03 required event name exists; each has category, actor
   semantics, outcomes, detail allow-list and an explicit producer.
2. **Redaction.** Unknown events, unknown/credential-shaped keys (`password`, tokens,
   assertions, cookies, CSRF, recovery codes, `code_hash`), nested objects, invalid actor ids,
   wrong actor kind, unknown realm and unpermitted outcome are refused. Detail strings are
   bounded; invalid ingress addresses are dropped.
3. **Durable failure.** A rolled-back wrong-password attempt still leaves a committed
   `login_failure` row; a retry creates a second row; an unknown identity is recorded with
   `user_id = NULL` and `actor_kind = unknown`; a known account is
   `actor_kind = unverified_attempt`. A durability fault in the writer is counted/notified and
   surfaced by `handler.auditDurability()` while the 401 decision is unchanged.
4. **Atomic success.** An injected failure-audit fault rolls the login back (no session,
   no credential) and the reset back (no credential change, no revoke, no `sessions_revoked`).
5. **Reset + revoke-all.** `password_reset_requested`, `password_reset_completed`
   (credential version, revoked count) and a distinct `sessions_revoked` row
   (`scope = all`) commit together; replay yields a committed `password_reset_failed` and no
   second completion. Raw reset token and new password are absent from the ledger.
6. **MFA.** A re-enrollment refusal and a wrong TOTP each leave `mfa_enroll_failed` /
   `mfa_verification_failed` rows after the lifecycle transaction commits its counters; a
   success emits `mfa_verified`; no failure emits a success event.
7. **Operator exchange.** Missing bearer, unexpected body fields and wrong-realm requests are
   all recorded as `login_failure` with `actor_kind = operator_assertion`, no local identity,
   and no assertion value in any row. This closes the AUTH-007 R5 flag that pre-exchange guard
   refusals escaped the try/catch.
8. **Attribution.** Client-supplied `userId`/`actor`/`tenantId`/`eventType` are refused; no
   forged id, raw email, password or session token appears in any row.
9. **Ledger separation.** Customer login/logout produced only customer-realm auth rows and no
   `operator.operator_audit` row.
10. **Tenant selection.** `tenant_selected` (tenant column + membership/role detail) and
    `tenant_cleared` commit with the binding; a foreign tenant produces a committed
    `tenant_selection_failed` denial. Exercised through a real non-owner auth-service login
    because the AUTH-006 gate rejects a superuser caller.
11. **Append-only.** UPDATE/DELETE/TRUNCATE are refused for the owner (`AUTH_RECORD_IMMUTABLE`)
    and for `saven_auth_service`.

Not proven / explicitly excluded:

- `password_changed`, `role_changed`, `membership_invited`, `membership_accepted` have **no
  producing flow** in AUTH-001..007. They are catalogued with `producer: null`; no synthetic
  row is written. Adding them requires the corresponding authenticated route (a security
  behaviour this contract does not authorize inventing).
- `email_verification_failed` is instrumented but has no focused test in this round.
- MFA success atomicity relies on the same in-transaction writer as the tested login/reset
  paths; no separate fault-injection matrix was run for MFA success.
- Failure durability is best-effort against a total ledger outage: the attempt is refused and
  the miss is counted, but no row can exist while the database is unreachable.
- No UI, active entry point, deployment, migration, cutover or merge is delivered.
- No independent reviewer execution, live Access/IdP, SMTP, PgBouncer or load claim. Reviewer
  reproduction remains external to this report.

## Deviations / deliberate limits

- **No new routes.** The contract asks for every ADR03 event, but four required events have no
  authenticated flow. I did not add a password-change/role-change/membership route: that is
  new security behaviour beyond audit instrumentation and outside the dispatcher's explicit
  instruction. The gap is recorded in the catalog, README and tests so it cannot be mistaken
  for coverage; the vocabulary is ready for the future contract.
- **Event vocabulary is a module data catalog, not a DB enum or CHECK.** This follows the
  extensibility mandate (no hardcoded growing domain): adding an event is a catalog entry; the
  documented path is a versioned reference table + JSON schema. `detail_schema_version` is
  written explicitly and the detail allow-list is the extension review point.
- **Failure recording is outside the failed transaction by construction.** This is the only way
  a rolled-back attempt remains observable; the writer never accepts `tx` on the failure path.
- **Writer-owned `actor_kind`.** Actor semantics are enforced centrally rather than left to
  each caller; `login_failure` cannot claim `authenticated`.
- **`logout` is the single-session revocation event** (`detail.scope = one`) and
  `sessions_revoked` covers bulk revocation, avoiding duplicate rows for one action.
- No decision here narrows future options beyond the deliberate refusal to invent an
  unauthorised credential-change flow.
