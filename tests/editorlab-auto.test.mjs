import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../risubard-updates/bard_editor_lab.js', import.meta.url),'utf8');
const story = '하은은 상대의 말을 들은 뒤 잠깐 고개를 끄덕였다. "정말?" 하고 되물었지만, 정작 원하는 것이 무엇인지는 설명하지 않았다. 창밖의 불빛이 느리게 흔들렸다. '.repeat(6);
assert.ok(story.length>240 && (story.match(/[가-힣]/g)||[]).length>65);
const revised = story.replace('"정말?" 하고 되물었지만', '"그럼 다음에는 어떻게 할까?" 하고 물었지만').trim();

async function scenario({enabled=true,reply='revise',stream=false,replace=revised,body=story,mode='selective',storageFail=false}={}) {
  let chat={id:'chat-1',message:[
    {role:'user',data:'이야기를 이어줘',time:11,chatId:'u-1'},
    {role:'char',data:body,time:12,chatId:'m-1'}
  ]};
  const db=new Map([['bard_editor_lab_v03',{
    model:'otherAx',mode,auto:enabled,watchStoryRunner:false,timeoutMs:90000,maxChars:9000
  }]]);
  const callbacks={}, buttons=new Map();
  let calls=0, writes=0, watcher=null;
  const modelArgs=[];
  const result=(value)=>stream
    ? {type:'streaming',result:new ReadableStream({start(c){c.enqueue({'0':value.slice(0,25)});c.enqueue({'0':value});c.close()}})}
    : {type:'success',result:value};
  const risuai={
    pluginStorage:{
      getItem:async k=>structuredClone(db.get(k)),
      setItem:async(k,v)=>{if(storageFail&&k==='bard_editor_lab_v03_backups')throw Error('backup storage quota');db.set(k,structuredClone(v))}
    },
    getCurrentCharacterIndex:async()=>0,
    getCurrentChatIndex:async()=>0,
    getChatFromIndex:async()=>structuredClone(chat),
    setChatToIndex:async (_ci,_ti,newChat)=>{chat=structuredClone(newChat);writes++},
    runLLMModel:async args=>{
      assert.equal(args.mode,'otherAx');
      modelArgs.push(args);calls++;
      if(calls%2===1){
        if(reply==='fail')return {type:'fail',result:'no auth'};
        if(reply==='skip')return result(JSON.stringify({revise:false,issues:[],strengths:['자연스럽다'],summary:'원문 유지'}));
        return result(JSON.stringify({revise:true,issues:[{
          excerpt:'"정말?"',problem:'반복적인 되물음',instruction:'정보를 추가하는 질문으로 교정'
        }],strengths:[],summary:'일부 교정'}));
      }
      return result(replace);
    },
    registerSetting:async(_title,callback)=>{callbacks.settings=callback},
    registerButton:async(_cfg,callback)=>{callbacks.button=callback},
    addRisuChatListener:async(_name,callback)=>{callbacks.output=callback},
    onUnload:async(fn)=>{callbacks.unload=fn},
    showContainer:async()=>{},
    hideContainer:async()=>{}
  };
  const document={body:{innerHTML:''},getElementById:id=>{
    if(!buttons.has(id))buttons.set(id,{});
    return buttons.get(id);
  }};
  const ctx={risuai,document,console,setTimeout,clearTimeout,
    setInterval:fn=>{watcher=fn;return 1},
    clearInterval:()=>{},ReadableStream};
  const pluginPromise=vm.runInNewContext(source,ctx,{timeout:10000});
  await pluginPromise;
  assert.equal(typeof callbacks.output,'function');
  const event=()=>({
    characterIndex:0,chatIndex:0,character:{name:'하은'},
    char:{name:'하은'},chat:structuredClone(chat),messageIndex:chat.message.length-1
  });
  return {fire:()=>callbacks.output(event()),current:()=>chat.message.at(-1).data,
    calls:()=>calls,writes:()=>writes,db,callbacks,buttons,modelArgs,watch:()=>watcher};
}
{
  const t=await scenario({enabled:false});
  await t.fire();assert.equal(t.calls(),0);assert.equal(t.current(),story);assert.equal(t.writes(),0);
}
{
  const t=await scenario();
  await t.fire();assert.equal(t.current(),revised);assert.equal(t.calls(),2);
  assert.equal(t.writes(),1);assert.equal(t.db.get('bard_editor_lab_v03_backups').length,1);
  await t.fire();assert.equal(t.calls(),2);assert.equal(t.writes(),1);
}
{
  const t=await scenario({reply:'skip'});
  await t.fire();assert.equal(t.current(),story);assert.equal(t.calls(),1);
}
{
  const t=await scenario({reply:'fail'});
  await t.fire();assert.equal(t.current(),story);assert.equal(t.calls(),1);
}
{
  const t=await scenario({replace:story.replace('"정말?"','"9번?"')});
  await t.fire();assert.equal(t.current(),story);assert.equal(t.calls(),2);
}
{
  const t=await scenario({stream:true});
  await t.fire();assert.equal(t.current(),revised);assert.equal(t.calls(),2);
}
{
  const t=await scenario({enabled:false});
  await t.callbacks.settings();
  assert.equal(typeof t.buttons.get('auto').onclick,'function');
  await t.buttons.get('auto').onclick();
  await t.fire();assert.equal(t.calls(),2);assert.equal(t.current(),revised);
  await t.callbacks.unload();
}

