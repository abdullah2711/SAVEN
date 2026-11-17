-- PIVOT-006: append-only actor-bound tenant change audit (payload 041).
--
-- This is a new immutable payload. It never edits 040/042 bytes and is attached by
-- the explicit dispatcher in 40-triggers.sql. Applied by a member of saven_migrator
-- (the audit writer is a SECURITY DEFINER function owned by that DDL role; no new
-- runtime role, superuser or BYPASSRLS is created).
--
-- Behaviour:
--   * business-table INSERT/UPDATE/DELETE rows are recorded in tenant_data.audit_event
--     in the same transaction as the mutation;
--   * the actor and tenant come only from the verified transaction context and the
--     tenant-local principal projection, never from a client header/body value;
--   * before/after rows, action, target table and primary-key target identity are
--     retained, with an audit schema version and transaction id;
--   * missing/foreign context fails closed, so an unaudited runtime mutation cannot
--     commit;
--   * tenant_data.audit (native command audit) is preserved and is never rewritten;
--   * audit storage itself is append-only: UPDATE/DELETE/TRUNCATE raise.
--
-- The audit writer skips audit/audit_event defensively so an accidental attachment
-- cannot recurse. The dispatcher attaches the writer only to the reviewed business
-- table list and attaches the append-only guards to the two audit tables.

BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'saven_migrator') THEN
    RAISE EXCEPTION 'Run 00-roles.sql before 041-audit.sql';
  END IF;
  IF NOT pg_has_role(current_user, 'saven_migrator', 'MEMBER')
     AND NOT (SELECT rolsuper FROM pg_roles WHERE rolname = current_user) THEN
    RAISE EXCEPTION 'Run 041-audit.sql as a member of saven_migrator';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'tenant_data') THEN
    RAISE EXCEPTION 'Run 20-tenant-schema.sql before 041-audit.sql';
  END IF;
  IF NOT EXISTS (
       SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'tenant_data' AND c.relname = 'audit_event' AND c.relkind = 'r')
     OR NOT EXISTS (
       SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'tenant_data' AND c.relname = 'audit' AND c.relkind = 'r')
     OR NOT EXISTS (
       SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'tenant_data' AND c.relname = 'members' AND c.relkind = 'r') THEN
    RAISE EXCEPTION 'Run 20-tenant-schema.sql and 30-rls-policies.sql before 041-audit.sql';
  END IF;
  -- Immutable payload: refuse a second application instead of silently replacing it.
  IF EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'tenant_data' AND p.proname LIKE 'immutability\_041\_%'
  ) THEN
    RAISE EXCEPTION 'PIVOT-006: 041-audit.sql is already applied and is immutable; add a new payload version instead of reapplying it';
  END IF;
END $$;

SET LOCAL ROLE saven_migrator;

-- ---------------------------------------------------------------------
-- Stable primary-key target identity for any tenant table
-- ---------------------------------------------------------------------

CREATE FUNCTION tenant_data.immutability_041_row_key(p_table regclass, p_row jsonb)
RETURNS text
LANGUAGE sql STABLE
SET search_path = pg_catalog
AS $fn$
  SELECT jsonb_object_agg(a.attname, p_row -> a.attname ORDER BY a.attnum)::text
  FROM pg_index i
  JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey)
  WHERE i.indrelid = p_table AND i.indisprimary
$fn$;

COMMENT ON FUNCTION tenant_data.immutability_041_row_key(regclass, jsonb) IS
  'PIVOT-006 payload 041: canonical JSON target identity built from the table primary key columns. Catalog-driven; no per-table hardcoded key list.';

-- ---------------------------------------------------------------------
-- Actor-bound tenant change audit
-- ---------------------------------------------------------------------

CREATE FUNCTION tenant_data.immutability_041_audit_row()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, tenant_data
AS $fn$
DECLARE
  v_tenant uuid;
  v_user uuid;
  v_actor text;
  v_row jsonb;
  v_before jsonb;
  v_after jsonb;
  v_entity_id text;
