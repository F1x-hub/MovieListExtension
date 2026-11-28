package app.seans.tv

import app.seans.tv.model.AppGraph
import app.seans.tv.model.AuthRepository
import app.seans.tv.model.AuthState
import app.seans.tv.model.CatalogRepository
import app.seans.tv.model.LiveNow
import app.seans.tv.model.LiveSlot
import app.seans.tv.model.LiveSummaryProvider
import app.seans.tv.model.SeansError
import app.seans.tv.model.TitleDetails
import app.seans.tv.model.TitleRef
import app.seans.tv.model.TitleSummary
import app.seans.tv.model.fake.FakeData
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.emitAll
import kotlinx.coroutines.flow.flow
import kotlinx.coroutines.flow.stateIn

/**
 * Debug builds on the fake graph only (`DebugHooks`): lets a checker reach states the fake graph never shows.
 * Start the app with `am start -n app.seans.tv/.MainActivity --es demo_auth signed_in` (or
 * `not_approved`, `off`) and/or `--ez demo_offline true` (the catalogue and «Эфир» fail as
 * without a network). Goes away with `FakeGraph` when the real modules are wired.
 */
class DemoAuth(private val base: AuthRepository, scope: CoroutineScope) : AuthRepository by base {
    private val forced = MutableStateFlow<AuthState?>(null)

    override val state: StateFlow<AuthState> =
        combine(base.state, forced) { real, f -> f ?: real }.stateIn(scope, SharingStarted.Eagerly, base.state.value)

    fun apply(mode: String) {
        forced.value = when (mode) {
            "signed_in" -> AuthState.SignedIn(FakeData.profile)
            "not_approved" -> AuthState.NotApproved("pending")
            else -> null
        }
    }

    override suspend fun signOut() {
        forced.value = null
        base.signOut()
    }
}

/** The debug wrapper around the fake graph; see [DemoAuth]. */
class DemoGraph(private val base: AppGraph, scope: CoroutineScope) : AppGraph by base {
    var offline = false

    override val auth = DemoAuth(base.auth, scope)

    private fun failIfOffline() {
        if (offline) throw SeansError(SeansError.Code.NETWORK, "demo offline")
    }

    override val catalog = object : CatalogRepository {
        override suspend fun details(ref: TitleRef): TitleDetails { failIfOffline(); return base.catalog.details(ref) }
        override suspend fun search(query: String): List<TitleSummary> { failIfOffline(); return base.catalog.search(query) }
        override suspend fun popularInCommunity(): List<TitleSummary> { failIfOffline(); return base.catalog.popularInCommunity() }
        override suspend fun featured(): TitleSummary? { failIfOffline(); return base.catalog.featured() }
    }

    override val live = object : LiveSummaryProvider by base.live {
        override fun now(): Flow<LiveNow?> = flow { if (offline) emit(null) else emitAll(base.live.now()) }
        override fun programme(): Flow<List<LiveSlot>> = flow { if (offline) emit(emptyList()) else emitAll(base.live.programme()) }
    }
}
