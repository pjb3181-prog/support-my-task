'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const src=fs.readFileSync(path.join(__dirname,'..','character_mixer.js'),'utf8');
const a=src.indexOf('  function imageMagic('),b=src.indexOf('  async function persistAssetToPack(',a);
const imageFns=src.slice(a,b);
class FakeURL{constructor(v){this.hostname=v.split('/')[2];}}
function fetcher(handler){
 const api={nativeFetch:handler};
 return vm.runInNewContext('const str=x=>String(x??"");const clip=(x,n)=>String(x??"").slice(0,n);const safeBooruMediaURL=x=>x;'+imageFns+'({fetchImageBinary,imageMagic})',{risuai:api,URL:FakeURL});
}
const png=Uint8Array.from([137,80,78,71,13,10,26,10,0,0,0,13,73,72,68,82]);
const html=Uint8Array.from([60,104,116,109,108,62,101,114,114,111,114,60,47,104,116,109,108,62]);
test('script syntax',()=>new vm.Script(src));
test('accept actual PNG even if proxy labels it octet-stream',async()=>{
 const f=fetcher(async()=>({ok:true,headers:{get:k=>k==='content-type'?'application/octet-stream':''},arrayBuffer:async()=>png.buffer}));
 const r=await f.fetchImageBinary({image:'https://img3.gelbooru.com/original/a.png'});
 assert.equal(r.ext,'png');
});
test('do not save HTML even if remote response claims image content',async()=>{
 const f=fetcher(async()=>({ok:true,headers:{get:()=> 'image/png'},arrayBuffer:async()=>html.buffer}));
 await assert.rejects(()=>f.fetchImageBinary({image:'https://img3.gelbooru.com/original/a.png'}),/실제 이미지 데이터 아님/);
});
test('fallback to sample when original image is HTML challenge',async()=>{
 let calls=0;
 const f=fetcher(async url=>{calls++;const bytes=url.includes('/original/')?html:png;
  return {ok:true,headers:{get:()=> 'text/html'},arrayBuffer:async()=>bytes.buffer};});
 const result=await f.fetchImageBinary({image:'https://img3.gelbooru.com/original/a.jpg',sample:'https://img3.gelbooru.com/sample/a.png'});
 assert.equal(result.ext,'png');assert.equal(calls,2);
});
test('auto search retries a few different images, not unlimited downloads',()=>{
 assert.match(src,/const candidates=rows\.filter/);
 assert.match(src,/\.slice\(0,3\)/);
 assert.match(src,/lastFailure=''/);
});
