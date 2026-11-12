-- PostgreSQL source of truth. Apply as the migration owner in a NEW testing database.
BEGIN;
CREATE TABLE users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  active BIGINT NOT NULL DEFAULT 1 CHECK(active IN (0,1))
);

CREATE TABLE companies (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  currency TEXT NOT NULL CHECK(currency = 'PKR'),
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','paused')),
  revision BIGINT NOT NULL DEFAULT 1 CHECK(revision > 0),
  knowledge_enabled BIGINT NOT NULL DEFAULT 0 CHECK(knowledge_enabled IN (0,1))
);

CREATE TABLE memberships (
  company_id TEXT NOT NULL REFERENCES companies(id),
  user_id TEXT NOT NULL REFERENCES users(id),
  role TEXT NOT NULL CHECK(role IN ('owner','admin','preparer','approver','viewer')),
  PRIMARY KEY(company_id,user_id)
);

CREATE UNIQUE INDEX one_owner ON memberships(company_id) WHERE role = 'owner';

CREATE TABLE login_grants (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  expires_at BIGINT NOT NULL,
  claim TEXT
);

CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL UNIQUE REFERENCES users(id),
  expires_at BIGINT NOT NULL
);

CREATE TABLE accounts (
  company_id TEXT NOT NULL REFERENCES companies(id),
  id TEXT NOT NULL,
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN ('asset','liability','equity','income','expense')),
  PRIMARY KEY(company_id,id),
  UNIQUE(company_id,code)
);

CREATE TABLE parties (
  company_id TEXT NOT NULL REFERENCES companies(id),
  id TEXT NOT NULL,
  name TEXT NOT NULL,
  PRIMARY KEY(company_id,id)
);

CREATE TABLE periods (
  company_id TEXT NOT NULL REFERENCES companies(id),
  start_date TEXT NOT NULL,
  end_date TEXT NOT NULL,
  locked BIGINT NOT NULL DEFAULT 0 CHECK(locked IN (0,1)),
  PRIMARY KEY(company_id,start_date),
  CHECK(start_date <= end_date)
);

CREATE TABLE items (
  company_id TEXT NOT NULL REFERENCES companies(id),
  id TEXT NOT NULL,
  name TEXT NOT NULL,
  store TEXT NOT NULL,
  unit TEXT NOT NULL,
  on_hand BIGINT NOT NULL CHECK(on_hand >= 0),
  reserved BIGINT NOT NULL DEFAULT 0 CHECK(reserved >= 0 AND reserved <= on_hand),
  unit_cost_minor BIGINT NOT NULL CHECK(unit_cost_minor > 0 AND unit_cost_minor <= 999999999999),
  inventory_account TEXT NOT NULL,
  expense_account TEXT NOT NULL,
  PRIMARY KEY(company_id,id),
  FOREIGN KEY(company_id,inventory_account) REFERENCES accounts(company_id,id),
  FOREIGN KEY(company_id,expense_account) REFERENCES accounts(company_id,id)
);

CREATE TABLE resource_denials (
  company_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  resource_type TEXT NOT NULL CHECK(resource_type IN ('party','item','account')),
  resource_id TEXT NOT NULL,
  PRIMARY KEY(company_id,user_id,resource_type,resource_id),
  FOREIGN KEY(company_id,user_id) REFERENCES memberships(company_id,user_id)
);

CREATE TABLE operations (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES companies(id),
  actor_id TEXT NOT NULL REFERENCES users(id),
  session_hash TEXT NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN ('submit','approve','reject','configure')),
  idempotency_key TEXT NOT NULL,
  payload_hash TEXT NOT NULL,
  expected_revision BIGINT NOT NULL,
  result_json TEXT NOT NULL CHECK(result_json::jsonb IS NOT NULL),
  created_at BIGINT NOT NULL,
  UNIQUE(company_id,kind,idempotency_key)
);

