package com.nomistake.app.data.local.entity

import androidx.room.Entity
import androidx.room.PrimaryKey

enum class RuleAppliesTo { ALL, TIMED_ONLY }

/**
 * 알림 규칙. 세 가지 방식 중 하나만 사용:
 * - dayOffset + timeOfDay("HH:mm"): D-1 오후, 당일 오전 등
 * - minutesBefore: T-60, T-30 (TIMED_ONLY 전용, All-day 제외)
 */
@Entity(tableName = "notification_rules")
data class NotificationRuleEntity(
    @PrimaryKey(autoGenerate = true) val id: Long = 0,
    val label: String,
    val dayOffset: Int? = null,
    val timeOfDay: String? = null,   // "HH:mm"
    val minutesBefore: Int? = null,
    val appliesTo: RuleAppliesTo = RuleAppliesTo.ALL,
    val enabled: Boolean = true
)
