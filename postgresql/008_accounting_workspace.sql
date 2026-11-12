BEGIN;
ALTER TABLE accounts ADD COLUMN active boolean NOT NULL DEFAULT true;
ALTER TABLE documents DROP CONSTRAINT supported_document_kind;
ALTER TABLE documents DROP CONSTRAINT document_subject;
ALTER TABLE documents ADD CONSTRAINT supported_document_kind CHECK(kind IN('invoice','stock_issue','bill','receipt','payment','journal','cash_transfer','cash_expense','cash_income','reversal'));
ALTER TABLE documents ADD CONSTRAINT document_subject CHECK(
 (kind IN('invoice','bill','receipt','payment') AND party_id IS NOT NULL AND item_id IS NULL AND quantity IS NULL)
 OR(kind='stock_issue' AND item_id IS NOT NULL AND party_id IS NULL AND quantity>0)
 OR(kind IN('journal','cash_transfer','cash_expense','cash_income','reversal') AND party_id IS NULL AND item_id IS NULL AND quantity IS NULL));
CREATE UNIQUE INDEX one_active_reversal ON documents(company_id,(payload_json::jsonb->>'originalDocumentId')) WHERE kind='reversal' AND status IN('pending','posted');
CREATE FUNCTION saven_reversal_control() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
DECLARE original public.documents%ROWTYPE;
BEGIN
 IF NEW.kind='reversal' THEN
  SELECT * INTO original FROM documents WHERE company_id=NEW.company_id AND id=NEW.payload_json::jsonb->>'originalDocumentId';
  IF original.status IS DISTINCT FROM 'posted' OR original.kind NOT IN('journal','cash_transfer','cash_expense','cash_income') OR NEW.date<original.date THEN RAISE EXCEPTION 'INVALID_REVERSAL'; END IF;
  IF EXISTS(SELECT 1 FROM jsonb_array_elements(original.preview_json::jsonb->'lines') WITH ORDINALITY a(v,n) FULL JOIN jsonb_array_elements(NEW.preview_json::jsonb->'lines') WITH ORDINALITY b(v,n) USING(n) WHERE a.v->>'accountId' IS DISTINCT FROM b.v->>'accountId' OR a.v->>'debit' IS DISTINCT FROM b.v->>'credit' OR a.v->>'credit' IS DISTINCT FROM b.v->>'debit') THEN RAISE EXCEPTION 'INVALID_REVERSAL'; END IF;
 END IF;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(NEW.preview_json::jsonb->'lines') l JOIN accounts a ON a.company_id=NEW.company_id AND a.id=l->>'accountId' WHERE NOT a.active) AND NEW.kind!='reversal' THEN RAISE EXCEPTION 'ACCOUNT_INACTIVE'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER reversal_control BEFORE INSERT ON documents FOR EACH ROW EXECUTE FUNCTION saven_reversal_control();

