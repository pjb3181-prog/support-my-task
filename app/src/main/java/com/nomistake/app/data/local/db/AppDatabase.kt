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
    version = 2,
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

        /**
         * v1 → v2 (Phase 5): events 테이블을 source-neutral 구조로 변경.
         *
         * - sourceType + sourceEventId unique identity 추가 (신규 컬럼)
         * - graphImmutableId/eventType: NOT NULL → nullable (Firestore 이벤트에는 없는 값)
         * - seriesKeyHash/occurrenceKeyHash 추가 (Firestore 전용 보조 필드)
         *
         * 기존(v1, Graph) 행은 sourceType='GRAPH', sourceEventId=graphImmutableId로 마이그레이션
         * 되며 PK(id)를 유지한다 → 기존 Checklist/eventId 참조 보존.
         * fallbackToDestructiveMigration 미사용 — 데이터/스키마 모두 정상 경로로 보존.
         */
        val MIGRATION_1_2: Migration = object : Migration(1, 2) {
            override fun migrate(db: SupportSQLiteDatabase) {
                // Room이 생성할 v2 스키마와 동일한 구조로 임시 테이블 생성.
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
                // 기존 행 복사: Graph 이벤트 → sourceType='GRAPH', sourceEventId=graphImmutableId.
                // PK(id)를 그대로 유지해 Checklist의 eventId 참조가 끊어지지 않게 한다.
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
                // 인덱스 재생성 (Room v2 스키마와 동일한 이름/구조).
                db.execSQL("CREATE UNIQUE INDEX IF NOT EXISTS `index_events_sourceType_sourceEventId` ON `events` (`sourceType`, `sourceEventId`)")
                db.execSQL("CREATE UNIQUE INDEX IF NOT EXISTS `index_events_graphImmutableId` ON `events` (`graphImmutableId`)")
                db.execSQL("CREATE INDEX IF NOT EXISTS `index_events_iCalUId` ON `events` (`iCalUId`)")
                db.execSQL("CREATE INDEX IF NOT EXISTS `index_events_seriesMasterId` ON `events` (`seriesMasterId`)")
                db.execSQL("CREATE INDEX IF NOT EXISTS `index_events_startTime` ON `events` (`startTime`)")
            }
        }
    }
}
