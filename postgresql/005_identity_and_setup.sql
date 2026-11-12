BEGIN;
ALTER TABLE memberships ADD COLUMN active bigint NOT NULL DEFAULT 1 CHECK(active IN(0,1));
ALTER TABLE companies ADD COLUMN address text NOT NULL DEFAULT '';
ALTER TABLE companies ADD COLUMN tax_number text NOT NULL DEFAULT '';
ALTER TABLE companies ADD COLUMN timezone text NOT NULL DEFAULT 'Asia/Karachi';
ALTER TABLE companies ADD COLUMN is_demo bigint NOT NULL DEFAULT 0 CHECK(is_demo IN(0,1));
UPDATE companies SET is_demo=1 WHERE id IN('alpha','beta');
ALTER TABLE parties ADD COLUMN kind text NOT NULL DEFAULT 'customer' CHECK(kind IN('customer','supplier','both'));
ALTER TABLE parties ADD COLUMN email text NOT NULL DEFAULT '';
ALTER TABLE parties ADD COLUMN phone text NOT NULL DEFAULT '';
ALTER TABLE parties ADD COLUMN address text NOT NULL DEFAULT '';
ALTER TABLE parties ADD COLUMN tax_number text NOT NULL DEFAULT '';
ALTER TABLE accounts ADD COLUMN category text NOT NULL DEFAULT 'general' CHECK(category IN('general','cash_bank','receivable','payable','inventory'));
UPDATE accounts SET category=CASE WHEN id IN('cash','bank') THEN 'cash_bank' WHEN id='receivable' THEN 'receivable' WHEN id='inventory' THEN 'inventory' ELSE 'general' END;
INSERT INTO accounts(company_id,id,code,name,kind,category) SELECT c.id,a.id,a.code,a.name,a.kind,a.category FROM companies c CROSS JOIN(VALUES
 ('payable','2100','Trade payables','liability','payable'),('opening_equity','3000','Opening balance equity','equity','general'),('input_tax','1300','Recoverable input tax','asset','general'),('output_tax','2200','Output tax payable','liability','general'))a(id,code,name,kind,category) ON CONFLICT DO NOTHING;
CREATE UNIQUE INDEX users_email_folded ON users(lower(email));

CREATE TABLE user_credentials(user_id text PRIMARY KEY REFERENCES users(id),encoded text NOT NULL CHECK(encoded ~ '^scrypt\$1\$32768\$8\$1\$[a-f0-9]{32}\$[a-f0-9]{128}$'),version bigint NOT NULL DEFAULT 1,changed_at bigint NOT NULL);
CREATE TABLE auth_limits(key_hash text PRIMARY KEY,window_start bigint NOT NULL,attempts bigint NOT NULL);
CREATE TABLE membership_invitations(id text PRIMARY KEY DEFAULT gen_random_uuid()::text,company_id text NOT NULL REFERENCES companies(id),user_id text NOT NULL REFERENCES users(id),email text NOT NULL,role text NOT NULL CHECK(role IN('admin','preparer','approver','viewer')),token_hash text NOT NULL UNIQUE,created_by text NOT NULL REFERENCES users(id),created_at bigint NOT NULL,expires_at bigint NOT NULL,accepted_at bigint,revoked bigint NOT NULL DEFAULT 0 CHECK(revoked IN(0,1)));
ALTER TABLE membership_invitations ENABLE ROW LEVEL SECURITY;
-- No runtime table policy: only the audited functions below can read/accept it.
CREATE TABLE security_events(id text PRIMARY KEY DEFAULT gen_random_uuid()::text,user_id text NOT NULL REFERENCES users(id),event_type text NOT NULL,details_json jsonb NOT NULL DEFAULT '{}'::jsonb,created_at bigint NOT NULL);
CREATE TABLE configuration_events(id text PRIMARY KEY DEFAULT gen_random_uuid()::text,company_id text NOT NULL REFERENCES companies(id),actor_id text NOT NULL REFERENCES users(id),entity_type text NOT NULL,entity_id text NOT NULL,command_key text NOT NULL,payload_hash text NOT NULL,data_json jsonb NOT NULL,result_json jsonb NOT NULL,created_at bigint NOT NULL,UNIQUE(company_id,command_key));
ALTER TABLE user_credentials ENABLE ROW LEVEL SECURITY;
CREATE POLICY own_credentials ON user_credentials USING(user_id=saven_actor());
ALTER TABLE auth_limits ENABLE ROW LEVEL SECURITY;
ALTER TABLE security_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY own_security_events ON security_events USING(user_id=saven_actor());
ALTER TABLE configuration_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE configuration_events FORCE ROW LEVEL SECURITY;
CREATE POLICY company_scope ON configuration_events USING(saven_member(company_id));
CREATE TRIGGER security_no_update BEFORE UPDATE ON security_events FOR EACH ROW EXECUTE FUNCTION saven_immutable('AUDIT_IMMUTABLE');
CREATE TRIGGER security_no_delete BEFORE DELETE ON security_events FOR EACH ROW EXECUTE FUNCTION saven_immutable('AUDIT_IMMUTABLE');
CREATE TRIGGER configuration_no_update BEFORE UPDATE ON configuration_events FOR EACH ROW EXECUTE FUNCTION saven_immutable('AUDIT_IMMUTABLE');
CREATE TRIGGER configuration_no_delete BEFORE DELETE ON configuration_events FOR EACH ROW EXECUTE FUNCTION saven_immutable('AUDIT_IMMUTABLE');
GRANT SELECT ON user_credentials,security_events,configuration_events TO saven_app;

