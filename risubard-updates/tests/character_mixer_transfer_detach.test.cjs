'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const src=fs.readFileSync(path.join(__dirname,'..','character_mixer.js'),'utf8');
test('plugin still parses',()=>new vm.Script(src));
test('all three saveAsset calls transfer copies, never originals',()=>{
 assert.match(src,/saveAsset\(new Uint8Array\(raw\)\)/);
 assert.equal((src.match(/saveAsset\(new Uint8Array\(bytes\)\)/g)||[]).length,2);
 assert.doesNotMatch(src,/saveAsset\(bytes\)/);
 assert.doesNotMatch(src,/saveAsset\(raw\)/);
});
test('transferred Uint8Array is detached while retained original can be verified',()=>{
 const source=Uint8Array.from([137,80,78,71,13,10,26,10,0,0,0,0]);
 const sent=new Uint8Array(source);
 const received=structuredClone(sent,{transfer:[sent.buffer]});
 assert.equal(sent.byteLength,0);
 assert.equal(source.byteLength,12);
 assert.deepEqual(Array.from(received),Array.from(source));
 // The old direct call to saveAsset(source) would detach the array compared after save.
 const old=Uint8Array.from(source);
 structuredClone(old,{transfer:[old.buffer]});
 assert.equal(old.length,0);
});
test('after-save readback validation still exists',()=>{
 assert.match(src,/verified\.length!==bytes\.length/);
 assert.match(src,/verified\[i\]!==bytes\[i\]/);
 assert.match(src,/check\.length!==raw\.length/);
});
