# Small-action delivery checklist

Current scope: [owner revision](48-accounting-first-owner-revision.md). Exact source/live checkpoint: [CURRENT_HANDOFF.md](CURRENT_HANDOFF.md).

Generated from contracts/delivery-checklist.json. Update one action with tools/checklist.py. Source-tested and browser-tested do not mean released. No full-module completion is claimed.

## Accounting

| ID | Action | State | Evidence / limit |
| --- | --- | --- | --- |
| ACCOUNTING001 | Render only the selected accounting page | source-tested | tests/native-documents.test.mjs; tests/native-runtime.test.mjs; docs/CURRENT_HANDOFF.md; Bounded native increment; full module acceptance remains open. |
| ACCOUNTING002 | Expand Accounting subpages in the sidebar | browser-tested | docs/CURRENT_HANDOFF.md; Isolated browser saved/posted 75.35 and filtered matching GL. |
| ACCOUNTING003 | Make journal entry the Accounting landing page | browser-tested | docs/CURRENT_HANDOFF.md; Isolated browser saved/posted 75.35 and filtered matching GL. |
| ACCOUNTING004 | Persist incomplete journal drafts on server | source-tested | tests/native-documents.test.mjs; tests/native-runtime.test.mjs; docs/CURRENT_HANDOFF.md; Bounded native increment; full module acceptance remains open. |
| ACCOUNTING005 | Reject stale draft revisions | source-tested | tests/native-documents.test.mjs; tests/native-runtime.test.mjs; docs/CURRENT_HANDOFF.md; Bounded native increment; full module acceptance remains open. |
| ACCOUNTING006 | Submit exact saved revision | browser-tested | docs/CURRENT_HANDOFF.md; Isolated browser saved/posted 75.35 and filtered matching GL. |
| ACCOUNTING007 | Retain immutable numbers through cancellation | source-tested | tests/native-documents.test.mjs; tests/native-runtime.test.mjs; docs/CURRENT_HANDOFF.md; Bounded native increment; full module acceptance remains open. |
| ACCOUNTING008 | Allocate numbers atomically across sources | source-tested | tests/native-documents.test.mjs; tests/native-runtime.test.mjs; docs/CURRENT_HANDOFF.md; Bounded native increment; full module acceptance remains open. |
| ACCOUNTING009 | Duplicate manual journal into fresh draft | source-tested | tests/native-documents.test.mjs; tests/native-runtime.test.mjs; docs/CURRENT_HANDOFF.md; Bounded native increment; full module acceptance remains open. |
| ACCOUNTING010 | Recheck scopes on draft read and submit | source-tested | tests/native-documents.test.mjs; tests/native-runtime.test.mjs; docs/CURRENT_HANDOFF.md; Bounded native increment; full module acceptance remains open. |
| ACCOUNTING011 | Review exact source and scanned evidence | source-tested | tests/native-documents.test.mjs; tests/native-runtime.test.mjs; docs/CURRENT_HANDOFF.md; Bounded native increment; full module acceptance remains open. |
| ACCOUNTING012 | Approve and post independently once | source-tested | tests/native-documents.test.mjs; tests/native-runtime.test.mjs; docs/CURRENT_HANDOFF.md; Bounded native increment; full module acceptance remains open. |
| ACCOUNTING013 | Reject with reason and retained history | source-tested | tests/native-documents.test.mjs; tests/native-runtime.test.mjs; docs/CURRENT_HANDOFF.md; Bounded native increment; full module acceptance remains open. |
| ACCOUNTING014 | Return manual journal as linked correction draft | source-tested | tests/native-documents.test.mjs; tests/native-runtime.test.mjs; docs/CURRENT_HANDOFF.md; Bounded native increment; full module acceptance remains open. |
| ACCOUNTING015 | Return trade and stock through source-specific editors | todo |  |
| ACCOUNTING016 | Show preparer/poster/branch/project in GL | source-tested | tests/native-documents.test.mjs; tests/native-runtime.test.mjs; docs/CURRENT_HANDOFF.md; Bounded native increment; full module acceptance remains open. |
| ACCOUNTING017 | Filter GL by date account project and poster | source-tested | tests/native-documents.test.mjs; tests/native-runtime.test.mjs; docs/CURRENT_HANDOFF.md; Bounded native increment; full module acceptance remains open. |
| ACCOUNTING018 | Drill down GL to exact source | source-tested | tests/native-documents.test.mjs; tests/native-runtime.test.mjs; docs/CURRENT_HANDOFF.md; Exact accepted journal source/evidence opens; richer operational-document editor links remain. |
| ACCOUNTING019 | Create accounts within chart page | source-tested | tests/native-documents.test.mjs; tests/native-runtime.test.mjs; docs/CURRENT_HANDOFF.md; Bounded native increment; full module acceptance remains open. |
| ACCOUNTING020 | Add account hierarchy group and posting flags | todo |  |
| ACCOUNTING021 | Protect control accounts against generic adjustments | todo |  |
| ACCOUNTING022 | Separate financial position and profit pages | source-tested | tests/native-documents.test.mjs; tests/native-runtime.test.mjs; docs/CURRENT_HANDOFF.md; Bounded native increment; full module acceptance remains open. |
| ACCOUNTING023 | Add trial opening movement closing columns | source-tested | tests/native-documents.test.mjs; tests/native-runtime.test.mjs; docs/CURRENT_HANDOFF.md; Bounded native increment; full module acceptance remains open. |
| ACCOUNTING024 | Implement cash-flow statement reconciled to GL | todo |  |
| ACCOUNTING025 | Implement changes-in-equity statement | todo |  |
| ACCOUNTING026 | Implement descriptive financial notes and schedules | todo |  |
| ACCOUNTING027 | Add comparative statements and saved views | todo |  |
| ACCOUNTING028 | Implement opening trial import preview and mapping | todo |  |
| ACCOUNTING029 | Implement opening AR AP stock asset reconciliations | todo |  |
| ACCOUNTING030 | Implement recurring schedules with original anchors | todo |  |
| ACCOUNTING031 | Implement accrual and prepayment schedules | todo |  |
| ACCOUNTING032 | Complete journal reversal source/detail workflow | source-tested | tests/native-documents.test.mjs; tests/native-runtime.test.mjs; docs/CURRENT_HANDOFF.md; Bounded native increment; full module acceptance remains open. |
| ACCOUNTING033 | Complete close checklist and authorized reopening | todo |  |
| ACCOUNTING034 | Render journal print with company identity and totals | in-progress | Basic print/desktop checked; complete format/mobile/keyboard acceptance remains. |
| ACCOUNTING035 | Verify responsive keyboard and print journeys | in-progress | Basic print/desktop checked; complete format/mobile/keyboard acceptance remains. |
| ACCOUNTING036 | Rehearse upgrade on restored current data | source-tested | tests/native-documents.test.mjs; tests/native-runtime.test.mjs; docs/CURRENT_HANDOFF.md; Bounded native increment; full module acceptance remains open. |
| ACCOUNTING037 | Publish tested Accounting increment on testing-1 | source-tested | docs/accounting-revision-evidence.json; Published f125092 on testing-1;57 source blobs match; native and full GitHub checks passed. Not deployed. |

