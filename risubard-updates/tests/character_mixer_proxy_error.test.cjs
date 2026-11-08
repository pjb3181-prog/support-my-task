'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const src=fs.readFileSync(path.join(__dirname,'..','character_mixer.js'),'utf8');
const a=src.indexOf('  function classifyProxyError('),b=src.indexOf('  async function readBooruJson(',a);
const fn=vm.runInNewContext('const str=x=>String(x??"");const clip=(v,n)=>str(v).slice(0,n);const inspectResponseBody=()=> "알 수 없는 비JSON 응답";'+src.slice(a,b)+'({classifyProxyError,describeBooruFailure})');
test('script parses',()=>new vm.Script(src));
test('proxy fetch failure categorized',async()=>{
 const text=JSON.stringify({error:'fetch failed https://gelbooru.com?api_key=SECRET'});
 const response={status:500,headers:{get:()=> 'application/json'},text:async()=>text};
 const result=await fn.describeBooruFailure(response);
 assert.match(result,/RisuBard 중계 서버 외부 연결 실패/);
 assert.doesNotMatch(result,/SECRET/);
});
test('all common proxy failure categories redacted',()=>{
 for(const [message,match] of [['getaddrinfo ENOTFOUND','DNS'],['request timed out','시간 초과'],
 ['certificate invalid','인증서'],['Internal Server Error','내부 오류']]){
  assert.match(fn.classifyProxyError(JSON.stringify({error:message})),new RegExp(match));
 }
});
