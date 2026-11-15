import test from 'node:test';
import assert from 'node:assert/strict';
import {configuredModel} from '../src/local/model-config.mjs';
const env={AI_URL:'https://openrouter.ai/api/v1',AI_PROTOCOL:'openai-compatible',AI_MODEL:'nvidia/nemotron-3.5-lightning:free',AI_API_KEY_FILE:'/protected/synthetic-key'};
const answer={reply:'Synthetic QA only.',tool:'none',arguments:'',document:'',configuration:'',page:'sales',citations:['workspace']};
test('server configuration preserves disabled/local models and reads the router key only from the chosen secret source',()=>{
 assert.equal(configuredModel({}),null);assert.equal(configuredModel({AI_URL:'http://127.0.0.1:11434'}).protocol,'ollama');
 const p=configuredModel(env,{readSecret:path=>{assert.equal(path,env.AI_API_KEY_FILE);return 'synthetic-test-secret\n';}});assert.equal(p.apiKey,'synthetic-test-secret');assert.equal(p.responseMode,'tool');
 assert.throws(()=>configuredModel({...env,AI_MODEL:'paid-model'},{readSecret:()=> 'synthetic-test-secret'}),e=>e.code==='AI_CONFIGURATION');
 assert.throws(()=>configuredModel({...env,AI_API_KEY:'conflicting-secret'}),e=>e.code==='AI_CONFIGURATION');
 assert.throws(()=>configuredModel(env,{readSecret:()=>{throw Error('private/path/or/key');}}),e=>e.code==='AI_CONFIGURATION'&&!e.message.includes('private/path'));
});
test('OpenRouter sends the exact free model with price caps, no fallback and a validated named response envelope',async()=>{
 let sent;const p=configuredModel(env,{readSecret:()=> 'synthetic-test-secret',fetcher:async(url,options)=>{sent={url,headers:options.headers,body:JSON.parse(options.body)};return new Response(JSON.stringify({choices:[{message:{tool_calls:[{type:'function',function:{name:'saven_response',arguments:JSON.stringify(answer)}}]}}],usage:{prompt_tokens:4,completion_tokens:8}}));}});
 const result=await p.complete([{role:'user',content:'Synthetic test.'}]);assert.equal(sent.url,'https://openrouter.ai/api/v1/chat/completions');assert.equal(sent.body.model,env.AI_MODEL);assert.equal(sent.body.max_tokens,512);assert.equal(sent.body.response_format,undefined);assert.deepEqual(sent.body.provider,{require_parameters:true,data_collection:'deny',allow_fallbacks:false,max_price:{prompt:0,completion:0}});assert.equal(sent.body.tool_choice.function.name,'saven_response');assert.equal(sent.headers.authorization,'Bearer synthetic-test-secret');assert.equal(result.answer.reply,answer.reply);assert.equal(JSON.stringify(result).includes('synthetic-test-secret'),false);
});
test('provider failures, malformed tools and oversized prompts never return an executable model action',async()=>{
 for(const value of [{choices:[{message:{content:JSON.stringify(answer)}}]},{choices:[{message:{tool_calls:[{type:'function',function:{name:'approve',arguments:JSON.stringify(answer)}}]}}]},{choices:[{message:{tool_calls:[{type:'function',function:{name:'saven_response',arguments:JSON.stringify({...answer,tool:'approve'})}}]}}]}]){
  const p=configuredModel(env,{readSecret:()=> 'synthetic-test-secret',fetcher:async()=>new Response(JSON.stringify(value))});await assert.rejects(()=>p.complete([{role:'user',content:'Synthetic'}]),e=>e.code==='AI_RESPONSE');
 }
 let calls=0;const p=configuredModel(env,{readSecret:()=> 'synthetic-test-secret',fetcher:async()=>{calls++;return new Response('provider private body',{status:429});}});await assert.rejects(()=>p.complete([{role:'user',content:'x'.repeat(9000)}]),e=>e.code==='AI_CONTEXT_LIMIT');assert.equal(calls,0);await assert.rejects(()=>p.complete([{role:'user',content:'Synthetic'}]),e=>e.code==='AI_PROVIDER_ERROR'&&!e.message.includes('private body'));assert.equal(calls,1);
});
