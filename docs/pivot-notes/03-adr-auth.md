# ADR: canonical identity, authentication and tenant context

Status: Proposed
Date: 15 November 2026 (Asia/Karachi)
Scope: AUTH-001..010 design only. No library, login, database, deployment or client data changes occur in this session. Read ADR01 and the three-purpose inventory with this decision.

## Library decision and plugin scope

Better Auth is the default target. The existing native path has at least four REPLACE controls; item8 records the count, so the fewer-than-four exception for hand-written oslo/password + oslo/otp is not met. Lucia is excluded. Pin a supported production version after reviewing official documentation, runtime compatibility, licence and advisories; no version is installed or asserted verified here.

Planned modules: core database sessions, two-factor/TOTP, optional passkey, and generic-oauth schema/readiness. Sessions are a core facility, not an invented plugin. No OIDC connector, provider credentials or automatic enrollment is enabled in Phase1. Passwordless/passkey methods cannot bypass required admin assurance. Defaults incompatible with hash-only session storage, absolute expiry, linking restrictions or revocation require a tested adapter. No authentication plugin grants financial roles.

## Identity table ownership

auth.users is canonical. auth.accounts uniquely binds configured provider_id/account_id to user_id. auth.tenant_membership is the sole admission authority and carries tenant_id, user_id, role_id, status, invited_at and accepted_at. Do not create operator.user_identity or operator.tenant_membership. Superseded/dropped means omitted from the target, not destructive DROP of source data. operator.tenant remains the subscriber directory; entitlement/placement references do not make another identity registry.

auth.roles contains authentication-assurance classes. tenant_data.roles/assignments retain custom ERP permissions and protected ultimate ownership. Existing tenant_data.members is a business-principal restriction/projection, not a second admission service. Effective access intersects active membership, active business principal, entitlement, owner invariants, grants/denies, company/branch/resource/field/amount conditions and approval. Private identity stays local.

Retain historical text user/document ids unless an explicit mapping is reviewed. UUID tenant ids require a unique preserved legacy-id mapping. Composite tenant/company/branch keys prevent cross-tenant references. Library-required columns are additive and versioned; original financial/audit source bytes remain unchanged.

## Sessions and request boundaries

PG server-side sessions use high-entropy opaque tokens with SHA-256 token digests at rest. Store creation/activity, idle and absolute expiry, revocation/credential epochs, MFA assurance and verified selected membership. Enforce30-day idle and90-day absolute ceilings server-side; activity never extends the absolute ceiling. Rotate on privilege change/reauthentication; reset revokes all sessions. Existing eight-hour native sessions are not silently promoted. Disable cookie-cache-only authority and prove adapter token lookup/create/update never stores plaintext tokens.

Cookies are host-only HttpOnly, Secure on HTTPS, customer SameSite=Lax and operator Strict, __Host- prefix with Path=/ and no Domain. Local HTTP fixtures have a separate explicit nonproduction name. Retain exact realm/origin allowlists, CSRF and callback state/nonce/PKCE. No client user id, role or tenant field becomes authority. Secrets never appear in URLs, errors or logs.

## Passwords and recovery

Prefer versioned Argon2id for new verifiers; retain bounded scrypt verification and upgrade-on-success. No bcrypt adoption, plaintext migration or silent reset. Bound inputs/KDF concurrency; use timing-safe library verification and a dummy unknown-user verifier. Typed effective-dated rate policy covers account plus trusted-ingress network scope; do not trust arbitrary forwarding headers. Fixture8-attempt/15-minute limits are proposed test values, not approved universal production policy. Public errors avoid identity enumeration.

Verification/reset tokens are random, hash-stored, purpose/account-bound, expiring and atomically single-use. Fixture TTLs24 hours verification/30 minutes reset are proposed configurable values requiring review before production. Reset updates credential/auth epochs and invalidates every session. Mail is an adapter; this session sends nothing. Recovery cannot bypass sole-owner controls.

## MFA and operator identity

Tenant admin/ultimate-owner login and sensitive elevation require TOTP with recovery capability. An unenrolled administrator gets enrollment-only access. Role naming cannot evade assurance checks. Encrypt recoverable TOTP seeds under protected versioned keys; one-way hashing a seed cannot support TOTP verification. Recovery codes are one-way hashed and atomically single-use. Factor disable/re-enrollment requires reauthentication and an allowed existing factor, audit/notification, bounded retries/clock window and race/replay tests. All enabled login methods must enforce the requirement, regardless of plugin defaults.

