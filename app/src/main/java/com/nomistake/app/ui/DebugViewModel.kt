package com.nomistake.app.ui

import android.app.Activity
import android.util.Log
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.nomistake.app.data.remote.GraphClient
import com.nomistake.app.data.remote.MsalAuthManager
import com.nomistake.app.data.repository.CalendarSettingRepository
import com.nomistake.app.domain.CalendarSelector
import kotlinx.coroutines.launch
import java.time.LocalDate
import java.time.ZoneOffset
import java.time.format.DateTimeFormatter

/**
 * Phase 4 연결 검증용 임시 Debug ViewModel.
 * 정식 UI로 대체될 때까지 별도로 유지한다.
 */
class DebugViewModel(
    private val authManager: MsalAuthManager,
    private val graphClient: GraphClient,
    private val calendarSettingRepository: CalendarSettingRepository
) : ViewModel() {

    var status by mutableStateOf("Ready")
        private set

    private var accessToken: String? = null

    private val scopes = listOf(MsalAuthManager.GRAPH_SCOPE_CALENDARS_READ)

    fun signIn(activity: Activity) {
        viewModelScope.launch {
            status = "Signing in..."
            try {
                accessToken = authManager.acquireToken(activity, scopes)
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
                    status = "MERI not found. Calendars: ${calendars.map { it.name }}"
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
}
