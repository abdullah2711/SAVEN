# Contractor and engineer conventions

Both agents read this file every session. The following two owner sections are retained verbatim.

# EXTENSIBILITY MANDATE

Every brick laid today must leave room for future extension and amendment. This is
a standing architectural requirement, not a suggestion. Apply it to every schema
change, every module, every API endpoint, every policy table, every AI tool.

Concrete rules:

SCHEMA
- Additive migrations only. Never DROP COLUMN, DROP TABLE, or RENAME without an ADR
  and owner approval.
- Anything that will grow (enums, action types, rule keys, document types, tax
  jurisdictions) goes in a reference table, not a hardcoded enum or CHECK list.
  The reference table has `is_active`, `effective_from`, `effective_to`, and a
  documented path to add values without migration.
- Configurable per-tenant data goes in JSONB with a documented shape and a JSON
  schema, not in one-column-per-setting tables. The JSON schema is versioned.
- Effective-dated rules (tax rates, approval thresholds, posting policies) carry
  `effective_from` and `effective_to`. Never mutate a rule that has been used;
  supersede it with a new row.
- Every table has `created_at`, `updated_at`, and where mutation is possible,
  `created_by`, `updated_by`.

CODE
- Every module boundary is an interface, not a concrete import. If you find
  yourself importing a concrete implementation across a module boundary, stop and
  introduce an interface.
- APIs are versioned from day one (`/v1/...`). Breaking changes go to `/v2/...`;
  the old version is deprecated on a published schedule, never silently removed.
- Feature flags for anything customer-visible that is not yet final. Flag defaults
  are safe (off for unreleased, on for shipped).
- No hardcoded lists of action types, document types, roles, or jurisdictions.
  Read them from reference tables or config.
- Every module has an "Extension points" section in its README: what can be added
  without touching this module, and how.

ACCOUNTING
- Posting rules are pluggable validators, not a giant if/else. A new rule is a new
  validator registered against a document type.
- Document types, transaction types, and account categories are reference data,
  not code constants.
- The chart of accounts is tenant data, never code.

AI
- Model-agnostic. No model-specific branches in code. The model is a config value,
  not a code path.
- Prompts and tool definitions are externalized files, versioned in git, not
  inline strings.
- AI tools are composable units registered against a tool registry. Adding a tool
  is a registration, not a code change in the agent loop.
- The AI creation path goes through the same document and approval APIs as human
  actions, never a parallel path.

DOCUMENTATION
- Every module, schema, and policy table has an "Extension points" section.
- Every ADR that introduces a constraint states how the constraint can be lifted
  later without a rewrite.
- Every contract and delivery report notes any decision that narrows future
  options, and why that narrowing is acceptable.

REVIEW CHECK
- The engineer's review of every contractor diff must include:
  "EXTENSIBILITY: no new hardcoded enums; no new coupling across module
  boundaries; no new one-way decisions without an ADR." If any is violated, the
  verdict is REVISE.

HARD PROHIBITIONS

- Do not delete SQLite code, schema, tests, or data.
- Do not run a destructive migration against any production or client database.
- Do not grant BYPASSRLS to any role.
- Do not use session-level `SET` for tenant context behind a connection pooler.
- Do not encode configurable per-tenant business rules into RLS policies.
- Do not migrate production client data. Phase 1 is schema, RLS, and parity only.
- Do not describe the pivot as complete. The production database remains SQLite
  until the owner authorizes cutover.
- Do not touch the archived testing frontend or the frozen `saventesting`
  deployment.
- Do not spawn subagents, invoke other models, or write orchestration scripts.
- Do not open any inbound port for PostgreSQL. It binds to `127.0.0.1` only.
  Cloudflare Tunnel carries only the app's HTTP/S endpoint.
- Do not commit secrets, connection strings, or keys.


## Partial deliveries and per-finding review

A partial delivery must be labelled PARTIAL, not complete. Enumerate every prior finding separately as DONE, PARTIAL or UNTOUCHED; for each, name the exact proving tests, state what remains unimplemented or untested, and identify who owns the resolution. Where no producer or test exists, say NO PRODUCER or NO TEST rather than claiming coverage. Include exact failure evidence for unfinished fixes: failing test, error text and current hypothesis. The engineer reviews each finding separately, recording closure or remaining corrective work and ownership; a consolidated verdict must name all unresolved findings and must not treat the partial delivery as a whole ACCEPT. A scope or policy conflict is resolved on the record by the engineer or the Principal, never by an inferred dispatcher deferral.

## Agent permissions — scope by touchability

Agent permissions are scoped by WHAT CAN BE TOUCHED, never by WHICH COMMAND is used. Read commands are not safe by name: cat, sed, head, tail and grep grant read access to every file the agent user can read, and exfiltration is a read, not a write. Allow reads only on relative paths inside the agent own worktree; deny absolute paths, ~, .., and any path matching .env, .ssh, .pem, *.key, credentials or tunnel configuration; everything else asks.

The standing inventories rule (D-017, docs/agents/DECISION_LOG.md) already covers base-SHA discipline.
