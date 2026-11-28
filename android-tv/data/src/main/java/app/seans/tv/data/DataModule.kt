package app.seans.tv.data

import android.content.Context
import android.os.Build
import app.seans.tv.data.auth.DeviceLoginApi
import app.seans.tv.data.auth.SeansAuthRepository
import app.seans.tv.data.catalog.CatalogCache
import app.seans.tv.data.catalog.KinopoiskApi
import app.seans.tv.data.catalog.KinopoiskQuotaGuard
import app.seans.tv.data.catalog.SeansCatalogRepository
import app.seans.tv.data.catalog.TmdbApi
import app.seans.tv.data.library.SeansLibraryRepository
import app.seans.tv.data.progress.SeansProgressRepository
import app.seans.tv.data.store.Clock
import app.seans.tv.data.store.FirebaseAuthBackend
import app.seans.tv.data.store.FirebaseDocumentStore
import app.seans.tv.data.store.FirestoreRestQueries
import app.seans.tv.data.store.SharedPrefsKeyValueStore
import app.seans.tv.model.AuthRepository
import app.seans.tv.model.CatalogRepository
import app.seans.tv.model.LibraryRepository
import app.seans.tv.model.ProgressRepository
import app.seans.tv.network.SeansHttp
import com.google.firebase.auth.FirebaseAuth
import com.google.firebase.firestore.FirebaseFirestore
import java.io.File
import java.util.Locale
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob

/** Endpoints; the defaults are production. A debug build may point the functions at the emulator. */
data class DataConfig(
    /** `https://us-central1-movielistdb-13208.cloudfunctions.net`, or `http://localhost:5001/movielistdb-13208/us-central1` over `adb reverse`. */
    val functionsBaseUrl: String = PRODUCTION_FUNCTIONS,
    /** The proxies stay on production even against the Functions emulator (they need provider keys). */
    val proxiesBaseUrl: String = PRODUCTION_FUNCTIONS,
) {
    companion object {
        const val PRODUCTION_FUNCTIONS = "https://us-central1-movielistdb-13208.cloudfunctions.net"
    }
}

/**
 * The `:data` repositories, built by `SeansApp` (`:app`) with the Firebase instances it
 * initialised and the shared HTTP stack. Construction does no disk or network I/O; every
 * repository starts on first use. Never calls `FirebaseApp.initializeApp` or `getInstance()`.
 */
class DataModule(
    context: Context,
    auth: FirebaseAuth,
    firestore: FirebaseFirestore,
    http: SeansHttp,
    config: DataConfig = DataConfig(),
) {
    private val appContext = context.applicationContext
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
    private val clock = Clock.SYSTEM
    private val prefs = SharedPrefsKeyValueStore(appContext)
    private val documents = FirebaseDocumentStore(firestore)

    private val authRepository = SeansAuthRepository(
        backend = FirebaseAuthBackend(auth),
        store = documents,
        prefs = prefs,
        api = DeviceLoginApi(http.client, config.functionsBaseUrl),
        deviceName = deviceName(),
        scope = scope,
        clock = clock,
    )

    private val catalogRepository by lazy {
        SeansCatalogRepository(
            store = documents,
            projected = FirestoreRestQueries(
                client = http.client,
                projectId = firestore.app.options.projectId ?: "movielistdb-13208",
                apiKey = firestore.app.options.apiKey,
                idToken = { authRepository.idToken() },
            ),
            kinopoisk = KinopoiskApi(
                client = http.client,
                proxyUrl = "${config.proxiesBaseUrl.trimEnd('/')}/kinopoiskProxy",
                idToken = { authRepository.idToken() },
                quota = KinopoiskQuotaGuard(prefs, clock),
            ),
            tmdb = TmdbApi(http.client, "${config.proxiesBaseUrl.trimEnd('/')}/tmdbProxy"),
            cache = CatalogCache(File(appContext.cacheDir, "seans-data"), clock),
            uid = { authRepository.currentUid() },
            scope = scope,
            clock = clock,
        )
    }

    private val progressRepository by lazy { SeansProgressRepository(File(appContext.filesDir, "seans-data")) }

    private val libraryRepository by lazy {
        SeansLibraryRepository(
            store = documents,
            authState = authRepository.state,
            catalog = catalogRepository,
            progress = progressRepository,
            scope = scope,
        )
    }

    val auth: AuthRepository get() = authRepository
    val catalog: CatalogRepository get() = catalogRepository
    val library: LibraryRepository get() = libraryRepository
    val progress: ProgressRepository get() = progressRepository

    private companion object {
        /** «Телевизор TCL»: what the approval dialog names (risks.md S3). */
        fun deviceName(): String {
            val maker = Build.MANUFACTURER?.trim().orEmpty()
            val label = when {
                maker.isEmpty() -> ""
                maker.length <= 4 -> maker.uppercase(Locale.ROOT)
                else -> maker.replaceFirstChar { it.titlecase(Locale.ROOT) }
            }
            return if (label.isEmpty()) "Телевизор" else "Телевизор $label"
        }
    }
}
