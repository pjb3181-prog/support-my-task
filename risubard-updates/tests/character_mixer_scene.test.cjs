'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const source = fs.readFileSync(path.resolve(__dirname, '../character_mixer.js'), 'utf8');
test('plugin syntax is valid', () => { new vm.Script(source); });
const begin = source.indexOf('  function sceneTagSignals(');
const end = source.indexOf('  async function displayAssetCompatibility(', begin);
assert.ok(begin >= 0 && end > begin);
const script = 'const str=x=>String(x??""); const asArray=x=>Array.isArray(x)?x:[];\n'
  + source.slice(begin,end) + '\npickTaggedAsset';
const pick = vm.runInNewContext(script);
const prefix = '[한성]\n그녀는 잠깐 고개를 들고 주변을 둘러보았다. 가게에는 몇몇 손님이 있었고 차분한 음악이 흘러나왔다. ';
const pool = (kind, rows, sourceId='pack:one') => ({tagAssets:rows.map(([name,tags])=>({
  name,tags,sourceId,characterKind:kind,characterAliases:['한성']
}))});
test('original character uses mood-matched scene asset', () => {
  assert.equal(pick(prefix+'그녀는 활짝 미소를 지었다.',pool('original',[['smile_img',['smile']]])),
    '{{img::smile_img}}');
});
test('original character may use posture without identity tag', () => {
  assert.equal(pick(prefix+'그녀는 의자에 앉아서 기다렸다.',pool('original',[['seated',['sitting']]])),
    '{{img::seated}}');
});
test('fanwork does not substitute pose-only image', () => {
  assert.equal(pick(prefix+'그녀는 의자에 앉아서 기다렸다.',pool('fanwork',[['seated',['sitting']]])),'');
});
test('fanwork keeps emotion matching', () => {
  assert.equal(pick(prefix+'그녀는 미소를 지었다.',pool('fanwork',[['smile_img',['smile']]])),
    '{{img::smile_img}}');
});
test('original character does not select unrelated image', () => {
  assert.equal(pick(prefix+'그녀가 문으로 걸어갔다.',pool('original',[['smile_img',['smile']]])),'');
});
test('existing explicit image tag is never overridden', () => {
  assert.equal(pick(prefix+'미소를 지었다. {{img::existing}}',pool('original',[['smile_img',['smile']]])),'');
});
test('multiple original packs without named speaker are ambiguous', () => {
  const one=pool('original',[['one',['sitting']]],'pack:a').tagAssets;
  const two=pool('original',[['two',['sitting']]],'pack:b').tagAssets;
  assert.equal(pick('그녀는 의자에 앉아서 기다렸다. 시간이 흘러 주변은 고요해졌다. 대화는 잠시 멈췄다.',{tagAssets:[...one,...two]}),'');
});
