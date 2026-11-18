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

---

# ALLOCATOR INVENTORY — standing D-016 base (read-only sweep)

Captured 18 November 2026 under the Principal's read-only directive. **No code was
changed and no allocator was fixed**; this section records findings only.

- Tree swept: `testing-1` @ `d4c2c6b` (PIVOT-006 merged at `bdf9f80`).
- Scope: every allocator site — sequence seed/creation, setval/nextval, generation
  counter, `MAX(...)+1` / `max(id)+1` pattern, high-water mark, plus both restore paths.

## Method notes and citation discrepancies (reported honestly)

1. **`db/postgres/06-operator-identity.sql:58` does not exist in the tree.** `db/postgres/`
   contains only `00-roles`, `05-auth-schema`, `10-operator-schema`, `20-tenant-schema`,
   `30-rls-policies`, `40-triggers`, and `migrations/` (006, 021, 031, 032, 033, 040, 041,
   042). The cited file layout appears to be from an older/D1-era tree.
2. **There is no `setval`, no `nextval`, and no `CREATE SEQUENCE` anywhere in the
   repository** (SQL, JS, JSON, scripts). Every sequence is implicit `bigserial` /
   `GENERATED … AS IDENTITY`; allocation happens in the engine, never via explicit setval.
3. `033-membership-admission-lock.sql` allocates nothing; it serializes epoch/role changes
   (`auth.lock_authority_gate`, 033:90-99). `041-audit.sql` only grants **USAGE** on
   `tenant_data.audit_event_id_seq` (041:601) and allow-lists that privilege (041:717).
4. **Legacy/pivot split (correction to an earlier note).** `scripts/setup-postgres.sh:14`,
   `scripts/rehearse-recovery.sh:15`, `scripts/postgres.mjs:49` and
   `scripts/verify-postgres.mjs:19-21` all bind the **legacy** `postgresql/00X_*.sql`
   schema (`schema_version`, `public`, `saven_app`). The `db/postgres/` pivot tree
   (`tenant_data`, `saven_customer_app`) has **no application wiring and no backup or
   restore script at all**. Consequently the dump/restore paths in `scripts/` do not
   cover `tenant_data`.
5. Sanctioned PG path: `scripts/backup-postgres.sh:18,20` uses `pg_dump --format=custom`
   (carries sequence state), `scripts/rehearse-recovery.sh:14` restores a full dump.
   Schema files use `CREATE TABLE IF NOT EXISTS`, so plain reapplication does not reset
   sequences. The hazard is data-only / partial / fresh-schema restore, which has no
   reconciliation.

## A. ADVANCE-ONLY

