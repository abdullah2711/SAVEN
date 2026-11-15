CONTRACT: docs/contractor/contracts/PIVOT-002b-operator-schema-fixes.md
STATUS: DONE

FILES CHANGED:
- .github/workflows/verify.yml: explicit dedicated PostgreSQL environment for `node scripts/check.mjs` and `node --test tests/*.test.mjs`.
- db/postgres/10-operator-schema.sql: immutable issued entitlements, truncate refusal for append-only/issued histories, `feature_flag.value_schema_version`, narrower operator-admin entitlement grants, and explicit deferred reference/JSON comments.
- db/postgres/README.md: namespaced fixture/pre-flight behavior, CI/check requirements, immutable entitlements, truncate guards and deferred policy wording.
- docs/contractor/deliveries/PIVOT-002-operator-schema.md: corrected first-attempt isolation/enforcement claims and added the review response.
- scripts/check.mjs: fails loudly without the dedicated-cluster opt-in and PostgreSQL configuration, then runs the focused PIVOT-002 test.
- tests/helpers/pg-pivot-fixture.mjs: `saven_pivot_<suffix>_*` roles/database only, pre-flight collision refusal, advisory-lock serialization, ephemeral migration/login roles, cleanup-error aggregation and retained TLS verification.
- tests/pivot-002-operator.test.mjs: pre-flight refusal/unchanged catalog, concurrent namespace isolation, cleanup aggregation, entitlement UPDATE/DELETE/TRUNCATE refusal and privilege checks.
- docs/contractor/deliveries/PIVOT-002b-operator-schema-fixes.md: this delivery report.

GATE EVIDENCE:
Command: `node scripts/check.mjs && node --test tests/pivot-002-operator.test.mjs && node --test tests/*.test.mjs`
Environment: dedicated local disposable PostgreSQL 18.6 cluster initialized with `embedded-postgres` 18.6.0-beta.19 on loopback `127.0.0.1:55432`; `SAVEN_PIVOT_TEST_CLUSTER=1`; no owner-server, SSH, production or shared-cluster access. The fixture created only `saven_pivot_*` objects and removed them. After the gate, no `saven_pivot_*` role or database remained; the cluster was stopped and its temporary credential/data directory removed.

