-- AUTH-001: canonical identity, authentication and tenant-admission schema.
-- Run after 00-roles.sql with a connection that is a member of saven_migrator
-- (or a superuser). DDL objects are owned by saven_migrator, the offline DDL role.
-- This file contains no credentials, passwords, login principals or connection
-- strings, and applies no RLS policies (PIVOT-004 owns tenant RLS).
--
-- Scope: schema only. No login, session, MFA, recovery, connector or OIDC flow is
-- implemented or activated here, and the active native auth path is unchanged.
-- SQLite remains the production path until the retirement gate in
-- docs/pivot-notes/01-adr-postgresql-pivot.md is satisfied.

BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'saven_migrator') THEN
    RAISE EXCEPTION 'Run 00-roles.sql before 05-auth-schema.sql';
  END IF;
  IF NOT pg_has_role(current_user, 'saven_migrator', 'MEMBER') THEN
    RAISE EXCEPTION 'Run 05-auth-schema.sql as a member of saven_migrator';
  END IF;
END $$;

CREATE SCHEMA IF NOT EXISTS auth;
GRANT USAGE, CREATE ON SCHEMA auth TO saven_migrator;
ALTER SCHEMA auth OWNER TO saven_migrator;
SET LOCAL ROLE saven_migrator;

REVOKE ALL ON SCHEMA auth FROM PUBLIC;

COMMENT ON SCHEMA auth IS
  'Purpose-shared canonical identity, session, MFA and membership authority. Not vendor-only: Fully Private keeps this schema. No business financial data, no tenant RLS policies in AUTH-001.';

-- Growing auth domains live here rather than in CHECK lists or code.
-- New values are added as active/effective-dated rows without a migration.
CREATE TABLE IF NOT EXISTS auth.reference_value (
  domain text NOT NULL,
  value text NOT NULL,
  label text NOT NULL,
  description text NOT NULL DEFAULT '',
  is_active boolean NOT NULL DEFAULT true,
  effective_from timestamptz NOT NULL DEFAULT now(),
  effective_to timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (domain, value),
  CHECK (length(btrim(domain)) BETWEEN 1 AND 80),
  CHECK (length(btrim(value)) BETWEEN 1 AND 120),
  CHECK (length(btrim(label)) BETWEEN 1 AND 200),
  CHECK (length(description) <= 2000),
  CHECK (effective_to IS NULL OR effective_to > effective_from)
);
COMMENT ON TABLE auth.reference_value IS
  'Declared auth reference domains. Effective dates are declared data for future policy; this bootstrap does not enforce foreign-key lookups or an effective-dated policy engine.';

