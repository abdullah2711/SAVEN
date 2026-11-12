BEGIN;
CREATE TABLE stored_files(
 company_id text NOT NULL REFERENCES companies(id),id text NOT NULL,owner_id text NOT NULL REFERENCES users(id),
 name text NOT NULL CHECK(length(name) BETWEEN 1 AND 180),media_type text NOT NULL,
 sha256 text NOT NULL CHECK(sha256 ~ '^[a-f0-9]{64}$'),byte_size bigint NOT NULL CHECK(byte_size BETWEEN 1 AND 10485760),
 visibility text NOT NULL CHECK(visibility IN('company','personal')),
 scan_state text NOT NULL DEFAULT 'pending' CHECK(scan_state IN('pending','clean','infected','error')),created_at bigint NOT NULL,
 PRIMARY KEY(company_id,id)
);
CREATE TABLE file_events(id text PRIMARY KEY,company_id text NOT NULL,file_id text NOT NULL,actor_id text NOT NULL REFERENCES users(id),action text NOT NULL,reason text NOT NULL DEFAULT '',created_at bigint NOT NULL,FOREIGN KEY(company_id,file_id) REFERENCES stored_files(company_id,id));
CREATE TABLE file_removals(company_id text NOT NULL,file_id text NOT NULL,actor_id text NOT NULL REFERENCES users(id),reason text NOT NULL CHECK(length(reason) BETWEEN 1 AND 500),created_at bigint NOT NULL,PRIMARY KEY(company_id,file_id),FOREIGN KEY(company_id,file_id) REFERENCES stored_files(company_id,id));
CREATE TABLE document_attachments(company_id text NOT NULL,document_id text NOT NULL,file_id text NOT NULL,actor_id text NOT NULL REFERENCES users(id),created_at bigint NOT NULL,PRIMARY KEY(company_id,document_id,file_id),FOREIGN KEY(company_id,document_id) REFERENCES documents(company_id,id),FOREIGN KEY(company_id,file_id) REFERENCES stored_files(company_id,id));
CREATE TABLE attachment_withdrawals(company_id text NOT NULL,document_id text NOT NULL,file_id text NOT NULL,actor_id text NOT NULL REFERENCES users(id),reason text NOT NULL CHECK(length(reason) BETWEEN 1 AND 500),created_at bigint NOT NULL,PRIMARY KEY(company_id,document_id,file_id),FOREIGN KEY(company_id,document_id,file_id) REFERENCES document_attachments(company_id,document_id,file_id));
CREATE TABLE notifications(id text PRIMARY KEY,company_id text NOT NULL REFERENCES companies(id),user_id text NOT NULL REFERENCES users(id),event_type text NOT NULL,record_id text NOT NULL,message text NOT NULL,created_at bigint NOT NULL,read_at bigint);

DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['stored_files','file_events','file_removals','document_attachments','attachment_withdrawals','notifications'] LOOP
  EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY',t);
  EXECUTE format('CREATE POLICY company_scope ON %I USING(public.saven_member(company_id))',t);
 END LOOP;
