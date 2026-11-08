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
test('v0.9.5 keeps existing binary and storage logic',()=>{
 assert.match(src,/\/\/\@version 0\.9\.5/);
 assert.match(src,/const PACK_STORE='character_mixer_library_v1'/);
 assert.match(src,/async function inlineAssetForDisplay/);
 assert.match(src,/async function persistAssetToPack/);
});
test('the scene-specific source tag is preferred during search',()=>{
 const source=fs.readFileSync(path.join(__dirname,'..','character_mixer.js'),'utf8');
 assert.match(source,/const focus=sceneSubjectTags\(window\)/);
 assert.match(source,/const keys=focus.length\?\[focus\[0\]\]/);
 assert.match(source,/const localMatches=await countDistinctMatchingAssets\(pack,tagSignals,window\)/);
 assert.match(source,/isUsablePackAsset\(asset,pack,signals,scene\)/);
 assert.doesNotMatch(source,/const localMatches=existing.filter\(x=>isUsablePackAsset\(x,pack,tagSignals\)\)\.length/);
});
test('display and auto search both recognize games and cookies',()=>{
 const source=fs.readFileSync(path.join(__dirname,'..','character_mixer.js'),'utf8');
 assert.match(source,/\[\['cookie','cookies','chocolate_chip_cookie'\]/);
 assert.match(source,/\[\['video_games','playing_video_games','game_controller'\]/);
});
