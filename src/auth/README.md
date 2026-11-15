# `src/auth` — versioned PostgreSQL authentication boundary (AUTH-002)

Status: schema-backed auth service modules. Nothing here is imported by an active
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
