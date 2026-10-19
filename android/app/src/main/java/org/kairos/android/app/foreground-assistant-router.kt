package org.kairos.android.app

/** A visible activity owns this callback; stopped/destroyed activities cannot receive gestures. */
class ForegroundAssistantRouter {
    private var owner: Any? = null
    private var openNewChat: (() -> Unit)? = null

    fun register(owner: Any, openNewChat: () -> Unit) {
        this.owner = owner
        this.openNewChat = openNewChat
    }

    fun unregister(owner: Any) {
        if (this.owner === owner) {
            this.owner = null
            openNewChat = null
        }
    }

    fun route(): Boolean {
        val action = openNewChat ?: return false
        action()
        return true
    }
}
