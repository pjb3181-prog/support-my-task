package com.nomistake.app.domain

/**
 * 체크리스트 템플릿 병합기 (순수 Kotlin, Android/Room 의존 없음).
 *
 * 병합 규칙:
 * 1) ROOM 템플릿 항목 → TYPE 템플릿 항목 순서로 병합.
 * 2) 각 템플릿 내부는 [TemplateItem.sortOrder] 오름차순 유지.
 * 3) 중복 제거: 정규화된 텍스트(trim + 대소문자 무시)가 같은 항목은 한 번만 유지.
 *    - 중복 시 먼저 병합된(ROOM) 항목의 텍스트와 templateItemId를 유지.
 *    - 의미가 비슷해도 문자열이 다르면 중복으로 간주하지 않음 (fuzzy/AI 매칭 없음).
 * 4) 결과의 sortOrder는 0부터 순차 재할당.
 */
class ChecklistGenerator {

    fun merge(
        roomItems: List<TemplateItem>,
        typeItems: List<TemplateItem>
    ): List<MergedChecklistItem> {
        val result = mutableListOf<MergedChecklistItem>()
        val seen = mutableSetOf<String>()

        val ordered = roomItems.sortedBy { it.sortOrder } + typeItems.sortedBy { it.sortOrder }
        for (item in ordered) {
            val normalized = normalize(item.text)
            if (seen.add(normalized)) {
                result.add(
                    MergedChecklistItem(
                        text = item.text,
                        sortOrder = result.size,
                        templateItemId = item.id
                    )
                )
            }
        }
        return result
    }

    /** 중복 비교용 정규화: 앞뒤 공백 제거 + 대소문자 무시. */
    private fun normalize(text: String): String = text.trim().lowercase()
}
