TASK: AUTH-008 ? Verify canonical OIDC-extensible accounts/state schema without building a connector.
TOUCH: tests/auth-008-oidc-schema.test.mjs
FORBIDDEN: All paths outside TOUCH; in particular src/local, postgresql, archive, existing application entry points, production data and credentials.
DONE WHEN: node scripts/check.mjs && node --test tests/auth-008-oidc-schema.test.mjs
INVARIANTS: Unique configured provider/subject-to-user binding; user FK; expiring single-use state/nonce/PKCE readiness; no duplicate identity/membership; no auto-link connector, live credentials, network login or new grants. No direct SQL authority from client ids; tenant/user context from verified server session only; no runtime superuser/BYPASSRLS/table ownership; append-only audit; no new hardcoded growing domains or cross-module concrete coupling; SQLite/reference code, applied migrations and production unchanged.
PATTERN: db/postgres/05-auth-schema.sql; docs/pivot-notes/03-adr-auth.md
NOTES: ADR03 OIDC readiness; owner AUTH-008. Depends AUTH-001 only. This is schema testing, not account-linking implementation. Future verified-email linking requires authoritative issuer allowlist and protected-account reauthentication; client email_verified flags cannot satisfy it.
