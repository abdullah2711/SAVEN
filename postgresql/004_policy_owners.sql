BEGIN;
-- Permit the non-runtime migration/function owner to derive scope without
-- requiring a cloud provider's superuser/BYPASSRLS attribute. Runtime still
-- owns no table/function and every runtime access remains subject to RLS.
ALTER TABLE users NO FORCE ROW LEVEL SECURITY;
ALTER TABLE login_grants NO FORCE ROW LEVEL SECURITY;
ALTER TABLE sessions NO FORCE ROW LEVEL SECURITY;
ALTER TABLE companies NO FORCE ROW LEVEL SECURITY;
ALTER TABLE memberships NO FORCE ROW LEVEL SECURITY;
INSERT INTO schema_version(version) VALUES(2);
COMMIT;
