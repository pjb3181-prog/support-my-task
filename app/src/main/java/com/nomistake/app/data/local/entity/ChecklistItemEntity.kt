package com.nomistake.app.data.local.entity

import androidx.room.Entity
import androidx.room.Index
import androidx.room.PrimaryKey
import java.time.Instant

enum class ItemOrigin { TEMPLATE_COPY, EVENT_ONLY }

/**
 * 체크리스트 개별 항목. 템플릿에서 복사된 항목은 [origin]=TEMPLATE_COPY,
 * 사용자가 이 일정에만 추가한 항목은 [origin]=EVENT_ONLY.
 */
@Entity(
    tableName = "checklist_items",
    indices = [Index(value = ["checklistId"])]
)
data class ChecklistItemEntity(
    @PrimaryKey(autoGenerate = true) val id: Long = 0,
    val checklistId: Long,
    val text: String,
    val sortOrder: Int,
    val isCompleted: Boolean = false,
    val completedAt: Instant? = null,
    val origin: ItemOrigin = ItemOrigin.TEMPLATE_COPY,
    val templateItemId: Long? = null
)
