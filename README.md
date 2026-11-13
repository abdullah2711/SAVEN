# SAVEN

SAVEN, pronounced **seven**, is Economic Systems Consulting's ERP with connected accounting and controlled AI.

## Governing specification and current evidence

The [consolidated owner mandate v2.3](docs/sources/SAVEN-mandate-v2.3.md) and [agent handoff](docs/sources/SAVEN-agent-handoff-v2.3.md) supersede conflicts. The full [v2 baseline](docs/sources/SAVEN-mandate-v2.md) retains nonconflicting scope. Read the [current reconciliation](docs/35-native-sqlite-local-first-v2.3.md), [ADRs](docs/07-architecture-decisions.md) and [checkpoint](docs/BUILD_STATE.md) before continuing.

The existing testing app still uses PostgreSQL schema13. Schema14 line invoices/basic taxes/defaults passed source contracts but have not been activated on the server. Preserve this working reference until SQLite equivalence, financial/security reconciliation and authorized migration gates pass. No D1 fallback writer is configured.

The v2.3 target has exactly two commercial models: SAVEN Cloud and Fully Private, both with native SQLite controls and business databases. D1 and PostgreSQL are not new-code targets. Cloudflare hosting and object storage are replaceable adapters. Offline is a restricted synchronized companion, not another hosting tier. No customer-supplied database can attach to shared SaaS; no accounting-firm or reseller hosting is offered.

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

SAVEN is proprietary. Publication does not grant a software licence. Cloudflare target configuration and existing PostgreSQL deployment scripts are testing-specific references, not a turnkey private installer.

## Local native foundation proof

Run `node scripts/native-demo.mjs` for an isolated synthetic SQLite company, durable command, balanced journal and independently opened backup. It uses separate native identity, commerce, fleet, jobs and tenant files in an ignored QA directory. It is a developer harness, not an authenticated ERP service and not connected to design screens. Existing PostgreSQL routes remain separate. See [implementation evidence and limits](docs/38-native-foundation-verification-v2.3.md).

The private monthly certificate proof uses ephemeral test keys, signed challenges and acceptance receipts. Commercial grace, cutoff, emergency and seat policies remain unapproved. No vendor private key is committed or included in the private foundation allowlist.
