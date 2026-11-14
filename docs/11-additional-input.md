# Additional owner input — implementation contract

11 November 2026. This addendum supersedes earlier proposed defaults where the owner's latest input differs. Source: the supplied “Input, Suggestions & Feedback” text. Raw private discussion is not copied into the repository. Commercial breadth is preserved; delivery order does not remove launch requirements.

The owner has now authorized construction on **testing-1**. Main remains a reviewed promotion target. These additions and the company-knowledge specification both apply.

| Input | Required behaviour | Catalog trace | First-build status |
| --- | --- | --- | --- |
| Accounting preview | Every journal-producing action shows the actual debit/credit effect for its selected options | ACC-018 | Three service-sale settlement variants and stock issues implemented; broader routes pending |
| Printing | Default templates for every transaction; copy/edit/manual or AI format design | DOC-007 | Basic invoice/issue print view; template engine pending |
| Email | Send documents and schedule deliveries/reminders | DOC-008 | Pending; no real email is sent |
| Detailed controls | Customer/supplier/item/account/store-specific access and approvals | FND-012 | Foundation resource denials; full policy editor and approval hierarchy pending |
| Recipe POS | Consume ingredients, produce, and sell from designated stores atomically | POS-009 | Pending |
| Locked changes | Ultimate-owner exceptional authority, reason, audit and primary-email/notification | ACC-019 | Locks and immutable posted entries implemented; exceptional correction and notifications pending |
| Store devices | Supported scanner, scale, counter, printer and other adapters | POS-010 | Pending |
| Inventory costing | Configurable valuation and traceable later-cost adjustment | INV-013, INV-014 | Pending; initial issue fixture uses fixed unit cost |
| Complete tax work | Tax setup, invoice tax, income/sales-tax withholding, reconciliation and filing preparation | TAX-001 through TAX-008 | Pending; first invoice explicitly non-taxable |
| Product/project finance | Budgeting, forecasts, scenarios and financial results without trade execution | PRJ-006, FIN-005, FIN-006 | Pending |
| Operator controls | Company/user/group/global module, feature, AI and access management with logs | OPS-014 | Pending operator portal; runtime access enforced in foundation |
| Protected attachments | Attached evidence cannot be removed through ordinary folder permissions; admin removal logs and notifies | DOC-009 | Pending |
| AI launch depth | Documents/pictures, extraction, evidence attachments, configuration and broad permitted tools | AI-004, AI-005, AI-029, AI-031 | Shared preview/submission tool adapter only; no model/extraction provider connected |
| Ultimate admin | Delegation cannot remove the ultimate owner or create additional administrators | FND-011 | Protected owner membership; delegation UI pending |
| Supporting files | Spreadsheets and other allowed workings linked to transactions | DOC-003, DOC-009 | Pending storage, quarantine and evidence handling |
| Company subscription | Operator-created identities, multi-company membership, business-level plans, suspension without deletion | OPS-011, OPS-014, OPS-004 | Multi-company membership and paused-company denial implemented; billing and provisioning pending |
| Drive allocations | Company module with total quotas and personal allocations; company admin retains disclosed oversight | DOC-010 | Pending |
| Support access | Attributed impersonation and reset flows; never reveal existing passwords | OPS-015, SEC-011 | Pending; invitation-only foundation stores no passwords |
| Passwords/data | Explicit identity, credential, business-data and storage design | SEC-005, SEC-011 | Hashed random grants/sessions; full identity provider/MFA pending |
| External sharing | Safe public/password links, expiry/revocation and download options | DOC-011 | Pending |
| Offline application | Selected accounting, POS, inventory, assets and manufacturing; controlled master data; safe two-way sync | OPS-018 | Pending; a web page is not represented as the offline application |
| Subscriber portal | Package application to review, bill and convert without refilling data | OPS-011 | Pending |
| Billing changes | Now/next-period/selected-date changes and explicit proration | OPS-012 | Pending |
| Future payments | Mixed manual transfer and card billing through replaceable adapters | OPS-013 | Pending; no payment credentials or live transactions |
| Cloudflare and self-hosting | Workers/database/buckets with a supported portable path | OPS-016 | Worker/D1 command contract and Node/SQLite adapter; production capacity and portability proof pending |
| Speed and scale | Measured latency, concurrent workflows and heavy-job isolation | OPS-009 | No production-load claim; tests cover correctness only |
| Apps packages | Scoped registry/connector architecture; higher-plan entitlement gates | APP-001 through APP-010, OPS-014 | Separate Apps destination; installation/runtime pending |
| Named AI seats | No seat rotation between active users during a period; operator-controlled reassignment rules | AI-026 | Pending |
| Usage and limits | Per-user/company/provider tokens, costs, daily limits and custom/BYOK routes | AI-027, AI-028 | Pending |
| Voice/doc controls | Upload and speech-to-text toggles at effective operator/company/user scope | AI-029 | Pending |
| Model flexibility | Multiple providers/models and keys with the same deterministic authority controls | AI-028, AI-031 | Model-neutral tool contract; provider evaluation pending |
| AI telemetry | Redacted success/failure, latency, usage and version metrics | AI-030 | Pending |
| AI authority | Business APIs/tools rather than mouse control; no extra user privileges | AI-031 | Shared preview/submission tool adapter tested; approval unavailable to the adapter |
| Visual finish | Polished light/dark, visible refraction and restrained glass, official ESC mark | UX-001, UX-003 | New workspace source; browser/contrast review blocked and remains required |
| Interrupted development | Durable checkpoint, tests, blockers and remaining actions | OPS-017 | BUILD_STATE and reproducible commands added |
| One-device policy | A new account session invalidates the previous one | SEC-010 | One active server session tested; cookie theft/device attestation remains a separate security concern |

