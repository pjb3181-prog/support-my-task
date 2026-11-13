'use strict';
// Local OpenAI-compatible stub. Logs every request (time, stream flag, tokens seen) to llm_stub.log.jsonl.
const http = require('http'), fs = require('fs'), path = require('path');
const LOG = process.env.STUB_LOG || path.join(process.cwd(), 'llm_stub.log.jsonl');
let n = 0;
function textOf(m) { return typeof m.content === 'string' ? m.content : JSON.stringify(m.content); }
http.createServer((req, res) => {
  let body = '';
  req.on('data', c => body += c);
  req.on('end', () => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', '*');
    res.setHeader('Access-Control-Allow-Methods', '*');
    if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }
    if (req.method === 'GET' && req.url.startsWith('/file/')) {
      const f = path.join(path.resolve(__dirname, '..', '..'), path.basename(decodeURIComponent(req.url.slice(6))));
      try { const b = fs.readFileSync(f); res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' }); return res.end(b); } catch { res.writeHead(404); return res.end('nf'); }
    }
    if (req.method === 'GET' && req.url.startsWith('/log')) { res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' }); return res.end(fs.existsSync(LOG) ? fs.readFileSync(LOG, 'utf8') : ''); }
    if (req.method === 'GET') { res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify({ data: [{ id: 'stub' }] })); }
    let j = {}; try { j = JSON.parse(body || '{}'); } catch {}
    const msgs = j.messages || [];
    const all = msgs.map(textOf).join('\n');
    const callTok = (all.match(/\[\[RISUBARD_INTERNAL_CALL:[^\]]+\]\]/) || [])[0] || null;
    const resTok = (all.match(/\[\[RISUBARD_INTERNAL_RESULT:[^\]]+\]\]/) || [])[0] || null;
    const id = ++n;
    fs.appendFileSync(LOG, JSON.stringify({ id, t: Date.now(), url: req.url, stream: !!j.stream, callTok, resTok, nmsg: msgs.length, head: all.slice(0, 160).replace(/\n/g, ' '), tail: all.slice(-200).replace(/\n/g, ' ') }) + '\n');
    let rbody = callTok ? '내부 호출 응답 #' + id + ' (JSON 아님).' : '비가 내리던 밤, 그는 천천히 창가로 걸어갔다. 스트리밍 응답 본문 #' + id + '.';
    if (/strict fiction critic/.test(all)) rbody = '{"revise":true,"issues":["테스트용 결함: 장면 전환이 급함"]}';
    else if (/revising a Korean fiction draft/.test(all)) rbody = '<SR_STORY>비가 내리던 밤, 그는 천천히 창가로 걸어갔다. [다듬어진 재작성 본문 #' + id + ']</SR_STORY>';
    const reply = (resTok ? resTok + '\n' : '') + rbody;
    if (j.stream) {
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
      const parts = reply.match(/.{1,8}/gs) || [reply];
      let i = 0;
      const tick = () => {
        if (i < parts.length) {
          res.write('data: ' + JSON.stringify({ choices: [{ index: 0, delta: { content: parts[i++] } }] }) + '\n\n');
          setTimeout(tick, 120);
        } else { res.write('data: [DONE]\n\n'); res.end(); }
      };
      tick();
    } else {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ id: 'x' + id, object: 'chat.completion', choices: [{ index: 0, message: { role: 'assistant', content: reply }, finish_reason: 'stop' }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } }));
    }
  });
}).listen(6200, '127.0.0.1', () => console.log('stub on 6200'));
