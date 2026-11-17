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

-- Resolve a column type to its catalog base type identity. Domains are followed
-- recursively to their base type and effective typmod. Type identity is never a name
-- string comparison.
CREATE FUNCTION tenant_data.immutability_041_resolve_type(p_type oid, p_typmod integer)
RETURNS TABLE(base_oid oid, base_typmod integer)
LANGUAGE plpgsql STABLE
SET search_path = pg_catalog
AS $fn$
DECLARE
  v_type oid := p_type;
  v_mod integer := p_typmod;
  v_kind "char";
  v_base oid;
  v_dommod integer;
BEGIN
  LOOP
    SELECT t.typtype, t.typbasetype, t.typtypmod
      INTO v_kind, v_base, v_dommod
    FROM pg_type t WHERE t.oid = v_type;
    IF NOT FOUND THEN
      RETURN;
    END IF;
    IF v_kind <> 'd' THEN
      RETURN QUERY SELECT v_type, v_mod;
      RETURN;
    END IF;
    v_type := v_base;
    IF v_dommod <> -1 THEN
      v_mod := v_dommod;
    END IF;
  END LOOP;
END;
$fn$;

CREATE FUNCTION tenant_data.immutability_041_type_supported(p_base_oid oid)
RETURNS boolean
LANGUAGE sql IMMUTABLE
SET search_path = pg_catalog
AS $fn$
  SELECT p_base_oid IN (
    'pg_catalog.jsonb'::regtype, 'pg_catalog.json'::regtype,
    'pg_catalog.text'::regtype, 'pg_catalog.varchar'::regtype, 'pg_catalog.bpchar'::regtype,
    'pg_catalog.int8'::regtype, 'pg_catalog.int4'::regtype, 'pg_catalog.int2'::regtype,
    'pg_catalog.numeric'::regtype, 'pg_catalog.bool'::regtype, 'pg_catalog.uuid'::regtype,
    'pg_catalog.timestamptz'::regtype, 'pg_catalog.timestamp'::regtype,
    'pg_catalog.date'::regtype)
$fn$;

COMMENT ON FUNCTION tenant_data.immutability_041_resolve_type(oid, integer) IS
  'PIVOT-006 payload 041: resolves a column type (including nested domains) to its catalog base type OID and effective typmod. No name-string comparison.';
COMMENT ON FUNCTION tenant_data.immutability_041_type_supported(oid) IS
  'PIVOT-006 payload 041: exact catalog-OID allow-list for representable base types. Domains are resolved before this check; anything else is unrepresentable and fails closed.';

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
    string_agg(a.attname || ':' || r.base_oid::text || ':' || r.base_typmod, ',' ORDER BY a.attnum),
    'UTF8')), 'hex')
  FROM pg_attribute a
  CROSS JOIN LATERAL tenant_data.immutability_041_resolve_type(a.atttypid, a.atttypmod) r
  WHERE a.attrelid = p_table AND a.attnum > 0 AND NOT a.attisdropped
$fn$;

