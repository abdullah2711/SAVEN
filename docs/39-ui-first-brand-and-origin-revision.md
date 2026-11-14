# Owner UI, brand, origins and delivery revision

Latest direct owner instructions during the13November UI increment govern over conflicting older design-route and delivery-order assumptions. The consolidated v2.3 financial, storage, private composition, ownership, licensing and data-preservation requirements remain active.

## Brand and visual direction

Visible brand: **SA7EN**, pronounced seven. Existing SAVEN repository/domain names, protocol IDs, certificate kinds, migrations and historical sources remain stable. Use SA7EN in the application wordmark, page titles, customer account and administration interface. This is a display-brand decision, not a cryptographic protocol migration.

The owner rejected bright light mode, pink-looking dark plum, excessive borders and unfinished-looking layouts. Light mode uses a charcoal navigation rail, muted warm ivory work surfaces and restrained plum. Dark mode uses layered charcoal/grey surfaces and a low-saturation violet-plum accent. No white cards or pale pink primary buttons. Use spacing, hierarchy and tonal grouping; keep rules for financial totals and necessary structure. Wispr Flow is a reference for comfort and restraint, not a requirement to copy its website or turn an ERP into a landing page.

Both palettes have independently calculated normal-text contrast checks for body, secondary text, accent, primary buttons and the navigation rail. Visual, responsive, keyboard and owner acceptance remain separate gates; arithmetic contrast alone does not establish a polished UI.

## Application and administration origins

| Context | Approved Cloud target | Responsibility |
| --- | --- | --- |
| Customer application | https://app.saven.economicsystems.cc | Customer books, operational modules, employees and business settings |
| SA7EN administration | https://operator.saven.economicsystems.cc | Both commercial subscription/onboarding/billing management and platform operator operations, with separately authorized sections |

The operator origin contains two distinct contexts. Commercial management owns applications, verification, subscribed businesses, plans, SA7EN subscription invoices, payment review, entitlement and provisioning. Platform operations owns staff authority, nodes, writable ownership, fleet migrations, diagnostics, backups/recovery and support coordination. A customer's sales invoice is not a SA7EN commercial subscription invoice. A business administrator is not a vendor operator.

Fully Private also requires separate customer application and administration hostnames/origins, supplied by installer configuration. A different port or path on the same hostname is insufficient; cookies are not isolated by port. Local administration includes installation management, local staff/access, backup, own-subscription/seat status and signed monthly certificate import/verification. Vendor commercial billing/global subscribers/licence issuance remain on SA7EN's administration side and are not shipped inside the customer package. The owner's domain instruction changes host separation; it does not silently reintroduce an issuer/private signing key or global reseller registry into private installations.

Separate domains must be backed by separate server routes, host-only session cookies, service audiences, exact origin/CSRF checks, denied-by-default CORS, granular authorization, attributed operator identity and customer-approved support grants. Never set a shared `.saven.economicsystems.cc` cookie to turn a customer session into an operator session. Separate subdomains alone do not establish tenant security or eliminate every same-site threat. No hidden universal customer owner exists.

The machine-readable target is contracts/origins-v1.json. These production origins are documented targets, not a claim that DNS, TLS, services, sessions or new operator APIs have been deployed. Main and production configuration were not changed in this increment.

## Testing entry and legacy preservation

The owner explicitly asked to replace the older working testing interface and develop at the main testing URL. The new frontend therefore serves `/` on the existing testing origin. The old `/design/` entry redirects there. Retired public frontend files were moved into reference/legacy-ui, outside deployed assets; their regression helpers remain tested. The backend, financial migrations, records and existing service are preserved. This is not database decommissioning or an authorized live financial cutover.

Testing-only synthetic walkthroughs use `/subscriptions/` and `/operator/` on the same testing origin so the owner can review all contexts without creating a new public route/DNS host. These paths are **not** the required production origin security boundary. No real commercial/customer/operator data or privileged action is connected to these walkthroughs. The frontend carries a quiet sample-data/non-posting notice and retains restrictive network/form policies. A saved sample journal is explicitly local browser draft state, not a submitted or posted journal.

## Modules and development order

Projects and CRM are separate modules. PRJ-001 maps to CRM relationship/opportunity workflows; PRJ-002 through PRJ-006 remain project/task/time/budget/billing/planning requirements. Existing IDs and scope are preserved.

Complete UI/UX module by module before expanding backend application logic, workers or infrastructure. Existing native proof code and financial regressions remain available; no new backend feature batch is part of this UI increment. The detailed next gates are in docs/40-frontend-module-completion-plan.md. Menu coverage and synthetic examples are not complete modules or approval.

Offline implementation follows main infrastructure. It must not be forgotten during design: every eligible workflow retains versioned commands, operation IDs, device scope, entitlement/policy bounds, pending versus posted status, retained evidence, conflict resolution and duplicate-free financial synchronization. Offline is a companion, not a third hosting model or separate ERP fork. Its UI currently indicates a later phase; no installed offline app or synchronization capability is claimed.

## Superseding short-hostname revision - 14 November 2026

The owner now selects https://app.economicsystems.cc and https://ops.economicsystems.cc after nested-domain TLS issues. These supersede the Cloud targets in the earlier table; separate hostname/session/authorization requirements remain. See docs43 and contracts/origins-v1.json.
