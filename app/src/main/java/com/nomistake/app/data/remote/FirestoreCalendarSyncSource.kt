package com.nomistake.app.data.remote

import com.google.firebase.firestore.FirebaseFirestore
import com.google.firebase.firestore.Source
import com.nomistake.app.domain.CalendarSyncSource
import com.nomistake.app.domain.SyncedEvent
import kotlinx.coroutines.tasks.await
import java.time.Instant
import java.time.ZoneId
import java.time.ZonedDateTime
import java.time.format.DateTimeFormatter
import java.time.temporal.ChronoUnit

/**
 * Firestore 기반 캘린더 동기화 소스 (Phase 5 primary).
 *
 * PC Companion(Outlook COM → Firestore)이 업로드한 events 컬렉션을 읽기만 한다.
 * Android에서 Firestore 문서를 write하는 경로는 존재하지 않는다(Security Rules로도 차단).
 *
 * 쿼리 정책:
 * - `start >= fromIso` 단일 범위 조건(문자열 ISO는 사전식=시간순 정렬이므로 정상 동작).
 * - deleted(tombstone) 필터를 쿼리에 넣지 않는다: tombstone 문서를 읽어야 Room soft-delete로
 *   반영할 수 있기 때문이다. 이로써 복합 인덱스(단일 문서 수 기준 premature optimization)도 불필요하다.
 * - [to] 상한은 쿼리에 쓰지 않는다(PC Companion 업로드 window가 이미 상한 역할).
 * - 서버 동기화는 반드시 `Source.SERVER`를 사용한다. 기본 `get()`의 cache fallback을 허용하면
 *   오프라인 상태에서도 오래된 캐시를 최신 동기화 성공으로 오인하여 lastSuccessfulSyncAt이 갱신될 수 있다.
 *
 * 인증: Firebase Auth(Email/Password) 로그인 상태에서만 Security Rules가 read를 허용한다.
 * 실패 시 예외를 그대로 던져 호출자(DebugViewModel/WorkManager)가 상태를 처리하게 한다.
 */
class FirestoreCalendarSyncSource(
    private val db: FirebaseFirestore,
    private val zone: ZoneId = ZoneId.systemDefault()
) : CalendarSyncSource {

    override suspend fun fetchEvents(from: Instant, to: Instant): List<SyncedEvent> {
        val fromIso = toLocalIso(from)
        val snapshot = db.collection(COLLECTION)
            .whereGreaterThanOrEqualTo(FIELD_START, fromIso)
            .get(Source.SERVER)
            .await()
        return snapshot.documents.mapNotNull { doc ->
            val data = doc.data ?: return@mapNotNull null
            val dto = FirestoreDtoParser.fromMap(doc.id, data)
            dto.toSyncedEvent(zone)
        }
    }

    /** [Instant]를 PC Companion이 기록한 로컬 시간 문자열("yyyy-MM-ddTHH:mm:ss") 형식으로 변환. */
    private fun toLocalIso(instant: Instant): String =
        ZonedDateTime.ofInstant(instant, zone)
            .truncatedTo(ChronoUnit.SECONDS)
            .format(DateTimeFormatter.ofPattern("yyyy-MM-dd'T'HH:mm:ss"))

    companion object {
        const val COLLECTION = "events"
        const val FIELD_START = "start"
    }
}