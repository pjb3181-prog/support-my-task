'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {loadPlugin,TOKEN,chat}=require('./helpers/plugin_vm.cjs');
const MARKER='<SR_SCENE_COMPLETE/>';
const active=(id='x')=>({calls:{[id]:{owner:'world_editor_lab',at:Date.now(),expires:Date.now()+60000}}});
const expired=()=>({calls:{old:{owner:'world_editor_lab',at:1,expires:2}}});
const put=(store,v)=>store.set('risubard_internal_call_v1',JSON.stringify(v));
const readSrc=f=>fs.readFileSync(path.join(__dirname,'..',f),'utf8');

// ---- 1. Story Runner alone ----
test('Story Runner alone: normal reply keeps working and its status marker is stripped',async()=>{
  const sr=await loadPlugin('story_runner.ts');
  assert.deepEqual(Object.keys(sr.replacers).sort(),['afterRequest','beforeRequest']);
  assert.equal(await sr.replacers.afterRequest('장면 본문'+MARKER,'model'),'장면 본문');
  assert.ok(Array.isArray(await sr.replacers.beforeRequest(chat(),'model')));
});
test('Story Runner alone: auxiliary modes are returned untouched',async()=>{
  const sr=await loadPlugin('story_runner.ts');
  for(const mode of ['memory','otherAx','emotion','translate']){
    const m=chat();
    assert.equal(await sr.replacers.beforeRequest(m,mode),m,mode);
    assert.equal(await sr.replacers.afterRequest('JSON'+MARKER,mode),'JSON'+MARKER,mode);
  }
});

// ---- 2. Mutation + Story Runner active together ----
test('Mutation + Story Runner together: auxiliary requests pass through both unchanged',async()=>{
  const store=new Map();
  const mut=await loadPlugin('mutation_state.ts',{store}),sr=await loadPlugin('story_runner.ts',{store});
  for(const mode of ['memory','otherAx','emotion']){
    const m=chat();
    const a=await mut.replacers.beforeRequest(m,mode),b=await sr.replacers.beforeRequest(a,mode);
    assert.equal(b,m,mode);
  }
});
test('Mutation + Story Runner together: a tagged internal request is untouched even in main-model mode',async()=>{
  const store=new Map();
  const mut=await loadPlugin('mutation_state.ts',{store}),sr=await loadPlugin('story_runner.ts',{store});
  const m=chat('\n'+TOKEN);
  assert.equal(await mut.replacers.beforeRequest(m,'model'),m);
  assert.equal(await sr.replacers.beforeRequest(m,'model'),m);
});
test('Mutation + Story Runner together: a normal main-model chat still runs both hooks',async()=>{
  const store=new Map();
  const mut=await loadPlugin('mutation_state.ts',{store}),sr=await loadPlugin('story_runner.ts',{store});
  const out=await sr.replacers.beforeRequest(await mut.replacers.beforeRequest(chat(),'model'),'model');
  assert.ok(Array.isArray(out)&&out.length>=2);
});

// ---- 3. Internal call vs concurrent normal chat ----
test('afterRequest bypass lasts only while an internal call is registered (expired entries are ignored)',async()=>{
  const store=new Map(),sr=await loadPlugin('story_runner.ts',{store});
  put(store,active());
  assert.equal(await sr.replacers.afterRequest('본문'+MARKER,'model'),'본문'+MARKER,'documented limitation: a concurrent story reply is left untouched');
  put(store,expired());
  assert.equal(await sr.replacers.afterRequest('본문'+MARKER,'model'),'본문');
  store.delete('risubard_internal_call_v1');
  assert.equal(await sr.replacers.afterRequest('본문'+MARKER,'model'),'본문');
});
test('beforeRequest is per request: normal chat during an internal call is still processed, the tagged request is not',async()=>{
  const store=new Map(),bard=await loadPlugin('bard_editor_lab.js',{store});
  put(store,active());
  const normal=chat();
  assert.notEqual(await bard.replacers.beforeRequest(normal,'model'),normal,'normal chat still receives editor guidance');
  const tagged=chat('\n'+TOKEN);
  assert.equal(await bard.replacers.beforeRequest(tagged,'model'),tagged);
});
test('Bard Editor Lab afterRequest does not revise a reply while an internal call is registered',async()=>{
  const store=new Map(),bard=await loadPlugin('bard_editor_lab.js',{store});
  put(store,active());
  const reply='그녀는 어김없이 고개를 숙였다. '.repeat(30);
  assert.equal(await bard.replacers.afterRequest(reply,'model'),reply);
});

