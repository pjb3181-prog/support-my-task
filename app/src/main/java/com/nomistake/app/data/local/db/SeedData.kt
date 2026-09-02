package com.nomistake.app.data.local.db

import com.nomistake.app.data.local.entity.ChecklistTemplateEntity
import com.nomistake.app.data.local.entity.NotificationRuleEntity
import com.nomistake.app.data.local.entity.RuleAppliesTo
import com.nomistake.app.data.local.entity.ScheduleTypeRuleEntity
import com.nomistake.app.data.local.entity.SettingEntity
import com.nomistake.app.data.local.entity.TemplateItemEntity
import com.nomistake.app.data.local.entity.TemplateKind
import com.nomistake.app.data.repository.CalendarSyncRepository
import com.nomistake.app.domain.EventTitleParser

/** 최초 실행 seed + 기존 설치본에 새 built-in을 안전하게 보강. */
object SeedData {

    suspend fun seed(db: AppDatabase) {
        val templateDao = db.templateDao()
        val settingDao = db.settingDao()

        if (templateDao.countTemplates() == 0) {
            seedRoomTemplate(templateDao, "대", "대회의실", listOf("참석자 명단 받기", "관련자료 출력", "입구 팻말 준비"))
            seedRoomTemplate(templateDao, "세", "세미나실", listOf("참석자 명단 받기", "관련자료 출력", "입구 팻말 준비"))
            seedTypeTemplate(templateDao, "HAZOP", "HAZOP", listOf("관련자료 확인", "노트북", "충전기"))
            seedTypeTemplate(templateDao, "LOPA", "LOPA", listOf("관련자료 확인", "노트북", "충전기"))
            seedTypeTemplate(templateDao, "FMEA", "FMEA", listOf("관련자료 확인", "노트북", "충전기"))
            seedTypeTemplate(templateDao, "FIELD_WORK", "현장업무", listOf("관련자료", "노트북", "충전기", "안전화", "안전모"))
            seedTypeTemplate(templateDao, "면담", "면담", listOf("관련자료 확인"))
            seedTypeTemplate(templateDao, "화상회의", "화상회의", listOf("관련자료 확인"))
            seedTypeTemplate(templateDao, "일반회의", "일반회의", listOf("관련자료 확인"))
        } else {
            ensureTypeTemplate(templateDao, "FMEA", "FMEA", listOf("관련자료 확인", "노트북", "충전기"))
        }

        if (templateDao.countScheduleTypeRules() == 0) {
            seedRule(templateDao, "FMEA", "FMEA", 0)
            seedRule(templateDao, "HAZOP", "HAZOP", 1)
            seedRule(templateDao, "LOPA", "LOPA", 2)
            seedRule(templateDao, "현장조사", "FIELD_WORK", 3)
            seedRule(templateDao, "현장방문", "FIELD_WORK", 4)
            seedRule(templateDao, "면담", "면담", 5)
            seedRule(templateDao, "화상회의", "화상회의", 6)
        } else {
            ensureRule(templateDao, "FMEA", "FMEA", 0)
        }

        if (settingDao.countNotificationRules() == 0) {
            seedNotificationRule(settingDao, "D-1 오후", dayOffset = -1, timeOfDay = "14:00", appliesTo = RuleAppliesTo.ALL)
            seedNotificationRule(settingDao, "D-1 퇴근 전", dayOffset = -1, timeOfDay = "17:00", appliesTo = RuleAppliesTo.ALL)
            seedNotificationRule(settingDao, "당일 오전", dayOffset = 0, timeOfDay = "08:00", appliesTo = RuleAppliesTo.ALL)
            seedNotificationRule(settingDao, "T-60", minutesBefore = 60, appliesTo = RuleAppliesTo.TIMED_ONLY)
            seedNotificationRule(settingDao, "T-30", minutesBefore = 30, appliesTo = RuleAppliesTo.TIMED_ONLY)
        }

        if (settingDao.get(CalendarSyncRepository.KEY_MINE_MARKER) == null) {
            settingDao.put(
                SettingEntity(
                    CalendarSyncRepository.KEY_MINE_MARKER,
                    EventTitleParser.DEFAULT_MINE_MARKER
                )
            )
        }
    }

    private suspend fun ensureTypeTemplate(
        dao: com.nomistake.app.data.local.dao.TemplateDao,
        key: String,
        name: String,
        items: List<String>
    ) {
        if (dao.getTemplate(TemplateKind.TYPE, key) != null) return
        seedTypeTemplate(dao, key, name, items)
    }

    private suspend fun ensureRule(
        dao: com.nomistake.app.data.local.dao.TemplateDao,
        keyword: String,
        scheduleType: String,
        priority: Int
    ) {
        if (dao.countScheduleTypeRule(keyword, scheduleType) > 0) return
        seedRule(dao, keyword, scheduleType, priority)
    }

    private suspend fun seedRoomTemplate(
        dao: com.nomistake.app.data.local.dao.TemplateDao,
        key: String,
        name: String,
        items: List<String>
    ) {
        val templateId = dao.insertTemplate(
            ChecklistTemplateEntity(kind = TemplateKind.ROOM, key = key, name = name)
        )
        items.forEachIndexed { i, text ->
            dao.insertTemplateItem(TemplateItemEntity(templateId = templateId, text = text, sortOrder = i))
        }
    }

    private suspend fun seedTypeTemplate(
        dao: com.nomistake.app.data.local.dao.TemplateDao,
        key: String,
        name: String,
        items: List<String>,
        isBuiltIn: Boolean = true
    ) {
        val templateId = dao.insertTemplate(
            ChecklistTemplateEntity(kind = TemplateKind.TYPE, key = key, name = name, isBuiltIn = isBuiltIn)
        )
        items.forEachIndexed { i, text ->
            dao.insertTemplateItem(TemplateItemEntity(templateId = templateId, text = text, sortOrder = i))
        }
    }

    private suspend fun seedRule(
        dao: com.nomistake.app.data.local.dao.TemplateDao,
        keyword: String,
        scheduleType: String,
        priority: Int
    ) {
        dao.insertScheduleTypeRule(
            ScheduleTypeRuleEntity(keyword = keyword, scheduleType = scheduleType, priority = priority)
        )
    }

    private suspend fun seedNotificationRule(
        dao: com.nomistake.app.data.local.dao.SettingDao,
        label: String,
        dayOffset: Int? = null,
        timeOfDay: String? = null,
        minutesBefore: Int? = null,
        appliesTo: RuleAppliesTo
    ) {
        dao.insertNotificationRule(
            NotificationRuleEntity(
                label = label,
                dayOffset = dayOffset,
                timeOfDay = timeOfDay,
                minutesBefore = minutesBefore,
                appliesTo = appliesTo
            )
        )
    }
}
