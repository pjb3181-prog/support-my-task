'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
const src=fs.readFileSync(path.join(__dirname,'..','world_editor_lab.js'),'utf8');
const start=src.indexOf('const CALL_TIMEOUT_MS='),end=src.indexOf('function jsonResult(',start);
assert.ok(start>0&&end>start);
const BLOCKED={type:'fail',result:'Plugin calls are blocked by the caller.'};
// `respond(opts, n)` decides each model response; n is the 1-based call number.
function harness(initial=[],respond){
 const requests=[],saved=[],store=new Map(),writes=[];
 const ok={type:'success',result:'세계를 어떻게 바꿀지 함께 정해 보자.'};
 const env={
  str:x=>String(x??''),
  setTimeout,clearTimeout,Date,Math,Object,Promise,Error,JSON,
  dialogue:initial.map(x=>({...x})),notes:'',status:'',model:'model',
  cut:(x,n=12000)=>String(x??'').slice(0,n),
  sourceSummary:()=>({name:'Test',fields:{}}),
  character:{name:'Test'},
  persist:async()=>saved.push(1),
  risuai:{
   pluginStorage:{
    getItem:async k=>store.has(k)?JSON.parse(store.get(k)):null,
    setItem:async(k,v)=>{writes.push(v);if(v===null)store.delete(k);else store.set(k,JSON.stringify(v));}},
   runLLMModel:async opts=>{requests.push(opts);return respond?await respond(opts,requests.length,store):ok;}},
 };
 const fn=vm.runInNewContext(src.slice(start,end)+'({ai,discuss,callModel,pluginBlocked})',env);
 return {fn,env,requests,saved,store,writes};
}

test('first user input invokes RisuBard model and creates an assistant discussion turn',async()=>{
 const h=harness();
 await h.fn.discuss('현대 한국과 수인 사회를 합치자');
 assert.equal(h.requests.length,1);
 assert.equal(h.requests[0].mode,'model');
 assert.equal(h.requests[0].allowPlugins,false);
 assert.ok(h.requests[0].messages.some(x=>x.role==='user'&&x.content.includes('현대 한국과 수인 사회')));
 assert.equal(h.env.dialogue.length,2);
 assert.equal(h.env.dialogue[1].role,'assistant');
 assert.ok(h.env.dialogue[1].content.includes('함께 정해 보자'));
});
test('retry answers a previously unanswered user message without duplicating it',async()=>{
 const h=harness([{role:'user',content:'이전에 내가 결정한 설정'}]);
 await h.fn.discuss('');
 assert.equal(h.env.dialogue.length,2);
 assert.equal(h.env.dialogue.filter(x=>x.role==='user').length,1);
 assert.equal(h.requests.length,1);
 assert.ok(h.requests[0].messages.some(x=>x.content.includes('이전에 내가 결정한 설정')));
});
test('new input after earlier failures retains previous unanswered prompts',async()=>{
 const h=harness([{role:'user',content:'첫 설정'},{role:'user',content:'두 번째 설정'}]);
 await h.fn.discuss('세 번째 수정 지시');
 assert.equal(h.env.dialogue.length,4);
 assert.equal(h.env.dialogue.at(-1).role,'assistant');
 assert.ok(h.requests[0].messages.some(x=>x.content==='첫 설정'));
 assert.ok(h.requests[0].messages.some(x=>x.content==='세 번째 수정 지시'));
});

