import {readFile} from 'node:fs/promises';
import {frontendAsset,frontendHeaders} from '../src/frontend-assets.mjs';
export const designHeaders=frontendHeaders;
export async function designAsset(request){return frontendAsset(request,async next=>{const pathname=new URL(next.url).pathname,path=pathname==='/'?'/index.html':pathname;const content=await readFile(new URL('../archive/saventesting-20261114/public'+path,import.meta.url));return new Response(next.method==='HEAD'?null:content,{headers:{'Content-Type':path.endsWith('.js')?'text/javascript; charset=utf-8':path.endsWith('.css')?'text/css; charset=utf-8':path.endsWith('.svg')?'image/svg+xml':'text/html; charset=utf-8'}});});}