INSERT INTO auth.reference_value (domain, value, label, description) VALUES
  ('assurance_level', 'single_factor', 'Single factor', 'Password or equivalent first factor only.'),
  ('assurance_level', 'mfa_verified', 'MFA verified', 'A second factor was verified for this session.'),
  ('assurance_level', 'access_asserted', 'Access asserted', 'Cloud operator assurance is delegated to validated Cloudflare Access/IdP assertions; no local operator factor exists.'),
  ('membership_status', 'invited', 'Invited', 'Membership exists but is not yet an admission authority.'),
  ('membership_status', 'active', 'Active', 'Membership may admit the principal to the tenant.'),
  ('membership_status', 'suspended', 'Suspended', 'Membership is retained but admits nothing until reinstated.'),
  ('membership_status', 'revoked', 'Revoked', 'Membership is permanently withdrawn; history is retained.'),
  ('user_status', 'active', 'Active', 'Identity may authenticate.'),
  ('user_status', 'disabled', 'Disabled', 'Identity is retained but may not authenticate.'),
  ('realm', 'customer', 'Customer', 'Customer application realm (host-only cookie, SameSite=Lax).'),
  ('realm', 'operator', 'Operator', 'Operator realm (host-only cookie, SameSite=Strict, Access-asserted assurance).'),
  ('factor_type', 'totp', 'TOTP', 'Time-based one-time password with an encrypted recoverable seed.'),
  ('token_purpose', 'email_verification', 'Email verification', 'Proves ownership of an email address.'),
  ('token_purpose', 'password_reset', 'Password reset', 'Authorises a credential reset for one account.'),
  ('token_purpose', 'email_change', 'Email change', 'Proves ownership of a replacement email address.'),
  ('password_scheme', 'scrypt', 'scrypt', 'Retained existing native verifier format; bounded verification and upgrade-on-success.'),
  ('password_scheme', 'argon2id', 'Argon2id', 'Preferred verifier for newly set passwords.'),
  ('digest_algorithm', 'sha256', 'SHA-256', 'One-way digest for high-entropy opaque tokens.'),
  ('digest_algorithm', 'hmac_sha256', 'HMAC-SHA-256', 'Keyed one-way digest for lower-entropy codes; key version recorded per row.'),
  ('encryption_algorithm', 'aes_256_gcm', 'AES-256-GCM', 'Envelope encryption for recoverable secrets; key version recorded per row.'),
  ('session_revocation_reason', 'logout', 'Logout', 'The principal revoked this session.'),
  ('session_revocation_reason', 'privilege_change', 'Privilege change', 'Role, membership or assurance changed.'),
  ('session_revocation_reason', 'password_change', 'Password change', 'Credential changed; all prior sessions are invalidated.'),
  ('session_revocation_reason', 'password_reset', 'Password reset', 'Credential was reset; every session is invalidated.'),
  ('session_revocation_reason', 'admin_revoked', 'Administrator revoked', 'An authorised administrator revoked the session.'),
  ('session_revocation_reason', 'membership_revoked', 'Membership revoked', 'The selected membership was withdrawn.'),
  ('session_revocation_reason', 'expired_cleanup', 'Expired cleanup', 'Idle or absolute expiry was enforced.'),
  ('audit_outcome', 'success', 'Success', 'The audited action succeeded.'),
  ('audit_outcome', 'failure', 'Failure', 'The audited action failed and is independently committed.'),
  ('audit_outcome', 'denied', 'Denied', 'The audited action was refused by policy.'),
  ('auth_event_type', 'login_success', 'Login success', 'Credential or assertion login succeeded.'),
  ('auth_event_type', 'login_failure', 'Login failure', 'Login was refused; identity enumeration avoided.'),
  ('auth_event_type', 'logout', 'Logout', 'Session was revoked by the principal.'),
  ('auth_event_type', 'mfa_enrolled', 'MFA enrolled', 'A second factor was enrolled.'),
  ('auth_event_type', 'mfa_verified', 'MFA verified', 'A second factor was verified.'),
  ('auth_event_type', 'mfa_disabled', 'MFA disabled', 'A second factor was disabled after reauthentication.'),
  ('auth_event_type', 'password_changed', 'Password changed', 'An authenticated principal changed its password.'),
  ('auth_event_type', 'password_reset_requested', 'Password reset requested', 'A reset was requested without disclosing account existence.'),
  ('auth_event_type', 'password_reset_completed', 'Password reset completed', 'A single-use reset token was consumed.'),
  ('auth_event_type', 'session_revoked', 'Session revoked', 'One session was revoked.'),
  ('auth_event_type', 'sessions_revoked_all', 'All sessions revoked', 'Every session for the principal was revoked.'),
  ('auth_event_type', 'role_changed', 'Role changed', 'An assurance or business role assignment changed.'),
  ('auth_event_type', 'membership_invited', 'Membership invited', 'A tenant membership invitation was created.'),
  ('auth_event_type', 'membership_accepted', 'Membership accepted', 'A tenant membership invitation was accepted.'),
  ('account_provider', 'credential', 'Credential', 'Local password verifier. The verifier itself stays in auth.users.'),
  ('account_provider', 'generic_oauth', 'Generic OAuth', 'Reserved readiness for a configured OIDC/OAuth provider; no connector is built or enabled.'),
  ('oauth_state_purpose', 'login', 'Login', 'State row authorises one OAuth login exchange.'),
  ('oauth_state_purpose', 'link', 'Link', 'State row authorises one account-linking exchange.')
ON CONFLICT (domain, value) DO NOTHING;

-- Authentication-assurance classes only. Business/ERP roles and the protected
-- ultimate-owner business role remain tenant_data concerns (PIVOT-003+); custom
-- role names never gain protected authority through this table.
CREATE TABLE IF NOT EXISTS auth.roles (
  role_id text PRIMARY KEY,
  label text NOT NULL,
  assurance_class text NOT NULL DEFAULT 'single_factor',
  requires_mfa boolean NOT NULL DEFAULT false,
  is_operator boolean NOT NULL DEFAULT false,
  is_active boolean NOT NULL DEFAULT true,
  effective_from timestamptz NOT NULL DEFAULT now(),
  effective_to timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (length(btrim(role_id)) BETWEEN 1 AND 80),
  CHECK (length(btrim(label)) BETWEEN 1 AND 200),
  CHECK (length(btrim(assurance_class)) BETWEEN 1 AND 80),
  CHECK (effective_to IS NULL OR effective_to > effective_from)
);
COMMENT ON TABLE auth.roles IS
  'Authentication-assurance classes referenced by membership. Not the tenant business role catalogue: tenant_data.roles/assignments retain ERP permissions and the immutable ultimate-owner definition.';
