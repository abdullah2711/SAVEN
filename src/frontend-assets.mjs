// New testing UI only. Legacy frontend remains in reference/, outside public assets.
//
// The served allowlist is the exact inventory of public/live/. It previously
// listed nine files that no longer exist (catalog.js, model.js, invoice-model.js,
// workspaces.js, theme.css, portals.js, accounting-ui.js, accounting-model.js,
// accounting-setup.js) and omitted six that do (accounting.js, administration.js,
// pages.js, style.css, trade.js, workspace.js), so the document could not load its
// own stylesheet and eleven allowed URLs returned nothing.
//
// Cloudflare's ASSETS binding roots at public/, therefore the live document is
// addressed as /live/index.html and its siblings as /live/<file>. The published
// URLs stay flat (/style.css, /app.js) because that is what index.html requests;
// /ui/<file> is retained as an alias for older bookmarks.
export const frontendFiles=new Set(['app.js','icons.js','pages.js','workspace.js','accounting.js','administration.js','trade.js','style.css']);
export const frontendDocuments=new Set(['index.html','logo.svg']);
export const liveRoot='/live/';
export const frontendHeaders={'Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'none'; img-src 'self' data:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'",'X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','Cache-Control':'no-store'};

// Maps a published URL onto the asset binding. Returns null when the path is not
// part of the served frontend, so callers can answer 410/404 without touching assets.
export function frontendTarget(pathname){
  if(['/','/index.html','/operator/','/subscriptions/'].includes(pathname))return liveRoot;
  const file=pathname.startsWith('/ui/')?pathname.slice(4):(pathname.startsWith('/')&&pathname.indexOf('/',1)===-1?pathname.slice(1):null);
  if(!file)return null;
  return frontendFiles.has(file)||frontendDocuments.has(file)?liveRoot+file:null;
}

export async function frontendAsset(request,readAsset){
  const url=new URL(request.url),p=url.pathname;
  if(!['GET','HEAD'].includes(request.method))return new Response('Frontend assets are read only.',{status:405,headers:frontendHeaders});
  if(p==='/design'||p.startsWith('/design/'))return new Response(null,{status:302,headers:{...frontendHeaders,Location:'/'+url.search}});
  if(['/operator','/subscriptions'].includes(p))return new Response(null,{status:308,headers:{...frontendHeaders,Location:p+'/'+url.search}});
  const target=frontendTarget(p);
  if(!target)return new Response('The previous testing interface has been retired.',{status:p.startsWith('/api/')?404:410,headers:frontendHeaders});
  const response=await readAsset(new Request(new URL(target,url.origin),{method:request.method,headers:request.headers}));
  // Static-asset hosting may normalise /live/<file> with a same-origin redirect.
  // Follow it once so the document is never handed a 308 for its own stylesheet.
  const destination=response.status>=300&&response.status<400?response.headers.get('location'):null;
  const replay=destination?new URL(destination,url.origin):null;
  const settled=replay&&replay.origin===url.origin&&!['/','/index.html','/operator/','/subscriptions/'].includes(replay.pathname)?await readAsset(new Request(replay,{method:request.method,headers:request.headers})):response;
  const headers=new Headers(settled.headers);
  for(const [k,v] of Object.entries(frontendHeaders))headers.set(k,v);
  return new Response(settled.body,{status:settled.status,headers});
}
