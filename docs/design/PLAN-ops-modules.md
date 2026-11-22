# Plan — Inventory, Manufacturing, Assets, then the audit

Scope: a complete, working front end for the three operational modules, linked to the
accounting data already built, with every register filtered and exportable, every form
on its own page, and every rule written down so a backend team can implement it.

## Order of work

1. **Model** — one `ops-model.js` holding warehouses, stock movements, BOMs, work
   orders, work centres, asset categories and assets, with deterministic fixtures.
   Balances are always derived from movements, never stored twice.
2. **Inventory** — warehouse register, stock balances, movements, receipts, issues,
   transfers, counts, adjustments, valuation, reorder, reports, settings.
3. **Manufacturing** — BOMs, routings, work centres, planning, work orders (release →
   issue → produce → close), scrap, subcontracting, costing, reports.
4. **Assets** — categories, register, acquisitions, depreciation run, impairment,
   transfers, disposals, reports.
5. **Linking** — items shared with Accounting; stock movements carry project/location;
   purchases and sales invoices reference stock documents; manufacturing consumes
   stock and produces stock; assets capitalise from purchases; all derived numbers
   reconcile to the accounting fixtures.
6. **Settings** — warehouses, asset categories, inventory and manufacturing defaults
   join the Settings module.
7. **Audit** — every form against every workflow: fields, validation, register
   columns, filters, export, and the document lifecycle. Gaps are listed and closed.
8. **Docs** — module maps, backend contract notes, decision log, system map and
   handoff updated after each increment.

## Definition of done for each page

- Register with search, relevant filters, permanent scroll indicator, export, counts
  and totals that follow the filters.
- Full-page form that creates and edits, validates, and returns to its register.
- Numbers derived from the same source as every other page; no duplicated balance.
- States follow the universal lifecycle: planned/draft → released/posted → closed,
  with cancellation rules.
- Honest notes where posting to the accounting ledger is not wired yet.

## Status

All eight phases are implemented and audited; `FORM_AUDIT.md` holds the result and the
remaining bounded items.

## Honest limits

Posting from operations to the ledger, persistence and permissions are backend work.
The front end will carry the contracts for them and say so on screen.
