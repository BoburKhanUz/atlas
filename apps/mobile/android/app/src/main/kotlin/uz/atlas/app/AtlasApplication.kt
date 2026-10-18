package uz.atlas.app

import android.app.Application

class AtlasApplication : Application() {
    override fun onCreate() {
        super.onCreate()
        // Before anything else can crash.
        CrashRecords.install(this)
    }
}
