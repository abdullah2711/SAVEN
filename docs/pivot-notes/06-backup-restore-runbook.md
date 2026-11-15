# PostgreSQL backup, WAL archive and restore recovery runbook

Status: **DRAFT — UNSIGNED — DRILL NOT PERFORMED**

Contract: PIVOT-011. Author: engineer-authored draft relayed to the contractor; the contractor executed only the writing of this file. Date drafted: 15 November 2026 (Asia/Karachi).

This document is a proposed operating procedure for the `db/postgres` target. It is not evidence that any backup, archive, restore or drill has happened. No owner signature has been given, and none may be written by anyone except the owner. Read the marker legend before treating any statement here as approved.

| Marker | Meaning |
| --- | --- |
| **[OBSERVED]** | Checked directly in this repository at the stated commit. Not a live-server check. |
| **[PROPOSED — NOT APPROVED]** | A recommended value, path, schedule or tool. It is a draft for owner review, not an authorization. |
| **[MISSING]** | Unknown and required before operational use. It must be supplied by the owner or measured; it may not be invented, guessed or back-filled. |
| **[NOT PERFORMED]** | A required test or drill that has not happened. Never convert this marker into a pass without independent evidence and the owner's signature. |

Hard boundaries that this runbook may not relax:

1. SQLite remains the production database until the owner satisfies the retirement gate in `docs/pivot-notes/01-adr-postgresql-pivot.md`. Nothing here authorizes cutover, data migration or a production restore.
2. PostgreSQL binds to loopback only. No inbound port is opened for it; Cloudflare Tunnel carries only the application's HTTP/S endpoint. **[OBSERVED]** in `AGENTS.md`, `docs/44-server-hosted-runtime.md` and the PIVOT role instructions.
3. A restored snapshot is never a second writable live copy. Restores go to a new, isolated, fenced target and stay read-only evidence unless a separate, reconciled recovery decision authorizes otherwise. **[OBSERVED]** in ADR01 and `docs/49-compatible-tenant-upgrades.md`.
4. Accepted live transactions are never overwritten by a restore. Prefer forward repair after new-format writes; an older snapshot cannot safely undo accepted work.
5. No credential, connection string, encryption key or client data is ever committed, pasted into a ticket or stored in this file. The SQL under `db/postgres/` is credential-free. **[OBSERVED]**.
6. No role gets `BYPASSRLS` or superuser for backup or restore convenience. Backup and restore use dedicated, narrowly granted roles.

## 1. Scope

Covered: the proposed shared PostgreSQL target described by `db/postgres/00-roles.sql`, `05-auth-schema.sql` (AUTH-001, separate branch), `10-operator-schema.sql` and `20-tenant-schema.sql` (PIVOT-003) — that is, one cluster holding `operator`, `auth` and `tenant_data` in the Cloud profile.

Not covered by this draft:

- The retained schema-13 PostgreSQL reference installation on loopback `8788` used by `saventesting` **[OBSERVED in docs/44]**. It keeps its existing backup arrangements and is not a dependency of the approved `.cc` runtime.
- Native SQLite stores and tenant files. Their stopped-application, verified-backup and independent-restore procedure remains `scripts/native-backup.mjs` / `scripts/native-restore.mjs` with `deployment/saven-native-backup.service` and `deployment/saven-testing-backup.service` **[OBSERVED]**.
- Fully Private packaging. A Private installation needs its own frozen copy of this runbook with local key custody and no vendor dependency.
- Production data migration and cutover, which require separate contracts and explicit owner authorization.

## 2. Required inputs before this runbook may be operated

None of the following is approved today. Each row is a blocking input, not a formality.

