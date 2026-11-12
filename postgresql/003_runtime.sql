-- Run after creating the isolated runtime LOGIN role saven_app. The production
-- role and database are separate; do not reuse server or PostgreSQL root access.
BEGIN;
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
DO $$ BEGIN EXECUTE format('GRANT CONNECT ON DATABASE %I TO saven_app',current_database()); END $$;
GRANT USAGE ON SCHEMA public TO saven_app;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO saven_app;
GRANT INSERT,UPDATE,DELETE ON login_grants,sessions TO saven_app;
GRANT INSERT ON operations,documents,journals,journal_lines,audit_events,outbox TO saven_app;
GRANT UPDATE(revision) ON companies TO saven_app;
GRANT UPDATE(reserved,on_hand) ON items TO saven_app;
GRANT UPDATE(status,reviewed_by,version) ON documents TO saven_app;
GRANT UPDATE(status) ON journals TO saven_app;
REVOKE ALL ON FUNCTION saven_immutable(),saven_operation_authority(),saven_document_insert(),saven_document_review(),saven_journal_control(),saven_line_insert() FROM PUBLIC;
COMMIT;
