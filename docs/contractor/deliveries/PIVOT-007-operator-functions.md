CONTRACT: docs/contractor/contracts/PIVOT-007-operator-functions.md (engineer amendments 19–20 November 2026)
REVISION: R3 against review `92f3e00` (PIVOT-007-R2)
STATUS: DONE — actual AUTH-007 policy descriptor pinned and compared, policy window revalidated after the final wait with policy-writer serialization, and early bearer refusals durably recorded. Findings 3/4/5 remain closed. No merge.

## Identity

- Branch: `opencode/pivot-007-operator-functions`
- Worktree: `/home/esc/saven/wt-pivot-007`
- Base SHA (`testing-1`): `e0fa9fbb0eaaa1d96046aafbb33963e6732f347a`
- Revision implementation SHA: `102e39a54e3bb129b7b0c0165b13dfe541396929`
- Report/checkpoint commit: this commit
- Amended TOUCH used: `db/postgres/50-functions.sql`, `db/postgres/README.md`,
  `tests/pivot-007-operator-access.test.mjs`, `src/operator/support-read.mjs`,
  `src/operator/README.md`, `src/auth/access.mjs` (metadata-only addition).

## Files changed vs amended TOUCH

| Path | Change |
| --- | --- |
| `src/auth/access.mjs` | Metadata-only: `createAccessValidator` returns an immutable `policy` descriptor captured from the real config (issuer, audience, fixed `access_mfa`, `maxTokenAgeSeconds`, `skewSeconds`); `admitSession`/`createOperatorAccess` expose the same frozen descriptor. No validation, MFA, replay, lock, lifetime or route behavior changed. |
| `src/operator/support-read.mjs` | Compares the actual descriptor (age/skew/assurance/issuer/audience) with `expectedPolicy` before relying on preflight; early missing/short/oversize bearer refusals routed through independent unverified denial recording. |
| `db/postgres/50-functions.sql` | Policy-writer gate + three `access_read_policy` triggers; policy selection/revalidation moved after all blocking gates using final `clock_timestamp()`; protocol validation includes the policy gate. |
| `db/postgres/README.md` | Policy gate, final-clock policy window, descriptor comparison, early refusals. |
| `src/operator/README.md` | Actual-policy descriptor requirement, early refusal recording, policy-gate ordering. |
| `tests/pivot-007-operator-access.test.mjs` | 31 focused tests, including descriptor mismatch, boundary crossing, policy expiry during wait, policy-writer blocking, early bearer refusals and confirmed COMMIT barriers. |
| `docs/contractor/deliveries/PIVOT-007-operator-functions.md` | This report. |
| `docs/contractor/state/worker-a-checkpoint.md` | Round-end checkpoint. |

No applied migration bytes, route, runtime grant or combined login changed.

## Per-finding enumeration

### Finding 2a — actual AUTH-007 source-age/skew policy — DONE

- The accepted validator now exposes an immutable, secret-free descriptor derived from its captured configuration; values are not copied from `expectedPolicy`. `inspectSession`/`admitSession` return it.
- The adapter requires the descriptor and compares issuer, audience, fixed `access_mfa`, `maxSourceAgeSeconds` and `maxClockSkewSeconds` with `expectedPolicy` before acquiring the operator-read client or relying on the preflight. Missing descriptor is a policy refusal.
- The SQL policy YAML/fingerprint remains compared after the read; a weaker SQL window cannot be used because the adapter refuses the configuration drift.
- Tests deliberately mismatch the real validator's skew and source age independently from adapter/SQL and refuse. The boundary test uses a real accepted assertion at age 6 with validator/SQL policy 5+2: preflight passes, a wait crosses the 7-second threshold, and SQL refuses publication; a permitted control inside the window succeeds.

**Named tests:** `PIVOT-007 adapter compares the actual AUTH-007 age/skew descriptor, not expected values`; `PIVOT-007 adapter refuses post-preflight source-age boundary crossing with a permitted control`.

### Finding 2b — selected policy effective window after the final wait — DONE

- `operator.access_read_policy` writes now take an exclusive policy-writer gate via three `BEFORE STATEMENT` triggers; the read holds it shared through read/audit COMMIT.
- Policy selection uses the final `clock_timestamp()` after the auth/consent/policy gates; the earlier pre-wait selection was removed. The selected row's `effective_from`/`effective_to` are evaluated only with the final trusted time.
- The protocol validator requires the policy gate function profile and unconditional/origin-enabled triggers, like the auth/consent gates.
- Tests: a policy expiring while consent is blocked yields `OPERATOR_POLICY_REQUIRED` with zero published rows/success audit; a valid-policy control succeeds; an in-flight publication blocks a policy update (`55P03`) until COMMIT.

**Named tests:** `PIVOT-007 revalidates policy expiry after the consent-gate wait and serializes policy writers`; policy-trigger disable case in `PIVOT-007 fails closed when the installed authority/consent writer protocol is disabled, replica-only or misbound`.

### Finding 2c — early bearer refusals — DONE

Missing, short and oversize bearer values are now recorded through the independent denial recorder with `actor_id = 'unverified'`, no proof, no tenant read and no secret echo, before the caller receives `OPERATOR_CONTEXT_REQUIRED`. A logging outage preserves the original code/status and sets `denialLoggingFailed = true`, `denialEvidence.committed = false`.

