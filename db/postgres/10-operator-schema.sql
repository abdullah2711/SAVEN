-- PIVOT-002: Purpose A operator control-plane schema.
-- Run after 00-roles.sql with a connection that is a member of saven_migrator
-- (or a superuser). DDL objects are owned by saven_migrator, the offline DDL role.
-- This file contains no credentials, passwords or connection strings.

BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'saven_migrator') THEN
    RAISE EXCEPTION 'Run 00-roles.sql before 10-operator-schema.sql';
  END IF;
  IF NOT pg_has_role(current_user, 'saven_migrator', 'MEMBER') THEN
    RAISE EXCEPTION 'Run 10-operator-schema.sql as a member of saven_migrator';
  END IF;
END $$;

CREATE SCHEMA IF NOT EXISTS operator;
GRANT USAGE, CREATE ON SCHEMA operator TO saven_migrator;
ALTER SCHEMA operator OWNER TO saven_migrator;
SET LOCAL ROLE saven_migrator;

REVOKE ALL ON SCHEMA operator FROM PUBLIC;

COMMENT ON SCHEMA operator IS
  'Purpose A operator control plane: vendor-owned, cross-tenant by design, no tenant RLS, zero customer-app privileges.';

-- Growing operator domains live here rather than in CHECK lists or code.
-- New values are added as active/effective-dated rows without a migration.
CREATE TABLE IF NOT EXISTS operator.reference_value (
  domain text NOT NULL,
  value text NOT NULL,
  label text NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  effective_from timestamptz NOT NULL DEFAULT now(),
  effective_to timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (domain, value),
  CHECK (length(btrim(domain)) BETWEEN 1 AND 80),
  CHECK (length(btrim(value)) BETWEEN 1 AND 120),
  CHECK (length(btrim(label)) BETWEEN 1 AND 200),
  CHECK (effective_to IS NULL OR effective_to > effective_from)
);
COMMENT ON TABLE operator.reference_value IS
  'Seeded operator reference domains and labels. Effective dates are declared data for future policy; this bootstrap does not enforce foreign-key lookups or an effective-dated policy engine.';

INSERT INTO operator.reference_value (domain, value, label) VALUES
  ('tenant_status', 'PROVISIONING', 'Provisioning'),
  ('tenant_status', 'ACTIVE', 'Active'),
  ('tenant_status', 'QUARANTINED', 'Quarantined'),
  ('tenant_status', 'SUSPENDED', 'Suspended'),
  ('tenant_plan', 'STANDARD', 'Standard'),
  ('tenant_plan', 'PRIVATE', 'Fully Private'),
  ('entitlement_tier', 'CLOUD', 'SAVEN Cloud'),
  ('entitlement_tier', 'PRIVATE', 'Fully Private'),
  ('placement_state', 'PROVISIONING', 'Provisioning'),
  ('placement_state', 'ACTIVE', 'Active'),
  ('placement_state', 'QUARANTINED', 'Quarantined'),
  ('placement_state', 'FENCED', 'Fenced'),
  ('job_state', 'READY', 'Ready'),
  ('job_state', 'RUNNING', 'Running'),
  ('job_state', 'DONE', 'Done'),
  ('job_state', 'FAILED', 'Failed'),
  ('ai_request_state', 'RUNNING', 'Running'),
  ('ai_request_state', 'COMPLETED', 'Completed'),
  ('ai_request_state', 'FAILED', 'Failed'),
  ('migration_state', 'SUCCEEDED', 'Succeeded'),
  ('migration_state', 'QUARANTINED', 'Quarantined'),
  ('source_store', 'identity', 'Identity'),
  ('source_store', 'commerce', 'Commerce'),
  ('source_store', 'fleet', 'Fleet'),
  ('source_store', 'jobs', 'Jobs'),
  ('source_store', 'tenant', 'Tenant'),
  ('feature_flag_scope', 'GLOBAL', 'Global'),
  ('feature_flag_scope', 'TENANT', 'Tenant'),
  ('operator_action', 'TENANT_CREATED', 'Tenant created'),
  ('operator_action', 'TENANT_UPDATED', 'Tenant updated'),
  ('operator_action', 'ENTITLEMENT_ISSUED', 'Entitlement issued'),
  ('operator_action', 'FEATURE_FLAG_UPDATED', 'Feature flag updated'),
  ('operator_action', 'TENANT_READ', 'Cross-tenant read')
