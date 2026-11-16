# `src/auth` — versioned PostgreSQL authentication boundary (AUTH-002)

Status: schema-backed auth service modules with versioned password policy and durable
throttling (AUTH-003). Nothing here is imported by an active
entry point. The SQLite `/api` handler in `src/local` remains the running
authentication path, and no existing route, table or session was changed. This module
is not a claim of a completed PostgreSQL auth cutover. The pinned Better Auth package
is exercised through the adapter in `server.mjs` and its session lifecycle is covered
by the gate, but no entry point, connector or profile is switched to it.

## Routes

All routes are versioned and mounted under `/v1/auth`. No `/auth` alias is provided
because no caller requires one yet; breaking changes go to a later version instead of
silently changing behaviour.

| Route | Method | Behaviour |
| --- | --- | --- |
| `/v1/auth/login` | POST | Verifies an email credential, creates a PostgreSQL session, sets a host-only session cookie and returns `{realm, csrfToken, user}`. The plaintext session token never appears in the body. |
| `/v1/auth/me` | GET | Resolves the cookie to a verified server-side session, refreshes idle activity, and returns user/session metadata. Expired, revoked, disabled or credential-stale sessions return `401`. |
| `/v1/auth/logout` | POST | Requires the session cookie plus an `X-CSRF-Token` header matching the stored CSRF digest, revokes the session row and clears the cookie. |

The handler is a Web-API `Request → Response` function so any server can mount it
without a framework dependency. Exact-origin checks come from the caller-supplied
customer/operator origin pair; an unrecognised origin fails before any lookup.

## Session invariants

- The token is 32 random bytes, base64url encoded. Only its SHA-256 hex digest is
  persisted; the digest is what every read, refresh, rotate and revoke statement
  receives. A spy on the database boundary proves no plaintext token reaches SQL.
- Idle expiry is 30 days by default and absolute expiry 90 days. Activity moves
  `idle_expires_at` only, capped at `absolute_expires_at`; the database trigger from
  AUTH-001 refuses any change to the absolute ceiling.
- Revocation is an `UPDATE … revoked_at` and keeps history. The library default of
  deleting session rows is not used.
- Rotation on a privilege/credential change issues a new token and revokes the old
  row, preserving the original absolute ceiling. The session carries
  `credential_version`; a user credential epoch change invalidates old sessions on
  their next read.
- Cookie: host-only, `HttpOnly`, `Secure` on HTTPS, `Path=/`, no `Domain`.
  Customer realm is `SameSite=Lax`; operator realm is reserved for AUTH-007 and uses
  `SameSite=Strict`. The `__Host-` prefix is used when secure; local non-TLS fixtures
  use a separate, obviously non-production name.
- No cookie-only authority: the cookie carries an opaque token only, and every
  request re-reads the server-side session. Session data is never cached in a cookie.
- Atomic success: the session insert and its `login_success` audit row commit on one
  checked-out transaction client, and the cookie is only set after commit. Logout
  revokes and audits in one transaction; a failed logout audit rolls the revocation
  back. A sign-in attempt is durably reserved in its own committed statement before
  verification starts, so a refused or failed attempt is already recorded.
- Transaction outcomes are reported honestly. A known failed statement is rolled back
  and reported as a failure. A lost COMMIT acknowledgement is an indeterminate
  outcome: the response is `503 SESSION_TRANSACTION_UNCERTAIN`, no credential is
  published, and the connection is destroyed instead of being returned to the pool.
  The row may exist after such a commit, but its token was never disclosed and it
  remains unusable to the caller. A failed ROLLBACK also destroys the client, because
  an uncertain connection must not be reused.
- Race safety: rotation locks the source row (`SELECT … FOR UPDATE`), re-validates
  revoked/idle/absolute/status/credential epoch at the mutation boundary, creates
  exactly one successor and consumes the source, all in one transaction. Concurrent
  rotations leave one live session; a rotation racing logout leaves at most one. The
  permitted linearization is explicit: if rotation wins, the concurrent revoke targets
  the already-consumed token, reports no live row and does not reach the successor; if
  revoke wins, rotation returns no successor. History is retained either way.
  `refresh` is a guarded UPDATE that cannot revive an idle-expired, revoked, disabled
  or credential-stale row, and `/v1/auth/me` fails closed if that update matches
  nothing.
