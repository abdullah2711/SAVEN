export const identity=[`
CREATE TABLE users(id TEXT PRIMARY KEY, active INTEGER NOT NULL CHECK(active IN(0,1))) STRICT;
CREATE TABLE memberships(tenant_id TEXT NOT NULL, user_id TEXT NOT NULL REFERENCES users(id), active INTEGER NOT NULL CHECK(active IN(0,1)), PRIMARY KEY(tenant_id,user_id)) STRICT;
`];

export const commerce=[`CREATE TABLE entitlements(tenant_id TEXT PRIMARY KEY, version INTEGER NOT NULL, writes_until INTEGER NOT NULL, source TEXT NOT NULL) STRICT;`];
export const fleet=[`CREATE TABLE placements(tenant_id TEXT PRIMARY KEY, state TEXT NOT NULL CHECK(state IN('PROVISIONING','ACTIVE','QUARANTINED')), schema_version INTEGER NOT NULL, generation INTEGER NOT NULL) STRICT;`];
export const jobs=[`CREATE TABLE jobs(tenant_id TEXT NOT NULL, command_id TEXT NOT NULL, state TEXT NOT NULL CHECK(state IN('READY','RUNNING','DONE','FAILED')), attempts INTEGER NOT NULL DEFAULT 0, PRIMARY KEY(tenant_id,command_id)) STRICT;`];
export const tenant=[`
CREATE TABLE business(id TEXT PRIMARY KEY, state TEXT NOT NULL CHECK(state IN('PROVISIONING','ACTIVE'))) STRICT;
CREATE TABLE members(user_id TEXT PRIMARY KEY, active INTEGER NOT NULL CHECK(active IN(0,1))) STRICT;
CREATE TABLE roles(id TEXT PRIMARY KEY, name TEXT NOT NULL, protected INTEGER NOT NULL CHECK(protected IN(0,1)), permissions TEXT NOT NULL, CHECK((id='ultimate_business_admin' AND protected=1) OR (id<>'ultimate_business_admin' AND protected=0))) STRICT;
CREATE TABLE assignments(user_id TEXT NOT NULL REFERENCES members(user_id), role_id TEXT NOT NULL REFERENCES roles(id), PRIMARY KEY(user_id,role_id)) STRICT;
CREATE UNIQUE INDEX sole_ultimate_owner ON assignments(role_id) WHERE role_id='ultimate_business_admin';
CREATE TRIGGER owner_role_immutable_update BEFORE UPDATE ON roles WHEN OLD.protected=1 BEGIN SELECT RAISE(ABORT,'Protected role is immutable'); END;
CREATE TRIGGER owner_role_immutable_delete BEFORE DELETE ON roles WHEN OLD.protected=1 BEGIN SELECT RAISE(ABORT,'Protected role is immutable'); END;
CREATE TRIGGER owner_assignment_required BEFORE DELETE ON assignments WHEN OLD.role_id='ultimate_business_admin' AND (SELECT state FROM business)='ACTIVE' BEGIN SELECT RAISE(ABORT,'Active business must retain its owner'); END;
CREATE TRIGGER owner_must_remain_active BEFORE UPDATE OF active ON members WHEN NEW.active=0 AND EXISTS(SELECT 1 FROM assignments WHERE user_id=OLD.user_id AND role_id='ultimate_business_admin') BEGIN SELECT RAISE(ABORT,'Active owner required'); END;
CREATE TRIGGER activation_requires_owner BEFORE UPDATE OF state ON business WHEN NEW.state='ACTIVE' AND (SELECT count(*) FROM assignments a JOIN members m ON m.user_id=a.user_id WHERE a.role_id='ultimate_business_admin' AND m.active=1)<>1 BEGIN SELECT RAISE(ABORT,'Exactly one active owner required'); END;
CREATE TABLE denials(user_id TEXT NOT NULL REFERENCES members(user_id), action TEXT NOT NULL, PRIMARY KEY(user_id,action)) STRICT;
CREATE TABLE accounts(code TEXT PRIMARY KEY, title TEXT NOT NULL) STRICT;
CREATE TABLE periods(company TEXT NOT NULL, start_date TEXT NOT NULL, end_date TEXT NOT NULL, locked INTEGER NOT NULL CHECK(locked IN(0,1)), PRIMARY KEY(company,start_date)) STRICT;
CREATE TABLE command_inbox(id TEXT PRIMARY KEY, actor TEXT NOT NULL REFERENCES members(user_id), digest TEXT NOT NULL, payload TEXT NOT NULL, state TEXT NOT NULL CHECK(state IN('ACCEPTED_PENDING','AWAITING_APPROVAL','POSTED','FAILED')), lease_token TEXT, lease_until INTEGER, error TEXT, approved_by TEXT, created_at INTEGER NOT NULL) STRICT;
CREATE TABLE approval_requests(command_id TEXT PRIMARY KEY REFERENCES command_inbox(id), payload_digest TEXT NOT NULL, policy_snapshot TEXT NOT NULL, state TEXT NOT NULL CHECK(state IN('PENDING','APPROVED')), decided_by TEXT) STRICT;
CREATE TABLE journals(id TEXT PRIMARY KEY REFERENCES command_inbox(id), company TEXT NOT NULL, branch TEXT NOT NULL, posting_date TEXT NOT NULL, narrative TEXT NOT NULL) STRICT;
CREATE TABLE journal_lines(journal_id TEXT NOT NULL REFERENCES journals(id), line_no INTEGER NOT NULL, account TEXT NOT NULL REFERENCES accounts(code), debit INTEGER NOT NULL CHECK(debit>=0 AND debit<=999999999999), credit INTEGER NOT NULL CHECK(credit>=0 AND credit<=999999999999), CHECK((debit>0 AND credit=0) OR (credit>0 AND debit=0)), PRIMARY KEY(journal_id,line_no)) STRICT;
CREATE TABLE audit(id INTEGER PRIMARY KEY, command_id TEXT, actor TEXT NOT NULL, event TEXT NOT NULL, detail TEXT NOT NULL, happened_at INTEGER NOT NULL) STRICT;
CREATE TABLE outbox(id TEXT PRIMARY KEY REFERENCES command_inbox(id), event TEXT NOT NULL, state TEXT NOT NULL CHECK(state IN('READY','DELIVERED','FAILED')), attempts INTEGER NOT NULL DEFAULT 0) STRICT;
CREATE TRIGGER posted_journal_immutable BEFORE UPDATE ON journals BEGIN SELECT RAISE(ABORT,'Posted journal is immutable'); END;
CREATE TRIGGER posted_journal_no_delete BEFORE DELETE ON journals BEGIN SELECT RAISE(ABORT,'Posted journal is immutable'); END;
CREATE TRIGGER posted_line_immutable BEFORE UPDATE ON journal_lines BEGIN SELECT RAISE(ABORT,'Posted line is immutable'); END;
CREATE TRIGGER posted_line_no_delete BEFORE DELETE ON journal_lines BEGIN SELECT RAISE(ABORT,'Posted line is immutable'); END;
CREATE TRIGGER no_late_lines BEFORE INSERT ON journal_lines WHEN (SELECT state FROM command_inbox WHERE id=NEW.journal_id)='POSTED' BEGIN SELECT RAISE(ABORT,'Posted journal cannot receive more lines'); END;
CREATE TRIGGER audit_no_update BEFORE UPDATE ON audit BEGIN SELECT RAISE(ABORT,'Audit is immutable'); END;
CREATE TRIGGER audit_no_delete BEFORE DELETE ON audit BEGIN SELECT RAISE(ABORT,'Audit is immutable'); END;
CREATE TRIGGER command_payload_immutable BEFORE UPDATE OF actor,digest,payload,id ON command_inbox BEGIN SELECT RAISE(ABORT,'Accepted payload is immutable'); END;
CREATE TRIGGER command_no_delete BEFORE DELETE ON command_inbox BEGIN SELECT RAISE(ABORT,'Accepted command is retained'); END;
CREATE TRIGGER posted_state_final BEFORE UPDATE OF state ON command_inbox WHEN OLD.state='POSTED' AND NEW.state<>'POSTED' BEGIN SELECT RAISE(ABORT,'Posted state is final'); END;
CREATE TRIGGER posted_requires_effects BEFORE UPDATE OF state ON command_inbox WHEN NEW.state='POSTED' AND OLD.state<>'POSTED' BEGIN
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM journals WHERE id=NEW.id) OR (SELECT count(*) FROM journal_lines WHERE journal_id=NEW.id)<2 OR (SELECT sum(debit)-sum(credit) FROM journal_lines WHERE journal_id=NEW.id)<>0 OR (SELECT sum(debit) FROM journal_lines WHERE journal_id=NEW.id)>999999999999 OR NOT EXISTS(SELECT 1 FROM audit WHERE command_id=NEW.id AND event='JOURNAL_POSTED') OR NOT EXISTS(SELECT 1 FROM outbox WHERE id=NEW.id) THEN RAISE(ABORT,'Posting requires balanced source, audit and outbox') END;
END;
`];



