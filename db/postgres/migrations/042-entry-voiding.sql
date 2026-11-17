-- PIVOT-005: terminal soft deletion of posted entries (entry voiding), D-013/D-014, ADR04.
--
-- Applied by the SEPARATE OFFLINE ADMINISTRATOR (superuser) because it provisions one
-- narrow NOLOGIN owner for the void primitive and transfers that single function to it.
--
-- ROLE-AGNOSTIC READ VISIBILITY (D-014): no business role names, eligibility classes or
-- void-specific read restriction. Fine-grained visibility is future application RBAC.
--
-- ACTIVATION: this file grants the runtime NOTHING. Runtime read grants and the void
-- primitive's EXECUTE are applied by 40-triggers.sql only after every guard trigger is
-- attached and validated, so a partial install never exposes the void command.
--
-- AUTHORITY (finding 2): the primitive evaluates the canonical role-permission contract
-- (actions + companies/branches/accounts + maxMinor + review), explicit denials and the
-- currency-matched effective approval policy through reviewed helper functions; denied,
-- unknown, stale or out-of-scope decisions fail closed. Locked posting periods are
-- refused (no blanket locked-period voiding). Approval, when required, must be an
-- APPROVED approval_requests row bound to this exact request digest and canonical
-- decision, decided by a different actor whose current membership and approval/resource
-- authority are revalidated at execution. Fabricated, self, wrong-submission, revoked
-- and stale approvals are refused.
--
-- CONCURRENCY (finding 3): every source/dependency writer uses the shared command lock
-- from payload 040; a deferred constraint trigger re-checks both ends of correction
-- references at commit; idempotency is re-checked after the lock is held.

BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'saven_migrator') THEN
    RAISE EXCEPTION 'Run 00-roles.sql before 042-entry-voiding.sql';
  END IF;
  IF NOT (SELECT rolsuper FROM pg_roles WHERE rolname = current_user) THEN
    RAISE EXCEPTION '042-entry-voiding.sql provisions a role and transfers function ownership: run it as the separate offline administrator (superuser)';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'tenant_data') THEN
    RAISE EXCEPTION 'Run 20-tenant-schema.sql before 042-entry-voiding.sql';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'tenant_data' AND p.proname = 'immutability_040_command_guard'
  ) THEN
    RAISE EXCEPTION 'Run migrations/040-posted-immutability.sql before 042-entry-voiding.sql';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'tenant_data' AND c.relname = 'entry_voids'
  ) THEN
    RAISE EXCEPTION 'PIVOT-005: 042-entry-voiding.sql is already applied';
  END IF;
END $$;

-- =====================================================================
-- 1. Narrow, non-login owner for the void primitive only
-- =====================================================================

DO $$
DECLARE
  incompatible boolean;
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'saven_void_definer') THEN
    SELECT rolcanlogin OR rolsuper OR rolcreatedb OR rolcreaterole OR rolinherit OR rolbypassrls OR rolreplication
      INTO incompatible
    FROM pg_roles WHERE rolname = 'saven_void_definer';
    IF incompatible THEN
      RAISE EXCEPTION 'PIVOT-005: refused incompatible pre-existing role saven_void_definer; it must be NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS NOREPLICATION';
    END IF;
  ELSE
    EXECUTE 'CREATE ROLE saven_void_definer NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS NOREPLICATION';
  END IF;
END $$;

COMMENT ON ROLE saven_void_definer IS
  'PIVOT-005: NOLOGIN owner of tenant_data.void_posted_entry() only. Fixed search_path, restricted EXECUTE, enumerated column grants, no DDL, no ownership beyond that one function, no superuser/BYPASSRLS.';

SET LOCAL ROLE saven_migrator;

-- =====================================================================
-- 2. Append-only void record and denial log
-- =====================================================================

