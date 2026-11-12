BEGIN;
CREATE FUNCTION saven_condition_matches(c jsonb,context jsonb) RETURNS boolean LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE actual jsonb:=coalesce(context->(c->>'field'),'[]');wanted jsonb:=c->'value';op text:=c->>'operator';same boolean;
BEGIN
 SELECT EXISTS(SELECT 1 FROM jsonb_array_elements_text(actual) a JOIN jsonb_array_elements_text(wanted) b ON a=b) INTO same;
 IF op IN('eq','in') THEN RETURN same;ELSIF op IN('ne','not_in') THEN RETURN NOT same;
 ELSIF op='contains' THEN RETURN EXISTS(SELECT 1 FROM jsonb_array_elements_text(actual) a WHERE strpos(lower(a),lower(wanted->>0))>0);
 ELSIF op IN('ge','le') THEN
  IF c->>'field'='amount' THEN RETURN CASE op WHEN 'ge' THEN (actual->>0)::numeric>=(wanted->>0)::numeric ELSE (actual->>0)::numeric<=(wanted->>0)::numeric END;
  ELSE RETURN CASE op WHEN 'ge' THEN actual->>0>=wanted->>0 ELSE actual->>0<=wanted->>0 END;END IF;
 END IF;RETURN false;
END $$;
REVOKE ALL ON FUNCTION saven_condition_matches(jsonb,jsonb) FROM PUBLIC;
CREATE FUNCTION saven_validate_conditions(conditions jsonb) RETURNS void LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE c jsonb;v text;
BEGIN
 IF jsonb_typeof(conditions) IS DISTINCT FROM 'array' OR jsonb_array_length(conditions)>12 THEN RAISE EXCEPTION 'INVALID_CONDITIONS';END IF;
 FOR c IN SELECT value FROM jsonb_array_elements(conditions) LOOP
  IF coalesce(c->>'field','') NOT IN('preparer','party','party_type','account','cash_account','item','store','date','method','direction','reference','description','amount') OR coalesce(c->>'operator','') NOT IN('eq','ne','in','not_in','ge','le','contains') OR jsonb_typeof(c->'value') IS DISTINCT FROM 'array' OR jsonb_array_length(c->'value') NOT BETWEEN 1 AND 50 OR(c->>'operator' NOT IN('in','not_in') AND jsonb_array_length(c->'value')!=1) THEN RAISE EXCEPTION 'INVALID_CONDITIONS';END IF;
  IF(c->>'operator' IN('ge','le') AND c->>'field' NOT IN('amount','date')) OR(c->>'operator'='contains' AND c->>'field' NOT IN('reference','description')) THEN RAISE EXCEPTION 'INVALID_CONDITIONS';END IF;
  FOR v IN SELECT value FROM jsonb_array_elements_text(c->'value') LOOP
   IF length(v) NOT BETWEEN 1 AND 160 OR(c->>'field'='amount' AND (v!~ '^\d{1,12}$' OR v::numeric>999999999999)) THEN RAISE EXCEPTION 'INVALID_CONDITIONS';END IF;
   IF c->>'field'='date' AND to_char(v::date,'YYYY-MM-DD')!=v THEN RAISE EXCEPTION 'INVALID_CONDITIONS';END IF;
  END LOOP;
 END LOOP;
