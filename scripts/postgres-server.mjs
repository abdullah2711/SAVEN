import {createServer} from 'node:http';
import {Readable} from 'node:stream';
import {PostgresDatabase} from './postgres.mjs';
import {api,securityHeaders,json,body} from '../src/api.mjs';
import {securityApi} from '../src/security.mjs';
import {AppError} from '../src/errors.mjs';
import {cookieToken} from '../src/auth.mjs';
import {hash} from '../src/crypto.mjs';
import {servicesApi} from '../src/services.mjs';
import {LocalBucket,scanWithClamd} from '../src/object-store.mjs';
import {ModelProvider} from '../src/assistant-provider.mjs';
import {Assistant} from '../src/assistant.mjs';

// Only the API runs here. The existing Cloudflare Worker serves static assets
// and reaches this loopback-only service through one restricted VPC binding.
const origin=process.env.PUBLIC_ORIGIN;
if(!origin||!/^https:\/\/[^/]+$/.test(origin))throw new Error('PUBLIC_ORIGIN must be the exact HTTPS testing origin.');
const allowedOrigins=new Set([origin,...(process.env.ADDITIONAL_ORIGINS??'').split(',').filter(Boolean)]);
const db=PostgresDatabase.connect(process.env.DATABASE_URL?{connectionString:process.env.DATABASE_URL}:{host:'/var/run/postgresql',database:'saven_testing',user:process.env.PGUSER??'esc'});
if(!await db.schemaReady())throw new Error('Apply PostgreSQL migrations before starting SAVEN.');
const bucket=process.env.STORAGE_ROOT?new LocalBucket(process.env.STORAGE_ROOT):null;
const scanner=process.env.CLAMAV_HOST?bytes=>scanWithClamd(bytes,{host:process.env.CLAMAV_HOST,port:Number(process.env.CLAMAV_PORT??3310)}):null;
const provider=process.env.AI_BASE_URL?new ModelProvider({url:process.env.AI_BASE_URL,model:process.env.AI_MODEL,visionModel:process.env.AI_VISION_MODEL,protocol:process.env.AI_PROTOCOL,apiKey:process.env.AI_API_KEY}):null;
const assistant=new Assistant({provider,bucket});
const server=createServer({maxHeaderSize:16384},async(incoming,outgoing)=>{
  try{
    const method=incoming.method??'GET',path=incoming.url??'/';
    if(!path.startsWith('/api/')){outgoing.writeHead(404);outgoing.end();return;}
    const requestedOrigin=incoming.headers['x-saven-public-origin'];
    if(requestedOrigin&&!allowedOrigins.has(requestedOrigin)){outgoing.writeHead(403,securityHeaders);outgoing.end('Origin denied.');return;}
    let request=new Request(`${requestedOrigin??origin}${path}`,{method,headers:incoming.headers,...(!['GET','HEAD'].includes(method)?{body:Readable.toWeb(incoming),duplex:'half'}:{})});
    const session=cookieToken(request),scope={sessionHash:session?await hash(session):''};
    if(path==='/api/session'&&method==='POST') {
      // Grant scope is a hash, not a user/company selector supplied by a client.
      const input=await body(request);
      if(typeof input?.token==='string'&&/^[a-f0-9]{64}$/.test(input.token))scope.grantHash=await hash(input.token);
      request=new Request(request,{body:JSON.stringify(input),duplex:'half'});
    }
    const scoped=db.scoped(scope);
    const response=await securityApi(request,scoped)??await servicesApi(request,{db:scoped,bucket,scanner,assistant})??await api(request,{DB:scoped,ENVIRONMENT:'testing-postgresql'});
    outgoing.writeHead(response.status,Object.fromEntries(response.headers));outgoing.end(method==='HEAD'?undefined:Buffer.from(await response.arrayBuffer()));
  } catch(error) {const response=error instanceof AppError?json({error:{code:error.code,message:error.message}},error.status):json({error:{code:'INTERNAL_ERROR',message:'The action could not be completed.'}},500);outgoing.writeHead(response.status,Object.fromEntries(response.headers));outgoing.end(await response.text());}
});
server.requestTimeout=15000;server.headersTimeout=10000;server.keepAliveTimeout=5000;
server.listen(Number(process.env.PORT??8788),process.env.BIND_HOST??'127.0.0.1',()=>console.log('SAVEN PostgreSQL API ready'));
function close(){server.close(async()=>{await db.close();process.exit(0);});}
process.on('SIGTERM',close);process.on('SIGINT',close);
