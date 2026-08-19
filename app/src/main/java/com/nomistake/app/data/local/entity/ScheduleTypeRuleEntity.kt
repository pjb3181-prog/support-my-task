package com.nomistake.app.data.local.entity

import androidx.room.Entity
import androidx.room.PrimaryKey

/**
 * cleanTitle → scheduleType 매핑 규칙. priority 오름차순으로 매칭.
 * 예: "현장조사"→FIELD_WORK, "현장방문"→FIELD_WORK, "HAZOP"→HAZOP ...
 */
@Entity(tableName = "schedule_type_rules")
data class ScheduleTypeRuleEntity(
    @PrimaryKey(autoGenerate = true) val id: Long = 0,
    val keyword: String,
    val scheduleType: String,
    val priority: Int
)