| Input | Status | Notes |
| --- | --- | --- |
| Off-server archive destination (host/storage class, region, transport) | **[MISSING]** | Must be off the database server. A second directory on the same disk, host or volume is not a backup. No destination is named here because none is approved. |
| Independent off-server copy of base backups | **[MISSING]** | Base backups must also leave the server and be verified at the destination, not only at the source. |
| Recovery point objective (RPO) | **[MISSING]** | Determines archive frequency, `archive_timeout` and tolerated WAL loss. Not measurable until a drill runs. |
| Recovery time objective (RTO) | **[MISSING]** | Must be measured during a drill, not promised. No availability SLA is claimed anywhere in this repository. |
| Retention policy (base, WAL, off-site copies, legal/accounting retention) | **[MISSING]** | Retention is also constrained by the owner's accounting-record obligations, which are not established for this target. |
| Encryption tooling and key custody/escrow | **[MISSING]** | Required decision: tool (age/gpg/openssl/LUKS-style volume), key holder, escrow, rotation and break-glass. Key loss means total loss of the backup. |
| Backup storage capacity and growth assumption | **[MISSING]** | Needs measured base size, daily WAL volume and tenant growth. Must be a preflight condition, not discovered during an incident. |
| Named application unit(s) that may be stopped in a drill | **[MISSING]** | Only the named test application may be stopped. `app.economicsystems.cc` native production must never be stopped for a PostgreSQL drill. |
| Restore host, directory, port and operator identity | **[PROPOSED — NOT APPROVED]** | Placeholders below. Must be a loopback-only, disposable target distinct from the source cluster. |
| Maintenance window and notification | **[MISSING]** | Any drill that stops the test app needs an owner-approved window. |
| Owner drill date, elapsed time, signature | **[MISSING]** | Blank by design. See §12. |

## 3. Target cluster facts and naming proposals

| Item | Value |
| --- | --- |
| Engine | PostgreSQL 18 is the schema target version used by the accepted contracts and CI service. **[OBSERVED]** |
| Schemas | `operator` (Purpose A), `auth` (shared identity, AUTH-001), `tenant_data` (Purpose B/C, PIVOT-003). |
| Connection surface | Loopback only: `127.0.0.1` and/or a local Unix socket, on a port recorded in the drill record. No public listener. **[OBSERVED policy]** |
| Roles | `saven_migrator` owns DDL; runtime roles are `saven_customer_app`, `saven_auth_service`, `saven_operator_read`, `saven_operator_admin`; non-login definer owners `saven_operator_definer`, `saven_auth_definer`. All `NOLOGIN`/no superuser/no `BYPASSRLS`. **[OBSERVED in 00-roles.sql]** |
| Migration ledgers | `operator.pg_schema_migrations` (PostgreSQL migrations) and `operator.source_store_migrations` / `tenant_data.source_store_migrations` (imported native provenance). **[OBSERVED]** |
| Proposed cluster name | `saven-pg` **[PROPOSED — NOT APPROVED]** |
| Proposed data directory | `/var/lib/postgresql/18/saven-pg` **[PROPOSED — NOT APPROVED]** |
| Proposed local archive staging | `/var/backups/saven-pg/wal-staging` **[PROPOSED — NOT APPROVED]** — staging only, never the retention location |
| Proposed base backup staging | `/var/backups/saven-pg/base` **[PROPOSED — NOT APPROVED]** — staging only |
| Proposed restore root | `/var/lib/postgresql/18/saven-pg-restore-<YYYYMMDDTHHMMSSZ>` **[PROPOSED — NOT APPROVED]** |
| Proposed restore port | A dedicated loopback port distinct from the source cluster **[PROPOSED — NOT APPROVED]** |
| Backup role | A dedicated, non-login-hosted replication principal limited to `REPLICATION`, created by the owner out of band; membership in `saven_migrator` and the definer roles is withheld. **[PROPOSED — NOT APPROVED]** |

The backup path must never be inside the data directory, and the restore path must never equal the source data directory. The procedure below refuses on those conditions rather than "fixing" them silently.

## 4. Required server configuration

Templates only. Values marked proposed are drafts. Configuration is applied by the owner's server administration process, not by this repository.

