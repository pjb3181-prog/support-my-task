'use strict';
// Loads a REAL plugin file into a vm with a recording RisuBard mock so tests can drive its
// registered beforeRequest/afterRequest replacers. Plugins loaded with the same `store`
// share pluginStorage, exactly as they do inside RisuBard.
const vm=require('node:vm'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const el=()=>new Proxy(function(){},{get:(t,k)=>k==='style'?{}:k==='classList'?{add(){},remove(){},toggle(){}}:(k==='children'||k==='childNodes')?[]:(k==='querySelectorAll'?()=>[]:()=>el()),set:()=>true,apply:()=>el()});
async function loadPlugin(file,{store=new Map(),extra={}}={}){
  const src=fs.readFileSync(path.join(__dirname,'..','..',file),'utf8');
  const replacers={},listeners={},calls=[];
  const base={
    pluginStorage:{getItem:async k=>store.has(k)?JSON.parse(store.get(k)):null,
      setItem:async(k,v)=>{if(v===null||v===undefined)store.delete(k);else store.set(k,JSON.stringify(v));},
      removeItem:async k=>store.delete(k),keys:async()=>[...store.keys()]},
    addRisuReplacer:async(n,f)=>{replacers[n]=f;},
    addRisuChatListener:async(n,f)=>{listeners[n]=f;},
    getDatabase:async()=>({characters:[],modules:[],plugins:[]}),
    getCurrentCharacterIndex:async()=>-1,getCurrentChatIndex:async()=>-1,
    getCharacterFromIndex:async()=>null,getChatFromIndex:async()=>null,
    onUnload:async()=>{},...extra,
  };
  const risuai=new Proxy(base,{get:(t,k)=>k in t?t[k]:async()=>{calls.push(String(k));}});
  const document={body:el(),head:el(),createElement:()=>el(),getElementById:()=>null,querySelector:()=>null,querySelectorAll:()=>[],addEventListener(){}};
  const ctx={risuai,document,console:{log(){},warn(){},error(){}},setTimeout,clearTimeout,setInterval:()=>1,clearInterval(){},
    navigator:{},localStorage:{getItem:()=>null,setItem(){}},fetch:async()=>({ok:false,status:500,text:async()=>'',json:async()=>({})}),
    AbortController,TextEncoder,TextDecoder,URL,structuredClone,crypto:crypto.webcrypto,performance};
  ctx.window=ctx;
  await Promise.race([vm.runInNewContext(src,ctx,{filename:file,timeout:20000}),new Promise(r=>setTimeout(r,2500))]);
  return {replacers,listeners,store,risuai};
}
const TOKEN='[[RISUBARD_INTERNAL_CALL:wel-test]]';
const chat=(extra='')=>[{role:'system',content:'You are the narrator.'+extra},{role:'user',content:'계속해줘'}];
module.exports={loadPlugin,TOKEN,chat};
