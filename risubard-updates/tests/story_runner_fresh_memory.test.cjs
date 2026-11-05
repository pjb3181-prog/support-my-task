
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {readFileSync}=require('node:fs');
const {resolve}=require('node:path');
const vm=require('node:vm');
const src=readFileSync(resolve(__dirname,'../story_runner.ts'),'utf8');

function extractBlock(prefix){
  const start=src.indexOf(prefix);
  assert.ok(start>=0,'Missing source entry: '+prefix);
  const begin=src.indexOf('{',start);
  assert.ok(begin>=0,'Missing body: '+prefix);
  let depth=0,finish=-1;
  for(let i=begin;i<src.length;i++){
    if(src[i]==='{')depth++;
    if(src[i]==='}'&&--depth===0){finish=i+1;break;}
  }
  assert.ok(finish>begin,'No function end: '+prefix);
  return src.slice(start,finish);
}
const actualSignature=extractBlock('  function storySignature(s, index, target)');
const helperStart=src.indexOf("  let notebookFreshness = 'unchecked';");
const helperEnd=src.indexOf('  function storySignature(s, index, target)',helperStart);
assert.ok(helperStart>=0&&helperEnd>helperStart,'Freshness helper must precede real signature');
const actualHelper=src.slice(helperStart,helperEnd);

