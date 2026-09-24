package com.smartmed.android.reminder.call.ui

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import android.widget.Button
import android.widget.EditText
import android.widget.TextView
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat
import androidx.lifecycle.lifecycleScope
import com.smartmed.android.reminder.call.R
import com.smartmed.android.reminder.call.activity.CallTrampolineActivity
import com.smartmed.android.reminder.call.alarm.AlarmScheduler
import com.smartmed.android.reminder.call.data.AppDatabase
import com.smartmed.android.reminder.call.data.ScheduledCall
import com.smartmed.android.reminder.call.data.ScheduledCallRepository
import kotlinx.coroutines.launch
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/**
 * MainActivity
 *
 * Test and demonstration harness for the offline native call reminder module.
 * Allows scheduling calls in 10s or 30s, verifying exact alarms under Doze mode,
 * observing Room DB updates in real time, and validating CALL_PHONE execution.
 */
class MainActivity : AppCompatActivity() {

    private lateinit var repository: ScheduledCallRepository
    private lateinit var scheduler: AlarmScheduler

    private lateinit var tvStatus: TextView
    private lateinit var tvAlarmsList: TextView
    private lateinit var etPhoneNumber: EditText
    private lateinit var etMedicineName: EditText
    private lateinit var btnRequestPermissions: Button
    private lateinit var btnSchedule10s: Button
    private lateinit var btnSchedule30s: Button
    private lateinit var btnImmediateCall: Button

    companion object {
        private const val PERMISSION_REQUEST_CODE = 1001
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)

        val db = AppDatabase.getInstance(this)
        repository = ScheduledCallRepository(db.scheduledCallDao())
        scheduler = AlarmScheduler(this)

        initViews()
        setupListeners()
        observeDatabaseFlow()
        updatePermissionStatus()
    }

    private fun initViews() {
        tvStatus = findViewById(R.id.tvStatus)
        tvAlarmsList = findViewById(R.id.tvAlarmsList)
        etPhoneNumber = findViewById(R.id.etPhoneNumber)
        etMedicineName = findViewById(R.id.etMedicineName)
        btnRequestPermissions = findViewById(R.id.btnRequestPermissions)
        btnSchedule10s = findViewById(R.id.btnSchedule10s)
        btnSchedule30s = findViewById(R.id.btnSchedule30s)
        btnImmediateCall = findViewById(R.id.btnImmediateCall)
    }

    private fun setupListeners() {
        btnRequestPermissions.setOnClickListener {
            requestRequiredPermissions()
        }

        btnSchedule10s.setOnClickListener {
            scheduleCallInSeconds(10)
        }

        btnSchedule30s.setOnClickListener {
            scheduleCallInSeconds(30)
        }

        btnImmediateCall.setOnClickListener {
            val phone = etPhoneNumber.text.toString().trim()
            if (phone.isBlank()) {
                Toast.makeText(this, "Please enter a phone number first", Toast.LENGTH_SHORT).show()
                return@setOnClickListener
            }
            val intent = Intent(this, CallTrampolineActivity::class.java).apply {
                putExtra(AlarmScheduler.EXTRA_PHONE_NUMBER, phone)
                putExtra(AlarmScheduler.EXTRA_CALL_ID, 99999L)
            }
            startActivity(intent)
        }
    }

    private fun scheduleCallInSeconds(seconds: Int) {
        val phone = etPhoneNumber.text.toString().trim()
        val medicine = etMedicineName.text.toString().trim()

        if (phone.isBlank()) {
            Toast.makeText(this, "Please enter a phone number", Toast.LENGTH_SHORT).show()
            return
        }

        val targetTime = System.currentTimeMillis() + (seconds * 1000L)
        val newCall = ScheduledCall(
            phoneNumber = phone,
            medicineName = medicine.ifBlank { "Prescription Reminder" },
            scheduledTimeMillis = targetTime,
            isActive = true
        )

        lifecycleScope.launch {
            // 1. Insert into Room DB to obtain unique primary key ID
            val insertedId = repository.insertCall(newCall)
            val persistedCall = newCall.copy(id = insertedId)

            // 2. Schedule with AlarmManager
            val success = scheduler.scheduleExactCall(persistedCall)

            val statusMsg = if (success) {
                "Alarm scheduled for ${persistedCall.phoneNumber} in $seconds seconds!"
            } else {
                "Exact alarm restricted. Scheduled fallback or exact permission needed."
            }

            Toast.makeText(this@MainActivity, statusMsg, Toast.LENGTH_LONG).show()
            tvStatus.text = "Status: $statusMsg"
        }
    }

    private fun observeDatabaseFlow() {
        lifecycleScope.launch {
            repository.allCallsFlow.collect { calls ->
                if (calls.isEmpty()) {
                    tvAlarmsList.text = "No scheduled calls in Room database."
                } else {
                    val sdf = SimpleDateFormat("HH:mm:ss dd-MMM", Locale.getDefault())
                    val sb = StringBuilder()
                    for (c in calls) {
                        val status = if (c.isActive) "ACTIVE [PENDING]" else "INACTIVE [TRIGGERED]"
                        sb.append("#${c.id} | ${c.phoneNumber}\n")
                        sb.append("   Med: ${c.medicineName}\n")
                        sb.append("   Time: ${sdf.format(Date(c.scheduledTimeMillis))}\n")
                        sb.append("   Status: $status\n\n")
                    }
                    tvAlarmsList.text = sb.toString().trimEnd()
                }
            }
        }
    }

    private fun updatePermissionStatus() {
        val hasCall = ContextCompat.checkSelfPermission(
            this,
            Manifest.permission.CALL_PHONE
        ) == PackageManager.PERMISSION_GRANTED

        val canExact = scheduler.canScheduleExactAlarms()

        tvStatus.text = "Status: CALL_PHONE=${if (hasCall) "GRANTED" else "DENIED"} | EXACT_ALARM=${if (canExact) "GRANTED" else "DENIED"}"
    }

    private fun requestRequiredPermissions() {
        val permissionsToRequest = mutableListOf<String>()

        if (ContextCompat.checkSelfPermission(this, Manifest.permission.CALL_PHONE) != PackageManager.PERMISSION_GRANTED) {
            permissionsToRequest.add(Manifest.permission.CALL_PHONE)
        }

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            if (ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
                permissionsToRequest.add(Manifest.permission.POST_NOTIFICATIONS)
            }
        }

        if (permissionsToRequest.isNotEmpty()) {
            ActivityCompat.requestPermissions(
                this,
                permissionsToRequest.toTypedArray(),
                PERMISSION_REQUEST_CODE
            )
        }

        // Exact Alarm permission (API 31+) requires Settings activity if not granted
        if (!scheduler.canScheduleExactAlarms()) {
            scheduler.requestExactAlarmPermission()
        }
    }

    override fun onRequestPermissionsResult(
        requestCode: Int,
        permissions: Array<out String>,
        grantResults: IntArray
    ) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        updatePermissionStatus()
    }

    override fun onResume() {
        super.onResume()
        updatePermissionStatus()
    }
}