CREATE OR REPLACE FUNCTION saven_member(cid text) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 SELECT EXISTS(SELECT 1 FROM public.memberships m JOIN public.companies c ON c.id=m.company_id WHERE m.company_id=cid AND m.user_id=public.saven_actor() AND m.active=1 AND c.status='active')
$$;
CREATE OR REPLACE FUNCTION saven_visible_user(uid text) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 SELECT uid=public.saven_actor() OR uid=public.saven_grant_actor() OR EXISTS(SELECT 1 FROM public.memberships a JOIN public.memberships b ON b.company_id=a.company_id WHERE a.user_id=public.saven_actor() AND a.active=1 AND b.user_id=uid)
$$;
CREATE FUNCTION saven_auth_limit(p_key text,p_max bigint,p_window bigint) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE current_window bigint; n bigint;
BEGIN
 IF p_key !~ '^[a-f0-9]{64}$' OR p_max NOT BETWEEN 1 AND 1000 OR p_window NOT BETWEEN 60 AND 86400 THEN RAISE EXCEPTION 'INVALID_LIMIT'; END IF;
 current_window:=floor(extract(epoch FROM clock_timestamp())/p_window)*p_window;
 INSERT INTO public.auth_limits(key_hash,window_start,attempts) VALUES(p_key,current_window,1) ON CONFLICT(key_hash) DO UPDATE SET window_start=excluded.window_start,attempts=CASE WHEN auth_limits.window_start=excluded.window_start THEN least(auth_limits.attempts+1,1001) ELSE 1 END RETURNING attempts INTO n;
 RETURN n<=p_max;
END $$;
CREATE FUNCTION saven_auth_candidate(p_email text) RETURNS TABLE(user_id text,encoded text) LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 SELECT u.id,c.encoded FROM public.users u JOIN public.user_credentials c ON c.user_id=u.id WHERE lower(u.email)=p_email AND u.active=1 AND length(p_email)<=254
$$;
CREATE FUNCTION saven_bootstrap_allowed(p_user text) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 SELECT p_user=public.saven_grant_actor() AND NOT EXISTS(SELECT 1 FROM public.user_credentials WHERE user_id=p_user)
$$;
CREATE FUNCTION saven_password_session(p_email text,p_encoded text,p_hash text,p_expiry bigint) RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE uid text;
BEGIN
 IF p_hash !~ '^[a-f0-9]{64}$' OR p_expiry NOT BETWEEN extract(epoch FROM clock_timestamp())::bigint+60 AND extract(epoch FROM clock_timestamp())::bigint+29000 THEN RAISE EXCEPTION 'INVALID_SESSION'; END IF;
 SELECT u.id INTO uid FROM public.users u JOIN public.user_credentials c ON c.user_id=u.id WHERE lower(u.email)=p_email AND u.active=1 AND c.encoded=p_encoded FOR UPDATE OF c;
 IF uid IS NULL THEN RAISE EXCEPTION 'STALE_CREDENTIAL'; END IF;
 INSERT INTO public.sessions(token_hash,user_id,expires_at) VALUES(p_hash,uid,p_expiry) ON CONFLICT(user_id) DO UPDATE SET token_hash=excluded.token_hash,expires_at=excluded.expires_at;
 INSERT INTO public.security_events(user_id,event_type,created_at) VALUES(uid,'password_sign_in',extract(epoch FROM clock_timestamp())::bigint);
 RETURN uid;