- Bounded configuration: durations must be integral, positive, shorter than or equal
  to the ADR03 30-day idle / 90-day absolute ceilings, and token generation stays at
  32–64 random bytes. Weaker or malformed overrides are refused at construction.
- Trusted time: the injected application clock is authoritative for expiry checks and
  writes; the database contributes structural constraints and the immutable absolute
  ceiling, not the session clock. Reference-data checks use the same application
  clock, including `effective_from`, so a future-dated realm or assurance class is
  not usable early.
- CSRF: the client keeps the plaintext CSRF value returned at login; only its digest
  is stored on the session row and compared in constant time on state-changing
  requests.
- Realm is data, not a hardcoded list: `auth.reference_value` domain `realm` is the
  allowlist, and unknown realms are refused.
- Client input cannot choose a user, role, tenant or credential epoch. Login accepts
  only `email` and `password`; the user id, status and credential version come from
  the verified row, and tenant selection is AUTH-006 work.

## Database requirements

- Runs on the canonical schema from `db/postgres/05-auth-schema.sql` plus
  `db/postgres/migrations/006-auth-schema-corrections.sql`.
- Write access is limited to `auth.users` reads, `auth.sessions` lifecycle columns and
  `auth.auth_audit` inserts. The runtime principal must not own tables, must not be a
  superuser and must not have `BYPASSRLS`. No DDL is issued here.
- `auth.auth_audit` is append-only at the database level. An audit insert failure
  fails the request rather than reporting an unrecorded success.

## Extension points

- Realm values are data, but a working realm still needs code and configuration: a
  row in `auth.reference_value` (domain `realm`, active and effective) is required
  and checked at session creation, while the cookie profile lives in the `REALMS` map
  and the exact origin must be supplied to the server. `REALMS` is intentionally a
  small fixed protocol map, so adding a realm is a reviewed code change, not a data
  edit alone.
- New assurance classes: add `auth.roles` rows. Business/ERP roles and the protected
  ultimate-owner definition stay in `tenant_data`; they are not authentication roles.
- New audit events: add `auth.reference_value` rows (domain `auth_event_type`) and emit
  them through the same append-only writer. AUTH-009 owns full event coverage.
- Tenant selection: AUTH-006 supplies a verified `selection` object to
  `createSession`. The store only accepts a server-resolved membership id, tenant id
  and membership epoch; it never reads them from a request.
- Password policy, rehash-on-success and rate limiting: AUTH-003 replaces the injected
  `verifyCredential` adapter and adds throttles. This module deliberately has no rate
  limit yet.
- MFA: AUTH-004 registers factor verification and raises the session assurance level;
  `assurance_level` and `mfa_verified_at` already exist on the row.
- Verification/reset: AUTH-005 owns the single-use challenge flows and mail adapter.
- Cloud operator access: AUTH-007 validates the asserted identity provider and decides
  the operator realm; the operator branch here fails closed on purpose.
- Better Auth adaptation: `createBetterAuthSessions` instantiates the pinned library
  with a custom adapter over the canonical schema. It enforces the same authority as
  the first-party store, not a weaker parallel lifecycle:
  - lookup, list and count paths reject revoked rows, disabled users, stale credential
    epochs, non-matching realms, idle expiry and absolute expiry;
  - create caps a library-supplied expiry at the configured idle policy and the
    immutable absolute ceiling, and refuses an inactive or unknown user;
  - update/updateMany cannot revive an expired row and cannot exceed the configured
    idle policy or the ceiling;
  - revoke/delete is a revocation `UPDATE` that preserves history;
  - raw tokens are hashed exactly once per value, including bulk `token IN (...)`
    lookups and revocations; unsupported operators, empty lists and empty filters fail
    closed instead of broadening to a full-table statement.
  Cookie cache and library schema validation stay disabled. The gate drives the
  library's own `createSession`/`findSession`/`updateSession`/`deleteSession` plus its
  bulk `findSessions`/`deleteSessions` paths. Limitation: a list without an explicit
  token filter cannot recover raw tokens, so such results expose digest identifiers
  and are not usable for client display. Remaining work is activation: model/field
  parity for accounts, verification and plugins (2FA/passkey), route wiring and
  entry-point cutover are not part of this module.

