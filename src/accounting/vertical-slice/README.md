# `src/accounting/vertical-slice` — authenticated journal lifecycle (PIVOT-014)

Status: one narrow PostgreSQL application lifecycle, proven by
`tests/pivot-014-vertical-slice.test.mjs`, which `scripts/check.mjs` runs on every check.
Nothing here is routed by a live entry point, and no production database is touched.

Scope: **one** company, **one** currency, a plain two-line-minimum journal, authorized
**direct** posting, read-back, and terminal void through the accepted 042 primitive. No UI,
reports, tax, multi-currency, reconciliation, inventory, trade, or approval workflow.

## Modules

| File | Role |
|---|---|
| `ports.mjs` | Interfaces and vocabulary: error taxonomy, canonical action map, exact minor-unit parsing, balance rule, canonical JSON, redaction probe. No I/O. |
| `application.mjs` | Versioned `Request → Response` handler. Exact-origin check, real session verification, tenant admission, CSRF, routing, refusal recording. Also the composition helpers over the accepted auth modules. |
| `journal-service.mjs` | Business rules and ordering: validate → authorize → allocate → persist → post/void. No SQL, no HTTP. |
| `pg-repository.mjs` | Restricted-principal SQL: transaction context, allocator, reads, 042 void call, authority evaluation. |

## Request surface (`/v1/accounting`)

| Route | Method | Behaviour |
|---|---|---|
| `/journals` | POST | Create an accepted source. `?post=1` (or `"post": true`) posts in the same authorized direct transition. `Idempotency-Key` is required and **is** the durable journal id. |
| `/journals/:id/post` | POST | Separate durable transition from `ACCEPTED_PENDING` to `POSTED`. Replaying a posted entry returns the receipt and adds nothing. |
| `/journals/:id/void` | POST | Terminal void via `tenant_data.void_posted_entry` (042). `Idempotency-Key` required. |
| `/journals/:id` | GET | Own-tenant posted entry with retained lines and void record. |
| `/journals` | GET | Own-tenant list. |
| `/audit` | GET | Canonical lifecycle stream plus physical change events; `commandId` filters by entity, `since` filters by id window. |

## Security posture

- Every request is a real `Request`: exact origin, session cookie digested and looked up in
  the accepted `auth.sessions` row, tenant admission re-read from `auth.tenant_membership`
  (status, revocation, epoch, identity status) before any business statement, CSRF on every
  mutation. A header, test principal or direct service call cannot substitute.
- The business pool logs in as `p014_app_login` and pins `SET ROLE saven_customer_app`
  (NOLOGIN, no owner, no DDL, no BYPASSRLS). Tenant context is `SET LOCAL` inside the
  transaction only; there is no session-level tenant GUC.
- `tenant_data.session_admitted` independently re-checks admission inside the business
  transaction, so the application gate is defence in depth rather than the only check.
- Refusals carry specific codes and are recorded through the accepted AUTH-009 security-audit
  boundary (`access_denied` / `session_denied`). The catalog version is pinned and a
  mismatch fails closed at composition time.

## Allocator

One counter row per `(tenant, company, kind)` in `tenant_data.document_sequences`, advanced by
`UPDATE … next_number + 1` under `SELECT … FOR UPDATE`, in its **own** short transaction so a
later rollback can never rewind an allocated identity. The consumed number is written to
`tenant_data.document_numbers` in that same short transaction, so a failed business
transaction leaves an explainable gap with retained allocation evidence. Allocation is
idempotent on the journal id: a retry reuses the identity already recorded for that id. There
is no `max(sequence)`, rowid or client-supplied derivation anywhere.

## Extension points

- **New actions/permissions:** configuration (`createJournalService({actions})`) plus
  reference/role data. No new enum in control flow; the accepted `action_type` domain is
  configuration, not code.
- **New document kinds:** `kinds` map plus reference values; the allocator is already keyed by
  kind.
- **New persistence engine:** implement the journal port (`transaction`, `reserveNumber`,
  `identity`) and compose it; the service and handler are unchanged.
- **New transport:** mount the returned handler; it is a plain Web `Request → Response`.
- **Approval workflow (deferred):** a review-required authority is currently refused with
  `APPROVAL_REQUIRED` instead of posting silently. Wiring the real approval gate is additive
  inside `requireDirectPostAuthority`.
- **Richer authority evaluation:** the JS evaluation mirrors the accepted 042 policy shape.
  A later contract may replace it with a shared database function; the port boundary is the
  seam.
- **Linked trade/stock documents:** explicitly refused (`UNSUPPORTED_LINKED_CASE`) rather than
  half-supported.
