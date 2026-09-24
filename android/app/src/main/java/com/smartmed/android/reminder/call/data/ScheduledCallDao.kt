package com.smartmed.android.reminder.call.data

import androidx.room.Dao
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query
import androidx.room.Update
import kotlinx.coroutines.flow.Flow

/**
 * ScheduledCallDao
 *
 * Provides CRUD operations for offline scheduled call reminders.
 * Supports asynchronous coroutine operations and real-time reactive Flow observation.
 */
@Dao
interface ScheduledCallDao {

    /**
     * Insert a new scheduled call.
     * @return The auto-generated row ID (used as PendingIntent requestCode).
     */
    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insert(call: ScheduledCall): Long

    /**
     * Update an existing scheduled call record.
     */
    @Update
    suspend fun update(call: ScheduledCall)

    /**
     * Mark a scheduled call inactive once triggered or acknowledged.
     */
    @Query("UPDATE scheduled_calls SET isActive = 0 WHERE id = :id")
    suspend fun markInactive(id: Long)

    /**
     * Retrieve a specific call by its primary key.
     */
    @Query("SELECT * FROM scheduled_calls WHERE id = :id LIMIT 1")
    suspend fun getById(id: Long): ScheduledCall?

    /**
     * Query all active calls scheduled in the future.
     * Crucial for re-registering AlarmManager alarms upon device reboot (BOOT_COMPLETED).
     */
    @Query("SELECT * FROM scheduled_calls WHERE isActive = 1 AND scheduledTimeMillis > :nowEpochMillis ORDER BY scheduledTimeMillis ASC")
    suspend fun getActiveFutureCalls(nowEpochMillis: Long = System.currentTimeMillis()): List<ScheduledCall>

    /**
     * Observe all scheduled calls reactive to database changes.
     */
    @Query("SELECT * FROM scheduled_calls ORDER BY scheduledTimeMillis DESC")
    fun getAllCallsFlow(): Flow<List<ScheduledCall>>

    /**
     * Delete a scheduled call permanently.
     */
    @Query("DELETE FROM scheduled_calls WHERE id = :id")
    suspend fun deleteById(id: Long)
}
