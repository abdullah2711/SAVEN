BEGIN;
CREATE FUNCTION saven_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION '%',TG_ARGV[0]; END; $$;
CREATE TRIGGER owner_not_removed BEFORE DELETE ON memberships FOR EACH ROW WHEN(OLD.role='owner') EXECUTE FUNCTION saven_immutable('OWNER_PROTECTED');
CREATE TRIGGER owner_not_demoted BEFORE UPDATE ON memberships FOR EACH ROW WHEN(OLD.role='owner') EXECUTE FUNCTION saven_immutable('OWNER_PROTECTED');
CREATE FUNCTION saven_operation_authority() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE company_revision bigint;
BEGIN
  IF NOT EXISTS(SELECT 1 FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=NEW.session_hash AND s.user_id=NEW.actor_id AND u.active=1 AND s.expires_at>extract(epoch FROM clock_timestamp())) THEN RAISE EXCEPTION 'SESSION_EXPIRED'; END IF;
  -- The row lock serializes competing previews and stock commands in a company.
  SELECT revision INTO company_revision FROM companies WHERE id=NEW.company_id FOR UPDATE;
  IF NOT EXISTS(SELECT 1 FROM companies c JOIN memberships m ON m.company_id=c.id WHERE c.id=NEW.company_id AND c.status='active' AND m.user_id=NEW.actor_id AND
    ((NEW.kind='submit' AND m.role IN('owner','admin','preparer')) OR (NEW.kind IN('approve','reject') AND m.role IN('owner','admin','approver')) OR (NEW.kind='configure' AND m.role IN('owner','admin')))) THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
  IF company_revision IS DISTINCT FROM NEW.expected_revision THEN RAISE EXCEPTION 'STALE_PREVIEW'; END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER operation_authority BEFORE INSERT ON operations FOR EACH ROW EXECUTE FUNCTION saven_operation_authority();
CREATE FUNCTION saven_document_insert() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS(SELECT 1 FROM periods WHERE company_id=NEW.company_id AND NEW.date BETWEEN start_date AND end_date AND locked=0) THEN RAISE EXCEPTION 'PERIOD_LOCKED'; END IF;
  IF EXISTS(SELECT 1 FROM resource_denials d WHERE d.company_id=NEW.company_id AND d.user_id=NEW.prepared_by AND
    ((d.resource_type='party' AND d.resource_id=NEW.party_id) OR (d.resource_type='item' AND d.resource_id=NEW.item_id) OR
     (d.resource_type='account' AND d.resource_id IN(SELECT value->>'accountId' FROM jsonb_array_elements(NEW.preview_json::jsonb->'lines'))))) THEN RAISE EXCEPTION 'RESOURCE_DENIED'; END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER document_insert BEFORE INSERT ON documents FOR EACH ROW EXECUTE FUNCTION saven_document_insert();
CREATE FUNCTION saven_document_review() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status!='pending' OR (to_jsonb(NEW)-ARRAY['status','reviewed_by','version']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['status','reviewed_by','version']) OR
    NEW.status NOT IN('posted','rejected') OR NEW.reviewed_by IS NULL OR NEW.reviewed_by=OLD.prepared_by OR NEW.version!=OLD.version+1 THEN RAISE EXCEPTION 'DOCUMENT_IMMUTABLE'; END IF;
  IF EXISTS(SELECT 1 FROM resource_denials d WHERE d.company_id=NEW.company_id AND d.user_id=NEW.reviewed_by AND
    ((d.resource_type='party' AND d.resource_id=NEW.party_id) OR (d.resource_type='item' AND d.resource_id=NEW.item_id) OR
     (d.resource_type='account' AND d.resource_id IN(SELECT value->>'accountId' FROM jsonb_array_elements(NEW.preview_json::jsonb->'lines'))))) THEN RAISE EXCEPTION 'RESOURCE_DENIED'; END IF;
  IF NEW.status='posted' AND NOT EXISTS(SELECT 1 FROM journals WHERE company_id=NEW.company_id AND document_id=NEW.id AND status='posted' AND date=NEW.date) THEN RAISE EXCEPTION 'JOURNAL_REQUIRED'; END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER document_review BEFORE UPDATE ON documents FOR EACH ROW EXECUTE FUNCTION saven_document_review();
