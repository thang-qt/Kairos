package org.kairos.android.app

import android.app.Application

class ChatApplication : Application() {
    lateinit var container: AppContainer
        private set

    val theme
        get() = container.preferences

    override fun onCreate() {
        super.onCreate()
        container = AppContainer(this)
    }
}
