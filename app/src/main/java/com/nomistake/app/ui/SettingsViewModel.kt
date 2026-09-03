package com.nomistake.app.ui

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.nomistake.app.data.local.dao.SettingDao
import com.nomistake.app.data.local.dao.TemplateDao
import com.nomistake.app.data.local.entity.ChecklistTemplateEntity
import com.nomistake.app.data.local.entity.NotificationRuleEntity
import com.nomistake.app.data.local.entity.ScheduleTypeRuleEntity
import com.nomistake.app.data.local.entity.SettingEntity
import com.nomistake.app.data.local.entity.TemplateItemEntity
import com.nomistake.app.data.local.entity.TemplateKind
import com.nomistake.app.data.repository.CalendarSyncRepository
import com.nomistake.app.domain.EventTitleParser
import com.nomistake.app.notification.NotificationAlarmScheduler
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch
import java.time.LocalTime
import java.time.format.DateTimeFormatter

class SettingsViewModel(
    private val settingDao: SettingDao,
    private val templateDao: TemplateDao,
    private val notificationScheduler: NotificationAlarmScheduler,
    private val requestImmediateSync: () -> Unit
) : ViewModel() {

    val notificationRules: StateFlow<List<NotificationRuleEntity>> =
        settingDao.observeNotificationRules()
            .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), emptyList())

    val typeTemplates: StateFlow<List<ChecklistTemplateEntity>> =
        templateDao.observeTemplatesByKind(TemplateKind.TYPE)
            .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), emptyList())

    var displayName by mutableStateOf("")
        private set

    var mineMarker by mutableStateOf(EventTitleParser.DEFAULT_MINE_MARKER)
        private set

    var status by mutableStateOf<String?>(null)
        private set

    init {
        viewModelScope.launch {
            displayName = settingDao.get(KEY_DISPLAY_NAME)?.value.orEmpty().trim()
            mineMarker = settingDao.get(CalendarSyncRepository.KEY_MINE_MARKER)?.value
                ?.trim()
                ?.takeIf { it.isNotEmpty() }
                ?: EventTitleParser.DEFAULT_MINE_MARKER
        }
    }

    fun saveProfile(nameInput: String, markerInput: String) {
        val name = nameInput.trim()
        val marker = markerInput.trim()
        if (name.isEmpty()) {
            status = "사용자명을 입력하세요."
            return
        }
        if (marker.isEmpty()) {
            status = "내 일정 식별문자는 비워둘 수 없습니다."
            return
        }
        if (marker.contains('[') || marker.contains(']')) {
            status = "식별문자에는 [ 또는 ]를 넣지 마세요."
            return
        }

        viewModelScope.launch {
            settingDao.put(SettingEntity(KEY_DISPLAY_NAME, name))
            settingDao.put(SettingEntity(CalendarSyncRepository.KEY_MINE_MARKER, marker))
            displayName = name
            mineMarker = marker
            requestImmediateSync()
            status = "사용자 설정 저장 · 일정 재분류 동기화 요청"
        }
    }

    suspend fun getTemplateItemsText(templateId: Long): String =
        templateDao.getTemplateItems(templateId).joinToString("\n") { it.text }

    fun saveTemplateItems(template: ChecklistTemplateEntity, checklistInput: String) {
        val items = normalizedItems(checklistInput)
        if (items.isEmpty()) {
            status = "준비항목을 한 개 이상 입력하세요."
            return
        }

        viewModelScope.launch {
            try {
                templateDao.deleteTemplateItems(template.id)
                items.forEachIndexed { index, text ->
                    templateDao.insertTemplateItem(
                        TemplateItemEntity(
                            templateId = template.id,
                            text = text,
                            sortOrder = index
                        )
                    )
                }
                requestImmediateSync()
                status = "${template.name} 준비항목 저장 완료"
            } catch (e: Exception) {
                status = "준비항목 저장 실패: ${e.message ?: e::class.java.simpleName}"
            }
        }
    }

    fun addTaskType(nameInput: String, keywordInput: String, checklistInput: String) {
        val name = nameInput.trim()
        val keyword = keywordInput.trim()
        val items = normalizedItems(checklistInput)

        if (name.isEmpty() || keyword.isEmpty()) {
            status = "업무유형 이름과 제목 키워드를 모두 입력하세요."
            return
        }
        if (typeTemplates.value.any { it.name.equals(name, ignoreCase = true) || it.key.equals(name, ignoreCase = true) }) {
            status = "이미 같은 이름의 업무유형이 있습니다."
            return
        }
        if (items.isEmpty()) {
            status = "체크항목을 한 개 이상 입력하세요."
            return
        }

        viewModelScope.launch {
            try {
                val templateId = templateDao.insertTemplate(
                    ChecklistTemplateEntity(
                        kind = TemplateKind.TYPE,
                        key = name,
                        name = name,
                        isBuiltIn = false
                    )
                )
                items.forEachIndexed { index, text ->
                    templateDao.insertTemplateItem(
                        TemplateItemEntity(
                            templateId = templateId,
                            text = text,
                            sortOrder = index
                        )
                    )
                }
                templateDao.insertScheduleTypeRule(
                    ScheduleTypeRuleEntity(
                        keyword = keyword,
                        scheduleType = name,
                        priority = templateDao.getNextScheduleTypePriority()
                    )
                )
                requestImmediateSync()
                status = "업무유형 '$name' 추가 · 제목에 '$keyword'가 있으면 적용"
            } catch (e: Exception) {
                status = "업무유형 추가 실패: ${e.message ?: e::class.java.simpleName}"
            }
        }
    }

    fun setEnabled(rule: NotificationRuleEntity, enabled: Boolean) {
        save(rule.copy(enabled = enabled), "${notificationRuleTitle(rule)}: ${if (enabled) "사용" else "사용 안 함"}")
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
                rule.copy(label = "T-$minutes", minutesBefore = minutes)
            }

            rule.dayOffset != null && rule.timeOfDay != null -> {
                val time = runCatching { LocalTime.parse(normalized) }.getOrNull()
                if (time == null) {
                    status = "시간은 HH:mm 형식으로 입력하세요. 예: 14:00"
                    return
                }
                val updatedRule = rule.copy(timeOfDay = time.format(HH_MM))
                updatedRule.copy(label = notificationRuleTitle(updatedRule))
            }

            else -> {
                status = "지원하지 않는 알림 규칙 형식입니다."
                return
            }
        }

        save(updated, "${notificationRuleTitle(updated)} 저장 완료")
    }

    fun saveDayAndTime(rule: NotificationRuleEntity, daysBeforeInput: String, timeInput: String) {
        if (rule.dayOffset == null || rule.timeOfDay == null) {
            status = "이 알림은 날짜 기준 알림이 아닙니다."
            return
        }
        val daysBefore = daysBeforeInput.trim().toIntOrNull()
        if (daysBefore == null || daysBefore < 0) {
            status = "며칠 전 값은 0 이상의 숫자로 입력하세요. 0은 당일입니다."
            return
        }
        val time = runCatching { LocalTime.parse(timeInput.trim()) }.getOrNull()
        if (time == null) {
            status = "시간은 HH:mm 형식으로 입력하세요. 예: 14:00"
            return
        }

        val updated = rule.copy(
            dayOffset = -daysBefore,
            timeOfDay = time.format(HH_MM)
        ).let { it.copy(label = notificationRuleTitle(it)) }
        save(updated, "${notificationRuleTitle(updated)} 저장 완료")
    }

    fun notificationRuleTitle(rule: NotificationRuleEntity): String = when {
        rule.minutesBefore != null -> "T-${rule.minutesBefore}"
        rule.dayOffset != null && rule.timeOfDay != null -> {
            val dayText = if (rule.dayOffset == 0) "당일" else "D-${kotlin.math.abs(rule.dayOffset)}"
            "$dayText ${rule.timeOfDay}"
        }
        else -> rule.label
    }

    private fun normalizedItems(input: String): List<String> = input.lineSequence()
        .map { it.trim() }
        .filter { it.isNotEmpty() }
        .distinctBy { it.lowercase() }
        .toList()

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
        const val KEY_DISPLAY_NAME = "pilotDisplayName"
        private val HH_MM = DateTimeFormatter.ofPattern("HH:mm")
    }
}