// Append-only operational migrations. Version1 remains byte-for-byte compatible.
identity.push(`
CREATE TABLE credentials(user_id TEXT PRIMARY KEY REFERENCES users(id), email TEXT NOT NULL UNIQUE COLLATE NOCASE, encoded TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 1) STRICT;
CREATE TABLE sessions(token_hash TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),realm TEXT NOT NULL CHECK(realm IN('app','operator')),csrf_hash TEXT NOT NULL,expires_at INTEGER NOT NULL,credential_version INTEGER NOT NULL) STRICT;
CREATE INDEX user_sessions ON sessions(user_id,realm);
CREATE TABLE auth_limits(key TEXT PRIMARY KEY,attempts INTEGER NOT NULL,reset_at INTEGER NOT NULL) STRICT;
CREATE TABLE operator_staff(user_id TEXT PRIMARY KEY REFERENCES users(id),active INTEGER NOT NULL CHECK(active IN(0,1))) STRICT;
CREATE TABLE operator_scopes(user_id TEXT NOT NULL REFERENCES operator_staff(user_id),scope TEXT NOT NULL CHECK(scope IN('commercial.read','commercial.manage','fleet.read','staff.manage')),PRIMARY KEY(user_id,scope)) STRICT;
`);
jobs.push(`CREATE TABLE ai_requests(id TEXT PRIMARY KEY,user_id TEXT NOT NULL,tenant_id TEXT NOT NULL,company TEXT NOT NULL,question_digest TEXT NOT NULL,state TEXT NOT NULL CHECK(state IN('RUNNING','COMPLETED','FAILED')),created_at INTEGER NOT NULL,model TEXT,input_tokens INTEGER,output_tokens INTEGER) STRICT;`);
fleet.push(`CREATE TABLE migration_events(id INTEGER PRIMARY KEY,tenant_id TEXT NOT NULL,from_version INTEGER NOT NULL,to_version INTEGER NOT NULL,state TEXT NOT NULL CHECK(state IN('SUCCEEDED','QUARANTINED')),detail TEXT NOT NULL,happened_at INTEGER NOT NULL) STRICT;`);
commerce.push(`
CREATE TABLE subscriber_accounts(tenant_id TEXT PRIMARY KEY,name TEXT NOT NULL,owner_id TEXT NOT NULL,state TEXT NOT NULL CHECK(state IN('PROVISIONING','ACTIVE','QUARANTINED')),created_at INTEGER NOT NULL) STRICT;
CREATE TABLE commercial_audit(id INTEGER PRIMARY KEY,actor TEXT NOT NULL,event TEXT NOT NULL,detail TEXT NOT NULL,happened_at INTEGER NOT NULL) STRICT;
`);
tenant.push(`
CREATE TABLE company_profiles(id TEXT PRIMARY KEY,name TEXT NOT NULL,currency TEXT NOT NULL,branch TEXT NOT NULL,created_at INTEGER NOT NULL) STRICT;
CREATE TABLE warehouses(id TEXT NOT NULL,company TEXT NOT NULL REFERENCES company_profiles(id),branch TEXT NOT NULL,name TEXT NOT NULL,active INTEGER NOT NULL CHECK(active IN(0,1)),PRIMARY KEY(company,id)) STRICT;
CREATE TABLE stock_items(id TEXT NOT NULL,company TEXT NOT NULL REFERENCES company_profiles(id),name TEXT NOT NULL,uom TEXT NOT NULL,inventory_account TEXT NOT NULL REFERENCES accounts(code),expense_account TEXT NOT NULL REFERENCES accounts(code),receipt_account TEXT NOT NULL REFERENCES accounts(code),active INTEGER NOT NULL CHECK(active IN(0,1)),PRIMARY KEY(company,id)) STRICT;
CREATE TABLE stock_balances(company TEXT NOT NULL,warehouse TEXT NOT NULL,item TEXT NOT NULL,quantity INTEGER NOT NULL CHECK(quantity>=0 AND quantity<=999999999999),value INTEGER NOT NULL CHECK(value>=0 AND value<=999999999999),version INTEGER NOT NULL,PRIMARY KEY(company,warehouse,item),FOREIGN KEY(company,warehouse) REFERENCES warehouses(company,id),FOREIGN KEY(company,item) REFERENCES stock_items(company,id),CHECK(quantity>0 OR value=0)) STRICT;
CREATE TABLE stock_operations(command_id TEXT PRIMARY KEY REFERENCES command_inbox(id),kind TEXT NOT NULL CHECK(kind IN('receipt','issue','transfer')),payload TEXT NOT NULL,expected TEXT NOT NULL) STRICT;
CREATE TABLE stock_movements(command_id TEXT NOT NULL REFERENCES stock_operations(command_id),company TEXT NOT NULL,warehouse TEXT NOT NULL,item TEXT NOT NULL,quantity_delta INTEGER NOT NULL,value_delta INTEGER NOT NULL,PRIMARY KEY(command_id,warehouse),FOREIGN KEY(company,warehouse) REFERENCES warehouses(company,id),FOREIGN KEY(company,item) REFERENCES stock_items(company,id)) STRICT;
CREATE TRIGGER stock_movement_no_late BEFORE INSERT ON stock_movements WHEN (SELECT state FROM command_inbox WHERE id=NEW.command_id)='POSTED' BEGIN SELECT RAISE(ABORT,'Posted stock cannot receive more movements'); END;
CREATE TRIGGER stock_source_no_update BEFORE UPDATE ON stock_operations BEGIN SELECT RAISE(ABORT,'Stock source is immutable'); END;
CREATE TRIGGER stock_source_no_delete BEFORE DELETE ON stock_operations BEGIN SELECT RAISE(ABORT,'Stock source is immutable'); END;
CREATE TRIGGER stock_movement_no_update BEFORE UPDATE ON stock_movements BEGIN SELECT RAISE(ABORT,'Stock movement is immutable'); END;
CREATE TRIGGER stock_movement_no_delete BEFORE DELETE ON stock_movements BEGIN SELECT RAISE(ABORT,'Stock movement is immutable'); END;
DROP TRIGGER posted_requires_effects;
CREATE TRIGGER posted_requires_effects BEFORE UPDATE OF state ON command_inbox WHEN NEW.state='POSTED' AND OLD.state<>'POSTED' BEGIN
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM audit WHERE command_id=NEW.id AND event='JOURNAL_POSTED') OR NOT EXISTS(SELECT 1 FROM outbox WHERE id=NEW.id) THEN RAISE(ABORT,'Posting requires balanced source, audit and outbox') END;
 SELECT CASE WHEN EXISTS(SELECT 1 FROM journals WHERE id=NEW.id) AND ((SELECT count(*) FROM journal_lines WHERE journal_id=NEW.id)<2 OR (SELECT sum(debit)-sum(credit) FROM journal_lines WHERE journal_id=NEW.id)<>0 OR (SELECT sum(debit) FROM journal_lines WHERE journal_id=NEW.id)>999999999999) THEN RAISE(ABORT,'Posting requires balanced source') END;
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM journals WHERE id=NEW.id) AND NOT EXISTS(SELECT 1 FROM stock_operations s WHERE s.command_id=NEW.id AND EXISTS(SELECT 1 FROM stock_movements WHERE command_id=NEW.id) AND (SELECT sum(abs(value_delta)) FROM stock_movements WHERE command_id=NEW.id)=0) AND NOT EXISTS(SELECT 1 FROM stock_operations s WHERE s.command_id=NEW.id AND s.kind='transfer' AND (SELECT count(*) FROM stock_movements WHERE command_id=NEW.id)=2 AND (SELECT sum(quantity_delta) FROM stock_movements WHERE command_id=NEW.id)=0 AND (SELECT sum(value_delta) FROM stock_movements WHERE command_id=NEW.id)=0) THEN RAISE(ABORT,'Posting requires balanced source or verified non-GL stock effects') END;
END;
`);