CREATE TABLE documents (
  company_id TEXT NOT NULL REFERENCES companies(id),
  id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN ('invoice','stock_issue')),
  date TEXT NOT NULL,
  reference TEXT NOT NULL,
  description TEXT NOT NULL,
  party_id TEXT,
  item_id TEXT,
  quantity BIGINT,
  amount_minor BIGINT NOT NULL CHECK(amount_minor > 0 AND amount_minor <= 999999999999),
  payload_json TEXT NOT NULL CHECK(payload_json::jsonb IS NOT NULL),
  payload_hash TEXT NOT NULL,
  preview_json TEXT NOT NULL CHECK(preview_json::jsonb IS NOT NULL),
  prepared_by TEXT NOT NULL REFERENCES users(id),
  reviewed_by TEXT REFERENCES users(id),
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','posted','rejected')),
  version BIGINT NOT NULL DEFAULT 1,
  created_at BIGINT NOT NULL,
  PRIMARY KEY(company_id,id),
  UNIQUE(company_id,kind,reference),
  FOREIGN KEY(company_id,party_id) REFERENCES parties(company_id,id),
  FOREIGN KEY(company_id,item_id) REFERENCES items(company_id,id),
  CHECK((kind='invoice' AND party_id IS NOT NULL AND item_id IS NULL AND quantity IS NULL)
     OR (kind='stock_issue' AND item_id IS NOT NULL AND party_id IS NULL AND quantity > 0)),
  CHECK(reviewed_by IS NULL OR reviewed_by != prepared_by)
);

CREATE TABLE journals (
  company_id TEXT NOT NULL,
  id TEXT NOT NULL,
  document_id TEXT NOT NULL,
  date TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'building' CHECK(status IN ('building','posted')),
  PRIMARY KEY(company_id,id),
  UNIQUE(company_id,document_id),
  FOREIGN KEY(company_id,document_id) REFERENCES documents(company_id,id)
);

CREATE TABLE journal_lines (
  company_id TEXT NOT NULL,
  journal_id TEXT NOT NULL,
  line_no BIGINT NOT NULL,
  account_id TEXT NOT NULL,
  debit_minor BIGINT NOT NULL DEFAULT 0 CHECK(debit_minor >= 0 AND debit_minor <= 999999999999),
  credit_minor BIGINT NOT NULL DEFAULT 0 CHECK(credit_minor >= 0 AND credit_minor <= 999999999999),
  PRIMARY KEY(company_id,journal_id,line_no),
  FOREIGN KEY(company_id,journal_id) REFERENCES journals(company_id,id),
  FOREIGN KEY(company_id,account_id) REFERENCES accounts(company_id,id),
  CHECK((debit_minor>0 AND credit_minor=0) OR (credit_minor>0 AND debit_minor=0))
);

CREATE TABLE audit_events (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES companies(id),
  operation_id TEXT NOT NULL UNIQUE REFERENCES operations(id),
  actor_id TEXT NOT NULL REFERENCES users(id),
  action TEXT NOT NULL,
  document_id TEXT NOT NULL,
  created_at BIGINT NOT NULL,
  FOREIGN KEY(company_id,document_id) REFERENCES documents(company_id,id)
);

CREATE TABLE outbox (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES companies(id),
  operation_id TEXT NOT NULL UNIQUE REFERENCES operations(id),
  event_type TEXT NOT NULL,
  document_id TEXT NOT NULL,
  created_at BIGINT NOT NULL,
  delivered_at BIGINT,
  FOREIGN KEY(company_id,document_id) REFERENCES documents(company_id,id)
);

CREATE INDEX documents_recent ON documents(company_id,created_at DESC,id);

CREATE INDEX audit_recent ON audit_events(company_id,created_at DESC,id);

CREATE INDEX journal_by_date ON journals(company_id,status,date);
CREATE TABLE schema_version(version integer PRIMARY KEY,applied_at timestamptz NOT NULL DEFAULT now());
INSERT INTO schema_version(version) VALUES(1);
COMMIT;
