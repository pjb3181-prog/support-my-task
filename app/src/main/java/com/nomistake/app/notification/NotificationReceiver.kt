package com.nomistake.app.notification

import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import com.nomistake.app.MainActivity

class NotificationReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        val eventId = intent.getLongExtra(EXTRA_EVENT_ID, -1L)
        if (eventId <= 0L) return
        val title = intent.getStringExtra(EXTRA_EVENT_TITLE)?.takeIf { it.isNotBlank() } ?: "다가오는 일정"
        val ruleLabel = intent.getStringExtra(EXTRA_RULE_LABEL)?.takeIf { it.isNotBlank() }
        val isPreparationReminder = intent.getBooleanExtra(EXTRA_PREPARATION_REMINDER, false)
        val isCatchUp = intent.getBooleanExtra(EXTRA_PREPARATION_CATCH_UP, false)
        val preparationLabel = intent.getStringExtra(EXTRA_PREPARATION_LABEL)?.takeIf { it.isNotBlank() }
        val preparationReason = intent.getStringExtra(EXTRA_PREPARATION_REASON)?.takeIf { it.isNotBlank() }

        NotificationAlarmScheduler.ensureChannel(context)

        val openIntent = Intent(context, MainActivity::class.java).apply {
            putExtra(EXTRA_EVENT_ID, eventId)
            flags = Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP
        }
        val contentIntent = PendingIntent.getActivity(
            context,
            eventId.hashCode(),
            openIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        val text = when {
            isPreparationReminder && isCatchUp -> buildString {
                append("준비 마감 시각이 지났습니다")
                preparationLabel?.let { append(" · $it") }
                preparationReason?.let { append(" · $it") }
            }
            isPreparationReminder -> buildString {
                append("지금까지 준비를 마쳐야 합니다")
                preparationLabel?.let { append(" · $it") }
                preparationReason?.let { append(" · $it") }
            }
            ruleLabel == null -> "일정이 다가오고 있습니다."
            else -> "일정이 다가오고 있습니다 · $ruleLabel"
        }
        val notification = NotificationCompat.Builder(context, NotificationAlarmScheduler.CHANNEL_ID)
            .setSmallIcon(android.R.drawable.ic_dialog_info)
            .setContentTitle(title)
            .setContentText(text)
            .setStyle(NotificationCompat.BigTextStyle().bigText(text))
            .setContentIntent(contentIntent)
            .setAutoCancel(true)
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .build()

        val notificationManager = NotificationManagerCompat.from(context)
        if (!notificationManager.areNotificationsEnabled()) {
            // 시스템 알림이 차단된 상태에서는 notify()가 예외 없이 반환될 수 있다.
            // 이 경우 준비 마감 알림을 전달 완료로 소모하면 권한 복구 후 catch-up 기회를 잃으므로
            // 아무 것도 기록하지 않고 다음 재스케줄 기회를 남긴다.
            return
        }

        try {
            notificationManager.notify(notificationId(eventId, ruleLabel), notification)
            if (isPreparationReminder) {
                NotificationAlarmScheduler.markPreparationReminderDelivered(context, eventId)
            }
        } catch (_: SecurityException) {
            // Android 13+ 권한 상태가 호출 사이에 바뀐 경우에도 delivered로 기록하지 않는다.
        }
    }

    companion object {
        const val EXTRA_EVENT_ID = "notification_event_id"
        const val EXTRA_EVENT_TITLE = "notification_event_title"
        const val EXTRA_RULE_LABEL = "notification_rule_label"
        const val EXTRA_PREPARATION_REMINDER = "notification_preparation_reminder"
        const val EXTRA_PREPARATION_CATCH_UP = "notification_preparation_catch_up"
        const val EXTRA_PREPARATION_LABEL = "notification_preparation_label"
        const val EXTRA_PREPARATION_REASON = "notification_preparation_reason"

        fun notificationId(eventId: Long, ruleLabel: String?): Int = "$eventId:${ruleLabel.orEmpty()}".hashCode()
    }
}
