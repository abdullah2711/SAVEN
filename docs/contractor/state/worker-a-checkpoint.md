# WORKER-A checkpoint — PIVOT-007 operator functions delivered

Date: 19 November 2026 (Asia/Karachi). Round-end checkpoint.

## Exact contract

- `docs/contractor/contracts/PIVOT-007-operator-functions.md`
- Base `testing-1` @ `e0fa9fb`; branch `opencode/pivot-007-operator-functions` @ `/home/esc/saven/wt-pivot-007`.
- TOUCH: `db/postgres/50-functions.sql`, `db/postgres/README.md`, `tests/pivot-007-operator-access.test.mjs`.
- Implementation SHA: `ee1b31ac235b100855562c173d9e2ceb3cd36dce`.
- Delivery report: `docs/contractor/deliveries/PIVOT-007-operator-functions.md`.

## Prior review findings

None. This is the first PIVOT-007 round on this branch; no Codex findings exist yet.

## Delivered

- `operator.read_tenant_support()` — SECURITY DEFINER, owned by `saven_operator_definer`,
  fixed `search_path = pg_catalog, operator, tenant_data`, static schema-qualified SQL.
  Verifies the AUTH-007 Access binding/mapping/session under the shared AUTH-006 gate and
  principal→session `FOR SHARE` locks, requires a current customer `support_grants` row for
  exact subject/tenant/action/resource/company (version-1 scope JSON, active authoring
  member), scopes `app.current_tenant_id` itself and restores the caller's value, reads one
  of five reviewed resources with an explicit projection and 1–500 row cap, and writes one
  append-only `operator.operator_audit` row atomically.
- `operator.log_operator_read_denial()` — independent-transaction denial evidence with
  best-effort actor resolution; no operator id argument; grants no read authority.
- Grants: definer gets enumerated column reads on `operator.access_identity`,
  `operator.access_session_binding`, `auth.users/sessions/roles`, `tenant_data.support_grants`,
  `tenant_data.members` and the five read tables, INSERT on `operator.operator_audit`, and
  single-column UPDATE on `auth.users.status` / `auth.sessions.revoked_at` solely for
  `FOR SHARE` locking. EXECUTE only to `saven_operator_read`; `PUBLIC` revoked; post-install
  validation of owner/`SECURITY DEFINER`/`search_path`/allow-list.
- README: run-order step 14, definer role description, PIVOT-007 authority/grant/audit/limits
  section, fixture and contract-test notes.

## Gate evidence

- `node scripts/check.mjs` → `PASS: 173 JavaScript files parsed; package manifest valid.`
- `node --test tests/pivot-007-operator-access.test.mjs` → **9/9** pass, 0 fail.
- Environment: Node v24.19.0, PostgreSQL 18.6, disposable loopback cluster 55435,
  `SAVEN_PIVOT_TEST_CLUSTER=1`.
- No known out-of-scope failure observed this run.

## Where I stopped

Delivery is complete and pushed on the branch; not merged. No mid-fix failure evidence to
report (the three local test failures encountered during development — missing
`company_profiles.created_at`, an unused `$1` parameter, and an incorrect
`journal_lines`/ACL expectation — were fixed before the recorded gate run and are not
outstanding).

## Exact next step

1. Codex reviews `ee1b31a` against PIVOT-007 invariants.
2. PIVOT-008 follows on its own branch; do not merge without the human-approved dispatcher
   command.
3. Known open evidence for later contracts: application integration of
   `log_operator_read_denial` after a caught refusal, and the AUTH-007 issuer/audience/
   source-age policy that this payload intentionally does not duplicate.
