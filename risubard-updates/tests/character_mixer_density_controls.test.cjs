'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const src=fs.readFileSync(path.join(__dirname,'..','character_mixer.js'),'utf8');
test('plugin syntax',()=>new vm.Script(src));
const da=src.indexOf('  const DENSITY_STORE='),db=src.indexOf('  let displayHistory=',da);
const store={};
const env='const risuai={pluginStorage:{getItem:async k=>store[k]??null,setItem:async(k,v)=>{store[k]=v}}};';
const density=vm.runInNewContext(env+src.slice(da,db)+
  '({normalizeDensity,parseAssetHint,loadDensitySettings,saveDensitySettings,DENSITY_DEFAULT,get:()=>densitySettings,set:x=>{densitySettings=x}})',{store,console});
test('high preset defaults to two images per reply and two collected',()=>{
 const d=density.normalizeDensity(null);
 assert.equal(d.maxAssetsPerReply,2);
 assert.equal(d.autoCollectMaxPerRun,2);
 assert.equal(d.minReplyGap,1);
});
test('custom values are bounded',()=>{
 const d=density.normalizeDensity({displayPreset:'custom',maxAssetsPerReply:99,autoCollectMaxPerRun:999,
  recentDuplicateWindow:0,searchCandidatePool:999});
 assert.equal(d.maxAssetsPerReply,5);
 assert.equal(d.autoCollectMaxPerRun,5);
 assert.equal(d.recentDuplicateWindow,0);
 assert.equal(d.searchCandidatePool,20);
});
test('Korean free-text hint changes real numeric preferences',()=>{
 const d=density.parseAssetHint('답변당 최대 3장, 수집 최대 2장, 간격 1턴');
 assert.equal(d.maxAssetsPerReply,3);
 assert.equal(d.autoCollectMaxPerRun,2);
 assert.equal(d.minReplyGap,1);
});
test('preferences are stored persistently using independent key',async()=>{
 density.set({displayPreset:'custom',maxAssetsPerReply:4,autoCollectMaxPerRun:3,minReplyGap:1});
 await density.saveDensitySettings();
 const saved=store.character_mixer_density_v1;
 assert.equal(saved.maxAssetsPerReply,4);
 assert.equal(saved.autoCollectMaxPerRun,3);
 assert.notEqual(saved.displayPreset,'high');
});
const pa=src.indexOf('  function sceneTagSignals('),pb=src.indexOf('  function contentFingerprint(',pa);
const pick=vm.runInNewContext('const str=x=>String(x??"");const asArray=x=>Array.isArray(x)?x:[];'+
  'const sanitizeSceneText=x=>x;const bounded=(v,l,h,f)=>Math.max(l,Math.min(h,Number(v)||f));'+
  src.slice(pa,pb)+'({pickTaggedAssets})');
test('two assets per reply and no duplicate selection',()=>{
 const scene='[가영] 가영은 다정하게 미소를 지으며 웃었다. 그녀는 의자에 앉아 휴식을 취했다. 바깥은 따뜻했다.';
 const cached={tagAssets:[1,2,3,4].map(i=>({name:'img_'+i,characterAliases:['가영'],
  sourceId:'pack:1',characterKind:'original',tags:['smile','sitting']}))};
 assert.deepEqual(Array.from(pick.pickTaggedAssets(scene,cached,new Set(),2)),['img_1','img_2']);
 assert.deepEqual(Array.from(pick.pickTaggedAssets(scene,cached,new Set(['img_1']),3)),['img_2','img_3','img_4']);
});
test('collection and display limits are wired to settings',()=>{
 assert.match(src,/saved\.length>=densitySettings\.autoCollectMaxPerRun/);
 assert.match(src,/pickTaggedAssets\(safe,/);
 assert.match(src,/densitySettings\.searchCandidatePool/);
 assert.match(src,/id="cm-density-save"/);
});