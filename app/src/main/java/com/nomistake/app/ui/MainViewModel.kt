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

@OptIn(ExperimentalCoroutinesApi::class)
class MainViewModel(
    private val eventDao: EventDao,
    private val checklistDao: ChecklistDao
) : ViewModel() {

    val events: StateFlow<List<EventEntity>> = eventDao.observeActiveEvents()
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), emptyList())

    private val selectedEventId = MutableStateFlow<Long?>(null)

    val selectedEvent: StateFlow<EventEntity?> = selectedEventId
        .flatMapLatest { id -> if (id == null) flowOf(null) else eventDao.observeById(id) }
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

    fun openEvent(eventId: Long) { selectedEventId.value = eventId }
    fun closeEvent() { selectedEventId.value = null }

    /** 관리자/책임자용 업무 단위 완료. 세부항목 상태와 독립적이다. */
    fun setTaskCompleted(completed: Boolean) {
        viewModelScope.launch {
            val current = checklist.value ?: return@launch
            checklistDao.setChecklistCompleted(
                checklistId = current.id,
                completed = completed,
                completedAt = if (completed) Instant.now() else null
            )
        }
    }

    /** 실무자용 세부항목 일괄 처리. */
    fun setAllDetailItemsCompleted(completed: Boolean) {
        viewModelScope.launch {
            val current = checklist.value ?: return@launch
            checklistDao.setAllItemsCompleted(
                checklistId = current.id,
                completed = completed,
                completedAt = if (completed) Instant.now() else null
            )
        }
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

    fun deleteEventOnlyItem(item: ChecklistItemEntity) {
        if (item.origin != ItemOrigin.EVENT_ONLY) return
        viewModelScope.launch { checklistDao.deleteItem(item.id) }
    }
}
