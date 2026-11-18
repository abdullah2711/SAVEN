VERDICT: ACCEPT

WHY: R5 moves the exclusive installation authority gate before all table/sequence DDL and closes the remaining allocator regression-evidence gaps. No blocking finding remains in the submitted AUTH-007 scope.

Date: 18 November 2026 (Asia/Karachi).
Delivery: `opencode/auth-007-operator-access @ 0349d58eb7faf1868c174e3d408475c85f2c6e72`; implementation `cfc54ac1ed8dc16c5aa5692edadc86b0949f292b`.
Base: `testing-1 @ 0df990a`; correction delta from `edc86d0`.
Reviewed worktree: `/home/esc/saven/wt-rev-auth-007-r5`.
Report: `docs/contractor/deliveries/AUTH-007-operator-access.md`, R5 section.
Governing review: [AUTH-007-R4](AUTH-007-R4-operator-access.md), `6924727`.
MERGE RISK: HIGH — authentication, operator authority and administrative allocator installation.
ROUTING: queue a plain-English Business Merge Request for the human. Only after human APPROVED may a worker merge. Engineer does not merge or dispatch by this review.

Scope: inspected the SQL, test and README corrections, report/checkpoint delta and retained admission/gate composition. Changes remain within existing AUTH-007 ownership plus delivery/checkpoint. Accepted 033, native entry points and production profile remain unchanged.

Closure of 6924727:

1. **Installation lock order closed.** `06-operator-identity.sql` now takes the exclusive AUTH-006 authority advisory gate immediately after BEGIN/SET LOCAL ROLE, before CREATE SEQUENCE, ALTER TABLE or any other table/sequence DDL. The allocator block no longer acquires it late. This orders the installer against gate-first operator admission without holding a conflicting mapping/binding table lock while waiting for the gate. The new composition test pauses admitted work before binding/mapping reads, starts real payload reapplication, resumes admission, then requires both admission and installation to complete successfully, with no allocator regression and a subsequent authorized session read. The 300 ms pending check is a bounded timing observation rather than catalog proof of the exact wait point; the SQL source directly establishes gate-before-DDL order. No production load or scheduler determinism claim follows from that timing probe.

2. **Regression evidence closed.** The helper executes the actual allocator DO statement, confirms execution and injects failure before COMMIT. The already-ahead interrupted case now exists separately from the behind/binding-only advancement case. Exact BigInt state assertions cover non-regression; binding-only reconciliation must advance beyond retained generations despite deleted live mappings, and its advancement survives later ROLLBACK. Old credentials are tested again after mapping recreation with specific `OPERATOR_ACCESS_DENIED`; a fresh exchange and authorized session read succeed. The report supplies an actual mutation transcript: replacing the binding-aware floor with the old live-only expression fails the named binding-only assertion; restoring it passes the focused case. The mutation is absent from the delivered source. This is worker-reported mutation execution, not reviewer-run verification.

Retained acceptance conditions: mandatory verified MFA evidence, canonical JOSE/replay identity, configured issuer/audience/key source, refresh-flight recovery, current scoped mapping/session bindings, credential/source freshness after blocking locks and accepted AUTH-006 gate -> user -> session authority remain binding. PIVOT-007 must use reusable operator admission inside the owned transaction, not trust a role label or stale session snapshot. Operator session creation grants no universal customer support access.

D-016 assessment: the documented supported allocator profile is bigint, start/min/increment 1, bigint maximum, cache 1, non-cycling and owned by the authority-table owner. Invalid supported-profile assumptions fail before setval. Needed floor includes live mapping and retained session-binding evidence; the adjustment only advances and overflow fails closed. Rollback may consume generations and leave gaps. Gaps are permitted, must remain explainable and must never be closed or reused; no gapless-generation requirement applies. This accepts the bounded AUTH-007 allocator implementation, not a codebase-wide allocator inventory or a completed recovery system.

Deployment/recovery boundaries: apply accepted 033 first and retain the no-external-allocator-writer installation fence; the advisory gate coordinates cooperating admission/mapping paths, not arbitrary privileged direct nextval/setval callers. Reconcile externally retained highest-issued evidence before serving restored writes and log advancement under D-016. One restored database cannot recover values issued outside its restore point merely by inspecting its own tables. Do not treat this ACCEPT as a restore-drill result, active Access configuration, production activation or cutover permission. Preserve actually applied lineage; no rewrite of an applied production payload is authorized by this review.

Evidence: worker reports Node 24.19.0/PostgreSQL 18.6, syntax check, focused **22/22**, serial combined AUTH-002..007 **142/142**, using disposable administrator installation fixtures and real restricted auth-service application composition. Focused red/restored-green mutation evidence is supplied. Reviewer inspected source/documents and executed no contractor gate, test, SQL mutation, migration, restore or deployment. No full-branch, live Access/IdP, running pooler or production-throughput evidence is claimed.

Can a client-supplied header, query param, or body value influence tenant_id or user_id? The bearer assertion remains untrusted until cryptographic/configured issuer, audience and MFA validation; server mapping and current reserved authority select identity. Body authority fields remain refused. Client assertion provenance does not become a tenant support grant.

EXTENSIBILITY: no new hardcoded enums; no new coupling across module boundaries; no new one-way decisions without an ADR. Keep infrastructure-profile validation separate from configurable business roles; preserve injected auth/admission interfaces, Private independence, digest-only outward session display, retained source/history and existing authority/lifecycle contracts. SQLite remains production. Human merge approval remains required.
