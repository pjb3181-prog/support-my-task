'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const src=fs.readFileSync(path.join(__dirname,'..','character_mixer.js'),'utf8');
test('plugin parses',()=>new vm.Script(src));
const a=src.indexOf('  function imageFingerprint('),b=src.indexOf('  function archivedModuleId(',a);
assert.ok(a>0&&b>a);
const bytesA=Uint8Array.from([137,80,78,71,13,10,26,10,0,0,0,13,73,72,68,82]);
const bytesB=Uint8Array.from([137,80,78,71,13,10,26,10,1,0,0,13,73,72,68,82]);
const byPath={'assets/first':bytesA,'assets/duplicate':bytesA,'assets/other':bytesB};
const packLibrary=[{externalAssets:[{name:'gelbooru_1',postId:'1',path:'assets/first'},
 {name:'gelbooru_2',postId:'2',path:'assets/duplicate'},
 {name:'gelbooru_3',postId:'3',path:'assets/other'}]}];
const imagePreviewCache=new Map();
const helpersFingerprint=bytes=>[...bytes].join(',');
const context={console,packLibrary,imagePreviewCache,risuai:{readImage:async p=>byPath[p]},btoa:()=> 'MOCK',
  localImagePreview:async p=>{if(p.startsWith('assets/')){imagePreviewCache.set(p,{data:'data:image/png;base64,MOCK',fingerprint:helpersFingerprint(byPath[p])});return 'data:image/png;base64,MOCK';}return '';},
  bytesOf:x=>x,str:x=>String(x??''),asArray:x=>Array.isArray(x)?x:[],
  safePath:x=>typeof x==='string'&&x.startsWith('assets/'),
  isRejected:()=>false,clip:(x,n)=>String(x).slice(0,n)};
const helpers=vm.runInNewContext(src.slice(a,b)+'({renderSelectedImages,imageFingerprint,inlineAssetForDisplay})',context);
test('unique image fingerprint identifies byte-identical distinct post IDs',()=>{
 assert.equal(helpers.imageFingerprint(bytesA),helpers.imageFingerprint(bytesA));
 assert.notEqual(helpers.imageFingerprint(bytesA),helpers.imageFingerprint(bytesB));
});
test('chat display rejects duplicate bytes but does not delete saved assets',async()=>{
 const result=await helpers.renderSelectedImages(['gelbooru_1','gelbooru_2','gelbooru_3']);
 assert.equal(result.length,2);
 assert.deepEqual(Array.from(result.map(x=>x.name)),['gelbooru_1','gelbooru_3']);
 assert.equal(packLibrary[0].externalAssets.length,3);
 assert.match(result[0].html,/^<img src="data:image\/png;base64,/);
});
test('auto-collected images do not rely on native parser cache',()=>{
 const a=src.indexOf('  async function displayAssetCompatibility('),b=src.indexOf('  function makeProfile(',a),body=src.slice(a,b);
 assert.match(body,/await renderSelectedImages\(selected\)/);
 assert.match(body,/await renderSelectedImages\(contextual\)/);
 assert.match(body,/shown\.map\(x=>x\.html\)/);
 assert.ok(!body.includes("selected.map(name=>'{{img::'+name+'}}')"));
});
test('new byte-identical posts are ignored before saving',()=>{
 const a=src.indexOf('  async function persistAssetToPack('),b=src.indexOf('  async function dislikeAsset(',a),body=src.slice(a,b);
 assert.ok(body.indexOf('for(const existingAsset of asArray(latest.externalAssets))')>0);
 assert.ok(body.indexOf('if(old&&imageFingerprint(old)===fingerprint)return false')>0);
 assert.ok(body.indexOf('if(same)return false')<body.indexOf('risuai.saveAsset('));
});
test('display hook status and duplicate diagnostics are in settings UI',()=>{
 assert.match(src,/displayHookRegistered\?'등록됨'/);
 assert.match(src,/displayHookCalls\+'회/);
 assert.match(src,/repeatedLocalImages/);
});
