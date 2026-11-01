package com.smartmed.android.sos.data

import androidx.room.Entity
import androidx.room.PrimaryKey

/**
 * SosEvent Entity
 *
 * Offline-first persistent storage for SOS emergency triggers on native Android.
 * Records emergency events locally and marks them for network synchronization.
 */
@Entity(tableName = "sos_emergency_events")
data class SosEvent(
    @PrimaryKey(autoGenerate = true)
    val id: Long = 0L,
    val emergencyUuid: String,
    val patientName: String,
    val patientPhone: String,
    val caregiverPhone: String,
    val caregiverName: String,
    val status: String = "SOS_INITIATED",
    val callStatus: String = "NOT_INITIATED",
    val isDelivered: Boolean = false,
    val isSynced: Boolean = false,
    val latitude: Double? = null,
    val longitude: Double? = null,
    val timestampMillis: Long = System.currentTimeMillis(),
    val resolvedAtMillis: Long? = null
)
