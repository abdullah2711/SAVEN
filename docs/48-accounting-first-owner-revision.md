# Accounting-first owner revision — 14 November 2026

This is the newest owner direction. It supersedes conflicting sequencing in earlier plans, not their unfulfilled scope. Source development is on testing-1; main represents the reviewed deployed release. Frozen saventesting stays deployed. Completion requires working commands, realistic forms, independent financial checks, recovery and browser acceptance, not menu coverage.

## Delivery order and release boundaries

1. Accounting: journals on the landing page, draft/register/detail/duplicate/review/reversal, GL, trial, chart with its own new-account form, separate statements, opening, recurring, accruals, periods, audit and printing.
2. Settings: one module containing business administration and workspace settings, separated into useful subpages. General settings access is independently delegated to named users or roles; transaction authority still uses normal permissions. Ordinary users get only their permitted settings pages. Protected owner authority cannot be delegated through a page grant.
3. Selling, Buying, Payments, Customers & suppliers, Taxes, Cash & bank, Inventory, Assets and POS with the connected workflows below. Complete them module by module; do not crowd all screens into a single page.
4. Broader commercial/operator completion at ops.economicsystems.cc, then Manufacturing, Reports & BI, Finance & planning, AI, Drive, Apps, CRM, Projects, HR and remaining agreed scope. Essential existing identity, entitlement, backup and security controls continue throughout.

Existing managed-client operational readiness and the full market-ready MVP are separate gates. Both retain the agreed financial safeguards. No client onboarding is implied by a passing test suite.

## Module/subpage map

| Module | Required subpages and workflows |
| --- | --- |
| Accounting | Journal entry landing; journals and server drafts; approval detail; GL with date/account/branch/project/actor and source drilldown; trial; chart of accounts and account form; statement of financial position; profit or loss; cash flows; changes in equity; notes; opening/reconciliation; recurring/accrual/prepayment; periods/close; correction history |
| Settings | Business/company profile; branches and multipurpose locations; financial years/currencies/dimensions; people; roles; assignments; separate settings-page delegation; approval policies; module configuration; numbering; document defaults; letterheads; print-format library/designer; personal workspace preferences |
| Selling | Dashboard; customers; quotations; sales orders; invoices; delivery/GDN; service completion; returns/credits; linked receipts; unbilled deliveries and undelivered billed quantities. Direct quote-to-invoice or quote-to-order is allowed; orders and delivery paperwork are optional where appropriate |
| Buying | Dashboard; suppliers; requests/quotations; purchase orders; bills; GRN; service acceptance; returns/debits; linked payments; received-not-billed and billed-not-received matching. Direct bills and quotation conversions are allowed |
| Payments | Receipt vouchers; payment vouchers; advances/unallocated money; allocations/reallocations; refunds; reversals; withholding components and certificates. A payment entered inside an invoice creates the same independent voucher and allocation as the Payments page |
| Customers & suppliers | Parties, customer/supplier roles, receivables, payables, dated ageing, statements/schedules, follow-ups, disputes, reminder drafts/history. Sending reminders requires an explicitly authorized delivery workflow |
| Taxes | Registrations/rules/effective dates; sales tax/VAT input/output; income tax; income-tax withholding; sales-tax withholding; expected deductible balances; actually deducted balances; certificates/remittances; reconciliations/returns. Jurisdiction/rate/legal triggers are configured and verified, never guessed |
| Cash & bank | Account register; cashbook; bankbook; transfers; petty cash; statement imports; matching; reconciliations; unmatched/duplicate exceptions and dated reconciliation reports |
| Inventory | Dashboard; items/groups including ungrouped; UOM/conversions; locations/stores; balances; movements; GRN/GDN and source links; reservations; counts/adjustments; batches; serials; damage/write-off; NRV/impairment/reversal; cost layers/landed costs; returns and reconciliation |
| Assets | Register; categories; acquisitions/CWIP; available-for-use activation; custody/locations; depreciation methods/schedules/runs; prospective estimate changes; valuations/revaluations; impairments/reversals; transfers; disposal; reconciliation. System identity is permanent and custom identity is separate |
| POS | Profiles; user/location assignment; product/group restrictions; allowed tender methods/accounts; tills/shifts/opening/closing; fast cart; split tenders; cash received/change; denomination counts; receipts; fast original-sale lookup and partial returns/refunds. POS invoices have their own permanent series and are filterable in Selling |

## Shared document contract

- Save incomplete drafts on the server; optimistic revisions prevent overwriting another edit. Draft saving does not post, reserve stock or create tax/receivable balances. Edit only drafts. Submission freezes the exact accepted payload, then posts directly by default if the user has posting authority and no configured review requirement.
- Review requests expose the exact source, lines, dimensions and evidence. Approve rechecks current rights/periods/entitlement and posts once. Reject retains reason/history. Return retains the original submission and opens an attributable linked draft revision for correction; submitted bytes are never silently edited.
- Duplicate creates a new draft identity with new number and resets settlement, approval, stock effects and evidence attachment promises. Original source remains linked. No duplicated payment or returned stock occurs from copying a form.
- System numbers are allocated transactionally, noneditable and never reused after cancellation/rejection/deletion. UUID/idempotency identity remains separate from the human voucher number. Historical references remain readable.
- Posted financial sources are retained. Cancellation uses an operational reversal/credit with date, reason and source links, not deleting GL history. Reversal of stock, tax, invoice and payment must use their own reconciled operational workflow.
- Every source and GL row exposes preparer, actual posting/approval actor, company, branch, optional project, dates and immutable source links. Project register enforcement and line-level dimensions remain required beyond a free reference.
- Forms need document header, clear numbered lines, exact totals/difference, attachments, status/history, save/submit/duplicate/cancel actions and responsive print layouts. Preserve input and stable retry identity after failure. No successful-looking mock commands.

