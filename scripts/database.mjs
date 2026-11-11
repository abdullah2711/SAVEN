import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';

// Minimal D1-compatible adapter. The same command code executes in Workers.
// Local batch uses an immediate transaction; one failed statement rolls back all.
export class LocalDatabase {
  constructor(path=':memory:') {
    this.sqlite=new DatabaseSync(path);
    this.sqlite.exec('PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;');
  }
  migrate() {
    const exists=this.sqlite.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='users'").get();
    if(!exists) {
      this.sqlite.exec('BEGIN IMMEDIATE');
      try {this.sqlite.exec(readFileSync(new URL('../migrations/0001_foundation.sql',import.meta.url),'utf8'));this.sqlite.exec('COMMIT');}
      catch(error){this.sqlite.exec('ROLLBACK');throw error;}
    }
  }
  prepare(sql) {return new LocalStatement(this,sql,[]);}
  async batch(statements) {
    this.sqlite.exec('BEGIN IMMEDIATE');
    try {
      const result=statements.map(statement=>statement.execute());
      this.sqlite.exec('COMMIT');return result;
    } catch(error){this.sqlite.exec('ROLLBACK');throw error;}
  }
  close(){this.sqlite.close();}
}
class LocalStatement {
  constructor(db,sql,args){this.db=db;this.sql=sql;this.args=args;}
  bind(...args){return new LocalStatement(this.db,this.sql,args);}
  execute(){
    const stmt=this.db.sqlite.prepare(this.sql);
    if(stmt.columns().length){return {success:true,results:stmt.all(...this.args),meta:{changes:0}};}
    const result=stmt.run(...this.args);
    return {success:true,results:[],meta:{changes:Number(result.changes)}};
  }
  async first(column){const row=this.db.sqlite.prepare(this.sql).get(...this.args)??null;return column?row?.[column]??null:row;}
  async all(){return this.execute();}
  async run(){return this.execute();}
}
