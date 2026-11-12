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
DO $$ BEGIN IF to_regclass('public.document_allocations') IS NOT NULL THEN EXECUTE 'GRANT INSERT ON public.document_allocations TO saven_app'; END IF; END $$;
REVOKE ALL ON FUNCTION saven_immutable(),saven_operation_authority(),saven_document_insert(),saven_document_review(),saven_journal_control(),saven_line_insert() FROM PUBLIC;
-- Reapply after a --no-acl restore. Include later identity/configuration
-- helpers without granting their execution to other database roles.
DO $$ DECLARE signature text; BEGIN
 FOR signature IN SELECT p.oid::regprocedure::text FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname LIKE 'saven_%' AND p.prosecdef LOOP
   EXECUTE 'REVOKE ALL ON FUNCTION '||signature||' FROM PUBLIC';
   EXECUTE 'GRANT EXECUTE ON FUNCTION '||signature||' TO saven_app';
 END LOOP;
END $$;
COMMIT;