| # | file:line | Allocates | Justification |
|---|---|---|---|
| A1 | `db/postgres/20-tenant-schema.sql:372` | document-number high-water (`document_sequences.next_number`, `CHECK > 0` at :378) | Monotonic by guard + atomic same-row increment; `IF NOT EXISTS` means reapply cannot reset it. |
| A2 | `db/postgres/migrations/040-posted-immutability.sql:916` | rejects `NEW.next_number < OLD.next_number` | `DOCUMENT_SEQUENCE_REGRESSION` raised → the column can never move backwards, by any writer. |
| A3 | `db/postgres/migrations/040-posted-immutability.sql:908` | blocks deletion of a sequence row | `DOCUMENT_SEQUENCE_RETAINED`; a missing row cannot be re-seeded by ordinary operation. |
| A4 | `db/postgres/migrations/040-posted-immutability.sql:913` | blocks change of `(tenant,company,kind)` identity | `DOCUMENT_SEQUENCE_IDENTITY_IMMUTABLE`; the sequence identity cannot be re-pointed. |
| A5 | `src/local/document-schema.mjs:3,4` | SQLite mirror of A2/A3 (`sequence_only_increases`, `sequence_retained`) | Same monotonic/retention guards on the local store. |
| A6 | `db/postgres/20-tenant-schema.sql:387` (+ `040:897`, uniques `:398,:399`) | issued document numbers | `DOCUMENT_NUMBER_IMMUTABLE` + `UNIQUE(company,kind,sequence)` + `UNIQUE(company,number)` make reissue impossible, not merely discouraged. |
| A7 | `src/local/documents.mjs:14` | one document number per call (`next_number+1 RETURNING …-1`) | Single statement inside the caller's transaction; a rollback loses the number (gap) but cannot re-emit an issued one. |
| A8 | `src/local/documents.mjs:15` | number text (`kind-000001`) | Pure derivation from A7; no independent state. |
| A9 | `src/local/document-schema.mjs:6,7` | local number immutability | Blocks UPDATE/DELETE on `document_numbers`. |
| A10 | `src/local/sqlite.mjs:8` | `schema_migrations.version` (= array index + 1) | Refuses a newer schema, refuses checksum drift, applies only unapplied migrations → reinstall cannot re-run a migration. |
| A11 | `db/postgres/10-operator-schema.sql:281` | `pg_schema_migrations.version` (+ `CHECK > 0`, :289) | Migration ledger monotonic by construction; no code path decrements it. |
| A12 | `src/auth/recovery.mjs:312` | `auth.users.credential_version` (`… + 1`) | Only advancement is under `FOR UPDATE` principal lock in the reset transaction. *Application-enforced only — no DB trigger/CHECK prevents a privileged decrement.* |
| A13 | `src/local/licence.mjs:10,12` | entitlement certificate `sequence` | Install rejects `sequence <= old.sequence`; single-row table pinned by `CHECK(id=1)` → cannot regress. |
| A14 | `src/local/licence.mjs:10,13` | `private_licence_state.max_seen_at` | Written as `max(max_seen_at, now)` — a true high-water mark; clock rollback cannot lower it. |
| A15 | `src/commands.mjs:119`, `:205`, `:252`; `src/local/documents.mjs:47`; `src/local/inventory.mjs:12` | row `revision`/`version` optimistic tags | Per-row monotone counters with compare-and-set predicates; no silent reset in live operation. |
| A16 | `src/local/engine.mjs:26` | `journal_lines.line_no` = `i+1` | Positional within an append-only posted journal; no shared state to regress. |
| A17 | `src/local/schema.mjs:27` + `:35` | local `audit.id` (`INTEGER PRIMARY KEY` = rowid) | Rowid *would* be reuse-prone, but `audit_no_delete` blocks the only reuse path. |
| A18 | `src/local/schema.mjs:29-33` | posted journal/line immutability | Prevents deletion that could otherwise expose rowid/id reuse. |

## B. HAZARDOUS

