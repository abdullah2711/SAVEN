BEGIN;
DO $$ DECLARE definition text; BEGIN
 definition:=pg_get_functiondef('public.saven_publish_approval_policy(text,jsonb,bigint,text)'::regprocedure);
 IF position('NOT IN(''*'',''invoice''' IN definition)=0 THEN RAISE EXCEPTION 'POLICY_MIGRATION_MISMATCH';END IF;
 EXECUTE replace(definition,'NOT IN(''*'',''invoice''','NOT IN(''*'',''payment_entry'',''payment_allocation'',''invoice''');
END $$;
CREATE OR REPLACE FUNCTION saven_approval_decision(cid text,doc_kind text,amount bigint,uid text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE r text;p public.approval_policies%ROWTYPE;rule jsonb;mode text:='independent';evidence boolean:=false;
BEGIN
 IF uid IS DISTINCT FROM public.saven_actor() OR NOT public.saven_member(cid) THEN RAISE EXCEPTION 'FORBIDDEN';END IF;
 SELECT role INTO r FROM public.memberships WHERE company_id=cid AND user_id=uid AND active=1;
 SELECT * INTO p FROM public.approval_policies WHERE company_id=cid ORDER BY version DESC LIMIT 1;
 IF doc_kind NOT IN('opening_balance','opening_receivable','opening_payable') THEN
  SELECT v INTO rule FROM jsonb_array_elements(coalesce(p.rules_json,'[]')) v WHERE v->>'role'=r AND v->>'kind' IN(doc_kind,'*') ORDER BY (v->>'kind'=doc_kind) DESC LIMIT 1;
  IF p.version IS NULL AND r IN('owner','admin') THEN mode:='direct';END IF;
  IF rule IS NOT NULL THEN evidence:=(rule->>'requiresEvidence')::boolean;
   IF NOT (rule->>'canSubmit')::boolean THEN mode:='denied';ELSIF rule->>'maxDirectMinor' IS NOT NULL AND amount<=(rule->>'maxDirectMinor')::bigint THEN mode:='direct';END IF;
  END IF;
 END IF;
 RETURN jsonb_build_object('mode',mode,'policyVersion',coalesce(p.version,0),'requiresEvidence',evidence);
END $$;
ALTER TABLE parties DROP CONSTRAINT parties_kind_check;
ALTER TABLE parties ADD CONSTRAINT parties_kind_check CHECK(kind IN('customer','supplier','both','other'));
ALTER TABLE documents DROP CONSTRAINT supported_document_kind;
ALTER TABLE documents DROP CONSTRAINT document_subject;
ALTER TABLE documents ADD CONSTRAINT supported_document_kind CHECK(kind IN('invoice','stock_issue','bill','receipt','payment','journal','cash_transfer','cash_expense','cash_income','reversal','credit_note','supplier_credit','opening_balance','opening_receivable','opening_payable','payment_entry','payment_allocation'));
ALTER TABLE documents ADD CONSTRAINT document_subject CHECK((kind IN('invoice','bill','receipt','payment','credit_note','supplier_credit','opening_receivable','opening_payable','payment_entry','payment_allocation') AND party_id IS NOT NULL AND item_id IS NULL AND quantity IS NULL) OR(kind='stock_issue' AND item_id IS NOT NULL AND party_id IS NULL AND quantity>0) OR(kind IN('journal','cash_transfer','cash_expense','cash_income','reversal','opening_balance') AND party_id IS NULL AND item_id IS NULL AND quantity IS NULL));
ALTER TABLE document_allocations DROP CONSTRAINT document_allocations_pkey;
ALTER TABLE document_allocations ADD PRIMARY KEY(company_id,settlement_id,target_id);
CREATE TABLE payment_sources(company_id text NOT NULL,consumer_id text NOT NULL,source_id text NOT NULL,amount_minor bigint NOT NULL CHECK(amount_minor BETWEEN 1 AND 999999999999),PRIMARY KEY(company_id,consumer_id,source_id),FOREIGN KEY(company_id,consumer_id) REFERENCES documents(company_id,id),FOREIGN KEY(company_id,source_id) REFERENCES documents(company_id,id),CHECK(consumer_id!=source_id));
ALTER TABLE payment_sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE payment_sources FORCE ROW LEVEL SECURITY;
CREATE POLICY company_scope ON payment_sources USING(saven_member(company_id));
GRANT SELECT,INSERT ON payment_sources TO saven_app;
CREATE TRIGGER immutable_payment_sources BEFORE UPDATE OR DELETE ON payment_sources FOR EACH ROW EXECUTE FUNCTION saven_immutable('ALLOCATION_IMMUTABLE');
CREATE INDEX payment_sources_source ON payment_sources(company_id,source_id);
CREATE FUNCTION saven_payment_accounts() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
 INSERT INTO public.accounts(company_id,id,code,name,kind,category) VALUES(NEW.id,'customer_advances','SAVEN-ADV-AR','Customer advances','liability','general'),(NEW.id,'supplier_advances','SAVEN-ADV-AP','Supplier advances','asset','general');RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION saven_payment_accounts() FROM PUBLIC;
CREATE TRIGGER payment_accounts AFTER INSERT ON companies FOR EACH ROW EXECUTE FUNCTION saven_payment_accounts();
INSERT INTO accounts(company_id,id,code,name,kind,category) SELECT c.id,v.id,v.code,v.name,v.kind,'general' FROM companies c CROSS JOIN(VALUES('customer_advances','SAVEN-ADV-AR','Customer advances','liability'),('supplier_advances','SAVEN-ADV-AP','Supplier advances','asset')) v(id,code,name,kind) WHERE NOT EXISTS(SELECT 1 FROM accounts a WHERE a.company_id=c.id AND a.id=v.id);

CREATE OR REPLACE FUNCTION saven_allocation_control() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE target public.documents%ROWTYPE;settlement public.documents%ROWTYPE;used numeric;expected numeric;side text;
BEGIN
 PERFORM 1 FROM public.companies WHERE id=NEW.company_id FOR UPDATE;
 SELECT * INTO target FROM public.documents WHERE company_id=NEW.company_id AND id=NEW.target_id;
 SELECT * INTO settlement FROM public.documents WHERE company_id=NEW.company_id AND id=NEW.settlement_id;
 IF target.id IS NULL OR settlement.id IS NULL OR target.status!='posted' OR settlement.status!='pending' OR target.party_id!=settlement.party_id OR settlement.date<target.date OR(target.kind='invoice' AND coalesce(target.payload_json::jsonb->>'settlement','')!='credit') THEN RAISE EXCEPTION 'SETTLEMENT_TARGET';END IF;
 IF settlement.kind IN('payment_entry','payment_allocation') THEN
  side:=settlement.payload_json::jsonb->>'partyType';
  IF NOT((side='customer' AND target.kind IN('invoice','opening_receivable')) OR(side='supplier' AND target.kind IN('bill','opening_payable'))) THEN RAISE EXCEPTION 'SETTLEMENT_TARGET';END IF;
  SELECT (v->>'amount')::numeric*100 INTO expected FROM jsonb_array_elements(settlement.payload_json::jsonb->'allocations') v WHERE v->>'targetDocumentId'=NEW.target_id;
  IF expected IS NULL OR expected!=NEW.amount_minor THEN RAISE EXCEPTION 'ALLOCATION_REQUIRED';END IF;
 ELSE
  IF EXISTS(SELECT 1 FROM public.document_allocations WHERE company_id=NEW.company_id AND settlement_id=NEW.settlement_id) THEN RAISE EXCEPTION 'ALLOCATION_REQUIRED';END IF;
  IF NOT((settlement.kind='receipt' AND target.kind IN('invoice','opening_receivable')) OR(settlement.kind='payment' AND target.kind IN('bill','opening_payable')) OR(settlement.kind='credit_note' AND target.kind='invoice') OR(settlement.kind='supplier_credit' AND target.kind='bill')) OR settlement.amount_minor!=NEW.amount_minor THEN RAISE EXCEPTION 'SETTLEMENT_TARGET';END IF;
 END IF;
 SELECT coalesce(sum(a.amount_minor),0) INTO used FROM public.document_allocations a JOIN public.documents s ON s.company_id=a.company_id AND s.id=a.settlement_id WHERE a.company_id=NEW.company_id AND a.target_id=NEW.target_id AND s.status IN('pending','posted');
 IF used+NEW.amount_minor>target.amount_minor THEN RAISE EXCEPTION 'OVER_ALLOCATION';END IF;RETURN NEW;
END $$;
CREATE FUNCTION saven_payment_source_control() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE source public.documents%ROWTYPE;consumer public.documents%ROWTYPE;available numeric;used numeric;expected numeric;
BEGIN
 PERFORM 1 FROM public.companies WHERE id=NEW.company_id FOR UPDATE;
 SELECT * INTO source FROM public.documents WHERE company_id=NEW.company_id AND id=NEW.source_id;
 SELECT * INTO consumer FROM public.documents WHERE company_id=NEW.company_id AND id=NEW.consumer_id;
 IF source.kind IS DISTINCT FROM 'payment_entry' OR source.status!='posted' OR consumer.kind NOT IN('payment_entry','payment_allocation') OR consumer.status!='pending' OR source.party_id!=consumer.party_id OR source.date>consumer.date OR source.payload_json::jsonb->>'partyType' IS DISTINCT FROM consumer.payload_json::jsonb->>'partyType' THEN RAISE EXCEPTION 'ADVANCE_SOURCE';END IF;
 available:=(source.preview_json::jsonb->'payment'->>'advance')::numeric*100;
 SELECT coalesce(sum(s.amount_minor),0) INTO used FROM public.payment_sources s JOIN public.documents d ON d.company_id=s.company_id AND d.id=s.consumer_id WHERE s.company_id=NEW.company_id AND s.source_id=NEW.source_id AND d.status IN('pending','posted');
 SELECT (v->>'amount')::numeric*100 INTO expected FROM jsonb_array_elements(consumer.payload_json::jsonb->'sources') v WHERE v->>'paymentId'=NEW.source_id;
 IF expected IS NULL OR expected!=NEW.amount_minor OR available IS NULL OR available<=0 THEN RAISE EXCEPTION 'ADVANCE_SOURCE';END IF;
 IF used+NEW.amount_minor>available THEN RAISE EXCEPTION 'ADVANCE_EXCEEDED';END IF;RETURN NEW;
END $$;
CREATE TRIGGER payment_source_control BEFORE INSERT ON payment_sources FOR EACH ROW EXECUTE FUNCTION saven_payment_source_control();
CREATE FUNCTION saven_payment_completeness() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE p jsonb;allocated numeric;sourced numeric;expected_alloc numeric;expected_source numeric;
BEGIN
 IF NEW.kind NOT IN('payment_entry','payment_allocation') THEN RETURN NEW;END IF;p:=NEW.payload_json::jsonb;
 SELECT coalesce(sum(amount_minor),0) INTO allocated FROM public.document_allocations WHERE company_id=NEW.company_id AND settlement_id=NEW.id;
 SELECT coalesce(sum(amount_minor),0) INTO sourced FROM public.payment_sources WHERE company_id=NEW.company_id AND consumer_id=NEW.id;
 SELECT coalesce(sum((v->>'amount')::numeric*100),0) INTO expected_alloc FROM jsonb_array_elements(p->'allocations') v;
 SELECT coalesce(sum((v->>'amount')::numeric*100),0) INTO expected_source FROM jsonb_array_elements(p->'sources') v;
 IF allocated!=expected_alloc OR sourced!=expected_source OR allocated>NEW.amount_minor THEN RAISE EXCEPTION 'ALLOCATION_REQUIRED';END IF;
 IF NEW.kind='payment_allocation' AND (allocated!=NEW.amount_minor OR sourced!=NEW.amount_minor) THEN RAISE EXCEPTION 'ALLOCATION_REQUIRED';END IF;
 IF NEW.kind='payment_entry' THEN
  IF (p->>'partyType'='customer' AND p->>'direction'='pay') OR(p->>'partyType'='supplier' AND p->>'direction'='receive') THEN
   IF allocated!=0 OR sourced!=NEW.amount_minor THEN RAISE EXCEPTION 'ADVANCE_SOURCE';END IF;
  ELSIF sourced!=0 OR(p->>'partyType'='other' AND allocated!=0) THEN RAISE EXCEPTION 'ADVANCE_SOURCE';END IF;
 END IF;RETURN NEW;
END $$;
CREATE CONSTRAINT TRIGGER payment_complete AFTER INSERT ON documents DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION saven_payment_completeness();
CREATE FUNCTION saven_payment_cutoff() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
 IF NEW.kind IN('payment_entry','payment_allocation') AND EXISTS(SELECT 1 FROM public.opening_domains o WHERE o.company_id=NEW.company_id AND NEW.date<=o.cutoff AND o.domain=CASE NEW.payload_json::jsonb->>'partyType' WHEN 'customer' THEN 'receivables' WHEN 'supplier' THEN 'payables' ELSE '' END) THEN RAISE EXCEPTION 'OPENING_DATE_CLOSED';END IF;RETURN NEW;
END $$;
CREATE TRIGGER payment_cutoff BEFORE INSERT ON documents FOR EACH ROW EXECUTE FUNCTION saven_payment_cutoff();
INSERT INTO schema_version(version) VALUES(11);
COMMIT;
