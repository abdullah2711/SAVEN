CONTRACT: docs/contractor/reviews/PIVOT-002b-operator-schema-fixes.md (inline PIVOT-002b follow-up, referred to as PIVOT-002c)
STATUS: DONE — blockers 1 and 2 fixed; blockers 3 and 4 diagnosed only per the owner instruction.

FILES CHANGED:
- db/postgres/00-roles.sql: validation-only bootstrap that refuses incompatible pre-existing target roles before mutation, never runs ALTER ROLE, and treats a compatible rerun as a no-op.
- db/postgres/README.md: separate runtime/migration principals, bootstrap preservation behavior, ownership/negative-test coverage and deferred-reference wording.
- tests/helpers/pg-pivot-fixture.mjs: applies the checked-in `00-roles.sql` in the disposable namespace, creates separate runtime logins for customer/auth-service/operator-read/operator-admin, creates a migration-only login, and retains pre-flight/cleanup safeguards.
- tests/pivot-002-operator.test.mjs: asserts runtime/migrator/definer separation, actual schema/table/index/sequence/function owners, denied SET ROLE/ALTER/DROP, compatible bootstrap re-entry and atomic bootstrap refusal.
- docs/contractor/deliveries/verify-workflow-diagnostic.md: blocker 3/4 diagnostic, including the workflow trigger, verify-script inventory, `gh` availability and observed no-PostgreSQL behavior.
- docs/contractor/deliveries/PIVOT-002c-operator-schema-fixes.md: this delivery report.

GATE EVIDENCE:
Command: `node scripts/check.mjs && node --test tests/pivot-002-operator.test.mjs && node --test tests/*.test.mjs`
Environment: dedicated local disposable PostgreSQL 18.6 cluster initialized with `embedded-postgres` 18.6.0-beta.19 on loopback `127.0.0.1:55432`; `SAVEN_PIVOT_TEST_CLUSTER=1`; no owner-server, SSH, production or shared-cluster access. The fixture created only `saven_pivot_*` objects and removed them.

