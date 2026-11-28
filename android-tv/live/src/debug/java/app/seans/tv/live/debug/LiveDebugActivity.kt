package app.seans.tv.live.debug

import android.os.Bundle
import android.util.Log
import androidx.activity.ComponentActivity
import androidx.compose.ui.platform.ComposeView
import app.seans.tv.designsystem.SeansTheme
import app.seans.tv.live.LiveModule
import app.seans.tv.live.LiveScreen
import app.seans.tv.model.fake.FakeGraph
import app.seans.tv.network.SeansHttp
import com.google.firebase.FirebaseApp
import com.google.firebase.FirebaseOptions
import com.google.firebase.firestore.FirebaseFirestore

/**
 * TEMPORARY (tv-live): opens the Live screen on real channel data before `:app` has navigation.
 * `adb shell am start -n app.seans.tv/app.seans.tv.live.debug.LiveDebugActivity`.
 * Debug builds only; delete this file and `src/debug/AndroidManifest.xml` after the TV check.
 */
class LiveDebugActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val app = FirebaseApp.getApps(this).firstOrNull() ?: FirebaseApp.initializeApp(
            this,
            FirebaseOptions.Builder()
                .setApiKey("AIzaSyC6PI4cBRzn6KLVJ6ikensKus6LaulabO4")
                .setApplicationId("1:532518163829:web:36a6a62a14adc188f1af3c")
                .setProjectId("movielistdb-13208")
                .setGcmSenderId("532518163829")
                .setStorageBucket("movielistdb-13208.firebasestorage.app")
                .build(),
        )
        val http = SeansHttp(cacheDir)
        val graph = FakeGraph(http)
        val live = LiveModule(FirebaseFirestore.getInstance(app), http)
        setContentView(ComposeView(this).apply {
            setContent {
                SeansTheme {
                    LiveScreen(live, graph, onOpenDetails = { Log.i("LiveDebug", "details ${it.kinopoiskId}") }, onExit = { finish() })
                }
            }
        })
    }
}
