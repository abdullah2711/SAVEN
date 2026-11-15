-- PIVOT-003-R1: additive correction to the tenant_data skeleton.
-- Run after 20-tenant-schema.sql with a connection that is a member of saven_migrator
-- (or a superuser). DDL objects are owned by saven_migrator, the offline DDL role.
--
-- Purpose: restore the native empty-stock valuation invariant, reconcile the tax
-- default with the canonical reference seed, and annotate the externally configured
-- posting-constraint severity domain. The delivered 20 file is preserved
-- byte-for-byte; this correction adds one validated named constraint, changes one
-- column default and corrects two column comments. It adds no RLS, trigger, policy,
-- grant or runtime privilege, and it repairs no existing data.

BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'saven_migrator') THEN
    RAISE EXCEPTION 'Run 00-roles.sql before 021-tenant-schema-corrections.sql';
  END IF;
  IF NOT pg_has_role(current_user, 'saven_migrator', 'MEMBER') THEN
    RAISE EXCEPTION 'Run 021-tenant-schema-corrections.sql as a member of saven_migrator';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'tenant_data') THEN
    RAISE EXCEPTION 'Run 20-tenant-schema.sql before 021-tenant-schema-corrections.sql';
  END IF;
END $$;

SET LOCAL ROLE saven_migrator;

-- 1. Native parity: src/local/schema.mjs stock_balances carries
--    CHECK(quantity > 0 OR value = 0). Without it a zero-quantity balance could
--    retain owned stock value. Added NOT VALID first so pre-existing invalid rows
--    cause an explicit validation failure instead of a silent repair.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'stock_balances_quantity_value_chk'
      AND conrelid = 'tenant_data.stock_balances'::regclass
  ) THEN
    ALTER TABLE tenant_data.stock_balances
      ADD CONSTRAINT stock_balances_quantity_value_chk
      CHECK (quantity > 0 OR value = 0)
      NOT VALID;
  END IF;
END $$;

ALTER TABLE tenant_data.stock_balances
  VALIDATE CONSTRAINT stock_balances_quantity_value_chk;

COMMENT ON CONSTRAINT stock_balances_quantity_value_chk ON tenant_data.stock_balances IS
  'PIVOT-003-R1: restores native CHECK(quantity > 0 OR value = 0). An empty balance can never hold owned stock value.';

-- 2. The canonical tax_type seed uses upper-case SALES_TAX, so the default must
--    resolve to that exact reference value instead of an unseeded lower-case label.
ALTER TABLE tenant_data.tax_profile
  ALTER COLUMN tax_type SET DEFAULT 'SALES_TAX';

COMMENT ON COLUMN tenant_data.tax_profile.tax_type IS
  'reference domain: tax_type. Default SALES_TAX matches the canonical seed in contracts/postgres-business-rules-v1.json.';

-- 3. rule_jsonb.severity is a configured domain, not a JSON-schema enum. The value
--    must resolve to an effective-dated tenant_data.reference_values row and the
--    registered handler for handler_key decides whether it warns or blocks.
COMMENT ON COLUMN tenant_data.posting_constraint.rule_jsonb IS
  'Versioned inert JSON for the deterministic handler named by handler_key; reference domain: posting_constraint_severity governs rule_jsonb.severity. A reference row never installs executable policy, and an unknown handler or severity must fail closed at posting time.';

COMMIT;
