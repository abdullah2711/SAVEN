# Linked invoice and supplier credits — development increment

14 November 2026, Asia/Karachi. Development on testing-1; the deployed app/ops remains the schema-7 workspace image on main described in docs46. This document does not claim that credits have been released to the public service.

## Supported behavior

A customer credit or supplier credit identifies an immutable posted invoice/bill and original line numbers. The server derives its accounts, direction, company, branch and party from that source. Users enter exact two-decimal credit amounts, effective date, reference and reason, with optional original evidence. Each line is capped by its uncredited source amount and the total by the invoice/bill's currently unpaid balance. Paid-credit balances need the separate refund/advance workflow, which remains unfinished.

Accepted credit receipts, posted effects and review states remain distinct. The new tenant migration 8 appends credit metadata and immutable line records without changing any prior migration. Pending credits do not reduce unpaid balances. The existing journal kernel controls authority, current original-source access, review/direct policy, period lock, entitlement, exact balanced journal, evidence scan, audit and outbox. A current role named Owner cannot duplicate protected ownership. No stock movement or tax rate is invented by crediting a service/expense document.

Competing credits and already prepared settlements recheck the remaining source balance at commit. Duplicate operation replay cannot post another credit; reusing an identifier for another reason or amount fails. Historical reports separately show original, credited, settled and outstanding amounts using the credit's posting date. AR/AP control totals still reconcile. Original invoices, bills, allocations and journals are retained. Corrections are traceable new sources, not edits to history.

The invoice/bill source screen provides a linked credit editor, remaining source amounts, reason/reference/date fields and scanned supporting-file entry. Credit notes appear against their original document. Payment entry also now offers the already-supported original evidence attachment flow. Credit/refund print-format depth and paid-balance refunds are not represented as complete.

## Observed development verification

Five focused source groups cover partial customer/supplier credits, historical cutoffs, independently expected source/GL balances, repeated operations, stale competing credits, source-line and unpaid limits, review, revoked access, period controls, original account scope, failed-commit rollback and promised clean evidence.

The isolated real-browser journey opened invoice INV-0001 in a local synthetic native business, posted CN-UI-0001 for 250.50 and returned to a register showing original 25,000.00, credit 250.50, settlement 12,000.00 and unpaid 12,749.50. Subledger and ledger each read 12,749.50 with difference zero. This was not a public/client transaction.

An independent restore of the existing 13-store/four-object backup upgraded all nine restored tenants to schema 8. Independent SQLite comparisons preserved every row in 227 original tenant tables. The live data directory, running workspace image and current main behavior were not migrated or replaced by that rehearsal.

## Required continuation

The complete development source passes 128 active tests, 59 focused Linux contracts and 136 active JavaScript parse checks, with both generators and plan validation passing. Source is published on testing-1. A fresh deployment-specific backup, current-data rehearsal and controlled release are still needed before public activation. Continue paid credits/refunds, receipt/payment reversals, advances, configured tax/withholding and quantity/rate calculations, opening subledgers, recurring/accruals, bank reconciliation, broader inventory costing/counts/returns/UOM and the remaining documented suite. The existing 255-requirement scope remains active. This bounded unpaid-credit workflow is not full Accounting or market MVP completion.
