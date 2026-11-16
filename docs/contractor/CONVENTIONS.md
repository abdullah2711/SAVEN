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

## Standing owner security invariant — session display (D-012)

16 November 2026 (Asia/Karachi), explicitly authorized by the human owner.

Session lists must ONLY ever show token digests. Raw session tokens must NEVER be
exposed in UI or API payloads, including list responses, previews and exports.
The established protected HttpOnly session-cookie transport remains the credential
transport; a cookie value must never be copied into JSON or rendered UI. Transient
server-side library token matching is not an outward response contract.

Every future UI/frontend contract, customer or operator, must include this invariant
in INVARIANTS and require appropriate response/serialization checks when it touches
sessions. Use known synthetic raw tokens to verify that no outward list, API body,
rendered state or export contains them; permitted session-token display is digest
only. Do not offer a reveal/copy-raw-token action. This supplements the verbatim
mandate above and does not change authentication, CSRF or authorization requirements.

Authority: [dated decision D-012](../agents/DECISION_LOG.md). The AUTH-002 contract
records the required next-revision follow-up; no new runtime implementation is
authorized or claimed by this documentation record.

## Standing owner accounting override — D-013

16 November 2026: authorized users can delete posted entries through terminal soft deletion. Retain source/evidence/history, mark effective state VOIDED and remove the entry from active GL. VOIDED is absolutely immutable: no unvoid, physical deletion or repeated deletion. D-014 owner correction: voided tables/views/policies must remain agnostic to business role names and special eligibility classes. At the database level, anyone with module access may read voided entries within existing tenant/company/branch scope. Fine-grained visibility is a configurable business rule deferred to future application RBAC / User Access Settings; no category-specific read restriction is imposed by PIVOT-005. Delete authority is separate from read authority. Future accounting, reporting, API, AI and UI contracts must preserve the mechanism and linked-effect/audit invariants; the later RBAC phase must consistently apply its configured visibility across application read paths. The separate Deleted/Voided Entries page is required before UI delivery can be claimed. [ADR04](../pivot-notes/04-adr-terminal-entry-voiding.md) reconciles physical posted immutability, native correction/rejection flows, append-only audit and the purpose map. It supersedes conflicting always-active wording, not the verbatim preservation/security prohibitions above.
