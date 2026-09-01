package com.nomistake.app.domain

/**
 * Event 제목 파서 (순수 Kotlin, Android Context/Room/Network 의존 없음).
 *
 * 파싱 규칙:
 * 1) roomType: 제목 맨 앞의 `[대]`/`[세]`만 인식 → "대" | "세" | null
 * 2) attendeeCode: 제목의 마지막 `[...]`만 인식 → 내부 문자열 | null
 * 3) isMine: attendeeCode 내부에 "종"이 있는지만 확인 (본문/다른 괄호의 "종"은 사용 안 함)
 * 4) cleanTitle: room tag와 마지막 attendeeCode를 제거한 나머지(앞뒤 공백 제거)
 * 5) scheduleType: cleanTitle에 대해서만 ScheduleTypeRule.keyword 매칭(priority 오름차순, 대소문자 무시)
 *    → 매칭 실패 시 "일반회의" fallback
 * 6) isTarget = isMine
 *    - `[대]`/`[세]`는 회의실 메타데이터 및 체크리스트 템플릿 선택에만 사용한다.
 *    - 사용자는 회의실 관리자가 아니므로 room tag만으로 개인 대상 일정이 되지 않는다.
 */
class EventTitleParser {

    fun parse(rawTitle: String, rules: List<ScheduleTypeRule>): ParsedTitle {
        val title = rawTitle.trim()

        val roomType = parseRoomType(title)
        val withoutRoom = if (roomType != null) title.removePrefix("[$roomType]") else title

        val attendeeCode = parseAttendeeCode(withoutRoom)
        val cleanTitle = if (attendeeCode != null) {
            withoutRoom.removeSuffix("[$attendeeCode]").trim()
        } else {
            withoutRoom.trim()
        }

        val isMine = attendeeCode?.contains(MINE_MARKER) == true
        val scheduleType = matchScheduleType(cleanTitle, rules)
        val isTarget = isMine

        return ParsedTitle(
            roomType = roomType,
            attendeeCode = attendeeCode,
            isMine = isMine,
            cleanTitle = cleanTitle,
            scheduleType = scheduleType,
            isTarget = isTarget
        )
    }

    private fun parseRoomType(title: String): String? = when {
        title.startsWith("[$ROOM_TYPE_LARGE]") -> ROOM_TYPE_LARGE
        title.startsWith("[$ROOM_TYPE_SEMINAR]") -> ROOM_TYPE_SEMINAR
        else -> null
    }

    private fun parseAttendeeCode(title: String): String? =
        ATTENDEE_CODE_REGEX.find(title)?.groupValues?.get(1)

    private fun matchScheduleType(cleanTitle: String, rules: List<ScheduleTypeRule>): String {
        val sorted = rules.sortedBy { it.priority }
        for (rule in sorted) {
            if (cleanTitle.contains(rule.keyword, ignoreCase = true)) {
                return rule.scheduleType
            }
        }
        return DEFAULT_SCHEDULE_TYPE
    }

    companion object {
        const val DEFAULT_SCHEDULE_TYPE = "일반회의"
        const val ROOM_TYPE_LARGE = "대"
        const val ROOM_TYPE_SEMINAR = "세"
        const val MINE_MARKER = "종"

        /** 제목 끝의 마지막 `[...]`만 매칭. 내부는 `]`를 제외한 임의 문자(빈 문자열 허용). */
        private val ATTENDEE_CODE_REGEX = Regex("\\[([^\\]]*)\\]$")
    }
}
