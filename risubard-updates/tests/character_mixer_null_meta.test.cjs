'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const src=fs.readFileSync(path.resolve(__dirname,'../character_mixer.js'),'utf8');
test('Character Mixer parses',()=>new vm.Script(src));
test('asset module sync skips unrelated modules with null metadata',()=>{
 const start=src.indexOf('    const nextModules=oldModules.map(mod=>{',src.indexOf('  async function persistAssetToPack('));
 const end=src.indexOf('    if(!nextModules.some(',start);
 assert.ok(start>0&&end>start);
 const body=src.slice(start,end)+'return nextModules;';
 const MARK='[CHARACTER_MIXER_V1]';
 const meta={autoImages:true,targetChatId:'chat-1',sourceIds:['pack:pack-1'],externalTagAssets:[]};
 const unrelated={id:'unrelated',description:'some regular module',assets:[],lorebook:[{content:'unchanged'}]};
 const archive={id:'archive-1',assets:[]};
 const mixer={id:'mixer',description:MARK+JSON.stringify(meta),assets:[],lorebook:[]};
 const run=new Function('oldModules','archiveId','metadataOf','asArray','ctx','pack','fresh','item','name','assetPath','ext','MARK','autoCollectEnabled',
   body.replaceAll('[name,path,ext]','[name,assetPath,ext]'));
 const next=run([unrelated,archive,mixer],'archive-1',
   m=>m.description?.startsWith(MARK)?JSON.parse(m.description.slice(MARK.length)):null,
   x=>Array.isArray(x)?x:[],{chat:{id:'chat-1'}},{id:'pack-1'},
   {name:'가영',speakerAliases:[],characterKind:'original'},{tags:['smile']},
   'gelbooru_123','assets/image.png','png',MARK,true);
 assert.strictEqual(next[0],unrelated);
 assert.equal(next[1].assets.length,1);
 assert.equal(next[2].assets.length,1);
 assert.equal(JSON.parse(next[2].description.slice(MARK.length)).externalTagAssets.length,1);
});
