'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'..','character_mixer.js'),'utf8');
test('Character Mixer parses',()=>new vm.Script(source));
const begin=source.indexOf('  function safeBooruMediaURL(');
const end=source.indexOf('  function isRejected(postId)',begin);
assert.ok(begin>0&&end>begin);
class UrlFake {
  constructor(value){
    const match=String(value).match(/^(https?):\/\/([^/?#]+)(\/[^?#]*)(\?[^#]*)?/);
    if(!match)throw Error('bad URL');
    this.protocol=match[1]+':';this.hostname=match[2];this.pathname=match[3];
    this.search=match[4]||'';this.href=value;
  }
}
function createParser(fetchFn){
 class Params {
  constructor(fields){this.fields=fields;}
  set(k,v){this.fields[k]=v;}
  toString(){return Object.entries(this.fields).map(([k,v])=>encodeURIComponent(k)+'='+encodeURIComponent(v)).join('&');}
 }
 const code='const str=x=>String(x??"");const clip=(v,n)=>str(v).slice(0,n);'+
   'const asArray=x=>Array.isArray(x)?x:[];let externalApiKey="",externalUserId="",externalProviderStatus="";'+
   source.slice(begin,end)+'\n({sanitizeSceneText,searchBooruWithFallback,parseDanbooruPosts,safeBooruMediaURL})';
 return vm.runInNewContext(code,{URL:UrlFake,URLSearchParams:Params,risuai:{nativeFetch:fetchFn}});
}
test('Gelbooru HTTP 401 falls back to Danbooru safe results',async()=>{
 const urls=[];
 const funcs=createParser(async url=>{
  urls.push(url);
  if(url.includes('gelbooru.com'))return {ok:false,status:401};
  return {ok:true,json:async()=>[
    {id:123,rating:'g',tag_string:'smile 1girl sitting',file_url:'https://cdn.donmai.us/original/x.png'},
    {id:124,rating:'e',tag_string:'smile',file_url:'https://cdn.donmai.us/original/y.png'}
  ]};
 });
 const matches=await funcs.searchBooruWithFallback(['1girl','smile'],12,0);
 assert.equal(matches.length,1);assert.equal(matches[0].id,'db_123');
 assert.equal(matches[0].provider,'danbooru');
 assert.equal(urls.length,2);
 assert.match(urls[1],/danbooru\.donmai\.us\/posts\.json/);
});
test('provider media URL whitelist rejects untrusted hosts',()=>{
 const funcs=createParser(async()=>({ok:false,status:500}));
 assert.equal(funcs.safeBooruMediaURL('https://evil.example/pic.png'),'');
 assert.equal(funcs.safeBooruMediaURL('javascript:alert(1)'),'');
 assert.match(funcs.safeBooruMediaURL('https://cdn.donmai.us/original/pic.webp'),/donmai/);
});
test('model reasoning is not used as scene data',()=>{
 const funcs=createParser(async()=>({ok:false,status:500}));
 assert.equal(funcs.sanitizeSceneText('<Thoughts>The user smiles.</Thoughts> 가영은 울었다.'),'가영은 울었다.');
 assert.equal(funcs.sanitizeSceneText('<Thoughts>unclosed internal reasoning'),'');
});
