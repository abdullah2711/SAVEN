# SAVEN repository map — contractor onboarding

Base: `testing-1` at `43dce30`
Branch: `opencode/onboarding`
Date: 15 November 2026
Scope: read-only map produced during Session 1 onboarding. No contract was executed and no production code was changed.

## Entry points and runtime

| Area | Location |
| --- | --- |
| Native SQLite server (active profile) | `scripts/native-server.mjs` → `src/local/http.mjs` → `src/local/runtime.mjs` → `src/local/engine.mjs` |
| PostgreSQL-reference / Cloud API | `scripts/server.mjs`, `src/api.mjs`, `src/worker.mjs` |
| Edge assistant | `src/edge-assistant.mjs` |
| Operational frontend | `public/live/` |
| Frozen/reference frontend | `archive/saventesting-20261114/`, `reference/legacy-ui/` |

## Schema and tenant model

- Native central SQLite schemas: `src/local/schema.mjs` exports `identity`, `commerce`, `fleet`, `jobs`; tenant schema is the `tenant` export. Store opening, checksums, migrations and transactions live in `src/local/sqlite.mjs`.
- Native document/numbering schema: `src/local/document-schema.mjs` (`document_sequences`, `document_numbers`, `journal_drafts`, `command_decisions`).
- One tenant file per business: `<data>/tenants/<tenantId>.sqlite`; central files are `identity.sqlite`, `commerce.sqlite`, `fleet.sqlite`, `jobs.sqlite`. Tenant identity is checked against `placements` and `readBusinessIdentity`; a missing or mismatched file is quarantined, never recreated.
- Central tenant keys: `memberships(tenant_id,user_id,...)`, `entitlements(tenant_id,...)`, `placements(tenant_id,...)`, `jobs(tenant_id,command_id,...)`. Tenant business scope is `company_profiles(id, branch, ...)`; tenant tables use `company`/`branch` columns.
- PostgreSQL reference schema: `postgresql/001_schema.sql` through `016_invoice_taxes.sql`. Its tables use `company_id`, not the prompt's future `tenant_id` shape. `migrations/0001_foundation.sql` is the older D1/foundation reference.

## Accounting posting kernel

- Native kernel: `src/local/engine.mjs` class `NativeFoundation` — `policy`, `provision`, `accept`, `execute`, `audit`, `ledger`, `trial`, `statements`; balanced `normalizedJournal`, exact minor units, command lease, period locks, evidence checks.
- Native drafts, numbering and review decisions: `src/local/documents.mjs` — `saveDraft`, `listDrafts`, `submitDraft`, `cancelDraft`, `decideCommand`, `allocateNumber` (atomic `document_sequences`/`document_numbers`).
- Native extensions: `src/local/corrections.mjs`, `src/local/inventory.mjs`, `src/local/trade.mjs`, `src/local/administration.mjs`.
- PostgreSQL reference command/report modules: `src/accounting.mjs`, `src/bookkeeping.mjs`, `src/extended-accounting.mjs`, `src/opening.mjs`, `src/payments.mjs`, `src/assets.mjs`, `src/operating.mjs`, `src/recurring.mjs`, `src/approval.mjs`, `src/approval-conditions.mjs`.

## Immutability, audit, approval and idempotency

- Native triggers in `src/local/schema.mjs` and `src/local/document-schema.mjs`: posted journals/lines immutable, audit append-only, accepted command payload immutable, posted state final, balanced effects plus audit plus outbox required, evidence and trade/credit sources retained, protected owner role and assignment.
- Native audit: tenant `audit(id,command_id,actor,event,detail,happened_at)`; central `commercial_audit` and `migration_events`.
- Native durable state: `command_inbox`, `approval_requests`, `command_decisions`, `journal_drafts`, `document_sequences`, `document_numbers`, `outbox`. `NativeFoundation.accept` stores the canonical payload/digest and allocates a number in one tenant transaction; `execute` claims a lease, rechecks policy/period/evidence and posts effects plus audit plus outbox atomically.
- PostgreSQL reference: `operations`, `documents`, `journals`, `journal_lines`, `audit_events`, `outbox`, `approval_policies` and the `saven_approval_*` functions; `postgresql/002_controls.sql` supplies `saven_immutable()` and the core triggers.

## Authorization and RLS

