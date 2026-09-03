import { initializeApp } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js";
import { getAuth, onAuthStateChanged, signInAnonymously } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";
import { collection, getDocs, getFirestore, query, where } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";

const TYPE_RULES = [
  ["FMEA", "FMEA"],
  ["HAZOP", "HAZOP"],
  ["LOPA", "LOPA"],
  ["현장조사", "FIELD_WORK"],
  ["현장방문", "FIELD_WORK"],
  ["화상회의", "화상회의"],
  ["면담", "면담"],
];

const DEFAULT_TYPE_ITEMS = {
  FMEA: ["관련자료 확인", "노트북", "충전기"],
  HAZOP: ["관련자료 확인", "노트북", "충전기"],
  LOPA: ["관련자료 확인", "노트북", "충전기"],
  FIELD_WORK: ["관련자료", "노트북", "충전기", "안전화", "안전모"],
  면담: ["관련자료 확인"],
  화상회의: ["관련자료 확인"],
  일반회의: ["관련자료 확인"],
};

const TYPE_LABELS = {
  FMEA: "FMEA",
  HAZOP: "HAZOP",
  LOPA: "LOPA",
  FIELD_WORK: "현장업무",
  면담: "면담",
  화상회의: "화상회의",
  일반회의: "일반회의",
};

const ROOM_ITEMS = ["참석자 명단 받기", "관련자료 출력", "입구 팻말 준비"];

function loadTypeItems() {
  try {
    const saved = JSON.parse(localStorage.getItem("meri.typeItems") || "{}");
    return Object.fromEntries(
      Object.entries(DEFAULT_TYPE_ITEMS).map(([key, defaults]) => [
        key,
        Array.isArray(saved[key]) && saved[key].length ? saved[key] : [...defaults],
      ])
    );
  } catch {
    return Object.fromEntries(Object.entries(DEFAULT_TYPE_ITEMS).map(([key, values]) => [key, [...values]]));
  }
}

const state = {
  marker: localStorage.getItem("meri.marker") || "종",
  events: [],
  configReady: false,
  typeItems: loadTypeItems(),
};

const $ = (id) => document.getElementById(id);
const setupCard = $("setupCard");
const summary = $("summary");
const eventList = $("eventList");
const emptyState = $("emptyState");
const pullHint = $("pullHint");

function parseTitle(raw) {
  let title = String(raw || "").trim();
  let roomType = null;
  if (title.startsWith("[대]")) { roomType = "대"; title = title.slice(3).trim(); }
  else if (title.startsWith("[세]")) { roomType = "세"; title = title.slice(3).trim(); }

  let attendeeCode = null;
  const suffix = title.match(/\[([^\[\]]+)\]\s*$/);
  if (suffix) {
    attendeeCode = suffix[1].trim();
    title = title.slice(0, suffix.index).trim();
  }

  const isMine = !!state.marker && !!attendeeCode && attendeeCode.includes(state.marker);
  let scheduleType = null;
  for (const [keyword, type] of TYPE_RULES) {
    if (title.toLowerCase().includes(keyword.toLowerCase())) { scheduleType = type; break; }
  }
  if (!scheduleType && title) scheduleType = "일반회의";

  return { cleanTitle: title || raw, roomType, attendeeCode, isMine, scheduleType };
}

