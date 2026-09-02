package com.nomistake.app.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import com.nomistake.app.data.local.entity.NotificationRuleEntity
import com.nomistake.app.data.local.entity.RuleAppliesTo

@Composable
fun SettingsScreen(
    viewModel: SettingsViewModel,
    onBack: () -> Unit
) {
    val rules by viewModel.notificationRules.collectAsState()
    val taskTypes by viewModel.typeTemplates.collectAsState()
    var markerInput by remember(viewModel.mineMarker) { mutableStateOf(viewModel.mineMarker) }
    var typeName by remember { mutableStateOf("") }
    var keyword by remember { mutableStateOf("") }
    var checklistText by remember { mutableStateOf("") }

    Scaffold(
        topBar = {
            Row(
                modifier = Modifier.fillMaxWidth().padding(horizontal = 8.dp, vertical = 8.dp),
                verticalAlignment = Alignment.CenterVertically
            ) {
                TextButton(onClick = onBack) { Text("← 일정") }
                Text("설정", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold)
            }
        }
    ) { padding ->
        LazyColumn(
            modifier = Modifier.fillMaxSize().padding(padding).padding(horizontal = 16.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp)
        ) {
            item {
                Text("계정", style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.Bold)
                if (!viewModel.firebaseAvailable) {
                    Text("이 빌드에는 Firebase 연결 설정이 없습니다.", style = MaterialTheme.typography.bodySmall)
                } else if (viewModel.signedInAs != null) {
                    Text("로그인: ${viewModel.signedInAs}", style = MaterialTheme.typography.bodyMedium)
                    Text("계정은 일정 읽기 권한에만 사용하며 비밀번호를 앱에 저장하지 않습니다.", style = MaterialTheme.typography.bodySmall)
                    Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) {
                        TextButton(onClick = viewModel::signOut) { Text("로그아웃") }
                    }
                } else {
                    Text("사내 파일럿용으로 발급받은 계정으로 로그인하세요.", style = MaterialTheme.typography.bodySmall)
                    Spacer(Modifier.height(8.dp))
                    OutlinedTextField(
                        value = viewModel.emailInput,
                        onValueChange = { viewModel.emailInput = it },
                        label = { Text("이메일") },
                        singleLine = true,
                        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Email),
                        modifier = Modifier.fillMaxWidth()
                    )
                    OutlinedTextField(
                        value = viewModel.passwordInput,
                        onValueChange = { viewModel.passwordInput = it },
                        label = { Text("비밀번호") },
                        singleLine = true,
                        visualTransformation = PasswordVisualTransformation(),
                        modifier = Modifier.fillMaxWidth()
                    )
                    Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) {
                        Button(
                            onClick = viewModel::signIn,
                            enabled = viewModel.emailInput.isNotBlank() && viewModel.passwordInput.isNotEmpty()
                        ) { Text("로그인") }
                    }
                }
                viewModel.status?.let {
                    Spacer(Modifier.height(8.dp))
                    Text(it, style = MaterialTheme.typography.bodyMedium)
                }
                Spacer(Modifier.height(12.dp))
                HorizontalDivider()
            }

            item {
                Text("내 일정", style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.Bold)
                Text(
                    "일정 제목의 마지막 [참석자코드] 안에서 내 식별문자를 찾습니다. 사람마다 자기 값을 설정하면 됩니다.",
                    style = MaterialTheme.typography.bodySmall
                )
                Spacer(Modifier.height(8.dp))
                OutlinedTextField(
                    value = markerInput,
                    onValueChange = { markerInput = it },
                    label = { Text("내 일정 식별문자") },
                    supportingText = { Text("예: 종 · 저장하면 일정 재분류 sync가 실행됩니다.") },
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth()
                )
                Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) {
                    Button(
                        onClick = { viewModel.saveMineMarker(markerInput) },
                        enabled = markerInput.trim().isNotEmpty() && markerInput.trim() != viewModel.mineMarker
                    ) { Text("저장") }
                }
                Spacer(Modifier.height(12.dp))
                HorizontalDivider()
            }

            item {
                Text("업무 유형", style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.Bold)
                Text(
                    "HAZOP·LOPA·FMEA뿐 아니라 새 위험성평가/업무를 직접 추가할 수 있습니다. 새 유형은 이후 일정에 자동 분류되고 체크항목이 붙습니다.",
                    style = MaterialTheme.typography.bodySmall
                )
                Spacer(Modifier.height(8.dp))
                Text(
                    "현재: ${taskTypes.joinToString(" · ") { it.name }}",
                    style = MaterialTheme.typography.bodyMedium
                )
                Spacer(Modifier.height(10.dp))
                OutlinedTextField(
                    value = typeName,
                    onValueChange = { typeName = it },
                    label = { Text("업무유형 이름") },
                    placeholder = { Text("예: What-if, JSA") },
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth()
                )
                OutlinedTextField(
                    value = keyword,
                    onValueChange = { keyword = it },
                    label = { Text("제목에서 찾을 키워드") },
                    placeholder = { Text("예: What-if") },
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth()
                )
                OutlinedTextField(
                    value = checklistText,
                    onValueChange = { checklistText = it },
                    label = { Text("기본 체크항목 · 한 줄에 하나") },
                    placeholder = { Text("관련자료 확인\n노트북\n충전기") },
                    minLines = 3,
                    modifier = Modifier.fillMaxWidth()
                )
                Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) {
                    Button(
                        onClick = { viewModel.addTaskType(typeName, keyword, checklistText) },
                        enabled = typeName.isNotBlank() && keyword.isNotBlank() && checklistText.isNotBlank()
                    ) { Text("업무유형 추가") }
                }
                Spacer(Modifier.height(12.dp))
                HorizontalDivider()
            }

            item {
                Text("알림 규칙", style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.Bold)
                Text("변경하면 현재 일정 기준으로 알람을 즉시 다시 등록합니다.", style = MaterialTheme.typography.bodySmall)
                Spacer(Modifier.height(8.dp))
            }

            if (rules.isEmpty()) {
                item { Text("알림 규칙을 불러오는 중입니다.") }
            } else {
                items(rules, key = { it.id }) { rule ->
                    NotificationRuleCard(
                        rule = rule,
                        onEnabledChange = { viewModel.setEnabled(rule, it) },
                        onSaveTiming = { viewModel.saveTiming(rule, it) }
                    )
                }
            }

            item {
                Spacer(Modifier.height(12.dp))
                Text("자동 백그라운드 동기화는 00:00~07:59에는 Firestore를 읽지 않습니다. 앱을 직접 열거나 설정을 저장해 발생한 동기화는 예외입니다.", style = MaterialTheme.typography.bodySmall)
                Spacer(Modifier.height(4.dp))
                Text("종일 일정에는 '시간 지정 일정만' 규칙(T-60/T-30)이 적용되지 않습니다.", style = MaterialTheme.typography.bodySmall)
                Spacer(Modifier.height(24.dp))
            }
        }
    }
}

