# Runtime services and acceptance evidence

This extends the agreed MVP; it does not replace its 239 requirements or constitute complete commercial acceptance. Current live evidence and outstanding work are recorded in BUILD_STATE.md.

## Hosting responsibilities

| Component | Cloudflare | Personal server |
| --- | --- | --- |
| Web interface | Testing Worker and static assets | No public web server needed |
| Business authority | Proxies authenticated requests over the existing restricted VPC service | PostgreSQL database and deterministic API, approvals, journals, files and audit |
| AI inference | Explicitly opted-in Workers AI model; authenticated, scoped read tools and previews | Every business read/write is reauthorized here; optional queued model adapter can be configured separately |
| AI controls | Durable Object stores usage reservations/counters and attributed company processing consent; no passwords, prompts, ledger records or files | Native queued tasks store private task/proposal/usage records when that optional path is configured |
| Private files | Authenticated request transport, no public bucket URL | Immutable filesystem objects, PostgreSQL metadata, ClamAV quarantine and Poppler PDF extraction |
| Recovery | Source/deployment and platform settings have separate export/recreation procedures | Database dump plus immutable-object archive, checksums and restore rehearsal; off-site copies remain unconfigured |

PostgreSQL remains the sole business transaction writer. The cost/consent coordinator is a Cloudflare operational service, not a second ledger or a D1 fallback. It uses a SQLite-backed Durable Object because that is Cloudflare's supported coordination product; its contents are restricted to platform privacy settings and counters. Business data does not move to it.

## Assistant

The interface calls the authenticated testing Worker. It derives identity and company access from the PostgreSQL API, obtains only permitted records, validates read-tool arguments, and limits model steps. A model-proposed entry is sent back through the existing accounting preview API. The user must inspect and explicitly submit it; another authorized person must approve. Setup proposals similarly require explicit human application through configuration validation. Models cannot grant privileges, approve, post, run SQL or invoke arbitrary URLs.

Cloudflare processing defaults to disabled for each company. An owner/administrator must explicitly accept the displayed provider and data scope. Consent is checked before every inference and before returning results, and can be disabled. Shared company knowledge is a separate optional capability and is not enabled by chat consent. The initial basic live model request succeeded; further private financial-data testing required explicit destination-specific authorization after automatic approval review blocked it.

The deployed model is `@cf/meta/llama-3.3-70b-instruct-fp8-fast`. The global testing coordinator reserves a conservative upper-bound allowance before each inference, caps it at 8,000 estimated neurons per UTC day, and settles against reported token usage. Failed calls retain their reservation when actual usage is unknown. Per-identity limits and short-period bounds also apply. Account-wide Cloudflare use by other applications is separate; this is not an account-wide billing guarantee. Pricing assumptions must be rechecked when the model or vendor rates change.

Current edge chat history stays in the current interface session. Its provider/tool/usage/source metadata is returned to the caller. Durable private task history, selected-file extraction and exact task-to-operation attribution are implemented in the native service path; they require its configured model provider. These paths must not be described as identical in capability. Broader document/voice extraction, evaluated provider parity, named-seat/package controls, company knowledge and AI telemetry remain further release work.

## Private bucket and evidence

Files are stored under `/var/lib/saven-testing/objects` and mounted only into the API container at `/data/objects`. Names never become object paths. Keys use company ID, random file ID and SHA-256. Original bytes are written once, checked on download, and have no public object URL. The application OS identity owns the private directory. Each upload is bounded to 10 MB and has an idempotency key. Company retained storage is bounded to 1 GiB and personal storage to 256 MiB; quota is reserved before writing bytes. A 2 GiB free-disk reserve protects other server workloads.

Uploads remain unavailable until ClamAV reports clean. Scanner outages and unsafe files remain quarantined. Personal files are visible to their owner and company administrators, as disclosed in the interface. A linked file inherits transaction resource restrictions; a guessed file ID cannot bypass them. PDF/images/text/CSV are supported at this stage; other spreadsheet/document formats are not yet accepted.

Ordinary Drive removal cannot remove transaction evidence. Administrative withdrawal retains the original, logs the actor/reason and creates an owner notification. Attachment changes advance an evidence revision and company concurrency revision. Approval of a stale evidence revision fails; the reviewer must reopen the current evidence. Uploaded versions and evidence logs are not physically purged through ordinary application actions.

The scanner uses the official ClamAV image, pinned to the digest actually pulled during installation. It has a private container-network port only, a persistent signature volume and a 3 GiB memory cap. Concurrent signature-engine reload is disabled to reduce peak memory; scans may pause during reload and remain fail-closed. No unrelated server service or database is modified. No local LLM is installed by default: the scanner's documented memory requirement makes blindly adding an LLM to this host imprudent.

## Portability and recovery

Database schema, file metadata and object keys are vendor-neutral. To move servers: freeze business writes and uploads; create/check a final PostgreSQL dump and object archive; restore PostgreSQL on the destination; reapply runtime grants; restore objects into a private directory owned by the destination application account; verify every clean file's size/hash; test scope, evidence, journals and reports; then move the restricted VPC origin. Preserve a single writer throughout. A container rollback does not roll back a schema migration.

The backup service runs as a narrowly configured root-owned systemd job so it can read private objects. It invokes `pg_dump` under the PostgreSQL OS identity, archives retained objects, writes checksums and marks completion only after both succeed. Object immutability means a later copy contains every object referenced by the dump, even if it also contains later retained versions. A `.complete` marker and valid checksums are prerequisites for restore. Local archives remain unencrypted and on the same physical server; independent encrypted/off-site recovery and a retention policy are still required before production recovery promises.

Vendor references checked 12 November 2026:

- https://developers.cloudflare.com/workers-ai/features/json-mode/
- https://developers.cloudflare.com/workers-ai/platform/pricing/
- https://developers.cloudflare.com/durable-objects/get-started/
- https://docs.clamav.net/manual/Installing/Docker.html
- https://docs.ollama.com/api/chat
