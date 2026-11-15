-- PIVOT-003: Purpose B/C tenant schema skeleton (tables and constraints only).
-- Run after 00-roles.sql (and after 10-operator-schema.sql in the Cloud profile)
-- with a connection that is a member of saven_migrator. DDL objects are owned by
-- saven_migrator, the offline DDL role. This file contains no credentials,
-- passwords, DSNs or client data.
--
-- THIS SKELETON IS NOT SAFE TO SERVE.
--   * Row level security, forced policies and runtime grants are PIVOT-004.
--   * Posted-source immutability triggers are PIVOT-005.
--   * Business audit triggers are PIVOT-006.
--   * Tenant context is AUTH-006. Until those land, no runtime role is granted
--     any privilege on tenant_data; the schema is default-deny by omission.
--
-- Deliberately absent (each has an owner):
--   * No cross-schema foreign keys. tenant_data must not depend on operator.*
--     because the Fully Private composition omits vendor operator tables.
--     auth.users/auth.tenant_membership (AUTH-001) own the canonical UUID
--     principal, but the native text user id is preserved here and the
--     text-to-UUID mapping plus the composite membership link are finalized in
--     PIVOT-004. This file applies on the PIVOT-002 base and does not require
--     AUTH-001 to have landed first.
--   * No operator.user_identity, operator.tenant_membership or ai_proposal table.
--     auth.users/auth.tenant_membership are the canonical identity/membership
--     owners; AI-origin documents are ordinary documents in pending_approval.
--   * No audit or immutability triggers (PIVOT-005/006), no policies (PIVOT-004).
--
-- Conventions preserved from the native source (see src/local/schema.mjs and
-- src/local/document-schema.mjs):
--   * Source table and column names are never renamed. Text ids stay text; they
--     are not cast to uuid. The operator tenant UUID mapping lives in
--     operator.tenant.legacy_id, not here.
--   * Money is exact. Native integer minor units stay bigint with the same
--     bounds (0..999999999999, or >0 for document/line amounts). No float,
--     real, double precision or money type is used anywhere.
--   * Native epoch-millisecond integers stay bigint epoch milliseconds, so
--     imported values are byte-comparable with the native stores. Purpose C
--     policy tables, which have no native source, use timestamptz and exact
--     numeric decimals plus a JSON schema version.
--   * 0/1 integer flags become boolean; that mapping is lossless and is applied
--     by the adapter, not by rewriting source bytes.
--   * Growing domains (command state, document type/status, party kind, origin
--     type, ...) are reference data rows, never CHECK lists. Columns that carry
--     a configured domain say so in an inline `reference domain:` comment, and
--     the canonical seed for every domain is
--     contracts/postgres-business-rules-v1.json. A new value is a row, not a
--     migration. Only structural/accounting invariants (balance bounds,
--     debit/credit exclusivity, positive amounts, the single protected owner
--     role) are enforced with CHECK constraints.
--   * Re-running this file is intentionally refused by PostgreSQL: schema
--     changes are additive files recorded in operator.pg_schema_migrations,
--     never an in-place edit of an applied migration.

BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'saven_migrator') THEN
    RAISE EXCEPTION 'Run 00-roles.sql before 20-tenant-schema.sql';
  END IF;
  IF NOT pg_has_role(current_user, 'saven_migrator', 'MEMBER') THEN
    RAISE EXCEPTION 'Run 20-tenant-schema.sql as a member of saven_migrator';
  END IF;
END $$;

CREATE SCHEMA tenant_data;
GRANT USAGE, CREATE ON SCHEMA tenant_data TO saven_migrator;
ALTER SCHEMA tenant_data OWNER TO saven_migrator;
SET LOCAL ROLE saven_migrator;

REVOKE ALL ON SCHEMA tenant_data FROM PUBLIC;

COMMENT ON SCHEMA tenant_data IS
  'Purpose B/C tenant business and rule data. Every table carries tenant_id uuid NOT NULL. RLS, policies, runtime grants, immutability and audit triggers are PIVOT-004/005/006 and are NOT present in this skeleton.';

-- =====================================================================
-- Purpose B — identity projection, chart of accounts, periods
-- =====================================================================

-- Native tenant.business.
CREATE TABLE tenant_data.business (
  tenant_id uuid NOT NULL,
  id text NOT NULL,
  state text NOT NULL,
  created_at bigint NOT NULL DEFAULT (extract(epoch FROM now()) * 1000)::bigint,
  updated_at bigint NOT NULL DEFAULT (extract(epoch FROM now()) * 1000)::bigint,
  created_by text,
  updated_by text,
  CONSTRAINT business_pkey PRIMARY KEY (tenant_id, id),
  CONSTRAINT business_id_not_blank CHECK (length(btrim(id)) BETWEEN 1 AND 200),
  CONSTRAINT business_state_not_blank CHECK (length(btrim(state)) BETWEEN 1 AND 80)
);
COMMENT ON TABLE tenant_data.business IS
  'Native tenant.business. Business profile per tenant; state is reference data, not a CHECK list.';
COMMENT ON COLUMN tenant_data.business.state IS
  'reference domain: business_state. Application validation, not a database enum.';

-- Native tenant.members. This is the tenant-scoped projection of an admitted
-- principal, not a second admission authority: auth.tenant_membership decides
-- admission, membership status and role assignment provenance (AUTH contracts).
CREATE TABLE tenant_data.members (
  tenant_id uuid NOT NULL,
  user_id text NOT NULL,
  active boolean NOT NULL,
  created_at bigint NOT NULL DEFAULT (extract(epoch FROM now()) * 1000)::bigint,
  updated_at bigint NOT NULL DEFAULT (extract(epoch FROM now()) * 1000)::bigint,
  created_by text,
  updated_by text,
  CONSTRAINT members_pkey PRIMARY KEY (tenant_id, user_id),
  CONSTRAINT members_user_id_not_blank CHECK (length(btrim(user_id)) BETWEEN 1 AND 200)
);
COMMENT ON TABLE tenant_data.members IS
  'Native tenant.members. Tenant-local active principal projection only; auth.tenant_membership is the sole admission authority. user_id preserves the native text id; the text-to-UUID mapping and cross-schema FK are PIVOT-004.';

-- Native tenant.roles. Exactly one immutable protected ultimate-owner role
-- definition per tenant, preserved from the source and from the owner mandate.
CREATE TABLE tenant_data.roles (
  tenant_id uuid NOT NULL,
  id text NOT NULL,
  name text NOT NULL,
  protected boolean NOT NULL,
  permissions text NOT NULL,
  created_at bigint NOT NULL DEFAULT (extract(epoch FROM now()) * 1000)::bigint,
  updated_at bigint NOT NULL DEFAULT (extract(epoch FROM now()) * 1000)::bigint,
  created_by text,
  updated_by text,
  CONSTRAINT roles_pkey PRIMARY KEY (tenant_id, id),
  CONSTRAINT roles_id_not_blank CHECK (length(btrim(id)) BETWEEN 1 AND 120),
  CONSTRAINT roles_name_not_blank CHECK (length(btrim(name)) BETWEEN 1 AND 200),
  CONSTRAINT roles_protected_is_ultimate_owner CHECK (protected = (id = 'ultimate_business_admin'))
);
CREATE UNIQUE INDEX roles_one_protected_idx ON tenant_data.roles (tenant_id) WHERE protected;
COMMENT ON TABLE tenant_data.roles IS
  'Native tenant.roles. Custom ERP permission holders; the single ultimate_business_admin definition is protected and never inferred from an auth role name.';
COMMENT ON COLUMN tenant_data.roles.permissions IS
  'Native permission payload text. Configured permissions are data, not code constants.';

-- Native tenant.assignments.
CREATE TABLE tenant_data.assignments (
  tenant_id uuid NOT NULL,
  user_id text NOT NULL,
  role_id text NOT NULL,
  created_at bigint NOT NULL DEFAULT (extract(epoch FROM now()) * 1000)::bigint,
  updated_at bigint NOT NULL DEFAULT (extract(epoch FROM now()) * 1000)::bigint,
  created_by text,
  updated_by text,
  CONSTRAINT assignments_pkey PRIMARY KEY (tenant_id, user_id, role_id),
  CONSTRAINT assignments_member_fkey FOREIGN KEY (tenant_id, user_id)
    REFERENCES tenant_data.members (tenant_id, user_id) ON DELETE RESTRICT,
  CONSTRAINT assignments_role_fkey FOREIGN KEY (tenant_id, role_id)
    REFERENCES tenant_data.roles (tenant_id, id) ON DELETE RESTRICT
);
-- At most one active ultimate-owner assignment per tenant (source
-- sole_ultimate_owner). Role deactivation and owner retention are validated at
-- commit by the engine/trigger layer, not by this skeleton.
CREATE UNIQUE INDEX assignments_one_ultimate_owner_idx ON tenant_data.assignments (tenant_id)
  WHERE role_id = 'ultimate_business_admin';
