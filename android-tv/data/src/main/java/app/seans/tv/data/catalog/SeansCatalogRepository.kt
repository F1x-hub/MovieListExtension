package app.seans.tv.data.catalog

import app.seans.tv.data.store.Clock
import app.seans.tv.data.store.DocumentStore
import app.seans.tv.data.store.ProjectedQueries
import app.seans.tv.data.store.Values
import app.seans.tv.model.BookmarkStatus
import app.seans.tv.model.CatalogRepository
import app.seans.tv.model.EpisodeInfo
import app.seans.tv.model.EpisodeKey
import app.seans.tv.model.MediaType
import app.seans.tv.model.SeansError
import app.seans.tv.model.SeasonInfo
import app.seans.tv.model.TitleDetails
import app.seans.tv.model.TitleRef
import app.seans.tv.model.TitleSummary
import java.util.Locale
import java.util.concurrent.ConcurrentHashMap
import kotlin.coroutines.cancellation.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.CoroutineStart
import kotlinx.coroutines.Deferred
import kotlinx.coroutines.Job
import kotlinx.coroutines.launch
import kotlinx.coroutines.async
import kotlinx.coroutines.coroutineScope

/**
 * The catalogue, with the Kinopoisk quota shared with the extension in mind (risks.md K1):
 *
 * - Details: `movies/{kp}` (public) → the TV's 7-day disk cache → `kinopoiskProxy` once (signed
 *   in only). Concurrent opens of one title share one request. The user's score
 *   (`ratings/{uid}_{kp}`) and bookmark (`favorites/{uid}_{kp}`) are read from Firestore.
 * - TMDB identity only from `tmdbKinopoiskMappings` (via its reverse index) or the identity the
 *   extension verified on the `movies` document (K3), never from Kinopoisk's `externalId.tmdb`.
 * - Search: `tmdbProxy` for everyone, mapped to Kinopoisk IDs through `movies.tmdbId`, plus one
 *   Kinopoisk search for signed-in users. Debouncing is the caller's job; results are cached.
 * - Community: `movies` by `avgRating` (the extension's `getMoviesByAvgRating` shape).
 * - Lists of `movies` documents go through [ProjectedQueries] with only the card fields: whole
 *   documents are large (24 took 18 s on the TV through the SDK).
 */
