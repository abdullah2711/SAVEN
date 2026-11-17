# Decision log

This file records decisions that are already made. The dispatcher and workers
must not reopen them. A new decision is added only by the human, or by Codex
with explicit human authorisation, and must be dated.

| ID | Decision |
| --- | --- |
| D-001 | PostgreSQL over Supabase; self-hosted, binds 127.0.0.1 only. |
| D-002 | Shared schema + RLS + FORCE RLS on every tenant-scoped table. |
| D-003 | Better Auth; Lucia deprecated 2024, must not be proposed. |
| D-004 | AI has no DB write role. AI-origin documents are real rows with `status='pending_approval'`, `origin_type='ai'`. No `ai_proposal` table. |
| D-005 | AI approval follows the same `approval_policy` as humans; the only asymmetry is AI-origin never direct-posts. |
| D-006 | No vector DB in Phase 1. pgvector deferred to a documented use case. |
| D-007 | Two workers max, one Codex reviewer, dispatcher is not an approver. |
| D-008 | Branch scheme: `opencode/<slug>`, `codex/<slug>`; integration on `testing-1`; `main` only by signed deploy record. |
| D-009 | Human authorises merges; Codex issues ACCEPT; a worker executes the merge command. |
| D-010 | Dispatcher may never author contracts, approve diffs, or change an invariant. Escalate instead. |
| D-011 | Off-peak DeepSeek scheduling reduces congestion, not cost, while on the OpenCode Go flat plan. Revisit only if a direct DeepSeek key with a capped balance is adopted. |
| D-012 | 16 November 2026 (Asia/Karachi), explicit human owner authorization: session lists must ONLY ever show token digests; raw session tokens must NEVER be exposed in the UI or API payloads. This is a hard security invariant for AUTH-002 and every future UI/frontend contract, including customer/operator session lists and exports. Preserve the established protected HttpOnly session-cookie transport; it is not permission to expose bearer values in JSON, list responses or rendered UI. Internal transient library token matching must never be serialized to a public response. Record this for the next AUTH-002 revision; do not reopen the accepted a5ea33d / 4debbb6 / 4bbb2eb batch absent actual UI/API token exposure. |
| D-013 | 16 November 2026 (Asia/Karachi), explicit human owner override (Chartered Accountant): users CAN delete posted entries by soft deletion/voiding. Retain every source/evidence/audit record; mark effective state VOIDED and remove the entry from the active General Ledger into a separate Deleted/Voided filtered view. Once voided it is absolutely immutable: no unvoid, physical deletion or second deletion. The initial role-specific visibility instruction is superseded by D-014 below; retain separate read/delete authority at the mechanism level. PIVOT-005 and ADR04 define additive retained-source/terminal-event architecture, atomic reconciled effects and stronger append-only audit; supersede conflicting posted-always-active wording without weakening physical history protection, native correction/rejection flows or SQLite preservation. No merge/cutover is authorized. D-012 remains the independent digest-only session invariant. |
| D-014 | 16 November 2026 (Asia/Karachi), explicit human owner correction to D-013/ADR04/PIVOT-005: architecture, 042 tables, views and policies MUST NOT hardcode business role names or special void-history eligibility. At the database level, Voided Entries are visible to anyone with module access within existing tenant/company/branch scope. Fine-grained visibility is a configurable BUSINESS RULE deferred to the future application RBAC / User Access Settings phase; businesses may later choose broader or narrower access. This supersedes D-013's initial mandatory role-specific visibility restriction and its consistency annotations. Preserve separate read/delete authority, retained sources, append-only terminal void record, absolute immutability of VOIDED, atomic reconciled effects, audit and all other D-013 invariants. No merge or runtime/cutover authorization. |
| D-015 | 17 November 2026 (Asia/Karachi), explicit human owner confirmation relayed by the dispatcher: the existing SQLite local databases contain NO real business-level production data, only dummy/sample data with no business worth. The future SQLite-to-PostgreSQL cutover therefore carries no live-financial-data migration risk from these existing databases, and data migration effort at cutover is minimal. Full security, parity and quality gates remain mandatory. This records the owner-confirmed current data state; it does not authorize cutover, destructive deletion, decommissioning or a merge. |