| # | file:line | Allocates | Justification |
|---|---|---|---|
| B1 | `db/postgres/05-auth-schema.sql:400` | `auth.auth_audit.id bigserial` | Starts at 1 per schema; no guard/reconciliation, so a data-only or fresh-schema restore reissues ids — and this table is the auth evidence trail (`src/auth/rate-limit.mjs:161` reads it for ordering). |
| B2 | `db/postgres/20-tenant-schema.sql:334` | `tenant_data.audit.id` IDENTITY | Append-only business audit with no sequence guard; reinstall/restore resets to 1 → duplicate ids across archives. |
| B3 | `db/postgres/20-tenant-schema.sql:1017` | `tenant_data.audit_event.id` IDENTITY | Same class; 041 grants USAGE (041:601) and verify allow-lists it (041:717) but nothing pins the value. |
| B4 | `db/postgres/migrations/042-entry-voiding.sql:149` | `tenant_data.void_denials.id` IDENTITY | Same class; a reissued denial id collides with retained refusal evidence. |
| B5 | `db/postgres/10-operator-schema.sql:115` | `operator.entitlement.id bigserial` (+ `version` at :117, `UNIQUE(tenant_id,version)` :131) | Commercial entitlement identity and version both reset on reinstall; no allocator for `version`. |
| B6 | `db/postgres/10-operator-schema.sql:145` | `operator.operator_audit.id bigserial` | Operator privilege evidence; resequenced on reinstall → duplicate audit ids. |
| B7 | `db/postgres/10-operator-schema.sql:164` | `operator.feature_flag.id bigserial` | Config identity; reissue silently re-targets retained references. |
| B8 | `db/postgres/10-operator-schema.sql:248` | `operator.migration_events.id bigserial` | Migration-history evidence; reissued ids corrupt ledger ordering after restore. |
| B9 | `db/postgres/10-operator-schema.sql:265` | `operator.source_store_migrations.id bigserial` | Same class (import provenance). |
| B10 | `src/local/schema.mjs:56` | local `migration_events.id INTEGER PRIMARY KEY` | SQLite rowid alias = `max(rowid)+1` and **no delete guard exists on this table** → deleting the newest row reissues its id in normal operation. |
| B11 | `src/local/schema.mjs:59` | local `commercial_audit.id INTEGER PRIMARY KEY` | Same as B10: no `BEFORE DELETE` trigger → rowid reuse reissues a commercial audit id. |
| B12 | `src/local/documents.mjs:13` | seeds `document_sequences = 1` on first use (`ON CONFLICT DO NOTHING`) | Regresses to 1 when the sequence row is absent while numbers exist; the UNIQUE backstops turn that into a hard failure rather than a silent reissue — fail-closed but not reconciled. |
| B13 | `src/local/runtime.mjs:29` | `auth_limits.attempts` (windowed) | Resets to 1 when the 15-minute window expires — regression by design; no identity risk. |
| B14 | `src/auth/factors.mjs:203` | `two_factor.failed_attempts` | Resets on success/re-enrolment (`factors.mjs:361,382`) — intentional window counter. |

## C. Declared counters with NO allocator site (they never move)

| # | file:line | Declares | Finding |
|---|---|---|---|
| C1 | `db/postgres/05-auth-schema.sql:236` | `auth.tenant_membership.membership_epoch DEFAULT 1` | **No increment site anywhere** (reads only: `tenant-selection.mjs:224`, `session-store.mjs:550`). The documented role/status-change invalidation has no implementation. |
| C2 | `10-operator-schema.sql:191`; local mirror `src/local/schema.mjs:7` | `tenant_placement.generation` | Never written by any code path; the writable-owner fence never advances. |
| C3 | `src/local/schema.mjs:6` | `entitlements.version` | `tenant_id` is the PK, so only `version = 1` (`engine.mjs:19`) ever exists; no renewal/advance path. |
| C4 | `10-operator-schema.sql:208`, `20-tenant-schema.sql:356`; `src/local/schema.mjs:8` | `jobs.attempts`, `outbox.attempts` | Default 0 with no increment site in active code. |
| C5 | — | document numbering on PostgreSQL | **No production PG allocator exists.** `document_sequences` is guarded (A1-A6) but only `src/local/documents.mjs` allocates; `engine.mjs:33`, `trade.mjs:100,105`, `runtime.mjs:71,106` only read. |

## R. RESTORE PATHS (per store)

