package com.nomistake.app.background

import java.time.LocalDateTime
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class BackgroundSyncHoursTest {

    @Test
    fun `00시부터 07시59분까지 자동 sync 차단`() {
        assertFalse(BackgroundSyncHours.isAutomaticSyncAllowed(LocalDateTime.of(2026, 9, 2, 0, 0)))
        assertFalse(BackgroundSyncHours.isAutomaticSyncAllowed(LocalDateTime.of(2026, 9, 2, 7, 59, 59)))
    }

    @Test
    fun `08시부터 자정 전까지 자동 sync 허용`() {
        assertTrue(BackgroundSyncHours.isAutomaticSyncAllowed(LocalDateTime.of(2026, 9, 2, 8, 0)))
        assertTrue(BackgroundSyncHours.isAutomaticSyncAllowed(LocalDateTime.of(2026, 9, 2, 23, 59, 59)))
    }
}
