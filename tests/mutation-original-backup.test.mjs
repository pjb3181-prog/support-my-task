import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source=fs.readFileSync(new URL('../risubard-updates/mutation_state.ts', import.meta.url),'utf8');
assert.match(source,/\/\/@version 0\.79\.4/);
function slice(a,b){
  const i=source.indexOf(a),j=source.indexOf(b,i+a.length);
  if(i<0||j<=i)throw Error('Missing function text: '+a+' to '+b);
  return source.slice(i,j);
}
const impl=[
  slice('  function pristineCharacterEvidence(', '  async function writeModeSurface('),
  slice('  async function ensureDirectMutationBackups(', '  async function restoreOriginalFirstMessage('),
].join('\n\n');
const original={
  desc:'Original description',personality:'Original personality',scenario:'Original scenario',
  firstMessage:'<buttons>Choose first message</buttons>',
  exampleMessage:'Original example',alternateGreetings:[],globalLore:[{comment:'original',content:'normal lore'}]
};
function fixture({owner=null,meta=null,world= [{id:'mutation-world-global-unrelated'}],
  char=original,vault=null,backup=null,reason=null}={}){
  const t={characterId:'C1',chatId:'T1',characterName:'Character',characterIndex:0,chatIndex:0};
  const map=new Map();
  if(owner)map.set('owner_C1',owner);
  if(meta)map.set('meta_C1',meta);
  if(vault)map.set('vault_C1_original',vault);
  if(backup)map.set('backup_C1',backup);
  const live={schema:1,mode:'',character:structuredClone(char),
    charMeta:meta,world:{modules:structuredClone(world),enabledIds:world.map(x=>x.id)}};
  const API={
    pluginStorage:{
      getItem:async k=>structuredClone(map.get(k)??null),
      setItem:async(k,v)=>{map.set(k,structuredClone(v))}
    }
  };
  const ctx={
    risuai:API,
    DIRECT_CHAR_BACKUP_PREFIX:'backup_',
    DIRECT_CHAR_META_PREFIX:'meta_',
    DIRECT_CHAT_BACKUP_PREFIX:'chatbackup_',
    MODE_RESCUE_PREFIX:'rescue_',
    modeVaultKey:(t,m)=>'vault_'+t.characterId+'_'+m,
    modeOwnerKey:t=>'owner_'+t.characterId,
    captureModeSurface:async()=>structuredClone(live),
    originalLeakMatch: value=>value.includes('상식개변사회')?'상식개변사회':'',
    isGeneratedNativeWorldLore:value=>Boolean(value&&value.comment==='generated'),
    cleanLoreForDirectRewrite:v=>structuredClone(v||[]),
    cloneJson:v=>structuredClone(v),
    text:v=>typeof v==='string'?v:'',
    console,Date
  };
  vm.runInNewContext(impl+'\nglobalThis.testFns={modeOriginalSurface,ensureDirectMutationBackups,originalRecoveryDiagnostics,verifiedOriginalVault,pristineCharacterEvidence};',ctx,{timeout:10000});
  return {t,live,map,ctx,fn:ctx.testFns};
}
const validVault={schema:1,mode:'original',savedAt:123,
  character:structuredClone(original),charMeta:null,world:{modules:[],enabledIds:[]}};
let count=0;
async function scenario(label,act){await act();console.log('OK '+(++count)+' '+label)}
await scenario('new untouched character is not blocked by global shared Mutation module',async()=>{
  const x=fixture();const r=await x.fn.modeOriginalSurface(x.t);
  assert.equal(r.character.firstMessage,original.firstMessage);
  assert.equal(x.map.get('backup_C1').sharedWorldModulesAtCapture,1);
  assert.deepEqual(JSON.parse(JSON.stringify(r.world)),{modules:[],enabledIds:[]});
});
await scenario('real common-mode owner without source backup is blocked',async()=>{
  const x=fixture({owner:{mode:'common'}});
  await assert.rejects(x.fn.modeOriginalSurface(x.t),/원본 백업이 없어/);
  assert.equal(x.map.has('backup_C1'),false);
});
await scenario('legacy applied mutation meta prevents unsafe live snapshot',async()=>{
  const x=fixture({meta:{appliedAt:123}});
  await assert.rejects(x.fn.modeOriginalSurface(x.t),/침식 적용/);
  assert.equal(x.map.has('backup_C1'),false);
});
await scenario('new character with merely suspicious prose is not silently trusted',async()=>{
  const x=fixture({char:{...original,scenario:'세계는 상식개변사회다.'}});
  await assert.rejects(x.fn.modeOriginalSurface(x.t),/개변 의심 표현/);
  const report=await x.fn.originalRecoveryDiagnostics(x.t);
  assert.equal(report.evidence.keywordOnly,true);
});
await scenario('recover exact valid original from prior original-mode vault',async()=>{
  const x=fixture({owner:{mode:'common'},meta:{appliedAt:456},
    char:{...original,desc:'current mutated'},vault:validVault});
  const r=await x.fn.modeOriginalSurface(x.t);
  assert.equal(r.character.desc,'Original description');
  assert.equal(x.map.get('backup_C1').recoveredFrom,'verified-original-mode-vault');
  assert.equal(x.live.character.desc,'current mutated'); // no live write
});
await scenario('polluted vault is never used to replace an absent original',async()=>{
  const badVault={...validVault,world:{modules:[{id:'mutation-world-global-foo'}],enabledIds:['mutation-world-global-foo']}};
  const x=fixture({owner:{mode:'common'},vault:badVault});
  await assert.rejects(x.fn.modeOriginalSurface(x.t),/원본 백업이 없어/);
  assert.equal(x.map.has('backup_C1'),false);
});
await scenario('safe original path seeds backup before mutation compilation',async()=>{
  const x=fixture({world:[{id:'mutation-world-global-other-character'}]});
  await x.fn.ensureDirectMutationBackups({},{localLore:[]},x.t);
  assert.equal(x.map.get('backup_C1').desc,original.desc);
  assert.ok(x.map.has('chatbackup_C1_T1'));
});
await scenario('compilation refuses to reseed from already mutated live data',async()=>{
  const x=fixture({owner:{mode:'common'}});
  await assert.rejects(x.fn.ensureDirectMutationBackups({},{localLore:[]},x.t),/원본 백업이 없어/);
  assert.equal(x.map.has('chatbackup_C1_T1'),false);
});
await scenario('backup diagnostics read only',async()=>{
  const x=fixture({world:[{id:'mutation-world-global-other'}]});
  const before=x.map.size;
  const r=await x.fn.originalRecoveryDiagnostics(x.t);
  assert.match(r.text,/공용 Mutation World 모듈: 1개/);
  assert.match(r.text,/자동|해결/);
  assert.equal(x.map.size,before);
});
console.log('Mutation State original-backup regression: '+count+' cases passed');
