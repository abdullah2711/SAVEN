# WORKER-B checkpoint — PIVOT-006 R3 delivered, ACCEPTED, awaiting human merge

Date: 18 November 2026 (Asia/Karachi). Written under the owner standing checkpoint
directive; this file is outside any contract TOUCH.

## Current state

- PIVOT-005 is complete and human-merged into `testing-1` at
  `32fef2beac91a73b2c8a5ae9c150603736993e97`; post-merge checkpoint `e671882`.
- PIVOT-006 branch: `opencode/pivot-006-audit`.
- Worktree: `/home/esc/saven/wt-pivot-006`, based on `32fef2b`.
- **PIVOT-006 R3 delivered at `5d909a78dcb2258cb87b012f7195214b7edf3826`**
  (`docs: record PIVOT-006 R3 intermediate failure evidence`; implementation
  `cb81f11cc9f29c9dec5acccb16cb06c20df8337f`).
- **Codex ACCEPT at `26f8263` (02:45 PKT, 18 November 2026).**
- PIVOT-006 is **awaiting the human merge decision** and is a merge-queue item. It is not
  merged; no main/other branch was changed and no force was used.
- Worker status: **idle, not looping**, since approximately **02:00 PKT** awaiting the
  verdict. No new work was started after that point.

## Review corrections closed (d8fe104, R1 review and R2 review)

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
6. **R1 serialization/schema correction.** The serializer now classifies supported base
   types by catalog type identity, preserving exact parameterized numerics
   (`numeric(20,4)` on `approval_policy` thresholds/self-approval and `numeric(9,6)` on
   `tax_profile.rate`) without float casts/rounding. Every registered table has an exact
   reviewed schema fingerprint over ordered column names, base types and typmods; new,
   renamed or retyped columns raise `AUDIT_SERIALIZATION_SCHEMA_CHANGED`, unknown base
   types raise `AUDIT_SERIALIZATION_UNSUPPORTED`, and both roll back. Real
   customer-role INSERT/UPDATE tests cover both decimal tables with exact before/after
   values; rollback and context-bound DELETE/rollback are tested. Catalog-driven coverage
   asserts all 42 registered table fingerprints, a new allow-listed-name column and a
   supported base-type change both fail closed. Reviewed business free text remains
   explicitly retained with the documented non-universal-secret-free limit.
7. **R2/R3 catalog type identity and schema inventory.** 041 now resolves type identity
   through `pg_catalog` OIDs, type kind and recursive domain-base resolution; no
   `typname` or type-name literal comparison remains. Custom domains over text still
   redact; custom domains over `numeric(20,4)` still write/audit exact money values.
   Every registered table has an exact fingerprint over column names, resolved base OID
   and effective typmod. The activation pipeline refuses a changed fingerprint or a
   column base type outside the exact representable OID allow-list. The focused test
   enumerates every column type actually present and fails if the reviewed type set
   changes. The unrepresentable-type decision is explicitly fail-closed (no
   redact-and-warn).

## Intermediate failure evidence (R3)

- First R3 activation run failed with exact text
  `PIVOT-006: unreviewed schema change on audit table account_profiles`.
  Hypothesis: `immutability_041_resolve_type` is `RETURNS TABLE` but used bare `RETURN;`,
  so it emitted zero rows; the fingerprint aggregate was NULL for every table. Fix:
  `RETURN QUERY SELECT v_type, v_mod; RETURN;`. The same resolver failure made the new
  schema-wide type enumeration initially return an empty actual-OID set. After the fix,
  the catalog fingerprint, decimal, domain and pipeline-alarm tests passed.

## Hardening directive status

- (i) schema-wide column-type enumeration: implemented in
  `tests/pivot-006-audit.test.mjs` (`actualTypeOids`/`expectedTypeOids` and zero
  unsupported columns), backed by `immutability_041_resolve_type`/`type_supported`.
- (ii) unrepresentable-type decision: explicitly fail-closed in
  `db/postgres/README.md` and the delivery report; no redact-and-warn.
- (iii) pipeline alarm: implemented in the `40-triggers.sql` activation block
  (fingerprint + resolved-base-type checks) and proven by the new-column/new-type
  activation negatives in the focused test.

## Evidence

- `node scripts/check.mjs` → PASS, 165 JavaScript files.
- Focused `node --test tests/pivot-006-audit.test.mjs` → **12/12 pass**.
- PIVOT-005 regression → **18/18 pass**.
- Serial full suite → **308/310 pass**; failures are the known out-of-TOUCH
  PIVOT-004 literal-global-role prerequisite and the unchanged AUTH-004-R1
  fixture-teardown transient under the combined run. No PIVOT-006 focused or PIVOT-005
  test failed.
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

PIVOT-006 R3 was delivered, pushed and accepted. I have been idle since approximately
02:00 PKT awaiting the verdict and did not start any new work; the ACCEPT arrived at
02:45 PKT but was not relayed until now. No review corrections, vertical slice, contract
work or merge action is in progress.

## Exact next step

1. **Await the dispatcher's post-merge assignment** after a fresh reload: either the next
   vertical slice or the next contract, with its exact worktree and base SHA.
2. Do not start new work, merge PIVOT-006, or reopen the accepted branch without the
   dispatcher's explicit instruction. PIVOT-006 remains a human merge-queue item.
3. PIVOT-006 application acceptance remains gated by AUTH-006; failed-attempt durability
   and operational parity remain separate PIVOT-013/PIVOT-009/010 work.
