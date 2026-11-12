# Bookkeeping completion and reference review

Owner feedback, 13 November 2026, supersedes the earlier implication that basic posted examples are a usable accounting module. The required product is a capable ERP made easier to use and configure. The original 239-requirement catalog remains required. Simpler forms do not authorize removing underlying workflows or capabilities. No module is complete merely because its navigation, a journal type or a few posting tests exist.

The current delivery order is accounting, cash and bank, a distinct Payments module, sales, purchases, inventory, manufacturing and taxes; then the planned workspace settings and working operator portal. Complete the remaining suite afterward. Further AI development is paused until the software workflows exist; eventual AI must operate through those same configured controls.

## Immediate acceptance gaps

| Area | Required behavior | Current implementation boundary |
| --- | --- | --- |
| General ledger | Search accounts and entries; export all selected records with opening, movements, running balances and closing | Full-range CSV and entry search added in source; native/hosted evidence recorded separately |
| Trial and financial reports | Export complete selected reports with exact balances; professional statements, cash flow and notes | Full trial and basic management P&L/balance-sheet CSV added; statutory pack, cash flow and descriptive notes still missing |
| Supporting evidence | Select/upload evidence while preparing journals, invoices and other supported documents; commit links with submission | Source accepts up to ten scanned company files in the same transaction; uploads remain retained if submission fails |
| Approvals | Configurable submission rights, document/amount conditions, optional independent approval, controlled administrator direct posting, effective policy history | Existing mandatory independent review remains until a tested policy mechanism is implemented; no silent role-wide bypass |
| Payments | Dedicated inward/outward records, any supported party, references, payment methods, bank identifiers, allocations and advances | Existing single-invoice receipt/payment is only a foundation; it is not the required Payments module |
| Imports | Templates, validation, mapping, preview, errors, safe retries and approved posting | Opening and bank CSV imports exist within their documented limits; general transaction/master imports remain required |
| Operating documents | Proper orders, receipts/deliveries, items, prices, discounts, returns and tax effects | Non-taxable service/expense examples do not establish these workflows |
| Configuration and portal | Practical permission/workflow/module administration plus separate subscriber/operator administration | Company settings do not constitute the required operator portal |

## Reference review

Primary references reviewed on 13 November 2026:

- [ERPNext Payment Entry](https://docs.frappe.io/erpnext/payment-entry): guided cash movements, party, references and allocations; standalone amounts and advances; multiple invoice references; deduction/currency treatment. A journal adjustment is a different operational event even when it uses the same posting kernel.
- [ERPNext Payment Reconciliation](https://docs.frappe.io/erpnext/payment-reconciliation): allocate already posted payments to references without posting bank movement again. Pending and posted amounts must remain separately controlled.
- [ERPNext Workflows](https://docs.frappe.io/erpnext/workflows): document states, role transitions and conditions; ordinary submission differs from a configured approval workflow. The SAVEN policy must be explicit, audited and consistent across UI, API and future AI.
- [ERPNext open Payment Entry schema](https://github.com/frappe/erpnext/blob/develop/erpnext/accounts/doctype/payment_entry/payment_entry.json): reviewed party, payment account, reference and tax/deduction field structure as a functional reference. No ERPNext implementation was copied into this proprietary repository.
- [QuickBooks data/report export](https://quickbooks.intuit.com/learn-support/en-uk/help-article/list-management/export-data-reports-lists-quickbooks-online/L1xleDrLp_GB_en_GB): downloadable general ledger, trial balance, P&L and balance sheet are ordinary reporting expectations.

These references establish behavior to evaluate, not a claim of parity with either product. Continue the review across each operating module, including small daily-use functions, before marking that module complete. Maintain the gaps alongside implementation and concrete accounting scenarios.

## Export and evidence contract

Complete CSV exports use one read-only repeatable PostgreSQL snapshot and ignore screen pagination. A selected account export and a matching register export are separate from exporting every ledger. A request exceeding 100,000 detail rows fails explicitly and produces no partial file; larger asynchronous exports remain required. CSV quoting neutralizes formula text while retaining legitimate negative numbers. Reports require complete company resource access and private no-store responses.

Submission accepts up to ten distinct clean company file IDs. The uploader scans bytes first; document insertion, retained evidence links, revision, file audit events, operation and outbox commit atomically. Quarantined, removed, personal, foreign-company or currently restricted evidence is rejected. A failed submission may leave its uploaded source in Drive for retry; it cannot leave a half-submitted document. Approval still checks the evidence revision.
