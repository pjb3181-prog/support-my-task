package com.nomistake.app.domain

/**
 * 템플릿 병합 결과 항목 (순수 도메인 모델).
 *
 * [ChecklistGenerator]가 ROOM + TYPE 템플릿을 병합·중복 제거한 뒤 반환하는
 * "생성 예정" 체크리스트 항목. 아직 DB에 저장되지 않은 상태다.
 *
 * @param text 항목 텍스트 (중복 제거 시 먼저 병합된 항목의 원본 텍스트 유지)
 * @param sortOrder 병합 결과 기준 0부터 순차 재할당된 정렬 순서
 * @param templateItemId 원본 TemplateItem.id (중복 시 ROOM 항목의 id 우선 유지)
 */
data class MergedChecklistItem(
    val text: String,
    val sortOrder: Int,
    val templateItemId: Long
)
