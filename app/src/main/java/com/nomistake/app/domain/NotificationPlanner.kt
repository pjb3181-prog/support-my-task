package com.nomistake.app.domain

import com.nomistake.app.data.local.entity.EventEntity
import com.nomistake.app.data.local.entity.NotificationRuleEntity
import com.nomistake.app.data.local.entity.RuleAppliesTo
import java.time.Instant
import java.time.LocalTime
import java.time.ZoneId

/** 알림 1건의 결정적 스케줄 결과. */
data class NotificationPlan(
    val eventId: Long,
    val ruleId: Long,
    val ruleLabel: String,
    val triggerAt: Instant
)

/**
 * DB의 NotificationRule과 Event를 실제 Alarm 시각으로 변환하는 순수 로직.
 * 날짜 기준 알림(D-1 14:00 등)은 Outlook의 공휴일/개인 휴가/반차를 피해
 * 실제 근무 가능한 가장 가까운 시점으로 자동 보정한다.
 */
object NotificationPlanner {

    fun plan(
        event: EventEntity,
        rules: List<NotificationRuleEntity>,
        now: Instant,
        zoneId: ZoneId,
        calendarEvents: List<EventEntity> = emptyList(),
        mineMarker: String = EventTitleParser.DEFAULT_MINE_MARKER
    ): List<NotificationPlan> {
        if (!event.isTarget || event.isDeleted) return emptyList()

        return rules.asSequence()
            .filter { it.enabled }
            .filterNot { event.isAllDay && it.appliesTo == RuleAppliesTo.TIMED_ONLY }
            .mapNotNull { rule ->
                val triggerAt = triggerFor(event, rule, zoneId, calendarEvents, mineMarker) ?: return@mapNotNull null
                if (!triggerAt.isAfter(now)) return@mapNotNull null
                NotificationPlan(
                    eventId = event.id,
                    ruleId = rule.id,
                    ruleLabel = rule.label,
                    triggerAt = triggerAt
                )
            }
            .sortedBy { it.triggerAt }
            .toList()
    }

    private fun triggerFor(
        event: EventEntity,
        rule: NotificationRuleEntity,
        zoneId: ZoneId,
        calendarEvents: List<EventEntity>,
        mineMarker: String
    ): Instant? {
        rule.minutesBefore?.let { minutes ->
            if (event.isAllDay || rule.appliesTo != RuleAppliesTo.TIMED_ONLY) return null
            return event.startTime.minusSeconds(minutes.toLong() * 60L)
        }

        val dayOffset = rule.dayOffset ?: return null
        val timeText = rule.timeOfDay ?: return null
        val time = runCatching { LocalTime.parse(timeText) }.getOrNull() ?: return null
        val raw = event.startTime
            .atZone(zoneId)
            .toLocalDate()
            .plusDays(dayOffset.toLong())
            .atTime(time)
            .atZone(zoneId)
            .toInstant()

        return if (calendarEvents.isEmpty()) raw
        else WorkCalendarPlanner.adjustNotificationTime(raw, calendarEvents, mineMarker, zoneId)
    }
}
