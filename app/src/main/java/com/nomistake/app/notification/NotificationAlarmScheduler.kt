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
import java.time.Clock
import java.time.ZoneId
import java.time.temporal.ChronoUnit

/**
 * Room의 활성 target 일정과 DB 알림 규칙을 AlarmManager에 반영한다.
 * 날짜 기준 알림은 Outlook의 공휴일/휴가/반차 일정을 함께 읽어 근무 가능한 시점으로 보정한다.
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
        var exact = 0
        var fallback = 0
        val requestCodes = mutableSetOf<String>()

        for (event in events) {
            val plans = NotificationPlanner.plan(
                event = event,
                rules = rules,
                now = now,
                zoneId = zoneId,
                calendarEvents = calendarEvents,
                mineMarker = mineMarker
            )
            for (plan in plans) {
                val requestCode = requestCode(plan.eventId, plan.ruleId)
                val intent = Intent(context, NotificationReceiver::class.java).apply {
                    putExtra(NotificationReceiver.EXTRA_EVENT_ID, event.id)
                    putExtra(NotificationReceiver.EXTRA_EVENT_TITLE, event.cleanTitle)
                    putExtra(NotificationReceiver.EXTRA_RULE_LABEL, plan.ruleLabel)
                }
                val pendingIntent = PendingIntent.getBroadcast(
                    context,
                    requestCode,
                    intent,
                    PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
                )
                val triggerMillis = plan.triggerAt.toEpochMilli()
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
        }

        prefs.edit().putStringSet(KEY_REQUEST_CODES, requestCodes).apply()
        return ScheduleResult(
            eventCount = events.size,
            ruleCount = rules.size,
            alarmCount = exact + fallback,
            exactAlarmCount = exact,
            fallbackAlarmCount = fallback
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
        private const val PREFS_NAME = "notification_alarm_state"
        private const val KEY_REQUEST_CODES = "request_codes"

        fun requestCode(eventId: Long, ruleId: Long): Int = "$eventId:$ruleId".hashCode()

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
    val fallbackAlarmCount: Int
)