// ---- 4. real World Editor Lab call path with the real hooks sharing one store ----
test('World Editor Lab call: the real hooks recognise it while it runs; the registry is empty afterwards',async()=>{
  const src=readSrc('world_editor_lab.js');
  const start=src.indexOf('const MARK='),end=src.indexOf('function jsonResult(',start);
  const store=new Map(),sr=await loadPlugin('story_runner.ts',{store}),mut=await loadPlugin('mutation_state.ts',{store});
  const seen={};
  const env={str:x=>String(x??''),setTimeout,clearTimeout,Date,Math,Object,Promise,Error,JSON,cut:(x,n=12000)=>String(x??'').slice(0,n),
    risuai:{pluginStorage:{getItem:async k=>store.has(k)?JSON.parse(store.get(k)):null,setItem:async(k,v)=>{if(v===null)store.delete(k);else store.set(k,JSON.stringify(v));}},
      runLLMModel:async opts=>{
        seen.messages=opts.messages;
        seen.before=[await mut.replacers.beforeRequest(opts.messages,'model'),await sr.replacers.beforeRequest(opts.messages,'model')];
        seen.after=await sr.replacers.afterRequest('JSON{"a":1}'+MARKER,'model');
        return {type:'success',result:'{"ok":true}'};}},
    model:'model',dialogue:[],notes:'',status:'',sourceSummary:()=>({}),character:{},persist:async()=>{}};
  const fn=vm.runInNewContext(src.slice(start,end)+'({ai})',env);
  await fn.ai([{role:'system',content:'JSON editor'},{role:'user',content:'edit'}]);
  assert.equal(seen.before[0],seen.messages);
  assert.equal(seen.before[1],seen.messages);
  assert.equal(seen.after,'JSON{"a":1}'+MARKER,'Story Runner must not strip or rewrite the internal JSON response');
  assert.equal(store.has('risubard_internal_call_v1'),false);
  assert.equal(await sr.replacers.afterRequest('본문'+MARKER,'model'),'본문','normal processing resumes');
});

// ---- 5. first message choices and image tags survive World Editor proposals ----
test('World Editor Lab refuses a first-message rewrite that drops choices or image tags',()=>{
  const src=readSrc('world_editor_lab.js');
  const a=src.indexOf('function protectedFirstMessageMarkers'),b=src.indexOf('async function makeDraft');
  const env={str:x=>String(x??''),cut:(x,n=12000)=>String(x??'').slice(0,n),arr:x=>Array.isArray(x)?x:[],FIELDS:['desc','personality','scenario','exampleMessage','firstMessage'],permitFirst:true};
  const f=vm.runInNewContext(src.slice(a,b)+'({normalizeProposal})',env);
  const origin={desc:'',personality:'',scenario:'',exampleMessage:'',globalLore:[],firstMessage:'환영해.\n{{img::intro}}\n① 문을 연다\n② 돌아간다'};
  assert.throws(()=>f.normalizeProposal({fields:{firstMessage:'환영해.\n① 문을 연다'}},origin),/선택지 또는 이미지 태그/);
  assert.throws(()=>f.normalizeProposal({fields:{firstMessage:'환영해.\n{{img::intro}}\n① 문을 연다'}},origin),/누락/);
  const ok=f.normalizeProposal({fields:{firstMessage:'새 환영.\n{{img::intro}}\n① 문을 연다\n② 돌아간다'}},origin);
  assert.ok(ok.fields.firstMessage);
});

// ---- 6. update regression: protections must survive a plugin update ----
const REQUIRED={
  'story_runner.ts':['hasInternalCallToken','internalCallActive',"requestKind !== 'model' && requestKind !== '__sr_direct__'",'recordRunnerReview','risubard_editorial_receipt_v1:','editorialSignature'],
  'mutation_state.ts':["requestModel && requestModel !== 'model'",'hasInternalCallToken','messages = scoped.messages'],
  'bard_editor_lab.js':['hasInternalCallToken','internalCallActive','runnerAlreadyReviewed','risubard_editorial_receipt_v1:','if(collabActive||state.busy)return messages','await watcherSeed'],
  'world_editor_lab.js':['pluginBlocked','[[RISUBARD_INTERNAL_CALL:','risubard_internal_call_v1','withTimeout'],
};
for(const [file,needles] of Object.entries(REQUIRED)){
  test('update guard: '+file+' keeps every required protection',()=>{
    const src=readSrc(file);
    for(const n of needles)assert.ok(src.includes(n),file+' lost: '+n);
  });
}
test('update guard: versioned copies stay identical to the live plugin files',()=>{
  const read=f=>readSrc(f).replace(/\r\n/g,'\n');
  assert.equal(read('bard_editor_lab_v0.3.10.ts'),read('bard_editor_lab.js'));
  assert.equal(read('World_Editor_Lab_v0.1.1.ts'),read('world_editor_lab.js'));
});