```conf
# postgresql.conf — backup/archive block (template; no secrets, no real DSNs)
wal_level = replica                  # required for WAL archiving and PITR
archive_mode = on                    # required [OBSERVED invariant PIVOT-011]
archive_command = '<SAVEN_WAL_ARCHIVER> %p %f'   # wrapper below; placeholders only
archive_timeout = 300                # [PROPOSED] bound WAL switch latency; review for RPO
wal_compression = on                 # [PROPOSED] reduces archive bytes
full_page_writes = on                # default; do not disable
max_wal_senders = 3                  # [PROPOSED] base backups + headroom
wal_keep_size = 0                    # archiving, not replication slots, is the recovery source
data_checksums = on                  # [PROPOSED] set at initdb time, cannot be changed later
```

Rules for `archive_command`:

- It must write to a temporary name and rename into place, so a partially transferred file can never look like a valid archived WAL.
- It must exit non-zero on any transfer, encryption or checksum failure, so PostgreSQL keeps the segment in `pg_wal` and retries.
- It must be idempotent: re-archiving the same `%f` must not corrupt an existing archived copy.
- It must never read a credential from the repository, the environment of a web process, or an argument visible in process listings. Keys live in a root-owned file readable only by the archive principal.
- Failure is visible: `archive_command` failure is a page-out condition (§9), because `pg_wal` grows until archiving recovers.

Wrapper template (`<SAVEN_WAL_ARCHIVER>`; the wrapper itself is **not** part of PIVOT-011 and must not be added under this contract):

```sh
#!/bin/sh
# Template only. Placeholders must be replaced by the owner's server administration.
# $1 = path to the WAL segment, $2 = segment file name
set -eu
umask 077
staging="${SAVEN_WAL_STAGING:?}"          # local staging, not the retention location
keyfile="${SAVEN_WAL_KEY_FILE:?}"         # root-owned, mode 0600, outside the repository
test -f "$keyfile"
mkdir -p "$staging"
tmp="$staging/.$2.part"
# Encrypt while streaming; never leave plaintext WAL on shared or off-host storage.
"${SAVEN_ENCRYPT_TOOL:?}" --encrypt --recipient-file "$keyfile" \
  < "$1" > "$tmp"
test -s "$tmp"
# Ship the encrypted object off-server, verify the remote digest, then publish.
"${SAVEN_OFFSITE_PUT:?}" "$tmp" "<OFFHOST-WAL-PREFIX>/$2.enc"
"${SAVEN_OFFSITE_VERIFY:?}" "<OFFHOST-WAL-PREFIX>/$2.enc" "$(sha256sum "$tmp" | cut -d' ' -f1)"
mv "$tmp" "$staging/$2.enc"
exit 0
```

`<OFFHOST-WAL-PREFIX>`, `SAVEN_ENCRYPT_TOOL`, `SAVEN_OFFSITE_PUT` and `SAVEN_OFFSITE_VERIFY` are **[MISSING]** decisions (§2). Until they exist, `archive_mode` must not be enabled on any cluster that holds more than disposable test data, because an enabled-but-failing archive silently retains WAL in `pg_wal`.

Connection surface: keep `listen_addresses = 'localhost'`, keep `pg_hba.conf` restricted to local socket peer authentication for administrative principals and loopback for the dedicated backup/restore principal, and document each line. Never add a `0.0.0.0` entry, a trust rule for a remote subnet, or a superuser login for backup tooling.

## 5. Base backup procedure

Base backups are taken with `pg_basebackup` plus streamed WAL, so each base backup is self-consistent and its WAL does not depend on the archive being current.

```sh
# Template. Run as the dedicated backup principal, on the database server, loopback only.
# Replace <...> placeholders from the drill/operation record; never inline a password.
export PGHOST=127.0.0.1
export PGPORT=<LOOPBACK-PORT>
export PGUSER=<BACKUP-PRINCIPAL>
export PGPASSFILE=<ROOT-OWNED-PASSFILE>     # mode 0600; never committed, never in argv
label="base-$(date -u +%Y%m%dT%H%M%SZ)"
target="${SAVEN_BASE_STAGING:?}/$label"

pg_basebackup \
  --pgdata="$target" \
  --format=tar --gzip \
  --wal-method=stream \
  --checkpoint=fast \
  --label="$label" \
  --progress --verbose

# Verify the backup with the engine's own verifier before encryption or shipping.
pg_verifybackup "$target"
```

