package org.kairos.android.data

import kotlinx.coroutines.CancellationException

/** A request's authenticated owner and the cache generation it may write to. */
data class RepositoryIdentity(
    val generation: Long,
    val serverUrl: String,
    val token: String?,
    val cacheGeneration: Long,
)

/** Raised when an authenticated request outlives the identity that started it. */
class StaleIdentityException : CancellationException("The signed-in account changed.")

/** Runtime generation used alongside the server and token values in repository stamps. */
class IdentityGeneration(initial: Long = 0L) {
    @Volatile private var current = initial.coerceAtLeast(0L)

    fun value(): Long = current

    @Synchronized
    fun advance(): Long {
        current++
        return current
    }
}
