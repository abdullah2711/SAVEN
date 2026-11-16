-- PIVOT-005: explicit dispatcher for the versioned immutability payloads.
--
-- Attaches triggers; contains no immutability logic. Every payload is a separate
-- immutable migration:
--   * 040-posted-immutability.sql  — retained posted sources, numbering, drafts/review
--   * 042-entry-voiding.sql        — terminal void receipts and denials
--   * 041 (PIVOT-006, later)       — audit coverage
--
-- Registration is explicit. Every installed payload must contribute at least one
-- attached trigger; the dispatcher refuses if a payload is installed but unregistered,
-- so loading only the numerically newest payload is impossible. Each requirement picks
-- the highest installed payload version that defines its guard function, which lets a
-- later payload supersede one guard without editing earlier payload bytes.
--
-- Safe to re-run (triggers are dropped and recreated transactionally) and refuses when
-- a required payload is missing. Apply after 00, 05, 10, 20, 021, 30, 040 and 042 with
-- a connection that is a member of saven_migrator.

BEGIN;

DO $$
DECLARE
  req record;
  v_version text;
  v_function text;
  v_missing text[] := ARRAY[]::text[];
  v_attached_versions text[] := ARRAY[]::text[];
  v_unregistered text;
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
      ('saven_p005_command_inbox',            'command_inbox',           'command_guard',       'INSERT OR UPDATE OR DELETE'),
      ('saven_p005_journals',                 'journals',                'journal_guard',       'INSERT OR UPDATE OR DELETE'),
      ('saven_p005_journal_lines',            'journal_lines',           'journal_line_guard',  'INSERT OR UPDATE OR DELETE'),
      ('saven_p005_approval_requests',        'approval_requests',       'approval_guard',      'INSERT OR UPDATE OR DELETE'),
      ('saven_p005_journal_drafts',           'journal_drafts',          'draft_guard',         'INSERT OR UPDATE OR DELETE'),
      ('saven_p005_document_sequences',       'document_sequences',      'sequence_guard',      'UPDATE OR DELETE'),
      ('saven_p005_document_numbers',         'document_numbers',        'number_guard',        'UPDATE OR DELETE'),
      ('saven_p005_document_revisions',       'document_revisions',      'revision_guard',      'UPDATE OR DELETE'),
      ('saven_p005_trade_operations',         'trade_operations',        'command_child_guard', 'INSERT OR UPDATE OR DELETE'),
      ('saven_p005_trade_documents',          'trade_documents',         'command_child_guard', 'INSERT OR UPDATE OR DELETE'),
      ('saven_p005_trade_lines',              'trade_lines',             'command_child_guard', 'INSERT OR UPDATE OR DELETE'),
      ('saven_p005_trade_allocations',        'trade_allocations',       'command_child_guard', 'INSERT OR UPDATE OR DELETE'),
      ('saven_p005_trade_credits',            'trade_credits',           'command_child_guard', 'INSERT OR UPDATE OR DELETE'),
      ('saven_p005_trade_credit_lines',       'trade_credit_lines',      'command_child_guard', 'INSERT OR UPDATE OR DELETE'),
      ('saven_p005_stock_operations',         'stock_operations',        'command_child_guard', 'INSERT OR UPDATE OR DELETE'),
      ('saven_p005_stock_movements',          'stock_movements',         'command_child_guard', 'INSERT OR UPDATE OR DELETE'),
      ('saven_p005_command_files',            'command_files',           'command_child_guard', 'INSERT OR UPDATE OR DELETE'),
      ('saven_p005_command_decisions',        'command_decisions',       'command_child_guard', 'INSERT OR UPDATE OR DELETE'),
      -- terminal void protection (payload 042)
      ('saven_p005_entry_voids',              'entry_voids',             'void_guard',          'INSERT OR UPDATE OR DELETE'),
      ('saven_p005_void_denials',             'void_denials',            'denial_guard',        'INSERT OR UPDATE OR DELETE'),
      ('saven_p005_command_inbox_void',       'command_inbox',           'receipt_guard',       'UPDATE OR DELETE'),
      ('saven_p005_audit_void',               'audit',                   'void_audit_guard',    'UPDATE OR DELETE'),
      ('saven_p005_audit_event_void',         'audit_event',             'void_audit_guard',    'UPDATE OR DELETE')
    ) AS m(trigger_name, table_name, guard_suffix, events)
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
    EXECUTE format(
      'CREATE TRIGGER %I BEFORE %s ON tenant_data.%I FOR EACH ROW EXECUTE FUNCTION %s',
      req.trigger_name, req.events, req.table_name, v_function);
    EXECUTE format(
      'COMMENT ON TRIGGER %I ON tenant_data.%I IS %L',
      req.trigger_name, req.table_name,
      format('PIVOT-005 dispatcher: immutability payload %s.', v_version));
    v_attached_versions := v_attached_versions || v_version;
  END LOOP;

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

SET LOCAL ROLE saven_migrator;

COMMIT;
