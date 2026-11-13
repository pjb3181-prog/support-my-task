//@name token_probe
//@display-name Token Probe
//@api 3.0
//@version 0.0.1
//@description Test-only plugin for isolated real-app runs. Issues one internal model call shaped exactly like World Editor Lab's ai() (per-call CALL token in the system prompt, a request to echo the RESULT token) when the page writes a command into pluginStorage, and stores what came back. NOT part of any release.
(async () => {
  const R = risuai;
  const CMD = 'probe_cmd', OUT = 'probe_out';
  let busy = false;
  async function readAll(r) {
    if (r && r.type === 'streaming' && r.result && r.result.getReader) {
      const reader = r.result.getReader(); let text = '';
      while (true) { const p = await reader.read(); if (p.done) break; const v = typeof p.value === 'string' ? p.value : Object.values(p.value || {}).find(x => typeof x === 'string'); if (typeof v === 'string') text = v.startsWith(text) ? v : text + v; }
      return text;
    }
    return r && typeof r.result === 'string' ? r.result : '';
  }
  async function tick() {
    if (busy) return;
    let c; try { c = await R.pluginStorage.getItem(CMD); } catch (_) { return; }
    if (!c || c.started) return;
    busy = true;
    try {
      await R.pluginStorage.setItem(CMD, { ...c, started: Date.now() });
      const id = 'probe-' + c.id;
      const echo = '[[RISUBARD_INTERNAL_RESULT:' + id + ']]';
      const system = 'You are a Korean interactive worldbuilding design partner. Discuss the user ideas.'
        + '\n[[RISUBARD_INTERNAL_CALL:' + id + ']]\nBegin your reply with this exact line, then continue as instructed: ' + echo;
      const t0 = Date.now();
      let r, text = '', err = '';
      try { r = await R.runLLMModel({ mode: 'model', messages: [{ role: 'system', content: system }, { role: 'user', content: '세계관을 어떻게 바꿀지 논의하자' }], allowPlugins: false }); text = await readAll(r); }
      catch (e) { err = String((e && e.message) || e); }
      await R.pluginStorage.setItem(OUT, { id: c.id, type: r && r.type, text, hasResultToken: text.includes('[[RISUBARD_INTERNAL_RESULT:'), err, ms: Date.now() - t0 });
    } finally { busy = false; }
  }
  const timer = setInterval(() => { void tick(); }, 400);
  try { R.onUnload(() => clearInterval(timer)); } catch (_) {}
})();
