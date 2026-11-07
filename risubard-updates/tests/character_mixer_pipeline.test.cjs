'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const script=fs.readFileSync(path.join(__dirname,'..','character_mixer.js'),'utf8');
test('committed output -> automatic pack -> Gelbooru -> asset -> display',async()=>{
 const message='[가영] 가영은 미소를 지으며 웃었고, 천천히 의자에 앉았다. 그녀는 창밖을 살펴보고 다시 손을 흔들었다.';
 const chat={id:'chat1',modules:[],message:[{role:'char',data:message}]};
 const db={characters:[{chaId:'char1',name:'가영',desc:'오리지널 캐릭터',globalLore:[],additionalAssets:[]}],modules:[]};
 const saved={},state={chat,requests:[],saveCount:0};
 const bytes=new Uint8Array([137,80,78,71,8,8,8,8]);
 const api={
   pluginStorage:{getItem:async k=>saved[k]??null,setItem:async(k,v)=>{saved[k]=v}},
   getDatabase:async()=>db,getCurrentCharacterIndex:async()=>0,getCurrentChatIndex:async()=>0,getChatFromIndex:async()=>state.chat,
   setChatToIndex:async(_ci,_ti,c)=>{state.chat=c},setDatabaseLite:async x=>{db.modules=x.modules},
   registerSetting:async()=>{},registerButton:async()=>{},
   addRisuScriptHandler:async(_mode,cb)=>{state.display=cb},removeRisuScriptHandler:async()=>{},
   onUnload:async()=>{},requestPluginPermission:async()=>true,
   addRisuChatListener:async(_mode,cb)=>{state.output=cb},removeRisuChatListener:async()=>{},
   nativeFetch:async url=>{
     state.requests.push(url);
     if(url.includes('page=dapi'))return {ok:true,json:async()=>({post:[{
       id:123,rating:'general',tags:'1girl smile sitting',
       file_url:'https://img3.gelbooru.com/images/a/b.png',
       preview_url:'https://img3.gelbooru.com/preview/a/b.png'
     }]})};
     return {ok:true,headers:{get:()=> 'image/png'},arrayBuffer:async()=>bytes.buffer};
   },
   saveAsset:async()=>{state.saveCount++;return 'assets/gel123.png'},
   readImage:async()=>bytes
 };
 const main=new Function('risuai','return '+script.slice(script.indexOf('(async () => {')));
 await main(api);
 assert.equal(typeof state.output,'function');
 await state.output({characterIndex:0,chatIndex:0,chat,messageIndex:0});
 assert.equal(saved.character_mixer_library_v1.length,1);
 assert.equal(db.modules.length,2);
 assert.equal(db.modules.find(x=>x.namespace==='character-mixer').lorebook.length,0);
 assert.equal(state.saveCount,1);
 const displayed=await state.display(message);
 assert.match(displayed,/\\{\\{img::gelbooru_123\\}\\}/);
});
