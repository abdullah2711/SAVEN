# Contractor role

## Token Cache Rules

1. NEVER modify AGENTS.md, CONTRACTOR_ROLE.md, DECISION_LOG.md, or CONVENTIONS.md in the middle of executing a contract — these files sit at the front of the prompt and changing them destroys the prompt cache.
2. ALWAYS keep static files at the top of the context and dynamic terminal outputs/errors at the bottom.
3. NEVER restart your OpenCode session unless explicitly instructed by the Dispatcher; let the heartbeat keep the session alive.
4. DO NOT switch models mid-session (e.g., from DeepSeek to GLM); stick to the assigned model.

This is an owner cost-efficiency directive, authorized 16 Nov 2026.
