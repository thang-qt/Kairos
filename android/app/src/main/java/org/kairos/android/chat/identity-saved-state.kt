package org.kairos.android.chat

import androidx.lifecycle.SavedStateHandle

/** Keeps restorable composer state scoped to the hashed identity that wrote it. */
internal object IdentitySavedState {
    const val DRAFTS_KEY = "conversationDrafts"
    const val NEW_CHAT_SETTINGS_KEY = "newChatSettings"
    const val SELECTED_CONVERSATION_KEY = "selectedConversation"
    const val IDENTITY_KEY = "savedStateIdentity"
    const val SELECTION_GENERATION_KEY = "selectionGeneration"

    fun canRestore(handle: SavedStateHandle, identity: String?): Boolean {
        val matches = identity != null && handle.get<String>(IDENTITY_KEY) == identity
        if (!matches) clear(handle)
        return matches
    }

    fun bind(handle: SavedStateHandle, identity: String?) {
        if (identity == null) handle.remove<String>(IDENTITY_KEY)
        else handle[IDENTITY_KEY] = identity
    }

    fun clear(handle: SavedStateHandle) {
        handle.remove<HashMap<String, String>>(DRAFTS_KEY)
        handle.remove<String>(NEW_CHAT_SETTINGS_KEY)
        handle.remove<String>(SELECTED_CONVERSATION_KEY)
        handle.remove<Int>(SELECTION_GENERATION_KEY)
        handle.remove<String>(IDENTITY_KEY)
    }
}
