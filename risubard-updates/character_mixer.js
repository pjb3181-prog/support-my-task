//@name character_mixer
//@display-name Character Mixer
//@api 3.0
//@version 0.6.0-beta.1
//@update-url https://raw.githubusercontent.com/pjb3181-prog/support-my-task/main/risubard-updates/character_mixer.js
//@description Selectively blend an imported character's lore and asset references into the current chat without overwriting existing bots.
(async () => {
  'use strict';
  const NAME='Character Mixer';
  const MARK='[CHARACTER_MIXER_V1]';
  const LOG='character_mixer_v01_activity';
  const PACK_STORE='character_mixer_library_v1';
  const ARCHIVE_MARK='[CHARACTER_MIXER_ARCHIVE_V1]';
  let packLibrary=[];
  let legacyPanelOpen=false;
  let externalQuery='',externalApiKey='',externalUserId='',externalResults=[],externalPage=0;
  let externalBusy=false,externalError='',externalNotice='';
  const externalSelected=new Set();
  const PROFILE_LIMIT=6000, LORE_LIMIT=30000;
  let destroyed=false, busy=false, opened=false, message='', sourceId='';
  let choices={mode:'adapt',notes:'',description:true,personality:true,scenario:false,
    examples:false,greeting:false,assets:true,emotions:true,moduleAssets:true,moduleLore:false,autoImages:false};
  let loreChoices=new Set(),moduleChoices=new Set(),extraSourceIds=new Set();
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
  async function context(allowLibraryOnly=false){
    if(typeof risuai.getDatabase!=='function')throw Error('플러그인 데이터 접근 API가 없어');
    const db=await risuai.getDatabase();
    if(!db||!Array.isArray(db.characters)||!Array.isArray(db.modules))
      throw Error('RisuBard 데이터베이스를 읽을 수 없어');
    const library=()=>({
      db,ci:-1,ti:-1,libraryOnly:true,
      target:{chaId:'__character_mixer_library__',name:'독립 캐릭터 라이브러리'},
      chat:{id:'__library_view__',name:'라이브러리',modules:[]}
    });
    if(typeof risuai.getCurrentCharacterIndex!=='function'||typeof risuai.getCurrentChatIndex!=='function'
       ||typeof risuai.getChatFromIndex!=='function'||typeof risuai.setChatToIndex!=='function'
       ||typeof risuai.setDatabaseLite!=='function'){
      if(allowLibraryOnly)return library();
      throw Error('현재 RisuBard에서 필요한 채팅 저장 API를 지원하지 않아');
    }
    let ci,ti,chat;
    try{
      ci=await risuai.getCurrentCharacterIndex();
      // Some RisuBard builds throw internally when no character is selected:
      // getCurrentChatIndex accesses characters[ci].chatPage without a guard.
      if(!Number.isInteger(ci)||ci<0||ci>=db.characters.length||!db.characters[ci]?.chaId)
        throw Error('현재 선택된 캐릭터가 없어');
      ti=await risuai.getCurrentChatIndex();
      if(!Number.isInteger(ti)||ti<0)throw Error('채팅 인덱스가 유효하지 않아');
      chat=await risuai.getChatFromIndex(ci,ti);
      if(!chat?.id||chat._placeholder)throw Error('채팅이 완전히 로드되지 않았어');
    }catch(error){
      if(allowLibraryOnly)return library();
      throw Error('채팅 대상 조회 실패. 캐릭터의 실제 채팅을 연 뒤 다시 시도해. ('+
        str(error?.message||error)+')');
    }
    return {db,ci,ti,target:db.characters[ci],chat,libraryOnly:false};
  }
  function installedInChat(ctx){
    const ids=new Set(asArray(ctx.chat.modules));
    return modulesOf(ctx.db).filter(m=>generated(m)&&ids.has(m.id)
      &&str(m.description).includes('"targetChatId":"'+ctx.chat.id+'"'));
  }
  function presentSource(ctx){
    const saved=packLibrary.find(p=>'pack:'+p.id===sourceId);
    if(saved)return {...safeClone(saved.snapshot),chaId:'pack:'+saved.id};
    const sources=available(ctx.db,ctx.target.chaId);
    if(!sources.some(x=>x.chaId===sourceId)){
      sourceId=sources[0]?.chaId||(packLibrary[0]?'pack:'+packLibrary[0].id:'');
      loreChoices=new Set();moduleChoices=new Set();extraSourceIds=new Set();
    }
    if(sourceId.startsWith('pack:')){
      const fallback=packLibrary.find(p=>'pack:'+p.id===sourceId);
      return fallback?{...safeClone(fallback.snapshot),chaId:sourceId}:null;
    }
    return sources.find(x=>x.chaId===sourceId)||null;
  }
  function optionalModuleList(ctx,src){
    const fromChar=new Set(asArray(src?.modules));
    return modulesOf(ctx.db).filter(m=>m?.id&&!generated(m)&&!str(m.description).startsWith(ARCHIVE_MARK))
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
  // Support B bot image tags while leaving stored chat history untouched.
  // Example: {{img="hancock_angry"}} -> {{img::Hancock_ab123_hancock_angry}}.
  function createAliasLookup(assets){
    const map=new Map(),ambiguous=new Set();
    const register=(oldName,newName)=>{
      const raw=str(oldName).trim().toLocaleLowerCase();
      const withoutExtension=raw.replace(/\.(?:webp|png|jpe?g|gif|apng|avif|bmp|svg|mp4|webm)$/i,'');
      for(const key of new Set([raw,withoutExtension])){
        if(!key||!newName||ambiguous.has(key))continue;
        if(map.has(key)&&map.get(key)!==newName){map.delete(key);ambiguous.add(key);}
        else map.set(key,newName);
      }
    };
    for(const x of assets){
      register(x.name,x.name);
      register(x.original,x.name);
      if(x.where==='emotion')register(str(x.original).replace(/^emotion_/i,''),x.name);
    }
    return {map,ambiguous,register};
  }
  function rewriteAssetTokens(text,lookup,existing=null){
    const native=/\{\{\s*(img|image|asset|emotion|raw|path|video|audio|bgm|bg|video-img)\s*(::|=)\s*(?:"([^"\n]{1,160})"|'([^'\n]{1,160})'|([^}\n]{1,160}))\s*\}\}/gi;
    const known=new Set();
    for(const x of asArray(existing?.additionalAssets)){
      if(!Array.isArray(x))continue;
      const name=str(x[0]).trim().toLocaleLowerCase();
      known.add(name);
      known.add(name.replace(/\.(?:webp|png|jpe?g|gif|apng|avif|bmp|svg|mp4|webm)$/i,''));
    }
    const knownEmotions=new Set(asArray(existing?.emotionImages).map(x=>Array.isArray(x)?str(x[0]).toLocaleLowerCase():''));
    return str(text).replace(native,(whole,type,separator,double,single,bare)=>{
      const original=str(double??single??bare).trim();
      if(!original)return whole;
      const key=original.toLocaleLowerCase();
      // A's assets must never silently be replaced by B's imported images.
      if(known.has(key)||(type.toLocaleLowerCase()==='emotion'&&knownEmotions.has(key))){
        return separator==='='?'{{'+type.toLocaleLowerCase()+'::'+original+'}}':whole;
      }
      const mapped=lookup.map.get(key);
      if(!mapped)return whole;
      const kind=type.toLocaleLowerCase()==='emotion'?'img':type.toLocaleLowerCase();
      return '{{'+kind+'::'+mapped+'}}';
    });
  }
  function remapAssetReferences(text,assets){
    return rewriteAssetTokens(text,createAliasLookup(assets));
  }
  function metadataOf(module){
    if(!generated(module))return null;
    try{
      const parsed=JSON.parse(str(module.description).slice(MARK.length));
      return isPlain(parsed)?parsed:null;
    }catch(_){return null;}
  }
  function activeAliases(ctx){
    const lookup=createAliasLookup([]),active=installedInChat(ctx);
    for(const mod of active){
      const metadata=metadataOf(mod);
      if(!metadata)continue;
      const source=charactersOf(ctx.db).find(c=>c.chaId===metadata.sourceId);
      const prefix=source?label(source.name)+'_'+str(source.chaId).slice(0,5)+'_':'';
      const mapped=asArray(mod.assets).filter(x=>Array.isArray(x)&&x.length>=2);
      for(const asset of mapped){
        const name=str(asset[0]),path=str(asset[1]);
        lookup.register(name,name);
        // Also resolve aliases from already imported v0.1.0 data modules.
        if(prefix&&name.startsWith(prefix)){
          const short=name.slice(prefix.length);
          lookup.register(short,name);
          if(short.startsWith('emotion_'))lookup.register(short.slice(8),name);
        }
        const candidates=[];
        if(source){
          for(const item of asArray(source.additionalAssets))
            if(Array.isArray(item)&&str(item[1])===path)candidates.push(str(item[0]));
          for(const item of asArray(source.ccAssets))
            if(isPlain(item)&&str(item.uri)===path)candidates.push(str(item.name));
          for(const item of asArray(source.emotionImages))
            if(Array.isArray(item)&&str(item[1])===path)candidates.push(str(item[0]),'emotion_'+str(item[0]));
        }
        for(const m of modulesOf(ctx.db)){
          if(generated(m))continue;
          for(const item of asArray(m.assets))
            if(Array.isArray(item)&&str(item[1])===path)candidates.push(str(item[0]));
        }
        for(const candidate of candidates)lookup.register(candidate,name);
      }
      for(const entry of asArray(metadata.assetAliases)){
        if(Array.isArray(entry)&&entry.length>=2
            &&mapped.some(asset=>str(asset[0])===str(entry[1])))
          lookup.register(entry[0],entry[1]);
      }
    }
    return {lookup,active};
  }
  // Cache alias discovery: a full database scan per displayed message is expensive
  // for characters with large asset libraries. Scope cache to the chat and expire it.
  const ALIAS_CACHE_MS=10000;
  let displayCache=null;
  function invalidateDisplayCache(){displayCache=null;}
  function sceneEmotion(text){
    const rules=[
      ['crying',/(?:울었|눈물|흐느꼈|서럽|crying|tears|sobbed)/i],
      ['angry',/(?:화가|짜증|화를 냈|분노|인상을 찌푸|angry|furious|annoyed)/i],
      ['blush',/(?:얼굴이 붉|볼이 붉|귀가 붉|부끄러|당황|blush|embarrass|shy)/i],
      ['surprised',/(?:놀랐|깜짝|눈이 커|경악|surpris|shock)/i],
      ['smile',/(?:웃었|웃음|미소|싱긋|빙긋|smil|laugh|grin)/i],
      ['sad',/(?:슬픔|우울|풀이 죽|sad|depress)/i]
    ];
    return rules.find(([name,pattern])=>pattern.test(text))?.[0]||'';
  }
  function pickTaggedAsset(content,cached){
    if(!cached?.tagAssets?.length||/\{\{\s*(?:img|image|asset|emotion)\s*(?:::|=)/i.test(content))return '';
    if(content.length>40000||content.length<40)return '';
    const contentWindow=content.slice(-14000);
    let latest=null;
    for(const item of cached.tagAssets){
      const name=str(item.characterName).trim();
      if(!name)continue;
      const escaped=name.replace(/[^a-zA-Z0-9가-힣_]/g,ch=>'\\'+ch);
      const pattern=new RegExp('\\['+escaped+'\\]','g');
      let match;
      while((match=pattern.exec(contentWindow))){
        if(!latest||match.index>latest.index)latest={item,index:match.index,matched:name};
      }
    }
    if(!latest)return '';
    const contextText=contentWindow.slice(latest.index,Math.min(contentWindow.length,latest.index+900));
    const emotion=sceneEmotion(contextText);
    if(!emotion)return '';
    const synonyms={
      smile:['smile','happy','laughing','grin','closed_eyes'],
      angry:['angry','frown','annoyed','furrowed_brow'],
      crying:['crying','tears','sad','crying_with_eyes_open'],
      blush:['blush','embarrassed','shy','blushing'],
      surprised:['surprised','wide_eyes','open_mouth','shock'],
      sad:['sad','tears','frown','downcast_eyes']
    };
    const candidates=cached.tagAssets.filter(x=>x.characterName===latest.matched);
    let winning=null,score=0;
    for(const item of candidates){
      const tags=new Set(asArray(item.tags));
      const value=asArray(synonyms[emotion]).reduce((n,t)=>n+(tags.has(t)?(t===emotion?3:1):0),0);
      if(value>score){score=value;winning=item;}
    }
    return winning&&score>0?'{{img::'+winning.name+'}}':'';
  }
  async function displayAssetCompatibility(content){
    if(destroyed||typeof content!=='string')return content;
    const hasAssetTag=/\{\{\s*(?:img|image|asset|emotion|raw|path|video|audio|bgm|bg|video-img)\s*(?:::|=)/i.test(content);
    if(!hasAssetTag&&!/\[[^\]\n]{1,80}\]/.test(content))return content;
    try{
      const ci=await risuai.getCurrentCharacterIndex();
      const ti=await risuai.getCurrentChatIndex();
      const now=Date.now();
      let cached=displayCache;
      if(!cached||cached.ci!==ci||cached.ti!==ti||now-cached.at>ALIAS_CACHE_MS){
        const ctx=await context();
        const aliases=activeAliases(ctx);
        const tagAssets=[];
        for(const mod of aliases.active){
          const metadata=metadataOf(mod);
          if(metadata?.autoImages!==true)continue;
          for(const item of asArray(metadata.externalTagAssets))
            if(asArray(mod.assets).some(x=>Array.isArray(x)&&x[0]===item.name))
              tagAssets.push(item);
        }
        cached={ci:ctx.ci,ti:ctx.ti,at:now,lookup:aliases.lookup,
          hasActive:aliases.active.length>0,target:ctx.target,tagAssets};
        displayCache=cached;
      }
      if(!cached.hasActive)return content;
      const rewritten=hasAssetTag?rewriteAssetTokens(content,cached.lookup,cached.target):content;
      const selected=pickTaggedAsset(rewritten,cached);
      return selected?rewritten+'\n\n'+selected:rewritten;
    }catch(error){
      console.log('[CharacterMixer] asset preview fallback:',error?.message||error);
      return content;
    }
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
    if(assets.length)lines.push('For images use the exact native RisuBard syntax {{img::REGISTERED_ASSET_NAME}} and registered names shown above; avoid {{img=\"original\"}}.');
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
    const extras=available(ctx.db,ctx.target.chaId).filter(x=>x.chaId!==src.chaId&&extraSourceIds.has(x.chaId));
    const sourceBots=[src,...extras];
    const assets=[],aliasRows=[],byPath=new Map();
    for(const bot of sourceBots){
      for(const asset of readAssetPairs(bot,ctx)){
        let canonical=byPath.get(asset.path);
        if(!canonical){canonical=asset;byPath.set(asset.path,canonical);assets.push(asset);}
        aliasRows.push([asset.original,canonical.name]);
      }
    }
    const info=makeProfile(src,assets)+extras.map(x=>'\n[Same-character supplemental material: '+clip(x.name,70)+']\n'+
      (choices.description?clip(x.desc,650):'')+
      (choices.personality?'\n'+clip(x.personality,350):'')).join('');
    const key=clip(src.name,80);
    const lore=[{
      id:shortId(),key,secondkey:'',insertorder:0,comment:'[Character Mixer] '+key+' · 등장인물 기준',
      content:info.slice(0,PROFILE_LIMIT),mode:'constant',alwaysActive:true,selective:false,enabled:true
    }];
    const allLore=chooseLore(src,ctx);
    for(const bot of extras){
      for(const entry of loreOf(bot)){
        if(str(entry.content).trim().startsWith('@@indicator'))continue;
        allLore.push({source:str(bot.name),entry});
      }
    }
    if(allLore.reduce((n,item)=>n+str(item.entry.content).length,0)>LORE_LIMIT)
      throw Error('통합 로어북이 '+LORE_LIMIT+'자를 초과해. 보조 봇을 줄여줘.');
    const seenLore=new Set();
    for(const item of allLore){
      const loreKey=str(item.entry.key)+'|'+str(item.entry.content);
      if(seenLore.has(loreKey))continue;
      seenLore.add(loreKey);
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
    const externalTagAssets=[];
    for(const bot of sourceBots){
      if(!str(bot.chaId).startsWith('pack:'))continue;
      const pack=packLibrary.find(p=>'pack:'+p.id===bot.chaId);
      for(const item of asArray(pack?.externalAssets)){
        const mapped=assets.find(a=>a.path===item.path);
        if(mapped)externalTagAssets.push({name:mapped.name,tags:asArray(item.tags).slice(0,60),
          characterName:clip(pack.name,100),sourceId:bot.chaId});
      }
    }
    const extra= {
      externalTagAssets,autoImages:!!choices.autoImages,
      sourceId:src.chaId,sourceIds:sourceBots.map(x=>x.chaId),targetCharacterId:ctx.target.chaId,targetChatId:ctx.chat.id,
      mode:choices.mode,version:3,
      assetAliases:aliasRows
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
  async function loadPacks(){
    try{
      const rows=await risuai.pluginStorage.getItem(PACK_STORE);
      packLibrary=asArray(rows).filter(p=>p&&p.id&&p.snapshot&&p.snapshot.name);
    }catch(e){console.warn('[CharacterMixer] pack loading failed',e);packLibrary=[];}
  }
  async function savePacks(){await risuai.pluginStorage.setItem(PACK_STORE,packLibrary);}
  async function exportPackJson(){
    try{
      const pack=packLibrary.find(p=>'pack:'+p.id===sourceId);
      if(!pack)throw Error('내보낼 저장 팩을 선택해.');
      const json=JSON.stringify({format:'character-mixer-pack-v1',record:pack},null,2);
      const blob=new Blob([json],{type:'application/json'});
      const url=URL.createObjectURL(blob),a=document.createElement('a');
      a.href=url;a.download=label(pack.name)+'_character_pack.json';
      document.body.appendChild(a);a.click();a.remove();
      setTimeout(()=>URL.revokeObjectURL(url),5000);
      message='캐릭터 팩 JSON 내보내기 시작 · 이미지 원본 바이너리는 포함되지 않아';
    }catch(e){message='내보내기 실패 · '+str(e?.message||e);}
    await render();
  }

  function bytesOf(data){
    if(data instanceof Uint8Array)return data;
    if(data instanceof ArrayBuffer)return new Uint8Array(data);
    if(ArrayBuffer.isView(data))return new Uint8Array(data.buffer,data.byteOffset,data.byteLength);
    if(Array.isArray(data)&&data.every(v=>Number.isInteger(v)&&v>=0&&v<=255))return new Uint8Array(data);
    // The plugin API is not guaranteed to return binary for every URI.
    return null;
  }
  function archivedModuleId(id){return 'character-mixer-pack-archive-'+str(id).replace(/[^a-zA-Z0-9_-]/g,'');}
  async function independentlySaveAsset(path){
    if(typeof risuai.readImage!=='function'||typeof risuai.saveAsset!=='function')
      throw Error('RisuBard에서 readImage/saveAsset API를 사용할 수 없어');
    const raw=bytesOf(await risuai.readImage(path));
    if(!raw||!raw.length)throw Error('에셋을 읽을 수 없거나 빈 파일이야: '+clip(path,100));
    const stored=await risuai.saveAsset(raw);
    if(!safePath(stored)||!stored.startsWith('assets/'))throw Error('독립 저장 경로가 아닌 에셋이 반환됐어');
    const check=bytesOf(await risuai.readImage(stored));
    if(!check||check.length!==raw.length)throw Error('복제 후 재검증 실패: '+clip(path,100));
    // Compare complete bytes; inexpensive versus the I/O just performed.
    for(let i=0;i<raw.length;i++)if(raw[i]!==check[i])
      throw Error('복제 이미지가 원본과 달라: '+clip(path,100));
    return {path:stored,bytes:raw.length};
  }
  async function extractPack(){
    if(busy)return;
    busy=true;
    try{
      const ctx=await context(true),src=presentSource(ctx);
      if(!src)throw Error('추출할 캐릭터를 선택해.');
      const others=available(ctx.db,ctx.target.chaId)
        .filter(x=>x.chaId!==src.chaId&&extraSourceIds.has(x.chaId));
      const bots=[src,...others],paths=new Map(),assets=[],lores=[],loreKeys=new Set(),failed=[];
      const previousId=sourceId.startsWith('pack:')?sourceId.slice(5):'';
      const id=previousId||shortId();
      const previous=packLibrary.find(p=>p.id===id);
      // Preserve existing assets and augment them when re-extracting an existing pack.
      for(const bot of bots){
        for(const asset of readAssetPairs(bot,ctx)){
          if(paths.has(asset.path))continue;
          paths.set(asset.path,asset);
        }
        for(const item of loreOf(bot)){
          if(str(item.content).trim().startsWith('@@indicator'))continue;
          const key=str(item.key)+'|'+str(item.content);
          if(loreKeys.has(key))continue;
          loreKeys.add(key);lores.push(safeClone(item));
        }
      }
      const seenSaved=new Map(),usedNames=new Set();
      let copied=0,reused=0;
      for(const asset of paths.values()){
        const previousAsset=asArray(previous?.snapshot?.additionalAssets)
          .find(x=>Array.isArray(x)&&str(x[1])===asset.path);
        const originPath=asset.path;
        let newPath=seenSaved.get(originPath);
        if(!newPath){
          try{
            // When updating an existing pack the archive itself is already independent.
            if(previousAsset&&previous?.binaryCopied===true){
              const verified=bytesOf(await risuai.readImage(originPath));
              if(!verified||!verified.length)throw Error('보관된 에셋 손상');
              newPath=originPath;reused++;
            }else{
              const result=await independentlySaveAsset(originPath);
              newPath=result.path;copied++;
            }
          }catch(e){
            failed.push(clip(asset.name,70)+' : '+str(e?.message||e));continue;
          }
          seenSaved.set(originPath,newPath);
        }
        let assetName=asset.name,number=2;
        while(usedNames.has(assetName)){assetName=asset.name+'_'+number;number++;}
        usedNames.add(assetName);
        assets.push([assetName,newPath,asset.ext]);
      }
      if(failed.length)throw Error('이미지 '+failed.length+'개 복사 실패. 저장을 중단했어. 첫 오류: '+failed[0]);
      const snapshot={name:str(src.name),desc:str(src.desc),personality:str(src.personality),
        scenario:str(src.scenario),exampleMessage:str(src.exampleMessage),
        firstMessage:str(src.firstMessage),globalLore:lores,
        additionalAssets:assets,emotionImages:[],ccAssets:[],modules:[]};
      const record={id,name:src.name,updatedAt:Date.now(),
        sources:bots.map(b=>({id:b.chaId,name:b.name})),binaryCopied:true,assetCount:assets.length,
        externalAssets:asArray(previous?.externalAssets).filter(item=>assets.some(x=>x[1]===item.path)),
        snapshot};
      const archiveId=archivedModuleId(id);
      const archive={
        id:archiveId,name:'Character Mixer Archive · '+clip(src.name,70),
        description:ARCHIVE_MARK+JSON.stringify({packId:id,version:1}),
        lorebook:[],assets:assets.map(x=>[x[0],x[1],x[2]]),
        namespace:'character-mixer-archive'
      };
      // Keep copied binary assets referenced from a permanent (but inactive)
      // library module so they are not dependent on the original character.
      const currentDb=await risuai.getDatabase();
      const moduleBefore=asArray(currentDb.modules);
      const moduleAfter=[...moduleBefore.filter(x=>x?.id!==archiveId),archive];
      await risuai.setDatabaseLite({modules:moduleAfter});
      const oldLibrary=packLibrary;
      packLibrary=[record,...packLibrary.filter(p=>p.id!==id)];
      try{await savePacks();}
      catch(e){
        packLibrary=oldLibrary;
        try{await risuai.setDatabaseLite({modules:moduleBefore});}
        catch(rollback){console.error('[CharacterMixer] archive rollback failed',rollback);}
        throw e;
      }
      sourceId='pack:'+id;extraSourceIds.clear();loreChoices.clear();moduleChoices.clear();
      invalidateDisplayCache();
      message='독립 캐릭터 팩 저장 완료 · 파일 복제 '+copied+'개 / 재사용 '+reused+
        '개 / 전체 '+assets.length+'개 · 저장 후 바이트 검증 완료 (원본 봇 삭제와 무관하게 보관 모듈 참조 유지)';
    }catch(e){message='추출 실패 · '+str(e?.message||e);}
    finally{busy=false;await render();}
  }

  // External provider integration: only user-initiated, limited-size search.
  // No automatic crawling, no scheduled retrieval and no Pixiv access bypass.
  function externalTarget(){
    const pack=packLibrary.find(p=>'pack:'+p.id===sourceId);
    if(!pack)throw Error('먼저 저장된 [PACK] 캐릭터를 선택해.');
    return pack;
  }
  function gelbooruMediaURL(value){
    try{
      const u=new URL(str(value));
      if(u.protocol!=='https:'||!/(^|\.)gelbooru\.com$/i.test(u.hostname))return '';
      if(!/\.(?:png|jpg|jpeg|gif|webp)(?:$|\?)/i.test(u.pathname+u.search))return '';
      return u.href;
    }catch(_){return '';}
  }
  function booruTags(row){
    const raw=Array.isArray(row?.tags)?row.tags:typeof row?.tags==='string'?row.tags.split(/\s+/):[];
    return [...new Set(raw.map(x=>str(x).toLowerCase()).filter(Boolean))].slice(0,200);
  }
  function parseBooruPosts(data){
    const list=Array.isArray(data)?data:Array.isArray(data?.post)?data.post:[];
    return list.filter(x=>x&&Number.isFinite(Number(x.id)))
      .filter(x=>['general','safe','s','g'].includes(str(x.rating).toLowerCase()))
      .map(row=>({
        id:String(row.id),tags:booruTags(row),rating:row.rating,
        thumbnail:gelbooruMediaURL(row.preview_url||row.sample_url||row.file_url),
        image:gelbooruMediaURL(row.file_url||row.sample_url),
        source:clip(row.source||'',500),
        postURL:'https://gelbooru.com/index.php?page=post&s=view&id='+encodeURIComponent(String(row.id))
      })).filter(row=>row.image);
  }
  async function searchExternal(){
    if(externalBusy)return;
    externalBusy=true;externalError='';externalNotice='';
    try{
      externalResults=[];
      const tokens=str(externalQuery).trim().split(/\s+/).filter(Boolean).slice(0,8);
      if(!tokens.length)throw Error('캐릭터 태그를 입력해. 예: boa_hancock_(one_piece)');
      const tags=[...tokens.filter(x=>!x.startsWith('rating:')),'rating:general'].join(' ');
      const params=new URLSearchParams({page:'dapi',s:'post',q:'index',json:'1',
        limit:'18',pid:String(externalPage),tags});
      if(externalApiKey.trim()&&externalUserId.trim()){
        params.set('api_key',externalApiKey.trim());params.set('user_id',externalUserId.trim());
      }
      if(typeof risuai.nativeFetch!=='function')throw Error('이 버전에서는 nativeFetch API를 사용할 수 없어');
      const response=await risuai.nativeFetch('https://gelbooru.com/index.php?'+params.toString(),{method:'GET'});
      if(!response?.ok)throw Error('Gelbooru API 응답 '+(response?.status||'없음')+
        ' · API 키/사용자 ID와 요청 제한을 확인해.');
      const data=await response.json();
      externalResults=parseBooruPosts(data);
      externalSelected.clear();
      externalNotice=externalResults.length+'개 일반 등급 이미지 검색 완료. 저장할 이미지를 직접 골라줘.';
    }catch(e){externalError=str(e?.message||e);}
    finally{externalBusy=false;await render();}
  }
  async function importExternalImages(){
    if(externalBusy)return;
    externalBusy=true;externalError='';externalNotice='';
    try{
      const pack=externalTarget();
      const chosen=externalResults.filter(x=>externalSelected.has(x.id));
      if(!chosen.length)throw Error('가져올 이미지를 선택해.');
      if(chosen.length>12)throw Error('한 번에 12개까지만 저장할 수 있어.');
      if(typeof risuai.nativeFetch!=='function'||typeof risuai.saveAsset!=='function')
        throw Error('이미지 저장 API를 사용할 수 없어');
      const existingIds=new Set(asArray(pack.externalAssets).map(x=>str(x.postId)));
      const imported=[],problems=[];
      for(const item of chosen){
        if(existingIds.has(item.id))continue;
        try{
          const response=await risuai.nativeFetch(item.image,{method:'GET'});
          if(!response?.ok)throw Error('이미지 응답 '+response?.status);
          const size=Number(response.headers?.get?.('content-length')||0);
          if(size>18*1024*1024)throw Error('18MB를 초과하는 이미지');
          const contentType=str(response.headers?.get?.('content-type')).toLowerCase();
          if(contentType&&!contentType.startsWith('image/'))throw Error('이미지 형식이 아닌 응답');
          const bytes=new Uint8Array(await response.arrayBuffer());
          if(!bytes.length||bytes.length>18*1024*1024)throw Error('빈 이미지 또는 18MB 초과');
          const savedPath=await risuai.saveAsset(bytes);
          if(!safePath(savedPath))throw Error('에셋 저장 경로가 유효하지 않아');
          const verified=bytesOf(await risuai.readImage(savedPath));
          if(!verified||verified.length!==bytes.length)throw Error('저장 검증 실패');
          for(let i=0;i<bytes.length;i++)if(bytes[i]!==verified[i])throw Error('저장 내용이 원본과 달라');
          const ext=item.image.match(/\.(png|jpe?g|gif|webp)(?:$|\?)/i)?.[1]?.replace('jpeg','jpg')||'png';
          imported.push({...item,path:savedPath,name:'gelbooru_'+item.id,ext});
        }catch(e){problems.push(item.id+': '+str(e?.message||e));}
      }
      if(!imported.length)throw Error(problems.length?'저장 실패: '+problems[0]:'이미 저장된 이미지야.');
      // Save a deduplicated library record and archive module, never edit the source bot.
      const oldLibrary=packLibrary;
      const db=await risuai.getDatabase(),oldModules=asArray(db.modules);
      const archiveId=archivedModuleId(pack.id);
      const already=new Set(asArray(pack.snapshot.additionalAssets).map(x=>str(x[0])));
      const newAssets=imported.map(item=>{
        let name=item.name,i=2;while(already.has(name)){name=item.name+'_'+i;i++;}
        already.add(name);
        return {name,path:item.path,ext:item.ext,tags:item.tags,postId:item.id,
          provider:'gelbooru',sourceURL:item.postURL,artistSource:item.source};
      });
      const newRecord={...pack,updatedAt:Date.now(),binaryCopied:true,
        snapshot:{...pack.snapshot,additionalAssets:[
          ...asArray(pack.snapshot.additionalAssets),
          ...newAssets.map(a=>[a.name,a.path,a.ext])
        ]},
        externalAssets:[...asArray(pack.externalAssets),...newAssets]};
      newRecord.assetCount=newRecord.snapshot.additionalAssets.length;
      const archive={id:archiveId,name:'Character Mixer Archive · '+clip(pack.name,70),
        description:ARCHIVE_MARK+JSON.stringify({packId:pack.id,version:2}),
        lorebook:[],assets:newRecord.snapshot.additionalAssets.map(x=>[x[0],x[1],x[2]]),
        namespace:'character-mixer-archive'};
      await risuai.setDatabaseLite({modules:[...oldModules.filter(m=>m?.id!==archiveId),archive]});
      packLibrary=packLibrary.map(p=>p.id===pack.id?newRecord:p);
      try{await savePacks();}
      catch(e){
        packLibrary=oldLibrary;
        try{await risuai.setDatabaseLite({modules:oldModules});}
        catch(rollback){console.error('[CharacterMixer] archive rollback failed',rollback);}
        throw e;
      }
      externalSelected.clear();invalidateDisplayCache();
      externalNotice=newAssets.length+'개 독립 팩에 저장 ·'+(problems.length?' 실패 '+problems.length+'개: '+problems[0]:' 저장 후 검증 완료');
    }catch(e){externalError=str(e?.message||e);}
    finally{externalBusy=false;await render();}
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
      invalidateDisplayCache();
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
      invalidateDisplayCache();
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
      const ctx=await context(true),sources=[...available(ctx.db,ctx.target.chaId),...packLibrary.map(p=>({chaId:'pack:'+p.id,name:'[PACK] '+p.name}))],src=presentSource(ctx);
      const active=installedInChat(ctx);
      const availableLore=src?loreOf(src):[];
      const availableModules=src?optionalModuleList(ctx,src):[];
      const extraCandidates=available(ctx.db,ctx.target.chaId).filter(x=>x.chaId!==sourceId);
      const installedHtml=active.length?active.map(m=>'<div class="installed"><span><b>'+
        esc(m.name)+'</b><small>이 채팅에 연결됨 · 로어 '+asArray(m.lorebook).length+
        '개 / 에셋 '+asArray(m.assets).length+'개</small></span>'+
        '<button type="button" data-cm-remove="'+esc(m.id)+'">이 채팅에서 해제</button></div>').join('')
        :'<p class="muted">현재 채팅에 편입된 캐릭터가 없어.</p>';
      const aliases=activeAliases(ctx);
      const names=[...aliases.lookup.map.entries()].filter(([a,b])=>a!==str(b).toLocaleLowerCase()).slice(0,20);
      const diagnostic='<section><h3>Asset aliases (A chat)</h3>'+
        (names.length?names.map(([oldName,newName])=>'<p class="muted"><code>'+esc(oldName)+
          '</code> -> <code>'+esc(newName)+'</code></p>').join(''):
          '<p class="muted">No imported image aliases. Check B image assets and any separate asset module selections.</p>')+
        '<p class="muted">Native RisuBard tag: {{img::ASSET_NAME}}. Legacy {{img="NAME"}} is remapped only when NAME matches an imported image.</p></section>';
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
        '</style><main><div class="top"><h2>🧩 Character Mixer v0.6.0-beta.1</h2><button id="cm-close">닫기</button></div>'+
        '<p class="muted">현재 채팅의 내용을 지우지 않고 다른 봇의 설정·로어북·에셋 참조를 선택적으로 추가해. B 봇은 RisuBard에 먼저 가져와 둬야 해.</p>'+
        '<section><h3>독립 캐릭터 라이브러리 · '+packLibrary.length+'개</h3>'+
        '<p class="muted">추출은 현재 채팅과 무관해. 원본 봇과 분리된 캐릭터 팩을 보관하고, 필요할 때만 다른 채팅에서 불러올 수 있어.</p>'+
        (packLibrary.length?packLibrary.map(p=>'<div class="installed"><span><b>📦 '+esc(p.name)+'</b><small>로어 '+loreOf(p.snapshot).length+'개 / 에셋 '+asArray(p.snapshot.additionalAssets).length+'개'+(p.binaryCopied?' · 이미지 복제 기록 있음':' · 이미지 참조만 저장됨')+'</small></span>'+
        '<button type="button" data-cm-select-pack="'+esc(p.id)+'">팩 선택</button></div>').join(''):'<p class="muted">저장된 캐릭터 팩이 없어. 아래에서 원본 봇을 선택해 추출해.</p>')+'</section>'+
        '<section><h3>캐릭터 추출 · 자료 통합</h3><label>추출할 원본 캐릭터 또는 저장된 팩<select id="cm-source">'+
        (sources.length?sources.map(renderOption).join(''):'<option value="">다른 봇이 없어</option>')+'</select></label>'+
        (src?'<p class="muted">원본: '+esc(src.name)+' · 로어 '+availableLore.length+'개 / 보유 에셋 '+(asArray(src.additionalAssets).length+asArray(src.emotionImages).length+asArray(src.ccAssets).length)+'개</p>':'')+
        '<label>같은 캐릭터 자료를 합칠 보조 봇</label>'+
        (extraCandidates.length?extraCandidates.map(bot=>'<label class="item"><input type="checkbox" data-cm-extra="'+esc(bot.chaId)+'" '+(extraSourceIds.has(bot.chaId)?'checked':'')+'/>'+
          '<span><b>'+esc(bot.name)+'</b><small>에셋 '+(asArray(bot.additionalAssets).length+asArray(bot.emotionImages).length+asArray(bot.ccAssets).length)+'개 · 로어 '+loreOf(bot).length+'개</small></span></label>').join(''):'<p class="muted">다른 봇이 없어.</p>')+
        '<p class="muted">보조 봇은 같은 캐릭터의 추가 자료로 합쳐져. 이미지 경로가 같으면 중복 등록하지 않아.</p>'+
        '<button type="button" id="cm-extract" class="primary">독립 캐릭터 팩 저장 (채팅 연결 없음)</button>'+
        '<button type="button" id="cm-export">선택한 저장 팩 JSON 내보내기</button>'+
        '<p class="muted">팩은 위 목록에서 [PACK]으로 표시돼. 저장 시 이미지 데이터를 RisuBard 에셋 저장소에 별도 복제하고 검증해. 복제 실패 시 팩은 갱신하지 않아.</p>'+

        '<section><h3>외부 이미지 검색 · Gelbooru</h3>'+
        '<p class="muted">먼저 [PACK] 캐릭터를 선택해. 태그로 검색하고 직접 선택한 일반 등급 이미지만 독립 팩에 복제해. 자동 대량 수집은 하지 않아.</p>'+
        '<label>검색 태그 (예: boa_hancock_(one_piece))<input id="cm-booru-tags" type="text" value="'+esc(externalQuery)+'" placeholder="character_name_(series)"/></label>'+
        '<div class="grid"><label>Gelbooru user_id (필요한 경우)<input id="cm-booru-user" type="text" value="'+esc(externalUserId)+'" autocomplete="off"/></label>'+
        '<label>API key (필요한 경우)<input id="cm-booru-key" type="password" value="'+esc(externalApiKey)+'" autocomplete="off"/></label></div>'+
        '<p class="muted">인증 정보는 플러그인 저장소에 보관하지 않아. 다만 API 요청 URL에 포함되므로 해당 서비스와 네트워크 로그에 기록될 수 있어.</p>'+
        '<div class="top"><button id="cm-booru-search" '+(externalBusy?'disabled':'')+'>태그 검색 · 일반 등급</button>'+
        '<button id="cm-booru-prev" '+(externalPage<=0||externalBusy?'disabled':'')+'>이전 페이지</button>'+
        '<span class="muted">'+(externalPage+1)+'페이지</span>'+
        '<button id="cm-booru-next" '+(externalBusy?'disabled':'')+'>다음 페이지</button></div>'+
        (externalError?'<p class="status">'+esc(externalError)+'</p>':'')+
        (externalNotice?'<p class="status">'+esc(externalNotice)+'</p>':'')+
        '<div class="grid">'+externalResults.map(item=>
          '<label class="item"><input type="checkbox" data-cm-booru-id="'+esc(item.id)+'" '+(externalSelected.has(item.id)?'checked':'')+'/>'+
          '<span style="min-width:0"><img loading="lazy" referrerpolicy="no-referrer" src="'+esc(item.thumbnail||item.image)+'" alt="Post '+esc(item.id)+'" style="width:132px;height:132px;object-fit:contain;display:block;background:#141b28;border-radius:6px"/>'+
          '<small>#'+esc(item.id)+' · '+esc(item.tags.slice(0,6).join(' · '))+'</small>'+
          '<a href="'+esc(item.postURL)+'" target="_blank" rel="noopener noreferrer">원본 게시물·출처 확인</a></span></label>').join('')+
        '</div>'+
        '<p class="muted">저작권과 이용 조건을 확인한 뒤 저장해. 가져온 이미지의 출처와 태그를 유지하며, 채팅에 자동 표시할지는 아래에서 별도로 선택해.</p>'+
        '<button id="cm-booru-import" '+(externalBusy||!sourceId.startsWith('pack:')?'disabled':'')+'>선택한 이미지 팩에 저장 (최대 12개)</button>'+
        '</section>'+

        '<details><summary>선택 사항 · 다른 세계관에 불러올 때의 설정</summary><label>세계관 합성<select id="cm-mode"><option value="adapt" '+(choices.mode==='adapt'?'selected':'')+
        '>A 세계관에 편입 (기본)</option><option value="original" '+(choices.mode==='original'?'selected':'')+
        '>B 원래 출신 유지</option></select></label>'+
        '<label>편입 설정 메모<textarea id="cm-notes" placeholder="예: B는 이 세계의 연금술 길드 소속이다.">'+esc(choices.notes)+'</textarea></label></details></section>'+
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
        check('autoImages','태그 이미지 자동 표시','팩을 채팅에 불러온 뒤 감정이 일치하면 표시 (기본 꺼짐)',choices.autoImages)+
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
        '<p class="status">'+esc(message||'캐릭터를 추출하면 라이브러리에 저장돼. 현재 채팅에는 자동으로 연결하지 않아.')+'</p>'+
        '<details '+(legacyPanelOpen?'open':'')+' id="cm-legacy-panel"><summary>선택 기능 · 저장한 팩을 현재 채팅으로 불러오기 / 이전 연결 관리</summary>'+
        '<p class="muted">이 기능을 사용한 경우에만 현재 채팅에 연결해. 이전 버전에서 편입한 모듈은 자동으로 삭제하지 않아.</p>'+
        '<section><h3>이전 버전에서 현재 채팅에 연결된 항목</h3>'+installedHtml+'</section>'+
        diagnostic+
        '<button id="cm-apply" '+(!src||busy||ctx.libraryOnly?'disabled':'')+'>선택한 캐릭터를 현재 채팅에 명시적으로 불러오기</button></details>'+
        '</main>';
      const el=id=>document.getElementById(id);
      el('cm-close').onclick=()=>{opened=false;void risuai.hideContainer();};
      for(const node of document.querySelectorAll('[data-cm-select-pack]'))node.onclick=()=>{
        sourceId='pack:'+str(node.getAttribute('data-cm-select-pack'));
        loreChoices.clear();moduleChoices.clear();extraSourceIds.clear();void render();
      };
      el('cm-legacy-panel').ontoggle=e=>{legacyPanelOpen=Boolean(e.target.open);};
      el('cm-source').onchange=e=>{sourceId=str(e.target.value);loreChoices.clear();moduleChoices.clear();void render();};
      el('cm-mode').onchange=e=>{choices.mode=str(e.target.value)==='original'?'original':'adapt';void render();};
      el('cm-notes').onchange=e=>{choices.notes=clip(e.target.value,1200);};
      for(const node of document.querySelectorAll('[data-cm-flag]')){
        node.onchange=e=>{choices[node.getAttribute('data-cm-flag')]=Boolean(e.target.checked);};
      }
      for(const node of document.querySelectorAll('[data-cm-extra]')){
        node.onchange=e=>{const id=str(node.getAttribute('data-cm-extra'));
          if(e.target.checked)extraSourceIds.add(id);else extraSourceIds.delete(id);};
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
      el('cm-extract').onclick=()=>void extractPack();
      el('cm-export').onclick=()=>void exportPackJson();
      const tagInput=el('cm-booru-tags'),keyInput=el('cm-booru-key'),userInput=el('cm-booru-user');
      tagInput.oninput=e=>{externalQuery=str(e.target.value).slice(0,200);};
      keyInput.oninput=e=>{externalApiKey=str(e.target.value).slice(0,250);};
      userInput.oninput=e=>{externalUserId=str(e.target.value).slice(0,50);};
      el('cm-booru-search').onclick=()=>{externalPage=0;void searchExternal();};
      el('cm-booru-prev').onclick=()=>{externalPage=Math.max(0,externalPage-1);void searchExternal();};
      el('cm-booru-next').onclick=()=>{externalPage=Math.min(100,externalPage+1);void searchExternal();};
      el('cm-booru-import').onclick=()=>void importExternalImages();
      for(const node of document.querySelectorAll('[data-cm-booru-id]')){
        node.onchange=e=>{
          const id=str(node.getAttribute('data-cm-booru-id'));
          if(e.target.checked)externalSelected.add(id);else externalSelected.delete(id);
        };
      }

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
    await loadPacks();
    try{
      const ctx=await context(true);
      const active=installedInChat(ctx);
      const existing=active.map(metadataOf).find(meta=>meta&&meta.sourceId);
      if(!sourceId&&existing&&(available(ctx.db,ctx.target.chaId).some(bot=>bot.chaId===existing.sourceId)||packLibrary.some(p=>'pack:'+p.id===existing.sourceId))){
        sourceId=existing.sourceId;
        extraSourceIds=new Set(asArray(existing.sourceIds).filter(id=>id!==sourceId));
      }
    }catch(error){console.log('[CharacterMixer] pack selection restore fallback:',error?.message||error);}
    await render();
    await risuai.showContainer('fullscreen');
  }
  // Register the settings entry first. An optional display hook failure must
  // never make the entire Character Mixer disappear from the UI.
  await risuai.registerSetting(NAME,open,'🧩','html','character-mixer-settings');
  try{
    await risuai.registerButton({name:NAME,icon:'🧩',iconType:'html',location:'hamburger',
      id:'character-mixer-hamburger'},open);
  }catch(error){console.log('[CharacterMixer] optional menu button unavailable',error);}
  let displayHandler=typeof risuai.addRisuScriptHandler==='function'
    ? async content=>displayAssetCompatibility(content):null;
  if(displayHandler){
    try{
      // RisuBard API v3 uses 'display', not 'editdisplay'.
      await risuai.addRisuScriptHandler('display',displayHandler);
    }catch(error){
      console.warn('[CharacterMixer] display compatibility unavailable; UI remains accessible:',error);
      displayHandler=null;
    }
  }
  await risuai.onUnload(async()=>{
    destroyed=true;opened=false;
    if(displayHandler&&typeof risuai.removeRisuScriptHandler==='function'){
      try{await risuai.removeRisuScriptHandler('display',displayHandler);}
      catch(error){console.warn('[CharacterMixer] display hook cleanup:',error);}
    }
  });
})();
