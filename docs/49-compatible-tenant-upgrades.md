# Compatible, recoverable tenant upgrades

Owner requirement: continuously operated businesses, isolated native SQLite files, safe evolution without a fleet-wide stop. Thirty to sixty minutes per month is a proposed availability budget, not a demonstrated SLA. Millions/billions of databases are a capacity aspiration, not supported scale.

## Mandatory design

- Each release declares read/write schema range, command/protocol versions, migration IDs/checksums, feature gates and rollback/forward-repair strategy. Applied migration bytes never change.
- Expand first: additive nullable/default columns and side tables; deploy compatible readers/writers; backfill in bounded idempotent batches with durable per-tenant cursors; validate; switch features; contract only in a later separately reviewed release after all writers/offline clients are compatible. Table rewrites and new constraint scans require measured per-tenant windows.
- A placement has one writable node/generation; fence old writers before changing ownership. A restored snapshot never becomes a second writable live copy. SQLite files/WAL remain on local disk, not network shares.
- Migration execution belongs to a bounded node worker, not an unbounded login/startup sweep. Register a release/cohort, dry-run a restored sample, then canary, pilot, bounded waves. New requests route only to compatible code. Cold tenants can be scheduled/lazily upgraded within a bounded per-file budget; incompatible requests show the affected business state rather than freezing every business.
- Durable per-tenant work states: planned, claimed/lease, backup verified, migrating, backfilling, validating, ready, retryable failure, quarantined. Store release/checksum/generation/attempt/cursor/error, times and reconciliation results. Resume after process loss and deduplicate effects. Pause a wave on configured error/reconciliation thresholds. Quarantine a bad file, never silently recreate or delete it.
- Use the SQLite backup API for WAL-consistent snapshots; verify integrity/foreign keys and business identity independently. Retain originals and coordinated original-object manifests/keys. Space and backup capacity are preflight conditions. Off-host encrypted recovery remains a release gate.
- Verify opening + movements = closing, balanced GL, exact original journal/audit/evidence row preservation, receivable/payable/stock/asset/tax controls and pending/idempotency/outbox states. Hash/index/checksum checks complement, not replace, financial reconciliation.
- Rollback before new-format writes can select the retained compatible application. After new writes, prefer forward repair; restoring an older snapshot would lose accepted transactions and must use a separately reconciled recovery procedure. An older container is not a database rollback.
- Observe per-file lock duration, p95/p99 latency, write refusal window, WAL size/checkpoints, upgrade throughput, oldest pending tenant, failed/quarantined counts, restore time, disk space and remaining monthly outage budget. No global target-time promise before representative load/chaos measurements.

## Current implementation boundary

The current openStore validates historical checksums, rejects newer schemas, applies each migration transactionally and quarantines only the failing tenant. It currently migrates on first open and caches tenant handles without an eviction bound. This is a bounded single-node foundation, not the production fleet scheduler above. The additive accounting lifecycle migration preserves all historical migration bytes. Do not claim full migration fleet, mixed-version writers, billions of files or unattended production CD from this increment.

## Release gates

1. Immutable migration fingerprints; old-data restore comparison; retry/crash/failure isolation; changed checksums and foreign business-file rejection.
2. Explicit mixed-version read/write matrix; active-session/approved-command/evidence/idempotency compatibility; new schema feature hidden until tenant-ready.
3. Durable scheduler/cohorts/leases/backfill cursors/canary pause; bounded connection pool; large-fleet inventory and disk-pressure behavior.
4. Representative financial/stock objects, large tenant and many small tenants under simultaneous reads/writes; actual downtime/throughput/restore measurements.
5. Signed release and reviewed artifact; deploy tested source only; backup and independent restore; health/reconciliation acceptance; controlled main promotion. GitHub is source/CI, not an online transaction service.

References: [SQLite ALTER TABLE](https://www.sqlite.org/lang_altertable.html), [WAL](https://www.sqlite.org/wal.html), [Online Backup API](https://www.sqlite.org/backup.html). A simple ADD COLUMN can be independent of table size; constraint validation/table rewrites can scan or rewrite all rows. WAL allows concurrent readers and one writer per file; it does not create multi-node writer coordination or host-loss recovery.
