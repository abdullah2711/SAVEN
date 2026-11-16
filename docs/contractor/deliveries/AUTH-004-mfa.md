CONTRACT: docs/contractor/contracts/AUTH-004-mfa.md
STATUS: DONE — enforced tenant-admin TOTP assurance, encrypted seeds, hash-only single-use recovery codes and the factor lifecycle are implemented behind the auth adapter; the active SQLite path is untouched.

## Identity

- Branch: `opencode/auth-004-mfa`, base `testing-1` at `34747eee0a8af604c01297eb471fdc5c3c2e68c7` (the AUTH-003 merge).
- Commits: `511b1cd` (implementation and tests), plus this report commit.
- Worktree: `/home/esc/saven/wt-auth-004`.
- Node `v24.19.0`; disposable PostgreSQL 18.6 on loopback `127.0.0.1:55444` (stopped and deleted after the gate).

## Files changed

- `src/auth/factors.mjs` — TOTP service: AES-256-GCM versioned seed envelopes, RFC 6238 verification with ±1 step window and single-use step consumption, failure/lockout accounting, recovery-code issue/consume, enrollment restart, disable-by-reset, authority lookup.
- `src/auth/routes.mjs` — password login now derives MFA authority (`auth.roles.requires_mfa` via active membership), issues a pending session, gates non-MFA endpoints, and adds `/v1/auth/mfa`, `/enroll`, `/enroll/verify`, `/verify`, `/disable` with CSRF/origin checks.
- `src/auth/session-store.mjs` — `setSessionAssurance` upgrades/downgrades assurance with the same revoked/expired/disabled/credential-epoch guards as refresh.
- `src/auth/README.md` — MFA routes, invariants, configuration/fail-closed behaviour, extension points.
- `tests/auth-004-mfa.test.mjs` — 10 focused tests.
- `docs/contractor/deliveries/AUTH-004-mfa.md` — this report.

No path outside TOUCH plus the report changed. `src/local`, `postgresql`, `archive`, `public`, migrations and manifests are untouched.

## Invariant coverage

| Invariant | Evidence |
| --- | --- |
| Encrypted recoverable TOTP seed | Seed is stored only as `secret_ciphertext` with `aes_256_gcm` and a key version; plaintext never appears in the row or its JSON. A tampered envelope fails closed instead of authenticating. |
| Hash-only atomic single-use recovery | Codes are returned once; rows hold 64-hex HMAC digests with key versions. Two concurrent verifications with the same code yield exactly one 200 and one 401, and a later replay fails. |
| Administrator enrollment-only session until verified | Password login for an MFA-required identity returns `mfa.pending = true` with `assurance_level = single_factor`; `/v1/auth/me`, logout and MFA routes remain available, everything else returns `403 MFA_REQUIRED` until verification upgrades the session. |
| Reauth/factor required for disable/re-enroll | Disable requires password **and** a current TOTP or recovery code; wrong password and wrong code both fail. Disable replaces the seed with a fresh unverified one, clears `verified_at`, and invalidates all outstanding recovery codes. |
| Current role/owner authority drives assurance | Requirement is read from `auth.tenant_membership` joined to active, effective-dated `auth.roles` with `requires_mfa`. Non-admin members log in normally; an unconfigured MFA deployment fails closed with `503 MFA_UNAVAILABLE` for required identities only. |
| No MFA bypass via passkey/social defaults | Only `{code}` or `{recoveryCode}` are accepted; unknown fields, both supplied together, and any other input shape return `400` without upgrading the session. Operator realm keeps its asserted-IdP refusal. |
| Clock window and replay | A code from three steps ago is rejected, the previous step is accepted, and replay of a consumed step returns `MFA_CODE_REPLAYED` even after success. |
| Bounded retries/lockout | Failed codes accumulate and are committed even though the request is refused; reaching the configured limit returns `429 MFA_LOCKED` until the lockout window passes, then a correct code succeeds. |
| Append-only audit, no secrets | `mfa_enrolled`, `mfa_verified`, `mfa_disabled` rows are written; audit text contains no seed, recovery code or password. |
| No client authority / nearest adjacency to AUTH-002 constraints | User identity comes from the verified session/credential record; MFA routes operate on the locked session's `userId`; no tenant/user id is read from the body. |

