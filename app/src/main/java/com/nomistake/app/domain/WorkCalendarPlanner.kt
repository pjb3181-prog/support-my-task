package com.nomistake.app.domain

import com.nomistake.app.data.local.entity.EventEntity
import java.time.DayOfWeek
import java.time.Instant
import java.time.LocalDate
import java.time.LocalDateTime
import java.time.LocalTime
import java.time.ZoneId
import java.time.ZonedDateTime
import java.time.format.DateTimeFormatter

/**
 * Outlook에 이미 올라와 있는 공휴일/개인 휴가 일정을 이용해 실제 준비 가능한 마지막 근무 시점을 계산한다.
 *
 * 운영 규칙:
 * - 토/일 및 공휴일성 종일 일정은 근무 불가.
 * - 내 식별문자가 [] 안에 포함된 연차/휴가/병가 등은 근무 불가.
 * - 오전반차는 오후만, 오후반차는 오전만 준비 가능.
 * - 기본 준비 마감은 일정 전날 17:00이며, 근무 불가 구간이면 앞선 근무 가능 구간으로 이동한다.
 */
object WorkCalendarPlanner {

    data class PreparationDeadline(
        val at: Instant,
        val label: String,
        val reason: String
    )

    private enum class Availability { FULL, MORNING_ONLY, AFTERNOON_ONLY, NONE }

    private data class DayStatus(
        val availability: Availability,
        val reason: String? = null
    )

    private val holidayKeywords = listOf(
        "공휴일", "대체공휴일", "대체휴일", "신정", "설날", "설연휴", "추석", "추석연휴",
        "삼일절", "3.1절", "어린이날", "부처님오신날", "석가탄신일", "현충일", "광복절",
        "개천절", "한글날", "성탄절", "크리스마스", "선거일"
    )

    private val fullLeaveKeywords = listOf(
        "연차", "휴가", "병가", "공가", "특별휴가", "출산휴가", "육아휴직"
    )

    fun preparationDeadline(
        event: EventEntity,
        calendarEvents: List<EventEntity>,
        mineMarker: String,
        zoneId: ZoneId
    ): PreparationDeadline? {
        if (event.isDeleted || !event.isTarget) return null
        val eventDate = event.startTime.atZone(zoneId).toLocalDate()
        val desired = eventDate.minusDays(1).atTime(LocalTime.of(17, 0)).atZone(zoneId)
        val adjusted = adjustToWorkingTime(desired, calendarEvents, mineMarker, zoneId) ?: return null
        val part = if (adjusted.time.toLocalTime().isBefore(LocalTime.NOON)) "오전 중" else "퇴근 전"
        val label = adjusted.time.format(DateTimeFormatter.ofPattern("M월 d일 (E)")) + " · " + part
        return PreparationDeadline(
            at = adjusted.time.toInstant(),
            label = label,
            reason = adjusted.reason ?: "직전 근무일 기준"
        )
    }

    /** 날짜 기준 알림도 휴일/휴가/반차를 피해 실제 근무 가능한 시간으로 이동시킨다. */
    fun adjustNotificationTime(
        desired: Instant,
        calendarEvents: List<EventEntity>,
        mineMarker: String,
        zoneId: ZoneId
    ): Instant = adjustToWorkingTime(desired.atZone(zoneId), calendarEvents, mineMarker, zoneId)?.time?.toInstant()
        ?: desired

    private data class Adjustment(val time: ZonedDateTime, val reason: String?)

