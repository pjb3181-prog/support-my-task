package com.nomistake.app.notification

import android.app.AlarmManager
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.os.Build
import com.nomistake.app.data.local.dao.EventDao
import com.nomistake.app.data.local.dao.SettingDao
import com.nomistake.app.data.repository.CalendarSyncRepository
import com.nomistake.app.domain.EventTitleParser
import com.nomistake.app.domain.NotificationPlanner
import com.nomistake.app.domain.WorkCalendarPlanner
import java.time.Clock
import java.time.Instant
import java.time.ZoneId
import java.time.temporal.ChronoUnit

/**
 * Room의 활성 target 일정과 DB 알림 규칙을 AlarmManager에 반영한다.
 * 날짜 기준 알림은 Outlook의 공휴일/휴가/반차 일정을 함께 읽어 근무 가능한 시점으로 보정한다.
 *
 * 추가로 각 일정마다 "준비 마감" 알림을 1건 보장한다.
 * - 미래 준비 마감이면 해당 시각에 예약.
 * - 동기화가 늦어 준비 마감을 이미 지난 상태라면 일정 시작 전 즉시 catch-up 알림을 1회 예약.
 * - 동일 시각의 일반 날짜형 규칙은 중복 알림을 피하기 위해 생략한다.
 */
class NotificationAlarmScheduler(
    private val context: Context,
    private val eventDao: EventDao,
    private val settingDao: SettingDao,
    private val clock: Clock = Clock.systemDefaultZone()
) {
    private val alarmManager = context.getSystemService(AlarmManager::class.java)
    private val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)

    suspend fun rescheduleAll(): ScheduleResult {
        ensureChannel(context)
        cancelPreviouslyScheduled()

        val now = clock.instant()
        val zoneId = ZoneId.systemDefault()
        val events = eventDao.getActiveEventsFrom(now.toEpochMilli())
        val calendarEvents = eventDao.getAllActiveEventsFrom(now.minus(45, ChronoUnit.DAYS).toEpochMilli())
        val mineMarker = settingDao.get(CalendarSyncRepository.KEY_MINE_MARKER)?.value
            ?.trim()
            ?.takeIf { it.isNotEmpty() }
            ?: EventTitleParser.DEFAULT_MINE_MARKER
        val rules = settingDao.getEnabledNotificationRules()
        val deliveredPreparation = prefs.getStringSet(KEY_PREPARATION_DELIVERED, emptySet()).orEmpty().toMutableSet()
        val activeEventIds = events.map { it.id.toString() }.toSet()
        deliveredPreparation.retainAll(activeEventIds)

        var exact = 0
        var fallback = 0
        var preparation = 0
        var preparationCatchUp = 0
        val requestCodes = mutableSetOf<String>()

        fun schedule(
            eventId: Long,
            eventTitle: String,
            ruleLabel: String,
            triggerAt: Instant,
            requestCode: Int,
            isPreparation: Boolean = false,
            isCatchUp: Boolean = false,
            preparationLabel: String? = null,
            preparationReason: String? = null
        ) {
            val intent = Intent(context, NotificationReceiver::class.java).apply {
                putExtra(NotificationReceiver.EXTRA_EVENT_ID, eventId)
                putExtra(NotificationReceiver.EXTRA_EVENT_TITLE, eventTitle)
                putExtra(NotificationReceiver.EXTRA_RULE_LABEL, ruleLabel)
                putExtra(NotificationReceiver.EXTRA_PREPARATION_REMINDER, isPreparation)
                putExtra(NotificationReceiver.EXTRA_PREPARATION_CATCH_UP, isCatchUp)
                preparationLabel?.let { putExtra(NotificationReceiver.EXTRA_PREPARATION_LABEL, it) }
                preparationReason?.let { putExtra(NotificationReceiver.EXTRA_PREPARATION_REASON, it) }
            }
            val pendingIntent = PendingIntent.getBroadcast(
                context,
                requestCode,
                intent,
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
            )
            val triggerMillis = triggerAt.toEpochMilli()
            if (canUseExactAlarms()) {
                alarmManager.setExactAndAllowWhileIdle(
                    AlarmManager.RTC_WAKEUP,
                    triggerMillis,
                    pendingIntent
                )
                exact++
            } else {
                alarmManager.setAndAllowWhileIdle(
                    AlarmManager.RTC_WAKEUP,
                    triggerMillis,
                    pendingIntent
                )
                fallback++
            }
            requestCodes += requestCode.toString()
        }

        for (event in events) {
            val prepDeadline = WorkCalendarPlanner.preparationDeadline(
                event = event,
                calendarEvents = calendarEvents,
                mineMarker = mineMarker,
                zoneId = zoneId
            )
            val preparationAlreadyDelivered = event.id.toString() in deliveredPreparation

            if (prepDeadline != null && !preparationAlreadyDelivered && event.startTime.isAfter(now)) {
                val isCatchUp = !prepDeadline.at.isAfter(now)
                val triggerAt = if (isCatchUp) now.plusSeconds(CATCH_UP_DELAY_SECONDS) else prepDeadline.at
                schedule(
                    eventId = event.id,
                    eventTitle = event.cleanTitle,
                    ruleLabel = PREPARATION_RULE_LABEL,
                    triggerAt = triggerAt,
                    requestCode = preparationRequestCode(event.id),
                    isPreparation = true,
                    isCatchUp = isCatchUp,
                    preparationLabel = prepDeadline.label,
                    preparationReason = prepDeadline.reason
                )
                preparation++
                if (isCatchUp) preparationCatchUp++
            }

            val plans = NotificationPlanner.plan(
                event = event,
                rules = rules,
                now = now,
                zoneId = zoneId,
                calendarEvents = calendarEvents,
                mineMarker = mineMarker
            )
            for (plan in plans) {
                // 기본 D-1 17:00 등이 준비 마감과 정확히 겹치면 전용 준비 마감 알림 하나만 보낸다.
                if (prepDeadline != null && plan.triggerAt == prepDeadline.at) continue
                schedule(
                    eventId = event.id,
                    eventTitle = event.cleanTitle,
                    ruleLabel = plan.ruleLabel,
                    triggerAt = plan.triggerAt,
                    requestCode = requestCode(plan.eventId, plan.ruleId)
                )
            }
        }

        prefs.edit()
            .putStringSet(KEY_REQUEST_CODES, requestCodes)
            .putStringSet(KEY_PREPARATION_DELIVERED, deliveredPreparation)
            .apply()
        return ScheduleResult(
            eventCount = events.size,
            ruleCount = rules.size,
            alarmCount = exact + fallback,
            exactAlarmCount = exact,
            fallbackAlarmCount = fallback,
            preparationAlarmCount = preparation,
            preparationCatchUpCount = preparationCatchUp
        )
    }

    private fun cancelPreviouslyScheduled() {
        val requestCodes = prefs.getStringSet(KEY_REQUEST_CODES, emptySet()).orEmpty().toSet()
        for (value in requestCodes) {
            val requestCode = value.toIntOrNull() ?: continue
            val pendingIntent = PendingIntent.getBroadcast(
                context,
                requestCode,
                Intent(context, NotificationReceiver::class.java),
                PendingIntent.FLAG_NO_CREATE or PendingIntent.FLAG_IMMUTABLE
            ) ?: continue
            alarmManager.cancel(pendingIntent)
            pendingIntent.cancel()
        }
        prefs.edit().remove(KEY_REQUEST_CODES).apply()
    }

    private fun canUseExactAlarms(): Boolean =
        Build.VERSION.SDK_INT < Build.VERSION_CODES.S || alarmManager.canScheduleExactAlarms()

    companion object {
        const val CHANNEL_ID = "upcoming_schedule"
        const val PREPARATION_RULE_LABEL = "준비 마감"
        private const val PREFS_NAME = "notification_alarm_state"
        private const val KEY_REQUEST_CODES = "request_codes"
        private const val KEY_PREPARATION_DELIVERED = "preparation_delivered_event_ids"
        private const val CATCH_UP_DELAY_SECONDS = 3L

        fun requestCode(eventId: Long, ruleId: Long): Int = "$eventId:$ruleId".hashCode()
        fun preparationRequestCode(eventId: Long): Int = "$eventId:preparation".hashCode()

        fun markPreparationReminderDelivered(context: Context, eventId: Long) {
            if (eventId <= 0L) return
            val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
            val delivered = prefs.getStringSet(KEY_PREPARATION_DELIVERED, emptySet()).orEmpty().toMutableSet()
            delivered += eventId.toString()
            prefs.edit().putStringSet(KEY_PREPARATION_DELIVERED, delivered).apply()
        }

        fun ensureChannel(context: Context) {
            if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
            val manager = context.getSystemService(NotificationManager::class.java)
            manager.createNotificationChannel(
                NotificationChannel(
                    CHANNEL_ID,
                    "다가오는 일정",
                    NotificationManager.IMPORTANCE_HIGH
                ).apply {
                    description = "업무 일정과 체크리스트를 반복 상기합니다."
                }
            )
        }
    }
}

data class ScheduleResult(
    val eventCount: Int,
    val ruleCount: Int,
    val alarmCount: Int,
    val exactAlarmCount: Int,
    val fallbackAlarmCount: Int,
    val preparationAlarmCount: Int = 0,
    val preparationCatchUpCount: Int = 0
)
