package com.nomistake.app.ui

import androidx.activity.compose.BackHandler
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
import androidx.compose.material3.AlertDialog
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
import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
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
    var displayNameInput by remember(viewModel.displayName) { mutableStateOf(viewModel.displayName) }
    var markerInput by remember(viewModel.mineMarker) { mutableStateOf(viewModel.mineMarker) }
    var typeName by remember { mutableStateOf("") }
    var keyword by remember { mutableStateOf("") }
    var checklistText by remember { mutableStateOf("") }
    val notificationDrafts = remember { mutableStateMapOf<Long, String>() }
    var showLeaveDialog by remember { mutableStateOf(false) }

    val profileDirty = displayNameInput.trim() != viewModel.displayName || markerInput.trim() != viewModel.mineMarker
    val typeDirty = typeName.isNotBlank() || keyword.isNotBlank() || checklistText.isNotBlank()
    val hasUnsaved = profileDirty || typeDirty || notificationDrafts.isNotEmpty()
    val profileSavable = !profileDirty || (displayNameInput.trim().isNotEmpty() && markerInput.trim().isNotEmpty())
    val typeSavable = !typeDirty || (typeName.isNotBlank() && keyword.isNotBlank() && checklistText.isNotBlank())
    val notificationsSavable = notificationDrafts.all { (id, value) ->
        rules.firstOrNull { it.id == id }?.let { isNotificationDraftValid(it, value) } ?: false
    }
    val canSaveAll = profileSavable && typeSavable && notificationsSavable

    fun leaveWithoutSaving() {
        showLeaveDialog = false
        onBack()
    }

    fun saveAllAndLeave() {
        if (!canSaveAll) return
        if (profileDirty) viewModel.saveProfile(displayNameInput, markerInput)
        if (typeDirty) viewModel.addTaskType(typeName, keyword, checklistText)
        notificationDrafts.toMap().forEach { (id, value) ->
            rules.firstOrNull { it.id == id }?.let { viewModel.saveTiming(it, value) }
        }
        notificationDrafts.clear()
        showLeaveDialog = false
        onBack()
    }

    fun requestBack() {
        if (hasUnsaved) showLeaveDialog = true else onBack()
    }

    BackHandler { requestBack() }

    if (showLeaveDialog) {
        AlertDialog(
            onDismissRequest = { showLeaveDialog = false },
            title = { Text("작성 중인 설정이 있습니다") },
            text = {
                Text(
                    if (canSaveAll) "변경 내용을 저장하고 일정 화면으로 이동할까요?"
                    else "작성 중인 항목에 비어 있는 필수값이 있어 지금은 저장할 수 없습니다. 계속 작성하거나 저장하지 않고 이동할 수 있습니다."
                )
            },
            confirmButton = {
                TextButton(onClick = ::saveAllAndLeave, enabled = canSaveAll) { Text("저장 후 이동") }
            },
            dismissButton = {
                Row {
                    TextButton(onClick = { showLeaveDialog = false }) { Text("취소") }
                    TextButton(onClick = ::leaveWithoutSaving) { Text("저장 안 함") }
                }
            }
        )
    }

    Scaffold(
        topBar = {
            Row(
                modifier = Modifier.fillMaxWidth().padding(horizontal = 8.dp, vertical = 8.dp),
                verticalAlignment = Alignment.CenterVertically
            ) {
                TextButton(onClick = ::requestBack) { Text("← 일정") }
                Text("설정", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold)
            }
        }
    ) { padding ->
        LazyColumn(
            modifier = Modifier.fillMaxSize().padding(padding).padding(horizontal = 16.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp)
        ) {
            item {
                Text("내 사용자 설정", style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.Bold)
                Text(
                    "Firebase 로그인은 앱이 자동으로 처리합니다. 여기서는 표시할 사용자명과 일정 제목의 마지막 [참석자코드]에서 찾을 내 식별문자만 설정합니다.",
                    style = MaterialTheme.typography.bodySmall
                )
                viewModel.status?.let {
                    Spacer(Modifier.height(8.dp))
                    Text(it, style = MaterialTheme.typography.bodyMedium)
                }
                Spacer(Modifier.height(8.dp))
                OutlinedTextField(
                    value = displayNameInput,
                    onValueChange = { displayNameInput = it },
                    label = { Text("사용자명") },
                    placeholder = { Text("예: 박종범") },
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth()
                )
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
                        onClick = { viewModel.saveProfile(displayNameInput, markerInput) },
                        enabled = displayNameInput.trim().isNotEmpty() && markerInput.trim().isNotEmpty() && profileDirty
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
                        onClick = {
                            viewModel.addTaskType(typeName, keyword, checklistText)
                            typeName = ""
                            keyword = ""
                            checklistText = ""
                        },
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
                        draftValue = notificationDrafts[rule.id],
                        onDraftChange = { value ->
                            val initial = rule.minutesBefore?.toString() ?: rule.timeOfDay.orEmpty()
                            if (value == initial) notificationDrafts.remove(rule.id)
                            else notificationDrafts[rule.id] = value
                        },
                        onEnabledChange = { viewModel.setEnabled(rule, it) },
                        onSaveTiming = { value ->
                            viewModel.saveTiming(rule, value)
                            notificationDrafts.remove(rule.id)
                        }
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

private fun isNotificationDraftValid(rule: NotificationRuleEntity, value: String): Boolean {
    val normalized = value.trim()
    return when {
        rule.minutesBefore != null -> normalized.toIntOrNull()?.let { it > 0 } == true
        rule.dayOffset != null && rule.timeOfDay != null -> runCatching { java.time.LocalTime.parse(normalized) }.isSuccess
        else -> false
    }
}

@Composable
private fun NotificationRuleCard(
    rule: NotificationRuleEntity,
    draftValue: String?,
    onDraftChange: (String) -> Unit,
    onEnabledChange: (Boolean) -> Unit,
    onSaveTiming: (String) -> Unit
) {
    val initialValue = rule.minutesBefore?.toString() ?: rule.timeOfDay.orEmpty()
    val value = draftValue ?: initialValue
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
                onValueChange = onDraftChange,
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
                    enabled = rule.enabled && isNotificationDraftValid(rule, value) && value != initialValue
                ) { Text("저장") }
            }
        }
    }
}
