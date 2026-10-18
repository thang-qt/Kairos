package org.kairos.android.app

sealed interface Screen {
    data object Connect : Screen

    data object SignIn : Screen

    data object Chat : Screen

    data object Settings : Screen
}

/** Navigation intent from UI actions; only the NavHost owns destination history. */
sealed interface NavigationRequest {
    data object Connect : NavigationRequest
    data object SignIn : NavigationRequest
    data object Settings : NavigationRequest
    data object Search : NavigationRequest
    data object Back : NavigationRequest
    data class Chat(val friendlyId: String?) : NavigationRequest
}
