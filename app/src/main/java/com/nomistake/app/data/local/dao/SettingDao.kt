package com.nomistake.app.data.local.dao

import androidx.room.Dao
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query
import com.nomistake.app.data.local.entity.NotificationRuleEntity
import com.nomistake.app.data.local.entity.SettingEntity
import kotlinx.coroutines.flow.Flow

@Dao
interface SettingDao {

    @Query("SELECT * FROM settings WHERE `key` = :key LIMIT 1")
    suspend fun get(key: String): SettingEntity?

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun put(setting: SettingEntity)

    @Query("SELECT * FROM notification_rules ORDER BY id ASC")
    fun observeNotificationRules(): Flow<List<NotificationRuleEntity>>

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insertNotificationRule(rule: NotificationRuleEntity): Long

    @Query("SELECT COUNT(*) FROM notification_rules")
    suspend fun countNotificationRules(): Int
}
