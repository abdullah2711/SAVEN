# ADR: controlled PostgreSQL pivot with SQLite retirement gate

Status: Proposed
Date: 15 November 2026 (Asia/Karachi)
Owner authorization: This ADR is authorized by the project owner. It overrides the 'Native SQLite is the sole selected next database engine' clause in AGENTS.md for the purpose of a controlled PostgreSQL pivot.

## Context and decision

The new owner instruction requests shared-PG Cloud tenancy, operator controls and configurable tenant policy, preserving the working native SQLite engine as the semantic reference. Cloud uses a shared database with separated operator, auth and tenant_data schemas; every tenant-scoped business/rule table has tenant_id and ENABLE plus FORCE RLS. Shared schema replaces schema-per-tenant, not membership/resource/field/amount/branch/period/approval enforcement. Fully Private uses an isolated customer PostgreSQL installation/database if and only if that profile is independently packaged, licensed and verified; it must retain local identity, no vendor issuer/global customer registry and no required Cloudflare connection.

One migration lineage, controlled pools and coordinated backup simplify Cloud operations; they do not remove tenant restore isolation, noisy-neighbor limits, large-table maintenance, RPO/RTO measurement or application permission gates. No billions-of-databases or downtime guarantee is made. Native SQLite remains the current production path and the offline companion remains separately scoped. No Cloudflare runtime, network port, tunnel, DNS or production service is changed by this ADR.

## Data and authority invariants

Preserve exact historical source ids, voucher numbers, payload/evidence bytes, dates, actor links, journal/subledger values, policy/review history, idempotency receipts and outbox state. Keep original tenant id text in a protected unique mapping to new UUID tenant_id; arbitrary existing alpha/northstar ids must never be cast to UUID. Internal document/account/user ids stay compatible text unless a separately reviewed mapping is introduced. Keys and foreign keys include tenant_id (and existing company/branch components where applicable), so RLS does not merely hide an illegal cross-tenant reference.

Business schemas preserve existing column names; compatible sidecars/projections expose new pending status/origin metadata without overwriting accepted command payloads. Posted rows and children remain immutable, and new child inserts into a posted source are forbidden. Editable pending work creates an attributable immutable submission revision, exact digest and policy-version binding; any edit invalidates prior approval. The PG adapter must distinguish these new pending semantics from baseline parity, never weaken assertions to hide a behavior change.

RLS context is transaction-local and server-verified; missing context is default-deny. Customer roles own no tables and have no superuser/BYPASSRLS authority. Reference data may expand configured tax/action/document domains, but a new reference row never installs executable posting/authorization logic; registered typed handlers and deterministic validators remain required. Monetary values use exact integer minor units or reviewed numeric precision, never floats. Native account templates are bootstrap fixtures, not an immutable chart in code.

Operator login, cross-tenant authority and customer support consent remain separate. SECURITY DEFINER reads need an authenticated nonspoofable operator, current allowed scope, named customer grant where required, fixed safe search_path, restricted EXECUTE and least-privileged non-login owner. A reason alone grants no access. Successful reads and their audit are atomic; failed attempts need independent durable security logging because rollback also rolls back a preceding audit INSERT. No public unrestricted SQL endpoint exists.

## SQLite retirement gate

SQLite remains production until all four conditions hold: (a) the parity harness passes financial, linked-subledger, numbering, approval, evidence, crash/retry and permission scenarios; (b) RLS coverage and negative access tests are CI-enforced, including partitions, children and auth membership where applicable; (c) a timed independent PostgreSQL base-backup/WAL restore drill has been performed and the owner signs the designated acceptance line; (d) the owner explicitly authorizes cutover. PIVOT-012 records measured evidence, not this design session. Production data migration and final cutover require separate authorization.

No dual writable authority or casual dual writes. Plan fencing, catch-up/reconciliation, compatible protocol windows and rollback/forward repair before later data movement. A restored snapshot is never a second live writable copy; an old image cannot undo newly accepted transactions safely.

## Reversibility and extension points

Keep all SQLite/reference code, schema, tests, data and historic SQL unchanged. This ADR creates no database dependency in the active profile and runs no migration. PG target lives under db/postgres and a distinct adapter namespace. The backend interface separates authenticated context, command validation, persistence, numbering, effects, audit and outbox; new modules/providers register compatible handlers without editing existing module internals. Stored rule JSON has a versioned schema and effective dates; used policies are superseded, not mutated.

Constraints may later be lifted only by a new ADR with measurable isolation/recovery evidence: tenant partitioning/sharding, dedicated Cloud placement, alternate compatible stores, new auth/AI providers or stronger recovery profiles. The default design does not authorize a general rewrite, package-scope expansion or secret/vendor-control leakage into Private. testapp/testops are specified test origins only until separately provisioned.

## Contract ownership and sequence

This is PIVOT-001's deliverable; no duplicate PIVOT-001 contract file is created. AUTH-006 gates all business feature shipping and parity. PIVOT-013 ports the actual src/local engine/documents/trade/inventory/correction semantics through new PG interfaces before PIVOT-009/010 can compare them. New pending/AI-origin capability tests are an explicit extension lane in addition to unchanged baseline parity. Exact implementation contracts and the final dependency graph are separate subsequent session items.

## Sources

Owner pivot spec Phases1-6 and canonical AUTH/AI constraints; retained docs/sources/SAVEN-mandate-v2.3.md sections3,6.1,7.1-7.8; docs48 and49. PostgreSQL RLS/functions/transaction semantics and auth provider documentation must be checked against the pinned implementation versions before executable contracts are accepted. No gate was executed in this session.

## Owner override — 16 November 2026

[D-013 terminal entry voiding](04-adr-terminal-entry-voiding.md) supersedes any interpretation that retained posted entries must remain active in the GL. Physical posted sources stay immutable; an append-only terminal void removes their effective ledger inclusion. This is an authorized design amendment, not implementation, acceptance or cutover evidence.
