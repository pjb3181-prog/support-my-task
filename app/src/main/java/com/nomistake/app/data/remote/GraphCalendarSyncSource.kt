package com.nomistake.app.data.remote

import com.nomistake.app.data.repository.CalendarSettingRepository
import com.nomistake.app.domain.CalendarSyncSource
import com.nomistake.app.domain.EventSource
import com.nomistake.app.domain.SyncedEvent
import java.time.Instant
import java.time.LocalDateTime
import java.time.OffsetDateTime
import java.time.ZoneId
import java.time.format.DateTimeFormatter

/**
 * Microsoft Graph 기반 캘린더 동기화 소스 (기존 fallback 경로 보존, Phase 4).
 *
 * Firestore(FIRESTORE_OUTLOOK)가 primary가 된 이후에도 Graph 코드/경로는 삭제하지 않는다.
 * 동일한 [CalendarSyncSource] 추상화를 구현하므로 교체 사용이 가능하다.
 */
class GraphCalendarSyncSource(
    private val authManager: MsalAuthManager,
    private val graphClient: GraphClient,
    private val calendarSettingRepository: CalendarSettingRepository,
    private val scopes: List<String> = listOf(MsalAuthManager.GRAPH_SCOPE_CALENDARS_READ)
) : CalendarSyncSource {

    override suspend fun fetchEvents(from: Instant, to: Instant): List<SyncedEvent> {
        val token = authManager.acquireTokenSilent(scopes)
            ?: throw GraphException("Graph 로그인 필요(sign in 먼저)")
        val calendarId = calendarSettingRepository.getSelectedCalendarId()
            ?: throw GraphException("MERI 캘린더 미선택(Find MERI calendar 먼저)")

        val events = graphClient.listEvents(token, calendarId, toIso(from), toIso(to))
        return events.mapNotNull { it.toSyncedEvent() }
    }

    private fun toIso(instant: Instant): String =
        instant.atOffset(java.time.ZoneOffset.UTC)
            .format(DateTimeFormatter.ISO_OFFSET_DATE_TIME)
}

/** GraphEvent → 소스 중립 SyncedEvent 매핑. 시간 파싱 실패 시 null(스킵). */
private fun GraphEvent.toSyncedEvent(): SyncedEvent? {
    val start = parseGraphDateTime(this.start) ?: return null
    val end = parseGraphDateTime(this.end) ?: return null
    return SyncedEvent(
        sourceType = EventSource.GRAPH,
        sourceEventId = this.id,
        title = this.subject ?: "",
        location = this.location?.displayName?.takeIf { it.isNotBlank() },
        startTime = start,
        endTime = end,
        isAllDay = this.isAllDay == true,
        isDeleted = this.isCancelled == true,
        seriesKeyHash = null,
        occurrenceKeyHash = null,
        graphImmutableId = this.id,
        iCalUId = this.iCalUId,
        seriesMasterId = this.seriesMasterId,
        eventType = this.type,
        changeKey = this.changeKey
    )
}

/**
 * Graph dateTime 파싱. Graph는 dateTime(ISO 8601) + timeZone(Windows 시간대명)을 분리해
 * 제공한다. Windows 시간대명("Korea Standard Time")→IANA 변환은 Android 표준 API에 없으므로,
 * offset 포함 형식이면 그대로 사용하고, 없으면 기기 기본 시간대(PC와 같은 한국 시간대 전제)로 해석한다.
 * fallback 경로이므로 이 정도 견고성으로 충분하다.
 */
private fun parseGraphDateTime(dt: GraphDateTime?): Instant? {
    val raw = dt?.dateTime?.trim().takeUnless { it.isNullOrBlank() } ?: return null
    return try {
        OffsetDateTime.parse(raw).toInstant()
    } catch (e: Exception) {
        try {
            LocalDateTime.parse(raw).atZone(ZoneId.systemDefault()).toInstant()
        } catch (e2: Exception) {
            null
        }
    }
}