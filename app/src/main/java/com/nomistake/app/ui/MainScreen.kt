package com.nomistake.app.ui

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.Checkbox
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.input.nestedscroll.NestedScrollConnection
import androidx.compose.ui.input.nestedscroll.NestedScrollSource
import androidx.compose.ui.input.nestedscroll.nestedScroll
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.unit.Velocity
import androidx.compose.ui.unit.dp
import com.nomistake.app.data.local.entity.ChecklistEntity
import com.nomistake.app.data.local.entity.ChecklistItemEntity
import com.nomistake.app.data.local.entity.EventEntity
import com.nomistake.app.data.local.entity.ItemOrigin
import java.time.LocalDate
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

private val dateFormatter = DateTimeFormatter.ofPattern("M월 d일 (E)")
private val timeFormatter = DateTimeFormatter.ofPattern("HH:mm")

@Composable
fun MainScreen(
    viewModel: MainViewModel,
    onOpenSettings: () -> Unit,
    onOpenDebug: () -> Unit,
    onRefresh: () -> Unit
) {
    val selectedEvent by viewModel.selectedEvent.collectAsState()

    if (selectedEvent == null) {
        EventListScreen(viewModel, onOpenSettings, onOpenDebug, onRefresh)
    } else {
        EventDetailScreen(viewModel)
    }
}

@Composable
private fun EventListScreen(
    viewModel: MainViewModel,
    onOpenSettings: () -> Unit,
    onOpenDebug: () -> Unit,
    onRefresh: () -> Unit
) {
    val events by viewModel.events.collectAsState()
    val zone = ZoneId.systemDefault()
    val today = LocalDate.now(zone)
    val todayEvents = events.filter { it.startTime.atZone(zone).toLocalDate() == today }
    val upcomingEvents = events.filter { it.startTime.atZone(zone).toLocalDate().isAfter(today) }
    val pastEvents = events.filter { it.startTime.atZone(zone).toLocalDate().isBefore(today) }
    var isRefreshing by remember { mutableStateOf(false) }
    var pullDistance by remember { mutableFloatStateOf(0f) }
    val scope = rememberCoroutineScope()
    val listState = rememberLazyListState()
    val thresholdPx = with(LocalDensity.current) { 72.dp.toPx() }
    val contentOffsetPx = if (isRefreshing) thresholdPx * 0.45f else pullDistance * 0.55f

    fun refresh() {
        if (isRefreshing) return
        isRefreshing = true
        pullDistance = 0f
        onRefresh()
        scope.launch {
            delay(1_500)
            isRefreshing = false
        }
    }

    val pullConnection = remember(listState, thresholdPx, isRefreshing) {
        object : NestedScrollConnection {
            override fun onPostScroll(
                consumed: Offset,
                available: Offset,
                source: NestedScrollSource
            ): Offset {
                val atTop = listState.firstVisibleItemIndex == 0 && listState.firstVisibleItemScrollOffset == 0
                if (source == NestedScrollSource.UserInput && atTop && !isRefreshing && available.y > 0f) {
                    pullDistance = (pullDistance + available.y).coerceAtMost(thresholdPx * 1.5f)
                } else if (available.y < 0f) {
                    pullDistance = 0f
                }
                return Offset.Zero
            }

            override suspend fun onPostFling(consumed: Velocity, available: Velocity): Velocity {
                if (pullDistance >= thresholdPx && !isRefreshing) refresh() else pullDistance = 0f
                return Velocity.Zero
            }
        }
    }

    Scaffold(
        topBar = {
            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .statusBarsPadding()
                    .padding(horizontal = 16.dp, vertical = 8.dp)
            ) {
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Text(
                        "MERI Schedule Assistant",
                        style = MaterialTheme.typography.titleLarge,
                        fontWeight = FontWeight.Bold,
                        color = MaterialTheme.colorScheme.primary,
                        modifier = Modifier.weight(1f)
                    )
                    TextButton(onClick = onOpenSettings) { Text("설정") }
                    TextButton(onClick = onOpenDebug) { Text("진단") }
                }
                Text(
                    "업무 일정 · 준비사항 관리",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
            }
        }
    ) { padding ->
        Box(
            modifier = Modifier
                .fillMaxSize()
                .padding(padding)
                .nestedScroll(pullConnection)
        ) {
            LazyColumn(
                state = listState,
                modifier = Modifier
                    .fillMaxSize()
                    .graphicsLayer { translationY = contentOffsetPx },
                verticalArrangement = Arrangement.spacedBy(6.dp)
            ) {
                if (events.isEmpty()) {
                    item {
                        Column(
                            modifier = Modifier
                                .fillMaxWidth()
                                .padding(horizontal = 24.dp, vertical = 120.dp),
                            horizontalAlignment = Alignment.CenterHorizontally
                        ) {
                            Text("등록된 업무 일정이 없습니다.", fontWeight = FontWeight.SemiBold)
                            Spacer(Modifier.height(8.dp))
                            Text(
                                "MERI Outlook 일정이 동기화되면 이 화면에 표시됩니다.\n화면을 아래로 당겨 새로고침할 수 있습니다.",
                                style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant
                            )
                        }
                    }
                } else {
                    item { ScheduleSummaryCard(todayEvents.size, upcomingEvents.size) }

                    if (todayEvents.isNotEmpty()) {
                        item { SectionHeader("오늘", "${todayEvents.size}건") }
                        items(todayEvents, key = { it.id }) { event ->
                            EventCard(event, showDate = false) { viewModel.openEvent(event.id) }
                        }
                    }

                    if (upcomingEvents.isNotEmpty()) {
                        item { SectionHeader("예정 일정", "${upcomingEvents.size}건") }
                        items(upcomingEvents, key = { it.id }) { event ->
                            EventCard(event, showDate = true) { viewModel.openEvent(event.id) }
                        }
                    }

                    if (pastEvents.isNotEmpty()) {
                        item { SectionHeader("지난 일정", "${pastEvents.size}건") }
                        items(pastEvents.takeLast(5), key = { it.id }) { event ->
                            EventCard(event, showDate = true) { viewModel.openEvent(event.id) }
                        }
                    }

                    item { Spacer(Modifier.height(16.dp)) }
                }
            }

            if (isRefreshing) {
                CircularProgressIndicator(
                    modifier = Modifier
                        .align(Alignment.TopCenter)
                        .padding(top = 10.dp)
                )
            } else if (pullDistance > 0f) {
                Text(
                    if (pullDistance >= thresholdPx) "놓아서 새로고침" else "아래로 당겨 새로고침",
                    style = MaterialTheme.typography.labelMedium,
                    color = MaterialTheme.colorScheme.primary,
                    modifier = Modifier
                        .align(Alignment.TopCenter)
                        .padding(top = 10.dp)
                )
            }
        }
    }
}

