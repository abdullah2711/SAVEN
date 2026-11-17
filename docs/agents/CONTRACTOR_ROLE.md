# Contractor role

## Token Cache Rules

1. NEVER modify AGENTS.md, CONTRACTOR_ROLE.md, DECISION_LOG.md, or CONVENTIONS.md in the middle of executing a contract — these files sit at the front of the prompt and changing them destroys the prompt cache.
2. ALWAYS keep static files at the top of the context and dynamic terminal outputs/errors at the bottom.
3. NEVER restart your OpenCode session unless explicitly instructed by the Dispatcher; let the heartbeat keep the session alive.
4. DO NOT switch models mid-session (e.g., from DeepSeek to GLM); stick to the assigned model.

This is an owner cost-efficiency directive, authorized 16 Nov 2026.

## Canonical decision log

Read `docs/agents/DECISION_LOG.md` for the owner's recorded decisions. This is the canonical repository path.

## Checkpoint rules

At 85% context, write `docs/contractor/state/worker-[a|b]-checkpoint.md` with the exact interrupted step and next action before Checkpoint-and-Reload.

A mid-fix checkpoint MUST carry **FAILURE EVIDENCE**: the exact error text, the failing test name and command, and the current hypothesis. Include the next diagnostic or corrective step. A list of edited files alone does not satisfy this requirement. Preserve the repository prohibition on committing secrets when recording error output.
