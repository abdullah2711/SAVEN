# Project state

15 November 2026. Engineering session only: proposed ADRs, source inventory and22 future task contracts. Implementation, acceptance evidence, deployment and client migration are not delivered here.

## Observed source and existing work

Integration base43dce30b8a83dbf7f1842e529008ec4a8229dc75; reviewed main sourceb9bdf75824b017cd813f55245f3c352d786fa864. Active native source is public/live plus src/local; identity/commerce/fleet/jobs use separate local SQLite stores and each subscribed business has a tenant file. Journals, saved drafts, numbering, rejection/return, trial/GL, bounded invoice/bill/settlement/credit and weighted-average stock flows exist. Accounting, Settings, approvals UX, statutory statements, inventory breadth, Apps, Private packaging and broader MVP work remain partial. PostgreSQL reference code/migrations under src/, scripts/ and postgresql/ are retained; db/postgres/ is a new, unimplemented target.

Existing auth uses scrypt, hashed opaque eight-hour app/operator sessions, CSRF/exact origins, active membership/role checks and operator scopes. Native MFA, passkeys, email verification/reset, OIDC and CF Access JWT application validation are missing. Better Auth is the proposed default; a dedicated auth ADR must define plugin/schema/session adaptation before implementation. RLS will reinforce tenant isolation, not replace business permissions, approval policies, owner protections or support consent.

## Current gate and session scope

SQLite remains production. The owner authorizes a controlled shared-PG design, not cutover. Retirement requires financial/security parity, enforced RLS coverage, independently timed PG restore and explicit owner authorization. New testapp/testops URLs are target specifications only; no infrastructure changes are made. Existing145-test/CI evidence belongs to the native baseline, not PG. This session executes no verification gates and does not update BUILD_STATE or produce07-verification-evidence.md. Later PIVOT-012 owns implementation evidence.

## Contradictions and narrowing decisions

Detailed observations are in00-engineer-reading-log.md. The new PG target supersedes the SQLite-only target clause only through the proposed ADR and required AGENTS annotation. New pending-document editing/AI approval rules differ from current immutable accepted commands and must use versioned submissions with approval invalidation. Operator Access/IdP MFA is distinct from tenant-local MFA and Private local administration. Old UI/module priority and hosted-AI language are historical; no product scope is removed. Tenant UUID mapping, composite tenant foreign keys, actual per-source posting states, operator permission/consent and rollback-resistant failure audit require explicit contracts. The prompt omitted the referenced auth-audit template, so item8 derives a complete observed-control matrix from its canonical constraints.

GitHub rejected testing-1/codex/postgresql-engineering-20261115 (422; ref prefix collision). Actual isolated branch is codex/postgresql-engineering-20261115. Human merge remains mandatory. No main/integration history is rewritten. A real independent Git checkout is used, leaving the prior materialized workspace and its unrelated differences intact.

## Status

Items are committed separately in the required session order. At this item2 checkpoint the dependency graph is deliberately absent; item12 adds it. Contracts describe future gates and exact allowed files; no green gate or completed pivot is claimed. Runtime, existing migrations, tests, frozen testing frontend and credentials remain unchanged.
