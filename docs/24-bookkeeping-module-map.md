# Bookkeeping foundation and module distribution

> Current owner revision: [Accounting-first scope](48-accounting-first-owner-revision.md), [compatible tenant upgrades](49-compatible-tenant-upgrades.md), and [small-action checklist](TASKS.md) govern conflicting sequence and expanded depth. Historical implementation claims below remain dated evidence, not completion of the new scope.

The owner restated the priority on 13 November 2026: build a capable accounting/bookkeeping product and its settings before further Drive, planning, BI or AI development. Existing optional tools may remain accessible; unfinished menu destinations do not count as delivered business capabilities. The original product, configuration, permission and commercial requirements remain required.

## Reference review

Reviewed Axelor's official [application catalog](https://axelor.com/all-the-apps/), [accounting configuration](https://docs.axelor.com/aos/en/aos/accounting/config_accounting/), [accounting entries](https://docs.axelor.com/aos/en/aos/accounting/acc_entry/), [invoicing](https://docs.axelor.com/aos/en/aos/invoicing/config_invoice/) and [payment configuration](https://docs.axelor.com/aos/en/aos/treasury/payment-entry/config-payment_entry/). These are functional references; no Axelor implementation code has been copied.

The useful design is the connection between shared company accounting setup, operating documents, payment methods/terms and linked ledger entries. Invoice/customer/supplier variants and accounting origins remain distinct even though they share the posting kernel. This complements the earlier ERPNext payment/workflow and QuickBooks reporting review.

## SAVEN responsibility map

| Area | Responsibility and linked workflows | Required foundation still to finish |
| --- | --- | --- |
| Accounting | Chart, journals/templates, opening/control reconciliation, ledgers, periods, corrections and close | Hierarchical templates, dimensions, general imports, complete schedules and professional statements |
| Company accounting settings | Defaults/mappings, fiscal policies, tax setup, numbering, payment terms and posting authority | Invoice account/term/price/footer defaults now affect proposed documents in schema-14 source; numbering, wider mappings and the remaining settings breadth remain required |
| Sales and invoicing | Customer records, document lines, pricing/discounts/tax, invoices/credits, source/delivery links and collections | Line documents, discounts and simple configured taxes are in schema-14 source; complete orders, fulfillment, line credits, pricing and wider invoice configuration remain required |
| Purchases | Supplier records, orders/receipts, expense/stock/asset invoices, credits, approvals and payables | Complete document/receipt/tax workflows; asset acquisition integration alone is not complete purchasing |
| Payments | Inward/outward money, counterparties, methods/references, allocations, advances, later applications, refunds and receipts | Deductions/withholding, paid-invoice refunds, corrections, instruments, batches and wider integrations |
| Cash and bank | Actual cash books, bank accounts, internal transfers, statements, reconciliation and clearing | Split/aggregate matching, cheque/deposit lifecycle, feeds and policy-controlled reopening |
| Taxes | Versioned registrations/rates/mappings, transaction calculation, tax registers, withholding, reconciliation and filing preparation | Schema-14 source implements effective-dated simple tax codes, line calculations, posted register and GL movement reconciliation; withholding, corrections, returns and country packs remain required |
| Fixed assets | Acquisitions, register, depreciation, ledger/payment integration and disposals | Full opening activation, policy methods, subsequent changes, custody and remaining asset requirements |
| Inventory | Item/store masters, receipts, issues/transfers, valuation, stock counts, returns and source links | Complete the costing/receipt/transfer lifecycle beyond opening fixed-cost issues |
| Manufacturing | BOM/routing, material consumption, production, WIP, finished goods and cost variances | No manufacturing module is claimed at this checkpoint |
| Workspace controls | People, detailed permissions, roles/scopes, conditional workflows, audit and module lifecycle | Complete named/multi-stage routing, dimensions and configuration depth; current policy scopes are only part of it |
| Operator portal | Subscriber/company provisioning, plans, suspension, support and attributed operations | Separate from company settings; not implemented by relabelling them |

## Acceptance standard

Each module must support a connected daily workflow: masters and defaults, source document, validation, actual preview, the configured direct/review route, posting, settlement/stock/asset effects, correction, full retrieval/search/export and reconciliation. Current native/hosted observations prove only the scenarios recorded in BUILD_STATE. No passing fixture substitutes for the remaining features, visual usability, performance or independent release assurance.
