package com.nomistake.app.domain

import java.time.Instant

/**
 * 일정 Event의 원본 소스 종류 (Phase 5 - source-neutral identity).
 *
 * - [FIRESTORE_OUTLOOK]: PC Companion(Outlook COM → Firestore)이 업로드한 문서.
 *   sourceEventId = Firestore document ID(SHA-256 기반 stableDocumentId).
 * - [GRAPH]: Microsoft Graph API(fallback 경로, Phase 4 보존).
 *   sourceEventId = Graph immutable id.
 *
 * Room unique identity = (sourceType, sourceEventId).
 * 원본 raw ID(Outlook GlobalAppointmentID 등)는 안드로이드에서 보관하지 않는다.
 */
enum class EventSource { FIRESTORE_OUTLOOK, GRAPH }

/**
 * 동기화 소스가 제공하는 일정 1건(소스 중립 형태).
 *
 * 파싱 전 상태이며, CalendarSyncRepository가 EventTitleParser로 파싱 후
 * EventEntity로 저장한다. Firestore SDK / Graph 모델 타입이 이 객체를 넘어
 * domain/repository 계층으로 흐르지 않는다.
 */
data class SyncedEvent(
    val sourceType: EventSource,
    val sourceEventId: String,
    val title: String,
    val location: String?,
    val startTime: Instant,
    val endTime: Instant,
    val isAllDay: Boolean,

    /** true면 소스에서 삭제됨(tombstone). Room soft-delete로 반영한다. */
    val isDeleted: Boolean,

    // Firestore(FIRESTORE_OUTLOOK) 전용 보조 필드(진단/매칭용, identity 아님)
    val seriesKeyHash: String? = null,
    val occurrenceKeyHash: String? = null,

    // Graph(GRAPH) 전용 보조 필드
    val graphImmutableId: String? = null,
    val iCalUId: String? = null,
    val seriesMasterId: String? = null,
    val eventType: String? = null,
    val changeKey: String? = null
)

/**
 * 캘린더 동기화 소스 추상화 (Phase 5).
 *
 * - FirestoreCalendarSyncSource : 현재 primary (PC Companion → Firestore 경로)
 * - GraphCalendarSyncSource     : 기존 fallback 보존
 *
 * [from]~[to] 범위 내 일정을 소스 중립 목록으로 반환한다.
 * 구현체는 범위를 쿼리 힌트로만 사용할 수 있다(정확성이 범위 필터보다 우선).
 */
interface CalendarSyncSource {
    suspend fun fetchEvents(from: Instant, to: Instant): List<SyncedEvent>
}