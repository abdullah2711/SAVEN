import {createServer} from 'node:http';
import {Readable} from 'node:stream';
import {PostgresDatabase} from './postgres.mjs';
import {api,securityHeaders,json} from '../src/api.mjs';
import {cookieToken} from '../src/auth.mjs';
import {hash} from '../src/crypto.mjs';

// Only the API runs here. The existing Cloudflare Worker serves static assets
// and reaches this loopback-only service through one restricted VPC binding.
const origin=process.env.PUBLIC_ORIGIN;
if(!origin||!/^https:\/\/[^/]+$/.test(origin))throw new Error('PUBLIC_ORIGIN must be the exact HTTPS testing origin.');
const allowedOrigins=new Set([origin,...(process.env.ADDITIONAL_ORIGINS??'').split(',').filter(Boolean)]);
const db=PostgresDatabase.connect(process.env.DATABASE_URL?{connectionString:process.env.DATABASE_URL}:{host:'/var/run/postgresql',database:'saven_testing',user:process.env.PGUSER??'esc'});
if(!await db.schemaReady())throw new Error('Apply PostgreSQL migrations before starting SAVEN.');
const server=createServer({maxHeaderSize:16384},async(incoming,outgoing)=>{
  try{
    const method=incoming.method??'GET',path=incoming.url??'/';
    if(!path.startsWith('/api/')){outgoing.writeHead(404);outgoing.end();return;}
    const requestedOrigin=incoming.headers['x-saven-public-origin'];
    if(requestedOrigin&&!allowedOrigins.has(requestedOrigin)){outgoing.writeHead(403,securityHeaders);outgoing.end('Origin denied.');return;}
    const request=new Request(`${requestedOrigin??origin}${path}`,{method,headers:incoming.headers,...(!['GET','HEAD'].includes(method)?{body:Readable.toWeb(incoming),duplex:'half'}:{})});
    const session=cookieToken(request),scope={sessionHash:session?await hash(session):''};
    if(path==='/api/session'&&method==='POST') {
      // Grant scope is a hash, not a user/company selector supplied by a client.
      const declared=Number(incoming.headers['content-length']);
      if(!Number.isFinite(declared)||declared>16384){const response=json({error:{code:'BODY_TOO_LARGE',message:'Provide a bounded invitation request.'}},413);outgoing.writeHead(response.status,Object.fromEntries(response.headers));outgoing.end(await response.text());return;}
      try {const input=await request.clone().json();if(typeof input.token==='string'&&/^[a-f0-9]{64}$/.test(input.token))scope.grantHash=await hash(input.token);}catch{}
    }
    const response=await api(request,{DB:db.scoped(scope),ENVIRONMENT:'testing-postgresql'});
    outgoing.writeHead(response.status,Object.fromEntries(response.headers));outgoing.end(method==='HEAD'?undefined:Buffer.from(await response.arrayBuffer()));
  } catch {outgoing.writeHead(500,securityHeaders);outgoing.end('Request failed.');}
});
server.requestTimeout=15000;server.headersTimeout=10000;server.keepAliveTimeout=5000;
server.listen(Number(process.env.PORT??8788),process.env.BIND_HOST??'127.0.0.1',()=>console.log('SAVEN PostgreSQL API ready'));
function close(){server.close(async()=>{await db.close();process.exit(0);});}
process.on('SIGTERM',close);process.on('SIGINT',close);