```text
PASS: 146 JavaScript files parsed; package manifest valid.
Ô£ö PIVOT-002 operator bootstrap enforces Purpose A authority boundaries (10459.0603ms)
Ô£ö PIVOT-002 fixture refuses pre-existing cluster roles before mutation (323.9476ms)
Ô£ö PIVOT-002 checked-in role bootstrap refuses incompatible pre-existing roles atomically (1657.5885ms)
Ô£ö PIVOT-002 fixture namespaces isolate concurrent runs (3531.1013ms)
Ô£ö PIVOT-002 fixture reports run and cleanup failures together (2.8467ms)
Ôä╣ tests 5
Ôä╣ suites 0
Ôä╣ pass 5
Ôä╣ fail 0
Ôä╣ cancelled 0
Ôä╣ skipped 0
Ôä╣ todo 0
Ôä╣ duration_ms 16359.7532
Ô£ö PIVOT-002 operator bootstrap enforces Purpose A authority boundaries (10103.6155ms)
Ô£ö PIVOT-002 fixture refuses pre-existing cluster roles before mutation (240.4828ms)
Ô£ö PIVOT-002 checked-in role bootstrap refuses incompatible pre-existing roles atomically (1711.6304ms)
Ô£ö PIVOT-002 fixture namespaces isolate concurrent runs (3632.2766ms)
Ô£ö PIVOT-002 fixture reports run and cleanup failures together (1.1102ms)
Ôä╣ tests 5
Ôä╣ suites 0
Ôä╣ pass 5
Ôä╣ fail 0
Ôä╣ cancelled 0
Ôä╣ skipped 0
Ôä╣ todo 0
Ôä╣ duration_ms 15960.0198
Ô£ö bank statement amounts preserve signed minor units and reject floats or unreconciled rows (9.0782ms)
Ô£ö cash transfers reject same-account movements and reversal input cannot supply its own effects (1.7276ms)
Ô£ö statement CSV preserves quoted bank references and rejects malformed input (3.5082ms)
Ô£ö invoice and bill due dates reject invalid calendars and dates before recognition (1.8718ms)
Ô£ö financial CSV retains numeric negatives while neutralizing formula text and escaping quotes (1.1646ms)
Ô£ö accounting navigation loads ledgers and party reports and clears a non-cash selection in banking (113.2713ms)
Ô£ö condition scopes normalize exact amounts and reject unsupported fields and comparisons (6.7888ms)
Ô£ö ordered scopes permit multiple conditions for the same preparing role without ambiguous duplicates (1.8459ms)
Ô£ö posting authority preserves exact thresholds and rejects ambiguous rules (5.5769ms)
Ô£ö actual-day straight-line schedule independently agrees to partial months and residual value (19.2527ms)
Ô£ö rounding, leap days and month-end anchors cannot overdepreciate the asset (2.723ms)
Ô£ö local inference uses its configured resource budget and rejects oversized context before contacting the model (97.6967ms)
Ô£ö model adapter requires structured output, bounds generation and keeps the key server-side (2.592ms)
Ô£ö unapproved model actions and malformed replies are rejected before any business tool (4.9726ms)
Ô£ö Cloudflare assistant authenticates first and prepares through the real command core without posting (368.123ms)
Ô£ö global AI reservations serialize competing requests and settlements cannot refund twice (20.7946ms)
Ô£ö manual journal normalization uses exact minor units and rejects imbalance/control-shaped fields (12.9604ms)
Ô£ö supplier bill and settlement normalization reject floats, negative amounts and invented fields (1.5341ms)
Ô£ö decimal arithmetic rejects floats, exponent notation, negatives and excess precision (5.6173ms)
Ô£ö invoice preview follows credit, separate receipt, and direct-cash choices exactly (209.638ms)
Ô£ö invoice posts one balanced immutable journal with audit and outbox in the same transaction (54.0589ms)
Ô£ö stock reservation and approval reduce physical stock exactly once (60.4817ms)
Ô£ö rejecting an issue releases its reservation without changing physical stock or ledger (62.0912ms)
Ô£ö retry with the same key returns original submission; changed payload conflicts (55.2858ms)
Ô£ö two competing last-unit requests cannot over-reserve stock (71.8731ms)
Ô£ö another user must approve even when the preparer is the ultimate owner (68.5749ms)
Ô£ö company membership and resource restrictions apply to reads and writes (54.1802ms)
Ô£ö revoked account access hides related documents and audit records (60.7856ms)
Ô£ö wrong-company foreign keys are rejected by the database (70.7737ms)
Ô£ö stale previews and tampered preview digests cannot be submitted (70.3519ms)
Ô£ö a period locked after submission blocks posting and rolls back every attempted effect (58.9162ms)
Ô£ö database rejects unbalanced or directly posted journals and preserves prior data (79.1861ms)
Ô£ö one active session per account; invitation tokens are single use (78.0453ms)
Ô£ö paused companies disappear and reject even previously prepared commands (69.3159ms)
Ô£ö ultimate owner and audit records cannot be deleted or demoted (66.1488ms)
Ô£ö invalid dates, unknown fields, negative/fractional stock and unsupported cash accounts are rejected (43.0298ms)
Ô£ö HTTP API enforces authentication, origin, JSON size, and private responses (47.2509ms)
Ô£ö exclusive mixed-tax invoice agrees to independently calculated net and tax (5.0298ms)
Ô£ö inclusive prices and fractional quantities retain exact discount and tax rounding (2.6361ms)
Ô£ö out of range, zero total and imprecise inputs are rejected (1.8142ms)
Ô£ö owner creates scoped staff who can prepare but need another person to post; retries create no duplicate identity (1666.1077ms)
Ô£ö operator status and delegated role management never create a second protected business administrator (1055.6211ms)
Ô£ö suspension and role revocation immediately remove business access while preserving staff and financial records (1248.0337ms)
Ô£ö failed cross-store staff setup remains durable and retries safely without granting partial access or retaining plaintext passwords (1136.9341ms)
Ô£ö stale role reviews and foreign-origin administration requests fail before staff identity creation (926.7284ms)
Ô£ö one consultant identity can receive separately scoped client memberships without a password reset or another protected owner (1197.9599ms)
Ô£ö a reviewed reversal is server-derived, linked and posted exactly once without changing its original (631.8438ms)
Ô£ö tampered previews, reused operation IDs and locked periods cannot bypass the ordinary posting controls (596.9635ms)
Ô£ö a posting fault retains the correction receipt but rolls back financial effects and can recover safely (593.2834ms)
Ô£ö a stock journal cannot be reversed as a manual journal because that would break the stock ledger (573.2562ms)
Ô£ö incomplete drafts survive restart without ledger effects; stale writes fail and only exact balanced saved revision submits (944.6218ms)
Ô£ö cancelling a saved draft retains its number, advances the sequence and prevents identity reuse (820.2175ms)
Ô£ö a submitted journal duplicates into a new linked draft without posting or copying evidence promises (773.5382ms)
Ô£ö independent return preserves accepted bytes, creates an owned linked draft and original can never post (955.9802ms)
Ô£ö reviewed posting attributes preparer and actual poster and filters exact project/date/account totals (1203.1113ms)
Ô£ö draft ownership and resource checks prevent cross-user read, submission, number hijack and revoked access (744.3689ms)
Ô£ö new draft routes retain app/operator and CSRF boundaries over the real handler (992.6233ms)
Ô£ö trial independently carries prior balances into dated movements and balanced closing columns (631.7116ms)
Ô£ö rejection retains its reason and number, creates no correction draft and cannot later be approved (687.7853ms)
Ô£ö failure after draft financial effects keeps its accepted number and retry commits exactly once (560.5977ms)
Ô£ö journal register unifies saved cancelled pending and submitted sources without changing the GL (530.0078ms)
Ô£ö removing a draft hides it while preserving number and audit, restoration is explicit and posted entries cannot be removed (774.3426ms)
Ô£ö register permissions and removal do not let another account view or discard a private draft (547.7681ms)
Ô£ö removed drafts reject direct edits submission and cancellation until restored, with no GL or revision change (555.7519ms)
Ô£ö native install creates separate controls and a tenant, pins migration checksums and never overwrites (314.8267ms)
Ô£ö acceptance is durable before scheduling; commit-before-ACK retry never doubles the journal (233.7603ms)
Ô£ö preparers may post directly under resource rules; explicit deny and tenant boundaries dominate (321.529ms)
Ô£ö pending approval retains exact payload; review and posting recheck periods and current authority (316.4425ms)
Ô£ö financial faults roll back source, lines, audit and outbox together and remain retryable (284.5149ms)
Ô£ö owner definition and sole holder are protected, transfer is atomic and custom names grant no ownership (314.9127ms)
Ô£ö scope filtering precedes counts, totals and exports; expiry preserves authorized history (346.1264ms)
Ô£ö backup recovers committed and pending states into an independent database without overwriting (316.5606ms)
Ô£ö unexpired worker lease prevents competing execution, expired lease recovers and revoked membership still blocks posting (336.835ms)
Ô£ö storage guards reject fabricated posted receipts and later mutation of journal, payload and audit (230.5081ms)
Ô£ö reopening the application recovers pending commands without regenerating or replaying financial records (357.8832ms)
Ô£ö native customer/operator routes and inventory-only workspace start against real API shapes without falling back to sign-in (543.3023ms)
Ô£ö the TLS adapter replaces forged relay authority while preserving browser origin, cookies, method and body (101.9317ms)
Ô£ö backend relay selection requires a constant-time checked server secret and exact public realm (1.4859ms)
Ô£ö the adapter refuses unknown domains, missing secrets, insecure/looping relay destinations and upstream outages (4.6359ms)
Ô£ö schema5 to current adds correction/trade controls without changing a historical journal and records the actual fleet schema (384.0976ms)
Ô£ö a checksum failure quarantines only the affected business and preserves both database files (456.171ms)
Ô£ö a misplaced business file is quarantined before any schema migration writes to it (325.9437ms)
Ô£ö server configuration preserves disabled/local models and reads the router key only from the chosen secret source (6.9946ms)
Ô£ö OpenRouter sends the exact free model with price caps, no fallback and a validated named response envelope (134.4877ms)
Ô£ö provider failures, malformed tools and oversized prompts never return an executable model action (22.4479ms)
Ô£ö loopback acceptance preserves the logical hostname, browser Origin, binary evidence and response cookie over real HTTP (98.3544ms)
Ô£ö acceptance hostname overrides cannot send credentials to a remote or decorated transport URL (2.8183ms)
Ô£ö full stopped-installation backup and new-path restore preserve identity, entitlements, journal, stock and accepted pending work (2083.4565ms)
Ô£ö native identity realms, credential revocation and tenant boundaries are independent (1372.8375ms)
Ô£ö receipt, weighted-average issue and transfer reconcile atomically and replay once (906.2779ms)
Ô£ö a failure after stock effects rolls everything back, then retries exact accepted cost (687.9283ms)
Ô£ö stale accepted stock commands never silently reprice; locks and exact scoped preparer rules apply (1060.8265ms)
Ô£ö HTTP enforces hostname, realm, origin and CSRF before command dispatch (925.2143ms)
Ô£ö source-committed evidence blocks posting until clean original bytes exist, then remains immutable and scoped (516.5846ms)
Ô£ö configured account classification produces independently balanced statements and period policy requires the protected owner (589.7763ms)
Ô£ö AI receives scoped facts, returns a proposal without posting and rejects privilege/action output (570.9563ms)
Ô£ö permission revocation during AI inference prevents returning previously authorized context (519.5659ms)
Ô£ö another warehouse direct-post rule cannot bypass review, and transfer value participates in amount controls (829.4414ms)
Ô£ö inventory-only users can discover their workspace and stock masters without receiving ledger access (767.1758ms)
Ô£ö commercial and fleet scopes do not imply each other or customer authority (515.2754ms)
Ô£ö partial customer/supplier credits reverse original accounts, preserve the source and reconcile independently at each date (687.106ms)
Ô£ö competing pending credits and settlements recheck remaining balances; line overcredit and excess credit after payment are refused (911.6154ms)
Ô£ö credit review, period locks, original-resource access and permission revocation share ordinary journal controls (819.3136ms)
Ô£ö a failed credit financial commit retains its pending receipt without changing balances; retry posts one exact credit (554.7212ms)
Ô£ö promised original credit evidence blocks posting until the matching file is retained and clean (568.6773ms)
Ô£ö service invoices, expense bills and partial cash settlements independently reconcile AR/AP and historical balances (695.5558ms)
Ô£ö stale pending allocations, wrong parties/directions/dates and double invoice references cannot overpay or duplicate posted documents (706.8809ms)
Ô£ö linked trade sources prevent journal-only control bypass and reversal while leaving ordinary journals available (462.5432ms)
Ô£ö trade approval rechecks source-account access, independent review, revoked rights and period locks (926.9814ms)
Ô£ö financial-write failure rolls back invoice projections and cash allocations together and retry posts exactly once (519.5077ms)
Ô£ö HTTP preparation shares origin/CSRF/session and retained clean evidence checks with ordinary journals (713.6547ms)
Ô£ö multiple invoice allocations retain exact decimal cents and require clean evidence before any financial effect (472.1171ms)
Ô£ö existing manual control history is retained and refuses automatic subledger activation even when its current net balance is zero (337.2448ms)
Ô£ö workspace history restores complete view state and branches after going back (4.366ms)
Ô£ö failed navigation retains the current position and history snapshots cannot be mutated (1.4998ms)
Ô£ö opening trial balance is exact, balanced and never creates a plug (7.9551ms)
Ô£ö reconciliation cannot post another trial balance and selected domains must match the breakdown (1.3646ms)
Ô£ö opening positions preserve original dates and reject netted negatives, duplicates and future origins (4.2215ms)
Ô£ö opening CSV preserves quoted contact names and rejects malformed or oversized sections (7.6929ms)
Ô£ö an opening subledger preview identifies its source without pretending to post another journal (73.4669ms)
Ô£ö the gated accounting opening tab loads snapshot history through the company endpoint (17.7903ms)
Ô£ö payment reference amounts remain exact and reject duplicate, invented or incompatible links (9.1863ms)
Ô£ö advance application cannot masquerade as a bank movement and source markup is escaped (1.9218ms)
Ô£ö PIVOT-002 operator bootstrap enforces Purpose A authority boundaries (8479.9828ms)
Ô£ö PIVOT-002 fixture refuses pre-existing cluster roles before mutation (494.8281ms)
Ô£ö PIVOT-002 checked-in role bootstrap refuses incompatible pre-existing roles atomically (2121.1249ms)
Ô£ö PIVOT-002 fixture namespaces isolate concurrent runs (3366.5182ms)
Ô£ö PIVOT-002 fixture reports run and cleanup failures together (1.7244ms)
Ô£ö online and manual-transfer envelopes use the same signed challenge, monthly certificate and durable acceptance (40.5433ms)
Ô£ö tampering, foreign installation, certificate rollback and unsigned authority are rejected (14.0019ms)
Ô£ö expiry and clock rollback restrict writes while preserving history, export, backup and certificate evidence (9.9209ms)
Ô£ö a valid vendor signature does not authorize a foreign installation or an expired challenge (8.2661ms)
Ô£ö private foundation package excludes vendor issuer and its transitive imports; it is not advertised as installable (41.6367ms)
Ô£ö month-end recurrence anchors to the original day across leap years (7.0709ms)
Ô£ö schedule input retains exact balanced amounts and rejects control metadata abuse (5.2771ms)
Ô£ö passwords use unique scrypt salts and verify exact Unicode input (1296.0954ms)
Ô£ö password sign-in rejects a foreign origin before touching credentials (81.43ms)
Ô£ö sign-in rate limit stops before credential lookup or password work (18.0058ms)
Ô£ö SQLite projection commits cursor with deltas and survives a pre-cursor crash without double counting (13.1895ms)
Ô£ö backdated facts update the correct slice and denied or foreign-company aggregates never enter results (8.5407ms)
Ô£ö report DSL rejects raw SQL and source fixture rejects unbalanced or duplicate facts (4.4911ms)
Ô£ö private objects preserve original bytes, reject traversal/overwrite and detect tampering (86.461ms)
Ô£ö upload inspection rejects executable disguises, unsafe names and oversized streamed bodies (75.8352ms)
Ô£ö ClamAV protocol consumes original stream and distinguishes clean from infected results (79.4389ms)
Ô£ö agent tools inherit company and user authority and cannot approve or grant privileges (110.3419ms)
Ô£ö Worker end-to-end: invitation, preview, submit, new reviewer session, approval and retry (142.3691ms)
Ô£ö Worker serves static assets with security headers and fails closed without a database (3.6839ms)
Ô£ö health distinguishes an absent binding, an empty database and the full schema (6.9788ms)
Ô£ö PostgreSQL edge route preserves the command and overwrites forged origin metadata (5.3747ms)
Ô£ö maintenance and PostgreSQL outages never write to the former D1 database (2.3217ms)
Ôä╣ tests 150
Ôä╣ suites 0
Ôä╣ pass 150
Ôä╣ fail 0
Ôä╣ cancelled 0
Ôä╣ skipped 0
Ôä╣ todo 0
Ôä╣ duration_ms 19751.4542
```

