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
| `/v1/auth/mfa/enroll` | POST | Initial enrollment (empty body) only while no verified factor exists. Replacing a verified factor requires `password` plus a current `code`/`recoveryCode` in the same transaction; session assurance is never accepted as reauthentication. Durable per-user admission (lock check under the lifecycle locks) precedes any password/KDF or factor work, so a locked factor starts no derivation. Returns the `otpauth://` URI and audits started/replaced. |
| `/v1/auth/mfa/enroll/verify` | POST | Completes enrollment with a TOTP code, upgrades the session to `mfa_verified` and returns the one-time recovery codes. |
| `/v1/auth/mfa/verify` | POST | Login step-up with `{code}` or `{recoveryCode}`; upgrades the session to `mfa_verified`. |
| `/v1/auth/mfa/disable` | POST | Reauthentication with password plus a TOTP or recovery code; removes the verified factor and downgrades the session. |

Authority is resolved inside a transaction that first binds the verified server-side
principal to transaction-local `app.current_user_id`, so the accepted PIVOT-004/032
forced membership policies return that user's rows. The result is explicitly
`resolved` or not: an unresolved authority fails closed
(`MFA_AUTHORITY_UNAVAILABLE`) and is never treated as a verified non-required identity.
No client-supplied id, session-level `SET`, broad grant, superuser or RLS bypass is used.

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
  Disabling (and any authorized replacement) replaces the seed with a fresh unverified
  one, clears `verified_at`, marks all outstanding recovery codes used, and downgrades
  every live session for that user to `single_factor`; pending status also requires a
  currently verified factor, so a stale assurance label cannot outlive its factor.
- Lifecycle transitions lock the principal row and then the factor row in a fixed order
  (`users` → `two_factor` → `sessions`) inside one transaction, so concurrent
  verification, replacement and disable cannot resurrect an old seed. Session reads for
  mutations take no row lock; only the lifecycle transaction does.
- The common lifecycle authorization boundary revalidates the actual session inside the
  owned transaction **after** those locks are held: session id/user/realm, revocation,
  both expiries, active principal status and credential epoch. A session that was valid
  at the earlier non-transactional read but was revoked, expired, disabled or
  credential-rotated in between is refused before any reauthentication or factor
  mutation. The session row is read without a row lock (no opposing lock) and no nested
  pool checkout is taken, so this is safe on a size-one pool and does not reintroduce
  the session-row lock ordering that R1 removed.
- Replacement admission is ordered before derivation: the durable factor lock is checked
  under the lifecycle locks before `password.verify` runs, so a locked factor performs
  no password KDF and no TOTP/recovery step. Candidate password and factor proofs are
  both required, but they are evaluated only after admission; wrong-credential failure
  accounting still commits even though the request is refused.
- Durable failure policy covers enrollment completion, restart, TOTP verification,
  recovery codes and disable-password reauthentication. Counters increment atomically
  (`failed_attempts = failed_attempts + 1`) and are committed even when the request is
  refused; a pending restart never resets the counter or an active lock. Verification
  starts are bounded by the lock check, not merely by response shape.
- No MFA bypass exists through alternate factors: the routes accept exactly `code` or
  `recoveryCode`; passkeys, social defaults and unknown fields are rejected. Cloud
  operator MFA remains delegated to validated Access/IdP assurance (AUTH-007), and no
  local operator factor is created here.
- Audit rows (`mfa_enrolled`, `mfa_verified`, `mfa_disabled`) never contain seeds,
  recovery codes or passwords.

### Configuration and fail-closed behaviour

`createMfaService` requires unique versioned `keys: [{version, key: Buffer(32)}]` and
`recoveryKeys: [{version, key: Buffer(≥32)}]` with an existing active version, plus
bounded `secretBytes` (20–64), `recoveryCodeBytes` (10–32), digits/period/window/
failure/lockout values. Issued recovery rows record the real hash-key version; codes
issued under a retained version remain verifiable until that key is retired. TOTP
output is validated against the RFC 6238 appendix B vectors.
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

## Password reset and email verification (AUTH-005)

Password reset and email verification use single-use challenges in `auth.verification`.
Only a SHA-256 digest of a 32–64 byte random token is stored. A reset token is
`<random>.<credential-generation>`: the generation is covered by the digest and is
rechecked against the principal row under lock at consumption, so staleness never depends
on wall-clock ordering. The plaintext token exists only long enough to be handed to the
bounded delivery queue. Nothing here is wired into an active entry point.

### Routes