COMMENT ON TABLE tenant_data.assignments IS
  'Native tenant.assignments. Exactly one ultimate-owner assignment per tenant; custom assignments grant no protected authority.';

-- Native tenant.denials.
CREATE TABLE tenant_data.denials (
  tenant_id uuid NOT NULL,
  user_id text NOT NULL,
  action text NOT NULL,
  created_at bigint NOT NULL DEFAULT (extract(epoch FROM now()) * 1000)::bigint,
  updated_at bigint NOT NULL DEFAULT (extract(epoch FROM now()) * 1000)::bigint,
  created_by text,
  updated_by text,
  CONSTRAINT denials_pkey PRIMARY KEY (tenant_id, user_id, action),
  CONSTRAINT denials_member_fkey FOREIGN KEY (tenant_id, user_id)
    REFERENCES tenant_data.members (tenant_id, user_id) ON DELETE RESTRICT,
  CONSTRAINT denials_action_not_blank CHECK (length(btrim(action)) BETWEEN 1 AND 120)
);
COMMENT ON TABLE tenant_data.denials IS
  'Native tenant.denials. Explicit tenant-local deny entries; reference domain: action_type.';

-- Native tenant.accounts. Chart of accounts is tenant data, never code.
CREATE TABLE tenant_data.accounts (
  tenant_id uuid NOT NULL,
  code text NOT NULL,
  title text NOT NULL,
  created_at bigint NOT NULL DEFAULT (extract(epoch FROM now()) * 1000)::bigint,
  updated_at bigint NOT NULL DEFAULT (extract(epoch FROM now()) * 1000)::bigint,
  created_by text,
  updated_by text,
  CONSTRAINT accounts_pkey PRIMARY KEY (tenant_id, code),
  CONSTRAINT accounts_code_not_blank CHECK (length(btrim(code)) BETWEEN 1 AND 40),
  CONSTRAINT accounts_title_not_blank CHECK (length(btrim(title)) BETWEEN 1 AND 300)
);
COMMENT ON TABLE tenant_data.accounts IS
  'Native tenant.accounts. Tenant-owned chart of accounts; account codes are data and stay tenant-scoped.';

-- Native tenant.account_profiles.
CREATE TABLE tenant_data.account_profiles (
  tenant_id uuid NOT NULL,
  code text NOT NULL,
  kind text NOT NULL,
  active boolean NOT NULL,
  created_at bigint NOT NULL DEFAULT (extract(epoch FROM now()) * 1000)::bigint,
  updated_at bigint NOT NULL DEFAULT (extract(epoch FROM now()) * 1000)::bigint,
  created_by text,
  updated_by text,
  CONSTRAINT account_profiles_pkey PRIMARY KEY (tenant_id, code),
  CONSTRAINT account_profiles_account_fkey FOREIGN KEY (tenant_id, code)
    REFERENCES tenant_data.accounts (tenant_id, code) ON DELETE RESTRICT,
  CONSTRAINT account_profiles_kind_not_blank CHECK (length(btrim(kind)) BETWEEN 1 AND 40)
);
COMMENT ON TABLE tenant_data.account_profiles IS
  'Native tenant.account_profiles. reference domain: account_kind.';

-- Native tenant.periods. Posting period lock state stays tenant/company data.
CREATE TABLE tenant_data.periods (
  tenant_id uuid NOT NULL,
  company text NOT NULL,
  start_date text NOT NULL,
  end_date text NOT NULL,
  locked boolean NOT NULL,
  created_at bigint NOT NULL DEFAULT (extract(epoch FROM now()) * 1000)::bigint,
  updated_at bigint NOT NULL DEFAULT (extract(epoch FROM now()) * 1000)::bigint,
  created_by text,
  updated_by text,
  CONSTRAINT periods_pkey PRIMARY KEY (tenant_id, company, start_date),
  CONSTRAINT periods_range_order CHECK (start_date <= end_date),
  CONSTRAINT periods_company_not_blank CHECK (length(btrim(company)) BETWEEN 1 AND 120)
);
COMMENT ON TABLE tenant_data.periods IS
  'Native tenant.periods. start_date/end_date preserve the native ISO text dates exactly.';

-- =====================================================================
-- Purpose B — immutable accepted commands, approval and posting effects
-- =====================================================================

-- Native tenant.command_inbox. Accepted payload bytes and digest are immutable
-- after acceptance; lifecycle/lease columns move. Immutability enforcement is
-- PIVOT-005, not this skeleton.
CREATE TABLE tenant_data.command_inbox (
  tenant_id uuid NOT NULL,
  id text NOT NULL,
  actor text NOT NULL,
  digest text NOT NULL,
  payload text NOT NULL,
  state text NOT NULL,
  lease_token text,
  lease_until bigint,
  error text,
  approved_by text,
  created_at bigint NOT NULL,
  updated_at bigint NOT NULL DEFAULT (extract(epoch FROM now()) * 1000)::bigint,
  updated_by text,
  CONSTRAINT command_inbox_pkey PRIMARY KEY (tenant_id, id),
  CONSTRAINT command_inbox_actor_fkey FOREIGN KEY (tenant_id, actor)
    REFERENCES tenant_data.members (tenant_id, user_id) ON DELETE RESTRICT,
  CONSTRAINT command_inbox_id_not_blank CHECK (length(btrim(id)) BETWEEN 1 AND 200),
  CONSTRAINT command_inbox_digest_not_blank CHECK (length(btrim(digest)) BETWEEN 1 AND 200)
);
COMMENT ON TABLE tenant_data.command_inbox IS
  'Native tenant.command_inbox. Durable receipt of an accepted command; payload/digest are the immutable accepted bytes. Lifecycle is reference data, never a CHECK list.';
COMMENT ON COLUMN tenant_data.command_inbox.state IS
  'reference domain: command_state (ACCEPTED_PENDING, AWAITING_APPROVAL, POSTED, FAILED, plus future states).';
COMMENT ON COLUMN tenant_data.command_inbox.lease_until IS
  'Native epoch-millisecond lease boundary, preserved exactly.';

