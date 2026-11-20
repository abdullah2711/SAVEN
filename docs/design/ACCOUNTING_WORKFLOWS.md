# Accounting workflows and logic (as built)

What the prototype actually does, so the next engineer can connect a database
without guessing. Every statement here matches the code in
`docs/design/save/ui/`. Where the prototype is illustrative, it says so.

---

## 1. Data flow

```
fixture(company)       199 posted documents for November 2026
   ↓
trial(data, range)     per-account opening, debit, credit, closing
   ↓
statements(data)       revenue, expenses, profit, assets, liabilities, equity
   ↓
screens               dashboard, general ledger, trial balance, ageing
```

There is no stored balance anywhere. Every figure is recomputed from the document
list on each render, so two screens cannot disagree. This is also why the trial
balance difference is exactly `0.00`: it is the sum of balanced documents.

**Illustrative, not derived:** the split of receivables and payables across
individual parties. The total is derived from the control account; the per-party
distribution is a deterministic spread, labelled on screen as illustrative.

---

## 2. General ledger

**Rows.** Every line of every document inside the date range, for the selected
account, party, voucher type and search text. Sorted by date, then voucher number.

**Opening.** Sum of `debit − credit` for the selected account on all documents dated
before `from`. With "All accounts" selected, opening is not applicable and shows
zero.

**Running balance.** Only when a single account is selected: opening, then each line
in date order. With all accounts the column is omitted, because a balance across
accounts has no meaning.

**Closing.** `opening + debit − credit`, and the footer repeats that arithmetic in
words. If the numbers and the sentence ever disagree, the sentence is right.

**Full record.** Clicking a row expands it in place and shows the source document:
voucher, date, type, party, narrative, and every line of that document with its own
totals. Collapsing returns the list unchanged.

**Export.** CSV of exactly the rows in the current filter, with the same columns.
**Print** uses the print stylesheet, not the screen.

**Filters persist** while the page is open; they reset on reload. No server-side
state yet.

---

## 3. Journal entry

**Entry types.** Normal, Adjusting, Opening.

- **Normal** — a control-account line must name a party.
- **Adjusting** — a control-account line may omit the party, because the adjustment
  is not party-specific. In the real backend this type needs a stronger permission
  and a reason.
- **Opening** — reserved for migration; same party rule as normal.

**Party column** activates only when the selected account is flagged as a control
account (trade receivables, trade payables). Changing the account to a non-control
account disables and clears the party, so a stale party can never be posted.

**Validation** happens on review: date, reference, narrative, at least two lines,
one side per line, and the control-account party rule. The message names the account
(`1100 Trade receivables is a control account: choose a party…`).

**Totals** are computed live; the review panel shows debit, credit and the workflow
decision. Nothing is posted — the prototype has no posting endpoint, and it says so
on the page.

---

## 4. Dashboard

Every block has one source and one link:

| Block | Source |
|---|---|
| Cash & bank | ledger balances of 1000, 1010, 1020 |
| Receivables / payables | control accounts 1100 + 1110, and 2100 |
| Result for the period | revenue minus expenses from the trial balance |
| Cash movement | cash-account movements per day, cumulative, closing equals the cash figure |
| Ageing | the same party spread the ageing report uses; totals equal the control accounts |
| Recent journals | last six documents by date |
| Needs attention | overdue receivables, over-60-day balance, overdue payables, trial balance state |
| Close readiness | trial balance proof, receivables review, statements availability |
| Actions | each opens the page that can complete it |

No figure appears without its period. No block shows a number it cannot link to.

---

## 5. Navigation and page map

- `pages-map.js` defines modules → pages → state. The rail, the page heading, the
  "being built" panels and `MODULE_PAGES.md` all read it.
- Accounting owns the document pages that used to be separate modules: payments,
  cash & bank, sales and purchase invoices, and every tax page. There is no
  separate Payments, Cash & bank, Sales, Purchases or Taxes module in the rail.
- Entering a module opens its first page. Entering an unknown or folded module id
  lands on Accounting rather than a dead route.
- A page marked `planned` renders the spec panel and never pretends to work.

---

## 6. Rules the build must keep

1. Posted documents are immutable; corrections are reversals.
2. A control account and its subledger must agree; a gap is surfaced, never plugged.
3. Money is decimal with two places; quantities up to three.
4. Ageing is measured from the due date.
5. Every list states its scope (period, branch, account) next to its totals.
6. Empty states explain what will appear and how to create it.
7. Nothing posts from the prototype. Any button that would post either opens a
   review or says it is a design build.

---

## 7. Known gaps in the prototype

- Documents have no draft/approval states, so the register shows only posted items
  and the dashboard has no approval queue yet.
- Party balances are spread from the control total, not built from party-level
  documents.
- Payments, invoices, items and the tax pages are mapped and specified, not built.
- No persistence: a reload returns to the fixture.
