CONTRACT: docs/contractor/contracts/PIVOT-007-operator-functions.md
REVISION: R1 against review `16be2ae` (REVISE, five findings)
STATUS: 4 findings DONE, finding 1 PARTIAL — the SQL/authority side is hardened and the bounded commit-before-disclosure adapter design is supplied, but the source module is outside TOUCH and, per the review, must not be added before an engineer amendment. No merge performed.

## Identity

- Branch: `opencode/pivot-007-operator-functions`
- Worktree: `/home/esc/saven/wt-pivot-007`
- Base SHA (`testing-1`): `e0fa9fbb0eaaa1d96046aafbb33963e6732f347a`
- Revision implementation SHA: `c96376d4133cb4f524464d11ce11645adf6f2dc3`
- Report/checkpoint commit: this commit

## Files changed vs TOUCH

| Path | Change |
| --- | --- |
| `db/postgres/50-functions.sql` | Revision 1: bearer digest proof, versioned read policy, consent gate + six triggers, runtime writer-protocol validation, exact-authority validator, hardened read/denial functions. |
| `db/postgres/README.md` | Revised PIVOT-007 section, run-order/policy seed, definer surface, bounded adapter design. |
| `tests/pivot-007-operator-access.test.mjs` | 16 focused tests covering every review counterexample. |
| `docs/contractor/deliveries/PIVOT-007-operator-functions.md` | This report. |
| `docs/contractor/state/worker-a-checkpoint.md` | Round-end checkpoint. |

No applied migration, source module, fixture, workflow or reference file was modified. No AUTH-007/033 bytes were rewritten. No EXECUTE grant was added to auth-service.

## Per-finding enumeration

### Finding 1 — real admission and commit-before-disclosure — PARTIAL

**DONE (SQL side).** The payload now requires `p_session_proof`, the lowercase SHA-256 digest of the raw operator session token, and compares it with `auth.sessions.token_hash`. A UUID alone is refused; a valid UUID for another operator plus a different bearer digest is refused. Issuer/audience/assurance/source-age are read from the configured versioned policy, not inferred. Raw bearer values never appear in arguments, audit payloads or results (only the session UUID and digest-verified subject).

**PARTIAL (publication side).** SQL cannot commit inside a caller's transaction, and the review explicitly says not to add a source module or relax the EXECUTE allow-list before a bounded amendment. The bounded design is in `db/postgres/README.md` ("Mediated adapter"): `src/operator/support-read.mjs` must resolve the bearer through AUTH-007, call `admitSession` and the SQL read on the **same owned client/transaction** (no nested size-one checkout), `COMMIT` before returning any row, discard rows on COMMIT uncertainty, and log refusals on a fresh connection in a separate transaction with observable logging failure. This is not implemented and is not claimed as enforced.

**Named tests:** `PIVOT-007 requires a bearer-derived proof, not a caller-nominated session UUID`; `PIVOT-007 reads a granted tenant only with the bearer-derived proof and commits one audit`; `PIVOT-007 commits read and audit together and records denials with independent durability` (explicitly proves rollback pairing, not disclosure prevention).

### Finding 2 — exact AUTH-007 authority and trusted time — DONE

Implemented: `credential_version` equality; configured issuer/audience/exact assurance/max source age/clock skew from `operator.access_read_policy`; trusted `clock_timestamp()` sampled after gate/principal/session acquisitions; runtime validation of the exclusive gate body/owner and every gated trigger (`tgenabled = 'O'`, exact function, exact BEFORE/STATEMENT event); fail-closed on missing/disabled/replica-only/misbound protections.

**Named tests:** `PIVOT-007 revalidates credential epochs and session liveness exactly`; `PIVOT-007 enforces configured issuer, audience, exact assurance, source age and policy state`; `PIVOT-007 samples trusted time after blocking acquisitions and denies a session that expires while waiting`; `PIVOT-007 fails closed when the installed authority/consent writer protocol is disabled, replica-only or misbound` (includes a tampered gate body).

### Finding 3 — consent reservation through read/audit — DONE

Implemented a cooperative consent gate: reads hold `saven.operator.consent_gate` shared; `BEFORE STATEMENT` triggers on `tenant_data.support_grants` and `tenant_data.members` hold it exclusive for INSERT/UPDATE/DELETE. Grant window, scope, action and authoring-member activity are revalidated after acquisition; disabling the trigger fails the read closed. The protocol (grant row before member row) is documented.

**Named tests:** `PIVOT-007 serializes customer consent writes against in-flight reads` (read-first writer blocks with `55P03`; committed revocation/narrowing/deactivation observed; verified denial audit); protocol-disable cases in the protocol test.

### Finding 4 — reused definer authority validated — DONE

Implemented `operator.assert_operator_definer_authority(stage, allow_bootstrap)`: role flags/settings, direct/transitive memberships, owned objects, schema/database/default ACLs, the complete table/column/sequence/function ACL set, PUBLIC relation/column/SECURITY-DEFINER reachability, and the known bootstrap grants. Pre-stage accepts only the bootstrap set; the payload revokes the broad operator SELECT/sequence grants and re-grants the enumerated minimum; post-stage requires exact equality and refuses excess without stripping unrelated rights. Runtime protocol validation also rechecks membership/ownership/schema-CREATE/settings drift.

**Named tests:** `PIVOT-007 installs exactly the reviewed definer authority surface and EXECUTE allow-list`; `PIVOT-007 refuses a poisoned definer profile before installation and preserves it` (membership, column ACL, schema CREATE, ownership, default privilege, role setting, PUBLIC SECURITY DEFINER path, incompatible LOGIN role; poison preserved on refusal).

