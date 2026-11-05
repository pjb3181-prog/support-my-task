
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {readFileSync}=require('node:fs');
const {resolve}=require('node:path');
const vm=require('node:vm');
const plugin=readFileSync(resolve(__dirname,'../bard_editor_lab.js'),'utf8');
const STORY='[유나]\n\"괜찮아?\"\n\n'+('둘은 연구실에서 자료를 정리하며 어제의 실험과 다음 계획을 이야기했다. ').repeat(18)
  +'\n그녀는 어김없이 고개를 숙였다.\n'
  +('서로 다른 의견을 조율했고 조금씩 앞으로 나아갔다. ').repeat(10)
  +'\n<Yuna|neutral.1>';
const EXCERPT='그녀는 어김없이 고개를 숙였다.';
const BETTER='그녀는 보고서를 접고 다음 실험을 먼저 제안했다.';
const BETTER2='그녀는 먼저 실험 계획을 고쳐 쓰며 다음 순서를 제안했다.';
const wait=ms=>new Promise(r=>setTimeout(r,ms));
async function until(fn,ms=1000){
  const limit=Date.now()+ms;
  while(Date.now()<limit){
    if(fn())return;
    await wait(10);
  }
  throw Error('test timeout');
}
async function launch(scenario,initialModel='otherAx'){
  let chat={id:'test-chat',message:[{role:'user',data:'다음 장면을 써 줘'},{
    role:'char',chatId:'gen1',data:STORY
  }]};
  const existing={
    mode:'collab',model:initialModel,collabWriter:'model',collabProfile:'balanced',
    collabRounds:2,collabBudgetSec:60,collabPatchPct:20,collabMaxIssues:3,
    collabConfidence:.75,auto:true,realEditor:true,promptAssist:false,
    sceneAuto:false,sceneAssist:false,sceneCard:false,voiceGuard:false,
    momentum:false,watchStoryRunner:false,maxChars:18000
  };
  const storage=new Map(initialModel===null?[]:[['bard_editor_lab_v03',existing]]);
  const listeners=new Map(),replacers=new Map(),calls=[],uiCallbacks=new Map(),uiElements=new Map();
  const document={body:{innerHTML:''},getElementById:id=>{
    if(!uiElements.has(id))uiElements.set(id,{value:'',checked:false,onchange:null,onclick:null});
    return uiElements.get(id);
  },querySelectorAll:()=>[]};
  const llm=async ({mode,messages,allowPlugins})=>{
    calls.push({mode,messages,allowPlugins});
    assert.equal(allowPlugins,true,'provider plugin models must be allowed for DeepSeek/GLM routing');
    if(['otherAx','memory'].includes(mode)&&calls.filter(x=>x.mode===mode).length===1){
      if(scenario==='pass')return {type:'success',result:JSON.stringify({
        status:'PASS',strengths:['말투의 차이가 자연스럽다'],issues:[],summary:'유지'
      })};
      const excerpt=scenario==='badtag'?'<Yuna|neutral.1>':EXCERPT;
      return {type:'success',result:JSON.stringify({
        status:'PATCH',strengths:['상황의 연결이 자연스럽다'],
        issues:[{id:'I1',excerpt,problem:'의미 없는 반복',instruction:'행동을 고유한 선택으로 교정',confidence:.94}],
        summary:'한 곳만 교정'
      })};
    }
    if(mode==='model'){
      if(scenario==='changedChat')chat.message.push({role:'user',data:'다음 턴을 이미 입력함'});
      if(scenario==='multi'&&calls.filter(x=>x.mode==='model').length===2)
        return {type:'success',result:JSON.stringify({patches:[{issueId:'I2',before:BETTER,after:BETTER2}]})};
      if(scenario==='badtag')return {type:'success',result:JSON.stringify({
        patches:[{issueId:'I1',before:'<Yuna|neutral.1>',after:'<Yuna|angry.1>'}]
      })};
      return {type:'success',result:JSON.stringify({
        patches:[{issueId:'I1',before:EXCERPT,after:BETTER}]
      })};
    }
    if(scenario==='multi'&&calls.filter(x=>x.mode===mode).length===2)
      return {type:'success',result:JSON.stringify({
        status:'PATCH',improved:true,strengths:['개선된 선택'],
        issues:[{id:'I2',excerpt:BETTER,problem:'조금 더 구체화 필요',instruction:'근거를 덧붙여라',confidence:.9}],summary:'부분 재교정'
      })};
    if(scenario==='reject')return {type:'success',result:JSON.stringify({
      status:'REJECT',improved:false,strengths:['원문이 더 자연스러움'],issues:[],summary:'이전 버전 유지'
    })};
    return {type:'success',result:JSON.stringify({
      status:'PASS',improved:true,strengths:['원문 장점을 보존함'],issues:[],summary:'개선 확인'
    })};
  };
  const risuai={
    pluginStorage:{getItem:async k=>storage.get(k),setItem:async(k,v)=>storage.set(k,v)},
    registerSetting:async(name,fn)=>{uiCallbacks.set(name,fn)},registerButton:async()=>{},showContainer:async()=>{},hideContainer:async()=>{},
    addRisuReplacer:async(name,fn)=>{replacers.set(name,fn)},
    addRisuChatListener:async(name,fn)=>{listeners.set(name,fn)},
    onUnload:async()=>{},runLLMModel:llm,
    getCharacter:async()=>({name:'유나',firstMessage:'첫 장면 참고',personality:'계획성이 강함'}),
    getCurrentCharacterIndex:async()=>0,getCurrentChatIndex:async()=>0,
    getChatFromIndex:async()=>chat,
    setChatToIndex:async(ci,ti,next)=>{assert.equal(ci,0);assert.equal(ti,0);chat=next}
  };
  const context={risuai,document,console,setTimeout,clearTimeout,setInterval:()=>1,clearInterval:()=>{}};
  const evaluated=vm.runInNewContext(plugin,context,{filename:'bard_editor_lab.js',timeout:4000});
  await evaluated;
  assert.ok(listeners.has('output'),'output listener must be registered');
  assert.ok(replacers.has('afterRequest'),'afterRequest hook must be registered');
  return {
    calls,storage,replacers, get chat(){return chat},
    get html(){return document.body.innerHTML},
    openUI:()=>uiCallbacks.get('Bard Editor Lab')(),
    control:id=>document.getElementById(id),
    emit:()=>listeners.get('output')({characterIndex:0,chatIndex:0,chat,messageIndex:1,char:{name:'유나'}})
  };
}
test('collaboration mode does not block the initial afterRequest',async()=>{
  const app=await launch('pass');
  assert.equal(await app.replacers.get('afterRequest')(STORY,'model'),STORY);
  assert.equal(app.calls.length,0);
});
test('editor PASS preserves original and avoids invoking writer',async()=>{
  const app=await launch('pass');app.emit();
  await until(()=>app.storage.get('bard_editor_lab_v034_activity')?.length);
  assert.deepEqual(app.calls.map(x=>x.mode),['otherAx']);
  assert.equal(app.chat.message[1].data,STORY);
});
test('editor -> writer -> editor recheck produces only a targeted patch with backup',async()=>{
  const app=await launch('patch');app.emit();
  await until(()=>app.storage.get('bard_editor_lab_v034_activity')?.length);
  assert.deepEqual(app.calls.map(x=>x.mode),['otherAx','model','otherAx']);
  assert.equal(app.chat.message[1].data,STORY.replace(EXCERPT,BETTER));
  assert.ok(app.storage.get('bard_editor_lab_v03_backups')?.length);
  assert.equal(app.storage.get('bard_editor_lab_v03_backups')[0].original,STORY);
  const writerMessage=app.calls[1].messages[1].content;
  assert.ok(writerMessage.includes('beforeContext'));
  assert.ok(writerMessage.length<STORY.length);
});
test('unsafe marker rewrite is rejected without corrupting the chat',async()=>{
  const app=await launch('badtag');app.emit();
  await until(()=>app.storage.get('bard_editor_lab_v034_activity')?.length);
  assert.equal(app.chat.message[1].data,STORY);
  assert.deepEqual(app.calls.map(x=>x.mode),['otherAx','model']);
});
test('duplicate output event is deduplicated',async()=>{
  const app=await launch('pass');app.emit();
  await until(()=>app.storage.get('bard_editor_lab_v034_activity')?.length);
  app.emit();await wait(30);
  assert.equal(app.calls.length,1);
});