## Cross-module accounting rules

Physical fulfilment, invoicing, revenue recognition and cash settlement are different events. The owner explicitly requires either-order invoices/receipts/deliveries, partial matching and no duplicate recognition. A sales invoice before control transfers normally debits receivable and credits an appropriate contract/deferred-income liability; fulfilment clears that liability to revenue and separately records cost of sales/inventory. Delivery before billing may recognize a contract asset/unbilled receivable if the configured recognition policy supports it. Billing after recognized delivery clears that asset rather than recognizing revenue twice. Whether a receivable exists and whether control has passed depend on the contract and configured recognition policy, not only a checkbox called update stock. Service completions use performance evidence and never invent physical movements.

Purchase receipt before bill normally debits inventory and credits goods-received-not-invoiced. Later billing clears that liability against payable with supported price/tax variance treatment. Billing before receipt uses a configured goods-in-transit/prepayment/clearing treatment consistent with control and recognition, not a forced inventory debit. Source quantities/values, partial matches, dates and reversals must reconcile across GRN/GDN, Selling/Buying and stock.

Payments before invoices are party advances/unallocated balances, later matched without a second cash journal. Invoice-time payments create canonical vouchers and allocations atomically with their owning tenant transaction. Net cash plus valid withheld components settles the gross allocated amount. Sales-tax and income-tax withholding are separate components with separate account defaults and per-document overrides. Expected deductions at invoice time must remain distinct from legally recognized tax credits/liabilities; only a jurisdiction/policy-validated trigger reclassifies expected deductible to actually deducted, with partial-payment proportionality, certificate evidence and reversal handling. Supplier withholding payable is distinct from customer tax-credit assets.

Damage can target item/location, selected batches or serials, with remaining quantity/value validation. Physical loss and NRV write-down are distinct; NRV does not silently remove units. Reversal cannot exceed the original write-down or restored cost. Asset depreciation starts when available for use; estimate/method changes are prospective where required, with effective dates and review. Methods are supported explicitly (straight-line, reducing balance, units of production, etc.), not an unchecked promise of every imaginable method.

## Print-format contract

Settings owns a document-type-specific format library. Built-in originals are immutable. Duplicate/create a custom version, name it, configure enabled fields/columns, number/date/party/tax/stock/payment blocks, page size/margins/orientation, logo, letterhead, header/footer toggles, image or restricted HTML content, repeat headings, totals/signatures and defaults. Business identity is common data; each format controls its presentation. Preview uses the same authorized source as final print/export. Untrusted HTML must be sanitized/isolated with no script/network/secret access. Historical prints retain a template/version reference. Rich designer/PDF output remains required, not satisfied by a few text settings.

## Research used for design (14 November 2026)

- [ERPNext Sales Invoice](https://docs.frappe.io/erpnext/sales-invoice), [Purchase Invoice](https://docs.frappe.io/erpnext/purchase-invoice), [Delivery Note](https://docs.frappe.io/erpnext/delivery-note), [Accounting Entries](https://docs.frappe.io/erpnext/accounting-entries): optional source paths, separate physical receipt/delivery and financial documents, linked partial fulfilment and returns.
- [ERPNext Print Settings](https://docs.frappe.io/erpnext/print-settings), [Customize Print Format](https://docs.frappe.io/erpnext/records-print-format): document-specific formats and letterheads.
- [IFRS 15](https://www.ifrs.org/issued-standards/list-of-standards/ifrs-15-revenue-from-contracts-with-customers/), [IAS 2](https://www.ifrs.org/issued-standards/list-of-standards/ias-2-inventories/), [IAS 16](https://www.ifrs.org/issued-standards/list-of-standards/ias-16-property-plant-and-equipment/): control/performance-based recognition, lower-of-cost/NRV, asset cost/depreciation. These guide engine design; jurisdiction-specific tax/legal settings need their own verified pack.

Fleet upgrades and availability are governed by [the upgrade contract](49-compatible-tenant-upgrades.md). The small-action queue is [TASKS.md](TASKS.md), generated from contracts/delivery-checklist.json. Current source/live evidence and exact resume instructions are in BUILD_STATE.md and CURRENT_HANDOFF.md.

## Same-day owner clarification: bill-and-hold and withholding adjustments

The owner explicitly requires billing when control/responsibility has passed but goods remain in the warehouse until customer collection. This is a distinct bill-and-hold/custody workflow. Record substantive customer request, identified/segregated goods, readiness, control date and prohibition on resale/redirection. Recognize revenue and related cost when control passes under the supported policy; remove the goods from owned stock value but retain customer-owned physical custody quantities until dispatch. A dispatch releases custody once, without a second revenue/cost posting. A liability is used for an actual unsatisfied obligation, not as an artificial offset to keep customer-owned goods in owned inventory. Optional custody-service obligations are separately assessed. User feedback used the phrase to-be-delivered liability; the engineering interpretation preserves physical tracking without overstating owned assets/liabilities. This distinction must remain visible for owner review before enabling that posting mode.

The owner allows journal adjustments where expected and actual withholding differ. Provide a linked, separately numbered adjustment voucher with party, invoice/payment, tax component/period, reason and authority. Tax schedules must consume those adjustments and reconcile to the GL. Generic journals cannot silently bypass a protected subledger/control account. No tax law trigger or rate is inferred from this permission.

Reference: [NZ IFRS 15 B79?B82, standard setter](https://standards.xrb.govt.nz/standards-navigator/nz-ifrs-15/).
