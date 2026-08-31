package com.nomistake.app.data.local.dao

import androidx.room.Dao
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query
import androidx.room.Update
import com.nomistake.app.data.local.entity.EventEntity
import com.nomistake.app.domain.EventSource
import kotlinx.coroutines.flow.Flow

@Dao
interface EventDao {

    /**
     * 주의: REPLACE 전략이라 unique 충돌 시 기존 row가 삭제+재삽입되어
     * row id(PK)가 바뀐다. Checklist가 events.id(autoGenerate PK)를 참조하므로,
     * 동기화 재쓰기에는 이 메서드를 쓰지 않는다(아래 getBySource + insertIgnore/update 조합 사용).
     * 신규 1회성 insert 테스트 용도로만 유지한다.
     */
    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsert(event: EventEntity): Long

    /** 신규 insert. (sourceType, sourceEventId) unique 충돌 시 무시하고 -1 반환. */
    @Insert(onConflict = OnConflictStrategy.IGNORE)
    suspend fun insertIgnore(event: EventEntity): Long

    /** 기존 row를 PK 기준으로 갱신(행 유지 → id/checklist 참조 보존). */
    @Update
    suspend fun update(event: EventEntity)

    /** source-neutral identity 조회 (Phase 5 primary lookup). */
    @Query("SELECT * FROM events WHERE sourceType = :sourceType AND sourceEventId = :sourceEventId LIMIT 1")
    suspend fun getBySource(sourceType: EventSource, sourceEventId: String): EventEntity?

    @Query("SELECT * FROM events WHERE graphImmutableId = :immutableId LIMIT 1")
    suspend fun getByImmutableId(immutableId: String): EventEntity?

    @Query("SELECT * FROM events WHERE iCalUId = :iCalUId LIMIT 1")
    suspend fun getByICalUId(iCalUId: String): EventEntity?

    @Query("SELECT * FROM events WHERE id = :id LIMIT 1")
    suspend fun getById(id: Long): EventEntity?

    /** 활성 일정 목록(soft-delete 제외, target만). */
    @Query("SELECT * FROM events WHERE isDeleted = 0 AND isTarget = 1 ORDER BY startTime ASC")
    fun observeActiveEvents(): Flow<List<EventEntity>>

    @Query("SELECT * FROM events WHERE isDeleted = 0 AND isTarget = 1 AND startTime >= :from ORDER BY startTime ASC")
    suspend fun getActiveEventsFrom(from: Long): List<EventEntity>

    @Query("UPDATE events SET isDeleted = 1 WHERE id = :id")
    suspend fun softDelete(id: Long)

    @Query("UPDATE events SET isTarget = :isTarget WHERE id = :id")
    suspend fun setTarget(id: Long, isTarget: Boolean)

    @Query("SELECT COUNT(*) FROM events")
    suspend fun countAll(): Int
}