test('two revision rounds are available but only changed excerpts are used',async()=>{
  const app=await launch('multi');app.emit();
  await until(()=>app.storage.get('bard_editor_lab_v034_activity')?.length);
  assert.deepEqual(app.calls.map(x=>x.mode),['otherAx','model','otherAx','model','otherAx']);
  assert.equal(app.chat.message[1].data,STORY.replace(EXCERPT,BETTER2));
});
test('DeepSeek can reject a candidate; original is kept',async()=>{
  const app=await launch('reject');app.emit();
  await until(()=>app.storage.get('bard_editor_lab_v034_activity')?.length);
  assert.equal(app.chat.message[1].data,STORY);
  assert.equal(app.storage.get('bard_editor_lab_v03_backups')?.length||0,0);
});
test('if user has moved to the next turn, late revisions cannot overwrite history',async()=>{
  const app=await launch('changedChat');app.emit();
  await until(()=>app.storage.get('bard_editor_lab_v034_activity')?.length);
  assert.equal(app.chat.message[1].data,STORY);
  assert.equal(app.chat.message[2].role,'user');
});

test('settings UI renders and changing the quality profile persists',async()=>{
  const app=await launch('pass');
  await app.openUI();
  assert.ok(app.html.includes('id="collab-writer"'));
  assert.ok(app.html.includes('id="collab-profile"'));
  await app.control('collab-profile').onchange({target:{value:'quality'}});
  const saved=app.storage.get('bard_editor_lab_v03');
  assert.equal(saved.collabRounds,3);
  assert.equal(saved.collabBudgetSec,150);
  assert.equal(saved.collabPatchPct,30);
  assert.equal(saved.collabConfidence,.7);
});

