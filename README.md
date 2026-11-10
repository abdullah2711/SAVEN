# SAVEN

SAVEN, pronounced **seven**, is Economic Systems Consulting's planned accounting and finance platform with connected operations and controlled AI assistance.

## Current state

This repository contains a planning baseline prepared from the supplied inputs. Requirements are **specified, not implemented**. The existing SIMBA interface concept is a separate visual prototype and is not a production backend. Software implementation follows the owner's review of this package.

## Review order

1. [Product blueprint](docs/01-product-blueprint.md) — customers, scope, workflows, finance, reporting, portals and UX.
2. [Architecture AI and security](docs/02-architecture-ai-security.md) — recommended stack, data boundaries, commands, AI, Apps, deployment and recovery.
3. [Commercial strategy](docs/03-commercial-strategy.md) — value propositions, demonstrations, objections, pricing hypotheses and defensibility.
4. [Delivery and verification](docs/04-delivery-and-verification.md) — stages, gates, first implementation, open decisions and release policy.
5. [Feature and acceptance library](docs/05-feature-library.md) and [machine-readable catalog](docs/feature-catalog.json).
6. [Feedback traceability](docs/06-feedback-traceability.md) and [architecture decisions](docs/07-architecture-decisions.md).
7. [Competitive review](docs/08-competitive-review.md), based on current official documentation.
8. [Risk register](docs/09-risk-register.md).

## Branch policy

All changes go to **testing-1** first. Promote to **main** only after testing and review. Branches are not deployment environments; development, test and production data and secrets must be separate. The policy is documented here; repository protections are not claimed to have been configured.

Do not commit credentials, client financial records, payroll, payment evidence, or production data dumps.

## Planning consistency checks

Run `python3 tools/validate_plan.py`. The check validates catalog structure, dependencies, traceability references and document links. It does not test accounting software that has not yet been built.

To regenerate the catalog after changing its explicit records, run `python3 tools/build_feature_catalog.py` and review the generated Markdown and JSON together.

No software licence is granted by publication of these planning documents. SAVEN is intended as a closed-source product; final licence and commercial terms require their own approved documents.