DIAGNOSTIC:
- See `docs/contractor/deliveries/verify-workflow-diagnostic.md`.
- `scripts/check.mjs` was changed by `d5b7aaab12755ae7c835f4f158253f405bc736e3` (file `scripts/check.mjs`) to require a live PostgreSQL environment and run the focused test. At `9799ced94db422e1f3328561dd70a3bf0ef6b377` it was a database-independent parser/build check. It was not reverted, per the owner instruction; the observed no-PostgreSQL refusal is recorded in the diagnostic.
- The Verify SAVEN workflow does not trigger on `opencode/pivot-002`; its `on:` block targets `testing-1`/`main` pushes and pull requests to those branches. All 14 referenced `verify-*.mjs` scripts exist. `gh` is not installed/authenticated in this environment, so no `gh run list` output is available. No successful Verify SAVEN run exists for this branch; an unmerged PR targeting `testing-1` is required, and no PR was created under the diagnostic-only instruction.
- No changes were made to `.github/workflows/verify.yml` or `scripts/check.mjs` in this revision.

QUESTIONS FOR ENGINEER:
- Blockers 3 and 4 remain as diagnosed rather than fixed because the owner explicitly directed diagnosis only. If acceptance requires restoring `scripts/check.mjs` and opening an unmerged PR to obtain a Verify SAVEN run, please issue that separately; this session did not revert the PG requirement or create a PR.
- The review's inline contract also forbids changes to `10-operator-schema.sql`; its accepted entitlement/truncate fixes were retained unchanged.

