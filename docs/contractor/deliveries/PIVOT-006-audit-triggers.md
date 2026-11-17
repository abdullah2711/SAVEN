CONTRACT: docs/contractor/contracts/PIVOT-006-audit-triggers.md
STATUS: DONE (R1 revision: database audit payload and mechanism evidence; application/UI/RBAC and AUTH-006 acceptance remain limits below)

## Identity

- Branch: `opencode/pivot-006-audit`.
- Worktree: `/home/esc/saven/wt-pivot-006`.
- Base: `testing-1 @ 32fef2beac91a73b2c8a5ae9c150603736993e97`.
- Previously reviewed head: `3c40839c5a2c4ba547bd4abcdf8af022b3f9c281`.
- Implementation commit: `12732d3d1210a98fe446078d5a2b359a7a302553`
  (`db: bound audit authority, native actors, serialization and provenance
  [contract:PIVOT-006]`).
- Report commit: the commit that carries this file; pushed on the same branch.
- Not merged. No other branch, main, production path or applied 040/042 payload byte was changed.

## What was delivered

### 041 audited payload — `db/postgres/migrations/041-audit.sql`

- Applied by the **separate offline administrator (superuser)** because it provisions a
  dedicated NOLOGIN role and transfers function ownership.
- Provisions `saven_audit_definer`:
  `NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS NOREPLICATION`.
- Owns only the reviewed audit-writing/actor-binding functions:
  `immutability_041_row_key`, `immutability_041_serialize`,
  `immutability_041_audit_origin`, `immutability_041_audit_row`,
  `immutability_041_audit_native_guard`.
- Exact grants only:
  `tenant_data` USAGE; `members` (`tenant_id`,`user_id`,`user_uuid`) SELECT;
  `reference_values` (`tenant_id`,`domain`,`value`,`is_active`) SELECT;
  enumerated `audit_event` column INSERT; `audit_event_id_seq` USAGE;
  `current_tenant_id()`, `current_user_id()`, `session_admitted(uuid,uuid)` EXECUTE.
- No business-table write, table/schema CREATE, relation/schema/database/tablespace
  ownership, broad auth/operator read, runtime membership, public/direct runtime
  evidence-write interface, default privilege, or superuser/BYPASSRLS.
- Install validates attributes, memberships, ownership, schema/table/sequence/column/
  function ACLs, default privileges and exact function `SECURITY DEFINER`/`search_path`
  configuration. A polluted pre-existing role is refused and left untouched.
- `immutability_041_audit_row()` records a tenant change in `tenant_data.audit_event`
  in the same transaction as the business mutation. It resolves the acting tenant and
  canonical actor only from transaction context plus `members`, requires
  `session_admitted`, derives the target identity from the catalog primary key, and
  records action, target, before/after, serialization version, transaction id, row
  version, provenance marker and time.
- `immutability_041_audit_native_guard()` binds **prospective** native
  `tenant_data.audit` INSERT rows to the same admitted tenant/actor. Historical ids,
  bytes, timestamps, counts and native command semantics are not rewritten, mirrored or
  back-filled.
- `immutability_041_audit_append_guard()` / `..._truncate_guard()` deny audit storage
  UPDATE/DELETE/TRUNCATE. They are owned by the migration role, not the audit owner.

### Serialization contract (version 1)

- `immutability_041_serialize(regclass, jsonb)` is the versioned audit boundary.
- Structured scalar columns and reviewed business text are retained.
- JSONB and unreviewed text are replaced by
  `{redacted:true,type,sha256}` and named in `redactedColumns`.
- An unreviewed column type raises `AUDIT_SERIALIZATION_UNSUPPORTED` and rolls the
  business mutation back.
- This is a sidecar redaction boundary, not a claim that arbitrary free text typed into
  a reviewed business field can be made secret-free. Original financial/source bytes
  are untouched.
- The reviewed text allow-list covers identifiers, codes, company/branch, accounts,
  jurisdiction/reference values, dates, states, narrative/description/reason,
  origin metadata, document metadata and similar business fields. Payload/config/rule/
  policy/permission/expected JSON or text is redacted.

### Provenance contract

- Explicit document/proposal origin columns (`document_registry`,
  `document_revisions`) are validated against active canonical `origin_type`
  `reference_values` rows.
- AI requires `origin_model` and a tenant-member proposer; model/version are retained.
- Human cannot name a model and falls back to the verified actor only when
  `origin_user_id` is blank.
- Integration requires an identity or model.
- Generic tables with no explicit origin record genuinely unavailable provenance as
  `origin_type='system'`, `origin_user_id=NULL` and
  `detail_jsonb.provenance='unavailable'`. The verified acting principal remains
  `actor_id`. A client GUC cannot manufacture document/proposal origin.
- Missing reference rows, invalid values, missing AI model, unmapped human/AI proposer
  or a human row naming a model raise `AUDIT_PROVENANCE_INVALID` and roll back.

### Dispatcher — `db/postgres/40-triggers.sql`

