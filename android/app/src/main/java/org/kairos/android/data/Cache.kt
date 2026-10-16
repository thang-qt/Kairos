package org.kairos.android.data

import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.serialization.Serializable
import kotlinx.serialization.encodeToString
import java.io.File

/**
 * Tiny JSON file cache rooted at one directory. Writes are atomic (temp file plus rename) so
 * concurrent writers never expose partial content. When maxBytes is positive the cache evicts
 * least-recently-used files (by modification time) after each write.
 */
class DiskCache(private val root: File, private val maxBytes: Long = 0) {
    private val lock = Any()
    @Volatile private var cacheGeneration = 0L
    val generation: Long get() = cacheGeneration

    init {
        if (!root.isDirectory) root.mkdirs()
    }

    private fun file(name: String) = File(root, sanitize(name))

    private fun sanitize(name: String): String {
        val cleaned = name.filter { it.isLetterOrDigit() || it in listOf('-', '_', '.', ' ') }
        require(cleaned.isNotEmpty() && cleaned != "." && cleaned != "..") { "Invalid cache key." }
        return cleaned
    }

    fun readString(name: String): String? =
        runCatching {
            val target = file(name)
            if (!target.isFile) return null
            target.readText()
        }.getOrNull()

    // Capture generation before scheduling asynchronous writes. Clearing an identity
    // invalidates all writes queued under its old generation.
    fun writeString(name: String, content: String, expectedGeneration: Long = generation) {
        synchronized(lock) {
            if (expectedGeneration != generation) return
            val target = file(name)
            val temp = File(root, "${target.name}.tmp-${System.nanoTime()}")
            try {
                temp.writeText(content)
                if (expectedGeneration != generation) return
                if (!temp.renameTo(target)) {
                    // Do not replace the prior cache with a possibly partial write.
                    throw java.io.IOException("Unable to atomically store cache entry")
                }
                enforceBudget()
            } finally {
                temp.delete()
            }
        }
    }

    fun delete(name: String) {
        runCatching { file(name).delete() }
    }

    fun clear() {
        synchronized(lock) {
            cacheGeneration++
            root.listFiles()?.forEach { entry ->
                if (entry.isDirectory) entry.deleteRecursively() else entry.delete()
            }
        }
    }

    /** Keep only the most recently written files within the byte budget. */
    fun enforceBudget() {
        if (maxBytes <= 0) return
        val files = root.listFiles()?.filter { it.isFile } ?: return
        var total = files.sumOf { it.length() }
        if (total <= maxBytes) return
        for (victim in files.sortedBy { it.lastModified() }) {
            if (total <= maxBytes) break
            val size = victim.length()
            if (victim.delete()) total -= size
        }
    }
}

@Serializable
data class SessionPageCacheEntry(val cursor: String? = null, val sessions: List<SessionSummary> = emptyList())

@Serializable
data class SessionListCacheState(
    val version: Int = 1,
    val nextCursor: String? = null,
    val pages: List<SessionPageCacheEntry> = emptyList(),
)

@Serializable
data class ModelsCacheState(
    val version: Int = 1,
    val catalog: ModelsResponse = ModelsResponse(),
    val chatSettings: ChatSettingsPreferences = ChatSettingsPreferences(),
)

const val SESSIONS_CACHE_FILE = "sessions.json"
const val MODELS_CACHE_FILE = "models.json"

fun DiskCache.readSessions(): SessionListCache? =
    readString(SESSIONS_CACHE_FILE)?.let(SessionListCache::decoded)

fun DiskCache.writeSessions(snapshot: String, generation: Long) {
    writeString(SESSIONS_CACHE_FILE, snapshot, generation)
}

fun DiskCache.readModels(): ModelsCacheState? =
    readString(MODELS_CACHE_FILE)
        ?.let { text -> runCatching { wireJson.decodeFromString<ModelsCacheState>(text) }.getOrNull() }

fun DiskCache.writeModels(state: ModelsCacheState, generation: Long) {
    writeString(MODELS_CACHE_FILE, wireJson.encodeToString(state), generation)
}

/** History snapshots are keyed by a digest so arbitrary session ids map to safe file names. */
private fun historyKey(sessionId: String): String {
    val digest = java.security.MessageDigest.getInstance("SHA-256")
        .digest(sessionId.toByteArray(Charsets.UTF_8))
    return "history-" + digest.joinToString("") { "%02x".format(it) }
}