END $$;
-- Narrow the broad company policy for these two sensitive sets of rows.
DROP POLICY company_scope ON stored_files;
CREATE POLICY file_scope ON stored_files USING(saven_member(company_id) AND (visibility='company' OR owner_id=saven_actor() OR EXISTS(SELECT 1 FROM memberships WHERE company_id=stored_files.company_id AND user_id=saven_actor() AND active=1 AND role IN('owner','admin'))));
ALTER TABLE stored_files NO FORCE ROW LEVEL SECURITY;
DROP POLICY company_scope ON notifications;
CREATE POLICY own_notifications ON notifications USING(saven_member(company_id) AND user_id=saven_actor());
CREATE POLICY create_notifications ON notifications FOR INSERT WITH CHECK(saven_member(company_id));
GRANT SELECT,INSERT ON stored_files,file_events,file_removals,document_attachments,attachment_withdrawals,notifications TO saven_app;
GRANT UPDATE(scan_state) ON stored_files TO saven_app;
GRANT UPDATE(read_at) ON notifications TO saven_app;
CREATE FUNCTION saven_file_control() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE used bigint; personal bigint; actor_role text;
BEGIN
 IF TG_OP='UPDATE' THEN
  IF (to_jsonb(NEW)-'scan_state') IS DISTINCT FROM(to_jsonb(OLD)-'scan_state') OR OLD.scan_state='clean' THEN RAISE EXCEPTION 'FILE_IMMUTABLE'; END IF;
  RETURN NEW;
 END IF;
 SELECT role INTO actor_role FROM memberships WHERE company_id=NEW.company_id AND user_id=saven_actor() AND active=1;
 IF NEW.owner_id IS DISTINCT FROM saven_actor() OR actor_role IS NULL OR actor_role='viewer' OR NEW.scan_state!='pending' THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
 PERFORM 1 FROM companies WHERE id=NEW.company_id FOR UPDATE;
 -- Removed versions still consume retention storage until a separately
 -- authorized retention purge; ordinary deletion never frees promised quota.
 SELECT coalesce(sum(byte_size),0),coalesce(sum(CASE WHEN owner_id=NEW.owner_id AND visibility='personal' THEN byte_size ELSE 0 END),0) INTO used,personal FROM stored_files WHERE company_id=NEW.company_id;
 IF used+NEW.byte_size>1073741824 OR (NEW.visibility='personal' AND personal+NEW.byte_size>268435456) THEN RAISE EXCEPTION 'STORAGE_QUOTA'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER file_control BEFORE INSERT OR UPDATE ON stored_files FOR EACH ROW EXECUTE FUNCTION saven_file_control();
CREATE FUNCTION saven_evidence_control() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE actor_role text;
BEGIN
 SELECT role INTO actor_role FROM memberships WHERE company_id=NEW.company_id AND user_id=saven_actor() AND active=1;
 IF NEW.actor_id IS DISTINCT FROM saven_actor() OR actor_role IS NULL OR actor_role='viewer' THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
 PERFORM 1 FROM companies WHERE id=NEW.company_id FOR UPDATE;
 IF TG_TABLE_NAME='document_attachments' THEN
  IF NOT EXISTS(SELECT 1 FROM stored_files f WHERE f.company_id=NEW.company_id AND f.id=NEW.file_id AND f.visibility='company' AND f.scan_state='clean' AND NOT EXISTS(SELECT 1 FROM file_removals r WHERE r.company_id=f.company_id AND r.file_id=f.id)) THEN RAISE EXCEPTION 'FILE_NOT_READY'; END IF;
 ELSIF TG_TABLE_NAME='file_removals' THEN
  IF EXISTS(SELECT 1 FROM document_attachments WHERE company_id=NEW.company_id AND file_id=NEW.file_id) THEN RAISE EXCEPTION 'EVIDENCE_PROTECTED'; END IF;
  IF actor_role NOT IN('owner','admin') AND NOT EXISTS(SELECT 1 FROM stored_files WHERE company_id=NEW.company_id AND id=NEW.file_id AND owner_id=saven_actor()) THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
 ELSIF actor_role NOT IN('owner','admin') THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER attachment_control BEFORE INSERT ON document_attachments FOR EACH ROW EXECUTE FUNCTION saven_evidence_control();
CREATE TRIGGER removal_control BEFORE INSERT ON file_removals FOR EACH ROW EXECUTE FUNCTION saven_evidence_control();
CREATE TRIGGER withdrawal_control BEFORE INSERT ON attachment_withdrawals FOR EACH ROW EXECUTE FUNCTION saven_evidence_control();
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['file_events','file_removals','document_attachments','attachment_withdrawals'] LOOP
  EXECUTE format('CREATE TRIGGER immutable_update BEFORE UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION saven_immutable(''EVIDENCE_IMMUTABLE'')',t);
  EXECUTE format('CREATE TRIGGER immutable_delete BEFORE DELETE ON %I FOR EACH ROW EXECUTE FUNCTION saven_immutable(''EVIDENCE_IMMUTABLE'')',t);
 END LOOP;
