
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {readFileSync}=require('node:fs');
const {resolve}=require('node:path');
const vm=require('node:vm');
const PLUGIN=readFileSync(resolve(__dirname,'../character_mixer.js'),'utf8');
function makeModule(version=1){
  return {id:'cm-1',name:'Character Mixer imported Hancock',
    description:'[CHARACTER_MIXER_V1]'+JSON.stringify({
      sourceId:'b-0001',targetCharacterId:'a-0001',targetChatId:'chat-a',version,
      ...(version===2?{assetAliases:[['hancock_angry','Hancock_b-000_hancock_angry']]}:{})
    }),
    lorebook:[],
    assets:[
      ['Hancock_b-000_hancock_angry','assets/hancock.webp','webp'],
      ['Hancock_b-000_Extra_hancock_sad','assets/sad.webp','webp'],
      ['Hancock_b-000_emotion_angry','assets/emotion.webp','webp']
    ]
  };
}
async function boot({version=1,withModule=true,collision=false,imageWithExt=false,rejectDisplay=false}={}){
  const a={name:'A',chaId:'a-0001',chats:[{
    id:'chat-a',name:'A chat',modules:withModule?['cm-1']:[],
    message:[{role:'char',data:'{{img="hancock_angry"}}'}]
  }],additionalAssets:collision?[['hancock_angry','assets/a.webp','webp']]:[],emotionImages:[]};
  const b={name:'Hancock',chaId:'b-0001',
    additionalAssets:[[imageWithExt?'hancock_angry.webp':'hancock_angry','assets/hancock.webp','webp']],
    emotionImages:[['angry','assets/emotion.webp']],ccAssets:[],
    globalLore:[],chats:[],modules:['orig-b']};
  const db={characters:[a,b],modules:[
    {id:'orig-b',name:'Extra',assets:[['hancock_sad','assets/sad.webp','webp']],lorebook:[]},
    ...(withModule?[makeModule(version)]:[])
  ]};
  const callbacks=new Map(),handlers=new Map(),nodes=new Map();
  const document={body:{innerHTML:''},
    getElementById(id){
      if(!nodes.has(id))nodes.set(id,{onclick:null,onchange:null,value:''});
      return nodes.get(id);
    },querySelectorAll:()=>[]
  };
  let unload=async()=>{};
  const risuai={
    getDatabase:async()=>db,
    getCurrentCharacterIndex:async()=>0,
    getCurrentChatIndex:async()=>0,
    getChatFromIndex:async(ci,ti)=>db.characters[ci].chats[ti],
    setChatToIndex:async(ci,ti,v)=>{db.characters[ci].chats[ti]=v},
    setDatabaseLite:async value=>Object.assign(db,value),
    pluginStorage:{getItem:async()=>[],setItem:async()=>{}},
    registerSetting:async(name,callback)=>callbacks.set(name,callback),
    registerButton:async()=>{},showContainer:async()=>{},hideContainer:async()=>{},
    addRisuScriptHandler:async(name,callback)=>{
      assert.equal(name,'display','RisuBard v3 expects display');
      if(rejectDisplay)throw Error('optional display denied');
      handlers.set(name,callback);
    },
    removeRisuScriptHandler:async(name,callback)=>{if(handlers.get(name)===callback)handlers.delete(name)},
    onUnload:async callback=>{unload=callback}
  };
  await vm.runInNewContext(PLUGIN,{risuai,document,console,Date,Math,JSON,Promise,Map,Set},
    {filename:'character_mixer.js',timeout:5000});
  if(!rejectDisplay)assert.equal(typeof handlers.get('display'),'function');
  return {db,document,handlers,open:()=>callbacks.get('Character Mixer')(),unload};
}
test('legacy equals image tag uses v0.1.0 imported B module without rewriting history',async()=>{
  const x=await boot(),render=await x.handlers.get('display')('start {{img="hancock_angry"}} end');
  assert.equal(render,'start {{img::Hancock_b-000_hancock_angry}} end');
  assert.equal(x.db.characters[0].chats[0].message[0].data,'{{img="hancock_angry"}}');
});
test('native B image tag also maps to its namespaced alias',async()=>{
  const x=await boot();
  assert.equal(await x.handlers.get('display')('{{img::hancock_angry}}'),'{{img::Hancock_b-000_hancock_angry}}');
});
test('image in chosen B asset module resolves by file path',async()=>{
  const x=await boot();
  assert.equal(await x.handlers.get('display')('{{img="hancock_sad"}}'),'{{img::Hancock_b-000_Extra_hancock_sad}}');
});
test('B emotion image tag resolves through ordinary module image renderer',async()=>{
  const x=await boot();
  assert.equal(await x.handlers.get('display')('{{emotion="angry"}}'),'{{img::Hancock_b-000_emotion_angry}}');
});
test('unselected or unknown image references do not change',async()=>{
  const x=await boot();
  assert.equal(await x.handlers.get('display')('{{img="not_in_import"}}'),'{{img="not_in_import"}}');
});
test('A original image name takes precedence over imported B image',async()=>{
  const x=await boot({collision:true});
  assert.equal(await x.handlers.get('display')('{{img="hancock_angry"}}'),'{{img::hancock_angry}}');
});
test('without a Character Mixer module attached to this chat no rewrite occurs',async()=>{
  const x=await boot({withModule:false});
  assert.equal(await x.handlers.get('display')('{{img="hancock_angry"}}'),'{{img="hancock_angry"}}');
});
test('v0.1.1 metadata resolves namespaced and original names',async()=>{
  const x=await boot({version:2});
  assert.equal(await x.handlers.get('display')('{{img="hancock_angry"}}'),'{{img::Hancock_b-000_hancock_angry}}');
});
test('uninstall removes display filter',async()=>{
  const x=await boot();
  await x.unload();
  assert.equal(x.handlers.has('display'),false);
});
test('UI shows stored aliases and source names to diagnose missing associations',async()=>{
  const x=await boot();
  await x.open();
  assert.ok(x.document.body.innerHTML.includes('Asset aliases (A chat)'));
  assert.ok(x.document.body.innerHTML.includes('hancock_angry'));
});

test('B asset named hancock_angry.webp supports extensionless model reference',async()=>{
  const x=await boot({imageWithExt:true});
  assert.equal(await x.handlers.get('display')('{{img="hancock_angry"}}'),'{{img::Hancock_b-000_hancock_angry}}');
});
test('optional display hook denial never hides plugin settings UI',async()=>{
  const x=await boot({rejectDisplay:true});
  assert.equal(x.handlers.has('display'),false);
  await x.open();
  assert.ok(x.document.body.innerHTML.includes('Character Mixer'));
});
