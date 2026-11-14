# SAVEN Risk Register

> Current owner revision: [Accounting-first scope](48-accounting-first-owner-revision.md), [compatible tenant upgrades](49-compatible-tenant-upgrades.md), and [small-action checklist](TASKS.md) govern conflicting sequence and expanded depth. Historical implementation claims below remain dated evidence, not completion of the new scope.

11 November 2026 | Initial risk assessment

Likelihood and impact below are planning judgments rather than measured frequencies. Responsibility names describe roles to assign when a delivery team is formed. None of these controls is claimed to exist in production yet.

| Risk | Likelihood and impact | Control and early signal | Responsible role |
| --- | --- | --- | --- |
| Broad launch exceeds capacity | High and high | Estimate supported cases after foundation; disclose scope resource and timing tradeoffs | Product owner |
| Plausible but wrong accounting | High and high | Independent expected results, review, reconciliation and treatment evaluations | Accounting lead |
| Cross-company disclosure | Medium and critical | Constraints, row security, authorization and hostile isolation tests | Security and backend leads |
| Duplicate stock or financial effects | Medium and high | Atomic commands, idempotency, concurrency and failure tests | Backend lead |
| Migration duplicates existing values | High and high | Staging, control-account reconciliation and cutover signoff | Implementation lead |
| AI authority or prompt injection escape | High and high | External policy enforcement, bounded tools, source isolation and adversarial tests | AI and security leads |
| Company knowledge repeats stale or conflicting facts | High and high | Exact source versions, effective dates, conflict review and freshness checks | AI and business knowledge leads |
| Memory exposes restricted information or continues after disablement | Medium and high | Derived-data permissions, audited controls, cache and in-flight invalidation, and lifecycle tests | AI and security leads |
| Manufacturing fit is assumed | High and high | Actual jeweller, batch, subcontract and WIP examples before sales promises | Manufacturing analyst |
| Payroll or tax rules are incomplete | High and high | Jurisdiction matrix, current rules, effective dates and customer-profile gate | Localization lead |
| Low subscription hides heavy support | High and high | Contribution by cohort including implementation, review and direct support | Commercial lead |
| Operator misuses customer access | Medium and high | Scoped case-based access, alerts and customer-visible records | Operations lead |
| App exfiltration or resource abuse | Medium and high | Isolated execution, scopes, network limits and revocation tests | Platform lead |
| Backup cannot restore an operating tenant | Medium and critical | Rehearse database objects keys identity queues and reconciliation | Operations lead |
| Rapid release corrupts historical meaning | Medium and critical | Versioned policies, migration rehearsal, compatibility and report snapshots | Release lead |
| AI provider changes price quality or policy | High and medium | Evaluated adapters, budgets, manual fallback and contract review | AI and commercial leads |
| Private deployment becomes an unsupported fork | Medium and high | Same artifacts support matrix entitlement terms and costed maintenance | Product and operations leads |
| Attractive UI hides slow or confusing work | High and medium | Observe unfamiliar users on real tasks in both themes and error states | Design lead |
| Unsubstantiated superiority harms trust | Medium and high | Evidence-backed claims, fair comparisons and documented limits | Commercial lead |

## Escalation rule

A critical financial, isolation, evidence-loss, or recovery defect stops affected production onboarding and release. Contain the impact, preserve evidence, reconcile effects, and identify the corrective action before resuming. Commercial pressure does not change the accounting meaning of a transaction or the authority needed to execute it.


## v2 architecture and design risks ? 13 November 2026

