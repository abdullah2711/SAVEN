# PostgreSQL backup, WAL archive and restore recovery runbook

Status: **DRAFT — UNSIGNED — DRILL NOT PERFORMED**

Revision 2 (PIVOT-011-R1), 15 November 2026 (Asia/Karachi). Corrects the five engineering findings in the PIVOT-011 review (`VERDICT: REVISE`): PITR activation and restore isolation, backup-format/verification consistency and checksum policy, archive publication and idempotency, fenced snapshot ordering and recovery-target selection, and reconciliation checks that could falsely pass.

This document is a proposed operating procedure for the `db/postgres` target. It is not evidence that any backup, archive, restore or drill has happened. No procedure below has been executed. Read the marker legend before treating any statement as approved.

| Marker | Meaning |
| --- | --- |
| **[OBSERVED]** | Checked directly in this repository at the stated commit. Not a live-server check. |
| **[PROPOSED — NOT APPROVED]** | A recommended value, path, schedule, tool interface or verification method. A draft for owner review, not an authorization. |
| **[MISSING]** | Unknown and required before operational use. Must be supplied or measured; never invented, guessed or back-filled. |
| **[NOT PERFORMED]** | A required test, drill or measurement that has not happened. Never convert this marker into a pass without independent evidence and the owner's signature. |
| **[BLOCKING GAP]** | A control that this draft cannot supply and that a later contract must implement. Recorded so the gap cannot be mistaken for coverage. |

Hard boundaries that this runbook may not relax:

1. SQLite remains the production database until the owner satisfies the retirement gate in `docs/pivot-notes/01-adr-postgresql-pivot.md`. Nothing here authorizes cutover, data migration or a production restore.
2. PostgreSQL binds to loopback only. No inbound port is opened for it; Cloudflare Tunnel carries only the application's HTTP/S endpoint. **[OBSERVED]** policy.
3. A restored snapshot is never a second writable live copy. Restores go to new, isolated storage, stay fenced, and never become writable business systems without a separate reconciled recovery decision. **[OBSERVED]** in ADR01 and `docs/49-compatible-tenant-upgrades.md`.
4. Accepted live transactions are never overwritten by a restore. Prefer forward repair after new-format writes.
5. No credential, connection string, encryption key or client data is committed, pasted into a ticket or stored in this file.
6. No role receives `BYPASSRLS` or superuser for backup/restore convenience. Administrative principals used for checkpoint/switch control are separately provisioned and are not granted to runtime or reconciliation roles.
7. Engineering acceptance of this draft is not owner acceptance. Only the owner may sign a performed drill (§12).

## 1. Scope

Covered: the proposed shared PostgreSQL target described by `db/postgres/00-roles.sql`, `05-auth-schema.sql` (AUTH-001), `10-operator-schema.sql`, `20-tenant-schema.sql` (PIVOT-003) and the accepted additive corrections `migrations/006-auth-schema-corrections.sql` (AUTH-001-R1) and `migrations/021-tenant-schema-corrections.sql` (PIVOT-003-R1). Those corrections are accepted on their own branches and are **not** claimed here as integrated or deployed. **[OBSERVED]**

Not covered:

- The retained schema-13 PostgreSQL reference installation on loopback `8788` used by `saventesting` **[OBSERVED in docs/44]**. Its retained runbook, services and data are not edited or replaced by this document.
- Native SQLite stores and tenant files (`scripts/native-backup.mjs`, `scripts/native-restore.mjs`, `deployment/saven-native-backup.service`, `deployment/saven-testing-backup.service`) **[OBSERVED]**. Their stopped-application verified-backup procedure continues unchanged.
- Fully Private packaging, which needs its own frozen copy with local key custody, no vendor dependency and its **own reviewed manifest/local-authority mapping**. This Cloud runbook does not approve an invented Private equivalent for any `operator.*` table; until that mapping is reviewed and accepted, Private recovery coverage is a **[BLOCKING GAP]** owned by the Private packaging contract.
- Production data migration and cutover, which require separate contracts and explicit owner authorization.

## 2. Required inputs before this runbook may be operated

None of the following is approved today. Each is a blocking input.

| Input | Status | Notes |
| --- | --- | --- |
| Off-server archive destination (host/storage class, region, transport) | **[MISSING]** | Must be off the database server. A second directory, disk, host-adjacent volume or the same cloud project is not an independent copy. No destination is named here because none is approved. |
| Independent off-server copy of base backups | **[MISSING]** | Base backups must leave the server and be verified at the destination. |
| Recovery point objective (RPO) | **[MISSING]** | Determines archive cadence, `archive_timeout` and tolerated WAL loss; not measurable before a drill. |
| Recovery time objective (RTO) | **[MISSING]** | Must be measured in a drill. No availability SLA is claimed anywhere in this repository. |
| Retention policy (base, WAL, off-site, accounting/legal) | **[MISSING]** | Accounting-record retention for this target is not established. |
| Encryption tooling and key custody/escrow/rotation | **[MISSING]** | Tool, key holder, escrow, rotation and break-glass are undecided. Key loss means total loss of the backup. |
| Archive/restore wrapper implementation | **[BLOCKING GAP]** | §4 and §6 define interfaces only. No script, service or provider code exists under this contract. |
| Backup/restore/monitoring automation (scheduler, exporter, alert route) | **[BLOCKING GAP]** | Only native SQLite units exist today **[OBSERVED]**. |
| Capacity and growth assumptions | **[MISSING]** | Needs measured base size, daily WAL volume and tenant growth; a preflight condition, not an incident discovery. |
| Named test application unit(s) that may be stopped | **[MISSING]** | Only the named test application may be stopped. `app.economicsystems.cc` native production must never be stopped for a PostgreSQL drill. |
| Named recurring jobs/workers to quiesce (outbox, AI, scanners, schedulers) | **[MISSING]** | Fencing must cover every writer, not just HTTP request handlers. |
| Administrative principal for control functions (`pg_switch_wal`, `pg_control_*`) | **[MISSING]** | Separately provisioned; not the reconciliation role and not granted to runtime principals. |
| Dedicated replication/backup LOGIN principal | **[MISSING]** | Must be an actual provisioned login with `REPLICATION`; not a shared administrator and not a role membership shortcut. |
| Restore host, storage root, port, operator identity | **[PROPOSED — NOT APPROVED]** | Placeholders below; loopback-only, disposable, entirely new storage. |
| Maintenance window and notification | **[MISSING]** | Any drill that stops the test app needs an owner-approved window. |
| Owner drill date, elapsed time, signature | **[MISSING]** | Blank by design (§12). |

## 3. Target cluster facts and naming proposals

| Item | Value |
| --- | --- |
| Engine | PostgreSQL 18 is the schema target version used by the accepted contracts and CI service. Verify every command against the pinned server version before use. **[OBSERVED]** |
| Schemas | `operator` (Purpose A), `auth` (shared identity, AUTH-001), `tenant_data` (Purpose B/C, PIVOT-003). |
| Additive corrections | `migrations/006-auth-schema-corrections.sql`, `migrations/021-tenant-schema-corrections.sql` — accepted on their branches, not integrated or deployed. `021` adds `CHECK (quantity > 0 OR value = 0)` on `tenant_data.stock_balances`, sets `tax_profile.tax_type` default to the seeded `SALES_TAX` and annotates the posting-constraint severity domain. **[OBSERVED]** |
| Connection surface | Loopback `127.0.0.1` and/or local Unix socket only, on a port recorded in the drill record. No public listener. |
| Roles | `saven_migrator` owns DDL; runtime roles `saven_customer_app`, `saven_auth_service`, `saven_operator_read`, `saven_operator_admin`; non-login definer owners `saven_operator_definer`, `saven_auth_definer`; all `NOLOGIN`, no superuser, no `BYPASSRLS`. **[OBSERVED in 00-roles.sql]** |
| Migration ledgers | `operator.pg_schema_migrations` (PostgreSQL migrations) and `operator.source_store_migrations` / `tenant_data.source_store_migrations` (imported native provenance). **[OBSERVED]** |
| Data checksums | `initdb --data-checksums` decision; observed with `SHOW data_checksums;`. Not a `postgresql.conf` parameter (§4.3). **[OBSERVED]** |
| Proposed cluster name | `saven-pg` **[PROPOSED — NOT APPROVED]** |
| Proposed source data directory | `/var/lib/postgresql/18/saven-pg` **[PROPOSED — NOT APPROVED]** |
| Proposed local archive staging | `/var/backups/saven-pg/wal-staging` **[PROPOSED — NOT APPROVED]** — staging only, never the retention location |
| Proposed base staging | `/var/backups/saven-pg/base` **[PROPOSED — NOT APPROVED]** — staging only |
| Proposed restore root | `/var/lib/postgresql/18/restore/<UTC-timestamp>` **[PROPOSED — NOT APPROVED]** |
| Restore root contents | `pgdata/` (with `pg_wal` inside it by default), `tablespaces/<oid>/` when the source has tablespaces, `scratch-verify/`, `logs/` — all newly created and all under the restore root. A separate WAL location is allowed only as an explicit mapping that resolves inside the restore root. **[PROPOSED — NOT APPROVED]** |
| Proposed restore port | Dedicated loopback port, distinct from the source cluster **[PROPOSED — NOT APPROVED]** |
| System identity | Recorded per drill from the source cluster (`pg_control_system()`); used to namespace archive objects so a different cluster can never publish into another cluster's archive. |

The backup path must never be inside the data directory. The restore root must never equal the source data directory, its WAL directory or any source tablespace directory; the procedure refuses rather than "fixes" those conditions.

