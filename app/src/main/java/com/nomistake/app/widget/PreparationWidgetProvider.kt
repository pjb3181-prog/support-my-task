package com.nomistake.app.widget

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.view.View
import android.widget.RemoteViews
import androidx.room.Room
import com.nomistake.app.MainActivity
import com.nomistake.app.R
import com.nomistake.app.data.local.db.AppDatabase
import com.nomistake.app.data.repository.CalendarSyncRepository
import com.nomistake.app.domain.EventTitleParser
import com.nomistake.app.domain.WorkCalendarPlanner
import com.nomistake.app.notification.NotificationReceiver
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch

/**
 * 홈 화면에 "지금 눈에 밟혀야 하는" 준비 일정 2건을 계속 보여준다.
 * 실제 데이터는 Room에서 읽고, 준비 마감은 앱 본체와 동일한 WorkCalendarPlanner를 사용한다.
 */
class PreparationWidgetProvider : AppWidgetProvider() {
    override fun onUpdate(context: Context, manager: AppWidgetManager, appWidgetIds: IntArray) {
        super.onUpdate(context, manager, appWidgetIds)
        refresh(context)
    }

    override fun onEnabled(context: Context) {
        super.onEnabled(context)
        refresh(context)
    }

    companion object {
        private val dateTimeFormatter = DateTimeFormatter.ofPattern("M/d (E) HH:mm")

        fun refresh(context: Context) {
            val appContext = context.applicationContext
            val manager = AppWidgetManager.getInstance(appContext)
            val component = ComponentName(appContext, PreparationWidgetProvider::class.java)
            val ids = manager.getAppWidgetIds(component)
            if (ids.isEmpty()) return

            ids.forEach { id ->
                manager.updateAppWidget(id, loadingViews(appContext))
            }

            CoroutineScope(Dispatchers.IO).launch {
                val db = Room.databaseBuilder(
                    appContext,
                    AppDatabase::class.java,
                    AppDatabase.DB_NAME
                )
                    .addMigrations(AppDatabase.MIGRATION_1_2, AppDatabase.MIGRATION_2_3)
                    .build()
                try {
                    val now = Instant.now()
                    val events = db.eventDao().getActiveEventsFrom(now.toEpochMilli()).take(2)
                    val allEvents = db.eventDao().getAllActiveEventsFrom(now.minusSeconds(45L * 24L * 60L * 60L).toEpochMilli())
                    val marker = db.settingDao().get(CalendarSyncRepository.KEY_MINE_MARKER)?.value
                        ?.trim()
                        ?.takeIf { it.isNotEmpty() }
                        ?: EventTitleParser.DEFAULT_MINE_MARKER
                    val zoneId = ZoneId.systemDefault()
                    val views = contentViews(appContext, events.map { event ->
                        val deadline = WorkCalendarPlanner.preparationDeadline(event, allEvents, marker, zoneId)
                        WidgetRow(
                            id = event.id,
                            title = event.cleanTitle,
                            whenText = event.startTime.atZone(zoneId).format(dateTimeFormatter),
                            deadlineText = when {
                                deadline == null -> "준비 마감 계산 중"
                                !deadline.at.isAfter(now) -> "준비 마감 지남 · ${deadline.label}"
                                else -> "준비 마감 · ${deadline.label}"
                            }
                        )
                    })
                    ids.forEach { id -> manager.updateAppWidget(id, views) }
                } finally {
                    db.close()
                }
            }
        }

        private fun loadingViews(context: Context): RemoteViews =
            RemoteViews(context.packageName, R.layout.widget_preparation).apply {
                setTextViewText(R.id.widgetTitle, "MERI 업무 준비")
                setTextViewText(R.id.widgetEmpty, "일정 확인 중…")
                setViewVisibility(R.id.widgetEmpty, View.VISIBLE)
                setViewVisibility(R.id.widgetRow1, View.GONE)
                setViewVisibility(R.id.widgetRow2, View.GONE)
                setOnClickPendingIntent(R.id.widgetHeader, openAppIntent(context))
            }

        private fun contentViews(context: Context, rows: List<WidgetRow>): RemoteViews =
            RemoteViews(context.packageName, R.layout.widget_preparation).apply {
                setTextViewText(R.id.widgetTitle, "MERI 업무 준비")
                setOnClickPendingIntent(R.id.widgetHeader, openAppIntent(context))
                setViewVisibility(R.id.widgetEmpty, if (rows.isEmpty()) View.VISIBLE else View.GONE)
                if (rows.isEmpty()) setTextViewText(R.id.widgetEmpty, "예정된 준비 일정이 없습니다")
                bindRow(context, this, rows.getOrNull(0), 1)
                bindRow(context, this, rows.getOrNull(1), 2)
            }

        private fun bindRow(context: Context, views: RemoteViews, row: WidgetRow?, index: Int) {
            val containerId = if (index == 1) R.id.widgetRow1 else R.id.widgetRow2
            val titleId = if (index == 1) R.id.widgetRow1Title else R.id.widgetRow2Title
            val timeId = if (index == 1) R.id.widgetRow1Time else R.id.widgetRow2Time
            val deadlineId = if (index == 1) R.id.widgetRow1Deadline else R.id.widgetRow2Deadline
            if (row == null) {
                views.setViewVisibility(containerId, View.GONE)
                return
            }
            views.setViewVisibility(containerId, View.VISIBLE)
            views.setTextViewText(titleId, row.title)
            views.setTextViewText(timeId, row.whenText)
            views.setTextViewText(deadlineId, row.deadlineText)
            views.setOnClickPendingIntent(containerId, openEventIntent(context, row.id))
        }

        private fun openAppIntent(context: Context): PendingIntent = PendingIntent.getActivity(
            context,
            7001,
            Intent(context, MainActivity::class.java).apply {
                flags = Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP
            },
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        private fun openEventIntent(context: Context, eventId: Long): PendingIntent = PendingIntent.getActivity(
            context,
            (7100L + eventId).hashCode(),
            Intent(context, MainActivity::class.java).apply {
                putExtra(NotificationReceiver.EXTRA_EVENT_ID, eventId)
                flags = Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP
            },
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )
    }

    private data class WidgetRow(
        val id: Long,
        val title: String,
        val whenText: String,
        val deadlineText: String
    )
}
