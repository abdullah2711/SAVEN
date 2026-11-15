CONTRACT: docs/contractor/contracts/PIVOT-011-backup-runbook.md
STATUS: DONE (drafting only — unsigned runbook, drill NOT PERFORMED, no production action)

Revision 2 (PIVOT-011-R1) is recorded at the end of this report. It applies the five findings of the engineering review at `aaf2c27` (`docs/contractor/reviews/PIVOT-011-backup-runbook.md`). The runbook remains unsigned and NOT PERFORMED.

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

Status after the R1 review: all five questions below were answered by the engineering review (`aaf2c27`). The answers are applied in §Revision 2; the questions are retained unchanged as the original delivery record.

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

## Revision 2 — PIVOT-011-R1 corrections

Contract: the `IF REVISE` block of `docs/contractor/reviews/PIVOT-011-backup-runbook.md` (engineer verdict at `aaf2c27`). Scope: documentation only, keys/policy/destination inputs still unresolved, no execution of any procedure.

The runbook was revised from 455 to 842 lines. Every original scope exclusion, `MISSING` input, `PROPOSED — NOT APPROVED` draft and `NOT PERFORMED` marker is preserved; none was promoted. The header now states revision, and a `BLOCKING GAP` marker was added so unsupplied controls cannot be read as coverage.

### Finding → section mapping (old → new)

| Finding | Old defect location | New location (runbook lines) | What changed |
| --- | --- | --- | --- |
| 1. PITR not activated; restore insufficiently isolated | §6 (old `restore_command`/`recovery_target_*` block, no signal; PGDATA-only path check; port treated as fence) | §6.4 (261–291), §6.6 (304–329), §6.7 (330–350), §6.8 (351–373), §6.9 (374–380) | `touch …/recovery.signal` added; `restore_command` contract now requires verified decrypted output at exactly `%p` (never stdout, never substitution), atomic write, non-zero exit on absence/mismatch. New isolated storage required for PGDATA, WAL and every tablespace with symlink/`tablespace_map` inspection and a path-overlap refusal. Pre-startup fence table forces `archive_mode=off`, `max_wal_senders=0`, `default_transaction_read_only=on`, drill-only `pg_hba`, replaced `postgresql.auto.conf`, no inherited slots, no source replication, no published WAL. Promotion is proven read-only by a positive write-control that must fail. |
| 2. Backup format and verification disagreed; checksum policy wrong | §5 (`--format=tar --gzip` + bare `pg_verifybackup`), §4 (`data_checksums = on` as a config line) | §5.1 (140–168), §5.2 (169–183), §5.4 (196–199), §4.3 (124–131) | One format everywhere: `--format=plain --wal-method=stream --manifest-checksums=SHA256`, `pg_verifybackup` before encryption and again after materialization, verification of the retrieved/decrypted copy in `scratch-verify/` before any recovery configuration or startup. Tar retained only as an explicitly weaker alternative needing `--no-parse-wal` and separate WAL verification. `data_checksums` removed from `postgresql.conf`; replaced with `initdb --data-checksums` policy, `SHOW data_checksums;` observation and a separate authorized offline `pg_checksums` procedure. |
| 3. Archive wrapper violated its own publication contract | §4.2 (shell skeleton PUT direct to final name; local rename as atomicity; ciphertext digest comparison) | §4.2 (101–123) | Skeleton removed and replaced by a requirement table: system-id + timeline namespace, unique remote staging object, durable read-back verification, atomic **no-replace** publication, retry success only on verified identical **decrypted content**, mismatch/partial/failed outcomes non-zero with no overwrite and no delete, secrets from root-owned files, structured observability, and later test hooks. Explicitly labelled `BLOCKING GAP`: no executable is added. |
| 4. Baseline and recovery boundary described different states | §6 Steps 0–1 (snapshot taken before fencing; LSN from "last archived"; control functions assumed available) | §6.1 (204–209), §6.2 (210–242), §6.3 (243–260), §5.1 note (167) | Fence first, then capture: stop named app plus named jobs, verify no sessions/prepared transactions/subscribers, then one `REPEATABLE READ READ ONLY` snapshot kept under the fence, with system identifier, timeline and LSN recorded by the separately provisioned administrative principal. Recovery target is the LSN captured after `pg_switch_wal()` with the **exact segment** computed via `pg_walfile_name()` and proven present off-site. Separate-role requirement for control/checkpoint functions is explicit, the replication principal must be an actual LOGIN with `REPLICATION`, and unfenced observations are advisory only. |
| 5. Proposed success checks could falsely pass | §7, §10 (owner counts grouped only over existing rows; audit hash missing actor/detail/command bytes and `audit_event`; counts alone for commands/reviews; one-directional stock/trade checks; RLS snippet without user/role/positive control) | §7 (381–398), §10.1 (446–492), §10.2 (493–523), §10.3 (524–545), §10.4 (546–686), §10.5 (687–769) | Ownership checks anchored to the expected activated-business set in both directions with exactly one **active** owner; admission cross-check gated to post-PIVOT-004 with `user_uuid`; length-prefixed complete-row canonical digests for `audit`, `audit_event`, `command_inbox`, `command_decisions`, `approval_requests`, `journal_drafts`, `document_revisions` and `document_registry`; journal/line, stock/movement and trade document/line/allocation checks in both directions; numbering high-water plus missing/duplicate checks; explicit blocking-gap table for evidence-manifest, asset/tax, GL-to-subledger, append-only and kernel controls; RLS check requires the actual runtime role, verified context, a positive own-tenant control, denied foreign access and missing-context denial, and is "not applicable" before PIVOT-004. |

