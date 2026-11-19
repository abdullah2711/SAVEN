-- PIVOT-007: least-privileged, function-mediated customer-granted operator reads.
--
-- Applied by the SEPARATE OFFLINE ADMINISTRATOR (superuser) because it provisions the
-- dedicated `saven_operator_definer` NOLOGIN owner for exactly two operator functions and
-- transfers only their ownership. It is additive: it creates no tenant/operator table, no
-- trigger and no policy, and rewrites no applied migration bytes.
--
-- Authority model:
--   * the verified operator actor comes only from the AUTH-007 durable session binding in
--     transaction context (`app.operator_session_id`), never from a caller argument; a
--     `p_operator_id` argument does not exist;
--   * the current mapping must still match the binding generation, role and assurance, the
--     local principal/session/role must be active and effective, and the Access source
--     assertion must not be expired; mapping/role authority is serialized against the
--     AUTH-006 gate (shared) so a concurrent authority change cannot commit mid-read;
--   * the customer grant is a current `tenant_data.support_grants` row for that exact
--     Access subject, tenant, action key, resource and company scope, authored by a still
--     active tenant member; a reason string never supplies identity or consent;
--   * a successful read and its `operator.operator_audit` row commit atomically;
--   * a refused read raises, and the application records the refusal through
--     `operator.log_operator_read_denial` in an INDEPENDENT transaction. PostgreSQL has no
--     autonomous transaction, so this file does not claim that an in-transaction denial
--     insert survives the rollback.
--
-- Least privilege: fixed `search_path = pg_catalog, operator, tenant_data` on both
-- functions, schema-qualified objects, no dynamic SQL, explicit EXECUTE only to
-- `saven_operator_read`, no PUBLIC EXECUTE, no runtime `BYPASSRLS`/superuser/table
-- ownership, and no direct tenant-table grant to any operator runtime role.

BEGIN;

-- ---------------------------------------------------------------------------
-- 0. Preflight and reusable ownership checks
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
    RAISE EXCEPTION '50-functions.sql provisions a dedicated function owner: run it as the separate offline administrator (superuser)';
  END IF;

  FOREACH r IN ARRAY ARRAY['auth','operator','tenant_data'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = r) THEN
      missing := missing || ('schema ' || r);
    END IF;
  END LOOP;

  FOREACH required_table IN ARRAY ARRAY[
    'auth.users','auth.sessions','auth.roles',
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
      AND p.proname IN ('read_tenant_support', 'log_operator_read_denial')
  ) THEN
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
  'PIVOT-007: NOLOGIN owner of operator.read_tenant_support() and operator.log_operator_read_denial() only. Fixed search paths, enumerated column reads on the verified-identity/grant/read projection, INSERT on the append-only operator audit, no table ownership, schema CREATE, direct tenant runtime grant, BYPASSRLS or superuser.';

SET LOCAL ROLE saven_migrator;

-- ---------------------------------------------------------------------------
-- 1. Enumerated grants for the definer's verification and read surface
--
-- These are the only objects the definer can reach. Operator/auth runtime roles keep
-- zero tenant-data authority: only this SECURITY DEFINER boundary can read tenant rows.
-- ---------------------------------------------------------------------------

GRANT USAGE ON SCHEMA auth TO saven_operator_definer;
GRANT USAGE ON SCHEMA tenant_data TO saven_operator_definer;

-- Verified operator identity: AUTH-007 session binding plus the current mapping/role.
GRANT SELECT (
  subject, user_id, operator_role_id, assurance_class, status,
  mapping_epoch, effective_from, effective_to
) ON operator.access_identity TO saven_operator_definer;
GRANT SELECT (
  session_id, subject, mapping_epoch, binding_scheme,
  operator_role_id, assurance_class, source_expires_at
) ON operator.access_session_binding TO saven_operator_definer;

GRANT SELECT (id, status) ON auth.users TO saven_operator_definer;
GRANT SELECT (
  id, user_id, realm, idle_expires_at, absolute_expires_at, revoked_at
) ON auth.sessions TO saven_operator_definer;
-- PostgreSQL requires an UPDATE privilege for SELECT ... FOR SHARE row locking. The
-- definer owns only the two read functions and performs no write; these single-column
-- grants exist solely so the verification read can hold the row against a concurrent
-- revocation/credential change until the transaction ends.
GRANT UPDATE (status) ON auth.users TO saven_operator_definer;
GRANT UPDATE (revoked_at) ON auth.sessions TO saven_operator_definer;
GRANT SELECT (
  role_id, is_operator, is_active, requires_mfa, assurance_class,
  effective_from, effective_to
) ON auth.roles TO saven_operator_definer;

