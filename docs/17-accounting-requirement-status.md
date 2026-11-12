# Accounting requirement status

12 November 2026. This matrix compares the actual module with the agreed accounting family. No whole-family completion or commercial release is claimed. The [implementation and acceptance boundary](16-accounting-delivery.md) gives the supported workflows; [BUILD_STATE](BUILD_STATE.md) distinguishes source, native tests, hosted acceptance and recovery observations.

| Requirement | Working scope | Remaining before the agreed requirement is complete |
| --- | --- | --- |
| ACC-001 Chart of accounts | Typed accounts, controlled categories, create, rename/archive, reasoned history and date-based balances and full-range export source | Hierarchical templates, effective-dated mapping changes and full setup administration |
| ACC-002 Opening position | Balanced trial-balance import or existing-GL reconciliation with retained evidence and linked AR/AP/fixed-cost stock openings; activated on testing with native and hosted acceptance | Negative/unapplied positions, FX, dimensions, asset registers, fractional/batch/layered stock, larger staged imports and governed opening corrections |
| ACC-003 Journal preparation | Balanced general journals, exact linked reversals and fixed-value recurring template source/native acceptance | Accrual/prepayment schedules, allocations, dimensions and policy-based evidence requirements |
| ACC-004 Posting kernel | Atomic balanced posting, immutable original records, retry and concurrency guards, linked general/cash reversals and supported credits | Extend the same contracts across every remaining module and correction case; wider release assurance |
| ACC-005 Period controls | Ultimate-owner period administration with reasons, lock enforcement and close review | Formal checklist sign-off, report snapshots, policy-governed reopening and exceptional approval route |
| ACC-006 Cash and bank | Cash books, internal transfers, direct expenses/income, allocated receipts/payments, account-ledger drill-through | Petty-cash imprest workflow, advances, withholding and wider tender/payment cases |
| ACC-007 Bank reconciliation | CSV import, arithmetic validation, duplicate/overlap/continuity controls, exact matching, independent closure, outstanding books and protected closed dates | Larger/asynchronous imports, bank format adapters/feeds, split or aggregate matching, unresolved opening reconciling items and governed reopening |
| ACC-008 Foreign currency | Decimal PKR amounts only | Currency rates, realized gains, settlement and period remeasurement |
| ACC-009 Intercompany | Separate company access and ledgers | Reciprocal documents, due-to/from and cross-company reconciliation |
| ACC-010 Consolidation | Individual-company financial reports | Group mappings, translation, eliminations and agreed consolidation scenarios |
| ACC-011 Close controls | AR/AP control reconciliation, unbalanced journals, pending dated entries, bank backlog and missing retained-evidence counts | Suspense/unusual-entry analysis, resolved/explained sign-off, inventory and policy schedules, formal close record |
| ACC-012 Correction history | Exact linked general/cash reversals; partial credit adjustments against unpaid service invoices and expense bills | Tax/goods corrections, paid-document refunds, settlement corrections and complete subledger reversal policies |
| ACC-013 Revenue and contract balances | Simple non-taxable service recognition | Milestones, deferrals, retention and approved recognition schedules |
| ACC-014 Provisions and credit losses | No evaluated provision engine | Impairment estimates, approval, utilization and reversals |
| ACC-015 Lease schedules | No evaluated lease engine | Contracts, measurement schedules, modification, posting and disclosures |
| ACC-016 Tax accounting schedules | Account placeholders do not implement tax | Current/deferred tax workpapers, temporary differences and reviewed postings |
| ACC-017 Financial and equity schedules | Ordinary ledger accounts only | Investment/debt/equity schedules, measurement and distribution approvals |
| ACC-018 Accounting previews | Exact previews for all currently supported transaction kinds, stale-preview rejection and shared command controls | Carry the contract into each future financial workflow; broader acceptance and usability review |
| ACC-019 Locked correction oversight | Immutable original postings and ordinary reasoned period controls | Ultimate-owner exceptional process, preserved report version, customer notifications and reliable email delivery |

Related progress includes SAL-006 and SAL-007 for supported credits and allocated receipts; PUR-004, PUR-006 and PUR-008 for expense bills, supplier credits and historical statements/ageing; RPT-001 for the ledger, trial balance, dated registers and ageing. These requirements remain **in progress**, with unsupported portions retained in the catalog. Cash flow, professional statements and descriptive notes are not established by the basic financial-report screen.

The operator administration portal, subscriber application/billing flows, HR/payroll, manufacturing and the rest of the suite remain required. They are not counted as implemented because a navigation destination or company-settings page exists. The owner's current instruction pauses further AI development until the software modules are built.

The owner clarified the immediate delivery priority and daily-use gaps on 13 November; see [bookkeeping completion](20-bookkeeping-completion.md). A distinct Payments module and configurable approval policies remain required, not substituted by general journals or unconditional administrator self-approval.
