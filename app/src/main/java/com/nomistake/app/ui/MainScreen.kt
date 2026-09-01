package com.nomistake.app.ui

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.weight
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.Card
import androidx.compose.material3.Checkbox
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.nomistake.app.data.local.entity.ChecklistItemEntity
import com.nomistake.app.data.local.entity.EventEntity
import java.time.ZoneId
import java.time.format.DateTimeFormatter

private val dateFormatter = DateTimeFormatter.ofPattern("M월 d일 (E)")
private val timeFormatter = DateTimeFormatter.ofPattern("HH:mm")

@Composable
fun MainScreen(
    viewModel: MainViewModel,
    onOpenDebug: () -> Unit
) {
    val selectedEvent by viewModel.selectedEvent.collectAsState()

    if (selectedEvent == null) {
        EventListScreen(viewModel = viewModel, onOpenDebug = onOpenDebug)
    } else {
        EventDetailScreen(viewModel = viewModel)
    }
}

@Composable
private fun EventListScreen(
    viewModel: MainViewModel,
    onOpenDebug: () -> Unit
) {
    val events by viewModel.events.collectAsState()

    Scaffold(
        topBar = {
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 16.dp, vertical = 12.dp),
                verticalAlignment = Alignment.CenterVertically
            ) {
                Text(
                    text = "실수없으셨죠",
                    style = MaterialTheme.typography.headlineSmall,
                    fontWeight = FontWeight.Bold,
                    modifier = Modifier.weight(1f)
                )
                TextButton(onClick = onOpenDebug) {
                    Text("Debug")
                }
            }
        }
    ) { padding ->
        if (events.isEmpty()) {
            Column(
                modifier = Modifier
                    .fillMaxSize()
                    .padding(padding)
                    .padding(24.dp),
                verticalArrangement = Arrangement.Center,
                horizontalAlignment = Alignment.CenterHorizontally
            ) {
                Text("표시할 일정이 없습니다.")
                Spacer(Modifier.height(8.dp))
                Text(
                    "동기화가 필요하면 Debug 화면에서 Sync now를 실행하세요.",
                    style = MaterialTheme.typography.bodySmall
                )
            }
        } else {
            LazyColumn(
                modifier = Modifier
                    .fillMaxSize()
                    .padding(padding),
                verticalArrangement = Arrangement.spacedBy(8.dp)
            ) {
                items(events, key = { it.id }) { event ->
                    EventCard(event = event, onClick = { viewModel.openEvent(event.id) })
                }
            }
        }
    }
}

@Composable
private fun EventCard(event: EventEntity, onClick: () -> Unit) {
    val zone = ZoneId.systemDefault()
    val start = event.startTime.atZone(zone)
    val end = event.endTime.atZone(zone)

    Card(
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = 12.dp)
            .clickable(onClick = onClick)
    ) {
        Column(modifier = Modifier.padding(16.dp)) {
            Text(
                text = event.cleanTitle,
                style = MaterialTheme.typography.titleMedium,
                fontWeight = FontWeight.SemiBold
            )
            Spacer(Modifier.height(6.dp))
            Text(
                text = if (event.isAllDay) {
                    "${start.format(dateFormatter)} · 종일"
                } else {
                    "${start.format(dateFormatter)} · ${start.format(timeFormatter)}-${end.format(timeFormatter)}"
                },
                style = MaterialTheme.typography.bodyMedium
            )
            val meta = buildList {
                event.roomType?.let { add(if (it == "대") "대회의실" else if (it == "세") "세미나실" else it) }
                event.scheduleType?.let { add(it) }
                event.location?.takeIf { it.isNotBlank() }?.let { add(it) }
            }
            if (meta.isNotEmpty()) {
                Spacer(Modifier.height(4.dp))
                Text(meta.joinToString(" · "), style = MaterialTheme.typography.bodySmall)
            }
        }
    }
}

@Composable
private fun EventDetailScreen(viewModel: MainViewModel) {
    val event by viewModel.selectedEvent.collectAsState()
    val checklist by viewModel.checklist.collectAsState()
    val checklistItems by viewModel.checklistItems.collectAsState()
    val current = event ?: return

    Scaffold(
        topBar = {
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 8.dp, vertical = 8.dp),
                verticalAlignment = Alignment.CenterVertically
            ) {
                TextButton(onClick = viewModel::closeEvent) { Text("← 목록") }
                Text(
                    text = "체크리스트",
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
                .padding(horizontal = 16.dp)
        ) {
            item {
                Text(
                    current.cleanTitle,
                    style = MaterialTheme.typography.headlineSmall,
                    fontWeight = FontWeight.Bold
                )
                Spacer(Modifier.height(6.dp))
                EventDetailMeta(current)
                Spacer(Modifier.height(16.dp))
                HorizontalDivider()
                Spacer(Modifier.height(12.dp))
            }

            if (checklist == null) {
                item {
                    Text("체크리스트가 아직 생성되지 않았습니다.")
                }
            } else if (checklistItems.isEmpty()) {
                item { Text("체크리스트 항목이 없습니다.") }
            } else {
                items(checklistItems, key = { it.id }) { checklistItem ->
                    ChecklistRow(item = checklistItem, onCheckedChange = { checked ->
                        viewModel.setCompleted(checklistItem, checked)
                    })
                }
            }
        }
    }
}

@Composable
private fun EventDetailMeta(event: EventEntity) {
    val zone = ZoneId.systemDefault()
    val start = event.startTime.atZone(zone)
    val end = event.endTime.atZone(zone)

    Text(
        if (event.isAllDay) {
            "${start.format(dateFormatter)} · 종일"
        } else {
            "${start.format(dateFormatter)} · ${start.format(timeFormatter)}-${end.format(timeFormatter)}"
        },
        style = MaterialTheme.typography.bodyMedium
    )
    event.roomType?.let {
        Text(
            "회의실: ${if (it == "대") "대회의실" else if (it == "세") "세미나실" else it}",
            style = MaterialTheme.typography.bodySmall
        )
    }
    event.scheduleType?.let {
        Text("유형: $it", style = MaterialTheme.typography.bodySmall)
    }
    event.location?.takeIf { it.isNotBlank() }?.let {
        Text("장소: $it", style = MaterialTheme.typography.bodySmall)
    }
}

@Composable
private fun ChecklistRow(
    item: ChecklistItemEntity,
    onCheckedChange: (Boolean) -> Unit
) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .padding(vertical = 6.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        Checkbox(
            checked = item.isCompleted,
            onCheckedChange = onCheckedChange
        )
        Text(
            text = item.text,
            style = MaterialTheme.typography.bodyLarge,
            modifier = Modifier.padding(start = 8.dp)
        )
    }
}
