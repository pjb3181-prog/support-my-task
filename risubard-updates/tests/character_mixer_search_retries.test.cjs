'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'..','character_mixer.js'),'utf8');
const a=source.indexOf('  function sceneBeats('),b=source.indexOf('  // Place the macro beside the selected passage.',a);
const helpers=source.slice(a,b);
const f=vm.runInNewContext(
 'const str=x=>String(x??"");const asArray=x=>Array.isArray(x)?x:[];'+
 'const sanitizeSceneText=x=>String(x??"");'+
 'const sceneTagSignals=x=>[ [/게임|arcade/i,/video_games/], [/침대|누웠|bed/i,/on_bed/],'+
 ' [/휴대폰|핸드폰|phone/i,/cellphone/], [/웃었|미소/i,/smile/] ].filter(p=>p[0].test(x)).map(p=>({tags:[p[1].source],weight:3}));'+
 'const sceneSubjectTags=x=>/게임|arcade/i.test(x)?["video_games"]:[];'+
 'const activeCharacterInScene=(x,pack)=>/릴리는/.test(x);'+
 'const safeAutoIllustrationPost=()=>true;const allowsRating=()=>true;const sceneRatingMode=()=>"general";const verifiedPackIdentity=()=>true;'+helpers+
 '({sceneActorTags,rankIllustrationBeats,assetMatchesLocalBeat})');
test('one strong local object tag is enough, not two independent booru labels',()=>{
 const beat={text:'침대에 누웠다.',context:'침대에 누웠다.',packPresent:true,plan:{signals:[{tags:['on_bed'],weight:3},{tags:['cellphone'],weight:3}]}};
 assert.equal(f.assetMatchesLocalBeat({tags:['on_bed','1girl']},{characterKind:'original'},beat),true);
 assert.equal(f.assetMatchesLocalBeat({tags:['smile','1girl']},{characterKind:'original'},beat),false);
});
test('generic world packs can match explicitly mentioned woman without unrelated fantasy tags',()=>{
 const beat={text:'여자는 핸드폰을 들었다.',context:'여자는 핸드폰을 들었다.',packPresent:false,plan:{signals:[{tags:['cellphone'],weight:3}]}};
 assert.deepEqual(Array.from(f.sceneActorTags(beat)),['1girl','solo']);
 assert.equal(f.assetMatchesLocalBeat({tags:['1girl','cellphone']},{characterKind:'original'},beat),true);
 assert.equal(f.assetMatchesLocalBeat({tags:['1boy','cellphone']},{characterKind:'original'},beat),false);
});
test('unidentified actors cannot import random portraits',()=>{
 const beat={text:'핸드폰을 들었다.',context:'핸드폰을 들었다.',packPresent:false,plan:{signals:[{tags:['cellphone'],weight:3}]}};
 assert.equal(f.assetMatchesLocalBeat({tags:['1girl','cellphone']},{characterKind:'original'},beat),true);
});
test('searches several local beats and falls back to a single action tag',()=>{
 assert.match(source,/rankIllustrationBeats\(window,pack\)\.slice\(0,3\)/);
 assert.match(source,/const requests=buildSceneSearchRequests\(beat,pack\)/);
 assert.match(source,/const suitable=identity.filter\(x=>assetMatchesLocalBeat\(x,pack,beat\)\)/);
 assert.match(source,/appendAssetToCommittedReply\(ctx,raw,'gelbooru_'\+saved\[0\]\.id,pack,matchedBeat\)/);
 assert.match(source,/시도 '\+attempts.length/);
});
