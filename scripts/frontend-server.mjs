import http from 'node:http';
import {readFile} from 'node:fs/promises';
import {createServerPreview} from '../src/server-preview.mjs';
const origins=(process.env.PREVIEW_ORIGINS??'').split(',').filter(Boolean);
if(!origins.length||origins.some(o=>new URL(o).protocol!=='https:'||new URL(o).origin!==o))throw Error('Explicit exact HTTPS testing origins required');
const port=Number(process.env.PREVIEW_PORT??8792);
if(!Number.isInteger(port)||port<1024||port>65535)throw Error('Invalid preview port');
const handle=createServerPreview({origins,forward:request=>fetch(request,{signal:AbortSignal.timeout(100000)}),readAsset:async request=>{
 const pathname=new URL(request.url).pathname,file=pathname==='/'?'/index.html':pathname;
 const bytes=await readFile(new URL('../archive/saventesting-20261114/public'+file,import.meta.url));
 return new Response(request.method==='HEAD'?null:bytes,{headers:{'Content-Type':file.endsWith('.js')?'text/javascript; charset=utf-8':file.endsWith('.css')?'text/css; charset=utf-8':file.endsWith('.svg')?'image/svg+xml':'text/html; charset=utf-8'}});
}});
const server=http.createServer(async(req,res)=>{try{
 const origin=origins.find(value=>new URL(value).host===req.headers.host);
 if(!origin||!req.url.startsWith('/')||req.url.startsWith('//')){res.writeHead(421);res.end();return;}
 let size=0;const chunks=[];for await(const chunk of req){size+=chunk.length;if(size>10*1024*1024){res.writeHead(413);res.end();return;}chunks.push(chunk);}
 const response=await handle(new Request(origin+req.url,{method:req.method,headers:req.headers,...(!['GET','HEAD'].includes(req.method)?{body:Buffer.concat(chunks)}:{})}));
 res.writeHead(response.status,Object.fromEntries(response.headers));res.end(Buffer.from(await response.arrayBuffer()));
}catch{res.writeHead(500);res.end('Testing frontend unavailable');}});
server.requestTimeout=20000;server.headersTimeout=10000;server.maxRequestsPerSocket=100;
server.listen(port,'127.0.0.1',()=>console.log('SA7EN server-hosted testing frontend ready; synthetic UI and retained local reference API'));
for(const signal of ['SIGTERM','SIGINT'])process.on(signal,()=>server.close(()=>process.exit(0)));
