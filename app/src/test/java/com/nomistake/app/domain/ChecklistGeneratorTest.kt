package com.nomistake.app.domain

import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * ChecklistGenerator 단위 테스트 (JVM, Android/Room 의존 없음).
 *
 * ROOM → TYPE 병합 순서, 중복 제거(trim + 대소문자 무시), sortOrder 재할당을 검증한다.
 */
class ChecklistGeneratorTest {

    private val generator = ChecklistGenerator()

    private fun item(id: Long, text: String, sortOrder: Int = id.toInt()) =
        TemplateItem(id = id, text = text, sortOrder = sortOrder)

    // ── Case 1: ROOM + TYPE 병합 ──────────────────────────────

    @Test
    fun `ROOM + TYPE 병합 순서 유지`() {
        val room = listOf(
            item(1, "참석자 명단 받기", 0),
            item(2, "관련자료 출력", 1),
            item(3, "입구 팻말 준비", 2)
        )
        val type = listOf(
            item(10, "관련자료 확인", 0),
            item(11, "노트북", 1),
            item(12, "충전기", 2)
        )

        val result = generator.merge(room, type)

        assertEquals(
            listOf("참석자 명단 받기", "관련자료 출력", "입구 팻말 준비", "관련자료 확인", "노트북", "충전기"),
            result.map { it.text }
        )
        assertEquals(listOf(0, 1, 2, 3, 4, 5), result.map { it.sortOrder })
    }

    // ── Case 2: roomType 없음 ──────────────────────────────────

    @Test
    fun `roomType 없음 - TYPE 항목만 생성`() {
        val type = listOf(
            item(10, "관련자료 확인", 0),
            item(11, "노트북", 1),
            item(12, "충전기", 2)
        )

        val result = generator.merge(emptyList(), type)

        assertEquals(listOf("관련자료 확인", "노트북", "충전기"), result.map { it.text })
    }

    // ── Case 3: 일반회의 fallback ──────────────────────────────

    @Test
    fun `일반회의 fallback - 일반회의 템플릿 항목 적용`() {
        val type = listOf(item(10, "관련자료 확인", 0))

        val result = generator.merge(emptyList(), type)

        assertEquals(listOf("관련자료 확인"), result.map { it.text })
    }

    // ── Case 4: 중복 제거 (ROOM 우선) ──────────────────────────

    @Test
    fun `중복 제거 - ROOM 항목 우선 유지`() {
        val room = listOf(item(1, "노트북", 0), item(2, "참석자 명단", 1))
        val type = listOf(item(10, "노트북", 0), item(11, "충전기", 1))

        val result = generator.merge(room, type)

        assertEquals(listOf("노트북", "참석자 명단", "충전기"), result.map { it.text })
        // 중복된 "노트북"의 templateItemId는 ROOM 항목의 id(1) 유지
        assertEquals(1L, result[0].templateItemId)
    }

    // ── Case 5: whitespace 중복 ────────────────────────────────

    @Test
    fun `whitespace 중복 - 하나만 유지`() {
        val room = listOf(item(1, "노트북", 0))
        val type = listOf(item(10, " 노트북 ", 0))

        val result = generator.merge(room, type)

        assertEquals(1, result.size)
        assertEquals("노트북", result[0].text)
    }

    // ── Case 6: 영문 대소문자 중복 ─────────────────────────────

    @Test
    fun `영문 대소문자 중복 - 하나만 유지`() {
        val room = listOf(item(1, "HDMI", 0))
        val type = listOf(item(10, "hdmi", 0))

        val result = generator.merge(room, type)

        assertEquals(1, result.size)
        assertEquals("HDMI", result[0].text)
    }

    // ── Case 7: 의미만 비슷한 항목 ──────────────────────────────

    @Test
    fun `의미만 비슷한 항목은 둘 다 유지`() {
        val room = listOf(item(1, "관련자료 확인", 0))
        val type = listOf(item(10, "관련자료 출력", 0))

        val result = generator.merge(room, type)

        assertEquals(listOf("관련자료 확인", "관련자료 출력"), result.map { it.text })
    }

    // ── 추가: sortOrder 재할당 ─────────────────────────────────

    @Test
    fun `sortOrder는 병합 결과 기준 0부터 재할당`() {
        val room = listOf(item(1, "A", 5), item(2, "B", 3))
        val type = listOf(item(10, "C", 9))

        val result = generator.merge(room, type)

        assertEquals(listOf("B", "A", "C"), result.map { it.text })
        assertEquals(listOf(0, 1, 2), result.map { it.sortOrder })
    }
}
