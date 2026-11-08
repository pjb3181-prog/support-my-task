'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const src=fs.readFileSync(path.join(__dirname,'..','character_mixer.js'),'utf8');
const a=src.indexOf('  function rewriteLegacyImageTokens(');
const b=src.indexOf('  function remapAssetReferences(',a);
assert.ok(a>0&&b>a,'legacy compatibility function exists');
const rewrite=vm.runInNewContext(
 'const str=x=>String(x??"");const asArray=x=>Array.isArray(x)?x:[];'+
 'const isPlain=x=>!!x&&typeof x==="object"&&!Array.isArray(x);'+
 src.slice(a,b)+'rewriteLegacyImageTokens');
const ctx={additionalAssets:[['Lily_baker_school_uniform_excited','assets/lily.png','png']]};
test('legacy <img="NAME> is converted to native RisuBard syntax',()=>{
 assert.equal(rewrite('<img="Lily_baker_school_uniform_excited>',{map:new Map()},ctx),'{{img::Lily_baker_school_uniform_excited}}');
});
test('legacy <img="NAME"> is converted to native syntax',()=>{
 assert.equal(rewrite('<img="Lily_baker_school_uniform_excited">',{map:new Map()},ctx),'{{img::Lily_baker_school_uniform_excited}}');
});
test('unknown image names are left untouched',()=>{
 assert.equal(rewrite('<img="unknown">',{map:new Map()},ctx),'<img="unknown">');
});
test('imported aliases resolve but do not override existing image',()=>{
 const lookup={map:new Map([['lily_baker_school_uniform_excited','B_pack_lily']])};
 assert.equal(rewrite('<img="Lily_baker_school_uniform_excited">',lookup,ctx),'{{img::Lily_baker_school_uniform_excited}}');
 assert.equal(rewrite('<img="new_lily">',{map:new Map([['new_lily','B_pack_lily']])},ctx),'{{img::B_pack_lily}}');
});
test('display hook recognizes legacy image as explicit and does not auto-append',()=>{
 assert.match(src,/\/<img\\s\*=\/i\.test\(content\)/);
 assert.match(src,/const legacyRewritten=hasAssetTag\?rewriteLegacyImageTokens/);
 assert.match(src,/if\(hasAssetTag\)return safe/);
 assert.match(src,/\/\/\@version 0\.9\.6/);
});
