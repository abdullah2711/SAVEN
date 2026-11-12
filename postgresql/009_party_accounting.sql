BEGIN;
ALTER TABLE documents DROP CONSTRAINT supported_document_kind;
ALTER TABLE documents DROP CONSTRAINT document_subject;
ALTER TABLE documents ADD CONSTRAINT supported_document_kind CHECK(kind IN('invoice','stock_issue','bill','receipt','payment','journal','cash_transfer','cash_expense','cash_income','reversal','credit_note','supplier_credit'));
ALTER TABLE documents ADD CONSTRAINT document_subject CHECK(
 (kind IN('invoice','bill','receipt','payment','credit_note','supplier_credit') AND party_id IS NOT NULL AND item_id IS NULL AND quantity IS NULL)
 OR(kind='stock_issue' AND item_id IS NOT NULL AND party_id IS NULL AND quantity>0)
 OR(kind IN('journal','cash_transfer','cash_expense','cash_income','reversal') AND party_id IS NULL AND item_id IS NULL AND quantity IS NULL));
CREATE OR REPLACE FUNCTION saven_allocation_control() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
DECLARE target public.documents%ROWTYPE; settlement public.documents%ROWTYPE; used bigint;
BEGIN
 PERFORM 1 FROM public.companies WHERE id=NEW.company_id FOR UPDATE;
 SELECT * INTO target FROM public.documents WHERE company_id=NEW.company_id AND id=NEW.target_id;
 SELECT * INTO settlement FROM public.documents WHERE company_id=NEW.company_id AND id=NEW.settlement_id;
 IF target.id IS NULL OR settlement.id IS NULL OR target.status!='posted' OR settlement.status!='pending'
 OR NOT ((settlement.kind IN('receipt','credit_note') AND target.kind='invoice') OR(settlement.kind IN('payment','supplier_credit') AND target.kind='bill'))
 OR target.party_id!=settlement.party_id OR settlement.date<target.date OR settlement.amount_minor!=NEW.amount_minor
 OR(target.kind='invoice' AND coalesce(target.payload_json::jsonb->>'settlement','')!='credit') THEN RAISE EXCEPTION 'SETTLEMENT_TARGET'; END IF;
 SELECT coalesce(sum(a.amount_minor),0) INTO used FROM public.document_allocations a JOIN public.documents s ON s.company_id=a.company_id AND s.id=a.settlement_id WHERE a.company_id=NEW.company_id AND a.target_id=NEW.target_id AND s.status IN('pending','posted');
 IF used+NEW.amount_minor>target.amount_minor THEN RAISE EXCEPTION 'OVER_ALLOCATION'; END IF;
 RETURN NEW;
END $$;
CREATE FUNCTION saven_credit_allocation_required() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
BEGIN
 IF NEW.kind IN('credit_note','supplier_credit') AND NOT EXISTS(SELECT 1 FROM document_allocations WHERE company_id=NEW.company_id AND settlement_id=NEW.id) THEN RAISE EXCEPTION 'ALLOCATION_REQUIRED'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER credit_allocation_required BEFORE UPDATE ON documents FOR EACH ROW EXECUTE FUNCTION saven_credit_allocation_required();
INSERT INTO schema_version(version) VALUES(7);
COMMIT;