END $$;
CREATE TRIGGER files_no_delete BEFORE DELETE ON stored_files FOR EACH ROW EXECUTE FUNCTION saven_immutable('EVIDENCE_IMMUTABLE');

CREATE TABLE assistant_tasks(
 company_id text NOT NULL REFERENCES companies(id),id text NOT NULL,user_id text NOT NULL REFERENCES users(id),command_key text NOT NULL,payload_hash text NOT NULL,
 request_json jsonb NOT NULL,status text NOT NULL DEFAULT 'queued' CHECK(status IN('queued','running','complete','failed')),
 response_json jsonb,error_code text,model text NOT NULL DEFAULT '',input_tokens bigint NOT NULL DEFAULT 0,output_tokens bigint NOT NULL DEFAULT 0,
 created_at bigint NOT NULL,started_at bigint,finished_at bigint,PRIMARY KEY(company_id,id),UNIQUE(company_id,user_id,command_key)
);
CREATE INDEX assistant_recent ON assistant_tasks(company_id,user_id,created_at DESC);
ALTER TABLE assistant_tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE assistant_tasks FORCE ROW LEVEL SECURITY;
CREATE POLICY own_tasks ON assistant_tasks USING(saven_member(company_id) AND user_id=saven_actor());
GRANT SELECT,INSERT ON assistant_tasks TO saven_app;
GRANT UPDATE(status,response_json,error_code,model,input_tokens,output_tokens,started_at,finished_at) ON assistant_tasks TO saven_app;
CREATE FUNCTION saven_assistant_task_control() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.user_id IS DISTINCT FROM saven_actor() OR NOT saven_member(NEW.company_id) THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
 IF TG_OP='INSERT' THEN
  PERFORM 1 FROM companies WHERE id=NEW.company_id FOR UPDATE;
  IF NEW.status!='queued' OR NEW.response_json IS NOT NULL OR NEW.input_tokens!=0 OR NEW.output_tokens!=0 THEN RAISE EXCEPTION 'INVALID_TASK'; END IF;
  IF (SELECT count(*) FROM assistant_tasks WHERE company_id=NEW.company_id AND user_id=NEW.user_id AND created_at>extract(epoch FROM clock_timestamp())-86400)>=50 THEN RAISE EXCEPTION 'AI_DAILY_LIMIT'; END IF;
  IF EXISTS(SELECT 1 FROM assistant_tasks WHERE company_id=NEW.company_id AND user_id=NEW.user_id AND status IN('queued','running') AND created_at>extract(epoch FROM clock_timestamp())-300) THEN RAISE EXCEPTION 'AI_BUSY'; END IF;
 ELSE
  IF (to_jsonb(NEW)-ARRAY['status','response_json','error_code','model','input_tokens','output_tokens','started_at','finished_at']) IS DISTINCT FROM(to_jsonb(OLD)-ARRAY['status','response_json','error_code','model','input_tokens','output_tokens','started_at','finished_at']) OR NOT((OLD.status='queued' AND NEW.status='running') OR (OLD.status='running' AND NEW.status IN('complete','failed'))) THEN RAISE EXCEPTION 'TASK_IMMUTABLE'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER assistant_task_control BEFORE INSERT OR UPDATE ON assistant_tasks FOR EACH ROW EXECUTE FUNCTION saven_assistant_task_control();
CREATE TRIGGER assistant_no_delete BEFORE DELETE ON assistant_tasks FOR EACH ROW EXECUTE FUNCTION saven_immutable('TASK_IMMUTABLE');
REVOKE ALL ON FUNCTION saven_file_control(),saven_evidence_control(),saven_assistant_task_control() FROM PUBLIC;
INSERT INTO schema_version(version) VALUES(5);
COMMIT;
