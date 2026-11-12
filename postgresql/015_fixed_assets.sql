BEGIN;
ALTER TABLE accounts DROP CONSTRAINT accounts_category_check;
ALTER TABLE accounts ADD CONSTRAINT accounts_category_check CHECK(category IN('general','cash_bank','receivable','payable','inventory','fixed_asset_cost','accumulated_depreciation','depreciation_expense'));
CREATE FUNCTION saven_asset_accounts() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
 INSERT INTO public.accounts(company_id,id,code,name,kind,category) SELECT NEW.id,v.id,v.code,v.name,v.kind,v.category FROM(VALUES('asset_cost','1600','Fixed assets at cost','asset','fixed_asset_cost'),('asset_accumulated','1690','Accumulated depreciation','asset','accumulated_depreciation'),('asset_depreciation','6100','Depreciation expense','expense','depreciation_expense')) v(id,code,name,kind,category) WHERE NOT EXISTS(SELECT 1 FROM public.accounts a WHERE a.company_id=NEW.id AND(a.id=v.id OR a.code=v.code));RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION saven_asset_accounts() FROM PUBLIC;
CREATE TRIGGER asset_accounts AFTER INSERT ON companies FOR EACH ROW EXECUTE FUNCTION saven_asset_accounts();
INSERT INTO accounts(company_id,id,code,name,kind,category) SELECT c.id,v.id,v.code,v.name,v.kind,v.category FROM companies c CROSS JOIN(VALUES('asset_cost','1600','Fixed assets at cost','asset','fixed_asset_cost'),('asset_accumulated','1690','Accumulated depreciation','asset','accumulated_depreciation'),('asset_depreciation','6100','Depreciation expense','expense','depreciation_expense')) v(id,code,name,kind,category) WHERE NOT EXISTS(SELECT 1 FROM accounts a WHERE a.company_id=c.id AND(a.id=v.id OR a.code=v.code));
ALTER TABLE documents DROP CONSTRAINT supported_document_kind;
ALTER TABLE documents DROP CONSTRAINT document_subject;
ALTER TABLE documents ADD CONSTRAINT supported_document_kind CHECK(kind IN('invoice','stock_issue','bill','receipt','payment','journal','cash_transfer','cash_expense','cash_income','reversal','credit_note','supplier_credit','opening_balance','opening_receivable','opening_payable','payment_entry','payment_allocation','asset_acquisition','asset_depreciation','asset_disposal','asset_cancellation'));
ALTER TABLE documents ADD CONSTRAINT document_subject CHECK((kind IN('invoice','bill','receipt','payment','credit_note','supplier_credit','opening_receivable','opening_payable','payment_entry','payment_allocation','asset_acquisition','asset_cancellation') AND party_id IS NOT NULL AND item_id IS NULL AND quantity IS NULL) OR(kind='stock_issue' AND item_id IS NOT NULL AND party_id IS NULL AND quantity>0) OR(kind IN('journal','cash_transfer','cash_expense','cash_income','reversal','opening_balance','asset_depreciation') AND party_id IS NULL AND item_id IS NULL AND quantity IS NULL) OR(kind='asset_disposal' AND item_id IS NULL AND quantity IS NULL));
CREATE TABLE fixed_assets(company_id text NOT NULL,id text NOT NULL,code text NOT NULL,name text NOT NULL,category text NOT NULL,serial text NOT NULL,location text NOT NULL,custodian text NOT NULL,in_service_date text NOT NULL,life_months integer NOT NULL CHECK(life_months BETWEEN 1 AND 1200),cost_minor bigint NOT NULL CHECK(cost_minor BETWEEN 1 AND 999999999999),residual_minor bigint NOT NULL CHECK(residual_minor>=0 AND residual_minor<=cost_minor),cost_account text NOT NULL,accumulated_account text NOT NULL,expense_account text NOT NULL,active boolean NOT NULL DEFAULT true,PRIMARY KEY(company_id,id),FOREIGN KEY(company_id,id) REFERENCES documents(company_id,id),FOREIGN KEY(company_id,cost_account) REFERENCES accounts(company_id,id),FOREIGN KEY(company_id,accumulated_account) REFERENCES accounts(company_id,id),FOREIGN KEY(company_id,expense_account) REFERENCES accounts(company_id,id),CHECK(cost_account!=accumulated_account),CHECK(length(code) BETWEEN 1 AND 40 AND length(name) BETWEEN 1 AND 160));
CREATE UNIQUE INDEX fixed_asset_active_code ON fixed_assets(company_id,code) WHERE active;
CREATE TABLE asset_events(company_id text NOT NULL,asset_id text NOT NULL,document_id text NOT NULL,kind text NOT NULL CHECK(kind IN('asset_depreciation','asset_disposal','asset_cancellation')),date text NOT NULL,depreciation_minor bigint NOT NULL CHECK(depreciation_minor>=0),proceeds_minor bigint NOT NULL DEFAULT 0 CHECK(proceeds_minor>=0),gain_minor bigint NOT NULL DEFAULT 0,active boolean NOT NULL DEFAULT true,PRIMARY KEY(company_id,document_id),FOREIGN KEY(company_id,asset_id) REFERENCES fixed_assets(company_id,id),FOREIGN KEY(company_id,document_id) REFERENCES documents(company_id,id));
CREATE INDEX asset_events_asset ON asset_events(company_id,asset_id,date);
DO $$ DECLARE t text;BEGIN FOREACH t IN ARRAY ARRAY['fixed_assets','asset_events'] LOOP EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',t);EXECUTE format('CREATE POLICY company_scope ON %I USING(saven_member(company_id))',t);EXECUTE format('GRANT SELECT ON %I TO saven_app',t);END LOOP;END $$;
CREATE FUNCTION saven_asset_cumulative(cost bigint,residual bigint,service text,life integer,through_date text) RETURNS bigint LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE days integer;elapsed integer;
BEGIN
 days:=((service::date+make_interval(months=>life))::date-service::date);elapsed:=greatest(0,least(days,through_date::date-service::date+1));
 IF days<=0 OR residual>cost THEN RAISE EXCEPTION 'INVALID_LIFE';END IF;
 RETURN floor(((cost-residual)::numeric*elapsed*2+days)/(2::numeric*days))::bigint;
