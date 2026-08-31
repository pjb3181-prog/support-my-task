package com.nomistake.app.data.repository

import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import com.nomistake.app.data.local.db.AppDatabase
import com.nomistake.app.data.local.entity.ChecklistTemplateEntity
import com.nomistake.app.data.local.entity.ScheduleTypeRuleEntity
import com.nomistake.app.data.local.entity.TemplateItemEntity
import com.nomistake.app.data.local.entity.TemplateKind
import com.nomistake.app.domain.CalendarSyncSource
import com.nomistake.app.domain.EventSource
import com.nomistake.app.domain.SyncedEvent
import kotlinx.coroutines.runBlocking
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import java.io.IOException
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId

/**
 * CalendarSyncRepository 통합 테스트 (Robolectric + in-memory Room + fake sync source).
 * 실제 Firebase 연결 없이 검증: source-neutral identity, 기존 Parser 재사용,
 * checklist 생성/보존, idempotency, target 전이, tombstone/revive, fetch 실패 시 DB 미변경.
 * 실제 회사 일정 제목은 사용하지 않는다(합성 제목만).
 */
@RunWith(RobolectricTestRunner::class)
class CalendarSyncRepositoryTest {

    private lateinit var db: AppDatabase
    private lateinit var fakeSource: FakeCalendarSyncSource
    private lateinit var repository: CalendarSyncRepository

    private val from: Instant = LocalDate.of(2026, 8, 24)
        .atStartOfDay(ZoneId.of("Asia/Seoul")).toInstant()
    private val to: Instant = LocalDate.of(2026, 11, 29)
        .atStartOfDay(ZoneId.of("Asia/Seoul")).toInstant()

    @Before
    fun setup() {
        db = Room.inMemoryDatabaseBuilder(
            ApplicationProvider.getApplicationContext(),
            AppDatabase::class.java
        ).allowMainThreadQueries().build()
        fakeSource = FakeCalendarSyncSource()
        repository = CalendarSyncRepository(
            syncSource = fakeSource,
            eventDao = db.eventDao(),
            templateDao = db.templateDao(),
            checklistRepository = ChecklistRepository(db.checklistDao(), db.templateDao()),
            checklistDao = db.checklistDao(),
            settingDao = db.settingDao(),
            clock = { Instant.ofEpochMilli(1_000L) } // 테스트 결정성
        )
        kotlinx.coroutines.runBlocking { seedRulesAndTemplates() } // @Before는 non-suspend
    }

    @After
    fun teardown() {
        db.close()
    }

    // ── helpers ──────────────────────────────────────────────────

    /** Firestore 문서를 모사한 SyncedEvent(합성 제목, 한국 시간 오전 9시~11시). */
    private fun firestoreEvent(
        docId: String,
        subject: String,
        deleted: Boolean = false
    ): SyncedEvent = SyncedEvent(
        sourceType = EventSource.FIRESTORE_OUTLOOK,
        sourceEventId = docId,
        title = subject,
        location = "대회의실",
        startTime = Instant.parse("2026-09-01T00:00:00Z"), // 09:00 KST
        endTime = Instant.parse("2026-09-01T02:00:00Z"),   // 11:00 KST
        isAllDay = false,
        isDeleted = deleted,
        seriesKeyHash = "serieshash-$docId",
        occurrenceKeyHash = docId
    )

    private suspend fun seedRulesAndTemplates() {
        db.templateDao().insertScheduleTypeRule(
            ScheduleTypeRuleEntity(keyword = "HAZOP", scheduleType = "HAZOP", priority = 1)
        )
        db.templateDao().insertScheduleTypeRule(
            ScheduleTypeRuleEntity(keyword = "LOPA", scheduleType = "LOPA", priority = 2)
        )
        seedTemplate(TemplateKind.ROOM, "대", listOf("참석자 명단 받기", "관련자료 출력"))
        seedTemplate(TemplateKind.TYPE, "LOPA", listOf("관련자료 확인", "노트북", "충전기"))
    }

    private suspend fun seedTemplate(kind: TemplateKind, key: String, items: List<String>) {
        val templateId = db.templateDao().insertTemplate(
            ChecklistTemplateEntity(kind = kind, key = key, name = key)
        )
        items.forEachIndexed { i, text ->
            db.templateDao().insertTemplateItem(
                TemplateItemEntity(templateId = templateId, text = text, sortOrder = i)
            )
        }
    }

    private suspend fun sync(): SyncStats = repository.syncNow(from, to)

    // ── Gate C/D/E: 최초 sync ────────────────────────────────────

