import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const js=readFileSync(new URL('../risubard-updates/bard_editor_lab.js',import.meta.url),'utf8');
const opening=[
'오후가 다 되어 조심스럽게 현관에 다가간 지아는 미리 준비한 작은 선물을 내려다보았다.',
'"아, 안녕하세요? 저 옆집에 최근 이사 온 이지아라고 합니다. 갑자기 찾아와서 죄송한데 잠깐 인사를 드려도 될까요?"',
'손가락은 바빴지만 지아는 손님에게 자신의 상황을 잘 설명하려고 애썼다.',
'"그동안 짐을 정리하는 소리가 많이 났을 텐데 불편하시지 않았으면 좋겠어요. 이건 제가 직접 골라 온 쿠키인데 받아주시면 기쁠 것 같아요."',
'"나중에 이 동네에 괜찮은 서점이 있는지도 여쭤보고 싶어요. 제가 책을 좋아하거든요."'
].join('\n');
const smsSource=Array.from({length:21},(_,i)=>
 '[이지아]\n"'+(['근데.','……','알아요.','근데.','할게요.','……','네.'][i%7])+'"\n'
 +'[한성]\n"'+(i%2?'응.':'그래.')+'"\n').join('\n');
const goodSms=Array.from({length:21},(_,i)=>
 '[이지아]\n"'+[
   '다음 주 화요일에는 책을 돌려줄 수 있어요.',
   '방금 서점에 물어보니 주문한 책이 도착했대요.',
   '제가 고른 쿠키가 입맛에 맞았다는 게 기뻐요.',
   '오늘은 이사 상자 중에서 책부터 정리해 둘게요.',
   '수업 일정 때문에 저녁에는 조금 늦게 연락할 수 있어요.',
   '동네 지도를 보니까 도서관이 가까운 걸 알아냈어요.',
   '그 길을 직접 걸어보고 나중에 알려드릴게요.'
 ][i%7]+'"\n'
 +'[한성]\n"'+(i%2?'응.':'그래.')+'"\n').join('\n');
const cleaned=s=>s.trim();