END $$;
REVOKE ALL ON FUNCTION saven_asset_cumulative(bigint,bigint,text,integer,text) FROM PUBLIC;
CREATE FUNCTION saven_asset_document() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE p jsonb;info jsonb;a public.fixed_assets%ROWTYPE;last_date text;posted numeric;due bigint;charge bigint;proceeds bigint:=0;gain bigint:=0;
BEGIN
 IF TG_OP='UPDATE' THEN IF NEW.status='rejected' THEN UPDATE public.fixed_assets SET active=false WHERE company_id=NEW.company_id AND id=NEW.id;UPDATE public.asset_events SET active=false WHERE company_id=NEW.company_id AND document_id=NEW.id;END IF;IF NEW.kind='asset_cancellation' AND NEW.status='posted' THEN UPDATE public.fixed_assets SET active=false WHERE company_id=NEW.company_id AND id=NEW.payload_json::jsonb->>'assetId';END IF;RETURN NEW;END IF;
 IF NEW.kind NOT IN('asset_acquisition','asset_depreciation','asset_disposal','asset_cancellation') THEN RETURN NEW;END IF;
 IF NEW.status!='pending' OR NEW.prepared_by IS DISTINCT FROM public.saven_actor() THEN RAISE EXCEPTION 'FORBIDDEN';END IF;
 PERFORM 1 FROM public.companies WHERE id=NEW.company_id FOR UPDATE;p:=NEW.payload_json::jsonb;
 IF NEW.kind='asset_acquisition' THEN
  info:=p->'asset';IF (p->>'amount')::numeric*100!=NEW.amount_minor OR (info->>'inServiceDate')::date<NEW.date::date OR(info->>'lifeMonths')::integer NOT BETWEEN 1 AND 1200 OR(info->>'inServiceDate')::date+make_interval(months=>(info->>'lifeMonths')::integer)>'9999-12-31'::date OR NOT EXISTS(SELECT 1 FROM public.parties WHERE company_id=NEW.company_id AND id=NEW.party_id AND kind IN('supplier','both')) THEN RAISE EXCEPTION 'INVALID_ASSET';END IF;
  IF EXISTS(SELECT 1 FROM public.resource_denials WHERE company_id=NEW.company_id AND user_id=NEW.prepared_by AND resource_type='account' AND resource_id IN(info->>'costAccountId',info->>'accumulatedAccountId',info->>'expenseAccountId')) THEN RAISE EXCEPTION 'RESOURCE_DENIED';END IF;
  IF EXISTS(SELECT 1 FROM public.opening_domains WHERE company_id=NEW.company_id AND domain='payables' AND NEW.date<=cutoff) THEN RAISE EXCEPTION 'OPENING_DATE_CLOSED';END IF;
  IF NOT EXISTS(SELECT 1 FROM public.accounts WHERE company_id=NEW.company_id AND id=info->>'costAccountId' AND kind='asset' AND category='fixed_asset_cost' AND active) OR NOT EXISTS(SELECT 1 FROM public.accounts WHERE company_id=NEW.company_id AND id=info->>'accumulatedAccountId' AND kind='asset' AND category='accumulated_depreciation' AND active) OR NOT EXISTS(SELECT 1 FROM public.accounts WHERE company_id=NEW.company_id AND id=info->>'expenseAccountId' AND kind='expense' AND category='depreciation_expense' AND active) THEN RAISE EXCEPTION 'INVALID_ACCOUNT';END IF;
  INSERT INTO public.fixed_assets(company_id,id,code,name,category,serial,location,custodian,in_service_date,life_months,cost_minor,residual_minor,cost_account,accumulated_account,expense_account) VALUES(NEW.company_id,NEW.id,info->>'code',info->>'name',info->>'category',info->>'serial',info->>'location',info->>'custodian',info->>'inServiceDate',(info->>'lifeMonths')::integer,NEW.amount_minor,(info->>'residual')::numeric*100,info->>'costAccountId',info->>'accumulatedAccountId',info->>'expenseAccountId');RETURN NEW;
 END IF;
 SELECT * INTO a FROM public.fixed_assets WHERE company_id=NEW.company_id AND id=p->>'assetId' FOR UPDATE;
 IF a.id IS NULL OR NOT a.active OR NOT EXISTS(SELECT 1 FROM public.documents WHERE company_id=a.company_id AND id=a.id AND status='posted' AND date<=NEW.date) THEN RAISE EXCEPTION 'ASSET_INACTIVE';END IF;
 IF EXISTS(SELECT 1 FROM public.resource_denials WHERE company_id=NEW.company_id AND user_id=NEW.prepared_by AND resource_type='account' AND resource_id IN(a.cost_account,a.accumulated_account,a.expense_account)) THEN RAISE EXCEPTION 'RESOURCE_DENIED';END IF;
 IF EXISTS(SELECT 1 FROM public.asset_events e JOIN public.documents d ON d.company_id=e.company_id AND d.id=e.document_id WHERE e.company_id=a.company_id AND e.asset_id=a.id AND(d.status='pending' OR(e.kind IN('asset_disposal','asset_cancellation') AND d.status='posted'))) THEN RAISE EXCEPTION 'ASSET_PENDING';END IF;
 SELECT max(e.date),coalesce(sum(e.depreciation_minor),0) INTO last_date,posted FROM public.asset_events e JOIN public.documents d ON d.company_id=e.company_id AND d.id=e.document_id WHERE e.company_id=a.company_id AND e.asset_id=a.id AND d.status='posted';
 IF last_date IS NOT NULL AND NEW.date<=last_date THEN RAISE EXCEPTION 'ASSET_DATE';END IF;
 IF NEW.kind='asset_cancellation' THEN
  IF last_date IS NOT NULL OR EXISTS(SELECT 1 FROM public.document_allocations x JOIN public.documents d ON d.company_id=x.company_id AND d.id=x.settlement_id WHERE x.company_id=a.company_id AND x.target_id=a.id AND d.status IN('pending','posted')) THEN RAISE EXCEPTION 'ASSET_HAS_ACTIVITY';END IF;
  IF NEW.amount_minor!=a.cost_minor OR NEW.party_id IS DISTINCT FROM(SELECT party_id FROM public.documents WHERE company_id=a.company_id AND id=a.id) THEN RAISE EXCEPTION 'INVALID_ASSET';END IF;
  INSERT INTO public.asset_events(company_id,asset_id,document_id,kind,date,depreciation_minor) VALUES(a.company_id,a.id,NEW.id,NEW.kind,NEW.date,0);RETURN NEW;
 END IF;
 due:=public.saven_asset_cumulative(a.cost_minor,a.residual_minor,a.in_service_date,a.life_months,NEW.date);charge:=due-posted;
 IF charge<0 OR NEW.kind='asset_depreciation' AND(charge=0 OR NEW.amount_minor!=charge) THEN RAISE EXCEPTION 'NO_DEPRECIATION';END IF;
 IF NEW.kind='asset_disposal' THEN proceeds:=(p->>'proceeds')::numeric*100;gain:=proceeds-(a.cost_minor-due);IF proceeds<0 OR NEW.amount_minor!=greatest(a.cost_minor,proceeds) THEN RAISE EXCEPTION 'INVALID_ASSET';END IF;END IF;
 IF (NEW.preview_json::jsonb->'asset'->>'charge')::numeric*100 IS DISTINCT FROM charge THEN RAISE EXCEPTION 'ASSET_CHANGED';END IF;
 INSERT INTO public.asset_events(company_id,asset_id,document_id,kind,date,depreciation_minor,proceeds_minor,gain_minor) VALUES(a.company_id,a.id,NEW.id,NEW.kind,NEW.date,charge,proceeds,gain);RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION saven_asset_document() FROM PUBLIC;
