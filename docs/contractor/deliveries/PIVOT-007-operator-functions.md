CONTRACT: docs/contractor/contracts/PIVOT-007-operator-functions.md (engineer amendment 19 November 2026)
REVISION: R2 against review `4d0d7fc` (PIVOT-007-R1), amended TOUCH
STATUS: DONE — finding 1 completed with the authorized publishing adapter; finding 2 residuals closed; finding 3 closure tested through publication COMMIT; finding 4 retained closed; finding 5 residual role attribution closed. No merge.

## Identity

- Branch: `opencode/pivot-007-operator-functions`
- Worktree: `/home/esc/saven/wt-pivot-007`
- Base SHA (`testing-1`): `e0fa9fbb0eaaa1d96046aafbb33963e6732f347a`
- Revision implementation SHA: `98629ac89db171f4dd5e1e0d8ff60230787468e3`
- Report/checkpoint commit: this commit
- Amended TOUCH: `db/postgres/50-functions.sql`, `db/postgres/README.md`,
  `tests/pivot-007-operator-access.test.mjs`, `src/operator/support-read.mjs`,
  `src/operator/README.md`.

## Files changed vs amended TOUCH

| Path | Change |
| --- | --- |
| `db/postgres/50-functions.sql` | Final-clock ordering, exact trigger/function profile validation, fixed `access_mfa` policy invariant, policy fingerprint/current-role denial validation, result policy/operator identity. |
| `db/postgres/README.md` | Adapter now implemented; final-clock/consent ordering, policy invariant and authority checks documented. |
| `src/operator/support-read.mjs` | New bounded publishing adapter: AUTH-007 preflight, owned operator-read transaction, policy/identity drift refusal, COMMIT-before-return, client destruction, separate-transaction denial with observable failure. |
| `src/operator/README.md` | Adapter API, transaction/failure protocol, errors, boundaries, extension points and non-claims. |
| `tests/pivot-007-operator-access.test.mjs` | 27 focused tests including real AUTH-007 JWT exchange, commit/rollback/audit faults, size-one pool and consent reservation through COMMIT. |
| `docs/contractor/deliveries/PIVOT-007-operator-functions.md` | This report. |
| `docs/contractor/state/worker-a-checkpoint.md` | Round-end checkpoint. |

No applied migration bytes, auth source, existing entry point, shared fixture or other path was modified. No auth-service EXECUTE grant or combined auth/operator login was added.

## Per-finding enumeration

### Finding 1 — real admission and commit-before-disclosure — DONE

`src/operator/support-read.mjs` implements the approved bounded adapter:

- verifies the genuine bearer through accepted AUTH-007 `inspectSession(token)`, which runs on the separate restricted auth-service login and completes/releases its own transaction; it is never treated as the final authority;
- opens one client from the separate restricted operator-read login, `BEGIN`s, sets `app.operator_session_id` transaction-locally, and calls the constrained SQL function on that same owned transaction with the SHA-256 bearer digest;
- compares the SQL policy fingerprint and verified subject/role/assurance against the configured policy and the AUTH-007 preflight before committing; any drift refuses;
- `COMMIT`s before returning any row; COMMIT failure returns `OPERATOR_PUBLICATION_UNCERTAIN` with all rows discarded;
- on refusal, rolls back (best effort), destroys that exact client, releases it, and only then writes denial evidence in a separate transaction; denial failure is exposed as `denialLoggingFailed` while the original refusal is preserved;
- supports size-one pools by releasing the read client before the denial checkout; never logs raw bearer values, digests or row payloads; adds no HTTP/UI entry point.

**Named tests:** `PIVOT-007 adapter publishes rows only after COMMIT through real AUTH-007 exchange`; `PIVOT-007 adapter withholds rows until COMMIT and discards them on COMMIT failure`; `PIVOT-007 adapter logs refusals durably and reuses a size-one clean borrower`; `PIVOT-007 adapter exposes denial-logging failure without suppressing the refusal`; `PIVOT-007 adapter refuses policy drift before COMMIT and keeps rows private`; `PIVOT-007 adapter rejects unverified bearers and never exposes bearer material`; `PIVOT-007 adapter reserves customer consent through publication COMMIT`; `PIVOT-007 adapter survives a rollback fault and still records the refusal`.

