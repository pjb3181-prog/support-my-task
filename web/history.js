import { collection, getDocs, query, where } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";

const $ = (id) => document.getElementById(id);

function localDateInput(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function addDays(date, days) {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

function cleanSubject(raw) {
  let title = String(raw || "").trim();
  if (title.startsWith("[대]") || title.startsWith("[세]")) title = title.slice(3).trim();
  const suffix = title.match(/\[([^\[\]]+)\]\s*$/);
  if (suffix) title = title.slice(0, suffix.index).trim();
  return title || raw || "(제목 없음)";
}

function attendeeCode(raw) {
  const match = String(raw || "").match(/\[([^\[\]]+)\]\s*$/);
  return match ? match[1].trim() : "";
}

function isMine(raw) {
  const marker = (localStorage.getItem("meri.marker") || "종").trim();
  return !!marker && attendeeCode(raw).includes(marker);
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>'"]/g, (c) => ({
    "&":"&amp;", "<":"&lt;", ">":"&gt;", "'":"&#39;", '"':"&quot;"
  }[c]));
}

function formatDateTime(start, allDay) {
  const d = new Date(start);
  if (Number.isNaN(d.getTime())) return start || "-";
  const date = new Intl.DateTimeFormat("ko-KR", {
    year: "numeric", month: "2-digit", day: "2-digit", weekday: "short"
  }).format(d);
  if (allDay) return `${date}\n종일`;
  const time = new Intl.DateTimeFormat("ko-KR", {
    hour: "2-digit", minute: "2-digit", hour12: false
  }).format(d);
  return `${date}\n${time}`;
}

function setDefaultRange(mode = "year") {
  const now = new Date();
  let from;
  if (mode === "thisYear") from = new Date(now.getFullYear(), 0, 1);
  else {
    from = new Date(now);
    from.setFullYear(from.getFullYear() - 1);
  }
  $("historyFrom").value = localDateInput(from);
  $("historyTo").value = localDateInput(now);
}

function renderResults(events) {
  const root = $("historyResults");
  root.innerHTML = "";
  if (!events.length) {
    root.innerHTML = '<div class="history-empty">조건에 맞는 이전 일정이 없습니다.</div>';
    return;
  }

  for (const event of events) {
    const article = document.createElement("article");
    article.className = "history-result";
    const location = String(event.location || "").trim();
    article.innerHTML = `
      <div class="history-date">${escapeHtml(formatDateTime(event.start, !!event.allDay)).replace("\n", "<br>")}</div>
      <div>
        <h3>${escapeHtml(cleanSubject(event.subject))}</h3>
        ${location ? `<p class="history-location">장소 · ${escapeHtml(location)}</p>` : '<p>장소 정보 없음</p>'}
      </div>`;
    root.appendChild(article);
  }
}

async function searchHistory() {
  const db = window.__meriDb;
  if (!db) {
    $("historyStatus").textContent = "Firebase 연결 후 다시 조회해 주세요.";
    return;
  }

  const from = $("historyFrom").value;
  const to = $("historyTo").value;
  if (!from || !to) {
    $("historyStatus").textContent = "시작일과 종료일을 선택해 주세요.";
    return;
  }
  if (from > to) {
    $("historyStatus").textContent = "시작일이 종료일보다 늦습니다.";
    return;
  }

  const keyword = $("historyKeyword").value.trim().toLowerCase();
  const toExclusive = localDateInput(addDays(new Date(to + "T00:00:00"), 1));
  $("historySearchButton").disabled = true;
  $("historyStatus").textContent = "이전 일정을 조회하고 있습니다…";
  $("historyResults").innerHTML = "";

  try {
    const snap = await getDocs(query(
      collection(db, "events"),
      where("start", ">=", from + "T00:00:00"),
      where("start", "<", toExclusive + "T00:00:00")
    ));

    const events = snap.docs
      .map((doc) => ({ id: doc.id, ...doc.data() }))
      .filter((e) => !e.deleted && isMine(e.subject))
      .filter((e) => {
        if (!keyword) return true;
        return [e.subject, e.location]
          .some((v) => String(v || "").toLowerCase().includes(keyword));
      })
      .sort((a, b) => String(b.start).localeCompare(String(a.start)));

    $("historyStatus").textContent = `${events.length}건을 찾았습니다.`;
    renderResults(events);
  } catch (err) {
    console.error(err);
    $("historyStatus").textContent = "이전 일정 조회에 실패했습니다.";
    $("historyResults").innerHTML = '<div class="history-empty">잠시 후 다시 시도해 주세요.</div>';
  } finally {
    $("historySearchButton").disabled = false;
  }
}

function init() {
  setDefaultRange("year");

  $("historyButton")?.addEventListener("click", () => {
    $("historyDialog").showModal();
  });
  $("historySearchButton")?.addEventListener("click", searchHistory);
  $("historyKeyword")?.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      searchHistory();
    }
  });
  $("historyThisYearButton")?.addEventListener("click", () => {
    setDefaultRange("thisYear");
    searchHistory();
  });
  $("historyOneYearButton")?.addEventListener("click", () => {
    setDefaultRange("year");
    searchHistory();
  });
}

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
else init();