Then, in the same operation:

1. Hash every produced file and record the manifest next to the backup:
   `find "$target" -type f -print0 | sort -z | xargs -0 sha256sum > "$target.sha256"`.
2. Encrypt the archive set with the approved tool and key (§2). Never ship plaintext.
3. Ship off-server, verify the remote digest, then record the off-site manifest digest in the backup register.
4. Confirm the local staging copy is not the only copy, then apply retention **after** the off-site copy is verified. Deleting the last good off-site copy is a page-out condition.
5. Re-verify restore of the new base backup at least once per retention window (§8 verification test). A backup that has never been restored is an unverified assumption.

Scheduling proposal: one daily base backup plus continuous WAL archiving; keep at least one verified restore point per retention window. Times, retention counts and the off-site schedule are **[PROPOSED — NOT APPROVED]** and must not be described as a service level.

Volume and capacity preflight: record base backup size, WAL generated per day, archive throughput and projected retention footprint; require free space above the retention total plus one full restore of the largest expected database. **[NOT PERFORMED]**

## 6. Restore and point-in-time recovery procedure

Objective: prove that a chosen recovery point can be restored into an **isolated** target and reconciled against an independently captured pre-drill snapshot, without touching live accepted transactions.

Rules enforced throughout:

- Restore to a **new** data directory that does not exist yet. The procedure refuses if the target exists or equals the source data directory.
- The restore cluster listens on loopback only, on a port distinct from the source.
- The restore cluster is fenced for verification: no application is pointed at it, no write traffic is allowed, no publication of its port beyond loopback.
- If verification fails, the restore is quarantined and kept for evidence. It is never "repaired" into a writable live copy.

### Step 0 — Capture the pre-drill snapshot (source cluster, read-only)

Run as a read-only principal and store the output with the drill record. The queries in §10 are the reconciliation baseline. Record, at minimum: per-tenant trial balance, document-number high-water marks, command/approval/outbox state counts, audit counts and row-hash, subledger control totals, migration-ledger rows and checksums, and the current WAL LSN and timeline.

```sql
-- Template; read-only.
SELECT pg_current_wal_lsn() AS source_lsn, timeline_id FROM pg_control_checkpoint();
SELECT * FROM pg_stat_archiver;
```

### Step 1 — Declare maintenance and fence writers

1. Confirm the drill window and the named test application from the operation record. Stop **only** that named unit. Never stop native production (`app.economicsystems.cc`).
2. Verify no remaining application sessions or writers:

```sql
SELECT pid, usename, application_name, state, backend_xmin
FROM pg_stat_activity
WHERE datname IS NOT NULL AND pid <> pg_backend_pid();
```

3. Record why any session is still connected. Do not terminate sessions blindly; an owned session may be mid-transaction.
4. Force a WAL switch so the drill has a deterministic recovery point, then record it:

```sql
SELECT pg_switch_wal();
SELECT pg_current_wal_lsn();
```

5. Note the archived segment for that LSN (`pg_stat_archiver.last_archived_wal`) and confirm it is present off-server. A restore must never depend on a segment that only exists in `pg_wal`.

### Step 2 — Prepare the isolated target

```sh
export SAVEN_SOURCE_PGDATA=<SOURCE-DATA-DIR>          # never the restore target
export SAVEN_RESTORE_ROOT=<RESTORE-ROOT>
ts="$(date -u +%Y%m%dT%H%M%SZ)"
target="$SAVEN_RESTORE_ROOT/$ts"
test ! -e "$target"                                   # must not exist
test "$(readlink -f "$target")" != "$(readlink -f "$SAVEN_SOURCE_PGDATA")"
mkdir -p "$target" && chmod 0700 "$target"
```

