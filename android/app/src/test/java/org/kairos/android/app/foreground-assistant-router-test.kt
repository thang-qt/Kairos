package org.kairos.android.app

import org.junit.Assert.*
import org.junit.Test

class ForegroundAssistantRouterTest {
    @Test fun onlyVisibleOwnerReceivesGesture() {
        val router = ForegroundAssistantRouter()
        val first = Any()
        val second = Any()
        var opened = 0
        assertFalse(router.route())
        router.register(first) { opened += 1 }
        router.register(second) { opened += 10 }
        router.unregister(first)
        assertTrue(router.route())
        assertEquals(10, opened)
        router.unregister(second)
        assertFalse(router.route())
    }
}
