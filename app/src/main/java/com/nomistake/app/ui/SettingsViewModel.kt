package com.nomistake.app.ui

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.nomistake.app.data.local.dao.SettingDao
import com.nomistake.app.data.local.entity.NotificationRuleEntity
import com.nomistake.app.notification.NotificationAlarmScheduler
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch
import java.time.LocalTime
import java.time.format.DateTimeFormatter

class SettingsViewModel(
    private val settingDao: SettingDao,
    private val notificationScheduler: NotificationAlarmScheduler
) : ViewModel() {

    val notificationRules: StateFlow<List<NotificationRuleEntity>> =
        settingDao.observeNotificationRules()
            .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), emptyList())

    var status by mutableStateOf<String?>(null)
        private set

    fun setEnabled(rule: NotificationRuleEntity, enabled: Boolean) {
        save(rule.copy(enabled = enabled), "${rule.label}: ${if (enabled) "사용" else "사용 안 함"}")
    }

    fun saveTiming(rule: NotificationRuleEntity, input: String) {
        val normalized = input.trim()
        val updated = when {
            rule.minutesBefore != null -> {
                val minutes = normalized.toIntOrNull()
                if (minutes == null || minutes <= 0) {
                    status = "분 단위 값은 1 이상의 숫자로 입력하세요."
                    return
                }
                rule.copy(minutesBefore = minutes)
            }

            rule.dayOffset != null && rule.timeOfDay != null -> {
                val time = runCatching { LocalTime.parse(normalized) }.getOrNull()
                if (time == null) {
                    status = "시간은 HH:mm 형식으로 입력하세요. 예: 14:00"
                    return
                }
                rule.copy(timeOfDay = time.format(HH_MM))
            }

            else -> {
                status = "지원하지 않는 알림 규칙 형식입니다."
                return
            }
        }

        save(updated, "${rule.label} 저장 완료")
    }

    private fun save(rule: NotificationRuleEntity, successMessage: String) {
        viewModelScope.launch {
            try {
                settingDao.updateNotificationRule(rule)
                val result = notificationScheduler.rescheduleAll()
                status = "$successMessage · 알람 ${result.alarmCount}개 재등록"
            } catch (e: Exception) {
                status = "설정 저장 실패: ${e.message ?: e::class.java.simpleName}"
            }
        }
    }

    companion object {
        private val HH_MM = DateTimeFormatter.ofPattern("HH:mm")
    }
}
