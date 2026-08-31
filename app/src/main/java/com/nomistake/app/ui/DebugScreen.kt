package com.nomistake.app.ui

import android.app.Activity
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp

/**
 * Phase 4 연결 검증용 임시 Debug 화면.
 * Sign in / Find MERI calendar / Load test events 버튼만 제공한다.
 */
@Composable
fun DebugScreen(viewModel: DebugViewModel) {
    val activity = LocalContext.current as? Activity

    Column(
        modifier = Modifier
            .fillMaxSize()
            .padding(24.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center
    ) {
        Text(
            text = viewModel.status,
            style = MaterialTheme.typography.bodyLarge
        )

        Spacer(modifier = Modifier.height(24.dp))

        Button(
            onClick = { activity?.let { viewModel.signIn(it) } },
            enabled = activity != null
        ) {
            Text("Sign in")
        }

        Spacer(modifier = Modifier.height(12.dp))

        Button(onClick = { viewModel.findMeriCalendar() }) {
            Text("Find MERI calendar")
        }

        Spacer(modifier = Modifier.height(12.dp))

        Button(onClick = { viewModel.loadEvents() }) {
            Text("Load test events")
        }
    }
}
