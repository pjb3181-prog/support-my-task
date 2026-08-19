package com.nomistake.app.data.local.dao

import androidx.room.Dao
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query
import com.nomistake.app.data.local.entity.EventEntity
import kotlinx.coroutines.flow.Flow

@Dao
interface EventDao {

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsert(event: EventEntity): Long

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
}