CREATE TRIGGER document_no_delete BEFORE DELETE ON documents FOR EACH ROW EXECUTE FUNCTION saven_immutable('DOCUMENT_IMMUTABLE');
CREATE FUNCTION saven_journal_control() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='INSERT' THEN
    IF NEW.status!='building' THEN RAISE EXCEPTION 'JOURNAL_BUILD_REQUIRED'; END IF;
    RETURN NEW;
  END IF;
  IF OLD.status='posted' OR (to_jsonb(NEW)-'status') IS DISTINCT FROM (to_jsonb(OLD)-'status') THEN RAISE EXCEPTION 'JOURNAL_IMMUTABLE'; END IF;
  IF NEW.status='posted' THEN
    IF (SELECT count(*) FROM journal_lines WHERE company_id=NEW.company_id AND journal_id=NEW.id)<2 OR
      (SELECT coalesce(sum(debit_minor-credit_minor),1) FROM journal_lines WHERE company_id=NEW.company_id AND journal_id=NEW.id)!=0 THEN RAISE EXCEPTION 'UNBALANCED_JOURNAL'; END IF;
    IF NOT EXISTS(SELECT 1 FROM periods WHERE company_id=NEW.company_id AND NEW.date BETWEEN start_date AND end_date AND locked=0) THEN RAISE EXCEPTION 'PERIOD_LOCKED'; END IF;
  END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER journal_control BEFORE INSERT OR UPDATE ON journals FOR EACH ROW EXECUTE FUNCTION saven_journal_control();
CREATE TRIGGER journal_no_delete BEFORE DELETE ON journals FOR EACH ROW EXECUTE FUNCTION saven_immutable('JOURNAL_IMMUTABLE');
CREATE FUNCTION saven_line_insert() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM 1 FROM journals WHERE company_id=NEW.company_id AND id=NEW.journal_id AND status='building' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'JOURNAL_IMMUTABLE'; END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER line_insert BEFORE INSERT ON journal_lines FOR EACH ROW EXECUTE FUNCTION saven_line_insert();
CREATE TRIGGER lines_no_update BEFORE UPDATE ON journal_lines FOR EACH ROW EXECUTE FUNCTION saven_immutable('JOURNAL_IMMUTABLE');
CREATE TRIGGER lines_no_delete BEFORE DELETE ON journal_lines FOR EACH ROW EXECUTE FUNCTION saven_immutable('JOURNAL_IMMUTABLE');
CREATE TRIGGER audit_no_update BEFORE UPDATE ON audit_events FOR EACH ROW EXECUTE FUNCTION saven_immutable('AUDIT_IMMUTABLE');
CREATE TRIGGER audit_no_delete BEFORE DELETE ON audit_events FOR EACH ROW EXECUTE FUNCTION saven_immutable('AUDIT_IMMUTABLE');

-- Scope helpers are owned by the migration role, never by the runtime role.
-- They return identity/booleans only, use a fixed search_path and no dynamic SQL.
CREATE FUNCTION saven_actor() RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 SELECT s.user_id FROM public.sessions s JOIN public.users u ON u.id=s.user_id WHERE s.token_hash=current_setting('saven.session_hash',true) AND s.expires_at>extract(epoch FROM statement_timestamp()) AND u.active=1
$$;
CREATE FUNCTION saven_grant_actor() RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 SELECT g.user_id FROM public.login_grants g JOIN public.users u ON u.id=g.user_id WHERE g.token_hash=current_setting('saven.grant_hash',true) AND g.expires_at>extract(epoch FROM statement_timestamp()) AND u.active=1
$$;
CREATE FUNCTION saven_member(cid text) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 SELECT EXISTS(SELECT 1 FROM public.memberships m JOIN public.companies c ON c.id=m.company_id WHERE m.company_id=cid AND m.user_id=public.saven_actor() AND c.status='active')
$$;
CREATE FUNCTION saven_visible_user(uid text) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 SELECT uid=public.saven_actor() OR uid=public.saven_grant_actor() OR EXISTS(SELECT 1 FROM public.memberships a JOIN public.memberships b ON b.company_id=a.company_id WHERE a.user_id=public.saven_actor() AND b.user_id=uid)
$$;
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
-- Identity/control tables keep owner bypass for the narrowly scoped SECURITY
-- DEFINER helpers. The runtime owns none of them and cannot alter any policy.
CREATE POLICY user_scope ON users USING(saven_visible_user(id));
ALTER TABLE login_grants ENABLE ROW LEVEL SECURITY;
CREATE POLICY grant_scope ON login_grants USING(token_hash=current_setting('saven.grant_hash',true));
ALTER TABLE sessions ENABLE ROW LEVEL SECURITY;
CREATE POLICY session_scope ON sessions USING(token_hash=current_setting('saven.session_hash',true) OR user_id=saven_grant_actor());
ALTER TABLE companies ENABLE ROW LEVEL SECURITY;
CREATE POLICY company_scope ON companies USING(saven_member(id));
DO $$ DECLARE table_name text; BEGIN
  FOREACH table_name IN ARRAY ARRAY['memberships','accounts','parties','periods','items','resource_denials','operations','documents','journals','journal_lines','audit_events','outbox'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',table_name);
    IF table_name!='memberships' THEN EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY',table_name); END IF;
    EXECUTE format('CREATE POLICY company_scope ON %I USING(public.saven_member(company_id))',table_name);
  END LOOP;
END $$;
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
COMMIT;