ON CONFLICT (domain, value) DO NOTHING;

-- Canonical subscriber directory. tenant_id is a UUID; the original text id is
-- retained uniquely in legacy_id. Identity/membership remain in auth.*, not here.
CREATE TABLE IF NOT EXISTS operator.tenant (
  tenant_id uuid PRIMARY KEY,
  legacy_id text NOT NULL UNIQUE,
  legal_name text NOT NULL,
  status text NOT NULL DEFAULT 'PROVISIONING',
  plan text NOT NULL DEFAULT 'STANDARD',
  owner_legacy_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  suspended_at timestamptz,
  created_by text,
  updated_by text,
  CHECK (length(btrim(legacy_id)) BETWEEN 1 AND 200),
  CHECK (length(btrim(legal_name)) BETWEEN 1 AND 300),
  CHECK (length(btrim(status)) BETWEEN 1 AND 80),
  CHECK (length(btrim(plan)) BETWEEN 1 AND 80)
);
COMMENT ON TABLE operator.tenant IS
  'Canonical subscriber directory; entitlement and placement reference tenant_id.';
COMMENT ON COLUMN operator.tenant.status IS
  'Declared operator.reference_value domain (tenant_status). Application validation is deferred and not database-enforced in this bootstrap.';
COMMENT ON COLUMN operator.tenant.plan IS
  'Declared operator.reference_value domain (tenant_plan). Application validation is deferred and not database-enforced in this bootstrap.';
COMMENT ON COLUMN operator.tenant.legacy_id IS
  'Original native tenant id; unique UUID mapping source. Never cast existing text ids to UUID.';
COMMENT ON COLUMN operator.tenant.owner_legacy_id IS
  'Source provenance only; auth.users and auth.tenant_membership own identity and admission.';

CREATE TABLE IF NOT EXISTS operator.entitlement (
  id bigserial PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES operator.tenant(tenant_id) ON DELETE RESTRICT,
  version bigint NOT NULL CHECK (version > 0),
  tier text NOT NULL,
  public_key text NOT NULL DEFAULT '',
  signature text NOT NULL DEFAULT '',
  issued_at timestamptz NOT NULL DEFAULT now(),
  writes_until bigint CHECK (writes_until IS NULL OR writes_until >= 0),
  source text NOT NULL DEFAULT 'native',
  claims_jsonb jsonb NOT NULL DEFAULT '{}'::jsonb,
  claims_schema_version integer NOT NULL DEFAULT 1 CHECK (claims_schema_version > 0),
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by text,
  updated_by text,
  UNIQUE (tenant_id, version),
  CHECK (length(btrim(tier)) BETWEEN 1 AND 80),
  CHECK (length(btrim(source)) BETWEEN 1 AND 200)
);
COMMENT ON TABLE operator.entitlement IS
  'Versioned Cloud/Private entitlement claims; issued rows are immutable and superseded by a new version.';
COMMENT ON COLUMN operator.entitlement.tier IS
  'Declared operator.reference_value domain (entitlement_tier). Application validation is deferred.';
COMMENT ON COLUMN operator.entitlement.writes_until IS
  'Preserved native epoch-millisecond write entitlement boundary; null for non-native claims.';
COMMENT ON COLUMN operator.entitlement.claims_jsonb IS
  'Versioned claim payload bound to claims_schema_version; JSON-schema validation and entitlement activation are deferred and not database-enforced in this bootstrap.';

