package com.nomistake.app.background

import android.content.Context
import androidx.work.BackoffPolicy
import androidx.work.Constraints
import androidx.work.Data
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import java.util.concurrent.TimeUnit

/**
 * 30분 periodic sync + 사용자 동작 시 immediate sync.
 * periodic는 00:00~07:59 quiet hours를 따르고, immediate는 사용자가 앱을 열거나 설정을
 * 변경한 명시적 요청이므로 quiet hours를 우회한다.
 */
object BackgroundSyncScheduler {

    fun schedule(context: Context) {
        val workManager = WorkManager.getInstance(context.applicationContext)
        val constraints = connectedConstraints()

        val periodic = PeriodicWorkRequestBuilder<BackgroundSyncWorker>(
            REPEAT_MINUTES,
            TimeUnit.MINUTES
        )
            .setConstraints(constraints)
            .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, BACKOFF_MINUTES, TimeUnit.MINUTES)
            .build()

        workManager.enqueueUniquePeriodicWork(
            PERIODIC_WORK_NAME,
            ExistingPeriodicWorkPolicy.UPDATE,
            periodic
        )

        enqueueImmediate(context, ExistingWorkPolicy.KEEP)
    }

    fun requestImmediate(context: Context) {
        enqueueImmediate(context, ExistingWorkPolicy.REPLACE)
    }

    private fun enqueueImmediate(context: Context, policy: ExistingWorkPolicy) {
        val immediate = OneTimeWorkRequestBuilder<BackgroundSyncWorker>()
            .setConstraints(connectedConstraints())
            .setInputData(Data.Builder().putBoolean(KEY_FORCE_SYNC, true).build())
            .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, BACKOFF_MINUTES, TimeUnit.MINUTES)
            .build()

        WorkManager.getInstance(context.applicationContext).enqueueUniqueWork(
            IMMEDIATE_WORK_NAME,
            policy,
            immediate
        )
    }

    private fun connectedConstraints(): Constraints = Constraints.Builder()
        .setRequiredNetworkType(NetworkType.CONNECTED)
        .build()

    const val PERIODIC_WORK_NAME = "nomistake_calendar_periodic_sync"
    const val IMMEDIATE_WORK_NAME = "nomistake_calendar_immediate_sync"
    const val REPEAT_MINUTES = 30L
    const val KEY_FORCE_SYNC = "forceSync"
    private const val BACKOFF_MINUTES = 10L
}
