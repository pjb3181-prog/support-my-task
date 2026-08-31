package com.nomistake.app.data.remote

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Graph JSON 파싱 단위 테스트 (JVM, Gson 사용).
 * 테스트 데이터는 가상의 값만 사용한다. 실제 회사 일정 데이터는 사용하지 않는다.
 */
class GraphJsonParsingTest {

    @Test
    fun `Calendar 목록 JSON 파싱`() {
        val json = """
            {
              "value": [
                {"id": "AAMkAGI2TGuLAAA=", "name": "Calendar"},
                {"id": "AAMkAGI2TGuLBBB=", "name": "MERI"}
              ]
            }
        """.trimIndent()

        val calendars = GraphClient.parseCalendarList(json)
        assertEquals(2, calendars.size)
        assertEquals("AAMkAGI2TGuLAAA=", calendars[0].id)
        assertEquals("Calendar", calendars[0].name)
        assertEquals("MERI", calendars[1].name)
    }

    @Test
    fun `Event 목록 JSON 파싱 - 전체 필드`() {
        val json = """
            {
              "value": [
                {
                  "id": "event-id-1",
                  "subject": "회의",
                  "start": {"dateTime": "2024-01-01T09:00:00.0000000", "timeZone": "Asia/Seoul"},
                  "end": {"dateTime": "2024-01-01T10:00:00.0000000", "timeZone": "Asia/Seoul"},
                  "isAllDay": false,
                  "location": {"displayName": "대회의실"},
                  "type": "singleInstance",
                  "seriesMasterId": null,
                  "iCalUId": "ical-uid-1",
                  "changeKey": "change-key-1",
                  "isCancelled": false
                }
              ]
            }
        """.trimIndent()

        val events = GraphClient.parseEventList(json)
        assertEquals(1, events.size)
        val e = events[0]
        assertEquals("event-id-1", e.id)
        assertEquals("회의", e.subject)
        assertEquals("2024-01-01T09:00:00.0000000", e.start?.dateTime)
        assertEquals("Asia/Seoul", e.start?.timeZone)
        assertEquals(false, e.isAllDay)
        assertEquals("대회의실", e.location?.displayName)
        assertEquals("singleInstance", e.type)
        assertNull(e.seriesMasterId)
        assertEquals("ical-uid-1", e.iCalUId)
        assertEquals("change-key-1", e.changeKey)
        assertEquals(false, e.isCancelled)
    }

    @Test
    fun `Event 목록 JSON 파싱 - null 필드 허용`() {
        val json = """
            {
              "value": [
                {
                  "id": "event-id-2",
                  "subject": null,
                  "start": null,
                  "end": null,
                  "isAllDay": null,
                  "location": null,
                  "type": null,
                  "seriesMasterId": null,
                  "iCalUId": null,
                  "changeKey": null,
                  "isCancelled": null
                }
              ]
            }
        """.trimIndent()

        val events = GraphClient.parseEventList(json)
        assertEquals(1, events.size)
        val e = events[0]
        assertEquals("event-id-2", e.id)
        assertNull(e.subject)
        assertNull(e.start)
        assertNull(e.location)
        assertNull(e.isAllDay)
    }

    @Test
    fun `빈 value 배열 파싱`() {
        val json = """{"value": []}"""
        assertTrue(GraphClient.parseCalendarList(json).isEmpty())
        assertTrue(GraphClient.parseEventList(json).isEmpty())
    }
}