| # | file:line | Behavior | Verdict | Justification |
|---|---|---|---|---|
| R1 | `docs/pivot-notes/06-backup-restore-runbook.md:417` + `:633-650` (§10.3), `:138` format, `:397-401` (§6.9) | all PG identity sequences + `document_sequences` under PITR | **SAFE** | Sequences travel in WAL with the data; §10.3 compares `max(document_numbers.sequence)` to `document_sequences.next_number - 1` per `(tenant,company,kind)`, rejects duplicates, and the `next_number > 1 AND n.id IS NULL` query must return zero rows; line 417 states the no-renumber/no-reuse/no-rollback gate. **Limit:** §10.3 proves internal consistency only; reuse of numbers issued in the *abandoned* timeline is an operator obligation at line 417, not a mechanical check. |
| R2 | `scripts/backup-postgres.sh:18,20`; `scripts/rehearse-recovery.sh:13-15,31` | logical dump/restore sequence state | **HAZARDOUS** (and **UNKNOWN** for `tenant_data`) | Custom-format dump carries sequence values as of dump time; **no path in the repo advances allocators before serving writes** (no setval, no repair step). The rehearsal is legacy-only (`schema_version`, `saven_app`, `companies`, `stored_files`) and contains no numbering reconciliation; no dump/restore path exists for the pivot `tenant_data` schema at all. |
| R3 | `scripts/native-restore.mjs:13-15,21` (+ `scripts/native-backup.mjs:11-12`) | SQLite rowids + `document_sequences`/`document_numbers` | **HAZARDOUS** (in-file **SAFE**, offline **UNKNOWN**) | Restore validates a throwaway copy (`integrity_check`, `foreign_key_check`, unbalanced journals, stock vs movements) then copies stores **byte-exact** into a must-not-exist directory and re-verifies SHA-256. `sqlite_sequence` does not exist (no `AUTOINCREMENT` in production; only the spike `scripts/sqlite-bi-spike.mjs:5`), so there is no sequence object to reset — counters and numbers stay mutually consistent in-file. But restore performs **no** numbering reconciliation (0 references to `next_number`/`document_numbers`), so an older copy or diverged/offline device can reissue numbers undetected. |

## D-016 net position

- The only genuinely protected allocator is **document numbering** (high-water guard plus
  issued-number uniqueness, in both PG and SQLite), and on PostgreSQL it has **no
  production allocator implementation yet** (C5).
- Every identity sequence in both stores is **unguarded and un-reconciled** (B1-B9).
- Two local tables (`migration_events`, `commercial_audit`) can reissue ids **without any
  restore** (B10, B11).
- PITR is the only restore path with a numbering check; the logical and native restore
  paths have none.
- Two declared fences never advance (`membership_epoch`, `generation`) — see C1, C2.

## Branch placement note

PIVOT-006 was merged into `testing-1` at `bdf9f80` before this file was updated, so this
checkpoint commit sits on `opencode/pivot-006-audit` **after** the merge and is therefore
**not** on `testing-1` or `main`. It needs a follow-up merge (or a docs-only cherry-pick)
if the dispatcher wants the inventory on the integration branch. Nothing else was changed.

---

## RESTORE INVENTORY FOLLOW-UPS (Principal questions, same read-only sweep)

### (1) The native number allocator, named — **dedicated counter row, NOT max-plus-one**

**Allocator:** `src/local/documents.mjs:10-17` (`allocateNumber`), the single writer of
numbers in the native build.

- Counter row: `src/local/document-schema.mjs:2`
  (`document_sequences(company, kind, next_number, PRIMARY KEY(company, kind))`) — a
  dedicated counter row per company+kind inside the per-tenant file.
- Advance: `src/local/documents.mjs:14` —
  `UPDATE document_sequences SET next_number = next_number + 1 WHERE company=? AND kind=?
  RETURNING next_number - 1 AS n`. One atomic statement; the returned `n` is the old
  value, so allocation is "read-and-advance" in a single write, not a read-then-compute.
- Lock: every call site runs inside `transaction(db, …)`, which is **`BEGIN IMMEDIATE`**
  (`src/local/sqlite.mjs:7`) — SQLite's database-level reserved write lock is taken at
  transaction open, so concurrent writers cannot interleave a read of `next_number`.
  Call sites: `src/local/engine.mjs:24` (command accept), `src/local/documents.mjs:49`
  (draft save), `src/local/documents.mjs:81` (correction replacement),
  `src/local/inventory.mjs:23` (stock accept).
- Format only: `src/local/documents.mjs:15` (`kind + '-' + padStart(6,'0')`) — pure
  derivation from the counter value, no independent state.
- Number record: `src/local/documents.mjs:16` — the single `INSERT INTO document_numbers`
  in the repository (`grep` confirms one writer).
- Idempotent replay: `src/local/documents.mjs:11-12` returns the existing number when the
  document id is already numbered, instead of re-allocating.

