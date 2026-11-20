# SA7EN design system — Plum & Ash

Version 1. Applies to the accounting workspace (`docs/design/ui/`) and the design
library (`docs/design/docs/`). It is a reskin of the existing navigation and module
map, not a restructure: the module list, screen inventory and origin split are
unchanged.

**Brand:** displayed as **SA7EN**, pronounced *seven*. Repository, protocol, domain
and certificate identifiers stay `SAVEN`.

---

## 1. What the system is for

A ledger is read in columns, for hours, by people under time pressure. The design
therefore optimises for:

1. **Scanning.** Numbers align, rows are quiet, and the eye can find a column edge.
2. **Trust.** Nothing decorative competes with a figure. Colour means something.
3. **Density with air.** 200 rows must be readable, and the page must not feel like
   a spreadsheet dump.

The one expressive surface is the ambient band on the Accounting overview: a
graphite/ash shader with plum dust. It is the only place motion and texture are
allowed, and it never sits behind a table or a form field.

---

## 2. Colour

Two palettes, one meaning per token. Values live in `docs/design/shared/ui.css`.

### Surfaces and ink (light)

| Token | Value | Use |
|---|---|---|
| `--paper` | `#F4F0EA` | Page ground between panels |
| `--surface` | `#FBF9F6` | Cards, tables, inputs |
| `--surface-raised` | `#FFFFFF` | Inputs and overlays that must lift |
| `--surface-sunken` | `#EFE9E1` | Table head, sticky totals, tags |
| `--ink` | `#211E22` | Primary text and amounts |
| `--ink-2` | `#46404A` | Body text |
| `--muted` | `#6C646D` | Labels, meta, secondary text |
| `--muted-2` | `#766E77` | Placeholders only |
| `--control-line` | `#8F8892` | Field and control boundaries |

### Brand and consequence

| Token | Value | Means |
|---|---|---|
| `--plum` | `#4A2935` | The brand. Primary action, active tab, links, selected row |
| `--plum-deep` / `--plum-rail` | `#241319` / `#1E1218` | Navigation and the ambient band |
| `--positive` | `#2E6A50` | Posted, balanced, reconciled |
| `--caution` | `#8A5A00` | Draft, awaiting approval, needs attention |
| `--danger` | `#A02630` | Rejected, overdue, out of balance, destructive |

### Measured contrast (WCAG 2.2 AA)

Every pair below is computed, not estimated. Recompute after any palette change.

| Pair | Ratio | Requirement | Result |
|---|---|---|---|
| ink on paper | 14.53:1 | 4.5:1 | pass |
| ink on surface | 15.69:1 | 4.5:1 | pass |
| body `--ink-2` on surface | 9.55:1 | 4.5:1 | pass |
| muted on surface | 5.43:1 | 4.5:1 | pass |
| placeholder `--muted-2` on surface | 4.68:1 | 4.5:1 | pass |
| plum on paper (links, active nav) | 11.15:1 | 4.5:1 | pass |
| on-plum on plum (primary button) | 11.80:1 | 4.5:1 | pass |
| positive on surface | 6.07:1 | 4.5:1 | pass |
| caution on surface | 5.64:1 | 4.5:1 | pass |
| danger on surface | 7.10:1 | 4.5:1 | pass |
| focus ring on paper | 7.92:1 | 3:1 | pass |
| control boundary on surface | 3.27:1 | 3:1 | pass |
| on-dark on plum-deep | 15.16:1 | 4.5:1 | pass |
| rail muted on rail | 6.86:1 | 4.5:1 | pass |
| dark ink on dark surface | 14.59:1 | 4.5:1 | pass |
| dark plum on dark surface | 7.66:1 | 4.5:1 | pass |

Decorative hairlines (`--hairline`, 1.37:1) separate content that is already
grouped by layout. They are never the only cue for a control boundary; fields use
`--control-line`.

### Colour rules

- **Never encode meaning in colour alone.** Status is a coloured dot **and** a word.
  Sign is parentheses, never red text.
- **One accent per screen.** If two things are plum, one of them is wrong.
- **Amounts are always ink.** A negative amount is ink in parentheses.
- **No gradients except the ambient band.** No purple-to-blue hero gradients, no
  glassmorphism, no glow on buttons.
- **Selection is a tint, not a fill.** Hover and selected rows use `--plum-tint`.

---

## 3. Type

System stacks only. No webfonts, no network requests.

```
--sans:  ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, ...
--serif: "Iowan Old Style", "Palatino Linotype", "Book Antiqua", Palatino, ...
--mono:  ui-monospace, "SF Mono", "Cascadia Mono", "Roboto Mono", Menlo, ...
```

| Role | Size / line | Weight | Notes |
|---|---|---|---|
| Display | 38 / 1.08 | 400 serif | Page titles, ambient band |
| H1 | 26 / 1.1 | 400 serif | Screen title |
| H2 | 17 / 1.25 | 600 sans | Panel title |
| H3 | 15 / 1.3 | 600 sans | Sub-panel |
| Body | 14 / 1.55 | 400 | Default |
| Table cell | 13 / 1.45 | 400 | Data |
| Label | 12 / 1.4 | 500 | Field labels, hints |
| Meta | 11.5 / 1.35 | 400 | Timestamps, counts |
| Column head | 10.5 / 1.2 | 600 | Uppercase, `letter-spacing: .09em` |

- **Serif never below 20px** and never for numerals.
- **Numerals are tabular everywhere.** `.num` applies
  `font-variant-numeric: tabular-nums lining-nums`.
- Column heads are uppercase with tracking; record values are sentence case.
- Maximum reading measure is 78 characters.

---

## 4. Space, shape, elevation

- **Spacing scale:** 4, 8, 12, 16, 20, 24, 32, 40, 48, 64.
  Page padding 24, card padding 18–20, table cell 10–12.
