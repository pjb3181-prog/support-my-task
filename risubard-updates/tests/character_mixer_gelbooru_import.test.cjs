'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const src=fs.readFileSync(path.join(__dirname,'..','character_mixer.js'),'utf8');
const start=src.indexOf('  async function loadGelbooruAuth(');
const end=src.indexOf('  async function loadDisplayHistory(',start);
test('syntax',()=>new vm.Script(src));
test('import existing downloader user_id and API key without executing Python',async()=>{
 const db={},view={count:0};
 const boot='let externalUserId="",externalApiKey="",authStatus="",lastDiscovery=new Map();'+
 'const clip=(x,n)=>String(x??"").slice(0,n),AUTH_KEY="credential-test";'+
 'const risuai={pluginStorage:{getItem:async k=>db[k]??null,setItem:async(k,v)=>{db[k]=v}}};'+
 'const render=async()=>{view.count++};';
 const f=vm.runInNewContext(boot+src.slice(start,end)+'({importDownloaderFile,loadGelbooruAuth,values:()=>({externalUserId,externalApiKey})})',{db,view});
 const key='b'.repeat(128);
 const python='CONFIG = {\n  "USER_ID": "123456",\n  "API_KEY": "'+key+'",\n  "TAGS": ""\n}\n';
 await f.importDownloaderFile({files:[{size:python.length,text:async()=>python}]});
 assert.equal(db['credential-test'].userId,'123456');
 assert.equal(db['credential-test'].apiKey,key);
 assert.equal(f.values().externalApiKey,key);
});
test('API key never embedded into shared plugin source',()=>{
 assert.doesNotMatch(src,/API_KEY\s*[:=]\s*["'][a-zA-Z0-9]{64,}["']/);
 assert.match(src,/id="cm-import-py"/);
 assert.match(src,/id="cm-auth-test"/);
});
