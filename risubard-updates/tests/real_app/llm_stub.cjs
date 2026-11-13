'use strict';
// Local OpenAI-compatible model stub for isolated real-app verification (NOT used by `node --test`).
//   node llm_stub.cjs           -> listens on 127.0.0.1:6200
//   GET  /file/<name>           -> serves a plugin file from risubard-updates/ (for installing into a test instance)
//   GET  /log                   -> request log (JSONL)   POST /ctl {...} -> change scenario (merged, persists)
//   POST /v1/chat/completions   -> scripted reply chosen from the prompt text + current scenario
// Scenario (POST /ctl): main:'long'|'short', mainChars, srCritic:'ok'|'revise'|'garbage', bard:'ok'|'revise',
//   memory:'empty'|'valid'|'poison' (BardWiki memory-writer reply), echo:'follow'|'drop'|'mangle', chunk, delayMs (streaming), mainDelayMs, auxDelayMs (critic/writer/editor latency), tag
const http = require('http'), fs = require('fs'), path = require('path');
const LOG = process.env.STUB_LOG || path.join(process.cwd(), 'llm_stub.log.jsonl');
const ROOT = path.resolve(__dirname, '..', '..');
let n = 0;
let cfg = { main: 'long', mainChars: 1200, srCritic: 'revise', bard: 'revise', echo: 'follow', chunk: 8, delayMs: 120, mainDelayMs: 0, auxDelayMs: 0, tag: '' };

const SENT = [
  '비가 내리던 밤, 그는 천천히 창가로 걸어갔다.', '유리창에 맺힌 물방울이 가로등 불빛을 받아 흐릿하게 번졌다.',
  '"이렇게 늦은 시간에 어디를 가려던 거야?" 그녀가 낮은 목소리로 물었다.', '그는 대답 대신 오래된 열쇠를 탁자 위에 내려놓았다.',
  '열쇠에는 지워지다 만 이름이 새겨져 있었고, 그녀는 그것이 누구의 것인지 곧바로 알아보았다.', '"그건 네가 가져가면 안 되는 물건이야." 그녀의 목소리가 조금 떨렸다.',
  '복도 끝에서 마루가 삐걱거리는 소리가 들렸고, 두 사람은 동시에 숨을 죽였다.', '그는 천천히 고개를 돌려 문 쪽을 바라본 뒤 조용히 말했다. "아직은 아무에게도 말하지 마."',
  '그녀는 대꾸하지 않고 찻잔을 두 손으로 감싸 쥐었다. 식어 가는 차의 온기가 손바닥에 남았다.', '창밖에서는 빗줄기가 점점 굵어졌고, 멀리서 기차가 지나가는 소리가 낮게 깔렸다.',
];
function longText(chars, seed) {
  let out = '', i = 0;
  while (out.length < chars) { out += SENT[i % SENT.length] + (i % 4 === 3 ? '\n\n' : ' '); i++; }
  return out.slice(0, chars).trim() + ' (본문 ' + seed + ')';
}
const textOf = m => (typeof m.content === 'string' ? m.content : JSON.stringify(m.content));
const after = (s, marker) => { const k = s.lastIndexOf(marker); return k < 0 ? '' : s.slice(k + marker.length); };
const log = o => fs.appendFileSync(LOG, JSON.stringify(o) + '\n');