## 4. Required server configuration

Templates only. Values marked proposed are drafts. Applied by the owner's server administration, not by this repository.

### 4.1 Archive and durability block

```conf
# postgresql.conf — backup/archive block (template; no secrets, no real DSNs)
wal_level = replica                  # required for WAL archiving and PITR
archive_mode = on                    # required [OBSERVED invariant]
archive_command = '<SAVEN_WAL_ARCHIVER> %p %f'   # interface §4.2; placeholders only
archive_timeout = 300                # [PROPOSED] bounds WAL switch latency; review against RPO
wal_compression = on                 # [PROPOSED] reduces archive bytes
full_page_writes = on                # default; do not disable
max_wal_senders = 3                  # [PROPOSED] streaming base backups + headroom
wal_keep_size = 0                    # archiving is the recovery source, not retained WAL
```

### 4.2 Archive command: required interface (no implementation here)

The wrapper is **not** part of this contract and must not be added as an executable under PIVOT-011 or PIVOT-011-R1. `[BLOCKING GAP]` A later explicit executable contract owns it, its failure tests and its deployment. What this runbook fixes is the contract the wrapper must satisfy.

Invocation: `<SAVEN_WAL_ARCHIVER> %p %f`, where `%p` is the absolute path of the WAL segment in `pg_wal` and `%f` the segment file name.

| Requirement | Specification |
| --- | --- |
| Namespace | `<OFFHOST-WAL-PREFIX>/<system_identifier>/<timeline_hex>/<segment>.enc` **[PROPOSED — NOT APPROVED]** |
| System/timeline qualification | Read the system identifier from the cluster (or a pinned provisioned value), never guess it; timeline must be the segment's timeline taken from `%f`. Prevents cross-cluster and cross-timeline collision. |
| Encryption | Encrypt before the object leaves local protected storage. Randomized encryption is expected, so **ciphertext digests cannot be used for equality**. |
| Local staging | Local temp-then-rename is required for local atomicity, but local rename is **not** remote publication and is never the only guarantee. |
| Remote staging | Upload to a unique, non-final remote object name (for example an `.incoming/<segment>.<nonce>` object) so a partial or failed transfer can never occupy the final name. |
| Durable verification | Read the staged remote object back (or an authoritative destination digest/etag) and verify it matches the uploaded bytes **before** publishing. |
| Atomic no-replace publication | Publish to the final name with a conditional create/rename that fails if the object already exists. Never overwrite an archived object. |
| Retry (idempotency) | If the final object already exists: fetch and decrypt it, compare **decrypted content** (or a documented content digest over plaintext bytes) with the current `%p` segment. Identical source content → exit 0 (durable success). Different content → refuse, exit non-zero, alert; do not replace and do not delete. |
| Exit status | 0 only after verified publication or verified-identical retry. Any other outcome exits non-zero with the segment left in `pg_wal` so PostgreSQL retries. |
| Secrets | Key and destination credentials come from root-owned files readable only by the archive principal. Never from the repository, argv, logs or a web process environment. |
| Observability | Emit one structured record per invocation: segment, system id, timeline, destination object, digest(s), stage, outcome. Never log key material or full paths that reveal credentials. |
| Test hooks (later contract) | Simulate: existing identical object, existing different object, failed upload, partial upload, verify mismatch, destination unavailable. Each must produce the specified exit status and no overwrite. **[NOT PERFORMED]** |

Failure of any requirement is a page-out condition (§9), because `archive_mode = on` with a failing archive silently retains WAL in `pg_wal`.

### 4.3 Data checksums policy

`data_checksums` is fixed at cluster creation and is **not** a settable `postgresql.conf` parameter. The earlier draft listing it as a configuration line was wrong.

- Create the cluster with `initdb --data-checksums` (or `-k`) as part of the owner's provisioning decision. **[PROPOSED — NOT APPROVED]**
- Observe the actual value: `SHOW data_checksums;` — record it in the drill record.
- Changing checksums on an existing cluster is an offline operation (`pg_checksums --enable|--disable`) on a cleanly stopped cluster, with a verified backup taken immediately before, and is a separate authorized maintenance procedure. It is never part of a drill and is not authorized here.

### 4.4 Connection surface

Keep `listen_addresses = 'localhost'`, keep `pg_hba.conf` restricted to local socket peer authentication for administrative principals and loopback for the dedicated backup/restore principal, and document each line. Never add `0.0.0.0`, a trust rule for a remote subnet, or a superuser login for backup tooling. The restore cluster gets its own `pg_hba.conf` (§6.7); a restored copy inherits the source's rules and must be replaced before startup.

## 5. Base backup procedure

One format is used everywhere in this runbook: **plain-format base backup with streamed WAL, SHA256 manifests, full `pg_verifybackup` verification, then encrypt and package for off-host retention.** Tar format appears only in §5.4 as a limited alternative.

### 5.1 Take the backup

```sh
# Template. Run as the dedicated backup/replication login, on the database server, loopback only.
# Placeholders come from the operation record; never inline a password.
export PGHOST=127.0.0.1
export PGPORT=<LOOPBACK-PORT>
export PGUSER=<BACKUP-REPLICATION-LOGIN>
export PGPASSFILE=<ROOT-OWNED-PASSFILE>     # mode 0600; never committed, never in argv
label="base-$(date -u +%Y%m%dT%H%M%SZ)"
target="${SAVEN_BASE_STAGING:?}/$label"

pg_basebackup \
  --pgdata="$target" \
  --format=plain \
  --wal-method=stream \
  --manifest-checksums=SHA256 \
  --checkpoint=fast \
  --label="$label" \
  --progress --verbose
```

Notes that must be honoured:

- The principal must be an actual provisioned **LOGIN** with `REPLICATION`; streaming replication cannot authenticate as a `NOLOGIN` role. **[MISSING]** until the owner provisions it.
- Plain format writes `backup_manifest`, the data files and `pg_wal`. Fields recorded from the backup: label, start/stop WAL locations, timeline, and the manifest's WAL range.
- Tablespaces: with plain format, tablespaces are restored to the paths recorded in `tablespace_map`. If the source has tablespaces, either use `--tablespace-mapping=OLD=NEW` at backup time or record the mapping for restore. A backup whose tablespace paths point at production storage is not restorable into an isolated target without mapping. Record the mapping in the drill record.
- `--checkpoint=fast` only forces a checkpoint; it does not freeze the application. A base backup is internally consistent, but the state it captures keeps moving while writers run. The reconciled baseline therefore comes from the fenced capture in §6.2, never from an unfenced observation taken during the backup.

### 5.2 Verify before encrypting or shipping

```sh
pg_verifybackup "$target"        # plain format: verifies files, manifest and WAL
```

Verification must pass **before** the backup is encrypted, packaged or shipped, and the verification output is recorded with the manifest digest.

Then hash the verified set:

```sh
find "$target" -type f -print0 | sort -z | xargs -0 sha256sum > "$target.sha256"
sha256sum "$target.sha256"
```

### 5.3 Encrypt, ship, verify, retain

1. Package and encrypt the verified set with the approved tool and key (§2). Never ship plaintext.
2. Ship to the off-server location and verify the destination digest independently of the transfer tool.
3. Record: label, manifest digest, packaged digest, destination object(s), verification result, byte size, elapsed transfer time.
4. Apply retention **only after** the off-site copy is verified. Deleting the last verified off-site restore point is a page-out condition.
5. Re-verify by restoring at least once per retention window (§8). A base backup that has never been restored is an unverified assumption, not a backup.

Scheduling proposal: one daily base backup plus continuous WAL archiving, with at least one verified restore point per retention window. Times, counts and destinations are **[PROPOSED — NOT APPROVED]** and are not a service level.

Capacity preflight: record base size, WAL per day, archive throughput, projected retention footprint, and require free space above the retention total plus one full restore of the largest expected database. **[NOT PERFORMED]**

### 5.4 Tar format (limited alternative — not the default)

If tar format is ever chosen: `pg_verifybackup` on a tar archive requires `--no-parse-wal`, because WAL parsing is supported only for plain-format backups. Tar verification therefore does **not** verify the streamed WAL. Any WAL delivered inside a tar backup must be extracted to plain format and verified separately before use. Choosing tar means adding a second, weaker verification path; the default remains plain format for that reason.

## 6. Restore and point-in-time recovery procedure

Objective: prove that a chosen, transaction-aligned recovery point can be restored into **wholly new, fenced, isolated storage** and reconciled against an authoritative pre-drill snapshot, without touching accepted live transactions, the source archive, or any source path.

### 6.1 Preconditions and authority

1. Owner-approved window and named test application/jobs recorded. No drill without them.
2. Principals: replication/backup login (read), administrative control principal for `pg_switch_wal`/`pg_control_*`, read-only reconciliation principal, and the drill operator. These are separate. The reconciliation role does not automatically hold control or checkpoint function privileges; confirm the privileges actually required by the pinned server version and stop if any is unavailable rather than escalating the role.
3. Confirm this is a drill: no client data, no production restore, no cutover.

### 6.2 Fence writers, then and only then capture the authoritative snapshot

Order matters. Earlier, unfenced observations are advisory and must not be used as the comparison baseline.

1. Stop **only** the named test application unit and the named recurring jobs/workers (outbox dispatch, schedulers, scanners, AI jobs). Never stop native production.
2. Drain and verify: no remaining application sessions, no prepared transactions, no active logical subscribers.

