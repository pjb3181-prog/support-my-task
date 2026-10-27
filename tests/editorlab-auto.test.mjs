import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../risubard-updates/bard_editor_lab.js', import.meta.url),'utf8');
const story = '하은은 상대의 말을 들은 뒤 잠깐 고개를 끄덕였다. "정말?" 하고 되물었지만, 정작 원하는 것이 무엇인지는 설명하지 않았다. 창밖의 불빛이 느리게 흔들렸다. '.repeat(6);
assert.ok(story.length>240 && (story.match(/[가-힣]/g)||[]).length>65);
const revised = story.replace('"정말?" 하고 되물었지만', '"그럼 다음에는 어떻게 할까?" 하고 물었지만').trim();

async function scenario({enabled=true,reply='revise',stream=false,replace=revised}={}) {
  let chat={id:'chat-1',message:[
    {role:'user',data:'이야기를 이어줘',time:11,chatId:'u-1'},
    {role:'char',data:story,time:12,chatId:'m-1'}
  ]};
  const db=new Map([['bard_editor_lab_v03',{
    model:'otherAx',mode:'selective',auto:enabled,watchStoryRunner:false,timeoutMs:90000,maxChars:9000
  }]]);
  const callbacks={}, buttons=new Map();
  let calls=0, writes=0, watcher=null;
  const result=(value)=>stream
    ? {type:'streaming',result:new ReadableStream({start(c){c.enqueue({'0':value.slice(0,25)});c.enqueue({'0':value});c.close()}})}
    : {type:'success',result:value};
  const risuai={
    pluginStorage:{
      getItem:async k=>structuredClone(db.get(k)),
      setItem:async(k,v)=>{db.set(k,structuredClone(v))}
    },
    getCurrentCharacterIndex:async()=>0,
    getCurrentChatIndex:async()=>0,
    getChatFromIndex:async()=>structuredClone(chat),
    setChatToIndex:async (_ci,_ti,newChat)=>{chat=structuredClone(newChat);writes++},
    runLLMModel:async args=>{
      assert.equal(args.mode,'otherAx');
      calls++;
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
    calls:()=>calls,writes:()=>writes,db,callbacks,buttons,watch:()=>watcher};
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
console.log('Bard Editor Lab: 7 mock scenarios passed');
