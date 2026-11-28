package app.seans.tv.model

import app.seans.tv.network.SeansHttp

/**
 * The app's dependencies, built once in `SeansApp` (`:app`). Manual DI: no Hilt.
 *
 * Firebase is initialised once in `SeansApp.onCreate` with manual `FirebaseOptions` (the web
 * app's config; the key is public) and its `FirebaseAuth`/`FirebaseFirestore` instances are passed
 * to the `:data` and `:live` constructors. No module calls `getInstance()` or
 * `FirebaseApp.initializeApp` itself.
 */
interface AppGraph {
    /** The only HTTP stack: ExoPlayer, Coil, parsers and proxies all use it. */
    val http: SeansHttp
    val auth: AuthRepository
    val catalog: CatalogRepository
    val library: LibraryRepository
    val progress: ProgressRepository
    val sources: SourceResolver
    val live: LiveSummaryProvider
}
