package com.nomistake.app.background

import java.time.LocalDateTime
import java.time.LocalTime

/**
 * 자동 백그라운드 sync 허용 시간.
 * 00:00~07:59에는 Firestore read를 아예 수행하지 않는다.
 * 앱 실행/설정 변경 등 명시적 immediate sync는 worker input flag로 이 제한을 우회한다.
 */
object BackgroundSyncHours {
    private val start = LocalTime.of(8, 0)

    fun isAutomaticSyncAllowed(now: LocalDateTime = LocalDateTime.now()): Boolean =
        !now.toLocalTime().isBefore(start)
}
