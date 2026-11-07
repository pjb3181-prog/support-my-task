'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const src=fs.readFileSync(path.join(__dirname,'..','character_mixer.js'),'utf8');
const a=src.indexOf('  function sceneTagSignals('),b=src.indexOf('  function pickTaggedAsset(',a);
const c=src.indexOf('  async function discoverForScene('),d=src.indexOf('  async function searchExternal(',c);
const scene=vm.runInNewContext(src.slice(a,b)+'\nsceneTagSignals');
test('whole plugin parses',()=>new vm.Script(src));
test('ordinary narrative scenes generate meaningful tags',()=>{
 assert.ok(scene('세라는 마트에 가서 장바구니를 들었다.').some(x=>x.tags.includes('supermarket')));
 assert.ok(scene('그녀는 식사를 하고 부엌에 들어갔다.').some(x=>x.tags.includes('eating')));
 assert.ok(scene('그는 자취방에서 일어났다.').some(x=>x.tags.includes('bedroom')));
 assert.equal(scene('그는 아침에 고개를 끄덕였다.').length,0);
});
test('skip reasons are retained instead of silent early return',()=>{
 assert.match(src,/검색 생략: /);
 assert.match(src,/분석 가능한 장면·행동·표정 태그 없음/);
 assert.match(src,/현재 채팅에 연결된 이미지 모듈 없음/);
});
test('manual diagnostics bypass the five-minute repeated search restriction',()=>{
 assert.match(src,/if\(!manual&&now-\(lastDiscovery\.get\(eventKey\)\|\|0\)<5\*60\*1000\)/);
 assert.match(src,/discoverForScene\(str\(last\.data\),source,\{manual:true\}\)/);
});
test('character pack and latest assistant message are still required',()=>{
 assert.match(src,/\['char','assistant'\]\.includes\(str\(m\?\.role\)\)/);
 assert.match(src,/asArray\(entry\.meta\?\.sourceIds\)/);
});
