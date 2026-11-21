# Design session handoff — SAVEN accounting UI

Paste this file at the start of a new session. It is the whole context.

## What this is

A design build of the SAVEN/SA7EN accounting UI, served from the owner's machine.
No database, no backend, no posting. Fixtures only.

- Repository: `/home/esc/saven/wt-design-theme`, branch **`opencode/design-theme-v1`**
  (never merge; push to origin after every change).
- App: `docs/design/save/` — the **exact** saventesting build (shell, rail, search,
  persona selects, theme toggle, dialogs) plus added screens.
- Library: `docs/design/docs/` — module catalogue, rendered at savenui.
- Live: **https://savenuitest.economicsystems.cc** (app) and
  **https://savenui.economicsystems.cc** (library), through a Cloudflare tunnel
  (`savenui-design`, config `~/.cloudflared/savenui-design.yml`, origin
  `127.0.0.1:8795`, server `~/saven-preview/server.mjs`).

Run locally: `node /home/esc/saven-preview/server.mjs`, then
`http://savenuitest.localhost:8795/`. Host routing picks the root; `Host:
savenuitest.localhost` → `docs/design/save`.

## Hard rules

- The shell is the owner's: do not restyle it. Change screens inside it.
- No inline `style=` attributes: the build's CSP (`style-src 'self'`) blocks them.
  All layout lives in `theme.css` classes.
- No placeholder copy ("sample", "design example"). Real values only.
- Money: decimal, two places, rows show bare numbers in a column. Dates ISO in data,
  short form in tables.
- Every figure must derive from the fixture; if it cannot, say so on screen.
- Document decisions as they are made (this folder). The docs are the contract.

## Where things live

| Path | Contents |
|---|---|
| `docs/design/save/ui/app.js` | shell, rail, routing, page map wiring |
| `docs/design/save/ui/accounting-ui.js` | chart, journal register/editor, trial balance, statements, setup |
| `docs/design/save/ui/screens.js` | dashboard, ledger, journal register + record, projects, taxes, planned pages, multi-select/picker |
| `docs/design/save/ui/accounting-model.js` | fixture ledger, chart, numbering, projects, locations, cost centres |
| `docs/design/save/ui/pages-map.js` | module → page map, single source for rail and docs |
| `docs/design/save/ui/theme.css` | their stylesheet plus our component classes |
| `docs/design/*.md` | decision log, module map, workflows, backend contract, forms/views, page register |

## Current state

**Built and working:** accounting dashboard; general ledger (multi-select filters,
search in every dropdown, column chooser, sorting, row expand, CSV); journal
register (columns, filters, sorting, record page); journal form (numbering, time,
guards, subtype, party/sub-account, project/location/cost centre per line, review at
bottom, print + menu); trial balance; chart of accounts; statements; projects list;
setup page; taxes page with five tabs; 20 modules and 152 pages mapped, planned pages
render their spec.

**Known gaps:** quick entry grid; forms register in Setup; bank/cash reconciliation;
payments allocation; invoices; cash & bank tabs; project-scoped access enforcement;
no persistence (reload returns to fixtures).

## Decisions already made (do not re-litigate)

- One dimension: **Location** (kind: head office, branch, outlet, warehouse). No
  separate branch field. Books are company-wide.
- **No project on the account.** Accounts stay generic; project/location are line
  dimensions. Sub-accounts exist only for control accounts (parties, banks, cash).
- Cancel removes the ledger effect but keeps the register row; delete removes it from
  the register; numbers are never reused; the audit log is the permanent record;
  reversal is optional.
- Posting guards: no future time, nothing before business creation, nothing in a
  closed period.
- Identity: created-by/source (User or AI) and submitted-by are separate fields.

## How to verify a change

1. `node --check` every edited file.
2. Screenshot with
   `firefox --headless --window-size=1440,1000 --screenshot out.png "http://savenuitest.localhost:8795/#module=accounting&tab=ledger"`.
3. For behaviour, build a probe page in `docs/design/save/` that imports the module,
   drives the DOM and prints results into the page, then screenshot it, then delete it.
4. `node docs/design/build/make-page-docs.mjs` after touching the page map.
5. Commit and push.

## Next

Owner is reviewing the journal form and will return to the project/location/branch
discussion. Do not start new modules before that review.
