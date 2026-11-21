# Design session handoff — SAVEN accounting UI

Paste this file at the start of a new session. It is the whole context.

## What this is

A working design build of the SAVEN/SA7EN accounting UI, served from the owner's
machine. No database, no backend, no posting. Fixtures only. The owner reviews it
through the live tunnel and gives feedback; every decision is recorded here and in
`DECISIONS-2026-11-21.md`.

- Repository: `/home/esc/saven/wt-design-theme`, branch **`opencode/design-theme-v1`**
  (never merge; push to origin after every change).
- App: `docs/design/save/` — the **exact** saventesting build (shell, rail, search,
  theme toggle, dialogs, toasts) plus added screens.
- Library: `docs/design/docs/` — module catalogue, rendered at savenui.
- Live: **https://savenuitest.economicsystems.cc** (app) and
  **https://savenui.economicsystems.cc** (library), through a Cloudflare tunnel
  (`savenui-design`, config `~/.cloudflared/savenui-design.yml`, origin
  `127.0.0.1:8795`, server `~/saven-preview/server.mjs`).

Run locally: `node /home/esc/saven-preview/server.mjs`, then
`http://savenuitest.localhost:8795/`. Host routing picks the root: `Host:
savenuitest.localhost` → `docs/design/save`.

## Hard rules

- The shell is the owner's: do not restyle it. Change screens inside it.
- No inline `style=` attributes: the build's CSP (`style-src 'self'`) blocks them.
  All layout lives in `theme.css` classes. (Exceptions already in the build are the
  design-system's own.)
- No placeholder copy ("sample", "design example"). Real values only.
- Money: decimal, two places, right-aligned and tabular. Dates ISO in data, short in
  tables.
- Every figure must derive from the fixture; if it cannot, say so on screen.
- Document decisions as they are made (this folder). The docs are the contract.
- Never claim a fixture behaviour is production functionality.
- Chat attachments cannot be read from this session. Files must be placed in the
  repository, or their markup pasted as text. The two supplied Flaticon glyphs
  (print, vertical menu) now live in `docs/design/save/ui/icons/` and are inlined
  in `ui/icons.js`; attribution is in `docs/design/ASSETS.md`.

## Where things live

| Path | Contents |
|---|---|
| `docs/design/save/ui/app.js` | shell, rail, routing, page map wiring |
| `docs/design/save/ui/accounting-ui.js` | chart, journal register/editor, trial balance, statements, setup routing, single-select picker (`ss`) |
| `docs/design/save/ui/accounting-setup.js` | opening balances, recurring journals |
| `docs/design/save/ui/screens.js` | dashboard, ledger, journal register + record, projects/locations pages, parties, taxes, setup, multi-select (`ms`) |
| `docs/design/save/ui/accounting-model.js` | fixture ledger (~199 documents), chart, numbering, projects, locations, cost centres |
| `docs/design/save/ui/pages-map.js` | module → page map, single source for rail and docs |
| `docs/design/save/ui/theme.css` | their stylesheet plus our component classes at the end |
| `docs/design/*.md` | decision log, module map, workflows, backend contract, forms/views, page register |

## Current state

**Built and working**

- Accounting dashboard: KPI cards, cash chart, ageing, attention list, recent
  journals.
- General ledger: multi-select filters with search in every dropdown, column
  chooser, sorting, row expand, CSV, and a totals strip above the table (filtered
  debit, credit, net, line count, plus the whole-period totals when filtered).
- Journal register + record page: columns mirror the form, per-column filters,
  sorting, state-aware actions.
- Journal form: auto-numbering (`JV-MM-YYYY-0001`), posting time, guards (no future,
  no date before business start, no closed period), subtype, one **header location**,
  party/sub-account filtered by account kind, project, cost centre, review panel,
  evidence drop zone, print + overflow menu, always-visible horizontal scroll track.
- Chart of accounts, trial balance, statements.
- **Projects** page (Accounting): read-only register and a dashboard with
  statistics per accounting head. Created in Setup.
- **Locations** page (Accounting): same, with `kind` (office, branch, outlet,
  warehouse, site). Created in Setup.
- **Setup**: organisation, numbering, default accounts, approvals, **projects and
  locations with create forms**, **accounting heads with a create form**,
  **party & sub-account membership**.
- Supplied print and vertical-menu glyphs wired into the journal header.
- Taxes page with five tabs. 20 modules and 154 pages mapped; planned pages render
  their specification.

**Known gaps**: quick entry grid; forms register; bank/cash reconciliation; payments
allocation; invoices; item master; period lock enforcement; membership is
display-only; no persistence (reload returns to fixtures).

## Decisions already made (do not re-litigate)

- **Location** is one field on the journal header — where the entry was made. A
  **branch is a location with kind `branch`**; there is no separate branch concept.
  Moving balance between locations is two entries.
- **Project and location are plain data fields**: created in Setup, chosen on the
  journal (project per line, one location per voucher), used to slice reports.
  Accounts stay generic; dimensions never carry a balance.
- **Balances are not sliced by project/location.** P&L by dimension works from
  tagged lines. A control balance can only be sliced from the party/open-item
  subledger, with an unallocated bucket — deferred until that subledger exists.
  Parties and sub-accounts may record which projects/locations they belong to
  (blank = all); it is a data field, not a balance and not access control.
- **No entry type.** A voucher is a journal entry; the **subtype** classifies it
  (bank, cash, contra, expense, debit/credit note, depreciation, accrual,
  prepayment, write off, opening, adjustment, reversal). `adjustment` is the only
  subtype where a control line may omit the party.
- **Cancel / delete / reverse.** Cancel removes the ledger effect but keeps the
  register row; delete removes it from the register (draft or cancelled only);
  numbers are never reused; the audit log is the permanent record; reversal is
  optional, used only when the correction must stay visible.
- **Identity fields.** Created by / created at / source (User or AI) and submitted
  by are separate; more than one person may be involved.
- **Accounting heads are created in Setup** and appear immediately in the chart,
  the journal picker and the reports. Control heads require a party on every line.
- **Business switching happens at sign-in.** The topbar shows the active business as
  text, never a dropdown.
- Posting guards: no future time, nothing before business creation, nothing in a
  closed period.

## How to verify a change

1. `node --check` every edited file.
2. Screenshot:
   `firefox --headless --window-size=1440,1200 --screenshot out.png "http://savenuitest.localhost:8795/#module=accounting&tab=journals&mode=editor"`.
3. For behaviour, build a probe page in `docs/design/save/` that imports the module,
   drives the DOM and prints results into a fixed `<pre>`, screenshot it, then delete
   the probe. This is how the dropdown bug and the setup/membership flows were
   verified.
4. `node docs/design/build/make-page-docs.mjs` after touching the page map.
5. Commit and push.

Known trap: duplicate function definitions silently win (the later one overrides).
Check with `grep -c "function editor"`. Also `grep` for the old identifier after a
rename.

## Next

- Owner is reviewing the data-field treatment of Projects/Locations, the ledger
  totals and Setup heads. Wait for that review before starting another module.
- Open naming question: two rail entries called “Projects” (Accounting dimension page
  and Operations module). Decide whether to rename one.
- Then: parties register (with membership visible on the party page), cash & bank,
  payments, invoices.
