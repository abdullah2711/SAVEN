PRAGMA foreign_keys = ON;

CREATE TABLE users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1))
) STRICT;
CREATE TABLE companies (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  currency TEXT NOT NULL CHECK(currency = 'PKR'),
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','paused')),
  revision INTEGER NOT NULL DEFAULT 1 CHECK(revision > 0),
  knowledge_enabled INTEGER NOT NULL DEFAULT 0 CHECK(knowledge_enabled IN (0,1))
) STRICT;
CREATE TABLE memberships (
  company_id TEXT NOT NULL REFERENCES companies(id),
  user_id TEXT NOT NULL REFERENCES users(id),
  role TEXT NOT NULL CHECK(role IN ('owner','admin','preparer','approver','viewer')),
  PRIMARY KEY(company_id,user_id)
) STRICT;
CREATE UNIQUE INDEX one_owner ON memberships(company_id) WHERE role = 'owner';
CREATE TRIGGER owner_not_removed BEFORE DELETE ON memberships WHEN OLD.role = 'owner'
BEGIN SELECT RAISE(ABORT, 'OWNER_PROTECTED'); END;
CREATE TRIGGER owner_not_demoted BEFORE UPDATE ON memberships WHEN OLD.role = 'owner'
BEGIN SELECT RAISE(ABORT, 'OWNER_PROTECTED'); END;
CREATE TABLE login_grants (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  expires_at INTEGER NOT NULL,
  claim TEXT
) STRICT;
CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL UNIQUE REFERENCES users(id),
  expires_at INTEGER NOT NULL
) STRICT;
CREATE TABLE accounts (
  company_id TEXT NOT NULL REFERENCES companies(id),
  id TEXT NOT NULL,
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN ('asset','liability','equity','income','expense')),
  PRIMARY KEY(company_id,id),
  UNIQUE(company_id,code)
) STRICT;
CREATE TABLE parties (
  company_id TEXT NOT NULL REFERENCES companies(id),
  id TEXT NOT NULL,
  name TEXT NOT NULL,
  PRIMARY KEY(company_id,id)
) STRICT;
CREATE TABLE periods (
  company_id TEXT NOT NULL REFERENCES companies(id),
  start_date TEXT NOT NULL,
  end_date TEXT NOT NULL,
  locked INTEGER NOT NULL DEFAULT 0 CHECK(locked IN (0,1)),
  PRIMARY KEY(company_id,start_date),
  CHECK(start_date <= end_date)
) STRICT;
CREATE TABLE items (
  company_id TEXT NOT NULL REFERENCES companies(id),
  id TEXT NOT NULL,
  name TEXT NOT NULL,
  store TEXT NOT NULL,
  unit TEXT NOT NULL,
  on_hand INTEGER NOT NULL CHECK(on_hand >= 0),
  reserved INTEGER NOT NULL DEFAULT 0 CHECK(reserved >= 0 AND reserved <= on_hand),
  unit_cost_minor INTEGER NOT NULL CHECK(unit_cost_minor > 0 AND unit_cost_minor <= 999999999999),
  inventory_account TEXT NOT NULL,
  expense_account TEXT NOT NULL,
  PRIMARY KEY(company_id,id),
  FOREIGN KEY(company_id,inventory_account) REFERENCES accounts(company_id,id),
  FOREIGN KEY(company_id,expense_account) REFERENCES accounts(company_id,id)
) STRICT;
CREATE TABLE resource_denials (
  company_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  resource_type TEXT NOT NULL CHECK(resource_type IN ('party','item','account')),
  resource_id TEXT NOT NULL,
  PRIMARY KEY(company_id,user_id,resource_type,resource_id),
  FOREIGN KEY(company_id,user_id) REFERENCES memberships(company_id,user_id)
) STRICT;
CREATE TABLE operations (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES companies(id),
  actor_id TEXT NOT NULL REFERENCES users(id),
  session_hash TEXT NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN ('submit','approve','reject')),
  idempotency_key TEXT NOT NULL,
  payload_hash TEXT NOT NULL,
  expected_revision INTEGER NOT NULL,
  result_json TEXT NOT NULL CHECK(json_valid(result_json)),
  created_at INTEGER NOT NULL,
  UNIQUE(company_id,kind,idempotency_key)
) STRICT;
CREATE TRIGGER operation_authority BEFORE INSERT ON operations BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM sessions s JOIN users u ON u.id=s.user_id
    WHERE s.token_hash=NEW.session_hash AND s.user_id=NEW.actor_id AND u.active=1
      AND s.expires_at > CAST(strftime('%s','now') AS INTEGER)
  ) THEN RAISE(ABORT,'SESSION_EXPIRED') END;
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM companies c JOIN memberships m ON m.company_id=c.id
    WHERE c.id=NEW.company_id AND c.status='active' AND m.user_id=NEW.actor_id
      AND ((NEW.kind='submit' AND m.role IN ('owner','admin','preparer'))
        OR (NEW.kind IN ('approve','reject') AND m.role IN ('owner','admin','approver')))
  ) THEN RAISE(ABORT,'FORBIDDEN') END;
  SELECT CASE WHEN (SELECT revision FROM companies WHERE id=NEW.company_id) != NEW.expected_revision
    THEN RAISE(ABORT,'STALE_PREVIEW') END;
