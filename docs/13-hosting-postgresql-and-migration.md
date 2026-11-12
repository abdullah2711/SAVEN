# SAVEN hosting, PostgreSQL and moving servers

12 November 2026. Owner decision: PostgreSQL is the transaction database. The current server is a temporary testing host. This is an operating runbook, not a claim that the complete MVP or production recovery gate has passed. Verified execution evidence belongs in BUILD_STATE.md.

## Why D1 was used, and the correction

The first implementation used D1 because the testing application was deployed as a Cloudflare Worker, D1 could be bound directly to it, and the same SQLite-compatible command statements could be exercised locally without installing a database server. That activated two narrow financial workflows quickly. It did not implement the agreed PostgreSQL architecture or establish that SQLite was suitable for the full suite. The owner correctly rejected that foundation as the complete MVP.

D1 was an implementation shortcut, not a PostgreSQL service. Its row-security, roles, tooling and SQL behaviour differ. SQLite correctness tests cannot establish PostgreSQL correctness. ADR 010 supersedes D1 as the database target. D1 is retained during controlled cutover for recovery/reference and receives no new writes after the PostgreSQL route is active. The application must never fall back to D1 automatically following a PostgreSQL outage: that would create two diverging books.

## Responsibility split

| Component | Selected location | What we depend on | Portability / failure consequence |
| --- | --- | --- | --- |
| Domain and DNS | Cloudflare | DNS configuration and account access | Recreate DNS at another provider if needed; preserve domain registration access separately |
| Public HTTPS and web assets | Cloudflare Worker | TLS termination, asset delivery, deployment service | The assets are ordinary files; another reverse proxy/static host can serve them |
| API routing | One HTTP Workers VPC Service through the existing esc-server Tunnel | Cloudflare edge, VPC binding, cloudflared, outbound server Internet | Only 127.0.0.1:8788 is routed. No database TCP route or entire-network binding is required. Replace with a conventional HTTPS reverse proxy when leaving Cloudflare |
| Financial rules and permissions | SAVEN Node application container on personal server | Container, tested command code and PostgreSQL connectivity | Same image and API contract can run on another Linux/container host; the present implementation is JavaScript, not the originally recommended Django/React scaffold |
| Accounting records and company data | Separate native PostgreSQL saven_testing database | PostgreSQL process, server disk, power and connectivity | Native PostgreSQL dump/restore; independent of Cloudflare D1 |
| Database authorization | PostgreSQL non-owner saven_app runtime role | Peer authentication on a local Unix socket; RLS policies and control triggers | A remote managed database needs a separate restricted login and verified TLS; never reuse the Linux/root password |
| Background delivery and long jobs | Application worker process, when implemented | Outbox, retry and monitoring code | An outbox row alone does not send mail or perform a job |
| Evidence files | Separate object store adapter, still to be implemented | Versioning, quarantine, scanning and metadata reconciliation | Support S3-compatible storage and an object manifest; file bytes are not included in a PostgreSQL dump |
| AI providers | Provider adapters, still to be connected/evaluated | Credentials, permitted models, budgets and task evaluations | Hosting a database does not supply an AI model or establish reliable extraction |
| Backups and restore verification | Operator responsibility | Scheduled database backup plus separate/off-site storage and restore checks | Cloudflare Tunnel/Workers do not back up this PostgreSQL database |

The API stays beside PostgreSQL initially, using a Unix socket. This avoids distributing database credentials to the edge, opening 5432, or needing Hyperdrive for the selected layout. A direct Worker-to-PostgreSQL design could instead use Hyperdrive plus a TCP VPC Service after testing transaction/pooling behaviour. A DNS name such as db.saven.economicsystems.cc alone does not make PostgreSQL safely or correctly reachable. It is not necessary for the selected private setup.

