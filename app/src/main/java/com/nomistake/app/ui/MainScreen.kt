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
import androidx.compose.runtime.LaunchedEffect
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
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
import com.google.firebase.firestore.FirebaseFirestore
import com.google.firebase.firestore.Source
import com.nomistake.app.data.local.dao.SettingDao
import com.nomistake.app.data.local.entity.ItemOrigin
import com.nomistake.app.data.repository.CalendarSyncRepository
import com.nomistake.app.domain.EventTitleParser
import com.nomistake.app.domain.WorkCalendarPlanner
import java.time.LocalDate
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import kotlinx.coroutines.delay
import kotlinx.coroutines.tasks.await
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

private val dateFormatter = DateTimeFormatter.ofPattern("M월 d일 (E)")
private val timeFormatter = DateTimeFormatter.ofPattern("HH:mm")

@Composable
fun MainScreen(
    viewModel: MainViewModel,
    onOpenSettings: () -> Unit,
    onOpenHistory: () -> Unit,
    onOpenDebug: () -> Unit,
    onRefresh: () -> Unit
) {
    val selectedEvent by viewModel.selectedEvent.collectAsState()

    if (selectedEvent == null) {
        EventListScreen(viewModel, onOpenSettings, onOpenHistory, onOpenDebug, onRefresh)
    } else {
        EventDetailScreen(viewModel)
    }
}

