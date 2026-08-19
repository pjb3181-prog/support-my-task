package com.nomistake.app.data.local.entity

import androidx.room.Entity
import androidx.room.Index
import androidx.room.PrimaryKey
import java.time.Instant

/**
 * Graph 동기화된 일정(이벤트/occurrence) 1건.
 *
 * 식별자 정책(Graph v1.0 공식 문서 기준):
 * - [graphImmutableId]: `Prefer: IdType="ImmutableId"` 헤더로 수신한 id. UNIQUE 기본 키.
 * - [iCalUId]: occurrence별 고유, 캘린더 간 안정. 보조 식별(폴백 매칭).
 * - [seriesMasterId]: 반복 일정 시리즈 마스터 id. 보조 식별.
 * - [changeKey]: 변경 감지 보조값(identity 아님).
 */
@Entity(
    tableName = "events",
    indices = [
        Index(value = ["graphImmutableId"], unique = true),
        Index(value = ["iCalUId"]),
        Index(value = ["seriesMasterId"]),
        Index(value = ["startTime"])
    ]
)
data class EventEntity(
    @PrimaryKey(autoGenerate = true) val id: Long = 0,

    // 식별자
    val graphImmutableId: String,
    val iCalUId: String?,
    val seriesMasterId: String?,
    val eventType: String, // singleInstance | occurrence | exception | seriesMaster
    val changeKey: String?,

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
    val isDeleted: Boolean = false, // soft-delete
    val lastSyncedAt: Instant
)
