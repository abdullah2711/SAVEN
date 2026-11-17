-- PIVOT-006: append-only actor-bound tenant change audit (payload 041).
--
-- Applied by the SEPARATE OFFLINE ADMINISTRATOR (superuser) because it provisions one
-- narrow NOLOGIN owner for the audit-writing/actor-binding functions. This is a new
-- immutable payload; it never edits 040/042 bytes and is attached by the explicit
-- dispatcher in 40-triggers.sql.
--
-- Behaviour:
--   * business-table INSERT/UPDATE/DELETE rows are recorded in tenant_data.audit_event
--     in the same transaction as the mutation;
--   * the acting tenant/principal come only from verified transaction context and the
--     tenant-local principal projection, never a client header/body value;
--   * NEW native tenant_data.audit inserts are bound to that same verified actor/tenant;
--     historical native ids/bytes/timestamps are never rewritten or back-filled;
--   * before/after snapshots follow a versioned, schema-aware serialization contract:
--     JSONB and unreviewed text are redacted to a digest, reviewed business text and
--     structured columns are retained, and unsupported column types fail closed;
--   * provenance is never manufactured as human: explicit document origin columns are
--     validated against the canonical origin_type reference rows and model/version are
--     retained; otherwise genuinely unavailable provenance is recorded as system with an
--     explicit detail marker and the verified acting principal remains actor_id;
--   * audit storage itself is append-only: UPDATE/DELETE/TRUNCATE raise.
--
-- The audit writer skips audit/audit_event defensively so an accidental attachment cannot
-- recurse. The dispatcher attaches the writer only to the reviewed business table list and
-- attaches the append-only/native-insert guards to audit storage.

BEGIN;

DO $$
DECLARE
  incompatible boolean;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'saven_migrator') THEN
    RAISE EXCEPTION 'Run 00-roles.sql before 041-audit.sql';
  END IF;
  IF NOT (SELECT rolsuper FROM pg_roles WHERE rolname = current_user) THEN
    RAISE EXCEPTION '041-audit.sql provisions a dedicated owner and transfers function ownership: run it as the separate offline administrator (superuser)';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'tenant_data') THEN
    RAISE EXCEPTION 'Run 20-tenant-schema.sql before 041-audit.sql';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
                 WHERE n.nspname = 'tenant_data' AND c.relname = 'audit_event' AND c.relkind = 'r')
     OR NOT EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
                    WHERE n.nspname = 'tenant_data' AND c.relname = 'audit' AND c.relkind = 'r')
     OR NOT EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
                    WHERE n.nspname = 'tenant_data' AND c.relname = 'members' AND c.relkind = 'r')
     OR NOT EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
                    WHERE n.nspname = 'tenant_data' AND c.relname = 'reference_values' AND c.relkind = 'r') THEN
    RAISE EXCEPTION 'Run 20-tenant-schema.sql and 30-rls-policies.sql before 041-audit.sql';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'tenant_data' AND p.proname LIKE 'immutability\_041\_%'
  ) THEN
    RAISE EXCEPTION 'PIVOT-006: 041-audit.sql is already applied and is immutable; add a new payload version instead of reapplying it';
  END IF;

  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'saven_audit_definer') THEN
    SELECT rolcanlogin OR rolsuper OR rolcreatedb OR rolcreaterole OR rolinherit OR rolbypassrls OR rolreplication
      INTO incompatible
    FROM pg_roles WHERE rolname = 'saven_audit_definer';
    IF incompatible THEN
      RAISE EXCEPTION 'AUDIT-OWNER: refused incompatible pre-existing role saven_audit_definer; it must be NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS NOREPLICATION';
    END IF;
  ELSE
    EXECUTE 'CREATE ROLE saven_audit_definer NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS NOREPLICATION';
  END IF;
END $$;

COMMENT ON ROLE saven_audit_definer IS
  'PIVOT-006: NOLOGIN owner of the tenant audit writer/native actor-binding functions only. Fixed search paths, enumerated column inserts/reads, audit_event identity-sequence access, no table ownership, schema CREATE, broad auth/operator read, runtime membership or superuser/BYPASSRLS.';

-- =====================================================================
-- 1. Catalog helper and versioned secret-safe serialization
-- =====================================================================

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

-- Exact reviewed schema fingerprint (serialization contract version 1). The
-- fingerprint covers every registered table's ordered column names, base type names and
-- typmods, so a new/renamed/retyped column cannot inherit raw retention silently. The
-- expected values are the per-schema review records for the registered table inventory.
CREATE FUNCTION tenant_data.immutability_041_schema_fingerprint(p_table regclass)
RETURNS text
LANGUAGE sql STABLE
SET search_path = pg_catalog
AS $fn$
  SELECT encode(sha256(convert_to(
    string_agg(a.attname || ':' || t.typname || ':' || a.atttypmod, ',' ORDER BY a.attnum),
    'UTF8')), 'hex')
  FROM pg_attribute a
  JOIN pg_type t ON t.oid = a.atttypid
  WHERE a.attrelid = p_table AND a.attnum > 0 AND NOT a.attisdropped
$fn$;

