package com.nomistake.app.data.local.entity

import androidx.room.Entity
import androidx.room.Index
import androidx.room.PrimaryKey
import java.time.Instant

/**
 * 일정 1건에 대응하는 체크리스트(1:1).
 * [isCompleted]는 세부항목과 독립된 '업무 전체 완료' 상태다.
 */
@Entity(
    tableName = "checklists",
    indices = [Index(value = ["eventId"], unique = true)]
)
data class ChecklistEntity(
    @PrimaryKey(autoGenerate = true) val id: Long = 0,
    val eventId: Long,
    val scheduleType: String?,
    val createdAt: Instant,
    val isCompleted: Boolean = false,
    val completedAt: Instant? = null
)