-- Customer consent and the reviewed read projection.
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

-- The definer executes tenant-table RLS policies as a non-BYPASSRLS owner; it needs
-- only the read-only tenant-context helper that those policies already call.
GRANT EXECUTE ON FUNCTION tenant_data.current_tenant_id() TO saven_operator_definer;

-- ---------------------------------------------------------------------------
-- 2. Audited, customer-granted operator read
-- ---------------------------------------------------------------------------

CREATE FUNCTION operator.read_tenant_support(
  p_tenant uuid,
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
  v_source_expires timestamptz;
  v_user uuid;
  v_map_epoch bigint;
  v_map_role text;
  v_map_assurance text;
  v_map_status text;
  v_map_from timestamptz;
  v_map_to timestamptz;
  v_user_status text;
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
  v_previous_tenant text;
  v_grant_row record;
  v_grant_id text;
  v_grant_companies text[];
  v_companies text[];
  v_company_filter text[];
  v_rows jsonb;
  v_count integer;
  v_truncated boolean;
BEGIN
  IF p_tenant IS NULL THEN
    RAISE EXCEPTION 'OPERATOR_ARGUMENT_INVALID: a target tenant is required';
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
  IF p_request_id IS NOT NULL AND length(p_request_id) > 200 THEN
    RAISE EXCEPTION 'OPERATOR_ARGUMENT_INVALID: the request id is too long';
  END IF;
  IF p_limit IS NULL OR p_limit < 1 OR p_limit > 500 THEN
    RAISE EXCEPTION 'OPERATOR_ARGUMENT_INVALID: the row limit must be between 1 and 500';
  END IF;

  -- Same transaction-scoped gate as AUTH-006/007 admission: hold it shared so a mapping,
  -- membership or role authority writer cannot commit while this read is in flight.
  PERFORM pg_advisory_xact_lock_shared(hashtextextended('saven.auth.authority_gate', 0));

  v_session_text := nullif(current_setting('app.operator_session_id', true), '');
  IF v_session_text IS NULL OR NOT pg_input_is_valid(v_session_text, 'uuid') THEN
    RAISE EXCEPTION 'OPERATOR_CONTEXT_REQUIRED: a verified operator session context is required';
  END IF;
  v_session := v_session_text::uuid;

  SELECT b.subject, b.mapping_epoch, b.operator_role_id, b.assurance_class,
         b.binding_scheme, b.source_expires_at,
         ai.user_id, ai.status, ai.mapping_epoch, ai.operator_role_id,
         ai.assurance_class, ai.effective_from, ai.effective_to
    INTO v_subject, v_binding_epoch, v_binding_role, v_binding_assurance,
         v_binding_scheme, v_source_expires,
         v_user, v_map_status, v_map_epoch, v_map_role,
         v_map_assurance, v_map_from, v_map_to
  FROM operator.access_session_binding b
  JOIN operator.access_identity ai ON ai.subject = b.subject
  WHERE b.session_id = v_session;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'OPERATOR_CONTEXT_REQUIRED: the operator session has no verified Access binding';
  END IF;

  -- Lock order matches AUTH-007 admission: gate (held shared) -> principal -> session.
  SELECT u.status INTO v_user_status
  FROM auth.users u
  WHERE u.id = v_user
  FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'OPERATOR_ACCESS_DENIED: the operator principal no longer exists';
  END IF;

  SELECT s.realm, s.revoked_at, s.idle_expires_at, s.absolute_expires_at, s.user_id
    INTO v_session_realm, v_session_revoked, v_session_idle, v_session_absolute, v_session_user
  FROM auth.sessions s
  WHERE s.id = v_session
  FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'OPERATOR_CONTEXT_REQUIRED: the operator session no longer exists';
  END IF;

  SELECT r.is_operator, r.is_active, r.requires_mfa, r.effective_from, r.effective_to
    INTO v_role_is_operator, v_role_active, v_role_requires_mfa, v_role_from, v_role_to
  FROM auth.roles r
  WHERE r.role_id = v_map_role;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'OPERATOR_ACCESS_DENIED: the mapped operator role no longer exists';
  END IF;

  IF v_subject IS NULL
     OR v_binding_scheme IS DISTINCT FROM 'generation-v1'
     OR v_binding_epoch IS DISTINCT FROM v_map_epoch
     OR v_binding_role IS DISTINCT FROM v_map_role
     OR v_binding_assurance IS DISTINCT FROM v_map_assurance
     OR v_map_status IS DISTINCT FROM 'active'
     OR v_map_assurance IS NULL
     OR v_map_assurance = 'single_factor'
     OR v_map_from > now()
     OR (v_map_to IS NOT NULL AND v_map_to <= now())
     OR v_user_status IS DISTINCT FROM 'active'
     OR v_role_is_operator IS NOT TRUE
     OR v_role_active IS NOT TRUE
     OR v_role_requires_mfa IS NOT TRUE
     OR v_role_from > now()
     OR (v_role_to IS NOT NULL AND v_role_to <= now()) THEN
    RAISE EXCEPTION 'OPERATOR_ACCESS_DENIED: the operator Access mapping is no longer current';
  END IF;

  IF v_session_realm IS DISTINCT FROM 'operator'
     OR v_session_revoked IS NOT NULL
     OR v_session_user IS DISTINCT FROM v_user
     OR v_session_idle <= now()
     OR v_session_absolute <= now() THEN
    RAISE EXCEPTION 'OPERATOR_ACCESS_EXPIRED: the operator session is not current';
  END IF;

  IF v_source_expires IS NULL OR v_source_expires <= now() THEN
    RAISE EXCEPTION 'OPERATOR_ACCESS_EXPIRED: the verified Access assertion has expired';
  END IF;

  -- From here on the function scopes the tenant itself. The caller's transaction context
  -- is never authority and is restored before returning.
  v_previous_tenant := current_setting('app.current_tenant_id', true);
  PERFORM set_config('app.current_tenant_id', p_tenant::text, true);

  v_grant_id := NULL;
  v_grant_companies := NULL;
  FOR v_grant_row IN
    SELECT g.grant_id, g.granted_by_user_id, g.scope_jsonb, g.actions_jsonb
    FROM tenant_data.support_grants g
    WHERE g.tenant_id = p_tenant
      AND g.grantee_actor_id = v_subject
      AND g.is_active
      AND g.revoked_at IS NULL
      AND g.starts_at <= now()
      AND g.expires_at > now()
    ORDER BY g.grant_id
  LOOP
    CONTINUE WHEN jsonb_typeof(v_grant_row.actions_jsonb) IS DISTINCT FROM 'array';
    CONTINUE WHEN NOT (v_grant_row.actions_jsonb ? p_action);

    CONTINUE WHEN jsonb_typeof(v_grant_row.scope_jsonb) IS DISTINCT FROM 'object';
    CONTINUE WHEN (v_grant_row.scope_jsonb ->> 'version') IS DISTINCT FROM '1';
    CONTINUE WHEN (v_grant_row.scope_jsonb - 'version' - 'resources' - 'companies') <> '{}'::jsonb;
    CONTINUE WHEN jsonb_typeof(v_grant_row.scope_jsonb -> 'resources') IS DISTINCT FROM 'array';
    CONTINUE WHEN NOT (v_grant_row.scope_jsonb -> 'resources' ? p_resource);

    IF v_grant_row.scope_jsonb ? 'companies' THEN
      CONTINUE WHEN jsonb_typeof(v_grant_row.scope_jsonb -> 'companies') IS DISTINCT FROM 'array';
      v_companies := ARRAY(SELECT jsonb_array_elements_text(v_grant_row.scope_jsonb -> 'companies'));
    ELSE
      v_companies := NULL;
    END IF;
    CONTINUE WHEN p_company IS NOT NULL AND v_companies IS NOT NULL AND NOT (p_company = ANY(v_companies));

    -- Consent integrity: a grant is customer-authored only while its authoring principal
    -- remains an active member of this tenant. Deactivation therefore narrows authority.
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

COMMENT ON FUNCTION operator.read_tenant_support(uuid, text, text, text, text, text, integer) IS
  'PIVOT-007: the single function-mediated operator read boundary. Verifies the AUTH-007 Access actor/mapping/session under the shared authority gate, requires a current customer support grant for tenant/action/resource/company, scopes tenant RLS itself, and commits one append-only operator audit row with the returned rows. Fixed search_path, no dynamic SQL, EXECUTE only to saven_operator_read.';

-- ---------------------------------------------------------------------------
-- 3. Independent durable denial evidence
--
-- A refused read raises and therefore cannot retain an in-transaction audit insert. The
-- application calls this function in a fresh transaction after catching the refusal.
-- Identity is still resolved from the verified session context; no operator id argument
-- exists and the caller cannot nominate another actor.
-- ---------------------------------------------------------------------------

CREATE FUNCTION operator.log_operator_read_denial(
  p_tenant uuid,
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
  v_session uuid;
  v_actor text;
  v_subject text;
  v_role text;
  v_epoch bigint;
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

  v_actor := 'unverified';
  v_session_text := nullif(current_setting('app.operator_session_id', true), '');
  IF v_session_text IS NOT NULL AND pg_input_is_valid(v_session_text, 'uuid') THEN
    v_session := v_session_text::uuid;
    SELECT b.subject, b.operator_role_id, b.mapping_epoch, ai.user_id::text
      INTO v_subject, v_role, v_epoch, v_actor
    FROM operator.access_session_binding b
    JOIN operator.access_identity ai ON ai.subject = b.subject
    WHERE b.session_id = v_session
      AND ai.status = 'active';
    IF NOT FOUND THEN
      v_actor := 'unverified';
      v_subject := NULL;
      v_role := NULL;
      v_epoch := NULL;
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
      'resource', p_resource,
      'action', p_action,
      'company', p_company,
      'operatorSubject', v_subject,
      'operatorRoleId', v_role,
      'mappingEpoch', v_epoch,
      'claimedSessionId', CASE WHEN v_session IS NOT NULL THEN v_session::text ELSE NULL END,
      'durability', 'independent-transaction'
    )
  );
