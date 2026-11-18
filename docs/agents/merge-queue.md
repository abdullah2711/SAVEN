# SAVEN MERGE QUEUE — durable approval control (Rule 2)

The dispatcher reports queue state FROM THIS FILE, never from recollection.
An item leaves the queue ONLY by: (i) human APPROVED and merged; (ii) Codex
withdrawing via a superseding review; (iii) human refusal. Updated and
committed on every change.

| Contract | Codex verdict sha | BRM issued (PKT) | State |
|---|---|---|---|
| PIVOT-006 (audit triggers) | 26f8263 (ACCEPT, R3) | 2026-11-18 03:00 | MERGED at `bdf9f80` (human APPROVED 18 Nov) |
