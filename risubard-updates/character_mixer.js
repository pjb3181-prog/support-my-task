//@name character_mixer
//@display-name Character Mixer
//@api 3.0
//@version 0.1.0
//@update-url https://raw.githubusercontent.com/pjb3181-prog/support-my-task/main/risubard-updates/character_mixer.js
//@description Selectively blend an imported character's lore and asset references into the current chat without overwriting existing bots.
(async () => {
  'use strict';
  const NAME='Character Mixer';
  const MARK='[CHARACTER_MIXER_V1]';
  const LOG='character_mixer_v01_activity';
  const PROFILE_LIMIT=6000, LORE_LIMIT=30000;
  let destroyed=false, busy=false, opened=false, message='', sourceId='';
  let choices={mode:'adapt',notes:'',description:true,personality:true,scenario:false,
    examples:false,greeting:false,assets:true,emotions:true,moduleAssets:true,moduleLore:false};
  let loreChoices=new Set(),moduleChoices=new Set();
  const str=v=>String(v??'');
  const esc=v=>str(v).replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;','\'':'&#39;'}[ch]));
  const safeClone=obj=>JSON.parse(JSON.stringify(obj));
  const clip=(v,n)=>str(v).trim().slice(0,n);
  const shortId=()=> 'cm_'+Date.now().toString(36)+'_'+Math.random().toString(36).slice(2,10);
  const asArray=x=>Array.isArray(x)?x:[];
  const isPlain=x=>!!x&&typeof x==='object'&&!Array.isArray(x);
  const generated=mod=>isPlain(mod)&&str(mod.description).startsWith(MARK);
  const label=v=>str(v).replace(/[^a-zA-Z0-9가-힣ぁ-んァ-ン一-龯_-]/g,'_').slice(0,48)||'NPC';
  const safePath=path=>typeof path==='string'&&path.length>0&&path.length<2200&&
    !/^(?:javascript|file|vbscript):/i.test(path);
  const modulesOf=db=>asArray(db.modules);
  const charactersOf=db=>asArray(db.characters).filter(c=>isPlain(c)&&!c.trashTime);
  const loreOf=c=>asArray(c.globalLore).filter(x=>isPlain(x));
  function available(db,targetId){
    return charactersOf(db).filter(x=>x.chaId&&x.chaId!==targetId);
  }
  async function context(){
    if(typeof risuai.getDatabase!=='function')throw Error('플러그인 데이터 접근 API가 없어');
    if(typeof risuai.getCurrentCharacterIndex!=='function'||typeof risuai.getCurrentChatIndex!=='function'
      ||typeof risuai.getChatFromIndex!=='function'||typeof risuai.setChatToIndex!=='function'
      ||typeof risuai.setDatabaseLite!=='function')
      throw Error('현재 RisuBard에서 필요한 채팅별 저장 API를 지원하지 않아');
    const db=await risuai.getDatabase(),ci=await risuai.getCurrentCharacterIndex(),
      ti=await risuai.getCurrentChatIndex();
    if(!db||!Array.isArray(db.characters)||!Array.isArray(db.modules)
       ||!Number.isInteger(ci)||!Number.isInteger(ti))throw Error('RisuBard 데이터베이스를 읽을 수 없어');
    const target=db.characters[ci],chat=await risuai.getChatFromIndex(ci,ti);
    if(!target?.chaId||!chat?.id||chat._placeholder)throw Error('현재 채팅이 완전히 로드되지 않았거나 식별자가 없어');
    return {db,ci,ti,target,chat};
  }
  function installedInChat(ctx){
    const ids=new Set(asArray(ctx.chat.modules));
    return modulesOf(ctx.db).filter(m=>generated(m)&&ids.has(m.id)
      &&str(m.description).includes('"targetChatId":"'+ctx.chat.id+'"'));
  }
  function presentSource(ctx){
    const sources=available(ctx.db,ctx.target.chaId);
    if(!sources.some(x=>x.chaId===sourceId)){
      sourceId=sources[0]?.chaId||'';
      loreChoices=new Set();moduleChoices=new Set();
    }
    return sources.find(x=>x.chaId===sourceId)||null;
  }
  function optionalModuleList(ctx,src){
    const fromChar=new Set(asArray(src?.modules));
    return modulesOf(ctx.db).filter(m=>m?.id&&!generated(m))
      .map(m=>({...m,_belongs:fromChar.has(m.id)}))
      .sort((a,b)=>Number(b._belongs)-Number(a._belongs));
  }
  function readAssetPairs(src,ctx){
    const out=[];
    const add=(name,path,ext,where)=>{
      if(!safePath(path)||!str(name).trim())return;
      out.push({name:str(name),path:str(path),ext:str(ext||'png'),where});
    };
    if(choices.assets){
      for(const x of asArray(src.additionalAssets))if(Array.isArray(x))add(x[0],x[1],x[2],'character');
      for(const x of asArray(src.ccAssets))if(isPlain(x)&&x.type!=='emotion')
        add(x.name,x.uri,x.ext,'card');
      if(safePath(src.image))add('portrait',src.image,'png','portrait');
    }
    if(choices.emotions){
      for(const x of asArray(src.emotionImages))if(Array.isArray(x))add('emotion_'+str(x[0]),x[1],'png','emotion');
      for(const x of asArray(src.ccAssets))if(isPlain(x)&&x.type==='emotion')
        add('emotion_'+str(x.name),x.uri,x.ext||'png','emotion');
    }
    if(choices.moduleAssets){
      for(const m of optionalModuleList(ctx,src)){
        if(!moduleChoices.has(m.id))continue;
        for(const x of asArray(m.assets))if(Array.isArray(x))
          add(str(m.name)+'_'+str(x[0]),x[1],x[2],'module');
      }
    }
    // Store only references already registered in the same RisuBard database.
    // Names are always namespaced to prevent overriding A's original assets.
    const prefix=label(src.name)+'_'+str(src.chaId).slice(0,5)+'_';
    const uniq=new Set(),usedNames=new Set();
    const mapped=[];
    for(const x of out){
      const key=x.path+'|'+x.name;
      if(uniq.has(key))continue;
      uniq.add(key);
      const base=prefix+label(x.name);
      let name=base,n=2;
      while(usedNames.has(name)){name=base+'_'+n;n++;}
      usedNames.add(name);
      mapped.push({name,path:x.path,ext:x.ext,where:x.where,original:x.name});
    }
    return mapped;
  }
  function remapAssetReferences(text,assets){
    // Existing story assets are referenced by their old display name. Convert
    // well-formed asset tokens from imported B lore to newly namespaced aliases.
    // Never rewrite arbitrary chat prose or unrelated placeholder syntax.
    const aliases=new Map();
    for(const entry of assets)if(!aliases.has(entry.original))
      aliases.set(entry.original,entry.name);
    return str(text).replace(/\{\{(raw|path|img|image|video|audio|bgm|bg|emotion|asset|video-img|source)::(.+?)\}\}/gs,
      (whole,type,name)=>{
        const mapped=aliases.get(name.trim());
        return mapped?'{{'+type+'::'+mapped+'}}':whole;
      });
  }
  function makeProfile(src,assets){
    const lines=[
      '[EXTERNAL NPC / '+clip(src.name,80)+']',
      '이 인물은 현재 채팅의 기존 주인공/사용자와 별개로 합류한 등장인물이다.',
      '주인공을 대체하거나 사용자 행동/대사를 대신 결정하지 않는다.',
      '기존 세계관, 이미 일어난 사건, 현재 시점 및 채팅의 첫 메시지가 우선한다.',
      '등장은 사용자의 지시 또는 현재 장면의 인과관계가 자연스러울 때만 시킨다.',
      '이 인물의 고유한 동기, 정보, 말투, 판단을 유지한다.',
      '이름: '+clip(src.name,100)
    ];
    if(choices.description)lines.push('캐릭터 설명: '+clip(src.desc,1700));
    if(choices.personality)lines.push('성격·행동 기준: '+clip(src.personality,1600));
    if(choices.mode==='original'){
      if(choices.scenario)lines.push('원래 배경: '+clip(src.scenario,1200));
      lines.push('이 인물은 외부 세계 출신일 수 있다. 출신 정보가 현재 세계의 법칙을 무효화하지는 않는다.');
    }else{
      lines.push('세계관 적응형: 인물 고유의 성격은 보존하되 원래 세계의 지리, 제도, 직업, 역사를 현재 세계에 강제로 이식하지 않는다.');
      if(choices.scenario)lines.push('적응 참고용 과거 배경: '+clip(src.scenario,800));
    }
    if(choices.examples)lines.push('대사 성향 참고(사건 재현 금지): '+clip(src.exampleMessage,550));
    if(choices.greeting)lines.push('첫 등장 방식 참고(이것을 새 퍼스트 메시지로 실행하지 말 것): '+clip(src.firstMessage,550));
    if(choices.notes.trim())lines.push('사용자가 정한 편입 설정: '+clip(choices.notes,900));
    if(assets.length)lines.push('사용할 수 있는 이미지 에셋 이름: '+assets.slice(0,25).map(x=>x.name).join(', '));
    return lines.filter(Boolean).join('\n').slice(0,PROFILE_LIMIT);
  }
  function chooseLore(src,ctx){
    const lores=[];
    for(let i=0;i<loreOf(src).length;i++){
      if(!loreChoices.has(i))continue;
      const item=loreOf(src)[i];
      if(str(item.content).trim().startsWith('@@indicator'))continue;
      lores.push({source:str(src.name),entry:item});
    }
    if(choices.moduleLore){
      for(const module of optionalModuleList(ctx,src)){
        if(!moduleChoices.has(module.id))continue;
        for(const entry of asArray(module.lorebook))
          if(isPlain(entry)&&!str(entry.content).trim().startsWith('@@indicator'))
            lores.push({source:str(module.name),entry});
      }
    }
    const size=lores.reduce((n,item)=>n+str(item.entry.content).length,0);
    if(size>LORE_LIMIT)throw Error('로어북 합계가 '+LORE_LIMIT+'자를 초과해. 필요한 항목만 골라줘.');
    return lores;
  }
  function createModule(ctx,src,existing=null){
    const assets=readAssetPairs(src,ctx);
    const info=makeProfile(src,assets);
    const key=clip(src.name,80);
    const lore=[{
      id:shortId(),key,secondkey:'',insertorder:0,comment:'[Character Mixer] '+key+' · 등장인물 기준',
      content:info,mode:'constant',alwaysActive:true,selective:false,enabled:true
    }];
    for(const item of chooseLore(src,ctx)){
      const source=item.entry;
      lore.push({
        ...safeClone(source),id:shortId(),
        content:remapAssetReferences(source.content,assets),
        key:[key,str(source.key)].filter(Boolean).join(','),
        secondkey:'',selective:false,alwaysActive:false,mode:'normal',enabled:true,
        comment:'['+clip(item.source,45)+'] '+clip(source.comment||source.key||'추가 정보',75),
        folder:undefined
      });
    }
    const extra= {
      sourceId:src.chaId,targetCharacterId:ctx.target.chaId,targetChatId:ctx.chat.id,
      mode:choices.mode,version:1
    };
    return {
      id:existing?.id||shortId(),
      name:'Character Mixer · '+clip(src.name,70)+' → '+clip(ctx.target.name,70),
      description:MARK+JSON.stringify(extra),
      lorebook:lore,
      assets:assets.map(x=>[x.name,x.path,x.ext]),
      namespace:'character-mixer'
      // Never copy executable cjs, regex, trigger, MCP, lowLevelAccess,
      // HTML/CSS or global toggle state from a foreign bot/module.
    };
  }
  async function remember(action,ctx,src,mod){
    try{
      const old=await risuai.pluginStorage.getItem(LOG);
      const rows=asArray(old);
      rows.unshift({at:Date.now(),action,chatId:ctx.chat.id,
        target:clip(ctx.target.name,80),source:clip(src?.name||'',80),
        moduleId:mod?.id||'',lore:mod?.lorebook?.length||0,assets:mod?.assets?.length||0});
      await risuai.pluginStorage.setItem(LOG,rows.slice(0,15));
    }catch(error){console.log('[CharacterMixer] noncritical log error',error);}
  }
  async function assertStillCurrent(ctx){
    const ci=await risuai.getCurrentCharacterIndex(),ti=await risuai.getCurrentChatIndex();
    const chat=await risuai.getChatFromIndex(ci,ti);
    if(ci!==ctx.ci||ti!==ctx.ti||chat?.id!==ctx.chat.id)throw Error('도중에 다른 채팅으로 바뀌었어. 아무것도 적용하지 않았어.');
    if(JSON.stringify(asArray(chat.modules))!==JSON.stringify(asArray(ctx.chat.modules)))
      throw Error('채팅 모듈이 도중에 변경됐어. 다시 확인해 줘.');
    return chat;
  }
  async function apply(){
    if(busy)return;
    busy=true;
    try{
      const ctx=await context(),src=presentSource(ctx);
      if(!src)throw Error('가져올 B 캐릭터를 먼저 골라줘.');
      const targetId=src.chaId;
      const before=asArray(ctx.db.modules).slice();
      const previous=installedInChat(ctx).find(m=>{
        try{return JSON.parse(str(m.description).slice(MARK.length)).sourceId===targetId;}
        catch(_){return false;}
      });
      const built=createModule(ctx,src,previous);
      if(built.lorebook.length===1 && built.assets.length===0
        &&!choices.description&&!choices.personality)throw Error('가져올 콘텐츠를 한 가지 이상 선택해 줘.');
      const nextModules=previous?before.map(m=>m.id===previous.id?built:m):[...before,built];
      const chatNow=await assertStillCurrent(ctx);
      const ids=asArray(chatNow.modules).filter(id=>str(id)!==built.id);
      const updated={...chatNow,modules:[...ids,built.id]};
      await risuai.setDatabaseLite({modules:nextModules});
      try{await risuai.setChatToIndex(ctx.ci,ctx.ti,updated);}
      catch(error){
        try{await risuai.setDatabaseLite({modules:before});}
        catch(rollbackError){console.log('[CharacterMixer] module rollback failed',rollbackError);}
        throw error;
      }
      await remember(previous?'업데이트':'추가',ctx,src,built);
      message=clip(src.name,90)+' 편입 완료 · 로어 '+built.lorebook.length+'개 / 에셋 '+built.assets.length+'개 / 현재 채팅만';
    }catch(e){message='적용 중단 · '+str(e?.message||e);}
    finally{busy=false;await render();}
  }
  async function detach(moduleId){
    if(busy||!moduleId)return;
    busy=true;
    try{
      const ctx=await context();
      const module=installedInChat(ctx).find(m=>m.id===moduleId);
      if(!module)throw Error('현재 채팅에 연결된 Character Mixer 항목이 아니야');
      const live=await assertStillCurrent(ctx);
      const next={...live,modules:asArray(live.modules).filter(id=>id!==moduleId)};
      await risuai.setChatToIndex(ctx.ci,ctx.ti,next);
      await remember('해제',ctx,{name:module.name},module);
      message='현재 채팅에서 편입 해제 완료 · 기존 채팅 기록과 원본 모듈은 보존';
    }catch(e){message='해제 중단 · '+str(e?.message||e);}
    finally{busy=false;await render();}
  }
  function renderOption(char,index){
    return '<option value="'+esc(char.chaId)+'" '+(char.chaId===sourceId?'selected':'')+
      '>'+esc((index+1)+'. '+str(char.name))+'</option>';
  }
  function check(id,title,help,checked){
    return '<label class="check"><input type="checkbox" data-cm-flag="'+esc(id)+'" '+(checked?'checked':'')+'/>'+
      '<span><b>'+esc(title)+'</b><small>'+esc(help)+'</small></span></label>';
  }
  async function render(){
    if(!opened||destroyed)return;
    try{
      const ctx=await context(),sources=available(ctx.db,ctx.target.chaId),src=presentSource(ctx);
      const active=installedInChat(ctx);
      const availableLore=src?loreOf(src):[];
      const availableModules=src?optionalModuleList(ctx,src):[];
      const installedHtml=active.length?active.map(m=>'<div class="installed"><span><b>'+
        esc(m.name)+'</b><small>이 채팅에 연결됨 · 로어 '+asArray(m.lorebook).length+
        '개 / 에셋 '+asArray(m.assets).length+'개</small></span>'+
        '<button type="button" data-cm-remove="'+esc(m.id)+'">이 채팅에서 해제</button></div>').join('')
        :'<p class="muted">현재 채팅에 편입된 캐릭터가 없어.</p>';
      document.body.innerHTML='<style>'+
        'body{margin:0;padding:18px;background:#171c2a;color:#eaf0ff;font:14px/1.55 system-ui}main{max-width:940px;margin:auto}'+
        'select,textarea,button{background:#263650;color:inherit;border:1px solid #63748f;border-radius:8px;padding:8px;font:inherit}'+
        'select,textarea{box-sizing:border-box;width:100%}textarea{min-height:82px;resize:vertical}button{cursor:pointer}button:disabled{opacity:.5;cursor:default}'+
        'section{background:#202c40;padding:14px;margin:12px 0;border-radius:10px;border:1px solid #374862}'+
        'label{display:block;margin:7px 0}.check{display:flex;align-items:flex-start;gap:9px}.check input{margin-top:6px}.check small,.muted{display:block;color:#aebdd6;font-size:12px}'+
        '.grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:7px 20px}.item{display:flex;align-items:center;gap:9px;margin:8px 0}'+
        '.item small{color:#aebdd6}.top{display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap}'+
        '.installed{display:flex;justify-content:space-between;align-items:center;gap:10px;margin:9px 0}'+
        '.status{padding:10px;background:#132134;border-radius:8px}.primary{background:#385d96}'+
        '@media(max-width:700px){body{padding:9px}.grid{grid-template-columns:1fr}}'+
        '</style><main><div class="top"><h2>🧩 Character Mixer v0.1.0</h2><button id="cm-close">닫기</button></div>'+
        '<p class="muted">현재 채팅의 내용을 지우지 않고 다른 봇의 설정·로어북·에셋 참조를 선택적으로 추가해. B 봇은 RisuBard에 먼저 가져와 둬야 해.</p>'+
        '<section><h3>A · 추가할 대상</h3><p>봇: <b>'+esc(ctx.target.name)+'</b> · 채팅: <b>'+esc(ctx.chat.name||ctx.chat.id)+'</b></p>'+
        '<p class="muted">이 채팅에만 적용. A·B 원본 캐릭터/첫 메시지/채팅 메시지를 수정하지 않아.</p></section>'+
        '<section><h3>B · 가져올 캐릭터</h3><label>기존에 설치된 B 봇<select id="cm-source">'+
        (sources.length?sources.map(renderOption).join(''):'<option value="">다른 봇이 없어</option>')+'</select></label>'+
        (src?'<p class="muted">원본: '+esc(src.name)+' · 로어 '+availableLore.length+'개 / 보유 에셋 '+(asArray(src.additionalAssets).length+asArray(src.emotionImages).length+asArray(src.ccAssets).length)+'개</p>':'')+
        '<label>세계관 합성<select id="cm-mode"><option value="adapt" '+(choices.mode==='adapt'?'selected':'')+
        '>A 세계관에 편입 (기본)</option><option value="original" '+(choices.mode==='original'?'selected':'')+
        '>B 원래 출신 유지</option></select></label>'+
        '<label>편입 설정 메모<textarea id="cm-notes" placeholder="예: B는 이 세계의 연금술 길드 소속이다.">'+esc(choices.notes)+'</textarea></label></section>'+
        '<section><h3>가져올 요소</h3><div class="grid">'+
        check('description','캐릭터 설명','외형·능력·고유 설정',choices.description)+
        check('personality','성격·말투','지속되는 인물 개성',choices.personality)+
        check('scenario','B 원래 배경','A와 충돌하면 A가 우선',choices.scenario)+
        check('examples','대사 예시','실제 사건은 복제하지 않음',choices.examples)+
        check('greeting','첫 메시지 참고','A 퍼메는 바꾸지 않음',choices.greeting)+
        check('assets','이미지 에셋','이미 등록된 이미지의 참조만 가져옴',choices.assets)+
        check('emotions','감정 이미지','B 표정 이미지를 이름으로 구분',choices.emotions)+
        check('moduleAssets','선택 모듈의 에셋','선택한 기존 모듈에서 이미지 가져오기',choices.moduleAssets)+
        check('moduleLore','선택 모듈의 로어','추가 로어 선택, 실행 코드 제외',choices.moduleLore)+
        '</div></section>'+
        '<section><div class="top"><h3>세부 로어북 선택</h3><button id="cm-select-lore">전체 선택/해제</button></div>'+
        (availableLore.length?availableLore.map((item,i)=>'<label class="item"><input type="checkbox" data-cm-lore="'+i+'" '+
          (loreChoices.has(i)?'checked':'')+'/>'+
          '<span><b>'+esc(item.comment||item.key||'로어 '+(i+1))+'</b><small>'+
          esc(clip(item.content,120))+'</small></span></label>').join(''):
          '<p class="muted">선택할 로어북이 없어.</p>')+
        '<p class="muted">추가 로어북은 이름에 반응하도록 활성화하며, @@indicator 같은 시스템 특수 항목은 자동 제외해.</p></section>'+
        '<section><h3>추가 에셋 모듈 선택</h3>'+
        (availableModules.length?availableModules.map(m=>'<label class="item"><input type="checkbox" data-cm-module="'+esc(m.id)+'" '+
          (moduleChoices.has(m.id)?'checked':'')+'/>'+
          '<span><b>'+esc(m.name)+'</b>'+ (m._belongs?' <small>(B 봇 연계)</small>':'')+
          '<small>이미지 '+asArray(m.assets).length+'개 · 로어 '+asArray(m.lorebook).length+
          '개 · 스크립트는 실행하지 않음</small></span></label>').join(''):
          '<p class="muted">선택 가능한 모듈이 없어.</p>')+'</section>'+
        '<section><h3>현재 편입된 캐릭터</h3>'+installedHtml+'</section>'+
        '<p class="status">'+esc(message||'선택 사항을 확인한 다음 아래 버튼으로 현재 채팅에 적용해.')+'</p>'+
        '<div class="top"><p class="muted">원본 보존 · 채팅별 적용 · 스크립트/트리거 실행 제외</p>'+
        '<button id="cm-apply" class="primary" '+(!src||busy?'disabled':'')+'>현재 채팅에 B 추가/업데이트</button></div>'+
        '</main>';
      const el=id=>document.getElementById(id);
      el('cm-close').onclick=()=>{opened=false;void risuai.hideContainer();};
      el('cm-source').onchange=e=>{sourceId=str(e.target.value);loreChoices.clear();moduleChoices.clear();void render();};
      el('cm-mode').onchange=e=>{choices.mode=str(e.target.value)==='original'?'original':'adapt';void render();};
      el('cm-notes').onchange=e=>{choices.notes=clip(e.target.value,1200);};
      for(const node of document.querySelectorAll('[data-cm-flag]')){
        node.onchange=e=>{choices[node.getAttribute('data-cm-flag')]=Boolean(e.target.checked);};
      }
      for(const node of document.querySelectorAll('[data-cm-lore]')){
        node.onchange=e=>{
          const n=Number(node.getAttribute('data-cm-lore'));
          if(e.target.checked)loreChoices.add(n);else loreChoices.delete(n);
        };
      }
      for(const node of document.querySelectorAll('[data-cm-module]')){
        node.onchange=e=>{
          const id=str(node.getAttribute('data-cm-module'));
          if(e.target.checked)moduleChoices.add(id);else moduleChoices.delete(id);
        };
      }
      el('cm-select-lore').onclick=()=>{
        if(loreChoices.size===availableLore.length)loreChoices.clear();
        else loreChoices=new Set(availableLore.map((_,i)=>i));
        void render();
      };
      el('cm-apply').onclick=()=>void apply();
      for(const node of document.querySelectorAll('[data-cm-remove]'))
        node.onclick=()=>void detach(str(node.getAttribute('data-cm-remove')));
    }catch(error){
      document.body.innerHTML='<main style="padding:20px;background:#171c2a;color:#fff;font:14px system-ui">'+
        '<h2>Character Mixer</h2><p>'+esc(error?.message||error)+'</p>'+
        '<button id="cm-closed">닫기</button></main>';
      document.getElementById('cm-closed').onclick=()=>{opened=false;void risuai.hideContainer();};
    }
  }
  async function open(){
    opened=true;message='';
    await render();
    await risuai.showContainer('fullscreen');
  }
  await risuai.registerSetting(NAME,open,'🧩','html','character-mixer-settings');
  try{
    await risuai.registerButton({name:NAME,icon:'🧩',iconType:'html',location:'hamburger',
      id:'character-mixer-hamburger'},open);
  }catch(error){console.log('[CharacterMixer] optional menu button unavailable',error);}
  await risuai.onUnload(async()=>{destroyed=true;opened=false;});
})();
