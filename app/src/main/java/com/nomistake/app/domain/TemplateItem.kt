package com.nomistake.app.domain

/**
 * 체크리스트 템플릿 항목 (순수 도메인 모델).
 *
 * Room의 [com.nomistake.app.data.local.entity.TemplateItemEntity]와 대응하지만,
 * 병합 로직이 Android/Room에 의존하지 않도록 별도 순수 모델로 분리한다.
 *
 * @param id 원본 TemplateItem.id (중복 제거 시 origin 추적에 사용)
 * @param text 항목 텍스트
 * @param sortOrder 템플릿 내 정렬 순서
 */
data class TemplateItem(
    val id: Long,
    val text: String,
    val sortOrder: Int
)
