import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { mkdirSync } from 'node:fs';
import { resolve,extname } from 'node:path';
import { Readable } from 'node:stream';
import worker from '../src/worker.mjs';
import { LocalDatabase } from './database.mjs';
import { seed,issueGrant } from './fixtures.mjs';

const root=resolve(import.meta.dirname,'..');
mkdirSync(resolve(root,'var'),{recursive:true});
const db=new LocalDatabase(resolve(root,'var/local.sqlite'));
db.migrate();
const port=Number(process.env.PORT??8787);
const origin=process.env.PUBLIC_ORIGIN??`http://127.0.0.1:${port}`;
if(process.argv.includes('--demo')) {
  await seed(db);
  for(const id of ['preparer','reviewer','owner','viewer','outsider']) {
    console.log(`${id}: http://127.0.0.1:${port}/#invite=${await issueGrant(db,id)}`);
  }
  console.log('Synthetic data. Invitations expire in 15 minutes and work once. Each account has one active session.');
}
const mime={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.svg':'image/svg+xml'};
const assets={async fetch(request){
  const pathname=new URL(request.url).pathname;
  const files={'/':'index.html','/index.html':'index.html','/app.js':'app.js','/management.js':'management.js','/assistant.js':'assistant.js','/files.js':'files.js','/transactions.js':'transactions.js','/services.css':'services.css','/styles.css':'styles.css','/management.css':'management.css','/sign-in.css':'sign-in.css','/logo.svg':'logo.svg'};
  if(!files[pathname])return new Response('Not found',{status:404});
  try{return new Response(await readFile(resolve(root,'public',files[pathname])),{headers:{'Content-Type':mime[extname(files[pathname])]}});}
  catch{return new Response('Asset unavailable',{status:404});}
}};
const server=createServer(async(incoming,outgoing)=>{
  try{
    const method=incoming.method??'GET';
    const request=new Request(`${origin}${incoming.url}`,{method,headers:incoming.headers,...(!['GET','HEAD'].includes(method)?{body:Readable.toWeb(incoming),duplex:'half'}:{})});
    const response=await worker.fetch(request,{DB:db,ASSETS:assets,ENVIRONMENT:'local'});
    outgoing.writeHead(response.status,Object.fromEntries(response.headers));
    if(method==='HEAD')outgoing.end();else outgoing.end(Buffer.from(await response.arrayBuffer()));
  }catch{outgoing.writeHead(500);outgoing.end('Request failed.');}
});
server.listen(port,process.env.BIND_HOST??'127.0.0.1',()=>console.log(`SAVEN listening on ${origin}`));
function close(){server.close(()=>{db.close();process.exit(0);});}
process.on('SIGINT',close);process.on('SIGTERM',close);
