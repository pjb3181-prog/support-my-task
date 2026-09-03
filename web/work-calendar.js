const HOLIDAY_KEYWORDS = [
  "공휴일", "대체공휴일", "대체휴일", "신정", "설날", "설연휴", "추석", "추석연휴",
  "삼일절", "3.1절", "어린이날", "부처님오신날", "석가탄신일", "현충일", "광복절",
  "개천절", "한글날", "성탄절", "크리스마스", "선거일"
];

const FULL_LEAVE_KEYWORDS = ["연차", "휴가", "병가", "공가", "특별휴가", "출산휴가", "육아휴직"];

function parseDate(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function hasMarkerInBracket(title, marker) {
  if (!marker) return false;
  return [...String(title || "").matchAll(/\[([^\[\]]+)]/g)].some((match) => match[1]?.includes(marker));
}

function isHoliday(event) {
  if (!event?.allDay) return false;
  const title = String(event.subject || "");
  return HOLIDAY_KEYWORDS.some((keyword) => title.includes(keyword));
}

function isLeaveTitle(title) {
  const text = String(title || "");
  return text.includes("오전반차") || text.includes("오후반차") || text.includes("반차") ||
    FULL_LEAVE_KEYWORDS.some((keyword) => text.includes(keyword));
}

function isFullLeave(title) {
  const text = String(title || "");
  if (text.includes("오전반차") || text.includes("오후반차") || text.includes("반차")) return false;
  return FULL_LEAVE_KEYWORDS.some((keyword) => text.includes(keyword));
}

function overlapsDate(event, date) {
  const start = parseDate(event.start);
  const end = parseDate(event.end);
  if (!start || !end) return false;
  const dayStart = new Date(date); dayStart.setHours(0, 0, 0, 0);
  const dayEnd = new Date(dayStart); dayEnd.setDate(dayEnd.getDate() + 1);
  return start < dayEnd && end > dayStart;
}

function dayStatus(date, events, marker) {
  const day = date.getDay();
  if (day === 0 || day === 6) return { availability: "none", reason: "주말을 피해 앞선 근무일로 조정" };

  const dayEvents = events.filter((event) => !event.deleted && overlapsDate(event, date));
  const holiday = dayEvents.find(isHoliday);
  if (holiday) return { availability: "none", reason: `${holiday.subject || "공휴일"} 일정 반영` };

  const leaveEvents = dayEvents.filter((event) => hasMarkerInBracket(event.subject, marker) && isLeaveTitle(event.subject));
  const fullLeave = leaveEvents.find((event) => isFullLeave(event.subject));
  if (fullLeave) return { availability: "none", reason: `${fullLeave.subject} 일정 반영` };

  const morningOff = leaveEvents.some((event) => String(event.subject || "").includes("오전반차"));
  const afternoonOff = leaveEvents.some((event) => String(event.subject || "").includes("오후반차"));
  if (morningOff && afternoonOff) return { availability: "none", reason: "반차 일정 반영" };
  if (afternoonOff) return { availability: "morning", reason: "오후반차 일정 반영" };
  if (morningOff) return { availability: "afternoon", reason: "오전반차 일정 반영" };
  return { availability: "full", reason: null };
}

function formatDeadline(date) {
  const dateText = new Intl.DateTimeFormat("ko-KR", { month: "numeric", day: "numeric", weekday: "short" }).format(date);
  return `${dateText} · ${date.getHours() < 12 ? "오전 중" : "퇴근 전"}`;
}

export function preparationDeadlineFor(event, calendarEvents, marker) {
  const eventStart = parseDate(event?.start);
  if (!eventStart) return null;

  let candidate = new Date(eventStart);
  candidate.setDate(candidate.getDate() - 1);
  candidate.setHours(17, 0, 0, 0);
  let lastReason = null;

  for (let i = 0; i < 45; i += 1) {
    const status = dayStatus(candidate, calendarEvents || [], marker || "");
    if (status.availability === "none") {
      lastReason = status.reason || lastReason;
      candidate.setDate(candidate.getDate() - 1);
      continue;
    }
    if (status.availability === "morning" && candidate.getHours() >= 12) {
      candidate.setHours(11, 30, 0, 0);
      return { at: candidate, label: formatDeadline(candidate), reason: status.reason || "오후반차 일정 반영" };
    }
    if (status.availability === "afternoon" && candidate.getHours() < 13) {
      candidate.setHours(13, 30, 0, 0);
      return { at: candidate, label: formatDeadline(candidate), reason: status.reason || "오전반차 일정 반영" };
    }
    return { at: candidate, label: formatDeadline(candidate), reason: lastReason || status.reason || "직전 근무일 기준" };
  }
  return null;
}
