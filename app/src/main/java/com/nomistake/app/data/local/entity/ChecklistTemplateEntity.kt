package com.nomistake.app.data.local.entity

import androidx.room.Entity
import androidx.room.Index
import androidx.room.PrimaryKey

enum class TemplateKind { ROOM, TYPE }

/**
 * 체크리스트 템플릿. (kind, key) 조합이 유일.
 * - ROOM: key = "대" | "세"
 * - TYPE: key = "FIELD_WORK" | "HAZOP" | "LOPA" | "면담" | "화상회의" | "일반회의"
 */
@Entity(
    tableName = "checklist_templates",
    indices = [Index(value = ["kind", "key"], unique = true)]
)
data class ChecklistTemplateEntity(
    @PrimaryKey(autoGenerate = true) val id: Long = 0,
    val kind: TemplateKind,
    val key: String,
    val name: String,
    val isBuiltIn: Boolean = true
)