- Explicitly registers 041 alongside 040/042 and retains every prior binding.
- Attaches the 041 audit writer to the reviewed 42-table business list and native-insert
  + append + TRUNCATE guards to audit storage.
- Validates the dedicated audit owner's attributes, exact writer/native-guard ownership
  and exact fixed `search_path`; rejects runtime direct audit-write/update/delete/
  truncate privilege and direct audit-writer EXECUTE.
- Installed-but-unregistered payloads and partial named 041 functions fail closed.
- Re-running the dispatcher is idempotent; it never reapplies a payload.
- 041 remains optional for a 040/042-only PIVOT-005 installation so the already-merged
  PIVOT-005 gate is not broken. That mode is explicitly **not** PIVOT-006 audit
  coverage. PIVOT-006 acceptance requires 041 and the dispatcher validation above.

### Tests — `tests/pivot-006-audit.test.mjs`

- Actor-bound INSERT/UPDATE/DELETE, before/after/target, actor spoof through
  `created_by`/`updated_by`, missing context, spoofed tenant/user.
- Native audit insert: admitted actor success, spoofed/invented actor refusal, missing
  context refusal, transaction rollback, and the PIVOT-005 void-definer path.
- Injected audit INSERT failure rolls the business mutation back; concurrent events
  retain distinct rows.
- Tenant-scoped read visibility; runtime and administrative UPDATE/DELETE/TRUNCATE
  denial; native audit preservation; no recursive audit rows.
- Dedicated audit owner positive authority surface and six polluted-owner negatives
  (extra table ACL, schema CREATE, membership, relation ownership, function ownership,
  default privilege), including untouched role/grant preservation.
- Secret-leak negatives across INSERT/UPDATE/DELETE for JSONB and text payloads, safe
  business-value positives, and an unsupported `bytea` column fail-closed.
- Human/AI/integration provenance positives; AI/human/invalid-origin spoof negatives;
  generic GUC-spoof negative.
- Dispatcher registration/re-run/refusal, exact 040/042 bindings retained, 041
  re-application refusal.
- Failed, partial and interrupted activation; no partial audit trigger set; explicit
  041-without-dispatcher unaudited window and quiescence requirement.
- Static contract for payload, dispatcher, README and no runtime audit grants.

## Covered audited tables

`account_profiles`, `accounts`, `approval_policy`, `approval_requests`, `assignments`,
`business`, `business_rule`, `command_decisions`, `command_files`, `company_profiles`,
`company_settings`, `denials`, `document_numbers`, `document_registry`,
`document_revisions`, `document_sequences`, `inventory_controls`,
`journal_corrections`, `journal_drafts`, `journal_lines`, `journals`, `members`,
`periods`, `posting_constraint`, `reference_values`, `roles`, `stock_balances`,
`stock_items`, `stock_movements`, `stock_operations`, `support_grants`, `tax_profile`,
`trade_allocations`, `trade_controls`, `trade_credit_lines`, `trade_credits`,
`trade_documents`, `trade_lines`, `trade_operations`, `trade_parties`,
`verified_entitlement`, `warehouses`.

## Explicit exclusions

- `audit`, `audit_event`: append-only/actor-bound guards, never re-audited (no recursion).
- `command_inbox`, `outbox`: command delivery/lifecycle infrastructure; native recorded
  command events remain authoritative.
- `source_store_migrations`: imported provenance.
- `entry_voids`, `void_denials`: PIVOT-005 own terminal-void audit/denial semantics.
- No historical native audit backfill or mirroring.
- No unregistered/new table silently opts into raw logging: the dispatcher table list and
  serializer review are explicit; a new table/column requires an additive registration
  and serializer review.

## Gates

Environment: dedicated disposable PostgreSQL 18.6 cluster on loopback
`127.0.0.1:55435`, `SAVEN_PIVOT_TEST_CLUSTER=1`, local admin `esc`, Node v24.19.0 via
`npm exec --yes --package=node@24.19.0`. No global `saven_*` role was created; the
fixture namespaced and removed every object. Cluster stopped after verification.

```text
$ node scripts/check.mjs
PASS: 165 JavaScript files parsed; package manifest valid.

$ node --test tests/pivot-006-audit.test.mjs
✔ PIVOT-006 records actor-bound insert/update/delete audit with before, after and target
✔ PIVOT-006 missing context fails closed and audit storage is append-only and tenant-scoped
✔ PIVOT-006 business mutation and audit are atomic, including a forced audit failure
✔ PIVOT-006 preserves native financial audit and never recursively audits audit storage
✔ PIVOT-006 dispatcher registers 041 alongside 040/042 and re-activation is idempotent
✔ PIVOT-006 static contract: immutable payload, explicit registration and no runtime audit writes
✔ PIVOT-006 dedicated audit owner has only the reviewed authority and refuses polluted owners
✔ PIVOT-006 native audit inserts are bound to the admitted actor and tenant
✔ PIVOT-006 serialization redacts extensible payloads and validates provenance
✔ PIVOT-006 activation is atomic and the 041-without-dispatcher window is explicit
ℹ tests 10
ℹ pass 10
ℹ fail 0
```

PIVOT-005 regression on the same tree: **18/18 pass**.

