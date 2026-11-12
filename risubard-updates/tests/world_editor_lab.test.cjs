'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const src=fs.readFileSync(path.join(__dirname,'..','world_editor_lab.js'),'utf8');
test('valid RisuBard API 3 plugin with stable self-update URL',()=>{
 new vm.Script(src);
 assert.match(src,/^\/\/@name world_editor_lab/m);
 assert.match(src,/^\/\/@api 3.0/m);
 assert.match(src,/^\/\/@version 0.1.0/m);
 assert.match(src,/^\/\/@update-url https:\/\/raw\.githubusercontent\.com\/pjb3181-prog\/support-my-task\/main\/risubard-updates\/world_editor_lab\.js/m);
});
const base=src.slice(src.indexOf('const NAME='),src.indexOf('async function readStore('));
const normalize=src.slice(src.indexOf('function protectedFirstMessageMarkers('),src.indexOf('async function makeDraft('));
const materialize=src.slice(src.indexOf('function materialize('),src.indexOf('async function applyDraft('));
const fixture=new vm.Script(base+normalize+materialize+'({snapshot,fingerprint,normalizeProposal,materialize,setPermit:x=>permitFirst=x,protectedFirstMessageMarkers})');
const f=fixture.runInNewContext({});
const card={
 desc:'A traveler in Seoul',personality:'Confident and reserved',
 scenario:'An ordinary world',exampleMessage:'Hello there',
 firstMessage:'{{img::intro}} Start: [A] [B]',
 globalLore:[{id:'existing1',comment:'Origin',key:'earth',content:'Humans live here',alwaysActive:false,customFlag:7}],
 alternateGreetings:['Alternate intro'],extraField:'keep'
};
test('surface snapshots are independent deep copies and include lore and first message',()=>{
 const copy=f.snapshot(card);
 copy.globalLore[0].content='CHANGED';
 assert.equal(card.globalLore[0].content,'Humans live here');
 assert.equal(copy.firstMessage,'{{img::intro}} Start: [A] [B]');
});
test('approved proposal edits only selected fields and lore content, keeps native assets and lore metadata',()=>{
 const start=f.snapshot(card);
 const plan=f.normalizeProposal({summary:'Update civilization',fields:{scenario:'An alternate world',firstMessage:'destroy choices',badField:'bad'},
  loreEdits:[{index:0,content:'Humans and beastfolk live here'},{index:-1,comment:'Beastfolk society',key:'beastfolk',content:'Half the population are beastfolk'}]},start);
 assert.equal(plan.fields.firstMessage,undefined);
 const next=f.materialize(start,plan);
 assert.equal(next.scenario,'An alternate world');
 assert.equal(next.firstMessage,'{{img::intro}} Start: [A] [B]');
 assert.equal(next.personality,'Confident and reserved');
 assert.equal(next.globalLore[0].id,'existing1');
 assert.equal(next.globalLore[0].customFlag,7);
 assert.equal(next.globalLore[0].content,'Humans and beastfolk live here');
 assert.equal(next.globalLore.length,2);
 assert.equal(card.globalLore.length,1);
});
test('invalid lore indexes cannot overwrite arbitrary entries',()=>{
 const start=f.snapshot(card);
 const plan=f.normalizeProposal({fields:{desc:'Changed'},loreEdits:[{index:999,content:'discarded'}]},start);
 assert.equal(plan.lore.length,0);
});
test('first message requires opt-in but is still diffed precisely',()=>{
 assert.match(src,/if\(!permitFirst\)continue;/);
 assert.match(src,/permitFirst=false/);
 assert.match(src,/permitFirst=Boolean\(e.target.checked\);draft=null/);
});
test('apply prevents stale source writes and snapshots before saving',()=>{
 assert.match(src,/fingerprint\(current\)!==draftHash/);
 assert.match(src,/const before=\{id:'backup-'/);
 assert.match(src,/await persist\(\);\s*try\{await risuai.setCharacterToIndex\(ci,\{\.\.\.cp\(char\),\.\.\.next\}\);\}/);
 assert.match(src,/catch\(e\)\{versions=previous;await persist\(\);throw e;\}/);
});
test('version switch backs up current card and never edits chat or shared module database',()=>{
 assert.match(src,/async function restore\(id\)/);
 assert.match(src,/name:'전환 전 백업 '/);
 assert.doesNotMatch(src,/setChatToIndex|setDatabaseLite|addRisuChatListener|addRisuScriptHandler|setInterval/);
});
test('mutation owner and compiled metadata block concurrent edits',()=>{
 assert.match(src,/mutation_state_v1/);
 assert.match(src,/mode_live_owner_v1_/);
 assert.match(src,/direct_char_meta_/);
 assert.match(src,/if\(conflict\)throw Error\(conflict/);
});
test('UI captures typed form values before rerender',()=>{
 assert.match(src,/const input=\{prompt:el\('wel-prompt'\)\?\.value/);
 assert.match(src,/void execute\(\(\)=>fn\(input\)\)/);
});
test('AI is opt-in only from explicit discussion or proposal buttons',()=>{
 assert.match(src,/act\('wel-talk'/);
 assert.match(src,/act\('wel-plan'/);
 assert.doesNotMatch(src,/runLLMModel\([^)]*onUnload/);
});

test('first message edit opt-in still preserves existing choices and asset tags',()=>{
 f.setPermit(true);
 const origin=f.snapshot(card);
 assert.throws(()=>f.normalizeProposal({fields:{firstMessage:'Start immediately.'}},origin),/선택지 또는 이미지 태그/);
 const permitted='{{img::intro}} Start: [A] [B] New opening context';
 const proposed=f.normalizeProposal({fields:{firstMessage:permitted}},origin);
 assert.equal(proposed.fields.firstMessage,permitted);
 f.setPermit(false);
});
test('explicit line-based numbered and bracket choice options are protected',()=>{
 const text='Beginning\n[선택 A] Follow her\n① Stay here\n1. Open the door\n{{img::background}}';
 const tokens=Array.from(f.protectedFirstMessageMarkers(text));
 assert.ok(tokens.includes('[선택 A] Follow her'));
 assert.ok(tokens.includes('① Stay here'));
 assert.ok(tokens.includes('1. Open the door'));
 assert.ok(tokens.includes('{{img::background}}'));
});

test('large card fields and lore are never replaced from truncated AI excerpts',()=>{
 const original=f.snapshot(card);
 original.desc='D'.repeat(7000);
 assert.throws(()=>f.normalizeProposal({fields:{desc:'unsafe partial'}},original),/참조 범위를 초과/);
 original.desc='A traveler in Seoul';
 original.globalLore[0].content='L'.repeat(1800);
 assert.throws(()=>f.normalizeProposal({fields:{scenario:'New'},loreEdits:[{index:0,content:'unsafe'}]},original),/부분 손실/);
});
test('reopening the editor switches character scope without corrupting another character session',()=>{
 assert.match(src,/async function open\(\)\{\s*\/\/ Opening the editor for a different character starts a fresh scoped session\.\s*character=null;/);
 assert.match(src,/if\(character&&charKey\(char\)!==charKey\(character\)\)/);
});
