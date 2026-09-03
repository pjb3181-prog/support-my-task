package com.nomistake.app.domain

import com.nomistake.app.data.local.entity.EventEntity
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.Instant
import java.time.LocalDateTime
import java.time.ZoneId

class WorkCalendarPlannerTest {
    private val zone = ZoneId.of("Asia/Seoul")

    @Test
    fun mondayEvent_preparesOnFriday() {
        val work = event("work", "HAZOP [종]", "2026-09-07T09:00:00", "2026-09-07T18:00:00", target = true)
        val deadline = WorkCalendarPlanner.preparationDeadline(work, listOf(work), "종", zone)!!
        assertEquals("2026-09-04T17:00", local(deadline.at))
        assertTrue(deadline.reason.contains("주말"))
    }

    @Test
    fun fridayLeave_movesMondayPreparationToThursday() {
        val work = event("work", "HAZOP [종]", "2026-09-07T09:00:00", "2026-09-07T18:00:00", target = true)
        val leave = event("leave", "[종]연차", "2026-09-04T00:00:00", "2026-09-05T00:00:00", allDay = true)
        val deadline = WorkCalendarPlanner.preparationDeadline(work, listOf(work, leave), "종", zone)!!
        assertEquals("2026-09-03T17:00", local(deadline.at))
        assertTrue(deadline.reason.contains("연차"))
    }

    @Test
    fun fridayAfternoonLeave_movesPreparationToFridayMorning() {
        val work = event("work", "HAZOP [종]", "2026-09-07T09:00:00", "2026-09-07T18:00:00", target = true)
        val leave = event("leave", "[종]오후반차", "2026-09-04T13:00:00", "2026-09-04T18:00:00")
        val deadline = WorkCalendarPlanner.preparationDeadline(work, listOf(work, leave), "종", zone)!!
        assertEquals("2026-09-04T11:30", local(deadline.at))
        assertTrue(deadline.reason.contains("오후반차"))
    }

    @Test
    fun publicHoliday_movesPreparationBackward() {
        val work = event("work", "현장업무 [종]", "2026-10-01T09:00:00", "2026-10-01T18:00:00", target = true)
        val holiday = event("holiday", "추석연휴", "2026-09-30T00:00:00", "2026-10-01T00:00:00", allDay = true)
        val deadline = WorkCalendarPlanner.preparationDeadline(work, listOf(work, holiday), "종", zone)!!
        assertEquals("2026-09-29T17:00", local(deadline.at))
        assertTrue(deadline.reason.contains("추석"))
    }

    private fun local(instant: Instant): String = instant.atZone(zone).toLocalDateTime().toString()

    private fun event(
        id: String,
        title: String,
        start: String,
        end: String,
        target: Boolean = false,
        allDay: Boolean = false
    ) = EventEntity(
        sourceType = EventSource.FIRESTORE_OUTLOOK,
        sourceEventId = id,
        graphImmutableId = null,
        iCalUId = null,
        seriesMasterId = null,
        eventType = null,
        changeKey = null,
        seriesKeyHash = null,
        occurrenceKeyHash = null,
        title = title,
        cleanTitle = title,
        roomType = null,
        attendeeCode = if (target) "종" else null,
        isMine = target,
        scheduleType = if (target) "HAZOP" else null,
        isTarget = target,
        isAllDay = allDay,
        startTime = LocalDateTime.parse(start).atZone(zone).toInstant(),
        endTime = LocalDateTime.parse(end).atZone(zone).toInstant(),
        location = null,
        lastSyncedAt = Instant.EPOCH
    )
}
