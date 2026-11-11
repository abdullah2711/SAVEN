import { api, securityHeaders } from './api.mjs';
export default {
  async fetch(request,env) {
    const url=new URL(request.url);
    if(url.pathname.startsWith('/api/')) return api(request,env);
    if(!env.ASSETS) return new Response('SAVEN static assets are not configured.',{status:503,headers:securityHeaders});
    const response=await env.ASSETS.fetch(request);
    const headers=new Headers(response.headers);
    for(const [name,value] of Object.entries(securityHeaders)) headers.set(name,value);
    if(url.protocol==='https:') headers.set('Strict-Transport-Security','max-age=31536000');
    return new Response(response.body,{status:response.status,headers});
  }
};