CREATE FUNCTION tenant_data.immutability_041_expected_fingerprint(p_table regclass)
RETURNS text
LANGUAGE sql IMMUTABLE
SET search_path = pg_catalog
AS $fn$
  SELECT CASE p_table::text
    WHEN 'tenant_data.account_profiles' THEN '180d26137c69e3dbc211d423c7f7b4d8e2ee10f767957a4ce24dc93e76485738'
    WHEN 'tenant_data.accounts' THEN 'b9c9953a8dacbf9c02421c61b160fa02f6fb72e50da2fdb543560bc5dac11339'
    WHEN 'tenant_data.approval_policy' THEN '1802db30499fb7941ed9d0dfd9303eb393c6143f0edc313b0a7934b6a5ef8a68'
    WHEN 'tenant_data.approval_requests' THEN 'e5bce7fcaf994a14c4a12a3e5138a9b2bc6ad233e425245b7772ca1e0bb7de56'
    WHEN 'tenant_data.assignments' THEN '3feb3c05cfc38e3ffadd5eee6713cfaffabccbbcecaa61c1e403755310cf57af'
    WHEN 'tenant_data.business' THEN 'a052fd48e1b8b3855746fefc830194288db36376e7d7451d74b836d9ea4865bd'
    WHEN 'tenant_data.business_rule' THEN '8b292c992d82925c7062b4935b0cad3b480055c7ddc4b245c0648611237e2d70'
    WHEN 'tenant_data.command_decisions' THEN '7a78993e1b2d00aef0f64ac96ef52a756e5711c1f915b931dd67b3baaf89e41b'
    WHEN 'tenant_data.command_files' THEN '9ddcff6d30893cd8766fb1694c1de0e6e3619bcc08c1970149600368413adbfa'
    WHEN 'tenant_data.company_profiles' THEN 'abed9c8c70fdc327351bdc933f1d270e4a61fae57d858bc2cd4b89516b5ec438'
    WHEN 'tenant_data.company_settings' THEN '5e6b03f5b71d20d14f764e9bc86375fa8cd07636781f09ce8d7375a4a3375e5b'
    WHEN 'tenant_data.denials' THEN 'dc72f0e5ffd64f8a0d6e69b6f5da8c88e9ad9c192fc7322b48dd99c4602c6f4b'
    WHEN 'tenant_data.document_numbers' THEN 'c82a4b5b3b500b1d915075bc71ecf9ce27d57a47f7ce795b1b49011c619173d8'
    WHEN 'tenant_data.document_registry' THEN 'c66762675da6ddf3e26f1a228fa57a6e89e28a034617ea8e4659a979d38c605b'
    WHEN 'tenant_data.document_revisions' THEN 'fb82b76e639577ea7f6ac2a3eab3bf456216eed28f332c1c079cfe76ea6ec5e4'
    WHEN 'tenant_data.document_sequences' THEN '354b421aab37914ea073327fdcce5e7c00b5951b4f2e4a2f96867230529e369c'
    WHEN 'tenant_data.inventory_controls' THEN '5b2b6dd46ce764a4071c2f364b9a8a6b3c27d72201b90056eba4b8a8689c55f0'
    WHEN 'tenant_data.journal_corrections' THEN '3d2d2295274de99ac2a65202df2cd8e83a0505d68fa52ae32358ea4a02c87d08'
    WHEN 'tenant_data.journal_drafts' THEN '5b1cadf4530750fd05a23ddb7a4c42d722f34157dde9bcdb9b186f73942b8949'
    WHEN 'tenant_data.journal_lines' THEN 'd2dfe225e478095f7a8d63ddb52ffb3e8eaa3299da9fd2b110db374dace319d5'
    WHEN 'tenant_data.journals' THEN '6c1ddc15ecfa58b8c4e611fe74c469064362ad5ee50a860b1e416d2e4b2d3715'
    WHEN 'tenant_data.members' THEN '3d0b59fb56c762935f148a7852981ad531f2eaa03f8b6082eeafcdded8fc665c'
    WHEN 'tenant_data.periods' THEN '1417a27b40c5dbe009b9a02b4e91a892e54b5e9e4dc996c3efe092a542d4ad81'
    WHEN 'tenant_data.posting_constraint' THEN '3a2f51ebf39769949825c1cc2f390ca87e70000b4d46adc56d8cb8f09f560b45'
    WHEN 'tenant_data.reference_values' THEN 'a44a45020dd6d97d58cc81cce47c2cb13228fbea125797e73987d8ceca52324b'
    WHEN 'tenant_data.roles' THEN 'f6d07c4129a008c1309460413a063145dbf8295c07b6aca370dcef909ca5a98b'
    WHEN 'tenant_data.stock_balances' THEN '4f8245ee8b7734b63a56f254802be2a41cc1b82de393fb9e79a3a33bd5535003'
    WHEN 'tenant_data.stock_items' THEN '6913bb217f44388df1d0ebbc09684e7c55ad87ec90ac8c34d840480d3afaa804'
    WHEN 'tenant_data.stock_movements' THEN '39003a6156c3ca12eeacc93372c65e3231c42e670eba4058eaa57c17b60b2093'
    WHEN 'tenant_data.stock_operations' THEN '8f9dea0e00e5b0a9da7921cfbacf379bd9866445306148fe760643e5a6823acb'
    WHEN 'tenant_data.support_grants' THEN 'bd78dc94a1341f2f69cd911998582854b4f5956b81b9441655364a6a76c82201'
    WHEN 'tenant_data.tax_profile' THEN 'd514cef534d9d078a51ea6d7da3ee7c58977ea263ea78ea471b8c7ee6e8cce92'
    WHEN 'tenant_data.trade_allocations' THEN 'cb99415e7df1a46cf35d4378d037cdaaaca4bc71749292f143f831088e6d905b'
    WHEN 'tenant_data.trade_controls' THEN 'fec35f2f0947331c4957ed8a7e360bacb06c2e890d80ffd68c124d32245edb64'
    WHEN 'tenant_data.trade_credit_lines' THEN '8609e512a1ba085033469368c5b54f6a21480f5757948be608fa5e9bfe80b18e'
    WHEN 'tenant_data.trade_credits' THEN '50de39ddcf1646f69bf725537c35470a91b4779813c8418d3561167861f9a322'
    WHEN 'tenant_data.trade_documents' THEN '7063fd368dd80a4d395e7067010585aef268132893f6deb6ad97e193671ded04'
    WHEN 'tenant_data.trade_lines' THEN 'd263ecfd5cdd3f13d3692f6ca4d4412129b9f18316052da1472812dd13969606'
    WHEN 'tenant_data.trade_operations' THEN 'b3423d16511215fe6ee4c0e12dec32ccdf290f13c1caa58690fed14ab7a17d9e'
    WHEN 'tenant_data.trade_parties' THEN '527946b6ee579a1b1c7d656f37acdb377dd060aa769e39f3a32fed47357e1cf4'
    WHEN 'tenant_data.verified_entitlement' THEN 'bb1fba9f3a33e748f2ce80b7fb2712c5176dfafef4598f750315ff1910cf6acb'
    WHEN 'tenant_data.warehouses' THEN '74c0e5b2519adb6e031460b20cf46e1de04a379a4d3066085b45f3c556b51887'
  END
