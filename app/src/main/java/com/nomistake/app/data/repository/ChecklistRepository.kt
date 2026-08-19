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

/**
 * Event → Checklist 생성/병합 오케스트레이션.
 *
 * - [EventEntity.isTarget] == false → no-op (null 반환, Checklist/Item 생성 안 함)
 * - 이미 Checklist 존재 → 기존 id 반환 (재생성 금지, completed/사용자 항목 보존)
 * - 최초 target → ROOM + TYPE 템플릿 조회 → 병합 → Checklist + ChecklistItem을
 *   단일 transaction으로 생성
 *
 * Template은 기준값일 뿐이며, 실제 일정에는 복사본(ChecklistItem)을 생성한다.
 * 템플릿 수정은 신규 일정에만 적용되고 기존 Checklist는 독립적으로 유지된다.
 */
class ChecklistRepository(
    private val checklistDao: ChecklistDao,
    private val templateDao: TemplateDao,
    private val generator: ChecklistGenerator = ChecklistGenerator()
) {

    /**
     * 주어진 Event에 대해 Checklist를 보장한다.
     *
     * @return Checklist id (기존 또는 신규). isTarget=false면 null.
     */
    suspend fun ensureChecklist(event: EventEntity): Long? {
        if (!event.isTarget) return null

        // Idempotency: 동일 eventId에 Checklist가 이미 있으면 재생성하지 않는다.
        checklistDao.getByEventId(event.id)?.let { return it.id }

        val scheduleType = event.scheduleType ?: EventTitleParser.DEFAULT_SCHEDULE_TYPE

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

        val merged = generator.merge(roomItems, typeItems)

        val checklist = ChecklistEntity(
            eventId = event.id,
            scheduleType = scheduleType,
            createdAt = Instant.now()
        )
        val items = merged.map { m ->
            ChecklistItemEntity(
                checklistId = 0, // transaction 내부에서 실제 id로 교체
                text = m.text,
                sortOrder = m.sortOrder,
                origin = ItemOrigin.TEMPLATE_COPY,
                templateItemId = m.templateItemId
            )
        }

        return checklistDao.createChecklistWithItems(checklist, items)
    }
}
