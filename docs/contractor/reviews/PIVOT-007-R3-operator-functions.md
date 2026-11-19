VERDICT: ACCEPT

WHY: The three outstanding corrections in `92f3e00` are addressed. The publishing adapter now compares the actual captured AUTH-007 admission policy with the expected/final SQL policy; SQL reserves policy writers and evaluates the policy window after its blocking gates; early bearer refusals attempt independently durable, unverified denial recording. The previously accepted consent, definer and attribution corrections remain present.

Recorded from date: 2026-11-20 02:36:28 PKT (+0500).
Delivery tree: `675fab6cb264f0fa4b30b808b9e8c2ea227aabeb`; implementation: `102e39a54e3bb129b7b0c0165b13dfe541396929`; declared base: `testing-1 @ e0fa9fbb0eaaa1d96046aafbb33963e6732f347a`.
Worktree: `/home/esc/saven/wt-rev-pivot-007-r3`.
Delivery: `docs/contractor/deliveries/PIVOT-007-operator-functions.md`.
Prior review: [PIVOT-007 R2](PIVOT-007-R2-operator-functions.md), `92f3e00`; bounded adapter and metadata-only auth amendments remain controlling.
MERGE RISK: HIGH / Tier 1 — privileged customer disclosure, authentication composition and durable operator audit.
ROUTING: ACCEPT queues for a human Business Merge Request; it is not merge approval. Engineer records the durable queue row before any BMR. No engineer merge or dispatch. PIVOT-007 integrates first under the Principal's discipline; PIVOT-014 must then rebase and supply evidence on the resulting head before its own merge. This ACCEPT satisfies PIVOT-007's review gate for PIVOT-008, subject to prerequisite integration and normal human routing.

## Outstanding finding dispositions

1. **Actual AUTH-007 source-age/skew consistency — CLOSED.** `src/auth/access.mjs` constructs an `Object.freeze` descriptor from the validator's captured issuer, audience, mandatory assurance, maxTokenAgeSeconds and skewSeconds. `admitSession` returns that descriptor through `inspectSession`; the adapter compares those actual values before its operator-read transaction. The descriptor is not derived from expectedPolicy. The SQL result's fingerprint still checks the configured version and settings actually selected by SQL before COMMIT/publication. Metadata exposure is within the narrow amendment; authentication, replay, locking and lifetime algorithms are not changed.

   Named evidence: `PIVOT-007 adapter compares the actual AUTH-007 age/skew descriptor, not expected values` independently mismatches real validator skew (30 versus SQL/adapter60 at max age300) and real source age (300 versus SQL/adapter200), with exact `OPERATOR_POLICY_DRIFT` refusal. `PIVOT-007 adapter refuses post-preflight source-age boundary crossing with a permitted control` exercises the same additive age/skew boundary with shortened 5+2-second values, refuses `OPERATOR_ACCESS_EXPIRED` after delay and permits an inside-window control. It does not literally wait through a 300+60-second boundary; no such run is claimed.

2. **Policy window after the final blocking gate — CLOSED.** `50-functions.sql` adds an exclusive statement-trigger policy-writer gate for INSERT/UPDATE/DELETE and a matching shared gate held by admitted reads through accountability COMMIT. Runtime protocol validation includes its function profile and unconditional trigger bindings. Read order is authority gate, principal/session locks, consent gate, policy gate, final `clock_timestamp()`, then active/effective policy selection and authority/freshness checks. The policy is no longer selected before the consent wait, and cooperating policy updates cannot change its authority before read COMMIT.

   Named evidence: `PIVOT-007 revalidates policy expiry after the consent-gate wait and serializes policy writers` checks expired-policy refusal `OPERATOR_POLICY_REQUIRED`, no success audit, a still-effective permitted read and policy-update lock timeout while adapter COMMIT is held. The installed-protocol negative includes a disabled policy trigger. Existing consent/session/source wait-expiry coverage remains. The policy-writer COMMIT barrier confirms entry; expiry scenarios still use wall-clock sleeps rather than a confirmed database wait observation, so they are time-based regression evidence, not a claim of deterministic scheduler instrumentation. The inspected SQL ordering independently supports this closure.