CREATE TABLE IF NOT EXISTS operator.operator_audit (
  id bigserial PRIMARY KEY,
  actor_id text NOT NULL,
  action text NOT NULL,
  target_tenant_id uuid,
  reason text NOT NULL DEFAULT '',
  at timestamptz NOT NULL DEFAULT now(),
  request_id text,
  payload_jsonb jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (length(btrim(actor_id)) BETWEEN 1 AND 200),
  CHECK (length(btrim(action)) BETWEEN 1 AND 120)
);
COMMENT ON TABLE operator.operator_audit IS
  'Append-only operator authority audit; failed cross-tenant reads must be independently durable.';
COMMENT ON COLUMN operator.operator_audit.target_tenant_id IS
  'Intentionally not a foreign key so failed/unknown-target attempts remain auditable.';

CREATE TABLE IF NOT EXISTS operator.feature_flag (
  id bigserial PRIMARY KEY,
  key text NOT NULL,
  tenant_scope uuid REFERENCES operator.tenant(tenant_id) ON DELETE RESTRICT,
  enabled boolean NOT NULL DEFAULT false,
  value_jsonb jsonb NOT NULL DEFAULT '{}'::jsonb,
  value_schema_version integer NOT NULL DEFAULT 1 CHECK (value_schema_version > 0),
  description text NOT NULL DEFAULT '',
  is_active boolean NOT NULL DEFAULT true,
  effective_from timestamptz NOT NULL DEFAULT now(),
  effective_to timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by text,
  updated_by text,
  CHECK (length(btrim(key)) BETWEEN 1 AND 120),
  CHECK (effective_to IS NULL OR effective_to > effective_from),
  UNIQUE NULLS NOT DISTINCT (key, tenant_scope)
);
COMMENT ON TABLE operator.feature_flag IS
  'Operator-controlled feature flags; null tenant_scope means global, enabled defaults false.';
COMMENT ON COLUMN operator.feature_flag.value_jsonb IS
  'Versioned JSON object bound to value_schema_version; application validation is deferred and not database-enforced in this bootstrap.';

CREATE TABLE IF NOT EXISTS operator.tenant_placement (
  tenant_id uuid PRIMARY KEY REFERENCES operator.tenant(tenant_id) ON DELETE RESTRICT,
  state text NOT NULL DEFAULT 'PROVISIONING',
  schema_version integer NOT NULL CHECK (schema_version > 0),
  generation bigint NOT NULL CHECK (generation > 0),
  node_id text,
  fenced_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by text,
  CHECK (length(btrim(state)) BETWEEN 1 AND 80)
);
COMMENT ON TABLE operator.tenant_placement IS
  'Control-plane placement; generation is the writable-owner fence, not a tenant business record.';
COMMENT ON COLUMN operator.tenant_placement.state IS
  'Declared operator.reference_value domain (placement_state). Application validation is deferred.';

CREATE TABLE IF NOT EXISTS operator.jobs (
  tenant_id uuid NOT NULL REFERENCES operator.tenant(tenant_id) ON DELETE RESTRICT,
  command_id text NOT NULL,
  state text NOT NULL DEFAULT 'READY',
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  lease_token text,
  lease_until timestamptz,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, command_id),
  CHECK (length(btrim(command_id)) BETWEEN 1 AND 200),
  CHECK (length(btrim(state)) BETWEEN 1 AND 80)
);
COMMENT ON TABLE operator.jobs IS
  'Operational control-plane jobs; never financial authority or a substitute tenant inbox.';
COMMENT ON COLUMN operator.jobs.state IS
  'Declared operator.reference_value domain (job_state). Application validation is deferred.';