## Settings

| ID | Action | State | Evidence / limit |
| --- | --- | --- | --- |
| SETTINGS001 | Merge workspace and business admin navigation | source-tested | tests/native-frontend.test.mjs; Navigation only. |
| SETTINGS002 | Separate business profile from people and roles | source-tested | tests/native-frontend.test.mjs; Navigation only. |
| SETTINGS003 | Create branches and multipurpose location registry | todo |  |
| SETTINGS004 | Add named-user settings-page grants | todo |  |
| SETTINGS005 | Add role settings-page grants independent of ordinary role powers | todo |  |
| SETTINGS006 | Enforce page grants at server endpoints | todo |  |
| SETTINGS007 | Show effective settings access and protected boundaries | todo |  |
| SETTINGS008 | Add personal workspace preferences | todo |  |
| SETTINGS009 | Add periods currencies dimensions and document defaults | todo |  |
| SETTINGS010 | Add optional approval policies with direct-post default | todo |  |
| SETTINGS011 | Add module toggles preserving historical records | todo |  |
| SETTINGS012 | Add noneditable sequence settings and previews | todo |  |
| SETTINGS013 | Provide built-in immutable print formats per document | todo |  |
| SETTINGS014 | Duplicate standard format into custom version | todo |  |
| SETTINGS015 | Add logo and letterhead image upload | todo |  |
| SETTINGS016 | Add restricted HTML header and footer | todo |  |
| SETTINGS017 | Add header footer and field visibility per format | todo |  |
| SETTINGS018 | Add paper margins orientation repeated headings | todo |  |
| SETTINGS019 | Add print preview and document-type defaults | todo |  |
| SETTINGS020 | Pin template versions in historical outputs | todo |  |
| SETTINGS021 | Validate print HTML against script and network access | todo |  |

## Selling

| ID | Action | State | Evidence / limit |
| --- | --- | --- | --- |
| SELLING001 | Add selling dashboard and registers | todo |  |
| SELLING002 | Implement customer quotation draft lifecycle | todo |  |
| SELLING003 | Implement quote-to-order and quote-to-invoice | todo |  |
| SELLING004 | Implement direct service and goods invoices | todo |  |
| SELLING005 | Implement sales orders and partial fulfilment | todo |  |
| SELLING006 | Implement delivery GDN source links | todo |  |
| SELLING007 | Implement service completion evidence | todo |  |
| SELLING008 | Implement invoice before or after delivery matching | todo |  |
| SELLING009 | Implement bill-and-hold control evidence | todo |  |
| SELLING010 | Separate customer custody stock from owned valuation | todo |  |
| SELLING011 | Dispatch custody without duplicate revenue or COGS | todo |  |
| SELLING012 | Implement credit and consideration-based returns | todo |  |
| SELLING013 | Implement partial and multi-invoice returns | todo |  |
| SELLING014 | Reverse stock tax revenue and receivable consistently | todo |  |
| SELLING015 | Filter POS invoices with distinct numbering | todo |  |

