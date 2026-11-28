package app.seans.tv.data.catalog

import app.seans.tv.data.store.Values
import app.seans.tv.model.EpisodeInfo
import app.seans.tv.model.EpisodeKey
import app.seans.tv.model.MediaType
import app.seans.tv.model.Ratings
import app.seans.tv.model.SeasonInfo
import app.seans.tv.model.TitleDetails
import app.seans.tv.model.TitleRef
import app.seans.tv.model.TitleSummary

/**
 * One mapper for the three shapes a title arrives in: a `movies/{kp}` document (the
 * extension's normalized cache), a Kinopoisk API movie (`/v1.4/movie/{id}`, search docs) and
 * a `favorites` document. Field names follow `KinopoiskService.normalizeMovieData` and
 * `FavoriteService.addToFavorites`. A map without a valid Kinopoisk ID gives null.
 */
internal object MovieMapper {
    private const val MAX_EPISODES_PER_SEASON = 400

    /** What [summary] reads from a `movies` document; the field mask of list queries. */
    val CARD_FIELDS = listOf(
        "kinopoiskId", "id", "name", "alternativeName", "originalName", "enName", "year", "type", "isSeries",
        "posterUrl", "posterPreviewUrl", "backdropUrl", "backdrop", "kpRating", "imdbRating", "rating",
        "avgRating", "ratingsCount", "genres", "seasonsInfo", "identity", "tmdbId",
    )

    fun kinopoiskId(map: Map<String, Any?>, fallbackId: String? = null): Long? =
        (Values.long(map["kinopoiskId"]) ?: Values.long(map["id"]) ?: Values.long(map["movieId"])
            ?: fallbackId?.let { Values.long(it) })?.takeIf { it > 0 }

    fun mediaType(map: Map<String, Any?>): MediaType {
        val type = Values.string(map["type"])
        // The extension's own value wins when present ('tv-series' / 'movie').
        if (type == "tv-series" || type == "tv") return MediaType.SERIES
        val isSeries = Values.bool(map["isSeries"])
        // A bookmark of an anime series has type 'anime' and no flag, but carries its seasons.
        if (isSeries == null && Values.list(map["seasonsInfo"]).isNotEmpty()) return MediaType.SERIES
        return MediaType.fromKinopoisk(type, isSeries)
    }

    /**
     * The verified TMDB identity the extension stored (`identity.status == VERIFIED`), never
     * the raw `externalId.tmdb`, which Kinopoisk gets wrong (risks.md K3).
     */
    fun verifiedTmdbId(map: Map<String, Any?>): Long? {
        val identity = Values.map(map["identity"]) ?: return null
        if (Values.string(identity["status"]) != "VERIFIED") return null
        return Values.long(identity["tmdbId"])?.takeIf { it > 0 }
    }

    fun summary(map: Map<String, Any?>, fallbackId: String? = null): TitleSummary? {
        val kp = kinopoiskId(map, fallbackId) ?: return null
        val ref = TitleRef.ofOrNull(kp, mediaType(map), verifiedTmdbId(map)) ?: return null
        val rating = Values.map(map["rating"])
        val title = Values.string(map["name"]) ?: Values.string(map["movieTitle"]) ?: Values.string(map["movieTitleRu"])
            ?: Values.string(map["alternativeName"]) ?: Values.string(map["enName"]) ?: return null
        val original = (Values.string(map["alternativeName"]) ?: Values.string(map["originalName"]) ?: Values.string(map["enName"]))
            ?.takeIf { it != title }
        return TitleSummary(
            ref = ref,
            title = title,
            originalTitle = original,
            year = (Values.int(map["year"]) ?: Values.int(map["releaseYear"]))?.takeIf { it in 1880..2200 },
            posterUrl = posterUrl(map),
            backdropUrl = backdropUrl(map),
            ratings = Ratings(
                kinopoisk = Values.rating(map["kpRating"]) ?: Values.rating(rating?.get("kp")),
                imdb = Values.rating(map["imdbRating"]) ?: Values.rating(rating?.get("imdb")),
                community = Values.rating(map["avgRating"]),
            ),
            // All genres: source routing (anime) looks past the first few.
            genres = Values.names(map["genres"]),
        )
    }

