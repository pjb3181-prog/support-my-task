package com.nomistake.app.data.local.entity

import androidx.room.Entity
import androidx.room.Index
import androidx.room.PrimaryKey
import java.time.Instant

/**
 * 일정 1건에 대응하는 체크리스트(1:1). 항목은 [ChecklistItemEntity]에 저장.
 */
@Entity(
    tableName = "checklists",
    indices = [Index(value = ["eventId"], unique = true)]
)
data class ChecklistEntity(
    @PrimaryKey(autoGenerate = true) val id: Long = 0,
    val eventId: Long,
    val scheduleType: String?,
    val createdAt: Instant
)
