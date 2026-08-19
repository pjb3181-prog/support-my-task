package com.nomistake.app.data.repository

import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import com.nomistake.app.data.local.db.AppDatabase
import com.nomistake.app.data.local.entity.ChecklistTemplateEntity
import com.nomistake.app.data.local.entity.EventEntity
import com.nomistake.app.data.local.entity.TemplateItemEntity
import com.nomistake.app.data.local.entity.TemplateKind
import kotlinx.coroutines.runBlocking
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import java.time.Instant
import java.util.concurrent.atomic.AtomicLong

/**
 * ChecklistRepository 통합 테스트 (Robolectric + in-memory Room).
 *
 * isTarget 판정, idempotency, target 전이, 템플릿 변경 독립성을 검증한다.
 */
@RunWith(RobolectricTestRunner::class)
class ChecklistRepositoryTest {

    private lateinit var db: AppDatabase
    private lateinit var repository: ChecklistRepository

    private val idCounter = AtomicLong(0)

    @Before
    fun setup() {
        db = Room.inMemoryDatabaseBuilder(
            ApplicationProvider.getApplicationContext(),
            AppDatabase::class.java
        ).allowMainThreadQueries().build()
        repository = ChecklistRepository(db.checklistDao(), db.templateDao())
    }

    @After
    fun teardown() {
        db.close()
    }

    // ── helpers ────────────────────────────────────────────────

    private suspend fun insertEvent(
        roomType: String?,
        scheduleType: String?,
        isTarget: Boolean
    ): Long {
        val n = idCounter.incrementAndGet()
        return db.eventDao().upsert(
            EventEntity(
                graphImmutableId = "immutable-$n",
                iCalUId = null,
                seriesMasterId = null,
                eventType = "singleInstance",
                changeKey = null,
                title = "test-$n",
                cleanTitle = "test-$n",
                roomType = roomType,
                attendeeCode = if (isTarget) "종" else "성",
                isMine = isTarget,
                scheduleType = scheduleType,
                isTarget = isTarget,
                isAllDay = false,
                startTime = Instant.now(),
                endTime = Instant.now(),
                location = null,
                isDeleted = false,
                lastSyncedAt = Instant.now()
            )
        )
    }

    private suspend fun insertTemplate(kind: TemplateKind, key: String, items: List<String>): Long {
        val templateId = db.templateDao().insertTemplate(
            ChecklistTemplateEntity(kind = kind, key = key, name = key)
        )
        items.forEachIndexed { i, text ->
            db.templateDao().insertTemplateItem(
                TemplateItemEntity(templateId = templateId, text = text, sortOrder = i)
            )
        }
        return templateId
    }

    // ── Case 2: roomType 없음 ──────────────────────────────────

    @Test
    fun `roomType null - TYPE 항목만 생성`() = runBlocking {
        insertTemplate(TemplateKind.TYPE, "LOPA", listOf("관련자료 확인", "노트북", "충전기"))
        val eventId = insertEvent(roomType = null, scheduleType = "LOPA", isTarget = true)

        val checklistId = repository.ensureChecklist(db.eventDao().getById(eventId)!!)

        assertNotNull(checklistId)
        assertEquals(
            listOf("관련자료 확인", "노트북", "충전기"),
            db.checklistDao().getItems(checklistId!!).map { it.text }
        )
    }

    // ── Case 3: 일반회의 fallback ──────────────────────────────

    @Test
    fun `scheduleType 일반회의 - 일반회의 템플릿 적용`() = runBlocking {
        insertTemplate(TemplateKind.TYPE, "일반회의", listOf("관련자료 확인"))
        val eventId = insertEvent(roomType = null, scheduleType = "일반회의", isTarget = true)

        val checklistId = repository.ensureChecklist(db.eventDao().getById(eventId)!!)

        assertNotNull(checklistId)
        assertEquals(
            listOf("관련자료 확인"),
            db.checklistDao().getItems(checklistId!!).map { it.text }
        )
    }

    // ── Case 8: isTarget=false ─────────────────────────────────

    @Test
    fun `isTarget false - Checklist 생성 안 함`() = runBlocking {
        insertTemplate(TemplateKind.TYPE, "LOPA", listOf("관련자료 확인", "노트북", "충전기"))
        val eventId = insertEvent(roomType = null, scheduleType = "LOPA", isTarget = false)

        val result = repository.ensureChecklist(db.eventDao().getById(eventId)!!)

        assertNull(result)
        assertEquals(0, db.checklistDao().countByEventId(eventId))
    }

    // ── Case 9: 기존 Checklist 존재 ────────────────────────────

