package com.nomistake.app.domain

import java.time.Instant

/** 준비 마감 전용 알림의 예약 여부를 결정하는 순수 로직. */
object PreparationReminderPlanner {
    enum class Kind { FUTURE, CATCH_UP }

    data class Plan(
        val triggerAt: Instant,
        val kind: Kind
    )

    /**
     * - 이미 delivered면 예약하지 않는다.
     * - 일정이 시작됐거나 끝난 경우 예약하지 않는다.
     * - 준비 마감이 미래면 해당 시각에 예약한다.
     * - 준비 마감이 지났지만 일정 전이면 짧은 지연 후 catch-up 1회를 예약한다.
     */
    fun plan(
        deadlineAt: Instant?,
        eventStart: Instant,
        now: Instant,
        alreadyDelivered: Boolean,
        catchUpDelaySeconds: Long = 3L
    ): Plan? {
        if (deadlineAt == null || alreadyDelivered || !eventStart.isAfter(now)) return null
        return if (deadlineAt.isAfter(now)) {
            Plan(deadlineAt, Kind.FUTURE)
        } else {
            Plan(now.plusSeconds(catchUpDelaySeconds.coerceAtLeast(1L)), Kind.CATCH_UP)
        }
    }
}
