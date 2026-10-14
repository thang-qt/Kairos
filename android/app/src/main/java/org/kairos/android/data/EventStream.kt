package org.kairos.android.data

import java.util.concurrent.atomic.AtomicReference
import kotlinx.coroutines.*
import kotlinx.coroutines.channels.awaitClose
import kotlinx.coroutines.flow.buffer
import kotlinx.coroutines.flow.callbackFlow
import okhttp3.Call

// Incremental SSE framing (including CR, LF, CRLF, comments, multiline data and BOM).
data class SseFrame(val data: String, val id: String?, val retryMillis: Long?)

class SseParser(private val emit: (SseFrame) -> Unit) {
    private val line = StringBuilder()
    private val data = mutableListOf<String>()
    private var id: String? = null
    private var retry: Long? = null
    private var afterCr = false
    private var first = true

    fun feed(chunk: String) {
        for (char in chunk) {
            if (first) {
                first = false
                if (char == '\uFEFF') continue
            }
            if (afterCr && char == '\n') {
                afterCr = false
                continue
            }
            afterCr = false
            if (char == '\r' || char == '\n') {
                consumeLine(line.toString())
                line.clear()
                afterCr = char == '\r'
            } else line.append(char)
        }
    }

    private fun consumeLine(value: String) {
        if (value.isEmpty()) {
            if (data.isNotEmpty()) emit(SseFrame(data.joinToString("\n"), id, retry))
            data.clear()
            retry = null
            return
        }
        if (value.startsWith(':')) return
        val key = value.substringBefore(':')
        val content = value.substringAfter(':', "").removePrefix(" ")
        when (key) {
            "data" -> data.add(content)
            "id" -> if ('\u0000' !in content) id = content
            "retry" -> if (content.all { it.isDigit() }) retry = content.toLongOrNull()
        }
    }
}

enum class ConnectionState {
    /** First attempt for a freshly opened session; no banner. */
    Connecting,
    Connected,
    Reconnecting,
    Offline,
}

sealed interface StreamUpdate {
    data class Event(val event: ConversationEvent) : StreamUpdate

    data class Connection(val state: ConnectionState) : StreamUpdate
}

class EventStream(private val api: KairosApi) {
    fun events(id: String, cursor: Long) =
        callbackFlow {
                val currentCall = AtomicReference<Call?>()
                val worker =
                    launch(Dispatchers.IO) {
                        var resume = cursor
                        var failures = 0
                        var serverDelay = 1000L
                        var everConnected = false
                        while (isActive) {
                            // Opening a chat must not flash the banner; one dropped stream is
                            // "Reconnecting", repeated failures are "Offline".
                            trySend(
                                StreamUpdate.Connection(
                                    when {
                                        failures == 0 && !everConnected -> ConnectionState.Connecting
                                        failures >= 2 -> ConnectionState.Offline
                                        else -> ConnectionState.Reconnecting
                                    }
                                )
                            )
                            try {
                                val request =
                                    api.request(api.sessionPath(id) + "/events")
                                        .newBuilder()
                                        .header("Accept", "text/event-stream")
                                if (resume > 0) request.header("Last-Event-ID", resume.toString())
                                val call = api.streamClient.newCall(request.build())
                                currentCall.set(call)
                                if (!isActive) call.cancel()
                                ensureActive()
                                call.execute().use { response ->
                                    if (!response.isSuccessful)
                                        throw api.error(
                                            response.code,
                                            response.body?.string().orEmpty(),
                                        )
                                    check(
                                        response
                                            .header("Content-Type")
                                            .orEmpty()
                                            .startsWith("text/event-stream")
                                    ) {
                                        "Invalid event stream."
                                    }
                                    val parser = SseParser { frame ->
                                        frame.id?.toLongOrNull()?.let { resume = it }
                                        frame.retryMillis?.let {
                                            serverDelay = it.coerceIn(500, 30000)
                                        }
                                        val event =
                                            wireJson.decodeFromString<ConversationEvent>(frame.data)
                                        // Connected means the authoritative reconnect snapshot has
                                        // arrived.
                                        if (event.snapshot != null) {
                                            failures = 0
                                            everConnected = true
                                            trySend(
                                                StreamUpdate.Connection(ConnectionState.Connected)
                                            )
                                        }
                                        trySend(StreamUpdate.Event(event)).getOrThrow()
                                    }
                                    response.body!!.charStream().use { reader ->
                                        val buffer = CharArray(8192)
                                        while (isActive) {
                                            val count = reader.read(buffer)
                                            if (count < 0) break
                                            parser.feed(String(buffer, 0, count))
                                        }
                                    }
                                }
                            } catch (e: Exception) {
                                if (e is CancellationException) throw e
                                if (e is ApiException && e.code == 401) {
                                    close(e)
                                    return@launch
                                }
                            } finally {
                                currentCall.set(null)
                            }
                            ensureActive()
                            failures++
                            trySend(StreamUpdate.Connection(ConnectionState.Reconnecting))
                            delay(
                                (serverDelay * (1L shl minOf(failures - 1, 5))).coerceAtMost(30000)
                            )
                        }
                    }
                awaitClose {
                    currentCall.getAndSet(null)?.cancel()
                    worker.cancel()
                }
            }
            .buffer(kotlinx.coroutines.channels.Channel.UNLIMITED)
}
