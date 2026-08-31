package com.nomistake.app.data.local.db

import androidx.room.testing.MigrationTestHelper
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

/**
 * Room v1 → v2 migration 테스트 (MigrationTestHelper + app/schemas JSON).
 *
 * 검증:
 * - 기존(Graph v1) 행이 sourceType='GRAPH', sourceEventId=graphImmutableId로 이전
 * - PK(id) 유지 → 기존 checklist의 eventId 참조 보존
 * - 마이그레이션 후 Room v2 스키마 검증 통과(인덱스 포함)
 */
@RunWith(RobolectricTestRunner::class)
class MigrationTest {

    @Test
    fun `migrate 1 to 2 - graph identity 이전, PK와 checklist 참조 보존`() {
        val helper = MigrationTestHelper(
            InstrumentationRegistry.getInstrumentation(),
            AppDatabase::class.java
        )
        val dbName = "migration-test.db"

        // ── v1 스키마 DB 생성 + Graph 이벤트/checklist 데이터 입력 ──
        helper.createDatabase(dbName, 1).use { db ->
            db.execSQL(
                """
                INSERT INTO events (
                    graphImmutableId, iCalUId, seriesMasterId, eventType, changeKey,
                    title, cleanTitle, roomType, attendeeCode, isMine, scheduleType,
                    isTarget, isAllDay, startTime, endTime, location, isDeleted, lastSyncedAt
                ) VALUES (
                    'g-1', 'ical-1', NULL, 'singleInstance', NULL,
                    '테스트 제목', '테스트 제목', '대', '용종', 1, 'LOPA',
                    1, 0, 1000, 2000, '대회의실', 0, 1000
                )
                """.trimIndent()
            )
            db.execSQL(
                "INSERT INTO checklists (eventId, scheduleType, createdAt) VALUES (1, 'LOPA', 1000)"
            )
        }

        // ── migration 실행 + Room v2 스키마 자동 검증 ──
        helper.runMigrationsAndValidate(dbName, 2, true, AppDatabase.MIGRATION_1_2).use { db ->
            db.query(
                "SELECT id, sourceType, sourceEventId, graphImmutableId, title, isDeleted FROM events"
            ).use { c ->
                assertTrue(c.moveToFirst())
                assertEquals(1L, c.getLong(0))              // PK 유지
                assertEquals("GRAPH", c.getString(1))        // sourceType 이전
                assertEquals("g-1", c.getString(2))          // sourceEventId = graphImmutableId
                assertEquals("g-1", c.getString(3))         // graphImmutableId 보존
                assertEquals("테스트 제목", c.getString(4))
                assertEquals(0, c.getInt(5))                  // live
            }
            // checklist의 eventId 참조가 그대로 유효
            db.query("SELECT COUNT(*) FROM checklists WHERE eventId = 1").use { c ->
                assertTrue(c.moveToFirst())
                assertEquals(1, c.getInt(0))
            }
        }
    }
}