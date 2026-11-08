'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const src=fs.readFileSync(path.join(__dirname,'..','character_mixer.js'),'utf8');
const a=src.indexOf('  function finalSceneBeat('),b=src.indexOf('  function sceneSubjectTags(',a);
assert.ok(a>=0&&b>a);
const utils=vm.runInNewContext('const str=x=>String(x??"");const asArray=x=>Array.isArray(x)?x:[];const sanitizeSceneText=x=>String(x);'+src.slice(a,b)+'({finalSceneBeat,activeCharacterInScene,safeAutoIllustrationPost})');
const pack={name:'릴리',snapshot:{name:'릴리'},characterKind:'original',speakerAliases:[]};
test('Chapter 11 ending does not insert an image of absent Lily',()=>{
 const chapter='릴리가 개찰구 너머에서 손을 들던 모습이 떠올랐다.\n\n'+
 '릴리의 답장이었다. Yay!! Goodnight Hanseong!!\n\n'+
 '답장은 적지 않았다. 핸드폰을 충전기에 꽂고 화면을 아래로 뒤집어 놓았다.\n\n'+
 '침대에 누웠다. 천장을 봤다. 릴리가 자기 전에 인형 다섯 개에 잘 가라고 했을까.\n\n'+
 '잘 모르겠다. 물어볼 것도 아닌 것 같았다.\n\n눈을 감았다.';
 assert.equal(utils.activeCharacterInScene(chapter,pack),false);
});
test('a physically present character acting is eligible',()=>{
 assert.equal(utils.activeCharacterInScene('릴리는 웃으며 손을 흔들었다.',pack),true);
});
test('a remembered gesture does not count as live presence',()=>{
 assert.equal(utils.activeCharacterInScene('릴리가 손을 들던 모습이 떠올랐다.',pack),false);
});
test('fandom tagged artwork is not silently imported into an original character pack',()=>{
 assert.equal(utils.safeAutoIllustrationPost({tags:['1girl','shadow_(sonic)']},pack),false);
 assert.equal(utils.safeAutoIllustrationPost({tags:['1girl','smile']},pack),true);
});
test('crossover and unrelated multi-character artwork are excluded',()=>{
 assert.equal(utils.safeAutoIllustrationPost({tags:['crossover','smile']},pack),false);
 assert.equal(utils.safeAutoIllustrationPost({tags:['2girls','indoors']},pack),false);
});
test('all automatic insertion routes use their local scene instead of final-only actor checks',()=>{
 assert.match(src,/const beats=rankIllustrationBeats\(text,pack\)/);
 assert.match(src,/const beats=rankIllustrationBeats\(window,pack\)/);
 assert.match(src,/let selected=beatOverride\|\|chooseIllustrationBeat\(body,targetPack\)/);
 assert.match(src,/assetMatchesLocalBeat\(asset,pack,beat\)/);
 assert.match(src,/pack&&!safeAutoIllustrationPost\(item,pack\)/);
});
