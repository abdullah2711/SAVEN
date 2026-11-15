# Three PostgreSQL purposes and complete source table inventory

15 November 2026. Design mapping only; none of these target tables was created. Source inventory is src/local/schema.mjs, document-schema.mjs and sqlite.mjs at43dce30. Purpose A is operator/control-plane authority, B is tenant transactions/masters, C is tenant-configurable rules. The canonical auth schema is a separate shared identity boundary, not a fourth business purpose or a vendor-only package.

## Target boundaries

| Area | Owner / purpose | tenant_id | RLS design |
| --- | --- | --- | --- |
| operator.* | A: vendor controls, placement, commercial state, operational work | Target tenant where applicable; global controls may be null | No tenant RLS; customer app has zero privileges; mediated audited operator access |
| auth.* | Canonical shared Cloud identity; installation-local identity in Private | Membership/events scoped as below | Principal-scoped sessions; forced tenant membership isolation; dedicated constrained auth bootstrap functions |
| tenant_data transaction/master tables | B: owning business | Non-null UUID | ENABLE and FORCE; actor/company/branch/resource authority additionally enforced |
| tenant_data policy/reference tables | C: owning business rules | Non-null UUID | ENABLE and FORCE; protected policy changes audited/versioned |

## Current SQLite tables: every literal source definition