$fn$;

COMMENT ON FUNCTION tenant_data.immutability_041_schema_fingerprint(regclass) IS
  'PIVOT-006 payload 041 version 1: exact ordered column-name/base-type/typmod fingerprint of one registered table.';
COMMENT ON FUNCTION tenant_data.immutability_041_expected_fingerprint(regclass) IS
  'PIVOT-006 payload 041 version 1: reviewed per-table schema fingerprints for the explicit registered audit inventory, including parameterized numeric shapes.';

-- Versioned serialization contract (version 1). JSONB and unreviewed text are replaced
-- with a digest/redaction marker; reviewed business text and structured scalar columns
-- are retained; an unreviewed column type fails closed rather than raw-logging it.
CREATE FUNCTION tenant_data.immutability_041_serialize(p_table regclass, p_row jsonb)
RETURNS jsonb
LANGUAGE plpgsql STABLE
SET search_path = pg_catalog
AS $fn$
DECLARE
  v_row jsonb := '{}'::jsonb;
  v_redacted text[] := ARRAY[]::text[];
  v_col record;
  v_value jsonb;
  v_actual_fp text;
  v_expected_fp text;
  v_safe_text text[] := ARRAY[
    'id','code','company','branch','account','journal_id','command_id','actor','user_id',
    'role_id','name','title','kind','reference','party_id','warehouse','item','uom',
    'currency','policy_key','action_type','event','state','status','narrative','description',
    'reason','domain','label','jurisdiction','handler_key','constraint_key',
    'applies_to_document_type','scope_type','scope_id','media_type','sha256','scan',
    'origin_type','origin_user_id','origin_model','origin_model_version','request_id',
    'correlation_id','error','lease_token','updated_by','created_by','source_digest',
    'policy_digest','request_digest','idempotency_key','source_state','effective_state',
    'void_command_id','entry_id','attempt_key','reason_code','decision','replacement_id',
    'tax_code','tax_type','inventory_account','expense_account','receipt_account','checksum',
    'source_store','grant_id','grantee_actor_id','granted_by_user_id','entitlement_id','issuer',
    'public_key_digest','signature','source','posting_date','due_date','start_date','end_date',
    'document_id','document_type','document_status','payload_digest','address','tax_number',
    'print_footer','project','valuation_method','allocation_policy'
  ];