## Non-claims

- No login form, UI wiring, rate limit, MFA enforcement, email verification, password
  reset, OIDC connector or operator authentication is delivered here.
- The gate uses a disposable database, a test-only auth-service login and an injected
  clock; it is not production evidence, and SQLite remains the production path. The
  library adapter covers sessions only — accounts, verification, 2FA, passkey and any
  OIDC connector remain future contracts.

## Password policy and throttling (AUTH-003)

### Password policy (`src/auth/password-policy.mjs`)

- Argon2id is the preferred verifier and is produced through Node's native OpenSSL
  binding, so no new dependency is introduced. Parameters are bounded
  (64 MiB, 3 passes, parallelism 1, 32-byte tag, 16-byte salt) and every verification
  re-checks those bounds against the stored verifier, so a tampered or absurd hash fails
  closed instead of consuming arbitrary memory.
- Retained bounded scrypt verifiers stay valid. A successful sign-in upgrades them to
  Argon2id inside the same transaction, conditional on the verifier being unchanged, and
  the upgrade is recorded in the success audit (`rehashed: true`).
- Unknown, malformed, bcrypt or plaintext verifiers never authenticate; they still run a
  bounded dummy derivation so response timing does not disclose account state.
- New-password input is validated (12–128 characters, ≤512 bytes, no NUL) and KDF work
  is capped at two concurrent derivations; excess work is refused with
  `429 PASSWORD_BUSY` rather than queued without bound. Admission covers **every**
  derivation — hash, Argon2id verify, retained scrypt verify and the dummy path — so a
  burst of unknown/malformed verifiers cannot bypass the bound.
- Absent, unknown, malformed and hostile stored verifiers all run the same normal-work
  dummy derivation (configured memory/passes/parallelism) and return a normalized
  failure. Invalid shapes never take an immediate no-work branch, and native provider
  errors become bounded credential failures rather than 503 escapes.
- Input validity is tracked separately from the value used for dummy work. Non-string,
  empty, oversized and NUL-containing input performs the same bounded admitted dummy
  derivation and then returns **invalid unconditionally** — it is never compared against
  the stored verifier, so the public dummy string cannot be used as a credential. The
  dummy string itself is not banned; it remains a legitimate password whose real
  value still authenticates, while ill-formed input for that account still fails. Raw
  oversized bytes never reach a native buffer.
- Absolute protocol caps (`ABSOLUTE_KDF_LIMITS`) bound memory, passes, parallelism, tag
  and salt length, and the verification path re-checks the *stored* verifier against
  those caps and against decoded salt/tag lengths before native allocation. A policy may
  lower these values, never raise them.
- Compatibility note: retained scrypt verification (N=32768, r=8, p=1) performs different
  work from the Argon2id dummy, so a legacy scrypt account's wrong-password timing
  differs from an unknown account until the successful upgrade replaces it. This is an
  accepted, documented ADR03 compatibility limit, bounded by the same admission gate.
- The policy version and parameters are documented constants; changing them is a
  reviewed policy change, not a per-tenant value.

### Throttling (`src/auth/rate-limit.mjs`)

- Storage is the append-only `auth.auth_audit` ledger: no schema change, no new grant.
  A scope is blocked when its recent failure rows reach the configured limit; a
  successful sign-in ends that scope's failure window.
- Each attempt takes a **session-scoped** advisory lock per scope on one leased client,
  writes a reservation (or denial) row in a short committed transaction, and keeps the
  lock until the whole attempt ends. Verification and the success transaction then run on
  that same leased client, so a correct login needs no second pool checkout and cannot
  deadlock a size-one pool or starve a saturated one. Deterministic tests cover eight
  simultaneous failures against a limit of three, a size-one pool success and saturated
  same-scope successes. This requires direct or session-pooling connections with a pinned
  backend; transaction pooling is refused at configuration time.
