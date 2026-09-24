package com.smartmed.android.reminder.call.receiver

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.os.PowerManager
import android.util.Log
import com.smartmed.android.reminder.call.activity.CallTrampolineActivity
import com.smartmed.android.reminder.call.alarm.AlarmScheduler
import com.smartmed.android.reminder.call.data.AppDatabase
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch

/**
 * CallAlarmReceiver
 *
 * BroadcastReceiver triggered by AlarmManager (setExactAndAllowWhileIdle).
 *
 * Execution Steps:
 * 1. Acquires a transient WakeLock to guarantee CPU stays active during processing.
 * 2. Uses `goAsync()` to mark the scheduled call as inactive in Room DB on Dispatchers.IO.
 * 3. Launches `CallTrampolineActivity` with `FLAG_ACTIVITY_NEW_TASK`.
 *
 * CRITICAL RULE:
 * This receiver NEVER calls `Intent.ACTION_CALL` directly, preventing background activity
 * start restrictions and IPC crashes on modern Android versions.
 */
class CallAlarmReceiver : BroadcastReceiver() {

    companion object {
        private const val TAG = "SmartMedAlarmReceiver"
        private const val WAKELOCK_TAG = "SmartMed:AlarmReceiverWakeLock"
        private const val WAKELOCK_TIMEOUT_MS = 10_000L // 10 seconds max
    }

    override fun onReceive(context: Context, intent: Intent) {
        val action = intent.action
        Log.i(TAG, "Alarm received with action: $action")

        if (action != AlarmScheduler.ACTION_SCHEDULED_CALL_ALARM) {
            return
        }

        val callId = intent.getLongExtra(AlarmScheduler.EXTRA_CALL_ID, -1L)
        val phoneNumber = intent.getStringExtra(AlarmScheduler.EXTRA_PHONE_NUMBER)
        val medicineName = intent.getStringExtra(AlarmScheduler.EXTRA_MEDICINE_NAME) ?: ""

        if (callId == -1L || phoneNumber.isNullOrBlank()) {
            Log.e(TAG, "Invalid alarm trigger data: callId=$callId, phone=$phoneNumber")
            return
        }

        val powerManager = context.getSystemService(Context.POWER_SERVICE) as? PowerManager
        val wakeLock = powerManager?.newWakeLock(
            PowerManager.PARTIAL_WAKE_LOCK,
            WAKELOCK_TAG
        )?.apply {
            acquire(WAKELOCK_TIMEOUT_MS)
        }

        // Asynchronous processing across receiver boundary
        val pendingResult = goAsync()

        CoroutineScope(Dispatchers.IO).launch {
            try {
                // 1. Mark call inactive in Room DB so it is not re-triggered
                val dao = AppDatabase.getInstance(context).scheduledCallDao()
                dao.markInactive(callId)
                Log.i(TAG, "Call #$callId marked inactive in database")

                // 2. Launch CallTrampolineActivity (DO NOT call ACTION_CALL directly here)
                val trampolineIntent = Intent(context, CallTrampolineActivity::class.java).apply {
                    putExtra(AlarmScheduler.EXTRA_CALL_ID, callId)
                    putExtra(AlarmScheduler.EXTRA_PHONE_NUMBER, phoneNumber)
                    putExtra(AlarmScheduler.EXTRA_MEDICINE_NAME, medicineName)
                    flags = Intent.FLAG_ACTIVITY_NEW_TASK or
                            Intent.FLAG_ACTIVITY_CLEAR_TOP or
                            Intent.FLAG_ACTIVITY_EXCLUDE_FROM_RECENTS
                }

                context.startActivity(trampolineIntent)
                Log.i(TAG, "Dispatched CallTrampolineActivity for call #$callId")

            } catch (e: Exception) {
                Log.e(TAG, "Error executing CallAlarmReceiver for call #$callId", e)
            } finally {
                wakeLock?.let {
                    if (it.isHeld) {
                        try {
                            it.release()
                        } catch (re: Exception) {
                            Log.w(TAG, "Error releasing wakeLock", re)
                        }
                    }
                }
                pendingResult.finish()
            }
        }
    }
}
