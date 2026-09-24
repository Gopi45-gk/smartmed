package com.smartmed.android.reminder.call.receiver

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.util.Log
import com.smartmed.android.reminder.call.alarm.AlarmScheduler
import com.smartmed.android.reminder.call.data.AppDatabase
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch

/**
 * BootReceiver
 *
 * Automatically restores and re-registers all scheduled offline phone call alarms
 * with AlarmManager after device reboot or application package replacement.
 *
 * Handled System Actions:
 * - Intent.ACTION_BOOT_COMPLETED
 * - Intent.ACTION_LOCKED_BOOT_COMPLETED
 * - Intent.ACTION_MY_PACKAGE_REPLACED
 * - "android.intent.action.QUICKBOOT_POWERON" (HTC / Xiaomi / OEM devices)
 * - "com.htc.intent.action.QUICKBOOT_POWERON"
 */
class BootReceiver : BroadcastReceiver() {

    companion object {
        private const val TAG = "SmartMedBootReceiver"
    }

    override fun onReceive(context: Context, intent: Intent) {
        val action = intent.action
        Log.i(TAG, "Device boot/restart event received: $action")

        val isBootAction = action == Intent.ACTION_BOOT_COMPLETED ||
                action == Intent.ACTION_LOCKED_BOOT_COMPLETED ||
                action == Intent.ACTION_MY_PACKAGE_REPLACED ||
                action == "android.intent.action.QUICKBOOT_POWERON" ||
                action == "com.htc.intent.action.QUICKBOOT_POWERON"

        if (!isBootAction) {
            return
        }

        val pendingResult = goAsync()

        CoroutineScope(Dispatchers.IO).launch {
            try {
                val db = AppDatabase.getInstance(context)
                val dao = db.scheduledCallDao()
                val scheduler = AlarmScheduler(context)

                val now = System.currentTimeMillis()
                val futureCalls = dao.getActiveFutureCalls(now)

                Log.i(TAG, "Restoring ${futureCalls.size} scheduled calls after reboot...")

                var restoredCount = 0
                for (call in futureCalls) {
                    val success = scheduler.scheduleExactCall(call)
                    if (success) {
                        restoredCount++
                    }
                }

                Log.i(TAG, "Successfully re-registered $restoredCount/${futureCalls.size} native calls.")

            } catch (e: Exception) {
                Log.e(TAG, "Error restoring alarms on boot", e)
            } finally {
                pendingResult.finish()
            }
        }
    }
}
