package com.nomistake.app.data.remote

import com.google.gson.Gson
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.HttpUrl
import okhttp3.OkHttpClient
import okhttp3.Request

/**
 * Microsoft Graph API 클라이언트 (읽기 전용).
 *
 * Phase 4에서는 Calendar 목록 조회와 MERI Calendar의 Event 조회만 수행한다.
 * 실제 Event 데이터는 로컬 debug log에서만 확인하고 Git에 commit하지 않는다.
 */
class GraphClient(
    private val httpClient: OkHttpClient = OkHttpClient(),
    private val gson: Gson = Gson()
) {

    companion object {
        const val GRAPH_BASE_URL = "https://graph.microsoft.com"
        const val GRAPH_VERSION = "v1.0"

        /** Immutable ID를 일관되게 요청하기 위한 Prefer 헤더 */
        const val PREFER_IMMUTABLE_ID = "IdType=\"ImmutableId\""

        fun parseCalendarList(json: String): List<GraphCalendar> =
            Gson().fromJson(json, CalendarListResponse::class.java).value

        fun parseEventList(json: String): List<GraphEvent> =
            Gson().fromJson(json, EventListResponse::class.java).value
    }

    /** 사용자가 접근 가능한 Calendar 목록 조회 */
    suspend fun listCalendars(accessToken: String): List<GraphCalendar> =
        withContext(Dispatchers.IO) {
            val url = HttpUrl.Builder()
                .scheme("https")
                .host("graph.microsoft.com")
                .addPathSegment(GRAPH_VERSION)
                .addPathSegment("me")
                .addPathSegment("calendars")
                .build()

            val request = Request.Builder()
                .url(url)
                .header("Authorization", "Bearer $accessToken")
                .get()
                .build()

            httpClient.newCall(request).execute().use { response ->
                if (!response.isSuccessful) {
                    throw GraphException("listCalendars failed: HTTP ${response.code}")
                }
                val body = response.body?.string()
                    ?: throw GraphException("listCalendars: empty body")
                parseCalendarList(body)
            }
        }

    /**
     * 특정 Calendar의 Event를 날짜 범위로 조회한다.
     * start/end는 ISO 8601 형식(예: 2024-01-01T00:00:00Z).
     */
    suspend fun listEvents(
        accessToken: String,
        calendarId: String,
        startDateTime: String,
        endDateTime: String
    ): List<GraphEvent> = withContext(Dispatchers.IO) {
        val url = HttpUrl.Builder()
            .scheme("https")
            .host("graph.microsoft.com")
            .addPathSegment(GRAPH_VERSION)
            .addPathSegment("me")
            .addPathSegment("calendars")
            .addPathSegment(calendarId)
            .addPathSegment("calendarView")
            .addQueryParameter("startDateTime", startDateTime)
            .addQueryParameter("endDateTime", endDateTime)
            .build()

        val request = Request.Builder()
            .url(url)
            .header("Authorization", "Bearer $accessToken")
            .header("Prefer", PREFER_IMMUTABLE_ID)
            .get()
            .build()

        httpClient.newCall(request).execute().use { response ->
            if (!response.isSuccessful) {
                throw GraphException("listEvents failed: HTTP ${response.code}")
            }
            val body = response.body?.string()
                ?: throw GraphException("listEvents: empty body")
            parseEventList(body)
        }
    }
}

class GraphException(message: String) : Exception(message)
