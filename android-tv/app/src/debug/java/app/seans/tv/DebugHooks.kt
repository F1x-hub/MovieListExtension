package app.seans.tv

import android.app.Application
import android.content.Intent
import android.os.StrictMode
import android.util.Log
import app.seans.tv.model.AppGraph
import app.seans.tv.model.fake.FakeGraph
import app.seans.tv.network.SeansHttp
import java.io.File
import kotlinx.coroutines.MainScope

/**
 * Debug-build hooks. The release source set has a stub with the same API that does nothing, so the
 * fake graph, [DemoGraph] and their strings never reach the release dex.
 */
object DebugHooks {
    private const val FAKE_GRAPH_MARKER = "fake-graph"

    /**
     * Logs every disk read and write on the main thread (tag `StrictMode`), so `SeansApp.onCreate`
     * and the first frames can be checked against "build objects only, no I/O".
     */
    fun onAppCreate() {
        StrictMode.setThreadPolicy(
            StrictMode.ThreadPolicy.Builder().detectDiskReads().detectDiskWrites().penaltyLog().build(),
        )
    }

    /**
     * The fake graph for UI work with sample data, when the marker exists:
     * `adb shell run-as app.seans.tv touch files/fake-graph` (delete it to go back to the real graph).
     * Checking the marker is itself a disk read; it is allowed here because this is debug only.
     */
    fun fakeGraphOrNull(app: Application, http: SeansHttp): AppGraph? {
        val marker = StrictMode.allowThreadDiskReads().let { old ->
            try { File(app.filesDir, FAKE_GRAPH_MARKER).exists() } finally { StrictMode.setThreadPolicy(old) }
        }
        if (!marker) return null
        Log.i("SeansDebug", "fake graph (marker files/$FAKE_GRAPH_MARKER)")
        return DemoGraph(FakeGraph(http), MainScope())
    }

    /** `--es demo_auth signed_in|not_approved|off`, `--ez demo_offline true`; only on the fake graph. */
    fun onIntent(graph: AppGraph, intent: Intent?) {
        val demo = graph as? DemoGraph ?: return
        intent?.getStringExtra("demo_auth")?.let { demo.auth.apply(it) }
        if (intent?.hasExtra("demo_offline") == true) demo.offline = intent.getBooleanExtra("demo_offline", false)
    }
}
