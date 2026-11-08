//@name character_mixer
//@display-name Character Mixer
//@api 3.0
//@version 0.9.0
//@update-url https://raw.githubusercontent.com/pjb3181-prog/support-my-task/main/risubard-updates/character_mixer.js
//@description Character packs, automatic scene images, Gelbooru downloader credential import and image feedback.
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
  let externalBusy=false,externalError='',externalNotice='',speakerAliasInput='';
  let characterKindChoice='unknown',characterWorkInput='';
  const AUTO_PREF_KEY='character_mixer_auto_assets_v1';
  const DISPLAY_KEY='character_mixer_display_history_v1';
  const AUTH_KEY='character_mixer_gelbooru_auth_v1';
  const DENSITY_STORE='character_mixer_density_v1';
  const DENSITY_PRESETS={
    low:{maxAssetsPerReply:1,minReplyGap:4,recentDuplicateWindow:6,reuseAfterReplies:15,autoCollectMaxPerRun:1,searchCandidatePool:4,minimumLocalAssets:1},
    normal:{maxAssetsPerReply:1,minReplyGap:3,recentDuplicateWindow:5,reuseAfterReplies:12,autoCollectMaxPerRun:1,searchCandidatePool:5,minimumLocalAssets:2},
    high:{maxAssetsPerReply:2,minReplyGap:1,recentDuplicateWindow:3,reuseAfterReplies:6,autoCollectMaxPerRun:2,searchCandidatePool:8,minimumLocalAssets:3},
    aggressive:{maxAssetsPerReply:3,minReplyGap:0,recentDuplicateWindow:1,reuseAfterReplies:3,autoCollectMaxPerRun:3,searchCandidatePool:12,minimumLocalAssets:4}
  };
  const DENSITY_DEFAULT={displayPreset:'high',...DENSITY_PRESETS.high,skipIfEnoughAssets:true,assetUsageHint:''};
  let densitySettings={...DENSITY_DEFAULT};
  const bounded=(v,lo,hi,fallback)=>Number.isFinite(Number(v))?Math.min(hi,Math.max(lo,Math.round(Number(v)))):fallback;
  function normalizeDensity(input){
    const raw=input&&typeof input==='object'?input:{};
    const preset=['low','normal','high','aggressive','custom'].includes(raw.displayPreset)?raw.displayPreset:'high';
    const merged={...DENSITY_DEFAULT,...raw,...(preset==='custom'?{}:DENSITY_PRESETS[preset]),displayPreset:preset};
    for(const [key,lo,hi] of [['maxAssetsPerReply',0,5],['minReplyGap',0,10],
      ['recentDuplicateWindow',0,20],['reuseAfterReplies',0,50],['autoCollectMaxPerRun',1,5],
      ['searchCandidatePool',3,20],['minimumLocalAssets',0,20]]){
      merged[key]=bounded(merged[key],lo,hi,DENSITY_DEFAULT[key]);
    }
    merged.skipIfEnoughAssets=merged.skipIfEnoughAssets!==false;
    merged.assetUsageHint=String(merged.assetUsageHint||'').slice(0,500);
    return merged;
  }
  async function loadDensitySettings(){
    try{densitySettings=normalizeDensity(await risuai.pluginStorage.getItem(DENSITY_STORE));}
    catch(error){densitySettings={...DENSITY_DEFAULT};console.warn('[CharacterMixer] density settings load failed',error);}
  }
  async function saveDensitySettings(){
    densitySettings=normalizeDensity(densitySettings);
    await risuai.pluginStorage.setItem(DENSITY_STORE,densitySettings);
  }
  // Optional, bounded natural-language shortcuts; no prompt injections or LLM calls.
  function parseAssetHint(hint){
    const t=String(hint||'').slice(0,500);
    const result={};
    const max=t.match(/(?:답변당|한\s*답변(?:에|당)?)\s*(?:최대\s*)?(\d)\s*장/);
    const collect=t.match(/(?:수집|저장|검색(?:당|마다))\s*(?:최대\s*)?(\d)\s*장/);
    const gap=t.match(/(?:간격|띄우기)\s*(\d{1,2})\s*(?:턴|답변|회)/);
    if(max)result.maxAssetsPerReply=bounded(max[1],0,5,2);
    if(collect)result.autoCollectMaxPerRun=bounded(collect[1],1,5,2);
    if(gap)result.minReplyGap=bounded(gap[1],0,10,1);
    if(/적극적|넉넉히|많이\s*보여|자주\s*보여/.test(t))Object.assign(result,{...DENSITY_PRESETS.high,...result});
    if(/아주\s*적게|최소한만|이미지\s*줄여/.test(t))Object.assign(result,{...DENSITY_PRESETS.low,...result});
    return result;
  }
  let displayHistory={};
  let autoCollectEnabled=true,autoCollectStatus='',autoCollectBusy=false;
  let externalProviderStatus='',authFailureCount=0,authStatus='Gelbooru 인증 정보 미등록';
  const LOCAL_BRIDGE='http://127.0.0.1:18765';
  let localBridgeActive=false,localBridgeStatus='로컬 Python 브리지 연결 확인 전';
  async function localBridgeRequest(route,payload){
    // Fixed loopback host and fixed routes: never allow an arbitrary URL proxy.
    if(route!=='search'&&route!=='image')throw Error('Bridge route not allowed');
    const response=await risuai.nativeFetch(LOCAL_BRIDGE+'/'+route,{
      method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)
    });
    if(!response?.ok){
      let category='HTTP '+str(response?.status||'unknown');
      try{const data=await response.json();if(data?.error&&/^[a-zA-Z0-9 ()-]{1,120}$/.test(data.error))
        category+=' ('+data.error+')';}catch(_){}
      throw Error('Python bridge '+category);
    }
    return response;
  }
  async function pingLocalBridge(){
    try{
      const response=await risuai.nativeFetch(LOCAL_BRIDGE+'/health',{method:'GET'});
      if(!response?.ok)throw Error('HTTP '+str(response?.status));
      const data=await response.json();
      if(data?.service!=='CharacterMixerBridge'||data?.ok!==true)throw Error('서비스 응답 불일치');
      localBridgeActive=true;
      localBridgeStatus='로컬 Python 이미지 브리지 연결됨';
      return true;
    }catch(e){
      localBridgeActive=false;
      localBridgeStatus='로컬 브리지 미연결 · start_character_mixer_bridge.cmd 실행 필요 ('+
        clip(e?.message||e,100)+')';
      return false;
    }
  }
  async function testLocalBridge(){await pingLocalBridge();await render();}
  async function searchViaLocalBridge(tags,limit,page){
    const response=await localBridgeRequest('search',{
      tags:[...tags.filter(x=>!x.startsWith('rating:')),'rating:general'].join(' '),
      limit,page,userId:externalUserId.trim(),apiKey:externalApiKey.trim()
    });
    const raw=await response.json();
    const posts=parseBooruPosts(raw);
    localBridgeActive=true;
    localBridgeStatus='Python 브리지 검색 성공 ('+posts.length+'건)';
    externalProviderStatus='로컬 Python 브리지 · Gelbooru ('+posts.length+'건)';
    return posts;
  }
  async function fetchViaLocalBridge(url,limit){
    const response=await localBridgeRequest('image',{url});
    const declared=Number(response.headers?.get?.('content-length')||0);
    if(declared>limit)throw Error('브리지 이미지가 용량 제한 초과');
    const bytes=new Uint8Array(await response.arrayBuffer());
    const ext=imageMagic(bytes);
    if(!ext||bytes.byteLength>limit)throw Error('브리지 응답이 이미지가 아니거나 용량 초과');
    localBridgeActive=true;
    return {bytes,ext,url};
  }
  let rejectedPosts={},lastDiscovery=new Map(),discoveryRun=new Set();
  let latestShown=null,reviewFirst=false;
  let outputListenerAvailable=false,outputEventCount=0,outputLastResult='아직 생성 완료 이벤트를 받지 못함';
  let outputListener=null;
  const bootstrapBusy=new Set();
  const externalSelected=new Set();
  const PROFILE_LIMIT=6000, LORE_LIMIT=30000;
  let destroyed=false, busy=false, opened=false, message='', sourceId='';
  let choices={mode:'adapt',notes:'',description:true,personality:true,scenario:false,
    examples:false,greeting:false,assets:true,emotions:true,moduleAssets:true,moduleLore:false,autoImages:true};
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
  // Distinguish character-faithful fanwork images from scene-first OC images.
  // A saved OC pack may contain unrelated source characters; never require a
  // Gelbooru character tag for those, only sufficiently matching scene tags.
  function sceneTagSignals(text){
    const rules=[
      [['crying','tears','sad'],/(?:울었|눈물|흐느꼈|서럽|crying|tears|sobbed)/i,3],
      [['angry','frown','annoyed'],/(?:화가|짜증|화를 냈|분노|인상을 찌푸|angry|furious|annoyed)/i,3],
      [['blush','embarrassed','shy'],/(?:얼굴이 붉|볼이 붉|귀가 붉|부끄러|당황|blush|embarrass|shy)/i,3],
      [['surprised','wide_eyes','open_mouth'],/(?:놀랐|깜짝|눈이 커|경악|surpris|shock)/i,3],
      [['smile','happy','laughing','grin'],/(?:웃었|웃음|미소|싱긋|빙긋|smil|laugh|grin)/i,3],
      [['sad','downcast_eyes'],/(?:슬픔|우울|풀이 죽|sad|depress)/i,3],
      [['sitting','seated'],/(?:앉았|앉아|의자|sitting|seated)/i,2],
      [['standing'],/(?:일어섰|서 있|일어서|standing)/i,2],
      [['lying','on_bed'],/(?:누웠|누워|침대|lying|on.bed)/i,2],
      [['walking'],/(?:걷|걸어|산책|walking)/i,2],
      [['school_uniform','uniform'],/(?:교복|school uniform)/i,2],
      [['dress'],/(?:드레스|원피스|dress)/i,2],
      [['kimono'],/(?:기모노|kimono)/i,2],
      [['swimsuit'],/(?:수영복|swimsuit)/i,2],
      [['convenience_store','shop'],/(?:편의점|convenience.store)/i,3],
      [['supermarket','grocery_store','shop'],/(?:마트|슈퍼마켓|슈퍼에서|supermarket|grocery.store)/i,3],
      [['restaurant','dining'],/(?:식당|음식점|레스토랑|restaurant)/i,3],
      [['cafe','coffee_shop'],/(?:카페|커피숍|coffee.shop|cafe)/i,3],
      [['classroom','school'],/(?:교실|수업 시간|칠판|classroom)/i,3],
      [['bedroom','indoors'],/(?:침실|원룸|자취방|침대 옆|bedroom)/i,3],
      [['kitchen','cooking'],/(?:부엌|주방|요리하|조리대|kitchen|cooking)/i,3],
      [['eating','food'],/(?:밥을 먹|식사를 하|음식을 먹|먹기 시작|식탁|eating|having.lunch)/i,3],
      [['entrance','door'],/(?:현관|문을 열|문 앞|entrance)/i,2],
      [['indoors'],/(?:실내|방 안|방에서|가게 안|inside|indoors)/i,1],
      [['outdoors'],/(?:실외|거리|길거리|공원|바깥|outside|outdoors)/i,1],
      [['night'],/(?:한밤|밤하늘|밤거리|야밤|night)/i,1],
      [['day'],/(?:대낮|한낮|햇살|낮 시간|daytime)/i,1]
    ];
    const hits=[];
    for(const [tags,regex,weight] of rules)
      if(regex.test(text))hits.push({tags,weight});
    return hits;
  }
  function pickTaggedAsset(content,cached,excludedNames=new Set()){
    if(!cached?.tagAssets?.length||/\{\{\s*(?:img|image|asset|emotion)\s*(?:::|=)/i.test(content))return '';
    if(content.length>40000||content.length<40)return '';
    const window=sanitizeSceneText(content).slice(-14000);
    if(!window)return '';
    let latest=null;
    for(const item of cached.tagAssets){
      for(const name of asArray(item.characterAliases).filter(Boolean)){
        const escaped=str(name).replace(/[^a-zA-Z0-9가-힣_]/g,ch=>'\\'+ch);
        const pattern=new RegExp('\\['+escaped+'\\]','g');
        let match;
        while((match=pattern.exec(window))){
          if(!latest||match.index>latest.index)latest={sourceId:item.sourceId,index:match.index};
        }
      }
    }
    // Only one OC pack may fall back to a speaker-less scene. Multiple active
    // packs without explicit speaker mapping are ambiguous; show no image.
    let selectedSource=latest?.sourceId;
    if(!selectedSource){
      const candidates=[...new Set(cached.tagAssets.filter(x=>x.characterKind==='original').map(x=>x.sourceId))];
      if(candidates.length!==1)return '';
      selectedSource=candidates[0];
    }
    const candidates=cached.tagAssets.filter(x=>x.sourceId===selectedSource);
    if(!candidates.length)return '';
    const kind=candidates[0].characterKind;
    if(kind!=='original'&&kind!=='fanwork')return '';
    let excerpt=latest?window.slice(latest.index,Math.min(window.length,latest.index+1200)):window.slice(-1200);
    if(latest){
      const boundary=excerpt.slice(1).search(/\n\[[^\]\n]{1,80}\]/);
      if(boundary>=0)excerpt=excerpt.slice(0,boundary+1);
    }
    const signals=sceneTagSignals(excerpt);
    if(!signals.length)return '';
    // A fanwork pack uses only the leading emotion signal, preserving v0.6.0
    // behavior. OC packs may match clothing, action, and setting as well.
    const effective=kind==='original'?signals:signals.filter(x=>x.weight===3).slice(0,1);
    if(!effective.length)return '';
    let winner=null,best=0;
    for(const item of candidates){
      if(excludedNames.has(item.name))continue;
      const tags=new Set(asArray(item.tags));
      let score=0;
      for(const signal of effective){
        if(signal.tags.some(t=>tags.has(t)))score+=signal.weight;
      }
      if(score>best){best=score;winner=item;}
    }
    // A strong expression, or posture plus environment, is required.
    const min=3;
    return winner&&best>=min?'{{img::'+winner.name+'}}':'';
  }
  function pickTaggedAssets(content,cached,excludedNames=new Set(),limit=1){
    const found=[],excluded=new Set(excludedNames);
    for(let i=0;i<bounded(limit,0,5,1);i++){
      const token=pickTaggedAsset(content,cached,excluded);
      if(!token)break;
      const name=token.match(/^\{\{img::([^}]+)\}\}$/)?.[1];
      if(!name||excluded.has(name))break;
      excluded.add(name);
      found.push(name);
    }
    return found;
  }
  function contentFingerprint(value){
    // Keep only a compact hash; do not retain chat text in plugin storage.
    let h=2166136261;
    const strValue=str(value);
    for(let i=0;i<strValue.length;i++){h^=strValue.charCodeAt(i);h=Math.imul(h,16777619)>>>0;}
    return h.toString(36);
  }
  function currentDisplayDecision(ctx,content){
    const turns=asArray(ctx.chat?.message).filter(x=>['char','assistant'].includes(str(x?.role)));
    const last=turns.at(-1);
    const raw=str(last?.data).trim();
    // Never inject a new image into previously rendered messages or user text.
    if(raw.length<40||!content.includes(raw.slice(0,Math.min(90,raw.length))))return null;
    const turn=turns.length-1;
    const key=str(ctx.chat.id)+'|'+ctx.ci+'|'+ctx.ti;
    const signature=str(turn)+'|'+str(raw.length)+'|'+contentFingerprint(raw);
    const previous=displayHistory[key]||{lastShownTurn:-100,recent:[]};
    const row=turn<previous.lastShownTurn?{lastShownTurn:-100,recent:[]}:previous;
    return {key,signature,turn,row,
      sameMessage:row.messageKey===signature,
      canShow:turn-row.lastShownTurn>=densitySettings.minReplyGap};
  }
  function recordDisplayedImages(decision,assetNames){
    const names=[...new Set(asArray(assetNames).filter(Boolean))];
    if(!names.length)return;
    const old=asArray(decision.row.recent).filter(x=>{
      const name=typeof x==='string'?x:x?.name;
      const turn=typeof x==='string'?decision.turn:Number(x?.turn);
      return !names.includes(name)&&Number.isFinite(turn)&&
        decision.turn-turn<densitySettings.reuseAfterReplies;
    });
    const additions=names.map(name=>({name,turn:decision.turn}));
    const recent=[...old,...additions].slice(-Math.max(1,densitySettings.recentDuplicateWindow,5));
    displayHistory[decision.key]={lastShownTurn:decision.turn,
      messageKey:decision.signature,lastAsset:names.at(-1),lastAssets:names,recent};
    void saveDisplayHistory().catch(e=>console.warn('[CharacterMixer] display history save failed',e));
  }
  function recordDisplayedImage(decision,assetName){recordDisplayedImages(decision,[assetName]);}
  function rememberFeedback(assetName){
    for(const [key,row] of Object.entries(displayHistory)){
      if(!row||typeof row!=='object')continue;
      const shown=asArray(row.lastAssets).length?row.lastAssets:[row.lastAsset].filter(Boolean);
      const remaining=shown.filter(x=>x!==assetName);
      const recent=asArray(row.recent).filter(x=>(typeof x==='string'?x:x?.name)!==assetName);
      // Preserve the existing message key to avoid inserting a replacement
      // in the middle of a completed, already-read reply.
      displayHistory[key]={...row,lastAssets:remaining,lastAsset:remaining.at(-1)||'',recent};
    }
    void saveDisplayHistory().catch(e=>console.warn('[CharacterMixer] feedback history save failed',e));
  }
  async function displayAssetCompatibility(content){
    if(destroyed||typeof content!=='string')return content;
    const hasAssetTag=/\{\{\s*(?:img|image|asset|emotion|raw|path|video|audio|bgm|bg|video-img)\s*(?:::|=)/i.test(content);
    if(!hasAssetTag&&!/\[[^\]\n]{1,80}\]/.test(content)&&!autoCollectEnabled)return content;
    try{
      const ctx=await context();
      const now=Date.now();
      let cached=displayCache;
      if(!cached||cached.ci!==ctx.ci||cached.ti!==ctx.ti||now-cached.at>ALIAS_CACHE_MS){
        const aliases=activeAliases(ctx);
        const tagAssets=[];
        for(const mod of aliases.active){
          const metadata=metadataOf(mod);
          if(metadata?.autoImages!==true&&!autoCollectEnabled)continue;
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
      const omitted=new Set(Object.keys(rejectedPosts).filter(k=>rejectedPosts[k]).map(k=>'gelbooru_'+k.slice(9)));
      const safe=rewritten.replace(/\{\{img::(gelbooru_(?:db_)?\d+)\}\}/g,(token,name)=>omitted.has(name)?'':token);
      const decision=currentDisplayDecision(ctx,safe);
      if(!decision)return safe;
      // Preserve images already written explicitly in the chat; never append
      // a second automatic image on top of a pre-existing image tag.
      if(hasAssetTag)return safe;
      // Stable repeated renders of the same assistant reply must not add extra
      // images, advance the cooldown or launch duplicate external searches.
      const previous=decision.sameMessage?
        (asArray(decision.row.lastAssets).length?decision.row.lastAssets:
          [decision.row.lastAsset].filter(Boolean)):[];
      const usablePrevious=previous.filter(name=>!omitted.has(name)&&cached.tagAssets.some(x=>x.name===name));
      if(decision.sameMessage)return usablePrevious.length?
        safe+'\n\n'+usablePrevious.map(name=>'{{img::'+name+'}}').join('\n\n'):safe;
      if(!decision.canShow||densitySettings.maxAssetsPerReply===0)return safe;
      const recent=new Set((densitySettings.recentDuplicateWindow===0?[]:
        asArray(decision.row.recent).slice(-densitySettings.recentDuplicateWindow))
        .filter(x=>{
          const turn=typeof x==='string'?decision.turn:Number(x?.turn);
          return Number.isFinite(turn)&&decision.turn-turn<densitySettings.reuseAfterReplies;
        }).map(x=>typeof x==='string'?x:x.name));
      const selected=pickTaggedAssets(safe,
        {...cached,tagAssets:cached.tagAssets.filter(x=>!omitted.has(x.name))},
        recent,densitySettings.maxAssetsPerReply);
      if(selected.length){
        recordDisplayedImages(decision,selected);
        for(const assetName of selected){
          const row=cached.tagAssets.find(x=>x.name===assetName);
          const pack=packLibrary.find(p=>'pack:'+p.id===row?.sourceId);
          const external=asArray(pack?.externalAssets).find(x=>x.name===assetName);
          if(pack&&external&&!isRejected(external.postId))
            latestShown={packId:pack.id,postId:str(external.postId),assetName,
              chatIndex:ctx.ti,characterIndex:ctx.ci};
        }
        return safe+'\n\n'+selected.map(name=>'{{img::'+name+'}}').join('\n\n');
      }
      if(autoCollectEnabled&&!destroyed){
        // A normal reply is returned immediately; remote fetch is optional.
        void discoverForScene(safe,ctx).catch(e=>console.warn('[CharacterMixer] discovery',e));
      }
      return safe;
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
          characterName:clip(pack.name,100),characterAliases:[clip(pack.name,100),...asArray(pack.speakerAliases)].filter(Boolean),sourceId:bot.chaId,
          characterKind:['original','fanwork'].includes(pack.characterKind)?pack.characterKind:'unknown'});
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
  async function loadAutoPrefs(){
    try{const p=await risuai.pluginStorage.getItem(AUTO_PREF_KEY);
      autoCollectEnabled=p?.enabled!==false;
      rejectedPosts=p&&typeof p.rejected==='object'&&p.rejected? p.rejected:{};
    }catch(e){autoCollectStatus='자동 에셋 설정 읽기 실패: '+str(e?.message||e);}
  }
  async function saveAutoPrefs(){await risuai.pluginStorage.setItem(AUTO_PREF_KEY,{enabled:autoCollectEnabled,rejected:rejectedPosts});}
  async function loadGelbooruAuth(){
    try{
      const saved=await risuai.pluginStorage.getItem(AUTH_KEY);
      if(saved&&typeof saved.userId==='string'&&typeof saved.apiKey==='string'){
        externalUserId=saved.userId;externalApiKey=saved.apiKey;
        authStatus='Gelbooru 인증 정보 로드됨 · 연결 테스트 필요';
      }
    }catch(e){authStatus='인증 정보 읽기 실패: '+clip(e?.message||e,100);}
  }
  async function saveGelbooruAuth(){
    if(!externalUserId.trim()||!externalApiKey.trim())throw Error('user_id와 API 키 둘 다 필요해');
    await risuai.pluginStorage.setItem(AUTH_KEY,{userId:externalUserId.trim(),apiKey:externalApiKey.trim()});
    authStatus='기존 Gelbooru 계정 정보 저장됨 · 연결 테스트 필요';
    lastDiscovery.clear();
  }
  async function clearGelbooruAuth(){
    externalUserId='';externalApiKey='';
    await risuai.pluginStorage.setItem(AUTH_KEY,null);
    authStatus='Gelbooru 인증 정보 삭제됨';
    await render();
  }
  function readDownloaderCredentials(source){
    // Parse only literal CONFIG assignments. Never run arbitrary Python code.
    const match=String(source).match(/\bCONFIG\s*=\s*\{([\s\S]*?)\n\s*\}/);
    if(!match)throw Error('gelbooru.py의 CONFIG 설정을 찾지 못했어');
    const extract=key=>{
      const line=match[1].split(/\r?\n/).find(x=>new RegExp('^[\\s]*["\\\']'+key+'["\\\']\\s*:').test(x));
      const m=line?.match(/:\s*(["\'])([^"\'\r\n]+)\1/);
      return m?m[2]:'';
    };
    const userId=extract('USER_ID'),apiKey=extract('API_KEY');
    if(!/^\d{1,20}$/.test(userId)||!(/^[a-zA-Z0-9]{32,256}$/.test(apiKey)))
      throw Error('다운로더에서 유효한 USER_ID/API_KEY 설정을 찾지 못했어');
    return {userId,apiKey};
  }
  async function importDownloaderFile(input){
    try{
      const file=input?.files?.[0];
      if(!file)throw Error('gelbooru.py 파일을 선택해');
      if(file.size>3*1024*1024)throw Error('설정 파일 크기 제한 초과');
      const content=await file.text();
      const credentials=readDownloaderCredentials(content);
      externalUserId=credentials.userId;
      externalApiKey=credentials.apiKey;
      await saveGelbooruAuth();
      authStatus='gelbooru.py에서 기존 계정 정보를 가져왔어 · 이제 인증 테스트 가능';
    }catch(e){authStatus='다운로더 설정 가져오기 실패: '+clip(e?.message||e,130);}
    await render();
  }
  async function testGelbooruAuth(){
    try{
      if(!externalUserId.trim()||!externalApiKey.trim())throw Error('먼저 gelbooru.py를 가져와');
      const params=new URLSearchParams({page:'dapi',s:'post',q:'index',json:'1',limit:'1',
        tags:'smile rating:general',user_id:externalUserId.trim(),api_key:externalApiKey.trim()});
      const res=await risuai.nativeFetch('https://gelbooru.com/index.php?'+params.toString(),{method:'GET'});
      if(!res?.ok)throw Error(await describeBooruFailure(res));
      await readBooruJson(res,'Gelbooru');
      authStatus='Gelbooru 인증 성공 · 자동 수집 사용 가능';
      externalProviderStatus='Gelbooru 인증 성공';
      lastDiscovery.clear();
    }catch(e){authStatus='인증 테스트 실패: '+clip(e?.message||e,110)+' · 네트워크 차단 여부도 확인 필요';}
    await render();
  }
  async function loadDisplayHistory(){
    try{const data=await risuai.pluginStorage.getItem(DISPLAY_KEY);
      displayHistory=data&&typeof data==='object'&&!Array.isArray(data)?data:{};
    }catch(e){displayHistory={};console.warn('[CharacterMixer] display history unavailable',e);}
  }
  async function saveDisplayHistory(){
    const entries=Object.entries(displayHistory).slice(-200);
    displayHistory=Object.fromEntries(entries);
    await risuai.pluginStorage.setItem(DISPLAY_KEY,displayHistory);
  }
  // Classify from source provenance, not a name-only lookup. A name such as
  // "가영" can describe either an OC or a character from Inuyasha.
  function inferCharacterIdentity(bot,lores=[]){
    const parts=[str(bot?.name),str(bot?.desc),str(bot?.personality),
      str(bot?.scenario),str(bot?.firstMessage),
      ...asArray(lores).slice(0,80).map(x=>str(x?.content))];
    const text=parts.join('\n').slice(0,30000);
    const lines=text.split(/\n/).map(x=>x.trim()).filter(Boolean);
    const evidence=[];
    let work='',fanScore=0,originalScore=0;
    const originalRule=/(?:오리지널\s*(?:캐릭터|인물|자캐)|자작\s*(?:캐릭터|인물)|창작\s*(?:캐릭터|인물)|original\s*character|\bOC\s*(?:character|profile)\b|비공식\s*자작\s*캐릭터)/i;
    const workRule=/^(?:[-*#]\s*)?(?:원작|원작명|작품명|출전|소속\s*작품|프랜차이즈|fandom|franchise|copyright|source\s*series|series\s*name)\s*[:：]\s*(.+)$/i;
    const explicitFan=/(?:원작\s*캐릭터|공식\s*캐릭터|2차\s*창작|팬\s*캐릭터|fanfiction|fanwork)/i;
    for(const line of lines){
      if(originalRule.test(line)){originalScore+=5;evidence.push('오리지널 명시: '+clip(line,105));}
      const m=line.match(workRule);
      if(m){
        const candidate=clip(m[1].split(/[|;]/)[0],80);
        if(candidate&&!/^(?:없음|무|none|n\/a|original|오리지널|자체\s*세계관)$/i.test(candidate)){
          work=candidate;fanScore+=6;
          evidence.push('원작 필드: '+clip(line,120));
        }else if(candidate){originalScore+=5;evidence.push('원작 없음 명시: '+clip(line,100));}
      }
      if(explicitFan.test(line)){fanScore+=3;evidence.push('2차창작 언급: '+clip(line,105));}
    }
    const titleMatch=str(bot?.name).match(/[([]([^)\]]{2,80})[)\]]\s*$/);
    if(titleMatch&&!work&&!/^(?:oc|original|오리지널)$/i.test(titleMatch[1])){
      // A title suffix is a clue, never sufficient by itself.
      work=titleMatch[1];fanScore+=2;
      evidence.push('이름의 작품명 후보: '+clip(titleMatch[1],80));
    }
    let kind='unknown';
    if(fanScore>=6&&fanScore>originalScore+2)kind='fanwork';
    if(originalScore>=5&&originalScore>fanScore+2)kind='original';
    if(originalScore>=5&&fanScore>=5)kind='unknown';
    return {kind,work:kind==='fanwork'?work:'',confidence:kind==='unknown'?'low':(Math.max(fanScore,originalScore)>=10?'high':'medium'),
      evidence:evidence.slice(0,6),scores:{fanwork:fanScore,original:originalScore},method:'source-metadata-v1'};
  }
  async function externalIdentityCandidates(name){
    // Gelbooru tag metadata can corroborate a source, but a same-name tag
    // cannot prove that an arbitrary custom character is that fandom character.
    const raw=str(name).replace(/\s*[([][^)\]]+[)\]]\s*$/,'').trim();
    const search=raw.toLowerCase().replace(/\s+/g,'_').replace(/[^a-z0-9_]/g,'');
    if(search.length<3||typeof risuai.nativeFetch!=='function')return [];
    const params=new URLSearchParams({page:'dapi',s:'tag',q:'index',json:'1',
      limit:'16',name_pattern:'%'+search+'%'});
    if(externalApiKey.trim()&&externalUserId.trim()){
      params.set('api_key',externalApiKey.trim());params.set('user_id',externalUserId.trim());
    }
    const response=await risuai.nativeFetch('https://gelbooru.com/index.php?'+params.toString(),{method:'GET'});
    if(!response?.ok)throw Error('외부 태그 조회 응답 '+str(response?.status));
    const body=await readBooruJson(response,'Gelbooru');
    const rows=Array.isArray(body)?body:asArray(body?.tag);
    return rows.filter(x=>Number(x?.type??x?.category)===4)
      .map(x=>({tag:clip(x.name,120),count:Number(x.count)||0}))
      .filter(x=>x.tag.toLowerCase().includes(search)).slice(0,10);
  }
  async function detectIdentityFromSources(bot,lores=[]){
    const result=inferCharacterIdentity(bot,lores);
    let candidates=[];
    try{candidates=await externalIdentityCandidates(bot?.name);}
    catch(e){result.externalLookupError=clip(e?.message||e,120);}
    result.externalCandidates=candidates;
    // Candidate tags are suggestions unless paired with an explicit source
    // reference. Even 1000 exact-name Gelbooru matches cannot classify an OC.
    const hintedWork=result.work||str(bot?.name).match(/[([]([^)]{2,80})[)\]]\s*$/)?.[1]||'';
    const normalized=str(hintedWork).toLowerCase().replace(/\s+/g,'_').replace(/[^a-z0-9_]/g,'');
    const corroborated=normalized&&candidates.some(x=>x.tag.toLowerCase().includes(normalized));
    if(corroborated&&result.scores.original===0&&result.scores.fanwork>=2){
      // Character + named work together corroborate a structured title clue.
      result.kind='fanwork';
      result.confidence='high';
      result.work=hintedWork;
      result.evidence.push('Gelbooru 캐릭터·작품 태그 확인');
    }
    return result;
  }
  async function autoIdentifyPack(){
    if(busy)return;
    busy=true;
    try{
      const pack=externalTarget();
      const prediction=await detectIdentityFromSources(pack.snapshot,loreOf(pack.snapshot));
      const old=packLibrary;
      const record={...pack,characterKind:prediction.kind,
        originalWork:prediction.work,identityEvidence:prediction,identitySource:'auto'};
      packLibrary=packLibrary.map(p=>p.id===pack.id?record:p);
      try{await savePacks();}catch(e){packLibrary=old;throw e;}
      externalNotice=prediction.kind==='unknown'
        ?'원본 설정만으로 확정 어려움 · 외부 캐릭터 태그 후보 '+asArray(prediction.externalCandidates).map(x=>x.tag).slice(0,3).join(', ')+' · 미분류 유지.'
        :'자동 판별: '+(prediction.kind==='original'?'오리지널':'2차창작')+
          (prediction.work?' / '+prediction.work:'')+' · '+prediction.evidence.join(' / ');
      invalidateDisplayCache();
    }catch(e){externalError=str(e?.message||e);}
    finally{busy=false;await render();}
  }
  async function saveCharacterKind(){
    try{
      const pack=externalTarget();
      const kind=['original','fanwork'].includes(characterKindChoice)?characterKindChoice:'unknown';
      const before=packLibrary;
      packLibrary=packLibrary.map(p=>p.id===pack.id?{...p,characterKind:kind,originalWork:kind==='fanwork'?clip(characterWorkInput,120):'',identitySource:'manual'}:p);
      try{await savePacks();}catch(e){packLibrary=before;throw e;}
      externalNotice=kind==='original'
        ?'오리지널로 저장 · 장면 태그 중심으로 이미지를 선택해'
        :kind==='fanwork'?'2차창작으로 저장 · 원작과 캐릭터 확인 후 이미지를 선택해'
        :'미분류로 저장 · 자동 이미지 표시는 보류돼';
      invalidateDisplayCache();
    }catch(e){externalError=str(e?.message||e);}
    await render();
  }
  async function saveSpeakerAliases(){
    try{
      const pack=externalTarget();
      const aliases=[...new Set(str(speakerAliasInput).split(',').map(x=>x.trim()).filter(Boolean))].slice(0,12);
      const old=packLibrary;
      packLibrary=packLibrary.map(p=>p.id===pack.id?{...p,speakerAliases:aliases}:p);
      try{await savePacks();}catch(e){packLibrary=old;throw e;}
      externalNotice='채팅 이름 태그 '+aliases.length+'개 저장 · 실제 채팅에 적용된 팩은 다시 불러와야 반영돼';
    }catch(e){externalError=str(e?.message||e);}
    await render();
  }
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
    // Plugin RPC transfers Uint8Array buffers and detaches the sent view.
    // Keep raw for post-save verification; transfer only a separate copy.
    const stored=await risuai.saveAsset(new Uint8Array(raw));
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
      const identity=previous?.identitySource==='manual'
        ?null:await detectIdentityFromSources(src,lores);
      const record={id,name:src.name,updatedAt:Date.now(),
        sources:bots.map(b=>({id:b.chaId,name:b.name})),binaryCopied:true,assetCount:assets.length,
        characterKind:previous?.identitySource==='manual'?previous.characterKind:(identity?.kind||'unknown'),
        originalWork:previous?.identitySource==='manual'?str(previous?.originalWork||''):str(identity?.work||''),
        identitySource:previous?.identitySource==='manual'?'manual':'auto',
        identityEvidence:previous?.identitySource==='manual'?previous?.identityEvidence:identity,
        speakerAliases:asArray(previous?.speakerAliases),
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
  function safeBooruMediaURL(value){
    try{
      const u=new URL(str(value));
      if(u.protocol!=='https:')return '';
      const allowed=/(^|\.)gelbooru\.com$/i.test(u.hostname)||
        /(^|\.)donmai\.us$/i.test(u.hostname);
      if(!allowed||!/\.(?:png|jpe?g|gif|webp)(?:$|\?)/i.test(u.pathname+u.search))return '';
      return u.href;
    }catch(_){return '';}
  }
  // Retain older renderer and settings references.
  function gelbooruMediaURL(value){return safeBooruMediaURL(value);}
  function booruTags(row){
    const raw=Array.isArray(row?.tags)?row.tags:typeof row?.tags==='string'?row.tags.split(/\s+/):[];
    return [...new Set(raw.map(x=>str(x).toLowerCase()).filter(Boolean))].slice(0,200);
  }
  function parseBooruPosts(data){
    const list=Array.isArray(data)?data:Array.isArray(data?.post)?data.post:[];
    return list.filter(x=>x&&Number.isFinite(Number(x.id)))
      .filter(x=>['general','safe','s','g'].includes(str(x.rating).toLowerCase()))
      .map(row=>({
        id:String(row.id),provider:'gelbooru',tags:booruTags(row),rating:row.rating,
        thumbnail:safeBooruMediaURL(row.preview_url||row.sample_url||row.file_url),
        sample:safeBooruMediaURL(row.sample_url||row.preview_url),
        image:safeBooruMediaURL(row.file_url||row.sample_url),
        source:clip(row.source||'',500),
        postURL:'https://gelbooru.com/index.php?page=post&s=view&id='+encodeURIComponent(String(row.id))
      })).filter(row=>row.image);
  }
  function parseDanbooruPosts(data){
    if(!Array.isArray(data))return [];
    return data.filter(x=>x&&Number.isSafeInteger(Number(x.id)))
      .filter(x=>['g','general'].includes(str(x.rating).toLowerCase()))
      .map(row=>({
        // Provider-qualified IDs keep existing Gelbooru post IDs unique.
        id:'db_'+String(row.id),provider:'danbooru',
        tags:booruTags({tags:str(row.tag_string||row.tag_string_general||'')}),
        rating:row.rating,
        thumbnail:safeBooruMediaURL(row.preview_file_url||row.large_file_url||row.file_url),
        sample:safeBooruMediaURL(row.large_file_url||row.preview_file_url),
        image:safeBooruMediaURL(row.file_url||row.large_file_url),
        source:clip(row.source||'',500),
        postURL:'https://danbooru.donmai.us/posts/'+encodeURIComponent(String(row.id))
      })).filter(x=>x.image);
  }
  function sanitizeSceneText(value){
    let text=str(value);
    // Do not treat a model's internal reasoning as fictional scene content.
    text=text.replace(/<\s*(?:thoughts?|thinking|analysis)\b[^>]*>[\s\S]*?<\s*\/\s*(?:thoughts?|thinking|analysis)\s*>/gi,' ');
    text=text.replace(/<\|im_start\|>\s*(?:analysis|thinking)[\s\S]*?<\|im_end\|>/gi,' ');
    text=text.replace(/<\|channel\s*=\s*analysis\|>[\s\S]*?<\|channel\s*=\s*final\|>/gi,' ');
    if(/<\s*(?:thoughts?|thinking|analysis)\b[^>]*>/i.test(text)){
      // An unclosed thought block cannot be reliably separated: skip the scene.
      return '';
    }
    return text.trim();
  }
  function inspectResponseBody(value){
    const raw=str(value).replace(/^\uFEFF/,'').trimStart();
    const sample=raw.slice(0,500).toLowerCase();
    if(!raw)return '빈 응답';
    if(/^<!doctype html|^<html|^<head|^<body|^<script|^<div/i.test(raw))
      return /cloudflare|challenge|just a moment|captcha|verify you are human/i.test(sample)?
        'HTML 보안 확인·차단 페이지':'JSON 대신 HTML 페이지 반환';
    if(/^<\?xml|^<\w+/i.test(raw))return 'JSON 대신 XML/HTML 문서 반환';
    if(/^access denied|^forbidden|^unauthorized/i.test(raw))return '접근 거부 텍스트';
    if(/^error|^bad gateway|^upstream|^proxy error/i.test(raw))return '서버/프록시 오류 텍스트';
    return '알 수 없는 비JSON 응답';
  }
  function classifyProxyError(body){
    let obj=null;
    try{obj=JSON.parse(str(body));}catch(_){return '';}
    if(!obj||typeof obj!=='object'||Array.isArray(obj)||typeof obj.error!=='string')return '';
    // Restrict diagnostics to known error categories. A raw server error may
    // contain a full URL and the user's Gelbooru API key: never echo it.
    const msg=obj.error.toLowerCase();
    if(/invalid signature|authentication|unauthorized/.test(msg))return 'RisuBard 중계 인증/서명 오류';
    if(/timeout|timed out|etimedout|abort/.test(msg))return '중계 서버 연결 시간 초과';
    if(/getaddrinfo|enotfound|eai_again|dns/.test(msg))return '중계 서버 DNS 조회 실패';
    if(/certificate|tls|ssl|cert_|unable to verify/.test(msg))return '중계 서버 TLS/인증서 오류';
    if(/econnreset|econnrefused|ehostunreach|socket|fetch failed|network/.test(msg))return 'RisuBard 중계 서버 외부 연결 실패';
    if(/internal server error|proxy request failed/.test(msg))return 'RisuBard 중계 서버 내부 오류';
    return 'JSON error 응답 (상세 메시지 비공개)';
  }
  async function describeBooruFailure(response){
    const status=Number(response?.status)||0;
    const type=str(response?.headers?.get?.('content-type')||'').toLowerCase();
    let category='응답 내용 확인 불가';
    try{
      const body=await response.text();
      category=classifyProxyError(body)||inspectResponseBody(body);
    }catch(_){}
    // Do not expose body text or URLs: Gelbooru query URLs contain API keys.
    const safeType=type.split(';')[0].replace(/[^a-z0-9.\\/+_-]/g,'').slice(0,40)||'미표시';
    return 'HTTP '+status+' · '+category+' · '+safeType;
  }
  async function readBooruJson(response,provider){
    if(!response?.ok)throw Error(await describeBooruFailure(response));
    const type=str(response.headers?.get?.('content-type')||'미표시').split(';')[0].toLowerCase();
    const raw=await response.text();
    const trimmed=raw.replace(/^\uFEFF/,'').trim();
    if(!trimmed||(!trimmed.startsWith('{')&&!trimmed.startsWith('['))){
      throw Error('HTTP '+str(response.status)+' · '+inspectResponseBody(raw)+
        ' · Content-Type '+clip(type,45)+' · 본문 '+raw.length+'자');
    }
    try{
      return JSON.parse(trimmed);
    }catch(e){
      throw Error('HTTP '+str(response.status)+' · JSON 문법 오류 ('+clip(e?.message||e,65)+
        ') · Content-Type '+clip(type,45));
    }
  }
  async function searchBooruWithFallback(baseTags,limit=12,page=0){
    const userTags=asArray(baseTags).map(x=>str(x).trim()).filter(x=>x&&!x.startsWith('rating:'));
    // Prefer the Python route when previously verified; avoid the failing
    // RisuBard external /proxy2 entirely in this case.
    if(localBridgeActive){
      try{return await searchViaLocalBridge(userTags,limit,page);}
      catch(e){localBridgeStatus='로컬 브리지 재연결 실패: '+clip(e?.message||e,120);localBridgeActive=false;}
    }
    const gelParams=new URLSearchParams({page:'dapi',s:'post',q:'index',json:'1',
      limit:String(limit),pid:String(page),tags:[...userTags,'rating:general'].join(' ')});
    if(externalApiKey.trim()&&externalUserId.trim()){
      gelParams.set('api_key',externalApiKey.trim());
      gelParams.set('user_id',externalUserId.trim());
    }
    let gelFailure='';
    try{
      // Avoid custom Accept headers: older authenticated requests worked
      // without them, and custom headers can change the CORS/proxy route.
      const response=await risuai.nativeFetch('https://gelbooru.com/index.php?'+gelParams.toString(),
        {method:'GET'});
      if(!response?.ok)throw Error(await describeBooruFailure(response));
      const posts=parseBooruPosts(await readBooruJson(response,'Gelbooru'));
      externalProviderStatus='Gelbooru API 정상 ('+posts.length+'건)';
      return posts;
    }catch(e){
      gelFailure=clip(e?.message||e,100);
    }
    // Danbooru public search: one descriptive tag + rating:g to stay within
    // common unauthenticated tag-count restrictions; verify all tags locally.
    const distinctive=userTags.find(x=>x!=='1girl'&&x!=='1boy')||userTags[0]||'smile';
    const danParams=new URLSearchParams({limit:String(Math.min(30,Math.max(12,limit))),page:String(page+1),
      tags:distinctive+' rating:g'});
    try{
      const response=await risuai.nativeFetch('https://danbooru.donmai.us/posts.json?'+danParams.toString(),
        {method:'GET'});
      if(!response?.ok)throw Error(await describeBooruFailure(response));
      const posts=parseDanbooruPosts(await readBooruJson(response,'Danbooru'));
      externalProviderStatus='Gelbooru 실패 ('+gelFailure+') → Danbooru 정상 ('+posts.length+'건)';
      return posts;
    }catch(e){
      const second=clip(e?.message||e,100);
      externalProviderStatus='Gelbooru '+gelFailure+' / Danbooru '+second;
      try{return await searchViaLocalBridge(userTags,limit,page);}
      catch(error){
        localBridgeActive=false;
        localBridgeStatus='로컬 브리지 검색 불가: '+clip(error?.message||error,120);
        throw Error('외부 중계 실패 · '+externalProviderStatus+
          ' / Python 로컬 브리지 미연결 또는 실패 · '+clip(error?.message||error,105));
      }
    }
  }
  function isRejected(postId){return rejectedPosts['gelbooru:'+str(postId)]===true;}
  function assetSceneScore(item,signals,kind){
    if(kind!=='original'&&kind!=='fanwork')return 0;
    const tags=new Set(asArray(item?.tags));
    const effective=kind==='original'?asArray(signals):asArray(signals).filter(x=>x.weight===3).slice(0,1);
    return effective.reduce((score,signal)=>score+(asArray(signal.tags).some(tag=>tags.has(tag))?signal.weight:0),0);
  }
  function isRelevantPost(item,signals,kind){
    return assetSceneScore(item,signals,kind)>=3;
  }
  function isUsablePackAsset(asset,pack,signals){
    if(!asset||!pack||isRejected(asset.postId))return false;
    if(!asArray(pack.snapshot?.additionalAssets).some(a=>Array.isArray(a)&&a[0]===asset.name))return false;
    return isRelevantPost(asset,signals,pack.characterKind);
  }
  function imageMagic(bytes){
    if(!bytes||bytes.length<12)return '';
    if(bytes[0]===0x89&&bytes[1]===0x50&&bytes[2]===0x4e&&bytes[3]===0x47
      &&bytes[4]===0x0d&&bytes[5]===0x0a&&bytes[6]===0x1a&&bytes[7]===0x0a)return 'png';
    if(bytes[0]===0xff&&bytes[1]===0xd8&&bytes[2]===0xff)return 'jpg';
    if(bytes[0]===0x47&&bytes[1]===0x49&&bytes[2]===0x46&&bytes[3]===0x38
      &&(bytes[4]===0x37||bytes[4]===0x39)&&bytes[5]===0x61)return 'gif';
    if(bytes[0]===0x52&&bytes[1]===0x49&&bytes[2]===0x46&&bytes[3]===0x46
      &&bytes[8]===0x57&&bytes[9]===0x45&&bytes[10]===0x42&&bytes[11]===0x50)return 'webp';
    return '';
  }
  function imageCandidateUrls(item){
    const urls=[item?.image,item?.sample,item?.thumbnail].map(safeBooruMediaURL).filter(Boolean);
    return [...new Set(urls)];
  }
  async function fetchImageBinary(item,limit=12*1024*1024){
    const urls=imageCandidateUrls(item);
    if(!urls.length)throw Error('허용된 이미지 URL이 없음');
    const failures=[];
    if(localBridgeActive){
      for(const url of urls){
        try{return await fetchViaLocalBridge(url,limit);}
        catch(e){failures.push('로컬 브리지: '+clip(e?.message||e,100));}
      }
      // A running bridge returning an image-not-found error is not a reason
      // to hammer the same external sites through the broken proxy.
      throw Error('브리지 이미지 다운로드 실패 · '+failures.join(' / ').slice(0,290));
    }
    for(const url of urls){
      try{
        const response=await risuai.nativeFetch(url,{
          method:'GET',
          headers:{
            // Same expected request context as the working downloader,
            // without spoofing credentials or ignoring response validation.
            'User-Agent':'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
            'Referer':item?.provider==='danbooru'?'https://danbooru.donmai.us/':'https://gelbooru.com/',
            'Accept':'image/avif,image/webp,image/png,image/jpeg,image/gif,image/*;q=0.8,*/*;q=0.2'
          }
        });
        if(!response?.ok)throw Error('HTTP '+str(response?.status||'unknown'));
        const declaredSize=Number(response.headers?.get?.('content-length')||0);
        if(declaredSize>limit)throw Error('용량 제한 초과');
        const contentType=str(response.headers?.get?.('content-type')||'unknown').toLowerCase();
        const bytes=new Uint8Array(await response.arrayBuffer());
        if(bytes.length<12||bytes.length>limit)throw Error('빈 파일 또는 용량 제한 초과');
        const ext=imageMagic(bytes);
        if(!ext)throw Error('실제 이미지 데이터 아님 (Content-Type '+clip(contentType,60)+', '+bytes.length+'B)');
        // RisuBard's proxy may label genuine binary as application/octet-stream.
        // Trust an actual PNG/JPEG/WebP/GIF header over a proxy MIME label.
        return {bytes,ext,url};
      }catch(e){
        let host='unknown';
        try{host=new URL(url).hostname;}catch(_){}
        failures.push(host+': '+clip(e?.message||e,105));
      }
    }
    // If remote search worked but the image CDN is blocked, try the local
    // Python downloader for the same approved URLs.
    for(const url of urls){
      try{return await fetchViaLocalBridge(url,limit);}
      catch(e){failures.push('Python bridge: '+clip(e?.message||e,95));}
    }
    throw Error('이미지 다운로드 실패 · '+failures.join(' / ').slice(0,330));
  }

  async function persistAssetToPack(pack,item,ctx=null){
    if(!pack||!item||isRejected(item.id))return false;
    if(asArray(pack.externalAssets).some(x=>str(x.postId)===str(item.id)))return false;
    const download=await fetchImageBinary(item);
    const {bytes}=download;
    // The plugin iframe transfers the argument buffer (zero-copy).
    // Preserve the original byte array for readback verification.
    const path=await risuai.saveAsset(new Uint8Array(bytes));
    if(!safePath(path)||!str(path).startsWith('assets/'))throw Error('에셋 저장 실패');
    const verified=bytesOf(await risuai.readImage(path));
    if(!verified||verified.length!==bytes.length)throw Error('복제 검증 실패');
    for(let i=0;i<bytes.length;i++)if(verified[i]!==bytes[i])throw Error('복제 내용 불일치');
    // Re-fetch the newest pack, because other UI operations might have run.
    const fresh=packLibrary.find(x=>x.id===pack.id);
    if(!fresh||isRejected(item.id)||asArray(fresh.externalAssets).some(x=>str(x.postId)===str(item.id)))return false;
    const existing=asArray(fresh.snapshot?.additionalAssets);
    const name='gelbooru_'+item.id;
    if(existing.some(x=>x[0]===name))return false;
    const ext=download.ext;
    const asset={name,path,ext,postId:str(item.id),tags:item.tags,
      provider:item.provider||'gelbooru',sourceURL:item.postURL,previewURL:gelbooruMediaURL(item.thumbnail||item.image),artistSource:item.source||'',autoAdded:true};
    const updated={...fresh,updatedAt:Date.now(),
      externalAssets:[...asArray(fresh.externalAssets),asset],
      snapshot:{...fresh.snapshot,additionalAssets:[...existing,[name,path,ext]]}};
    updated.assetCount=updated.snapshot.additionalAssets.length;
    const db=await risuai.getDatabase();
    const oldModules=asArray(db?.modules);
    const archiveId=archivedModuleId(pack.id);
    const nextModules=oldModules.map(mod=>{
      if(mod?.id===archiveId){
        return {...mod,assets:[...asArray(mod.assets),[name,path,ext]]};
      }
      const meta=metadataOf(mod);
      // Non-Character-Mixer modules have no MARK metadata. Never inspect
      // targetChatId on null; preserve unrelated modules byte-for-byte.
      if(!ctx||!meta||(!meta.autoImages&&!autoCollectEnabled)||meta.targetChatId!==ctx.chat.id
        ||!asArray(meta.sourceIds).includes('pack:'+pack.id))return mod;
      const tagItem={name,tags:item.tags,characterName:fresh.name,
        characterAliases:[fresh.name,...asArray(fresh.speakerAliases)],
        sourceId:'pack:'+pack.id,characterKind:fresh.characterKind};
      return {...mod,assets:[...asArray(mod.assets),[name,path,ext]],
        description:MARK+JSON.stringify({...meta,externalTagAssets:[...asArray(meta.externalTagAssets),tagItem]})};
    });
    if(!nextModules.some(m=>m?.id===archiveId)){
      nextModules.push({id:archiveId,name:'Character Mixer Archive · '+clip(fresh.name,70),
        description:ARCHIVE_MARK+JSON.stringify({packId:fresh.id,version:3}),
        namespace:'character-mixer-archive',lorebook:[],
        assets:updated.snapshot.additionalAssets.map(x=>[x[0],x[1],x[2]])});
    }
    const before=packLibrary;
    await risuai.setDatabaseLite({modules:nextModules});
    packLibrary=before.map(p=>p.id===fresh.id?updated:p);
    try{await savePacks();}
    catch(error){
      packLibrary=before;
      try{await risuai.setDatabaseLite({modules:oldModules});}catch(e){console.error('[CharacterMixer] automatic asset rollback failed',e);}
      throw error;
    }
    invalidateDisplayCache();
    return true;
  }
  async function dislikeAsset(packId,postId){
    const key='gelbooru:'+str(postId);
    if(rejectedPosts[key])return;
    const previous={...rejectedPosts};
    rejectedPosts={...rejectedPosts,[key]:true};
    try{await saveAutoPrefs();}
    catch(e){rejectedPosts=previous;throw e;}
    const before=packLibrary;
    const fresh=before.find(p=>p.id===packId);
    const removed=asArray(fresh?.externalAssets).filter(x=>str(x.postId)===str(postId));
    if(fresh&&removed.length){
      const removedNames=new Set(removed.map(x=>x.name));
      const next={...fresh,externalAssets:asArray(fresh.externalAssets).filter(x=>!removedNames.has(x.name)),
        snapshot:{...fresh.snapshot,additionalAssets:asArray(fresh.snapshot.additionalAssets).filter(x=>!removedNames.has(x[0]))}};
      next.assetCount=next.snapshot.additionalAssets.length;
      const db=await risuai.getDatabase();
      const oldModules=asArray(db.modules);
      const changed=oldModules.map(mod=>{
        const meta=metadataOf(mod);
        if(mod?.id!==archivedModuleId(packId)&&!asArray(meta?.sourceIds).includes('pack:'+packId))return mod;
        const nextMod={...mod,assets:asArray(mod.assets).filter(x=>!removedNames.has(x[0]))};
        if(meta)nextMod.description=MARK+JSON.stringify({...meta,
          externalTagAssets:asArray(meta.externalTagAssets).filter(x=>!removedNames.has(x.name))});
        return nextMod;
      });
      await risuai.setDatabaseLite({modules:changed});
      packLibrary=before.map(p=>p.id===packId?next:p);
      try{await savePacks();}
      catch(error){
        packLibrary=before;
        try{await risuai.setDatabaseLite({modules:oldModules});}catch(e){console.error('[CharacterMixer] dislike rollback failed',e);}
        throw error;
      }
    }
    invalidateDisplayCache();
    for(const asset of removed)rememberFeedback(asset.name);
    externalNotice='싫어요 반영: #'+str(postId)+' · 라이브러리와 채팅 이미지 선택에서 제외, 다시 자동 수집하지 않아.';
    await render();
  }
  function inferAutoChatKind(character){
    const inferred=inferCharacterIdentity(character,loreOf(character));
    // A missing fandom reference is not proof of an OC, but scene-first
    // matching is a better fallback than trying to find an arbitrary person
    // with the same name in the character-tag index.
    return {kind:inferred.kind==='fanwork'?'fanwork':'original',
      inference:inferred,unconfirmed:inferred.kind==='unknown'};
  }
  async function bootstrapCurrentChat(ctx){
    if(!autoCollectEnabled||ctx.libraryOnly||installedInChat(ctx).length)return ctx;
    const lock=ctx.chat.id;
    if(bootstrapBusy.has(lock))return ctx;
    bootstrapBusy.add(lock);
    try{
      const current=await context();
      if(current.chat.id!==ctx.chat.id||installedInChat(current).length)return current;
      const source=current.target;
      if(!source?.chaId)return current;
      const prefix='cm_auto_';
      const packId=prefix+str(source.chaId).replace(/[^a-zA-Z0-9_-]/g,'').slice(0,64);
      let pack=packLibrary.find(p=>p.id===packId);
      if(!pack){
        const prediction=inferAutoChatKind(source);
        pack={id:packId,name:clip(source.name,100),updatedAt:Date.now(),
          characterKind:prediction.kind,identityEvidence:prediction.inference,
          identitySource:'auto-chat',autoGenerated:true,
          speakerAliases:[],externalAssets:[],binaryCopied:true,
          snapshot:{name:source.name,desc:str(source.desc),personality:str(source.personality),
            scenario:str(source.scenario),firstMessage:str(source.firstMessage),
            globalLore:[],additionalAssets:[],emotionImages:[],ccAssets:[],modules:[]}};
        const oldLibrary=packLibrary;
        packLibrary=[...oldLibrary,pack];
        try{await savePacks();}catch(e){packLibrary=oldLibrary;throw e;}
      }
      const id='character-mixer-auto-'+str(current.chat.id).replace(/[^a-zA-Z0-9_-]/g,'').slice(0,88);
      const externalTagAssets=asArray(pack.externalAssets).filter(x=>!isRejected(x.postId)).map(x=>({
        name:x.name,tags:asArray(x.tags),characterName:pack.name,
        characterAliases:[pack.name,...asArray(pack.speakerAliases)],sourceId:'pack:'+pack.id,
        characterKind:pack.characterKind
      }));
      const module={id,name:'Character Mixer Auto Assets · '+clip(pack.name,80),
        description:MARK+JSON.stringify({autoGenerated:true,autoImages:true,
          sourceId:'pack:'+pack.id,sourceIds:['pack:'+pack.id],
          targetChatId:current.chat.id,targetCharacterId:source.chaId,externalTagAssets,
          assetAliases:[],version:4}),
        namespace:'character-mixer',lorebook:[],
        assets:asArray(pack.externalAssets).filter(x=>!isRejected(x.postId))
          .map(x=>[x.name,x.path,x.ext])};
      // An asset-only module: never inject an NPC description or change prompts.
      const oldModules=asArray(current.db.modules);
      const newModules=[...oldModules.filter(m=>m?.id!==id),module];
      const latest=await assertStillCurrent(current);
      const oldIds=asArray(latest.modules);
      const newChat={...latest,modules:[...new Set([...oldIds,id])]};
      await risuai.setDatabaseLite({modules:newModules});
      try{await risuai.setChatToIndex(current.ci,current.ti,newChat);}
      catch(e){try{await risuai.setDatabaseLite({modules:oldModules});}catch(rollback){console.warn('[CharacterMixer] auto attach rollback',rollback);}throw e;}
      invalidateDisplayCache();
      outputLastResult='자동 에셋 연결 완료: '+pack.name+' (서사·로어북 수정 없음)';
      return await context();
    }finally{bootstrapBusy.delete(lock);}
  }
  async function testCurrentChatAuto(){
    try{
      const ctx=await context();
      const last=asArray(ctx.chat?.message).filter(x=>['char','assistant'].includes(str(x?.role))).at(-1);
      if(!last)throw Error('분석할 AI 답변이 없어');
      const source=installedInChat(ctx).length?ctx:await bootstrapCurrentChat(ctx);
      autoCollectStatus='';
      await discoverForScene(str(last.data),source,{manual:true});
      if(!autoCollectStatus)outputLastResult='최근 답변 분석 실행 완료 · 이미지가 나오지 않으면 캐릭터·표정 태그 또는 API를 확인해';
    }catch(e){outputLastResult='진단 실패: '+clip(e?.message||e,160);}
    await render();
  }
  async function onCommittedChatOutput(payload){
    if(destroyed||!autoCollectEnabled)return;
    outputEventCount++;
    try{
      const ctx=await context();
      if(ctx.ci!==payload?.characterIndex||ctx.ti!==payload?.chatIndex||
        ctx.chat.id!==payload?.chat?.id)return;
      const msg=payload?.chat?.message?.[payload.messageIndex];
      if(!msg||!['char','assistant'].includes(str(msg.role)))return;
      const raw=str(msg.data);
      if(raw.length<40)return;
      const active=installedInChat(ctx).length?ctx:await bootstrapCurrentChat(ctx);
      const cleanScene=sanitizeSceneText(raw);
      outputLastResult=cleanScene?'장면 분석: '+clip(cleanScene.slice(0,80).replace(/\s+/g,' '),80):'내부 Thoughts 구간 제외 · 분석 가능한 장면 없음';
      if(cleanScene)await discoverForScene(raw,active);
    }catch(e){outputLastResult='자동 처리 실패: '+clip(e?.message||e,160);console.warn('[CharacterMixer] output event',e);}
  }

  async function discoverForScene(content,ctx,options={}){
    const manual=options.manual===true;
    const skipped=reason=>{autoCollectStatus='검색 생략: '+reason;outputLastResult=autoCollectStatus;};
    if(!autoCollectEnabled){skipped('자동 수집 꺼짐');return;}
    if(autoCollectBusy){skipped('다른 이미지 검색 진행 중');return;}
    if(destroyed||ctx.libraryOnly){skipped('채팅 외부 실행 또는 플러그인 종료');return;}
    const active=installedInChat(ctx).map(m=>({mod:m,meta:metadataOf(m)}))
      .filter(x=>x.meta?.autoImages||autoCollectEnabled);
    if(!active.length){skipped('현재 채팅에 연결된 이미지 모듈 없음');return;}
    // Display hooks can render the entire old chat. Only fetch assets for the
    // newest assistant/character message, never retroactively crawl history.
    const last=asArray(ctx.chat?.message).filter(m=>['char','assistant'].includes(str(m?.role))).at(-1);
    const raw=str(last?.data).trim();
    if(!raw){skipped('최신 AI 답변이 없음');return;}
    if(!manual&&!content.includes(raw.slice(0,Math.min(100,raw.length)))&&content!==raw){skipped('현재 화면의 최신 답변과 불일치');return;}
    const window=sanitizeSceneText(content).slice(-3000);
    if(window.length<30){autoCollectStatus='장면 텍스트 없음 · Thoughts/내부 분석을 제외했어';return;}
    const signals=sceneTagSignals(window);
    if(!signals.length){skipped('분석 가능한 장면·행동·표정 태그 없음');return;}
    const now=Date.now();
    for(const entry of active){
      for(const id of asArray(entry.meta?.sourceIds).filter(x=>str(x).startsWith('pack:'))){
        const pack=packLibrary.find(p=>'pack:'+p.id===id);
        if(!pack||!['original','fanwork'].includes(pack.characterKind)){skipped('연결된 캐릭터 팩이 없거나 유형 판별 실패');continue;}
        const aliases=[pack.name,...asArray(pack.speakerAliases)];
        // Avoid cross-character contamination: explicit speaker match.
        const named=aliases.some(name=>name&&(window.includes('['+name+']')||window.includes(name)));
        const singlePack=active.flatMap(x=>asArray(x.meta?.sourceIds)).filter(x=>str(x).startsWith('pack:')).length===1;
        const onlyOC=pack.characterKind==='original'&&active.flatMap(x=>asArray(x.meta?.sourceIds)).filter(id=>str(id).startsWith('pack:')).length===1;
        if(!named&&!onlyOC&&!singlePack){skipped('현재 장면의 캐릭터 연결 불확실');continue;}
        const tagSignals=pack.characterKind==='original'?signals:signals.filter(x=>x.weight===3);
        if(!tagSignals.length){skipped('2차창작 이미지와 일치하는 감정 태그 없음');continue;}
        const keys=tagSignals.map(x=>x.tags[0]).slice(0,2);
        const eventKey=ctx.chat.id+'|'+pack.id+'|'+keys.join('|');
        if(!manual&&now-(lastDiscovery.get(eventKey)||0)<5*60*1000){skipped('동일 장면 최근 검색됨 (5분 제한)');continue;}
        // A failed search is not a completed discovery. Record cooldown only
        // after a successful API response; otherwise users were blocked for 5m.
        const existing=asArray(pack.externalAssets).filter(x=>!isRejected(x.postId));
        // Reuse-first: an existing suitably tagged asset means no network call.
        const localMatches=existing.filter(x=>isUsablePackAsset(x,pack,tagSignals)).length;
        if(densitySettings.skipIfEnoughAssets&&localMatches>=densitySettings.minimumLocalAssets&&
          (densitySettings.minimumLocalAssets>0||localMatches>0)){
          skipped('기존 장면 에셋 '+localMatches+'장 확보 · 설정된 충분 기준 만족');continue;
        }
        const base=pack.characterKind==='original'?'1girl '+keys.join(' '):
          (asArray(pack.identityEvidence?.externalCandidates)[0]?.tag||
            str(pack.name).toLowerCase().replace(/\s+/g,'_'))+' '+keys[0];
        const tags=base.split(/\s+/).slice(0,6).filter(Boolean);
        if(!tags.length){skipped('검색 태그 생성 실패');continue;}
        autoCollectBusy=true;
        try{
          const rows=await searchBooruWithFallback(tags,densitySettings.searchCandidatePool,0);
          if(!manual)lastDiscovery.set(eventKey,Date.now());
          const candidates=rows.filter(x=>!isRejected(x.id)&&!existing.some(y=>str(y.postId)===str(x.id))
            &&isRelevantPost(x,tagSignals,pack.characterKind)).slice(0,densitySettings.searchCandidatePool);
          const saved=[],failures=[];
          for(const candidate of candidates){
            if(saved.length>=densitySettings.autoCollectMaxPerRun)break;
            try{
              if(await persistAssetToPack(pack,candidate,ctx))saved.push(candidate);
            }catch(e){failures.push(clip(e?.message||e,120));}
          }
          if(saved.length){
            autoCollectStatus=pack.name+' · 신규 에셋 '+saved.length+'장 저장 ('+
              saved.map(x=>'#'+x.id).join(', ')+')';
          }else{
            autoCollectStatus=failures.length?'검색은 성공했지만 이미지 다운로드 실패: '+failures[0]:
              pack.name+' · 조건에 맞는 신규 이미지 없음';
          }
          outputLastResult=autoCollectStatus;
        }catch(e){
          // Never mask the original failure with a retry throttle.
          lastDiscovery.delete(eventKey);
          autoCollectStatus='자동 검색 실패: '+clip(e?.message||e,200);
          outputLastResult=autoCollectStatus;
        }
        finally{autoCollectBusy=false;}
        return; // One bounded search per scene; save at most configured number.
      }
    }
    if(!autoCollectStatus||autoCollectStatus.startsWith('검색 실행 기록'))skipped('검색 대상 캐릭터 팩이 없음');
  }

  async function searchExternal(){
    if(externalBusy)return;
    externalBusy=true;externalError='';externalNotice='';
    try{
      externalResults=[];
      const tokens=str(externalQuery).trim().split(/\s+/).filter(Boolean).slice(0,8);
      if(!tokens.length)throw Error('캐릭터 태그를 입력해. 예: boa_hancock_(one_piece)');
      if(typeof risuai.nativeFetch!=='function')throw Error('이 버전에서는 nativeFetch API를 사용할 수 없어');
      externalResults=await searchBooruWithFallback(tokens,18,externalPage);
      externalSelected.clear();
      externalNotice=externalResults.length+'개 일반 등급 이미지 검색 완료 · '+externalProviderStatus;
    }catch(e){externalError=str(e?.message||e);}
    finally{externalBusy=false;await render();}
  }
  async function importExternalImages(){
    if(externalBusy)return;
    externalBusy=true;externalError='';externalNotice='';
    try{
      const pack=externalTarget();
      const chosen=externalResults.filter(x=>externalSelected.has(x.id)&&!isRejected(x.id));
      if(!chosen.length)throw Error('가져올 이미지를 선택해.');
      if(chosen.length>12)throw Error('한 번에 12개까지만 저장할 수 있어.');
      if(typeof risuai.nativeFetch!=='function'||typeof risuai.saveAsset!=='function')
        throw Error('이미지 저장 API를 사용할 수 없어');
      const existingIds=new Set(asArray(pack.externalAssets).map(x=>str(x.postId)));
      const imported=[],problems=[];
      for(const item of chosen){
        if(existingIds.has(item.id))continue;
        try{
          const download=await fetchImageBinary(item,18*1024*1024);
          const {bytes}=download;
          const savedPath=await risuai.saveAsset(new Uint8Array(bytes));
          if(!safePath(savedPath))throw Error('에셋 저장 경로가 유효하지 않아');
          const verified=bytesOf(await risuai.readImage(savedPath));
          if(!verified||verified.length!==bytes.length)throw Error('저장 검증 실패');
          for(let i=0;i<bytes.length;i++)if(bytes[i]!==verified[i])throw Error('저장 내용이 원본과 달라');
          const ext=download.ext;
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
          provider:item.provider||'gelbooru',sourceURL:item.postURL,previewURL:gelbooruMediaURL(item.thumbnail||item.image),artistSource:item.source};
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
  function densityField(key,label,min,max){
    return '<label>'+esc(label)+'<input type="number" data-cm-density="'+esc(key)+
      '" min="'+min+'" max="'+max+'" step="1" value="'+densitySettings[key]+'"/></label>';
  }
  async function render(){
    if(!opened||destroyed)return;
    try{
      const ctx=await context(true),sources=[...available(ctx.db,ctx.target.chaId),...packLibrary.map(p=>({chaId:'pack:'+p.id,name:'[PACK] '+p.name}))],src=presentSource(ctx);
      const active=installedInChat(ctx);
      const availableLore=src?loreOf(src):[];
      const availableModules=src?optionalModuleList(ctx,src):[];
      const extraCandidates=available(ctx.db,ctx.target.chaId).filter(x=>x.chaId!==sourceId);
      characterKindChoice=sourceId.startsWith('pack:')?(['original','fanwork'].includes(packLibrary.find(p=>'pack:'+p.id===sourceId)?.characterKind)?packLibrary.find(p=>'pack:'+p.id===sourceId).characterKind:'unknown'):'unknown';
      characterWorkInput=sourceId.startsWith('pack:')?str(packLibrary.find(p=>'pack:'+p.id===sourceId)?.originalWork||''):'';
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
      const recent=latestShown&&reviewFirst
        ?packLibrary.find(p=>p.id===latestShown.packId)?.externalAssets?.find(x=>str(x.postId)===latestShown.postId)
        :null;
      const recentFeedback=reviewFirst?(
        '<section><h3>최근 표시된 이미지 · 빠른 피드백</h3>'+
        (recent?'<div class="item"><span>'+
          (gelbooruMediaURL(recent.previewURL)?'<img loading="lazy" src="'+esc(gelbooruMediaURL(recent.previewURL))+
            '" style="max-width:240px;max-height:260px;object-fit:contain" alt="최근 이미지"/>':'')+
          '<small>Gelbooru #'+esc(recent.postId)+'</small></span>'+
          '<button id="cm-dislike-recent" type="button">👎 이 이미지 싫어요 · 다시 표시하지 않기</button></div>'
        :'<p class="muted">아직 이 채팅에서 자동으로 표시한 에셋이 없어. 팩의 이미지 목록에서는 개별적으로 제외할 수 있어.</p>')+
        '</section>'):''; 
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
        '</style><main><div class="top"><h2>🧩 Character Mixer v0.9.0</h2><button id="cm-close">닫기</button></div>'+
        '<p class="muted">현재 채팅의 내용을 지우지 않고 다른 봇의 설정·로어북·에셋 참조를 선택적으로 추가해. B 봇은 RisuBard에 먼저 가져와 둬야 해.</p>'+recentFeedback+
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

        '<section><h3>캐릭터 유형 · 이미지 매칭 기준</h3>'+
        '<p class="muted">2차창작은 캐릭터 자체를 우선하고, 오리지널은 장면·표정·행동·장소 태그를 우선해. 유형은 저장된 [PACK]에만 적용돼.</p>'+
        '<label>유형<select id="cm-kind"><option value="unknown" '+(characterKindChoice==='unknown'?'selected':'')+'>미분류 · 자동 표시 보류 (기본)</option><option value="fanwork" '+(characterKindChoice==='fanwork'?'selected':'')+'>2차창작 · 캐릭터 일치 우선</option>'+
        '<option value="original" '+(characterKindChoice==='original'?'selected':'')+'>오리지널 · 장면 일치 우선</option></select></label>'+
        '<label>원작 이름 (2차창작인 경우)<input id="cm-original-work" type="text" value="'+esc(characterWorkInput)+'" placeholder="예: 이누야샤"/></label>'+
        '<p class="muted">이름만으로 판별하지 않아. 예: 가영은 이누야샤의 가영일 수도, 오리지널 인물일 수도 있어. 원작 정보는 분류의 근거로 기록하지만 자동 확정하지 않아.</p>'+
        '<div class="top"><button id="cm-kind-auto" '+(!sourceId.startsWith('pack:')?'disabled':'')+'>설정·로어북으로 자동 판별</button>'+
        '<button id="cm-kind-save" '+(!sourceId.startsWith('pack:')?'disabled':'')+'>수동 지정 저장</button></div>'+
        (sourceId.startsWith('pack:')?'<p class="muted">판별 근거: '+esc(asArray(packLibrary.find(p=>'pack:'+p.id===sourceId)?.identityEvidence?.evidence).join(' / ')||'없음 · 이름만으로 단정하지 않음')+'</p>'+ 
          '<p class="muted">외부 캐릭터 태그 후보: '+esc(asArray(packLibrary.find(p=>'pack:'+p.id===sourceId)?.identityEvidence?.externalCandidates).map(x=>x.tag).slice(0,5).join(', ')||'검색 근거 없음')+'</p>':'')+'</section>'+
        '<section><h3>채팅 화자 이름 연결</h3>'+
        '<p class="muted">자동 이미지 표시를 사용할 때 채팅의 [강세라], [핸콕] 같은 화자 이름을 인식하는 용도야. 쉼표로 구분해.</p>'+
        '<input id="cm-speaker-alias" type="text" value="'+esc(sourceId.startsWith('pack:')?(packLibrary.find(p=>'pack:'+p.id===sourceId)?.speakerAliases||[]).join(', '):'')+'" placeholder="예: 핸콕, 보아 핸콕"/>'+
        '<button id="cm-speaker-save" '+(!sourceId.startsWith('pack:')?'disabled':'')+'>화자 이름 저장</button></section>'+
        '<section><h3>에셋 표시량·자동 수집량</h3>'+
        '<label>표시 강도 프리셋<select id="cm-density-preset">'+
        [['low','적게'],['normal','보통'],['high','많이 (기본)'],['aggressive','공격적'],['custom','직접 설정']]
          .map(x=>'<option value="'+x[0]+'" '+(densitySettings.displayPreset===x[0]?'selected':'')+'>'+x[1]+'</option>').join('')+
        '</select></label>'+
        '<div class="grid">'+
          densityField('maxAssetsPerReply','답변당 최대 표시 장수',0,5)+
          densityField('minReplyGap','이미지 표시 간격 (AI 답변 수)',0,10)+
          densityField('recentDuplicateWindow','최근 중복 회피 이미지 수',0,20)+
          densityField('reuseAfterReplies','같은 이미지 재사용까지 답변 수',0,50)+
          densityField('autoCollectMaxPerRun','외부 검색 1회당 최대 저장 장수',1,5)+
          densityField('searchCandidatePool','검색 후보 검토 개수',3,20)+
          densityField('minimumLocalAssets','기존 에셋 충분 기준 (장)',0,20)+
        '</div>'+
        '<label class="check"><input type="checkbox" id="cm-density-skip" '+(densitySettings.skipIfEnoughAssets?'checked':'')+'/>'+
          '<span>장면에 맞는 기존 에셋이 충분하면 외부 검색 생략<small>기준 0장은 자동 생략 없음</small></span></label>'+
        '<label>사용자 에셋 지시 (짧은 자연어 설정)<textarea id="cm-density-hint" placeholder="예: 답변당 최대 3장, 수집 최대 2장, 간격 1턴, 에셋을 넉넉히 표시">'+esc(densitySettings.assetUsageHint)+'</textarea></label>'+
        '<p class="muted">명시된 장수·간격은 설정값에 반영해. 모호한 문장은 전체 프리셋 강도에만 반영하고, 소설 프롬프트에 주입하지 않아.</p>'+
        '<button id="cm-density-save" type="button" class="primary">에셋 설정 저장 및 즉시 적용</button>'+
        '<p class="muted">현재 적용: 답변당 최대 '+densitySettings.maxAssetsPerReply+'장 · 간격 '+densitySettings.minReplyGap+
        '답변 · 검색당 최대 '+densitySettings.autoCollectMaxPerRun+'장 · 후보 '+densitySettings.searchCandidatePool+'건</p>'+
        '</section>'+
        '<section><h3>채팅 이미지 자동 수집 · 싫어요</h3>'+ 
        '<p class="muted">실제 생성 이벤트 연결: '+(outputListenerAvailable?'정상 등록':'미등록 · 플러그인의 replacer 권한이나 앱 버전 확인')+' / 수신 '+outputEventCount+'회</p>'+ 
        '<p class="muted">최근 자동 처리: '+esc(outputLastResult)+'</p>'+
        '<p class="muted">외부 검색 결과: '+esc(autoCollectStatus||'검색 실행 기록 없음')+'</p>'+ 
        '<p class="muted">검색 제공처: '+esc(externalProviderStatus||'아직 확인 안 됨')+'</p>'+
        '<button id="cm-diagnose" type="button">현재 채팅 자동 연결 및 최근 답변 테스트</button>'+
        '<label class="check"><input id="cm-auto-collect" type="checkbox" '+(autoCollectEnabled?'checked':'')+'/>'+
        '<span>채팅 장면에 맞는 이미지가 없으면 Gelbooru에서 자동 검색해 팩에 저장<small>설정한 장수 이내 · 일반 등급 · 중복 및 싫어요 이미지 제외</small></span></label>'+
        '<p class="muted">채팅에 명시적으로 연결되고 자동 이미지 표시가 켜진 팩에만 적용돼. 현재 설정: '+(autoCollectEnabled?'자동 수집 ON':'자동 수집 OFF')+'</p>'+
        '<p class="muted">표시량과 검색·저장량은 위 설정을 따름. 적합한 이미지가 없으면 강제로 삽입하지 않으며 기존 에셋을 우선 사용해.</p>'+
        '<p class="muted">'+esc(autoCollectStatus||'아직 자동 수집 기록 없음')+'</p>'+
        (sourceId.startsWith('pack:')?
          '<h4>저장된 외부 이미지 · 마음에 안 들면 싫어요</h4><div class="grid">'+
          asArray(packLibrary.find(p=>'pack:'+p.id===sourceId)?.externalAssets).slice(-60).reverse().map(item=>
            '<div class="item"><span>'+(gelbooruMediaURL(item.previewURL)?'<img loading="lazy" referrerpolicy="no-referrer" src="'+esc(gelbooruMediaURL(item.previewURL))+'" alt="원본 #'+esc(item.postId)+'" style="display:block;width:120px;height:120px;object-fit:contain"/>':'')+
            '<small>#'+esc(item.postId)+' · '+esc(asArray(item.tags).slice(0,8).join(', '))+'</small>'+
            '<a target="_blank" rel="noopener noreferrer" href="'+esc(item.sourceURL||'https://gelbooru.com/index.php?page=post&s=view&id='+encodeURIComponent(str(item.postId)))+'">원본 보기</a></span>'+
            '<button type="button" data-cm-dislike="'+esc(item.postId)+'" data-cm-dislike-pack="'+esc(sourceId.slice(5))+'">👎 싫어요 · 영구 제외</button></div>').join('')+
          '</div>':'<p class="muted">저장된 [PACK]을 선택하면 이미지별 싫어요를 누를 수 있어.</p>')+
        '<p class="muted">싫어요 이미지는 팩과 연결된 채팅 모듈에서 제외하고, 같은 Gelbooru 게시물을 다시 가져오지 않아. 원본 바이너리 파일은 안전을 위해 즉시 삭제하지 않아.</p></section>'+
        '<section><h3>로컬 Python 다운로더 연결 · 외부 500 오류 해결</h3>'+
        '<p class="muted">RisuBard 외부 중계 서버가 HTTP 500을 반환할 때 PC에서 직접 Gelbooru에 요청하는 대체 경로야. 처음 한 번 브리지를 실행하면 돼.</p>'+
        '<p class="muted">상태: '+esc(localBridgeStatus)+'</p>'+
        '<div class="top"><button id="cm-bridge-test" type="button">로컬 Python 브리지 연결 확인</button>'+
        '<a href="https://github.com/pjb3181-prog/support-my-task/tree/main/risubard-updates/bridge" target="_blank" rel="noopener noreferrer">브리지 실행 파일 보기</a></div>'+
        '<p class="muted">Windows: character_mixer_bridge.py 와 start_character_mixer_bridge.cmd 를 같은 폴더에 저장하고 CMD 파일을 한 번 실행해. 다운로드와 검색 모두 Python 경로를 사용해. 로컬 주소: 127.0.0.1:18765</p>'+
        '</section>'+
        '<section><h3>외부 이미지 검색 · Gelbooru</h3>'+
        '<p class="muted">Gelbooru에서 인증 오류가 나면 Danbooru 공개 검색을 시도해. 두 사이트 모두 실패하면 여기에서 오류를 확인할 수 있어.</p>'+
        '<label>'+(characterKindChoice==='original'?'장면 태그 검색 · 캐릭터 이름 불필요':'캐릭터 태그 검색')+'<input id="cm-booru-tags" type="text" value="'+esc(externalQuery)+'" placeholder="'+(characterKindChoice==='original'?'예: 1girl sitting indoors smile':'예: boa_hancock_(one_piece)')+'"/></label>'+
        (characterKindChoice==='original'?'<p class="muted">오리지널은 원작 캐릭터와 같은 얼굴일 필요가 없어. 대신 의상·행동·감정·장소가 맞는 이미지를 직접 골라 저장해. 이미지에 원래 그려진 캐릭터의 태그는 채팅 선택에 사용하지 않아.</p>':'')+
        '<div class="top"><label>기존 Gelbooru Downloader 설정 가져오기<input id="cm-import-py" type="file" accept=".py,text/x-python,text/plain"/></label>'+ 
        '<button id="cm-auth-test" type="button">기존 API 키 연결 테스트</button>'+ 
        '<button id="cm-auth-clear" type="button">저장한 인증 정보 삭제</button></div>'+ 
        '<p class="muted">'+esc(authStatus)+' · 다운로드한 gelbooru.py 파일을 한 번 선택하면 USER_ID/API_KEY를 추출해 재사용해.</p>'+ 
        '<div class="grid"><label>Gelbooru user_id (필요한 경우)<input id="cm-booru-user" type="text" value="'+esc(externalUserId)+'" autocomplete="off"/></label>'+
        '<label>API key (필요한 경우)<input id="cm-booru-key" type="password" value="'+esc(externalApiKey)+'" autocomplete="off"/></label></div>'+
        '<p class="muted">인증 정보는 로컬 RisuBard 플러그인 저장소에 보관돼 (저장파일 동기화에 포함될 수 있어). GitHub 코드에는 포함하지 않아. Gelbooru API 요청 URL에 키가 포함되므로 네트워크 로그에 남을 수 있어.</p>'+ 
        '<button id="cm-auth-save" type="button">현재 입력한 계정 정보 저장</button>'+
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
        check('autoImages','태그 이미지 자동 표시','팩을 채팅에 불러온 뒤 유형별로 캐릭터 또는 장면이 맞으면 표시 (기본 꺼짐)',choices.autoImages)+
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
      el('cm-close').onclick=()=>{opened=false;reviewFirst=false;void risuai.hideContainer();};
      if(el('cm-dislike-recent'))el('cm-dislike-recent').onclick=()=>{
        if(!latestShown)return;
        void dislikeAsset(latestShown.packId,latestShown.postId).then(()=>{latestShown=null;reviewFirst=true;void render();})
          .catch(e=>{externalError='싫어요 처리 실패: '+str(e?.message||e);void render();});
      };
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
      el('cm-kind').onchange=e=>{characterKindChoice=['original','fanwork'].includes(e.target.value)?e.target.value:'unknown';};
      el('cm-original-work').oninput=e=>{characterWorkInput=str(e.target.value).slice(0,120);};
      el('cm-kind-auto').onclick=()=>void autoIdentifyPack();
      el('cm-kind-save').onclick=()=>void saveCharacterKind();
      el('cm-speaker-alias').oninput=e=>{speakerAliasInput=str(e.target.value).slice(0,300);};
      el('cm-speaker-save').onclick=()=>void saveSpeakerAliases();
      tagInput.oninput=e=>{externalQuery=str(e.target.value).slice(0,200);};
      keyInput.oninput=e=>{externalApiKey=str(e.target.value).slice(0,250);};
      userInput.oninput=e=>{externalUserId=str(e.target.value).slice(0,50);};
      el('cm-import-py').onchange=e=>void importDownloaderFile(e.target);
      el('cm-bridge-test').onclick=()=>void testLocalBridge();
      el('cm-auth-test').onclick=()=>void testGelbooruAuth();
      el('cm-auth-clear').onclick=()=>void clearGelbooruAuth();
      el('cm-auth-save').onclick=()=>void saveGelbooruAuth().then(()=>render()).catch(e=>{authStatus='저장 실패: '+clip(e?.message||e,100);void render();});
      el('cm-density-preset').onchange=e=>{
        const preset=str(e.target.value);
        densitySettings=normalizeDensity({...densitySettings,displayPreset:preset});
        void render();
      };
      for(const node of document.querySelectorAll('[data-cm-density]')){
        node.onchange=e=>{
          const key=str(node.getAttribute('data-cm-density'));
          densitySettings={...densitySettings,[key]:Number(e.target.value),displayPreset:'custom'};
          el('cm-density-preset').value='custom';
        };
      }
      el('cm-density-skip').onchange=e=>{
        densitySettings={...densitySettings,skipIfEnoughAssets:Boolean(e.target.checked)};
      };
      el('cm-density-hint').oninput=e=>{
        densitySettings={...densitySettings,assetUsageHint:str(e.target.value).slice(0,500)};
      };
      el('cm-density-save').onclick=()=>void (async()=>{
        try{
          const hint=parseAssetHint(densitySettings.assetUsageHint);
          if(Object.keys(hint).length){
            densitySettings=normalizeDensity({...densitySettings,...hint,displayPreset:'custom'});
          }
          await saveDensitySettings();
          invalidateDisplayCache();
          lastDiscovery.clear();
          message='에셋 표시·수집 설정 저장 완료';
          await render();
        }catch(e){message='설정 저장 실패: '+clip(e?.message||e,150);await render();}
      })();
      el('cm-diagnose').onclick=()=>void testCurrentChatAuto();
      el('cm-auto-collect').onchange=e=>{autoCollectEnabled=Boolean(e.target.checked);
        void saveAutoPrefs().then(()=>render()).catch(error=>{autoCollectStatus='설정 저장 실패 '+str(error?.message||error);void render();});};
      for(const node of document.querySelectorAll('[data-cm-dislike]')){
        node.onclick=()=>void dislikeAsset(str(node.getAttribute('data-cm-dislike-pack')),str(node.getAttribute('data-cm-dislike')))
          .catch(error=>{externalError='싫어요 실패 '+str(error?.message||error);void render();});
      }
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
    if(reviewFirst&&latestShown){
      const ci=await risuai.getCurrentCharacterIndex().catch(()=>-1);
      const ti=await risuai.getCurrentChatIndex().catch(()=>-1);
      if(ci!==latestShown.characterIndex||ti!==latestShown.chatIndex)latestShown=null;
    }
    await loadPacks();
    await loadAutoPrefs();
    await loadDensitySettings();
    await loadGelbooruAuth();
    await loadDisplayHistory();
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
  await loadPacks();
  await loadAutoPrefs();
  await loadDensitySettings();
  await loadGelbooruAuth();
  await loadDisplayHistory();
  async function openFeedback(){reviewFirst=true;await open();}
  // Register the settings entry first. An optional display hook failure must
  // never make the entire Character Mixer disappear from the UI.
  await risuai.registerSetting(NAME,open,'🧩','html','character-mixer-settings');
  try{
    await risuai.registerButton({name:NAME,icon:'🧩',iconType:'html',location:'hamburger',
      id:'character-mixer-hamburger'},open);
  }catch(error){console.log('[CharacterMixer] optional menu button unavailable',error);}
  try{
    await risuai.registerButton({name:'에셋 싫어요',icon:'👎',iconType:'html',location:'chat',
      id:'character-mixer-dislike-chat'},openFeedback);
  }catch(error){console.warn('[CharacterMixer] chat feedback button unavailable',error);}
  if(typeof risuai.addRisuChatListener==='function'){
    outputListener=async arg=>onCommittedChatOutput(arg);
    try{
      const allowed=typeof risuai.requestPluginPermission==='function'
        ?await risuai.requestPluginPermission('replacer'):true;
      if(!allowed){
        outputListenerAvailable=false;
        outputLastResult='생성 완료 이벤트 권한(replacer)이 허용되지 않았어. 플러그인 권한을 확인해.';
      }else{
        await risuai.addRisuChatListener('output',outputListener);
        outputListenerAvailable=true;
      }
    }catch(e){outputListenerAvailable=false;outputLastResult='출력 이벤트 등록 실패: '+clip(e?.message||e,140);}
  }else outputLastResult='현재 RisuBard에 생성 완료 이벤트 API가 없어';
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
    if(outputListener&&typeof risuai.removeRisuChatListener==='function'){
      try{await risuai.removeRisuChatListener('output',outputListener);}
      catch(e){console.warn('[CharacterMixer] output listener cleanup failed',e);}
    }
    if(displayHandler&&typeof risuai.removeRisuScriptHandler==='function'){
      try{await risuai.removeRisuScriptHandler('display',displayHandler);}
      catch(error){console.warn('[CharacterMixer] display hook cleanup:',error);}
    }
  });
})();
