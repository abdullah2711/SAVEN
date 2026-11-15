# Owner revision: Accounting workspace and MVP 1

15 November 2026, Asia/Karachi. This supersedes conflicting navigation and sequencing in older plans, including the journal-form landing-page requirement in docs48. Preserve all remaining agreed scope.

## Immediate behavior

- Accounting opens an overview dashboard with real authorized balances, work in progress, recent journals and links to its subpages.
- Journal entries is a register, not an always-open editor. Include saved drafts, approval pending, correction pending/returned, rejected, submitted and cancelled sources. Submitted means posted to the GL. Soft-deleted records disappear from the register but remain in durable storage/audit. Opening New journal opens a fresh form.
- The sidebar has independent module navigation and subpage disclosure, a collapsible desktop rail and a small-screen drawer. Remove decorative vertical subpage selection lines. Keep click behavior, focus labels and selected states clear.
- Approvals is a standalone workspace area with To review, My requests, Returned for correction, Rejected and Approved views. Enforce actor/resource/company permissions on the server; menu visibility is not authority. Open the exact source for review. Pending and correction states are unposted work; review history remains durable.
- Display all agreed MVP 1 module/subpage destinations now. Unimplemented pages explicitly say Planned and cannot simulate successful transactions. A navigable placeholder is not completed scope.

## Two delivery gates

MVP 1 is for Economic Systems' managed consulting/accounting clients. Finish Accounting in full first, then Settings, then the connected Selling, Buying, Payments, Customers & suppliers, Taxes, Cash & bank, Inventory, Assets and POS workflows in docs48. Keep essential identity, authorization, entitlement, backup and audit controls working throughout.

MVP 2 is the broader market-ready release. Complete broader ops/commercial administration, remaining agreed Manufacturing, Reports, Finance & planning, AI, Drive, Apps, CRM, Projects, HR and other baseline scope. The owner's Accounting priority does not remove any old requirement. Neither MVP is released simply because menus or tests pass.

## Required acceptance

Dashboard totals reconcile to authorized source/report queries. Drafts never enter the GL. Review transitions and cancellations retain history. Numbers are permanent and not reused. Removed drafts cannot be submitted or overwritten through a direct API until explicitly restored. A posted source cannot be hidden by draft deletion. Test desktop, narrow mobile, collapsed navigation and keyboard operation. Verify printed output independently before claiming print completion.

The removed-draft direct-API guard was fixed and regression tested after the first checkpoint. Current source still requires commit-specific CI and deployment/recovery gates before release.

## Owner-requested tooling and AI

Install and assess the four requested upstream skill sources; see docs52 for pins, licenses, actual installation scope and actual use. Document the engineering process in docs51. The owner subsequently requested a complete GitHub/CLI checkpoint before further implementation. The selected AI model is nvidia/nemotron-3.5-lightning:free via OpenRouter. The key was provided privately and must never appear in source, documentation, tests, logs or client JavaScript. This latest instruction permits optional hosted model inference, superseding the earlier all-local inference restriction only for that configured provider. Core data, authorization, APIs and storage remain on the owner's server.