COMMENT ON COLUMN auth.roles.assurance_class IS
  'Declared auth.reference_value domain (assurance_level). Application validation is deferred and not database-enforced in this bootstrap.';

INSERT INTO auth.roles (role_id, label, assurance_class, requires_mfa, is_operator) VALUES
  ('member', 'Member', 'single_factor', false, false),
  ('tenant_admin', 'Tenant administrator', 'mfa_verified', true, false),
  ('ultimate_owner', 'Ultimate owner', 'mfa_verified', true, false),
  ('operator_admin', 'Operator administrator', 'access_asserted', true, true)
ON CONFLICT (role_id) DO NOTHING;

-- Canonical identity. auth.users is the only user registry; operator.user_identity
-- is deliberately absent.
CREATE TABLE IF NOT EXISTS auth.users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  legacy_id text UNIQUE,
  email text NOT NULL,
  email_verified boolean NOT NULL DEFAULT false,
  email_verified_at timestamptz,
  name text,
  image text,
  status text NOT NULL DEFAULT 'active',
  password_hash text,
  password_scheme text,
  password_updated_at timestamptz,
  credential_version bigint NOT NULL DEFAULT 1,
  profile_jsonb jsonb NOT NULL DEFAULT '{}'::jsonb,
  profile_schema_version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by text,
  updated_by text,
  CHECK (length(btrim(email)) BETWEEN 3 AND 320),
  CHECK (length(btrim(status)) BETWEEN 1 AND 80),
  CHECK (name IS NULL OR length(name) <= 200),
  CHECK (image IS NULL OR length(image) <= 2048),
  CHECK (password_hash IS NULL OR length(password_hash) BETWEEN 16 AND 1024),
  CHECK (password_scheme IS NULL OR length(btrim(password_scheme)) BETWEEN 1 AND 80),
  CHECK ((password_hash IS NULL) = (password_scheme IS NULL)),
  CHECK (password_hash IS NULL OR password_updated_at IS NOT NULL),
  CHECK (credential_version > 0),
  CHECK (profile_schema_version > 0),
  CHECK (email_verified OR email_verified_at IS NULL),
  CHECK (email_verified_at IS NULL OR email_verified)
);
COMMENT ON TABLE auth.users IS
  'Canonical identity registry. users are global identities; tenant admission is auth.tenant_membership, never a column here.';
COMMENT ON COLUMN auth.users.legacy_id IS
  'Original native text identity id, preserved uniquely for migration mapping. Never cast existing text ids to uuid.';
COMMENT ON COLUMN auth.users.password_hash IS
  'Opaque, self-describing verifier (PHC-encoded). Retained bounded scrypt verifiers remain verifiable and are upgraded on success; Argon2id is preferred for new passwords. No plaintext password, reversible encoding or bcrypt is permitted.';
COMMENT ON COLUMN auth.users.password_scheme IS
  'Declared auth.reference_value domain (password_scheme). The adapter selects the verifier; the database stores no plaintext.';
COMMENT ON COLUMN auth.users.credential_version IS
  'Credential epoch. Sessions carry the epoch they were issued under; password/reset/privilege changes increment it and invalidate older sessions.';
COMMENT ON COLUMN auth.users.profile_jsonb IS
  'Versioned non-authoritative profile data bound to profile_schema_version; JSON-schema validation is deferred.';
CREATE UNIQUE INDEX IF NOT EXISTS users_email_lower_uidx ON auth.users (lower(email));
CREATE INDEX IF NOT EXISTS users_status_idx ON auth.users (status);
CREATE INDEX IF NOT EXISTS users_created_at_idx ON auth.users (created_at DESC);

