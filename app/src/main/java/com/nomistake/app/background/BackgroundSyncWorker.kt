package com.nomistake.app.background

import android.content.Context
import androidx.room.Room
import androidx.work.CoroutineWorker
import androidx.work.WorkerParameters
import com.google.firebase.FirebaseApp
import com.google.firebase.auth.FirebaseAuth
import com.google.firebase.firestore.FirebaseFirestore
import com.nomistake.app.data.local.db.AppDatabase
import com.nomistake.app.data.local.db.SeedData
import com.nomistake.app.data.remote.FirestoreCalendarSyncSource
import com.nomistake.app.data.repository.CalendarSyncRepository
import com.nomistake.app.data.repository.ChecklistRepository
import com.nomistake.app.notification.NotificationAlarmScheduler
import java.time.LocalDate
import java.time.ZoneId

/**
 * Phase 9: WorkManager가 실행하는 Firestore -> Room 백그라운드 동기화.
 *
 * Firebase가 구성되지 않았거나 로그인 세션이 없으면 조용히 종료한다.
 * 네트워크/Firestore 오류는 retry하여 기존 Room 데이터를 절대 지우지 않는다.
 * 성공 후에는 Phase 7 AlarmManager 계획도 현재 Room 기준으로 다시 구성한다.
 */
class BackgroundSyncWorker(
    appContext: Context,
    params: WorkerParameters
) : CoroutineWorker(appContext, params) {

    override suspend fun doWork(): Result {
        val firebaseApp = FirebaseApp.getApps(applicationContext).firstOrNull()
            ?: FirebaseApp.initializeApp(applicationContext)
            ?: return Result.success()

        if (FirebaseAuth.getInstance(firebaseApp).currentUser == null) {
            return Result.success()
        }

        val db = Room.databaseBuilder(
            applicationContext,
            AppDatabase::class.java,
            AppDatabase.DB_NAME
        )
            .addMigrations(AppDatabase.MIGRATION_1_2)
            .build()

        return try {
            // Worker가 앱 시작 seed coroutine보다 먼저 실행되어도 안전하도록 자체 보장한다.
            SeedData.seed(db)

            val syncRepository = CalendarSyncRepository(
                syncSource = FirestoreCalendarSyncSource(FirebaseFirestore.getInstance(firebaseApp)),
                eventDao = db.eventDao(),
                templateDao = db.templateDao(),
                checklistRepository = ChecklistRepository(db.checklistDao(), db.templateDao()),
                checklistDao = db.checklistDao(),
                settingDao = db.settingDao()
            )

            val zone = ZoneId.systemDefault()
            val today = LocalDate.now(zone)
            val from = today.minusDays(SYNC_PAST_DAYS).atStartOfDay(zone).toInstant()
            val to = today.plusDays(SYNC_FUTURE_DAYS).atStartOfDay(zone).toInstant()
            syncRepository.syncNow(from, to)

            NotificationAlarmScheduler(
                context = applicationContext,
                eventDao = db.eventDao(),
                settingDao = db.settingDao()
            ).rescheduleAll()

            Result.success()
        } catch (_: Exception) {
            // Firestore/network 일시 실패 시 Room source of truth는 그대로 두고 재시도한다.
            Result.retry()
        } finally {
            db.close()
        }
    }

    companion object {
        const val SYNC_PAST_DAYS = 7L
        const val SYNC_FUTURE_DAYS = 90L
    }
}
