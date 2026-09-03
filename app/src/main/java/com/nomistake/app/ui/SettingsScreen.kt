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
import androidx.compose.runtime.LaunchedEffect
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
import com.nomistake.app.data.local.entity.ChecklistTemplateEntity
import com.nomistake.app.data.local.entity.NotificationRuleEntity
import com.nomistake.app.data.local.entity.RuleAppliesTo
import kotlin.math.abs

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
    val notificationDayDrafts = remember { mutableStateMapOf<Long, String>() }
    var selectedTemplate by remember { mutableStateOf<ChecklistTemplateEntity?>(null) }
    var templatePendingDelete by remember { mutableStateOf<ChecklistTemplateEntity?>(null) }
    var templateOriginal by remember { mutableStateOf("") }
    var templateDraft by remember { mutableStateOf("") }
    var showLeaveDialog by remember { mutableStateOf(false) }

    LaunchedEffect(selectedTemplate?.id) {
        selectedTemplate?.let { template ->
            val text = viewModel.getTemplateItemsText(template.id)
            templateOriginal = text
            templateDraft = text
        }
    }

    val profileDirty = displayNameInput.trim() != viewModel.displayName || markerInput.trim() != viewModel.mineMarker
    val typeDirty = typeName.isNotBlank() || keyword.isNotBlank() || checklistText.isNotBlank()
    val templateDirty = selectedTemplate != null && templateDraft.trim() != templateOriginal.trim()
    val hasUnsaved = profileDirty || typeDirty || templateDirty || notificationDrafts.isNotEmpty() || notificationDayDrafts.isNotEmpty()
    val profileSavable = !profileDirty || (displayNameInput.trim().isNotEmpty() && markerInput.trim().isNotEmpty())
    val typeSavable = !typeDirty || (typeName.isNotBlank() && keyword.isNotBlank() && checklistText.isNotBlank())
    val templateSavable = !templateDirty || templateDraft.lineSequence().any { it.isNotBlank() }
    val notificationsSavable = notificationDrafts.all { (id, value) ->
        rules.firstOrNull { it.id == id }?.let { isTimeDraftValid(it, value) } ?: false
    } && notificationDayDrafts.all { (_, value) -> value.toIntOrNull()?.let { it >= 0 } == true }
    val canSaveAll = profileSavable && typeSavable && templateSavable && notificationsSavable

    fun leaveWithoutSaving() {
        showLeaveDialog = false
        onBack()
    }

    fun saveAllAndLeave() {
        if (!canSaveAll) return
        if (profileDirty) viewModel.saveProfile(displayNameInput, markerInput)
        if (typeDirty) viewModel.addTaskType(typeName, keyword, checklistText)
        if (templateDirty) selectedTemplate?.let { viewModel.saveTemplateItems(it, templateDraft) }
        rules.forEach { rule ->
            val timeDraft = notificationDrafts[rule.id]
            val dayDraft = notificationDayDrafts[rule.id]
            when {
                rule.dayOffset != null && rule.timeOfDay != null && (timeDraft != null || dayDraft != null) -> {
                    val days = dayDraft ?: abs(rule.dayOffset).toString()
                    val time = timeDraft ?: rule.timeOfDay
                    viewModel.saveDayAndTime(rule, days, time)
                }
                timeDraft != null -> viewModel.saveTiming(rule, timeDraft)
            }
        }
        notificationDrafts.clear()
        notificationDayDrafts.clear()
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
            title = { Text("저장하지 않은 변경사항") },
            text = {
                Text(
                    if (canSaveAll) "변경 내용을 저장하고 일정 화면으로 돌아갈까요?"
                    else "입력이 완료되지 않은 항목이 있습니다. 계속 작성하거나 변경사항을 버리고 이동할 수 있습니다."
                )
            },
            confirmButton = {
                TextButton(onClick = ::saveAllAndLeave, enabled = canSaveAll) { Text("저장 후 이동") }
            },
            dismissButton = {
                Row {
                    TextButton(onClick = { showLeaveDialog = false }) { Text("계속 작성") }
                    TextButton(onClick = ::leaveWithoutSaving) { Text("저장 안 함") }
                }
            }
        )
    }

    templatePendingDelete?.let { template ->
        AlertDialog(
            onDismissRequest = { templatePendingDelete = null },
            title = { Text("업무 유형 삭제") },
            text = {
                Text("'${template.name}' 업무 유형과 자동 분류 규칙을 삭제합니다. 이미 만들어진 일정의 체크리스트는 유지됩니다.")
            },
            confirmButton = {
                TextButton(
                    onClick = {
                        if (selectedTemplate?.id == template.id) {
                            selectedTemplate = null
                            templateDraft = ""
                            templateOriginal = ""
                        }
                        viewModel.deleteTaskType(template)
                        templatePendingDelete = null
                    }
                ) { Text("삭제", color = MaterialTheme.colorScheme.error) }
            },
            dismissButton = {
                TextButton(onClick = { templatePendingDelete = null }) { Text("취소") }
            }
        )
    }

    Scaffold(
        topBar = {
            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 12.dp, vertical = 10.dp)
            ) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    TextButton(onClick = ::requestBack) { Text("← 일정") }
                    Column(modifier = Modifier.weight(1f).padding(start = 4.dp)) {
                        Text("설정", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold)
                        Text(
                            "MERI Schedule Assistant 환경설정",
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant
                        )
                    }
                }
            }
        }
    ) { padding ->
        LazyColumn(
            modifier = Modifier
                .fillMaxSize()
                .padding(padding)
                .padding(horizontal = 12.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp)
        ) {
            item {
                SettingsSectionCard(
                    title = "내 일정 설정",
                    description = "Outlook 일정 제목에서 내 업무만 구분하기 위한 기본 정보입니다."
                ) {
                    viewModel.status?.let {
                        Text(it, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.primary)
                        Spacer(Modifier.height(8.dp))
                    }
                    OutlinedTextField(
                        value = displayNameInput,
                        onValueChange = { displayNameInput = it },
                        label = { Text("표시 이름") },
                        placeholder = { Text("예: 박종범") },
                        singleLine = true,
                        modifier = Modifier.fillMaxWidth()
                    )
                    Spacer(Modifier.height(8.dp))
                    OutlinedTextField(
                        value = markerInput,
                        onValueChange = { markerInput = it },
                        label = { Text("내 일정 식별문자") },
                        supportingText = { Text("일정 제목 마지막 [참석자코드]에서 찾습니다. 예: 종") },
                        singleLine = true,
                        modifier = Modifier.fillMaxWidth()
                    )
                    Spacer(Modifier.height(8.dp))
                    Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) {
                        Button(
                            onClick = { viewModel.saveProfile(displayNameInput, markerInput) },
                            enabled = displayNameInput.trim().isNotEmpty() && markerInput.trim().isNotEmpty() && profileDirty
                        ) { Text("적용") }
                    }
                }
            }

            item {
                SettingsSectionCard(
                    title = "업무 유형 및 준비항목",
                    description = "업무 유형별 기본 준비 체크리스트를 수정·삭제하거나 새 유형을 추가할 수 있습니다."
                ) {
                    Text("등록된 업무 유형", style = MaterialTheme.typography.labelLarge, fontWeight = FontWeight.SemiBold)
                    Spacer(Modifier.height(6.dp))
                    taskTypes.forEach { template ->
                        Row(
                            modifier = Modifier.fillMaxWidth(),
                            verticalAlignment = Alignment.CenterVertically
                        ) {
                            Text(template.name, modifier = Modifier.weight(1f), style = MaterialTheme.typography.bodyLarge)
                            TextButton(onClick = { selectedTemplate = template }) { Text("수정") }
                            TextButton(onClick = { templatePendingDelete = template }) {
                                Text("삭제", color = MaterialTheme.colorScheme.error)
                            }
                        }
                    }

                    selectedTemplate?.let { template ->
                        Spacer(Modifier.height(8.dp))
                        HorizontalDivider()
                        Spacer(Modifier.height(12.dp))
                        Text("${template.name} 기본 준비항목", style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.Bold)
                        Spacer(Modifier.height(8.dp))
                        OutlinedTextField(
                            value = templateDraft,
                            onValueChange = { templateDraft = it },
                            label = { Text("준비항목") },
                            supportingText = { Text("한 줄에 하나씩 입력 · 이후 동기화되는 일정에 반영") },
                            minLines = 3,
                            modifier = Modifier.fillMaxWidth()
                        )
                        Spacer(Modifier.height(8.dp))
                        Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) {
                            TextButton(onClick = { selectedTemplate = null; templateDraft = ""; templateOriginal = "" }) { Text("닫기") }
                            Button(
                                onClick = {
                                    viewModel.saveTemplateItems(template, templateDraft)
                                    templateOriginal = templateDraft
                                },
                                enabled = templateDirty && templateDraft.lineSequence().any { it.isNotBlank() }
                            ) { Text("준비항목 저장") }
                        }
                    }

                    Spacer(Modifier.height(12.dp))
                    HorizontalDivider()
                    Spacer(Modifier.height(12.dp))
                    Text("새 업무 유형 추가", style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.Bold)
                    Spacer(Modifier.height(8.dp))
                    OutlinedTextField(
                        value = typeName,
                        onValueChange = { typeName = it },
                        label = { Text("업무 유형명") },
                        placeholder = { Text("예: What-if, JSA") },
                        singleLine = true,
                        modifier = Modifier.fillMaxWidth()
                    )
                    Spacer(Modifier.height(8.dp))
                    OutlinedTextField(
                        value = keyword,
                        onValueChange = { keyword = it },
                        label = { Text("일정 제목 키워드") },
                        placeholder = { Text("예: What-if") },
                        singleLine = true,
                        modifier = Modifier.fillMaxWidth()
                    )
                    Spacer(Modifier.height(8.dp))
                    OutlinedTextField(
                        value = checklistText,
                        onValueChange = { checklistText = it },
                        label = { Text("기본 준비항목") },
                        supportingText = { Text("한 줄에 하나씩 입력") },
                        placeholder = { Text("관련자료 확인\n노트북\n충전기") },
                        minLines = 3,
                        modifier = Modifier.fillMaxWidth()
                    )
                    Spacer(Modifier.height(8.dp))
                    Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) {
                        Button(
                            onClick = {
                                viewModel.addTaskType(typeName, keyword, checklistText)
                                typeName = ""
                                keyword = ""
                                checklistText = ""
                            },
                            enabled = typeName.isNotBlank() && keyword.isNotBlank() && checklistText.isNotBlank()
                        ) { Text("업무 유형 추가") }
                    }
                }
            }

            item {
                Column(modifier = Modifier.padding(horizontal = 4.dp, vertical = 2.dp)) {
                    Text("알림", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold)
                    Text(
                        "며칠 전인지와 알림 시각까지 직접 조정할 수 있습니다.",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                }
            }

            if (rules.isEmpty()) {
                item {
                    Card(modifier = Modifier.fillMaxWidth()) {
                        Text("알림 규칙을 불러오는 중입니다.", modifier = Modifier.padding(16.dp))
                    }
                }
            } else {
                items(rules, key = { it.id }) { rule ->
                    NotificationRuleCard(
                        rule = rule,
                        title = viewModel.notificationRuleTitle(rule),
                        draftValue = notificationDrafts[rule.id],
                        dayDraftValue = notificationDayDrafts[rule.id],
                        onDraftChange = { value ->
                            val initial = rule.minutesBefore?.toString() ?: rule.timeOfDay.orEmpty()
                            if (value == initial) notificationDrafts.remove(rule.id) else notificationDrafts[rule.id] = value
                        },
                        onDayDraftChange = { value ->
                            val initial = abs(rule.dayOffset ?: 0).toString()
                            if (value == initial) notificationDayDrafts.remove(rule.id) else notificationDayDrafts[rule.id] = value
                        },
                        onEnabledChange = { viewModel.setEnabled(rule, it) },
                        onSave = { daysBefore, timeValue ->
                            if (rule.dayOffset != null && rule.timeOfDay != null) {
                                viewModel.saveDayAndTime(rule, daysBefore, timeValue)
                                notificationDayDrafts.remove(rule.id)
                                notificationDrafts.remove(rule.id)
                            } else {
                                viewModel.saveTiming(rule, timeValue)
                                notificationDrafts.remove(rule.id)
                            }
                        }
                    )
                }
            }

            item {
                SettingsSectionCard(
                    title = "동기화 안내",
                    description = "백그라운드 동기화는 업무시간 중심으로 동작합니다."
                ) {
                    Text(
                        "00:00~07:59에는 자동 동기화를 쉬며, 앱을 직접 열거나 설정을 변경하면 즉시 동기화할 수 있습니다.",
                        style = MaterialTheme.typography.bodyMedium
                    )
                    Spacer(Modifier.height(6.dp))
                    Text(
                        "종일 일정에는 '몇 분 전' 방식의 알림이 적용되지 않습니다.",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                }
            }

            item { Spacer(Modifier.height(20.dp)) }
        }
    }
}

