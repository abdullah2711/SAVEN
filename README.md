# SAVEN

SAVEN, pronounced **seven**, is Economic Systems Consulting's accounting and finance platform with connected operations and controlled AI assistance.

## Current state

**Construction has started on testing-1.** The first foundation implements authenticated company access, accounting previews, non-taxable service invoices, whole-unit stock issues, separate approval, atomic posting, retry protection and audit history. This is not the complete commercial suite. The 239-requirement catalog preserves the requested launch breadth and distinguishes specified from in-progress work.

Read the [working foundation, setup and verification limits](docs/12-foundation.md) and [build checkpoint](docs/BUILD_STATE.md) before continuing development. The owner's [additional input contract](docs/11-additional-input.md) supersedes earlier proposed defaults where it differs.

## Run and check

Node 24.19.0 is the reference runtime. There are no runtime npm dependencies.

```sh
node scripts/check.mjs
node --test tests/*.test.mjs
python tools/validate_plan.py
node scripts/server.mjs --demo
```

The last command starts a local server and prints single-use invitations for synthetic preparer, reviewer, owner and viewer accounts in two isolated companies. Open the printed URL in your browser. Submit an invoice or stock issue as preparer; sign out and open the reviewer invitation to approve it. The exact journal preview is shown before submission and approval. No demo users, credentials or seed endpoint are deployed.

The same command code targets Cloudflare Workers/D1 through src/worker.mjs and a local Node/SQLite adapter through scripts/server.mjs. See [the adapter decision and external setup](docs/12-foundation.md). Full identity/MFA, operator provisioning, evidence storage, tax localization, offline operation, other catalog modules and evaluated model providers remain unfinished. Empty workspace destinations identify their planned status.

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

