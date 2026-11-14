# Native customer invoices, supplier bills and allocated payments

14 November 2026. This is another increment toward the owner's immediate managed-client operational release, while the full market MVP remains required. It does not declare Accounting, Inventory or client onboarding complete.

## Working scope

The live native application has Invoices & bills and a separate Payments workspace. It creates company/branch customer and supplier records, multi-line service invoices and expense/asset bills, original references and due dates. Amounts use exact two-decimal minor units in the business currency. The forms intentionally do not represent quantity/rate calculation, tax calculation or a physical stock purchase/sale.

Receipts and supplier payments allocate a positive amount to one or multiple posted invoices/bills for the same party, company and branch. Partial settlement is supported. Cash/bank must be an active asset account outside the trade/stock controls. The server rechecks unpaid amounts and source-account access when posting or approving; a stale accepted allocation never silently overpays. Same operation replay posts once. A posted party/type/reference cannot be reused through a new operation ID.

Invoices, bills and settlements use the existing balanced posting, exact resource/amount policy, independent approval when required, period lock, entitlement, evidence, audit and outbox transaction. They do not have a second financial engine. Journal preparation/read/post/approval permissions currently govern these accounting transactions. Optional promised original evidence must be retained and clean before posting. The invoice UI supports this existing scanned evidence flow; the payment API also accepts promised evidence, but payment attachment controls are not yet in that screen.

Historical unpaid reports apply both document and settlement posting dates. The protected owner additionally sees AR/AP control reconciliation. CSV register/line exports and individual source printing are present; print-format design remains a separate requirement. Posted lines, parties, operations and allocations are retained and immutable.

Activating a customer/supplier control refuses any pre-existing manual posting history in that company/branch until an explicit opening-subledger reconciliation exists. It never manufactures customer balances or rewrites old journals. Once activated, unlinked manual journals cannot post to that trade control. A trade source cannot be reversed through the ordinary journal correction screen, because that would leave its subledger unpaid amount wrong.

## Verification and deployed increment

Eight native trade contract groups cover independently expected balances, dated unpaid reports, partial/multiple allocations, exact cents, repeated IDs/references, stale overpayment, foreign party/direction/date, original clean evidence, period locks, revoked access, independent approval, failed-write rollback, immutable sources, control-source enforcement and existing-history refusal. The final full local suite passed 149 tests and 152 JavaScript files parse. Both generators and plan validation pass. The final Linux image independently passed 54 focused contracts.

A stopped backup/independent restore retained 12 databases and four original objects. The new image upgraded all eight restored tenant databases to schema 7, authenticated the existing operator, and independent Python comparisons found all 190 pre-existing tenant tables unchanged. Only a new checksummed tenant migration is appended; historical migration checksums are preserved. Identity remains schema 3.

The public synthetic workflow on the real application/operator origins created an isolated QA business only. Invoice 100.03 less receipt 60.02 left AR 40.01; bill 40.01 less payment 10.01 left AP 30.00; cash was 50.01. Both control differences were 0.00. Replay posted once, overpayment was refused and an operator-realm cookie could not read the application. Actual browser sign-in with the existing owner confirmed both deployed workspaces. No client records were imported or main promoted.

## Required continuation

Complete operational credit notes, debit adjustments, refunds, advances and correction/cancellation before describing the trade cycle as complete. Also required: configured taxes/withholding, quantity/rate and inclusive/exclusive calculations, opening subledgers, recurring/accrual workflows, bank reconciliation, FX/currency precision, party statements/ageing bands, richer contacts and document settings, statutory statements/notes and the remaining ACC scope. Full Inventory, commerce, settings/printing, recovery/off-host delivery, identity and bounded AI scope remains in docs42 and the governing catalog. These are retained requirements, not removed scope.

An older Docker image cannot reverse a schema upgrade. Retained pre-upgrade backup and independent restored directory are the recovery basis; after new writes, rollback requires an explicit data-aware recovery decision. Continue on testing-1 and preserve all customer/reference records.

Final deployed image: saven-native:trade-20261114-b, immutable ID sha256:d24a9827557584529b3f6f8ec045e84516ae24d3e4ad19323e2473fea209cb1e. Both approved public health endpoints returned 200. A subsequent backup independently restored 13 databases and four objects, then the restored trade business still reconciled both posted documents with zero control differences.
