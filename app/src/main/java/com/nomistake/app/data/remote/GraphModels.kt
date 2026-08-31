package com.nomistake.app.data.remote

/**
 * Microsoft Graph API 응답 모델.
 *
 * Phase 4(연결 검증)에서 필요한 최소 필드만 정의한다.
 * 실제 회사 일정 데이터는 Git/로그에 남기지 않는다.
 */
data class GraphCalendar(
    val id: String,
    val name: String
)

data class GraphEvent(
    val id: String,
    val subject: String?,
    val start: GraphDateTime?,
    val end: GraphDateTime?,
    val isAllDay: Boolean?,
    val location: GraphLocation?,
    val type: String?,
    val seriesMasterId: String?,
    val iCalUId: String?,
    val changeKey: String?,
    val isCancelled: Boolean?
)

data class GraphDateTime(
    val dateTime: String?,
    val timeZone: String?
)

data class GraphLocation(
    val displayName: String?
)

/** GET /me/calendars 응답 래퍼 */
data class CalendarListResponse(
    val value: List<GraphCalendar>
)

/** calendarView 응답 래퍼 */
data class EventListResponse(
    val value: List<GraphEvent>
)
