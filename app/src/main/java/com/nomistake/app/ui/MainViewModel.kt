package com.nomistake.app.ui

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.nomistake.app.data.local.dao.ChecklistDao
import com.nomistake.app.data.local.dao.EventDao
import com.nomistake.app.data.local.entity.ChecklistEntity
import com.nomistake.app.data.local.entity.ChecklistItemEntity
import com.nomistake.app.data.local.entity.EventEntity
import com.nomistake.app.data.local.entity.ItemOrigin
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch
import java.time.Instant

/**
 * 실사용 UI용 ViewModel.
 * Room을 화면의 source of truth로 유지하고, 네트워크/Firebase SDK를 직접 참조하지 않는다.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class MainViewModel(
    private val eventDao: EventDao,
    private val checklistDao: ChecklistDao
) : ViewModel() {

    val events: StateFlow<List<EventEntity>> = eventDao.observeActiveEvents()
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), emptyList())

    private val selectedEventId = MutableStateFlow<Long?>(null)

    val selectedEvent: StateFlow<EventEntity?> = selectedEventId
        .flatMapLatest { id ->
            if (id == null) flowOf(null) else eventDao.observeById(id)
        }
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), null)

    val checklist: StateFlow<ChecklistEntity?> = selectedEventId
        .flatMapLatest { eventId ->
            if (eventId == null) flowOf(null) else checklistDao.observeByEventId(eventId)
        }
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), null)

    val checklistItems: StateFlow<List<ChecklistItemEntity>> = checklist
        .flatMapLatest { list ->
            if (list == null) flowOf(emptyList()) else checklistDao.observeItems(list.id)
        }
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), emptyList())

    fun openEvent(eventId: Long) {
        selectedEventId.value = eventId
    }

    fun closeEvent() {
        selectedEventId.value = null
    }

    fun setCompleted(item: ChecklistItemEntity, completed: Boolean) {
        viewModelScope.launch {
            checklistDao.setCompleted(
                id = item.id,
                completed = completed,
                completedAt = if (completed) Instant.now() else null
            )
        }
    }

    /**
     * Phase 6B: 현재 일정에만 적용되는 EVENT_ONLY 항목을 추가한다.
     * 템플릿에는 반영하지 않으며, sync가 다시 실행돼도 기존 checklist가 재생성되지 않으므로 보존된다.
     */
    fun addEventOnlyItem(text: String) {
        val normalized = text.trim()
        if (normalized.isEmpty()) return

        viewModelScope.launch {
            val currentChecklist = checklist.value ?: return@launch
            val nextSortOrder = checklistDao.getNextSortOrder(currentChecklist.id)
            checklistDao.insertItem(
                ChecklistItemEntity(
                    checklistId = currentChecklist.id,
                    text = normalized,
                    sortOrder = nextSortOrder,
                    origin = ItemOrigin.EVENT_ONLY,
                    templateItemId = null
                )
            )
        }
    }

    /**
     * Phase 6B: 사용자가 직접 추가한 EVENT_ONLY 항목만 삭제한다.
     * TEMPLATE_COPY 삭제는 템플릿 의미와 혼동될 수 있어 이번 Phase에서는 허용하지 않는다.
     */
    fun deleteEventOnlyItem(item: ChecklistItemEntity) {
        if (item.origin != ItemOrigin.EVENT_ONLY) return
        viewModelScope.launch {
            checklistDao.deleteItem(item.id)
        }
    }
}
