-- PIVOT-007 revision 1: least-privileged, customer-granted operator reads.
--
-- Applied by the SEPARATE OFFLINE ADMINISTRATOR (superuser) because it provisions the
-- dedicated `saven_operator_definer` NOLOGIN owner and transfers only three functions to
-- it. Additive: it creates one operator policy table, six consent-serialization triggers,
-- three functions and the grants/revokes listed below. It rewrites no applied migration
-- bytes and grants no tenant table to any operator runtime role.
--
-- REVISION NOTES (review 16be2ae):
--   * bearer proof is a SHA-256 digest of the raw session token compared with
--     auth.sessions.token_hash; a caller-nominated session UUID is not proof;
--   * configured issuer/audience/required assurance/source age come from the versioned
--     `operator.access_read_policy` table and are enforced exactly;
--   * credential_version equality, exact access_mfa assurance and trusted
--     clock_timestamp() sampling AFTER blocking acquisitions are enforced;
--   * the installed AUTH-006/AUTH-007 writer protocol is validated at runtime, and the
--     complete definer authority surface is validated before and after installation;
--   * customer consent is serialized by a consent-writer advisory gate covering
--     support_grant revocation/scope edits and members.active changes;
--   * denial attribution is verified or explicitly labelled unverified.
--
-- COMMIT-BEFORE-DISCLOSURE: SQL cannot commit inside a caller's transaction. The bounded
-- server-side adapter design in db/postgres/README.md is the only route that may publish
-- rows after COMMIT; this payload deliberately provides no route that discloses rows
-- before the adapter commits. See the delivery report for the amendment request.

BEGIN;

-- ---------------------------------------------------------------------------
-- 0. Preflight: roles, stack, reapply and gate-function presence
-- ---------------------------------------------------------------------------

DO $preflight$
DECLARE
  missing text[] := ARRAY[]::text[];
  incompatible boolean;
  required_table text;
  r text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'saven_migrator')
     OR NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'saven_operator_read')
     OR NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'saven_operator_definer') THEN
    RAISE EXCEPTION 'Run 00-roles.sql before 50-functions.sql';
  END IF;
  IF NOT (SELECT rolsuper FROM pg_roles WHERE rolname = current_user) THEN
    RAISE EXCEPTION '50-functions.sql provisions a dedicated function owner and consent triggers: run it as the separate offline administrator (superuser)';
  END IF;

  FOREACH r IN ARRAY ARRAY['auth','operator','tenant_data'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = r) THEN
      missing := missing || ('schema ' || r);
    END IF;
  END LOOP;

  FOREACH required_table IN ARRAY ARRAY[
    'auth.users','auth.sessions','auth.roles','auth.tenant_membership',
    'operator.access_identity','operator.access_session_binding','operator.operator_audit',
    'tenant_data.support_grants','tenant_data.members',
    'tenant_data.business','tenant_data.company_profiles','tenant_data.accounts',
    'tenant_data.journals','tenant_data.journal_lines'
  ] LOOP
    IF to_regclass(required_table) IS NULL THEN
      missing := missing || required_table;
    END IF;
  END LOOP;

  IF cardinality(missing) > 0 THEN
    RAISE EXCEPTION 'PIVOT-007 requires an installed stack; missing: %', array_to_string(missing, ', ');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'tenant_data' AND p.proname = 'current_tenant_id'
  ) THEN
    RAISE EXCEPTION 'Run 30-rls-policies.sql before 50-functions.sql';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'auth' AND p.proname = 'lock_authority_gate'
  ) THEN
    RAISE EXCEPTION 'Run migrations/033-membership-admission-lock.sql before 50-functions.sql';
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'operator'
      AND p.proname IN ('read_tenant_support', 'log_operator_read_denial',
                        'assert_read_authority_protocol', 'assert_operator_definer_authority')
  ) OR to_regclass('operator.access_read_policy') IS NOT NULL THEN
    RAISE EXCEPTION 'PIVOT-007: 50-functions.sql is already applied and is immutable; add a new payload version instead of reapplying it';
  END IF;

  SELECT rolcanlogin OR rolsuper OR rolcreatedb OR rolcreaterole OR rolinherit OR rolbypassrls OR rolreplication
    INTO incompatible
  FROM pg_roles WHERE rolname = 'saven_operator_definer';
  IF incompatible THEN
    RAISE EXCEPTION 'PIVOT-007 refused incompatible pre-existing role saven_operator_definer; it must be NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS NOREPLICATION';
  END IF;

  IF (SELECT role.rolcanlogin OR role.rolsuper OR role.rolbypassrls OR role.rolcreaterole
        FROM pg_roles role WHERE role.rolname = 'saven_operator_read') THEN
    RAISE EXCEPTION 'PIVOT-007 refused incompatible pre-existing role saven_operator_read; the operator read runtime must be a constrained NOLOGIN application role';
  END IF;
END
$preflight$;

COMMENT ON ROLE saven_operator_definer IS
  'PIVOT-007 revision 1: NOLOGIN owner of operator.read_tenant_support(), operator.log_operator_read_denial() and operator.assert_read_authority_protocol() only. Fixed search paths, enumerated column reads, INSERT on the append-only operator audit, one sequence USAGE, two lock-only UPDATE columns, no table ownership, schema CREATE, direct tenant runtime grant, BYPASSRLS or superuser.';

SET LOCAL ROLE saven_migrator;

-- ---------------------------------------------------------------------------
-- 1. Versioned configured read policy (issuer/audience/assurance/source age)
-- ---------------------------------------------------------------------------

CREATE TABLE operator.access_read_policy (
  policy_key text NOT NULL,
  version integer NOT NULL,
  issuer text NOT NULL,
  audience text NOT NULL,
  required_assurance text NOT NULL,
  max_source_age_seconds integer NOT NULL,
  max_clock_skew_seconds integer NOT NULL DEFAULT 60,
  is_active boolean NOT NULL DEFAULT true,
  effective_from timestamptz NOT NULL DEFAULT now(),
  effective_to timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by text,
  updated_by text,
  CONSTRAINT access_read_policy_pkey PRIMARY KEY (policy_key, version),
  CONSTRAINT access_read_policy_key_not_blank CHECK (length(btrim(policy_key)) BETWEEN 1 AND 80),
  CONSTRAINT access_read_policy_version_positive CHECK (version > 0),
  CONSTRAINT access_read_policy_issuer_not_blank CHECK (length(btrim(issuer)) BETWEEN 1 AND 320),
  CONSTRAINT access_read_policy_audience_not_blank CHECK (length(btrim(audience)) BETWEEN 1 AND 320),
  CONSTRAINT access_read_policy_assurance_not_blank CHECK (length(btrim(required_assurance)) BETWEEN 1 AND 80),
  CONSTRAINT access_read_policy_source_age_positive CHECK (max_source_age_seconds > 0),
  CONSTRAINT access_read_policy_skew_nonnegative CHECK (max_clock_skew_seconds >= 0),
  CONSTRAINT access_read_policy_window_order CHECK (effective_to IS NULL OR effective_to > effective_from)
);
COMMENT ON TABLE operator.access_read_policy IS
  'PIVOT-007 versioned deployment policy for operator reads: configured issuer/audience, exact required assurance, maximum source-assertion age and tolerated clock skew. Rows are superseded, never mutated in place; the highest effective active version wins. No runtime role has access. Missing/disabled policy fails closed.';

REVOKE ALL ON operator.access_read_policy FROM PUBLIC;

-- ---------------------------------------------------------------------------
-- 2. Consent lifecycle serialization (customer writers vs mediated reads)
-- ---------------------------------------------------------------------------

CREATE FUNCTION operator.lock_consent_gate() RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog
AS $fn$
BEGIN
  -- Exclusive side of the customer-consent lifecycle gate. Every support_grant and
  -- members write takes this before its row work; a mediated read holds it shared.
  PERFORM pg_advisory_xact_lock(hashtextextended('saven.operator.consent_gate', 0));
  RETURN NULL;
END;
$fn$;

REVOKE ALL ON FUNCTION operator.lock_consent_gate() FROM PUBLIC;

CREATE TRIGGER support_grants_consent_gate_insert
  BEFORE INSERT ON tenant_data.support_grants
  FOR EACH STATEMENT EXECUTE FUNCTION operator.lock_consent_gate();
