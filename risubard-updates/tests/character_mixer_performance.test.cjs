'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'..','character_mixer.js'),'utf8');
test('ordinary chat messages bypass async display processing regardless of automatic collection',()=>{
 assert.match(source,/if\(!hasAssetTag&&!\/\\\[[^\n]+return content;/);
 assert.doesNotMatch(source,/if\(!hasAssetTag&&!\/\\\[[^\n]+&&\!autoCollectEnabled\)return content/);
});
test('chat generation is not awaited by the plugin image listener',()=>{
 assert.match(source,/outputListener=arg=>\{void onCommittedChatOutput\(arg\);\}/);
 assert.doesNotMatch(source,/outputListener=async arg=>onCommittedChatOutput/);
});
test('automatic queries and storage have hard budget limits',()=>{
 assert.match(source,/const MAX_AUTO_SEARCH_CALLS=2;/);
 assert.match(source,/if\(saved.length>=1\|\|searchCalls>=MAX_AUTO_SEARCH_CALLS\)break;/);
 assert.match(source,/if\(saved.length>=1\)break;/);
 assert.match(source,/searchCalls\+\+;/);
});
test('repeat output events are deduplicated and bounded',()=>{
 assert.match(source,/const processedOutputTurns=new Map\(\)/);
 assert.match(source,/if\(processedOutputTurns.get\(key\)===signature\)return;/);
 assert.match(source,/if\(processedOutputTurns.size>120\)/);
});
test('asset fingerprint scans are bounded, reused by local beat, and avoid unnecessary binary reads',()=>{
 assert.match(source,/const MAX_AUTO_ASSET_SCANS=8;/);
 assert.match(source,/if\(asset.fingerprint\)\{seen.add\(asset.fingerprint\);continue;\}/);
 assert.match(source,/const checkedBeats=new Map\(\)/);
 assert.match(source,/checkedBeats.set\(beat.index,distinct\)/);
});
test('image preview cache prevents repeated reads and bounds memory',()=>{
 assert.match(source,/const imagePreviewCache=new Map\(\)/);
 assert.match(source,/if\(imagePreviewCache.has\(path\)\)return imagePreviewCache.get\(path\).data;/);
 assert.match(source,/if\(imagePreviewCache.size>4\)/);
 assert.match(source,/imagePreviewCache.clear\(\)/);
 assert.match(source,/\.slice\(-4\):\[\]/);
});
