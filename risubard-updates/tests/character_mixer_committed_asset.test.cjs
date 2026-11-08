'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const src=fs.readFileSync(path.join(__dirname,'..','character_mixer.js'),'utf8');
const a=src.indexOf('  async function appendAssetToCommittedReply(');
const b=src.indexOf('  async function onCommittedChatOutput(',a);
assert.ok(a>0&&b>a);
function fixture(messageData='She wins the arcade game and smiles.'){
 let chat={id:'chat-1',message:[{role:'user',data:'go'},{role:'char',data:messageData}],modules:['mod-1']};
 let writes=0;
 const api={
  getChat:async()=>chat,
  setChatToIndex:async(ci,ti,value)=>{assert.equal(ci,0);assert.equal(ti,0);chat=value;writes++;}
 };
 const code=[
 'const str=x=>String(x??"");','const asArray=x=>Array.isArray(x)?x:[];',
 'const sanitizeSceneText=x=>String(x);',
 'const context=async()=>({ci:0,ti:0,chat,db:{}});',
 'const installedInChat=()=>[{assets:[["gelbooru_123","assets/img.png","png"]]}];',
 'const risuai={setChatToIndex:api.setChatToIndex};',
 'const invalidateDisplayCache=()=>{};',
 'const recordDisplayedImages=()=>{};',
 'const contentFingerprint=()=>"test";',
 'const displayHistory={};',
 'const packLibrary=[{id:"test",name:"Lily",characterKind:"original",externalAssets:[{name:"gelbooru_123",tags:["arcade","smile"]}]}];',
 'const chooseIllustrationBeat=(body,pack)=>({text:body,end:body.length,plan:{signals:[{tags:["arcade"],weight:3}]},packPresent:true});',
 'const assetMatchesLocalBeat=(asset,pack,beat)=>!!asset&&beat.packPresent;',
 'const insertImageAtBeat=(body,name,beat)=>body.slice(0,beat.end)+"\\n\\n{{img::"+name+"}}"+body.slice(beat.end);',
 src.slice(a,b),'appendAssetToCommittedReply'
 ].join('\n');
 const fn=vm.runInNewContext(code,{chat,api});
 return {fn,getChat:()=>chat,getWrites:()=>writes};
}
const ctx={ci:0,ti:0,chat:{id:'chat-1'}};
test('completed assistant message receives a native asset reference',async()=>{
 const f=fixture();
 assert.equal(await f.fn(ctx,'She wins the arcade game and smiles.','gelbooru_123'),true);
 assert.equal(f.getChat().message[1].data,'She wins the arcade game and smiles.\n\n{{img::gelbooru_123}}');
 assert.equal(f.getChat().message[0].data,'go');
 assert.equal(f.getWrites(),1);
});
test('original image tags are preserved and block injected images',async()=>{
 const f=fixture('An original portrait {{img::original}}');
 assert.equal(await f.fn(ctx,'An original portrait {{img::original}}','gelbooru_123'),false);
 assert.equal(f.getWrites(),0);
});
test('a stale response cannot modify a newer assistant turn',async()=>{
 const f=fixture('An entirely different assistant reply.');
 assert.equal(await f.fn(ctx,'She wins the arcade game and smiles.','gelbooru_123'),false);
 assert.equal(f.getWrites(),0);
});
test('unknown assets cannot be injected',async()=>{
 const f=fixture();
 assert.equal(await f.fn(ctx,'She wins the arcade game and smiles.','gelbooru_999'),false);
 assert.equal(f.getWrites(),0);
});
test('latest library is used to reject duplicate downloaded bytes',()=>{
 assert.match(src,/const latest=packLibrary.find\(x=>x.id===pack.id\)/);
 assert.match(src,/imageFingerprint\(old\)===fingerprint/);
 assert.match(src,/const asset=\{name,path,ext,postId:str\(item.id\),tags:item.tags,rating:canonicalRating\(item.rating\),fingerprint/);
});
test('native mixer assets render inline even when parser asset cache lags',()=>{
 assert.match(src,/if\(\/\\\{\\\{img::gelbooru_/);
 assert.match(src,/const image=await inlineAssetForDisplay\(name\)/);
});

test('committed events reuse matching saved assets when search finds nothing new',()=>{
 assert.match(src,/async function appendMatchingSavedAsset\(ctx,sourceText\)/);
 assert.match(src,/await appendMatchingSavedAsset\(active,raw\)/);
 assert.match(src,/await appendMatchingSavedAsset\(source,str\(last.data\)\)/);
 assert.match(src,/prior.has\(asset.name\)/);
 assert.match(src,/recordDisplayedImages\(\{key,turn,signature:/);
});