### Step 3 — Fetch, decrypt and verify the chosen base backup

1. Retrieve the base archive from the **off-site** copy, not from the source server's staging area.
2. Verify its recorded digest against the manifest before decrypting.
3. Decrypt into the isolated target with the approved key (§2). Key handling is the highest-risk step: a lost or escrowed-wrong key stops the drill with no workaround.
4. Verify again after extraction with `pg_verifybackup` or an equivalent manifest check.

### Step 4 — Configure recovery to the recorded point

```conf
# postgresql.auto.conf / recovery settings in the restored data directory (template)
restore_command = '<SAVEN_WAL_RESTORER> %f %p'      # decrypt from the off-site archive to stdout
recovery_target_lsn = '<RECORDED-LSN>'             # or recovery_target_time / recovery_target_xid
recovery_target_action = 'promote'
```

Rules: use exactly one recovery-target kind; record which one and why. The restorer must fail loudly when a requested segment is absent — never substitute a different segment, and never treat "closest available" as success.

### Step 5 — Start the isolated cluster and confirm recovery completed

```sh
pg_ctl -D "$target" -o "-p <ISOLATED-PORT> -c listen_addresses=127.0.0.1" -l "$target/startup.log" start
```

```sql
SELECT pg_is_in_recovery();                    -- must be false after promotion
SELECT timeline_id FROM pg_control_checkpoint();
SELECT pg_last_wal_replay_lsn(), pg_last_xact_replay_timestamp();
```

If recovery stops early, or the log shows a missing WAL segment, stop and classify it as a WAL gap (§11). Do not patch around it.

### Step 6 — Reconcile against the pre-drill snapshot

Run the §10 checks against the isolated target. Every result must match the baseline captured in Step 0 within the expected recovery boundary. Any unexplained difference is a **failed drill**, even if the database opens cleanly.

### Step 7 — Record measured elapsed time

Record wall-clock start and end for each step and the total. Elapsed time is measured, never estimated, and never converted into an SLA. **[NOT PERFORMED]**

### Step 8 — Fence and retire the restore target

1. Stop the isolated cluster.
2. Keep the restored directory and logs as evidence until the owner accepts or rejects the drill.
3. Do not point any application at it, do not promote it into the source path, and do not leave its port reachable after the drill.
4. Delete only after the drill record and evidence are archived and the owner's decision is recorded.

## 7. What "recovery succeeded" means

All of the following, together, not any one of them:

- The cluster reached the recorded recovery point and promoted, with no WAL gap and no manual segment substitution.
- Row counts and content hashes of authoritative tables match the pre-drill snapshot for every tenant.
- The general ledger is balanced per tenant and per company, and the trial balance matches the snapshot exactly.
- Document numbers, sequences and their high-water marks match; no number was renumbered, reused or rolled back.
- Audit rows are intact and append-only in count and hash; no audit row was rewritten, and no historical actor value was invented.
- Idempotency receipts, accepted commands, approval decisions, pending documents and outbox state match the snapshot; replay of a restored command cannot double-post.
- Subledger controls reconcile: receivable/payable, stock quantity and valuation, asset schedules, tax/withholding controls.
- Authority state is intact: exactly one protected ultimate-owner role definition and one ultimate-owner assignment per subscribed business; no role gained protected authority.
- RLS negative isolation still holds where RLS exists (after PIVOT-004). Before PIVOT-004 the isolation check is **not applicable** and must be declared as such, not reported as a pass.
- Measured elapsed time, the exact commands used, artifact digests and anomalies are recorded.

## 8. Required verification tests (all currently NOT PERFORMED)

These are the tests that make the runbook real. None has been executed. Each requires a disposable or test cluster, an approved off-site destination and an approved key.

