BEGIN;
ALTER TABLE documents DROP CONSTRAINT supported_document_kind;
ALTER TABLE documents DROP CONSTRAINT document_subject;
ALTER TABLE documents ADD CONSTRAINT supported_document_kind CHECK(kind IN('invoice','stock_issue','bill','receipt','payment','journal','cash_transfer','cash_expense','cash_income','reversal','credit_note','supplier_credit','opening_balance','opening_receivable','opening_payable'));
ALTER TABLE documents ADD CONSTRAINT document_subject CHECK(
 (kind IN('invoice','bill','receipt','payment','credit_note','supplier_credit','opening_receivable','opening_payable') AND party_id IS NOT NULL AND item_id IS NULL AND quantity IS NULL)
 OR(kind='stock_issue' AND item_id IS NOT NULL AND party_id IS NULL AND quantity>0)
 OR(kind IN('journal','cash_transfer','cash_expense','cash_income','reversal','opening_balance') AND party_id IS NULL AND item_id IS NULL AND quantity IS NULL));
CREATE TABLE opening_domains(company_id text NOT NULL,domain text NOT NULL CHECK(domain IN('receivables','payables','inventory')),document_id text NOT NULL,cutoff text NOT NULL,PRIMARY KEY(company_id,domain),FOREIGN KEY(company_id,document_id) REFERENCES documents(company_id,id));
CREATE TABLE opening_stock_positions(company_id text NOT NULL,item_id text NOT NULL,document_id text NOT NULL,quantity bigint NOT NULL CHECK(quantity>0),unit_cost_minor bigint NOT NULL CHECK(unit_cost_minor>0),value_minor bigint NOT NULL CHECK(value_minor>0),inventory_account text NOT NULL,PRIMARY KEY(company_id,item_id),FOREIGN KEY(company_id,item_id) REFERENCES items(company_id,id),FOREIGN KEY(company_id,document_id) REFERENCES documents(company_id,id),FOREIGN KEY(company_id,inventory_account) REFERENCES accounts(company_id,id),CHECK(value_minor=quantity*unit_cost_minor));
DO $$ DECLARE t text; BEGIN FOREACH t IN ARRAY ARRAY['opening_domains','opening_stock_positions'] LOOP EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',t);EXECUTE format('CREATE POLICY company_scope ON %I USING(saven_member(company_id))',t);EXECUTE format('GRANT SELECT ON %I TO saven_app',t);EXECUTE format('CREATE TRIGGER immutable BEFORE UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION saven_immutable(''OPENING_IMMUTABLE'')',t);END LOOP;END $$;

