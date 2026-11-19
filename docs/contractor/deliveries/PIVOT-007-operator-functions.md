CONTRACT: docs/contractor/contracts/PIVOT-007-operator-functions.md
STATUS: DONE — least-privileged, customer-granted operator reads are implemented as two `SECURITY DEFINER` functions owned by `saven_operator_definer`, with atomic success audit and caller-driven independent denial evidence. No merge performed.

## Identity

- Branch: `opencode/pivot-007-operator-functions`
- Worktree: `/home/esc/saven/wt-pivot-007`
- Base SHA (`testing-1`): `e0fa9fbb0eaaa1d96046aafbb33963e6732f347a`
- Implementation SHA: `ee1b31ac235b100855562c173d9e2ceb3cd36dce`
- Report/checkpoint commit: this commit (identified in the push message)

## Files changed vs TOUCH

| Path | Change |
| --- | --- |
| `db/postgres/50-functions.sql` | New PIVOT-007 payload: preflight, enumerated definer grants, `operator.read_tenant_support()`, `operator.log_operator_read_denial()`, ownership transfer, EXECUTE allow-list, post-install validation. |
| `db/postgres/README.md` | Run order step 14, definer role description, full PIVOT-007 section, fixture/gate notes. |
| `tests/pivot-007-operator-access.test.mjs` | New focused contract test (9 tests). |
| `docs/contractor/deliveries/PIVOT-007-operator-functions.md` | This delivery report (protocol artifact, outside implementation TOUCH). |
| `docs/contractor/state/worker-a-checkpoint.md` | Round-end checkpoint (protocol artifact, outside implementation TOUCH). |

No existing SQL, migration, fixture, source route, workflow or reference file was modified. Applied migration bytes are untouched. No `40-triggers.sql` change was needed because PIVOT-007 adds no trigger.

## What was built

**Interface.** `operator.read_tenant_support(p_tenant uuid, p_resource text, p_action text, p_company text, p_reason text, p_request_id text, p_limit integer DEFAULT 200) RETURNS jsonb`. It is not a generic SQL endpoint: the resource allow-list is `business`, `company_profiles`, `accounts`, `journals`, `journal_lines`, each with an explicit column projection, a row cap (1–500) and a `truncated` flag.

**Verified actor.** The only context input is the transaction-local `app.operator_session_id` set by the application from an already-verified AUTH-007 operator session. The function resolves `operator.access_session_binding` → `operator.access_identity` → `auth.users` → `auth.roles` and revalidates: `generation-v1` binding scheme, binding/mapping generation + role + assurance equality, active mapping/principal, `is_operator`, `requires_mfa`, effective windows, non-first-factor assurance, `realm = 'operator'`, unrevoked local session, unexpired idle/absolute session, unexpired Access source assertion. It holds the AUTH-006 gate shared and locks principal then session `FOR SHARE`, so mapping/role/membership changes and session revocation cannot commit mid-read. No operator id, subject, role or tenant is accepted as authority from the caller; `p_tenant` is a target, and the function scopes `app.current_tenant_id` itself and restores the caller's prior value.

**Customer consent.** A current `tenant_data.support_grants` row must match the exact Access subject, tenant, action key, resource and company. `scope_jsonb` is versioned shape 1: `{"version":1,"resources":[...],"companies":[...]}` with unknown keys/versions/arrays failing closed; `companies` absent means all tenant companies. The authoring `granted_by_user_id` must still map to an active `tenant_data.members` row. A reason string never supplies consent and is recorded separately from the grant reason.

**Atomic success audit / independent denials.** Every successful read inserts one append-only `operator.operator_audit` row in the same transaction (local actor identity, `OPERATOR_READ`, tenant, reason, request id, subject, role, mapping generation, session, action, resource, company, grant id, counts). If the audit INSERT fails the read fails. A refused read raises a fixed code and writes nothing; the application must call `operator.log_operator_read_denial(...)` in a fresh transaction, which writes `OPERATOR_READ_DENIED` with `durability = 'independent-transaction'`. The test never asserts that a preceding in-transaction INSERT survives a rollback.

**Least privilege.** Both functions are `SECURITY DEFINER`, owned by `saven_operator_definer`, `search_path = pg_catalog, operator, tenant_data`, static schema-qualified SQL, no dynamic SQL. EXECUTE is revoked from PUBLIC and granted only to `saven_operator_read`; admin/customer/auth roles cannot execute. The definer receives enumerated column reads only, INSERT on `operator.operator_audit`, and two single-column UPDATE grants (`auth.users.status`, `auth.sessions.revoked_at`) that exist solely because PostgreSQL requires an UPDATE privilege for `FOR SHARE` locking. It owns no table, has no schema CREATE, no runtime membership, no `BYPASSRLS`, no superuser. Post-install SQL validates owner, `SECURITY DEFINER`, exact `search_path`, the allow-list and absence of PUBLIC EXECUTE.

## Gates — exact commands and results

