package org.kairos.android.data

import java.io.IOException
import java.util.concurrent.TimeUnit
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withContext
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.*
import okhttp3.*
import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.RequestBody.Companion.toRequestBody

class ApiException(val code: Int, message: String) : IOException(message)

private data class ApiRequestOwner(
    val serverUrl: String,
    val token: String?,
    val tokenGeneration: Long,
    val authenticated: Boolean,
    val identity: RepositoryIdentity?,
)

open class BackendApi(
    val server: ServerStore,
    val tokens: TokenStore,
    private val identityProvider: (() -> RepositoryIdentity)? = null,
) {
    val client =
        OkHttpClient.Builder()
            .connectTimeout(15, TimeUnit.SECONDS)
            .readTimeout(30, TimeUnit.SECONDS)
            .followRedirects(false)
            .followSslRedirects(false)
            .addInterceptor { chain ->
                val request = chain.request()
                val response = chain.proceed(request)
                val owner = request.tag(ApiRequestOwner::class.java)
                val currentIdentity = identityProvider?.invoke()
                if (
                    response.code == 401 &&
                        owner?.authenticated == true && owner.token != null &&
                        owner.serverUrl == server.url &&
                        (owner.identity == null || owner.identity == currentIdentity)
                )
                    tokens.clearIfCurrent(owner.token, owner.tokenGeneration)
                response
            }
            .build()
    val streamClient = client.newBuilder().readTimeout(0, TimeUnit.MILLISECONDS).build()

    fun request(
        path: String,
        method: String = "GET",
        body: String? = null,
        base: String = server.url,
        authenticated: Boolean = true,
        expectedIdentity: RepositoryIdentity? = null,
    ): Request {
        val builder = Request.Builder().url(base + path).header("Accept", "application/json")
        val currentIdentity = identityProvider?.invoke()
        if (expectedIdentity != null) {
            val expectedIsCurrent =
                if (identityProvider != null) currentIdentity == expectedIdentity
                else expectedIdentity.serverUrl == base && expectedIdentity.token == tokens.token
            if (!expectedIsCurrent || expectedIdentity.serverUrl != base)
                throw StaleIdentityException()
        }
        if (expectedIdentity == null && authenticated && currentIdentity != null &&
            currentIdentity.serverUrl != base
        ) throw StaleIdentityException()
        val token = tokens.token
        val tokenGeneration = tokens.generation
        builder.tag(
            ApiRequestOwner::class.java,
            ApiRequestOwner(base, token, tokenGeneration, authenticated, currentIdentity),
        )
        if (authenticated) token?.let { builder.header("Authorization", "Bearer $it") }
        builder.method(
            method,
            if (method in listOf("GET", "HEAD")) null
            else (body ?: "{}").toRequestBody("application/json; charset=utf-8".toMediaType()),
        )
        return builder.build()
    }

    open suspend fun raw(
        path: String,
        method: String = "GET",
        body: String? = null,
        base: String = server.url,
        authenticated: Boolean = true,
    ): String {
        // Freeze the URL and bearer before the first suspension. Dispatching to IO first can
        // otherwise attach a later account's token to a request created under an older stamp.
        val frozenRequest = request(path, method, body, base, authenticated)
        return withContext(Dispatchers.IO) {
            val call = client.newCall(frozenRequest)
            suspendCancellableCoroutine { continuation ->
                continuation.invokeOnCancellation { call.cancel() }
                call.enqueue(
                    object : Callback {
                        override fun onFailure(call: Call, e: IOException) {
                            if (continuation.isActive)
                                continuation.resumeWithException(IOException("Can't reach server."))
                        }

                        override fun onResponse(call: Call, response: Response) {
                            response.use {
                                try {
                                    val content = response.body?.string().orEmpty()
                                    if (!response.isSuccessful) throw error(response.code, content)
                                    if (continuation.isActive) continuation.resume(content)
                                } catch (e: Exception) {
                                    if (continuation.isActive) continuation.resumeWithException(e)
                                }
                            }
                        }
                    }
                )
            }
        }
    }

    fun error(code: Int, content: String): ApiException =
        ApiException(
            code,
            runCatching { wireJson.parseToJsonElement(content).jsonObject.string("error") }
                .getOrNull() ?: "Server request failed ($code).",
        )

    suspend inline fun <reified T> get(path: String): T = wireJson.decodeFromString(raw(path))

    suspend inline fun <reified T, reified B> write(path: String, method: String, body: B): T =
        wireJson.decodeFromString(raw(path, method, wireJson.encodeToString(body)))

    suspend fun connect(base: String): CapabilitiesResponse {
        check(
            wireJson
                .decodeFromString<Health>(raw("/api/health", base = base, authenticated = false))
                .ok
        ) {
            "This server is not ready."
        }
        return wireJson.decodeFromString(
            raw("/api/app/capabilities", base = base, authenticated = false)
        )
    }

    suspend fun login(email: String, password: String): TokenResponse =
        wireJson.decodeFromString(
            raw(
                "/api/auth/token",
                "POST",
                wireJson.encodeToString(AuthRequest(email, password)),
                authenticated = false,
            )
        )

    suspend fun logout() {
        raw("/api/auth/logout", "POST")
    }

    fun sessionPath(id: String): String = "/api/sessions/" + encodePath(id)

    fun encodePath(value: String): String =
        "https://localhost/"
            .toHttpUrl()
            .newBuilder()
            .addPathSegment(value)
            .build()
            .encodedPath
            .removePrefix("/")

    fun query(value: String): String =
        "https://localhost/"
            .toHttpUrl()
            .newBuilder()
            .addQueryParameter("q", value)
            .build()
            .encodedQuery
            .orEmpty()

    fun parameter(name: String, value: String): String =
        "https://localhost/"
            .toHttpUrl()
            .newBuilder()
            .addQueryParameter(name, value)
            .build()
            .encodedQuery
            .orEmpty()

    /**
     * Live response for an asset download. The caller owns the response body; used by the
     * transcript bridge to proxy authorized asset URLs into the offline WebView.
     */
    fun asset(assetId: String): okhttp3.Response =
        client.newCall(request("/api/assets/" + encodePath(assetId))).execute()

    /** Records a tool-approval decision; the resulting state arrives on the stream. */
    suspend fun decideApproval(approval: McpApproval, decision: String, scope: String? = null) {
        write<JsonObject, McpDecisionRequest>(
            "/api/mcp/approvals/" + encodePath(approval.id),
            "POST",
            McpDecisionRequest(decision, scope),
        )
    }

    /**
     * One-shot SSE request (throwaway messages). The read loop runs on the IO dispatcher and
     * reacts to cancellation by killing the connection, like the event stream does.
     */
    suspend fun postStream(
        path: String,
        body: String,
        expectedIdentity: RepositoryIdentity? = null,
        onFrame: (SseFrame) -> Unit,
    ): Unit {
        val call = client.newCall(request(path, "POST", body, expectedIdentity = expectedIdentity))
        withContext(Dispatchers.IO) {
            val job = coroutineContext[Job]
            val handle = job?.invokeOnCompletion { cause -> if (cause != null) call.cancel() }
            try {
                call.execute().use { response ->
                    if (!response.isSuccessful)
                        throw error(response.code, response.body?.string().orEmpty())
                    check(
                        response
                            .header("Content-Type")
                            .orEmpty()
                            .startsWith("text/event-stream")
                    ) {
                        "Invalid throwaway response stream."
                    }
                    val parser = SseParser(onFrame)
                    response.body!!.charStream().use { reader ->
                        val buffer = CharArray(8192)
                        while (true) {
                            ensureActive()
                            val count = reader.read(buffer)
                            if (count < 0) break
                            parser.feed(String(buffer, 0, count))
                        }
                    }
                }
            } finally {
                handle?.dispose()
            }
        }
    }
}
