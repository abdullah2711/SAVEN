import {readFile,writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
// Private, one-time D1 -> PostgreSQL bridge. Never commit the input or output.
const [input,output]=process.argv.slice(2);
if(!input||!output)throw new Error('Usage: node scripts/prepare-d1-import.mjs private-input.json private-output.sql');
const data=JSON.parse(await readFile(input,'utf8'));
const ddl=await readFile(new URL('../migrations/0001_foundation.sql',import.meta.url),'utf8');
const tables=[...ddl.matchAll(/CREATE TABLE (\w+) \(([\s\S]*?)\n\)/g)].map(m=>({name:m[1],cols:[...m[2].matchAll(/^  ([a-z][a-z_]+) /gm)].map(c=>c[1])}));
assert.deepEqual(Object.keys(data).sort(),tables.map(t=>t.name).sort());
function literal(value){if(value===null)return 'NULL';if(typeof value==='number'){assert(Number.isSafeInteger(value));return String(value);}assert.equal(typeof value,'string');assert(!value.includes('\0'));return "'"+value.replaceAll("'","''")+"'";}
const sql=['BEGIN;',"SET LOCAL lock_timeout='5s';","SET LOCAL statement_timeout='30s';",'LOCK TABLE '+tables.map(t=>t.name).join(',')+' IN ACCESS EXCLUSIVE MODE;',"DO $$ BEGIN IF EXISTS(SELECT 1 FROM users) THEN RAISE EXCEPTION 'Import target must be empty'; END IF; END $$;"];
for(const t of tables)sql.push(`ALTER TABLE ${t.name} DISABLE TRIGGER USER;`);
let records=0;
for(const t of tables){assert(Array.isArray(data[t.name]));for(const row of data[t.name]){assert.deepEqual(Object.keys(row).sort(),[...t.cols].sort());sql.push(`INSERT INTO ${t.name}(${t.cols.join(',')}) VALUES(${t.cols.map(c=>literal(row[c])).join(',')});`);records++;}}
for(const t of tables)sql.push(`ALTER TABLE ${t.name} ENABLE TRIGGER USER;`);
sql.push('DO $$ BEGIN');
for(const t of tables)sql.push(`IF (SELECT count(*) FROM ${t.name})!=${data[t.name].length} THEN RAISE EXCEPTION 'Count mismatch: ${t.name}'; END IF;`);
sql.push("IF EXISTS(SELECT 1 FROM journals j WHERE status='posted' AND ((SELECT count(*) FROM journal_lines l WHERE l.company_id=j.company_id AND l.journal_id=j.id)<2 OR (SELECT coalesce(sum(debit_minor-credit_minor),1) FROM journal_lines l WHERE l.company_id=j.company_id AND l.journal_id=j.id)!=0)) THEN RAISE EXCEPTION 'Unbalanced imported journal'; END IF;");
sql.push("IF EXISTS(SELECT 1 FROM documents d WHERE status='posted' AND NOT EXISTS(SELECT 1 FROM journals j WHERE j.company_id=d.company_id AND j.document_id=d.id AND j.status='posted' AND j.date=d.date)) THEN RAISE EXCEPTION 'Imported posted document without journal'; END IF;");
sql.push("IF EXISTS(SELECT 1 FROM items i WHERE reserved!=(SELECT coalesce(sum(quantity),0) FROM documents d WHERE d.company_id=i.company_id AND d.item_id=i.id AND d.kind='stock_issue' AND d.status='pending')) THEN RAISE EXCEPTION 'Imported stock reservation mismatch'; END IF;");
sql.push('END $$;','COMMIT;');
await writeFile(output,sql.join('\n')+'\n',{mode:0o600});console.log(`Prepared private migration: ${tables.length} tables, ${records} records. Target must be empty.`);
