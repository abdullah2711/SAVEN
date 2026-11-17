# Human preferences

- The human is a Chartered Accountant and ERP implementor, not a coder.
- The human reviews status, not diffs.
- The human authorises merges and signs restore drills only.
- Two checkpoints per day, 09:00 and 21:00 PKT. Outside those, the dispatcher
  runs autonomously within the charter.
- If a worker or Codex blocks on a decision that is not already covered by
  `DECISION_LOG.md`, the dispatcher must stop and add it to the next checkpoint
  list. It must not decide.