class SeansCatalogRepository internal constructor(
    private val store: DocumentStore,
    private val projected: ProjectedQueries,
    private val kinopoisk: KinopoiskApi,
    private val tmdb: TmdbApi,
    private val cache: CatalogCache,
    private val uid: () -> String?,
    private val scope: CoroutineScope,
    private val clock: Clock = Clock.SYSTEM,
) : CatalogRepository {
    private val inFlight = ConcurrentHashMap<Long, Deferred<TitleDetails>>()
    private val searchCache = object : LinkedHashMap<String, Pair<Long, List<TitleSummary>>>(16, 0.75f, true) {
        override fun removeEldestEntry(eldest: MutableMap.MutableEntry<String, Pair<Long, List<TitleSummary>>>?) = size > 30
    }

    override suspend fun details(ref: TitleRef): TitleDetails {
        val kp = ref.kinopoiskId
        // Lazy, so the completion handler is in place before the load can finish.
        val shared = inFlight.computeIfAbsent(kp) { scope.async(start = CoroutineStart.LAZY) { loadBase(ref) } }
        shared.invokeOnCompletion { inFlight.remove(kp, shared) }
        shared.start()
        return personalize(shared.await())
    }

    /** Everything except the user's own score and bookmark. */
    private suspend fun loadBase(ref: TitleRef): TitleDetails {
        val kp = ref.kinopoiskId
        val doc = readOrNull { store.get("movies", kp.toString()) }
        val fromDoc = doc?.let { MovieMapper.details(it, kp.toString()) }
        val community = doc?.let { Values.rating(it["avgRating"]) }

        var base: TitleDetails? = fromDoc?.takeIf { MovieMapper.isComplete(doc) }
        if (base == null) base = cache.details(kp)
        if (base == null && uid() != null) {
            base = try {
                MovieMapper.details(kinopoisk.movie(kp), kp.toString())?.also { cache.putDetails(it) }
            } catch (e: SeansError) {
                if (fromDoc == null) throw e
                null // quota or network: the partial `movies` document still has a title and a poster
            }
        }
        base = base ?: fromDoc ?: throw SeansError(
            if (uid() == null) SeansError.Code.UNAUTHORIZED else SeansError.Code.NOT_FOUND,
            "No catalogue data for $kp",
        )
        if (base.summary.ref.kinopoiskId != kp) throw SeansError(SeansError.Code.PROVIDER_CHANGED, "Kinopoisk answered another title")

        // Identity: the caller's ref knows the media type the row came with; Kinopoisk knows better.
        val tmdbId = base.summary.ref.tmdbId ?: ref.tmdbId ?: mappedTmdbId(kp, base.summary.ref.mediaType)
        var details = base.copy(
            summary = base.summary.copy(
                ref = TitleRef(kp, base.summary.ref.mediaType, tmdbId),
                ratings = base.summary.ratings.copy(community = community ?: base.summary.ratings.community),
            ),
        )
        if (details.summary.ref.mediaType == MediaType.SERIES && details.seasons.isEmpty() && tmdbId != null) {
            val seasons = readOrNull { tmdbSeasons(tmdbId) }.orEmpty()
            if (seasons.isNotEmpty()) {
                details = details.copy(seasons = seasons)
                cache.putDetails(details)
            }
        }
        cache.putSummaries(listOf(details.summary))
        return details
    }

    private suspend fun personalize(base: TitleDetails): TitleDetails {
        val user = uid() ?: return base
        val kp = base.summary.ref.kinopoiskId
        return coroutineScope {
            val rating = async { readOrNull { store.get("ratings", "${user}_$kp") } }
            val favorite = async { readOrNull { store.get("favorites", "${user}_$kp") } }
            val mine = Values.int(rating.await()?.get("rating"))?.takeIf { it in 1..10 }
            val bookmark = favorite.await()?.let { BookmarkStatus.fromStored(Values.string(it["status"])) }
            base.copy(summary = base.summary.copy(ratings = base.summary.ratings.copy(mine = mine)), bookmark = bookmark)
        }
    }

    /** `tmdbKinopoiskReverseIndex/kp:{tv|movie}:{kp}` (admin-verified, signed-in read). */
    private suspend fun mappedTmdbId(kp: Long, mediaType: MediaType): Long? {
        if (uid() == null) return null
        val key = "kp:${if (mediaType == MediaType.SERIES) "tv" else "movie"}:$kp"
        val doc = readOrNull { store.get("tmdbKinopoiskReverseIndex", key) } ?: return null
        return Values.long(doc["tmdbId"])?.takeIf { it > 0 && Values.long(doc["kpId"]) == kp }
    }

    /** One TMDB call: season numbers and episode counts (titles and stills need one call per season). */
    private suspend fun tmdbSeasons(tmdbId: Long): List<SeasonInfo> {
        val tv = tmdb.get("tv/$tmdbId?language=ru-RU")
        return Values.list(tv["seasons"]).mapNotNull { Values.map(it) }.mapNotNull { s ->
            val number = Values.int(s["season_number"])?.takeIf { it >= 0 } ?: return@mapNotNull null
            val count = Values.int(s["episode_count"])?.coerceAtMost(400) ?: 0
            if (count <= 0) null
            else SeasonInfo(number, (1..count).mapNotNull { e -> EpisodeKey.ofOrNull(number, e)?.let { EpisodeInfo(it) } })
        }.sortedBy { it.number }
    }

    override suspend fun search(query: String): List<TitleSummary> {
        val q = query.trim().replace(Regex("\\s+"), " ")
        if (q.length < 3) return emptyList()
        val signedIn = uid() != null
        val key = "${if (signedIn) "u" else "g"}:${q.lowercase(Locale.ROOT)}"
        synchronized(searchCache) {
            searchCache[key]?.let { (at, list) -> if (clock.nowMs() - at < SEARCH_TTL_MS) return list }
        }
        val results = coroutineScope {
            val kpPart = if (signedIn) async { runCatchingSeans { kinopoisk.search(q).mapNotNull { MovieMapper.summary(it) } } } else null
            val tmdbPart = async { runCatchingSeans { tmdbSearch(q) } }
            val kpResult = kpPart?.await()
            val tmdbResult = tmdbPart.await()
            if (kpResult?.isFailure != false && tmdbResult.isFailure) {
                throw (kpResult?.exceptionOrNull() ?: tmdbResult.exceptionOrNull())!!
            }
            (kpResult?.getOrNull().orEmpty() + tmdbResult.getOrNull().orEmpty()).distinctBy { it.ref.kinopoiskId }
        }
        synchronized(searchCache) { searchCache[key] = clock.nowMs() to results }
        cache.putSummaries(results)
        return results
    }

    /** TMDB hits that the extension's `movies` collection knows by `tmdbId` (one `in` query per 30). */
    private suspend fun tmdbSearch(query: String): List<TitleSummary> {
        val hits = tmdb.searchMulti(query).take(30)
        if (hits.isEmpty()) return emptyList()
        val docs = projected.whereIn("movies", "tmdbId", hits.map { it.second }, MovieMapper.CARD_FIELDS)
        val byTmdb = docs.groupBy { Values.long(it.data["tmdbId"]) }
        return hits.mapNotNull { (type, tmdbId) ->
            val candidates = byTmdb[tmdbId].orEmpty()
            // A movie and a series can share a TMDB number: match the kind too.
            val doc = candidates.firstOrNull { (MovieMapper.mediaType(it.data) == MediaType.SERIES) == (type == "tv") }
                ?: return@mapNotNull null
            MovieMapper.summary(doc.data, doc.id)
        }
    }

    /**
     * The last row from disk at once (Home fills without waiting); a row older than six hours is
     * refreshed in the background for the next open. Only the very first open waits for the query.
     */
    override suspend fun popularInCommunity(): List<TitleSummary> {
        val cached = cache.community()
        if (cached != null) {
            val (list, fresh) = cached
            if (!fresh && communityRefresh?.isActive != true) {
                communityRefresh = scope.launch { runCatchingSeans { loadCommunity() } }
            }
            return list
        }
        return loadCommunity()
    }

    @Volatile private var communityRefresh: Job? = null

    /** Tests: waits for a background community refresh, if one runs. */
    internal suspend fun awaitCommunityRefresh() { communityRefresh?.join() }

    private suspend fun loadCommunity(): List<TitleSummary> {
        val docs = projected.whereEqualOrderedDesc("movies", "hasCommunityRating", true, "avgRating", COMMUNITY_LIMIT, MovieMapper.CARD_FIELDS)
        // A single 10 should not outrank twenty 9s: smooth each average towards 7 by two votes.
        val list = docs
            .filter { (Values.long(it.data["ratingsCount"]) ?: 0) > 0 }
            .sortedByDescending { doc ->
                val count = Values.long(doc.data["ratingsCount"]) ?: 0
                val avg = Values.double(doc.data["avgRating"]) ?: 0.0
                (avg * count + 7.0 * 2) / (count + 2)
            }
            .mapNotNull { MovieMapper.summary(it.data, it.id) }
            .take(COMMUNITY_SHOWN)
        if (list.isNotEmpty()) cache.putCommunity(list)
        return list
    }

    /** A community title with a wide picture, changing once a day; no extra reads. */
    override suspend fun featured(): TitleSummary? {
        val pool = runCatchingSeans { popularInCommunity() }.getOrNull().orEmpty()
        val withBackdrop = pool.filter { it.backdropUrl != null }.ifEmpty { pool }
        if (withBackdrop.isEmpty()) return null
        val day = (clock.nowMs() / (24 * 60 * 60 * 1000L)).toInt()
        return withBackdrop[Math.floorMod(day, withBackdrop.size)]
    }

    /** A summary the TV already has (cache, then the public `movies` document); never Kinopoisk. */
    internal suspend fun knownSummary(kinopoiskId: Long): TitleSummary? {
        cache.summary(kinopoiskId)?.let { return it }
        val doc = readOrNull { store.get("movies", kinopoiskId.toString()) } ?: return null
        return MovieMapper.summary(doc, kinopoiskId.toString())?.also { cache.putSummaries(listOf(it)) }
    }

    internal suspend fun rememberSummaries(list: List<TitleSummary>) = cache.putSummaries(list)

    companion object {
        private const val SEARCH_TTL_MS = 10 * 60 * 1000L
        private const val COMMUNITY_LIMIT = 60
        private const val COMMUNITY_SHOWN = 24
    }
}

private suspend fun <T> readOrNull(block: suspend () -> T?): T? = try {
    block()
} catch (e: CancellationException) {
    throw e
} catch (_: Exception) {
    null
}

private inline fun <T> runCatchingSeans(block: () -> T): Result<T> = try {
    Result.success(block())
} catch (e: CancellationException) {
    throw e
} catch (e: SeansError) {
    Result.failure(e)
} catch (e: Exception) {
    Result.failure(SeansError(SeansError.Code.UNKNOWN, e.javaClass.simpleName, e))
}
