
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {readFileSync}=require('node:fs');
const {resolve}=require('node:path');
const vm=require('node:vm');
const PLUGIN=readFileSync(resolve(__dirname,'../character_mixer.js'),'utf8');
const clone=x=>JSON.parse(JSON.stringify(x));
const B={
  chaId:'b-uuid-00002',name:'마법사 B',desc:'비밀이 많은 마법사',personality:'독립적이고 기민함',
  scenario:'마도 국가에서 도망쳐 왔다',firstMessage:'B의 기존 인사',exampleMessage:'“흥, 그건 틀렸어.”',
  globalLore:[
    {key:'마법',secondkey:'',insertorder:0,comment:'B의 취미',content:'B는 연금술보다 마법을 선호한다.',mode:'normal',alwaysActive:false,selective:false},
    {key:'',secondkey:'',insertorder:0,comment:'원본 퍼메',content:'@@indicator character_first_message\n타인의 퍼메',mode:'constant',alwaysActive:true,selective:false}
  ],
  additionalAssets:[['평소','assets/normal.webp','webp']],
  emotionImages:[['기쁨','assets/happy.webp']],
  ccAssets:[{type:'x-risu-asset',uri:'assets/scene.png',name:'풍경',ext:'png'}],
  modules:['module-b-assets'],chats:[]
};
const A={
  chaId:'a-uuid-00001',name:'A 세계 주인공',firstMessage:'절대로 손대면 안 되는 원본 퍼스트 메시지',
  globalLore:[{key:'A',content:'A 세계 설정',mode:'constant',alwaysActive:true}],
  additionalAssets:[['평소','assets/a.webp','webp']],
  chats:[{id:'chat-a-1',name:'A 채팅',message:[{role:'user',data:'안녕'},{role:'char',data:'A의 원본 답변'}],
    localLore:[],note:'중요한 기록',modules:['original-module']}]
};
const C={chaId:'c-uuid-00003',name:'C',desc:'세 번째 인물',personality:'조용한 성격',chats:[],globalLore:[]};
const MODULE_B={id:'module-b-assets',name:'B 마법 에셋',assets:[['보석','assets/gem.png','png']],
  lorebook:[{key:'보석',secondkey:'',comment:'B 보석',content:'B의 보석은 유서가 깊다.',mode:'normal',alwaysActive:false,selective:false}],
  trigger:[{effect:'dangerous trigger'}],regex:[{effect:'dangerous regex'}],
  cjs:'dangerous executable code',lowLevelAccess:true};
const OLD={id:'original-module',name:'기존 A 모듈',lorebook:[{comment:'A 기준',content:'이것은 원본'}]};

