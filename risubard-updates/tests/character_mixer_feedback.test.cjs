'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'..','character_mixer.js'),'utf8');
test('plugin parses',()=>assert.doesNotThrow(()=>new vm.Script(source)));
test('automatic collection default and preference override',()=>{
  assert.match(source,/let autoCollectEnabled=true/);
  assert.match(source,/autoCollectEnabled=p\?\.enabled!==false/);
  assert.match(source,/saveAutoPrefs\(\)/);
});
test('no retroactive download of old chat messages',()=>{
  assert.match(source,/const last=asArray\(ctx\.chat\?\.message\)/);
  assert.match(source,/lastDiscovery\.set\(eventKey,now\)/);
});
test('safe limited import',()=>{
  assert.match(source,/limit:'12'/);
  assert.match(source,/rating:general/);
  assert.match(source,/bytes\.length>12\*1024\*1024/);
  assert.match(source,/verified\[i\]!==bytes\[i\]/);
  assert.match(source,/One search and at most one image per display event/);
});
test('dislike persists globally and removes links without deleting blobs',()=>{
  assert.match(source,/rejectedPosts=\{\.\.\.rejectedPosts,\[key\]:true\}/);
  assert.match(source,/await saveAutoPrefs\(\)/);
  assert.match(source,/externalAssets:asArray\(fresh\.externalAssets\)\.filter/);
  assert.match(source,/externalTagAssets:asArray\(meta\.externalTagAssets\)\.filter/);
  assert.doesNotMatch(source,/deleteAsset\(/);
});
test('blacklisted posts cannot be manually reimported',()=>{
  assert.match(source,/externalSelected\.has\(x\.id\)&&!isRejected\(x\.id\)/);
});
test('feedback is a real control',()=>{
  assert.match(source,/data-cm-dislike/);
  assert.match(source,/node\.onclick=\(\)=>void dislikeAsset/);
});
