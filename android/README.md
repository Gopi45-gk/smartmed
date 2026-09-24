# SmartMed Android - Offline Scheduled Native Call Module

A self-contained, offline native telephone call reminder module in Kotlin for Android (API 26 to API 34+). It automatically schedules, persists, and places a direct native phone call (`Intent.ACTION_CALL`) at a scheduled time, even if the application is killed, running in the background, or the device was restarted.

---

## Module Architecture

```
android/app/src/main/
├── AndroidManifest.xml
└── java/com/smartmed/android/reminder/call/
    ├── data/
    │   ├── ScheduledCall.kt           # Room Entity (id, phone, scheduledTimeMillis, isActive)
    │   ├── ScheduledCallDao.kt        # Room DAO with coroutines & Flow
    │   ├── AppDatabase.kt             # Thread-safe RoomDatabase Singleton
    │   └── ScheduledCallRepository.kt # Repository abstraction layer
    ├── alarm/
    │   └── AlarmScheduler.kt          # setExactAndAllowWhileIdle() + API 31+ permissions
    ├── receiver/
    │   ├── CallAlarmReceiver.kt       # BroadcastReceiver on RTC_WAKEUP -> starts Trampoline
    │   └── BootReceiver.kt            # Re-registers alarms on BOOT_COMPLETED
    └── activity/
        └── CallTrampolineActivity.kt  # Zero-UI translucent activity executing ACTION_CALL
```

---

## Key Technical Details

1. **Exact Alarms & Doze Mode (`AlarmManager.setExactAndAllowWhileIdle`)**:
   - Uses `RTC_WAKEUP` to wake the device CPU from low-power Doze state.
   - Enforces `AlarmManager.canScheduleExactAlarms()` on Android 12+ (API 31+). If denied, gracefully falls back to `setAndAllowWhileIdle()` and provides `requestExactAlarmPermission()` targeting `Settings.ACTION_REQUEST_SCHEDULE_EXACT_ALARM`.

2. **Persistence & PendingIntent Uniqueness**:
   - Every reminder is stored in the offline Room database (`smartmed_scheduled_calls.db`).
   - The auto-generated Room `id` is used as the unique `requestCode` for each `PendingIntent`.

3. **Background Trampoline Architecture**:
   - Android prohibits `BroadcastReceivers` from launching calls directly and strictly restricts background activity starts.
   - `CallAlarmReceiver` marks the call as inactive in Room using `goAsync()`, acquires a transient `WakeLock`, and dispatches `CallTrampolineActivity` with `FLAG_ACTIVITY_NEW_TASK`.
   - `CallTrampolineActivity` is styled with `@android:style/Theme.Translucent.NoTitleBar`, configures `showWhenLocked` and `turnScreenOn`, executes `Intent.ACTION_CALL` (or gracefully degrades to `Intent.ACTION_DIAL`), and calls `finish()` immediately.

4. **Reboot Recovery**:
   - `BootReceiver` intercepts `ACTION_BOOT_COMPLETED`, `ACTION_LOCKED_BOOT_COMPLETED`, and `ACTION_MY_PACKAGE_REPLACED`.
   - Queries `ScheduledCallDao.getActiveFutureCalls()` and restores every pending exact alarm without user intervention.

---

## Quick Usage Example

```kotlin
import com.smartmed.android.reminder.call.alarm.AlarmScheduler
import com.smartmed.android.reminder.call.data.AppDatabase
import com.smartmed.android.reminder.call.data.ScheduledCall
import com.smartmed.android.reminder.call.data.ScheduledCallRepository
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch

// 1. Initialize Database & Scheduler
val db = AppDatabase.getInstance(context)
val repository = ScheduledCallRepository(db.scheduledCallDao())
val scheduler = AlarmScheduler(context)

// 2. Schedule a Native Call for 10 minutes from now
val triggerTime = System.currentTimeMillis() + 10 * 60 * 1000L
val callReminder = ScheduledCall(
    phoneNumber = "+919876543210",
    medicineName = "Metformin 500mg (After Breakfast)",
    scheduledTimeMillis = triggerTime
)

CoroutineScope(Dispatchers.Main).launch {
    // Save in Room DB to obtain unique primary key ID
    val id = repository.insertCall(callReminder)
    val persistedCall = callReminder.copy(id = id)

    // Schedule exact alarm with AlarmManager
    val scheduled = scheduler.scheduleExactCall(persistedCall)
    if (!scheduled && !scheduler.canScheduleExactAlarms()) {
        // Prompt user to grant exact alarm permission
        scheduler.requestExactAlarmPermission()
    }
}
```
