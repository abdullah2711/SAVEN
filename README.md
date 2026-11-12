# SAVEN

SAVEN, pronounced **seven**, is Economic Systems Consulting's accounting and finance platform with connected operations and controlled AI assistance.

## Current state

**Construction has started on testing-1.** The first foundation implements authenticated company access, accounting previews, non-taxable service invoices, whole-unit stock issues, separate approval, atomic posting, retry protection and audit history. This is not the complete commercial suite. The 239-requirement catalog preserves the requested launch breadth and distinguishes specified from in-progress work.

Read the [working foundation, setup and verification limits](docs/12-foundation.md) and [build checkpoint](docs/BUILD_STATE.md) before continuing development. The owner's [additional input contract](docs/11-additional-input.md) supersedes earlier proposed defaults where it differs.

## Run and check

Node 24.19.0 is the reference runtime. The PostgreSQL API uses the pinned `pg` dependency and lockfile; install it with `npm ci`.

```sh
node scripts/check.mjs
node --test tests/*.test.mjs
python tools/validate_plan.py
node scripts/server.mjs --demo
```

The last command starts a local server and prints single-use invitations for synthetic preparer, reviewer, owner and viewer accounts in two isolated companies. Open the printed URL in your browser. Submit an invoice or stock issue as preparer; sign out and open the reviewer invitation to approve it. The exact journal preview is shown before submission and approval. No demo users, credentials or seed endpoint are deployed.

The testing Worker now serves assets and forwards APIs through a restricted Cloudflare VPC service to the personal server's PostgreSQL API. PostgreSQL listens locally only. The former D1 data was reconciled and migrated; D1 is not a fallback writer. See [hosting, backups and migration](docs/13-hosting-postgresql-and-migration.md) and [operating setup, identity and reports](docs/14-operating-core.md). The local Node/SQLite adapter remains a foundation contract harness. MFA/recovery, operator provisioning, evidence storage, tax localization, offline operation, other catalog modules and evaluated model providers remain unfinished. Empty workspace destinations identify their planned status.

## Branches and environments

| Purpose | Branch | URL |
| --- | --- | --- |
| Testing | testing-1 | https://saventesting.economicsystems.cc/ |
| Production | main | https://app.saven.economicsystems.cc/ |
| Future marketing site | Separate frontend | https://saven.economicsystems.cc/ |

All changes enter testing-1. Main promotion requires testing, review and the owner's release decision. wrangler.jsonc targets saven-testing; this iteration's build guard rejects another CI branch. Dashboard branch mapping and separate database bindings still need verification. Do not assume that pushing code establishes a working live database.

Never commit access tokens, credentials, client records, payroll, payment evidence or database dumps. Local data and invitation tokens belong outside version control. A branch alone does not isolate production data.

## Planning and implementation references

1. [Product blueprint](docs/01-product-blueprint.md).
2. [Architecture, AI and security](docs/02-architecture-ai-security.md).
3. [Commercial strategy](docs/03-commercial-strategy.md).
4. [Delivery and verification](docs/04-delivery-and-verification.md).
5. [Feature library](docs/05-feature-library.md) and [JSON catalog](docs/feature-catalog.json).
6. [Feedback traceability](docs/06-feedback-traceability.md), [architecture decisions](docs/07-architecture-decisions.md), [competitive review](docs/08-competitive-review.md) and [risk register](docs/09-risk-register.md).
7. [Company knowledge and personal memory](docs/10-company-knowledge-and-memory.md).
8. [Additional input](docs/11-additional-input.md), [foundation evidence](docs/12-foundation.md) and [resume checkpoint](docs/BUILD_STATE.md).

To change catalog records, edit tools/build_feature_catalog.py, regenerate with `python tools/build_feature_catalog.py`, and validate with `python tools/validate_plan.py`. CI checks that generated files remain consistent. Passing planning checks does not establish production readiness.

SAVEN is intended as a closed-source product. No software licence is granted by publication of this repository; final commercial and licence terms require their own approved documents.

