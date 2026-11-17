CONTRACT: docs/contractor/contracts/AUTH-005-verification-and-reset.md
STATUS: DONE — email verification and non-enumerating, single-use password reset are implemented behind the versioned auth adapter with an injected mail adapter; the active SQLite path is untouched.

## Identity

- Branch: `opencode/auth-005-recovery`, base `testing-1` at
  `a81ce5903919797c12ae98c96eb4df542179db3e` (the AUTH-004 merge).
- Implementation commit: `f8d4ca5`. Report + checkpoint commit follows.
- Worktree: `/home/esc/saven/wt-auth-005`.
- Node `v24.19.0`; disposable PostgreSQL 18.6 on loopback `127.0.0.1:55432`
  (created for this round, removed afterwards).

## Files changed

- `src/auth/recovery.mjs` — challenge service: digest-only `auth.verification` rows,
  purpose/account/expiry binding, reference-domain purpose validation, single-use consume
  under a row lock, stale-credential refusal, reset credential rotation + whole-session
  revocation, undelivered-challenge invalidation.
- `src/auth/mail.mjs` — controlled mail adapter with no built-in transport; composes the
  verification and reset links; never logs and never surfaces a provider error.
- `src/auth/routes.mjs` — retained `forgot-password`, new versioned `reset-password`,
  `email/verification/request` and `email/verify`; adapter-gated delivery, generic
  responses, pre-MFA allowlist for the new public/auth flows.
- `src/auth/README.md` — AUTH-005 routes, invariants, configuration, extension points and
  non-claims.
- `tests/auth-005-recovery.test.mjs` — 11 focused tests.
- `docs/contractor/deliveries/AUTH-005-recovery.md` — this report.

`src/auth/session-store.mjs` was in TOUCH but needed no delta: reset uses its existing
`revokeAllSessions` inside the owned transaction. Nothing outside TOUCH plus the report /
checkpoint changed.

## Invariant coverage

| Invariant | Evidence |
| --- | --- |
| Hash-stored random purpose/account-bound expiry | Reset and verification rows store only `sha256(token)` (`value_hash`), bound to `user_id`, normalised email, purpose, `expires_at` (24 h verification / 30 min reset). The stored row never contains the token; the audit ledger never contains it. |
| Atomically one consume | Consume locks the row `FOR UPDATE`, checks `consumed_at`/expiry, then conditionally updates it. Two concurrent reset consumers yield one 200 and one 400; two concurrent verification consumers likewise; replay and expired tokens are refused. |
| Reset invalidates every session/credential epoch | One transaction consumes the token, writes the new verifier, increments `credential_version` and revokes every live session with reason `password_reset`. Old sessions stop resolving, the old password no longer signs in, the new one does, and the epoch advances exactly once. |
| No plaintext tokens in logs or retained DB | Only digests are persisted; the capture adapter receives tokens; audit/verification rows and the response body are asserted token-free. The mail adapter does not log and wraps provider failures without the token. |
| No owner/role reassignment | `tenant_membership` rows are asserted byte-identical before/after a reset; only `auth.users` credential columns change. |
| Tests send mail only to a fake capture adapter | All delivery tests inject an in-test capture transport; one test injects a failing transport. No provider or network transport exists in the module. |
| Non-enumeration retained | Known, unknown and inactive addresses share `202 {accepted:true}` and the shared AUTH-003 reservation/throttle ledger. A throttled request sends no mail and creates no token; without a mail adapter the AUTH-003 `deferred_to_auth_005` no-delivery behaviour is unchanged. |
| No reset mail/token by ad-hoc means | `createMailAdapter` refuses construction without an injected transport and base URL; the route creates no challenge when no adapter is configured. |
| Stale credentials | A token issued before a later `password_updated_at` is refused (`RESET_TOKEN_STALE`), the newer credential survives, and a refused stale reset does not revoke sessions. |
| No client SQL authority / no superuser | Tokens only authorise their own bound account; the verification request uses the verified session's own address. The full reset lifecycle is additionally exercised under a real non-owner `saven_auth_service` login with INHERIT, NOBYPASSRLS. |
| Append-only audit | `password_reset_requested` and `password_reset_completed` rows are written through the existing append-only writer, with no token or password. |

## DONE WHEN evidence

