package com.nomistake.app.domain

import com.nomistake.app.data.remote.GraphCalendar
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/**
 * CalendarSelector 단위 테스트 (JVM, Android 의존 없음).
 */
class CalendarSelectorTest {

    @Test
    fun `MERI 이름이 있으면 해당 Calendar 반환`() {
        val calendars = listOf(
            GraphCalendar("id-1", "Calendar"),
            GraphCalendar("id-2", "MERI"),
            GraphCalendar("id-3", "회의실")
        )
        val result = CalendarSelector.findMeriCalendar(calendars)
        assertEquals("id-2", result?.id)
        assertEquals("MERI", result?.name)
    }

    @Test
    fun `MERI가 없으면 null 반환`() {
        val calendars = listOf(
            GraphCalendar("id-1", "Calendar"),
            GraphCalendar("id-2", "회의실")
        )
        assertNull(CalendarSelector.findMeriCalendar(calendars))
    }

    @Test
    fun `빈 목록이면 null 반환`() {
        assertNull(CalendarSelector.findMeriCalendar(emptyList()))
    }

    @Test
    fun `대소문자 구분 - meri는 매칭 안 됨`() {
        val calendars = listOf(GraphCalendar("id-1", "meri"))
        assertNull(CalendarSelector.findMeriCalendar(calendars))
    }

    @Test
    fun `앞뒤 공백은 trim 후 매칭`() {
        val calendars = listOf(GraphCalendar("id-1", " MERI "))
        assertEquals("id-1", CalendarSelector.findMeriCalendar(calendars)?.id)
    }

    @Test
    fun `MERI가 여러 개면 첫 번째 반환`() {
        val calendars = listOf(
            GraphCalendar("id-1", "MERI"),
            GraphCalendar("id-2", "MERI")
        )
        assertEquals("id-1", CalendarSelector.findMeriCalendar(calendars)?.id)
    }
}