CREATE TABLE tenant_data.entry_voids (
  tenant_id uuid NOT NULL,
  void_command_id text NOT NULL,
  entry_id text NOT NULL,
  reason text NOT NULL,
  actor text NOT NULL,
  actor_uuid uuid NOT NULL,
  original_state text NOT NULL,
  effective_state text NOT NULL,
  source_digest text NOT NULL,
  source_version bigint NOT NULL,
  source_line_count integer NOT NULL,
  source_debit bigint NOT NULL,
  request_digest text NOT NULL,
  idempotency_key text NOT NULL,
  policy_decision jsonb NOT NULL DEFAULT '{}'::jsonb,
  policy_digest text NOT NULL DEFAULT '',
  approval_command_id text,
  approver_actor text,
  approval_digest text,
  correlation_id text,
  policy_version bigint,
  approval_version bigint,
  period_locked boolean NOT NULL,
  voided_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT entry_voids_pkey PRIMARY KEY (tenant_id, void_command_id),
  CONSTRAINT entry_voids_entry_key UNIQUE (tenant_id, entry_id),
  CONSTRAINT entry_voids_idempotency_key UNIQUE (tenant_id, idempotency_key),
  CONSTRAINT entry_voids_entry_fkey FOREIGN KEY (tenant_id, entry_id)
    REFERENCES tenant_data.journals (tenant_id, id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT entry_voids_command_fkey FOREIGN KEY (tenant_id, void_command_id)
    REFERENCES tenant_data.command_inbox (tenant_id, id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT entry_voids_approval_fkey FOREIGN KEY (tenant_id, approval_command_id)
    REFERENCES tenant_data.command_inbox (tenant_id, id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT entry_voids_actor_fkey FOREIGN KEY (actor_uuid, actor)
    REFERENCES auth.users (id, legacy_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT entry_voids_transition CHECK (original_state = 'POSTED' AND effective_state = 'VOIDED'),
  CONSTRAINT entry_voids_reason_not_blank CHECK (length(btrim(reason)) BETWEEN 1 AND 1000),
  CONSTRAINT entry_voids_actor_not_blank CHECK (length(btrim(actor)) BETWEEN 1 AND 200),
  CONSTRAINT entry_voids_key_not_blank CHECK (length(btrim(idempotency_key)) BETWEEN 1 AND 200),
  CONSTRAINT entry_voids_digest_not_blank CHECK (length(btrim(source_digest)) BETWEEN 1 AND 200),
  CONSTRAINT entry_voids_request_not_blank CHECK (length(btrim(request_digest)) BETWEEN 1 AND 200),
  CONSTRAINT entry_voids_version_positive CHECK (source_version > 0),
  CONSTRAINT entry_voids_lines_balanced CHECK (source_line_count >= 2),
  CONSTRAINT entry_voids_debit_positive CHECK (source_debit > 0),
  CONSTRAINT entry_voids_approval_binding CHECK (
    (approval_command_id IS NULL AND approver_actor IS NULL AND approval_digest IS NULL)
    OR (approval_command_id IS NOT NULL AND approver_actor IS NOT NULL AND approval_digest IS NOT NULL)
  )
);

COMMENT ON TABLE tenant_data.entry_voids IS
  'PIVOT-005: append-only terminal void record. One row per voided entry; the source journal, lines, command receipt, evidence and numbers remain physically retained and immutable.';
COMMENT ON COLUMN tenant_data.entry_voids.policy_decision IS
  'Canonical decision payload from the reviewed permission/policy helpers captured at void time (denials, matching roles, scope, review requirement and policy version).';
COMMENT ON COLUMN tenant_data.entry_voids.approval_command_id IS
  'Pre-registered void command receipt whose APPROVED approval_requests row authorised a review-required void; null when no review was required.';
COMMENT ON COLUMN tenant_data.entry_voids.approver_actor IS
  'Exact verified approver identity (tenant-local member id) captured at void time; null when no approval was required.';
COMMENT ON COLUMN tenant_data.entry_voids.approval_digest IS
  'Canonical decision digest that the independent approver approved, revalidated against the current policy/role decision at execution time; null when no approval was required.';

CREATE TABLE tenant_data.void_denials (
  tenant_id uuid NOT NULL,
  id bigint GENERATED BY DEFAULT AS IDENTITY,
  entry_id text,
  actor text NOT NULL,
  actor_uuid uuid,
  attempt_key text,
  reason_code text NOT NULL,
  detail text NOT NULL DEFAULT '',
  attempted_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT void_denials_pkey PRIMARY KEY (tenant_id, id),
  CONSTRAINT void_denials_actor_not_blank CHECK (length(btrim(actor)) BETWEEN 1 AND 200),
  CONSTRAINT void_denials_reason_not_blank CHECK (length(btrim(reason_code)) BETWEEN 1 AND 120)
);

COMMENT ON TABLE tenant_data.void_denials IS
  'PIVOT-005: append-only durable denial log. A denied void raises and cannot write its own audit row; the kernel records the refusal here in a separate transaction. actor/actor_uuid are overwritten from verified context by a trigger.';

CREATE INDEX entry_voids_entry_idx ON tenant_data.entry_voids (tenant_id, entry_id);
CREATE INDEX void_denials_attempt_idx ON tenant_data.void_denials (tenant_id, attempted_at DESC);

-- =====================================================================
-- 3. Canonical effective projections (role-agnostic)
-- =====================================================================

CREATE VIEW tenant_data.active_general_ledger
WITH (security_invoker = true) AS
SELECT l.tenant_id,
       l.journal_id,
       l.line_no,
       j.company,
       j.branch,
       j.posting_date,
       j.narrative,
       l.account,
       l.debit,
       l.credit,
       j.created_at AS posted_at
FROM tenant_data.journal_lines l
JOIN tenant_data.journals j ON j.tenant_id = l.tenant_id AND j.id = l.journal_id
JOIN tenant_data.command_inbox c ON c.tenant_id = j.tenant_id AND c.id = j.id
WHERE c.state = 'POSTED'
  AND NOT EXISTS (
    SELECT 1 FROM tenant_data.entry_voids v
    WHERE v.tenant_id = l.tenant_id AND v.entry_id = l.journal_id
  );

COMMENT ON VIEW tenant_data.active_general_ledger IS
  'PIVOT-005: canonical active General Ledger. Includes only journals whose accepted command is effectively POSTED and not voided; unposted, accepted, pending, failed or rejected sources never affect balances. A voided journal keeps its historical POSTED receipt and is excluded as a whole.';

CREATE VIEW tenant_data.voided_entries
WITH (security_invoker = true) AS
SELECT v.tenant_id,
       v.entry_id,
       v.void_command_id,
       v.reason,
       v.actor,
       v.actor_uuid,
       v.original_state,
       v.effective_state,
       v.source_digest,
       v.source_version,
       v.source_line_count,
       v.source_debit,
       v.period_locked,
       v.policy_version,
       v.approval_version,
       v.approval_command_id,
       v.approver_actor,
       v.approval_digest,
       v.correlation_id,
       v.voided_at,
       j.company,
       j.branch,
       j.posting_date,
       j.narrative,
       l.line_no,
       l.account,
       l.debit,
       l.credit
FROM tenant_data.entry_voids v
JOIN tenant_data.journals j ON j.tenant_id = v.tenant_id AND j.id = v.entry_id
LEFT JOIN tenant_data.journal_lines l ON l.tenant_id = j.tenant_id AND l.journal_id = j.id;

COMMENT ON VIEW tenant_data.voided_entries IS
  'PIVOT-005: canonical Deleted/Voided Entries projection. Retains the original posting data plus the void record and void time. Visibility is normal module access; fine-grained visibility is deferred to future application RBAC (D-014).';

-- =====================================================================
-- 4. Forced RLS and atomic policies for the new tenant tables
-- =====================================================================

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['entry_voids', 'void_denials'] LOOP
    EXECUTE format('ALTER TABLE tenant_data.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE tenant_data.%I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY %I ON tenant_data.%I AS PERMISSIVE FOR ALL TO PUBLIC '
      'USING (tenant_id = tenant_data.current_tenant_id()) '
      'WITH CHECK (tenant_id = tenant_data.current_tenant_id())',
      t || '_tenant_isolation', t);
    EXECUTE format(
      'CREATE POLICY %I ON tenant_data.%I AS RESTRICTIVE FOR ALL TO PUBLIC '
      'USING (tenant_id = tenant_data.current_tenant_id()) '
      'WITH CHECK (tenant_id = tenant_data.current_tenant_id())',
      t || '_tenant_scope', t);
    EXECUTE format(
      'CREATE POLICY %I ON tenant_data.%I AS RESTRICTIVE FOR ALL TO %I '
      'USING (tenant_id = tenant_data.current_tenant_id() '
      'AND tenant_data.session_admitted(tenant_data.current_tenant_id(), tenant_data.current_user_id())) '
      'WITH CHECK (tenant_id = tenant_data.current_tenant_id() '
      'AND tenant_data.session_admitted(tenant_data.current_tenant_id(), tenant_data.current_user_id()))',
      t || '_runtime_admission', t, 'saven_customer_app');
  END LOOP;
END $$;

-- =====================================================================
-- 5. Reviewed permission and policy decision helper
-- =====================================================================

CREATE FUNCTION tenant_data.immutability_042_policy_decision(
  p_tenant uuid,
  p_actor text,
  p_amount bigint,
  p_company text,
  p_branch text,
  p_accounts text[],
  p_entry text,
  p_request_digest text
) RETURNS jsonb
LANGUAGE plpgsql STABLE
SET search_path = pg_catalog, tenant_data
AS $fn$
DECLARE
  v_denied boolean;
  v_roles jsonb := '[]'::jsonb;
  v_role_ids text[] := ARRAY[]::text[];
  v_allowed boolean;
  v_review boolean := true;
  v_currency text;
  v_role record;
  v_actions jsonb;
  v_companies jsonb;
  v_branches jsonb;
  v_account_scope jsonb;
  v_max numeric;
  v_role_review boolean;
  v_role_matches boolean;
  v_matches integer := 0;
  v_any_policy boolean;
  v_policies jsonb := '[]'::jsonb;
  v_policy_role text;
  v_has_specific boolean;
  v_candidate record;
  v_candidate_version bigint;
  v_candidate_key text;
  v_candidate_scope text;
  v_candidate_threshold numeric;
  v_candidate_requires boolean;
  v_effective_threshold numeric;
  v_controlling_version bigint;
  v_controlling_key text;
  v_requires_approver boolean := false;
  v_decision jsonb;
BEGIN
  -- Currency is part of the policy identity: a threshold recorded for another
  -- currency must never be compared against this entry's exact minor units.
  SELECT cp.currency INTO v_currency
  FROM tenant_data.company_profiles cp
  WHERE cp.tenant_id = p_tenant AND cp.id = p_company;
  IF v_currency IS NULL THEN
    RAISE EXCEPTION 'VOID_POLICY_UNKNOWN_CURRENCY: company % has no declared currency', p_company;
  END IF;

  -- Explicit denial wins, including the wildcard denial.
  SELECT EXISTS (
    SELECT 1 FROM tenant_data.denials d
    WHERE d.tenant_id = p_tenant AND d.user_id = p_actor
      AND d.action IN ('accounting.entry.void', '*')
  ) INTO v_denied;

  -- Canonical role grants, evaluated in a stable role-id order so the decision digest,
  -- matching role identities and policy applicability are deterministic. Malformed
  -- permission data fails closed instead of silently granting or ignoring a limit.
  FOR v_role IN
    SELECT r.id AS role_id, r.protected, r.permissions::jsonb AS rule
    FROM tenant_data.members m
    JOIN tenant_data.assignments a ON a.tenant_id = m.tenant_id AND a.user_id = m.user_id
    JOIN tenant_data.roles r ON r.tenant_id = a.tenant_id AND r.id = a.role_id
    WHERE m.tenant_id = p_tenant AND m.user_id = p_actor AND m.active
    ORDER BY r.id
  LOOP
    v_role_matches := false;
    IF v_role.protected THEN
      v_role_matches := true;
      v_role_review := false;
    ELSE
      IF jsonb_typeof(v_role.rule) IS DISTINCT FROM 'object' THEN
        RAISE EXCEPTION 'VOID_PERMISSION_INVALID: role % has a malformed permission payload', v_role.role_id;
      END IF;
      v_actions := v_role.rule -> 'actions';
      IF jsonb_typeof(v_actions) IS DISTINCT FROM 'array'
         OR EXISTS (SELECT 1 FROM jsonb_array_elements(v_actions) e WHERE jsonb_typeof(e) IS DISTINCT FROM 'string') THEN
        RAISE EXCEPTION 'VOID_PERMISSION_INVALID: role % has no canonical actions array', v_role.role_id;
      END IF;
      v_companies := v_role.rule -> 'companies';
      v_branches := v_role.rule -> 'branches';
      v_account_scope := v_role.rule -> 'accounts';
      IF jsonb_typeof(v_companies) IS DISTINCT FROM 'array'
         OR jsonb_typeof(v_branches) IS DISTINCT FROM 'array'
         OR jsonb_typeof(v_account_scope) IS DISTINCT FROM 'array'
         OR EXISTS (SELECT 1 FROM jsonb_array_elements(v_companies) e WHERE jsonb_typeof(e) IS DISTINCT FROM 'string')
         OR EXISTS (SELECT 1 FROM jsonb_array_elements(v_branches) e WHERE jsonb_typeof(e) IS DISTINCT FROM 'string')
         OR EXISTS (SELECT 1 FROM jsonb_array_elements(v_account_scope) e WHERE jsonb_typeof(e) IS DISTINCT FROM 'string') THEN
        RAISE EXCEPTION 'VOID_PERMISSION_INVALID: role % has malformed resource scope arrays', v_role.role_id;
      END IF;
      IF jsonb_exists(v_role.rule, 'review') AND jsonb_typeof(v_role.rule -> 'review') IS DISTINCT FROM 'boolean' THEN
        RAISE EXCEPTION 'VOID_PERMISSION_INVALID: role % has a non-boolean review rule', v_role.role_id;
      END IF;
      IF jsonb_exists(v_role.rule, 'maxMinor') THEN
        IF jsonb_typeof(v_role.rule -> 'maxMinor') IS DISTINCT FROM 'number' THEN
          RAISE EXCEPTION 'VOID_PERMISSION_INVALID: role % has a non-numeric maxMinor; an unknown limit fails closed', v_role.role_id;
        END IF;
        v_max := (v_role.rule ->> 'maxMinor')::numeric;
        IF v_max < 0 OR v_max <> trunc(v_max) OR v_max > 999999999999 THEN
          RAISE EXCEPTION 'VOID_PERMISSION_INVALID: role % has an invalid maxMinor', v_role.role_id;
        END IF;
      ELSE
        v_max := NULL;
      END IF;

      v_role_review := coalesce((v_role.rule ->> 'review')::boolean, true);
      IF jsonb_exists(v_actions, 'accounting.entry.void')
         AND (jsonb_exists(v_companies, '*') OR jsonb_exists(v_companies, p_company))
         AND (jsonb_exists(v_branches, '*') OR jsonb_exists(v_branches, p_branch))
         AND NOT EXISTS (
           SELECT 1 FROM unnest(p_accounts) AS acc(code)
           WHERE NOT (jsonb_exists(v_account_scope, '*') OR jsonb_exists(v_account_scope, acc.code))
         )
         AND (v_max IS NULL OR p_amount <= v_max) THEN
        v_role_matches := true;
      END IF;
    END IF;

    IF v_role_matches THEN
      v_matches := v_matches + 1;
      v_role_ids := v_role_ids || v_role.role_id;
      v_review := v_review AND v_role_review;
      v_roles := v_roles || jsonb_build_array(jsonb_build_object(
        'roleId', v_role.role_id,
        'permissions', v_role.rule));
    END IF;
  END LOOP;

  v_allowed := NOT v_denied AND v_matches > 0;

  -- Effective approval policy is resolved against the requester's matching role
  -- identities. A policy row for an unrelated role is never applicable merely because
  -- it has a higher version. For each matching role, a role-specific policy overrides
  -- the global policy; a role with no specific policy falls back to the global row.
  -- Selected policies combine conservatively: the lowest threshold controls review and
  -- any different-approver requirement wins, so one role's higher-version high-threshold
  -- policy cannot mask another applicable role's required review. Two policy keys
  -- claiming the same maximum version for the same role/global scope are ambiguous and
  -- fail closed. Thresholds are exact minor units of the policy currency for this
  -- terminal-void action only.
  SELECT EXISTS (
    SELECT 1 FROM tenant_data.approval_policy ap
    WHERE ap.tenant_id = p_tenant
      AND ap.action_type = 'accounting.entry.void'
      AND ap.is_active
      AND ap.effective_from <= now()
      AND (ap.effective_to IS NULL OR ap.effective_to > now())
  ) INTO v_any_policy;
  IF v_any_policy AND NOT EXISTS (
    SELECT 1 FROM tenant_data.approval_policy ap
    WHERE ap.tenant_id = p_tenant
      AND ap.action_type = 'accounting.entry.void'
      AND ap.currency = v_currency
      AND ap.is_active
      AND ap.effective_from <= now()
      AND (ap.effective_to IS NULL OR ap.effective_to > now())
  ) THEN
    RAISE EXCEPTION 'VOID_POLICY_CURRENCY_MISMATCH: approval policies exist for this action but none applies to currency %', v_currency;
  END IF;

  FOR v_policy_role IN SELECT unnest(v_role_ids) ORDER BY 1 LOOP
    -- Role-specific current identities replace the global fallback for this role.
    SELECT EXISTS (
      SELECT 1 FROM tenant_data.approval_policy ap
      WHERE ap.tenant_id = p_tenant
        AND ap.action_type = 'accounting.entry.void'
        AND ap.currency = v_currency
        AND ap.role_id = v_policy_role
        AND ap.is_active
        AND ap.effective_from <= now()
        AND (ap.effective_to IS NULL OR ap.effective_to > now())
    ) INTO v_has_specific;
    v_candidate_scope := CASE WHEN v_has_specific THEN 'ROLE' ELSE 'GLOBAL' END;

    -- Versions belong to a (policy_key, role) identity. Resolve the current version
    -- within each identity FIRST, then combine every applicable current identity
    -- conservatively. A version number never outranks another policy key.
    FOR v_candidate IN
      SELECT ap.policy_key, max(ap.version) AS version
      FROM tenant_data.approval_policy ap
      WHERE ap.tenant_id = p_tenant
        AND ap.action_type = 'accounting.entry.void'
        AND ap.currency = v_currency
        AND ap.is_active
        AND ap.effective_from <= now()
        AND (ap.effective_to IS NULL OR ap.effective_to > now())
        AND ((v_has_specific AND ap.role_id = v_policy_role)
             OR (NOT v_has_specific AND ap.role_id IS NULL))
      GROUP BY ap.policy_key
      ORDER BY ap.policy_key
    LOOP
      v_candidate_key := v_candidate.policy_key;
      v_candidate_version := v_candidate.version;

      SELECT ap.approval_threshold_amount, ap.requires_different_approver
        INTO v_candidate_threshold, v_candidate_requires
      FROM tenant_data.approval_policy ap
      WHERE ap.tenant_id = p_tenant
        AND ap.action_type = 'accounting.entry.void'
        AND ap.currency = v_currency
        AND ap.policy_key = v_candidate_key
        AND ap.version = v_candidate_version
        AND ap.is_active
        AND ap.effective_from <= now()
        AND (ap.effective_to IS NULL OR ap.effective_to > now())
        AND ((v_has_specific AND ap.role_id = v_policy_role)
             OR (NOT v_has_specific AND ap.role_id IS NULL));
      IF NOT FOUND THEN
        RAISE EXCEPTION 'VOID_POLICY_INVALID: policy identity % version % is no longer resolvable', v_candidate_key, v_candidate_version;
      END IF;

      IF v_candidate_threshold IS NULL
         OR v_candidate_threshold < 0
         OR v_candidate_threshold <> trunc(v_candidate_threshold)
         OR v_candidate_threshold > 999999999999 THEN
        RAISE EXCEPTION 'VOID_POLICY_INVALID: threshold % for identity % is not an exact non-negative minor-unit value', v_candidate_threshold, v_candidate_key;
      END IF;

      v_policies := v_policies || jsonb_build_array(jsonb_build_object(
        'roleId', v_policy_role,
        'policyKey', v_candidate_key,
        'scope', v_candidate_scope,
        'version', v_candidate_version,
        'currency', v_currency,
        'thresholdMinor', v_candidate_threshold::bigint,
        'requiresDifferentApprover', coalesce(v_candidate_requires, false)));
      v_requires_approver := v_requires_approver OR coalesce(v_candidate_requires, false);
      IF v_effective_threshold IS NULL OR v_candidate_threshold < v_effective_threshold THEN
        v_effective_threshold := v_candidate_threshold;
        v_controlling_version := v_candidate_version;
        v_controlling_key := v_candidate_key;
      END IF;
    END LOOP;
  END LOOP;

  IF v_effective_threshold IS NOT NULL AND p_amount > v_effective_threshold THEN
    v_review := true;
  END IF;

  v_decision := jsonb_build_object(
    'allowed', v_allowed,
    'denied', v_denied,
    'review', CASE WHEN v_allowed THEN v_review ELSE true END,
    'requiresDifferentApprover', coalesce(v_requires_approver, false),
    'policyVersion', v_controlling_version,
    'policyKey', v_controlling_key,
    'policies', v_policies,
    'matchingRoleIds', to_jsonb(v_role_ids),
    'currency', v_currency,
    'thresholdMinor', CASE WHEN v_effective_threshold IS NULL THEN NULL ELSE v_effective_threshold::bigint END,
    'amount', p_amount,
    'company', p_company,
    'branch', p_branch,
    'entry', p_entry,
    'requestDigest', p_request_digest,
    'roles', v_roles
  );
  RETURN v_decision;
END;
$fn$;

COMMENT ON FUNCTION tenant_data.immutability_042_policy_decision(uuid, text, bigint, text, text, text[], text, text) IS
  'PIVOT-005: canonical decision over the role permission contract (actions, company/branch/account scope, maxMinor, review), explicit denials and role-applicable currency-matched approval policy. Role-specific policy overrides global for that role; selected policies combine conservatively (lowest threshold, any different-approver requirement) and bind matching role ids, policy identities and versions into the decision. Malformed limits, same-role/global version ambiguity and currency mismatches fail closed. Thresholds are exact minor units for this action.';

CREATE FUNCTION tenant_data.immutability_042_decision_digest(p_decision jsonb) RETURNS text
LANGUAGE sql IMMUTABLE
SET search_path = pg_catalog
AS $fn$
  SELECT encode(sha256(convert_to(p_decision::text, 'UTF8')), 'hex')
$fn$;

-- =====================================================================
-- 6. The atomic void primitive
-- =====================================================================

CREATE FUNCTION tenant_data.void_posted_entry(
  p_tenant uuid,
  p_entry text,
  p_actor text,
  p_reason text,
  p_idempotency_key text,
  p_void_command_id text DEFAULT NULL,
  p_correlation_id text DEFAULT NULL
) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, tenant_data
AS $fn$
DECLARE
  v_now_ms bigint;
  v_request_digest text;
  v_existing_entry text;
  v_existing_digest text;
  v_existing_source text;
  v_command_state text;
  v_source_digest text;
  v_source_version bigint;
  v_line_count integer;
  v_debit numeric;
  v_credit numeric;
  v_accounts text[];
  v_company text;
  v_branch text;
  v_posting_date text;
  v_period_locked boolean;
  v_actor text;
  v_decision jsonb;
  v_decision_digest text;
  v_review boolean;
  v_approval_command text;
  v_approval_state text;
  v_approval_digest text;
  v_approval_actor text;
  v_approval_uuid uuid;
  v_approval_snapshot jsonb;
  v_approval_version bigint;
  v_command_actor text;
  v_command_digest text;
  v_command_payload jsonb;
  v_void_command text;
  v_payload jsonb;
  v_policy_version bigint;
  v_lock_entry bigint;
  v_lock_idem bigint;
BEGIN
  IF p_tenant IS NULL OR p_entry IS NULL OR p_actor IS NULL OR p_reason IS NULL
     OR p_idempotency_key IS NULL THEN
    RAISE EXCEPTION 'VOID_ARGUMENTS_REQUIRED';
  END IF;
  IF p_tenant IS DISTINCT FROM tenant_data.current_tenant_id() THEN
    RAISE EXCEPTION 'VOID_TENANT_CONTEXT_MISMATCH';
  END IF;
  IF NOT tenant_data.session_admitted(p_tenant, tenant_data.current_user_id()) THEN
    RAISE EXCEPTION 'VOID_CONTEXT_REQUIRED';
  END IF;
  IF length(btrim(p_reason)) = 0 OR length(btrim(p_idempotency_key)) = 0 THEN
    RAISE EXCEPTION 'VOID_ARGUMENTS_REQUIRED';
  END IF;

  SELECT m.user_id INTO v_actor
  FROM tenant_data.members m
  WHERE m.tenant_id = p_tenant AND m.user_uuid = tenant_data.current_user_id() AND m.active;
  IF v_actor IS NULL OR v_actor IS DISTINCT FROM p_actor THEN
    RAISE EXCEPTION 'VOID_ACTOR_MISMATCH';
  END IF;

  v_request_digest := encode(sha256(convert_to(
    concat_ws('|', p_entry, p_actor, p_reason, p_idempotency_key), 'UTF8')), 'hex');

  -- Serialize every writer on this entry (posting, children, corrections and voids all
  -- use the same payload-040 advisory key) AND every call that reuses this idempotency
  -- key, in one deterministic order. Without the key lock, two concurrent calls with
  -- the same key on different entries would race to the UNIQUE index instead of the
  -- declared idempotency contract.
  v_lock_entry := tenant_data.immutability_040_lock_key(p_tenant, p_entry);
  v_lock_idem := tenant_data.immutability_040_lock_key(p_tenant, 'idem:' || p_idempotency_key);
  IF v_lock_entry <= v_lock_idem THEN
    PERFORM pg_advisory_xact_lock(v_lock_entry);
    PERFORM pg_advisory_xact_lock(v_lock_idem);
  ELSE
    PERFORM pg_advisory_xact_lock(v_lock_idem);
    PERFORM pg_advisory_xact_lock(v_lock_entry);
  END IF;

  SELECT v.void_command_id, v.request_digest, v.entry_id
    INTO v_existing_entry, v_existing_digest, v_existing_source
  FROM tenant_data.entry_voids v
  WHERE v.tenant_id = p_tenant AND v.idempotency_key = p_idempotency_key;
  IF v_existing_entry IS NOT NULL THEN
    IF v_existing_digest = v_request_digest AND v_existing_source = p_entry THEN
      RETURN v_existing_entry;
    END IF;
    RAISE EXCEPTION 'VOID_IDEMPOTENCY_CONFLICT';
  END IF;

  PERFORM 1 FROM tenant_data.journals j WHERE j.tenant_id = p_tenant AND j.id = p_entry;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'VOID_ENTRY_NOT_FOUND';
  END IF;

  IF EXISTS (
    SELECT 1 FROM tenant_data.entry_voids v
    WHERE v.tenant_id = p_tenant AND v.entry_id = p_entry
  ) THEN
    RAISE EXCEPTION 'ENTRY_ALREADY_VOIDED';
  END IF;

  SELECT c.state, c.digest, c.updated_at
    INTO v_command_state, v_source_digest, v_source_version
  FROM tenant_data.command_inbox c
  WHERE c.tenant_id = p_tenant AND c.id = p_entry;
  IF v_command_state IS NULL THEN
    RAISE EXCEPTION 'VOID_ENTRY_NOT_FOUND';
  END IF;
  IF v_command_state IS DISTINCT FROM 'POSTED' THEN
    RAISE EXCEPTION 'VOID_ENTRY_NOT_POSTED';
  END IF;

  SELECT j.company, j.branch, j.posting_date INTO v_company, v_branch, v_posting_date
  FROM tenant_data.journals j WHERE j.tenant_id = p_tenant AND j.id = p_entry;

  SELECT count(*), coalesce(sum(l.debit), 0), coalesce(sum(l.credit), 0), array_agg(l.account ORDER BY l.line_no)
    INTO v_line_count, v_debit, v_credit, v_accounts
  FROM tenant_data.journal_lines l
  WHERE l.tenant_id = p_tenant AND l.journal_id = p_entry;
  IF v_line_count < 2 THEN
    RAISE EXCEPTION 'VOID_SOURCE_INCOMPLETE';
  END IF;
  IF v_debit <> v_credit OR v_debit <= 0 THEN
    RAISE EXCEPTION 'VOID_SOURCE_UNBALANCED';
  END IF;

  -- Locked posting periods stay enforced; voiding is not a locked-period override.
  SELECT EXISTS (
    SELECT 1 FROM tenant_data.periods p
    WHERE p.tenant_id = p_tenant AND p.company = v_company
      AND p.start_date <= v_posting_date AND p.end_date >= v_posting_date AND p.locked
  ) INTO v_period_locked;
  IF v_period_locked THEN
    RAISE EXCEPTION 'VOID_PERIOD_LOCKED';
  END IF;

  -- Canonical permission/policy decision, verified and bound into the void record.
  v_decision := tenant_data.immutability_042_policy_decision(
    p_tenant, v_actor, v_debit::bigint, v_company, v_branch, v_accounts,
    p_entry, v_request_digest);
  v_decision_digest := tenant_data.immutability_042_decision_digest(v_decision);
  IF NOT coalesce((v_decision ->> 'allowed')::boolean, false) THEN
    IF coalesce((v_decision ->> 'denied')::boolean, false) THEN
      RAISE EXCEPTION 'VOID_ACTION_DENIED';
    END IF;
    RAISE EXCEPTION 'VOID_ACTION_REQUIRED';
  END IF;
  v_review := coalesce((v_decision ->> 'review')::boolean, true);
  v_policy_version := (v_decision ->> 'policyVersion')::bigint;

  -- Review-required voids need a pre-registered receipt whose exact submission and
  -- approved canonical decision are independently verified. Metadata alone is never
  -- treated as authority: the approver's current membership and approval grant are
  -- revalidated here, so a revoked or changed approver fails closed.
  IF v_review THEN
    IF p_void_command_id IS NULL THEN
      RAISE EXCEPTION 'VOID_APPROVAL_REQUIRED';
    END IF;

    SELECT c.state, c.actor, c.digest, c.payload::jsonb
      INTO v_command_state, v_command_actor, v_command_digest, v_command_payload
    FROM tenant_data.command_inbox c
    WHERE c.tenant_id = p_tenant AND c.id = p_void_command_id;
    IF v_command_state IS NULL THEN
      RAISE EXCEPTION 'VOID_APPROVAL_RECEIPT_INVALID';
    END IF;
    IF v_command_state IS DISTINCT FROM 'ACCEPTED_PENDING'
       AND v_command_state IS DISTINCT FROM 'AWAITING_APPROVAL' THEN
      RAISE EXCEPTION 'VOID_APPROVAL_RECEIPT_INVALID';
    END IF;

    -- The pre-registered command must be this exact void submission by this actor.
    IF v_command_actor IS DISTINCT FROM p_actor
       OR v_command_digest IS DISTINCT FROM v_request_digest
       OR v_command_payload IS NULL
       OR jsonb_typeof(v_command_payload) IS DISTINCT FROM 'object'
       OR coalesce(v_command_payload ->> 'kind', '') <> 'ENTRY_VOID'
       OR (v_command_payload ->> 'entry') IS DISTINCT FROM p_entry
       OR (v_command_payload ->> 'reason') IS DISTINCT FROM p_reason
       OR (v_command_payload ->> 'requestDigest') IS DISTINCT FROM v_request_digest
       OR (v_command_payload ->> 'correlationId') IS DISTINCT FROM p_correlation_id THEN
      RAISE EXCEPTION 'VOID_APPROVAL_COMMAND_MISMATCH: the pre-registered command is not this exact void submission';
    END IF;

    SELECT ar.state, ar.payload_digest, ar.decided_by, ar.policy_snapshot::jsonb
      INTO v_approval_state, v_approval_digest, v_approval_actor, v_approval_snapshot
    FROM tenant_data.approval_requests ar
    WHERE ar.tenant_id = p_tenant AND ar.command_id = p_void_command_id;
    IF v_approval_state IS DISTINCT FROM 'APPROVED' THEN
      RAISE EXCEPTION 'VOID_APPROVAL_REQUIRED';
    END IF;
    IF v_approval_digest IS DISTINCT FROM v_request_digest THEN
      RAISE EXCEPTION 'VOID_APPROVAL_BINDING_MISMATCH: the approval is bound to a different submission';
    END IF;
    IF v_approval_actor IS NULL OR v_approval_actor = p_actor THEN
      RAISE EXCEPTION 'VOID_APPROVAL_REQUIRED';
    END IF;
    -- Require the exact canonical decision, including entry, request digest, amounts,
    -- currency, policy key/version and ordered role identities. Any policy, role or
    -- amount change after approval makes the approval stale.
    IF v_approval_snapshot IS DISTINCT FROM v_decision THEN
      RAISE EXCEPTION 'VOID_APPROVAL_STALE: the approved decision no longer matches current authority, policy or submission';
    END IF;

    -- Revalidate the approver now: fabricated, revoked, self, out-of-scope or
    -- authority-changed approvers cannot authorise execution.
    v_approval_uuid := tenant_data.immutability_040_approver_authority(
      p_tenant, p_void_command_id, v_approval_actor);
    v_approval_version := (v_approval_snapshot ->> 'policyVersion')::bigint;
    v_approval_command := p_void_command_id;
    v_void_command := p_void_command_id;
  ELSE
    IF p_void_command_id IS NOT NULL THEN
      RAISE EXCEPTION 'VOID_APPROVAL_UNEXPECTED';
    END IF;
    v_void_command := gen_random_uuid()::text;
  END IF;

  -- Supported dependency graph: a plain journal with no linked correction on either end.
  IF EXISTS (SELECT 1 FROM tenant_data.trade_operations WHERE tenant_id = p_tenant AND command_id = p_entry)
     OR EXISTS (SELECT 1 FROM tenant_data.stock_operations WHERE tenant_id = p_tenant AND command_id = p_entry) THEN
    RAISE EXCEPTION 'VOID_DEPENDENCY_UNSUPPORTED';
  END IF;
  IF EXISTS (
    SELECT 1 FROM tenant_data.journal_corrections
    WHERE tenant_id = p_tenant AND (original_id = p_entry OR command_id = p_entry)
  ) OR EXISTS (
    SELECT 1 FROM tenant_data.trade_credits WHERE tenant_id = p_tenant AND original_id = p_entry
  ) THEN
    RAISE EXCEPTION 'VOID_LINKED_CORRECTION';
  END IF;

  v_now_ms := (extract(epoch FROM now()) * 1000)::bigint;
  v_payload := jsonb_build_object(
    'kind', 'ENTRY_VOID',
    'entry', p_entry,
    'reason', p_reason,
    'requestDigest', v_request_digest,
    'decisionDigest', v_decision_digest,
    'correlationId', p_correlation_id
  );

  IF v_approval_command IS NOT NULL THEN
    UPDATE tenant_data.command_inbox
       SET state = 'VOIDED', approved_by = v_approval_actor, updated_at = v_now_ms
     WHERE tenant_id = p_tenant AND id = v_void_command;
  ELSE
    INSERT INTO tenant_data.command_inbox
      (tenant_id, id, actor, digest, payload, state, created_at, updated_at)
    VALUES (p_tenant, v_void_command, p_actor, v_request_digest, v_payload::text,
            'VOIDED', v_now_ms, v_now_ms);
  END IF;

  INSERT INTO tenant_data.audit
    (tenant_id, command_id, actor, event, detail, happened_at)
  VALUES (p_tenant, v_void_command, p_actor, 'ENTRY_VOIDED',
          jsonb_build_object(
            'entry', p_entry,
            'before', jsonb_build_object('included', true, 'state', 'POSTED'),
            'after', jsonb_build_object('included', false, 'state', 'VOIDED'),
            'effect', 'remove_all_lines_from_active_ledger',
            'lines', v_line_count, 'debit', v_debit, 'credit', v_credit,
            'reason', p_reason,
            'requestDigest', v_request_digest,
            'decisionDigest', v_decision_digest,
            'policyVersion', v_policy_version
          )::text,
          v_now_ms);

  INSERT INTO tenant_data.audit_event
    (tenant_id, actor_id, event, entity_type, entity_id, detail_jsonb, origin_type, origin_user_id, request_id)
  VALUES (p_tenant, p_actor, 'ENTRY_VOIDED', 'journal', p_entry,
          jsonb_build_object(
            'before', jsonb_build_object('included', true, 'state', 'POSTED'),
            'after', jsonb_build_object('included', false, 'state', 'VOIDED'),
            'reason', p_reason, 'lines', v_line_count, 'debit', v_debit, 'credit', v_credit,
            'periodLocked', v_period_locked, 'requestDigest', v_request_digest,
            'decisionDigest', v_decision_digest, 'policyVersion', v_policy_version
          ),
          'human', p_actor, p_correlation_id);

  INSERT INTO tenant_data.outbox (tenant_id, id, event, state, attempts)
  VALUES (p_tenant, v_void_command, 'ENTRY_VOIDED', 'READY', 0);

  INSERT INTO tenant_data.entry_voids
    (tenant_id, void_command_id, entry_id, reason, actor, actor_uuid,
     original_state, effective_state, source_digest, source_version, source_line_count,
     source_debit, request_digest, idempotency_key, policy_decision, policy_digest,
     approval_command_id, approver_actor, approval_digest, correlation_id, policy_version,
     approval_version, period_locked)
  VALUES (p_tenant, v_void_command, p_entry, p_reason, p_actor, tenant_data.current_user_id(),
          'POSTED', 'VOIDED', v_source_digest, v_source_version, v_line_count,
          v_debit::bigint, v_request_digest, p_idempotency_key, v_decision, v_decision_digest,
          v_approval_command, v_approval_actor, CASE WHEN v_approval_command IS NULL THEN NULL ELSE v_decision_digest END,
          p_correlation_id, v_policy_version, v_approval_version, v_period_locked);

  RETURN v_void_command;
END;
$fn$;

COMMENT ON FUNCTION tenant_data.void_posted_entry(uuid, text, text, text, text, text, text) IS
  'PIVOT-005: single audited atomic terminal-void primitive. Rechecks verified context, actor mapping, canonical permission/policy decision, posted state, locked periods and the supported dependency graph under the shared command lock; writes receipt, native audit, change audit, outbox and the append-only void record in one transaction.';

-- =====================================================================
-- 7. Payload 042 guards (attached by the activation step in 40-triggers.sql)
-- =====================================================================

CREATE FUNCTION tenant_data.immutability_042_void_guard()
RETURNS trigger LANGUAGE plpgsql
SET search_path = pg_catalog, tenant_data
AS $fn$
DECLARE
  v_receipt_state text;
  v_receipt_digest text;
  v_receipt_entry text;
  v_receipt_kind text;
  v_receipt_approver text;
  v_posted text;
  v_voids integer;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'VOID_RETAINED: void records are append-only and cannot be removed';
  END IF;
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'VOIDED_IMMUTABLE: a void record cannot be edited, unvoided or repeated';
  END IF;

  -- Serialize against the source command writers while the bundle is validated.
  PERFORM pg_advisory_xact_lock(tenant_data.immutability_040_lock_key(NEW.tenant_id, NEW.entry_id));

  SELECT c.state, (c.payload::jsonb) #>> '{requestDigest}', (c.payload::jsonb) #>> '{entry}',
         (c.payload::jsonb) #>> '{kind}', c.approved_by
    INTO v_receipt_state, v_receipt_digest, v_receipt_entry, v_receipt_kind, v_receipt_approver
  FROM tenant_data.command_inbox c
  WHERE c.tenant_id = NEW.tenant_id AND c.id = NEW.void_command_id;
  IF v_receipt_state IS DISTINCT FROM 'VOIDED'
     OR v_receipt_digest IS DISTINCT FROM NEW.request_digest
     OR v_receipt_entry IS DISTINCT FROM NEW.entry_id
     OR v_receipt_kind IS DISTINCT FROM 'ENTRY_VOID' THEN
    RAISE EXCEPTION 'VOID_RECEIPT_INVALID: the void record must match its VOIDED void-command receipt';
  END IF;

  IF NEW.approval_command_id IS NOT NULL THEN
    IF v_receipt_approver IS DISTINCT FROM NEW.approver_actor THEN
      RAISE EXCEPTION 'VOID_RECEIPT_INVALID: the approved receipt must record the same approver';
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM tenant_data.approval_requests ar
      WHERE ar.tenant_id = NEW.tenant_id AND ar.command_id = NEW.approval_command_id
        AND ar.state = 'APPROVED' AND ar.decided_by = NEW.approver_actor
        AND ar.payload_digest = NEW.request_digest
    ) THEN
      RAISE EXCEPTION 'VOID_APPROVAL_REQUIRED: the void record must reference its exact approved request';
    END IF;
  END IF;

  SELECT c.state INTO v_posted
  FROM tenant_data.command_inbox c
  WHERE c.tenant_id = NEW.tenant_id AND c.id = NEW.entry_id;
  IF v_posted IS DISTINCT FROM 'POSTED' THEN
    RAISE EXCEPTION 'VOID_ENTRY_NOT_POSTED: only a posted entry can be voided';
  END IF;

  SELECT count(*) INTO v_voids FROM tenant_data.entry_voids v
  WHERE v.tenant_id = NEW.tenant_id AND v.entry_id = NEW.entry_id;
  IF v_voids > 0 THEN
    RAISE EXCEPTION 'ENTRY_ALREADY_VOIDED';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM tenant_data.audit a
    WHERE a.tenant_id = NEW.tenant_id AND a.command_id = NEW.void_command_id AND a.event = 'ENTRY_VOIDED'
  ) THEN
    RAISE EXCEPTION 'VOID_REQUIRES_AUDIT: the void audit row must be written in the same transaction';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM tenant_data.outbox o
    WHERE o.tenant_id = NEW.tenant_id AND o.id = NEW.void_command_id
  ) THEN
    RAISE EXCEPTION 'VOID_REQUIRES_OUTBOX: the void outbox row must be written in the same transaction';
  END IF;

  RETURN NEW;
END;
$fn$;

CREATE FUNCTION tenant_data.immutability_042_receipt_guard()
RETURNS trigger LANGUAGE plpgsql
SET search_path = pg_catalog, tenant_data
AS $fn$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'VOID_RECEIPT_RETAINED: terminal receipts are retained';
  END IF;
  IF OLD.state = 'VOIDED' THEN
    RAISE EXCEPTION 'VOID_RECEIPT_IMMUTABLE: a VOIDED receipt is final';
  END IF;
  RETURN NEW;
END;
$fn$;

CREATE FUNCTION tenant_data.immutability_042_denial_guard()
RETURNS trigger LANGUAGE plpgsql
SET search_path = pg_catalog, tenant_data
AS $fn$
DECLARE
  v_actor text;
BEGIN
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION 'VOID_DENIAL_RETAINED: denial records are append-only';
  END IF;
  -- Bind the recorded actor to verified transaction context; caller-supplied actor
  -- values are never trusted as security evidence.
  IF tenant_data.current_tenant_id() IS NULL OR tenant_data.current_user_id() IS NULL THEN
    RAISE EXCEPTION 'VOID_DENIAL_CONTEXT_REQUIRED';
  END IF;
  SELECT m.user_id INTO v_actor
  FROM tenant_data.members m
  WHERE m.tenant_id = NEW.tenant_id
    AND m.user_uuid = tenant_data.current_user_id() AND m.active;
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'VOID_DENIAL_CONTEXT_REQUIRED';
  END IF;
  NEW.actor := v_actor;
  NEW.actor_uuid := tenant_data.current_user_id();
  IF NEW.attempted_at IS NULL THEN
    NEW.attempted_at := now();
  END IF;
  RETURN NEW;
END;
$fn$;

CREATE FUNCTION tenant_data.immutability_042_void_audit_guard()
RETURNS trigger LANGUAGE plpgsql
SET search_path = pg_catalog, tenant_data
AS $fn$
BEGIN
  IF OLD.event = 'ENTRY_VOIDED' THEN
    RAISE EXCEPTION 'VOID_AUDIT_IMMUTABLE: void audit rows are retained and immutable';
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$fn$;

COMMENT ON FUNCTION tenant_data.immutability_042_void_guard() IS
  'PIVOT-005 payload 042: append-only void record; validates receipt, request digest, posted source, unique void and the atomic audit/outbox bundle under the shared command lock.';
COMMENT ON FUNCTION tenant_data.immutability_042_denial_guard() IS
  'PIVOT-005 payload 042: append-only denial log that overwrites actor fields from verified transaction context.';

-- =====================================================================
-- 8. Enumerated minimum privileges for the void owner (no runtime grants here)
-- =====================================================================

GRANT USAGE ON SCHEMA tenant_data TO saven_void_definer;

GRANT SELECT (tenant_id, id, company, branch, posting_date) ON tenant_data.journals TO saven_void_definer;
GRANT SELECT (tenant_id, id, currency) ON tenant_data.company_profiles TO saven_void_definer;
GRANT SELECT (tenant_id, journal_id, line_no, debit, credit, account) ON tenant_data.journal_lines TO saven_void_definer;
GRANT SELECT (tenant_id, id, actor, state, digest, payload, updated_at, approved_by) ON tenant_data.command_inbox TO saven_void_definer;
GRANT SELECT (tenant_id, void_command_id, entry_id, idempotency_key, request_digest) ON tenant_data.entry_voids TO saven_void_definer;
GRANT SELECT (tenant_id, user_id, user_uuid, active) ON tenant_data.members TO saven_void_definer;
GRANT SELECT (tenant_id, id, protected, permissions) ON tenant_data.roles TO saven_void_definer;
GRANT SELECT (tenant_id, user_id, role_id) ON tenant_data.assignments TO saven_void_definer;
GRANT SELECT (tenant_id, user_id, action) ON tenant_data.denials TO saven_void_definer;
GRANT SELECT (tenant_id, company, start_date, end_date, locked) ON tenant_data.periods TO saven_void_definer;
GRANT SELECT (tenant_id, command_id, payload_digest, policy_snapshot, state, decided_by) ON tenant_data.approval_requests TO saven_void_definer;
GRANT SELECT (tenant_id, action_type, policy_key, version, role_id, approval_threshold_amount, currency, requires_different_approver, is_active, effective_from, effective_to) ON tenant_data.approval_policy TO saven_void_definer;
GRANT SELECT (tenant_id, command_id) ON tenant_data.trade_operations TO saven_void_definer;
GRANT SELECT (tenant_id, command_id) ON tenant_data.command_decisions TO saven_void_definer;
GRANT SELECT (tenant_id, command_id) ON tenant_data.stock_operations TO saven_void_definer;
GRANT SELECT (tenant_id, command_id, original_id) ON tenant_data.journal_corrections TO saven_void_definer;
GRANT SELECT (tenant_id, original_id) ON tenant_data.trade_credits TO saven_void_definer;
GRANT SELECT (tenant_id, command_id, event) ON tenant_data.audit TO saven_void_definer;
GRANT SELECT (tenant_id, id) ON tenant_data.outbox TO saven_void_definer;

GRANT INSERT (tenant_id, id, actor, digest, payload, state, created_at, updated_at, approved_by)
  ON tenant_data.command_inbox TO saven_void_definer;
GRANT UPDATE (state, approved_by, updated_at) ON tenant_data.command_inbox TO saven_void_definer;
GRANT INSERT (tenant_id, void_command_id, entry_id, reason, actor, actor_uuid, original_state,
              effective_state, source_digest, source_version, source_line_count, source_debit,
              request_digest, idempotency_key, policy_decision, policy_digest, approval_command_id,
              approver_actor, approval_digest, correlation_id, policy_version, approval_version,
              period_locked, voided_at, created_at, updated_at)
  ON tenant_data.entry_voids TO saven_void_definer;
GRANT INSERT (tenant_id, command_id, actor, event, detail, happened_at)
  ON tenant_data.audit TO saven_void_definer;
GRANT INSERT (tenant_id, actor_id, event, entity_type, entity_id, detail_jsonb, origin_type, origin_user_id, request_id)
  ON tenant_data.audit_event TO saven_void_definer;
GRANT INSERT (tenant_id, id, event, state, attempts)
  ON tenant_data.outbox TO saven_void_definer;

GRANT EXECUTE ON FUNCTION tenant_data.immutability_040_lock_key(uuid, text) TO saven_void_definer;
GRANT EXECUTE ON FUNCTION tenant_data.immutability_040_approver_authority(uuid, text, text) TO saven_void_definer;
GRANT EXECUTE ON FUNCTION tenant_data.immutability_040_approval_resource(uuid, text) TO saven_void_definer;
GRANT EXECUTE ON FUNCTION tenant_data.immutability_042_policy_decision(uuid, text, bigint, text, text, text[], text, text) TO saven_void_definer;
GRANT EXECUTE ON FUNCTION tenant_data.immutability_042_decision_digest(jsonb) TO saven_void_definer;
GRANT EXECUTE ON FUNCTION tenant_data.current_tenant_id() TO saven_void_definer;
GRANT EXECUTE ON FUNCTION tenant_data.current_user_id() TO saven_void_definer;

COMMENT ON FUNCTION tenant_data.immutability_042_receipt_guard() IS
  'PIVOT-005 payload 042: a VOIDED command receipt is final and retained.';

-- =====================================================================
-- 9. Validate the void owner's complete authority, then transfer the primitive
--    (no silent repair: unexpected authority refuses and rolls back)
-- =====================================================================

CREATE FUNCTION pg_temp.saven_assert_void_owner() RETURNS void
LANGUAGE plpgsql AS $fn$
DECLARE
  v_owner oid := (SELECT oid FROM pg_roles WHERE rolname = 'saven_void_definer');
  v_fn oid;
  v_flags text;
  v_bad text;
  allowed_schemas text[] := ARRAY['tenant_data:USAGE'];
  allowed_columns text[] := ARRAY[
    'tenant_data.journals.tenant_id:SELECT','tenant_data.journals.id:SELECT','tenant_data.journals.company:SELECT',
    'tenant_data.journals.branch:SELECT','tenant_data.journals.posting_date:SELECT',
    'tenant_data.company_profiles.tenant_id:SELECT','tenant_data.company_profiles.id:SELECT',
    'tenant_data.company_profiles.currency:SELECT',
    'tenant_data.journal_lines.tenant_id:SELECT','tenant_data.journal_lines.journal_id:SELECT',
    'tenant_data.journal_lines.line_no:SELECT','tenant_data.journal_lines.debit:SELECT',
    'tenant_data.journal_lines.credit:SELECT','tenant_data.journal_lines.account:SELECT',
    'tenant_data.command_inbox.tenant_id:SELECT','tenant_data.command_inbox.id:SELECT',
    'tenant_data.command_inbox.actor:SELECT','tenant_data.command_inbox.state:SELECT',
    'tenant_data.command_inbox.digest:SELECT','tenant_data.command_inbox.payload:SELECT',
    'tenant_data.command_inbox.updated_at:SELECT','tenant_data.command_inbox.approved_by:SELECT',
    'tenant_data.command_inbox.id:INSERT','tenant_data.command_inbox.tenant_id:INSERT',
    'tenant_data.command_inbox.actor:INSERT','tenant_data.command_inbox.digest:INSERT',
    'tenant_data.command_inbox.payload:INSERT','tenant_data.command_inbox.state:INSERT',
    'tenant_data.command_inbox.created_at:INSERT','tenant_data.command_inbox.updated_at:INSERT',
    'tenant_data.command_inbox.approved_by:INSERT',
    'tenant_data.command_inbox.state:UPDATE','tenant_data.command_inbox.approved_by:UPDATE',
    'tenant_data.command_inbox.updated_at:UPDATE',
    'tenant_data.entry_voids.tenant_id:SELECT','tenant_data.entry_voids.void_command_id:SELECT',
    'tenant_data.entry_voids.entry_id:SELECT','tenant_data.entry_voids.idempotency_key:SELECT',
    'tenant_data.entry_voids.request_digest:SELECT',
    'tenant_data.entry_voids.tenant_id:INSERT','tenant_data.entry_voids.void_command_id:INSERT',
    'tenant_data.entry_voids.entry_id:INSERT','tenant_data.entry_voids.reason:INSERT',
    'tenant_data.entry_voids.actor:INSERT','tenant_data.entry_voids.actor_uuid:INSERT',
    'tenant_data.entry_voids.original_state:INSERT','tenant_data.entry_voids.effective_state:INSERT',
    'tenant_data.entry_voids.source_digest:INSERT','tenant_data.entry_voids.source_version:INSERT',
    'tenant_data.entry_voids.source_line_count:INSERT','tenant_data.entry_voids.source_debit:INSERT',
    'tenant_data.entry_voids.request_digest:INSERT','tenant_data.entry_voids.idempotency_key:INSERT',
    'tenant_data.entry_voids.policy_decision:INSERT','tenant_data.entry_voids.policy_digest:INSERT',
    'tenant_data.entry_voids.approval_command_id:INSERT','tenant_data.entry_voids.approver_actor:INSERT',
    'tenant_data.entry_voids.approval_digest:INSERT','tenant_data.entry_voids.correlation_id:INSERT',
    'tenant_data.entry_voids.policy_version:INSERT','tenant_data.entry_voids.approval_version:INSERT',
    'tenant_data.entry_voids.period_locked:INSERT','tenant_data.entry_voids.voided_at:INSERT',
    'tenant_data.entry_voids.created_at:INSERT','tenant_data.entry_voids.updated_at:INSERT',
    'tenant_data.members.tenant_id:SELECT','tenant_data.members.user_id:SELECT',
    'tenant_data.members.user_uuid:SELECT','tenant_data.members.active:SELECT',
    'tenant_data.roles.tenant_id:SELECT','tenant_data.roles.id:SELECT',
    'tenant_data.roles.protected:SELECT','tenant_data.roles.permissions:SELECT',
    'tenant_data.assignments.tenant_id:SELECT','tenant_data.assignments.user_id:SELECT',
    'tenant_data.assignments.role_id:SELECT',
    'tenant_data.denials.tenant_id:SELECT','tenant_data.denials.user_id:SELECT','tenant_data.denials.action:SELECT',
    'tenant_data.periods.tenant_id:SELECT','tenant_data.periods.company:SELECT',
    'tenant_data.periods.start_date:SELECT','tenant_data.periods.end_date:SELECT','tenant_data.periods.locked:SELECT',
    'tenant_data.approval_requests.tenant_id:SELECT','tenant_data.approval_requests.command_id:SELECT',
    'tenant_data.approval_requests.payload_digest:SELECT','tenant_data.approval_requests.policy_snapshot:SELECT',
    'tenant_data.approval_requests.state:SELECT','tenant_data.approval_requests.decided_by:SELECT',
    'tenant_data.approval_policy.tenant_id:SELECT','tenant_data.approval_policy.action_type:SELECT',
    'tenant_data.approval_policy.policy_key:SELECT','tenant_data.approval_policy.version:SELECT',
    'tenant_data.approval_policy.role_id:SELECT',
    'tenant_data.approval_policy.approval_threshold_amount:SELECT',
    'tenant_data.approval_policy.currency:SELECT',
    'tenant_data.approval_policy.requires_different_approver:SELECT',
    'tenant_data.approval_policy.is_active:SELECT','tenant_data.approval_policy.effective_from:SELECT',
    'tenant_data.approval_policy.effective_to:SELECT',
    'tenant_data.trade_operations.tenant_id:SELECT','tenant_data.trade_operations.command_id:SELECT',
    'tenant_data.command_decisions.tenant_id:SELECT','tenant_data.command_decisions.command_id:SELECT',
    'tenant_data.stock_operations.tenant_id:SELECT','tenant_data.stock_operations.command_id:SELECT',
    'tenant_data.journal_corrections.tenant_id:SELECT','tenant_data.journal_corrections.command_id:SELECT',
    'tenant_data.journal_corrections.original_id:SELECT',
    'tenant_data.trade_credits.tenant_id:SELECT','tenant_data.trade_credits.original_id:SELECT',
    'tenant_data.audit.tenant_id:SELECT','tenant_data.audit.command_id:SELECT','tenant_data.audit.event:SELECT',
    'tenant_data.audit.tenant_id:INSERT','tenant_data.audit.command_id:INSERT','tenant_data.audit.actor:INSERT',
    'tenant_data.audit.event:INSERT','tenant_data.audit.detail:INSERT','tenant_data.audit.happened_at:INSERT',
    'tenant_data.audit_event.tenant_id:INSERT','tenant_data.audit_event.actor_id:INSERT',
    'tenant_data.audit_event.event:INSERT','tenant_data.audit_event.entity_type:INSERT',
    'tenant_data.audit_event.entity_id:INSERT','tenant_data.audit_event.detail_jsonb:INSERT',
    'tenant_data.audit_event.origin_type:INSERT','tenant_data.audit_event.origin_user_id:INSERT',
    'tenant_data.audit_event.request_id:INSERT',
    'tenant_data.outbox.tenant_id:SELECT','tenant_data.outbox.id:SELECT',
    'tenant_data.outbox.tenant_id:INSERT','tenant_data.outbox.id:INSERT','tenant_data.outbox.event:INSERT',
    'tenant_data.outbox.state:INSERT','tenant_data.outbox.attempts:INSERT'
  ];
  allowed_functions text[] := ARRAY[
    'tenant_data.current_tenant_id:EXECUTE','tenant_data.current_user_id:EXECUTE',
    'tenant_data.session_admitted:EXECUTE','tenant_data.immutability_040_lock_key:EXECUTE',
    'tenant_data.immutability_040_approver_authority:EXECUTE',
    'tenant_data.immutability_040_approval_resource:EXECUTE',
    'tenant_data.immutability_042_policy_decision:EXECUTE','tenant_data.immutability_042_decision_digest:EXECUTE'
  ];
  actual text[];
BEGIN
  IF v_owner IS NULL THEN RAISE EXCEPTION 'R5-AUTHORITY: void owner role is missing'; END IF;
  SELECT p.oid INTO v_fn FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'tenant_data' AND p.proname = 'void_posted_entry' AND p.proowner = v_owner;
  IF v_fn IS NULL THEN RAISE EXCEPTION 'R5-AUTHORITY: void primitive is missing or not owned by the dedicated owner'; END IF;

  SELECT string_agg(flag, ', ') INTO v_flags FROM pg_roles r, LATERAL (VALUES
    ('LOGIN', r.rolcanlogin), ('SUPERUSER', r.rolsuper), ('CREATEDB', r.rolcreatedb),
    ('CREATEROLE', r.rolcreaterole), ('INHERIT', r.rolinherit),
    ('BYPASSRLS', r.rolbypassrls), ('REPLICATION', r.rolreplication)) v(flag, present)
  WHERE r.oid = v_owner AND v.present;
  IF v_flags IS NOT NULL THEN RAISE EXCEPTION 'R5-AUTHORITY: void owner has forbidden attributes: %', v_flags; END IF;

  SELECT string_agg(format('%s -> %s', m.rolname, g.rolname), ', ') INTO v_bad
  FROM pg_auth_members am JOIN pg_roles m ON m.oid = am.member JOIN pg_roles g ON g.oid = am.roleid
  WHERE m.oid = v_owner OR g.oid = v_owner;
  IF v_bad IS NOT NULL THEN RAISE EXCEPTION 'R5-AUTHORITY: void owner has role memberships: %', v_bad; END IF;

  SELECT string_agg(r.rolname, ', ') INTO v_bad FROM pg_roles r
  WHERE r.oid <> v_owner AND r.rolname NOT LIKE 'pg\_%' AND pg_has_role(v_owner, r.oid, 'MEMBER');
  IF v_bad IS NOT NULL THEN RAISE EXCEPTION 'R5-AUTHORITY: void owner holds privileges of: %', v_bad; END IF;

  SELECT string_agg(r.rolname, ', ') INTO v_bad FROM pg_roles r
  WHERE r.oid <> v_owner AND r.rolname LIKE 'saven\_%' AND NOT r.rolsuper
    AND pg_has_role(r.oid, v_owner, 'MEMBER');
  IF v_bad IS NOT NULL THEN RAISE EXCEPTION 'R5-AUTHORITY: a SAVEN principal can assume the void owner: %', v_bad; END IF;

  SELECT string_agg(n.nspname || '.' || c.relname, ', ') INTO v_bad
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE c.relowner = v_owner;
  IF v_bad IS NOT NULL THEN RAISE EXCEPTION 'R5-AUTHORITY: void owner owns relations: %', v_bad; END IF;

  SELECT string_agg(n.nspname, ', ') INTO v_bad FROM pg_namespace n WHERE n.nspowner = v_owner;
  IF v_bad IS NOT NULL THEN RAISE EXCEPTION 'R5-AUTHORITY: void owner owns schemas: %', v_bad; END IF;

  SELECT string_agg(n.nspname || '.' || p.proname, ', ') INTO v_bad
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE p.proowner = v_owner AND p.oid <> v_fn;
  IF v_bad IS NOT NULL THEN RAISE EXCEPTION 'R5-AUTHORITY: void owner owns other functions: %', v_bad; END IF;

  SELECT string_agg(datname, ', ') INTO v_bad FROM pg_database WHERE datdba = v_owner;
  IF v_bad IS NOT NULL THEN RAISE EXCEPTION 'R5-AUTHORITY: void owner owns databases: %', v_bad; END IF;

  SELECT string_agg(spcname, ', ') INTO v_bad FROM pg_tablespace WHERE spcowner = v_owner;
  IF v_bad IS NOT NULL THEN RAISE EXCEPTION 'R5-AUTHORITY: void owner owns tablespaces: %', v_bad; END IF;

  SELECT coalesce(array_agg(n.nspname || ':' || x.privilege_type ORDER BY 1), ARRAY[]::text[]) INTO actual
  FROM pg_namespace n CROSS JOIN aclexplode(n.nspacl) x
  WHERE x.grantee = v_owner AND n.nspname NOT LIKE 'pg\_%' AND n.nspname <> 'information_schema';
  IF (SELECT array_agg(v ORDER BY v) FROM unnest(actual) v)
     IS DISTINCT FROM (SELECT array_agg(v ORDER BY v) FROM unnest(allowed_schemas) v) THEN
    RAISE EXCEPTION 'R5-AUTHORITY: void owner schema privileges differ from the allow-list; found %', actual;
  END IF;

  SELECT string_agg(n.nspname, ', ') INTO v_bad FROM pg_namespace n
  WHERE n.nspname NOT LIKE 'pg\_%' AND n.nspname <> 'information_schema'
    AND has_schema_privilege(v_owner, n.oid, 'CREATE');
  IF v_bad IS NOT NULL THEN RAISE EXCEPTION 'R5-AUTHORITY: void owner may CREATE in: %', v_bad; END IF;

  IF has_schema_privilege(v_owner, 'operator', 'USAGE') THEN
    RAISE EXCEPTION 'R5-AUTHORITY: void owner may USAGE the operator schema';
  END IF;

  SELECT string_agg(n.nspname || '.' || c.relname || ':' || x.privilege_type, ', ') INTO v_bad
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
  CROSS JOIN aclexplode(c.relacl) x WHERE x.grantee = v_owner;
  IF v_bad IS NOT NULL THEN RAISE EXCEPTION 'R5-AUTHORITY: void owner holds table/sequence-level privileges: %', v_bad; END IF;

  SELECT coalesce(array_agg(n.nspname || '.' || c.relname || '.' || a.attname || ':' || x.privilege_type ORDER BY 1), ARRAY[]::text[])
    INTO actual
  FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid JOIN pg_namespace n ON n.oid = c.relnamespace
  CROSS JOIN aclexplode(a.attacl) x
  WHERE x.grantee = v_owner AND a.attnum > 0;
  IF (SELECT array_agg(v ORDER BY v) FROM unnest(actual) v)
     IS DISTINCT FROM (SELECT array_agg(v ORDER BY v) FROM unnest(allowed_columns) v) THEN
    RAISE EXCEPTION 'R5-AUTHORITY: void owner column privileges differ from the allow-list; found %', actual;
  END IF;

  SELECT coalesce(array_agg(n.nspname || '.' || p.proname || ':' || x.privilege_type ORDER BY 1), ARRAY[]::text[])
    INTO actual
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace CROSS JOIN aclexplode(p.proacl) x
  WHERE x.grantee = v_owner;
  IF (SELECT array_agg(v ORDER BY v) FROM unnest(actual) v)
     IS DISTINCT FROM (
       SELECT array_agg(v ORDER BY v) FROM unnest(
         allowed_functions || ARRAY['tenant_data.void_posted_entry:EXECUTE']) v) THEN
    RAISE EXCEPTION 'R5-AUTHORITY: void owner function privileges differ from the allow-list; found %', actual;
  END IF;

  SELECT string_agg(format('%s:%s', d.defaclobjtype, x.privilege_type), ', ') INTO v_bad
  FROM pg_default_acl d CROSS JOIN aclexplode(d.defaclacl) x WHERE x.grantee = v_owner;
  IF v_bad IS NOT NULL THEN RAISE EXCEPTION 'R5-AUTHORITY: void owner is named in default privileges: %', v_bad; END IF;
END;
$fn$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_roles r
    WHERE r.rolname = 'saven_void_definer'
      AND r.rolcanlogin = false AND r.rolsuper = false AND r.rolcreatedb = false
      AND r.rolcreaterole = false AND r.rolinherit = false AND r.rolbypassrls = false
      AND r.rolreplication = false
  ) THEN
    RAISE EXCEPTION 'PIVOT-005: void owner must remain a constrained NOLOGIN role';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'tenant_data' AND c.relname LIKE '%eligib%'
  ) THEN
    RAISE EXCEPTION 'PIVOT-005: role-agnostic correction forbids eligibility objects';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'tenant_data' AND c.relname IN ('entry_voids', 'void_denials')
      AND c.relrowsecurity AND c.relforcerowsecurity
  ) THEN
    RAISE EXCEPTION 'PIVOT-005: new tables must be forced and isolated';
  END IF;
END $$;

RESET ROLE;

-- session_admitted() is owned by the admission definer, so only the administrator may
-- grant EXECUTE on it to another principal.
GRANT EXECUTE ON FUNCTION tenant_data.session_admitted(uuid, uuid) TO saven_void_definer;

ALTER FUNCTION tenant_data.void_posted_entry(uuid, text, text, text, text, text, text)
  OWNER TO saven_void_definer;

REVOKE ALL ON FUNCTION tenant_data.void_posted_entry(uuid, text, text, text, text, text, text) FROM PUBLIC;

SELECT pg_temp.saven_assert_void_owner();

DROP FUNCTION pg_temp.saven_assert_void_owner();

COMMIT;
