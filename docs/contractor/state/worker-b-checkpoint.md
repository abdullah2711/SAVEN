# WORKER-B checkpoint — PIVOT-006 R1 corrections delivered, awaiting review

Date: 17 November 2026 (Asia/Karachi). Written under the owner standing checkpoint
directive; this file is outside any contract TOUCH.

## Current state

- PIVOT-005 is complete and human-merged into `testing-1` at
  `32fef2beac91a73b2c8a5ae9c150603736993e97`; post-merge checkpoint `e671882`.
- PIVOT-006 branch: `opencode/pivot-006-audit`.
- Worktree: `/home/esc/saven/wt-pivot-006`, based on `32fef2b`.
- Previously reviewed head: `3c40839c5a2c4ba547bd4abcdf8af022b3f9c281`.
- R1 implementation commit: `12732d3d1210a98fe446078d5a2b359a7a302553`
  (`db: bound audit authority, native actors, serialization and provenance
  [contract:PIVOT-006]`).
- Delivery report: `docs/contractor/deliveries/PIVOT-006-audit-triggers.md`
  (required by review `d8fe104`).
- This checkpoint is a follow-up commit on the same branch. PIVOT-006 is **not merged**;
  no main/other branch was changed and no force was used.

## Review corrections closed (d8fe104)

1. **Dedicated least-privileged audit owner.** 041 is now an offline-admin payload that
   provisions `saven_audit_definer` (`NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE
   NOINHERIT NOBYPASSRLS NOREPLICATION`). It owns only the audit writer, native-audit
   guard, serializer, row-key and origin helper. Exact authority: `tenant_data` USAGE;
   enumerated `members` and `reference_values` mapping reads; enumerated `audit_event`
   column INSERT; `audit_event_id_seq` USAGE; exact context/admission helper EXECUTE.
   Install validates attributes, memberships, ownership, schema/table/sequence/column/
   function ACLs, default privileges and exact function configuration, refusing polluted
   roles without repair. No runtime business/evidence grant, table ownership, schema
   CREATE, broad auth/operator read or admission-owner expansion.
2. **Native audit actor binding.** A new `immutability_041_audit_native_guard` attaches
   BEFORE INSERT on `tenant_data.audit` and requires the admitted canonical tenant/actor
   (`AUDIT_ACTOR_MISMATCH` on spoof/invented actor, `AUDIT_CONTEXT_REQUIRED` on missing
   context). Historical ids/bytes/timestamps/counts are not rewritten or backfilled.
   Tests cover runtime success, spoofed/invented actor, missing context, rollback and the
   existing void-definer ENTRY_VOIDED path.
3. **Versioned secret-safe serialization.** Version 1 serializer retains structured
   scalars and reviewed business text; JSONB and unreviewed text become a redacted digest
   marker and are listed in `redactedColumns`; unsupported column types fail closed with
   `AUDIT_SERIALIZATION_UNSUPPORTED`. Tests cover JSONB/text secret INSERT/UPDATE/DELETE
   negatives, safe business-value positives and a synthetic `bytea` fail-closed case.
   Original financial/source bytes remain intact.
4. **Validated provenance, no manufactured human origin.** Document origin columns are
   validated against active canonical `origin_type` reference values; AI retains
   model/version and requires a tenant-member proposer; human cannot name a model and
   falls back only to the verified actor when no origin user is supplied; integration
   requires identity/model. Generic changes record unavailable provenance as `system`
   with `detail_jsonb.provenance='unavailable'`, keeping `actor_id` as the verified
   acting principal. AI/human/integration positives and spoof negatives are tested; a
   client GUC cannot manufacture origin.
5. **Standard delivery report + activation/quiescence evidence.** The delivery report
   records exact branch/base/implementation/report identities, gates, covered/excluded
   tables, guarantees vs evidence and limits. Failed, partial and interrupted 041/40
   activation tests prove the dispatcher transaction leaves no partial audit trigger set;
   the 041-without-dispatcher window is explicitly unaudited and requires write
   quiescence. 040/042 bytes are untouched and 040/042-only compatibility remains
   honestly non-PIVOT-006 coverage.

## Evidence

- `node scripts/check.mjs` → PASS, 165 JavaScript files.
- Focused `node --test tests/pivot-006-audit.test.mjs` → **10/10 pass**.
- PIVOT-005 regression → **18/18 pass**.
- Serial full suite → **306/308 pass**; the two failures are the known out-of-TOUCH
  PIVOT-004 literal-global-role prerequisite and an AUTH-004-R1 fixture-teardown
  transient (`terminating connection due to administrator command`) under the combined
  run. No PIVOT-006 focused or PIVOT-005 test failed.
- Environment: dedicated disposable PostgreSQL 18.6 on loopback `127.0.0.1:55435`,
  `SAVEN_PIVOT_TEST_CLUSTER=1`, local admin `esc`, Node v24.19.0 via
  `npm exec --yes --package=node@24.19.0`. No global `saven_*` role was created; the
  fixture namespaced and removed every object. Cluster stopped after verification.
- AUTH-006 remains required for final application acceptance. Fixture `SET ROLE`/GUCs
  are not verified application provenance. Failed-attempt durability and operational
  reconciliation remain PIVOT-013.

## TOUCH used

`db/postgres/40-triggers.sql`, `db/postgres/migrations/041-audit.sql`,
`db/postgres/README.md`, `tests/pivot-006-audit.test.mjs`,
`tests/helpers/pg-pivot-fixture.mjs` (namespaced audit-definer support only, per the
ENGINEER R1 amendment), the required delivery report and this checkpoint. 040/042
payload bytes, native/reference source, archive, production/server entry points and
PIVOT-004 fixtures/tests are untouched.

## Where I stopped

R1 implementation, delivery report, focused/regression/serial full-suite evidence,
commit and push are complete on `opencode/pivot-006-audit`. No review corrections have
been started. PIVOT-006 is not merged.

## Exact next step

1. Await the Codex review/verdict on this PIVOT-006 R1 delivery (expected on
   `origin/codex/pivot-003-rulings`).
2. On **REVISE**: fetch the rulings branch, read the new review in full, apply exactly the
   scoped corrections inside the PIVOT-006 TOUCH/amendment, re-run the focused gate plus
   PIVOT-005, update the delivery report/checkpoint, commit and push; do not merge.
3. On **ACCEPT**: stop and report; a human Business Merge Request is required. Do not
   merge without the dispatcher's explicit merge instruction.
4. PIVOT-006 application acceptance remains gated by AUTH-006; failed-attempt durability
   and operational parity remain separate PIVOT-013/PIVOT-009/010 work.
