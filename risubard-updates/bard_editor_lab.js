//@name bard_editor_lab
//@display-name Bard Editor Lab (Experimental)
//@api 3.0
//@version 0.1.0
//@allowed-ipc story_runner
//@description Opt-in editorial experiment: no automatic edits; compare original/revision before commit.
(async () => {
  const KEY='editor_lab_experimental_v1';
  const settings={mode:'selective',presetId:'',enabled:false};
  let state={target:null,index:-1,original:'',revised:'',issues:[],status:'기본 비활성 · 수동 퇴고만 제공',busy:false};
  const str=v=>String(v??'');
  const html=v=>str(v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const body=v=>str(v).replace(/<think\b[^>]*>[\s\S]*?<\/think>/gi,'').replace(/<reasoning\b[^>]*>[\s\S]*?<\/reasoning>/gi,'').trim();
  const hash=s=>{let h=2166136261;for(let i=0;i<s.length;i++)h=Math.imul(h^s.charCodeAt(i),16777619);return h>>>0};
  const quality=s=>{const t=body(s);if(!t)return false;const clauses=t.split(/[.!?。！？\n]+/).map(x=>x.trim()).filter(x=>x.length>8);return new Set(clauses).size<clauses.length-1||/(입꼬리|눈동자|손가락|울면서 웃었다)/g.test(t)&&((t.match(/입꼬리|눈동자|손가락|울면서 웃었다/g)||[]).length>=4)};
  const tagFingerprint=s=>(str(s).match(/<\/?[A-Z][A-Z0-9_]*(?:\s+[^<>]*?)?\s*\/?\s*>|\[[^\]\n]{1,36}:[^\]\n]{1,120}\]/g)||[]).join('\n');
  function safeRewrite(original,revised){
    const a=body(original),b=body(revised);
    if(!b||b.length<a.length*.7||b.length>a.length*1.35)return '퇴고본 길이가 허용 범위를 벗어남';
    if(tagFingerprint(a)!==tagFingerprint(b))return '시스템 태그 또는 상태창 구조 변경 감지';
    if(/<think\b|<reasoning\b|<SR_SCENE_COMPLETE\b/i.test(b)&&!/<SR_SCENE_COMPLETE\b/i.test(a))return '비공개 메타/임의 완료 태그';
    return '';
  }
  async function target(){
    const characterIndex=await risuai.getCurrentCharacterIndex();
    const chatIndex=await risuai.getCurrentChatIndex();
    const chat=await risuai.getChatFromIndex(characterIndex,chatIndex);
    return {characterIndex,chatIndex,id:str(chat?.id),chat};
  }
  async function readLast(){
    const t=await target();
    const msgs=Array.isArray(t.chat?.message)?t.chat.message:[];
    let i=-1;
    for(let j=msgs.length-1;j>=0;j--)if(msgs[j]?.role==='char'||msgs[j]?.role==='assistant'){i=j;break}
    if(i<0)throw Error('퇴고할 AI 메시지가 없어');
    state.target={characterIndex:t.characterIndex,chatIndex:t.chatIndex,id:t.id};
    state.index=i;state.original=str(msgs[i].data);state.revised='';state.issues=[];
    state.status='원문 로드 완료 · 아직 아무것도 수정하지 않았어';
  }
  async function call(presetId,messages){
    const res=await risuai.runEditorModelPreset(presetId,messages);
    if(!res||res.type!=='success'||typeof res.result!=='string')throw Error('모델 요청 실패: '+str(res?.result));
    return body(res.result);
  }
  const SYSTEM='You are a Korean-fiction editorial critic. Preserve the story facts, characters, distinct personal voices, canon and scene goals. Flag only real mechanical dialogue loops, repeated emotional restatements, filler narration, excessive formulaic physical gestures, and stalled scene beats. A character-specific speaking habit is not automatically a flaw. Return only JSON {"revise":boolean,"issues":[{"excerpt":string,"problem":string,"instruction":string}],"strengths":[string],"summary":string}, with at most 4 issues.';
  function extractJson(s){const x=body(s).replace(/^\s*```(?:json)?/i,'').replace(/```\s*$/,'').trim();try{return JSON.parse(x)}catch(_){const a=x.indexOf('{'),b=x.lastIndexOf('}');if(a>=0&&b>a)return JSON.parse(x.slice(a,b+1));throw Error('진단 응답 JSON 형식 오류')}}
  async function review(){
    if(state.busy)return;
    state.busy=true;state.status='모델 진단 진행';render();
    try{
      if(!state.target)await readLast();
      if(!settings.presetId)throw Error('편집장 모델 프리셋을 먼저 선택해');
      if(state.original.length>28000)throw Error('원문 28,000자 초과: 분할 퇴고가 필요해');
      const current=await target(),t=state.target;
      if(current.id!==t.id||current.characterIndex!==t.characterIndex||current.chatIndex!==t.chatIndex)throw Error('채팅 전환 감지: 다시 불러와');
      const raw=await call(settings.presetId,[{role:'system',content:SYSTEM},{role:'user',content:'# FINISHED FICTION\n'+state.original}]);
      const verdict=extractJson(raw);
      if(typeof verdict.revise!=='boolean'||!Array.isArray(verdict.issues))throw Error('진단 응답 검증 실패');
      state.issues=verdict.issues.filter(x=>x&&typeof x.problem==='string').slice(0,4);
      if(!verdict.revise||!state.issues.length){state.status='퇴고 불필요 판정 · 원문 유지';state.revised='';return}
      state.status='문제 감지 · 필요한 부분만 퇴고 중';render();
      const revision=await call(settings.presetId,[{role:'system',content:'Edit the supplied Korean fiction ONLY to fix the listed issues. Preserve all scenes, outcomes, cast voices, names, relationships, world rules, in-story tags, status values and scene direction. Do not invent plot beats or homogenize dialogue. Output only the complete revised Korean fiction, no explanation. Preserve paragraphs. Do not add an ending.'},{role:'user',content:'# ISSUES\n'+JSON.stringify(state.issues)+'\n# ORIGINAL\n'+state.original}]);
      const fault=safeRewrite(state.original,revision);
      if(fault)throw Error('퇴고본 보류: '+fault);
      state.revised=revision;state.status='퇴고본 생성됨 · 원문과 비교 후 직접 적용 가능';
    }catch(e){state.revised='';state.status='원문 유지 · '+str(e?.message||e)}
    finally{state.busy=false;render()}
  }
  async function apply(){
    if(state.busy||!state.revised||!state.target)return;
    const t=state.target,cur=await target();
    if(cur.characterIndex!==t.characterIndex||cur.chatIndex!==t.chatIndex||cur.id!==t.id)throw Error('채팅 전환 감지');
    const msgs=cur.chat?.message;
    if(!Array.isArray(msgs)||state.index<0||state.index!==msgs.length-1||str(msgs[state.index]?.data)!==state.original)throw Error('메시지가 변경/추가되었어. 원본을 다시 불러와');
    const fault=safeRewrite(state.original,state.revised);if(fault)throw Error(fault);
    const next=structuredClone(cur.chat);
    next.message[state.index].data=state.revised;
    await risuai.setChatToIndex(t.characterIndex,t.chatIndex,next);
    state.original=state.revised;state.revised='';state.status='선택한 퇴고본을 마지막 메시지에 적용함';
  }
  async function render(){
    const presets=await risuai.listEditorModelPresets().catch(()=>[]);
    document.body.innerHTML=`<style>body{background:#171d2b;color:#e5eafa;font:14px/1.6 system-ui;margin:0;padding:22px}button,select{color:#eef;background:#303e61;border:1px solid #586a99;border-radius:7px;padding:9px;cursor:pointer}button:disabled{opacity:.45}textarea{width:100%;min-height:270px;background:#121725;color:#eff;box-sizing:border-box;border:1px solid #4b5b79;border-radius:8px;padding:12px;line-height:1.65}h2{margin-top:0}main{max-width:1100px;margin:auto}.top{display:flex;flex-wrap:wrap;align-items:center;gap:10px}.pair{display:grid;grid-template-columns:1fr 1fr;gap:14px}@media(max-width:750px){.pair{grid-template-columns:1fr}}.meta{font-size:12px;color:#b9c4dd}pre{white-space:pre-wrap;overflow-wrap:anywhere}</style><main><h2>Bard Editor Lab · 수동 검증판</h2><p class="meta">자동 편집 OFF · 프리셋/캐릭터/로어북/지난 메시지 변경 없음 · 선택한 마지막 AI 메시지만 적용 가능</p><div class="top"><select id="model"><option value="">편집장 모델 선택</option>${presets.map(p=>`<option value="${html(p.id)}" ${p.id===settings.presetId?'selected':''}>${html(p.name)}</option>`).join('')}</select><button id="load">마지막 AI 메시지 불러오기</button><button id="run" ${state.busy?'disabled':''}>진단 + 선택적 퇴고</button><button id="apply" ${!state.revised||state.busy?'disabled':''}>퇴고본 적용</button><button id="close">닫기</button></div><p id="status">${html(state.status)}</p><div class="pair"><section><h3>원문</h3><textarea readonly>${html(state.original)}</textarea></section><section><h3>퇴고본</h3><textarea readonly>${html(state.revised)}</textarea></section></div><h3>편집장 진단</h3><pre>${html(state.issues.map((x,i)=>`${i+1}. ${x.problem} · ${x.instruction||''}`).join('\n')||'아직 진단 없음')}</pre></main>`;
    const el=id=>document.getElementById(id);
    el('model').onchange=async e=>{settings.presetId=e.target.value;await risuai.pluginStorage.setItem(KEY,settings)};
    el('load').onclick=()=>readLast().then(render).catch(e=>{state.status=str(e.message);render()});
    el('run').onclick=()=>review();
    el('apply').onclick=()=>apply().then(render).catch(e=>{state.status='적용 차단 · '+str(e.message);render()});
    el('close').onclick=()=>risuai.hideContainer();
  }
  const saved=await risuai.pluginStorage.getItem(KEY).catch(()=>null);
  if(saved&&typeof saved==='object'&&typeof saved.presetId==='string')settings.presetId=saved.presetId;
  async function open(){await render();await risuai.showContainer('fullscreen')}
  await risuai.registerSetting('Bard Editor Lab (시험)',open,'✍️','html','bard-editor-lab-settings');
  await risuai.registerButton({name:'Bard Editor Lab',icon:'✍️',iconType:'html',location:'hamburger',id:'bard-editor-lab-hamburger'},open);
  await risuai.addPluginChannelListener('editor-request',()=>{ /* automatic Story Runner integration intentionally off until host validation */ });
})();