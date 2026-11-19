# PIVOT-014 — delivered cover sheet (S1–S9)

Neutral, plain-English explanation of what the permanent test proves and how it fails if the
property is absent. Each sentence links to its permanent test and the assertion that enforces
it. Engineer review of the SQL and source is still required; green tests alone are not
acceptance.

Test file: `tests/pivot-014-vertical-slice.test.mjs` (run by `node scripts/check.mjs`).
Delivery: `docs/contractor/deliveries/PIVOT-014-vertical-slice.md`.

- **S1 — Real application path.** A visitor with no session cannot create an entry, a request
  from an unapproved origin is refused, and every accepted request is served by
  `p014_app_login` acting as `saven_customer_app` after session verification, tenant admission
  and CSRF checks. *Test:* `S1 real application path and restricted principal`. *Fails if:*
  the trace misses a stage, the principal is not the restricted role (`500 !== 201`), the
  anonymous request is not `401 AUTH_REQUIRED`, or the foreign origin is not `421`.

- **S2 — Permanent automated test.** The lifecycle test runs inside the normal check command
  on a freshly created disposable database, fails the check when any property fails, and has a
  declared 240-second budget with one deterministic port allocation, no retry loop, and
  guaranteed cleanup. *Test:* `scripts/check.mjs` + the helper. *Fails if:* the test errors or
  the budget is exceeded (the check exits nonzero), a prerequisite is missing (actionable
  error), or a retry would be needed to pass.

- **S3 — Cross-tenant refusal with controls.** Tenant A can read its own entry and audit but
  is refused tenant B's entry (`TENANT_RESOURCE_DENIED`) and B's audit
  (`AUDIT_TENANT_DENIED`), while B reads both successfully and B's data is provably unchanged.
  *Test:* `S3 cross-tenant refusal with permitted controls`. *Fails if:* either forbidden
  access succeeds, either permitted control fails, B's counts change, or the refusals are not
  in the security-audit trail.

- **S4 — Balanced posts; unbalanced leaves no trace.** A balanced entry posts; an unbalanced
  one is refused with `UNBALANCED_ENTRY` and leaves no journal, line, audit row, command,
  outbox effect or consumed number. *Test:* `S4 unbalanced request leaves no trace and
  consumes no number`. *Fails if:* the code is not `422 UNBALANCED_ENTRY` or any baseline
  count changes.

- **S5 — Void is a state change.** Voiding removes the entry from the active ledger, keeps it
  in `voided_entries`, retains the original journal/lines/allocation byte-for-byte, writes
  exactly one void event, and refuses edits, deletes, re-voids and second-key attempts.
  *Test:* `S5 void is a state change with retained evidence`. *Fails if:* the entry stays
  active, disappears, changes, lacks the void audit, or a retry adds rows.

- **S6 — Complete lifecycle audit.** Each create, post and void produces exactly one canonical
  lifecycle event with the verified actor and truthful origin, plus an exactly enumerated
  physical row-change set, with no credential material, and a failed transaction leaves
  neither the business change nor its success audit. *Test:* `S6 complete lifecycle audit with
  enumerated change events`. *Fails if:* a count differs from the declared expectation, an
  actor/origin is wrong, a sentinel appears, or the rollback probe leaves rows.

- **S7 — Idempotency.** Replaying the same post (including concurrently) returns the receipt
  with one journal, one posting event and no added rows, while the same key with different
  content is refused with `IDEMPOTENCY_CONFLICT`. *Test:* `S7 idempotent replay and conflict
  refusal`. *Fails if:* duplication occurs, the conflict code is wrong, or the original post
  control fails.

- **S8 — Numbering under concurrency (D-016).** Two overlapping posts receive different,
  ordered numbers from a locked counter (never `MAX+1`), an abandoned allocation is never
  reused elsewhere, a later success advances past it, and the high-water mark cannot regress.
  *Test:* `S8 concurrent numbering and non-reusable allocation`. *Fails if:* numbers collide
  or go backwards, both requests did not actually overlap, the abandoned identity is reassigned,
  or the regression `UPDATE` succeeds. Gaps are expressly permitted and never back-filled.

- **S9 — No dishonest pass.** Every refusal carries a specific code and a working permitted
  control, and an actually performed guard-removal run made the permanent test fail (S4:
  `500 !== 422`) before restoration made it pass (9/9). *Test:* `S9 refusals are specific and
  paired with permitted controls` plus the recorded red/green run in the delivery. *Fails if:*
  a refusal is generic, a control is vacuous, or the mutation does not turn the test red.

**Counting disclosure.** The logical command audit (`tenant_data.audit`) and the physical
row-change audit (`tenant_data.audit_event`) are independent retained streams: a journal with
several lines has one logical posting event and separately counted row events, never a claim
that the database holds only one audit row.

**Exclusion.** This slice exercises authorized **direct** posting only. The approval-policy
review gate and AI-origin no-direct-post rules (D-004/D-005) are not exercised, and a green
slice does not prove them.
