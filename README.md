# SAVEN

SAVEN, pronounced **seven**, is Economic Systems Consulting's ERP with connected accounting and controlled AI.

## Governing specification and current evidence

The [13 November mandate v2.0](docs/sources/SAVEN-mandate-v2.md) supersedes conflicting older prompts. Read the [reconciliation](docs/26-owner-decisions-2026-11-13-v2.md), [ADRs](docs/07-architecture-decisions.md) and [checkpoint](docs/BUILD_STATE.md) before continuing.

The existing testing app still uses PostgreSQL schema13. Schema14 line invoices/basic taxes/defaults passed source contracts but have not been activated on the server. Preserve this working reference until SQLite equivalence, financial/security reconciliation and authorized migration gates pass. No D1 fallback writer is configured.

The v2 target has exactly two commercial models: SAVEN Cloud (D1 controls, R2, tenant SQLite on SAVEN-controlled nodes) and Fully Private (self-contained local SQLite or a disclosed customer-Cloudflare profile). Offline is a restricted synchronized companion, not another hosting tier. No customer-supplied database can attach to shared SaaS; no accounting-firm or reseller hosting is offered.

## Frontend design review

The isolated [design workspace source](public/design/index.html) maps the complete catalog. It contains synthetic data, explicit simulations, global search and priority module examples. Specification briefs, interactive drafts, existing partial implementation and owner design approval are separate. It cannot call business APIs; it is not the working ERP or an offline client. Owner approval is still required.

Run the design-only preview with Node24:

```sh
node scripts/design-server.mjs
```

Open the printed loopback URL. No database, real login or API setup is needed for this preview. All synthetic transactions reset on reload. Existing working app paths are retained separately.

## Verify and reproduce

```sh
npm ci --ignore-scripts
python tools/build_feature_catalog.py
python tools/build_design_library.py
node scripts/check.mjs
node --test tests/*.test.mjs
python tools/validate_plan.py
```

[Screen inventory](docs/ui-screen-inventory.json), [typed design contracts](docs/workflow-contracts-v1.json), [PG reference inventory](docs/postgres-reference-inventory.json) and [technical contracts](docs/27-deployment-models-and-portability.md) are reproducible review artifacts. Mapping a requirement does not implement or approve it. The SQLite BI script is an in-memory synthetic feasibility test, not a tenant port or production reporting engine.

All work enters `testing-1`. Main and production require explicit owner authorization. Do not run irreversible business migrations, replace current financial services or claim private/fleet/offline deployment without their evidence gates. No secrets, customer records, private credentials or dumps belong in Git.

SAVEN is proprietary. Publication does not grant a software licence. Cloudflare target configuration and existing PostgreSQL deployment scripts are testing-specific references, not the v2 turnkey private installer.
