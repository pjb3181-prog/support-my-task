package com.nomistake.app.background

import android.content.Context
import androidx.work.BackoffPolicy
import androidx.work.Constraints
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import java.util.concurrent.TimeUnit

/** Phase 9: 앱 실행 시 즉시 1회 + 이후 30분 주기 동기화를 보장한다. */
object BackgroundSyncScheduler {

    fun schedule(context: Context) {
        val workManager = WorkManager.getInstance(context.applicationContext)
        val constraints = Constraints.Builder()
            .setRequiredNetworkType(NetworkType.CONNECTED)
            .build()

        val periodic = PeriodicWorkRequestBuilder<BackgroundSyncWorker>(
            REPEAT_MINUTES,
            TimeUnit.MINUTES
        )
            .setConstraints(constraints)
            .setBackoffCriteria(
                BackoffPolicy.EXPONENTIAL,
                BACKOFF_MINUTES,
                TimeUnit.MINUTES
            )
            .build()

        workManager.enqueueUniquePeriodicWork(
            PERIODIC_WORK_NAME,
            ExistingPeriodicWorkPolicy.UPDATE,
            periodic
        )

        val immediate = OneTimeWorkRequestBuilder<BackgroundSyncWorker>()
            .setConstraints(constraints)
            .setBackoffCriteria(
                BackoffPolicy.EXPONENTIAL,
                BACKOFF_MINUTES,
                TimeUnit.MINUTES
            )
            .build()

        // Activity 재생성으로 실행 중인 즉시 sync를 취소/재시작하지 않는다.
        // 기존 one-time work가 끝난 뒤 다음 앱 실행에서는 새 work가 다시 enqueue된다.
        workManager.enqueueUniqueWork(
            IMMEDIATE_WORK_NAME,
            ExistingWorkPolicy.KEEP,
            immediate
        )
    }

    const val PERIODIC_WORK_NAME = "nomistake_calendar_periodic_sync"
    const val IMMEDIATE_WORK_NAME = "nomistake_calendar_immediate_sync"
    const val REPEAT_MINUTES = 30L
    private const val BACKOFF_MINUTES = 10L
}