@Composable
private fun SettingsSectionCard(
    title: String,
    description: String,
    content: @Composable () -> Unit
) {
    Card(modifier = Modifier.fillMaxWidth()) {
        Column(modifier = Modifier.padding(16.dp)) {
            Text(title, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
            Spacer(Modifier.height(4.dp))
            Text(description, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            Spacer(Modifier.height(14.dp))
            content()
        }
    }
}

private fun isTimeDraftValid(rule: NotificationRuleEntity, value: String): Boolean {
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
    title: String,
    draftValue: String?,
    dayDraftValue: String?,
    onDraftChange: (String) -> Unit,
    onDayDraftChange: (String) -> Unit,
    onEnabledChange: (Boolean) -> Unit,
    onSave: (String, String) -> Unit
) {
    val initialValue = rule.minutesBefore?.toString() ?: rule.timeOfDay.orEmpty()
    val value = draftValue ?: initialValue
    val absolute = rule.dayOffset != null && rule.timeOfDay != null
    val initialDays = abs(rule.dayOffset ?: 0).toString()
    val days = dayDraftValue ?: initialDays
    val dirty = value != initialValue || (absolute && days != initialDays)
    val valid = isTimeDraftValid(rule, value) && (!absolute || days.toIntOrNull()?.let { it >= 0 } == true)

    Card(modifier = Modifier.fillMaxWidth()) {
        Column(modifier = Modifier.padding(16.dp)) {
            Row(modifier = Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                Column(modifier = Modifier.weight(1f)) {
                    Text(title, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
                    Text(
                        if (rule.appliesTo == RuleAppliesTo.TIMED_ONLY) "시간이 지정된 일정" else "대상 일정 전체",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                }
                Switch(checked = rule.enabled, onCheckedChange = onEnabledChange)
            }

            if (rule.enabled) {
                Spacer(Modifier.height(12.dp))
                if (absolute) {
                    OutlinedTextField(
                        value = days,
                        onValueChange = onDayDraftChange,
                        label = { Text("며칠 전") },
                        supportingText = { Text("0 = 당일, 1 = D-1, 2 = D-2") },
                        singleLine = true,
                        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
                        modifier = Modifier.fillMaxWidth()
                    )
                    Spacer(Modifier.height(8.dp))
                }
                OutlinedTextField(
                    value = value,
                    onValueChange = onDraftChange,
                    label = { Text(if (absolute) "알림 시각" else "몇 분 전 알림") },
                    supportingText = { if (absolute) Text("24시간 표기, 예: 14:00") },
                    singleLine = true,
                    keyboardOptions = KeyboardOptions(keyboardType = if (absolute) KeyboardType.Ascii else KeyboardType.Number),
                    modifier = Modifier.fillMaxWidth()
                )
                if (dirty) {
                    Spacer(Modifier.height(8.dp))
                    Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) {
                        Button(onClick = { onSave(days, value) }, enabled = valid) { Text("변경 적용") }
                    }
                }
            }
        }
    }
}
