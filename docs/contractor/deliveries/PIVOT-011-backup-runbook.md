CONTRACT: docs/contractor/contracts/PIVOT-011-backup-runbook.md
STATUS: DONE (drafting only — unsigned runbook, drill NOT PERFORMED, no production action)

Revision 2 (PIVOT-011-R1) and Revision 3 (PIVOT-011-R2) are recorded at the end of this report. It applies the five findings of the engineering review at `aaf2c27` (`docs/contractor/reviews/PIVOT-011-backup-runbook.md`). The runbook remains unsigned and NOT PERFORMED.

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

Status after the R1 review: all five questions below were answered by the engineering review (`aaf2c27`). R1's remaining defects were then corrected under PIVOT-011-R2 (`a253807`), recorded in Revision 3. The answers are applied in §Revision 2; the questions are retained unchanged as the original delivery record.

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

## Revision 3 — PIVOT-011-R2 corrections

Contract: the `IF REVISE` block of `docs/contractor/reviews/PIVOT-011-R1-backup-runbook.md` (engineer verdict at `a253807`). Documentation only: no backup, restore, drill, schema, tool or service was created or run. The runbook remains **DRAFT — UNSIGNED — NOT PERFORMED** and the owner signature block stays blank.

### Finding → section mapping

| Finding | Old state | New state |
| --- | --- | --- |
| 1. Admission reconciliation referenced a nonexistent column (§10.1) | `tm.user_uuid = m.user_uuid` against `auth.tenant_membership`, plus an "owners outside the expected set" query that failed suspended/provisioning tenants for retaining an owner | §10.1 rewritten: the canonical UUID is `auth.tenant_membership.user_id` and the projection is `tenant_data.members.user_uuid`, bound by PIVOT-004's composite keys. 10.1a checks activated tenants for exactly one protected role and one **active** owner (member active, `auth.users.status = 'active'`, membership `active` with no `suspended_at`/`revoked_at`). 10.1b flags only orphan ownership (no tenant record). 10.1c lists retained owners on non-activated tenants as an informational review, not a failure. 10.1d is the projection-direction admission check. The RLS example now keeps its own verified context, adds a positive own-tenant control, queries a known foreign tenant the principal is **not** admitted to under that unchanged context, and states that a multi-tenant user's authorized switch is not a leak. |
| 2. Persisted state could change without changing the claimed "complete" hashes (§10.4) | `string_agg` digests that omitted `lease_token`, `lease_until`, `error`, `updated_at/updated_by`; outbox compared by state counts; registry/approval/decision/revision hashes omitted metadata and provenance | §10.4 rewritten as complete persisted-state reconciliation: one canonical text per row via `to_jsonb(t)::text` (every column, explicit JSON `null`, UTC pinned), per-row `sha256` over ordered rows, streamed through `psql \| sha256sum` as the required bounded method, with a whole-table `string_agg` explicitly demoted to a small-dataset convenience that cannot be called a production verifier. A coverage matrix lists every authoritative table with its ordering key — including outbox `id/event/state/attempts`, command lease/error state, review payloads and provenance — plus keyed counts anchored to the expected activated-tenant set so a missing tenant cannot disappear. The three audit streams (`audit`, `audit_event`, `auth.auth_audit`) are compared separately with no merge or back-fill. Canonicalisation edge rows and the missing streaming wrapper are recorded as blocking gaps. |
| 3. Target was not a demonstrated, reachable, transaction-aligned recovery point (§6.3/§6.6) | `pg_switch_wal()` + `pg_current_wal_lsn()` treated as the target, `recovery_target_lsn`, "base manifest WAL range covers" confusion, default latest timeline, commit-boundary inferred from an absence of sessions | §6.3 now creates a unique named restore point with `pg_create_restore_point()` **after** the fence and **after** the chosen base backup completes, records its name/LSN and pinned timeline, forces the containing segment to archive and proves a contiguous chain from the base's stop location through that segment for that timeline (no gap, no foreign-timeline substitute, no `last_archived_wal` shortcut). §6.6 uses exactly one target kind — `recovery_target_name` together with an explicit `recovery_target_timeline` (never `latest`) and `recovery_target_inclusive = off` — and §6.8 verifies promotion at the named point on the pinned timeline. Targets older than the base backup, timeline mismatches and unreachable points are explicit failure cases (§11), never forced forward. |