| SQLite store/table | PG target | Purpose | tenant_id in target | RLS in target | Disposition / source compatibility |
| --- | --- | --- | --- | --- | --- |
| identity.users | auth.users | Auth (shared identity) | No, global principal/realm | Restricted auth-service/principal access | Canonical auth mapping; no operator.user_identity or operator.tenant_membership. |
| identity.memberships | auth.tenant_membership | Auth (shared identity) | Yes | Forced membership/operation scope | Canonical auth mapping; no operator.user_identity or operator.tenant_membership. |
| commerce.entitlements | operator.entitlement | A | Yes or target scope | No; zero customer privileges | Control-plane state with audited least-privileged service access; preserve original business-source references. |
| fleet.placements | operator.tenant_placement | A | Yes or target scope | No; zero customer privileges | Control-plane state with audited least-privileged service access; preserve original business-source references. |
| jobs.jobs | operator.jobs | A | Yes or target scope | No; zero customer privileges | Control-plane state with audited least-privileged service access; preserve original business-source references. |
| tenant.business | tenant_data.business | B | Yes, non-null | Enabled + forced | Preserve original columns/ids and add scoped metadata; composite tenant foreign keys. |
| tenant.members | tenant_data.members | B | Yes, non-null | Enabled + forced | Retained business-principal active restriction/projection; auth.tenant_membership is the sole admission authority, not a duplicate membership service. |
| tenant.roles | tenant_data.roles | C | Yes, non-null | Enabled + forced | Custom financial/business permission definitions; distinct from auth.roles assurance classes; protected ultimate role retained. |
| tenant.assignments | tenant_data.assignments | C | Yes, non-null | Enabled + forced | Preserve original columns/ids and add scoped metadata; composite tenant foreign keys. |
| tenant.denials | tenant_data.denials | C | Yes, non-null | Enabled + forced | Preserve original columns/ids and add scoped metadata; composite tenant foreign keys. |
| tenant.accounts | tenant_data.accounts | B | Yes, non-null | Enabled + forced | Preserve original columns/ids and add scoped metadata; composite tenant foreign keys. |
| tenant.periods | tenant_data.periods | C | Yes, non-null | Enabled + forced | Preserve original columns/ids and add scoped metadata; composite tenant foreign keys. |
| tenant.command_inbox | tenant_data.command_inbox | B | Yes, non-null | Enabled + forced | Immutable accepted bytes/digest and durable receipt; new editable work creates a new bound submission revision. |
| tenant.approval_requests | tenant_data.approval_requests | B | Yes, non-null | Enabled + forced | Preserve original columns/ids and add scoped metadata; composite tenant foreign keys. |
| tenant.journals | tenant_data.journals | B | Yes, non-null | Enabled + forced | Preserve original columns/ids and add scoped metadata; composite tenant foreign keys. |
| tenant.journal_lines | tenant_data.journal_lines | B | Yes, non-null | Enabled + forced | Preserve original columns/ids and add scoped metadata; composite tenant foreign keys. |
| tenant.audit | tenant_data.audit | B | Yes, non-null | Enabled + forced | Preserve original columns/ids and add scoped metadata; composite tenant foreign keys. |
| tenant.outbox | tenant_data.outbox | B | Yes, non-null | Enabled + forced | Preserve original columns/ids and add scoped metadata; composite tenant foreign keys. |
| identity.credentials | auth.accounts | Auth (shared identity) | No, global principal/realm | Restricted auth-service/principal access | Existing scrypt verifiers retained through a reviewed adapter/upgrade-on-login; no plaintext password or silent hash reset. |
| identity.sessions | auth.sessions | Auth (shared identity) | No, global principal/realm | Restricted auth-service/principal access | New token-hash store with idle/absolute/revocation/MFA/selected-tenant metadata; old sessions not silently promoted. |
| identity.auth_limits | auth.auth_limits | Auth (shared identity) | Nullable audit scope | Restricted auth-service/principal access | Canonical auth mapping; no operator.user_identity or operator.tenant_membership. |
| identity.operator_staff | auth.operator_staff | Auth (shared identity) | No, global principal/realm | Restricted auth-service/principal access | Cloud Access subject-to-authorized-operator mapping and scopes; does not provide local Cloud operator credentials. |
| identity.operator_scopes | auth.operator_scopes | Auth (shared identity) | No, global principal/realm | Restricted auth-service/principal access | Cloud Access subject-to-authorized-operator mapping and scopes; does not provide local Cloud operator credentials. |
| jobs.ai_requests | operator.ai_requests | A | Yes or target scope | No; zero customer privileges | Redacted usage/reservation/orchestration metadata only; no document-proposal table or whole prompts in operator records. |
| fleet.migration_events | operator.migration_events | A | Yes or target scope | No; zero customer privileges | Control-plane state with audited least-privileged service access; preserve original business-source references. |
| commerce.subscriber_accounts | operator.tenant | A | Yes or target scope | No; zero customer privileges | Control-plane state with audited least-privileged service access; preserve original business-source references. |
| commerce.commercial_audit | operator.operator_audit | A | Yes or target scope | No; zero customer privileges | Control-plane state with audited least-privileged service access; preserve original business-source references. |
| tenant.company_profiles | tenant_data.company_profiles | B | Yes, non-null | Enabled + forced | Preserve original columns/ids and add scoped metadata; composite tenant foreign keys. |
| tenant.warehouses | tenant_data.warehouses | B | Yes, non-null | Enabled + forced | Preserve original columns/ids and add scoped metadata; composite tenant foreign keys. |
| tenant.stock_items | tenant_data.stock_items | B | Yes, non-null | Enabled + forced | Preserve original columns/ids and add scoped metadata; composite tenant foreign keys. |
| tenant.stock_balances | tenant_data.stock_balances | B | Yes, non-null | Enabled + forced | Preserve original columns/ids and add scoped metadata; composite tenant foreign keys. |
| tenant.stock_operations | tenant_data.stock_operations | B | Yes, non-null | Enabled + forced | Preserve original columns/ids and add scoped metadata; composite tenant foreign keys. |
| tenant.stock_movements | tenant_data.stock_movements | B | Yes, non-null | Enabled + forced | Preserve original columns/ids and add scoped metadata; composite tenant foreign keys. |
| tenant.account_profiles | tenant_data.account_profiles | B | Yes, non-null | Enabled + forced | Preserve original columns/ids and add scoped metadata; composite tenant foreign keys. |
| tenant.company_settings | tenant_data.company_settings | C | Yes, non-null | Enabled + forced | Preserve original columns/ids and add scoped metadata; composite tenant foreign keys. |
| tenant.command_files | tenant_data.command_files | B | Yes, non-null | Enabled + forced | Preserve original columns/ids and add scoped metadata; composite tenant foreign keys. |
| tenant.inventory_controls | tenant_data.inventory_controls | C | Yes, non-null | Enabled + forced | Preserve original columns/ids and add scoped metadata; composite tenant foreign keys. |
| tenant.journal_corrections | tenant_data.journal_corrections | B | Yes, non-null | Enabled + forced | Preserve original columns/ids and add scoped metadata; composite tenant foreign keys. |
| identity.business_member_operations | auth.business_member_operations | Auth (shared identity) | Yes | Forced membership/operation scope | Canonical auth mapping; no operator.user_identity or operator.tenant_membership. |
| tenant.trade_controls | tenant_data.trade_controls | C | Yes, non-null | Enabled + forced | Preserve original columns/ids and add scoped metadata; composite tenant foreign keys. |
| tenant.trade_parties | tenant_data.trade_parties | B | Yes, non-null | Enabled + forced | Preserve original columns/ids and add scoped metadata; composite tenant foreign keys. |
| tenant.trade_operations | tenant_data.trade_operations | B | Yes, non-null | Enabled + forced | Preserve original columns/ids and add scoped metadata; composite tenant foreign keys. |
| tenant.trade_documents | tenant_data.trade_documents | B | Yes, non-null | Enabled + forced | Preserve original columns/ids and add scoped metadata; composite tenant foreign keys. |
| tenant.trade_lines | tenant_data.trade_lines | B | Yes, non-null | Enabled + forced | Preserve original columns/ids and add scoped metadata; composite tenant foreign keys. |
| tenant.trade_allocations | tenant_data.trade_allocations | B | Yes, non-null | Enabled + forced | Preserve original columns/ids and add scoped metadata; composite tenant foreign keys. |
| tenant.trade_credits | tenant_data.trade_credits | B | Yes, non-null | Enabled + forced | Preserve original columns/ids and add scoped metadata; composite tenant foreign keys. |
| tenant.trade_credit_lines | tenant_data.trade_credit_lines | B | Yes, non-null | Enabled + forced | Preserve original columns/ids and add scoped metadata; composite tenant foreign keys. |
| tenant.document_sequences | tenant_data.document_sequences | B | Yes, non-null | Enabled + forced | Preserve original columns/ids and add scoped metadata; composite tenant foreign keys. |
| tenant.document_numbers | tenant_data.document_numbers | B | Yes, non-null | Enabled + forced | Preserve original columns/ids and add scoped metadata; composite tenant foreign keys. |
| tenant.journal_drafts | tenant_data.journal_drafts | B | Yes, non-null | Enabled + forced | Preserve original draft revisions; new unified pending-document view/revision sidecar is explicit, not a payload rewrite. |
| tenant.command_decisions | tenant_data.command_decisions | B | Yes, non-null | Enabled + forced | Preserve original columns/ids and add scoped metadata; composite tenant foreign keys. |

