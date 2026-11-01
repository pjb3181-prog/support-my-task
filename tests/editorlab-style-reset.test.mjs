import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const source=readFileSync(new URL('../risubard-updates/bard_editor_lab.js',import.meta.url),'utf8');
const exemplar=(
  '봄비가 지난 오후, 민지가 조용히 책을 덮고 친구에게 다음 모임의 장소를 물었다. '
  +'[민지]\n"이번에는 도서관 옆 카페에서 만나 볼래? 거기가 조용하고 창가 자리가 넓어서 좋겠어."\n'
  +'[친구]\n"시간은 언제가 좋아? 이번 주에는 일정이 조금 바뀌었다던데."\n'
  +'[민지]\n"토요일에는 늦게 끝나니까 일요일 오후를 추천할게. 그 전에 읽은 책은 정리해 둘게."\n'
  +'[친구]\n"지난번에 추천한 책도 가져올까? 아직 서로 얘기를 다 못 했잖아."\n'
  +'[민지]\n"응, 그 책에 대해서는 할 말이 많아. 특히 결말을 다르게 해석한 부분이 재미있었어."\n'
).repeat(3);
const bad=Array.from({length:18},(_,i)=>'[민지]\n"'+['네.','그래서?','정말?','그럼?'][i%4]+'"\n').join('');
const demo='맑은 아침의 거리에서 동네 서점 주인이 책장에 신간을 꽂고 있었다. '
  +'그 옆에서 친구는 한 권을 골라 표지를 들여다봤고 둘은 주말 일정을 조정했다. '.repeat(5);

