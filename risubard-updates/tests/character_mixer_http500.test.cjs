'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'..','character_mixer.js'),'utf8');
test('script syntax',()=>new vm.Script(source));
test('minimal headers for both search providers',()=>{
 const section=source.slice(source.indexOf('  async function searchBooruWithFallback('),source.indexOf('  function isRejected(',source.indexOf('  async function searchBooruWithFallback(')));
 assert.doesNotMatch(section,/'Accept':/);
 assert.match(section,/method:'GET'/);
});
test('failed searches do not set a five-minute cooldown',()=>{
 const section=source.slice(source.indexOf('  async function discoverForScene('),source.indexOf('  async function searchExternal(',source.indexOf('  async function discoverForScene(')));
 const search=section.indexOf('const rows=await searchBooruWithFallback(');
 const store=section.indexOf('lastDiscovery.set(eventKey,Date.now())');
 assert.ok(search>=0&&store>search);
 assert.match(section,/lastDiscovery\.delete\(eventKey\)/);
 assert.doesNotMatch(section,/lastDiscovery\.set\(eventKey,now\)/);
});
test('HTTP 500 HTML challenge yields sanitized diagnosis',async()=>{
 const a=source.indexOf('  function inspectResponseBody('),b=source.indexOf('  async function searchBooruWithFallback(',a);
 const inspect=vm.runInNewContext('const str=x=>String(x??"");const clip=(v,n)=>str(v).slice(0,n);'+source.slice(a,b)+'({describeBooruFailure})');
 const secret='dont_echo_token';
 const res={status:500,headers:{get:()=> 'text/html'},text:async()=>'<html>proxy failed '+secret+'</html>'};
 const msg=await inspect.describeBooruFailure(res);
 assert.match(msg,/HTTP 500/);
 assert.match(msg,/HTML/);
 assert.doesNotMatch(msg,/dont_echo_token/);
});
