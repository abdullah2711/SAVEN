VERDICT: REVISE

WHY: The tenant-leading keys, default-deny runtime boundary, preserved native columns and ordinary pending-document sidecars fit the skeleton contract, and the questions already settled at 43666dc do not block it. However, the schema drops a native inventory valuation constraint, its tax default is absent from its canonical domain seed, and one configurable rule domain is hardcoded as a JSON Schema enum. These are source/invariant defects despite the reported green gate. Correct them without adding RLS, auth mapping, posting or audit-trigger implementation to this delivery.

## Review identity and scope

- Date: 15 November 2026 (Asia/Karachi).
- Delivery: `opencode/pivot-003` at `62405d27c559e5d0ebd7d3254711e636db070f6c`, against `testing-1` at `6c8bc25840ff7e8eb5f55f24e69c1fc91695fd9f`.
- Read delivery and source in `/home/esc/saven/wt-rev-pivot-003`; checked its HEAD against the supplied SHA and inspected the five-file diff, SQL, JSON seed, README and all three tests against the contract/native schema and inventory map. Four implementation paths match TOUCH; the fifth is the standard delivery report.
- Worker reports 3/3 focused and 153/153 full-suite tests with zero skips, fail-closed missing-opt-in evidence and a disposable-cluster compatibility observation against AUTH-001. Those are read evidence, not reviewer reruns. No contract, generator, SQL migration, test suite, production operation or merge was executed in this review.

## Required corrections

1. **P1 — zero physical quantity can retain owned stock value.** Native `src/local/schema.mjs:65` has `CHECK(quantity>0 OR value=0)` on stock_balances. The target `db/postgres/20-tenant-schema.sql:523–542` retains independent nonnegative quantity/value bounds but omits their relationship. With valid company/warehouse/item keys, `(quantity=0, value=100, version=1)` satisfies every target constraint while SQLite rejects it. Restore this row-level financial invariant with an additive constraint; add negative INSERT and UPDATE cases and valid zero/zero and positive-quantity cases. This is not bill-and-hold customer custody: the affected table is the native owned-stock balance, and the lost constraint must retain native parity. PIVOT-005/013 are not a reason to omit a native structural CHECK.

2. **P2 — SQL tax default is outside its canonical seed.** `20-tenant-schema.sql:966` defaults `tax_profile.tax_type` to `sales_tax`; `contracts/postgres-business-rules-v1.json:167` seeds `SALES_TAX`, not `sales_tax`. A profile inserted with the default cannot resolve that exact reference value. Choose the already seeded `SALES_TAX` as the default in the additive correction; test a defaulted tax profile against the canonical seed. Also correct the JSON authority note at line 14 from `origin_type AI` to the actual seeded `ai`. Extend consistency coverage beyond the set of domain names so default values and canonical notes cannot silently drift. Preserve historical/native text values; this correction is not authorization to rewrite existing rows.

3. **P2 — configurable rule severity is a hardcoded domain.** JSON Schema at line 219 fixes severity to `enum: ["block", "warn"]`, although CONVENTIONS requires growing rule/configuration domains to live in reference data. Move the allowed configured values into a named reference domain with documented effective-date/registered-handler validation; retain a structural string schema rather than another inline enum/list. A new reference value still cannot install executable policy. Add schema/seed checks covering nested configurable enums, and prove the new annotation/seed match. The existing static test checks SQL CHECK lists but does not cover JSON Schema enums.

## Existing rulings and accepted deferrals

[Technical rulings at 43666dc](PIVOT-003-technical-rulings.md), on `codex/pivot-003-rulings`, remain binding for this review:

