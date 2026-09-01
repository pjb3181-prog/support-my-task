package com.nomistake.app

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.layout.Column
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.lifecycle.lifecycleScope
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.room.Room
import com.google.firebase.FirebaseApp
import com.google.firebase.auth.FirebaseAuth
import com.google.firebase.firestore.FirebaseFirestore
import com.nomistake.app.data.local.db.AppDatabase
import com.nomistake.app.data.local.db.SeedData
import com.nomistake.app.data.remote.FirebaseAuthManager
import com.nomistake.app.data.remote.FirestoreCalendarSyncSource
import com.nomistake.app.data.remote.GraphClient
import com.nomistake.app.data.remote.MsalAuthManager
import com.nomistake.app.data.repository.CalendarSettingRepository
import com.nomistake.app.data.repository.CalendarSyncRepository
import com.nomistake.app.data.repository.ChecklistRepository
import com.nomistake.app.ui.DebugScreen
import com.nomistake.app.ui.DebugViewModel
import com.nomistake.app.ui.MainScreen
import com.nomistake.app.ui.MainViewModel
import kotlinx.coroutines.launch

class MainActivity : ComponentActivity() {

    private val db by lazy {
        Room.databaseBuilder(applicationContext, AppDatabase::class.java, AppDatabase.DB_NAME)
            .addMigrations(AppDatabase.MIGRATION_1_2) // 정식 migration — destructive 금지
            .build()
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        lifecycleScope.launch {
            SeedData.seed(db)
        }

        val authManager = MsalAuthManager(this)
        val graphClient = GraphClient()
        val calendarSettingRepository = CalendarSettingRepository(db.settingDao())

        // [Phase 5] google-services.json이 있을 때만 Firebase가 자동 초기화되어 있다
        // (build.gradle.kts에서 조건부 google-services 플러그인).
        // 파일이 없으면 Firebase 기능을 끄고 Graph fallback만 동작한다.
        val firebaseReady = FirebaseApp.getApps(applicationContext).isNotEmpty()
        val firebaseAuthManager = if (firebaseReady) {
            FirebaseAuthManager(FirebaseAuth.getInstance())
        } else null
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
                    MainViewModel(
                        eventDao = db.eventDao(),
                        checklistDao = db.checklistDao()
                    )
                }
                val debugViewModel: DebugViewModel = viewModel {
                    DebugViewModel(
                        msalAuthManager = authManager,
                        graphClient = graphClient,
                        calendarSettingRepository = calendarSettingRepository,
                        firebaseAuthManager = firebaseAuthManager,
                        syncRepository = syncRepository
                    )
                }

                var showDebug by rememberSaveable { mutableStateOf(false) }
                if (showDebug) {
                    Column {
                        TextButton(onClick = { showDebug = false }) {
                            Text("← 일정으로")
                        }
                        DebugScreen(debugViewModel)
                    }
                } else {
                    MainScreen(
                        viewModel = mainViewModel,
                        onOpenDebug = { showDebug = true }
                    )
                }
            }
        }
    }
}
