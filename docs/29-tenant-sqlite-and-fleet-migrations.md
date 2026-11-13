# Tenant SQLite, reference mapping and fleet migration gates

> Historical v2 target where conflicting. [v2.3](sources/SAVEN-mandate-v2.3.md) now selects native SQLite for all stores, local-first QA, and a private package excluding vendor commercial/issuer services. See [current reconciliation](35-native-sqlite-local-first-v2.3.md).

Preserve PostgreSQL migrations 001–016 and native contracts. The generated PG object inventory records source path/digest and every statically declared table, function, trigger and policy. Dynamic SQL objects require actual database inspection before cutover; a regex inventory is not a complete deployed schema dump.

| PG mechanism | SQLite target | Independent evidence required |
| --- | --- | --- |
| Session-local RLS and SECDEF authority helpers | Gateway assertion plus centralized node policy/query compiler and strict company foreign keys | Raw API IDOR, pooled/node scope, restricted pagination/aggregate/export, revocation |
| Numeric expressions and bigint | Range-checked minor-unit integers/decimal converters | Overflow, quantity/tax/FX rounding, independent fixtures |
| Posting/review/period/stock triggers | Shared local command transaction plus SQLite constraints/triggers | Last-stock race, locked period, forbidden review, exact preview/post equality |
| Allocation/source/depreciation controls | Same canonical module commands and local constraints | Payments advances/refunds, asset controls, source preservation |
| File/evidence helpers and audit/outbox | Tenant metadata atomicity plus staged object protocol | Quarantine, immutable versions, orphan/withdrawal recovery |
| PG backups and restores | SQLite backup API/consistent snapshots plus object/key manifests | Crash, WAL recovery, tenant/node/platform restore and no second writable copy |

Node: local reliable disk, WAL, foreign_keys=ON, synchronous=FULL initially, bounded writer coordination, busy timeout, fair bulk jobs and monitored reader/checkpoint duration. FULL is local durability, not whole-node-loss replication. No zero-RPO claim without independently validated synchronous recovery.

Migration manifest: immutable ID/checksum/signature; engine; from/to schema; compatible app/offline/event versions; prerequisites; expected objects; disk/backup/integrity and financial preflight; additive/backfill/contract/rebuild strategy; resumable cursor; postflight; downtime/failure policy; reviewer/approval. Each database stores its own durable migration ledger and cursor. Fleet status is a report, not proof that the file changed.

Rollout: preflight/verified backup → synthetic canary → internal canary → approved pilot → bounded node/region batches. Serialize each tenant upgrade; quiesce affected writes only; preserve other tenants. Run integrity/foreign-key checks, exact journal/control/subledger/stock/asset counts, evidence hashes and pending/idempotency/audit comparisons. Unknown outcome inspects ledger/state before retry. Contract only after old clients leave the compatibility window.

Before new-format writes, a verified snapshot can support a controlled restore without divergent writes. Afterward prefer forward repair; reverting an image does not reverse data. Node move requires source quiescence, reconciled tail, old-owner fence, atomic generation publication, target checks and preserved read-only source. Uncertain fencing fails closed.

Gate: 1,000 synthetic tenant files over ≥3 node processes, mixed versions, checksum corruption, disk-full rebuild, crash/power loss, stale owner, disconnected client and pause/repair. Report actual p95/p99, throughput, financial preservation, recovery and isolation; none is claimed passed by design documents.
