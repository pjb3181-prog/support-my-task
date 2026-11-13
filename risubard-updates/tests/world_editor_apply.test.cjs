'use strict';
// World Editor Lab: applying an approved draft / restoring a version must not overwrite a change made
// (by Mutation State Router or the user) while its backup was being saved, and must respect Mutation's lock.
const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
const src=fs.readFileSync(path.join(__dirname,'..','world_editor_lab.js'),'utf8');
const head=src.slice(src.indexOf('const NAME='),src.indexOf('async function readStore('));
const persistFn=src.slice(src.indexOf('async function persist('),src.indexOf('function sourceSummary('));
const apply=src.slice(src.indexOf('function materialize('),src.indexOf('function previews('));
assert.ok(head&&persistFn&&apply);
function harness({card,onPersist,storage={}}){
 const state={card:JSON.parse(JSON.stringify(card)),writes:[],store:{...storage}};
 const env={
  JSON,Date,Math,Object,Promise,Error,
  risuai:{
   getCurrentCharacterIndex:async()=>0,
   getCharacterFromIndex:async()=>JSON.parse(JSON.stringify(state.card)),
   setCharacterToIndex:async(ci,next)=>{state.writes.push(next);state.card=JSON.parse(JSON.stringify(next));},
   pluginStorage:{
    getItem:async k=>state.store[k]===undefined?null:JSON.parse(JSON.stringify(state.store[k])),
    setItem:async(k,v)=>{state.store[k]=JSON.parse(JSON.stringify(v));if(onPersist)await onPersist(state);}},
  },
 };
 const api=vm.runInNewContext(head+persistFn+apply+`
  ({applyDraft,restore,
    prime(c,d){character=JSON.parse(JSON.stringify(c));draft=d;draftHash=fingerprint(snapshot(c));},
    get(){return {versions,status,activeVersion,draft};},
    setVersions(v){versions=v;}})`,env);
 return {state,api};
}
const card={chaId:'c1',name:'T',desc:'d',personality:'p',scenario:'s',exampleMessage:'e',firstMessage:'FIRST',globalLore:[{id:'l1',comment:'o',key:'k',content:'old',alwaysActive:false}]};
const draft={summary:'x',warnings:[],fields:{scenario:'new scenario'},lore:[]};

test('applies the approved draft, keeps the first message and backs up the previous state',async()=>{
 const {state,api}=harness({card});
 api.prime(card,draft);
 await api.applyDraft('v1');
 assert.equal(state.writes.length,1);
 assert.equal(state.card.scenario,'new scenario');
 assert.equal(state.card.firstMessage,'FIRST');
 const g=api.get();
 assert.equal(g.versions.length,2);
 assert.ok(g.versions.some(v=>v.name.startsWith('적용 전 백업')));
});
test('a change made while the backup is being saved is NOT overwritten (stale whole-card write is refused)',async()=>{
 let first=true;
 const {state,api}=harness({card,onPersist:async s=>{
  if(first){first=false;s.card.globalLore[0].content='MUTATION REWROTE THIS';}}});
 api.prime(card,draft);
 await assert.rejects(()=>api.applyDraft('v1'),/적용 직전에 캐릭터 데이터가 변경됐어/);
 assert.equal(state.writes.length,0,'nothing is written');
 assert.equal(state.card.globalLore[0].content,'MUTATION REWROTE THIS','the concurrent change survives');
 assert.equal(api.get().versions.length,0,'the pending version entries are rolled back');
});
test('Mutation State Router becoming active during the save blocks the write',async()=>{
 let first=true;
 const {state,api}=harness({card,onPersist:async s=>{
  if(first){first=false;s.store.mutation_state_v1_mode_live_owner_v1_c1={mode:'mutated'};}}});
 api.prime(card,draft);
 await assert.rejects(()=>api.applyDraft('v1'),/Mutation State Router/);
 assert.equal(state.writes.length,0);
});
test('an existing Mutation lock blocks apply and restore before anything is saved',async()=>{
 const {state,api}=harness({card,storage:{mutation_state_v1_direct_char_meta_c1:{appliedAt:1}}});
 api.prime(card,draft);
 await assert.rejects(()=>api.applyDraft('v1'),/직접 개변 적용 기록/);
 api.setVersions([{id:'v',name:'old',snapshot:{scenario:'old',globalLore:[]}}]);
 await assert.rejects(()=>api.restore('v'),/적용을 먼저 해제/);
 assert.equal(state.writes.length,0);
});
test('restore also refuses a stale write and keeps the concurrent change',async()=>{
 let first=true;
 const {state,api}=harness({card,onPersist:async s=>{
  if(first){first=false;s.card.desc='changed meanwhile';}}});
 api.prime(card,null);
 api.setVersions([{id:'v',name:'old',snapshot:{desc:'d',scenario:'old',globalLore:[]}}]);
 await assert.rejects(()=>api.restore('v'),/적용 직전에 캐릭터 데이터가 변경됐어/);
 assert.equal(state.writes.length,0);
 assert.equal(state.card.desc,'changed meanwhile');
});
test('a draft made from an older card is still refused (fingerprint check unchanged)',async()=>{
 const {api}=harness({card});
 api.prime({...card,scenario:'something else'},draft);
 await assert.rejects(()=>api.applyDraft('v1'),/수정안을 만든 후/);
});
