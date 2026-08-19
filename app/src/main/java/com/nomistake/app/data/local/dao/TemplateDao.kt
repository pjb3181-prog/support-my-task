package com.nomistake.app.data.local.dao

import androidx.room.Dao
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query
import com.nomistake.app.data.local.entity.ChecklistTemplateEntity
import com.nomistake.app.data.local.entity.ScheduleTypeRuleEntity
import com.nomistake.app.data.local.entity.TemplateItemEntity
import com.nomistake.app.data.local.entity.TemplateKind
import kotlinx.coroutines.flow.Flow

@Dao
interface TemplateDao {

    @Query("SELECT * FROM checklist_templates ORDER BY kind, key")
    fun observeTemplates(): Flow<List<ChecklistTemplateEntity>>

    @Query("SELECT * FROM checklist_templates WHERE kind = :kind AND key = :key LIMIT 1")
    suspend fun getTemplate(kind: TemplateKind, key: String): ChecklistTemplateEntity?

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insertTemplate(template: ChecklistTemplateEntity): Long

    @Query("SELECT * FROM template_items WHERE templateId = :templateId ORDER BY sortOrder ASC")
    suspend fun getTemplateItems(templateId: Long): List<TemplateItemEntity>

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insertTemplateItem(item: TemplateItemEntity): Long

    @Query("DELETE FROM template_items WHERE id = :id")
    suspend fun deleteTemplateItem(id: Long)

    @Query("SELECT * FROM schedule_type_rules ORDER BY priority ASC")
    suspend fun getScheduleTypeRules(): List<ScheduleTypeRuleEntity>

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insertScheduleTypeRule(rule: ScheduleTypeRuleEntity): Long

    @Query("SELECT COUNT(*) FROM checklist_templates")
    suspend fun countTemplates(): Int

    @Query("SELECT COUNT(*) FROM schedule_type_rules")
    suspend fun countScheduleTypeRules(): Int
}
