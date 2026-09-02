package com.nomistake.app.data.repository

import com.nomistake.app.data.local.dao.ChecklistDao
import com.nomistake.app.data.local.dao.TemplateDao
import com.nomistake.app.data.local.entity.ChecklistEntity
import com.nomistake.app.data.local.entity.ChecklistItemEntity
import com.nomistake.app.data.local.entity.EventEntity
import com.nomistake.app.data.local.entity.ItemOrigin
import com.nomistake.app.data.local.entity.TemplateKind
import com.nomistake.app.domain.ChecklistGenerator
import com.nomistake.app.domain.EventTitleParser
import com.nomistake.app.domain.TemplateItem
import java.time.Instant
import java.util.Locale

/**
 * Event → Checklist 생성/병합 오케스트레이션.
 *
 * Phase 12에서는 기존 checklist도 append-only로 템플릿을 reconcile한다.
 * 업무 유형이 일반회의→FMEA/사용자 정의 유형으로 바뀌어도 기존 완료 상태와 EVENT_ONLY 항목은
 * 절대 지우지 않고, 새 템플릿에서 부족한 항목만 뒤에 추가한다.
 */
class ChecklistRepository(
    private val checklistDao: ChecklistDao,
    private val templateDao: TemplateDao,
    private val generator: ChecklistGenerator = ChecklistGenerator()
) {

    suspend fun ensureChecklist(event: EventEntity): Long? {
        if (!event.isTarget) return null

        val scheduleType = event.scheduleType ?: EventTitleParser.DEFAULT_SCHEDULE_TYPE
        val merged = loadMergedTemplateItems(event, scheduleType)
        val existing = checklistDao.getByEventId(event.id)

        if (existing == null) {
            val checklist = ChecklistEntity(
                eventId = event.id,
                scheduleType = scheduleType,
                createdAt = Instant.now()
            )
            val items = merged.map { m ->
                ChecklistItemEntity(
                    checklistId = 0,
                    text = m.text,
                    sortOrder = m.sortOrder,
                    origin = ItemOrigin.TEMPLATE_COPY,
                    templateItemId = m.templateItemId
                )
            }
            return checklistDao.createChecklistWithItems(checklist, items)
        }

        reconcileExisting(existing, scheduleType, merged)
        return existing.id
    }

    private suspend fun reconcileExisting(
        checklist: ChecklistEntity,
        scheduleType: String,
        templateItems: List<com.nomistake.app.domain.MergedChecklistItem>
    ) {
        if (checklist.scheduleType != scheduleType) {
            checklistDao.updateChecklist(checklist.copy(scheduleType = scheduleType))
        }

        val existingItems = checklistDao.getItems(checklist.id)
        val existingKeys = existingItems
            .map { normalize(it.text) }
            .toMutableSet()
        var nextSortOrder = checklistDao.getNextSortOrder(checklist.id)

        templateItems.forEach { item ->
            val key = normalize(item.text)
            if (key.isEmpty() || !existingKeys.add(key)) return@forEach
            checklistDao.insertItem(
                ChecklistItemEntity(
                    checklistId = checklist.id,
                    text = item.text.trim(),
                    sortOrder = nextSortOrder++,
                    origin = ItemOrigin.TEMPLATE_COPY,
                    templateItemId = item.templateItemId
                )
            )
        }
    }

    private suspend fun loadMergedTemplateItems(
        event: EventEntity,
        scheduleType: String
    ): List<com.nomistake.app.domain.MergedChecklistItem> {
        val roomItems = event.roomType?.let { roomType ->
            templateDao.getTemplate(TemplateKind.ROOM, roomType)?.let { template ->
                templateDao.getTemplateItems(template.id)
                    .map { TemplateItem(it.id, it.text, it.sortOrder) }
            }
        } ?: emptyList()

        val typeItems = templateDao.getTemplate(TemplateKind.TYPE, scheduleType)?.let { template ->
            templateDao.getTemplateItems(template.id)
                .map { TemplateItem(it.id, it.text, it.sortOrder) }
        } ?: emptyList()

        return generator.merge(roomItems, typeItems)
    }

    private fun normalize(text: String): String =
        text.trim().lowercase(Locale.ROOT)
}
