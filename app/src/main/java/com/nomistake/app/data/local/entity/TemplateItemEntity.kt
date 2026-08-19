package com.nomistake.app.data.local.entity

import androidx.room.Entity
import androidx.room.Index
import androidx.room.PrimaryKey

/**
 * 템플릿에 속한 체크리스트 항목.
 */
@Entity(
    tableName = "template_items",
    indices = [Index(value = ["templateId"])]
)
data class TemplateItemEntity(
    @PrimaryKey(autoGenerate = true) val id: Long = 0,
    val templateId: Long,
    val text: String,
    val sortOrder: Int
)