CREATE TRIGGER support_grants_consent_gate_update
  BEFORE UPDATE ON tenant_data.support_grants
  FOR EACH STATEMENT EXECUTE FUNCTION operator.lock_consent_gate();
CREATE TRIGGER support_grants_consent_gate_delete
  BEFORE DELETE ON tenant_data.support_grants
  FOR EACH STATEMENT EXECUTE FUNCTION operator.lock_consent_gate();
CREATE TRIGGER members_consent_gate_insert
  BEFORE INSERT ON tenant_data.members
  FOR EACH STATEMENT EXECUTE FUNCTION operator.lock_consent_gate();
CREATE TRIGGER members_consent_gate_update
  BEFORE UPDATE ON tenant_data.members
  FOR EACH STATEMENT EXECUTE FUNCTION operator.lock_consent_gate();
CREATE TRIGGER members_consent_gate_delete
  BEFORE DELETE ON tenant_data.members
  FOR EACH STATEMENT EXECUTE FUNCTION operator.lock_consent_gate();

COMMENT ON FUNCTION operator.lock_consent_gate() IS
  'PIVOT-007: exclusive BEFORE STATEMENT consent-writer gate. support_grants revocation/scope edits and members.active changes serialize against a mediated read holding the same key shared. Trigger functions require no runtime EXECUTE grant.';

-- ---------------------------------------------------------------------------
-- 3. Definer authority validation (exact surface, pre- and post-install)
-- ---------------------------------------------------------------------------

CREATE FUNCTION operator.assert_operator_definer_authority(p_stage text, p_allow_bootstrap boolean)
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog
AS $fn$
DECLARE
  v_oid oid;
  v_actual text[];
  v_expected text[] := ARRAY[]::text[];
  v_extra text[];
  v_missing text[];
  v_count integer;