END $$;
REVOKE ALL ON FUNCTION saven_validate_conditions(jsonb) FROM PUBLIC;
CREATE FUNCTION saven_approval_context(cid text,p jsonb,uid text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE r text;policy public.approval_policies%ROWTYPE;candidate record;rule jsonb;d jsonb:=p->'document';context jsonb;matched boolean;mode text:='independent';evidence boolean:=false;party_kind text;store_name text;
BEGIN
 IF uid IS DISTINCT FROM public.saven_actor() OR NOT public.saven_member(cid) THEN RAISE EXCEPTION 'FORBIDDEN';END IF;
 SELECT role INTO r FROM public.memberships WHERE company_id=cid AND user_id=uid AND active=1;
 SELECT * INTO policy FROM public.approval_policies WHERE company_id=cid ORDER BY version DESC LIMIT 1;
 SELECT kind INTO party_kind FROM public.parties WHERE company_id=cid AND id=d->>'partyId';SELECT store INTO store_name FROM public.items WHERE company_id=cid AND id=d->>'itemId';
 context:=jsonb_build_object('preparer',jsonb_build_array(uid),'party',jsonb_build_array(coalesce(d->>'partyId','')),'party_type',jsonb_build_array(coalesce(d->>'partyType',party_kind,'')),'account',(SELECT coalesce(jsonb_agg(l->>'accountId'),'[]') FROM jsonb_array_elements(p->'lines') l),'cash_account',jsonb_build_array(coalesce(d->>'cashAccountId',''),coalesce(d->>'fromAccountId',''),coalesce(d->>'toAccountId','')),'item',jsonb_build_array(coalesce(d->>'itemId','')),'store',jsonb_build_array(coalesce(store_name,'')),'date',jsonb_build_array(d->>'date'),'method',jsonb_build_array(coalesce(d->>'method','')),'direction',jsonb_build_array(coalesce(d->>'direction','')),'reference',jsonb_build_array(d->>'reference'),'description',jsonb_build_array(d->>'description'),'amount',jsonb_build_array(p->>'amountMinor'));
 IF d->>'kind' NOT IN('opening_balance','opening_receivable','opening_payable') THEN
  IF policy.version IS NULL AND r IN('owner','admin') THEN mode:='direct';END IF;
  FOR candidate IN SELECT v,n FROM jsonb_array_elements(coalesce(policy.rules_json,'[]')) WITH ORDINALITY a(v,n) WHERE v->>'role'=r AND v->>'kind' IN(d->>'kind','*') ORDER BY coalesce((v->>'priority')::integer,0) DESC,(v->>'kind'=d->>'kind') DESC,n LOOP
   SELECT CASE WHEN coalesce(candidate.v->>'match','all')='any' THEN coalesce(bool_or(public.saven_condition_matches(c,context)),true) ELSE coalesce(bool_and(public.saven_condition_matches(c,context)),true) END INTO matched FROM jsonb_array_elements(coalesce(candidate.v->'conditions','[]')) c;
   IF matched THEN rule:=candidate.v;EXIT;END IF;
  END LOOP;
  IF rule IS NOT NULL THEN evidence:=(rule->>'requiresEvidence')::boolean;IF NOT (rule->>'canSubmit')::boolean THEN mode:='denied';ELSIF rule->>'maxDirectMinor' IS NOT NULL AND (p->>'amountMinor')::bigint<=(rule->>'maxDirectMinor')::bigint THEN mode:='direct';END IF;END IF;
 END IF;
 RETURN jsonb_build_object('mode',mode,'policyVersion',coalesce(policy.version,0),'requiresEvidence',evidence,'ruleName',coalesce(rule->>'name',''),'rulePriority',coalesce((rule->>'priority')::integer,0));
END $$;
REVOKE ALL ON FUNCTION saven_approval_context(text,jsonb,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION saven_approval_context(text,jsonb,text) TO saven_app;
CREATE OR REPLACE FUNCTION saven_document_approval_snapshot() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE decision jsonb;
BEGIN
 IF NEW.prepared_by=public.saven_actor() AND NEW.kind NOT IN('opening_receivable','opening_payable') THEN
  IF NEW.status!='pending' OR NEW.reviewed_by IS NOT NULL THEN RAISE EXCEPTION 'DOCUMENT_IMMUTABLE';END IF;
  decision:=public.saven_approval_context(NEW.company_id,jsonb_build_object('document',NEW.payload_json::jsonb,'lines',NEW.preview_json::jsonb->'lines','amountMinor',NEW.amount_minor),NEW.prepared_by);
  IF decision->>'mode'='denied' THEN RAISE EXCEPTION 'FORBIDDEN';END IF;IF NEW.preview_json::jsonb->'approval' IS DISTINCT FROM decision THEN RAISE EXCEPTION 'STALE_PREVIEW';END IF;NEW.approval_json:=decision;
 END IF;RETURN NEW;
END $$;
DO $$ DECLARE definition text; BEGIN
 definition:=pg_get_functiondef('public.saven_document_review()'::regprocedure);
 IF position('public.saven_approval_decision(NEW.company_id,NEW.kind,NEW.amount_minor,NEW.prepared_by)' IN definition)=0 THEN RAISE EXCEPTION 'POLICY_MIGRATION_MISMATCH';END IF;
 EXECUTE replace(definition,'public.saven_approval_decision(NEW.company_id,NEW.kind,NEW.amount_minor,NEW.prepared_by)','public.saven_approval_context(NEW.company_id,jsonb_build_object(''document'',NEW.payload_json::jsonb,''lines'',NEW.preview_json::jsonb->''lines'',''amountMinor'',NEW.amount_minor),NEW.prepared_by)');
 definition:=pg_get_functiondef('public.saven_publish_approval_policy(text,jsonb,bigint,text)'::regprocedure);
 definition:=replace(definition,'SELECT revision INTO rev FROM public.companies','IF EXISTS(SELECT 1 FROM public.resource_denials WHERE company_id=cid AND user_id=actor) THEN RAISE EXCEPTION ''FORBIDDEN'';END IF; SELECT revision INTO rev FROM public.companies');
 definition:=replace(definition,'END LOOP;','IF rule ? ''conditions'' THEN PERFORM public.saven_validate_conditions(rule->''conditions'');END IF; IF coalesce(rule->>''match'',''all'') NOT IN(''all'',''any'') OR coalesce((rule->>''priority'')::integer,0) NOT BETWEEN -1000 AND 1000 THEN RAISE EXCEPTION ''INVALID_CONDITIONS'';END IF; END LOOP;');
 definition:=replace(definition,'GROUP BY r->>''kind'',r->>''role''','GROUP BY r->>''kind'',r->>''role'',coalesce(r->''conditions'',''[]''),coalesce(r->>''match'',''all'')');EXECUTE definition;
END $$;
INSERT INTO schema_version(version) VALUES(12);
COMMIT;
