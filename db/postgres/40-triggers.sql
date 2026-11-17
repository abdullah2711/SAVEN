-- PIVOT-005/PIVOT-006: explicit dispatcher for the versioned immutability and audit
-- payloads.
--
-- Attaches triggers; contains no immutability/audit logic. Every payload is a separate
-- immutable migration:
--   * 040-posted-immutability.sql  — retained posted sources, numbering, drafts/review
--   * 041-audit.sql                — append-only actor-bound tenant change audit
--   * 042-entry-voiding.sql        — terminal void receipts and denials
--
-- Registration is explicit. Every installed payload must contribute at least one
-- attached trigger; the dispatcher refuses if a payload is installed but unregistered,
-- so loading only the numerically newest payload is impossible. Each requirement picks
-- the highest installed payload version that defines its guard function, which lets a
-- later payload supersede one guard without editing earlier payload bytes. PIVOT-006
-- registers payload 041 alongside 040/042 and retains both prior bindings.
--
-- Safe to re-run (triggers are dropped and recreated transactionally) and refuses when
-- a required payload is missing. Apply after 00, 05, 10, 20, 021, 30, 040, 041 (when
-- adopting PIVOT-006 audit) and 042 with a connection that is a member of saven_migrator.

BEGIN;

DO $$
DECLARE
  req record;
  v_version text;
  v_function text;
  v_missing text[] := ARRAY[]::text[];
  v_attached_versions text[] := ARRAY[]::text[];
  v_unregistered text;
  v_audit_table text;
  v_audit_tables text[] := ARRAY[
    'account_profiles','accounts','approval_policy','approval_requests','assignments',
    'business','business_rule','command_decisions','command_files','company_profiles',
    'company_settings','denials','document_numbers','document_registry','document_revisions',
    'document_sequences','inventory_controls','journal_corrections','journal_drafts',
    'journal_lines','journals','members','periods','posting_constraint','reference_values',
    'roles','stock_balances','stock_items','stock_movements','stock_operations','support_grants',
    'tax_profile','trade_allocations','trade_controls','trade_credit_lines','trade_credits',
    'trade_documents','trade_lines','trade_operations','trade_parties','verified_entitlement',
    'warehouses'
  ];
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'saven_migrator') THEN
    RAISE EXCEPTION 'Run 00-roles.sql before 40-triggers.sql';
  END IF;
  IF NOT pg_has_role(current_user, 'saven_migrator', 'MEMBER')
     AND NOT (SELECT rolsuper FROM pg_roles WHERE rolname = current_user) THEN
    RAISE EXCEPTION 'Run 40-triggers.sql as a member of saven_migrator';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'tenant_data') THEN
    RAISE EXCEPTION 'Run 20-tenant-schema.sql before 40-triggers.sql';
  END IF;

  -- Explicit registration manifest. Every row is a required protection.
  FOR req IN
    SELECT * FROM (VALUES
      -- original protection (payload 040)
      ('saven_p005_command_inbox',            'command_inbox',           'command_guard',       'INSERT OR UPDATE OR DELETE', 'BEFORE', false),
      ('saven_p005_journals',                 'journals',                'journal_guard',       'INSERT OR UPDATE OR DELETE', 'BEFORE', false),
      ('saven_p005_journal_lines',            'journal_lines',           'journal_line_guard',  'INSERT OR UPDATE OR DELETE', 'BEFORE', false),
      ('saven_p005_approval_requests',        'approval_requests',       'approval_guard',      'INSERT OR UPDATE OR DELETE', 'BEFORE', false),
      ('saven_p005_journal_drafts',           'journal_drafts',          'draft_guard',         'INSERT OR UPDATE OR DELETE', 'BEFORE', false),
      ('saven_p005_document_sequences',       'document_sequences',      'sequence_guard',      'UPDATE OR DELETE', 'BEFORE', false),
      ('saven_p005_document_numbers',         'document_numbers',        'number_guard',        'UPDATE OR DELETE', 'BEFORE', false),
      ('saven_p005_document_revisions',       'document_revisions',      'revision_guard',      'UPDATE OR DELETE', 'BEFORE', false),
      ('saven_p005_trade_operations',         'trade_operations',        'command_child_guard', 'INSERT OR UPDATE OR DELETE', 'BEFORE', false),
      ('saven_p005_trade_documents',          'trade_documents',         'command_child_guard', 'INSERT OR UPDATE OR DELETE', 'BEFORE', false),
      ('saven_p005_trade_lines',              'trade_lines',             'command_child_guard', 'INSERT OR UPDATE OR DELETE', 'BEFORE', false),
      ('saven_p005_trade_allocations',        'trade_allocations',       'command_child_guard', 'INSERT OR UPDATE OR DELETE', 'BEFORE', false),
      ('saven_p005_trade_credits',            'trade_credits',           'command_child_guard', 'INSERT OR UPDATE OR DELETE', 'BEFORE', false),
      ('saven_p005_trade_credit_lines',       'trade_credit_lines',      'command_child_guard', 'INSERT OR UPDATE OR DELETE', 'BEFORE', false),
      ('saven_p005_stock_operations',         'stock_operations',        'command_child_guard', 'INSERT OR UPDATE OR DELETE', 'BEFORE', false),
      ('saven_p005_stock_movements',          'stock_movements',         'command_child_guard', 'INSERT OR UPDATE OR DELETE', 'BEFORE', false),
      ('saven_p005_command_files',            'command_files',           'command_child_guard', 'INSERT OR UPDATE OR DELETE', 'BEFORE', false),
      ('saven_p005_command_decisions',        'command_decisions',       'command_child_guard', 'INSERT OR UPDATE OR DELETE', 'BEFORE', false),
      ('saven_p005_journal_corrections',      'journal_corrections',     'correction_guard',    'INSERT OR UPDATE OR DELETE', 'BEFORE', false),
      -- terminal void protection (payload 042)
      ('saven_p005_entry_voids',              'entry_voids',             'void_guard',          'INSERT OR UPDATE OR DELETE', 'BEFORE', false),
      ('saven_p005_void_denials',             'void_denials',            'denial_guard',        'INSERT OR UPDATE OR DELETE', 'BEFORE', false),
      ('saven_p005_command_inbox_void',       'command_inbox',           'receipt_guard',       'UPDATE OR DELETE', 'BEFORE', false),
      ('saven_p005_audit_void',               'audit',                   'void_audit_guard',    'UPDATE OR DELETE', 'BEFORE', false),
      ('saven_p005_audit_event_void',         'audit_event',             'void_audit_guard',    'UPDATE OR DELETE', 'BEFORE', false),
      -- commit-time invariants (deferred constraint triggers)
      ('saven_p005_correction_commit',        'journal_corrections',     'correction_committed', 'INSERT', 'AFTER', true)
    ) AS m(trigger_name, table_name, guard_suffix, events, timing, deferred)
  LOOP
    -- Highest installed payload version that defines this guard.
    SELECT t.token INTO v_version
    FROM (
      SELECT DISTINCT (regexp_match(p.proname, format('^immutability_([0-9]+)_%s$', req.guard_suffix)))[1] AS token
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'tenant_data'
        AND p.proname ~ format('^immutability_[0-9]+_%s$', req.guard_suffix)
    ) t
    ORDER BY t.token::integer DESC
    LIMIT 1;

    IF v_version IS NULL THEN
      v_missing := v_missing || format('%s (guard %s)', req.trigger_name, req.guard_suffix);
      CONTINUE;
    END IF;

    v_function := format('tenant_data.immutability_%s_%s()', v_version, req.guard_suffix);
    IF to_regprocedure(v_function) IS NULL THEN
      v_missing := v_missing || v_function;
      CONTINUE;
    END IF;

    EXECUTE format('DROP TRIGGER IF EXISTS %I ON tenant_data.%I', req.trigger_name, req.table_name);
    IF req.deferred THEN
      -- Constraint triggers must be AFTER ... FOR EACH ROW and are checked at commit.
      EXECUTE format(
        'CREATE CONSTRAINT TRIGGER %I AFTER %s ON tenant_data.%I DEFERRABLE INITIALLY DEFERRED '
        'FOR EACH ROW EXECUTE FUNCTION %s',
        req.trigger_name, req.events, req.table_name, v_function);
    ELSE
      EXECUTE format(
        'CREATE TRIGGER %I %s %s ON tenant_data.%I FOR EACH ROW EXECUTE FUNCTION %s',
        req.trigger_name, req.timing, req.events, req.table_name, v_function);
    END IF;
    EXECUTE format(
      'COMMENT ON TRIGGER %I ON tenant_data.%I IS %L',
      req.trigger_name, req.table_name,
      format('PIVOT-005 dispatcher: immutability payload %s.', v_version));
    v_attached_versions := array_append(v_attached_versions, v_version);
  END LOOP;

  -- PIVOT-006: when payload 041 is installed, attach the audit writer to the reviewed
  -- business table list and the append/TRUNCATE guards to audit storage. The writer is
  -- registered explicitly (no dynamic catalog sweep). A 040/042-only installation stays
  -- runnable for PIVOT-005 but does not claim PIVOT-006 audit coverage; a partially
  -- installed 041 payload fails closed.
  IF to_regprocedure('tenant_data.immutability_041_audit_row()') IS NOT NULL
     OR to_regprocedure('tenant_data.immutability_041_audit_append_guard()') IS NOT NULL
     OR to_regprocedure('tenant_data.immutability_041_audit_truncate_guard()') IS NOT NULL THEN
    IF to_regprocedure('tenant_data.immutability_041_audit_row()') IS NULL
       OR to_regprocedure('tenant_data.immutability_041_audit_append_guard()') IS NULL
       OR to_regprocedure('tenant_data.immutability_041_audit_truncate_guard()') IS NULL THEN
      v_missing := v_missing || 'incomplete PIVOT-006 audit payload 041';
    ELSE
      FOREACH v_audit_table IN ARRAY v_audit_tables LOOP
        EXECUTE format('DROP TRIGGER IF EXISTS %I ON tenant_data.%I',
          'saven_p006_audit_' || v_audit_table, v_audit_table);
        EXECUTE format(
          'CREATE TRIGGER %I AFTER INSERT OR UPDATE OR DELETE ON tenant_data.%I '
          'FOR EACH ROW EXECUTE FUNCTION tenant_data.immutability_041_audit_row()',
          'saven_p006_audit_' || v_audit_table, v_audit_table);
        EXECUTE format('COMMENT ON TRIGGER %I ON tenant_data.%I IS %L',
          'saven_p006_audit_' || v_audit_table, v_audit_table,
          'PIVOT-006 dispatcher: audit payload 041 actor-bound tenant change audit.');
      END LOOP;

      DROP TRIGGER IF EXISTS saven_p006_audit_append ON tenant_data.audit;
      CREATE TRIGGER saven_p006_audit_append BEFORE UPDATE OR DELETE ON tenant_data.audit
        FOR EACH ROW EXECUTE FUNCTION tenant_data.immutability_041_audit_append_guard();
      COMMENT ON TRIGGER saven_p006_audit_append ON tenant_data.audit IS
        'PIVOT-006 dispatcher: audit payload 041 append-only guard.';

      DROP TRIGGER IF EXISTS saven_p006_audit_event_append ON tenant_data.audit_event;
      CREATE TRIGGER saven_p006_audit_event_append BEFORE UPDATE OR DELETE ON tenant_data.audit_event
        FOR EACH ROW EXECUTE FUNCTION tenant_data.immutability_041_audit_append_guard();
      COMMENT ON TRIGGER saven_p006_audit_event_append ON tenant_data.audit_event IS
        'PIVOT-006 dispatcher: audit payload 041 append-only guard.';

      DROP TRIGGER IF EXISTS saven_p006_audit_truncate_audit ON tenant_data.audit;
      CREATE TRIGGER saven_p006_audit_truncate_audit BEFORE TRUNCATE ON tenant_data.audit
        FOR EACH STATEMENT EXECUTE FUNCTION tenant_data.immutability_041_audit_truncate_guard();
      COMMENT ON TRIGGER saven_p006_audit_truncate_audit ON tenant_data.audit IS
        'PIVOT-006 dispatcher: audit payload 041 append-only TRUNCATE refusal.';

      DROP TRIGGER IF EXISTS saven_p006_audit_truncate_audit_event ON tenant_data.audit_event;
      CREATE TRIGGER saven_p006_audit_truncate_audit_event BEFORE TRUNCATE ON tenant_data.audit_event
        FOR EACH STATEMENT EXECUTE FUNCTION tenant_data.immutability_041_audit_truncate_guard();
      COMMENT ON TRIGGER saven_p006_audit_truncate_audit_event ON tenant_data.audit_event IS
        'PIVOT-006 dispatcher: audit payload 041 append-only TRUNCATE refusal.';

      v_attached_versions := array_append(v_attached_versions, '041');
    END IF;
  END IF;

  IF cardinality(v_missing) > 0 THEN
    RAISE EXCEPTION 'PIVOT-005: required payload guard(s) missing: %', array_to_string(v_missing, ', ');
  END IF;

  -- Every installed payload must be dispatched: an installed-but-unregistered payload
  -- (for example an audit payload added later without updating this manifest) refuses.
  SELECT string_agg(DISTINCT t.token, ', ' ORDER BY t.token) INTO v_unregistered
  FROM (
    SELECT (regexp_match(p.proname, '^immutability_([0-9]+)_'))[1] AS token
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'tenant_data' AND p.proname ~ '^immutability_[0-9]+_'
  ) t
  WHERE NOT t.token = ANY(v_attached_versions);
  IF v_unregistered IS NOT NULL THEN
    RAISE EXCEPTION 'PIVOT-005: installed payload version(s) % are not registered in 40-triggers.sql; register every required payload instead of loading only the newest', v_unregistered;
  END IF;
