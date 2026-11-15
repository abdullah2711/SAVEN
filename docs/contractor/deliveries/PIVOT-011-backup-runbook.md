CONTRACT: docs/contractor/contracts/PIVOT-011-backup-runbook.md
STATUS: DONE (drafting only — unsigned runbook, drill NOT PERFORMED, no production action)

## What was delivered

`docs/pivot-notes/06-backup-restore-runbook.md` — a 455-line draft operating procedure for PostgreSQL base backup, continuous WAL archiving, off-server encrypted retention, isolated point-in-time restore, reconciliation and owner acceptance. Nothing was executed: no backup, archive, restore, cluster start, credential use or drill.

Content map (all inside the single TOUCH file):

1. Status banner `DRAFT — UNSIGNED — DRILL NOT PERFORMED`, marker legend (`OBSERVED`, `PROPOSED — NOT APPROVED`, `MISSING`, `NOT PERFORMED`) and six hard boundaries (SQLite remains production, loopback only, no second writable copy, no overwriting accepted transactions, no secrets, no `BYPASSRLS`/superuser).
2. Scope: the `operator`/`auth`/`tenant_data` target only; explicitly excludes the retained schema-13 reference cluster, native SQLite stores, Fully Private packaging, and data migration/cutover.
3. Blocking inputs table: off-host destination, independent off-site base copies, RPO, RTO, retention, encryption tooling and key custody, capacity, the named test-app unit, restore target details and maintenance window are all `MISSING`; cluster/path/port/backup-role names are `PROPOSED — NOT APPROVED`.
4. Server configuration templates: `wal_level = replica`, `archive_mode = on`, `archive_command` template plus wrapper template (atomic temp-then-rename, non-zero exit on failure, idempotent, key read from a root-owned file, never argv or the repo, off-site digest verification), `archive_timeout`, `data_checksums`, `pg_hba`/`listen_addresses` restrictions.
5. Base backup procedure: `pg_basebackup --format=tar --gzip --wal-method=stream --checkpoint=fast --label=…`, `pg_verifybackup`, hashing manifest, encrypt, ship, verify remote digest, retention only after the off-site copy is verified.
6. Restore/PITR procedure in eight gated steps: pre-drill snapshot with source LSN, fence writers via `pg_stat_activity`, `pg_switch_wal()`, isolated non-existent target with path equality refusal, retrieve from off-site and verify then decrypt, `restore_command`/`recovery_target_lsn`/`recovery_target_action = 'promote'` with no "closest available" fallback, `pg_is_in_recovery()`/timeline checks, reconciliation, measured elapsed time, fence-and-retire.
7. "Recovery succeeded" definition: GL balance and trial balance, numbering high-water, audit count/hash, idempotency/approval/outbox/pending state, subledger controls, sole-owner authority, RLS isolation (declared not applicable before PIVOT-004), measured elapsed time and recorded artifacts.
8. Required verification tests V1–V10 (base restore, PITR to a mid-workload LSN, WAL-gap detection, archive-failure behaviour, key-loss behaviour, capacity/retention, off-site independence, encryption at rest in transit, concurrent-writer refusal, repeatability) — every one marked `NOT PERFORMED`.
9. Page-out conditions for archiver failure, WAL backlog, capacity, stale or unverifiable base backups and skipped restore verification; the monitoring itself is recorded as `MISSING`.
10. Read-only reconciliation SQL against the accepted schema (`journal_lines` balance, trial balance, `document_numbers` vs `document_sequences`, duplicate numbers, command/approval/registry/outbox census, audit count plus per-tenant digest, correction uniqueness, trade totals vs lines, stock balances vs movements, protected owner role/assignment, migration provenance), plus the RLS negative check for post-PIVOT-004 use.
11. Failure/decision matrix (archive outage, missing WAL segment, key loss, verification mismatch, overrun, writer detected, exposure, destructive retention) with the decision owner named.
12. Blank owner acceptance block: `Drill performed: [ ] NOT PERFORMED`, recovery point, digests, elapsed time, anomalies, owner name/date/signature, accept/reject/repeat — explicitly not fillable by anyone but the owner.
13. Explicit non-claims, change control (owner re-drill required for destination/key/retention changes) and references (ADR01, pivot spec Phase 6, docs49, 02-three-purposes, docs44/runtime contract, `db/postgres/*.sql`, native backup/restore scripts and units, PostgreSQL 18 documentation).

## FILES CHANGED

