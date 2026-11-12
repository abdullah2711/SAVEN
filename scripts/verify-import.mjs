import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {PostgresDatabase} from './postgres.mjs';
import {canonical} from '../src/crypto.mjs';

// Read-only comparison. Supply the private export through stdin, never Git.
const parts=[];for await(const chunk of process.stdin)parts.push(chunk);
const expected=JSON.parse(Buffer.concat(parts).toString('utf8'));
const allowed=['users','companies','memberships','login_grants','sessions','accounts','parties','periods','items','resource_denials','operations','documents','journals','journal_lines','audit_events','outbox'];
assert.deepEqual(Object.keys(expected).sort(),[...allowed].sort());
const db=PostgresDatabase.connect({host:process.env.PGHOST??'/var/run/postgresql',database:process.env.IMPORT_DATABASE??'saven_testing',user:'postgres'});
const digest=rows=>createHash('sha256').update(canonical(rows.map(row=>canonical(row)).sort())).digest('hex');
try {
  for(const table of allowed){const actual=(await db.prepare('SELECT * FROM '+table).all()).results;assert.equal(digest(actual),digest(expected[table]),'Content mismatch: '+table);console.log('MATCH',table,actual.length);}
  const invalid=await db.prepare("SELECT count(*) AS n FROM journals j WHERE j.status='posted' AND ((SELECT count(*) FROM journal_lines l WHERE l.company_id=j.company_id AND l.journal_id=j.id)<2 OR (SELECT coalesce(sum(debit_minor-credit_minor),1) FROM journal_lines l WHERE l.company_id=j.company_id AND l.journal_id=j.id)!=0)").first();
  assert.equal(invalid.n,0);console.log('IMPORT VERIFIED: all 16 tables match and posted journals balance.');
} finally {await db.close();}