async function start({body=smsSource,firstMessage=opening,diagnosis='skip',revision=null,availability=true,auto=true}={}){
  let chat={id:'c-voice',message:[
    {role:'char',chatId:'first',data:firstMessage,time:1},
    {role:'user',chatId:'user',data:'오늘 문자 확인했어?',time:2},
    {role:'char',chatId:'final',data:body,time:3}
  ]};
  const character={name:'이지아',desc:'낯을 가리고 공손하지만 자기 관심사를 구체적으로 설명할 줄 아는 사람',
    personality:'처음 만나는 사람에게 조심스럽고 친절함',firstMessage};
  const originalCharacter=structuredClone(character);
  const calls=[],listeners={},hooks={},ui=new Map(),storage=new Map([['bard_editor_lab_v03',{
    auto,promptAssist:true,realEditor:true,momentum:false,voiceGuard:true,watchStoryRunner:false,
    model:'otherAx',mode:'selective',maxChars:18000,timeoutMs:90000
  }]]);
  let writes=0;
  const api={
    getCharacter:availability?async()=>structuredClone(character):async()=>{throw Error('char unavailable')},
    getCurrentCharacterIndex:async()=>0,getCurrentChatIndex:async()=>0,
    getChatFromIndex:async()=>structuredClone(chat),
    setChatToIndex:async(a,b,v)=>{chat=structuredClone(v);writes++},
    pluginStorage:{getItem:async k=>structuredClone(storage.get(k)??null),setItem:async(k,v)=>{storage.set(k,structuredClone(v))}},
    runLLMModel:async options=>{
      calls.push(options);
      if(calls.length%2){
        if(diagnosis==='skip')return {type:'success',result:JSON.stringify({
          revise:false,sceneProgress:{material:true},issues:[],summary:'No need to revise'
        })};
        if(diagnosis==='explicit')return {type:'success',result:JSON.stringify({
          revise:true,characterFidelity:{status:'degrading'},sceneProgress:{material:true},
          issues:[{excerpt:'근데.',problem:'반복 단편 대사',instruction:'캐릭터의 자기 표현 회복'}]
        })};
        return {type:'fail',result:'unavailable'};
      }
      return {type:'success',result:revision===null?body:revision};
    },
    registerSetting:async(_name,cb)=>{listeners.settings=cb},
    registerButton:async(_data,cb)=>{listeners.button=cb},
    addRisuReplacer:async(type,cb)=>{hooks[type]=cb},
    removeRisuReplacer:async()=>{},
    addRisuChatListener:async(type,cb)=>{listeners.output=cb},
    onUnload:async cb=>{listeners.unload=cb},
    showContainer:async()=>{},hideContainer:async()=>{}
  };
  const document={body:{innerHTML:''},getElementById:id=>{
    if(!ui.has(id))ui.set(id,{});
    return ui.get(id);
  }};
  const ctx={risuai:api,document,console,setInterval:()=>1,clearInterval:()=>{},setTimeout,clearTimeout,
    ReadableStream,Date};
  await vm.runInNewContext(js,ctx,{timeout:12000});
  return {chat:()=>chat,character,originalCharacter,calls,storage,ui,hooks,
    fire:()=>listeners.output({char:{name:'이지아'},chat:structuredClone(chat),characterIndex:0,
      chatIndex:0,messageIndex:chat.message.length-1}),
    before:p=>hooks.beforeRequest(p,'model'),
    preSave:s=>hooks.afterRequest(s,'model'),
    writes:()=>writes,open:()=>listeners.settings(),listeners};
}
let count=0;const scenario=async(name,cb)=>{await cb();console.log('PASS '+(++count)+' '+name)};
assert.ok(smsSource.length>240&&goodSms.length>240);
await scenario('pre-save review receives original first-message anchor',async()=>{
  const t=await start({diagnosis:'skip'});
  await t.preSave(smsSource);
  assert.equal(t.calls.length,2); // objective severe drift forces rewrite despite critic skipping
  assert.match(t.calls[0].messages[1].content,/ORIGINAL FIRST MESSAGE — READ-ONLY CHARACTER VOICE ANCHOR/);
  assert.match(t.calls[0].messages[1].content,/제가 직접 골라 온 쿠키/);
  assert.match(t.calls[0].messages[1].content,/"severe":true/);
  assert.match(t.calls[1].messages[1].content,/초기 캐릭터 표현력에 비해/);
  assert.deepEqual(t.character,t.originalCharacter); // never mutate character
});
await scenario('severe one-word SMS erosion cannot be declared normal when critic says skip',async()=>{
  const t=await start({diagnosis:'skip'});
  await t.fire();
  assert.equal(t.calls.length,2);
  assert.equal(t.writes(),0);
  const last=t.storage.get('bard_editor_lab_v034_activity')[0];
  assert.match(last.reason,/퇴고본 보류: 초기 캐릭터성 대비 반복 단편 대사가 충분히 개선되지 않음/);
  assert.notEqual(last.outcome,'applied');
  assert.equal(t.chat().message.at(-1).data,smsSource);
});
await scenario('healthy distinct short-text replies remain legitimate',async()=>{
  const t=await start({body:goodSms,diagnosis:'skip'});
  await t.fire();
  assert.equal(t.calls.length,1);
  assert.equal(t.writes(),0);
  assert.match(t.storage.get('bard_editor_lab_v034_activity')[0].reason,/실질적 수정 불필요/);
});
await scenario('non-NPC tagged player lines are protected from editorial alteration',async()=>{
  const altered=smsSource.replace('[한성]\n"그래."','[한성]\n"아냐."');
  const t=await start({diagnosis:'explicit',revision:altered});
  await t.fire();
  assert.equal(t.writes(),0);
  assert.equal(t.chat().message.at(-1).data,smsSource);
  assert.match(t.storage.get('bard_editor_lab_v034_activity')[0].reason,/플레이어 또는 타 인물의 기존 대사가 변경됨/);
});
await scenario('character voice hint in main prompt is read-only and not copied into chat',async()=>{
  const t=await start({diagnosis:'skip'});
  const user=[{role:'system',content:'Preserve the current arc.'},{role:'user',content:'이번에는 문자로'}];
  const result=await t.before(user);
  assert.match(result[0].content,/Read-only opening speech reference for 이지아/);
  assert.match(result[0].content,/Never copy this dialogue/);
  assert.match(result[0].content,/force the character to remain shy/);
  assert.equal(user[0].content,'Preserve the current arc.');
  assert.equal(t.writes(),0);
});
await scenario('missing opening reference does not crash ordinary reviews',async()=>{
  const t=await start({availability:false,firstMessage:'',diagnosis:'skip'});
  await t.preSave(goodSms);
  assert.equal(t.calls.length,1);
  assert.equal(t.writes(),0);
});
await scenario('voiceGuard independently toggled OFF blocks anchor prompts',async()=>{
  const t=await start({diagnosis:'skip'});
  await t.open();
  await t.ui.get('voiceguard').onchange({target:{checked:false}});
  assert.equal(t.storage.get('bard_editor_lab_v03').voiceGuard,false);
  const prompts=await t.before([{role:'system',content:'hello'},{role:'user',content:'계속'}]);
  assert.doesNotMatch(prompts[0].content,/Read-only opening speech reference/);
  await t.preSave(smsSource);
  assert.equal(t.calls.length,1);
});
console.log('Bard Editor Lab v0.3.5 voice anchor: '+count+' scenarios passed');