@Composable
private fun ScheduleSummaryCard(todayCount: Int, upcomingCount: Int) {
    Card(
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = 12.dp, vertical = 4.dp),
        shape = RoundedCornerShape(8.dp),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface)
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 16.dp, vertical = 12.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            Column(modifier = Modifier.weight(1f)) {
                Text("오늘 일정", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                Text("${todayCount}건", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold)
            }
            Column(modifier = Modifier.weight(1f)) {
                Text("예정 일정", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                Text("${upcomingCount}건", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold)
            }
            Text(
                "Outlook 연동",
                style = MaterialTheme.typography.labelMedium,
                color = MaterialTheme.colorScheme.primary
            )
        }
    }
}

@Composable
private fun SectionHeader(title: String, countText: String) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = 16.dp, vertical = 6.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        Text(title, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold, modifier = Modifier.weight(1f))
        Text(countText, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
}

@Composable
private fun EventCard(event: EventEntity, showDate: Boolean, onClick: () -> Unit) {
    val zone = ZoneId.systemDefault()
    val start = event.startTime.atZone(zone)
    val end = event.endTime.atZone(zone)

    Card(
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = 12.dp)
            .clickable(onClick = onClick),
        shape = RoundedCornerShape(8.dp),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface)
    ) {
        Column(modifier = Modifier.padding(horizontal = 14.dp, vertical = 12.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(
                    event.cleanTitle,
                    style = MaterialTheme.typography.titleMedium,
                    fontWeight = FontWeight.SemiBold,
                    modifier = Modifier.weight(1f)
                )
                event.scheduleType?.let {
                    Text(
                        it,
                        style = MaterialTheme.typography.labelMedium,
                        color = MaterialTheme.colorScheme.primary,
                        modifier = Modifier.padding(start = 8.dp)
                    )
                }
            }
            Spacer(Modifier.height(4.dp))
            Text(
                when {
                    event.isAllDay && showDate -> "${start.format(dateFormatter)} · 종일"
                    event.isAllDay -> "종일"
                    showDate -> "${start.format(dateFormatter)} · ${start.format(timeFormatter)}-${end.format(timeFormatter)}"
                    else -> "${start.format(timeFormatter)}-${end.format(timeFormatter)}"
                },
                style = MaterialTheme.typography.bodyMedium
            )
            val meta = buildList {
                event.roomType?.let { add(if (it == "대") "대회의실" else if (it == "세") "세미나실" else it) }
                event.location?.takeIf { it.isNotBlank() }?.let { add(it) }
            }
            if (meta.isNotEmpty()) {
                Spacer(Modifier.height(2.dp))
                Text(
                    meta.joinToString(" · "),
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
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
    var newItemText by remember(current.id) { mutableStateOf("") }
    var showLeaveDialog by remember(current.id) { mutableStateOf(false) }

    fun addCurrentItem(): Boolean {
        if (newItemText.isBlank()) return false
        viewModel.addEventOnlyItem(newItemText)
        newItemText = ""
        return true
    }

    fun requestBack() {
        if (newItemText.isNotBlank()) showLeaveDialog = true else viewModel.closeEvent()
    }

    BackHandler { requestBack() }

    if (showLeaveDialog) {
        AlertDialog(
            onDismissRequest = { showLeaveDialog = false },
            title = { Text("작성 중인 항목이 있습니다") },
            text = { Text("작성한 체크 항목을 저장하고 일정 목록으로 돌아갈까요?") },
            confirmButton = {
                TextButton(onClick = {
                    addCurrentItem()
                    showLeaveDialog = false
                    viewModel.closeEvent()
                }) { Text("저장 후 이동") }
            },
            dismissButton = {
                Row {
                    TextButton(onClick = { showLeaveDialog = false }) { Text("계속 작성") }
                    TextButton(onClick = {
                        newItemText = ""
                        showLeaveDialog = false
                        viewModel.closeEvent()
                    }) { Text("저장 안 함") }
                }
            }
        )
    }

    Scaffold(
        topBar = {
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .statusBarsPadding()
                    .padding(horizontal = 8.dp, vertical = 4.dp),
                verticalAlignment = Alignment.CenterVertically
            ) {
                TextButton(onClick = ::requestBack) { Text("← 일정") }
                Text("업무 준비", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold)
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
                Text(current.cleanTitle, style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.Bold)
                Spacer(Modifier.height(4.dp))
                EventDetailMeta(current)
                Spacer(Modifier.height(14.dp))
            }

            if (checklist == null) {
                item {
                    Card(
                        modifier = Modifier.fillMaxWidth(),
                        shape = RoundedCornerShape(8.dp),
                        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface)
                    ) {
                        Text("준비 체크리스트를 생성하는 중입니다.", modifier = Modifier.padding(16.dp))
                    }
                }
            } else {
                item {
                    TaskSummaryCard(
                        checklist = checklist!!,
                        items = checklistItems,
                        onTaskCompleted = viewModel::setTaskCompleted,
                        onAllDetailsCompleted = viewModel::setAllDetailItemsCompleted
                    )
                    Spacer(Modifier.height(16.dp))
                    Text("준비 체크리스트", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
                    Text(
                        "업무 유형과 일정 정보에 맞춰 자동 구성된 항목입니다.",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                    Spacer(Modifier.height(6.dp))
                }

                if (checklistItems.isEmpty()) {
                    item { Text("등록된 준비 항목이 없습니다.") }
                } else {
                    items(checklistItems, key = { it.id }) { checklistItem ->
                        ChecklistRow(
                            item = checklistItem,
                            onCheckedChange = { checked -> viewModel.setCompleted(checklistItem, checked) },
                            onDelete = if (checklistItem.origin == ItemOrigin.EVENT_ONLY) {
                                { viewModel.deleteEventOnlyItem(checklistItem) }
                            } else null
                        )
                    }
                }

                item {
                    Spacer(Modifier.height(16.dp))
                    HorizontalDivider()
                    Spacer(Modifier.height(12.dp))
                    Text("개인 준비사항 추가", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
                    Text(
                        "이 일정에서만 필요한 항목을 추가할 수 있습니다.",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                    Spacer(Modifier.height(8.dp))
                    OutlinedTextField(
                        value = newItemText,
                        onValueChange = { newItemText = it },
                        label = { Text("준비사항") },
                        singleLine = true,
                        modifier = Modifier.fillMaxWidth(),
                        keyboardOptions = KeyboardOptions(imeAction = ImeAction.Done),
                        keyboardActions = KeyboardActions(onDone = { addCurrentItem() })
                    )
                    Spacer(Modifier.height(8.dp))
                    Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) {
                        Button(onClick = { addCurrentItem() }, enabled = newItemText.isNotBlank()) { Text("추가") }
                    }
                    Spacer(Modifier.height(24.dp))
                }
            }
        }
    }
}

@Composable
private fun TaskSummaryCard(
    checklist: ChecklistEntity,
    items: List<ChecklistItemEntity>,
    onTaskCompleted: (Boolean) -> Unit,
    onAllDetailsCompleted: (Boolean) -> Unit
) {
    val completedCount = items.count { it.isCompleted }
    val allDetailsCompleted = items.isNotEmpty() && completedCount == items.size

    Card(
        modifier = Modifier.fillMaxWidth(),
        shape = RoundedCornerShape(8.dp),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface)
    ) {
        Column(modifier = Modifier.padding(14.dp)) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                verticalAlignment = Alignment.CenterVertically
            ) {
                Column(modifier = Modifier.weight(1f)) {
                    Text("준비 현황", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
                    Text(
                        "$completedCount/${items.size} 항목 확인",
                        style = MaterialTheme.typography.titleLarge,
                        fontWeight = FontWeight.Bold,
                        color = MaterialTheme.colorScheme.primary
                    )
                }
                Text(
                    if (allDetailsCompleted) "준비 완료" else "확인 필요",
                    style = MaterialTheme.typography.labelLarge,
                    color = MaterialTheme.colorScheme.primary
                )
            }
            Spacer(Modifier.height(8.dp))
            HorizontalDivider()
            Row(verticalAlignment = Alignment.CenterVertically) {
                Checkbox(
                    checked = allDetailsCompleted,
                    onCheckedChange = { checked -> onAllDetailsCompleted(checked) },
                    enabled = items.isNotEmpty()
                )
                Text(
                    "준비항목 전체 확인",
                    style = MaterialTheme.typography.bodyLarge,
                    fontWeight = FontWeight.SemiBold,
                    modifier = Modifier.weight(1f).padding(start = 6.dp)
                )
            }
            Row(verticalAlignment = Alignment.CenterVertically) {
                Checkbox(checked = checklist.isCompleted, onCheckedChange = onTaskCompleted)
                Column(modifier = Modifier.weight(1f).padding(start = 6.dp)) {
                    Text("업무 완료 처리", style = MaterialTheme.typography.bodyLarge, fontWeight = FontWeight.SemiBold)
                    Text("업무 종료 후 체크", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
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
        if (event.isAllDay) "${start.format(dateFormatter)} · 종일"
        else "${start.format(dateFormatter)} · ${start.format(timeFormatter)}-${end.format(timeFormatter)}",
        style = MaterialTheme.typography.bodyMedium
    )
    event.scheduleType?.let {
        Text("업무 유형 · $it", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
    event.roomType?.let {
        Text(
            "회의실 · ${if (it == "대") "대회의실" else if (it == "세") "세미나실" else it}",
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant
        )
    }
    event.location?.takeIf { it.isNotBlank() }?.let {
        Text("장소 · $it", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
}

@Composable
private fun ChecklistRow(
    item: ChecklistItemEntity,
    onCheckedChange: (Boolean) -> Unit,
    onDelete: (() -> Unit)?
) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .padding(vertical = 4.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        Checkbox(checked = item.isCompleted, onCheckedChange = onCheckedChange)
        Text(
            item.text,
            style = MaterialTheme.typography.bodyLarge,
            modifier = Modifier
                .weight(1f)
                .padding(start = 6.dp)
        )
        if (onDelete != null) TextButton(onClick = onDelete) { Text("삭제") }
    }
}
