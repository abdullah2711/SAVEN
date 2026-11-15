# Existing authentication audit

15 November 2026. Static source inspection at43dce30, not a penetration test, deployed inspection or gate execution. The supplied AUTH WORK refers to a Step1 audit template that is absent (MISSING); this complete control/disposition/evidence/required-work matrix supplies that missing structure. Every row is answered.

| Control | Disposition | Exact source evidence | Observed native state / missing scope | Required contract treatment |
| --- | --- | --- | --- | --- |
| Auth framework | REPLACE | src/local/runtime.mjs; package.json | Hand-written native runtime; no Better Auth dependency. | Introduce reviewed Better Auth adapter; pin version, preserve invariants. |
| Password verifier | KEEP | src/passwords.mjs | Bounded scrypt N32768/r8/p1, random salt, timingSafeEqual and dummy verifier. | Retain compatible verification; new Argon2id/versioned upgrade needs measured safe adapter. |
| Password input/KDF bounds | KEEP | src/passwords.mjs; src/local/runtime.mjs | Length/byte limits and at most2 concurrent derivations. | Preserve resource limits and negative tests. |
| Login rate control | REPLACE | src/local/runtime.mjs login; src/local/http.mjs /api/login | SQLite auth_limits;8 attempts/15 minutes keyed by realm/email/client; ingress field must be trustworthy. | PG durable configurable account/network throttles and verified ingress identity. |
| Opaque token generation | KEEP | src/local/runtime.mjs login; src/local/sqlite.mjs digest | 32 random bytes; only digest persisted. | Library adapter must retain SHA-256-at-rest token identity without plaintext fallback. |
| Session persistence | REPLACE | src/local/schema.mjs identity v2; runtime.session | Hashed token, realm, CSRF digest, credential version and eight-hour expiry in SQLite. | PG server-side lifecycle with30-day idle/90-day absolute ceilings and revocation epochs. |
| Idle/absolute expiry | REPLACE | src/local/runtime.mjs login/session | Eight-hour fixed expiry; separate idle/absolute fields MISSING. | Deterministic clock tests for both ceilings and refresh races. |
| Privilege-change rotation | REPLACE | src/local/runtime.mjs session; administration.mjs | Credential version checked; per-role selected-membership rotation MISSING. | Rotate/revoke on privilege, password, membership and assurance changes. |
| Logout | KEEP | src/local/runtime.mjs logout; http.mjs /api/logout | Deletes current hashed session and clears realm cookie. | Equivalent PG revoke semantics plus append-only event. |
| Cookie policy | REPLACE | src/local/http.mjs cookie helper | HttpOnly/Strict, Secure and __Host- over HTTPS; local cookie names isolated. | Retain security flags and realms; customer Lax/operator Strict; no domain sharing. |
| Origin/CSRF boundary | KEEP | src/local/http.mjs; src/local/transport.mjs | Exact app/operator origins and per-session hashed CSRF check. | Preserve across new versioned auth endpoints and callbacks. |
| Tenant selector/context | REPLACE | src/local/http.mjs tenant query; runtime.scope/businesses | Requested tenant query is policy-checked; verified selected membership is not stored in session. | AUTH-006 resolves server-side selected membership before transaction-local GUCs. |
| User attribution | KEEP | src/local/http.mjs actor=session.user_id | Actor derives from authenticated session; unknown mutation fields rejected on many commands. | Never copy client user/role to authority; preserve preparer/poster semantics. |
| Membership/resource authorization | KEEP | src/local/engine.mjs policy; runtime.scope | Central active membership intersects tenant grants/denies and company/branch/resources. | Port semantics with forced RLS as additional tenant isolation, not replacement. |
| Protected ultimate owner | KEEP | src/local/schema.mjs triggers; engine.transferOwner | Protected role, unique holder, existence/active checks and audited transfer. | Retain exactly-one-active-owner across PG transactions/concurrent changes. |
| Tenant administrator MFA | REPLACE | src/local/runtime.mjs; schema.mjs | MISSING in active native login. | Enforce enrollment/login/step-up, including passwordless entry; no rename bypass. |
| TOTP secrets/recovery codes | REPLACE | src/local/schema.mjs | MISSING in native schema. | Encrypted seeds; hash-only single-use recovery; safe re-enrollment/recovery. |
| Email verification | REPLACE | src/local/runtime.mjs createIdentity | Email syntax/uniqueness checked; ownership verification workflow MISSING. | Hash-stored expiring single-use verification and controlled mail adapter. |
| Password reset | REPLACE | src/local/runtime.mjs; src/security.mjs reference only | Native reset MISSING; retained reference supports authenticated password changes. | Non-enumerating token workflow, single use, revoke all sessions. |
| Complete auth audit | REPLACE | src/local/schema.mjs; src/security.mjs retained reference | Tenant/commercial audit exists; complete native auth event stream MISSING. | auth.auth_audit append-only, exact required event coverage, committed failed events. |
| Cloud operator login | REPLACE | runtime.login/requireOperator; schema.operator_staff/scopes | Local operator credential and scoped login currently active. | CF Access/IdP authentication with local authorization mapping; preserve until gated cutover. |
| CF Access JWT validation | REPLACE | src/local/http.mjs; native-gateway.mjs | MISSING in native application; tunnel presence is not JWT validation. | Configured signature/issuer/audience/time/subject and assurance checks, fail closed. |
| Access replay model | REPLACE | src/local/http.mjs | N/A ? greenfield Access exchange; no nonce exchange exists. | Reject one-time exchange replay and captured-token misuse; ordinary valid bearer reuse is not falsely rejected. |
| OIDC account/state schema | REPLACE | src/local/schema.mjs | MISSING provider accounts/state in native path. | Canonical accounts + oauth_state readiness only; no connector in Phase1. |
| Passkey support | REPLACE | src/local/schema.mjs; runtime.login | MISSING. | Optional plugin/schema contract; do not activate untested MFA bypass. |
| Private local auth | KEEP | docs/sources/SAVEN-mandate-v2.3.md; src/local/runtime.mjs | Local auth exists; full Private package acceptance incomplete. | Retain local/air-gapped independence; no forced CF Access in Private profile. |
| Cross-tenant support consent | REPLACE | src/local/runtime.mjs operator branch; v2.3 support contract | Scope checks exist; full named customer grant workflow incomplete. | Authenticated operator plus explicit current support grant and mediated audited reads; reason alone insufficient. |
| Auth change release/rollback | REPLACE | docs/CURRENT_HANDOFF.md; docs49 | Current source/deployment boundaries documented; PG/auth cutover not implemented. | Keep current SQLite/reference code/data; parity/RLS/restore/owner gates before change. |

