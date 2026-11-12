# Accounting delivery and verification

The owner's delivery order is accounting and cash & bank first, then the remaining operating modules, then further AI work. AI development is paused. The broad commercial release contract is retained; module navigation and a passing ledger test are not completion of the full accounting family.

## Working accounting increment

Schema 6 adds a dedicated accounting workspace with an account chart showing date-based openings, debits, credits and closing balances; account-specific running ledgers with pagination; a searchable transaction register covering all stored records rather than the workspace's latest 100; CSV export explicitly limited to the viewed page; account renaming and archival with reasons and retained history; and direct access to posting-period controls.

Cash & bank is a separate destination with cash books, independently approved bank/cash transfers, direct operating expenses and other income, plus the existing allocated customer receipts and supplier payments. Paid sales can use any permitted active cash/bank account rather than two hard-coded IDs. These record accounting transactions; no banking connection or actual transfer of money is performed.

Linked reversals produce the exact opposite of a posted general journal or direct cash transaction, in a valid open period. The original remains immutable and visible. An original can have only one pending or posted reversal, including concurrent attempts. Invoice, bill, settlement and stock corrections require their own subledger-aware workflows and are not represented as covered by general reversals.

## Bank statements and reconciliation

CSV columns are date,reference,amount. Dates use YYYY-MM-DD. Amounts use decimal strings with a minus sign for money out and no thousands separators. Quoted references are supported. Each statement currently supports 1 to 200 lines; arbitrary bank formats, many-to-one matches and automatic bank feeds remain pending.

Import checks opening plus movements against closing before saving. Imports are idempotent and cannot overlap an existing statement for the account. The first opening balance must equal the posted book balance before its start date, establishing an explicit baseline; unresolved opening reconciling items require a separate onboarding workflow and must not be hidden as a plug. Later statements begin on the next day and carry the previous statement closing balance.

Matching requires one posted journal's net movement in that account to equal one statement line exactly. Matching does not post journals. Bank charges and missing entries are prepared and independently approved through normal accounting first. Match removal requires an authorized reviewer and reason and remains attributed in the configuration history.

Closure requires every bank line matched, earlier statements closed, and the baseline plus cumulative cleared book movements equal to the statement closing balance. Another authorized reviewer must close the statement; its importer cannot self-close. Closed matching is fixed. Database posting controls reject subsequent postings into reconciled dates and before the imported opening baseline. Outstanding book entries remain visible for later reconciliation. Reopening a closed reconciliation is intentionally unavailable until its controlled correction policy is implemented.

## Required verification

Native PostgreSQL contracts state independent expected results: initial bank 1,000; expense 30; transfer to cash 100; reversal 30; bank closing 900; other cash income 50; total assets 1,050; profit 50. Filtered ledger opening 1,000, debits 30, credits 130 and running balances 970, 870, 900 must agree. Contracts also cover archival controls, imports/replays/overlap, unequal matches, unmatched closure, self-close denial, attributed unmatch, independent closure, immutable closed reconciliation, backdated posting denial, statement continuity, company scope and resource restrictions.

Runtime activation, owner-data preservation, actual hosted API checks, UI inspection, CI and database/object recovery require separate observed evidence in BUILD_STATE. Automated source and API tests do not establish visual or usability acceptance.

## Still required before accounting is complete

Continue the catalog for receivable/payable statements and ageing with actual due dates; credit/debit notes, returns, advances and refunds; hierarchical account groups and mapping administration; controlled opening subledgers and reconciliation; tax and withholding packs; recurring journals, accrual/prepayment schedules and allocations; foreign currency and remeasurement; intercompany and consolidation; year-end workflow; bank feeds/bulk matching and exceptional correction/reopening; policy schedules and professional statement packs. These cannot be marked done by this increment.

The operator portal remains separate from company settings: applications, subscriptions, entitlements, company lifecycle and case-scoped support still require implementation. HR/payroll, manufacturing and other catalog families remain required after accounting, with their actual workflows and acceptance examples rather than empty module pages.
