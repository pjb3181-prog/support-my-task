package com.nomistake.app.data.remote

import com.nomistake.app.domain.EventSource
import com.nomistake.app.domain.SyncedEvent
import java.time.Instant
import java.time.LocalDateTime
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.time.format.DateTimeParseException

/**
 * Firestore events/{stableDocumentId} 문서 모델 — schema v1 (Phase 4C FirestoreSync.BuildFields 대응).
 *
 * PC Companion이 작성한 필드 그대로를 표현한다. Room Entity와 별개의 DTO이며,
 * Firestore SDK 타입(DocumentSnapshot 등)이 mapper를 넘어 domain/Room 계층으로 흐르지 않는다.
 *
 * [start]/[end]/[lastModified]/[sourceUpdatedAt]은 Outlook PC의 로컬 시간
 * "yyyy-MM-ddTHH:mm:ss" 형식(시간대 무표기)이다. PC와 Android가 같은 시간대(한국)라는
 * 운영 전제로 Android 기기 기본 시간대로 해석한다.
 */
data class FirestoreEventDto(
    /** 문서 경로 ID = occurrenceKeyHash = SHA-256(seriesKey|occurrenceKey) hex 32자. */
    val documentId: String,
    val schemaVersion: Long,
    val seriesKey: String,
    val occurrenceKey: String,
    val seriesKeyHash: String,
    val occurrenceKeyHash: String,
    val subject: String,
    val location: String?,
    val start: String,
    val end: String,
    val allDay: Boolean,
    val isRecurring: Boolean,
    /** 0/1/2/4 (olApptNotRecurring/Master/Occurrence/Exception) */
    val recurrenceState: Int,
    val sourceEntryId: String?,
    val lastModified: String?,
    /** true = 소스(Outlook)에서 삭제됨 → Android에서 soft delete. */
    val deleted: Boolean,
    val sourcePc: String?,
    val sourceUpdatedAt: String?
)

/**
 * DocumentSnapshot.data(Map) → [FirestoreEventDto] 순수 변환기.
 * Firestore는 정수를 Long으로, 누락 필드를 null로 반환하므로 안전하게 기본값 처리한다.
 */
object FirestoreDtoParser {

    fun fromMap(documentId: String, data: Map<String, Any?>): FirestoreEventDto {
        return FirestoreEventDto(
            documentId = documentId,
            schemaVersion = (data["schemaVersion"] as? Long) ?: 0L,
            seriesKey = data["seriesKey"] as? String ?: "",
            occurrenceKey = data["occurrenceKey"] as? String ?: "",
            seriesKeyHash = data["seriesKeyHash"] as? String ?: "",
            occurrenceKeyHash = data["occurrenceKeyHash"] as? String ?: "",
            subject = data["subject"] as? String ?: "",
            location = (data["location"] as? String)?.takeIf { it.isNotBlank() },
            start = data["start"] as? String ?: "",
            end = data["end"] as? String ?: "",
            allDay = data["allDay"] as? Boolean ?: false,
            isRecurring = data["isRecurring"] as? Boolean ?: false,
            recurrenceState = (data["recurrenceState"] as? Long)?.toInt() ?: 0,
            sourceEntryId = (data["sourceEntryId"] as? String)?.takeIf { it.isNotBlank() },
            lastModified = (data["lastModified"] as? String)?.takeIf { it.isNotBlank() },
            deleted = data["deleted"] as? Boolean ?: false,
            sourcePc = data["sourcePc"] as? String,
            sourceUpdatedAt = data["sourceUpdatedAt"] as? String
        )
    }
}

/** [FirestoreEventDto] → 소스 중립 [SyncedEvent] 매핑. 시간 파싱 실패 시 null(스킵). */
fun FirestoreEventDto.toSyncedEvent(zone: ZoneId): SyncedEvent? {
    val start = parseLocalIsoOrNull(start, zone) ?: return null
    val end = parseLocalIsoOrNull(end, zone) ?: return null
    return SyncedEvent(
        sourceType = EventSource.FIRESTORE_OUTLOOK,
        // documentId가 권위적(문서 경로 = 실제 identity). occurrenceKeyHash와 동일값이어도 이쪽을 쓴다.
        sourceEventId = documentId,
        title = subject,
        location = location?.takeIf { it.isNotBlank() },
        startTime = start,
        endTime = end,
        isAllDay = allDay,
        isDeleted = deleted,
        seriesKeyHash = seriesKeyHash.takeIf { it.isNotBlank() },
        occurrenceKeyHash = occurrenceKeyHash.takeIf { it.isNotBlank() },
        graphImmutableId = null,
        iCalUId = null,
        seriesMasterId = null,
        eventType = null,
        changeKey = null
    )
}

/**
 * PC Companion 로컬 시간 문자열("yyyy-MM-ddTHH:mm:ss", 시간대 무표기)을 [zone]으로 해석해
 * Instant로 변환한다. 형식 오류/빈 값이면 null.
 */
internal fun parseLocalIsoOrNull(value: String?, zone: ZoneId): Instant? {
    if (value.isNullOrBlank()) return null
    return try {
        val ldt = LocalDateTime.parse(value.trim(), DateTimeFormatter.ofPattern("yyyy-MM-dd'T'HH:mm:ss"))
        ldt.atZone(zone).toInstant()
    } catch (e: DateTimeParseException) {
        null
    }
}