## Gate evidence

```text
$ node --version
v24.19.0
$ node scripts/check.mjs && node --test tests/auth-004-mfa.test.mjs
PASS: 160 JavaScript files parsed; package manifest valid.
✔ AUTH-004 tenant-admin login is pending until MFA is verified and gates other requests (747.819854ms)
✔ AUTH-004 enrollment stores an encrypted seed and recovery hashes only (846.032487ms)
✔ AUTH-004 login requires a fresh TOTP step and refuses replay (1116.233026ms)
✔ AUTH-004 TOTP clock window rejects stale and future codes (1007.173289ms)
✔ AUTH-004 recovery codes are single-use under concurrency (1192.151722ms)
✔ AUTH-004 invalid codes lock the factor until the window passes (920.837499ms)
✔ AUTH-004 disable requires reauthentication and invalidates old recovery codes (1594.776298ms)
✔ AUTH-004 an unconfigured MFA service fails closed for required identities only (1100.189797ms)
✔ AUTH-004 tampered ciphertext and unknown factor inputs cannot bypass verification (925.997323ms)
✔ AUTH-004 a non-admin identity logs in without MFA and audit holds no secrets (1330.279571ms)
ℹ tests 10
ℹ pass 10
ℹ fail 0
ℹ skipped 0
```

Exit `0`. Regression suites on the same runtime/cluster: AUTH-002 `18/18`, AUTH-003 `27/27`. Combined branch suite: `242` tests, `241` pass, `1` fail — only the pre-existing PIVOT-004 fixture prerequisite, untouched and out of scope. Without the dedicated-cluster opt-in the AUTH-004 file refuses all ten cases (exit 1) before mutation.

Environment: fixture objects and databases removed; post-gate queries returned zero `saven_auth_%` roles and databases; cluster stopped and deleted; `node_modules` symlink removed.

## Questions for engineer

1. **Key composition.** `createMfaService` needs deployment-injected encryption and recovery keys. The retained `createAuthServer` entry point does not forward `mfaConfig` (outside this TOUCH), so its default is "unconfigured → fail closed for required identities". Confirm the narrow `server.mjs` wiring contract, or choose a key-provider interface before activation.
2. **Numeric policy.** Failure limit, lockout window and recovery count are validated bounds with bootstrap defaults; none are approved production values. Confirm which deployment-controlled/versioned surface carries the reviewed policy.
3. **Pending-session semantics.** Login issues a cookie with `assurance_level = single_factor` and a pending flag rather than a separate challenge token. That keeps the established protected cookie transport and lets `/me`, logout and MFA work; business routes will be refused by the pre-MFA gate. Confirm this is the intended challenge shape for AUTH-005/006 integration.
4. **Authority scope.** Until AUTH-006 binds a verified selected membership, the requirement is conservative: any active MFA-required membership marks the identity. Confirm that behaviour for multi-tenant administrators.
5. **Disable representation.** The schema has no `is_active` factor column and runtime DELETE is not granted, so disable replaces the seed with a fresh unverified one and invalidates recovery codes. Confirm that is acceptable, or schedule an additive `disabled_at` column in a migration contract.

## Deviations from contract

- None in scope or TOUCH. Notes: failure counters are committed while the verification request is still refused (the attempt transaction returns the error instead of rolling the counters back); disable is represented by resetting to an unverified enrollment because additive schema change was not authorized.

## EXTENSIBILITY

compliant — factor types, digits/period/window and policy bounds are validated configuration; seeds/recovery use versioned key material; no hardcoded growing business domains; new factors are additive adapters that must satisfy the same assurance gate; operator identity stays delegated; no cross-module concrete coupling beyond the auth boundary.

## GIT

branch=opencode/auth-004-mfa commit=`511b1cd` pushed=yes
