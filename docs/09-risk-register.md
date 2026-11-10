# SAVEN Risk Register

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
