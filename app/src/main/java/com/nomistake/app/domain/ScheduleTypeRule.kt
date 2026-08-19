package com.nomistake.app.domain

/**
 * cleanTitle → scheduleType 매핑 규칙 (순수 도메인 모델).
 *
 * Room의 [com.nomistake.app.data.local.entity.ScheduleTypeRuleEntity]와 대응하지만,
 * Parser가 Android/Room에 의존하지 않도록 별도 순수 모델로 분리한다.
 *
 * @param keyword cleanTitle에 포함 여부를 검사할 키워드
 * @param scheduleType 매칭 시 반환할 일정 유형 key
 * @param priority 낮을수록 우선 매칭 (오름차순으로 검사)
 */
data class ScheduleTypeRule(
    val keyword: String,
    val scheduleType: String,
    val priority: Int
)
