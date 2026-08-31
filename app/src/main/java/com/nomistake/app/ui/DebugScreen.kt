package com.nomistake.app.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import android.app.Activity

/**
 * Phase 4~5 연결 검증용 Debug 화면.
 *
 * [Firebase(primary)] 로그인 상태 / Email-Password 로그인 폼 / Sync now /
 * fetched·target·upsert·checklist 생성·tombstone 카운트 / 마지막 성공 sync 시각
 * [Graph(fallback)] 기존 Phase 4 검증 버튼(Sign in / Find MERI / Load test events)
 *
 * 실제 일정 제목은 화면에 표시하지 않는다(카운트/요약만).
 */
@Composable
fun DebugScreen(viewModel: DebugViewModel) {
    Column(
        modifier = Modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(24.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp)
    ) {
        Text(
            text = "NoMistake Debug (Phase 5)",
            style = MaterialTheme.typography.titleLarge
        )
        Text(
            text = "status: ${viewModel.status}",
            style = MaterialTheme.typography.bodySmall
        )

        HorizontalDivider()
        FirebaseSection(viewModel)
        HorizontalDivider()
        GraphSection(viewModel)
    }
}

@Composable
private fun FirebaseSection(viewModel: DebugViewModel) {
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Text("Firebase / Firestore (primary)", style = MaterialTheme.typography.titleMedium)

        if (!viewModel.firebaseAvailable) {
            Text(
                text = "google-services.json 없음 — Firebase 기능 OFF. " +
                    "app/google-services.json에 파일을 두면 활성화된다.",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.error
            )
            return@Column
        }

        Text(
            text = "로그인 상태: ${viewModel.signedInAs ?: "not signed in"}",
            style = MaterialTheme.typography.bodySmall
        )

        OutlinedTextField(
            value = viewModel.emailInput,
            onValueChange = { viewModel.emailInput = it },
            label = { Text("Email") },
            singleLine = true,
            modifier = Modifier.fillMaxWidth()
        )
        OutlinedTextField(
            value = viewModel.passwordInput,
            onValueChange = { viewModel.passwordInput = it },
            label = { Text("Password") },
            singleLine = true,
            visualTransformation = PasswordVisualTransformation(),
            modifier = Modifier.fillMaxWidth()
        )

        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Button(onClick = { viewModel.firebaseSignIn() }) {
                Text("Sign in (Email/Password)")
            }
            if (viewModel.signedInAs != null) {
                Button(onClick = { viewModel.firebaseSignOut() }) {
                    Text("Sign out")
                }
            }
        }

        Button(onClick = { viewModel.syncNow() }) {
            Text("Sync now (Firestore → Room)")
        }

        viewModel.lastStats?.let { s ->
            Text(
                text = "fetched=${s.fetched} target=${s.target} " +
                    "inserted=${s.inserted} updated=${s.updated} " +
                    "skippedSame=${s.skippedSame} " +
                    "checklistCreated=${s.checklistCreated} " +
                    "tombstone=${s.tombstoneSeen} revived=${s.revived}",
                style = MaterialTheme.typography.bodySmall
            )
        }
        viewModel.lastSyncAt?.let {
            Text(
                text = "last successful sync: $it",
                style = MaterialTheme.typography.bodySmall
            )
        }
    }
}

@Composable
private fun GraphSection(viewModel: DebugViewModel) {
    val activity = LocalContext.current as? Activity
    Column(
        modifier = Modifier.fillMaxWidth(),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(8.dp)
    ) {
        Text("Microsoft Graph (fallback)", style = MaterialTheme.typography.titleMedium)

        Button(
            onClick = { activity?.let { viewModel.signIn(it) } },
            enabled = activity != null
        ) {
            Text("Sign in (MSAL)")
        }

        Button(onClick = { viewModel.findMeriCalendar() }) {
            Text("Find MERI calendar")
        }

        Button(onClick = { viewModel.loadEvents() }) {
            Text("Load test events")
        }

        Spacer(modifier = Modifier.height(8.dp))
    }
}