http.createServer((req, res) => {
  let body = '';
  req.on('data', c => body += c);
  req.on('end', async () => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', '*');
    res.setHeader('Access-Control-Allow-Methods', '*');
    if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }
    if (req.method === 'GET' && req.url.startsWith('/file/')) {
      const base = path.basename(decodeURIComponent(req.url.slice(6)));
      const f = [path.join(ROOT, base), path.join(__dirname, base)].find(p => fs.existsSync(p)) || path.join(ROOT, base);
      try { const b = fs.readFileSync(f); res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' }); return res.end(b); } catch { res.writeHead(404); return res.end('nf'); }
    }
    if (req.method === 'GET' && req.url.startsWith('/log')) { res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' }); return res.end(fs.existsSync(LOG) ? fs.readFileSync(LOG, 'utf8') : ''); }
    if (req.method === 'POST' && req.url.startsWith('/ctl')) {
      try { cfg = { ...cfg, ...JSON.parse(body || '{}') }; } catch {}
      log({ ctl: cfg, t: Date.now() });
      res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify(cfg));
    }
    if (req.method === 'GET') { res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify({ data: [{ id: 'stub' }] })); }
    let j = {}; try { j = JSON.parse(body || '{}'); } catch {}
    const msgs = j.messages || [];
    const all = msgs.map(textOf).join('\n');
    const callTok = (all.match(/\[\[RISUBARD_INTERNAL_CALL:[^\]]+\]\]/) || [])[0] || null;
    const resTok = (all.match(/\[\[RISUBARD_INTERNAL_RESULT:[^\]]+\]\]/) || [])[0] || null;
    const id = ++n;
    let kind = 'main', rbody;
    if (/strict fiction critic/.test(all)) {
      kind = 'sr-critic';
      rbody = cfg.srCritic === 'ok' ? '{"revise":false,"issues":[]}' : cfg.srCritic === 'garbage' ? '비평가가 JSON 대신 잡담을 했다.' : '{"revise":true,"issues":["테스트용 결함: 장면 전환이 급함"]}';
    } else if (/revising a Korean fiction draft/.test(all)) {
      kind = 'sr-writer';
      const src = after(all, '# DRAFT\n').split('\n\n# ')[0];
      rbody = '<SR_STORY>' + src.replace('천천히', '느릿하게') + '</SR_STORY>';
    } else if (/professional Korean-fiction dialogue, characterization and scene editor/.test(all)) {
      kind = 'bard-diagnostic';
      const src = after(all, '# FINISHED DRAFT TO REVIEW\n');
      const ex = src.slice(0, 18);
      rbody = cfg.bard === 'ok' ? '{"revise":false,"characterFidelity":{"status":"faithful","evidence":"x","justification":"x"},"sceneProgress":{"material":true,"evidence":"x","intentionalStillness":false},"issues":[]}'
        : JSON.stringify({ revise: true, characterFidelity: { status: 'faithful', evidence: 'x', justification: 'x' }, sceneProgress: { material: true, evidence: 'x', intentionalStillness: false }, issues: [{ excerpt: ex, problem: '테스트용 문장 리듬 문제', instruction: '부사를 다듬을 것' }] });
    } else if (/surgical Korean-fiction editor/.test(all)) {
      kind = 'bard-revision';
      rbody = after(all, '# ORIGINAL DRAFT\n').replace('천천히', '조용히');
    } else if (/bardwiki-memory-writer/.test(all) && cfg.memory && cfg.memory !== 'empty') {
      kind = 'bardwiki-' + cfg.memory;
      const cand = (title, type) => ({ type, title, reason: '등장', action: 'create', targetDocumentId: null, confidence: 0.95 });
      const list = [cand('카이', 'character'), cand('리나', 'character'), cand('도윤', 'character'), cand('서하', 'character'), cand('하준', 'character')];
      if (cfg.memory === 'poison') list.push(cand('큰 전투', 'event'));
      rbody = JSON.stringify({ schemaVersion: 1, title: '만남', establishedEvents: ['여섯 명이 만났다.'], stateChanges: [], characterKnowledge: [], persistentFacts: [], openContinuity: [], canonicalUpdateCandidates: list });
    } else if (/CONTINUITY READER|STRICT INDEPENDENT Korean fiction|bardwiki-memory-writer/.test(all)) {
      kind = 'aux';
      rbody = '{}';
    } else if (callTok) {
      kind = 'internal';
      rbody = '내부 호출 응답 #' + id + ' (JSON 아님).';
    } else {
      rbody = cfg.main === 'short' ? '비가 내리던 밤, 그는 천천히 창가로 걸어갔다. 짧은 본문 #' + id + '.' : longText(cfg.mainChars, '#' + id);
    }
    let reply = rbody;
    if (resTok && cfg.echo !== 'drop') reply = (cfg.echo === 'mangle' ? resTok.replace('RESULT', 'RESLT') : resTok) + '\n' + rbody;
    log({ id, t: Date.now(), kind, stream: !!j.stream, callTok, resTok, nmsg: msgs.length, replyChars: reply.length, tag: cfg.tag, head: all.slice(0, 100).replace(/\n/g, ' ') });
    if (kind === 'main' && cfg.mainDelayMs) await new Promise(r => setTimeout(r, cfg.mainDelayMs));
    if (/^(sr-|bard-)/.test(kind) && cfg.auxDelayMs) await new Promise(r => setTimeout(r, cfg.auxDelayMs));
    if (j.stream) {
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
      const size = Math.max(1, cfg.chunk);
      let i = 0;
      const tick = () => {
        if (i < reply.length) {
          res.write('data: ' + JSON.stringify({ choices: [{ index: 0, delta: { content: reply.slice(i, i + size) } }] }) + '\n\n');
          i += size;
          setTimeout(tick, cfg.delayMs);
        } else { log({ id, t: Date.now(), kind, streamEnd: true }); res.write('data: [DONE]\n\n'); res.end(); }
      };
      tick();
    } else {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ id: 'x' + id, object: 'chat.completion', choices: [{ index: 0, message: { role: 'assistant', content: reply }, finish_reason: 'stop' }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } }));
    }
  });
}).listen(6200, '127.0.0.1', () => console.log('stub on 6200'));