BEGIN
  v_actual_fp := tenant_data.immutability_041_schema_fingerprint(p_table);
  v_expected_fp := tenant_data.immutability_041_expected_fingerprint(p_table);
  IF v_expected_fp IS NULL OR v_actual_fp IS DISTINCT FROM v_expected_fp THEN
    RAISE EXCEPTION 'AUDIT_SERIALIZATION_SCHEMA_CHANGED: table % does not match the reviewed serialization inventory', p_table;
  END IF;

  FOR v_col IN
    SELECT a.attname, t.typname AS typ
    FROM pg_attribute a
    JOIN pg_type t ON t.oid = a.atttypid
    WHERE a.attrelid = p_table AND a.attnum > 0 AND NOT a.attisdropped
    ORDER BY a.attnum
  LOOP
    v_value := p_row -> v_col.attname;
    IF v_value IS NULL THEN
      v_row := v_row || jsonb_build_object(v_col.attname, NULL);
    ELSIF v_col.typ IN ('jsonb', 'json') THEN
      v_row := v_row || jsonb_build_object(v_col.attname, jsonb_build_object(
        'redacted', true,
        'type', v_col.typ,
        'sha256', encode(sha256(convert_to(v_value::text, 'UTF8')), 'hex')));
      v_redacted := array_append(v_redacted, v_col.attname);
    ELSIF v_col.typ IN ('text', 'varchar', 'bpchar') THEN
      IF v_col.attname = ANY(v_safe_text) THEN
        v_row := v_row || jsonb_build_object(v_col.attname, v_value);
      ELSE
        v_row := v_row || jsonb_build_object(v_col.attname, jsonb_build_object(
          'redacted', true,
          'type', v_col.typ,
          'sha256', encode(sha256(convert_to(v_value::text, 'UTF8')), 'hex')));
        v_redacted := array_append(v_redacted, v_col.attname);
      END IF;
    ELSIF v_col.typ IN ('int8','int4','int2','numeric','bool','uuid',
                        'timestamptz','timestamp','date') THEN
      -- Catalog base type identity. Parameterized numerics (for example
      -- numeric(20,4) and numeric(9,6)) keep their exact JSON numeric value.
      v_row := v_row || jsonb_build_object(v_col.attname, v_value);
    ELSE
      RAISE EXCEPTION 'AUDIT_SERIALIZATION_UNSUPPORTED: column %.% has unreviewed type %', p_table, v_col.attname, v_col.typ;
    END IF;
  END LOOP;
  RETURN jsonb_build_object(
    'serializationVersion', 1,
    'row', v_row,
    'redactedColumns', to_jsonb(v_redacted));
END;
$fn$;

COMMENT ON FUNCTION tenant_data.immutability_041_serialize(regclass, jsonb) IS
  'PIVOT-006 payload 041 version 1 serialization: JSONB and unreviewed text are redacted to a digest; reviewed business text/scalars are retained; unsupported column types fail closed. No arbitrary key blacklist is claimed as a guarantee.';

-- =====================================================================
-- 2. Provenance resolution
-- =====================================================================

CREATE FUNCTION tenant_data.immutability_041_audit_origin(
  p_tenant uuid,
  p_table text,
  p_row jsonb,
  p_actor text,
  OUT origin_type text,
  OUT origin_user_id text,
  OUT origin_model text,
  OUT origin_model_version text,
  OUT provenance text
)
RETURNS record
LANGUAGE plpgsql STABLE
SET search_path = pg_catalog, tenant_data
AS $fn$
BEGIN
  IF jsonb_exists(p_row, 'origin_type') THEN
    origin_type := p_row ->> 'origin_type';
    origin_user_id := p_row ->> 'origin_user_id';
    origin_model := p_row ->> 'origin_model';
    origin_model_version := p_row ->> 'origin_model_version';
    IF origin_type IS NULL OR length(btrim(origin_type)) = 0 THEN
      RAISE EXCEPTION 'AUDIT_PROVENANCE_INVALID: % has no usable origin_type', p_table;
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM tenant_data.reference_values rv
      WHERE rv.tenant_id = p_tenant AND rv.domain = 'origin_type'
        AND rv.value = origin_type AND rv.is_active
    ) THEN
      RAISE EXCEPTION 'AUDIT_PROVENANCE_INVALID: origin_type % on % is not an active canonical reference value', origin_type, p_table;
    END IF;

    IF origin_type = 'ai' THEN
      IF origin_model IS NULL OR length(btrim(origin_model)) = 0 THEN
        RAISE EXCEPTION 'AUDIT_PROVENANCE_INVALID: AI-origin % requires origin_model', p_table;
      END IF;
      IF origin_user_id IS NULL OR length(btrim(origin_user_id)) = 0 THEN
        RAISE EXCEPTION 'AUDIT_PROVENANCE_INVALID: AI-origin % requires origin_user_id', p_table;
      END IF;
      IF NOT EXISTS (
        SELECT 1 FROM tenant_data.members m
        WHERE m.tenant_id = p_tenant AND m.user_id = origin_user_id
      ) THEN
        RAISE EXCEPTION 'AUDIT_PROVENANCE_INVALID: AI-origin proposer % on % is not a tenant member', origin_user_id, p_table;
      END IF;
    ELSIF origin_type = 'human' THEN
      IF origin_model IS NOT NULL AND length(btrim(origin_model)) > 0 THEN
        RAISE EXCEPTION 'AUDIT_PROVENANCE_INVALID: human-origin % cannot name a model', p_table;
      END IF;
      IF origin_user_id IS NULL OR length(btrim(origin_user_id)) = 0 THEN
        origin_user_id := p_actor;
      END IF;
      IF NOT EXISTS (
        SELECT 1 FROM tenant_data.members m
        WHERE m.tenant_id = p_tenant AND m.user_id = origin_user_id
      ) THEN
        RAISE EXCEPTION 'AUDIT_PROVENANCE_INVALID: human-origin actor % on % is not a tenant member', origin_user_id, p_table;
      END IF;
    ELSIF origin_type = 'integration' THEN
      IF (origin_user_id IS NULL OR length(btrim(origin_user_id)) = 0)
         AND (origin_model IS NULL OR length(btrim(origin_model)) = 0) THEN
        RAISE EXCEPTION 'AUDIT_PROVENANCE_INVALID: integration-origin % requires an origin identity or model', p_table;
      END IF;
    END IF;
    provenance := 'row-declared';
  ELSE
    -- No explicit document/proposal origin exists. Do not manufacture "human"; the
    -- verified acting principal remains actor_id and the unavailable business origin is
    -- represented by the canonical system value with an explicit detail marker.
    origin_type := 'system';
    origin_user_id := NULL;
    origin_model := NULL;
    origin_model_version := NULL;
    provenance := 'unavailable';
  END IF;