BEGIN
  -- Defensive recursion guard: audit storage is append-only and never re-audited.
  IF TG_TABLE_NAME IN ('audit', 'audit_event') THEN
    RETURN NULL;
  END IF;

  v_tenant := CASE WHEN TG_OP = 'DELETE' THEN OLD.tenant_id ELSE NEW.tenant_id END;
  v_user := tenant_data.current_user_id();
  IF v_tenant IS NULL
     OR v_tenant IS DISTINCT FROM tenant_data.current_tenant_id()
     OR v_user IS NULL THEN
    RAISE EXCEPTION 'AUDIT_CONTEXT_REQUIRED: a tenant change requires verified tenant and principal context';
  END IF;

  -- Resolve the canonical tenant-local actor text id from verified context. The
  -- audit never trusts a caller-supplied actor/created_by/updated_by value. Do not
  -- filter on active here: the mutation's RLS admission already established a live
  -- session, and a self-deactivation still has a verified actor identity.
  SELECT m.user_id INTO v_actor
  FROM tenant_data.members m
  WHERE m.tenant_id = v_tenant AND m.user_uuid = v_user;
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'AUDIT_ACTOR_UNVERIFIED: the current principal has no tenant-local member mapping';
  END IF;

  v_row := CASE WHEN TG_OP = 'DELETE' THEN to_jsonb(OLD) ELSE to_jsonb(NEW) END;
  v_entity_id := tenant_data.immutability_041_row_key(TG_RELID, v_row);
  IF v_entity_id IS NULL OR length(btrim(v_entity_id)) = 0 THEN
    RAISE EXCEPTION 'AUDIT_TARGET_UNRESOLVED: table % has no resolvable primary-key target', TG_TABLE_NAME;
  END IF;

  v_before := CASE WHEN TG_OP IN ('UPDATE', 'DELETE') THEN to_jsonb(OLD) ELSE NULL END;
  v_after := CASE WHEN TG_OP IN ('INSERT', 'UPDATE') THEN to_jsonb(NEW) ELSE NULL END;

  INSERT INTO tenant_data.audit_event
    (tenant_id, actor_id, event, entity_type, entity_id, detail_jsonb,
     origin_type, origin_user_id, request_id, happened_at)
  VALUES (
    v_tenant,
    v_actor,
    'TENANT_CHANGE_' || TG_OP,
    TG_TABLE_NAME,
    v_entity_id,
    jsonb_build_object(
      'action', TG_OP,
      'schemaVersion', 1,
      'version', 1,
      'transactionId', pg_current_xact_id()::text,
      'rowVersion', coalesce(v_after ->> 'updated_at', v_before ->> 'updated_at'),
      'before', v_before,
      'after', v_after
    ),
    'human',
    v_actor,
    NULL,
    now()
  );
  RETURN NULL;
END;
$fn$;

COMMENT ON FUNCTION tenant_data.immutability_041_audit_row() IS
  'PIVOT-006 payload 041: append-only actor-bound tenant change audit. Verified actor/tenant from transaction context, canonical primary-key target, before/after/version, atomic with the business mutation. SECURITY DEFINER owned by saven_migrator; no runtime superuser/BYPASSRLS.';

-- ---------------------------------------------------------------------
-- Append-only audit storage guards
-- ---------------------------------------------------------------------

CREATE FUNCTION tenant_data.immutability_041_audit_append_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $fn$
BEGIN
  RAISE EXCEPTION 'AUDIT_IMMUTABLE: audit rows are append-only and cannot be updated or deleted';
END;
$fn$;

CREATE FUNCTION tenant_data.immutability_041_audit_truncate_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $fn$
BEGIN
  RAISE EXCEPTION 'AUDIT_TRUNCATE_DENIED: audit tables cannot be truncated';
END;
$fn$;

COMMENT ON FUNCTION tenant_data.immutability_041_audit_append_guard() IS
  'PIVOT-006 payload 041: audit and audit_event rows are append-only; UPDATE/DELETE raise.';
COMMENT ON FUNCTION tenant_data.immutability_041_audit_truncate_guard() IS
  'PIVOT-006 payload 041: audit and audit_event cannot be TRUNCATEd.';

REVOKE ALL ON FUNCTION tenant_data.immutability_041_row_key(regclass, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION tenant_data.immutability_041_audit_row() FROM PUBLIC;
REVOKE ALL ON FUNCTION tenant_data.immutability_041_audit_append_guard() FROM PUBLIC;
REVOKE ALL ON FUNCTION tenant_data.immutability_041_audit_truncate_guard() FROM PUBLIC;

-- Validate the audit writer's ownership and fixed search path at install time.
DO $$
DECLARE
  v_bad text;
BEGIN
  SELECT string_agg(p.proname, ', ') INTO v_bad
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  JOIN pg_roles r ON r.oid = p.proowner
  WHERE n.nspname = 'tenant_data'
    AND p.proname = 'immutability_041_audit_row'
    AND (NOT p.prosecdef OR r.rolname <> 'saven_migrator'
         OR NOT EXISTS (SELECT 1 FROM unnest(coalesce(p.proconfig, ARRAY[]::text[])) c
                        WHERE c LIKE 'search_path=%'));
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'PIVOT-006: audit writer must be SECURITY DEFINER owned by saven_migrator with a fixed search_path: %', v_bad;
  END IF;
END $$;

COMMIT;
