package com.smartmed.android.sos

import android.Manifest
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.util.Log
import androidx.core.content.ContextCompat
import com.smartmed.android.sos.data.SosDatabase
import com.smartmed.android.sos.data.SosEvent
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import java.util.UUID

/**
 * SosManager
 *
 * Native Android orchestrator for offline emergency calling,
 * Room event recording, and permission-compliant dialing.
 */
class SosManager(private val context: Context) {

    private val db = SosDatabase.getInstance(context)
    private val scope = CoroutineScope(Dispatchers.IO)

    companion object {
        private const val TAG = "SmartMedSosManager"
        const val EMERGENCY_AMBULANCE_NUMBER = "112"
    }

    /**
     * Activates native SOS workflow:
     * 1. Records emergency locally in Room DB.
     * 2. Places a native phone call to the caregiver via ACTION_CALL if permitted,
     *    or falls back safely to ACTION_DIAL.
     */
    fun triggerNativeSos(
        patientName: String,
        patientPhone: String,
        caregiverPhone: String,
        caregiverName: String,
        latitude: Double? = null,
        longitude: Double? = null,
        onCallLaunched: ((Boolean, String) -> Unit)? = null
    ) {
        val uuid = "sos-android-" + UUID.randomUUID().toString().take(8)

        scope.launch {
            val event = SosEvent(
                emergencyUuid = uuid,
                patientName = patientName,
                patientPhone = patientPhone,
                caregiverPhone = caregiverPhone,
                caregiverName = caregiverName,
                status = "SOS_INITIATED",
                callStatus = "INITIATING",
                isDelivered = false,
                isSynced = false,
                latitude = latitude,
                longitude = longitude
            )
            val insertedId = db.sosDao().insertSosEvent(event)
            Log.i(TAG, "Recorded offline SOS event in Room DB with ID: $insertedId")

            // Execute Call on Main Thread
            val hasCallPermission = ContextCompat.checkSelfPermission(
                context,
                Manifest.permission.CALL_PHONE
            ) == PackageManager.PERMISSION_GRANTED

            val targetNumber = caregiverPhone.ifEmpty { EMERGENCY_AMBULANCE_NUMBER }
            val cleanNumber = targetNumber.replace(" ", "").replace("-", "")

            try {
                val intent = if (hasCallPermission) {
                    Intent(Intent.ACTION_CALL).apply {
                        data = Uri.parse("tel:$cleanNumber")
                        flags = Intent.FLAG_ACTIVITY_NEW_TASK
                    }
                } else {
                    Log.w(TAG, "CALL_PHONE permission not granted; falling back to ACTION_DIAL")
                    Intent(Intent.ACTION_DIAL).apply {
                        data = Uri.parse("tel:$cleanNumber")
                        flags = Intent.FLAG_ACTIVITY_NEW_TASK
                    }
                }
                context.startActivity(intent)
                db.sosDao().updateCallStatus(insertedId, "CAREGIVER_CALL_INITIATED", "DIALED")
                onCallLaunched?.invoke(true, if (hasCallPermission) "ACTION_CALL" else "ACTION_DIAL")
            } catch (e: Exception) {
                Log.error(TAG, "Failed to launch native phone call intent: ${e.message}")
                db.sosDao().updateCallStatus(insertedId, "CALL_FAILED", "ERROR: ${e.message}")
                onCallLaunched?.invoke(false, e.message ?: "Call dispatch error")
            }
        }
    }

    /**
     * Dials India Emergency Services (112) directly.
     */
    fun dialEmergencyAmbulance() {
        try {
            val intent = Intent(Intent.ACTION_DIAL).apply {
                data = Uri.parse("tel:$EMERGENCY_AMBULANCE_NUMBER")
                flags = Intent.FLAG_ACTIVITY_NEW_TASK
            }
            context.startActivity(intent)
        } catch (e: Exception) {
            Log.e(TAG, "Failed to dial 112: ${e.message}")
        }
    }

    /**
     * Verifies required permissions for full offline voice & emergency features.
     */
    fun checkPermissions(): Map<String, Boolean> {
        return mapOf(
            Manifest.permission.CALL_PHONE to (ContextCompat.checkSelfPermission(context, Manifest.permission.CALL_PHONE) == PackageManager.PERMISSION_GRANTED),
            Manifest.permission.RECORD_AUDIO to (ContextCompat.checkSelfPermission(context, Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED),
            Manifest.permission.ACCESS_FINE_LOCATION to (ContextCompat.checkSelfPermission(context, Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED)
        )
    }
}
