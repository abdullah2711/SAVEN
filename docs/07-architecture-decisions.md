# SAVEN Architecture Decision Register

11 November 2026 | Proposed decisions for review

## ADR 001 One modular transaction core

Use a modular application and PostgreSQL transaction boundary for accounting and connected subledgers. Shared business commands coordinate effects. This reduces distributed reconciliation work at the start. Modules must own records and expose contracts so later extraction remains possible. Revisit when measured bottlenecks or team structure justify the operating cost of services.

## ADR 002 Shared command authority

Forms APIs integrations and AI use the same permission validation approval and posting services. No AI SQL path is permitted. Approval binds payload and evidence versions. This constrains the model's effect without assuming its interpretation is always correct. Revisit tool coverage as modules grow, preserving the authority boundary.

## ADR 003 Company scope with database defense

Begin with a shared database in bounded tenant cells, explicit company keys and PostgreSQL row security as defense in depth. Runtime users cannot bypass row security. Cross-company and maintenance paths are explicit and tested. A separate database per private deployment is supported. Revisit cell size and high-isolation offerings from measured requirements rather than assumed billion-user load.

## ADR 004 App isolation and one registry

One Apps area governs UI apps connectors and workflow actions. Their execution mechanisms differ: isolated origin UI or isolated workers with scoped APIs. Arbitrary customer code cannot run in the accounting runtime. This limits freedom to protect other customers. Revisit additional extension points only after a threat model and compatibility contract.

## ADR 005 Application owned AI memory

Store permissioned structured facts and summaries with provenance and lifecycle controls. Embeddings are optional derived indexes. Model providers are replaceable through evaluated adapters. Customer information is not automatically reusable across tenants or for model training. Revisit memory retention and regional storage by customer and country requirements.

Revision 1.1 adds an optional company knowledge model beyond chat memory. Link facts and relationships to exact source versions and supporting locations; retain business effective time and observation time. Shared knowledge preserves source sensitivity. Customer and operator controls govern capture and use, while disablement, retention, deletion and reactivation are separate operations. See [Company knowledge and memory](10-company-knowledge-and-memory.md). Historical knowledge and inferred summaries cannot override current authoritative records or published policies.

## ADR 006 Change with historical meaning preserved

Use versioned policies schemas reports and posting rules, with effective dates and expand-migrate-contract migrations. A new release may require core work; it must preserve historical interpretation and have rehearsed recovery. Revisit compatibility windows when real integration support costs are known.

## ADR 007 No automatic financial AI execution initially

Financial AI prepares and submits. A human explicitly executes through configured approvals. Later automatic routines require a separate authority policy and task evidence. This is a recommended launch default for decision D03; the user's vision of broad tool coverage remains intact.

## ADR 008 Recommended stack subject to foundation evidence

Recommend React TypeScript Django PostgreSQL object storage and durable workers. The permanent team and a foundation spike must validate migrations tenant scope decimal arithmetic contracts private packaging and recovery. Exact versions remain implementation decisions. This recommendation is not evidence that a production scaffold exists.

## ADR 009 Cloudflare foundation experiment — 11 November 2026

The owner's new input prefers Cloudflare Workers, database and buckets while preserving a self-hosted path. The first foundation now uses native Worker ES modules, D1-compatible prepared statements and batches, fixed-point BigInt financial calculation, a local Node/SQLite adapter, and a buildless browser workspace. This supersedes ADR 008 as the immediate spike choice, not as an irrevocable production database decision. ADR 003's PostgreSQL row-level security is not available in D1 and has not been claimed. The complete suite still requires a database/capacity/security decision supported by measured evidence. See [foundation implementation](12-foundation.md).

