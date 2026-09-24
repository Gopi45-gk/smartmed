package com.smartmed.android.reminder.call.activity

import android.Manifest
import android.app.Activity
import android.app.KeyguardManager
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.util.Log
import android.view.WindowManager
import androidx.core.content.ContextCompat
import com.smartmed.android.reminder.call.alarm.AlarmScheduler

/**
 * CallTrampolineActivity
 *
 * Invisible trampoline activity that transitions an AlarmManager trigger into a native phone call.
 * Uses `@android:style/Theme.Translucent.NoTitleBar` to ensure zero UI disruption.
 *
 * Background Execution Compliance:
 * - Direct BroadcastReceivers cannot call `Intent.ACTION_CALL` directly.
 * - This Activity handles screen wake-up, keyguard bypass, permission verification,
 *   and executes `Intent.ACTION_CALL` (or graceful fallback to `Intent.ACTION_DIAL`).
 * - Calls `finish()` immediately after dispatch.
 */
class CallTrampolineActivity : Activity() {

    companion object {
        private const val TAG = "SmartMedTrampoline"
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        // Ensure activity wakes up the device if the screen is locked
        setupLockscreenWake()

        val phoneNumber = intent.getStringExtra(AlarmScheduler.EXTRA_PHONE_NUMBER)
        val callId = intent.getLongExtra(AlarmScheduler.EXTRA_CALL_ID, -1L)

        Log.i(TAG, "CallTrampolineActivity launched for call #$callId (target: $phoneNumber)")

        if (!phoneNumber.isNullOrBlank()) {
            executeNativeCall(phoneNumber)
        } else {
            Log.e(TAG, "Missing or blank phone number in trampoline intent extras")
        }

        // Immediately close the invisible activity
        finish()
    }

    /**
     * Wakes the device and renders over the lockscreen if locked.
     */
    private fun setupLockscreenWake() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1) {
            setShowWhenLocked(true)
            setTurnScreenOn(true)
            val keyguardManager = getSystemService(Context.KEYGUARD_SERVICE) as? KeyguardManager
            keyguardManager?.requestDismissKeyguard(this, null)
        } else {
            @Suppress("DEPRECATION")
            window.addFlags(
                WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED or
                WindowManager.LayoutParams.FLAG_DISMISS_KEYGUARD or
                WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON or
                WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON
            )
        }
    }

    /**
     * Executes the normal native phone call.
     * Uses ACTION_CALL if CALL_PHONE permission is granted, otherwise degrades to ACTION_DIAL.
     */
    private fun executeNativeCall(phoneNumber: String) {
        val sanitizedNumber = phoneNumber.trim().replace(" ", "")
        val callUri = Uri.parse("tel:$sanitizedNumber")

        val hasCallPermission = ContextCompat.checkSelfPermission(
            this,
            Manifest.permission.CALL_PHONE
        ) == PackageManager.PERMISSION_GRANTED

        val intent = if (hasCallPermission) {
            Log.i(TAG, "CALL_PHONE permission is granted. Placing direct native phone call (ACTION_CALL).")
            Intent(Intent.ACTION_CALL, callUri)
        } else {
            Log.w(TAG, "CALL_PHONE permission is denied. Gracefully degrading to dialer (ACTION_DIAL).")
            Intent(Intent.ACTION_DIAL, callUri)
        }

        intent.flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP

        try {
            startActivity(intent)
        } catch (e: Exception) {
            Log.e(TAG, "Failed to launch phone call intent", e)
            // Final fallback to generic dialer
            try {
                val dialFallback = Intent(Intent.ACTION_DIAL, callUri).apply {
                    flags = Intent.FLAG_ACTIVITY_NEW_TASK
                }
                startActivity(dialFallback)
            } catch (dialErr: Exception) {
                Log.e(TAG, "Fallback ACTION_DIAL also failed", dialErr)
            }
        }
    }
}