DEVIATIONS FROM CONTRACT:
- The owner narrowed this correction to blockers 1 and 2, with blockers 3 and 4 diagnosed. The review's inline DONE WHEN includes restoring `scripts/check.mjs` and a successful Verify SAVEN PR run; both were deliberately not attempted, and no workflow or PR change was made.
- `origin/testing-1` had not advanced with this review, so the engineer review document was merged from `origin/codex/postgresql-engineering-20261115`; the merge commit is `3540245bd9534ce897c79cf9d08711203828b30b`. Published implementation commits were preserved; no rebase or force-push occurred.
- The fixture now executes the checked-in `00-roles.sql` rewritten only into `saven_pivot_<suffix>_*` names. Target roles are not created by handwritten fixture SQL. Runtime logins are separate from the migration login; only the migration login holds `saven_migrator`.
- The gate used a dedicated local `embedded-postgres` 18.6 cluster in gitignored `var/pg-test/data-pivot002c-*`; no owner-server or SSH access was used. The local cluster was stopped and its temporary credential/data directory removed after the gate.
- `saven_migrator` owns the operator schema and DDL objects as the offline migration role; runtime roles/logins own no objects and cannot assume migrator/definer authority directly or transitively. The disposable database is owned by the external administrative connection.
- Reference/JSON validation remains explicitly deferred and non-authoritative; issued entitlements and append-only histories remain immutable/truncate-protected.

EXTENSIBILITY: compliant — runtime and offline migration principals are separated, the actual bootstrap is validated and preservation-safe, issued entitlements/audit/provenance remain append-only, no hardcoded growing enums or cross-module concrete coupling were added, and deferred reference/JSON policy is documented rather than claimed.

GIT: branch=opencode/pivot-002 commits=3540245bd9534ce897c79cf9d08711203828b30b,942ae550bc6ac26f89db5a734bf1a298e77fbeb9 pushed=yes

