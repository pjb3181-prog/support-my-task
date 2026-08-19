package com.nomistake.app.domain

/**
 * Event 제목 파싱 결과.
 *
 * @param roomType "대" | "세" | null (제목 맨 앞의 `[대]`/`[세]`만 인식)
 * @param attendeeCode 제목 마지막 `[...]` 내부 문자열 | null
 * @param isMine attendeeCode 내부에 "종"이 있는지 여부
 * @param cleanTitle room tag와 마지막 attendeeCode를 제거한 나머지(앞뒤 공백 제거)
 * @param scheduleType cleanTitle에 대한 ScheduleTypeRule 매칭 결과 (매칭 실패 시 "일반회의")
 * @param isTarget isMine || (roomType != null)
 */
data class ParsedTitle(
    val roomType: String?,
    val attendeeCode: String?,
    val isMine: Boolean,
    val cleanTitle: String,
    val scheduleType: String,
    val isTarget: Boolean
)
