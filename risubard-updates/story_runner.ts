//@name story_runner
//@display-name Story Runner
//@api 3.0
//@allowed-ipc mutation_state_router_v2
//@version 0.95.7
//@update-url https://raw.githubusercontent.com/pjb3181-prog/support-my-task/main/risubard-updates/story_runner.ts
//@description Story Workspace: evidence-based output safety; no legacy prose recheck lockout; self-updating story studio.

(async () => {
  const VERSION = "0.95.7";
  const STORAGE_PREFIX = "storyrunner_plugin_v1";
  const SCENE_LIBRARY_KEY = STORAGE_PREFIX + "_scene_library";
  const CAMEO_LIBRARY_KEY = STORAGE_PREFIX + "_cameo_character_lore_library";
  const CAMEO_LIBRARY_VERSION = 1;
  const STORY_DNA_KEY = STORAGE_PREFIX + "_story_dna_v1";
  const STORY_DNA_VERSION = 1;
  const COMPLETE_MARKER = "<SR_SCENE_COMPLETE/>";
  const MUTATION_PLUGIN_NAME = "mutation_state_router_v2";
  const MUTATION_REQUEST_CHANNEL = "story-runner-context-request";
  const MUTATION_RESPONSE_CHANNEL = "mutation-context-response";
  const AUXILIARY_SLOW_NOTICE_MS = 180000;
  const AUXILIARY_HARD_TIMEOUT_MS = 600000;

  let currentTarget = null;
  let project = emptyProject();
  let uiOpen = false;
  // These values are read by renderUIUnsafe(), so initialize them BEFORE
  // registerSetting/registerButton can expose openUI to the host.
  let directTurnInstruction = '';
  let directTurnDraft = '';
  let directTurnBusy = false;
  let directTurnError = '';
  let targetWatchTimer = null;
  let targetWatchBusy = false;
  let planningBusy = false;
  let planningChatBusy = false;
  let blueprintBusy = false;
  let storyStudioBusy = false;
  let blueprintEditorId = "";
  let blueprintEditorOpen = true;
  let blueprintActOpenIds = new Set();
  // Native Risu sendChat already owns its completion chime. Only direct
  // plugin-model output needs an extra chime, after successful chat insertion.
  let completionAudioContext = null;
  function unlockCompletionAudio() {
    try {
      if (typeof window === "undefined") return;
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      if (!AudioContextClass) return;
      if (!completionAudioContext) completionAudioContext = new AudioContextClass();
      if (completionAudioContext.state === "suspended") {
        const resumed = completionAudioContext.resume();
        if (resumed && typeof resumed.catch === "function") resumed.catch(() => {});
      }
    } catch (_) { /* audio must never interrupt a story turn */ }
  }
  function playDirectStoryCompletionSound() {
    try {
      if (!completionAudioContext || completionAudioContext.state !== "running") return;
      const ctx = completionAudioContext;
      const start = ctx.currentTime + 0.015;
      for (const [index, frequency] of [660, 880].entries()) {
        const at = start + index * 0.105;
        const oscillator = ctx.createOscillator();
        const volume = ctx.createGain();
        oscillator.type = "sine";
        oscillator.frequency.setValueAtTime(frequency, at);
        volume.gain.setValueAtTime(0.0001, at);
        volume.gain.exponentialRampToValueAtTime(0.085, at + 0.012);
        volume.gain.exponentialRampToValueAtTime(0.0001, at + 0.14);
        oscillator.connect(volume);
        volume.connect(ctx.destination);
        oscillator.start(at);
        oscillator.stop(at + 0.15);
      }
    } catch (error) { console.log("[StoryRunner] completion sound skipped", error); }
  }
  // Unlock from a real user gesture; browsers may block audio without one.
  if (typeof document !== "undefined") document.addEventListener("pointerdown", unlockCompletionAudio, { passive: true });
  let nextEpisodeBusy = false;
  let nextEpisodeError = "";
  let nextEpisodeAutoStarted = false;
  let storySuggestionBusy = false;
  let storySuggestionError = "";
  let directorBusy = false;
  let directorError = "";
  let directorContextStatus = "";
  let storyDNA = emptyStoryDNA();
  let storyDnaError = "";
  let storyDnaNotice = "";
  // Persist disclosure state across frequent renderUI() calls.
  let storyDnaExpanded = false;
  let storyDnaCandidatesExpanded = false;
  let uiTab = "director";
  let aiTask = null;
  let aiTaskTicker = null;
  let aiTaskToastHidden = false;
  let directPresetStatus = {
    name: "",
    blockCount: 0,
    blockNames: [],
    loadedAt: 0,
  };
  const HOST_PROMPT_CAPTURE_KEY = STORAGE_PREFIX + "_host_prompt_capture";
  function hostPromptCaptureKey(target) {
    if (!target) return HOST_PROMPT_CAPTURE_KEY;
    return HOST_PROMPT_CAPTURE_KEY + "_ci" + target.characterIndex + "_hi" + target.chatIndex;
  }
  let hostPromptCapture = null;
  let directRunInProgress = false;
  let activeHostPacingMode = "off";
  let internalLLMCallDepth = 0;
  let autoTimer = null;
  let autoLoopBusy = false;
  let autoRunTurnCount = 0;
  let autoRunSameNodeCount = 0;
  let autoRunLastNodeId = null;
  const AUTO_RUN_MAX_TURNS = 100;
  const AUTO_RUN_MAX_SAME_NODE_TURNS = 12;
  const AUTO_RUN_DELAY_MS = 650;
  let lastError = "";
  let mainWriterDiagnostic = "";
  let mainWriterDiagnosticBusy = false;
  let sceneLibrary = [];
  let cameoLibrary = [];
  let cameoStatus = "대기";
  let bridgeStatus = "미확인";
  let mutationContextCache = null;
  let mutationContextUpdatedAt = 0;
  let mutationRefreshBusy = false;
  let mutationRefreshMessage = "";
  let characterDocs = [];
  let mutationWikiDocs = [];
  let editingCharacterDocId = null;
  let characterEditorTitle = "";
  let characterEditorMarkdown = "";
  let characterEditorInstruction = "";
  let characterBusy = false;
  let characterBootstrapStatus = "초기 세계관은 Mutation 직접 수정 카드·로어북";
  let characterBootstrapReport = null;
  let characterSyncStatus = "대기";
  let lastCharacterSyncAt = 0;
  const bridgeWaiters = new Map();

  // Lightweight performance profiler for real chat turns.
  // Risu does not expose provider-network timestamps, so "model wait" below means
  // the observable gap between plugin preprocessing completion and the first chat output event.
  let perfSequence = 0;
  let activeHostPerf = null;

  function perfMessageStats(messages) {
    const rows = Array.isArray(messages) ? messages : [];
    let chars = 0;
    for (const row of rows) chars += text(row && row.content).length;
    return { messages: rows.length, chars };
  }

  function perfLog(label, payload) {
    try {
      console.log("[StoryRunner][PERF] " + label + " " + JSON.stringify(payload));
    } catch (_) {
      console.log("[StoryRunner][PERF] " + label, payload);
    }
  }

  function uid(prefix) {
    prefix = prefix || "sr";
    if (globalThis.crypto && crypto.randomUUID) return prefix + "_" + crypto.randomUUID();
    return prefix + "_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 9);
  }

  function text(value) {
    return typeof value === "string" ? value : "";
  }

  function stringList(value) {
    return Array.isArray(value) ? value.filter((v) => typeof v === "string") : [];
  }


  function clamp01(value, fallback) {
    const n = Number(value);
    if (!Number.isFinite(n)) return Number.isFinite(fallback) ? fallback : 0;
    return Math.max(0, Math.min(1, n));
  }

  function normalizeStoryDnaKey(value) {
    const raw = text(value).trim().toLowerCase();
    if (!raw) return "pref_" + Math.random().toString(36).slice(2, 9);
    const cleaned = raw
      .replace(/[^a-z0-9가-힣_\-\s]+/g, " ")
      .trim()
      .replace(/[\s\-]+/g, "_")
      .replace(/_+/g, "_")
      .slice(0, 80);
    return cleaned || ("pref_" + Math.random().toString(36).slice(2, 9));
  }

  function seededStoryDnaPreferences() {
    const now = Date.now();
    const rows = [
      ["gradual_buildup", "pacing", "관계와 큰 변화는 바로 확정하기보다 작은 선례와 반복을 누적해 자연스럽게 빌드업하는 전개를 선호함."],
      ["far_future_reverse_planning", "pacing", "먼 미래 목표가 있으면 현재에 바로 실행하지 않고 필요한 중간 단계를 역산해 지금 필요한 씨앗만 심는 방식을 선호함."],
      ["active_protagonist", "protagonist", "주인공이 관찰만 하기보다 먼저 말하고 행동하며 장면과 관계를 실제로 움직이는 전개를 선호함."],
      ["exploit_world_mechanics", "world", "세계관의 규칙·장치·특수 구조를 설정 설명으로만 두지 않고 실제 행동과 전개의 도구로 적극 활용하는 전개를 선호함."],
      ["character_specific_reactions", "character", "사건 뒤에는 각 캐릭터의 성격·관계에 맞는 구체적인 반응과 후속 영향을 보여주는 전개를 선호함."],
      ["rough_note_auto_director", "director", "사용자가 메모를 거칠게 섞어 써도 AI가 현재 장면·중기·장기 목표·금지사항을 알아서 분류하고 작가용 지시문으로 정리해 주는 방식을 선호함."],
    ];
    return rows.map(([key, category, statement]) => ({
      key,
      category,
      likeStatement: statement,
      avoidStatement: "",
      likeWeight: 1.5,
      avoidWeight: 0,
      evidenceCount: 1,
      explicitCount: 1,
      sourceChats: [],
      lastEvidence: "사용자가 Story Runner 설계 과정에서 명시적으로 확정한 기본 취향",
      status: "active",
      createdAt: now,
      updatedAt: now,
    }));
  }

  function emptyStoryDNA() {
    return {
      version: STORY_DNA_VERSION,
      learningEnabled: true,
      profileSummary: "느린 누적형 빌드업, 적극적으로 행동하는 주인공, 세계관 기믹의 실제 활용, 캐릭터별 반응과 후속 영향을 선호함. 거친 메모는 AI가 시간축과 우선순위를 알아서 정리하는 방식을 선호함.",
      preferences: seededStoryDnaPreferences(),
      updatedAt: Date.now(),
      lastLearnedAt: 0,
    };
  }

  function normalizeStoryDnaPreference(raw) {
    raw = raw && typeof raw === "object" ? raw : {};
    const key = normalizeStoryDnaKey(raw.key || raw.id || raw.statement);
    return {
      key,
      category: text(raw.category) || "general",
      likeStatement: text(raw.likeStatement || (raw.polarity === "like" ? raw.statement : "")),
      avoidStatement: text(raw.avoidStatement || (raw.polarity === "avoid" ? raw.statement : "")),
      likeWeight: Math.max(0, Number(raw.likeWeight) || (raw.polarity === "like" ? clamp01(raw.confidence, 0.7) : 0)),
      avoidWeight: Math.max(0, Number(raw.avoidWeight) || (raw.polarity === "avoid" ? clamp01(raw.confidence, 0.7) : 0)),
      evidenceCount: Math.max(0, Number(raw.evidenceCount) || 0),
      explicitCount: Math.max(0, Number(raw.explicitCount) || 0),
      sourceChats: stringList(raw.sourceChats).slice(-16),
      lastEvidence: text(raw.lastEvidence || raw.evidence).slice(0, 800),
      status: raw.status === "active" ? "active" : "candidate",
      createdAt: Number(raw.createdAt) || Date.now(),
      updatedAt: Number(raw.updatedAt) || Date.now(),
    };
  }

  function normalizeStoryDNA(raw) {
    const base = emptyStoryDNA();
    if (!raw || typeof raw !== "object") return base;
    const seen = new Set();
    const prefs = [];
    for (const item of Array.isArray(raw.preferences) ? raw.preferences : []) {
      const normalized = normalizeStoryDnaPreference(item);
      if (!normalized.key || seen.has(normalized.key)) continue;
      seen.add(normalized.key);
      prefs.push(normalized);
      if (prefs.length >= 64) break;
    }
    return {
      version: STORY_DNA_VERSION,
      learningEnabled: raw.learningEnabled !== false,
      profileSummary: text(raw.profileSummary) || base.profileSummary,
      preferences: prefs.length ? prefs : base.preferences,
      updatedAt: Number(raw.updatedAt) || Date.now(),
      lastLearnedAt: Number(raw.lastLearnedAt) || 0,
    };
  }

  async function loadStoryDNA() {
    try {
      const raw = await risuai.pluginStorage.getItem(STORY_DNA_KEY);
      storyDNA = normalizeStoryDNA(raw);
      if (!raw) await saveStoryDNA();
      return storyDNA;
    } catch (error) {
      storyDnaError = error && error.message ? error.message : String(error);
      storyDNA = emptyStoryDNA();
      return storyDNA;
    }
  }

  async function saveStoryDNA() {
    storyDNA.updatedAt = Date.now();
    await risuai.pluginStorage.setItem(STORY_DNA_KEY, storyDNA);
    return true;
  }

  function storyDnaPrefNet(pref) {
    return (Number(pref && pref.likeWeight) || 0) - (Number(pref && pref.avoidWeight) || 0);
  }

  function storyDnaPrefStatement(pref) {
    if (!pref) return "";
    return storyDnaPrefNet(pref) >= 0
      ? text(pref.likeStatement || pref.avoidStatement)
      : text(pref.avoidStatement || pref.likeStatement);
  }

  function storyDnaPrefPolarity(pref) {
    return storyDnaPrefNet(pref) >= 0 ? "like" : "avoid";
  }

  function storyDnaSorted(status) {
    const rows = Array.isArray(storyDNA && storyDNA.preferences) ? storyDNA.preferences.slice() : [];
    return rows
      .filter((x) => !status || x.status === status)
      .sort((a, b) => {
        const aScore = (Number(a.explicitCount) || 0) * 8 + (Array.isArray(a.sourceChats) ? a.sourceChats.length : 0) * 3 + (Number(a.evidenceCount) || 0) + Math.abs(storyDnaPrefNet(a));
        const bScore = (Number(b.explicitCount) || 0) * 8 + (Array.isArray(b.sourceChats) ? b.sourceChats.length : 0) * 3 + (Number(b.evidenceCount) || 0) + Math.abs(storyDnaPrefNet(b));
        return bScore - aScore;
      });
  }

  function storyDnaPromptText(mode) {
    mode = mode || "director";
    const active = storyDnaSorted("active").filter((pref) => mode === "director" || pref.category !== "director").slice(0, 14);
    const candidates = mode === "director" ? storyDnaSorted("candidate").slice(0, 6) : [];
    if (!active.length && !candidates.length && !text(storyDNA.profileSummary).trim()) return "";
    const lines = [
      "# USER STORY DNA — SOFT CROSS-BOT PREFERENCES",
      "This is the user's reusable narrative taste profile shared across different bots/chats.",
      "It is SOFT guidance only: current explicit user instructions, current canon, and character truth always outrank it.",
      "Do not force a favorite trope where it does not fit. Use it to choose among equally plausible options and to make relevant recommendations.",
      "Do not infer real-world identity, sexuality, health, politics, or other sensitive personal traits from fiction preferences.",
    ];
    if (text(storyDNA.profileSummary).trim()) lines.push("Profile summary: " + text(storyDNA.profileSummary).slice(0, 1200));
    if (active.length) {
      lines.push("Active preferences:");
      for (const pref of active) {
        lines.push("- [" + (storyDnaPrefPolarity(pref) === "like" ? "LIKE" : "AVOID") + "][" + text(pref.category) + "] " + storyDnaPrefStatement(pref));
      }
    }
    if (candidates.length) {
      lines.push("Weak/candidate signals — use only as tentative hints, not facts:");
      for (const pref of candidates) lines.push("- [candidate] " + storyDnaPrefStatement(pref));
    }
    return lines.join("\n").slice(0, 7000);
  }

  function currentStoryDnaSourceKey() {
    if (!currentTarget) return "unknown";
    return text(currentTarget.characterId) + ":" + text(currentTarget.chatId);
  }

  function normalizeStoryDnaObservation(raw) {
    raw = raw && typeof raw === "object" ? raw : {};
    return {
      key: normalizeStoryDnaKey(raw.key || raw.statement),
      category: text(raw.category) || "general",
      statement: text(raw.statement).slice(0, 700),
      polarity: raw.polarity === "avoid" ? "avoid" : "like",
      scope: raw.scope === "global" ? "global" : "story",
      confidence: clamp01(raw.confidence, 0.65),
      explicit: raw.explicit === true,
      generalizable: raw.generalizable === true,
      evidence: text(raw.evidence).slice(0, 700),
    };
  }

  async function applyStoryDnaLearning(learning) {
    storyDnaNotice = "";
    if (!storyDNA || storyDNA.learningEnabled === false) return { learned: 0, promoted: 0 };
    learning = learning && typeof learning === "object" ? learning : {};
    const observations = Array.isArray(learning.observations) ? learning.observations.map(normalizeStoryDnaObservation).slice(0, 8) : [];
    const globalObs = observations.filter((obs) => obs.scope === "global" && obs.generalizable && obs.statement);
    let learned = 0;
    let promoted = 0;
    const source = currentStoryDnaSourceKey();
    const prefs = Array.isArray(storyDNA.preferences) ? storyDNA.preferences : (storyDNA.preferences = []);

    for (const obs of globalObs) {
      let pref = prefs.find((x) => x && x.key === obs.key);
      if (!pref) {
        pref = normalizeStoryDnaPreference({ key: obs.key, category: obs.category, status: "candidate" });
        prefs.push(pref);
      }
      pref.category = obs.category || pref.category;
      const boost = obs.confidence * (obs.explicit ? 1.6 : 1.0);
      if (obs.polarity === "avoid") {
        pref.avoidWeight = (Number(pref.avoidWeight) || 0) + boost;
        pref.avoidStatement = obs.statement || pref.avoidStatement;
      } else {
        pref.likeWeight = (Number(pref.likeWeight) || 0) + boost;
        pref.likeStatement = obs.statement || pref.likeStatement;
      }
      pref.evidenceCount = (Number(pref.evidenceCount) || 0) + 1;
      if (obs.explicit) pref.explicitCount = (Number(pref.explicitCount) || 0) + 1;
      const sources = Array.isArray(pref.sourceChats) ? pref.sourceChats : [];
      if (source && source !== "unknown" && !sources.includes(source)) sources.push(source);
      pref.sourceChats = sources.slice(-16);
      pref.lastEvidence = obs.evidence || pref.lastEvidence;
      pref.updatedAt = Date.now();

      const wasActive = pref.status === "active";
      const net = Math.abs(storyDnaPrefNet(pref));
      const explicitStrong = obs.explicit && obs.confidence >= 0.76;
      const repeatedAcrossChats = pref.sourceChats.length >= 2;
      const repeatedEnough = pref.evidenceCount >= 3;
      const notConflicted = net >= 0.55;
      if (explicitStrong || ((repeatedAcrossChats || repeatedEnough) && notConflicted)) pref.status = "active";
      else pref.status = "candidate";
      if (!wasActive && pref.status === "active") promoted += 1;
      learned += 1;
    }

    const profileSummary = text(learning.profileSummary).trim();
    if (profileSummary) storyDNA.profileSummary = profileSummary.slice(0, 1800);
    if (learned) storyDNA.lastLearnedAt = Date.now();
    storyDNA.preferences = prefs.slice(0, 64);
    await saveStoryDNA();

    if (learned) {
      storyDnaNotice = "이번 메모에서 Story DNA 신호 " + learned + "개 반영" + (promoted ? (" · " + promoted + "개 공통 취향으로 승격") : "");
    }
    return { learned, promoted };
  }

  function storyDnaMarkdown() {
    const active = storyDnaSorted("active");
    const candidates = storyDnaSorted("candidate");
    const lines = [
      "# Story DNA",
      "",
      "Story Runner가 여러 봇/채팅에서 공통으로 참고하는 사용자 서사 취향 프로필.",
      "현재 지시와 현재 작품 Canon이 항상 Story DNA보다 우선함.",
      "",
      "## AI Summary",
      "",
      text(storyDNA.profileSummary) || "(비어 있음)",
      "",
      "## Active Preferences",
      "",
    ];
    if (!active.length) lines.push("- (없음)");
    for (const pref of active) lines.push("- [" + (storyDnaPrefPolarity(pref) === "like" ? "LIKE" : "AVOID") + "] [" + text(pref.category) + "] " + storyDnaPrefStatement(pref));
    lines.push("", "## Learning Candidates", "");
    if (!candidates.length) lines.push("- (없음)");
    for (const pref of candidates) lines.push("- [CANDIDATE] [" + text(pref.category) + "] " + storyDnaPrefStatement(pref));
    lines.push("", "<!-- STORY_DNA_JSON", JSON.stringify(storyDNA, null, 2), "STORY_DNA_JSON -->", "");
    return lines.join("\n");
  }

  function parseStoryDnaImport(rawText) {
    const source = text(rawText).trim();
    if (!source) throw new Error("Story DNA 파일이 비어 있어.");
    const marker = source.match(/<!--\s*STORY_DNA_JSON\s*([\s\S]*?)\s*STORY_DNA_JSON\s*-->/i);
    const jsonText = marker ? marker[1].trim() : source;
    const parsed = JSON.parse(jsonText);
    return normalizeStoryDNA(parsed);
  }

  function downloadStoryDnaMarkdown() {
    const blob = new Blob([storyDnaMarkdown()], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "story-dna.md";
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function episodeMustBeats(ep) {
    return stringList(ep && ep.mustBeats).map(text).filter(Boolean);
  }

  function episodeGuideBeats(ep) {
    const explicit = stringList(ep && ep.guideBeats).map(text).filter(Boolean);
    if (explicit.length) return explicit;
    // Backward compatibility: old `beats` are advisory, not mandatory.
    return stringList(ep && ep.beats).map(text).filter(Boolean);
  }

  function likelyTruncatedStory(raw) {
    const source = text(raw).replace(COMPLETE_MARKER, "").trim();
    if (!source || text(raw).includes(COMPLETE_MARKER)) return false;
    const tail = source.slice(-120);
    const last = source.slice(-1);
    const terminal = /[.!?。！？…」』”’)]/.test(last);
    const openPairs = [["「", "」"], ["『", "』"], ["(", ")"], ["[", "]"], ["{", "}"], ["“", "”"]];
    for (const pair of openPairs) {
      const opens = source.split(pair[0]).length - 1;
      const closes = source.split(pair[1]).length - 1;
      if (opens > closes) return true;
    }
    if (/[,;:·\-–—(\[{]$/.test(last)) return true;
    if (/\b(and|but|because|so|then|with|to|of)$/i.test(tail)) return true;
    return !terminal;
  }

  function latestUserTextFromMessages(messages) {
    const rows = Array.isArray(messages) ? messages : [];
    for (let i = rows.length - 1; i >= 0; i--) {
      if (rows[i] && rows[i].role === "user" && text(rows[i].content).trim()) return text(rows[i].content).trim();
    }
    return "";
  }

  function explicitSceneResolutionRequested(value) {
    const source = text(value).trim();
    if (!source) return false;
    return /(?:끝까지|목표(?:까지|로)|마무리(?:해|하|까지)?|끝내(?:줘|라|자|고)?|종결|완결|해결(?:해|하|까지)?|결말(?:까지)?|후일담|에필로그|다음\s*(?:장면|화|날|날짜|에피소드)|시간\s*(?:넘겨|스킵|점프)|타임\s*스킵|쭉\s*(?:진행|가|달려)|죽\s*달려|알아서\s*(?:끝까지|쭉)|결과(?:까지|를\s*보여)|사건\s*(?:정리|종료)|scene\s*(?:end|finish)|finish\s*(?:it|the\s*scene)?|resolve\s*(?:it|the\s*scene)?|complete\s*(?:it|the\s*scene)?|timeskip)/i.test(source);
  }

  function explicitFinePacingRequested(value) {
    const source = text(value).trim();
    if (!source) return false;
    return /(?:천천히|느리게|세밀하게|조금만|여기까지만|한\s*(?:비트|단계|장면)만|바로\s*다음\s*반응까지만|짧게\s*(?:진행|가)|한번에\s*많이\s*가지\s*마)/i.test(source);
  }

  function pacingModeForUserText(userText) {
    if (project.interactivePacing === false) return "off";
    const source = text(userText).trim();
    if (explicitSceneResolutionRequested(source)) return "goal";
    if (explicitFinePacingRequested(source)) return "fine";
    return "adaptive";
  }

  function interactivePacingText(mode, userText) {
    if (!mode || mode === "off") return "";
    if (mode === "goal") {
      return [
        "# GOAL-RUN PACING — USER ASKED TO KEEP GOING",
        "The user explicitly wants forward momentum toward the current requested/planned goal.",
        "Do not stop at every small choice point. Resolve minor choices using established character motives, continuity, and the current plan, and keep moving causally.",
        "You may cross intermediate turning points and complete the current scene/episode if the requested goal is genuinely reached.",
        "Do not invent a new unrelated arc beyond that goal merely to keep writing.",
        userText ? ("Latest user direction: " + text(userText).slice(0, 1600)) : "",
      ].filter(Boolean).join("\n");
    }
    if (mode === "fine") {
      return [
        "# FINE-GRAIN PACING — STOP EARLY FOR USER CONTROL",
        "Advance only the immediate local consequence of the latest user direction: roughly one meaningful action/reaction cycle or one significant escalation step.",
        "Keep the current incident open. Do not resolve the central tension, jump to aftermath, leave the scene, time-skip, or launch the next event.",
        "End at a natural live handoff point with meaningful room for the user to intervene.",
        "Do not append " + COMPLETE_MARKER + " in this mode.",
        userText ? ("Latest user direction: " + text(userText).slice(0, 1600)) : "",
      ].filter(Boolean).join("\n");
    }
    return [
      "# ADAPTIVE CHOICE-POINT PACING — COMPRESS BUILDUP, STOP AT MEANINGFUL DECISIONS",
      "Treat the latest user input as direction for the ongoing story, not as permission to instantly resolve the whole arc.",
      "Continue through UNIMPORTANT connective beats without waiting for another user turn: ordinary movement, setup, small talk, observation, routine reactions, low-stakes misunderstandings, minor interruptions, and other beats whose exact choice is unlikely to matter to the user.",
      "You may compress several such buildup beats into one response. A three-beat introduction can simply run through all three beats if nothing important is being decided.",
      "STOP BEFORE a MEANINGFUL CHOICE POINT: an irreversible or relationship-changing action, a major reveal, choosing a side, accepting/refusing a consequential proposal, committing to a new destination/plan, a decisive escalation, resolving the central conflict, or another moment where the user is likely to think 'I wanted to decide that.'",
      "If no meaningful user-relevant choice point exists before the current episode/scene goal, continue naturally all the way to that goal; the scene may then complete.",
      "Do not stop merely because tension increased, two characters became closer, or a new beat started. Stop because a consequential decision is about to be made.",
      "If you stop at a choice point, leave the situation concrete and immediately actionable rather than manufacturing a vague cliffhanger. Do not append " + COMPLETE_MARKER + " unless the current episode truly completed before any unresolved meaningful choice.",
      "A plain '계속/이어가/좀 더 진행' means advance to the next meaningful choice point, not just one beat.",
      userText ? ("Latest user direction: " + text(userText).slice(0, 1600)) : "",
    ].filter(Boolean).join("\n");
  }

  function emptyProject() {
    return {
      version: 1,
      experienceMode: 'direct',
      modernDirection: '',
      modernPlannedDirection: '',
      modernStorySetup: '',
      modernTrackingEnabled: true,
      modernContinuous: false,
      storyBlueprint: emptyStoryBlueprint(),
      storyStudio: emptyStoryStudio(),
      blueprintHistory: [],
      blueprintFocusId: '',
      modernPlannedBlueprintAt: 0,
      storyNotebook: emptyStoryNotebook(),
      destination: "",
      storyMode: "normal",
      writerQualityMode: "strong",
      executionMode: "ai",
      interactivePacing: true,
      cameoAutoUse: true,
      nextEpisodeChoices: [],
      nextEpisodeDirection: "",
      nextEpisodeDraft: "",
      nextEpisodeAnchor: "",
      nextEpisodeGeneratedAt: 0,
      nextEpisodeStale: true,
      ntrKnowledgeLedger: null,
      storySuggestions: [],
      storySuggestionGeneratedAt: 0,
      directorInput: "",
      directorAnalysis: null,
      directorUpdatedAt: 0,
      planningHorizon: 3,
      nodes: [],
      currentNodeId: null,
      completedNodeIds: [],
      sceneIdeas: [],
      selectedSceneCardIds: [],
      planningChat: [],
      planningOutline: null,
      planningLocked: false,
      constraints: [],
      forbidden: [],
      mutationPackOverrides: {},
      currentEpisodeOverride: "",
      episodeRuntimeStatus: {},
      autoRun: false,
      running: false,
      paused: false,
      generationNonce: uid("gen"),
      lastStatus: "idle",
      lastReason: "",
      updatedAt: Date.now(),
    };
  }

  function normalizeNode(raw, index) {
    const allowed = ["free","guide","target","required","directed","locked","stop"];
    return {
      id: text(raw && raw.id) || uid("node"),
      title: text(raw && raw.title) || "장면 " + (index + 1),
      control: allowed.includes(raw && raw.control) ? raw.control : "guide",
      instruction: text(raw && raw.instruction),
      prerequisites: stringList(raw && raw.prerequisites),
      completionCriteria: stringList(raw && raw.completionCriteria),
      episodeNumber: text(raw && raw.episodeNumber),
      episodeTitle: text(raw && raw.episodeTitle),
      enabled: !raw || raw.enabled !== false,
    };
  }

  function normalizeProject(raw) {
    const base = emptyProject();
    if (!raw || typeof raw !== "object") return base;
    const nodes = Array.isArray(raw.nodes) ? raw.nodes.map(normalizeNode) : [];
    const completed = new Set(stringList(raw.completedNodeIds));
    let currentNodeId = typeof raw.currentNodeId === "string" ? raw.currentNodeId : null;
    if (!currentNodeId || !nodes.some((n) => n.id === currentNodeId && !completed.has(n.id))) {
      const next = nodes.find((n) => n.enabled && !completed.has(n.id));
      currentNodeId = next ? next.id : null;
    }
    if (raw.planningOutline && !Array.isArray(raw.planningOutline.episodes) && Array.isArray(raw.planningOutline.phases)) {
      raw.planningOutline.episodes = raw.planningOutline.phases.map((phase, index) => ({
        id: text(phase && phase.id) || uid("episode"),
        number: (index + 1) + "화",
        title: text(phase && phase.title) || "에피소드 " + (index + 1),
        status: index === 0 ? "현재" : "예정",
        purpose: text(phase && phase.purpose),
        startCondition: "",
        mustBeats: [],
        guideBeats: stringList(phase && phase.beats),
        beats: stringList(phase && phase.beats),
        endCondition: "",
        transition: text(phase && phase.transition),
      }));
      if (!raw.planningOutline.currentEpisode && raw.planningOutline.episodes[0]) {
        raw.planningOutline.currentEpisode = {
          number: raw.planningOutline.episodes[0].number,
          title: raw.planningOutline.episodes[0].title,
          status: "현재",
          confidence: "낮음",
          reason: "구버전 단계형 설계안을 자동 변환함. 필요하면 현재 화를 직접 지정해줘.",
          progress: "",
        };
      }
    }
    const planningHorizon = Math.max(2, Math.min(4, Number(raw.planningHorizon) || 3));
    if (raw.planningOutline && Array.isArray(raw.planningOutline.episodes) && raw.planningOutline.episodes.length > planningHorizon) {
      const allEpisodes = raw.planningOutline.episodes.slice();
      const currentNo = text(raw.planningOutline.currentEpisode && raw.planningOutline.currentEpisode.number);
      let currentIndex = currentNo ? allEpisodes.findIndex((ep) => text(ep && ep.number) === currentNo) : -1;
      if (currentIndex < 0) currentIndex = allEpisodes.findIndex((ep) => text(ep && ep.status) === "현재");
      if (currentIndex < 0) currentIndex = allEpisodes.findIndex((ep) => text(ep && ep.status) !== "완료");
      if (currentIndex < 0) currentIndex = 0;
      const later = allEpisodes.slice(currentIndex + planningHorizon);
      const anchors = stringList(raw.planningOutline.futureAnchors);
      for (const ep of later.slice(0, 5)) {
        const label = [text(ep && ep.number), text(ep && ep.title)].filter(Boolean).join(" · ");
        if (label && !anchors.includes(label)) anchors.push(label);
      }
      raw.planningOutline.episodes = allEpisodes.slice(currentIndex, currentIndex + planningHorizon);
      raw.planningOutline.futureAnchors = anchors.slice(0, 5);
      raw.planningOutline.endingCondition = "";
    }
    return Object.assign(base, raw, {
      version: 1,
      experienceMode: ['direct','ai'].includes(raw.experienceMode) ? raw.experienceMode :
        (raw.planningLocked || nodes.length ? 'ai' : 'direct'),
      modernDirection: text(raw.modernDirection),
      modernPlannedDirection: text(raw.modernPlannedDirection),
      modernStorySetup: text(raw.modernStorySetup).slice(0,30000),
      modernTrackingEnabled: raw.modernTrackingEnabled !== false,
      modernContinuous: raw.modernContinuous === true,
      storyBlueprint: normalizeStoryBlueprint(raw.storyBlueprint),
      storyStudio: normalizeStoryStudio(raw.storyStudio),
      blueprintHistory: Array.isArray(raw.blueprintHistory) ? raw.blueprintHistory.slice(-5).map(normalizeStoryBlueprint) : [],
      blueprintFocusId: text(raw.blueprintFocusId),
      modernPlannedBlueprintAt: Number(raw.modernPlannedBlueprintAt) || 0,
      storyNotebook: normalizeStoryNotebook(raw.storyNotebook),
      destination: text(raw.destination),
      storyMode: raw.storyMode === "sunny" ? "sunny" : "normal",
      writerQualityMode: ["basic","strong","max"].includes(raw.writerQualityMode) ? raw.writerQualityMode : "strong",
      executionMode: raw.executionMode === "manual" ? "manual" : "ai",
      interactivePacing: raw.interactivePacing !== false,
      cameoAutoUse: raw.cameoAutoUse !== false,
      nextEpisodeDirection: text(raw.nextEpisodeDirection),
      nextEpisodeDraft: text(raw.nextEpisodeDraft),
      nextEpisodeChoices: Array.isArray(raw.nextEpisodeChoices) ? raw.nextEpisodeChoices.slice(0,3).map((x, i) => ({
        id: text(x && x.id) || ("next_" + i),
        title: text(x && x.title),
        premise: text(x && x.premise),
        highlights: text(x && x.highlights),
        why: text(x && x.why),
        writerSeed: text(x && x.writerSeed),
      })) : [],
      nextEpisodeAnchor: text(raw.nextEpisodeAnchor),
      nextEpisodeGeneratedAt: Number(raw.nextEpisodeGeneratedAt) || 0,
      nextEpisodeStale: raw.nextEpisodeStale !== false,
      ntrKnowledgeLedger: raw.ntrKnowledgeLedger && typeof raw.ntrKnowledgeLedger === "object" ? raw.ntrKnowledgeLedger : null,
      storySuggestions: Array.isArray(raw.storySuggestions) ? raw.storySuggestions.slice(0, 5).map((item, index) => ({
        id: text(item && item.id) || ("suggestion_" + index),
        title: text(item && item.title),
        hook: text(item && item.hook),
        openingScene: text(item && item.openingScene),
        whyFits: text(item && item.whyFits),
        seed: text(item && item.seed),
        sceneIdeas: stringList(item && item.sceneIdeas).slice(0, 4),
      })).filter((item) => item.title || item.seed || item.hook) : [],
      storySuggestionGeneratedAt: Number.isFinite(raw.storySuggestionGeneratedAt) ? raw.storySuggestionGeneratedAt : 0,
      directorInput: text(raw.directorInput),
      directorAnalysis: raw.directorAnalysis && typeof raw.directorAnalysis === "object" ? Object.assign({}, raw.directorAnalysis) : null,
      directorUpdatedAt: Number.isFinite(raw.directorUpdatedAt) ? raw.directorUpdatedAt : 0,
      planningHorizon,
      nodes,
      currentNodeId,
      completedNodeIds: Array.from(completed),
      sceneIdeas: stringList(raw.sceneIdeas),
      selectedSceneCardIds: stringList(raw.selectedSceneCardIds),
      planningChat: Array.isArray(raw.planningChat)
        ? raw.planningChat.filter((m) => m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string").slice(-24)
        : [],
      constraints: stringList(raw.constraints),
      forbidden: stringList(raw.forbidden),
      mutationPackOverrides: raw.mutationPackOverrides && typeof raw.mutationPackOverrides === "object"
        ? Object.assign({}, raw.mutationPackOverrides)
        : {},
      currentEpisodeOverride: text(raw.currentEpisodeOverride),
      episodeRuntimeStatus: raw.episodeRuntimeStatus && typeof raw.episodeRuntimeStatus === "object" ? Object.assign({}, raw.episodeRuntimeStatus) : {},
      autoRun: raw.autoRun === true,
      running: raw.running === true,
      paused: raw.paused === true,
      generationNonce: text(raw.generationNonce) || uid("gen"),
      lastStatus: text(raw.lastStatus) || "idle",
      lastReason: text(raw.lastReason),
      updatedAt: Number.isFinite(raw.updatedAt) ? raw.updatedAt : Date.now(),
    });
  }

  function normalizeSceneCard(raw, index) {
    return {
      id: text(raw && raw.id) || uid("scene"),
      title: text(raw && raw.title) || "씬 " + (index + 1),
      description: text(raw && raw.description),
      tags: stringList(raw && raw.tags),
      createdAt: Number.isFinite(raw && raw.createdAt) ? raw.createdAt : Date.now(),
    };
  }

  async function loadSceneLibrary() {
    try {
      const raw = await risuai.pluginStorage.getItem(SCENE_LIBRARY_KEY);
      sceneLibrary = Array.isArray(raw) ? raw.map(normalizeSceneCard) : [];
    } catch (_) {
      sceneLibrary = [];
    }
    return sceneLibrary;
  }

  async function saveSceneLibrary() {
    await risuai.pluginStorage.setItem(SCENE_LIBRARY_KEY, sceneLibrary);
  }

  function normalizeCameoEntry(raw, index) {
    const source = raw && typeof raw === "object" ? raw : {};
    return {
      id: text(source.id) || uid("cameo"),
      name: text(source.name).trim() || ("카메오 " + (index + 1)),
      aliases: stringList(source.aliases).map((x) => text(x).trim()).filter(Boolean),
      loreBlocks: Array.isArray(source.loreBlocks) ? source.loreBlocks.map((block, blockIndex) => ({
        title: text(block && block.title).trim() || ("Lore " + (blockIndex + 1)),
        key: text(block && block.key),
        content: text(block && block.content).trim(),
      })).filter((block) => block.content) : [],
      loreText: text(source.loreText),
      sourceCharacterId: text(source.sourceCharacterId),
      sourceCharacterName: text(source.sourceCharacterName),
      sourceChatId: text(source.sourceChatId),
      enabled: source.enabled !== false,
      savedAt: Number.isFinite(source.savedAt) ? source.savedAt : Date.now(),
      updatedAt: Number.isFinite(source.updatedAt) ? source.updatedAt : Date.now(),
      lastUsedAt: Number.isFinite(source.lastUsedAt) ? source.lastUsedAt : 0,
      useCount: Number.isFinite(source.useCount) ? source.useCount : 0,
      libraryVersion: CAMEO_LIBRARY_VERSION,
    };
  }

  async function loadCameoLibrary() {
    try {
      const raw = await risuai.pluginStorage.getItem(CAMEO_LIBRARY_KEY);
      const rows = raw && Array.isArray(raw.entries) ? raw.entries : (Array.isArray(raw) ? raw : []);
      cameoLibrary = rows.map(normalizeCameoEntry);
      cameoStatus = cameoLibrary.length ? ("보관 " + cameoLibrary.length + "명") : "비어 있음";
    } catch (error) {
      cameoLibrary = [];
      cameoStatus = "불러오기 실패";
      console.log("[StoryRunner] cameo library load failed", error);
    }
    return cameoLibrary;
  }

  async function saveCameoLibrary() {
    await risuai.pluginStorage.setItem(CAMEO_LIBRARY_KEY, {
      version: CAMEO_LIBRARY_VERSION,
      entries: cameoLibrary,
      updatedAt: Date.now(),
    });
    cameoStatus = cameoLibrary.length ? ("보관 " + cameoLibrary.length + "명") : "비어 있음";
  }

  function cameoEntryText(entry, maxChars) {
    const limit = Math.max(400, Number(maxChars) || 2400);
    const raw = text(entry && entry.loreText).trim() || (Array.isArray(entry && entry.loreBlocks)
      ? entry.loreBlocks.map((block) => "### " + text(block.title || block.key || "Lore") + "\n" + text(block.content)).join("\n\n")
      : "");
    return raw.slice(0, limit);
  }

  function enabledCameoEntries() {
    return (Array.isArray(cameoLibrary) ? cameoLibrary : []).filter((entry) => entry && entry.enabled !== false && text(entry.name).trim());
  }

  function compactCameoPool(maxEntries, maxCharsEach) {
    if (!project.cameoAutoUse) return [];
    const rows = enabledCameoEntries().slice();
    rows.sort((a, b) => {
      const au = Number(a && a.lastUsedAt) || 0;
      const bu = Number(b && b.lastUsedAt) || 0;
      if (au !== bu) return au - bu;
      return (Number(b && b.updatedAt) || 0) - (Number(a && a.updatedAt) || 0);
    });
    return rows.slice(0, maxEntries || 10).map((entry) => ({
      id: entry.id,
      name: entry.name,
      aliases: entry.aliases,
      lore: cameoEntryText(entry, maxCharsEach || 1800),
      lastUsedAt: entry.lastUsedAt || 0,
      useCount: entry.useCount || 0,
    }));
  }

  function loreEntryLooksLikeMutation(entry) {
    const key = text(entry && (entry.key || entry.keys || entry.name));
    const comment = text(entry && (entry.comment || entry.title));
    const content = text(entry && (entry.content || entry.text));
    const hay = (key + "\n" + comment + "\n" + content).toLowerCase();
    return /mutation|개변|rewrite reality|compiled canon|runtime packet|state owner|mutation world canon|v130_|world_\d+__|male_dominance|common_sense|risu-state-rule-engine|상태 충돌 해소|상태 지속 공통 계약/.test(hay);
  }

  function loreEntryMentionsCharacter(entry, characterName) {
    const name = text(characterName).trim().toLowerCase();
    if (!name) return false;
    const key = text(entry && (entry.key || entry.keys || entry.name));
    const comment = text(entry && (entry.comment || entry.title));
    const content = text(entry && (entry.content || entry.text));
    return (key + "\n" + comment + "\n" + content).toLowerCase().includes(name);
  }

  async function collectCurrentCharacterLoreForCameo() {
    const target = await requireTarget();
    const character = await risuai.getCharacterFromIndex(target.characterIndex);
    if (!character) throw new Error("현재 캐릭터를 읽지 못했습니다.");
    const name = text(character.name).trim();
    if (!name) throw new Error("현재 캐릭터 이름을 확인하지 못했습니다.");

    let entries = [];
    try {
      const rawEntries = await risuai.getCurrentLorebookEntries();
      entries = Array.isArray(rawEntries) ? rawEntries : [];
    } catch (_) {}

    const loreBlocks = entries.filter((entry) => {
      if (!entry || loreEntryLooksLikeMutation(entry)) return false;
      return loreEntryMentionsCharacter(entry, name);
    }).slice(0, 40).map((entry, index) => ({
      title: text(entry && (entry.comment || entry.title || entry.key || entry.name)).trim() || (name + " Lore " + (index + 1)),
      key: text(entry && (entry.key || entry.keys || entry.name)),
      content: text(entry && (entry.content || entry.text)).trim().slice(0, 8000),
    })).filter((block) => block.content);

    if (!loreBlocks.length) {
      throw new Error("현재 캐릭터 이름과 연결된 Risu 캐릭터 Lorebook 항목을 찾지 못했습니다. 캐릭터 카드·BardWiki 진행상태·세계관·Mutation 로어는 카메오 보관함에 대신 복사하지 않습니다.");
    }

    const loreText = loreBlocks.map((block) => "### " + block.title + "\n" + block.content).join("\n\n");
    return {
      name,
      loreBlocks,
      loreText,
      sourceCharacterId: target.characterId,
      sourceCharacterName: target.characterName || name,
      sourceChatId: target.chatId,
    };
  }

  async function saveCurrentCharacterLoreToCameoPool() {
    cameoStatus = "현재 캐릭터 로어 저장 중";
    if (uiOpen) renderUI();
    const collected = await collectCurrentCharacterLoreForCameo();
    const old = cameoLibrary.find((entry) =>
      (collected.sourceCharacterId && entry.sourceCharacterId === collected.sourceCharacterId) ||
      text(entry.name).trim() === collected.name
    );
    const savedAt = old && old.savedAt ? old.savedAt : Date.now();
    const next = normalizeCameoEntry({
      id: old ? old.id : uid("cameo"),
      name: collected.name,
      aliases: old ? old.aliases : [],
      loreBlocks: collected.loreBlocks,
      loreText: collected.loreText,
      sourceCharacterId: collected.sourceCharacterId,
      sourceCharacterName: collected.sourceCharacterName,
      sourceChatId: collected.sourceChatId,
      enabled: old ? old.enabled !== false : true,
      savedAt,
      updatedAt: Date.now(),
      lastUsedAt: old ? old.lastUsedAt : 0,
      useCount: old ? old.useCount : 0,
    }, 0);
    cameoLibrary = cameoLibrary.filter((entry) => entry.id !== next.id);
    cameoLibrary.unshift(next);
    await saveCameoLibrary();
    cameoStatus = next.name + " 저장 완료";
    return next;
  }

  async function setCameoEnabled(id, enabled) {
    const entry = cameoLibrary.find((item) => item.id === id);
    if (!entry) return;
    entry.enabled = !!enabled;
    entry.updatedAt = Date.now();
    await saveCameoLibrary();
  }

  async function deleteCameoEntry(id) {
    const oldLength = cameoLibrary.length;
    cameoLibrary = cameoLibrary.filter((entry) => entry.id !== id);
    if (cameoLibrary.length !== oldLength) await saveCameoLibrary();
  }

  async function markUsedCameosFromText(content) {
    const source = text(content);
    if (!source || !project.cameoAutoUse) return;
    let changed = false;
    for (const entry of enabledCameoEntries()) {
      const names = [entry.name].concat(entry.aliases || []).filter(Boolean);
      if (!names.some((name) => source.includes(name))) continue;
      entry.lastUsedAt = Date.now();
      entry.useCount = (Number(entry.useCount) || 0) + 1;
      changed = true;
    }
    if (changed) await saveCameoLibrary();
  }

  function cameoPoolInstruction() {
    if (!project.cameoAutoUse || !enabledCameoEntries().length) return "";
    return [
      "# OPTIONAL CROSS-BOT CAMEO LIBRARY",
      "The cameoPool contains reusable CHARACTER-LORE snapshots saved by Story Runner from other character chats/bots.",
      "Use a cameo only when the current scene naturally needs or benefits from a secondary/guest/NPC character, or when the user explicitly introduces an otherwise-new named character. Existing current-story cast takes priority.",
      "Before inventing a generic named mob for such a role, check whether one cameo naturally fits. If none fits, create an ordinary new NPC instead. Never force a cameo merely because the pool exists.",
      "A cameo is a SEPARATE INSTANCE in the current story. Preserve the supplied name and character-specific identity/personality/lore, but DO NOT import the source chat's plot progress, relationships, current location, Story Runner plan, or unrelated source-bot world canon.",
      "CURRENT-STORY CANON WINS: the current character card, active Risu Lorebook, Mutation-rewritten world canon, and current-story continuity remain authoritative. Adapt the cameo into that world instead of carrying incompatible source-world rules along with it.",
      "Once a cameo has appeared in this story, treat facts established here as this story's continuity. Do not write changes back into the source bot or the saved cameo snapshot automatically.",
      "Do not announce that a character is a cameo or came from another bot.",
    ].join("\n");
  }

  function selectedSceneCards() {
    const selected = new Set(project.selectedSceneCardIds);
    return sceneLibrary.filter((card) => selected.has(card.id));
  }

  async function detectTarget() {
    try {
      const characterIndex = await risuai.getCurrentCharacterIndex();
      const chatIndex = await risuai.getCurrentChatIndex();
      if (!Number.isFinite(characterIndex) || characterIndex < 0 || !Number.isFinite(chatIndex) || chatIndex < 0) return null;

      const character = await risuai.getCharacterFromIndex(characterIndex);
      if (!character) return null;

      let chat = null;
      try {
        chat = await risuai.getChatFromIndex(characterIndex, chatIndex);
      } catch (_) {
        return null;
      }
      if (!chat) return null;

      const characterId = text(character && character.chaId) || "char_" + characterIndex;
      const chatId = text(chat && chat.id) || "chat_" + chatIndex;
      return {
        characterIndex,
        chatIndex,
        characterId,
        chatId,
        characterName: text(character && character.name) || characterId,
        chatName: text(chat && chat.name) || chatId,
      };
    } catch (error) {
      console.log("[StoryRunner] no active chat context", error);
      return null;
    }
  }

  function storageKey(target) {
    return STORAGE_PREFIX + "_" + target.characterId + "_" + target.chatId;
  }

  async function saveProject() {
    if (!currentTarget) currentTarget = await detectTarget();
    if (!currentTarget) return false;
    project.updatedAt = Date.now();
    await risuai.pluginStorage.setItem(storageKey(currentTarget), project);
    return true;
  }

  async function loadProject(target) {
    const resolved = target || await detectTarget();
    if (!resolved) {
      currentTarget = null;
      project = emptyProject();
      return null;
    }
    currentTarget = resolved;
    const saved = await risuai.pluginStorage.getItem(storageKey(currentTarget));
    project = normalizeProject(saved);
    return project;
  }

  async function syncTarget() {
    const next = await detectTarget();
    if (!next) {
      currentTarget = null;
      project = emptyProject();
      if (uiOpen) renderUI();
      return null;
    }

    const changed = !currentTarget
      || next.characterIndex !== currentTarget.characterIndex
      || next.chatIndex !== currentTarget.chatIndex
      || next.characterId !== currentTarget.characterId
      || next.chatId !== currentTarget.chatId;

    if (changed) {
      if (currentTarget) {
        try { await saveProject(); } catch (_) {}
      }
      await loadProject(next);
      // Read-only preview for the active chat, never confuse it with another chat.
      try { await loadModernLivePreview(); } catch (_) {}
      notebookStatus = '';
      notebookError = '';
      modernShowSuggestions = false;
      blueprintEditorId = '';
      blueprintActOpenIds = new Set();

      // Chat-specific transient state must never leak across chats.
      mutationContextCache = null;
      mutationContextUpdatedAt = 0;
      mutationRefreshMessage = "";
      bridgeStatus = "미확인";
      hostPromptCapture = null;
      directPresetStatus = { name: "", blockCount: 0, blockNames: [], loadedAt: 0 };
      directTurnInstruction = "";
      directTurnDraft = "";
      directTurnError = "";
      characterBootstrapReport = null;
      characterBootstrapStatus = "미확인";

      try { await loadBardWikiDocuments(); } catch (_) {}
      if (uiOpen) renderUI();
    }
    return next;
  }

  async function requireTarget() {
    const target = await syncTarget();
    if (!target) throw new Error("먼저 Story Runner를 사용할 캐릭터 채팅을 열어 주세요.");
    return target;
  }

  function stopTargetWatch() {
    if (targetWatchTimer) clearInterval(targetWatchTimer);
    targetWatchTimer = null;
    targetWatchBusy = false;
  }

  function startTargetWatch() {
    stopTargetWatch();
    targetWatchTimer = setInterval(async () => {
      if (!uiOpen || targetWatchBusy) return;
      if (typeof document !== "undefined" && document.hidden) return;
      targetWatchBusy = true;
      try { await syncTarget(); } catch (_) {}
      finally { targetWatchBusy = false; }
    }, 1200);
  }

  function currentNode(value) {
    value = value || project;
    return value.nodes.find((n) => n.id === value.currentNodeId) || null;
  }

  function nextPendingNode(value) {
    value = value || project;
    const done = new Set(value.completedNodeIds);
    const enabled = value.nodes.filter((n) => n.enabled !== false);
    const currentIndex = enabled.findIndex((n) => n.id === value.currentNodeId);
    if (currentIndex >= 0) {
      for (let i = currentIndex; i < enabled.length; i++) {
        if (!done.has(enabled[i].id)) return enabled[i];
      }
    }
    return enabled.find((n) => !done.has(n.id)) || null;
  }

  function destinationReached(value) {
    value = value || project;
    const done = new Set(value.completedNodeIds);
    const finalNode = [...value.nodes].reverse().find((n) => n.control === "stop" || n.control === "target");
    return !!finalNode && done.has(finalNode.id);
  }


  async function onMutationBridgeResponse(message) {
    const requestId = text(message && message.requestId);
    if (!requestId) return;
    const waiter = bridgeWaiters.get(requestId);
    if (!waiter) return;
    bridgeWaiters.delete(requestId);
    waiter.resolve(message);
  }

  async function requestMutationContext(query, timeoutMs, activateForNextRequest) {
    timeoutMs = timeoutMs || 2500;
    const requestId = uid("bridge");

    const responsePromise = new Promise((resolve) => {
      const timer = setTimeout(() => {
        bridgeWaiters.delete(requestId);
        resolve({ ok: false, timeout: true });
      }, timeoutMs);

      bridgeWaiters.set(requestId, {
        resolve: (value) => {
          clearTimeout(timer);
          resolve(value);
        },
      });
    });

    try {
      await risuai.postPluginChannelMessage(
        MUTATION_PLUGIN_NAME,
        MUTATION_REQUEST_CHANNEL,
        {
          requestId,
          query: text(query),
          destination: project.destination,
          currentNode: currentNode(),
          packOverrides: project.mutationPackOverrides || {},
          activateForNextRequest: activateForNextRequest === true,
        }
      );
    } catch (error) {
      bridgeWaiters.delete(requestId);
      bridgeStatus = "연결 실패";
      return null;
    }

    const response = await responsePromise;
    if (response && response.ok && response.payload) {
      bridgeStatus = "연결됨";
      return response.payload;
    }

    bridgeStatus = response && response.timeout ? "응답 없음" : "연결 실패";
    return null;
  }

  async function clearMutationRuntimeOverride() {
    const requestId = uid("bridge-clear");
    const responsePromise = new Promise((resolve) => {
      const timer = setTimeout(() => {
        bridgeWaiters.delete(requestId);
        resolve(false);
      }, 1200);
      bridgeWaiters.set(requestId, {
        resolve: (value) => {
          clearTimeout(timer);
          resolve(!!(value && value.ok));
        },
      });
    });
    try {
      await risuai.postPluginChannelMessage(
        MUTATION_PLUGIN_NAME,
        MUTATION_REQUEST_CHANNEL,
        { requestId, action: "clearRuntimeOverride" }
      );
      await responsePromise;
    } catch (error) {
      bridgeWaiters.delete(requestId);
      console.log("[StoryRunner] mutation runtime override clear skipped", error);
    }
  }

  async function refreshMutationContextDirect(query, options) {
    options = options || {};
    const retries = Number.isFinite(options.retries) ? options.retries : 3;
    mutationRefreshBusy = true;
    mutationRefreshMessage = "Mutation 브리지 연결 확인 중...";
    if (uiOpen) renderUI();

    let last = null;
    try {
      for (let attempt = 1; attempt <= retries; attempt++) {
        mutationRefreshMessage = "Mutation 브리지 요청 " + attempt + "/" + retries;
        if (uiOpen) renderUI();

        const raw = await requestMutationContext(
          query || "현재 개변 상황 새로고침",
          3500,
          options.activateForNextRequest === true
        );
        const ctx = compactMutationContext(raw);
        if (ctx) {
          mutationContextCache = ctx;
          mutationContextUpdatedAt = Date.now();
          bridgeStatus = "연결됨";
          mutationRefreshMessage = "Mutation 연결 완료";
          return ctx;
        }
        last = raw;
        if (attempt < retries) await new Promise((resolve) => setTimeout(resolve, 350));
      }

      bridgeStatus = "응답 없음";
      mutationRefreshMessage = "Mutation 브리지 응답 없음";
      return null;
    } catch (error) {
      bridgeStatus = "연결 실패";
      mutationRefreshMessage = "Mutation 연결 실패: " + (error && error.message ? error.message : String(error));
      return null;
    } finally {
      mutationRefreshBusy = false;
      if (uiOpen) renderUI();
    }
  }

  function compactMutationContext(ctx) {
    if (!ctx) return null;
    return {
      mode: text(ctx.mode),
      source: text(ctx.source),
      activeStates: Array.isArray(ctx.activeStates) ? ctx.activeStates : [],
      knownStates: Array.isArray(ctx.knownStates) ? ctx.knownStates : [],
      availablePacks: Array.isArray(ctx.availablePacks) ? ctx.availablePacks : [],
      activePacks: Array.isArray(ctx.activePacks) ? ctx.activePacks : [],
      packOverrides: ctx.packOverrides && typeof ctx.packOverrides === "object" ? ctx.packOverrides : {},
      selectedRules: Array.isArray(ctx.selectedRules)
        ? ctx.selectedRules.slice(0, 32).map((r) => ({
            id: r.id,
            name: r.name,
            pack: r.pack,
            states: r.states,
            owner: r.owner,
            purpose: r.purpose,
            priority: r.priority,
            instruction: text(r.instruction).slice(0, 1400),
          }))
        : [],
      customRules: Array.isArray(ctx.customRules) ? ctx.customRules.slice(0, 24) : [],
      libraryStats: ctx.libraryStats || {},
    };
  }


  async function loadBardWikiDocuments() {
    try {
      const chars = await risuai.bardWiki.getDocuments({ types: ["character"], statuses: ["active"] });
      characterDocs = Array.isArray(chars) ? chars : [];
      // v0.42+: [개변] BardWiki copies are legacy only. Mutation v0.27+
      // supplies the global Master rule library through the plugin bridge.
      mutationWikiDocs = [];
    } catch (error) {
      console.log("[StoryRunner] BardWiki character document list failed", error);
    }
    return { characterDocs, mutationWikiDocs };
  }

  function compactWikiDocs(docs, maxDocs, maxChars) {
    return (Array.isArray(docs) ? docs : []).slice(0, maxDocs || 40).map((doc) => ({
      id: doc.id,
      title: doc.title,
      aliases: Array.isArray(doc.aliases) ? doc.aliases : [],
      contextMode: doc.contextMode,
      content: text(doc.content).slice(0, maxChars || 5000),
    }));
  }

  function currentCharacterToMarkdown(character) {
    const lines = [
      "# " + (text(character && character.name) || "캐릭터"),
      "",
      "이 문서는 Story Runner가 현재 캐릭터 카드에서 만든 편집용 캐릭터 설정 문서임.",
      "이후 전개 설계와 BardWiki 컨텍스트에서 우선 참고할 수 있음.",
      "",
    ];

    const fields = [
      ["설명", character && (character.desc || character.description)],
      ["성격", character && (character.personality || character.persona)],
      ["시나리오", character && character.scenario],
      ["첫 메시지", character && (character.firstMessage || character.first_mes)],
      ["메모", character && (character.note || character.creatorcomment)],
    ];

    for (const [label, value] of fields) {
      const body = text(value).trim();
      if (!body) continue;
      lines.push("## " + label, "", body, "");
    }

    return lines.join("\n");
  }

  async function startCharacterDocFromCurrent() {
    await requireTarget();
    const character = await risuai.getCharacterFromIndex(currentTarget.characterIndex);
    if (!character) throw new Error("현재 캐릭터를 읽지 못했습니다.");
    editingCharacterDocId = null;
    characterEditorTitle = text(character.name) || "캐릭터 설정";
    characterEditorMarkdown = currentCharacterToMarkdown(character);
    characterEditorInstruction = "";
    uiTab = "characters";
    renderUI();
  }

  async function saveCharacterDoc() {
    await requireTarget();
    const title = text(characterEditorTitle).trim();
    const markdown = text(characterEditorMarkdown).trim();
    if (!title) throw new Error("캐릭터 문서 제목을 입력해 주세요.");
    if (!markdown) throw new Error("캐릭터 문서 내용을 입력해 주세요.");

    const old = editingCharacterDocId
      ? characterDocs.find((doc) => doc.id === editingCharacterDocId)
      : null;

    const saved = await risuai.bardWiki.saveDocument({
      documentId: old ? old.id : undefined,
      type: "character",
      title,
      aliases: [title],
      markdown,
      expectedContentHash: old ? old.contentHash : undefined,
    });
    if (!saved) throw new Error("캐릭터 문서 저장이 취소되었거나 실패했습니다.");

    editingCharacterDocId = saved.id;
    characterEditorTitle = saved.title;
    characterEditorMarkdown = saved.content;

    try {
      const modeUpdated = await risuai.bardWiki.setContextMode({
        documentId: saved.id,
        contextMode: "always",
        expectedContentHash: saved.contentHash,
      });
      if (modeUpdated) {
        characterEditorMarkdown = modeUpdated.content;
      }
    } catch (error) {
      console.log("[StoryRunner] character contextMode update skipped", error);
    }

    await loadBardWikiDocuments();
    return saved;
  }

  async function deleteCharacterDoc() {
    if (!editingCharacterDocId) return;
    await risuai.bardWiki.trashDocument(editingCharacterDocId);
    editingCharacterDocId = null;
    characterEditorTitle = "";
    characterEditorMarkdown = "";
    characterEditorInstruction = "";
    await loadBardWikiDocuments();
    renderUI();
  }

  async function reviseCharacterDocWithAI() {
    const instruction = text(characterEditorInstruction).trim();
    if (!instruction) throw new Error("AI에게 요청할 수정 내용을 입력해 주세요.");
    if (!characterEditorMarkdown.trim()) throw new Error("먼저 캐릭터 문서 내용을 준비해 주세요.");

    characterBusy = true;
    if (uiOpen) renderUI();

    try {
      const response = await auxiliary([
        {
          role: "system",
          content: [
            "You edit one BardWiki character document for long-form roleplay/story planning.",
            "Return JSON only.",
            "Preserve facts the user did not ask to change.",
            "Do not silently invent family, job, ownership, identity, relationship, or history.",
            "Make the document easy for Story Runner and normal chat generation to use.",
            "Prefer clear Korean headings and concrete behavioral facts.",
            "Schema: {\"title\":string,\"markdown\":string,\"reply\":string}",
          ].join("\n"),
        },
        {
          role: "user",
          content: JSON.stringify({
            editRequest: instruction,
            title: characterEditorTitle,
            markdown: characterEditorMarkdown,
            destination: project.destination,
          }),
        },
      ]);
      const parsed = extractJson(response);
      if (typeof parsed.title === "string" && parsed.title.trim()) characterEditorTitle = parsed.title.trim();
      if (typeof parsed.markdown === "string" && parsed.markdown.trim()) characterEditorMarkdown = parsed.markdown.trim();
      characterEditorInstruction = "";
      project.lastReason = text(parsed.reply) || "캐릭터 문서 수정안을 만들었어.";
    } finally {
      characterBusy = false;
      if (uiOpen) renderUI();
    }
  }



  function normalizeCharacterTitle(name) {
    name = text(name).trim();
    return name || "이름 미확인";
  }

  function findCharacterWikiByName(name) {
    const target = normalizeCharacterTitle(name);
    return (Array.isArray(characterDocs) ? characterDocs : []).find((doc) => {
      const title = text(doc && doc.title).trim();
      const aliases = Array.isArray(doc && doc.aliases)
        ? doc.aliases.map((x) => text(x).trim())
        : [];
      return title === target || aliases.includes(target);
    }) || null;
  }

  async function collectCharacterBootstrapSources() {
    const currentCharacter = await readCurrentCharacterSnapshot();

    let wikiContext = { content: "", recentMessages: [] };
    try {
      wikiContext = await risuai.bardWiki.getContext({
        query: project.destination || "등장인물 캐릭터 관계 현재 상태",
      });
    } catch (_) {}

    let lore = [];
    try {
      const entries = await risuai.getCurrentLorebookEntries();
      lore = Array.isArray(entries)
        ? entries.slice(0, 40).map((entry) => ({
            key: entry && (entry.key || entry.keys || entry.name) || "",
            comment: entry && (entry.comment || entry.title) || "",
            content: text(entry && (entry.content || entry.text)).slice(0, 900),
          }))
        : [];
    } catch (_) {}

    const recentMessages = Array.isArray(wikiContext && wikiContext.recentMessages)
      ? wikiContext.recentMessages.slice(-12).map((m) => ({
          role: m.role === "char" ? "assistant" : m.role,
          content: text(m.data || m.content).slice(0, 1600),
        }))
      : [];

    return { currentCharacter, lore, recentMessages };
  }

  async function extractBootstrapCharacters() {
    const sources = await collectCharacterBootstrapSources();

    const response = await auxiliary([
      {
        role: "system",
        content: [
          "You bootstrap BardWiki character documents for an existing or newly-started roleplay.",
          "Return JSON only.",
          "Identify important NAMED characters already established in the current character card, lorebook/module entries, and recent messages.",
          "Do NOT invent new characters.",
          "Do NOT include unnamed classmates, generic groups, organizations, locations, concepts, or mutation rules as characters.",
          "If many named characters exist, select recurring/important characters relevant to the current roleplay or destination.",
          "For each selected character, write a concise INITIAL living-state document in Korean.",
          "Preserve source facts only.",
          "Do not add unsupported age, family, job, ownership, relationship, history, personality, role, school year, or secret facts.",
          "This is a present-state baseline, not a future story plan.",
          "Do not copy general mutation rules into a character document unless a durable character-specific consequence is already established.",
          "Schema: {\"characters\":[{\"name\":string,\"aliases\":string[],\"markdown\":string,\"sourceBasis\":string}]}",
        ].join("\n"),
      },
      {
        role: "user",
        content: JSON.stringify({
          destination: project.destination,
          currentCharacter: sources.currentCharacter ? {
            name: text(sources.currentCharacter.name),
            description: text(sources.currentCharacter.description).slice(0, 6000),
            personality: text(sources.currentCharacter.personality).slice(0, 4000),
            scenario: text(sources.currentCharacter.scenario).slice(0, 4000),
            firstMessage: text(sources.currentCharacter.firstMessage).slice(0, 3000),
            notes: text(sources.currentCharacter.notes).slice(0, 3000),
          } : null,
          lore: sources.lore,
          recentMessages: sources.recentMessages,
          existingCharacterWikiTitles: (characterDocs || []).map((doc) => doc.title),
        }),
      },
    ]);

    let parsed;
    try {
      parsed = extractJson(response);
    } catch (firstError) {
      // Large casts occasionally produce almost-valid JSON with an unescaped line break.
      // Ask the auxiliary model to repair formatting only, preserving the extracted facts.
      const repaired = await auxiliary([
        {
          role: "system",
          content: [
            "Repair the supplied character-bootstrap result into strict valid JSON.",
            "Return JSON only. Do not add, remove, merge, rename, or reinterpret characters.",
            "Escape all line breaks inside JSON strings as \n and escape quotes correctly.",
            "Required schema: {\"characters\":[{\"name\":string,\"aliases\":string[],\"markdown\":string,\"sourceBasis\":string}]}",
          ].join("\n"),
        },
        { role: "user", content: text(response).slice(0, 30000) },
      ]);
      parsed = extractJson(repaired);
    }
    return Array.isArray(parsed.characters) ? parsed.characters : [];
  }

  async function bootstrapCharacterWiki(force) {
    await requireTarget();
    await loadBardWikiDocuments();

    if (!force && Array.isArray(characterDocs) && characterDocs.length > 0) {
      characterBootstrapStatus = "기존 문서 사용";
      characterBootstrapReport = {
        created: 0,
        updated: 0,
        skipped: characterDocs.length,
        failed: 0,
        items: [],
      };
      return characterBootstrapReport;
    }

    characterBootstrapStatus = force ? "강제 재분석 중" : "분석 중";
    if (uiOpen) renderUI();

    const candidates = await extractBootstrapCharacters();
    const report = {
      created: 0,
      updated: 0,
      skipped: 0,
      failed: 0,
      items: [],
    };

    for (const candidate of candidates) {
      const name = normalizeCharacterTitle(candidate && candidate.name);
      if (!name || name === "이름 미확인") continue;

      const old = findCharacterWikiByName(name);

      if (old && !force) {
        report.skipped++;
        report.items.push({ name, status: "existing" });
        continue;
      }

      let saved = null;
      let errorText = "";

      try {
        saved = await risuai.bardWiki.saveDocument({
          documentId: old ? old.id : undefined,
          type: "character",
          title: name,
          aliases: Array.isArray(candidate.aliases)
            ? candidate.aliases.map((x) => text(x).trim()).filter(Boolean)
            : [],
          markdown: text(candidate.markdown).trim() || ("# " + name),
          expectedContentHash: old ? old.contentHash : undefined,
        });
      } catch (error) {
        errorText = error && error.message ? error.message : String(error);
      }

      if (!saved) {
        report.failed++;
        const permissionError = errorText || "BardWiki character 저장이 취소되었거나 쓰기 권한이 허용되지 않았습니다.";
        report.items.push({ name, status: "failed", error: permissionError });

        // saveDocument returns null when BardWiki write permission was denied/cancelled.
        // Repeating the same write for every character only creates a wall of identical errors.
        if (!errorText) {
          characterBootstrapStatus = "BardWiki 쓰기 권한 필요";
          const remaining = Math.max(0, candidates.length - report.created - report.updated - report.skipped - report.failed);
          if (remaining) {
            report.items.push({
              name: "나머지 " + remaining + "명",
              status: "failed",
              error: "첫 저장이 취소되어 일괄 생성을 중단했습니다. 플러그인 BardWiki 쓰기 권한을 허용한 뒤 다시 실행해 주세요.",
            });
            report.failed += remaining;
          }
          break;
        }
        continue;
      }

      if (old) report.updated++;
      else report.created++;

      report.items.push({
        name,
        status: old ? "updated" : "created",
        id: saved.id,
      });
    }

    await loadBardWikiDocuments();

    characterBootstrapReport = report;
    characterBootstrapStatus = report.failed
      ? "부분 완료"
      : ((report.created || report.updated) ? "완료" : "변경 없음");

    if (uiOpen) renderUI();
    return report;
  }

  async function ensureCharacterBootstrapBeforePlanning() {
    await loadBardWikiDocuments();
    characterBootstrapStatus = characterDocs.length
      ? "진행 변화 문서 사용"
      : "초기 세계관은 로어북 사용";
    return;
  }


  function renderCharacterBootstrapReport() {
    if (!characterBootstrapReport) return "";

    const rows = (characterBootstrapReport.items || []).slice(0, 40).map((item) => {
      const label =
        item.status === "created" ? "생성" :
        item.status === "updated" ? "갱신" :
        item.status === "existing" ? "기존" :
        "실패";

      return '<div class="task-step ' + (item.status === "failed" ? "failed" : "done") + '">' +
        '<span class="task-icon">' + (item.status === "failed" ? "×" : "✓") + '</span>' +
        '<div><b>' + escapeHtml(item.name) + '</b><small>' + escapeHtml(label) +
        (item.error ? " · " + item.error : "") + '</small></div></div>';
    }).join("");

    return '<details style="margin-top:8px"><summary>캐릭터 초기화 결과</summary>' +
      '<p class="status">생성 ' + characterBootstrapReport.created +
      ' / 갱신 ' + characterBootstrapReport.updated +
      ' / 기존 ' + characterBootstrapReport.skipped +
      ' / 실패 ' + characterBootstrapReport.failed + '</p>' +
      rows +
      '</details>';
  }

  async function readCurrentCharacterSnapshot() {
    try {
      const target = currentTarget || await detectTarget();
      if (!target) return null;

      const character = await risuai.getCharacterFromIndex(target.characterIndex);
      if (!character) return null;

      return {
        name: text(character.name),
        description: text(character.desc || character.description),
        personality: text(character.personality || character.persona),
        scenario: text(character.scenario),
        firstMessage: text(character.firstMessage || character.first_mes),
        notes: text(character.note || character.creatorcomment),
      };
    } catch (error) {
      console.log("[StoryRunner] current character snapshot failed", error);
      return null;
    }
  }

  function mutationDocPack(doc) {
    const content = text(doc && doc.content);
    const marker = "<!-- MUTATION_WIKI_META ";
    const start = content.indexOf(marker);
    if (start < 0) return "UNCLASSIFIED";
    const end = content.indexOf(" -->", start);
    if (end < 0) return "UNCLASSIFIED";
    try {
      const meta = JSON.parse(content.slice(start + marker.length, end));
      return text(meta && meta.pack).trim().toUpperCase() || "UNCLASSIFIED";
    } catch (_) {
      return "UNCLASSIFIED";
    }
  }

  function filteredMutationWikiDocsForContext(mutationContext) {
    // Legacy compatibility field only. Runtime mutation mechanics are supplied
    // by mutationContext.selectedRules from Mutation State v0.27+ global Master.
    return [];
  }

  async function armMutationPackOverrideForNextGeneration(query) {
    try {
      const ctx = compactMutationContext(
        await requestMutationContext(query || project.destination || "Story Runner generation", 2500, true)
      );
      if (ctx) {
        mutationContextCache = ctx;
        mutationContextUpdatedAt = Date.now();
      }
      return ctx;
    } catch (error) {
      console.log("[StoryRunner] mutation pack override arm failed", error);
      return mutationContextCache;
    }
  }

  function packOverrideMode(packId) {
    return text(project.mutationPackOverrides && project.mutationPackOverrides[packId]) || "inherit";
  }

  async function setPackOverride(packId, mode) {
    if (!project.mutationPackOverrides || typeof project.mutationPackOverrides !== "object") {
      project.mutationPackOverrides = {};
    }
    if (mode === "inherit") delete project.mutationPackOverrides[packId];
    else project.mutationPackOverrides[packId] = mode;
    await saveProject();

    try {
      await refreshMutationContextDirect("Story Runner Pack 설정 갱신", { retries: 2 });
    } catch (_) {}

    if (uiOpen) renderUI();
  }

  async function readPlanningContext(queryOverride, activateForNextRequest) {
    let wiki = { content: "", recentMessages: [] };
    try {
      wiki = await risuai.bardWiki.getContext({ query: project.destination || undefined });
    } catch (error) {
      console.log("[StoryRunner] BardWiki fallback", error);
    }

    // Actual accepted chat takes precedence over stale BardWiki snapshots.
    let recentMessages = Array.isArray(wiki && wiki.recentMessages)
      ? wiki.recentMessages.slice(-10).map((m) => ({
          role: m.role === "char" ? "assistant" : m.role,
          content: text(m.data || m.content),
        }))
      : [];
    try {
      const live = await readDirectorLiveTail();
      if (Array.isArray(live) && live.length) recentMessages = live.slice(-8);
    } catch (error) { console.log('[StoryRunner] planning live chat fallback', error); }

    let mutationContext = null;
    try {
      const mutationQuery = [
        text(queryOverride),
        project.destination,
        project.sceneIdeas.join("\n"),
        currentNode() && currentNode().instruction,
        recentMessages.slice(-4).map((m) => m.content).join("\n"),
      ].filter(Boolean).join("\n");

      // Mutation v0.30+ directly rewrites the real character card and Risu lorebook.
      // The bridge normally only ensures that direct rewrite is current. Explicit
      // Story Runner Pack Overrides remain temporary runtime additions.
      mutationContext = compactMutationContext(
        await requestMutationContext(mutationQuery, 2500, activateForNextRequest === true)
      );
      if (mutationContext) {
        mutationContextCache = mutationContext;
        mutationContextUpdatedAt = Date.now();
      }
    } catch (error) {
      console.log("[StoryRunner] mutation bridge fallback", error);
      mutationContext = mutationContextCache;
    }

    let lore = [];
    try {
      const entries = await risuai.getCurrentLorebookEntries();
      lore = Array.isArray(entries) ? entries.slice(0, 100).map((entry) => ({
        key: entry && (entry.key || entry.keys || entry.name) || "",
        comment: entry && (entry.comment || entry.title) || "",
        content: text(entry && (entry.content || entry.text)).slice(0, 2400),
      })) : [];
    } catch (_) {}

    try { await loadBardWikiDocuments(); } catch (_) {}
    const currentCharacter = await readCurrentCharacterSnapshot();

    return {
      wikiContent: [text(wiki && wiki.content).slice(0, 18000), storySetupPromptText(), notebookPromptText()].filter(Boolean).join('\n\n'),
      recentMessages,
      lore,
      currentCharacter,
      characterWikiDocs: compactWikiDocs(characterDocs, 40, 6000),
      cameoPool: compactCameoPool(10, 2200),
      mutationWikiDocs: [],
      mutationContext: mutationContext || mutationContextCache,
      storyDNA: storyDnaPromptText("writer"),
    };
  }

  async function runInternalLLM(options) {
    internalLLMCallDepth += 1;
    try {
      return await risuai.runLLMModel(options);
    } finally {
      internalLLMCallDepth = Math.max(0, internalLLMCallDepth - 1);
    }
  }

  function normalizeModelText(result) {
    if (typeof result === "string") return result;
    if (result && typeof result.result === "string") return result.result;
    if (result && typeof result.content === "string") return result.content;
    return "";
  }

  function stripThoughts(value) {
    return text(value)
      .replace(/<Thoughts>[\s\S]*?<\/Thoughts>/gi, "")
      .replace(/<think>[\s\S]*?<\/think>/gi, "")
      .replace(/<analysis>[\s\S]*?<\/analysis>/gi, "")
      .replace(/<reasoning>[\s\S]*?<\/reasoning>/gi, "")
      .trim();
  }

  function extractVisibleModelText(result) {
    const raw = normalizeModelText(result).trim();
    if (!raw) return "";

    // Direct fiction calls use a hard envelope so provider-visible reasoning or
    // English planning text can never leak into the inserted story. Preserve the
    // completion marker outside the envelope for episode advancement.
    const storyTag = raw.match(/<SR_STORY>([\s\S]*?)<\/SR_STORY>/i);
    if (storyTag && text(storyTag[1]).trim()) {
      const story = stripThoughts(storyTag[1]);
      return story + (raw.includes(COMPLETE_MARKER) ? "\n" + COMPLETE_MARKER : "");
    }

    const responseTag = raw.match(/<Response>([\s\S]*?)<\/Response>/i);
    if (responseTag && text(responseTag[1]).trim()) {
      return stripThoughts(responseTag[1]);
    }

    const responseHeading = raw.match(/(?:^|\n)#{1,4}\s*Response\s*\n([\s\S]*)$/i);
    if (responseHeading && text(responseHeading[1]).trim()) {
      return stripThoughts(responseHeading[1])
        .replace(/<EvaluationReport>[\s\S]*$/i, "")
        .trim();
    }

    return stripThoughts(raw)
      .replace(/<EvaluationReport>[\s\S]*$/i, "")
      .trim();
  }

  function storyOutputLooksContaminated(value) {
    const s = text(value).trim();
    if (!s) return true;
    const head = s.slice(0, 5000);
    if (/(?:^|\n)\s*(?:생각의\s*사슬|chain\s+of\s+thought|reasoning|analysis)\b/i.test(head)) return true;
    if (/(?:^|\n)\s*(?:okay[, ]|approved\b|no safety\b|let me\b|i need to\b|i should\b|we need to\b|the user\b|system says\b|developer says\b|previous response\b|user input\b)/i.test(head)) return true;
    if (/<(?:think|thoughts|analysis|reasoning)>/i.test(head)) return true;
    if (/\b(?:Core conflict|Possible actual narrative|Potential structure|Need image tag|Let['’]s craft|I will now respond)\b/i.test(head)) return true;
    const hangul = (s.match(/[가-힣]/g) || []).length;
    const latin = (s.match(/[A-Za-z]/g) || []).length;
    // Long fiction that is overwhelmingly Latin-script is almost certainly a
    // language drift/meta-output failure for this Korean RP workflow.
    if (s.length > 800 && latin > Math.max(500, hangul * 1.15)) return true;
    return false;
  }

  // v0.93: Safety-oriented STORY QUALITY GATE. This is deliberately separate
  // from the stylistic premium critic: even fast/balanced output must be readable.
  // It is only used for AI-generated fiction, never the user's manual prose.
  const storyQualityVerdicts = new Map();
  const STORY_QUALITY_GATE_TIMEOUT_MS = 90000;
  function storyQualityKey(value) {
    const src = text(value);
    let hash = 2166136261;
    for (let i = 0; i < src.length; i++) hash = Math.imul(hash ^ src.charCodeAt(i), 16777619);
    return String(src.length) + ':' + (hash >>> 0).toString(36);
  }
  // Candidate typo detection is intentionally narrow. A model may write
  // "something"+Korean suffix legally, but lower-case Latin embedded AFTER a
  // Korean stem, repeated in prose, is a common output-decoding failure.
  function storyMixedScriptFragments(value) {
    const segments = text(value).match(/[\uAC00-\uD7A3A-Za-z]{4,}/g) || [];
    return segments.filter(token => {
      if (!/^[\uAC00-\uD7A3]/.test(token)) return false;
      const pieces=token.match(/[\uAC00-\uD7A3]+|[A-Za-z]+/g)||[];
      if (pieces.length < 2) return false;
      return pieces.some((chunk,index) => index > 0 && /^[a-z]{3,}$/.test(chunk));
    }).slice(0,8);
  }
  function compactRecoveryMessages(messages) {
    // Replaying the entire failed prompt caused the same corruption to recur.
    // Preserve bookend canon, newest actual chat and explicit last instruction.
    const rows=Array.isArray(messages)?messages:[];
    const systems=rows.filter(m=>m && m.role==='system').map(m=>text(m.content));
    const joined=systems.join('\n\n');
    const bounded=joined.length<=9500?joined:(joined.slice(0,6600)+'\n[older context omitted for clean retry]\n'+joined.slice(-2500));
    const recent=rows.filter(m=>m && (m.role==='user'||m.role==='assistant'))
      .slice(-5).map(m=>({role:m.role,content:text(m.content).slice(-2000)}))
      .filter(m=>m.content.trim());
    return [{role:'system',content:[
      'You write Korean fiction using the MAIN writer model. Use natural standard Korean spelling, spacing and grammar.',
      'Do not blend Korean syllables with Latin letters inside a Korean word; keep established foreign names as standalone words.',
      'Use exact established names, relationships, present moment and world facts from the context below.',
      'Do NOT recap, invent a plot reset, accelerate chapter completion, or invent facts to compensate for missing context.',
      'Give only story prose within <SR_STORY>...</SR_STORY>. No analysis or critiques.',
      '# RELEVANT CANON AND SCENE CONTRACT\n'+bounded,
    ].join('\n')}].concat(recent);
  }
  async function repairMixedScriptDraft(candidate, fragments) {
    const source=text(candidate).replaceAll(COMPLETE_MARKER,'').trim();
    if (!source || source.length<250 || source.length>17000 || fragments.length>7) return '';
    // A copy-edit pass is attempted ONLY for narrow, recognizable mixed-script
    // typos. Never try to patch wholly incoherent plots or word salad.
    try {
      const out=await runInternalLLM({mode:'model',allowPlugins:false,messages:[
        {role:'system',content:[
          'You are a literal Korean fiction copy editor, using the MAIN model.',
          'ONLY repair unreadable Korean/Latin blended words and immediately adjacent broken word spacing.',
          'Preserve the original story, events, paragraphs, dialogue, names, character decisions, and ending exactly.',
          'Do not translate established foreign proper nouns, invent content or add a new scene.',
          'If an intended word is unclear, keep its original sense by using the closest grammatical Korean expression.',
          'Return the entire corrected prose INSIDE <SR_STORY>...</SR_STORY>; no explanation.'
        ].join('\n')},
        {role:'user',content:'Suspected broken words: '+fragments.join(' / ')+'\n\n<SR_STORY>\n'+source+'\n</SR_STORY>'}
      ]});
      if (!out || (out.type && out.type!=='success')) return '';
      const raw=normalizeModelText(out);
      const body=raw.match(/<SR_STORY>([\s\S]*?)<\/SR_STORY>/i);
      if(!body)return '';
      const corrected=stripThoughts(body[1]).trim();
      if (corrected.length<source.length*0.86 || corrected.length>source.length*1.14) return '';
      if(storyMixedScriptFragments(corrected).length>=fragments.length)return '';
      if(storySurfaceProblem(corrected))return '';
      perfLog('storyOrthographyRepair',{before:fragments.length,after:storyMixedScriptFragments(corrected).length});
      return corrected;
    }catch(error){
      perfLog('storyOrthographyRepair',{success:false,error:text(error&&error.message||error).slice(0,100)});
      return '';
    }
  }
  function storySurfaceProblem(value) {
    const s = text(value).replaceAll(COMPLETE_MARKER, '').trim();
    if (!s) return '빈 본문';
    if (storyOutputLooksContaminated(s)) return '메타 문구나 비정상적인 언어 혼입';
    if ((s.match(/\uFFFD/g) || []).length >= 2) return '손상된 문자 포함';
    if (storyMixedScriptFragments(s).length >= 2) return '\uD55C\uAE00-\uB85C\uB9C8\uC790 \uD63C\uD569 \uD45C\uAE30 \uBC18\uBCF5';
    if (/[\u0000-\u0008\u000B\u000E-\u001F]/.test(s)) return '제어문자 혼입';
    // Very short intentional dialogue is not inherently corrupt. A second
    // independent language-model verdict decides semantic coherence.
    return '';
  }
  async function runStoryQualityVerdict(source) {
    const gateInput = text(source).replaceAll(COMPLETE_MARKER, '').trim();
    const problem = storySurfaceProblem(gateInput);
    if (problem) return { ok: false, reason: problem, code: 'surface' };
    const excerpt = gateInput.length <= 15500
      ? gateInput : gateInput.slice(0, 4500) + '\n[검사 중간 생략]\n' + gateInput.slice(-10400);
    const messages = [
      {role: 'system', content: [
        'You are a STRICT INDEPENDENT Korean fiction output-integrity checker, NOT a writer, editor or roleplay character.',
        'Check whether the submitted FICTION can be read as coherent Korean sentences and whether it has obvious text corruption.',
        'Reject: broken/mixed syllables, word salad, scrambled grammar with no consistent meaning, unreadable fragments repeated throughout, leaked planning/critique, output cut off mid-sentence, incoherent character/action attribution.',
        'Accept: intentionally short paragraphs, ellipsis, slang, dialogue fragments, nonlinear literary writing, or a scene intentionally left unresolved IF the actual Korean sentences remain intelligible.',
        'Do not judge morality, romance genre, sexual content, literary taste, plot preferences, or whether the scene satisfies an outline.',
        'If it is a normal readable scene, pass=true. Be conservative about false rejections but NEVER pass text that is plainly garbled.',
        'Return ONLY JSON {"pass":boolean,"garbled":boolean,"cutOff":boolean,"reasonKo":string,"evidence":string[]}.',
        'For garbled=true, cite 1-3 exact short substrings from the input that demonstrate the broken prose. reasonKo must be a short Korean diagnosis. Never return story prose.'
      ].join('\n')},
      {role:'user', content: JSON.stringify({storyToCheck: excerpt})}
    ];
    let timeoutId = null;
    try {
      const response = await Promise.race([
        runInternalLLM({messages,mode:'otherAx',allowPlugins:false}),
        new Promise((_,reject)=>{ timeoutId=setTimeout(()=>reject(new Error('품질 검사 시간 초과')),STORY_QUALITY_GATE_TIMEOUT_MS); })
      ]);
      if (!response || (response.type && response.type !== 'success')) throw new Error('품질 검사 모델 호출 실패');
      const parsed = extractJson(stripThoughts(normalizeModelText(response)));
      if (!parsed || typeof parsed !== 'object' || typeof parsed.pass !== 'boolean'
        || typeof parsed.garbled !== 'boolean' || typeof parsed.cutOff !== 'boolean') throw new Error('품질 검사 형식 오류');
      const evidence = Array.isArray(parsed.evidence) ? parsed.evidence
        .map(x=>text(x).trim()).filter(x=>x && gateInput.includes(x)).slice(0,3) : [];
      // v0.95.5: an auxiliary model can misread a proper-name spelling variant,
      // an awkward metaphor, or an open-ended scene as "corruption". These are
      // EDITORIAL opinions, not proof of damaged bytes or invalid output. Do not
      // trap the user in an endless refusal/retry loop because of that verdict.
      // storySurfaceProblem() above still hard-rejects objective corruption.
      const approved = parsed.pass === true && !parsed.garbled && !parsed.cutOff;
      if (!approved) {
        const warning = text(parsed.reasonKo).trim().slice(0,180) || '검수 모델이 문장 표현을 지적함';
        perfLog('storyQualityAdvisory', { warning, evidenceCount: evidence.length });
        return { ok: true, reason: '', code: 'semantic-advisory', warning, evidence };
      }
      return { ok: true, reason: '', code: 'pass', evidence };
    } catch (error) {
      // A failed/timed-out editor cannot veto a syntactically intact story.
      // Keep the deterministic gate active even when the auxiliary API is down.
      const warning = '보조 모델 품질 평가 불가: ' + text(error&&error.message||error).slice(0,100);
      perfLog('storyQualityAdvisory', { warning });
      return { ok: true, reason: '', code: 'checker-unavailable', warning };
    } finally {
      if (timeoutId !== null) clearTimeout(timeoutId);
    }
  }
  function storyQualityVerdict(value) {
    const key = storyQualityKey(value);
    if (storyQualityVerdicts.has(key)) return storyQualityVerdicts.get(key);
    const task = runStoryQualityVerdict(value);
    storyQualityVerdicts.set(key,task);
    if (storyQualityVerdicts.size > 20) storyQualityVerdicts.delete(storyQualityVerdicts.keys().next().value);
    return task;
  }
  async function flagRejectedStory(reason, stage) {
    const label = '본문 품질 검사 실패' + (stage ? ' ('+stage+')' : '') + ': ' + text(reason).slice(0,240);
    lastError = label;
    project.running = false;
    project.autoRun = false;
    project.modernContinuous = false;
    project.paused = true;
    project.lastStatus = 'failed';
    project.lastReason = label;
    modernUserStopped = true;
    clearTimeout(autoTimer);
    autoTimer = null;
    if (aiTask && aiTask.active) finishAITask(false,label);
    notebookStatus = '본문 검수 실패 · 기억 반영 안 함';
    notebookError = '';
    try { await saveProject(); } catch (error) { console.log('[StoryRunner] failure state save skipped',error); }
    if (uiOpen) renderUI();
    return label;
  }
  async function requireValidStoryBeforeInsert(candidate, messages, stage) {
    const value = text(candidate).trim();
    let report = await storyQualityVerdict(value);
    if (report.ok) return value;
    perfLog('storyQualityReject',{stage,reason:report.reason,code:report.code,characters:value.length});
    const fragments=storyMixedScriptFragments(value);
    // For localized orthography damage, let MAIN writer copy-edit instead of
    // throwing away an otherwise coherent scene. The independent gate must pass.
    if (fragments.length && fragments.length<=7 && value.length>250) {
      const repaired=await repairMixedScriptDraft(value,fragments);
      if(repaired) {
        const revisedReport=await storyQualityVerdict(repaired);
        if(revisedReport.ok)return repaired;
        report=revisedReport;
      }
    }
    // For unrepairable prose generate an entirely NEW candidate from a short
    // canonical prompt. Never feed failed prose into this attempt.
    if (Array.isArray(messages) && messages.length) {
      const regenerated=await regenerateCleanStory(messages);
      if(regenerated) {
        const regenerateReport=await storyQualityVerdict(regenerated);
        if(regenerateReport.ok) return text(regenerated).replaceAll(COMPLETE_MARKER,'').trim();
        report=regenerateReport;
      }
    }
    const reason=await flagRejectedStory(report.reason,stage);
    throw new Error(reason+' · 검증을 통과한 본문이 없어 저장과 자동 진행을 멈췄어.');
  }

  async function regenerateCleanStory(messages) {
    const retryMessages=compactRecoveryMessages(messages);
    retryMessages.push({role:'user',content:[
      'CLEAN MAIN-MODEL RETRY: The prior output was rejected and is NOT part of the story.',
      'Continue from the real current chat and unchanged canon. Preserve established Korean names exactly.',
      'Write complete readable KOREAN sentences only. Never splice Latin characters into Korean words.',
      'Write the next consequential fictional events; do not invent a recap or force completion.',
      'Return <SR_STORY>...fiction only...</SR_STORY> with no commentary.'
    ].join('\n')});
    // First avoid nested plugins that may transform the result again. Some
    // Risu model-provider plugins REQUIRE allowPlugins, so fall back to true
    // only after the isolated attempt failed validation. Both use MAIN model.
    for(const allowPlugins of [false,true]) {
      try {
        const out=await runInternalLLM({messages:retryMessages,mode:'model',allowPlugins});
        if(!out || (out.type&&out.type!=='success'))continue;
        const raw=normalizeModelText(out);
        const m=raw.match(/<SR_STORY>([\s\S]*?)<\/SR_STORY>/i);
        if(!m || !text(m[1]).trim())continue;
        const story=stripThoughts(m[1]).trim();
        if(!story || storySurfaceProblem(story))continue;
        const verdict=await storyQualityVerdict(story);
        if(!verdict.ok)continue;
        perfLog('storyRegenerate',{label:allowPlugins?'compact-main-plugin':'compact-main-isolated',outputChars:story.length,success:true});
        return story+(raw.includes(COMPLETE_MARKER)?'\n'+COMPLETE_MARKER:'');
      }catch(error){
        perfLog('storyRegenerate',{label:allowPlugins?'compact-main-plugin':'compact-main-isolated',success:false,error:text(error&&error.message||error).slice(0,120)});
      }
    }
    return '';
  }

  async function repairContaminatedStoryOutput(source, completionMarkerPresent) {
    const input = text(source).replace(COMPLETE_MARKER, '').trim();
    if (!input) return '';
    const repairMessages = [
      {
        role: 'system',
        content: [
          'You are a final-output gate for a Korean roleplay story.',
          'The supplied text may contain leaked chain-of-thought, planning notes, English meta-commentary, or a draft written in the wrong language.',
          'Recover ONLY the actual intended fiction. Remove all analysis, planning, evaluation, policy/meta commentary, and drafting notes.',
          'Write the recovered story in fluent natural Korean. Preserve established proper nouns and literal in-world foreign text only when needed.',
          'Do not summarize the story. Do not explain what you fixed. Do not add headings such as Response, Final, Analysis, or 생각의 사슬.',
          'Do not invent a different plot. If the source contains usable fiction, preserve its events while repairing language and prose continuity.',
          'Return exactly this envelope and nothing before it: <SR_STORY>...Korean fiction only...</SR_STORY>',
        ].join('\n'),
      },
      { role: 'user', content: '# CONTAMINATED OUTPUT\n' + input },
    ];

    // Visible story repair is writing, NEVER delegate it to the auxiliary planner.
    const attempts = [
      ['model', true, 'story-output-repair-main'],
    ];
    for (const [callMode, allowPlugins, label] of attempts) {
      try {
        const out = await runInternalLLM({ messages: repairMessages, mode: callMode, allowPlugins });
        if (!out || out.type !== 'success') continue;
        const raw = normalizeModelText(out);
        const m = raw.match(/<SR_STORY>([\s\S]*?)<\/SR_STORY>/i);
        if (!m || !text(m[1]).trim()) continue;
        const repaired = stripThoughts(m[1]).trim();
        if (!repaired || storyOutputLooksContaminated(repaired)) continue;
        perfLog('storyOutputRepair', { label, inputChars: input.length, outputChars: repaired.length, success: true });
        return repaired + (completionMarkerPresent ? '\n' + COMPLETE_MARKER : '');
      } catch (error) {
        perfLog('storyOutputRepair', { label, inputChars: input.length, success: false, error: error && error.message ? error.message : String(error) });
      }
    }
    return '';
  }


  async function reviewStoryDraft(draft, messages) {
    const source = text(draft).trim();
    if (!source) return "";
    try {
      const out = await runInternalLLM({
        messages: [
          {
            role: "system",
            content: [
              "You are the final story editor for Story Runner.",
              "The writer model already created a draft. Your job is to silently fix it and return the final fiction only.",
              "Never output analysis, critique, scores, reports, explanations, or editing notes.",
              "Remove any chain-of-thought, planning text, English meta text, or AI commentary.",
              "Check: character voice, continuity with current canon, repetitive prose, dead dialogue loops, forced outline compliance, and whether the scene actually moves.",
              "Do not replace the plot, add a new major event, or change user choices.",
              "Return only natural Korean story prose.",
            ].join("\\n"),
          },
          {
            role: "user",
            content: [
              "# DRAFT",
              source,
              "# CONTEXT",
              text(messages && JSON.stringify(messages.slice(-6))).slice(0, 12000),
            ].join("\\n\\n"),
          },
        ],
        mode: "model",
        allowPlugins: false,
      });
      const edited = extractVisibleModelText(out);
      if (!edited || storyOutputLooksContaminated(edited)) return source;
      return edited;
    } catch (e) {
      console.log("[StoryRunner] review pass skipped", e);
      return source;
    }
  }

  async function runVisibleModel(messages, mode, emptyMessage) {
    // Only real fiction/revision should call this helper. All planning uses auxiliary().
    if (mode !== 'model') throw new Error('소설 본문 생성·수정은 메인 모델로만 실행합니다.');
    const failures = [];

    async function tryCall(callMode, allowPlugins, label, callMessages) {
      const perfStartedAt = Date.now();
      const perfInput = perfMessageStats(callMessages || messages);
      try {
        const out = await runInternalLLM({
          messages: callMessages || messages,
          mode: callMode,
          allowPlugins: allowPlugins,
        });
        const callMs = Date.now() - perfStartedAt;
        if (!out || out.type !== 'success') {
          perfLog("directModelCall", { label, callMode, allowPlugins, callMs, inputMessages: perfInput.messages, inputChars: perfInput.chars, success: false });
          failures.push(label + ': ' + (text(out && out.type).slice(0,50) || '호출 실패'));
          return '';
        }
        const visible = extractVisibleModelText(out);
        perfLog("directModelCall", { label, callMode, allowPlugins, callMs, inputMessages: perfInput.messages, inputChars: perfInput.chars, outputChars: visible.length, success: !!visible });
        if (!visible) {
          failures.push(label + ': 성공 응답이지만 visible text 0자');
          return '';
        }
        return visible;
      } catch (error) {
        perfLog("directModelCall", { label, callMode, allowPlugins, callMs: Date.now() - perfStartedAt, inputMessages: perfInput.messages, inputChars: perfInput.chars, success: false, error: error && error.message ? error.message : String(error) });
        failures.push(label + ': ' + (error && error.message ? error.message : String(error)));
        return '';
      }
    }

    // 1) Prefer the configured main model. Plugin-provided main models can fail
    // when invoked from another plugin on some Risu/provider combinations.
    let visible = await tryCall(mode, true, 'main', messages);
    if (visible) return visible;

    // 2) One strict final-output retry on the main model.
    const retryMessages = messages.concat([{
      role: 'user',
      content: [
        'OUTPUT RETRY: 이전 응답에는 사용자에게 보여줄 최종 본문이 없었습니다.',
        '사고과정, 분석, 평가, 개발 리포트 없이 요청된 최종 결과만 출력하세요.',
        '빈 응답을 반환하지 마세요.',
      ].join('\n'),
    }]);
    visible = await tryCall(mode, true, 'main-retry', retryMessages);
    if (visible) return visible;

    // Do not silently downgrade a failed main-writer call to the auxiliary
    // planning model; fail explicitly instead of inserting a lower-quality scene.
    const detail = failures.length ? ('\n호출 기록: ' + failures.join(' | ')) : '';
    throw new Error((emptyMessage || 'AI가 최종 답변 없이 빈 응답을 반환했습니다.') + detail);
  }

  function repairJsonStringControls(input) {
    const s = text(input);
    let out = "";
    let inString = false;
    let escaped = false;
    for (let i = 0; i < s.length; i++) {
      const ch = s[i];
      const code = ch.charCodeAt(0);
      if (inString) {
        if (escaped) {
          out += ch;
          escaped = false;
          continue;
        }
        if (ch === "\\") {
          out += ch;
          escaped = true;
          continue;
        }
        if (ch === '"') {
          out += ch;
          inString = false;
          continue;
        }
        if (ch === "\n") { out += "\\n"; continue; }
        if (ch === "\r") { out += "\\r"; continue; }
        if (ch === "\t") { out += "\\t"; continue; }
        if (code < 0x20) {
          out += "\\u" + code.toString(16).padStart(4, "0");
          continue;
        }
        out += ch;
      } else {
        out += ch;
        if (ch === '"') inString = true;
      }
    }
    return out;
  }

  function parseJsonCandidate(candidate) {
    const attempts = [];
    const raw = text(candidate).trim();
    if (raw) attempts.push(raw);
    const repairedControls = repairJsonStringControls(raw);
    if (repairedControls && repairedControls !== raw) attempts.push(repairedControls);

    for (const attempt of attempts) {
      try { return JSON.parse(attempt); } catch (_) {}
    }

    // Common model slip: trailing commas before closing object/array.
    for (const attempt of attempts) {
      const noTrailing = attempt.replace(/,\s*([}\]])/g, "$1");
      try { return JSON.parse(noTrailing); } catch (_) {}
    }
    return null;
  }

  function extractJson(value) {
    const source = stripThoughts(value);
    if (!source) throw new Error("모델이 빈 응답을 반환했습니다.");
    const fenced = source.match(/```(?:json)?\s*([\s\S]*?)```/i) || source.match(/~~~(?:json)?\s*([\s\S]*?)~~~/i);
    const candidate = fenced ? fenced[1].trim() : source.trim();

    let parsed = parseJsonCandidate(candidate);
    if (parsed) return parsed;

    const start = candidate.indexOf("{");
    const end = candidate.lastIndexOf("}");
    if (start >= 0 && end > start) {
      parsed = parseJsonCandidate(candidate.slice(start, end + 1));
      if (parsed) return parsed;
    }
    throw new Error("JSON 응답을 해석하지 못했습니다. 모델 출력에 문자열 내부 줄바꿈/제어문자 또는 잘못된 JSON이 포함되었습니다.");
  }

  async function extractJsonWithModelRepair(value, schemaText, label) {
    try {
      return extractJson(value);
    } catch (firstError) {
      const raw = text(value).trim();
      if (!raw) throw firstError;
      const repaired = await auxiliary([
        {
          role: "system",
          content: [
            "You are a strict JSON repair utility.",
            "Repair ONLY the syntax/escaping/format of the supplied malformed JSON-like output.",
            "Return exactly one valid JSON object and nothing else. No markdown fences, commentary, or reasoning.",
            "Preserve every semantic value and list item. Do not invent, delete, summarize, censor, or reinterpret story content.",
            "Escape double quotes and backslashes correctly. Escape line breaks inside string values as \\n.",
            "Remove trailing commas and any prose that exists outside the JSON object.",
            "If a string contains quoted dialogue or a quoted phrase, keep the phrase but encode it as valid JSON.",
            schemaText ? ("Required schema: " + schemaText) : "Preserve the apparent object schema from the supplied output.",
          ].join("\n"),
        },
        { role: "user", content: raw.slice(0, 60000) },
      ]);
      try {
        return extractJson(repaired);
      } catch (secondError) {
        throw new Error((label || "AI 응답") + " JSON 자동 복구에도 실패했습니다. 같은 요청을 다시 누르면 새 응답으로 재시도합니다.");
      }
    }
  }


  function taggedBlock(source, tag) {
    const safeTag = String(tag || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const match = String(source || "").match(new RegExp("<" + safeTag + "\\s*>([\\s\\S]*?)<\\/" + safeTag + "\\s*>", "i"));
    return match ? match[1].trim() : "";
  }

  function taggedBlocks(source, tag) {
    const safeTag = String(tag || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const re = new RegExp("<" + safeTag + "\\s*>([\\s\\S]*?)<\\/" + safeTag + "\\s*>", "gi");
    const out = [];
    let match;
    while ((match = re.exec(String(source || ""))) !== null) out.push(match[1].trim());
    return out;
  }

  function taggedList(block) {
    const lines = String(block || "").split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    const out = [];
    let current = "";
    for (const line of lines) {
      const bullet = line.match(/^(?:[-*•]|\d+[.)])\s*(.+)$/);
      if (bullet) {
        if (current) out.push(current.trim());
        current = bullet[1].trim();
      } else if (current) {
        current += " " + line;
      } else {
        current = line;
      }
    }
    if (current) out.push(current.trim());
    return out.filter(Boolean);
  }

  function parsePlanningTagged(value) {
    const source = stripThoughts(value);
    if (!source) throw new Error("모델이 빈 응답을 반환했습니다.");

    // Backward compatibility: if a model still returns valid legacy JSON, accept it.
    try {
      const legacy = extractJson(source);
      if (legacy && Array.isArray(legacy.episodes) && legacy.episodes.length) return legacy;
    } catch (_) {}

    const episodeBlocks = taggedBlocks(source, "SR_EPISODE");
    const episodes = episodeBlocks.map((block) => ({
      number: taggedBlock(block, "NUMBER"),
      title: taggedBlock(block, "TITLE"),
      status: taggedBlock(block, "STATUS"),
      purpose: taggedBlock(block, "PURPOSE"),
      startCondition: taggedBlock(block, "START"),
      mustBeats: taggedList(taggedBlock(block, "MUST_BEATS")),
      guideBeats: taggedList(taggedBlock(block, "GUIDANCE_BEATS")),
      beats: taggedList(taggedBlock(block, "BEATS")),
      endCondition: taggedBlock(block, "END_CONDITION"),
      transition: taggedBlock(block, "TRANSITION"),
    })).filter((ep) => ep.number || ep.title || ep.purpose || ep.mustBeats.length || ep.guideBeats.length || ep.beats.length);

    if (!episodes.length) throw new Error("구조화된 화별 설계안을 찾지 못했습니다.");

    const ce = taggedBlock(source, "SR_CURRENT_EPISODE");
    const cs = taggedBlock(source, "SR_CURRENT_STATE");
    return {
      reply: taggedBlock(source, "SR_REPLY"),
      summary: taggedBlock(source, "SR_SUMMARY"),
      focusPlacement: taggedBlock(source, "SR_FOCUS"),
      futureAnchors: taggedList(taggedBlock(source, "SR_FUTURE_ANCHORS")),
      currentEpisode: ce ? {
        number: taggedBlock(ce, "NUMBER"),
        title: taggedBlock(ce, "TITLE"),
        status: taggedBlock(ce, "STATUS"),
        confidence: taggedBlock(ce, "CONFIDENCE"),
        reason: taggedBlock(ce, "REASON"),
        progress: taggedBlock(ce, "PROGRESS"),
      } : null,
      currentState: cs ? {
        role: taggedBlock(cs, "ROLE"),
        location: taggedBlock(cs, "LOCATION"),
        relationships: taggedList(taggedBlock(cs, "RELATIONSHIPS")),
        activeMutationRules: taggedList(taggedBlock(cs, "ACTIVE_MUTATION_RULES")),
        alreadyEstablished: taggedList(taggedBlock(cs, "ALREADY_ESTABLISHED")),
      } : null,
      episodes,
      details: taggedList(taggedBlock(source, "SR_DETAILS")),
      risks: taggedList(taggedBlock(source, "SR_RISKS")),
    };
  }

  function planningTaggedFormatInstructions(includeReply) {
    return [
      "IMPORTANT OUTPUT FORMAT: Do NOT output JSON. JSON is forbidden for this task.",
      "Return only the following simple tagged text format. Do not wrap it in markdown code fences.",
      includeReply ? "<SR_REPLY>short Korean reply to the user's edit/request</SR_REPLY>" : "",
      "<SR_SUMMARY>concise Korean summary</SR_SUMMARY>",
      "<SR_FOCUS>where the user's desired scene/direction belongs</SR_FOCUS>",
      "<SR_FUTURE_ANCHORS>",
      "- optional future anchor",
      "</SR_FUTURE_ANCHORS>",
      "<SR_CURRENT_EPISODE>",
      "<NUMBER>1화</NUMBER>",
      "<TITLE>title</TITLE>",
      "<STATUS>현재</STATUS>",
      "<CONFIDENCE>높음</CONFIDENCE>",
      "<REASON>reason</REASON>",
      "<PROGRESS>current progress</PROGRESS>",
      "</SR_CURRENT_EPISODE>",
      "<SR_CURRENT_STATE>",
      "<ROLE>current protagonist role/status</ROLE>",
      "<LOCATION>current location/time if known</LOCATION>",
      "<RELATIONSHIPS>",
      "- relationship fact",
      "</RELATIONSHIPS>",
      "<ACTIVE_MUTATION_RULES>",
      "- only currently relevant world rule in plain Korean, if needed",
      "</ACTIVE_MUTATION_RULES>",
      "<ALREADY_ESTABLISHED>",
      "- established fact",
      "</ALREADY_ESTABLISHED>",
      "</SR_CURRENT_STATE>",
      "Repeat the next block once per planned episode:",
      "<SR_EPISODE>",
      "<NUMBER>1화</NUMBER>",
      "<TITLE>title</TITLE>",
      "<STATUS>현재|예정|미정|완료</STATUS>",
      "<PURPOSE>episode purpose</PURPOSE>",
      "<START>starting state</START>",
      "<MUST_BEATS>",
      "- only a genuinely mandatory event/fact that must happen before this episode may advance; usually 0-2 items",
      "</MUST_BEATS>",
      "<GUIDANCE_BEATS>",
      "- optional/recommended beat that can be skipped, reordered, compressed, or transformed for better prose",
      "- another recommendation if useful",
      "</GUIDANCE_BEATS>",
      "<END_CONDITION>soft intended landing point; not itself a hard checklist</END_CONDITION>",
      "<TRANSITION>next nearby consequence or transition</TRANSITION>",
      "</SR_EPISODE>",
      "<SR_DETAILS>",
      "- optional detail",
      "</SR_DETAILS>",
      "<SR_RISKS>",
      "- optional continuity/risk note",
      "</SR_RISKS>",
      "MUST_BEATS are only for explicit non-negotiable user requirements or indispensable continuity. Normally keep them empty or very short.",
      "GUIDANCE_BEATS are recommendations only and must never become completion gates.",
      "Do not escape quotes or line breaks. Normal Korean prose is allowed inside tags.",
    ].filter(Boolean).join("\n");
  }

  async function parsePlanningStructured(value, label) {
    try {
      return parsePlanningTagged(value);
    } catch (firstError) {
      const raw = text(value).trim();
      if (!raw) throw firstError;
      const repaired = await auxiliary([
        {
          role: "system",
          content: [
            "Reformat the supplied planning response without changing its story meaning.",
            planningTaggedFormatInstructions(true),
            "Preserve all usable episode content. Do not invent new story events merely to repair formatting.",
          ].join("\n"),
        },
        { role: "user", content: raw.slice(0, 60000) },
      ]);
      try {
        return parsePlanningTagged(repaired);
      } catch (_) {
        throw new Error((label || "설계 응답") + "의 구조를 읽지 못했습니다. JSON 오류가 아니라 태그 구조 복구에도 실패했습니다. 다시 한 번 실행해 주세요.");
      }
    }
  }

  function startAITask(label, steps) {
    aiTask = {
      active: true,
      label: text(label),
      startedAt: Date.now(),
      finishedAt: 0,
      success: null,
      message: "",
      steps: (steps || []).map((name) => ({ name, status: "waiting", detail: "" })),
    };
    if (aiTask.steps.length) aiTask.steps[0].status = "running";
    aiTaskToastHidden = false;
    if (aiTaskTicker) clearInterval(aiTaskTicker);
    aiTaskTicker = setInterval(() => {
      if (!aiTask || !aiTask.active) return;
      const el = document.getElementById("sr-ai-elapsed");
      if (el) el.textContent = Math.max(0, Math.floor((Date.now() - aiTask.startedAt) / 1000)) + "초";
    }, 1000);
    if (uiOpen) renderUI();
  }

  function setAITaskStep(index, status, detail) {
    if (!aiTask || !Array.isArray(aiTask.steps) || !aiTask.steps[index]) return;
    aiTask.steps[index].status = status;
    if (detail) aiTask.steps[index].detail = text(detail);
    if (status === "done" && aiTask.steps[index + 1] && aiTask.steps[index + 1].status === "waiting") {
      aiTask.steps[index + 1].status = "running";
    }
    if (uiOpen) renderUI();
  }

  function finishAITask(success, message) {
    if (!aiTask) return;
    aiTask.active = false;
    aiTask.success = !!success;
    aiTask.message = text(message);
    aiTask.finishedAt = Date.now();
    for (const step of aiTask.steps || []) {
      if (step.status === "running" || (success && step.status === "waiting")) {
        step.status = success ? "done" : (step.status === "running" ? "failed" : "waiting");
      }
    }
    if (aiTaskTicker) {
      clearInterval(aiTaskTicker);
      aiTaskTicker = null;
    }
    aiTaskToastHidden = true;
    if (uiOpen) renderUI();
  }

  function aiTaskElapsed() {
    if (!aiTask || !aiTask.startedAt) return 0;
    const end = aiTask.finishedAt || Date.now();
    return Math.max(0, Math.floor((end - aiTask.startedAt) / 1000));
  }

  function aiTaskOverlayHtml() {
    // Keep fixed progress UI tiny and dismissible. Completion/error details stay inline.
    if (!aiTask || !aiTask.active || aiTaskToastHidden) return "";
    const current = (aiTask.steps || []).find((s) => s.status === "running");
    return '<div class="ai-toast busy">' +
      '<div class="ai-toast-head"><b>AI 작업 중</b><span id="sr-ai-elapsed">' + aiTaskElapsed() + '초</span>' +
      '<button type="button" class="ai-toast-close" id="sr-ai-toast-close" aria-label="알림 닫기">×</button></div>' +
      '<div class="ai-toast-title">' + escapeHtml(aiTask.label) + '</div>' +
      (current ? '<div class="ai-toast-stage">' + escapeHtml(current.name) + '</div>' : '') +
      '</div>';
  }

  function aiTaskProgressHtml() {
    if (!aiTask) return "";
    const rows = (aiTask.steps || []).map((step, index) => {
      const icon = step.status === "done" ? "✓"
        : step.status === "running" ? "●"
        : step.status === "failed" ? "×"
        : "○";
      return '<div class="task-step ' + step.status + '"><span class="task-icon">' + icon + '</span><div><b>' +
        escapeHtml((index + 1) + ". " + step.name) + '</b>' +
        (step.detail ? '<small>' + escapeHtml(step.detail) + '</small>' : '') +
        '</div></div>';
    }).join("");
    return '<div class="sr-card task-card"><div class="task-title"><b>' + escapeHtml(aiTask.label) + '</b><span>' +
      (aiTask.active ? '진행 중 · ' : (aiTask.success ? '완료 · ' : '실패 · ')) +
      '<span id="sr-ai-elapsed-inline">' + aiTaskElapsed() + '초</span></span></div>' +
      rows +
      (aiTask.message ? '<p class="' + (aiTask.success ? 'status' : 'error') + '">' + escapeHtml(aiTask.message) + '</p>' : '') +
      '</div>';
  }

  async function auxiliary(messages, timeoutMs) {
    // GLM-class models can legitimately take several minutes on large planning contexts.
    // 180 s is now a soft notice only; the request is not failed until the hard limit.
    timeoutMs = timeoutMs || AUXILIARY_HARD_TIMEOUT_MS;
    let hardTimer;
    let slowTimer;

    if (timeoutMs > AUXILIARY_SLOW_NOTICE_MS) {
      slowTimer = setTimeout(() => {
        if (aiTask && aiTask.active) {
          aiTask.message = "보조 모델 응답이 늦어지고 있어 계속 기다리는 중입니다.";
          if (uiOpen) renderUI();
        }
      }, AUXILIARY_SLOW_NOTICE_MS);
    }

    const result = await Promise.race([
      runInternalLLM({ messages, mode: "otherAx", allowPlugins: false }),
      new Promise((_, reject) => {
        hardTimer = setTimeout(() => reject(new Error("보조 모델 응답 시간이 " + Math.round(timeoutMs / 1000) + "초를 초과했습니다.")), timeoutMs);
      }),
    ]).finally(() => {
      clearTimeout(hardTimer);
      clearTimeout(slowTimer);
    });
    const cleaned = stripThoughts(normalizeModelText(result));
    if (!cleaned) throw new Error("보조 모델이 빈 응답을 반환했습니다.");
    return cleaned;
  }

  function storyModeLabel() {
    return project.storyMode === "sunny" ? "양지용" : "기본";
  }

  function writerQualityLabel() {
    if (project.writerQualityMode === "basic") return "기본";
    if (project.writerQualityMode === "max") return "2패스 고품질";
    return "강화";
  }

  function writerQualitySystemText() {
    if (project.writerQualityMode === "basic") {
      return [
        "# WRITER QUALITY: BASIC",
        "LANGUAGE LOCK: All user-visible fiction must be written in natural Korean. English is allowed only when it is an established proper noun, literal in-world text, or unavoidable technical term.",
        "Write clear, natural fiction. Do not let planning language leak into prose.",
      ].join("\n");
    }
    return [
      "# WRITER QUALITY MODULE — SCENE-FIRST",
      "LANGUAGE LOCK: All user-visible fiction must be written in natural Korean. Never switch the narration, dialogue, headings, or meta-output to English. English is allowed only for established proper nouns, literal in-world text, or unavoidable technical terms.",
      "The outline is navigation, not prose. Write an alive scene, not a correct report of planned beats.",
      "Every substantial scene needs an active dramatic engine: somebody wants something now, somebody or something complicates it, and the situation changes before the scene idles.",
      "Give characters initiative. At least one meaningful action, interruption, mistake, joke, refusal, escalation, discovery, or reversal should arise from character personality rather than from the outline checklist.",
      "Keep voices distinct. Do not make every side character equally perceptive, therapeutic, articulate, or emotionally mature. Let people misunderstand, dodge, tease, interrupt, get petty, be wrong, or act on their own priorities.",
      "Avoid interview/Q&A dialogue loops where one character repeatedly asks '뭐/왜/그래서' and another explains. Vary conversational tactics: deflect, counterattack, joke, change subject, physically act, reveal by accident, or refuse to answer.",
      "CUT DEAD AIR. Do not pad with repeated glances, cups, hands, breaths, silences, tiny pauses, or descriptions of someone almost speaking. Use a micro-gesture only when it changes how the reader interprets the moment.",
      "Do not overuse Korean filler rhythms such as '잠깐', '아주', '그냥', '천천히', '한 번', '말을 안 했다', '손을 봤다', or repeated '몇 초'. Vary sentence movement and omit unneeded stage business.",
      "Do not explain subtext after already showing it. If a gesture, line, or choice communicates the emotion, trust the reader instead of adding a paragraph that decodes its meaning.",
      "Do not turn ordinary props into solemn symbols by default. Paperwork, cups, doors, handkerchiefs, phones, and food stay ordinary unless the scene has genuinely earned symbolic weight.",
      "Compress bureaucracy and world exposition aggressively unless the administrative detail itself creates a decision, danger, comedy, or conflict. Give only the fact needed for the next action.",
      "Prefer specific verbs, concrete reactions, sharp dialogue, and consequential actions over generalized emotional narration.",
      "Do not make everyone stop and solemnly observe a protagonist decision. Side characters keep doing their own things and react according to personality.",
      "Do not repeat the same emotional beat from multiple POVs or hidden-story addenda. Any secondary POV must reveal NEW information, motive, conflict, or irony rather than paraphrase the visible scene.",
      "Allow tonal contrast. Serious scenes benefit from friction, awkwardness, humor, irritation, practical interruption, or competing agendas when appropriate; do not flatten every scene into quiet sentimentality.",
      "End on changed pressure, a choice, an interruption, a reveal, a concrete next action, or an unresolved human reaction — not merely on a poetic object image or a summary of what the moment meant.",
      "MUST items are continuity obligations, not a mandate to make the scene solemn or predictable. GUIDANCE may be ignored whenever a better character-driven turn appears.",
      project.writerQualityMode === "max"
        ? "A second editorial pass will follow. Still make the first draft strong; do not rely on the editor to invent the scene."
        : "Deliver the strongest final prose in one pass.",
    ].join("\n");
  }

  function storyModeSystemText() {
    if (project.storyMode !== "sunny") {
      return [
        "# STORY MODE: DEFAULT",
        "Use the active character card, Lorebook, BardWiki, and user direction normally. Adult or explicit material may appear only when it is actually part of the established setting or requested story direction; do not force it merely because it exists in background lore.",
      ].join("\n");
    }
    return [
      "# STORY MODE: YANGJI / MAINSTREAM",
      "Plan and write this as a mainstream, non-explicit story suitable for ordinary public-facing fiction.",
      "Prioritize plot, character chemistry, comedy, mystery, adventure, workplace/school incidents, rivalry, friendship, romance, growth, discovery, and everyday conflict.",
      "Do NOT depict explicit sex acts, genital-focused action, pornographic fetish play, sexual servicing, or graphic sexual humiliation on-page.",
      "If the active Lorebook contains explicit adult world rules, keep only the minimum continuity facts needed to avoid contradiction and move the dramatic focus to non-explicit social, emotional, practical, or comedic consequences.",
      "Romance, attraction, embarrassment, flirting, jealousy, and non-explicit affection are allowed, but fade out before explicit sexual activity.",
      "Do not rewrite or delete the underlying Lorebook. This is a Story Runner presentation/planning mode only.",
    ].join("\n");
  }


  function normalizedDirectorAnalysis(raw) {
    raw = raw && typeof raw === "object" ? raw : {};
    const interpretation = raw.interpretation && typeof raw.interpretation === "object" ? raw.interpretation : {};
    return {
      currentState: text(raw.currentState),
      summary: text(raw.summary),
      flow: text(raw.flow),
      now: text(raw.now),
      writerInstruction: text(raw.writerInstruction),
      tasteSuggestions: stringList(raw.tasteSuggestions).slice(0, 4),
      storyDnaLearning: raw.storyDnaLearning && typeof raw.storyDnaLearning === "object" ? {
        profileSummary: text(raw.storyDnaLearning.profileSummary),
        observations: Array.isArray(raw.storyDnaLearning.observations) ? raw.storyDnaLearning.observations.slice(0, 8).map(normalizeStoryDnaObservation) : [],
      } : { profileSummary: "", observations: [] },
      interpretation: {
        locked: stringList(interpretation.locked).slice(0, 12),
        currentPreferences: stringList(interpretation.currentPreferences).slice(0, 12),
        midTerm: stringList(interpretation.midTerm).slice(0, 12),
        longTermTargets: stringList(interpretation.longTermTargets).slice(0, 12),
        optionalIdeas: stringList(interpretation.optionalIdeas).slice(0, 12),
        notYet: stringList(interpretation.notYet).slice(0, 12),
      },
    };
  }

  function directorAnalysisForPrompt() {
    const a = project.directorAnalysis;
    if (!a || typeof a !== "object") return "";
    return [
      text(a.currentState) ? ("Previous current-state read:\n" + text(a.currentState)) : "",
      text(a.summary) ? ("Previous director summary:\n" + text(a.summary)) : "",
      text(a.flow) ? ("Previous recommended flow:\n" + text(a.flow)) : "",
      text(a.now) ? ("Previous current-scene direction:\n" + text(a.now)) : "",
      text(a.writerInstruction) ? ("Previous writer instruction:\n" + text(a.writerInstruction)) : "",
      Array.isArray(a.tasteSuggestions) && a.tasteSuggestions.length ? ("Previous optional taste-based suggestions:\n" + a.tasteSuggestions.map((x) => "- " + x).join("\n")) : "",
    ].filter(Boolean).join("\n\n").slice(0, 6000);
  }

  function compactDirectorCharacter(character) {
    if (!character || typeof character !== "object") return null;
    return {
      name: text(character.name).slice(0, 200),
      description: text(character.description).slice(0, 2200),
      personality: text(character.personality).slice(0, 2200),
      scenario: text(character.scenario).slice(0, 1800),
      notes: text(character.notes).slice(0, 1200),
    };
  }

  function compactDirectorMutation(ctx) {
    if (!ctx || typeof ctx !== "object") return null;
    return {
      mode: text(ctx.mode),
      activeStates: Array.isArray(ctx.activeStates) ? ctx.activeStates.slice(0, 16) : [],
      activePacks: Array.isArray(ctx.activePacks) ? ctx.activePacks.slice(0, 8) : [],
      selectedRules: Array.isArray(ctx.selectedRules) ? ctx.selectedRules.slice(0, 10).map((r) => ({
        name: text(r.name || r.id).slice(0, 180),
        owner: text(r.owner).slice(0, 100),
        instruction: text(r.instruction).slice(0, 700),
      })) : [],
    };
  }

  // Read the actual saved chat, not BardWiki's possibly stale recentMessages.
  // Keep the entire end of the last finished assistant turn so a long chapter does
  // not lose its continuation point when its opening exceeds the per-message cap.
  async function readDirectorLiveTail() {
    const active = await requireTarget();
    const chat = await risuai.getChatFromIndex(active.characterIndex, active.chatIndex);
    const rows = Array.isArray(chat && chat.message) ? chat.message : [];
    const usable = rows.filter((m) => m && (m.role === "user" || m.role === "char" || m.role === "assistant") && text(m.data).trim());
    const tail = usable.slice(-6);
    return tail.map((m, i) => {
      const role = m.role === "user" ? "user" : "assistant";
      const value = text(m.data);
      // A provably corrupted saved output remains in the user's chat history,
      // but never becomes a style/template source in future model prompts.
      // Editorial defects (name variants, rough metaphors) do NOT trigger this.
      if (role === 'assistant' && storySurfaceProblem(value)) {
        return { role, content: '[기존 채팅의 이 메시지는 문자/형식 손상으로 모델 입력에서 제외함. 앞서 확인된 사건과 현재 사용자 지시를 따라 이어서 쓸 것. 실제 채팅 원문은 변경하지 않음.]' };
      }
      // Prefer the ending over the beginning: the unresolved situation is at the end.
      const limit = i === tail.length - 1 ? 10500 : (i >= tail.length - 3 ? 3500 : 1200);
      return { role, content: value.length > limit ? "[Earlier text omitted; following is the END of this message]\n" + value.slice(-limit) : value };
    });
  }

  async function readDirectorContext(rough) {
    const query = [
      text(rough),
      text(project.destination),
      "현재 장면, 직전 사건, 현재 위치, 등장인물 관계, 감정 상태, 진행 중인 갈등과 약속"
    ].filter(Boolean).join("\n").slice(0, 5000);

    let wiki = { content: "", recentMessages: [] };
    try {
      wiki = await risuai.bardWiki.getContext({ query: query || "현재 장면과 관계 상태" });
    } catch (error) {
      console.log("[StoryRunner] director BardWiki fallback", error);
    }

    let recentMessages = [];
    try {
      recentMessages = await readDirectorLiveTail();
    } catch (error) {
      console.log("[StoryRunner] director live chat fallback", error);
      recentMessages = Array.isArray(wiki && wiki.recentMessages)
        ? wiki.recentMessages.slice(-4).map((m) => ({
            role: m.role === "char" ? "assistant" : m.role,
            content: text(m.data || m.content).slice(-3500),
          })) : [];
    }

    const currentCharacter = compactDirectorCharacter(await readCurrentCharacterSnapshot());

    let mutationContext = null;
    try {
      const mutationQuery = [
        query,
        text(wiki && wiki.content).slice(0, 4500),
        recentMessages.slice(-2).map((m) => m.content).join("\n")
      ].filter(Boolean).join("\n").slice(0, 9000);
      mutationContext = compactDirectorMutation(
        compactMutationContext(await requestMutationContext(mutationQuery, 2200, false))
      );
    } catch (error) {
      console.log("[StoryRunner] director mutation fallback", error);
      mutationContext = compactDirectorMutation(mutationContextCache);
    }

    const wikiContent = text(wiki && wiki.content).slice(0, 18000);
    const dnaPrompt = storyDnaPromptText("director");
    const approxChars = wikiContent.length
      + recentMessages.reduce((sum, m) => sum + text(m.content).length, 0)
      + (currentCharacter ? JSON.stringify(currentCharacter).length : 0)
      + (mutationContext ? JSON.stringify(mutationContext).length : 0)
      + dnaPrompt.length;

    directorContextStatus = [
      "실제 채팅 최신 끝부분 우선",
      "최근 대화 " + recentMessages.length + "개",
      "캐릭터 카드 압축",
      mutationContext && mutationContext.selectedRules && mutationContext.selectedRules.length ? ("개변 규칙 " + mutationContext.selectedRules.length + "개") : "개변 규칙 최소",
      "Story DNA " + storyDnaSorted("active").length + "개",
      "전체 채팅/전체 로어북 미전송",
      "컨텍스트 약 " + Math.round(approxChars / 1000) + "k자"
    ].join(" · ");

    return { wikiContent, recentMessages, currentCharacter, mutationContext, storyDNA: dnaPrompt };
  }

  function directorContextText(ctx) {
    const parts = [
      "# CURRENT-STATE SOURCE POLICY",
      "The saved LIVE CHAT TAIL is authoritative about events already completed and the exact continuation point.",
      "BardWiki supplies older durable memory and background only. Never rewind the story to a BardWiki snapshot or previous director plan.",
      "For an event/status conflict, the latest explicit finished live-chat action wins. Do not assume the full chat history is present.",
      "Distinguish established facts from individual characters' beliefs, observations, speculation and ignorance. Never leak a hidden fact into a character's dialogue without an in-story information path.",
      "Reconstruct the current situation yourself before planning. Do not ask the user to recap facts already present here."
    ];
    // v0.93: Legacy recommendation-side NTR ledgers had no per-fact source
    // verification. Keep saved data untouched but do not inject those guesses.
    // The verified notebook and recent actual chat are the only continuity input.
    const storySetup = storySetupPromptText();
    if (storySetup) parts.push(storySetup);
    const acceptedNotebook = notebookPromptText();
    if (acceptedNotebook) parts.push(acceptedNotebook);
    if (ctx && text(ctx.storyDNA).trim()) parts.push(text(ctx.storyDNA));
    if (ctx && ctx.currentCharacter) parts.push("# CURRENT CHARACTER CARD — COMPACT\n" + JSON.stringify(ctx.currentCharacter, null, 2));
    if (ctx && text(ctx.wikiContent).trim()) parts.push("# BARDWIKI DURABLE BACKGROUND — SECONDARY FOR RECENCY\n" + text(ctx.wikiContent));
    if (ctx && ctx.mutationContext) parts.push("# RELEVANT MUTATION AFFORDANCES — COMPACT\n" + JSON.stringify(ctx.mutationContext, null, 2));
    return parts.join("\n\n");
  }

  async function runNaturalDirector() {
    const rough = text(project.directorInput).trim();
    if (!rough) throw new Error("하고 싶은 내용을 아무렇게나 먼저 적어줘.");
    await requireTarget();
    directorBusy = true;
    directorError = "";
    if (uiOpen) renderUI();
    try {
      const ctx = await readDirectorContext(rough);
      const recent = Array.isArray(ctx.recentMessages) ? ctx.recentMessages.slice(-4) : [];
      const messages = [
        {
          role: "system",
          content: [
            "# NATURAL-LANGUAGE STORY DIRECTOR",
            "You are NOT the story writer. You are a director who converts the user's messy notes into a precise instruction for another writer model.",
            "The user is allowed to mix current-scene commands, vague ideas, medium-term preferences, distant-future targets, jokes, corrections, and prohibitions in one rough note. Infer the intended time horizon yourself. Do not force the user to classify anything.",
            "",
            "## CORE JOB",
            "1. Preserve explicitly stated events and constraints as fixed facts when the user clearly commits to them.",
            "2. Infer likely character reactions from live character/lore/chat continuity.",
            "3. Show a useful story flow: current scene -> near/mid buildup -> distant target when relevant.",
            "4. A distant-future target is NOT a current-scene command. Reverse-plan prerequisites and advance only the earliest believable missing layer now.",
            "5. Expand implications of the user's idea, but do not replace it with an unrelated plot.",
            "6. Use active world/mutation mechanics as real affordances when relevant; do not merely list them as lore.",
            "7. The final writerInstruction must be a self-contained directive to the writer model. It must instruct, not write the actual prose scene.",
            "8. Avoid rushing relationships or payoffs merely because the target is known. Explicit user timing like 'later', 'far future', 'not yet', 'slowly' has high priority.",
            "9. Do not make every category equally long. Spend detail where the user's note actually needs it.",
            "10. Use USER STORY DNA as soft taste guidance when it genuinely fits the current story. Never override current user direction or canon with it.",
            "11. Give 0-3 optional tasteSuggestions when a Story DNA preference suggests a particularly fitting future direction. Phrase them conversationally, e.g. '너는 이런 누적형 전개를 좋아하는 편이니까, 여기서는 ... 어때?'. They are recommendations only and must not silently become LOCKED or writerInstruction requirements.",
            "12. Learn Story DNA conservatively. Only extract a GLOBAL preference when the user's wording/correction reveals a reusable preference about HOW stories should progress across unrelated bots. A one-off desire for this specific character or plot is story-scoped, not global.",
            "13. Never infer sensitive real-world traits from fiction taste. Story DNA is only about narrative craft/tropes/pacing/interaction style.",
            "14. CONTINUATION ANCHOR: Identify exactly where the LAST ACTUAL ASSISTANT STORY OUTPUT ENDS, including physical location, active gesture and unresolved immediate choice. Start after that point, not at the start of its chapter.",
            "15. COMPLETED-EVENT FILTER: Treat scenes and milestones explicitly completed in the live chat as DONE. Do not put them in now/writerInstruction as future steps unless the user explicitly asks for a replay, rewrite, flashback or recap.",
            "16. If a rough note describes an event that already occurred, interpret it as background/context for its NEXT CONSEQUENCE unless explicit replay is requested. Preserve new desired outcomes without repeating prior travel, arrival, payment, discoveries or similar completed actions.",
            "17. Resolve disagreements in this order: explicit new user instruction > latest actual live chat for what happened > older BardWiki for durable background > previous Director result. Previous Director results are draft plans, NEVER evidence that something is unfinished.",
            "",
            "## STORY DNA LEARNING",
            "For each reusable preference signal, emit a short canonical snake_case key, category, one clear Korean statement, polarity like/avoid, scope global/story, confidence 0..1, explicit true only when the user actually states/evaluates a preference, generalizable true only when it should transfer to unrelated bots, and brief evidence.",
            "If unsure whether a preference is reusable, mark scope=story or generalizable=false. Do not overlearn from mere plot content.",
            "profileSummary should be a compact updated summary of the user's reusable narrative tastes after considering existing Story DNA plus genuinely new global evidence.",
            "",
            "## CLASSIFICATION SEMANTICS",
            "LOCKED = user clearly says it must happen / already happened / is fixed canon.",
            "CURRENT PREFERENCE = desired direction for the current scene but not an absolute fact.",
            "MID-TERM = desired development over several scenes/episodes.",
            "LONG-TERM TARGET = distant payoff or state to build toward, not to force now.",
            "OPTIONAL = speculative 'could be fun' idea.",
            "NOT YET = things that would be premature or contradict the user's timing.",
            "",
            "## OUTPUT",
            "Return ONLY valid JSON with this exact shape:",
            JSON.stringify({
              currentState: "concise Korean reconstruction of the actual current scene/state before planning",
              summary: "one short sentence saying how you interpreted the rough note",
              flow: "readable roadmap in Korean; use short paragraphs/arrows when useful",
              now: "what the writer should actually accomplish in the next response / current scene",
              writerInstruction: "complete natural-language instruction for the writer model; never the actual story prose",
              tasteSuggestions: ["0-3 optional recommendations based on Story DNA and the current story; not mandatory"],
              storyDnaLearning: {
                profileSummary: "compact updated reusable taste summary",
                observations: [{
                  key: "canonical_snake_case_concept",
                  category: "pacing | protagonist | character | world | tone | structure | director | other",
                  statement: "reusable Korean preference statement",
                  polarity: "like | avoid",
                  scope: "global | story",
                  confidence: 0.0,
                  explicit: false,
                  generalizable: false,
                  evidence: "short reason from the user's wording/correction"
                }]
              },
              interpretation: {
                locked: ["..."],
                currentPreferences: ["..."],
                midTerm: ["..."],
                longTermTargets: ["..."],
                optionalIdeas: ["..."],
                notYet: ["..."]
              }
            }, null, 2),
            "",
            "Write all values in Korean unless an established proper noun is better preserved as-is.",
            "Before proposing flow, reconstruct CURRENT STATE from the LAST actual live chat output FIRST, using BardWiki only for background not superseded by the live chat. The currentState field must identify the exact last action and what is already completed.",
            "PERSISTENT CAST: identify continuing companions or assigned characters from the latest accepted chat output and current canon. Keep their established identity and relationship stable across scenes. Do not create a different role holder when one already exists; treat older plans as history, not authority. Do not add an unrelated subplot just to demonstrate the role.",
            directorContextText(ctx),
          ].filter(Boolean).join("\n\n"),
        },
      ];

      for (const m of recent) {
        const role = m.role === "assistant" || m.role === "char" ? "assistant" : "user";
        messages.push({ role, content: text(m.content || m.data) });
      }

      const previous = directorAnalysisForPrompt();
      messages.push({
        role: "user",
        content: [
          "# USER ROUGH NOTE",
          rough,
          previous ? ("# PREVIOUS DIRECTOR RESULT — historical draft only; ignore steps the actual chat has already completed\n" + previous) : "",
          "First locate the exact ending of the latest actual story output. Exclude all completed earlier steps from the new continuation. Then organize the intent and produce the writer-ready directive."
        ].filter(Boolean).join("\n\n"),
      });

      const result = await auxiliary(messages);
      const parsed = extractJson(result);
      const normalized = normalizedDirectorAnalysis(parsed);
      if (!normalized.flow && !normalized.now && !normalized.writerInstruction) {
        throw new Error("디렉터가 유효한 결과를 만들지 못했어. 한 번 더 눌러줘.");
      }
      project.directorAnalysis = normalized;
      project.directorUpdatedAt = Date.now();
      try { await applyStoryDnaLearning(normalized.storyDnaLearning); } catch (dnaError) {
        storyDnaError = dnaError && dnaError.message ? dnaError.message : String(dnaError);
      }
      await saveProject();
      return normalized;
    } catch (error) {
      directorError = error && error.message ? error.message : String(error);
      throw error;
    } finally {
      directorBusy = false;
      if (uiOpen) renderUI();
    }
  }

  async function useDirectorInstruction() {
    const a = project.directorAnalysis;
    if (!a || !text(a.writerInstruction).trim()) throw new Error("먼저 AI 디렉터로 내용을 정리해줘.");
    project.destination = text(a.writerInstruction).trim();
    project.planningLocked = false;
    await saveProject();
    uiTab = "director";
    if (uiOpen) renderUI();
  }

  // Optional proposals only. Never mutate the approved outline or auto-run the writer.
  async function generateNextEpisodeChoices() {
    await requireTarget();
    if (nextEpisodeBusy || directorBusy) return;
    nextEpisodeBusy = true;
    nextEpisodeError = "";
    if (uiOpen) renderUI();
    try {
      const direction = text(project.nextEpisodeDirection).trim();
      project.nextEpisodeDirection = direction;
      const ctx = await readDirectorContext("다음 화 전개 추천 세 가지. 최신 실제 채팅의 끝과 미해결 사건 기준" + (direction ? " / 사용자 추가 방향: " + direction.slice(0,1200) : ""));
      const tail = Array.isArray(ctx.recentMessages) ? ctx.recentMessages : [];
      const latest = tail.filter((m) => m.role === "assistant").slice(-1)[0];
      if (!latest || !text(latest.content).trim()) throw new Error("추천할 실제 이야기 출력이 없어. 먼저 한 화를 진행해줘.");
      const messages = [{ role: "system", content: [
        "# NEXT EPISODE OPTION EDITOR",
        "You only recommend, never write a story or silently select an option.",
        "Return STRICT JSON only, with exactly three DIFFERENT feasible NEXT-EPISODE ideas.",
        "The newest actual assistant story ending is the sole continuation anchor. Completed events must not be proposed again.",
        "Preserve existing cast, relationships, canon, chronology and unresolved decisions. Do not claim a draft plan already happened.",
        "Use existing Director mid/long targets when relevant, but do not automatically execute distant payoff now.",
        "The three options must differ meaningfully in incident and character interaction, not just wording or pacing.",
        "In realistic relationship-drama NTR mode, work in ordinary social reality; distinguish what is verified, what each character knows, what they have observed, what they suspect and what they misinterpret. Do not give characters omniscient knowledge.",
        "Build specific evidence through gradual, plausible behavior changes. The existing partner may notice evidence without correctly inferring the secret; do not portray them as automatically foolish or automatically omniscient.",
        "Propose three substantially different causal next-episode situations: a private decision, a social collision, or a mundane incident with a distinctive consequence as appropriate. Avoid the same generic triangle premise three times.",
        "Do not force suspicion, revelation, seduction, a confession, or an accelerated payoff just to demonstrate the genre. Everyone retains agency and pre-existing personality.",
        "Offer concrete scenes to watch (actions, encounter, complication and consequence), not empty thematic abstractions.",
        "Offer varying moods and a surprising yet plausible option where appropriate. Avoid always defaulting to slow buildup.",
        "The user controls pacing, choices and edits. The recommendation does NOT set a mandatory speed or stop point.",
        "The NEXT EPISODE USER DIRECTION below is authoritative for the three options. Treat its required beats and exclusions as constraints. Generate three meaningfully different options inside those constraints; do not quietly ignore the user direction.",
        "# NEXT EPISODE USER DIRECTION\n" + (direction || "(none; recommend freely from current canon and user goals)"),
        "Do not infer new global Story DNA preferences from AI-generated options alone.",
        "All text fields should be concise Korean, except established proper nouns.",
        "Return {\"anchor\":\"last actual action and location\",\"knowledgeLedger\":{\"verified\":[\"only events supported by supplied text\"],\"characters\":[{\"name\":\"\",\"knows\":[\"\"],\"observed\":[\"\"],\"suspects\":[\"\"],\"unknown\":[\"\"]}],\"openThreads\":[\"\"]},\"options\":[{\"title\":\"\",\"premise\":\"specific next episode events\",\"highlights\":\"scene and interaction worth watching\",\"why\":\"continuity/appeal\",\"writerSeed\":\"concise self-contained director brief for selected option\"}]}. The knowledgeLedger must be populated conservatively from ACTUAL live prose and corrected using BardWiki, not from your speculative options.",
        directorContextText(ctx),
        "# PREVIOUS DIRECTOR TARGETS (unconfirmed plans; not historical facts)\n" + directorAnalysisForPrompt()
      ].join("\n\n") }];
      for (const m of tail.slice(-4)) messages.push({ role: m.role === "assistant" ? "assistant" : "user", content: text(m.content) });
      messages.push({role:"user",content:"현재 실제 산문 이후의 다음 화 3개를 추천해. 이미 끝난 장면은 반복하지 마." + (direction ? "\n이번 추천에서 반드시 반영할 사용자 지시:\n" + direction : "")});
      const raw = extractJson(await auxiliary(messages));
      const options = Array.isArray(raw.options) ? raw.options.slice(0,3) : [];
      if (options.length !== 3 || options.some((x) => !text(x && x.title).trim() || !text(x && x.writerSeed).trim())) throw new Error("세 가지 추천안이 정상적으로 생성되지 않았어. 다시 추천을 눌러줘.");
      project.nextEpisodeChoices = options.map((x,i) => ({id:"next_" + i, title:text(x.title), premise:text(x.premise), highlights:text(x.highlights), why:text(x.why), writerSeed:text(x.writerSeed)}));
      if (ctx.mutationContext && ctx.mutationContext.mode === "ntr" && raw.knowledgeLedger && typeof raw.knowledgeLedger === "object") {
        const led = raw.knowledgeLedger;
        project.ntrKnowledgeLedger = {
          verified: stringList(led.verified).slice(0, 16).map(x => x.slice(0, 240)),
          characters: (Array.isArray(led.characters) ? led.characters : []).slice(0, 8).map(c => ({
            name: text(c && c.name).slice(0, 80),
            knows: stringList(c && c.knows).slice(0, 8),
            observed: stringList(c && c.observed).slice(0, 8),
            suspects: stringList(c && c.suspects).slice(0, 8),
            unknown: stringList(c && c.unknown).slice(0, 8)
          })),
          openThreads: stringList(led.openThreads).slice(0, 12),
          updatedAt: Date.now()
        };
      }
      project.nextEpisodeAnchor = text(raw.anchor).slice(0,800);
      project.nextEpisodeGeneratedAt = Date.now();
      project.nextEpisodeStale = false;
      await saveProject();
    } catch (error) {
      nextEpisodeError = error && error.message ? error.message : String(error);
    } finally {
      nextEpisodeBusy = false;
      if (uiOpen) renderUI();
    }
  }

  async function selectNextEpisodeChoice(index) {
    const choice = Array.isArray(project.nextEpisodeChoices) ? project.nextEpisodeChoices[index] : null;
    if (!choice) return;
    // No second AI planning pass: selection creates an editable instruction immediately.
    project.nextEpisodeDraft = [
      text(choice.writerSeed).trim() || text(choice.premise).trim(),
      "실제 최신 채팅의 끝에서 이어서 작성하고 이미 완료된 사건을 반복하지 말 것."
    ].filter(Boolean).join("\n\n");
    await saveProject();
    if (uiOpen) renderUI();
  }

  async function applyNextEpisodeDraft() {
    const draft = text(project.nextEpisodeDraft).trim();
    if (!draft) throw new Error("먼저 다음 화 추천안을 선택하거나 방향을 입력해줘.");
    // Choice remains a proposal until AI Director creates a rolling episode outline.
    project.destination = draft;
    project.planningLocked = false;
    await saveProject();
    uiTab = "director";
    if (uiOpen) renderUI();
  }

  function nextEpisodeChoicesHtmlUnsafe() {
    const choices = Array.isArray(project.nextEpisodeChoices) ? project.nextEpisodeChoices : [];
    const notice = project.nextEpisodeStale && choices.length
      ? '<p class="status">최신 채팅이 변경됐어. 필요한 경우 다시 추천받아줘.</p>' : '';
    return '<div class="sr-card"><div class="suggest-head"><div><h3>1. 다음 화 추천</h3><p class="status">서로 다른 세 가지 방향을 추천해. 선택해도 소설은 바로 생성되지 않아.</p></div>' +
      '<button id="sr-next-episode-generate"' + (nextEpisodeBusy || directorBusy || !currentTarget ? ' disabled' : '') + '>' + (nextEpisodeBusy ? '추천 작성 중...' : '3안 추천 / 다시 추천') + '</button></div>' +
      '<label for="sr-next-episode-direction"><b>추천에 반영할 방향 (선택)</b></label>' +
      '<textarea id="sr-next-episode-direction" rows="3" placeholder="원하는 사건, 분위기, 제외할 전개를 자유롭게 입력" style="display:block;width:100%;box-sizing:border-box;margin-top:7px;padding:10px;border-radius:8px;background:#151b2b;color:inherit;border:1px solid #53617b;resize:vertical">' + escapeHtml(project.nextEpisodeDirection || '') + '</textarea>' +
      notice + (nextEpisodeError ? '<p class="error">' + escapeHtml(nextEpisodeError) + '</p>' : '') +
      (choices.length ? '<div class="suggest-grid">' + choices.map((x,i) => '<div class="suggest-card"><b>' + String.fromCharCode(65+i) + '안 · ' + escapeHtml(x.title) + '</b>' +
         '<p>' + escapeHtml(x.premise) + '</p>' +
         '<details><summary>추천 이유·장면 상세</summary>' + (x.highlights ? '<p>' + escapeHtml(x.highlights) + '</p>' : '') + (x.why ? '<p>' + escapeHtml(x.why) + '</p>' : '') + '</details>' +
         '<button class="sr-next-episode-select" data-index="' + i + '">이 안 선택</button></div>').join('') + '</div>' : '<p class="status">위 버튼으로 다음 화 세 가지를 추천받아줘.</p>') +
      '</div>';
  }

  function nextEpisodeDraftHtml() {
    return '<div class="sr-card"><h3>2. 다음 화 지시문</h3>' +
      '<p class="status">추천한 방향을 고치고 아래에서 설계안을 만들어. 아직 실행하거나 확정하지 않아.</p>' +
      '<textarea id="sr-next-episode-draft" rows="6" placeholder="추천안을 선택하거나 다음 화 지시를 직접 적어줘." style="display:block;width:100%;box-sizing:border-box;margin:8px 0;padding:12px;border-radius:9px;background:#151b2b;color:inherit;border:1px solid #53617b;resize:vertical">' + escapeHtml(project.nextEpisodeDraft || '') + '</textarea>' +
      '<button id="sr-next-episode-use" class="primary">이 방향으로 설계하기</button>' +
      '</div>';
  }

  function nextEpisodeChoicesHtml() {
    try {
      return nextEpisodeChoicesHtmlUnsafe();
    } catch (error) {
      const reason = error && error.message ? String(error.message) : String(error);
      console.log("[StoryRunner] next episode panel failed", error);
      return '<div class="sr-card"><b>다음 화 추천 패널 복구 모드</b>' +
        '<p class="error">' + escapeHtml(reason) + '</p>' +
        '<p class="status">나머지 Story Runner 기능은 계속 사용할 수 있어. 저장된 다음 화 추천 데이터는 삭제되지 않았어.</p></div>';
    }
  }

  async function generateStorySuggestions(force) {
    await requireTarget();
    if (storySuggestionBusy) return;
    if (!force && Array.isArray(project.storySuggestions) && project.storySuggestions.length) return;
    storySuggestionBusy = true;
    storySuggestionError = "";
    if (uiOpen) renderUI();
    try {
      const ctx = await readPlanningContext("Story Runner 시작 아이디어 추천", false);
      const response = await auxiliary([
        {
          role: "system",
          content: [
            "You are a story-starter editor for an already-running or just-starting Risu roleplay.",
            storyModeSystemText(),
            "IMPORTANT OUTPUT FORMAT: Return ONLY strict JSON. Do not output XML tags, markdown, explanations, or code fences unless the entire content is a single valid JSON object.",
            "Generate 4 DISTINCT story-start suggestions that the user can begin immediately.",
            "These are not season outlines. Each suggestion must be a scene-sized entry point that can naturally grow into the next 1-3 episodes.",
            "Use USER STORY DNA only as soft preference guidance: favor options that fit the user's known tastes when they also fit canon, and explain the fit in whyFits. Do not mechanically repeat the same trope every time.",
            "Use the current character card, active Lorebook, BardWiki, and recent chat as ground truth. Do not invent a different cast, genre, or premise just to manufacture drama.",
            cameoPoolInstruction(),
            "If the chat is empty or barely started, mine SPECIFIC hooks from the actual character identity, relationships, setting, occupations, secrets, habits, contradictions, unfinished business, and world rules.",
            "If the chat is already underway, begin from the exact current situation and pressure what is already alive there. Do not reset, recap, or jump to a generic new incident.",
            "QUALITY BAR: first silently brainstorm at least 8 candidate openings, reject the generic/duplicate ones, and return only the strongest 4. Do not reveal this brainstorming.",
            "Every returned option needs a DRAMATIC ENGINE visible in the first scene: somebody wants something now, something/someone pushes back or complicates it, and the scene must change the situation rather than merely provide atmosphere.",
            "Prefer character collision over exposition. Let personalities create trouble: interruption, misread intention, bad timing, pride, lie, secret almost exposed, competing goals, awkward obligation, unexpected competence, small betrayal, temptation, social friction, or a practical problem that forces two people together.",
            "Avoid bland hooks such as 'they spend an ordinary day', 'someone receives a mysterious message', 'a new person appears', 'they talk about their feelings', 'a request arrives', or 'a problem occurs' UNLESS you ground it in concrete existing lore and specify exactly who, what, why now, and what makes the first scene fun or tense.",
            "Do not turn all four options into heavy drama. Aim for variety: at least one option driven by relationship/banter or social friction, one by a concrete practical incident/task, one by an existing secret/conflict being pressured, and one that is the most surprising-but-character-faithful choice available from the current material.",
            "Keep the player agency alive. The opening must create an immediate choice, reaction, or conversational move for the user instead of deciding the user's response in advance.",
            "Do not solve the central hook inside the recommendation. End each opening with useful pressure still active.",
            "openingScene must describe the first 1-3 minutes of playable action, with concrete place, who is present, what just happened, and the immediate friction. It must not be a synopsis of an entire episode.",
            "hook should be one sharp sentence explaining why the situation is interesting NOW, not a generic theme.",
            "whyFits must cite 1-3 concrete facts already present in the supplied character/lore/chat context, without quoting huge passages.",
            "seed must be a natural Korean instruction the user could directly reuse in '보고 싶은 상황 / 장면 / 방향'. It should specify the desired scene/direction without locking the ending.",
            "sceneIdeas should contain 2-4 optional near-future complications or character beats. They are inspiration, NOT mandatory checklist items and NOT distant plot outcomes.",
            "Make the four options meaningfully different in dramatic engine and emotional flavor. Do not merely swap character names while repeating the same structure.",
            "Do not merely restate character profiles or world rules. Convert them into events, choices, collisions, and consequences that can actually be played.",
            "Keep each option compact and vivid. Avoid deciding distant outcomes, season arcs, final pairings, or guaranteed victories.",
            "Write all visible fields in natural Korean. Avoid stiff planning jargon, generic AI phrasing, and phrases like '이야기가 전개된다', '관계가 발전한다', or '갈등이 심화된다' when a concrete action can be stated instead.",
            "Schema: {\"suggestions\":[{\"title\":string,\"hook\":string,\"openingScene\":string,\"whyFits\":string,\"seed\":string,\"sceneIdeas\":string[]}]}"
          ].join("\n"),
        },
        {
          role: "user",
          content: JSON.stringify({
            storyMode: storyModeLabel(),
            currentCharacter: ctx.currentCharacter,
            activeLoreAndModuleRules: ctx.lore,
            bardWiki: ctx.wikiContent,
            characterWikiDocs: ctx.characterWikiDocs,
            cameoPool: ctx.cameoPool,
            recentMessages: ctx.recentMessages,
            existingDirection: project.destination,
            storyDNA: storyDnaPromptText("recommendation"),
          }),
        },
      ]);
      const parsed = await extractJsonWithModelRepair(response, '{"suggestions":[{"title":string,"hook":string,"openingScene":string,"whyFits":string,"seed":string,"sceneIdeas":string[]}]}', '시작 아이디어 추천');
      const rows = Array.isArray(parsed.suggestions) ? parsed.suggestions.slice(0, 5) : [];
      project.storySuggestions = rows.map((item, index) => ({
        id: text(item && item.id) || ("suggestion_" + index + "_" + Date.now()),
        title: text(item && item.title) || ("아이디어 " + (index + 1)),
        hook: text(item && item.hook),
        openingScene: text(item && item.openingScene),
        whyFits: text(item && item.whyFits),
        seed: text(item && item.seed) || text(item && item.hook) || text(item && item.title),
        sceneIdeas: stringList(item && item.sceneIdeas).slice(0, 4),
      })).filter((item) => item.seed || item.title);
      project.storySuggestionGeneratedAt = Date.now();
      await saveProject();
    } catch (error) {
      storySuggestionError = error && error.message ? error.message : String(error);
    } finally {
      storySuggestionBusy = false;
      if (uiOpen) renderUI();
    }
  }


  // WHOLE-STORY BLUEPRINT (v0.94): a revisable outline. Plans never become canon.
  function emptyStoryBlueprint() {
    return {version:1,title:'',premise:'',endDirection:'',sections:[],updatedAt:0};
  }

  function normalizeStoryBlueprint(raw) {
    if (!raw || typeof raw !== 'object') return emptyStoryBlueprint();
    return {
      version:1,
      title:text(raw.title).slice(0,180),
      premise:text(raw.premise).slice(0,2400),
      endDirection:text(raw.endDirection).slice(0,2000),
      updatedAt:Number(raw.updatedAt)||0,
      sections:(Array.isArray(raw.sections)?raw.sections:[]).slice(0,16).map((sec,i)=>({
        id:text(sec&&sec.id)||uid('arc'),
        title:text(sec&&sec.title).slice(0,180)||('구간 '+(i+1)),
        purpose:text(sec&&sec.purpose).slice(0,1300),
        beats:(Array.isArray(sec&&sec.beats)?sec.beats:[]).slice(0,16).map((beat,j)=>({
          id:text(beat&&beat.id)||uid('beat'),
          title:text(beat&&beat.title).slice(0,180)||('장면 '+(j+1)),
          description:text(beat&&beat.description).slice(0,2200),
          status:['done','skipped'].includes(text(beat&&beat.status))?text(beat.status):'planned',
          evidence:text(beat&&beat.evidence).slice(0,240),
        }))
      }))
    };
  }

  // AI STORY STUDIO v0.95: discuss a rough idea first; do NOT replace the approved plan
  // until the user explicitly accepts a reviewable draft.
  function emptyStoryStudio() {
    return {input:'',messages:[],draft:null,baseUpdatedAt:0,reply:'',question:'',suggestions:[],updatedAt:0};
  }

  function normalizeStoryStudio(raw) {
    if (!raw || typeof raw !== 'object') return emptyStoryStudio();
    const candidate=raw.draft && typeof raw.draft==='object' ? normalizeStoryBlueprint(raw.draft) : null;
    return {
      input:text(raw.input).slice(0,3000),
      messages:(Array.isArray(raw.messages)?raw.messages:[]).slice(-16).map(row=>({
        role:row&&row.role==='assistant'?'assistant':'user',
        content:text(row&&row.content).slice(0,2200)
      })).filter(row=>row.content),
      draft:candidate&&candidate.sections.length?candidate:null,
      baseUpdatedAt:Number(raw.baseUpdatedAt)||0,
      reply:text(raw.reply).slice(0,2000),
      question:text(raw.question).slice(0,550),
      suggestions:stringList(raw.suggestions).slice(0,3).map(item=>item.slice(0,240)),
      updatedAt:Number(raw.updatedAt)||0,
    };
  }

  function storyStudioHtml() {
    const studio=normalizeStoryStudio(project.storyStudio);
    const actual=normalizeStoryBlueprint(project.storyBlueprint);
    const draft=studio.draft;
    const total=draft?draft.sections.reduce((n,sec)=>n+sec.beats.length,0):0;
    const stale=!!draft&&studio.baseUpdatedAt!==actual.updatedAt;
    const busy=storyStudioBusy||blueprintBusy||!!modernBusy||!!(aiTask&&aiTask.active);
    const messages=studio.messages.slice(-8);
    const dialog=messages.length?'<div class="m-studio-log" role="log" aria-label="AI 설계 대화">'+messages.map(row=>
       '<div class="m-studio-bubble '+(row.role==='user'?'from-user':'from-ai')+'"><small>'+(row.role==='user'?'내 요청':'AI 제안')+'</small><p>'+escapeHtml(row.content)+'</p></div>').join('')+'</div>':'';
    const question=studio.question?'<div class="m-studio-question"><b>더 생각해볼 점</b><p>'+escapeHtml(studio.question)+'</p></div>':'';
    const suggestionBtns=studio.suggestions.length?'<div class="m-studio-suggestions">'+studio.suggestions.map((item,i)=>
        '<button type="button" class="m-textbtn" data-studio-suggestion="'+i+'"'+(busy?' disabled':'')+'>'+escapeHtml(item)+'</button>').join('')+'</div>':'';
    const candidate=draft?'<div class="m-studio-draft"><div class="m-sectiontop"><h3>AI가 다듬은 임시 설계</h3><span>'+draft.sections.length+'구간 · '+total+'장면</span></div><p class="m-muted">'+escapeHtml(draft.premise||draft.title)+'</p>'+question+suggestionBtns+
      '<details class="m-details"><summary>임시 설계 자세히 보기 <span>확정 전</span></summary><div class="m-detailbody">'+draft.sections.map(sec=>
         '<p><b>'+escapeHtml(sec.title)+'</b> — '+escapeHtml(sec.purpose)+'</p><ul>'+sec.beats.map(beat=>'<li>'+escapeHtml(beat.title)+' — '+escapeHtml(beat.description)+'</li>').join('')+'</ul>').join('')+'</div></details>'+
      (stale?'<p class="m-warn">그사이 확정 설계가 변경됐어. AI에게 다시 다듬기를 요청한 뒤 확정해줘.</p>':'')+
      '<div class="m-studio-accept"><button type="button" class="m-primary" id="m-studio-accept"'+(busy||stale?' disabled':'')+'>이 설계로 확정</button><button type="button" class="m-outline" id="m-studio-discard"'+(busy?' disabled':'')+'>임시 초안 버리기</button></div></div>':'';
    return '<section class="m-studio" aria-label="AI와 설계 다듬기"><div class="m-sectiontop"><h3>AI와 설계 다듬기</h3><span>처음부터 다 쓸 필요 없어</span></div>'+
      '<p class="m-muted">보고 싶은 장면이나 바꾸고 싶은 것만 짧게 말해. AI가 이야기의 앞뒤와 인물 동기를 채워서 <b>임시 설계</b>로 제안해. 확정 버튼을 누르기 전에는 기존 설계를 바꾸지 않아. <b>설계: 보조 모델 · 집필: 메인 모델</b></p>'+
      dialog+ '<label class="m-label" for="m-studio-input">'+(draft?'다음 수정 지시':'첫 구상 또는 떠오르는 생각')+' <span>한두 문장도 충분</span></label>'+
      '<textarea id="m-studio-input" rows="3" maxlength="3000" placeholder="예: 처음은 빠르게 시작하고, 중간에 오해가 쌓이다가 마지막엔 큰 선택을 하게. 구체적인 사건은 알아서 채워줘.">'+escapeHtml(studio.input)+'</textarea>'+
      '<button type="button" id="m-studio-talk" class="m-primary m-studio-talk"'+(busy||!currentTarget?' disabled':'')+'>'+(storyStudioBusy?'AI가 설계 다듬는 중…':draft?'✦ 이 의견으로 다시 다듬기':'✦ AI와 설계 시작')+'</button>'+
      (studio.reply&&!messages.length?'<p class="m-muted">'+escapeHtml(studio.reply)+'</p>':'')+candidate+
      '<p class="m-muted">질문에 꼭 답할 필요 없어. “좋아”, “좀 더 갈등 넣어줘”, “3번째 장면부터 바꿔줘”처럼 이어서 말하면 돼.</p></section>';
  }

  async function discussStoryBlueprint(userMessage) {
    if(storyStudioBusy||blueprintBusy||!!modernBusy) return;
    await requireTarget();
    if(project.running) await pauseRunner();
    const key=targetKey(currentTarget);
    const base=normalizeStoryBlueprint(project.storyBlueprint);
    const studio=normalizeStoryStudio(project.storyStudio);
    const userText=text(userMessage).trim().slice(0,3000)||
      (studio.draft?'지금까지의 구상을 더 자연스럽고 흥미롭게 다듬어줘.':'현재 설정을 바탕으로 장편 이야기의 전체 흐름을 먼저 제안해줘.');
    const previous=studio.draft&&studio.baseUpdatedAt===base.updatedAt ? studio.draft : null;
    storyStudioBusy=true;
    if(uiOpen)renderUI();
    try {
      const ctx=await readPlanningContext('대화형 전체 설계 개선');
      const book=normalizeStoryNotebook(project.storyNotebook);
      const verified=book.version===2&&book.confidence==='checked'&&book.lastProcessedAt?{
        summary:book.summary,lastEvent:book.lastEvent,verifiedEvents:book.groundedEvents.slice(-8)
      }:null;
      const messages=[
        {role:'system',content:[
          'STORY DESIGN COACH — reply in one JSON object only, with no markdown fences.',
          'You are a thoughtful collaborative story editor, not a chapter writer or a rigid command interpreter.',
          'The user may give ONLY a single scene, trope, vague mood, or change request. NEVER demand a full specification.',
          'Infer plausible connective events, character motives, causal consequences, complications and a provisional ending to propose a coherent entire story.',
          'Return {"reply":"brief Korean feedback of what was understood and creatively improved","question":"at most ONE optional clarification that could make the story better, or empty","suggestions":["short possible answer A","short possible answer B"],"blueprint":{"title":"","premise":"","endDirection":"","sections":[{"id":"optional","title":"act title","purpose":"arc function","beats":[{"id":"optional","title":"scene beat title","description":"causal event and change"}]}]}}.',
          'Usually propose 3-6 broad acts, 2-5 beats in each. Preserve EVERY explicitly requested event and ordering while avoiding redundant filler.',
          'Critique and improve the instruction without erasing the core user wish. Fill missing links with clearly provisional creative proposals, not alleged canon.',
          'For iterative revisions, treat the previous DRAFT as editable, keep its good parts and update only what the new user message changes.',
          'If the user says something like "not there, stop before the reveal", redirect only unwritten future beats; do not rewrite already accepted chat.',
          'The existing ACCEPTED blueprint is not changed by this AI discussion. Your output is a PROPOSAL for user approval.',
          'Preserve known names, active Risu rules, character and lore constraints. Never treat an unplayed beat as accomplished history.',
          'The optional question must NEVER block the creation of a useful complete proposal; default intelligently and label uncertain directions as ideas.',
          'Do not conflate one story beat with one chapter or one model response; turn labels supplied by the author refer to planning steps unless explicitly fixed.',
          'Prioritize interesting scenes, dramatic consequence, authentic dialogue potential, and credible character choices over generic episodic meetings.',
          'All narrative text in Korean. Keep reply to about 2-4 sentences and question to at most one specific question.',
        ].join('\n')},
        {role:'user',content:JSON.stringify({
          userLatest:userText,
          conversation:studio.messages.slice(-10),
          acceptedBlueprint:base.sections.length?base:null,
          editableDraft:previous,
          storySetup:text(project.modernStorySetup).slice(0,8500),
          directInstruction:text(project.modernDirection).slice(0,2500),
          savedLiveChat:ctx.recentMessages,
          verifiedMemory:verified,
          currentCharacter:ctx.currentCharacter,
          lore:ctx.lore,
          bardWiki:ctx.wikiContent,
          storyDNA:storyDnaPromptText('director')
        })},
      ];
      const answer=await auxiliary(messages);
      const parsed=await extractJsonWithModelRepair(answer,
        '{"reply":string,"question":string?,"suggestions":string[]?,"blueprint":{"title":string,"premise":string,"endDirection":string,"sections":[{"id":string?,"title":string,"purpose":string,"beats":[{"id":string?,"title":string,"description":string}]}]}}',
        'AI와 설계 다듬기');
      const draft=normalizeStoryBlueprint(parsed.blueprint||parsed.outline||parsed.proposal);
      if(!draft.sections.length||draft.sections.every(sec=>!sec.beats.length)) throw new Error('AI가 유효한 전체 설계안을 만들지 못했어. 다시 요청해줘.');
      if(!currentTarget||targetKey(currentTarget)!==key)throw new Error('설계하는 동안 채팅이 바뀌었어. 현재 채팅에서 다시 요청해줘.');
      if(normalizeStoryBlueprint(project.storyBlueprint).updatedAt!==base.updatedAt)
        throw new Error('그사이 확정 설계가 변경됐어. 다시 다듬기를 실행해줘.');
      const reply=text(parsed.reply).trim().slice(0,2000)||'짧은 요청을 바탕으로 전체 이야기와 장면 연결을 보완한 임시 설계안을 만들었어.';
      project.storyStudio={
        input:'',
        messages:studio.messages.concat([{role:'user',content:userText},{role:'assistant',content:reply}]).slice(-16),
        draft,baseUpdatedAt:base.updatedAt,reply,
        question:text(parsed.question).trim().slice(0,550),
        suggestions:stringList(parsed.suggestions).slice(0,3).map(s=>s.slice(0,240)),
        updatedAt:Date.now()
      };
      await saveProject();
    } finally {storyStudioBusy=false;if(uiOpen)renderUI();}
  }

  async function approveStoryStudioDraft() {
    if(storyStudioBusy||blueprintBusy)return;
    const studio=normalizeStoryStudio(project.storyStudio);
    const base=normalizeStoryBlueprint(project.storyBlueprint);
    if(!studio.draft)throw new Error('확정할 AI 임시 설계가 없어.');
    if(studio.baseUpdatedAt!==base.updatedAt)throw new Error('확정 설계가 바뀌었어. AI에게 다시 다듬기를 요청해줘.');
    const proposed=normalizeStoryBlueprint(studio.draft);
    const completed=base.sections.flatMap(sec=>sec.beats.filter(b=>b.status==='done').map(b=>({...b})));
    const completeIds=new Set(completed.map(b=>b.id));
    const completeTitles=new Set(completed.map(b=>b.title.trim()));
    proposed.sections=proposed.sections.filter(sec=>sec.id!=='storyrunner_completed_archive').map(sec=>({
      ...sec,
      beats:sec.beats.filter(b=>!completeIds.has(b.id)&&!completeTitles.has(b.title.trim())).map(b=>({...b,status:'planned',evidence:''}))
    })).filter(sec=>sec.beats.length);
    if(completed.length)proposed.sections.unshift({id:'storyrunner_completed_archive',title:'이미 진행된 장면 (읽기 전용)',purpose:'실제로 완료된 사건. 미래 계획이 아님.',beats:completed});
    if(!proposed.sections.some(sec=>sec.beats.some(b=>b.status==='planned')))
      throw new Error('진행할 미래 장면이 없어. AI에게 미래 전개를 추가해달라고 요청해줘.');
    await commitStoryBlueprint(proposed,'AI와 논의한 전체 스토리라인 확정');
    project.modernDirection='';
    project.storyStudio={...studio,draft:null,baseUpdatedAt:project.storyBlueprint.updatedAt,input:'',question:'',suggestions:[],
      reply:'AI 설계를 확정했어. 이후에도 한두 문장으로 미래 흐름을 수정할 수 있어.'};
    await saveProject();
    blueprintEditorId='';
    blueprintEditorOpen=false;
    if(uiOpen)renderUI();
  }

  async function discardStoryStudioDraft() {
    const studio=normalizeStoryStudio(project.storyStudio);
    project.storyStudio={...studio,draft:null,input:'',question:'',suggestions:[],reply:'임시 초안을 버렸어. 확정 설계와 채팅 내용은 그대로야.'};
    await saveProject();
    if(uiOpen)renderUI();
  }

  function blueprintBeats() {
    const b=normalizeStoryBlueprint(project.storyBlueprint);
    return b.sections.flatMap(sec=>sec.beats.map(beat=>({sec,beat})));
  }

  function currentBlueprintBeat() {
    const rows=blueprintBeats();
    const focus=text(project.blueprintFocusId);
    return rows.find(x=>x.beat.id===focus && x.beat.status==='planned') || rows.find(x=>x.beat.status==='planned') || null;
  }

  function blueprintExecutionFocus() {
    const b=normalizeStoryBlueprint(project.storyBlueprint);
    if (!b.sections.length) return '';
    const all=blueprintBeats();
    const current=currentBlueprintBeat();
    const index=current?all.findIndex(row=>row.beat.id===current.beat.id):-1;
    const nearby=index>=0?all.slice(index,index+4):[];
    return [
      '# WHOLE-STORY OUTLINE (editable future intentions, NEVER evidence of past events)',
      'Overall idea: '+b.premise,
      'Long-term direction (can change): '+b.endDirection,
      'The actual SAVED chat and explicit user edits override this plan. Do not skip an unplayed beat simply to satisfy a later outline.',
      'Continue the CURRENT dramatic situation; upcoming beats are flexible possibilities, not a numbered action checklist.',
      ...nearby.map((r,i)=>(i?'Possible later development: ':'Current intended dramatic movement: ')+r.sec.title+' / '+r.beat.title+' — '+r.beat.description),
    ].filter(Boolean).join('\n').slice(0,5800);
  }

  function invalidateShortPlanAfterBlueprintChange() {
    // Never erase accepted chat or verified story memory. Only discard derived near-term instructions.
    project.planningOutline=null;
    project.planningLocked=false;
    project.nodes=[];
    project.currentNodeId=null;
    project.completedNodeIds=[];
    project.episodeRuntimeStatus={};
    project.modernPlannedBlueprintAt=0;
    project.modernPlannedDirection='';
    project.generationNonce=uid('gen');
  }

  async function commitStoryBlueprint(next, label) {
    if (project.running) await pauseRunner();
    const prior=normalizeStoryBlueprint(project.storyBlueprint);
    const incoming=normalizeStoryBlueprint(next);
    if (!incoming.sections.length) throw new Error('전체 설계에 적어도 하나의 구간이 필요해.');
    if (prior.sections.length) {
      project.blueprintHistory=(Array.isArray(project.blueprintHistory)?project.blueprintHistory:[]).concat([prior]).slice(-5);
    }
    incoming.updatedAt=Math.max(Date.now(),prior.updatedAt+1);
    project.storyBlueprint=incoming;
    const pending=incoming.sections.flatMap(sec=>sec.beats).filter(beat=>beat.status==='planned');
    if (!pending.some(beat=>beat.id===project.blueprintFocusId)) project.blueprintFocusId=pending[0]?.id||'';
    invalidateShortPlanAfterBlueprintChange();
    project.lastReason=label||'전체 스토리라인 수정 완료 · 다음 생성에 새 설계 반영';
    await saveProject();
  }

  // This asks AI for an entire flexible narrative arc, not three near-term episodes.
  async function generateWholeStoryBlueprint(changeRequest, forceNew) {
    if (storyStudioBusy || blueprintBusy) return;
    await requireTarget();
    if (project.running) await pauseRunner();
    const edit=text(changeRequest).trim();
    const before=normalizeStoryBlueprint(project.storyBlueprint);
    const editing=!!before.sections.length && !forceNew;
    const userDirection=text(project.modernDirection).trim();
    const userSetup=text(project.modernStorySetup).trim();
    if (!editing && !userDirection && !userSetup && !before.sections.length) throw new Error('먼저 작품의 전체 방향이나 기본 설정을 입력해줘.');
    blueprintBusy=true;
    modernBusy=editing?'전체 흐름 수정 중':'전체 흐름 설계 중';
    if(uiOpen)renderUI();
    try {
      const ctx=await readPlanningContext('전체 이야기 큰 흐름 및 장면 구조');
      const book=normalizeStoryNotebook(project.storyNotebook);
      const verified=book.version===2 && book.confidence==='checked' && book.lastProcessedAt ?
        {summary:book.summary,lastEvent:book.lastEvent,scene:book.scene,verifiedEvents:book.groundedEvents.slice(-8)} : null;
      const messages=[
        {role:'system',content:[
          'You are a long-form fiction STORY ARCHITECT, not a chapter writer. Return exactly one valid JSON object, no markdown or prefatory text.',
          'Create/revise a WHOLE-STORY BLUEPRINT (macro outline), NOT a short three-episode rolling plan.',
          'Structure: {"title":"...","premise":"...","endDirection":"...","sections":[{"id":"optional","title":"act/arc title","purpose":"dramatic purpose","beats":[{"id":"optional","title":"scene beat name","description":"specific causal development / change"}]}]}.',
          'Normally 3-7 broad sections with 2-6 flexible story beats each. Do not assign one chapter or generation turn per beat. A beat may be one scene or many turns, and one episode can span several beats.',
          'If the user supplies an ordered 1/2/3/4/5 turn list, preserve ALL user-specified story developments in that order as editable scene beats. Their word turn is a plotting milestone; do not force one AI reply or a chapter boundary per listed milestone.',
          'Keep a coherent beginning, middle, escalation and provisional ending. The user can completely change the unwritten second half after any accepted output.',
          'First give a compelling overall direction, middle complications and provisional landing; never lock the ending against future changes.',
          'Keep the existing Risu canon, character identities, timeline, and actual saved conversation authoritative. Plans are NOT history.',
          'Allow the user to replace/reorder/cancel any FUTURE beat halfway through writing. Mark no speculative events as already happened.',
          'If editing, keep all completed/verified past beats untouched; output ONLY the still-unwritten future sections, starting from actual current state. Honor the edit request, and preserve the untouched future where possible.',
          'Characters can react, change plans or surprise the author; events require causes and consequences. Avoid repetitive small encounters or generic filler.',
          'Do not turn beats into rigid per-turn mandates, and do not force every beat to happen if the live story naturally diverges.',
          'Use the world rules and existing relationships supplied by the active source. The new user instruction wins over old future plans, but not over already accepted facts.',
          'All user-facing text in Korean. JSON only.'
        ].join('\n')},
        {role:'user',content:JSON.stringify({
          overallDirection:userDirection,storySetup:userSetup,editRequest:edit||'',
          mode:editing?'revise_remaining_future_only':'create_entire_outline',
          previousOutline:before.sections.length?before:null,
          actualChatLastMessages:ctx.recentMessages,
          verifiedStoryMemory:verified,
          characterSnapshot:ctx.currentCharacter,
          currentLore:ctx.lore,
          bardWiki:ctx.wikiContent,
          storyDNA:storyDnaPromptText('director'),
        })}
      ];
      const answer=await auxiliary(messages);
      const parsed=await extractJsonWithModelRepair(answer,
        '{"title":string,"premise":string,"endDirection":string,"sections":[{"id":string?,"title":string,"purpose":string,"beats":[{"id":string?,"title":string,"description":string}]}]}',
        '전체 스토리라인');
      const incoming=normalizeStoryBlueprint(parsed);
      if (!incoming.sections.length || incoming.sections.every(x=>!x.beats.length)) throw new Error('AI가 유효한 전체 스토리라인을 반환하지 않았어.');
      if (before.sections.length) {
        // Even a full future redesign must not erase already-confirmed past progress.
        const finished=before.sections.flatMap(sec=>sec.beats.filter(b=>b.status==='done').map(b=>({...b})));
        const finishedIds=new Set(finished.map(x=>x.id));
        const finishedTitles=new Set(finished.map(x=>x.title.trim()));
        for(const sec of incoming.sections) {
          sec.beats=sec.beats.filter(b=>!finishedIds.has(b.id)&&!finishedTitles.has(b.title.trim()));
          sec.beats.forEach(b=>{b.status='planned';b.evidence='';});
        }
        incoming.sections=incoming.sections.filter(sec=>sec.beats.length);
        if(finished.length) incoming.sections.unshift({id:'storyrunner_completed_archive',title:'이미 진행된 장면 (읽기 전용)',purpose:'저장된 실제 대화의 확정 진행. 미래 계획이 아님.',beats:finished});
      }
      if (!incoming.sections.length) throw new Error('수정할 미래 장면이 비어 있어.');
      await commitStoryBlueprint(incoming,editing?'이후 흐름 수정 완료':'전체 스토리라인 작성 완료');
      if(!editing) { project.modernDirection=''; project.modernPlannedDirection=''; await saveProject(); }
      blueprintEditorId='';
      blueprintEditorOpen=true;
    } finally {blueprintBusy=false;modernBusy='';if(uiOpen)renderUI();}
  }

  async function restorePreviousBlueprint() {
    const list=Array.isArray(project.blueprintHistory)?project.blueprintHistory:[];
    if(!list.length)return;
    if(project.running)await pauseRunner();
    const previous=normalizeStoryBlueprint(list.pop());
    project.blueprintHistory=list;
    previous.updatedAt=Math.max(Date.now(),normalizeStoryBlueprint(project.storyBlueprint).updatedAt+1);
    project.storyBlueprint=previous;
    const active=currentBlueprintBeat();
    project.blueprintFocusId=active?.beat.id||'';
    invalidateShortPlanAfterBlueprintChange();
    await saveProject();if(uiOpen)renderUI();
  }

  function futureBeatEditorHtml() {
    const b=normalizeStoryBlueprint(project.storyBlueprint);
    const rows=blueprintBeats();
    if (!b.sections.length) return '';
    const current=currentBlueprintBeat();
    const busy=storyStudioBusy||blueprintBusy||!!modernBusy||!!(aiTask&&aiTask.active);
    const actions='<details class="m-board-utilities"><summary>전체 설계 한 번에 교체·되돌리기 <span>고급</span></summary><div class="m-board-actions">'+
      '<button id="m-board-create" class="m-outline"'+(busy||!currentTarget?' disabled':'')+'>전체 설계 다시 만들기</button>'+
      (project.blueprintHistory.length?'<button id="m-board-undo" class="m-textbtn">↶ 이전 설계로</button>':'')+'</div>'+
      '<label class="m-label" for="m-board-request">이후 흐름 즉시 수정</label><textarea rows="3" id="m-board-request" placeholder="예: 지금까지 나온 내용은 유지하고, 다음 장면부터 바꿔줘."></textarea><button id="m-board-revise" class="m-outline"'+(busy?' disabled':'')+'>이후 흐름 한 번에 수정</button></details>';
    const overview=b.sections.length?'<p class="m-muted">'+escapeHtml(b.premise||b.title||'전체 구상')+'</p>'+ (b.endDirection?'<p class="m-muted">장기 방향(변경 가능): '+escapeHtml(b.endDirection)+'</p>':'') :'<p class="m-muted">3화 제한 없이 전체 방향과 중간 사건을 먼저 구성해. 이후 언제든 바꿀 수 있어.</p>';
    const content=b.sections.map((sec,si)=>{
      const actIsCurrent=!!current && current.sec.id===sec.id;
      const actExpanded=blueprintActOpenIds.has(sec.id) || (blueprintActOpenIds.size===0 && actIsCurrent);
      const beats=sec.beats.map(beat=>{
        const focused=current&&current.beat.id===beat.id;
        const selected=blueprintEditorId===beat.id;
        const state=beat.status==='done'?'✓ 완료':beat.status==='skipped'?'↷ 건너뜀':focused?'▶ 현재':'예정';
        const edit=selected?'<div class="m-beat-editor"><label>장면 제목</label><input id="m-board-beat-title" value="'+escapeHtml(beat.title)+'" maxlength="180"><label>장면 방향 / 핵심 변화</label><textarea id="m-board-beat-description" rows="4" maxlength="2200">'+escapeHtml(beat.description)+'</textarea><div class="m-beat-buttons"><button id="m-board-save-beat" class="m-primary"'+(busy?' disabled':'')+'>장면 수정 저장</button><button id="m-board-delete-beat" class="m-outline"'+(busy?' disabled':'')+'>삭제</button><button id="m-board-move-up" class="m-outline"'+(busy?' disabled':'')+'>↑</button><button id="m-board-move-down" class="m-outline"'+(busy?' disabled':'')+'>↓</button><button id="m-board-mark-done" class="m-textbtn"'+(busy||beat.status==='done'?' disabled':'')+'>완료 표시</button><button id="m-board-focus" class="m-textbtn"'+(busy||beat.status!=='planned'?' disabled':'')+'>이 장면부터 진행</button></div>'+(beat.evidence?'<p class="m-muted">진행 확인: '+escapeHtml(beat.evidence)+'</p>':'')+'</div>':'';
        return '<div class="m-beat-row'+(focused?' focused':'')+'"><button class="m-beat-pick" data-beat-edit="'+escapeHtml(beat.id)+'"'+(busy?' disabled':'')+'><span>'+escapeHtml(state)+'</span><strong>'+escapeHtml(beat.title)+'</strong><small>'+escapeHtml(beat.description)+'</small></button>'+edit+'</div>';
      }).join('');
      return '<details class="m-arc" data-arc-details="'+escapeHtml(sec.id)+'"'+(actExpanded?' open':'')+'><summary class="m-arc-head"><strong>'+(si+1)+'. '+escapeHtml(sec.title)+'</strong><small>'+escapeHtml(sec.purpose)+'</small><span>'+sec.beats.filter(b=>b.status==='done').length+'/'+sec.beats.length+' 진행</span></summary><div class="m-arc-content">'+beats+'<button type="button" class="m-textbtn m-add-beat" data-arc-id="'+escapeHtml(sec.id)+'"'+(busy?' disabled':'')+'>＋ 이 구간에 장면 추가</button></div></details>';
    }).join('');
    return '<section class="m-blueprint" aria-label="전체 스토리라인"><div class="m-sectiontop"><h3>확정된 전체 스토리라인</h3><span>'+b.sections.length+'구간 · '+rows.length+'장면</span></div>'+overview+
      '<details class="m-board-details" id="m-board-details"'+(blueprintEditorOpen?' open':'')+'><summary>전체 흐름 보기 · 장면 클릭해서 직접 수정</summary><div class="m-board-list">'+content+'</div></details>'+actions+
      '<p class="m-muted">설계는 언제든 고칠 수 있어. 이미 생성된 채팅의 사실은 그대로 남아.</p></section>';
  }

  function findBlueprintBeat(beatId) {
    return blueprintBeats().find(row=>row.beat.id===beatId)||null;
  }

  async function editBlueprintBeat(kind, beatId, payload) {
    const next=normalizeStoryBlueprint(project.storyBlueprint);
    let sectionIndex=-1,beatIndex=-1;
    for(let i=0;i<next.sections.length;i++) {
      const j=next.sections[i].beats.findIndex(beat=>beat.id===beatId);
      if(j>=0){sectionIndex=i;beatIndex=j;break;}
    }
    if(sectionIndex<0)throw new Error('수정할 장면을 찾지 못했어.');
    const beats=next.sections[sectionIndex].beats;
    const old=beats[beatIndex];
    if(old.status==='done' && ['save','delete','up','down'].includes(kind))throw new Error('실제로 완료된 장면은 수정하지 않아. 이후 장면을 고치거나 지난 설계로 되돌려줘.');
    if(kind==='save') {
      old.title=text(payload&&payload.title).trim().slice(0,180)||old.title;
      old.description=text(payload&&payload.description).trim().slice(0,2200);
    } else if(kind==='done'){old.status='done';old.evidence='사용자가 수동으로 완료 표시';}
    else if(kind==='delete'){beats.splice(beatIndex,1);}
    else if(kind==='focus' && old.status==='planned'){project.blueprintFocusId=old.id;}
    else if(kind==='up' && beatIndex>0){[beats[beatIndex-1],beats[beatIndex]]=[beats[beatIndex],beats[beatIndex-1]];}
    else if(kind==='down' && beatIndex<beats.length-1){[beats[beatIndex+1],beats[beatIndex]]=[beats[beatIndex],beats[beatIndex+1]];}
    await commitStoryBlueprint(next,'장면 편집 완료 · 다음 생성에 반영');
    blueprintEditorId=kind==='delete'?'':beatId;
  }

  async function appendBlueprintBeat(arcId) {
    const next=normalizeStoryBlueprint(project.storyBlueprint);
    const sec=next.sections.find(s=>s.id===arcId);
    if(!sec)throw new Error('구간을 찾지 못했어.');
    const newBeat={id:uid('beat'),title:'새 장면',description:'',status:'planned',evidence:''};
    sec.beats.push(newBeat);
    await commitStoryBlueprint(next,'새 장면 추가');
    blueprintEditorId=newBeat.id;
    blueprintEditorOpen=true;
    blueprintActOpenIds.add(sec.id);
  }

  async function planStoryMap() {
    await requireTarget();
    const storySeed = project.destination.trim();
    const desiredScenes = Array.isArray(project.sceneIdeas) ? project.sceneIdeas.filter(Boolean) : [];
    if (!storySeed && !desiredScenes.length) throw new Error("보고 싶은 상황이나 장면을 하나 적어줘.");
    const horizon = Math.max(2, Math.min(4, Number(project.planningHorizon) || 3));

    planningBusy = true;
    project.planningLocked = false;
    project.lastStatus = "planning";
    project.lastReason = "AI가 가까운 전개를 설계하는 중";
    startAITask("근미래 전개 설계", ["현재 컨텍스트 읽기", "보고 싶은 장면 위치 판단", "가까운 전개 설계", "저장"]);
    if (uiOpen) renderUI();

    try {
      await ensureCharacterBootstrapBeforePlanning();
      const ctx = await readPlanningContext("근미래 롤링 설계");
      setAITaskStep(0, "done", "컨텍스트 수집 완료");
      const response = await auxiliary([
        {
          role: "system",
          content: [
            "You are the Story Runner Planning Director operating INSIDE an already-running Risu roleplay.",
            planningTaggedFormatInstructions(false),
            storyModeSystemText(),
            "This is a ROLLING-HORIZON writer-room plan, not a season outline and not an ending-first roadmap.",
            "Use USER STORY DNA as soft craft preference only when compatible with the user's current seed and canon. It may influence pacing/structure choices, but never override current explicit direction.",
            "The user gives a situation, scene, relationship beat, or direction they want to see in storySeed. Treat storySeed as a creative anchor, NOT as a mandatory final destination.",
            "desiredScenes are different: they are explicit USER MUST requirements. If they fit inside the rolling horizon, place them in MUST_BEATS. If they are clearly later than the horizon, preserve them as futureAnchors rather than silently downgrading or forgetting them.",
            "FIRST reconstruct the exact CURRENT story state from recentMessages, currentCharacter, characterWikiDocs, BardWiki, and the active Risu Lorebook.",
            "Then infer where the user's requested situation naturally belongs: immediately in the current episode, in the next episode, or as a slightly-later anchor.",
            "Do not stretch the story across many episodes just to reach the user's idea. If it is too far away, keep it as a futureAnchor and only plan the believable approach that fits the requested horizon.",
            "Plan ONLY the current episode plus the nearest future episodes. NEVER produce more episodes than planningHorizon.",
            "Keep summary and focusPlacement concise: normally 1-2 sentences each.",
            "Normally 2-3 episodes is enough. The point is to keep the future easy for the user to change.",
            "Do NOT invent a ten-episode arc, final victory, season ending, institutional takeover, or distant climax unless it is already immediately relevant in the current chat.",
            "Do NOT split into execution turns or nodes yet. Organize only by EPISODES (화).",
            "EPISODE SCALE: One episode is a substantial multi-scene dramatic arc, NOT one encounter, one conversation, a single clue, or one model response. Multiple short contacts that progress the same relationship/conflict should normally be scenes WITHIN the SAME episode.",
            "Before returning 2-4 episodes, mentally outline the distinct SCENES belonging to each episode. Normally a full episode has several connected dramatic situations and a concrete consequential change; compress dull connective time while preserving causality.",
            "SLOW RELATIONSHIP IS NOT SLOW PLOT: character attraction or trust can change slowly even while incidents, reversals, choices, and supporting-cast dynamics move briskly within one episode.",
            "Avoid a plan where Episode 1 is only a first short meal/conversation, Episode 2 is merely another chance encounter and Episode 3 is one tiny secret; these belong to a broader ongoing episode unless distinct major arcs justify separation.",
            "Each episode should be a useful near-term dramatic unit: a scene cluster, immediate consequence, relationship shift, obstacle, discovery, or transition.",
            "Separate MUST from GUIDANCE. MUST_BEATS should normally contain 0-2 truly non-negotiable user requirements or continuity facts. GUIDANCE_BEATS should contain 1-4 optional ideas that may be skipped, reordered, combined, or transformed for better pacing.",
            "Keep guidance selective. Do not exhaustively pre-write every future event.",
            "The current chat is the starting point. Continue from what already happened; never invent a fresh opening.",
            "Use canon, BardWiki, recent messages, characterWikiDocs, and the active Risu Lorebook as continuity ground truth.",
            cameoPoolInstruction(),
            "The current character card and active Risu Lorebook are authoritative world-state sources. Mutation State has already rewritten those actual sources before Story Runner reads them.",
            "WORLD-FIRST PLANNING: derive choices and events from the already-mutated world rather than adding mutation demonstrations afterward.",
            "Visible beats must be actual story events or changes, never technical rule names or mutation diagnostics.",
            "Established world customs are ordinary reality. Do not plan tutorial scenes whose only purpose is to explain that a custom exists.",
            "Preserve explicit user premises, current chat facts, and core character identity. Do not silently invent unsupported relationships, jobs, institutions, ownership, or history.",
            "If the user's idea is already partly underway, continue it rather than restarting it.",
            "If the user's idea sounds like an opening fragment, naturally add what comes immediately after it. If it sounds like a later event, plan only enough lead-in to keep it reachable without locking the distant future.",
            "The user should be able to revise the plan after every episode, so leave later possibilities open.",
            "Before producing episodes, verify internally: current protagonist role/status, current location/time if known, existing relationships, what has already happened, and the ordinary world rules encoded in Lorebook.",
            "Write all user-visible values in Korean.",
          ].join("\n"),
        },
        {
          role: "user",
          content: JSON.stringify({
            storySeed,
            storyMode: storyModeLabel(),
            planningHorizon: horizon,
            constraints: project.constraints,
            forbidden: project.forbidden,
            desiredScenes,
            bardWiki: ctx.wikiContent,
            currentCharacter: ctx.currentCharacter,
            characterWikiDocs: ctx.characterWikiDocs,
            cameoPool: ctx.cameoPool,
            recentMessages: ctx.recentMessages,
            activeLoreAndModuleRules: ctx.lore,
            currentEpisodeOverride: project.currentEpisodeOverride || "",
            storyDNA: storyDnaPromptText("writer"),
          }),
        },
      ]);

      setAITaskStep(1, "done", "AI 응답 수신");
      const parsed = await parsePlanningStructured(response, "근미래 전개 설계");
      const episodes = (Array.isArray(parsed.episodes) ? parsed.episodes : []).slice(0, horizon);
      if (!episodes.length) throw new Error("전개 AI가 가까운 화별 흐름을 만들지 않았습니다.");
      setAITaskStep(2, "done", "근미래 설계 " + episodes.length + "화");

      project.planningOutline = {
        summary: text(parsed.summary),
        focusPlacement: text(parsed.focusPlacement),
        futureAnchors: stringList(parsed.futureAnchors).slice(0, 5),
        currentEpisode: parsed.currentEpisode && typeof parsed.currentEpisode === "object" ? {
          number: text(parsed.currentEpisode.number),
          title: text(parsed.currentEpisode.title),
          status: text(parsed.currentEpisode.status),
          confidence: text(parsed.currentEpisode.confidence),
          reason: text(parsed.currentEpisode.reason),
          progress: text(parsed.currentEpisode.progress),
        } : null,
        currentState: parsed.currentState && typeof parsed.currentState === "object" ? {
          role: text(parsed.currentState.role),
          location: text(parsed.currentState.location),
          relationships: stringList(parsed.currentState.relationships),
          activeMutationRules: stringList(parsed.currentState.activeMutationRules),
          alreadyEstablished: stringList(parsed.currentState.alreadyEstablished),
        } : null,
        episodes: episodes.map((ep, index) => ({
          id: text(ep && ep.id) || uid("episode"),
          number: text(ep && ep.number) || ((index + 1) + "화"),
          title: text(ep && ep.title) || "에피소드 " + (index + 1),
          status: text(ep && ep.status) || "예정",
          purpose: text(ep && ep.purpose),
          startCondition: text(ep && ep.startCondition),
          mustBeats: stringList(ep && ep.mustBeats).slice(0, 3),
          guideBeats: (stringList(ep && ep.guideBeats).length ? stringList(ep && ep.guideBeats) : stringList(ep && ep.beats)).slice(0, 5),
          beats: (stringList(ep && ep.guideBeats).length ? stringList(ep && ep.guideBeats) : stringList(ep && ep.beats)).slice(0, 5),
          endCondition: text(ep && ep.endCondition),
          transition: text(ep && ep.transition),
        })),
        details: stringList(parsed.details).slice(0, 4),
        risks: stringList(parsed.risks).slice(0, 4),
        endingCondition: "",
        updatedAt: Date.now(),
      };

      project.planningLocked = false;
      project.nodes = [];
      project.currentNodeId = null;
      project.completedNodeIds = [];
      project.planningChat.push({
        role: "assistant",
        content: project.planningOutline.summary || "보고 싶은 장면을 중심으로 가까운 전개만 잡았어. 필요하면 여기서 조금씩 바꾸거나 뒤를 더 만들면 돼.",
      });
      project.planningChat = project.planningChat.slice(-24);
      project.lastStatus = "idle";
      project.lastReason = "근미래 전개 설계 완료";
      await saveProject();
      setAITaskStep(3, "done", "저장 완료");
      finishAITask(true, "근미래 전개 설계 완료");
      if (uiOpen) renderUI();
      return project.planningOutline;
    } catch (error) {
      finishAITask(false, error && error.message ? error.message : String(error));
      throw error;
    } finally {
      planningBusy = false;
    }
  }

  async function extendRollingPlan() {
    await requireTarget();
    if (!project.planningOutline || !Array.isArray(project.planningOutline.episodes) || !project.planningOutline.episodes.length) {
      throw new Error("먼저 가까운 전개를 만들어줘.");
    }
    const horizon = Math.max(2, Math.min(4, Number(project.planningHorizon) || 3));
    planningBusy = true;
    project.planningLocked = false;
    project.lastStatus = "planning";
    project.lastReason = "뒤쪽 미래를 조금 더 설계하는 중";
    startAITask("미래 범위 채우기", ["현재 설계 확인", "최근 진행 읽기", "뒤쪽 전개 추가", "저장"]);
    if (uiOpen) renderUI();
    try {
      await ensureCharacterBootstrapBeforePlanning();
      const ctx = await readPlanningContext(JSON.stringify(project.planningOutline));
      setAITaskStep(0, "done", "현재 설계 확인");
      const response = await auxiliary([
        {
          role: "system",
          content: [
            "You extend a short rolling-horizon episode plan for an already-running roleplay.",
            planningTaggedFormatInstructions(true),
            storyModeSystemText(),
            "Do NOT create a full-series roadmap.",
            "Keep the visible plan to at most planningHorizon episodes beginning from the current unfinished episode.",
            "Drop completed past episodes from the returned window. Preserve unfinished existing episodes unless recent chat has already overtaken them.",
            "Add only enough new future material to refill the short window.",
            "The new future should remain flexible: concrete enough to inspire the next few episodes, but do not lock distant outcomes, final rankings, final relationships, or season endings.",
            "Use current chat, active Lorebook, current character card, and BardWiki continuity as ground truth.",
            cameoPoolInstruction(),
            "If the user's original storySeed is a farther future anchor, move toward it only as fast as is natural; keep it in futureAnchors if it still lies beyond the short window.",
            "Keep MUST_BEATS sparse and truly mandatory; explicit user MUST requirements remain hard unless the user removes them. Put ordinary scene ideas in GUIDANCE_BEATS. Keep guidance selective, normally 1-4 items per episode.",
            "Write all user-visible values in Korean.",
          ].join("\n"),
        },
        {
          role: "user",
          content: JSON.stringify({
            storySeed: project.destination,
            storyMode: storyModeLabel(),
            planningHorizon: horizon,
            currentOutline: project.planningOutline,
            recentMessages: ctx.recentMessages,
            bardWiki: ctx.wikiContent,
            currentCharacter: ctx.currentCharacter,
            characterWikiDocs: ctx.characterWikiDocs,
            cameoPool: ctx.cameoPool,
            activeLoreAndModuleRules: ctx.lore,
          }),
        },
      ]);
      setAITaskStep(1, "done", "최근 진행 반영");
      const parsed = await parsePlanningStructured(response, "미래 범위 채우기");
      const episodes = (Array.isArray(parsed.episodes) ? parsed.episodes : []).slice(0, horizon);
      if (!episodes.length) throw new Error("추가할 근미래 전개를 만들지 못했습니다.");
      project.planningOutline = {
        summary: text(parsed.summary) || text(project.planningOutline.summary),
        focusPlacement: text(parsed.focusPlacement) || text(project.planningOutline.focusPlacement),
        futureAnchors: stringList(parsed.futureAnchors).slice(0, 5),
        currentEpisode: parsed.currentEpisode && typeof parsed.currentEpisode === "object" ? {
          number: text(parsed.currentEpisode.number), title: text(parsed.currentEpisode.title), status: text(parsed.currentEpisode.status),
          confidence: text(parsed.currentEpisode.confidence), reason: text(parsed.currentEpisode.reason), progress: text(parsed.currentEpisode.progress),
        } : project.planningOutline.currentEpisode,
        currentState: parsed.currentState && typeof parsed.currentState === "object" ? {
          role: text(parsed.currentState.role), location: text(parsed.currentState.location), relationships: stringList(parsed.currentState.relationships),
          activeMutationRules: stringList(parsed.currentState.activeMutationRules), alreadyEstablished: stringList(parsed.currentState.alreadyEstablished),
        } : project.planningOutline.currentState,
        episodes: episodes.map((ep, index) => ({
          id: text(ep && ep.id) || uid("episode"), number: text(ep && ep.number) || ((index + 1) + "화"),
          title: text(ep && ep.title) || "에피소드 " + (index + 1), status: text(ep && ep.status) || "예정",
          purpose: text(ep && ep.purpose), startCondition: text(ep && ep.startCondition),
          mustBeats: stringList(ep && ep.mustBeats).slice(0, 3),
          guideBeats: (stringList(ep && ep.guideBeats).length ? stringList(ep && ep.guideBeats) : stringList(ep && ep.beats)).slice(0, 5),
          beats: (stringList(ep && ep.guideBeats).length ? stringList(ep && ep.guideBeats) : stringList(ep && ep.beats)).slice(0, 5),
          endCondition: text(ep && ep.endCondition), transition: text(ep && ep.transition),
        })),
        details: stringList(parsed.details).slice(0, 4), risks: stringList(parsed.risks).slice(0, 4), endingCondition: "", updatedAt: Date.now(),
      };
      project.planningLocked = false;
      project.nodes = [];
      project.currentNodeId = null;
      project.completedNodeIds = [];
      const reply = text(parsed.reply) || "현재 시점부터 보이는 미래 범위를 다시 채웠어.";
      project.planningChat.push({ role: "assistant", content: reply });
      project.planningChat = project.planningChat.slice(-24);
      project.lastStatus = "idle";
      project.lastReason = "근미래 범위 갱신 완료";
      await saveProject();
      setAITaskStep(2, "done", "근미래 " + episodes.length + "화");
      setAITaskStep(3, "done", "저장 완료");
      finishAITask(true, "미래 범위 갱신 완료");
      if (uiOpen) renderUI();
    } catch (error) {
      finishAITask(false, error && error.message ? error.message : String(error));
      throw error;
    } finally {
      planningBusy = false;
    }
  }

  async function finalizeStoryMap() {
    await requireTarget();
    if (!project.planningOutline || !Array.isArray(project.planningOutline.episodes) || !project.planningOutline.episodes.length) {
      throw new Error("먼저 전개 설계 초안을 만들어 주세요.");
    }

    planningBusy = true;
    project.planningLocked = false;
    project.lastStatus = "planning";
    project.lastReason = "확정된 설계안을 실행 큐로 변환하는 중";
    startAITask("실행 큐 생성", [
      "확정 설계안 확인",
      "캐릭터·BardWiki·침식 로어북 읽기",
      "AI 실행 Node 생성",
      "실행 큐 검증",
      "Story Map 저장",
    ]);
    setAITaskStep(0, "done", "설계안 " + project.planningOutline.episodes.length + "화");
    if (uiOpen) renderUI();

    try {
      await ensureCharacterBootstrapBeforePlanning();
      const ctx = await readPlanningContext(JSON.stringify(project.planningOutline));
      setAITaskStep(1, "done", "컨텍스트 수집 완료");
      const response = await auxiliary([
        {
          role: "system",
          content: [
            "You convert an approved episode-based story outline into detailed Story Runner execution guidance grouped by episode.",
            "Return JSON only.",
            storyModeSystemText(),
            "Do not redesign the story. Preserve the approved episode order and episode boundaries.",
            "Split only where execution control actually benefits. Do not create one node per tiny beat.",
            "Balance Node narrative weight. Do not place one lightweight introduction beside one enormous required Node containing several distinct dramatic turns.",
            "If a required Node contains multiple independent escalations, state transitions, major character reactions, or separate dramatic set pieces, split it into 2-3 coherent Nodes.",
            "Normally use 2-6 execution nodes per episode depending on dramatic density. Keep every node attached to exactly one episode.",
            "Controls: free, guide, required, directed, locked, target, stop.",
            "The final node must be target or stop.",
            "Only MUST_BEATS may become required/locked Nodes or completion criteria. GUIDANCE_BEATS are advisory and must use guide/free controls or be omitted entirely.",
            "Do not make the soft episode end condition a hard completion gate by itself.",
            "Completion criteria must be observable in the generated story, not abstract.",
            "Use the active Risu Lorebook as the established world baseline when choosing execution-node boundaries; preserve current states and consequences already encoded there.",
            cameoPoolInstruction(),
            "Write all user-visible values in Korean.",
            "Schema: {\"nodes\":[{\"episodeNumber\":string,\"episodeTitle\":string,\"title\":string,\"control\":string,\"instruction\":string,\"completionCriteria\":string[]}]}",
          ].join("\n"),
        },
        {
          role: "user",
          content: JSON.stringify({
            destination: project.destination,
            storyMode: storyModeLabel(),
            approvedOutline: project.planningOutline,
            currentCharacter: ctx.currentCharacter,
            characterWikiDocs: ctx.characterWikiDocs,
            cameoPool: ctx.cameoPool,
            activeLoreAndModuleRules: ctx.lore,
            constraints: project.constraints,
            forbidden: project.forbidden,
            currentEpisodeOverride: project.currentEpisodeOverride || "",
          }),
        },
      ]);
      setAITaskStep(2, "done", "AI 응답 수신");

      const parsed = extractJson(response);
      const rawNodes = Array.isArray(parsed.nodes) ? parsed.nodes : [];
      if (!rawNodes.length) throw new Error("실행 큐를 만들지 못했습니다.");

      project.nodes = rawNodes.map((node, index) => normalizeNode(Object.assign({}, node, { id: uid("node") }), index));
      const finalNode = project.nodes[project.nodes.length - 1];
      if (finalNode && !["stop", "target"].includes(finalNode.control)) finalNode.control = "stop";
      setAITaskStep(3, "done", "Node " + project.nodes.length + "개");

      project.completedNodeIds = [];
      project.currentNodeId = project.nodes[0] ? project.nodes[0].id : null;
      project.planningLocked = true;
      project.generationNonce = uid("gen");
      project.lastStatus = "idle";
      project.lastReason = "전개 확정 · 실행 큐 생성 완료";
      await saveProject();
      setAITaskStep(4, "done", "저장 완료");
      finishAITask(true, "실행 큐 " + project.nodes.length + "개 생성 완료");
      uiTab = "run";
      if (uiOpen) renderUI();
    } catch (error) {
      project.lastStatus = "failed";
      project.lastReason = "실행 큐 생성 실패";
      finishAITask(false, error && error.message ? error.message : String(error));
      throw error;
    } finally {
      planningBusy = false;
    }
  }


  async function reviseStoryMap(instruction) {
    await requireTarget();
    instruction = text(instruction).trim();
    if (!instruction) return;
    if (!project.planningOutline) throw new Error("먼저 설계 초안을 만들어 주세요.");

    planningChatBusy = true;
    project.lastStatus = "planning";
    project.lastReason = "전개 설계실에서 수정 중";
    startAITask("설계안 수정", ["현재 설계·컨텍스트 읽기", "AI 수정안 생성", "설계안 검증", "저장"]);
    project.planningChat.push({ role: "user", content: instruction });
    project.planningChat = project.planningChat.slice(-24);
    await saveProject();
    if (uiOpen) renderUI();

    try {
      await ensureCharacterBootstrapBeforePlanning();
      const ctx = await readPlanningContext(JSON.stringify(project.planningOutline));
      setAITaskStep(0, "done", "컨텍스트 수집 완료");
      const response = await auxiliary([
        {
          role: "system",
          content: [
            "You are editing an existing SHORT rolling-horizon story outline through conversation.",
            planningTaggedFormatInstructions(true),
            storyModeSystemText(),
            "Do NOT convert it into execution nodes yet. Keep the outline organized by episodes (화).",
            "Keep the plan short. Normally preserve the current rolling window and NEVER expand beyond planningHorizon unless the user explicitly asks to change the horizon.",
            "Keep the summary concise and leave distant outcomes open.",
            "The user may ask to move, insert, delete, or deepen one desired situation. Change only the nearby future needed for that request rather than redesigning a distant season arc.",
            "Treat the original storySeed as a creative anchor, not a mandatory final destination.",
            "Preserve parts the user did not ask to change.",
            "Re-check recentMessages, currentCharacter, characterWikiDocs, BardWiki, and the active Risu Lorebook before revising.",
            cameoPoolInstruction(),
            "The current chat remains the starting point. Do not redesign or restart the premise.",
            "Revise the episode-by-episode big flow, causal transitions, and detail level according to the request. Re-evaluate which episode the current chat is in.",
            "Classify explicit non-negotiable user requirements as MUST_BEATS and preserve previously established MUST items unless the user explicitly removes or changes them. Treat ordinary ideas, attractive possibilities, and AI-added details as GUIDANCE_BEATS. Never turn guidance into a hidden completion gate.",
            "Avoid over-segmentation.",
            "Do not silently change canon, identities, relationships, jobs, organizations, ownership, or already-established facts.",
            "Never treat character quirks, social problems, school hierarchy, violence, passivity, secrets, or personality traits as mutation rules unless an explicit mutation source says so.",
            "Story Runner must not maintain a separate default mutation canon. Normal Mutation settings are already written into the actual character card and Lorebook; only an explicit temporary Pack Override may be supplied as a one-run runtime addendum.",
            "Treat active mutation Packs as the causal foundation of the setting, not as optional beats to sprinkle into an ordinary-world outline.",
            "If the existing outline was built on ordinary-world assumptions that conflict with an active Pack, rewrite as much of the outline as necessary. Preserve explicit user premises and established canon facts, but do not preserve incompatible causal structure just for continuity with the old outline.",
            "If MALE_DOMINANCE is active, audit every episode for whether the social hierarchy actually changes choices, authority, dependency, incentives, institutional reactions, relationship formation, and conflict. If it does not, redesign that episode rather than adding one token male-dominance scene.",
            "If COMMON_SENSE is active, treat its physical/social customs as normal world physics and daily infrastructure; integrate them into how events work instead of adding showcase bullet points.",
            "When multiple Packs are active, first synthesize one coherent world, then write the story that naturally follows from it.",
            "Visible beats must describe actual story events and consequences, not rule names, rule IDs, or mutation-application tasks unless the user explicitly requests technical diagnostics.",
            "If the active Lorebook contains the mutated world, never claim the world rewrite is unspecified.",
            "If current context establishes the protagonist's role/status, never call it unspecified.",
            "Preserve characterWikiDocs and active Lorebook continuity unless the user explicitly asks the plan to develop those facts through story events.",
            "Preserve the actual current state established by the active Lorebook and recent chat unless the requested revision explicitly changes it.",
            "Respect the mutated Lorebook world when it affects the revised causal flow.",
            "Write all user-visible values in Korean.",
          ].join("\n"),
        },
        {
          role: "user",
          content: JSON.stringify({
            storySeed: project.destination,
            storyMode: storyModeLabel(),
            planningHorizon: Math.max(2, Math.min(4, Number(project.planningHorizon) || 3)),
            editRequest: instruction,
            currentOutline: project.planningOutline,
            recentPlanningConversation: project.planningChat.slice(-10),
            bardWiki: ctx.wikiContent,
            currentCharacter: ctx.currentCharacter,
            characterWikiDocs: ctx.characterWikiDocs,
            cameoPool: ctx.cameoPool,
            recentMessages: ctx.recentMessages,
            activeLoreAndModuleRules: ctx.lore,
            currentEpisodeOverride: project.currentEpisodeOverride || "",
          }),
        },
      ]);

      setAITaskStep(1, "done", "AI 응답 수신");
      const parsed = await parsePlanningStructured(response, "설계안 수정");
      const horizon = Math.max(2, Math.min(4, Number(project.planningHorizon) || 3));
      const episodes = (Array.isArray(parsed.episodes) ? parsed.episodes : []).slice(0, horizon);
      if (!episodes.length) throw new Error("수정된 화별 설계안이 비어 있습니다.");
      setAITaskStep(2, "done", "수정 설계 " + episodes.length + "화");

      project.planningOutline = {
        summary: text(parsed.summary),
        focusPlacement: text(parsed.focusPlacement) || text(project.planningOutline && project.planningOutline.focusPlacement),
        futureAnchors: stringList(parsed.futureAnchors).slice(0, 5),
        currentEpisode: parsed.currentEpisode && typeof parsed.currentEpisode === "object" ? {
          number: text(parsed.currentEpisode.number),
          title: text(parsed.currentEpisode.title),
          status: text(parsed.currentEpisode.status),
          confidence: text(parsed.currentEpisode.confidence),
          reason: text(parsed.currentEpisode.reason),
          progress: text(parsed.currentEpisode.progress),
        } : (project.planningOutline && project.planningOutline.currentEpisode ? project.planningOutline.currentEpisode : null),
        currentState: parsed.currentState && typeof parsed.currentState === "object" ? {
          role: text(parsed.currentState.role),
          location: text(parsed.currentState.location),
          relationships: stringList(parsed.currentState.relationships),
          activeMutationRules: stringList(parsed.currentState.activeMutationRules),
          alreadyEstablished: stringList(parsed.currentState.alreadyEstablished),
        } : (project.planningOutline && project.planningOutline.currentState ? project.planningOutline.currentState : null),
        episodes: episodes.map((ep, index) => ({
          id: uid("episode"),
          number: text(ep && ep.number) || ((index + 1) + "화"),
          title: text(ep && ep.title) || "에피소드 " + (index + 1),
          status: text(ep && ep.status) || "예정",
          purpose: text(ep && ep.purpose),
          startCondition: text(ep && ep.startCondition),
          mustBeats: stringList(ep && ep.mustBeats).slice(0, 3),
          guideBeats: (stringList(ep && ep.guideBeats).length ? stringList(ep && ep.guideBeats) : stringList(ep && ep.beats)).slice(0, 5),
          beats: (stringList(ep && ep.guideBeats).length ? stringList(ep && ep.guideBeats) : stringList(ep && ep.beats)).slice(0, 5),
          endCondition: text(ep && ep.endCondition),
          transition: text(ep && ep.transition),
        })),
        details: stringList(parsed.details),
        risks: stringList(parsed.risks),
        endingCondition: "",
        updatedAt: Date.now(),
      };

      project.planningLocked = false;
      project.nodes = [];
      project.currentNodeId = null;
      project.completedNodeIds = [];

      const reply = text(parsed.reply) || "요청한 방향으로 가까운 전개를 수정했어.";
      project.planningChat.push({ role: "assistant", content: reply });
      project.planningChat = project.planningChat.slice(-24);
      project.lastStatus = "idle";
      project.lastReason = reply;
      project.generationNonce = uid("gen");
      await saveProject();
      setAITaskStep(3, "done", "저장 완료");
      finishAITask(true, "설계안 수정 완료");
      if (uiOpen) renderUI();
    } catch (error) {
      finishAITask(false, error && error.message ? error.message : String(error));
      project.planningChat.push({
        role: "assistant",
        content: "수정 실패: " + (error && error.message ? error.message : String(error)),
      });
      project.planningChat = project.planningChat.slice(-24);
      project.lastStatus = "failed";
      project.lastReason = "전개 수정 실패";
      await saveProject();
      throw error;
    } finally {
      planningChatBusy = false;
      if (uiOpen) renderUI();
    }
  }


  async function analyzeAcceptedOutput(content, node) {
    if (!node) return { complete: false, reason: "현재 장면 없음", characterUpdates: [] };

    try {
      await loadBardWikiDocuments();
      const currentCharacter = await readCurrentCharacterSnapshot();
      let activeLore = [];
      try {
        const entries = await risuai.getCurrentLorebookEntries();
        activeLore = Array.isArray(entries) ? entries.slice(0, 100).map((entry) => ({
          key: entry && (entry.key || entry.keys || entry.name) || "",
          comment: entry && (entry.comment || entry.title) || "",
          content: text(entry && (entry.content || entry.text)).slice(0, 2200),
        })) : [];
      } catch (_) {}

      const response = await auxiliary([
        {
          role: "system",
          content: [
            "Analyze one ACCEPTED Story Runner assistant output.",
            "Return JSON only.",
            "Task 1: decide whether the current Story Runner scene node is materially complete and whether the accepted output appears cut off mid-response.",
            "If the output is truncated/cut off, complete MUST be false regardless of how many planned events already occurred.",
            "Do NOT mark a scene complete merely because its required event technically occurred.",
            "For important first meetings, relationship changes, mutation reveals, escalating tension, or irreversible developments, require sufficient interaction, reaction, consequence, and a natural transition point.",
            "If the response feels like it only checked required beats and moved on, complete must be false.",
            "Task 2: identify DURABLE character-state changes that actually happened in this accepted output and should matter in future turns.",
            "Do not record merely planned future developments.",
            "Do not record transient sentence-level emotions unless they establish a continuing state.",
            "Do not invent facts not present in the accepted output.",
            "Preserve existing character document facts unless the output clearly changes them.",
            "The character card and active Risu Lorebook are the BASE canon. BardWiki is only a durable EVOLUTION overlay created by actual RP events.",
            "Do NOT copy unchanged baseline profile/lore facts into a new BardWiki document just to initialize it.",
            "For each character update, return the COMPLETE revised BardWiki EVOLUTION document, not a patch.",
            "If no durable character change occurred, characterUpdates must be an empty array and nothing should be written.",
            "Prefer updating an existing document by documentId. Create a new document only after the story establishes a durable new state for that character.",
            "Write maintained character documents in clear Korean.",
            "Schema: {\"complete\":boolean,\"truncated\":boolean,\"reason\":string,\"characterUpdates\":[{\"documentId\":string|null,\"title\":string,\"aliases\":string[],\"markdown\":string,\"reason\":string,\"evidence\":string}]}",
          ].join("\n"),
        },
        {
          role: "user",
          content: JSON.stringify({
            destination: project.destination,
            node,
            currentCharacter,
            activeLore,
            existingCharacterDocs: compactWikiDocs(characterDocs, 40, 9000),
            acceptedAssistantResponse: content.slice(-18000),
          }),
        },
      ], 150000);

      const parsed = extractJson(response);
      return {
        complete: parsed.complete === true && parsed.truncated !== true,
        truncated: parsed.truncated === true,
        reason: text(parsed.reason),
        characterUpdates: Array.isArray(parsed.characterUpdates)
          ? parsed.characterUpdates.filter((u) =>
              u && typeof u.title === "string" && typeof u.markdown === "string" && u.markdown.trim()
              && text(u.evidence).trim().length >= 6 && content.includes(text(u.evidence).trim())
            )
          : [],
      };
    } catch (error) {
      return {
        complete: content.includes(COMPLETE_MARKER),
        truncated: !content.includes(COMPLETE_MARKER) && likelyTruncatedStory(content),
        reason: "진행/캐릭터 분석 실패: " + (error && error.message ? error.message : String(error)),
        characterUpdates: [],
      };
    }
  }

  async function applyCharacterUpdates(updates) {
    if (!Array.isArray(updates) || !updates.length) {
      characterSyncStatus = "변화 없음";
      lastCharacterSyncAt = Date.now();
      return { saved: 0, failed: 0 };
    }

    characterSyncStatus = "갱신 중";
    if (uiOpen) renderUI();

    await loadBardWikiDocuments();

    let savedCount = 0;
    let failedCount = 0;

    for (const update of updates) {
      try {
        const requestedId = text(update.documentId);
        let old = requestedId
          ? characterDocs.find((doc) => doc.id === requestedId)
          : null;

        if (!old) {
          const titleLower = text(update.title).trim().toLowerCase();
          old = characterDocs.find((doc) => {
            if (text(doc.title).trim().toLowerCase() === titleLower) return true;
            return Array.isArray(doc.aliases) && doc.aliases.some((a) => text(a).trim().toLowerCase() === titleLower);
          }) || null;
        }

        const saved = await risuai.bardWiki.saveDocument({
          documentId: old ? old.id : undefined,
          type: "character",
          title: text(update.title).trim(),
          aliases: Array.isArray(update.aliases)
            ? update.aliases.filter((x) => typeof x === "string" && x.trim())
            : [text(update.title).trim()],
          markdown: text(update.markdown).trim(),
          expectedContentHash: old ? old.contentHash : undefined,
        });

        if (!saved) {
          failedCount++;
          continue;
        }

        savedCount++;

        try {
          await risuai.bardWiki.setContextMode({
            documentId: saved.id,
            contextMode: "always",
            expectedContentHash: saved.contentHash,
          });
        } catch (error) {
          console.log("[StoryRunner] character auto contextMode skipped", saved.title, error);
        }
      } catch (error) {
        failedCount++;
        console.log("[StoryRunner] automatic character update failed", update && update.title, error);
      }
    }

    await loadBardWikiDocuments();
    characterSyncStatus = "완료 " + savedCount + " · 실패 " + failedCount;
    lastCharacterSyncAt = Date.now();

    if (uiOpen) renderUI();
    return { saved: savedCount, failed: failedCount };
  }


  function activeLoreText(lore, maxChars) {
    const rows = Array.isArray(lore) ? lore : [];
    const limit = maxChars || 24000;
    const parts = [];
    let chars = 0;
    for (const entry of rows) {
      const title = text(entry && (entry.comment || entry.key)).trim() || "Lore";
      const body = text(entry && entry.content).trim();
      if (!body) continue;
      const block = "### " + title + "\n" + body;
      if (chars + block.length > limit && parts.length) break;
      parts.push(block);
      chars += block.length;
    }
    return parts.join("\n\n");
  }

  function liveCanonContextText(ctx) {
    const parts = [];
    if (ctx && ctx.currentCharacter) {
      parts.push("# CURRENT CHARACTER CARD\n" + JSON.stringify(ctx.currentCharacter, null, 2));
    }
    const loreText = activeLoreText((ctx && ctx.lore) || [], 26000);
    if (loreText) parts.push("# ACTIVE RISU LOREBOOK\n" + loreText);
    if (ctx && text(ctx.wikiContent).trim()) {
      parts.push("# BARDWIKI CONTINUITY\n" + text(ctx.wikiContent).slice(0, 18000));
    }
    if (ctx && Array.isArray(ctx.characterWikiDocs) && ctx.characterWikiDocs.length) {
      const docs = ctx.characterWikiDocs.slice(0, 20).map((doc) =>
        "### " + text(doc.title || "Character") + "\n" + text(doc.content).slice(0, 4500)
      ).join("\n\n");
      if (docs) parts.push("# BARDWIKI CHARACTER EVOLUTION\n" + docs);
    }
    if (ctx && Array.isArray(ctx.cameoPool) && ctx.cameoPool.length) {
      const cameos = ctx.cameoPool.slice(0, 8).map((entry) =>
        "### " + text(entry.name || "Cameo") + "\n" + text(entry.lore).slice(0, 2600)
      ).join("\n\n");
      if (cameos) parts.push(cameoPoolInstruction() + "\n\n" + cameos);
    }
    const overrideText = temporaryMutationOverrideText(ctx && ctx.mutationContext);
    if (overrideText) parts.push(overrideText);
    return parts.join("\n\n");
  }

  function buildRunnerPrompt(node, ctx, pacingMode, userText) {
    const done = new Set(project.completedNodeIds);
    const progress = project.nodes.map((item, index) => {
      const marker = done.has(item.id) ? "DONE" : item.id === (node && node.id) ? "CURRENT" : "PENDING";
      return (index + 1) + ". [" + marker + "] " + item.title + " — " + item.instruction;
    }).join("\n");

    const parts = [
      "# STORY RUNNER RUNTIME",
      "This is hidden execution guidance. Never quote, summarize, or explain it in the visible story.",
      "Host system/safety instructions and active mutation/runtime rules remain higher priority.",
      "PERSISTENT CAST CONTINUITY: preserve established recurring cast and assigned roles from the latest accepted story and current canon. Reuse the same names/relationships, do not silently replace or newly assign already occupied roles, and do not require repeated on-screen role demonstrations when irrelevant to the current beat.",
      storyModeSystemText(),
      writerQualitySystemText(),
      "",
      "## Destination",
      project.destination || "(none)",
      "",
      blueprintExecutionFocus(),
      "",
      "## Current node",
      node ? JSON.stringify({
        title: node.title,
        control: node.control,
        instruction: node.instruction,
        completionCriteria: node.completionCriteria,
      }) : "(none)",
      "",
      "## Story Map progress",
      progress || "(empty)",
    ];

    if (project.constraints.length) parts.push("", "## Constraints", project.constraints.map((x) => "- " + x).join("\n"));
    if (project.forbidden.length) parts.push("", "## Forbidden developments", project.forbidden.map((x) => "- " + x).join("\n"));
    const dnaRuntime = storyDnaPromptText("writer");
    if (dnaRuntime) parts.push("", dnaRuntime);

    if (project.sceneIdeas.length) parts.push("", "## Desired scene ideas", project.sceneIdeas.map((x) => "- " + x).join("\n"));

    parts.push(
      "",
      "## Execution",
      "- Continue from the actual current chat state. Do not restart or recap.",
      "- Use current canon and active runtime/mutation rules naturally.",
      "- Treat the current Node as a full dramatic scene, not a checklist.",
      "- required/locked completion criteria are hard requirements; guide/free details are recommendations and may be skipped or transformed for better prose.",
      "- Do not rush merely because completion criteria can be technically satisfied.",
      "- Important first meetings, relationship shifts, first-time mutation triggers, emotional friction, and reversals need enough dialogue, reaction, consequence, and aftermath for the reader to feel the change.",
      "- Prefer sustained interaction and cause-and-effect over compressed summary.",
      "- Advance causally: cause -> motivation -> action -> result.",
      "- Do not repeat a dramatic function already completed in the previous response.",
      "- Do not add arbitrary time skips, meetings, family members, jobs, organizations, or relationship milestones just to fill length.",
      "- A required event happening is not by itself enough to end the scene.",
      "- A completed Node/scene is NOT a completed episode; keep progressing through the scene cluster within its episode.",
      "- When one short interaction is over, start the next causally connected scene of the same episode instead of declaring the episode over.",
      "- If the response budget ends before the scene naturally closes, remain in the same Node/episode; never jump forward just because the output is ending.",
      "- When and only when HARD completion criteria have genuinely been satisfied AND the scene has reached a natural dramatic transition point, append " + COMPLETE_MARKER + " at the very end.",
      "- The completion marker is internal. Do not mention it in prose."
    );

    const pacingBlock = interactivePacingText(pacingMode, userText);
    if (pacingBlock) parts.push("", pacingBlock);


    if (ctx && Array.isArray(ctx.lore) && ctx.lore.length) {
      parts.push(
        "",
        "## Active Risu Lorebook",
        "This is the already-established current world canon. Mutation State may have directly rewritten these entries; do not reconstruct a separate default mutation canon or revert to pre-mutation assumptions.",
        activeLoreText(ctx.lore, 26000)
      );
    }


    if (ctx && ctx.wikiContent) parts.push("", "## Canon context", ctx.wikiContent.slice(0, 12000));

    if (ctx && Array.isArray(ctx.characterWikiDocs) && ctx.characterWikiDocs.length) {
      const characterContext = ctx.characterWikiDocs.slice(0, 20).map((doc) =>
        "### " + doc.title + "\n" + text(doc.content).slice(0, 4500)
      ).join("\n\n");
      parts.push(
        "",
        "## Living character state",
        "These BardWiki character documents describe durable story-evolved character state. Respect them as continuity.",
        characterContext
      );
    }

    if (ctx && Array.isArray(ctx.cameoPool) && ctx.cameoPool.length) {
      const cameoContext = ctx.cameoPool.slice(0, 8).map((entry) =>
        "### " + text(entry.name || "Cameo") + "\n" + text(entry.lore).slice(0, 2600)
      ).join("\n\n");
      parts.push("", "## Optional cameo character lore", cameoPoolInstruction(), cameoContext);
    }

    const temporaryOverride = temporaryMutationOverrideText(ctx && ctx.mutationContext);
    if (temporaryOverride) parts.push("", temporaryOverride);

    return parts.join("\n");
  }

  // v0.95.3: The ordinary Risu pipeline ALREADY injects card/lore/preset.
  // Story Runner must not add another 100k+ character copy of that context.
  function boundedHostWriterGuidance(node, pacingMode, userText) {
    const remembered=normalizeStoryNotebook(project.storyNotebook);
    return [
      '# STORY RUNNER — CURRENT SCENE ONLY (Risu card and Lorebook are already present)',
      'Continue from the latest ACTUALLY ACCEPTED chat text. This outline is a flexible scene direction, not an event that already happened.',
      'Never replay a finished event. Do not finish a whole episode merely because one conversation ends.',
      'Write idiomatic, readable Korean prose; do not include planning, criticism, or summaries.',
      node ? 'CURRENT SCENE: '+text(node.title).slice(0,180)+' — '+text(node.instruction).slice(0,1250) : '',
      node && Array.isArray(node.completionCriteria) && node.completionCriteria.length ?
        'CONDITION TO ADVANCE (only when actually achieved): '+node.completionCriteria.slice(0,4).map(x=>text(x).slice(0,170)).join(' / ') : '',
      text(project.destination) ? 'USER STORY DIRECTION: '+text(project.destination).slice(0,1100) : '',
      remembered.version===2 && remembered.confidence==='checked' ?
        'LATEST VERIFIED STORY: '+text(remembered.lastEvent||remembered.scene).slice(0,500) : '',
      userText ? 'LATEST USER CHOICE: '+text(userText).slice(-800) : '',
      pacingMode && pacingMode!=='off' ? interactivePacingText(pacingMode,userText).slice(0,1100) : '',
      'If the current scene is truly resolved, append '+COMPLETE_MARKER+' once at the end. Never print the marker in the visible story.',
    ].filter(Boolean).join('\n\n').slice(0,5900);
  }

  // Direct plug-in generation cannot rely on the Risu host assembling its usual
  // prompt. Supply ONE short, ordered canon snapshot rather than combining the
  // entire buildRunnerPrompt() and liveCanonContextText() (which duplicated the
  // Lorebook, BardWiki and character evolution notes several times).
  function focusedDirectLore(lore, hint, maxChars) {
    const words=[...new Set((text(hint).match(/[가-힣]{3,}|[A-Za-z]{4,}/g)||[])
      .map(w=>w.toLowerCase()).filter(w=>w.length<22))].slice(0,35);
    const entries=(Array.isArray(lore)?lore:[]).map((entry,index)=>{
      const title=text(entry&& (entry.comment||entry.key)).slice(0,180);
      const body=text(entry&&entry.content);
      const titleLow=title.toLowerCase();
      const bodyHead=body.slice(0,700).toLowerCase();
      let score=0;
      if(/core|기본|공통|공식|world|ntr/i.test(title))score+=2;
      for(const word of words){
        if(titleLow.includes(word))score+=4;
        else if(bodyHead.includes(word))score+=1;
      }
      return {title,body,index,score};
    }).filter(item=>item.body.trim());
    entries.sort((a,b)=>b.score-a.score||a.index-b.index);
    const result=[];let budget=Math.max(1000,maxChars||4500);
    for(const entry of entries){
      if(budget<180||result.length>=11)break;
      const title='### '+(entry.title||'Lore')+'\n';
      const body=entry.body.slice(0,Math.min(900,budget-title.length));
      if(!body.trim())continue;
      const block=title+body;
      result.push(block);budget-=block.length+2;
    }
    return result.join('\n\n');
  }
  function boundedDirectWriterGuidance(node, ctx) {
    const c=ctx && ctx.currentCharacter || {};
    const remembered=normalizeStoryNotebook(project.storyNotebook);
    const character=[
      text(c.name) && 'Name: '+text(c.name).slice(0,170),
      text(c.description) && 'Description: '+text(c.description).slice(0,1700),
      text(c.personality) && 'Personality: '+text(c.personality).slice(0,950),
      text(c.scenario) && 'Scenario: '+text(c.scenario).slice(0,1100),
      text(c.firstMessage) && 'First-message context only (NEVER replay): '+text(c.firstMessage).slice(0,650),
    ].filter(Boolean).join('\n');
    const wiki=text(ctx && ctx.wikiContent);
    const wikiExcerpt=wiki.length<=2600?wiki:(wiki.slice(0,1700)+'\n[older details omitted]\n'+wiki.slice(-800));
    const docs=(ctx && Array.isArray(ctx.characterWikiDocs)?ctx.characterWikiDocs:[])
      .slice(0,3).map(d=>text(d.title).slice(0,120)+': '+text(d.content).slice(0,620)).join('\n');
    const canon=[
      '# CURRENT CHARACTER CARD — original identity and behavior (not a future plot)',character,
      '# RELEVANT ACTIVE LOREBOOK — world facts (not a story outline)',focusedDirectLore(ctx && ctx.lore,[text(node&&node.instruction),text(project.modernDirection),text(c.name)].join(" "),4800),
      '# STORY MEMORY/BARDWIKI — newer actual chat overrides stale summary',wikiExcerpt,
      docs && '# LONG-TERM CHARACTER STATE\n'+docs,
      remembered.version===2 && remembered.confidence==='checked' ?
        '# VERIFIED CURRENT ENDING\n'+text(remembered.lastEvent||remembered.scene).slice(0,650) : '',
      '# CURRENT USER-APPROVED STORY DIRECTION\n'+text(project.destination).slice(0,1200),
      '# CURRENT SCENE\n'+(node?[
          text(node.title).slice(0,140),text(node.instruction).slice(0,1600),
          (Array.isArray(node.completionCriteria)?node.completionCriteria.slice(0,5).join(' / '):'').slice(0,700)
        ].filter(Boolean).join('\n'):'Follow the latest real chat and the user-approved scene.'),
      text(project.modernDirection)&&'# LATEST USER EDIT\n'+text(project.modernDirection).slice(-900),
      '# WRITING RULES\nActual chat > verified canon > adjustable outline. Real character motives and consequences. Never import other-story names, rush a scene to its completion, or replay a completed event. Natural idiomatic Korean prose. No planning or analysis. Return only <SR_STORY>fiction</SR_STORY>. If scene is truly complete, place '+COMPLETE_MARKER+' AFTER the closing tag.',
    ].filter(Boolean).join('\n\n');
    return canon.slice(0,14900);
  }

  async function diagnoseMainWriterOutput() {
    if(mainWriterDiagnosticBusy)return;
    mainWriterDiagnosticBusy=true;
    mainWriterDiagnostic='메인 모델 단문 출력을 확인하는 중… (채팅 저장 없음)';
    if(uiOpen)renderUI();
    try {
      const prompts=[
        {role:'system',content:'한국어 글쓰기 정상 동작 점검이다. 기존 역할극·인물·스토리라인은 사용하지 마라. 일반적인 현대 한국어 산문 3문장을 완성해라. 영어, 로마자, 메타 설명, 목록은 쓰지 마라.'},
        {role:'user',content:'작은 서점에서 직원이 새로 들어온 책을 정리하는 장면을 자연스러운 한국어 산문 3문장으로 작성해.'}
      ];
      const output=await runInternalLLM({mode:'model',allowPlugins:true,messages:prompts});
      if(!output||(output.type&&output.type!=='success'))throw new Error('메인 모델 호출 실패: '+text(output&&output.type));
      const generated=extractVisibleModelText(output).replaceAll(COMPLETE_MARKER,'').trim();
      if(!generated)throw new Error('메인 모델이 빈 본문을 반환했어.');
      const problem=storySurfaceProblem(generated);
      const fragments=storyMixedScriptFragments(generated);
      // Display an excerpt locally only; never append diagnostics to chat memory.
      const snippet=generated.slice(0,180).replace(/[\u0000-\u001F]+/g,' ');
      mainWriterDiagnostic=(problem?
        '단문에서도 손상 의심 ('+problem+'). 공급자/모델 설정 또는 출력 후처리를 우선 점검해야 해.':
        '단문은 표면상 정상. 장편 집필의 문맥량·프롬프트 충돌 가능성이 더 커. 정상이라는 최종 증명은 아니야.')+
        '\n출력 '+generated.length+'자'+(fragments.length?' · 혼합 표현 '+fragments.slice(0,3).join(' / '):'')+'\n시험 문장: '+snippet;
      perfLog('mainWriterDiagnostic',{ok:!problem,chars:generated.length,fragments:fragments.slice(0,3)});
    } catch(error){
      mainWriterDiagnostic='단문 테스트 실패: '+text(error&&error.message||error).slice(0,150);
    } finally {
      mainWriterDiagnosticBusy=false;
      if(uiOpen)renderUI();
    }
  }

  async function beforeRequest(messages) {
    const isHostRequest = !directRunInProgress && internalLLMCallDepth === 0;
    const perf = isHostRequest ? {
      id: ++perfSequence,
      startedAt: Date.now(),
      input: perfMessageStats(messages),
      captureMs: 0,
      syncMs: 0,
      contextMs: 0,
      injectionChars: 0,
      injected: false,
      stage: "start",
    } : null;

    try {
      if (isHostRequest) activeHostPacingMode = "off";
      // v0.48+: Story Runner no longer captures/replays the fully assembled host prompt.
      // Runtime canon is read directly from the live character card, active Lorebook,
      // BardWiki evolution context, and recent chat. This avoids stale prompt snapshots.
      if (!isHostRequest) return messages;
      perf.captureMs = 0;
      perf.stage = "live-context";

      let t = Date.now();
      const activeTarget = await syncTarget();
      perf.syncMs = Date.now() - t;
      perf.stage = activeTarget ? "target-synced" : "no-target";
      if (!activeTarget) return messages;
      if (project.experienceMode !== 'ai') {
        // Direct play: track and preserve actual story continuity, but NEVER impose an episode/node plan.
        const memory = [storySetupPromptText(),notebookPromptText()].filter(Boolean).join('\n\n');
        if (!memory) { perf.stage = 'direct-no-memory'; return messages; }
        const next = [...messages];
        next.splice(Math.max(0,next.length-1),0,{role:'system',content:memory});
        perf.stage = 'direct-memory-only';
        perf.injected = true;perf.injectionChars = memory.length;
        perf.outputPrompt = perfMessageStats(next);
        return next;
      }
      if (!project.nodes.length || destinationReached()) {
        perf.stage = "no-active-story-runner";
        return messages;
      }
      const node = nextPendingNode();
      if (!node) {
        perf.stage = "no-pending-node";
        return messages;
      }
      project.currentNodeId = node.id;
      const latestUserText = latestUserTextFromMessages(messages);
      activeHostPacingMode = pacingModeForUserText(latestUserText);

      t = Date.now();
      const ctx = await readPlanningContext();
      perf.contextMs = Date.now() - t;
      perf.stage = "context-ready";

      let injection = boundedHostWriterGuidance(node, activeHostPacingMode, latestUserText);
      if (project.writerQualityMode === 'max' && project.running) {
        const ep = effectiveCurrentEpisode(project.planningOutline);
        const architect = await preparePremiumScene(messages, ep, latestUserText);
        if (architect) injection += '\n\n# PREMIUM SCENE ARCHITECTURE (advisory)\n' + architect;
      }
      perf.injectionChars = injection.length;
      perf.injected = true;
      const next = [...messages];
      const insertAt = Math.max(0, next.length - 1);
      next.splice(insertAt, 0, { role: "system", content: injection });
      perf.outputPrompt = perfMessageStats(next);
      perf.stage = "injected";
      return next;
    } catch (error) {
      console.log("[StoryRunner] beforeRequest skipped", error);
      if (perf) perf.stage = "error";
      return messages;
    } finally {
      if (perf) {
        perf.beforeRequestDoneAt = Date.now();
        perf.preprocessMs = perf.beforeRequestDoneAt - perf.startedAt;
        if (!perf.outputPrompt) perf.outputPrompt = perf.input;
        activeHostPerf = perf;
        perfLog("beforeRequest", {
          id: perf.id,
          stage: perf.stage,
          preprocessMs: perf.preprocessMs,
          captureMs: perf.captureMs,
          syncMs: perf.syncMs,
          contextMs: perf.contextMs,
          inputMessages: perf.input.messages,
          inputChars: perf.input.chars,
          outputMessages: perf.outputPrompt.messages,
          outputChars: perf.outputPrompt.chars,
          injectionChars: perf.injectionChars,
          injected: perf.injected,
        });
      }
    }
  }

  async function afterRequest(content, requestKind) {
    const escaped = COMPLETE_MARKER.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&");
    let cleanResult = text(content)
      .replace(/\s*<!--SR_EPISODE_STATUS\s+[\s\S]*?-->\s*$/i, "")
      .replace(new RegExp("\\s*" + escaped + "\\s*$"), "");
    const nativeAIRequest = project.experienceMode === 'ai' && project.running
      && !directRunInProgress && internalLLMCallDepth === 0 && requestKind !== '__sr_direct__';
    if (nativeAIRequest && project.writerQualityMode === 'max' && cleanResult.trim()) {
      try {
        const ctx = await readPlanningContext('premium output check',false);
        const recent = Array.isArray(ctx.recentMessages) ? ctx.recentMessages : [];
        cleanResult = await rewriteDraftForQuality(cleanResult,ctx,effectiveCurrentEpisode(project.planningOutline),
          project.modernDirection,activeHostPacingMode || 'adaptive',
          extractRoleplayIdentity(recent),lastRoleplayStatus(recent));
      } catch(error) { console.log('[StoryRunner] native premium fallback to original draft',error); }
    }
    if (nativeAIRequest) {
      const verdict = await storyQualityVerdict(cleanResult);
      if (!verdict.ok) {
        await flagRejectedStory(verdict.reason, 'Risu 자동 생성');
        // A Risu afterRequest replacer can replace the reply but cannot
        // guarantee cancellation of the host's eventual message insertion.
        // Never return the damaged prose; an empty response is safer.
        return '';
      }
    }
    return cleanResult;
  }


  function resetAutoLoopCounters() {
    autoRunTurnCount = 0;
    autoRunSameNodeCount = 0;
    autoRunLastNodeId = null;
    autoLoopBusy = false;
    clearTimeout(autoTimer);
    autoTimer = null;
  }

  async function stopAutoLoopAsGuard(reason) {
    project.running = false;
    project.autoRun = false;
    project.paused = true;
    project.lastStatus = "paused";
    project.lastReason = reason;
    clearTimeout(autoTimer);
    autoTimer = null;
    autoLoopBusy = false;
    await saveProject();
    if (uiOpen) renderUI();
  }

  async function executeNextAutoTurn() {
    if (autoLoopBusy) return;
    if (!project.running || !project.autoRun || project.paused || destinationReached()) return;

    const node = currentNode() || nextPendingNode();
    if (!node) {
      await stopAutoLoopAsGuard("자동 실행할 다음 Node가 없음");
      return;
    }

    if (autoRunTurnCount >= AUTO_RUN_MAX_TURNS) {
      await stopAutoLoopAsGuard(
        "자동 실행 안전 한도 " + AUTO_RUN_MAX_TURNS + "턴에 도달함. 내용을 확인한 뒤 자동 실행을 다시 누르면 계속할 수 있음."
      );
      return;
    }

    if (autoRunLastNodeId === node.id) {
      autoRunSameNodeCount += 1;
    } else {
      autoRunLastNodeId = node.id;
      autoRunSameNodeCount = 1;
    }

    if (autoRunSameNodeCount > AUTO_RUN_MAX_SAME_NODE_TURNS) {
      await stopAutoLoopAsGuard(
        "같은 Node가 " + AUTO_RUN_MAX_SAME_NODE_TURNS + "턴 동안 완료되지 않아 자동 실행을 일시정지함. 현재 장면/완료조건을 확인해줘."
      );
      return;
    }

    autoRunTurnCount += 1;
    autoLoopBusy = true;

    try {
      startAITask("자동 실행 · " + autoRunTurnCount + "턴", [
        "현재 실행 Node 확인",
        "Risu/플러그인 모델 호출",
        "AI 응답 생성 대기",
        "장면 완료 여부 판정",
      ]);
      setAITaskStep(
        0,
        "done",
        node.title + " · 같은 Node " + autoRunSameNodeCount + "턴째"
      );

      project.lastStatus = "running";
      project.lastReason =
        "자동 실행 " + autoRunTurnCount + "턴 · " + node.title +
        " · 같은 Node " + autoRunSameNodeCount + "턴째";
      await saveProject();
      if (uiOpen) renderUI();

      const dispatch = await sendChatWithVisiblePermission();

      if (dispatch && dispatch.mode === "sendChat") {
        setAITaskStep(1, "done", "채팅 전송 요청 완료");
        project.lastReason = "AI 응답 생성 대기 중";
        await saveProject();
        if (uiOpen) renderUI();
        // Normal sendChat continuation resumes from onChatOutput().
        return;
      }

      // Direct plugin-model generation is fully processed before this returns.
      // processDirectGeneratedOutput() schedules the next turn.
    } catch (error) {
      lastError = error && error.message ? error.message : String(error);
      project.running = false;
      project.autoRun = false;
      project.lastStatus = "failed";
      project.lastReason = lastError;
      finishAITask(false, lastError);
      clearTimeout(autoTimer);
      autoTimer = null;
      await saveProject();
      if (uiOpen) renderUI();
    } finally {
      autoLoopBusy = false;
    }
  }

  function scheduleAutoContinuation(reason) {
    if (!project.running || !project.autoRun || project.paused || destinationReached()) return;

    clearTimeout(autoTimer);
    project.lastReason = reason || "다음 자동 실행 준비 중";
    if (uiOpen) renderUI();

    autoTimer = setTimeout(() => {
      void executeNextAutoTurn();
    }, AUTO_RUN_DELAY_MS);
  }

  async function onChatOutput(arg) {
    try {
      const activeTarget = await syncTarget();
      if (!activeTarget) return;

      const message = arg && arg.chat && arg.chat.message && arg.chat.message[arg.messageIndex];
      // Only completed assistant story outputs can become continuity facts.
      if(message && message.role!=='char' && message.role!=='assistant')return;
      const content = text(message && message.data);
      if (!content) return;
      if(arg && Number.isInteger(arg.characterIndex) && arg.characterIndex !== activeTarget.characterIndex) return;
      if(arg && Number.isInteger(arg.chatIndex) && arg.chatIndex !== activeTarget.chatIndex) return;
      if (project.experienceMode === 'ai' && project.running) {
        const verdict = await storyQualityVerdict(content);
        if (!verdict.ok) {
          await flagRejectedStory(verdict.reason,'저장된 출력 재검사');
          return; // Do NOT update notebook, character wiki, node or next auto turn.
        }
      }
      modernLivePreview = content.length > 500 ? '…'+content.slice(-500) : content;
      modernLiveCount = Array.isArray(arg && arg.chat && arg.chat.message)
        ? arg.chat.message.filter(x=>x && (x.role==='user'||x.role==='char'||x.role==='assistant')).length
        : modernLiveCount;
      const trackedTarget = {...activeTarget};
      const observation = queueStoryInspection(content, trackedTarget, arg && arg.messageIndex, false);
      // Automated writing reads the accepted outcome BEFORE scheduling the next turn.
      if (project.running && project.autoRun && project.experienceMode === 'ai') {
        const observed = await observation;
        if(!observed) {
          await stopAutoLoopAsGuard('실제 대화 분석이 완료되지 않아 연속 진행을 중단했어. 기억을 다시 읽은 다음 재개해줘.');
          return;
        }
        if(normalizeStoryNotebook(project.storyNotebook).needsUserDecision) {
          await stopAutoLoopAsGuard('중요한 선택 지점이야. 직접 채팅으로 선택하거나 원하는 방향을 지시해줘.');
          return;
        }
      } else {
        void observation;
      }

      // Initial canon already lives in the character card / Risu Lorebook.
      // Do NOT duplicate that baseline into BardWiki. BardWiki is reserved for
      // durable story-evolved state discovered after RP actually progresses.
      if (project.experienceMode !== 'ai' || !project.nodes.length || destinationReached()) return;
      const node = currentNode() || nextPendingNode();
      if (!node) return;

      if (activeHostPerf) {
        const now = Date.now();
        perfLog("chatOutput", {
          id: activeHostPerf.id,
          preprocessMs: activeHostPerf.preprocessMs,
          observedModelWaitMs: now - activeHostPerf.beforeRequestDoneAt,
          totalObservedMs: now - activeHostPerf.startedAt,
          outputChars: content.length,
          injectedChars: activeHostPerf.injectionChars,
          promptCharsAfterStoryRunner: activeHostPerf.outputPrompt && activeHostPerf.outputPrompt.chars,
          note: "observedModelWaitMs includes downstream plugin/provider time; Risu API does not expose true network TTFT",
        });
        activeHostPerf = null;
      }

      if (aiTask && aiTask.active) {
        setAITaskStep(2, "done", "AI 응답 수신");
      }

      try { await markUsedCameosFromText(content); } catch (_) {}
      const result = await analyzeAcceptedOutput(content, node);
      if (activeHostPacingMode === "fine") {
        result.complete = false;
        result.truncated = false;
        result.reason = "세밀 진행: 이번 턴은 한 단계만 진행 · 같은 Node/화 유지";
      }
      if (aiTask && aiTask.active) {
        setAITaskStep(3, "done", result.complete ? "현재 Node 완료" : "현재 Node 계속 진행");
      }
      project.lastReason = result.reason;

      try {
        await applyCharacterUpdates(result.characterUpdates);
      } catch (error) {
        characterSyncStatus = "갱신 실패";
        console.log("[StoryRunner] character sync stage failed", error);
      }

      const hostEpisode = node.episodeNumber ? { number: node.episodeNumber } : null;
      const hostProgressBefore = episodeProgressBeforeTurn(hostEpisode);
      const hostBoundary = protectEpisodeBoundary(hostEpisode, result.complete, content, hostProgressBefore);
      if (result.complete && !hostBoundary.complete) {
        result.complete = false;
        result.reason = hostBoundary.reason;
      }

      if (result.complete) {
        project.nextEpisodeStale = true;
        if (!project.completedNodeIds.includes(node.id)) project.completedNodeIds.push(node.id);
        const next = nextPendingNode();
        project.currentNodeId = next ? next.id : null;
        if (node.episodeNumber && project.episodeRuntimeStatus) delete project.episodeRuntimeStatus[text(node.episodeNumber)];
      } else if (node.episodeNumber) {
        if (!project.episodeRuntimeStatus || typeof project.episodeRuntimeStatus !== "object") project.episodeRuntimeStatus = {};
        saveEpisodeContinuation({ number: node.episodeNumber }, content, result.reason, result.truncated, hostProgressBefore);
      }

      const modernShouldRoll = destinationReached() && project.experienceMode === 'ai'
        && project.modernContinuous && project.autoRun && !project.paused && !modernUserStopped;
      if (destinationReached()) {
        project.running = false;
        project.autoRun = false;
        project.paused = false;
        project.lastStatus = "completed";
        project.lastReason = "현재 설계 구간에 도달함";
      } else {
        project.lastStatus = result.complete ? "advanced" : "waiting";
      }

      await saveProject();
      activeHostPacingMode = "off";

      if (aiTask && aiTask.active) {
        if (project.autoRun && !destinationReached()) {
          finishAITask(
            true,
            result.complete
              ? "현재 Node 완료 · 다음 Node 자동 실행"
              : "현재 Node 미완료 · 같은 Node 자동 계속"
          );
        } else {
          finishAITask(true, result.complete ? "1회 실행 완료" : "응답 생성 완료 · 현재 Node 계속 진행");
        }
      }

      if (uiOpen) renderUI();
      // Next-episode recommendations are opt-in, not a costly automatic background task.
      if (modernAdvanced && result.complete && !project.autoRun && !nextEpisodeBusy) { void generateNextEpisodeChoices(); }
      if(modernShouldRoll) { void modernRollToNextPlan(); }

      if (project.running && project.autoRun && !project.paused && !destinationReached()) {
        scheduleAutoContinuation(
          result.complete
            ? "현재 Node 완료 · 다음 Node 자동 실행 준비"
            : "현재 Node 미완료 · 같은 Node 자동 계속 준비"
        );
      } else if (project.running && !project.autoRun) {
        project.running = false;
        await saveProject();
        if (uiOpen) renderUI();
      }
    } catch (error) {
      lastError = error && error.message ? error.message : String(error);
      console.log("[StoryRunner] output listener failed", error);
      if (project.experienceMode === 'ai' && project.running)
        await flagRejectedStory('출력 수신/검증 중 오류: '+lastError, '출력 처리');
    }
  }



  function extractModelText(result) {
    if (typeof result === "string") return result;
    if (!result) return "";
    if (typeof result.result === "string") return result.result;
    if (typeof result.content === "string") return result.content;
    if (Array.isArray(result)) {
      return result.map((part) => {
        if (typeof part === "string") return part;
        if (part && typeof part.text === "string") return part.text;
        if (part && typeof part.content === "string") return part.content;
        return "";
      }).join("");
    }
    return "";
  }

  async function appendAssistantMessageToCurrentChat(content) {
    const target = await requireTarget();
    const chat = await risuai.getChatFromIndex(target.characterIndex, target.chatIndex);
    if (!chat) throw new Error("현재 채팅을 다시 읽지 못했습니다.");

    const nextChat = JSON.parse(JSON.stringify(chat));
    if (!Array.isArray(nextChat.message)) nextChat.message = [];
    nextChat.message.push({
      role: "char",
      data: content,
      time: Date.now(),
      chatId: uid("srmsg"),
    });

    await risuai.setChatToIndex(target.characterIndex, target.chatIndex, nextChat);
  }

  async function processDirectGeneratedOutput(content) {
    const node = currentNode() || nextPendingNode();
    if (!node) return;

    if (aiTask && aiTask.active) setAITaskStep(2, "done", "AI 응답 수신");

    const result = await analyzeAcceptedOutput(content, node);

    if (aiTask && aiTask.active) {
      setAITaskStep(3, "done", result.complete ? "현재 Node 완료" : "현재 Node 계속 진행");
    }

    project.lastReason = result.reason;

    try {
      await applyCharacterUpdates(result.characterUpdates);
    } catch (error) {
      characterSyncStatus = "갱신 실패";
      console.log("[StoryRunner] direct character sync failed", error);
    }

    if (result.complete) {
      if (!project.completedNodeIds.includes(node.id)) project.completedNodeIds.push(node.id);
      const next = nextPendingNode();
      project.currentNodeId = next ? next.id : null;
      if (node.episodeNumber && project.episodeRuntimeStatus) delete project.episodeRuntimeStatus[text(node.episodeNumber)];
    } else if (node.episodeNumber) {
      if (!project.episodeRuntimeStatus || typeof project.episodeRuntimeStatus !== "object") project.episodeRuntimeStatus = {};
      project.episodeRuntimeStatus[text(node.episodeNumber)] = {
        needsContinuation: true,
        likelyTruncated: result.truncated === true,
        reason: result.reason,
        lastOutputTail: content.slice(-1400),
        updatedAt: Date.now(),
      };
    }

    const modernDirectShouldRoll = destinationReached() && project.experienceMode === 'ai'
      && project.modernContinuous && project.autoRun && !project.paused && !modernUserStopped;
    if (destinationReached()) {
      project.running = false;
      project.autoRun = false;
      project.paused = false;
      project.lastStatus = "completed";
      project.lastReason = "현재 설계 구간에 도달함";
    } else {
      project.lastStatus = result.complete ? "advanced" : "waiting";
    }

    await saveProject();

    if (aiTask && aiTask.active) {
      if (project.autoRun && !destinationReached()) {
        finishAITask(
          true,
          result.complete
            ? "현재 Node 완료 · 다음 Node 자동 실행"
            : "현재 Node 미완료 · 같은 Node 자동 계속"
        );
      } else {
        finishAITask(true, result.complete ? "1회 실행 완료" : "응답 생성 완료 · 현재 Node 계속 진행");
      }
    }

    if (uiOpen) renderUI();
    if(modernDirectShouldRoll) { void modernRollToNextPlan(); }

    if (project.running && project.autoRun && !project.paused && !destinationReached()) {
      scheduleAutoContinuation(
        result.complete
          ? "현재 Node 완료 · 다음 Node 자동 실행 준비"
          : "현재 Node 미완료 · 같은 Node 자동 계속 준비"
      );
    } else if (project.running && !project.autoRun) {
      project.running = false;
      await saveProject();
    }
  }


  function normalizePromptRole(role) {
    if (role === "user") return "user";
    if (role === "bot" || role === "assistant" || role === "char") return "assistant";
    return "system";
  }

  function presetBlockText(item) {
    if (!item || typeof item !== "object") return "";
    if (item.type === "plain" || item.type === "jailbreak" || item.type === "cot" || item.type === "chatML") {
      return text(item.text);
    }
    if (item.type === "authornote") {
      return text(item.defaultText || item.innerFormat);
    }
    return "";
  }

  function isRuntimeInjectionMessage(message) {
    const content = text(message && message.content);
    return content.includes("# MUTATION STATE ROUTER")
      || content.includes("# MUTATION RUNTIME BRIEF")
      || content.includes("STORY RUNNER DIRECT EXECUTION")
      || content.includes("# STORY RUNNER EPISODE CONTEXT")
      || content.includes("# STORY RUNNER RUNTIME");
  }

  function sanitizeCapturedHostMessages(messages) {
    const source = Array.isArray(messages) ? messages : [];
    const cleaned = source
      .filter((m) => m && typeof m === "object" && !isRuntimeInjectionMessage(m))
      .map((m) => ({
        role: normalizePromptRole(m.role),
        content: text(m.content),
        name: text(m.name) || undefined,
      }))
      .filter((m) => m.content.trim());

    // Avoid unbounded plugin storage growth while preserving the prompt prefix and recent tail.
    if (cleaned.length <= 80) return cleaned;
    return cleaned.slice(0, 50).concat(cleaned.slice(-30));
  }

  async function loadHostPromptCapture() {
    try {
      const target = currentTarget || await detectTarget();
      let saved = await risuai.pluginStorage.getItem(hostPromptCaptureKey(target));
      if ((!saved || !Array.isArray(saved.messages) || !saved.messages.length) && target) {
        const legacyKey = HOST_PROMPT_CAPTURE_KEY + "_" + target.characterId + "_" + target.chatId;
        saved = await risuai.pluginStorage.getItem(legacyKey);
        if (saved && Array.isArray(saved.messages) && saved.messages.length) {
          try { await risuai.pluginStorage.setItem(hostPromptCaptureKey(target), saved); } catch (_) {}
        }
      }
      if (saved && Array.isArray(saved.messages) && saved.messages.length) {
        hostPromptCapture = saved;
        directPresetStatus = {
          name: text(saved.promptName) || "레거시 호스트 프롬프트",
          blockCount: saved.messages.length,
          blockNames: [],
          loadedAt: Number(saved.capturedAt) || Date.now(),
        };
      }
    } catch (error) {
      console.log("[StoryRunner] host prompt capture load failed", error);
    }
  }

  async function captureHostPrompt(messages) {
    if (directRunInProgress || internalLLMCallDepth > 0) return false;

    const cleaned = sanitizeCapturedHostMessages(messages);
    if (!cleaned.length) return false;

    let target = null;
    try {
      target = await detectTarget();
      if (!target) return false;
    } catch (_) {
      return false;
    }

    // The beforeRequest payload is already the fully assembled Risu prompt.
    // Plugin-owned requests are excluded by internalLLMCallDepth, so do not try
    // to identify a normal chat by matching transformed user text. Presets can
    // wrap/merge the user input and that made earlier captures fail.
    const capture = {
      capturedAt: Date.now(),
      characterIndex: target.characterIndex,
      chatIndex: target.chatIndex,
      characterId: text(target.characterId),
      chatId: text(target.chatId),
      promptName: "레거시 호스트 프롬프트",
      messages: cleaned,
    };

    hostPromptCapture = capture;
    directPresetStatus = {
      name: capture.promptName,
      blockCount: cleaned.length,
      blockNames: [],
      loadedAt: capture.capturedAt,
    };

    try {
      await risuai.pluginStorage.setItem(hostPromptCaptureKey(target), capture);
    } catch (error) {
      console.log("[StoryRunner] host prompt capture save skipped", error);
    }
    if (uiOpen) renderUI();
    console.log("[StoryRunner] captured host prompt", cleaned.length, "messages");
    return true;
  }

  async function readActivePromptPresetForDirectRun() {
    const activeTarget = currentTarget || await detectTarget();

    // Character/chat IDs are not guaranteed to be stable in every Risu chat
    // transition path. Prefer the API indexes, which are what getChatFromIndex uses.
    if (hostPromptCapture && activeTarget) {
      const capCharIndex = Number(hostPromptCapture.characterIndex);
      const capChatIndex = Number(hostPromptCapture.chatIndex);
      const hasIndexes = Number.isFinite(capCharIndex) && Number.isFinite(capChatIndex);

      if (hasIndexes) {
        if (capCharIndex !== activeTarget.characterIndex || capChatIndex !== activeTarget.chatIndex) {
          hostPromptCapture = null;
        }
      } else {
        // Legacy capture: accept only if the old IDs clearly match.
        const capCharacterId = text(hostPromptCapture.characterId);
        const capChatId = text(hostPromptCapture.chatId);
        if ((capCharacterId && capCharacterId !== text(activeTarget.characterId))
          || (capChatId && capChatId !== text(activeTarget.chatId))) {
          hostPromptCapture = null;
        }
      }
    }

    if (!hostPromptCapture) await loadHostPromptCapture();

    // If the UI already has a valid capture for this exact target, do not throw it
    // away merely because a legacy storage key missed. This fixes the contradictory
    // "37 messages captured" + "not captured" state.
    if (!hostPromptCapture || !Array.isArray(hostPromptCapture.messages) || !hostPromptCapture.messages.length) {
      directPresetStatus = {
        name: "레거시 호스트 프롬프트 미사용",
        blockCount: 0,
        blockNames: [],
        loadedAt: Date.now(),
      };
      return { name: "", messages: [], blockNames: [], captured: false };
    }

    const messages = sanitizeCapturedHostMessages(hostPromptCapture.messages);
    if (!messages.length) {
      directPresetStatus = {
        name: "레거시 호스트 프롬프트 미사용",
        blockCount: 0,
        blockNames: [],
        loadedAt: Date.now(),
      };
      return { name: "", messages: [], blockNames: [], captured: false };
    }

    directPresetStatus = {
      name: text(hostPromptCapture.promptName) || "레거시 호스트 프롬프트",
      blockCount: messages.length,
      blockNames: [],
      loadedAt: Number(hostPromptCapture.capturedAt) || Date.now(),
    };
    return { name: directPresetStatus.name, messages, blockNames: [], captured: true };
  }

  async function runCurrentNodeDirect() {
    const node = currentNode() || nextPendingNode();
    if (!node) throw new Error("실행할 현재 Node가 없습니다.");

    const ctx = await readPlanningContext(node.instruction || project.destination, true);
    const recent = Array.isArray(ctx.recentMessages) ? ctx.recentMessages.slice(-6) : [];
    const messages = [
      {role:'system',content:boundedDirectWriterGuidance(node,ctx)}
    ];
    for (const m of recent) {
      const role = m.role === 'assistant' || m.role === 'char' ? 'assistant' : 'user';
      // Prefer the last actual paragraphs for continuity; do not resend the
      // same huge chat tail into both system canon and recent messages.
      const excerpt = text(m.content||m.data);
      messages.push({role,content:(role==='assistant' && storySurfaceProblem(excerpt))
        ? '[이전 저장 메시지의 문자 손상 부분은 모델 입력에서 제외함. 기존에 확정된 사건만 참고할 것.]'
        : excerpt.slice(-2300)});
    }
    perfLog('boundedDirectContext',{systemChars:messages[0].content.length,chatChars:messages.slice(1).reduce((n,m)=>n+m.content.length,0),node:text(node.title).slice(0,80)});

    messages.push({
      role: "user",
      content: [
        "Continue the story naturally from the exact current chat state.",
        "Do not summarize or rush through the current Story Runner node.",
        "Treat the current node as a full scene, not a checklist. Make its central event happen visibly in this generation; do not replace a required encounter with off-screen lurking, mysterious shadows or repeated foreshadowing.",
        "Let interaction, reaction, dialogue, tension, and consequences breathe before marking the scene complete. Follow the latest user-edited plan rather than an older summary; make tangible progress toward the active scene goal.",
        "Follow the active Risu Lorebook and Story Runner runtime guidance together."
      ].join("\n"),
    });

    if (project.writerQualityMode === 'max') {
      const architect = await preparePremiumScene(messages, effectiveCurrentEpisode(project.planningOutline), project.modernDirection);
      if (architect) messages[0].content += '\n\n# PREMIUM SCENE ARCHITECTURE (advisory)\n' + architect;
    }
    const result = await runInternalLLM({
      messages,
      mode: "model",
      allowPlugins: true,
    });

    const raw = extractVisibleModelText(result);
    const surface=storySurfaceProblem(raw);
    perfLog('mainWriterRawOutput',{chars:raw.length,surfaceProblem:surface||'',fragments:storyMixedScriptFragments(raw).slice(0,3)});
    let drafted = await afterRequest(raw, '__sr_direct__');
    if (project.writerQualityMode === 'max' && drafted.trim()) {
      drafted = await requireValidStoryBeforeInsert(drafted, messages, '고품질 초안');
      drafted = await rewriteDraftForQuality(drafted,ctx,effectiveCurrentEpisode(project.planningOutline),
        project.modernDirection,'adaptive',extractRoleplayIdentity(recent),lastRoleplayStatus(recent));
    }
    const content = await requireValidStoryBeforeInsert(drafted, messages, '직접 생성');
    if (roleplayIdentityViolation(content, extractRoleplayIdentity(recent))
      || !statusSheetGuard(content, lastRoleplayStatus(recent))) {
      await flagRejectedStory('현재 주인공이나 기존 상태창이 달라짐', '직접 생성');
      throw new Error('기존 캐릭터/상태창과 일치하지 않아 삽입 중단');
    }
    lastError='';
    if(project.lastStatus==='failed')project.lastStatus='waiting';
    if(project.lastReason&&project.lastReason.startsWith('\uBCF8\uBB38 \uD488\uC9C8 \uAC80\uC0AC \uC2E4\uD328'))project.lastReason='';
    await appendAssistantMessageToCurrentChat(content);
    playDirectStoryCompletionSound();
    // setChatToIndex may not emit a normal host output event. Track explicit plugin output too.
    const liveAccepted = await loadModernLivePreview();
    if(liveAccepted && currentTarget) {
      await queueStoryInspection(liveAccepted.content,{...currentTarget},liveAccepted.messageIndex,false);
    }
    await processDirectGeneratedOutput(content);
    return { mode: "direct-plugin-model" };
  }

  async function sendChatWithVisiblePermission() {
    let hidden = false;
    try {
      if (uiOpen) {
        try {
          await risuai.hideContainer();
          hidden = true;
          await new Promise((resolve) => setTimeout(resolve, 180));
        } catch (_) {}
      }

      try {
        await armMutationPackOverrideForNextGeneration(
          (currentNode() && currentNode().instruction) || project.destination
        );
        const sent = await risuai.sendChat("");
        if (sent === false) {
          throw new Error(
            "Risu가 Story Runner의 채팅 전송 권한을 허용하지 않았습니다. " +
            "플러그인 목록에서 Story Runner의 방패 아이콘으로 권한 응답을 초기화한 뒤 다시 실행해 주세요."
          );
        }
        return { mode: "sendChat" };
      } catch (error) {
        const message = error && error.message ? error.message : String(error);
        if (message.includes("Sending chat with plugin-based model is currently blocked")) {
          if (hidden) {
            try {
              await risuai.showContainer("fullscreen");
              hidden = false;
              renderUI();
            } catch (_) {}
          }
          setAITaskStep(1, "running", "플러그인 모델 직접 호출 · 현재 프롬프트 프리셋 유지");
          return await runCurrentNodeDirect();
        }
        throw error;
      }
    } finally {
      if (hidden) {
        try {
          await new Promise((resolve) => setTimeout(resolve, 180));
          await risuai.showContainer("fullscreen");
          renderUI();
        } catch (_) {}
      }
    }
  }

  async function runOne() {
    await requireTarget();
    if (!project.nodes.length) throw new Error("먼저 전개 설계에서 '화별 설계 확정 · 실행 상세 만들기'를 눌러 주세요.");
    if (destinationReached()) return;
    project.running = true;
    project.autoRun = false;
    project.paused = false;
    project.lastStatus = "running";
    project.lastReason = "1회 실행 요청 중";
    await saveProject();
    startAITask("1회 실행", [
      "현재 실행 Node 확인",
      "Risu 채팅 전송",
      "AI 응답 생성 대기",
      "장면 완료 여부 판정",
    ]);
    setAITaskStep(0, "done", currentNode() ? currentNode().title : "현재 Node");
    if (uiOpen) renderUI();

    try {
      const dispatch = await sendChatWithVisiblePermission();
      if (dispatch && dispatch.mode === "sendChat") {
        setAITaskStep(1, "done", "채팅 전송 요청 완료");
        project.lastReason = "AI 응답 생성 대기 중";
        await saveProject();
        if (uiOpen) renderUI();
      }
    } catch (error) {
      project.running = false;
      project.autoRun = false;
      project.lastStatus = "failed";
      project.lastReason = error && error.message ? error.message : String(error);
      finishAITask(false, project.lastReason);
      await saveProject();
      if (uiOpen) renderUI();
      throw error;
    }
  }

  async function runAuto() {
    await requireTarget();
    if (!project.nodes.length) throw new Error("먼저 전개 설계에서 '화별 설계 확정 · 실행 상세 만들기'를 눌러 주세요.");
    if (destinationReached()) return;

    resetAutoLoopCounters();
    project.running = true;
    project.autoRun = true;
    project.paused = false;
    project.lastStatus = "running";
    project.lastReason = "연속 자동 실행 시작";
    await saveProject();
    if (uiOpen) renderUI();

    await executeNextAutoTurn();
  }

  async function pauseRunner() {
    if (!currentTarget) return;
    project.paused = true;
    project.running = false;
    project.autoRun = false;
    project.modernContinuous = false;
    modernUserStopped = true;
    project.lastStatus = "paused";
    clearTimeout(autoTimer);
    autoTimer = null;
    autoLoopBusy = false;
    await saveProject();
    if (uiOpen) renderUI();
  }

  async function resetPlanning() {
    if (!currentTarget) return;
    project.nodes = [];
    project.currentNodeId = null;
    project.completedNodeIds = [];
    project.planningChat = [];
    project.planningOutline = null;
    project.currentEpisodeOverride = "";
    project.planningLocked = false;
    project.running = false;
    project.autoRun = false;
    project.paused = false;
    project.generationNonce = uid("gen");
    project.lastStatus = "idle";
    project.lastReason = "";
    resetAutoLoopCounters();
    await saveProject();
    if (uiOpen) renderUI();
  }

  function escapeHtml(value) {
    return text(value)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;");
  }

  function effectiveCurrentEpisode(outline) {
    outline = outline || project.planningOutline;
    const detected = outline && outline.currentEpisode ? outline.currentEpisode : null;
    if (project.currentEpisodeOverride) {
      const found = outline && Array.isArray(outline.episodes)
        ? outline.episodes.find((ep) => text(ep.number) === project.currentEpisodeOverride)
        : null;
      return {
        number: project.currentEpisodeOverride,
        title: found ? text(found.title) : "수동 지정",
        status: "현재",
        confidence: "수동",
        reason: "사용자가 현재 화를 직접 지정함.",
        progress: detected ? text(detected.progress) : "",
      };
    }
    return detected;
  }

  function episodeStatusClass(status) {
    status = text(status);
    if (status === "현재") return "current";
    if (status === "완료") return "done";
    if (status === "예정") return "planned";
    return "unknown";
  }



  function storyDnaPanelHtml() {
    const active = storyDnaSorted("active");
    const candidates = storyDnaSorted("candidate");
    const rows = active.slice(0, 12).map((pref) =>
      '<div class="dna-row"><div><b>' + escapeHtml(storyDnaPrefPolarity(pref) === "like" ? '좋아함' : '피하고 싶음') + '</b><span>' + escapeHtml(storyDnaPrefStatement(pref)) + '</span><small>' + escapeHtml(text(pref.category)) + ' · 근거 ' + escapeHtml(String(pref.evidenceCount || 0)) + '회</small></div><button data-dna-remove="' + escapeHtml(pref.key) + '">제외</button></div>'
    ).join("");
    const candidateRows = candidates.slice(0, 10).map((pref) =>
      '<div class="dna-row candidate"><div><b>학습 후보</b><span>' + escapeHtml(storyDnaPrefStatement(pref)) + '</span><small>' + escapeHtml(text(pref.category)) + ' · 근거 ' + escapeHtml(String(pref.evidenceCount || 0)) + '회</small></div><div class="dna-row-actions"><button data-dna-promote="' + escapeHtml(pref.key) + '">확정</button><button data-dna-remove="' + escapeHtml(pref.key) + '">삭제</button></div></div>'
    ).join("");
    return [
      '<details id="sr-story-dna-panel" class="story-dna-panel"' + (storyDnaExpanded ? ' open' : '') + '>',
      '<summary>🧬 Story DNA · 공통 취향 ' + active.length + '개' + (candidates.length ? (' · 학습 후보 ' + candidates.length + '개') : '') + '</summary>',
      '<div class="dna-body">',
      '<p class="dna-summary">' + escapeHtml(text(storyDNA.profileSummary) || '아직 정리된 공통 취향이 없어.') + '</p>',
      '<label class="dna-learning"><input type="checkbox" id="sr-dna-learning"' + (storyDNA.learningEnabled !== false ? ' checked' : '') + '> 내가 반복해서 좋아하거나 싫어하는 전개를 Story DNA에 자동 학습</label>',
      storyDnaNotice ? '<p class="dna-notice">' + escapeHtml(storyDnaNotice) + '</p>' : '',
      storyDnaError ? '<p class="error">' + escapeHtml(storyDnaError) + '</p>' : '',
      rows || '<p class="status">활성 공통 취향이 아직 없어.</p>',
      candidateRows ? '<details id="sr-dna-candidates" class="dna-candidates"' + (storyDnaCandidatesExpanded ? ' open' : '') + '><summary>학습 후보 보기</summary>' + candidateRows + '</details>' : '',
      '<div class="dna-tools"><button id="sr-dna-export">MD 내보내기</button><button id="sr-dna-import">MD 가져오기</button><input id="sr-dna-import-file" type="file" accept=".md,.json,text/markdown,application/json" style="display:none"></div>',
      '<p class="status">Story DNA는 모든 봇/채팅에 공통으로 적용되는 소프트 취향 메모야. 지금 지시와 현재 작품 설정이 항상 더 우선함.</p>',
      '</div></details>'
    ].join("");
  }

  function directorListHtml(title, items) {
    const rows = stringList(items);
    if (!rows.length) return "";
    return '<div class="director-mini"><b>' + escapeHtml(title) + '</b><ul>' + rows.map((x) => '<li>' + escapeHtml(x) + '</li>').join("") + '</ul></div>';
  }

  function directorResultHtml() {
    const a = project.directorAnalysis;
    if (!a || typeof a !== "object") {
      return '<div class="director-empty">아직 정리한 내용이 없어.<br><b>위 칸에 하고 싶은 걸 아무렇게나 쓰고 AI가 정리하기를 눌러줘.</b></div>';
    }
    const i = a.interpretation || {};
    return [
      text(a.summary) ? '<div class="director-summary">' + escapeHtml(a.summary) + '</div>' : '',
      '<div class="director-result-card state"><h3>◆ 현재 상황 파악</h3><div class="director-prose">' + escapeHtml(text(a.currentState) || '현재 상태 요약 없음') + '</div></div>',
      '<div class="director-result-card"><h3>◆ 이렇게 흘러가면 좋음</h3><div class="director-prose">' + escapeHtml(text(a.flow) || '흐름 없음') + '</div></div>',
      '<div class="director-result-card now"><h3>◆ 지금은 이렇게 진행</h3><div class="director-prose">' + escapeHtml(text(a.now) || '현재 지시 없음') + '</div></div>',
      (Array.isArray(a.tasteSuggestions) && a.tasteSuggestions.length ? '<div class="director-result-card dna-suggest"><h3>◆ 🧬 네 취향 기준으로는 이런 것도 괜찮음</h3><div class="dna-suggestion-list">' + a.tasteSuggestions.map((x) => '<div class="dna-suggestion">' + escapeHtml(x) + '</div>').join('') + '</div></div>' : ''),
      '<div class="director-result-card writer"><div class="director-writer-head"><h3>◆ 작가에게 넘길 지시문</h3><button id="sr-director-use" class="primary">이 방향으로 설계하기</button></div><div class="director-prose writer-text">' + escapeHtml(text(a.writerInstruction) || '지시문 없음') + '</div></div>',
      '<details class="director-interpret"><summary>AI 해석 / 장기 목표 / 아직 하면 안 될 것</summary><div class="director-grid">' +
        directorListHtml('이번에 확정', i.locked) +
        directorListHtml('이번 장면 선호', i.currentPreferences) +
        directorListHtml('중기 방향', i.midTerm) +
        directorListHtml('먼 미래 목표', i.longTermTargets) +
        directorListHtml('후보 아이디어', i.optionalIdeas) +
        directorListHtml('아직 하면 안 됨', i.notYet) +
      '</div></details>'
    ].join("");
  }

    // =======================================================================
  // Story Runner v0.92: quiet, result-first workspace. Mutation remains independent.
  // Two modes: direct Risu chat with passive memory, AI story with optional direction.
  // The existing deep planner/queues remain accessible in the legacy advanced view.
  // =======================================================================
  function emptyStoryNotebook() {
    return {
      version: 2, summary: '', scene: '', lastEvent: '', nextPressure: '',
      groundedEvents: [], characters: [], openThreads: [],
      lastProcessedKey: '', lastProcessedAt: 0, analyzedCount: 0,
      confidence: 'unverified', needsUserDecision: false,
    };
  }

  function normalizeStoryNotebook(raw) {
    const base = emptyStoryNotebook();
    if (!raw || typeof raw !== 'object') return base;
    const capText = (v, n) => text(v).slice(0, n);
    return {
      version: raw.version === 2 ? 2 : 1,
      summary: capText(raw.summary, 1800),
      scene: capText(raw.scene, 380),
      lastEvent: capText(raw.lastEvent, 600),
      nextPressure: capText(raw.nextPressure, 700),
      groundedEvents: (Array.isArray(raw.groundedEvents) ? raw.groundedEvents : []).slice(-16)
        .map(x => ({ fact: capText(x && x.fact, 340), evidence: capText(x && x.evidence, 160), key: capText(x && x.key, 110) }))
        .filter(x => x.fact && x.evidence),
      characters: (Array.isArray(raw.characters) ? raw.characters : []).slice(0, 16)
        .map(x => ({name: capText(x && x.name, 90), state: capText(x && x.state, 280), knows: capText(x && x.knows, 220)}))
        .filter(x => x.name),
      openThreads: stringList(raw.openThreads).map(x => x.slice(0, 220)).slice(0, 12),
      lastProcessedKey: capText(raw.lastProcessedKey, 250),
      lastProcessedAt: Number(raw.lastProcessedAt) || 0,
      analyzedCount: Math.max(0, Number(raw.analyzedCount) || 0),
      confidence: ['checked','unverified'].includes(raw.confidence) ? raw.confidence : 'unverified',
      needsUserDecision: raw.needsUserDecision === true,
    };
  }

  function storySetupPromptText() {
    const setup = text(project.modernStorySetup).trim();
    if (!setup) return '';
    return [
      '# USER-SUPPLIED STORY SETUP — THIS CHAT ONLY',
      'These are user-supplied world and character notes. They are background constraints, not events already played.',
      'Respect actual live chat, active canonical character card and Mutation-owned world rules when reconciling facts.',
      setup.slice(0, 12500),
    ].join('\n');
  }

  function notebookPromptText() {
    const n = normalizeStoryNotebook(project.storyNotebook);
    if (!n.lastProcessedAt || n.version !== 2 || n.confidence !== 'checked') return '';
    return [
      '# STORY RUNNER ACCEPTED-STORY NOTEBOOK (read-only, derived from actual accepted chat)',
      'The ACTUAL last chat messages outrank this summary. Never treat a planned future as something that already happened.',
      'Characters do not automatically know everything the narrator or other characters know.',
      'DO NOT repeat completed events, retroactively alter established character identity, or force an old scene plan over actual results.',
      n.summary ? 'Story so far: '+n.summary : '',
      n.scene ? 'Current setting/scene: '+n.scene : '',
      n.lastEvent ? 'Last accepted event: '+n.lastEvent : '',
      n.characters.length ? 'Character knowledge/state (only established facts):\n'+n.characters.map(c => '- '+c.name+': '+c.state+(c.knows ? ' / Knowledge: '+c.knows : '')).join('\n') : '',
      n.openThreads.length ? 'Open threads (not yet happened): '+n.openThreads.join(' | ') : '',
      n.nextPressure ? 'Possible immediate continuation (soft hint, not canon): '+n.nextPressure : '',
    ].filter(Boolean).join('\n').slice(0, 5000);
  }

  function storySignature(s, index, target) {
    const source = text(s);
    let hash = 2166136261;
    for (let i=0;i<source.length;i++) hash = Math.imul(hash ^ source.charCodeAt(i), 16777619);
    return String(target.characterId)+'/'+String(target.chatId)+':'+String(index)+':'+source.length+':'+(hash>>>0).toString(36);
  }

  const notebookQueues = new Map();
  let notebookStatus = '';
  let notebookError = '';
  let modernAdvanced = false;
  let modernStorySetupExpanded = false;
  let modernBusy = '';
  let modernLivePreview = '';
  let modernLiveCount = 0;
  let modernShowSuggestions = false;
  let modernAutoSessionTurns = 0;
  let modernRolling = false;
  let modernRolloverCount = 0;
  let modernUserStopped = false;

  function targetKey(t) { return t ? text(t.characterId)+'::'+text(t.chatId) : ''; }

  async function loadModernLivePreview() {
    if (!currentTarget) { modernLivePreview = '';modernLiveCount = 0;return null; }
    try {
      const chat = await risuai.getChatFromIndex(currentTarget.characterIndex,currentTarget.chatIndex);
      const rows = Array.isArray(chat && chat.message) ? chat.message : [];
      modernLiveCount = rows.filter(x=>x && (x.role === 'user'||x.role==='char'||x.role==='assistant')).length;
      for (let i=rows.length-1;i>=0;i--) {
        const m=rows[i];
        if (m && (m.role==='char'||m.role==='assistant') && text(m.data).trim()) {
          const value = text(m.data).replace(/<SR_SCENE_COMPLETE\/>/g,'').trim();
          modernLivePreview = value.length>500 ? '…'+value.slice(-500) : value;
          return {content:text(m.data),messageIndex:i,chat};
        }
      }
    } catch (error) { console.log('[StoryRunner] modern chat preview unavailable',error); }
    modernLivePreview='';return null;
  }

  async function inspectActualAcceptedStory(content, target, messageIndex, force) {
    const active = currentTarget;
    if (!active || targetKey(active)!==targetKey(target)) return false;
    const source = text(content).trim();
    if (!source) return false;
    const index = Number.isInteger(messageIndex) ? messageIndex : -1;
    const signature = storySignature(source,index,target);
    const previous = normalizeStoryNotebook(project.storyNotebook);
    if (!force && previous.version===2 && previous.lastProcessedKey===signature) return true;
    const quality = await storyQualityVerdict(source);
    if (!quality.ok) {
      notebookStatus = '손상된 출력 · 기억 기록 차단';
      notebookError = quality.reason;
      if (project.experienceMode==='ai' && project.running)
        await flagRejectedStory(quality.reason,'기억 분석 전 검수');
      if (uiOpen) renderUI();
      return false;
    }
    notebookStatus = '새 이야기를 읽는 중';
    notebookError='';
    if(uiOpen)renderUI();
    const lastTargetKey = targetKey(target);
    try {
      // Risu may publish the output event just before persisting the message.
      // Wait briefly for the accepted chat snapshot rather than recording uncommitted text.
      let chat = null;
      let rows = [];
      let saved = index < 0;
      for (let retry=0; retry<5; retry++) {
        chat = await risuai.getChatFromIndex(target.characterIndex,target.chatIndex);
        rows = Array.isArray(chat && chat.message) ? chat.message : [];
        if(index < 0 || (rows[index] && text(rows[index].data).trim()===source)) {saved=true;break;}
        await new Promise(resolve=>setTimeout(resolve,200));
      }
      if(!saved) {notebookStatus='대화 저장 확인 대기';return false;}
      if(index>=0 && rows[index] && rows[index].role!=='char' && rows[index].role!=='assistant')return false;
      const recentUser = rows.slice(0,Math.max(0,index)).filter(x=>x && x.role==='user' && text(x.data).trim()).slice(-1);
      const messages = [
        {role:'system',content:[
          'You are a CONTINUITY READER, not a writer or planner. Analyze one ACTUALLY SAVED assistant story output.',
          'Return a single valid JSON object with: summary,scene,lastEvent,nextPressure,groundedEvents,characters,openThreads,needsUserDecision,beatProgress.',
          'beatProgress: optional [{beatId:string,completionEvidence:string}] ONLY for fully completed outlined scene beats, not partial progress. completionEvidence must be an EXACT quote from the accepted assistant output. No quote, no completion. Never treat proposed plans as events.',
          'summary: concise rolling Korean summary of actual story facts (up to 850 Korean chars), preserving key facts from previous summary unless contradicted by this actual output.',
          'scene: exact current location/action at the END, not an old plot draft. lastEvent: specific final actual action.',
          'nextPressure: at most one immediately plausible next move; mark this as a POSSIBILITY, never an event that happened.',
          'groundedEvents: max 4 objects {fact:string,evidence:string}. evidence MUST be an exact short substring copied from the supplied output. If there is no durable factual event, return [] instead of inventing one.',
          'sceneEvidence: exact quote from acceptedAssistantText proving any proposed NEW scene. lastEventEvidence: exact quote proving proposed NEW lastEvent.',
          'characters: up to 10 entries {name:string,state:string,knows:string,evidence:string}. evidence MUST be an exact quote supporting that character state/knowledge change.',
          'openThreads: up to 8 objects {text:string,evidence:string} for unresolved questions; quote exact accepted text that establishes them. Never label plans as established events.',
          'needsUserDecision: true only if the NEXT natural beat requires a consequential USER decision; otherwise false.',
          'NO future scene writing, NO new roles, NO cast identity guesses, NO rewriting the source, NO Mutation rule creation.',
          'If the accepted output disagrees with an older outline, the accepted output wins. Never turn an unfulfilled plan into a completed fact.',
          'Return all narrative fields in Korean. Strict JSON only.'
        ].join('\n')},
        {role:'user',content:JSON.stringify({
          previousAcceptedNotebook: previous.version===2 && previous.confidence==='checked' && previous.lastProcessedAt ? {
            summary:previous.summary,scene:previous.scene,characters:previous.characters,
            openThreads:previous.openThreads,groundedEvents:previous.groundedEvents.slice(-6)
          } : null,
          latestUserInput:recentUser.length?text(recentUser[0].data).slice(-2200):'',
          activeFutureBeats:blueprintBeats().filter(x=>x.beat.status==='planned').slice(0,6).map(x=>({beatId:x.beat.id,title:x.beat.title,description:x.beat.description})),
          acceptedAssistantText:source.length>16000 ? source.slice(0,1200)+'\n[중간 생략]\n'+source.slice(-14800) : source,
        })}
      ];
      const result = await runInternalLLM({messages,mode:'otherAx',allowPlugins:false});
      const raw = extractModelText(result);
      if(!raw.trim()) throw new Error('보조 모델이 분석 결과를 반환하지 않았어.');
      const data = extractJson(raw);
      const verified = (Array.isArray(data.groundedEvents)?data.groundedEvents:[]).slice(0,4)
        .map(x=>({fact:text(x&&x.fact).trim().slice(0,340),evidence:text(x&&x.evidence).trim().slice(0,160),key:signature}))
        .filter(x=>x.fact && x.evidence.length>=6 && source.includes(x.evidence));
      // v0.93: Evidence for an EVENT does not automatically prove every other
      // free-text field. Build durable memory from grounded quotes only.
      const old = previous.version===2 && previous.confidence==='checked' ? previous : emptyStoryNotebook();
      const sceneQuote=text(data.sceneEvidence).trim();
      const lastQuote=text(data.lastEventEvidence).trim();
      const groundedCharacters=(Array.isArray(data.characters)?data.characters:[])
        .filter(x=>x&&text(x.evidence).trim()&&text(x.evidence).trim().length>=6&&source.includes(text(x.evidence).trim()))
        .map(x=>({name:text(x.name),state:text(x.state),knows:text(x.knows)}));
      const charactersByName=new Map(old.characters.map(c=>[c.name,c]));
      for(const c of groundedCharacters)if(c.name&&c.state)charactersByName.set(c.name,c);
      const groundedThreads=(Array.isArray(data.openThreads)?data.openThreads:[])
        .filter(x=>x&&typeof x==='object'&&text(x.evidence).trim()&&text(x.evidence).trim().length>=6&&source.includes(text(x.evidence).trim()))
        .map(x=>text(x.text).trim()).filter(Boolean);
      const hasGrounding=verified.length||groundedCharacters.length||groundedThreads.length
        || (sceneQuote.length>=6&&source.includes(sceneQuote)) || (lastQuote.length>=6&&source.includes(lastQuote));
      const next = normalizeStoryNotebook({
        version:2,
        // This summary is accumulated only from individually quoted event facts.
        summary:[old.summary,...verified.map(x=>x.fact)].filter(Boolean).join(' / ').slice(-1800),
        scene:sceneQuote.length>=6&&source.includes(sceneQuote)?text(data.scene).trim():old.scene,
        lastEvent:lastQuote.length>=6&&source.includes(lastQuote)?text(data.lastEvent).trim():old.lastEvent,
        nextPressure:hasGrounding?text(data.nextPressure).trim():'',
        groundedEvents:old.groundedEvents.concat(verified).slice(-16),
        characters:Array.from(charactersByName.values()).slice(0,16),
        openThreads:[...old.openThreads,...groundedThreads].slice(-12),
        needsUserDecision:hasGrounding&&data.needsUserDecision===true,
        lastProcessedKey:signature,
        lastProcessedAt:Date.now(),
        analyzedCount:old.analyzedCount+(hasGrounding?1:0),
        confidence:hasGrounding||old.lastProcessedAt?'checked':'unverified',
      });
      // Ignore a model response if the user switched chats or edited/deleted the analyzed output.
      if(targetKey(currentTarget)!==lastTargetKey) return false;
      const nowChat=await risuai.getChatFromIndex(target.characterIndex,target.chatIndex);
      const nowRows=Array.isArray(nowChat&&nowChat.message)?nowChat.message:[];
      if(index>=0 && (!nowRows[index]||text(nowRows[index].data).trim()!==source)) return false;
      project.storyNotebook=next;
      // Only a verified quote from this SAVED, quality-approved output may complete a
      // future beat. Incomplete, speculative or inferred events cannot advance the plan.
      const progress=Array.isArray(data.beatProgress)?data.beatProgress:[];
      const bp=normalizeStoryBlueprint(project.storyBlueprint);
      let changed=false;
      let lastDoneId='';
      for(const row of progress.slice(0,5)) {
        const id=text(row&&row.beatId);
        const proof=text(row&&row.completionEvidence).trim();
        if (!id || proof.length<8 || !source.includes(proof))continue;
        const target=bp.sections.flatMap(x=>x.beats).find(x=>x.id===id&&x.status==='planned');
        if(!target)continue;
        target.status='done';target.evidence=proof.slice(0,180);
        lastDoneId=id;changed=true;
      }
      if(changed) {
        const all=bp.sections.flatMap(x=>x.beats);
        const oldFocus=text(project.blueprintFocusId);
        const active=all.find(x=>x.id===oldFocus);
        if(!active || active.status!=='planned') {
          const from=Math.max(0,all.findIndex(x=>x.id===lastDoneId));
          const after=all.slice(from+1).find(x=>x.status==='planned');
          project.blueprintFocusId=(after||all.find(x=>x.status==='planned'))?.id||'';
        }
        bp.updatedAt=Math.max(Date.now(),bp.updatedAt+1);
        project.storyBlueprint=bp;
      }
      await saveProject();
      notebookStatus=hasGrounding?'확인된 사실만 기억에 반영':'확정할 새 사실 없음 · 추정 메모 차단';
      notebookError='';
      if(uiOpen)renderUI();
      return true;
    } catch(error) {
      notebookError=error&&error.message?error.message:String(error);
      notebookStatus='분석 대기 · 원본 채팅은 그대로 유지';
      console.log('[StoryRunner] notebook analysis skipped',error);
      if(uiOpen)renderUI();
      return false;
    }
  }

  function queueStoryInspection(content,target,messageIndex,force) {
    const key=targetKey(target);
    if(!key||!text(content).trim()||(!force && project.modernTrackingEnabled===false)) return Promise.resolve(false);
    const last=notebookQueues.get(key)||Promise.resolve();
    const task=last.catch(()=>false).then(()=>inspectActualAcceptedStory(content,target,messageIndex,force));
    notebookQueues.set(key,task);
    void task.finally(()=>{if(notebookQueues.get(key)===task)notebookQueues.delete(key);});
    return task;
  }

  async function refreshModernNotebook(force) {
    await requireTarget();
    const live = await loadModernLivePreview();
    if(!live) {notebookStatus='아직 생성된 대화가 없어';if(uiOpen)renderUI();return false;}
    const target={...currentTarget};
    return await queueStoryInspection(live.content,target,live.messageIndex,force===true);
  }

  function modernEpisodeSummary() {
    const outline=project.planningOutline;
    const items=outline&&Array.isArray(outline.episodes)?outline.episodes:[];
    if(!items.length) return '';
    return '<div class="m-episodes">'+items.slice(0,3).map((ep,i)=>
      '<div class="m-ep"><span class="m-ep-num">'+escapeHtml(text(ep.number)||String(i+1))+'</span><div><strong>'+escapeHtml(ep.title)+'</strong>'+
      (ep.purpose?'<p>'+escapeHtml(ep.purpose)+'</p>':'')+'</div></div>'
    ).join('')+'</div>';
  }

  function modernCoreStatus() {
    const active=aiTask&&aiTask.active?text(aiTask.label):modernBusy;
    if(active)return '<span class="m-status busy"><span class="m-pulse"></span>'+escapeHtml(active)+'</span>';
    if(project.running&&project.autoRun&&!project.paused)return '<span class="m-status running">연속 생성 중</span>';
    if(project.paused&&normalizeStoryNotebook(project.storyNotebook).needsUserDecision)return '<span class="m-status">선택 대기</span>';
    if(notebookStatus.includes('읽는 중'))return '<span class="m-status busy"><span class="m-pulse"></span>대화 분석 중</span>';
    const staleLegacyRecheck = project.lastStatus==='failed' && text(project.lastReason).startsWith('본문 품질 검사 실패 (이전 대화 재검사)');
    return '<span class="m-status">'+escapeHtml(project.lastStatus==='failed'&&!staleLegacyRecheck?'확인 필요':project.experienceMode==='direct'?'직접 진행':'준비됨')+'</span>';
  }

  function renderModernUI() {
    if(!uiOpen)return;
    const noTarget=!currentTarget;
    const aiMode=project.experienceMode==='ai';
    const book=normalizeStoryNotebook(project.storyNotebook);
    const planned=!!(project.planningOutline&&Array.isArray(project.planningOutline.episodes)&&project.planningOutline.episodes.length);
    const executable=project.nodes.length>0 && !destinationReached();
    const canRun=!noTarget&&!modernBusy&&!storyStudioBusy&&!(aiTask&&aiTask.active)&&!planningBusy;
    const runEpisode=effectiveCurrentEpisode(project.planningOutline);
    const quality=text(project.writerQualityMode)||'strong';
    const trustedBook=book.version===2 && book.confidence==='checked' && book.lastProcessedAt;
    const preview=trustedBook ? (book.lastEvent||book.scene||book.summary) : modernLivePreview;
    const title= currentTarget ? [text(currentTarget.characterName),text(currentTarget.chatName)].filter(Boolean).join(' / ') : '채팅을 먼저 열어줘';
    const notice = noTarget ? '캐릭터 채팅을 연 뒤 이용할 수 있어.' : (trustedBook ? '실제 저장된 대화의 확인된 사실을 반영했어.' : '기존 기억은 검증되지 않았어. 최신 대화를 확인해 줘.');
    const busy=!!modernBusy||storyStudioBusy||!!(aiTask&&aiTask.active)||planningBusy||planningChatBusy;
    const suggestions=Array.isArray(project.nextEpisodeChoices)?project.nextEpisodeChoices:[];
    const hasBlueprint=normalizeStoryBlueprint(project.storyBlueprint).sections.length>0;
    const events=(book.version===2 && book.confidence==='checked'?book.groundedEvents:[]).slice(-3).reverse();
    const planReady=planned && !project.planningLocked;
    const followUpLabel=executable?'이어서 한 장면 쓰기':(planned?'설계 확정하고 집필하기':'이야기 설계부터 시작');
    const storyPanel='<section class="m-surface m-story" aria-label="현재 이야기"><div class="m-cardtop"><h2>현재 이야기</h2><span class="m-muted">'+modernLiveCount+'개 대화</span></div>'+
      '<div class="m-story-text">'+escapeHtml(preview||'아직 읽은 내용이 없어. 새 채팅을 시작하거나 AI에게 이야기를 맡길 수 있어.')+'</div>'+
      '<div class="m-story-foot"><span>'+escapeHtml(notice)+'</span><button id="m-rescan" class="m-link"'+(busy||noTarget?' disabled':'')+'>↻ 다시 읽기</button></div></section>';
    const notebookPanel='<details class="m-details" id="m-book"><summary>이야기 기억 <span>'+ (book.lastProcessedAt && book.version===2 && book.confidence==='checked' ? (book.analyzedCount+'회 반영'):'검증 대기') +'</span></summary><div class="m-detailbody">'+
       (book.version!==2?'<p class="m-warn">이전 버전의 기억은 검증 전 기록이므로 생성에 사용하지 않아. 필요하면 아래에서 초기화해.</p>':'')+
       (book.version===2&&book.confidence==='checked'&&book.summary?'<p><b>줄거리</b> '+escapeHtml(book.summary)+'</p>':'<p class="m-muted">새로 검증한 실제 대화만 기록해.</p>')+
       (events.length?'<p><b>확인된 변화</b></p><ul>'+events.map(e=>'<li>'+escapeHtml(e.fact)+'</li>').join('')+'</ul>':'')+
       (book.version===2&&book.confidence==='checked'&&book.openThreads.length?'<p><b>아직 해결되지 않은 일</b></p><ul>'+book.openThreads.slice(0,5).map(e=>'<li>'+escapeHtml(e)+'</li>').join('')+'</ul>':'')+
       (book.version===2&&book.confidence==='checked'&&book.characters.length?'<p><b>인물별 상태</b></p><ul>'+book.characters.slice(0,7).map(c=>'<li>'+escapeHtml(c.name)+' — '+escapeHtml(c.state)+'</li>').join('')+'</ul>':'')+
       (book.version===2&&book.confidence==='checked'&&book.needsUserDecision?'<p><b>선택이 필요한 지점</b> · 직접 채팅으로 선택하거나 AI에게 새 방향을 알려줘.</p>':'')+
       (notebookError?'<p class="m-warn">분석 오류: '+escapeHtml(notebookError)+'</p>':'')+
      '<label class="m-track"><input type="checkbox" id="m-track"'+(project.modernTrackingEnabled!==false?' checked':'')+'> 생성 후 실제 대화 자동 읽기</label><button type="button" class="m-textbtn" id="m-reset-book">검증되지 않은 이야기 기억 초기화</button></div></details>';
    const selector='<nav class="m-switch" aria-label="진행 방식"><button type="button" id="m-direct" class="'+(!aiMode?'selected':'')+'">✎ 직접 진행</button><button type="button" id="m-ai" class="'+(aiMode?'selected':'')+'">✦ AI 진행</button></nav>';
    const directPanel='<div class="m-mainbody">'+
      '<div class="m-lede"><div class="m-round">✎</div><div><h2>이야기는 네가 진행해</h2><p>설정과 로어북을 그대로 사용해. 화별 계획이나 지시문을 따로 만들 필요 없어.</p></div></div>'+
      '<div class="m-features"><div><strong>직접 채팅</strong><p>평소처럼 입력하고 응답을 받아.</p></div><div><strong>자동 기록</strong><p>새로 나온 이야기를 읽고 사실·관계·미해결 일을 갱신해.</p></div></div>'+
      '<details id="m-setup-details" class="m-details"'+(modernStorySetupExpanded?' open':'')+'><summary>이 작품 설정 더하기 <span>필요할 때만</span></summary><div class="m-detailbody">'+
      '<p>캐릭터 설정·관계·배경을 자유롭게 적어줘. 이 채팅에만 저장되고 직접 채팅과 AI 집필에서 함께 참고해. Mutation의 카드/Lorebook은 변경하지 않아.</p>'+
      '<textarea id="m-story-setup" rows="8" maxlength="30000" placeholder="이야기의 배경, 인물, 비밀, 아직 발생하지 않은 설정 등을 붙여넣기">'+escapeHtml(project.modernStorySetup||'')+'</textarea>'+
      '<p class="m-muted">여기에 쓴 설정은 실제 사건으로 확정되지 않아. 사건은 생성된 대화에서 따로 기록해.</p></div></details>'+
      '<button type="button" id="m-close-main" class="m-primary m-big"'+(noTarget?' disabled':'')+'>채팅으로 돌아가기 <span>↗</span></button>'+
      '<button type="button" id="m-help-story" class="m-textbtn">막힐 땐 AI에게 다음 전개 맡기기 →</button></div>';
    const qualityHtml='<div class="m-sectiontop"><h3>집필 품질</h3><span>전개 속도와는 별개</span></div><div class="m-quality" role="group" aria-label="집필 품질">'+
      [['basic','빠르게','도입·연결 장면'],['strong','균형','일반 집필'],['max','정성껏','설계·검수·수정']].map(([id,label,desc])=>
      '<button type="button" class="m-q '+(quality===id?'selected':'')+'" data-quality="'+id+'"'+(busy?' disabled':'')+'><strong>'+label+'</strong><small>'+desc+'</small></button>').join('')+'</div>';
    const directorPanel='<div class="m-mainbody">'+
      '<div class="m-lede"><div class="m-round m-star">✦</div><div><h2>AI가 이야기 설계와 집필을 도와줘</h2><p>생각나는 장면만 짧게 말하고 AI 제안을 고쳐가며 확정한 뒤 집필해.</p></div></div>'+
      storyStudioHtml()+
      futureBeatEditorHtml()+
      '<details class="m-details" id="m-direct-last"><summary>집필 직전에만 방향 추가 <span>선택 사항</span></summary><div class="m-detailbody">'+
      '<label class="m-label" for="m-direction">한 줄 집필 지시</label>'+
      '<textarea id="m-direction" rows="2" placeholder="예: 다음 장면은 대사 위주로, 설명은 줄여줘.">'+escapeHtml(project.modernDirection)+'</textarea>'+
      '</div></details>'+
      (hasBlueprint?'<details class="m-details" id="m-near-plan-toggle"><summary>세부 설계 조정 <span>필요할 때만</span></summary>':'')+
      '<div class="m-plan-actions"><button id="m-plan" class="m-outline"'+(!canRun?' disabled':'')+'>'+(planned?'↻ 가까운 전개 다시 짜기':'✦ 가까운 전개 설계')+'</button>'+
      '<button id="m-suggest" class="m-textbtn"'+(!canRun?' disabled':'')+'>전개 추천 3개</button></div>'+
      (hasBlueprint?'</details>':'')+
      (nextEpisodeBusy?'<p class="m-muted">새로운 방향을 살펴보는 중…</p>':'')+
      (nextEpisodeError?'<p class="m-warn">'+escapeHtml(nextEpisodeError)+'</p>':'')+
      (modernShowSuggestions && suggestions.length?'<div class="m-suggestions">'+suggestions.slice(0,3).map((s,i)=>'<button class="m-suggestion" data-choice="'+i+'"><b>'+String.fromCharCode(65+i)+'. '+escapeHtml(s.title)+'</b><span>'+escapeHtml(s.premise)+'</span><small>이 방향 사용 →</small></button>').join('')+'</div>':'')+
      (planned?'<div class="m-plan">'+(hasBlueprint?'<details class="m-details"><summary>가까운 3화 실행 계획 <span>'+(executable?'준비됨':'설계 완료')+'</span></summary><div class="m-detailbody">':'<div class="m-sectiontop"><h3>AI 설계안</h3><span>'+(executable?'실행 준비됨':planReady?'설계 완료':'현재 계획')+'</span></div>')+modernEpisodeSummary()+
        '<details class="m-details"><summary>자세한 설계 보기 <span>필요할 때만</span></summary><div class="m-detailbody">'+(project.planningOutline.summary?'<p>'+escapeHtml(project.planningOutline.summary)+'</p>':'')+
        (Array.isArray(project.planningOutline.episodes)?project.planningOutline.episodes.map(ep=>'<p><b>'+escapeHtml(ep.title)+'</b> '+escapeHtml(ep.startCondition||'')+'</p>').join(''):'')+'</div></details>'+(hasBlueprint?'</div></details>':'')+'</div>':'')+
      '<div class="m-runpanel">'+qualityHtml+
      '<div class="m-actions"><button id="m-write-one" class="m-primary m-big"'+(!canRun?' disabled':'')+'>'+(busy?'처리 중…':followUpLabel)+' <span>→</span></button>'+
      (project.running&&project.autoRun&&!project.paused?'<button id="m-pause" class="m-outline">■ 멈추기</button>':'<button id="m-write-auto" class="m-outline"'+(!canRun?' disabled':'')+'>↻ 연속 진행</button>')+'</div>'+
      '<p class="m-help">작성한 본문은 실제 채팅에 저장해. 다음 생성 전에는 그 결과를 읽고 이어서 진행해.</p></div></div>';
    const css=`<style>
      :root{color-scheme:dark;--bg:#111622;--sheet:#171e2c;--panel:#20283a;--edge:#35425b;--text:#eaf0ff;--sub:#9eabc4;--accent:#7187e9;--acBg:#3b4c91;--warn:#ffb5ba}
      *{box-sizing:border-box}html,body{margin:0;min-height:100%;background:var(--bg);color:var(--text);font-family:Inter,Pretendard,'Noto Sans KR',system-ui,sans-serif;line-height:1.54}
      button,textarea{font:inherit}button{cursor:pointer;color:inherit}button:disabled{opacity:.48;cursor:not-allowed}
      button:focus-visible,textarea:focus-visible,summary:focus-visible{outline:2px solid #b6c4ff;outline-offset:2px}
      .m-studio{border:1px solid #4b5e93;border-radius:14px;padding:14px;margin:0 0 17px;background:#202b42}
      .m-studio .m-muted{font-size:12px;line-height:1.58;color:#b5c1db;margin:6px 0 12px}
      #m-studio-input{width:100%;min-height:78px;padding:11px 12px;border:1px solid #4b5d85;background:#121827;border-radius:10px;color:var(--text);resize:vertical;font-size:14px;line-height:1.55}
      .m-studio-talk{display:block;width:100%;min-height:43px;padding:10px;margin-top:9px}
      .m-studio-log{display:grid;gap:8px;max-height:280px;overflow:auto;margin:12px 0;padding:2px}
      .m-studio-bubble{max-width:95%;padding:10px 12px;border-radius:10px;border:1px solid #405174;background:#182237;white-space:pre-wrap;overflow-wrap:anywhere}
      .m-studio-bubble.from-user{justify-self:end;background:#2f4064}
      .m-studio-bubble small{color:#b8caff;font-weight:700;font-size:10px}.m-studio-bubble p{font-size:13px;margin:4px 0 0;line-height:1.55}
      .m-studio-draft{border-top:1px solid #53648b;padding:14px 0 0;margin-top:13px}.m-studio-draft .m-sectiontop{margin-bottom:5px}
      .m-studio-draft .m-detailbody ul{padding-left:19px}.m-studio-draft .m-detailbody li{font-size:12px;margin-bottom:5px}
      .m-studio-question{border-left:3px solid #a8b8ed;padding:8px 10px;margin:8px 0 5px;background:#293754;border-radius:6px}
      .m-studio-question b{font-size:12px}.m-studio-question p{margin:3px 0 0;font-size:13px}
      .m-studio-suggestions{display:flex;flex-wrap:wrap;gap:4px;margin:5px 0 10px}.m-studio-suggestions button{font-size:12px;border:1px solid #51618c;border-radius:15px;padding:6px 10px}
      .m-studio-accept{display:grid;grid-template-columns:1.4fr 1fr;gap:8px;margin-top:12px}
      .m-studio-accept button{min-height:43px;padding:10px 8px;font-size:13px}
      @media(max-width:420px){.m-studio-accept{grid-template-columns:1fr}}
      .m-blueprint{border:1px solid var(--edge);border-radius:14px;padding:14px;margin:0 0 20px;background:#182236}
      .m-blueprint .m-sectiontop{margin:0 0 8px}.m-blueprint .m-muted{font-size:13px;margin:5px 0}
      .m-board-actions{display:flex;flex-wrap:wrap;gap:8px;margin:10px 0}
      .m-board-utilities{margin-top:10px;border-top:1px solid #3b4967;padding-top:10px}
      .m-board-utilities summary{cursor:pointer;font-size:12px;color:#adbbd8}.m-board-utilities summary span{color:#8895b4}.m-board-utilities .m-label{margin-top:10px}
      .m-board-details{border-top:1px solid var(--edge);padding:12px 0;margin-top:10px}
      .m-board-details summary{cursor:pointer;font-weight:750;font-size:14px}
      .m-arc{margin:10px 0;padding:12px;border:1px solid #3b4967;border-radius:11px;background:#1b2638}
      .m-arc-head{display:flex;flex-direction:column;gap:2px;cursor:pointer;padding:3px 0}
      .m-arc-head strong{font-size:14px}.m-arc-head small{color:var(--sub)}.m-arc-head span{color:#9fb4e8;font-size:11px}.m-arc-content{padding-top:8px}
      .m-beat-row{margin:6px 0;border-radius:9px;border:1px solid #3b4967;overflow:hidden}
      .m-beat-row.focused{border-color:#8ba2fa}
      .m-beat-pick{display:flex;width:100%;align-items:flex-start;gap:7px;text-align:left;padding:10px;background:transparent;border:0;flex-wrap:wrap}
      .m-beat-pick span{font-size:11px;white-space:nowrap;color:#adbee5}
      .m-beat-pick strong{font-size:13px;flex:1;min-width:80px}
      .m-beat-pick small{color:var(--sub);font-size:12px;flex-basis:100%}
      .m-beat-editor{padding:10px;background:#131d30}.m-beat-editor label{font-size:12px;display:block;margin:8px 0 3px}
      .m-beat-editor input,.m-beat-editor textarea{width:100%;padding:9px;background:#101827;border:1px solid #4a5a7a;border-radius:7px;color:var(--text)}
      .m-beat-buttons{display:flex;gap:6px;flex-wrap:wrap;margin-top:8px}.m-beat-buttons button{min-width:40px}
      .m-blueprint #m-board-request{margin:7px 0 8px}
      .m-shell{max-width:1120px;margin:0 auto;padding:24px 26px 70px}.m-head{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:22px}
      .m-brand{display:flex;align-items:center;gap:12px}.m-logo{width:41px;height:41px;display:grid;place-items:center;border-radius:12px;background:#334373;color:#dfe7ff;font-weight:900;font-size:23px}
      .m-head h1{font-size:20px;font-weight:800;letter-spacing:-.4px;margin:0}.m-head p{font-size:12px;margin:2px 0 0;color:var(--sub);white-space:nowrap;max-width:48vw;overflow:hidden;text-overflow:ellipsis}
      .m-head-actions{display:flex;gap:8px}.m-ghost{border:1px solid var(--edge);background:#252e42;border-radius:10px;padding:9px 14px;min-width:60px;font-size:13px}
      .m-switch{display:grid;grid-template-columns:1fr 1fr;gap:4px;background:#202839;border:1px solid var(--edge);padding:5px;border-radius:13px;margin-bottom:18px}
      .m-switch button{border:0;background:transparent;border-radius:9px;padding:13px 12px;font-weight:800;font-size:15px;color:#9caac5}
      .m-switch button.selected{background:var(--acBg);box-shadow:0 2px 12px #1015238a;color:white}
      .m-layout{display:grid;grid-template-columns:minmax(0,1.65fr) minmax(280px,1fr);align-items:start;gap:18px}
      .m-primary-surface,.m-surface{background:var(--sheet);border:1px solid var(--edge);border-radius:16px;overflow:hidden}
      .m-mainbody{padding:25px 25px 23px}.m-lede{display:flex;gap:13px;align-items:flex-start;margin-bottom:23px}.m-round{width:42px;height:42px;display:grid;place-items:center;border-radius:14px;background:#2d3a52;color:#cedaff;font-size:22px;flex-shrink:0}
      .m-round.m-star{background:#303c77;color:#dce5ff}.m-lede h2{font-size:19px;margin:0 0 5px;line-height:1.35}.m-lede p{color:var(--sub);font-size:13px;margin:0}
      .m-label{font-size:13px;font-weight:800;display:flex;justify-content:space-between;margin:0 0 8px}.m-label span{font-weight:400;color:var(--sub)}
      #m-direction{width:100%;min-height:106px;padding:13px 14px;border:1px solid var(--edge);border-radius:10px;background:#121827;color:var(--text);font-size:14px;resize:vertical;line-height:1.7}
      #m-direction::placeholder{color:#7e8aa3}.m-plan-actions{display:flex;gap:10px;align-items:center;margin:12px 0 20px;flex-wrap:wrap}
      .m-outline{border:1px solid #536283;background:#2a344d;padding:11px 17px;border-radius:10px;font-weight:750;font-size:13px}
      .m-textbtn,.m-link{border:0;background:transparent;color:#b7c8ff;text-align:left;padding:8px 4px;font-weight:650;font-size:13px}
      .m-primary{background:#536ed1;border:1px solid #6983f1;border-radius:11px;font-weight:800;color:white;box-shadow:0 5px 16px #13194466}
      .m-big{padding:15px 18px;display:flex;justify-content:center;align-items:center;gap:14px;width:100%;font-size:15px}.m-big span{font-size:18px}
      .m-sectiontop{display:flex;align-items:center;justify-content:space-between;margin:0 0 11px}.m-sectiontop h3{font-size:14px;margin:0}.m-sectiontop span{font-size:11px;color:var(--sub)}
      .m-runpanel{margin-top:17px;padding-top:20px;border-top:1px solid var(--edge)}.m-quality{display:grid;grid-template-columns:repeat(3,1fr);gap:8px}
      .m-q{background:#222b3e;border:1px solid var(--edge);border-radius:10px;padding:11px 5px;display:flex;flex-direction:column;align-items:center;gap:2px}
      .m-q.selected{background:#344572;border-color:#8297fa}.m-q strong{font-size:13px}.m-q small{font-size:11px;color:var(--sub)}.m-q.selected small{color:#d5ddf4}
      .m-actions{display:grid;grid-template-columns:1.45fr 1fr;gap:8px;margin-top:18px}.m-actions .m-outline{font-size:14px}
      #m-story-setup{width:100%;min-height:160px;background:#111827;border:1px solid var(--edge);border-radius:10px;padding:12px;resize:vertical;color:var(--text);line-height:1.7;font-size:13px}
      .m-track{font-size:12px;color:var(--sub);display:flex;align-items:center;gap:8px;margin-top:12px}
      .m-track input{accent-color:#7187e9}
      .m-help{font-size:11px;color:var(--sub);margin:10px 0 0}.m-plan{border-top:1px solid var(--edge);padding-top:18px;margin-top:20px}
      .m-episodes{display:flex;flex-direction:column;gap:7px}.m-ep{display:flex;gap:11px;padding:10px 12px;background:#202a3e;border-radius:9px;align-items:start}
      .m-ep-num{background:#354878;color:#dbe5ff;border-radius:6px;padding:1px 7px;font-weight:800;font-size:11px;white-space:nowrap;margin-top:1px}
      .m-ep strong{font-size:13px}.m-ep p{font-size:12px;color:var(--sub);margin:4px 0 0}
      .m-surface{padding:19px}.m-cardtop{display:flex;justify-content:space-between;align-items:center;gap:8px;margin-bottom:12px}.m-cardtop h2{font-size:15px;margin:0}
      .m-muted{font-size:12px;color:var(--sub)}.m-story-text{font-size:13px;line-height:1.75;white-space:pre-wrap;overflow-wrap:anywhere;max-height:235px;overflow:auto}
      .m-story-foot{display:flex;justify-content:space-between;align-items:center;gap:8px;border-top:1px solid var(--edge);margin-top:15px;padding-top:12px;font-size:11px;color:var(--sub)}
      .m-story-foot span{flex:1}.m-story-foot button{white-space:nowrap}.m-details{border:1px solid var(--edge);border-radius:11px;margin-top:12px;overflow:hidden;background:#1c2536}
      .m-details summary{padding:13px 15px;cursor:pointer;font-size:13px;font-weight:800;display:flex;align-items:center;justify-content:space-between;gap:8px}
      .m-details summary span{font-size:11px;color:var(--sub);font-weight:450}.m-detailbody{padding:4px 15px 15px;font-size:12px;color:#cbd6ed;line-height:1.7}
      .m-detailbody p{margin:6px 0 12px}.m-detailbody li{margin-bottom:5px}.m-detailbody ul{padding-left:21px;margin:3px 0 12px}
      .m-suggestions{display:grid;gap:8px;margin:10px 0 20px}.m-suggestion{text-align:left;background:#243047;border:1px solid #4a5a80;border-radius:10px;padding:11px 13px;display:flex;flex-direction:column;gap:4px}
      .m-suggestion b{font-size:13px}.m-suggestion span{font-size:12px;color:#d2dbef}.m-suggestion small{color:#bdcaff}
      .m-status{background:#293345;color:#b7c5dc;border-radius:999px;padding:5px 9px;font-size:11px;display:inline-flex;gap:6px;align-items:center;white-space:nowrap}
      .m-status.busy{background:#373e62;color:#e7eaff}.m-status.running{background:#2d4d47;color:#c5f1e6}.m-pulse{width:7px;height:7px;background:#aebcff;border-radius:99px;animation:mblink 1.2s infinite}
      @keyframes mblink{50%{opacity:.2}}.m-statusline{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:11px;font-size:12px;color:var(--sub)}
      .m-features{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin:0 0 24px}.m-features div{padding:15px;border:1px solid var(--edge);border-radius:10px;background:#202a3b}
      .m-features strong{font-size:13px}.m-features p{font-size:12px;line-height:1.6;margin:5px 0 0;color:var(--sub)}
      .m-warn{font-size:12px;color:var(--warn);background:#3c2935;padding:9px 12px;border-radius:8px;white-space:pre-wrap;overflow-wrap:anywhere}
      .m-footer{font-size:11px;color:#8595b4;margin-top:20px;text-align:center}
      @media(max-width:850px){.m-shell{padding:14px 13px 44px}.m-layout{grid-template-columns:1fr}.m-story{order:-1}.m-mainbody{padding:19px 16px}.m-head h1{font-size:18px}.m-head p{max-width:58vw}.m-actions{grid-template-columns:1.25fr 1fr}}
      @media(max-width:420px){.m-q small{font-size:10px}.m-actions{grid-template-columns:1fr}.m-features{grid-template-columns:1fr}}
      @media(prefers-reduced-motion:reduce){.m-pulse{animation:none}}
    </style>`;
    document.body.innerHTML=css+'<main class="m-shell"><header class="m-head"><div class="m-brand"><div class="m-logo">S</div><div><h1>Story Runner <span class="m-muted">v'+VERSION+'</span></h1><p>'+escapeHtml(title)+'</p></div></div><div class="m-head-actions"><button class="m-ghost" id="m-advanced">고급</button><button class="m-ghost" id="m-close">닫기</button></div></header>'+
       selector+'<div class="m-statusline"><span>'+ (aiMode?'AI 디렉터 → 집필 → 결과 분석':'직접 채팅 → 결과 자동 기록') +'</span>'+modernCoreStatus()+'</div>'+
       (lastError?'<div class="m-warn" role="alert">'+escapeHtml(lastError)+'</div>':'')+
       (lastError&&(/본문|검수|생성/.test(lastError))?'<details class="m-details" id="m-diagnostic"><summary>원인 확인 · 메인 모델 단문 테스트 <span>채팅 저장 없음</span></summary><div class="m-detailbody"><p class="m-muted">같은 메인 모델에 짧은 한국어 문장만 요청하여 문맥 중복 문제인지 모델 자체 문제인지 구분할 단서를 확인해.</p><button type="button" id="m-diagnose-writer" class="m-outline"'+(mainWriterDiagnosticBusy?' disabled':'')+'>메인 모델 단문 테스트</button>'+(mainWriterDiagnostic?'<p class="m-muted" style="white-space:pre-wrap;overflow-wrap:anywhere">'+escapeHtml(mainWriterDiagnostic)+'</p>':'')+'</div></details>':'')+

       (project.paused&&!lastError&&text(project.lastReason)&&!text(project.lastReason).startsWith('본문 품질 검사 실패 (이전 대화 재검사)')?'<div class="m-warn">'+escapeHtml(project.lastReason)+'</div>':'')+
       '<div class="m-layout"><section class="m-primary-surface">'+(aiMode?directorPanel:directPanel)+'</section><aside>'+storyPanel+notebookPanel+'</aside></div>'+
       '<div class="m-footer">설계와 집필은 Story Runner · 세계관과 Lorebook은 Mutation / Risu에서 관리</div></main>';
    const $=(id)=>document.getElementById(id);
    const doUi=(fn)=>async()=>{try{lastError='';await fn();}catch(e){lastError=e&&e.message?e.message:String(e);renderUI();}};
    $('m-close').onclick=doUi(async()=>{uiOpen=false;stopTargetWatch();await risuai.hideContainer();});
    $('m-advanced').onclick=()=>{modernAdvanced=true;uiTab='director';renderUI();};
    const diag=$('m-diagnose-writer');if(diag)diag.onclick=()=>{void diagnoseMainWriterOutput();};
    $('m-direct').onclick=doUi(async()=>{
      if(project.running)await pauseRunner();
      project.experienceMode='direct';project.modernContinuous=false;
      await saveProject();renderUI();
    });
    $('m-ai').onclick=doUi(async()=>{project.experienceMode='ai';await saveProject();renderUI();});
    $('m-rescan').onclick=doUi(async()=>{await refreshModernNotebook(true);});
    const resetBook=$('m-reset-book');if(resetBook)resetBook.onclick=doUi(async()=>{project.storyNotebook=emptyStoryNotebook();notebookStatus='이야기 기억 초기화 완료';notebookError='';await saveProject();renderUI();});
    const tr=$('m-track');if(tr)tr.onchange=doUi(async()=>{project.modernTrackingEnabled=tr.checked;await saveProject();renderUI();});
    if(!aiMode){
      const st=$('m-story-setup');if(st){
        st.oninput=()=>{project.modernStorySetup=st.value;};
        st.onchange=()=>{project.modernStorySetup=st.value;void saveProject();};
      }
      const sd=$('m-setup-details');if(sd)sd.ontoggle=()=>{modernStorySetupExpanded=sd.open;};
      $('m-close-main').onclick=doUi(async()=>{uiOpen=false;stopTargetWatch();await risuai.hideContainer();});
      $('m-help-story').onclick=doUi(async()=>{project.experienceMode='ai';await saveProject();renderUI();});
    } else {
      const studioInput=$('m-studio-input');if(studioInput){
        studioInput.oninput=()=>{const row=normalizeStoryStudio(project.storyStudio);project.storyStudio={...row,input:studioInput.value};};
        studioInput.onchange=()=>{const row=normalizeStoryStudio(project.storyStudio);project.storyStudio={...row,input:studioInput.value};void saveProject();};
      }
      const studioTalk=$('m-studio-talk');if(studioTalk)studioTalk.onclick=doUi(async()=>{
        const prompt=text($('m-studio-input')?.value).trim();
        await discussStoryBlueprint(prompt);
      });
      const studioAccept=$('m-studio-accept');if(studioAccept)studioAccept.onclick=doUi(async()=>{await approveStoryStudioDraft();});
      const studioDiscard=$('m-studio-discard');if(studioDiscard)studioDiscard.onclick=doUi(async()=>{await discardStoryStudioDraft();});
      document.querySelectorAll('[data-studio-suggestion]').forEach(el=>{el.onclick=()=>{
        const studio=normalizeStoryStudio(project.storyStudio);
        const suggestion=studio.suggestions[Number(el.dataset.studioSuggestion)];
        const input=$('m-studio-input');if(!input||!suggestion)return;
        input.value=suggestion;
        project.storyStudio={...studio,input:suggestion};input.focus();
      };});
      const boardExpand=$('m-board-details');if(boardExpand)boardExpand.ontoggle=()=>{blueprintEditorOpen=boardExpand.open;};
      document.querySelectorAll('[data-arc-details]').forEach(el=>{el.ontoggle=()=>{const id=text(el.dataset.arcDetails);if(el.open)blueprintActOpenIds.add(id);else blueprintActOpenIds.delete(id);};});
      const boardCreate=$('m-board-create');if(boardCreate)boardCreate.onclick=doUi(async()=>{await generateWholeStoryBlueprint('',true);});
      const boardUndo=$('m-board-undo');if(boardUndo)boardUndo.onclick=doUi(async()=>{await restorePreviousBlueprint();});
      const boardRevise=$('m-board-revise');if(boardRevise)boardRevise.onclick=doUi(async()=>{
        const request=text($('m-board-request')?.value).trim();
        if(!request)throw new Error('어느 부분을 어떻게 바꿀지 적어줘.');
        await generateWholeStoryBlueprint(request);
      });
      document.querySelectorAll('[data-beat-edit]').forEach(el=>{el.onclick=()=>{blueprintEditorId=text(el.dataset.beatEdit);blueprintEditorOpen=true;renderUI();};});
      document.querySelectorAll('.m-add-beat').forEach(el=>{el.onclick=doUi(async()=>{await appendBlueprintBeat(text(el.dataset.arcId));});});
      const edits=[['m-board-save-beat','save'],['m-board-delete-beat','delete'],['m-board-move-up','up'],['m-board-move-down','down'],['m-board-mark-done','done'],['m-board-focus','focus']];
      for(const [id,kind] of edits){const el=$(id);if(el)el.onclick=doUi(async()=>{
        const payload=kind==='save'?{title:$('m-board-beat-title')?.value,description:$('m-board-beat-description')?.value}:null;
        await editBlueprintBeat(kind,blueprintEditorId,payload);renderUI();
      });}
      const dir=$('m-direction');
      if(dir){dir.oninput=()=>{project.modernDirection=dir.value;};dir.onchange=()=>{project.modernDirection=dir.value;void saveProject();};}
      $('m-plan').onclick=doUi(async()=>{await modernPreparePlan(true);});
      $('m-suggest').onclick=doUi(async()=>{
        modernShowSuggestions=true;
        project.nextEpisodeDirection=text(project.modernDirection).trim();
        await saveProject();
        const live=await loadModernLivePreview();
        if(live) {
          await generateNextEpisodeChoices();
        } else {
          // A new chat has no accepted chapter to continue. Suggest openings from
          // the user's setup and current character/Lorebook, not from invented history.
          project.destination=text(project.modernDirection).trim();
          await generateStorySuggestions(true);
          project.nextEpisodeChoices=(project.storySuggestions||[]).slice(0,3).map((s,i)=>({
            id:'start_'+i,title:text(s.title),premise:text(s.openingScene||s.hook),
            highlights:text(s.hook),why:text(s.whyFits),writerSeed:text(s.seed)
          }));
          project.nextEpisodeAnchor='아직 본문이 없는 새 채팅 · 현재 캐릭터와 설정부터 시작';
          await saveProject();
        }
        renderUI();
      });
      document.querySelectorAll('[data-choice]').forEach(btn=>{btn.onclick=doUi(async()=>{
        const pick=suggestions[Number(btn.dataset.choice)];if(!pick)return;
        project.modernDirection=text(pick.writerSeed||pick.premise||pick.title);
        modernShowSuggestions=false;await saveProject();renderUI();
      });});
      document.querySelectorAll('[data-quality]').forEach(btn=>{btn.onclick=doUi(async()=>{
        project.writerQualityMode=text(btn.dataset.quality);await saveProject();renderUI();
      });});
      $('m-write-one').onclick=doUi(async()=>{await modernWrite(false);});
      const auto=$('m-write-auto');if(auto)auto.onclick=doUi(async()=>{await modernWrite(true);});
      const pause=$('m-pause');if(pause)pause.onclick=doUi(async()=>{
        modernUserStopped=true;project.modernContinuous=false;await pauseRunner();renderUI();
      });
    }
  }

  function defaultModernSeed() {
    const stored=normalizeStoryNotebook(project.storyNotebook);
    const book=stored.version===2 && stored.confidence==='checked' ? stored : emptyStoryNotebook();
    return [
      '현재 실제 채팅 마지막 장면과 캐릭터·Lorebook을 기준으로, 가까운 2~3화의 흥미로운 전개를 알아서 설계해.',
      '장면을 단편적인 대화 하나로 화 종료하지 말고, 한 화 안에서 여러 의미 있는 사건이 이어지게 해.',
      '큰 방향만 설계하고 세부 행동·말투·갈등은 Writer에게 여지를 남겨.',
      '실제로 이미 발생한 사건을 반복하거나, 미래 계획을 과거 사실로 취급하지 마. 현재 장면의 핵심 사건을 실행하고, 직접 대면 장면을 잠복이나 불길한 암시로 바꿔 미루지 마.',
      book.lastEvent ? ('최근 실제 사건: '+book.lastEvent) : '',
      book.openThreads.length ? ('현재 미해결: '+book.openThreads.slice(0,4).join(' / ')) : '',
    ].filter(Boolean).join('\n');
  }

  async function modernPreparePlan(force) {
    if(modernBusy||storyStudioBusy) return;
    await requireTarget();
    if(project.running) await pauseRunner();
    if(!force && project.nodes.length && !destinationReached())return;
    if(!force && project.planningOutline && !project.planningLocked && !project.nodes.length){
      modernBusy='확정 설계 준비';renderUI();
      try{await finalizeStoryMap();}finally{modernBusy='';renderUI();}
      return;
    }
    modernBusy='AI가 큰 흐름을 설계하는 중';
    project.experienceMode='ai';
    const blueprintFocus=blueprintExecutionFocus();
    const activeUserChange=text(project.modernDirection).trim();
    project.destination=blueprintFocus ? [activeUserChange?('# LATEST USER DIRECTION — overrides all unplayed future outline beats\n'+activeUserChange):'',blueprintFocus].filter(Boolean).join('\n\n') : (activeUserChange||defaultModernSeed());
    project.currentEpisodeOverride='';
    await saveProject();renderUI();
    try {
      await planStoryMap();
      project.modernPlannedDirection = text(project.modernDirection).trim();
      project.modernPlannedBlueprintAt=normalizeStoryBlueprint(project.storyBlueprint).updatedAt;
      await saveProject();
      // Keep director choices reviewable. Node creation happens only when user runs.
    } finally {modernBusy='';renderUI();}
  }

  async function verifyLiveContinuationBeforeWriting() {
    // v0.95.5: NEVER re-judge a previously SAVED reply using the editorial
    // auxiliary LLM as a precondition for writing. Chat history belongs to the
    // user; an inconsistent name or clumsy phrase must not lock the next turn.
    // New output still goes through requireValidStoryBeforeInsert().
    const live = await loadModernLivePreview();
    if (!live || !text(live.content).trim()) return;
    const objectiveProblem = storySurfaceProblem(live.content);
    if (objectiveProblem) {
      // Warn without modifying the saved chat, advancing any beat, or blocking
      // continuation. readDirectorLiveTail() avoids echoing verifiably damaged
      // legacy text back into the next writer prompt.
      notebookStatus = '이전 본문의 문자 손상 가능성 · 원문 유지, 다음 집필 허용';
      notebookError = '';
      perfLog('legacyStoryAdvisory', { reason: objectiveProblem, messageIndex: live.messageIndex });
    }
  }

  async function modernWrite(continuous) {
    if(modernBusy||storyStudioBusy) return;
    await requireTarget();
    if(project.running && project.autoRun) return;
    await verifyLiveContinuationBeforeWriting();
    // Recovery from the older false-positive recheck is automatic and does not
    // touch message history, Story DNA, Mutation, or the accepted outline.
    if (text(project.lastReason).startsWith('본문 품질 검사 실패 (이전 대화 재검사)')) {
      project.lastReason='';
      if (project.lastStatus==='failed') project.lastStatus='idle';
      project.paused=false;
    }
    modernUserStopped=false;
    project.experienceMode='ai';
    project.modernContinuous=!!continuous;
    await saveProject();
    const directionChanged = !!project.planningOutline && (
      text(project.modernDirection).trim() !== text(project.modernPlannedDirection).trim() ||
      (normalizeStoryBlueprint(project.storyBlueprint).sections.length && project.modernPlannedBlueprintAt !== normalizeStoryBlueprint(project.storyBlueprint).updatedAt));
    if(directionChanged)await modernPreparePlan(true);
    if(!project.nodes.length || destinationReached()) {
      if(!project.planningOutline || destinationReached())await modernPreparePlan(true);
      if(!project.nodes.length)await modernPreparePlan(false);
    }
    if(!project.nodes.length)throw new Error('설계 실행 구간을 만들지 못했어. 다시 설계해줘.');
    modernAutoSessionTurns=0;
    modernRolloverCount=0;
    if(continuous)await runAuto();
    else await runOne();
  }

  async function modernRollToNextPlan() {
    if(modernRolling || modernBusy || modernUserStopped || project.experienceMode!=='ai' || !project.modernContinuous)return;
    if(modernRolloverCount>=2){
      project.modernContinuous=false;
      project.lastStatus='paused';project.lastReason='연속 진행 안전 한도에 도달했어. 내용을 확인한 뒤 다시 눌러줘.';
      await saveProject();if(uiOpen)renderUI();return;
    }
    modernRolling=true;modernRolloverCount+=1;
    try {
      await modernPreparePlan(true);
      await modernPreparePlan(false);
      if(modernUserStopped||project.experienceMode!=='ai'||!project.modernContinuous)return;
      await runAuto();
    } catch(error){
      lastError='다음 설계 자동 갱신 실패: '+(error&&error.message?error.message:String(error));
      project.modernContinuous=false;project.running=false;project.autoRun=false;
      await saveProject();if(uiOpen)renderUI();
    } finally {modernRolling=false;}
  }

  function renderUIUnsafe() {
    if (!uiOpen) return;
    const node = currentNode() || nextPendingNode();
    const completed = new Set(project.completedNodeIds);
    const total = project.nodes.length;
    const doneCount = project.completedNodeIds.length;
    const percent = total ? Math.round(doneCount / total * 100) : 0;

    const sceneRows = sceneLibrary.map((card) => {
      const checked = project.selectedSceneCardIds.includes(card.id) ? " checked" : "";
      return '<label class="scene-card"><input type="checkbox" class="sr-scene-card" data-id="' + escapeHtml(card.id) + '"' + checked + '><span><b>' +
        escapeHtml(card.title) + '</b><small>' + escapeHtml(card.description) + '</small></span></label>';
    }).join("");

    const activeEpisodeForRun = effectiveCurrentEpisode(project.planningOutline);
    const nodeGroups = new Map();
    project.nodes.forEach((item) => {
      const key = text(item.episodeNumber) || (activeEpisodeForRun ? text(activeEpisodeForRun.number) : "미분류");
      if (!nodeGroups.has(key)) nodeGroups.set(key, []);
      nodeGroups.get(key).push(item);
    });
    const rows = Array.from(nodeGroups.entries()).map(([episodeNo, items]) => {
      const episodeTitle = text(items[0] && items[0].episodeTitle);
      const itemRows = items.map((item) => {
        const state = completed.has(item.id) ? "✓" : item.id === (node && node.id) ? "▶" : "·";
        const criteria = item.completionCriteria && item.completionCriteria.length
          ? '<div class="criteria">' + item.completionCriteria.map((x) => '• ' + escapeHtml(x)).join('<br>') + '</div>' : "";
        return '<details class="node-card"' + (item.id === (node && node.id) ? ' open' : '') + '><summary><span class="sr-state">' + state +
          '</span><span><b>' + escapeHtml(item.title) + '</b><small>' + escapeHtml(item.control) + '</small></span></summary><p>' +
          escapeHtml(item.instruction) + '</p>' + criteria + '</details>';
      }).join("");
      return '<section class="run-episode"><div class="run-episode-head"><b>' + escapeHtml(episodeNo) + '</b>' +
        (episodeTitle ? '<span>' + escapeHtml(episodeTitle) + '</span>' : '') + '</div>' + itemRows + '</section>';
    }).join("");

    const planningChat = project.planningChat.map((m) =>
      '<div class="chat-bubble ' + (m.role === "user" ? "user" : "assistant") + '">' + escapeHtml(m.content) + '</div>'
    ).join("");

    const mutationCtx = mutationContextCache;
    const mutationStates = mutationCtx && Array.isArray(mutationCtx.activeStates) ? mutationCtx.activeStates : [];
    const mutationRules = mutationCtx && Array.isArray(mutationCtx.selectedRules) ? mutationCtx.selectedRules : [];
    const mutationPacks = mutationCtx && Array.isArray(mutationCtx.availablePacks) && mutationCtx.availablePacks.length
      ? mutationCtx.availablePacks
      : [
          { id: "CORE", label: "공통 Core", mutationEnabled: true },
          { id: "COMMON_SENSE", label: "상식개변사회", mutationEnabled: true },
          { id: "MALE_DOMINANCE", label: "남성우위사회", mutationEnabled: true },
          { id: "UNCLASSIFIED", label: "미분류", mutationEnabled: true },
        ];
    const hasMutationContext = !!mutationCtx;
    const activePackSet = new Set(mutationCtx && Array.isArray(mutationCtx.activePacks) ? mutationCtx.activePacks : []);
    const packOverrideRows = mutationPacks.map((pack) => {
      const id = text(pack && pack.id);
      const mode = id === "CORE" ? "force_on" : packOverrideMode(id);
      const effective = id === "CORE" || activePackSet.has(id);
      const actualLabel = id === "CORE" ? "ON" : (hasMutationContext ? (effective ? "ON" : "OFF") : "미확인");
      const defaultLabel = hasMutationContext ? (pack.mutationEnabled !== false ? "ON" : "OFF") : "미확인";
      return '<div class="pack-override-row"><div><b>' + escapeHtml(pack.label || id) + '</b><small>' +
        escapeHtml(id) + ' · 실제 ' + actualLabel +
        ' · Mutation 기본 ' + defaultLabel + '</small></div>' +
        '<select class="sr-pack-override" data-pack="' + escapeHtml(id) + '"' + (id === "CORE" ? ' disabled' : '') + '>' +
          '<option value="inherit"' + (mode === "inherit" ? ' selected' : '') + '>Mutation 따름</option>' +
          '<option value="force_on"' + (mode === "force_on" ? ' selected' : '') + '>강제 사용</option>' +
          '<option value="force_off"' + (mode === "force_off" ? ' selected' : '') + '>강제 제외</option>' +
        '</select></div>';
    }).join("");
    const mutationPanelHtml = [
      '<div class="mutation-head"><b>현재 개변 상황</b><span class="badge">브리지 ' + escapeHtml(bridgeStatus) + '</span></div>',
      '<p class="status">Story Runner Pack 설정이 Mutation 기본 Pack보다 우선함. 직접 채팅할 때는 Mutation 설정만 적용됨.</p>',
      (!hasMutationContext ? '<p class="warning">Mutation 브리지 데이터를 아직 받지 못함. 아래 새로고침으로 다시 연결을 시도함.</p>' : ''),
      '<div class="pack-override-list">' + packOverrideRows + '</div>',
      mutationStates.length
        ? '<div class="mutation-states">' + mutationStates.map((s) => '<span class="badge active-state">' + escapeHtml(s) + '</span>').join("") + '</div>'
        : '<p class="status">현재 활성 State 없음</p>',
      mutationRules.length
        ? '<details class="mutation-rules"><summary>관련 개변 규칙 ' + mutationRules.length + '개</summary>' +
            mutationRules.slice(0, 12).map((r) =>
              '<div class="mutation-rule"><b>' + escapeHtml(r.name || r.id || "rule") + '</b>' +
              '<small>[' + escapeHtml(r.pack || "UNCLASSIFIED") + '] ' + escapeHtml((r.states || []).join(", ") || r.owner || "") + ' · priority ' + escapeHtml(String(r.priority || 0)) + '</small>' +
              (r.instruction ? '<p>' + escapeHtml(r.instruction) + '</p>' : '') +
              '</div>'
            ).join("") +
          '</details>'
        : '<p class="status">현재 목표/상황과 연결된 개변 규칙 없음</p>',
      '<button type="button" id="sr-refresh-mutation" style="margin-top:8px"' + (mutationRefreshBusy ? ' disabled' : '') + '>' +
        (mutationRefreshBusy ? '개변 상황 새로고침 중…' : '개변 상황 새로고침') + '</button>',
      (mutationRefreshMessage ? '<p class="status">' + escapeHtml(mutationRefreshMessage) + '</p>' : ''),
      mutationContextUpdatedAt ? '<p class="status">마지막 갱신: ' + escapeHtml(new Date(mutationContextUpdatedAt).toLocaleTimeString()) + '</p>' : ''
    ].join("");

    const characterPanelHtml = [
      '<div class="mutation-head"><b>캐릭터 BardWiki</b><span class="badge">' + escapeHtml(characterBootstrapStatus) + '</span></div>',
      '<p class="status">초기 캐릭터 설정과 세계관은 기존 캐릭터 카드·Risu 로어북을 그대로 사용함. BardWiki에는 RP 이후 실제로 생긴 지속적인 관계·상태·행적 변화만 자동 저장하며, 시작 정보를 복제하지 않음.</p>',
      '<div class="actions" style="margin-top:8px"><button id="sr-bootstrap-characters">기존 대화에서 복구</button><button id="sr-bootstrap-characters-force">강제 재구성</button></div>',
      '<div style="margin-top:8px"><span class="badge">BardWiki 캐릭터 ' + characterDocs.length + '개</span>' +
      '<span class="badge">자동 갱신 ' + escapeHtml(characterSyncStatus) + '</span>' +
      (lastCharacterSyncAt ? '<span class="badge">최근 ' + escapeHtml(new Date(lastCharacterSyncAt).toLocaleTimeString()) + '</span>' : '') +
      '</div>',
      renderCharacterBootstrapReport()
    ].join("");

    // v0.69: hasTarget must be initialized before cameoPanelHtml uses it.
    // v0.66-v0.68 declared it later in renderUI(), which triggers the
    // JavaScript temporal dead zone and leaves the fullscreen container blank.
    const hasTarget = !!currentTarget;

    const cameoRows = cameoLibrary.length ? cameoLibrary.map((entry) => {
      const used = entry.lastUsedAt ? ('최근 사용 ' + new Date(entry.lastUsedAt).toLocaleDateString()) : '미사용';
      return '<div class="cameo-row"><div><b>' + escapeHtml(entry.name) + '</b><small>' +
        escapeHtml((entry.sourceCharacterName || '저장 캐릭터') + ' · Lore ' + (entry.loreBlocks || []).length + '개 · ' + used) +
        '</small></div><button class="sr-cameo-toggle" data-id="' + escapeHtml(entry.id) + '">' +
        (entry.enabled !== false ? '사용 ON' : '사용 OFF') + '</button><button class="sr-cameo-delete warn" data-id="' + escapeHtml(entry.id) + '">삭제</button></div>';
    }).join('') : '<p class="status">아직 저장된 카메오 캐릭터 로어가 없음.</p>';
    const cameoPanelHtml = [
      '<div class="mutation-head"><b>카메오 캐릭터 로어 보관함</b><span class="badge">' + escapeHtml(cameoStatus) + '</span></div>',
      '<p class="status">Story Runner 플러그인 전역 저장소에 캐릭터 관련 Lorebook만 보관함. 다른 봇/챗에서도 재사용하며, 원본 대화기록·원본 Story Runner 진행·일반 세계관·Mutation 규칙은 복사하지 않음.</p>',
      '<label class="cameo-auto"><input type="checkbox" id="sr-cameo-auto"' + (project.cameoAutoUse ? ' checked' : '') + '> NPC/조연이 자연스럽게 필요할 때 저장 캐릭터를 우선 후보로 사용</label>',
      '<div class="actions" style="margin-top:8px"><button class="primary" id="sr-cameo-save-current"' + (!hasTarget ? ' disabled' : '') + '>현재 캐릭터 로어 저장/갱신</button><button id="sr-cameo-reload">보관함 새로고침</button></div>',
      '<div class="cameo-list">' + cameoRows + '</div>'
    ].join('');

    const outline = project.planningOutline;
    const suggestionRows = Array.isArray(project.storySuggestions) ? project.storySuggestions : [];
    const suggestionHtml = suggestionRows.length
      ? '<div class="suggest-grid">' + suggestionRows.map((item, index) =>
          '<div class="suggest-card"><h3>' + escapeHtml(item.title || ('아이디어 ' + (index + 1))) + '</h3>' +
          (item.hook ? '<p>' + escapeHtml(item.hook) + '</p>' : '') +
          (item.openingScene ? '<small><b>첫 장면</b> · ' + escapeHtml(item.openingScene) + '</small>' : '') +
          (item.whyFits ? '<small style="margin-top:4px"><b>왜 어울리나</b> · ' + escapeHtml(item.whyFits) + '</small>' : '') +
          '<button class="sr-use-suggestion" data-index="' + index + '">이걸로 시작</button></div>'
        ).join('') + '</div>'
      : (storySuggestionBusy
          ? '<p class="status">현재 캐릭터와 세계관을 읽고 시작 아이디어를 만드는 중...</p>'
          : '<p class="status">추천이 아직 없어. 새 챗이면 자동으로 만들고, 필요하면 오른쪽 버튼으로 다시 받을 수 있어.</p>');
    const currentEpisode = effectiveCurrentEpisode(outline);
    const understood = outline && outline.currentState ? outline.currentState : null;
    const understoodHtml = understood ? [
      '<div class="sr-card"><b>설계 AI가 이해한 현재 상태</b>',
      '<p class="status">역할/상태: ' + escapeHtml(understood.role || "확인되지 않음") + '</p>',
      '<p class="status">현재 위치: ' + escapeHtml(understood.location || "확인되지 않음") + '</p>',
      (Array.isArray(understood.relationships) && understood.relationships.length
        ? '<p class="status">관계: ' + escapeHtml(understood.relationships.join(" · ")) + '</p>' : ''),
      (Array.isArray(understood.activeMutationRules) && understood.activeMutationRules.length
        ? '<p class="status">인식한 개변 규칙: ' + escapeHtml(understood.activeMutationRules.join(" · ")) + '</p>' : ''),
      (Array.isArray(understood.alreadyEstablished) && understood.alreadyEstablished.length
        ? '<p class="status">이미 확정된 사실: ' + escapeHtml(understood.alreadyEstablished.join(" · ")) + '</p>' : ''),
      '</div>'
    ].join("") : "";

    const episodeOverrideOptions = outline && Array.isArray(outline.episodes)
      ? outline.episodes.map((ep, index) => {
          const number = text(ep.number || ((index + 1) + "화"));
          const title = text(ep.title);
          const selected = project.currentEpisodeOverride === number ? ' selected' : '';
          return '<option value="' + escapeHtml(number) + '"' + selected + '>' +
            escapeHtml(number + (title ? ' · ' + title : '')) + '</option>';
        }).join("")
      : '';
    const currentEpisodeHtml = currentEpisode ? [
      '<div class="episode-current-card">',
        '<div class="episode-current-head"><div><small>AI 판단 · 현재 진행 화</small><strong>' + escapeHtml(currentEpisode.number || "미확인") + '</strong>' +
          (currentEpisode.title ? '<span>' + escapeHtml(currentEpisode.title) + '</span>' : '') + '</div>',
          '<span class="confidence">' + escapeHtml(currentEpisode.confidence || "미확인") + '</span></div>',
        (currentEpisode.progress ? '<p><b>현재 진행:</b> ' + escapeHtml(currentEpisode.progress) + '</p>' : ''),
        (currentEpisode.reason ? '<details><summary class="status">현재 화 판단 근거</summary><p>' + escapeHtml(currentEpisode.reason) + '</p></details>' : ''),
        '<div class="episode-override"><select id="sr-episode-override"><option value="">AI 자동 판단</option>' + episodeOverrideOptions + '</select><button id="sr-episode-override-save">선택한 화로 지정</button><button id="sr-episode-override-clear">자동 판단으로 복귀</button></div>',
      '</div>'
    ].join("") : '<div class="episode-current-card"><p class="status">아직 AI의 현재 화 판단이 없음. 근미래 설계를 만들면 최근 채팅을 기준으로 현재 위치를 같이 판단함.</p></div>';

    const outlineHtml = outline
      ? [
          currentEpisodeHtml,
          '<div class="outline-summary">' + escapeHtml(outline.summary || "") + '</div>',
          (outline.focusPlacement ? '<div class="episode-bound"><b>장면 배치</b><span>' + escapeHtml(outline.focusPlacement) + '</span></div>' : ''),
          ((outline.futureAnchors || []).length ? '<details class="outline-extra"><summary><b>조금 뒤에 열어둘 후보</b></summary><ul>' + outline.futureAnchors.map((x) => '<li>' + escapeHtml(x) + '</li>').join("") + '</ul></details>' : ''),
          (outline.episodes || []).map((ep, index) => {
            const isCurrent = currentEpisode && text(ep.number) === text(currentEpisode.number);
            return '<section class="episode-card ' + episodeStatusClass(isCurrent ? "현재" : ep.status) + '">' +
              '<div class="episode-num">' + escapeHtml(ep.number || ((index + 1) + "화")) + '</div>' +
              '<div class="episode-body"><div class="episode-title-row"><h3>' + escapeHtml(ep.title || "") + '</h3><span class="episode-status">' + escapeHtml(isCurrent ? "현재" : (ep.status || "예정")) + '</span></div>' +
              (ep.purpose ? '<p class="phase-purpose">' + escapeHtml(ep.purpose) + '</p>' : '') +
              (ep.startCondition ? '<div class="episode-bound"><b>시작</b><span>' + escapeHtml(ep.startCondition) + '</span></div>' : '') +
              (episodeMustBeats(ep).length ? '<div class="beat-group must"><b>꼭 지켜야 함</b><ul>' + episodeMustBeats(ep).map((b) => '<li>' + escapeHtml(b) + '</li>').join("") + '</ul></div>' : '') +
              (episodeGuideBeats(ep).length ? '<div class="beat-group guide"><b>권고 · 자유롭게 변형 가능</b><ul>' + episodeGuideBeats(ep).map((b) => '<li>' + escapeHtml(b) + '</li>').join("") + '</ul></div>' : '') +
              (ep.endCondition ? '<div class="episode-bound"><b>권고 종료 방향</b><span>' + escapeHtml(ep.endCondition) + '</span></div>' : '') +
              (ep.transition ? '<div class="transition">다음 화 → ' + escapeHtml(ep.transition) + '</div>' : '') +
              '</div></section>';
          }).join(""),
          ((outline.details || []).length ? '<details class="outline-extra"><summary><b>전개 메모</b></summary><ul>' + outline.details.map((x) => '<li>' + escapeHtml(x) + '</li>').join("") + '</ul></details>' : ''),
          ((outline.risks || []).length ? '<details class="outline-extra"><summary><b>주의할 점</b></summary><ul>' + outline.risks.map((x) => '<li>' + escapeHtml(x) + '</li>').join("") + '</ul></details>' : '')
        ].join("")
      : '<div class="empty-outline">아직 설계안이 없어.<br>보고 싶은 상황을 적고 <b>근미래 설계 만들기</b>를 눌러줘.</div>';

    const runEpisode = (() => {
      const n = node || nextPendingNode();
      if (n && n.episodeNumber && outline && Array.isArray(outline.episodes)) {
        return outline.episodes.find((ep) => text(ep.number) === text(n.episodeNumber)) || null;
      }
      if (currentEpisode && outline && Array.isArray(outline.episodes)) {
        return outline.episodes.find((ep) => text(ep.number) === text(currentEpisode.number)) || null;
      }
      return null;
    })();
    const runEpisodeNodes = runEpisode
      ? project.nodes.filter((n) => text(n.episodeNumber) === text(runEpisode.number))
      : [];
    const runEpisodeCompleted = runEpisodeNodes.filter((n) => completed.has(n.id)).length;
    const runEpisodeProgress = runEpisodeNodes.length
      ? Math.round(runEpisodeCompleted / runEpisodeNodes.length * 100)
      : 0;
    const runtimeEpisodeState = runEpisode && project.episodeRuntimeStatus ? project.episodeRuntimeStatus[text(runEpisode.number)] : null;
    const continuationNotice = runtimeEpisodeState && runtimeEpisodeState.needsContinuation
      ? '<div class="episode-bound"><b>' + (runtimeEpisodeState.likelyTruncated ? '같은 화 이어쓰기' : '화 미완료') + '</b><span>' + escapeHtml(runtimeEpisodeState.reason || '다음 실행도 같은 화에서 이어감') + '</span></div>'
      : '';
    const executionFocusHtml = runEpisode ? [
      '<div class="sr-card execution-focus">',
        '<div class="execution-focus-head"><div><small>현재 실행 화</small><strong>' + escapeHtml(runEpisode.number || "") + '</strong><span>' + escapeHtml(runEpisode.title || "") + '</span></div><b>' + runEpisodeProgress + '%</b></div>',
        (runEpisode.purpose ? '<p class="execution-purpose">' + escapeHtml(runEpisode.purpose) + '</p>' : ''),
        continuationNotice,
        '<div class="execution-grid">',
          '<div><small>화 시작점</small><p>' + escapeHtml(runEpisode.startCondition || "설계안에 별도 시작조건 없음") + '</p></div>',
          '<div><small>권고 종료 방향</small><p>' + escapeHtml(runEpisode.endCondition || "별도 종료 방향 없음") + '</p></div>',
        '</div>',
        (node ? '<div class="current-node-focus"><small>지금 실행할 세부 구간</small><b>' + escapeHtml(node.title) + '</b><p>' + escapeHtml(node.instruction || "") + '</p>' +
          ((node.completionCriteria || []).length ? '<div class="criteria">' + node.completionCriteria.map((x) => '• ' + escapeHtml(x)).join('<br>') + '</div>' : '') + '</div>' : ''),
      '</div>'
    ].join("") : '<div class="sr-card"><p class="status">현재 화 실행 상세가 아직 없음. 전개 설계에서 화별 설계를 확정해줘.</p></div>';

    const characterRows = characterDocs.map((doc) =>
      '<button class="character-doc-row' + (doc.id === editingCharacterDocId ? ' selected' : '') + '" data-id="' + escapeHtml(doc.id) + '">' +
        '<b>' + escapeHtml(doc.title) + '</b><small>' + escapeHtml(doc.contextMode || "auto") + '</small>' +
      '</button>'
    ).join("");

    const tabDirector = uiTab === "director" ? " active" : "";
    const tabRun = uiTab === "run" ? " active" : "";
    

    const html = [
      '<style>',
      ':root{color-scheme:dark;font-family:Inter,Pretendard,system-ui,sans-serif}*{box-sizing:border-box}',
      'html,body{min-height:100%;overflow-y:auto!important;overscroll-behavior-y:auto;-webkit-overflow-scrolling:touch;touch-action:pan-y}body{margin:0;background:#171923;color:#f2f3f7}.sr{max-width:1480px;margin:0 auto;min-height:100vh;padding:0 12px 28px;overflow:visible;touch-action:pan-y}',
      '.top{position:sticky;top:0;z-index:20;background:rgba(23,25,35,.96);backdrop-filter:blur(10px);padding:10px 0 8px;border-bottom:1px solid #34394a}',
      '.topline{display:flex;align-items:center;gap:8px}.topline h1{font-size:17px;margin:0 auto 0 0}.close{min-width:72px;order:-1;background:#252a38;border-color:#566078;position:relative;z-index:25}',
      '.progress{margin-top:8px;background:#292d3c;border-radius:999px;height:7px;overflow:hidden}.progress>i{display:block;height:100%;background:#6f89ef;width:' + percent + '%}',
      '.goal{margin-top:7px;font-size:12px;color:#cbd1e3;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
      '.tabs{position:sticky;top:72px;z-index:19;display:grid;grid-template-columns:repeat(2,1fr);gap:6px;padding:8px 0;background:#171923}',
      '.tab{min-height:42px}.tab.active{background:#4f6ee8;border-color:#7890ef}',
      '.sr-card{background:#232635;border:1px solid #393f52;border-radius:12px;padding:13px;margin-bottom:10px}',
      'label{display:grid;gap:6px;font-size:12px;color:#bbc1d2}textarea,input{width:100%;border:1px solid #444a60;border-radius:9px;background:#141720;color:#fff;padding:11px;font:inherit}',
      'textarea{min-height:78px;resize:vertical}button{border:1px solid #4b5268;border-radius:9px;background:#303548;color:#fff;min-height:44px;padding:8px 11px;font-weight:700}',
      'button.primary{background:#4f6ee8;border-color:#7189ee}button.warn{background:#663d46}button:disabled{opacity:.5}',
      '.actions{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:10px}.actions.three{grid-template-columns:1fr 1fr 1fr}',
      '.status{color:#aeb7d0;font-size:12px;line-height:1.55;white-space:pre-wrap}.error{color:#ff9aa9}',
      '.node-card{background:#1c1f2b;border:1px solid #34394a;border-radius:10px;margin:8px 0;padding:0 10px}.node-card summary{display:grid;grid-template-columns:28px 1fr;gap:8px;align-items:center;padding:11px 0;cursor:pointer}',
      '.sr-state{width:24px;height:24px;display:grid;place-items:center;border-radius:50%;background:#34394a}.node-card small{display:block;color:#8fa0d7;margin-top:2px}.node-card p{color:#d2d6e2;line-height:1.55;margin:0 0 10px;white-space:pre-wrap}.criteria{color:#9ea9c8;font-size:12px;line-height:1.55;padding:0 0 10px}',
      '.chat-log{display:grid;gap:8px;max-height:38vh;overflow:auto;margin-bottom:10px}.chat-bubble{padding:10px 11px;border-radius:10px;line-height:1.5;font-size:13px;white-space:pre-wrap}.chat-bubble.user{background:#38415b;margin-left:22px}.chat-bubble.assistant{background:#202b39;margin-right:22px}',
      '.scene-card{grid-template-columns:26px 1fr;align-items:start;padding:9px 0;border-bottom:1px solid #34394a}.scene-card input{width:20px;height:20px;margin-top:2px}.scene-card small{display:block;color:#9ea9c8;margin-top:3px;line-height:1.45}',
      '.mutation-head{display:flex;align-items:center;gap:8px}.mutation-head b{margin-right:auto}',
      '.mutation-states{margin-top:8px}.active-state{background:#31475f;border-color:#54799b}',
      '.mutation-rules{margin-top:8px}.mutation-rules summary{cursor:pointer;color:#cfd6e8;padding:6px 0}',
      '.pack-override-list{display:grid;gap:6px;margin:8px 0}.pack-override-row{display:grid;grid-template-columns:1fr 150px;gap:8px;align-items:center;padding:8px;border:1px solid #3c455b;border-radius:8px;background:#202533}.pack-override-row small{display:block;color:#9ea9c8;margin-top:2px}.pack-override-row select{width:100%}',
      '.mutation-rule{padding:9px 0;border-top:1px solid #34394a}.mutation-rule small{display:block;color:#9fa8c0;margin-top:3px}.mutation-rule p{font-size:12px;line-height:1.45;color:#cbd0dd;margin:5px 0 0;white-space:pre-wrap}',
      '.planning-workspace{display:grid;grid-template-columns:minmax(380px,.78fr) minmax(560px,1.22fr);gap:10px;align-items:start}',
      '.planning-left,.planning-right{min-width:0}',
      '.planning-right{position:sticky;top:122px;max-height:calc(100vh - 138px);overflow:auto}',
      '.outline-summary{font-size:14px;line-height:1.6;padding:10px 0 14px;color:#e2e5ef}',
      '.phase-card{display:grid;grid-template-columns:34px 1fr;gap:10px;padding:12px 0;border-top:1px solid #34394a}',
      '.phase-num{width:28px;height:28px;border-radius:50%;display:grid;place-items:center;background:#405277;font-weight:800}',
      '.phase-body h3{margin:2px 0 6px;font-size:15px}.phase-purpose{margin:0 0 8px;color:#c7cddd;line-height:1.5}',
      '.phase-body ul,.outline-extra ul{margin:6px 0 8px;padding-left:20px;color:#d7dbe7;line-height:1.55}',
      '.transition{margin-top:8px;padding:8px 10px;border-left:3px solid #5f79df;background:#1b2030;color:#aebce9;font-size:12px;line-height:1.5}',
      '.beat-group{margin-top:9px;padding:9px 10px;border-radius:9px}.beat-group b{font-size:12px}.beat-group ul{margin:6px 0 0 18px;padding:0}.beat-group.must{background:#30242a;border:1px solid #6a414b}.beat-group.guide{background:#1e2832;border:1px solid #344c61}',
      '.outline-extra,.ending{margin-top:10px;padding:10px;border-radius:9px;background:#1c1f2b}.outline-extra b,.ending b{display:block;margin-bottom:5px}',
      '.ending p{margin:4px 0 0;line-height:1.55}.empty-outline{padding:28px 10px;text-align:center;color:#99a3bd;line-height:1.7}',
      '.composer{position:sticky;bottom:0;background:#232635;padding-top:8px}.plan-tools{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:8px}',
      '@media(max-width:760px){.episode-override{grid-template-columns:1fr}.execution-grid{grid-template-columns:1fr}.episode-card{grid-template-columns:52px 1fr}.planning-workspace{grid-template-columns:1fr}.planning-right{position:static;max-height:none}.plan-tools{grid-template-columns:1fr}.ai-toast{left:12px;right:12px;bottom:calc(12px + env(safe-area-inset-bottom));width:auto;max-width:none}.sr{padding-left:10px;padding-right:10px;padding-bottom:calc(28px + env(safe-area-inset-bottom))}}',
      '.character-workspace{display:grid;grid-template-columns:280px 1fr;gap:10px}.character-list{display:grid;gap:6px;align-content:start}.character-doc-row{display:grid;text-align:left;gap:3px}.character-doc-row small{color:#9ea9c8}.character-doc-row.selected{border-color:#7890ef;background:#36415f}',
      '.character-editor textarea{min-height:42vh}.character-toolbar{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-top:8px}',
      '.ai-toast{position:fixed;bottom:18px;right:18px;z-index:35;width:min(300px,calc(100vw - 36px));padding:8px 10px;border:1px solid #7189ee;border-radius:10px;background:rgba(28,32,45,.94);box-shadow:0 8px 22px rgba(0,0,0,.28);pointer-events:auto;touch-action:auto;user-select:none}',
      '.ai-toast-head{display:grid;grid-template-columns:1fr auto auto;align-items:center;gap:8px;font-size:11px;color:#b7c0d8}.ai-toast-title{margin-top:3px;font-size:12px;font-weight:800;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.ai-toast-stage{margin-top:3px;font-size:11px;line-height:1.35;color:#d1d6e3;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.ai-toast-close{min-height:24px!important;width:26px;padding:0!important;border:0!important;border-radius:7px!important;background:transparent!important;color:#c9d1e8!important;font-size:20px!important;line-height:1!important;cursor:pointer}',
      '.task-card{border-color:#46547a}.task-title{display:flex;justify-content:space-between;gap:12px;align-items:center;margin-bottom:8px}.task-title span{font-size:12px;color:#aeb7d0}.task-step{display:flex;gap:9px;padding:8px 0;border-top:1px solid #34394a}.task-icon{width:18px;font-weight:900}.task-step small{display:block;color:#9fa8c0;margin-top:3px}.task-step.done .task-icon{color:#8fd29b}.task-step.running .task-icon{color:#91a8ff}.task-step.failed .task-icon{color:#ff9aa9}.task-step.waiting{opacity:.62}',
      '.episode-current-card{padding:12px;border:1px solid #56678f;border-radius:10px;background:#1a2131;margin-bottom:12px}.episode-current-head{display:flex;gap:12px;align-items:flex-start}.episode-current-head>div{display:grid;gap:2px;flex:1}.episode-current-head small{color:#9faccc}.episode-current-head strong{font-size:24px;line-height:1.15}.episode-current-head span{color:#d6dbea}.confidence{padding:4px 8px;border:1px solid #6578aa;border-radius:999px;font-size:11px}.episode-current-card p{font-size:12px;line-height:1.5;color:#c8cfdf}.episode-override{display:grid;grid-template-columns:minmax(0,1fr) auto auto;gap:6px;margin-top:8px}.episode-override select{width:100%;min-width:0}.episode-card{display:grid;grid-template-columns:64px 1fr;gap:12px;padding:13px 0;border-top:1px solid #34394a}.episode-card.current{background:linear-gradient(90deg,rgba(80,105,188,.12),transparent);border-top-color:#6075b3}.episode-card.done{opacity:.78}.episode-num{font-weight:900;color:#b9c8ff;padding-top:3px}.episode-title-row{display:flex;gap:8px;align-items:center}.episode-title-row h3{margin:0;font-size:15px}.episode-status{margin-left:auto;font-size:11px;padding:3px 7px;border-radius:999px;background:#293046;color:#b9c6ec}.episode-bound{display:grid;grid-template-columns:58px 1fr;gap:8px;margin:7px 0;padding:7px 9px;background:#1c202d;border-radius:7px;font-size:12px;line-height:1.45}.episode-bound b{color:#aebce9}.run-episode{margin-top:10px}.run-episode-head{display:flex;gap:8px;align-items:baseline;padding:8px 2px;color:#dce3f8}.run-episode-head b{font-size:16px}.run-episode-head span{font-size:12px;color:#9fa9c4}.execution-focus{border-color:#53658f}.execution-focus-head{display:flex;align-items:flex-start;gap:12px}.execution-focus-head>div{display:grid;gap:2px;flex:1}.execution-focus-head small{color:#9faccc}.execution-focus-head strong{font-size:26px}.execution-focus-head span{color:#d9deeb}.execution-focus-head>b{font-size:18px;color:#aebeff}.execution-purpose{line-height:1.55;color:#d7dceb}.execution-grid{display:grid;grid-template-columns:1fr 1fr;gap:8px}.execution-grid>div{padding:9px;background:#1b202d;border-radius:8px}.execution-grid small,.current-node-focus small{display:block;color:#9faac5;margin-bottom:4px}.execution-grid p{margin:0;line-height:1.45;font-size:12px}.current-node-focus{margin-top:9px;padding:10px;border:1px solid #4b5775;border-radius:9px;background:#1b2130}.current-node-focus>b{display:block;margin-bottom:5px}.current-node-focus p{margin:0 0 7px;white-space:pre-wrap;line-height:1.5;font-size:13px}.hidden{display:none}',
      '.execution-mode-row{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin:8px 0}.execution-mode-row button.active{border-color:#7189ee;background:#334067;color:#fff}.manual-help{padding:9px;border:1px dashed #4d5875;border-radius:8px;background:#191e2a;color:#bfc7da;font-size:12px;line-height:1.5}',
      '.mode-row{display:grid;grid-template-columns:160px 1fr;gap:10px;align-items:center}.suggest-head{display:flex;align-items:center;justify-content:space-between;gap:10px}.suggest-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px;margin-top:10px}.suggest-card{padding:11px;border:1px solid #424b63;border-radius:9px;background:#1b202d}.suggest-card h3{margin:0 0 5px;font-size:14px}.suggest-card p{margin:4px 0;color:#cbd1df;font-size:12px;line-height:1.45}.suggest-card small{display:block;color:#98a4c3;line-height:1.4}.suggest-card button{margin-top:8px;width:100%}.cameo-auto{display:flex;grid-template-columns:22px 1fr;align-items:center;gap:8px;margin-top:8px}.cameo-auto input{width:18px;height:18px}.cameo-list{display:grid;gap:6px;margin-top:10px}.cameo-row{display:grid;grid-template-columns:minmax(0,1fr) 92px 64px;gap:6px;align-items:center;padding:8px;border:1px solid #3c455b;border-radius:8px;background:#202533}.cameo-row small{display:block;color:#9ea9c8;margin-top:2px}.cameo-row button{min-height:38px;padding:6px}@media(max-width:760px){.suggest-grid{grid-template-columns:1fr}.mode-row{grid-template-columns:1fr}.cameo-row{grid-template-columns:1fr 1fr}.cameo-row>div{grid-column:1/-1}}',
      '.director-shell{display:grid;gap:12px}.director-hero{padding:16px;border:1px solid #465174;border-radius:12px;background:linear-gradient(180deg,#20283a,#1c2230)}.director-hero h2{margin:0 0 5px;font-size:20px}.director-hero p{margin:0;color:#aeb8d3;line-height:1.5}.director-input{min-height:180px!important;font-size:14px;line-height:1.55}.director-actions{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-top:10px}.director-summary{padding:10px 12px;border-left:3px solid #8e9cff;background:#20263a;border-radius:7px;color:#dce2ff}.director-result-card{padding:14px;border:1px solid #3f485f;border-radius:10px;background:#1d2230}.director-result-card.now{border-color:#586884}.director-result-card.writer{border-color:#6675a4}.director-result-card h3{margin:0 0 9px;font-size:15px}.director-prose{white-space:pre-wrap;line-height:1.65;color:#e1e5ef}.writer-text{font-size:14px}.director-writer-head{display:flex;justify-content:space-between;align-items:center;gap:10px}.director-writer-head h3{margin:0}.director-interpret{padding:10px 12px;border:1px solid #3a4258;border-radius:9px;background:#1b202c}.director-interpret summary{cursor:pointer;font-weight:700}.director-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px;margin-top:10px}.director-mini{padding:9px;border:1px solid #343d52;border-radius:8px;background:#202633}.director-mini ul{margin:6px 0 0;padding-left:18px}.director-mini li{margin:3px 0;color:#cfd6e6;line-height:1.4}.director-empty{text-align:center;padding:28px 12px;color:#9ca7c2;border:1px dashed #414a61;border-radius:10px}.advanced-fold{margin-top:12px;padding:10px;border:1px solid #343d52;border-radius:9px;background:#1a1f2b}.advanced-fold summary{cursor:pointer;font-weight:700}.story-dna-panel{border:1px solid #4b4f76;border-radius:10px;background:#1a2030}.story-dna-panel>summary{cursor:pointer;padding:12px 14px;font-weight:800;color:#d7dcff}.dna-body{padding:0 12px 12px}.dna-summary{margin:0 0 10px;padding:10px 12px;border-left:3px solid #a38aff;background:#20263a;border-radius:7px;color:#d9dfff;line-height:1.55}.dna-learning{display:flex;align-items:center;gap:8px;color:#cbd2e8;font-size:12px;margin:8px 0 10px}.dna-learning input{width:16px;height:16px}.dna-row{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:8px;align-items:center;padding:8px 9px;margin-top:6px;border:1px solid #343d52;border-radius:8px;background:#202633}.dna-row>div:first-child{display:grid;gap:2px}.dna-row b{font-size:11px;color:#9eb3ff}.dna-row span{font-size:12px;line-height:1.45;color:#e0e5f2}.dna-row small{color:#8f9bb9}.dna-row button{padding:5px 8px;min-height:30px}.dna-row.candidate{opacity:.82}.dna-row-actions{display:flex;gap:4px}.dna-candidates{margin-top:8px;padding:7px 9px;border:1px dashed #384159;border-radius:8px}.dna-candidates summary{cursor:pointer;font-size:12px;color:#aeb9d8}.dna-tools{display:flex;gap:6px;flex-wrap:wrap;margin-top:10px}.dna-notice{margin:8px 0;padding:7px 9px;background:#1e382e;border:1px solid #3f705a;border-radius:7px;color:#bce8cd;font-size:12px}.director-result-card.dna-suggest{border-color:#665a8f;background:#211f30}.dna-suggestion-list{display:grid;gap:7px}.dna-suggestion{padding:9px 10px;border-radius:8px;background:#292540;color:#e5dfff;line-height:1.55}@media(max-width:760px){.director-grid{grid-template-columns:1fr}.director-writer-head{align-items:flex-start;flex-direction:column}.director-writer-head button{width:100%}.dna-row{grid-template-columns:1fr}.dna-row-actions{justify-content:flex-start}}',
      '</style>',
      aiTaskOverlayHtml(),
      '<main class="sr">',
      '<header class="top"><div class="topline"><button class="close" id="sr-close">← 닫기</button><h1>Story Runner <small>v' + VERSION + '</small></h1></div>',
      '<div class="progress"><i></i></div><div class="goal">' + escapeHtml(project.destination || "보고 싶은 상황을 적어줘") + ' · ' + doneCount + '/' + total + '</div></header>',
      '<nav class="tabs"><button class="tab' + tabDirector + '" data-tab="director">AI 디렉터</button><button class="tab' + tabRun + '" data-tab="run">실행</button></nav>',
      '<section class="' + (uiTab === "director" ? "" : "hidden") + '">',
        '<div class="director-shell">',
          '<div class="director-hero"><h2>Story Director</h2><p>다음 화를 추천받거나 직접 방향을 정하고, 화별 설계안을 수정·확정한 뒤 실행해.</p></div>',
          '<div class="sr-card"><h3>현재 이야기</h3><p class="status">' + escapeHtml(project.nextEpisodeAnchor || text(project.directorAnalysis && project.directorAnalysis.currentState).slice(0,450) || '추천을 생성하면 최신 채팅의 이어쓰기 지점이 여기에 표시돼.') + '</p></div>',
          nextEpisodeChoicesHtml(),
          nextEpisodeDraftHtml(),
          '<div class="director-hero"><h2>전개 설계</h2><p>추천안이나 직접 입력한 내용을 바탕으로 가까운 화별 흐름을 설계하고 수정한 뒤 확정해.</p></div>',
      (aiTask ? aiTaskProgressHtml() : ''),
      '<details class="advanced-fold"><summary>설계 고급 옵션 · 스토리 모드 / 품질</summary><div class="sr-card"><div class="mode-row"><label>스토리 모드<select id="sr-story-mode"><option value="normal"' + (project.storyMode !== 'sunny' ? ' selected' : '') + '>기본</option><option value="sunny"' + (project.storyMode === 'sunny' ? ' selected' : '') + '>양지용</option></select></label><label>작가 품질<select id="sr-writer-quality"><option value="basic"' + (project.writerQualityMode === 'basic' ? ' selected' : '') + '>기본</option><option value="strong"' + (project.writerQualityMode === 'strong' ? ' selected' : '') + '>강화 · 권장</option><option value="max"' + (project.writerQualityMode === 'max' ? ' selected' : '') + '>고품질 설계·검수 · 느림</option></select></label><p class="status">강화는 장면 에너지·캐릭터 목소리·반복 억제용 Writer Module을 매 생성에 적용함. 고품질은 현재 화 직접 실행 시 설계·검수 AI를 추가 호출하며 결함이 확인된 경우에만 재작성함.</p></div></div>',
      '</details>',
      '<details class="advanced-fold"><summary>시작 아이디어 추천</summary><div class="sr-card"><div class="suggest-head"><div><b>시작 아이디어</b><p class="status">빈 화면에서 막히지 않게 지금 바로 시작 가능한 장면을 추천함.</p></div><button id="sr-refresh-suggestions"' + ((storySuggestionBusy || !hasTarget) ? ' disabled' : '') + '>' + (storySuggestionBusy ? '추천 생성 중...' : '추천 새로받기') + '</button></div>' + suggestionHtml + (storySuggestionError ? '<p class="error">' + escapeHtml(storySuggestionError) + '</p>' : '') + '</div>',
      '</details>',
      '<div class="sr-card"><label>보고 싶은 상황 / 장면 / 방향<textarea id="sr-destination" placeholder="결말 목표가 아니라 보고 싶은 부분을 자연어로 적어줘\n예: 전학 첫날 담임과 충돌하는 장면 / 유키노가 경계하다 관심을 갖기 시작하는 흐름">' + escapeHtml(project.destination) + '</textarea></label>',
      '<p class="status">이 내용을 최종 도착점으로 고정하지 않음. AI가 현재 대화를 보고 지금 넣을지, 다음 화에 넣을지, 조금 뒤 후보로 둘지 판단함.</p>',
      '<label style="margin-top:10px">꼭 지켜야 하는 요소 · 필수<textarea id="sr-scenes" placeholder="정말 빠지면 안 되는 것만 한 줄씩 · 없으면 비워둬">' + escapeHtml(project.sceneIdeas.join("\n")) + '</textarea></label><p class="status">여기에 적은 내용만 MUST로 취급함. 위의 ‘보고 싶은 상황 / 방향’과 AI가 제안한 전개는 기본적으로 권고라서 자연스러우면 바뀌거나 생략될 수 있음.</p>',
      '<label style="margin-top:10px">미래 설계 범위<select id="sr-horizon"><option value="2"' + (project.planningHorizon === 2 ? ' selected' : '') + '>현재 포함 2화</option><option value="3"' + (project.planningHorizon === 3 ? ' selected' : '') + '>현재 포함 3화 · 기본</option><option value="4"' + (project.planningHorizon === 4 ? ' selected' : '') + '>현재 포함 4화</option></select></label>',
      (lastError ? '<p class="error">' + escapeHtml(lastError) + '</p>' : ''),
      '<div class="plan-tools"><button class="primary" id="sr-plan"' + ((planningBusy || !hasTarget) ? " disabled" : "") + '>' +
        (project.planningOutline ? '근미래 다시 설계' : '근미래 설계 만들기') +
      '</button><button id="sr-extend-plan"' + ((planningBusy || !hasTarget || !project.planningOutline) ? ' disabled' : '') + '>뒤쪽 미래 채우기</button><button id="sr-reset"' + (!hasTarget ? ' disabled' : '') + '>설계 초기화</button></div></div>',

      '<details class="advanced-fold"><summary>고급 관리 · Mutation / 캐릭터 / 카메오 / 실행 큐</summary>',
      '<div class="sr-card">' + mutationPanelHtml + '</div>',
      '<div class="sr-card">' + characterPanelHtml + '</div>',
      '<div class="sr-card">' + cameoPanelHtml + '</div>',
      understoodHtml,
      '</details>',
      '<div class="sr-card"><div class="suggest-head"><div><b>설계 확정</b><p class="status">현재 설계안을 확인·수정한 뒤 확정하면 실행에서 사용할 수 있어.</p></div><button id="sr-finalize" class="primary"' + ((planningBusy || planningChatBusy || !hasTarget || !project.planningOutline) ? ' disabled' : '') + '>설계 확정 → 실행</button></div><p class="status">' + (project.planningLocked ? '확정된 실행 큐가 있어. 재설계하면 다시 확정해야 해.' : '아직 실행 큐 미확정') + '</p></div>',
      '<div class="planning-workspace">',
        '<div class="planning-left">',
          '<div class="sr-card"><b>전개 설계 대화</b><p class="status">현재와 가까운 미래만 보고 원하는 부분을 고쳐. “이 장면을 다음 화로”, “여기 뒤를 조금 더”, “이 인물 비중 줄여”처럼 말하면 됨.</p>',
          '<div class="chat-log">' + (planningChat || '<p class="status">설계를 만든 뒤 예: “이 장면을 지금 바로 넣어줘”, “이 뒤를 한 화 더 열어줘”, “유키노 쪽은 아직 확정하지 마”</p>') + '</div>',
          '<div class="composer"><textarea id="sr-plan-chat" placeholder="설계안을 어떻게 고칠지 말해줘"></textarea>',
          '<div class="actions"><button class="primary" id="sr-plan-send"' + ((planningChatBusy || !hasTarget || !project.planningOutline) ? " disabled" : "") + '>AI와 설계안 수정</button></div></div></div>',
        '</div>',
        '<div class="planning-right"><div class="sr-card"><b>현재 설계안</b>' +
          '<p class="status">현재 화와 가까운 미래만 잡아둔 롤링 설계야. 너무 먼 미래는 확정하지 않고 필요할 때 뒤쪽을 더 만들면 됨.</p>' +
          outlineHtml +
        '</div></div>',
      '</div>',

          '<details class="advanced-fold"><summary>고급 · AI 디렉터 상세 분석 및 Story DNA</summary>',
          storyDnaPanelHtml(),
          '<div class="sr-card"><textarea id="sr-director-input" class="director-input" placeholder="예: 지금은 둘이 초면인데 티격태격하면 좋겠고, 한참 뒤에는 서로 없으면 심심할 정도로 가까워지면 좋겠어. 너무 빨리 연애는 하지 말고. 이번엔 첫날이니까 한성이 좀 막 나가서 기억에 남게 하고 다음에 또 엮일 이유 하나 정도 있으면 될듯. 나중에 다른 멤버 들어오면 관계 꼬이는 것도 재밌을거 같고.">' + escapeHtml(project.directorInput || '') + '</textarea><div class="director-actions"><button class="primary" id="sr-director-run"' + ((directorBusy || !hasTarget) ? ' disabled' : '') + '>' + (directorBusy ? '정리 중...' : 'AI가 정리하기') + '</button>' + (project.directorAnalysis ? '<button id="sr-director-rerun"' + ((directorBusy || !hasTarget) ? ' disabled' : '') + '>다시 정리</button>' : '') + '<span class="status">' + (project.directorUpdatedAt ? ('최근 정리 ' + escapeHtml(new Date(project.directorUpdatedAt).toLocaleTimeString())) : '') + '</span></div>' + (directorContextStatus ? '<p class="status">참고 범위: ' + escapeHtml(directorContextStatus) + '</p>' : '<p class="status">AI가 정리할 때 BardWiki를 우선 읽고 최근 대화는 마지막 몇 개만 참고함. 전체 채팅은 보내지 않음.</p>') + (directorError ? '<p class="error">' + escapeHtml(directorError) + '</p>' : '') + '</div>',
          '<div class="sr-card">' + directorResultHtml() + '</div>',
          '</details>',
          '<details class="advanced-fold"><summary>사용법</summary><p class="status">현재 장면만 적으면 현재 장면을 자세히, 먼 미래를 적으면 그 목표까지의 빌드업을 역산함. “지금은 아직 아님”, “나중에”, “이건 꼭”, “이건 후보” 같은 뉘앙스도 AI가 알아서 구분함. 정리 결과는 설계 방향으로 가져온 뒤 화별 설계안을 만들고 확정해야 실행 가능함.</p></details>',
        '</div>',
      '</section>',
      '<section class="' + (uiTab === "run" ? "" : "hidden") + '">',
      '<div class="sr-card">' +
        '<div class="status">' +
          (hasTarget
            ? escapeHtml(currentTarget.characterName + ' / ' + currentTarget.chatName) +
              '\n현재 화: <b>' + escapeHtml((effectiveCurrentEpisode(project.planningOutline) && effectiveCurrentEpisode(project.planningOutline).number) || '미확인') + '</b>' +
              '\nMutation 브리지: <b>' + escapeHtml(bridgeStatus) + '</b>' +
              '\n스토리 모드: <b>' + escapeHtml(storyModeLabel()) + '</b>' +
              '\n작가 품질: <b>' + escapeHtml(writerQualityLabel()) + '</b>'
            : '<b>현재 열린 캐릭터 채팅이 없음</b>') +
          '\n실행 컨텍스트: <b>캐릭터 카드 + 침식 로어북 + BardWiki + 최근 대화</b>' +
        '</div>' +
      '</div>',
      '<div class="sr-card"><div class="suggest-head"><div><b>집필 품질</b><p class="status">전개 속도와 별개로 생성에 쓰는 시간을 조절해. 핵심 장면에서만 고품질로 바꿔도 돼.</p></div></div><div class="execution-mode-row sr-quality-quick" style="grid-template-columns:repeat(3,minmax(0,1fr))"><button data-quality="basic" class="' + (project.writerQualityMode === 'basic' ? 'active' : '') + '">빠르게</button><button data-quality="strong" class="' + (project.writerQualityMode === 'strong' ? 'active' : '') + '">균형</button><button data-quality="max" class="' + (project.writerQualityMode === 'max' ? 'active' : '') + '">정성껏 · 느림</button></div><p class="status">' + (project.writerQualityMode === 'max' ? '장면 설계 → 집필 → 결함 검수 → 필요할 때만 재작성.' : project.writerQualityMode === 'basic' ? '추가 편집을 최소화하는 빠른 생성.' : '문체 강화 지침을 적용하는 기본 권장 설정.') + '</p></div>',
      '<div class="sr-card"><b>디렉터 설계 상태</b><p class="status">' + (project.planningLocked ? '설계 확정 완료 · 실행 준비됨' : '설계 미확정 · AI 디렉터에서 설계안을 만들고 확정해줘.') + '</p><button id="sr-back-director">AI 디렉터로 돌아가기</button></div>',
      '<div class="sr-card" id="sr-direct-turn-panel">' +
        '<b style="font-size:16px">현재 화 실행</b>' +
        '<div class="execution-mode-row"><button id="sr-mode-ai" class="' + (project.executionMode !== 'manual' ? 'active' : '') + '">🤖 AI 작성</button><button id="sr-mode-manual" class="' + (project.executionMode === 'manual' ? 'active' : '') + '">✍ 직접 작성 · AI 없음</button></div>' +
        (project.executionMode === 'manual'
          ? '<div class="manual-help">여기에 네가 직접 쓴 본문을 넣으면 AI·보조모델·Writer Quality를 전혀 호출하지 않고 현재 채팅에 그대로 삽입함. 기본 버튼은 현재 화를 유지하며, 화를 끝내고 싶을 때만 “삽입 + 현재 화 완료”를 사용하면 됨.</div>'
          : '<p class="status">현재 화 설계 · 캐릭터 · 침식된 Risu 로어북 · BardWiki 진행 변화를 자동으로 합쳐서 AI가 본문을 생성함. 특별히 바꾸고 싶은 게 있을 때만 아래에 추가 지시를 적으면 됨.</p>' +
            '<label class="cameo-auto" style="margin:8px 0"><input type="checkbox" id="sr-interactive-pacing"' + (project.interactivePacing !== false ? ' checked' : '') + '> 선택점 페이싱 · 사소한 전개는 자동 진행, 중요한 선택에서 멈춤</label>' +
            '<p class="status">ON이면 일반 채팅과 현재 화 실행 모두에서 이동·잡담·도입·사소한 반응 같은 비중요 비트는 한 답변 안에서 여러 개 자동 진행하고, 관계 변화·큰 공개·중요 행동처럼 내가 결정할 가치가 있는 지점 직전에 멈춤. 중간에 중요한 선택이 없으면 현재 목표까지 그대로 진행 가능. “천천히/한 단계만”은 세밀 진행, “목표까지/끝까지/쭉 진행”은 선택점도 통과해 목표 우선으로 달림.</p>') +
        '<textarea id="sr-direct-turn-input" style="min-height:' + (project.executionMode === 'manual' ? '220px' : '100px') + '" placeholder="' + (project.executionMode === 'manual' ? '직접 작성할 소설/대화 본문을 그대로 입력' : '추가 지시 (선택) · 비워두면 현재 화 설계 그대로 실행\n예: 안소율이 먼저 행동하게 / 촬영보다 관계 변화 중심 / 이번 화는 느리게 진행') + '">' + escapeHtml(directTurnInstruction) + '</textarea>' +
        (project.executionMode === 'manual'
          ? '<div class="actions"><button class="primary" id="sr-manual-insert"' + ((directTurnBusy || !hasTarget) ? ' disabled' : '') + '>본문 그대로 삽입</button><button id="sr-manual-complete"' + ((directTurnBusy || !hasTarget || !currentEpisodeSnapshot()) ? ' disabled' : '') + '>삽입 + 현재 화 완료</button></div>'
          : '<div class="actions"><button class="primary" id="sr-direct-run"' + ((directTurnBusy || !hasTarget || !project.planningLocked) ? ' disabled' : '') + '>' + (directTurnBusy ? '생성 중...' : '현재 화 실행') + '</button><button id="sr-direct-toggle-preview"' + ((directTurnBusy || !hasTarget) ? ' disabled' : '') + '>고급 · 지시문 미리보기</button></div>' +
            '<details id="sr-direct-preview"><summary class="status">필요할 때만 실행 지시문을 미리 만들거나 직접 편집</summary>' +
              '<div style="margin-top:10px"><button id="sr-direct-ai"' + ((directTurnBusy || !hasTarget) ? ' disabled' : '') + '>' + (directTurnBusy ? '처리 중...' : 'AI 실행 지시문 만들기') + '</button></div>' +
              (directTurnDraft ? '<pre class="status" style="margin-top:10px;max-height:260px;overflow:auto;white-space:pre-wrap">' + escapeHtml(directTurnDraft) + '</pre>' : '') +
            '</details>') +
        (directTurnError ? '<p class="error">' + escapeHtml(directTurnError) + '</p>' : '') +
      '</div>',
      '<div class="sr-card"><b>현재 화 실행 기준</b><div class="status">' + escapeHtml(episodeExecutionText(currentEpisodeSnapshot()) || '화별 설계가 아직 없으면 추가 지시와 현재 채팅을 기준으로 실행됨.') + '</div></div>',
      '</section>',


      '</main>',
    ].join("");

    document.body.innerHTML = html;

    const aiToastClose = document.getElementById("sr-ai-toast-close");
    if (aiToastClose) aiToastClose.onclick = () => {
      aiTaskToastHidden = true;
      renderUI();
    };

    const closeButton = document.getElementById("sr-close");
    if (closeButton) closeButton.onclick = async () => {
      uiOpen = false;
      stopTargetWatch();
      await risuai.hideContainer();
    };

    document.querySelectorAll(".tab").forEach((el) => {
      el.onclick = () => {
        const next = el.dataset.tab;
        uiTab = next === "director" ? "director" : "run";
        renderUI();
      };
    });

    const nextEpisodeDirection = document.getElementById("sr-next-episode-direction");
    if (nextEpisodeDirection) {
      nextEpisodeDirection.value = project.nextEpisodeDirection || "";
      nextEpisodeDirection.oninput = (event) => { project.nextEpisodeDirection = event.target.value; };
      nextEpisodeDirection.onchange = async (event) => {
        project.nextEpisodeDirection = event.target.value;
        await saveProject();
      };
    }
    const nextEpisodeButton = document.getElementById("sr-next-episode-generate");
    if (nextEpisodeButton) nextEpisodeButton.onclick = () => {
      if (nextEpisodeDirection) project.nextEpisodeDirection = nextEpisodeDirection.value;
      void generateNextEpisodeChoices();
    };
    document.querySelectorAll(".sr-next-episode-select").forEach((el) => {
      el.onclick = async () => {
        try { await selectNextEpisodeChoice(Number(el.dataset.index)); }
        catch (error) { directorError = error && error.message ? error.message : String(error); }
        renderUI();
      };
    });
    const episodeDraftInput = document.getElementById("sr-next-episode-draft");
    if (episodeDraftInput) {
      episodeDraftInput.oninput = (event) => { project.nextEpisodeDraft = event.target.value; };
      episodeDraftInput.onchange = async (event) => { project.nextEpisodeDraft = event.target.value; await saveProject(); };
    }
    const episodeDraftUse = document.getElementById("sr-next-episode-use");
    if (episodeDraftUse) episodeDraftUse.onclick = async () => {
      try {
        if (episodeDraftInput) project.nextEpisodeDraft = episodeDraftInput.value;
        await applyNextEpisodeDraft();
      } catch (error) {
        nextEpisodeError = error && error.message ? error.message : String(error);
        renderUI();
      }
    };
    const directorInput = document.getElementById("sr-director-input");
    if (directorInput) directorInput.oninput = (event) => {
      project.directorInput = event.target.value;
      directorError = "";
    };
    const runDirectorFromUi = async () => {
      try {
        if (directorInput) project.directorInput = directorInput.value;
        await saveProject();
        await runNaturalDirector();
      } catch (error) {
        directorError = error && error.message ? error.message : String(error);
      } finally {
        renderUI();
      }
    };
    const directorRun = document.getElementById("sr-director-run");
    if (directorRun) directorRun.onclick = runDirectorFromUi;
    const directorRerun = document.getElementById("sr-director-rerun");
    if (directorRerun) directorRerun.onclick = runDirectorFromUi;
    const directorUse = document.getElementById("sr-director-use");
    if (directorUse) directorUse.onclick = async () => {
      try { await useDirectorInstruction(); } catch (error) { directorError = error && error.message ? error.message : String(error); renderUI(); }
    };

    // <details> elements are recreated whenever renderUI() runs. Story Runner refreshes
    // often (mutation context, AI task progress, target sync), so remember the user's
    // disclosure choice explicitly instead of letting each rerender reset it closed.
    // Use the native toggle event instead of :scope selectors. Some Risu/WebView builds
    // do not support querySelector(":scope > summary") inside the plugin iframe and
    // would throw during renderUIUnsafe(), blanking the whole Story Runner screen.
    const storyDnaPanel = document.getElementById("sr-story-dna-panel");
    if (storyDnaPanel) {
      storyDnaPanel.ontoggle = () => {
        storyDnaExpanded = storyDnaPanel.open === true;
      };
    }
    const dnaCandidatesPanel = document.getElementById("sr-dna-candidates");
    if (dnaCandidatesPanel) {
      dnaCandidatesPanel.ontoggle = () => {
        storyDnaCandidatesExpanded = dnaCandidatesPanel.open === true;
      };
    }

    const dnaLearning = document.getElementById("sr-dna-learning");
    if (dnaLearning) dnaLearning.onchange = async (event) => {
      storyDNA.learningEnabled = event.target.checked === true;
      storyDnaNotice = storyDNA.learningEnabled ? "Story DNA 자동 학습 켬" : "Story DNA 자동 학습 끔";
      try { await saveStoryDNA(); } catch (error) { storyDnaError = error && error.message ? error.message : String(error); }
      renderUI();
    };
    const dnaExport = document.getElementById("sr-dna-export");
    if (dnaExport) dnaExport.onclick = () => {
      try { downloadStoryDnaMarkdown(); storyDnaNotice = "story-dna.md 내보내기 완료"; } catch (error) { storyDnaError = error && error.message ? error.message : String(error); }
      renderUI();
    };
    const dnaImport = document.getElementById("sr-dna-import");
    const dnaImportFile = document.getElementById("sr-dna-import-file");
    if (dnaImport && dnaImportFile) dnaImport.onclick = () => dnaImportFile.click();
    if (dnaImportFile) dnaImportFile.onchange = async (event) => {
      try {
        const file = event.target.files && event.target.files[0];
        if (!file) return;
        const raw = await file.text();
        storyDNA = parseStoryDnaImport(raw);
        await saveStoryDNA();
        storyDnaError = "";
        storyDnaNotice = "Story DNA 가져오기 완료 · 공통 취향 " + storyDnaSorted("active").length + "개";
      } catch (error) {
        storyDnaError = "Story DNA 가져오기 실패: " + (error && error.message ? error.message : String(error));
      }
      event.target.value = "";
      renderUI();
    };
    document.querySelectorAll("[data-dna-remove]").forEach((el) => {
      el.onclick = async () => {
        const key = text(el.dataset.dnaRemove);
        storyDNA.preferences = (storyDNA.preferences || []).filter((pref) => pref.key !== key);
        storyDnaNotice = "Story DNA 항목 제외함";
        try { await saveStoryDNA(); } catch (error) { storyDnaError = error && error.message ? error.message : String(error); }
        renderUI();
      };
    });
    document.querySelectorAll("[data-dna-promote]").forEach((el) => {
      el.onclick = async () => {
        const key = text(el.dataset.dnaPromote);
        const pref = (storyDNA.preferences || []).find((item) => item.key === key);
        if (pref) {
          pref.status = "active";
          pref.explicitCount = Math.max(1, Number(pref.explicitCount) || 0);
          pref.updatedAt = Date.now();
          storyDnaNotice = "학습 후보를 공통 취향으로 확정함";
          try { await saveStoryDNA(); } catch (error) { storyDnaError = error && error.message ? error.message : String(error); }
          renderUI();
        }
      };
    });

    const destinationInput = document.getElementById("sr-destination");
    if (destinationInput) destinationInput.oninput = (event) => { project.destination = event.target.value; };
    const scenesInput = document.getElementById("sr-scenes");
    if (scenesInput) scenesInput.oninput = (event) => {
      project.sceneIdeas = event.target.value.split(/\r?\n/).map((x) => x.trim()).filter(Boolean);
    };
    const horizonInput = document.getElementById("sr-horizon");
    if (horizonInput) horizonInput.onchange = async (event) => {
      project.planningHorizon = Math.max(2, Math.min(4, Number(event.target.value) || 3));
      await saveProject();
    };
    const storyModeInput = document.getElementById("sr-story-mode");
    if (storyModeInput) storyModeInput.onchange = async (event) => {
      project.storyMode = event.target.value === "sunny" ? "sunny" : "normal";
      project.storySuggestions = [];
      project.storySuggestionGeneratedAt = 0;
      await saveProject();
      renderUI();
      void generateStorySuggestions(true);
    };

    document.querySelectorAll(".sr-quality-quick button[data-quality]").forEach((el) => {
      el.onclick = async () => {
        const mode = el.dataset.quality;
        if (!["basic", "strong", "max"].includes(mode)) return;
        project.writerQualityMode = mode;
        await saveProject();
        if (uiOpen) renderUI();
      };
    });
    const writerQualityInput = document.getElementById("sr-writer-quality");
    if (writerQualityInput) writerQualityInput.onchange = async (event) => {
      project.writerQualityMode = ["basic","strong","max"].includes(event.target.value) ? event.target.value : "strong";
      await saveProject();
      renderUI();
    };

    const interactivePacingInput = document.getElementById("sr-interactive-pacing");
    if (interactivePacingInput) interactivePacingInput.onchange = async (event) => {
      project.interactivePacing = !!event.target.checked;
      await saveProject();
      renderUI();
    };

    const refreshSuggestions = document.getElementById("sr-refresh-suggestions");
    if (refreshSuggestions) refreshSuggestions.onclick = () => { void generateStorySuggestions(true); };
    document.querySelectorAll(".sr-use-suggestion").forEach((el) => {
      el.onclick = async () => {
        const index = Number(el.dataset.index);
        const item = Array.isArray(project.storySuggestions) ? project.storySuggestions[index] : null;
        if (!item) return;
        project.destination = text(item.seed) || text(item.hook) || text(item.title);
        project.sceneIdeas = stringList(item.sceneIdeas);
        project.planningOutline = null;
        project.nodes = [];
        project.currentNodeId = null;
        project.completedNodeIds = [];
        await saveProject();
        renderUI();
      };
    });

    const modeAiButton = document.getElementById("sr-mode-ai");
    if (modeAiButton) modeAiButton.onclick = async () => {
      project.executionMode = "ai";
      directTurnDraft = "";
      directTurnError = "";
      await saveProject();
      renderUI();
    };
    const modeManualButton = document.getElementById("sr-mode-manual");
    if (modeManualButton) modeManualButton.onclick = async () => {
      project.executionMode = "manual";
      directTurnDraft = "";
      directTurnError = "";
      await saveProject();
      renderUI();
    };

    const directTurnInput = document.getElementById("sr-direct-turn-input");
    if (directTurnInput) directTurnInput.oninput = (event) => {
      directTurnInstruction = event.target.value;
      directTurnDraft = '';
      directTurnError = '';
    };
    const directPreviewToggle = document.getElementById("sr-direct-toggle-preview");
    if (directPreviewToggle) directPreviewToggle.onclick = () => {
      const details = document.getElementById("sr-direct-preview");
      if (details) details.open = !details.open;
    };
    const directAiButton = document.getElementById("sr-direct-ai");
    if (directAiButton) directAiButton.onclick = async () => {
      if (directTurnInput) directTurnInstruction = directTurnInput.value;
      await buildDirectTurnDraft();
    };
    const directRunButton = document.getElementById("sr-direct-run");
    if (directRunButton) directRunButton.onclick = async () => {
      if (directTurnInput) directTurnInstruction = directTurnInput.value;
      await executeDirectTurn();
    };
    const manualInsertButton = document.getElementById("sr-manual-insert");
    if (manualInsertButton) manualInsertButton.onclick = async () => {
      if (directTurnInput) directTurnInstruction = directTurnInput.value;
      await executeManualWrite(false);
    };
    const manualCompleteButton = document.getElementById("sr-manual-complete");
    if (manualCompleteButton) manualCompleteButton.onclick = async () => {
      if (directTurnInput) directTurnInstruction = directTurnInput.value;
      await executeManualWrite(true);
    };

    const planButton = document.getElementById("sr-plan");
    if (planButton) planButton.onclick = async () => {
      try {
        lastError = "";
        project.destination = destinationInput.value;
        project.sceneIdeas = scenesInput.value.split(/\r?\n/).map((x) => x.trim()).filter(Boolean);
        if (horizonInput) project.planningHorizon = Math.max(2, Math.min(4, Number(horizonInput.value) || 3));
        await saveProject();
        await planStoryMap();
        uiTab = "director";
      } catch (error) {
        lastError = error && error.message ? error.message : String(error);
      } finally {
        renderUI();
      }
    };

    const extendPlanButton = document.getElementById("sr-extend-plan");
    if (extendPlanButton) extendPlanButton.onclick = async () => {
      try {
        lastError = "";
        if (destinationInput) project.destination = destinationInput.value;
        if (scenesInput) project.sceneIdeas = scenesInput.value.split(/\r?\n/).map((x) => x.trim()).filter(Boolean);
        if (horizonInput) project.planningHorizon = Math.max(2, Math.min(4, Number(horizonInput.value) || 3));
        await saveProject();
        await extendRollingPlan();
      } catch (error) {
        lastError = error && error.message ? error.message : String(error);
      } finally {
        renderUI();
      }
    };

    const resetButton = document.getElementById("sr-reset");
    if (resetButton) resetButton.onclick = () => { void resetPlanning(); };

    const bootstrapCharacters = document.getElementById("sr-bootstrap-characters");
    if (bootstrapCharacters) {
      bootstrapCharacters.onclick = async () => {
        try {
          lastError = "";
          characterBootstrapStatus = "실행 중";
          renderUI();
          await bootstrapCharacterWiki(false);
        } catch (error) {
          characterBootstrapStatus = "실패";
          lastError = error && error.message ? error.message : String(error);
        } finally {
          renderUI();
        }
      };
    }

    const bootstrapCharactersForce = document.getElementById("sr-bootstrap-characters-force");
    if (bootstrapCharactersForce) {
      bootstrapCharactersForce.onclick = async () => {
        try {
          lastError = "";
          characterBootstrapStatus = "강제 재분석 중";
          renderUI();
          await bootstrapCharacterWiki(true);
        } catch (error) {
          characterBootstrapStatus = "실패";
          lastError = error && error.message ? error.message : String(error);
        } finally {
          renderUI();
        }
      };
    }

    const cameoAuto = document.getElementById("sr-cameo-auto");
    if (cameoAuto) cameoAuto.onchange = async (event) => {
      project.cameoAutoUse = !!event.target.checked;
      await saveProject();
      renderUI();
    };

    const cameoSaveCurrent = document.getElementById("sr-cameo-save-current");
    if (cameoSaveCurrent) cameoSaveCurrent.onclick = async () => {
      try {
        lastError = "";
        await saveCurrentCharacterLoreToCameoPool();
      } catch (error) {
        cameoStatus = "저장 실패";
        lastError = error && error.message ? error.message : String(error);
      } finally {
        renderUI();
      }
    };

    const cameoReload = document.getElementById("sr-cameo-reload");
    if (cameoReload) cameoReload.onclick = async () => {
      await loadCameoLibrary();
      renderUI();
    };

    document.querySelectorAll(".sr-cameo-toggle").forEach((el) => {
      el.onclick = async () => {
        const entry = cameoLibrary.find((item) => item.id === el.dataset.id);
        if (!entry) return;
        await setCameoEnabled(entry.id, entry.enabled === false);
        renderUI();
      };
    });

    document.querySelectorAll(".sr-cameo-delete").forEach((el) => {
      el.onclick = async () => {
        await deleteCameoEntry(el.dataset.id);
        renderUI();
      };
    });

    document.querySelectorAll(".sr-pack-override").forEach((el) => {
      el.onchange = async () => {
        try {
          lastError = "";
          await setPackOverride(el.dataset.pack, el.value);
        } catch (error) {
          lastError = error && error.message ? error.message : String(error);
          renderUI();
        }
      };
    });

    const refreshMutationButton = document.getElementById("sr-refresh-mutation");
    if (refreshMutationButton) {
      refreshMutationButton.onclick = async (event) => {
        if (event) event.preventDefault();
        lastError = "";
        const ctx = await refreshMutationContextDirect("현재 전개 설계 상태 갱신", { retries: 3 });
        if (!ctx) {
          lastError = "Mutation State Router에서 응답을 받지 못했습니다. Mutation 플러그인이 활성 상태인지 확인해 주세요.";
        }
        renderUI();
      };
    }

    const episodeOverrideSave = document.getElementById("sr-episode-override-save");
    if (episodeOverrideSave) episodeOverrideSave.onclick = async () => {
      const select = document.getElementById("sr-episode-override");
      project.currentEpisodeOverride = select ? text(select.value).trim() : "";
      await saveProject();
      renderUI();
    };
    const episodeOverrideClear = document.getElementById("sr-episode-override-clear");
    if (episodeOverrideClear) episodeOverrideClear.onclick = async () => {
      project.currentEpisodeOverride = "";
      await saveProject();
      renderUI();
    };

    const backDirector = document.getElementById("sr-back-director");
    if (backDirector) backDirector.onclick = () => { uiTab = "director"; renderUI(); };

    const finalizeButton = document.getElementById("sr-finalize");
    if (finalizeButton) finalizeButton.onclick = async () => {
      try {
        lastError = "";
        await finalizeStoryMap();
      } catch (error) {
        lastError = error && error.message ? error.message : String(error);
        renderUI();
      }
    };

    const planSend = document.getElementById("sr-plan-send");
    if (planSend) planSend.onclick = async () => {
      const input = document.getElementById("sr-plan-chat");
      const value = input.value.trim();
      if (!value) return;
      try {
        lastError = "";
        input.value = "";
        await reviseStoryMap(value);
      } catch (error) {
        lastError = error && error.message ? error.message : String(error);
        renderUI();
      }
    };

    const runOneButton = document.getElementById("sr-run-one");
    if (runOneButton) runOneButton.onclick = async () => {
      try { lastError = ""; await runOne(); } catch (error) { lastError = error && error.message ? error.message : String(error); renderUI(); }
    };
    const runAutoButton = document.getElementById("sr-run-auto");
    if (runAutoButton) runAutoButton.onclick = async () => {
      try { lastError = ""; await runAuto(); } catch (error) { lastError = error && error.message ? error.message : String(error); renderUI(); }
    };
    const pauseButton = document.getElementById("sr-pause");
    if (pauseButton) pauseButton.onclick = () => { void pauseRunner(); };
  }

  function renderBootUI(message) {
    try {
      if (typeof document === "undefined" || !document.body) return false;
      const msg = text(message || "Story Runner 불러오는 중...");
      document.body.innerHTML = [
        '<style>',
        ':root{color-scheme:dark;font-family:Inter,Pretendard,system-ui,sans-serif}',
        '*{box-sizing:border-box}',
        'html,body{margin:0;min-height:100%;background:#171923;color:#f2f3f7}',
        '.sr-boot{min-height:100vh;display:grid;place-items:center;padding:24px}',
        '.sr-boot-card{width:min(520px,100%);padding:18px;border:1px solid #3a4054;border-radius:14px;background:#232635;box-shadow:0 18px 50px rgba(0,0,0,.28)}',
        '.sr-boot-card b{display:block;font-size:18px;margin-bottom:8px}.sr-boot-card p{margin:0;color:#b9c2d8;line-height:1.55;white-space:pre-wrap}',
        '</style>',
        '<main class="sr-boot"><div class="sr-boot-card"><b>Story Runner v' + VERSION + '</b><p>' + escapeHtml(msg) + '</p></div></main>'
      ].join('');
      return true;
    } catch (error) {
      try { console.log('[StoryRunner] boot UI failed', error); } catch (_) {}
      return false;
    }
  }

  function renderUIError(error) {
    const message = (error && error.name ? String(error.name) + ": " : "") + (error && error.message ? String(error.message) : String(error)) + (error && error.stack ? "\n\n" + String(error.stack) : "");
    try { console.log('[StoryRunner] renderUI failed', error); } catch (_) {}
    try {
      if (typeof document === "undefined" || !document.body) return false;
      document.body.innerHTML = [
        '<style>',
        ':root{color-scheme:dark;font-family:Inter,Pretendard,system-ui,sans-serif}',
        '*{box-sizing:border-box}',
        'html,body{margin:0;min-height:100%;background:#171923;color:#f2f3f7}',
        '.sr-fail{min-height:100vh;padding:28px;display:grid;place-items:start center}',
        '.sr-fail-card{width:min(820px,100%);padding:18px;border:1px solid #6a414b;border-radius:14px;background:#2a222b}',
        '.sr-fail-card h1{font-size:18px;margin:0 0 10px}.sr-fail-card p{color:#ffb2bd;line-height:1.55}.sr-fail-card pre{white-space:pre-wrap;overflow-wrap:anywhere;max-height:55vh;overflow:auto;padding:12px;border-radius:9px;background:#151820;color:#d9deeb;font-size:12px}',
        '.sr-fail-card button{margin-top:12px;min-height:42px;padding:8px 12px;border:1px solid #59627a;border-radius:9px;background:#303548;color:#fff;font-weight:700}',
        '</style>',
        '<main class="sr-fail"><section class="sr-fail-card"><h1>Story Runner 화면 렌더링 오류</h1>',
        '<p>흰 화면 대신 실제 오류를 표시하는 안전 모드가 작동했습니다. 아래 오류가 보이면 그대로 캡처해도 됩니다.</p>',
        '<pre>' + escapeHtml(message) + '</pre><button id="sr-fail-close">닫기</button></section></main>'
      ].join('');
      const close = document.getElementById('sr-fail-close');
      if (close) close.onclick = async () => { uiOpen = false; stopTargetWatch(); try { await risuai.hideContainer(); } catch (_) {} };
      return true;
    } catch (fallbackError) {
      try { console.log('[StoryRunner] renderUI fallback failed', fallbackError); } catch (_) {}
      return false;
    }
  }

  function renderUI() {
    if (!uiOpen) return false;
    try {
      if (modernAdvanced) {
        renderUIUnsafe();
        const back = document.createElement('button');
        back.id = 'sr-modern-back';
        back.textContent = '← 간편 화면';
        back.style.cssText = 'position:fixed;right:118px;top:12px;z-index:9999;background:#354c85;color:white;border:1px solid #7188c4;border-radius:10px;padding:9px 12px;font-weight:750;cursor:pointer';
        back.onclick = () => { modernAdvanced = false; renderUI(); };
        document.body.appendChild(back);
      } else {
        renderModernUI();
      }
      return true;
    } catch (error) {
      lastError = error && error.message ? error.message : String(error);
      renderUIError(error);
      return false;
    }
  }

  async function openUI() {
    uiOpen = true;

    // Risu API 3.0의 권장 순서대로 iframe DOM을 먼저 구성한 뒤 fullscreen을 표시함.
    // 빈 iframe을 먼저 보여 주면 일부 WebView/브라우저 조합에서 첫 paint가 흰 화면으로 고정될 수 있음.
    renderBootUI("현재 채팅과 Story Runner 상태를 읽는 중...");
    try {
      await risuai.showContainer("fullscreen");
    } catch (error) {
      lastError = error && error.message ? error.message : String(error);
      renderUIError(error);
      return;
    }

    try {
      await syncTarget();
    } catch (error) {
      lastError = error && error.message ? error.message : String(error);
      try { console.log("[StoryRunner] syncTarget during open failed", error); } catch (_) {}
    }

    const freshStart = !project.planningOutline && !project.nodes.length;
    modernAdvanced = false;
    try { await loadModernLivePreview(); } catch (_) {}
    uiTab = "director";
    startTargetWatch();
    const rendered = renderUI();
    if (!rendered) return;

    // 실제 UI가 DOM에 올라간 뒤에만 자동 백그라운드 작업을 시작함.
    // UI 부팅과 LLM 요청을 분리해, 요청 중에도 화면이 먼저 보이도록 함.
    setTimeout(() => {
      if (!uiOpen) return;
      if (!mutationContextCache && !mutationRefreshBusy) {
        void refreshMutationContextDirect("Story Runner 열기 · 현재 개변 상황", { retries: 2 });
      }
      // Read the latest REAL accepted message once per chat, without generating fiction.
      if (currentTarget && !modernBusy) {
        void refreshModernNotebook(false);
      }
    }, 250);
  }

  await risuai.addPluginChannelListener(MUTATION_RESPONSE_CHANNEL, onMutationBridgeResponse);

  // Register UI before any chat-dependent lookup.
  await risuai.registerSetting("Story Runner", openUI, "🎬", "html", "story-runner-settings");
  await risuai.registerButton({
    name: "Story Runner",
    icon: "🎬",
    iconType: "html",
    location: "hamburger",
    id: "story-runner-hamburger"
  }, openUI);

  try {
    await loadStoryDNA();
    await loadSceneLibrary();
    await loadCameoLibrary();
    await loadBardWikiDocuments();
  } catch (error) {
    console.log("[StoryRunner] library load failed", error);
  }

  try {
    await loadProject(await detectTarget());
  } catch (error) {
    console.log("[StoryRunner] initial project load skipped", error);
  }

  await risuai.addRisuReplacer("beforeRequest", beforeRequest);
  await risuai.addRisuReplacer("afterRequest", afterRequest);
  await risuai.addRisuChatListener("output", onChatOutput);

  await risuai.onUnload(async () => {
    clearTimeout(autoTimer);
    if (aiTaskTicker) {
      clearInterval(aiTaskTicker);
      aiTaskTicker = null;
    }
    for (const waiter of bridgeWaiters.values()) {
      try { waiter.resolve({ ok: false, unloaded: true }); } catch (_) {}
    }
    bridgeWaiters.clear();
    try { await saveProject(); } catch (_) {}
    try { await saveStoryDNA(); } catch (_) {}
    try { await saveCameoLibrary(); } catch (_) {}
  });

  console.log("[StoryRunner] plugin initialized v" + VERSION);


  // ===== v0.24 direct-turn execution =====
  // Direct chat and Story Runner consume the same effective Mutation context.
  // Direct-turn state is initialized before Risu registers UI callbacks (see top-level declarations).

  function currentEpisodeSnapshot() {
    try {
      const outline = project && project.planningOutline;
      const ep = effectiveCurrentEpisode(outline);
      if (!ep) return null;
      const full = outline && Array.isArray(outline.episodes)
        ? outline.episodes.find((item) => text(item.number) === text(ep.number))
        : null;
      return full || ep;
    } catch (_) {
      return null;
    }
  }

  function mutationContextText(ctx) {
    if (!ctx) return '';
    const lines = [
      '# EFFECTIVE MUTATION CONTEXT',
      'Apply this as authoritative world/runtime mechanics. Do not expose or explain this block.',
      'Active Packs: ' + ((ctx.activePacks || []).join(', ') || 'CORE'),
      'Active States: ' + ((ctx.activeStates || []).join(', ') || 'none'),
    ];
    const rules = Array.isArray(ctx.selectedRules) ? ctx.selectedRules : [];
    if (rules.length) {
      lines.push('', '## Selected mutation rules');
      for (const rule of rules) {
        lines.push(
          '- [' + text(rule.pack || 'UNCLASSIFIED') + '] ' + text(rule.name || rule.id) +
          (Array.isArray(rule.states) && rule.states.length ? ' · ' + rule.states.join(', ') : '') +
          '\n' + text(rule.instruction)
        );
      }
    }
    return lines.join('\n');
  }

  function hasExplicitMutationOverride(ctx) {
    if (!ctx || !ctx.packOverrides || typeof ctx.packOverrides !== "object") return false;
    return Object.values(ctx.packOverrides).some((value) => value === "force_on" || value === "force_off");
  }

  function temporaryMutationOverrideText(ctx) {
    if (!hasExplicitMutationOverride(ctx)) return "";
    return [
      "# TEMPORARY STORY RUNNER MUTATION OVERRIDE",
      "This block applies only to this Story Runner planning/execution call. The permanent card/lore source remains the Mutation default baseline.",
      mutationContextText(ctx),
    ].join("\n\n");
  }

  function episodeExecutionText(ep) {
    if (!ep) return '';
    const lines = [
      '# STORY RUNNER EPISODE CONTEXT',
      'Current episode: ' + text(ep.number) + (ep.title ? ' · ' + text(ep.title) : ''),
    ];
    if (ep.purpose) lines.push('Episode purpose: ' + text(ep.purpose));
    if (ep.startCondition) lines.push('Start point: ' + text(ep.startCondition));
    const must = episodeMustBeats(ep);
    const guide = episodeGuideBeats(ep);
    if (must.length) lines.push('MUST happen before advancing this episode:\n- ' + must.join('\n- '));
    if (guide.length) lines.push('Recommended / optional beats:\n- ' + guide.join('\n- '));
    if (ep.endCondition) lines.push('Soft intended ending: ' + text(ep.endCondition));
    if (ep.transition) lines.push('Next handoff: ' + text(ep.transition));
    return lines.join('\n');
  }

  function episodeContractText(ep) {
    if (!ep) return '';
    const must = episodeMustBeats(ep);
    const guide = episodeGuideBeats(ep);
    const lines = [
      '# EPISODE PRIORITIES',
      'Two levels exist and they are NOT equivalent:',
      '1) MUST: non-negotiable requirements. The episode must not advance until these have actually happened on-page.',
      '2) GUIDANCE: recommendations only. Skip, reorder, compress, combine, or transform them whenever that makes the prose more alive and natural.',
      'Never turn GUIDANCE into a checklist or completion gate.',
      'Character initiative, surprise, tension, humor, and interesting deviations are allowed and encouraged as long as MUST items and established canon are not contradicted.',
      'The episode end condition is a soft landing direction, not a hard contract unless the same fact is explicitly in MUST.',
      'Do not race toward the ending. If generation length is insufficient, stop within the SAME episode and continue next turn.',
      'A short first encounter is one SCENE within the episode, not an episode. After that scene, let characters and circumstances produce a NEW consequence or second meaningful situation in the SAME episode.',
      'Scene completion and episode completion are separate. Do not use the episode marker merely because the current location/dialogue ends.',
      'If the immediate scene runs out of substance, move causally into the next relevant scene within THIS episode instead of padding repetitive dialogue or cutting the whole episode short.',
      'Avoid treating a new episode as a fixed next calendar day. Follow the causal continuity of the current scene cluster.', 
      'Never jump to the next episode merely because the output budget is ending.',
    ];
    must.forEach((beat, i) => lines.push('MUST ' + (i + 1) + ': ' + beat));
    guide.forEach((beat, i) => lines.push('GUIDANCE ' + (i + 1) + ': ' + beat));
    if (ep.endCondition) lines.push('Soft ending direction: ' + text(ep.endCondition));
    if (ep.transition) lines.push('Optional next-episode hook: ' + text(ep.transition));
    lines.push(
      'Append ' + COMPLETE_MARKER + ' at the very end ONLY if all MUST items have been satisfied (or there are no MUST items) AND the episode has reached a natural close.',
      'If the response is cut short, ends mid-scene, or simply has not naturally closed, DO NOT append the completion marker. The next Story Runner call will continue the same episode.'
    );
    return lines.join('\n');
  }

  // An episode is a scene CLUSTER, not one generation or one meeting.
  // The first short output must never silently consume the entire episode.
  function episodeProgressBeforeTurn(ep) {
    const key = text(ep && ep.number);
    const state = key && project.episodeRuntimeStatus && project.episodeRuntimeStatus[key];
    return {
      turns: Math.max(0, Number(state && state.generatedTurns) || 0),
      chars: Math.max(0, Number(state && state.generatedChars) || 0),
    };
  }

  function protectEpisodeBoundary(ep, proposedComplete, generatedText, previous) {
    if (!ep || !proposedComplete) return { complete: !!proposedComplete, reason: "" };
    const before = previous || episodeProgressBeforeTurn(ep);
    const turns = before.turns + 1;
    const chars = before.chars + text(generatedText).length;
    // Safeguard against the common 1-scene-as-1-episode failure. This does not
    // make a word-count target: the writer must still naturally resolve the arc.
    if (turns < 2 || chars < 3000) {
      return {
        complete: false,
        reason: "한 장면만으로 화 종료를 확정하지 않음. 같은 화에서 다음 사건과 후속 반응을 이어갈 것 (" + turns + "회 생성, " + chars + "자 누적)",
      };
    }
    return { complete: true, reason: "" };
  }

  function saveEpisodeContinuation(ep, content, reason, truncated, previous) {
    if (!ep) return;
    if (!project.episodeRuntimeStatus || typeof project.episodeRuntimeStatus !== "object") project.episodeRuntimeStatus = {};
    const before = previous || episodeProgressBeforeTurn(ep);
    project.episodeRuntimeStatus[text(ep.number)] = {
      needsContinuation: true,
      likelyTruncated: truncated === true,
      reason: text(reason),
      lastOutputTail: text(content).slice(-1400),
      generatedTurns: before.turns + 1,
      generatedChars: before.chars + text(content).length,
      updatedAt: Date.now(),
    };
  }

  function parseEpisodeStatus(raw, ep) {
    const complete = text(raw).includes(COMPLETE_MARKER);
    const truncated = !complete && likelyTruncatedStory(raw);
    const must = episodeMustBeats(ep);
    return {
      complete,
      truncated,
      covered: [],
      missing: complete ? [] : must,
      boundaryRespected: true,
      reason: complete
        ? '자연스러운 화 종료 신호 확인 · 다음 화로 이동'
        : (truncated ? '출력이 중간에서 끊긴 것으로 보여 같은 화에서 이어감' : '화 완료 신호가 없어 같은 화를 유지함'),
    };
  }

  function remainingEpisodeRequirementsText(ep) {
    if (!ep) return '';
    const state = project && project.episodeRuntimeStatus ? project.episodeRuntimeStatus[text(ep.number)] : null;
    if (!state || state.needsContinuation !== true) return '';
    const lines = [
      '# CONTINUE SAME EPISODE',
      state.likelyTruncated
        ? 'The previous generation likely stopped because of output length. Continue from the exact final moment of the previous assistant message.'
        : 'The previous generation did not finish this episode. Continue the same episode from the exact current chat state.',
      'Do not recap, restart the scene, time-skip past unresolved action, or jump to the next episode.',
      'Do not repeat events that already happened. Continue forward naturally.',
      'SCENE IS NOT EPISODE: if the previous conversation/meeting has naturally finished, use its actual consequences to begin a distinct next scene WITHIN THIS SAME EPISODE. Do not invent filler just to delay progress.',
      'Previous completed scenes must remain completed; never replay them just because the episode is still ongoing.', 
    ];
    const must = episodeMustBeats(ep);
    if (must.length) lines.push('Hard requirements still belong to this same episode:\n- ' + must.join('\n- '));
    if (state.lastOutputTail) lines.push('Previous output tail for continuity only:\n' + text(state.lastOutputTail).slice(-900));
    return lines.join('\n');
  }

  async function buildDirectTurnDraft() {
    const base = directTurnInstruction.trim();
    directTurnBusy = true;
    directTurnError = '';
    if (uiOpen) renderUI();
    try {
      const ctx = await readPlanningContext(base || project.destination || 'next near-term turn directive', false);
      const ep = currentEpisodeSnapshot();
      const prompt = [
        'You are the Story Runner writer-room assistant.',
        storyModeSystemText(),
        writerQualitySystemText(),
        'Write ONLY the next-turn execution directive in Korean. Do not write story prose.',
        'The user may write a very short request. Infer continuity from the supplied current chat, episode plan, character/BardWiki context, and the active Risu Lorebook.',
        'The active Risu Lorebook already contains the mutated world baseline. Treat it as ordinary reality, not optional flavor.',
        'Do not bolt mutation effects onto an ordinary scene after the fact. Interpret the scene from the start as occurring inside the already-rewritten world, so choices, authority, movement, social reactions, opportunities, and consequences naturally follow from that world.',
        'Do not turn established world norms into tutorial dialogue or a staged discovery gimmick. Common facts should be handled matter-of-factly; direct questions receive direct canonical answers rather than vague substitutes or evasive labels.',
        'If MALE_DOMINANCE is active, do not reduce it to a token greeting, honorific, or sexual reaction. Let the established male-dominance social order shape the scene causally wherever relevant.',
        'Prioritize concrete events: who acts, who responds, what changes, and what consequence remains for the following turn.',
        'Avoid merely re-describing an already-established state.',
        interactivePacingText(pacingModeForUserText(base), base),
        episodeExecutionText(ep),
        '# ACTIVE RISU LOREBOOK\n' + activeLoreText((ctx && ctx.lore) || [], 22000),
        (ctx && Array.isArray(ctx.cameoPool) && ctx.cameoPool.length) ? (cameoPoolInstruction() + '\n\n' + ctx.cameoPool.slice(0, 8).map((entry) => '### ' + entry.name + '\n' + text(entry.lore).slice(0, 2200)).join('\n\n')) : '',
        base ? ('# USER INTENT\n' + base) : '# USER INTENT\nInfer the next concrete turn from the current episode plan.',
        '# RECENT CHAT\n' + JSON.stringify((ctx && ctx.recentMessages) || []),
      ].filter(Boolean).join('\n\n');

      // An execution directive is still planning. Do not spend the main writer model here.
      const drafted = (await auxiliary([
        { role: 'system', content: 'You are Story Runner. Produce a concrete execution directive for the next fiction turn in Korean only. Do not expose hidden reasoning.' },
        { role: 'user', content: prompt },
      ])).trim();
      if (!drafted) throw new Error('보조 모델이 빈 지시문을 반환했습니다.');
      directTurnDraft = drafted;
      directTurnInstruction = drafted;
      return drafted;
    } catch (e) {
      console.log('[StoryRunner] direct turn draft failed', e);
      directTurnError = e && e.message ? e.message : String(e);
      directTurnDraft = '';
      return '';
    } finally {
      directTurnBusy = false;
      if (uiOpen) renderUI();
    }
  }

  // Ground visible output in the last established protagonist/status rather than
  // letting a second-pass editor silently overwrite roleplay mechanics.
  function extractRoleplayIdentity(messages) {
    const rows = Array.isArray(messages) ? messages : [];
    for (let i = rows.length - 1; i >= 0; i--) {
      const source = text(rows[i] && rows[i].content);
      const status = source.match(/\|\s*Name\s*:\s*([^|\]\n]+?)\s*\|/i);
      if (status) return status[1].trim();
    }
    return '';
  }

  function roleplayIdentityViolation(candidate, identity) {
    if (!identity || !text(candidate).trim()) return false;
    const source = text(candidate);
    // A status sheet that names a different protagonist is an observable hard error.
    const sheets = [...source.matchAll(/\[Date:[^\]\n]*\|\s*Name\s*:\s*([^|\]\n]+?)\s*\|/gi)];
    return sheets.some(match => match[1].trim() !== identity);
  }

  function lastRoleplayStatus(messages) {
    const rows = Array.isArray(messages) ? messages : [];
    for (let i = rows.length - 1; i >= 0; i--) {
      const match = text(rows[i] && rows[i].content).match(/\[Date:[^\]\n]*\|\s*Name\s*:[^\]\n]*\]/gi);
      if (match && match.length) return match[match.length-1];
    }
    return '';
  }

  function statusSheetGuard(candidate, priorSheet) {
    if (!priorSheet) return true;
    const out = text(candidate);
    const m = out.match(/\[Date:[^\]\n]*\|\s*Name\s*:[^\]\n]*\]/gi);
    if (!m || !m.length) return true; // The host may append its own status sheet.
    const prior = priorSheet.match(/\|\s*(Name|Level|EXP|MP|Class|Coin)\s*:\s*([^|\]\n]+)/gi) || [];
    const current = m[m.length-1];
    // Protect structural fields; stat changes may occur but should not vanish.
    for (const field of ['Name','Level','EXP','MP','Class']) {
      if (new RegExp('\\|\\s*'+field+'\\s*:', 'i').test(priorSheet) && !new RegExp('\\|\\s*'+field+'\\s*:', 'i').test(current)) return false;
    }
    return true;
  }

  // v0.90: deliberate scene architecture and defect-directed quality gate.
  // Do not alter the locked Director outline; architecture guides one execution only.
  async function preparePremiumScene(messages, ep, additionalDirection) {
    if (project.writerQualityMode !== "max") return "";
    try {
      const context = messages.slice(-6).map(m => (m.role + ": " + text(m.content).slice(-2500))).join("\n\n");
      const result = await runInternalLLM({
        mode: "otherAx", allowPlugins: false,
        messages: [
          {role: "system", content: [
            "You are a scene architect, NOT the fiction writer.",
            "Preserve the confirmed Story Runner outline, newest live chat and any player choice.",
            "Silently analyze causality, character-specific motives, dialogue friction, continuity, dramatic tension and information asymmetry.",
            "Choose only immediate causal beats. Never lock the ending or introduce unrelated twists.",
            "Write concise Korean execution guidance of at most 1000 characters. No novel prose."
          ].join("\n")},
          {role: "user", content: [
            "# LOCKED EPISODE\n" + episodeExecutionText(ep),
            "# USER DIRECTION\n" + additionalDirection,
            "# LATEST CONTEXT\n" + context,
            "State: immediate scene objective; character-specific motives; plausible complication; knowledge boundary; one continuity risk."
          ].join("\n\n")}
        ]
      });
      if (result && result.type && result.type !== "success") throw new Error("architect model call failed");
      return stripThoughts(normalizeModelText(result)).slice(0, 1400);
    } catch (error) {
      console.log("[StoryRunner] premium architecture skipped", error);
      return "";
    }
  }

  async function rewriteDraftForQuality(draft, ctx, ep, additionalDirection, pacingMode, identity, priorSheet) {
    const source = text(draft).trim();
    if (!source || project.writerQualityMode !== "max") return source;
    const must = episodeMustBeats(ep);
    const canon = [activeLoreText((ctx && ctx.lore) || [], 6500), text(ctx && ctx.wikiContent).slice(0, 3200)].filter(Boolean).join("\n\n");
    const baseContext = [
      must.length ? "# FIXED MUST\n" + must.join("\n") : "",
      additionalDirection ? "# USER DIRECTION\n" + additionalDirection : "",
      canon ? "# BACKGROUND CANON\n" + canon : "",
      "# DRAFT\n" + source,
    ].filter(Boolean).join("\n\n");
    let issues = [];
    try {
      const result = await runInternalLLM({
        mode: "otherAx", allowPlugins: false,
        messages: [
          {role: "system", content: [
            "You are a strict fiction critic. Do not rewrite prose in this pass.",
            "Check causality, distinct voices, scene movement, repetitive filler, character motivation, continuity, who knows what, and premature resolution.",
            "Find only severe actionable defects. A different aesthetic preference is NOT a defect.",
            "Return ONLY JSON: {\"revise\":boolean,\"issues\":[\"specific actionable defect\"]}.",
            "Set revise=false if the passage is coherent and adequately written. At most 4 issues."
          ].join("\n")},
          {role: "user", content: baseContext.slice(0, 22000)}
        ]
      });
      if (result && result.type && result.type !== "success") return source;
      const verdict = extractJson(stripThoughts(normalizeModelText(result)));
      if (!verdict || verdict.revise !== true || !Array.isArray(verdict.issues)) return source;
      issues = verdict.issues.filter(x => typeof x === 'string' && x.trim()).slice(0, 4);
      if (!issues.length) return source;
    } catch (error) {
      console.log("[StoryRunner] premium critic skipped", error);
      return source;
    }
    try {
      const revised = await runVisibleModel([
        {role: "system", content: [
          "You are revising a Korean fiction draft ONLY to address the listed, verified defects.",
          "Output final Korean fiction only, inside <SR_STORY>...</SR_STORY>.",
          "Preserve established events, cast identity, MUST facts, player choices, world rules, knowledge boundaries, scene scope and unresolved handoff.",
          "Do not add new plot beats, change outcomes, force completion or pad the story.",
          pacingMode === "fine" ? "Keep the scene open; no resolution or time skip." : "Do not cross a consequential decision point.",
          "Never include critique or meta commentary. If repairs are impossible without changing plot, keep the draft intact."
        ].join("\n")},
        {role: "user", content: "# SPECIFIC DEFECTS\n- " + issues.join("\n- ") + "\n\n" + baseContext.slice(0, 21000)}
      ], "model", "고품질 재작성 결과가 비었습니다.");
      const cleaned = text(revised).replace(/<SR_STORY>/gi, '').replace(/<\/SR_STORY>/gi, '').replace(COMPLETE_MARKER, '').trim();
      if (!cleaned || storyOutputLooksContaminated(cleaned)) return source;
      if (roleplayIdentityViolation(cleaned, identity) || !statusSheetGuard(cleaned, priorSheet)) return source;
      const revisedQuality = await storyQualityVerdict(cleaned);
      if (!revisedQuality.ok) return source;
      // Prevent broad plot changes masquerading as an editorial repair.
      if (cleaned.length < source.length * 0.55 || cleaned.length > source.length * 1.65) return source;
      return cleaned;
    } catch (error) {
      console.log("[StoryRunner] premium revision skipped", error);
      return source;
    }
  }

  async function advanceEpisodeAfterDirectRun(completedEpisode) {
    const outline = project && project.planningOutline;
    if (!outline || !Array.isArray(outline.episodes) || !outline.episodes.length || !completedEpisode) return;
    const index = outline.episodes.findIndex((item) => text(item.number) === text(completedEpisode.number));
    if (index < 0) return;

    outline.episodes[index].status = "완료";
    const next = outline.episodes[index + 1] || null;
    // Keep exactly one episode marked current after an automatic advance.
    for (let i = 0; i < outline.episodes.length; i++) {
      if (i !== index && outline.episodes[i].status === "현재") outline.episodes[i].status = "예정";
    }
    if (next) {
      next.status = "현재";
      outline.currentEpisode = {
        number: text(next.number),
        title: text(next.title),
        status: "현재",
        confidence: "높음",
        reason: text(completedEpisode.number) + " 실행 완료 후 자동 이동",
        progress: "새 화 시작 전",
      };
      project.lastReason = text(completedEpisode.number) + " 완료 · " + text(next.number) + "로 이동";
    } else {
      outline.currentEpisode = {
        number: text(completedEpisode.number),
        title: text(completedEpisode.title),
        status: "완료",
        confidence: "높음",
        reason: "현재 설계의 마지막 화 실행 완료",
        progress: "설계된 화 모두 완료",
      };
      project.lastReason = text(completedEpisode.number) + " 완료 · 다음 설계 화 없음";
    }
    if (project.episodeRuntimeStatus && completedEpisode) delete project.episodeRuntimeStatus[text(completedEpisode.number)];
    project.currentEpisodeOverride = "";
    directTurnInstruction = "";
    directTurnDraft = "";
    await saveProject();
  }

  async function executeManualWrite(markEpisodeComplete) {
    const content = text(directTurnInstruction).trim();
    directTurnError = "";
    if (!content) {
      directTurnError = "직접 삽입할 본문을 입력해줘.";
      if (uiOpen) renderUI();
      return null;
    }

    directTurnBusy = true;
    if (uiOpen) renderUI();
    try {
      // Manual mode deliberately does NOT call runLLMModel, auxiliary(),
      // Mutation bridge refresh, Writer Quality, or any AI parser.
      // The text is inserted exactly as the user wrote it.
      await appendAssistantMessageToCurrentChat(content);

      const ep = currentEpisodeSnapshot();
      if (markEpisodeComplete && ep) {
        await advanceEpisodeAfterDirectRun(ep);
        project.lastStatus = "manual-complete";
        project.lastReason = "사용자 직접 작성 본문 삽입 · " + text(ep.number) + " 수동 완료";
      } else {
        if (ep) {
          if (!project.episodeRuntimeStatus || typeof project.episodeRuntimeStatus !== "object") project.episodeRuntimeStatus = {};
          project.episodeRuntimeStatus[text(ep.number)] = {
            needsContinuation: true,
            likelyTruncated: false,
            reason: "사용자가 직접 작성한 본문을 삽입함 · 같은 화 유지",
            lastOutputTail: content.slice(-1400),
            updatedAt: Date.now(),
            source: "manual-write",
          };
        }
        project.lastStatus = "manual";
        project.lastReason = ep
          ? "직접 작성 본문 삽입 · " + text(ep.number) + " 유지"
          : "직접 작성 본문 삽입 · 화 설계 없음";
      }

      directTurnInstruction = "";
      directTurnDraft = "";
      await saveProject();
      return { mode: "manual-write", completedEpisode: !!(markEpisodeComplete && ep) };
    } catch (e) {
      console.log("[StoryRunner] manual write failed", e);
      directTurnError = e && e.message ? e.message : String(e);
      return null;
    } finally {
      directTurnBusy = false;
      if (uiOpen) renderUI();
    }
  }

  async function executeDirectTurn() {
    if (!project.planningLocked) throw new Error("AI 디렉터에서 화별 설계를 확정한 후 실행해줘.");
    const additionalDirection = directTurnInstruction.trim();
    const interactionPacingMode = pacingModeForUserText(additionalDirection);
    const previewDirective = directTurnDraft.trim();

    directTurnBusy = true;
    directTurnError = '';
    if (uiOpen) renderUI();

    try {
      const ep = currentEpisodeSnapshot();
      const episodeProgressBefore = episodeProgressBeforeTurn(ep);
      if (!ep && !additionalDirection && !previewDirective) {
        throw new Error('현재 화 설계가 없어. 전개 설계에서 가까운 흐름을 먼저 만들어줘.');
      }
      const storyPrompt = [
        episodeExecutionText(ep),
        episodeContractText(ep),
        remainingEpisodeRequirementsText(ep),
        '# STORY RUNNER EXECUTION MODE',
        storyModeSystemText(),
        writerQualitySystemText(),
        'Write the CURRENT EPISODE as fiction now. The episode plan is already the execution directive; do not create another planning layer before writing.',
        "Follow the episode beats closely enough that the planned direction is recognizable, but do not turn them into a mechanical checklist. Preserve natural pacing, character initiative, and interesting deviations. Mutation rules should shape the world's causality rather than appear as forced insertions.",
        'Do not force the episode to finish within one generation. Reach the soft ending only if the scene gets there naturally; otherwise stop inside the same episode and continue next turn.',
        'SCENE / EPISODE / TURN DISTINCTION: one generation may write part of one scene; one episode spans multiple meaningful scenes. If this is the first brief scene, do not signal episode completion.',
        'Continue forward when a small scene is exhausted: next consequential action, connected scene or character response within the SAME episode. Do not pad silence, restart the meeting or jump to the next numbered episode.', 
        'Continue from the exact current chat state. Do not recap instead of progressing the scene.',
        interactivePacingText(interactionPacingMode, additionalDirection),
        previewDirective ? ('# OPTIONAL ADVANCED EXECUTION DIRECTIVE\n' + previewDirective) : '',
        additionalDirection ? ('# USER ADDITIONAL DIRECTION — HIGHEST PRIORITY\n' + additionalDirection) : '',
      ].filter(Boolean).join('\n\n');

      // Mutation v0.30+ keeps the default worldview in the actual character card
      // and Risu lorebook. The bridge refreshes state/pack metadata; an explicit
      // Story Runner Pack Override is carried only as a temporary runtime addendum.
      const mutationCtx = compactMutationContext(
        await requestMutationContext(storyPrompt, 3500, true)
      );
      if (mutationCtx) {
        mutationContextCache = mutationCtx;
        mutationContextUpdatedAt = Date.now();
      }

      const ctx = await readPlanningContext(storyPrompt, false);
      const target = await requireTarget();
      if (!target) throw new Error('현재 채팅을 찾지 못했습니다.');
      const chat = await risuai.getChatFromIndex(target.characterIndex, target.chatIndex);
      const recent = Array.isArray(chat && chat.message)
        ? chat.message.slice(-24).map((m) => ({
            role: m.role === 'user' ? 'user' : 'assistant',
            content: m.role !== 'user' && storySurfaceProblem(text(m.data))
              ? '[객관적으로 문자 손상이 확인된 기존 메시지는 모델 입력에서 제외함. 원본 채팅은 보존.]'
              : text(m.data),
          }))
        : [];

      const identityLock = extractRoleplayIdentity(recent);
      const previousStatus = lastRoleplayStatus(recent);
      const messages = [{
        role: 'system',
        content: [
          'STORY RUNNER DIRECT EXECUTION',
          identityLock ? ('PROTAGONIST IDENTITY: The current player character is EXACTLY "' + identityLock + '". Never use another name as their narration/attribution or status-sheet Name. Other named NPCs remain independent.') : '',
          previousStatus ? ('STATUS SHEET CONTRACT: Prior RP uses the following status format. Preserve its structure and established mechanics; only alter values as causally supported by the current scene. Do not invent ranks, rewards, skills, quests or system announcements to wrap up a scene.\n' + previousStatus.slice(0,2100)) : '',
          'SYSTEM OUTPUT CONTRACT: Treat System Message and bracketed game status as story canon, not disposable decoration. Avoid inventing new ones unless established game rules clearly require one.',
          'NO AUTOMATIC WRAP-UP: An outline end condition is not permission to finish certification, settlement, result notices, time skips or player decisions in one turn. Preserve the next meaningful decision for the user.',
          'FINAL LANGUAGE: Korean only. All narration, dialogue, headings, and visible prose must be natural Korean. Do not answer in English except established proper nouns or literal in-world foreign text.',
          'FINAL OUTPUT ENVELOPE: output nothing before <SR_STORY>. Put only the actual Korean fiction inside <SR_STORY>...</SR_STORY>. If the episode naturally completes, place ' + COMPLETE_MARKER + ' only AFTER </SR_STORY>. Never expose reasoning, chain-of-thought, analysis, planning notes, evaluation, or drafting commentary.',
          storyModeSystemText(),
          writerQualitySystemText(),
          episodeExecutionText(ep),
          episodeContractText(ep),
          remainingEpisodeRequirementsText(ep),
          interactivePacingText(interactionPacingMode, additionalDirection),
          liveCanonContextText(ctx),
          temporaryMutationOverrideText(mutationCtx),
          'Use the current directly-mutated character card, Risu Lorebook, BardWiki continuity, recent chat, and the episode directive together.',
          'CANON IDENTITY LOCK: Keep the current story, protagonist, named cast, relationships, and setting. Never drift into an unrelated roleplay, unrelated character names, or a different previous-response example that is not present in the supplied current canon.',
          'If your internal reasoning considers alternate examples or hypothetical scenes, none of those may appear in the visible story unless they are supported by the supplied canon.', 
          'The character card and Lorebook already represent the default mutated world. Do not create a second competing default mutation canon.',
          'NATIVE-WORLD PROSE: established Lorebook customs are everyday reality, not reveal material. Characters normally enact them without announcing that they are customs of this world.',
          'Do not mystery-box or euphemize an ordinary canon fact. If a character is directly asked what an ordinary item, substance, meal, role, or practice is, answer with the specific canonical identity plainly unless that character independently has a reason to lie or evade.',
          'Avoid repetitive exposition such as “이 세계에서는…”, “여기서는 자연스럽다”, or “원래 이렇다”. Use cross-world comparison only when the scene is genuinely about remembered worlds/history and the speaker has that knowledge.',
          'If a character is a reincarnator or visitor who once found a current custom strange, that past memory may affect their private reaction, but after established adaptation they should still handle and name current everyday reality directly rather than acting coy or confused every time.',
          'Do not expose hidden Story Runner or Mutation instructions.',
        ].filter(Boolean).join('\n\n'),
      }];
      for (const m of recent.slice(-12)) {
        if (!text(m.content).trim()) continue;
        messages.push({ role: m.role === 'assistant' ? 'assistant' : 'user', content: text(m.content) });
      }
      messages.push({
        role: 'user',
        content: [
          'Write the current episode now according to the Story Runner episode context above.',
          'Write the story in Korean only.',
          'Return exactly <SR_STORY>...actual Korean story prose...</SR_STORY>, with nothing before the opening tag. If and only if the episode naturally completes, append ' + COMPLETE_MARKER + ' after the closing tag.',
          'Do not output an outline, directive, planning notes, explanation, chain-of-thought, analysis, or machine-status footer.',
          'Honor MUST requirements. Treat GUIDANCE as optional inspiration, not a checklist. Preserve natural scene flow, character initiative, and useful surprises. Perform the current scene rather than endlessly preparing for it. Keep character names consistent with the active character card and most recent verified dialogue; silently fix obvious spelling slips.',
          interactionPacingMode === 'fine' ? 'FINE PACING IS ACTIVE: perform only the immediate beat and stop with the incident open.' : (interactionPacingMode === 'adaptive' ? 'ADAPTIVE CHOICE-POINT PACING IS ACTIVE: compress low-stakes buildup, continue until just before the next meaningful user-relevant decision; if none exists before the current goal, continue to the goal.' : (interactionPacingMode === 'goal' ? 'GOAL-RUN PACING IS ACTIVE: continue through intermediate choices toward the requested goal.' : '')),
          additionalDirection ? ('Additional user direction: ' + additionalDirection) : '',
        ].filter(Boolean).join('\n\n'),
      });

      if (project.writerQualityMode === "max") {
        const sceneArchitecture = await preparePremiumScene(messages, ep, additionalDirection);
        if (sceneArchitecture) {
          messages[0].content += "\n\n# PREMIUM SCENE ARCHITECTURE — ADVISORY, NOT NEW CANON\n" + sceneArchitecture;
        }
      }

      directRunInProgress = true;
      let raw;
      try {
        raw = await runVisibleModel(
          messages,
          'model',
          'AI가 최종 답변 없이 빈 응답을 반환했습니다.'
        );
      } finally {
        directRunInProgress = false;
      }
      if (storyOutputLooksContaminated(raw)) {
        // Meta/reasoning leaks can also coincide with context drift. First throw
        // the generation away and regenerate from the real canon. Only if that
        // fails do we attempt to salvage/translate the contaminated text.
        let cleaned = await regenerateCleanStory(messages);
        if (!cleaned) cleaned = await repairContaminatedStoryOutput(raw, text(raw).includes(COMPLETE_MARKER));
        if (!cleaned) {
          throw new Error('모델 출력에 생각의 사슬/영문 메타 또는 다른 스토리 문맥이 섞여 최종 본문으로 사용할 수 없었습니다. 자동 재생성도 실패했습니다.');
        }
        raw = cleaned;
      }
      if (roleplayIdentityViolation(raw, identityLock) || !statusSheetGuard(raw, previousStatus)) {
        throw new Error("주인공 이름 또는 기존 상태창 형식이 변경되어 본문 삽입을 막았어. 현재 화를 다시 생성해줘.");
      }
      if (interactionPacingMode === "fine") {
        raw = text(raw).replace(new RegExp('\\s*' + COMPLETE_MARKER.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&') + '\\s*$', 'i'), '').trim();
      }
      const episodeStatus = parseEpisodeStatus(raw, ep);
      const boundary = protectEpisodeBoundary(ep, episodeStatus.complete, raw.replace(COMPLETE_MARKER, ""), episodeProgressBefore);
      if (episodeStatus.complete && !boundary.complete) {
        episodeStatus.complete = false;
        episodeStatus.reason = boundary.reason;
      }
      if (interactionPacingMode === "fine") {
        episodeStatus.complete = false;
        episodeStatus.truncated = false;
        episodeStatus.reason = '세밀 진행: 사용자 지시의 즉시 비트만 진행 · 사건/현재 화 미종료';
      }
      let content = await afterRequest(raw, '__sr_direct__');
      if (!content.trim()) throw new Error('후처리 뒤 최종 응답이 비었습니다.');
      if (project.writerQualityMode === "max" && !episodeStatus.truncated) {
        const approvedDraft=await requireValidStoryBeforeInsert(content, messages, '고품질 초안');
        if(approvedDraft!==content) {
          episodeStatus.complete=false;
          episodeStatus.reason='초안 손상 복구 후 같은 화 계속 진행';
        }
        content = await rewriteDraftForQuality(approvedDraft, ctx, ep, additionalDirection, interactionPacingMode, identityLock, previousStatus);
      }
      if (storyOutputLooksContaminated(content)) {
        const repairedFinal = await repairContaminatedStoryOutput(content, false);
        if (!repairedFinal) throw new Error('최종 본문에 생각의 사슬/영문 메타 내용이 남아 삽입을 중단했습니다.');
        content = await afterRequest(repairedFinal);
      }
      if (roleplayIdentityViolation(content, identityLock) || !statusSheetGuard(content, previousStatus)) {
        throw new Error("최종 본문이 현재 주인공/상태창을 훼손하여 채팅 삽입을 중단했어.");
      }
      const contentBeforeIntegrityGate = content;
      content = await requireValidStoryBeforeInsert(content, messages, '화 직접 집필');
      if (content !== contentBeforeIntegrityGate) {
        episodeStatus.complete = false;
        episodeStatus.truncated = false;
        episodeStatus.reason = '품질 검사 후 새 본문으로 재생성함 · 화 종료는 다음 턴에 재검토';
      }
      if (roleplayIdentityViolation(content, identityLock) || !statusSheetGuard(content, previousStatus))
        throw new Error('재생성 본문이 기존 인물/상태창을 훼손하여 삽입을 중단했어.');
      lastError='';
      if(project.lastStatus==='failed')project.lastStatus='waiting';
      if(project.lastReason&&project.lastReason.startsWith('\uBCF8\uBB38 \uD488\uC9C8 \uAC80\uC0AC \uC2E4\uD328'))project.lastReason='';
      await appendAssistantMessageToCurrentChat(content);
      playDirectStoryCompletionSound();
      try { await markUsedCameosFromText(content); } catch (_) {}

      if (ep) {
        if (episodeStatus.complete) {
          await advanceEpisodeAfterDirectRun(ep);
        } else {
          if (!project.episodeRuntimeStatus || typeof project.episodeRuntimeStatus !== 'object') project.episodeRuntimeStatus = {};
          saveEpisodeContinuation(ep, content, episodeStatus.reason, episodeStatus.truncated, episodeProgressBefore);
          project.lastStatus = episodeStatus.truncated ? 'cutoff' : 'waiting';
          project.lastReason = episodeStatus.reason;
          directTurnInstruction = '';
          directTurnDraft = '';
          await saveProject();
        }
      }
      return { mode: 'direct-plugin-model', completedEpisode: episodeStatus.complete && ep ? text(ep.number) : '', episodeStatus };
    } catch (e) {
      console.log('[StoryRunner] direct turn execute failed', e);
      directTurnError = e && e.message ? e.message : String(e);
      return null;
    } finally {
      try { await clearMutationRuntimeOverride(); } catch (_) {}
      directTurnBusy = false;
      if (uiOpen) renderUI();
    }
  }

  function installDirectTurnPanel() { /* v0.25: native execution UI; no monkey patch */ }

  installDirectTurnPanel();
})().catch((error) => {
  try {
    console.error("[StoryRunner] plugin startup failed", error);
  } catch (_) {}
});
