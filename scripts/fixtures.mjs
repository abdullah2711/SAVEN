import { hash,token } from '../src/crypto.mjs';
import { now } from '../src/auth.mjs';

// Synthetic fixtures ONLY. Never invoked by the deployed Worker.
export async function seed(db) {
  if(await db.prepare('SELECT id FROM users LIMIT 1').first()) return;
  const statements=[];
  for(const [id,name] of [['alpha','Northstar Industries'],['beta','Cedar Services']]) {
    statements.push(db.prepare('INSERT INTO companies(id,name,currency) VALUES(?,?,?)').bind(id,name,'PKR'));
    statements.push(db.prepare('INSERT INTO periods(company_id,start_date,end_date) VALUES(?,?,?)').bind(id,'2020-01-01','2099-12-31'));
    for(const [account,code,label,kind] of [['cash','1000','Cash in hand','asset'],['bank','1010','Operating bank','asset'],['receivable','1100','Trade receivables','asset'],['inventory','1200','Inventory','asset'],['revenue','4000','Service revenue','income'],['expense','5000','Stores consumed','expense']]) {
      statements.push(db.prepare('INSERT INTO accounts(company_id,id,code,name,kind) VALUES(?,?,?,?,?)').bind(id,account,code,label,kind));
    }
    statements.push(db.prepare('INSERT INTO parties(company_id,id,name) VALUES(?,?,?)').bind(id,'customer',id==='alpha'?'Horizon Trading':'Cedar customer'));
    statements.push(db.prepare('INSERT INTO items(company_id,id,name,store,unit,on_hand,unit_cost_minor,inventory_account,expense_account) VALUES(?,?,?,?,?,?,?,?,?)').bind(id,'tissue','Tissue box','Main store','box',120,25000,'inventory','expense'));
  }
  for(const [id,name,role] of [['owner','Business owner','owner'],['preparer','Ayesha Khan','preparer'],['reviewer','Omar Ahmed','approver'],['viewer','Read-only accountant','viewer'],['outsider','Cedar owner','owner']]) {
    statements.push(db.prepare('INSERT INTO users(id,email,name) VALUES(?,?,?)').bind(id,`${id}@example.invalid`,name));
    statements.push(db.prepare('INSERT INTO memberships(company_id,user_id,role) VALUES(?,?,?)').bind(id==='outsider'?'beta':'alpha',id,role));
  }
  // One real identity may belong to multiple companies with different authority.
  statements.push(db.prepare('INSERT INTO memberships(company_id,user_id,role) VALUES(?,?,?)').bind('beta','preparer','preparer'));
  await db.batch(statements);
}
export async function issueGrant(db,userId) {
  const value=token();
  await db.prepare('INSERT INTO login_grants(token_hash,user_id,expires_at) VALUES(?,?,?)').bind(await hash(value),userId,now()+900).run();
  return value;
}