BEGIN
  IF p_stage NOT IN ('pre', 'post') THEN
    RAISE EXCEPTION 'PIVOT-007 validator: unknown stage %', p_stage;
  END IF;
  SELECT oid INTO v_oid FROM pg_roles WHERE rolname = 'saven_operator_definer';
  IF v_oid IS NULL THEN
    RAISE EXCEPTION 'PIVOT-007 validator: saven_operator_definer is missing';
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_roles
    WHERE oid = v_oid
      AND (rolcanlogin OR rolsuper OR rolcreatedb OR rolcreaterole OR
           rolinherit OR rolbypassrls OR rolreplication)
  ) THEN
    RAISE EXCEPTION 'PIVOT-007 validator: saven_operator_definer has incompatible role flags';
  END IF;
  IF (SELECT rolconfig FROM pg_roles WHERE oid = v_oid) IS NOT NULL THEN
    RAISE EXCEPTION 'PIVOT-007 validator: saven_operator_definer has role-level session settings';
  END IF;

  IF EXISTS (SELECT 1 FROM pg_auth_members WHERE member = v_oid) THEN
    RAISE EXCEPTION 'PIVOT-007 validator: saven_operator_definer is a member of another role (reachable privilege path)';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_auth_members WHERE roleid = v_oid) THEN
    RAISE EXCEPTION 'PIVOT-007 validator: another role can assume saven_operator_definer';
  END IF;

  IF EXISTS (SELECT 1 FROM pg_class WHERE relowner = v_oid) THEN
    RAISE EXCEPTION 'PIVOT-007 validator: saven_operator_definer owns a relation or sequence';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspowner = v_oid) THEN
    RAISE EXCEPTION 'PIVOT-007 validator: saven_operator_definer owns a schema';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_database WHERE datdba = v_oid) THEN
    RAISE EXCEPTION 'PIVOT-007 validator: saven_operator_definer owns a database';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_tablespace WHERE spcowner = v_oid) THEN
    RAISE EXCEPTION 'PIVOT-007 validator: saven_operator_definer owns a tablespace';
  END IF;

  SELECT count(*) INTO v_count FROM pg_proc WHERE proowner = v_oid;
  IF p_stage = 'pre' THEN
    IF v_count <> 0 THEN
      RAISE EXCEPTION 'PIVOT-007 validator: saven_operator_definer already owns % function(s) before installation', v_count;
    END IF;
  ELSE
    IF v_count <> 3 OR EXISTS (
      SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE p.proowner = v_oid
        AND NOT (n.nspname = 'operator' AND p.proname IN (
          'read_tenant_support', 'log_operator_read_denial', 'assert_read_authority_protocol'))
    ) THEN
      RAISE EXCEPTION 'PIVOT-007 validator: saven_operator_definer ownership is not exactly the three reviewed functions (% owned)', v_count;
    END IF;
  END IF;

  IF has_schema_privilege(v_oid, 'auth', 'CREATE')
     OR has_schema_privilege(v_oid, 'operator', 'CREATE')
     OR has_schema_privilege(v_oid, 'tenant_data', 'CREATE') THEN
    RAISE EXCEPTION 'PIVOT-007 validator: saven_operator_definer can create in an application schema';
  END IF;
  IF has_database_privilege(v_oid, current_database(), 'CREATE') THEN
    RAISE EXCEPTION 'PIVOT-007 validator: saven_operator_definer can create in the database';
  END IF;

  -- Explicit schema ACLs: exactly the reviewed USAGE set, never CREATE.
  SELECT coalesce(array_agg(n.nspname || '|' || a.privilege_type ORDER BY n.nspname, a.privilege_type), '{}')
    INTO v_actual
  FROM pg_namespace n, aclexplode(n.nspacl) a
  WHERE a.grantee = v_oid;
  IF p_stage = 'pre' THEN
    v_expected := ARRAY['operator|USAGE'];
  ELSE
    v_expected := ARRAY['auth|USAGE', 'operator|USAGE', 'tenant_data|USAGE'];
  END IF;
  SELECT array_agg(x ORDER BY x) INTO v_extra FROM unnest(v_actual) x WHERE x <> ALL (v_expected);
  SELECT array_agg(x ORDER BY x) INTO v_missing FROM unnest(v_expected) x WHERE x <> ALL (v_actual);
  IF v_extra IS NOT NULL OR v_missing IS NOT NULL THEN
    RAISE EXCEPTION 'PIVOT-007 validator: schema ACL mismatch; extra %, missing %',
      coalesce(array_to_string(v_extra, ', '), 'none'), coalesce(array_to_string(v_missing, ', '), 'none');
  END IF;

  -- Direct database ACLs are never granted to the definer.
  IF EXISTS (
    SELECT 1 FROM pg_database d, aclexplode(d.datacl) a
    WHERE d.datname = current_database() AND a.grantee = v_oid
  ) THEN
    RAISE EXCEPTION 'PIVOT-007 validator: saven_operator_definer has a direct database ACL';
  END IF;

  -- Default privileges must not widen the definer or PUBLIC in the reviewed schemas.
  IF EXISTS (
    SELECT 1
    FROM pg_default_acl d, aclexplode(d.defaclacl) a
    WHERE (d.defaclnamespace = 0
           OR d.defaclnamespace IN ('auth'::regnamespace, 'operator'::regnamespace, 'tenant_data'::regnamespace))
      AND (a.grantee = v_oid OR a.grantee = 0)
  ) THEN
    RAISE EXCEPTION 'PIVOT-007 validator: a default privilege would widen saven_operator_definer or PUBLIC';
  END IF;

  -- Complete table/column/sequence ACL surface.
  SELECT coalesce(array_agg(s.obj || '|' || s.priv || '|' || s.col ORDER BY s.obj, s.priv, s.col), '{}')
    INTO v_actual
  FROM (
    SELECT n.nspname || '.' || c.relname AS obj, a.privilege_type AS priv, '' AS col
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    JOIN LATERAL aclexplode(c.relacl) a ON a.grantee = v_oid
    WHERE c.relkind IN ('r', 'p', 'v', 'm', 'f', 'S')
    UNION ALL
    SELECT n.nspname || '.' || c.relname, a.privilege_type, att.attname
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    JOIN pg_attribute att ON att.attrelid = c.oid AND att.attnum > 0 AND NOT att.attisdropped
    JOIN LATERAL aclexplode(att.attacl) a ON a.grantee = v_oid
    WHERE c.relkind IN ('r', 'p')
  ) s;

  IF p_stage = 'pre' THEN
    IF NOT p_allow_bootstrap THEN
      RAISE EXCEPTION 'PIVOT-007 validator: bootstrap grants require p_allow_bootstrap';
    END IF;
    v_expected := ARRAY[
      'operator.reference_value|SELECT|',
      'operator.tenant|SELECT|',
      'operator.entitlement|SELECT|',
      'operator.operator_audit|SELECT|',
      'operator.operator_audit|INSERT|',
      'operator.feature_flag|SELECT|',
      'operator.tenant_placement|SELECT|',
      'operator.jobs|SELECT|',
      'operator.ai_requests|SELECT|',
      'operator.migration_events|SELECT|',
      'operator.pg_schema_migrations|SELECT|',
      'operator.source_store_migrations|SELECT|',
      'operator.entitlement_id_seq|USAGE|',
      'operator.entitlement_id_seq|SELECT|',
      'operator.operator_audit_id_seq|USAGE|',
      'operator.operator_audit_id_seq|SELECT|',
      'operator.feature_flag_id_seq|USAGE|',
      'operator.feature_flag_id_seq|SELECT|',
      'operator.migration_events_id_seq|USAGE|',
      'operator.migration_events_id_seq|SELECT|',
      'operator.source_store_migrations_id_seq|USAGE|',
      'operator.source_store_migrations_id_seq|SELECT|'
    ];
  ELSE
    v_expected := ARRAY[
      'operator.operator_audit|INSERT|',
      'operator.operator_audit_id_seq|USAGE|',
      'operator.access_identity|SELECT|subject',
      'operator.access_identity|SELECT|user_id',
      'operator.access_identity|SELECT|operator_role_id',
      'operator.access_identity|SELECT|assurance_class',
      'operator.access_identity|SELECT|status',
      'operator.access_identity|SELECT|mapping_epoch',
      'operator.access_identity|SELECT|effective_from',
      'operator.access_identity|SELECT|effective_to',
      'operator.access_session_binding|SELECT|session_id',
      'operator.access_session_binding|SELECT|subject',
      'operator.access_session_binding|SELECT|issuer',
      'operator.access_session_binding|SELECT|audience',
      'operator.access_session_binding|SELECT|mapping_epoch',
      'operator.access_session_binding|SELECT|binding_scheme',
      'operator.access_session_binding|SELECT|operator_role_id',
      'operator.access_session_binding|SELECT|assurance_class',
      'operator.access_session_binding|SELECT|source_issued_at',
      'operator.access_session_binding|SELECT|source_expires_at',
      'operator.access_read_policy|SELECT|policy_key',
      'operator.access_read_policy|SELECT|version',
      'operator.access_read_policy|SELECT|issuer',
      'operator.access_read_policy|SELECT|audience',
      'operator.access_read_policy|SELECT|required_assurance',
      'operator.access_read_policy|SELECT|max_source_age_seconds',
      'operator.access_read_policy|SELECT|max_clock_skew_seconds',
      'operator.access_read_policy|SELECT|is_active',
      'operator.access_read_policy|SELECT|effective_from',
      'operator.access_read_policy|SELECT|effective_to',
      'auth.users|SELECT|id',
      'auth.users|SELECT|status',
      'auth.users|SELECT|credential_version',
      'auth.users|UPDATE|status',
      'auth.sessions|SELECT|id',
      'auth.sessions|SELECT|user_id',
      'auth.sessions|SELECT|realm',
      'auth.sessions|SELECT|idle_expires_at',
      'auth.sessions|SELECT|absolute_expires_at',
      'auth.sessions|SELECT|revoked_at',
      'auth.sessions|SELECT|credential_version',
      'auth.sessions|SELECT|token_hash',
      'auth.sessions|UPDATE|revoked_at',
      'auth.roles|SELECT|role_id',
      'auth.roles|SELECT|is_operator',
      'auth.roles|SELECT|is_active',
      'auth.roles|SELECT|requires_mfa',
      'auth.roles|SELECT|assurance_class',
      'auth.roles|SELECT|effective_from',
      'auth.roles|SELECT|effective_to',
      'tenant_data.support_grants|SELECT|tenant_id',
      'tenant_data.support_grants|SELECT|grant_id',
      'tenant_data.support_grants|SELECT|grantee_actor_id',
      'tenant_data.support_grants|SELECT|granted_by_user_id',
      'tenant_data.support_grants|SELECT|scope_jsonb',
      'tenant_data.support_grants|SELECT|actions_jsonb',
      'tenant_data.support_grants|SELECT|reason',
      'tenant_data.support_grants|SELECT|starts_at',
      'tenant_data.support_grants|SELECT|expires_at',
      'tenant_data.support_grants|SELECT|revoked_at',
      'tenant_data.support_grants|SELECT|is_active',
      'tenant_data.members|SELECT|tenant_id',
      'tenant_data.members|SELECT|user_id',
      'tenant_data.members|SELECT|active',
      'tenant_data.business|SELECT|tenant_id',
      'tenant_data.business|SELECT|id',
      'tenant_data.business|SELECT|state',
      'tenant_data.company_profiles|SELECT|tenant_id',
      'tenant_data.company_profiles|SELECT|id',
      'tenant_data.company_profiles|SELECT|name',
      'tenant_data.company_profiles|SELECT|currency',
      'tenant_data.company_profiles|SELECT|branch',
      'tenant_data.accounts|SELECT|tenant_id',
      'tenant_data.accounts|SELECT|code',
      'tenant_data.accounts|SELECT|title',
      'tenant_data.journals|SELECT|tenant_id',
      'tenant_data.journals|SELECT|id',
      'tenant_data.journals|SELECT|company',
      'tenant_data.journals|SELECT|branch',
      'tenant_data.journals|SELECT|posting_date',
      'tenant_data.journals|SELECT|narrative',
      'tenant_data.journal_lines|SELECT|tenant_id',
      'tenant_data.journal_lines|SELECT|journal_id',
      'tenant_data.journal_lines|SELECT|line_no',
      'tenant_data.journal_lines|SELECT|account',
      'tenant_data.journal_lines|SELECT|debit',
      'tenant_data.journal_lines|SELECT|credit'
    ];
  END IF;

  SELECT array_agg(x ORDER BY x) INTO v_extra FROM unnest(v_actual) x WHERE x <> ALL (v_expected);
  SELECT array_agg(x ORDER BY x) INTO v_missing FROM unnest(v_expected) x WHERE x <> ALL (v_actual);
  IF v_extra IS NOT NULL OR v_missing IS NOT NULL THEN
    RAISE EXCEPTION 'PIVOT-007 validator: table/column/sequence ACL mismatch; extra %, missing %',
      coalesce(array_to_string(v_extra, ', '), 'none'), coalesce(array_to_string(v_missing, ', '), 'none');
  END IF;

  -- Function EXECUTE surface.
  SELECT coalesce(array_agg(p.oid::regprocedure::text || '|' || a.privilege_type ORDER BY 1), '{}')
    INTO v_actual
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  JOIN LATERAL aclexplode(p.proacl) a ON a.grantee = v_oid
  WHERE n.nspname IN ('auth', 'operator', 'tenant_data')
    AND a.grantee <> p.proowner;
  IF p_stage = 'pre' THEN
    v_expected := ARRAY[]::text[];
  ELSE
    v_expected := ARRAY['tenant_data.current_tenant_id()|EXECUTE'];
  END IF;
  SELECT array_agg(x ORDER BY x) INTO v_extra FROM unnest(v_actual) x WHERE x <> ALL (v_expected);
  SELECT array_agg(x ORDER BY x) INTO v_missing FROM unnest(v_expected) x WHERE x <> ALL (v_actual);
  IF v_extra IS NOT NULL OR v_missing IS NOT NULL THEN
    RAISE EXCEPTION 'PIVOT-007 validator: function EXECUTE mismatch; extra %, missing %',
      coalesce(array_to_string(v_extra, ', '), 'none'), coalesce(array_to_string(v_missing, ', '), 'none');
  END IF;

  -- PUBLIC must hold nothing on relations, columns or SECURITY DEFINER functions in the
  -- reviewed schemas. (Baseline PUBLIC USAGE on pg_catalog/public schema is not a grant
  -- made by this project and exposes no project object.)
  IF EXISTS (
    SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace,
         aclexplode(c.relacl) a
    WHERE n.nspname IN ('auth', 'operator', 'tenant_data') AND a.grantee = 0
  ) THEN
    RAISE EXCEPTION 'PIVOT-007 validator: PUBLIC holds a relation/sequence privilege in a reviewed schema';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    JOIN pg_attribute att ON att.attrelid = c.oid AND att.attnum > 0 AND NOT att.attisdropped,
         aclexplode(att.attacl) a
    WHERE n.nspname IN ('auth', 'operator', 'tenant_data') AND a.grantee = 0
  ) THEN
    RAISE EXCEPTION 'PIVOT-007 validator: PUBLIC holds a column privilege in a reviewed schema';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace,
         aclexplode(p.proacl) a
    WHERE n.nspname IN ('auth', 'operator', 'tenant_data')
      AND p.prosecdef AND a.grantee = 0
  ) THEN
    RAISE EXCEPTION 'PIVOT-007 validator: PUBLIC can execute a SECURITY DEFINER function in a reviewed schema';
  END IF;

