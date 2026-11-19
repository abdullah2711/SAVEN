# PIVOT-014 — delivered cover sheet (re-issued for revision 4)

Re-issued against the current tree. It states only what the named permanent assertions show,
and names the gap where evidence is bounded. Each sentence links to its test and assertion.
Engineer review of SQL/source is still required; green tests alone are not acceptance.

Test files: `tests/pivot-014-vertical-slice.test.mjs` (17 subtests, run by
`node scripts/check.mjs`). Delivery: `docs/contractor/deliveries/PIVOT-014-vertical-slice.md`.

- **S1 — Real application path.** A request without a session is refused, a foreign origin is
  refused, and every accepted request runs the real handler → session verification → the
  **accepted AUTH-006 authority boundary** (held to business completion, pre-commit
  revalidation) → service → repository on the restricted principal. *Test:* `S1 real
  application path and restricted principal`. *Fails if:* a trace stage is missing, the
  principal is not `saven_customer_app` on `p014_app_login`, or either refusal is not exact.

- **S2 — Permanent automated test.** The lifecycle test runs inside the normal check command on
  a freshly created disposable database and its failure fails the check; it declares a
  240 s budget, allocates one port, never retries an operation, and cleans up from the first
  temporary allocation. *Test:* `scripts/check.mjs` + helper. *Fails if:* the test errors, a
  prerequisite is missing, or setup failure leaks an owned directory (proved). *Bounded gap:*
  the deadline covers setup + lifecycle, but teardown time is measured after the assertion.

- **S3 — Cross-tenant refusal with controls.** Tenant A reads its own posted entry and audit,
  is refused tenant B's entry (`TENANT_RESOURCE_DENIED`) and B's audit
  (`AUDIT_TENANT_DENIED`), B reads both, and B's counts are unchanged. *Test:* `S3 …`.
  *Fails if:* either forbidden access succeeds, either control fails, or B's data changes.

- **S4 — Balanced posts; unbalanced leaves no trace.** The authoritative balance check runs
  **inside the owned transaction** (the envelope is re-derived there) and an unbalanced
  request is refused `422 UNBALANCED_ENTRY` with no journal, line, audit row, command, outbox
  effect or consumed number. *Test:* `S4 …`. *Fails if:* the code differs or any baseline count
  changes.

- **S5 — Void is a state change.** Void commits **while admission is held**, removes the entry
  from `active_general_ledger`, retains it in `voided_entries` with byte-identical source rows,
  writes exactly one void event, and refuses edits/deletes/re-voids. *Test:* `S5 …`.
  *Fails if:* the entry stays active, changes, disappears, lacks the void audit, or a retry
  adds rows.

- **S6 — Complete lifecycle audit.** One canonical lifecycle event per create/post/void plus an
  exactly enumerated physical change set, verified actor and truthful origin on **every**
  event, no credential material, and a rollback probe proving the business change and its
  success audit are atomic. *Test:* `S6 …`. *Fails if:* an expectation, actor, origin or
  sentinel fails, or the rollback leaves rows.

- **S7 — Idempotency.** Replaying a post with its key returns the receipt with no added rows; a
  different key on the same target is `IDEMPOTENCY_CONFLICT`; same key with different content
  is a conflict; a foreign session is refused. *Test:* `S7 …`. *Fails if:* any of those holds
  is violated. *Bounded gap:* the concurrent case is a same-key replay after the entry is
  POSTED, not a barrier-started initial race.

- **S8 — Numbering under concurrency (D-016).** Numbers come from a **nontransactional consumed
  identity** (sequence), so a rollback, a failed receipt or an interruption can never put a
  value back; receipts bind actor/content/scope; hostile reuse is `IDEMPOTENCY_CONFLICT`;
  re-applying 043 retains receipts and high-water and later allocations continue past them.
  *Test:* `S8 …`. *Fails if:* a value repeats, the sequence does not advance on failure, or a
  different actor recovers an allocation. *Bounded gap:* overlap is measured by concurrent
  in-flight requests, not by database lock instrumentation.

- **S9 — No dishonest pass.** Every refusal has a specific code and a permitted control, and a
  performed guard-removal made the permanent test fail before restoration made it pass.
  *Test:* `S9 …` plus the recorded red/green run in the delivery. *Fails if:* a refusal is
  generic, a control is vacuous, or the mutation does not turn the test red.

**Counting disclosure.** `tenant_data.audit` (logical) and `tenant_data.audit_event` (physical)
are independent retained streams; a multi-line journal has one logical posting event and
separately counted row events.

**Exclusion.** Only authorized **direct** posting is exercised. Approval-policy review and
AI-origin no-direct-post rules are not proved; a review-required authority is refused
`APPROVAL_REQUIRED`, never silently posted.
