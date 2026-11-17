# WORKER-A checkpoint — AUTH-006 delivered, awaiting verdict

Date: 17 November 2026 (Asia/Karachi). Written under the owner standing checkpoint
directive; this file is outside any contract TOUCH.

## Context

- AUTH-005-R2 was human-merged into `testing-1` at merge commit
  `1b9ff78a1a29b994a6d77389b035f6b8cd692e76` (pushed `a81ce59..1b9ff78`).
- AUTH-006 branch/worktree: `opencode/auth-006-context` at
  `/home/esc/saven/wt-auth-006`, based on `1b9ff78`.

## Exact contract

- Contract: `docs/contractor/contracts/AUTH-006-tenant-context.md` — bind verified
  selected membership to every PG business transaction on one checked-out client.
- TOUCH: `src/db/tenant-context.mjs`, `src/db/README.md`,
  `src/auth/tenant-selection.mjs`, `src/auth/routes.mjs`,
  `src/auth/session-store.mjs`, `src/auth/README.md`,
  `tests/auth-006-context.test.mjs`.
- DONE WHEN: `node scripts/check.mjs && node --test tests/auth-006-context.test.mjs`.
- Implementation commit: `dc690f5` (`app: bind verified tenant context to business
  transactions [contract:AUTH-006]`).
- Report + this checkpoint are the next commit; that commit is the pushed head at
  checkpoint time.

## TOUCH used

`src/db/tenant-context.mjs` (new), `src/db/README.md` (new),
`src/auth/tenant-selection.mjs` (new), `src/auth/routes.mjs`,
`src/auth/session-store.mjs`, `src/auth/README.md`,
`tests/auth-006-context.test.mjs` (new), delivery report and this checkpoint. Nothing
else changed; no schema/migration/grant/dependency/server entry point.

## What was delivered

1. **Tenant selection (`tenant-selection.mjs`)** — list/select/clear/resolve against the
   verified principal's own active memberships. All reads bind
   `app.current_user_id` transaction-locally on the auth-service connection; `select`
   locks the session row, validates active membership/role/epoch, and binds
   membership/tenant/epoch to the session with a guarded UPDATE.
2. **Session storage (`session-store.mjs`)** — `readSessionById`, `setSessionSelection`,
   `clearSessionSelection`; public session shape exposes selection fields. All mutation
   guards reuse revoked/expired/disabled/credential-epoch predicates.
3. **Routes (`routes.mjs`)** — versioned `/v1/auth/tenants`, `/v1/auth/tenant/select`,
   `/v1/auth/tenant/clear`. Not in the pre-MFA allow-list; operator realm refuses.
   Selector input is a request only; header/query values are ignored.
4. **DB boundary (`tenant-context.mjs`)** — one checked-out business client, `BEGIN`,
   parameterized `set_config(...,true)` for user/tenant, round-trip verification,
   `tenant_data.session_admitted` recheck, handler on that client, COMMIT/ROLLBACK, and
   destroy-on-uncertainty. No `pool.query`, no nested checkout, no session `SET`.
5. **Docs** — `src/db/README.md` (PgBouncer transaction-mode safety, failure modes,
   extension points) and `src/auth/README.md` AUTH-006 section.

## Evidence recorded with the delivery

- Focused gate: `node scripts/check.mjs && node --test tests/auth-006-context.test.mjs`
  → PASS, 8/8, exit 0, Node v24.19.0, disposable PostgreSQL 18.6 on
  `127.0.0.1:55432`.
- The tests install the accepted `20`/`021`/`30`/`031`/`032` RLS stack and use real
  non-owner `saven_auth_service` and `saven_customer_app` logins.
- Regressions: AUTH-002 18/18, AUTH-003 27/27, AUTH-004 21/21, AUTH-005 27/27.
- Combined serial run (`--test-concurrency=1`): 101 tests, 101 pass, 0 fail.
- Coverage: forged headers/query/body, tenantB nonmember, company/resource denial, pool
  reuse after commit and rollback, stale membership/epoch, read-valid-then-revoked session,
  credential-epoch change, max=1 business pool, uncertain COMMIT destruction.
- Cleanup: disposable cluster stopped and deleted; `node_modules` removed; worktree clean
  at checkpoint time.
- Merge state: AUTH-006 not merged; `testing-1` remains `1b9ff78`.

## Where I stopped

Last completed step: committed `dc690f5`, then the delivery report and this checkpoint.
No further code, tests, merges or new contracts started after that.

## Exact next step

1. Await the Codex verdict on AUTH-006 (expected on
   `origin/codex/pivot-003-rulings`).
2. On **ACCEPT**: nothing further from me for AUTH-006; it queues for a human Business
   Merge Request (dispatcher issues any merge command separately).
3. On **REVISE**: fetch the rulings branch, read the new review in full, apply exactly the
   scoped corrections inside the AUTH-006 TOUCH, re-run the focused gate plus
   AUTH-002/003/004/005, update `docs/contractor/deliveries/AUTH-006-tenant-context.md`,
   commit and push on `opencode/auth-006-context`, and stop without merging.

Open items still needing the engineer (not blocking this checkpoint): close the residual
membership-epoch window between resolution and the business transaction with an
auth-readable definer function in a later migration contract; add a tenant-selection audit
event vocabulary under AUTH-009/reference data; company/resource policy and business
feature wiring remain future contracts. No load/PgBouncer-instance claim is made.
