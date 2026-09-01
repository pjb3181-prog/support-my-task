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
import androidx.compose.ui.unit.dp
import com.nomistake.app.data.local.entity.NotificationRuleEntity
import com.nomistake.app.data.local.entity.RuleAppliesTo

@Composable
fun SettingsScreen(
    viewModel: SettingsViewModel,
    onBack: () -> Unit
) {
    val rules by viewModel.notificationRules.collectAsState()

    Scaffold(
        topBar = {
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 8.dp, vertical = 8.dp),
                verticalAlignment = Alignment.CenterVertically
            ) {
                TextButton(onClick = onBack) { Text("← 일정") }
                Text(
                    "설정",
                    style = MaterialTheme.typography.titleLarge,
                    fontWeight = FontWeight.Bold
                )
            }
        }
    ) { padding ->
        LazyColumn(
            modifier = Modifier
                .fillMaxSize()
                .padding(padding)
                .padding(horizontal = 16.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp)
        ) {
            item {
                Text(
                    "알림 규칙",
                    style = MaterialTheme.typography.headlineSmall,
                    fontWeight = FontWeight.Bold
                )
                Spacer(Modifier.height(4.dp))
                Text(
                    "변경하면 현재 일정 기준으로 알람을 즉시 다시 등록합니다.",
                    style = MaterialTheme.typography.bodySmall
                )
                viewModel.status?.let {
                    Spacer(Modifier.height(8.dp))
                    Text(it, style = MaterialTheme.typography.bodyMedium)
                }
                Spacer(Modifier.height(8.dp))
                HorizontalDivider()
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
                Text(
                    "종일 일정에는 '시간 지정 일정만' 규칙(T-60/T-30)이 적용되지 않습니다.",
                    style = MaterialTheme.typography.bodySmall
                )
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
    var value by remember(rule.id, rule.minutesBefore, rule.timeOfDay) {
        mutableStateOf(initialValue)
    }
    val relative = rule.minutesBefore != null

    Card(modifier = Modifier.fillMaxWidth()) {
        Column(modifier = Modifier.padding(16.dp)) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                verticalAlignment = Alignment.CenterVertically
            ) {
                Column(modifier = Modifier.weight(1f)) {
                    Text(
                        rule.label,
                        style = MaterialTheme.typography.titleMedium,
                        fontWeight = FontWeight.SemiBold
                    )
                    Text(
                        if (rule.appliesTo == RuleAppliesTo.TIMED_ONLY) {
                            "시간 지정 일정만"
                        } else {
                            "모든 대상 일정"
                        },
                        style = MaterialTheme.typography.bodySmall
                    )
                }
                Switch(
                    checked = rule.enabled,
                    onCheckedChange = onEnabledChange
                )
            }

            Spacer(Modifier.height(10.dp))
            OutlinedTextField(
                value = value,
                onValueChange = { value = it },
                enabled = rule.enabled,
                label = {
                    Text(if (relative) "몇 분 전" else "알림 시간 (HH:mm)")
                },
                singleLine = true,
                keyboardOptions = KeyboardOptions(
                    keyboardType = if (relative) KeyboardType.Number else KeyboardType.Ascii
                ),
                modifier = Modifier.fillMaxWidth()
            )
            Spacer(Modifier.height(8.dp))
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.End
            ) {
                Button(
                    onClick = { onSaveTiming(value) },
                    enabled = rule.enabled && value.isNotBlank() && value != initialValue
                ) {
                    Text("저장")
                }
            }
        }
    }
}
