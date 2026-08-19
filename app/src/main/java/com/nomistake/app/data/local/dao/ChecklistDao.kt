package com.nomistake.app.data.local.dao

import androidx.room.Dao
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query
import com.nomistake.app.data.local.entity.ChecklistEntity
import com.nomistake.app.data.local.entity.ChecklistItemEntity
import kotlinx.coroutines.flow.Flow
import java.time.Instant

@Dao
interface ChecklistDao {

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insertChecklist(checklist: ChecklistEntity): Long

    @Query("SELECT * FROM checklists WHERE eventId = :eventId LIMIT 1")
    suspend fun getByEventId(eventId: Long): ChecklistEntity?

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insertItems(items: List<ChecklistItemEntity>)

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insertItem(item: ChecklistItemEntity): Long

    @Query("SELECT * FROM checklist_items WHERE checklistId = :checklistId ORDER BY sortOrder ASC")
    fun observeItems(checklistId: Long): Flow<List<ChecklistItemEntity>>

    @Query("SELECT * FROM checklist_items WHERE checklistId = :checklistId AND isCompleted = 0 ORDER BY sortOrder ASC")
    fun observeIncompleteItems(checklistId: Long): Flow<List<ChecklistItemEntity>>

    @Query("UPDATE checklist_items SET isCompleted = :completed, completedAt = :completedAt WHERE id = :id")
    suspend fun setCompleted(id: Long, completed: Boolean, completedAt: Instant?)

    @Query("DELETE FROM checklist_items WHERE id = :id")
    suspend fun deleteItem(id: Long)
}
