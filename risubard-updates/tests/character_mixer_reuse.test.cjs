'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'..','character_mixer.js'),'utf8');
test('plugin syntax',()=>new vm.Script(source));
const start=source.indexOf('  function assetSceneScore('),end=source.indexOf('  async function persistAssetToPack(',start);
const funcs=vm.runInNewContext('const asArray=x=>Array.isArray(x)?x:[];const isRejected=()=>false;\n'+source.slice(start,end)+'\n({assetSceneScore,isRelevantPost,isUsablePackAsset})');
const signals=[{tags:['smile','happy'],weight:3},{tags:['sitting'],weight:2}];
test('reuse a stored matching asset',()=>{
 const pack={characterKind:'original',snapshot:{additionalAssets:[['saved','assets/a','png']]}};
 assert.equal(funcs.isUsablePackAsset({name:'saved',postId:'1',tags:['smile']},pack,signals),true);
 assert.equal(funcs.isUsablePackAsset({name:'other',postId:'2',tags:['smile']},pack,signals),false);
});
test('do not reuse irrelevant asset',()=>{
 const pack={characterKind:'original',snapshot:{additionalAssets:[['saved','assets/a','png']]}};
 assert.equal(funcs.isUsablePackAsset({name:'saved',postId:'1',tags:['winter']},pack,signals),false);
});
test('fanwork rejects pose-only but accepts expression',()=>{
 assert.equal(funcs.isRelevantPost({tags:['sitting']},signals,'fanwork'),false);
 assert.equal(funcs.isRelevantPost({tags:['smile']},signals,'fanwork'),true);
});
test('chat toolbar feedback opens review',()=>{
 assert.match(source,/id:'character-mixer-dislike-chat'/);
 assert.match(source,/location:'chat'/);
 assert.match(source,/async function openFeedback\(\)\{reviewFirst=true;await open\(\);\}/);
 assert.match(source,/id="cm-dislike-recent"/);
});
test('persistent blacklist and no unintended blob deletion',()=>{
 assert.match(source,/rejectedPosts=\{\.\.\.rejectedPosts,\[key\]:true\}/);
 assert.match(source,/externalAssets:asArray\(fresh\.externalAssets\)\.filter/);
 assert.doesNotMatch(source,/deleteAsset\(/);
});
test('no remote fetch when existing scene matches',()=>{
 assert.match(source,/if\(existing\.some\(x=>isUsablePackAsset\(x,pack,tagSignals\)\)\)continue;/);
 assert.match(source,/lastDiscovery\.set\(eventKey,now\)/);
});
