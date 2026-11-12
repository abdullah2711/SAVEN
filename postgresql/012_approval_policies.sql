BEGIN;
CREATE TABLE approval_policies(company_id text NOT NULL REFERENCES companies(id),version integer NOT NULL CHECK(version>0),rules_json jsonb NOT NULL,reason text NOT NULL,created_by text NOT NULL REFERENCES users(id),created_at bigint NOT NULL,PRIMARY KEY(company_id,version));
ALTER TABLE approval_policies ENABLE ROW LEVEL SECURITY;
CREATE POLICY company_scope ON approval_policies USING(saven_member(company_id));
GRANT SELECT ON approval_policies TO saven_app;
CREATE TRIGGER immutable_policy BEFORE UPDATE OR DELETE ON approval_policies FOR EACH ROW EXECUTE FUNCTION saven_immutable('POLICY_IMMUTABLE');
ALTER TABLE documents ADD COLUMN approval_json jsonb NOT NULL DEFAULT '{"mode":"independent","policyVersion":0,"requiresEvidence":false}';
ALTER TABLE documents DROP CONSTRAINT documents_check1;
ALTER TABLE documents ADD CONSTRAINT document_review_authority CHECK(reviewed_by IS NULL OR reviewed_by!=prepared_by OR(status='posted' AND approval_json->>'mode'='direct'));
CREATE FUNCTION saven_approval_decision(cid text,doc_kind text,amount bigint,uid text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE r text;p public.approval_policies%ROWTYPE;rule jsonb;mode text:='independent';evidence boolean:=false;
BEGIN
 IF uid IS DISTINCT FROM public.saven_actor() OR NOT public.saven_member(cid) THEN RAISE EXCEPTION 'FORBIDDEN';END IF;
 SELECT role INTO r FROM public.memberships WHERE company_id=cid AND user_id=uid AND active=1;
 SELECT * INTO p FROM public.approval_policies WHERE company_id=cid ORDER BY version DESC LIMIT 1;
 IF doc_kind NOT IN('opening_balance','opening_receivable','opening_payable') THEN
  SELECT v INTO rule FROM jsonb_array_elements(coalesce(p.rules_json,'[]')) v WHERE v->>'role'=r AND v->>'kind' IN(doc_kind,'*') ORDER BY (v->>'kind'=doc_kind) DESC LIMIT 1;
  IF rule IS NOT NULL THEN evidence:=(rule->>'requiresEvidence')::boolean;
   IF NOT (rule->>'canSubmit')::boolean THEN mode:='denied';ELSIF rule->>'maxDirectMinor' IS NOT NULL AND amount<=(rule->>'maxDirectMinor')::bigint THEN mode:='direct';END IF;
  END IF;
 END IF;
 RETURN jsonb_build_object('mode',mode,'policyVersion',coalesce(p.version,0),'requiresEvidence',evidence);
END $$;
REVOKE ALL ON FUNCTION saven_approval_decision(text,text,bigint,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION saven_approval_decision(text,text,bigint,text) TO saven_app;
CREATE FUNCTION saven_publish_approval_policy(cid text,p jsonb,expected bigint,k text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE actor text;rev bigint;v integer;previous public.configuration_events%ROWTYPE;fingerprint text;result jsonb;rule jsonb;
BEGIN
 actor:=public.saven_actor();IF NOT EXISTS(SELECT 1 FROM public.memberships m JOIN public.companies c ON c.id=m.company_id WHERE m.company_id=cid AND m.user_id=actor AND m.role='owner' AND m.active=1 AND c.status='active') OR k !~ '^[a-zA-Z0-9_-]{16,128}$' THEN RAISE EXCEPTION 'FORBIDDEN';END IF;
 SELECT revision INTO rev FROM public.companies WHERE id=cid FOR UPDATE;fingerprint:=encode(sha256(convert_to(p::text,'UTF8')),'hex');
 SELECT * INTO previous FROM public.configuration_events WHERE company_id=cid AND command_key=k;
 IF FOUND THEN IF previous.actor_id!=actor OR previous.payload_hash!=fingerprint THEN RAISE EXCEPTION 'IDEMPOTENCY_CONFLICT';END IF;RETURN previous.result_json||'{"replayed":true}'::jsonb;END IF;
 IF rev IS DISTINCT FROM expected THEN RAISE EXCEPTION 'STALE_PREVIEW';END IF;
 IF jsonb_typeof(p->'rules') IS DISTINCT FROM 'array' OR jsonb_array_length(p->'rules')>39 OR coalesce(length(btrim(p->>'reason')),0) NOT BETWEEN 1 AND 500 THEN RAISE EXCEPTION 'INVALID_POLICY';END IF;
 FOR rule IN SELECT value FROM jsonb_array_elements(p->'rules') LOOP
  IF rule->>'kind' NOT IN('*','invoice','stock_issue','bill','receipt','payment','journal','cash_transfer','cash_expense','cash_income','reversal','credit_note','supplier_credit') OR rule->>'role' NOT IN('owner','admin','preparer') OR jsonb_typeof(rule->'canSubmit') IS DISTINCT FROM 'boolean' OR jsonb_typeof(rule->'requiresEvidence') IS DISTINCT FROM 'boolean' OR (rule->>'maxDirectMinor' IS NOT NULL AND ((rule->>'maxDirectMinor') !~ '^\d{1,12}$' OR (rule->>'maxDirectMinor')::bigint>999999999999)) THEN RAISE EXCEPTION 'INVALID_POLICY';END IF;
 END LOOP;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(p->'rules') r GROUP BY r->>'kind',r->>'role' HAVING count(*)>1) THEN RAISE EXCEPTION 'INVALID_POLICY';END IF;
 SELECT coalesce(max(version),0)+1 INTO v FROM public.approval_policies WHERE company_id=cid;
 INSERT INTO public.approval_policies VALUES(cid,v,p->'rules',p->>'reason',actor,extract(epoch FROM clock_timestamp())::bigint);
 result:=jsonb_build_object('version',v,'revision',rev+1);
 INSERT INTO public.configuration_events(company_id,actor_id,entity_type,entity_id,command_key,payload_hash,data_json,result_json,created_at) VALUES(cid,actor,'approval.policy',v::text,k,fingerprint,p,result,extract(epoch FROM clock_timestamp())::bigint);
 UPDATE public.companies SET revision=revision+1 WHERE id=cid;RETURN result;
END $$;
REVOKE ALL ON FUNCTION saven_publish_approval_policy(text,jsonb,bigint,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION saven_publish_approval_policy(text,jsonb,bigint,text) TO saven_app;
CREATE FUNCTION saven_document_approval_snapshot() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE decision jsonb;
BEGIN
 IF NEW.prepared_by=public.saven_actor() AND NEW.kind NOT IN('opening_receivable','opening_payable') THEN
  IF NEW.status!='pending' OR NEW.reviewed_by IS NOT NULL THEN RAISE EXCEPTION 'DOCUMENT_IMMUTABLE';END IF;
  decision:=public.saven_approval_decision(NEW.company_id,NEW.kind,NEW.amount_minor,NEW.prepared_by);
  IF decision->>'mode'='denied' THEN RAISE EXCEPTION 'FORBIDDEN';END IF;
  IF NEW.preview_json::jsonb->'approval' IS DISTINCT FROM decision THEN RAISE EXCEPTION 'STALE_PREVIEW';END IF;
  NEW.approval_json:=decision;
 END IF;RETURN NEW;
END $$;
CREATE TRIGGER approval_snapshot BEFORE INSERT ON documents FOR EACH ROW EXECUTE FUNCTION saven_document_approval_snapshot();
CREATE OR REPLACE FUNCTION saven_document_review() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE direct boolean;
BEGIN
 direct:=false;IF NEW.status='posted' AND NEW.reviewed_by=OLD.prepared_by AND OLD.approval_json->>'mode'='direct' AND public.saven_actor()=OLD.prepared_by THEN direct:=public.saven_approval_decision(NEW.company_id,NEW.kind,NEW.amount_minor,NEW.prepared_by)=OLD.approval_json;END IF;
 IF OLD.status!='pending' OR(to_jsonb(NEW)-ARRAY['status','reviewed_by','version']) IS DISTINCT FROM(to_jsonb(OLD)-ARRAY['status','reviewed_by','version']) OR NEW.status NOT IN('posted','rejected') OR NEW.reviewed_by IS NULL OR(NEW.reviewed_by=OLD.prepared_by AND NOT direct) OR NEW.version!=OLD.version+1 THEN RAISE EXCEPTION 'DOCUMENT_IMMUTABLE';END IF;
 IF EXISTS(SELECT 1 FROM public.resource_denials d WHERE d.company_id=NEW.company_id AND d.user_id=NEW.reviewed_by AND((d.resource_type='party' AND d.resource_id=NEW.party_id) OR(d.resource_type='item' AND d.resource_id=NEW.item_id) OR(d.resource_type='account' AND d.resource_id IN(SELECT value->>'accountId' FROM jsonb_array_elements(NEW.preview_json::jsonb->'lines'))))) THEN RAISE EXCEPTION 'RESOURCE_DENIED';END IF;
 IF NEW.status='posted' AND (OLD.approval_json->>'requiresEvidence')::boolean AND NOT EXISTS(SELECT 1 FROM public.document_attachments a JOIN public.stored_files f ON f.company_id=a.company_id AND f.id=a.file_id WHERE a.company_id=NEW.company_id AND a.document_id=NEW.id AND f.scan_state='clean' AND NOT EXISTS(SELECT 1 FROM public.attachment_withdrawals w WHERE w.company_id=a.company_id AND w.document_id=a.document_id AND w.file_id=a.file_id)) THEN RAISE EXCEPTION 'EVIDENCE_REQUIRED';END IF;
 IF NEW.kind IN('receipt','payment','credit_note','supplier_credit') AND NOT EXISTS(SELECT 1 FROM public.document_allocations WHERE company_id=NEW.company_id AND settlement_id=NEW.id) THEN RAISE EXCEPTION 'ALLOCATION_REQUIRED';END IF;
 IF NEW.status='posted' AND NOT(NEW.kind='opening_balance' AND NEW.payload_json::jsonb->>'mode'='reconcile') AND NOT EXISTS(SELECT 1 FROM public.journals WHERE company_id=NEW.company_id AND document_id=NEW.id AND status='posted' AND date=NEW.date) THEN RAISE EXCEPTION 'JOURNAL_REQUIRED';END IF;
 RETURN NEW;
END $$;
INSERT INTO schema_version(version) VALUES(10);
COMMIT;