- **Radius:** 6 small controls · 8 inputs and buttons · 10 panels · 12 cards ·
  20 ambient band. Pills only for filter chips and count badges.
- **Elevation:** a card has one soft shadow or a hairline, not both heavy.
  Overlays (drawer, modal, toast) use `--shadow-pop` / `--shadow-modal`.
- **Borders:** 1px. A 2px left border marks consequence (alert severity).
- **Density:** standard row 38px, dense row 32px, table head 34px.

---

## 5. Components — when to use which

| Need | Component | Does not belong here |
|---|---|---|
| One primary action per view | `.btn--primary` (plum) | Two plum buttons side by side |
| Secondary and tertiary actions | `.btn` (outline), `.btn--ghost` | Links styled as buttons |
| Navigation between views | Rail links, breadcrumbs | Modal navigation |
| Filters that change a list | `.chip` with `aria-pressed` | Checkboxes for a single choice |
| Choosing one of a few states | `.tabs` (in-panel) | Tabs for navigation between modules |
| Choosing a value from a list | `.select` | A dropdown menu for form fields |
| Confirming a consequential act | `.modal` + `.alert--caution` | `window.confirm` |
| Inspecting one record without losing the list | `.drawer` | A new page for a row detail |
| Reporting the outcome of an action | `.toast` | An alert that pushes content down |
| Explaining a state inline | `.alert` | A toast for something the user must read |
| Money, dates, codes in a list | `.tbl` | Cards for 20+ comparable rows |
| Nothing to show | `.empty` with the reason and a way out | A blank panel |
| Waiting | Skeleton that keeps column geometry | A centred spinner for a table |

**Buttons.** One primary action per screen region. Destructive actions use
`.btn--danger` only after a confirmation that names the object.

**Tables.** Sticky head, sticky totals, hairline rows, no zebra by default. Every
amount column is right aligned and labelled with its currency once. Row actions
live in the last column; the whole row is a link only when it opens a drawer.

**Forms.** Labels are always visible and above the field. Placeholders never
replace labels. Errors appear under the field, in words, and the field carries
`aria-invalid`. A form-level summary appears above the first field when more than
one field is wrong.

**Empty vs error.** Empty means "there is nothing here yet, and that is normal".
Error means "something failed, and retrying might work". They never share a
component.

---

## 6. Focus, keyboard and tab order

- Every interactive element has a visible focus ring: **2px, 2px offset**,
  `--focus`. On plum surfaces the ring becomes chalk (`--focus-on-dark`).
- The ring is never removed and never replaced by a colour change alone.
- **Tab order follows reading order**: rail → top bar → page actions → filters →
  data region → pagination.
- **Registers are one tab stop.** The scroll region receives focus, arrow keys move
  a row cursor, Home/End jump to the ends, Enter opens, Escape leaves.
- **Modals and drawers** trap Tab, close on Escape, and return focus to the control
  that opened them.
- **Skip link** is the first focusable element on every page.
- Targeted row actions must be reachable without a mouse: the same actions appear
  in the record's drawer.
- `prefers-reduced-motion` removes all animation, including the shader loop and
  the dust drift (both render one still frame).

---

## 7. Density rules

1. Registers and schedules use 32px rows; narrative-first lists use 38px.
2. Row height never changes on hover. No row grows except to show a validation
   message, and that message takes the place of the row's sub-line.
3. 200 rows in a 460px window must remain scannable: sticky head, sticky totals,
   hairline separators, and no zebra striping.
4. Column order is fixed: identity (date, number) → description → state → amounts.
5. Amounts are the last columns and are right aligned, so the right edge is a
   single vertical line.
6. Numeric columns never wrap. Descriptions may wrap to two lines and then truncate
   with the full value in the title.

---

## 8. Layout and responsive rules

- Rail 264px; 76px when collapsed; a drawer below 1024px.
- Content max-width 1480px; 24px padding at desktop, 18px at tablet, 14px at phone.
- **1280px:** four KPI cards in one row, two-column dashboard, register fits without
  horizontal scroll.
- **768px:** rail becomes a drawer with a menu button, KPI cards go 2×2, tables
  scroll horizontally rather than crushing columns, the ambient band drops to
  220px.
- The ambient band never exceeds 280px and never contains a form control.

---

## 9. Motion

- 140ms for state changes, 220ms for overlays, `cubic-bezier(.22,.61,.24,1)`.
- Nothing bounces, nothing scales on hover except a 1px lift on module cards.
- The shader runs at 30fps, pauses when off-screen or when the tab is hidden, and
  renders a single frame under reduced motion.
- The dust field is capped at 170 particles, 30fps, and reacts to pointer movement
  with a maximum 18px parallax.

---

## 10. Implementation notes

- Tokens and components: `docs/design/shared/ui.css`.
- Icons: `docs/design/shared/icons.js` — one 24px grid, 1.6px stroke, `currentColor`,
  no icon font, no external library, no network.
- Ambient field: `docs/design/shared/fx.js` — WebGL ash shader plus a Canvas2D dust
  field. Both degrade to a static plum-graphite vignette when WebGL is unavailable.
- Catalogue generation: `node docs/design/build/make-catalog.mjs` reads
  `docs/ui-screen-inventory.json`; do not hand-edit `shared/catalog.js`.
- Nothing here may introduce a dependency, a webfont, or a network call.

---

## 11. Known limits

- The application in `docs/design/ui/` runs on a deterministic fixture ledger. It is
  a design build, not the deployed product.
- Contrast is measured for the token pairs listed above; any new token must be added
  to that table with its ratio.
- The design system is not "approved" by the owner as a finished artefact. Screens
  remain `NOT_APPROVED` in the inventory until there is dated owner acceptance.
