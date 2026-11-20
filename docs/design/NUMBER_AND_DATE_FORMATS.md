# Number and date conventions

One rule per case. Every screen renders values through
`docs/design/shared/format.js`; if two screens show the same value differently,
that is a defect, not a style choice.

Currency for the fixture business is **PKR**. The rules apply to any currency code.

---

## Money

| Case | Rule | Example |
|---|---|---|
| Currency in prose, cards, totals | ISO code, one space, then the amount | `PKR 1,284,930.00` |
| Currency inside a table column | The column head carries the code once; cells show bare numbers | head `Debit (PKR)` → cell `96,000.00` |
| Decimals | Always two, including whole amounts | `96,000.00`, never `96,000` |
| Thousands separator | Comma every three digits | `1,284,930.00` |
| Negative amount | Parentheses | `(24,000.00)` |
| Negative with currency | Parentheses wrap the digits only, code stays outside | `PKR (24,000.00)` |
| Minus sign | Never used for money | — |
| Both conventions | Never. Brackets and minus never appear together | — |
| Zero in a money column | `0.00` | `0.00` |
| Zero as a difference | `0.00`, and the badge says Balanced | `0.00` |
| Not applicable | Em dash | `—` |
| Empty bucket inside a matrix | Em dash means "no item in this bucket"; totals still print `0.00` | `—` / `0.00` |
| Currency conversion | Show the transaction currency and the base amount on separate lines, never blended into one cell | `USD 4,200.00` / `PKR 1,176,000.00` |

**Why parentheses.** A bracket is unambiguous in a ledger column, survives
black-and-white printing, and cannot be confused with a hyphen typed by mistake.
One convention also lets a column be scanned for the shape of a loss.

**Why the code and not a symbol.** `PKR`, `USD`, `AED` cannot collide the way `$`
does across currencies, and they survive being pasted into a spreadsheet.

---

## Alignment

- Every money value uses **tabular figures** and **right alignment**.
- Decimal points line up vertically, including inside parentheses.
- A column never repeats the currency code, because that would push digits out of
  alignment between rows.
- Whole-number counts (`1,284`) use the same grouping but no decimals.

---

## Dates

| Case | Rule | Example |
|---|---|---|
| Read by a person (headings, meta, vouchers) | Day, short month, four-digit year | `20 Nov 2026` |
| Dense table column | Day, short month, two-digit year | `20 Nov 26` |
| Date input, machine exchange, API | ISO 8601 | `2026-11-20` |
| Month and period labels | Month name and year | `Nov 2026` |
| Date range | En dash between two full dates, month named once where unambiguous | `1 Nov – 30 Nov 2026` |
| Relative time (activity, approvals) | Words, not numbers, up to 30 days | `today`, `yesterday`, `3 days ago` |
| Beyond 30 days | Absolute date | `20 Oct 2026` |
| Unknown or not applicable | Em dash | `—` |
| Time of day | 24-hour, no seconds, only where it matters | `09:41` |

- Dates are stored and compared as ISO strings; the display format is a rendering
  concern only.
- Never use `MM/DD/YYYY` or `DD/MM/YYYY` in the product: both are in use worldwide
  and neither is unambiguous.
- The browser's native date control formats its own input per locale. The value it
  submits is always ISO 8601.

---

## Percentages

| Case | Rule | Example |
|---|---|---|
| A rate that may be fractional | One decimal, no space before the sign | `17.5%` |
| A whole rate | No decimals | `18%` |
| A proportion of revenue column | Always one decimal, so the column reads as a column | `95.8%` |
| Change or delta | Sign always shown | `+12.4%`, `−3.1%` |
| Basis points | Words, not `bp` | `12 basis points` |

Percentages are stored as fractions (`0.175`), never as `17.5`.

---

## Quantities and units

| Case | Rule | Example |
|---|---|---|
| Quantity | Grouped thousands, up to three decimals, trailing zeros trimmed | `1,250`, `12.5`, `0.875` |
| Unit of measure | After the quantity, one space, lowercase abbreviation | `12.5 kg`, `48 pcs` |
| Currency amount per unit | Amount first | `PKR 1,240.00 / kg` |

---

## Document and reference numbers

- Entry numbers are fixed-width and monotonically assigned: `JE-2026-0001`.
- The prefix identifies the series, not the module: `SI-` sales invoice, `PB-`
  purchase bill, `RJ-` recurring template, `PP-` prepayment.
- Never reformat or truncate a document number; it is an identifier, not a value.
- Identifiers that are not read aloud in full (UUIDs) are never shown in a table;
  show the human number and put the UUID in the record drawer.

---

## Checklist for a new screen

1. Money goes through `amount()` or `money()`; never `toFixed` inline.
2. Dates go through `dateLong()` / `dateShort()`; never `toLocaleDateString`.
3. Amount cells carry `.num` and are right aligned.
4. Column head states the currency once if the column is money.
5. Zero, dash and negative are each used for exactly one meaning.
6. Numbers are verified by eye in a column of ten, not by reading one value.