CREATE TABLE bank_statements(company_id text NOT NULL,id text NOT NULL DEFAULT gen_random_uuid()::text,account_id text NOT NULL,reference text NOT NULL,start_date text NOT NULL,end_date text NOT NULL,opening_minor bigint NOT NULL,closing_minor bigint NOT NULL,status text NOT NULL DEFAULT 'open' CHECK(status IN('open','closed')),created_by text NOT NULL REFERENCES users(id),closed_by text REFERENCES users(id),created_at bigint NOT NULL,closed_at bigint,PRIMARY KEY(company_id,id),UNIQUE(company_id,account_id,reference),FOREIGN KEY(company_id,account_id) REFERENCES accounts(company_id,id),CHECK(start_date<=end_date));
CREATE TABLE bank_statement_lines(company_id text NOT NULL,statement_id text NOT NULL,line_no integer NOT NULL CHECK(line_no BETWEEN 1 AND 200),date text NOT NULL,reference text NOT NULL,amount_minor bigint NOT NULL CHECK(amount_minor!=0 AND abs(amount_minor)<=999999999999),PRIMARY KEY(company_id,statement_id,line_no),FOREIGN KEY(company_id,statement_id) REFERENCES bank_statements(company_id,id));
CREATE TABLE bank_matches(company_id text NOT NULL,statement_id text NOT NULL,line_no integer NOT NULL,account_id text NOT NULL,journal_id text NOT NULL,actor_id text NOT NULL REFERENCES users(id),created_at bigint NOT NULL,PRIMARY KEY(company_id,statement_id,line_no),UNIQUE(company_id,account_id,journal_id),FOREIGN KEY(company_id,statement_id,line_no) REFERENCES bank_statement_lines(company_id,statement_id,line_no),FOREIGN KEY(company_id,journal_id) REFERENCES journals(company_id,id));
DO $$ DECLARE t text; BEGIN FOREACH t IN ARRAY ARRAY['bank_statements','bank_statement_lines','bank_matches'] LOOP EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',t); EXECUTE format('CREATE POLICY company_scope ON %I USING(saven_member(company_id))',t); EXECUTE format('GRANT SELECT ON %I TO saven_app',t); END LOOP; END $$;
CREATE TRIGGER statement_lines_no_update BEFORE UPDATE OR DELETE ON bank_statement_lines FOR EACH ROW EXECUTE FUNCTION saven_immutable('STATEMENT_IMMUTABLE');