Full suite serial (`--test-concurrency=1`): **306/308 pass**, two failures:

1. `AUTH-004-R1 durable bounded failure policy spans sessions and endpoints` —
   fixture-teardown transient (`terminating connection due to administrator command`)
   under the combined run; unchanged AUTH test, outside PIVOT-006 TOUCH.
2. `PIVOT-004 resists an extra permissive policy and an attacker permissive policy on
   auth` — the known out-of-TOUCH literal global-role `saven_customer_app` prerequisite
   on a namespaced pristine cluster. Not repaired here; no global role was created to
   mask it.

No PIVOT-006 focused or PIVOT-005 test failed. These are worker-executed gates, not an
independent reviewer run or an application/AUTH-006 proof.

## Upgrade / activation procedure and quiescence boundary

1. Complete bootstrap/import writes before activating audit, or use a future separately
   reviewed audited maintenance path.
2. Apply 040 (migration principal), then 041 and 042 (offline administrator), then run
   40-triggers as the activation step.
3. **Quiesce business writes from 041 application through successful 40-triggers
   completion.** 041 is function-only and is not audit-active until the dispatcher
   attaches and validates every trigger. The dispatcher is one transaction: any failure
   rolls back the entire trigger set, so it never reports a partially audit-active
   installation. The tests prove the pre-dispatcher window is unaudited and that failed/
   partial/interrupted activation leaves no audit trigger set.
4. After successful activation, verify the `saven_p006_*` coverage set, the dedicated
   audit-owner attributes/authority, the exact writer/native-guard configuration and the
   retained 040/042 bindings before resuming writes.
5. A 040/042-only installation remains PIVOT-005-compatible but has no PIVOT-006 audit
   coverage; do not describe it as audited.

## Guarantees vs evidence boundaries

- **Demonstrated in a disposable database:** atomic change-row capture, verified-context
  actor binding for generic and native audit inserts, append-only audit storage, tenant
  isolation, secret redaction for JSONB/unreviewed text, unsupported-type fail-closed,
  provenance validation/retention, owner pollution refusal, dispatcher idempotency and
  atomic activation.
- **Not proven by this fixture:** AUTH-006 composed application identity provenance
  (fixture `SET ROLE`/synthetic GUCs are not the application boundary); HTTP/header
  spoofing; every provider/storage fault; representative-volume performance; SQLite/PG
  parity; UI/API/RBAC visibility; Private packaging; production migration/cutover.
- **Failed-attempt durability** is not claimed by this payload; it remains PIVOT-013's
  separately committed application/kernel workflow because PostgreSQL has no
  autonomous transaction.
- **Origin limits:** document origin metadata is trusted only after canonical reference
  validation and structural checks; an integration/system service identity is recorded
  as supplied rather than independently authenticated. Generic changes have genuinely
  unavailable business origin and are marked as such, not as human.
- **Serialization limits:** reviewed business text (narrative, reason, description,
  address, tax number and similar) is retained as business evidence; this payload does
  not guarantee that user-entered free text contains no secret. Extensible JSON/text
  payloads are redacted by policy. A new column type/shape fails closed; a new reviewed
  text column requires an explicit allow-list review.

## Dependencies and limits

1. **AUTH-006** remains required for application acceptance; PIVOT-006 development is
   complete but not an application provenance proof.
2. **PIVOT-004** global-role fixture failure remains out of scope and explicitly
   attributed; not repaired.
3. **PIVOT-013** owns failed/denied-attempt durability and operational posting
   reconciliation.
4. No application route/page/RBAC/UI, parity, production profile, migration, cutover or
   Private packaging is delivered or claimed.
5. SQLite remains production.

## Changes and preservation

- `db/postgres/migrations/041-audit.sql`: revised new/unapplied payload with dedicated
  owner, serialization, provenance and native-audit binding.
- `db/postgres/40-triggers.sql`: 041 registration plus native/append/truncate/coverage
  and authority validation.
- `db/postgres/README.md`: role, run order, audit/serialization/provenance/activation
  and exclusion documentation.
- `tests/helpers/pg-pivot-fixture.mjs`: namespaced audit-definer support only, as
  authorized by the ENGINEER R1 amendment.
- `tests/pivot-006-audit.test.mjs`: focused evidence above.
- 040/042 payload bytes were not edited. Native/reference source, archive, active
  production/server entry points and PIVOT-004 fixtures/tests were not changed.

## EXTENSIBILITY

compliant: no new hardcoded business-role or visibility rule; origin values resolve
through the canonical reference domain rather than a new enum; the audit table list and
serialization allow-list are explicit reviewed inventories; PostgreSQL operations are
fixed engine actions, not growing business domains; the dedicated owner is constrained
and additively replaceable; the dispatcher is version-aware and additive; financial
source bytes, native audit, numbering and D-014 role-agnostic read visibility remain
preserved.

## GIT

branch=opencode/pivot-006-audit base=testing-1 @ 32fef2b
implementation=12732d3d1210a98fe446078d5a2b359a7a302553
report=this commit pushed=yes merged=no
