'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'..','character_mixer.js'),'utf8');
const start=source.indexOf('  const LOCAL_BRIDGE=');
const end=source.indexOf('  let rejectedPosts=',start);
const searchStart=source.indexOf('  async function searchBooruWithFallback(');
const searchEnd=source.indexOf('  function isRejected(',searchStart);
const imageStart=source.indexOf('  async function fetchImageBinary(');
const imageEnd=source.indexOf('  async function persistAssetToPack(',imageStart);
assert.ok(start>=0&&end>start&&searchStart>=0&&imageStart>=0);
const imageBytes=Uint8Array.from([137,80,78,71,13,10,26,10,0,0,0,13,73,72,68,82]);
const calls=[];
const api={nativeFetch:async(url,options)=>{
 calls.push({url,options});
 if(url.endsWith('/health'))return {ok:true,status:200,json:async()=>({ok:true,service:'CharacterMixerBridge',version:1})};
 if(url.endsWith('/search'))return {ok:true,status:200,json:async()=>({post:[{id:1,rating:'general',file_url:'https://img3.gelbooru.com/images/a.png'}]})};
 if(url.endsWith('/image'))return {ok:true,status:200,headers:{get:()=> 'image/png'},arrayBuffer:async()=>imageBytes.buffer};
 return {ok:false,status:500};
}};
const prefix="const str=x=>String(x??'');const clip=(x,n)=>str(x).slice(0,n);"+
 "const asArray=x=>Array.isArray(x)?x:[];"+
 "const externalUserId='12345',externalApiKey='SENSITIVE_KEY';"+
 "let externalProviderStatus='';const render=async()=>{};"+
 "const parseBooruPosts=x=>x.post||[];"+
 "const imageMagic=bytes=>bytes[0]===137&&bytes[1]===80?'png':'';";
const script=prefix+source.slice(start,end)+
 "return {pingLocalBridge,searchViaLocalBridge,fetchViaLocalBridge,localBridgeRequest,active:()=>localBridgeActive};";
const bridge=new Function('risuai',script)(api);
test('plugin parses',()=>new vm.Script(source));
test('loopback health and JSON search work, credentials in POST only',async()=>{
 assert.equal(await bridge.pingLocalBridge(),true);
 const posts=await bridge.searchViaLocalBridge(['1girl','smile'],8,0);
 assert.equal(posts.length,1);
 const call=calls.find(c=>c.url.endsWith('/search'));
 assert.ok(call);
 assert.match(call.url,/127\.0\.0\.1:18765\/search/);
 assert.doesNotMatch(call.url,/SENSITIVE_KEY/);
 assert.equal(JSON.parse(call.options.body).apiKey,'SENSITIVE_KEY');
 assert.match(JSON.parse(call.options.body).tags,/rating:general/);
});
test('local image request returns valid bytes',async()=>{
 const result=await bridge.fetchViaLocalBridge('https://img3.gelbooru.com/images/a.png',1024);
 assert.equal(result.ext,'png');
 assert.equal(result.bytes.byteLength,16);
 assert.equal(calls.at(-1).url,'http://127.0.0.1:18765/image');
});
test('no arbitrary localhost bridge path',async()=>{
 await assert.rejects(()=>bridge.localBridgeRequest('https://evil.example',{}),/not allowed/);
});
test('search failures try local bridge after both upstream routes',()=>{
 assert.match(source.slice(searchStart,searchEnd),/searchViaLocalBridge\(userTags,limit,page,ratingMode\)/);
 assert.match(source.slice(searchStart,searchEnd),/localBridgeActive/);
});
test('image downloads prefer bridge when verified',()=>{
 const section=source.slice(imageStart,imageEnd);
 assert.match(section,/if\(localBridgeActive\)/);
 assert.match(section,/fetchViaLocalBridge\(url,limit\)/);
});
