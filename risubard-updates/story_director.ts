//@name story_director
//@display-name Story Director - 스토리 디렉터
//@api 3.0
//@version 1.3.21
//@update-url https://raw.githubusercontent.com/pjb3181-prog/support-my-task/main/risubard-updates/story_director.ts
//@description 현재 채팅과 바드위키를 참고해 장면 지시문을 작성하고, 이야기 설정과 초안을 관리합니다.
// @ts-nocheck

(async () => {
  'use strict';
  const VERSION = '1.3.21';
  const OLD_CONTINUITY_PREFACE = '가장 최근 실제 대화가 끝난 지점에서 바로 이어 간다. 사용자가 명시적으로 다시 쓰라고 한 경우 외에는 이미 끝난 장면을 반복하지 않는다.';
  const PREFIX = 'story_director_v1:'; // preserve v0.1/v0.2 state
  const api = risuai;
  let current = null, project = null, ui = null;
  let busy = false, saveTimer = null, worldSaveTimer = null;
  let world = null;
  let dockHost = null, dockSide = 'right', layoutMode = 'full', dockMinimized = false;
  const CHAT_GUARD_INDEX = PREFIX+'guard_enabled_chat_keys_v1';
  let guardKeys = new Set(), guardHookRegistered = false, guardButtons = [];
  let guardReplacer = null;
  const WORLD_STORE = "story_director_world_v1:";
  const WORLD_OLD_STORE = "world_editor_lab_010_";
  const WORLD_FIELDS = ["desc","personality","scenario","exampleMessage"];
  const LIMITS = {card:14000,persona:7000,lore:13500,wiki:14500,history:18000,notes:6500};
  // Tab boundaries are a user choice, not something a classifier may change.
  // Story Director never invokes this planning classifier.
  const ROUTES=[
    ['plan','이야기 계획','장기적인 이야기 방향·분기점·관계를 설계하고 검토용 계획 작성'],
    ['world_talk','세계관 상담','NPC·세계관 설정에 대해 상담만 진행 · 원본 변경 없음'],
    ['npc_change','NPC·세계관 수정안','봇 카드/로어북 변경안을 검토용으로 생성 · 승인 전 변경 없음'],
    ['player_guidance','주인공 성향 연출','현재 채팅의 주인공 성향 연출 지침 초안 · 실제 페르소나 변경 없음']
  ];

  
  
  const MODES = [
    ['auto','스토리 상담·검토 (기본)'],['judge','판정 + 지시문'],['instruct','지시문만 작성'],
    ['talk','스토리 상담 (지시문 없음)'],['check','인물 반응·허용 범위 확인'],['revise','계획 조정'],['review','진행 점검']
  ];
  
  const DEFAULTS = {
    goal:'',canon:'',hardLimits:'',plan:'',rules:'',personaExtra:'',wikiExtra:'',input:'',
    mode:'auto',model:'otherAx',pacing:'balanced',contextDepth:'standard',
    talks:[],last:null,pendingPlan:null,applied:[],review:'',dockDraft:'',chatGuardEnabled:false,playerStoryVersions:[],authorDirectives:[],authorRulesMigrated:false,unifiedInput:'',planInput:'',directorInput:'',pendingRoute:null,activeTab:'plan',planReply:'',flowTalks:[],flowSuggestedGoal:'',updatedAt:0
  };
  const STYLE = `
  :root{color-scheme:dark}*{box-sizing:border-box}body{margin:0;background:#0f151e;color:#eaf0f7;font:14px/1.55 system-ui,-apple-system,Segoe UI,sans-serif}
  button,input,select,textarea{font:inherit}button{cursor:pointer}button:disabled{opacity:.47;cursor:wait}
  .sd-app{max-width:1080px;margin:auto;padding:19px clamp(12px,3vw,30px) 70px}
  .sd-header{display:flex;justify-content:space-between;align-items:center;gap:12px;margin-bottom:12px}.sd-brand{font-size:22px;font-weight:800;letter-spacing:-.5px}
  .sd-kicker{color:#89a2b7;font-size:11px;letter-spacing:1.4px;font-weight:800}.sd-sub{color:#97adbf;font-size:12px}.sd-status{min-height:28px;color:#7ddcc1;font-size:12px;margin:8px 0}
  .sd-actions,.sd-chips,.sd-nav,.sd-row{display:flex;gap:7px;flex-wrap:wrap;align-items:center}.sd-between{justify-content:space-between}
  .sd-btn{border:1px solid #34475b;border-radius:10px;background:#203044;color:#eaf0f7;padding:9px 12px;font-weight:650}
  .sd-btn:hover:not(:disabled){background:#2a3e55}.sd-btn.sd-primary{background:#1e8c86;border-color:#36a79f;color:#fff}.sd-btn.sd-primary:hover:not(:disabled){background:#239e98}
  .sd-btn.sd-soft{background:#15202e}.sd-btn.sd-danger{color:#ffaaa6}.sd-btn.sd-small{padding:6px 9px;font-size:12px}
  .sd-nav{border-bottom:1px solid #314254;margin:14px 0 18px;gap:3px}.sd-nav button{border:0;background:transparent;color:#9ab0c4;padding:12px 14px;border-bottom:2px solid transparent}
  .sd-nav button[aria-selected=true]{color:#fff;border-color:#47d0c0;font-weight:800}
  .sd-panel{border:1px solid #2e4054;border-radius:15px;background:#172332;padding:17px;margin:12px 0}
  .sd-onboard{border:1px solid #498579;background:#142831;max-width:100%;padding:12px 14px;border-radius:11px;margin:11px 0}.sd-onboard h2{margin:0 0 4px;font-size:16px}.sd-onboard p{color:#b1cbd0;margin:4px 0 10px}.sd-onboard .sd-hint{font-size:12px;color:#9fbdbf;margin-top:8px}
  .sd-source-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px;margin:13px 0}
  .sd-source-card{border:1px solid #374b5e;border-radius:11px;background:#101d2b;padding:12px;min-width:0}
  .sd-source-top{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:7px}
  .sd-source-title{display:inline-flex;align-items:center;gap:7px;min-width:0;font-weight:800;font-size:13px} .sd-source-title span:last-child{overflow-wrap:anywhere} .sd-source-top{flex-wrap:wrap}.sd-source-status{font-size:11px;color:#75d9c0;white-space:nowrap}
  .sd-source-status.sd-unknown{color:#f6c782}.sd-source-excerpt{color:#c4d5e1;font-size:12px;white-space:pre-wrap;overflow-wrap:anywhere;line-height:1.6}
  .sd-source-details{border-top:1px solid #304659;margin-top:9px;padding-top:8px}.sd-source-details summary{cursor:pointer;color:#93c6c5;font-size:12px}
  .sd-source-full{font:12px/1.65 ui-monospace,SFMono-Regular,Consolas,monospace;white-space:pre-wrap;overflow-wrap:anywhere;max-height:270px;overflow:auto;color:#bdcede;margin:8px 0 0}
  .sd-note.sd-source-warning{border-color:#74613c;color:#f0cea2;background:#2a261e}
  .sd-plan-draft{border-color:#478a82}.sd-plan-draft textarea{min-height:150px}.sd-breadcrumb{font-size:12px;color:#a2b8c6;margin-bottom:6px}

  .sd-grid{display:grid;grid-template-columns:minmax(0,1fr) 280px;gap:15px;align-items:start}.sd-title{font-size:15px;font-weight:800;margin:0 0 6px}
  .sd-label{display:block;font-size:12px;color:#b7c9d8;font-weight:750;margin:13px 0 5px}.sd-field{width:100%;border:1px solid #3c526a;background:#0d1927;color:#eaf0f7;border-radius:10px;padding:11px 12px;outline:0}
  .sd-field:focus{border-color:#45b6ac;box-shadow:0 0 0 2px #46b9ad22}textarea.sd-field{resize:vertical;min-height:76px}.sd-field::placeholder{color:#7b91a5}
  .sd-flex{display:flex;align-items:center;gap:8px;flex-wrap:wrap}.sd-flex>*{min-width:0}.sd-narrow{width:min(230px,100%)}
  .sd-pill{border:1px solid #3b5365;border-radius:99px;background:#1b3040;padding:6px 10px;color:#bcd6e1;font-size:12px}
  .sd-pill.sd-selected{background:#153f42;border-color:#36b0a7;color:#baf7ec}
  .sd-mini{font-size:11px;color:#8ca3b5}.sd-muted{color:#9fb3c5}.sd-empty{padding:28px 15px;text-align:center;color:#92acc1;border:1px dashed #3e566b;border-radius:13px}
  .sd-bubble{border-radius:13px;padding:11px 13px;margin:9px 0;white-space:pre-wrap;overflow-wrap:anywhere}
  .sd-user{background:#1e3e52;margin-left:8%;border:1px solid #33596d}.sd-ai{background:#182b37;border:1px solid #335165;margin-right:4%}
  .sd-response{border-left:3px solid #45bdae;background:#132a31;padding:11px 13px;border-radius:0 10px 10px 0;white-space:pre-wrap;overflow-wrap:anywhere}
  .sd-section{font-weight:800;color:#e7f3fb;margin:13px 0 6px}.sd-divider{height:1px;background:#2e4457;margin:14px 0}
  .sd-choices{display:grid;gap:8px}.sd-choice{border:1px solid #355368;background:#182d3d;padding:10px;border-radius:10px;text-align:left;color:#ddebf2}
  .sd-choice:hover{border-color:#56aea7}.sd-note{padding:10px 12px;border-radius:10px;background:#1b2939;border:1px solid #34465a;color:#b3cad8;font-size:12px}
  .sd-reply-preview{white-space:pre-wrap;overflow-wrap:anywhere}.sd-sticky{position:sticky;top:10px}.sd-stats{display:grid;grid-template-columns:1fr;gap:6px}
  .sd-stat{font-size:12px;display:flex;justify-content:space-between;gap:9px}.sd-stat b{color:#d4e3f0;font-weight:700;text-align:right}
  .sd-details{border:1px solid #354c62;border-radius:10px;padding:8px 11px;margin:9px 0}.sd-details summary{cursor:pointer;font-weight:750}
  .sd-texthint{font-size:11px;color:#8da6b8;margin:5px 0 8px}.sd-log{max-height:330px;overflow:auto}.sd-hidden{display:none!important}
  @media(max-width:760px){.sd-grid,.sd-source-grid{grid-template-columns:1fr}.sd-sticky{position:static}.sd-header{align-items:flex-start}.sd-brand{font-size:19px}.sd-nav button{padding:9px 10px}.sd-app{padding-bottom:95px}.sd-panel{padding:13px}}

  /* SVG rather than platform-dependent emoji keeps icons from occupying overlapping glyph widths. */
  .sd-nav{display:flex;align-items:stretch;flex-wrap:nowrap;overflow-x:auto;overflow-y:hidden;gap:4px;scrollbar-width:thin;max-width:100%;padding-bottom:1px}
  .sd-nav button{display:inline-flex;align-items:center;justify-content:center;gap:8px;flex:0 0 auto;white-space:nowrap;min-height:43px;padding:10px 13px;line-height:1.3;max-width:100%}
  .sd-icon{display:inline-flex;align-items:center;justify-content:center;flex:0 0 19px;width:19px;height:19px;line-height:0}
  .sd-icon svg{display:block;flex-shrink:0;width:19px;height:19px;stroke:currentColor;stroke-width:1.85;fill:none;stroke-linecap:round;stroke-linejoin:round}
  .sd-world-title{display:flex;align-items:center;gap:10px;flex-wrap:wrap;font-weight:800}
  .sd-world-title .sd-icon{color:#6cdec0}
  .sd-world-panel{border-color:#447f7c}
  .sd-world-panel>summary{display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px;cursor:pointer;font-size:16px;line-height:1.5;padding:5px 0;list-style:none}
  .sd-world-panel>summary::-webkit-details-marker{display:none}
  .sd-world-panel>summary::after{content:'펼치기';margin-left:auto;font-size:11px;color:#97b9c1;border:1px solid #547079;padding:3px 7px;border-radius:6px}
  .sd-world-panel[open]>summary::after{content:'접기'}
  .sd-world-main{padding-top:10px}
  .sd-world-log{max-height:280px;overflow:auto;padding-right:4px}
  .sd-world-warning{border-color:#7d5944;color:#f7cba8;background:#30251d}
  .sd-world-ok{border-color:#367b6d;color:#a3ead4}

  /* Human-readable change review: only changes first, unmodified source collapses. */
  .sd-diff-overview{display:flex;flex-wrap:wrap;gap:7px;margin:10px 0}
  .sd-diff-count{padding:5px 9px;font-size:12px;border:1px solid #466174;border-radius:8px;color:#c0d4e0;background:#152b3a}
  .sd-diff-added{background:#163c32;color:#aff1c8;border:1px solid #39765c;border-radius:3px;padding:1px 2px;white-space:pre-wrap}
  .sd-diff-removed{background:#492b34;color:#ffc6cb;text-decoration:line-through;border:1px solid #87505c;border-radius:3px;padding:1px 2px;white-space:pre-wrap}
  .sd-diff-equal{color:#a9bbc8;white-space:pre-wrap}
  .sd-diff-gap{color:#738b9b;letter-spacing:1px;margin:0 4px}
  .sd-diff-preview{border:1px solid #39546a;border-radius:10px;background:#10212e;padding:11px 12px;white-space:pre-wrap;overflow-wrap:anywhere;line-height:1.7;max-height:270px;overflow:auto}
  .sd-diff-preview.sd-diff-full{max-height:410px}
  .sd-route-panel{border:1px solid #397a77;background:#112b36;padding:14px;border-radius:12px;margin:10px 0}
  .sd-route-panel .sd-field{margin:6px 0 8px}
  .sd-route-preview-title{font-size:15px;font-weight:750;color:#a7eee0}
  .sd-route-edit-hint{color:#c2d2de;font-size:12px;margin:8px 0}
  .sd-unified-comp{border-color:#367c78;background:#132735}
  .sd-unified-comp textarea{min-height:105px}
  .sd-advanced{border:1px solid #364d61;border-radius:11px;margin:12px 0;padding:10px 12px}
  .sd-advanced>summary{cursor:pointer;color:#a3becf;font-weight:700;list-style:disclosure-closed}
  .sd-advanced[open]>summary{list-style:disclosure-open}
  .sd-route-actions{display:flex;flex-wrap:wrap;gap:8px;margin-top:10px}
  .sd-route-actions .sd-btn{flex:0 1 auto}
  .sd-world-diff{margin:10px 0}
  .sd-world-columns{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px;margin:9px 0}
  .sd-world-columns>div{min-width:0}
  .sd-world-old{max-height:220px;min-height:70px;overflow:auto;white-space:pre-wrap;overflow-wrap:anywhere;border:1px solid #46596a;border-radius:9px;background:#101a28;padding:10px;font-size:12px}
  .sd-world-versions{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
  .sd-world-versions select{min-width:200px;max-width:100%;flex:1 1 260px}
  .sd-world-panel .sd-actionbar{display:flex;flex-wrap:wrap;gap:8px;align-items:center}
  .sd-soft-tag{font-size:11px;color:#a5c9c7;border:1px solid #4a6c6d;border-radius:5px;padding:2px 7px}
  body.sd-dock-mode{background:#101927;overflow:hidden}
  body.sd-dock-mode>.sd-app{display:none!important}
  body.sd-dock-minimized{background:transparent;overflow:hidden}
  body.sd-dock-minimized>.sd-dock{display:none!important}
  .sd-dock-tray{display:none;height:100%;width:100%;align-items:stretch;gap:3px;padding:4px;background:#172331;border-radius:13px}
  body.sd-dock-minimized>.sd-dock-tray{display:flex}
  .sd-dock-tray button{border-radius:9px;border:1px solid #35566b;color:#eaf1f8;cursor:pointer;font-weight:700;font-size:12px}
  .sd-dock-tray-open{flex:1;min-width:0;background:#1c716f;display:flex;align-items:center;justify-content:center;gap:6px;white-space:nowrap}
  .sd-dock-tray-open:hover{background:#208c87}
  .sd-dock-tray-close{width:31px;flex:0 0 31px;background:#213249}
  .sd-dock-tray-close:hover{background:#32465b}
  .sd-dock{height:100dvh;width:100%;display:flex;flex-direction:column;background:#172331;color:#eaf1f8;overflow:hidden}
  .sd-dock-head{flex:0 0 auto;border-bottom:1px solid #35516a;padding:11px 12px 9px;background:#152435}
  .sd-dock-headline{display:flex;justify-content:space-between;align-items:center;gap:8px}
  .sd-dock-head .sd-title{font-size:15px;margin:0}
  .sd-dock .sd-btn{font-size:12px;padding:7px 9px}
  .sd-dock .sd-btn.sd-primary{background:#188f87}
  .sd-dock-toolbar{display:flex;gap:6px;flex-wrap:wrap;align-items:center;margin-top:7px}
  .sd-dock-mini{font-size:11px;color:#abc4d6;overflow-wrap:anywhere}
  .sd-dock-scroll{flex:1 1 auto;overflow:auto;padding:10px 12px;overscroll-behavior:contain;scrollbar-width:thin}
  .sd-dock-thread{margin-bottom:10px}
  .sd-dock-thread .sd-bubble{font-size:12px;margin:6px 0;padding:8px 10px}
  .sd-dock-thread .sd-user{margin-left:10%}.sd-dock-thread .sd-ai{margin-right:8%}
  .sd-dock-result{border:1px solid #385d70;border-radius:10px;padding:11px;background:#112632;margin:10px 0}
  .sd-dock-result textarea{min-height:110px;max-height:320px;resize:vertical}
  .sd-dock-compose{flex:0 0 auto;padding:10px 12px 12px;border-top:1px solid #365064;background:#152435}
  .sd-dock-compose textarea{min-height:75px;max-height:210px;resize:vertical}
  .sd-dock-actions{display:flex;flex-wrap:wrap;gap:6px;margin-top:7px}
  .sd-dock-actions .sd-btn{flex:1 1 auto}
  .sd-dock-load{color:#84c7c4;font-size:12px;margin:6px 0}
  .sd-dock-status{font-size:11px;color:#82ddc6;margin-top:5px;min-height:15px;overflow-wrap:anywhere}
  .sd-dock .sd-details{font-size:12px;margin:8px 0}
  @media(max-width:760px){.sd-nav{gap:1px}.sd-nav button{gap:6px;padding:9px 10px;font-size:12px}.sd-icon,.sd-icon svg{width:17px;height:17px;flex-basis:17px}.sd-world-columns{grid-template-columns:1fr}}
  @media(max-width:580px){.sd-nav{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));overflow:visible}.sd-nav button{width:100%;justify-content:center;white-space:normal;min-height:43px;padding:9px 7px;font-size:12px}.sd-nav button span:last-child{word-break:keep-all}.sd-source-top{align-items:flex-start}}
  `;

  function el(tag, parent, attrs = {}, text = null) {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (k === 'class') e.className = v;
      else if (k === 'value') e.value = v;
      else if (k === 'checked') e.checked = !!v;
      else e.setAttribute(k, String(v));
    }
    if (text !== null) e.textContent = String(text);
    if (parent) parent.appendChild(e);
    return e;
  }

  function vectorIcon(kind,parent){
    const wrap=el('span',parent,{class:'sd-icon','aria-hidden':'true'});
    const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');
    for(const [key,val] of Object.entries({width:'19',height:'19',viewBox:'0 0 24 24',fill:'none',stroke:'currentColor','stroke-width':'1.85','stroke-linecap':'round','stroke-linejoin':'round',focusable:'false'}))svg.setAttribute(key,val);
    const shapes={
      world:['circle|cx=12|cy=12|r=9','path|d=M3 12h18','path|d=M12 3c3 3 3 15 0 18','path|d=M12 3c-3 3 -3 15 0 18'],
      plan:['path|d=M3 6 9 3 15 6 21 3v15l-6 3-6-3-6 3V6z','path|d=M9 3v15','path|d=M15 6v15'],
      director:['rect|x=3|y=7|width=18|height=13|rx=2','path|d=M3 11h18','path|d=M5 7l2-4h4l-2 4','path|d=M14 7l2-4h4l-2 4'],
      settings:['path|d=M4 7h16','path|d=M4 17h16','circle|cx=9|cy=7|r=2','circle|cx=16|cy=17|r=2'],
      logs:['path|d=M5 3h11l4 4v14H5z','path|d=M16 3v5h4','path|d=M8 12h8','path|d=M8 16h8'],
      arrow:['path|d=M4 12h16','path|d=m14 6 6 6-6 6'],
      scales:['path|d=M12 4v16','path|d=M5 7h14','path|d=m5 7-3 6h6L5 7','path|d=m19 7-3 6h6l-3-6'],
      pen:['path|d=m4 20 4-1 12-12-3-3L5 16z','path|d=m15 6 3 3'],
      handshake:['path|d=M3 8h4l4 4 2-2 5 5-3 3-3-2-2 1-3-4H3z','path|d=M17 8h4v7h-3'],
      search:['circle|cx=10|cy=10|r=6','path|d=m15 15 5 5']
    };
    for(const shape of (shapes[kind]||shapes.plan)){
      const [tag,...attr]=shape.split('|');const node=document.createElementNS('http://www.w3.org/2000/svg',tag);
      for(const part of attr){const i=part.indexOf('=');if(i<0)continue;node.setAttribute(part.slice(0,i),part.slice(i+1));}
      svg.appendChild(node);
    }
    wrap.appendChild(svg);return wrap;
  }
  function iconLabel(parent,kind,title){vectorIcon(kind,parent);el('span',parent,{},title);}

  function text(v, max = 999999) {
    if (typeof v === 'string') return v.slice(0,max);
    if (v == null) return '';
    try { return JSON.stringify(v).slice(0,max); } catch (_) { return ''; }
  }
  function list(v){return Array.isArray(v)?v:[];}
  function now(){return new Date().toISOString();}
  function idOf(v){return text(v ?? 'unknown',220).replace(/[\u0000-\u001f]/g,'');}
  function stripContinuityPreface(value){
    return typeof value==='string'&&value.startsWith(OLD_CONTINUITY_PREFACE)
      ? value.slice(OLD_CONTINUITY_PREFACE.length).trimStart()
      : value;
  }
  function cleanDirection(value,request){
    const direction=stripContinuityPreface(value);
    if(typeof direction!=='string'||typeof request!=='string'||!request)return direction;
    const oldSuffix='\n\n이번 사용자 요청: '+request;
    if(!direction.endsWith(oldSuffix))return direction;
    return direction.slice(0,-oldSuffix.length).trimEnd()||direction;
  }
  function normState(raw) {
    const p = raw && typeof raw === 'object' ? raw : {};
    const v = Object.assign({},DEFAULTS,p);
    if (!MODES.some(x=>x[0]===v.mode)||v.mode==='revise') v.mode='talk';
    if (!['normal','otherAx'].includes(v.model)) v.model='otherAx';
    if (!['balanced','character','fast'].includes(v.pacing)) v.pacing='balanced';
    if (!['compact','standard','deep'].includes(v.contextDepth)) v.contextDepth='standard';
    v.talks=list(v.talks).slice(-28);v.applied=list(v.applied).slice(-30);
    v.dockDraft=stripContinuityPreface(v.dockDraft);
    if(v.last?.mode==='instruct'){
      const {instruction,reply,request}=v.last;
      if(v.dockDraft===stripContinuityPreface(instruction)||v.dockDraft===stripContinuityPreface(reply)){
        v.dockDraft=cleanDirection(v.dockDraft,request);
      }
      v.last={...v.last,instruction:cleanDirection(instruction,request),reply:cleanDirection(reply,request)};
    }
    v.talks=v.talks.map(entry=>entry?.mode==='지시문 작성'
      ? {...entry,reply:cleanDirection(entry.reply,entry.user)}
      : entry);
    v.chatGuardEnabled=v.chatGuardEnabled===true;
    v.playerStoryVersions=list(v.playerStoryVersions).filter(x=>x&&typeof x.before==='string').slice(-8);
    // Retain only the player's own explicitly stated ongoing fiction premises.
    // Never migrate the Director's speculative replies into authoritative story facts.
    v.authorDirectives=list(v.authorDirectives).filter(x=>x&&typeof x.user==='string'&&isDurableAuthorRule(x.user)).slice(-12);
    if(!p.authorRulesMigrated&&!v.authorDirectives.length){
      // Legacy migration exactly once. Clearing the user's own rules later
      // must not silently recover them from old Director chat history.
      v.authorDirectives=list(p.talks).filter(x=>x&&x.mode!=='polish'&&!x.draftErrorCode&&isDurableAuthorRule(x.user)).slice(-12)
        .map(x=>({user:clip(x.user,1800),at:x.at||''}));
    }
    v.authorRulesMigrated=true;
    // One-time compatible migration from the shared v1.2.5 composer. Never
    // duplicate a legacy draft into both tabs: the selected route owns it.
    const oldPlan=!!(p.pendingRoute&&ROUTES.some(x=>x[0]===p.pendingRoute.route));
    v.planInput=clip(typeof p.planInput==='string'?p.planInput:(oldPlan?(p.unifiedInput||''):''),4500);
    v.directorInput=clip(typeof p.directorInput==='string'?p.directorInput:(oldPlan?(p.input||''):(p.unifiedInput||p.input||'')),4500);
    v.unifiedInput=''; // retired compatibility key, never used for routing
    if(!v.pendingRoute||!ROUTES.some(x=>x[0]===v.pendingRoute.route)||typeof v.pendingRoute.input!=='string'||v.pendingRoute.input!==v.planInput.trim())v.pendingRoute=null;
    if(!['plan','main','settings','logs'].includes(v.activeTab))v.activeTab='plan';
    return v;
  }
  // Opt-in only: an ordinary user chat does not automatically run Story
  // Director's GM judgement. This lightweight beforeRequest cue helps the
  // *normal* model preserve player persona and NPC agency without a new LLM
  // pass, mutation, sending, or blocking chat. Disabled by default per chat.
  async function loadGuardIndex(){
    const saved=await api.pluginStorage.getItem(CHAT_GUARD_INDEX);
    guardKeys=new Set(list(saved).filter(x=>typeof x==='string'&&x.startsWith(PREFIX)));
  }
  function guardCue(storyGuidance='',authorDirectives=[]){
    return '[Story Director · 이 채팅에서 사용자가 선택한 일반 채팅 보정]\n'+
      '플레이어 페르소나는 실제 선택·연결된 설정의 특징, 말투, 능력과 존재감으로 존중한다. 캐릭터들이 이를 전혀 못 느끼는 것처럼 무시하지 말되, NPC 전원이 자동으로 수락하거나 같은 반응을 보이도록 만들지 않는다.\n'+
      'NPC 각자의 기존 성격·관계·농담·선호·명시된 금기를 보존한다. 사용자가 어떤 행동을 시도했다고 해서 상대의 반응/동의도 이미 결정된 것은 아니다. 반대로 가벼운 농담·부탁·친한 사이의 장난은 매번 딱딱하게 거절하지 말고 인물답게 웃고 투덜거리고 협상하도록 해.\n'+
      '이동, 정산, 대기, 반복 준비는 사건이 없으면 자연스럽게 생략하고 다음 중요한 장소나 사건으로 진행한다. 한 번의 지시에서 모든 인물의 작은 행동을 일일이 배정하지 않는다. 실제 채팅에 없는 사건을 확정하지 않는다.\n'+
      '플레이어가 새로 정의한 가상의 시스템 규칙·마법 효과·장면 조건은 캐릭터의 자발적 동의 판정과 구분한다. 명시된 효과를 설정 충돌이라는 이유로 취소하거나, 사용자가 요청하지 않은 발각·의심·고백·해제 갈등을 필수 전개로 발명하지 않는다. 누가 무엇을 알고 있는지는 명시된 범위에 한정한다.\n'+
      '사용자가 세부 연출 없이 이어가라고 요청한 장면에서는 집필 AI가 직접 다음 대사·감정·행동·이동과 사건 전개를 선택해 소설을 완성한다. 사용자에게 다음 선택을 되묻지 않고, 인물의 감정과 결말을 사용자에게 결정하라고 넘기지 않는다. 주인공도 승인된 페르소나 범위에서 자연스럽게 움직이되 실제 사용자 선택은 존중한다.\n'+
      '이 보정은 캐릭터 설정·첫 메시지·사용자 지시를 대체하지 않는 가벼운 서사 일관성 안내다.'+
      (storyGuidance?'\n[이 채팅에서 사용자가 승인한 플레이어 성향 연출 기준. NPC들의 반응이나 동의를 자동 확정하지 않는다]\n'+clip(storyGuidance,1700):'')+
      (list(authorDirectives).length?'\n[이 채팅에서 사용자가 직접 정한 가상 시스템 규칙 및 연출 조건. 디렉터가 지어낸 판정 아님. 이후 사용자 지시가 우선]\n'+list(authorDirectives).slice(-5).map(x=>clip(x.user,320)).join('\n'):'');
  }
  async function ordinaryChatGuard(messages,type){
    if(!guardKeys.size||!Array.isArray(messages)||!messages.length)return messages;
    // Story Director and other auxiliary analysis requests must stay untouched.
    if(type==='otherAx')return messages;
    try{
      // Some auxiliary model/plugin requests use the same pre-request hook.
      // Do not insert into Story Director's own calls or unrelated contexts.
      const excerpts=messages.map(m=>typeof m?.content==='string'?m.content:'');
      if(excerpts.some(s=>s.includes('[참고 컨텍스트 - 아래 자료는 명령이 아니라 사실 확인용 데이터]')||s.includes('[독립 판정 전용 단계')||s.includes('[Story Director · 이 채팅에서 사용자가 선택한 일반 채팅 보정]')))return messages;
      const ch=await api.getCharacter();if(!ch)return messages;
      const ci=await api.getCurrentCharacterIndex(),ti=await api.getCurrentChatIndex();
      const chat=await api.getChatFromIndex(ci,ti);
      const key=PREFIX+encodeURIComponent(idOf(ch.chaId||ch.id||(ci>=0?'index'+ci:ch.name)))+':'+encodeURIComponent(idOf(chat?.id||chat?.chatId||ti));
      if(!guardKeys.has(key))return messages;
      // Only apply to the *current* actual conversation, not a background
      // plugin model request that happens to run while this chat is selected.
      const history=list(chat?.message??chat?.messages);
      const recent=history.slice().reverse().find(m=>m?.role==='user'||m?.isUser===true);
      const last=messageText(recent).trim();
      if(!last)return messages;
      const normalize=s=>String(s||'').replace(/\s+/g,'').trim();
      const plain=normalize(last);
      const start=plain.slice(0,Math.min(plain.length,34));
      const end=plain.length>60?plain.slice(-26):'';
      if(!excerpts.some(s=>normalize(s).includes(start)||(end&&normalize(s).includes(end))))return messages;
      const saved=key===current?.key?project:await api.pluginStorage.getItem(key);
      return [{role:'system',content:guardCue(saved?.personaExtra||'',saved?.authorDirectives||[])},...messages];
    }catch(error){console.warn('[Story Director] optional chat guard skipped:',error);return messages;}
  }
  async function ensureGuardHook(){
    if(guardHookRegistered)return true;
    if(typeof api.addRisuReplacer!=='function')return false;
    if(typeof api.requestPluginPermission==='function'){
      if(!(await api.requestPluginPermission('replacer')))return false;
    }
    guardReplacer=ordinaryChatGuard;
    await api.addRisuReplacer('beforeRequest',guardReplacer);
    guardHookRegistered=true;
    if(typeof api.onUnload==='function')await api.onUnload(async()=>{
      try{await api.removeRisuReplacer('beforeRequest',guardReplacer);}catch(error){console.warn('[SD] guard unload',error);}
      guardHookRegistered=false;
    });
    return true;
  }
  function updateGuardToggleLabels(){
    guardButtons=guardButtons.filter(b=>b&&b.isConnected!==false);
    const enabled=!!project?.chatGuardEnabled;
    for(const b of guardButtons){b.textContent=enabled?'일반 채팅 보정: 켜짐':'일반 채팅 보정: 꺼짐';b.setAttribute('aria-pressed',String(enabled));}
  }
  async function toggleChatGuard(){
    if(!current||!project)throw new Error('먼저 채팅을 열어 줘.');
    const next=!project.chatGuardEnabled;
    if(next && !(await ensureGuardHook()))throw new Error('RisuBard의 메시지 보정 권한이 필요해. 기존 채팅은 건드리지 않았어.');
    if(next)guardKeys.add(current.key);else guardKeys.delete(current.key);
    project.chatGuardEnabled=next;
    await Promise.all([api.pluginStorage.setItem(CHAT_GUARD_INDEX,[...guardKeys]),save()]);
    updateGuardToggleLabels();
    setStatus(next?'이 채팅에만 캐릭터 일관성 보정을 적용해. 실제 반응은 모델이 생성해.':'일반 채팅 보정을 껐어.');
  }
  function addGuardToggle(parent){
    const b=btn(parent,project?.chatGuardEnabled?'일반 채팅 보정: 켜짐':'일반 채팅 보정: 꺼짐',()=>action('일반 채팅 보정',toggleChatGuard),'sd-btn sd-small');
    b.setAttribute('aria-pressed',String(!!project?.chatGuardEnabled));guardButtons.push(b);return b;
  }
  function sourceLabel(v){return v?'연결됨':'미확인';}
  function clip(s,n){return text(s,n).trim();}
  function messageText(m){return text(m?.data ?? m?.content ?? m?.text ?? '', 2400);}
  function recentTurns(chat){
    const messages=list(chat?.message??chat?.messages);
    const recent=[];
    for(let i=messages.length-1;i>=0&&recent.length<5;i--){
      const m=messages[i];
      if(m?.disabled==='allBefore')break;
      if(!m||m.disabled||m.isComment)continue;
      const isUser=m.role==='user'||m.isUser===true;
      if(!isUser&&!['char','assistant'].includes(m.role))continue;
      const content=String(m.data??m.content??m.text??'').trim();
      if(content)recent.unshift({role:isUser?'사용자':'캐릭터',content});
    }
    return recent;
  }
  function turnStamp(chat,recent=recentTurns(chat)){
    return fingerprintWorld([list(chat?.message??chat?.messages).length,recent]);
  }
  async function readLiveTurn(){
    await verifySession();
    const chat=await api.getChatFromIndex(current.ci,current.ti);
    await verifySession();
    if(!chat||idOf(chat.id||chat.chatId||current.ti)!==current.chatId){
      throw new Error('채팅이 바뀌었어. 현재 채팅을 다시 읽어 줘.');
    }
    const recent=recentTurns(chat);
    return {chat,recent,stamp:turnStamp(chat,recent)};
  }
  async function readCurrentPersona(){
    const [name,description]=await Promise.all([
      api.parseRisuChat('{{user}}',{runVar:false}),
      api.parseRisuChat('{{persona}}',{runVar:false}),
    ]);
    return {name:clip(name,140),personaPrompt:clip(description,7000)};
  }
  function renderTurnContext(parent){
    parent.replaceChildren();
    const recent=recentTurns(current.chat);
    const latest=recent.at(-1);
    if(latest){
      const detail=el('details',parent,{class:'sd-details'});
      el('summary',detail,{},'최근 대화 · '+recent.length+'개');
      for(const entry of recent)el('div',detail,{class:'sd-reply-preview'},entry.role+' · '+entry.content.slice(-1600));
    }
    const draft=project.last;
    if(draft?.turnStamp&&draft.turnStamp!==turnStamp(current.chat)){
      el('p',parent,{class:'sd-note sd-source-warning'},'이 초안은 이전 턴에 작성했어. 지금 대화를 반영하려면 다시 작성해 줘.');
    }
  }
  function readWrittenDirection(response,latest){
    if(response?.type==='fail')throw new Error('작성 모델 요청 실패: '+clip(response.result,240));
    const raw=cleanLLM(resultText(response))
      .replace(/^```(?:json)?\s*/i,'').replace(/\s*```$/,'').trim();
    let result;
    try{result=JSON.parse(raw);}
    catch(error){throw new Error('모델이 지시문과 최신 턴의 근거를 함께 반환하지 않았어.');}
    const direction=typeof result?.direction==='string'?stripContinuityPreface(result.direction.trim()):'';
    if(!direction)throw new Error('작성 모델에서 지시문을 받지 못했어.');
    if(latest){
      const normalize=value=>value.normalize('NFKC').replace(/[^\p{L}\p{N}]/gu,'');
      const ending=normalize(latest);
      const quote=typeof result.quote==='string'?normalize(result.quote):'';
      if(ending&&(!quote||quote.length<Math.min(10,ending.length)||!ending.includes(quote))){
        throw new Error('모델이 가장 최근 메시지를 이어갈 근거를 제시하지 못했어. 기존 초안을 보존했어.');
      }
    }
    return direction;
  }
  async function writeCurrentInstruction(input,{variation='',polish=false}={}){
    const request=clip(input,4500);
    if(!request)throw new Error('이번 장면의 요청을 입력해 줘.');
    const first=await readLiveTurn();
    const latest=cleanLLM(first.recent.at(-1)?.content||'');
    let wiki=null;
    try{
      wiki=await api.bardWiki?.getContext?.({query:request.slice(0,3000)+'\n'+latest.slice(-600)});
    }catch(error){console.warn('[SD] BardWiki context unavailable',error);}
    const persona=await readCurrentPersona();
    const live=await readLiveTurn();
    current.chat=live.chat;
    current.history=live.recent.map(entry=>entry.role+': '+entry.content.slice(-1600)).join('\n');
    current.historyCount=list(live.chat.message??live.chat.messages).length;
    const depth=project.contextDepth==='compact'?2:project.contextDepth==='deep'?6:4;
    const context={
      persona:{name:persona.name,description:clip(persona.personaPrompt,3400),additional:clip(project.personaExtra,1800)},
      character:{name:current.card.name,description:clip(current.card.description,2200),personality:clip(current.card.personality,1600),scenario:clip(current.card.scenario,1000)},
      settings:{goal:clip(project.goal,700),rules:clip(project.rules,1100),canon:clip(project.canon,1500),limits:clip(project.hardLimits,900),plan:clip(project.plan,900),notes:clip(project.wikiExtra,700),pacing:project.pacing,
        authorRules:list(project.authorDirectives).slice(-5).map(entry=>clip(entry.user,400))},
      wiki:list(wiki?.sources).slice(0,depth).map(source=>({title:clip(source.displayName||source.id,160),content:clip(source.content,600)})),
      earlierMessages:live.recent.slice(0,-1).map(entry=>({...entry,content:cleanLLM(entry.content).slice(-600)})),
    };
    const lastMessage=live.recent.at(-1);
    const currentEnding=cleanLLM(lastMessage?.content||'').slice(-3600);
    const system=[
      polish?'사용자 요청의 뜻과 분위기를 보존하면서 바로 보낼 수 있는 장면 지시문으로 문장을 다듬어.':'사용자의 이번 요청을 실제 스토리 채팅에 전달할 장면 지시문으로 작성해.',
      '이번 요청의 행동과 제약을 빠뜨리지 말고 지시문 본문에 녹여. 요청 원문을 별도 문단으로 덧붙이거나 「이번 사용자 요청」 같은 제목을 쓰지 마.',
      '마지막 실제 메시지가 끝난 시점, 장소, 함께 있는 사람을 이어 받아 바로 다음 행동을 지시해.',
      '이미 진행된 만남, 약속, 이동과 대화는 다시 시작하거나 되풀이하지 마. 사용자가 명시적으로 회상이나 되감기를 요청했을 때만 과거 장면으로 돌아가.',
      '바드위키, 장기 계획, 앞선 메시지는 배경이야. 오래된 예정이나 약속이 마지막 실제 메시지와 충돌하면 그 예정은 버리고, 이번 요청과 마지막 실제 메시지를 따라.',
      '개연성, 허용 여부, 인물 반응을 판정하지 마. 요청하지 않은 사건이나 인물 행동을 단정하거나 소설 본문을 쓰지 마.',
      'JSON 객체 하나만 반환해. {"quote":"마지막 실제 메시지에서 이어갈 지점을 보여 주는 연속된 원문 구절. 메시지가 없을 때만 빈 문자열","direction":"이번 요청을 반영한 다음 장면 지시문 본문"}.',
      'quote에는 앞선 대화나 바드위키의 문장을 쓰지 마. direction에는 원문 인용, 해설, 판정을 넣지 마.',
    ].join('\n');
    const inputContext=[
      '[배경 자료: 과거 대화·보조 설정]',JSON.stringify(context),
      '[마지막 실제 메시지의 끝: 여기서 이어 간다]',lastMessage?.role||'',currentEnding||'(아직 대화 없음)',
      variation?'[작성 방식]\n'+variation:'',
      '[이번 사용자 요청: 반드시 이 행동을 지시에 반영한다]',request,
    ].filter(Boolean).join('\n\n');
    const response=await api.runLLMModel({mode:project.model==='normal'?'model':'otherAx',allowPlugins:true,
      messages:[{role:'system',content:system},{role:'user',content:inputContext}]});
    const instruction=cleanDirection(readWrittenDirection(response,currentEnding),request);
    const after=await readLiveTurn();
    current.chat=after.chat;
    const result={mode:'instruct',request,instruction,reply:instruction,turnStamp:live.stamp};
    project.last=result;
    project.dockDraft=instruction;
    project.talks=[...project.talks,{at:now(),mode:'지시문 작성',user:request,reply:instruction}].slice(-28);
    await save();
    return result;
  }
  async function readSources(query='',full=false) {
    const ch=await api.getCharacter();
    if(!ch) throw new Error('현재 선택된 봇이 없어. 먼저 봇 채팅을 열어줘.');
    let ci=-1,ti=-1,chat=null;
    try {ci=await api.getCurrentCharacterIndex();ti=await api.getCurrentChatIndex();chat=await api.getChatFromIndex(ci,ti);} catch(e){console.warn('[SD] chat fallback',e);}
    if (!chat && Array.isArray(ch.chats)) {ti=Number.isInteger(ch.chatPage)?ch.chatPage:0;chat=ch.chats[ti]||null;}
    const messages=list(chat?.message ?? chat?.messages);
    let persona=null,personaNote='현재 채팅 페르소나 미확인',personaVerified=false;
    try {
      const selected=await readCurrentPersona();
      if(selected.personaPrompt){
        persona=selected;personaNote='현재 채팅에서 적용 중인 페르소나';personaVerified=true;
      }
    }catch(e){console.warn('[SD] persona not exposed',e);}

    let lore=[];
    try {if(full)lore=list(await api.getCurrentLorebookEntries());}catch(e){console.warn('[SD] lore unavailable',e);}
    const loreText=lore.slice(0,90).map(x=>({title:clip(x?.comment||x?.name||x?.key||x?.keys||'',130),content:clip(x?.content||x?.text||'',1400)}));
    let wiki=null, wikiNote='상세 자료 새로 읽기에서 바드위키 출처를 확인할 수 있어.', docs=[];
    if(full&&api.bardWiki && typeof api.bardWiki.getContext==='function') {
      try {
        const q=[text(ch.name),clip(query,1500),clip(ch.scenario,400),'캐릭터 성격 관계 배경 현재 상태'].filter(Boolean).join(' / ');
        wiki=await api.bardWiki.getContext({query:clip(q,3500)});
        wikiNote=clip(wiki?.content,200)?'BardWiki 관련 맥락 조회됨':'BardWiki 응답은 받았지만 관련 맥락이 비어 있음';
      }
      catch(e){wikiNote='BardWiki 맥락 조회 실패';console.warn('[SD] wiki context',e);}
      try {
        if(typeof api.bardWiki.getDocuments==='function') docs=list(await api.bardWiki.getDocuments({types:['character'],statuses:['active']}));
      } catch(e){console.warn('[SD] wiki character docs',e);}
    }
    const card = {
      name:ch.name,description:ch.desc||ch.description,personality:ch.personality||ch.persona,
      scenario:ch.scenario,firstMessage:ch.firstMessage||ch.first_mes||ch.firstMsg,
      exampleMessage:ch.exampleMessage||ch.mes_example,systemPrompt:ch.systemPrompt,
      note:ch.note||ch.creatorcomment,additionalText:ch.additionalText
    };
    const tail=recentTurns(chat).map(entry=>entry.role+': '+entry.content.slice(-1600)).join('\n');
    // Never relabel BardWiki memory as live chat for a fresh session.
    // BardWiki may contain memories from another session/story.

    const hints=(text(ch.name)+' '+text(query)+' '+tail).toLowerCase();
    const selectedDocs=docs.filter(d=>{const names=[text(d?.title),...list(d?.aliases).map(x=>text(x))];return names.some(n=>n.length>=2 && hints.includes(n.toLowerCase()));}).slice(0,10).map(d=>({title:d.title,aliases:list(d.aliases),content:clip(d.content,1300)}));
    const chId=idOf(ch.chaId||ch.id||(ci>=0?'index'+ci:ch.name)),chatId=idOf(chat?.id||chat?.chatId||ti);
    const key=PREFIX+encodeURIComponent(chId)+':'+encodeURIComponent(chatId);
    const userMessageCount=messages.filter(m=>m?.role==='user'||m?.isUser===true).length;
    return {ci,ti,ch,chat,key,characterId:chId,chatId,identity:`${ch.name||'이름 미상'} / 채팅 ${Number.isInteger(ti)?ti+1:'?'}`,
      card,persona,loreText,wikiText:clip(wiki?.content, LIMITS.wiki),wikiDocs:selectedDocs,wikiNote,personaNote,personaVerified,
      history:tail.length>LIMITS.history?tail.slice(-LIMITS.history):tail,historyCount:messages.length,userMessageCount,
      hasWiki:!!(clip(wiki?.content,300)||selectedDocs.length),
      hasLore:loreText.length>0,hasPersona:!!persona};
  }
  async function save() {
    if(!current||!project) return;
    project.updatedAt=Date.now();
    await api.pluginStorage.setItem(current.key,project);
  }
  function scheduleSave() {
    if(saveTimer) clearTimeout(saveTimer);
    saveTimer=setTimeout(()=>{saveTimer=null;save().catch(e=>setStatus('자동 저장 실패: '+(e?.message||e),true));},650);
  }
  async function flushSave(){if(saveTimer){clearTimeout(saveTimer);saveTimer=null;}await save();}
  function setStatus(s,bad=false){if(ui?.status){ui.status.textContent=s;ui.status.style.color=bad?'#ffa6a2':'#7bdac5';}if(ui?.dock?.status){ui.dock.status.textContent=s;ui.dock.status.style.color=bad?'#ffa6a2':'#7bdac5';}}
  function setBusy(b) {busy=b;if(!ui)return;ui.buttons=ui.buttons.filter(x=>x.isConnected!==false);ui.buttons.forEach(x=>{x.disabled=b;});ui.loading.classList.toggle('sd-hidden',!b);if(ui.dock?.loading)ui.dock.loading.classList.toggle('sd-hidden',!b);}
  async function action(label,fn){if(busy)return;setBusy(true);setStatus(label+' 처리 중…');try{await fn();setStatus(label+' 완료');}catch(e){console.error('[SD] '+label,e);setStatus(label+' 실패: '+(e?.message||e),true);}finally{setBusy(false);}}
  function resultText(r){
    if(typeof r==='string') return r;
    if(r?.success===false) throw new Error(text(r?.error||r?.content||'모델 요청 실패',350));
    for(const k of ['content','result','text','message'])if(typeof r?.[k]==='string')return r[k];
    return text(r,18000);
  }
  function cleanLLM(s){return text(s).replace(/<think>[\s\S]*?<\/think>/gi,'').replace(/<analysis>[\s\S]*?<\/analysis>/gi,'').replace(/<Thoughts>[\s\S]*?<\/Thoughts>/gi,'').trim();}
  // The integrated world editor is separate from the per-chat story plan.
  // Discussions and drafts never modify the actual character until approved.
  const WORLD_ALIASES={desc:['desc','description'],personality:['personality'],scenario:['scenario'],exampleMessage:['exampleMessage','mes_example']};
  function worldCopy(v){return JSON.parse(JSON.stringify(v));}
  function worldRaw(v){if(typeof v==='string'){try{return JSON.parse(v);}catch(_){return null;}}return v;}
  function worldCharacterId(c){return idOf(c?.chaId||c?.id||c?.name||'unknown');}
  function worldStorageKey(){return WORLD_STORE+encodeURIComponent(current.characterId);}
  function worldDefault(){return {notes:'',input:'',dialogue:[],draft:null,playerDraft:null,versions:[],versionName:'',activeVersion:'',summary:'',importedLegacy:false,updatedAt:0};}
  function normalizeWorld(v){
    const raw=worldRaw(v)||{},state=Object.assign(worldDefault(),raw);
    state.notes=clip(state.notes,10000);state.input=clip(state.input,4500);
    state.dialogue=list(state.dialogue).filter(x=>x&&['user','assistant'].includes(x.role)&&typeof x.content==='string').slice(-20);
    state.versions=list(state.versions).filter(x=>x&&x.id&&x.snapshot).slice(0,12);
    state.draft=state.draft&&typeof state.draft==='object'?state.draft:null;
    state.playerDraft=state.playerDraft&&typeof state.playerDraft==='object'?state.playerDraft:null;
    return state;
  }
  async function saveWorld(){
    if(!current||!world)return;
    world.updatedAt=Date.now();
    await api.pluginStorage.setItem(worldStorageKey(),world);
  }
  function scheduleWorldSave(){
    if(worldSaveTimer)clearTimeout(worldSaveTimer);
    worldSaveTimer=setTimeout(()=>{worldSaveTimer=null;saveWorld().catch(e=>setStatus('세계관 자동 저장 실패: '+(e?.message||e),true));},550);
  }
  async function flushWorldSave(){if(worldSaveTimer){clearTimeout(worldSaveTimer);worldSaveTimer=null;}await saveWorld();}
  async function loadWorld(){
    if(worldSaveTimer){clearTimeout(worldSaveTimer);worldSaveTimer=null;}
    let saved=null;
    try{saved=await api.pluginStorage.getItem(worldStorageKey());}catch(e){console.warn('[SD] world storage read',e);}
    if(saved==null){
      // Copy old World Editor Lab planning data once. Never remove or rewrite its original storage.
      const legacyKey=WORLD_OLD_STORE+current.characterId;
      try{
        const old=worldRaw(await api.pluginStorage.getItem(legacyKey));
        if(old&&(old.notes||list(old.dialogue).length||list(old.versions).length)){
          saved={notes:old.notes||'',dialogue:old.dialogue||[],versions:old.versions||[],importedLegacy:true,summary:'기존 World Editor Lab의 논의·버전 기록을 읽어왔어. 기존 파일은 그대로 있어.'};
          world=normalizeWorld(saved);await saveWorld();return;
        }
      }catch(e){console.warn('[SD] optional World Editor Lab import failed',e);}
    }
    world=normalizeWorld(saved);
  }
  function worldFieldKey(c,key){
    const choices=WORLD_ALIASES[key]||[key];
    return choices.find(k=>Object.prototype.hasOwnProperty.call(c,k)&&typeof c[k]==='string')||choices[0];
  }
  function snapshotWorld(c){
    const fields={};
    for(const key of WORLD_FIELDS){const actual=worldFieldKey(c,key);fields[key]={key:actual,value:typeof c[actual]==='string'?c[actual]:''};}
    return {fields,globalLore:worldCopy(list(c.globalLore))};
  }
  function normalizeWorldSnapshot(snap){
    if(snap&&snap.fields&&typeof snap.fields==='object'&&Array.isArray(snap.globalLore))return worldCopy(snap);
    // World Editor Lab v0.1.x stored flat field snapshots. First messages are intentionally excluded.
    const fields={};for(const key of WORLD_FIELDS)fields[key]={key,value:typeof snap?.[key]==='string'?snap[key]:''};
    return {fields,globalLore:worldCopy(list(snap?.globalLore))};
  }
  function fingerprintWorld(snap){
    const raw=JSON.stringify(snap),max=raw.length;let hash=2166136261;
    for(let i=0;i<max;i++)hash=Math.imul(hash^raw.charCodeAt(i),16777619)>>>0;
    return max+':'+hash.toString(16);
  }
  async function worldLive(){
    await verifySession();
    if(!Number.isInteger(current.ci)||current.ci<0)throw new Error('현재 캐릭터 인덱스를 읽을 수 없어. 채팅을 다시 열어줘.');
    const char=await api.getCharacterFromIndex(current.ci);
    if(!char||worldCharacterId(char)!==current.characterId)throw new Error('다른 캐릭터가 선택됐어. 창을 닫고 다시 열어줘.');
    return {ci:current.ci,char};
  }
  async function checkMutationLock(char){
    const id=worldCharacterId(char),prefix='mutation_state_v1';
    let owner=null,meta=null;
    try{owner=worldRaw(await api.pluginStorage.getItem(prefix+'_mode_live_owner_v1_'+id));}catch(_){}
    try{meta=worldRaw(await api.pluginStorage.getItem(prefix+'_direct_char_meta_'+id));}catch(_){}
    if(owner&&owner.mode&&owner.mode!=='original')throw new Error('Mutation State Router의 '+owner.mode+' 모드가 활성화돼 있어. 원작 모드로 복귀한 뒤 적용해 줘.');
    if(meta?.appliedAt&&!meta.invalidatedAt)throw new Error('Mutation State Router의 개변 적용 기록이 있어. 먼저 원작 상태를 확인해 줘.');
  }
  const STORY_GUIDANCE_START='[Story Director 채팅별 플레이어 성향 연출 지침]';
  const STORY_GUIDANCE_END='[/Story Director 채팅별 플레이어 성향 연출 지침]';
  function mergePlayerStoryGuidance(previous,guidance){
    let base=String(previous||'');const start=base.indexOf(STORY_GUIDANCE_START),end=base.indexOf(STORY_GUIDANCE_END);
    if(start>=0&&end>start)base=(base.slice(0,start)+base.slice(end+STORY_GUIDANCE_END.length)).trim();
    return [base,STORY_GUIDANCE_START+'\n'+guidance.trim()+'\n'+STORY_GUIDANCE_END].filter(Boolean).join('\n\n');
  }
  async function applyPlayerStoryDraft(){
    const draft=world.playerDraft;
    if(!draft||!draft.guidance.trim())throw new Error('승인할 주인공 성향 초안이 없어.');
    await verifySession();
    if((project.personaExtra||'')!==draft.before)throw new Error('초안 작성 이후 기존 지침이 수정됐어. 제안서를 다시 만들어 줘.');
    if(!window.confirm('이 채팅에서 사용할 주인공 성향 연출 지침을 승인할까?\n기존 페르소나 카드·NPC 세계관·실제 채팅은 변경하지 않아.'))return;
    const before=project.personaExtra||'';
    project.personaExtra=mergePlayerStoryGuidance(before,draft.guidance);
    if(ui?.personaExtra)ui.personaExtra.value=project.personaExtra;
    project.playerStoryVersions=[...list(project.playerStoryVersions),{id:'player-'+Date.now(),at:now(),before,after:project.personaExtra,summary:draft.summary}].slice(-8);
    world.playerDraft=null;world.summary='승인한 주인공 성향이 이 채팅의 이야기 지침에 반영됐어. 실제 페르소나와 봇 원문은 그대로야.';
    await save();await saveWorld();
  }
  async function undoPlayerStoryGuidance(){
    const history=list(project.playerStoryVersions);const last=history.at(-1);
    if(!last)throw new Error('복원할 이전 주인공 성향 지침이 없어.');
    if(project.personaExtra!==last.after)throw new Error('승인 후 지침을 직접 수정했어. 자동으로 되돌리면 변경사항이 사라질 수 있으니 자료·설정에서 직접 확인해 줘.');
    if(!window.confirm('직전 주인공 성향 지침 적용을 되돌릴까? 봇·페르소나 원문은 수정하지 않아.'))return;
    project.personaExtra=last.before;if(ui?.personaExtra)ui.personaExtra.value=project.personaExtra;project.playerStoryVersions=history.slice(0,-1);world.summary='주인공 성향 지침을 적용 전 상태로 되돌렸어.';
    await save();await saveWorld();
  }
  function makeWorldCharacter(char,origin,changes){
    const next={...char};
    for(const [key,value] of Object.entries(changes.fields)){
      const actual=origin.fields[key]?.key||worldFieldKey(char,key);
      next[actual]=value;
    }
    const lore=worldCopy(list(char.globalLore));
    for(const edit of changes.lore){
      if(edit.index>=0){if(edit.index>=lore.length)throw new Error('로어북 인덱스가 변경됐어.');lore[edit.index]={...lore[edit.index],content:edit.content};}
      else lore.push({id:'story-director-world-'+Date.now()+'-'+lore.length,comment:edit.title||'세계관 추가 설정',key:edit.key||'',content:edit.content,alwaysActive:!edit.key,enabled:true});
    }
    next.globalLore=lore;
    // firstMessage and first_mes deliberately are never assigned here.
    return next;
  }
  async function refreshWorldSources(){
    const next=await readSources(project.goal,true);
    if(next.key!==current.key)throw new Error('캐릭터/채팅이 바뀌었어. 다시 열어줘.');
    current=next;
    project.worldNeedsReview=!!(project.canon||project.plan||project.pendingCanon||project.pendingPlan);
    await save();
    renderSources();renderPlanDraft();renderWorldPanel();
  }
  async function applyWorldDraft(){
    if(!world.draft)throw new Error('적용할 세계관 수정안이 없어.');
    const {ci,char}=await worldLive();await checkMutationLock(char);
    const before=snapshotWorld(char),draft=world.draft;
    if(fingerprintWorld(before)!==draft.digest)throw new Error('수정안 생성 뒤 봇 설정이 변경됐어. 변경안을 다시 생성해 줘.');
    const name=clip(world.versionName,100)||'새 세계관';
    const changes=Object.keys(draft.fields).length+draft.lore.length;
    if(!window.confirm(name+' · '+changes+'개 변경을 캐릭터 카드/로어북에 실제 적용할까?\n적용 전 상태는 자동 백업하고 첫 메시지 및 채팅은 유지해.'))return;
    const next=makeWorldCharacter(char,before,draft);
    const ts=Date.now(),oldVersions=world.versions;
    world.versions=[{id:'world-'+ts,name,createdAt:now(),summary:draft.summary,snapshot:snapshotWorld(next)},
      {id:'backup-'+ts,name:'변경 전 백업',createdAt:now(),snapshot:before},...world.versions].slice(0,12);
    await saveWorld();
    try{
      const live=await worldLive();await checkMutationLock(live.char);
      if(live.ci!==ci||fingerprintWorld(snapshotWorld(live.char))!==draft.digest)throw new Error('적용 직전에 다른 곳에서 원본을 변경했어. 변경안을 다시 생성해 줘.');
      await api.setCharacterToIndex(ci,makeWorldCharacter(live.char,before,draft));
    }catch(e){world.versions=oldVersions;await saveWorld();throw e;}
    world.draft=null;world.activeVersion='world-'+ts;
    world.summary='승인한 세계관 변경을 적용했어. 적용 직전 상태도 백업했어.';
    await saveWorld();await refreshWorldSources();
  }
  async function restoreWorldVersion(id){
    const version=world.versions.find(x=>x.id===id);
    if(!version)throw new Error('복원할 세계관 버전을 선택해 줘.');
    const {ci,char}=await worldLive();await checkMutationLock(char);
    if(!window.confirm('세계관을 「'+version.name+'」 상태로 복원할까?\n복원 전 현재 상태도 백업하고 첫 메시지와 실제 채팅은 건드리지 않아.'))return;
    const origin=snapshotWorld(char),target=normalizeWorldSnapshot(version.snapshot),old=world.versions,ts=Date.now();
    world.versions=[{id:'backup-restore-'+ts,name:'복원 전 백업',createdAt:now(),snapshot:origin},...world.versions].slice(0,12);
    await saveWorld();
    try{
      const fresh=await worldLive();await checkMutationLock(fresh.char);
      if(fresh.ci!==ci||fingerprintWorld(snapshotWorld(fresh.char))!==fingerprintWorld(origin))throw new Error('복원 직전에 원본이 변경됐어. 다시 시도해 줘.');
      const restored={...fresh.char,globalLore:worldCopy(target.globalLore)};
      for(const key of WORLD_FIELDS){
        const loc=worldFieldKey(fresh.char,key);
        if(target.fields[key]&&typeof target.fields[key].value==='string')restored[loc]=target.fields[key].value;
      }
      await api.setCharacterToIndex(ci,restored);
    }catch(e){world.versions=old;await saveWorld();throw e;}
    world.activeVersion=id;world.draft=null;world.summary='「'+version.name+'」 버전으로 복원했어.';
    await saveWorld();await refreshWorldSources();
  }


  // Distinguish author-level fiction premises from NPC decisions. A new effect
  // may be specified for the NEXT scene without already existing in the bot
  // card or the real chat history. It is not automatically applied to the
  // character card, lorebook or past chat, and does not declare NPC consent.
  function isDurableAuthorRule(input){
    const s=String(input||'');
    const anchor=/(?:시크릿\s*상점|그림자\s*상점|시스템(?:의|이|에|은)|의상\s*고정|고정\s*버튼|최면|강제\s*암시|상식\s*개변|설정(?:은|이|으로|을|에)|세계관\s*규칙|규칙(?:은|을|으로)|새로\s*추가)/i.test(s);
    const persistence=/(?:계속|이제부터|고정|강제로|버튼|숨은|레이어|암시|효과|항상|모르|진행|입게|적용|이용|그대로)/.test(s);
    return anchor&&persistence;
  }

  // A non-negotiable boundary applies to an NPC's VOLUNTARY choice, not
  // author-declared operation of a fictional system or already specified scene.
  // A non-negotiable boundary is a source-backed character constraint, not an
  // improvised rejection merely to add friction. A source quote is checked against
  // the live character card, approved canon, or approved per-chat boundary notes.
  // Audit optimistic judgements only if the approved/card canon mentions a
  // non-negotiable principle. Other proposals keep the standard two-pass cost.
  // In normal use the GM judges independently BEFORE the writer sees the desired outcome.
  // This extra LLM call costs tokens but prevents the writer from grading its own plan.
  // A conversational question is not an authorization to write a scene.
  // Explicit drafting requests override this conservative question routing.
  // A single unambiguous contract for autonomous general-story drafting.
  // Keep the source context, but never mix an advisory-only schema with drafting.
  // Independent review: valid directive syntax alone does not prove narrative progress.
  // Auto drafts must be explicit structured instructions, never a refusal
  // or an arbitrary response substituted as executable direction.
  async function regenerateLastInstruction(){
    if(!project.last?.request)throw new Error('다시 작성할 원래 요청이 없어.');
    await writeCurrentInstruction(project.last.request);
    renderDirectorOutputs();
  }
  function renderDirectorOutputs(){
    renderResult();renderHistory();renderSources();renderLogs();renderDockHistory();renderDockResult();
  }
  async function verifySession(){
    const ci=await api.getCurrentCharacterIndex(),ti=await api.getCurrentChatIndex();
    if(ci!==current.ci||ti!==current.ti)throw new Error('다른 봇/채팅으로 전환됐어. 먼저 상단의 새로고침을 눌러줘.');
  }
  async function prepareManualPlan(input){
    const draft=clip(input,4500);
    if(!draft)throw new Error('장기 계획 초안을 먼저 적어 줘.');
    if(project.pendingPlan&&project.pendingPlan!==draft&&!window.confirm('검토 중인 계획 초안을 바꿀까?'))return;
    project.pendingPlan=draft;project.planReply='직접 입력한 장기 계획 초안';
    await save();renderPlanDraft();refreshOnboarding();
    ui.planDraft?.scrollIntoView?.({block:"nearest"});
  }
  function refreshOnboarding() {
    if (!ui?.onboard || !project) return;
     const pending = !!(project.pendingPlan || project.pendingCanon || project.pendingHardLimits);
    const fresh = !project.canon && !project.plan;
    ui.onboard.classList.toggle('sd-hidden',!fresh&&!pending);
    if (!fresh&&!pending) return;
    ui.onboardTitle.textContent=pending?'계획 초안 검토':'이야기 설계';
    ui.onboardDesc.textContent=pending?'초안 내용을 확인하고 확정해.':'장기 계획을 직접 적거나 현재 설정을 확인해.';
    ui.onboardButton.textContent=pending?'아래 설계안 검토하기':'계획 입력으로 이동';
    ui.onboardButton.onclick=()=>{if(pending)ui.planDraft?.scrollIntoView?.({block:'nearest'});else ui.planComposer?.focus();};
    ui.onboardHelp.textContent='확정한 계획은 다음 지시문 작성에 참고해.';
  }

  function renderPlanDraft() {
    if (!ui?.planDraft || !project) return;
    const parent=ui.planDraft;parent.replaceChildren();
     const hasDraft=!!(project.pendingCanon||project.pendingPlan||project.pendingHardLimits);
    parent.classList.toggle('sd-hidden',!hasDraft);
    if (!hasDraft)return;
    el('h2',parent,{class:'sd-title'},'이야기 설정과 계획 · 확정 전');
    if(project.planReply)el('div',parent,{class:'sd-response'},project.planReply);
    el('p',parent,{class:'sd-muted'},'이야기 설정과 계획 초안이야. 확정 전에 내용을 확인해.');
    if (project.pendingCanon) {
      label(parent,'인물별 판정 기준 / 거절 이유 · 타협 조건');
      const t=makeTextarea(parent,12,'판정 기준 초안');t.value=project.pendingCanon;
      t.addEventListener('input',()=>{project.pendingCanon=t.value;scheduleSave();});
    }
     if(project.pendingHardLimits){
       label(parent,'설정 원문으로 확인된 절대 금기 · 승인 전 검토');
       const t=makeTextarea(parent,5,'실제 설정에 명시된 절대 금기만 남겨줘.');t.value=project.pendingHardLimits;
       t.addEventListener('input',()=>{project.pendingHardLimits=t.value;scheduleSave();});
       el('div',parent,{class:'sd-texthint'},'이 항목이 확정되면 단순한 설득으로 금기를 깨지 않도록 판정해. 추측은 절대 금기로 확정하지 마.');
     }
     if (project.pendingPlan) {
       label(parent,'장기 이야기 구성 / 시작 방향 · 사건 · 분기');
      const t=makeTextarea(parent,14,'이야기 계획 초안');t.value=project.pendingPlan;
      t.addEventListener('input',()=>{project.pendingPlan=t.value;scheduleSave();});
    }
    const row=el('div',parent,{class:'sd-actions'});
    btn(row,'④ 이 설계안으로 확정',()=>action('계획 확정',async()=>{
       if(project.pendingCanon) project.canon=project.pendingCanon;
       if(project.pendingHardLimits)project.hardLimits=project.pendingHardLimits;
       if(project.pendingPlan) project.plan=project.pendingPlan;
       project.pendingCanon=null;project.pendingPlan=null;project.pendingHardLimits=null;
      project.worldNeedsReview=false;await save();setProjectFields();renderPlanDraft();renderResult();renderSources();refreshOnboarding();
      setStatus('설계가 확정됐어. 이제 디렉터 탭에서 첫 장면이나 다음 행동을 상담할 수 있어.');
    }),'sd-btn sd-primary');
    btn(row,'초안 버리기',()=>action('초안 폐기',async()=>{
      project.pendingPlan=null;project.pendingCanon=null;await save();renderPlanDraft();renderResult();refreshOnboarding();
    }),'sd-btn sd-soft');
  }

  function sourceBlock(parent,title,status,excerpt,full,uncertain=false,iconType="logs") {
    const wrap=el('section',parent,{class:'sd-source-card'});
    const bar=el('div',wrap,{class:'sd-source-top'});
    const name=el('span',bar,{class:'sd-source-title'});iconLabel(name,iconType,title);
    el('span',bar,{class:'sd-source-status'+(uncertain?' sd-unknown':'')},status);
    el('div',wrap,{class:'sd-source-excerpt'},excerpt||'(현재 읽어 온 내용 없음)');
    if(full && full.length>excerpt.length){
      const d=el('details',wrap,{class:'sd-source-details'});
      el('summary',d,{},'읽어 온 원문 펼치기');el('pre',d,{class:'sd-source-full'},full);
    }
    return wrap;
  }
  function sourceSnippet(s,max=240) {const val=clip(s,30000);return val.length>max?val.slice(0,max)+' …':val;}
  function renderStorySources(){
    if(!ui?.storySources||!current)return;
    const c=current,root=ui.storySources;root.replaceChildren();
    const grid=el('div',root,{class:'sd-source-grid'});
    const card=c.card||{};
    const cardPreview=[card.personality?'성격: '+sourceSnippet(card.personality,220):'',
      card.description?'설명: '+sourceSnippet(card.description,200):'',
      card.scenario?'상황: '+sourceSnippet(card.scenario,150):''].filter(Boolean).join('\n');
    const cardFull=[['설명',card.description],['성격',card.personality],['상황',card.scenario],['참고',card.note],['추가',card.additionalText]]
      .filter(([,v])=>!!v).map(([k,v])=>`[${k}]\n${v}`).join('\n\n');
    sourceBlock(grid,'봇 · '+(card.name||'이름 미상'),'자동 조회됨',cardPreview||'이름만 확인됐어. 상세 설정은 카드에 없을 수 있어.',cardFull,false,'director');
    sourceBlock(grid,'첫 메시지',card.firstMessage?'자동 조회됨':'원문 미확인',
      sourceSnippet(card.firstMessage,350)||'첫 메시지를 카드에서 찾지 못했어. 실제 채팅의 첫 메시지를 확인해 줘.',card.firstMessage||'',!card.firstMessage,'pen');
    const pp=c.persona?.personaPrompt||'';
    sourceBlock(grid,'사용자 페르소나',c.personaVerified?'선택 확인됨':c.hasPersona?'선택 미검증':'자동 조회 불가',
      c.persona ? (c.persona.name+'\n'+sourceSnippet(pp,320)+'\n'+c.personaNote):
      '선택한 페르소나를 자동 확인하지 못했어. [자료·설정]에서 필요한 경우에만 보충해.',
      pp||c.personaNote,!c.personaVerified,'scales');
    const loreFull=c.loreText.map((x,i)=>`${i+1}. ${x.title||'제목 없음'}\n${x.content}`).join('\n\n');
    const lorePreview=c.loreText.length?
      c.loreText.slice(0,4).map((x,i)=>`• ${x.title||'항목 '+(i+1)}: ${sourceSnippet(x.content,125)}`).join('\n'):
      '현재 로어북 원자료가 반환되지 않았어.';
    sourceBlock(grid,'로어북',c.loreText.length?`${c.loreText.length}개 조회됨`:'자료 없음',lorePreview,loreFull,!c.loreText.length,'logs');
    const wikiPreview=c.wikiText?sourceSnippet(c.wikiText,340):
      c.wikiDocs.length?c.wikiDocs.map(x=>x.title).join(', '):'관련 BardWiki 맥락이 비어 있거나 접근이 불가능해.';
    const wikiFull=[c.wikiText,...c.wikiDocs.map(x=>`[${x.title}]\n${x.content}`)].filter(Boolean).join('\n\n');
    sourceBlock(grid,'BardWiki',c.hasWiki?'관련 맥락 조회됨':'미확인',wikiPreview,wikiFull,!c.hasWiki,'world');
    const progress=c.userMessageCount===0?'플레이 전 · 사용자 메시지 없음':`${c.historyCount}개 메시지 조회됨`;
    sourceBlock(grid,'실제 채팅',c.userMessageCount===0?'새 이야기 시작 전':'진행 중',
      progress+'\n'+(c.userMessageCount?sourceSnippet(c.history,320):'이전 BardWiki 사건을 현재 채팅에서 발생한 일로 간주하지 않아.'),
      c.history||'',false,'director');
    const notes=[];
    if(!c.personaVerified) notes.push('페르소나의 실제 선택 여부는 자동으로 확인되지 않았어. 아래 설정 자료를 검토하거나 필요하면 보충해.');
    if(!c.hasWiki) notes.push('BardWiki가 없거나 관련 결과가 비어 있어. 로어북과 캐릭터 카드를 기준으로 설계할 수 있어.');
    if(notes.length)el('div',root,{class:'sd-note sd-source-warning'},notes.join(' '));
    el('div',root,{class:'sd-texthint'},'위 내용은 AI가 만들어 낸 요약이 아니라 RisuBard에서 실제 읽어 온 설정의 일부야. 더 보려면 각 카드의 원문을 펼쳐봐.');
  }
  function visible(tab){
    if(!ui)return;Object.entries(ui.tabs).forEach(([k,n])=>n.setAttribute('aria-selected',String(k===tab)));
    Object.entries(ui.views).forEach(([k,v])=>v.classList.toggle('sd-hidden',k!==tab));
    ui.activeTab=tab;
    if(project&&project.activeTab!==tab){project.activeTab=tab;scheduleSave();}
  }
  function info(parent,title,value){const row=el('div',parent,{class:'sd-stat'});el('span',row,{},title);el('b',row,{},value);}
  function label(parent,str){return el('label',parent,{class:'sd-label'},str);}
  function btn(parent,name,cb,cls='sd-btn') {const b=el('button',parent,{type:'button',class:cls},name);b.onclick=cb;ui.buttons.push(b);return b;}
  function makeTextarea(parent,rows,placeholder){return el('textarea',parent,{class:'sd-field',rows,placeholder});}
  function syncFields(){
    if(!ui||!project)return;
    project.goal=ui.goal.value;project.rules=ui.rules.value;
    project.personaExtra=ui.personaExtra.value;project.wikiExtra=ui.wikiExtra.value;
     project.canon=ui.canon.value;project.hardLimits=ui.hardLimits.value;project.plan=ui.plan.value;
    project.model=ui.model.value;project.contextDepth=ui.contextDepth.value;project.pacing=ui.pacing.value;
    project.input=ui.composer.value;project.directorInput=ui.composer.value;
  }
  function setProjectFields(){
    updateGuardToggleLabels();
    ui.goal.value=project.goal||'';ui.rules.value=project.rules||'';ui.personaExtra.value=project.personaExtra||'';
     ui.wikiExtra.value=project.wikiExtra||'';ui.canon.value=project.canon||'';ui.hardLimits.value=project.hardLimits||'';ui.plan.value=project.plan||'';
    ui.model.value=project.model;ui.pacing.value=project.pacing;ui.contextDepth.value=project.contextDepth;
    ui.composer.value=project.directorInput||'';if(ui.goalMirror)ui.goalMirror.value=project.goal||'';if(ui.onboard)refreshOnboarding();
  }
  function renderFlowHistory(){
    if(!ui?.flowHistory||!project)return;
    const root=ui.flowHistory;root.replaceChildren();
    const conversations=list(project.flowTalks).slice(-14);
    if(!conversations.length){
      el('div',root,{class:'sd-empty'},'원하는 결말이나 관계 방향을 편하게 말해줘. 확정된 목표는 자동으로 바꾸지 않아.');return;
    }
    for(const t of conversations){
      el('div',root,{class:'sd-bubble sd-user'},clip(t.user||'',2200));
      el('div',root,{class:'sd-bubble sd-ai'},clip(t.reply||'',4200));
    }
    root.scrollTop=root.scrollHeight;
  }
  function renderFlowProposal(){
    if(!ui?.flowProposal||!project)return;
    const root=ui.flowProposal;root.replaceChildren();
    if(!project.flowSuggestedGoal?.trim())return;
    const panel=el('div',root,{class:'sd-panel'});
    el('div',panel,{class:'sd-title'},'AI가 정리한 전체 방향 · 승인 전');
    el('p',panel,{class:'sd-muted'},'AI가 제안한 내용이야. 기존 확정 목표를 덮어쓰기 전에 직접 확인해.');
    const draft=makeTextarea(panel,6,'전체 방향 제안');
    draft.value=project.flowSuggestedGoal;
    draft.addEventListener('input',()=>{project.flowSuggestedGoal=draft.value;scheduleSave();});
    const buttons=el('div',panel,{class:'sd-actions'});
    btn(buttons,'이 방향으로 확정',()=>action('전체 방향 확정',async()=>{
      project.goal=clip(draft.value,4500);
      project.flowSuggestedGoal='';
      if(ui.goal)ui.goal.value=project.goal;
      if(ui.goalMirror)ui.goalMirror.value=project.goal;
      await flushSave();renderFlowProposal();
    }),'sd-btn sd-primary');
    btn(buttons,'제안 버리기',()=>action('제안 취소',async()=>{
      project.flowSuggestedGoal='';await flushSave();renderFlowProposal();
    }),'sd-btn sd-soft');
  }
  function renderHistory(){
    const p=ui.history;p.replaceChildren();
    if(!project.talks.length){el('div',p,{class:'sd-empty'},'아직 디렉터와 대화한 기록이 없어. 원하는 전개를 한 줄 입력해봐.');return;}
    project.talks.slice(-8).forEach(t=>{
      const a=el('div',p,{class:'sd-bubble sd-user'});el('div',a,{class:'sd-mini'},'내 요청 · '+(t.mode||'자동'));el('div',a,{},t.user);
      const b=el('div',p,{class:'sd-bubble sd-ai'});el('div',b,{class:'sd-mini'},'Story Director'+(t.verdict && t.verdict!=='판정 불필요'?' · '+(t.mode==='check'?'가정상 ':'')+t.verdict:''));el('div',b,{},t.reply);
    });
    p.scrollTop=p.scrollHeight;
    renderFlowHistory();
  }
  function renderResult(){
    const root=ui.result;root.replaceChildren();ui.instruction=null;
    ui.resultTitle.textContent='다음 장면 연출 지시문';
    ui.turnContext=el('div',root);
    renderTurnContext(ui.turnContext);
    ui.instruction=renderDraft(root);
  }
  function renderDraft(root){
    const r=project.last;
    const storedResult=r?.instruction||r?.editedText||'';
    const draft=project.dockDraft||storedResult;
    const resultMatches=draft===storedResult;
    if(!draft){
      el('div',root,{class:'sd-empty'},'원하는 전개를 입력하고 지시문 작성을 눌러 줘.');
      return null;
    }
    if(!resultMatches||!r?.turnStamp)el('p',root,{class:'sd-texthint'},'저장된 초안이야. 최신 대화를 반영하려면 다시 작성해 줘.');
    const area=makeTextarea(root,6,'다음 장면에 사용할 지시문');area.value=draft;
    area.addEventListener('input',()=>{
      project.dockDraft=area.value;
      if(resultMatches&&r?.instruction!=null)r.instruction=area.value;
      else if(resultMatches&&r?.editedText!=null)r.editedText=area.value;
      for(const mirror of [ui.instruction,ui.dock?.instruction])if(mirror&&mirror!==area)mirror.value=area.value;
      scheduleSave();
    });
    const row=el('div',root,{class:'sd-actions'});
    btn(row,'지시문 복사',()=>action('복사',()=>copyText(area.value)),'sd-btn sd-primary');
    btn(row,'이대로 채팅에 보내기',()=>action('전송',async()=>{if(await sendDraft(area.value))await api.hideContainer();}),'sd-btn');
    if(resultMatches&&r?.request)btn(row,'최신 턴으로 다시 작성',()=>action('지시문 재작성',regenerateLastInstruction),'sd-btn sd-soft');
    return area;
  }
  async function copyText(s){
    if(!s.trim())throw new Error('복사할 지시문이 없어.');
    try{if(navigator.clipboard?.writeText){await navigator.clipboard.writeText(s);return;}}catch(e){console.warn('[SD] clipboard fallback',e);}
    const t=el('textarea',document.body,{style:'position:fixed;left:-9999px;top:0'});t.value=s;t.select();const ok=typeof document.execCommand==='function' && document.execCommand('copy');t.remove();
    if(!ok)throw new Error('자동 복사가 제한돼. 위 지시문을 길게 눌러 직접 복사해줘.');
  }
  async function sendDraft(value){
    const instruction=value.trim();if(!instruction)throw new Error('보낼 지시문이 없어.');
    const before=await readLiveTurn();
    const stamp=project.last?.turnStamp;
    const warning=stamp&&stamp!==before.stamp?'현재 턴과 다른 시점에 작성된 초안이야. 이대로 보낼까?':'이 지시문을 현재 채팅에 보내고 답변을 생성할까?';
    if(!window.confirm(warning))return false;
    await flushSave();
    if(typeof api.requestPluginPermission==='function'&&!(await api.requestPluginPermission('sendChat')))return false;
    const live=await readLiveTurn();
    if(live.stamp!==before.stamp)throw new Error('전송 전에 대화가 바뀌었어. 초안을 다시 확인해 줘.');
    if(await api.sendChat(instruction)===false)return false;
    project.applied=[...project.applied,{at:now(),text:clip(instruction,8000)}].slice(-30);
    await save();return true;
  }
  async function reload(){
    if(saveTimer){clearTimeout(saveTimer);saveTimer=null;}if(current && project)await save();
    await flushWorldSave();
    current=await readSources();
    project=normState(await api.pluginStorage.getItem(current.key));
    project.chatGuardEnabled=guardKeys.has(current.key);
    await loadWorld();
    setProjectFields();renderHistory();renderResult();renderSources();renderPlanDraft();refreshOnboarding();
  }
  function renderSources(){
    if(!ui||!current)return;
    ui.identity.textContent=current.identity;
    ui.sourceStats.replaceChildren();
    info(ui.sourceStats,'봇 카드','연결됨');info(ui.sourceStats,'페르소나',current.personaVerified?((current.persona?.name||'이름 없음')+' · '+current.personaNote):current.hasPersona?((current.persona?.name||'후보')+' · 선택 미검증'):'선택 확인 불가');
    info(ui.sourceStats,'로어북',current.loreText.length+'개 원자료');
    info(ui.sourceStats,'BardWiki',sourceLabel(current.hasWiki));
    info(ui.sourceStats,'실제 채팅',current.historyCount+'개 메시지');
     info(ui.sourceStats,'확정 절대 금기',project.hardLimits?'기록됨':'기록 없음');
     info(ui.sourceStats,'설정 설계',project.canon?'확정됨':'미확정');
    info(ui.sourceStats,'전개 계획',project.plan?'확정됨':'미확정');
    info(ui.sourceStats,'세계관 편집',world?.draft?'변경안 검토 중':world?.activeVersion?'최근 적용/복원됨':'선택 사항');
    ui.sourceDesc.textContent=`페르소나: ${current.persona?.name||'확인 불가'} (${current.personaNote}) · ${current.wikiNote}. 캐릭터/로어북 원자료와 BardWiki의 활성 맥락은 서로 다른 출처로 취급해.`;
    renderStorySources();
    ui.sourceRaw.value=`[현재 캐릭터]\n${JSON.stringify(current.card,null,2)}\n\n[페르소나 자동 조회 · ${current.personaNote}]\n${JSON.stringify(current.persona||null,null,2)}\n\n[로어북]\n${JSON.stringify(current.loreText,null,2)}\n\n[BardWiki 맥락]\n${current.wikiText||'(없음)'}\n\n[BardWiki 관련 캐릭터 문서]\n${JSON.stringify(current.wikiDocs,null,2)}\n\n[최근 실제 채팅]\n${current.history||'(없음)'}`;
  }
  // Pure token diff; DOM rendering uses textContent, never untrusted innerHTML.
  function changeTokens(value){return String(value||'').match(/\s+|[^\s]+/gu)||[];}
  function fieldTokenChanges(before,after){
    const a=changeTokens(before),b=changeTokens(after),n=a.length,m=b.length;
    let rows=[];
    if(n*m<=640000){
      const w=m+1,table=new Uint16Array((n+1)*w);
      for(let i=n-1;i>=0;i--)for(let j=m-1;j>=0;j--){
        table[i*w+j]=a[i]===b[j]?1+table[(i+1)*w+j]:Math.max(table[(i+1)*w+j],table[i*w+j+1]);
      }
      let i=0,j=0;
      while(i<n&&j<m){if(a[i]===b[j]){rows.push({kind:'same',text:a[i++]});j++;}
        else if(table[(i+1)*w+j]>=table[i*w+j+1])rows.push({kind:'remove',text:a[i++]});
        else rows.push({kind:'add',text:b[j++]});}
      while(i<n)rows.push({kind:'remove',text:a[i++]});
      while(j<m)rows.push({kind:'add',text:b[j++]});
    }else{
      let i=0,j=0;while(i<n&&i<m&&a[i]===b[i]){rows.push({kind:'same',text:a[i]});i++;}
      while(j<n-i&&j<m-i&&a[n-1-j]===b[m-1-j])j++;
      for(let k=i;k<n-j;k++)rows.push({kind:'remove',text:a[k]});
      for(let k=i;k<m-j;k++)rows.push({kind:'add',text:b[k]});
      for(let k=n-j;k<n;k++)rows.push({kind:'same',text:a[k]});
    }
    const words=kind=>rows.filter(x=>x.kind===kind&&!/^\s+$/.test(x.text)).length;
    const added=words('add'),removed=words('remove'),total=changeTokens(before).filter(x=>!/^\s+$/.test(x)).length;
    // Character-level difference ratio; helps identify accidental rewrites.
    const extensive=total>12&&removed/total>=0.38;
    return {rows,added,removed,total,extensive};
  }
  function renderChangeTokens(container,changes,onlyChanged){
    container.replaceChildren();
    const rows=changes.rows,max=onlyChanged?1900:22000;let count=0,skipping=false;
    for(let i=0;i<rows.length&&count<max;i++){
      const item=rows[i];
      const show=!onlyChanged||item.kind!=='same'||rows.slice(Math.max(0,i-7),Math.min(rows.length,i+8)).some(x=>x.kind!=='same');
      if(!show){if(!skipping){el('span',container,{class:'sd-diff-gap'},' … ');skipping=true;}continue;}
      skipping=false;const cls=item.kind==='add'?'sd-diff-added':item.kind==='remove'?'sd-diff-removed':'sd-diff-equal';
      el('span',container,{class:cls},item.text);count+=item.text.length;
    }
    if(count>=max)el('span',container,{class:'sd-diff-gap'},' … (더 보려면 전체 원문 비교를 펼쳐줘)');
  }
  function worldDiffLabel(key){return ({desc:'캐릭터 설명',personality:'성격',scenario:'시나리오',exampleMessage:'예시 대화'})[key]||key;}
  // 'Story Director' and 'Story Planning' have independent input state.
  // The classifier can choose tasks INSIDE Planning, never the top-level tab.

  function syncPlanInput(value){
    const raw=String(value||'').slice(0,4500);
    project.planInput=raw;
    if(project.pendingRoute&&project.pendingRoute.input!==raw.trim())project.pendingRoute=null;
    if(ui?.planComposer&&ui.planComposer.value!==raw)ui.planComposer.value=raw;
    scheduleSave();
  }
  function syncDirectorInput(value){
    const raw=String(value||'').slice(0,4500);
    project.directorInput=raw;project.input=raw;
    if(ui?.composer&&ui.composer.value!==raw)ui.composer.value=raw;
    if(ui?.dock?.composer&&ui.dock.composer.value!==raw)ui.dock.composer.value=raw;
    scheduleSave();
  }


  function addPlanComposer(parent){
    const root=el('div',parent,{class:'sd-panel sd-unified-comp'});
    el('div',root,{class:'sd-title'},'전체 흐름 · 장기 계획 초안');
    const entry=makeTextarea(root,4,'이야기의 목표, 관계 변화, 주요 사건을 입력해 줘.');
    entry.value=project.planInput||'';ui.planComposer=entry;
    entry.addEventListener('input',()=>syncPlanInput(entry.value));
    btn(root,'계획 초안으로 저장',()=>action('계획 초안 저장',()=>prepareManualPlan(entry.value)),'sd-btn sd-primary');
    return root;
  }
  function resetDirectorConversationState(state){
    return {...state,talks:[],last:null,dockDraft:'',directorInput:'',input:'',review:'',authorDirectives:[],authorRulesMigrated:true};
  }
  async function resetDirectorConversation(){
    await verifySession();
    if(!window.confirm('현재 채팅의 스토리 디렉터 상담 기록, 입력문, 미전송 지시문 및 상담에서 자동 기억한 장면 규칙을 초기화할까? 실제 RP 채팅, 세계관, 장기 계획, 확정 규칙, 전송 기록 및 플러그인 설정은 보존돼.'))return;
    if(layoutMode==='full')syncFields();
    await flushSave();
    const previous=project;
    project=resetDirectorConversationState(project);
    try{await save();}catch(error){project=previous;throw error;}
    if(ui?.composer)ui.composer.value='';
    if(ui?.dock?.composer)ui.dock.composer.value='';
    if(ui?.history)renderHistory();
    if(ui?.result)renderResult();
    renderDockHistory();renderDockResult();renderSources();renderLogs();
  }
  function addDirectorComposer(parent){
    const root=el('div',parent,{class:'sd-panel sd-unified-comp'});
    el('div',root,{class:'sd-title'},'지금 지시');
    const entry=makeTextarea(root,4,'이번 장면에서 원하는 전개를 적어 줘.');
    entry.value=project.directorInput||'';ui.composer=entry;
    entry.addEventListener('input',()=>syncDirectorInput(entry.value));
    entry.addEventListener('keydown',event=>{if(event.key==='Enter'&&(event.ctrlKey||event.metaKey)){event.preventDefault();void submitDirector();}});
    const actions=el('div',root,{class:'sd-row sd-director-buttons'});
    btn(actions,'지시문 작성',()=>void submitDirector(),'sd-btn sd-primary');
    btn(actions,'문장 정리',()=>void submitDirector({polish:true}),'sd-btn');
    return root;
  }
  function renderManualWorldEditor(parent){
    const panel=el('details',parent,{class:'sd-details'});
    el('summary',panel,{},'캐릭터 카드·로어북 직접 편집');
    const snapshot=snapshotWorld(current.ch);
    const select=el('select',panel,{class:'sd-field','aria-label':'수정할 설정 선택'});
    for(const field of WORLD_FIELDS)el('option',select,{value:field},worldDiffLabel(field));
    snapshot.globalLore.forEach((entry,index)=>el('option',select,{value:'lore:'+index},'로어북 · '+(entry.comment||entry.name||index+1)));
    el('option',select,{value:'lore:-1'},'새 로어북 항목');
    const title=el('input',panel,{class:'sd-field',placeholder:'새 로어북 제목','aria-label':'새 로어북 제목'});
    const key=el('input',panel,{class:'sd-field',placeholder:'활성 키워드 (선택)','aria-label':'활성 키워드'});
    const edit=makeTextarea(panel,6,'수정할 전체 내용을 적어 줘.');
    function showSelectedValue(){
      const index=Number(select.value.split(':')[1]);
      edit.value=snapshot.fields[select.value]?.value??snapshot.globalLore[index]?.content??'';
      title.hidden=key.hidden=index!==-1;
    }
    select.addEventListener('change',showSelectedValue);
    showSelectedValue();
    btn(panel,'수정안 미리보기',()=>action('세계관 수정안',async()=>{
      const {char}=await worldLive();
      const origin=snapshotWorld(char);
      const digest=fingerprintWorld(origin);
      if(digest!==fingerprintWorld(snapshot))throw new Error('원본 설정이 바뀌었어. 자료를 새로 읽어 줘.');
      if(!edit.value.trim())throw new Error('반영할 설정을 입력해 줘.');
      const field=select.value,index=Number(field.split(':')[1]);
      const old=origin.fields[field]?.value??origin.globalLore[index]?.content??'';
      if(old===edit.value)throw new Error('변경된 내용이 없어.');
      if(world.draft&&!window.confirm('검토 중인 세계관 수정안을 바꿀까?'))return;
      const fields=WORLD_FIELDS.includes(field)?{[field]:edit.value}:{};
      const lore=Number.isInteger(index)?[{index,title:clip(index===-1?title.value:origin.globalLore[index]?.comment,100),key:clip(key.value,180),content:edit.value}]:[];
      world.draft={summary:'직접 입력한 세계관 수정안',fields,lore,warnings:[],digest,createdAt:now()};
      world.versionName='세계관 변경 '+new Date().toLocaleDateString('ko-KR');
      await flushWorldSave();ui.worldExpanded=true;renderWorldPanel();
    }),'sd-btn sd-primary');
  }
  function renderWorldPanel(){
    if(!ui?.worldRoot||!world)return;
    const root=ui.worldRoot;root.replaceChildren();
    const panel=el('details',root,{class:'sd-panel sd-world-panel'});
    panel.open=ui.worldExpanded!==false;
    panel.addEventListener('toggle',()=>{if(ui&&panel.isConnected)ui.worldExpanded=panel.open;});
    const head=el('summary',panel);
    const heading=el('span',head,{class:'sd-world-title'});
    vectorIcon('world',heading);
    el('span',heading,{},'② 세계관 편집실');
    el('span',heading,{class:'sd-soft-tag'},'World Editor Lab 기능 통합');
    const content=el('div',panel,{class:'sd-world-main'});
    el('p',content,{class:'sd-muted'},'플레이어의 성향은 채팅별 연출 지침으로, 동아리 NPC 설정 변경은 별도 봇 수정안으로 다뤄. 두 대상은 섞지 않아. AI와 상의만 할 때는 원본이 바뀌지 않아.');
    el('div',content,{class:'sd-note'},'현재 플레이어 페르소나: '+(current.persona?.name||'선택 확인 필요')+' · '+current.personaNote+' / 세계관 봇: '+(current.card?.name||'이름 미상')+' (플레이어와 다른 대상)');
    el('div',content,{class:'sd-note sd-world-warning'},'플레이어 성향 지침은 이 채팅에만 승인 반영하며 실제 페르소나 카드 원문은 수정하지 않아. 봇 수정안은 별도 승인 필요. 첫 메시지·초기 선택지·외부 모듈·실제 채팅은 수정하지 않아.');
    if(world.summary)el('div',content,{class:'sd-note sd-world-ok'},world.summary);
    if(project.worldNeedsReview)el('div',content,{class:'sd-note sd-world-warning'},'캐릭터의 실제 세계관이 수정됐어. 기존에 확정한 인물 판정 기준과 장기 계획이 새 설정과 충돌하지 않는지 확인하고 AI 설계안을 갱신해 줘.');
    if(world.importedLegacy)el('p',content,{class:'sd-texthint'},'기존 World Editor Lab의 저장된 논의·버전 기록을 복사해 왔어. 기존 플러그인 저장값은 유지돼.');
    if(world.dialogue.at(-1)?.role==='assistant'){
      el('div',content,{class:'sd-section'},'최근 AI 세계관 상담 답변');
      el('div',content,{class:'sd-response'},clip(world.dialogue.at(-1).content,4200));
    }
    const worldAdvanced=el('details',content,{class:'sd-advanced'});
    el('summary',worldAdvanced,{},'고급: 세계관 메모와 주인공 성향 지침');
    label(worldAdvanced,'바꾸거나 추가하고 싶은 세계관 메모');
    const question=makeTextarea(worldAdvanced,4,'예: 핸콕은 낯선 사람의 명령을 쉽게 받아들이지 않고, 상대가 자존심을 건드리면 우선 거절하지만 협상 조건을 제시할 수 있게 하고 싶어.');
    question.value=world.input;question.addEventListener('input',()=>{world.input=question.value;scheduleWorldSave();});
    if(world.dialogue.length){
      const history=el('details',content,{class:'sd-details'});history.open=false;
      el('summary',history,{},'AI와 세계관 상담 · 최근 '+world.dialogue.length+'개 메시지');
      const log=el('div',history,{class:'sd-world-log'});
      for(const entry of world.dialogue.slice(-8)){
        const bubble=el('div',log,{class:'sd-bubble '+(entry.role==='user'?'sd-user':'sd-ai')});
        el('div',bubble,{class:'sd-mini'},entry.role==='user'?'내 제안':'세계관 설계 AI');
        el('div',bubble,{},clip(entry.content,3800));
      }
    }
    const row=el('div',worldAdvanced,{class:'sd-actionbar'});
    if(world.dialogue.length)btn(row,'상담만 초기화',()=>action('세계관 상담 초기화',async()=>{
      if(!window.confirm('세계관 상담 기록만 비울까? 설정 메모, 수정안, 버전 기록은 그대로 둬.'))return;
      world.dialogue=[];await saveWorld();renderWorldPanel();
    }),'sd-btn sd-soft');
    label(worldAdvanced,'적용할 세계관 설정 · 확정 메모 (선택)');
    const notes=makeTextarea(worldAdvanced,5,'채팅에 적용할 주인공 성향을 직접 적어 줘.');
    notes.value=world.notes;notes.addEventListener('input',()=>{world.notes=notes.value;scheduleWorldSave();});
    const actions=el('div',worldAdvanced,{class:'sd-actionbar'});
    btn(actions,'주인공 성향 지침 초안',()=>action('주인공 성향 초안',async()=>{
      const guidance=clip(notes.value,7000);
      if(!guidance)throw new Error('적용할 성향 지침을 확정 메모에 적어 줘.');
      if(world.playerDraft&&!window.confirm('검토 중인 주인공 지침 초안을 바꿀까?'))return;
      world.playerDraft={guidance,summary:'직접 입력한 주인공 성향 지침',createdAt:now(),warnings:[]};
      await flushWorldSave();ui.worldExpanded=true;renderWorldPanel();
    }),'sd-btn sd-primary');
    renderManualWorldEditor(content);
    if(world.playerDraft){
      const draft=world.playerDraft;
      const box=el('div',content,{class:'sd-panel sd-plan-draft'});
      el('div',box,{class:'sd-section'},'플레이어 성향 연출 지침 · 검토 및 승인');
      el('div',box,{class:'sd-note'},'이 채팅에만 적용돼. 페르소나 카드/동아리 봇/로어북을 변경하거나 모든 NPC 반응을 자동 결정하지 않아.');
      if(draft.summary)el('div',box,{class:'sd-response'},draft.summary);
      if(draft.warnings?.length)el('div',box,{class:'sd-note sd-world-warning'},draft.warnings.join(' · '));
      label(box,'승인할 주인공 성향 지침 (직접 수정 가능)');
      const edit=makeTextarea(box,6,'한성의 습관이 장단점으로 드러나도록 ...');edit.value=draft.guidance;
      edit.addEventListener('input',()=>{world.playerDraft.guidance=edit.value;scheduleWorldSave();});
      const row=el('div',box,{class:'sd-actionbar'});
      btn(row,'이 채팅의 스토리 연출에 반영',()=>action('주인공 성향 승인',async()=>{
        await flushWorldSave();await applyPlayerStoryDraft();renderWorldPanel();renderSources();
      }),'sd-btn sd-primary');
      btn(row,'초안 폐기',()=>action('주인공 성향 초안 폐기',async()=>{
        world.playerDraft=null;world.summary='플레이어 성향 초안을 버렸어. 기존 설정은 그대로야.';await saveWorld();renderWorldPanel();
      }),'sd-btn sd-soft');
    }
    if(list(project.playerStoryVersions).length){
      const row=el('div',content,{class:'sd-actionbar'});
      btn(row,'직전 플레이어 성향 반영 되돌리기',()=>action('플레이어 성향 지침 복원',async()=>{
        await undoPlayerStoryGuidance();renderWorldPanel();renderSources();
      }),'sd-btn sd-soft');
    }
    if(world.draft){
      const draft=world.draft;
      const block=el('div',content,{class:'sd-world-diff'});
      el('div',block,{class:'sd-section'},'변경안 미리보기 · 승인 전');
      if(draft.summary)el('div',block,{class:'sd-response'},draft.summary);
      if(list(draft.warnings).length)el('div',block,{class:'sd-note sd-world-warning'},draft.warnings.join(' · '));
       const origin=snapshotWorld(current.ch);
       const edits=[...Object.entries(draft.fields||{}).map(([key,value])=>({title:'캐릭터 설정 · '+worldDiffLabel(key),old:origin.fields[key]?.value||'',value,field:key})),
         ...list(draft.lore).map((change,index)=>({title:change.index<0?'신규 로어북 · '+(change.title||'추가 설정'):'로어북 #'+(change.index+1)+' · '+change.title,
           old:change.index>=0?text(origin.globalLore[change.index]?.content):'',value:change.content,edit:index}))];
       const summaryBar=el('div',block,{class:'sd-diff-overview'});
       el('span',summaryBar,{class:'sd-diff-count'},'변경 대상 '+edits.length+'개');
       const totalAdd=edits.reduce((s,x)=>s+fieldTokenChanges(x.old,x.value).added,0);
       const totalRemove=edits.reduce((s,x)=>s+fieldTokenChanges(x.old,x.value).removed,0);
       el('span',summaryBar,{class:'sd-diff-count'},'추가 +'+totalAdd+'단어');
       el('span',summaryBar,{class:'sd-diff-count'},'삭제 −'+totalRemove+'단어');
       el('div',block,{class:'sd-texthint'},'초록색 = 추가 / 빨간 취소선 = 삭제. 먼저 실제 변경된 구간만 보고, 필요한 경우 전체 원문이나 편집창을 펼쳐줘.');
       for(const change of edits){
         const detail=el('details',block,{class:'sd-details'});detail.open=true;
         const heading=el('summary',detail,{},change.title+' · 실제 변경 부분');
         const stats=el('div',detail,{class:'sd-texthint'});
         const focus=el('div',detail,{class:'sd-diff-preview','aria-label':change.title+' 변경된 내용'});
         const full=el('details',detail,{class:'sd-details'});
         el('summary',full,{},'변경 전체 하이라이트 보기');
         const fullBox=el('div',full,{class:'sd-diff-preview sd-diff-full'});
         const editDetails=el('details',detail,{class:'sd-details'});
         el('summary',editDetails,{},'기존 원문과 수정안 직접 편집');
         const cols=el('div',editDetails,{class:'sd-world-columns'});
         const old=el('div',cols);el('div',old,{class:'sd-mini'},'기존 원문 · 읽기 전용');el('div',old,{class:'sd-world-old'},change.old);
         const revised=el('div',cols);el('div',revised,{class:'sd-mini'},'변경할 내용 · 직접 수정 가능');
         const textarea=makeTextarea(revised,9,'');textarea.value=change.value;
         const refresh=()=>{
           const d=fieldTokenChanges(change.old,textarea.value);
           heading.textContent=change.title+' · +'+d.added+' / −'+d.removed+'단어';
           stats.textContent=d.extensive?'주의: 기존 문구 상당 부분을 삭제·재작성하고 있어. 의도한 변경인지 확인해.':
             !change.old?'빈 항목에 신규 내용 추가':d.added||d.removed?'기존 내용과 달라진 부분만 강조했어.':'현재 수정안은 기존 원문과 같아.';
           renderChangeTokens(focus,d,true);
           renderChangeTokens(fullBox,d,false);
         };
         textarea.addEventListener('input',()=>{
           if(change.field)world.draft.fields[change.field]=textarea.value;
           else world.draft.lore[change.edit].content=textarea.value;
           refresh();scheduleWorldSave();
         });
         refresh();
       }
      label(block,'적용 후 버전 이름');
      const name=el('input',block,{class:'sd-field',type:'text',maxlength:'100',placeholder:'예: 핸콕 관계 설정 변경',value:world.versionName||'세계관 수정'});
      name.addEventListener('input',()=>{world.versionName=name.value;scheduleWorldSave();});
      const approving=el('div',block,{class:'sd-actionbar'});
      btn(approving,'검토 완료 · 캐릭터 설정에 실제 적용',()=>action('세계관 승인·적용',async()=>{
        await flushWorldSave();await applyWorldDraft();renderWorldPanel();renderSources();
      }),'sd-btn sd-primary');
      btn(approving,'수정안 버리기',()=>action('변경안 폐기',async()=>{
        world.draft=null;world.summary='미승인 수정안을 버렸어. 실제 설정은 그대로야.';await saveWorld();renderWorldPanel();
      }),'sd-btn sd-soft');
    }
    const archive=el('details',content,{class:'sd-details'});
    el('summary',archive,{},'세계관 버전 / 적용 전으로 되돌리기 ('+world.versions.length+'개)');
    el('p',archive,{class:'sd-texthint'},'기존 World Editor Lab에서 가져온 버전도 포함할 수 있어. 복원할 때는 현재 상태를 다시 백업해.');
    const line=el('div',archive,{class:'sd-world-versions'});
    const select=el('select',line,{class:'sd-field'});
    el('option',select,{value:''},'복원할 버전 선택');
    for(const v of world.versions)el('option',select,{value:v.id},(v.name||'세계관 버전')+' · '+clip(v.createdAt,16));
    btn(line,'선택한 버전으로 복원',()=>action('세계관 버전 복원',async()=>{
      if(!select.value)throw new Error('복원할 버전을 먼저 선택해 줘.');
      await flushWorldSave();await restoreWorldVersion(select.value);renderWorldPanel();
    }),'sd-btn sd-soft');
  }

  function renderUI(){
    guardButtons=[];
    document.body.classList.remove('sd-dock-mode','sd-dock-minimized');
    dockMinimized=false;
    document.body.replaceChildren();document.getElementById('sd-css')?.remove();const style=el('style',document.head,{id:'sd-css'});style.textContent=STYLE;
    const root=el('main',document.body,{class:'sd-app'});ui={buttons:[],views:{},tabs:{},activeTab:project?.activeTab||'plan',instruction:null,worldExpanded:!!(world?.draft||world?.playerDraft)};
    const header=el('div',root,{class:'sd-header'}),brand=el('div',header);
    el('div',brand,{class:'sd-kicker'},'RISUBARD · v'+VERSION);el('div',brand,{class:'sd-brand'},'Story Director');
    const headBtns=el('div',header,{class:'sd-actions'});
    btn(headBtns,'↻ 채팅 새로고침',()=>action('채팅 새로고침',reload),'sd-btn sd-small');
    btn(headBtns,'채팅 옆 빠른 상담',()=>void openDock(),'sd-btn sd-small');
    btn(headBtns,'닫기',()=>{syncFields();void Promise.all([flushSave(),flushWorldSave()]).finally(()=>api.hideContainer());},'sd-btn sd-small');
    ui.identity=el('div',root,{class:'sd-sub'});
    const nav=el('nav',root,{class:'sd-nav'});
    [['plan','전체 흐름','plan'],['main','지금 지시','director'],['settings','플러그인 설정','settings']].forEach(([key,title,kind])=>{
      ui.tabs[key]=el('button',nav,{type:'button','aria-selected':key==='plan'});iconLabel(ui.tabs[key],kind,title);ui.tabs[key].onclick=()=>{syncFields();scheduleSave();visible(key);};
      ui.views[key]=el('section',root,{});
    });
    const main=ui.views.main;
    const grid=el('div',main,{class:'sd-grid'}),left=el('div',grid),aside=el('aside',grid,{class:'sd-sticky'});
    const historyPanel=el('div',left,{class:'sd-panel'});
    const historyHead=el('div',historyPanel,{class:'sd-row sd-between'});
    el('div',historyHead,{class:'sd-title'},'이전 요청과 지시문');
    btn(historyHead,'상담 기록 초기화',()=>action('상담 기록 초기화',resetDirectorConversation),'sd-btn sd-small sd-soft');
    ui.history=el('div',historyPanel,{class:'sd-log'});
    const compose=el('div',left,{class:'sd-panel'});
    el('h2',compose,{class:'sd-title'},'지금 어떤 전개를 원해?');
    el('div',compose,{class:'sd-sub'},'최근 대화와 설정을 참고해 지시문을 작성해. 초안을 수정한 뒤 실제 채팅에 보낼 수 있어.');
    addDirectorComposer(compose);
    const out=el('div',left,{class:'sd-panel'});ui.resultTitle=el('div',out,{class:'sd-title'},'상담·지시문 결과');ui.result=el('div',out);
    
    const side=el('div',aside,{class:'sd-panel'});el('div',side,{class:'sd-title'},'현재 이야기');ui.sourceStats=el('div',side,{class:'sd-stats'});
    el('div',side,{class:'sd-texthint'},'계획은 이야기 설계 탭에서만 변경해. 여기서는 현재 장면만 다뤄.');
    btn(side,'이야기 설계 보기',()=>{syncFields();visible('plan');},'sd-btn sd-soft');
    const plan=ui.views.plan;
    const goalCard=el('div',plan,{class:'sd-panel'});
    el('div',goalCard,{class:'sd-title'},'확정된 전체 방향');
    el('p',goalCard,{class:'sd-muted'},'원하는 엔딩과 장기 목표를 저장해 두고 언제든 수정할 수 있어.');
    ui.goal=makeTextarea(goalCard,5,'예: 주요 인물을 구하면서 성배전쟁을 끝내고, 여성 서번트는 가능한 경우 현대에 정착시킨다.');
    ui.goal.addEventListener('input',()=>{project.goal=ui.goal.value;if(ui.goalMirror)ui.goalMirror.value=ui.goal.value;scheduleSave();});
    const goalActions=el('div',goalCard,{class:'sd-actions'});
    btn(goalActions,'전체 방향 저장',()=>action('전체 목표 저장',async()=>{syncFields();await flushSave();}),'sd-btn sd-primary');
    const flowThread=el('div',plan,{class:'sd-panel'});
    el('div',flowThread,{class:'sd-title'},'AI와 의논한 내용');
    ui.flowHistory=el('div',flowThread,{class:'sd-log'});
    addPlanComposer(plan);
    ui.flowProposal=el('div',plan,{});

    const planAdvanced=el('details',plan,{class:'sd-advanced'});
    el('summary',planAdvanced,{},'고급: 자료 원문·기존 입력칸 직접 열기');
    const intro=el('div',planAdvanced,{class:'sd-panel'});
    el('div',intro,{class:'sd-breadcrumb'},'원본 설정 읽기 → 세계관 조정(선택) → 이야기 설계 → 확정');
    el('h2',intro,{class:'sd-title'},'① 봇의 설정을 먼저 읽었어');
    el('p',intro,{class:'sd-muted'},'이 자료를 참고하면서 이야기를 구상해. 원본을 직접 수정하지 않고 카드·페르소나·로어북·BardWiki와 현재 채팅을 별도 출처로 다뤄.');
    const rs=el('div',intro,{class:'sd-actions'});
    btn(rs,'설정 다시 읽기',()=>action('설정 다시 읽기',async()=>{
      syncFields();const next=await readSources(project.goal,true);if(next.key!==current.key)throw new Error('채팅이 바뀌었어. 상단의 채팅 새로고침 버튼을 눌러줘.');
      current=next;renderSources();renderWorldPanel();
    }),'sd-btn sd-small');
    btn(rs,'세계관 편집 바로가기',()=>{ui.worldExpanded=true;renderWorldPanel();ui.worldRoot?.scrollIntoView?.({behavior:'smooth',block:'start'});},'sd-btn sd-small');
    ui.storySources=el('div',intro);

    ui.worldRoot=el('div',plan,{class:'sd-world-host'});
    const pHead=el('div',planAdvanced,{class:'sd-panel'});
    el('h2',pHead,{class:'sd-title'},'③ 이 자료로 이야기 설계하기');
    el('p',pHead,{class:'sd-muted'},'원하는 사건과 전개의 방향을 위쪽 입력 칸에 적고, 검토할 장기 계획 초안으로 저장할 수 있어.');
    label(pHead,'이야기 방향 / 보고 싶은 소재');
    const mainGoal=makeTextarea(pHead,4,'예: 관계는 천천히 변하되 사건은 빠르게. 거절과 협상이 자주 등장했으면 좋겠어.');
    ui.goalMirror=mainGoal;
    mainGoal.addEventListener('input',()=>{project.goal=mainGoal.value;ui.goal.value=mainGoal.value;scheduleSave();});
    const row1=el('div',pHead,{class:'sd-actions'});
    btn(row1,'수정 내용 저장',()=>action('설정 저장',async()=>{syncFields();await flushSave();renderSources();}), 'sd-btn');
    ui.onboard=el('section',pHead,{class:'sd-onboard'});
    ui.onboardTitle=el('h2',ui.onboard,{},'처음 시작하기');
    ui.onboardDesc=el('p',ui.onboard,{},'읽은 자료를 바탕으로 설계해.');
    const onboardingRow=el('div',ui.onboard,{class:'sd-actions'});
    ui.onboardButton=btn(onboardingRow,'① 설정 기반 설계안 자동 생성',()=>{},'sd-btn sd-primary');
    ui.onboardHelp=el('div',ui.onboard,{class:'sd-hint'},'모델은 설계안 생성 버튼을 누를 때만 호출해.');
    ui.planDraft=el('section',plan,{class:'sd-panel sd-plan-draft sd-hidden'});
    const approval=el('div',planAdvanced,{class:'sd-panel'});
    el('h2',approval,{class:'sd-title'},'④ 확정된 이야기 기준 · 언제든 수정 가능');
    label(approval,'확정된 캐릭터 판정 기준 (관계·개성·장난·협상 성향 포함, 수정 가능)');ui.canon=makeTextarea(approval,13,'AI가 분석한 캐릭터별 동기, 경계, 거절 이유, 관계, 사실과 추론이 저장돼.');
     label(approval,'확정된 절대 금기 (설정의 명시적 신념만, 수정 가능)');ui.hardLimits=makeTextarea(approval,5,'예: 캐릭터 ○○ — 절대 도둑질하지 않음 (봇 카드: ○○). 추측은 적지 마.');
     el('p',approval,{class:'sd-texthint'},'이 내용은 근거가 확인된 절대 금기를 기록하는 칸이야. 일반적인 싫어함, 저항, 호불호는 위 판정 기준에 남겨 둬.');
     label(approval,'확정된 장기 스토리 계획 (수정 가능)');ui.plan=makeTextarea(approval,13,'사건의 방향, 분기, 갈등, 열린 결말이 저장돼.');
     [ui.canon,ui.hardLimits,ui.plan].forEach(x=>x.addEventListener('input',()=>{syncFields();scheduleSave();}));
    const config=ui.views.settings;
    const cfg=el('div',config,{class:'sd-panel'});el('div',cfg,{class:'sd-title'},'플러그인 설정');
    ui.sourceDesc=el('p',cfg,{class:'sd-muted'});
    const guardHelp=el('div',cfg,{class:'sd-note'});
    el('div',guardHelp,{},'일반 채팅에도 캐릭터의 독립성과 현재 페르소나를 반영하려면 이 채팅에만 보정을 켤 수 있어. 기본값은 꺼짐. 첫 사용에 RisuBard 메시지 보정 권한을 물어볼 수 있으며, 서사 보조 프롬프트만 추가하고 사용자의 메시지를 차단하거나 직접 전송하지 않아.');
    addGuardToggle(guardHelp);
    label(cfg,'페르소나 보충 (자동 조회 누락 시만)');ui.personaExtra=makeTextarea(cfg,5,'현재 선택된 페르소나를 가져오지 못한 경우에만 여기에 붙여넣어.');
    label(cfg,'바드위키 추가 규칙 / 참고 설정 (선택)');ui.wikiExtra=makeTextarea(cfg,5,'BardWiki에 없거나 가져오지 못한 내용만 입력해.');
    label(cfg,'스토리 DNA / 선호·금지사항 (선택)');ui.rules=makeTextarea(cfg,6,'예: 장면을 질질 끌지 않기. 모든 등장인물이 비슷한 말투를 쓰지 않기. 주인공 행동 강제하지 않기.');
    [ui.personaExtra,ui.wikiExtra,ui.rules].forEach(x=>x.addEventListener('input',()=>{syncFields();scheduleSave();}));
    const authoredRules=el('details',cfg,{class:'sd-details'});
    el('summary',authoredRules,{},'디렉터가 기억한 사용자 지정 장면 규칙 ('+list(project.authorDirectives).length+'개)');
    el('p',authoredRules,{class:'sd-texthint'},'스토리 디렉터에서 네가 직접 지정한 시스템 효과·지속 규칙만 저장돼. 이전 디렉터의 추측은 포함하지 않아. 다른 봇/채팅에는 적용되지 않아.');
    for(const item of list(project.authorDirectives).slice(-8))el('div',authoredRules,{class:'sd-note'},clip(item.user,600));
    if(list(project.authorDirectives).length)btn(authoredRules,'이 채팅의 기억된 장면 규칙 비우기',()=>action('장면 규칙 초기화',async()=>{
      if(!window.confirm('이 채팅의 사용자 지정 임시 장면 규칙만 비울까? 실제 채팅·봇·설계 계획은 그대로 보존해.'))return;
      project.authorDirectives=[];project.authorRulesMigrated=true;await save();renderUI();visible('settings');
    }),'sd-btn sd-soft');
    label(cfg,'지시문을 만드는 AI 모델');ui.model=el('select',cfg,{class:'sd-field sd-narrow'});
    [['otherAx','보조 모델 (Story Runner와 동일)'],['normal','기본 모델']].forEach(([k,v])=>el('option',ui.model,{value:k},v));
    label(cfg,'전개 속도');ui.pacing=el('select',cfg,{class:'sd-field sd-narrow'});
    [['balanced','균형'],['character','인물 자율성 우선'],['fast','빠른 사건 전개']].forEach(([k,v])=>el('option',ui.pacing,{value:k},v));
    label(cfg,'참고자료 길이 / 호출 비용');ui.contextDepth=el('select',cfg,{class:'sd-field sd-narrow'});
    [['compact','가볍게 (입력 길이 절약)'],['standard','표준'],['deep','깊게 (자료 더 읽기)']].forEach(([k,v])=>el('option',ui.contextDepth,{value:k},v));
    for(const x of [ui.model,ui.pacing,ui.contextDepth])x.addEventListener('change',()=>{syncFields();scheduleSave();});
    const cfgBtns=el('div',cfg,{class:'sd-actions'});
    btn(cfgBtns,'현재 자료 새로 읽기',()=>action('자료 갱신',async()=>{syncFields();const next=await readSources(project.goal,true);if(next.key!==current.key)throw new Error('채팅이 바뀌었어. 현재 채팅을 다시 읽어 줘.');current=next;renderSources();await save();}),'sd-btn sd-primary');
    btn(cfgBtns,'설정 저장',()=>action('저장',async()=>{syncFields();await flushSave();}),'sd-btn');
    const raw=el('details',cfg,{class:'sd-details'});el('summary',raw,{},'실제로 수집된 컨텍스트 확인');ui.sourceRaw=makeTextarea(raw,14,'자료를 읽으면 이곳에 표시돼.');ui.sourceRaw.readOnly=true;
    const logs=el('details',config,{class:'sd-panel sd-advanced'});el('summary',logs,{},'고급: 기록·복원');
    const lp=el('div',logs,{class:'sd-panel'});el('div',lp,{class:'sd-title'},'기록 및 되돌리기');
    el('div',lp,{class:'sd-muted'},'대화는 캐릭터/채팅별로 분리 저장해. 최근 전송 기록을 확인하거나 이번 디렉터 상담만 비울 수 있어. 실제 채팅은 수정하지 않아.');
    const logsArea=el('div',lp);ui.appliedArea=logsArea;
    const logButtons=el('div',lp,{class:'sd-actions'});
    btn(logButtons,'상담 기록 비우기',()=>action('상담 기록 정리',async()=>{if(!window.confirm('이 채팅의 디렉터 상담 기록만 지울까? 계획과 실제 채팅은 보존돼.'))return;project.talks=[];project.last=null;project.pendingPlan=null;project.pendingCanon=null;await save();renderHistory();renderResult();renderLogs();}),'sd-btn sd-danger');
    btn(logButtons,'전체 설정 초기화',()=>action('플러그인 설정 초기화',async()=>{if(!window.confirm('이 채팅의 Story Director 저장값(계획/판정/기록)을 모두 초기화할까? 봇과 실제 채팅은 그대로야.'))return;project=normState(null);await save();setProjectFields();renderHistory();renderResult();renderSources();renderLogs();}),'sd-btn sd-danger');
    ui.status=el('div',root,{class:'sd-status',role:'status'},'준비됨');ui.loading=el('div',root,{class:'sd-note sd-hidden'},'모델 응답을 기다리는 중이야. 이 창을 닫으면 생성 결과가 표시되지 않을 수 있어.');
    setProjectFields();ui.goalMirror.value=project.goal;renderHistory();renderResult();renderSources();renderWorldPanel();renderPlanDraft();renderLogs();renderFlowHistory();renderFlowProposal();visible(['plan','main','settings'].includes(project.activeTab)?project.activeTab:'plan');
  }
  function renderLogs(){if(!ui?.appliedArea)return;ui.appliedArea.replaceChildren();
    if(!project.applied.length){el('div',ui.appliedArea,{class:'sd-empty'},'아직 채팅에 전송한 지시문이 없어.');return;}
    project.applied.slice().reverse().slice(0,12).forEach(x=>{const item=el('details',ui.appliedArea,{class:'sd-details'});el('summary',item,{},`${x.at?.slice(0,19)||'날짜 미상'} · 보낸 지시문`);el('div',item,{class:'sd-bubble sd-ai'},x.text);const row=el('div',item,{class:'sd-actions'});btn(row,'다시 복사',()=>action('복사',async()=>copyText(x.text)),'sd-btn sd-small');});
  }
  async function submitDirector(options={}){
    await action('지시문 작성',async()=>{
      const composer=layoutMode==='dock'?ui?.dock?.composer:ui?.composer;
      if(!composer)return;
      if(layoutMode==='full')syncFields();
      await writeCurrentInstruction(composer.value,options);
      syncDirectorInput('');await flushSave();
      renderDirectorOutputs();
      if(ui?.dock?.scroll)ui.dock.scroll.scrollTop=ui.dock.scroll.scrollHeight;
    });
  }
  async function resizeDockHost(side=dockSide){
    if(!dockHost)return false;
    const css=dockMinimized?{
      position:'fixed',display:'block',top:'auto',
      width:'min(224px, calc(100vw - 16px))',height:'54px',
      left:side==='left'?'8px':'auto',right:side==='right'?'8px':'auto',
      bottom:'clamp(82px, 11vh, 112px)',border:'1px solid #405b70',borderRadius:'14px',
      boxShadow:'0 8px 28px rgba(0,0,0,.44)',zIndex:'1000',backgroundColor:'transparent'
    }:{
      position:'fixed',display:'block',top:'clamp(8px, 5vh, 65px)',
      width:'min(470px, calc(100vw - 16px))',height:'min(83vh, 760px)',
      left:side==='left'?'8px':'auto',right:side==='right'?'8px':'auto',
      bottom:'auto',border:'1px solid #405b70',borderRadius:'14px',
      boxShadow:'0 18px 50px rgba(0,0,0,.52)',zIndex:'1000',backgroundColor:'#172331'
    };
    for(const [property,value] of Object.entries(css))await dockHost.setStyle(property,value);
    dockSide=side;
    return true;
  }
  async function minimizeDock(){
    if(layoutMode!=='dock'||dockMinimized||!dockHost)return;
    // Keep the active DOM, consultation history and unsent working draft intact.
    // Minimizing is allowed while a model call is running; it does not cancel it.
    if(ui?.dock?.composer)syncDirectorInput(ui.dock.composer.value);
    dockMinimized=true;
    document.body.classList.add('sd-dock-minimized');
    try{await resizeDockHost(dockSide);}
    catch(error){dockMinimized=false;document.body.classList.remove('sd-dock-minimized');throw error;}
  }
  async function restoreDock(){
    if(layoutMode!=='dock'||!dockMinimized||!dockHost)return;
    dockMinimized=false;
    document.body.classList.remove('sd-dock-minimized');
    try{await resizeDockHost(dockSide);}
    catch(error){dockMinimized=true;document.body.classList.add('sd-dock-minimized');throw error;}
  }
  async function findOwnDockHost(){
    try{
      const doc=await api.getRootDocument();
      if(!doc){console.warn('[SD] Main DOM permission unavailable; showing full UI.');return false;}
      // `showContainer('fullscreen')` places our iframe at fixed z-index 1000.
      // Refuse to touch any iframe if that signature is ambiguous.
      const frames=await doc.querySelectorAll('iframe[style*="z-index: 1000"]');
      if(!frames||await frames.length()!==1)return false;
      const found=await frames.at(0);
      if(!found||await found.getStyle('display')!=='block'||await found.getStyle('position')!=='fixed')return false;
      dockHost=found;
      return await resizeDockHost(dockSide);
    }catch(e){console.warn('[SD] Floating drawer unavailable; using fullscreen fallback:',e);dockHost=null;return false;}
  }
  function dockButton(parent,label,callback,cls='sd-btn'){
    return btn(parent,label,callback,cls);
  }
  function renderDockHistory(){
    const d=ui?.dock;if(!d)return;
    d.history.replaceChildren();
    if(!project.talks.length){el('div',d.history,{class:'sd-dock-mini'},'아직 상담이 없어. 아래에 원하는 행동이나 전개를 적어봐.');return;}
    for(const entry of project.talks.slice(-6)){
      const u=el('div',d.history,{class:'sd-bubble sd-user'});
      el('div',u,{class:'sd-mini'},'나 · '+(entry.mode||'상담'));
      el('div',u,{},entry.user||'');
      const a=el('div',d.history,{class:'sd-bubble sd-ai'});
      el('div',a,{class:'sd-mini'},'디렉터'+(entry.verdict&&entry.verdict!=='판정 불필요'?' · '+(entry.mode==='check'?'가정상 ':'')+entry.verdict:''));
      el('div',a,{},entry.reply||'(답변 없음)');
    }
    d.scroll.scrollTop=d.scroll.scrollHeight;
  }
  function renderDockResult(){
    const d=ui?.dock;if(!d)return;
    d.result.replaceChildren();
    d.turnContext=el('div',d.result);
    renderTurnContext(d.turnContext);
    d.instruction=renderDraft(d.result);
  }
  async function dockReload(){
    await action('채팅 최신상태 반영',async()=>{
      if(ui?.dock?.composer)project.directorInput=ui.dock.composer.value;
      await reload();
      if(ui?.dock){ui.dock.identity.textContent=current.identity;ui.dock.composer.value=project.directorInput||'';}
      renderDockHistory();renderDockResult();
    });
  }
  async function expandDockToFull(tab='main',approvedRouteAction=false){
    if(busy&&!approvedRouteAction)return;
    if(ui?.dock?.composer)project.directorInput=ui.dock.composer.value;
    await flushSave();
    layoutMode='full';dockMinimized=false;document.body.classList.remove('sd-dock-mode','sd-dock-minimized');
    await api.showContainer('fullscreen');
    renderUI();
    visible(tab);
  }
  function renderDockUI(){
    document.body.classList.add('sd-dock-mode');
    const d={};ui.dock=d;
    const shell=el('section',document.body,{class:'sd-dock',role:'region','aria-label':'Story Director 빠른 상담'});
    d.root=shell;
    const header=el('div',shell,{class:'sd-dock-head'});
    const top=el('div',header,{class:'sd-dock-headline'});
    el('div',top,{class:'sd-title'},'🎬 Story Director · 빠른 상담');
    const controls=el('div',top,{class:'sd-actions'});
    dockButton(controls,'↔',()=>action('패널 위치',async()=>{await resizeDockHost(dockSide==='right'?'left':'right');}),'sd-btn sd-small');
    dockButton(controls,'전체',()=>void expandDockToFull('main'),'sd-btn sd-small');
    const mini=el('button',controls,{type:'button',class:'sd-btn sd-small',title:'빠른 상담 최소화','aria-label':'빠른 상담 최소화'},'−');
    mini.onclick=()=>void minimizeDock().catch(e=>console.warn('[SD] minimize failed:',e));
    dockButton(controls,'×',()=>{project.directorInput=d.composer.value;void flushSave().finally(()=>api.hideContainer());},'sd-btn sd-small');
    d.identity=el('div',header,{class:'sd-dock-mini'},current.identity);
    const tools=el('div',header,{class:'sd-dock-toolbar'});
    dockButton(tools,'↻ 현재 채팅 읽기',()=>void dockReload(),'sd-btn sd-small');
    dockButton(tools,'세계관/이야기 설계',()=>void expandDockToFull('plan'),'sd-btn sd-small');
    addGuardToggle(tools);
    el('span',tools,{class:'sd-dock-mini'},'v'+VERSION+' · 전송은 승인 후');
    d.status=el('div',header,{class:'sd-dock-status',role:'status'},'준비됨');
    d.loading=el('div',header,{class:'sd-dock-load sd-hidden'},'지시문 작성 중…');
    d.scroll=el('div',shell,{class:'sd-dock-scroll'});
    const historyHead=el('div',d.scroll,{class:'sd-row sd-between'});
    el('div',historyHead,{class:'sd-section'},'디렉터와 논의');
    dockButton(historyHead,'상담 기록 초기화',()=>action('상담 기록 초기화',resetDirectorConversation),'sd-btn sd-small');
    d.history=el('div',d.scroll,{class:'sd-dock-thread'});
    d.result=el('div',d.scroll,{class:'sd-dock-result'});
    const composer=el('div',shell,{class:'sd-dock-compose'});
    d.composer=makeTextarea(composer,3,'이번 장면에서 원하는 전개를 적어 줘.');
    d.composer.value=project.directorInput||'';
    d.composer.addEventListener('input',()=>syncDirectorInput(d.composer.value));
    d.composer.addEventListener('keydown',event=>{if(event.key==='Enter'&&(event.ctrlKey||event.metaKey)){event.preventDefault();void submitDirector();}});
    const actions=el('div',composer,{class:'sd-dock-actions'});
    dockButton(actions,'지시문 작성',()=>void submitDirector(),'sd-btn sd-primary');
    dockButton(actions,'문장 정리',()=>void submitDirector({polish:true}),'sd-btn');
    // The mini tray stays in this same iframe. It never discards the editor or
    // restarts an in-progress model request when restoring the drawer.
    const tray=el('div',document.body,{class:'sd-dock-tray',role:'group','aria-label':'최소화한 Story Director'});
    d.minimizeTray=tray;
    const restore=el('button',tray,{type:'button',class:'sd-dock-tray-open',title:'빠른 상담 다시 펼치기','aria-label':'빠른 상담 다시 펼치기'});
    vectorIcon('director',restore);el('span',restore,{},'Story Director 펼치기');
    restore.onclick=()=>void restoreDock().catch(e=>console.warn('[SD] restore failed:',e));
    const trayClose=el('button',tray,{type:'button',class:'sd-dock-tray-close',title:'빠른 상담 닫기','aria-label':'빠른 상담 닫기'},'×');
    trayClose.onclick=()=>{project.directorInput=d.composer.value;void flushSave().finally(()=>{dockMinimized=false;document.body.classList.remove('sd-dock-minimized');api.hideContainer();});};
    renderDockHistory();renderDockResult();
  }
  async function openDock(){
    if(busy)return;
    guardButtons=[];
    try{
      // Use the same per-character/per-chat storage as the original editor.
      if(current&&project){if(ui?.dock?.composer)project.directorInput=ui.dock.composer.value;await flushSave();}
      current=await readSources();project=normState(await api.pluginStorage.getItem(current.key));project.chatGuardEnabled=guardKeys.has(current.key);await loadWorld();
      layoutMode='dock';dockMinimized=false;document.body.classList.remove('sd-dock-minimized');
      await api.showContainer('fullscreen');
      renderUI();
      const floating=await findOwnDockHost();
      if(!floating){
        layoutMode='full';
        setStatus('빠른 패널 사용에는 RisuBard의 화면 접근 권한이 필요해. 현재는 전체화면이야. 생성 후 «이대로 채팅에 보내기»로 직접 전송할 수 있어.',true);
        visible('main');
        return;
      }
      renderDockUI();
    }catch(error){
      console.error('[SD] openDock failed',error);
      layoutMode='full';document.body.classList.remove('sd-dock-mode');
      try{await api.showContainer('fullscreen');renderUI();visible('main');setStatus('빠른 상담 오류: '+(error?.message||error),true);}catch(_){}
    }
  }
  let refreshingTurn=false;
  window.addEventListener('focus',async()=>{
    if(layoutMode!=='dock'||busy||refreshingTurn||!ui?.dock?.turnContext?.isConnected)return;
    refreshingTurn=true;
    const opened=current;
    try{
      const live=await readLiveTurn();
      if(opened!==current||layoutMode!=='dock'||busy||live.stamp===turnStamp(current.chat))return;
      current.chat=live.chat;
      renderTurnContext(ui.dock.turnContext);
      if(ui.turnContext)renderTurnContext(ui.turnContext);
    }catch(error){
      if(opened===current)setStatus(error?.message||String(error),true);
    }finally{refreshingTurn=false;}
  });
  try{
    await api.registerSetting('Story Director',openDock,'🧭','html','story-director-settings');
    await api.registerButton({name:'Story Director',icon:'🧭',iconType:'html',location:'hamburger',id:'story-director-hamburger'},openDock);
    await api.registerButton({name:'Story Director 빠른 상담',icon:'<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 4h16v12H8l-4 4V4Z"/><path d="M8 9h8M8 13h5"/></svg>',iconType:'html',location:'chat',id:'story-director-quick-chat'},openDock);
    try{await loadGuardIndex();if(guardKeys.size)await ensureGuardHook();}catch(e){console.warn('[Story Director] optional normal-chat guard disabled:',e);}
    console.log('[Story Director] v'+VERSION+' installed. Persona scope aware; optional per-chat prompt enhancer (off by default), no auto sending.');
  }catch(e){console.error('[Story Director] registration failed',e);}
})();
