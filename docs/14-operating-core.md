# Operating core: implemented behaviour and limits

12 November 2026. This extends the accounting foundation; it does not complete the agreed commercial MVP. The full 239-requirement catalog remains required.

## Business setup

An authenticated ultimate owner can create a separate empty company with a PKR accounting year and ten initial accounts. Contacts, stock and transactions are not copied from the retained verification companies. Testing permits up to ten owned companies. Customer/supplier contacts, accounts and inventory items can be created through authenticated forms and the same API validation. Item creation starts at zero stock; it does not invent an opening quantity or valuation. Master editing, archival and opening reconciliation remain further work.

Company administrators can update business name/address/tax reference. Only the ultimate owner can change delegated membership roles or suspend access; the ultimate-owner membership cannot be changed this way. Only the ultimate owner can create administrators. Suspension preserves records and does not suspend the identity's other businesses. Only the ultimate owner administers period dates/locks, with a recorded reason. Overlapping periods are rejected.

Setup writes use atomic native PostgreSQL functions, company revisions, stable command keys and immutable configuration events. Exact retries return the original result; changed payloads conflict. Browser forms keep a command key for a submission. Shared posting commands continue to enforce current company, period and resource authority.

## Identity and invitations

Email/password sign-in uses Node's asynchronous scrypt (N=32768, r=8, p=1), a separate random 16-byte salt per credential, and constant-time derived-key comparison. No recoverable passwords are stored. Passwords contain 12-128 characters. Sign-in attempts are bounded per email and incoming Cloudflare IP; current-password checks have their own limit, and expensive concurrent derivations are bounded. These are basic controls, not evidence of independent security review or complete bot defence.

An eight-hour Secure/HttpOnly/SameSite=Strict cookie identifies one active server session. A new login or password/profile change rotates it and invalidates the previous session. Password changes verify the existing password where one is set, check credential version and remove outstanding unused bootstrap grants. Users set their own credentials. MFA, verified email, account recovery, attributed support access and notification delivery remain unfinished.

New identities receive an initial private, hashed, single-use bootstrap invitation. It expires in 24 hours. Setting a password closes that bootstrap route for the identity. An invitation for an existing identity is a pending company-membership grant, never a global sign-in token: that person must authenticate as themselves, have their own password and explicitly accept the company/role. Acceptance rechecks the issuer's current authority. An exact acceptance retry cannot reactivate membership after an owner suspends it. Raw invitation links appear only in the issuing browser; database/audit records contain hashes or non-secret metadata. Sharing is manual; no email is sent by this implementation.

The database runtime cannot directly read pending invitation hashes. Access goes through restricted functions. Public execution of security-definer functions is revoked, including in the restore-grant migration. Scope follows the current session, not a client-selected actor.

## Financial reports

Trial balance and balance sheet are cumulative through the selected date. Profit/loss and the general ledger use the selected date range. Calculations use posted journals and integer minor units. The trial balance displays net account balances separately from gross debit/credit movements; the balance-sheet equation includes accumulated earnings. Pending requests are excluded. A report with any per-resource restriction is denied in full until an explicit partial-report policy exists, avoiding incomplete statements being presented as full-company financials.

The ledger displays at most 500 lines and labels that cap; dates can narrow the result. Documents can be opened by ID with current permissions even beyond the workspace's latest 100 records. Reports have a print view. Statutory statement formats, notes, comparative periods, tax reporting, closing transfers and a custom report builder remain unimplemented.

## Verification

The native PostgreSQL 18 rehearsal used an isolated `saven_contract_20261112_c`, not the application database. Eight foundation groups and nine operating groups passed: non-owner row scope, company isolation, concurrent stock, atomic period failure, immutable balanced posting, blank company, real masters, invoice/full receipt with independent approval, delegation/revocation, persistent sign-in/session rotation, reports, period administration, cross-company identity protection, guessing limits and changed-email sign-in. The local suite passes 28 tests. These are correctness/security regression checks, not a load test, independent audit or complete MVP acceptance.

The new company and financial contract records are synthetic and confined to their contract database. The retained hosted verification records and owner's pending invoice are not used as write targets for these tests. Live deployment/browser evidence belongs in BUILD_STATE.md.
