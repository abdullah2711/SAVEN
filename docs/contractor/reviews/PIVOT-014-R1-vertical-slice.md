VERDICT: REVISE — PARTIAL CLEANUP REVISION

WHY: The submitted tree does not contain the relayed corrections to findings 1–5. Relative to be2f76b it changes only the disposable-helper cleanup and report text; all business/auth/repository/SQL/test/cover files remain identical. One part of finding 5 is addressed, with important cleanup hazards remaining. No whole-contract acceptance is possible.

Recorded from date: 2026-11-19 23:19:45 PKT (+0500).
Delivery/HEAD: `opencode/pivot-014-vertical-slice @ ff667778bb55be588cb4664149f597b4d324d2bc`, verified in `/home/esc/saven/wt-rev-pivot-014-r2`.
Base: `testing-1 @ e0fa9fb`; compared directly with reviewed delivery `be2f76b` and original implementation `37399da`.
Lineage: ff66777 -> 0fb9579 (report identity) -> be2f76b -> 37399da. No intervening AUTH-006, permissions, allocator or repository correction is present in this lineage.
Delivery: `docs/contractor/deliveries/PIVOT-014-vertical-slice.md` still identifies original implementation37399da and original reportbe2f76b. Delivered cover: `docs/contractor/deliveries/PIVOT-014-vertical-slice-cover-sheet.md`, unchanged.
Governing review: [PIVOT-014](PIVOT-014-vertical-slice.md), `cfe9e0d`.
MERGE RISK: HIGH — accounting/security/foundation gate.
ROUTING: return for correctly identified correction delivery. No ACCEPT/BMR/merge. PIVOT-007 remains separately in REVISE; retain the Principal's conditional PIVOT-007-first merge/rebase discipline if it later ACCEPTs. Engineer performs no dispatch.

## Per-finding disposition against cfe9e0d

| Finding | Status at ff66777 | Evidence / still required |
| --- | --- | --- |
| 1 — real AUTH-006 boundary | UNTOUCHED / OPEN | application.mjs and repository unchanged; replacement preflight, missing authority reservation and omitted accepted hardening remain. No new proving test. |
| 2 — canonical permissions and final-write revalidation | UNTOUCHED / OPEN | journal-service.mjs, repository and SQL unchanged; read/list/audit authority and earlier-transaction validation gaps remain. No new proving test. |
| 3 — immutable actor/content-bound allocation and D-016 | UNTOUCHED / OPEN | reserveNumber still uses tenant/id alone and a rollbackable counter; no new receipt binding, allocator implementation or test. |
| 4 — uncertain-client destruction | UNTOUCHED / OPEN | checkout/transaction/reserveNumber unchanged; finally return and swallowed rollback uncertainty remain. No new proving test. |
| 5 — S2 setup/cleanup/budget/no retry | PARTIAL / OPEN | new provision try/catch attempts stop/removal after some setup failures; earlier allocation failures, uncertain stop, unbounded child work, swallowed cleanup and readiness retries remain. No added fault-injection test. |
| 6 — transactional balance/post-key behavior | UNTOUCHED / OPEN | service/ports/test unchanged; outside-transaction balance check and unused post key remain. |
| 7 — false-positive S1–S9 proofs / cover claims | UNTOUCHED / OPEN | entire permanent test and cover unchanged; aborted-transaction DELETE, promise-count overlap, missing controls/metadata checks and false reinstall proof remain. |
| 8 — active security-audit version pin | UNTOUCHED / OPEN | application and test unchanged; adapter still reports the pin rather than active configured writer version. |

The relay's claim that findings1–5 are closed conflicts with the exact Git diff, not with a reviewer interpretation of new runtime code. The worker report itself still presents the original implementation/evidence and adds only setup-cleanup wording; this review does not attribute the inaccurate relay to the worker. If another correction commit was intended, route its actual SHA; do not mark this tree accepted on that description.

## Finding 5 — what changed and what remains

The helper now wraps provision() in try/catch, sets started after successful pg_ctl start, attempts stop when started and removes the directory before rethrowing. That can clean an init/schema/provisioning failure after entering the try, and is a useful partial improvement.

It does not close the original requirement:

- mkdtemp is followed by await allocatePort and mkdirSync before the try, so failure there leaks the owned directory.
- started becomes true only after pg_ctl -w succeeds; a process that starts but fails/times out before successful acknowledgement may be left alive while catch removes its data directory.
- catch invokes raw spawnSync(stop) without checking status/error, then unconditionally removes the directory. The normal stop path likewise removes it even on failed stop. This can destroy diagnostic evidence beneath an unconfirmed live cluster.
- synchronous process calls remain without an enforceable whole-test timeout; the elapsed assertion still precedes cleanup, pool/admin cleanup failures are still swallowed, and waitReady still retries failed psql probes to green.
- no tests were added to inject setup/start/port/schema/stop failures or establish process/role/directory preservation and bounded cleanup. The report's no-residue observation is worker-reported happy-run evidence, not proof of these refusal paths.

Retain ownership from the first allocation, verify process shutdown before removing a live cluster's files, preserve primary plus cleanup failure evidence and enforce the declared whole budget including child processes/teardown. Supply the bounded fault probes already requested, without touching factory automation or unrelated contracts.

## Corrective handoff

Worker owns the still-open implementation/test corrections from cfe9e0d. Before the next handoff, label a partial delivery PARTIAL and enumerate findings1–8 individually with DONE/PARTIAL/UNTOUCHED, exact named proving tests, missing producer/implementation/test evidence, current implementation/report SHAs and resolution owner. Do not repeat the original assertion mapping/cover as proof of new corrections. Engineer owns any necessary bounded TOUCH/interface amendment; worker must request it before modifying accepted auth/SQL or broader policy surfaces. No required S1–S9 property is weakened.

Evidence boundary: no new gate transcript is identified for the changed helper at ff66777; the report retains original9/9 and mutation evidence plus a claimed final no-residue observation. Reviewer inspected exact Git history/diff and helper source, ran no contractor gate/test/SQL mutation/migration/restore/deployment, and claims no observed production leak or cleanup failure. Source-derived unresolved paths remain enough to refuse acceptance.

Can a client-supplied header, query param, or body value influence tenant_id or user_id? The original bespoke snapshot admission remains unchanged; the accepted reserved AUTH-006 boundary has not been composed in this submitted tree. UUID shape and trace labels still do not establish current authority.

EXTENSIBILITY: no new hardcoded enums; no new coupling across module boundaries; no new one-way decisions without an ADR. Preserve accepted interfaces, applied history, D-012/D-014/D-016/D-017/D-018 and SQLite production. This revision approves neither foundation acceptance, cutover, merge nor dispatch.