| Risk | Required gate / current limit |
| --- | --- |
| SQLite port silently drops RLS/SECDEF controls | Generated object inventory plus explicit policy/constraint replacement and PG/SQLite fixture equivalence; not yet passed |
| D1 cross-domain partial activation | Owning-transaction outboxes, idempotent saga and recovery; no cross-D1 atomicity claim |
| Duplicate tenant writer during move/restore | Generation fencing, reconciled tail and no second live copy; fail closed if uncertain |
| Prototype confused with live ERP | Isolated route, synthetic labels, network/write boundary tests and explicit simulation |
| Design coverage confused with finished UX | Requirement briefs versus interactive drafts tracked separately; owner task/visual review required |
| Offline stale authority/oversold stock | Signed bounded lease, branch stock policy, conflict inbox and retained evidence |
| Image rollback discards new records | Compatibility windows and forward repair after divergent writes |
| BI leaks denied accounts through totals | Filter before aggregation, scope-version cache keys and negative aggregate tests |
| Long reports starve POS/WAL | Reader/job budgets and measured concurrency/5m-line gates |
| Local backup mistaken for whole-node resilience | Off-node objects/keys/registry restoration and contracted RPO/RTO still required |
| New source paths escape syntax/deployment checks | Recursive checks and isolated design static-route tests |
| Governance reverted by older prompts | Committed governing-source copy, precedence manifest and resumable checkpoint |


## v2.3 risk additions

- Native SQLite port must replace PG RLS/functions deliberately; no connection-string migration or claim of full parity from a journal slice.
- Owner uniqueness requires existence/transfer checks; naming a role Owner cannot confer authority.
- Pending acceptance, canonical posting and delivery outbox must remain distinct after crashes, policy changes and lost ACK.
- Private composition must exclude vendor issuer/private keys/global billing at packaging and API boundaries, not just menus.
- Monthly offline licensing has unresolved grace/cutoff terms and root/VM clone limitations; no invented policy or destructive expiry.
- Local preview must stay authenticated/loopback by default; new public tunnel/DNS/service exposure needs explicit authority.
- Cramped repetitive design and mixed pseudo-icons require workflow-specific layouts and consistent SVGs; source tests do not replace visual/mobile/novice review.

## UI revision risks

Same-origin testing paths must not be mistaken for production origin isolation; prototype persona switches grant no authority. Private administration must not accidentally ship vendor issuer/global subscriber services. Full accounting UI, responsive/keyboard/owner review and authenticated native runtime remain incomplete. Archived frontend helpers must stay covered by regressions. Display-brand changes must not rename protocol/certificate/database IDs. Offline deferral must not remove sync/idempotency/permission contracts.

## First operational release risks

The two-hour expectation cannot substitute for missing workflows, independent live evidence or recovery. The new native runtime is bounded: substantial ACC/INV/commercial/workspace/AI scope remains. Never onboard clients merely because container tests pass. Existing reference data has not been migrated. Source and original-file retention are separate stores; failed metadata commits may leave orphans. Local-only backups share server failure risk; schedule/off-host recovery and fleet-safe upgrades remain release gates. Local AI has bounded memory/concurrency but needs actual inference evidence and cannot be presented as all-module AI. Exact hostname routing and worker/custom-domain conflicts require live checks before public cutover.

## Current residual risks ? Accounting-first revision

The additive schema 9 release cannot be opened by the retained schema 7/8 binaries under their newer-schema guard. It therefore does not prove rolling mixed-version deployment; use a reviewed bounded release window until explicit compatible readers/writers exist. The current tenant cache is unbounded and the migration executes on first open. Full-fleet backups still use a maintenance gate. These are open engineering gaps against the owner's high-availability and very-large-fleet goals, not achieved guarantees. Large report queries/registers still materialize full scoped results; pagination and measured memory/latency budgets remain required. Opening subledgers, taxes/withholding adjustments, returns/refunds/advances, bank reconciliation, statutory statements and broader Inventory are incomplete, so existing-client operational acceptance remains open.

The read-only backup-media rehearsal found that WAL-mode SQLite can require sidecar files during read validation. The restore script now validates temporary copies and rechecks the copied output hashes. Original backup media remain unchanged. Temporary validation needs additional disk space; retention, encrypted off-host recovery and coordinated restore keys remain release gates.
