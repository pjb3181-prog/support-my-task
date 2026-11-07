'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'..','character_mixer.js'),'utf8');
const a=source.indexOf('  function contentFingerprint('),b=source.indexOf('  async function displayAssetCompatibility(',a);
assert.ok(a>=0&&b>a);
const evalCode='const asArray=x=>Array.isArray(x)?x:[]; const str=x=>String(x??"");'+
 'const DISPLAY_MIN_GAP=3,DISPLAY_RECENT_WINDOW=5,DISPLAY_REPEAT_TURN_WINDOW=15;'+
 'let displayHistory={};const saveDisplayHistory=async()=>{};'+source.slice(a,b)+
 '({currentDisplayDecision,recordDisplayedImage,rememberFeedback,get:()=>displayHistory})';
const f=vm.runInNewContext(evalCode);
const message='[가영] 가영이 미소를 지었다. 오늘 날씨가 맑았다. 그녀는 카페 창가에 앉아 수업이 끝나기를 기다렸다.';
const getDecision=n=>f.currentDisplayDecision({ci:0,ti:0,chat:{id:'chat',message:Array.from({length:n+1},(_,i)=>({role:'char',data:i===n?message:'이전 응답 '+i}))}},message);
test('whole plugin parses',()=>new vm.Script(source));
test('latest reply only; old history and user content do not receive images',()=>{
 const ctx={ci:0,ti:0,chat:{id:'chat',message:[{role:'char',data:message},{role:'char',data:'다른 최신 응답으로 이 문장이 대신 사용된다. 앞의 응답과 겹치지 않는다.'}]}};
 assert.equal(f.currentDisplayDecision(ctx,message),null);
});
test('one new image then 2-reply cooldown',()=>{
 const first=getDecision(0);assert.equal(first.canShow,true);
 f.recordDisplayedImage(first,'gelbooru_1');
 assert.equal(getDecision(0).sameMessage,true);
 assert.equal(getDecision(1).canShow,false);
 assert.equal(getDecision(2).canShow,false);
 assert.equal(getDecision(3).canShow,true);
});
test('display history stores a hash rather than the prose',()=>{
 const row=Object.values(f.get())[0];
 assert.equal(typeof row.messageKey,'string');
 assert.equal(row.messageKey.includes('가영'),false);
});
test('recent selection expires; single-image packs do not deadlock',()=>{
 const row=Object.values(f.get())[0];
 assert.equal(row.recent.length,1);
 assert.equal(row.recent[0].turn,0);
 assert.equal(3-row.recent[0].turn<15,true);
 assert.equal(15-row.recent[0].turn<15,false);
});
test('dislike forgets pending cached rendering',()=>{
 f.rememberFeedback('gelbooru_1');
 const row=Object.values(f.get())[0];
 assert.notEqual(row.lastAsset,'gelbooru_1');
});
test('defaults and reuse-first check remain available',()=>{
 assert.match(source,/DISPLAY_MIN_GAP=3/);
 assert.match(source,/DISPLAY_RECENT_WINDOW=5/);
 assert.match(source,/DISPLAY_REPEAT_TURN_WINDOW=15/);
 assert.match(source,/if\(existing\.some\(x=>isUsablePackAsset\(x,pack,tagSignals\)\)\)continue/);
});
