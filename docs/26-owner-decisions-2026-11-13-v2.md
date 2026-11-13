# v2 reconciliation and implementation checkpoint

Governing source: [the complete owner mandate v2.0](sources/SAVEN-mandate-v2.md), supplied 13 November 2026. Its 802 extracted lines were read in full. It supersedes conflicting earlier master/turnkey prompts. Original four November 11 baselines and all valid subsequent functional requirements remain required. The authenticated ERPNext reference was inspected through read-only workspace and form-metadata requests, not a visual browser walkthrough. No financial record was created there.

## Observed baseline

`testing-1`: da1bdb14880086f979cfaf33b7c90841b9bca8a0. No local git checkout exists; remote tree leases govern publication. Local source has historical encoding/newline differences in several baseline documents; do not overwrite unrelated text. Baseline checks: 63 tests, 89 JavaScript parses, 239 catalog requirements in 20 families. Public API independently reports PostgreSQL schema 13 and schemaReady=true. Schema 14 is tested source, not activated. The current PG business service, object store and ordinary posting policies are retained. No current SSH, database administrative inspection, browser rendering or production verification is claimed.

## Conflicts and decisions

| Earlier assumption | v2 governing decision | Handling / trace |
| --- | --- | --- |
| PostgreSQL required target control plane or business store | All-SQLite family; Cloud D1 control domains; local tenant SQLite | ADR 011–016; keep PG reference and all financial tests; no live cutover in this increment |
| SaaS app attaches customer-owned database node | Rejected | Exactly Cloud and Fully Private; Offline is a companion; OPS-008/OPS-016/OPS-018 |
| One company/login equals one database | Tenant/subscription contains one or more legal companies | FND-001; default one tenant file with company keys; atomic intercompany limited to that file |
| PostgreSQL RLS transfers to SQLite | It does not | SEC-002/SEC-012; gateway authority and node-local resource predicates plus constraints and negative API tests |
| Implement another backend module before UX | Full-product frontend review first | UX-007–UX-010; preserve live workflows; isolated synthetic /design/ |
| Heavy decorative glass | Warm neutral/charcoal, restrained plum, readable dense tables | UX-001/UX-005; no external fonts/assets copied |
| Missing global search | Search/command palette across modules and records | UX-008; prototype only initially; live search needs permission-safe server contract |
| Every central log written to D1 | Four log classes with owning-transaction audit/outbox | SEC-013/OPS-006; noncritical telemetry bounded, never sample financial audit |
| Reverting image restores migrated data | False | OPS-020; expand/backfill/contract; snapshot before divergent writes, forward repair afterward |
| Prototype Save means transaction completed | Prohibited | UX-009; explicit simulation and no design-to-business API connection |
| Module disabled means data removed | Prohibited | CFG-002; preserve historical read/export and dependencies |
| Preparers always need review | Superseded by published authority | FND-012/CFG-003; preparer direct posting remains supported under conditions |
| Full accounting means journals plus a few forms | Full connected workflows and settings remain required | All ACC/SAL/PUR/TAX/INV/MFG/POS/AST rows retained; design does not close implementation gaps |

## First safe batch and gates

1. Commit reconciliation, source precedence, PG object inventory, new ADRs, risk and requirement mappings.
2. Generate a screen/contract inventory for every requirement; build a separately served synthetic design workspace. Prioritize accounting, invoices, Payments, tax, stock, manufacturing and POS; expose all families and explicit gaps.
3. Verify synthetic boundary, search, keyboard behavior, state contracts and exact preview examples. Owner review is required for DESIGN_APPROVED; no automatic approval or live financial mutation.
4. In parallel only a synthetic SQLite BI/contract spike may prove feasibility. It is not the tenant port or D1 deployment.
5. After design approval, port storage/authority and compare fixtures against retained PG. Then fleet/private/offline gates before adoption. The 1,000-tenant chaos, 5m-line BI/POS, private install and complete recovery gates remain unpassed.

Current design approval: none. Screens, screenshots, novice task timings and accessibility/visual acceptance must be collected before approval. Main and production remain outside authorization.
