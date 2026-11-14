# Native deployment, short hostnames and recovery continuation

14 November 2026, Asia/Karachi. This continues the authorized operational release request in docs42. It is an acceptance candidate, not the complete client MVP.

## Owner domain revision and actual routing

The owner explicitly selected `https://app.economicsystems.cc` for the customer application and `https://ops.economicsystems.cc` for administration when the nested hostnames encountered TLS problems. The two hostnames are now the active Cloud targets. The marketing hostname is unchanged. Older domain references in historical checkpoints and source mandates describe superseded targets.

Both new hostnames have proxied CNAMEs to the existing esc-server tunnel and exact ingress rules to the native application on loopback port 8790. Public HTTPS health probes returned HTTP 200 and the native SQLite candidate identity. No paid certificate or TLS-verification bypass was used. The old placeholder Worker was preserved; no new relay Worker or relay secret was commissioned. The reusable gateway/relay source remains tested but unused by this deployment.

The customer and administration origins retain independent host-only sessions, exact Origin/CSRF enforcement, operator scopes and ordinary customer membership. Domain names do not grant financial authority. No raw database, debug console or model endpoint is exposed.

## Native source changes

Previously unpublished native continuation is retained: linked exact manual-journal reversals through the common posting/approval kernel; protection against manual reversal of stock journals; schema-5-to-6 migration evidence and per-business quarantine on checksum/placement failures; native frontend startup repairs; inventory-only workspace discovery and narrower master-data disclosure; separate commercial/fleet scopes. A full client workflow or owner approval is not implied.

The real-service probe now uses an explicitly restricted localhost HTTP transport when a logical Host override is required. Public HTTPS uses the ordinary fetch path. Tests use a real local socket to verify Host, Origin, binary evidence and cookies, and refuse remote/decorated override destinations. This fixes the prior 421 acceptance-probe transport failure.

The initial local model run exceeded its memory/context budget. Native inference now requests 8192 context tokens and at most 512 generated tokens, with no thinking mode and unloading after the request. Oversized input is refused before inference. The response schema restricts this runtime to no tool execution, empty configuration/arguments, actual request-source citations and an empty or JSON-shaped journal proposal. Deterministic financial validation and authority rechecks still apply. The earlier model produced the right trial totals but an invalid document identifier and invented citation syntax; that response was rejected without business changes. Model output remains untrusted.

## Verification and recovery

The complete source suite passed 132 tests; 140 JavaScript files parsed. The container passed 40 focused native, model, transport and recovery tests. Both generators and validation retained 255 requirements, 25 module areas and 268 screen mappings. Generated coverage is not completed ERP scope.

A stopped backup preserved all four control databases, two tenant databases and one original evidence object. A separate new-directory restore passed integrity/foreign-key/journal checks, actual operator sign-in and schema-6 migration in a network-disabled container. Independent Python SQLite comparisons verified every original row in every original tenant table remained identical after migration, excluding only the migration ledger. A later scheduled-service rehearsal includes newly created QA tenants.

Container backups must allow SQLite's local sidecar access on the stopped source mount and provide a writable temporary directory. A read-only bind mount of a checkpointed WAL database failed to open; those incomplete backup directories were preserved and never labelled successful. The corrected stopped procedure uses read-only SQL connections with a writable source directory while all application writers are stopped.

The root-owned backup service takes a short maintenance stop, records a complete local backup, restores it independently into a new directory and restarts the candidate even after a job failure. It uses the container's immutable image ID, verifies its data mount, serializes runs, checks disk reserve and refuses to delete old backups. The timer runs daily at 03:00 Asia/Karachi. At 30 retained backup sets it stops creating new sets and requests retention review. These local backups and verified copies are on the same host: independently stored encrypted recovery, retention policy and contracted RPO/RTO remain open.

## Release boundary and exact continuation

Existing PostgreSQL/reference data and services, Listmonk, Nextcloud, antivirus and the original tunnel routes are retained. Only clearly named internal QA businesses were created by acceptance probes. There is no client migration or main promotion in this increment.

The complete operational Accounting/Inventory MVP remains unfinished as enumerated in docs42: AR/AP invoices and settlements, full opening/recurring and bank reconciliation, broader inventory costing/returns/counts/UOM/traceability, complete user/role/onboarding/recovery workflows, commercial billing/subscriptions, print-format design, wider AI tools/ingestion and independent security/browser/release acceptance. Source CI builds/tests candidates; fully commissioned production CD, signed artifacts and fleet rollout are still required. Continue those workflows on testing-1 and preserve client data; do not call public reachability a market-ready release.

Final public workflow, inference, browser and source-publication evidence is recorded in BUILD_STATE and the adjacent machine-readable evidence file.
