package com.nomistake.app.data.repository

import com.nomistake.app.data.local.dao.ChecklistDao
import com.nomistake.app.data.local.dao.EventDao
import com.nomistake.app.data.local.dao.SettingDao
import com.nomistake.app.data.local.dao.TemplateDao
import com.nomistake.app.data.local.entity.EventEntity
import com.nomistake.app.data.local.entity.SettingEntity
import com.nomistake.app.domain.CalendarSyncSource
import com.nomistake.app.domain.EventTitleParser
import com.nomistake.app.domain.ParsedTitle
import com.nomistake.app.domain.ScheduleTypeRule
import com.nomistake.app.domain.SyncedEvent
import java.time.Instant

/** 1회 sync 실행 결과 통계 (Phase 5 Debug UI 표시용). */
data class SyncStats(
    /** 소스에서 읽어온 문서 수(deleted 포함). */
    val fetched: Int,
    /** 파싱 결과 target인 live 일정 수. */
    val target: Int,
    /** Room에 신규 insert된 Event 수. */
    val inserted: Int,
    /** Room에 실제 변경이 있어 UPDATE된 Event 수(내용 동일 SkipSame 제외). */
    val updated: Int,
    /** Firestore source metadata가 기존과 완전 동일해 UPDATE를 생략한 Event 수(SkipSame). */
    val skippedSame: Int,
    /** 이번 sync에서 신규 생성된 Checklist 수. */
    val checklistCreated: Int,
    /** 읽은 문서 중 tombstone(deleted=true) 수. */
    val tombstoneSeen: Int,
    /** tombstone이었다가 이번 sync에서 부활(revive)된 Event 수. */
    val revived: Int
)

/**
 * Firestore → Room 동기화 오케스트레이션 (Phase 5).
 *
 * flow:
 * CalendarSyncSource(Firestore primary / Graph fallback)
 *   → SyncedEvent → EventTitleParser(기존 파서 재사용)
 *   → EventEntity upsert(getBySource → insert/update, PK 유지)
 *   → ChecklistRepository.ensureChecklist(target만, 기존 checklist 보존)
 *
 * 데이터 보존 정책 (Phase 3 정책 유지):
 * - 재동기화로 Event metadata는 갱신하되 Checklist(completed/EVENT_ONLY 항목)는 유지한다.
 * - 재동기화 시 소스 제어 metadata가 기존과 완전 동일하면 Room UPDATE를 생략한다(SkipSame).
 *   비교 대상은 Firestore DTO에서 온 필드(seriesKeyHash/occurrenceKeyHash/title/isAllDay/
 *   startTime/endTime/location/isDeleted) + 제목 재파싱 결과(cleanTitle/roomType/attendeeCode/
 *   isMine/scheduleType/isTarget — 소스 title과 파싱 규칙의 결정적 함수)뿐이다.
 *   checklist 상태/EVENT_ONLY 항목/기타 Android local state는 비교·overwrite 대상에 넣지
 *   않는다(EventEntity에 존재하지도 않는다 — 별도 테이블). lastSyncedAt은 sync bookkeeping이라
 *   비교에서 제외하고(제외하지 않으면 매 sync마다 update 발생) 실제 변경 시에만 갱신한다.
 * - Checklist 있으면 재생성하지 않는다(ensureChecklist idempotency).
 * - target→non-target: checklist DB는 보존, 활성 UI(observeActiveEvents)에서만 제외.
 * - non-target→target: checklist 없을 때 최초 생성.
 * - tombstone(deleted=true): Event soft-delete만. checklist는 즉시 삭제하지 않는다(revive 대비).
 * - revive(deleted=false 복귀): isDeleted 해제 + 기존 checklist 재사용.
 * - non-target live 일정도 Room에 저장한다(동기화 identity 관리) — 활성 목록은
 *   isTarget=1 필터로 자동 제외된다. hard delete는 하지 않는다.
 *
 * 실패 안전: 소스 조회 실패 시 예외를 그대로 던지고 DB는 건드리지 않는다(Room source of truth 유지).
 */
