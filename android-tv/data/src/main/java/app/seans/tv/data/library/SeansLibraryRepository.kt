package app.seans.tv.data.library

import app.seans.tv.data.catalog.MovieMapper
import app.seans.tv.data.catalog.SeansCatalogRepository
import app.seans.tv.data.store.Doc
import app.seans.tv.data.store.DocumentStore
import app.seans.tv.data.store.ServerTimestamp
import app.seans.tv.data.store.Values
import app.seans.tv.model.AuthState
import app.seans.tv.model.BookmarkStatus
import app.seans.tv.model.ContinueItem
import app.seans.tv.model.LibraryRepository
import app.seans.tv.model.MediaType
import app.seans.tv.model.ProgressRepository
import app.seans.tv.model.SeansError
import app.seans.tv.model.TitleRef
import app.seans.tv.model.TitleSummary
import kotlin.coroutines.cancellation.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.catch
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.mapLatest
import kotlinx.coroutines.flow.onEach
import kotlinx.coroutines.flow.shareIn

/**
 * Bookmarks in the extension's `favorites` collection, exactly as `FavoriteService` keeps them:
 * one document `${uid}_${kp}` per title with one `status`; writes carry the full field set of
 * `addToFavorites`, `createdAt`/`favoritedAt` only on create and `updatedAt` as server time.
 * Read with the extension's query shape (`userId ==`, sorted on the client), so no new index
 * (R1, R5). One live listener serves every status row.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class SeansLibraryRepository internal constructor(
    private val store: DocumentStore,
    private val authState: StateFlow<AuthState>,
    private val catalog: SeansCatalogRepository,
    private val progress: ProgressRepository,
    scope: CoroutineScope,
) : LibraryRepository {
    private val uidFlow: Flow<String?> = authState
        .map { (it as? AuthState.SignedIn)?.profile?.uid }
        .distinctUntilChanged()

    /** All of the user's bookmark documents, newest first; empty for guests. */
    private val favorites: Flow<List<Doc>> = uidFlow
        .flatMapLatest { uid ->
            if (uid == null) flowOf(emptyList())
            else store.listenWhereEqual(COLLECTION, "userId", uid)
                .map { docs -> docs.sortedByDescending { sortTime(it.data) } }
                .onEach { docs -> catalog.rememberSummaries(docs.mapNotNull { summaryOf(it) }) }
                .catch { emit(emptyList()) }
        }
        .shareIn(scope, SharingStarted.WhileSubscribed(5_000), replay = 1)

    override fun bookmarks(status: BookmarkStatus): Flow<List<TitleSummary>> = favorites
        .map { docs ->
            docs.filter { BookmarkStatus.fromStored(Values.string(it.data["status"])) == status }
                .mapNotNull { summaryOf(it) }
        }
        .distinctUntilChanged()

    override suspend fun bookmarkStatus(ref: TitleRef): BookmarkStatus? {
        val uid = currentUid() ?: return null
        val doc = try {
            store.get(COLLECTION, docId(uid, ref.kinopoiskId))
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            throw mapError(e)
        }
        return doc?.let { BookmarkStatus.fromStored(Values.string(it["status"])) }
    }

    override suspend fun setBookmarkStatus(summary: TitleSummary, status: BookmarkStatus?) {
        val uid = currentUid() ?: throw SeansError(SeansError.Code.UNAUTHORIZED, "Bookmarks need a signed-in user")
        val kp = summary.ref.kinopoiskId
        val id = docId(uid, kp)
        try {
            val existing = store.get(COLLECTION, id)
            if (status == null) {
                if (existing != null) store.delete(COLLECTION, id)
                return
            }
            store.set(COLLECTION, id, payload(uid, summary, status, existing), merge = true)
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            throw mapError(e)
        }
    }

    override fun continueWatching(): Flow<List<ContinueItem>> = combine(
        progress.recent(20),
        favorites.map { docs -> docs.mapNotNull { doc -> summaryOf(doc)?.let { it.ref.kinopoiskId to it } }.toMap() },
    ) { positions, bookmarked -> positions to bookmarked }
        .mapLatest { (positions, bookmarked) ->
            positions.mapNotNull { position ->
                val kp = position.ref.kinopoiskId
                val summary = bookmarked[kp] ?: catalog.knownSummary(kp) ?: return@mapNotNull null
                // A stored episode means a series, whatever an older summary said.
                val ref = if (position.episode != null && summary.ref.mediaType != MediaType.SERIES) summary.ref.copy(mediaType = MediaType.SERIES) else summary.ref
                ContinueItem(summary.copy(ref = ref), position)
            }
        }

    private fun currentUid(): String? = (authState.value as? AuthState.SignedIn)?.profile?.uid

    companion object {
        const val COLLECTION = "favorites"

        internal fun docId(uid: String, kinopoiskId: Long) = "${uid}_$kinopoiskId"

        private fun sortTime(data: Map<String, Any?>): Long =
            Values.millis(data["updatedAt"]) ?: Values.millis(data["favoritedAt"]) ?: Values.millis(data["createdAt"]) ?: 0L

        internal fun summaryOf(doc: Doc): TitleSummary? {
            // The document ID is `${uid}_${kp}`; `movieId` is the Kinopoisk ID.
            val fallback = doc.id.substringAfterLast('_', "")
            return MovieMapper.summary(doc.data, fallback)
        }

        /**
         * `FavoriteService.addToFavorites`' field set. Fields the TV does not know (notes, the
         * Russian title, the description, seasons) and the extension's own `movieId` and poster keep
         * the existing document's values instead of being replaced by the merge.
         */
        internal fun payload(uid: String, summary: TitleSummary, status: BookmarkStatus, existing: Map<String, Any?>?): Map<String, Any?> {
            fun keep(field: String, fallback: Any?) = existing?.get(field) ?: fallback
            val data = linkedMapOf<String, Any?>(
                "userId" to uid,
                // The extension's own values win: its movieId type and its chosen poster.
                "movieId" to (existing?.get("movieId") ?: summary.ref.kinopoiskId),
                "movieTitle" to summary.title,
                "movieTitleRu" to keep("movieTitleRu", ""),
                "posterPath" to (Values.string(existing?.get("posterPath")) ?: summary.posterUrl ?: ""),
                "releaseYear" to (summary.year ?: existing?.get("releaseYear")),
                "genres" to summary.genres.ifEmpty { Values.list(existing?.get("genres")) },
                "description" to keep("description", ""),
                "kpRating" to (summary.ratings.kinopoisk ?: keep("kpRating", 0)),
                "imdbRating" to (summary.ratings.imdb ?: keep("imdbRating", 0)),
                "avgRating" to (summary.ratings.community ?: keep("avgRating", 0)),
                "userRating" to (summary.ratings.mine ?: keep("userRating", 0)),
                "notes" to keep("notes", ""),
                "type" to keep("type", if (summary.ref.mediaType == MediaType.SERIES) "tv-series" else "movie"),
                "status" to status.storedValue,
                "seasonsInfo" to keep("seasonsInfo", emptyList<Any>()),
                "updatedAt" to ServerTimestamp,
            )
            if (existing == null) {
                data["createdAt"] = ServerTimestamp
                data["favoritedAt"] = ServerTimestamp
            }
            return data
        }

        internal fun mapError(e: Exception): SeansError =
            e as? SeansError ?: SeansError(SeansError.Code.UNKNOWN, e.javaClass.simpleName, e)
    }
}