END;
$fn$;

COMMENT ON FUNCTION operator.assert_operator_definer_authority(text, boolean) IS
  'PIVOT-007: exact authority-surface validator for saven_operator_definer. Enumerates role flags/settings, direct and transitive memberships, ownership, schema/database/default ACLs, the complete table/column/sequence/function ACL set, PUBLIC reachability and bootstrap grants; pre-stage allows only the reviewed bootstrap set, post-stage allows only the enumerated minimum. Refuses mismatches without mutating unrelated grants.';

REVOKE ALL ON FUNCTION operator.assert_operator_definer_authority(text, boolean) FROM PUBLIC;

-- Pre-install validation: only the known bootstrap grants are tolerated.
DO $pre_authority$
BEGIN
  PERFORM operator.assert_operator_definer_authority('pre', true);
END
$pre_authority$;

-- ---------------------------------------------------------------------------
-- 4. Exact grants: revoke the broad bootstrap surface, grant the reviewed minimum
-- ---------------------------------------------------------------------------

REVOKE ALL ON ALL TABLES IN SCHEMA operator FROM saven_operator_definer;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA operator FROM saven_operator_definer;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA operator FROM saven_operator_definer;

GRANT USAGE ON SCHEMA auth TO saven_operator_definer;
GRANT USAGE ON SCHEMA tenant_data TO saven_operator_definer;

GRANT SELECT (
  subject, user_id, operator_role_id, assurance_class, status,
  mapping_epoch, effective_from, effective_to
) ON operator.access_identity TO saven_operator_definer;
GRANT SELECT (
  session_id, subject, issuer, audience, mapping_epoch, binding_scheme,
  operator_role_id, assurance_class, source_issued_at, source_expires_at
) ON operator.access_session_binding TO saven_operator_definer;
GRANT SELECT (
  policy_key, version, issuer, audience, required_assurance,
  max_source_age_seconds, max_clock_skew_seconds, is_active,
  effective_from, effective_to
) ON operator.access_read_policy TO saven_operator_definer;

GRANT INSERT ON operator.operator_audit TO saven_operator_definer;
GRANT USAGE ON SEQUENCE operator.operator_audit_id_seq TO saven_operator_definer;

GRANT SELECT (id, status, credential_version) ON auth.users TO saven_operator_definer;
GRANT SELECT (
  id, user_id, realm, idle_expires_at, absolute_expires_at, revoked_at, credential_version, token_hash
) ON auth.sessions TO saven_operator_definer;
GRANT SELECT (
  role_id, is_operator, is_active, requires_mfa, assurance_class,
  effective_from, effective_to
) ON auth.roles TO saven_operator_definer;
-- PostgreSQL requires an UPDATE privilege for SELECT ... FOR SHARE row locking. These two
-- columns exist only so the verification read can hold the principal/session row against
-- a concurrent revocation or credential change until the transaction ends; the definer
-- owns no write function and cannot issue arbitrary UPDATEs.
GRANT UPDATE (status) ON auth.users TO saven_operator_definer;
GRANT UPDATE (revoked_at) ON auth.sessions TO saven_operator_definer;

GRANT SELECT (
  tenant_id, grant_id, grantee_actor_id, granted_by_user_id, scope_jsonb,
  actions_jsonb, reason, starts_at, expires_at, revoked_at, is_active
) ON tenant_data.support_grants TO saven_operator_definer;
GRANT SELECT (tenant_id, user_id, active) ON tenant_data.members TO saven_operator_definer;
GRANT SELECT (tenant_id, id, state) ON tenant_data.business TO saven_operator_definer;
GRANT SELECT (tenant_id, id, name, currency, branch) ON tenant_data.company_profiles TO saven_operator_definer;
GRANT SELECT (tenant_id, code, title) ON tenant_data.accounts TO saven_operator_definer;
GRANT SELECT (tenant_id, id, company, branch, posting_date, narrative) ON tenant_data.journals TO saven_operator_definer;
GRANT SELECT (tenant_id, journal_id, line_no, account, debit, credit) ON tenant_data.journal_lines TO saven_operator_definer;

GRANT EXECUTE ON FUNCTION tenant_data.current_tenant_id() TO saven_operator_definer;

-- ---------------------------------------------------------------------------
-- 5. Installed authority-writer protocol validation
-- ---------------------------------------------------------------------------

CREATE FUNCTION operator.assert_read_authority_protocol()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, operator, tenant_data
AS $fn$
DECLARE
  v_gate oid;
  v_consent oid;
  v_definer oid;
  expected record;
BEGIN
  SELECT p.oid INTO v_gate FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'auth' AND p.proname = 'lock_authority_gate';
  IF v_gate IS NULL THEN
    RAISE EXCEPTION 'OPERATOR_AUTHORITY_PROTOCOL_INVALID: the AUTH-006 authority gate is missing';
  END IF;
  IF (SELECT pg_get_userbyid(proowner) FROM pg_proc WHERE oid = v_gate) <> 'saven_migrator'
     OR (SELECT prosrc FROM pg_proc WHERE oid = v_gate) NOT LIKE '%pg_advisory_xact_lock(%'
     OR (SELECT prosrc FROM pg_proc WHERE oid = v_gate) LIKE '%pg_advisory_xact_lock_shared(%'
     OR (SELECT prosrc FROM pg_proc WHERE oid = v_gate) NOT LIKE '%saven.auth.authority_gate%' THEN
    RAISE EXCEPTION 'OPERATOR_AUTHORITY_PROTOCOL_INVALID: the AUTH-006 authority gate is not the reviewed exclusive gate';
  END IF;

  SELECT p.oid INTO v_consent FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'operator' AND p.proname = 'lock_consent_gate';
  IF v_consent IS NULL
     OR (SELECT prosrc FROM pg_proc WHERE oid = v_consent) NOT LIKE '%pg_advisory_xact_lock(%'
     OR (SELECT prosrc FROM pg_proc WHERE oid = v_consent) LIKE '%pg_advisory_xact_lock_shared(%'
     OR (SELECT prosrc FROM pg_proc WHERE oid = v_consent) NOT LIKE '%saven.operator.consent_gate%' THEN
    RAISE EXCEPTION 'OPERATOR_AUTHORITY_PROTOCOL_INVALID: the consent-writer gate is missing or misbound';
  END IF;

  FOR expected IN
    SELECT * FROM (VALUES
      ('auth', 'tenant_membership', 'tenant_membership_authority_gate_insert', 6, v_gate),
      ('auth', 'tenant_membership', 'tenant_membership_authority_gate_update', 18, v_gate),
      ('auth', 'tenant_membership', 'tenant_membership_authority_gate_delete', 10, v_gate),
      ('auth', 'roles', 'roles_authority_gate_insert', 6, v_gate),
      ('auth', 'roles', 'roles_authority_gate_update', 18, v_gate),
      ('auth', 'roles', 'roles_authority_gate_delete', 10, v_gate),
      ('operator', 'access_identity', 'access_identity_authority_gate_insert', 6, v_gate),
      ('operator', 'access_identity', 'access_identity_authority_gate_update', 18, v_gate),
      ('operator', 'access_identity', 'access_identity_authority_gate_delete', 10, v_gate),
      ('tenant_data', 'support_grants', 'support_grants_consent_gate_insert', 6, v_consent),
      ('tenant_data', 'support_grants', 'support_grants_consent_gate_update', 18, v_consent),
      ('tenant_data', 'support_grants', 'support_grants_consent_gate_delete', 10, v_consent),
      ('tenant_data', 'members', 'members_consent_gate_insert', 6, v_consent),
      ('tenant_data', 'members', 'members_consent_gate_update', 18, v_consent),
      ('tenant_data', 'members', 'members_consent_gate_delete', 10, v_consent)
    ) AS t(schema_name, table_name, trigger_name, expected_type, function_oid)
  LOOP
    IF NOT EXISTS (
      SELECT 1
      FROM pg_trigger t
      JOIN pg_class c ON c.oid = t.tgrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = expected.schema_name
        AND c.relname = expected.table_name
        AND t.tgname = expected.trigger_name
        AND NOT t.tgisinternal
        AND t.tgenabled = 'O'
        AND t.tgfoid = expected.function_oid
        AND t.tgtype = expected.expected_type
    ) THEN
      RAISE EXCEPTION 'OPERATOR_AUTHORITY_PROTOCOL_INVALID: required protection %.%.% is missing, disabled, replica-only or misbound',
        expected.schema_name, expected.table_name, expected.trigger_name;
    END IF;
  END LOOP;

  -- Post-install drift on the definer role itself.
  SELECT oid INTO v_definer FROM pg_roles WHERE rolname = 'saven_operator_definer';
  IF EXISTS (SELECT 1 FROM pg_auth_members WHERE member = v_definer OR roleid = v_definer) THEN
    RAISE EXCEPTION 'OPERATOR_AUTHORITY_PROTOCOL_INVALID: the definer role membership surface changed';
  END IF;
  IF (SELECT rolconfig FROM pg_roles WHERE oid = v_definer) IS NOT NULL
     OR EXISTS (SELECT 1 FROM pg_class WHERE relowner = v_definer)
     OR EXISTS (SELECT 1 FROM pg_namespace WHERE nspowner = v_definer)
     OR EXISTS (SELECT 1 FROM pg_database WHERE datdba = v_definer) THEN
    RAISE EXCEPTION 'OPERATOR_AUTHORITY_PROTOCOL_INVALID: the definer role gained ownership or session settings';
  END IF;
  IF has_schema_privilege(v_definer, 'auth', 'CREATE')
     OR has_schema_privilege(v_definer, 'operator', 'CREATE')
     OR has_schema_privilege(v_definer, 'tenant_data', 'CREATE') THEN
    RAISE EXCEPTION 'OPERATOR_AUTHORITY_PROTOCOL_INVALID: the definer role gained schema CREATE';
  END IF;
