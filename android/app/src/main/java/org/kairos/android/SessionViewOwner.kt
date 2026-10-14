package org.kairos.android

import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleOwner
import androidx.lifecycle.LifecycleRegistry
import androidx.lifecycle.ViewModelStore
import androidx.lifecycle.ViewModelStoreOwner
import androidx.savedstate.SavedStateRegistry
import androidx.savedstate.SavedStateRegistryController
import androidx.savedstate.SavedStateRegistryOwner

/** VoiceInteractionSession supplies none of the AndroidX view-tree owners Compose expects. */
class SessionViewOwner : LifecycleOwner, SavedStateRegistryOwner, ViewModelStoreOwner {
    private val registry = LifecycleRegistry(this)
    private val state = SavedStateRegistryController.create(this)
    override val lifecycle: Lifecycle get() = registry
    override val savedStateRegistry: SavedStateRegistry get() = state.savedStateRegistry
    override val viewModelStore = ViewModelStore()

    init {
        state.performAttach()
        state.performRestore(null)
    }
    fun create() { registry.handleLifecycleEvent(Lifecycle.Event.ON_CREATE) }
    fun show() { registry.currentState = Lifecycle.State.RESUMED }
    fun hide() { registry.currentState = Lifecycle.State.CREATED }
    fun destroy() { registry.currentState = Lifecycle.State.DESTROYED; viewModelStore.clear() }
}