    fun details(map: Map<String, Any?>, fallbackId: String? = null): TitleDetails? {
        val summary = summary(map, fallbackId) ?: return null
        val description = Values.string(map["description"]) ?: Values.string(map["shortDescription"])
        val age = Values.int(map["ageRating"])?.takeIf { it > 0 }?.let { "$it+" }
        val seasons = if (summary.ref.mediaType == MediaType.SERIES) seasons(map) else emptyList()
        return TitleDetails(
            summary = summary,
            description = description,
            countries = Values.names(map["countries"]),
            durationMinutes = (Values.int(map["movieLength"]) ?: Values.int(map["duration"]) ?: Values.int(map["seriesLength"]))
                ?.takeIf { it in 1..2000 },
            ageRating = age,
            seasons = seasons,
        )
    }

    /** True when a `movies` document carries what Details shows; otherwise the proxy is asked once. */
    fun isComplete(map: Map<String, Any?>): Boolean =
        Values.string(map["description"]) != null && Values.string(map["name"]) != null && posterUrl(map) != null

    /** `seasonsInfo: [{ number, episodesCount }]` → seasons with numbered episodes; Season 0 kept. */
    fun seasons(map: Map<String, Any?>): List<SeasonInfo> = Values.list(map["seasonsInfo"])
        .mapNotNull { Values.map(it) }
        .mapNotNull { season ->
            val number = Values.int(season["number"])?.takeIf { it >= 0 } ?: return@mapNotNull null
            val count = Values.int(season["episodesCount"])?.coerceAtMost(MAX_EPISODES_PER_SEASON) ?: 0
            if (count <= 0) return@mapNotNull null
            SeasonInfo(number, (1..count).mapNotNull { e -> EpisodeKey.ofOrNull(number, e)?.let { EpisodeInfo(it) } })
        }
        .distinctBy { it.number }
        .sortedBy { it.number }

    fun posterUrl(map: Map<String, Any?>): String? {
        val poster = Values.map(map["poster"])
        val raw = Values.string(map["posterUrl"]) ?: Values.string(map["posterPath"]) ?: Values.string(map["posterPreviewUrl"])
            ?: Values.string(poster?.get("url")) ?: Values.string(poster?.get("previewUrl"))
        return raw?.let { sizedImage(it, TMDB_POSTER) }
    }

    fun backdropUrl(map: Map<String, Any?>): String? {
        val backdrop = map["backdrop"]
        val raw = Values.string(map["backdropUrl"]) ?: Values.string(backdrop) ?: Values.string(Values.map(backdrop)?.get("url"))
        return raw?.let { sizedImage(it, TMDB_BACKDROP) }
    }

    private const val TMDB_POSTER = "w342"
    private const val TMDB_BACKDROP = "w1280"

    /**
     * https only, and TMDB images at a size the TV shows (risks.md M3): posters w342, heroes
     * w1280. Kinopoisk/Yandex images keep their own size (`600x900`, already small).
     */
    fun sizedImage(url: String, tmdbSize: String): String? {
        var value = url.trim()
        if (value.startsWith("//")) value = "https:$value"
        if (value.startsWith("http://")) value = "https://" + value.removePrefix("http://")
        if (!value.startsWith("https://")) {
            // A bare TMDB path from a TMDB response («/abc.jpg»).
            return if (value.startsWith("/") && value.length > 1) "https://image.tmdb.org/t/p/$tmdbSize$value" else null
        }
        val tmdb = Regex("^https://image\\.tmdb\\.org/t/p/[^/]+/")
        return if (tmdb.containsMatchIn(value)) value.replace(tmdb, "https://image.tmdb.org/t/p/$tmdbSize/") else value
    }
}