**Verdict: it is NOT a `MAX`/rowid derivation at write time.** There is no `SELECT max(...)`
in any numbering path (`src/local/` `max(` occurrences are only `max(version)` on
`schema_migrations` at `sqlite.mjs:8,9` and `max(max_seen_at, …)` at `licence.mjs:13`).
`document_numbers.sequence` is written from the counter's returned value, never from the
table's own maximum, and the rowid-derived `INTEGER PRIMARY KEY` columns are on unrelated
tables (`src/local/schema.mjs:27,56,59` — audit/migration/commercial, listed as B10/B11).

**Therefore R3 is NOT reclassified.** The Principal's conditional does not trigger:
allocation at source is a counter-row advance under an exclusive write lock, so the
"in-file SAFE" half of R3 stands on its original justification. R3 remains
**HAZARDOUS** overall for the cross-copy reason only — absence of any numbering
reconciliation in `scripts/native-restore.mjs` (0 references to `next_number` /
`document_numbers`) — and B12 (`documents.mjs:13`, seed-at-1) remains the sole
regression vector inside the file.

### (2) STATED LIMITATION — an older restored file cannot know what it never saw

> **STATED LIMITATION — NOT A SOLVED CASE.**
>
> A restored older native store cannot detect document numbers issued **after that file
> was copied**, because that evidence is not in the file: the counter, the number rows and
> the audit trail all roll back together. Byte-exact restore plus `integrity_check`,
> `foreign_key_check`, journal balance and stock reconciliation
> (`scripts/native-restore.mjs:13-15`) prove the file is *internally* consistent — never
> that it is the newest state. `sqlite_sequence` does not exist (no `AUTOINCREMENT` in
> production; only `scripts/sqlite-bi-spike.mjs:5`), so there is no engine-side high-water
> to consult either.
>
> **The remedy requires an EXTERNAL record of the high-water mark** — a value held outside
> the file that can be compared on restore. Two carriers are identified, neither
> implemented:
>
> 1. **The licence/entitlement channel** — the natural carrier, because a signed,
>    periodically exchanged artefact already leaves the device and returns
>    (`src/local/licence.mjs:10,12` install; `:13` state; `sequence` monotonicity and
>    `max_seen_at` already exist as external-facing state). Embedding the highest issued
>    number (or a per-kind vector) in the renewal envelope would give a comparable
>    high-water after any restore.
>    **Caveat, to be recorded with the decision:** that artefact is vendor-visible, so it
>    **discloses business volume** (documents issued per kind per period) to the licensor.
>    That is a privacy/commercial disclosure the owner must accept explicitly; it cannot be
>    adopted as an incidental side effect of a numbering fix.
> 2. **An off-device audit copy** — an append-only, device-external record (off-site audit
>    sink or sealed export) that holds the last known high-water per `(company, kind)` and
>    is consulted at restore time. Avoids volume disclosure to the vendor but requires a
>    separate trusted destination and its own retention/consistency story.
>
> Until one of these exists, native restore must be treated as an **unverified rollback**
> and the operator must reconcile externally by hand. No code, schema or runbook step
> implements either carrier today; this is a stated limitation, **not** a mitigated or
> solved case.

### (3) LOGGED FUTURE ITEM — per-tenant logical export ("give me my data")

> **FUTURE ITEM (logged only — no action taken).**
>
> A per-tenant logical export will be the first client request of its kind and will need
> **the same numbering semantics as the PG logical-dump case (R2)**: the export must carry
> `document_sequences.next_number` together with `document_numbers` so a receiving system
> can verify `next_number - 1 = max(sequence)` and the duplicate-number census; an export
> that ships only the issued rows re-imports into a store whose counter is behind and will
> reissue (B-class hazard), and one that ships only the counter loses the audit chain.
> The R2 §10.3-style check is the required acceptance test for any such export/import pair.
> Scoped to a future contract; nothing is designed or implemented here.