function localIsoDate(value) {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

function formatEvent(event, showDate = true) {
  const start = localIsoDate(event.start);
  const end = localIsoDate(event.end);
  if (!start || !end) return "";
  const date = new Intl.DateTimeFormat("ko-KR", { month: "numeric", day: "numeric", weekday: "short" }).format(start);
  if (event.allDay) return showDate ? `${date} · 종일` : "종일";
  const timeFmt = new Intl.DateTimeFormat("ko-KR", { hour: "2-digit", minute: "2-digit", hour12: false });
  const times = `${timeFmt.format(start)}-${timeFmt.format(end)}`;
  return showDate ? `${date} · ${times}` : times;
}

function checklistFor(event) {
  const parsed = event.parsed;
  const items = [];
  if (parsed.roomType) items.push(...ROOM_ITEMS);
  items.push(...(state.typeItems[parsed.scheduleType] || state.typeItems.일반회의 || []));
  return [...new Map(items.map((x) => [x.trim().toLowerCase(), x])).values()];
}

function render() {
  const today = new Date(); today.setHours(0,0,0,0);
  const tomorrow = new Date(today); tomorrow.setDate(today.getDate() + 1);
  const active = state.events
    .filter((e) => !e.deleted && e.parsed?.isMine)
    .sort((a,b) => String(a.start).localeCompare(String(b.start)));

  const todayEvents = active.filter((e) => {
    const d = localIsoDate(e.start); return d && d >= today && d < tomorrow;
  });
  const upcoming = active.filter((e) => { const d = localIsoDate(e.start); return d && d >= tomorrow; });
  const past = active.filter((e) => { const d = localIsoDate(e.start); return d && d < today; }).slice(-5);

  $("todayCount").textContent = `${todayEvents.length}건`;
  $("upcomingCount").textContent = `${upcoming.length}건`;
  summary.classList.remove("hidden");
  emptyState.classList.toggle("hidden", active.length !== 0);
  eventList.innerHTML = "";

  appendSection("오늘", todayEvents, false);
  appendSection("예정 일정", upcoming, true);
  appendSection("지난 일정", past, true);
}

function appendSection(title, events, showDate) {
  if (!events.length) return;
  const header = document.createElement("div");
  header.className = "section-title";
  header.innerHTML = `<span>${title}</span><span>${events.length}건</span>`;
  eventList.appendChild(header);
  events.forEach((event) => {
    const b = document.createElement("button");
    b.className = "event-card";
    const meta = [event.parsed.roomType === "대" ? "대회의실" : event.parsed.roomType === "세" ? "세미나실" : "", event.location || ""].filter(Boolean).join(" · ");
    b.innerHTML = `<div class="title-row"><strong>${escapeHtml(event.parsed.cleanTitle)}</strong><span class="type">${escapeHtml(event.parsed.scheduleType || "")}</span></div><div class="time">${escapeHtml(formatEvent(event, showDate))}</div>${meta ? `<div class="meta">${escapeHtml(meta)}</div>` : ""}`;
    b.addEventListener("click", () => openDetail(event));
    eventList.appendChild(b);
  });
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>'"]/g, (c) => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", "'":"&#39;", '"':"&quot;" }[c]));
}

function openDetail(event) {
  $("detailTitle").textContent = event.parsed.cleanTitle;
  $("detailMeta").textContent = [formatEvent(event, true), event.parsed.scheduleType, event.parsed.roomType === "대" ? "대회의실" : event.parsed.roomType === "세" ? "세미나실" : ""].filter(Boolean).join(" · ");
  const checklist = $("checklist");
  checklist.innerHTML = "";
  const checked = JSON.parse(localStorage.getItem(`meri.check.${event.id}`) || "{}");
  checklistFor(event).forEach((text) => {
    const row = document.createElement("label");
    row.className = "check-row";
    const box = document.createElement("input"); box.type = "checkbox"; box.checked = !!checked[text];
    const span = document.createElement("span"); span.textContent = text;
    box.addEventListener("change", () => {
      const next = JSON.parse(localStorage.getItem(`meri.check.${event.id}`) || "{}");
      next[text] = box.checked;
      localStorage.setItem(`meri.check.${event.id}`, JSON.stringify(next));
    });
    row.append(box, span); checklist.appendChild(row);
  });
  $("detailDialog").showModal();
}

function populateTypeEditor(type = $("typeSelect").value || "FMEA") {
  const select = $("typeSelect");
  if (!select.options.length) {
    Object.keys(DEFAULT_TYPE_ITEMS).forEach((key) => {
      const option = document.createElement("option");
      option.value = key;
      option.textContent = TYPE_LABELS[key] || key;
      select.appendChild(option);
    });
  }
  if ([...select.options].some((o) => o.value === type)) select.value = type;
  $("typeItemsInput").value = (state.typeItems[select.value] || []).join("\n");
}

function normalizedLines(value) {
  const seen = new Set();
  return String(value || "")
    .split(/\r?\n/)
    .map((x) => x.trim())
    .filter((x) => x && !seen.has(x.toLowerCase()) && seen.add(x.toLowerCase()));
}

async function loadEvents() {
  if (!state.configReady) return;
  $("syncStatus").textContent = "동기화 중";
  const from = new Date(); from.setDate(from.getDate() - 7); from.setHours(0,0,0,0);
  const fromIso = `${from.getFullYear()}-${String(from.getMonth()+1).padStart(2,"0")}-${String(from.getDate()).padStart(2,"0")}T00:00:00`;
  try {
    const snap = await getDocs(query(collection(window.__meriDb, "events"), where("start", ">=", fromIso)));
    state.events = snap.docs.map((doc) => {
      const data = doc.data();
      return { id: doc.id, ...data, parsed: parseTitle(data.subject || "") };
    });
    $("syncStatus").textContent = "Outlook 연동";
    render();
  } catch (err) {
    console.error(err);
    $("syncStatus").textContent = "동기화 실패";
  }
}

async function bootstrap() {
  try {
    const module = await import("./firebase-config.js");
    const config = module.firebaseConfig;
    if (!config?.apiKey || !config?.projectId) throw new Error("Firebase config missing");
    const firebaseApp = initializeApp(config);
    const auth = getAuth(firebaseApp);
    window.__meriDb = getFirestore(firebaseApp);
    state.configReady = true;
    onAuthStateChanged(auth, (user) => { if (user) loadEvents(); });
    if (!auth.currentUser) await signInAnonymously(auth);
  } catch (err) {
    console.warn("Firebase web config not ready", err);
    setupCard.classList.remove("hidden");
  }
}

$("settingsButton").addEventListener("click", () => {
  $("markerInput").value = state.marker;
  populateTypeEditor();
  $("settingsDialog").showModal();
});

$("saveSettingsButton").addEventListener("click", (event) => {
  event.preventDefault();
  const marker = $("markerInput").value.trim();
  if (!marker) return;
  state.marker = marker;
  localStorage.setItem("meri.marker", marker);
  state.events = state.events.map((e) => ({ ...e, parsed: parseTitle(e.subject || "") }));
  render();
  $("settingsDialog").close();
});

$("typeSelect").addEventListener("change", () => populateTypeEditor($("typeSelect").value));

$("saveTypeItemsButton").addEventListener("click", () => {
  const type = $("typeSelect").value;
  const items = normalizedLines($("typeItemsInput").value);
  if (!type || !items.length) return;
  state.typeItems[type] = items;
  localStorage.setItem("meri.typeItems", JSON.stringify(state.typeItems));
  $("typeItemsInput").value = items.join("\n");
});

$("resetTypeItemsButton").addEventListener("click", () => {
  const type = $("typeSelect").value;
  if (!type) return;
  state.typeItems[type] = [...(DEFAULT_TYPE_ITEMS[type] || [])];
  localStorage.setItem("meri.typeItems", JSON.stringify(state.typeItems));
  populateTypeEditor(type);
});

let startY = null;
window.addEventListener("touchstart", (e) => { if (window.scrollY <= 0) startY = e.touches[0].clientY; }, { passive: true });
window.addEventListener("touchmove", (e) => {
  if (startY == null || window.scrollY > 0) return;
  const dy = Math.max(0, e.touches[0].clientY - startY);
  const offset = Math.min(74, dy * .45);
  eventList.style.transform = `translateY(${offset}px)`;
  pullHint.classList.toggle("visible", offset > 6);
  pullHint.textContent = offset >= 58 ? "놓아서 새로고침" : "아래로 당겨 새로고침";
}, { passive: true });
window.addEventListener("touchend", async () => {
  const transform = eventList.style.transform.match(/([0-9.]+)px/);
  const offset = transform ? Number(transform[1]) : 0;
  eventList.style.transform = "translateY(0)"; pullHint.classList.remove("visible"); startY = null;
  if (offset >= 58) await loadEvents();
}, { passive: true });

if ("serviceWorker" in navigator) navigator.serviceWorker.register("./sw.js").catch(console.warn);
bootstrap();