- `docs/pivot-notes/06-backup-restore-runbook.md`: new unsigned draft runbook (455 lines). No other path modified.
- `docs/contractor/deliveries/PIVOT-011-backup-runbook.md`: this delivery report (report artefact required by the contractor role, outside the contract's TOUCH list but not a product path).

## GATE EVIDENCE

Contract `DONE WHEN` command. The file is new, so intent-to-add was registered first (`git add -N`) to make the whitespace/conflict check meaningful rather than vacuous:

```text
$ git add -N docs/pivot-notes/06-backup-restore-runbook.md
$ git diff --check -- docs/pivot-notes/06-backup-restore-runbook.md
(no output)
EXIT=0
```

Same check over the whole committed range and confirmation that no CRLF or conflict markers were introduced:

```text
$ git diff --check testing-1..HEAD
(no output)
range_diff_check_exit=0

$ file docs/pivot-notes/06-backup-restore-runbook.md
docs/pivot-notes/06-backup-restore-runbook.md: Unicode text, UTF-8 text, with very long lines (370)
$ grep -c $'\r' docs/pivot-notes/06-backup-restore-runbook.md
0
crlf_count_exit=1   # grep found no carriage returns
```

No-secret scan and non-claim scan:

```text
$ grep -n "postgres://\|postgresql://\|BEGIN .*PRIVATE KEY\|AKIA\|ghp_" docs/pivot-notes/06-backup-restore-runbook.md
(no output)
secrets_grep_exit=1

$ grep -c "NOT PERFORMED" docs/pivot-notes/06-backup-restore-runbook.md
17

$ grep -n "Owner signature\|Drill performed" docs/pivot-notes/06-backup-restore-runbook.md
417:Drill performed:        [ ] NOT PERFORMED
425:Owner signature:        ______________________________________________
```

No test suite, build, generator or live-database command was run: the contract's gate is a documentation check, the change is documentation-only, and no source, schema, workflow or generated artefact is touched.

## QUESTIONS FOR ENGINEER

1. Off-host destination, RPO/RTO, retention, capacity and encryption tool/key custody are `MISSING` in the runbook. Should a follow-up contract name those decisions (owner input required), or stay out of scope until the owner supplies them in the drill record?
2. The archive/restore wrapper (`<SAVEN_WAL_ARCHIVER>`, `restore_command` restorer) is intentionally not authored here — it is executable code outside PIVOT-011's TOUCH. Should a separate contract own those wrappers plus their tests (fail-closed, atomic rename, idempotent re-archive)?
3. Confirm the verification tooling preference: `pg_basebackup --manifest-checksums=sha256` + `pg_verifybackup`, and whether `--format=tar --gzip` (single-archive restore) or `--format=plain` (easier per-file hashing) is preferred for the accepted procedure.
4. Should the retained schema-13 testing reference cluster (`8788`) be explicitly named as out of scope in a later revision of that cluster's own runbook, or is the exclusion in §1 sufficient?
5. Monitoring/exporter/timer for archive and backup health does not exist in this repository (only the native SQLite units). Confirm PIVOT-012 should record that gap as a remaining release gate rather than this contract inventing a service.

## DEVIATIONS FROM CONTRACT

1. One extra file: the delivery report at `docs/contractor/deliveries/PIVOT-011-backup-runbook.md`, required by the contractor role and not a product path. No other path was created or modified.
2. Marker discipline: where the contract and spec ask for values that do not exist (destination, RPO/RTO, retention, capacity, keys, unit names), those are written as `[MISSING]` rather than invented; elsewhere the runbook proposes drafts marked `[PROPOSED — NOT APPROVED]`. No approval language is used anywhere.
3. The `archive_command` and `restore_command` appear as templates with placeholders and a wrapper skeleton, because the contract requires templates but forbids new executables under this TOUCH list. The wrapper is explicitly labelled as not part of this contract.
4. No drill was performed, no cluster was started, no credential or off-host destination was contacted, and the owner block is blank. Elapsed time is described as a measurement to be taken, never estimated.
5. The reconciliation SQL is written against the accepted `db/postgres` schema and is unexecuted. It is marked as a reconciliation baseline, not as evidence, and it states that RLS-based isolation checks are not applicable until PIVOT-004.

## EXTENSIBILITY

compliant:

- No new hardcoded domains, type lists, roles or jurisdictions; the document references existing schema objects and reference-domain conventions instead of restating enums.
- No coupling across module boundaries and no runtime/source change: documentation only, no imports, no executable scripts, no schema or migration edits, no applied-migration bytes touched.
- No new one-way decisions: every proposed default (cluster name, paths, port, schedule, retention) is labelled `PROPOSED — NOT APPROVED` with change control in §14, and the required decisions remain open (`MISSING`) rather than silently locked in.
- Preserves reversibility: the procedure refuses to overwrite accepted transactions, keeps restores fenced and isolated, and explicitly states that SQLite remains production and that PostgreSQL parity/RLS/immutability/kernel gates are separate.

## GIT

branch=opencode/pivot-011-backup-runbook base=testing-1 @ 6c8bc25 commits=223d588 (runbook draft) + this report commit pushed=yes (recorded in the delivery message) merged=no