## Buying

| ID | Action | State | Evidence / limit |
| --- | --- | --- | --- |
| BUYING001 | Add buying dashboard and registers | todo |  |
| BUYING002 | Implement supplier quotations and conversion | todo |  |
| BUYING003 | Implement optional purchase requests and orders | todo |  |
| BUYING004 | Implement direct and matched supplier bills | todo |  |
| BUYING005 | Implement GRN and service acceptance | todo |  |
| BUYING006 | Implement received-not-invoiced clearing | todo |  |
| BUYING007 | Implement billed-not-received ownership treatment | todo |  |
| BUYING008 | Implement partial two-way and three-way matching | todo |  |
| BUYING009 | Implement purchase return and debit notes | todo |  |
| BUYING010 | Implement partial multi-bill returns and refunds | todo |  |

## Payments

| ID | Action | State | Evidence / limit |
| --- | --- | --- | --- |
| PAYMENTS001 | Create canonical voucher for invoice-time receipt | todo |  |
| PAYMENTS002 | Create canonical voucher for invoice-time supplier payment | todo |  |
| PAYMENTS003 | Implement advances and unallocated balances | todo |  |
| PAYMENTS004 | Allocate earlier payments to later invoices | todo |  |
| PAYMENTS005 | Implement partial multiple-document settlements | todo |  |
| PAYMENTS006 | Implement reallocations without duplicate cash | todo |  |
| PAYMENTS007 | Implement customer refund of paid credit | todo |  |
| PAYMENTS008 | Implement supplier refund of paid credit | todo |  |
| PAYMENTS009 | Implement payment reversals and reopened balances | todo |  |
| PAYMENTS010 | Implement separate income and sales-tax withholding | todo |  |
| PAYMENTS011 | Link withholding adjustment journals to schedules | todo |  |
| PAYMENTS012 | Independently reconcile historical balances and controls | todo |  |

## Parties

| ID | Action | State | Evidence / limit |
| --- | --- | --- | --- |
| PARTIES001 | Add customer supplier and dual-role party record | todo |  |
| PARTIES002 | Implement receivables schedule and ageing | todo |  |
| PARTIES003 | Implement payables schedule and ageing | todo |  |
| PARTIES004 | Implement statement drilldowns and as-of filters | todo |  |
| PARTIES005 | Implement follow-up tasks and dispute status | todo |  |
| PARTIES006 | Implement reminder drafts and delivery history | todo |  |

## Taxes

| ID | Action | State | Evidence / limit |
| --- | --- | --- | --- |
| TAXES001 | Implement registrations and versioned tax rules | todo |  |
| TAXES002 | Implement sales tax input output recoverability | todo |  |
| TAXES003 | Implement income-tax balances and schedules | todo |  |
| TAXES004 | Implement income-tax withholding expected and actual | todo |  |
| TAXES005 | Implement sales-tax withholding expected and actual | todo |  |
| TAXES006 | Configure default expected and actual accounts | todo |  |
| TAXES007 | Allow validated per-document account overrides | todo |  |
| TAXES008 | Implement partial-payment withholding allocation | todo |  |
| TAXES009 | Implement certificates and remittance evidence | todo |  |
| TAXES010 | Implement linked journal adjustment differences | todo |  |
| TAXES011 | Reconcile tax schedules to source and GL | todo |  |
| TAXES012 | Add jurisdiction-specific verified tax packs | todo |  |

## CashBank

| ID | Action | State | Evidence / limit |
| --- | --- | --- | --- |
| CASHBANK001 | Implement cash bank account register | todo |  |
| CASHBANK002 | Implement cashbooks and bankbooks | todo |  |
| CASHBANK003 | Implement internal transfers once on both sides | todo |  |
| CASHBANK004 | Implement petty cash and count differences | todo |  |
| CASHBANK005 | Implement statement import and duplicate detection | todo |  |
| CASHBANK006 | Implement matching and split allocations | todo |  |
| CASHBANK007 | Implement dated reconciliation and outstanding items | todo |  |

## Inventory