- Scopes are pseudonymous SHA-256 digests of the realm plus the normalised account and,
  optionally, a trusted ingress address. Raw emails and forwarded-header values are
  never stored. The ingress header is used only when a deployment explicitly names it
  (`trustedClientHeader`, for example behind the owner's tunnel/proxy); arbitrary
  `x-forwarded-for` values are ignored by default.
- Login and password-reset requests share the limiter, policy shape, ledger and audit
  event family. Responses are generic: a throttled known account, a throttled unknown
  account and a fresh unknown account are indistinguishable beyond their own attempt
  history. Throttled attempts are audited with `outcome = 'denied'` and do not extend
  the window.
- **Reservation and serialization.** An attempt first takes a session-scoped advisory
  lock for its scopes on one pooled client, then in a short committed transaction
  re-checks the budget and writes either a denial row or a reservation row carrying the
  post-lock order. Only after that commit may verification run. The scope lock is held
  until the attempt ends, so a waiting concurrent request cannot observe an unrecorded
  attempt or start KDF work early; a crash after the reservation leaves a durable counted
  attempt, and a crash before it leaves none. Successful rehash + session + success audit
  still commit atomically in their own transaction, and the success row's later order
  resets earlier reservations for that scope.
- **Accounting breaker.** If the reservation/denial row cannot be written, the limiter
  fails closed and opens a cooldown breaker; every request during the cooldown is refused
  before any KDF admission. Recovery is tested by advancing the clock past the cooldown
  with a healthy store.
- **Commit ambiguity.** A store commit whose acknowledgement is lost withholds all
  credentials, but it is not proof that no row exists; the ambiguity is documented rather
  than claimed as rollback.
- **Ordering.** Each accounted attempt records the application-clock time sampled
  *after* the scope lock together with `pg_current_xact_id()` sampled at the same point
  (`attempt_at`, `attempt_order` in the audit detail). Counters ignore PostgreSQL
  `occurred_at`, which is fixed at transaction start and can therefore order a delayed
  transaction before a success that actually committed first. Ordering is the serialized
  post-lock order; the transaction id resolves equal timestamps unambiguously. No
  append-only row is rewritten.
- **Exceptional attempts.** The reservation is committed before verification, so
  verification, rehash, session or success-audit failures cannot erase the attempt; only
  the success transaction rolls back, withholding the credential. There is no separate
  post-rollback accounting write. A lost reservation COMMIT or failed ROLLBACK destroys
  the leased client. If the audit store itself is unavailable, the request fails closed
  with `503 AUTH_ACCOUNTING_UNAVAILABLE` and a cooldown breaker refuses further requests
  before any KDF admission; the evidence limit is that an unwritable ledger cannot be
  durable, but work is not admitted without it.
- **Ingress.** The trusted header is default-off and must be named by deployment
  composition. One validated, canonical IP (IPv4 dotted decimal, IPv6 compressed via the
  URL parser) from that exact header feeds *every* consumer — the limiter scope for both
  login and reset, the session row and audit metadata. Invalid values yield no identity
  and therefore no network scope. Equivalent spellings of one address share a single
  budget. All socket-related headers
  (`cf-connecting-ip`, `x-forwarded-for`, `x-real-ip`, `forwarded`, …) are stripped from
  the request view handed to the audit writer otherwise, so an untrusted or malformed
  value can neither fail the failure audit nor be persisted. Naming a header is not proof
  that clients cannot forge it: a verified trusted-ingress contract is still required
  before enabling this in production.
- `RATE_LIMIT_DEFAULTS` (8 login failures / 5 reset requests per 15 minutes) are
  bootstrap values only. Neither these nor any test value are approved production
  policy; thresholds and the trusted-ingress header must come from trusted server
  composition, versioned and reviewed. The retained `createAuthServer` entry point does
  not yet forward that configuration — a narrow `server.mjs` contract is required before
  activation, and no deployment runtime upgrade is implied by this module. Audit-ledger
  scans on `detail_jsonb` are a Phase-1 design; indexed storage and measured load
  evidence need their own migration contract.
- `/v1/auth/forgot-password` exists solely to apply this shared policy: it answers `202`
  with a generic body, writes a `password_reset_requested` audit row marked
  `delivery: deferred_to_auth_005`, and creates no token or mail. AUTH-005 owns real
  recovery.

### Extension points

- A dedicated rate-limit table with an index (and per-tenant policy rows) is the
  expected optimisation; the audit ledger remains the durable fallback and the audit
  event family stays the same.
- New KDF schemes are added through the policy adapter boundary and must be bounded,
  versioned and covered by fail-closed tests.
- Thresholds, window lengths and trusted-ingress headers are deployment policy; they
  must never be inferred from request input.
- Session and token lists remain digest-only: no raw token is ever returned in an API
  payload or rendered in a UI (owner decision D-012).

## Multi-factor authentication (AUTH-004)

Tenant administrators and ultimate owners must complete TOTP assurance before an
authenticated session may reach anything beyond `/v1/auth/me`, `/v1/auth/logout` and the
MFA endpoints. The requirement is derived from current authority, not a role name in the
request: any active membership whose `auth.roles` row has `requires_mfa` marks the
identity as MFA-required.

### Routes

| Route | Method | Behaviour |
| --- | --- | --- |
| `/v1/auth/mfa` | GET | Factor status: required, enrolled, available, recovery codes remaining, current session assurance, pending flag. |
| `/v1/auth/mfa/enroll` | POST | Starts or restarts enrollment; returns the `otpauth://` URI. CSRF + origin required. Restarting invalidates outstanding recovery codes. |
| `/v1/auth/mfa/enroll/verify` | POST | Completes enrollment with a TOTP code, upgrades the session to `mfa_verified` and returns the one-time recovery codes. |
| `/v1/auth/mfa/verify` | POST | Login step-up with `{code}` or `{recoveryCode}`; upgrades the session to `mfa_verified`. |
| `/v1/auth/mfa/disable` | POST | Reauthentication with password plus a TOTP or recovery code; removes the verified factor and downgrades the session. |

Password login for a required identity always yields a **pending** session
(`assurance_level = single_factor`, `mfa.pending = true` in the response). The cookie is
issued so the challenge can be completed, but the pending session is refused elsewhere
with `403 MFA_REQUIRED`. Enrollment is therefore an "enrollment-only" state: an
unverified admin can enrol a factor and nothing else.

### Invariants

- TOTP seeds are 20 random bytes stored only as AES-256-GCM envelopes
  (`secret_ciphertext`, `secret_algorithm`, `secret_key_version`). Keys are injected by
  deployment composition; none are in the repository. Decryption uses the stored key
  version.
- Recovery codes are random base32 values shown once; the database stores only
  HMAC-SHA-256 digests with a key version. Consumption is one atomic conditional
  `UPDATE … WHERE used_at IS NULL`, so concurrent attempts yield exactly one success.
- Verification is RFC 6238 (HMAC-SHA1, 6 digits, 30 s period, ±1 step window) with
  constant-time comparison. A step is consumed through a conditional
  `last_used_step < step` update, so replaying a code — including concurrently — fails.
- Failed codes increment `failed_attempts`; reaching the configured limit sets
  `locked_until`. Failure counters are committed even though the request is refused.
- Disable requires password reauthentication **and** a current TOTP or recovery code.
  Disabling replaces the seed with a fresh unverified one, clears `verified_at`, and
  marks all outstanding recovery codes used; re-enrollment is required.
- No MFA bypass exists through alternate factors: the routes accept exactly `code` or
  `recoveryCode`; passkeys, social defaults and unknown fields are rejected. Cloud
  operator MFA remains delegated to validated Access/IdP assurance (AUTH-007), and no
  local operator factor is created here.
- Audit rows (`mfa_enrolled`, `mfa_verified`, `mfa_disabled`) never contain seeds,
  recovery codes or passwords.

### Configuration and fail-closed behaviour

`createMfaService` requires `keys: [{version, key: Buffer(32)}]` and a
`recoveryHashKey` (≥32 bytes), plus bounded digits/period/window/failure/lockout values.
These are deployment-controlled and versioned; no production numeric policy is approved
by this module. With no keys configured the service reports `available: false`, and a
password login for an MFA-required identity fails closed with `503 MFA_UNAVAILABLE`
instead of issuing a session. Non-required identities are unaffected.

### Extension points

- New factor types are new reference values plus a typed adapter; they must satisfy the
  same session-assurance rule and must never bypass required assurance.
- Key rotation: add a new versioned key and re-encrypt lazily; old versions stay
  readable until retired.
- AUTH-006 will bind selection to a verified membership; the conservative "any active
  MFA-required membership" rule then narrows to the selected membership.
- AUTH-007 owns operator Access assurance; this module intentionally has no operator
  password/TOTP path.
- Recovery-code reissue, trusted devices and notification policy are future contracts;
  no mail is sent here.