END;
$fn$;

COMMENT ON FUNCTION operator.assert_read_authority_protocol() IS
  'PIVOT-007: runtime validation of the installed AUTH-006/AUTH-007 writer protocol and the PIVOT-007 consent gate. Requires the reviewed exclusive gate bodies, every gated trigger enabled in origin mode and bound to the exact function/event, no definer membership/ownership/settings drift and no schema CREATE. Raises OPERATOR_AUTHORITY_PROTOCOL_INVALID and fails the read closed.';

-- ---------------------------------------------------------------------------
-- 6. Audited, customer-granted operator read
-- ---------------------------------------------------------------------------

CREATE FUNCTION operator.read_tenant_support(
  p_tenant uuid,
  p_session_proof text,
  p_resource text,
  p_action text,
  p_company text,
  p_reason text,
  p_request_id text,
  p_limit integer DEFAULT 200
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, operator, tenant_data
AS $fn$
DECLARE
  v_session_text text;
  v_session uuid;
  v_subject text;
  v_binding_epoch bigint;
  v_binding_role text;
  v_binding_assurance text;
  v_binding_scheme text;
  v_binding_issuer text;
  v_binding_audience text;
  v_binding_issued timestamptz;
  v_binding_expires timestamptz;
  v_user uuid;
  v_map_epoch bigint;
  v_map_role text;
  v_map_assurance text;
  v_map_status text;
  v_map_from timestamptz;
  v_map_to timestamptz;
  v_user_status text;
  v_user_credential bigint;
  v_role_is_operator boolean;
  v_role_active boolean;
  v_role_requires_mfa boolean;
  v_role_from timestamptz;
  v_role_to timestamptz;
  v_session_realm text;
  v_session_revoked timestamptz;
  v_session_idle timestamptz;
  v_session_absolute timestamptz;
  v_session_user uuid;
  v_session_credential bigint;
  v_session_token text;
  v_policy_issuer text;
  v_policy_audience text;
  v_policy_assurance text;
  v_policy_source_age integer;
  v_policy_skew integer;
  v_now timestamptz;
  v_previous_tenant text;
  v_grant_row record;
  v_grant_id text;
  v_grant_companies text[];
  v_actions text[];
  v_companies text[];
  v_company_filter text[];
  v_rows jsonb;
  v_count integer;
  v_truncated boolean;
BEGIN
  IF p_tenant IS NULL THEN
    RAISE EXCEPTION 'OPERATOR_ARGUMENT_INVALID: a target tenant is required';
  END IF;
  IF p_session_proof IS NULL OR p_session_proof !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'OPERATOR_CONTEXT_REQUIRED: a bearer-derived session proof is required';
  END IF;
  IF p_resource IS NULL OR p_resource NOT IN (
       'business', 'company_profiles', 'accounts', 'journals', 'journal_lines') THEN
    RAISE EXCEPTION 'OPERATOR_RESOURCE_UNSUPPORTED: the requested resource is not in the reviewed operator read allow-list';
  END IF;
  IF p_action IS NULL OR btrim(p_action) = '' OR length(p_action) > 120 THEN
    RAISE EXCEPTION 'OPERATOR_ARGUMENT_INVALID: a bounded action key is required';
  END IF;
  IF p_reason IS NULL OR btrim(p_reason) = '' OR length(p_reason) > 1000 THEN
    RAISE EXCEPTION 'OPERATOR_ARGUMENT_INVALID: a bounded support reason is required';
  END IF;
  IF p_company IS NOT NULL AND (btrim(p_company) = '' OR length(p_company) > 120) THEN
    RAISE EXCEPTION 'OPERATOR_ARGUMENT_INVALID: the requested company scope is malformed';
  END IF;
  IF p_company IS NOT NULL AND p_resource IN ('business', 'accounts') THEN
    RAISE EXCEPTION 'OPERATOR_ARGUMENT_INVALID: this resource is tenant-wide and takes no company scope';
  END IF;
  IF p_request_id IS NOT NULL AND length(p_request_id) > 200 THEN
    RAISE EXCEPTION 'OPERATOR_ARGUMENT_INVALID: the request id is too long';
  END IF;
  IF p_limit IS NULL OR p_limit < 1 OR p_limit > 500 THEN
    RAISE EXCEPTION 'OPERATOR_ARGUMENT_INVALID: the row limit must be between 1 and 500';
  END IF;

  -- Validate the installed writer protocol BEFORE trusting its advisory gate.
  PERFORM operator.assert_read_authority_protocol();

  -- AUTH-006 gate (shared) serializes mapping/membership/role authority changes.
  PERFORM pg_advisory_xact_lock_shared(hashtextextended('saven.auth.authority_gate', 0));

  v_session_text := nullif(current_setting('app.operator_session_id', true), '');
  IF v_session_text IS NULL OR NOT pg_input_is_valid(v_session_text, 'uuid') THEN
    RAISE EXCEPTION 'OPERATOR_CONTEXT_REQUIRED: a verified operator session context is required';
  END IF;
  v_session := v_session_text::uuid;

  SELECT b.subject, b.mapping_epoch, b.operator_role_id, b.assurance_class,
         b.binding_scheme, b.issuer, b.audience, b.source_issued_at, b.source_expires_at,
         ai.user_id, ai.status, ai.mapping_epoch, ai.operator_role_id,
         ai.assurance_class, ai.effective_from, ai.effective_to
    INTO v_subject, v_binding_epoch, v_binding_role, v_binding_assurance,
         v_binding_scheme, v_binding_issuer, v_binding_audience,
         v_binding_issued, v_binding_expires,
         v_user, v_map_status, v_map_epoch, v_map_role,
         v_map_assurance, v_map_from, v_map_to
  FROM operator.access_session_binding b
  JOIN operator.access_identity ai ON ai.subject = b.subject
  WHERE b.session_id = v_session;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'OPERATOR_CONTEXT_REQUIRED: the operator session has no verified Access binding';
  END IF;

  -- Lock order matches AUTH-007 admission: gate (shared) -> principal -> session.
  SELECT u.status, u.credential_version INTO v_user_status, v_user_credential
  FROM auth.users u
  WHERE u.id = v_user
  FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'OPERATOR_ACCESS_DENIED: the operator principal no longer exists';
  END IF;

  SELECT s.realm, s.revoked_at, s.idle_expires_at, s.absolute_expires_at,
         s.user_id, s.credential_version, s.token_hash
    INTO v_session_realm, v_session_revoked, v_session_idle, v_session_absolute,
         v_session_user, v_session_credential, v_session_token
  FROM auth.sessions s
  WHERE s.id = v_session
    AND s.token_hash = p_session_proof
  FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'OPERATOR_CONTEXT_REQUIRED: the bearer-derived session proof does not match the operator session';
  END IF;

  SELECT r.is_operator, r.is_active, r.requires_mfa, r.effective_from, r.effective_to
    INTO v_role_is_operator, v_role_active, v_role_requires_mfa, v_role_from, v_role_to
  FROM auth.roles r
  WHERE r.role_id = v_map_role;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'OPERATOR_ACCESS_DENIED: the mapped operator role no longer exists';
  END IF;

  SELECT p.issuer, p.audience, p.required_assurance,
         p.max_source_age_seconds, p.max_clock_skew_seconds
    INTO v_policy_issuer, v_policy_audience, v_policy_assurance,
         v_policy_source_age, v_policy_skew
  FROM operator.access_read_policy p
  WHERE p.policy_key = 'operator_read'
    AND p.is_active
    AND p.effective_from <= clock_timestamp()
    AND (p.effective_to IS NULL OR p.effective_to > clock_timestamp())
  ORDER BY p.version DESC
  LIMIT 1;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'OPERATOR_POLICY_REQUIRED: no active operator read policy is configured';
  END IF;

  -- Trusted time is sampled only after all blocking authority acquisitions.
  v_now := clock_timestamp();

  IF v_subject IS NULL
     OR v_binding_scheme IS DISTINCT FROM 'generation-v1'
     OR v_binding_epoch IS DISTINCT FROM v_map_epoch
     OR v_binding_role IS DISTINCT FROM v_map_role
     OR v_binding_assurance IS DISTINCT FROM v_map_assurance
     OR v_binding_issuer IS DISTINCT FROM v_policy_issuer
     OR v_binding_audience IS DISTINCT FROM v_policy_audience
     OR v_binding_assurance IS DISTINCT FROM v_policy_assurance
     OR v_map_status IS DISTINCT FROM 'active'
     OR v_map_from > v_now
     OR (v_map_to IS NOT NULL AND v_map_to <= v_now)
     OR v_user_status IS DISTINCT FROM 'active'
     OR v_user_credential IS DISTINCT FROM v_session_credential
     OR v_role_is_operator IS NOT TRUE
     OR v_role_active IS NOT TRUE
     OR v_role_requires_mfa IS NOT TRUE
     OR v_role_from > v_now
     OR (v_role_to IS NOT NULL AND v_role_to <= v_now) THEN
    RAISE EXCEPTION 'OPERATOR_ACCESS_DENIED: the operator Access mapping is no longer current';
  END IF;

  IF v_session_realm IS DISTINCT FROM 'operator'
     OR v_session_revoked IS NOT NULL
     OR v_session_user IS DISTINCT FROM v_user
     OR v_session_idle <= v_now
     OR v_session_absolute <= v_now THEN
    RAISE EXCEPTION 'OPERATOR_ACCESS_EXPIRED: the operator session is not current';
  END IF;

  IF v_binding_issued IS NULL
     OR v_binding_issued > v_now + make_interval(secs => v_policy_skew)
     OR v_binding_issued < v_now - make_interval(secs => v_policy_source_age + v_policy_skew) THEN
    RAISE EXCEPTION 'OPERATOR_ACCESS_EXPIRED: the verified Access assertion is outside the configured source age';
  END IF;
  IF v_binding_expires IS NULL OR v_binding_expires <= v_now THEN
    RAISE EXCEPTION 'OPERATOR_ACCESS_EXPIRED: the verified Access assertion has expired';
  END IF;

  -- Customer consent serializes against its writers through the consent gate.
  v_previous_tenant := current_setting('app.current_tenant_id', true);
  PERFORM set_config('app.current_tenant_id', p_tenant::text, true);
  PERFORM pg_advisory_xact_lock_shared(hashtextextended('saven.operator.consent_gate', 0));

  v_grant_id := NULL;
  v_grant_companies := NULL;
  FOR v_grant_row IN
    SELECT g.grant_id, g.granted_by_user_id, g.scope_jsonb, g.actions_jsonb,
           g.starts_at, g.expires_at, g.revoked_at, g.is_active
    FROM tenant_data.support_grants g
    WHERE g.tenant_id = p_tenant
      AND g.grantee_actor_id = v_subject
    ORDER BY g.grant_id
  LOOP
    CONTINUE WHEN v_grant_row.is_active IS NOT TRUE;
    CONTINUE WHEN v_grant_row.revoked_at IS NOT NULL;

    -- Exact JSON typing: no ->> coercion of numbers/strings and no implicit casts.
    CONTINUE WHEN jsonb_typeof(v_grant_row.actions_jsonb) IS DISTINCT FROM 'array';
    CONTINUE WHEN EXISTS (
      SELECT 1 FROM jsonb_array_elements(v_grant_row.actions_jsonb) e
      WHERE jsonb_typeof(e) IS DISTINCT FROM 'string' OR length(btrim(e #>> '{}')) = 0
    );
    v_actions := ARRAY(SELECT e #>> '{}' FROM jsonb_array_elements(v_grant_row.actions_jsonb) e);
    CONTINUE WHEN NOT (p_action = ANY(v_actions));

    CONTINUE WHEN jsonb_typeof(v_grant_row.scope_jsonb) IS DISTINCT FROM 'object';
    CONTINUE WHEN jsonb_typeof(v_grant_row.scope_jsonb -> 'version') IS DISTINCT FROM 'number';
    CONTINUE WHEN (v_grant_row.scope_jsonb ->> 'version') IS DISTINCT FROM '1';
    CONTINUE WHEN (v_grant_row.scope_jsonb - 'version' - 'resources' - 'companies') <> '{}'::jsonb;
    CONTINUE WHEN jsonb_typeof(v_grant_row.scope_jsonb -> 'resources') IS DISTINCT FROM 'array';
    CONTINUE WHEN EXISTS (
      SELECT 1 FROM jsonb_array_elements(v_grant_row.scope_jsonb -> 'resources') e
      WHERE jsonb_typeof(e) IS DISTINCT FROM 'string' OR length(btrim(e #>> '{}')) = 0
    );
    CONTINUE WHEN NOT (p_resource = ANY (ARRAY(
      SELECT e #>> '{}' FROM jsonb_array_elements(v_grant_row.scope_jsonb -> 'resources') e)));

    IF v_grant_row.scope_jsonb ? 'companies' THEN
      CONTINUE WHEN jsonb_typeof(v_grant_row.scope_jsonb -> 'companies') IS DISTINCT FROM 'array';
      CONTINUE WHEN EXISTS (
        SELECT 1 FROM jsonb_array_elements(v_grant_row.scope_jsonb -> 'companies') e
        WHERE jsonb_typeof(e) IS DISTINCT FROM 'string' OR length(btrim(e #>> '{}')) = 0
      );
      v_companies := ARRAY(
        SELECT e #>> '{}' FROM jsonb_array_elements(v_grant_row.scope_jsonb -> 'companies') e);
    ELSE
      v_companies := NULL;
    END IF;

    CONTINUE WHEN p_company IS NOT NULL AND v_companies IS NOT NULL
      AND NOT (p_company = ANY(v_companies));

    -- Revalidate the effective window and author authority after the consent gate.
    v_now := clock_timestamp();
    CONTINUE WHEN v_grant_row.starts_at > v_now OR v_grant_row.expires_at <= v_now;
    CONTINUE WHEN NOT EXISTS (
      SELECT 1
      FROM tenant_data.members m
      WHERE m.tenant_id = p_tenant
        AND m.user_id = v_grant_row.granted_by_user_id
        AND m.active
    );

    v_grant_id := v_grant_row.grant_id;
    v_grant_companies := v_companies;
    EXIT;
  END LOOP;

  IF v_grant_id IS NULL THEN
    PERFORM set_config('app.current_tenant_id', coalesce(v_previous_tenant, ''), true);
    RAISE EXCEPTION 'OPERATOR_GRANT_REQUIRED: no current customer support grant covers this tenant, action, resource and company scope';
  END IF;

  IF p_company IS NOT NULL THEN
    v_company_filter := ARRAY[p_company];
  ELSE
    v_company_filter := v_grant_companies;
  END IF;

  IF p_resource = 'business' THEN
    SELECT coalesce(jsonb_agg(entry.row_json ORDER BY entry.rn) FILTER (WHERE entry.rn <= p_limit), '[]'::jsonb),
           (count(*) FILTER (WHERE entry.rn <= p_limit))::integer,
           count(*) > p_limit
      INTO v_rows, v_count, v_truncated
    FROM (
      SELECT to_jsonb(x) AS row_json, row_number() OVER (ORDER BY x.id) AS rn
      FROM (
        SELECT b.id, b.state
        FROM tenant_data.business b
        WHERE b.tenant_id = p_tenant
        ORDER BY b.id
        LIMIT p_limit + 1
      ) x
    ) entry;
  ELSIF p_resource = 'company_profiles' THEN
    SELECT coalesce(jsonb_agg(entry.row_json ORDER BY entry.rn) FILTER (WHERE entry.rn <= p_limit), '[]'::jsonb),
           (count(*) FILTER (WHERE entry.rn <= p_limit))::integer,
           count(*) > p_limit
      INTO v_rows, v_count, v_truncated
    FROM (
      SELECT to_jsonb(x) AS row_json, row_number() OVER (ORDER BY x.id) AS rn
      FROM (
        SELECT c.id, c.name, c.currency, c.branch
        FROM tenant_data.company_profiles c
        WHERE c.tenant_id = p_tenant
          AND (v_company_filter IS NULL OR c.id = ANY(v_company_filter))
        ORDER BY c.id
        LIMIT p_limit + 1
      ) x
    ) entry;
  ELSIF p_resource = 'accounts' THEN
    SELECT coalesce(jsonb_agg(entry.row_json ORDER BY entry.rn) FILTER (WHERE entry.rn <= p_limit), '[]'::jsonb),
           (count(*) FILTER (WHERE entry.rn <= p_limit))::integer,
           count(*) > p_limit
      INTO v_rows, v_count, v_truncated
    FROM (
      SELECT to_jsonb(x) AS row_json, row_number() OVER (ORDER BY x.code) AS rn
      FROM (
        SELECT a.code, a.title
        FROM tenant_data.accounts a
        WHERE a.tenant_id = p_tenant
        ORDER BY a.code
        LIMIT p_limit + 1
      ) x
    ) entry;
  ELSIF p_resource = 'journals' THEN
    SELECT coalesce(jsonb_agg(entry.row_json ORDER BY entry.rn) FILTER (WHERE entry.rn <= p_limit), '[]'::jsonb),
           (count(*) FILTER (WHERE entry.rn <= p_limit))::integer,
           count(*) > p_limit
      INTO v_rows, v_count, v_truncated
    FROM (
      SELECT to_jsonb(x) AS row_json, row_number() OVER (ORDER BY x.id) AS rn
      FROM (
        SELECT j.id, j.company, j.branch, j.posting_date, j.narrative
        FROM tenant_data.journals j
        WHERE j.tenant_id = p_tenant
          AND (v_company_filter IS NULL OR j.company = ANY(v_company_filter))
        ORDER BY j.id
        LIMIT p_limit + 1
      ) x
    ) entry;
  ELSE
    SELECT coalesce(jsonb_agg(entry.row_json ORDER BY entry.rn) FILTER (WHERE entry.rn <= p_limit), '[]'::jsonb),
           (count(*) FILTER (WHERE entry.rn <= p_limit))::integer,
           count(*) > p_limit
      INTO v_rows, v_count, v_truncated
    FROM (
      SELECT to_jsonb(x) AS row_json, row_number() OVER (ORDER BY x.journal_id, x.line_no) AS rn
      FROM (
        SELECT l.journal_id, l.line_no, l.account, l.debit, l.credit, j.company
        FROM tenant_data.journal_lines l
        JOIN tenant_data.journals j
          ON j.tenant_id = l.tenant_id AND j.id = l.journal_id
        WHERE l.tenant_id = p_tenant
          AND (v_company_filter IS NULL OR j.company = ANY(v_company_filter))
        ORDER BY l.journal_id, l.line_no
        LIMIT p_limit + 1
      ) x
    ) entry;
  END IF;

  -- Atomic accountability: the audit row commits with the read, or the read fails.
  INSERT INTO operator.operator_audit
    (actor_id, action, target_tenant_id, reason, request_id, payload_jsonb)
  VALUES (
    v_user::text,
    'OPERATOR_READ',
    p_tenant,
    p_reason,
    p_request_id,
    jsonb_build_object(
      'action', p_action,
      'resource', p_resource,
      'company', p_company,
      'grantId', v_grant_id,
      'scopeVersion', 1,
      'operatorSubject', v_subject,
      'operatorRoleId', v_binding_role,
      'mappingEpoch', v_binding_epoch,
      'issuer', v_binding_issuer,
      'audience', v_binding_audience,
      'assertionIssuedAt', v_binding_issued,
      'sessionId', v_session,
      'rowCount', v_count,
      'truncated', v_truncated
    )
  );

  PERFORM set_config('app.current_tenant_id', coalesce(v_previous_tenant, ''), true);

  RETURN jsonb_build_object(
    'tenantId', p_tenant,
    'resource', p_resource,
    'company', p_company,
    'grantId', v_grant_id,
    'rowCount', v_count,
    'truncated', v_truncated,
    'rows', v_rows
  );
END;
$fn$;

COMMENT ON FUNCTION operator.read_tenant_support(uuid, text, text, text, text, text, text, integer) IS
  'PIVOT-007 revision 1: the function-mediated operator read boundary. Requires the bearer-derived session digest plus verified AUTH-007 binding/mapping/issuer/audience/assurance/source-age, credential-epoch and session state under the shared authority gate; validates the installed writer protocol; serializes customer consent through the consent gate; scopes tenant RLS itself; commits one append-only operator audit row with the rows. Fixed search_path, static SQL, EXECUTE only to saven_operator_read.';

-- ---------------------------------------------------------------------------
-- 7. Independent durable denial evidence with honest attribution
-- ---------------------------------------------------------------------------

CREATE FUNCTION operator.log_operator_read_denial(
  p_tenant uuid,
  p_session_proof text,
  p_resource text,
  p_action text,
  p_company text,
  p_denial_code text,
  p_reason text,
  p_request_id text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, operator, tenant_data
AS $fn$
DECLARE
  v_session_text text;
  v_session_id uuid;
  v_session_row record;
  v_actor text := 'unverified';
  v_attribution text := 'unverified';
  v_verified_subject text;
  v_verified_role text;
  v_verified_epoch bigint;
  v_claimed_subject text;
  v_now timestamptz;
  v_binding record;
  v_user record;
  v_session record;
  v_role record;
  v_policy record;
BEGIN
  IF p_denial_code IS NULL OR btrim(p_denial_code) = '' OR length(p_denial_code) > 80 THEN
    RAISE EXCEPTION 'OPERATOR_ARGUMENT_INVALID: a bounded denial code is required';
  END IF;
  IF p_resource IS NOT NULL AND length(p_resource) > 80 THEN
    RAISE EXCEPTION 'OPERATOR_ARGUMENT_INVALID: the denied resource is too long';
  END IF;
  IF p_action IS NOT NULL AND length(p_action) > 120 THEN
    RAISE EXCEPTION 'OPERATOR_ARGUMENT_INVALID: the denied action is too long';
  END IF;
  IF p_company IS NOT NULL AND length(p_company) > 120 THEN
    RAISE EXCEPTION 'OPERATOR_ARGUMENT_INVALID: the denied company scope is too long';
  END IF;
  IF p_reason IS NOT NULL AND length(p_reason) > 1000 THEN
    RAISE EXCEPTION 'OPERATOR_ARGUMENT_INVALID: the denial reason is too long';
  END IF;
  IF p_request_id IS NOT NULL AND length(p_request_id) > 200 THEN
    RAISE EXCEPTION 'OPERATOR_ARGUMENT_INVALID: the request id is too long';
  END IF;

  v_session_text := nullif(current_setting('app.operator_session_id', true), '');
  IF v_session_text IS NOT NULL AND pg_input_is_valid(v_session_text, 'uuid')
     AND p_session_proof IS NOT NULL AND p_session_proof ~ '^[0-9a-f]{64}$' THEN
    v_session_id := v_session_text::uuid;
    SELECT b.subject, b.issuer, b.audience, b.mapping_epoch, b.operator_role_id,
           b.assurance_class, b.binding_scheme, b.source_issued_at, b.source_expires_at
      INTO v_binding
    FROM operator.access_session_binding b
    WHERE b.session_id = v_session_id;
    IF FOUND THEN
      v_claimed_subject := v_binding.subject;
      SELECT s.user_id, s.realm, s.revoked_at, s.idle_expires_at, s.absolute_expires_at,
             s.credential_version
        INTO v_session_row
      FROM auth.sessions s
      WHERE s.id = v_session_id AND s.token_hash = p_session_proof;
      IF FOUND THEN
        SELECT u.status, u.credential_version INTO v_user
        FROM auth.users u WHERE u.id = v_session_row.user_id;
        SELECT ai.user_id, ai.status, ai.mapping_epoch, ai.operator_role_id,
               ai.assurance_class, ai.effective_from, ai.effective_to
          INTO v_role
        FROM operator.access_identity ai WHERE ai.subject = v_binding.subject;
        SELECT p.issuer, p.audience, p.required_assurance, p.max_source_age_seconds,
               p.max_clock_skew_seconds
          INTO v_policy
        FROM operator.access_read_policy p
        WHERE p.policy_key = 'operator_read' AND p.is_active
          AND p.effective_from <= clock_timestamp()
          AND (p.effective_to IS NULL OR p.effective_to > clock_timestamp())
        ORDER BY p.version DESC LIMIT 1;
        v_now := clock_timestamp();
        IF FOUND AND v_role.user_id IS NOT NULL
           AND v_binding.binding_scheme = 'generation-v1'
           AND v_role.status = 'active'
           AND v_role.effective_from <= v_now
           AND (v_role.effective_to IS NULL OR v_role.effective_to > v_now)
           AND v_binding.mapping_epoch = v_role.mapping_epoch
           AND v_binding.operator_role_id = v_role.operator_role_id
           AND v_binding.assurance_class = v_role.assurance_class
           AND v_binding.issuer = v_policy.issuer
           AND v_binding.audience = v_policy.audience
           AND v_binding.assurance_class = v_policy.required_assurance
           AND v_binding.source_issued_at IS NOT NULL
           AND v_binding.source_issued_at >= v_now - make_interval(secs => v_policy.max_source_age_seconds + v_policy.max_clock_skew_seconds)
           AND v_binding.source_issued_at <= v_now + make_interval(secs => v_policy.max_clock_skew_seconds)
           AND v_binding.source_expires_at > v_now
           AND v_session_row.user_id = v_role.user_id
           AND v_session_row.realm = 'operator'
           AND v_session_row.revoked_at IS NULL
           AND v_session_row.idle_expires_at > v_now
           AND v_session_row.absolute_expires_at > v_now
           AND v_user.status = 'active'
           AND v_user.credential_version = v_session_row.credential_version THEN
          v_attribution := 'verified';
          v_actor := v_role.user_id::text;
          v_verified_subject := v_binding.subject;
          v_verified_role := v_binding.operator_role_id;
          v_verified_epoch := v_binding.mapping_epoch;
        END IF;
      END IF;
    END IF;
  END IF;

  INSERT INTO operator.operator_audit
    (actor_id, action, target_tenant_id, reason, request_id, payload_jsonb)
  VALUES (
    left(v_actor, 200),
    'OPERATOR_READ_DENIED',
    p_tenant,
    coalesce(p_reason, ''),
    p_request_id,
    jsonb_build_object(
      'denialCode', p_denial_code,
      'attribution', v_attribution,
      'resource', p_resource,
      'action', p_action,
      'company', p_company,
      'verifiedSubject', v_verified_subject,
      'verifiedRoleId', v_verified_role,
      'verifiedMappingEpoch', v_verified_epoch,
      'claimedSubject', v_claimed_subject,
      'claimedSessionId', CASE WHEN v_session_id IS NOT NULL THEN v_session_id::text ELSE NULL END,
      'durability', 'independent-transaction'
    )
  );
END;
$fn$;

COMMENT ON FUNCTION operator.log_operator_read_denial(uuid, text, text, text, text, text, text, text) IS
  'PIVOT-007 revision 1: independent-transaction denial evidence. Attribution is verified only when the bearer-derived session digest, liveness, credential epoch, mapping continuity, role/assurance and configured issuer/audience/source-age policy all still match; otherwise actor_id is explicitly unverified and the payload carries only labelled claimed/attempted metadata. Never attributes an old or reassigned binding to a current principal and grants no read authority.';

-- ---------------------------------------------------------------------------
-- 8. Ownership, EXECUTE allow-list and post-install validation
-- ---------------------------------------------------------------------------

RESET ROLE;

ALTER FUNCTION operator.assert_operator_definer_authority(text, boolean) OWNER TO saven_migrator;
ALTER FUNCTION operator.assert_read_authority_protocol() OWNER TO saven_operator_definer;
ALTER FUNCTION operator.read_tenant_support(uuid, text, text, text, text, text, text, integer)
  OWNER TO saven_operator_definer;
ALTER FUNCTION operator.log_operator_read_denial(uuid, text, text, text, text, text, text, text)
  OWNER TO saven_operator_definer;

REVOKE ALL ON FUNCTION operator.read_tenant_support(uuid, text, text, text, text, text, text, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION operator.log_operator_read_denial(uuid, text, text, text, text, text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION operator.assert_read_authority_protocol() FROM PUBLIC;

GRANT EXECUTE ON FUNCTION operator.read_tenant_support(uuid, text, text, text, text, text, text, integer)
  TO saven_operator_read;
GRANT EXECUTE ON FUNCTION operator.log_operator_read_denial(uuid, text, text, text, text, text, text, text)
  TO saven_operator_read;

DO $post_authority$
BEGIN
  PERFORM operator.assert_operator_definer_authority('post', false);
  PERFORM operator.assert_read_authority_protocol();
END
$post_authority$;

-- EXECUTE allow-list (exact grantees for the two runtime functions).
DO $validate$
DECLARE
  fn record;
BEGIN
  FOR fn IN
    SELECT p.oid, p.proname, p.proconfig, p.proacl, p.proowner
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'operator'
      AND p.proname IN ('read_tenant_support', 'log_operator_read_denial',
                        'assert_read_authority_protocol')
  LOOP
    IF fn.proconfig IS NULL
       OR NOT ('search_path=pg_catalog, operator, tenant_data' = ANY(fn.proconfig)) THEN
      RAISE EXCEPTION 'PIVOT-007: % must use the exact fixed search_path', fn.proname;
    END IF;
    IF fn.proname = 'assert_read_authority_protocol' THEN
      IF has_function_privilege('saven_operator_read', fn.oid, 'EXECUTE') THEN
        RAISE EXCEPTION 'PIVOT-007: the protocol validator must not be exposed to the runtime';
      END IF;
    ELSE
      IF NOT has_function_privilege('saven_operator_read', fn.oid, 'EXECUTE') THEN
        RAISE EXCEPTION 'PIVOT-007: % must be executable by saven_operator_read', fn.proname;
      END IF;
      IF has_function_privilege('saven_operator_admin', fn.oid, 'EXECUTE')
         OR has_function_privilege('saven_customer_app', fn.oid, 'EXECUTE')
         OR has_function_privilege('saven_auth_service', fn.oid, 'EXECUTE') THEN
        RAISE EXCEPTION 'PIVOT-007: % has an EXECUTE grant outside the saven_operator_read allow-list', fn.proname;
      END IF;
    END IF;
    IF EXISTS (
      SELECT 1 FROM pg_proc p,
           LATERAL aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
      WHERE p.oid = fn.oid AND a.grantee = 0 AND a.privilege_type = 'EXECUTE'
    ) THEN
      RAISE EXCEPTION 'PIVOT-007: % must not grant EXECUTE to PUBLIC', fn.proname;
    END IF;
  END LOOP;

  IF (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'operator'
        AND p.proname IN ('read_tenant_support', 'log_operator_read_denial',
                          'assert_read_authority_protocol')) <> 3 THEN
    RAISE EXCEPTION 'PIVOT-007: all three operator functions must exist after installation';
  END IF;
END
$validate$;

COMMIT;