fun DiskCache.readHistory(sessionId: String): History? =
    readString(historyKey(sessionId))
        ?.let { text -> runCatching { wireJson.decodeFromString<History>(text) }.getOrNull() }

fun DiskCache.writeHistory(sessionId: String, history: History, generation: Long) {
    if (history.revision < 0) return
    writeString(historyKey(sessionId), wireJson.encodeToString(history), generation)
}

/**
 * In-memory paged session list mirroring the web's infinite query: page 0 uses no cursor,
 * later pages pin the cursor they were fetched with so a refresh reproduces the same slices.
 * The merged view is the sorted, deduplicated union the UI consumes.
 */
class SessionListCache {
    private val pages = mutableListOf(listOf<SessionSummary>())
    private val cursors = mutableListOf<String?>(null)
    private var _nextCursor: String? = null

    val nextCursor: String?
        get() = _nextCursor

    val pageCount: Int
        get() = pages.size

    val loadedCount: Int
        get() = pages.sumOf { it.size }

    /** Replace one page's content without touching the list-wide next cursor. */
    fun set(index: Int, cursor: String?, sessions: List<SessionSummary>) {
        pages[index] = sessions
        cursors[index] = cursor
    }

    fun setNextCursor(next: String?) {
        _nextCursor = next
    }

    fun append(cursor: String?, sessions: List<SessionSummary>, next: String?) {
        pages.add(sessions)
        cursors.add(cursor)
        _nextCursor = next
    }

    fun cursorFor(index: Int): String? = cursors.getOrNull(index)

    /** Replace or insert one summary, keeping page layout stable for refresh cursors. */
    fun upsert(session: SessionSummary) {
        for ((index, page) in pages.withIndex()) {
            if (page.any { it.friendlyId == session.friendlyId }) {
                pages[index] = page.map { if (it.friendlyId == session.friendlyId) session else it }
                return
            }
        }
        pages[0] = listOf(session) + pages[0]
    }

    fun remove(friendlyId: String) {
        for ((index, page) in pages.withIndex())
            pages[index] = page.filter { it.friendlyId != friendlyId }
    }

    fun clear() {
        pages.clear()
        cursors.clear()
        pages.add(emptyList())
        cursors.add(null)
        _nextCursor = null
    }

    fun merged(): List<SessionSummary> =
        pages.asSequence()
            .flatten()
            .distinctBy { it.friendlyId }
            .sortedWith(compareByDescending<SessionSummary> { it.isPinned }.thenByDescending { it.updatedAt })
            .toList()

    fun encoded(): String =
        wireJson.encodeToString(
            SessionListCacheState(
                version = 1,
                nextCursor = _nextCursor,
                pages = pages.mapIndexed { index, page -> SessionPageCacheEntry(cursor = cursors[index], sessions = page) },
            )
        )

    companion object {
        fun decoded(text: String): SessionListCache =
            runCatching {
                val state = wireJson.decodeFromString<SessionListCacheState>(text)
                SessionListCache().apply {
                    if (state.pages.isEmpty()) {
                        set(0, null, emptyList())
                    } else {
                        clear()
                        state.pages.forEachIndexed { index, page ->
                            if (index == 0) set(0, null, page.sessions)
                            else append(page.cursor, page.sessions, null)
                        }
                    }
                    setNextCursor(state.nextCursor)
                }
            }.getOrDefault(SessionListCache())
    }
}

/**
 * Coalesces frequent change notifications into at most one refresh per debounce window, and
 * re-fires when changes arrive while a refresh is running. Port of the web's
 * createSessionListRefreshScheduler.
 */
class RefreshScheduler(
    private val scope: CoroutineScope,
    private val refresh: suspend () -> Unit,
    private val debounceMillis: Long = 200,
) {
    private var timer: Job? = null
    private var running = false
    private var dirty = false
    private var disposed = false

    fun schedule() {
        if (disposed) return
        dirty = true
        if (timer != null || running) return
        timer = scope.launch {
            delay(debounceMillis)
            runRefresh()
        }
    }

    private suspend fun runRefresh() {
        timer = null
        if (disposed || !dirty) return
        dirty = false
        running = true
        try {
            if (!disposed) refresh()
        } catch (e: CancellationException) {
            throw e
        } catch (_: Exception) {
            // Background sync failures stay silent; the next change notification retries.
        } finally {
            running = false
            if (dirty && !disposed) schedule()
        }
    }

    fun dispose() {
        disposed = true
        dirty = false
        timer?.cancel()
        timer = null
    }
}
