package com.smartmed.android.reminder.call.alarm

import android.app.AlarmManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.provider.Settings
import android.util.Log
import com.smartmed.android.reminder.call.data.ScheduledCall
import com.smartmed.android.reminder.call.receiver.CallAlarmReceiver

/**
 * AlarmScheduler
 *
 * Schedules exact, offline native call alarms using Android's AlarmManager.
 * Complies with Android 12+ (API 31+) and Android 13+ (API 33+) exact alarm and Doze restrictions.
 */
class AlarmScheduler(private val context: Context) {

    private val alarmManager: AlarmManager? =
        context.getSystemService(Context.ALARM_SERVICE) as? AlarmManager

    companion object {
        private const val TAG = "SmartMedAlarmScheduler"
        const val ACTION_SCHEDULED_CALL_ALARM = "com.smartmed.android.reminder.call.ACTION_TRIGGER_CALL"
        const val EXTRA_CALL_ID = "extra_call_id"
        const val EXTRA_PHONE_NUMBER = "extra_phone_number"
        const val EXTRA_MEDICINE_NAME = "extra_medicine_name"
    }

    /**
     * Check if the application currently has permission to schedule exact alarms (API 31+).
     */
    fun canScheduleExactAlarms(): Boolean {
        return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            alarmManager?.canScheduleExactAlarms() ?: false
        } else {
            true
        }
    }

    /**
     * Launch system settings prompt for the user to grant SCHEDULE_EXACT_ALARM permission (API 31+).
     */
    fun requestExactAlarmPermission() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S && !canScheduleExactAlarms()) {
            val intent = Intent(Settings.ACTION_REQUEST_SCHEDULE_EXACT_ALARM).apply {
                data = Uri.parse("package:${context.packageName}")
                flags = Intent.FLAG_ACTIVITY_NEW_TASK
            }
            context.startActivity(intent)
        }
    }

    /**
     * Schedule an exact native phone call trigger at the specified time.
     * Uses Room `call.id` as the PendingIntent `requestCode` to guarantee uniqueness.
     *
     * @param call The ScheduledCall entity containing id, phone number, and scheduled Epoch millis.
     * @return True if scheduled exactly, false if scheduled with inexact fallback.
     */
    fun scheduleExactCall(call: ScheduledCall): Boolean {
        if (alarmManager == null) {
            Log.e(TAG, "AlarmManager service is unavailable on this device")
            return false
        }

        if (call.scheduledTimeMillis <= System.currentTimeMillis()) {
            Log.w(TAG, "Scheduled time (${call.scheduledTimeMillis}) is in the past. Skipping.")
            return false
        }

        val intent = Intent(context, CallAlarmReceiver::class.java).apply {
            action = ACTION_SCHEDULED_CALL_ALARM
            putExtra(EXTRA_CALL_ID, call.id)
            putExtra(EXTRA_PHONE_NUMBER, call.phoneNumber)
            putExtra(EXTRA_MEDICINE_NAME, call.medicineName)
        }

        // Room ID is used as unique requestCode
        val requestCode = (call.id and 0x7FFFFFFF).toInt()
        val flags = PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE

        val pendingIntent = PendingIntent.getBroadcast(
            context,
            requestCode,
            intent,
            flags
        )

        val targetEpochMillis = call.scheduledTimeMillis

        return if (canScheduleExactAlarms()) {
            try {
                // Must use setExactAndAllowWhileIdle for reliable trigger during Doze mode
                alarmManager.setExactAndAllowWhileIdle(
                    AlarmManager.RTC_WAKEUP,
                    targetEpochMillis,
                    pendingIntent
                )
                Log.i(TAG, "Exact alarm scheduled for call #${call.id} to ${call.phoneNumber} at $targetEpochMillis")
                true
            } catch (e: SecurityException) {
                Log.w(TAG, "SecurityException scheduling exact alarm. Falling back to inexact.", e)
                fallbackToInexact(targetEpochMillis, pendingIntent)
                false
            }
        } else {
            Log.w(TAG, "Exact alarm permission denied. Falling back to setAndAllowWhileIdle.")
            fallbackToInexact(targetEpochMillis, pendingIntent)
            false
        }
    }

    /**
     * Fallback for devices where exact alarm permission has not yet been granted.
     */
    private fun fallbackToInexact(triggerAtMillis: Long, pendingIntent: PendingIntent) {
        alarmManager?.setAndAllowWhileIdle(
            AlarmManager.RTC_WAKEUP,
            triggerAtMillis,
            pendingIntent
        )
    }

    /**
     * Cancel an existing scheduled call by Room ID.
     */
    fun cancelCall(callId: Long) {
        val intent = Intent(context, CallAlarmReceiver::class.java).apply {
            action = ACTION_SCHEDULED_CALL_ALARM
        }
        val requestCode = (callId and 0x7FFFFFFF).toInt()
        val pendingIntent = PendingIntent.getBroadcast(
            context,
            requestCode,
            intent,
            PendingIntent.FLAG_NO_CREATE or PendingIntent.FLAG_IMMUTABLE
        )

        if (pendingIntent != null) {
            alarmManager?.cancel(pendingIntent)
            pendingIntent.cancel()
            Log.i(TAG, "Cancelled alarm for call #$callId")
        }
    }
}
