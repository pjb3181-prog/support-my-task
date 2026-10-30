import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const source=readFileSync(new URL('../risubard-updates/bard_editor_lab.js',import.meta.url),'utf8');
const story=('하은은 대답을 곧바로 하지 않았다. 세상에 관한 설명보다 지금 무슨 선택을 하는지가 중요하다고 생각했다. '
+'그녀는 창밖의 버스 정류장을 바라보다가 노트에 적어 둔 약속 시간을 다시 확인했다. ').repeat(5);
const improved=story.replace('그녀는 창밖의 버스 정류장을','그녀는 맞은편 사람에게 다음 순서를 먼저 제안하고 창밖의 버스 정류장을').trim();
assert.ok(story.length>240);
let testCount=0;
async function check(name,fn){await fn();console.log('PASS '+(++testCount)+' '+name)}
async function create({saved=undefined,diagnostic='revise',replacement=improved,editorStreaming=false,backupFailure=false,chatText=story}={}){
 let chat={id:'session-1',message:[
  {role:'user',chatId:'u-1',time:100,data:'계속해서 이야기해줘'},
  {role:'char',chatId:'msg-1',time:101,data:chatText}
 ]};
 const db=new Map();
 if(saved!==undefined)db.set('bard_editor_lab_v03',saved);
 const hooks={},controls=new Map(),listeners={},unregistered=[];
 let calls=0,writes=0,showCount=0,poller=()=>{};
 const response=v=>editorStreaming
  ? {type:'streaming',result:new ReadableStream({start(c){c.enqueue({'0':v.slice(0,5)});c.enqueue({'0':v});c.close()}})}
  : {type:'success',result:v};
 const api={
   pluginStorage:{
     getItem:async k=>structuredClone(db.get(k)??null),
     setItem:async(k,v)=>{
       if(backupFailure&&k==='bard_editor_lab_v03_backups')throw Error('quota hit');
       db.set(k,structuredClone(v));
     }
   },
   getCurrentCharacterIndex:async()=>0,getCurrentChatIndex:async()=>0,
   getChatFromIndex:async()=>structuredClone(chat),
   setChatToIndex:async(_,__,v)=>{chat=structuredClone(v);writes++},
   runLLMModel:async options=>{
     calls++;assert.equal(options.mode,'otherAx');
     if(calls%2){
       if(diagnostic==='error')throw Error('provider offline');
       if(diagnostic==='skip')return response(JSON.stringify({revise:false,issues:[],strengths:['인물의 말투'],summary:'good'}));
       return response(JSON.stringify({revise:true,issues:[{
         excerpt:'창밖의 버스 정류장을',problem:'반응이 너무 수동적임',instruction:'기존 사건을 보존하며 인물의 행동을 구체화'
       }],strengths:[],summary:'revise'}));
     }
     return response(replacement);
   },
   registerSetting:async(_,fn)=>{listeners.settings=fn},
   registerButton:async(_,fn)=>{listeners.open=fn},
   addRisuReplacer:async(type,fn)=>{hooks[type]=fn},
   removeRisuReplacer:async(type,fn)=>{unregistered.push([type,fn===hooks[type]])},
   addRisuChatListener:async(type,fn)=>{assert.equal(type,'output');listeners.output=fn},
   onUnload:async fn=>{listeners.unload=fn},
   showContainer:async()=>{showCount++},hideContainer:async()=>{}
 };
 const document={body:{innerHTML:''},getElementById(id){if(!controls.has(id))controls.set(id,{});return controls.get(id)}};
 const ctx={risuai:api,document,console,ReadableStream,setTimeout,clearTimeout,
  setInterval:fn=>{poller=fn;return 1},clearInterval:()=>{}};
 await vm.runInNewContext(source,ctx,{timeout:10000});
 const event=()=>({char:{name:'하은'},chat:structuredClone(chat),
  characterIndex:0,chatIndex:0,messageIndex:chat.message.length-1});
 return {
   hooks,listeners,controls,unregistered,db,read:()=>chat.message.at(-1).data,
   setText:value=>{chat.message.at(-1).data=value},fire:()=>listeners.output(event()),
   calls:()=>calls,writes:()=>writes,shown:()=>showCount,poller:()=>poller
 };
}
const messageSet=[
 {role:'system',content:'Existing world rules and character facts.'},
 {role:'user',content:'지금 선택을 계속 진행해.'}
];
await check('fresh install defaults to prompt + actual editor ON',async()=>{
 const t=await create({diagnostic:'skip'});
 assert.equal(typeof t.hooks.beforeRequest,'function');
 assert.equal(typeof t.hooks.afterRequest,'function');
 const injected=await t.hooks.beforeRequest(messageSet,'model');
 assert.equal(injected.length,2);
 assert.equal(injected[0].role,'system');
 assert.match(injected[0].content,/BARD_EDITOR_LAB_STYLE_V032/);
 assert.match(injected[0].content,/question -> echo -> confirmation/);
 assert.deepEqual(JSON.parse(JSON.stringify(messageSet)),messageSet);
 assert.notEqual(injected[0],messageSet[0]);
 assert.equal(await t.hooks.beforeRequest(injected,'model'),injected);
});
await check('non-model requests never receive prompt injection',async()=>{
 const t=await create();
 assert.equal(await t.hooks.beforeRequest(messageSet,'otherAx'),messageSet);
 assert.equal(await t.hooks.afterRequest(story,'otherAx'),story);
 assert.equal(t.calls(),0);
});
await check('non-streaming edited before host save and not charged twice after output',async()=>{
 const t=await create();
 const text=await t.hooks.afterRequest(story,'model');
 assert.equal(text,improved);
 assert.equal(t.calls(),2);assert.equal(t.writes(),0);
 t.setText(text);await t.fire();
 assert.equal(t.calls(),2);assert.equal(t.writes(),0);
});
await check('critic skip before save also prevents duplicate post-save model call',async()=>{
 const t=await create({diagnostic:'skip'});
 assert.equal(await t.hooks.afterRequest(story,'model'),story);
 t.setText(story);await t.fire();assert.equal(t.calls(),1);assert.equal(t.writes(),0);
});
await check('streaming completion triggers genuine editorial review after commit',async()=>{
 const t=await create();
 await t.fire();
 assert.equal(t.calls(),2);assert.equal(t.read(),improved);assert.equal(t.writes(),1);
 assert.equal(t.db.get('bard_editor_lab_v03_backups')[0].original,story);
});
await check('repeated output notification cannot trigger duplicate editor charge',async()=>{
 const t=await create();
 await t.fire();await t.fire();
 assert.equal(t.calls(),2);assert.equal(t.writes(),1);
});
await check('provider errors fail open and preserve exact raw output',async()=>{
 const t=await create({diagnostic:'error'});
 assert.equal(await t.hooks.afterRequest(story,'model'),story);
 assert.equal(t.calls(),1);
 t.setText(story);await t.fire();assert.equal(t.calls(),1);
 assert.equal(t.read(),story);
});
await check('prompt-only mode does not call editor models',async()=>{
 const t=await create({saved:{auto:true,promptAssist:true,realEditor:false,model:'otherAx',mode:'selective',maxChars:9000}});
 assert.match((await t.hooks.beforeRequest(messageSet,'model'))[0].content,/BARD_EDITOR_LAB_STYLE_V032/);
 assert.equal(await t.hooks.afterRequest(story,'model'),story);
 await t.fire();assert.equal(t.calls(),0);assert.equal(t.writes(),0);
});
await check('legacy explicitly OFF setting is respected after upgrading',async()=>{
 const t=await create({saved:{auto:false,model:'otherAx',mode:'selective',maxChars:9000}});
 assert.equal(await t.hooks.beforeRequest(messageSet,'model'),messageSet);
 assert.equal(await t.hooks.afterRequest(story,'model'),story);
 await t.fire();assert.equal(t.calls(),0);
});
await check('automatic ON toggle can be enabled once, persisted across reload',async()=>{
 const t=await create({saved:{auto:false,model:'otherAx',mode:'selective',maxChars:9000}});
 await t.listeners.settings();assert.equal(t.shown(),1);
 await t.controls.get('auto').onclick();
 assert.equal(t.db.get('bard_editor_lab_v03').auto,true);
 assert.match((await t.hooks.beforeRequest(messageSet,'model'))[0].content,/BARD_EDITOR_LAB_STYLE_V032/);
});
await check('can disable prompt injection independently of actual editor',async()=>{
 const t=await create({saved:{auto:true,promptAssist:false,realEditor:true,mode:'selective',model:'otherAx',maxChars:9000}});
 assert.equal(await t.hooks.beforeRequest(messageSet,'model'),messageSet);
 assert.equal(await t.hooks.afterRequest(story,'model'),improved);
 assert.equal(t.calls(),2);
});
await check('prepend isolated system guidance when chat has no system',async()=>{
 const t=await create({diagnostic:'skip'});
 const m=[{role:'assistant',content:'previous response'},{role:'user',content:'다음으로'}];
 const v=await t.hooks.beforeRequest(m,'model');
 assert.equal(v.length,3);assert.equal(v[0].role,'system');assert.equal(v[2].content,'다음으로');
});
await check('reasoning leak is removed in pre-save path while preserving meta-safe story',async()=>{
 const leaked='<Thoughts>\n'+('private model preamble\n').repeat(600)+'</Thoughts>\n\n# Approved\n\n## Response\n\n'+story;
 const t=await create({diagnostic:'skip'});
 assert.equal(await t.hooks.afterRequest(leaked,'model'),story.trim());
 t.setText(story.trim());await t.fire();
 assert.equal(t.calls(),1);assert.equal(t.read(),story.trim());
});
await check('bad edit changing fixed numbers is rejected before save',async()=>{
 const numbered=(story+' 온도는 12도였다.').trim();
 const t=await create({chatText:numbered,replacement:(story+' 온도는 13도였다.').trim()});
 assert.equal(await t.hooks.afterRequest(numbered,'model'),numbered);
 assert.equal(t.calls(),2);
});
await check('output backup failure prevents overwriting a streamed message',async()=>{
 const t=await create({backupFailure:true});
 await t.fire();
 assert.equal(t.read(),story);assert.equal(t.writes(),0);
});
await check('unload removes both hooks and editor refuses further processing',async()=>{
 const t=await create();await t.listeners.unload();
 assert.equal(t.unregistered.length,2);
 assert.equal(t.unregistered.every(x=>x[1]),true);
 assert.equal(await t.hooks.afterRequest(story,'model'),story);
 assert.equal(await t.hooks.beforeRequest(messageSet,'model'),messageSet);
});
console.log('Editor Lab v0.3.2 hybrid integration: '+testCount+' scenarios passed');
