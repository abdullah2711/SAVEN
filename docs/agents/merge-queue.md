# SAVEN MERGE QUEUE — durable approval control (Rule 2)

The dispatcher reports queue state FROM THIS FILE, never from recollection.
An item leaves the queue ONLY by: (i) human APPROVED and merged; (ii) Codex
withdrawing via a superseding review; (iii) human refusal. Updated and
committed on every change.

Principal protocol revision, 19 November 2026: the ENGINEER writes the queue row at VERDICT time, before any BRM. The merging worker flips it to MERGED at handoff. The dispatcher no longer writes to testing-1 at all.

| Contract | Codex verdict sha | BRM issued (PKT) | State |
|---|---|---|---|
| PIVOT-006 (audit triggers) | 26f8263 (ACCEPT, R3) | 2026-11-18 03:00 | MERGED at `bdf9f80` (human APPROVED 18 Nov) |
| AUTH-007 (operator access) | bbcccc2 (ACCEPT, R5) | 2026-11-19 00:55 | MERGED at `9b9d47f` (human APPROVED 19 Nov) |
| AUTH-009 (auth audit) | 27e9190 (ACCEPT, R4) | 2026-11-19 ~14:30 PKT (BRM issued late — corrected) | MERGED at `5b86ced` (human APPROVED 19 Nov) |
