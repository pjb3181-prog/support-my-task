package com.nomistake.app.data.local.entity

import androidx.room.Entity
import androidx.room.Index
import androidx.room.PrimaryKey
import com.nomistake.app.domain.EventSource
import java.time.Instant

/**
 * 동기화된 일정(이벤트/occurrence) 1건 — source-neutral 구조 (Phase 5).
 *
 * 식별자 정책:
 * - unique identity = ([sourceType], [sourceEventId]).
 *   - FIRESTORE_OUTLOOK: sourceEventId = Firestore 문서 ID(SHA-256 기반 stableDocumentId)
 *   - GRAPH: sourceEventId = Graph immutable id (기존 경로 보존)
 * - Firestore document ID를 graphImmutableId에 대입하지 않는다(소스 혼동 방지).
 *
 * 소스별 보조 식별자(null 허용 — 해당 소스에서만 존재):
 * - [graphImmutableId]: Graph 전용. `Prefer: IdType="ImmutableId"` id. (기존 v1 primary identity)
 * - [iCalUId] / [seriesMasterId] / [eventType] / [changeKey]: Graph 전용 보조값.
 * - [seriesKeyHash] / [occurrenceKeyHash]: Firestore 전용(매칭/진단용, identity 아님).
 *
 * 원본 raw ID(Outlook GlobalAppointmentID/EntryID)는 안드로이드에 저장하지 않는다.
 */
@Entity(
    tableName = "events",
    indices = [
        Index(value = ["sourceType", "sourceEventId"], unique = true),
        Index(value = ["graphImmutableId"], unique = true),
        Index(value = ["iCalUId"]),
        Index(value = ["seriesMasterId"]),
        Index(value = ["startTime"])
    ]
)
data class EventEntity(
    @PrimaryKey(autoGenerate = true) val id: Long = 0,

    // source-neutral identity (unique)
    val sourceType: EventSource,
    val sourceEventId: String,

    // 소스별 보조 식별자 (nullable)
    val graphImmutableId: String?,
    val iCalUId: String?,
    val seriesMasterId: String?,
    val eventType: String?,      // singleInstance | occurrence | exception | seriesMaster
    val changeKey: String?,
    val seriesKeyHash: String?,      // Firestore 전용 (SHA-256 hex)
    val occurrenceKeyHash: String?,  // Firestore 전용 (문서 ID와 동일)

    // 원본/파싱 결과
    val title: String,
    val cleanTitle: String,
    val roomType: String?,      // "대" | "세" | null
    val attendeeCode: String?,  // 마지막 대괄호 내부 문자열
    val isMine: Boolean,
    val scheduleType: String?,  // FIELD_WORK | HAZOP | LOPA | 면담 | 화상회의 | 일반회의 | null
    val isTarget: Boolean,      // isMine || (roomType != null)

    // 시간/장소
    val isAllDay: Boolean,
    val startTime: Instant,
    val endTime: Instant,
    val location: String?,

    // 상태
    val isDeleted: Boolean = false, // soft-delete (Firestore tombstone 포함)
    val lastSyncedAt: Instant
)