    @Test
    fun `firestore target event - source neutral identity 저장 + checklist 생성`() = runBlocking {
        fakeSource.events.add(firestoreEvent("doc-1", "[대]테스트-LOPA[용종]"))

        val stats = sync()

        assertEquals(1, stats.fetched)
        assertEquals(1, stats.target)
        assertEquals(1, stats.inserted)
        assertEquals(0, stats.updated)
        assertEquals(1, stats.checklistCreated)

        val event = db.eventDao().getBySource(EventSource.FIRESTORE_OUTLOOK, "doc-1")
        assertNotNull(event)
        event!!
        assertEquals("doc-1", event.sourceEventId)
        assertNull(event.graphImmutableId) // Firestore 문서 ID를 graphImmutableId에 넣지 않는다
        assertEquals("doc-1", event.occurrenceKeyHash)
        // 기존 EventTitleParser 재사용 (Gate D)
        assertEquals("대", event.roomType)
        assertEquals("용종", event.attendeeCode)
        assertTrue(event.isMine)
        assertEquals("테스트-LOPA", event.cleanTitle)
        assertEquals("LOPA", event.scheduleType)
        assertTrue(event.isTarget)
        assertFalse(event.isDeleted)
        // Gate E: checklist 생성(ROOM 2 + TYPE 3 = 5항목)
        val checklist = db.checklistDao().getByEventId(event.id)
        assertNotNull(checklist)
        assertEquals(5, db.checklistDao().getItems(checklist!!.id).size)
    }

    @Test
    fun `non-target event - checklist 미생성`() = runBlocking {
        fakeSource.events.add(firestoreEvent("doc-1", "테스트-LOPA[성]"))

        val stats = sync()

        assertEquals(0, stats.target)
        assertEquals(0, stats.checklistCreated)

        val event = db.eventDao().getBySource(EventSource.FIRESTORE_OUTLOOK, "doc-1")
        assertNotNull(event)
        assertFalse(event!!.isTarget)
        assertEquals(0, db.checklistDao().countByEventId(event.id))
    }

    @Test
    fun `동일 문서 2회 sync - idempotent (event 1개, checklist 1개)`() = runBlocking {
        fakeSource.events.add(firestoreEvent("doc-1", "[대]테스트-LOPA[용종]"))

        val first = sync()
        val second = sync()

        assertEquals(1, first.inserted)
        assertEquals(0, second.inserted)
        assertEquals(1, second.updated)
        assertEquals(0, second.checklistCreated)

        assertEquals(1, db.eventDao().countAll())
        val event = db.eventDao().getBySource(EventSource.FIRESTORE_OUTLOOK, "doc-1")
        assertEquals(1, db.checklistDao().countByEventId(event!!.id))
        assertEquals(5, db.checklistDao().getItems(db.checklistDao().getByEventId(event.id)!!.id).size)
    }

    @Test
    fun `target에서 non-target으로 제목 변경 - event 갱신, checklist 보존`() = runBlocking {
        fakeSource.events.add(firestoreEvent("doc-1", "[대]테스트-LOPA[용종]"))
        sync()

        // 같은 문서 ID, 제목만 non-target으로 변경
        fakeSource.events.clear()
        fakeSource.events.add(firestoreEvent("doc-1", "테스트-LOPA[성]"))

        val second = sync()

        assertEquals(0, second.checklistCreated)
        val event = db.eventDao().getBySource(EventSource.FIRESTORE_OUTLOOK, "doc-1")
        assertNotNull(event)
        assertFalse(event!!.isTarget)
        assertEquals("성", event.attendeeCode)
        // checklist DB는 보존(활성 목록에서만 제외됨)
        assertEquals(1, db.checklistDao().countByEventId(event.id))
    }

    @Test
    fun `non-target에서 target으로 제목 변경 - checklist 최초 생성`() = runBlocking {
        fakeSource.events.add(firestoreEvent("doc-1", "테스트-LOPA[성]"))
        sync()

        fakeSource.events.clear()
        fakeSource.events.add(firestoreEvent("doc-1", "[대]테스트-LOPA[용종]"))

        val second = sync()

        assertEquals(1, second.checklistCreated)
        val event = db.eventDao().getBySource(EventSource.FIRESTORE_OUTLOOK, "doc-1")
        assertNotNull(event)
        assertTrue(event!!.isTarget)
        assertEquals(5, db.checklistDao().getItems(db.checklistDao().getByEventId(event.id)!!.id).size)
    }

    // ── tombstone / revive ──────────────────────────────────────

