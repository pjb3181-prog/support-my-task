'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {loadPlugin,TOKEN,chat}=require('./helpers/plugin_vm.cjs');
const MARKER='<SR_SCENE_COMPLETE/>';
const RESULT='[[RISUBARD_INTERNAL_RESULT:wel-test]]';
const readSrc=f=>fs.readFileSync(path.join(__dirname,'..',f),'utf8');
const wait=ms=>new Promise(r=>setTimeout(r,ms));

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

// ---- 3. Internal call vs concurrent normal chat (per-request tokens, no shared state) ----
test('afterRequest: only the response carrying the internal result token is bypassed',async()=>{
  const sr=await loadPlugin('story_runner.ts');
  assert.equal(await sr.replacers.afterRequest(RESULT+'\n{"ok":1}'+MARKER,'model'),RESULT+'\n{"ok":1}'+MARKER);
  assert.equal(await sr.replacers.afterRequest('본문'+MARKER,'model'),'본문','a normal reply without the token is processed');
});
test('beforeRequest is per request: a normal chat is processed, only the tagged request is skipped',async()=>{
  const bard=await loadPlugin('bard_editor_lab.js');
  const normal=chat();
  assert.notEqual(await bard.replacers.beforeRequest(normal,'model'),normal,'normal chat still receives editor guidance');
  const tagged=chat('\n'+TOKEN);
  assert.equal(await bard.replacers.beforeRequest(tagged,'model'),tagged);
});
test('Bard Editor Lab afterRequest leaves an internal-call response alone',async()=>{
  const bard=await loadPlugin('bard_editor_lab.js');
  const reply=RESULT+'\n'+'그녀는 어김없이 고개를 숙였다. '.repeat(30);
  assert.equal(await bard.replacers.afterRequest(reply,'model'),reply);
});
test('no shared state: the hooks neither read nor write the old internal-call registry',()=>{
  for(const f of ['story_runner.ts','mutation_state.ts','bard_editor_lab.js','world_editor_lab.js'])
    assert.ok(!readSrc(f).includes('risubard_internal_call_v1'),f);
});