CREATE FUNCTION saven_opening_insert_guard() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
DECLARE parent public.documents%ROWTYPE; domain_name text;
BEGIN
 IF NEW.kind='opening_balance' THEN
  IF NEW.status!='pending' OR NEW.prepared_by IS DISTINCT FROM saven_actor() OR NOT EXISTS(SELECT 1 FROM memberships WHERE company_id=NEW.company_id AND user_id=saven_actor() AND active=1 AND role IN('owner','admin')) THEN RAISE EXCEPTION 'FORBIDDEN';END IF;
  IF EXISTS(SELECT 1 FROM documents d WHERE d.company_id=NEW.company_id AND d.status='pending' AND d.id!=NEW.id) THEN RAISE EXCEPTION 'OPENING_PENDING'; END IF;
  IF EXISTS(SELECT 1 FROM documents d,jsonb_array_elements_text(d.payload_json::jsonb->'domains') x WHERE d.company_id=NEW.company_id AND d.kind='opening_balance' AND d.status IN('pending','posted') AND d.id!=NEW.id AND NEW.payload_json::jsonb->'domains' ? x.value) THEN RAISE EXCEPTION 'OPENING_ALREADY_SET';END IF;
 ELSIF NEW.kind IN('opening_receivable','opening_payable') THEN
  domain_name:=CASE WHEN NEW.kind='opening_receivable' THEN 'receivables' ELSE 'payables' END;
  SELECT * INTO parent FROM documents WHERE company_id=NEW.company_id AND id=NEW.payload_json::jsonb->>'openingDocumentId';
  IF parent.kind IS DISTINCT FROM 'opening_balance' OR parent.status IS DISTINCT FROM 'posted' OR parent.reviewed_by IS DISTINCT FROM saven_actor() OR NEW.reviewed_by IS DISTINCT FROM parent.reviewed_by OR NEW.prepared_by IS DISTINCT FROM parent.prepared_by OR NEW.status!='posted' OR NEW.date!=parent.date OR NOT EXISTS(SELECT 1 FROM opening_domains WHERE company_id=NEW.company_id AND domain=domain_name AND document_id=parent.id) OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(parent.payload_json::jsonb->domain_name) p WHERE p->>'partyId'=NEW.party_id AND p->>'reference'=NEW.reference AND (p->>'amount')::numeric*100=NEW.amount_minor) THEN RAISE EXCEPTION 'OPENING_PARENT_REQUIRED';END IF;
 ELSIF EXISTS(SELECT 1 FROM documents WHERE company_id=NEW.company_id AND kind='opening_balance' AND status='pending') THEN RAISE EXCEPTION 'OPENING_PENDING';
 ELSIF EXISTS(SELECT 1 FROM opening_domains g WHERE g.company_id=NEW.company_id AND NEW.date<=g.cutoff AND((g.domain='receivables' AND NEW.kind IN('invoice','receipt','credit_note')) OR(g.domain='payables' AND NEW.kind IN('bill','payment','supplier_credit')) OR(g.domain='inventory' AND NEW.kind='stock_issue'))) OR EXISTS(SELECT 1 FROM documents d WHERE d.company_id=NEW.company_id AND d.kind='opening_balance' AND d.status='posted' AND d.payload_json::jsonb->>'mode'='post' AND NEW.date<=d.date) THEN RAISE EXCEPTION 'OPENING_DATE_CLOSED';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER opening_insert_guard BEFORE INSERT ON documents FOR EACH ROW EXECUTE FUNCTION saven_opening_insert_guard();

CREATE OR REPLACE FUNCTION saven_document_review() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
BEGIN
 IF OLD.status!='pending' OR(to_jsonb(NEW)-ARRAY['status','reviewed_by','version']) IS DISTINCT FROM(to_jsonb(OLD)-ARRAY['status','reviewed_by','version']) OR NEW.status NOT IN('posted','rejected') OR NEW.reviewed_by IS NULL OR NEW.reviewed_by=OLD.prepared_by OR NEW.version!=OLD.version+1 THEN RAISE EXCEPTION 'DOCUMENT_IMMUTABLE';END IF;
 IF EXISTS(SELECT 1 FROM resource_denials d WHERE d.company_id=NEW.company_id AND d.user_id=NEW.reviewed_by AND((d.resource_type='party' AND d.resource_id=NEW.party_id) OR(d.resource_type='item' AND d.resource_id=NEW.item_id) OR(d.resource_type='account' AND d.resource_id IN(SELECT value->>'accountId' FROM jsonb_array_elements(NEW.preview_json::jsonb->'lines'))))) THEN RAISE EXCEPTION 'RESOURCE_DENIED';END IF;
 IF NEW.kind IN('receipt','payment','credit_note','supplier_credit') AND NOT EXISTS(SELECT 1 FROM document_allocations WHERE company_id=NEW.company_id AND settlement_id=NEW.id) THEN RAISE EXCEPTION 'ALLOCATION_REQUIRED';END IF;
 IF NEW.status='posted' AND NOT(NEW.kind='opening_balance' AND NEW.payload_json::jsonb->>'mode'='reconcile') AND NOT EXISTS(SELECT 1 FROM journals WHERE company_id=NEW.company_id AND document_id=NEW.id AND status='posted' AND date=NEW.date) THEN RAISE EXCEPTION 'JOURNAL_REQUIRED';END IF;
 RETURN NEW;
END $$;

