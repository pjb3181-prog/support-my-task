'use strict'
const assert = require('node:assert/strict')
const test = require('node:test')
const fs = require('node:fs')
const source = fs.readFileSync('risubard-updates/story_director.ts', 'utf8')

function extract(start, end) {
  const a = source.indexOf(start)
  const b = source.indexOf(end, a + start.length)
  assert.ok(a >= 0 && b > a, 'Story Director function block must remain accessible for tests')
  return source.slice(a, b)
}
function clip(v, n = 10000) { return String(v ?? '').slice(0, n) }

test('whole plugin parses, source ID and update URL stay stable', () => {
  assert.doesNotThrow(() => new Function(source))
  assert.match(source.slice(0, 700), /\/\/@name story_director/)
  assert.match(source.slice(0, 700), /\/\/@version 1\.2\.8/)
  assert.match(source.slice(0, 700), /\/\/@update-url https:\/\/raw\.githubusercontent\.com\/pjb3181-prog\/support-my-task\/main\/risubard-updates\/story_director\.ts/)
})

test('default auto brief delegates decisions instead of prescribing Nami-style emotional beats', () => {
  const block = extract('  function draftMessages(userRequest,decision,variation=', '  async function generateInstruction(')
  const makeDraft = new Function('preparePrompt', 'AUTO_CONTINUE_REQUEST', 'clip', 'authoredLimits', block + '\nreturn draftMessages')
  const draft = makeDraft((mode, input) => [{role:'system',content:'base mode=' + mode}, {role:'user',content:input}],
    'continue the story', clip, () => ({}))
  const auto = draft('', {verdict:'판정 불필요'}, '', 'auto')
  const instruct = draft('', {verdict:'판정 불필요'}, '', 'instruct')
  assert.match(auto[0].content, /AI 자율 전개 전용/)
  assert.match(auto[0].content, /본\s*AI가|본문을 쓰는 AI가|집필 AI가/)
  assert.doesNotMatch(auto[0].content, /8시간 뒤 나미가 깨어나는/)
  assert.match(instruct[0].content, /8시간 뒤 나미가 깨어나는/)
})

test('auto validator rejects handoff to the user but allows forbidding such handoff', () => {
  const code = extract('  function autonomousDraftNeedsRewrite(value){', '  function instructionNeedsRewrite(value){')
  const validate = new Function('clip', code + '\nreturn autonomousDraftNeedsRewrite')(clip)
  assert.equal(validate('사용자가 다음 선택을 결정하도록 한다.'), true)
  assert.equal(validate('감정의 결론은 본문에 맡겨.'), true)
  assert.equal(validate('사용자에게 다음 선택을 요구하지 마.'), false)
  assert.equal(validate('실제 설정을 따라 AI가 자연스럽게 이야기를 이어가.'), false)
})

function makeDirector(mode = 'auto', input = '') {
  const block = extract('  async function runDirector(input,mode) {', '  async function runBootstrap(){')
  const project = {goal:'', talks:[],last:null,dockDraft:'',input:''}
  const current = {key:'active'}
  const calls = {judge:0,generate:0,generatedMode:null, request:null, saved:0}
  const deps = {
    current,project,AUTO_CONTINUE_REQUEST:'현재 이야기의 다음 장면을 AI가 자율적으로 이어가.',
    verifySession:async()=>{},flushSave:async()=>{},
    readSources:async()=>({key:'active',history:'latest conversation'}),
    selectInteractionMode:(_input,mode)=>mode,
    needsInstruction:mode=>['auto','judge','instruct'].includes(mode),
    isAuthorSceneDirection:()=>false,
    authoredDecision:()=>({verdict:'판정 불필요'}),
    autonomousDecision:()=>({reply:'auto',verdict:'판정 불필요',options:[],instruction:''}),
    judgeSituation:async()=>{calls.judge++;return {reply:'judge',verdict:'보류',instruction:''}},
    generateInstruction:async(req,_res,_variation,chosenMode)=>{
      calls.generate++;calls.generatedMode=chosenMode;calls.request=req;return 'AI가 스스로 다음 장면을 이어가.'
    },
    retainAuthorDirective:()=>{},save:async()=>{calls.saved++},clip,now:()=>new Date(0).toISOString(),
    askModel:async()=>{throw new Error('unexpected askModel')},preparePrompt:()=>{throw new Error('unexpected preparePrompt')},
    normalizedResult:()=>{throw new Error('unexpected normalizedResult')},authoredLimits:()=>({}),text:String,list:Array.isArray
  }
  const fn = new Function(...Object.keys(deps), block + '\nreturn runDirector')(...Object.values(deps))
  return {fn,project,calls,mode,input}
}

test('empty auto request picks story continuation and never pre-judges NPC feelings', async () => {
  const {fn,project,calls} = makeDirector()
  const r=await fn('', 'auto')
  assert.equal(calls.judge,0)
  assert.equal(calls.generate,1)
  assert.equal(calls.generatedMode,'auto')
  assert.match(calls.request,/자율적으로/)
  assert.equal(r.mode,'auto')
  assert.equal(r.instruction,'AI가 스스로 다음 장면을 이어가.')
  assert.equal(project.last.mode,'auto')
})

test('explicit manual judge mode remains separate', async () => {
  const {fn,calls} = makeDirector('judge')
  const r=await fn('이 상황을 판정해', 'judge')
  assert.equal(calls.judge,1)
  assert.equal(calls.generatedMode,'judge')
  assert.equal(r.mode,'judge')
})

test('one-action continue still uses approved sendChat gate', () => {
  assert.match(source,/async function autoContinueAndSend\(input\)/)
  assert.match(source,/await sendDraft\(result\.instruction\)/)
  assert.match(source,/if\(!window\.confirm\(question\)\)return false/)
  assert.match(source,/if\(current\.userMessageCount===0\)/)
  assert.match(source,/AI에게 맡겨 바로 이어가기/)
})
