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
import com.nomistake.app.data.remote.FirebaseAuthManager
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
    private val firebaseAuthManager: FirebaseAuthManager?,
    private val requestImmediateSync: () -> Unit
) : ViewModel() {

    val notificationRules: StateFlow<List<NotificationRuleEntity>> =
        settingDao.observeNotificationRules()
            .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), emptyList())

    val typeTemplates: StateFlow<List<ChecklistTemplateEntity>> =
        templateDao.observeTypeTemplates()
            .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), emptyList())

    val firebaseAvailable: Boolean
        get() = firebaseAuthManager != null

    var signedInAs by mutableStateOf(firebaseAuthManager?.currentEmail)
        private set

    var emailInput by mutableStateOf("")
    var passwordInput by mutableStateOf("")

    var mineMarker by mutableStateOf(EventTitleParser.DEFAULT_MINE_MARKER)
        private set

    var status by mutableStateOf<String?>(null)
        private set

    init {
        viewModelScope.launch {
            mineMarker = settingDao.get(CalendarSyncRepository.KEY_MINE_MARKER)?.value
                ?.trim()
                ?.takeIf { it.isNotEmpty() }
                ?: EventTitleParser.DEFAULT_MINE_MARKER
        }
    }

    fun signIn() {
        val auth = firebaseAuthManager ?: run {
            status = "이 빌드에는 Firebase 설정이 없습니다."
            return
        }
        val email = emailInput.trim()
        val password = passwordInput
        if (email.isEmpty() || password.isEmpty()) {
            status = "이메일과 비밀번호를 입력하세요."
            return
        }

        viewModelScope.launch {
            try {
                auth.signIn(email, password)
                signedInAs = auth.currentEmail
                passwordInput = ""
                requestImmediateSync()
                status = "로그인 완료 · 일정 동기화 요청"
            } catch (e: Exception) {
                passwordInput = ""
                status = "로그인 실패: ${e.message ?: e::class.java.simpleName}"
            }
        }
    }

    fun signOut() {
        firebaseAuthManager?.signOut()
        signedInAs = null
        passwordInput = ""
        status = "로그아웃했습니다. 기기에 저장된 기존 체크 상태는 유지됩니다."
    }

    fun saveMineMarker(input: String) {
        val marker = input.trim()
        if (marker.isEmpty()) {
            status = "내 일정 식별문자는 비워둘 수 없습니다."
            return
        }
        if (marker.contains('[') || marker.contains(']')) {
            status = "식별문자에는 [ 또는 ]를 넣지 마세요."
            return
        }

        viewModelScope.launch {
            settingDao.put(SettingEntity(CalendarSyncRepository.KEY_MINE_MARKER, marker))
            mineMarker = marker
            requestImmediateSync()
            status = "내 일정 식별문자 '$marker' 저장 · 일정 재분류 동기화 요청"
        }
    }

    /**
     * 사용자 정의 업무유형을 추가한다.
     * 제목 키워드 → scheduleType 규칙과 TYPE checklist template을 함께 만든다.
     * 체크항목은 한 줄에 하나씩 입력한다.
     */
    fun addTaskType(nameInput: String, keywordInput: String, checklistInput: String) {
        val name = nameInput.trim()
        val keyword = keywordInput.trim()
        val items = checklistInput.lineSequence()
            .map { it.trim() }
            .filter { it.isNotEmpty() }
            .distinctBy { it.lowercase() }
            .toList()

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
