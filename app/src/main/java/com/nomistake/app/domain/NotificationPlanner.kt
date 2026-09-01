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
 * Android API에 의존하지 않아 단위 테스트로 검증할 수 있다.
 */
object NotificationPlanner {

    fun plan(
        event: EventEntity,
        rules: List<NotificationRuleEntity>,
        now: Instant,
        zoneId: ZoneId
    ): List<NotificationPlan> {
        if (!event.isTarget || event.isDeleted) return emptyList()

        return rules.asSequence()
            .filter { it.enabled }
            .filterNot { event.isAllDay && it.appliesTo == RuleAppliesTo.TIMED_ONLY }
            .mapNotNull { rule ->
                val triggerAt = triggerFor(event, rule, zoneId) ?: return@mapNotNull null
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
        zoneId: ZoneId
    ): Instant? {
        rule.minutesBefore?.let { minutes ->
            if (event.isAllDay || rule.appliesTo != RuleAppliesTo.TIMED_ONLY) return null
            return event.startTime.minusSeconds(minutes.toLong() * 60L)
        }

        val dayOffset = rule.dayOffset ?: return null
        val timeText = rule.timeOfDay ?: return null
        val time = runCatching { LocalTime.parse(timeText) }.getOrNull() ?: return null
        return event.startTime
            .atZone(zoneId)
            .toLocalDate()
            .plusDays(dayOffset.toLong())
            .atTime(time)
            .atZone(zoneId)
            .toInstant()
    }
}
