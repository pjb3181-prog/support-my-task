package com.nomistake.app.domain

import com.nomistake.app.data.local.entity.EventEntity
import com.nomistake.app.data.local.entity.NotificationRuleEntity
import com.nomistake.app.data.local.entity.RuleAppliesTo
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.Instant
import java.time.ZoneId

class NotificationPlannerTest {
    private val zone = ZoneId.of("Asia/Seoul")
    private val now = Instant.parse("2026-09-01T00:00:00Z") // 09:00 KST

    @Test
    fun `timed event creates fixed and relative reminders`() {
        val event = event(start = "2026-09-03T01:00:00Z", allDay = false)
        val result = NotificationPlanner.plan(event, defaultRules(), now, zone)

        assertEquals(5, result.size)
        assertEquals(
            listOf(
                "2026-09-02T05:00:00Z",
                "2026-09-02T08:00:00Z",
                "2026-09-02T23:00:00Z",
                "2026-09-03T00:00:00Z",
                "2026-09-03T00:30:00Z"
            ),
            result.map { it.triggerAt.toString() }
        )
    }

    @Test
    fun `all-day event excludes T minus reminders`() {
        val event = event(start = "2026-09-03T00:00:00Z", allDay = true)
        val result = NotificationPlanner.plan(event, defaultRules(), now, zone)

        assertEquals(3, result.size)
        assertTrue(result.none { it.ruleLabel.startsWith("T-") })
    }

    @Test
    fun `past reminder times are omitted`() {
        val event = event(start = "2026-09-01T10:00:00Z", allDay = false)
        val lateNow = Instant.parse("2026-09-01T09:40:00Z")
        val result = NotificationPlanner.plan(event, defaultRules(), lateNow, zone)

        assertEquals(listOf("T-30"), result.map { it.ruleLabel })
    }

    @Test
    fun `disabled rules are omitted`() {
        val disabled = NotificationRuleEntity(
            id = 9,
            label = "disabled",
            minutesBefore = 10,
            appliesTo = RuleAppliesTo.TIMED_ONLY,
            enabled = false
        )
        val result = NotificationPlanner.plan(
            event(start = "2026-09-03T01:00:00Z", allDay = false),
            listOf(disabled),
            now,
            zone
        )

        assertTrue(result.isEmpty())
    }

    @Test
    fun `non-target and deleted events create no reminders`() {
        val rules = defaultRules()
        assertTrue(NotificationPlanner.plan(event(isTarget = false), rules, now, zone).isEmpty())
        assertTrue(NotificationPlanner.plan(event(isDeleted = true), rules, now, zone).isEmpty())
    }

    @Test
    fun `malformed fixed-time rule is ignored safely`() {
        val malformed = NotificationRuleEntity(
            id = 99,
            label = "bad",
            dayOffset = -1,
            timeOfDay = "25:99",
            appliesTo = RuleAppliesTo.ALL
        )
        val result = NotificationPlanner.plan(event(), listOf(malformed), now, zone)

        assertTrue(result.isEmpty())
    }

    private fun defaultRules() = listOf(
        NotificationRuleEntity(id = 1, label = "D-1 오후", dayOffset = -1, timeOfDay = "14:00", appliesTo = RuleAppliesTo.ALL),
        NotificationRuleEntity(id = 2, label = "D-1 퇴근 전", dayOffset = -1, timeOfDay = "17:00", appliesTo = RuleAppliesTo.ALL),
        NotificationRuleEntity(id = 3, label = "당일 오전", dayOffset = 0, timeOfDay = "08:00", appliesTo = RuleAppliesTo.ALL),
        NotificationRuleEntity(id = 4, label = "T-60", minutesBefore = 60, appliesTo = RuleAppliesTo.TIMED_ONLY),
        NotificationRuleEntity(id = 5, label = "T-30", minutesBefore = 30, appliesTo = RuleAppliesTo.TIMED_ONLY)
    )

    private fun event(
        start: String = "2026-09-03T01:00:00Z",
        allDay: Boolean = false,
        isTarget: Boolean = true,
        isDeleted: Boolean = false
    ) = EventEntity(
        id = 10,
        sourceType = EventSource.FIRESTORE_OUTLOOK,
        sourceEventId = "synthetic-event",
        graphImmutableId = null,
        iCalUId = null,
        seriesMasterId = null,
        eventType = null,
        changeKey = null,
        seriesKeyHash = "series",
        occurrenceKeyHash = "occurrence",
        title = "[대]테스트-HAZOP[용종]",
        cleanTitle = "테스트-HAZOP",
        roomType = "대",
        attendeeCode = "용종",
        isMine = true,
        scheduleType = "HAZOP",
        isTarget = isTarget,
        isAllDay = allDay,
        startTime = Instant.parse(start),
        endTime = Instant.parse(start).plusSeconds(3600),
        location = null,
        isDeleted = isDeleted,
        lastSyncedAt = now
    )
}
