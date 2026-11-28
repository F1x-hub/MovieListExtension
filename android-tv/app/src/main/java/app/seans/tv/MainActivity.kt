package app.seans.tv

import android.content.Intent
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import app.seans.tv.designsystem.SeansTheme
import app.seans.tv.nav.SeansNavHost

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val graph = (application as SeansApp).graph
        applyDemoAuth(intent)
        setContent {
            SeansTheme {
                SeansNavHost(graph)
            }
        }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        applyDemoAuth(intent)
    }

    /** Debug builds on the fake graph only (see `DebugHooks`); the release stub ignores the intent. */
    private fun applyDemoAuth(intent: Intent?) {
        DebugHooks.onIntent((application as SeansApp).graph, intent)
    }
}
