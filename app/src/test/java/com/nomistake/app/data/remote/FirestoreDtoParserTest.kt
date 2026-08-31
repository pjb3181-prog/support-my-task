package com.nomistake.app.data.remote

import com.nomistake.app.domain.EventSource
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.Instant
import java.time.ZoneId

/**
 * FirestoreEventDto / FirestoreDtoParser / toSyncedEvent 단위 테스트 (JVM, 순수 로직).
 *
 * Firestore의 실제 타입(Long 정수, Boolean, String, null)으로 map을 만들어
 * PC Companion의 schema v1 문서 역직렬화를 검증한다.
 * 실제 회사 일정 제목은 사용하지 않는다(합성 제목만).
 */
class FirestoreDtoParserTest {

    private val seoul = ZoneId.of("Asia/Seoul")

    /** Phase 4C FirestoreSync.BuildFields가 생성하는 schema v1 문서와 동일한 구조. */
    private fun schemaV1Map(
        subject: String = "[대]테스트-LOPA[용종]",
        deleted: Boolean = false
    ): Map<String, Any?> = mapOf(
        "schemaVersion" to 1L,
        "seriesKey" to "series-key-sample",
        "occurrenceKey" to "series-key-sample",
        "seriesKeyHash" to "aabb00112233445566778899aabbccdd",
        "occurrenceKeyHash" to "112233445566778899aabbccddeeff00",
        "subject" to subject,
        "location" to "대회의실",
        "start" to "2026-09-01T09:00:00",
        "end" to "2026-09-01T11:00:00",
        "allDay" to false,
        "isRecurring" to false,
        "recurrenceState" to 0L,
        "sourceEntryId" to "entry-id-sample",
        "lastModified" to "2026-08-30T10:00:00",
        "deleted" to deleted,
        "sourcePc" to "pc-abcd1234",
        "sourceUpdatedAt" to "2026-08-30T12:00:00"
    )

    // ── fromMap ─────────────────────────────────────────────────

    @Test
    fun `fromMap - schema v1 전체 필드 매핑`() {
        val dto = FirestoreDtoParser.fromMap("112233445566778899aabbccddeeff00", schemaV1Map())

        assertEquals("112233445566778899aabbccddeeff00", dto.documentId)
        assertEquals(1L, dto.schemaVersion)
        assertEquals("series-key-sample", dto.seriesKey)
        assertEquals("aabb00112233445566778899aabbccdd", dto.seriesKeyHash)
        assertEquals("112233445566778899aabbccddeeff00", dto.occurrenceKeyHash)
        assertEquals("[대]테스트-LOPA[용종]", dto.subject)
        assertEquals("대회의실", dto.location)
        assertEquals("2026-09-01T09:00:00", dto.start)
        assertEquals("2026-09-01T11:00:00", dto.end)
        assertFalse(dto.allDay)
        assertFalse(dto.isRecurring)
        assertEquals(0, dto.recurrenceState)
        assertFalse(dto.deleted)
        assertEquals("pc-abcd1234", dto.sourcePc)
    }

    @Test
    fun `fromMap - 필드 누락과 타입 불일치 시 안전한 기본값`() {
        val dto = FirestoreDtoParser.fromMap(
            "doc-id",
            mapOf(
                "subject" to "회의",
                // Firestore 정수는 Long으로 들어온다(Int 아님)
                "recurrenceState" to 2L,
                "schemaVersion" to 1L
            )
        )

        assertEquals("doc-id", dto.documentId)
        assertEquals("회의", dto.subject)
        assertEquals(2, dto.recurrenceState)
        assertEquals(1L, dto.schemaVersion)
        assertNull(dto.location)
        assertEquals("", dto.start)
        assertEquals("", dto.end)
        assertFalse(dto.deleted)
        assertFalse(dto.allDay)
        assertNull(dto.lastModified)
    }

    // ── toSyncedEvent ───────────────────────────────────────────

    @Test
    fun `toSyncedEvent - 로컬 ISO 시간을 기기 zone 기준 Instant로 변환`() {
        val dto = FirestoreDtoParser.fromMap("doc-1", schemaV1Map())

        val event = dto.toSyncedEvent(seoul)

        assertNotNull(event)
        event!!
        // "2026-09-01T09:00:00" KST = "2026-09-01T00:00:00Z" UTC
        assertEquals(Instant.parse("2026-09-01T00:00:00Z"), event.startTime)
        assertEquals(Instant.parse("2026-09-01T02:00:00Z"), event.endTime)
        assertEquals(EventSource.FIRESTORE_OUTLOOK, event.sourceType)
        assertEquals("doc-1", event.sourceEventId)
        assertEquals("[대]테스트-LOPA[용종]", event.title)
        assertFalse(event.isDeleted)
        assertEquals("aabb00112233445566778899aabbccdd", event.seriesKeyHash)
        assertEquals("112233445566778899aabbccddeeff00", event.occurrenceKeyHash)
        // Firestore 이벤트에는 Graph 보조 식별자가 없다
        assertNull(event.graphImmutableId)
        assertNull(event.iCalUId)
    }

    @Test
    fun `toSyncedEvent - tombstone 문서는 isDeleted true`() {
        val dto = FirestoreDtoParser.fromMap("doc-1", schemaV1Map(deleted = true))

        val event = dto.toSyncedEvent(seoul)

        assertNotNull(event)
        assertTrue(event!!.isDeleted)
    }

    @Test
    fun `toSyncedEvent - start 파싱 실패 시 null 반환(스킵)`() {
        val map = schemaV1Map().toMutableMap()
        map["start"] = "not-a-date"
        val dto = FirestoreDtoParser.fromMap("doc-1", map)

        assertNull(dto.toSyncedEvent(seoul))
    }

    @Test
    fun `toSyncedEvent - 빈 start도 null 반환(스킵)`() {
        val map = schemaV1Map().toMutableMap()
        map["start"] = ""
        val dto = FirestoreDtoParser.fromMap("doc-1", map)

        assertNull(dto.toSyncedEvent(seoul))
    }

    @Test
    fun `toSyncedEvent - allDay 일정 시간 그대로 유지`() {
        val map = schemaV1Map().toMutableMap()
        map["allDay"] = true
        map["start"] = "2026-09-01T00:00:00"
        map["end"] = "2026-09-02T00:00:00"
        val dto = FirestoreDtoParser.fromMap("doc-1", map)

        val event = dto.toSyncedEvent(seoul)

        assertNotNull(event)
        assertTrue(event!!.isAllDay)
        assertEquals(Instant.parse("2026-08-31T15:00:00Z"), event.startTime)
    }
}