CREATE FUNCTION tenant_data.immutability_041_expected_fingerprint(p_table regclass)
RETURNS text
LANGUAGE sql IMMUTABLE
SET search_path = pg_catalog
AS $fn$
  SELECT CASE p_table::text
    WHEN 'tenant_data.account_profiles' THEN 'c900004a9a44f0c08faa3e0cc08164831f906b8f5c7ce94ebf206a819702ce64'
    WHEN 'tenant_data.accounts' THEN 'e1814fdefafba042e46d94e3889a5bb9e8b06d97a434e94546101c31f89333fc'
    WHEN 'tenant_data.approval_policy' THEN 'b9c3e6f6c8a5e28f98a25af0a92615aaa26ae75c377aa29ee25b7ae247b48d97'
    WHEN 'tenant_data.approval_requests' THEN '3569fb3fdff4c59011d30b6f888683cd6452be9968316728eb55f3302c21d12c'
    WHEN 'tenant_data.assignments' THEN '0ecbf90620f6174424e1365cbeee4a9c30e6c756a757cc35bffaa17707a6f00a'
    WHEN 'tenant_data.business' THEN 'c9effa81e6d8edb7ee23d903e7db0585dbae72a068efc8da2ee3398e54b0be76'
    WHEN 'tenant_data.business_rule' THEN '2238cb481dc92f24766b5d09bfccf6ea13b175bdbf52eb8dd384456673a36271'
    WHEN 'tenant_data.command_decisions' THEN 'e385b60c68f1085e06edf514562d286550f6762c8a39d4b4182e838768f1f21c'
    WHEN 'tenant_data.command_files' THEN '594dfe9d43f18ef1af680182dbcbc3a89e201d4af043fec47c79a0975742727e'
    WHEN 'tenant_data.company_profiles' THEN 'efce45b0c8e0015f438b8acbb405f17e7d511cb014d628da194226fd5c37b83e'
    WHEN 'tenant_data.company_settings' THEN '71633b2df765fd05962cbe6555058cb79dfb0ea176e4219105c9e0b01f01310d'
    WHEN 'tenant_data.denials' THEN 'dd586d45f2619011cab6bd72ba19eb9d8458e2d3b6ef9c5b48fe7ed310fc5d0c'
    WHEN 'tenant_data.document_numbers' THEN '7bdeed7d05a13003752a765e3dfaa8b7461713a2e96836b47218be24214c01ce'
    WHEN 'tenant_data.document_registry' THEN '200f0febd163fd3dd37594c71b75670543559231d34c09fead0caed9e8309592'
    WHEN 'tenant_data.document_revisions' THEN '971e4a7f717b8f61f9f8d02b16cc8b7e8fec5a7539f7fbb12c6cd1297139369d'
    WHEN 'tenant_data.document_sequences' THEN 'b1ff532b9ee3c1f43547b017bc03de33be89724d86c145bddb459a13b10371a6'
    WHEN 'tenant_data.inventory_controls' THEN 'cd546f1c4e9ef41f99a01570b6bd8b0a888717db51f8b8c5947c5d65a6238881'
    WHEN 'tenant_data.journal_corrections' THEN '9486512e450ed90ccc5b8bdc93d754e489c420f56a323cd0043b27fde393666c'
    WHEN 'tenant_data.journal_drafts' THEN '3e43345d1b450931e72114ebf20bcafb5464a0ff3dcdc5330f9644daf3a178e8'
    WHEN 'tenant_data.journal_lines' THEN 'edc77b423a62254c60a127833d2c89b7d5531b94054e4e5e98c6b9136e02a5a6'
    WHEN 'tenant_data.journals' THEN '78e8524b95e70c6c9e5f1029fbc112c00893bbb977c71daca1706fab0d23edf9'
    WHEN 'tenant_data.members' THEN '5392ec796dcf87799033e8d98f5e7e5d72019b3c4a311d3d2cb13826bdb0b713'
    WHEN 'tenant_data.periods' THEN 'c391e41ec9e01b2125a522343a129caba9d8dc2a1e58fce9e9e40021b48eec5c'
    WHEN 'tenant_data.posting_constraint' THEN '58831f006a2336f096440a965e712133d81dc7a4e90eb41d29dca32ed757f942'
    WHEN 'tenant_data.reference_values' THEN '1142ad09baf60bcc3746f625aeeb05ed15210051fec1a960fe7a0b8a6b15e4d1'
    WHEN 'tenant_data.roles' THEN '3b47c933d8de5abfac5eed0038fe2f4affb142d699cbe7701fdde2049c9cb15f'
    WHEN 'tenant_data.stock_balances' THEN 'b95efcb325181ce17676254984ff964e7e33d516935a3f97973ff7d44469ee03'
    WHEN 'tenant_data.stock_items' THEN 'a0e62f65e65dafdb0e22b26560201021c08a9f7148c879a43e74ca4b85d683cd'
    WHEN 'tenant_data.stock_movements' THEN '2b8614df369813b4c534896d421e74d93d97d08153152de2c57994538ce83a2c'
    WHEN 'tenant_data.stock_operations' THEN 'a1b71a3c72be8708889906d382856ef27fb3adb8b137b23e0935c96c4c652feb'
    WHEN 'tenant_data.support_grants' THEN '2dae81ac3ff4d4228a4b4e43a0d5dc64a6adbd2753d3a8414d9289d3972f4aef'
    WHEN 'tenant_data.tax_profile' THEN 'f16bb966c3c20c0f5c3d553c6b482733e88af30b662a0d87943be79be0bc99a0'
    WHEN 'tenant_data.trade_allocations' THEN '568110dbdfd095b0f224d2373fb4299508638eedb1a51b9cbb50b88b5fbaef60'
    WHEN 'tenant_data.trade_controls' THEN '49751d18dcd147982d95d529d4604f256741a1551ab22389ae4fb2578ea5bd7e'
    WHEN 'tenant_data.trade_credit_lines' THEN 'c029415b96c704c6388613b2301ae6aaab1f262d0bc07838e1c00f171262dd0c'
    WHEN 'tenant_data.trade_credits' THEN '47e191fa5338f7564b709146a0d1fbc34ae27941462d9300f5647358ed72e4e6'
    WHEN 'tenant_data.trade_documents' THEN '40a8cdaa50f9105feef229aabc2256278253379be5cfaf6e4d478924d0fdca81'
    WHEN 'tenant_data.trade_lines' THEN '6542630e0ff1986c2fe80ee8d853a27219775c056f9e8afaf53e9269e40bf481'
    WHEN 'tenant_data.trade_operations' THEN '83e7de236ac73080e6c0282684b570f40ebca0b50e04483f519b105c5f15ebdb'
    WHEN 'tenant_data.trade_parties' THEN 'a2fee79ab8fcb98a89eb4765770b336caef3e9ebecf668013a7a90f3ae9bbd96'
    WHEN 'tenant_data.verified_entitlement' THEN '61f810264d5c7a5ce99002253ee66052d3367cab1bd6ff69acd14f10653966f6'
    WHEN 'tenant_data.warehouses' THEN '35c658bdc72a18bb0c80e6a1ac27251eb4be2246f166a359778496eb89d7ad8e'
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
    SELECT a.attname, r.base_oid, r.base_typmod
    FROM pg_attribute a
    CROSS JOIN LATERAL tenant_data.immutability_041_resolve_type(a.atttypid, a.atttypmod) r
    WHERE a.attrelid = p_table AND a.attnum > 0 AND NOT a.attisdropped
    ORDER BY a.attnum
  LOOP
    v_value := p_row -> v_col.attname;
    IF v_value IS NULL THEN
      v_row := v_row || jsonb_build_object(v_col.attname, NULL);
    ELSIF v_col.base_oid IN ('pg_catalog.jsonb'::regtype, 'pg_catalog.json'::regtype) THEN
      v_row := v_row || jsonb_build_object(v_col.attname, jsonb_build_object(
        'redacted', true,
        'type', format_type(v_col.base_oid, v_col.base_typmod),
        'sha256', encode(sha256(convert_to(v_value::text, 'UTF8')), 'hex')));
      v_redacted := array_append(v_redacted, v_col.attname);
    ELSIF v_col.base_oid IN ('pg_catalog.text'::regtype, 'pg_catalog.varchar'::regtype,
                             'pg_catalog.bpchar'::regtype) THEN
      IF v_col.attname = ANY(v_safe_text) THEN
        v_row := v_row || jsonb_build_object(v_col.attname, v_value);
      ELSE
        v_row := v_row || jsonb_build_object(v_col.attname, jsonb_build_object(
          'redacted', true,
          'type', format_type(v_col.base_oid, v_col.base_typmod),
          'sha256', encode(sha256(convert_to(v_value::text, 'UTF8')), 'hex')));
        v_redacted := array_append(v_redacted, v_col.attname);
      END IF;
    ELSIF v_col.base_oid IN (
      'pg_catalog.int8'::regtype, 'pg_catalog.int4'::regtype, 'pg_catalog.int2'::regtype,
      'pg_catalog.numeric'::regtype, 'pg_catalog.bool'::regtype, 'pg_catalog.uuid'::regtype,
      'pg_catalog.timestamptz'::regtype, 'pg_catalog.timestamp'::regtype,
      'pg_catalog.date'::regtype) THEN
      -- Catalog base type identity (domains already resolved). Parameterized numerics
      -- (for example numeric(20,4) and numeric(9,6)) keep their exact JSON value.
      v_row := v_row || jsonb_build_object(v_col.attname, v_value);
    ELSE
      RAISE EXCEPTION 'AUDIT_SERIALIZATION_UNSUPPORTED: column %.% has unreviewed base type oid %', p_table, v_col.attname, v_col.base_oid;
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
ALTER FUNCTION tenant_data.immutability_041_resolve_type(oid, integer)
  OWNER TO saven_audit_definer;
ALTER FUNCTION tenant_data.immutability_041_type_supported(oid)
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
REVOKE ALL ON FUNCTION tenant_data.immutability_041_resolve_type(oid, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION tenant_data.immutability_041_type_supported(oid) FROM PUBLIC;
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
    'immutability_041_row_key','immutability_041_resolve_type',
    'immutability_041_type_supported','immutability_041_schema_fingerprint',
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
  IF v_count <> 9 THEN RAISE EXCEPTION 'AUDIT-OWNER: expected nine owned audit functions, found %', v_count; END IF;

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
      (p.proname IN ('immutability_041_row_key','immutability_041_resolve_type',
                     'immutability_041_type_supported','immutability_041_serialize',
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
