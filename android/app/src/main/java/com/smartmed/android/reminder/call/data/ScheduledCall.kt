package com.smartmed.android.reminder.call.data

import androidx.room.Entity
import androidx.room.PrimaryKey

/**
 * ScheduledCall Entity
 *
 * Represents a scheduled native phone call reminder stored in the offline Room Database.
 * The `id` is auto-generated and serves as the unique `requestCode` for Android AlarmManager PendingIntents.
 *
 * @param id Unique primary key identifier used for PendingIntent uniqueness.
 * @param phoneNumber The destination E.164 or local phone number to place the native call to.
 * @param medicineName Name of the medicine/prescription for this reminder (e.g., "Metformin 500mg").
 * @param scheduledTimeMillis Target execution timestamp in Epoch milliseconds (System.currentTimeMillis()).
 * @param isActive Flag indicating if the reminder is active (true) or has already triggered/cancelled (false).
 * @param createdAt Creation timestamp in Epoch milliseconds.
 */
@Entity(tableName = "scheduled_calls")
data class ScheduledCall(
    @PrimaryKey(autoGenerate = true)
    val id: Long = 0L,
    val phoneNumber: String,
    val medicineName: String = "",
    val scheduledTimeMillis: Long,
    val isActive: Boolean = true,
    val createdAt: Long = System.currentTimeMillis()
)