```text
PASS: 146 JavaScript files parsed; package manifest valid.
Ô£ö PIVOT-002 operator bootstrap enforces Purpose A authority boundaries (4806.6843ms)
Ô£ö PIVOT-002 fixture refuses pre-existing cluster roles before mutation (232.7786ms)
Ô£ö PIVOT-002 fixture namespaces isolate concurrent runs (3188.9916ms)
Ô£ö PIVOT-002 fixture reports run and cleanup failures together (0.9618ms)
Ôä╣ tests 4
Ôä╣ suites 0
Ôä╣ pass 4
Ôä╣ fail 0
Ôä╣ cancelled 0
Ôä╣ skipped 0
Ôä╣ todo 0
Ôä╣ duration_ms 8407.8645
Ô£ö PIVOT-002 operator bootstrap enforces Purpose A authority boundaries (4432.9301ms)
Ô£ö PIVOT-002 fixture refuses pre-existing cluster roles before mutation (135.096ms)
Ô£ö PIVOT-002 fixture namespaces isolate concurrent runs (3038.2273ms)
Ô£ö PIVOT-002 fixture reports run and cleanup failures together (0.9017ms)
Ôä╣ tests 4
Ôä╣ suites 0
Ôä╣ pass 4
Ôä╣ fail 0
Ôä╣ cancelled 0
Ôä╣ skipped 0
Ôä╣ todo 0
Ôä╣ duration_ms 7786.3027
Ô£ö bank statement amounts preserve signed minor units and reject floats or unreconciled rows (6.3846ms)
Ô£ö cash transfers reject same-account movements and reversal input cannot supply its own effects (1.373ms)
Ô£ö statement CSV preserves quoted bank references and rejects malformed input (2.8604ms)
Ô£ö invoice and bill due dates reject invalid calendars and dates before recognition (1.5139ms)
Ô£ö financial CSV retains numeric negatives while neutralizing formula text and escaping quotes (0.7805ms)
Ô£ö accounting navigation loads ledgers and party reports and clears a non-cash selection in banking (77.8695ms)
Ô£ö condition scopes normalize exact amounts and reject unsupported fields and comparisons (6.076ms)
Ô£ö ordered scopes permit multiple conditions for the same preparing role without ambiguous duplicates (1.4467ms)
Ô£ö posting authority preserves exact thresholds and rejects ambiguous rules (3.7586ms)
Ô£ö actual-day straight-line schedule independently agrees to partial months and residual value (7.011ms)
Ô£ö rounding, leap days and month-end anchors cannot overdepreciate the asset (6.6367ms)
Ô£ö local inference uses its configured resource budget and rejects oversized context before contacting the model (68.6789ms)
Ô£ö model adapter requires structured output, bounds generation and keeps the key server-side (1.7277ms)
Ô£ö unapproved model actions and malformed replies are rejected before any business tool (4.2791ms)
Ô£ö Cloudflare assistant authenticates first and prepares through the real command core without posting (282.4417ms)
Ô£ö global AI reservations serialize competing requests and settlements cannot refund twice (14.264ms)
Ô£ö manual journal normalization uses exact minor units and rejects imbalance/control-shaped fields (8.3357ms)
Ô£ö supplier bill and settlement normalization reject floats, negative amounts and invented fields (6.0774ms)
Ô£ö decimal arithmetic rejects floats, exponent notation, negatives and excess precision (3.6253ms)
Ô£ö invoice preview follows credit, separate receipt, and direct-cash choices exactly (182.3652ms)
Ô£ö invoice posts one balanced immutable journal with audit and outbox in the same transaction (81.4265ms)
Ô£ö stock reservation and approval reduce physical stock exactly once (94.6145ms)
Ô£ö rejecting an issue releases its reservation without changing physical stock or ledger (112.8344ms)
Ô£ö retry with the same key returns original submission; changed payload conflicts (80.053ms)
Ô£ö two competing last-unit requests cannot over-reserve stock (119.3168ms)
Ô£ö another user must approve even when the preparer is the ultimate owner (75.5884ms)
Ô£ö company membership and resource restrictions apply to reads and writes (49.4379ms)
Ô£ö revoked account access hides related documents and audit records (53.9926ms)
Ô£ö wrong-company foreign keys are rejected by the database (30.1106ms)
Ô£ö stale previews and tampered preview digests cannot be submitted (41.4885ms)
Ô£ö a period locked after submission blocks posting and rolls back every attempted effect (219.0639ms)
Ô£ö database rejects unbalanced or directly posted journals and preserves prior data (49.3212ms)
Ô£ö one active session per account; invitation tokens are single use (45.2673ms)
Ô£ö paused companies disappear and reject even previously prepared commands (42.1572ms)
Ô£ö ultimate owner and audit records cannot be deleted or demoted (28.8662ms)
Ô£ö invalid dates, unknown fields, negative/fractional stock and unsupported cash accounts are rejected (31.0261ms)
Ô£ö HTTP API enforces authentication, origin, JSON size, and private responses (36.6545ms)
Ô£ö exclusive mixed-tax invoice agrees to independently calculated net and tax (3.747ms)
Ô£ö inclusive prices and fractional quantities retain exact discount and tax rounding (1.9698ms)
Ô£ö out of range, zero total and imprecise inputs are rejected (1.8313ms)
Ô£ö owner creates scoped staff who can prepare but need another person to post; retries create no duplicate identity (1444.1106ms)
Ô£ö operator status and delegated role management never create a second protected business administrator (1064.9849ms)
Ô£ö suspension and role revocation immediately remove business access while preserving staff and financial records (946.9864ms)
Ô£ö failed cross-store staff setup remains durable and retries safely without granting partial access or retaining plaintext passwords (1089.8067ms)
Ô£ö stale role reviews and foreign-origin administration requests fail before staff identity creation (659.8015ms)
Ô£ö one consultant identity can receive separately scoped client memberships without a password reset or another protected owner (1342.1758ms)
Ô£ö a reviewed reversal is server-derived, linked and posted exactly once without changing its original (649.0937ms)
Ô£ö tampered previews, reused operation IDs and locked periods cannot bypass the ordinary posting controls (643.9624ms)
Ô£ö a posting fault retains the correction receipt but rolls back financial effects and can recover safely (604.8955ms)
Ô£ö a stock journal cannot be reversed as a manual journal because that would break the stock ledger (766.7009ms)
Ô£ö incomplete drafts survive restart without ledger effects; stale writes fail and only exact balanced saved revision submits (977.413ms)
Ô£ö cancelling a saved draft retains its number, advances the sequence and prevents identity reuse (809.0712ms)
Ô£ö a submitted journal duplicates into a new linked draft without posting or copying evidence promises (963.4786ms)
Ô£ö independent return preserves accepted bytes, creates an owned linked draft and original can never post (1028.3255ms)
Ô£ö reviewed posting attributes preparer and actual poster and filters exact project/date/account totals (952.2861ms)
Ô£ö draft ownership and resource checks prevent cross-user read, submission, number hijack and revoked access (649.5217ms)
Ô£ö new draft routes retain app/operator and CSRF boundaries over the real handler (927.0073ms)
Ô£ö trial independently carries prior balances into dated movements and balanced closing columns (617.278ms)
Ô£ö rejection retains its reason and number, creates no correction draft and cannot later be approved (1312.3696ms)
Ô£ö failure after draft financial effects keeps its accepted number and retry commits exactly once (591.3158ms)
Ô£ö journal register unifies saved cancelled pending and submitted sources without changing the GL (456.4738ms)
Ô£ö removing a draft hides it while preserving number and audit, restoration is explicit and posted entries cannot be removed (608.365ms)
Ô£ö register permissions and removal do not let another account view or discard a private draft (379.7994ms)
Ô£ö removed drafts reject direct edits submission and cancellation until restored, with no GL or revision change (464.3936ms)
Ô£ö native install creates separate controls and a tenant, pins migration checksums and never overwrites (347.5673ms)
Ô£ö acceptance is durable before scheduling; commit-before-ACK retry never doubles the journal (323.8566ms)
Ô£ö preparers may post directly under resource rules; explicit deny and tenant boundaries dominate (352.825ms)
Ô£ö pending approval retains exact payload; review and posting recheck periods and current authority (403.6745ms)
Ô£ö financial faults roll back source, lines, audit and outbox together and remain retryable (504.5876ms)
Ô£ö owner definition and sole holder are protected, transfer is atomic and custom names grant no ownership (477.3801ms)
Ô£ö scope filtering precedes counts, totals and exports; expiry preserves authorized history (361.0907ms)
Ô£ö backup recovers committed and pending states into an independent database without overwriting (476.5107ms)
Ô£ö unexpired worker lease prevents competing execution, expired lease recovers and revoked membership still blocks posting (367.1061ms)
Ô£ö storage guards reject fabricated posted receipts and later mutation of journal, payload and audit (371.0679ms)
Ô£ö reopening the application recovers pending commands without regenerating or replaying financial records (411.9759ms)
Ô£ö native customer/operator routes and inventory-only workspace start against real API shapes without falling back to sign-in (468.813ms)
Ô£ö the TLS adapter replaces forged relay authority while preserving browser origin, cookies, method and body (109.8083ms)
Ô£ö backend relay selection requires a constant-time checked server secret and exact public realm (1.1674ms)
Ô£ö the adapter refuses unknown domains, missing secrets, insecure/looping relay destinations and upstream outages (5.3352ms)
Ô£ö schema5 to current adds correction/trade controls without changing a historical journal and records the actual fleet schema (382.3947ms)
Ô£ö a checksum failure quarantines only the affected business and preserves both database files (629.6021ms)
Ô£ö a misplaced business file is quarantined before any schema migration writes to it (525.9243ms)
Ô£ö server configuration preserves disabled/local models and reads the router key only from the chosen secret source (9.0444ms)
Ô£ö OpenRouter sends the exact free model with price caps, no fallback and a validated named response envelope (121.2049ms)
Ô£ö provider failures, malformed tools and oversized prompts never return an executable model action (5.1607ms)
Ô£ö loopback acceptance preserves the logical hostname, browser Origin, binary evidence and response cookie over real HTTP (75.5076ms)
Ô£ö acceptance hostname overrides cannot send credentials to a remote or decorated transport URL (2.2372ms)
Ô£ö full stopped-installation backup and new-path restore preserve identity, entitlements, journal, stock and accepted pending work (2299.0286ms)
Ô£ö native identity realms, credential revocation and tenant boundaries are independent (1376.4862ms)
Ô£ö receipt, weighted-average issue and transfer reconcile atomically and replay once (900.9857ms)
Ô£ö a failure after stock effects rolls everything back, then retries exact accepted cost (735.8598ms)
Ô£ö stale accepted stock commands never silently reprice; locks and exact scoped preparer rules apply (1098.7317ms)
Ô£ö HTTP enforces hostname, realm, origin and CSRF before command dispatch (912.9417ms)
Ô£ö source-committed evidence blocks posting until clean original bytes exist, then remains immutable and scoped (659.659ms)
Ô£ö configured account classification produces independently balanced statements and period policy requires the protected owner (1031.3869ms)
Ô£ö AI receives scoped facts, returns a proposal without posting and rejects privilege/action output (517.1021ms)
Ô£ö permission revocation during AI inference prevents returning previously authorized context (437.5195ms)
Ô£ö another warehouse direct-post rule cannot bypass review, and transfer value participates in amount controls (740.1686ms)
Ô£ö inventory-only users can discover their workspace and stock masters without receiving ledger access (550.3288ms)
Ô£ö commercial and fleet scopes do not imply each other or customer authority (490.1439ms)
Ô£ö partial customer/supplier credits reverse original accounts, preserve the source and reconcile independently at each date (731.6425ms)
Ô£ö competing pending credits and settlements recheck remaining balances; line overcredit and excess credit after payment are refused (781.0449ms)
Ô£ö credit review, period locks, original-resource access and permission revocation share ordinary journal controls (824.9065ms)
Ô£ö a failed credit financial commit retains its pending receipt without changing balances; retry posts one exact credit (546.5159ms)
Ô£ö promised original credit evidence blocks posting until the matching file is retained and clean (529.1076ms)
Ô£ö service invoices, expense bills and partial cash settlements independently reconcile AR/AP and historical balances (839.439ms)
Ô£ö stale pending allocations, wrong parties/directions/dates and double invoice references cannot overpay or duplicate posted documents (633.0024ms)
Ô£ö linked trade sources prevent journal-only control bypass and reversal while leaving ordinary journals available (523.1451ms)
Ô£ö trade approval rechecks source-account access, independent review, revoked rights and period locks (827.2929ms)
Ô£ö financial-write failure rolls back invoice projections and cash allocations together and retry posts exactly once (445.7577ms)
Ô£ö HTTP preparation shares origin/CSRF/session and retained clean evidence checks with ordinary journals (717.995ms)
Ô£ö multiple invoice allocations retain exact decimal cents and require clean evidence before any financial effect (522.157ms)
Ô£ö existing manual control history is retained and refuses automatic subledger activation even when its current net balance is zero (966.5121ms)
Ô£ö workspace history restores complete view state and branches after going back (3.5084ms)
Ô£ö failed navigation retains the current position and history snapshots cannot be mutated (1.4284ms)
Ô£ö opening trial balance is exact, balanced and never creates a plug (7.2107ms)
Ô£ö reconciliation cannot post another trial balance and selected domains must match the breakdown (0.9229ms)
Ô£ö opening positions preserve original dates and reject netted negatives, duplicates and future origins (2.626ms)
Ô£ö opening CSV preserves quoted contact names and rejects malformed or oversized sections (3.6086ms)
Ô£ö an opening subledger preview identifies its source without pretending to post another journal (50.5078ms)
Ô£ö the gated accounting opening tab loads snapshot history through the company endpoint (14.2532ms)
Ô£ö payment reference amounts remain exact and reject duplicate, invented or incompatible links (7.0712ms)
Ô£ö advance application cannot masquerade as a bank movement and source markup is escaped (2.248ms)
Ô£ö PIVOT-002 operator bootstrap enforces Purpose A authority boundaries (5842.4444ms)
Ô£ö PIVOT-002 fixture refuses pre-existing cluster roles before mutation (140.1345ms)
Ô£ö PIVOT-002 fixture namespaces isolate concurrent runs (2515.9875ms)
Ô£ö PIVOT-002 fixture reports run and cleanup failures together (1.7438ms)
Ô£ö online and manual-transfer envelopes use the same signed challenge, monthly certificate and durable acceptance (32.3609ms)
Ô£ö tampering, foreign installation, certificate rollback and unsigned authority are rejected (12.383ms)
Ô£ö expiry and clock rollback restrict writes while preserving history, export, backup and certificate evidence (7.077ms)
Ô£ö a valid vendor signature does not authorize a foreign installation or an expired challenge (6.7522ms)
Ô£ö private foundation package excludes vendor issuer and its transitive imports; it is not advertised as installable (36.5918ms)
Ô£ö month-end recurrence anchors to the original day across leap years (13.4138ms)
Ô£ö schedule input retains exact balanced amounts and rejects control metadata abuse (4.6586ms)
Ô£ö passwords use unique scrypt salts and verify exact Unicode input (1108.5483ms)
Ô£ö password sign-in rejects a foreign origin before touching credentials (89.0544ms)
Ô£ö sign-in rate limit stops before credential lookup or password work (25.4182ms)
Ô£ö SQLite projection commits cursor with deltas and survives a pre-cursor crash without double counting (9.5572ms)
Ô£ö backdated facts update the correct slice and denied or foreign-company aggregates never enter results (5.7253ms)
Ô£ö report DSL rejects raw SQL and source fixture rejects unbalanced or duplicate facts (2.0356ms)
Ô£ö private objects preserve original bytes, reject traversal/overwrite and detect tampering (68.6065ms)
Ô£ö upload inspection rejects executable disguises, unsafe names and oversized streamed bodies (89.2145ms)
Ô£ö ClamAV protocol consumes original stream and distinguishes clean from infected results (66.37ms)
Ô£ö agent tools inherit company and user authority and cannot approve or grant privileges (115.6138ms)
Ô£ö Worker end-to-end: invitation, preview, submit, new reviewer session, approval and retry (150.6332ms)
Ô£ö Worker serves static assets with security headers and fails closed without a database (4.4809ms)
Ô£ö health distinguishes an absent binding, an empty database and the full schema (9.8633ms)
Ô£ö PostgreSQL edge route preserves the command and overwrites forged origin metadata (7.0916ms)
Ô£ö maintenance and PostgreSQL outages never write to the former D1 database (3.1785ms)
Ôä╣ tests 149
Ôä╣ suites 0
Ôä╣ pass 149
Ôä╣ fail 0
Ôä╣ cancelled 0
Ôä╣ skipped 0
Ôä╣ todo 0
Ôä╣ duration_ms 13928.5501
```

