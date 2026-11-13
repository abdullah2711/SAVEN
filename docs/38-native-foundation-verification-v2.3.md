# Native foundation and design increment: implementation evidence

This increment begins at testing-1 `82efa086de75d1fd7788e6c1a2c32235eddd2b55`. The v2.3 sources and full v2 baseline were read before changes. Main, production, the live schema13 database and source-only schema14 are preserved. This document distinguishes source proof, synthetic design and live operation.

## What changed

| Area | Implemented in this increment | Status and limit |
| --- | --- | --- |
| Governing requirements | Full v2.3 sources, supersession, ADR017-020, risks, traceability and four additional child IDs | 255 requirements; original239 retained; APP-001 through APP-010 preserved |
| Design shell | One original SVG family for navigation, collapsible desktop sidebar, larger text and field labels | Source and asset graph verified; visual/browser acceptance and owner approval pending |
| Accounting design | Chart tree/detail, journal-register access, account/date/text ledger, synthetic CSV, source drill-down, statements with notes and close checklist | Synthetic fixtures only; full statutory notes, comparative reports and close actions remain incomplete |
| Invoice design | Editable lines, quantity, discount, inclusive/exclusive illustrative tax and credit/direct-cash/linked-settlement effects | Exact independently checked examples; no real invoice, tax rule, evidence upload or backend submission |
| Other design | Separate tax reconciliation, Apps scope grant/revoke simulation, private/vendor package selector and support request | Contract demonstrations; not an installed App, licence sale or access grant |
| Native storage | SQLite identity, entitlement, fleet, jobs and per-tenant files; checksummed migrations; WAL/FULL/FK; generated paths | Journal-only developer foundation, no public API, server, account login or complete tenant port |
| Native commands | Durable inbox before receipt, approval payload/digest, bounded worker lease, atomic source/lines/audit/outbox, repeat-ID protection | No GL before approval; source commit before POSTED; job repair only, full scheduler/retry/dead-letter fleet pending |
| Native authorization | Central membership plus tenant actions/company/branch/accounts/amount/review predicates, explicit deny, filtered read/count/total/export | Shared foundation path; field masks, support sessions, signed gateway assertions, offline and all module paths not yet ported |
| Native ownership | Immutable protected definition, unique assignment, activation existence guard and atomic transfer | Trusted service calls only; protected recovery, credential step-up, seat limits and central identity lifecycle still need implementation |
| Backup | SQLite online backup, new destination only, independently opened integrity/FK check and committed/pending recovery fixture | Tenant snapshot only; coordinated control/object restore, encryption/offsite rotation, disaster recovery and full financial reconciliation pending |
| Private licence | Ed25519 signed challenge/certificate/acceptance, installation/key binding, sequence, explicit validity and clock-regression checks | Synthetic monthly fixture policy, not an approved commercial policy; no production issuer/key, seat enforcement, revocation distribution, key recovery or complete private installer |
| Private composition | Explicit native foundation allowlist and transitive-import test excludes vendor issuer/global billing/registry | Full runtime/API/package composition is a later gate; no installable customer release claimed |

## Reproduce locally

Node24.13 or newer within the supported Node24 line is required. No Cloudflare, PostgreSQL server, SSH or private domain is needed for the new proofs.

```sh
python tools/build_feature_catalog.py
python tools/build_design_library.py
python tools/validate_plan.py
node scripts/check.mjs
node --test tests/*.test.mjs
node scripts/native-demo.mjs
node scripts/design-server.mjs
```

`native-demo` creates a fresh, ignored `var/native-qa/<random-id>` directory containing synthetic identities, four control files, one tenant, an unused object directory and a verified tenant snapshot. It prepares a100.00 debit/credit journal, durably receives it, posts once and reports the exact ledger. It does not run an authenticated service or connect the design UI to commands. The one-hour demo entitlement is explicitly a disposable test fixture, not subscription policy. Existing password/sign-in and PostgreSQL code are unchanged.

The design server prints a loopback URL and is read-only. Its script/module graph cannot call business APIs; `connect-src 'none'` and `form-action 'none'` remain enforced. No public tunnel or route was added. It is not the restricted offline companion.

## Verification evidence

Fresh baseline before edits:71 Node tests,98 parsed JavaScript files,251 requirement IDs. After this increment:89 Node tests passed,110 JavaScript files parsed,255 requirements validated and263 requirement-to-module mappings generated. These totals include retained baseline tests; they are not89 live server or PostgreSQL migration tests.

The additional tests independently check multi-line totals and settlement journals; durable receipt before scheduling; deduplication after a lost acknowledgement; direct preparer authority; explicit denial and account/branch isolation; pending approval with no GL; changed period/membership at execution; fault rollback; owner immutability/existence/transfer; filtered aggregates and exports; expired-write versus historical-read separation; worker lease expiry; database posting/audit guards; application restart recovery; independently opened backup; signed manual-transfer acceptance; certificate tampering/replay/foreign installation/expired challenge; clock regression and package imports. Initial key-object handling failures were corrected before the passing run. A temporary design syntax error was corrected before final parse checks. No failing test is silently omitted.