CREATE FUNCTION saven_apply_opening(cid text,did text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE root public.documents%ROWTYPE; actor text; side text; account_key text; target_kind text; p jsonb; item public.items%ROWTYPE; a record; ledger numeric; existing_balance numeric; incoming numeric; new_id text; child_payload jsonb; child_preview jsonb; child_ids jsonb:='[]'; stamp bigint; total numeric;
BEGIN
 actor:=saven_actor();PERFORM 1 FROM companies WHERE id=cid FOR UPDATE;
 SELECT * INTO root FROM documents WHERE company_id=cid AND id=did;
 IF actor IS NULL OR root.kind IS DISTINCT FROM 'opening_balance' OR root.status IS DISTINCT FROM 'posted' OR root.reviewed_by IS DISTINCT FROM actor OR root.prepared_by=actor OR NOT saven_member(cid) OR NOT EXISTS(SELECT 1 FROM memberships WHERE company_id=cid AND user_id=actor AND active=1 AND role IN('owner','admin','approver')) OR EXISTS(SELECT 1 FROM resource_denials WHERE company_id=cid AND user_id IN(actor,root.prepared_by)) THEN RAISE EXCEPTION 'FORBIDDEN';END IF;
 IF NOT EXISTS(SELECT 1 FROM periods WHERE company_id=cid AND root.date BETWEEN start_date AND end_date AND locked=0) THEN RAISE EXCEPTION 'PERIOD_LOCKED';END IF;
 IF NOT EXISTS(SELECT 1 FROM document_attachments x JOIN stored_files f ON f.company_id=x.company_id AND f.id=x.file_id WHERE x.company_id=cid AND x.document_id=did AND f.scan_state='clean' AND NOT EXISTS(SELECT 1 FROM attachment_withdrawals w WHERE w.company_id=x.company_id AND w.document_id=x.document_id AND w.file_id=x.file_id)) THEN RAISE EXCEPTION 'OPENING_EVIDENCE_REQUIRED';END IF;
 IF EXISTS(SELECT 1 FROM documents WHERE company_id=cid AND id!=did AND(status='pending' OR status='posted' AND date>root.date)) THEN RAISE EXCEPTION 'OPENING_PENDING';END IF;
 IF root.payload_json::jsonb->>'mode'='post' AND EXISTS(SELECT 1 FROM journals WHERE company_id=cid AND document_id!=did) THEN RAISE EXCEPTION 'LEDGER_NOT_EMPTY';END IF;
 IF root.payload_json::jsonb->>'mode' NOT IN('post','reconcile') OR jsonb_array_length(root.payload_json::jsonb->'domains') NOT BETWEEN 1 AND 3 THEN RAISE EXCEPTION 'INVALID_OPENING';END IF;
 stamp:=extract(epoch FROM clock_timestamp())::bigint;
 FOR side IN SELECT jsonb_array_elements_text(root.payload_json::jsonb->'domains') LOOP
  IF side NOT IN('receivables','payables','inventory') THEN RAISE EXCEPTION 'INVALID_OPENING';END IF;
  INSERT INTO opening_domains VALUES(cid,side,did,root.date);
  IF side IN('receivables','payables') THEN
   account_key:=CASE WHEN side='receivables' THEN 'receivable' ELSE 'payable' END;target_kind:=CASE WHEN side='receivables' THEN 'opening_receivable' ELSE 'opening_payable' END;
   SELECT coalesce(sum(l.debit_minor-l.credit_minor),0)*CASE WHEN side='payables' THEN -1 ELSE 1 END INTO ledger FROM journal_lines l JOIN journals j ON j.company_id=l.company_id AND j.id=l.journal_id WHERE j.company_id=cid AND j.status='posted' AND j.date<=root.date AND l.account_id=account_key;
   SELECT coalesce(sum(d.amount_minor-coalesce((SELECT sum(x.amount_minor) FROM document_allocations x JOIN documents s ON s.company_id=x.company_id AND s.id=x.settlement_id WHERE x.company_id=d.company_id AND x.target_id=d.id AND s.status='posted' AND s.date<=root.date),0)),0) INTO existing_balance FROM documents d WHERE d.company_id=cid AND d.status='posted' AND d.date<=root.date AND(d.kind=target_kind OR d.kind=CASE WHEN side='receivables' THEN 'invoice' ELSE 'bill' END AND(d.kind!='invoice' OR d.payload_json::jsonb->>'settlement'='credit'));
   SELECT coalesce(sum((x->>'amount')::numeric*100),0) INTO incoming FROM jsonb_array_elements(root.payload_json::jsonb->side) x;
   IF ledger!=existing_balance+incoming THEN RAISE EXCEPTION 'OPENING_CONTROL_DIFFERENCE';END IF;
   FOR p IN SELECT value FROM jsonb_array_elements(root.payload_json::jsonb->side) LOOP
    IF NOT EXISTS(SELECT 1 FROM parties WHERE company_id=cid AND id=p->>'partyId' AND kind IN('both',CASE WHEN side='receivables' THEN 'customer' ELSE 'supplier' END)) THEN RAISE EXCEPTION 'INVALID_OPENING';END IF;
    new_id:=gen_random_uuid()::text;
    child_payload:=jsonb_build_object('kind',target_kind,'date',root.date,'reference',p->>'reference','partyId',p->>'partyId','amount',p->>'amount','originalDate',p->>'originalDate','dueDate',p->>'dueDate','openingDocumentId',did);
    SELECT jsonb_build_object('document',child_payload,'amount',p->>'amount','lines',jsonb_build_array(jsonb_build_object('accountId',id,'code',code,'name',name,'debit','0.00','credit','0.00')),'openingPosition',jsonb_build_object('sourceId',did,'sourceReference',root.reference,'originalDate',p->>'originalDate','dueDate',p->>'dueDate','noAdditionalJournal',true)) INTO child_preview FROM accounts WHERE company_id=cid AND id=account_key;
    INSERT INTO documents(company_id,id,kind,date,reference,description,party_id,amount_minor,payload_json,payload_hash,preview_json,prepared_by,reviewed_by,status,created_at) VALUES(cid,new_id,target_kind,root.date,p->>'reference','Opening position from '||root.reference,p->>'partyId',(p->>'amount')::numeric*100,child_payload::text,encode(sha256(convert_to(child_payload::text,'UTF8')),'hex'),child_preview::text,root.prepared_by,actor,'posted',stamp);
    child_ids:=child_ids||jsonb_build_array(new_id);
   END LOOP;
  ELSE
   IF EXISTS(SELECT 1 FROM items i WHERE i.company_id=cid AND(i.reserved!=0 OR i.on_hand>0 AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(root.payload_json::jsonb->'stock') ps(value) WHERE ps.value->>'itemId'=i.id))) THEN RAISE EXCEPTION 'OPENING_STOCK_COVERAGE';END IF;
   FOR a IN SELECT id FROM accounts WHERE company_id=cid AND category='inventory' LOOP
    SELECT coalesce(sum(l.debit_minor-l.credit_minor),0) INTO ledger FROM journal_lines l JOIN journals j ON j.company_id=l.company_id AND j.id=l.journal_id WHERE j.company_id=cid AND j.status='posted' AND j.date<=root.date AND l.account_id=a.id;
    SELECT coalesce(sum((ps.value->>'quantity')::bigint*i.unit_cost_minor),0) INTO incoming FROM jsonb_array_elements(root.payload_json::jsonb->'stock') ps(value) JOIN items i ON i.company_id=cid AND i.id=ps.value->>'itemId' WHERE i.inventory_account=a.id;
    IF ledger!=incoming THEN RAISE EXCEPTION 'OPENING_INVENTORY_DIFFERENCE';END IF;
   END LOOP;
   FOR p IN SELECT value FROM jsonb_array_elements(root.payload_json::jsonb->'stock') LOOP
    SELECT * INTO item FROM items WHERE company_id=cid AND id=p->>'itemId' FOR UPDATE;
    IF item.id IS NULL OR item.reserved!=0 OR(item.on_hand!=0 AND(root.payload_json::jsonb->>'mode'!='reconcile' OR item.on_hand!=(p->>'quantity')::bigint)) THEN RAISE EXCEPTION 'OPENING_STOCK_DIFFERENCE';END IF;
    INSERT INTO opening_stock_positions VALUES(cid,item.id,did,(p->>'quantity')::bigint,item.unit_cost_minor,(p->>'quantity')::bigint*item.unit_cost_minor,item.inventory_account);
    UPDATE items SET on_hand=(p->>'quantity')::bigint WHERE company_id=cid AND id=item.id;
   END LOOP;
  END IF;
 END LOOP;
 RETURN jsonb_build_object('documents',child_ids);