Original PIVOT-002 gate re-run:
Command: `node scripts/check.mjs && node --test tests/pivot-002-operator.test.mjs`

```text
PASS: 146 JavaScript files parsed; package manifest valid.
Ô£ö PIVOT-002 operator bootstrap enforces Purpose A authority boundaries (4800.0956ms)
Ô£ö PIVOT-002 fixture refuses pre-existing cluster roles before mutation (147.04ms)
Ô£ö PIVOT-002 fixture namespaces isolate concurrent runs (3429.0241ms)
Ô£ö PIVOT-002 fixture reports run and cleanup failures together (0.7384ms)
Ôä╣ tests 4
Ôä╣ suites 0
Ôä╣ pass 4
Ôä╣ fail 0
Ôä╣ cancelled 0
Ôä╣ skipped 0
Ôä╣ todo 0
Ôä╣ duration_ms 8544.9288
Ô£ö PIVOT-002 operator bootstrap enforces Purpose A authority boundaries (5030.0234ms)
Ô£ö PIVOT-002 fixture refuses pre-existing cluster roles before mutation (145.2283ms)
Ô£ö PIVOT-002 fixture namespaces isolate concurrent runs (2909.0293ms)
Ô£ö PIVOT-002 fixture reports run and cleanup failures together (1.1014ms)
Ôä╣ tests 4
Ôä╣ suites 0
Ôä╣ pass 4
Ôä╣ fail 0
Ôä╣ cancelled 0
Ôä╣ skipped 0
Ôä╣ todo 0
Ôä╣ duration_ms 8287.6165
```