| # | Test | Method | Pass condition | Status |
| --- | --- | --- | --- | --- |
| V1 | Base backup + restore at quiescence | Take a base backup, restore into an isolated target, reconcile | §7 checks pass; elapsed recorded | **[NOT PERFORMED]** |
| V2 | Point-in-time recovery to a mid-workload LSN | Apply known postings, record LSN, restore to it | Restored state equals the snapshot at that LSN; later transactions absent | **[NOT PERFORMED]** |
| V3 | WAL gap detection | Remove one archived segment from a copy of the archive and attempt recovery | Restore fails closed with an explicit missing-segment error; no silent fallback | **[NOT PERFORMED]** |
| V4 | Archive failure behaviour | Make the archive destination unwritable | `archive_command` exits non-zero, `pg_wal` retains segments, alert fires, archiver recovers after restore of the destination | **[NOT PERFORMED]** |
| V5 | Key-loss behaviour | Attempt restore without the key, then with a wrong key | Fails closed; no plaintext fallback; keys are recoverable only via approved escrow | **[NOT PERFORMED]** |
| V6 | Capacity and retention | Project and then exercise base + WAL retention; fill the staging volume | Preflight threshold alerts before exhaustion; retention never deletes the last verified restore point | **[NOT PERFORMED]** |
| V7 | Off-site independence | Back up from the workspace, restore from the off-site copy after removing local artifacts | Restore succeeds from off-site alone | **[NOT PERFORMED]** |
| V8 | Encryption at rest in transit | Inspect archived objects and staging paths | No plaintext WAL or base files leave the server; staged files are encrypted or removed | **[NOT PERFORMED]** |
| V9 | Concurrent-writer refusal | Attempt a restore while the source accepts writes | Procedure refuses or the drill is fenced first; no overwrite of accepted transactions | **[NOT PERFORMED]** |
| V10 | Repeatability | Run V1 twice in the same week | Both restores reconcile; elapsed time is stable and recorded | **[NOT PERFORMED]** |

## 9. Monitoring and page-out conditions

Archive and backup health must be observable without reading the server's disk by hand. Page the owner (or the named on-call) when:

- `pg_stat_archiver.last_failed_wal` advances, or `last_failed_time` is newer than `last_archived_time`.
- Archived WAL lag exceeds the recovery-point budget derived from the approved RPO **[MISSING]**.
- `pg_wal` size grows beyond its planned bound, or the filesystem holding `pg_wal`, staging or the restore root crosses its capacity threshold.
- The most recent base backup is older than the approved retention schedule, or its off-site digest cannot be verified.
- A scheduled restore verification (§8 V1/V10) fails or is skipped.

The monitoring itself is **[MISSING]**: no source file, timer, exporter or alert route exists in this repository for the PostgreSQL target. Only the native SQLite backup units exist today **[OBSERVED]**.

## 10. Reconciliation queries

All queries are read-only and schema-qualified. Expected results are stated; any deviation is a failed reconciliation. `$1` is a tenant UUID.

