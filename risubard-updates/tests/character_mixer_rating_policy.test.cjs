'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const src=fs.readFileSync(path.join(__dirname,'..','character_mixer.js'),'utf8');
const a=src.indexOf('  function canonicalRating(');
const b=src.indexOf('  async function searchViaLocalBridge(',a);
assert.ok(a>0&&b>a,'rating helpers must be present');
const get=vm.runInNewContext('const str=x=>String(x??""); let densitySettings={ratingPolicy:"general"};'+src.slice(a,b)+'({canonicalRating,allowsRating,sceneRatingMode,sceneAdultEligible,setPolicy:x=>{densitySettings.ratingPolicy=x}})');
test('general is the default and all booru rating aliases are normalized',()=>{
 assert.equal(get.sceneRatingMode('성관계 장면'), 'general');
 for(const [tag,expected] of [['g','general'],['s','sensitive'],['q','questionable'],['e','explicit'],['safe','general'],['explicit','explicit']])
   assert.equal(get.canonicalRating(tag),expected);
 assert.equal(get.canonicalRating('unknown'),'');
});
test('rating filter is opt-in and fails closed for missing values',()=>{
 assert.equal(get.allowsRating('e','general'),false);
 assert.equal(get.allowsRating('g','general'),true);
 assert.equal(get.allowsRating('e','all'),true);
 assert.equal(get.allowsRating('q','all'),true);
 assert.equal(get.allowsRating('unknown','all'),false);
});
test('scene-aware mode allows adult ratings only for explicit adult context',()=>{
 get.setPolicy('scene_adult');
 assert.equal(get.sceneRatingMode('그는 침대에서 잠을 잤다.'),'general');
 assert.equal(get.sceneRatingMode('성인들이 성관계를 했다.'),'all');
 assert.equal(get.sceneRatingMode('고등학생이 성관계를 했다.'),'general');
});
test('all-ratings setting rejects underage automated contexts',()=>{
 get.setPolicy('all');
 assert.equal(get.sceneRatingMode('그는 침대에 누웠다.'),'all');
 assert.equal(get.sceneRatingMode('미성년 성관계'),'general');
});
test('bridge, external query and both providers apply same rating policy',()=>{
 assert.match(src,/parseBooruPosts\(raw,ratingMode\)/);
 assert.match(src,/parseBooruPosts\(await readBooruJson\(response,'Gelbooru'\),ratingMode\)/);
 assert.match(src,/parseDanbooruPosts\(await readBooruJson\(response,'Danbooru'\),ratingMode\)/);
 assert.match(src,/searchViaLocalBridge\(userTags,limit,page,ratingMode\)/);
 assert.match(src,/searchBooruWithFallback\(tags,densitySettings.searchCandidatePool,0,beat.context\)/);
});
test('the UI includes explicit opt-in and persists the setting',()=>{
 assert.match(src,/id="cm-rating-policy"/);
 assert.match(src,/ratingPolicy:str\(e.target.value\)/);
 assert.match(src,/ratingPolicy:\s*'general'/);
 assert.match(src,/await saveDensitySettings\(\)/);
});