test('new installation defaults the reviewer to memory slot, without changing provider settings',async()=>{
  const app=await launch('pass',null);
  await app.openUI();
  assert.match(app.html,/value="memory" selected/);
  assert.match(app.html,/memory 슬롯/);
  assert.equal(app.storage.get('bard_editor_lab_v03'),undefined,'default is in-memory until user saves');
});
test('existing user editor model selection is preserved on upgrade',async()=>{
  const app=await launch('pass','otherAx');
  await app.openUI();
  assert.match(app.html,/value="otherAx" selected/);
  assert.equal(app.storage.get('bard_editor_lab_v03').model,'otherAx');
});
test('one-click memory route switch changes only Editor Lab configuration',async()=>{
  const app=await launch('pass','otherAx');
  const previous={...app.storage.get('bard_editor_lab_v03')};
  await app.openUI();
  await app.control('model-memory').onclick();
  const updated=app.storage.get('bard_editor_lab_v03');
  assert.equal(updated.model,'memory');
  for(const [key,value] of Object.entries(previous)){
    if(key!=='model')assert.equal(updated[key],value,'unrelated setting '+key+' unchanged');
  }
});
test('memory reviewer calls the configured plugin provider and records the route',async()=>{
  const app=await launch('pass','memory');app.emit();
  await until(()=>app.storage.get('bard_editor_lab_v034_activity')?.length);
  assert.deepEqual(app.calls.map(x=>x.mode),['memory']);
  assert.equal(app.calls[0].allowPlugins,true);
  const activity=app.storage.get('bard_editor_lab_v034_activity')[0];
  assert.equal(activity.editorRoute,'memory');
  assert.equal(activity.pipelineMode,'collab');
  assert.equal(app.chat.message[1].data,STORY);
});
test('memory reviewer and main writer take separate routes through targeted patch and recheck',async()=>{
  const app=await launch('patch','memory');app.emit();
  await until(()=>app.storage.get('bard_editor_lab_v034_activity')?.length);
  assert.deepEqual(app.calls.map(x=>x.mode),['memory','model','memory']);
  assert.ok(app.calls.every(x=>x.allowPlugins===true));
  assert.equal(app.chat.message[1].data,STORY.replace(EXCERPT,BETTER));
});