@Composable
private fun NotificationRuleCard(
    rule: NotificationRuleEntity,
    onEnabledChange: (Boolean) -> Unit,
    onSaveTiming: (String) -> Unit
) {
    val initialValue = rule.minutesBefore?.toString() ?: rule.timeOfDay.orEmpty()
    var value by remember(rule.id, rule.minutesBefore, rule.timeOfDay) { mutableStateOf(initialValue) }
    val relative = rule.minutesBefore != null

    Card(modifier = Modifier.fillMaxWidth()) {
        Column(modifier = Modifier.padding(16.dp)) {
            Row(modifier = Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                Column(modifier = Modifier.weight(1f)) {
                    Text(rule.label, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
                    Text(
                        if (rule.appliesTo == RuleAppliesTo.TIMED_ONLY) "시간 지정 일정만" else "모든 대상 일정",
                        style = MaterialTheme.typography.bodySmall
                    )
                }
                Switch(checked = rule.enabled, onCheckedChange = onEnabledChange)
            }

            Spacer(Modifier.height(10.dp))
            OutlinedTextField(
                value = value,
                onValueChange = { value = it },
                enabled = rule.enabled,
                label = { Text(if (relative) "몇 분 전" else "알림 시간 (HH:mm)") },
                singleLine = true,
                keyboardOptions = KeyboardOptions(keyboardType = if (relative) KeyboardType.Number else KeyboardType.Ascii),
                modifier = Modifier.fillMaxWidth()
            )
            Spacer(Modifier.height(8.dp))
            Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) {
                Button(
                    onClick = { onSaveTiming(value) },
                    enabled = rule.enabled && value.isNotBlank() && value != initialValue
                ) { Text("저장") }
            }
        }
    }
}
