# Deployment models and portability

Authority: [v2](sources/SAVEN-mandate-v2.md), sections 1–4 and 13. Target architecture; not the current PostgreSQL runtime.

| Commercial model | Control | Business data | Objects | Ordinary independence |
| --- | --- | --- | --- | --- |
| SAVEN Cloud | SAVEN-owned D1 identity/commerce/fleet aggregates | SQLite tenant files on SAVEN-controlled nodes | Private R2 | Requires reachable cloud authority and node, subject to bounded approved leases |
| Fully Private / private-local | Local control SQLite | Local tenant SQLite | Local or customer S3-compatible storage | Ordinary operations must work without SAVEN Cloud or Cloudflare |
| Fully Private / private-cloudflare | Customer-owned D1/Workers | Customer-controlled SQLite nodes | Customer R2 | Depends on customer's Cloudflare/network; not air-gapped |

Offline is a restricted registered companion to either commercial model, not another hosting tier. No SaaS/customer-supplied-node, third-party/accounting-firm hosting or reseller fleet is allowed. Accountants can have authorized memberships across businesses without hosting rights.

The physical default is one tenant/subscribed-business database with several legal companies. Company keys and cross-company foreign keys remain necessary inside that file. No cross-file atomic intercompany posting is promised. Cloud nodes receive typed commands, never public SQL/filesystem access. One writable owner/generation per tenant; all moves require fencing and reconciled tail events. Ordinary WAL files cannot be shared across network-mounted multi-host writers.

All profiles share command schemas, posting engine, permission compiler, migration manifests, event versions and compatibility tests. D1 bindings and native SQLite connections are distinct adapters; moving control domains requires controlled export/import and reconciliation, not switching a connection URL. No installer exists yet; see [acceptance](34-private-installer-and-architecture-acceptance.md).