schema_migrations exists in every native store. Preserve its version/checksum/applied_at as source provenance: tenant source rows map to tenant_data.source_store_migrations (B, tenant_id non-null, forced RLS); control-store rows map to operator.source_store_migrations (A, restricted). A separate operator.pg_schema_migrations ledger records only PG migration application. Native checksums are not asserted to be PG SQL. Source inventory does not create SQLite files or open live stores.

## New target/auth/rule tables not present in native source

| Target table | Purpose | tenant_id | RLS / authority |
| --- | --- | --- | --- |
| operator.feature_flag | A | Optional tenant scope | No tenant RLS; operator-controlled safe defaults |
| operator.pg_schema_migrations | A | No | Migrator only; immutable applied checksums |
| operator.source_store_migrations | A | Target scope for relevant records | Restricted source-provenance append |
| auth.accounts | Auth | No | Canonical provider_id/account_id/user_id binding and password verifier; tokens encrypted if retained |
| auth.verification | Auth | Optional target scope | Hashed short-lived single-use tokens, constrained auth service |
| auth.two_factor | Auth | No; user_id binding | Encrypted TOTP seed, never one-way hashed; service-only decrypted use |
| auth.recovery_codes | Auth | No; user_id binding | Hash-only single-use codes and atomic consume |
| auth.roles | Auth | No | Authentication-assurance classes, not financial permission grants |
| auth.auth_audit | Auth | Nullable (login/preselection allowed) | Append-only, scope-controlled read; failed-event durability |
| auth.oauth_state | Auth | Optional intended selected tenant, never authority | Single-use expiry/nonce/PKCE, server-side; no connector activated in Phase1 |
| tenant_data.business_rule | C | Non-null | Forced tenant RLS, versioned JSON schema/effective periods |
| tenant_data.approval_policy | C | Non-null | Forced tenant RLS, currencies/thresholds/independence, AI direct-post=false |
| tenant_data.posting_constraint | C | Non-null | Forced tenant RLS, registered deterministic rule validators |
| tenant_data.tax_profile | C | Non-null | Forced tenant RLS, reviewed jurisdiction/effective dates |
| tenant_data.audit_event | B | Non-null | Append-only current-change audit; original audit remains intact |
| tenant_data.document_revisions | B | Non-null | Immutable proposal/submission revisions, digest/origin/policy bindings |
| tenant_data.document_registry | B | Non-null | Ordinary document identity/type/revision/status projection; no ai_proposal table |
| tenant_data.support_grants | C | Non-null | Customer-authorized scope/actor/time/action grant; no implicit vendor superuser |
| tenant_data.source_store_migrations | B | Non-null | Forced RLS; unchanged imported checksum provenance |
| tenant_data.reference_values | C | Non-null | Named configurable domains with is_active/effective dates/schema version |
| tenant_data.verified_entitlement | B | Non-null | Private signed-certificate verification cache only; no vendor signing/billing authority |