function mock({savedSource='지금 실제 장면이 진행된다.',storedSource=null,
  withLast=true,additionalUser=false,failRead=false,switched=false}={}){
  const target={characterIndex:0,chatIndex:0,characterId:'char-A',chatId:'chat-A'};
  const rows=[{role:'user',data:'안녕하세요'},
    {role:'char',data:savedSource}];
  if(additionalUser)rows.push({role:'user',data:'그 다음에는?'});
  const api={getChatFromIndex:async()=>{
    if(failRead)throw Error('permission denied');
    return {id:'chat-A',message:rows};
  }};
  const sandbox={risuai:api,console:{log:()=>{}},Math,
    project:{storyNotebook:null},currentTarget:switched
      ?{...target,chatId:'other-chat'}:target,notebookStatus:'',
    normalizeStoryNotebook:n=>n&&typeof n==='object'?n:{
      version:2,confidence:'unverified',lastProcessedAt:0,lastProcessedKey:'',
      summary:'',scene:'',lastEvent:'',characters:[],openThreads:[]
    },
    text:x=>String(x??''),
    targetKey:x=>x?x.characterId+'/'+x.chatId:''
  };
  vm.runInNewContext(actualSignature+'\n'+actualHelper,sandbox,{filename:'story_runner.ts',timeout:4000});
  const key=vm.runInNewContext(
    "storySignature("+JSON.stringify(storedSource??savedSource)+",1,currentTarget)",sandbox);
  sandbox.project.storyNotebook={version:2,confidence:'checked',lastProcessedAt:42,
    lastProcessedKey:withLast?key:'',
    summary:'지난 요약',scene:'예전 방',lastEvent:'옛 장면',characters:[],openThreads:[]};
  return {sandbox,target,rows,read:async()=>await vm.runInNewContext('freshNotebookForTarget(currentTarget)',sandbox),
    prompt:()=>vm.runInNewContext('notebookPromptText(_verified)',sandbox),
    setVerified:n=>sandbox._verified=n,
    status:()=>vm.runInNewContext('notebookFreshness',sandbox)};
}
test('matching latest saved AI output allows exactly its verified notebook',async()=>{
  const x=mock(),verified=await x.read();x.setVerified(verified);
  assert.equal(x.status(),'current');
  assert.ok(verified);
  assert.ok(x.prompt().includes('지난 요약'));
  assert.ok(x.prompt().includes('옛 장면'));
});
test('a new unprocessed AI output suppresses previously verified notebook',async()=>{
  const x=mock({storedSource:'이전 방에서 진행한 이야기'});
  const verified=await x.read();x.setVerified(verified);
  assert.equal(verified,null);
  assert.equal(x.prompt(),'');
  assert.equal(x.status(),'stale');
});
test('a new USER turn after the latest AI reply does not falsely invalidate memory',async()=>{
  const x=mock({additionalUser:true});
  const verified=await x.read();x.setVerified(verified);
  assert.ok(verified);
  assert.equal(x.status(),'current');
});
test('an edited accepted AI reply invalidates its old summary',async()=>{
  const x=mock({savedSource:'편집된 AI 답변',storedSource:'편집 전 원문'});
  const verified=await x.read();
  assert.equal(verified,null);
  assert.equal(x.status(),'stale');
});
test('a reused signature from another chat cannot leak continuity',async()=>{
  const x=mock({switched:true});
  assert.equal(await x.read(),null);
  assert.equal(x.status(),'unverified');
});
test('missing notebook signature cannot authorize old memory',async()=>{
  const x=mock({withLast:false});
  assert.equal(await x.read(),null);
  assert.equal(x.status(),'unverified');
});
test('host chat permission error fails closed without deleting original notebook',async()=>{
  const x=mock({failRead:true}),snapshot=JSON.stringify(x.sandbox.project.storyNotebook);
  assert.equal(await x.read(),null);
  assert.equal(x.status(),'unavailable');
  assert.equal(JSON.stringify(x.sandbox.project.storyNotebook),snapshot);
});
test('all model injection paths use a verified notebook, not raw stored project data',()=>{
  assert.match(src,/notebookPromptText\(verifiedNotebook\)/);
  assert.match(src,/notebookPromptText\(ctx && ctx\.verifiedNotebook\)/);
  assert.match(src,/const verifiedNotebook = await freshNotebookForTarget\(activeTarget\)/);
  assert.match(src,/const remembered=normalizeStoryNotebook\(verifiedNotebook\)/);
  assert.match(src,/const remembered=normalizeStoryNotebook\(ctx && ctx\.verifiedNotebook\)/);
  assert.doesNotMatch(src,/notebookPromptText\(\)/);
});
test('memory extraction sends only visible fiction, preserves raw saved equality and signature',()=>{
  const start=src.indexOf('  async function inspectActualAcceptedStory(');
  const end=src.indexOf('  function queueStoryInspection(',start);
  const reader=src.slice(start,end);
  assert.match(reader,/const visibleSource = stripThoughts\(source\)/);
  assert.match(reader,/storySignature\(source,index,target\)/);
  assert.match(reader,/acceptedAssistantText:visibleSource/);
  assert.match(reader,/visibleSource\.includes\(x\.evidence\)/);
  assert.match(reader,/text\(rows\[index\]\.data\)\.trim\(\)===source/);
});
test('plugin version is bumped and UI explains a stale memory',()=>{
  assert.match(src,/\/\/@version 0\.95\.8/);
  assert.match(src,/기억이 최신 대화와 달라 주입을 중단했어/);
});

test('memory, otherAx and emotion hooks return the same prompt without any injection',async()=>{
  const start=src.indexOf('  async function beforeRequest(messages, requestModel)');
  assert.ok(start>=0,'Expected request model guard in Story Runner beforeRequest');
  const firstLine=src.indexOf('    const isHostRequest =',start);
  assert.ok(firstLine>start,'Expected isHostRequest after model-type guard');
  // Evaluate the actual early-return code, without running the full Story Runner host.
  const early=src.slice(start,firstLine)+'    return {onlyForWriter:true};\n  }';
  const sandbox={};
  vm.runInNewContext(early,sandbox,{filename:'story_runner.ts',timeout:4000});
  const testPrompt=[{role:'system',content:'keep original'},{role:'user',content:'note'}];
  for(const model of ['memory','otherAx','emotion','translate']){
    const result=await sandbox.beforeRequest(testPrompt,model);
    assert.equal(result,testPrompt,'auxiliary mode must receive original reference');
  }
  assert.equal((await sandbox.beforeRequest(testPrompt,'model')).onlyForWriter,true);
});
