# BOOT_STATE — SAVEN disaster-recovery boot record

DISPATCHER FIRST ACTION ON BOOT: (0) read `/home/esc/saven-ALERTS.log` (mirrored to `docs/contractor/state/ALERTS.log` on `system-checkpoints`) — the factory alert record; the Principal reads it first each session until an out-of-band notification channel exists; (1) read this file; if present, also read the machine footer at `docs/agents/BOOT_STATE_machine.md` — note it is generated at black-box time and exists on the `system-checkpoints` branch, not necessarily on `testing-1`; when absent, the prose in this file is authoritative; (2) run `bash ~/.local/bin/saven-recover` if panes/processes are dead; (3) inject the Checkpoint Reload bootstrap into any relaunched worker pane; (4) resume routing. Protocols: `docs/agents/CONTRACTOR_ROLE.md`, `docs/agents/DECISION_LOG.md`, `docs/contractor/CONVENTIONS.md`.

Last revised (dispatcher): 18 November 2026 (Asia/Karachi), BOOT_STATE housekeeping.
Last human review: none yet — advances only on an actual Principal review.

## Integration state
MERGED (17):
- PIVOT-002
- PIVOT-002b
- PIVOT-002d
- PIVOT-003
- PIVOT-004
- PIVOT-005
- PIVOT-006
- PIVOT-007
- AUTH-001
- AUTH-002
- AUTH-003
- AUTH-004
- AUTH-005
- AUTH-006
- AUTH-007
- AUTH-008
- AUTH-009

REMAINING (7):
- AUTH-010
- PIVOT-008
- PIVOT-009
- PIVOT-010
- PIVOT-011
- PIVOT-012
- PIVOT-013

PIVOT-002c resolution: executed under the PIVOT-002b review directive; no standalone contract file; not a missing file. Counts enumerate the 24 standalone contract files, not an additional 002c contract.

- Merge queue: docs/agents/merge-queue.md is the single source of truth.
- AUTH-chain progress: 9 of 10 AUTH contracts merged (AUTH-001..007, 008, 009). AUTH-010 (security docs) runs AFTER the vertical slice passes. The auth chain is NOT complete until 010 is merged.
- Live sequencing per Principal directive: AUTH-009 merged at `5b86ced` → vertical slice (worker-b) → AUTH-010 → UI. PIVOT-006 and AUTH-007 are merged; UI contracts stay HELD until the vertical slice passes.

## Workers
- worker-a (w1:p2): PIVOT-007 (operator functions) merged into `testing-1` at `550d120`. Next assignment = checkpoint + reload, then PIVOT-008 (RLS coverage gate; TOUCH db/postgres/README.md + a coverage-gate test — VERIFY TOUCH against the PIVOT-014 slice (043/vertical-slice files) and report any overlap BEFORE starting); not yet dispatched — awaiting fresh dispatcher reload.
- worker-b (w1:p3): unchanged — PIVOT-014 corrections in flight.
- Engineer (w1:p4): reviews land on `codex/pivot-003-rulings`; relay pattern: `Review <delivery-path>`. Latest review head: `27e9190` (AUTH-009-R4 ACCEPT).

## Standing protocols
- At every merge handoff, the worker executing the merge updates the Workers section of docs/agents/BOOT_STATE.md in the same push.
- Merge rules: docs/test-only ACCEPTs auto-merge by worker (Rule 1); database/auth/accounting/UI ACCEPTs require a plain-English Business Merge Request and the human's APPROVED (Rule 2). Worker executes the merge; dispatcher never merges.
- Checkpoint-and-Reload: at 85% context, worker writes `docs/contractor/state/worker-<ID>-checkpoint.md` (with failure evidence: exact error text, failing test, current hypothesis), commits, pushes, stops; dispatcher kills and relaunches the session, then sends the bootstrap: "You are WORKER-[A/B]. Read docs/agents/CONTRACTOR_ROLE.md. Then read docs/contractor/state/worker-[a/b]-checkpoint.md to resume your exact task. Do not deviate from the contract TOUCH limits. Output CHECKPOINT_RELOADED when you are ready to continue."
- Worker map: `docs/agents/worker-map.env` is load-bearing — dispatcher updates it on every assignment, verdict and merge; the black-box script refuses to push when contract and branch disagree.
- Black box: cron `*/30` archives checkpoints (explicit per-worker sourcing), contracts, reviews, deliveries and docs/agents to branch `system-checkpoints` (off-site). STALE-CHECKPOINT/MAP-DISAGREEMENT/ARCHIVE-BROKEN alarms annotate commits and are reported to the human.
- Automation: systemd user unit `saven-heartbeat.service` (heartbeat + dispatcher watchdog); `~/.local/bin/saven-recover`; `~/.local/bin/saven-checkpoint-commit` (v3.2); approval monitor `~/.saven-agent/codex-approval-monitor.sh`.

## Open owner decisions
- None pending. UI contracts held until the vertical slice passes (Principal directive, 18 Nov).