CREATE FUNCTION saven_accounting_admin(cid text,action text,p jsonb,expected bigint,k text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE actor text; r text; rev bigint; previous public.configuration_events%ROWTYPE; fingerprint text; result jsonb; aid text; sid text; s public.bank_statements%ROWTYPE; prior_statement public.bank_statements%ROWTYPE; amount bigint; total numeric; old_data jsonb; baseline bigint;
BEGIN
 actor:=saven_actor();
 SELECT m.role INTO r FROM memberships m JOIN companies c ON c.id=m.company_id WHERE m.company_id=cid AND m.user_id=actor AND m.active=1 AND c.status='active';
 IF r IS NULL OR r NOT IN('owner','admin','preparer','approver') OR k !~ '^[a-zA-Z0-9_-]{16,128}$' THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
 SELECT revision INTO rev FROM companies WHERE id=cid FOR UPDATE;
 fingerprint:=encode(sha256(convert_to(action||p::text,'UTF8')),'hex');
 SELECT * INTO previous FROM configuration_events WHERE company_id=cid AND command_key=k;
 IF FOUND THEN IF previous.actor_id!=actor OR previous.payload_hash!=fingerprint THEN RAISE EXCEPTION 'IDEMPOTENCY_CONFLICT'; END IF; RETURN previous.result_json||'{"replayed":true}'::jsonb; END IF;
 IF rev IS DISTINCT FROM expected THEN RAISE EXCEPTION 'STALE_PREVIEW'; END IF;
 IF EXISTS(SELECT 1 FROM resource_denials WHERE company_id=cid AND user_id=actor) THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
 IF action='account_update' THEN
  IF r NOT IN('owner','admin') THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
  aid:=p->>'id'; SELECT to_jsonb(a) INTO old_data FROM accounts a WHERE company_id=cid AND id=aid;
  IF old_data IS NULL OR length(btrim(p->>'name')) NOT BETWEEN 1 AND 160 OR length(btrim(p->>'code')) NOT BETWEEN 1 AND 30 OR length(btrim(p->>'reason')) NOT BETWEEN 1 AND 500 OR jsonb_typeof(p->'active')!='boolean' THEN RAISE EXCEPTION 'INVALID_ACCOUNT'; END IF;
  IF (p->>'active')::boolean=false AND (aid IN('cash','bank','receivable','payable','inventory','revenue','expense','opening_equity','input_tax','output_tax') OR EXISTS(SELECT 1 FROM documents d,jsonb_array_elements(d.preview_json::jsonb->'lines') l WHERE d.company_id=cid AND d.status='pending' AND l->>'accountId'=aid)) THEN RAISE EXCEPTION 'ACCOUNT_IN_USE'; END IF;
  UPDATE accounts SET name=btrim(p->>'name'),code=btrim(p->>'code'),active=(p->>'active')::boolean WHERE company_id=cid AND id=aid;
  result:=jsonb_build_object('id',aid);
 ELSIF action='statement_import' THEN
  IF r NOT IN('owner','admin','preparer') THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
  aid:=p->>'accountId';
  IF NOT EXISTS(SELECT 1 FROM accounts WHERE company_id=cid AND id=aid AND category='cash_bank' AND active) OR jsonb_array_length(p->'lines') NOT BETWEEN 1 AND 200 THEN RAISE EXCEPTION 'INVALID_STATEMENT'; END IF;
  IF EXISTS(SELECT 1 FROM bank_statements WHERE company_id=cid AND account_id=aid AND start_date<=p->>'to' AND end_date>=p->>'from') THEN RAISE EXCEPTION 'STATEMENT_OVERLAP'; END IF;
  SELECT * INTO prior_statement FROM bank_statements WHERE company_id=cid AND account_id=aid ORDER BY end_date DESC LIMIT 1;
  IF FOUND THEN
   IF (p->>'from')::date!=prior_statement.end_date::date+1 OR (p->>'openingMinor')::bigint!=prior_statement.closing_minor THEN RAISE EXCEPTION 'STATEMENT_CONTINUITY'; END IF;
  ELSE
   SELECT coalesce(sum(l.debit_minor-l.credit_minor),0) INTO total FROM journals j JOIN journal_lines l ON l.company_id=j.company_id AND l.journal_id=j.id WHERE j.company_id=cid AND j.status='posted' AND j.date<p->>'from' AND l.account_id=aid;
   IF total!=(p->>'openingMinor')::bigint THEN RAISE EXCEPTION 'OPENING_RECONCILIATION'; END IF;
  END IF;
  SELECT sum((l->>'amountMinor')::bigint) INTO total FROM jsonb_array_elements(p->'lines') l;
  IF (p->>'openingMinor')::bigint+total!=(p->>'closingMinor')::bigint THEN RAISE EXCEPTION 'STATEMENT_TOTAL'; END IF;
  INSERT INTO bank_statements(company_id,account_id,reference,start_date,end_date,opening_minor,closing_minor,created_by,created_at) VALUES(cid,aid,p->>'reference',p->>'from',p->>'to',(p->>'openingMinor')::bigint,(p->>'closingMinor')::bigint,actor,extract(epoch FROM clock_timestamp())::bigint) RETURNING id INTO sid;
  INSERT INTO bank_statement_lines SELECT cid,sid,n::integer,l->>'date',l->>'reference',(l->>'amountMinor')::bigint FROM jsonb_array_elements(p->'lines') WITH ORDINALITY a(l,n);
  result:=jsonb_build_object('id',sid);
 ELSE
  sid:=p->>'statementId'; SELECT * INTO s FROM bank_statements WHERE company_id=cid AND id=sid FOR UPDATE;
  IF s.id IS NULL OR s.status!='open' THEN RAISE EXCEPTION 'STATEMENT_CLOSED'; END IF;
  IF action='match' THEN
   SELECT sum(l.debit_minor-l.credit_minor) INTO total FROM journals j JOIN journal_lines l ON l.company_id=j.company_id AND l.journal_id=j.id WHERE j.company_id=cid AND j.id=p->>'journalId' AND j.status='posted' AND j.date<=s.end_date AND l.account_id=s.account_id;
   IF EXISTS(SELECT 1 FROM journals j WHERE j.company_id=cid AND j.id=p->>'journalId' AND j.date<(SELECT min(start_date) FROM bank_statements WHERE company_id=cid AND account_id=s.account_id)) THEN RAISE EXCEPTION 'MATCH_AMOUNT'; END IF;
   SELECT amount_minor INTO amount FROM bank_statement_lines WHERE company_id=cid AND statement_id=sid AND line_no=(p->>'lineNo')::integer;
   IF total IS NULL OR amount IS NULL OR total!=amount THEN RAISE EXCEPTION 'MATCH_AMOUNT'; END IF;
   INSERT INTO bank_matches VALUES(cid,sid,(p->>'lineNo')::integer,s.account_id,p->>'journalId',actor,extract(epoch FROM clock_timestamp())::bigint);
  ELSIF action='unmatch' THEN
   IF r NOT IN('owner','admin','approver') OR length(btrim(p->>'reason')) NOT BETWEEN 1 AND 500 THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
   DELETE FROM bank_matches WHERE company_id=cid AND statement_id=sid AND line_no=(p->>'lineNo')::integer;
  ELSIF action='close' THEN
   IF r NOT IN('owner','admin','approver') OR actor=s.created_by THEN RAISE EXCEPTION 'INDEPENDENT_REVIEW'; END IF;
   IF EXISTS(SELECT 1 FROM bank_statement_lines l WHERE l.company_id=cid AND l.statement_id=sid AND NOT EXISTS(SELECT 1 FROM bank_matches m WHERE m.company_id=cid AND m.statement_id=sid AND m.line_no=l.line_no)) THEN RAISE EXCEPTION 'UNMATCHED_STATEMENT'; END IF;
   SELECT coalesce(sum(l.debit_minor-l.credit_minor),0) INTO total FROM journals j JOIN journal_lines l ON l.company_id=j.company_id AND l.journal_id=j.id WHERE j.company_id=cid AND j.status='posted' AND j.date<=s.end_date AND l.account_id=s.account_id AND EXISTS(SELECT 1 FROM bank_matches m JOIN bank_statements b ON b.company_id=m.company_id AND b.id=m.statement_id WHERE m.company_id=cid AND m.account_id=s.account_id AND m.journal_id=j.id AND (b.status='closed' OR b.id=sid) AND b.end_date<=s.end_date);
   SELECT opening_minor INTO baseline FROM bank_statements WHERE company_id=cid AND account_id=s.account_id ORDER BY start_date LIMIT 1;
   IF total+baseline!=s.closing_minor THEN RAISE EXCEPTION 'RECONCILIATION_DIFFERENCE'; END IF;
   IF EXISTS(SELECT 1 FROM bank_statements WHERE company_id=cid AND account_id=s.account_id AND status='open' AND end_date<s.start_date) THEN RAISE EXCEPTION 'EARLIER_STATEMENT_OPEN'; END IF;
   UPDATE bank_statements SET status='closed',closed_by=actor,closed_at=extract(epoch FROM clock_timestamp())::bigint WHERE company_id=cid AND id=sid;
  ELSE RAISE EXCEPTION 'INVALID_ACTION'; END IF;
  result:=jsonb_build_object('id',sid);
 END IF;
 result:=result||jsonb_build_object('revision',rev+1);
 INSERT INTO configuration_events(company_id,actor_id,entity_type,entity_id,command_key,payload_hash,data_json,result_json,created_at) VALUES(cid,actor,'accounting.'||action,coalesce(aid,sid),k,fingerprint,jsonb_build_object('input',p,'before',old_data),result,extract(epoch FROM clock_timestamp())::bigint);
 UPDATE companies SET revision=revision+1 WHERE id=cid;
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION saven_accounting_admin(text,text,jsonb,bigint,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION saven_accounting_admin(text,text,jsonb,bigint,text) TO saven_app;
CREATE FUNCTION saven_closed_bank_control() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
BEGIN
 IF NEW.status='posted' AND EXISTS(SELECT 1 FROM journal_lines l JOIN bank_statements s ON s.company_id=l.company_id AND s.account_id=l.account_id WHERE l.company_id=NEW.company_id AND l.journal_id=NEW.id AND (s.status='closed' AND NEW.date<=s.end_date OR NEW.date<(SELECT min(b.start_date) FROM bank_statements b WHERE b.company_id=s.company_id AND b.account_id=s.account_id))) THEN RAISE EXCEPTION 'BANK_PERIOD_CLOSED'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER closed_bank_control BEFORE UPDATE ON journals FOR EACH ROW EXECUTE FUNCTION saven_closed_bank_control();
INSERT INTO schema_version(version) VALUES(6);
COMMIT;
