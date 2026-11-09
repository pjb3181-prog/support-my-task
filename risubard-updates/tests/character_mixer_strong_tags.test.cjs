'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const src=fs.readFileSync(path.join(__dirname,'..','character_mixer.js'),'utf8');
const first=src.indexOf('  function sceneBeats('),end=src.indexOf('  // Place the macro beside',first);
const signalStart=src.indexOf('  function sceneTagSignals('),signalEnd=src.indexOf('  // Strong scene subjects outrank',signalStart);
const helpers=src.slice(first,end);
const sandbox='const str=x=>String(x??"");const asArray=x=>Array.isArray(x)?x:[];const sanitizeSceneText=x=>String(x??"");'+
 src.slice(signalStart,signalEnd)+
 'const activeCharacterInScene=()=>false;const sceneSubjectTags=()=>[];const safeAutoIllustrationPost=()=>true;'+
 'const allowsRating=()=>true;const sceneRatingMode=()=>"general";const verifiedPackIdentity=()=>true;'+helpers+
 '({sceneActorTags,strongSceneTags,buildSceneSearchRequests,rankIllustrationBeats,assetMatchesLocalBeat})';
const f=vm.runInNewContext(sandbox);
test('smile, crying and sitting alone never trigger external searches',()=>{
 for(const phrase of ['웃었다.','울었다. 눈물이 흘렀다.','의자에 앉았다.']){
   const beat={text:phrase,context:phrase,packPresent:false};
   assert.equal(f.buildSceneSearchRequests(beat,{characterKind:'original'}).length,0);
 }
});
test('subject omitted but human action must not yield no_humans',()=>{
 for(const phrase of ['핸드폰을 충전기에 꽂았다.','침대에 누웠다.','메시지를 읽었다.']){
   const beat={text:phrase,context:phrase,packPresent:false};
   assert.equal(f.sceneActorTags(beat)[0],'solo');
   const queries=f.buildSceneSearchRequests(beat,{characterKind:'original'}).map(x=>x.join(' '));
   assert.ok(queries.length>=1);
   assert.ok(queries.every(x=>!x.includes('no_humans')));
 }
});
test('explicit female and male actors use the correct booru person tag',()=>{
 assert.equal(f.sceneActorTags({text:'그녀는 핸드폰을 들었다.'})[0],'1girl');
 assert.equal(f.sceneActorTags({text:'그는 핸드폰을 들었다.'})[0],'1boy');
});
test('gender ambiguous person action does not guess a woman',()=>{
 const beat={text:'침대에 누웠다.',context:'침대에 누웠다.',packPresent:false};
 const queries=f.buildSceneSearchRequests(beat,{characterKind:'original'}).map(x=>x.join(' '));
 assert.ok(queries.some(q=>q.startsWith('solo ')));
 assert.ok(queries.every(q=>!q.startsWith('1girl ')&&!q.startsWith('no_humans ')));
});
test('matching rejects smile-only art, animal-only art, and irrelevant object-only art',()=>{
 const beat={text:'핸드폰을 들었다.',context:'핸드폰을 들었다.',packPresent:false};
 assert.equal(f.assetMatchesLocalBeat({tags:['smile','1girl']},{characterKind:'original'},beat),false);
 assert.equal(f.assetMatchesLocalBeat({tags:['animal_focus','cellphone']},{characterKind:'original'},beat),false);
 assert.equal(f.assetMatchesLocalBeat({tags:['no_humans','cellphone']},{characterKind:'original'},beat),false);
 assert.equal(f.assetMatchesLocalBeat({tags:['1girl','cellphone']},{characterKind:'original'},beat),true);
});
test('phone/bed surrounding text produces concrete tags',()=>{
 const tags=Array.from(f.strongSceneTags('핸드폰을 보고 침대에 누웠다.'));
 assert.ok(tags.includes('cellphone'));
 assert.ok(tags.includes('lying'));
});
test('actual network search uses the strong request builder and tags appear in diagnostics',()=>{
 assert.match(src,/const requests=buildSceneSearchRequests\(beat,pack\)/);
 assert.match(src,/strongSceneTags\(beat\.text\)\.join\(','\)/);
 assert.doesNotMatch(src,/const requests=\[\[actor,core\[0\]\], \[core\[0\]\]\]/);
});
