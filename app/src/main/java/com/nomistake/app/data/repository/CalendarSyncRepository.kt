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

data class SyncStats(
    val fetched: Int,
    val target: Int,
    val inserted: Int,
    val updated: Int,
    val skippedSame: Int,
    val checklistCreated: Int,
    val tombstoneSeen: Int,
    val revived: Int
)

/**
 * Firestore → Room 동기화 오케스트레이션.
 *
 * Phase 12부터 대상 일정 식별문자는 사용자별 settings 값(KEY_MINE_MARKER)을 사용한다.
 * 기본값은 기존 사용자 호환을 위해 "종"이다. 일정/체크리스트의 사용자 로컬 상태는
 * sync가 덮어쓰지 않는다.
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
        val mineMarker = settingDao.get(KEY_MINE_MARKER)?.value
            ?.trim()
            ?.takeIf { it.isNotEmpty() }
            ?: EventTitleParser.DEFAULT_MINE_MARKER

        var inserted = 0
        var updated = 0
        var skippedSame = 0
        var checklistCreated = 0
        var tombstoneSeen = 0
        var revived = 0
        var targetCount = 0

        for (event in synced) {
            val parsed = parser.parse(event.title, rules, mineMarker)
            if (!event.isDeleted && parsed.isTarget) targetCount++
            if (event.isDeleted) tombstoneSeen++

            val existing = eventDao.getBySource(event.sourceType, event.sourceEventId)
            val now = clock()

            if (existing == null) {
                val id = eventDao.insertIgnore(event.toEntity(parsed, now))
                if (id == -1L) continue
                inserted++
                if (!event.isDeleted && parsed.isTarget) {
                    if (ensureChecklistIfTarget(id)) checklistCreated++
                }
            } else {
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

    suspend fun getLastSyncTime(): String? = settingDao.get(KEY_LAST_SYNC_AT)?.value

    /**
     * 기존 checklist도 repository에 다시 넘겨 append-only 템플릿 reconcile을 수행한다.
     * 완료 상태/EVENT_ONLY 항목은 그대로 보존된다.
     */
    private suspend fun ensureChecklistIfTarget(eventId: Long): Boolean {
        val existed = checklistDao.countByEventId(eventId) > 0
        val event = eventDao.getById(eventId) ?: return false
        val checklistId = checklistRepository.ensureChecklist(event) ?: return false
        return !existed && checklistId > 0
    }

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
        const val KEY_MINE_MARKER = "mineAttendeeMarker"
    }
}