// ---- fallback classification ----
test('only the plugin-blocked compatibility failure is retried with allowPlugins:true',async()=>{
 const h=harness([],async(o,n)=>n===1?BLOCKED:{type:'success',result:'플러그인 모델 응답'});
 const out=await h.fn.ai([{role:'system',content:'s'},{role:'user',content:'u'}]);
 assert.equal(out,'플러그인 모델 응답');
 assert.deepEqual(h.requests.map(x=>x.allowPlugins),[false,true]);
});
test('API, network and rate-limit failures are NOT retried (no duplicate cost)',async()=>{
 for(const failure of [{type:'fail',result:'HTTP 429 rate limit'},{type:'fail',result:'fetch failed'},{type:'error',result:'x'},{type:'success',result:''}]){
  const h=harness([],async()=>failure);
  await assert.rejects(()=>h.fn.ai([{role:'system',content:'s'}]));
  assert.equal(h.requests.length,1,'no retry for '+JSON.stringify(failure));
 }
});
test('a thrown error from the model call is not retried and propagates',async()=>{
 const h=harness([],async()=>{throw Error('boom');});
 await assert.rejects(()=>h.fn.ai([{role:'system',content:'s'}]),/boom/);
 assert.equal(h.requests.length,1);
});
test('when both attempts are blocked the user gets a clear failure after exactly two requests',async()=>{
 const h=harness([],async()=>BLOCKED);
 await assert.rejects(()=>h.fn.ai([{role:'system',content:'s'}]),/호출 실패/);
 assert.equal(h.requests.length,2);
});

// ---- streaming ----
function stream(chunks,failAt){
 let i=0;
 return {type:'streaming',result:{getReader:()=>({
  read:async()=>{
   if(failAt===i)throw Error('stream cut');
   return i<chunks.length?{done:false,value:chunks[i++]}:{done:true};},
  cancel:async()=>{}})}};
}
test('cumulative stream chunks are assembled into the full text',async()=>{
 const h=harness([],async()=>stream([{0:'세계'},{0:'세계를'},{0:'세계를 바꾼다'}]));
 assert.equal(await h.fn.ai([{role:'system',content:'s'}]),'세계를 바꾼다');
});
test('a stream that errors mid-way fails the call instead of saving a partial answer',async()=>{
 const h=harness([],async()=>stream([{0:'부분'}],1));
 await assert.rejects(()=>h.fn.ai([{role:'system',content:'s'}]),/stream cut/);
 assert.equal(h.requests.length,1,'a broken stream must not trigger a second paid request');
});
test('an empty stream is rejected',async()=>{
 const h=harness([],async()=>stream([]));
 await assert.rejects(()=>h.fn.ai([{role:'system',content:'s'}]),/비어/);
});

// ---- internal-call tokens (no shared state) ----
test('the request carries a per-call token and asks the model to echo a result token, which is stripped',async()=>{
 const h=harness([],async opts=>{
  const echo=opts.messages[0].content.match(/\[\[RISUBARD_INTERNAL_RESULT:[^\]]+\]\]/)[0];
  return {type:'success',result:echo+'\n본문 응답'};
 });
 const out=await h.fn.ai([{role:'system',content:'system prompt'},{role:'user',content:'u'}]);
 const sys=h.requests[0].messages[0].content;
 assert.match(sys,/\[\[RISUBARD_INTERNAL_CALL:wel-[a-z0-9-]+\]\]/);
 assert.match(sys,/\[\[RISUBARD_INTERNAL_RESULT:wel-[a-z0-9-]+\]\]/);
 assert.equal(h.requests[0].messages[1].content,'u');
 assert.equal(out,'본문 응답');
 assert.equal(h.store.size,0,'no shared state is written');
});
test('a hung model call times out and rejects',async()=>{
 const h=harness([],()=>new Promise(()=>{}));
 h.env.setTimeout=(fn,ms)=>setTimeout(fn,ms>=120000?5:ms);
 await assert.rejects(()=>h.fn.ai([{role:'system',content:'s'}]),/시간 초과/);
});
test('overlapping internal calls get distinct tokens',async()=>{
 const h=harness([],async()=>({type:'success',result:'ok'}));
 await Promise.all([h.fn.ai([{role:'system',content:'a'}]),h.fn.ai([{role:'system',content:'b'}])]);
 const ids=h.requests.map(r=>r.messages[0].content.match(/CALL:(wel-[a-z0-9-]+)/)[1]);
 assert.equal(new Set(ids).size,2);
});
test('an echo-only response is rejected as empty',async()=>{
 const h=harness([],async opts=>({type:'success',result:opts.messages[0].content.match(/\[\[RISUBARD_INTERNAL_RESULT:[^\]]+\]\]/)[0]}));
 await assert.rejects(()=>h.fn.ai([{role:'system',content:'s'}]),/비어/);
});
