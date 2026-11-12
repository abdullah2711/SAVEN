BEGIN;
-- Replace the foundation's two-kind constraints without depending on generated
-- names. Other document checks and foreign keys remain in place.
DO $$ DECLARE c record; BEGIN
 FOR c IN SELECT conname FROM pg_constraint WHERE conrelid='public.documents'::regclass AND contype='c' AND pg_get_constraintdef(oid) LIKE '%kind%' LOOP
  EXECUTE format('ALTER TABLE public.documents DROP CONSTRAINT %I',c.conname);
 END LOOP;
END $$;
ALTER TABLE documents ADD CONSTRAINT supported_document_kind CHECK(kind IN ('invoice','stock_issue','bill','receipt','payment','journal'));
ALTER TABLE documents ADD CONSTRAINT document_subject CHECK(
 (kind IN('invoice','bill','receipt','payment') AND party_id IS NOT NULL AND item_id IS NULL AND quantity IS NULL)
 OR (kind='stock_issue' AND item_id IS NOT NULL AND party_id IS NULL AND quantity>0)
 OR (kind='journal' AND party_id IS NULL AND item_id IS NULL AND quantity IS NULL));

CREATE TABLE document_allocations(
 company_id text NOT NULL,
 settlement_id text NOT NULL,
 target_id text NOT NULL,
 amount_minor bigint NOT NULL CHECK(amount_minor>0 AND amount_minor<=999999999999),
 PRIMARY KEY(company_id,settlement_id),
 FOREIGN KEY(company_id,settlement_id) REFERENCES documents(company_id,id),
 FOREIGN KEY(company_id,target_id) REFERENCES documents(company_id,id),
 CHECK(settlement_id!=target_id)
);
CREATE INDEX allocations_target ON document_allocations(company_id,target_id);
ALTER TABLE document_allocations ENABLE ROW LEVEL SECURITY;
ALTER TABLE document_allocations FORCE ROW LEVEL SECURITY;
CREATE POLICY company_scope ON document_allocations USING(public.saven_member(company_id));
GRANT SELECT,INSERT ON document_allocations TO saven_app;

CREATE FUNCTION saven_allocation_control() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
DECLARE target public.documents%ROWTYPE; settlement public.documents%ROWTYPE; used bigint;
BEGIN
 -- The company lock is shared with all normal posting commands, including
 -- independently racing settlement submissions and review decisions.
 PERFORM 1 FROM public.companies WHERE id=NEW.company_id FOR UPDATE;
 SELECT * INTO target FROM public.documents WHERE company_id=NEW.company_id AND id=NEW.target_id;
 SELECT * INTO settlement FROM public.documents WHERE company_id=NEW.company_id AND id=NEW.settlement_id;
 IF target.id IS NULL OR settlement.id IS NULL OR target.status!='posted' OR settlement.status!='pending'
   OR NOT ((settlement.kind='receipt' AND target.kind='invoice') OR (settlement.kind='payment' AND target.kind='bill'))
   OR target.party_id!=settlement.party_id OR settlement.date<target.date OR settlement.amount_minor!=NEW.amount_minor
   OR (target.kind='invoice' AND coalesce(target.payload_json::jsonb->>'settlement','')!='credit')
 THEN RAISE EXCEPTION 'SETTLEMENT_TARGET'; END IF;
 SELECT coalesce(sum(a.amount_minor),0) INTO used FROM public.document_allocations a JOIN public.documents s ON s.company_id=a.company_id AND s.id=a.settlement_id WHERE a.company_id=NEW.company_id AND a.target_id=NEW.target_id AND s.status IN('pending','posted');
 IF used+NEW.amount_minor>target.amount_minor THEN RAISE EXCEPTION 'OVER_ALLOCATION'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER allocation_control BEFORE INSERT ON document_allocations FOR EACH ROW EXECUTE FUNCTION saven_allocation_control();
CREATE TRIGGER allocation_no_update BEFORE UPDATE ON document_allocations FOR EACH ROW EXECUTE FUNCTION saven_immutable('ALLOCATION_IMMUTABLE');
CREATE TRIGGER allocation_no_delete BEFORE DELETE ON document_allocations FOR EACH ROW EXECUTE FUNCTION saven_immutable('ALLOCATION_IMMUTABLE');

CREATE OR REPLACE FUNCTION saven_document_review() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF OLD.status!='pending' OR (to_jsonb(NEW)-ARRAY['status','reviewed_by','version']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['status','reviewed_by','version']) OR
   NEW.status NOT IN('posted','rejected') OR NEW.reviewed_by IS NULL OR NEW.reviewed_by=OLD.prepared_by OR NEW.version!=OLD.version+1 THEN RAISE EXCEPTION 'DOCUMENT_IMMUTABLE'; END IF;
 IF EXISTS(SELECT 1 FROM resource_denials d WHERE d.company_id=NEW.company_id AND d.user_id=NEW.reviewed_by AND
   ((d.resource_type='party' AND d.resource_id=NEW.party_id) OR (d.resource_type='item' AND d.resource_id=NEW.item_id) OR
    (d.resource_type='account' AND d.resource_id IN(SELECT value->>'accountId' FROM jsonb_array_elements(NEW.preview_json::jsonb->'lines'))))) THEN RAISE EXCEPTION 'RESOURCE_DENIED'; END IF;
 IF NEW.kind IN('receipt','payment') AND NOT EXISTS(SELECT 1 FROM document_allocations WHERE company_id=NEW.company_id AND settlement_id=NEW.id) THEN RAISE EXCEPTION 'ALLOCATION_REQUIRED'; END IF;
 IF NEW.status='posted' AND NOT EXISTS(SELECT 1 FROM journals WHERE company_id=NEW.company_id AND document_id=NEW.id AND status='posted' AND date=NEW.date) THEN RAISE EXCEPTION 'JOURNAL_REQUIRED'; END IF;
 RETURN NEW;
END $$;
INSERT INTO schema_version(version) VALUES(4);
COMMIT;
