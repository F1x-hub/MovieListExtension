package app.seans.tv.data.catalog

import app.seans.tv.data.store.Clock
import app.seans.tv.data.store.JsonFile
import app.seans.tv.model.TitleDetails
import app.seans.tv.model.TitleSummary
import java.io.File
import kotlinx.serialization.Serializable

@Serializable
internal data class CachedDetails(val details: TitleDetails, val savedAt: Long)

@Serializable
internal data class CachedSummary(val summary: TitleSummary, val savedAt: Long)

@Serializable
internal data class CatalogCacheFile(
    val details: Map<Long, CachedDetails> = emptyMap(),
    val summaries: Map<Long, CachedSummary> = emptyMap(),
    val community: List<TitleSummary> = emptyList(),
    val communitySavedAt: Long = 0,
    val schemaVersion: Int = 1,
)

/**
 * The TV's disk cache of catalogue data, one JSON file in the app's cache directory:
 * - details for 7 days, so Details reopens without the Kinopoisk proxy (K1);
 * - summaries of every title the TV has seen (search, bookmarks, details, community), so
 *   «Продолжить» draws posters and ratings without a request per card;
 * - the last community row, served at once and refreshed in the background after 6 hours.
 * Bounded; the oldest entries go first. The user's own score and bookmark are never cached.
 */
internal class CatalogCache(dir: File, private val clock: Clock) {
    private val file = JsonFile(File(dir, "catalog-cache.json"), CatalogCacheFile.serializer()) { CatalogCacheFile() }

    suspend fun details(kinopoiskId: Long): TitleDetails? = file.read().details[kinopoiskId]
        ?.takeIf { clock.nowMs() - it.savedAt < DETAILS_TTL_MS }?.details

    suspend fun putDetails(details: TitleDetails) {
        val clean = details.copy(bookmark = null, summary = details.summary.copy(ratings = details.summary.ratings.copy(mine = null)))
        val now = clock.nowMs()
        file.update { cache ->
            cache.copy(
                details = (cache.details + (clean.summary.ref.kinopoiskId to CachedDetails(clean, now))).newest(MAX_DETAILS) { it.savedAt },
                summaries = (cache.summaries + (clean.summary.ref.kinopoiskId to CachedSummary(clean.summary, now))).newest(MAX_SUMMARIES) { it.savedAt },
            )
        }
    }

    suspend fun summary(kinopoiskId: Long): TitleSummary? = file.read().summaries[kinopoiskId]?.summary

    suspend fun putSummaries(summaries: List<TitleSummary>) {
        if (summaries.isEmpty()) return
        val now = clock.nowMs()
        file.update { cache ->
            val added = summaries.associate { s ->
                s.ref.kinopoiskId to CachedSummary(s.copy(ratings = s.ratings.copy(mine = null)), now)
            }
            cache.copy(summaries = (cache.summaries + added).newest(MAX_SUMMARIES) { it.savedAt })
        }
    }

    /** The last community row, however old, and whether it is still fresh (younger than [COMMUNITY_TTL_MS]). */
    suspend fun community(): Pair<List<TitleSummary>, Boolean>? = file.read()
        .takeIf { it.community.isNotEmpty() }
        ?.let { it.community to (clock.nowMs() - it.communitySavedAt < COMMUNITY_TTL_MS) }

    suspend fun putCommunity(list: List<TitleSummary>) {
        val now = clock.nowMs()
        file.update { it.copy(community = list, communitySavedAt = now) }
        putSummaries(list)
    }

    companion object {
        const val DETAILS_TTL_MS = 7 * 24 * 60 * 60 * 1000L
        const val COMMUNITY_TTL_MS = 6 * 60 * 60 * 1000L
        const val MAX_DETAILS = 200
        const val MAX_SUMMARIES = 800
    }
}

private fun <V> Map<Long, V>.newest(max: Int, savedAt: (V) -> Long): Map<Long, V> =
    if (size <= max) this else entries.sortedByDescending { savedAt(it.value) }.take(max).associate { it.key to it.value }