- D-008 names are settled; the rebuilt branch has the supplied testing base and no AUTH-001 implementation files in its diff. No new branch decision is required.
- No runtime grants before forced RLS is the correct boundary. PIVOT-004 owns policies plus per-table customer grants atomically. Auth-service/definer roles receive no tenant-data reads by implication; later operator-definer access needs its own explicit contract.
- Keeping native text member ids here is correct. PIVOT-004 adds `members.user_uuid` and exact `(user_uuid,user_id)` to canonical auth mapping plus `(tenant_id,user_uuid)` membership constraints after both prerequisite deliveries are accepted/integrated. Do not add those links to this skeleton correction.
- Reference annotations plus JSON seed remain canonical checked-in specifications; actual tenant values live in reference_values. Ruling 4 approves the mechanism, not every seed/default or inline enum, so findings 2–3 refine consistency within that mechanism.
- Native audit remains separate from audit_event. No backfill/deduplication prerequisite is added. PIVOT-006 must protect both stores and define prospective actor-bound atomic change coverage; sidecar counts cannot replace native audit reconciliation.

Other inspected boundaries: all 47 table PKs lead with non-null UUID tenant_id, internal FKs are tenant-scoped, existing company/branch key components are retained where present, and financial columns use bigint/numeric rather than floats. Boolean flag conversion is disclosed and lossless for native 0/1. Account codes remain tenant-scoped as in the source. Deferral of additional company/auth links, forced isolation and query indexes to PIVOT-004 follows that contract; it is not current security evidence. No vendor operator FK is imposed on Fully Private. Omission of business_member_operations from tenant_data follows its auth inventory mapping, not a scope removal.

No late-child/posted immutability, active-owner existence/transfer, balanced posting, policy/JSON execution or audit append-only enforcement is accepted from a trigger-free skeleton. The tests prove a maximum of one protected role/owner assignment, not exactly one active owner after activation. A duplicate policy-version INSERT rejection proves key uniqueness, not immutable existing versions; the report's “append-only policy versions” wording must be corrected accordingly. No serving or client onboarding is authorized.

EXTENSIBILITY: VIOLATED — the configurable posting-constraint severity list is embedded in a JSON Schema enum rather than reference data (finding 3). No new concrete cross-module imports or irreversible data migration were found. Required review target after correction: no new hardcoded enums; no new coupling across module boundaries; no new one-way decisions without an ADR.

## IF REVISE: scoped correction contract

TASK: PIVOT-003-R1 — restore native empty-stock valuation integrity, reconcile canonical defaults/notes and externalize configurable severity.
TOUCH: db/postgres/migrations/021-tenant-schema-corrections.sql; db/postgres/README.md; contracts/postgres-business-rules-v1.json; tests/pivot-003-schema.test.mjs; docs/contractor/deliveries/PIVOT-003-tenant-schema.md
FORBIDDEN: All paths outside TOUCH; especially original 00/10/20 SQL, auth bootstrap/schema, native/reference code and applied migrations, fixture helpers, production data, credentials, archived frontend, runtime entry points and protected refs; no RLS/grants/triggers, merge or deployment.
DONE WHEN: node scripts/check.mjs && node --test tests/pivot-003-schema.test.mjs
INVARIANTS: Original PIVOT-003 invariants remain; additive named stock constraint and tax-default correction, preserve applied/source bytes and all tenant-scoped keys/ownership; invalid existing stock refuses validation without silent repair; canonical configured domains remain extensible and data-only; no runtime grants, new identity authority, lost history, floats or softened assertions.
PATTERN: src/local/schema.mjs stock_balances CHECK; delivered JSON reference domains and static/live test split; apply new 021 after original 20 through the test's existing sqlFiles option and documented run order.
NOTES: ADR01 Data and authority invariants; CONVENTIONS SCHEMA/ACCOUNTING; 43666dc rulings 2–5. Worker implements findings 1–3, preserves original bootstrap bytes, adds negative/positive live stock cases and canonical-default/configurable-domain checks, and corrects claims about immutable versions/active-owner existence. Record exact revision, supported Node >=24.13 <25, disposable-cluster gate output and cleanup. Serialize shared README after AUTH-001-R1; do not overwrite that correction. No historical audit backfill, schema-serving claim or worker scope expansion.

Both deliveries remain unaccepted pending correction and resubmission. Their later dependency PIVOT-004 must use the revised technical contract at 43666dc, not infer readiness from this review batch. SQLite remains production; merges remain with the human.