END;
CREATE TABLE documents (
  company_id TEXT NOT NULL REFERENCES companies(id),
  id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN ('invoice','stock_issue')),
  date TEXT NOT NULL,
  reference TEXT NOT NULL,
  description TEXT NOT NULL,
  party_id TEXT,
  item_id TEXT,
  quantity INTEGER,
  amount_minor INTEGER NOT NULL CHECK(amount_minor > 0 AND amount_minor <= 999999999999),
  payload_json TEXT NOT NULL CHECK(json_valid(payload_json)),
  payload_hash TEXT NOT NULL,
  preview_json TEXT NOT NULL CHECK(json_valid(preview_json)),
  prepared_by TEXT NOT NULL REFERENCES users(id),
  reviewed_by TEXT REFERENCES users(id),
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','posted','rejected')),
  version INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  PRIMARY KEY(company_id,id),
  UNIQUE(company_id,kind,reference),
  FOREIGN KEY(company_id,party_id) REFERENCES parties(company_id,id),
  FOREIGN KEY(company_id,item_id) REFERENCES items(company_id,id),
  CHECK((kind='invoice' AND party_id IS NOT NULL AND item_id IS NULL AND quantity IS NULL)
     OR (kind='stock_issue' AND item_id IS NOT NULL AND party_id IS NULL AND quantity > 0)),
  CHECK(reviewed_by IS NULL OR reviewed_by != prepared_by)
) STRICT;
CREATE TRIGGER document_open_period BEFORE INSERT ON documents BEGIN
  SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM periods WHERE company_id=NEW.company_id
    AND NEW.date BETWEEN start_date AND end_date AND locked=0) THEN RAISE(ABORT,'PERIOD_LOCKED') END;
END;
CREATE TRIGGER document_resource_access BEFORE INSERT ON documents BEGIN
  SELECT CASE WHEN EXISTS(SELECT 1 FROM resource_denials d WHERE d.company_id=NEW.company_id
    AND d.user_id=NEW.prepared_by AND ((d.resource_type='party' AND d.resource_id=NEW.party_id)
      OR (d.resource_type='item' AND d.resource_id=NEW.item_id)
      OR (d.resource_type='account' AND d.resource_id IN (SELECT json_extract(value,'$.accountId') FROM json_each(NEW.preview_json,'$.lines')))))
    THEN RAISE(ABORT,'RESOURCE_DENIED') END;
END;
CREATE TRIGGER document_review_access BEFORE UPDATE OF status ON documents BEGIN
  SELECT CASE WHEN EXISTS(SELECT 1 FROM resource_denials d WHERE d.company_id=NEW.company_id
    AND d.user_id=NEW.reviewed_by AND ((d.resource_type='party' AND d.resource_id=NEW.party_id)
      OR (d.resource_type='item' AND d.resource_id=NEW.item_id)
      OR (d.resource_type='account' AND d.resource_id IN (SELECT json_extract(value,'$.accountId') FROM json_each(NEW.preview_json,'$.lines')))))
    THEN RAISE(ABORT,'RESOURCE_DENIED') END;
END;
CREATE TRIGGER document_immutable BEFORE UPDATE ON documents WHEN
  OLD.status != 'pending' OR NEW.company_id != OLD.company_id OR NEW.id != OLD.id
  OR NEW.payload_hash != OLD.payload_hash OR NEW.payload_json != OLD.payload_json
  OR NEW.preview_json != OLD.preview_json OR NEW.kind != OLD.kind OR NEW.date != OLD.date
  OR NEW.reference != OLD.reference OR NEW.description != OLD.description
  OR NEW.party_id IS NOT OLD.party_id OR NEW.item_id IS NOT OLD.item_id
  OR NEW.quantity IS NOT OLD.quantity OR NEW.amount_minor != OLD.amount_minor
  OR NEW.prepared_by != OLD.prepared_by OR NEW.created_at != OLD.created_at
  OR NEW.status NOT IN ('posted','rejected') OR NEW.reviewed_by IS NULL
  OR NEW.version != OLD.version+1
