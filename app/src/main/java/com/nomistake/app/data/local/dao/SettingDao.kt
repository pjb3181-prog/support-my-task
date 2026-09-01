package com.nomistake.app.data.local.dao

import androidx.room.Dao
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query
import androidx.room.Update
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

    @Query("SELECT * FROM notification_rules WHERE enabled = 1 ORDER BY id ASC")
    suspend fun getEnabledNotificationRules(): List<NotificationRuleEntity>

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insertNotificationRule(rule: NotificationRuleEntity): Long

    /** Phase 8 설정 화면: 기존 rule id를 유지한 채 사용자 설정만 갱신한다. */
    @Update
    suspend fun updateNotificationRule(rule: NotificationRuleEntity)

    @Query("SELECT COUNT(*) FROM notification_rules")
    suspend fun countNotificationRules(): Int
}
