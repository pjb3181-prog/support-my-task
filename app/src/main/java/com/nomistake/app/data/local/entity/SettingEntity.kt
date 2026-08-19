package com.nomistake.app.data.local.entity

import androidx.room.Entity
import androidx.room.PrimaryKey

/**
 * 키-값 설정 저장소.
 */
@Entity(tableName = "settings")
data class SettingEntity(
    @PrimaryKey val key: String,
    val value: String
)
