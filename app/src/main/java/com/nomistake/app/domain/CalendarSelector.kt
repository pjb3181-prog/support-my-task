package com.nomistake.app.domain

import com.nomistake.app.data.remote.GraphCalendar

/**
 * Calendar 목록에서 이름이 정확히 "MERI"인 Calendar를 찾는다.
 *
 * - 최초 자동 탐색에만 사용한다. 이후에는 저장된 calendarId를 우선 사용한다.
 * - MERI가 없으면 null을 반환한다. 임의로 기본 Calendar를 선택하지 않는다.
 */
object CalendarSelector {

    const val MERI_CALENDAR_NAME = "MERI"

    /**
     * 이름이 정확히 "MERI"인 Calendar를 반환한다. 없으면 null.
     * 대소문자 구분, 앞뒤 공백은 trim 후 비교한다.
     */
    fun findMeriCalendar(calendars: List<GraphCalendar>): GraphCalendar? {
        return calendars.firstOrNull { it.name.trim() == MERI_CALENDAR_NAME }
    }
}