### Other corrections applied

- Schema references updated to the accepted R1 corrections `migrations/006-auth-schema-corrections.sql` and `migrations/021-tenant-schema-corrections.sql`, explicitly "accepted on their branches, not integrated or deployed"; §10.5 checks the `021` owned-stock invariant (`quantity > 0 OR value = 0`).
- Engineering acceptance of this draft is distinguished from owner acceptance and from a performed drill (header item 7 and §12).
- Monitoring/exporters/schedulers remain `BLOCKING GAP`, consistent with the review's decision that PIVOT-012 records the gap rather than installing services.
- Failure matrix extended for publish conflict, verify mismatch, missing recovery signal, path/tablespace escape, restore-side archive publication, unfenced baseline and read-only-fence breaches.
- Verification tests extended to V1–V15, adding recovery-signal, archive retry/conflict/partial-upload, tablespace escape, read-only promotion, snapshot-order and repeatability cases. All remain `[NOT PERFORMED]`.

### GATE EVIDENCE (R1)

Contract `DONE WHEN` command, run with both TOUCH files modified in this worktree:

```text
$ git diff --check -- docs/pivot-notes/06-backup-restore-runbook.md docs/contractor/deliveries/PIVOT-011-backup-runbook.md
(no output)
EXIT=0
```

Supporting evidence:

```text
$ git diff --check testing-1..HEAD
(no output)

$ grep -c '^```' docs/pivot-notes/06-backup-restore-runbook.md
54            # balanced fenced code blocks (27 pairs)

$ grep -n "postgres://\|postgresql://\|BEGIN .*PRIVATE KEY\|AKIA\|ghp_" docs/pivot-notes/06-backup-restore-runbook.md
(no output)

$ grep -c "NOT PERFORMED" docs/pivot-notes/06-backup-restore-runbook.md
23

$ grep -n "Drill performed\|Owner signature" docs/pivot-notes/06-backup-restore-runbook.md
793:Drill performed:        [ ] NOT PERFORMED
804:Owner signature:        ______________________________________________
```

No test suite, build, generator, database, backup, restore or drill was executed: the contract gate is a documentation check and no source, schema, workflow or generated artefact changed.

### DEVIATIONS (R1)

1. The delivery report is a second modified path because the revised contract lists it in TOUCH; the prior report body is preserved and the revision is appended rather than rewritten.
2. `[BLOCKING GAP]` was added as a marker beyond the original legend, to satisfy the review's requirement that unsupported checks be recorded as blocking gaps with future owners rather than implied coverage.
3. Interfaces (archive wrapper, WAL restorer, scheduler/exporter) are specified, not implemented, per the review decision that their executables require a separate contract.
4. Two illustrative shell snippets (path-overlap refusal and restored-path inspection) are included as reviewable templates; they are unexecuted and are not runnable tooling.
5. The "owner acceptance" table gained identity fields (system id, target LSN, segments, base label, restore paths) that the review's five-item drill identity requires; the signature lines remain blank.

### EXTENSIBILITY (R1)

compliant: no new hardcoded domains or role lists; no executable code, schema, migration or module-coupling change; unresolved provider/policy/commercial inputs remain explicit extension points (`MISSING`) rather than defaults; the only normative additions are recovery-safety requirements derived from cited PostgreSQL 18 behaviour, change-controlled in §14 and reversible by a dated revision plus owner re-drill.

### GIT (R1)

branch=opencode/pivot-011-backup-runbook base=testing-1 @ 6c8bc25 commits=223d588 (runbook draft), 95824ef (first delivery report), plus the R1 revision commits recorded in the delivery message pushed=yes merged=no