```text
$ node --version
v24.19.0
$ node scripts/check.mjs
PASS: 163 JavaScript files parsed; package manifest valid.
$ node --test tests/auth-005-recovery.test.mjs
tests 11  pass 11  fail 0
```

Exit `0`.

Regressions and combined run (`--test-concurrency=1`, same disposable cluster):

```text
tests/auth-002-sessions.test.mjs   18/18
tests/auth-003-passwords.test.mjs  27/27
tests/auth-004-mfa.test.mjs        21/21
tests/auth-005-recovery.test.mjs   11/11
combined                            77 tests, 77 pass, 0 fail
```

The AUTH-003 suite still passes unchanged: because no mail adapter is injected in that
composition, the reset route keeps the earlier no-token, `deferred_to_auth_005` behaviour.
With an adapter, the reservation detail records `mail_adapter`.

## Boundaries and open items

- No SMTP/provider client, template system, UI or active entry-point wiring is delivered.
  Deployment must inject a reviewed transport and base URL; this is the AUTH-005 analogue
  of the pending `server.mjs` key/config composition contract.
- TTLs (24 h verification, 30 min reset) are validated bootstrap values, not approved
  production policy.
- The canonical `auth_event_type` reference domain has no email-verification event, so no
  dedicated verification event is invented; adding one is a reference-data/migration
  change owned by AUTH-009. Reset request/completion are audited.
- Delivery retry/metrics are future operations contracts. A mail failure returns no oracle
  and invalidates the undelivered challenge, but a provider outage is not retried here.
- SQLite remains the production path; no profile or entry point was activated.

## EXTENSIBILITY

compliant — challenge purposes are reference rows validated at issue time (not a growing
code enum), mail transports are injected behind one adapter, TTLs/entropy are bounded
configuration, and no cross-module concrete coupling or new hardcoded business domain was
introduced. Session tokens stay digest-only (D-012).

## GIT

branch=opencode/auth-005-recovery commit=`f8d4ca5`,report+checkpoint commit pushed=yes

# AUTH-005-R2 revision — 17 November 2026

Verdict and corrections: `docs/contractor/reviews/AUTH-005-recovery.md` at `700a4d2`.
Implementation commit `d088f47`; report + checkpoint follow. TOUCH unchanged; no schema,
migration, grant, dependency, server wiring or native source change.

## Findings closed

1. **HIGH — address binding and transactional request authority.** Status: **closed**.
   Issuance no longer trusts a caller snapshot: `issue` locks the account and resolves the
   current active `email` on the owned transaction. `consumeVerification` compares the
   challenge's stored identifier with the locked account's current normalized email before
   setting `email_verified`; `consumeReset` performs the same check before accepting a
   reset. A challenge issued for an old address can no longer verify or reset a different
   current address. `emailVerificationRequest` now reuses AUTH-004's
   `assertMutationAuthority` inside the issuance transaction, so a session that was
   revoked, idle/absolutely expired, disabled or credential-epoch-changed after the
   non-transactional read is refused before any challenge or mail. Tests: old-address
   verification refused with no wrong-address verification/partial consume; old-address
   reset refused with unchanged credential; issuance resolves the current address and the
   replaced address no longer resolves; revoke/expire/disable/credential-change
   read-valid-then-stale probes each create no challenge and no mail.

2. **HIGH — generation-bound stale-reset refusal.** Status: **closed**. Reset tokens are
   now `<random>.<credential-generation>` and the generation is part of the stored digest.
   Consumption compares it with `auth.users.credential_version` under the principal row
   lock; no wall-clock/date comparison remains. Purpose validity is rechecked at
   consumption, not only at issuance. A credential change that starts earlier and commits
   later still advances the generation and invalidates the link. Tests: older-start /
   later-commit (uncommitted credential update held while a reset starts, then committed)
   refuses the reset and preserves the newer credential; two links for one generation —
   the first accepted change makes the second invalid; a true reset-vs-authenticated
   conditional credential-change race accepts exactly one change, stores exactly one new
   credential and leaves the other link invalid in either outcome; audit-write failure and
   revocation failure both roll the complete reset back (credential, token, sessions
   unchanged); an unknown reset COMMIT returns `503 SESSION_TRANSACTION_UNCERTAIN`, never
   publishes the token and destroys the client. Reset completion no longer starts a KDF
   for a stale/invalid token: the probe checks address, generation, purpose and expiry
   first (asserted with a zero-hash counter).