-- External provider bindings. The local password verifier stays in auth.users so
-- there is exactly one credential authority per identity.
CREATE TABLE IF NOT EXISTS auth.accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  provider_id text NOT NULL,
  account_id text NOT NULL,
  is_primary boolean NOT NULL DEFAULT false,
  scope text,
  access_token_ciphertext text,
  refresh_token_ciphertext text,
  id_token_ciphertext text,
  token_algorithm text NOT NULL DEFAULT 'aes_256_gcm',
  token_key_version integer,
  access_token_expires_at timestamptz,
  refresh_token_expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by text,
  updated_by text,
  UNIQUE (provider_id, account_id),
  CHECK (length(btrim(provider_id)) BETWEEN 1 AND 120),
  CHECK (length(btrim(account_id)) BETWEEN 1 AND 320),
  CHECK (scope IS NULL OR length(scope) <= 2000),
  CHECK (length(btrim(token_algorithm)) BETWEEN 1 AND 80),
  CHECK (token_key_version IS NULL OR token_key_version > 0),
  CHECK (access_token_ciphertext IS NULL OR length(access_token_ciphertext) BETWEEN 16 AND 16384),
  CHECK (refresh_token_ciphertext IS NULL OR length(refresh_token_ciphertext) BETWEEN 16 AND 16384),
  CHECK (id_token_ciphertext IS NULL OR length(id_token_ciphertext) BETWEEN 16 AND 16384),
  CHECK (token_key_version IS NOT NULL OR (
    access_token_ciphertext IS NULL AND refresh_token_ciphertext IS NULL AND id_token_ciphertext IS NULL
  ))
);
COMMENT ON TABLE auth.accounts IS
  'Unique configured provider/subject binding (provider_id, account_id) to auth.users. Accounts are registry readiness only: no connector, provider credentials or auto-linking is enabled.';
COMMENT ON COLUMN auth.accounts.access_token_ciphertext IS
  'Provider tokens are stored only as envelope-encrypted ciphertext bound to token_key_version. Plaintext token columns are forbidden.';
COMMENT ON COLUMN auth.accounts.account_id IS
  'Provider subject claim. It is never a lookup key for authorisation; membership and assurance are resolved separately.';
CREATE INDEX IF NOT EXISTS accounts_user_idx ON auth.accounts (user_id);

-- Membership is the sole tenant-admission authority.
CREATE TABLE IF NOT EXISTS auth.tenant_membership (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  role_id text NOT NULL REFERENCES auth.roles(role_id) ON DELETE RESTRICT,
  status text NOT NULL DEFAULT 'invited',
  membership_epoch bigint NOT NULL DEFAULT 1,
  invited_at timestamptz,
  accepted_at timestamptz,
  suspended_at timestamptz,
  revoked_at timestamptz,
  invited_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by text,
  updated_by text,
  UNIQUE (tenant_id, user_id),
  CHECK (length(btrim(status)) BETWEEN 1 AND 80),
  CHECK (membership_epoch > 0),
  CHECK (accepted_at IS NULL OR invited_at IS NULL OR accepted_at >= invited_at)
);
COMMENT ON TABLE auth.tenant_membership IS
  'Sole tenant admission authority: tenant_id, user_id, role_id, status and invitation/acceptance timestamps. operator.tenant_membership and operator.user_identity are deliberately absent.';
COMMENT ON COLUMN auth.tenant_membership.tenant_id IS
  'Canonical tenant UUID matching operator.tenant.tenant_id by service contract. A profile-dependent foreign key is intentionally deferred (Fully Private omits vendor operator tables); composite business FKs belong to PIVOT-004. Never a client-supplied value.';
COMMENT ON COLUMN auth.tenant_membership.membership_epoch IS
  'Admission epoch. Selection binds the observed epoch; role/status changes increment it and invalidate stale selections.';
CREATE INDEX IF NOT EXISTS tenant_membership_tenant_status_idx ON auth.tenant_membership (tenant_id, status);
CREATE INDEX IF NOT EXISTS tenant_membership_user_status_idx ON auth.tenant_membership (user_id, status);

