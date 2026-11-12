import {PostgresDatabase} from './postgres.mjs';
import {issueGrant} from './fixtures.mjs';
if(process.env.QA_DATABASE!=='saven_testing')throw Error('This operator fixture is restricted to the isolated testing database.');
const db=PostgresDatabase.connect({host:'/var/run/postgresql',database:'saven_testing',user:'postgres'}),suffix=crypto.randomUUID(),company='qa-live-'+suffix,owner='qa-owner-'+suffix,reviewer='qa-reviewer-'+suffix;
try{
 const statements=[db.prepare("INSERT INTO users(id,email,name) VALUES(?,?,?)").bind(owner,owner+'@example.invalid','SYNTHETIC acceptance owner'),db.prepare("INSERT INTO users(id,email,name) VALUES(?,?,?)").bind(reviewer,reviewer+'@example.invalid','SYNTHETIC acceptance reviewer'),db.prepare("INSERT INTO companies(id,name,currency,is_demo) VALUES(?,'SYNTHETIC SAVEN acceptance workspace','PKR',1)").bind(company),db.prepare("INSERT INTO memberships(company_id,user_id,role) VALUES(?,?,'owner'),(?,?,'approver')").bind(company,owner,company,reviewer),db.prepare("INSERT INTO periods(company_id,start_date,end_date) VALUES(?,'2026-01-01','2026-12-31')").bind(company)];
 for(const [id,code,name,kind,category]of [['cash','1000','Cash','asset','cash_bank'],['bank','1010','Bank','asset','cash_bank'],['receivable','1100','Receivables','asset','receivable'],['inventory','1200','Inventory','asset','inventory'],['payable','2100','Payables','liability','payable'],['opening_equity','3000','Opening equity','equity','general'],['revenue','4000','Revenue','income','general'],['expense','5000','Expense','expense','general']])statements.push(db.prepare('INSERT INTO accounts(company_id,id,code,name,kind,category) VALUES(?,?,?,?,?,?)').bind(company,id,code,name,kind,category));
 statements.push(db.prepare("INSERT INTO parties(company_id,id,name,kind) VALUES(?,'synthetic-customer','SYNTHETIC QA Customer','customer'),(?,'synthetic-supplier','SYNTHETIC QA Supplier','supplier')").bind(company,company));
 await db.batch(statements);
 console.log(JSON.stringify({company,owner,reviewer,ownerToken:await issueGrant(db,owner),reviewerToken:await issueGrant(db,reviewer)}));
}finally{await db.close();}