### Finding 2 — exact AUTH-007 authority and trusted time — DONE

Residuals closed:

- the consent gate is now acquired **before** the final trusted-time sample; every blocking acquisition (auth gate, principal/session locks, consent gate) precedes all identity/session/source/grant expiry checks;
- `assert_read_authority_protocol` now validates unconditional statement triggers (`tgqual IS NULL`), zero arguments/columns, no deferral/constraint, origin-only firing, and the exact invoker/plpgsql/trigger/`search_path=pg_catalog` function profile, in addition to owner/body checks;
- `required_assurance` is pinned to `access_mfa` by a table CHECK and rechecked by the read/denial functions and the adapter constructor, so a coherent weaker-label rewrite is impossible;
- policy identity/version/fingerprint is returned by SQL and compared by the adapter with the configured policy and preflight binding.

**Named tests:** `PIVOT-007 revalidates the whole authority set after the consent-gate wait`; `PIVOT-007 rejects conditional, column-scoped or re-profiled writer triggers/functions`; plus the prior `revalidates credential epochs…`, `enforces configured issuer, audience, exact assurance…`, `samples trusted time after blocking acquisitions…` and protocol fail-closed tests.

### Finding 3 — consent/author lifecycle serialization — DONE

The consent gate is held shared from before the final time checks through read/audit COMMIT. The adapter reservation test pauses at COMMIT and proves a concurrent customer revocation hits `lock timeout` (`55P03`) until publication commits; afterwards the revocation commits and the next read refuses. The mixed writer order remains authority gate → consent gate → row work; trigger conditional/misbinding attacks are refused.

**Named tests:** `PIVOT-007 serializes customer consent writes against in-flight reads`; `PIVOT-007 adapter reserves customer consent through publication COMMIT`; `PIVOT-007 rejects conditional, column-scoped or re-profiled writer triggers/functions`.

### Finding 4 — reused definer authority — RETAINED CLOSED

No weakening. The policy table, consent triggers and final grants are inside the already-enumerated surface; the pre/post validator and poisoned-profile tests still pass. **Named tests:** `PIVOT-007 installs exactly the reviewed definer authority surface and EXECUTE allow-list`; `PIVOT-007 refuses a poisoned definer profile before installation and preserves it`.

### Finding 5 — denial attribution — DONE

Denial logging now also reads `auth.roles` and requires a current operator role: `is_operator`, `is_active`, `requires_mfa`, effective window. Disabled, non-operator, non-MFA and expired roles produce `actor_id = 'unverified'` with no verified subject/role/epoch; a valid current-operator positive is verified. Claimed session/subject metadata remains labelled, and no digest is stored.

**Named tests:** `PIVOT-007 denial attribution never invents a current actor from a stale binding`; `PIVOT-007 denial role evidence is current, never historical authorization`.

### Retained prior coverage

Scope typing/tenant-wide projections, exact money, search_path/temp shadows, direct-access denial, poisoned profiles, full `040/041/042` + dispatcher composition and customer-consent audit coexistence remain passing.

## Gates — exact commands and results

Environment: Node `v24.19.0`, PostgreSQL `18.6`, disposable loopback cluster `127.0.0.1:55435`, `SAVEN_PIVOT_TEST_CLUSTER=1`.

