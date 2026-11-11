// Fresh isolated testing setup. Outputs remain in ignored var/ and are not deployed.
// SQL contains invitation hashes; the private JSON handoff contains the raw invitations.
import { mkdirSync,writeFileSync,readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { LocalDatabase } from './database.mjs';
import { seed } from './fixtures.mjs';
import { hash,token } from '../src/crypto.mjs';
import { now } from '../src/auth.mjs';
const root=resolve(import.meta.dirname,'..'),db=new LocalDatabase();db.migrate();await seed(db);
const quote=value=>value===null?'NULL':typeof value==='number'?String(value):"'"+String(value).replaceAll("'","''")+"'";
const sql=[readFileSync(resolve(root,'migrations/0001_foundation.sql'),'utf8')];
for(const table of ['companies','users','memberships','accounts','parties','periods','items']) {
  for(const row of db.sqlite.prepare('SELECT * FROM '+table).all()) {
    sql.push('INSERT INTO '+table+'('+Object.keys(row).join(',')+') VALUES('+Object.values(row).map(quote).join(',')+');');
  }
}
const invitations={};
for(const [name,user] of [['owner','owner'],['preparer','preparer'],['reviewer','reviewer'],['viewer','viewer'],['qa-owner','owner'],['qa-preparer','preparer'],['qa-reviewer','reviewer']]) {
  const value=token(),expiresAt=now()+86400;
  invitations[name]={token:value,url:'https://saventesting.economicsystems.cc/#invite='+value,expiresAt};
  sql.push('INSERT INTO login_grants(token_hash,user_id,expires_at) VALUES('+quote(await hash(value))+','+quote(user)+','+expiresAt+');');
}
mkdirSync(resolve(root,'var'),{recursive:true});
writeFileSync(resolve(root,'var/testing-bootstrap.sql'),sql.join('\n')+'\n',{mode:0o600});
writeFileSync(resolve(root,'var/testing-invitations.json'),JSON.stringify(invitations,null,2),{mode:0o600});
db.close();
console.log('Prepared fresh testing SQL and private invitations under ignored var/. No tokens printed.');
