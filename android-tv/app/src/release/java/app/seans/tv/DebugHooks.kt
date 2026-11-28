package app.seans.tv

import android.app.Application
import android.content.Intent
import app.seans.tv.model.AppGraph
import app.seans.tv.network.SeansHttp

/** Release stub of the debug hooks (`src/debug`): no StrictMode, no fake graph, no demo intents. */
object DebugHooks {
    fun onAppCreate() = Unit

    @Suppress("UNUSED_PARAMETER")
    fun fakeGraphOrNull(app: Application, http: SeansHttp): AppGraph? = null

    @Suppress("UNUSED_PARAMETER")
    fun onIntent(graph: AppGraph, intent: Intent?) = Unit
}
