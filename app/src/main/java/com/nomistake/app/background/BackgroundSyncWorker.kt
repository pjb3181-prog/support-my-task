package com.nomistake.app.background

import android.content.Context
import android.util.Log
import androidx.room.Room
import androidx.work.CoroutineWorker
import androidx.work.WorkerParameters
import com.google.firebase.FirebaseApp
import com.google.firebase.auth.FirebaseAuth
import com.google.firebase.auth.FirebaseAuthException
import com.google.firebase.firestore.FirebaseFirestore
import com.nomistake.app.data.local.db.AppDatabase
import com.nomistake.app.data.local.db.SeedData
import com.nomistake.app.data.remote.FirebaseAuthManager
import com.nomistake.app.data.remote.FirestoreCalendarSyncSource
import com.nomistake.app.data.repository.CalendarSyncRepository
import com.nomistake.app.data.repository.ChecklistRepository
import com.nomistake.app.notification.NotificationAlarmScheduler
import java.time.LocalDate
import java.time.LocalDateTime
import java.time.ZoneId

/**
 * Firestore -> Room 백그라운드 동기화.
 * periodic 실행은 00:00~07:59에 Firestore read 없이 즉시 성공 종료한다.
 * 사용자 동작으로 생성된 immediate work는 forceSync=true라 시간 제한을 우회한다.
 */
class BackgroundSyncWorker(
    appContext: Context,
    params: WorkerParameters
) : CoroutineWorker(appContext, params) {

    override suspend fun doWork(): Result {
        val forceSync = inputData.getBoolean(BackgroundSyncScheduler.KEY_FORCE_SYNC, false)
        if (!forceSync && !BackgroundSyncHours.isAutomaticSyncAllowed(LocalDateTime.now())) {
            return Result.success()
        }

        val firebaseApp = FirebaseApp.getApps(applicationContext).firstOrNull()
            ?: FirebaseApp.initializeApp(applicationContext)
            ?: return Result.retry()

        val auth = FirebaseAuthManager(FirebaseAuth.getInstance(firebaseApp))
        try {
            auth.ensureAnonymousSignIn()
        } catch (e: Exception) {
            val authCode = (e as? FirebaseAuthException)?.errorCode ?: e::class.java.simpleName
            Log.w(TAG, "Anonymous Firebase auth failed: $authCode")
            return Result.retry()
        }

        val db = Room.databaseBuilder(
            applicationContext,
            AppDatabase::class.java,
            AppDatabase.DB_NAME
        )
            .addMigrations(AppDatabase.MIGRATION_1_2, AppDatabase.MIGRATION_2_3)
            .build()

        return try {
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
        } catch (e: Exception) {
            Log.w(TAG, "Background sync failed: ${e::class.java.simpleName}")
            Result.retry()
        } finally {
            db.close()
        }
    }

    companion object {
        private const val TAG = "NoMistakeSync"
        const val SYNC_PAST_DAYS = 7L
        const val SYNC_FUTURE_DAYS = 90L
    }
}