**Named test:** `PIVOT-007 adapter records early bearer refusals and exposes logging outage`.

### Prior findings — retained closed

- **Finding 3 (consent reservation):** shared consent gate through publication COMMIT; writer blocking and post-commit revocation tests still pass.
- **Finding 4 (definer profile):** exact pre/post authority surface, narrowed bootstrap grants and poisoned-profile preservation still pass; no widening.
- **Finding 5 (denial attribution):** current-role/assurance/MFA/effective validation, unverified labelling for stale/invalid roles, no digest or raw bearer in audit.

## Gates — exact commands and results

Environment: Node `v24.19.0`, PostgreSQL `18.6`, disposable loopback cluster `127.0.0.1:55435`, `SAVEN_PIVOT_TEST_CLUSTER=1`.

```text
$ node scripts/check.mjs
PASS: 174 JavaScript files parsed; package manifest valid.
EXIT=0

$ SAVEN_PIVOT_TEST_CLUSTER=1 PGHOST=127.0.0.1 PGPORT=55435 PGUSER=esc PGSSLMODE=disable \
    node --test tests/pivot-007-operator-access.test.mjs
✔ PIVOT-007 installs exactly the reviewed definer authority surface and EXECUTE allow-list (413ms)
✔ PIVOT-007 reads a granted tenant only with the bearer-derived proof and commits one audit (423ms)
✔ PIVOT-007 requires a bearer-derived proof, not a caller-nominated session UUID (463ms)
✔ PIVOT-007 revalidates credential epochs and session liveness exactly (480ms)
✔ PIVOT-007 enforces configured issuer, audience, exact assurance, source age and policy state (542ms)
✔ PIVOT-007 samples trusted time after blocking acquisitions and denies a session that expires while waiting (2200ms)
✔ PIVOT-007 fails closed when the installed authority/consent writer protocol is disabled, replica-only or misbound (517ms)
✔ PIVOT-007 validates scope JSON typing exactly and declares tenant-wide resources (592ms)
✔ PIVOT-007 refuses wrong tenant, company, action, resource and malformed arguments (511ms)
✔ PIVOT-007 applies company scope, exact minor-unit money and bounded row limits (484ms)
✔ PIVOT-007 ignores caller search_path and temporary relation shadows (439ms)
✔ PIVOT-007 commits read and audit together and records denials with independent durability (475ms)
✔ PIVOT-007 serializes customer consent writes against in-flight reads (763ms)
✔ PIVOT-007 denial attribution never invents a current actor from a stale binding (488ms)
✔ PIVOT-007 refuses a poisoned definer profile before installation and preserves it (547ms)
✔ PIVOT-007 composes with the accepted 040/041/042 stack and audits customer consent writes (685ms)
✔ PIVOT-007 revalidates the whole authority set after the consent-gate wait (2852ms)
✔ PIVOT-007 rejects conditional, column-scoped or re-profiled writer triggers/functions (443ms)
✔ PIVOT-007 denial role evidence is current, never historical authorization (475ms)
✔ PIVOT-007 adapter publishes rows only after COMMIT through real AUTH-007 exchange (675ms)
✔ PIVOT-007 adapter withholds rows until COMMIT and discards them on COMMIT failure (605ms)
✔ PIVOT-007 adapter logs refusals durably and reuses a size-one clean borrower (515ms)
✔ PIVOT-007 adapter exposes denial-logging failure without suppressing the refusal (518ms)
✔ PIVOT-007 adapter refuses policy drift before COMMIT and keeps rows private (520ms)
✔ PIVOT-007 adapter rejects unverified bearers and never exposes bearer material (535ms)
✔ PIVOT-007 adapter reserves customer consent through publication COMMIT (797ms)
✔ PIVOT-007 adapter survives a rollback fault and still records the refusal (543ms)
✔ PIVOT-007 adapter compares the actual AUTH-007 age/skew descriptor, not expected values (615ms)
✔ PIVOT-007 adapter refuses post-preflight source-age boundary crossing with a permitted control (3015ms)
✔ PIVOT-007 revalidates policy expiry after the consent-gate wait and serializes policy writers (3043ms)
✔ PIVOT-007 adapter records early bearer refusals and exposes logging outage (508ms)
ℹ tests 31
ℹ pass 31
ℹ fail 0
EXIT=0
```

Regression check for the metadata-only auth change: `node --test tests/auth-007-access.test.mjs` → **22/22** pass.

## Evidence and limits

- Publication holds now use an entered-COMMIT barrier instead of a fixed sleep; rows remain unresolved until the real COMMIT is released. The injected COMMIT error proves conservative withholding and client destruction, not network acknowledgement loss after a server commit.
- Test logins are namespaced cluster roles created and dropped on the disposable cluster, scoped to the fixture database; the database itself is dropped by the fixture. They are not credentials and are not committed.
- No HTTP route/UI/live activation; no pooler-mode claim. Denial durability remains bounded by the separate transaction.
- Deployment must seed `operator.access_read_policy` and pass the same issuer/audience/`access_mfa`/source-age/skew as the real AUTH-007 validator configuration; the adapter compares the actual captured descriptor, not a copy of `expectedPolicy`.
- The adapter fails closed if the injected `inspectSession` does not return the accepted captured descriptor.
- No source file beyond the amended TOUCH was changed.

## Local environment note

A gitignored `node_modules` symlink was used and is not staged. No production or client database was touched.
