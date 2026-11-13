# Frontend completion gates after the owner UI revision

The new root frontend is a work in progress. All255 requirements remain required. No module has been marked complete or owner-approved. Financial service activation and backend parity are later gates; the existing schema13 reference remains untouched.

## Sequence and review depth

| Order | Module group | Required frontend review before backend expansion |
| --- | --- | --- |
| 1 | Accounting | Full COA hierarchy/configuration, journal lifecycle, opening/recurrent/import/reversal, GL/trial/statements/notes/exports, close/reopen, resource/field denial and evidence states |
| 2 | Sales, purchases, payments, cash & bank, tax | Quotes/orders/receipts/invoices/credit notes, allocation/advances/refunds, bank import/match/reconciliation, tax registration/rule/version/recovery/withholding/return/control workflows |
| 3 | Inventory, manufacturing, POS, assets | Stores/UOM/lots/serials/cost layers/count/returns, BOM/routing/WIP/scrap/byproducts, shift/split tender/refunds/offline queues, acquisition/custody/depreciation/impairment/disposal |
| 4 | Workspace settings and business administration | Configurable modules, currencies/periods/dimensions, role/resource/field/approval rules, owner transfer/recovery, employee/AI seat distinction and support consent |
| 5 | SA7EN commercial and operator administration | Full onboarding/billing/entitlement/provisioning separated from fleet/staff/support/recovery, plus private local administration composition |
| 6 | Projects and CRM separately, HR/payroll, finance, BI, Drive, Apps and AI | Retain original catalog depth, integration contracts and individual frontend acceptance; no silent scope removal |

Offline infrastructure and application implementation follow main infrastructure; offline-compatible payloads, statuses, permissions and sync/error designs are required now. Frontend work does not authorize an independent offline business engine.

## Accounting increment delivered versus remaining

Interactive sample UI now includes account search/group expansion/detail, new/edit/archive constraints in a local chart, journal/source register, multi-line journal preparation and exact review, supporting filename/size previews, local sample draft save/restore, configured direct/review route illustration, account/date/text ledger with running balance and CSV, trial movements/closing balances and CSV, P&L/financial position/notes/source schedules and CSV, and close checklist/correction/evidence workflow explanations. Independent expected fixtures reconcile and date filters preserve accumulated versus period-profit meaning. No real posting, attachment upload, period lock or permission change occurs.

Still required before calling Accounting UI complete: deeper multi-level account templates/control/currency/reclassification configuration; full opening/reconciliation and recurring-rule interactions; real import mapping/error-row correction; linked reversal/correction lifecycle; approval queue/action/error/stale/version views; dimension/resource/field masks; report comparatives, cash flow, equity changes and statutory notes; saved report views, print/publication; complete close/reopen sign-off; comprehensive keyboard/mobile/large-table/assistive-technology and owner review. Some existing backend features have a retained legacy implementation but do not count as finished new frontend UX.

## Common workflow acceptance

Each module needs a coherent workspace, searchable/filterable register, create/edit/detail/source relationships, configuration, explicit save versus submit versus review/post states, appropriate documents/evidence, complete filtered exports/import preview where applicable, recovery/empty/error/denied/loading/unsaved/stale/partial-failure/offline/conflict states and accessible keyboard/touch/print layouts. Controls must explain the outcome and preserve input after failure. A specification brief is labelled as such.

The shared theme and original SVG icon family apply across all contexts. Business, commercial and operator navigation/search must stay contextual. Runtime server authorization is mandatory later; persona selectors and hidden UI items are demonstrations only.

Module acceptance requires dated workflow evidence and owner feedback captured in BUILD_STATE. A screen count, green parser, screenshot or arithmetic test alone is insufficient. Backend implementation may proceed against approved module contracts; do not claim the entire frontend or ERP is complete from this increment.