    private fun adjustToWorkingTime(
        desired: ZonedDateTime,
        calendarEvents: List<EventEntity>,
        mineMarker: String,
        zoneId: ZoneId
    ): Adjustment? {
        var candidate = desired
        var lastReason: String? = null

        repeat(45) {
            val status = dayStatus(candidate.toLocalDate(), calendarEvents, mineMarker, zoneId)
            when (status.availability) {
                Availability.NONE -> {
                    lastReason = status.reason ?: lastReason
                    candidate = candidate.minusDays(1)
                }

                Availability.MORNING_ONLY -> {
                    if (!candidate.toLocalTime().isBefore(LocalTime.NOON)) {
                        return Adjustment(
                            candidate.toLocalDate().atTime(11, 30).atZone(zoneId),
                            status.reason ?: "오후반차 일정 반영"
                        )
                    }
                    return Adjustment(candidate, lastReason ?: status.reason)
                }

                Availability.AFTERNOON_ONLY -> {
                    if (candidate.toLocalTime().isBefore(LocalTime.of(13, 0))) {
                        return Adjustment(
                            candidate.toLocalDate().atTime(13, 30).atZone(zoneId),
                            status.reason ?: "오전반차 일정 반영"
                        )
                    }
                    return Adjustment(candidate, lastReason ?: status.reason)
                }

                Availability.FULL -> return Adjustment(candidate, lastReason)
            }
        }
        return null
    }

    private fun dayStatus(
        date: LocalDate,
        events: List<EventEntity>,
        mineMarker: String,
        zoneId: ZoneId
    ): DayStatus {
        if (date.dayOfWeek == DayOfWeek.SATURDAY || date.dayOfWeek == DayOfWeek.SUNDAY) {
            return DayStatus(Availability.NONE, "주말을 피해 앞선 근무일로 조정")
        }

        val dayEvents = events.filter { !it.isDeleted && overlapsDate(it, date, zoneId) }
        val holiday = dayEvents.firstOrNull { it.isAllDay && isPublicHoliday(it.title) }
        if (holiday != null) {
            return DayStatus(Availability.NONE, "${holiday.cleanTitle.ifBlank { holiday.title }} 일정 반영")
        }

        val personalLeave = dayEvents.filter { isMineByBracket(it.title, mineMarker) && isLeave(it.title) }
        if (personalLeave.any { isFullLeave(it.title) }) {
            val leave = personalLeave.first { isFullLeave(it.title) }
            return DayStatus(Availability.NONE, "${leave.cleanTitle.ifBlank { leave.title }} 일정 반영")
        }

        val morningOff = personalLeave.any { it.title.contains("오전반차", ignoreCase = true) }
        val afternoonOff = personalLeave.any { it.title.contains("오후반차", ignoreCase = true) }
        return when {
            morningOff && afternoonOff -> DayStatus(Availability.NONE, "반차 일정 반영")
            afternoonOff -> DayStatus(Availability.MORNING_ONLY, "오후반차 일정 반영")
            morningOff -> DayStatus(Availability.AFTERNOON_ONLY, "오전반차 일정 반영")
            else -> DayStatus(Availability.FULL)
        }
    }

    private fun overlapsDate(event: EventEntity, date: LocalDate, zoneId: ZoneId): Boolean {
        val dayStart = date.atStartOfDay(zoneId).toInstant()
        val dayEnd = date.plusDays(1).atStartOfDay(zoneId).toInstant()
        return event.startTime.isBefore(dayEnd) && event.endTime.isAfter(dayStart)
    }

    private fun isMineByBracket(title: String, marker: String): Boolean {
        if (marker.isBlank()) return false
        return BRACKET.findAll(title).any { it.groupValues.getOrNull(1)?.contains(marker) == true }
    }

    private fun isLeave(title: String): Boolean =
        title.contains("오전반차", ignoreCase = true) ||
            title.contains("오후반차", ignoreCase = true) ||
            title.contains("반차", ignoreCase = true) ||
            fullLeaveKeywords.any { title.contains(it, ignoreCase = true) }

    private fun isFullLeave(title: String): Boolean {
        if (title.contains("오전반차", ignoreCase = true) || title.contains("오후반차", ignoreCase = true) || title.contains("반차", ignoreCase = true)) {
            return false
        }
        return fullLeaveKeywords.any { title.contains(it, ignoreCase = true) }
    }

    private fun isPublicHoliday(title: String): Boolean =
        holidayKeywords.any { title.contains(it, ignoreCase = true) }

    private val BRACKET = Regex("\\[([^\\[\\]]+)]")
}