END $$;

-- Fail-closed coverage validation.
DO $$
DECLARE
  v_bad text;
BEGIN
  SELECT string_agg(t.trigger_name, ', ' ORDER BY t.trigger_name) INTO v_bad
  FROM unnest(ARRAY[
    'saven_p005_command_inbox', 'saven_p005_journals', 'saven_p005_journal_lines',
    'saven_p005_approval_requests', 'saven_p005_journal_drafts', 'saven_p005_document_sequences',
    'saven_p005_document_numbers', 'saven_p005_document_revisions', 'saven_p005_trade_operations',
    'saven_p005_trade_documents', 'saven_p005_trade_lines', 'saven_p005_trade_allocations',
    'saven_p005_trade_credits', 'saven_p005_trade_credit_lines', 'saven_p005_stock_operations',
    'saven_p005_stock_movements', 'saven_p005_command_files', 'saven_p005_command_decisions',
    'saven_p005_entry_voids', 'saven_p005_void_denials', 'saven_p005_command_inbox_void',
    'saven_p005_audit_void', 'saven_p005_audit_event_void'
  ]) AS t(trigger_name)
  WHERE NOT EXISTS (
    SELECT 1 FROM pg_trigger tg WHERE tg.tgname = t.trigger_name AND NOT tg.tgisinternal
  );
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'PIVOT-005: missing dispatcher trigger(s): %', v_bad;
  END IF;

  SELECT string_agg(c.relname || '.' || tg.tgname, ', ') INTO v_bad
  FROM pg_trigger tg
  JOIN pg_class c ON c.oid = tg.tgrelid
  JOIN pg_namespace n ON n.oid = c.relnamespace
  LEFT JOIN pg_proc p ON p.oid = tg.tgfoid
  WHERE n.nspname = 'tenant_data' AND tg.tgname LIKE 'saven\_p005\_%'
    AND (p.oid IS NULL OR p.proname NOT LIKE 'immutability\_%');
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'PIVOT-005: dispatcher trigger(s) not bound to an immutability payload: %', v_bad;
  END IF;
