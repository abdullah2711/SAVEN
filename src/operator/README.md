# Operator support read adapter (PIVOT-007)

`src/operator/support-read.mjs` is the bounded server-side publishing adapter for
customer-granted operator reads. It is **not** an HTTP route, UI, gateway or operator login.
It composes two accepted boundaries that stay deliberately separate:

1. **AUTH-007 operator inspection** (`inspectSession(token)`) verifies the genuine bearer,
   resolves the current operator session/binding/mapping and completes its own transaction.
   That preflight is **not** authoritative for the tenant read.
2. **PIVOT-007 SQL boundary** (`operator.read_tenant_support`) independently revalidates the
   same durable AUTH-007 facts, the configured policy and the current customer grant on the
   restricted operator-read transaction, then writes the read audit atomically.

The adapter keeps rows private in server memory until the same operator-read transaction has
**committed**, then returns them. SQL cannot commit inside a caller's transaction, so this
module is the publication barrier.

## Required wiring

```js
import {createOperatorSupportRead} from './src/operator/support-read.mjs';

const supportRead = createOperatorSupportRead({
  connectOperator,              // () => checked-out client from the restricted operator-read login
  inspectSession,               // AUTH-007 access.inspectSession(token), including its captured policy descriptor
  expectedPolicy: {             // must match operator.access_read_policy exactly
    version: 1,
    issuer: 'https://<verified-issuer>',
    audience: '<verified-audience>',
    requiredAssurance: 'access_mfa',
    maxSourceAgeSeconds: 300,
    maxClockSkewSeconds: 60,
  },
  maxRows: 200,
});

const result = await supportRead.read({
  token,                        // raw bearer; never logged or returned
  tenantId: '<requested tenant uuid>',
  resource: 'journals',         // one of the reviewed SQL resources
  action: 'operator.tenant.read',
  company: 'alpha',             // only for company-scoped resources
  reason: 'support case 1234',
  requestId: 'req-…',
});
// result.rows is available only after COMMIT.
```

`inspectSession` must be the accepted AUTH-007 implementation. Its result includes the
immutable `policy` descriptor captured by the real validator (`issuer`, `audience`,
`requiredAssurance: 'access_mfa'`, `maxSourceAgeSeconds`, `maxClockSkewSeconds`). The adapter
compares those actual values with `expectedPolicy` before relying on the preflight and with
the SQL policy fingerprint after the constrained read; a descriptor copied from
`expectedPolicy` is not accepted as proof. `connectOperator` **must** come from a separate restricted login that inherits only the
`operator_read` role. Do not run it on the auth-service login and do not grant auth-service
`EXECUTE` on the read functions. `inspectSession` uses the auth-service login and its own
transaction; it must not share a client with the operator-read transaction.

## Transaction and failure protocol

1. Validate the bearer shape. A missing/short/oversize bearer is an authentication refusal:
   it is recorded through the independent denial recorder with unverified actor and no proof
   before the caller sees the error. Compute the SHA-256 token digest that the SQL boundary
   uses as bearer proof; the digest is bearer-equivalent and is never logged, stored in
   results or included in errors.
2. Run AUTH-007 `inspectSession(token)` as a completed preflight. Compare its captured
   `policy` descriptor (issuer, audience, fixed assurance, source-age ceiling and skew) and
   binding with `expectedPolicy`; any mismatch is a policy refusal logged before the
   operator-read client is acquired.
3. Check out one restricted operator-read client. `BEGIN`, set
   `app.operator_session_id` transaction-locally, call the constrained SQL function on the
   **same** client/transaction.
4. Compare the SQL result's policy fingerprint and verified subject/role/assurance with the
   configured policy and preflight. Any drift refuses.
5. `COMMIT`. Only a successful COMMIT reaches the caller with rows.
6. On refusal, rollback (best effort), **destroy that exact client**, then acquire a separate
   denial transaction (after the read client is released) and call
   `operator.log_operator_read_denial` with truthful current-or-unverified attribution.
7. If denial evidence cannot be committed, the thrown error carries
   `denialEvidence.committed = false` and `denialLoggingFailed = true`. The original failure
   is preserved as `cause`; it is never suppressed by cleanup.
8. On uncertain BEGIN/COMMIT/rollback/context cleanup, rows are discarded and the client is
   destroyed. A COMMIT failure returns `OPERATOR_PUBLICATION_UNCERTAIN` and no rows.

A size-one operator pool is supported: the read client is released/destroyed before the
denial checkout, so denial logging cannot starve behind an owned client.

## Errors

`OperatorSupportReadError` carries `code`, `status`, optional `cause` and `denialEvidence`
(`{committed, code}`). Codes include the SQL refusal codes (`OPERATOR_CONTEXT_REQUIRED`,
`OPERATOR_ACCESS_DENIED`, `OPERATOR_ACCESS_EXPIRED`, `OPERATOR_POLICY_REQUIRED`,
`OPERATOR_AUTHORITY_PROTOCOL_INVALID`, `OPERATOR_GRANT_REQUIRED`,
`OPERATOR_RESOURCE_UNSUPPORTED`, `OPERATOR_ARGUMENT_INVALID`), plus adapter codes
`OPERATOR_ADMISSION_DENIED`, `OPERATOR_POLICY_DRIFT`, `OPERATOR_READ_UNAVAILABLE`,
`OPERATOR_READ_FAILED`, `OPERATOR_PUBLICATION_UNCERTAIN` and
`OPERATOR_DENIAL_LOG_FAILED` (as denial metadata).

## Security boundaries

- No operator id, subject, role or tenant is accepted as authority from the caller; the
  tenant/action/resource/company are targets the customer grant must cover.
- The mandatory assurance is `access_mfa`; the adapter and the SQL policy both reject weaker
  configurable labels.
- The adapter cannot widen SQL privileges, set a superuser/BYPASSRLS role, query tenant tables
  directly, or choose a table/column dynamically.
- The SQL boundary samples the final trusted time after the consent and policy gates, and
  selects the policy row with that time; a policy that expires during the wait fails closed.
- Raw bearer values, token digests and tenant row payloads are never logged by this module.
- No HTTP/UI activation, operator impersonation or production entry point is added.

## Extension points

- Additional reviewed read resources are SQL-side capability changes plus their column
  grants; the adapter passes the resource name and must not grow a dynamic table parameter.
- Policy changes are new versioned `operator.access_read_policy` rows and a matching
  `expectedPolicy` deployment value; both are compared by fingerprint.
- A future HTTP handler should call this module only after the AUTH-007 operator session
  cookie/token boundary has been applied; it must not reimplement transaction ordering.

## Non-claims

- No live HTTP route, UI, Cloudflare Access policy or production activation is delivered.
- The adapter does not claim availability under arbitrary pooler modes; it requires a
  transaction-scoped, owned client as documented.
- Denial durability is only as strong as the separate denial transaction; failure is
  observable but cannot retroactively create evidence.
