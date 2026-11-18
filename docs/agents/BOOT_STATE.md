# BOOT_STATE — SAVEN disaster-recovery boot record

DISPATCHER FIRST ACTION ON BOOT: (1) read this file; if present, also read the machine footer at `docs/agents/BOOT_STATE_machine.md` — note it is generated at black-box time and exists on the `system-checkpoints` branch, not necessarily on `testing-1`; when absent, the prose in this file is authoritative; (2) run `bash ~/.local/bin/saven-recover` if panes/processes are dead; (3) inject the Checkpoint Reload bootstrap into any relaunched worker pane; (4) resume routing. Protocols: `docs/agents/CONTRACTOR_ROLE.md`, `docs/agents/DECISION_LOG.md`, `docs/contractor/CONVENTIONS.md`.

Last revised: 18 Nov 2026, 03:55 PKT (dispatcher — prose refresh after PIVOT-006 merge; housekeeping directive).
Last human review: none yet — this line advances ONLY on an actual Principal review of this file, never on dispatcher edits.

## Integration state
- `testing-1`: accepted and integrated, one ID per line (counts reconcile to the 24 contract files: 14 merged + 10 remaining; PIVOT-002c is NOT a missing contract file — it was executed under the PIVOT-002b review's scoped directive and has its own delivery/review records, but no standalone contract file was authored):
MERGED (14): PIVOT-002, PIVOT-002b, PIVOT-002d, PIVOT-003, PIVOT-004, PIVOT-005, PIVOT-006, AUTH-001, AUTH-002, AUTH-003, AUTH-004, AUTH-005, AUTH-006, AUTH-008.
REMAINING (10): AUTH-007 (delivered, review round 2 in flight), AUTH-009, AUTH-010, PIVOT-007, PIVOT-008, PIVOT-009, PIVOT-010, PIVOT-011, PIVOT-012, PIVOT-013.
- Merge queue: empty; no pending ACCEPTs awaiting the human except in-review work.
- AUTH-chain progress: 7 of 10 AUTH contracts merged (AUTH-001..006, 008). AUTH-007 delivered, in review. After AUTH-007 merges: AUTH-009 (auth audit) runs BEFORE the vertical slice; AUTH-010 (security docs) runs AFTER the slice passes. The auth chain is NOT complete until 009 and 010 are merged.
- Sequencing per Principal directive: AUTH-007 merge → AUTH-009 → vertical slice (one tenant, one chart of accounts, one posted entry, one void, audit read-back) → AUTH-010 → then UI. UI contracts stay HELD until the vertical slice passes.

## Workers
- worker-a (w1:p2): contract AUTH-007 (operator access), branch `opencode/auth-007-operator-access`, worktree `/home/esc/saven/wt-auth-007`, based on `0df990a`. AUTH-006 merged at `0df990a`.
- worker-b (w1:p3): contract PIVOT-006 (audit triggers) round 3, branch `opencode/pivot-006-audit`, worktree `/home/esc/saven/wt-pivot-006`, based on `32fef2b`. Fixing review `5ddb603` (+ Principal Part 1: catalog type identity, domain tests, three hardening items).
- Engineer (w1:p4): reviews land on `codex/pivot-003-rulings`; relay pattern: `Review <delivery-path>`. Latest review head: `b677627`.

## Standing protocols
- At every merge handoff, the worker executing the merge updates the Workers section of docs/agents/BOOT_STATE.md in the same push.
- Merge rules: docs/test-only ACCEPTs auto-merge by worker (Rule 1); database/auth/accounting/UI ACCEPTs require a plain-English Business Merge Request and the human's APPROVED (Rule 2). Worker executes the merge; dispatcher never merges.
- Checkpoint-and-Reload: at 85% context, worker writes `docs/contractor/state/worker-<ID>-checkpoint.md` (with failure evidence: exact error text, failing test, current hypothesis), commits, pushes, stops; dispatcher kills and relaunches the session, then sends the bootstrap: "You are WORKER-[A/B]. Read docs/agents/CONTRACTOR_ROLE.md. Then read docs/contractor/state/worker-[a/b]-checkpoint.md to resume your exact task. Do not deviate from the contract TOUCH limits. Output CHECKPOINT_RELOADED when you are ready to continue."
- Worker map: `docs/agents/worker-map.env` is load-bearing — dispatcher updates it on every assignment, verdict and merge; the black-box script refuses to push when contract and branch disagree.
- Black box: cron `*/30` archives checkpoints (explicit per-worker sourcing), contracts, reviews, deliveries and docs/agents to branch `system-checkpoints` (off-site). STALE-CHECKPOINT/MAP-DISAGREEMENT/ARCHIVE-BROKEN alarms annotate commits and are reported to the human.
- Automation: systemd user unit `saven-heartbeat.service` (heartbeat + dispatcher watchdog); `~/.local/bin/saven-recover`; `~/.local/bin/saven-checkpoint-commit` (v3.2); approval monitor `~/.saven-agent/codex-approval-monitor.sh`.

## Open owner decisions
- None pending. UI contracts held until the vertical slice passes (Principal directive, 18 Nov).
