//@name bard_editor_lab
//@display-name Bard Editor Lab
//@api 3.0
//@version 0.3.0
//@description Optional automatic selective Korean fiction editing for regular RisuBard chats; no host modifications.
(async () => {
 const STORE='bard_editor_lab_v03'; const BACKUP_STORE='bard_editor_lab_v03_backups';
 const DEFAULT={model:'otherAx',mode:'selective',auto:false,watchStoryRunner:false,timeoutMs:90000,maxChars:9000};
 let conf={...DEFAULT};
 let state={target:null,index:-1,original:'',revised:'',issues:[],status:'자동 퇴고 OFF',busy:false,lastAuto:'없음'};
 let uiOpen=false;let unloaded=false;let pollTimer=null;
 const seen=new Set(),inflight=new Set(),initializedChats=new Set();
 const txt=x=>String(x??'');
 const esc=x=>txt(x).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;','\'':'&#39;'}[c]));
 const clean=s=>txt(s).replace(/<think\b[^>]*>[\s\S]*?<\/think>/gi,'').replace(/<reasoning\b[^>]*>[\s\S]*?<\/reasoning>/gi,'').trim();
 const sig=s=>(txt(s).match(/<\/?[A-Z][A-Z0-9_]*(?:\s+[^<>]*?)?\s*\/?\s*>|\[[^\]\n]{1,36}:[^\]\n]{1,120}\]/g)||[]).join('\n');
 const obj=s=>{const t=clean(s).replace(/^\s*```(?:json)?/i,'').replace(/```\s*$/,'').trim();try{return JSON.parse(t)}catch(_){const i=t.indexOf('{'),j=t.lastIndexOf('}');if(i<0||j<=i)throw Error('편집장 JSON 응답 오류');return JSON.parse(t.slice(i,j+1))}};

 const eligible=source=>{
   const t=txt(source).trim();
   if(t.length<240||t.length>conf.maxChars||(t.match(/[가-힣]/g)||[]).length<65)return false;
   if(/<(?:think|reasoning|tool_call|function_call)\b/i.test(t))return false;
   if(/^\s*[\[{][\s\S]+[\]}]\s*$/.test(t)&&t.includes('":'))return false;
   const lines=t.split('\n').filter(x=>x.trim());
   if(lines.length>5&&lines.filter(x=>/^\s*(?:\d+\.|[-*]\s|#{1,5}\s|\|.*\|)/.test(x)).length>lines.length*.6)return false;
   return true;
 };
 const suspicious=source=>{
   const t=txt(source),parts=t.split(/[.!?。！？\n]+/).map(x=>x.trim()).filter(x=>x.length>14);
   const repeated=parts.length-new Set(parts).size;
   const gestures=(t.match(/입꼬리|눈동자|손가락|시선을 피했|고개를 끄덕였|울면서 웃었다/g)||[]).length;
   const echoes=(t.match(/그랬어\?|좋았어\?|왜\?|뭐라고\?|그런가\?/g)||[]).length;
   return repeated>0||gestures>=5||echoes>=5;
 };
 const verify=(original,rewrite)=>{
   const a=txt(original),b=clean(rewrite);
   if(!b||b.length<a.length*.64||b.length>a.length*1.45)return '문장 분량 변경 범위 초과';
   const tokens=t=>(t.match(/<[^<>]{1,120}>|\{\{[^{}\n]{1,120}\}\}|\[[A-Z][A-Z0-9 _:\-=.]{1,140}\]/gi)||[]).join('|');
   if(tokens(a)!==tokens(b))return '시스템 태그/상태 토큰 변경';
   const stats=t=>t.split(/\r?\n/).filter(x=>/^\s*(?:\[[^\]]{1,36}\]\s*[:=]|(?:HP|MP|STR|DEX|LV|LEVEL|STATUS|상태|체력|레벨|경험치)\s*[:：=])/i.test(x)).join('\n');
   if(stats(a)!==stats(b))return '상태창 내용 변경';
   const nums=t=>(t.match(/(?<![A-Za-z가-힣])\d+(?:\.\d+)?(?:%|kg|km|cm|초|분|시간|원)?/g)||[]).join('|');
   if(nums(a)!==nums(b))return '숫자/수치 변경';
   if(/<(?:think|reasoning)\b/i.test(b))return '사고과정 출력';
   return '';
 };
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
   const source=txt(draft),original={original:source,revised:'',issues:[],reason:'원문 유지'};
   if(!eligible(source))return {...original,reason:'짧은 응답·비서사·입력 길이 초과'};
   if(conf.mode==='economy'&&!suspicious(source))return {...original,reason:'저비용 선별: 반복 징후 없음'};
   const diagnosis=await request([{role:'system',content:[
     'You are a discerning editor of Korean character-driven fiction, NOT a coauthor. Identify only real actionable defects: echoed questions, mechanically mirrored replies, everyone speaking with the same cold cadence, repetitive emotional confirmations, stock gestures, translated-sounding prose and stalled immediate action.',
     'Respect each character’s individual voice, habits, relationships, motivations, established lore and player decisions. An unusual habit or a quiet character is NOT automatically a flaw.',
     'Return ONLY JSON: {"revise":boolean,"issues":[{"excerpt":string,"problem":string,"instruction":string}],"strengths":[string],"summary":string}. At most four issues. If the prose is good enough, revise=false. Do NOT rewrite yet.'
   ].join(' ')},{role:'user',content:'# PREVIOUS FACTS (do not copy style)\n'+background+'\n\n# FINISHED FICTION\n'+source}]);
   const verdict=obj(diagnosis);
   if(typeof verdict.revise!=='boolean'||!Array.isArray(verdict.issues))throw Error('편집장 진단 형식 오류');
   const issues=verdict.issues.filter(x=>x&&typeof x.excerpt==='string'&&typeof x.problem==='string'&&typeof x.instruction==='string')
     .map(x=>({excerpt:x.excerpt.trim().slice(0,180),problem:x.problem.trim().slice(0,280),instruction:x.instruction.trim().slice(0,280)}))
     .filter(x=>x.problem&&x.instruction&&(!x.excerpt||source.includes(x.excerpt))).slice(0,4);
   if(!verdict.revise||!issues.length)return {...original,issues,reason:'편집장: 수정 불필요'};
   const revision=await request([{role:'system',content:[
     'You are a surgical editor. Rewrite ONLY the verified defects. Output the ENTIRE revised Korean fiction only; no explanation, critique, JSON or fences.',
     'Preserve named characters, distinct personalities and speech patterns, past events, relationships, world rules, player choices, immediate scene purpose and unresolved endings.',
     'Preserve system messages, status displays, choice blocks, all tags and numerical values exactly. Do not add a new event or resolve a scene to make it sound polished.',
     'Do not make everybody short, cool, cynical or emotionally flat. Vary genuine reactions while maintaining who each person is.'
   ].join(' ')},{role:'user',content:'# VERIFIED ISSUES\n'+JSON.stringify(issues)+'\n\n# RECENT CANON\n'+background+'\n\n# ORIGINAL\n'+source}]);
   const error=verify(source,revision);
   if(error)return {...original,issues,reason:'퇴고본 거부: '+error};
   if(revision===source)return {...original,issues,reason:'원본과 동일'};
   return {original:source,revised:revision,issues,reason:'교정본 검증 통과'};
 }

 const outputKey=(ci,ti,id,i,m)=>[ci,ti,id,i,txt(m?.chatId||m?.time),txt(m?.data).length,txt(m?.data).slice(0,80)].join('|');
 const remember=k=>{seen.add(k);if(seen.size>200)seen.delete(seen.values().next().value)};
 const same=(meta,live)=>meta&&meta.ci===live.ci&&meta.ti===live.ti&&meta.id===live.id;
 async function backup(meta,original,revised){
   try{
     const old=await risuai.pluginStorage.getItem(BACKUP_STORE);
     const records=Array.isArray(old)?old:[];
     records.unshift({ci:meta.ci,ti:meta.ti,id:meta.id,index:meta.index,messageId:meta.messageId,
       original:original.slice(0,conf.maxChars),revised:revised.slice(0,conf.maxChars),at:Date.now()});
     await risuai.pluginStorage.setItem(BACKUP_STORE,records.slice(0,5));
   }catch(e){console.log('[EditorLab] backup write failed',e)}
 }
 async function commit(meta,original,revised,recordBackup=true){
   const live=await current();
   if(!same(meta,live))throw Error('다른 채팅으로 바뀌어 적용하지 않았어');
   const messages=live.chat?.message;
   if(!Array.isArray(messages)||meta.index!==messages.length-1)throw Error('뒤에 새 메시지가 추가되어 적용하지 않았어');
   const m=messages[meta.index];
   if(!m||!['char','assistant'].includes(m.role)||txt(m.data)!==original)throw Error('원문이 변경되어 적용하지 않았어');
   if(meta.messageId&&txt(m.chatId||m.time)!==meta.messageId)throw Error('메시지 식별자 변경');
   const fail=verify(original,revised);if(fail)throw Error('검증 실패 · '+fail);
   const next=JSON.parse(JSON.stringify(live.chat));next.message[meta.index].data=revised;
   await risuai.setChatToIndex(meta.ci,meta.ti,next);
   remember(outputKey(meta.ci,meta.ti,meta.id,meta.index,next.message[meta.index]));
   if(recordBackup)await backup(meta,original,revised);
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
   if(!conf.auto||unloaded||!arg||!Number.isInteger(arg.messageIndex)||!Array.isArray(arg.chat?.message))return;
   const i=arg.messageIndex,m=arg.chat.message[i],ci=arg.characterIndex,ti=arg.chatIndex;
   if(!Number.isInteger(ci)||!Number.isInteger(ti)||!m||!['char','assistant'].includes(m.role)||i!==arg.chat.message.length-1)return;
   const original=txt(m.data);if(!eligible(original))return;
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
   if(!conf.auto||!conf.watchStoryRunner||unloaded)return;
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
   await commit(last,last.revised,last.original,false);
   old.shift();await risuai.pluginStorage.setItem(BACKUP_STORE,old);
   state.status='최근 퇴고를 원문으로 복원했어';
 }
 async function render(){document.body.innerHTML=`<style>body{font:14px/1.6 system-ui;color:#edf0ff;background:#171d2c;margin:0;padding:22px}main{max-width:1100px;margin:auto}h2{margin-top:0}button,select{border-radius:8px;padding:9px;background:#344469;color:#fff;border:1px solid #6679a7}button:disabled{opacity:.4}textarea{box-sizing:border-box;background:#111827;color:#edf0ff;width:100%;height:320px;border:1px solid #566482;border-radius:8px;padding:12px;line-height:1.7}.pair{display:grid;grid-template-columns:1fr 1fr;gap:14px}.top{display:flex;flex-wrap:wrap;align-items:center;gap:8px}@media(max-width:720px){.pair{grid-template-columns:1fr}}.muted{color:#b8c6e2;font-size:12px}pre{white-space:pre-wrap;overflow-wrap:anywhere}</style><main><h2>Bard Editor Lab v0.2.0</h2><p class="muted">본체 수정 없음 · 자동 퇴고 미연결 · 메인/보조 모델의 기존 RisuBard 설정 사용 · 원본 수동 승인</p><div class="top"><select id="model"><option value="otherAx" ${conf.model==='otherAx'?'selected':''}>기존 보조 모델(otherAx)</option><option value="model" ${conf.model==='model'?'selected':''}>기존 메인 모델</option></select><select id="mode"><option value="selective" ${conf.mode==='selective'?'selected':''}>선택적 퇴고</option><option value="always" ${conf.mode==='always'?'selected':''}>항상 진단</option></select><button id="load">마지막 AI 본문 불러오기</button><button id="run" ${state.busy?'disabled':''}>검수 및 퇴고</button><button id="apply" ${!state.revised||state.busy?'disabled':''}>선택한 퇴고본 적용</button><button id="close">닫기</button></div><p>${esc(state.status)}</p><div class="pair"><section><h3>원본</h3><textarea readonly>${esc(state.original)}</textarea></section><section><h3>퇴고본 (미적용)</h3><textarea readonly>${esc(state.revised)}</textarea></section></div><h3>진단 근거</h3><pre>${esc(state.issues.map((x,i)=>`${i+1}. ${x.problem} / ${x.instruction}`).join('\n')||'진단 없음')}</pre></main>`;const el=id=>document.getElementById(id);el('model').onchange=async e=>{conf.model=e.target.value;await save()};el('mode').onchange=async e=>{conf.mode=e.target.value;await save()};el('load').onclick=()=>load().then(render).catch(e=>{state.status=txt(e.message);render()});el('run').onclick=()=>run();el('apply').onclick=()=>apply().then(render).catch(e=>{state.status='적용 차단 · '+txt(e.message);render()});el('close').onclick=()=>risuai.hideContainer();}
 const saved=await risuai.pluginStorage.getItem(STORE).catch(()=>null);if(saved&&typeof saved==='object')conf={...DEFAULT,...saved,auto:false};
 async function open(){await render();await risuai.showContainer('fullscreen')}
 await risuai.registerSetting('Bard Editor Lab',open,'✍️','html','bard-editor-lab-settings');
 await risuai.registerButton({name:'Bard Editor Lab',icon:'✍️',iconType:'html',location:'hamburger',id:'bard-editor-lab-hamburger'},open);
})();