    @Test
    fun `기존 Checklist 존재 - 재생성 없음, completed 유지`() = runBlocking {
        insertTemplate(TemplateKind.TYPE, "LOPA", listOf("관련자료 확인", "노트북", "충전기"))
        val eventId = insertEvent(roomType = null, scheduleType = "LOPA", isTarget = true)
        val event = db.eventDao().getById(eventId)!!

        val firstId = repository.ensureChecklist(event)!!
        val items = db.checklistDao().getItems(firstId)
        db.checklistDao().setCompleted(items[0].id, true, Instant.now())

        val secondId = repository.ensureChecklist(event)

        assertEquals(firstId, secondId)
        assertEquals(1, db.checklistDao().countByEventId(eventId))

        val after = db.checklistDao().getItems(firstId)
        assertEquals(3, after.size)
        assertTrue(after[0].isCompleted)
    }

    // ── Case 10: target false → true ──────────────────────────

    @Test
    fun `target false에서 true - 최초 생성`() = runBlocking {
        insertTemplate(TemplateKind.TYPE, "LOPA", listOf("관련자료 확인", "노트북", "충전기"))
        val eventId = insertEvent(roomType = null, scheduleType = "LOPA", isTarget = false)

        assertNull(repository.ensureChecklist(db.eventDao().getById(eventId)!!))

        db.eventDao().setTarget(eventId, true)
        val checklistId = repository.ensureChecklist(db.eventDao().getById(eventId)!!)

        assertNotNull(checklistId)
        assertEquals(3, db.checklistDao().getItems(checklistId!!).size)
    }

    // ── Case 11: target true → false → true ───────────────────

    @Test
    fun `target true에서 false로 갔다가 다시 true - 기존 재사용`() = runBlocking {
        insertTemplate(TemplateKind.TYPE, "LOPA", listOf("관련자료 확인", "노트북", "충전기"))
        val eventId = insertEvent(roomType = null, scheduleType = "LOPA", isTarget = true)

        val firstId = repository.ensureChecklist(db.eventDao().getById(eventId)!!)!!

        db.eventDao().setTarget(eventId, false)
        assertNull(repository.ensureChecklist(db.eventDao().getById(eventId)!!))

        db.eventDao().setTarget(eventId, true)
        val secondId = repository.ensureChecklist(db.eventDao().getById(eventId)!!)

        assertEquals(firstId, secondId)
        assertEquals(1, db.checklistDao().countByEventId(eventId))
    }

    // ── Case 12: 템플릿 변경 후 기존 Checklist 독립성 ──────────

    @Test
    fun `템플릿 변경 - 기존 Checklist 독립, 신규 일정에만 반영`() = runBlocking {
        val templateId = insertTemplate(
            TemplateKind.TYPE, "FIELD_WORK", listOf("노트북", "충전기", "안전화")
        )
        val eventId = insertEvent(roomType = null, scheduleType = "FIELD_WORK", isTarget = true)

        val checklistId = repository.ensureChecklist(db.eventDao().getById(eventId)!!)!!
        assertEquals(3, db.checklistDao().getItems(checklistId).size)

        // 템플릿에 항목 추가
        db.templateDao().insertTemplateItem(
            TemplateItemEntity(templateId = templateId, text = "안전모", sortOrder = 3)
        )

        // 기존 Checklist는 변경 없음
        assertEquals(3, db.checklistDao().getItems(checklistId).size)

        // 신규 일정은 4개 항목으로 생성
        val eventId2 = insertEvent(roomType = null, scheduleType = "FIELD_WORK", isTarget = true)
        val checklistId2 = repository.ensureChecklist(db.eventDao().getById(eventId2)!!)!!
        assertEquals(4, db.checklistDao().getItems(checklistId2).size)
    }

    // ── 전체 흐름: Event → Template → Checklist → Item → 재호출 ─

    @Test
    fun `전체 흐름 - 병합 생성 후 재호출 시 Checklist 하나만 존재`() = runBlocking {
        insertTemplate(TemplateKind.ROOM, "대", listOf("참석자 명단 받기", "관련자료 출력", "입구 팻말 준비"))
        insertTemplate(TemplateKind.TYPE, "LOPA", listOf("관련자료 확인", "노트북", "충전기"))
        val eventId = insertEvent(roomType = "대", scheduleType = "LOPA", isTarget = true)
        val event = db.eventDao().getById(eventId)!!

        val checklistId = repository.ensureChecklist(event)!!
        assertEquals(
            listOf("참석자 명단 받기", "관련자료 출력", "입구 팻말 준비", "관련자료 확인", "노트북", "충전기"),
            db.checklistDao().getItems(checklistId).map { it.text }
        )

        val again = repository.ensureChecklist(event)!!
        assertEquals(checklistId, again)
        assertEquals(1, db.checklistDao().countByEventId(eventId))
        assertEquals(6, db.checklistDao().getItems(checklistId).size)
    }
}

