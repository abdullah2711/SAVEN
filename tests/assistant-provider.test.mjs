import test from 'node:test';
import assert from 'node:assert/strict';
import {ModelProvider} from '../src/assistant-provider.mjs';
const valid={reply:'Review the proposed document.',tool:'none',arguments:'',document:'',configuration:'',page:'sales',citations:['workspace']};
test('model adapter requires structured output, bounds generation and keeps the key server-side',async()=>{
 let sent;const provider=new ModelProvider({url:'https://provider.example/v1',protocol:'openai-compatible',model:'approved-model',apiKey:'synthetic-provider-secret',fetcher:async(url,options)=>{sent={url,options,payload:JSON.parse(options.body)};return new Response(JSON.stringify({choices:[{message:{content:JSON.stringify(valid)}}],usage:{prompt_tokens:10,completion_tokens:20}}));}});
 const result=await provider.complete([{role:'user',content:'Prepare an entry'}]);assert.equal(sent.payload.response_format.json_schema.strict,true);assert.equal(sent.payload.max_completion_tokens,1100);assert.equal(sent.options.headers.authorization,'Bearer synthetic-provider-secret');assert.equal(result.inputTokens,10);assert.equal(JSON.stringify(result).includes('synthetic-provider-secret'),false);
});
test('unapproved model actions and malformed replies are rejected before any business tool',async()=>{
 for(const content of ['not JSON',JSON.stringify({...valid,tool:'approve'}),JSON.stringify({...valid,actorId:'owner'})]){const provider=new ModelProvider({url:'http://127.0.0.1:11434',fetcher:async()=>new Response(JSON.stringify({message:{content}}))});await assert.rejects(()=>provider.complete([{role:'user',content:'test'}]),e=>e.code==='AI_RESPONSE');}
 const provider=new ModelProvider({url:'http://127.0.0.1:11434',fetcher:async()=>{throw Error('must not run');}});await assert.rejects(()=>provider.complete([{role:'user',content:'picture'}],{images:[{mediaType:'image/png',data:'abc'}]}),e=>e.code==='VISION_UNAVAILABLE');
 assert.throws(()=>new ModelProvider({url:'http://public-model.example'}),e=>e.code==='AI_CONFIGURATION');
});
