package org.kairos.android.data

import java.nio.file.Files
import java.util.concurrent.atomic.AtomicInteger
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class CacheTest {
    private fun session(id: String, updatedAt: Long = 0, pinned: Boolean = false) =
        SessionSummary(friendlyId = id, updatedAt = updatedAt, isPinned = pinned)

    @Test
    fun diskCacheRoundTripsAndRejectsPathEscapes() {
        val root = Files.createTempDirectory("kairos-cache").toFile()
        val cache = DiskCache(root)
        cache.writeString("sessions.json", "{\"pages\":[]}")
        assertEquals("{\"pages\":[]}", cache.readString("sessions.json"))
        cache.delete("sessions.json")
        assertNull(cache.readString("sessions.json"))
        assertNull(cache.readString("../escape"))
        assertNull(cache.readString("."))
    }

    @Test
    fun queuedCacheWritesDoNotRestoreDataAfterIdentityChange() {
        val root = Files.createTempDirectory("kairos-cache-identity").toFile()
        val cache = DiskCache(root)
        val previousGeneration = cache.generation
        cache.writeString("sessions.json", "old", previousGeneration)
        cache.clear()
        cache.writeString("sessions.json", "stale", previousGeneration)
        assertNull(cache.readString("sessions.json"))
        cache.writeString("sessions.json", "new", cache.generation)
        assertEquals("new", cache.readString("sessions.json"))
    }

    @Test
    fun diskCacheEvictsLeastRecentlyWrittenFilesWithinBudget() {
        val root = Files.createTempDirectory("kairos-cache-lru").toFile()
        val cache = DiskCache(root, maxBytes = 120)
        cache.writeString("a.json", "x".repeat(60))
        cache.writeString("b.json", "y".repeat(60))
        cache.writeString("c.json", "z".repeat(60))
        root.resolve("a.json").setLastModified(1000)
        root.resolve("b.json").setLastModified(2000)
        root.resolve("c.json").setLastModified(3000)
        cache.enforceBudget()
        assertNull(cache.readString("a.json"))
        assertNotNull(cache.readString("b.json"))
        assertNotNull(cache.readString("c.json"))
    }

    @Test
    fun mergedDeduplicatesAndSortsPinnedFirst() {
        val list = SessionListCache()
        list.set(0, null, listOf(session("a", updatedAt = 5), session("b", updatedAt = 9)))
        list.append("cur1", listOf(session("c", updatedAt = 7), session("a", updatedAt = 5)), null)
        val merged = list.merged()
        assertEquals(listOf("b", "c", "a"), merged.map { it.friendlyId })
        // Raw page slots count duplicates; only the merged view deduplicates.
        assertEquals(4, list.loadedCount)
        assertEquals(2, list.pageCount)
    }

    @Test
    fun upsertReplacesInPlaceAndInsertsMissingIntoFirstPage() {
        val list = SessionListCache()
        list.set(0, null, listOf(session("a", updatedAt = 5)))
        list.append("cur1", listOf(session("b", updatedAt = 1)), null)
        list.upsert(session("b", updatedAt = 6, pinned = true))
        list.upsert(session("c", updatedAt = 2))
        assertEquals(listOf("b", "a", "c"), list.merged().map { it.friendlyId })
    }

    @Test
    fun removeClearsEveryPage() {
        val list = SessionListCache()
        list.set(0, null, listOf(session("a"), session("b")))
        list.append("cur1", listOf(session("c")), null)
        list.remove("b")
        assertEquals(listOf("a", "c"), list.merged().map { it.friendlyId })
    }

    @Test
    fun encodedRoundTripPreservesPagesCursorsAndNextCursor() {
        val list = SessionListCache()
        list.set(0, null, listOf(session("a", updatedAt = 2)))
        list.setNextCursor("cur1")
        list.append("cur1", listOf(session("b", updatedAt = 1)), "cur2")
        val restored = SessionListCache.decoded(list.encoded())
        assertEquals(2, restored.pageCount)
        assertEquals("cur1", restored.cursorFor(1))
        assertEquals("cur2", restored.nextCursor)
        assertEquals(listOf("a", "b"), restored.merged().map { it.friendlyId })
        // Degenerate payloads still produce a usable cache with an empty first page.
        assertEquals(1, SessionListCache.decoded("{}").pageCount)
        assertEquals(0, SessionListCache.decoded("{}").loadedCount)
    }

    @Test
    fun schedulerCoalescesNotificationsIntoOneRefresh() = runBlocking {
        val refreshes = AtomicInteger(0)
        val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
        val scheduler =
            RefreshScheduler(scope, { refreshes.incrementAndGet(); delay(100) }, debounceMillis = 50)
        scheduler.schedule()
        scheduler.schedule()
        scheduler.schedule()
        delay(400)
        assertEquals(1, refreshes.get())
        scheduler.dispose()
        scope.cancel()
    }

    @Test
    fun schedulerRefiresWhenChangesArriveDuringRefresh() = runBlocking {
        val refreshes = AtomicInteger(0)
        val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
        val scheduler =
            RefreshScheduler(scope, { refreshes.incrementAndGet(); delay(100) }, debounceMillis = 50)
        scheduler.schedule()
        // Arrives while the first refresh is running; must re-fire after it completes.
        delay(120)
        scheduler.schedule()
        delay(800)
        assertEquals(2, refreshes.get())
        scheduler.dispose()
        scope.cancel()
    }

    @Test
    fun historyRoundTripsThroughDiskCacheAndSkipsInvalidSnapshots() {
        val root = Files.createTempDirectory("kairos-history-cache").toFile()
        val cache = DiskCache(root)
        val history =
            History(
                sessionKey = "key",
                sessionId = "session-1",
                revision = 7,
                cursor = 9,
                activeRunIds = listOf("run"),
                messages =
                    listOf(
                        buildJsonObject {
                            put("id", JsonPrimitive("t1"))
                            put("role", JsonPrimitive("user"))
                        },
                    ),
            )
        cache.writeHistory("session-1", history)
        assertEquals(history, cache.readHistory("session-1"))
        // Pre-revision snapshots (fresh or errored sessions) never overwrite a valid cache.
        cache.writeHistory("session-1", History())
        assertEquals(7L, cache.readHistory("session-1")!!.revision)
        cache.delete("history-unknown")
        assertNull(cache.readHistory("session-2"))
    }

    @Test
    fun modelsCacheRoundTrips() {
        val root = Files.createTempDirectory("kairos-models-cache").toFile()
        val cache = DiskCache(root)
        cache.writeModels(
            ModelsCacheState(
                catalog = ModelsResponse(models = listOf(Model(id = "m1", modelRef = "p/m"))),
                chatSettings =
                    ChatSettingsPreferences(
                        defaultSettings = ConversationSettings(model = "p/m"),
                    ),
            )
        )
        val restored = cache.readModels()!!
        assertEquals("p/m", restored.catalog.models.single().modelRef)
        assertEquals("p/m", restored.chatSettings.defaultSettings.model)
        assertNull(DiskCache(Files.createTempDirectory("kairos-empty").toFile()).readModels())
    }
}
