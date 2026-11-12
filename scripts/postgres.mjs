import pg from 'pg';

// Keep the established prepared-command interface while using native PostgreSQL
// transactions. A scope belongs to one request, never to a pooled connection.
export function placeholders(sql) {
  let index=0, quoted=false, output='';
  for(let i=0;i<sql.length;i++) {
    const char=sql[i];
    if(char==="'") {
      output+=char;
      if(quoted&&sql[i+1]==="'"){output+=sql[++i];continue;}
      quoted=!quoted;
    } else output+=char==='?'&&!quoted?`$${++index}`:char;
  }
  return output;
}
function rows(result) {
  return result.rows.map(row=>Object.fromEntries(Object.entries(row).map(([key,value])=>{
    // The schema bounds monetary/quantity/time columns below JS's safe range.
    // SUMs remain strings and are converted only by report decimal code.
    const field=result.fields.find(field=>field.name===key);
    if(field?.dataTypeID===20&&value!==null) {
      const n=Number(value); if(!Number.isSafeInteger(n))throw new Error('INTEGER_RANGE');
      return [key,n];
    }
    return [key,value];
  })));
}
export class PostgresDatabase {
  constructor(pool,scope={}) {this.pool=pool;this.scope={...scope};this.dialect='postgresql';}
  static connect(config={}) {
    const pool=new pg.Pool({...config,max:8,connectionTimeoutMillis:5000,idleTimeoutMillis:30000,application_name:'saven-testing'});
    pool.on('error',()=>console.error(JSON.stringify({event:'database_pool_error'})));
    return new PostgresDatabase(pool);
  }
  scoped(scope) {return new PostgresDatabase(this.pool,scope);}
  adoptSession(sessionHash){this.scope.sessionHash=sessionHash;}
  prepare(sql){return new Statement(this,sql,[]);}
  async transaction(action) {
    const client=await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query("SELECT set_config('saven.session_hash',$1,true),set_config('saven.grant_hash',$2,true),set_config('statement_timeout','10000',true),set_config('lock_timeout','5000',true)",[this.scope.sessionHash??'',this.scope.grantHash??'']);
      const value=await action(client);await client.query('COMMIT');return value;
    } catch(error){await client.query('ROLLBACK');throw error;}
    finally{client.release();}
  }
  async batch(statements){return this.transaction(async client=>{const output=[];for(const s of statements)output.push(await s.execute(client));return output;});}
  async schemaReady(){try{return Number((await this.pool.query("SELECT version FROM schema_version WHERE version=1")).rows[0]?.version)===1;}catch{return false;}}
  async close(){await this.pool.end();}
}
class Statement {
  constructor(db,sql,args){this.db=db;this.sql=sql;this.args=args;}
  bind(...args){return new Statement(this.db,this.sql,args);}
  async execute(client){const result=await client.query(placeholders(this.sql),this.args);return {success:true,results:rows(result),meta:{changes:result.rowCount}};}
  async all(){return this.db.transaction(client=>this.execute(client));}
  async run(){return this.all();}
  async first(column){const row=(await this.all()).results[0]??null;return column?row?.[column]??null:row;}
}