3. **Early malformed bearer refusal accountability — CLOSED.** Missing/short/oversize bearer values now enter `refuseEarly`, which records through the independent denial transaction with no session proof or verified actor. Tenant is UUID-validated and other target fields are bounded or NULL. The rejected bearer is not hashed or passed to SQL. A logging outage preserves `401 OPERATOR_CONTEXT_REQUIRED` and exposes `denialLoggingFailed` / `committed:false` rather than claiming durable evidence.

   Named evidence: `PIVOT-007 adapter records early bearer refusals and exposes logging outage` checks three refused values, exactly three unverified denial rows, absence of the oversize sentinel, a successful authorized read, and explicit denial-write outage. An omitted token follows the same `typeof token !== 'string'` branch as tested NULL; no separate omitted-token execution is claimed. Constructor configuration errors and malformed non-auth request arguments remain distinct from authentication refusals.

## Original finding continuity

| Original finding | Final disposition |
| --- | --- |
| 1 — genuine bearer admission and commit-before-disclosure adapter | CLOSED. Real AUTH-007 exchange/inspection precedes an independently final constrained SQL transaction; rows stay private until awaited COMMIT. Policy consistency and early-refusal residuals close above. No combined auth/operator login or new runtime auth EXECUTE grant. |
| 2 — current authority, assurance, freshness and installed protocol | CLOSED for reviewed scope. Current proof/epochs/incarnation/role/assurance checks remain; actual configuration and final effective-window corrections close above. |
| 3 — customer consent serialization | Remains CLOSED. Shared consent authority survives through publication COMMIT; existing revocation blocking and post-release refusal controls remain. |
| 4 — narrow definer installation | Remains CLOSED. No expansion of tenant table access or runtime definer membership; exact authority-surface and poisoned-owner negatives remain. The new policy trigger is invoker-owned infrastructure, not an additional broad runtime definer. |
| 5 — truthful denial attribution | Remains CLOSED. Current valid role/assurance determines verified fields; stale/unverified callers are labelled unverified. Neither raw bearer nor equivalent proof digest is added to results or audit. |

## Evidence, scope and limits

Worker reports Node24.19.0/PostgreSQL18.6, `node scripts/check.mjs` parsing174 files successfully, **31/31** focused PIVOT-007 tests and **22/22** accepted AUTH-007 regressions. The report identifies a dedicated disposable loopback cluster and namespaced separate restricted login roles, not merely SET ROLE from an administrator. Prior full040/041/042 stack composition and denial/rollback/size-one-pool tests remain in the suite. Inspection of the correction diff found eight changed paths within the amended scope and no applied migration-payload rewrite. Reviewer executed no contractor test, migration, SQL mutation, restore or deployment; source/Git inspection and worker-supplied gate results are distinguished.

The adapter's injected COMMIT failure proves conservative withholding/destruction, not real network acknowledgement loss after server COMMIT. Confirmed entered-COMMIT barriers improve publication-order evidence. Denial durability is bounded by the independent database write; a database/audit outage is explicitly observable, not a promise of impossible guaranteed logging. Deployment must supply the real captured validator descriptor and matching effective SQL policy; no HTTP route, production activation, pooler certification or unrestricted operator access is approved here.

Can a client-supplied header, query param, or body value influence tenant_id or user_id?

Clients choose requested tenant/resource/action/company and support reason, but those values supply no actor or consent authority. Verified bearer-derived session proof, current mapping incarnation, current principal/role/assurance, effective policy and customer grant govern the final SQL read. Unknown early callers remain unverified in audit. Trusted injected configuration is an application composition boundary, not a client identity assertion.

EXTENSIBILITY: no new hardcoded enums; no new coupling across module boundaries; no new one-way decisions without an ADR.

The fixed reviewed SQL resource allow-list remains a bounded privilege surface; growing business configuration remains versioned policy data. Actual-policy metadata is exposed through the accepted injected interface rather than a new concrete cross-module import. D-016 advance-only identity and permitted-gap rules remain intact: this delta does not change allocators or accepted bindings. D-018's live legacy IAM ownership and BUSINESS_ROLE_SAVED carry-forward are unaffected. Preserve D-012 digest-only display, D-014 role-agnostic void visibility, applied payload bytes and native/reference behavior. SQLite remains production. No merge, cutover or decommission authorization is granted by this verdict.