| ID | Action | State | Evidence / limit |
| --- | --- | --- | --- |
| INVENTORY001 | Implement item groups and ungrouped items | todo |  |
| INVENTORY002 | Implement UOM conversion and precision | todo |  |
| INVENTORY003 | Implement batch and serial tracking | todo |  |
| INVENTORY004 | Implement GRN GDN and invoice matching | todo |  |
| INVENTORY005 | Implement stock counts and controlled variances | todo |  |
| INVENTORY006 | Implement damage by item batch or serial | todo |  |
| INVENTORY007 | Implement NRV write-down without quantity loss | todo |  |
| INVENTORY008 | Implement capped NRV reversal | todo |  |
| INVENTORY009 | Implement FIFO and specific-identification scopes | todo |  |
| INVENTORY010 | Implement landed costs and backdated costing | todo |  |
| INVENTORY011 | Implement reservations and returns | todo |  |
| INVENTORY012 | Reconcile owned stock custody physical and GL | todo |  |

## Assets

| ID | Action | State | Evidence / limit |
| --- | --- | --- | --- |
| ASSETS001 | Implement asset register and categories | todo |  |
| ASSETS002 | Assign immutable system and optional custom identity | todo |  |
| ASSETS003 | Capture acquisition and available-for-use dates | todo |  |
| ASSETS004 | Implement CWIP activation later without rewriting cost | todo |  |
| ASSETS005 | Reuse multipurpose branch location registry | todo |  |
| ASSETS006 | Implement straight-line reducing-balance units-of-production | todo |  |
| ASSETS007 | Implement prospective rate life residual method changes | todo |  |
| ASSETS008 | Apply reviewed changes to individual or group | todo |  |
| ASSETS009 | Implement revaluation impairment and reversal | todo |  |
| ASSETS010 | Implement custody transfer disposal and gain loss | todo |  |
| ASSETS011 | Reconcile schedule cost depreciation and carrying value | todo |  |

## POS

| ID | Action | State | Evidence / limit |
| --- | --- | --- | --- |
| POS001 | Implement profiles assigned users and locations | todo |  |
| POS002 | Restrict products groups and payment methods per profile | todo |  |
| POS003 | Implement fast keyboard barcode touch checkout | todo |  |
| POS004 | Implement cash received and change | todo |  |
| POS005 | Record received and change denomination counts | todo |  |
| POS006 | Implement split tender and external references | todo |  |
| POS007 | Separate POS invoice numbering and unified sales filters | todo |  |
| POS008 | Implement shifts floats close and cash reconciliation | todo |  |
| POS009 | Implement fast original-sale lookup and partial return | todo |  |
| POS010 | Share refund credit and stock-return kernel | todo |  |

## Fleet

| ID | Action | State | Evidence / limit |
| --- | --- | --- | --- |
| FLEET001 | Declare release schema read write and protocol ranges | todo |  |
| FLEET002 | Fingerprint immutable migration checksums | todo |  |
| FLEET003 | Implement additive expand backfill switch contract manifest | todo |  |
| FLEET004 | Implement bounded durable migration scheduler | todo |  |
| FLEET005 | Implement per-tenant leases attempts cursors and resume | todo |  |
| FLEET006 | Verify independent backup before invasive migration | todo |  |
| FLEET007 | Reconcile GL subledgers originals audit and objects | todo |  |
| FLEET008 | Implement canary pilot waves and pause thresholds | todo |  |
| FLEET009 | Fence node ownership generation and stale writers | todo |  |
| FLEET010 | Bound tenant connection cache and handle eviction | todo |  |
| FLEET011 | Preserve compatible mixed-version sessions and commands | todo |  |
| FLEET012 | Implement feature gates for not-yet-ready tenant schema | todo |  |
| FLEET013 | Exercise migration crash disk-full lock and corrupt-file cases | todo |  |
| FLEET014 | Measure per-tenant downtime and fleet throughput | todo |  |
| FLEET015 | Verify off-host encrypted restore and keys | todo |  |
| FLEET016 | Implement signed release reviewed CD and forward repair | todo |  |

## Later

| ID | Action | State | Evidence / limit |
| --- | --- | --- | --- |
| LATER001 | Complete customer commercial and infrastructure ops portal | todo |  |
| LATER002 | Complete manufacturing agreed MVP depth | todo |  |
| LATER003 | Complete Reports and BI including five-million-line benchmark | todo |  |
| LATER004 | Complete finance and planning | todo |  |
| LATER005 | Complete bounded AI workflows and usage | todo |  |
| LATER006 | Complete Drive and original-evidence lifecycle | todo |  |
| LATER007 | Preserve Apps APP-001 through APP-010 | todo |  |
| LATER008 | Complete CRM Projects and HR/payroll | todo |  |
| LATER009 | Complete Fully Private packaging and monthly licensing | todo |  |
| LATER010 | Complete offline companion and duplicate-free sync | todo |  |
| LATER011 | Complete managed-client acceptance gate | todo |  |
| LATER012 | Complete full market-ready MVP gate | todo |  |
