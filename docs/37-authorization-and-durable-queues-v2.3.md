# Native authorization, ownership and durable command states

One path: identity/session → membership/entitlement/epoch → tenant role + explicit deny → company/branch/resource/field/amount/action conditions → parameterized scoped query or canonical command. The UI cannot confer authority. Search/totals/export/AI/worker/support use the same decision and masked projection. Owner status is immutable authority, not a role name.

Exactly one ultimate_business_admin definition and active principal per activated tenant. Unique index prevents a second holder; activation/transfer transaction and tests prevent zero holders. Ordinary role CRUD cannot rename/delete/deactivate the protected definition, clone its authority or bypass seat limits. Transfer/recovery is an explicit future verified workflow; no vendor universal owner exists.

| State/class | Owning durable store | Meaning |
| --- | --- | --- |
| NOT_RECEIVED | None | Server has not acknowledged durable receipt |
| ACCEPTED_PENDING | Tenant command_inbox | Immutable payload/hash/actor/operation ID persisted before ACK |
| AWAITING_APPROVAL | Tenant approval request + payload/evidence/policy versions | No canonical journal yet; reviewer must revalidate |
| POSTED | Tenant source + journals/subledger + audit + dedupe + outbox | One local durable commit completed before response |
| REJECTED / CONFLICT | Tenant immutable decision history | Explicit reason; do not overwrite original evidence |
| DELIVERY_FAILED | Outbox/job delivery record | Follow-on failure does not undo an already posted journal |

WAL/local disk, FULL financial durability, foreign_keys verified on every connection, bounded busy timeout and BEGIN IMMEDIATE writer path. Inbox workers claim bounded leases with worker/token/expiry; stale leases cannot finish. Recheck current role, entitlement, period and record versions before final posting. Approvals do not post stale payloads blindly. Post-commit consumers dedupe; outbox, invoice and billable usage cannot be silently dropped. Separate jobs.sqlite is orchestration after owning-source durability, not a financial authority.

Cross-file identity and entitlement are verified internal/signed claims with explicit epoch/expiry; no claimed cross-file transaction. Root/file owners can bypass app protections. Separate object staging/hash/scan and metadata/outbox recovery; bytes and SQL rows are not one ACID commit.

Tests: denied row/field/search/aggregate/export; wrong tenant/company; custom Owner role clone; owner deletion/second holder; repeated operation with changed payload; crash before acceptance; crash after receipt; commit-before-ACK retry; stale worker; changed policy/period while queued; source/outbox failure rollback; independent snapshot restore. Full module parity and fleet/5m-line load remain separate gates.

## Bounded implementation evidence

The native journal proof now tests protected owner activation/atomic transfer, resource/action/amount/review predicates, durable receipt, approval, posting guards, restart/retry/lease and tenant snapshot. This does not complete the contracts above: authenticated transport, central epoch fencing, field masks, full object evidence, all-module parity, automated recovery and fleet remain pending. See docs/38-native-foundation-verification-v2.3.md.
