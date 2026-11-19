# WORKER-A checkpoint — PIVOT-007 revision 3 (review 92f3e00)

Date: 20 November 2026 (Asia/Karachi). Round-end checkpoint.

## Exact contract

- `docs/contractor/contracts/PIVOT-007-operator-functions.md` (19–20 Nov amendments)
- Base `testing-1` @ `e0fa9fb`; branch `opencode/pivot-007-operator-functions` @
  `/home/esc/saven/wt-pivot-007`.
- TOUCH: `db/postgres/50-functions.sql`, `db/postgres/README.md`,
  `tests/pivot-007-operator-access.test.mjs`, `src/operator/support-read.mjs`,
  `src/operator/README.md`, `src/auth/access.mjs` (metadata-only amendment).
- Revision implementation SHA: `102e39a54e3bb129b7b0c0165b13dfe541396929`.
- Delivery report: `docs/contractor/deliveries/PIVOT-007-operator-functions.md`.

## Review findings — status

| # | Finding | Status | Named tests |
| --- | --- | --- | --- |
| 2a | Actual AUTH-007 source-age/skew policy | **DONE** — validator exposes captured immutable descriptor; adapter compares actual issuer/audience/access_mfa/age/skew with expected and SQL fingerprint; mismatch + boundary tests | `adapter compares the actual AUTH-007 age/skew descriptor, not expected values`; `adapter refuses post-preflight source-age boundary crossing with a permitted control` |
| 2b | Policy effective window after final wait | **DONE** — policy-writer gate + triggers; policy selected with final `clock_timestamp()` after all gates; expiry-during-wait and writer-blocking tests | `revalidates policy expiry after the consent-gate wait and serializes policy writers`; policy-trigger disable in protocol test |
| 2c | Early bearer refusals | **DONE** — missing/short/oversize bearer records unverified denial, no secret echo, outage observable | `adapter records early bearer refusals and exposes logging outage` |
| 3 | Consent reservation | **CLOSED retained** — shared gate through COMMIT; writer blocking/revocation tests still pass | `serializes customer consent writes against in-flight reads`; `adapter reserves customer consent through publication COMMIT` |
| 4 | Definer profile | **CLOSED retained** — no widening; validator/poison tests pass | `installs exactly the reviewed definer authority surface…`; `refuses a poisoned definer profile…` |
| 5 | Denial attribution | **CLOSED retained** — current role/assurance/MFA/effective validation | `denial role evidence is current…`; `denial attribution never invents…` |

## Gate evidence

- `node scripts/check.mjs` → `PASS: 174 JavaScript files parsed; package manifest valid.`
- `node --test tests/pivot-007-operator-access.test.mjs` → **31/31** pass, 0 fail.
- `node --test tests/auth-007-access.test.mjs` → **22/22** pass (metadata-only regression).
- Environment: Node v24.19.0, PostgreSQL 18.6, disposable loopback cluster 55435,
  `SAVEN_PIVOT_TEST_CLUSTER=1`.

## Where I stopped

Revision delivered and pushed; not merged. No known failing test. Publication tests now use
an entered-COMMIT barrier rather than fixed sleeps. Test logins are namespaced cluster roles
created/dropped on the disposable cluster (not inside the database) and are not credentials.

## Exact next step

1. Codex reviews `102e39a` against the two remaining policy-authority findings.
2. PIVOT-008 follows on its own branch; no merge without the human-approved dispatcher command.
3. Deployment must seed `operator.access_read_policy` and pass the same actual AUTH-007
   issuer/audience/`access_mfa`/source-age/skew to the adapter; drift fails closed.
