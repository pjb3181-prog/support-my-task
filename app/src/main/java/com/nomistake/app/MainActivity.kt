package com.nomistake.app

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.material3.MaterialTheme
import androidx.lifecycle.lifecycleScope
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.room.Room
import com.nomistake.app.data.local.db.AppDatabase
import com.nomistake.app.data.local.db.SeedData
import com.nomistake.app.data.remote.GraphClient
import com.nomistake.app.data.remote.MsalAuthManager
import com.nomistake.app.data.repository.CalendarSettingRepository
import com.nomistake.app.ui.DebugScreen
import com.nomistake.app.ui.DebugViewModel
import kotlinx.coroutines.launch

class MainActivity : ComponentActivity() {

    private val db by lazy {
        Room.databaseBuilder(applicationContext, AppDatabase::class.java, "nomistake.db").build()
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        lifecycleScope.launch {
            SeedData.seed(db)
        }

        val authManager = MsalAuthManager(this)
        val graphClient = GraphClient()
        val calendarSettingRepository = CalendarSettingRepository(db.settingDao())

        setContent {
            MaterialTheme {
                val viewModel: DebugViewModel = viewModel {
                    DebugViewModel(authManager, graphClient, calendarSettingRepository)
                }
                DebugScreen(viewModel)
            }
        }
    }
}

