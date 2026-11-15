import {readFileSync} from 'node:fs';
import {ModelProvider} from '../assistant-provider.mjs';
import {requireThat} from '../errors.mjs';

// Only the server loads secrets. No environment object is exposed to a browser or log.
export function configuredModel(env=process.env,{readSecret=path=>readFileSync(path,'utf8'),fetcher=fetch}={}){
 if(!env.AI_URL)return null;
 const protocol=env.AI_PROTOCOL??'ollama',model=env.AI_MODEL??'qwen3:1.7b';
 let key=env.AI_API_KEY??'';
 requireThat(!(key&&env.AI_API_KEY_FILE),503,'AI_CONFIGURATION','Choose one server-side AI secret source.');
 if(env.AI_API_KEY_FILE){try{key=readSecret(env.AI_API_KEY_FILE).trim();}catch{requireThat(false,503,'AI_CONFIGURATION','The server-side AI secret could not be loaded.');}}
 requireThat(typeof key==='string'&&key.length<=4096&&!/[\r\n]/.test(key),503,'AI_CONFIGURATION','The server-side AI secret is invalid.');
 const url=new URL(env.AI_URL),router=url.hostname==='openrouter.ai';
 if(router){
  requireThat(url.href.replace(/\/$/,'')==='https://openrouter.ai/api/v1'&&protocol==='openai-compatible'&&model==='nvidia/nemotron-3.5-lightning:free'&&key.length>8,503,'AI_CONFIGURATION','OpenRouter requires the approved free model, HTTPS endpoint, compatible protocol and a server-side key.');
 }
 return new ModelProvider({url:env.AI_URL,model,protocol,apiKey:key,fetcher,responseMode:router?'tool':'json-schema',timeout:90000,contextTokens:8192,outputTokens:512});
}
