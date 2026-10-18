package org.kairos.android.app

import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.remember
import androidx.navigation.NavHostController
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.rememberNavController
import androidx.navigation.toRoute
import kotlinx.coroutines.flow.collect
import kotlinx.serialization.Serializable
import org.kairos.android.chat.ChatViewModel
import org.kairos.android.transcript.TranscriptBridge
import org.kairos.android.ui.AuthScreen
import org.kairos.android.ui.ChatScreen
import org.kairos.android.ui.SearchOverlay
import org.kairos.android.ui.SettingsScreen

@Serializable data object ConnectRoute
@Serializable data object SignInRoute
@Serializable data object NewChatRoute
@Serializable data class ConversationRoute(val friendlyId: String)
@Serializable data object SearchRoute
@Serializable data object SettingsRoute

/** One saved Navigation Compose back stack for the full app, not screen flags in the VM. */
@Composable
fun AppNavigation(
    chat: ChatViewModel,
    bridgeFactory: () -> TranscriptBridge,
    onCopy: (String) -> Unit,
) {
    val controller = rememberNavController()
    // NavController restores the destination from its saved state after process death.
    // A fresh launch chooses the initial route from the authenticated app state.
    val initialDestination: Any = remember {
        when (chat.screen) {
            Screen.Connect -> ConnectRoute
            Screen.SignIn -> SignInRoute
            Screen.Settings -> SettingsRoute
            Screen.Chat -> chat.sessionId?.let(::ConversationRoute) ?: NewChatRoute
        }
    }
    LaunchedEffect(chat, controller) {
        chat.navigation.collect { request ->
            when (request) {
                NavigationRequest.Connect -> controller.navigateRoot(ConnectRoute)
                NavigationRequest.SignIn -> controller.navigateRoot(SignInRoute)
                NavigationRequest.Settings -> controller.navigate(SettingsRoute) {
                    launchSingleTop = true
                }
                NavigationRequest.Search -> controller.navigate(SearchRoute) {
                    launchSingleTop = true
                }
                is NavigationRequest.Chat -> {
                    controller.navigateRoot(
                        request.friendlyId?.let(::ConversationRoute) ?: NewChatRoute
                    )
                }
                NavigationRequest.Back -> controller.popBackStack()
            }
        }
    }

    NavHost(navController = controller, startDestination = initialDestination) {
        composable<ConnectRoute> {
            LaunchedEffect(Unit) { chat.enterRoute(Screen.Connect) }
            AuthScreen(chat)
        }
        composable<SignInRoute> {
            LaunchedEffect(Unit) { chat.enterRoute(Screen.SignIn) }
            AuthScreen(chat)
        }
        composable<NewChatRoute> {
            LaunchedEffect(Unit) { chat.enterRoute(Screen.Chat) }
            ChatScreen(chat, bridgeFactory, onCopy)
        }
        composable<ConversationRoute> { entry ->
            val target = entry.toRoute<ConversationRoute>().friendlyId
            LaunchedEffect(target) { chat.enterRoute(Screen.Chat, id = target) }
            ChatScreen(chat, bridgeFactory, onCopy)
        }
        composable<SettingsRoute> {
            LaunchedEffect(Unit) { chat.enterRoute(Screen.Settings) }
            SettingsScreen(chat)
        }
        composable<SearchRoute> {
            LaunchedEffect(Unit) { chat.enterRoute(Screen.Chat, search = true) }
            SearchOverlay(
                chat,
                onDismiss = { chat.closeSearch() },
                onSelect = { id ->
                    chat.closeSearch(navigateBack = false)
                    chat.select(id)
                },
            )
        }
    }
}

// Selecting conversations replaces the previous chat route. Back returns to the
// previous destination for settings/search, not every previously selected chat.
private fun NavHostController.navigateRoot(route: Any) {
    navigate(route) {
        popUpTo(graph.id) { inclusive = false }
        launchSingleTop = true
    }
}