Workers VPC was documented as a free beta on all Workers plans at inspection. It is a replaceable routing dependency, not a permanent-price or production-SLA guarantee. Do not silently enable paid products. Sources: [Workers VPC configuration](https://developers.cloudflare.com/workers-vpc/configuration/vpc-services/), [binding API](https://developers.cloudflare.com/workers-vpc/api/), [Hyperdrive private database option](https://developers.cloudflare.com/hyperdrive/configuration/connect-to-private-database-vpc/).

## Current personal-server boundaries

The inspected Ubuntu host had about 7.1 GiB total memory, 5.2 GiB available memory and 128 GiB free on the root filesystem. These were observations, not reserved resources or capacity-test results. Existing Nextcloud, ERPNext and Listmonk containers/databases remain separate. The existing Listmonk PostgreSQL 14 container is not SAVEN's new native PostgreSQL 18 cluster.

SAVEN uses its own database, noninteractive OS service account, runtime role, application image and loopback port. Schema/migrations are owned by the PostgreSQL migration administrator; runtime is not an owner, superuser, role creator or BYPASSRLS role. Table permissions restrict writes and RLS derives company access from a hashed active server session. Scope is transaction-local and reset for every checked-out pooled connection. Identity/control lookup functions use a fixed search path, return narrow identity/boolean results and are owned by the migration role. Those control tables permit owner bypass for these functions; financial company tables use FORCE RLS. Runtime owns neither the tables nor functions.

The personal server is one failure domain. Disk, power, network, OS or Docker failure can stop dynamic SAVEN operations even if Cloudflare still serves the sign-in page. Other workloads compete for memory/CPU/disk. Development hosting on this machine is not high availability, a production capacity decision, or disaster recovery. Measure representative concurrent workloads before promising customer limits.

Never put Linux passwords, database passwords, tunnel tokens, invitations, database exports or customer files in Git. Current peer authentication requires no new database password. If the API and database are later separated, use a dedicated database login stored through the target secret manager, restricted network access and verified TLS. The server administration password supplied in chat must not become an application credential.

## Reproducible application and schema

The PostgreSQL image is built with Dockerfile.postgres, a pinned official Node image digest and npm ci against package-lock.json. Runtime code uses the same business command functions as the original tests. Native PostgreSQL migrations live in postgresql/; SQLite migrations remain historical/local-adapter support, not the PostgreSQL production schema.

Initialization is for an empty saven_testing database only. scripts/setup-postgres.sh refuses an existing account/database rather than replacing it. Apply migrations with ON_ERROR_STOP and transaction boundaries. Use a distinct saven_contract_* database for scripts/verify-postgres.mjs; the script refuses the application database. Its native contracts cover no-scope denial, pooled scope reset, one-use grants, company boundaries, idempotency, independent approval, immutable journals/audit, balance enforcement, competing stock commands and locked-period rollback.

## Controlled D1 to PostgreSQL cutover

1. Build the PostgreSQL image and pass native contracts in a separate database. Verify the loopback API and private VPC route. Do not change main or production routing.
2. Put testing API mutations into maintenance. Wait for in-flight work to finish. Record a D1 bookmark and company revisions. Export all 16 tables without writing private data into source control.
3. Prepare the one-time SQL using scripts/prepare-d1-import.mjs. It validates table/column names, counts and safe integer/string input and refuses a nonempty target. This is a temporary bridge for the known foundation schema, not a generic SQLite migration engine.
4. Import as the migration administrator. Disable only user control triggers inside that transaction, retain foreign keys/check constraints, preserve IDs/history, and re-enable controls before commit. Validate counts, posted journal balance, document/journal links and outstanding stock reservations. Any failure rolls back the import.
5. Run scripts/verify-import.mjs read-only using the private snapshot through stdin. It hashes canonical sorted rows to compare every field of all 16 tables, then independently checks journal balance.
6. Start the PostgreSQL API under the restricted runtime account. Verify anonymous denial, existing/new sign-in, actual database type, company isolation, preview, posting, stock, reports and audit on the hosted testing URL.
7. Switch the edge route to PostgreSQL and lift maintenance. There is one writer. Retain D1 unchanged for a defined recovery/reference window, then handle its retirement explicitly. Do not delete it as part of an uncertain cutover.

After PostgreSQL accepts new records, rolling back the web image is different from rolling back the database. Do not point back at a stale D1 snapshot. Either retain the compatible PostgreSQL schema and roll back only code, or stop writes and reconcile/export the newer records before a planned data rollback.

## Moving PostgreSQL to another personal or cloud server

The default small-MVP move is a scheduled write pause and native logical backup/restore. The domain and frontend can stay unchanged. Neither D1 nor Cloudflare is needed to perform the transfer.

1. Provision a supported PostgreSQL target at the same or a newer compatible major version. Check extensions, locale/collation, encoding, timezone, disk, database roles and the provider's permission limits. Exact roles are infrastructure, not customer records. Do not restore every unrelated role from the personal server.
2. Rehearse with a recent backup in a separate database. Use a pg_dump client that supports the source version. Preserve the application image digest, schema versions, config, object manifest and redacted operational inventory with the backup.
3. Pause writes/jobs and drain in-flight commands. Take the final custom-format dump: pg_dump --format=custom --no-owner --no-acl --file=<private-backup> <source-database>. Do not place a password in command arguments or a URL. Use peer auth, a secret-injected environment, or a mode-0600 passfile supplied by the operator.
4. Transfer the encrypted backup to the authorized target. Store a checksum and validate it after transfer. Backups contain the whole business and need separate access/retention controls.
5. Create an empty target owned by the migration role. Restore with pg_restore --exit-on-error --no-owner --no-acl --dbname=<empty-target> <backup>. Reapply the target-specific runtime grants, inspect SECURITY DEFINER function owners/search paths, and verify RLS/trigger definitions. Managed-provider role restrictions must be tested in the rehearsal.
6. Compare every table count/content hash and business reconciliations: trial balance, each journal's balance, customer/supplier balances, stock quantity/value and reservations, pending approvals, audit/outbox counts, IDs and latest document versions. Reconcile file metadata against the copied object-store manifest separately. A successful restore process exit alone is insufficient.
7. Switch the API's database configuration, or move the same API container beside the new database and update the VPC Service's target/tunnel. Verify TLS if the API-to-database connection is remote. Start a canary, check sign-in and read-only reports, then one controlled transaction/retry and its audit trail. Enable writers/jobs on the target only.
8. Keep the old database read-only during the rollback window. Roll back before new writes by reverting the connection. After new writes, stop and reconcile them before switching back; never run two independent writers. Retire old infrastructure only after the agreed window and backup checks.

For a larger database or a tighter downtime requirement, rehearse PostgreSQL logical replication and a measured final lag/cutover procedure. It needs additional setup for sequences, schema changes and unsupported objects; it is not automatically zero downtime. Estimate a window from an actual dump/restore rehearsal, not database size alone. Source: [PostgreSQL pg_dump](https://www.postgresql.org/docs/current/app-pgdump.html), [backup and restore](https://www.postgresql.org/docs/current/backup.html).

## Backup policy and release evidence

Execution evidence on 12 November: the local daily backup service and timer were installed and the first backup succeeded. Its checksum was verified, the archive restored into separate saven_restore_20261112_a, runtime grants reapplied, and all 66 records across 16 tables matched field for field; posted journals also reconciled. The native application database remains separate from this restore database. The timer targets 02:15 server/Pakistan time with up to ten minutes jitter. Files are under /var/backups/saven-testing with a private PostgreSQL-owned directory. Installation is reproduced by scripts/install-backup.sh. Current testing backups are kept locally without automatic deletion. Off-site encryption, retention and production recovery targets are not yet configured.

For internal testing, implement a daily custom-format backup, checksums, bounded local retention and periodic restore into a distinct database. A local backup protects against some operator mistakes; it does not protect against losing the server/disk. An off-site encrypted destination, its credentials and retention policy remain required before customer data. Continuous WAL archiving/PITR is a separate configured and rehearsed capability. No recovery-point or recovery-time promise is valid until the schedule, off-site copy, alerts and timed restores are actually verified.

Record the last successful backup/restore time, PostgreSQL and client versions, source/target schema versions, content/reconciliation results, duration, image digest, cutover/rollback decision, and unresolved limits. Monitoring should cover disk, memory, DB readiness, tunnel status, API error/latency rates, worker lag, backup age and restore failures, without logging tokens or financial payloads. Independent security review, real-user usability and representative load evidence remain separate MVP release gates.