```sql
SELECT pid, usename, application_name, state, backend_xmin FROM pg_stat_activity
WHERE datname IS NOT NULL AND pid <> pg_backend_pid();
SELECT * FROM pg_prepared_xacts;              -- must be empty
SELECT slot_name, active FROM pg_replication_slots;
```

3. Resolve or abort on anything still connected. Do not terminate sessions blindly; an owned session may be mid-transaction.
4. Under that fence, capture one consistent snapshot in a single transaction, and keep the fence until both the snapshot and the recovery target are recorded:

```sql
BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;
-- reconciliation baseline queries from §10, captured in this one snapshot
COMMIT;
```

5. Record source identity and state in the same fenced window:

```sql
SELECT system_identifier FROM pg_control_system();
SELECT timeline_id, checkpoint_lsn FROM pg_control_checkpoint();   -- administrative principal
SELECT pg_current_wal_lsn();
```

If a query requires privileges the reconciliation role lacks, run it as the administrative control principal and record who ran what. Never grant a narrow reconciler permanent superuser to avoid that separation.

### 6.3 Pin a named, reachable recovery target after the base backup

A raw `pg_current_wal_lsn()` value after a WAL switch is a write location, not proof of a named, reachable, committed recovery point. This step therefore uses a **named restore point** created by the administrative principal, and pins the timeline.

Order matters and is part of the procedure:

1. Fence writers and capture the fenced baseline (§6.2). The baseline and the recovery target must describe the same fence.
2. Take a **fresh** verified base backup (§5) *after* the fence, or select an existing verified base backup whose **stop** location is earlier than the target you are about to create. Record its label, manifest digest and start/stop WAL locations.
3. Create one uniquely named restore point with the administrative principal. The name is drill-unique and recorded verbatim:

```sql
SELECT pg_create_restore_point('saven-drill-<UTC-TIMESTAMP>');   -- returns the target LSN
SELECT pg_current_wal_lsn(), pg_walfile_name(pg_current_wal_lsn());
SELECT timeline_id FROM pg_control_checkpoint();
```

`pg_create_restore_point()` writes a distinct WAL record; recovery uses that record, so the target cannot drift into a later state. It requires `wal_level = replica` or higher, which §4.1 already mandates.

4. Force the segment containing the restore point to be archived, then prove the **chain** that the restore will need is present off-site and continuous:

```sql
SELECT pg_switch_wal();
SELECT pg_walfile_name('<RESTORE-POINT-LSN>');
```

- Compute the segment name from the recorded LSN, never from "most recently archived".
- Verify that every segment from the base backup's **stop** location through the segment containing the restore point exists in the destination namespace for this system identifier **and this timeline**, with no gap and no archived file from a different timeline used as a substitute.
- Verify any timeline history file the pinned chain needs is present too.
- Do not substitute `pg_stat_archiver.last_archived_wal`, which names only the latest successful archive and can belong to a later segment or a different timeline.
- Do not accept a target that the chosen base backup cannot reach: the base's stop point must be at or before the restore point, and every segment in between must be archived.

5. Record as the drill identity: system identifier, **pinned timeline id (decimal)**, **restore-point name**, **restore-point LSN**, base backup label and manifest digest, base start/stop locations, and the fenced-baseline identifier. A restore without all of these is not verifiable and must not be described as a recovery test.

Why this is transaction-aligned: the restore point is a WAL record, so recovery stops at a defined WAL position rather than at an arbitrary write offset; the fence ensures the baseline, base backup and restore point describe one continuous, committed state. Absence of application sessions is used only to keep the fence honest, never as proof of a commit boundary.

### 6.4 Provision isolated storage for every path

A different port is not an isolation fence, and "PGDATA differs from the source" is not enough: tablespace-creation records and inherited symlinks can still target source paths.

1. Create a new restore root and, under it, new storage for **all** of: `pgdata/` (including `pg_wal` unless a separate WAL location is explicitly mapped), and every tablespace OID that appears in the backup's `tablespace_map` (or the default `pg_default`/`pg_global` directories). No restored path, symlink or binding may resolve into the source data directory, source `pg_wal` or any source tablespace. The only permitted symlinks are explicit `pg_wal`/tablespace mappings that resolve **inside** the restore root; everything else is refused.
2. Refuse if the restore root exists, or if any resolved restore path equals or is nested under a source path:

```sh
test ! -e "$RESTORE_ROOT"
overlap=0
for src in "$SOURCE_PGDATA" "$SOURCE_PGWAL" $SOURCE_TABLESPACES; do
  for dst in "$RESTORE_ROOT/pgdata" "$RESTORE_ROOT/tablespaces"; do
    case "$(readlink -f "$dst")/" in
      "$(readlink -f "$src")/"*) overlap=1 ;;
    esac
  done
done
test "$overlap" = 0 || { echo "REFUSED: restore path overlaps a source path"; exit 1; }
```

3. After materializing the backup, re-inspect rather than trust the copy:

```sh
find "$RESTORE_ROOT" -type l -print                    # every symlink must resolve inside the root
readlink -f "$RESTORE_ROOT"/pgdata/pg_wal             # must be inside the restore root
cat "$RESTORE_ROOT/pgdata/tablespace_map" 2>/dev/null || true   # only mapped, isolated paths
grep -n "tablespace\|archive\|restore_command" "$RESTORE_ROOT/pgdata/postgresql.auto.conf" || true
```

Record the resolved paths. Any symlink or tablespace entry resolving outside the restore root is a **failed drill** and the target is quarantined, not repaired.

### 6.5 Fetch, verify and decrypt — before configuration or startup modifies anything

1. Retrieve the base backup from the **off-site** copy, never from the source server's staging directory.
2. Verify the recorded digest of the packaged object, then decrypt.
3. Extract into `scratch-verify/` inside the restore root and run full verification there:

```sh
pg_verifybackup "$RESTORE_ROOT/scratch-verify/base"
```

4. Only after verification succeeds, materialize into `pgdata/` (and tablespaces) with the recorded tablespace mapping, then re-verify the materialized copy before writing recovery settings. Verification must never happen after startup or after recovery files have modified the tree.

### 6.6 Create the recovery signal and configure recovery

`recovery_target_*` settings alone do not start archive recovery. A signal file is required.

```sh
touch "$RESTORE_ROOT/pgdata/recovery.signal"
```

```conf
# postgresql.auto.conf / additional configuration in the restore cluster (template)
restore_command = '<SAVEN_WAL_RESTORER> %f %p'
recovery_target_name = '<RECORDED-RESTORE-POINT-NAME>'
recovery_target_timeline = '<PINNED-TIMELINE-ID>'    # decimal timeline id, or 0x-prefixed hex; never 'latest'
recovery_target_action = 'promote'
```

`restore_command` contract (interface only; implementation is a **[BLOCKING GAP]**):

