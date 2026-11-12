import { api, securityHeaders, json } from './api.mjs';
import {edgeAssistant} from './edge-assistant.mjs';
export {AiBudget} from './edge-assistant.mjs';
export default {
  async fetch(request,env) {
    const url=new URL(request.url);
    if(url.pathname.startsWith('/api/')) {
      if(env.API_MODE==='maintenance')return json({error:{code:'MAINTENANCE',message:'The testing database is being migrated. Please try again shortly.'}},503,{'Retry-After':'60'});
      if(env.API_MODE==='postgresql'){
        if(!env.SAVEN_API)return json({error:{code:'SETUP_REQUIRED',message:'The private application connection is unavailable.'}},503);
        const assistant=await edgeAssistant(request,env);if(assistant)return assistant;
        try{
          const forwarded=new Request('http://saven.internal'+url.pathname+url.search,{method:request.method,headers:request.headers,redirect:'manual',...(!['GET','HEAD'].includes(request.method)?{body:request.body,duplex:'half'}:{})});
          forwarded.headers.set('X-Saven-Public-Origin',url.origin);
          const response=await env.SAVEN_API.fetch(forwarded);
          const headers=new Headers(response.headers);for(const [key,value]of Object.entries(securityHeaders))headers.set(key,value);
          return new Response(response.body,{status:response.status,headers});
        }catch{return json({error:{code:'BACKEND_UNAVAILABLE',message:'The application server is temporarily unavailable. Your records have not been moved to another database.'}},503,{'Retry-After':'30'});}
      }
      if(env.API_MODE)return json({error:{code:'SETUP_REQUIRED',message:'The application database route is not configured.'}},503);
      return api(request,env);
    }
    if(!env.ASSETS) return new Response('SAVEN static assets are not configured.',{status:503,headers:securityHeaders});
    const response=await env.ASSETS.fetch(request);
    const headers=new Headers(response.headers);
    for(const [name,value] of Object.entries(securityHeaders)) headers.set(name,value);
    if(url.protocol==='https:') headers.set('Strict-Transport-Security','max-age=31536000');
    return new Response(response.body,{status:response.status,headers});
  }
};
