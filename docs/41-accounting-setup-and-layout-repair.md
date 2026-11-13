# Accounting setup workflows and focused UI repairs

Owner feedback received14November2026 (Asia/Karachi): the theme direction is substantially better; preserve it, fix home tile/block overlap, use the former theme-adaptive logo, use icons for history navigation, deepen plum against economicsystems.cc, remove the clarity tagline and continue construction.

## Repairs

The home module grid had no separation from the following sections. Shared grid/flex children also lacked shrink constraints and could overflow their tracks. The repair adds a home-section gutter, minimum-width constraints, flexible card content/footers and wrapped card badges/panel headings. This is a layout repair, not a new visual design.

The original Economic Systems SVG is unchanged. Its alpha mask now uses the navigation theme colour, following the retained legacy approach, instead of displaying its source red. Back/forward use the existing SVG stroke family with accessible names and tooltips; their history behavior and disabled states are retained. The brand and home-page clarity slogans were removed.

The first-party stylesheet https://economicsystems.cc/css/styles.css was read directly over HTTPS and declares deep plum24151c and companion38212b. These now drive primary/nav plum fills; light accent text uses4a2935. Dark secondary text remains readable instead of being forced to a near-black plum on charcoal. Ivory/charcoal surfaces and overall layout direction are retained. Contrast checks still apply.

An initial browser accessibility observation confirmed the current live home UI. The browser capability was then removed during an environment switch. No post-change screenshot, viewport-overlap measurement or complete visual/browser acceptance is claimed. Source, route, runtime-startup, palette and financial checks are separate evidence. Owner feedback remains necessary for final visual approval.

## Opening balances and reconciliation UI

Accounting now includes an Opening balances workbench with editable source trial, customer/supplier positions and sample stock quantities; new-ledger versus existing-ledger modes; original-date/reference validation; strict trial CSV import/template with useful row errors; exact control-versus-position differences; review; and company-scoped local sample draft save/restore.

The proposed opening payload independently agrees with the retained backend normalizeOpening contract. It requires a balanced source trial for a new ledger, all three control reconciliations, unique normalized source references and correct original/due dates. An existing-ledger reconciliation has no trial-balance payload and cannot pretend to post another opening journal. No balancing plug is created. Differences block review. A new-ledger import is also blocked for a sample business that already has ledger entries; the empty Cedar sample is available for that walkthrough. Existing-control comparisons use the selected company and opening as-of date, preventing later ledger movements from leaking into earlier reconciliation. Incomplete drafts may be saved/restored without being valid for review.

Current retained contract limits remain visible: positive outstanding debts and whole stock quantities with cost resolved from the sample item master. Customer/supplier credit positions, fixed-asset opening, more valuation/UOM/lot depth, arbitrary import mapping and real supporting-object workflows remain required. These capabilities are not silently removed or marked complete. The sample1200 inventory control belongs to the opening template; production must resolve actual configured control mappings before accepting it.

## Recurring journal setup UI

Accounting also includes editable journal template, original anchor date, monthly/quarterly/yearly frequency, bounded occurrence preview, balanced-line validation and company-scoped local draft save/restore. The dates agree with independently expected month-end/leap-year fixtures and the retained backend occurrenceDate function. Deterministic PREVIEW keys are explicitly not accepted command IDs. Actual scheduler identity/version, retries, current authority/entitlement/period/evidence checks and durable posting remain backend requirements.

These screens do not create jobs, import real balances, upload objects, create approval requests or post journals. They are functional frontend workflows under the owner's UI-first order, with canonical compatibility tests, not a claim of a complete accounting module or native financial cutover. The sample-data/non-posting boundary is retained.

## Continuation

Next Accounting UI gates: full source correction/reversal lifecycle, deeper account/control configuration, general import mapping and error correction, approval and evidence lifecycles, comparative/cash-flow/equity/statutory-note reports and close/reopen sign-off. Retain all remaining modules and the later offline/synchronization contracts. Cloud/private domain targets and private vendor-issuer exclusions in docs39 remain unchanged.

No SSH deployment, production/main change, database deletion, financial migration or new backend feature service is part of this increment. Publish only testing-1, verify CI/testing assets and independently refresh the existing schema13 health before reporting deployment verified.
