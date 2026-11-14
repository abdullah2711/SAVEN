export const documentMigration=`
CREATE TABLE document_sequences(company TEXT NOT NULL,kind TEXT NOT NULL,next_number INTEGER NOT NULL CHECK(next_number>0),PRIMARY KEY(company,kind)) STRICT;
CREATE TRIGGER sequence_only_increases BEFORE UPDATE ON document_sequences WHEN NEW.next_number<=OLD.next_number OR NEW.company<>OLD.company OR NEW.kind<>OLD.kind BEGIN SELECT RAISE(ABORT,'Document sequence may only increase'); END;
CREATE TRIGGER sequence_retained BEFORE DELETE ON document_sequences BEGIN SELECT RAISE(ABORT,'Document sequences are retained'); END;
CREATE TABLE document_numbers(id TEXT PRIMARY KEY,company TEXT NOT NULL,kind TEXT NOT NULL,sequence INTEGER NOT NULL CHECK(sequence>0),number TEXT NOT NULL,UNIQUE(company,kind,sequence),UNIQUE(company,number)) STRICT;
CREATE TRIGGER number_immutable_update BEFORE UPDATE ON document_numbers BEGIN SELECT RAISE(ABORT,'Document number is immutable'); END;
CREATE TRIGGER number_immutable_delete BEFORE DELETE ON document_numbers BEGIN SELECT RAISE(ABORT,'Document numbers are retained'); END;
CREATE TABLE journal_drafts(id TEXT PRIMARY KEY,actor TEXT NOT NULL REFERENCES members(user_id),company TEXT NOT NULL,branch TEXT NOT NULL,payload TEXT NOT NULL,revision INTEGER NOT NULL CHECK(revision>0),state TEXT NOT NULL CHECK(state IN('DRAFT','SUBMITTED','CANCELLED')),source_id TEXT,created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL) STRICT;
CREATE INDEX draft_scope ON journal_drafts(company,branch,actor,state);
CREATE TRIGGER draft_submitted_immutable BEFORE UPDATE ON journal_drafts WHEN OLD.state<>'DRAFT' BEGIN SELECT RAISE(ABORT,'Only drafts may be edited'); END;
CREATE TRIGGER draft_identity_immutable BEFORE UPDATE OF id,actor,company,branch,created_at,source_id ON journal_drafts BEGIN SELECT RAISE(ABORT,'Draft identity is immutable'); END;
CREATE TRIGGER draft_no_delete BEFORE DELETE ON journal_drafts BEGIN SELECT RAISE(ABORT,'Draft history is retained'); END;
CREATE TABLE command_decisions(command_id TEXT PRIMARY KEY REFERENCES command_inbox(id),decision TEXT NOT NULL CHECK(decision IN('REJECTED','RETURNED')),actor TEXT NOT NULL REFERENCES members(user_id),reason TEXT NOT NULL,replacement_id TEXT REFERENCES journal_drafts(id),happened_at INTEGER NOT NULL) STRICT;
CREATE TRIGGER decision_no_update BEFORE UPDATE ON command_decisions BEGIN SELECT RAISE(ABORT,'Review history is immutable'); END;
CREATE TRIGGER decision_no_delete BEFORE DELETE ON command_decisions BEGIN SELECT RAISE(ABORT,'Review history is retained'); END;
CREATE TRIGGER decided_command_final BEFORE UPDATE OF state ON command_inbox WHEN EXISTS(SELECT 1 FROM command_decisions WHERE command_id=OLD.id) BEGIN SELECT RAISE(ABORT,'Reviewed command is final'); END;
`;
