# SAVEN repository instructions

## Branches

- Work on `testing-1` first. Do not push changes directly to `main`.
- Promotion to `main` follows testing, review, and the owner's release decision.
- Do not force push or discard unrelated work.

## Current project stage

- The owner requested review of the planning package before software implementation.
- Requirements in this baseline are specified, not implemented. Do not describe prototype behaviour or planning checks as production functionality.
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