BEGIN SELECT RAISE(ABORT,'DOCUMENT_IMMUTABLE'); END;
CREATE TRIGGER document_no_delete BEFORE DELETE ON documents
BEGIN SELECT RAISE(ABORT,'DOCUMENT_IMMUTABLE'); END;
CREATE TABLE journals (
  company_id TEXT NOT NULL,
  id TEXT NOT NULL,
  document_id TEXT NOT NULL,
  date TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'building' CHECK(status IN ('building','posted')),
  PRIMARY KEY(company_id,id),
  UNIQUE(company_id,document_id),
  FOREIGN KEY(company_id,document_id) REFERENCES documents(company_id,id)
) STRICT;
CREATE TABLE journal_lines (
  company_id TEXT NOT NULL,
  journal_id TEXT NOT NULL,
  line_no INTEGER NOT NULL,
  account_id TEXT NOT NULL,
  debit_minor INTEGER NOT NULL DEFAULT 0 CHECK(debit_minor >= 0 AND debit_minor <= 999999999999),
  credit_minor INTEGER NOT NULL DEFAULT 0 CHECK(credit_minor >= 0 AND credit_minor <= 999999999999),
  PRIMARY KEY(company_id,journal_id,line_no),
  FOREIGN KEY(company_id,journal_id) REFERENCES journals(company_id,id),
  FOREIGN KEY(company_id,account_id) REFERENCES accounts(company_id,id),
  CHECK((debit_minor>0 AND credit_minor=0) OR (credit_minor>0 AND debit_minor=0))
) STRICT;
CREATE TRIGGER journal_balance BEFORE UPDATE OF status ON journals WHEN NEW.status='posted' BEGIN
  SELECT CASE WHEN OLD.status!='building' OR NEW.company_id!=OLD.company_id
    OR NEW.id!=OLD.id OR NEW.document_id!=OLD.document_id OR NEW.date!=OLD.date
    THEN RAISE(ABORT,'JOURNAL_IMMUTABLE') END;
  SELECT CASE WHEN (SELECT count(*) FROM journal_lines WHERE company_id=NEW.company_id AND journal_id=NEW.id)<2
    OR (SELECT coalesce(sum(debit_minor-credit_minor),1) FROM journal_lines WHERE company_id=NEW.company_id AND journal_id=NEW.id)!=0
    THEN RAISE(ABORT,'UNBALANCED_JOURNAL') END;
  SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM periods WHERE company_id=NEW.company_id
    AND NEW.date BETWEEN start_date AND end_date AND locked=0) THEN RAISE(ABORT,'PERIOD_LOCKED') END;
END;
CREATE TRIGGER journal_build_first BEFORE INSERT ON journals WHEN NEW.status!='building'
BEGIN SELECT RAISE(ABORT,'JOURNAL_BUILD_REQUIRED'); END;
CREATE TRIGGER document_post_requires_journal BEFORE UPDATE OF status ON documents WHEN NEW.status='posted' BEGIN
  SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM journals WHERE company_id=NEW.company_id
    AND document_id=NEW.id AND status='posted' AND date=NEW.date)
    THEN RAISE(ABORT,'JOURNAL_REQUIRED') END;
END;
CREATE TRIGGER journal_no_edit BEFORE UPDATE ON journals WHEN OLD.status='posted'
BEGIN SELECT RAISE(ABORT,'JOURNAL_IMMUTABLE'); END;
CREATE TRIGGER journal_no_delete BEFORE DELETE ON journals
BEGIN SELECT RAISE(ABORT,'JOURNAL_IMMUTABLE'); END;
CREATE TRIGGER lines_no_insert AFTER INSERT ON journal_lines WHEN
  (SELECT status FROM journals WHERE company_id=NEW.company_id AND id=NEW.journal_id)='posted'
BEGIN SELECT RAISE(ABORT,'JOURNAL_IMMUTABLE'); END;
CREATE TRIGGER lines_no_update BEFORE UPDATE ON journal_lines
BEGIN SELECT RAISE(ABORT,'JOURNAL_IMMUTABLE'); END;
CREATE TRIGGER lines_no_delete BEFORE DELETE ON journal_lines
BEGIN SELECT RAISE(ABORT,'JOURNAL_IMMUTABLE'); END;
CREATE TABLE audit_events (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES companies(id),
  operation_id TEXT NOT NULL UNIQUE REFERENCES operations(id),
  actor_id TEXT NOT NULL REFERENCES users(id),
  action TEXT NOT NULL,
  document_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  FOREIGN KEY(company_id,document_id) REFERENCES documents(company_id,id)
) STRICT;
CREATE TRIGGER audit_no_update BEFORE UPDATE ON audit_events
BEGIN SELECT RAISE(ABORT,'AUDIT_IMMUTABLE'); END;
CREATE TRIGGER audit_no_delete BEFORE DELETE ON audit_events
BEGIN SELECT RAISE(ABORT,'AUDIT_IMMUTABLE'); END;
CREATE TABLE outbox (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES companies(id),
  operation_id TEXT NOT NULL UNIQUE REFERENCES operations(id),
  event_type TEXT NOT NULL,
  document_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  delivered_at INTEGER,
  FOREIGN KEY(company_id,document_id) REFERENCES documents(company_id,id)
) STRICT;
CREATE INDEX documents_recent ON documents(company_id,created_at DESC,id);
CREATE INDEX audit_recent ON audit_events(company_id,created_at DESC,id);
CREATE INDEX journal_by_date ON journals(company_id,status,date);