### Finding 5 — denial attribution — DONE

Denial logging now verifies digest, session liveness, credential epoch, mapping generation/user continuity, role/assurance, issuer/audience and policy before attribution. Otherwise `actor_id = 'unverified'`, `attribution = 'unverified'`, no verified subject/role/epoch, and only labelled `claimedSubject`/`claimedSessionId` metadata. It remains usable when read authority fails and grants no tenant access.

**Named tests:** `PIVOT-007 denial attribution never invents a current actor from a stale binding` (reassignment, epoch-stale, revoked session, unknown session, verified positive).

### Additional review checks — DONE

- Exact scope typing without `->>` coercion; non-string resources/companies/actions, string version, unknown keys, malformed arrays fail closed.
- `business` and `accounts` declared tenant-wide and reject a company selector; `company_profiles`/`journals`/`journal_lines` are company-scoped.
- Accepted `040/041/042` + `40-triggers` composition and customer-consent audit coexistence.
- **Named tests:** `PIVOT-007 validates scope JSON typing exactly and declares tenant-wide resources`; `PIVOT-007 refuses wrong tenant, company, action, resource and malformed arguments`; `PIVOT-007 applies company scope, exact minor-unit money and bounded row limits`; `PIVOT-007 composes with the accepted 040/041/042 stack and audits customer consent writes`.

## Gates — exact commands and results

Environment: Node `v24.19.0` (`/tmp/auth009-node/node-v24.19.0-linux-x64/bin`; host default v22 does not satisfy the engine), PostgreSQL `18.6`, disposable loopback cluster `127.0.0.1:55435`, `SAVEN_PIVOT_TEST_CLUSTER=1`.

```text
$ node scripts/check.mjs
PASS: 173 JavaScript files parsed; package manifest valid.
EXIT=0

$ SAVEN_PIVOT_TEST_CLUSTER=1 PGHOST=127.0.0.1 PGPORT=55435 PGUSER=esc PGSSLMODE=disable \
    node --test tests/pivot-007-operator-access.test.mjs
✔ PIVOT-007 installs exactly the reviewed definer authority surface and EXECUTE allow-list (411ms)
✔ PIVOT-007 reads a granted tenant only with the bearer-derived proof and commits one audit (424ms)
✔ PIVOT-007 requires a bearer-derived proof, not a caller-nominated session UUID (464ms)
✔ PIVOT-007 revalidates credential epochs and session liveness exactly (472ms)
✔ PIVOT-007 enforces configured issuer, audience, exact assurance, source age and policy state (556ms)
✔ PIVOT-007 samples trusted time after blocking acquisitions and denies a session that expires while waiting (2205ms)
✔ PIVOT-007 fails closed when the installed authority/consent writer protocol is disabled, replica-only or misbound (534ms)
✔ PIVOT-007 validates scope JSON typing exactly and declares tenant-wide resources (565ms)
✔ PIVOT-007 refuses wrong tenant, company, action, resource and malformed arguments (506ms)
✔ PIVOT-007 applies company scope, exact minor-unit money and bounded row limits (474ms)
✔ PIVOT-007 ignores caller search_path and temporary relation shadows (438ms)
✔ PIVOT-007 commits read and audit together and records denials with independent durability (457ms)
✔ PIVOT-007 serializes customer consent writes against in-flight reads (750ms)
✔ PIVOT-007 denial attribution never invents a current actor from a stale binding (457ms)
✔ PIVOT-007 refuses a poisoned definer profile before installation and preserves it (497ms)
✔ PIVOT-007 composes with the accepted 040/041/042 stack and audits customer consent writes (609ms)
ℹ tests 16
ℹ pass 16
ℹ fail 0
EXIT=0
```

No known out-of-scope failure observed in the recorded run. The composition test installs accepted `040/041/042`, activates `40-triggers.sql`, then applies `50-functions.sql` in the production order.

## Coverage and limits

Proven: all named scenarios above against real fixture roles/RLS, including concurrency blocking, poisoned-profile refusal with preservation, gate/trigger tamper fail-closed, configured policy enforcement, trusted-time expiry after a blocked wait, exact denial attribution and full-stack audit coexistence.

Not proven / explicitly excluded:

- **Commit-before-disclosure**: requires the bounded `src/operator/support-read.mjs` adapter and its own tests; finding 1 remains PARTIAL.
- No HTTP route, UI, cookie handling, OpenAPI entry point or live operator session acquisition.
- No bulk export, search, write, impersonation or arbitrary table read.
- Denial durability still depends on the adapter calling the logging function in a fresh transaction; SQL cannot provide an autonomous transaction.
- AUTH-007 issuer/audience pinning is duplicated as versioned deployment policy data for the DB boundary; the two must be kept consistent operationally.

## Deviations / narrowing decisions

- Added `operator.access_read_policy`, the consent gate/triggers and an internal protocol validator inside TOUCH. The policy table is deployment data and must be seeded; missing policy fails closed.
- Revoked the inherited broad bootstrap operator grants from the definer and re-granted the enumerated minimum. This is a narrowing of the definer's own surface, not a change to other roles; no applied SQL was edited.
- Two lock-only UPDATE column grants remain (`auth.users.status`, `auth.sessions.revoked_at`) and are enumerated in the validator; they exist solely for `FOR SHARE`.
- Denial `actor_id` is the local identity UUID because the operator-audit column limit is 200 chars while an Access subject may be 320; the verified subject is retained in the payload.
- No source module was added without the required engineer amendment.

## Local environment note

A gitignored `node_modules` symlink to the repository installation was used for local gates and is not staged. The disposable cluster was `127.0.0.1:55435` with `esc` as administrative test principal. No production/client database was touched.
