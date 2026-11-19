# WORKER-A checkpoint — PIVOT-007 revision 2 (review 4d0d7fc, amended TOUCH)

Date: 20 November 2026 (Asia/Karachi). Round-end checkpoint.

## Exact contract

- `docs/contractor/contracts/PIVOT-007-operator-functions.md` (engineer amendment 19 Nov 2026)
- Base `testing-1` @ `e0fa9fb`; branch `opencode/pivot-007-operator-functions` @
  `/home/esc/saven/wt-pivot-007`.
- TOUCH: `db/postgres/50-functions.sql`, `db/postgres/README.md`,
  `tests/pivot-007-operator-access.test.mjs`, `src/operator/support-read.mjs`,
  `src/operator/README.md`.
- Revision implementation SHA: `98629ac89db171f4dd5e1e0d8ff60230787468e3`.
- Delivery report: `docs/contractor/deliveries/PIVOT-007-operator-functions.md`.

## Review findings — status

| # | Finding | Status | Named tests |
| --- | --- | --- | --- |
| 1 | Real admission / commit-before-disclosure | **DONE** — `src/operator/support-read.mjs` approved adapter: AUTH-007 preflight, owned operator-read tx, policy/identity drift refusal, COMMIT-before-return, client destruction, separate-tx denial, observable logging failure | 8 adapter tests listed in the report |
| 2 | Exact AUTH-007 authority/trusted time | **DONE** — consent gate before final clock; all expiry checked after last wait; exact trigger/function profile; fixed `access_mfa`; policy fingerprint | `revalidates the whole authority set after the consent-gate wait`; `rejects conditional, column-scoped or re-profiled writer triggers/functions`; prior authority tests |
| 3 | Consent/author lifecycle serialization | **DONE** — shared gate through read/audit COMMIT; writer blocks until publication; reservation and conditional-trigger tests | `serializes customer consent writes against in-flight reads`; `adapter reserves customer consent through publication COMMIT` |
| 4 | Reused definer authority | **CLOSED (retained)** — no weakening; validator/poison tests still pass | `installs exactly the reviewed definer authority surface…`; `refuses a poisoned definer profile…` |
| 5 | Denial attribution | **DONE** — current `auth.roles` operator/active/MFA/effective validation; weak roles labelled unverified | `denial attribution never invents a current actor from a stale binding`; `denial role evidence is current, never historical authorization` |

## Gate evidence

- `node scripts/check.mjs` → `PASS: 174 JavaScript files parsed; package manifest valid.`
- `node --test tests/pivot-007-operator-access.test.mjs` → **27/27** pass, 0 fail.
- Environment: Node v24.19.0, PostgreSQL 18.6, disposable loopback cluster 55435,
  `SAVEN_PIVOT_TEST_CLUSTER=1`.
- Adapter tests use real signed AUTH-007 assertions/exchange and separate temporary
  restricted logins inside the disposable database.

## Where I stopped

Revision delivered and pushed; not merged. No known failing test or outstanding finding
from this review. Finding 4 remains the reviewer-closed profile; no applied migration bytes
were edited.

## Exact next step

1. Codex reviews `98629ac` per finding; the adapter is now implemented under the amendment.
2. PIVOT-008 follows on its own branch; do not merge without the human-approved dispatcher
   command.
3. Deployment must seed `operator.access_read_policy` and pass the same values as the
   adapter's `expectedPolicy`; drift fails closed.
