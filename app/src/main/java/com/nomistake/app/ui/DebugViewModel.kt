package com.nomistake.app.ui

import android.app.Activity
import android.util.Log
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.nomistake.app.data.remote.FirebaseAuthManager
import com.nomistake.app.data.remote.GraphClient
import com.nomistake.app.data.remote.MsalAuthManager
import com.nomistake.app.data.repository.CalendarSettingRepository
import com.nomistake.app.data.repository.CalendarSyncRepository
import com.nomistake.app.data.repository.SyncStats
import com.nomistake.app.domain.CalendarSelector
import com.nomistake.app.notification.NotificationAlarmScheduler
import kotlinx.coroutines.launch
import java.time.LocalDate
import java.time.ZoneId
import java.time.ZoneOffset
import java.time.format.DateTimeFormatter

/**
 * Phase 4~7 연결 검증용 Debug ViewModel.
 * - Phase 7: sync 성공 후 현재 Room 상태로 알림을 재등록
 * - Phase 5: Firebase Auth(Email/Password) 로그인 + Firestore → Room sync (primary)
 * - Phase 4: MSAL/Graph 경로 (fallback, 보존)
 * 정식 UI로 대체될 때까지 별도로 유지한다.
 *
 * [보안] 이메일/비밀번호는 UI 입력 상태로만 존재하고 저장/로그 출력을 하지 않는다.
 * 실제 일정 제목도 debug log에 대량 출력하지 않는다(count/요약만 표시).
 */
