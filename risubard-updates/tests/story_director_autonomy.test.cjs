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
  assert.match(source.slice(0,800), /\/\/@version 1\.3\.2/)
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

test('auto continuation delegates NPC decisions and does not pre-script them', () => {
  const block=extract('  function draftMessages(userRequest,decision,variation=', '  async function generateInstruction(')
  const fn=new Function('preparePrompt','AUTO_CONTINUE_REQUEST','clip','authoredLimits',block+'\nreturn draftMessages')(
    (mode,input)=>[{role:'system',content:'base mode='+mode},{role:'user',content:input}],
    'continue the story',clip,()=>({}))
  const auto=fn('',{verdict:'판정 불필요'},'','auto')
  assert.match(auto[0].content,/AI 자율 전개 전용/)
  assert.match(auto[0].content,/본문 AI가|집필 AI가/)
  assert.match(auto[0].content,/사용자가 명시하지 않은 반응/)
  assert.doesNotMatch(auto[0].content,/8시간 뒤 나미가 깨어나는/)
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
})

test('explicit next-scene generation and final send still require user approval', () => {
  assert.match(source,/async function autoContinueAndSend\(input\)/)
  assert.match(source,/await sendDraft\(result\.instruction\)/)
  assert.match(source,/if\(!window\.confirm\(question\)\)return false/)
  assert.match(source,/if\(current\.userMessageCount===0\)/)
  assert.match(source,/ta\.addEventListener\('input',\(\)=>\{project\.last\.instruction=ta\.value/)
})