END $$;
CREATE FUNCTION saven_set_password(p_version bigint,p_encoded text,p_old_hash text,p_new_hash text,p_expiry bigint) RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE uid text; current_version bigint;
BEGIN
 uid:=public.saven_actor();
 IF uid IS NULL OR p_old_hash IS DISTINCT FROM current_setting('saven.session_hash',true) OR p_new_hash !~ '^[a-f0-9]{64}$' OR p_expiry NOT BETWEEN extract(epoch FROM clock_timestamp())::bigint+60 AND extract(epoch FROM clock_timestamp())::bigint+29000 THEN RAISE EXCEPTION 'STALE_CREDENTIAL'; END IF;
 PERFORM 1 FROM public.sessions WHERE token_hash=p_old_hash AND user_id=uid FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'STALE_CREDENTIAL'; END IF;
 SELECT version INTO current_version FROM public.user_credentials WHERE user_id=uid FOR UPDATE;
 IF coalesce(current_version,0)!=p_version THEN RAISE EXCEPTION 'STALE_CREDENTIAL'; END IF;
 INSERT INTO public.user_credentials(user_id,encoded,changed_at) VALUES(uid,p_encoded,extract(epoch FROM clock_timestamp())::bigint) ON CONFLICT(user_id) DO UPDATE SET encoded=excluded.encoded,version=user_credentials.version+1,changed_at=excluded.changed_at;
 UPDATE public.sessions SET token_hash=p_new_hash,expires_at=p_expiry WHERE user_id=uid;
 DELETE FROM public.login_grants WHERE user_id=uid;
 INSERT INTO public.security_events(user_id,event_type,created_at) VALUES(uid,'password_changed',extract(epoch FROM clock_timestamp())::bigint);
 RETURN uid;
END $$;
CREATE FUNCTION saven_set_profile(p_name text,p_email text,p_new_hash text,p_expiry bigint) RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE uid text; old_profile jsonb;
BEGIN
 uid:=public.saven_actor();
 IF uid IS NULL OR length(btrim(p_name)) NOT BETWEEN 1 AND 160 OR length(p_email)>254 OR p_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' OR p_new_hash !~ '^[a-f0-9]{64}$' OR p_expiry NOT BETWEEN extract(epoch FROM clock_timestamp())::bigint+60 AND extract(epoch FROM clock_timestamp())::bigint+29000 THEN RAISE EXCEPTION 'STALE_CREDENTIAL'; END IF;
 PERFORM 1 FROM public.sessions WHERE token_hash=current_setting('saven.session_hash',true) AND user_id=uid FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'STALE_CREDENTIAL'; END IF;
 SELECT jsonb_build_object('name',name,'email',email) INTO old_profile FROM public.users WHERE id=uid;
 UPDATE public.users SET name=p_name,email=p_email WHERE id=uid;
 UPDATE public.sessions SET token_hash=p_new_hash,expires_at=p_expiry WHERE user_id=uid;
 INSERT INTO public.security_events(user_id,event_type,details_json,created_at) VALUES(uid,'profile_changed',jsonb_build_object('before',old_profile,'after',jsonb_build_object('name',p_name,'email',p_email)),extract(epoch FROM clock_timestamp())::bigint);
 RETURN uid;
END $$;

