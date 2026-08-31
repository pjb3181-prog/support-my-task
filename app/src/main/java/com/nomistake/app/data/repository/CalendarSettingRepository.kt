package com.nomistake.app.data.repository

import com.nomistake.app.data.local.dao.SettingDao
import com.nomistake.app.data.local.entity.SettingEntity

/**
 * 선택된 Calendar(selectedCalendarId / selectedCalendarName)를 Setting DB에 저장/조회한다.
 */
class CalendarSettingRepository(private val settingDao: SettingDao) {

    suspend fun getSelectedCalendarId(): String? =
        settingDao.get(KEY_CALENDAR_ID)?.value

    suspend fun getSelectedCalendarName(): String? =
        settingDao.get(KEY_CALENDAR_NAME)?.value

    suspend fun saveSelectedCalendar(id: String, name: String) {
        settingDao.put(SettingEntity(KEY_CALENDAR_ID, id))
        settingDao.put(SettingEntity(KEY_CALENDAR_NAME, name))
    }

    companion object {
        const val KEY_CALENDAR_ID = "selectedCalendarId"
        const val KEY_CALENDAR_NAME = "selectedCalendarName"
    }
}