class CalendarSyncRepository(
    private val syncSource: CalendarSyncSource,
    private val eventDao: EventDao,
    private val templateDao: TemplateDao,
    private val checklistRepository: ChecklistRepository,
    private val checklistDao: ChecklistDao,
    private val settingDao: SettingDao,
    private val parser: EventTitleParser = EventTitleParser(),
    private val clock: () -> Instant = { Instant.now() }
) {

    suspend fun syncNow(from: Instant, to: Instant): SyncStats {
        val synced = syncSource.fetchEvents(from, to)
        val rules = templateDao.getScheduleTypeRules()
            .map { ScheduleTypeRule(it.keyword, it.scheduleType, it.priority) }

        var inserted = 0
        var updated = 0
        var skippedSame = 0
        var checklistCreated = 0
        var tombstoneSeen = 0
        var revived = 0
        var targetCount = 0

        for (event in synced) {
            val parsed = parser.parse(event.title, rules)
            if (!event.isDeleted && parsed.isTarget) targetCount++
            if (event.isDeleted) tombstoneSeen++

            val existing = eventDao.getBySource(event.sourceType, event.sourceEventId)
            val now = clock()

            if (existing == null) {
                val id = eventDao.insertIgnore(event.toEntity(parsed, now))
                if (id == -1L) continue // unique 충돌(이론적 race) → 다음 sync에서 자가수복
                inserted++
                if (!event.isDeleted && parsed.isTarget) {
                    if (ensureChecklistIfTarget(id)) checklistCreated++
                }
            } else {
                // 소스 제어 metadata(+ 제목 재파싱 결과)로 재작성 candidate를 만든다.
                // lastSyncedAt은 Android sync bookkeeping이라 비교에서 제외(기존값 유지) —
                // 이 값을 비교에 넣으면 매 sync마다 달라져 항상 update가 발생한다.
                // checklist 상태/EVENT_ONLY 항목은 EventEntity에 없으므로(별도 테이블)
                // 비교·overwrite 대상이 될 수 없다.
                val candidate = existing.copy(
                    seriesKeyHash = event.seriesKeyHash,
                    occurrenceKeyHash = event.occurrenceKeyHash,
                    title = event.title,
                    cleanTitle = parsed.cleanTitle,
                    roomType = parsed.roomType,
                    attendeeCode = parsed.attendeeCode,
                    isMine = parsed.isMine,
                    scheduleType = parsed.scheduleType,
                    isTarget = parsed.isTarget,
                    isAllDay = event.isAllDay,
                    startTime = event.startTime,
                    endTime = event.endTime,
                    location = event.location,
                    isDeleted = event.isDeleted,
                    lastSyncedAt = existing.lastSyncedAt
                )
                if (candidate == existing) {
                    // SkipSame: source metadata 완전 동일 → Room 재기록(UPDATE) 생략.
                    skippedSame++
                } else {
                    eventDao.update(candidate.copy(lastSyncedAt = now))
                    updated++
                    if (existing.isDeleted && !event.isDeleted) revived++
                }
                if (!event.isDeleted && parsed.isTarget) {
                    if (ensureChecklistIfTarget(existing.id)) checklistCreated++
                }
            }
        }

        // 마지막 성공 sync 시각 기록(실패 시 이 지점에 도달하지 않으므로 항상 성공 의미).
        settingDao.put(SettingEntity(KEY_LAST_SYNC_AT, clock().toString()))

        return SyncStats(
            fetched = synced.size,
            target = targetCount,
            inserted = inserted,
            updated = updated,
            skippedSame = skippedSame,
            checklistCreated = checklistCreated,
            tombstoneSeen = tombstoneSeen,
            revived = revived
        )
    }

    /** 마지막 성공 sync 시각(없으면 null). */
    suspend fun getLastSyncTime(): String? = settingDao.get(KEY_LAST_SYNC_AT)?.value

    /**
     * target live Event에 대해 Checklist를 보장한다.
     * @return 이번 호출로 checklist를 신규 생성했으면 true(기존 재사용이면 false).
     */
    private suspend fun ensureChecklistIfTarget(eventId: Long): Boolean {
        if (checklistDao.countByEventId(eventId) > 0) {
            // 이미 있으면 재생성하지 않는다(completed/사용자 항목 보존).
            return false
        }
        val event = eventDao.getById(eventId) ?: return false
        return checklistRepository.ensureChecklist(event) != null
    }

    /** SyncedEvent + 파싱 결과 → Room 저장용 Entity. */
    private fun SyncedEvent.toEntity(parsed: ParsedTitle, now: Instant): EventEntity =
        EventEntity(
            sourceType = sourceType,
            sourceEventId = sourceEventId,
            graphImmutableId = graphImmutableId,
            iCalUId = iCalUId,
            seriesMasterId = seriesMasterId,
            eventType = eventType,
            changeKey = changeKey,
            seriesKeyHash = seriesKeyHash,
            occurrenceKeyHash = occurrenceKeyHash,
            title = title,
            cleanTitle = parsed.cleanTitle,
            roomType = parsed.roomType,
            attendeeCode = parsed.attendeeCode,
            isMine = parsed.isMine,
            scheduleType = parsed.scheduleType,
            isTarget = parsed.isTarget,
            isAllDay = isAllDay,
            startTime = startTime,
            endTime = endTime,
            location = location,
            isDeleted = isDeleted,
            lastSyncedAt = now
        )

    companion object {
        const val KEY_LAST_SYNC_AT = "lastSuccessfulSyncAt"
    }
}