function setup({previous=null,secondChat=false,body=demo}={}){
  let chat={id:secondChat?'other-room':'chapter-room',message:[
    {role:'char',chatId:'intro',data:exemplar,time:1},
    {role:'user',chatId:'u1',data:'읽으러 가자',time:2},
    {role:'char',chatId:'good',data:exemplar,time:3},
    {role:'user',chatId:'u2',data:'계속',time:4},
    {role:'char',chatId:'last',data:body,time:5},
  ]};
  const db=previous||new Map();
  const ui=new Map(),hooks={},handlers={};
  let writes=0,calls=0;
  const api={
    getCurrentCharacterIndex:async()=>0,getCurrentChatIndex:async()=>0,
    getChatFromIndex:async()=>structuredClone(chat),
    setChatToIndex:async(_,__,v)=>{chat=structuredClone(v);writes++},
    getCharacter:async()=>({name:'민지',firstMessage:exemplar}),
    pluginStorage:{
      getItem:async k=>structuredClone(db.get(k)??null),
      setItem:async(k,v)=>db.set(k,structuredClone(v))
    },
    runLLMModel:async()=>{
      calls++;
      return {type:'success',result:calls%2
        ?JSON.stringify({revise:false,issues:[],sceneProgress:{material:true}})
        :bad};
    },
    registerSetting:async(_,cb)=>{handlers.open=cb},
    registerButton:async(_,cb)=>{handlers.button=cb},
    addRisuReplacer:async(t,fn)=>hooks[t]=fn,
    removeRisuReplacer:async()=>{},
    addRisuChatListener:async()=>{},
    onUnload:async()=>{},showContainer:async()=>{},hideContainer:async()=>{}
  };
  const document={
    body:{innerHTML:''},
    getElementById:id=>{if(!ui.has(id))ui.set(id,{});return ui.get(id)}
  };
  const ctx={risuai:api,document,console,setInterval:()=>1,clearInterval:()=>{},setTimeout,clearTimeout,ReadableStream};
  return {
    async init(){await vm.runInNewContext(source,ctx,{timeout:13000});return this},
    open:()=>handlers.open(),storage:db,ui,hooks,read:()=>structuredClone(chat),
    calls:()=>calls,writes:()=>writes,
    setOtherChat(){chat={id:'other-room',message:structuredClone(chat.message)}},
    appendTurns(count){for(let i=0;i<count;i++)chat.message.push({role:i%2?'char':'user',data:demo,time:10+i})},
  };
}
let number=0;
async function test(name,fn){await fn();console.log('PASS '+(++number)+' '+name)}
await test('new installation does not silently select or modify chat history',async()=>{
  const t=await setup().init();await t.open();
  assert.match(t.ui.get('style-message').onchange.toString(),/styleChosenIndex/);
  assert.equal(t.writes(),0);
  assert.equal(t.storage.get('bard_editor_lab_v036_style_snapshots'),undefined);
});
await test('user selects a real earlier AI turn and captures style without touching story',async()=>{
  const t=await setup().init();const before=t.read();await t.open();
  t.ui.get('style-message').onchange({target:{value:'2'}});
  await t.ui.get('style-save').onclick();
  assert.deepEqual(t.read(),before);
  assert.equal(t.writes(),0);
  const store=t.storage.get('bard_editor_lab_v036_style_snapshots');
  const item=store['0|chapter-room'];
  assert.equal(item.index,2);assert.equal(item.enabled,true);
  assert.ok(item.sample.includes('도서관 옆 카페'));
  assert.ok(item.sample.length<=2400);
  assert.equal(item.focusUntil,before.message.length+8);
});
await test('saved reference is injected for main request only, and cannot duplicate',async()=>{
  const t=await setup().init();await t.open();
  t.ui.get('style-message').onchange({target:{value:'2'}});
  await t.ui.get('style-save').onclick();
  const prompts=[{role:'system',content:'Preserve old facts.'},{role:'user',content:'Continue'}];
  const after=await t.hooks.beforeRequest(prompts,'model');
  assert.equal(prompts[0].content,'Preserve old facts.');
  assert.match(after[0].content,/APPROVED STYLE SNAPSHOT/);
  assert.match(after[0].content,/STYLE-ONLY RESET ACTIVE/);
  assert.match(after[0].content,/Do NOT recreate its events/);
  const again=await t.hooks.beforeRequest(after,'model');
  assert.equal(again,after);
  const other=await t.hooks.beforeRequest(prompts,'otherAx');
  assert.equal(other,prompts);
});
await test('one click reasserts soft reset without resetting progress',async()=>{
  const t=await setup().init();await t.open();
  t.ui.get('style-message').onchange({target:{value:'2'}});
  await t.ui.get('style-save').onclick();
  t.appendTurns(14);
  const past=t.read();
  const old=t.storage.get('bard_editor_lab_v036_style_snapshots')['0|chapter-room'];
  assert.ok(past.message.length>old.focusUntil);
  await t.ui.get('style-reset').onclick();
  const refreshed=t.storage.get('bard_editor_lab_v036_style_snapshots')['0|chapter-room'];
  assert.equal(refreshed.focusUntil,past.message.length+8);
  assert.deepEqual(t.read(),past);
});
await test('persistent reference remains after restart, but stronger pulse naturally fades',async()=>{
  const t=await setup().init();await t.open();
  t.ui.get('style-message').onchange({target:{value:'2'}});
  await t.ui.get('style-save').onclick();
  const next=await setup({previous:t.storage}).init();
  next.appendTurns(16);
  const output=await next.hooks.beforeRequest([
    {role:'system',content:'Continue without changing facts.'},
    {role:'user',content:'Next'}
  ],'model');
  assert.match(output[0].content,/Ongoing style reference/);
  assert.doesNotMatch(output[0].content,/STYLE-ONLY RESET ACTIVE/);
});
await test('anchor is isolated by chat ID; no cross-character leak',async()=>{
  const t=await setup().init();await t.open();
  t.ui.get('style-message').onchange({target:{value:'2'}});
  await t.ui.get('style-save').onclick();
  t.setOtherChat();
  const result=await t.hooks.beforeRequest([{role:'system',content:'S'},{role:'user',content:'U'}],'model');
  assert.doesNotMatch(result[0].content,/APPROVED STYLE SNAPSHOT/);
});
await test('disable style mode keeps stored sample and stops injection',async()=>{
  const t=await setup().init();await t.open();
  t.ui.get('style-message').onchange({target:{value:'2'}});
  await t.ui.get('style-save').onclick();
  await t.ui.get('style-off').onclick();
  assert.equal(t.storage.get('bard_editor_lab_v036_style_snapshots')['0|chapter-room'].enabled,false);
  const result=await t.hooks.beforeRequest([{role:'system',content:'S'},{role:'user',content:'U'}],'model');
  assert.doesNotMatch(result[0].content,/APPROVED STYLE SNAPSHOT/);
  await t.ui.get('style-reset').onclick();
  assert.equal(t.storage.get('bard_editor_lab_v036_style_snapshots')['0|chapter-room'].enabled,true);
});
await test('first message and preset cannot be rewritten by applying style baseline',async()=>{
  const t=await setup().init();
  await t.open();const old=t.read();
  t.ui.get('style-message').onchange({target:{value:'0'}});
  await t.ui.get('style-save').onclick();
  const now=t.read();
  assert.deepEqual(now,old);
  assert.equal(t.writes(),0);
});
console.log('Editor Lab v0.3.6 style snapshot regression: '+number+' mock scenarios passed');
