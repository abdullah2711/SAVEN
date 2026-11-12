BEGIN;
CREATE TABLE recurring_schedules(
 company_id text NOT NULL REFERENCES companies(id),id text NOT NULL DEFAULT gen_random_uuid()::text,
 code text NOT NULL CHECK(code ~ '^[A-Z0-9][A-Z0-9_-]{0,19}$'),name text NOT NULL,description text NOT NULL,
 first_date text NOT NULL,every_months integer NOT NULL CHECK(every_months IN(1,3,12)),occurrences integer NOT NULL CHECK(occurrences BETWEEN 1 AND 120),
 lines_json jsonb NOT NULL,enabled boolean NOT NULL DEFAULT true,created_by text NOT NULL REFERENCES users(id),created_at bigint NOT NULL,
 PRIMARY KEY(company_id,id),UNIQUE(company_id,code),CHECK(length(name) BETWEEN 1 AND 160 AND length(description) BETWEEN 1 AND 500));
CREATE TABLE recurring_runs(
 company_id text NOT NULL,schedule_id text NOT NULL,occurrence_no integer NOT NULL CHECK(occurrence_no BETWEEN 0 AND 119),
 attempt integer NOT NULL CHECK(attempt BETWEEN 1 AND 1000),document_id text NOT NULL,active boolean NOT NULL DEFAULT true,
 PRIMARY KEY(company_id,schedule_id,occurrence_no,attempt),UNIQUE(company_id,document_id),
 FOREIGN KEY(company_id,schedule_id) REFERENCES recurring_schedules(company_id,id),FOREIGN KEY(company_id,document_id) REFERENCES documents(company_id,id));
CREATE UNIQUE INDEX recurring_one_active_occurrence ON recurring_runs(company_id,schedule_id,occurrence_no) WHERE active;
DO $$ DECLARE t text; BEGIN FOREACH t IN ARRAY ARRAY['recurring_schedules','recurring_runs'] LOOP
 EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',t);EXECUTE format('CREATE POLICY company_scope ON %I USING(saven_member(company_id))',t);EXECUTE format('GRANT SELECT ON %I TO saven_app',t);
END LOOP; END $$;

