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
  back. Failed-login audit is a separate autocommit statement so a refused attempt is
  still recorded.
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
  `429 PASSWORD_BUSY` rather than queued without bound.
- The policy version and parameters are documented constants; changing them is a
  reviewed policy change, not a per-tenant value.

### Throttling (`src/auth/rate-limit.mjs`)

- Storage is the append-only `auth.auth_audit` ledger: no schema change, no new grant.
  A scope is blocked when its recent failure rows reach the configured limit; a
  successful sign-in ends that scope's failure window.
- Each attempt takes a transaction-scoped advisory lock per scope, checks the count and
  writes the attempt row in the same transaction, so a concurrent burst cannot exceed
  the configured number of evaluated attempts. Deterministic tests cover eight
  simultaneous failures against a limit of three.
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
- `RATE_LIMIT_DEFAULTS` (8 login failures / 5 reset requests per 15 minutes) are
  bootstrap values only. The contract explicitly does not approve the fixture's
  eight/15-minutes value as production policy; deployments must set reviewed limits.
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
