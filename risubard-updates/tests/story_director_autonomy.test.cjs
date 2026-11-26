'use strict'
const assert = require('node:assert/strict')
const test = require('node:test')
const fs = require('node:fs')
const source = fs.readFileSync('risubard-updates/story_director.ts', 'utf8')

function extract(start, end) {
  const a = source.indexOf(start)
  const b = source.indexOf(end, a + start.length)
  assert.ok(a >= 0 && b > a, 'function block must remain accessible')
  return source.slice(a, b)
}
const clip = (v,n=10000) => String(v ?? '').slice(0,n)
const list = v => Array.isArray(v) ? v : []

test('plugin syntax, identity, storage prefix and automatic update endpoint remain stable', () => {
  assert.doesNotThrow(() => new Function(source))
  assert.match(source.slice(0,800), /\/\/@name story_director/)
  assert.match(source.slice(0,800), /\/\/@version 1\.3\.6/)
  assert.match(source.slice(0,1100), /\/\/@update-url https:\/\/raw\.githubusercontent\.com\/pjb3181-prog\/support-my-task\/main\/risubard-updates\/story_director\.ts/)
  assert.match(source, /const PREFIX = 'story_director_v1:'/)
  assert.match(source, /await api\.registerSetting\('Story Director'/)
})

test('main screen has exactly the three requested tabs, with legacy tools collapsed', () => {
  const code = extract('  function renderUI(){','  function renderLogs(){')
  assert.match(code, /\['plan','전체 흐름','plan'\]/)
  assert.match(code, /\['main','지금 지시','director'\]/)
  assert.match(code, /\['settings','플러그인 설정','settings'\]/)
  assert.doesNotMatch(code, /\['logs','기록·복원','logs'\]/)
  assert.match(code, /고급: 기록·복원/)
  assert.match(code, /고급: 자료 원문·기존 입력칸 직접 열기/)
  assert.match(code, /ui\.flowHistory/)
  assert.match(code, /ui\.flowProposal/)
  assert.match(source, /ui\.instruction=ta/)
  assert.match(code, /현재 이야기/)
  assert.match(source, /btn\(actions,'AI와 상담'/)
  assert.match(source, /btn\(actions,'지시문 생성'/)
  assert.match(source, /고급: 반응 판정·자율 전개/)
})

test('long-term flow chat asks the model but never writes a proposed goal without approval', async () => {
  const block = extract('  async function discussFlow(message){', '  function renderHistory(){')
  // Extract only discussFlow and omit renderer helpers in front.
  const code = block.slice(block.indexOf('  async function discussFlow(message){'))
  let answer = JSON.stringify({reply:'현재 사건과 목표가 충돌하지 않아.',suggested_goal:'새로운 장기 목표'})
  const project = {goal:'기존에 확정한 목표',canon:'',plan:'',flowTalks:[],flowSuggestedGoal:'',planInput:''}
  const current = {key:'chat-1',card:{name:'Fate'},persona:{},loreText:[],wikiText:'',history:''}
  let saved = 0
  const ui = {planComposer:{value:'before'}}
  const deps = {project,current,ui,clip,list,now:()=>new Date(0).toISOString(),
    verifySession:async()=>{},
    readSources:async()=>({...current}),
    askModel:async()=>answer,
    parseObject:JSON.parse,
    save:async()=>{saved++},
    renderFlowHistory:()=>{},renderFlowProposal:()=>{}}
  const fn = new Function(...Object.keys(deps),code+'\nreturn discussFlow')(...Object.values(deps))
  await fn('성배전쟁을 무사히 끝내고 싶어')
  assert.equal(project.goal,'기존에 확정한 목표')
  assert.equal(project.flowSuggestedGoal,'새로운 장기 목표')
  assert.equal(project.flowTalks.length,1)
  assert.equal(saved,1)
  assert.equal(ui.planComposer.value,'')
})

test('auto continuation decides core scene beats while leaving prose to the writer', () => {
  const block=extract('  function draftMessages(userRequest,decision,variation=', '  async function generateInstruction(')
  const fn=new Function('preparePrompt','AUTO_CONTINUE_REQUEST','clip','authoredLimits',block+'\nreturn draftMessages')(
    (mode,input)=>[{role:'system',content:'base mode='+mode},{role:'user',content:input}],
    'continue the story',clip,()=>({}))
  const auto=fn('',{verdict:'판정 불필요'},'','auto')
  assert.match(auto[0].content,/AI 자율 전개 전용/)
  assert.match(auto[0].content,/집필 AI에 남긴다/)
  assert.match(auto[0].content,/개연성 있는 다음 사건 하나를 선택/)
  assert.match(auto[0].content,/구체적인 핵심 행동/)
  assert.match(auto[0].content,/반응 방향 또는 장면의 도달점/)
  assert.match(auto[0].content,/구체적인 대사, 표정, 문장, 세부 동작/)
  assert.doesNotMatch(auto[0].content,/8시간 뒤 나미가 깨어나는/)
  for(const mode of ['auto','instruct','judge']){
    const prompt=fn('여러 장면을 연결해',{},'',mode)[0].content
    assert.match(prompt,/핵심 사건 하나만 남겨 나머지를 삭제하지 마라/)
    assert.match(prompt,/비어 있는 연결 과정/)
    assert.match(prompt,/전원 동의 금지/)
    assert.match(prompt,/대사의 말맛/)
    assert.match(prompt,/최대 1200자/)
    assert.match(prompt,/책임을 강조하는 격려와 신뢰의 표현은 질책이나 위협이 아니다/)
    assert.match(prompt,/모든 등장인물에게 서로 다른 입장이나 반대를 배정할 필요가 없다/)
  }
})

test('ordinary auto consultation does not automatically send or generate a directive', async () => {
  const block=extract('  async function runDirector(input,mode,forceAutonomous=false) {','  async function runBootstrap(){')
  const project={goal:'happy ending',talks:[],last:null,input:''}
  const current={key:'active'}
  const calls={draft:0,judge:0,model:0}
  const deps={project,current,clip,list,now:()=>new Date(0).toISOString(),
    verifySession:async()=>{},flushSave:async()=>{},
    readSources:async()=>({key:'active',history:'latest'}),
    selectInteractionMode:(_input,mode)=>mode,
    preparePrompt:()=>[{role:'system',content:'prompt'}],
    askModel:async()=>{calls.model++;return '{"reply":"상담 결과","instruction":"SHOULD BE IGNORED"}'},
    normalizedResult:()=>({reply:'상담 결과',instruction:'unexpected'}),
    needsInstruction:mode=>['judge','instruct','auto'].includes(mode),
    isAuthorSceneDirection:()=>false,authoredDecision:()=>({}),
    autonomousDecision:()=>({}),judgeSituation:async()=>{calls.judge++;return {reply:'judge'}},
    generateInstruction:async()=>{calls.draft++;return 'tiny directive'},
    retainAuthorDirective:()=>{},save:async()=>{}}
  const fn=new Function(...Object.keys(deps),block+'\nreturn runDirector')(...Object.values(deps))
  const result=await fn('', 'auto')
  assert.equal(calls.model,1)
  assert.equal(calls.draft,0)
  assert.equal(calls.judge,0)
  assert.equal(result.instruction,'')
  assert.equal(project.goal,'happy ending')
  const direct=await fn('팀원들의 노력과 가능성을 인정하고 함께 새 목표를 정하자', 'instruct')
  assert.equal(direct.instruction,'tiny directive')
  assert.equal(calls.judge,0)
  assert.equal(calls.draft,1)
  await fn('이 제안을 상대가 수락할지 판정해', 'judge')
  assert.equal(calls.judge,1)
})

test('autonomous draft generation never sends chat or closes the editor', async () => {
  const block=extract('  async function generateAutonomousDraft(input){','  function addDirectorComposer(parent){')
  let calls=0
  const draft={instruction:'Continue the next scene.'}
  const fn=new Function('runDirector',block+'\nreturn generateAutonomousDraft')(async (input,mode,force)=>{
    calls++
    assert.equal(input,'next scene')
    assert.equal(mode,'auto')
    assert.equal(force,true)
    return draft
  })
  assert.equal(await fn('next scene'),draft)
  assert.equal(calls,1)
  assert.doesNotMatch(block,/sendDraft|sendChat|hideContainer|confirm/)
  assert.doesNotMatch(source,/autoContinueAndSend|AI에게 맡겨 바로 이어가기/)
  assert.equal((source.match(/await generateAutonomousDraft\(/g)||[]).length,2)
})
test('failed autonomous drafting does not send chat', async () => {
  const block=extract('  async function generateAutonomousDraft(input){','  function addDirectorComposer(parent){')
  const fn=new Function('runDirector',block+'\nreturn generateAutonomousDraft')(async()=>({instruction:'',draftError:'draft failed'}))
  await assert.rejects(fn(''),/draft failed/)
})
test('explicit final send still requires user approval', () => {
  assert.match(source,/if\(!window\.confirm\(question\)\)return false/)
  assert.match(source,/if\(current\.userMessageCount===0\)/)
  assert.match(source,/ta\.addEventListener\('input',\(\)=>\{project\.last\.instruction=ta\.value/)
  assert.equal((source.match(/api\.sendChat\(/g)||[]).length,1)
})

test('autonomous draft validator rejects unresolved alternatives and delegation', () => {
  const block=extract('  function autonomousDraftNeedsRewrite(value){','  function instructionNeedsRewrite(value){')
  const fn=new Function('clip',block+'\nreturn autonomousDraftNeedsRewrite')(clip)
  assert.equal(fn('회의가 끝나면 민수가 자리에서 일어나려는지, 혹은 여전히 머무는지 자연스럽게 이어가. 다음 사건은 집필 AI가 스스로 결정하게 해.'),true)
  assert.equal(fn('다음 장면은 집필 AI가 자율적으로 결정하게 해.'),true)
  assert.equal(fn('회의가 끝나면 민수와 지윤이 로비로 이동하도록 해. 민수가 다음 약속 시간을 확인하고 지윤이 다른 시간을 제안하는 장면까지 이어가.'),false)
  assert.equal(fn('두 사람이 정류장으로 이동해. 대사와 표정은 인물 성격에 맞게 자연스럽게 표현해.'),false)
})
test('autonomous generation retries vague drafts and never falls back to generic delegation', async () => {
  const block=extract('  async function generateInstruction(userRequest,decision,variation=', '  function lastDirectorRequest(){')
  const validation=extract('  function autonomousDraftNeedsRewrite(value){','  function instructionNeedsRewrite(value){')
  const validate=new Function('clip',validation+'\nreturn autonomousDraftNeedsRewrite')(clip)
  let calls=0
  const good='회의가 끝나면 로비로 이동하도록 해. 민수가 다음 약속 시간을 제안하는 장면까지 이어가.'
  const bad='다음 사건은 집필 AI가 스스로 결정하게 해.'
  const make=(responses)=>new Function('draftMessages','askModel','parseObject','clip','inventedConflictOrContradiction','instructionNeedsRewrite','autonomousDraftNeedsRewrite',block+'\nreturn generateInstruction')(
    ()=>[{content:''}],async()=>JSON.stringify({instruction:responses[Math.min(calls++,responses.length-1)]}),JSON.parse,clip,()=>'',()=>false,validate)
  assert.equal(await make([bad,good])('다음 장면',{},'','auto'),good)
  assert.equal(calls,2)
  calls=0
  await assert.rejects(make([bad])('다음 장면',{},'','auto'),/구체적인 다음 장면 지시문/)
  assert.equal(calls,2)
})

test('director rejects boilerplate opposition or delegation and accepts developed scene direction',()=>{
  const block=extract('  function autonomousDraftNeedsRewrite(value){','  function instructionNeedsRewrite(value){')
  const fn=new Function('clip',block+'\nreturn autonomousDraftNeedsRewrite')(clip)
  assert.equal(fn('서점의 마지막 영업일을 진행해. 단골들의 반응은 각자 성격과 상황에 따라 자발적으로 결정되게 해.'),true)
  assert.equal(fn('새 출발을 제안하도록 해. 곧바로 전원 동의로 이어지지 않도록 하고 대화를 이어가.'),true)
  assert.equal(fn('마지막 영업일에 단골들이 찾아와 그동안의 추억을 이야기하도록 해. 감사의 인사가 이어지면서 주인이 새로운 서점을 열고 싶다는 계획을 털어놓는 장면까지 이어가.'),false)
})
test('longer multi-beat directions fit the new size limit',()=>{
  const block=extract('  function instructionNeedsRewrite(value){','  function draftMessages(userRequest,decision,variation=')
  const fn=new Function('clip',block+'\nreturn instructionNeedsRewrite')(clip)
  const long='단골들과 추억을 이야기하는 장면을 이어가. '.repeat(24)
  assert.ok(long.length>500&&long.length<1200)
  assert.equal(fn(long),false)
  assert.equal(fn(long.repeat(4)),true)
})

test('fresh draft excludes previous unapproved draft and preserves emotional purpose',()=>{
  const block=extract('  function draftMessages(userRequest,decision,variation=', '  async function generateInstruction(')
  let options
  const fn=new Function('preparePrompt','AUTO_CONTINUE_REQUEST','clip','authoredLimits',block+'\nreturn draftMessages')(
    (mode,input,opts)=>{options=opts;return [{role:'system',content:''},{role:'user',content:input}]},
    '',clip,()=>({}))
  const result=fn('여러분을 믿고 투자하는 거예요. 성과에 따라 보상받도록 함께 노력합시다.',{},'','instruct')
  assert.equal(options.independent,true)
  assert.match(result[0].content,/실무 질문도 공동의 목표/)
})
test('team agreement is not rejected by default',()=>{
  const block=extract('  function autonomousDraftNeedsRewrite(value){','  function instructionNeedsRewrite(value){')
  const fn=new Function('clip',block+'\nreturn autonomousDraftNeedsRewrite')(clip)
  assert.equal(fn('새로운 팀의 방향과 성과 기준을 함께 논의하도록 해. 곧바로 전원 동의로 이어지지 않게 하고 서로 다른 반응을 보이게 해.'),true)
  assert.equal(fn('팀원들이 자신들의 능력을 인정받았다는 기대를 드러내고, 각자의 목표와 성과 기준을 함께 구체화하는 대화로 이어가.'),false)
})