END;
$fn$;

COMMENT ON FUNCTION operator.log_operator_read_denial(uuid, text, text, text, text, text, text) IS
  'PIVOT-007: independent-transaction denial evidence for the operator read boundary. Best-effort actor resolution from the verified session binding; append-only operator audit insert; grants no read authority and accepts no operator id argument.';

-- ---------------------------------------------------------------------------
-- 4. Ownership, EXECUTE allow-list and post-install validation
-- ---------------------------------------------------------------------------

RESET ROLE;

ALTER FUNCTION operator.read_tenant_support(uuid, text, text, text, text, text, integer)
  OWNER TO saven_operator_definer;
ALTER FUNCTION operator.log_operator_read_denial(uuid, text, text, text, text, text, text)
  OWNER TO saven_operator_definer;

REVOKE ALL ON FUNCTION operator.read_tenant_support(uuid, text, text, text, text, text, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION operator.log_operator_read_denial(uuid, text, text, text, text, text, text) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION operator.read_tenant_support(uuid, text, text, text, text, text, integer)
  TO saven_operator_read;
GRANT EXECUTE ON FUNCTION operator.log_operator_read_denial(uuid, text, text, text, text, text, text)
  TO saven_operator_read;

DO $validate$
DECLARE
  fn record;
BEGIN
  FOR fn IN
    SELECT p.oid, p.proname, pg_get_userbyid(p.proowner) AS owner_name,
           p.prosecdef, p.proconfig, p.proacl, p.proowner
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'operator'
      AND p.proname IN ('read_tenant_support', 'log_operator_read_denial')
  LOOP
    IF fn.owner_name <> 'saven_operator_definer' THEN
      RAISE EXCEPTION 'PIVOT-007: % must be owned by saven_operator_definer, found %', fn.proname, fn.owner_name;
    END IF;
    IF fn.prosecdef IS NOT TRUE THEN
      RAISE EXCEPTION 'PIVOT-007: % must be SECURITY DEFINER', fn.proname;
    END IF;
    IF fn.proconfig IS NULL
       OR NOT ('search_path=pg_catalog, operator, tenant_data' = ANY(fn.proconfig)) THEN
      RAISE EXCEPTION 'PIVOT-007: % must use the exact fixed search_path', fn.proname;
    END IF;
    IF NOT has_function_privilege('saven_operator_read', fn.oid, 'EXECUTE') THEN
      RAISE EXCEPTION 'PIVOT-007: % must be executable by saven_operator_read', fn.proname;
    END IF;
    IF has_function_privilege('saven_operator_admin', fn.oid, 'EXECUTE')
       OR has_function_privilege('saven_customer_app', fn.oid, 'EXECUTE')
       OR has_function_privilege('saven_auth_service', fn.oid, 'EXECUTE') THEN
      RAISE EXCEPTION 'PIVOT-007: % has an EXECUTE grant outside the saven_operator_read allow-list', fn.proname;
    END IF;
    IF EXISTS (
      SELECT 1
      FROM aclexplode(coalesce(fn.proacl, acldefault('f', fn.proowner))) AS a
      WHERE a.grantee = 0 AND a.privilege_type = 'EXECUTE'
    ) THEN
      RAISE EXCEPTION 'PIVOT-007: % must not grant EXECUTE to PUBLIC', fn.proname;
    END IF;
  END LOOP;

  IF (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'operator'
        AND p.proname IN ('read_tenant_support', 'log_operator_read_denial')) <> 2 THEN
    RAISE EXCEPTION 'PIVOT-007: both operator functions must exist after installation';
  END IF;
END
$validate$;

COMMIT;