3. **HIGH — no nested checkout on a single-connection pool.** Status: **closed**. The
   forgot-password lookup now runs on the limiter's already-owned lease client
   (`loadUserByEmail(executor, email)`), while the challenge insert still uses the same
   `lease.transaction`. Durable reservations, the current-account check and the generic
   response are unchanged. Tests: a real restricted auth-service login on a `max:1` pool
   completes known and unknown reset requests within a 15 s bound, and two concurrent
   same-scope requests complete on a `max:2` pool. No pool size was raised.

4. **MEDIUM — non-enumerating response boundary.** Status: **closed**. Delivery is now a
   controlled, bounded, drainable in-process queue (`createMailDispatcher`). The public
   response and the throttle lease are released without waiting for the provider; the
   queue owns the in-memory token, counts failures and invalidates an undelivered
   challenge through a callback. There is no unmanaged fire-and-forget and no raw-token
   persistence. Tests use a blocked (never-resolving until released) transport: known,
   inactive and unknown forgot-password requests all return the identical `202` before any
   delivery resolves, and only the active account yields a message. A failing transport
   still returns `202`, and the failure callback invalidates the challenge when cleanup
   succeeds. The residual boundary is tested and reported: if invalidation itself fails
   (`onFailure` rejects), `flush()` still completes, the failure is counted, and the
   challenge may remain live until expiry — the report no longer claims an unconditional
   no-live-token guarantee. Known vs unknown still differ by bounded local DB work; the
   provider latency branch is removed.

5. **MEDIUM — verification request admission.** Status: **closed**. Verification mail now
   passes a durable purpose/account/network issuance budget before any challenge exists:
   challenge rows are the budget, transaction-scoped advisory locks serialize concurrent
   requests for the account and network scope, and denial returns `429 MAIL_THROTTLED`
   with `Retry-After` and no challenge/mail. It does not reuse or pollute password-reset
   audit counters. Tests: repeated requests hit the limit, a denied request creates/sends
   nothing, the window admits again after cooldown, two concurrent requests admit exactly
   the configured budget, and a store failure returns 503 with zero challenges and zero
   mail.

## DONE WHEN evidence

```text
$ node --version
v24.19.0
$ node scripts/check.mjs
PASS: 163 JavaScript files parsed; package manifest valid.
$ node --test tests/auth-005-recovery.test.mjs
tests 27  pass 27  fail 0
```

Exit `0`.

Combined serial run (`--test-concurrency=1`, same disposable cluster):

```text
tests/auth-002-sessions.test.mjs   18/18
tests/auth-003-passwords.test.mjs  27/27
tests/auth-004-mfa.test.mjs        21/21
tests/auth-005-recovery.test.mjs   27/27
combined                            93 tests, 93 pass, 0 fail
```

Honest limit: one combined attempt hit the known fixture-teardown transient
(`terminating connection due to administrator command`) in an unchanged AUTH-004 case; the
immediate serial rerun was 93/93. It is the disposable-fixture cross-file teardown race
already reported in AUTH-004-R2, not a behavioural failure of these corrections, and is
reported rather than hidden.

## Boundaries

- No SMTP/provider client, template system or active entry-point wiring is delivered; the
  deployment must inject a transport/base URL and own dispatcher shutdown.
- TTLs and verification admission values are validated bootstrap values, not approved
  production policy.
- The canonical reference domain still has no email-verification audit event; reset
  request/completion are audited, verification remains an explicit AUTH-009/reference-data
  limitation. Challenge metadata is mutable operational state, not event history.
- Undelivered-challenge cleanup is best effort; a failed invalidation can leave a token
  live until expiry. No unconditional guarantee is claimed.
- SQLite remains production; no profile or entry point was activated.

## EXTENSIBILITY

compliant — purposes remain reference rows validated at issue and consumption, generation
and address binding are immutable fields inside the existing token/row, delivery is an
injected bounded owner, and admission is purpose/account/network scoped without new
hardcoded business domains. Session tokens stay digest-only (D-012).

## GIT (R2)

branch=opencode/auth-005-recovery commits=`d088f47`,report+checkpoint commit pushed=yes
