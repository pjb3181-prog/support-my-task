//@name bard_editor_lab
//@display-name Bard Editor Lab
//@api 3.0
//@version 0.3.3
//@update-url https://raw.githubusercontent.com/pjb3181-prog/support-my-task/main/risubard-updates/bard_editor_lab.js
//@description Scene-momentum and dialogue-quality guidance with optional model-backed revision; no RisuBard core changes.
(async () => {
 const STORE='bard_editor_lab_v03'; const BACKUP_STORE='bard_editor_lab_v03_backups';
 const DEFAULT={model:'otherAx',mode:'selective',auto:true,promptAssist:true,realEditor:true,momentum:true,watchStoryRunner:false,timeoutMs:90000,maxChars:9000};
 let conf={...DEFAULT};
 let state={target:null,index:-1,original:'',revised:'',issues:[],status:'자동 퇴고 OFF',busy:false,lastAuto:'없음'};
 let uiOpen=false;let unloaded=false;let pollTimer=null;
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
 const suspicious=source=>{
   const m=dialogueSignals(source);
   return m.dialogueLoop||m.exactRepeats>=1||m.stockGestures>=5||(m.recycledBeatMentions>=12&&m.passiveAnswers>=4);
 };
 const verify=(original,rewrite)=>{
   const a=clean(original),b=clean(rewrite);
   if(!b||b.length<a.length*.64||b.length>a.length*1.45)return '문장 분량 변경 범위 초과';
   const tokens=t=>(t.match(/<[^<>]{1,120}>|\{\{[^{}\n]{1,120}\}\}|\[[A-Z][A-Z0-9 _:\-=.]{1,140}\]/gi)||[]).join('|');
   if(tokens(a)!==tokens(b))return '시스템 태그/상태 토큰 변경';
   const stats=t=>t.split(/\r?\n/).filter(x=>/^\s*(?:\[[^\]]{1,36}\]\s*[:=]|(?:HP|MP|STR|DEX|LV|LEVEL|STATUS|상태|체력|레벨|경험치)\s*[:：=])/i.test(x)).join('\n');
   if(stats(a)!==stats(b))return '상태창 내용 변경';
   const nums=t=>(t.match(/(?<![A-Za-z가-힣])\d+(?:\.\d+)?(?:%|kg|km|cm|초|분|시간|원)?/g)||[]).join('|');
   if(nums(a)!==nums(b))return '숫자/수치 변경';
   if(/<(?:think|reasoning|thoughts)\b/i.test(b))return '사고과정 출력';
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
 function markPreSave(value){
   const now=Date.now();
   for(const [k,t] of preSaveReviewed)if(now-t>120000)preSaveReviewed.delete(k);
   preSaveReviewed.set(sourceFingerprint(value),now);
   while(preSaveReviewed.size>80)preSaveReviewed.delete(preSaveReviewed.keys().next().value);
 }
 function alreadyPreSaved(value){
   const k=sourceFingerprint(value),at=preSaveReviewed.get(k);
   return typeof at==='number' && Date.now()-at<120000;
 }

 async function injectStyleBeforeRequest(messages,type){
   if(unloaded||!conf.auto||!conf.promptAssist||type!=='model'||!Array.isArray(messages))return messages;
   // Only amend normal text-chat model prompts, not a structured task.
   if(messages.length<2||!messages.some(x=>x?.role==='user' && typeof x.content==='string'))return messages;
   if(messages.some(x=>typeof x?.content==='string' && x.content.includes(INLINE_HINT_ID)))return messages;
   const amended=messages.map(message=>({...message}));
   const index=amended.findIndex(x=>x?.role==='system' && typeof x.content==='string');
   const guidance=INLINE_GUIDANCE+(conf.momentum?MOMENTUM_GUIDANCE:'');
   if(index>=0)amended[index].content+='\n\n'+guidance;
   else amended.unshift({role:'system',content:guidance});
   return amended;
 }

 async function reviseBeforeSave(response,type){
   if(unloaded||!conf.auto||!conf.realEditor||type!=='model'||typeof response!=='string')return response;
   if(alreadyPreSaved(response))return response;
   try{
     const result=await pipeline(response,'');
     const final=result.revised||response;
     // Even a "no changes" verdict was already reviewed, so the output
     // listener must not charge for a second review after the host commits it.
     markPreSave(response);markPreSave(final);
     state.lastAuto='저장 전 편집 · '+result.reason;
     return final;
   }catch(error){
     markPreSave(response);
     state.lastAuto='저장 전 편집 실패 · 원문 유지 · '+txt(error?.message||error);
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
   const original={original:raw,revised:'',issues:[],reason:'원문 유지'};
   if(!eligible(source))return {...original,reason:'짧은 응답·비서사·입력 길이 초과'};
   const normalizedOnly=raw.trim()!==source&&!verify(raw,source)?source:'';
   if(conf.mode==='economy'&&!suspicious(source))
     return {...original,revised:normalizedOnly,reason:normalizedOnly?'출력 메타만 제거':'저비용 선별: 실질적 반복 징후 없음'};
   const metrics=dialogueSignals(source);
   const currentMomentum=Boolean(conf.momentum)&&source.length>=800;
   const diagnosis=await request([{role:'system',content:[
     'You are a professional Korean-fiction dialogue and scene editor, NOT a coauthor. Judge the function of the dialogue, not merely its length.',
     'Find actionable patterns: interview-like question/yes-answer/confirmation loops; short echoes that add no information; the NPC repeatedly saying I do not know or the same excuse; a protagonist reduced to a therapist or interviewer; everyone speaking with the same cool clipped voice; narration repeatedly diagnosing an emotion that action already shows; recycled body/gesture details; postponed scene objectives.',
     'A sharp short line, repeated personal catchphrase, hesitation or quiet character is NOT automatically bad. Do not inflate word count, erase a character quirk, or make everyone clever, sarcastic or aggressive. Distinguish useful tension from stagnant repetition.',
     'Evaluate scene movement: compare the START and END, not just physical activities. Did a meaningful relationship dynamic, fact, boundary, personal decision, practical goal, or next-step change? Repeated compliments, blushes, offers declined, and a visitor leaving as they arrived may constitute stasis.',
     'Progress can be modest and grounded in an existing thread (for example an NPC makes a specific practical request, sets a boundary, proposes a next step, or changes their earlier decision). Do NOT require sex, sudden intrusion, spectacular conflict, new cast members, or arbitrary twists. Respect intentional rest and transitions.',
     'If the scene is long but nothing actually changed and the quietness is not purposeful, mark revise=true and include ONE concrete stasis issue using an EXACT excerpt from the draft. Clearly explain a plausible NPC-initiated causal beat without taking control of the player character.',
     'When there is a substantial issue grounded in the text, report the exact excerpt and a targeted editorial instruction. Respect established characterization, dialogue hierarchy, world canon, player agency and unresolved scene endings.',
     'Return ONLY JSON: {"revise":boolean,"sceneProgress":{"material":boolean,"evidence":string,"intentionalStillness":boolean},"issues":[{"excerpt":string,"problem":string,"instruction":string}],"strengths":[string],"summary":string}. Up to four issues. If effective or intentionally quiet as written, revise=false.'
   ].join(' ')},{role:'user',content:
      '# HEURISTIC SIGNALS (not absolute judgments)\n'+JSON.stringify(metrics)
      +'\n# ASSESS_SCENE_MOMENTUM\n'+(currentMomentum?'YES, scene must earn a modest material change unless intentionally still':'NO, preserve the current progress; assess only dialogue and style')
      +'\n\n# PREVIOUS CONTINUITY FACTS (never imitate previous stylistic flaws)\n'+background
      +'\n\n# CURRENT FINISHED FICTION TO EVALUATE\n'+source}]);
   const verdict=obj(diagnosis);
   if(!verdict||typeof verdict.revise!=='boolean'||!Array.isArray(verdict.issues))
     throw Error('편집장 진단 형식 오류');
   // Treat semantic progress assessment as a signal, never as an unconditional
   // instruction to fabricate events. Legacy critic JSON without this field
   // remains supported.
   const momentumGap=currentMomentum&&verdict.sceneProgress?.material===false
     &&verdict.sceneProgress?.intentionalStillness!==true;
   const issues=verdict.issues.filter(x=>x&&typeof x.excerpt==='string'&&typeof x.problem==='string'&&typeof x.instruction==='string')
     .map(x=>({excerpt:x.excerpt.trim().slice(0,180),problem:x.problem.trim().slice(0,280),instruction:x.instruction.trim().slice(0,280)}))
     .filter(x=>x.problem&&x.instruction&&(!x.excerpt||source.includes(x.excerpt))).slice(0,4);
   if(momentumGap&&!issues.length){
     const excerpt=source.slice(-Math.min(125,source.length)).trim();
     issues.push({excerpt,
       problem:'장면 시작과 끝에 실질적인 상황 변화가 없어서 방문·대화가 제자리걸음 함',
       instruction:'기존 대화에서 이미 나온 요청·거절·관심사 중 하나를 활용해 NPC가 작은 선택, 분명한 경계, 구체적인 다음 단계 또는 새로운 행동을 만들도록 최소한으로 교정. 플레이어의 선택이나 행동을 새로 작성하지 말 것.'});
   }
   if((!verdict.revise&&!momentumGap)||!issues.length)
     return {...original,revised:normalizedOnly,issues,
       reason:normalizedOnly?'편집장: 문체 수정 불필요 · 출력 메타만 제거':'편집장: 유의미한 퇴고 불필요'};
   const revision=await request([{role:'system',content:[
     'You are a surgical Korean-fiction editor. Return the FULL revised fiction and nothing else. NO analysis, thoughts, Approved, Response, explanations, JSON, or fences.',
     'Fix ONLY the grounded issues. Preserve exact character identities, distinct speech mannerisms, established facts, motives, relationships, narrative viewpoint, world rules, player utterances, chronology, imagery tags, system/status windows and numbers.',
     'Remove redundant interrogation and echo exchanges where they perform the same function. A character can answer obliquely, offer a concrete preference, make a small choice, tease, object or redirect depending on personality. Preserve genuine uncertainty but do not repeat it through several turns. Make the NPC a participant rather than a questionnaire respondent.',
     'Short dialogue is welcome when meaningful. Never pad dialogue or turn the entire cast into cool clipped speakers. Keep the established scene and past facts intact.',
     'If a grounded scene-stasis issue was diagnosed, you MAY add ONE small, credible, NPC-initiated consequential choice, request, boundary or next step rooted in facts ALREADY PRESENT in the text. Give it a clear result or a concrete unresolved commitment. You may replace repetitive lines/beats to make room; this is not permission to create a new major plot arc.',
     'Do not invent a spouse confrontation, sudden stranger, crisis, romantic/sexual escalation or coercion as a shortcut. Do not perform new actions, decide emotions, accept requests or give consent on behalf of the player character. Do not contradict established canon or change locations or timeline gratuitously.',
     'Reduce repeated narration of embarrassment, glances, gestures and body/clothing details when they add no new information. Let an NPC reveal character through distinct intentions and decisions, not narration claiming unspoken thoughts.'
   ].join(' ')},{role:'user',content:
      '# GROUNDED ISSUES TO FIX ONLY\n'+JSON.stringify(issues)
      +'\n\n# CONTINUITY FACTS\n'+background
      +'\n\n# ORIGINAL FICTION\n'+source}]);
   const error=verify(raw,revision);
   if(error)return {...original,revised:normalizedOnly,issues,reason:'퇴고본 거부: '+error+(normalizedOnly?' · 메타만 제거':'')};
   if(revision===source)
     return {...original,revised:normalizedOnly,issues,reason:normalizedOnly?'출력 메타만 제거':'퇴고 원문과 동일'};
   return {original:raw,revised:revision,issues,reason:'대화 기능·세계관 기초 검증 통과'};
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
     const result=await pipeline(state.original,context(now.chat,state.index,{}));
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
   if(!conf.auto||!conf.realEditor||unloaded||!arg||!Number.isInteger(arg.messageIndex)||!Array.isArray(arg.chat?.message))return;
   const i=arg.messageIndex,m=arg.chat.message[i],ci=arg.characterIndex,ti=arg.chatIndex;
   if(!Number.isInteger(ci)||!Number.isInteger(ti)||!m||!['char','assistant'].includes(m.role)||i!==arg.chat.message.length-1)return;
   const original=txt(m.data);if(alreadyPreSaved(original)||!eligible(original))return;
   const id=txt(arg.chat.id),k=outputKey(ci,ti,id,i,m);
   if(seen.has(k)||inflight.has(k))return;
   remember(k);inflight.add(k);
   try{
     const result=await pipeline(original,context(arg.chat,i,arg.char||{}));
     if(result.revised){
       await commit({ci,ti,id,index:i,messageId:txt(m.chatId||m.time)},original,result.revised);
       state.lastAuto=sourceLabel+' · 실제 퇴고 반영 ('+result.issues.length+'건)';
     }else state.lastAuto=sourceLabel+' · '+result.reason;
   }catch(e){state.lastAuto=sourceLabel+' · 원문 유지 · '+txt(e.message||e)}
   finally{inflight.delete(k);if(uiOpen)void render()}
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
  document.body.innerHTML=`<style>
    body{background:#171d2b;color:#edf0ff;font:14px/1.6 system-ui;margin:0;padding:18px}main{max-width:1100px;margin:auto}
    button,select{color:#fff;background:#334568;border:1px solid #63769d;border-radius:8px;padding:9px;cursor:pointer;font:inherit}
    button:disabled{opacity:.4;cursor:not-allowed}
    textarea{width:100%;height:310px;box-sizing:border-box;background:#111827;color:#edf0ff;border:1px solid #52617f;border-radius:8px;padding:12px;line-height:1.7}
    .pair{display:grid;grid-template-columns:1fr 1fr;gap:12px}.top{display:flex;flex-wrap:wrap;gap:8px;margin:12px 0;align-items:center}
    .status{padding:12px;background:#243046;border-radius:10px}pre{white-space:pre-wrap;overflow-wrap:anywhere}
    .muted{color:#afbedb;font-size:12px}@media(max-width:720px){.pair{grid-template-columns:1fr}body{padding:11px}}
  </style><main><h2>Bard Editor Lab v0.3.3</h2>
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
  </div>
  <p class="muted">장면 정체 방지는 대화를 길게 만드는 게 아니라, NPC의 결정·경계·구체적 행동 등 인과관계가 남는 작은 변화를 유도해. 조용한 휴식 장면은 예외야.</p>
  <p class="muted">일반 비스트리밍 응답은 저장 전 교정. 스트리밍은 원문 표시가 끝난 뒤 교체될 수 있어. 기존 사용자 설정의 자동 OFF는 유지돼.</p>
  <div class="top">
    <label><input id="srwatch" type="checkbox" ${conf.watchStoryRunner?'checked':''}/> Story Runner 직접 생성도 감시 (수동 삽입 포함 가능)</label>
    <label>최대 입력 <select id="max">${[4500,7000,9000,12000,18000].map(n=>`<option value="${n}" ${conf.maxChars===n?'selected':''}>${n.toLocaleString()}자</option>`).join('')}</select></label>
    <button id="restore">가장 최근 퇴고 원본 복원</button>
  </div>
  <p class="status">${esc(state.status)}<span class="muted"><br/>최근 자동 작업: ${esc(state.lastAuto)}</span></p>
  <div class="top">
    <button id="load">마지막 AI 본문 불러오기</button>
    <button id="run" ${state.busy?'disabled':''}>수동 검수</button>
    <button id="apply" ${!state.revised||state.busy?'disabled':''}>퇴고본 직접 적용</button>
    <button id="close">닫기</button>
  </div>
  <div class="pair">
    <section><h3>원문</h3><textarea readonly>${esc(state.original)}</textarea></section>
    <section><h3>퇴고본 (미적용)</h3><textarea readonly>${esc(state.revised)}</textarea></section>
  </div>
  <h3>편집장 진단</h3><pre>${esc(state.issues.map((x,i)=>`${i+1}. ${x.problem} — ${x.instruction}`).join('\n')||'진단 기록 없음')}</pre>
  <p class="muted">한 응답당 최대 2회 모델 호출. 사고과정/메타 출력은 본문과 분리해 검사해. 실패 시 원문 유지. 최근 5건의 원문 전체를 플러그인 저장소에 백업해.
  타임아웃은 대기를 중단하지만 모델 과금 취소를 보장하지 않아.</p></main>`;
  const el=id=>document.getElementById(id);
  el('auto').onclick=async()=>{conf.auto=!conf.auto;await save();state.status=conf.auto?'자동 퇴고 활성화':'자동 퇴고 비활성화';await render()};
  el('promptassist').onchange=async e=>{conf.promptAssist=e.target.checked;await save()};
  el('realeditor').onchange=async e=>{conf.realEditor=e.target.checked;await save()};
  el('momentum').onchange=async e=>{conf.momentum=e.target.checked;await save()};
  el('model').onchange=async e=>{conf.model=e.target.value;await save()};
  el('mode').onchange=async e=>{conf.mode=e.target.value;await save()};
  el('max').onchange=async e=>{conf.maxChars=Number(e.target.value);await save()};
  el('srwatch').onchange=async e=>{conf.watchStoryRunner=e.target.checked;initializedChats.clear();await save()};
  el('load').onclick=()=>load().then(render).catch(e=>{state.status=txt(e.message);render()});
  el('run').onclick=()=>run();
  el('apply').onclick=()=>apply().then(render).catch(e=>{state.status='적용 차단 · '+txt(e.message);render()});
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
 async function open(){uiOpen=true;await render();await risuai.showContainer('fullscreen')}
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
