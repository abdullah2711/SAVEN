# SAVEN repository instructions

## Branches

- Work on `testing-1` first. Do not push changes directly to `main`.
- Promotion to `main` follows testing, review, and the owner's release decision.
- Do not force push or discard unrelated work.

## Governing owner mandate v2.3

- Read docs/sources/SAVEN-mandate-v2.3.md and docs/sources/SAVEN-agent-handoff-v2.3.md completely, plus the full v2 baseline for nonconflicting scope. Newest explicit owner feedback governs.
- Native SQLite is the sole selected next database engine, including central controls. No new D1 or PostgreSQL dependency. Local-first development/QA must work without SSH or cloud services.
- Exactly Cloud and Fully Private; Offline is a companion. No SaaS customer-node attachment or reseller hosting. Private excludes vendor issuer/billing/global customer/operator components and uses monthly signed public-key-verified entitlements.
- One immutable ultimate-owner role definition and exactly one active principal per subscribed business. Custom role names grant no protected authority. Pending, approval, posted and outbox states are distinct durable contracts.
- Preserve existing PG code/data/services/tests until independent SQLite parity, restore/reconciliation and explicit cutover/decommission authorization. The 14 November operational-release request authorizes verified production increments and controlled main promotion after testing; it does not authorize destructive deletion, unverified client onboarding or an irreversible reference-data cutover.
- Latest owner revision: complete frontend/UI/UX module by module before further backend feature work. Use visible SA7EN brand; keep protocol/repository IDs stable. The root testing frontend replaces the old public interface; retained reference code/data are preserved. Read docs/39-ui-first-brand-and-origin-revision.md and docs/40-frontend-module-completion-plan.md. Customer app and operator administration use separate origins; the operator origin hosts both commercial and infrastructure sections. Offline implementation follows main infrastructure while sync-compatible contracts remain mandatory. Keep synthetic design separate from working commands. Apps APP-001 through APP-010 remain mandatory.
- After each increment run relevant tests, both generators and plan validation, then persist source/test/deployment limits and next actions in BUILD_STATE.
- Latest priority supersedes the UI-only order: operational Accounting and Inventory plus critical identity, settings, printing, commerce, operator, storage and bounded AI. Rename Books & money to Accounting. Use docs/42-first-operational-release.md. A deadline is not release evidence; preserve the entire existing scope and identify unsupported workflows explicitly.

## Current project stage

- The 14 November TLS/domain revision selects `https://app.economicsystems.cc` and `https://ops.economicsystems.cc`. These supersede the nested Cloud application/operator hostnames. Preserve separate exact origins and host-only realm sessions. See docs/43-native-domain-and-recovery-continuation.md for observed deployment and remaining release gates.
- The subsequent owner direction requires all active SAVEN runtime layers on the owner's server. Cloudflare supplies DNS/TLS and the tunnel only; Workers, D1, R2, Durable Objects, VPC bindings and hosted model inference must not be required by the active profile. GitHub remains source/CI, never an online transaction dependency. See docs/44-server-hosted-runtime.md and contracts/runtime-hosting-v1.json. Retain historical adapters/reference data without routing active .cc application or testing traffic through them.

- The owner authorized construction on 11 November 2026. Read docs/BUILD_STATE.md, docs/11-additional-input.md and docs/12-foundation.md before continuing implementation.
- Requirements in this baseline are specified, not implemented. Do not describe prototype behaviour or planning checks as production functionality.
- Foundation code now exists. Catalog items marked in progress remain partial until all supported-scope and release evidence passes. Keep build checkpoints current after interruptions and handoffs.
- Preserve the requested commercial breadth. Propose scope changes explicitly and update traceability rather than silently postponing features.

## Financial and security boundaries

- Forms, APIs, integrations and AI must share business validation, permission, approval and posting controls.
- Use decimal financial arithmetic, atomic balanced effects, idempotency, company boundaries and traceable corrections.
- Never commit credentials, customer records, payroll, payment evidence or database dumps.
- AI models are untrusted proposal generators. Do not promise zero hallucinations, universal model equivalence, unlimited scale or breach-proof operation.

## Documentation

- Run `python3 tools/validate_plan.py` after changing the planning package.
- Keep the catalog JSON, feature library and explicit generator records consistent.
- Record unresolved decisions, unsupported depth and required evidence honestly.

