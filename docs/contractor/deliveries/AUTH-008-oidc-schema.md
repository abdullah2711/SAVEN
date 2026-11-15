CONTRACT: docs/contractor/contracts/AUTH-008-oidc-readiness.md
STATUS: DONE — schema-only verification of the canonical OIDC-extensible account/state model. No connector, credential, network call, identity authority or grant was added.

## Identity

- Branch: `opencode/auth-008-oidc`, base `testing-1` at `d0a50cd8405724ab21a2fe2306b2803f01938569`.
- Commit: `8a36696` (single-file TOUCH), plus this report commit.
- Worktree: `/home/esc/saven/wt-auth-008`.
- Node `v24.19.0`; disposable PostgreSQL 18.6 cluster on loopback `127.0.0.1:55440` (stopped and deleted after the gate).

## Files changed

- `tests/auth-008-oidc-schema.test.mjs` — six schema-only tests: static SQL contract, live catalog/privilege checks, provider/subject binding behaviour, encrypted token storage, OAuth state/nonce/PKCE lifecycle, and absence of connector/auto-link substrate.

This is the only implementation path touched. No SQL, JSON seed, source module, package manifest, migration or README changed; the pinned library remains unimported.

## What is verified

| Invariant | Evidence |
| --- | --- |
| Unique configured provider/subject binding | Static: `UNIQUE (provider_id, account_id)` and a `user_id` FK to `auth.users`. Live: a second row for the same `(provider, subject)` is rejected even for a different user; the same subject under a different provider is allowed; an account for a non-existent user is rejected by the FK. |
| User foreign key | `accounts_user_id_fkey REFERENCES auth.users(id) ON DELETE RESTRICT` asserted from `pg_constraint`; `account_id`/`provider_id` remain text so provider subjects are never coerced into UUIDs. |
| Expiring single-use state/nonce/PKCE readiness | `state_hash` unique and digest-only; `nonce_hash` optional; conditional `UPDATE … WHERE consumed_at IS NULL AND expires_at > now()` consumes exactly once and a second consume returns zero rows; an expired state is not consumable; `expires_at > created_at` is enforced; `nonce`/`state`/`code_verifier` plaintext columns do not exist. |
| PKCE key binding | The AUTH-001-R1 named constraint `oauth_state_pkce_key_binding_chk` exists, is validated, and its definition requires `code_verifier_key_version IS NOT NULL`; a ciphertext without a key version and a zero key version are both rejected live. |
| No duplicate identity/membership authority | Runtime catalog shows exactly `auth.users` and `auth.tenant_membership` as registries; no `user_identity` table is created by any statement and no operator object is created, referenced or granted. |
| No new grants | Only `saven_auth_service`, `saven_auth_definer` and the offline `saven_migrator` (schema-level only) receive grants; no `GRANT ALL`/`DELETE`/`TRUNCATE`; customer/operator roles gain nothing; live `has_table_privilege` confirms the auth service has `SELECT/INSERT/UPDATE` but no `DELETE`/`TRUNCATE` on `accounts`/`oauth_state`, while customer and operator roles have no read access. |
| No connector/live credentials/network login | No `client_secret`, `client_id`, `discovery_url`, `issuer_url`, `jwks_uri`, `auto_link`, `link_status`, `trusted_provider`, `email_verified_claim` or `provider_email_verified` column exists; no table or view named for a provider/connector/OIDC/SSO object; provider tokens exist only as `*_ciphertext` with `token_key_version` (enforced live); no provider endpoint or key material appears in SQL. |
| Client claims cannot establish verification | The only email verification authority is `auth.users.email_verified`; the user table has no claim/client/request/trusted provenance column beside it, so a provider or request flag has nowhere to be stored as authority. Linking is explicit and nullable (`oauth_state.link_user_id`), never automatic. |
| Reference-data readiness, not activation | `account_provider` is exactly `credential`/`generic_oauth`, the latter described as reserved readiness with no connector built or enabled; `oauth_state_purpose` is exactly `login`/`link`. |

## Gate evidence

```text
$ node --version
v24.19.0
$ node scripts/check.mjs && node --test tests/auth-008-oidc-schema.test.mjs
PASS: 150 JavaScript files parsed; package manifest valid.
✔ AUTH-008 schema text declares OIDC readiness without a connector or new grants (8.956613ms)
✔ AUTH-008 catalog keeps the configured provider/subject binding unique and user-scoped (292.207896ms)
✔ AUTH-008 provider/subject binding rejects duplicates and unknown users (244.79821ms)
✔ AUTH-008 provider tokens stay ciphertext-only with a bound key version (245.792225ms)
✔ AUTH-008 OAuth state, nonce and PKCE readiness is expiring and single-use (264.782698ms)
✔ AUTH-008 no connector, auto-link or client-claimed verification substrate exists (267.321082ms)
ℹ tests 6
ℹ pass 6
ℹ fail 0
ℹ skipped 0
```

Exit status `0`. Full suite on the same runtime and cluster: `175` tests, `175` pass, `0` fail, `0` skipped. Without the dedicated-cluster opt-in: exit `1`, one database-independent pass (the static SQL contract) and five refusals before mutation.

Environment: `SAVEN_AUTH_TEST_CLUSTER=1`, loopback-only administrative test role, disposable database created and dropped by the AUTH-001 fixture; post-gate queries reported no `saven_auth_%` roles and no `saven_auth_%` databases; the cluster was then stopped and its data directory deleted.

## Questions for engineer

1. **Reference-value enforcement.** `provider_id`/`purpose` are annotated reference domains but are not FK- or trigger-enforced against `auth.reference_value`, matching the accepted AUTH-001 convention ("declared, not enforced"). If provider identifiers must be rejected at write time, that needs an explicit constraint decision (and would also constrain future providers added by reference rows).
2. **Scope of "no auto-link".** The test proves there is no automatic linking substrate: linking is an explicit nullable `link_user_id` on the state row and `auth.accounts` stores only the binding. Verified-email linking policy (authoritative issuer allowlist, protected-account reauthentication) is future work and deliberately untested here.
3. **AUTH-002 interaction.** AUTH-002 does not read `auth.accounts`; OIDC sessions will be created by the future connector through the same session store with `assurance_level` from the validated assertion. Confirm no AUTH-002 change is expected for that.

## Deviations from contract

None. The single-file TOUCH was respected exactly; no schema correction was required, so this contract added no SQL or seed rows.

## EXTENSIBILITY

compliant — readiness is expressed through reference rows (`account_provider`, `oauth_state_purpose`) and additive columns, not flow-specific hardcoding; providers can be added as reference rows plus a connector contract without rewriting this schema; no new coupling, no new grant and no irreversible decision was introduced.

## GIT

branch=opencode/auth-008-oidc commit=`8a36696` pushed=yes
