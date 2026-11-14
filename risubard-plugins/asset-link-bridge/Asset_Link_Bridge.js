//@name risubard_asset_link_bridge
//@api 3.0
//@version 0.6.0
//@display-name Asset Link Bridge - Multi Module
//@update-url https://raw.githubusercontent.com/pjb3181-prog/support-my-task/main/risubard-plugins/asset-link-bridge/Asset_Link_Bridge.js
// @ts-nocheck
// Stable plugin ID is unchanged for future updates.
// Automatic updates: publish the matching .js at a public, CORS/Range-enabled fixed URL
// and add //@update-url https://raw.githubusercontent.com/OWNER/REPO/main/dist/RisuBard_Asset_Link_Bridge.js
// Do not point this at a private GitHub repository.
(() => {
  'use strict';
  const Risuai = risuai;
  const KEY = 'asset_link_bridge:v2';
  const OLD = 'asset_link_bridge:v1';
  const AUTOKEY = 'asset_link_bridge:auto:v4';
  let autoEnabled = true;
  let maxImages = 2;
  const $ = id => document.getElementById(id);
  const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const cid = c => String(c?.chaId || c?.id || c?.name || '');
  const mid = m => String(m?.id || m?.namespace || m?.name || '');
  const clone = x => JSON.parse(JSON.stringify(x));
  let rules = [], tracked = {}, chars = [], modules = [], selected = '', busy = false;
  let actorCandidates = []; const AUTO_ACTOR='__manual_actor__';
  async function storageGet(k, fallback) {
    try { const v=await Risuai.pluginStorage.getItem(k); return v == null ? fallback : (typeof v === 'string' ? JSON.parse(v) : v); }
    catch { return fallback; }
  }
  async function persist() { await Risuai.pluginStorage.setItem(KEY, JSON.stringify({rules,tracked})); }
  async function persistAuto() { await Risuai.pluginStorage.setItem(AUTOKEY, JSON.stringify({enabled:autoEnabled,maxImages})); }
  async function load() {
    const state = await storageGet(KEY, {});
    rules = Array.isArray(state.rules) ? state.rules : [];
    tracked = state.tracked && typeof state.tracked === 'object' ? state.tracked : {};
    const a=await storageGet(AUTOKEY,{});
    autoEnabled=a.enabled !== false;
    maxImages=[1,2,3].includes(Number(a.maxImages))?Number(a.maxImages):2;
  }
  const log = text => { $('output').textContent = String(text); };
  const option = (v,t) => `<option value="${esc(v)}">${esc(t)}</option>`;
  const ext = s => String(s || '').replace(/^\./,'').toLowerCase();
  const safeName = s => String(s || '').trim().replace(/[^\w\-가-힣]/g,'_');
  function getModule(id) { return modules.find(m=>mid(m)===id); }
  function getChar(id) { return chars.find(c=>cid(c)===id); }
  function availableAssets(m) {
    return (m?.assets || []).filter(a=>Array.isArray(a)&&typeof a[0]==='string'&&typeof a[1]==='string'&&a[0].trim()&&a[1].trim());
  }
  function matches(assetName, rule) {
    const n=assetName.toLowerCase(), f=String(rule.filter||'').trim().toLowerCase();
    if(!f) return false; // Never link an entire big module implicitly
    return rule.mode === 'prefix' ? n.startsWith(f) : n.includes(f);
  }
  function suggestedFilters(m) {
    const names=availableAssets(m).map(a=>a[0]);
    const counts = new Map();
    for(const n of names){
      const tokens=n.replace(/\.[^.]+$/,'').split(/[_\-\s]+/).filter(Boolean);
      // Offer candidates, not authoritative character identity detection.
      for(const len of [1,2,3]){
        if(tokens.length <= len) continue;
        const k=tokens.slice(0,len).join('_').toLowerCase();
        if(k.length < 3) continue;
        counts.set(k,(counts.get(k)||0)+1);
      }
    }
    return [...counts].filter(([,n])=>n>=2).sort((a,b)=>b[1]-a[1]).slice(0,24);
  }
  // Read only a bounded, non-mutating sample of the selected character's existing chat and metadata.
  // Explicit speaker labels rank highest. Free text is never treated as a reliable character list.
  function findActorCandidates(character) {
    if (!character) return [];
    const tally=new Map();
    function offer(raw, points, from) {
      let n=String(raw||'').replace(/^[-*#\s]+|\s+$/g,'').trim();
      n=n.replace(/^(?:speaker|character|name|이름|인물명|화자)\s*[:：]\s*/i,'').trim();
      if(n.length<2||n.length>38||/[{}<>\n\r=|]/.test(n)||/^\d/.test(n))return;
      if(/^(?:STATUS|Time|DATE|SYSTEM|OOC|USER|ASSISTANT|Narrator|UNKNOWN|시간|장소|상태|설명|나|너|한성)$/i.test(n))return;
      const key=n.toLocaleLowerCase();
      const old=tally.get(key);
      if(old){old.score+=points;old.count+=1;if(points>old.high){old.name=n;old.source=from;old.high=points;}}
      else tally.set(key,{name:n,score:points,count:1,source:from,high:points});
    }
    function parse(text, source) {
      if(typeof text!=='string'||!text)return;
      const slice=text.slice(0,85000);
      // This matches the commonly used [클로이 마리] / [나카노 니노] dialogue labels.
      for(const m of slice.matchAll(/(?:^|\n)\s*\[([^\]\n]{2,38})\]\s*(?=\n|[\"“「])/g))offer(m[1],12,source+' 화자');
      for(const m of slice.matchAll(/(?:^|\n)\s*(?:###\s*)?(?:캐릭터|Character|인물|Name|이름)\s*[:：]\s*([^\n,|]{2,38})/gi))offer(m[1],6,source+' 설정');
      // Conservative English-style screenplay dialogue prefix.
      for(const m of slice.matchAll(/(?:^|\n)\s*([가-힣A-Za-z][가-힣A-Za-z0-9 _-]{1,27})\s*:\s*[\"“「]/g))offer(m[1],7,source+' 화자');
    }
    offer(character.nickname||character.name,5,'봇 이름');
    for(const k of ['description','personality','scenario','firstMessage','first_mes','mes_example','exampleMessage','creatorNotes','creator_notes'])parse(character[k],'봇 설정');
    const chats=Array.isArray(character.chats)?character.chats:[];
    const currentIndex=Number(character.chatPage ?? character.chatIndex ?? -1);
    const chosen=chats.length ? [chats[currentIndex],...chats.slice(-3)].filter(Boolean) : [];
    let inspected=0;
    function parseMessages(messages) {
      if(!Array.isArray(messages))return;
      for(const message of messages.slice(-85)) {
        if(inspected++>230)break;
        if(typeof message==='string')parse(message.slice(0,3500),'대화');
        else if(message&&typeof message==='object'){
          const txt=message.data??message.content??message.message??message.text;
          if(typeof txt==='string')parse(txt.slice(0,3500),'대화');
          else if(Array.isArray(txt))parse(txt.filter(x=>typeof x==='string').join('\n').slice(0,3500),'대화');
          if(message.speakerName && typeof message.speakerName==='string')offer(message.speakerName,8,'대화 화자');
        }
      }
    }
    for(const chat of chosen){parseMessages(chat?.message);parseMessages(chat?.messages);parseMessages(chat?.history);}
    parseMessages(character.messages);
    parseMessages(character.history);
    // Existing mappings are also legitimate selectable options, including previously hand-entered aliases.
    for(const rule of rules.filter(r=>r.target===cid(character)))offer(rule.actor,14,'기존 매핑');
    return [...tally.values()].sort((a,b)=>b.score-a.score||a.name.localeCompare(b.name)).slice(0,80);
  }
  async function refreshActorCandidates(keepName='') {
    const char=getChar(selected);
    actorCandidates=findActorCandidates(char);
    let list=actorCandidates.map(c=>c.name);
    if(keepName&&!list.includes(keepName))list.unshift(keepName);
    const select=$('actorSelect');
    select.innerHTML=option('','등장인물을 선택해')+list.map(name=> {
      const detail=actorCandidates.find(x=>x.name===name);
      return option(name,detail?`${name} · ${detail.source}`:name+' · 기존 선택');
    }).join('')+option(AUTO_ACTOR,'목록에 없음 — 직접 입력');
    select.value=keepName&&list.includes(keepName)?keepName:'';
    $('actor').value=keepName||'';
    $('actorManual').style.display=select.value===AUTO_ACTOR?'block':'none';
    $('actorInfo').textContent=actorCandidates.length?`봇 설정·최근 대화에서 찾은 후보 ${actorCandidates.length}명. 이름은 정확성을 확인하고 골라줘.`:'현재 봇의 설정·최근 대화에서 화자 표기를 찾지 못했어. 직접 입력을 사용할 수 있어.';
  }
  function renderRules() {
    const all=rules.filter(r=>r.target===selected);
    $('rules').innerHTML = all.length ? all.map((r,i)=>{
      const m=getModule(r.module);
      const n=availableAssets(m).filter(a=>matches(a[0],r)).length;
      return `<div class="rule"><div><b>${esc(r.actor || '등장인물 미지정')}</b> → ${esc(m?.name||'[모듈 없음]')} / ${esc(r.filter)} <small>(${r.mode==='prefix'?'앞부분':'포함'} · ${n}개)</small></div><div><small>에셋 별칭: ${esc(r.prefix)}*</small> <button data-edit="${esc(r.id)}">수정</button><button data-remove="${esc(r.id)}">삭제</button></div></div>`;
    }).join('') : '<p class="muted">현재 봇에 연결할 규칙이 없어. 아래에서 추가해.</p>';
    $('rules').querySelectorAll('[data-remove]').forEach(b=>b.onclick=async()=>{
      const id=b.dataset.remove;
      if(!confirm('이 연결 규칙을 삭제할까? 이미 적용된 에셋 경로는 아래 [동기화]를 눌러야 해제돼.'))return;
      rules=rules.filter(r=>r.id!==id); await persist(); renderRules(); log('규칙 삭제됨. 적용된 경로를 정리하려면 동기화를 눌러.');
    });
    $('rules').querySelectorAll('[data-edit]').forEach(b=>b.onclick=()=>{
      const r=rules.find(r=>r.id===b.dataset.edit); if(!r)return;
      refreshActorCandidates(r.actor); $('module').value=r.module; updateHints();
      $('filter').value=r.filter; $('mode').value=r.mode; $('prefix').value=r.prefix;
      $('editing').value=r.id; $('saveRule').textContent='규칙 수정';
      window.scrollTo(0,document.body.scrollHeight);
    });
  }
  function updateHints() {
    const m=getModule($('module').value), counts=suggestedFilters(m);
    $('hints').innerHTML=counts.length ? '파일명 접두어 후보 (클릭해서 필터에 입력): '+counts.map(([name,n])=>`<button data-hint="${esc(name)}">${esc(name)} (${n})</button>`).join('') : '자동 추정 가능한 접두어가 없어. 실제 파일명 목록을 보고 검색어를 입력해.';
    $('hints').querySelectorAll('[data-hint]').forEach(b=>b.onclick=()=>{$('filter').value=b.dataset.hint;$('mode').value='prefix';});
    $('samples').textContent=availableAssets(m).slice(0,16).map(a=>a[0]).join('\n') || '에셋 없음';
  }
  function plansForTarget() {
    const selectedRules=rules.filter(r=>r.target===selected);
    const plans=[], warnings=[]; const aliasMap = new Map(), pathMap = new Map();
    for(const r of selectedRules){
      const m=getModule(r.module);
      if(!m){warnings.push(`원본 모듈 없음: ${r.actor}/${r.module}`);continue;}
      const list=availableAssets(m).filter(a=>matches(a[0],r));
      if(!list.length)warnings.push(`일치하는 에셋 없음: ${r.actor} (${r.filter})`);
      for(const a of list){
        const alias=r.prefix+a[0], path=a[1], format=ext(a[2])||'png';
        if(aliasMap.has(alias)) { if(aliasMap.get(alias)!==path) warnings.push(`별칭 충돌: ${alias}`); continue; }
        if(pathMap.has(path)) { warnings.push(`중복 원본 이미지 제외: ${alias}`); continue; }
        aliasMap.set(alias,path);pathMap.set(path,alias);
        plans.push({alias,path,format,rule:r.id,actor:r.actor,module:r.module});
      }
    }
    return {plans,warnings};
  }
  async function sync(dryRun) {
    if (busy) return; busy=true; $('sync').disabled=true;
    try {
      const idx=chars.findIndex(c=>cid(c)===selected);
      if(idx<0) throw Error('대상 봇을 찾을 수 없어.');
      const fresh=await Risuai.getCharacterFromIndex(idx);
      if(!fresh || cid(fresh)!==selected)throw Error('대상 봇이 변경되었어. 창을 다시 열어줘.');
      const {plans,warnings}=plansForTarget();
      const existing=Array.isArray(fresh.additionalAssets) ? fresh.additionalAssets : [];
      const previous=Array.isArray(tracked[selected]) ? tracked[selected] : [];
      const previousKeys = new Set(previous.map(a=>JSON.stringify([a.alias,a.path])));
      const desiredKeys = new Set(plans.map(a=>JSON.stringify([a.alias,a.path])));
      const kept = existing.filter(a=>!previousKeys.has(JSON.stringify([a[0],a[1]])));
      const names = new Set(kept.map(a=>a[0]));
      const paths = new Set(kept.map(a=>a[1]));
      const inserted=[], skipped=[];
      for(const p of plans){
        if(names.has(p.alias)){skipped.push(`기존 별칭 충돌: ${p.alias}`);continue;}
        if(paths.has(p.path)){skipped.push(`이미 연결된 경로: ${p.alias}`);continue;}
        names.add(p.alias);paths.add(p.path);inserted.push(p);
      }
      const removeCount=existing.length-kept.length;
      let report=`대상 봇: ${fresh.name}\n등록된 매핑: ${rules.filter(r=>r.target===selected).length}개\n연결될 에셋: ${inserted.length}개\n이전 플러그인 연결 해제: ${removeCount}개\n기존 에셋 유지: ${kept.length}개\n`;
      if(warnings.length||skipped.length)report+='\n주의: '+[...warnings,...skipped].slice(0,30).join('\n- ');
      if(inserted.length)report+='\n\n출력 예시:\n'+inserted.slice(0,8).map(p=>`{{image::${p.alias}}}  [${p.actor}]`).join('\n');
      if(dryRun){log(report+'\n\n미리보기만 수행했어. 캐릭터 데이터 변경 없음.');return;}
      if(!confirm(`${fresh.name}: ${inserted.length}개 경로를 연결하고 이전 플러그인 연결 ${removeCount}개를 정리할까? 원본 모듈은 수정하지 않아.`))return;
      // Store manifest first so recovery can identify linked items if an app save fails.
      const oldManifest=clone(tracked[selected]||[]);
      tracked[selected]=inserted.map(p=>({alias:p.alias,path:p.path,module:p.module,rule:p.rule}));
      await persist();
      try {
        const next=clone(fresh);
        next.additionalAssets=kept.concat(inserted.map(p=>[p.alias,p.path,p.format]));
        await Risuai.setCharacterToIndex(idx,next);
      } catch(err) {
        tracked[selected]=oldManifest;await persist();throw err;
      }
      log(report+'\n\n적용 완료. 원본 모듈 및 이미지 바이너리는 건드리지 않았어.');
    }catch(err){log('오류: '+String(err?.message||err));}
    finally {busy=false;$('sync').disabled=false;}
  }
  // Select only from previously synchronized paths. No source module write or binary copying.
  // This is a deterministic, offline filename/tag heuristic; it does not call the LLM.
  const intents = [
    {tags:['surprised','shock','startled','astonished'],words:['놀라','깜짝','당황','어쩌','헉','놀랐','놀란']},
    {tags:['blush','shy','flustered','embarrassed'],words:['부끄','얼굴이 빨','홍조','수줍','볼이 빨','귀가 빨','민망']},
    {tags:['angry','annoyed','pouting','mad'],words:['화가','화내','짜증','투덜','삐졌','불만','노려']},
    {tags:['sad','cry','tears','upset'],words:['눈물','울었','울먹','슬퍼','울음','흐느']},
    {tags:['smile','happy','laugh','joy'],words:['웃었','미소','기뻐','즐거','웃음','활짝']},
    {tags:['worried','nervous','anxious'],words:['긴장','불안','걱정','떨리','초조']},
    {tags:['aroused','excited','flushed'],words:['숨이 가빠','숨을 삼','심장이','두근','흥분']},
    {tags:['sleep','sleepy','tired'],words:['졸려','잠들','하품','피곤']},
    {tags:['serious','thinking','confused'],words:['생각','고민','의아','물었','질문']}
  ];
  function chooseAsset(items, context, used) {
    let best=null, bestScore=-1e9;
    const lower=context.toLowerCase();
    const active=intents.filter(it=>it.words.some(w=>lower.includes(w)));
    for(const item of items) {
      if(used.has(item.alias)) continue;
      const name=item.alias.toLowerCase();
      let score=0;
      for(const [rank,it] of active.entries()) if(it.tags.some(tag=>name.includes(tag)))score+=25-rank;
      // Avoid explicit/varying costumes unless the text clearly asks for them.
      for(const costume of ['nude','bunnysuit','school_uniform','casual','royalicing']) {
        if(name.includes(costume) && !lower.includes(costume.replace('_',' '))) score-=costume==='casual'?2:8;
      }
      if(name.includes('neutral')||name.includes('normal')||name.includes('default'))score+=1;
      // Deterministic selection, with no random output changes on re-generation.
      if(score>bestScore||(score===bestScore && best && name.localeCompare(best.alias.toLowerCase())<0)) {best=item;bestScore=score;}
    }
    return best;
  }
  function findActorPosition(text, actor) {
    const alternatives=[actor,actor.split(/[\s/]+/)[0]].filter(Boolean);
    for(const name of alternatives){
      const escaped=name.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
      const re=new RegExp('(^|\\n)(\\[[^\\]\\n]*'+escaped+'[^\\]\\n]*\\]|[^\\n]{0,36}'+escaped+'[^\\n]{0,20})','im');
      const m=re.exec(text);if(m)return m.index + m[1].length;
    }
    return -1;
  }
  function autoInsertImages(text, characterId) {
    if(!autoEnabled || !text || !characterId)return text;
    const matched=rules.filter(r=>r.target===characterId);
    const manifest=Array.isArray(tracked[characterId])?tracked[characterId]:[];
    if(!matched.length||!manifest.length)return text;
    // Existing linked images are not duplicated. Other modules' images do not block insertion.
    const existing=new Set();
    for(const entry of manifest) if(text.includes('{{image::'+entry.alias+'}}')||text.includes('<img="'+entry.alias+'">'))existing.add(entry.alias);
    const insertions=[];const used=new Set(existing);
    for(const rule of matched){
      if(insertions.length>=maxImages)break;
      const position=findActorPosition(text,rule.actor);
      if(position<0)continue;
      const actorAssets=manifest.filter(entry=>entry.rule===rule.id && entry.alias && entry.path);
      if(!actorAssets.length)continue;
      const context=text.slice(Math.max(0,position-240),Math.min(text.length,position+520));
      const choice=chooseAsset(actorAssets,context,used);
      if(!choice)continue;
      used.add(choice.alias);
      insertions.push({position,alias:choice.alias,actor:rule.actor});
    }
    if(!insertions.length)return text;
    // Insert once near the first mention/speaker block, keeping all original prose intact.
    for(const item of insertions.sort((a,b)=>b.position-a.position)) {
      const marker='{{image::'+item.alias+'}}';
      text=text.slice(0,item.position)+marker+'\n\n'+text.slice(item.position);
    }
    return text;
  }
  const afterRequestHandler=async (content,requestType) => {
    if(typeof content!=='string'||!content.trim())return content;
    try {
      // A replacer may also run for auxiliary model calls: only act on ordinary chat responses.
      if(requestType && /translate|embedding|summary|memory|aux|emotion/i.test(String(requestType)))return content;
      const c=await Risuai.getCharacter();
      const id=cid(c);
      if(!id)return content;
      // Read latest persisted state: works without opening the settings UI after restart.
      await load();
      return autoInsertImages(content,id);
    } catch(error) {console.warn('[Asset Link Bridge] auto-image skipped',error);return content;}
  };

  async function openUI() {
    const db=await Risuai.getDatabase(['characters','modules']);
    if(!db){alert('캐릭터/모듈 데이터베이스 접근 권한이 필요해.');return;}
    chars=(db.characters||[]).filter(c=>c && c.type!=='group');
    modules=(db.modules||[]).filter(m=>m && availableAssets(m).length);
    await load();
    document.body.innerHTML=`<style>
      body{background:#161b29;color:#edf1fa;font:14px/1.5 system-ui,sans-serif;margin:0}main{max-width:920px;margin:20px auto;padding:20px;background:#252d40;border-radius:14px}
      h2{margin:0 0 8px}h3{margin:20px 0 10px}.muted,small{color:#bcc6d9}label{display:block;margin:9px 0 3px}input,select,button{box-sizing:border-box;background:#141d2d;border:1px solid #55627c;color:#fff;padding:9px;border-radius:7px;font:inherit}
      input,select{width:100%}button{cursor:pointer;margin:5px 5px 5px 0}button:disabled{opacity:.4}.primary{background:#365ca6} .rule{border:1px solid #526078;border-radius:8px;padding:10px;margin-bottom:8px;display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap} .fields{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:0 15px}#hints button{font-size:12px;padding:4px 7px}pre{white-space:pre-wrap;word-break:break-all;background:#111929;border-radius:7px;padding:12px;max-height:300px;overflow:auto}@media(max-width:650px){.fields{display:block}}
    </style><main><h2>Asset Link Bridge v0.5.0</h2><p class="muted">하나의 봇에 여러 모듈을 연결하고, 등장인물별 이미지 출처를 분리해. 이미지 복사/원본 모듈 수정 없음.</p>
    <label>대상 봇 (대화하는 봇)</label><select id="target"></select><h3>등장인물별 에셋 연결 규칙</h3><div id="rules"></div>
    <h3>규칙 추가 / 수정</h3><div class="fields"><div><label>봇 안에 등장하는 인물 선택</label><select id="actorSelect"></select><small id="actorInfo"></small><div id="actorManual" style="display:none"><label>목록에 없는 인물 직접 입력</label><input id="actor" placeholder="예: 클로이 / 아르토리아"/></div></div><div><label>이미지 출처 모듈</label><select id="module"></select></div>
    <div><label>모듈 안에서 선택할 캐릭터의 파일명 패턴</label><input id="filter" placeholder="예: artoria_alter"/></div><div><label>패턴 일치 방식</label><select id="mode"><option value="prefix">파일명 시작 부분 일치</option><option value="contains">파일명에 포함</option></select></div>
    <div><label>이미지 별칭 접두사 (다른 인물과 겹치지 않게)</label><input id="prefix" placeholder="예: chloe_artoria__"/></div></div>
    <p id="hints" class="muted"></p><details><summary>선택된 모듈 에셋 이름 샘플</summary><pre id="samples"></pre></details>
    <input type="hidden" id="editing"/><button class="primary" id="saveRule">이 규칙 저장</button><button id="reset">입력 초기화</button>
    <h3>자동 이미지 출력 (v0.4)</h3><label><input id="autoEnabled" type="checkbox" style="width:auto"/> 답변에 연결된 등장인물이 나오면 이미지를 자동으로 삽입</label>
    <label>답변당 최대 이미지 수</label><select id="maxImages"><option value="1">1개</option><option value="2">2개</option><option value="3">3개</option></select>
    <p class="muted">원본 답변의 내용은 유지하고 기존 {{image::별칭}} 렌더러를 사용해. 상황은 파일명/근처 문장으로 추정하며, AI에 추가 토큰을 보내지 않아. 정교한 장면 판별은 보장하지 않아.</p>
    <h3>대상 봇 에셋 적용</h3><p class="muted">규칙은 여러 개 추가할 수 있어. 미리보기를 본 다음 동기화하면 등록 규칙대로 연결하고, 이 플러그인이 기존에 추가했던 경로만 정리해. 수동 등록 에셋은 보존해.</p>
    <button id="preview">전체 매핑 미리보기</button><button class="primary" id="sync">선택 봇 에셋 동기화</button><button id="close">닫기</button>
    <pre id="output">원본 모듈이 실제로 설치되어 있어야 해. 먼저 규칙을 추가해.</pre>
    <p class="muted">주의: 파일명 기반 접두어 후보는 실제 캐릭터 식별이 아니라 추정이야. 각 인물과 이미지가 맞는지 확인해. 별칭을 출력하려면 {{image::별칭}} 호출 또는 별도의 정규식/로어북 설정이 필요해. v0.1에서 추가했던 경로는 자동으로 정리하지 않아.</p></main>`;
    $('autoEnabled').checked=autoEnabled; $('maxImages').value=String(maxImages);
    $('autoEnabled').onchange=async()=>{autoEnabled=$('autoEnabled').checked;await persistAuto();};
    $('maxImages').onchange=async()=>{maxImages=Number($('maxImages').value);await persistAuto();};
    $('target').innerHTML=chars.map(c=>option(cid(c),`${c.name} (${cid(c)})`)).join('');
    $('module').innerHTML=modules.map(m=>option(mid(m),`${m.name} (${availableAssets(m).length}개)`)).join('');
    selected=$('target').value;
    $('target').onchange=()=>{selected=$('target').value;resetForm();refreshActorCandidates();renderRules();};
    $('actorSelect').onchange=()=>{const v=$('actorSelect').value;$('actorManual').style.display=v===AUTO_ACTOR?'block':'none';$('actor').value=v===AUTO_ACTOR?'':v;};
    $('module').onchange=updateHints;
    $('preview').onclick=()=>sync(true);$('sync').onclick=()=>sync(false);
    $('close').onclick=()=>Risuai.hideContainer();
    function resetForm(){ $('editing').value='';$('actor').value='';$('actorSelect').value='';$('actorManual').style.display='none';$('filter').value='';$('prefix').value='';$('mode').value='prefix';$('saveRule').textContent='이 규칙 저장';updateHints(); }
    $('reset').onclick=resetForm;
    $('saveRule').onclick=async()=>{
      const actor=($('actorSelect').value===AUTO_ACTOR?$('actor').value:$('actorSelect').value).trim(), module=$('module').value, filter=$('filter').value.trim(), mode=$('mode').value;
      const prefix=safeName($('prefix').value.trim() || (actor+'_'));
      if(!selected || !module || !actor || !filter){log('대상 봇, 인물명, 모듈, 파일명 패턴을 모두 입력해.');return;}
      if(!prefix){log('안전한 별칭 접두사가 필요해.');return;}
      const editing=$('editing').value;
      const id=editing || ('r'+Date.now().toString(36)+Math.random().toString(36).slice(2,7));
      const record={id,target:selected,actor,module,filter,mode,prefix};
      if(editing)rules=rules.map(r=>r.id===editing?record:r);else rules.push(record);
      await persist(); resetForm();renderRules();log('매핑 규칙을 저장했어. 동기화 전에는 실제 에셋 목록을 변경하지 않아.');
    };
    updateHints();refreshActorCandidates();renderRules();
    if(!chars.length||!modules.length)log('캐릭터와 에셋을 가진 모듈이 모두 필요해. 먼저 모듈을 설치해.');
    await Risuai.showContainer('fullscreen');
  }
  Risuai.addRisuReplacer('afterRequest',afterRequestHandler).catch(err=>console.warn('[Asset Link Bridge] hook error',err));
  Risuai.registerSetting('Asset Link Bridge (다중 모듈 연결)',openUI,'','none');
  Risuai.registerButton({name:'다중 모듈 에셋 연결',icon:'',iconType:'none',location:'hamburger'},openUI);
})();