END $$;
REVOKE ALL ON FUNCTION saven_apply_opening(text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION saven_apply_opening(text,text) TO saven_app;

CREATE FUNCTION saven_opening_complete() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
BEGIN
 IF NEW.kind='opening_balance' AND NEW.status='posted' AND(SELECT count(*) FROM opening_domains WHERE company_id=NEW.company_id AND document_id=NEW.id)!=jsonb_array_length(NEW.payload_json::jsonb->'domains') THEN RAISE EXCEPTION 'OPENING_INCOMPLETE';END IF;
 RETURN NEW;
END $$;
CREATE CONSTRAINT TRIGGER opening_complete AFTER INSERT OR UPDATE ON documents DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION saven_opening_complete();
CREATE FUNCTION saven_opening_journal_cutoff() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
BEGIN
 IF NEW.status='posted' AND(EXISTS(SELECT 1 FROM documents d WHERE d.company_id=NEW.company_id AND d.kind='opening_balance' AND d.status='posted' AND d.payload_json::jsonb->>'mode'='post' AND NEW.date<=d.date) OR EXISTS(SELECT 1 FROM opening_domains g JOIN journal_lines l ON l.company_id=g.company_id AND l.journal_id=NEW.id JOIN accounts a ON a.company_id=l.company_id AND a.id=l.account_id WHERE g.company_id=NEW.company_id AND NEW.date<=g.cutoff AND((g.domain='receivables' AND a.category='receivable') OR(g.domain='payables' AND a.category='payable') OR(g.domain='inventory' AND a.category='inventory')))) THEN RAISE EXCEPTION 'OPENING_DATE_CLOSED';END IF;RETURN NEW;
END $$;
CREATE TRIGGER opening_journal_cutoff BEFORE UPDATE ON journals FOR EACH ROW EXECUTE FUNCTION saven_opening_journal_cutoff();

CREATE OR REPLACE FUNCTION saven_allocation_control() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
DECLARE target public.documents%ROWTYPE; settlement public.documents%ROWTYPE; used bigint;
BEGIN
 PERFORM 1 FROM companies WHERE id=NEW.company_id FOR UPDATE;
 SELECT * INTO target FROM documents WHERE company_id=NEW.company_id AND id=NEW.target_id;SELECT * INTO settlement FROM documents WHERE company_id=NEW.company_id AND id=NEW.settlement_id;
 IF target.id IS NULL OR settlement.id IS NULL OR target.status!='posted' OR settlement.status!='pending'
 OR NOT((settlement.kind='receipt' AND target.kind IN('invoice','opening_receivable')) OR(settlement.kind='payment' AND target.kind IN('bill','opening_payable')) OR(settlement.kind='credit_note' AND target.kind='invoice') OR(settlement.kind='supplier_credit' AND target.kind='bill'))
 OR target.party_id!=settlement.party_id OR settlement.date<target.date OR settlement.amount_minor!=NEW.amount_minor OR(target.kind='invoice' AND coalesce(target.payload_json::jsonb->>'settlement','')!='credit') THEN RAISE EXCEPTION 'SETTLEMENT_TARGET';END IF;
 SELECT coalesce(sum(a.amount_minor),0) INTO used FROM document_allocations a JOIN documents s ON s.company_id=a.company_id AND s.id=a.settlement_id WHERE a.company_id=NEW.company_id AND a.target_id=NEW.target_id AND s.status IN('pending','posted');IF used+NEW.amount_minor>target.amount_minor THEN RAISE EXCEPTION 'OVER_ALLOCATION';END IF;RETURN NEW;
END $$;
INSERT INTO schema_version(version) VALUES(8);
-- Put temporary schemas last for all privileged helpers, including older
-- unqualified-table functions; a runtime temporary table cannot shadow them.
DO $$ DECLARE signature text; BEGIN
 FOR signature IN SELECT p.oid::regprocedure::text FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname LIKE 'saven_%' AND p.prosecdef LOOP
  EXECUTE 'ALTER FUNCTION '||signature||' SET search_path=pg_catalog,public,pg_temp';
 END LOOP;
END $$;
COMMIT;
