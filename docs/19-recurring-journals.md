# Recurring journal schedules

This is part of ACC-003, not completion of that requirement. Schema 9 adds fixed-value monthly, quarterly and annual general-journal templates. It does not calculate accrual estimates, allocations, amortization, tax or automatic reversal schedules.

Administrators create a unique template with an immutable financial payload, first date and 1 to 120 occurrences. Accounts must be active general or cash/bank ledgers; direct control-account journals are rejected. Every occurrence uses the shared accounting preview, explicit submission and independent approval. Nothing is automatically posted or paid. Dates anchor to the original day and clamp to month end without drifting in following months.

PostgreSQL atomically claims each occurrence while inserting its document. A partial unique index permits only one pending/posted attempt. Returning a request preserves it and allows the next numbered attempt. An administrator may pause or resume future preparation with a reason; an already pending request retains its approval route. Changes to amounts or mappings require a new template code and pausing the old template. Historical documents are never rewritten.

Native tests cover exact money, calendar anchors, idempotency, competing claims, pause/resume, rejection/retry, independent approval, period locks and current permissions. Check BUILD_STATE for the source commit, server activation, hosted tests and recovery separately.
