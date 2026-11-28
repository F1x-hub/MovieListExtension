package app.seans.tv.nav

import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.navigation.NavDestination.Companion.hasRoute
import androidx.navigation.NavBackStackEntry
import androidx.navigation.NavHostController
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.rememberNavController
import androidx.navigation.toRoute
import app.seans.tv.designsystem.SeansColors
import app.seans.tv.designsystem.SeansMotion
import app.seans.tv.live.LiveFeature
import app.seans.tv.live.LiveScreen
import app.seans.tv.model.AppGraph
import app.seans.tv.model.AuthState
import app.seans.tv.model.LiveSummaryProvider
import app.seans.tv.model.TitleRef
import app.seans.tv.player.PlayerScreen
import app.seans.tv.ui.details.DetailsScreen
import app.seans.tv.ui.home.HomeScreen
import app.seans.tv.ui.login.LoginScreen
import app.seans.tv.ui.search.SearchScreen

/** Signed out, or signed in to an account that is not approved: the sign-in screen. */
private val AuthState.needsLogin: Boolean get() = this is AuthState.SignedOut || this is AuthState.NotApproved

/** Lets `LiveScreen` run on a graph whose `live` is not a `LiveFeature` yet (the fake graph). */
private class LiveFeatureAdapter(provider: LiveSummaryProvider) : LiveFeature, LiveSummaryProvider by provider

/**
 * The app's navigation. Nothing is drawn while Firebase has not answered ([AuthState.Unknown]);
 * then the start screen follows the auth state, and later auth changes move between Login and
 * Home with the back stack cleared. Back pops the stack like the mockup's history; overlays inside
 * a screen take Back first.
 */
@Composable
fun SeansNavHost(graph: AppGraph) {
    val auth by graph.auth.state.collectAsStateWithLifecycle()
    Box(Modifier.fillMaxSize()) {
        if (auth == AuthState.Unknown) return@Box
        val nav = rememberNavController()
        val start: Any = remember { if (auth.needsLogin) LoginRoute else HomeRoute }
        val liveFeature = remember(graph) { graph.live as? LiveFeature ?: LiveFeatureAdapter(graph.live) }

        NavHost(
            navController = nav,
            startDestination = start,
            enterTransition = { fadeIn(tween(SeansMotion.Screen, easing = SeansMotion.Ease)) },
            exitTransition = { fadeOut(tween(SeansMotion.Screen, easing = SeansMotion.Ease)) },
            popEnterTransition = { fadeIn(tween(SeansMotion.Screen, easing = SeansMotion.Ease)) },
            popExitTransition = { fadeOut(tween(SeansMotion.Screen, easing = SeansMotion.Ease)) },
        ) {
            composable<LoginRoute> {
                LoginScreen(graph)
            }
            composable<HomeRoute> {
                HomeScreen(
                    graph = graph,
                    onOpenDetails = { nav.navigate(DetailsRoute(it)) },
                    onPlay = { nav.navigate(PlayerRoute(it)) },
                    onOpenSearch = { nav.navigate(SearchRoute) },
                    onOpenLive = { nav.navigate(LiveRoute) },
                )
            }
            composable<DetailsRoute>(typeMap = DetailsTypeMap) { entry ->
                val route = entry.toRoute<DetailsRoute>()
                DetailsScreen(
                    ref = route.ref,
                    graph = graph,
                    onPlay = { nav.navigate(PlayerRoute(it)) },
                )
            }
            composable<SearchRoute> {
                SearchScreen(graph = graph, onOpenDetails = { nav.navigate(DetailsRoute(it)) })
            }
            composable<PlayerRoute>(typeMap = PlayerTypeMap) { entry ->
                val route = entry.toRoute<PlayerRoute>()
                PlayerScreen(request = route.request, graph = graph, onExit = { nav.popIfCurrent(entry) })
            }
            composable<LiveRoute> { entry ->
                LiveScreen(
                    feature = liveFeature,
                    graph = graph,
                    onOpenDetails = { ref: TitleRef -> nav.navigate(DetailsRoute(ref)) },
                    onExit = { nav.popIfCurrent(entry) },
                )
            }
        }

        val needsLogin = auth.needsLogin
        LaunchedEffect(needsLogin) {
            val onLogin = nav.currentDestination?.hasRoute<LoginRoute>() == true
            if (needsLogin && !onLogin) {
                nav.navigate(LoginRoute) { popUpTo(nav.graph.id) { inclusive = true } }
            } else if (!needsLogin && onLogin) {
                nav.navigate(HomeRoute) { popUpTo(nav.graph.id) { inclusive = true } }
            }
        }
    }
}

/** Leaves [entry] only while it is on top: a second exit call during the animation must not pop the screen below. */
private fun NavHostController.popIfCurrent(entry: NavBackStackEntry) {
    if (currentBackStackEntry?.id == entry.id) popBackStack()
}
