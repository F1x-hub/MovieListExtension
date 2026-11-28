package app.seans.tv

import android.app.Application
import app.seans.tv.data.DataModule
import app.seans.tv.live.LiveModule
import app.seans.tv.model.AppGraph
import app.seans.tv.network.SeansHttp
import app.seans.tv.sources.SourcesModule
import java.io.File
import coil3.ImageLoader
import coil3.PlatformContext
import coil3.SingletonImageLoader
import coil3.disk.DiskCache
import coil3.memory.MemoryCache
import coil3.network.okhttp.OkHttpNetworkFetcherFactory
import coil3.request.crossfade
import com.google.firebase.FirebaseApp
import com.google.firebase.FirebaseOptions
import com.google.firebase.auth.FirebaseAuth
import com.google.firebase.firestore.FirebaseFirestore
import com.google.firebase.firestore.FirebaseFirestoreSettings
import com.google.firebase.firestore.PersistentCacheSettings
import okio.Path.Companion.toOkioPath

/**
 * Builds the [AppGraph] once. `onCreate` only builds objects: no disk or network I/O, so Home can
 * draw its first frame before anything answers (`android-tv/AGENTS.md`, cold start budget).
 *
 * Firebase is initialised here once, with the web app's options (the key is public and shared
 * with the extension; `src/shared/firestore.js`). [firebaseAuth] and [firestore] are lazy and are
 * created when [buildGraph] hands them to the modules (`FirebaseAuth.getInstance` reads its
 * persisted user from disk); Firestore gets its 20 MB persistent cache in that same first touch,
 * before anything can use it. Modules receive these instances
 * through their constructors and never call `getInstance()` themselves.
 */
class SeansApp : Application(), SingletonImageLoader.Factory {
    lateinit var graph: AppGraph
        private set

    lateinit var firebaseApp: FirebaseApp
        private set

    val firebaseAuth: FirebaseAuth by lazy { FirebaseAuth.getInstance(firebaseApp) }

    val firestore: FirebaseFirestore by lazy {
        FirebaseFirestore.getInstance(firebaseApp).apply {
            firestoreSettings = FirebaseFirestoreSettings.Builder()
                .setLocalCacheSettings(PersistentCacheSettings.newBuilder().setSizeBytes(FIRESTORE_CACHE_BYTES).build())
                .build()
        }
    }

    override fun onCreate() {
        super.onCreate()
        DebugHooks.onAppCreate() // debug: StrictMode logs main-thread disk access; release: nothing
        firebaseApp = FirebaseApp.getApps(this).firstOrNull { it.name == FirebaseApp.DEFAULT_APP_NAME }
            ?: FirebaseApp.initializeApp(this, firebaseOptions())
        val http = SeansHttp(cacheDir)
        graph = buildGraph(http)
    }

    /**
     * The real graph (wired 2026-11-28). Constructing the modules touches [firebaseAuth] and
     * [firestore] (`FirebaseAuth.getInstance` reads its persisted user, a few ms); the modules
     * themselves do no I/O until first use. The sketch it replaced:
     *
     * ```
     * val data = DataModule(this, firebaseAuth, firestore, http)                     // tv-data
     * val sources = SourcesModule(http, stateDir = File(filesDir, "sources"))        // tv-sources
     * val live: LiveFeature = LiveModule(firestore, http)                            // tv-live
     * object : AppGraph {
     *     override val http = http
     *     override val auth = data.auth
     *     override val catalog = data.catalog
     *     override val library = data.library
     *     override val progress = data.progress
     *     override val sources = sources.resolver
     *     override val live = live
     * }
     * ```
     * The module constructors stay I/O-free, but taking [firebaseAuth]/[firestore] as instances
     * creates them here, on the main thread before the first frame. If the release cold start
     * misses the 3 s budget, pass `Lazy<FirebaseAuth>`/`Lazy<FirebaseFirestore>` to `:data` and
     * `:live` instead (a contract change).
     */
    private fun buildGraph(http: SeansHttp): AppGraph {
        // Debug builds can still run on the fake graph for UI work (marker `files/fake-graph`,
        // see `src/debug/.../DebugHooks.kt`). The release stub returns null: no fake code ships.
        DebugHooks.fakeGraphOrNull(this, http)?.let { return it }
        val data = DataModule(this, firebaseAuth, firestore, http)
        val sources = SourcesModule(http, stateDir = File(filesDir, "sources"))
        val live = LiveModule(firestore, http)
        return object : AppGraph {
            override val http = http
            override val auth = data.auth
            override val catalog = data.catalog
            override val library = data.library
            override val progress = data.progress
            override val sources = sources.resolver
            override val live = live
        }
    }

    /**
     * One image loader for the app: OkHttp through `SeansHttp.mediaClient` (DNS-over-HTTPS, no
     * HTTP cache), a memory cache of 15% of the memory class (the heap limit is 128 MB) and a
     * 100 MB disk cache. Every request also sets its own decode size (`SeansImage`).
     */
    override fun newImageLoader(context: PlatformContext): ImageLoader =
        ImageLoader.Builder(context)
            .components { add(OkHttpNetworkFetcherFactory(callFactory = { graph.http.mediaClient })) }
            .memoryCache { MemoryCache.Builder().maxSizePercent(context, 0.15).build() }
            .diskCache {
                DiskCache.Builder()
                    .directory(context.cacheDir.resolve("images").toOkioPath())
                    .maxSizeBytes(100L * 1024 * 1024)
                    .build()
            }
            .crossfade(false)
            .build()

    private fun firebaseOptions(): FirebaseOptions = FirebaseOptions.Builder()
        // The extension's web app config (src/shared/firestore.js). The key is public by design.
        .setApiKey("AIzaSyC6PI4cBRzn6KLVJ6ikensKus6LaulabO4")
        .setApplicationId("1:532518163829:web:36a6a62a14adc188f1af3c")
        .setProjectId("movielistdb-13208")
        .setStorageBucket("movielistdb-13208.firebasestorage.app")
        .setGcmSenderId("532518163829")
        .build()

    private companion object {
        const val FIRESTORE_CACHE_BYTES = 20L * 1024 * 1024
    }
}
