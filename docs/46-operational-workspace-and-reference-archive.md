# Operational workspace correction and frozen reference

14 November 2026, Asia/Karachi. The owner rejected the basic live interface compared with the earlier synthetic testing frontend and authorized main to contain the reviewed deployed version. Main was first fast-forwarded to the existing deployed source 0d462956e98d8f1e58ec91bc439fb44a0d844eee after both workflows passed, then to the reviewed UI source 132b7810c2477e006168af30d8117cc79b0aab67 after both workflows passed. No force push or reference-data cutover occurred.

## Live working interface

The live app and ops image is saven-native:workspace-20261114-a, immutable ID sha256:3e70f6c807c513f0cf69fed5c615937d1727ebee160a9af1a64c6c701ab2e948. It retains tenant schema 7 and identity schema 3. The source is on main at 132b7810c2477e006168af30d8117cc79b0aab67. Continued feature work belongs on testing-1.

The working app reuses the original reference palette, charcoal navigation rail, original local SVG icons and logo, warm surfaces, spacing and typography. New workspace cards, unpaid amounts, stock value, review counts and recent activity come from the actual authorized native APIs. A missing/denied metric is not replaced with a fabricated number. The primary page is a workspace, rather than a stack of every editor and report.

Accounting has focused report, journal, chart and entry tabs. Inventory separates balances, entry, item/warehouse registers and setup. Settings and business administration have focused sections. Invoice/bill/payment screens separate registers, new entry and source details. Page search, browser history, explicit light/dark theme controls and unsaved-form navigation checks are present. Company switching restores its old selection if the user cancels a dirty-form navigation. Existing shared financial, evidence, role, origin and session validation remains in the backend; action flags shown in the UI are not security grants.

An isolated real native database browser journey posted a 250.50 invoice through the redesigned editor, returned to the register and reconciled its amount. The actual public app was subsequently checked under the existing owner account and showed the real empty internal workspace; the local synthetic Northstar dataset was never copied into production. The public ops business directory and focused controls also rendered under the existing operator session. No client transaction was made for visual proof.

The UI increment passed 123 retained active source tests, 54 focused Linux contracts, 135 active JavaScript parse checks, both generators and plan validation. The visible-screen startup check now rejects a hidden editor or error banner masquerading as a successful screen. Both GitHub workflows passed for the promoted UI commit. Browser screenshots are private local evidence, not committed customer records.

## Frozen reference, retained deployment

Twenty-four former static frontend, Docker recipe and old design-test files moved to archive/saventesting-20261114. Their original Git blob identities were verified before recording the move. The archive manifest also retains original paths and normalized SHA-256 hashes. The 26 design tests moved with their frozen source; active financial/security tests remain. The current requirement generator updates requirement documents and no longer recreates public/ui/catalog.js. Automatic preview-image CI builds are removed. This archives the mockup, not the governing product requirements or the retained financial reference service.

The existing https://saventesting.economicsystems.cc deployment is unchanged. Its running image remains sha256:5b47a19a1cc3464c03b57c83a83c5bf167a4213090c300803eb9e91c152c8d38, its public HTML hash remained f050acdd3586cbb89dc1fa1e0126f3f2c979d201eed7f3310f6815f3bce0038a, and its root returned 200 after the archive and live app deployment. No preview container, DNS entry or tunnel route was removed.

The UI correction does not complete the remaining Accounting, Inventory, commerce, identity, printing or AI requirements. Continue docs42/45 and the current testing-1 checkpoint. New tenant schema 8 credit-note work is a separate development increment and must not be confused with the deployed schema-7 main version.