END $$;

-- PIVOT-006 fail-closed audit coverage validation.
DO $$
DECLARE
  v_bad text;
  v_audit_table text;
  v_audit_tables text[] := ARRAY[
    'account_profiles','accounts','approval_policy','approval_requests','assignments',
    'business','business_rule','command_decisions','command_files','company_profiles',
    'company_settings','denials','document_numbers','document_registry','document_revisions',
    'document_sequences','inventory_controls','journal_corrections','journal_drafts',
    'journal_lines','journals','members','periods','posting_constraint','reference_values',
    'roles','stock_balances','stock_items','stock_movements','stock_operations','support_grants',
    'tax_profile','trade_allocations','trade_controls','trade_credit_lines','trade_credits',
    'trade_documents','trade_lines','trade_operations','trade_parties','verified_entitlement',
    'warehouses'
  ];
BEGIN
  IF to_regprocedure('tenant_data.immutability_041_audit_row()') IS NULL THEN
    RETURN;
  END IF;

  SELECT string_agg(audited.table_name, ', ' ORDER BY audited.table_name) INTO v_bad
  FROM unnest(v_audit_tables) AS audited(table_name)
  WHERE NOT EXISTS (
    SELECT 1
    FROM pg_trigger tg
    JOIN pg_class c ON c.oid = tg.tgrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'tenant_data' AND c.relname = audited.table_name
      AND tg.tgname = 'saven_p006_audit_' || audited.table_name
      AND NOT tg.tgisinternal
  );
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'PIVOT-006: missing audit trigger(s): %', v_bad;
  END IF;

  SELECT string_agg(expected, ', ' ORDER BY expected) INTO v_bad
  FROM unnest(ARRAY[
    'audit.saven_p006_audit_append',
    'audit_event.saven_p006_audit_event_append',
    'audit.saven_p006_audit_truncate_audit',
    'audit_event.saven_p006_audit_truncate_audit_event'
  ]) AS expected
  WHERE NOT EXISTS (
    SELECT 1
    FROM pg_trigger tg
    JOIN pg_class c ON c.oid = tg.tgrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'tenant_data'
      AND c.relname || '.' || tg.tgname = expected
      AND NOT tg.tgisinternal
  );
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'PIVOT-006: missing append-only audit guard(s): %', v_bad;
  END IF;

  SELECT string_agg(c.relname || '.' || tg.tgname, ', ') INTO v_bad
  FROM pg_trigger tg
  JOIN pg_class c ON c.oid = tg.tgrelid
  JOIN pg_namespace n ON n.oid = c.relnamespace
  LEFT JOIN pg_proc p ON p.oid = tg.tgfoid
  WHERE n.nspname = 'tenant_data' AND tg.tgname LIKE 'saven\_p006\_%'
    AND (p.oid IS NULL OR p.proname NOT LIKE 'immutability\_041\_%');
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'PIVOT-006: dispatcher trigger(s) not bound to audit payload 041: %', v_bad;
  END IF;
