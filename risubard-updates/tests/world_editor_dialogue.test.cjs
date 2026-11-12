'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
const src=fs.readFileSync(path.join(__dirname,'..','world_editor_lab.js'),'utf8');
const start=src.indexOf('async function ai('),end=src.indexOf('function jsonResult(',start);
assert.ok(start>0&&end>start);
function harness(initial=[]){
 const requests=[],saved=[];
 const env={
  dialogue:initial.map(x=>({...x})),notes:'',status:'',model:'model',
  cut:(x,n=12000)=>String(x??'').slice(0,n),
  sourceSummary:()=>({name:'Test',fields:{}}),
  character:{name:'Test'},
  persist:async()=>saved.push(1),
  risuai:{runLLMModel:async opts=>{requests.push(opts);return {type:'success',result:'세계를 어떻게 바꿀지 함께 정해 보자.'};}},
 };
 const fn=vm.runInNewContext(src.slice(start,end)+'({ai,discuss})',env);
 return {fn,env,requests,saved};
}
test('first user input invokes RisuBard model and creates an assistant discussion turn',async()=>{
 const h=harness();
 await h.fn.discuss('현대 한국과 수인 사회를 합치자');
 assert.equal(h.requests.length,1);
 assert.equal(h.requests[0].mode,'model');
 assert.equal(h.requests[0].allowPlugins,false);
 assert.ok(h.requests[0].messages.some(x=>x.role==='user'&&x.content.includes('현대 한국과 수인 사회')));
 assert.equal(h.env.dialogue.length,2);
 assert.equal(h.env.dialogue[1].role,'assistant');
 assert.ok(h.env.dialogue[1].content.includes('함께 정해 보자'));
});
test('retry answers a previously unanswered user message without duplicating it',async()=>{
 const h=harness([{role:'user',content:'이전에 내가 결정한 설정'}]);
 await h.fn.discuss('');
 assert.equal(h.env.dialogue.length,2);
 assert.equal(h.env.dialogue.filter(x=>x.role==='user').length,1);
 assert.equal(h.requests.length,1);
 assert.ok(h.requests[0].messages.some(x=>x.content.includes('이전에 내가 결정한 설정')));
});
test('new input after earlier failures retains previous unanswered prompts',async()=>{
 const h=harness([{role:'user',content:'첫 설정'},{role:'user',content:'두 번째 설정'}]);
 await h.fn.discuss('세 번째 수정 지시');
 assert.equal(h.env.dialogue.length,4);
 assert.equal(h.env.dialogue.at(-1).role,'assistant');
 assert.ok(h.requests[0].messages.some(x=>x.content==='첫 설정'));
 assert.ok(h.requests[0].messages.some(x=>x.content==='세 번째 수정 지시'));
});
