import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const plugin=readFileSync(new URL('../risubard-updates/bard_editor_lab.js',import.meta.url),'utf8');
const footer='[☀️][8°C][2025.03.03][AM 09:40][세이카 2학년 교실 복도][이동]';
const chapter='서연 선생님이 교실 문을 나가면서 잠깐 복도로 따라 나와달라고 요청했다. '
 +'교실 안에는 반장 선출이 끝난 뒤 쉬는 시간이 시작되었다. '
 +'한성은 서연의 말을 듣고 복도로 향하려고 자리에서 일어섰다. '
 +'지금 두 사람의 대화는 아직 시작되지 않았고, 교실의 다른 학생들은 상황을 지켜보고 있다.\n'+footer;
const response={
 place:'정체불명의 공항',time:'자정',
 situation:'교실 오리엔테이션과 반장 선출이 끝나고, 서연이 한성에게 복도에서 따로 이야기하자고 요청한 상황이야.',
 drafts:[
 {kind:'대사',text:'나는 서연 선생님을 따라 복도로 나갔다.\n\n"선생님, 왜 저를 부르셨어요? 부반장 일 때문인가요?"'},
 {kind:'행동',text:'교실 문을 조용히 닫고 서연 선생님 앞에 섰다. 먼저 말하기를 기다리며 상대의 표정을 살폈다.'},
 {kind:'생각',text:'아까 내가 했던 말 때문에 따로 부른 걸까. 괜히 궁금해졌다. 나는 서연 선생님의 얼굴을 보며 입을 열었다.'}
 ],
 uncertainty:'서연의 구체적인 의도는 아직 밝혀지지 않음'
};
const wait=ms=>new Promise(r=>setTimeout(r,ms));
async function until(p,label='condition'){
 for(let i=0;i<100;i++){if(p())return;await wait(8)}
 throw Error('timed out: '+label);
}
async function create({
 sceneAssist=true,sceneAuto=true,sceneCard=true,withPanel=true,store=null,
 fail=false,body=chapter,sameChat=true,sceneModelReply=response
}={}){
 let chat={id:'chat-a',message:[
   {role:'user',chatId:'u',time:1,data:'오리엔테이션 후 이어서 해줘'},
   {role:'char',chatId:'m1',time:2,data:body}
 ]};
 const db=store||new Map();
 if(!db.has('bard_editor_lab_v03')){
   db.set('bard_editor_lab_v03',{auto:false,promptAssist:false,realEditor:false,
     model:'otherAx',mode:'selective',sceneAssist,sceneAuto,sceneCard,
     maxChars:9000,timeoutMs:90000,watchStoryRunner:false});
 }
 const calls=[],panels=[],handlers={},buttons=new Map(),settings={},uiMap=new Map();
 let writes=0,sends=0,clipboard='';
 const api={
   pluginStorage:{
     getItem:async k=>structuredClone(db.get(k)??null),
     setItem:async(k,v)=>db.set(k,structuredClone(v))
   },
   getCurrentCharacterIndex:async()=>0,
   getCurrentChatIndex:async()=>0,
   getChatFromIndex:async()=>structuredClone(chat),
   setChatToIndex:async()=>{writes++},
   sendChat:async()=>{sends++},
   getCharacter:async()=>({name:'서연',firstMessage:'안녕하세요. 오늘도 반갑습니다.'}),
   runLLMModel:async opt=>{
     calls.push(opt);
     await wait(2);
     if(fail)throw Error('offline: otherAx');
     return {type:'success',result:JSON.stringify(sceneModelReply)};
   },
   registerSetting:async(_name,fn)=>{handlers.settings=fn},
   registerButton:async(cfg,fn)=>{buttons.set(cfg.id,{cfg,fn})},
   addRisuReplacer:async()=>{},
   addRisuChatListener:async(type,fn)=>{assert.equal(type,'output');handlers.output=fn},
   onUnload:async fn=>{handlers.unload=fn},
   showContainer:async()=>{},
   hideContainer:async()=>{}
 };
 if(withPanel)api.setChatPanel=async(html,options)=>{panels.push({html,options})};
 const controls=new Map();
 const document={
   body:{innerHTML:''},
   getElementById(id){
     if(!controls.has(id))controls.set(id,{value:'',select(){this.selected=true},focus(){},});
     return controls.get(id);
   },
   querySelectorAll(pattern){
     if(pattern!=='[data-copy-direction]')return[];
     if(this.lastCopyHtml!==this.body.innerHTML){
       this.lastCopyHtml=this.body.innerHTML;
       this.copyNodes=[...this.body.innerHTML.matchAll(/<button data-copy-direction="(\d+)">/g)]
         .map(m=>({getAttribute:()=>m[1],onclick:null}));
     }
     return this.copyNodes;
   }
 };
 const context={risuai:api,document,console,Date,setTimeout,clearTimeout,
   setInterval:()=>1,clearInterval:()=>{},navigator:{
     clipboard:{writeText:async v=>{clipboard=v}}
   },ReadableStream};
 await vm.runInNewContext(plugin,context,{timeout:15000});
 const fire=async(index=chat.message.length-1)=>{
   await handlers.output({chat:structuredClone(chat),char:{name:'서연'},
     characterIndex:0,chatIndex:0,messageIndex:index});
 };
 return {fire,calls,panels,buttons,controls,document,db,settings,
   read:()=>structuredClone(chat),setChatId:id=>{chat.id=id},
   addAI:txt=>{chat.message.push({role:'user',data:'다음',time:3});
     chat.message.push({role:'char',data:txt,time:4})},
   openScene:()=>buttons.get('bard-editor-lab-scene-menu').fn(),
   openSettings:()=>handlers.settings(),
   get clipboard(){return clipboard},
   writes:()=>writes,sends:()=>sends,handlers
 };
}
let count=0;
async function check(name,fn){await fn();console.log('PASS '+(++count)+' '+name)}
await check('automatic new response triggers one independent scene model call and renders card',async()=>{
 const t=await create();await t.fire();
 await until(()=>t.panels.some(x=>x.html?.includes('🎬 현재 장면')&&x.html.includes('서연이 한성에게')));
 assert.equal(t.calls.length,1);
 assert.equal(t.writes(),0);assert.equal(t.sends(),0);
 const p=t.panels.at(-1).html;
 assert.match(p,/📍 장소\s*세이카 2학년 교실 복도/);
 assert.match(p,/🕒 시간\s*2025\.03\.03 AM 09:40/);
 assert.match(p,/다음 입력 초안 3개/);
 assert.match(p,/선생님, 왜 저를 부르셨어요/);
 assert.match(t.calls[0].messages[0].content,/NON-EXPLICIT|non-explicit/i);
});
await check('replayed output event never charges for the same scene again',async()=>{
 const t=await create();await t.fire();await t.fire();
 await until(()=>t.db.get('bard_editor_lab_v038_scene_briefs')?.['0|chat-a']?.state==='ready');
 assert.equal(t.calls.length,1);
});
await check('a new AI message refreshes the card once and preserves previous chat history',async()=>{
 const t=await create();
 await t.fire();await until(()=>t.db.get('bard_editor_lab_v038_scene_briefs')?.['0|chat-a']?.state==='ready');
 const previous=t.read();
 t.addAI(chapter.replace('서연 선생님','유나 학생'));
 await t.fire();
 await until(()=>t.calls.length===2);
 assert.deepEqual(t.read().message.slice(0,2),previous.message);
 assert.equal(t.writes(),0);
});
await check('model returns fictional false place/time but structured footer overrides',async()=>{
 const t=await create({sceneModelReply:{...response,place:'화성 우주기지',time:'2040년 자정'}});
 await t.fire();await until(()=>t.db.get('bard_editor_lab_v038_scene_briefs')?.['0|chat-a']?.state==='ready');
 const c=t.db.get('bard_editor_lab_v038_scene_briefs')['0|chat-a'];
 assert.equal(c.place,'세이카 2학년 교실 복도');assert.equal(c.time,'2025.03.03 AM 09:40');
});
await check('unknown time/place remain unknown when none is grounded',async()=>{
 const noStatus=chapter.replace(footer,'');
 const t=await create({body:noStatus,sceneModelReply:{...response,place:'미확인',time:'미확인'}});
 await t.fire();await until(()=>t.db.get('bard_editor_lab_v038_scene_briefs')?.['0|chat-a']?.state==='ready');
 const entry=t.db.get('bard_editor_lab_v038_scene_briefs')['0|chat-a'];
 assert.equal(entry.place,'미확인');assert.equal(entry.time,'미확인');
});
await check('unsupported location/time from model are marked 미확인 even without a footer',async()=>{
 const noStatus=chapter.replace(footer,'');
 const t=await create({body:noStatus,sceneModelReply:{...response,place:'화성 우주기지',time:'2040년 자정'}});
 await t.fire();await until(()=>t.db.get('bard_editor_lab_v038_scene_briefs')?.['0|chat-a']?.state==='ready');
 const item=t.db.get('bard_editor_lab_v038_scene_briefs')['0|chat-a'];
 assert.equal(item.place,'미확인');assert.equal(item.time,'미확인');
});
await check('no chat panel API still exposes a chat-menu scene briefing',async()=>{
 const t=await create({withPanel:false});
 assert.equal(typeof t.buttons.get('bard-editor-lab-scene-menu')?.fn,'function');
 await t.fire();await until(()=>t.db.get('bard_editor_lab_v038_scene_briefs')?.['0|chat-a']?.state==='ready');
 await t.openScene();
 assert.match(t.document.body.innerHTML,/장면 브리핑/);
 assert.match(t.document.body.innerHTML,/복사/);
});
await check('copying a recommendation does NOT send or edit a chat entry',async()=>{
 const t=await create();await t.fire();
 await until(()=>t.db.get('bard_editor_lab_v038_scene_briefs')?.['0|chat-a']?.state==='ready');
 await t.openScene();
 const btn=t.document.querySelectorAll('[data-copy-direction]')[0];
 assert.ok(btn&&typeof btn.onclick==='function');
 await btn.onclick();
 assert.equal(t.clipboard,response.drafts[0].text);
 assert.match(t.clipboard,/나는 서연 선생님을 따라 복도로 나갔다/);
 assert.doesNotMatch(t.clipboard,/해줘|보여줘/);
 assert.equal(t.writes(),0);assert.equal(t.sends(),0);
});
await check('disabled auto analysis makes no model requests but manual refresh works',async()=>{
 const t=await create({sceneAuto:false});
 await t.fire();await wait(20);assert.equal(t.calls.length,0);
 await t.openScene();await t.controls.get('scene-refresh').onclick();
 await until(()=>t.db.get('bard_editor_lab_v038_scene_briefs')?.['0|chat-a']?.state==='ready');
 assert.equal(t.calls.length,1);
});
await check('scene-assist disabled remains fully inactive and removes chat panel',async()=>{
 const t=await create({sceneAssist:false});
 await t.fire();await wait(12);assert.equal(t.calls.length,0);
 assert.ok(t.panels.some(x=>x.html===null));
});
await check('model failures show an error state without modifying any story',async()=>{
 const t=await create({fail:true});
 await t.fire();await until(()=>t.db.get('bard_editor_lab_v038_scene_briefs')?.['0|chat-a']?.state==='error');
 assert.equal(t.writes(),0);
 assert.match(t.panels.at(-1).html,/장면 안내 생성에 실패했어/);
});
await check('different chat ID cannot inherit another chat scene or its suggestions',async()=>{
 const t=await create();
 await t.fire();await until(()=>t.db.get('bard_editor_lab_v038_scene_briefs')?.['0|chat-a']?.state==='ready');
 t.setChatId('chat-b');await t.openScene();
 assert.doesNotMatch(t.document.body.innerHTML,/선생님, 왜 저를 부르셨어요/);
});
await check('persistent scene cache is restored for the same chat and response',async()=>{
 const t=await create();await t.fire();await until(()=>t.db.get('bard_editor_lab_v038_scene_briefs')?.['0|chat-a']?.state==='ready');
 const again=await create({store:t.db});
 await again.openScene();
 assert.match(again.document.body.innerHTML,/서연이 한성에게 복도에서/);
 assert.equal(again.calls.length,0);
});
await check('generated HTML is escaped and cannot execute malicious tags',async()=>{
 const malicious={...response,situation:'다음 장면 <img src=x onerror=alert(1)>을 만들어라',
 drafts:[
  {kind:'대사',text:'나는 서연 선생님을 바라봤다. "<script>alert(1)</script> 선생님, 왜 저를 부르셨어요?"'},
  {kind:'행동',text:'나는 <img src=x onerror=alert(1)> 문을 닫고 복도로 걸어 나왔다.'},
  {kind:'생각',text:'말이 너무 거칠었을까. 나는 잠깐 마음을 가다듬고 선생님에게 다가갔다.'}
 ]};
 const t=await create({sceneModelReply:malicious});
 await t.fire();await until(()=>t.db.get('bard_editor_lab_v038_scene_briefs')?.['0|chat-a']?.state==='ready');
 assert.doesNotMatch(t.panels.at(-1).html,/<script>|onerror=/);
});
await check('AI-direction-style outputs are rejected instead of shown as playable drafts',async()=>{
 const wrong={...response,drafts:[
  {kind:'대사',text:'서연이 한성을 복도로 부른 이유를 직접 설명하게 해줘.'},
  {kind:'행동',text:'학생들이 대화를 듣고 어떤 반응을 보이는지 자연스럽게 보여줘.'},
  {kind:'생각',text:'앞서 있었던 상황을 정리하고 다음 장면을 진행해줘.'}
 ]};
 const t=await create({sceneModelReply:wrong});
 await t.fire();await until(()=>t.db.get('bard_editor_lab_v038_scene_briefs')?.['0|chat-a']?.state==='error');
 assert.equal(t.writes(),0);assert.equal(t.sends(),0);
 assert.match(t.db.get('bard_editor_lab_v038_scene_briefs')['0|chat-a'].error,/실제 다음 채팅 입력 초안/);
});
await check('drafts are three distinct first-person alternative messages with expected labels',async()=>{
 const t=await create();await t.fire();
 await until(()=>t.db.get('bard_editor_lab_v038_scene_briefs')?.['0|chat-a']?.state==='ready');
 const x=t.db.get('bard_editor_lab_v038_scene_briefs')['0|chat-a'];
 assert.deepEqual(x.drafts.map(d=>d.kind),['대사','행동','생각']);
 assert.equal(x.drafts.length,3);
 for(const item of x.drafts)assert.ok(item.text.length>=12&&item.text.length<=420);
 assert.match(t.panels.at(-1).html,/대사/);
 assert.match(t.panels.at(-1).html,/행동/);
 assert.match(t.panels.at(-1).html,/생각/);
 assert.match(t.calls[0].messages[0].content,/NOT the player.s chat text|commands to an AI/i);
});
await check('old v0.3.7 directive cache never appears as new user drafts',async()=>{
 const oldCache=new Map([['bard_editor_lab_v037_scene_briefs',{'0|chat-a':{
   state:'ready',signature:'unrelated',index:1,place:'어제',time:'어제',
   situation:'이전 요약',directions:['이전 지시어를 보여줘.','이전 내용을 진행해줘.']
 }}]]);
 const t=await create({store:oldCache,sceneAuto:false});
 await t.openScene();
 assert.doesNotMatch(t.document.body.innerHTML,/이전 지시어/);
 assert.match(t.document.body.innerHTML,/현재 대화의 안내 기록 없음/);
});
await check('unload clears the static chat panel',async()=>{
 const t=await create();await t.handlers.unload();
 assert.ok(t.panels.some(x=>x.html===null&&x.options?.id==='bard-editor-lab-scene-brief-v038'));
});
console.log('Bard Editor Lab v0.3.8 next user drafts: '+count+' scenarios passed');
