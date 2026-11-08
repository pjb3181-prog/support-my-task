'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const src=fs.readFileSync(path.join(__dirname,'..','character_mixer.js'),'utf8');
test('plugin parses',()=>new vm.Script(src));
test('message selection tolerates display formatting while rejecting other messages',()=>{
 const a=src.indexOf('  function contentFingerprint('),b=src.indexOf('  function recordDisplayedImages(',a);
 assert.ok(a>=0&&b>a);
 const deps='const str=x=>String(x??"");const asArray=x=>Array.isArray(x)?x:[];'+
 'const sanitizeSceneText=s=>s.slice(s.indexOf("</Thoughts>")+11).trim();'+
 'const densitySettings={minReplyGap:1};let displayHistory={};';
 const f=vm.runInNewContext(deps+src.slice(a,b)+'({currentDisplayDecision})');
 const raw='<Thoughts>thinking</Thoughts> [가영] 가영은 서점에 앉아 책을 읽으며 밝게 웃었다. 창밖에는 비가 내리고 있었다.';
 const ctx={chat:{id:'chat1',message:[{role:'char',data:raw}]},ci:0,ti:0};
 const clean='[가영]   가영은 서점에 앉아 책을 읽으며 밝게 웃었다. 창밖에는 비가 내리고 있었다.';
 assert.ok(f.currentDisplayDecision(ctx,clean));
 assert.equal(f.currentDisplayDecision(ctx,'[나비] 전혀 다른 장면에 대한 긴 문장이 이어지고 책을 읽는 인물은 등장하지 않는다.'),null);
});
test('same reply selection persists across cache/module refresh',()=>{
 const a=src.indexOf('  async function displayAssetCompatibility('),b=src.indexOf('  function makeProfile(',a);
 const part=src.slice(a,b);
 assert.ok(part.includes('const usablePrevious=previous.filter(name=>!omitted.has(name))'));
 assert.ok(!part.includes('&&cached.tagAssets.some(x=>x.name===name)'));
 assert.ok(part.includes('if(decision.sameMessage)'));
 assert.ok(part.includes('await renderSelectedImages(usablePrevious)'));
 assert.ok(part.includes('shown.map(x=>x.html)'));

});
test('local saved bytes are used for pack preview, never remote hotlinks',()=>{
 const a=src.indexOf('  async function localImagePreview('),b=src.indexOf('  function archivedModuleId(',a);
 assert.ok(a>=0&&b>a);
 const png=Uint8Array.from([137,80,78,71,13,10,26,10,0,0,0,13,73,72,68,82]);
 const mock={readImage:async path=>path==='assets/test.png'?png:null};
 const fn=vm.runInNewContext('const str=x=>String(x??"");const clip=(x,n)=>str(x).slice(0,n);'+
  'const bytesOf=x=>x;const imageMagic=x=>x?.[0]===137&&x?.[1]===80?"png":"";'+
  src.slice(a,b)+'({localImagePreview})',{risuai:mock,btoa:x=>'BASE64_MOCK',console});
 return fn.localImagePreview('assets/test.png','png').then(url=>{
  assert.match(url,/^data:image\/png;base64,/);
  assert.equal(url.includes('gelbooru.com'),false);
 });
});
test('preview is included in settings HTML and diagnostics show loaded count',()=>{
 assert.ok(src.includes("previewReady+'/'+previewItems.length"));
 assert.ok(src.includes('previews.get(str(item.postId))'));
});
