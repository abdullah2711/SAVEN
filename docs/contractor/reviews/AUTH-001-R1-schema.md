VERDICT: ACCEPT

WHY: AUTH-001 at 991bc06, including its R1 correction, closes all three findings from the review at 50b6749. The PKCE key constraint is explicitly null-safe and validated; actual-role tests cover invalid INSERT/UPDATE and valid optional/encrypted rows; the audit rollback test proves setup and propagates unexpected errors; bootstrap cleanup failures are aggregated; and the revised evidence records supported Node 24, exported test configuration and dated library/adapter review. Acceptance covers the schema/fixture/package-readiness contract only, not operational authentication or release readiness.

Date: 15 November 2026 (Asia/Karachi).
Delivery: `opencode/auth-001` at `991bc06fc06a33bbed678b408231fa154f8b1d3e`.
Reviewed worktree: `/home/esc/saven/wt-rev-auth-001-r1` (HEAD verified).
Review baseline: original delivery `09b1898`; governing revision contract: [AUTH-001 review](AUTH-001-schema.md) at `50b6749`.

The original REVISE remains in its historical file/commit; this verdict supersedes it for the exact delivery SHA above. The delta has only the five R1-authorized paths. Read-only Git comparison confirms original `00`/`05`/`10` SQL and package/lockfile bytes are unchanged.

Finding closure:

1. `migrations/006-auth-schema-corrections.sql` adds a named CHECK requiring `code_verifier_key_version IS NOT NULL AND > 0` when ciphertext exists. Constraint addition/validation is transactional, owner-scoped and privilege-neutral. Validation refuses invalid existing rows without rewriting them. The fixture applies 006 after 05. Tests exercise NULL/zero/negative inserts, null/zero-key updates, optional rows, valid key binding and catalog validation; the validation-probe transaction rolls back.
2. The rollback-audit test no longer swallows its action's errors or nests transaction ownership. It proves both inserted rows exist before fixture rollback, separately checks the intended division-by-zero abort and verifies both persisted counts remain zero. Independently committed failure audit remains covered. Bootstrap cleanup now collects failures and rethrows them with any primary failure.
3. The R1 report explicitly supersedes historical Node 22 evidence with `v24.19.0`, exported dedicated-cluster variables, 16/16 focused tests, 166/166 branch-suite tests, missing-opt-in refusal and cleanup observations. These are worker results read by the engineer, not reviewer reruns. The dated pin review documents licence/peer/runtime considerations, two relevant upstream advisory ranges and concrete remaining adapter work. The reported patch boundaries agree with the official [OAuth-state advisory](https://github.com/better-auth/better-auth/security/advisories/GHSA-965c-763c-88jm) and [provider-email advisory](https://github.com/better-auth/better-auth/security/advisories/GHSA-9hm7-xhfp-cx58). This is not an assertion that the complete dependency tree has independent security clearance.

Can a client-supplied header, query param, or body value influence tenant_id or user_id? **No new request path exists in this delivery.** This is SQL/fixture/test/package preparation; AUTH-002/006 must still prove that request values cannot become authoritative context. The trusted auth-service role can persist identity/session values, and schema FKs alone do not establish session-selected user/tenant agreement or active admission.

[Technical rulings at 43666dc](PIVOT-003-technical-rulings.md) remain in force: auth is canonical, no tenant-data grants for auth roles, no vendor-operator FK dependency in Private, and exact stored UUID/text/membership links belong to PIVOT-004. Forced membership RLS remains mandatory. Better Auth token hashing, revocation, expiry, credential mapping, MFA and passkey adaptation remain future implementation, not accepted flows. The delivery's mention of AUTH-008 does not expand that schema-only contract to own a live OAuth connector.

Nonblocking shared-document correction for the next authorized README edit: the example environment should use `SAVEN_PIVOT_TEST_CLUSTER=1` when running the whole suite, since AUTH-only opt-in does not enable pivot fixtures. The current fixture/code and recorded R1 evidence are not affected. Preserve the combined auth/tenant README when the human integrates the branches.

EXTENSIBILITY: no new hardcoded enums; no new coupling across module boundaries; no new one-way decisions without an ADR. The correction adds a structural encryption invariant without rewriting source or applied migration bytes, adding privileges, enabling connectors or duplicating identity authority.

No installation, contract gate, SQL migration, suite, backup, deployment or merge was performed by the engineer. Acceptance is review of the supplied source and worker evidence at this SHA; combined integration/CI and later release gates remain outstanding. SQLite remains production. The human alone authorizes merges.
