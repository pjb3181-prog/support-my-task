const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const path=require('node:path');
const src=fs.readFileSync(path.resolve(__dirname,'../mutation_state.ts'),'utf8');
const start=src.indexOf('  function canonPromptText(value) {');
const stop=src.indexOf('  async function beforeRequest(messages, requestModel) {',start);
assert.ok(start>=0 && stop>start,'Missing exact Mutation World Canon request scope helper');
const helper=src.slice(start,stop);
const id='mutation-world-global-sample';
const world=(entry='Mutation generated world canon')=>({
  id,name:'Mutation World Canon',lorebook:[
    {content:entry},{content:'Mutation generated speech canon'}],
});
const sample=['Original character description','Mutation generated world canon',
  'Mutation generated speech canon','Unrelated lorebook instructions'];
function setup({modules=[world()],enabledIds=[id],fail=false}={}){
  const events={reads:0,writes:0};
  const db={modules,enabledModules:enabledIds};
  const sandbox={
    Set,console:{log:()=>{}},text:x=>typeof x==='string'?x:(x==null?'':String(x)),
    isMutationWorldModule:x=>!!(x&&typeof x.id==='string'&&x.id.startsWith('mutation-world-global-')),
    risuai:{
      getDatabase:async()=>{events.reads++;if(fail)throw Error('database unavailable');return db;},
      setDatabaseLite:async()=>{events.writes++;throw Error('cannot write db during generation');}
    }
  };
  vm.runInNewContext(helper+'\nthis.scopeTest=scopeMutationWorldCanon;',sandbox,{timeout:1000});
  return {fn:sandbox.scopeTest,db,events};
}
function prompt(){
  return [
    {role:'system',content:sample[0]},
    {role:'system',content:sample[1]},
    {role:'system',content:sample[2]},
    {role:'system',content:sample[3]},
    {role:'user',content:sample[1]},
    {role:'assistant',content:'An earlier narrative mentions a changed world'},
  ];
}
test('fresh unselected chat strips all exact global mutation lore entries',async()=>{
  const s=setup(),source=prompt(),result=await s.fn(source,'unselected');
  assert.equal(result.removed,2);
  assert.equal(result.chars,sample[1].length+sample[2].length);
  assert.equal(result.status,'scoped');
  assert.deepEqual(Array.from(result.messages,x=>x.content),[sample[0],sample[3],sample[1],'An earlier narrative mentions a changed world']);
  assert.equal(source.length,6,'never mutate host prompt in place');
  assert.equal(s.events.writes,0);
});
test('explicit common mutation chat receives original complete prompt without database reads',async()=>{
  const s=setup(),source=prompt(),result=await s.fn(source,'common');
  assert.equal(result.messages,source);
  assert.equal(result.removed,0);
  assert.equal(s.events.reads,0);
});
for(const mode of ['original','ntr','unselected']){
  test(mode+' suppresses the global canon without discarding other instructions',async()=>{
    const s=setup(),out=await s.fn(prompt(),mode);
    assert.equal(out.removed,2);
    assert.equal(out.messages.find(x=>x.content===sample[0]).role,'system');
    assert.equal(out.messages.find(x=>x.content===sample[3]).role,'system');
  });
}
test('disabled Mutation world module is not changed or removed',async()=>{
  const s=setup({enabledIds:[]}),source=prompt(),out=await s.fn(source,'unselected');
  assert.equal(out.messages,source);
  assert.equal(out.removed,0);
  assert.equal(s.events.writes,0);
});
test('does not block an unrelated module with identical words when Mutation module absent',async()=>{
  const unrelated={id:'normal-not-mutation',name:'World',lorebook:[{content:sample[1]}]};
  const s=setup({modules:[unrelated],enabledIds:['normal-not-mutation']});
  const source=prompt(),out=await s.fn(source,'unselected');
  assert.equal(out.messages,source);
});
test('substring similarities never cause other content to be stripped',async()=>{
  const s=setup(),source=[
    {role:'system',content:'Keep original lore. Mutation generated world canon is a historical quote.'},
    {role:'system',content:'Mutation generated world canon'},
    {role:'user',content:'Mutation generated world canon'},
    {role:'system',content:'  Mutation generated world canon \r\n'}
  ];
  const out=await s.fn(source,'unselected');
  assert.equal(out.removed,2);
  assert.equal(out.messages[0],source[0]);
  assert.equal(out.messages[1],source[2]);
});
test('full block duplicates are all removed, but user text remains',async()=>{
  const s=setup(),source=[
    {role:'system',content:sample[1]},
    {role:'system',content:sample[1]},
    {role:'user',content:sample[1]},
  ];
  const out=await s.fn(source,'original');
  assert.equal(out.removed,2);
  assert.deepEqual(Array.from(out.messages,x=>x.role),['user']);
});
test('database permission error preserves original prompt and reports inspection failure',async()=>{
  const s=setup({fail:true}),source=prompt(),out=await s.fn(source,'unselected');
  assert.equal(out.messages,source);
  assert.equal(out.removed,0);
  assert.equal(out.status,'lookup-failed');
});
test('empty input and non-array input are returned safely',async()=>{
  const s=setup();
  assert.equal((await s.fn(null,'unselected')).messages,null);
  assert.equal((await s.fn([],'unselected')).removed,0);
});
test('beforeRequest isolates canon before any original/ntr/unselected return',()=>{
  const before=src.slice(src.indexOf('  async function beforeRequest(messages, requestModel) {'));
  assert.match(before,/const activeTarget = await syncTarget\(\)/);
  const scopeAt=before.indexOf('await scopeMutationWorldCanon(messages, worldMode)');
  const ntrAt=before.indexOf('if (worldMode === "ntr")');
  const offAt=before.indexOf('if (!mutationMasterEnabled())');
  assert.ok(scopeAt>=0&&scopeAt<ntrAt&&ntrAt<offAt);
  assert.match(before,/if \(!mutationMasterEnabled\(\)\) \{[\s\S]*?return scoped\.messages/);
  assert.match(src,/storyWorldMode: "unselected"/);
});
test('version is aligned in the v3 extension header and runtime',()=>{
  assert.match(src,/\/\/@version 0\.79\.5/);
  assert.match(src,/const VERSION = "0\.79\.5"/);
});