CREATE FUNCTION saven_recurring_admin(cid text,action text,p jsonb,expected bigint,k text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE actor text; r text; rev bigint; previous public.configuration_events%ROWTYPE; fingerprint text; result jsonb; sid text; old_data jsonb; deb numeric; cred numeric; last_date date;
BEGIN
 actor:=public.saven_actor();
 SELECT m.role INTO r FROM public.memberships m JOIN public.companies c ON c.id=m.company_id WHERE m.company_id=cid AND m.user_id=actor AND m.active=1 AND c.status='active';
 IF r IS NULL OR r NOT IN('owner','admin') OR k !~ '^[a-zA-Z0-9_-]{16,128}$' OR EXISTS(SELECT 1 FROM public.resource_denials WHERE company_id=cid AND user_id=actor) THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
 SELECT revision INTO rev FROM public.companies WHERE id=cid FOR UPDATE;
 fingerprint:=encode(sha256(convert_to(action||p::text,'UTF8')),'hex');
 SELECT * INTO previous FROM public.configuration_events WHERE company_id=cid AND command_key=k;
 IF FOUND THEN IF previous.actor_id!=actor OR previous.payload_hash!=fingerprint THEN RAISE EXCEPTION 'IDEMPOTENCY_CONFLICT';END IF;RETURN previous.result_json||'{"replayed":true}'::jsonb;END IF;
 IF rev IS DISTINCT FROM expected THEN RAISE EXCEPTION 'STALE_PREVIEW';END IF;
 IF action='create' THEN
  IF coalesce(p->>'code','') !~ '^[A-Z0-9][A-Z0-9_-]{0,19}$' OR coalesce(length(p->>'name'),0) NOT BETWEEN 1 AND 160 OR coalesce(length(p->>'description'),0) NOT BETWEEN 1 AND 500
   OR coalesce(p->>'firstDate','') !~ '^\d{4}-\d{2}-\d{2}$' OR coalesce((p->>'everyMonths')::integer,0) NOT IN(1,3,12) OR coalesce((p->>'occurrences')::integer,0) NOT BETWEEN 1 AND 120
   OR jsonb_typeof(p->'lines') IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'INVALID_SCHEDULE';END IF;
  last_date:=(p->>'firstDate')::date+make_interval(months=>(p->>'everyMonths')::integer*((p->>'occurrences')::integer-1));
  IF last_date>'9999-12-31'::date OR to_char((p->>'firstDate')::date,'YYYY-MM-DD')!=p->>'firstDate' OR jsonb_array_length(p->'lines') NOT BETWEEN 2 AND 40 THEN RAISE EXCEPTION 'INVALID_SCHEDULE';END IF;
  IF EXISTS(SELECT 1 FROM jsonb_array_elements(p->'lines') l LEFT JOIN public.accounts a ON a.company_id=cid AND a.id=l->>'accountId'
   WHERE a.id IS NULL OR NOT a.active OR a.category NOT IN('general','cash_bank') OR coalesce(l->>'debit','') !~ '^\d+\.\d{2}$' OR coalesce(l->>'credit','') !~ '^\d+\.\d{2}$') THEN RAISE EXCEPTION 'INVALID_SCHEDULE';END IF;
  IF EXISTS(SELECT 1 FROM jsonb_array_elements(p->'lines') l WHERE NOT(((l->>'debit')::numeric>0 AND (l->>'credit')::numeric=0) OR((l->>'credit')::numeric>0 AND (l->>'debit')::numeric=0))) THEN RAISE EXCEPTION 'INVALID_SCHEDULE';END IF;
  SELECT sum((l->>'debit')::numeric),sum((l->>'credit')::numeric) INTO deb,cred FROM jsonb_array_elements(p->'lines') l;
  IF deb IS NULL OR deb!=cred OR deb>9999999999.99 THEN RAISE EXCEPTION 'INVALID_SCHEDULE';END IF;
  INSERT INTO public.recurring_schedules(company_id,code,name,description,first_date,every_months,occurrences,lines_json,created_by,created_at)
   VALUES(cid,p->>'code',p->>'name',p->>'description',p->>'firstDate',(p->>'everyMonths')::integer,(p->>'occurrences')::integer,p->'lines',actor,extract(epoch FROM clock_timestamp())::bigint) RETURNING id INTO sid;
 ELSE
  IF action NOT IN('pause','resume') OR coalesce(length(btrim(p->>'reason')),0) NOT BETWEEN 1 AND 500 THEN RAISE EXCEPTION 'INVALID_SCHEDULE';END IF;
  sid:=p->>'id';SELECT to_jsonb(s) INTO old_data FROM public.recurring_schedules s WHERE company_id=cid AND id=sid;
  IF old_data IS NULL THEN RAISE EXCEPTION 'INVALID_SCHEDULE';END IF;
  UPDATE public.recurring_schedules SET enabled=(action='resume') WHERE company_id=cid AND id=sid;
 END IF;
 result:=jsonb_build_object('id',sid,'revision',rev+1);
 INSERT INTO public.configuration_events(company_id,actor_id,entity_type,entity_id,command_key,payload_hash,data_json,result_json,created_at)
  VALUES(cid,actor,'recurring.'||action,sid,k,fingerprint,jsonb_build_object('input',p,'before',old_data),result,extract(epoch FROM clock_timestamp())::bigint);
 UPDATE public.companies SET revision=revision+1 WHERE id=cid;RETURN result;
END $$;
REVOKE ALL ON FUNCTION saven_recurring_admin(text,text,jsonb,bigint,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION saven_recurring_admin(text,text,jsonb,bigint,text) TO saven_app;

CREATE FUNCTION saven_recurring_occurrence() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE r jsonb; s public.recurring_schedules%ROWTYPE; n integer; a integer; next_attempt integer; expected_date text; actor text;
BEGIN
 IF TG_OP='UPDATE' THEN
  IF NEW.status='rejected' AND OLD.status='pending' THEN UPDATE public.recurring_runs SET active=false WHERE company_id=NEW.company_id AND document_id=NEW.id;END IF;RETURN NEW;
 END IF;
 IF NOT(NEW.payload_json::jsonb ? 'recurrence') THEN RETURN NEW;END IF;
 r:=NEW.payload_json::jsonb->'recurrence';actor:=public.saven_actor();
 PERFORM 1 FROM public.companies WHERE id=NEW.company_id FOR UPDATE;
 SELECT * INTO s FROM public.recurring_schedules WHERE company_id=NEW.company_id AND id=r->>'scheduleId';
 n:=(r->>'index')::integer;a:=(r->>'attempt')::integer;
 IF s.id IS NULL OR NOT s.enabled OR n IS NULL OR n<0 OR n>=s.occurrences OR a IS NULL OR NEW.kind!='journal' OR NEW.status!='pending' OR actor IS DISTINCT FROM NEW.prepared_by
  OR EXISTS(SELECT 1 FROM public.resource_denials WHERE company_id=NEW.company_id AND user_id=actor) THEN RAISE EXCEPTION 'SCHEDULE_CHANGED';END IF;
 expected_date:=to_char(s.first_date::date+make_interval(months=>s.every_months*n),'YYYY-MM-DD');
 SELECT coalesce(max(attempt),0)+1 INTO next_attempt FROM public.recurring_runs WHERE company_id=NEW.company_id AND schedule_id=s.id AND occurrence_no=n;
 IF a!=next_attempt OR NEW.date!=expected_date OR NEW.reference!=s.code||'-'||expected_date||'-A'||a OR NEW.description!=s.description OR NEW.payload_json::jsonb->'lines' IS DISTINCT FROM s.lines_json THEN RAISE EXCEPTION 'SCHEDULE_CHANGED';END IF;
 INSERT INTO public.recurring_runs(company_id,schedule_id,occurrence_no,attempt,document_id) VALUES(NEW.company_id,s.id,n,a,NEW.id);
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION saven_recurring_occurrence() FROM PUBLIC;
CREATE TRIGGER recurring_occurrence AFTER INSERT OR UPDATE ON documents FOR EACH ROW EXECUTE FUNCTION saven_recurring_occurrence();
INSERT INTO schema_version(version) VALUES(9);
COMMIT;