Environment: Node `v24.19.0` (`/tmp/auth009-node/node-v24.19.0-linux-x64/bin`; host default `v22.23.5` does not satisfy `>=24.13 <25`), PostgreSQL `18.6`, disposable loopback cluster `127.0.0.1:55435`, `SAVEN_PIVOT_TEST_CLUSTER=1`.

```text
$ node scripts/check.mjs
PASS: 173 JavaScript files parsed; package manifest valid.
EXIT=0

$ SAVEN_PIVOT_TEST_CLUSTER=1 PGHOST=127.0.0.1 PGPORT=55435 PGUSER=esc PGSSLMODE=disable \
    node --test tests/pivot-007-operator-access.test.mjs
✔ PIVOT-007 installs two definer functions with a fixed search_path and a read-only EXECUTE allow-list (373ms)
✔ PIVOT-007 reads a granted tenant and commits exactly one atomic operator audit row (378ms)
✔ PIVOT-007 denies missing, forged, stale and expired operator identity (491ms)
✔ PIVOT-007 requires a current customer grant and denies expired, revoked or inactive consent (450ms)
✔ PIVOT-007 refuses wrong tenant, company, action, resource and malformed scope (510ms)
✔ PIVOT-007 applies company scope, exact minor-unit money and bounded row limits (419ms)
✔ PIVOT-007 ignores caller search_path and temporary relation shadows (389ms)
✔ PIVOT-007 rolls back read and audit together and records denials in an independent transaction (409ms)
✔ PIVOT-007 keeps tenant rows unreachable except through the mediated read and ignores caller tenant context (396ms)
ℹ tests 9
ℹ pass 9
ℹ fail 0
EXIT=0
```

No known out-of-scope failure was observed in this run. No earlier suite was modified; the fixture's default role set is unchanged.

## Coverage — proven vs excluded

Proven by the focused test (real installed roles, real SQL, disposable database):

- owner/`SECURITY DEFINER`/exact `search_path`; EXECUTE only for `saven_operator_read`; no PUBLIC/operator-admin/customer/auth EXECUTE; definer role flags all false; operator read has no `tenant_data` schema/table or audit INSERT privilege;
- successful read returns the granted rows and commits exactly one audit row with subject, role, session, grant and counts;
- missing/malformed/unknown session context, forged binding subject, stale mapping generation, non-operator/non-MFA role, first-factor-only assurance, inactive principal, revoked session and expired Access assertion all deny;
- absent, expired, revoked, inactive and ex-authorizing-member grants deny; a reason alone does not grant;
- wrong tenant, company, action and ungranted resource deny; unsupported resource, blank reason and out-of-range limit are rejected; unknown scope keys, unsupported version, non-array resources and non-array actions fail closed;
- company scope filters rows; `journal_lines` join stays inside the granted company; `999999999999` is returned as an exact JSON number; `p_limit` truncation is reported;
- temporary `support_grants` and `journals` relations plus a caller `search_path = pg_temp` cannot inject consent or rows;
- read + audit roll back together, audit-write failure fails the read, and denial evidence is durable only when written in a separate transaction;
- direct `tenant_data` SELECT, direct operator audit INSERT and `SET ROLE` to the definer are denied; the definer self-scopes tenant context while the caller's previous context is restored; audit rows reject UPDATE.

Excluded / depends on later work:

- No HTTP route, UI, session-cookie handling or OpenAPI surface: AUTH-007 owns admission and this payload owns the mediated read.
- Issuer/audience pinning and source-age policy remain AUTH-007 exchange/admission configuration; this payload revalidates the durable binding, expiry and current mapping it can prove.
- Denial durability depends on the caller invoking `log_operator_read_denial` in a fresh transaction (PostgreSQL has no autonomous transaction); no in-transaction claim is made.
- The read surface is deliberately five resources with no export, search, write, impersonation or raw-SQL mode. A new resource is a reviewed authority-surface change, not a reference row; a new scope key requires shape version 2.
- Visibility policy for financial data remains the future application RBAC / User Access Settings concern (D-014); this contract does not encode role-name visibility.

## Deviations and decisions that narrow future options

- Exactly two single-column UPDATE grants were added to the definer solely to satisfy PostgreSQL's `SELECT … FOR SHARE` privilege requirement; the definer owns no write function. Removing row locking later would remove those grants, but would also remove the revocation race protection.
- The Access actor is recorded in the audit payload; the audit `actor_id` is the local identity UUID because `operator.operator_audit.actor_id` is limited to 200 characters while an Access subject may be 320. This is documented in the README and is a deliberate schema-bound choice.
- `scope_jsonb` shape 1 requires exactly `version`, `resources` and optional `companies`; unknown keys fail closed. Supporting new scope dimensions will require a reviewed version bump rather than silently tolerating unknown keys.
- No files outside TOUCH were edited for implementation. The delivery report and checkpoint are the protocol artifacts required by `CONTRACTOR_ROLE.md`.

## Local environment note

The worktree had no `node_modules`; a gitignored symlink to the repository's installed modules was used for the local gates and is not staged or committed. The disposable test cluster was started at `127.0.0.1:55435` with `esc` as the administrative test principal; no production or client database was touched.