CREATE TABLE IF NOT EXISTS operator.ai_requests (
  id text PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES operator.tenant(tenant_id) ON DELETE RESTRICT,
  user_id text NOT NULL,
  company text NOT NULL,
  question_digest text NOT NULL,
  state text NOT NULL DEFAULT 'RUNNING',
  model text,
  input_tokens bigint NOT NULL DEFAULT 0 CHECK (input_tokens >= 0),
  output_tokens bigint NOT NULL DEFAULT 0 CHECK (output_tokens >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  CHECK (length(btrim(id)) BETWEEN 1 AND 120),
  CHECK (length(btrim(user_id)) BETWEEN 1 AND 200),
  CHECK (length(btrim(company)) BETWEEN 1 AND 120),
  CHECK (length(btrim(question_digest)) BETWEEN 1 AND 200),
  CHECK (length(btrim(state)) BETWEEN 1 AND 80)
);
COMMENT ON TABLE operator.ai_requests IS
  'Redacted AI usage/reservation metadata only; no prompt, document body or proposal table.';
COMMENT ON COLUMN operator.ai_requests.state IS
  'Declared operator.reference_value domain (ai_request_state). Application validation is deferred.';

CREATE TABLE IF NOT EXISTS operator.migration_events (
  id bigserial PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES operator.tenant(tenant_id) ON DELETE RESTRICT,
  from_version integer NOT NULL,
  to_version integer NOT NULL,
  state text NOT NULL,
  detail text NOT NULL DEFAULT '',
  happened_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (from_version >= 0 AND to_version >= 0),
  CHECK (length(btrim(state)) BETWEEN 1 AND 80),
  CHECK (length(detail) <= 2000)
);
COMMENT ON TABLE operator.migration_events IS
  'Append-only per-tenant migration history.';

CREATE TABLE IF NOT EXISTS operator.source_store_migrations (
  id bigserial PRIMARY KEY,
  source_store text NOT NULL,
  tenant_id uuid,
  version integer NOT NULL CHECK (version > 0),
  checksum text NOT NULL,
  source_applied_at timestamptz NOT NULL,
  imported_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (length(btrim(source_store)) BETWEEN 1 AND 80),
  CHECK (length(btrim(checksum)) BETWEEN 1 AND 200),
  UNIQUE NULLS NOT DISTINCT (source_store, tenant_id, version)
);
COMMENT ON TABLE operator.source_store_migrations IS
  'Immutable native source-store provenance; tenant_id is intentionally not a foreign key.';

CREATE TABLE IF NOT EXISTS operator.pg_schema_migrations (
  version integer PRIMARY KEY,
  description text NOT NULL,
  checksum text NOT NULL,
  applied_at timestamptz NOT NULL DEFAULT now(),
  applied_by text NOT NULL DEFAULT current_user,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (version > 0),
  CHECK (length(btrim(description)) BETWEEN 1 AND 300),
  CHECK (length(btrim(checksum)) BETWEEN 1 AND 200)
);
COMMENT ON TABLE operator.pg_schema_migrations IS
  'Immutable PostgreSQL migration ledger; separate from native source-store checksums.';

CREATE INDEX IF NOT EXISTS tenant_status_idx ON operator.tenant (status);
CREATE INDEX IF NOT EXISTS entitlement_tenant_active_idx ON operator.entitlement (tenant_id, is_active, version DESC);
CREATE INDEX IF NOT EXISTS feature_flag_key_idx ON operator.feature_flag (key);
CREATE INDEX IF NOT EXISTS tenant_placement_state_idx ON operator.tenant_placement (state);
CREATE INDEX IF NOT EXISTS jobs_state_updated_idx ON operator.jobs (state, updated_at);
CREATE INDEX IF NOT EXISTS ai_requests_tenant_created_idx ON operator.ai_requests (tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS ai_requests_user_created_idx ON operator.ai_requests (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS migration_events_tenant_at_idx ON operator.migration_events (tenant_id, happened_at DESC);
CREATE INDEX IF NOT EXISTS source_store_migrations_store_idx ON operator.source_store_migrations (source_store, version);
CREATE INDEX IF NOT EXISTS operator_audit_target_at_idx ON operator.operator_audit (target_tenant_id, at DESC);
CREATE INDEX IF NOT EXISTS operator_audit_actor_at_idx ON operator.operator_audit (actor_id, at DESC);
CREATE INDEX IF NOT EXISTS operator_audit_action_at_idx ON operator.operator_audit (action, at DESC);
CREATE INDEX IF NOT EXISTS reference_value_active_idx ON operator.reference_value (domain, is_active);

CREATE OR REPLACE FUNCTION operator.touch_updated_at() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION operator.reject_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'OPERATOR_RECORD_IMMUTABLE';
END;
$$;

DROP TRIGGER IF EXISTS tenant_touch_updated_at ON operator.tenant;
CREATE TRIGGER tenant_touch_updated_at BEFORE UPDATE ON operator.tenant
  FOR EACH ROW EXECUTE FUNCTION operator.touch_updated_at();

DROP TRIGGER IF EXISTS entitlement_touch_updated_at ON operator.entitlement;
CREATE TRIGGER entitlement_touch_updated_at BEFORE UPDATE ON operator.entitlement
  FOR EACH ROW EXECUTE FUNCTION operator.touch_updated_at();

DROP TRIGGER IF EXISTS feature_flag_touch_updated_at ON operator.feature_flag;
CREATE TRIGGER feature_flag_touch_updated_at BEFORE UPDATE ON operator.feature_flag
  FOR EACH ROW EXECUTE FUNCTION operator.touch_updated_at();

DROP TRIGGER IF EXISTS tenant_placement_touch_updated_at ON operator.tenant_placement;
CREATE TRIGGER tenant_placement_touch_updated_at BEFORE UPDATE ON operator.tenant_placement
  FOR EACH ROW EXECUTE FUNCTION operator.touch_updated_at();

DROP TRIGGER IF EXISTS jobs_touch_updated_at ON operator.jobs;
CREATE TRIGGER jobs_touch_updated_at BEFORE UPDATE ON operator.jobs
  FOR EACH ROW EXECUTE FUNCTION operator.touch_updated_at();

DROP TRIGGER IF EXISTS ai_requests_touch_updated_at ON operator.ai_requests;
CREATE TRIGGER ai_requests_touch_updated_at BEFORE UPDATE ON operator.ai_requests
  FOR EACH ROW EXECUTE FUNCTION operator.touch_updated_at();

DROP TRIGGER IF EXISTS reference_value_touch_updated_at ON operator.reference_value;
CREATE TRIGGER reference_value_touch_updated_at BEFORE UPDATE ON operator.reference_value
  FOR EACH ROW EXECUTE FUNCTION operator.touch_updated_at();

DROP TRIGGER IF EXISTS operator_audit_no_update ON operator.operator_audit;
CREATE TRIGGER operator_audit_no_update BEFORE UPDATE OR DELETE ON operator.operator_audit
  FOR EACH ROW EXECUTE FUNCTION operator.reject_mutation();

DROP TRIGGER IF EXISTS pg_schema_migrations_no_mutation ON operator.pg_schema_migrations;
CREATE TRIGGER pg_schema_migrations_no_mutation BEFORE UPDATE OR DELETE ON operator.pg_schema_migrations
  FOR EACH ROW EXECUTE FUNCTION operator.reject_mutation();

DROP TRIGGER IF EXISTS source_store_migrations_no_mutation ON operator.source_store_migrations;
CREATE TRIGGER source_store_migrations_no_mutation BEFORE UPDATE OR DELETE ON operator.source_store_migrations
  FOR EACH ROW EXECUTE FUNCTION operator.reject_mutation();

DROP TRIGGER IF EXISTS migration_events_no_mutation ON operator.migration_events;
CREATE TRIGGER migration_events_no_mutation BEFORE UPDATE OR DELETE ON operator.migration_events
  FOR EACH ROW EXECUTE FUNCTION operator.reject_mutation();

DROP TRIGGER IF EXISTS entitlement_no_mutation ON operator.entitlement;
CREATE TRIGGER entitlement_no_mutation BEFORE UPDATE OR DELETE ON operator.entitlement
  FOR EACH ROW EXECUTE FUNCTION operator.reject_mutation();

DROP TRIGGER IF EXISTS operator_audit_no_truncate ON operator.operator_audit;
CREATE TRIGGER operator_audit_no_truncate BEFORE TRUNCATE ON operator.operator_audit
  FOR EACH STATEMENT EXECUTE FUNCTION operator.reject_mutation();

DROP TRIGGER IF EXISTS pg_schema_migrations_no_truncate ON operator.pg_schema_migrations;
CREATE TRIGGER pg_schema_migrations_no_truncate BEFORE TRUNCATE ON operator.pg_schema_migrations
  FOR EACH STATEMENT EXECUTE FUNCTION operator.reject_mutation();

DROP TRIGGER IF EXISTS source_store_migrations_no_truncate ON operator.source_store_migrations;
CREATE TRIGGER source_store_migrations_no_truncate BEFORE TRUNCATE ON operator.source_store_migrations
  FOR EACH STATEMENT EXECUTE FUNCTION operator.reject_mutation();

DROP TRIGGER IF EXISTS migration_events_no_truncate ON operator.migration_events;
CREATE TRIGGER migration_events_no_truncate BEFORE TRUNCATE ON operator.migration_events
  FOR EACH STATEMENT EXECUTE FUNCTION operator.reject_mutation();

DROP TRIGGER IF EXISTS entitlement_no_truncate ON operator.entitlement;
CREATE TRIGGER entitlement_no_truncate BEFORE TRUNCATE ON operator.entitlement
  FOR EACH STATEMENT EXECUTE FUNCTION operator.reject_mutation();

REVOKE ALL ON SCHEMA operator FROM PUBLIC;
REVOKE ALL ON ALL TABLES IN SCHEMA operator FROM PUBLIC;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA operator FROM PUBLIC;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA operator FROM PUBLIC;

-- Customer and auth roles have zero operator.* access.
REVOKE ALL ON SCHEMA operator FROM saven_customer_app, saven_auth_service, saven_auth_definer;
REVOKE ALL ON ALL TABLES IN SCHEMA operator FROM saven_customer_app, saven_auth_service, saven_auth_definer;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA operator FROM saven_customer_app, saven_auth_service, saven_auth_definer;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA operator FROM saven_customer_app, saven_auth_service, saven_auth_definer;

-- Operator read role: read only; no DDL and no tenant_data direct access.
GRANT USAGE ON SCHEMA operator TO saven_operator_read, saven_operator_admin, saven_operator_definer;
GRANT SELECT ON
  operator.reference_value,
  operator.tenant,
  operator.entitlement,
  operator.operator_audit,
  operator.feature_flag,
  operator.tenant_placement,
  operator.jobs,
  operator.ai_requests,
  operator.migration_events,
  operator.pg_schema_migrations,
  operator.source_store_migrations
TO saven_operator_read;

-- Operator write role: operational state only; issued entitlements and append-only
-- ledgers are insert-only, and append-only histories are also truncate-protected.
GRANT SELECT, INSERT, UPDATE ON
  operator.reference_value,
  operator.tenant,
  operator.feature_flag,
  operator.tenant_placement,
  operator.jobs
TO saven_operator_admin;
GRANT SELECT, INSERT ON operator.entitlement TO saven_operator_admin;
GRANT SELECT, INSERT ON
  operator.operator_audit,
  operator.migration_events,
  operator.source_store_migrations
TO saven_operator_admin;
GRANT SELECT, INSERT, UPDATE ON operator.ai_requests TO saven_operator_admin;
GRANT SELECT ON operator.pg_schema_migrations TO saven_operator_admin;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA operator TO saven_operator_admin;

-- Definer owner: non-login owner for future audited operator functions.
GRANT SELECT ON
  operator.reference_value,
  operator.tenant,
  operator.entitlement,
  operator.operator_audit,
  operator.feature_flag,
  operator.tenant_placement,
  operator.jobs,
  operator.ai_requests,
  operator.migration_events,
  operator.pg_schema_migrations,
  operator.source_store_migrations
TO saven_operator_definer;
GRANT INSERT ON operator.operator_audit TO saven_operator_definer;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA operator TO saven_operator_definer;

COMMIT;
