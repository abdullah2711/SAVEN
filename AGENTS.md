# SAVEN repository instructions

## Branches

- Work on `testing-1` first. Do not push changes directly to `main`.
- Promotion to `main` follows testing, review, and the owner's release decision.
- Do not force push or discard unrelated work.

## Current project stage

- The owner authorized construction on 11 November 2026. Read docs/BUILD_STATE.md, docs/11-additional-input.md and docs/12-foundation.md before continuing implementation.
- Requirements in this baseline are specified, not implemented. Do not describe prototype behaviour or planning checks as production functionality.
- Foundation code now exists. Catalog items marked in progress remain partial until all supported-scope and release evidence passes. Keep build checkpoints current after interruptions and handoffs.
- Preserve the requested commercial breadth. Propose scope changes explicitly and update traceability rather than silently postponing features.

## Financial and security boundaries

- Forms, APIs, integrations and AI must share business validation, permission, approval and posting controls.
- Use decimal financial arithmetic, atomic balanced effects, idempotency, company boundaries and traceable corrections.
- Never commit credentials, customer records, payroll, payment evidence or database dumps.
- AI models are untrusted proposal generators. Do not promise zero hallucinations, universal model equivalence, unlimited scale or breach-proof operation.

## Documentation

- Run `python3 tools/validate_plan.py` after changing the planning package.
- Keep the catalog JSON, feature library and explicit generator records consistent.
- Record unresolved decisions, unsupported depth and required evidence honestly.