Cloud ops.* uses Cloudflare Access/approved IdP for authentication and mandatory MFA assurance. Validate signed application JWT, configured issuer/algorithm/trusted keys, audience/time and active authorized subject mapping. SAVEN stores no Cloud operator password or local operator TOTP secret. A valid JWT alone does not prove MFA; require supported assurance binding and reviewed deployment policy evidence. Never fetch keys from an attacker-controlled iss URL. Fully Private local administration remains operable without Cloudflare/internet.

Normal Access bearer reuse differs from attack replay. AUTH-007 tests wrong audience/realm/subject, revoked mapping, stale assurance and replayed one-time exchange nonce. An exchange challenge can be single-use; ordinary bearer validation cannot promise prevention of all captured-token reuse. Break-glass is separately authorized IdP/Access recovery, not a SAVEN backdoor.

## Tenant context and least privilege

The selector requests membership; only server validation against the active authenticated session and canonical membership binds selected tenant and membership epoch in session state. Never copy raw tenant_id/user_id header/query/body into PG context. URL/subdomain values are also untrusted until resolved. Reject mismatched/revoked selection before business access. Customer role has zero operator.* privileges. Preselection auth uses restricted auth-service/definer interfaces, never operator-admin rights.

Acquire one client/transaction, then parameterized set_config('app.current_tenant_id',verifiedTenant,true) and set_config('app.current_user_id',verifiedUser,true) on that client. Handler queries share it; session SET and outside-transaction pool.query are forbidden. Missing context denies reads/writes; commit/rollback/pool reuse cannot leak context. Forced RLS complements company/resource/field/approval policy, not parameterization or service-credential protection. No raw-SQL API.

## OIDC readiness and linking

Create accounts and oauth_state now, but no connector in Phase1. Later validate configured issuer/provider and subject, signature/audience, nonce/state, PKCE and email evidence. Owner-requested verified-email matching applies only to explicitly trusted authoritative issuers, uniqueness and audited policy; privileged accounts require reauthentication/approval before merge. No arbitrary-provider same-email takeover. email_verified comes from validated claims, never a client flag. State is expiring/single-use; connector activation needs a later contract.

## Audit and AI constraints

Append auth.auth_audit events for login success/failure, logout, MFA enrolled/verified/disabled, password changed, reset requested/completed, one/all sessions revoked, role changed and membership invited/accepted. Record verified actor/subject where known, tenant/realm/request/version and outcome without secrets or invented attribution. Success transitions/audit are atomic; failed events need independently committed failure audit rather than rollback loss. Business audit/outbox and operator.operator_audit keep distinct authority.

AI has no direct DB role. Document proposals are ordinary document records with origin_type/user/model/version and pending_approval status, never an ai_proposal silo or premature GL rows. AI always starts pending in Phase1; ai_origin_direct_post_allowed remains false. Human and AI proposals share threshold/independence policy: permitted self-approval differs from direct AI posting. Authorized pending edits preserve revisions/diffs, invalidate old approval digests and bind posting to the reviewed revision. Posted bytes remain immutable. Only non-document suggestions use a separate first-class suggestion object. No vector store in Phase1.

## Acceptance and extension points

AUTH-001/002 precede AUTH-006; AUTH-006 gates all business feature shipping and parity. Native/reference auth remains unchanged here. Future providers/factors use versioned interfaces/reference data and safe flags; none bypass membership, assurance or owner invariants. Identity ownership, session ceilings, linking authority, operator fallback, MFA/recovery or direct-post changes need an ADR/policy revision and regression evidence. Compatible effective-dated settings may evolve without rewriting history.

Official sources checked15 November2026: https://better-auth.com/docs/concepts/database ; https://better-auth.com/docs/concepts/session-management ; https://better-auth.com/docs/concepts/users-accounts ; https://better-auth.com/docs/plugins/2fa ; https://better-auth.com/docs/reference/security ; https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/validating-json/ . Recheck against the pinned version. No verification gates were executed in this session.
