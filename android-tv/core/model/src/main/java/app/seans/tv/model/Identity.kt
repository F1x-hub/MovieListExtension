package app.seans.tv.model

import kotlinx.serialization.Serializable

/**
 * Root identity of a film or series, as in the extension: the Kinopoisk ID (> 0).
 * Firestore documents often carry composite IDs such as `${userId}_${movieId}`;
 * the data layer resolves the real Kinopoisk ID before building a [TitleRef].
 *
 * Stores key titles by [kinopoiskId] only: two refs of one title may differ in [tmdbId].
 * Build refs from network or Firestore data with [ofOrNull], so a bad document drops one row
 * item instead of crashing the app.
 */
@Serializable
data class TitleRef(
    val kinopoiskId: Long,
    val mediaType: MediaType,
    val tmdbId: Long? = null,
) {
    init { require(kinopoiskId > 0) { "kinopoiskId must be > 0, was $kinopoiskId" } }

    companion object {
        fun ofOrNull(kinopoiskId: Long?, mediaType: MediaType, tmdbId: Long? = null): TitleRef? =
            if (kinopoiskId != null && kinopoiskId > 0) TitleRef(kinopoiskId, mediaType, tmdbId?.takeIf { it > 0 }) else null
    }
}

@Serializable
enum class MediaType {
    MOVIE,
    SERIES;

    /** The value the extension writes in Firestore (`mediaType`). */
    val extensionValue: String get() = if (this == SERIES) "tv-series" else "movie"

    companion object {
        /** The extension writes `'tv-series'` for series and `'movie'` (or nothing) for films. */
        fun fromExtension(value: String?): MediaType = if (value == "tv-series" || value == "tv") SERIES else MOVIE

        /**
         * Kinopoisk's classification, as `src/shared/utils/MediaClassifier.js` does it: the
         * `isSeries` flag wins; otherwise the series types count as series. `anime` and
         * `cartoon` can be either, so without the flag they stay films.
         */
        fun fromKinopoisk(type: String?, isSeries: Boolean?): MediaType {
            if (isSeries != null) return if (isSeries) SERIES else MOVIE
            return when (type?.lowercase()) {
                "tv-series", "animated-series", "mini-series", "tv-show", "tv" -> SERIES
                else -> MOVIE
            }
        }
    }
}

/**
 * A series episode. Films have no episode: use `null`, never a 0/0 key.
 * Season 0 (specials) is valid and never leads into season 1.
 */
@Serializable
data class EpisodeKey(val season: Int, val episode: Int) : Comparable<EpisodeKey> {
    init {
        require(season >= 0) { "season must be >= 0" }
        require(episode >= 1) { "episode must be >= 1" }
    }

    override fun compareTo(other: EpisodeKey): Int =
        compareValuesBy(this, other, EpisodeKey::season, EpisodeKey::episode)

    /** Short label used in the UI: «С2 · Е5». */
    fun shortLabel(): String = "С$season · Е$episode"

    /** The key the extension uses in per-episode maps (`seriesEpisodeRatings`): `"2:5"`. */
    fun storageKey(): String = "$season:$episode"

    companion object {
        fun ofOrNull(season: Int?, episode: Int?): EpisodeKey? =
            if (season != null && episode != null && season >= 0 && episode >= 1) EpisodeKey(season, episode) else null

        fun fromStorageKey(key: String): EpisodeKey? {
            val parts = key.split(':')
            return if (parts.size == 2) ofOrNull(parts[0].toIntOrNull(), parts[1].toIntOrNull()) else null
        }
    }
}
