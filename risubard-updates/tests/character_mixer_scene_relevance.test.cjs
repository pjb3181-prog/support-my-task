'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const src=fs.readFileSync(path.join(__dirname,'..','character_mixer.js'),'utf8');
const a=src.indexOf('  const sceneSubjects='),b=src.indexOf('  function pickTaggedAsset(',a);
assert.ok(a>0&&b>a,'scene matching helpers must be present');
const f=vm.runInNewContext(
 'const str=x=>String(x??""); const asArray=x=>Array.isArray(x)?x:[];'+src.slice(a,b)+'({sceneSubjectMatched,verifiedPackIdentity})');
test('smile-only image cannot illustrate video-game win',()=>assert.equal(f.sceneSubjectMatched('릴리가 격투 게임에서 이겼다. 웃었다.',['smile','happy']),false));
test('game image with game tag can illustrate game scene',()=>assert.equal(f.sceneSubjectMatched('릴리가 격투 게임에서 이겼다.',['video_games','smile']),true));
test('the final cookie scene wins over an earlier video-game scene',()=>{
 const scene='릴리는 게임을 이겼다. 식탁에 남은 초콜릿 쿠키를 봤다.';
 assert.equal(f.sceneSubjectMatched(scene,['video_games','smile']),false);
 assert.equal(f.sceneSubjectMatched(scene,['cookie','smile']),true);
});
test('a bare smile is still eligible in a non-specific scene',()=>assert.equal(f.sceneSubjectMatched('릴리는 환하게 웃었다.',['smile']),true));
test('fanwork identity must match a verified character tag',()=>{
 const pack={characterKind:'fanwork',originalWork:'pokemon',identityEvidence:{externalCandidates:[{tag:'lillie_(pokemon)'}]}};
 assert.equal(f.verifiedPackIdentity({tags:['misty_(pokemon)','smile']},pack),false);
 assert.equal(f.verifiedPackIdentity({tags:['lillie_(pokemon)','smile']},pack),true);
 assert.equal(f.verifiedPackIdentity({tags:['smile']},{characterKind:'fanwork',originalWork:'pokemon'}),false);
});
test('v0.10.1 keeps existing binary and storage logic',()=>{
 assert.match(src,/\/\/\@version 0\.10\.1/);
 assert.match(src,/const PACK_STORE='character_mixer_library_v1'/);
 assert.match(src,/async function inlineAssetForDisplay/);
 assert.match(src,/async function persistAssetToPack/);
});
test('the scene-specific source tag is preferred during search',()=>{
 const source=fs.readFileSync(path.join(__dirname,'..','character_mixer.js'),'utf8');
 assert.match(source,/const focus=sceneSubjectTags\(beat.text\)/);
 assert.match(source,/const keys=beat.plan.searchTags.length/);
 assert.match(source,/const localMatches=await countDistinctMatchingAssets\(pack,beat\)/);
 assert.match(source,/assetMatchesLocalBeat\(asset,pack,beat\)/);
 assert.doesNotMatch(source,/const localMatches=existing.filter\(x=>isUsablePackAsset\(x,pack,tagSignals\)\)\.length/);
});
test('display and auto search both recognize games and cookies',()=>{
 const source=fs.readFileSync(path.join(__dirname,'..','character_mixer.js'),'utf8');
 assert.match(source,/\[\['cookie','cookies','chocolate_chip_cookie'\]/);
 assert.match(source,/\[\['video_games','playing_video_games','game_controller','arcade'\]/);
});

test('search diagnostics identify character and scene rejection separately',()=>{
 const source=fs.readFileSync(path.join(__dirname,'..','character_mixer.js'),'utf8');
 assert.match(source,/const identityMatches=available.filter\(x=>beat.packPresent\?verifiedPackIdentity\(x,pack\):true\)/);
 assert.match(source,/const sceneMatches=identityMatches.filter\(x=>assetMatchesLocalBeat\(x,pack,beat\)\)/);
 assert.match(source,/캐릭터 확인 /);
 assert.match(source,/장면 일치 /);
});
test('subject match can select image without irrelevant emotion tags',()=>{
 const source=fs.readFileSync(path.join(__dirname,'..','character_mixer.js'),'utf8');
 const start=source.indexOf('  function assetSceneScore('),end=source.indexOf('  function isUsablePackAsset(',start);
 const fn=vm.runInNewContext('const str=x=>String(x??"");const asArray=x=>Array.isArray(x)?x:[];'+
 source.slice(source.indexOf('  const sceneSubjects='),source.indexOf('  function verifiedPackIdentity('))+
 'const verifiedPackIdentity=()=>true;'+source.slice(start,end)+'isRelevantPost');
 const signals=[{weight:3,tags:['smile']}];
 assert.equal(fn({tags:['game_controller']},signals,'original',null,'그녀가 격투 게임을 했다.'),true);
 assert.equal(fn({tags:['smile']},signals,'original',null,'그녀가 격투 게임을 했다.'),false);
});

test('arcade is recognized as a specific scene rather than generic smiling',()=>{
 assert.equal(f.sceneSubjectMatched('게임 센터에서 놀았다.',['smile']),false);
 assert.equal(f.sceneSubjectMatched('게임 센터에서 놀았다.',['arcade']),true);
});
test('fanwork search uses a corroborated series tag',()=>{
 const source=fs.readFileSync(path.join(__dirname,'..','character_mixer.js'),'utf8');
 assert.match(source,/verifiedTag=verifiedTags.find/);
 assert.match(source,/2차창작 캐릭터 태그 미확인/);
 assert.doesNotMatch(source,/externalCandidates\)\[0\]\?\.tag/);
});
