-- AUTH-007 operator identity mapping, session binding and one-time Access exchange ledger.
--
-- Cloud operator authentication is delegated to a validated Cloudflare Access/approved IdP
-- assertion. SAVEN stores no Cloud operator password and no local operator TOTP secret.
-- This file adds:
--   * a scoped local subject mapping (Access subject -> local auth identity + operator role)
--     with a mapping epoch;
--   * a session binding recording the exact verified assertion/mapping authority;
--   * a one-time exchange-nonce ledger so an assertion exchange cannot be replayed.
--
-- Requires AUTH-006 migration 033 (the shared authority gate). Mapping writers take that
-- gate exclusively through BEFORE STATEMENT triggers; exchange and subsequent operator
-- admission hold it shared. Additive and administrator-applied as one transaction.

BEGIN;

SET LOCAL ROLE saven_migrator;

-- Non-reusable mapping generation. The sequence is never reset or reused, so a deleted and
-- recreated subject cannot resurrect a binding made for an earlier incarnation.
CREATE SEQUENCE IF NOT EXISTS operator.access_identity_generation_seq AS bigint START WITH 1;

CREATE TABLE IF NOT EXISTS operator.access_identity (
  subject text PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  email text NOT NULL,
  display_name text,
  operator_role_id text NOT NULL REFERENCES auth.roles(role_id) ON DELETE RESTRICT,
  assurance_class text NOT NULL,
  status text NOT NULL DEFAULT 'active',
  mapping_epoch bigint NOT NULL DEFAULT nextval('operator.access_identity_generation_seq'),
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
  CHECK (mapping_epoch > 0),
  CHECK (effective_to IS NULL OR effective_to > effective_from)
);

COMMENT ON TABLE operator.access_identity IS
  'AUTH-007 scoped Cloud operator subject mapping. Explicit per-subject rows only; no wildcard/universal support access. References a local auth identity with no Cloud operator password/TOTP.';
COMMENT ON COLUMN operator.access_identity.user_id IS
  'Local auth identity used for operator session/credential-epoch bookkeeping; never a client-supplied user id.';
COMMENT ON COLUMN operator.access_identity.operator_role_id IS
  'auth.roles operator role (is_operator = true). Custom role names grant no operator authority.';
COMMENT ON COLUMN operator.access_identity.assurance_class IS
  'Required Access/IdP assurance class. Operator policy requires access_mfa and explicit multi-factor evidence at exchange.';
COMMENT ON COLUMN operator.access_identity.mapping_epoch IS
  'AUTH-007 authority generation. A row update bumps it; sessions bound to an older epoch fail operator admission.';



-- Preserve any installed lineage: existing rows keep their epoch, new inserts/updates take
-- fresh sequence values.
ALTER TABLE operator.access_identity
  ALTER COLUMN mapping_epoch SET DEFAULT nextval('operator.access_identity_generation_seq');

CREATE TABLE IF NOT EXISTS operator.access_session_binding (
  session_id uuid PRIMARY KEY REFERENCES auth.sessions(id) ON DELETE CASCADE,
  subject text NOT NULL,
  issuer text NOT NULL,
  audience text NOT NULL,
  mapping_epoch bigint NOT NULL,
  binding_scheme text,
  operator_role_id text NOT NULL,
  assurance_class text NOT NULL,
  source_issued_at timestamptz,
  source_expires_at timestamptz NOT NULL,
  admitted_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (length(btrim(subject)) BETWEEN 1 AND 320),
  CHECK (length(btrim(issuer)) BETWEEN 1 AND 320),
  CHECK (length(btrim(audience)) BETWEEN 1 AND 320),
  CHECK (mapping_epoch > 0),
  CHECK (binding_scheme IS NULL OR binding_scheme = 'generation-v1'),
  CHECK (length(btrim(operator_role_id)) BETWEEN 1 AND 80),
  CHECK (length(btrim(assurance_class)) BETWEEN 1 AND 80),
  CHECK (source_expires_at > created_at)
);