CREATE FUNCTION saven_configure(p_company text,p_entity text,p_data jsonb,p_revision bigint,p_key text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE actor text; actor_role text; company_revision bigint; fingerprint text; previous public.configuration_events%ROWTYPE; entity_id text; result jsonb;
BEGIN
 actor:=public.saven_actor();
 SELECT m.role INTO actor_role FROM public.memberships m JOIN public.companies c ON c.id=m.company_id WHERE m.company_id=p_company AND m.user_id=actor AND m.active=1 AND c.status='active';
 IF actor_role IS NULL OR actor_role NOT IN('owner','admin') THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
 IF p_key !~ '^[a-zA-Z0-9_-]{16,128}$' THEN RAISE EXCEPTION 'IDEMPOTENCY_REQUIRED'; END IF;
 fingerprint:=encode(sha256(convert_to(p_entity||p_data::text,'UTF8')),'hex');
 SELECT * INTO previous FROM public.configuration_events WHERE company_id=p_company AND command_key=p_key;
 IF FOUND THEN
   IF previous.actor_id!=actor OR previous.payload_hash!=fingerprint THEN RAISE EXCEPTION 'IDEMPOTENCY_CONFLICT'; END IF;
   RETURN previous.result_json||'{"replayed":true}'::jsonb;
 END IF;
 SELECT revision INTO company_revision FROM public.companies WHERE id=p_company FOR UPDATE;
 IF company_revision!=p_revision THEN RAISE EXCEPTION 'STALE_PREVIEW'; END IF;
 entity_id:=gen_random_uuid()::text;
 CASE p_entity
 WHEN 'party' THEN
   INSERT INTO public.parties(company_id,id,name,kind,email,phone,address,tax_number) VALUES(p_company,entity_id,p_data->>'name',p_data->>'kind',coalesce(p_data->>'email',''),coalesce(p_data->>'phone',''),coalesce(p_data->>'address',''),coalesce(p_data->>'taxNumber',''));
 WHEN 'account' THEN
   INSERT INTO public.accounts(company_id,id,code,name,kind,category) VALUES(p_company,entity_id,p_data->>'code',p_data->>'name',p_data->>'kind',p_data->>'category');
 WHEN 'item' THEN
   INSERT INTO public.items(company_id,id,name,store,unit,on_hand,reserved,unit_cost_minor,inventory_account,expense_account) VALUES(p_company,entity_id,p_data->>'name',p_data->>'store',p_data->>'unit',0,0,(p_data->>'unitCostMinor')::bigint,p_data->>'inventoryAccountId',p_data->>'expenseAccountId');
 WHEN 'company' THEN
   UPDATE public.companies SET name=p_data->>'name',address=coalesce(p_data->>'address',''),tax_number=coalesce(p_data->>'taxNumber','') WHERE id=p_company;
   entity_id:=p_company;
 WHEN 'period' THEN
   IF actor_role!='owner' THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
   IF EXISTS(SELECT 1 FROM public.periods WHERE company_id=p_company AND start_date=p_data->>'startDate' AND end_date=p_data->>'endDate') THEN
     UPDATE public.periods SET locked=(p_data->>'locked')::bigint WHERE company_id=p_company AND start_date=p_data->>'startDate';
   ELSE
     IF EXISTS(SELECT 1 FROM public.periods WHERE company_id=p_company AND start_date<=p_data->>'endDate' AND end_date>=p_data->>'startDate') THEN RAISE EXCEPTION 'PERIOD_OVERLAP'; END IF;
     INSERT INTO public.periods(company_id,start_date,end_date,locked) VALUES(p_company,p_data->>'startDate',p_data->>'endDate',(p_data->>'locked')::bigint);
   END IF;
   entity_id:=p_data->>'startDate';
 WHEN 'membership' THEN
   IF actor_role!='owner' THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
   IF NOT EXISTS(SELECT 1 FROM public.memberships WHERE company_id=p_company AND user_id=p_data->>'userId' AND role!='owner') THEN RAISE EXCEPTION 'OWNER_PROTECTED'; END IF;
   UPDATE public.memberships SET role=p_data->>'role',active=(p_data->>'active')::bigint WHERE company_id=p_company AND user_id=p_data->>'userId';
   entity_id:=p_data->>'userId';
 ELSE RAISE EXCEPTION 'INVALID_CONFIGURATION';
 END CASE;
 result:=jsonb_build_object('id',entity_id,'entity',p_entity,'revision',company_revision+1);
 INSERT INTO public.configuration_events(company_id,actor_id,entity_type,entity_id,command_key,payload_hash,data_json,result_json,created_at) VALUES(p_company,actor,p_entity,entity_id,p_key,fingerprint,p_data,result,extract(epoch FROM clock_timestamp())::bigint);
 UPDATE public.companies SET revision=revision+1 WHERE id=p_company;
 RETURN result;
END $$;

CREATE FUNCTION saven_create_company(p_id text,p_data jsonb,p_key text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE actor text; result jsonb; fingerprint text; previous public.configuration_events%ROWTYPE;
BEGIN
 actor:=public.saven_actor();
 IF actor IS NULL OR NOT EXISTS(SELECT 1 FROM public.memberships WHERE user_id=actor AND role='owner' AND active=1) THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
 IF p_id !~ '^[a-zA-Z0-9_-]{16,80}$' OR p_key !~ '^[a-zA-Z0-9_-]{16,128}$' THEN RAISE EXCEPTION 'INVALID_COMPANY'; END IF;
 fingerprint:=encode(sha256(convert_to(p_data::text,'UTF8')),'hex');
 SELECT * INTO previous FROM public.configuration_events WHERE company_id=p_id AND command_key=p_key AND actor_id=actor;
 IF FOUND THEN IF previous.payload_hash!=fingerprint THEN RAISE EXCEPTION 'IDEMPOTENCY_CONFLICT'; END IF; RETURN previous.result_json||'{"replayed":true}'::jsonb; END IF;
 IF (SELECT count(*) FROM public.memberships WHERE user_id=actor AND role='owner')>=10 THEN RAISE EXCEPTION 'TESTING_COMPANY_LIMIT'; END IF;
 INSERT INTO public.companies(id,name,currency,address,tax_number) VALUES(p_id,p_data->>'name','PKR',coalesce(p_data->>'address',''),coalesce(p_data->>'taxNumber',''));
 INSERT INTO public.memberships(company_id,user_id,role) VALUES(p_id,actor,'owner');
 INSERT INTO public.periods(company_id,start_date,end_date) VALUES(p_id,p_data->>'startDate',p_data->>'endDate');
 INSERT INTO public.accounts(company_id,id,code,name,kind,category) SELECT p_id,a.id,a.code,a.name,a.kind,a.category FROM(VALUES
   ('cash','1000','Cash in hand','asset','cash_bank'),('bank','1010','Operating bank','asset','cash_bank'),('receivable','1100','Trade receivables','asset','receivable'),('inventory','1200','Inventory','asset','inventory'),('input_tax','1300','Recoverable input tax','asset','general'),('payable','2100','Trade payables','liability','payable'),('output_tax','2200','Output tax payable','liability','general'),('opening_equity','3000','Opening balance equity','equity','general'),('revenue','4000','Sales and service revenue','income','general'),('expense','5000','Operating expenses','expense','general'))a(id,code,name,kind,category);
 result:=jsonb_build_object('id',p_id,'revision',1);
 INSERT INTO public.configuration_events(company_id,actor_id,entity_type,entity_id,command_key,payload_hash,data_json,result_json,created_at) VALUES(p_id,actor,'company_created',p_id,p_key,fingerprint,p_data,result,extract(epoch FROM clock_timestamp())::bigint);
 RETURN result;
END $$;

CREATE FUNCTION saven_invite(p_company text,p_data jsonb,p_hash text,p_revision bigint,p_key text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE actor text; actor_role text; target text; target_role text; company_revision bigint; fingerprint text; previous public.configuration_events%ROWTYPE; expiry bigint; result jsonb; invitation_id text; existing_identity boolean;
BEGIN
 actor:=public.saven_actor();
 SELECT role INTO actor_role FROM public.memberships WHERE company_id=p_company AND user_id=actor AND active=1;
 IF actor_role IS NULL OR actor_role NOT IN('owner','admin') OR p_data->>'role' NOT IN('admin','preparer','approver','viewer') OR (p_data->>'role'='admin' AND actor_role!='owner') THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
 IF p_hash !~ '^[a-f0-9]{64}$' OR p_key !~ '^[a-zA-Z0-9_-]{16,128}$' THEN RAISE EXCEPTION 'INVALID_INVITATION'; END IF;
 fingerprint:=encode(sha256(convert_to(p_data::text||p_hash,'UTF8')),'hex');
 SELECT * INTO previous FROM public.configuration_events WHERE company_id=p_company AND command_key=p_key;
 IF FOUND THEN IF previous.actor_id!=actor OR previous.payload_hash!=fingerprint THEN RAISE EXCEPTION 'IDEMPOTENCY_CONFLICT'; END IF; RETURN previous.result_json||'{"replayed":true}'::jsonb; END IF;
 SELECT revision INTO company_revision FROM public.companies WHERE id=p_company AND status='active' FOR UPDATE;
 IF company_revision IS NULL OR company_revision!=p_revision THEN RAISE EXCEPTION 'STALE_PREVIEW'; END IF;
 SELECT id INTO target FROM public.users WHERE lower(email)=p_data->>'email' AND active=1;
 existing_identity:=target IS NOT NULL;
 IF target IS NULL THEN
   target:=gen_random_uuid()::text;
   INSERT INTO public.users(id,email,name) VALUES(target,p_data->>'email',p_data->>'name');
 END IF;
 SELECT role INTO target_role FROM public.memberships WHERE company_id=p_company AND user_id=target;
 IF target_role='owner' OR (target_role='admin' AND actor_role!='owner') THEN RAISE EXCEPTION 'OWNER_PROTECTED'; END IF;
 expiry:=extract(epoch FROM clock_timestamp())::bigint+86400;
 IF existing_identity THEN
   -- Company administrators cannot reset a global identity. Existing people
   -- must authenticate as themselves and explicitly accept the new membership.
   invitation_id:=gen_random_uuid()::text;
   INSERT INTO public.membership_invitations(id,company_id,user_id,email,role,token_hash,created_by,created_at,expires_at) VALUES(invitation_id,p_company,target,p_data->>'email',p_data->>'role',p_hash,actor,extract(epoch FROM clock_timestamp())::bigint,expiry);
 ELSE
   INSERT INTO public.memberships(company_id,user_id,role) VALUES(p_company,target,p_data->>'role');
   INSERT INTO public.login_grants(token_hash,user_id,expires_at) VALUES(p_hash,target,expiry);
   invitation_id:=target;
 END IF;
 result:=jsonb_build_object('id',invitation_id,'role',p_data->>'role','expiresAt',expiry,'revision',company_revision+1,'requiresSignIn',existing_identity);
 INSERT INTO public.configuration_events(company_id,actor_id,entity_type,entity_id,command_key,payload_hash,data_json,result_json,created_at) VALUES(p_company,actor,'user_invited',invitation_id,p_key,fingerprint,jsonb_build_object('role',p_data->>'role'),result,extract(epoch FROM clock_timestamp())::bigint);
 UPDATE public.companies SET revision=revision+1 WHERE id=p_company;
 RETURN result;
END $$;
CREATE FUNCTION saven_invitation_preview(p_hash text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE invitation public.membership_invitations%ROWTYPE; actor text; company_name text;
BEGIN
 actor:=public.saven_actor();
 SELECT * INTO invitation FROM public.membership_invitations WHERE token_hash=p_hash AND user_id=actor AND revoked=0 AND expires_at>extract(epoch FROM clock_timestamp());
 IF NOT FOUND THEN RAISE EXCEPTION 'INVITATION_DENIED'; END IF;
 SELECT name INTO company_name FROM public.companies WHERE id=invitation.company_id AND status='active';
 IF company_name IS NULL THEN RAISE EXCEPTION 'INVITATION_DENIED'; END IF;
 RETURN jsonb_build_object('companyId',invitation.company_id,'companyName',company_name,'role',invitation.role,'expiresAt',invitation.expires_at,'mustSetPassword',NOT EXISTS(SELECT 1 FROM public.user_credentials WHERE user_id=actor),'accepted',invitation.accepted_at IS NOT NULL);
END $$;
CREATE FUNCTION saven_invitation_accept(p_hash text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE invitation public.membership_invitations%ROWTYPE; actor text; issuer_role text; current_role text; result jsonb;
BEGIN
 actor:=public.saven_actor();
 SELECT * INTO invitation FROM public.membership_invitations WHERE token_hash=p_hash AND user_id=actor AND revoked=0 AND expires_at>extract(epoch FROM clock_timestamp()) FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'INVITATION_DENIED'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.user_credentials WHERE user_id=actor) THEN RAISE EXCEPTION 'PASSWORD_REQUIRED'; END IF;
 IF invitation.accepted_at IS NOT NULL THEN RETURN jsonb_build_object('companyId',invitation.company_id,'replayed',true); END IF;
 SELECT role INTO issuer_role FROM public.memberships WHERE company_id=invitation.company_id AND user_id=invitation.created_by AND active=1;
 IF issuer_role IS NULL OR issuer_role NOT IN('owner','admin') OR (invitation.role='admin' AND issuer_role!='owner') THEN RAISE EXCEPTION 'INVITATION_DENIED'; END IF;
 SELECT role INTO current_role FROM public.memberships WHERE company_id=invitation.company_id AND user_id=actor;
 IF current_role='owner' OR (current_role='admin' AND issuer_role!='owner') THEN RAISE EXCEPTION 'OWNER_PROTECTED'; END IF;
 PERFORM 1 FROM public.companies WHERE id=invitation.company_id AND status='active' FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'INVITATION_DENIED'; END IF;
 INSERT INTO public.memberships(company_id,user_id,role) VALUES(invitation.company_id,actor,invitation.role) ON CONFLICT(company_id,user_id) DO UPDATE SET role=excluded.role,active=1;
 UPDATE public.membership_invitations SET accepted_at=extract(epoch FROM clock_timestamp())::bigint WHERE id=invitation.id;
 result:=jsonb_build_object('companyId',invitation.company_id,'role',invitation.role);
 INSERT INTO public.configuration_events(company_id,actor_id,entity_type,entity_id,command_key,payload_hash,data_json,result_json,created_at) VALUES(invitation.company_id,actor,'invitation_accepted',actor,p_hash,p_hash,jsonb_build_object('invitedBy',invitation.created_by,'role',invitation.role),result,extract(epoch FROM clock_timestamp())::bigint);
 UPDATE public.companies SET revision=revision+1 WHERE id=invitation.company_id;
 RETURN result;
END $$;
CREATE FUNCTION saven_pending_invitations(p_company text) RETURNS TABLE(id text,email text,role text,expires_at bigint) LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.memberships WHERE company_id=p_company AND user_id=public.saven_actor() AND active=1 AND memberships.role IN('owner','admin')) THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
 RETURN QUERY SELECT i.id,i.email,i.role,i.expires_at FROM public.membership_invitations i WHERE i.company_id=p_company AND i.accepted_at IS NULL AND i.revoked=0 AND i.expires_at>extract(epoch FROM clock_timestamp()) ORDER BY i.created_at DESC;
END $$;
REVOKE ALL ON FUNCTION saven_bootstrap_allowed(text),saven_invitation_preview(text),saven_invitation_accept(text),saven_pending_invitations(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION saven_bootstrap_allowed(text),saven_invitation_preview(text),saven_invitation_accept(text),saven_pending_invitations(text) TO saven_app;
REVOKE ALL ON FUNCTION saven_auth_limit(text,bigint,bigint),saven_auth_candidate(text),saven_password_session(text,text,text,bigint),saven_set_password(bigint,text,text,text,bigint),saven_configure(text,text,jsonb,bigint,text),saven_create_company(text,jsonb,text),saven_invite(text,jsonb,text,bigint,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION saven_set_profile(text,text,text,bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION saven_set_profile(text,text,text,bigint) TO saven_app;
GRANT EXECUTE ON FUNCTION saven_auth_limit(text,bigint,bigint),saven_auth_candidate(text),saven_password_session(text,text,text,bigint),saven_set_password(bigint,text,text,text,bigint),saven_configure(text,text,jsonb,bigint,text),saven_create_company(text,jsonb,text),saven_invite(text,jsonb,text,bigint,text) TO saven_app;
INSERT INTO schema_version(version) VALUES(3);
COMMIT;
