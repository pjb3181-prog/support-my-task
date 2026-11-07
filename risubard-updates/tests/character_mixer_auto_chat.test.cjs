'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'..','character_mixer.js'),'utf8');
test('Character Mixer script parses',()=>new vm.Script(source));
test('output listener is a committed chat output hook with permission check',()=>{
 assert.match(source,/requestPluginPermission\('replacer'\)/);
 assert.match(source,/addRisuChatListener\('output',outputListener\)/);
 assert.match(source,/removeRisuChatListener\('output',outputListener\)/);
});
test('auto bootstrap creates asset-only module and preserves original chat text',()=>{
 assert.match(source,/namespace:'character-mixer',lorebook:\[\]/);
 assert.match(source,/setChatToIndex\(current\.ci,current\.ti,newChat\)/);
 assert.match(source,/const newChat=\{\.\.\.latest,modules:/);
 assert.match(source,/rollback failed/);
});
test('auto bootstrap does not overwrite existing installed character mixer',()=>{
 assert.match(source,/installedInChat\(ctx\)\.length\)return ctx/);
 assert.match(source,/if\(current\.chat\.id!==ctx\.chat\.id\|\|installedInChat\(current\)\.length\)return current/);
});
test('committed output is filtered to the selected chat and character role',()=>{
 assert.match(source,/ctx\.chat\.id!==payload\?\.chat\?\.id/);
 assert.match(source,/\['char','assistant'\]\.includes\(str\(msg\.role\)\)/);
});
test('there is a user-visible latest-chat diagnostic',()=>{
 assert.match(source,/id="cm-diagnose"/);
 assert.match(source,/현재 채팅 자동 연결 및 최근 답변 테스트/);
 assert.match(source,/outputEventCount/);
 assert.match(source,/outputLastResult/);
});