- Native SQLite has no RLS. Authorization is fail-closed in `NativeFoundation.policy` (central identity plus membership, entitlement, tenant member, role, explicit denial, resource and amount scope) and `NativeRuntime.scope`. User-supplied database paths and raw SQL endpoints are not accepted.
- PostgreSQL reference has RLS: `ENABLE`/`FORCE ROW LEVEL SECURITY` and `CREATE POLICY company_scope ... USING(saven_member(company_id))` across `postgresql/*.sql`; helper functions `saven_actor()`, `saven_member()` and `saven_visible_user()` live in `postgresql/002_controls.sql`. The runtime role is `NOBYPASSRLS` (asserted by `scripts/verify-postgres.mjs`).
- No `tenant_id` RLS policy, `auth.users`, `auth.tenant_membership`, `tenant_data.audit_event` or `operator.user_identity` schema exists in the current tree.

## Authentication

- Native identity/session: `src/local/runtime.mjs` (`createIdentity`, `login`, `session`, `csrf`, `logout`, `requireOperator`), `src/local/http.mjs` (host-only app/operator cookies and CSRF), `src/passwords.mjs` (scrypt) and `src/crypto.mjs`.
- Native identity schema: `src/local/schema.mjs` (`users`, `credentials`, `sessions`, `auth_limits`, `operator_staff`, `operator_scopes`).
- PostgreSQL reference: `src/auth.mjs`, `src/security.mjs`, `postgresql/001_schema.sql`, `002_controls.sql`, `004_policy_owners.sql`, `005_identity_and_setup.sql`.
- No MFA/TOTP/passkey/recovery-code implementation was found in `src/`; no `auth` schema or `auth.users` table was found.

## Tests and gates

- Tests: `tests/*.test.mjs` (32 files). `npm test` runs all; `npm run native:test` runs the native subset.
- Syntax gate: `scripts/check.mjs` parses `src`, `scripts`, `tests`, `public`, `reference` and validates `package.json`.
- CI: `.github/workflows/verify.yml` (PostgreSQL 18 service, `node --test`, PostgreSQL contract scripts, plan/checklist/skill validators and generator reproducibility) and `.github/workflows/native-image.yml` (Docker native build plus focused native tests).
- Planning gates: `tools/validate_plan.py`, `tools/checklist.py`, `tools/validate_project_skills.py`; generators `tools/build_feature_catalog.py` and `tools/build_design_library.py`.
- Standard local gate: `node scripts/check.mjs && node --test tests/*.test.mjs` (or the exact `DONE WHEN` commands in a contract).

## AI

- Native assistant: `src/local/runtime.mjs` `assistant()`; provider configuration `src/local/model-config.mjs`; provider and PDF extraction `src/assistant-provider.mjs`; response schema/system prompt `src/assistant-contract.mjs`.
- PostgreSQL/edge assistant: `src/assistant.mjs` and `src/edge-assistant.mjs`; task and provider authority use `assistant_tasks` and `ai_requests`.
- Requirements: `docs/05-feature-library.md` AI-001 through AI-031; supporting architecture/security in `docs/02-architecture-ai-security.md`; provider/skills configuration in `docs/52-project-skills-and-ai-configuration.md`.
- No vector database or `pgvector` extension is present or authorized.

## Documentation and contracts

- Current state: `docs/CURRENT_HANDOFF.md`, `docs/BUILD_STATE.md`, `contracts/delivery-checklist.json`, `docs/TASKS.md`.
- Requirements/catalog: `docs/feature-catalog.json`, `docs/05-feature-library.md`, `docs/requirements-baseline-ids.json`.
- Design: `docs/ui-screen-inventory.json`, `docs/workflow-contracts-v1.json`, `docs/32-product-wide-ui-ux-library.md`.
- Runtime/control contracts: `contracts/control-domains-v1.json`, `contracts/origins-v1.json`, `contracts/runtime-hosting-v1.json`, `contracts/fleet-migration-v1.schema.json`.

## Files the prompt told me to find that are absent

- `docs/pivot-notes/00-pivot-spec.md` — MISSING.
- `docs/pivot-notes/01-adr-postgresql-pivot.md` — MISSING.
- `docs/pivot-notes/02-three-purposes.md` — MISSING.
- `docs/pivot-notes/03-adr-auth.md` — MISSING.
- `docs/contractor/00-engineer-reading-log.md` — MISSING.
- `docs/contractor/01-project-state.md` — MISSING.
- `docs/contractor/CONVENTIONS.md` — MISSING; engineer-owned.
- `docs/contractor/auth/00-existing-auth-audit.md` — MISSING.
- `docs/contractor/contracts/` — MISSING (no files).
- Dedicated AI feature-library file — not found; `docs/05-feature-library.md` is the feature library and contains AI-001 through AI-031.
- MFA/TOTP/passkey implementation — not found in `src/`.
- `auth.users` / `auth.tenant_membership` / `tenant_data.audit_event` / `operator.user_identity` — not found; the current PostgreSQL reference uses `public.*` with `company_id`, and native SQLite uses central and per-tenant files.
