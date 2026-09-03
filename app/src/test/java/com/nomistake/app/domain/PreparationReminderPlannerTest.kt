package com.nomistake.app.domain

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test
import java.time.Instant

class PreparationReminderPlannerTest {
    @Test
    fun futureDeadline_schedulesAtDeadline() {
        val now = Instant.parse("2026-09-04T07:00:00Z")
        val deadline = Instant.parse("2026-09-04T08:00:00Z")
        val eventStart = Instant.parse("2026-09-07T00:00:00Z")

        val plan = PreparationReminderPlanner.plan(deadline, eventStart, now, alreadyDelivered = false)!!

        assertEquals(PreparationReminderPlanner.Kind.FUTURE, plan.kind)
        assertEquals(deadline, plan.triggerAt)
    }

    @Test
    fun missedDeadline_beforeEvent_schedulesCatchUp() {
        val now = Instant.parse("2026-09-04T08:05:00Z")
        val deadline = Instant.parse("2026-09-04T08:00:00Z")
        val eventStart = Instant.parse("2026-09-07T00:00:00Z")

        val plan = PreparationReminderPlanner.plan(deadline, eventStart, now, alreadyDelivered = false)!!

        assertEquals(PreparationReminderPlanner.Kind.CATCH_UP, plan.kind)
        assertEquals(now.plusSeconds(3), plan.triggerAt)
    }

    @Test
    fun alreadyDelivered_doesNotRepeatCatchUp() {
        val now = Instant.parse("2026-09-04T08:05:00Z")
        val deadline = Instant.parse("2026-09-04T08:00:00Z")
        val eventStart = Instant.parse("2026-09-07T00:00:00Z")

        assertNull(PreparationReminderPlanner.plan(deadline, eventStart, now, alreadyDelivered = true))
    }

    @Test
    fun eventAlreadyStarted_doesNotCatchUp() {
        val now = Instant.parse("2026-09-07T01:00:00Z")
        val deadline = Instant.parse("2026-09-04T08:00:00Z")
        val eventStart = Instant.parse("2026-09-07T00:00:00Z")

        assertNull(PreparationReminderPlanner.plan(deadline, eventStart, now, alreadyDelivered = false))
    }
}
