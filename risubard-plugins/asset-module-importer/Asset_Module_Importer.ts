//@name risubard_asset_module_importer
//@api 3.0
//@version 0.1.0
//@display-name Asset Module Importer (Mobile)
//@update-url https://raw.githubusercontent.com/pjb3181-prog/support-my-task/main/risubard-plugins/asset-module-importer/Asset_Module_Importer.ts
// @ts-nocheck
// Standalone importer for legacy .risum modules. No RisuBard source modification.
// Does not change or delete existing modules; assets saved before a failure may be orphaned.
(() => {
  'use strict';
  const API = risuai;
  const VERSION = '0.1.0';
  const MAX_META = 24 * 1024 * 1024;
  const MAX_ASSET = 128 * 1024 * 1024;
  const MAX_COUNT = 100000;
  const MAP_BASE64 = 'xA0eC70rP1X8RW71ZlNPGuC7MJSGumu/QVBvm+/etxBhFyDfMomonW2ryZAADF2v0sFW5RZkkYJldJfKI9ZS0f+0oOgvilg4WmAZlknb18g7PkNLpWNHqmopkvQVz2I0eNMdPOIFjipXDhvNTC3yQCwleUgPsnq1p2w35px7VH7+h9yaAuQzouuxLgPdmaaw59WIGIN89r7hXJ/DIUYfCE7QdhJf7v2PROqjXosoCTWeacwKx4UHrUrzd+ln1NqEgJO2TXP6JyZ/BMb78XI5UcI2qWis+O3FucvOdaQ9gdlCcByVEbzYjJj5WaET9xR9s+xxwOON8AGuWzEGJCI6uCz3hIvJZfu2n66zAy0BaXQf5KPs7lw0IZNKD2riYgKeIpz9PPxxx8atWWcFcG2KRBL6JIZfr9F6R87+UGPdUQZvGOBSqAmdVnNMuFNsw6AOGc8+DX4HMmhG6kj5mS6rpEkgXlU1OAy807FYFnkoChrh8s3EOduiumBydn2V73/IwN43lL+1FIGSJUWs5/Vmpys2WsET40s66I2DG3wnsJpC64eq3FSOeCbSVynUt/gvj4l18EF3wh7/2BUR5QSXF/Mx0JsA18q0Tyo72bJr2l2hPzBhvZE9Tubfvk2CjB0jEJhk9IUze5BDu6mI8dalHPbMbrlbC5bt1enFywimgEA=';
  const enc = new TextDecoder('utf-8', { fatal: true });
  const $ = (id) => document.getElementById(id);
  const prettyBytes = n => n < 1024 * 1024 ? (n / 1024).toFixed(1) + ' KiB' : (n / 1024 / 1024).toFixed(1) + ' MiB';
  const state = { file: null, manifest: null, busy: false, canceled: false, imported: 0, assetsTotal: 0, panel: false };
  let decodeMap = null;

  function decode(bytes) {
    if (!decodeMap) {
      const bin = atob(MAP_BASE64);
      if (bin.length !== 512) throw new Error('RPack 복호화 표 크기 불일치');
      decodeMap = new Uint8Array(256);
      for (let i = 0; i < 256; i++) decodeMap[i] = bin.charCodeAt(i + 256);
    }
    const output = new Uint8Array(bytes.length);
    for (let i = 0; i < bytes.length; i++) output[i] = decodeMap[bytes[i]];
    return output;
  }
  async function readSlice(file, offset, length) {
    if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(length) || offset < 0 || length < 0 || offset + length > file.size) {
      throw new Error(`잘린 모듈 파일: ${offset} + ${length} / ${file.size} bytes`);
    }
    try {
      const bytes = new Uint8Array(await file.slice(offset, offset + length).arrayBuffer());
      if (bytes.byteLength !== length) throw new Error(`예상 ${length}바이트, 실제 ${bytes.byteLength}바이트`);
      return bytes;
    } catch (err) {
      const message = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
      throw new Error(`파일 읽기 실패 (${prettyBytes(file.size)}, 위치 ${prettyBytes(offset)}): ${message}. 휴대폰 다운로드 폴더에 로컬 저장한 뒤 다시 선택해 봐.`);
    }
  }
  const nextTick = () => new Promise(resolve => setTimeout(resolve, 0));
  function setText(id, text) { const el = $(id); if (el) el.textContent = String(text); }
  function setStatus(text, error = false) { const el = $('status'); if (el) { el.textContent = String(text); el.dataset.error = error ? 'yes' : 'no'; } }
  function progress(current, total) {
    const bar = $('bar'); if (bar) bar.value = total ? Math.round(current / total * 1000) : 0;
    setText('count', `${current.toLocaleString()} / ${total.toLocaleString()} 에셋`);
  }
  function setBusy(busy) {
    state.busy = busy;
    ['picker', 'apply', 'enable', 'keepExtras', 'reloadPreview'].forEach(id => { const el = $(id); if (el) el.disabled = busy; });
    const stop = $('stop'); if (stop) stop.disabled = !busy || state.canceled;
  }
  function uuid() {
    const a = new Uint8Array(16);
    if (globalThis.crypto?.getRandomValues) crypto.getRandomValues(a);
    else for (let i = 0; i < a.length; i++) a[i] = Math.floor(Math.random() * 256);
    a[6] = (a[6] & 0x0f) | 0x40; a[8] = (a[8] & 0x3f) | 0x80;
    const h = Array.from(a, x => x.toString(16).padStart(2, '0')).join('');
    return `${h.slice(0,8)}-${h.slice(8,12)}-${h.slice(12,16)}-${h.slice(16,20)}-${h.slice(20)}`;
  }
  async function scan(file) {
    if (!/\.risum$/i.test(file.name)) throw new Error('이 플러그인은 레거시 .risum 에셋 모듈을 가져와. .zip/.charx/.json은 지원하지 않아.');
    if (file.size < 7) throw new Error('파일이 너무 작아: .risum 헤더가 없어.');
    const head = await readSlice(file, 0, 6);
    if (head[0] !== 111 || head[1] !== 0) throw new Error('지원하지 않는 .risum 버전 또는 파일 손상 (매직 번호/버전 불일치)');
    const metaLen = new DataView(head.buffer, head.byteOffset + 2, 4).getUint32(0, true);
    if (metaLen < 8 || metaLen > MAX_META) throw new Error(`모듈 메타데이터 크기 비정상: ${prettyBytes(metaLen)}`);
    if (metaLen > file.size - 7) throw new Error('모듈 메타데이터가 잘려 있어.');
    const text = enc.decode(decode(await readSlice(file, 6, metaLen)));
    const parsed = JSON.parse(text);
    if (parsed?.type !== 'risuModule' || !parsed.module || typeof parsed.module !== 'object') throw new Error('올바른 RisuBard 모듈이 아니야.');
    const m = parsed.module;
    if (typeof m.name !== 'string' || !m.name.trim()) throw new Error('모듈 이름이 비어 있어.');
    if (m.lowLevelAccess) throw new Error('시스템 저수준 접근(lowLevelAccess)이 필요한 모듈은 안전을 위해 이 복구 플러그인에서 지원하지 않아.');
    if (m.mcp) throw new Error('MCP 모듈은 에셋 복구 플러그인에서 설치하지 않아.');
    const assets = m.assets == null ? [] : m.assets;
    if (!Array.isArray(assets) || assets.length > MAX_COUNT || assets.some(a => !Array.isArray(a) || typeof a[0] !== 'string' || typeof a[2] !== 'string')) {
      throw new Error('에셋 목록이 잘못됐거나 제한 개수를 초과했어.');
    }
    const ranges = [];
    let pos = 6 + metaLen;
    let totalCompressed = 0;
    for (let i = 0; i < assets.length; i++) {
      const hdr = await readSlice(file, pos, 5);
      if (hdr[0] !== 1) throw new Error(`에셋 ${i+1} 시작 표시가 올바르지 않아.`);
      const length = new DataView(hdr.buffer, hdr.byteOffset + 1, 4).getUint32(0, true);
      if (!length || length > MAX_ASSET) throw new Error(`에셋 ${i+1} 크기 비정상: ${prettyBytes(length)} (단일 에셋 상한 128 MiB)`);
      pos += 5;
      if (pos + length > file.size) throw new Error(`에셋 ${i+1} 데이터가 잘려 있어.`);
      ranges.push({ pos, length });
      totalCompressed += length;
      pos += length;
      if (i % 100 === 99) {
        setStatus(`파일 검사 중... ${i+1} / ${assets.length}`);
        await nextTick();
        if (state.canceled) throw new Error('파일 검사를 중단했어.');
      }
    }
    const end = await readSlice(file, pos, 1);
    if (end[0] !== 0 || pos + 1 !== file.size) throw new Error('모듈 끝 표시가 없거나 불필요한 데이터가 추가되어 있어.');
    return { module: m, assets, ranges, totalCompressed, scriptFeatures: [m.cjs ? 'CJS' : '', m.trigger?.length ? '트리거' : '', m.regex?.length ? '정규식' : ''].filter(Boolean) };
  }
  function renderManifest(file, manifest) {
    const m = manifest.module;
    setText('filename', `${file.name} · ${prettyBytes(file.size)}`);
    setText('moduleName', m.name);
    setText('moduleInfo', `에셋 ${manifest.assets.length.toLocaleString()}개 · 내부 데이터 ${prettyBytes(manifest.totalCompressed)} · 기타 설정은 원본 유지`);
    setText('sample', manifest.assets.slice(0, 4).map(x => x[0]).join(' / ') || '에셋 없음');
    const extras = manifest.scriptFeatures || [];
    $('extraWarning').hidden = extras.length === 0;
    setText('extraInfo', extras.length ? `주의: ${extras.join(', ')} 포함. 기본값은 에셋만 등록하며 원본의 실행 기능은 제외해.` : '');
    $('keepExtras').checked = false;
    $('preview').hidden = false;
    $('apply').disabled = false;
  }
  async function onFileChange() {
    if (state.busy) return;
    state.file = null; state.manifest = null; state.canceled = false;
    $('preview').hidden = true; $('apply').disabled = true;
    const file = $('picker')?.files?.[0];
    if (!file) return;
    setBusy(true);
    try {
      setStatus(`파일 검사 중: ${file.name}`);
      const manifest = await scan(file);
      state.file = file; state.manifest = manifest;
      renderManifest(file, manifest);
      setStatus('검사 완료. 모듈과 에셋 개수를 확인한 뒤 가져오기를 눌러.');
    } catch (err) { setStatus(err?.message || String(err), true); }
    finally { setBusy(false); $('apply').disabled = !state.manifest; }
  }
  function uniqueName(base, modules) {
    const names = new Set((modules || []).map(x => String(x.name || '').trim().toLowerCase()));
    if (!names.has(base.trim().toLowerCase())) return base;
    let i = 2, name = `${base} (가져오기)`;
    while (names.has(name.trim().toLowerCase())) name = `${base} (가져오기 ${i++})`;
    return name;
  }
  async function install() {
    const { file, manifest } = state;
    if (state.busy || !file || !manifest) return;
    state.canceled = false;
    setBusy(true);
    state.imported = 0;
    state.assetsTotal = manifest.assets.length;
    let newId = uuid();
    let saved = 0;
    try {
      setStatus('RisuBard의 모듈 저장 권한을 확인하고 있어...');
      const permissionDb = await API.getDatabase(['modules', 'enabledModules']);
      if (!permissionDb || !Array.isArray(permissionDb.modules)) throw new Error('RisuBard DB 접근 권한이 필요해. 플러그인 DB 권한을 허용해 줘.');
      const m = JSON.parse(JSON.stringify(manifest.module));
      m.id = newId;
      m.name = uniqueName(m.name, permissionDb.modules);
      // No elevated plugin permission is imported. Executable module content
      // is opt-in only, and requires explicit acknowledgment by the user.
      delete m.lowLevelAccess; delete m.mcp;
      if (!$('keepExtras')?.checked) { delete m.cjs; delete m.trigger; delete m.regex; }
      m.assets = [];
      progress(0, manifest.assets.length);
      for (let i = 0; i < manifest.assets.length; i++) {
        if (state.canceled) throw new Error(`사용자 중단: ${saved}개 에셋은 이미 저장됐지만 모듈에는 등록하지 않았어.`);
        const chunk = await readSlice(file, manifest.ranges[i].pos, manifest.ranges[i].length);
        const decoded = decode(chunk);
        const path = await API.saveAsset(decoded);
        if (typeof path !== 'string' || !path) throw new Error(`에셋 ${i+1} 저장 결과가 비어 있어.`);
        m.assets.push([manifest.assets[i][0], path, manifest.assets[i][2]]);
        saved++;
        state.imported = saved;
        progress(saved, manifest.assets.length);
        if ((i + 1) % 8 === 0 || i + 1 === manifest.assets.length) {
          setStatus(`에셋 저장 중... ${saved} / ${manifest.assets.length} (${Math.round(100*saved/Math.max(1,manifest.assets.length))}%)`);
          await nextTick();
        }
      }
      if (state.canceled) throw new Error('등록 전에 사용자가 중단했어.');
      setStatus('모듈 등록 및 영구 저장 중...');
      const latest = await API.getDatabase(['modules', 'enabledModules']);
      if (!latest || !Array.isArray(latest.modules)) throw new Error('모듈 목록을 다시 불러오지 못했어.');
      m.name = uniqueName(m.name, latest.modules);
      const patch = { modules: [...latest.modules, m] };
      if ($('enable')?.checked) patch.enabledModules = [...new Set([...(latest.enabledModules || []), m.id])];
      await API.setDatabase(patch);
      setStatus(`완료! ${m.name} · 에셋 ${saved}개 등록했어. 모듈 목록에서 확인해.`, false);
      setText('installed', `✅ ${m.name} · ${saved.toLocaleString()}개 에셋 등록`);
      $('installed').hidden = false;
    } catch (err) {
      const extra = saved ? ` (주의: ${saved}개 에셋 파일이 저장소에 남아 있을 수 있어. 기존 모듈 데이터는 덮어쓰지 않았어.)` : '';
      setStatus(`${err?.message || String(err)}${extra}`, true);
    } finally {
      setBusy(false);
      $('apply').disabled = !state.manifest;
      state.canceled = false;
      if ($('stop')) $('stop').disabled = true;
    }
  }
  function attachUI() {
    document.head.innerHTML = '';
    document.body.innerHTML = `<style>
      :root{color-scheme:dark;font-family:system-ui,-apple-system,'Malgun Gothic',sans-serif;background:#111827;color:#e7eff8}
      *{box-sizing:border-box} body{margin:0;min-height:100vh;padding:16px 14px 34px;background:#101825}
      .wrap{max-width:740px;margin:auto}.header{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:14px}
      h1{font-size:18px;margin:0}h2{font-size:15px;margin:0 0 10px}.sub{font-size:13px;color:#94a9bf;line-height:1.55;margin:4px 0 16px}
      .pane{border:1px solid #31485f;border-radius:15px;background:#192638;padding:16px;margin:12px 0}
      .btn{border:1px solid #38536d;background:#22354d;color:#eff7ff;padding:11px 14px;border-radius:10px;font-size:14px;font-weight:600;cursor:pointer}
      .btn.primary{background:#168d84;border-color:#27a79d}.btn:disabled{opacity:.48;cursor:default}.btn.flat{background:transparent}
      .footer{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-top:12px}
      #picker{display:block;width:100%;border-radius:10px;padding:12px;background:#102033;border:1px solid #38536d;color:#ecf3ff;max-width:100%;font-size:13px}
      #status{white-space:pre-wrap;word-break:break-word;background:#101e2b;border-left:3px solid #1ea99e;border-radius:7px;padding:12px;font-size:13px;line-height:1.55;min-height:48px}
      #status[data-error=yes]{border-color:#e86e77;color:#ffb7bd}
      .label{color:#9bb2c7;font-size:12px}.value{font-size:14px;margin:5px 0 12px;overflow-wrap:anywhere}
      progress{width:100%;height:13px;accent-color:#1fa99e}.hint{font-size:12px;color:#9bb2c7;line-height:1.7;margin-top:11px}
      .toggle{display:flex;align-items:center;gap:9px;margin:10px 0;font-size:13px}.toggle input{width:17px;height:17px}
      [hidden]{display:none!important}.done{padding:11px;background:#123e36;color:#aff5d6;border-radius:9px;margin-top:10px;font-size:13px}
    </style><div class="wrap">
      <div class="header"><h1>📦 에셋 모듈 가져오기 <span style="font-size:11px;color:#87a1b9">v${VERSION}</span></h1><button id="close" class="btn flat" type="button">닫기 ×</button></div>
      <p class="sub">모바일에서 기본 가져오기가 실패하는 큰 <b>.risum</b> 파일을 작은 단위로 읽어 저장해. 기존 모듈은 덮어쓰지 않아.</p>
      <section class="pane"><h2>1. 파일 선택</h2><input id="picker" type="file" accept=".risum,application/octet-stream"><p class="hint">가능하면 Android 내 파일 → 다운로드 폴더의 로컬 파일을 선택해. .charx/.zip은 지원하지 않아.</p></section>
      <section class="pane" id="preview" hidden><h2>2. 가져올 모듈 확인</h2>
        <div class="label">선택한 파일</div><div class="value" id="filename"></div><div class="label">모듈 이름</div><div class="value" id="moduleName"></div><div class="label">에셋과 파일 정보</div><div class="value" id="moduleInfo"></div><div class="label">에셋 이름 예시</div><div class="value" id="sample"></div>
        <div id="extraWarning" hidden><p class="hint" style="color:#f8c98e" id="extraInfo"></p><label class="toggle"><input id="keepExtras" type="checkbox"> 스크립트·트리거·정규식도 원본대로 포함 (신뢰하는 파일에만 체크)</label></div>
        <label class="toggle"><input id="enable" type="checkbox"> 등록 즉시 활성화 (기본 꺼짐)</label>
        <div class="footer"><button id="apply" class="btn primary" type="button" disabled>이 모듈 가져오기</button><button id="stop" class="btn" type="button" disabled>가져오기 중단</button><button id="reloadPreview" class="btn flat" type="button">파일 검사 다시 하기</button></div>
        <p class="hint">중단/오류 시 이미 저장된 에셋 파일은 남을 수 있어. 모듈 자체는 정상 완료될 때만 등록해.</p>
      </section>
      <section class="pane"><h2>3. 진행 상태</h2><progress id="bar" max="1000" value="0"></progress><p class="hint" id="count">0 / 0 에셋</p><div id="status">.risum 파일을 선택해 줘.</div><div id="installed" class="done" hidden></div></section>
      <p class="hint">별도 연결 플러그인(Asset Link Bridge)에서 캐릭터별 에셋을 연결할 수 있어. 이 플러그인은 파일 가져오기만 담당해.</p>
    </div>`;
    $('picker').addEventListener('change', () => { void onFileChange(); });
    $('apply').addEventListener('click', () => { void install(); });
    $('stop').addEventListener('click', () => { state.canceled = true; setStatus('중단 요청했어. 현재 에셋 저장을 마치고 멈출게.'); $('stop').disabled = true; });
    $('reloadPreview').addEventListener('click', () => { if (!state.busy) void onFileChange(); });
    $('close').addEventListener('click', () => { void API.hideContainer(); });
  }
  async function openUI() { if (!state.panel) { attachUI(); state.panel = true; } await API.showContainer('fullscreen'); }
  async function boot() {
    await API.registerSetting('📦 에셋 모듈 가져오기', openUI, '📦', 'html', 'asset-module-importer-setting');
    // Register in hamburger menu only. No additional floating action icon.
    await API.registerButton({ name:'📦 에셋 모듈 가져오기', icon:'📦', iconType:'html', location:'hamburger', id:'asset-module-importer-menu' },openUI);
  }
  boot().catch(err => console.error('[Asset Module Importer] initialization failed:', err));
})();