The native demo separately ran successfully: ACCEPTED_PENDING then POSTED, two ledger lines with100.00 debit and credit, independent backup integrity `ok` and schema1. This uses only new synthetic records.

No browser automation/control tool is available in this session. Therefore screenshot, responsive layout, keyboard interaction and visual polish acceptance are not claimed. The owner has not approved this design. Existing testing health and read-only SSH inspection confirmed PostgreSQL schema13 earlier in the increment; no native cutover or live migration was performed. Retained source tests are not proof of the complete deployed accounting module.

## Important technical boundaries

- NativeFoundation is a trusted in-process developer API. Actor IDs are trusted arguments, not an authenticated transport. Do not expose it directly to untrusted callers. Authenticated HTTP composition, sessions, CSRF/origin, rate limits, masked fields and administrator step-up must precede exposure.
- Provisioning records an intent before creating a tenant and publishes ACTIVE only after the local steps. A failure is quarantined; automated idempotent saga resumption is still required. Existing tenant files are never overwritten to fix a failure.
- Identity, entitlement and tenant stores are separate files. There is no cross-file ACID. The proof rechecks current central state but does not yet implement signed authority epochs, expiry bounds or distributed revocation fencing. The private verifier can be supplied through the entitlement-provider boundary; a complete private runtime and installer are not implemented.
- Approval evidence currently includes the accepted payload/digest and policy snapshot. Versioned object evidence and record-policy epochs across all modules remain required. There is no object/SQL atomicity claim.
- Journal arithmetic reuses the existing exact minor-unit module. It is not a rewrite or mechanical SQL-driver substitution of the PostgreSQL system. Other financial modules, subledgers and financial statement/report parity remain required before replacement.
- Native jobs repair derives orchestration from durable owning receipts. Full worker scheduling, retries/dead letters, event consumers and fleet migration are not implemented by merely recording job rows.
- The private certificate verifier assumes trusted installed code, clock and state file. Root/hypervisor administrators can tamper or clone; no root-proof licence or immediate air-gap revocation is claimed. Signed fixture seats/modules are parsed, not yet a complete assignment-enforcement system. Missing or expired entitlement retains lawful historical read/export/backup and pending records.
- No server route, DNS, tunnel, service or image was changed manually. Existing branch-connected static build automation may publish the testing design assets when testing-1 is updated. The live PostgreSQL API is routed separately and was not migrated.

## Next implementation gates

1. Browser/owner review of the refined accounting/invoice/tax flows; refine chart/GL/trial balance/notes/export/credit-note/evidence workflows and remaining module details without claiming approval.
2. Authenticated local runtime around the shared command contracts, durable session/epoch enforcement, protected account lifecycle and field/resource policy conformance across search/reports/AI/workers.
3. Native invoices/payments/tax/subledger/stock/asset contracts against independent PostgreSQL fixtures; immutable correction and evidence controls. Reconcile all source-object inventory entries.
4. Provisioning saga resume, durable workers/dead letters, coordinated identity/tenant/object restore, per-tenant forward migrations/canaries and failed-node isolation.
5. Approved licence lifecycle policy, installation/restore/key-recovery binding, seat assignment and complete private runtime/package/API separation; clean-server installer and signed release artifacts.
6. Independent native financial/security/backup/fleet/offline/BI acceptance. Only then prepare a reversible testing cutover plan for explicit owner authorization; no destructive decommission or production promotion is implied.

## Remote evidence after publication

Implementation cd9eeac0d5785b1cf680381fd4a933b1bcb239fe was published only to testing-1 with a guarded non-force update. Its first CI run43479316617 failed at the Linux package-test path assertion. Follow-up b0ebbee6959dc3bc42899f67447b8b45c6a7787a corrected the path derivation and run43479582286/job132072263523 passed:89 Node tests,110 parses, catalog validation/reproducibility and all retained isolated PostgreSQL contracts through the source schema14 invoice/tax suite. This is independent source verification, not live schema14 activation. Public v2.3 design assets returned200 and API health still reported ready PostgreSQL schema13. Main was independently unchanged. Final company-context correction preserves selection and keeps the empty synthetic company from displaying Northstar fixture totals; visual browser acceptance remains pending.

Final source6d994cbbb5531ce5ec5dbc1214e697da6c563f4e passed run43480212121/job132074438999 and the testing Cloudflare build. Eight deployed design assets matched source; public API remained ready PostgreSQL schema13. Exact hashes/timestamp are in docs/v23-first-increment-evidence.json. These observations do not constitute visual browser approval or complete ERP/private/native acceptance. The pre-existing extra production-named saven build failed; production settings were left untouched.