// ---- 4. World Editor Lab real call path while a normal chat finishes ----
function welHarness(store,runLLMModel){
  const src=readSrc('world_editor_lab.js');
  const start=src.indexOf('const CALL_TIMEOUT_MS='),end=src.indexOf('function jsonResult(',start);
  const env={str:x=>String(x??''),setTimeout,clearTimeout,Date,Math,Object,Promise,Error,JSON,cut:(x,n=12000)=>String(x??'').slice(0,n),
    risuai:{runLLMModel},model:'model',dialogue:[],notes:'',status:'',sourceSummary:()=>({}),character:{},persist:async()=>{}};
  return vm.runInNewContext(src.slice(start,end)+'({ai})',env);
}
test('World Editor Lab call: concurrent normal chat is processed, the internal call is not, echo token is removed',async()=>{
  const store=new Map(),sr=await loadPlugin('story_runner.ts',{store}),mut=await loadPlugin('mutation_state.ts',{store});
  const seen={};
  const fn=welHarness(store,async opts=>{
    seen.messages=opts.messages;
    const echo=opts.messages[0].content.match(/\[\[RISUBARD_INTERNAL_RESULT:[^\]]+\]\]/)[0];
    seen.before=[await mut.replacers.beforeRequest(opts.messages,'model'),await sr.replacers.beforeRequest(opts.messages,'model')];
    // a normal chat reply completes WHILE the internal call is in flight
    seen.normal=await sr.replacers.afterRequest('일반 채팅 응답'+MARKER,'model');
    // the internal response (model echoes the token)
    seen.internal=await sr.replacers.afterRequest(echo+'\n{"ok":true}'+MARKER,'model');
    return {type:'success',result:echo+'\n{"ok":true}'};
  });
  const out=await fn.ai([{role:'system',content:'JSON editor'},{role:'user',content:'edit'}]);
  assert.equal(seen.before[0],seen.messages);
  assert.equal(seen.before[1],seen.messages);
  assert.equal(seen.normal,'일반 채팅 응답','the concurrent normal reply must still be post-processed (marker stripped)');
  assert.match(seen.internal,/\{"ok":true\}<SR_SCENE_COMPLETE\/>/,'the internal response must be left untouched');
  assert.equal(out,'{"ok":true}','the echo token never reaches the editor');
  assert.ok(![...store.keys()].some(k=>/internal_call/i.test(k)),'no internal-call state was written');
});
test('World Editor Lab call: a model that ignores the echo instruction still works',async()=>{
  const fn=welHarness(new Map(),async()=>({type:'success',result:'{"ok":true}'}));
  assert.equal(await fn.ai([{role:'system',content:'s'}]),'{"ok":true}');
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

// ---- 6. streaming: afterRequest never runs, the committed-output listener must do the same work ----
async function streamHarness(messageData,{roleData}={}){
  const msg={role:'char',data:messageData,chatId:'m1'};
  const chatObj={id:'c1',message:[{role:'user',data:'hi'},msg]};
  const charObj={chaId:'cha1',name:'테스트',chats:[chatObj],chatPage:0};
  const saved=[];
  const sr=await loadPlugin('story_runner.ts',{extra:{
    getCurrentCharacterIndex:async()=>0,getCurrentChatIndex:async()=>0,
    getCharacterFromIndex:async()=>charObj,getChatFromIndex:async()=>chatObj,getCharacter:async()=>charObj,getChat:async()=>chatObj,
    setChatToIndex:async(ci,ti,next)=>{saved.push(next.message[1].data);},
  }});
  const fire=async()=>{await sr.listeners.output({characterIndex:0,chatIndex:0,messageIndex:1,chat:chatObj,char:charObj});await wait(80);};
  return {sr,saved,fire,msg};
}
test('streaming: Story Runner status markers left in a streamed reply are removed from the committed message',async()=>{
  const h=await streamHarness('스트리밍으로 받은 본문입니다.\n'+MARKER);
  await h.fire();
  assert.deepEqual(h.saved,['스트리밍으로 받은 본문입니다.']);
});
test('streaming: the episode status comment is removed too',async()=>{
  const h=await streamHarness('본문입니다.\n<!--SR_EPISODE_STATUS {"episode":1} -->');
  await h.fire();
  assert.deepEqual(h.saved,['본문입니다.']);
});
test('streaming: an already clean message (normal reply path) is not saved again (no double save)',async()=>{
  const h=await streamHarness('이미 정리된 본문입니다.');
  await h.fire();
  assert.deepEqual(h.saved,[]);
});
test('streaming: the cleanup never overwrites a message that changed in the meantime',async()=>{
  const h=await streamHarness('본문입니다.\n'+MARKER);
  // the committed message is edited (by the user or another plugin) before the cleanup runs
  const orig=h.sr.risuai.getChatFromIndex;
  h.sr.risuai.getChatFromIndex=async()=>({id:'c1',message:[{role:'user',data:'hi'},{role:'char',data:'다른 플러그인이 이미 고친 본문',chatId:'m1'}]});
  await h.fire();
  assert.deepEqual(h.saved,[]);
  assert.ok(orig);
});

// ---- 7. update regression: protections must survive a plugin update ----
const REQUIRED={
  'story_runner.ts':['hasInternalCallToken','hasInternalResultToken',"requestKind !== 'model' && requestKind !== '__sr_direct__'",'recordRunnerReview','risubard_editorial_receipt_v1:','editorialSignature','stripStatusMarkers','persistCleanedCommittedOutput','runPremiumRewrite','afterRequestQualityHandled'],
  'mutation_state.ts':["requestModel && requestModel !== 'model'",'hasInternalCallToken','messages = scoped.messages'],
  'bard_editor_lab.js':['hasInternalCallToken','hasInternalResultToken','runnerAlreadyReviewed','risubard_editorial_receipt_v1:','if(collabActive||state.busy)return messages','await watcherSeed','stripRunnerMarkers'],
  'world_editor_lab.js':['pluginBlocked','[[RISUBARD_INTERNAL_CALL:','[[RISUBARD_INTERNAL_RESULT:','withTimeout'],
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

// ---- 8. streaming: the premium (max quality) rewrite also runs for streamed replies, exactly once ----
const LONG='현수는 낡은 문을 밀었다. 먼지가 흩날렸고, 오래된 종이 냄새가 코끝을 찔렀다. 그는 잠시 숨을 고른 뒤 안으로 걸음을 옮겼다. 책상 위에는 누군가 급히 남긴 메모가 놓여 있었다. '.repeat(8);
const BETTER_LONG=LONG.replace('먼지가 흩날렸고','먼지가 햇빛 속에서 천천히 흩날렸고');
async function premiumHarness({quality='max',running=true,committed=LONG+'\n'+MARKER,editBeforeSave=false}={}){
  const msg={role:'char',data:committed,chatId:'m1'};
  const chatObj={id:'c1',message:[{role:'user',data:'hi'},msg]};
  const charObj={chaId:'cha1',name:'테스트',chats:[chatObj],chatPage:0};
  const store=new Map([['storyrunner_plugin_v1_cha1_c1',JSON.stringify({experienceMode:'ai',running,autoRun:false,writerQualityMode:quality})]]);
  const saved=[],critic=[],writer=[];let llmCount=0;
  const sr=await loadPlugin('story_runner.ts',{store,extra:{
    getCurrentCharacterIndex:async()=>0,getCurrentChatIndex:async()=>0,
    getCharacterFromIndex:async()=>charObj,getCharacter:async()=>charObj,getChat:async()=>chatObj,
    getChatFromIndex:async()=>editBeforeSave&&llmCount>=2?{id:'c1',message:[{role:'user',data:'hi'},{role:'char',data:'사용자가 그 사이에 직접 고친 본문',chatId:'m1'}]}:chatObj,
    setChatToIndex:async(ci,ti,next)=>{saved.push(next.message[1].data);},
    runLLMModel:async o=>{
      llmCount++;const sys=String(o.messages[0].content);
      if(/strict fiction critic/.test(sys)){critic.push(1);return {type:'success',result:'{"revise":true,"issues":["반복되는 묘사"]}'};}
      if(/revising a Korean fiction draft/.test(sys)){writer.push(1);return {type:'success',result:'<SR_STORY>'+BETTER_LONG+'</SR_STORY>'};}
      return {type:'success',result:'{"ok":true,"complete":false}'};}
  }});
  const fire=async()=>{await sr.listeners.output({characterIndex:0,chatIndex:0,messageIndex:1,chat:chatObj,char:charObj});await wait(150);};
  return {sr,store,saved,critic,writer,fire};
}
test('streaming + max quality: the streamed reply is rewritten once, saved once, marker removed, receipt written',async()=>{
  const h=await premiumHarness();
  await h.fire();
  assert.equal(h.critic.length,1);
  assert.equal(h.writer.length,1);
  assert.equal(h.saved.length,1,'exactly one save');
  assert.ok(h.saved[0].includes('햇빛 속에서 천천히'),'the revised text replaced the streamed text');
  assert.ok(!h.saved[0].includes(MARKER));
  assert.ok([...h.store.keys()].some(k=>k.startsWith('risubard_editorial_receipt_v1:')),'receipt lets Bard Editor Lab skip this passage');
});
test('normal (non-streaming) reply: afterRequest does the rewrite and the output listener does NOT repeat it or save again',async()=>{
  const h=await premiumHarness({committed:BETTER_LONG});
  await h.sr.replacers.beforeRequest(chat(),'model');
  const out=await h.sr.replacers.afterRequest(LONG+'\n'+MARKER,'model');
  assert.ok(out.includes('햇빛 속에서 천천히'));
  assert.equal(h.critic.length,1);
  await h.fire(); // the committed message is what afterRequest returned
  assert.equal(h.critic.length,1,'no second critic pass');
  assert.equal(h.writer.length,1,'no second rewrite');
  assert.deepEqual(h.saved,[],'no second save');
});
test('a new host request resets a stale handled flag (afterRequest ran but nothing was committed)',async()=>{
  const h=await premiumHarness({committed:BETTER_LONG});
  await h.sr.replacers.beforeRequest(chat(),'model');
  await h.sr.replacers.afterRequest(LONG,'model');   // sets the flag; the reply is never committed, so no listener consumes it
  const before=h.critic.length;
  await h.sr.replacers.beforeRequest(chat(),'model'); // next turn is streamed: no afterRequest, flag must have been reset
  await h.fire();
  assert.equal(h.critic.length,before+1,'the streamed reply was still quality-gated');
});
test('streaming + not max quality: only the marker is cleaned, no critic or rewrite call',async()=>{
  const h=await premiumHarness({quality:'strong'});
  await h.fire();
  assert.equal(h.critic.length,0);
  assert.equal(h.writer.length,0);
  assert.deepEqual(h.saved,[LONG.trim()]);
});
test('streaming + story runner not running: nothing is rewritten',async()=>{
  const h=await premiumHarness({running:false,committed:LONG});
  await h.fire();
  assert.equal(h.critic.length,0);
  assert.deepEqual(h.saved,[]);
});
test('streaming rewrite never overwrites a message the user edited while it was running',async()=>{
  const h=await premiumHarness({editBeforeSave:true});
  await h.fire();
  assert.equal(h.writer.length,1,'the rewrite ran');
  assert.deepEqual(h.saved,[],'but the edited message was not overwritten');
});
