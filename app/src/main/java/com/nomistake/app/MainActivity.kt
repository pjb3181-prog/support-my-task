package com.nomistake.app

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import android.util.Log
import androidx.activity.ComponentActivity
import androidx.activity.compose.BackHandler
import androidx.activity.compose.setContent
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.Column
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.core.content.ContextCompat
import androidx.lifecycle.lifecycleScope
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.room.Room
import com.google.firebase.FirebaseApp
import com.google.firebase.auth.FirebaseAuth
import com.google.firebase.auth.FirebaseAuthException
import com.google.firebase.firestore.FirebaseFirestore
import com.nomistake.app.background.BackgroundSyncScheduler
import com.nomistake.app.data.local.db.AppDatabase
import com.nomistake.app.data.local.db.SeedData
import com.nomistake.app.data.remote.FirebaseAuthManager
import com.nomistake.app.data.remote.FirestoreCalendarSyncSource
import com.nomistake.app.data.remote.GraphClient
import com.nomistake.app.data.remote.MsalAuthManager
import com.nomistake.app.data.repository.CalendarSettingRepository
import com.nomistake.app.data.repository.CalendarSyncRepository
import com.nomistake.app.data.repository.ChecklistRepository
import com.nomistake.app.notification.NotificationAlarmScheduler
import com.nomistake.app.notification.NotificationReceiver
import com.nomistake.app.ui.DebugScreen
import com.nomistake.app.ui.DebugViewModel
import com.nomistake.app.ui.MainScreen
import com.nomistake.app.ui.MainViewModel
import com.nomistake.app.ui.SettingsScreen
import com.nomistake.app.ui.SettingsViewModel
import kotlinx.coroutines.launch

class MainActivity : ComponentActivity() {

    private val db by lazy {
        Room.databaseBuilder(applicationContext, AppDatabase::class.java, AppDatabase.DB_NAME)
            .addMigrations(AppDatabase.MIGRATION_1_2, AppDatabase.MIGRATION_2_3)
            .build()
    }

    private var requestedEventId by mutableStateOf<Long?>(null)

    private val notificationPermissionLauncher = registerForActivityResult(
        ActivityResultContracts.RequestPermission()
    ) { }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        requestedEventId = intent.notificationEventId()

        if (
            Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU &&
            ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED
        ) {
            notificationPermissionLauncher.launch(Manifest.permission.POST_NOTIFICATIONS)
        }

        BackgroundSyncScheduler.schedule(applicationContext)

        val notificationScheduler = NotificationAlarmScheduler(
            context = applicationContext,
            eventDao = db.eventDao(),
            settingDao = db.settingDao()
        )

        lifecycleScope.launch {
            SeedData.seed(db)
            notificationScheduler.rescheduleAll()
        }

        val authManager = MsalAuthManager(this)
        val graphClient = GraphClient()
        val calendarSettingRepository = CalendarSettingRepository(db.settingDao())

        val firebaseReady = FirebaseApp.getApps(applicationContext).isNotEmpty()
        val firebaseAuthManager = if (firebaseReady) FirebaseAuthManager(FirebaseAuth.getInstance()) else null
        if (firebaseAuthManager != null) {
            lifecycleScope.launch {
                try {
                    firebaseAuthManager.ensureAnonymousSignIn()
                    BackgroundSyncScheduler.requestImmediate(applicationContext)
                } catch (e: Exception) {
                    val authCode = (e as? FirebaseAuthException)?.errorCode ?: e::class.java.simpleName
                    Log.w(TAG, "Anonymous Firebase auth failed at app start: $authCode")
                }
            }
        }

        val syncRepository = if (firebaseReady) {
            CalendarSyncRepository(
                syncSource = FirestoreCalendarSyncSource(FirebaseFirestore.getInstance()),
                eventDao = db.eventDao(),
                templateDao = db.templateDao(),
                checklistRepository = ChecklistRepository(db.checklistDao(), db.templateDao()),
                checklistDao = db.checklistDao(),
                settingDao = db.settingDao()
            )
        } else null

        setContent {
            MaterialTheme {
                val mainViewModel: MainViewModel = viewModel {
                    MainViewModel(eventDao = db.eventDao(), checklistDao = db.checklistDao())
                }
                val debugViewModel: DebugViewModel = viewModel {
                    DebugViewModel(
                        msalAuthManager = authManager,
                        graphClient = graphClient,
                        calendarSettingRepository = calendarSettingRepository,
                        firebaseAuthManager = firebaseAuthManager,
                        syncRepository = syncRepository,
                        notificationScheduler = notificationScheduler
                    )
                }
                val settingsViewModel: SettingsViewModel = viewModel {
                    SettingsViewModel(
                        settingDao = db.settingDao(),
                        templateDao = db.templateDao(),
                        notificationScheduler = notificationScheduler,
                        requestImmediateSync = {
                            BackgroundSyncScheduler.requestImmediate(applicationContext)
                        }
                    )
                }

                var showDebug by rememberSaveable { mutableStateOf(false) }
                var showSettings by rememberSaveable { mutableStateOf(false) }

                BackHandler(enabled = showDebug) {
                    showDebug = false
                }

                LaunchedEffect(requestedEventId) {
                    requestedEventId?.let { eventId ->
                        showDebug = false
                        showSettings = false
                        mainViewModel.openEvent(eventId)
                        requestedEventId = null
                    }
                }

                when {
                    showDebug -> {
                        Column {
                            TextButton(onClick = { showDebug = false }) { Text("← 일정으로") }
                            DebugScreen(debugViewModel)
                        }
                    }

                    showSettings -> {
                        SettingsScreen(viewModel = settingsViewModel, onBack = { showSettings = false })
                    }

                    else -> {
                        MainScreen(
                            viewModel = mainViewModel,
                            onOpenSettings = { showSettings = true },
                            onOpenDebug = { showDebug = true }
                        )
                    }
                }
            }
        }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        requestedEventId = intent.notificationEventId()
    }

    private fun Intent.notificationEventId(): Long? {
        val value = getLongExtra(NotificationReceiver.EXTRA_EVENT_ID, -1L)
        return value.takeIf { it > 0L }
    }

    companion object {
        private const val TAG = "NoMistakeAuth"
    }
}
