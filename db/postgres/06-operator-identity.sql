-- AUTH-007 operator identity mapping and one-time Access exchange ledger.
--
-- Cloud operator authentication is delegated to a validated Cloudflare Access/approved IdP
-- assertion. SAVEN stores no Cloud operator password and no local operator TOTP secret.
-- This file adds:
--   * a scoped local subject mapping (Access subject -> local auth identity + operator role);
--   * a one-time exchange-nonce ledger so an assertion exchange cannot be replayed.
--
-- Additive and administrator-applied as one transaction. No table/column change to the
-- existing auth/operator schemas, no RLS change, no runtime superuser/BYPASSRLS/ownership.

BEGIN;

SET LOCAL ROLE saven_migrator;

CREATE TABLE IF NOT EXISTS operator.access_identity (
  subject text PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  email text NOT NULL,
  display_name text,
  operator_role_id text NOT NULL REFERENCES auth.roles(role_id) ON DELETE RESTRICT,
  assurance_class text NOT NULL,
  status text NOT NULL DEFAULT 'active',
  effective_from timestamptz NOT NULL DEFAULT now(),
  effective_to timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by text,
  updated_by text,
  CHECK (length(btrim(subject)) BETWEEN 1 AND 320),
  CHECK (length(btrim(email)) BETWEEN 3 AND 320),
  CHECK (length(btrim(operator_role_id)) BETWEEN 1 AND 80),
  CHECK (length(btrim(assurance_class)) BETWEEN 1 AND 80),
  CHECK (length(btrim(status)) BETWEEN 1 AND 80),
  CHECK (effective_to IS NULL OR effective_to > effective_from)
);

COMMENT ON TABLE operator.access_identity IS
  'AUTH-007 scoped Cloud operator subject mapping. Explicit per-subject rows only; no wildcard/universal support access. References a local auth identity with no Cloud operator password/TOTP.';
COMMENT ON COLUMN operator.access_identity.user_id IS
  'Local auth identity used for operator session/credential-epoch bookkeeping; never a client-supplied user id.';
COMMENT ON COLUMN operator.access_identity.operator_role_id IS
  'auth.roles operator role (is_operator = true). Custom role names grant no operator authority.';
COMMENT ON COLUMN operator.access_identity.assurance_class IS
  'Required Access/IdP assurance class (for example access_mfa). Deployment policy must emit the matching verified claim.';

CREATE TABLE IF NOT EXISTS operator.access_exchange (
  nonce_hash text PRIMARY KEY,
  subject text NOT NULL,
  token_expires_at timestamptz NOT NULL,
  consumed_at timestamptz NOT NULL DEFAULT now(),
  request_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (nonce_hash ~ '^[0-9a-f]{64}$'),
  CHECK (length(btrim(subject)) BETWEEN 1 AND 320),
  CHECK (length(btrim(request_id)) <= 200 OR request_id IS NULL)
);

COMMENT ON TABLE operator.access_exchange IS
  'AUTH-007 one-time Access assertion exchange ledger. Stores only a SHA-256 nonce/assertion digest, never the raw token. INSERT-once; a conflict is a replay refusal.';
COMMENT ON COLUMN operator.access_exchange.nonce_hash IS
  'SHA-256 of the Access identity_nonce (or the assertion when no nonce is present). Raw bearer assertions are never retained.';

CREATE INDEX IF NOT EXISTS access_exchange_subject_idx
  ON operator.access_exchange (subject, consumed_at);

REVOKE ALL ON operator.access_identity, operator.access_exchange FROM PUBLIC;

GRANT USAGE ON SCHEMA operator TO saven_auth_service;
GRANT SELECT ON operator.access_identity TO saven_auth_service;
GRANT SELECT, INSERT ON operator.access_exchange TO saven_auth_service;

GRANT SELECT ON operator.access_identity, operator.access_exchange
  TO saven_operator_read, saven_operator_admin;

COMMIT;