tenant.push(`
CREATE TABLE account_profiles(code TEXT PRIMARY KEY REFERENCES accounts(code),kind TEXT NOT NULL CHECK(kind IN('asset','liability','equity','income','expense')),active INTEGER NOT NULL CHECK(active IN(0,1))) STRICT;
CREATE TABLE company_settings(company TEXT PRIMARY KEY REFERENCES company_profiles(id),print_footer TEXT NOT NULL DEFAULT '',address TEXT NOT NULL DEFAULT '',tax_number TEXT NOT NULL DEFAULT '') STRICT;
`);
tenant.push(`
CREATE TABLE command_files(id TEXT PRIMARY KEY,command_id TEXT NOT NULL REFERENCES command_inbox(id),name TEXT NOT NULL,media_type TEXT NOT NULL,sha256 TEXT NOT NULL,byte_size INTEGER NOT NULL,scan TEXT NOT NULL CHECK(scan='clean'),created_at INTEGER NOT NULL,UNIQUE(command_id,name,sha256)) STRICT;
CREATE TRIGGER evidence_immutable BEFORE UPDATE ON command_files BEGIN SELECT RAISE(ABORT,'Evidence is immutable'); END;
CREATE TRIGGER evidence_no_delete BEFORE DELETE ON command_files BEGIN SELECT RAISE(ABORT,'Evidence is retained'); END;
CREATE TRIGGER evidence_no_late BEFORE INSERT ON command_files WHEN (SELECT state FROM command_inbox WHERE id=NEW.command_id)='POSTED' BEGIN SELECT RAISE(ABORT,'Submitted source evidence is immutable'); END;
`);
tenant.push(`
CREATE TABLE inventory_controls(account TEXT PRIMARY KEY REFERENCES accounts(code)) STRICT;
CREATE TRIGGER inventory_control_source BEFORE UPDATE OF state ON command_inbox WHEN NEW.state='POSTED' AND OLD.state<>'POSTED' BEGIN
 SELECT CASE WHEN EXISTS(SELECT 1 FROM journal_lines l JOIN inventory_controls c ON c.account=l.account WHERE l.journal_id=NEW.id) AND NOT EXISTS(SELECT 1 FROM stock_operations WHERE command_id=NEW.id) THEN RAISE(ABORT,'Inventory control accounts require a stock source') END;
 SELECT CASE WHEN EXISTS(SELECT 1 FROM stock_operations s WHERE s.command_id=NEW.id AND s.kind='transfer') AND EXISTS(SELECT 1 FROM journals WHERE id=NEW.id) THEN RAISE(ABORT,'Warehouse transfer cannot create a general ledger journal') END;
 SELECT CASE WHEN EXISTS(SELECT 1 FROM stock_operations s WHERE s.command_id=NEW.id AND s.kind<>'transfer' AND (SELECT coalesce(sum(quantity_delta),0) FROM stock_movements WHERE command_id=NEW.id)=0) THEN RAISE(ABORT,'Stock source requires its physical movement') END;
 SELECT CASE WHEN EXISTS(SELECT 1 FROM stock_operations s JOIN stock_items i ON i.company=json_extract(s.payload,'$.company') AND i.id=json_extract(s.payload,'$.item') WHERE s.command_id=NEW.id AND s.kind<>'transfer' AND (SELECT coalesce(sum(l.debit-l.credit),0) FROM journal_lines l WHERE l.journal_id=NEW.id AND l.account=i.inventory_account)<>(SELECT coalesce(sum(value_delta),0) FROM stock_movements WHERE command_id=NEW.id)) THEN RAISE(ABORT,'Stock value and inventory control journal differ') END;
END;
`);
tenant.push(`
CREATE TABLE journal_corrections(command_id TEXT PRIMARY KEY REFERENCES command_inbox(id),original_id TEXT NOT NULL UNIQUE REFERENCES journals(id),reason TEXT NOT NULL) STRICT;
CREATE TRIGGER correction_no_update BEFORE UPDATE ON journal_corrections BEGIN SELECT RAISE(ABORT,'Correction link is immutable'); END;
CREATE TRIGGER correction_no_delete BEFORE DELETE ON journal_corrections BEGIN SELECT RAISE(ABORT,'Correction link is retained'); END;
CREATE TRIGGER correction_valid_source BEFORE INSERT ON journal_corrections BEGIN
 SELECT CASE WHEN (SELECT state FROM command_inbox WHERE id=NEW.command_id)<>'ACCEPTED_PENDING' THEN RAISE(ABORT,'Correction metadata must be accepted before posting') END;
 SELECT CASE WHEN (SELECT state FROM command_inbox WHERE id=NEW.original_id)<>'POSTED' OR EXISTS(SELECT 1 FROM stock_operations WHERE command_id=NEW.original_id) THEN RAISE(ABORT,'Use the original operational correction workflow') END;
 SELECT CASE WHEN (SELECT json_extract(payload,'$.company') FROM command_inbox WHERE id=NEW.command_id)<>(SELECT company FROM journals WHERE id=NEW.original_id) OR (SELECT json_extract(payload,'$.branch') FROM command_inbox WHERE id=NEW.command_id)<>(SELECT branch FROM journals WHERE id=NEW.original_id) OR (SELECT json_extract(payload,'$.date') FROM command_inbox WHERE id=NEW.command_id)<(SELECT posting_date FROM journals WHERE id=NEW.original_id) THEN RAISE(ABORT,'Correction must retain its original company/branch and cannot precede its source date') END;
END;
CREATE TRIGGER correction_exact_reversal BEFORE UPDATE OF state ON command_inbox WHEN NEW.state='POSTED' AND OLD.state<>'POSTED' AND EXISTS(SELECT 1 FROM journal_corrections WHERE command_id=NEW.id) BEGIN
 SELECT CASE WHEN (SELECT count(*) FROM journal_lines WHERE journal_id=NEW.id)<>(SELECT count(*) FROM journal_lines WHERE journal_id=(SELECT original_id FROM journal_corrections WHERE command_id=NEW.id)) OR EXISTS(SELECT 1 FROM journal_lines r LEFT JOIN journal_lines o ON o.journal_id=(SELECT original_id FROM journal_corrections WHERE command_id=NEW.id) AND o.line_no=r.line_no WHERE r.journal_id=NEW.id AND (o.line_no IS NULL OR r.account<>o.account OR r.debit<>o.credit OR r.credit<>o.debit)) THEN RAISE(ABORT,'Correction must exactly reverse its immutable source') END;
END;
`);

