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
