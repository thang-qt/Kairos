package org.kairos.android.data

import java.time.Instant
import java.time.ZoneId

data class SessionGroup(val label: String, val sessions: List<SessionSummary>)

fun groupSessions(
    sessions: List<SessionSummary>,
    now: Long = System.currentTimeMillis(),
    zone: ZoneId = ZoneId.systemDefault(),
): List<SessionGroup> {
    val today =
        Instant.ofEpochMilli(now)
            .atZone(zone)
            .toLocalDate()
            .atStartOfDay(zone)
            .toInstant()
            .toEpochMilli()
    val day = 24 * 60 * 60 * 1000L
    val buckets = List(6) { mutableListOf<SessionSummary>() }
    for (session in sessions) {
        val index =
            when {
                session.isPinned -> 0
                session.updatedAt >= today -> 1
                session.updatedAt >= today - day -> 2
                session.updatedAt >= today - day * 7 -> 3
                session.updatedAt >= today - day * 30 -> 4
                else -> 5
            }
        buckets[index].add(session)
    }
    return listOf("Pinned", "Today", "Yesterday", "Previous 7 days", "Previous 30 days", "Older")
        .mapIndexed { i, label -> SessionGroup(label, buckets[i]) }
        .filter { it.sessions.isNotEmpty() }
}
