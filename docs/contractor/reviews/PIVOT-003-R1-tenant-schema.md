VERDICT: ACCEPT

WHY: PIVOT-003 at 80574d0, including its R1 correction, closes all three findings from the review at 50b6749. An additive validated CHECK restores native empty-stock valuation integrity, the effective tax default and origin note match the canonical seeds, and configurable severity is reference data with a structural JSON shape. The focused tests preserve the skeleton boundaries and cover the corrections. Acceptance is for this default-deny schema skeleton, not RLS, posting, immutable policy enforcement or production use.

Date: 15 November 2026 (Asia/Karachi).
Delivery: `opencode/pivot-003` at `80574d07fc88312615ce65c253f8fc33b17447ac`.
Reviewed worktree: `/home/esc/saven/wt-rev-pivot-003-r1` (HEAD verified).
Review baseline: original delivery `62405d2`; governing revision contract: [PIVOT-003 review](PIVOT-003-tenant-schema.md) at `50b6749`.

The historical REVISE is retained; this verdict supersedes it for the exact SHA above. The R1 delta has only its five authorized paths. Read-only Git comparison confirms original `00`/`10`/`20` SQL bytes are unchanged. No AUTH implementation file appears in this branch's integration-base diff.

Finding closure:

1. `migrations/021-tenant-schema-corrections.sql` adds and validates `CHECK (quantity > 0 OR value = 0)` with no data repair, grant or trigger. Tests include invalid zero-quantity/nonzero-value INSERT/UPDATE, accepted zero/zero and positive-quantity/zero-value rows, catalog validation and refusal of invalid pre-existing data in a rolled-back probe. This retains the native owned-stock invariant rather than confusing it with customer custody.
2. The correction changes the effective tax default to seeded `SALES_TAX`; the live test inserts a defaulted profile and checks its returned value. The origin authority note uses seeded `ai`. Static checks now resolve annotated column defaults including additive overrides and validate status/origin tokens in canonical notes.
3. `posting_constraint_severity` supplies seed rows and explicit effective-date/registered-handler semantics; severity's JSON Schema is a bounded string with a reference-domain description. The new column annotation matches the seed and nested JSON enums are checked. Unknown handler/severity rejection remains an implementation requirement, not executable behavior delivered by this file. Seed assertions fix the bootstrap examples, not a runtime growing enum.

The report records Node `v24.19.0`, exported disposable-cluster configuration, 3/3 focused tests, 153/153 branch-suite tests, preserved missing-opt-in behavior and cleanup. It also reports a combined schema run-order observation using AUTH-001 at `991bc06`. These are supplied worker observations, not independent reviewer reruns or an integrated CI result. The standalone AUTH suite's 166 count is not a combined AUTH-plus-PIVOT integration count.

The shared README carries the AUTH-001-R1 material before the tenant correction and documents both correction migrations in its top-level run order; serialized ownership was respected. Two nonblocking prose corrections remain for the next authorized shared README edit: its later literal `sqlFiles` example still omits 021 despite the actual test including it, and full-suite instructions should select `SAVEN_PIVOT_TEST_CLUSTER=1` rather than AUTH-only opt-in. Preserve both branches' sections during human integration; this review makes no conflict-free merge guarantee.

[Technical rulings at 43666dc](PIVOT-003-technical-rulings.md) still govern PIVOT-004: policies and customer grants land atomically, stored UUID projection has exact canonical text/UUID and tenant membership constraints, auth roles get no tenant-data reads, annotations/JSON remain canonical, and no native-audit backfill prerequisite is introduced. AUTH-001 and this skeleton must be accepted and integrated before dependent work treats them as its base.

Limits remain explicit: 47 tenant tables and tenant-leading keys do not provide forced RLS, exactly-one-active-owner existence, posted-source protection, balanced posting or append-only policy history without the later contracts. Corrected README wording distinguishes uniqueness from immutability and at-most-one from active-owner existence. There is no safe-serving or onboarding authorization.

EXTENSIBILITY: no new hardcoded enums; no new coupling across module boundaries; no new one-way decisions without an ADR. The prior configurable-enum finding is closed, financial constraints are restored additively, and historical ids/source/audit bytes remain untouched.

No contract, SQL migration, generator, suite, backup, deployment or merge was executed by the engineer. Combined integration/CI and later release gates remain outstanding. SQLite remains production. Merges remain with the human.
