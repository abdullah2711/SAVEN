import {request as httpRequest} from 'node:http';

// Undici does not reliably preserve an overridden Host header. Only the explicit
// localhost acceptance transport needs that override; public HTTPS uses fetch.
export async function probeRequest(origin,path,{headers={},body,transport}={}) {
 const method=body===undefined?'GET':'POST';
 if(!transport){const r=await fetch(new URL(path,origin),{method,headers,body,signal:AbortSignal.timeout(100000)});return {status:r.status,headers:r.headers,bytes:Buffer.from(await r.arrayBuffer())};}
 const target=new URL(transport);
 if(target.protocol!=='http:'||!['127.0.0.1','[::1]','localhost'].includes(target.hostname)||target.username||target.password||target.pathname!=='/'||target.search||target.hash)throw Error('Acceptance transport must be an explicit localhost HTTP origin');
 return new Promise((resolve,reject)=>{
  const req=httpRequest(new URL(path,target),{method,headers:{...headers,host:new URL(origin).host}},res=>{
   const chunks=[];let size=0;
   res.on('data',chunk=>{size+=chunk.length;if(size>12*1024*1024){res.destroy(Error('Probe response too large'));return;}chunks.push(chunk);});
   res.on('error',reject);res.on('end',()=>{const resultHeaders=new Headers();for(const [name,value]of Object.entries(res.headers))if(value!==undefined)for(const v of Array.isArray(value)?value:[value])resultHeaders.append(name,v);resolve({status:res.statusCode,headers:resultHeaders,bytes:Buffer.concat(chunks)});});
  });
  req.setTimeout(100000,()=>req.destroy(Error('Acceptance request timed out')));req.on('error',reject);req.end(body);
 });
}
