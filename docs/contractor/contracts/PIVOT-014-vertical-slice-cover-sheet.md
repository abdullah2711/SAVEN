# PIVOT-014 — Principal cover sheet

APPROVED 19 November 2026 by the Principal (cover sheet and S2 no-flakiness constraint approved).

The delivered cover sheet must replace these promised checks with links to the permanent tests and their results; the Principal approves the business proof, while engineers independently read the SQL and source.

- **S1:** Real signed-in requests pass through session verification, tenant admission and the journal service, and the test fails if a lifecycle operation bypasses that path or uses an administrator connection.
- **S2:** The permanent lifecycle test runs automatically within the normal check command on a fresh disposable local database, and the check fails if the test, required database setup or any asserted property fails rather than silently skipping it, exceeding the declared whole-test wall-clock budget or hiding any teardown, timeout or deterministic-port-allocation failure behind a retry to green.
- **S3:** Each tenant can read its own journal and audit while tenant A is specifically refused both tenant B's journal and its audit, and the tests fail if either forbidden access succeeds or either permitted control fails.
- **S4:** A balanced entry posts but an unbalanced request leaves no journal, line or business audit evidence, and the test fails on the wrong refusal reason or any surviving request-related row.
- **S5:** Voiding removes the entry from the active ledger while retaining immutable voided history and its posting/audit evidence, and the test fails if the entry remains active, disappears physically, changes afterward or lacks the void audit.
- **S6:** Each successful create, post and void has exactly one logical lifecycle audit event plus the separately enumerated complete row-change evidence with correct tenant, verified actor, origin and redacted payloads, and the tests fail on any missing, duplicate, misattributed or secret-bearing event.
- **S7:** Retrying the same post preserves one journal and one logical posting event without adding physical change events or allocation effects, and the test fails on duplication, an incorrect conflict refusal or a failed original-post control.
- **S8:** Concurrent posts receive different increasing numbers and cancelled allocations are never reused, and the test fails on duplicate/backward/reissued identities or bypassed locking, with explainable gaps expressly permitted by the Principal's later D-016 decision.
- **S9:** Every refusal has a specific reason and a working permitted control, and an actual guard-removal run must make the permanent test fail before restoration makes it pass, so generic failures, vacuous counts or an unperformed mutation proof cannot satisfy delivery.

Counting disclosure: the logical command audit and physical row-change audit are independent retained streams, so a journal with multiple lines has one logical posting event and separately counted physical row events rather than a misleading claim that the entire database contains only one audit row.

Exclusion: this slice exercises authorized DIRECT posting; the approval-policy gate and AI-origin no-direct-post rules (D-004/D-005) are NOT exercised, and a green slice does not prove them.

Approval recorded above; no tests executed or properties implemented are claimed, and dispatch remains staged until AUTH-009 is accepted and integrated.
