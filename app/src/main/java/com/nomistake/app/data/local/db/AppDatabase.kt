package com.nomistake.app.data.local.db

import androidx.room.Database
import androidx.room.RoomDatabase
import androidx.room.TypeConverters
import androidx.room.migration.Migration
import androidx.sqlite.db.SupportSQLiteDatabase
import com.nomistake.app.data.local.dao.ChecklistDao
import com.nomistake.app.data.local.dao.EventDao
import com.nomistake.app.data.local.dao.SettingDao
import com.nomistake.app.data.local.dao.TemplateDao
import com.nomistake.app.data.local.entity.ChecklistEntity
import com.nomistake.app.data.local.entity.ChecklistItemEntity
import com.nomistake.app.data.local.entity.ChecklistTemplateEntity
import com.nomistake.app.data.local.entity.EventEntity
import com.nomistake.app.data.local.entity.NotificationRuleEntity
import com.nomistake.app.data.local.entity.ScheduleTypeRuleEntity
import com.nomistake.app.data.local.entity.SettingEntity
import com.nomistake.app.data.local.entity.TemplateItemEntity

@Database(
    entities = [
        EventEntity::class,
        ChecklistEntity::class,
        ChecklistItemEntity::class,
        ChecklistTemplateEntity::class,
        TemplateItemEntity::class,
        ScheduleTypeRuleEntity::class,
        NotificationRuleEntity::class,
        SettingEntity::class
    ],
    version = 3,
    exportSchema = true
)
@TypeConverters(Converters::class)
abstract class AppDatabase : RoomDatabase() {
    abstract fun eventDao(): EventDao
    abstract fun checklistDao(): ChecklistDao
    abstract fun templateDao(): TemplateDao
    abstract fun settingDao(): SettingDao

    companion object {
        const val DB_NAME = "nomistake.db"

        val MIGRATION_1_2: Migration = object : Migration(1, 2) {
            override fun migrate(db: SupportSQLiteDatabase) {
                db.execSQL(
                    """
                    CREATE TABLE IF NOT EXISTS `_new_events` (
                        `id` INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
                        `sourceType` TEXT NOT NULL,
                        `sourceEventId` TEXT NOT NULL,
                        `graphImmutableId` TEXT,
                        `iCalUId` TEXT,
                        `seriesMasterId` TEXT,
                        `eventType` TEXT,
                        `changeKey` TEXT,
                        `seriesKeyHash` TEXT,
                        `occurrenceKeyHash` TEXT,
                        `title` TEXT NOT NULL,
                        `cleanTitle` TEXT NOT NULL,
                        `roomType` TEXT,
                        `attendeeCode` TEXT,
                        `isMine` INTEGER NOT NULL,
                        `scheduleType` TEXT,
                        `isTarget` INTEGER NOT NULL,
                        `isAllDay` INTEGER NOT NULL,
                        `startTime` INTEGER NOT NULL,
                        `endTime` INTEGER NOT NULL,
                        `location` TEXT,
                        `isDeleted` INTEGER NOT NULL,
                        `lastSyncedAt` INTEGER NOT NULL
                    )
                    """.trimIndent()
                )
                db.execSQL(
                    """
                    INSERT INTO `_new_events` (
                        `id`, `sourceType`, `sourceEventId`, `graphImmutableId`, `iCalUId`,
                        `seriesMasterId`, `eventType`, `changeKey`, `seriesKeyHash`, `occurrenceKeyHash`,
                        `title`, `cleanTitle`, `roomType`, `attendeeCode`, `isMine`, `scheduleType`,
                        `isTarget`, `isAllDay`, `startTime`, `endTime`, `location`, `isDeleted`, `lastSyncedAt`
                    )
                    SELECT
                        `id`, 'GRAPH', `graphImmutableId`, `graphImmutableId`, `iCalUId`,
                        `seriesMasterId`, `eventType`, `changeKey`, NULL, NULL,
                        `title`, `cleanTitle`, `roomType`, `attendeeCode`, `isMine`, `scheduleType`,
                        `isTarget`, `isAllDay`, `startTime`, `endTime`, `location`, `isDeleted`, `lastSyncedAt`
                    FROM `events`
                    """.trimIndent()
                )
                db.execSQL("DROP TABLE `events`")
                db.execSQL("ALTER TABLE `_new_events` RENAME TO `events`")
                db.execSQL("CREATE UNIQUE INDEX IF NOT EXISTS `index_events_sourceType_sourceEventId` ON `events` (`sourceType`, `sourceEventId`)")
                db.execSQL("CREATE UNIQUE INDEX IF NOT EXISTS `index_events_graphImmutableId` ON `events` (`graphImmutableId`)")
                db.execSQL("CREATE INDEX IF NOT EXISTS `index_events_iCalUId` ON `events` (`iCalUId`)")
                db.execSQL("CREATE INDEX IF NOT EXISTS `index_events_seriesMasterId` ON `events` (`seriesMasterId`)")
                db.execSQL("CREATE INDEX IF NOT EXISTS `index_events_startTime` ON `events` (`startTime`)")
            }
        }

        /** v2 → v3: 관리자/책임자용 업무 단위 완료 상태 추가. 기존 상세 체크는 그대로 보존. */
        val MIGRATION_2_3: Migration = object : Migration(2, 3) {
            override fun migrate(db: SupportSQLiteDatabase) {
                db.execSQL("ALTER TABLE `checklists` ADD COLUMN `isCompleted` INTEGER NOT NULL DEFAULT 0")
                db.execSQL("ALTER TABLE `checklists` ADD COLUMN `completedAt` INTEGER")
            }
        }
    }
}