## Key mapping and application constraints

operator.tenant is the canonical subscriber directory; entitlement/placement/feature rows may reference its tenant_id without becoming competing identity registries. Preserve the original id text with a unique legacy_id-to-UUID mapping. Do not assume existing document or user ids are UUIDs. Child keys reference (tenant_id,parent_id) and existing company/branch components, never just an otherwise globally valid id. Existing account codes stay tenant data.

auth.users and auth.tenant_membership are canonical. Business members/assignments retain local restriction/custom permission meaning without creating a second login or admission authority. auth.roles describes assurance requirements; tenant_data.roles owns custom ERP rights. Protected ultimate owner authority is never inferred from an auth role name. Column mappings and library-required additional columns are additive, versioned and reviewed. Missing timestamp/actor metadata is added to mutable target records; immutable imported audit rows use a source-preserving sidecar rather than fabricated historical actor values.

Cloud operator reads require validated Access identity, scope and customer support consent where required; all successful cross-tenant reads are function-mediated/audited, and failed attempt durability is independently defined. Authentication preselection uses a dedicated least-privileged auth boundary with no operator/financial grants. RLS default-deny context does not replace company/resource/field/approval policy. Membership/session context must be verified before business feature shipping.

## Private composition and extension points

Fully Private omits vendor operator tables/services and uses local auth, tenant data and signed-entitlement verification; no Cloudflare/IdP dependency is permitted for air-gapped ordinary operation. Preserve source-store provenance through the profile adapter. New configurable reference values are effective-dated; new executable handlers need registration and tests, never arbitrary JSON execution. New tenant tables must enter coverage/negative-isolation gates, including partitions, views/function execution and composite reference tests. Per-table RLS and indexes are reviewed against actual query shapes; no assumption that every table has an id column.

Sources: owner Pivot Spec Phases2-4; ADR01 data/authority invariants; canonical Identity Table Resolution and AUTH/AI constraints. All targets are specified only.
