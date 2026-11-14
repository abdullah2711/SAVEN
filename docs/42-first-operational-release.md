# First operational release increment

> Current owner revision: [Accounting-first scope](48-accounting-first-owner-revision.md), [compatible tenant upgrades](49-compatible-tenant-upgrades.md), and [small-action checklist](TASKS.md) govern conflicting sequence and expanded depth. Historical implementation claims below remain dated evidence, not completion of the new scope.

Owner authorization received 14 November 2026, Asia/Karachi. Development remains on testing-1. The owner requests an operational accounting/inventory MVP and supporting commercial/operator/settings/printing/AI layers, production customer/operator hostnames, local object storage, safe continuing releases and cleanup of project-created obsolete services. The requested two-hour deadline and zero-error expectation do not establish release readiness.

## Reconciled decisions

- Operational work now supersedes the previous UI-only sequence. The approved calmer theme and full product/workflow library remain; Books & money becomes Accounting.
- Native SQLite remains the sole selected new business/control database engine. There is no new PostgreSQL, D1 or R2 dependency. Existing PostgreSQL code, objects, database and rollback are retained pending independent parity and cutover gates.
- Separate exact application/operator origins and host-only realm sessions are enforced by the new native HTTP service. Operator commercial/fleet scopes are distinct; operator membership never grants customer database rights. The initial operator may own an explicitly provisioned internal acceptance business through ordinary membership, not through global access.
- Source financial acceptance, approval, posting, stock, evidence references, audit and outbox remain distinct. Native receipt/issue/warehouse transfer valuation shares the existing NativeFoundation posting kernel; no second posting engine is introduced.
- Local original evidence uses the retained LocalBucket, hash inspection and ClamAV adapter. Accepted journal payloads commit promised names/hashes before upload. Posting refuses missing/unscanned evidence. Objects and SQLite are separate stores: original file retention precedes committed metadata, and failed metadata commits may leave an orphan requiring audited recovery. No cross-store ACID claim.
- Cloudflare provides external TLS/DNS/tunnel ingress. The server runs the application, SQLite controls and business files, private original-file directory, scanner and optional constrained local model. Ordinary deployment adapters remain a requirement. The Cloud acceptance runtime is not the Fully Private commercial/issuer-exclusion package.

## Implemented source boundaries

| Area | Current increment | Still required before a complete client MVP claim |
| --- | --- | --- |
| Identity | Scrypt credentials, hashed realm sessions, exact origin/CSRF checks, expiry/revocation, durable sign-in limits | Recovery/invitations/MFA and the remaining field-level/nested policy and ownership-transfer UI; initial owner staff/role management is now deployed |
| Accounting | Durable exact balanced journals, configurable direct/review kernel, ledger search/full scoped export, trial/export, classified position/result, accounts, owner period controls | Complete opening/recurring/accrual/reversal workflows, trade credits/refunds/advances/taxes, bank reconciliation, FX, full statements/notes and the remaining ACC scope; bounded native service invoices/expense bills/settlements are described in docs/45-native-invoices-and-settlements.md |
| Inventory | Items/stores, six-decimal quantities, perpetual weighted-average receipt/issue, transfer without GL, immutable sources/movements, negative-stock refusal, optimistic stock versions, atomic valuation/control journal | FIFO/specific identification, reservations, returns, counts, batches/serials, UOM conversion, landed cost/NRV, adjustments, retroactive costing and remaining INV scope |
| Evidence | Original private files, names/hashes committed to journal, clean scan required, authorized download, immutable metadata | Full document library, orphan recovery, invoice evidence and richer extraction workflows |
| Settings/printing | Stored business/currency/branch identity, print address/tax number/footer, scoped browser print and exports | Complete print-format/template designer and remaining settings |
| Commercial/operator | Cloud identity/provisioning intents, explicit entitlement validity/source, fleet/schema status, separate commercial/fleet scopes | Commercial plans/prices, subscription lifecycle, vendor invoicing/tax/payment collection, complete operator administration/support-consent flows |
| AI | Shared model adapter, selected authorized ledger/stock context, usage records/concurrency cap, rechecked authority, journal proposals only | Inference must be verified on the server; no claim of complete module AI, automatic posting, vision, universal tools or commercially approved metering |
| Recovery/releases | Native container, isolated Linux contract gate, stopped-installation backup/new-path restore scripts, manifest checks and financial/stock reconciliation | Scheduled live backup/restore drill, off-host recovery, compatible tenant fleet canaries, signed releases and fully commissioned production CD |

No original requirement is deleted or marked complete. The synthetic UI/workflow library remains a separately identified design surface. The real native acceptance service is a bounded working increment, not equivalent to the full documented ERP or a client-release approval.

## Verification and release gates

1. Run retained full Node/parser/catalog checks and native failure/replay/tenant/realm/scoped-approval/evidence/recovery contracts.
2. Build the exact native source on Linux, run isolated container contracts and record source/image hashes.
3. Initialize only a fresh isolated native directory; do not overwrite the reference database or import client data.
4. Verify actual sign-in, ordinary and reviewed posting, evidence scanning/download, stock/GL reconciliation and independent full-installation recovery over the real HTTP service.
5. Verify application/operator hostname routing, foreign-origin/realm refusal and owner applications remaining healthy. A successful DNS change alone is not application acceptance.
6. Verify actual model inference and fail closed for unsupported tools or permission changes. Retain human review and normal business submission.
7. Resolve the missing client-critical workflows above, browser/workflow acceptance and recovery/release gates before client onboarding or representing the release as market-ready.

Main promotion and production infrastructure changes are authorized for verified increments; reference-data destruction is not. No client migration or main promotion is claimed by this document. Preserve checkpoints with observed deployment status and exact next steps.

## Server cleanup and portability

Twelve explicitly inspected stopped SA7EN rollout containers were removed without volume deletion. The latest retained rollback, live PostgreSQL reference, antivirus, Listmonk, Nextcloud and Cloudflare were preserved. No volume/system prune or old ERPNext data deletion is authorized by this cleanup.

Moving native storage to another server requires a write maintenance window, verified backup of all four controls, every tenant database and original objects, independently verified restore into a new directory, matching application/schema compatibility, financial/stock and authorized sign-in tests, then tunnel/DNS cutover. Keep the original installation stopped and recoverable until acceptance; never allow both restored copies to accept writes. An old Docker image does not reverse schema/data changes. Current scripts are a tested bounded recovery mechanism, not completed automated fleet or turnkey deployment.