END $$;

-- =====================================================================
-- Activation: expose the runtime interface only after every guard above is attached
-- and validated. A partial install (payloads applied, dispatcher not run) therefore
-- leaves the void primitive and the void projections unreachable.
-- =====================================================================

DO $$
BEGIN
  IF to_regprocedure('tenant_data.void_posted_entry(uuid, text, text, text, text, text, text)') IS NULL THEN
    RAISE EXCEPTION 'PIVOT-005: activation requires migrations/042-entry-voiding.sql';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger tg WHERE tg.tgname = 'saven_p005_entry_voids' AND NOT tg.tgisinternal)
     OR NOT EXISTS (SELECT 1 FROM pg_trigger tg WHERE tg.tgname = 'saven_p005_journal_corrections' AND NOT tg.tgisinternal)
     OR NOT EXISTS (SELECT 1 FROM pg_trigger tg WHERE tg.tgname = 'saven_p005_correction_commit' AND NOT tg.tgisinternal) THEN
    RAISE EXCEPTION 'PIVOT-005: activation refused because required guard bindings are missing';
  END IF;
END $$;

-- Runtime interface, granted only here.
GRANT SELECT ON tenant_data.entry_voids, tenant_data.void_denials TO saven_customer_app;
GRANT INSERT (tenant_id, id, entry_id, attempt_key, reason_code, detail, attempted_at)
  ON tenant_data.void_denials TO saven_customer_app;
