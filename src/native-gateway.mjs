// Replaceable Cloudflare TLS adapter. It has no business/data authority.
export async function gatewayFetch(request,env,fetcher=fetch){
 const url=new URL(request.url),allowed=[env.APP_ORIGIN,env.OPERATOR_ORIGIN];
 if(!allowed.includes(url.origin))return new Response('Unrecognized application origin',{status:421});
 if(!/^[a-f0-9]{64}$/.test(env.RELAY_KEY??'')||!env.RELAY_ORIGIN)return new Response('Gateway not commissioned',{status:503});
 const relay=new URL(env.RELAY_ORIGIN);if(relay.protocol!=='https:'||relay.username||relay.password||allowed.includes(relay.origin))return new Response('Gateway not commissioned',{status:503});
 const outbound=new Request(new URL(url.pathname+url.search,relay),request);
 outbound.headers.delete('host');outbound.headers.set('x-sa7en-relay-key',env.RELAY_KEY);outbound.headers.set('x-sa7en-relay-origin',url.origin);
 // Preserve the browser Origin unchanged: the backend still enforces CSRF.
 try{return await fetcher(outbound,{redirect:'manual'});}catch{return new Response('The application service is temporarily unavailable',{status:503,headers:{'Cache-Control':'no-store'}});}
}
export default {fetch:gatewayFetch};
