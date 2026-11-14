# Server-hosted runtime and tunnel-only Cloudflare profile

14 November 2026, Asia/Karachi. Newest explicit owner direction: host app, ops and every SAVEN runtime layer on the owner's server; use Cloudflare only for the tunnel and its DNS/TLS edge. This supersedes active Worker-hosting and Worker-build assumptions in earlier runbooks. Historical adapters and PostgreSQL/reference data remain preserved.

## Active runtime

| Address/layer | Actual owner-server responsibility |
| --- | --- |
| https://app.economicsystems.cc | Authenticated native frontend/API, loopback port 8790 |
| https://ops.economicsystems.cc | Separate origin/session realm on the same native service, with scoped commercial/fleet controls |
| Native identity, commerce, fleet and jobs controls | Four local SQLite stores |
| Accounting, stock, roles, approvals and outbox | Local tenant SQLite files and the common posting kernel |
| Evidence and malware scanning | Private local original-file directory and the retained ClamAV service |
| AI | Local constrained Ollama/qwen3 inference; no Workers AI or hosted provider is needed by this profile |
| Recovery | Local root-owned backup/independent-restore service and daily timer; independent off-host recovery remains open |
| https://saventesting.economicsystems.cc | Server-hosted review frontend on loopback 8792, with a fixed local proxy to the unchanged schema-13 PostgreSQL reference API on 8788 |

Cloudflare carries DNS/TLS/tunnel ingress. Workers, D1, R2, Durable Objects, Worker AI and VPC bindings are not on the active .cc runtime request path. GitHub provides source control and CI only; normal sign-in, queries, postings, evidence and local inference do not require GitHub connectivity.

## Testing frontend replacement

Dockerfile.preview builds a small non-root Node frontend with no npm dependencies. Its Dockerfile-specific ignore file includes the actual review assets and excludes unrelated source/data. The first image exposed a packaging omission from the existing native-only default dockerignore; it was corrected before any public routing change. A real packaged-image smoke test now starts the server inside a network-disabled container and checks root/catalog assets, retired-path refusal, exact Host enforcement, foreign-Origin refusal and local-API outage behaviour.

The preview server allows only configured HTTPS public origins. Static paths use the retained asset allowlist and synthetic/non-posting CSP. API traffic goes only to a fixed local loopback reference API. It overwrites client-supplied public-origin/relay headers, preserves ordinary cookies and CSRF values, refuses foreign writes before forwarding and returns an explicit outage without choosing another store. It does not confer operator or customer authority. The reference API retains its existing independent authentication and PostgreSQL scope checks.

The running testing frontend was built and tested on Linux, then verified locally with HTTP 200 assets and the unchanged PostgreSQL schema-13 health response. Its exact tunnel ingress was installed and validated before switching the public hostname. The active .cc testing custom domain was removed from the old Worker, then replaced with a proxied CNAME to esc-server. Public root and API health returned HTTP 200 after the change; both app and ops native health checks also remained HTTP 200.

## Worker retirement boundary

Both retained SAVEN Workers, saven and saven-testing, have their production and preview build triggers disabled in the authenticated dashboard. Their old source, bindings, Durable Object state and historical/alternate aliases were not destroyed. In particular, old economicsystemsglobal.com aliases may still identify retained historical Workers; they are not dependencies of the approved active .cc runtime. Other owner sites/Workers were not changed.

The temporary SSH hostname expired after the local frontend/container and tunnel ingress were already installed. The final testing CNAME was created and verified through the authenticated DNS dashboard. Public application checks succeeded afterward. No further server inspection is claimed after that transport expiry; use a renewed owner-provided SSH endpoint for later container changes. Running services and tunnel ingress do not depend on the temporary SSH session.

## Verification and next work

The complete source suite passed 135 tests. The preview container independently passed four handler/packaged-image tests with networking disabled. The earlier native candidate's 40 Linux contracts, actual public financial/stock/evidence/inference acceptance and recovery evidence remain in docs43. No application/database cutover or client-ready claim is added by moving the frontend.

The native CI workflow also builds and tests the server-hosted preview image. A later release must commission authenticated, version-pinned server CD with health/rollback and migration gates; disabling Worker build triggers is not a claim that native production CD is complete. The broad Accounting/Inventory/commercial/roles/printing/AI work in docs42 remains unfinished. Preserve native financial data and the reference installation while continuing those increments on testing-1.