GRANT SELECT ON tenant_data.active_general_ledger, tenant_data.voided_entries TO saven_customer_app;
REVOKE ALL ON FUNCTION tenant_data.void_posted_entry(uuid, text, text, text, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION tenant_data.void_posted_entry(uuid, text, text, text, text, text, text)
  TO saven_customer_app;

DO $$
BEGIN
  IF NOT has_function_privilege('saven_customer_app',
       'tenant_data.void_posted_entry(uuid, text, text, text, text, text, text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'PIVOT-005: activation did not grant the void primitive to the runtime';
  END IF;
  IF EXISTS (
    SELECT 1 FROM aclexplode((SELECT proacl FROM pg_proc
      WHERE oid = 'tenant_data.void_posted_entry(uuid, text, text, text, text, text, text)'::regprocedure)) a
    WHERE a.grantee = 0
  ) THEN
    RAISE EXCEPTION 'PIVOT-005: the void primitive must not be executable by PUBLIC';
  END IF;
  IF has_table_privilege('saven_customer_app', 'tenant_data.entry_voids', 'INSERT')
     OR has_table_privilege('saven_customer_app', 'tenant_data.entry_voids', 'UPDATE')
     OR has_table_privilege('saven_customer_app', 'tenant_data.entry_voids', 'DELETE') THEN
    RAISE EXCEPTION 'PIVOT-005: the runtime must not write void records directly';
  END IF;
  IF NOT has_table_privilege('saven_customer_app', 'tenant_data.active_general_ledger', 'SELECT')
     OR NOT has_table_privilege('saven_customer_app', 'tenant_data.voided_entries', 'SELECT') THEN
    RAISE EXCEPTION 'PIVOT-005: activation did not grant the canonical projections';
  END IF;
END $$;

-- PIVOT-006 activation validation: the audit writer is installed, bound to the
-- reviewed tables, owned by the narrow DDL role with a fixed search_path, and the
-- runtime cannot mutate audit storage directly.
DO $$
BEGIN
  -- 041 is optional for a PIVOT-005-only installation; when present it must be fully
  -- valid. PIVOT-006 acceptance requires the 041 payload and this block to pass.
  IF to_regprocedure('tenant_data.immutability_041_audit_row()') IS NOT NULL THEN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    JOIN pg_roles r ON r.oid = p.proowner
    WHERE n.nspname = 'tenant_data'
      AND p.proname = 'immutability_041_audit_row'
      AND p.prosecdef
      AND r.rolname = 'saven_migrator'
      AND EXISTS (SELECT 1 FROM unnest(coalesce(p.proconfig, ARRAY[]::text[])) c
                  WHERE c LIKE 'search_path=%')
  ) THEN
    RAISE EXCEPTION 'PIVOT-006: audit writer must be SECURITY DEFINER owned by saven_migrator with a fixed search_path';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_trigger tg WHERE tg.tgname = 'saven_p006_audit_accounts' AND NOT tg.tgisinternal)
     OR NOT EXISTS (SELECT 1 FROM pg_trigger tg WHERE tg.tgname = 'saven_p006_audit_journals' AND NOT tg.tgisinternal)
     OR NOT EXISTS (SELECT 1 FROM pg_trigger tg WHERE tg.tgname = 'saven_p006_audit_append' AND NOT tg.tgisinternal)
     OR NOT EXISTS (SELECT 1 FROM pg_trigger tg WHERE tg.tgname = 'saven_p006_audit_truncate_audit' AND NOT tg.tgisinternal)
     OR NOT EXISTS (SELECT 1 FROM pg_trigger tg WHERE tg.tgname = 'saven_p006_audit_truncate_audit_event' AND NOT tg.tgisinternal) THEN
    RAISE EXCEPTION 'PIVOT-006: activation refused because required audit triggers are missing';
  END IF;

  IF has_table_privilege('saven_customer_app', 'tenant_data.audit_event', 'INSERT')
     OR has_table_privilege('saven_customer_app', 'tenant_data.audit_event', 'UPDATE')
     OR has_table_privilege('saven_customer_app', 'tenant_data.audit_event', 'DELETE')
     OR has_table_privilege('saven_customer_app', 'tenant_data.audit_event', 'TRUNCATE')
     OR has_table_privilege('saven_customer_app', 'tenant_data.audit', 'UPDATE')
     OR has_table_privilege('saven_customer_app', 'tenant_data.audit', 'DELETE')
     OR has_table_privilege('saven_customer_app', 'tenant_data.audit', 'TRUNCATE') THEN
    RAISE EXCEPTION 'PIVOT-006: the runtime must not mutate audit storage directly';
  END IF;
  IF has_function_privilege('saven_customer_app', 'tenant_data.immutability_041_audit_row()', 'EXECUTE') THEN
    RAISE EXCEPTION 'PIVOT-006: the audit writer must not be directly executable by the runtime';
  END IF;
  END IF;
END $$;

COMMIT;