QUESTIONS FOR ENGINEER:
- The Verify SAVEN workflow triggers only on `testing-1`/`main` pushes and pull requests to those branches, so its actual GitHub Actions run is only possible after integration/PR. The exact workflow commands were run locally against the dedicated disposable cluster; confirm this is acceptable or run CI on integration. No merge was performed.

DEVIATIONS FROM CONTRACT:
- Used `git merge origin/testing-1` (merge commit `493049b7014b27e7836087aa86ce0ee31e8ec781`) instead of rebase, because rebasing would rewrite the already-pushed `244752c` and `cd1f833` and require a force-push. The original commits are preserved; new commits are added on top.
- The fixture no longer executes the production `00-roles.sql`; it creates namespaced `saven_pivot_<suffix>_*` roles with the same constrained attributes and applies a role-name-rewritten `10-operator-schema.sql`. The production `00` remains for deployment and is statically checked by the test.
- The gate used a dedicated local `embedded-postgres` 18.6 cluster in gitignored `var/pg-test/data-pivot002b-*`; no owner-server/SSH access was used. The temporary local cluster credential and data directory were removed after the gate.
- `saven_migrator` owns the operator schema/tables as the offline DDL role; runtime roles own no objects and the disposable database is owned by the external administrative connection. This follows the review's ownership decision.
- Reference values and JSON schemas are seeded/declared but not database-enforced; effective-dated policy, JSON-schema validation and entitlement activation are explicitly deferred and non-authoritative in this bootstrap.
- The original PIVOT-002 report was corrected to distinguish business-row isolation from real cluster-wide temporary role/grant changes and to remove the earlier enforcement/no-role-touched overclaims.
- The GitHub workflow YAML was updated; because the workflow does not trigger on `opencode/pivot-002`, the actual Actions run remains an integration-time check. The local equivalent (`node scripts/check.mjs`, focused test, full 149-test suite) passed.

EXTENSIBILITY: compliant for the corrected bootstrap scope — `saven_pivot_*` namespace isolation and pre-flight refusal protect pre-existing cluster roles; issued entitlements are immutable and append-only histories reject UPDATE/DELETE/TRUNCATE; operator-admin entitlement grants are INSERT-only; reference/JSON validation is explicitly deferred rather than claimed; no hardcoded growing enums, no cross-module concrete coupling and no new speculative consumer.

GIT: branch=opencode/pivot-002 commits=493049b7014b27e7836087aa86ce0ee31e8ec781,d5b7aaab12755ae7c835f4f158253f405bc736e3 pushed=yes

