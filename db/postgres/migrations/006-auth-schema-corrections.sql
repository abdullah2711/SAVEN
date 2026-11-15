-- AUTH-001-R1: additive correction to the canonical auth schema.
-- Run after 05-auth-schema.sql with a connection that is a member of saven_migrator
-- (or a superuser). DDL objects are owned by saven_migrator, the offline DDL role.
--
-- Purpose: close the nullable PKCE key-binding gap on auth.oauth_state. The original
-- 05 file is preserved byte-for-byte; this correction adds one named constraint and
-- validates it. Adding the constraint NOT VALID followed by VALIDATE means existing
-- invalid rows cause an explicit validation failure instead of being repaired or
-- silently skipped. No grant, revoke, trigger, policy, column or data change occurs.

BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'saven_migrator') THEN
    RAISE EXCEPTION 'Run 00-roles.sql before 006-auth-schema-corrections.sql';
  END IF;
  IF NOT pg_has_role(current_user, 'saven_migrator', 'MEMBER') THEN
    RAISE EXCEPTION 'Run 006-auth-schema-corrections.sql as a member of saven_migrator';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'auth') THEN
    RAISE EXCEPTION 'Run 05-auth-schema.sql before 006-auth-schema-corrections.sql';
  END IF;
END $$;

SET LOCAL ROLE saven_migrator;

-- Versioned-encryption convention: a ciphertext may exist only with a positive key
-- version. The original CHECK was TRUE-or-NULL when the key version was NULL, so a
-- ciphertext with no key binding satisfied it. This named constraint is null-safe.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'oauth_state_pkce_key_binding_chk'
      AND conrelid = 'auth.oauth_state'::regclass
  ) THEN
    ALTER TABLE auth.oauth_state
      ADD CONSTRAINT oauth_state_pkce_key_binding_chk
      CHECK (code_verifier_ciphertext IS NULL OR (
               code_verifier_key_version IS NOT NULL AND code_verifier_key_version > 0))
      NOT VALID;
  END IF;
END $$;

-- Refuse invalid pre-existing rows; never repair them in place.
ALTER TABLE auth.oauth_state VALIDATE CONSTRAINT oauth_state_pkce_key_binding_chk;

COMMENT ON CONSTRAINT oauth_state_pkce_key_binding_chk ON auth.oauth_state IS
  'AUTH-001-R1: a PKCE code-verifier ciphertext requires a non-null positive key version. NULL key versions are rejected even though PostgreSQL CHECK treats UNKNOWN as satisfied.';

COMMIT;