COMMENT ON TABLE operator.access_session_binding IS
  'AUTH-007 operator session provenance. Binds the local session to the verified issuer/subject/audience, mapping generation/role/assurance and source-assertion validity. binding_scheme is generation-v1 for new bindings; legacy/null bindings fail closed. Operator admission revalidates current mapping/role authority and this ceiling.';

-- Existing lineage may lack the new scheme column; null means a legacy binding and fails
-- closed at admission.
ALTER TABLE operator.access_session_binding
  ADD COLUMN IF NOT EXISTS binding_scheme text;

-- Advance-only allocator reconciliation with a validated supported profile.
--
-- Supported allocator profile: bigint, START 1, INCREMENT 1, MINVALUE 1,
-- MAXVALUE 9223372036854775807, CACHE 1, NO CYCLE, owned by the authority-table owner.
-- Cached or cycling/negative-increment sequences are refused rather than treated as
-- equivalent; an installation failure must never silently normalize an issued allocator
-- backward. The installer takes the exclusive AUTH-006 authority gate for the duration of
-- the transaction, serializing reconciliation with admissions and installed mapping
-- writers. Run installation while no external allocator writer is active.
--
-- Never reseed below the sequence high-water or a generation retained by a session binding
-- after its mapping row was deleted. setval is not rolled back with a transaction, so every
-- adjustment only moves forward; a failed or interrupted reapplication cannot cause a
-- previously issued generation to be reused.
DO $allocator$
DECLARE
  seq record;
  table_owner oid;
  needed_floor numeric;
  needed bigint;
  current_next numeric;
  last_value bigint;
  is_called boolean;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('saven.auth.authority_gate', 0));

  SELECT s.seqtypid, s.seqincrement, s.seqmin, s.seqmax, s.seqstart, s.seqcache,
         s.seqcycle, c.relowner
    INTO seq
  FROM pg_sequence s
  JOIN pg_class c ON c.oid = s.seqrelid
  WHERE s.seqrelid = 'operator.access_identity_generation_seq'::regclass;
  SELECT relowner INTO table_owner FROM pg_class WHERE oid = 'operator.access_identity'::regclass;

  IF seq.seqtypid IS NULL THEN
    RAISE EXCEPTION 'AUTH-007 allocator profile invalid: sequence is missing';
  END IF;
  IF seq.seqtypid <> 'bigint'::regtype THEN
    RAISE EXCEPTION 'AUTH-007 allocator profile invalid: type must be bigint';
  END IF;
  IF seq.seqincrement <> 1 THEN
    RAISE EXCEPTION 'AUTH-007 allocator profile invalid: increment must be 1';
  END IF;
  IF seq.seqmin <> 1 THEN
    RAISE EXCEPTION 'AUTH-007 allocator profile invalid: minvalue must be 1';
  END IF;
  IF seq.seqmax <> 9223372036854775807 THEN
    RAISE EXCEPTION 'AUTH-007 allocator profile invalid: maxvalue must be bigint maximum';
  END IF;
  IF seq.seqstart <> 1 THEN
    RAISE EXCEPTION 'AUTH-007 allocator profile invalid: start must be 1';
  END IF;
  IF seq.seqcache <> 1 THEN
    RAISE EXCEPTION 'AUTH-007 allocator profile invalid: cache must be 1';
  END IF;
  IF seq.seqcycle THEN
    RAISE EXCEPTION 'AUTH-007 allocator profile invalid: cycling is not supported';
  END IF;
  IF seq.relowner <> table_owner THEN
    RAISE EXCEPTION 'AUTH-007 allocator profile invalid: sequence owner must match the authority-table owner';
  END IF;

  SELECT GREATEST(
    COALESCE((SELECT max(mapping_epoch)::numeric FROM operator.access_identity), 0),
    COALESCE((SELECT max(mapping_epoch)::numeric FROM operator.access_session_binding), 0)
  ) + 1 INTO needed_floor;
  IF needed_floor > 9223372036854775807 THEN
    RAISE EXCEPTION 'AUTH-007 allocator exhausted: generation floor exceeds bigint maximum';
  END IF;
  needed := needed_floor::bigint;

  SELECT s.last_value, s.is_called INTO last_value, is_called
    FROM operator.access_identity_generation_seq AS s;
  current_next := last_value::numeric + CASE WHEN is_called THEN 1 ELSE 0 END;
  IF current_next < needed_floor THEN
    PERFORM setval('operator.access_identity_generation_seq', needed, false);
  END IF;