## Necessary interpretation and unresolved policy

The request for no AI hallucinations becomes a deterministic execution boundary, not a claim about model infallibility. Models may propose incorrect treatments; evaluations, evidence and human review remain necessary. Structured output or tools alone cannot prove economic correctness.

Posted entries remain immutable. Exceptional corrections must be linked adjustments or controlled reopening with an audit trail; the eventual superadmin process will not silently overwrite history. Customer email/notification delivery will use an atomic outbox and deduplicating worker. The outbox exists in the foundation but has no delivery worker yet.

The requested LIFO option needs a supported reporting-policy decision before activation. The costing engine must separate management views from statutory statements and preserve method consistency where applicable; no tax or reporting-policy compatibility is asserted here. A localization review will determine valid combinations.

Offline customers control their devices. Signed entitlements, encryption, revocation deadlines and bounded offline leases can constrain ordinary use; they cannot guarantee that a device owner cannot extract information or tamper with software. A no-export button is not an absolute copying barrier. Product support, contract, retention and lawful exit policy must be reconciled explicitly.

An AI customer key changes charging and routing; it does not remove rate, security or authority controls. Fixed named seats are distinct from concurrent-use limits. Metered usage must be recorded even if all users share one provider key.

Personal folders are company-managed space with disclosed company-admin access, not a promise of privacy from the company. Operator support access must retain the real operator identity and case reason. Administrators cannot retrieve existing passwords; resetting access is a different action.

## Environment map

| Purpose | Branch / URL |
| --- | --- |
| Testing | testing-1 — https://saventesting.economicsystems.cc/ |
| Production | main — https://app.saven.economicsystems.cc/ |
| Future marketing frontend | https://saven.economicsystems.cc/ |

Source configuration targets only the saven-testing Worker. Cloudflare build-branch and database bindings require verified external setup. The first source update does not authorize main promotion or reuse of production data.


## Governing revision, 13 November 2026

The v2 mandate supersedes conflicting delivery order, PostgreSQL target, hybrid customer-data-node, unresolved offline and heavy-glass assumptions. See docs/26-owner-decisions-2026-11-13-v2.md and ADR011?016. This addendum retains valid original functional requirements and historical first-build evidence; it is not the current completion report. Cloud and Fully Private are the only commercial models. Offline is a companion. Current PG functionality stays until SQLite equivalence and controlled migration gates pass.

## Governing consolidated revision v2.3

The owner supplied and required full review of both consolidated v2.3 files and the original v2 baseline. See docs/sources/SAVEN-mandate-v2.3.md, docs/sources/SAVEN-agent-handoff-v2.3.md and docs/35-native-sqlite-local-first-v2.3.md. Native SQLite controls and business stores supersede D1/PostgreSQL targets. Exactly Cloud and Fully Private, monthly signed private entitlements, strict vendor/private composition, local-first QA, one protected owner, durable inbox/approval/posted/outbox boundaries and complete Apps scope now govern. No main, production or destructive database change is authorized. Source-only and synthetic proofs are distinguished in docs/38-native-foundation-verification-v2.3.md.

