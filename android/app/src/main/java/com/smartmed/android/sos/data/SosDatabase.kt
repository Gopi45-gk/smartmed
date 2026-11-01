package com.smartmed.android.sos.data

import android.content.Context
import androidx.room.Database
import androidx.room.Room
import androidx.room.RoomDatabase

/**
 * SosDatabase
 *
 * Isolated, non-breaking Room database singleton for SmartMed Emergency SOS events.
 */
@Database(
    entities = [SosEvent::class],
    version = 1,
    exportSchema = false
)
abstract class SosDatabase : RoomDatabase() {

    abstract fun sosDao(): SosDao

    companion object {
        @Volatile
        private var INSTANCE: SosDatabase? = null

        fun getInstance(context: Context): SosDatabase {
            return INSTANCE ?: synchronized(this) {
                val instance = Room.databaseBuilder(
                    context.applicationContext,
                    SosDatabase::class.java,
                    "smartmed_sos_emergency.db"
                )
                    .fallbackToDestructiveMigration()
                    .build()
                INSTANCE = instance
                instance
            }
        }
    }
}
