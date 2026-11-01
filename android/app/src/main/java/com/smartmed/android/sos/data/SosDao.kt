package com.smartmed.android.sos.data

import androidx.room.Dao
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query
import androidx.room.Update

/**
 * SosDao
 *
 * Data Access Object for local offline SOS emergency operations.
 */
@Dao
interface SosDao {

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insertSosEvent(event: SosEvent): Long

    @Query("SELECT * FROM sos_emergency_events ORDER BY timestampMillis DESC LIMIT 1")
    suspend fun getLatestSosEvent(): SosEvent?

    @Query("SELECT * FROM sos_emergency_events WHERE isSynced = 0 ORDER BY timestampMillis ASC")
    suspend fun getUnsyncedEvents(): List<SosEvent>

    @Query("UPDATE sos_emergency_events SET status = :status, callStatus = :callStatus WHERE id = :id")
    suspend fun updateCallStatus(id: Long, status: String, callStatus: String)

    @Query("UPDATE sos_emergency_events SET isSynced = 1, isDelivered = :isDelivered WHERE id = :id")
    suspend fun markSynced(id: Long, isDelivered: Boolean)

    @Update
    suspend fun update(event: SosEvent)
}
