# Contractor reading log — Session 1 onboarding

Project: SAVEN
Base: `testing-1` at `43dce30` (`origin/testing-1`)
Branch: `opencode/onboarding`
Date: 15 November 2026
Scope: onboarding only. No contract was executed and no production code was changed.

## Required reading, in order

1. `AGENTS.md` — Branch rules (`testing-1` first, `main` only on release), v2.3 native-SQLite mandate, accounting-first and UI-first owner revisions, financial/security boundaries, generator and documentation duties.
2. `docs/CURRENT_HANDOFF.md` — Authoritative 15 November state: `testing-1` source WIP is not deployed; main/live remains `b9bdf75`; native SQLite schema 9/identity 3; 145 local tests; OpenRouter blocked by the free endpoint's data policy; exact next actions.
3. `docs/sources/SAVEN-mandate-v2.3.md` — Two commercial models (Cloud and Fully Private) and an Offline companion; native SQLite everywhere; protected ultimate business owner; monthly signed private licences; durable pending/posted/outbox separation; Apps APP-001–APP-010; UI, security, migration and evidence requirements.
4. `docs/sources/SAVEN-agent-handoff-v2.3.md` — Single v2.3 handoff restating the same owner choices and the required implementation/reporting sequence.
5. `docs/48-accounting-first-owner-revision.md` — Accounting-first module/subpage map, shared draft/submit/review/reversal document contract, cross-module accounting rules, print-format contract and bill-and-hold/withholding clarifications.
6. `docs/49-compatible-tenant-upgrades.md` — Expand/backfill/switch/contract evolution, per-tenant leases, WAL-consistent backups, independent reconciliation, canary waves and one writable generation; current implementation is a bounded single-node foundation.
7. `docs/35-native-sqlite-local-first-v2.3.md` — v2.3 reconciliation matrix and local SQLite store boundary; the bounded native foundation is not full PostgreSQL parity or a private production installer.
8. `contracts/delivery-checklist.json` — 204 small actions with `releaseClaim: NOT_COMPLETE`; most are `todo`, some `source-tested`/`browser-tested`, one OpenRouter action `blocked`.
9. `docs/BUILD_STATE.md` — 15 November checkpoint and retained historical evidence: native SQLite deployment/CI/restore records, current WIP boundary, OpenRouter privacy block, prior PostgreSQL/D1 history.
10. `docs/pivot-notes/01-adr-postgresql-pivot.md` — MISSING.
11. `docs/pivot-notes/02-three-purposes.md` — MISSING.
12. `docs/pivot-notes/03-adr-auth.md` — MISSING.
13. `docs/pivot-notes/00-pivot-spec.md` — MISSING.
14. `docs/contractor/00-engineer-reading-log.md` — MISSING.
15. `docs/contractor/01-project-state.md` — MISSING.
16. `docs/contractor/CONVENTIONS.md` — MISSING; the engineer owns this file and must create it before the first contract.
17. `docs/contractor/auth/00-existing-auth-audit.md` — MISSING.
18. Most recent file in `docs/contractor/contracts/` — MISSING; the directory does not exist.
19. AI feature-library document — FOUND at `docs/05-feature-library.md` (269 requirements, including AI-001 through AI-031); `docs/02-architecture-ai-security.md` is the supporting AI architecture/security document.

## Onboarding observations

- The current source is native SQLite. The PostgreSQL reference (`postgresql/001_schema.sql` through `016_invoice_taxes.sql`) and older D1/foundation files remain as reference, not as the v2.3 target.
- `docs/pivot-notes/` and `docs/contractor/` do not exist, so the pivot spec, ADRs, engineer log, project state, conventions, auth audit and contract files cannot yet be consumed.
- RLS exists only in the PostgreSQL reference and keys on `company_id` through `saven_member(...)`. Native SQLite has no RLS and uses `NativeFoundation.policy` plus `NativeRuntime.scope`. No `tenant_id` RLS policy, `auth.users`, `auth.tenant_membership`, `tenant_data.audit_event` or `operator.user_identity` schema was found.
- No MFA, TOTP, passkey or recovery-code implementation was found in `src/`.
- The human replaced the prompt's original short-lived branch convention with `opencode/<slug>` off `testing-1`; this session uses `opencode/onboarding`.
- The checklist and `docs/BUILD_STATE.md` remain the current state truth; no contract execution or release claim is implied by this log.