```sql
-- 10.1 Every posted journal is balanced. Expect zero rows.
SELECT tenant_id, journal_id, sum(debit) AS debit, sum(credit) AS credit
FROM tenant_data.journal_lines
GROUP BY tenant_id, journal_id
HAVING sum(debit) <> sum(credit);

-- 10.2 Trial balance per tenant/company/account. Compare with the baseline snapshot.
SELECT l.tenant_id, j.company, l.account, sum(l.debit) AS debit, sum(l.credit) AS credit
FROM tenant_data.journal_lines l
JOIN tenant_data.journals j ON j.tenant_id = l.tenant_id AND j.id = l.journal_id
GROUP BY l.tenant_id, j.company, l.account
ORDER BY l.tenant_id, j.company, l.account;

-- 10.3 Document-number high-water must agree with the allocation table.
SELECT n.tenant_id, n.company, n.kind, max(n.sequence) AS highest_allocated
FROM tenant_data.document_numbers n
GROUP BY n.tenant_id, n.company, n.kind
ORDER BY n.tenant_id, n.company, n.kind;

SELECT s.tenant_id, s.company, s.kind, s.next_number - 1 AS highest_allocated
FROM tenant_data.document_sequences s
ORDER BY s.tenant_id, s.company, s.kind;

-- 10.4 Duplicate document numbers must not exist. Expect zero rows.
SELECT tenant_id, company, number, count(*)
FROM tenant_data.document_numbers
GROUP BY tenant_id, company, number
HAVING count(*) > 1;

-- 10.5 Command, approval, pending-document and outbox state census.
SELECT tenant_id, state, count(*) FROM tenant_data.command_inbox GROUP BY tenant_id, state ORDER BY 1, 2;
SELECT tenant_id, state, count(*) FROM tenant_data.approval_requests GROUP BY tenant_id, state ORDER BY 1, 2;
SELECT tenant_id, document_status, origin_type, count(*)
FROM tenant_data.document_registry GROUP BY tenant_id, document_status, origin_type ORDER BY 1, 2, 3;
SELECT tenant_id, state, count(*) FROM tenant_data.outbox GROUP BY tenant_id, state ORDER BY 1, 2;

-- 10.6 Audit append-only census. Counts and a stable row hash must equal the snapshot.
SELECT tenant_id, count(*) AS rows FROM tenant_data.audit GROUP BY tenant_id ORDER BY 1;
SELECT tenant_id, count(*) AS rows FROM tenant_data.audit_event GROUP BY tenant_id ORDER BY 1;
SELECT tenant_id, md5(string_agg(id::text || ':' || event || ':' || happened_at::text, '|' ORDER BY id)) AS digest
FROM tenant_data.audit GROUP BY tenant_id ORDER BY 1;

-- 10.7 Corrections are one-per-original and never duplicated. Expect zero rows.
SELECT tenant_id, original_id, count(*)
FROM tenant_data.journal_corrections GROUP BY tenant_id, original_id HAVING count(*) > 1;

-- 10.8 Trade document totals reconcile with their lines and allocations.
SELECT d.tenant_id, d.command_id, d.total, coalesce(sum(l.amount), 0) AS lines_total
FROM tenant_data.trade_documents d
LEFT JOIN tenant_data.trade_lines l ON l.tenant_id = d.tenant_id AND l.command_id = d.command_id
GROUP BY d.tenant_id, d.command_id, d.total
HAVING d.total <> coalesce(sum(l.amount), 0);

-- 10.9 Stock balances reconcile with movement history.
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

-- 10.10 Authority state: one protected owner role and one owner assignment per tenant.
SELECT tenant_id, count(*) FROM tenant_data.roles WHERE protected GROUP BY tenant_id HAVING count(*) <> 1;
SELECT tenant_id, count(*) FROM tenant_data.assignments
WHERE role_id = 'ultimate_business_admin' GROUP BY tenant_id HAVING count(*) <> 1;

-- 10.11 Migration provenance is unchanged.
SELECT * FROM operator.pg_schema_migrations ORDER BY version;
SELECT tenant_id, source_store, version, checksum FROM tenant_data.source_store_migrations ORDER BY 1, 2, 3;
```

RLS negative isolation (only meaningful after PIVOT-004; declare "not applicable" before it):

```sql
BEGIN;
SELECT set_config('app.current_tenant_id', '00000000-0000-4000-8000-000000000001', true);
SELECT count(*) FROM tenant_data.accounts;   -- must be 0 for a foreign tenant / missing context
ROLLBACK;
```

## 11. Failure handling and decisions

