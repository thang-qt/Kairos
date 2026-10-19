package org.kairos.android.chat

import androidx.lifecycle.SavedStateHandle
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class IdentitySavedStateTest {
    @Test
    fun savedComposerStateRestoresOnlyForItsOriginalIdentity() {
        val handle =
            SavedStateHandle(
                mapOf(
                    IdentitySavedState.IDENTITY_KEY to "account-one-hash",
                    IdentitySavedState.DRAFTS_KEY to hashMapOf("__new_chat__" to "private draft"),
                    IdentitySavedState.NEW_CHAT_SETTINGS_KEY to "private system prompt",
                    IdentitySavedState.SELECTED_CONVERSATION_KEY to "session-one",
                    IdentitySavedState.SELECTION_GENERATION_KEY to 17,
                )
            )

        assertFalse(IdentitySavedState.canRestore(handle, "account-two-hash"))
        assertNull(handle.get<HashMap<String, String>>(IdentitySavedState.DRAFTS_KEY))
        assertNull(handle.get<String>(IdentitySavedState.NEW_CHAT_SETTINGS_KEY))
        assertNull(handle.get<String>(IdentitySavedState.SELECTED_CONVERSATION_KEY))
        assertNull(handle.get<Int>(IdentitySavedState.SELECTION_GENERATION_KEY))
        assertNull(handle.get<String>(IdentitySavedState.IDENTITY_KEY))

        IdentitySavedState.bind(handle, "account-two-hash")
        handle[IdentitySavedState.DRAFTS_KEY] = hashMapOf("__new_chat__" to "new draft")
        assertTrue(IdentitySavedState.canRestore(handle, "account-two-hash"))
        assertEquals(
            "new draft",
            handle.get<HashMap<String, String>>(IdentitySavedState.DRAFTS_KEY)?.get("__new_chat__"),
        )
    }
}