## Latest owner UI and sequencing feedback - 13 November 2026

The owner requested a calmer ivory/charcoal/plum balance in light mode, layered charcoal instead of white surfaces in dark mode, less pink in plum, fewer lines and boxes, and an understated comfortable interface using Wispr Flow as a visual reference. Replace the old public testing interface with the new frontend at the main testing URL; retain financial source/data as reference. Expose distinct business workspace, subscriptions/business-onboarding/SAVEN-commercial-invoicing and platform-operator contexts. Projects and CRM are separate modules. Complete UI/UX module by module before further backend implementation. Offline implementation follows main infrastructure; offline/sync/permissions/idempotency compatibility remains mandatory throughout. Local development is preferred where convenient; keep testing-1 updated and do not alter main/production or destroy business databases.

Subsequent steering in this same increment: use **SA7EN** as the visible brand, pronounced seven. Keep existing repository, domain, API/database identifiers and historical source records stable; update visible application branding and documentation of the decision.

### Domain clarification received during UI work

Customer application target: https://app.saven.economicsystems.cc . SA7EN administration target: https://operator.saven.economicsystems.cc . The latter hosts BOTH subscription/business-onboarding/commercial-invoicing management and platform operator operations as separately authorized sections. Apply separate customer-app and administration origins in both Cloud and Fully Private deployments. A same-origin path split is only a temporary synthetic testing walkthrough, not the requested security boundary. Production DNS/main are not changed by documenting the target. Private administration includes local installation and own-subscription/licence management; vendor commercial ledger/global subscribers/issuer remain excluded under v2.3. Domain separation also requires host-only sessions, exact origin checks, audience-bound APIs and server authorization.

## Owner feedback - 14 November 2026 (Asia/Karachi)

The latest theme is substantially better; preserve its general direction instead of redesigning. Fix overlapping tiles/blocks on the home screen, use a theme-adaptive monochrome Economic Systems logo as in the former testing interface, use icon controls with accessible names for backward/forward navigation, and deepen plum using economicsystems.cc as reference. Remove the clarity/your-business brand tagline; do not attach it to SA7EN. Continue actual construction under the existing complete-UI/UX-first module sequence, then approved backend work. The renewed SSH endpoint is optional infrastructure access, not permission for production changes or destructive database work.

## First operational release request - 14 November 2026 (Asia/Karachi)

The owner now authorizes progression beyond the UI-only sequence: make agreed accounting/inventory MVP and critical settings/printing/subscriptions/operator/AI layers operational, prepare Cloud production at app.saven.economicsystems.cc and operator.saven.economicsystems.cc through the personal server tunnel, and establish safe testing-1 to main CI/CD while preserving onboarded client data. Rename Books & money to Accounting. Prefer local directory/object storage until an explicit R2 decision. Inventory and remove only confirmed unused services introduced by this project; preserve owner-installed Listmonk, Nextcloud, Cloudflare tunnel and other owner apps. The owner requests a two-hour deadline and zero errors; these are delivery expectations, not evidence of completion or authorization to skip verification, compromise controls or delete business data. Main/production promotion is now authorized only for verified reviewable release increments; native SQLite remains the selected engine. Record any unmet release gates honestly; no unverified client-ready claim.

## Owner TLS/domain correction - 14 November 2026 (Asia/Karachi)

The owner selected https://app.economicsystems.cc and https://ops.economicsystems.cc as the customer and administration hostnames when nested subdomain TLS failed. These replace the earlier app.saven/operator.saven Cloud targets; retain separate exact-origin security and existing marketing branding. See docs43 for actual deployment and release limits.

## Latest Accounting-first revision and bill-and-hold clarification

The 14 November detailed owner feedback is recorded in docs/48-accounting-first-owner-revision.md and docs/49-compatible-tenant-upgrades.md. Accounting first, Settings second, connected operational modules next, wider ops afterward. Include every detailed requested workflow in contracts/delivery-checklist.json. The owner's later clarification explicitly requires customer control transfer before physical collection; implement separate customer custody and owned valuation, with reviewable recognition evidence. Expected versus actual withholding differences may use a linked journal adjustment reflected in tax schedules. Prior scope and historical evidence remain intact; no completed full MVP is claimed.
