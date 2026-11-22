# Form and register audit

Every form below was rendered and checked in this pass (an automated probe renders
every page and every editor; it reports zero failures). The table records what each
form asks for, what the register shows, and what was fixed in this round.

## Accounting

| Form | Fields | Register columns | Filters | Fixed this round |
|---|---|---|---|---|
| Journal entry | date, time, number, subtype, location, narration, **external reference**, lines (account, project, party, cost centre, debit, credit), evidence, audit strip, custom fields | date, voucher, description, debit, credit, state, type, subtype, party/sub-account, project, location, cost centre | party, subtype, project, location, centre, search | external reference added |
| Party | code, name, type, group, contact, phone, email, currency, terms, limit, opening, tax id, status, address, notes, **bank name, bank account**, allowed projects/locations | code, name, type, group, terms, limit, balance, status, ledger link | search, type, status, balance direction, balances as at | bank details added |
| Cash / bank sub-account | code, name, control head, kind, bank, branch, IBAN, currency, opening, status, notes, access | code, account, kind, control, status, postings, balance, projects, locations, ledger link | search, kind, control, status, balances as at | — |
| Item | code, **barcode**, name, group, unit, description, income/expense heads, sales and purchase tax defaults, tracked, prices, status | code, barcode, item, group, unit, heads, both taxes, stock | search, group, stock, status | barcode added |
| Receipt / payment | type, party, date, reference, tender rows (method, account/advance, reference, amount), **sales tax withheld %, income tax withheld %**, notes | date, reference, type, party, method, account, against, amount, withheld, net, state | search, type, party | withholding added |
| Sales invoice / bill | party, dates, terms, reference, location, narration, notes, lines (account, description, **project**, qty, price), record-payment tenders | date, number, party, **project**, due, net, tax, gross, returned, paid, balance, state, menu | search, party | project per line added |
| Return | original document, date, amount, reason, notes | date, return, original, party, net, tax, gross, reason | search, party | — |
| Chart account | code, name, accounting head, accounting group, control, description, state | code, name, head, group, control, currency, description, state, closing | search | audit confirmed |
| Trial balance | date range, head, group, search | code, head, group, name, opening dr/cr, period dr/cr, closing dr/cr | all four | audit confirmed |

## Settings

| Form | Fields | Fixed |
|---|---|---|
| Company | identity, registration, currency, fiscal year, period, week, timezone, date format, address block | — |
| Numbering | per-series prefix, next number, padding | — |
| Default accounts | eight selectors | — |
| Accounting head | code, name, head, group, control, description, state | group selector |
| Project / location / cost centre / party group / item group | full master-data fields with registers and form pages | — |
| Tax rule | kind, rate, basis, account, scope, effective dates, status, override, description, access | — |
| Withholding defaults | four rates, saved into the payment form | wired |
| Approvals | threshold and policy | — |
| Inventory / manufacturing defaults | costing, negative stock, accounts, warehouse; issue policy, BOM requirement, accounts | new pages |
| People, forms, views | full lists with filters | — |
| Print & templates | **one row per document** (17 documents) with size, logo, QR, copies, margin, footer; add and edit | new register |

## Inventory / Manufacturing / Assets

| Form | Notes |
|---|---|
| Warehouse, receipt, delivery, transfer, adjustment, count | registers filtered, forms write stock movements |
| BOM, work centre, work order, scrap, **subcontract** | subcontract send/receive now writes movements and closes the document |
| Costing | standard = item purchase price × quantity; variance shown |
| Asset, category, impairment, transfer, disposal | asset form gained serial, supplier and purchase document; register shows serial |

## Gaps found and fixed

1. Print formats were two generic templates → now a register per document.
2. No inventory or manufacturing defaults page → added to Settings.
3. Subcontracting was described only → send/receive flow implemented.
4. Costing had no standard → standard and variance added.
5. Invoice lines had no project → added, saved and shown in the register.
6. Payments ignored withholding → rates added, withheld and net shown.
7. Missing data fields: journal external reference, party bank details, item
   barcode, asset serial/supplier/document.
8. Registers missing those fields → columns added where they matter.

## Still open (stated, not hidden)

- Invoice tax is one rate per document; a per-line override is the next refinement.
- Withholding is computed and displayed but not allocated per invoice line.
- Negative stock is allowed by the sample data; the setting is not enforced yet.
- Depreciation and stock postings do not reach the ledger; print output is still the
  browser sheet rather than the template layout.
- The audit is a full render and field pass, not a proof of perfect business logic;
  each remaining item above is a known, bounded next step.