Count: 28 controls; 19 REPLACE; 9 KEEP. Better Auth remains the default because the fewer-than-four REPLACE fallback condition is not met. KEEP means preserve reviewed behavior through a compatible adapter, not a claim that the existing implementation is a complete final auth system. Missing native features do not imply the retained PostgreSQL/reference stack never had related behavior.

## Auth-touching source inspection index

Source scanning covered login/session/password/MFA/tenant-selection/middleware references in tracked src, scripts, tests and contracts. Entries below are inspected source candidates; source presence is not executed-test evidence. No secret values or runtime records were read.

### src

- src/api.mjs
- src/assistant-provider.mjs
- src/auth.mjs
- src/commands.mjs
- src/edge-assistant.mjs
- src/local/administration.mjs
- src/local/http.mjs
- src/local/runtime.mjs
- src/local/schema.mjs
- src/native-gateway.mjs
- src/operating.mjs
- src/passwords.mjs
- src/security.mjs
- src/server-preview.mjs
- src/services.mjs
- src/tools.mjs

### scripts

- scripts/fixtures.mjs
- scripts/native-bootstrap.mjs
- scripts/native-demo.mjs
- scripts/native-probe-request.mjs
- scripts/native-ui-preview.mjs
- scripts/postgres-server.mjs
- scripts/postgres.mjs
- scripts/prepare-testing.mjs
- scripts/server.mjs
- scripts/verify-accounting-cycles.mjs
- scripts/verify-accounting-workspace.mjs
- scripts/verify-approval-conditions.mjs
- scripts/verify-approval-policies.mjs
- scripts/verify-assets.mjs
- scripts/verify-exports-evidence.mjs
- scripts/verify-import.mjs
- scripts/verify-invoice-taxes.mjs
- scripts/verify-native-administration.mjs
- scripts/verify-native-http.mjs
- scripts/verify-native-trade.mjs
- scripts/verify-opening.mjs
- scripts/verify-operating.mjs
- scripts/verify-party-accounting.mjs
- scripts/verify-payments.mjs
- scripts/verify-postgres.mjs
- scripts/verify-recurring.mjs
- scripts/verify-services.mjs

### tests

- tests/approval-conditions.test.mjs
- tests/edge-assistant.test.mjs
- tests/foundation.test.mjs
- tests/native-administration.test.mjs
- tests/native-corrections.test.mjs
- tests/native-documents.test.mjs
- tests/native-frontend.test.mjs
- tests/native-recovery.test.mjs
- tests/native-runtime.test.mjs
- tests/native-trade-credits.test.mjs
- tests/native-trade.test.mjs
- tests/security.test.mjs
- tests/tools.test.mjs
- tests/worker.test.mjs

### contracts

- contracts/control-domains-v1.json
- contracts/delivery-checklist.json
- contracts/origins-v1.json
- contracts/runtime-hosting-v1.json

## Audit interpretation and extension points

Passwords/KDFs, session handling and business permissions are separate adapter boundaries. Canonical identity remains auth.users/auth.tenant_membership; auth.roles assurance does not duplicate tenant financial roles. Additional providers/factors/configuration require typed registration and denial tests. Do not count a new library install as session-hash, absolute-expiry, MFA or RLS acceptance. Proposed implementation must prove those independently.

Sources: canonical AUTH constraints; docs/pivot-notes/03-adr-auth.md; source paths above. No tests or database gates were run, no auth library installed, no verification-evidence file produced and BUILD_STATE was not edited.