identity.push(`
CREATE TABLE business_member_operations(id TEXT PRIMARY KEY,tenant_id TEXT NOT NULL,actor TEXT NOT NULL REFERENCES users(id),user_id TEXT NOT NULL REFERENCES users(id),digest TEXT NOT NULL,state TEXT NOT NULL CHECK(state IN('PREPARED','NEEDS_RETRY','COMPLETED')),created_at INTEGER NOT NULL) STRICT;
`);

tenant.push(`
CREATE TABLE trade_controls(company TEXT NOT NULL,branch TEXT NOT NULL,account TEXT NOT NULL REFERENCES accounts(code),PRIMARY KEY(company,branch,account)) STRICT;
CREATE TABLE trade_parties(company TEXT NOT NULL,branch TEXT NOT NULL,id TEXT NOT NULL,kind TEXT NOT NULL CHECK(kind IN('customer','supplier')),name TEXT NOT NULL,PRIMARY KEY(company,branch,id)) STRICT;
CREATE TABLE trade_operations(command_id TEXT PRIMARY KEY REFERENCES command_inbox(id),input_digest TEXT NOT NULL,payload TEXT NOT NULL) STRICT;
CREATE TABLE trade_documents(command_id TEXT PRIMARY KEY REFERENCES trade_operations(command_id),company TEXT NOT NULL,branch TEXT NOT NULL,party_id TEXT NOT NULL,kind TEXT NOT NULL CHECK(kind IN('invoice','bill')),reference TEXT NOT NULL,posting_date TEXT NOT NULL,due_date TEXT NOT NULL,total INTEGER NOT NULL CHECK(total>0),FOREIGN KEY(company,branch,party_id) REFERENCES trade_parties(company,branch,id),UNIQUE(company,branch,party_id,kind,reference)) STRICT;
CREATE TABLE trade_lines(command_id TEXT NOT NULL REFERENCES trade_documents(command_id),line_no INTEGER NOT NULL,description TEXT NOT NULL,account TEXT NOT NULL REFERENCES accounts(code),amount INTEGER NOT NULL CHECK(amount>0),PRIMARY KEY(command_id,line_no)) STRICT;
CREATE TABLE trade_allocations(command_id TEXT NOT NULL REFERENCES trade_operations(command_id),document_id TEXT NOT NULL REFERENCES trade_documents(command_id),amount INTEGER NOT NULL CHECK(amount>0),PRIMARY KEY(command_id,document_id)) STRICT;
CREATE TRIGGER trade_control_source BEFORE UPDATE OF state ON command_inbox WHEN NEW.state='POSTED' AND OLD.state<>'POSTED' BEGIN
 SELECT CASE WHEN EXISTS(SELECT 1 FROM journal_lines l JOIN journals j ON j.id=l.journal_id JOIN trade_controls c ON c.company=j.company AND c.branch=j.branch AND c.account=l.account WHERE j.id=NEW.id) AND NOT EXISTS(SELECT 1 FROM trade_operations WHERE command_id=NEW.id) THEN RAISE(ABORT,'Trade control accounts require an invoice/bill/settlement source') END;
 SELECT CASE WHEN EXISTS(SELECT 1 FROM trade_documents d WHERE d.command_id=NEW.id AND d.total<>(SELECT sum(amount) FROM trade_lines WHERE command_id=NEW.id)) THEN RAISE(ABORT,'Trade lines and document total differ') END;
 SELECT CASE WHEN EXISTS(SELECT 1 FROM trade_allocations a JOIN trade_documents d ON d.command_id=a.document_id WHERE a.command_id=NEW.id AND d.total<(SELECT sum(amount) FROM trade_allocations WHERE document_id=d.command_id)) THEN RAISE(ABORT,'Trade allocation exceeds document total') END;
END;
CREATE TRIGGER trade_correction_source BEFORE INSERT ON journal_corrections WHEN EXISTS(SELECT 1 FROM trade_operations WHERE command_id=NEW.original_id) BEGIN SELECT RAISE(ABORT,'Trade documents require an operational credit/refund source'); END;
${['trade_controls','trade_parties','trade_operations','trade_documents','trade_lines','trade_allocations'].map(table=>`CREATE TRIGGER ${table}_retained_update BEFORE UPDATE ON ${table} BEGIN SELECT RAISE(ABORT,'Trade source is immutable'); END;
CREATE TRIGGER ${table}_retained_delete BEFORE DELETE ON ${table} BEGIN SELECT RAISE(ABORT,'Trade source is retained'); END;`).join('\n')}
`);