Supporting updates: §7 acceptance criteria now require the named/pinned target, contiguous chain and complete-row comparison; §8 adds V2a (target before base), V2b (timeline mismatch), V3a (outbox-swap and lease-mutation detection) and V3b (canonicalisation stability); §11 adds restore-point, timeline and count-equal/digest-divergent failure handling; §12 gained restore-point name/LSN, pinned timeline and base start/stop fields; §15 cites the PostgreSQL 18 restore-point and recovery-target documentation.

### GATE EVIDENCE (R2)

Contract `DONE WHEN` (documentation-only gate), run with both TOUCH files modified:

```text
$ git diff --check -- docs/pivot-notes/06-backup-restore-runbook.md docs/contractor/deliveries/PIVOT-011-backup-runbook.md
(no output)
EXIT=0
```

Supporting evidence:

```text
$ grep -n "tm.user_uuid" docs/pivot-notes/06-backup-restore-runbook.md
(no output; exit 1)        # the nonexistent column is gone

$ grep -c '^```' docs/pivot-notes/06-backup-restore-runbook.md
58                         # balanced fenced code blocks (29 pairs)

$ wc -l docs/pivot-notes/06-backup-restore-runbook.md
936

$ grep -c "NOT PERFORMED" docs/pivot-notes/06-backup-restore-runbook.md
29

$ grep -n "postgres://\|postgresql://\|BEGIN .*PRIVATE KEY" docs/pivot-notes/06-backup-restore-runbook.md
(no output; exit 1)
```

No database, backup, restore, drill, credential or infrastructure action was performed; the only execution gate for this task is the whitespace/conflict check above.

### QUESTIONS FOR ENGINEER (R2)

1. The canonical row digest uses `to_jsonb(t)::text` with `TimeZone = 'UTC'`. Should the drill mandate `DateStyle = ISO, MDY` explicitly as well (it is PostgreSQL's default and recorded in the procedure), or is pinning the time zone sufficient for the accepted canonical form?
2. The streaming comparison is specified as `psql -At … | sha256sum` because no checked-in comparator exists. Should a later contract provide a small comparator that enforces the coverage matrix and fails closed on a missing table, or is the recorded manual pipeline acceptable for drill evidence?
3. §10.4 includes the Cloud-profile `operator.*` control tables and states that Fully Private uses local equivalents. Confirm the accepted Private mapping rather than assuming these tables exist there.
4. `recovery_target_inclusive = off` was chosen to stop exactly at the restore point. Confirm that is the intended semantic (the alternative stops at the first commit after the point).

### DEVIATIONS (R2)

1. Documentation-only, as contracted: no executable, tool, service, schema or generated artefact changed; the two TOUCH files are the entire diff.
2. The previous "complete-row" SQL examples were replaced rather than patched, because keeping a subset labelled complete would repeat the defect; the new section states the streaming method and records canonicalisation/tooling gaps as blocking.
3. The runbook now references PostgreSQL 18 `pg_create_restore_point()`/`recovery_target_name`/`recovery_target_timeline` semantics and cites the official pages; no version claim beyond the pinned PostgreSQL 18 target is made.
4. The owner signature block gained three fields (restore point name, LSN, pinned timeline) required by the corrected drill identity; it remains blank and NOT PERFORMED.

### EXTENSIBILITY (R2)

compliant: no hardcoded domain lists, no module coupling, no executable change; unresolved destination/RPO/RTO/key/monitoring decisions remain explicit extension points and blocking gaps; the correction is reversible by a dated documentation revision and does not alter any schema or accepted bytes.

### GIT (R2)

branch=opencode/pivot-011-backup-runbook base=testing-1 @ 6c8bc25 previous=f125977 (reviewed) commits=recorded in the delivery message pushed=yes merged=no