-- One session row per authenticated session. Only a SHA-256 digest of the opaque
-- token is persisted; the token itself never reaches this table or the logs.
CREATE TABLE IF NOT EXISTS auth.sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  token_hash text NOT NULL UNIQUE,
  token_digest_algorithm text NOT NULL DEFAULT 'sha256',
  realm text NOT NULL DEFAULT 'customer',
  role_id text REFERENCES auth.roles(role_id) ON DELETE RESTRICT,
  assurance_level text NOT NULL DEFAULT 'single_factor',
  mfa_verified_at timestamptz,
  selected_membership_id uuid REFERENCES auth.tenant_membership(id) ON DELETE RESTRICT,
  selected_tenant_id uuid,
  selected_role_id text,
  membership_epoch bigint,
  csrf_token_hash text,
  ip_address inet,
  user_agent text,
  credential_version bigint NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  idle_expires_at timestamptz NOT NULL,
  absolute_expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  revoked_reason text,
  revoked_by text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by text,
  updated_by text,
  CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  CHECK (csrf_token_hash IS NULL OR csrf_token_hash ~ '^[0-9a-f]{64}$'),
  CHECK (length(btrim(token_digest_algorithm)) BETWEEN 1 AND 80),
  CHECK (length(btrim(realm)) BETWEEN 1 AND 80),
  CHECK (length(btrim(assurance_level)) BETWEEN 1 AND 80),
  CHECK (revoked_reason IS NULL OR length(btrim(revoked_reason)) BETWEEN 1 AND 120),
  CHECK (user_agent IS NULL OR length(user_agent) <= 1000),
  CHECK (credential_version > 0),
  CHECK (membership_epoch IS NULL OR membership_epoch > 0),
  CHECK (absolute_expires_at > created_at),
  CHECK (idle_expires_at <= absolute_expires_at),
  CHECK (last_seen_at >= created_at),
  CHECK ((selected_tenant_id IS NULL) = (selected_membership_id IS NULL)),
  CHECK ((selected_tenant_id IS NULL) = (membership_epoch IS NULL))
);
COMMENT ON TABLE auth.sessions IS
  'Server-side session lifecycle. 30-day idle and 90-day absolute ceilings are enforced by the session service (AUTH-002); activity may extend idle_expires_at but never absolute_expires_at.';
COMMENT ON COLUMN auth.sessions.token_hash IS
  'SHA-256 hex digest of a high-entropy opaque token. Plaintext token storage is forbidden; a hex-64 CHECK cannot hold a base64url token.';
COMMENT ON COLUMN auth.sessions.selected_tenant_id IS
  'Verified selected tenant copied from auth.tenant_membership during selection (AUTH-006). It is never read from a client header, query or body.';
COMMENT ON COLUMN auth.sessions.absolute_expires_at IS
  'Absolute ceiling. Immutable after insert by trigger: refresh may move idle_expires_at only.';
CREATE INDEX IF NOT EXISTS sessions_user_created_idx ON auth.sessions (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS sessions_selected_tenant_idx ON auth.sessions (selected_tenant_id);
CREATE INDEX IF NOT EXISTS sessions_absolute_expiry_idx ON auth.sessions (absolute_expires_at);
CREATE INDEX IF NOT EXISTS sessions_revoked_idx ON auth.sessions (revoked_at);

CREATE TABLE IF NOT EXISTS auth.verification (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE RESTRICT,
  identifier text NOT NULL,
  purpose text NOT NULL,
  value_hash text NOT NULL,
  value_digest_algorithm text NOT NULL DEFAULT 'sha256',
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  attempt_count integer NOT NULL DEFAULT 0,
  request_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (length(btrim(identifier)) BETWEEN 1 AND 320),
  CHECK (length(btrim(purpose)) BETWEEN 1 AND 80),
  CHECK (value_hash ~ '^[0-9a-f]{64}$'),
  CHECK (length(btrim(value_digest_algorithm)) BETWEEN 1 AND 80),
  CHECK (expires_at > created_at),
  CHECK (attempt_count >= 0),
  CHECK (request_id IS NULL OR length(request_id) <= 200)
);
COMMENT ON TABLE auth.verification IS
  'Expiring, single-use email-verification and password-reset challenges. Only a digest is stored; consumption is one conditional UPDATE guarded by consumed_at IS NULL and expires_at > now().';
COMMENT ON COLUMN auth.verification.value_hash IS
  'SHA-256 hex digest of a random purpose/account-bound token. Forgotten flows must not store or log the plaintext token.';
CREATE INDEX IF NOT EXISTS verification_identifier_purpose_idx ON auth.verification (identifier, purpose, expires_at);
CREATE INDEX IF NOT EXISTS verification_user_idx ON auth.verification (user_id);

CREATE TABLE IF NOT EXISTS auth.two_factor (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  factor_type text NOT NULL DEFAULT 'totp',
  secret_ciphertext text NOT NULL,
  secret_algorithm text NOT NULL DEFAULT 'aes_256_gcm',
  secret_key_version integer NOT NULL,
  verified_at timestamptz,
  last_used_step bigint,
  failed_attempts integer NOT NULL DEFAULT 0,
  locked_until timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by text,
  updated_by text,
  UNIQUE (user_id, factor_type),
  CHECK (length(btrim(factor_type)) BETWEEN 1 AND 80),
  CHECK (length(secret_ciphertext) BETWEEN 16 AND 4096),
  CHECK (length(btrim(secret_algorithm)) BETWEEN 1 AND 80),
  CHECK (secret_key_version > 0),
  CHECK (last_used_step IS NULL OR last_used_step >= 0),
  CHECK (failed_attempts >= 0)
);
COMMENT ON TABLE auth.two_factor IS
  'Enrolled second factors. TOTP seeds are recoverable by design and therefore stored only as versioned envelope ciphertext under protected keys; one-way hashing a seed cannot verify TOTP.';
COMMENT ON COLUMN auth.two_factor.secret_ciphertext IS
  'Envelope-encrypted seed bound to secret_key_version and secret_algorithm. Plaintext seed columns are forbidden.';
COMMENT ON COLUMN auth.two_factor.last_used_step IS
  'Most recently accepted TOTP time step for replay refusal within the configured clock window.';
CREATE INDEX IF NOT EXISTS two_factor_user_idx ON auth.two_factor (user_id);

CREATE TABLE IF NOT EXISTS auth.recovery_codes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  code_hash text NOT NULL,
  hash_algorithm text NOT NULL DEFAULT 'hmac_sha256',
  hash_key_version integer NOT NULL,
  batch_id uuid NOT NULL DEFAULT gen_random_uuid(),
  used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, code_hash),
  CHECK (code_hash ~ '^[0-9a-f]{64}$'),
  CHECK (length(btrim(hash_algorithm)) BETWEEN 1 AND 80),
  CHECK (hash_key_version > 0)
);
COMMENT ON TABLE auth.recovery_codes IS
  'One-way hashed, atomically single-use MFA recovery codes. Re-enrolment issues a new batch; plaintext codes are never stored or logged.';
