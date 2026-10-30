//@name bard_editor_lab
//@display-name Bard Editor Lab
//@api 3.0
//@version 0.3.5
//@update-url https://raw.githubusercontent.com/pjb3181-prog/support-my-task/main/risubard-updates/bard_editor_lab.js
//@description Read-only first-message character voice anchor, long-term drift detection and grounded selective rewriting.
(async () => {
 const STORE='bard_editor_lab_v03'; const BACKUP_STORE='bard_editor_lab_v03_backups'; const ACTIVITY_STORE='bard_editor_lab_v034_activity';
 const DEFAULT={model:'otherAx',mode:'selective',auto:true,promptAssist:true,realEditor:true,momentum:true,voiceGuard:true,watchStoryRunner:false,timeoutMs:90000,maxChars:9000};
 let conf={...DEFAULT};
 let state={target:null,index:-1,original:'',revised:'',issues:[],status:'자동 퇴고 OFF',busy:false,lastAuto:'없음'};
 let uiOpen=false;let unloaded=false;let pollTimer=null;
 let recentActivity=[],activityView='auto',pickedActivity=0,activitySequence=0;
 const seen=new Set(),inflight=new Set(),initializedChats=new Set();
 const preSaveReviewed=new Map();
 const INLINE_HINT_ID='[BARD_EDITOR_LAB_STYLE_V033]';
 const txt=x=>String(x??'');
 const esc=x=>txt(x).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;','\'':'&#39;'}[c]));
 const clean=s=>{
   let t=txt(s)
     .replace(/<think\b[^>]*>[\s\S]*?<\/think>/gi,'')
     .replace(/<reasoning\b[^>]*>[\s\S]*?<\/reasoning>/gi,'');
   // Some providers expose a complete <Thoughts> prelude as plain response text.
   // It is not story canon, dialogue or an instruction to the editor.
   if(/^\s*<Thoughts\b/i.test(t)){
     const header=t.match(/^\s*<Thoughts\b[^>]*>[\s\S]*?<\/Thoughts>\s*/i);
     if(header)t=t.slice(header[0].length);
   }
   // Remove these exact tool/prose wrappers only when adjacent at the top.
   t=t.replace(/^\s*#\s*Approved\s*\r?\n\s*##\s*Response\s*(?:\r?\n)+/i,'');
   return t.trim();
 };
 const sig=s=>(txt(s).match(/<\/?[A-Z][A-Z0-9_]*(?:\s+[^<>]*?)?\s*\/?\s*>|\[[^\]\n]{1,36}:[^\]\n]{1,120}\]/g)||[]).join('\n');
 const obj=s=>{const t=clean(s).replace(/^\s*```(?:json)?/i,'').replace(/```\s*$/,'').trim();try{return JSON.parse(t)}catch(_){const i=t.indexOf('{'),j=t.lastIndexOf('}');if(i<0||j<=i)throw Error('편집장 JSON 응답 오류');return JSON.parse(t.slice(i,j+1))}};

 const eligible=source=>{
   const t=clean(source);
   if(t.length<240||t.length>conf.maxChars||(t.match(/[가-힣]/g)||[]).length<65)return false;
   if(/<(?:think|reasoning|thoughts|tool_call|function_call)\b/i.test(t))return false;
   if(/^\s*[\[{][\s\S]+[\]}]\s*$/.test(t)&&t.includes('":'))return false;
   const lines=t.split('\n').filter(x=>x.trim());
   if(lines.length>5&&lines.filter(x=>/^\s*(?:\d+\.|[-*]\s|#{1,5}\s|\|.*\|)/.test(x)).length>lines.length*.6)return false;
   return true;
 };
 function dialogueSignals(source){
   const t=clean(source);
   const turns=t.split(/\r?\n/).map(x=>x.trim())
     .filter(x=>/^(?:["“「『])[\s\S]{1,650}(?:["”」』])$/.test(x))
     .map(x=>x.slice(1,-1).replace(/[.…\s]+/g,' ').trim());
   const low=turns.filter(x=>x.length<=16
     && (/^(?:네|예|응|아|에|그래|그렇|맞|모르겠|뭐|왜|정말|진짜|그럼|그러면|그래서|아니면|두 번째|세 번째|첫 번째)/.test(x)
       || (x.length<=10&&/[?？]$/.test(x)))).length;
   const echo=turns.filter(x=>x.length<=18&&/[?？]$/.test(x)
      && /^(?:뭐|왜|그래|그렇|그럼|그러면|그래서|정말|진짜|아니면|다음|두 번째|세 번째|처음|보통|그게|이게|둘 다)/.test(x)).length;
   const repeatedMarkers=(t.match(/보통은|모르겠(?:어요|어|습니다)?|둘 다(?:요)?|만화(?:를)? 읽/g)||[]).length;
   const stockGestures=(t.match(/입꼬리|눈동자|손가락|시선을 피했|고개를 끄덕였|울면서 웃었다|볼이 빨개|손이 떨/g)||[]).length;
   const sentences=t.split(/[.!?。！？\n]+/).map(x=>x.trim()).filter(x=>x.length>16);
   const exactRepeats=sentences.length-new Set(sentences).size;
   const dialogueLoop=turns.length>=12&&(echo>=4||low>=7||repeatedMarkers>=8);
   const recycledBeatMentions=(t.match(/(?:또|다시|여전히|계속|아까처럼|똑같은 반응|또다시)/g)||[]).length;
   const passiveAnswers=(t.match(/(?:고개를 숙였|시선을 피했|입을 열었다가|말을 하려다가|그냥.{0,10}웃었다|무슨 말을 해야 할지 몰랐|다시.{0,12}여몄)/g)||[]).length;
   return {turns:turns.length,lowInformation:low,echoQuestions:echo,
     repeatedMarkers,stockGestures,exactRepeats,dialogueLoop,recycledBeatMentions,passiveAnswers};
 }

 // Reads the established first message as a style reference. Never writes to it.
 // Short texts and SMS are valid; flag repetitive low-information fragments, not length alone.
 function quoteLines(text){
   const lines=clean(text).split(/\r?\n/),out=[];
   for(const row of lines){
     const m=row.trim().match(/^["“「『]([^"”」』]{2,700})["”」』]$/);
     if(m)out.push(m[1].trim());
   }
   return out;
 }
 function namedTurns(text){
   const lines=clean(text).split(/\r?\n/),out=[];
   for(let i=0;i<lines.length-1;i++){
     const speaker=lines[i].trim().match(/^\[([^\]\r\n]{1,42})\]$/);
     if(!speaker)continue;
     const speech=lines[i+1].trim().match(/^["“「『]([^"”」』]{1,700})["”」』]$/);
     if(speech)out.push({speaker:speaker[1],text:speech[1].trim()});
   }
   return out;
 }
 function fillerSpeech(text){
   return /^(?:(?:…|\.|·|\s)+|(?:근데|그런데|네|예|응|아|그래|그렇구나|그럼|왜요|진짜요|그러니까|할게요|모르겠어요|알겠어요|알아요)(?:[.…!?？\s]*)|(?:그게|저기)(?:[.…!?？\s]*))$/.test(text.trim());
 }
 function voiceDriftSignals(draft,opening,name){
   const initial=quoteLines(opening);
   const all=namedTurns(draft);
   const npc=all.filter(x=>name&&x.speaker===name).map(x=>x.text);
   const uniqueRepeated=new Map();
   for(const line of npc){
     const norm=line.replace(/[.…!?？\s]/g,'');
     if(fillerSpeech(line))uniqueRepeated.set(norm,(uniqueRepeated.get(norm)||0)+1);
   }
   const fillerCount=npc.filter(fillerSpeech).length;
   const repeatFiller=[...uniqueRepeated.values()].reduce((a,n)=>a+Math.max(0,n-1),0);
   const baselineAvg=initial.length?initial.reduce((a,x)=>a+x.length,0)/initial.length:0;
   const currentAvg=npc.length?npc.reduce((a,x)=>a+x.length,0)/npc.length:0;
   // Several independent signals prevent ordinary brisk SMS from being treated
   // as degradation. Without a real first-message baseline, return uncertain.
   const severe=initial.length>=2&&baselineAvg>=24&&npc.length>=12
     &&fillerCount>=6&&repeatFiller>=4&&fillerCount/npc.length>=0.24
     &&currentAvg<baselineAvg*.70;
   return {hasAnchor:initial.length>=2,baselineTurns:initial.length,
     baselineAverage:Math.round(baselineAvg),npcTurns:npc.length,
     npcAverage:Math.round(currentAvg),lowInformation:fillerCount,
     repeatedFragments:repeatFiller,
     repeatedExamples:[...uniqueRepeated].filter(([,count])=>count>=2)
       .sort((a,b)=>b[1]-a[1]).slice(0,4).map(([phrase,count])=>({phrase,count})),
     severe};
 }
 async function editorialReference(chat,index,chara){
   let fromHost=null;
   try{if(typeof risuai.getCharacter==='function')fromHost=await risuai.getCharacter()}
   catch(err){console.log('[EditorLab] read-only first-message reference unavailable',err)}
   const canonical=(fromHost&&typeof fromHost==='object')?fromHost:{};
   const fallback=(chara&&typeof chara==='object')?chara:{};
   const name=txt(fallback.name||canonical.name||fallback.charaName||'').trim().slice(0,80);
   const messages=Array.isArray(chat?.message)?chat.message:[];
   const firstInChat=messages[0]&&['char','assistant'].includes(messages[0].role)
     &&index>0?txt(messages[0].data):'';
   // Prefer the selected opening message actually used in this chat, not a
   // different greeting branch. Never reinsert it into the chat.
   const fullOpening=clean(firstInChat||canonical.firstMessage||fallback.firstMessage||'');
   const opening=fullOpening.length>2400?fullOpening.slice(0,1700)+'\n[중간 생략]\n'
     +fullOpening.slice(-650):fullOpening;
   const personality=clean(canonical.personality||fallback.personality||'').slice(0,700);
   const description=clean(canonical.desc||fallback.desc||'').slice(0,700);
   return {
     name,opening,personality,description,
     recent:context(chat,index,canonical.name?canonical:fallback),
     // For backwards compatibility with older simulated hosts.
     baselineSource:firstInChat?'chat-selected-first-message':'character-firstMessage'
   };
 }
 function normalizedReference(background){
   if(background&&typeof background==='object'){
     return {name:txt(background.name),opening:txt(background.opening),
       personality:txt(background.personality),description:txt(background.description),
       recent:txt(background.recent)};
   }
   return {name:'',opening:'',personality:'',description:'',recent:txt(background)};
 }
 function anchorPrompt(reference){
   if(!conf.voiceGuard||!reference.opening)return '';
   return [
     '# ORIGINAL FIRST MESSAGE — READ-ONLY CHARACTER VOICE ANCHOR',
     'The following is how this character was initially written, NOT a scene to repeat.',
     'Compare stable temperament, personal motives, speaking texture and specificity.',
     'Allow organic relationship development, different emotional states and shorter SMS.',
     'Do not force original shyness, opening POV, actions or events back into later scenes.',
     reference.name?'Character: '+reference.name:'',
     reference.personality?'Personality: '+reference.personality:'',
     reference.description?'Description: '+reference.description:'',
     reference.opening
   ].filter(Boolean).join('\n');
 }
 function keepOtherSpeakerTurns(original,rewrite,npc){
   if(!npc)return '';
   const preserved=t=>namedTurns(t).filter(x=>x.speaker!==npc)
     .map(x=>x.speaker+'\t'+x.text);
   const a=preserved(original),b=preserved(rewrite);
   // Only compare tagged dialogue when both versions retain structured turns.
   if(a.length && (a.length!==b.length||a.some((x,i)=>x!==b[i])))
     return '플레이어 또는 타 인물의 기존 대사가 변경됨';
   return '';
 }

 const suspicious=source=>{
   const m=dialogueSignals(source);
   return m.dialogueLoop||m.exactRepeats>=1||m.stockGestures>=5||(m.recycledBeatMentions>=12&&m.passiveAnswers>=4);
 };
 const verify=(original,rewrite,reference=null)=>{
   const a=clean(original),b=clean(rewrite);
   if(!b||b.length<a.length*.64||b.length>a.length*1.45)return '문장 분량 변경 범위 초과';
   const tokens=t=>(t.match(/<[^<>]{1,120}>|\{\{[^{}\n]{1,120}\}\}|\[[A-Z][A-Z0-9 _:\-=.]{1,140}\]/gi)||[]).join('|');
   if(tokens(a)!==tokens(b))return '시스템 태그/상태 토큰 변경';
   const stats=t=>t.split(/\r?\n/).filter(x=>/^\s*(?:\[[^\]]{1,36}\]\s*[:=]|(?:HP|MP|STR|DEX|LV|LEVEL|STATUS|상태|체력|레벨|경험치)\s*[:：=])/i.test(x)).join('\n');
   if(stats(a)!==stats(b))return '상태창 내용 변경';
   const nums=t=>(t.match(/(?<![A-Za-z가-힣])\d+(?:\.\d+)?(?:%|kg|km|cm|초|분|시간|원)?/g)||[]).join('|');
   if(nums(a)!==nums(b))return '숫자/수치 변경';
   if(/<(?:think|reasoning|thoughts)\b/i.test(b))return '사고과정 출력';
   if(reference?.name){const changed=keepOtherSpeakerTurns(a,b,reference.name);if(changed)return changed;}
   const oldDialogue=dialogueSignals(a),newDialogue=dialogueSignals(b);
   if(oldDialogue.turns>=10&&newDialogue.turns>=8
     && newDialogue.lowInformation>oldDialogue.lowInformation+3)
     return '퇴고본에서 단순 문답이 크게 증가함';
   return '';
 };

 // This is transient model-input style guidance, not a change to any saved preset,
 // lorebook, character card, world rule or user utterance.
 const INLINE_GUIDANCE=INLINE_HINT_ID+'\n'
   +'Style only: all user decisions, established canon, personalities and world rules take priority.\n'
   +'Avoid question/echo/confirmation loops, passive interview-like NPCs, repeated apologies, blushes and body-detail descriptions.\n'
   +'Keep individual character voices, meaningful short lines and intentional quiet beats; do not merely elongate dialogue.\n'
   +'Output only the fiction, without <Thoughts>, planning, # Approved or ## Response.';
 const MOMENTUM_GUIDANCE='\nScene momentum: if this is a developed scene, let at least one concrete fact, choice, boundary, relationship, task, or next-step CHANGE on-page. A visit, small talk, repeated embarrassment and a return home alone are not necessarily progress. Use an NPC’s believable agency or an already introduced practical thread to move the scene; make the change have a consequence. Do not force romance, sex, a sudden crisis, player-character actions or a major new plot event. Intentional rest scenes may remain quiet; do not invent drama for its own sake.';

 function sourceFingerprint(value){
   const valueText=clean(value),str=valueText.length+'|'+valueText;
   let hash=2166136261;for(let i=0;i<str.length;i++)hash=Math.imul(hash^str.charCodeAt(i),16777619);
   return (hash>>>0).toString(16)+':'+valueText.length;
 }
 function markPreSave(value,activityId=''){
   const now=Date.now();
   for(const [k,entry] of preSaveReviewed)if(now-(entry?.at||0)>120000)preSaveReviewed.delete(k);
   preSaveReviewed.set(sourceFingerprint(value),{at:now,activityId});
   while(preSaveReviewed.size>80)preSaveReviewed.delete(preSaveReviewed.keys().next().value);
 }
 function alreadyPreSaved(value){
   const entry=preSaveReviewed.get(sourceFingerprint(value));
   return !!entry && Date.now()-entry.at<120000;
 }
 const recordText=value=>{
   const s=clean(value),limit=19000;
   return s.length>limit?s.slice(0,limit)+'\n\n[자동 기록 미리보기: 이후 본문 생략]':s;
 };
 async function recordAutomatic({phase,outcome,reason,original='',revised='',issues=[],calls=0}){
   const now=Date.now();
   const record={id:String(now)+'-'+(++activitySequence),at:now,
     phase:txt(phase),outcome:txt(outcome),reason:txt(reason).slice(0,900),
     original:recordText(original),revised:recordText(revised),
     issues:(Array.isArray(issues)?issues:[]).filter(x=>x&&typeof x.problem==='string')
       .slice(0,4).map(x=>({problem:txt(x.problem).slice(0,350),instruction:txt(x.instruction).slice(0,350)})),
     calls:Math.max(0,Math.min(2,Number(calls)||0)),committed:outcome==='applied'};
   recentActivity.unshift(record);
   recentActivity=recentActivity.slice(0,5);
   pickedActivity=0;
   state.lastAuto=record.phase+' · '+record.reason;
   try{await risuai.pluginStorage.setItem(ACTIVITY_STORE,recentActivity)}
   catch(error){console.log('[EditorLab] automatic activity persistence unavailable',error)}
   if(uiOpen&&activityView==='auto')void render().catch(error=>console.log('[EditorLab] activity view',error));
   return record.id;
 }
 async function confirmAutoCommitted(text){
   const entry=preSaveReviewed.get(sourceFingerprint(text));
   if(!entry?.activityId)return;
   const record=recentActivity.find(x=>x.id===entry.activityId);
   if(!record||record.committed)return;
   record.committed=true;
   if(record.outcome==='pending')record.outcome='applied';
   record.reason+=' · 채팅 저장 확인';
   state.lastAuto=record.phase+' · '+record.reason;
   try{await risuai.pluginStorage.setItem(ACTIVITY_STORE,recentActivity)}
   catch(error){console.log('[EditorLab] confirmed activity write failed',error)}
   if(uiOpen&&activityView==='auto')void render().catch(()=>{});
 }

 async function injectStyleBeforeRequest(messages,type){
   if(unloaded||!conf.auto||!conf.promptAssist||type!=='model'||!Array.isArray(messages))return messages;
   // Only amend normal text-chat model prompts, not a structured task.
   if(messages.length<2||!messages.some(x=>x?.role==='user' && typeof x.content==='string'))return messages;
   if(messages.some(x=>typeof x?.content==='string' && x.content.includes(INLINE_HINT_ID)))return messages;
   const amended=messages.map(message=>({...message}));
   const index=amended.findIndex(x=>x?.role==='system' && typeof x.content==='string');
   let voiceHint='';
   if(conf.voiceGuard&&typeof risuai.getCharacter==='function'){
     try{
       const currentChar=await risuai.getCharacter();
       const lines=quoteLines(currentChar?.firstMessage||'').slice(0,2);
       const sample=lines.join(' / ').slice(0,420);
       if(sample)voiceHint='\nRead-only opening speech reference for '+txt(currentChar?.name).slice(0,60)
         +': '+sample+'\nPreserve enduring individuality only. Never copy this dialogue or force the character to remain shy, stuttering or unchanged after development.';
     }catch(error){console.log('[EditorLab] prompt reference unavailable',error)}
   }
   const guidance=INLINE_GUIDANCE+(conf.momentum?MOMENTUM_GUIDANCE:'')+voiceHint;
   if(index>=0)amended[index].content+='\n\n'+guidance;
   else amended.unshift({role:'system',content:guidance});
   return amended;
 }

 async function reviseBeforeSave(response,type){
   if(unloaded||!conf.auto||!conf.realEditor||type!=='model'||typeof response!=='string')return response;
   if(alreadyPreSaved(response))return response;
   try{
     let reference={};
     try{
       const live=await current();
       const nextIndex=Array.isArray(live.chat?.message)?live.chat.message.length:0;
       reference=await editorialReference(live.chat,nextIndex,null);
     }catch(error){
       console.log('[EditorLab] first-message reference unavailable for pre-save',error);
       reference=await editorialReference(null,0,null).catch(()=>({}));
     }
     const result=await pipeline(response,reference);
     const final=result.revised||response;
     const outcome=!eligible(response)?'skipped':result.revised?'pending':'unchanged';
     const id=await recordAutomatic({phase:'저장 전 편집',outcome,reason:result.reason,
       original:response,revised:result.revised,issues:result.issues,calls:result.calls||0});
     // The output hook may later confirm actual chat persistence. Do not call
     // this 'applied' until a committed message has been observed.
     markPreSave(response,id);markPreSave(final,id);
     return final;
   }catch(error){
     const id=await recordAutomatic({phase:'저장 전 편집',outcome:'error',
       reason:'원문 유지 · '+txt(error?.message||error),original:response,calls:0});
     markPreSave(response,id);
     return response;
   }
 }

 async function save(){await risuai.pluginStorage.setItem(STORE,conf)}
 async function current(){const ci=await risuai.getCurrentCharacterIndex(),ti=await risuai.getCurrentChatIndex(),chat=await risuai.getChatFromIndex(ci,ti);return {ci,ti,chat,id:txt(chat?.id)}}
 async function load(){const c=await current(),messages=Array.isArray(c.chat?.message)?c.chat.message:[];let i=-1;for(let j=messages.length-1;j>=0;j--)if(['char','assistant'].includes(messages[j]?.role)){i=j;break}if(i<0)throw Error('AI 메시지가 없음');state={...state,target:{ci:c.ci,ti:c.ti,id:c.id},index:i,original:txt(messages[i].data),revised:'',issues:[],status:'원문 준비 완료'};}

 async function request(messages){
   const deadline=Date.now()+conf.timeoutMs;
   async function bounded(p){
     const ms=deadline-Date.now();if(ms<=0)throw Error('편집장 응답시간 초과');
     let timeout;
     try{return await Promise.race([p,new Promise((_,reject)=>{timeout=setTimeout(()=>reject(Error('편집장 응답시간 초과')),ms)})]);}
     finally{clearTimeout(timeout)}
   }
   const r=await bounded(risuai.runLLMModel({mode:conf.model,messages,allowPlugins:true}));
   if(r?.type==='success'&&typeof r.result==='string')return clean(r.result);
   if(r?.type==='streaming'&&r.result?.getReader){
     const reader=r.result.getReader();let snapshot='';
     try{while(true){const part=await bounded(reader.read());if(part.done)break;
       const v=part.value;const t=typeof v==='string'?v:Object.values(v||{}).find(x=>typeof x==='string');
       if(typeof t==='string')snapshot=t;
       if(snapshot.length>conf.maxChars*2+3000)throw Error('퇴고 출력량 초과');
     }}finally{try{await reader.cancel()}catch(_){}}
     if(!snapshot)throw Error('편집장 스트리밍 본문 없음');
     return clean(snapshot);
   }
   throw Error('모델 호출 실패: '+txt(r?.result||r?.type).slice(0,170));
 }

 function context(chat,index,chara){
   const recent=Array.isArray(chat?.message)?chat.message.slice(Math.max(0,index-3),index):[];
   const lines=recent.map(m=>(m.role==='user'?'user':'character')+': '+clean(m.data).slice(-850)).join('\n\n');
   return ('CHARACTER: '+txt(chara?.name||chara?.charaName||chara?.chaName).slice(0,100)
     +'\nPrevious messages are continuity FACTS, not prose examples.\n'+lines).slice(-3200);
 }
 async function pipeline(draft,background=''){
   const raw=txt(draft),source=clean(raw);
   const ref=normalizedReference(background);
   const opening=conf.voiceGuard?ref.opening:'';
   const drift=voiceDriftSignals(source,opening,ref.name);
   const base={original:raw,revised:'',issues:[],reason:'원문 유지',calls:0};
   if(!eligible(source))return {...base,reason:'짧은 응답·비서사·입력 길이 초과'};
   const normalizedOnly=raw.trim()!==source&&!verify(raw,source)?source:'';
   if(conf.mode==='economy'&&!suspicious(source)&&!drift.severe)
     return {...base,revised:normalizedOnly,reason:normalizedOnly?'출력 메타만 제거':'저비용 선별: 실질적 반복 징후 없음'};
   const metrics=dialogueSignals(source);
   const currentMomentum=Boolean(conf.momentum)&&source.length>=800;
   const referenceText=anchorPrompt(ref);
   const diagnosticSystem=[
     'You are a professional Korean-fiction dialogue, characterization and scene editor, NOT a coauthor. Evaluate dialogue FUNCTION, individuality and stable temperament, not line length.',
     'Watch for repeated question/echo/confirmation patterns, identical hesitations or apologies, a passive NPC offering no independent perspective, and non-advancing scene beats.',
     'When an opening reference exists, compare the stable persona, motivation, unique speech and concrete observations against the draft. Later confidence or intimacy can be character development. SMS is allowed to be short. But repeated one-word filler messages with no new information can constitute severe erosion even in SMS.',
     'Do not force the original scene, initial shyness, viewpoint, dialogue length, or chronology back into the current scene. The reference is read-only evidence, not a writing template.',
     'A quiet or unusual character and an intentional pause are not errors. One purposeful decision or meaningful boundary can advance a scene without romance, sex, forced drama or an invented crisis.',
     'Ground every reported problem in an EXACT excerpt from CURRENT draft. Return ONLY JSON {"revise":boolean,"characterFidelity":{"status":"faithful|degrading|developing|insufficient_reference","evidence":string,"justification":string},"sceneProgress":{"material":boolean,"evidence":string,"intentionalStillness":boolean},"issues":[{"excerpt":string,"problem":string,"instruction":string}],"strengths":[string],"summary":string}. At most four issues.'
   ].join(' ');
   const diagnosticUser='# HEURISTIC SIGNALS (NOT VERDICTS)\n'+JSON.stringify(metrics)
     +'\n# ORIGINAL-VOICE DRIFT MEASURES (NOT VERDICTS)\n'+JSON.stringify(drift)
     +'\n# SCENE MOMENTUM\n'+(currentMomentum?'Evaluate material change unless intentionally quiet':'Short scene: do not force progress')
     +'\n\n'+(referenceText||'# OPENING VOICE REFERENCE NOT AVAILABLE')
     +'\n\n# RECENT STORY FACTS (continuity, do not imitate prose flaws)\n'+ref.recent
     +'\n\n# FINISHED DRAFT TO REVIEW\n'+source;
   const diagnostic=await request([{role:'system',content:diagnosticSystem},{role:'user',content:diagnosticUser}]);
   const verdict=obj(diagnostic);
   if(!verdict||typeof verdict.revise!=='boolean'||!Array.isArray(verdict.issues))
     throw Error('편집장 진단 형식 오류');
   const momentumGap=currentMomentum&&verdict.sceneProgress?.material===false
     &&verdict.sceneProgress?.intentionalStillness!==true;
   const issues=verdict.issues.filter(x=>x&&typeof x.excerpt==='string'
       &&typeof x.problem==='string'&&typeof x.instruction==='string')
     .map(x=>({excerpt:x.excerpt.trim().slice(0,180),problem:x.problem.trim().slice(0,280),
       instruction:x.instruction.trim().slice(0,350)}))
     .filter(x=>x.problem&&x.instruction&&(!x.excerpt||source.includes(x.excerpt))).slice(0,4);
   // An extreme objective decline must not silently pass just because the
   // critic model answered revise=false. This is a risk signal, not a guarantee.
   if(conf.voiceGuard&&drift.severe&&!issues.some(x=>/말투|단편|대사|문답|반복|캐릭터|개성/.test(x.problem))){
     const repeated=namedTurns(source).find(x=>x.speaker===ref.name&&fillerSpeech(x.text));
     issues.unshift({excerpt:repeated?.text||drift.repeatedExamples[0]?.phrase||'',
       problem:'초기 캐릭터 표현력에 비해 정보 없는 단편 반응과 동일한 말버릇이 과도하게 반복되어 캐릭터성이 희미해짐',
       instruction:'독특한 관찰·의견·목적·선택을 현재 관계 변화에 맞게 회복. SMS는 짧아도 되지만 반복되는 빈 문자를 줄일 것. 첫 메시지 장면이나 초기의 수줍음으로 되돌리지는 말 것.'});
     issues.splice(4);
   }
   if(momentumGap&&!issues.length){
     issues.push({excerpt:source.slice(-Math.min(125,source.length)).trim(),
       problem:'장면 시작과 끝에 상황 변화가 없어 방문·대화가 제자리걸음 함',
       instruction:'이미 언급된 요청·거절·관심사 중 하나를 활용해 NPC의 작은 선택, 경계나 구체적인 다음 행동을 만들되 플레이어의 대사를 새로 쓰지 말 것.'});
   }
   const shouldRevise=verdict.revise||momentumGap||(conf.voiceGuard&&drift.severe);
   if(!shouldRevise||!issues.length)
     return {...base,revised:normalizedOnly,issues,calls:1,
       reason:normalizedOnly?'수정 불필요 · 출력 메타만 제거':'편집장 진단: 실질적 수정 불필요'};
   const revisionSystem=[
     'You are a surgical Korean-fiction editor. Return the FULL revised fiction only, not notes, JSON or analysis.',
     'Fix ONLY grounded issues. Preserve events, chronology, established voices, canon, user-controlled dialogue, character motivations, relationships, choices, locations, exact status windows, image tags and numerical values.',
     'Where flagged for voice erosion, recover individuality through concrete character-specific observations, reasons, humor, goals or boundaries. Replace or combine repeated empty fragments. Keep brief SMS when meaningful and do not increase word count mechanically.',
     'Reference the FIRST MESSAGE only for enduring personality and speaking texture. Do not copy its text or revert developments, emotions, relationships, viewpoint or temporal setting.',
     'If scene stagnation is grounded, permit only ONE modest NPC-initiated, causally supported beat from already established threads. Do not invent a new major plot, romantic/sexual escalation, spouse confrontation or player choices.',
     'Never narrate unspoken thoughts of others as certain. Reduce repeated blushing, eyes, fingers and body details when they add nothing. Retain the open ending.'
   ].join(' ');
   const revision=await request([{role:'system',content:revisionSystem},{
     role:'user',content:'# GROUNDED ISSUES\n'+JSON.stringify(issues)
       +'\n\n'+(referenceText||'# FIRST MESSAGE REFERENCE UNAVAILABLE')
       +'\n\n# RECENT CONTINUITY\n'+ref.recent+'\n\n# ORIGINAL DRAFT\n'+source
   }]);
   const error=verify(raw,revision,ref);
   if(error)return {...base,revised:normalizedOnly,issues,calls:2,reason:'퇴고본 보류: '+error};
   const afterDrift=voiceDriftSignals(revision,opening,ref.name);
   const unresolved=drift.severe&&afterDrift.severe
     &&afterDrift.lowInformation>=Math.max(5,drift.lowInformation-1)
     &&afterDrift.repeatedFragments>=Math.max(3,drift.repeatedFragments-1);
   if(unresolved)return {...base,revised:normalizedOnly,issues,calls:2,
     reason:'퇴고본 보류: 초기 캐릭터성 대비 반복 단편 대사가 충분히 개선되지 않음'};
   if(revision===source)return {...base,revised:normalizedOnly,issues,calls:2,
     reason:drift.severe?'퇴고 미반영: 반복 단편 대사가 여전히 남음':'퇴고 원문과 동일'};
   return {original:raw,revised:revision,issues,calls:2,
     reason:drift.severe?'캐릭터성 붕괴 신호 감지 · 교정본 구조 검증 통과':'퇴고본 구조 검증 통과 (실제 문학적 품질은 별도 검토 필요)'};
 }
 const outputKey=(ci,ti,id,i,m)=>[ci,ti,id,i,txt(m?.chatId||m?.time),txt(m?.data).length,txt(m?.data).slice(0,80)].join('|');
 const remember=k=>{seen.add(k);if(seen.size>200)seen.delete(seen.values().next().value)};
 const same=(meta,live)=>meta&&meta.ci===live.ci&&meta.ti===live.ti&&meta.id===live.id;
 async function backup(meta,original,revised){
   if(original.length>200000||revised.length>200000)
     throw Error('원문이 백업 용량 안전 한도를 초과하여 수정하지 않았어');
   const old=await risuai.pluginStorage.getItem(BACKUP_STORE);
   const records=Array.isArray(old)?old:[];
   // Store the ENTIRE raw response, including any removed reasoning prelude.
   // Truncating by the editor's input limit could make restoration impossible.
   records.unshift({ci:meta.ci,ti:meta.ti,id:meta.id,index:meta.index,messageId:meta.messageId,
     original,revised,at:Date.now()});
   await risuai.pluginStorage.setItem(BACKUP_STORE,records.slice(0,5));
 }
 async function commit(meta,original,revised,recordBackup=true,knownRestore=false){
   const live=await current();
   if(!same(meta,live))throw Error('다른 채팅으로 바뀌어 적용하지 않았어');
   const messages=live.chat?.message;
   if(!Array.isArray(messages)||meta.index!==messages.length-1)throw Error('뒤에 새 메시지가 추가되어 적용하지 않았어');
   const m=messages[meta.index];
   if(!m||!['char','assistant'].includes(m.role)||txt(m.data)!==original)throw Error('원문이 변경되어 적용하지 않았어');
   if(meta.messageId&&txt(m.chatId||m.time)!==meta.messageId)throw Error('메시지 식별자 변경');
   if(!knownRestore){const fail=verify(original,revised);if(fail)throw Error('검증 실패 · '+fail);}
   // Fail closed if safe storage fails: do not alter chat before backup succeeds.
   if(recordBackup)await backup(meta,original,revised);
   const next=JSON.parse(JSON.stringify(live.chat));next.message[meta.index].data=revised;
   await risuai.setChatToIndex(meta.ci,meta.ti,next);
   remember(outputKey(meta.ci,meta.ti,meta.id,meta.index,next.message[meta.index]));
 }
 async function run(){
   if(state.busy)return;
   state.busy=true;state.status='수동 검수 진행 중';if(uiOpen)await render();
   try{
     if(!state.target)await load();
     const now=await current();
     if(!same(state.target,now))throw Error('채팅이 전환되었어');
     const message=now.chat?.message?.[state.index];
     if(!message||txt(message.data)!==state.original)throw Error('원본 메시지가 달라졌어');
     state.target={...state.target,index:state.index,messageId:txt(message.chatId||message.time)};
     const reference=await editorialReference(now.chat,state.index,null);
     const result=await pipeline(state.original,reference);
     state.issues=result.issues;state.revised=result.revised;state.status=result.reason;
   }catch(e){state.revised='';state.status='원문 유지 · '+txt(e.message||e)}
   finally{state.busy=false;if(uiOpen)await render()}
 }
 async function apply(){
   if(state.busy||!state.revised||!state.target)return;
   await commit(state.target,state.original,state.revised);
   state.original=state.revised;state.revised='';state.status='사용자 승인 퇴고본 적용 · 원문 백업됨';
 }
 async function automatic(arg,sourceLabel){
   if(!conf.auto||unloaded||!arg||!Number.isInteger(arg.messageIndex)||!Array.isArray(arg.chat?.message))return;
   const i=arg.messageIndex,m=arg.chat.message[i],ci=arg.characterIndex,ti=arg.chatIndex;
   if(!Number.isInteger(ci)||!Number.isInteger(ti)||!m||!['char','assistant'].includes(m.role)||i!==arg.chat.message.length-1)return;
   const original=txt(m.data);
   if(alreadyPreSaved(original)){await confirmAutoCommitted(original);return}
   const id=txt(arg.chat.id),k=outputKey(ci,ti,id,i,m);
   if(seen.has(k)||inflight.has(k))return;
   remember(k);inflight.add(k);
   try{
     if(!conf.realEditor){
       await recordAutomatic({phase:sourceLabel,outcome:'skipped',reason:'프롬프트 보조만 활성화 · 별도 편집 모델 호출 안 함',original,calls:0});
       return;
     }
     if(!eligible(original)){
       await recordAutomatic({phase:sourceLabel,outcome:'skipped',reason:'짧은 응답·비서사·입력 길이 초과',original,calls:0});
       return;
     }
     const reference=await editorialReference(arg.chat,i,arg.char||{});
     const result=await pipeline(original,reference);
     if(result.revised){
       await commit({ci,ti,id,index:i,messageId:txt(m.chatId||m.time)},original,result.revised);
       await recordAutomatic({phase:sourceLabel,outcome:'applied',reason:'채팅에 퇴고본 반영 · '+result.reason,
         original,revised:result.revised,issues:result.issues,calls:result.calls||0});
     }else{
       await recordAutomatic({phase:sourceLabel,outcome:'unchanged',reason:result.reason,
         original,issues:result.issues,calls:result.calls||0});
     }
   }catch(error){
     await recordAutomatic({phase:sourceLabel,outcome:'error',reason:'원문 유지 · '+txt(error?.message||error),original,calls:0});
   }finally{inflight.delete(k);if(uiOpen&&activityView==='auto')void render().catch(()=>{})}
 }
 async function pollStoryRunner(){
   if(!conf.auto||!conf.realEditor||!conf.watchStoryRunner||unloaded)return;
   try{
     const t=await current(),messages=t.chat?.message;
     if(!Array.isArray(messages)||!messages.length)return;
     const i=messages.length-1,m=messages[i];
     if(!m||!['char','assistant'].includes(m.role)||!/^srmsg/i.test(txt(m.chatId)))return;
     const session=[t.ci,t.ti,t.id].join('|'),key=outputKey(t.ci,t.ti,t.id,i,m);
     if(!initializedChats.has(session)){initializedChats.add(session);remember(key);return}
     if(seen.has(key))return;
     await automatic({characterIndex:t.ci,chatIndex:t.ti,chat:t.chat,char:{},messageIndex:i},'Story Runner 직접 생성');
   }catch(e){console.log('[EditorLab] direct-run watcher error',e)}
 }
 async function restoreLast(){
   const old=await risuai.pluginStorage.getItem(BACKUP_STORE);
   if(!Array.isArray(old)||!old.length)throw Error('복원할 원문 백업 없음');
   const last=old[0];
   await commit(last,last.revised,last.original,false,true);
   old.shift();await risuai.pluginStorage.setItem(BACKUP_STORE,old);
   state.status='최근 퇴고를 원문으로 복원했어';
 }
 async function render(){
   if(!uiOpen)return;
   const activity=recentActivity[pickedActivity]||null;
   const showingAuto=activityView==='auto';
   const visibleOriginal=showingAuto?(activity?.original||'') : state.original;
   const visibleRevised=showingAuto?(activity?.revised||'') : state.revised;
   const visibleIssues=showingAuto?(activity?.issues||[]) : state.issues;
   document.body.innerHTML=`<style>
    body{background:#171d2b;color:#edf0ff;font:14px/1.6 system-ui;margin:0;padding:18px}main{max-width:1100px;margin:auto}
    button,select{color:#fff;background:#334568;border:1px solid #63769d;border-radius:8px;padding:9px;cursor:pointer;font:inherit}
    button:disabled{opacity:.4;cursor:not-allowed}
    textarea{width:100%;height:310px;box-sizing:border-box;background:#111827;color:#edf0ff;border:1px solid #52617f;border-radius:8px;padding:12px;line-height:1.7}
    .pair{display:grid;grid-template-columns:1fr 1fr;gap:12px}.top{display:flex;flex-wrap:wrap;gap:8px;margin:12px 0;align-items:center}
    .status{padding:12px;background:#243046;border-radius:10px}pre{white-space:pre-wrap;overflow-wrap:anywhere}
    .muted{color:#afbedb;font-size:12px}@media(max-width:720px){.pair{grid-template-columns:1fr}body{padding:11px}}
  </style><main><h2>Bard Editor Lab v0.3.5</h2>
  <p class="muted">본체·프리셋 수정 없음 · 메인 채팅에 짧은 편집 지침 삽입 + 모델을 이용한 선택적 퇴고</p>
  <div class="top">
    <button id="auto">${conf.auto?'자동 퇴고 ON — 끄기':'자동 퇴고 OFF — 켜기'}</button>
    <select id="model">
      <option value="otherAx" ${conf.model==='otherAx'?'selected':''}>기존 보조 모델 (otherAx)</option>
      <option value="model" ${conf.model==='model'?'selected':''}>기존 메인 모델</option>
    </select>
    <select id="mode">
      <option value="selective" ${conf.mode==='selective'?'selected':''}>선택적 · 매 턴 진단, 필요할 때만 퇴고</option>
      <option value="economy" ${conf.mode==='economy'?'selected':''}>저비용 · 반복 징후 있을 때만 진단</option>
    </select>
  </div>
  <div class="top">
    <label><input type="checkbox" id="promptassist" ${conf.promptAssist?'checked':''}/> 생성 전 프롬프트에 편집 원칙 추가 (추가 모델 호출 없음)</label>
    <label><input type="checkbox" id="realeditor" ${conf.realEditor?'checked':''}/> 생성 후 편집장 모델로 선택적 검수·퇴고 (모델 호출 비용 발생)</label>
    <label><input type="checkbox" id="momentum" ${conf.momentum?'checked':''}/> 장면 정체 감지·자연스러운 진전 유도 (강제 사건 없음)</label>
    <label><input type="checkbox" id="voiceguard" ${conf.voiceGuard?'checked':''}/> 첫 메시지 캐릭터성 기준 유지 · 단편 대사 붕괴 감지 (첫 메시지 읽기 전용)</label>
  </div>
  <p class="muted">첫 메시지는 수정하지 않고 캐릭터의 고유 말투만 참고해. 문자 대화의 짧은 문장은 허용하되 정보 없는 반복 응답은 감지해. 장면 정체 방지도 무리한 사건을 요구하지 않아.</p>
  <p class="muted">일반 비스트리밍 응답은 저장 전 교정. 스트리밍은 원문 표시가 끝난 뒤 교체될 수 있어. 기존 사용자 설정의 자동 OFF는 유지돼.</p>
  <div class="top">
    <label><input id="srwatch" type="checkbox" ${conf.watchStoryRunner?'checked':''}/> Story Runner 직접 생성도 감시 (수동 삽입 포함 가능)</label>
    <label>최대 입력 <select id="max">${[4500,7000,9000,12000,18000].map(n=>`<option value="${n}" ${conf.maxChars===n?'selected':''}>${n.toLocaleString()}자</option>`).join('')}</select></label>
    <button id="restore">가장 최근 퇴고 원본 복원</button>
  </div>
  <p class="status">현재 설정: <strong>${conf.auto?'자동 퇴고 ON':'자동 퇴고 OFF'}</strong> · ${conf.realEditor?'편집장 모델 검수 ON':'편집장 모델 검수 OFF'}<span class="muted"><br/>최근 자동 작업: ${esc(state.lastAuto)}</span></p>
  <div class="top">
    <button id="viewauto" ${showingAuto?'disabled':''}>최근 자동 퇴고 결과</button>
    <button id="viewmanual" ${!showingAuto?'disabled':''}>수동 검수 화면</button>
    <button id="load">마지막 AI 본문 불러오기</button>
    <button id="run" ${state.busy?'disabled':''}>수동 검수 실행</button>
    <button id="apply" ${showingAuto||!state.revised||state.busy?'disabled':''}>수동 퇴고본 적용</button>
    <button id="close">닫기</button>
  </div>
  ${showingAuto?`<div class="status"><strong>자동 작업 내역 (최근 ${recentActivity.length}건)</strong><br/>
    ${recentActivity.length?`<select id="activity-select" style="max-width:100%;margin:8px 0">
      ${recentActivity.map((x,i)=>`<option value="${i}" ${i===pickedActivity?'selected':''}>${esc(new Date(x.at).toLocaleString('ko-KR'))} · ${esc(x.phase)} · ${esc(x.outcome)}</option>`).join('')}
      </select><div>${esc(activity?.reason||'')}</div><small class="muted">상태: ${esc(activity?.outcome||'')} · 추가 모델 호출 ${activity?.calls??0}회 · ${activity?.committed?'채팅 저장 확인 또는 교정 반영':'채팅 저장 확인 전/미적용'}</small>`
      :'<p>자동 작업 기록이 없어. 자동 퇴고를 ON으로 켜고 새 채팅 응답을 생성하면 여기 표시돼.</p>'}
    </div>`:''}
  <div class="pair">
    <section><h3>${showingAuto?'자동 검사 원문':'수동 검사 원문'}</h3><textarea readonly placeholder="아직 검사된 원문 없음">${esc(visibleOriginal)}</textarea></section>
    <section><h3>${showingAuto?'자동 퇴고 결과':'수동 퇴고본 (미적용)'}</h3><textarea readonly placeholder="${showingAuto?'교정 불필요·검사 제외·실패 시 비어 있어':'수동 검수 후 표시'}">${esc(visibleRevised)}</textarea></section>
  </div>
  <h3>편집장 진단</h3><pre>${esc(visibleIssues.map((x,i)=>`${i+1}. ${x.problem} — ${x.instruction}`).join('\n')||(showingAuto?(activity?.reason||'자동 진단 기록 없음'):'수동 진단 기록 없음'))}</pre>
  <p class="muted">한 응답당 최대 2회 모델 호출. 사고과정/메타 출력은 본문과 분리해 검사해. 실패 시 원문 유지. 최근 5건의 원문 전체를 플러그인 저장소에 백업해.
  타임아웃은 대기를 중단하지만 모델 과금 취소를 보장하지 않아.</p></main>`;
  const el=id=>document.getElementById(id);
   el('auto').onclick=async()=>{conf.auto=!conf.auto;await save();state.status=conf.auto?'자동 퇴고 활성화':'자동 퇴고 비활성화';await render()};
   el('viewauto').onclick=async()=>{activityView='auto';pickedActivity=0;await render()};
   el('viewmanual').onclick=async()=>{activityView='manual';await render()};
   const activitySelect=el('activity-select');
   if(activitySelect)activitySelect.onchange=async e=>{pickedActivity=Number(e.target.value)||0;await render()};
  el('promptassist').onchange=async e=>{conf.promptAssist=e.target.checked;await save()};
  el('realeditor').onchange=async e=>{conf.realEditor=e.target.checked;await save()};
  el('momentum').onchange=async e=>{conf.momentum=e.target.checked;await save()};
  el('voiceguard').onchange=async e=>{conf.voiceGuard=e.target.checked;await save()};
  el('model').onchange=async e=>{conf.model=e.target.value;await save()};
  el('mode').onchange=async e=>{conf.mode=e.target.value;await save()};
  el('max').onchange=async e=>{conf.maxChars=Number(e.target.value);await save()};
  el('srwatch').onchange=async e=>{conf.watchStoryRunner=e.target.checked;initializedChats.clear();await save()};
   el('load').onclick=()=>{activityView='manual';return load().then(render).catch(e=>{state.status=txt(e.message);render()})};
   el('run').onclick=()=>{activityView='manual';return run()};
   el('apply').onclick=()=>{if(activityView!=='manual')return;return apply().then(render).catch(e=>{state.status='적용 차단 · '+txt(e.message);render()})};
  el('restore').onclick=()=>restoreLast().then(render).catch(e=>{state.status='복원 실패 · '+txt(e.message);render()});
  el('close').onclick=()=>{uiOpen=false;void risuai.hideContainer()};
}

 const saved=await risuai.pluginStorage.getItem(STORE).catch(()=>null);
 if(saved&&typeof saved==='object'){
   conf={...DEFAULT,...saved};
   if(!['otherAx','model'].includes(conf.model))conf.model='otherAx';
   if(!['selective','economy'].includes(conf.mode))conf.mode='selective';
   if(![4500,7000,9000,12000,18000].includes(Number(conf.maxChars)))conf.maxChars=9000;
   conf.timeoutMs=90000;
 }
 try{const savedActivity=await risuai.pluginStorage.getItem(ACTIVITY_STORE);
     if(Array.isArray(savedActivity))recentActivity=savedActivity.filter(x=>x&&typeof x.id==='string'&&typeof x.original==='string').slice(0,5);
   }catch(error){console.log('[EditorLab] previous automatic activity unavailable',error)}
 state.status=conf.auto?'자동 퇴고 활성화':'자동 퇴고 비활성화';
 if(recentActivity.length)state.lastAuto=recentActivity[0].phase+' · '+recentActivity[0].reason;
 async function open(){uiOpen=true;activityView='auto';pickedActivity=0;await render();await risuai.showContainer('fullscreen')}
 await risuai.registerSetting('Bard Editor Lab',open,'✍️','html','bard-editor-lab-settings');
 await risuai.registerButton({name:'Bard Editor Lab',icon:'✍️',iconType:'html',location:'hamburger',id:'bard-editor-lab-hamburger'},open);
 // Register through public plugin APIs; host main/core and prompt presets stay untouched.
 // Main provider -> beforeRequest (all streams) -> afterRequest (nonstream) ->
 // committed-chat output fallback (streams). Editor LLM uses runLLMModel()
 // which dispatches through requestChatDataMain, not these replacers.
 const hooks=[];
 if(typeof risuai.addRisuReplacer==='function'){
   try{
     await risuai.addRisuReplacer('beforeRequest',injectStyleBeforeRequest);
     hooks.push(['beforeRequest',injectStyleBeforeRequest]);
     await risuai.addRisuReplacer('afterRequest',reviseBeforeSave);
     hooks.push(['afterRequest',reviseBeforeSave]);
   }catch(error){console.log('[EditorLab] prompt/inline hook registration unavailable',error);}
 }
 await risuai.addRisuChatListener('output',arg=>automatic(arg,'일반 채팅'));
 pollTimer=setInterval(()=>{void pollStoryRunner()},2800);
 await risuai.onUnload(async()=>{
   unloaded=true;
   if(pollTimer)clearInterval(pollTimer);
   if(typeof risuai.removeRisuReplacer==='function'){
     for(const [type,handler] of hooks)
       try{await risuai.removeRisuReplacer(type,handler)}catch(_){}
   }
 });
})();