{
  // A 36k-character exposed internal planning prelude must not exclude 8k-or-less prose.
  const raw='<Thoughts>\n'+('Planning is not the story. '+('aux '.repeat(26))+'\n').repeat(350)
    +'</Thoughts>\n\n# Approved\n\n## Response\n\n'+story;
  assert.ok(raw.length>12000);
  const t=await scenario({body:raw,reply:'skip'});
  await t.fire();
  assert.equal(t.calls(),1);
  assert.equal(t.writes(),1);
  assert.equal(t.current(),story.trim());
  assert.equal(t.db.get('bard_editor_lab_v03_backups')[0].original,raw);
  assert.equal(t.modelArgs[0].messages[1].content.includes('Planning is not the story.'),false);
  await t.callbacks.settings();
  await t.buttons.get('restore').onclick();
  assert.equal(t.current(),raw);
}
{
  const raw='<Thoughts>\nNever closed\n'+story;
  const t=await scenario({body:raw,reply:'skip'});
  await t.fire();
  assert.equal(t.calls(),0);
  assert.equal(t.current(),raw);
}
{
  const natural=[
    '하은은 도서관 창가에 걸린 작은 안내문을 발견하고 먼저 무슨 전시인지 물었다.',
    '직원이 전시의 마지막 날이라고 설명하자 그녀는 시간을 확인하고 메모를 꺼냈다.',
    '그날 예정된 회의는 늦은 오후에 시작하므로 관람할 여유가 충분하다고 판단했다.',
    '옆에 있던 친구는 구경만 하지 말고 포스터 사진도 남기자며 웃었다.',
    '하은은 오래된 마을 지도 앞에 멈춰 서서 낯익은 거리 이름을 읽기 시작했다.',
    '거리는 지금과 달리 넓은 광장이었고 그 옆에 작은 시장이 있었다고 적혀 있었다.',
    '그녀는 돌아가면 조부모님께 이 장소를 기억하시는지 물어봐야겠다고 생각했다.'
  ].join(' ');
  assert.ok(natural.length>240);
  const t=await scenario({mode:'economy',body:natural});
  await t.fire();
  assert.equal(t.calls(),0); // No forced rewriting merely because natural prose contains short clauses.
  assert.equal(t.current(),natural);
}
{
  // Repeated two-word replies and interrogative echoes are a defect even without exact sentence repeats.
  const loop=(
    '복도에서 두 사람은 이미 정해진 약속에 관해 이야기를 했다.\n'
    +'[하은]\n"모르겠어요."\n"그럼?"\n"네."\n"그래서?"\n'
    +'[하은]\n"보통은 그렇게 하거든요."\n"두 번째는?"\n'
  ).repeat(5);
  assert.ok(loop.length>240);
  const t=await scenario({body:loop,mode:'economy',reply:'skip'});
  await t.fire();
  assert.equal(t.calls(),1);
  assert.equal(t.current(),loop);
  assert.match(t.modelArgs[0].messages[0].content,/interview-like question\/yes-answer/);
}
{
  // Saving backups must happen before applying, so a storage failure is never data loss.
  const t=await scenario({storageFail:true});
  await t.fire();
  assert.equal(t.calls(),2);
  assert.equal(t.writes(),0);
  assert.equal(t.current(),story);
}
{
  const raw='<Thoughts>\n'+('Huge planning. ').repeat(17000)+'</Thoughts>\n\n'+story;
  const t=await scenario({body:raw,reply:'skip'});
  await t.fire();
  assert.equal(t.calls(),1);
  assert.equal(t.writes(),0);
  assert.equal(t.current(),raw); // raw >200k: refuse a non-restorable edit
}
console.log('Bard Editor Lab: 13 mock scenarios passed');