class DebugViewModel(
    private val msalAuthManager: MsalAuthManager,
    private val graphClient: GraphClient,
    private val calendarSettingRepository: CalendarSettingRepository,
    private val firebaseAuthManager: FirebaseAuthManager?, // null = google-services.json 없음
    private val syncRepository: CalendarSyncRepository?,     // null = Firebase 초기화 안 됨
    private val notificationScheduler: NotificationAlarmScheduler? = null
) : ViewModel() {

    var status by mutableStateOf("Ready")
        private set

    /** 로그인 입력값 — UI에서만 관리. 저장하지 않고 로그인 시도 후 즉시 폐기한다. */
    var emailInput by mutableStateOf("")
    var passwordInput by mutableStateOf("")

    var signedInAs by mutableStateOf<String?>(null)
        private set
    var lastStats by mutableStateOf<SyncStats?>(null)
        private set
    var lastSyncAt by mutableStateOf<String?>(null)
        private set

    val firebaseAvailable: Boolean get() = firebaseAuthManager != null

    private var accessToken: String? = null

    private val scopes = listOf(MsalAuthManager.GRAPH_SCOPE_CALENDARS_READ)

    init {
        refreshFirebaseState()
    }

    /** Firebase 세션은 Auth가 자동 유지한다. 앱 재시작 시에도 여기서 상태만 다시 읽는다. */
    fun refreshFirebaseState() {
        signedInAs = firebaseAuthManager?.currentEmail
        val repo = syncRepository ?: return
        viewModelScope.launch {
            lastSyncAt = repo.getLastSyncTime()
        }
    }

    // ── Phase 5: Firebase Auth (Gate A) ─────────────────────────

    /** Email/Password 로그인. 계정은 Firebase Console(Authentication > Users)에서 미리 생성한다. */
    fun firebaseSignIn() {
        val manager = firebaseAuthManager
        if (manager == null) {
            status = "Firebase 미설정: app/google-services.json 없음"
            return
        }
        viewModelScope.launch {
            status = "Signing in..."
            try {
                manager.signIn(emailInput, passwordInput)
                passwordInput = "" // 사용 즉시 폐기
                signedInAs = manager.currentEmail
                status = "Signed in: $signedInAs"
            } catch (e: Exception) {
                status = "Sign in failed: ${e.message}"
            }
        }
    }

    fun firebaseSignOut() {
        firebaseAuthManager?.signOut()
        signedInAs = null
        status = "Signed out"
    }

    // ── Phase 5: Firestore → Room sync (Gate B~E) ───────────────

    /** 앱 실행/수동 Refresh: 과거 7일 자정 ~ 미래 90일 window를 읽어 Room에 반영한다. */
    fun syncNow() {
        val repo = syncRepository
        if (repo == null) {
            status = "Firestore 미설정: app/google-services.json 없음"
            return
        }
        viewModelScope.launch {
            status = "Syncing..."
            try {
                val zone = ZoneId.systemDefault()
                val from = LocalDate.now(zone).minusDays(SYNC_PAST_DAYS)
                    .atStartOfDay(zone).toInstant()
                val to = LocalDate.now(zone).plusDays(SYNC_FUTURE_DAYS)
                    .atStartOfDay(zone).toInstant()
                val stats = repo.syncNow(from, to)
                lastStats = stats
                lastSyncAt = repo.getLastSyncTime()
                val scheduleResult = notificationScheduler?.rescheduleAll()
                status = if (scheduleResult == null) {
                    "Sync OK (fetched=${stats.fetched}, target=${stats.target})"
                } else {
                    "Sync OK (fetched=${stats.fetched}, target=${stats.target}, alarms=${scheduleResult.alarmCount})"
                }
            } catch (e: Exception) {
                // 실패해도 Room은 그대로 유지(offline source of truth).
                status = "Sync failed: ${e.message}"
            }
        }
    }

    // ── Phase 4: MSAL + Graph (fallback, 보존) ──────────────────

    fun signIn(activity: Activity) {
        viewModelScope.launch {
            status = "Signing in..."
            try {
                accessToken = msalAuthManager.acquireToken(activity, scopes)
                status = "Signed in"
            } catch (e: Exception) {
                status = "Sign in failed: ${e.message}"
            }
        }
    }

    fun findMeriCalendar() {
        viewModelScope.launch {
            val token = accessToken
            if (token == null) {
                status = "Not signed in"
                return@launch
            }
            status = "Finding MERI calendar..."
            try {
                val calendars = graphClient.listCalendars(token)
                val meri = CalendarSelector.findMeriCalendar(calendars)
                if (meri != null) {
                    calendarSettingRepository.saveSelectedCalendar(meri.id, meri.name)
                    status = "MERI calendar found: ${meri.name}"
                } else {
                    status = "MERI not found"
                }
            } catch (e: Exception) {
                status = "Find MERI failed: ${e.message}"
            }
        }
    }

    fun loadEvents() {
        viewModelScope.launch {
            val token = accessToken
            if (token == null) {
                status = "Not signed in"
                return@launch
            }
            val calendarId = calendarSettingRepository.getSelectedCalendarId()
            if (calendarId == null) {
                status = "No calendar selected"
                return@launch
            }
            status = "Loading events..."
            try {
                val (start, end) = dateRange()
                val events = graphClient.listEvents(token, calendarId, start, end)
                status = "Events loaded: ${events.size}"
                // 실제 Event 필드는 로컬 debug log에서만 확인. Git에 commit하지 않는다.
                if (events.isNotEmpty()) {
                    val e = events.first()
                    Log.d(
                        "Phase4",
                        "first event: id=${e.id}, subject=${e.subject}, " +
                            "start=${e.start?.dateTime}, end=${e.end?.dateTime}, " +
                            "isAllDay=${e.isAllDay}, location=${e.location?.displayName}, " +
                            "type=${e.type}, seriesMasterId=${e.seriesMasterId}, " +
                            "iCalUId=${e.iCalUId}, changeKey=${e.changeKey}, " +
                            "isCancelled=${e.isCancelled}"
                    )
                }
            } catch (e: Exception) {
                status = "Load events failed: ${e.message}"
            }
        }
    }

    /** 오늘 ~ +30일 (UTC, ISO 8601) */
    private fun dateRange(): Pair<String, String> {
        val start = LocalDate.now().atStartOfDay().atOffset(ZoneOffset.UTC)
        val end = LocalDate.now().plusDays(30).atStartOfDay().atOffset(ZoneOffset.UTC)
        return start.format(DateTimeFormatter.ISO_OFFSET_DATE_TIME) to
            end.format(DateTimeFormatter.ISO_OFFSET_DATE_TIME)
    }

    companion object {
        const val SYNC_PAST_DAYS = 7L
        const val SYNC_FUTURE_DAYS = 90L
    }
}
