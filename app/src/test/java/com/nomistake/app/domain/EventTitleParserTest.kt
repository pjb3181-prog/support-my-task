package com.nomistake.app.domain

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * EventTitleParser 단위 테스트 (JVM, Android 의존 없음).
 *
 * seed 기준 ScheduleTypeRule:
 * HAZOP(1) · LOPA(2) · 현장조사(3) · 현장방문(4) · 면담(5) · 화상회의(6)
 */
class EventTitleParserTest {

    private val parser = EventTitleParser()

    private val seedRules = listOf(
        ScheduleTypeRule("HAZOP", "HAZOP", 1),
        ScheduleTypeRule("LOPA", "LOPA", 2),
        ScheduleTypeRule("현장조사", "FIELD_WORK", 3),
        ScheduleTypeRule("현장방문", "FIELD_WORK", 4),
        ScheduleTypeRule("면담", "면담", 5),
        ScheduleTypeRule("화상회의", "화상회의", 6)
    )

    // ── 정상 사례 ──────────────────────────────────────────────

    @Test
    fun `대회의실 LOPA 용종`() {
        val r = parser.parse("[대]롯데정밀-LOPA[용종]", seedRules)
        assertEquals("대", r.roomType)
        assertEquals("용종", r.attendeeCode)
        assertTrue(r.isMine)
        assertEquals("롯데정밀-LOPA", r.cleanTitle)
        assertEquals("LOPA", r.scheduleType)
        assertTrue(r.isTarget)
    }

    @Test
    fun `법무사면담 종`() {
        val r = parser.parse("법무사면담[종]", seedRules)
        assertNull(r.roomType)
        assertEquals("종", r.attendeeCode)
        assertTrue(r.isMine)
        assertEquals("법무사면담", r.cleanTitle)
        assertEquals("면담", r.scheduleType)
        assertTrue(r.isTarget)
    }

    @Test
    fun `현대차화상회의 성`() {
        val r = parser.parse("현대차화상회의[성]", seedRules)
        assertNull(r.roomType)
        assertEquals("성", r.attendeeCode)
        assertFalse(r.isMine)
        assertEquals("현대차화상회의", r.cleanTitle)
        assertEquals("화상회의", r.scheduleType)
        assertFalse(r.isTarget)
    }

    @Test
    fun `본문의 업종은 isMine 판정에 사용하지 않음`() {
        val r = parser.parse("안전원-현장조사(페인트업종)[덕성하]", seedRules)
        assertNull(r.roomType)
        assertEquals("덕성하", r.attendeeCode)
        assertFalse(r.isMine)
        assertEquals("안전원-현장조사(페인트업종)", r.cleanTitle)
        assertEquals("FIELD_WORK", r.scheduleType)
        assertFalse(r.isTarget)
    }

    @Test
    fun `세미나실 HAZOP 용종`() {
        val r = parser.parse("[세]에기연-암모니아캡처HAZOP[용종]", seedRules)
        assertEquals("세", r.roomType)
        assertEquals("용종", r.attendeeCode)
        assertTrue(r.isMine)
        assertEquals("에기연-암모니아캡처HAZOP", r.cleanTitle)
        assertEquals("HAZOP", r.scheduleType)
        assertTrue(r.isTarget)
    }

    // ── 추가 edge case ─────────────────────────────────────────

    @Test
    fun `마지막 attendee bracket 없음`() {
        val r = parser.parse("회의", seedRules)
        assertNull(r.roomType)
        assertNull(r.attendeeCode)
        assertFalse(r.isMine)
        assertEquals("회의", r.cleanTitle)
        assertEquals("일반회의", r.scheduleType)
        assertFalse(r.isTarget)
    }

    @Test
    fun `roomType만 있는 일정`() {
        val r = parser.parse("[대]", seedRules)
        assertEquals("대", r.roomType)
        assertNull(r.attendeeCode)
        assertFalse(r.isMine)
        assertEquals("", r.cleanTitle)
        assertEquals("일반회의", r.scheduleType)
        assertTrue(r.isTarget)
    }

    @Test
    fun `대 태그가 제목 중간에 있으면 roomType 아님`() {
        val r = parser.parse("회의[대]내용", seedRules)
        assertNull(r.roomType)
        assertNull(r.attendeeCode)
        assertEquals("회의[대]내용", r.cleanTitle)
        assertFalse(r.isTarget)
    }

    @Test
    fun `본문에 추가 bracket이 있으면 마지막만 attendeeCode`() {
        val r = parser.parse("[대]회의[중간]내용[용종]", seedRules)
        assertEquals("대", r.roomType)
        assertEquals("용종", r.attendeeCode)
        assertTrue(r.isMine)
        assertEquals("회의[중간]내용", r.cleanTitle)
        assertTrue(r.isTarget)
    }

    @Test
    fun `빈 attendeeCode`() {
        val r = parser.parse("회의[]", seedRules)
        assertNull(r.roomType)
        assertEquals("", r.attendeeCode)
        assertFalse(r.isMine)
        assertEquals("회의", r.cleanTitle)
        assertEquals("일반회의", r.scheduleType)
        assertFalse(r.isTarget)
    }

    @Test
    fun `앞뒤 공백은 무시`() {
        val r = parser.parse("  [대]회의[용종]  ", seedRules)
        assertEquals("대", r.roomType)
        assertEquals("용종", r.attendeeCode)
        assertTrue(r.isMine)
        assertEquals("회의", r.cleanTitle)
        assertTrue(r.isTarget)
    }

    @Test
    fun `여러 keyword 매칭 시 priority 우선`() {
        val r = parser.parse("HAZOP-LOPA", seedRules)
        assertEquals("HAZOP", r.scheduleType)
    }

    @Test
    fun `영문 keyword 대소문자 무시`() {
        assertEquals("HAZOP", parser.parse("hazop", seedRules).scheduleType)
        assertEquals("LOPA", parser.parse("lopa", seedRules).scheduleType)
        assertEquals("HAZOP", parser.parse("Hazop", seedRules).scheduleType)
    }

    @Test
    fun `cleanTitle 앞뒤 공백 제거`() {
        val r = parser.parse("[대] 회의 [용종]", seedRules)
        assertEquals("대", r.roomType)
        assertEquals("용종", r.attendeeCode)
        assertEquals("회의", r.cleanTitle)
    }

    @Test
    fun `roomType만 있고 attendeeCode 없음 - 세미나실`() {
        val r = parser.parse("[세]회의", seedRules)
        assertEquals("세", r.roomType)
        assertNull(r.attendeeCode)
        assertEquals("회의", r.cleanTitle)
        assertEquals("일반회의", r.scheduleType)
        assertTrue(r.isTarget)
    }
}
