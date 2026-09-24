package com.smartmed.android.reminder.call.data

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.withContext

/**
 * ScheduledCallRepository
 *
 * Repository pattern implementation abstracting Room Database calls onto Dispatchers.IO.
 */
class ScheduledCallRepository(private val dao: ScheduledCallDao) {

    val allCallsFlow: Flow<List<ScheduledCall>> = dao.getAllCallsFlow()

    suspend fun insertCall(call: ScheduledCall): Long = withContext(Dispatchers.IO) {
        dao.insert(call)
    }

    suspend fun markCallInactive(id: Long) = withContext(Dispatchers.IO) {
        dao.markInactive(id)
    }

    suspend fun getCallById(id: Long): ScheduledCall? = withContext(Dispatchers.IO) {
        dao.getById(id)
    }

    suspend fun getActiveFutureCalls(now: Long = System.currentTimeMillis()): List<ScheduledCall> = withContext(Dispatchers.IO) {
        dao.getActiveFutureCalls(now)
    }

    suspend fun deleteCall(id: Long) = withContext(Dispatchers.IO) {
        dao.deleteById(id)
    }
}