tenant.push(`
CREATE TABLE trade_credits(command_id TEXT PRIMARY KEY REFERENCES trade_operations(command_id),original_id TEXT NOT NULL REFERENCES trade_documents(command_id),total INTEGER NOT NULL CHECK(total>0),reason TEXT NOT NULL) STRICT;
CREATE TABLE trade_credit_lines(command_id TEXT NOT NULL REFERENCES trade_credits(command_id),original_line INTEGER NOT NULL,amount INTEGER NOT NULL CHECK(amount>0),PRIMARY KEY(command_id,original_line)) STRICT;
CREATE TRIGGER trade_credit_valid_source BEFORE INSERT ON trade_credits BEGIN
 SELECT CASE WHEN (SELECT state FROM command_inbox WHERE id=NEW.command_id)<>'ACCEPTED_PENDING' OR (SELECT state FROM command_inbox WHERE id=NEW.original_id)<>'POSTED' THEN RAISE(ABORT,'Credit requires an accepted command and a posted source') END;
END;
CREATE TRIGGER trade_credit_post_check BEFORE UPDATE OF state ON command_inbox WHEN NEW.state='POSTED' AND OLD.state<>'POSTED' AND EXISTS(SELECT 1 FROM trade_credits WHERE command_id=NEW.id) BEGIN
 SELECT CASE WHEN (SELECT total FROM trade_credits WHERE command_id=NEW.id)<>(SELECT sum(amount) FROM trade_credit_lines WHERE command_id=NEW.id) THEN RAISE(ABORT,'Credit lines do not reconcile') END;
 SELECT CASE WHEN EXISTS(SELECT 1 FROM trade_credit_lines c JOIN trade_credits h ON h.command_id=c.command_id LEFT JOIN trade_lines l ON l.command_id=h.original_id AND l.line_no=c.original_line WHERE c.command_id=NEW.id AND (l.line_no IS NULL OR l.amount<(SELECT coalesce(sum(c2.amount),0) FROM trade_credit_lines c2 JOIN trade_credits h2 ON h2.command_id=c2.command_id JOIN command_inbox i2 ON i2.id=c2.command_id WHERE h2.original_id=h.original_id AND c2.original_line=c.original_line AND (i2.state='POSTED' OR i2.id=NEW.id)))) THEN RAISE(ABORT,'Credit exceeds its original source line') END;
END;
${['trade_credits','trade_credit_lines'].map(table=>`CREATE TRIGGER ${table}_retained_update BEFORE UPDATE ON ${table} BEGIN SELECT RAISE(ABORT,'Credit source is immutable'); END;
CREATE TRIGGER ${table}_retained_delete BEFORE DELETE ON ${table} BEGIN SELECT RAISE(ABORT,'Credit source is retained'); END;`).join('\n')}
`);