- Receives `%f` (segment name) and `%p` (the destination path inside the restore cluster's WAL directory).
- Must write the **verified, decrypted segment to exactly `%p`**, atomically (temp file then rename inside the same directory), with restrictive permissions.
- Must exit non-zero if the segment is absent, undecryptable, digest-mismatched or the namespace has no such object. Never write to stdout, never pick a different segment, never treat "closest available" as success.
- Must not read from, or write to, the source archive or the source cluster.

Exactly one recovery target kind is used: `recovery_target_name`. Do not combine it with an LSN, time or XID target. The named record itself defines the stop position, so recovery reaches that record and no later commit; `recovery_target_inclusive` is **not** used here because it applies only to LSN, time and XID targets, not to name targets.

The timeline is pinned explicitly so promotion cannot follow a newer timeline by default; `latest` is never used for a drill. Record the pinned timeline as the **decimal** id returned by `pg_control_checkpoint().timeline_id` (or an explicitly `0x`-prefixed hexadecimal value); never an unqualified "hex string", which is ambiguous. Recovery stops at the named record and promotes.

If the restore point cannot be reached — missing segment, gap, wrong timeline, or a base backup whose stop point is later than the point — stop and classify it (§11). Never substitute a different target, a different timeline or a "closest available" segment to obtain a green result.

### 6.7 Fence the restored cluster before starting it

A restored data directory inherits the source's configuration, identities and connection rules. Replace and verify all of these **before** startup:

| Setting | Required restore value | Why |
| --- | --- | --- |
| `listen_addresses` | `'127.0.0.1'` | No non-loopback listener. |
| `port` | Dedicated drill port | Avoid accidental application connection. |
| `archive_mode` | `off` | Promotion must never publish WAL into the source archive or any namespace. |
| `archive_command` | unset or a drill-only sink | Inherited source value must not survive. |
| `max_wal_senders` | `0` | No replication consumers may pull from the restored cluster. |
| `default_transaction_read_only` | `on` | Business writes are refused even if an application connects. |
| `pg_hba.conf` | Drill principal only, local/loopback | Inherited source rules must not authorize runtime or remote access. |
| `postgresql.auto.conf` | Inspect and rewrite | Restored overrides can re-introduce source settings. |
| Replication slots | Confirm none; drop any unexpected slot before promotion | An inherited slot is an unexpected WAL consumer. Base backups normally do not carry slot state, so treat any slot as a finding. |
| Runtime credentials | Not reachable from the restore cluster | Restored role definitions alone must not authorize an application. |

Also explicitly fence the source side: the source must not be able to replicate from, publish to, or receive connections from the restore cluster. Stopping source replication consumption, not just the test app, is part of the fence.

Promotion for this drill never enables business writes: `default_transaction_read_only = on` and `archive_mode = off` stay in force for the whole verification window, and no application connection string is repointed.

### 6.8 Start, confirm recovery and promotion

```sh
pg_ctl -D "$RESTORE_ROOT/pgdata" -o "-p <DRILL-PORT> -c listen_addresses=127.0.0.1" -l "$RESTORE_ROOT/logs/startup.log" start
```

```sql
SELECT pg_is_in_recovery();                       -- must be false after promotion
SELECT timeline_id FROM pg_control_checkpoint();
SELECT pg_last_wal_replay_lsn(), pg_last_xact_replay_timestamp();
SELECT setting FROM pg_settings WHERE name IN ('archive_mode','default_transaction_read_only','max_wal_senders');
```

Confirm: recovery consumed exactly the recorded segments (no gap and no substitute), the **named restore point** was reached (not a nearby commit), the restored timeline equals the **pinned** timeline, `archive_mode` is `off`, the cluster is read-only, and no WAL object appeared in the source archive namespace after the fence.

```sql
SELECT pg_is_in_recovery();                 -- false after promotion
SELECT timeline_id FROM pg_control_checkpoint();  -- equals the pinned timeline
SELECT pg_last_wal_replay_lsn();            -- at or just past the restore-point LSN
```

A positive write control proves the read-only fence is real:

```sql
-- as the drill verification role; must fail with a read-only error
INSERT INTO tenant_data.reference_values(tenant_id, domain, value, label)
VALUES ('00000000-0000-4000-8000-000000000001','drill_probe','drill','drill');
```

### 6.9 Reconcile, measure and retire

1. Run the **complete** §10 matrix against the restored cluster: the anchored ownership/admission checks (10.1), ledger integrity (10.2), numbering (10.3), the full complete-row digest coverage of every authoritative table (10.4) and the subledger controls (10.5). Every result must match the fenced baseline; any unexplained difference — including a count-equal but row-divergent table — is a failed drill even if the database opened cleanly.
2. Record measured wall-clock time per step and in total. Measured, never estimated, never converted into an SLA. **[NOT PERFORMED]**
3. Stop the restored cluster. Keep the restore root, logs, `pg_verifybackup` output, digests and query output as evidence until the owner accepts or rejects.
4. Never point an application at the restore. Never promote it into the source path. Never leave its port reachable. Delete only after the drill record and evidence are archived and the owner's decision is recorded.

## 7. What "recovery succeeded" means

All of the following together — not any single one:

- The drill used a freshly created, uniquely named restore point taken after the fence and after the chosen base backup completed; recovery used `recovery_target_name` with an explicitly pinned `recovery_target_timeline`, reached that named point, and promoted without a WAL gap, timeline substitution or manually chosen segment.
- Every segment from the base backup's stop location through the restore point was present off-site and contiguous for the pinned timeline, including any timeline history file the chain requires.
- Every restored path (data, WAL, tablespaces) resolved inside the new isolated storage; no symlink or tablespace record escaped it.
- The restored cluster was read-only and published nothing to the source archive for the whole window.
- Row counts **and complete-row canonical digests** match the fenced baseline for every authoritative table in §10.4, including lease/error fields, outbox event identity, review payloads, provenance and timestamps; the counts are keyed to the expected activated-tenant set so a missing tenant cannot disappear. All audit streams (`tenant_data.audit`, `tenant_data.audit_event`, `auth.auth_audit`) are compared separately with no merging or back-fill.
- The general ledger is balanced per tenant and per company, and the trial balance matches the baseline exactly.
- Document numbers and sequences match, including high-water marks; no number was renumbered, reused or rolled back.
- Subledger controls that exist in the schema reconcile in **both directions** (stock balances vs movements, trade documents vs lines vs allocations, corrections vs journals, no orphan parents or children).
- Authority state is intact against the expected activated-business set: one protected ultimate-owner role per business, exactly one **active** owner assignment, and admission state consistent with `auth.tenant_membership` where that schema is deployed.
- RLS isolation is proven with a positive own-tenant control and a denied foreign-tenant control under the actual non-owner runtime role, after PIVOT-004. Before PIVOT-004 it is declared **not applicable**, never "passed".
- Negative controls actually failed as intended (read-only refusal, foreign-tenant zero rows, archive publish refusal).
- Measured elapsed time, commands, artifact digests, principals and anomalies are recorded.

Checks that this draft cannot perform are listed as **[BLOCKING GAP]** in §10.5 rather than implied to pass.

## 8. Required verification tests (all currently NOT PERFORMED)

| # | Test | Method | Pass condition | Status |
| --- | --- | --- | --- | --- |
| V1 | Fenced base restore | Fence, snapshot, base backup, isolated restore, reconcile | §7 checks pass; elapsed recorded | **[NOT PERFORMED]** |
| V2 | Named-restore-point recovery with a pinned timeline | Post known work, fence, take a base backup, create a named restore point afterwards, archive and restore | Restored state equals the fenced snapshot at that point; later work absent; restored timeline equals the pinned timeline | **[NOT PERFORMED]** |
| V2a | Target earlier than the base backup | Attempt recovery to a restore point older than the selected base backup's stop location | Procedure refuses; no "closest" target or substitute segment is used | **[NOT PERFORMED]** |
| V2b | Timeline mismatch | Restore with a `recovery_target_timeline` that does not match the archived chain | Recovery fails closed; no promotion on an implied 'latest' timeline | **[NOT PERFORMED]** |
| V3 | Recovery signal | Attempt recovery with a valid `recovery_target_name` but no `recovery.signal` | Recovery does not perform archive recovery to the target; the drill detects and stops | **[NOT PERFORMED]** |
| V3a | Outbox/lease mutation detection | Swap two outbox events between commands, and change a command lease field, in a copy of the restored state | Complete-row digests detect both changes; a state-count census alone does not | **[NOT PERFORMED]** |
| V3b | Canonicalisation stability | Compare rows containing JSONB, NULL, trailing-scale numeric, epoch-ms integer and `timestamptz` under the pinned settings | Both clusters produce identical canonical text and digests | **[NOT PERFORMED]** |
| V4 | WAL gap detection | Remove one recorded segment from a copy of the archive | Restore fails with an explicit missing-segment error; no substitution | **[NOT PERFORMED]** |
| V5 | Archive failure behaviour | Make the destination unwritable or fail publication | `archive_command` exits non-zero, segment stays in `pg_wal`, alert fires, recovery after fix | **[NOT PERFORMED]** |
| V6 | Archive retry idempotency | Re-archive an already published identical segment | Exit 0 without overwriting; verified identical source content | **[NOT PERFORMED]** |
| V7 | Archive publish conflict | Publish a different segment under an existing final name | Non-zero exit, no overwrite, alert | **[NOT PERFORMED]** |
| V8 | Archive partial upload | Interrupt a transfer mid-object | Final name never appears; retry succeeds; no partial object accepted | **[NOT PERFORMED]** |
| V9 | Key loss and wrong key | Restore without the key, then with a wrong key | Fails closed; no plaintext fallback; only approved escrow recovers | **[NOT PERFORMED]** |
| V10 | Tablespace/symlink escape | Restore a backup whose tablespace map or symlinks point at source paths | Procedure refuses before startup; target quarantined | **[NOT PERFORMED]** |
| V11 | Capacity and retention | Exercise base/WAL retention and fill staging | Preflight alerts before exhaustion; last verified restore point never deleted | **[NOT PERFORMED]** |
| V12 | Off-site independence | Delete local artifacts, restore from off-site only | Restore succeeds from off-site alone | **[NOT PERFORMED]** |
| V13 | Read-only promotion fence | Attempt business writes after promotion | Refused; no archive object created | **[NOT PERFORMED]** |
| V14 | Snapshot-order consistency | Compare an unfenced observation to the fenced baseline | Procedure uses only the fenced baseline; drift is detected, not ignored | **[NOT PERFORMED]** |
| V15 | Repeatability | Run V1 twice in one week | Both restores reconcile; measured time recorded | **[NOT PERFORMED]** |
| V16 | Manifest drift | Drop one table from the manifest, and separately add a table not in the manifest | Catalog-to-manifest check fails in both directions before any digest comparison | **[NOT PERFORMED]** |
| V17 | SQL failure in the exporter | Query a missing table, and separately revoke a column mid-run | The fail-closed pipeline returns non-zero and publishes no digest; no "success" from an empty stream | **[NOT PERFORMED]** |
| V18 | Interrupted stream | Terminate the exporter mid-table | Partial output is detected via the completion/line-count checks and never compared as evidence | **[NOT PERFORMED]** |
| V19 | Vacuous comparison | Run both clusters with an empty dataset and no controls | The drill fails the non-vacuous control requirement instead of reporting matching empty digests | **[NOT PERFORMED]** |
| V20 | Secret non-export | Inspect the export files and logs | They contain only opaque keys, row digests and counts; no token, seed, verifier, recovery code or credential appears | **[NOT PERFORMED]** |
| V21 | Snapshot consistency across tables | Change a row between two per-table exports when the exported-snapshot protocol is not used | The drill detects inconsistent snapshots and requires one exported snapshot (or one exporter session) | **[NOT PERFORMED]** |

## 9. Monitoring and page-out conditions

Page the owner or named on-call when:

- `pg_stat_archiver.last_failed_wal` advances, or `last_failed_time` is newer than `last_archived_time`.
- Archived WAL lag exceeds the budget derived from the approved RPO **[MISSING]**.
- Archive publication reports a conflict, a verify mismatch or repeated retries for the same segment.
- `pg_wal` size or the filesystem holding `pg_wal`, staging, base backups or the restore root crosses its capacity threshold.
- The newest base backup is older than the approved schedule, or its off-site digest cannot be verified.
- A scheduled restore verification (§8) fails, is skipped, or produces a reconciliation mismatch.
- Any restored cluster path resolves outside its isolated root, or a restore cluster publishes WAL.

The monitoring instrumentation itself is **[BLOCKING GAP]**: no exporter, timer or alert route exists in this repository for the PostgreSQL target. Only the native SQLite backup units exist **[OBSERVED]**.

## 10. Reconciliation queries

All queries are read-only. Expected results are stated; any deviation is a failed reconciliation. Run them inside the fenced snapshot transaction (§6.2) on the source and against the restored cluster, and compare.

Canonical digests always hash **complete rows** with length-prefixed fields so that separators and `NULL` values cannot collide, and so that actor/detail/command bytes are covered. JSONB is cast through `to_jsonb(...)::text`, which is deterministic for a given value.

```sql
-- Reusable canonical row text: length-prefixed, NULL sentinel, no ambiguity.
-- (Inlined per query below; adapt the column list, never drop columns silently.)
--   concat_ws('|',
--     length(coalesce(col::text,'')) || ':' || coalesce(col::text,'∅'), ...)
```

### 10.1 Expected activated-business set and canonical admission

Zero-row queries are not sufficient: a tenant with no role rows disappears instead of failing, and a tenant that is legitimately suspended or still provisioning may correctly keep its retained owner role. The checks below are therefore anchored to the expected activated set and distinguish a real inconsistency from a retained-but-inactive business.

`auth.tenant_membership` has canonical UUID `user_id` (there is no `user_uuid` there); the UUID projection lives only in `tenant_data.members.user_uuid`, and the two are bound by PIVOT-004's composite foreign keys.

```sql
-- Anchor set (Cloud profile: the vendor operator directory). Private packaging has no
-- approved equivalent here; see §1 and the blocking gap in §10.4/§10.5.
SELECT tenant_id, status FROM operator.tenant ORDER BY tenant_id;

-- 10.1a Activated tenants must have exactly one protected owner role and exactly one
-- active owner assignment whose member, canonical identity and membership are active.
WITH expected AS (
  SELECT tenant_id FROM operator.tenant WHERE status = 'ACTIVE'
), protected AS (
  SELECT tenant_id, count(*) AS n FROM tenant_data.roles WHERE protected GROUP BY tenant_id
), active_owner AS (
  SELECT m.tenant_id, count(*) AS n
  FROM tenant_data.members m
  JOIN tenant_data.roles r
    ON r.tenant_id = m.tenant_id AND r.id = 'ultimate_business_admin' AND r.protected
  JOIN tenant_data.assignments a
    ON a.tenant_id = m.tenant_id AND a.user_id = m.user_id AND a.role_id = r.id
  JOIN auth.users u
    ON u.id = m.user_uuid AND u.status = 'active'
  JOIN auth.tenant_membership tm
    ON tm.tenant_id = m.tenant_id AND tm.user_id = m.user_uuid
   AND tm.status = 'active' AND tm.revoked_at IS NULL AND tm.suspended_at IS NULL
  WHERE m.active
  GROUP BY m.tenant_id
)
SELECT e.tenant_id,
       coalesce(p.n, 0) AS protected_roles,
       coalesce(o.n, 0) AS active_owner_assignments
FROM expected e
LEFT JOIN protected p ON p.tenant_id = e.tenant_id
LEFT JOIN active_owner o ON o.tenant_id = e.tenant_id
WHERE coalesce(p.n, 0) <> 1 OR coalesce(o.n, 0) <> 1
ORDER BY e.tenant_id;          -- expect zero rows

-- 10.1b Orphan ownership: a protected role or owner assignment for a tenant that has
-- no tenant record at all. That is an inconsistency. A retained owner on a
-- suspended/provisioning tenant is listed for review by 10.1c, not failed here.
SELECT r.tenant_id, 'protected role without tenant record' AS finding
FROM tenant_data.roles r
LEFT JOIN operator.tenant t ON t.tenant_id = r.tenant_id
WHERE r.protected AND t.tenant_id IS NULL
UNION ALL
SELECT a.tenant_id, 'owner assignment without tenant record'
FROM tenant_data.assignments a
LEFT JOIN operator.tenant t ON t.tenant_id = a.tenant_id
WHERE a.role_id = 'ultimate_business_admin' AND t.tenant_id IS NULL
ORDER BY 1, 2;                 -- expect zero rows

-- 10.1c Review listing: retained owners on non-activated businesses. Expected for
-- suspended/provisioning tenants; record counts and confirm each is intentional.
SELECT t.tenant_id, t.status,
       count(DISTINCT r.id) AS protected_roles,
       count(DISTINCT a.user_id) AS owner_assignments
FROM operator.tenant t
LEFT JOIN tenant_data.roles r ON r.tenant_id = t.tenant_id AND r.protected
LEFT JOIN tenant_data.assignments a
  ON a.tenant_id = t.tenant_id AND a.role_id = 'ultimate_business_admin'
WHERE t.status <> 'ACTIVE'
GROUP BY t.tenant_id, t.status
ORDER BY t.tenant_id;          -- informational, compared with the baseline

-- 10.1d Canonical admission consistency: every active tenant principal must map to an
-- active canonical identity and an active canonical membership. Expect zero rows.
SELECT m.tenant_id, m.user_id, m.user_uuid
FROM tenant_data.members m
LEFT JOIN auth.users u ON u.id = m.user_uuid
LEFT JOIN auth.tenant_membership tm
  ON tm.tenant_id = m.tenant_id AND tm.user_id = m.user_uuid
WHERE m.active
  AND (
    u.id IS NULL OR u.status <> 'active'
    OR tm.id IS NULL
    OR tm.status <> 'active'
    OR tm.revoked_at IS NOT NULL
    OR tm.suspended_at IS NOT NULL
  )
ORDER BY m.tenant_id, m.user_id;
```

An active membership with no tenant principal is **not** itself a mismatch: a business may be admitted but not projected. Only the projection direction above is required, and it must also reproduce PIVOT-004's `session_admitted()` semantics: active principal **and** active membership **and** active identity.

RLS isolation example. Two mistakes must be avoided. First, a multi-tenant user switching to a tenant they are admitted to is authorized selection, not a leak. Second, switching the context and then asserting zero rows proves nothing about isolation under an unchanged context. Use a known foreign tenant the test principal is **not** admitted to, query it under the unchanged own context, and keep a positive own-tenant control:

```sql
BEGIN;
-- Executed as the actual non-owner runtime role, through the application's verified
-- context mechanism. Direct set_config is disposable-cluster scaffolding only; it is
-- never evidence that application context is server-verified (AUTH-006 owns that).
SELECT set_config('app.current_tenant_id', '<OWN-TENANT-UUID>', true);
SELECT set_config('app.current_user_id', '<VERIFIED-USER-UUID>', true);

SELECT count(*) AS own_rows FROM tenant_data.accounts;                -- EXPECT > 0 (control)
SELECT count(*) AS foreign_rows
FROM tenant_data.accounts
WHERE tenant_id = '<FOREIGN-TENANT-UUID-NOT-ADMITTED-TO>';            -- EXPECT 0
SELECT count(*) AS foreign_lines
FROM tenant_data.journal_lines
WHERE tenant_id = '<FOREIGN-TENANT-UUID-NOT-ADMITTED-TO>';            -- EXPECT 0
SELECT tenant_data.session_admitted(
  '<FOREIGN-TENANT-UUID-NOT-ADMITTED-TO>'::uuid, '<OTHER-USER-UUID>'::uuid
) AS foreign_pair_admitted;                                           -- EXPECT false
ROLLBACK;

-- Missing context must deny, not error-leak.
BEGIN;
SELECT count(*) AS no_context_rows FROM tenant_data.accounts;         -- EXPECT 0
ROLLBACK;
```

Before PIVOT-004 lands, these isolation checks are **not applicable** and must be recorded as such, never as passed.

### 10.2 Ledger integrity

```sql
-- Every posted journal is balanced. Expect zero rows.
SELECT tenant_id, journal_id, sum(debit) AS debit, sum(credit) AS credit
FROM tenant_data.journal_lines
GROUP BY tenant_id, journal_id
HAVING sum(debit) <> sum(credit);

-- Trial balance (compare exact values with the fenced baseline).
SELECT l.tenant_id, j.company, l.account, sum(l.debit) AS debit, sum(l.credit) AS credit
FROM tenant_data.journal_lines l
JOIN tenant_data.journals j ON j.tenant_id = l.tenant_id AND j.id = l.journal_id
GROUP BY l.tenant_id, j.company, l.account
ORDER BY l.tenant_id, j.company, l.account;

-- Parent/child both directions: journals without lines, lines without a journal.
SELECT j.tenant_id, j.id FROM tenant_data.journals j
WHERE NOT EXISTS (SELECT 1 FROM tenant_data.journal_lines l WHERE l.tenant_id = j.tenant_id AND l.journal_id = j.id)
ORDER BY 1, 2;                    -- expect zero rows
SELECT l.tenant_id, l.journal_id FROM tenant_data.journal_lines l
WHERE NOT EXISTS (SELECT 1 FROM tenant_data.journals j WHERE j.tenant_id = l.tenant_id AND j.id = l.journal_id)
ORDER BY 1, 2;                    -- expect zero rows

-- Corrections: one per original, all linked. Expect zero rows in both queries.
SELECT tenant_id, original_id, count(*) FROM tenant_data.journal_corrections
GROUP BY tenant_id, original_id HAVING count(*) > 1;
SELECT c.tenant_id, c.original_id FROM tenant_data.journal_corrections c
WHERE NOT EXISTS (SELECT 1 FROM tenant_data.journals j WHERE j.tenant_id = c.tenant_id AND j.id = c.original_id);
```

### 10.3 Numbering and allocation

```sql
SELECT n.tenant_id, n.company, n.kind, max(n.sequence) AS highest_allocated
FROM tenant_data.document_numbers n GROUP BY 1, 2, 3 ORDER BY 1, 2, 3;

SELECT s.tenant_id, s.company, s.kind, s.next_number - 1 AS highest_allocated
FROM tenant_data.document_sequences s ORDER BY 1, 2, 3;

-- Duplicate or missing numbers. Expect zero rows.
SELECT tenant_id, company, number, count(*) FROM tenant_data.document_numbers
GROUP BY 1, 2, 3 HAVING count(*) > 1;

SELECT s.tenant_id, s.company, s.kind
FROM tenant_data.document_sequences s
LEFT JOIN tenant_data.document_numbers n
  ON n.tenant_id = s.tenant_id AND n.company = s.company AND n.kind = s.kind
 AND n.sequence = s.next_number - 1
WHERE s.next_number > 1 AND n.id IS NULL
ORDER BY 1, 2, 3;                 -- expect zero rows
```

### 10.4 Complete persisted-state reconciliation (every authoritative row)

Counts are not a comparison. A count can stay identical while a lease, an outbox event, a policy snapshot or a provenance column changes. Because the source is fenced for the whole drill, mutability during normal work is no reason to exclude a column from the comparison: the restored state must match the fenced state exactly, including lease, error, review, pending and provenance fields.

**Canonical form — complete internally, opaque externally.** For every authoritative table:

- One canonical text per row: `to_jsonb(t)::text`, which includes **every** persisted column with its column name, renders SQL `NULL` as JSON `null` (explicit, not an empty string), and canonicalises JSONB key order. This includes secrets: token digests, MFA seed ciphertext, recovery-code hashes and PKCE verifier ciphertext are part of the row being hashed.
- The digest is computed **server-side**, inside the database. Exports contain only an opaque ordering key, the row digest and a count — never a secret value, a raw token, a seed, a verifier or a credential. Secret bytes participate in the comparison without ever leaving the server or reaching a log.
- All format settings are pinned in the same session: `SET LOCAL TimeZone = 'UTC'` and `SET LOCAL DateStyle = 'ISO, MDY'` (the accepted default; recording it prevents a later default change from silently altering the digest). Server encoding is UTF8 and is recorded. Native epoch-millisecond `bigint` values render as integers; no floating-point columns exist.
- The row digest is `encode(sha256(convert_to(<canonical row text>, 'UTF8')), 'hex')` — core PostgreSQL 18 `sha256(bytea)`, no extension.
- Rows are exported in a deterministic key order and hashed as a streamed sequence.

**One fenced snapshot, not one session per table.** The baseline must come from the single repeatable-read snapshot opened in §6.2. Opening a new `psql -c` per table would read a different snapshot each time and could miss a change that happened between two tables. Use one of:

- one exporter session that emits every table's ordered digests in one transaction; or
- an **exported snapshot**: keep session A open with `BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY; SELECT pg_export_snapshot();`, and have each per-table exporter run `BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY; SET TRANSACTION SNAPSHOT '<EXPORTED-SNAPSHOT-ID>';` before its query, then commit. The exporting transaction must stay open until every exporter finishes.

**Fail-closed pipeline.** A plain `psql … | sha256sum` can report success after a SQL error: `ON_ERROR_STOP` does not propagate through a pipe by itself, so a missing table or permission failure can hash an empty or truncated stream. The export must be a shell function with `set -euo pipefail` and explicit completion checks:

```sh
#!/bin/sh
set -euo pipefail

# One table, one pinned snapshot. All settings are local to the exporting transaction.
export_table() {
  table="$1"; keys="$2"; out="$3"
  test -n "$table" && test -n "$keys" && test -n "$out"
  psql -X -q -A -t -v ON_ERROR_STOP=1 "<CONNECTION>" <<SQL > "$out"
BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET TRANSACTION SNAPSHOT '<EXPORTED-SNAPSHOT-ID>';
SET LOCAL TimeZone = 'UTC';
SET LOCAL DateStyle = 'ISO, MDY';
SELECT $keys, encode(sha256(convert_to(to_jsonb(t)::text,'UTF8')),'hex')
FROM tenant_data.$table t
ORDER BY $keys;
COMMIT;
SQL
  # Fail closed: the file must exist, be non-empty and end with a complete row record.
  test -s "$out"
  test "$(tail -n 1 "$out" | wc -l)" -eq 1
}

# Non-vacuous controls and manifest bookkeeping are required, not optional:
#   * expected table count == digests produced        (a skipped table must fail)
#   * expected row count per table == digest lines    (an empty export must fail)
#   * at least one control table with a known non-zero row count is present
#   * every digest file is non-empty and its line count matches the captured count
export_table accounts 'tenant_id, code' digests/accounts.txt
# … one call per row of the coverage matrix …

# Publish only after every check passes; an interrupted run publishes nothing.
sha256sum digests/*.txt > digests/stream.sha256
```

`set -o pipefail` (or `set -euo pipefail` as above) makes a failing exporter return non-zero to the caller. Do not write the digest file before the exporter's exit status is checked, and do not compare a digest produced by a run that skipped its completion checks. The same function runs against the restored cluster, and the two published digest sets must be identical.

```sql
-- Catalog-to-manifest coverage check. Run against the fenced source and the restore.
-- Any table present in the schemas but absent from the manifest fails the drill, and
-- any manifest entry missing from the catalog fails as well. A newly added table must
-- never disappear from the comparison simply because the manifest was not updated.
WITH actual AS (
  SELECT n.nspname || '.' || c.relname AS table_name
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname IN ('tenant_data', 'auth', 'operator') AND c.relkind IN ('r', 'p')
), manifest AS (
  SELECT unnest(ARRAY[ '<MANIFEST-ENTRY-1>', '<MANIFEST-ENTRY-2>' /* … one per matrix row … */ ]) AS table_name
)
SELECT 'unlisted in manifest' AS finding, table_name FROM actual
EXCEPT
SELECT 'unlisted in manifest', table_name FROM manifest
UNION ALL
SELECT 'missing from catalog', table_name FROM manifest
EXCEPT
SELECT 'missing from catalog', table_name FROM actual
ORDER BY 1, 2;   -- expect zero rows
```

A single `string_agg()` over a whole table is **not** a production-scale verifier: it accumulates the entire stream in memory and hits the 1 GB aggregate limit. It may be used for a small drill dataset only, and must be labelled as such.

**Comparator gap.** The shell function above is a template, not a checked-in tool: nothing in this repository enforces the matrix, the settings, the manifest comparison or the completion checks automatically. Until a separately contracted fail-closed comparator exists, a drill's comparison is manual and must be recorded as manual; two matching digests from an unchecked run are **not** evidence. **[BLOCKING GAP]**

**Coverage matrix.** Every row is compared; none is optional. Order keys are the accepted primary keys.

| Table | Ordering key |
| --- | --- |
| `business` | `(tenant_id, id)` |
| `members` | `(tenant_id, user_id)` |
| `roles` | `(tenant_id, id)` |
| `assignments` | `(tenant_id, user_id, role_id)` |
| `denials` | `(tenant_id, user_id, action)` |
| `accounts` | `(tenant_id, code)` |
| `account_profiles` | `(tenant_id, code)` |
| `periods` | `(tenant_id, company, start_date)` |
| `command_inbox` | `(tenant_id, id)` — all columns, including `payload`, `digest`, `state`, `lease_token`, `lease_until`, `error`, `approved_by`, `created_at`, `updated_at`, `updated_by` |
| `approval_requests` | `(tenant_id, command_id)` — including `policy_snapshot`, `state`, `decided_by`, timestamps |
| `journals` | `(tenant_id, id)` |
| `journal_lines` | `(tenant_id, journal_id, line_no)` |
| `audit` | `(tenant_id, id)` — independent stream, never merged with `audit_event` |
| `audit_event` | `(tenant_id, id)` — independent stream, including origin, model and request metadata |
| `outbox` | `(tenant_id, id)` — including `event`, `state`, `attempts`, `updated_at`, `updated_by`; a state-count census cannot detect two commands swapping events |
| `document_sequences` | `(tenant_id, company, kind)` |
| `document_numbers` | `(tenant_id, id)` |
| `journal_drafts` | `(tenant_id, id)` — including payload, revision, state, source link |
| `command_decisions` | `(tenant_id, command_id)` |
| `company_profiles` | `(tenant_id, id)` |
| `company_settings` | `(tenant_id, company)` |
| `warehouses` | `(tenant_id, company, id)` |
| `stock_items` | `(tenant_id, company, id)` |
| `stock_balances` | `(tenant_id, company, warehouse, item)` |
| `stock_operations` | `(tenant_id, command_id)` |
| `stock_movements` | `(tenant_id, command_id, warehouse)` |
| `command_files` | `(tenant_id, id)` — metadata rows only; object bytes are a blocking gap |
| `inventory_controls` | `(tenant_id, account)` |
| `journal_corrections` | `(tenant_id, command_id)` |
| `trade_controls` | `(tenant_id, company, branch, account)` |
| `trade_parties` | `(tenant_id, company, branch, id)` |
| `trade_operations` | `(tenant_id, command_id)` |
| `trade_documents` | `(tenant_id, command_id)` |
| `trade_lines` | `(tenant_id, command_id, line_no)` |
| `trade_allocations` | `(tenant_id, command_id, document_id)` |
| `trade_credits` | `(tenant_id, command_id)` |
| `trade_credit_lines` | `(tenant_id, command_id, original_line)` |
| `source_store_migrations` | `(tenant_id, source_store, version)` |
| `reference_values` | `(tenant_id, domain, value)` |
| `business_rule` | `(tenant_id, rule_key, version)` |
| `approval_policy` | `(tenant_id, policy_key, version)` |
| `posting_constraint` | `(tenant_id, constraint_key, version)` |
| `tax_profile` | `(tenant_id, tax_code, version)` |
| `support_grants` | `(tenant_id, grant_id)` |
| `document_registry` | `(tenant_id, document_id)` |
| `document_revisions` | `(tenant_id, document_id, revision)` |
| `verified_entitlement` | `(tenant_id, entitlement_id)` |
| `auth.users` | `(id)` — complete identity row hashed **server-side**; secret columns are never exported |
| `auth.tenant_membership` | `(tenant_id, user_id)` — canonical admission state, including status and suspended/revoked timestamps |
| `auth.roles` | `(role_id)` — assurance classes |
| `auth.reference_value` | `(domain, value)` — auth reference domains |
| `auth.accounts` | `(id)` — provider bindings, including token ciphertext, hashed server-side and never exported |
| `auth.sessions` | `(id)` — session rows including revocation and expiry columns; token digests are hashed, never exported |
| `auth.verification` | `(id)` — single-use challenge rows and their consumption state |
| `auth.two_factor` | `(id)` — MFA factor rows, including encrypted seed material hashed server-side |
| `auth.recovery_codes` | `(id)` — recovery-code hashes and single-use consumption state |
| `auth.oauth_state` | `(id)` — OAuth readiness state, nonce/PKCE binding and expiry |
| `auth.auth_audit` | `(id)` — independent append-only identity audit stream; never merged with the business audit streams |
| `operator.tenant` | `(tenant_id)` — Cloud profile only; Private mapping is a separate blocking gap, not assumed here |
| `operator.entitlement` | `(tenant_id, version)` — Cloud profile only |
| `operator.operator_audit` | `(id)` — Cloud profile only, append-only |
| `operator.feature_flag` | `(id)` — Cloud profile only |
| `operator.tenant_placement` | `(tenant_id)` — Cloud profile only |
| `operator.jobs` | `(tenant_id, command_id)` — Cloud profile only, operational control state |
| `operator.ai_requests` | `(id)` — Cloud profile only, redacted usage metadata |
| `operator.migration_events` | `(id)` — Cloud profile only, append-only |
| `operator.source_store_migrations` | `(source_store, tenant_id, version)` — Cloud profile only |
| `operator.pg_schema_migrations` | `(version)` — Cloud profile only |
| `operator.reference_value` | `(domain, value)` — Cloud profile reference/seed rows |

Counts and keys are additionally anchored to the expected tenant set, so a tenant that lost every row still appears:

```sql
WITH expected AS (
  SELECT tenant_id FROM operator.tenant WHERE status = 'ACTIVE'   -- Cloud only; Private mapping is a blocking gap
), counts AS (
  SELECT tenant_id, count(*) AS n FROM tenant_data.<table> GROUP BY tenant_id
)
SELECT e.tenant_id, coalesce(c.n, 0) AS rows
FROM expected e LEFT JOIN counts c USING (tenant_id)
ORDER BY e.tenant_id;
```

Run that keyed count for every table in the matrix and compare it with the baseline. Count equality does not replace the row digests; it catches a missing tenant that a per-tenant digest would silently omit.

**Session and export hygiene.** Pin `TimeZone`, `DateStyle` (default ISO works; record it), `extra_float_digits` is irrelevant because no float columns exist, and run the export inside the fenced baseline transaction so both the digests and the §10.1–10.3 checks describe one snapshot. Record the exact command lines and digests in the drill record.

**Blocking gaps for this section.** These are marked as gaps, not implied coverage:

| Gap | Detail |
| --- | --- |
| Streaming digest tooling | The fail-closed `export_table` template (pipefail, pinned settings, completion and count checks) is the required method, together with the catalog-to-manifest coverage check. There is no checked-in comparator that enforces the matrix, the manifest, the settings or non-vacuous controls; until one exists the comparison is manual, must be recorded as manual, and two matching digests from an unchecked run are not evidence. **[BLOCKING GAP]** |
| Canonicalisation edge rows | Before trusting the digest, the drill must include at least one row with a JSONB payload, one `NULL`, one numeric with trailing scale, one epoch-millisecond integer and one `timestamptz`, and confirm both clusters render them identically under the pinned settings. **[NOT PERFORMED]** |
| Object/evidence bytes | `command_files` stores metadata only; the private object store and its manifest are outside PostgreSQL and this runbook's scope. **[BLOCKING GAP]** — see §10.5 |
| Production-scale volume | A representative-size run is not possible on the current empty target; the matrix is written to be bounded and streamed so it can be used at scale, but no volume claim is made. **[NOT PERFORMED]** |

### 10.5 Subledgers, evidence and blocking gaps

```sql
-- Stock balances reconcile with movement history in both directions.
SELECT b.tenant_id, b.company, b.warehouse, b.item, b.quantity, b.value,
       coalesce(sum(m.quantity_delta), 0) AS moved_quantity,
       coalesce(sum(m.value_delta), 0) AS moved_value
FROM tenant_data.stock_balances b
LEFT JOIN tenant_data.stock_movements m
  ON m.tenant_id = b.tenant_id AND m.company = b.company
 AND m.warehouse = b.warehouse AND m.item = b.item
GROUP BY b.tenant_id, b.company, b.warehouse, b.item, b.quantity, b.value
HAVING b.quantity <> coalesce(sum(m.quantity_delta), 0)
    OR b.value <> coalesce(sum(m.value_delta), 0);

-- Movements whose balance row is missing (opposite direction).
SELECT m.tenant_id, m.company, m.warehouse, m.item
FROM tenant_data.stock_movements m
LEFT JOIN tenant_data.stock_balances b
  ON b.tenant_id = m.tenant_id AND b.company = m.company
 AND b.warehouse = m.warehouse AND b.item = m.item
WHERE b.item IS NULL;              -- expect zero rows

-- Owned-stock invariant restored by 021: an empty balance never holds value.
SELECT tenant_id, company, warehouse, item, quantity, value FROM tenant_data.stock_balances
WHERE NOT (quantity > 0 OR value = 0);   -- expect zero rows

-- Trade documents reconcile with lines and allocations in both directions.
SELECT d.tenant_id, d.command_id, d.total, coalesce(sum(l.amount), 0) AS lines_total
FROM tenant_data.trade_documents d
LEFT JOIN tenant_data.trade_lines l ON l.tenant_id = d.tenant_id AND l.command_id = d.command_id
GROUP BY d.tenant_id, d.command_id, d.total
HAVING d.total <> coalesce(sum(l.amount), 0);

SELECT d.tenant_id, d.command_id, d.total, coalesce(sum(a.amount), 0) AS allocated
FROM tenant_data.trade_documents d
LEFT JOIN tenant_data.trade_allocations a ON a.tenant_id = d.tenant_id AND a.document_id = d.command_id
GROUP BY d.tenant_id, d.command_id, d.total
HAVING coalesce(sum(a.amount), 0) > d.total;

SELECT a.tenant_id, a.document_id FROM tenant_data.trade_allocations a
WHERE NOT EXISTS (SELECT 1 FROM tenant_data.trade_documents d WHERE d.tenant_id = a.tenant_id AND d.command_id = a.document_id)
ORDER BY 1, 2;                     -- expect zero rows

-- Credit lines never exceed their original line; credits reference posted originals.
SELECT c.tenant_id, c.command_id FROM tenant_data.trade_credits c
WHERE NOT EXISTS (SELECT 1 FROM tenant_data.trade_documents d WHERE d.tenant_id = c.tenant_id AND d.command_id = c.original_id)
ORDER BY 1, 2;                     -- expect zero rows
```

Controls that this draft cannot supply are **blocking gaps**, not implied coverage:

| Control | Why it is not covered here | Required owner |
| --- | --- | --- |
| Evidence/object-byte verification (attachment digests, object-store manifests) | `tenant_data.command_files` stores metadata only; the object store and its manifest are outside PostgreSQL and outside this TOUCH list. | A later file/evidence contract plus the drill record's object manifest |
| Asset, tax/withholding and payroll subledger controls | Those tables are not in the accepted PIVOT-003 skeleton; postings do not exist in PostgreSQL yet. | PIVOT-013 kernel, then their own contracts |
| GL-vs-subledger control-account reconciliation (AR/AP/stock control balances) | Requires the posting kernel and registered control accounts; the schema alone cannot compute it. | PIVOT-013 and parity PIVOT-009/010 |
| Append-only enforcement proof (posted sources, audit streams) | Enforced by PIVOT-005/006 triggers, which are not delivered. | PIVOT-005/006 |
| Static/dynamic allocation reconciliation across the whole document graph | Depends on the kernel's allocation semantics. | PIVOT-013 |
| Cross-tenant isolation under the real runtime role | Needs PIVOT-004 policies and grants plus AUTH-006 verified context. | PIVOT-004 and AUTH-006 |

RLS isolation check shape (run only after PIVOT-004; until then declare **not applicable**, never "passed"). It requires a known own-tenant row, the actual non-owner runtime role, and a positive control so zero rows cannot pass for the wrong reason:

```sql
-- Executed as saven_customer_app (the actual runtime role), using the verified
-- context mechanism. Direct set_config is acceptable only in a disposable drill
-- cluster; it is never evidence that application context is server-verified.
BEGIN;
SELECT set_config('app.current_tenant_id', '<KNOWN-OWN-TENANT-UUID>', true);
SELECT set_config('app.current_user_id', '<KNOWN-VERIFIED-USER-UUID>', true);
SELECT count(*) AS own_rows FROM tenant_data.accounts;            -- EXPECT > 0 (positive control)

SELECT set_config('app.current_tenant_id', '<KNOWN-FOREIGN-TENANT-UUID>', true);
SELECT count(*) AS foreign_rows FROM tenant_data.accounts;        -- EXPECT 0
SELECT count(*) AS foreign_lines FROM tenant_data.journal_lines;  -- EXPECT 0
ROLLBACK;

-- Missing context must deny, not error-leak:
BEGIN;
SELECT count(*) AS no_context_rows FROM tenant_data.accounts;     -- EXPECT 0
ROLLBACK;
```

## 11. Failure handling and decisions

| Situation | Required action | Decision owner |
| --- | --- | --- |
| Archive destination unavailable or `archive_command` failing | Page out; keep WAL on disk; restore archive capability; re-verify archived segments. Never disable `archive_mode` to silence growth | Owner/on-call |
| Archive publication conflict (final object exists with different content) | Refuse and alert; do not overwrite or delete; investigate the source segment and timeline | Engineer + owner |
| Archive verify mismatch or repeated retries for one segment | Stop archiving claims for that segment; keep it in `pg_wal`; investigate transfer/encryption; re-archive only after verification passes | Engineer |
| Recovery without `recovery.signal` | Stop: targeted archive recovery did not start. Create the signal and restart from a clean copy; never improvise with `pg_wal` replay guesses | Engineer |
| Missing WAL segment during recovery | Stop. Classify gap vs intentional timeline switch vs deleted archive. Never substitute segments. Record the exact segment | Engineer + owner |
| Named restore point not present in the archived chain | Stop. Confirm the restore point was created after the base backup, that `pg_switch_wal()` archived its segment, and that the chain from the base stop location is contiguous. Do not fall back to a raw LSN or to "latest" | Engineer |
| Restore point older than the chosen base backup | Refuse the drill. Take a base backup whose stop location precedes the target, or create a new restore point after the backup completes; never force the target forward | Engineer + owner |
| Restored timeline differs from the pinned timeline | Treat as a failed drill. Recovery must not promote along an implied timeline; investigate history files and archive naming | Engineer + owner |
| Complete-row digest mismatch with equal counts | Investigate the divergent rows (lease, error, event identity, provenance, timestamps). A count-only check would have passed; record the miss and re-run with the full matrix | Engineer |
| Whole-table `string_agg` hits memory or the 1 GB limit | Use the streamed per-row digest pipeline; the aggregate form is a small-dataset convenience only | Engineer |
| Restored path or tablespace escapes the isolated root | Quarantine the target. Do not start it. Treat as an isolation failure and investigate the backup's `tablespace_map`/symlinks | Engineer + owner |
| Restored cluster publishes to the source archive | Stop immediately, fence, and treat as an incident; verify `archive_mode`/`archive_command` replacement before any further start | Owner |
| Encryption key unavailable | Stop. No plaintext fallback. Use approved escrow/break-glass; record as an incident | Owner |
| Reconciliation mismatch | Do not promote into use. Keep evidence, quarantine, investigate the earliest divergent transaction | Engineer + owner |
| Snapshot captured before the fence, or writers found running | Discard the baseline, re-fence, re-capture. Never compare a fenced restore to an unfenced observation | Engineer |
| Recovery time exceeds the window | Stop at the pre-agreed point, fence, record measured elapsed time and cause. Do not extend silently | Owner |
| Retention would delete the last verified restore point | Refuse; add a new verified point first | Engineer |
| Application accidentally pointed at the restore | Stop it immediately, fence the target, record the exposure as an incident | Owner |

## 12. Owner acceptance (blank by design)

Engineering acceptance of this draft revision is not owner acceptance, and neither implies a drill occurred. Only the owner may complete this block, only after an actual drill with recorded evidence.

```text
Drill performed:        [ ] NOT PERFORMED
Source system id:       ______________________________________________
Restore point name:     ______________________________________________
Restore point LSN:      ______________________________________________
Pinned timeline id:     ______________________________________________
Required segment(s):    ______________________________________________
Base start/stop WAL:    ______________________________________________
Base label/manifest:    ______________________________________________
Restore root/paths:     ______________________________________________
Elapsed (per step):     ______________________________________________
Artifacts/digests:      ______________________________________________
Anomalies recorded:     ______________________________________________
Owner name:             ______________________________________________
Owner date (UTC):       ______________________________________________
Owner signature:        ______________________________________________
Decision:               [ ] ACCEPT   [ ] REJECT   [ ] REPEAT
```

Until this block is completed, every downstream document must describe off-host recovery as **unverified**, including `contracts/runtime-hosting-v1.json` (`offHostRecoveryVerified: false`) and the ADR01 retirement gate **[OBSERVED]**.

## 13. Explicit non-claims

- No backup has been taken, no WAL has been archived, no restore has been performed, no drill has been signed. **[NOT PERFORMED]**
- No off-host destination, RPO, RTO, retention period, capacity bound or key-custody arrangement is approved. The plain-format/SHA256 choice in §5 is a draft engineering preference, not infrastructure or retention approval.
- Every wrapper, restorer, scheduler, exporter and alert route described here is an interface, not a working implementation.
- No availability, durability or recovery-time guarantee is made. Elapsed time becomes a measurement only after §8 runs.
- No Private control-table mapping is approved: this draft covers the Cloud profile and records Private packaging as a blocking gap for its own reviewed manifest.
- No checked-in comparator exists. A comparison performed with the §10.4 template is manual, and two matching digests produced without its completion checks are not recovery evidence.
- PostgreSQL remains a target, not the production store. RLS coverage (PIVOT-004), posted-source immutability (PIVOT-005), audit triggers (PIVOT-006), the posting kernel port (PIVOT-013), parity (PIVOT-009/010) and verification evidence (PIVOT-012) are separate gates; this runbook substitutes for none of them.
- A backup of an unservable skeleton proves the mechanism, not production readiness.
- Example commands and SQL in this document are illustrative and unexecuted. They are not evidence and must be reviewed against the pinned server version before use.

## 14. Change control

- Owner: the engineer. Contractors may execute an approved revision but do not redefine retention, keys, RPO/RTO or the signature block.
- Every executed drill appends its record with commands, digests, timings, principals and anomalies. Prior drill records are never rewritten.
- Any change to destination, encryption tooling, key custody, retention, archive naming/publish semantics or the recovery procedure requires a new dated revision and an owner re-drill before it is relied upon.
- Unresolved policy/destination/key inputs stay `[MISSING]`; they are extension points, not defaults.

## 15. References

- `docs/pivot-notes/01-adr-postgresql-pivot.md` — retirement gate, restore isolation, no dual-write authority.
- `docs/pivot-notes/00-pivot-spec.md` Phase 6 — backup/restore requirements and the owner-only drill signature.
- `docs/49-compatible-tenant-upgrades.md` — backup capacity, independent restore verification, fenced generations, no second writable copy.
- `docs/pivot-notes/02-three-purposes.md` — schema/table inventory used by §10.
- `docs/44-server-hosted-runtime.md`, `contracts/runtime-hosting-v1.json` — loopback-only, tunnel-only Cloudflare, `offHostRecoveryVerified: false`.
- `db/postgres/00-roles.sql`, `05-auth-schema.sql`, `10-operator-schema.sql`, `20-tenant-schema.sql`, `migrations/006-auth-schema-corrections.sql`, `migrations/021-tenant-schema-corrections.sql` — roles and schema referenced above (corrections accepted on their branches, not integrated here).
- `scripts/native-backup.mjs`, `scripts/native-restore.mjs`, `deployment/saven-native-backup.service`, `deployment/saven-testing-backup.service` — existing SQLite backup/restore pattern this document does not replace.
- PostgreSQL 18 documentation, verified against the pinned server version before execution:
  - recovery configuration and the `recovery.signal` requirement: <https://www.postgresql.org/docs/18/runtime-config-wal.html#RUNTIME-CONFIG-WAL-ARCHIVE-RECOVERY>
  - recovery target name/timeline semantics (`recovery_target_name`, `recovery_target_timeline`): <https://www.postgresql.org/docs/18/runtime-config-wal.html#RUNTIME-CONFIG-WAL-RECOVERY-TARGET>
  - `pg_create_restore_point()` and WAL/restore-point administration functions: <https://www.postgresql.org/docs/18/functions-admin.html#FUNCTIONS-ADMIN-BACKUP>
  - continuous archiving, `restore_command` and PITR caveats (source-path and tablespace risk): <https://www.postgresql.org/docs/18/continuous-archiving.html>
  - continuous archiving and WAL retention guidance (content comparison and retry success): <https://www.postgresql.org/docs/18/continuous-archiving.html#BACKUP-ARCHIVING-WAL>
  - `pg_basebackup` manifest and format options: <https://www.postgresql.org/docs/18/app-pgbasebackup.html#APP-PGBASEBACKUP-OPTIONS>
  - `pg_verifybackup` (`--no-parse-wal` limitation for tar format): <https://www.postgresql.org/docs/18/app-pgverifybackup.html>
  - `pg_checksums` (offline checksum changes): <https://www.postgresql.org/docs/18/app-pgchecksums.html>