END;
$fn$;

COMMENT ON FUNCTION tenant_data.immutability_041_audit_origin(uuid, text, jsonb, text) IS
  'PIVOT-006 payload 041: resolves validated explicit document origin from canonical reference_values and retains model/version, or records genuinely unavailable provenance as system with an explicit marker. Never manufactures human origin.';

-- =====================================================================
-- 3. Actor-bound change audit writer and native-audit insert guard
-- =====================================================================

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
  v_origin_type text;
  v_origin_user_id text;
  v_origin_model text;
  v_origin_model_version text;
  v_provenance text;
BEGIN
  IF TG_TABLE_NAME IN ('audit', 'audit_event') THEN
    RETURN NULL;
  END IF;

  v_tenant := CASE WHEN TG_OP = 'DELETE' THEN OLD.tenant_id ELSE NEW.tenant_id END;
  v_user := tenant_data.current_user_id();
  IF v_tenant IS NULL
     OR v_tenant IS DISTINCT FROM tenant_data.current_tenant_id()
     OR v_user IS NULL
     OR NOT tenant_data.session_admitted(v_tenant, v_user) THEN
    RAISE EXCEPTION 'AUDIT_CONTEXT_REQUIRED: a tenant change requires verified admitted tenant and principal context';
  END IF;

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

  v_before := CASE WHEN TG_OP IN ('UPDATE', 'DELETE')
                   THEN tenant_data.immutability_041_serialize(TG_RELID, to_jsonb(OLD))
                   ELSE NULL END;
  v_after := CASE WHEN TG_OP IN ('INSERT', 'UPDATE')
                  THEN tenant_data.immutability_041_serialize(TG_RELID, to_jsonb(NEW))
                  ELSE NULL END;

  SELECT o.origin_type, o.origin_user_id, o.origin_model, o.origin_model_version, o.provenance
    INTO v_origin_type, v_origin_user_id, v_origin_model, v_origin_model_version, v_provenance
  FROM tenant_data.immutability_041_audit_origin(
    v_tenant, TG_TABLE_NAME, v_row, v_actor) AS o;

  INSERT INTO tenant_data.audit_event
    (tenant_id, actor_id, event, entity_type, entity_id, detail_jsonb,
     origin_type, origin_user_id, origin_model, origin_model_version, request_id, happened_at)
  VALUES (
    v_tenant,
    v_actor,
    'TENANT_CHANGE_' || TG_OP,
    TG_TABLE_NAME,
    v_entity_id,
    jsonb_build_object(
      'action', TG_OP,
      'serializationVersion', 1,
      'version', 1,
      'transactionId', pg_current_xact_id()::text,
      'rowVersion', coalesce(v_after -> 'row' ->> 'updated_at', v_before -> 'row' ->> 'updated_at'),
      'before', v_before,
      'after', v_after,
      'provenance', v_provenance
    ),
    v_origin_type,
    v_origin_user_id,
    v_origin_model,
    v_origin_model_version,
    NULL,
    now()
  );
  RETURN NULL;
END;
$fn$;

COMMENT ON FUNCTION tenant_data.immutability_041_audit_row() IS
  'PIVOT-006 payload 041: append-only actor-bound tenant change audit. Verified actor/tenant from transaction context and admission, canonical primary-key target, versioned secret-safe before/after, validated provenance. SECURITY DEFINER owned by the dedicated audit owner; no runtime superuser/BYPASSRLS.';

CREATE FUNCTION tenant_data.immutability_041_audit_native_guard()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, tenant_data
AS $fn$
DECLARE
  v_tenant uuid;
  v_user uuid;
  v_actor text;
BEGIN
  v_tenant := tenant_data.current_tenant_id();
  v_user := tenant_data.current_user_id();
  IF v_tenant IS NULL OR v_user IS NULL
     OR NEW.tenant_id IS DISTINCT FROM v_tenant
     OR NOT tenant_data.session_admitted(v_tenant, v_user) THEN
    RAISE EXCEPTION 'AUDIT_CONTEXT_REQUIRED: native audit inserts require verified admitted tenant/principal context';
  END IF;
  SELECT m.user_id INTO v_actor
  FROM tenant_data.members m
  WHERE m.tenant_id = v_tenant AND m.user_uuid = v_user;
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'AUDIT_ACTOR_UNVERIFIED: the current principal has no tenant-local member mapping';
  END IF;
  IF NEW.actor IS DISTINCT FROM v_actor THEN
    RAISE EXCEPTION 'AUDIT_ACTOR_MISMATCH: native audit actor must be the admitted principal';
  END IF;
  RETURN NEW;