COMMENT ON COLUMN auth.recovery_codes.code_hash IS
  'Keyed (HMAC-SHA-256) or SHA-256 hex digest. Consumption is one conditional UPDATE guarded by used_at IS NULL.';
CREATE INDEX IF NOT EXISTS recovery_codes_user_used_idx ON auth.recovery_codes (user_id, used_at);

-- Append-only authentication audit. No foreign keys: unknown, failed and deleted
-- actors must remain auditable, and history must not move with business rows.
CREATE TABLE IF NOT EXISTS auth.auth_audit (
  id bigserial PRIMARY KEY,
  event_type text NOT NULL,
  outcome text NOT NULL DEFAULT 'success',
  occurred_at timestamptz NOT NULL DEFAULT now(),
  user_id uuid,
  actor_subject text,
  tenant_id uuid,
  realm text,
  role_id text,
  session_id text,
  request_id text,
  ip_address inet,
  user_agent text,
  detail_jsonb jsonb NOT NULL DEFAULT '{}'::jsonb,
  detail_schema_version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (length(btrim(event_type)) BETWEEN 1 AND 120),
  CHECK (length(btrim(outcome)) BETWEEN 1 AND 40),
  CHECK (actor_subject IS NULL OR length(actor_subject) <= 320),
  CHECK (realm IS NULL OR length(btrim(realm)) BETWEEN 1 AND 80),
  CHECK (role_id IS NULL OR length(btrim(role_id)) BETWEEN 1 AND 80),
  CHECK (session_id IS NULL OR length(session_id) <= 200),
  CHECK (request_id IS NULL OR length(request_id) <= 200),
  CHECK (user_agent IS NULL OR length(user_agent) <= 1000),
  CHECK (detail_schema_version > 0)
);
COMMENT ON TABLE auth.auth_audit IS
  'Append-only authentication event history. UPDATE, DELETE and TRUNCATE are refused by trigger for every role, including the owner. Failed events are independently committed; success transitions and their audit rows are written in one transaction. Never store secrets, tokens or passwords here.';
COMMENT ON COLUMN auth.auth_audit.user_id IS
  'Intentionally not a foreign key: failed logins for unknown or disabled identities must be recordable without inventing attribution.';
COMMENT ON COLUMN auth.auth_audit.detail_jsonb IS
  'Versioned redacted detail bound to detail_schema_version; JSON-schema validation and retention policy are deferred.';