-- Native tenant.approval_requests.
CREATE TABLE tenant_data.approval_requests (
  tenant_id uuid NOT NULL,
  command_id text NOT NULL,
  payload_digest text NOT NULL,
  policy_snapshot text NOT NULL,
  state text NOT NULL,
  decided_by text,
  created_at bigint NOT NULL DEFAULT (extract(epoch FROM now()) * 1000)::bigint,
  updated_at bigint NOT NULL DEFAULT (extract(epoch FROM now()) * 1000)::bigint,
  created_by text,
  updated_by text,
  CONSTRAINT approval_requests_pkey PRIMARY KEY (tenant_id, command_id),
  CONSTRAINT approval_requests_command_fkey FOREIGN KEY (tenant_id, command_id)
    REFERENCES tenant_data.command_inbox (tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT approval_requests_state_not_blank CHECK (length(btrim(state)) BETWEEN 1 AND 80)
);
COMMENT ON TABLE tenant_data.approval_requests IS
  'Native tenant.approval_requests. policy_snapshot is the exact policy decision bound to payload_digest; any edit invalidates approval.';
COMMENT ON COLUMN tenant_data.approval_requests.state IS
  'reference domain: approval_state.';

-- Native tenant.journals. Posted rows are immutable (PIVOT-005).
CREATE TABLE tenant_data.journals (
  tenant_id uuid NOT NULL,
  id text NOT NULL,
  company text NOT NULL,
  branch text NOT NULL,
  posting_date text NOT NULL,
  narrative text NOT NULL,
  created_at bigint NOT NULL DEFAULT (extract(epoch FROM now()) * 1000)::bigint,
  updated_at bigint NOT NULL DEFAULT (extract(epoch FROM now()) * 1000)::bigint,
  CONSTRAINT journals_pkey PRIMARY KEY (tenant_id, id),
  CONSTRAINT journals_command_fkey FOREIGN KEY (tenant_id, id)
    REFERENCES tenant_data.command_inbox (tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT journals_company_not_blank CHECK (length(btrim(company)) BETWEEN 1 AND 120),
  CONSTRAINT journals_branch_not_blank CHECK (length(btrim(branch)) BETWEEN 1 AND 120),
  CONSTRAINT journals_posting_date_not_blank CHECK (length(btrim(posting_date)) BETWEEN 8 AND 32)
);
COMMENT ON TABLE tenant_data.journals IS
  'Native tenant.journals. Posted journal header; corrections are linked reversals, never edits.';

-- Native tenant.journal_lines. Exact minor-unit debit/credit; balanced posting
-- is enforced at commit by the kernel, not by a row CHECK.
CREATE TABLE tenant_data.journal_lines (
  tenant_id uuid NOT NULL,
  journal_id text NOT NULL,
  line_no integer NOT NULL,
  account text NOT NULL,
  debit bigint NOT NULL,
  credit bigint NOT NULL,
  created_at bigint NOT NULL DEFAULT (extract(epoch FROM now()) * 1000)::bigint,
  updated_at bigint NOT NULL DEFAULT (extract(epoch FROM now()) * 1000)::bigint,
  CONSTRAINT journal_lines_pkey PRIMARY KEY (tenant_id, journal_id, line_no),
  CONSTRAINT journal_lines_journal_fkey FOREIGN KEY (tenant_id, journal_id)
    REFERENCES tenant_data.journals (tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT journal_lines_account_fkey FOREIGN KEY (tenant_id, account)
    REFERENCES tenant_data.accounts (tenant_id, code) ON DELETE RESTRICT,
  CONSTRAINT journal_lines_line_no_positive CHECK (line_no > 0),
  CONSTRAINT journal_lines_debit_bounds CHECK (debit >= 0 AND debit <= 999999999999),
  CONSTRAINT journal_lines_credit_bounds CHECK (credit >= 0 AND credit <= 999999999999),
  CONSTRAINT journal_lines_one_side CHECK ((debit > 0 AND credit = 0) OR (credit > 0 AND debit = 0))
);
COMMENT ON COLUMN tenant_data.journal_lines.debit IS
  'Exact native minor units (bigint, 0..999999999999). Never float, never money type.';
COMMENT ON COLUMN tenant_data.journal_lines.credit IS
  'Exact native minor units (bigint, 0..999999999999). Never float, never money type.';

-- Native tenant.audit (command-linked business audit).
CREATE TABLE tenant_data.audit (
  tenant_id uuid NOT NULL,
  id bigint GENERATED BY DEFAULT AS IDENTITY,
  command_id text,
  actor text NOT NULL,
  event text NOT NULL,
  detail text NOT NULL,
  happened_at bigint NOT NULL,
  created_at bigint NOT NULL DEFAULT (extract(epoch FROM now()) * 1000)::bigint,
  updated_at bigint NOT NULL DEFAULT (extract(epoch FROM now()) * 1000)::bigint,
  CONSTRAINT audit_pkey PRIMARY KEY (tenant_id, id),
  CONSTRAINT audit_command_fkey FOREIGN KEY (tenant_id, command_id)
    REFERENCES tenant_data.command_inbox (tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT audit_actor_not_blank CHECK (length(btrim(actor)) BETWEEN 1 AND 200),
  CONSTRAINT audit_event_not_blank CHECK (length(btrim(event)) BETWEEN 1 AND 120)
);
COMMENT ON TABLE tenant_data.audit IS
  'Native tenant.audit. Append-only current-change audit; historical native ids are imported explicitly into id. Append-only enforcement is PIVOT-006.';

-- Native tenant.outbox.
CREATE TABLE tenant_data.outbox (
  tenant_id uuid NOT NULL,
  id text NOT NULL,
  event text NOT NULL,
  state text NOT NULL,
  attempts integer NOT NULL DEFAULT 0,
  created_at bigint NOT NULL DEFAULT (extract(epoch FROM now()) * 1000)::bigint,
  updated_at bigint NOT NULL DEFAULT (extract(epoch FROM now()) * 1000)::bigint,
  updated_by text,
  CONSTRAINT outbox_pkey PRIMARY KEY (tenant_id, id),
  CONSTRAINT outbox_command_fkey FOREIGN KEY (tenant_id, id)
    REFERENCES tenant_data.command_inbox (tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT outbox_attempts_non_negative CHECK (attempts >= 0),
  CONSTRAINT outbox_state_not_blank CHECK (length(btrim(state)) BETWEEN 1 AND 80)
);
COMMENT ON TABLE tenant_data.outbox IS
  'Native tenant.outbox. reference domain: outbox_state.';

-- Native tenant.document_sequences. Atomic allocation with SELECT ... FOR UPDATE
-- is the kernel rule; MAX(id)+1 is never used.
CREATE TABLE tenant_data.document_sequences (
  tenant_id uuid NOT NULL,
  company text NOT NULL,
  kind text NOT NULL,
  next_number integer NOT NULL,
  created_at bigint NOT NULL DEFAULT (extract(epoch FROM now()) * 1000)::bigint,
  updated_at bigint NOT NULL DEFAULT (extract(epoch FROM now()) * 1000)::bigint,
  updated_by text,
  CONSTRAINT document_sequences_pkey PRIMARY KEY (tenant_id, company, kind),
  CONSTRAINT document_sequences_next_positive CHECK (next_number > 0)
);
COMMENT ON TABLE tenant_data.document_sequences IS
  'Native tenant.document_sequences. Sequences only increase; monotonicity is enforced by the kernel and PIVOT-005 triggers.';

-- Native tenant.document_numbers. Historical numbers are never renumbered.
CREATE TABLE tenant_data.document_numbers (
  tenant_id uuid NOT NULL,
  id text NOT NULL,
  company text NOT NULL,
  kind text NOT NULL,
  sequence integer NOT NULL,
  number text NOT NULL,
  created_at bigint NOT NULL DEFAULT (extract(epoch FROM now()) * 1000)::bigint,
  updated_at bigint NOT NULL DEFAULT (extract(epoch FROM now()) * 1000)::bigint,
  CONSTRAINT document_numbers_pkey PRIMARY KEY (tenant_id, id),
  CONSTRAINT document_numbers_sequence_positive CHECK (sequence > 0),
  CONSTRAINT document_numbers_company_kind_sequence_key UNIQUE (tenant_id, company, kind, sequence),
  CONSTRAINT document_numbers_company_number_key UNIQUE (tenant_id, company, number)
);
COMMENT ON TABLE tenant_data.document_numbers IS
  'Native tenant.document_numbers. Immutable allocated numbers; reference domain: document_kind.';

-- Native tenant.journal_drafts. Editable work; a submitted row is final and an
-- edit creates a new revision.
CREATE TABLE tenant_data.journal_drafts (
  tenant_id uuid NOT NULL,
  id text NOT NULL,
  actor text NOT NULL,
  company text NOT NULL,
  branch text NOT NULL,
  payload text NOT NULL,
  revision integer NOT NULL,
  state text NOT NULL,
  source_id text,
  created_at bigint NOT NULL,
  updated_at bigint NOT NULL,
  updated_by text,
  CONSTRAINT journal_drafts_pkey PRIMARY KEY (tenant_id, id),
  CONSTRAINT journal_drafts_actor_fkey FOREIGN KEY (tenant_id, actor)
    REFERENCES tenant_data.members (tenant_id, user_id) ON DELETE RESTRICT,
  CONSTRAINT journal_drafts_revision_positive CHECK (revision > 0),
  CONSTRAINT journal_drafts_state_not_blank CHECK (length(btrim(state)) BETWEEN 1 AND 80)
);
COMMENT ON TABLE tenant_data.journal_drafts IS
  'Native tenant.journal_drafts. Editable pending work; reference domain: draft_state.';
COMMENT ON COLUMN tenant_data.journal_drafts.payload IS
  'Native canonical JSON text, preserved byte-for-byte; digest/schema binding lives with the document revision sidecar.';

-- Native tenant.command_decisions. Review history is immutable.
CREATE TABLE tenant_data.command_decisions (
  tenant_id uuid NOT NULL,
  command_id text NOT NULL,
  decision text NOT NULL,
  actor text NOT NULL,
  reason text NOT NULL,
  replacement_id text,
  happened_at bigint NOT NULL,
  created_at bigint NOT NULL DEFAULT (extract(epoch FROM now()) * 1000)::bigint,
  updated_at bigint NOT NULL DEFAULT (extract(epoch FROM now()) * 1000)::bigint,
  CONSTRAINT command_decisions_pkey PRIMARY KEY (tenant_id, command_id),
  CONSTRAINT command_decisions_command_fkey FOREIGN KEY (tenant_id, command_id)
    REFERENCES tenant_data.command_inbox (tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT command_decisions_actor_fkey FOREIGN KEY (tenant_id, actor)
    REFERENCES tenant_data.members (tenant_id, user_id) ON DELETE RESTRICT,
  CONSTRAINT command_decisions_replacement_fkey FOREIGN KEY (tenant_id, replacement_id)
    REFERENCES tenant_data.journal_drafts (tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT command_decisions_decision_not_blank CHECK (length(btrim(decision)) BETWEEN 1 AND 80)
);
COMMENT ON TABLE tenant_data.command_decisions IS
  'Native tenant.command_decisions. Rejection/return history; reference domain: decision_type.';

-- =====================================================================
-- Purpose B — company, inventory and evidence
-- =====================================================================

-- Native tenant.company_profiles.
CREATE TABLE tenant_data.company_profiles (
  tenant_id uuid NOT NULL,
  id text NOT NULL,
  name text NOT NULL,
  currency text NOT NULL,
  branch text NOT NULL,
  created_at bigint NOT NULL,
  updated_at bigint NOT NULL DEFAULT (extract(epoch FROM now()) * 1000)::bigint,
  created_by text,
  updated_by text,
  CONSTRAINT company_profiles_pkey PRIMARY KEY (tenant_id, id),
  CONSTRAINT company_profiles_id_not_blank CHECK (length(btrim(id)) BETWEEN 1 AND 120),
  CONSTRAINT company_profiles_currency_not_blank CHECK (length(btrim(currency)) BETWEEN 1 AND 8)
);
COMMENT ON TABLE tenant_data.company_profiles IS
  'Native tenant.company_profiles. Company is the tenant-local legal/reporting entity; currency is ISO data, not an enum.';

-- Native tenant.warehouses.
CREATE TABLE tenant_data.warehouses (
  tenant_id uuid NOT NULL,
  company text NOT NULL,
  id text NOT NULL,
  branch text NOT NULL,
  name text NOT NULL,
  active boolean NOT NULL,
  created_at bigint NOT NULL DEFAULT (extract(epoch FROM now()) * 1000)::bigint,
  updated_at bigint NOT NULL DEFAULT (extract(epoch FROM now()) * 1000)::bigint,
  created_by text,
  updated_by text,
  CONSTRAINT warehouses_pkey PRIMARY KEY (tenant_id, company, id),
  CONSTRAINT warehouses_company_fkey FOREIGN KEY (tenant_id, company)
    REFERENCES tenant_data.company_profiles (tenant_id, id) ON DELETE RESTRICT
);
COMMENT ON TABLE tenant_data.warehouses IS
  'Native tenant.warehouses. Composite (tenant_id, company, id) identity; no globally unique warehouse id is assumed.';

-- Native tenant.stock_items.
CREATE TABLE tenant_data.stock_items (
  tenant_id uuid NOT NULL,
  company text NOT NULL,
  id text NOT NULL,
  name text NOT NULL,
  uom text NOT NULL,
  inventory_account text NOT NULL,
  expense_account text NOT NULL,
  receipt_account text NOT NULL,
  active boolean NOT NULL,
  created_at bigint NOT NULL DEFAULT (extract(epoch FROM now()) * 1000)::bigint,
  updated_at bigint NOT NULL DEFAULT (extract(epoch FROM now()) * 1000)::bigint,
  created_by text,
  updated_by text,
  CONSTRAINT stock_items_pkey PRIMARY KEY (tenant_id, company, id),
  CONSTRAINT stock_items_company_fkey FOREIGN KEY (tenant_id, company)
    REFERENCES tenant_data.company_profiles (tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT stock_items_inventory_account_fkey FOREIGN KEY (tenant_id, inventory_account)
    REFERENCES tenant_data.accounts (tenant_id, code) ON DELETE RESTRICT,
  CONSTRAINT stock_items_expense_account_fkey FOREIGN KEY (tenant_id, expense_account)
    REFERENCES tenant_data.accounts (tenant_id, code) ON DELETE RESTRICT,
  CONSTRAINT stock_items_receipt_account_fkey FOREIGN KEY (tenant_id, receipt_account)
    REFERENCES tenant_data.accounts (tenant_id, code) ON DELETE RESTRICT
);
COMMENT ON TABLE tenant_data.stock_items IS
  'Native tenant.stock_items. Item master with tenant-scoped account links.';

-- Native tenant.stock_balances. Weighted-average value is exact minor units.
CREATE TABLE tenant_data.stock_balances (
  tenant_id uuid NOT NULL,
  company text NOT NULL,
  warehouse text NOT NULL,
  item text NOT NULL,
  quantity bigint NOT NULL,
  value bigint NOT NULL,
  version bigint NOT NULL,
  created_at bigint NOT NULL DEFAULT (extract(epoch FROM now()) * 1000)::bigint,
  updated_at bigint NOT NULL DEFAULT (extract(epoch FROM now()) * 1000)::bigint,
  updated_by text,
  CONSTRAINT stock_balances_pkey PRIMARY KEY (tenant_id, company, warehouse, item),
  CONSTRAINT stock_balances_warehouse_fkey FOREIGN KEY (tenant_id, company, warehouse)
    REFERENCES tenant_data.warehouses (tenant_id, company, id) ON DELETE RESTRICT,
  CONSTRAINT stock_balances_item_fkey FOREIGN KEY (tenant_id, company, item)
    REFERENCES tenant_data.stock_items (tenant_id, company, id) ON DELETE RESTRICT,
  CONSTRAINT stock_balances_quantity_bounds CHECK (quantity >= 0 AND quantity <= 999999999999),
  CONSTRAINT stock_balances_value_bounds CHECK (value >= 0 AND value <= 999999999999),
  CONSTRAINT stock_balances_version_positive CHECK (version > 0)
);
COMMENT ON TABLE tenant_data.stock_balances IS
  'Native tenant.stock_balances. version is the optimistic concurrency fence for stock writes.';
COMMENT ON COLUMN tenant_data.stock_balances.value IS
  'Exact native minor units (bigint). Never float or money type.';

-- Native tenant.stock_operations.
CREATE TABLE tenant_data.stock_operations (
  tenant_id uuid NOT NULL,
  command_id text NOT NULL,
  kind text NOT NULL,
  payload text NOT NULL,
  expected text NOT NULL,
  created_at bigint NOT NULL DEFAULT (extract(epoch FROM now()) * 1000)::bigint,
  updated_at bigint NOT NULL DEFAULT (extract(epoch FROM now()) * 1000)::bigint,
  CONSTRAINT stock_operations_pkey PRIMARY KEY (tenant_id, command_id),
  CONSTRAINT stock_operations_command_fkey FOREIGN KEY (tenant_id, command_id)
    REFERENCES tenant_data.command_inbox (tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT stock_operations_kind_not_blank CHECK (length(btrim(kind)) BETWEEN 1 AND 40)
);
COMMENT ON TABLE tenant_data.stock_operations IS
  'Native tenant.stock_operations. reference domain: stock_operation_kind.';

-- Native tenant.stock_movements.
CREATE TABLE tenant_data.stock_movements (
  tenant_id uuid NOT NULL,
  command_id text NOT NULL,
  company text NOT NULL,
  warehouse text NOT NULL,
  item text NOT NULL,
  quantity_delta bigint NOT NULL,
  value_delta bigint NOT NULL,
  created_at bigint NOT NULL DEFAULT (extract(epoch FROM now()) * 1000)::bigint,
  updated_at bigint NOT NULL DEFAULT (extract(epoch FROM now()) * 1000)::bigint,
  CONSTRAINT stock_movements_pkey PRIMARY KEY (tenant_id, command_id, warehouse),
  CONSTRAINT stock_movements_operation_fkey FOREIGN KEY (tenant_id, command_id)
    REFERENCES tenant_data.stock_operations (tenant_id, command_id) ON DELETE RESTRICT,
  CONSTRAINT stock_movements_warehouse_fkey FOREIGN KEY (tenant_id, company, warehouse)
    REFERENCES tenant_data.warehouses (tenant_id, company, id) ON DELETE RESTRICT,
  CONSTRAINT stock_movements_item_fkey FOREIGN KEY (tenant_id, company, item)
    REFERENCES tenant_data.stock_items (tenant_id, company, id) ON DELETE RESTRICT
);
COMMENT ON TABLE tenant_data.stock_movements IS
  'Native tenant.stock_movements. Signed quantity/value deltas in exact minor units.';

-- Native tenant.company_settings.
CREATE TABLE tenant_data.company_settings (
  tenant_id uuid NOT NULL,
  company text NOT NULL,
  print_footer text NOT NULL DEFAULT '',
  address text NOT NULL DEFAULT '',
  tax_number text NOT NULL DEFAULT '',
  created_at bigint NOT NULL DEFAULT (extract(epoch FROM now()) * 1000)::bigint,
  updated_at bigint NOT NULL DEFAULT (extract(epoch FROM now()) * 1000)::bigint,
  created_by text,
  updated_by text,
  CONSTRAINT company_settings_pkey PRIMARY KEY (tenant_id, company),
  CONSTRAINT company_settings_company_fkey FOREIGN KEY (tenant_id, company)
    REFERENCES tenant_data.company_profiles (tenant_id, id) ON DELETE RESTRICT
);
COMMENT ON TABLE tenant_data.company_settings IS
  'Native tenant.company_settings. Printing and statutory header data per company.';

-- Native tenant.command_files. Supporting evidence metadata; bytes live in the
-- private file store, never in this schema.
CREATE TABLE tenant_data.command_files (
  tenant_id uuid NOT NULL,
  id text NOT NULL,
  command_id text NOT NULL,
  name text NOT NULL,
  media_type text NOT NULL,
  sha256 text NOT NULL,
  byte_size bigint NOT NULL,
  scan text NOT NULL,
  created_at bigint NOT NULL,
  updated_at bigint NOT NULL DEFAULT (extract(epoch FROM now()) * 1000)::bigint,
  CONSTRAINT command_files_pkey PRIMARY KEY (tenant_id, id),
  CONSTRAINT command_files_command_fkey FOREIGN KEY (tenant_id, command_id)
    REFERENCES tenant_data.command_inbox (tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT command_files_command_name_sha_key UNIQUE (tenant_id, command_id, name, sha256),
  CONSTRAINT command_files_byte_size_non_negative CHECK (byte_size >= 0),
  CONSTRAINT command_files_sha256_not_blank CHECK (length(btrim(sha256)) BETWEEN 32 AND 128)
);
COMMENT ON TABLE tenant_data.command_files IS
  'Native tenant.command_files. Evidence metadata only (name, type, digest, size, scan verdict). No file bytes, no credentials.';
COMMENT ON COLUMN tenant_data.command_files.scan IS
  'reference domain: scan_state. Only a clean verdict satisfies posting evidence requirements.';

-- Native tenant.inventory_controls.
CREATE TABLE tenant_data.inventory_controls (
  tenant_id uuid NOT NULL,
  account text NOT NULL,
  created_at bigint NOT NULL DEFAULT (extract(epoch FROM now()) * 1000)::bigint,
  updated_at bigint NOT NULL DEFAULT (extract(epoch FROM now()) * 1000)::bigint,
  created_by text,
  updated_by text,
  CONSTRAINT inventory_controls_pkey PRIMARY KEY (tenant_id, account),
  CONSTRAINT inventory_controls_account_fkey FOREIGN KEY (tenant_id, account)
    REFERENCES tenant_data.accounts (tenant_id, code) ON DELETE RESTRICT
);
COMMENT ON TABLE tenant_data.inventory_controls IS
  'Native tenant.inventory_controls. Marks tenant accounts reserved as inventory control accounts.';

-- Native tenant.journal_corrections. Linked reversal, never an edit.
CREATE TABLE tenant_data.journal_corrections (
  tenant_id uuid NOT NULL,
  command_id text NOT NULL,
  original_id text NOT NULL,
  reason text NOT NULL,
  created_at bigint NOT NULL DEFAULT (extract(epoch FROM now()) * 1000)::bigint,
  updated_at bigint NOT NULL DEFAULT (extract(epoch FROM now()) * 1000)::bigint,
  CONSTRAINT journal_corrections_pkey PRIMARY KEY (tenant_id, command_id),
  CONSTRAINT journal_corrections_command_fkey FOREIGN KEY (tenant_id, command_id)
    REFERENCES tenant_data.command_inbox (tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT journal_corrections_original_fkey FOREIGN KEY (tenant_id, original_id)
    REFERENCES tenant_data.journals (tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT journal_corrections_original_key UNIQUE (tenant_id, original_id),
  CONSTRAINT journal_corrections_reason_not_blank CHECK (length(btrim(reason)) BETWEEN 1 AND 1000)
);
COMMENT ON TABLE tenant_data.journal_corrections IS
  'Native tenant.journal_corrections. One linked correction per posted journal.';

-- =====================================================================
-- Purpose B — trade subledger (sales/purchase documents and credits)
-- =====================================================================

-- Native tenant.trade_controls.
CREATE TABLE tenant_data.trade_controls (
  tenant_id uuid NOT NULL,
  company text NOT NULL,
  branch text NOT NULL,
  account text NOT NULL,
  created_at bigint NOT NULL DEFAULT (extract(epoch FROM now()) * 1000)::bigint,
  updated_at bigint NOT NULL DEFAULT (extract(epoch FROM now()) * 1000)::bigint,
  created_by text,
  updated_by text,
  CONSTRAINT trade_controls_pkey PRIMARY KEY (tenant_id, company, branch, account),
  CONSTRAINT trade_controls_account_fkey FOREIGN KEY (tenant_id, account)
    REFERENCES tenant_data.accounts (tenant_id, code) ON DELETE RESTRICT
);
COMMENT ON TABLE tenant_data.trade_controls IS
  'Native tenant.trade_controls. Reserved trade control accounts per company/branch.';

-- Native tenant.trade_parties.
CREATE TABLE tenant_data.trade_parties (
  tenant_id uuid NOT NULL,
  company text NOT NULL,
  branch text NOT NULL,
  id text NOT NULL,
  kind text NOT NULL,
  name text NOT NULL,
  created_at bigint NOT NULL DEFAULT (extract(epoch FROM now()) * 1000)::bigint,
  updated_at bigint NOT NULL DEFAULT (extract(epoch FROM now()) * 1000)::bigint,
  created_by text,
  updated_by text,
  CONSTRAINT trade_parties_pkey PRIMARY KEY (tenant_id, company, branch, id),
  CONSTRAINT trade_parties_kind_not_blank CHECK (length(btrim(kind)) BETWEEN 1 AND 40)
);
COMMENT ON TABLE tenant_data.trade_parties IS
  'Native tenant.trade_parties. Customer/supplier master; reference domain: party_kind, not a CHECK list.';

-- Native tenant.trade_operations.
CREATE TABLE tenant_data.trade_operations (
  tenant_id uuid NOT NULL,
  command_id text NOT NULL,
  input_digest text NOT NULL,
  payload text NOT NULL,
  created_at bigint NOT NULL DEFAULT (extract(epoch FROM now()) * 1000)::bigint,
  updated_at bigint NOT NULL DEFAULT (extract(epoch FROM now()) * 1000)::bigint,
  CONSTRAINT trade_operations_pkey PRIMARY KEY (tenant_id, command_id),
  CONSTRAINT trade_operations_command_fkey FOREIGN KEY (tenant_id, command_id)
    REFERENCES tenant_data.command_inbox (tenant_id, id) ON DELETE RESTRICT
);
COMMENT ON TABLE tenant_data.trade_operations IS
  'Native tenant.trade_operations. Accepted trade payload bound to its digest.';

-- Native tenant.trade_documents. total is exact minor units.
CREATE TABLE tenant_data.trade_documents (
  tenant_id uuid NOT NULL,
  command_id text NOT NULL,
  company text NOT NULL,
  branch text NOT NULL,
  party_id text NOT NULL,
  kind text NOT NULL,
  reference text NOT NULL,
  posting_date text NOT NULL,
  due_date text NOT NULL,
  total bigint NOT NULL,
  created_at bigint NOT NULL DEFAULT (extract(epoch FROM now()) * 1000)::bigint,
  updated_at bigint NOT NULL DEFAULT (extract(epoch FROM now()) * 1000)::bigint,
  CONSTRAINT trade_documents_pkey PRIMARY KEY (tenant_id, command_id),
  CONSTRAINT trade_documents_operation_fkey FOREIGN KEY (tenant_id, command_id)
    REFERENCES tenant_data.trade_operations (tenant_id, command_id) ON DELETE RESTRICT,
  CONSTRAINT trade_documents_party_fkey FOREIGN KEY (tenant_id, company, branch, party_id)
    REFERENCES tenant_data.trade_parties (tenant_id, company, branch, id) ON DELETE RESTRICT,
  CONSTRAINT trade_documents_party_reference_key UNIQUE (tenant_id, company, branch, party_id, kind, reference),
  CONSTRAINT trade_documents_total_positive CHECK (total > 0 AND total <= 999999999999),
  CONSTRAINT trade_documents_kind_not_blank CHECK (length(btrim(kind)) BETWEEN 1 AND 40)
);
COMMENT ON TABLE tenant_data.trade_documents IS
  'Native tenant.trade_documents. Invoice/bill header; reference domain: trade_document_kind.';
COMMENT ON COLUMN tenant_data.trade_documents.total IS
  'Exact native minor units (bigint). Never float or money type.';

-- Native tenant.trade_lines.
CREATE TABLE tenant_data.trade_lines (
  tenant_id uuid NOT NULL,
  command_id text NOT NULL,
  line_no integer NOT NULL,
  description text NOT NULL,
  account text NOT NULL,
  amount bigint NOT NULL,
  created_at bigint NOT NULL DEFAULT (extract(epoch FROM now()) * 1000)::bigint,
  updated_at bigint NOT NULL DEFAULT (extract(epoch FROM now()) * 1000)::bigint,
  CONSTRAINT trade_lines_pkey PRIMARY KEY (tenant_id, command_id, line_no),
  CONSTRAINT trade_lines_document_fkey FOREIGN KEY (tenant_id, command_id)
    REFERENCES tenant_data.trade_documents (tenant_id, command_id) ON DELETE RESTRICT,
  CONSTRAINT trade_lines_account_fkey FOREIGN KEY (tenant_id, account)
    REFERENCES tenant_data.accounts (tenant_id, code) ON DELETE RESTRICT,
  CONSTRAINT trade_lines_line_no_positive CHECK (line_no > 0),
  CONSTRAINT trade_lines_amount_positive CHECK (amount > 0 AND amount <= 999999999999)
);
COMMENT ON TABLE tenant_data.trade_lines IS
  'Native tenant.trade_lines. Exact minor-unit line amounts; totals reconcile at posting.';

-- Native tenant.trade_allocations.
CREATE TABLE tenant_data.trade_allocations (
  tenant_id uuid NOT NULL,
  command_id text NOT NULL,
  document_id text NOT NULL,
  amount bigint NOT NULL,
  created_at bigint NOT NULL DEFAULT (extract(epoch FROM now()) * 1000)::bigint,
  updated_at bigint NOT NULL DEFAULT (extract(epoch FROM now()) * 1000)::bigint,
  CONSTRAINT trade_allocations_pkey PRIMARY KEY (tenant_id, command_id, document_id),
  CONSTRAINT trade_allocations_operation_fkey FOREIGN KEY (tenant_id, command_id)
    REFERENCES tenant_data.trade_operations (tenant_id, command_id) ON DELETE RESTRICT,
  CONSTRAINT trade_allocations_document_fkey FOREIGN KEY (tenant_id, document_id)
    REFERENCES tenant_data.trade_documents (tenant_id, command_id) ON DELETE RESTRICT,
  CONSTRAINT trade_allocations_amount_positive CHECK (amount > 0 AND amount <= 999999999999)
);
COMMENT ON TABLE tenant_data.trade_allocations IS
  'Native tenant.trade_allocations. Settlement allocations; allocated amount may never exceed the document total.';

-- Native tenant.trade_credits.
CREATE TABLE tenant_data.trade_credits (
  tenant_id uuid NOT NULL,
  command_id text NOT NULL,
  original_id text NOT NULL,
  total bigint NOT NULL,
  reason text NOT NULL,
  created_at bigint NOT NULL DEFAULT (extract(epoch FROM now()) * 1000)::bigint,
  updated_at bigint NOT NULL DEFAULT (extract(epoch FROM now()) * 1000)::bigint,
  CONSTRAINT trade_credits_pkey PRIMARY KEY (tenant_id, command_id),
  CONSTRAINT trade_credits_operation_fkey FOREIGN KEY (tenant_id, command_id)
    REFERENCES tenant_data.trade_operations (tenant_id, command_id) ON DELETE RESTRICT,
  CONSTRAINT trade_credits_original_fkey FOREIGN KEY (tenant_id, original_id)
    REFERENCES tenant_data.trade_documents (tenant_id, command_id) ON DELETE RESTRICT,
  CONSTRAINT trade_credits_total_positive CHECK (total > 0 AND total <= 999999999999),
  CONSTRAINT trade_credits_reason_not_blank CHECK (length(btrim(reason)) BETWEEN 1 AND 1000)
);
COMMENT ON TABLE tenant_data.trade_credits IS
  'Native tenant.trade_credits. Credit/refund against an original posted document; never a silent edit.';

-- Native tenant.trade_credit_lines.
CREATE TABLE tenant_data.trade_credit_lines (
  tenant_id uuid NOT NULL,
  command_id text NOT NULL,
  original_line integer NOT NULL,
  amount bigint NOT NULL,
  created_at bigint NOT NULL DEFAULT (extract(epoch FROM now()) * 1000)::bigint,
  updated_at bigint NOT NULL DEFAULT (extract(epoch FROM now()) * 1000)::bigint,
  CONSTRAINT trade_credit_lines_pkey PRIMARY KEY (tenant_id, command_id, original_line),
  CONSTRAINT trade_credit_lines_credit_fkey FOREIGN KEY (tenant_id, command_id)
    REFERENCES tenant_data.trade_credits (tenant_id, command_id) ON DELETE RESTRICT,
  CONSTRAINT trade_credit_lines_line_positive CHECK (original_line > 0),
  CONSTRAINT trade_credit_lines_amount_positive CHECK (amount > 0 AND amount <= 999999999999)
);
COMMENT ON TABLE tenant_data.trade_credit_lines IS
  'Native tenant.trade_credit_lines. Per-line credit amounts; a line may never exceed its original.';

-- =====================================================================
-- Purpose B/C — provenance, reference data and configurable policy
-- =====================================================================

-- Native schema_migrations of the tenant store, imported unchanged.
CREATE TABLE tenant_data.source_store_migrations (
  tenant_id uuid NOT NULL,
  source_store text NOT NULL,
  version integer NOT NULL,
  checksum text NOT NULL,
  source_applied_at bigint NOT NULL,
  imported_at bigint NOT NULL DEFAULT (extract(epoch FROM now()) * 1000)::bigint,
  created_at bigint NOT NULL DEFAULT (extract(epoch FROM now()) * 1000)::bigint,
  updated_at bigint NOT NULL DEFAULT (extract(epoch FROM now()) * 1000)::bigint,
  CONSTRAINT source_store_migrations_pkey PRIMARY KEY (tenant_id, source_store, version),
  CONSTRAINT source_store_migrations_version_positive CHECK (version > 0),
  CONSTRAINT source_store_migrations_checksum_not_blank CHECK (length(btrim(checksum)) BETWEEN 1 AND 200)
);
COMMENT ON TABLE tenant_data.source_store_migrations IS
  'Imported native tenant-store migration versions and checksums. Native checksums are provenance, never asserted to equal PostgreSQL SQL checksums.';

-- Purpose C — named, effective-dated, versioned reference domains per tenant.
CREATE TABLE tenant_data.reference_values (
  tenant_id uuid NOT NULL,
  domain text NOT NULL,
  value text NOT NULL,
  label text NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  effective_from timestamptz NOT NULL DEFAULT now(),
  effective_to timestamptz,
  value_jsonb jsonb NOT NULL DEFAULT '{}'::jsonb,
  value_schema_version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by text,
  updated_by text,
  CONSTRAINT reference_values_pkey PRIMARY KEY (tenant_id, domain, value),
  CONSTRAINT reference_values_domain_not_blank CHECK (length(btrim(domain)) BETWEEN 1 AND 80),
  CONSTRAINT reference_values_value_not_blank CHECK (length(btrim(value)) BETWEEN 1 AND 120),
  CONSTRAINT reference_values_label_not_blank CHECK (length(btrim(label)) BETWEEN 1 AND 200),
  CONSTRAINT reference_values_schema_version_positive CHECK (value_schema_version > 0),
  CONSTRAINT reference_values_effective_order CHECK (effective_to IS NULL OR effective_to > effective_from)
);
COMMENT ON TABLE tenant_data.reference_values IS
  'Purpose C growing domains for one tenant. A new value is an inserted row, never a migration; the canonical seed list is contracts/postgres-business-rules-v1.json. Application validation is authoritative in this skeleton.';
COMMENT ON COLUMN tenant_data.reference_values.value_jsonb IS
  'Versioned JSON object bound to value_schema_version; JSON-schema validation is deferred to the application.';

-- Purpose C — configurable business rules, superseded by version, never mutated.
CREATE TABLE tenant_data.business_rule (
  tenant_id uuid NOT NULL,
  rule_key text NOT NULL,
  version bigint NOT NULL,
  scope_type text NOT NULL DEFAULT 'tenant',
  scope_id text,
  config_jsonb jsonb NOT NULL DEFAULT '{}'::jsonb,
  config_schema_version integer NOT NULL DEFAULT 1,
  is_active boolean NOT NULL DEFAULT true,
  effective_from timestamptz NOT NULL DEFAULT now(),
  effective_to timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by text,
  updated_by text,
  CONSTRAINT business_rule_pkey PRIMARY KEY (tenant_id, rule_key, version),
  CONSTRAINT business_rule_version_positive CHECK (version > 0),
  CONSTRAINT business_rule_rule_key_not_blank CHECK (length(btrim(rule_key)) BETWEEN 1 AND 120),
  CONSTRAINT business_rule_scope_type_not_blank CHECK (length(btrim(scope_type)) BETWEEN 1 AND 40),
  CONSTRAINT business_rule_schema_version_positive CHECK (config_schema_version > 0),
  CONSTRAINT business_rule_effective_order CHECK (effective_to IS NULL OR effective_to > effective_from)
);
COMMENT ON TABLE tenant_data.business_rule IS
  'Purpose C tenant-configurable rule data. Used rules are superseded with a new version row. Stored rules are data; they never install executable logic.';
COMMENT ON COLUMN tenant_data.business_rule.config_jsonb IS
  'Versioned JSON object bound to config_schema_version, validated against contracts/postgres-business-rules-v1.json.';

-- Purpose C — approval policy with Phase 1 AI constraints.
CREATE TABLE tenant_data.approval_policy (
  tenant_id uuid NOT NULL,
  policy_key text NOT NULL,
  version bigint NOT NULL,
  action_type text NOT NULL,
  role_id text,
  max_self_approval_amount numeric(20, 4) NOT NULL DEFAULT 0,
  approval_threshold_amount numeric(20, 4) NOT NULL DEFAULT 0,
  currency text NOT NULL,
  requires_different_approver boolean NOT NULL DEFAULT false,
  ai_origin_direct_post_allowed boolean NOT NULL DEFAULT false,
  editable_in_pending boolean NOT NULL DEFAULT true,
  is_active boolean NOT NULL DEFAULT true,
  effective_from timestamptz NOT NULL DEFAULT now(),
  effective_to timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by text,
  updated_by text,
  CONSTRAINT approval_policy_pkey PRIMARY KEY (tenant_id, policy_key, version),
  CONSTRAINT approval_policy_version_positive CHECK (version > 0),
  CONSTRAINT approval_policy_key_not_blank CHECK (length(btrim(policy_key)) BETWEEN 1 AND 120),
  CONSTRAINT approval_policy_action_type_not_blank CHECK (length(btrim(action_type)) BETWEEN 1 AND 120),
  CONSTRAINT approval_policy_currency_not_blank CHECK (length(btrim(currency)) BETWEEN 1 AND 8),
  CONSTRAINT approval_policy_self_amount_non_negative CHECK (max_self_approval_amount >= 0),
  CONSTRAINT approval_policy_threshold_non_negative CHECK (approval_threshold_amount >= 0),
  CONSTRAINT approval_policy_effective_order CHECK (effective_to IS NULL OR effective_to > effective_from)
);
COMMENT ON TABLE tenant_data.approval_policy IS
  'Purpose C approval limits and independence. reference domain: action_type. Thresholds are exact numeric decimals, never floats.';
COMMENT ON COLUMN tenant_data.approval_policy.ai_origin_direct_post_allowed IS
  'Defaults false and must remain false in Phase 1. AI-origin documents always enter pending_approval; this column can never authorize a direct post by itself.';
COMMENT ON COLUMN tenant_data.approval_policy.editable_in_pending IS
  'Defaults true. Edits are audited and invalidate any prior approval at the same digest.';

-- Purpose C — registered deterministic posting constraints.
CREATE TABLE tenant_data.posting_constraint (
  tenant_id uuid NOT NULL,
  constraint_key text NOT NULL,
  version bigint NOT NULL,
  applies_to_document_type text NOT NULL,
  handler_key text NOT NULL,
  rule_jsonb jsonb NOT NULL DEFAULT '{}'::jsonb,
  rule_schema_version integer NOT NULL DEFAULT 1,
  is_active boolean NOT NULL DEFAULT true,
  effective_from timestamptz NOT NULL DEFAULT now(),
  effective_to timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by text,
  updated_by text,
  CONSTRAINT posting_constraint_pkey PRIMARY KEY (tenant_id, constraint_key, version),
  CONSTRAINT posting_constraint_version_positive CHECK (version > 0),
  CONSTRAINT posting_constraint_key_not_blank CHECK (length(btrim(constraint_key)) BETWEEN 1 AND 120),
  CONSTRAINT posting_constraint_handler_key_not_blank CHECK (length(btrim(handler_key)) BETWEEN 1 AND 120),
  CONSTRAINT posting_constraint_schema_version_positive CHECK (rule_schema_version > 0),
  CONSTRAINT posting_constraint_effective_order CHECK (effective_to IS NULL OR effective_to > effective_from)
);
COMMENT ON TABLE tenant_data.posting_constraint IS
  'Purpose C posting validators. handler_key must resolve to a registered deterministic validator; rule_jsonb is inert data and never arbitrary executable SQL/JSON logic.';

-- Purpose C — tax/localization profiles.
CREATE TABLE tenant_data.tax_profile (
  tenant_id uuid NOT NULL,
  tax_code text NOT NULL,
  version bigint NOT NULL,
  jurisdiction text NOT NULL,
  tax_type text NOT NULL DEFAULT 'sales_tax',
  rate numeric(9, 6) NOT NULL,
  currency text NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  effective_from timestamptz NOT NULL DEFAULT now(),
  effective_to timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by text,
  updated_by text,
  CONSTRAINT tax_profile_pkey PRIMARY KEY (tenant_id, tax_code, version),
  CONSTRAINT tax_profile_version_positive CHECK (version > 0),
  CONSTRAINT tax_profile_tax_code_not_blank CHECK (length(btrim(tax_code)) BETWEEN 1 AND 120),
  CONSTRAINT tax_profile_jurisdiction_not_blank CHECK (length(btrim(jurisdiction)) BETWEEN 1 AND 120),
  CONSTRAINT tax_profile_rate_bounds CHECK (rate >= 0 AND rate <= 1),
  CONSTRAINT tax_profile_currency_not_blank CHECK (length(btrim(currency)) BETWEEN 1 AND 8),
  CONSTRAINT tax_profile_effective_order CHECK (effective_to IS NULL OR effective_to > effective_from)
);
COMMENT ON TABLE tenant_data.tax_profile IS
  'Purpose C reviewed tax jurisdictions and rates (for example FBR). rate is an exact decimal fraction; effective history is superseded, never mutated.';
COMMENT ON COLUMN tenant_data.tax_profile.tax_type IS
  'reference domain: tax_type.';

-- Purpose C — customer-authorized, scoped, expiring support grants.
CREATE TABLE tenant_data.support_grants (
  tenant_id uuid NOT NULL,
  grant_id text NOT NULL,
  grantee_actor_id text NOT NULL,
  granted_by_user_id text NOT NULL,
  scope_jsonb jsonb NOT NULL DEFAULT '{}'::jsonb,
  actions_jsonb jsonb NOT NULL DEFAULT '[]'::jsonb,
  reason text NOT NULL DEFAULT '',
  starts_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by text,
  updated_by text,
  CONSTRAINT support_grants_pkey PRIMARY KEY (tenant_id, grant_id),
  CONSTRAINT support_grants_grant_id_not_blank CHECK (length(btrim(grant_id)) BETWEEN 1 AND 120),
  CONSTRAINT support_grants_grantee_not_blank CHECK (length(btrim(grantee_actor_id)) BETWEEN 1 AND 200),
  CONSTRAINT support_grants_window_order CHECK (expires_at > starts_at)
);
COMMENT ON TABLE tenant_data.support_grants IS
  'Purpose C customer-authored support consent: named scope, actions and expiry. A grant is never an implicit vendor-wide administrative right or a standing cross-tenant authority.';

-- Purpose B — append-only current-change audit (enforcement: PIVOT-006).
CREATE TABLE tenant_data.audit_event (
  tenant_id uuid NOT NULL,
  id bigint GENERATED BY DEFAULT AS IDENTITY,
  actor_id text NOT NULL,
  event text NOT NULL,
  entity_type text NOT NULL,
  entity_id text,
  detail_jsonb jsonb NOT NULL DEFAULT '{}'::jsonb,
  origin_type text NOT NULL DEFAULT 'human',
  origin_user_id text,
  origin_model text,
  origin_model_version text,
  request_id text,
  happened_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT audit_event_pkey PRIMARY KEY (tenant_id, id),
  CONSTRAINT audit_event_actor_not_blank CHECK (length(btrim(actor_id)) BETWEEN 1 AND 200),
  CONSTRAINT audit_event_event_not_blank CHECK (length(btrim(event)) BETWEEN 1 AND 120),
  CONSTRAINT audit_event_entity_type_not_blank CHECK (length(btrim(entity_type)) BETWEEN 1 AND 80)
);
COMMENT ON TABLE tenant_data.audit_event IS
  'Purpose B append-only audit of current changes. The native tenant.audit table remains intact; this sidecar never rewrites imported history.';
COMMENT ON COLUMN tenant_data.audit_event.origin_type IS
  'reference domain: origin_type. AI-origin rows carry origin_user_id/origin_model/origin_model_version.';

-- Purpose B — ordinary document registry: one identity per document.
CREATE TABLE tenant_data.document_registry (
  tenant_id uuid NOT NULL,
  document_id text NOT NULL,
  document_type text NOT NULL,
  document_status text NOT NULL,
  current_revision integer NOT NULL DEFAULT 1,
  company text,
  branch text,
  source_command_id text,
  origin_type text NOT NULL DEFAULT 'human',
  origin_user_id text,
  origin_model text,
  origin_model_version text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by text,
  updated_by text,
  CONSTRAINT document_registry_pkey PRIMARY KEY (tenant_id, document_id),
  CONSTRAINT document_registry_current_command_fkey FOREIGN KEY (tenant_id, source_command_id)
    REFERENCES tenant_data.command_inbox (tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT document_registry_document_id_not_blank CHECK (length(btrim(document_id)) BETWEEN 1 AND 200),
  CONSTRAINT document_registry_type_not_blank CHECK (length(btrim(document_type)) BETWEEN 1 AND 80),
  CONSTRAINT document_registry_status_not_blank CHECK (length(btrim(document_status)) BETWEEN 1 AND 80),
  CONSTRAINT document_registry_revision_positive CHECK (current_revision > 0)
);
COMMENT ON TABLE tenant_data.document_registry IS
  'Ordinary document identity/type/status/revision projection for human and AI-origin documents. There is no ai_proposal table: AI-origin documents are real documents in pending_approval.';
COMMENT ON COLUMN tenant_data.document_registry.document_type IS
  'reference domain: document_type (journal, invoice, bill, payment, ...). New types are rows plus registered handlers, never a migration.';
COMMENT ON COLUMN tenant_data.document_registry.document_status IS
  'reference domain: document_status. Includes pending_approval; only a posted document reaches the general ledger.';
COMMENT ON COLUMN tenant_data.document_registry.origin_type IS
  'reference domain: origin_type (human, ai, integration, system).';

-- Purpose B — immutable submission revisions (canonical pending-document sidecar).
CREATE TABLE tenant_data.document_revisions (
  tenant_id uuid NOT NULL,
  document_id text NOT NULL,
  revision integer NOT NULL,
  document_type text NOT NULL,
  document_status text NOT NULL,
  payload text NOT NULL,
  payload_digest text NOT NULL,
  policy_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  policy_version bigint,
  origin_type text NOT NULL DEFAULT 'human',
  origin_user_id text,
  origin_model text,
  origin_model_version text,
  submitted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by text,
  CONSTRAINT document_revisions_pkey PRIMARY KEY (tenant_id, document_id, revision),
  CONSTRAINT document_revisions_registry_fkey FOREIGN KEY (tenant_id, document_id)
    REFERENCES tenant_data.document_registry (tenant_id, document_id) ON DELETE RESTRICT,
  CONSTRAINT document_revisions_revision_positive CHECK (revision > 0),
  CONSTRAINT document_revisions_payload_digest_not_blank CHECK (length(btrim(payload_digest)) BETWEEN 1 AND 200)
);
COMMENT ON TABLE tenant_data.document_revisions IS
  'Immutable proposal/submission revisions. A pending edit appends a revision and invalidates prior approval; accepted command bytes in command_inbox are never rewritten.';
COMMENT ON COLUMN tenant_data.document_revisions.payload IS
  'Native canonical JSON text for the proposed document. Exact bytes; never mutated after submission.';
COMMENT ON COLUMN tenant_data.document_revisions.policy_snapshot IS
  'Exact approval policy decision bound to payload_digest at submission time.';

-- Purpose B — Private signed-entitlement verification cache only.
CREATE TABLE tenant_data.verified_entitlement (
  tenant_id uuid NOT NULL,
  entitlement_id text NOT NULL,
  issuer text NOT NULL,
  claims_jsonb jsonb NOT NULL DEFAULT '{}'::jsonb,
  claims_schema_version integer NOT NULL DEFAULT 1,
  public_key_digest text NOT NULL,
  signature text NOT NULL,
  valid_from timestamptz NOT NULL,
  valid_to timestamptz NOT NULL,
  verified_at timestamptz NOT NULL DEFAULT now(),
  is_active boolean NOT NULL DEFAULT true,
  source text NOT NULL DEFAULT 'native',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT verified_entitlement_pkey PRIMARY KEY (tenant_id, entitlement_id),
  CONSTRAINT verified_entitlement_id_not_blank CHECK (length(btrim(entitlement_id)) BETWEEN 1 AND 200),
  CONSTRAINT verified_entitlement_issuer_not_blank CHECK (length(btrim(issuer)) BETWEEN 1 AND 200),
  CONSTRAINT verified_entitlement_schema_version_positive CHECK (claims_schema_version > 0),
  CONSTRAINT verified_entitlement_key_digest_not_blank CHECK (length(btrim(public_key_digest)) BETWEEN 1 AND 200),
  CONSTRAINT verified_entitlement_window_order CHECK (valid_to > valid_from)
);
COMMENT ON TABLE tenant_data.verified_entitlement IS
  'Fully Private public-key-verified monthly entitlement cache. Verification only: no vendor issuing, signing, billing or global customer authority.';

-- =====================================================================
-- Indexes for actual filter and join columns. Every primary key already
-- leads with tenant_id; these cover the remaining predicates.
-- =====================================================================

CREATE INDEX journal_lines_account_idx ON tenant_data.journal_lines (tenant_id, account);
CREATE INDEX journals_company_date_idx ON tenant_data.journals (tenant_id, company, posting_date);
CREATE INDEX command_inbox_state_created_idx ON tenant_data.command_inbox (tenant_id, state, created_at);
CREATE INDEX approval_requests_state_idx ON tenant_data.approval_requests (tenant_id, state);
CREATE INDEX outbox_state_idx ON tenant_data.outbox (tenant_id, state);
CREATE INDEX command_files_command_idx ON tenant_data.command_files (tenant_id, command_id);
CREATE INDEX command_decisions_actor_idx ON tenant_data.command_decisions (tenant_id, actor);
CREATE INDEX journal_drafts_actor_state_idx ON tenant_data.journal_drafts (tenant_id, actor, state);
CREATE INDEX audit_event_entity_idx ON tenant_data.audit_event (tenant_id, entity_type, entity_id);
CREATE INDEX audit_event_happened_idx ON tenant_data.audit_event (tenant_id, happened_at DESC);
CREATE INDEX audit_command_idx ON tenant_data.audit (tenant_id, command_id);
CREATE INDEX warehouses_company_branch_idx ON tenant_data.warehouses (tenant_id, company, branch);
CREATE INDEX stock_items_company_idx ON tenant_data.stock_items (tenant_id, company);
CREATE INDEX stock_movements_item_idx ON tenant_data.stock_movements (tenant_id, company, item);
CREATE INDEX trade_parties_scope_kind_idx ON tenant_data.trade_parties (tenant_id, company, branch, kind);
CREATE INDEX trade_documents_party_date_idx ON tenant_data.trade_documents (tenant_id, company, branch, posting_date);
CREATE INDEX trade_documents_reference_idx ON tenant_data.trade_documents (tenant_id, reference);
CREATE INDEX trade_lines_account_idx ON tenant_data.trade_lines (tenant_id, account);
CREATE INDEX trade_allocations_document_idx ON tenant_data.trade_allocations (tenant_id, document_id);
CREATE INDEX trade_credits_original_idx ON tenant_data.trade_credits (tenant_id, original_id);
CREATE INDEX company_profiles_branch_idx ON tenant_data.company_profiles (tenant_id, branch);
CREATE INDEX periods_range_idx ON tenant_data.periods (tenant_id, company, end_date);
CREATE INDEX reference_values_domain_active_idx ON tenant_data.reference_values (tenant_id, domain, is_active);
CREATE INDEX business_rule_key_active_idx ON tenant_data.business_rule (tenant_id, rule_key, is_active);
CREATE INDEX approval_policy_action_active_idx ON tenant_data.approval_policy (tenant_id, action_type, is_active);
CREATE INDEX posting_constraint_document_active_idx ON tenant_data.posting_constraint (tenant_id, applies_to_document_type, is_active);
CREATE INDEX tax_profile_jurisdiction_active_idx ON tenant_data.tax_profile (tenant_id, jurisdiction, is_active);
CREATE INDEX support_grants_active_expiry_idx ON tenant_data.support_grants (tenant_id, is_active, expires_at);
CREATE INDEX document_registry_status_type_idx ON tenant_data.document_registry (tenant_id, document_status, document_type);
CREATE INDEX document_registry_command_idx ON tenant_data.document_registry (tenant_id, source_command_id);
CREATE INDEX verified_entitlement_validity_idx ON tenant_data.verified_entitlement (tenant_id, is_active, valid_to);
CREATE INDEX source_store_migrations_store_idx ON tenant_data.source_store_migrations (tenant_id, source_store, version);

-- =====================================================================
-- Privileges: default-deny. This skeleton grants no runtime role anything on
-- tenant_data. PIVOT-004 adds ENABLE/FORCE RLS, policies and the customer-app
-- grants together; granting before policies would expose every tenant's rows.
-- =====================================================================

REVOKE ALL ON SCHEMA tenant_data FROM PUBLIC;
REVOKE ALL ON ALL TABLES IN SCHEMA tenant_data FROM PUBLIC;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA tenant_data FROM PUBLIC;

REVOKE ALL ON SCHEMA tenant_data FROM saven_customer_app, saven_auth_service, saven_auth_definer;
REVOKE ALL ON ALL TABLES IN SCHEMA tenant_data FROM saven_customer_app, saven_auth_service, saven_auth_definer;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA tenant_data FROM saven_customer_app, saven_auth_service, saven_auth_definer;

REVOKE ALL ON SCHEMA tenant_data FROM saven_operator_read, saven_operator_admin, saven_operator_definer;
REVOKE ALL ON ALL TABLES IN SCHEMA tenant_data FROM saven_operator_read, saven_operator_admin, saven_operator_definer;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA tenant_data FROM saven_operator_read, saven_operator_admin, saven_operator_definer;

COMMIT;