END;
$fn$;

COMMENT ON FUNCTION tenant_data.immutability_041_audit_native_guard() IS
  'PIVOT-006 payload 041: prospective native tenant_data.audit inserts must name the admitted canonical actor and tenant. Historical rows are never rewritten; no backfill.';

-- =====================================================================
-- 4. Append-only audit storage guards
-- =====================================================================

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

-- =====================================================================
-- 5. Transfer audit functions to the dedicated narrow owner
-- =====================================================================

ALTER FUNCTION tenant_data.immutability_041_row_key(regclass, jsonb)
  OWNER TO saven_audit_definer;
ALTER FUNCTION tenant_data.immutability_041_schema_fingerprint(regclass)
  OWNER TO saven_audit_definer;
ALTER FUNCTION tenant_data.immutability_041_expected_fingerprint(regclass)
  OWNER TO saven_audit_definer;
ALTER FUNCTION tenant_data.immutability_041_serialize(regclass, jsonb)
  OWNER TO saven_audit_definer;
ALTER FUNCTION tenant_data.immutability_041_audit_origin(uuid, text, jsonb, text)
  OWNER TO saven_audit_definer;
ALTER FUNCTION tenant_data.immutability_041_audit_row()
  OWNER TO saven_audit_definer;
ALTER FUNCTION tenant_data.immutability_041_audit_native_guard()
  OWNER TO saven_audit_definer;

ALTER FUNCTION tenant_data.immutability_041_audit_append_guard()
  OWNER TO saven_migrator;
ALTER FUNCTION tenant_data.immutability_041_audit_truncate_guard()
  OWNER TO saven_migrator;