| Situation | Required action | Decision owner |
| --- | --- | --- |
| Archive destination unavailable or `archive_command` failing | Page out, keep WAL on disk, restore archive capability, re-verify archived segments; do not disable `archive_mode` to silence growth | Owner/on-call |
| Missing WAL segment during recovery | Stop. Classify gap vs intentional timeline switch vs deleted archive. Do not substitute segments. Record the exact segment name | Engineer + owner |
| Encryption key unavailable | Stop. No plaintext fallback. Use approved escrow/break-glass; record as an incident | Owner |
| Restore verification mismatch (any §10 check) | Do not promote or use the restore. Keep evidence, quarantine the target, investigate the earliest divergent transaction | Engineer + owner |
| Recovery time exceeds the window | Stop the drill at the pre-agreed point, fence, record measured elapsed time and the cause. Do not extend a window silently | Owner |
| Source cluster accepting writes during a drill attempt | Abort the drill. Never overwrite accepted live transactions | Engineer |
| Restore target accidentally pointed at by an application | Stop the application immediately, fence the target, treat it as an incident, record the exposure | Owner |
| Retention would delete the last verified restore point | Refuse. Add a new verified point first | Engineer |

## 12. Owner acceptance (blank by design)

This block must not be filled in by anyone except the owner, and only after an actual drill with recorded evidence.

```text
Drill performed:        [ ] NOT PERFORMED
Recovery point used:    ______________________________________________
Target host/dir/port:   ______________________________________________
Artifact digests:       ______________________________________________
Measured elapsed time:  ______________________________________________
Anomalies recorded:     ______________________________________________
Owner name:             ______________________________________________
Owner date (UTC):       ______________________________________________
Owner signature:        ______________________________________________
Decision:               [ ] ACCEPT   [ ] REJECT   [ ] REPEAT
```

Until this block is completed, every downstream document must describe off-host recovery as **unverified** — including `contracts/runtime-hosting-v1.json` (`offHostRecoveryVerified: false`) and the retirement gate in ADR01 **[OBSERVED]**.

## 13. Explicit non-claims

- No backup has been taken, no WAL has been archived, no restore has been performed and no drill has been signed. **[NOT PERFORMED]**
- No off-host destination, RPO, RTO, retention period, capacity bound or key-custody arrangement is approved.
- No availability, durability or recovery-time guarantee is made. Elapsed time becomes a measurement only after §8 runs.
- PostgreSQL remains a target, not the production store. Partial parity, RLS coverage (PIVOT-004), posted-source immutability (PIVOT-005), audit triggers (PIVOT-006) and the posting kernel port (PIVOT-013) are separate gates, and this runbook does not substitute for any of them.
- The schema is not safe to serve before RLS and tenant context exist; a backup of an unservable skeleton proves the mechanism, not production readiness.

## 14. Change control

- Owner: the engineer. Contractors may execute an approved revision but do not redefine retention, keys, RPO/RTO or the signature block.
- Every executed drill appends its record here or in a linked evidence file, with commands, digests, timings and anomalies. Do not rewrite prior drill records.
- Any change to the archive destination, encryption tooling, key custody, retention or recovery procedure requires a new dated revision and an owner re-drill before it is relied upon.
- This runbook must not be described as accepted until the owner signs §12.

## References

- `docs/pivot-notes/01-adr-postgresql-pivot.md` — retirement gate, restore-isolation and no-dual-write invariants.
- `docs/pivot-notes/00-pivot-spec.md` Phase 6 — backup/restore requirements and the owner-only drill signature.
- `docs/49-compatible-tenant-upgrades.md` — backup capacity, independent restore verification, fenced generations.
- `docs/pivot-notes/02-three-purposes.md` — schema/table inventory used by §10.
- `docs/44-server-hosted-runtime.md`, `contracts/runtime-hosting-v1.json` — loopback-only, tunnel-only Cloudflare and `offHostRecoveryVerified: false`.
- `db/postgres/00-roles.sql`, `10-operator-schema.sql`, `20-tenant-schema.sql` — role, operator and tenant schema definitions referenced above.
- `scripts/native-backup.mjs`, `scripts/native-restore.mjs`, `deployment/saven-native-backup.service`, `deployment/saven-testing-backup.service` — existing SQLite backup/restore pattern this document does not replace.
- PostgreSQL 18 documentation for `pg_basebackup`, continuous archiving, `pg_verifybackup`, point-in-time recovery and `pg_stat_archiver`. Verify against the pinned server version before executing; documentation drift is a reason to stop, not to improvise.
