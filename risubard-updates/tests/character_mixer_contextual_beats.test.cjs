'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const src=fs.readFileSync(path.join(__dirname,'..','character_mixer.js'),'utf8');
const start=src.indexOf('  function sceneBeats('),end=src.indexOf('  function sceneSubjectTags(',start);
assert.ok(start>0&&end>start);
const helpers=src.slice(start,end);
const context=vm.runInNewContext(
 'const str=x=>String(x??"");const asArray=x=>Array.isArray(x)?x:[];'+
 'const sanitizeSceneText=x=>String(x??"").trim();'+
 'const sceneTagSignals=x=>{const tags=[];'+
 'if(/침대|bed|누웠|sleep/i.test(x))tags.push({tags:["on_bed","lying"],weight:3});'+
 'if(/핸드폰|phone/i.test(x))tags.push({tags:["cellphone"],weight:3});'+
 'if(/게임|arcade/i.test(x))tags.push({tags:["video_games"],weight:3});'+
 'if(/대화|말했|talk/i.test(x))tags.push({tags:["talking"],weight:3});'+
 'return tags};'+
 'const sceneSubjectTags=x=>/게임/.test(x)?["video_games"]:[];'+
 'const activeCharacterInScene=(x,pack)=>x.includes(pack.name+"는")||x.includes(pack.name+"가");'+
 'const safeAutoIllustrationPost=()=>true;'+
 'const allowsRating=()=>true;const sceneRatingMode=()=>"general";'+
 'const verifiedPackIdentity=()=>true;'+
 helpers+'({sceneBeats,chooseIllustrationBeat,insertImageAtBeat,assetMatchesLocalBeat})');
const pack={name:'릴리',characterKind:'original'};
test('choose an active arcade beat rather than the end of a long chapter',()=>{
 const chapter='릴리는 게임에서 이겼다. 게임 센터에서 크게 웃었다.\n\n'+
   '한성은 혼자 집으로 돌아왔다.\n\n핸드폰을 내려놓고 침대에 누웠다.\n\n눈을 감았다.';
 const beat=context.chooseIllustrationBeat(chapter,pack);
 assert.ok(beat);
 assert.match(beat.text,/게임/);
 assert.ok(beat.end<chapter.length);
 const result=context.insertImageAtBeat(chapter,'gelbooru_123',beat);
 assert.match(result,/게임 센터에서 크게 웃었다\.\n\n\{\{img::gelbooru_123\}\}/);
 assert.ok(result.indexOf('{{img::gelbooru_123}}')<result.indexOf('한성은 혼자'));
});
test('local context matches phone on bed instead of earlier arcade',()=>{
 const chapter='게임을 했다.\n\n'+
   '그는 핸드폰을 내려놓고 침대에 누웠다.\n\n눈을 감았다.';
 const beats=context.sceneBeats(chapter);
 const bed=beats.find(x=>x.text.includes('침대'));
 assert.ok(bed);
 assert.ok(context.assetMatchesLocalBeat({tags:['cellphone','on_bed','1boy']},pack,{...bed,packPresent:true,plan:{signals:[{tags:['cellphone'],weight:3},{tags:['on_bed'],weight:3}]}}));
 assert.equal(context.assetMatchesLocalBeat({tags:['video_games']},pack,{...bed,packPresent:true,plan:{signals:[{tags:['cellphone'],weight:3},{tags:['on_bed'],weight:3}]}}),false);
});
test('scene-only fallback rejects a random character portrait',()=>{
 const beat={packPresent:false,plan:{signals:[{tags:['on_bed'],weight:3},{tags:['indoors'],weight:2}]}};
 assert.equal(context.assetMatchesLocalBeat({tags:['1girl','on_bed','indoors']},pack,beat),false);
 assert.equal(context.assetMatchesLocalBeat({tags:['no_humans','on_bed','indoors']},pack,beat),true);
});
test('insertion preserves original text and inserts native macro once',()=>{
 const body='대화했다.\n\n릴리는 말했어.\n\n나중에 떠났다.';
 const pos=body.indexOf('릴리는 말했어.')+'릴리는 말했어.'.length;
 const next=context.insertImageAtBeat(body,'gelbooru_777',{end:pos});
 assert.equal(next.replace('\n\n{{img::gelbooru_777}}',''),body);
 assert.equal((next.match(/gelbooru_777/g)||[]).length,1);
});
test('committed messages use contextual chosen beat rather than end append',()=>{
 assert.match(src,/const selected=chooseIllustrationBeat\(body,targetPack\)/);
 assert.match(src,/const inserted=insertImageAtBeat\(body,assetName,selected\)/);
 assert.match(src,/const beat=chooseIllustrationBeat\(window,pack\)/);
 assert.match(src,/const beat=chooseIllustrationBeat\(text,pack\)/);
 assert.match(src,/const base=!beat.packPresent\?'no_humans '/);
});
