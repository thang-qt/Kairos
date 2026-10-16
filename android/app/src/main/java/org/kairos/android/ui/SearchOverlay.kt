package org.kairos.android.ui

import androidx.lifecycle.compose.collectAsStateWithLifecycle

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.Text
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.platform.LocalSoftwareKeyboardController
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import kotlinx.coroutines.delay
import org.kairos.android.chat.ChatViewModel
import org.kairos.android.data.SearchResult
import org.kairos.android.data.SessionSummary
import org.kairos.android.ui.icons.KairosIcons
import org.kairos.android.ui.theme.LocalKairosColors

private val shortDate = DateTimeFormatter.ofPattern("MMM d")

private fun resultDate(updatedAt: Long): String {
    if (updatedAt <= 0) return ""
    val zone = ZoneId.systemDefault()
    val date = Instant.ofEpochMilli(updatedAt).atZone(zone).toLocalDate()
    val time = Instant.ofEpochMilli(updatedAt).atZone(zone).toLocalTime()
    val today = LocalDate.now(zone)
    val stamp = shortDate.format(date)
    return when {
        date == today -> "Today ${"%02d:%02d".format(time.hour, time.minute)}"
        date == today.minusDays(1) -> "Yesterday"
        else -> stamp
    }
}

/**
 * Full-screen session search (the web's search dialog at phone width). Owns the status bar
 * inset so the field never slides under the system top bar; a blank query lists recent
 * conversations from the cached session pages.
 */
@Composable
fun SearchOverlay(
    chat: ChatViewModel,
    onDismiss: () -> Unit,
    onSelect: (String) -> Unit,
) {
    val colors = LocalKairosColors.current
    val focusRequester = remember { FocusRequester() }
    val keyboard = LocalSoftwareKeyboardController.current
    var query by remember { mutableStateOf("") }
    var results by remember { mutableStateOf<List<SearchResult>?>(null) }
    var error by remember { mutableStateOf<String?>(null) }

    LaunchedEffect(Unit) {
        withFrameNanos {}
        focusRequester.requestFocus()
        keyboard?.show()
    }
    LaunchedEffect(query) {
        if (query.isBlank()) {
            results = null
            error = null
            return@LaunchedEffect
        }
        delay(200)
        try {
            results = chat.app.sessions.search(query)
            error = null
        } catch (e: Exception) {
            if (e is kotlinx.coroutines.CancellationException) throw e
            error = e.message
            results = emptyList()
        }
    }

    Box(Modifier.fillMaxSize().background(colors.surface).statusBarsPadding()) {
        Column(Modifier.fillMaxSize()) {
            Row(
                Modifier.fillMaxWidth()
                    .height(48.dp)
                    .padding(horizontal = 8.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(4.dp),
            ) {
                GhostIconButton(KairosIcons.ArrowLeft01, "Close search", onDismiss)
                KairosField(
                    query,
                    { query = it },
                    "Search sessions",
                    search = true,
                    modifier = Modifier.weight(1f),
                    focusRequester = focusRequester,
                )
            }
            Box(Modifier.fillMaxWidth().height(1.dp).background(colors.p(100)))
            val currentError = error
            when {
                currentError != null -> Column(Modifier.padding(16.dp)) { ErrorBox(currentError) }
                query.isBlank() ->
                    RecentSessions(chat.sessions.collectAsStateWithLifecycle().value, onSelect)
                results == null -> LoadingState("Searching…")
                results!!.isEmpty() ->
                    EmptyState(
                        KairosIcons.Search01,
                        "No matches",
                        "Nothing in your conversations matches \"$query\".",
                    )
                else ->
                    LazyColumn(
                        Modifier.fillMaxSize(),
                        contentPadding = PaddingValues(vertical = 8.dp),
                    ) {
                        items(results.orEmpty(), key = { it.key + it.messageId }) { result ->
                            SearchResultRow(result, onClick = { onSelect(result.friendlyId) })
                        }
                    }
            }
        }
    }
}

@Composable
private fun RecentSessions(sessions: List<SessionSummary>, onSelect: (String) -> Unit) {
    val colors = LocalKairosColors.current
    if (sessions.isEmpty()) {
        EmptyState(
            KairosIcons.BubbleChat,
            "No conversations yet",
            "Start a chat and it will show up here.",
        )
        return
    }
    LazyColumn(
        Modifier.fillMaxSize(),
        contentPadding = PaddingValues(vertical = 8.dp),
    ) {
        item {
            Text(
                "Recent",
                Modifier.padding(horizontal = 20.dp, vertical = 8.dp),
                color = colors.p(500),
                fontSize = 12.sp,
            )
        }
        items(sessions.take(25), key = { it.friendlyId }) { session ->
            Row(
                Modifier.fillMaxWidth()
                    .heightIn(min = 44.dp)
                    .pressable(pressedColor = colors.p(100)) { onSelect(session.friendlyId) }
                    .padding(horizontal = 20.dp, vertical = 10.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Column(Modifier.weight(1f)) {
                    Text(
                        session.displayTitle,
                        color = colors.p(900),
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                    )
                    if (session.updatedAt > 0)
                        Text(
                            resultDate(session.updatedAt),
                            color = colors.p(500),
                            fontSize = 12.sp,
                        )
                }
            }
        }
    }
}

@Composable
private fun SearchResultRow(result: SearchResult, onClick: () -> Unit) {
    val colors = LocalKairosColors.current
    Column(
        Modifier.fillMaxWidth()
            .pressable(pressedColor = colors.p(100), onClick = onClick)
            .padding(horizontal = 20.dp, vertical = 12.dp),
        verticalArrangement = Arrangement.spacedBy(4.dp),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Text(
                result.displayTitle,
                Modifier.weight(1f),
                color = colors.p(900),
                fontWeight = FontWeight.Medium,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
            Text(resultDate(result.updatedAt), color = colors.p(500), fontSize = 12.sp)
        }
        Text(
            result.snippet,
            color = colors.p(600),
            fontSize = 13.sp,
            lineHeight = 18.sp,
            maxLines = 2,
            overflow = TextOverflow.Ellipsis,
        )
    }
}