| Route | Method | Behaviour |
| --- | --- | --- |
| `/v1/auth/forgot-password` | POST | Retained AUTH-003 route. Always answers `202 {accepted:true}` with the shared throttle. With a mail adapter, an active known account gets a single-use reset link; unknown and inactive accounts get the identical response and no token. |
| `/v1/auth/reset-password` | POST | Consumes `{token, password}`. A cheap authoritative probe rejects invalid/stale tokens before any KDF; consumption then rechecks purpose, current address and credential generation under the principal lock, sets the new verifier, advances `credential_version` and revokes every live session as `password_reset` in one transaction. Returns `{ok:true, userId}` and no session. |
| `/v1/auth/email/verification/request` | POST | Session-authenticated and CSRF-checked. Revalidates the session/principal inside the owned transaction (revocation, expiry, status, credential epoch), applies a durable purpose/account/network issuance budget, then issues for the account's own current stored address. |
| `/v1/auth/email/verify` | POST | Public `{token}` consumption. Marks the account `email_verified`/`email_verified_at` only if the challenge's address still equals the account's current address. |

### Invariants

- Challenge rows are account-, purpose-, address- and expiry-bound. Issuance resolves the
  current active account and normalized email on its owned transaction under a principal
  lock; a caller's earlier snapshot is never trusted. Purposes are validated against the
  `token_purpose` reference domain both at issuance and again at consumption.
- Address binding is immutable: an old-address verification or reset challenge can never
  authorize a different current address. `consumeVerification` and `consumeReset` compare
  the stored identifier with the locked account's current normalized email before any
  mutation.
- Reset generation binding: the token carries the `auth.users.credential_version` in
  effect at issuance, covered by the stored digest. Consumption compares it with the
  generation under the principal row lock. A credential change that began earlier but
  committed later, an equal-time change, or any other generation advance invalidates the
  link; timestamps are never used to decide staleness.
- Consumption locks the row (`SELECT … FOR UPDATE`), re-checks `consumed_at IS NULL` and
  expiry, then conditionally consumes. Two concurrent consumers of one token yield exactly
  one success; a replay, expired or unknown token is refused generically.
- The reset transaction is all-or-nothing: consume, verifier replacement, credential-
  generation increment and revocation of every live session commit together. Audit or
  revocation failure rolls the whole change back, leaving the credential, token and
  sessions unchanged. Reset never changes roles, membership or owner authority and never
  grants MFA assurance.
- Non-enumeration: the forgot-password reservation and shared throttle ledger are
  retained. Known, unknown and inactive addresses return the same `202` body. Delivery is
  handed to a bounded in-process queue, so the public response and the throttle lease are
  never held for provider latency. A throttled or denied request sends no mail and creates
  no challenge.
- The delivery queue is bounded, drainable (`handler.mailDelivery.flush()`) and closable
  (`close()`); composition owns its lifecycle. There is no unmanaged fire-and-forget: the
  queue worker owns the in-memory token until delivery, counts failures and calls an
  invalidation callback. Cleanup is best effort — if invalidation fails, the challenge can
  remain live until its own expiry. That residual boundary is reported, not claimed as a
  guarantee.
- Verification mail admission is durable and purpose/account/network scoped: challenge
  rows are the budget, transaction-scoped advisory locks serialize concurrent requests,
  and denial returns `429 MAIL_THROTTLED` with `Retry-After`. Denied requests create no
  challenge and send no mail.
- Reset completion never starts a KDF for an invalid, expired, stale-address or
  stale-generation token: the authoritative probe runs first, and the consume rechecks
  the same conditions under lock.
- Mail is only possible through an explicitly injected transport. The adapter composes the
  links, never logs, and never surfaces a provider error (which could echo the token).
  With no adapter the forgot-password route keeps the AUTH-003 `deferred_to_auth_005`
  no-delivery behaviour instead of inventing an ad-hoc channel.
- Audit rows are append-only and never contain a token or password:
  `password_reset_requested` (reservation) and `password_reset_completed` (user id,
  purpose, revoked-session count, credential generation).

### Configuration and limits

`verificationTtlMs` (24 h) and `resetTtlMs` (30 min) are validated between one minute and
seven days; `tokenBytes` between 32 and 64; verification request admission defaults to five
issuances per hour per account and per network scope, bounded between one minute and 24
hours. These remain fixture/bootstrap values, not approved production policy.

### Extension points

- New challenge purposes are `auth.reference_value` rows plus a typed caller; they are not
  edits to a growing enum.
- Mail transports (SMTP, provider API, capture collector) are injected behind the adapter;
  no provider is hardcoded. The dispatcher can be replaced with another bounded,
  drainable delivery owner without changing the routes.
- Delivery retry, metrics and notification policy are future operations contracts; the
  durable challenge and audit rows and the bounded queue are the stable interface.

### Non-claims

- No SMTP/provider client, template system, UI or active entry-point wiring is delivered;
  deployment must inject a reviewed transport and base URL and own dispatcher shutdown.
- The canonical reference domain has no email-verification audit event, so this module
  does not invent one; adding it is a reference-data/migration change owned by AUTH-009.
  Challenge metadata is mutable operational state, not append-only event history.
- Cleanup of an undelivered challenge is best effort; a failed invalidation can leave a
  token live until expiry. No unconditional no-live-token guarantee is claimed.
- No session is issued by reset and no email address is changed by verification.