```text
$ node scripts/check.mjs
PASS: 174 JavaScript files parsed; package manifest valid.
EXIT=0

$ SAVEN_PIVOT_TEST_CLUSTER=1 PGHOST=127.0.0.1 PGPORT=55435 PGUSER=esc PGSSLMODE=disable \
    node --test tests/pivot-007-operator-access.test.mjs
✔ PIVOT-007 installs exactly the reviewed definer authority surface and EXECUTE allow-list (412ms)
✔ PIVOT-007 reads a granted tenant only with the bearer-derived proof and commits one audit (426ms)
✔ PIVOT-007 requires a bearer-derived proof, not a caller-nominated session UUID (465ms)
✔ PIVOT-007 revalidates credential epochs and session liveness exactly (479ms)
✔ PIVOT-007 enforces configured issuer, audience, exact assurance, source age and policy state (548ms)
✔ PIVOT-007 samples trusted time after blocking acquisitions and denies a session that expires while waiting (2213ms)
✔ PIVOT-007 fails closed when the installed authority/consent writer protocol is disabled, replica-only or misbound (507ms)
✔ PIVOT-007 validates scope JSON typing exactly and declares tenant-wide resources (633ms)
✔ PIVOT-007 refuses wrong tenant, company, action, resource and malformed arguments (513ms)
✔ PIVOT-007 applies company scope, exact minor-unit money and bounded row limits (500ms)
✔ PIVOT-007 ignores caller search_path and temporary relation shadows (453ms)
✔ PIVOT-007 commits read and audit together and records denials with independent durability (473ms)
✔ PIVOT-007 serializes customer consent writes against in-flight reads (750ms)
✔ PIVOT-007 denial attribution never invents a current actor from a stale binding (459ms)
✔ PIVOT-007 refuses a poisoned definer profile before installation and preserves it (492ms)
✔ PIVOT-007 composes with the accepted 040/041/042 stack and audits customer consent writes (624ms)
✔ PIVOT-007 revalidates the whole authority set after the consent-gate wait (2817ms)
✔ PIVOT-007 rejects conditional, column-scoped or re-profiled writer triggers/functions (435ms)
✔ PIVOT-007 denial role evidence is current, never historical authorization (476ms)
✔ PIVOT-007 adapter publishes rows only after COMMIT through real AUTH-007 exchange (688ms)
✔ PIVOT-007 adapter withholds rows until COMMIT and discards them on COMMIT failure (739ms)
✔ PIVOT-007 adapter logs refusals durably and reuses a size-one clean borrower (521ms)
✔ PIVOT-007 adapter exposes denial-logging failure without suppressing the refusal (488ms)
✔ PIVOT-007 adapter refuses policy drift before COMMIT and keeps rows private (472ms)
✔ PIVOT-007 adapter rejects unverified bearers and never exposes bearer material (439ms)
✔ PIVOT-007 adapter reserves customer consent through publication COMMIT (1003ms)
✔ PIVOT-007 adapter survives a rollback fault and still records the refusal (493ms)
ℹ tests 27
ℹ pass 27
ℹ fail 0
EXIT=0
```

The adapter tests use real signed AUTH-007 assertions/exchange and separate temporary restricted `auth_service` and `operator_read` logins created inside the disposable database; no credentials are committed.

## Coverage and limits

Proven: publication only after COMMIT, rows withheld/discarded on COMMIT uncertainty, rollback fault survival with durable denial, denial-logging failure observability, policy drift refusal, size-one clean borrower, real bearer admission, consent reservation through COMMIT, final-clock expiry after both gates, conditional/mis-bound/re-profiled trigger refusal, current-role denial attribution, and all prior SQL/consent/authority tests.

Not claimed / out of scope: no HTTP route, UI, cookie handling, OpenAPI, live operator login or production activation; no pooler-mode availability claim; no autonomous denial durability beyond the separate transaction; no guarantee against deliberate offline-owner tampering. The adapter requires the deployment to seed `operator.access_read_policy` and to pass the same values as `expectedPolicy`; drift fails closed.

## Deviations / narrowing decisions

- `access_mfa` is now a database CHECK invariant rather than a configurable label, per the review.
- The adapter adds a policy fingerprint comparison but does not gain any new SQL privilege; it uses the existing constrained function on a separate restricted login.
- Temporary test logins are created/dropped inside the disposable fixture database only; no runtime role or password is committed.
- No source file outside the amended TOUCH was added.

## Local environment note

A gitignored `node_modules` symlink was used for local gates and is not staged. The disposable cluster was `127.0.0.1:55435` with `esc` as administrative test principal. No production/client database was touched.
