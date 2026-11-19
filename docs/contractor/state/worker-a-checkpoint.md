# WORKER-A checkpoint — PIVOT-007 revision 1 (review 16be2ae)

Date: 19 November 2026 (Asia/Karachi). Round-end checkpoint.

## Exact contract

- `docs/contractor/contracts/PIVOT-007-operator-functions.md`
- Base `testing-1` @ `e0fa9fb`; branch `opencode/pivot-007-operator-functions` @
  `/home/esc/saven/wt-pivot-007`.
- TOUCH: `db/postgres/50-functions.sql`, `db/postgres/README.md`,
  `tests/pivot-007-operator-access.test.mjs`.
- Revision implementation SHA: `c96376d4133cb4f524464d11ce11645adf6f2dc3`.
- Delivery report: `docs/contractor/deliveries/PIVOT-007-operator-functions.md`.

## Review findings — status

| # | Finding | Status | Named tests |
| --- | --- | --- | --- |
| 1 | Real admission / commit-before-disclosure | **PARTIAL** — bearer-digest proof and SQL revalidation done; publication adapter is a bounded design requiring source TOUCH amendment | `requires a bearer-derived proof, not a caller-nominated session UUID`; `reads a granted tenant only with the bearer-derived proof and commits one audit`; `commits read and audit together and records denials with independent durability` |
| 2 | SQL weaker than AUTH-007 (credential, issuer/audience/source-age, assurance, trusted time, gate validation) | **DONE** | `revalidates credential epochs and session liveness exactly`; `enforces configured issuer, audience, exact assurance, source age and policy state`; `samples trusted time after blocking acquisitions and denies a session that expires while waiting`; `fails closed when the installed authority/consent writer protocol is disabled, replica-only or misbound` |
| 3 | Consent checked but not reserved | **DONE** (consent-writer advisory gate + six triggers, shared read side, post-acquisition revalidation) | `serializes customer consent writes against in-flight reads` |
| 4 | Reused definer authority not validated | **DONE** (complete pre/post surface enumeration; runtime drift checks) | `installs exactly the reviewed definer authority surface and EXECUTE allow-list`; `refuses a poisoned definer profile before installation and preserves it` |
| 5 | Denial actor can invent current attribution | **DONE** (verified/unverified split; claimed metadata only) | `denial attribution never invents a current actor from a stale binding` |
| — | Additional: exact JSON typing, tenant-wide declarations, full-stack composition | **DONE** | `validates scope JSON typing exactly and declares tenant-wide resources`; `composes with the accepted 040/041/042 stack and audits customer consent writes` |

## Gate evidence

- `node scripts/check.mjs` → `PASS: 173 JavaScript files parsed; package manifest valid.`
- `node --test tests/pivot-007-operator-access.test.mjs` → **16/16** pass, 0 fail.
- Environment: Node v24.19.0, PostgreSQL 18.6, disposable loopback cluster 55435,
  `SAVEN_PIVOT_TEST_CLUSTER=1`.
- Composition test installs accepted 040/041/042, activates 40-triggers, then applies 50.

## Where I stopped

Revision delivered and pushed; not merged. Finding 1 is deliberately PARTIAL: the review
requires a bounded adapter/ownership design and an engineer TOUCH amendment before adding a
source module or relaxing the EXECUTE allow-list. The design (same-client admission+read,
COMMIT before returning rows, discard on COMMIT uncertainty, separate-transaction denial
logging with observable failure) is recorded in `db/postgres/README.md` and the delivery
report. No source file was added.

No outstanding failing test from the recorded run. Development-time failures (validator ACL
expectations, missing column grants for `FOR SHARE`, column-name ambiguity, gate search_path)
were fixed before the recorded gates.

## Exact next step

1. Codex reviews `c96376d` per finding; finding 1 remains PARTIAL until the adapter lane is
   authorized and tested.
2. PIVOT-008 follows on its own branch; do not merge without the human-approved dispatcher
   command.
3. Deployment must seed `operator.access_read_policy` (issuer, audience, exact assurance,
   source age/skew) before any operator read can succeed.