CREATE INDEX IF NOT EXISTS auth_audit_occurred_idx ON auth.auth_audit (occurred_at DESC);
CREATE INDEX IF NOT EXISTS auth_audit_user_occurred_idx ON auth.auth_audit (user_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS auth_audit_tenant_occurred_idx ON auth.auth_audit (tenant_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS auth_audit_event_occurred_idx ON auth.auth_audit (event_type, occurred_at DESC);
CREATE INDEX IF NOT EXISTS auth_audit_session_idx ON auth.auth_audit (session_id);

-- OIDC/OAuth readiness only: no connector, provider credential or live exchange.
CREATE TABLE IF NOT EXISTS auth.oauth_state (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_id text NOT NULL,
  purpose text NOT NULL DEFAULT 'login',
  state_hash text NOT NULL UNIQUE,
  nonce_hash text,
  code_verifier_ciphertext text,
  code_verifier_key_version integer,
  redirect_uri text,
  link_user_id uuid REFERENCES auth.users(id) ON DELETE RESTRICT,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  request_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (length(btrim(provider_id)) BETWEEN 1 AND 120),
  CHECK (length(btrim(purpose)) BETWEEN 1 AND 80),
  CHECK (state_hash ~ '^[0-9a-f]{64}$'),
  CHECK (nonce_hash IS NULL OR nonce_hash ~ '^[0-9a-f]{64}$'),
  CHECK (code_verifier_ciphertext IS NULL OR length(code_verifier_ciphertext) BETWEEN 16 AND 4096),
  CHECK (code_verifier_ciphertext IS NULL OR code_verifier_key_version > 0),
  CHECK (redirect_uri IS NULL OR length(redirect_uri) <= 2048),
  CHECK (expires_at > created_at),
  CHECK (request_id IS NULL OR length(request_id) <= 200)
);
COMMENT ON TABLE auth.oauth_state IS
  'Expiring, single-use OAuth state/nonce/PKCE readiness. No provider is configured or contacted in AUTH-001; activation requires a later contract two-party contract and issuer allowlist.';
COMMENT ON COLUMN auth.oauth_state.state_hash IS
  'SHA-256 hex digest of the state value; the raw state never returns to the database. Consumption is one conditional UPDATE.';
CREATE INDEX IF NOT EXISTS oauth_state_provider_expiry_idx ON auth.oauth_state (provider_id, expires_at);
CREATE INDEX IF NOT EXISTS oauth_state_link_user_idx ON auth.oauth_state (link_user_id);

CREATE OR REPLACE FUNCTION auth.touch_updated_at() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION auth.reject_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'AUTH_RECORD_IMMUTABLE';
END;
$$;

-- The absolute session ceiling can never be extended, not even by the owner.
CREATE OR REPLACE FUNCTION auth.reject_absolute_expiry_change() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.absolute_expires_at IS DISTINCT FROM OLD.absolute_expires_at THEN
    RAISE EXCEPTION 'AUTH_SESSION_ABSOLUTE_EXPIRY_IMMUTABLE';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS reference_value_touch_updated_at ON auth.reference_value;
CREATE TRIGGER reference_value_touch_updated_at BEFORE UPDATE ON auth.reference_value
  FOR EACH ROW EXECUTE FUNCTION auth.touch_updated_at();

DROP TRIGGER IF EXISTS roles_touch_updated_at ON auth.roles;
CREATE TRIGGER roles_touch_updated_at BEFORE UPDATE ON auth.roles
  FOR EACH ROW EXECUTE FUNCTION auth.touch_updated_at();

DROP TRIGGER IF EXISTS users_touch_updated_at ON auth.users;
CREATE TRIGGER users_touch_updated_at BEFORE UPDATE ON auth.users
  FOR EACH ROW EXECUTE FUNCTION auth.touch_updated_at();

DROP TRIGGER IF EXISTS accounts_touch_updated_at ON auth.accounts;
CREATE TRIGGER accounts_touch_updated_at BEFORE UPDATE ON auth.accounts
  FOR EACH ROW EXECUTE FUNCTION auth.touch_updated_at();

DROP TRIGGER IF EXISTS tenant_membership_touch_updated_at ON auth.tenant_membership;
CREATE TRIGGER tenant_membership_touch_updated_at BEFORE UPDATE ON auth.tenant_membership
  FOR EACH ROW EXECUTE FUNCTION auth.touch_updated_at();

DROP TRIGGER IF EXISTS sessions_touch_updated_at ON auth.sessions;
CREATE TRIGGER sessions_touch_updated_at BEFORE UPDATE ON auth.sessions
  FOR EACH ROW EXECUTE FUNCTION auth.touch_updated_at();

DROP TRIGGER IF EXISTS sessions_absolute_expiry_guard ON auth.sessions;
CREATE TRIGGER sessions_absolute_expiry_guard BEFORE UPDATE ON auth.sessions
  FOR EACH ROW EXECUTE FUNCTION auth.reject_absolute_expiry_change();

DROP TRIGGER IF EXISTS verification_touch_updated_at ON auth.verification;
CREATE TRIGGER verification_touch_updated_at BEFORE UPDATE ON auth.verification
  FOR EACH ROW EXECUTE FUNCTION auth.touch_updated_at();

DROP TRIGGER IF EXISTS two_factor_touch_updated_at ON auth.two_factor;
CREATE TRIGGER two_factor_touch_updated_at BEFORE UPDATE ON auth.two_factor
  FOR EACH ROW EXECUTE FUNCTION auth.touch_updated_at();

DROP TRIGGER IF EXISTS recovery_codes_touch_updated_at ON auth.recovery_codes;
CREATE TRIGGER recovery_codes_touch_updated_at BEFORE UPDATE ON auth.recovery_codes
  FOR EACH ROW EXECUTE FUNCTION auth.touch_updated_at();

DROP TRIGGER IF EXISTS oauth_state_touch_updated_at ON auth.oauth_state;
CREATE TRIGGER oauth_state_touch_updated_at BEFORE UPDATE ON auth.oauth_state
  FOR EACH ROW EXECUTE FUNCTION auth.touch_updated_at();

DROP TRIGGER IF EXISTS auth_audit_no_update ON auth.auth_audit;
CREATE TRIGGER auth_audit_no_update BEFORE UPDATE OR DELETE ON auth.auth_audit
  FOR EACH ROW EXECUTE FUNCTION auth.reject_mutation();

DROP TRIGGER IF EXISTS auth_audit_no_truncate ON auth.auth_audit;
CREATE TRIGGER auth_audit_no_truncate BEFORE TRUNCATE ON auth.auth_audit
  FOR EACH STATEMENT EXECUTE FUNCTION auth.reject_mutation();

REVOKE ALL ON SCHEMA auth FROM PUBLIC;
REVOKE ALL ON ALL TABLES IN SCHEMA auth FROM PUBLIC;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA auth FROM PUBLIC;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA auth FROM PUBLIC;

-- Customer application and operator roles get no direct auth.* authority. Tenant
-- selection is resolved through restricted auth-service/definer interfaces; the
-- customer app never reads identity or membership tables directly.
REVOKE ALL ON SCHEMA auth FROM
  saven_customer_app, saven_operator_read, saven_operator_admin, saven_operator_definer;
REVOKE ALL ON ALL TABLES IN SCHEMA auth FROM
  saven_customer_app, saven_operator_read, saven_operator_admin, saven_operator_definer;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA auth FROM
  saven_customer_app, saven_operator_read, saven_operator_admin, saven_operator_definer;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA auth FROM
  saven_customer_app, saven_operator_read, saven_operator_admin, saven_operator_definer;

-- Narrow shared-auth service: operational lifecycle only. No DELETE anywhere, and
-- the append-only audit accepts INSERT/SELECT only.
GRANT USAGE ON SCHEMA auth TO saven_auth_service, saven_auth_definer;
GRANT SELECT, INSERT, UPDATE ON
  auth.users,
  auth.accounts,
  auth.tenant_membership,
  auth.sessions,
  auth.verification,
  auth.two_factor,
  auth.recovery_codes,
  auth.oauth_state
TO saven_auth_service;
GRANT SELECT ON auth.roles, auth.reference_value TO saven_auth_service;
GRANT SELECT, INSERT ON auth.auth_audit TO saven_auth_service;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA auth TO saven_auth_service;

-- Definer owner: read-only resolution interface plus append-only audit. Added
-- write privileges require an explicit reviewed grant in a later contract.
GRANT SELECT ON ALL TABLES IN SCHEMA auth TO saven_auth_definer;
GRANT INSERT ON auth.auth_audit TO saven_auth_definer;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA auth TO saven_auth_definer;

-- Extension points (AUTH-001):
-- * Add assurance classes, membership statuses, audit event types, purposes and
--   algorithms as auth.reference_value rows with is_active and effective dates;
--   growing domains are never added as CHECK lists or code constants.
-- * Add auth.roles rows for new authentication-assurance classes. Business roles
--   and the immutable ultimate-owner definition remain tenant_data concerns.
-- * Add providers/factors as reference rows plus typed tables; no connector,
--   provider credential or passkey activation is authorised by this schema alone.
-- * Versioned JSON payloads (users.profile_jsonb, auth_audit.detail_jsonb) are
--   bound to schema-version columns; JSON-schema validation is deferred.
-- * Effective-dated session/rate/MFA policy is future policy data; the database
--   enforces structure and append-only guarantees, not per-tenant business rules.
-- * A tenant foreign key is deliberately not created here: Fully Private omits
--   vendor operator tables and composite business FKs belong to PIVOT-004.

COMMIT;