    @Test
    fun `tombstone 문서 - event soft delete + checklist 보존`() = runBlocking {
        fakeSource.events.add(firestoreEvent("doc-1", "[대]테스트-LOPA[용종]"))
        sync()

        fakeSource.events.clear()
        fakeSource.events.add(firestoreEvent("doc-1", "[대]테스트-LOPA[용종]", deleted = true))

        val second = sync()

        assertEquals(1, second.tombstoneSeen)
        assertEquals(0, second.revived)
        val event = db.eventDao().getBySource(EventSource.FIRESTORE_OUTLOOK, "doc-1")
        assertNotNull(event)
        assertTrue(event!!.isDeleted) // hard delete 아님 — soft delete
        // checklist는 즉시 삭제하지 않는다(revive 대비)
        assertEquals(1, db.checklistDao().countByEventId(event.id))
    }

    @Test
    fun `revive - tombstone 부활 시 isDeleted 해제 + 기존 checklist 재사용`() = runBlocking {
        fakeSource.events.add(firestoreEvent("doc-1", "[대]테스트-LOPA[용종]"))
        sync()
        fakeSource.events.clear()
        fakeSource.events.add(firestoreEvent("doc-1", "[대]테스트-LOPA[용종]", deleted = true))
        sync()

        fakeSource.events.clear()
        fakeSource.events.add(firestoreEvent("doc-1", "[대]테스트-LOPA[용종]"))

        val third = sync()

        assertEquals(1, third.revived)
        assertEquals(0, third.checklistCreated) // 기존 checklist 재사용(신규 생성 없음)

        val event = db.eventDao().getBySource(EventSource.FIRESTORE_OUTLOOK, "doc-1")
        assertNotNull(event)
        assertFalse(event!!.isDeleted)
        assertEquals(1, db.checklistDao().countByEventId(event.id))
        assertEquals(5, db.checklistDao().getItems(db.checklistDao().getByEventId(event.id)!!.id).size)
    }

    // ── 사용자 상태 보존 ─────────────────────────────────────────

    @Test
    fun `metadata 재sync - completed checklist 항목과 PK 보존`() = runBlocking {
        fakeSource.events.add(firestoreEvent("doc-1", "[대]테스트-LOPA[용종]"))
        sync()

        val before = db.eventDao().getBySource(EventSource.FIRESTORE_OUTLOOK, "doc-1")!!
        val checklistId = db.checklistDao().getByEventId(before.id)!!.id
        val firstItem = db.checklistDao().getItems(checklistId).first()
        db.checklistDao().setCompleted(firstItem.id, true, Instant.ofEpochMilli(1_000L))

        // 같은 문서 재sync(내용 동일 → update 경로)
        sync()

        val after = db.eventDao().getBySource(EventSource.FIRESTORE_OUTLOOK, "doc-1")!!
        assertEquals(before.id, after.id) // PK 유지 → checklist 참조 보존
        val items = db.checklistDao().getItems(checklistId)
        assertEquals(5, items.size)
        assertTrue(items.first { it.id == firstItem.id }.isCompleted) // 완료 상태 유지
    }

    // ── 상태 기록 / 실패 안전 ─────────────────────────────────────

    @Test
    fun `sync 성공 시 lastSyncAt 기록`() = runBlocking {
        fakeSource.events.add(firestoreEvent("doc-1", "[대]테스트-LOPA[용종]"))

        assertNull(repository.getLastSyncTime())
        sync()
        assertEquals("1970-01-01T00:00:01Z", repository.getLastSyncTime())
    }

    @Test
    fun `fetch 실패 시 DB 미변경 (Room source of truth 유지)`() = runBlocking {
        fakeSource.events.add(firestoreEvent("doc-1", "[대]테스트-LOPA[용종]"))
        sync()
        assertEquals(1, db.eventDao().countAll())

        fakeSource.failNext = true
        try {
            sync()
            throw AssertionError("예외가 전파되어야 한다")
        } catch (e: IOException) {
            // 예외 전파 확인
        }

        // 기존 Room 데이터는 그대로
        assertEquals(1, db.eventDao().countAll())
        val event = db.eventDao().getBySource(EventSource.FIRESTORE_OUTLOOK, "doc-1")
        assertNotNull(event)
        assertFalse(event!!.isDeleted)
    }
}

/** 목업 동기화 소스 — 실패 주입과 고정 목록 반환을 지원한다. */
private class FakeCalendarSyncSource : CalendarSyncSource {
    val events = mutableListOf<SyncedEvent>()
    var failNext = false

    override suspend fun fetchEvents(from: Instant, to: Instant): List<SyncedEvent> {
        if (failNext) throw IOException("network down")
        return events.toList()
    }
}