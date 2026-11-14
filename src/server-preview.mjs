import {frontendAsset,frontendHeaders} from './frontend-assets.mjs';

// Server-hosted replacement for the retained testing Worker's ingress only.
// Financial authority remains in the unchanged local reference API.
export function createServerPreview({origins,readAsset,forward}){
 const allowed=new Set(origins.map(value=>new URL(value).origin));
 return async request=>{
  const url=new URL(request.url);
  if(!allowed.has(url.origin))return new Response('Unrecognized testing origin',{status:421});
  if(!url.pathname.startsWith('/api/'))return frontendAsset(request,readAsset);
  if(!['GET','HEAD'].includes(request.method)&&request.headers.get('origin')!==url.origin)return new Response('Origin verification failed',{status:403,headers:frontendHeaders});
  const headers=new Headers(request.headers);
  for(const name of ['host','connection','keep-alive','transfer-encoding','upgrade','proxy-authorization','proxy-authenticate','x-saven-public-origin','x-sa7en-relay-key','x-sa7en-relay-origin'])headers.delete(name);
  headers.set('x-saven-public-origin',url.origin);
  try{
   const response=await forward(new Request('http://127.0.0.1:8788'+url.pathname+url.search,{method:request.method,headers,redirect:'manual',...(!['GET','HEAD'].includes(request.method)?{body:request.body,duplex:'half'}:{})}));
   const result=new Response(response.body,{status:response.status,headers:response.headers});
   result.headers.set('Cache-Control','no-store');result.headers.set('X-Content-Type-Options','nosniff');result.headers.set('Strict-Transport-Security','max-age=31536000');
   return result;
  }catch{return new Response('The local reference API is unavailable',{status:503,headers:{'Cache-Control':'no-store','Retry-After':'30'}});}
 };
}