END
$allocator$;

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
  'AUTH-007 one-time Access assertion exchange ledger. Stores only a SHA-256 canonical nonce/assertion digest, never the raw token. INSERT-once; a conflict is a replay refusal.';
COMMENT ON COLUMN operator.access_exchange.nonce_hash IS
  'SHA-256 of the issuer/audience/subject-scoped Access identity_nonce, or of the canonical verified assertion representation. Raw bearer assertions are never retained.';

CREATE INDEX IF NOT EXISTS access_exchange_subject_idx
  ON operator.access_exchange (subject, consumed_at);
CREATE INDEX IF NOT EXISTS access_session_binding_subject_idx
  ON operator.access_session_binding (subject, admitted_at);

REVOKE ALL ON operator.access_identity, operator.access_session_binding, operator.access_exchange
  FROM PUBLIC;

GRANT USAGE ON SCHEMA operator TO saven_auth_service;
GRANT SELECT ON operator.access_identity TO saven_auth_service;
GRANT SELECT, INSERT ON operator.access_session_binding TO saven_auth_service;
GRANT SELECT, INSERT ON operator.access_exchange TO saven_auth_service;

GRANT SELECT ON operator.access_identity, operator.access_session_binding, operator.access_exchange
  TO saven_operator_read, saven_operator_admin;

-- Mapping authority generation: every INSERT and UPDATE takes a fresh sequence value, so
-- delete/recreate, reassignment-return and any other mutation cannot reuse an earlier
-- incarnation. Bound sessions with an older generation fail closed.
CREATE OR REPLACE FUNCTION operator.assign_access_identity_generation() RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog
AS $fn$
BEGIN
  NEW.mapping_epoch := nextval('operator.access_identity_generation_seq');
  RETURN NEW;
END;
$fn$;

ALTER FUNCTION operator.assign_access_identity_generation() OWNER TO saven_migrator;
REVOKE ALL ON FUNCTION operator.assign_access_identity_generation() FROM PUBLIC;

DROP TRIGGER IF EXISTS access_identity_assign_generation ON operator.access_identity;
CREATE TRIGGER access_identity_assign_generation
  BEFORE INSERT OR UPDATE ON operator.access_identity
  FOR EACH ROW EXECUTE FUNCTION operator.assign_access_identity_generation();

-- The mapping table is an authority writer. Reuse the accepted AUTH-006 shared gate so a
-- mapping change cannot commit while exchange/operator admission is in flight.
DROP TRIGGER IF EXISTS access_identity_authority_gate_insert ON operator.access_identity;
CREATE TRIGGER access_identity_authority_gate_insert
  BEFORE INSERT ON operator.access_identity
  FOR EACH STATEMENT EXECUTE FUNCTION auth.lock_authority_gate();
DROP TRIGGER IF EXISTS access_identity_authority_gate_update ON operator.access_identity;
CREATE TRIGGER access_identity_authority_gate_update
  BEFORE UPDATE ON operator.access_identity
  FOR EACH STATEMENT EXECUTE FUNCTION auth.lock_authority_gate();
DROP TRIGGER IF EXISTS access_identity_authority_gate_delete ON operator.access_identity;
CREATE TRIGGER access_identity_authority_gate_delete
  BEFORE DELETE ON operator.access_identity
  FOR EACH STATEMENT EXECUTE FUNCTION auth.lock_authority_gate();

COMMENT ON TRIGGER access_identity_authority_gate_insert ON operator.access_identity IS
  'AUTH-007: new operator subject associations serialize against operator exchange/admission.';
COMMENT ON TRIGGER access_identity_authority_gate_update ON operator.access_identity IS
  'AUTH-007: operator mapping/role/assurance/epoch changes serialize against exchange/admission.';
COMMENT ON TRIGGER access_identity_authority_gate_delete ON operator.access_identity IS
  'AUTH-007: operator subject removal serializes against exchange/admission.';

COMMIT;
