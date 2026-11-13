# Offline companion and compatibility contract

Offline is associated with Cloud or Fully Private. Registered device/site identity, signed scoped user/action/resource authority, monotonic sequence, encrypted local storage, versioned policies, bounded licence lease and durable immutable evidence are required. It is not a third hosting product or full independent official reporting portal.

State contract: LOCAL_DRAFT → LOCALLY_COMMITTED → SYNC_PENDING → RECEIVED → CENTRALLY_POSTED, or explicit CONFLICT/REJECTED_WITH_REASON. Local operation UUID/content hash, device sequence, timezone/effective date, source/master/policy versions, dependencies, exact proposed accounting and evidence hashes survive retries. Server deduplicates the same operation ID, verifies authoritative current/effective policy, commits once and returns canonical ACK/cursor. Lost/late ACK does not justify another journal.

Bidirectional downloads are scoped. Conflicts show both versions, reason, accounting effect and authorized resolution; never overwrite a posted journal or invent a balancing plug. Branch stock/reservations/negative-stock policy must handle independent terminals. Offline licence expiry or unsupported protocol retains pending records and offers signed upgrade/sync recovery. Revocation cannot be instantaneous on disconnected hardware; lease bounds must be decided and tested.

Compatibility covers frontend/API/command/control/tenant/offline schemas, sync/event protocols, templates, Apps and AI tools. Accept explicitly tested prior protocols through version adapters. Old clients keep original evidence during conversion. No official full-business export from the companion; limited receipts/continuity remain permitted, with no impossible promise to prevent device-owner copying.

Required fixtures: bakery BOM/POS 100 offline sales; construction material/site payment/labour; duplicate and out-of-order uploads; server commit-before-ACK crash; closed central period; revoked permission; exhausted stock; malware; incompatible update and expired licence. None is presently implemented by a web design page.