@Composable
private fun EventListScreen(
    viewModel: MainViewModel,
    onOpenSettings: () -> Unit,
    onOpenHistory: () -> Unit,
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
                    TextButton(onClick = onOpenHistory) { Text("이전 일정") }
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
    val preparationDeadline by viewModel.preparationDeadline.collectAsState()
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
                preparationDeadline?.let {
                    Spacer(Modifier.height(10.dp))
                    PreparationDeadlineCard(it)
                }
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
private fun PreparationDeadlineCard(deadline: WorkCalendarPlanner.PreparationDeadline) {
    Card(
        modifier = Modifier.fillMaxWidth(),
        shape = RoundedCornerShape(8.dp),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.primaryContainer)
    ) {
        Column(modifier = Modifier.padding(horizontal = 14.dp, vertical = 12.dp)) {
            Text("준비 마감", style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onPrimaryContainer)
            Text(
                deadline.label,
                style = MaterialTheme.typography.titleMedium,
                fontWeight = FontWeight.Bold,
                color = MaterialTheme.colorScheme.onPrimaryContainer
            )
            Spacer(Modifier.height(2.dp))
            Text(
                deadline.reason,
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onPrimaryContainer
            )
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


data class HistoryEvent(
    val id: String,
    val title: String,
    val location: String,
    val start: java.time.LocalDateTime,
    val end: java.time.LocalDateTime?,
    val isAllDay: Boolean
)

data class HistoryUiState(
    val from: LocalDate,
    val to: LocalDate,
    val keyword: String = "",
    val loading: Boolean = false,
    val error: String? = null,
    val results: List<HistoryEvent> = emptyList(),
    val hasSearched: Boolean = false
)

class HistoryViewModel(
    private val firestore: FirebaseFirestore?,
    private val settingDao: SettingDao,
    private val zoneId: ZoneId = ZoneId.systemDefault()
) : ViewModel() {
    private val today = LocalDate.now(zoneId)
    private val _uiState = MutableStateFlow(HistoryUiState(from = today.minusYears(1), to = today))
    val uiState: StateFlow<HistoryUiState> = _uiState.asStateFlow()

    fun setFrom(value: LocalDate) { _uiState.value = _uiState.value.copy(from = value, error = null) }
    fun setTo(value: LocalDate) { _uiState.value = _uiState.value.copy(to = value, error = null) }
    fun setKeyword(value: String) { _uiState.value = _uiState.value.copy(keyword = value) }

    fun setThisYear() {
        _uiState.value = _uiState.value.copy(from = LocalDate.of(today.year, 1, 1), to = today, error = null)
    }

    fun setRecentYear() {
        _uiState.value = _uiState.value.copy(from = today.minusYears(1), to = today, error = null)
    }

    fun search() {
        val current = _uiState.value
        if (current.from.isAfter(current.to)) {
            _uiState.value = current.copy(error = "시작일이 종료일보다 늦습니다.")
            return
        }
        val db = firestore
        if (db == null) {
            _uiState.value = current.copy(hasSearched = true, error = "Firebase 연결 설정이 없어 이전 일정을 조회할 수 없습니다.")
            return
        }

        viewModelScope.launch {
            _uiState.value = _uiState.value.copy(loading = true, error = null)
            try {
                val marker = settingDao.get(CalendarSyncRepository.KEY_MINE_MARKER)?.value
                    ?.trim()?.takeIf { it.isNotEmpty() } ?: EventTitleParser.DEFAULT_MINE_MARKER
                val formatter = java.time.format.DateTimeFormatter.ofPattern("yyyy-MM-dd'T'HH:mm:ss")
                val fromIso = current.from.atStartOfDay().format(formatter)
                val toExclusiveIso = current.to.plusDays(1).atStartOfDay().format(formatter)

                val snapshot = db.collection("events")
                    .whereGreaterThanOrEqualTo("start", fromIso)
                    .whereLessThan("start", toExclusiveIso)
                    .get(Source.SERVER)
                    .await()

                val keyword = current.keyword.trim()
                val results = snapshot.documents.mapNotNull { doc ->
                    val data = doc.data ?: return@mapNotNull null
                    if (data["deleted"] as? Boolean == true) return@mapNotNull null
                    val rawTitle = data["subject"] as? String ?: return@mapNotNull null
                    if (!belongsToMe(rawTitle, marker)) return@mapNotNull null
                    val location = (data["location"] as? String).orEmpty()
                    if (keyword.isNotEmpty() &&
                        !rawTitle.contains(keyword, ignoreCase = true) &&
                        !location.contains(keyword, ignoreCase = true)
                    ) return@mapNotNull null

                    val start = (data["start"] as? String)
                        ?.let { runCatching { java.time.LocalDateTime.parse(it) }.getOrNull() }
                        ?: return@mapNotNull null
                    val end = (data["end"] as? String)
                        ?.let { runCatching { java.time.LocalDateTime.parse(it) }.getOrNull() }

                    HistoryEvent(
                        id = doc.id,
                        title = cleanHistoryTitle(rawTitle),
                        location = location,
                        start = start,
                        end = end,
                        isAllDay = data["allDay"] as? Boolean ?: false
                    )
                }.sortedByDescending { it.start }

                _uiState.value = _uiState.value.copy(
                    loading = false,
                    results = results,
                    hasSearched = true
                )
            } catch (_: Exception) {
                _uiState.value = _uiState.value.copy(
                    loading = false,
                    hasSearched = true,
                    error = "이전 일정 조회에 실패했습니다."
                )
            }
        }
    }

    private fun belongsToMe(rawTitle: String, marker: String): Boolean {
        if (marker.isBlank()) return false
        val attendee = HISTORY_ATTENDEE_REGEX.find(rawTitle.trim())?.groupValues?.getOrNull(1) ?: return false
        return attendee.contains(marker)
    }

    private fun cleanHistoryTitle(rawTitle: String): String {
        var title = rawTitle.trim()
        if (title.startsWith("[대]") || title.startsWith("[세]")) title = title.drop(3).trim()
        HISTORY_ATTENDEE_REGEX.find(title)?.let { title = title.removeRange(it.range).trim() }
        return title.ifBlank { rawTitle }
    }
}

private val HISTORY_ATTENDEE_REGEX = Regex("\\[([^\\]]*)\\]$")
private val historyDateInputFormatter = DateTimeFormatter.ISO_LOCAL_DATE
private val historyDateFormatter = DateTimeFormatter.ofPattern("yyyy. M. d. (E)")
private val historyTimeFormatter = DateTimeFormatter.ofPattern("HH:mm")

@Composable
fun HistoryScreen(
    viewModel: HistoryViewModel,
    onBack: () -> Unit
) {
    val state by viewModel.uiState.collectAsState()
    var fromText by remember(state.from) { mutableStateOf(state.from.format(historyDateInputFormatter)) }
    var toText by remember(state.to) { mutableStateOf(state.to.format(historyDateInputFormatter)) }

    fun applyDates(): Boolean {
        val from = runCatching { LocalDate.parse(fromText, historyDateInputFormatter) }.getOrNull()
        val to = runCatching { LocalDate.parse(toText, historyDateInputFormatter) }.getOrNull()
        if (from == null || to == null) return false
        viewModel.setFrom(from)
        viewModel.setTo(to)
        return true
    }

    fun runSearch() {
        if (applyDates()) viewModel.search()
    }

    BackHandler(onBack = onBack)
    LaunchedEffect(Unit) {
        if (!state.hasSearched && !state.loading) viewModel.search()
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
                TextButton(onClick = onBack) { Text("← 일정") }
                Text("이전 일정", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold)
            }
        }
    ) { padding ->
        LazyColumn(
            modifier = Modifier
                .fillMaxSize()
                .padding(padding),
            verticalArrangement = Arrangement.spacedBy(8.dp)
        ) {
            item {
                Column(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(horizontal = 16.dp, vertical = 8.dp)
                ) {
                    Text("출장·방문 이력 조회", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
                    Text(
                        "출장비 지출결의서 작성 등에 필요한 과거 일정과 장소를 찾습니다.",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                    Spacer(Modifier.height(12.dp))
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        TextButton(onClick = {
                            viewModel.setThisYear()
                            val updated = viewModel.uiState.value
                            fromText = updated.from.format(historyDateInputFormatter)
                            toText = updated.to.format(historyDateInputFormatter)
                            viewModel.search()
                        }) { Text("올해") }
                        TextButton(onClick = {
                            viewModel.setRecentYear()
                            val updated = viewModel.uiState.value
                            fromText = updated.from.format(historyDateInputFormatter)
                            toText = updated.to.format(historyDateInputFormatter)
                            viewModel.search()
                        }) { Text("최근 1년") }
                    }
                    Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        OutlinedTextField(
                            value = fromText,
                            onValueChange = { fromText = it },
                            modifier = Modifier.weight(1f),
                            label = { Text("시작일") },
                            supportingText = { Text("YYYY-MM-DD") },
                            singleLine = true
                        )
                        OutlinedTextField(
                            value = toText,
                            onValueChange = { toText = it },
                            modifier = Modifier.weight(1f),
                            label = { Text("종료일") },
                            supportingText = { Text("YYYY-MM-DD") },
                            singleLine = true
                        )
                    }
                    OutlinedTextField(
                        value = state.keyword,
                        onValueChange = viewModel::setKeyword,
                        modifier = Modifier.fillMaxWidth(),
                        label = { Text("검색어") },
                        placeholder = { Text("업체명, 지역, 업무명 등") },
                        singleLine = true,
                        keyboardOptions = KeyboardOptions(imeAction = ImeAction.Search),
                        keyboardActions = KeyboardActions(onSearch = { runSearch() })
                    )
                    Spacer(Modifier.height(8.dp))
                    Button(
                        onClick = { runSearch() },
                        modifier = Modifier.fillMaxWidth(),
                        enabled = !state.loading
                    ) { Text(if (state.loading) "조회 중…" else "조회") }

                    state.error?.let {
                        Spacer(Modifier.height(8.dp))
                        Text(it, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall)
                    }
                    if (state.hasSearched && state.error == null) {
                        Spacer(Modifier.height(8.dp))
                        Text(
                            "${state.results.size}건을 찾았습니다.",
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant
                        )
                    }
                }
            }

            if (state.loading) {
                item {
                    Row(
                        modifier = Modifier.fillMaxWidth().padding(vertical = 28.dp),
                        horizontalArrangement = Arrangement.Center
                    ) { CircularProgressIndicator() }
                }
            } else if (state.hasSearched && state.results.isEmpty() && state.error == null) {
                item {
                    Text(
                        "조건에 맞는 이전 일정이 없습니다.",
                        modifier = Modifier.fillMaxWidth().padding(horizontal = 24.dp, vertical = 48.dp),
                        style = MaterialTheme.typography.bodyMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                }
            } else {
                items(state.results, key = { it.id }) { event ->
                    HistoryEventCard(event)
                }
            }
            item { Spacer(Modifier.height(20.dp)) }
        }
    }
}

@Composable
private fun HistoryEventCard(event: HistoryEvent) {
    Card(
        modifier = Modifier.fillMaxWidth().padding(horizontal = 12.dp),
        shape = RoundedCornerShape(8.dp),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface)
    ) {
        Column(modifier = Modifier.padding(horizontal = 14.dp, vertical = 12.dp)) {
            Text(
                event.start.format(historyDateFormatter),
                style = MaterialTheme.typography.labelMedium,
                color = MaterialTheme.colorScheme.primary,
                fontWeight = FontWeight.Bold
            )
            Spacer(Modifier.height(4.dp))
            Text(event.title, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
            Spacer(Modifier.height(3.dp))
            Text(
                if (event.isAllDay) "종일" else buildString {
                    append(event.start.format(historyTimeFormatter))
                    event.end?.let {
                        append("-")
                        append(it.format(historyTimeFormatter))
                    }
                },
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant
            )
            Spacer(Modifier.height(5.dp))
            Text(
                if (event.location.isBlank()) "장소 정보 없음" else "장소 · ${event.location}",
                style = MaterialTheme.typography.bodyMedium,
                fontWeight = if (event.location.isBlank()) FontWeight.Normal else FontWeight.SemiBold,
                color = if (event.location.isBlank()) MaterialTheme.colorScheme.onSurfaceVariant else MaterialTheme.colorScheme.onSurface
            )
        }
    }
}