function fakeElement(attr={}){
  return {onchange:null,onclick:null,value:'',checked:false,
    getAttribute:key=>attr[key]};
}
async function boot({failSave=false}={}){
  const db={characters:[clone(A),clone(B),clone(C)],modules:[clone(OLD),clone(MODULE_B)],
    enabledModules:[]};
  const before=clone(db.characters[0]);
  const ui=new Map(),callbacks=new Map();
  const document={body:{innerHTML:''},
    getElementById:id=>{
      if(!ui.has(id))ui.set(id,fakeElement());
      return ui.get(id);
    },
    querySelectorAll:selector=>{
      const kind=selector.match(/^\[(data-cm-[a-z]+)\]$/)?.[1];
      if(!kind)return [];
      const matches=[...document.body.innerHTML.matchAll(new RegExp(kind+'="([^"]+)"','g'))];
      return matches.map(m=>{
        const el=fakeElement({[kind]:m[1]});
        el.checked=document.body.innerHTML.includes(kind+'="'+m[1]+'" checked');
        return el;
      });
    }
  };
  let fail=failSave;
  const storage=new Map();
  const risuai={
    getDatabase:async()=>db,
    getCurrentCharacterIndex:async()=>0,getCurrentChatIndex:async()=>0,
    getChatFromIndex:async(ci,ti)=>db.characters[ci].chats[ti],
    setDatabaseLite:async patch=>Object.assign(db,patch),
    setChatToIndex:async(ci,ti,chat)=>{
      if(fail)throw Error('simulated storage failure');
      db.characters[ci].chats[ti]=chat;
    },
    pluginStorage:{getItem:async k=>storage.get(k),setItem:async(k,v)=>storage.set(k,v)},
    registerSetting:async(name,fn)=>callbacks.set(name,fn),
    registerButton:async()=>{},showContainer:async()=>{},hideContainer:async()=>{},
    onUnload:async()=>{}
  };
  const context={risuai,document,console,Date,Math,JSON,Promise};
  await vm.runInNewContext(PLUGIN,context,{filename:'character_mixer.js',timeout:5000});
  return {
    db,before,storage,document,
    open:()=>callbacks.get('Character Mixer')(),
    el:id=>document.getElementById(id),
    apply:async()=>{
      await document.getElementById('cm-apply').onclick();
      // Main plugin onclick launches a promise without returning it, wait for render.
      await new Promise(resolve=>setImmediate(resolve));
      await new Promise(resolve=>setImmediate(resolve));
    },
    failSaving:state=>{fail=state;}
  };
}
const generated=db=>db.modules.filter(m=>m.description?.startsWith('[CHARACTER_MIXER_V1]'));
async function waitFor(fn){
  for(let i=0;i<70;i++){if(fn())return;await new Promise(r=>setTimeout(r,2));}
  throw Error('timed out');
}
test('source character B may be added to A chat without altering either bot or old messages',async()=>{
  const app=await boot();await app.open();await app.apply();
  await waitFor(()=>generated(app.db).length===1);
  const m=generated(app.db)[0],chat=app.db.characters[0].chats[0];
  assert.equal(app.db.characters[0].firstMessage,app.before.firstMessage);
  assert.deepEqual(app.db.characters[0].globalLore,app.before.globalLore);
  assert.deepEqual(chat.message,app.before.chats[0].message);
  assert.deepEqual(app.db.characters[1],B);
  assert.deepEqual(app.db.enabledModules,[]);
  assert.deepEqual([...chat.modules],['original-module',m.id]);
  assert.equal(m.lorebook.length,1);
  assert.ok(m.lorebook[0].content.includes('이 인물은 현재 채팅'));
  assert.ok(m.assets.some(x=>x[1]==='assets/normal.webp'));
  assert.ok(m.assets.some(x=>x[1]==='assets/happy.webp'));
  assert.ok(m.assets.every(x=>x[0].startsWith('마법사_B_')));
  assert.equal(m.trigger,undefined);
  assert.equal(m.cjs,undefined);
  assert.equal(m.lowLevelAccess,undefined);
});
test('source B module can contribute image assets and selected lore but never executable code',async()=>{
  const app=await boot();await app.open();
  const mods=app.document.querySelectorAll('[data-cm-module]');
  const bmod=mods.find(x=>x.getAttribute('data-cm-module')==='module-b-assets');
  assert.ok(bmod);bmod.onchange({target:{checked:true}});
  const lores=app.document.querySelectorAll('[data-cm-lore]');
  assert.equal(lores.length,2);
  for(const n of lores)n.onchange({target:{checked:true}});
  const flag=app.document.querySelectorAll('[data-cm-flag]').find(x=>x.getAttribute('data-cm-flag')==='moduleLore');
  flag.onchange({target:{checked:true}});
  await app.apply();await waitFor(()=>generated(app.db).length===1);
  const m=generated(app.db)[0];
  assert.ok(m.assets.some(x=>x[1]==='assets/gem.png'));
  assert.ok(m.lorebook.some(x=>x.content==='B의 보석은 유서가 깊다.'));
  assert.ok(m.lorebook.some(x=>x.content==='B는 연금술보다 마법을 선호한다.'));
  assert.equal(m.lorebook.some(x=>x.content.includes('@@indicator')),false);
  assert.equal(m.trigger,undefined);assert.equal(m.regex,undefined);assert.equal(m.cjs,undefined);
});
test('repeated apply updates the same module without duplicating associations',async()=>{
  const app=await boot();await app.open();await app.apply();
  await waitFor(()=>generated(app.db).length===1);
  const id=generated(app.db)[0].id;
  app.el('cm-mode').onchange({target:{value:'original'}});
  await app.apply();
  await waitFor(()=>generated(app.db).length===1);
  assert.equal(generated(app.db)[0].id,id);
  assert.equal(app.db.characters[0].chats[0].modules.filter(x=>x===id).length,1);
  assert.ok(generated(app.db)[0].lorebook[0].content.includes('외부 세계 출신'));
});
test('other character C can be added independently to the same chat',async()=>{
  const app=await boot();await app.open();await app.apply();
  await waitFor(()=>generated(app.db).length===1);
  app.el('cm-source').onchange({target:{value:'c-uuid-00003'}});
  await app.apply();
  await waitFor(()=>generated(app.db).length===2);
  assert.equal(app.db.characters[0].chats[0].modules.length,3);
  assert.deepEqual(new Set(generated(app.db).map(x=>JSON.parse(x.description.slice(20)).sourceId)),
    new Set(['b-uuid-00002','c-uuid-00003']));
});
test('detaching removes only the current-chat module activation, not source data',async()=>{
  const app=await boot();await app.open();await app.apply();
  await waitFor(()=>generated(app.db).length===1);
  const id=generated(app.db)[0].id;
  const remove=app.document.querySelectorAll('[data-cm-remove]')
    .find(el=>el.getAttribute('data-cm-remove')===id);
  assert.ok(remove);
  remove.onclick();await waitFor(()=>!app.db.characters[0].chats[0].modules.includes(id));
  assert.equal(generated(app.db).length,1,'inactive module retained for recovery');
  assert.equal(app.db.characters[0].chats[0].modules[0],'original-module');
  assert.deepEqual(app.db.characters[1],B);
});
test('save failure rolls back newly registered module and preserves original chat',async()=>{
  const app=await boot({failSave:true});await app.open();await app.apply();
  await waitFor(()=>app.document.body.innerHTML.includes('simulated storage failure'));
  assert.equal(generated(app.db).length,0);
  assert.deepEqual(app.db.characters[0].chats[0],app.before.chats[0]);
});
