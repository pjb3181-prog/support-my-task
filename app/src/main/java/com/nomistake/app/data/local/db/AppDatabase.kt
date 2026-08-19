package com.nomistake.app.data.local.db

import androidx.room.Database
import androidx.room.RoomDatabase
import androidx.room.TypeConverters
import com.nomistake.app.data.local.dao.ChecklistDao
import com.nomistake.app.data.local.dao.EventDao
import com.nomistake.app.data.local.dao.SettingDao
import com.nomistake.app.data.local.dao.TemplateDao
import com.nomistake.app.data.local.entity.ChecklistEntity
import com.nomistake.app.data.local.entity.ChecklistItemEntity
import com.nomistake.app.data.local.entity.ChecklistTemplateEntity
import com.nomistake.app.data.local.entity.EventEntity
import com.nomistake.app.data.local.entity.NotificationRuleEntity
import com.nomistake.app.data.local.entity.ScheduleTypeRuleEntity
import com.nomistake.app.data.local.entity.SettingEntity
import com.nomistake.app.data.local.entity.TemplateItemEntity

@Database(
    entities = [
        EventEntity::class,
        ChecklistEntity::class,
        ChecklistItemEntity::class,
        ChecklistTemplateEntity::class,
        TemplateItemEntity::class,
        ScheduleTypeRuleEntity::class,
        NotificationRuleEntity::class,
        SettingEntity::class
    ],
    version = 1,
    exportSchema = true
)
@TypeConverters(Converters::class)
abstract class AppDatabase : RoomDatabase() {
    abstract fun eventDao(): EventDao
    abstract fun checklistDao(): ChecklistDao
    abstract fun templateDao(): TemplateDao
    abstract fun settingDao(): SettingDao
}