CREATE TRIGGER asset_document AFTER INSERT OR UPDATE ON documents FOR EACH ROW EXECUTE FUNCTION saven_asset_document();
CREATE FUNCTION saven_asset_cancel_complete() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
 IF NEW.kind='asset_cancellation' AND NEW.status='posted' AND NOT EXISTS(SELECT 1 FROM public.document_allocations WHERE company_id=NEW.company_id AND settlement_id=NEW.id AND target_id=NEW.payload_json::jsonb->>'assetId' AND amount_minor=NEW.amount_minor) THEN RAISE EXCEPTION 'ALLOCATION_REQUIRED';END IF;RETURN NEW;
END $$;
CREATE TRIGGER asset_cancel_complete BEFORE UPDATE ON documents FOR EACH ROW EXECUTE FUNCTION saven_asset_cancel_complete();
DO $$ DECLARE definition text;BEGIN
 definition:=pg_get_functiondef('public.saven_publish_approval_policy(text,jsonb,bigint,text)'::regprocedure);IF position('NOT IN(''*'',''payment_entry''' IN definition)=0 THEN RAISE EXCEPTION 'POLICY_MIGRATION_MISMATCH';END IF;EXECUTE replace(definition,'NOT IN(''*'',''payment_entry''','NOT IN(''*'',''asset_acquisition'',''asset_depreciation'',''asset_disposal'',''asset_cancellation'',''payment_entry''');
 definition:=pg_get_functiondef('public.saven_allocation_control()'::regprocedure);definition:=replace(definition,'target.kind IN(''bill'',''opening_payable'')','target.kind IN(''bill'',''opening_payable'',''asset_acquisition'')');definition:=replace(definition,'(settlement.kind=''supplier_credit'' AND target.kind=''bill'')','(settlement.kind=''supplier_credit'' AND target.kind=''bill'') OR(settlement.kind=''asset_cancellation'' AND target.kind=''asset_acquisition'')');EXECUTE definition;
 definition:=pg_get_functiondef('public.saven_accounting_admin(text,text,jsonb,bigint,text)'::regprocedure);
 EXECUTE replace(definition,'IF action=''account_update'' THEN','IF action=''account_update'' THEN IF (p->>''active'')::boolean=false AND EXISTS(SELECT 1 FROM public.fixed_assets f JOIN public.documents d ON d.company_id=f.company_id AND d.id=f.id WHERE f.company_id=cid AND f.active AND d.status IN(''pending'',''posted'') AND p->>''id'' IN(f.cost_account,f.accumulated_account,f.expense_account) AND NOT EXISTS(SELECT 1 FROM public.asset_events e JOIN public.documents x ON x.company_id=e.company_id AND x.id=e.document_id WHERE e.company_id=f.company_id AND e.asset_id=f.id AND x.status=''posted'' AND e.kind IN(''asset_disposal'',''asset_cancellation''))) THEN RAISE EXCEPTION ''ACCOUNT_IN_USE'';END IF;');
END $$;
INSERT INTO schema_version(version) VALUES(13);
COMMIT;
