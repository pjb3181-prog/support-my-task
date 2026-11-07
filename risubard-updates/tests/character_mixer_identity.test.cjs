'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'..','character_mixer.js'),'utf8');
const begin=source.indexOf('  function inferCharacterIdentity(');
const end=source.indexOf('  async function autoIdentifyPack(',begin);
assert.ok(begin>=0&&end>begin);
const context={
  URLSearchParams,risuai:{nativeFetch:async()=>({ok:true,json:async()=>({tag:[{name:'boa_hancock_(one_piece)',type:4,count:500}]})})}
};
const script='const str=x=>String(x??"");const asArray=x=>Array.isArray(x)?x:[];const clip=(v,n)=>str(v).trim().slice(0,n);let externalApiKey="",externalUserId="";\n'+source.slice(begin,end)+'\n({detectIdentityFromSources,inferCharacterIdentity})';
const funcs=vm.runInNewContext(script,context);
test('full plugin syntax',()=>{new vm.Script(source)});
test('explicit named work: fanwork',async()=>{const r=await funcs.detectIdentityFromSources({name:'가영',desc:'원작: 이누야샤'});assert.equal(r.kind,'fanwork');assert.equal(r.work,'이누야샤')});
test('explicit OC: original',async()=>{const r=await funcs.detectIdentityFromSources({name:'가영',desc:'오리지널 캐릭터'});assert.equal(r.kind,'original')});
test('same-name ambiguity: unknown',async()=>{const r=await funcs.detectIdentityFromSources({name:'가영',desc:'평범한 학생'});assert.equal(r.kind,'unknown')});
test('character and franchise external tag corroboration',async()=>{const r=await funcs.detectIdentityFromSources({name:'Boa Hancock (One Piece)'});assert.equal(r.kind,'fanwork');assert.equal(r.work,'One Piece')});
test('conflicting source evidence: unknown',async()=>{const r=await funcs.detectIdentityFromSources({name:'가영',desc:'원작: 이누야샤\\n오리지널 캐릭터'});assert.equal(r.kind,'unknown')});