REVOKE ALL ON FUNCTION tenant_data.immutability_041_row_key(regclass, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION tenant_data.immutability_041_schema_fingerprint(regclass) FROM PUBLIC;
REVOKE ALL ON FUNCTION tenant_data.immutability_041_expected_fingerprint(regclass) FROM PUBLIC;
REVOKE ALL ON FUNCTION tenant_data.immutability_041_serialize(regclass, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION tenant_data.immutability_041_audit_origin(uuid, text, jsonb, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION tenant_data.immutability_041_audit_row() FROM PUBLIC;
REVOKE ALL ON FUNCTION tenant_data.immutability_041_audit_native_guard() FROM PUBLIC;
REVOKE ALL ON FUNCTION tenant_data.immutability_041_audit_append_guard() FROM PUBLIC;
REVOKE ALL ON FUNCTION tenant_data.immutability_041_audit_truncate_guard() FROM PUBLIC;

-- =====================================================================
-- 6. Enumerated minimum privileges for the audit owner
-- =====================================================================

GRANT USAGE ON SCHEMA tenant_data TO saven_audit_definer;

GRANT SELECT (tenant_id, user_id, user_uuid) ON tenant_data.members TO saven_audit_definer;
GRANT SELECT (tenant_id, domain, value, is_active) ON tenant_data.reference_values TO saven_audit_definer;

GRANT INSERT (tenant_id, actor_id, event, entity_type, entity_id, detail_jsonb,
              origin_type, origin_user_id, origin_model, origin_model_version,
              request_id, happened_at)
  ON tenant_data.audit_event TO saven_audit_definer;

GRANT USAGE ON SEQUENCE tenant_data.audit_event_id_seq TO saven_audit_definer;

GRANT EXECUTE ON FUNCTION tenant_data.current_tenant_id() TO saven_audit_definer;
GRANT EXECUTE ON FUNCTION tenant_data.current_user_id() TO saven_audit_definer;
GRANT EXECUTE ON FUNCTION tenant_data.session_admitted(uuid, uuid) TO saven_audit_definer;

-- =====================================================================
-- 7. Validate the audit owner's complete authority, then commit
-- =====================================================================

CREATE FUNCTION pg_temp.saven_assert_audit_owner() RETURNS void
LANGUAGE plpgsql AS $fn$
DECLARE
  v_owner oid := (SELECT oid FROM pg_roles WHERE rolname = 'saven_audit_definer');
  v_bad text;
  v_flags text;
  v_count integer;
  actual text[];
  allowed_schemas text[] := ARRAY['tenant_data:USAGE'];
  allowed_columns text[] := ARRAY[
    'tenant_data.members.tenant_id:SELECT','tenant_data.members.user_id:SELECT',
    'tenant_data.members.user_uuid:SELECT',
    'tenant_data.reference_values.tenant_id:SELECT','tenant_data.reference_values.domain:SELECT',
    'tenant_data.reference_values.value:SELECT','tenant_data.reference_values.is_active:SELECT',
    'tenant_data.audit_event.tenant_id:INSERT','tenant_data.audit_event.actor_id:INSERT',
    'tenant_data.audit_event.event:INSERT','tenant_data.audit_event.entity_type:INSERT',
    'tenant_data.audit_event.entity_id:INSERT','tenant_data.audit_event.detail_jsonb:INSERT',
    'tenant_data.audit_event.origin_type:INSERT','tenant_data.audit_event.origin_user_id:INSERT',
    'tenant_data.audit_event.origin_model:INSERT','tenant_data.audit_event.origin_model_version:INSERT',
    'tenant_data.audit_event.request_id:INSERT','tenant_data.audit_event.happened_at:INSERT'
  ];
  allowed_functions text[] := ARRAY[
    'tenant_data.current_tenant_id:EXECUTE',
    'tenant_data.current_user_id:EXECUTE',
    'tenant_data.session_admitted:EXECUTE'
  ];
  owned_functions text[] := ARRAY[
    'immutability_041_row_key','immutability_041_schema_fingerprint',
    'immutability_041_expected_fingerprint','immutability_041_serialize',
    'immutability_041_audit_origin','immutability_041_audit_row',
    'immutability_041_audit_native_guard'
  ];
BEGIN
  IF v_owner IS NULL THEN RAISE EXCEPTION 'AUDIT-OWNER: audit owner role is missing'; END IF;

  SELECT string_agg(flag, ', ') INTO v_flags FROM pg_roles r, LATERAL (VALUES
    ('LOGIN', r.rolcanlogin), ('SUPERUSER', r.rolsuper), ('CREATEDB', r.rolcreatedb),
    ('CREATEROLE', r.rolcreaterole), ('INHERIT', r.rolinherit),
    ('BYPASSRLS', r.rolbypassrls), ('REPLICATION', r.rolreplication)) v(flag, present)
  WHERE r.oid = v_owner AND v.present;
  IF v_flags IS NOT NULL THEN RAISE EXCEPTION 'AUDIT-OWNER: forbidden attributes: %', v_flags; END IF;

  SELECT string_agg(format('%s -> %s', m.rolname, g.rolname), ', ') INTO v_bad
  FROM pg_auth_members am JOIN pg_roles m ON m.oid = am.member JOIN pg_roles g ON g.oid = am.roleid
  WHERE m.oid = v_owner OR g.oid = v_owner;
  IF v_bad IS NOT NULL THEN RAISE EXCEPTION 'AUDIT-OWNER: role memberships: %', v_bad; END IF;

  SELECT string_agg(r.rolname, ', ') INTO v_bad FROM pg_roles r
  WHERE r.oid <> v_owner AND r.rolname LIKE 'saven\_%' AND NOT r.rolsuper
    AND pg_has_role(r.oid, v_owner, 'MEMBER');
  IF v_bad IS NOT NULL THEN RAISE EXCEPTION 'AUDIT-OWNER: a SAVEN principal can assume the audit owner: %', v_bad; END IF;

  SELECT string_agg(n.nspname || '.' || c.relname, ', ') INTO v_bad
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE c.relowner = v_owner;
  IF v_bad IS NOT NULL THEN RAISE EXCEPTION 'AUDIT-OWNER: owns relations: %', v_bad; END IF;

  SELECT string_agg(n.nspname, ', ') INTO v_bad FROM pg_namespace n WHERE n.nspowner = v_owner;
  IF v_bad IS NOT NULL THEN RAISE EXCEPTION 'AUDIT-OWNER: owns schemas: %', v_bad; END IF;

  SELECT string_agg(n.nspname || '.' || p.proname, ', ') INTO v_bad
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE p.proowner = v_owner
    AND (n.nspname <> 'tenant_data' OR p.proname <> ALL (owned_functions));
  IF v_bad IS NOT NULL THEN RAISE EXCEPTION 'AUDIT-OWNER: owns other functions: %', v_bad; END IF;

  SELECT count(*) INTO v_count
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE p.proowner = v_owner AND n.nspname = 'tenant_data' AND p.proname = ANY (owned_functions);
  IF v_count <> 7 THEN RAISE EXCEPTION 'AUDIT-OWNER: expected seven owned audit functions, found %', v_count; END IF;

  SELECT string_agg(datname, ', ') INTO v_bad FROM pg_database WHERE datdba = v_owner;
  IF v_bad IS NOT NULL THEN RAISE EXCEPTION 'AUDIT-OWNER: owns databases: %', v_bad; END IF;

  SELECT string_agg(spcname, ', ') INTO v_bad FROM pg_tablespace WHERE spcowner = v_owner;
  IF v_bad IS NOT NULL THEN RAISE EXCEPTION 'AUDIT-OWNER: owns tablespaces: %', v_bad; END IF;

  SELECT coalesce(array_agg(n.nspname || ':' || x.privilege_type ORDER BY 1), ARRAY[]::text[]) INTO actual
  FROM pg_namespace n CROSS JOIN aclexplode(n.nspacl) x
  WHERE x.grantee = v_owner AND n.nspname NOT LIKE 'pg\_%' AND n.nspname <> 'information_schema';
  IF (SELECT array_agg(v ORDER BY v) FROM unnest(actual) v)
     IS DISTINCT FROM (SELECT array_agg(v ORDER BY v) FROM unnest(allowed_schemas) v) THEN
    RAISE EXCEPTION 'AUDIT-OWNER: schema privileges differ from the allow-list; found %', actual;
  END IF;

  SELECT string_agg(n.nspname, ', ') INTO v_bad FROM pg_namespace n
  WHERE n.nspname NOT LIKE 'pg\_%' AND n.nspname <> 'information_schema'
    AND has_schema_privilege(v_owner, n.oid, 'CREATE');
  IF v_bad IS NOT NULL THEN RAISE EXCEPTION 'AUDIT-OWNER: may CREATE in: %', v_bad; END IF;

  IF has_schema_privilege(v_owner, 'operator', 'USAGE') THEN
    RAISE EXCEPTION 'AUDIT-OWNER: may USAGE the operator schema';
  END IF;

  SELECT string_agg(n.nspname || '.' || c.relname || ':' || x.privilege_type, ', ') INTO v_bad
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
  CROSS JOIN aclexplode(c.relacl) x
  WHERE x.grantee = v_owner AND c.relkind <> 'S';
  IF v_bad IS NOT NULL THEN RAISE EXCEPTION 'AUDIT-OWNER: table/relation-level privileges: %', v_bad; END IF;

  SELECT coalesce(array_agg(n.nspname || '.' || c.relname || ':' || x.privilege_type ORDER BY 1), ARRAY[]::text[])
    INTO actual
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
  CROSS JOIN aclexplode(c.relacl) x
  WHERE x.grantee = v_owner AND c.relkind = 'S';
  IF (SELECT array_agg(v ORDER BY v) FROM unnest(actual) v)
     IS DISTINCT FROM ARRAY['tenant_data.audit_event_id_seq:USAGE'] THEN
    RAISE EXCEPTION 'AUDIT-OWNER: sequence privileges differ from the allow-list; found %', actual;
  END IF;

  SELECT coalesce(array_agg(n.nspname || '.' || c.relname || '.' || a.attname || ':' || x.privilege_type ORDER BY 1), ARRAY[]::text[])
    INTO actual
  FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid JOIN pg_namespace n ON n.oid = c.relnamespace
  CROSS JOIN aclexplode(a.attacl) x
  WHERE x.grantee = v_owner AND a.attnum > 0;
  IF (SELECT array_agg(v ORDER BY v) FROM unnest(actual) v)
     IS DISTINCT FROM (SELECT array_agg(v ORDER BY v) FROM unnest(allowed_columns) v) THEN
    RAISE EXCEPTION 'AUDIT-OWNER: column privileges differ from the allow-list; found %', actual;
  END IF;

  SELECT coalesce(array_agg(n.nspname || '.' || p.proname || ':' || x.privilege_type ORDER BY 1), ARRAY[]::text[])
    INTO actual
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  CROSS JOIN aclexplode(p.proacl) x
  WHERE x.grantee = v_owner AND p.proname <> ALL (owned_functions);
  IF (SELECT array_agg(v ORDER BY v) FROM unnest(actual) v)
     IS DISTINCT FROM (SELECT array_agg(v ORDER BY v) FROM unnest(allowed_functions) v) THEN
    RAISE EXCEPTION 'AUDIT-OWNER: function privileges differ from the allow-list; found %', actual;
  END IF;

  SELECT string_agg(format('%s:%s', d.defaclobjtype, x.privilege_type), ', ') INTO v_bad
  FROM pg_default_acl d CROSS JOIN aclexplode(d.defaclacl) x WHERE x.grantee = v_owner;
  IF v_bad IS NOT NULL THEN RAISE EXCEPTION 'AUDIT-OWNER: named in default privileges: %', v_bad; END IF;

  SELECT string_agg(format('%s:%s:%s', p.proname, p.prosecdef, array_to_string(p.proconfig, ',')), ', ')
    INTO v_bad
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE p.proowner = v_owner AND n.nspname = 'tenant_data'
    AND NOT (
      (p.proname IN ('immutability_041_row_key','immutability_041_serialize',
                     'immutability_041_schema_fingerprint','immutability_041_expected_fingerprint')
        AND NOT p.prosecdef AND p.proconfig = ARRAY['search_path=pg_catalog'])
      OR (p.proname = 'immutability_041_audit_origin'
        AND NOT p.prosecdef AND p.proconfig = ARRAY['search_path=pg_catalog, tenant_data'])
      OR (p.proname IN ('immutability_041_audit_row','immutability_041_audit_native_guard')
        AND p.prosecdef AND p.proconfig = ARRAY['search_path=pg_catalog, tenant_data'])
    );
  IF v_bad IS NOT NULL THEN RAISE EXCEPTION 'AUDIT-OWNER: unexpected function configuration: %', v_bad; END IF;
END;
$fn$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_roles r
    WHERE r.rolname = 'saven_audit_definer'
      AND r.rolcanlogin = false AND r.rolsuper = false AND r.rolcreatedb = false
      AND r.rolcreaterole = false AND r.rolinherit = false AND r.rolbypassrls = false
      AND r.rolreplication = false
  ) THEN
    RAISE EXCEPTION 'PIVOT-006: audit owner must remain a constrained NOLOGIN role';
  END IF;
END $$;

SELECT pg_temp.saven_assert_audit_owner();
DROP FUNCTION pg_temp.saven_assert_audit_owner();

COMMIT;
