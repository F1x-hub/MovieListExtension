package app.seans.tv.live.channel

import java.util.Date

/*
 * Kotlin port of the viewer half of `src/shared/services/CinemaChannelService.js`.
 *
 * The port keeps the JavaScript semantics on purpose: instants are `Double` milliseconds with
 * `NaN` for «missing» and `Infinity` for «no end», exactly as the extension computes them, so the
 * two clients agree on every edge case (L1 in `android-tv/docs/risks.md`). Admin writes
 * (`control`, `schedule`, `setMovieDuration`, ...) are deliberately not ported: the TV never
 * writes the channel (R3).
 */

enum class ChannelMode { OFF, YOUTUBE, MOVIE }

/** `youtube` map of a channel document. [pausedAtSec] is NaN when not paused (always for a live stream). */
data class YoutubeMedia(
    val videoId: String,
    val live: Boolean,
    val durationSec: Long,
    val pausedAtSec: Double,
)

/** `movie` map of a channel document. Episode fields are all set (series) or all null (film). */
data class MovieMedia(
    val kinopoiskId: Long,
    val durationSec: Long,
    val durationMeasured: Boolean,
    val posterUrl: String,
    val pausedAtSec: Double,
    val tmdbId: Long? = null,
    /** `"tv-series"` or null. */
    val mediaType: String? = null,
    val seasonNumber: Int? = null,
    val episodeNumber: Int? = null,
    val episodeTitle: String? = null,
) {
    val isEpisode: Boolean get() = mediaType == SERIES
}

/**
 * A normalized channel item: the manual channel (`settings/cinemaChannel`) or a schedule entry
 * (`cinemaSchedule/{id}`, [scheduled] = true). Mirrors the object `normalizeChannel` returns.
 */
data class Channel(
    val id: String,
    val docPath: String,
    val scheduled: Boolean,
    val mode: ChannelMode,
    val title: String,
    val youtube: YoutubeMedia?,
    val movie: MovieMedia?,
    /** Grid start (server ms). For a manual channel also the playback clock. NaN when missing. */
    val startedAtMs: Double,
    /** Fixed slot end; NaN for manual items. */
    val endsAtMs: Double,
    /** Separate seek clock of a scheduled item; NaN when unset. Never a grid boundary. */
    val playbackStartedAtMs: Double,
    val explicitEnd: Boolean,
    val updatedAtMs: Double,
) {
    /** `channel[channel.mode]?.durationSec || 0`. */
    val mediaDurationSec: Long get() = when (mode) {
        ChannelMode.MOVIE -> movie?.durationSec ?: 0
        ChannelMode.YOUTUBE -> youtube?.durationSec ?: 0
        ChannelMode.OFF -> 0
    }

    /** `channel[channel.mode]?.pausedAtSec`, NaN when not paused. */
    val mediaPausedAtSec: Double get() = when (mode) {
        ChannelMode.MOVIE -> movie?.pausedAtSec ?: Double.NaN
        ChannelMode.YOUTUBE -> youtube?.pausedAtSec ?: Double.NaN
        ChannelMode.OFF -> Double.NaN
    }

    val isLiveStream: Boolean get() = mode == ChannelMode.YOUTUBE && youtube?.live == true

    /** `docPath || id`: the programme's identity of an item. */
    val identity: String get() = docPath.ifEmpty { id }
}

/** Stand-in for JavaScript's `undefined`: a key that is absent, as opposed to present with null. */
internal object Undefined

internal const val SERIES = "tv-series"
internal const val COLLECTION = "settings"
internal const val SCHEDULE_COLLECTION = "cinemaSchedule"
internal const val DOC_ID = "cinemaChannel"
internal const val MAX_TITLE = 120
internal const val MAX_EPISODE_TITLE = 200
internal const val MAX_SAFE_INTEGER = 9_007_199_254_740_991.0

/** Where a normalized item lives (`meta` of `normalizeChannel`). */
data class ChannelMeta(
    val id: String? = null,
    val docPath: String? = null,
    val scheduled: Boolean = false,
) {
    companion object {
        fun schedule(id: String) = ChannelMeta(id, "$SCHEDULE_COLLECTION/$id", scheduled = true)
    }
}

private class EpisodeError : Exception()

private fun Map<*, *>.js(key: String): Any? = if (containsKey(key)) get(key) else Undefined

/** JavaScript `Number(value)`. Firestore values only: numbers, strings, booleans, null, dates. */
internal fun jsNumber(value: Any?): Double = when (value) {
    Undefined -> Double.NaN
    null -> 0.0
    is Boolean -> if (value) 1.0 else 0.0
    is Number -> value.toDouble()
    is String -> value.trim().let { if (it.isEmpty()) 0.0 else it.toDoubleOrNull() ?: Double.NaN }
    is Date -> value.time.toDouble()
    else -> Double.NaN
}

/** JavaScript truthiness for the values a document can hold. */
private fun truthy(value: Any?): Boolean = when (value) {
    Undefined, null -> false
    is Boolean -> value
    is Number -> value.toDouble().let { it != 0.0 && !it.isNaN() }
    is String -> value.isNotEmpty()
    else -> true
}

/** `Number.isSafeInteger(value) && value >= minimum` (no string coercion). */
private fun safeInteger(value: Any?, minimum: Long): Long? {
    val number = when (value) {
        is Long, is Int, is Short, is Byte -> (value as Number).toDouble()
        is Double, is Float -> (value as Number).toDouble()
        else -> return null
    }
    if (!number.isFinite() || number != Math.floor(number) || Math.abs(number) > MAX_SAFE_INTEGER) return null
    return if (number >= minimum) number.toLong() else null
}

/** `toMillis`: Firestore timestamps arrive as [Date] (the data layer converts them), tests may use numbers. */
fun toMillis(value: Any?): Double = when (value) {
    Undefined, null, false -> Double.NaN
    is Date -> value.time.toDouble()
    is Number -> value.toDouble()
    is Map<*, *> -> {
        val seconds = value["seconds"]
        if (seconds is Number) {
            val nanos = (value["nanoseconds"] as? Number)?.toDouble() ?: 0.0
            seconds.toDouble() * 1000 + Math.floor(nanos / 1e6)
        } else Double.NaN
    }
    is String -> runCatching { java.time.Instant.parse(value).toEpochMilli().toDouble() }.getOrDefault(Double.NaN)
    else -> Double.NaN
}

private fun readPause(value: Any?): Double {
    if (value == null || value == Undefined) return Double.NaN
    val sec = jsNumber(value)
    return if (sec.isFinite() && sec >= 0) sec else Double.NaN
}

/** JavaScript `Math.round`, NaN-preserving. */
internal fun jsRound(value: Double): Double = if (value.isNaN() || value.isInfinite()) value else Math.floor(value + 0.5)

private fun readDuration(value: Any?): Long {
    val sec = jsNumber(value)
    return if (sec.isFinite() && sec > 0) jsRound(sec).toLong() else 0
}

fun safeImageUrl(value: Any?): String {
    val url = (if (truthy(value)) value.toString() else "").trim()
    return if (Regex("^https://[^\\s\"'<>]{1,500}$").matches(url)) url else ""
}

private data class EpisodeFields(
    val tmdbId: Long? = null,
    val mediaType: String? = null,
    val seasonNumber: Int? = null,
    val episodeNumber: Int? = null,
    val episodeTitle: String? = null,
)

/** Stored episode metadata is optional, but a declared episode is always complete (`readEpisodeFields`). */
private fun readEpisodeFields(source: Map<*, *>): EpisodeFields {
    var fields = EpisodeFields()
    val tmdb = source.js("tmdbId")
    if (tmdb != Undefined) {
        val tmdbId = safeInteger(tmdb, 1) ?: throw EpisodeError()
        fields = fields.copy(tmdbId = tmdbId)
    }
    val hasEpisode = listOf("seasonNumber", "episodeNumber", "episodeTitle").any { source.js(it) != Undefined }
    val mediaType = source.js("mediaType")
    if (mediaType == Undefined) {
        if (hasEpisode) throw EpisodeError()
        return fields
    }
    if (mediaType != SERIES) throw EpisodeError()
    val season = safeInteger(source.js("seasonNumber"), 0)
    val episode = safeInteger(source.js("episodeNumber"), 1)
    if (season == null || episode == null || season > Int.MAX_VALUE || episode > Int.MAX_VALUE) throw EpisodeError()
    fields = fields.copy(mediaType = SERIES, seasonNumber = season.toInt(), episodeNumber = episode.toInt())
    val title = source.js("episodeTitle")
    if (title != Undefined) {
        if (title !is String || title.length > MAX_EPISODE_TITLE) throw EpisodeError()
        fields = fields.copy(episodeTitle = title.trim())
    }
    return fields
}

/**
 * Normalizes a raw document (`DocumentSnapshot.getData()` with timestamps turned into [Date])
 * into a safe channel, or an «off» channel. Port of `normalizeChannel`.
 */
fun normalizeChannel(raw: Any?, meta: ChannelMeta = ChannelMeta()): Channel {
    val map = raw as? Map<*, *>
    val docPath = meta.docPath ?: "$COLLECTION/$DOC_ID"
    val startedAtMs = toMillis(map?.js("startedAt"))
    val endsAtMs = toMillis(map?.js("endsAt"))
    val scheduled = meta.scheduled
    val base = Channel(
        id = meta.id ?: DOC_ID,
        docPath = docPath,
        scheduled = scheduled,
        mode = ChannelMode.OFF,
        title = "",
        youtube = null,
        movie = null,
        startedAtMs = Double.NaN,
        endsAtMs = if (scheduled) endsAtMs else Double.NaN,
        playbackStartedAtMs = if (scheduled) toMillis(map?.js("playbackStartedAt")) else Double.NaN,
        explicitEnd = scheduled && endsAtMs.isFinite() && endsAtMs > startedAtMs,
        updatedAtMs = toMillis(map?.js("updatedAt")),
    )
    // «Off» keeps its timestamp: stopping is itself an event on the timeline.
    val off = base.copy(startedAtMs = if (map?.get("mode") == "off") startedAtMs else Double.NaN)
    if (map == null) return off
    val mode = map["mode"]
    if (mode != "off" && mode != "youtube" && mode != "movie") return off
    val title = (map["title"] as? String)?.trim()?.take(MAX_TITLE) ?: ""

    if (mode == "youtube") {
        val youtube = map["youtube"] as? Map<*, *>
        val videoId = youtube?.js("videoId").let { if (truthy(it)) it.toString() else "" }
        if (!Regex("^[A-Za-z0-9_-]{11}$").matches(videoId)) return off
        val live = youtube?.get("live") == true
        return base.copy(
            mode = ChannelMode.YOUTUBE,
            title = title,
            youtube = YoutubeMedia(
                videoId = videoId,
                live = live,
                durationSec = readDuration(youtube?.js("durationSec")),
                pausedAtSec = if (live) Double.NaN else readPause(youtube?.js("pausedAtSec")),
            ),
            startedAtMs = startedAtMs,
        )
    }
    if (mode == "movie") {
        val movie = map["movie"] as? Map<*, *> ?: return off
        val kinopoiskId = jsNumber(movie.js("kinopoiskId"))
        if (!kinopoiskId.isFinite() || kinopoiskId != Math.floor(kinopoiskId) || kinopoiskId > MAX_SAFE_INTEGER || kinopoiskId <= 0) return off
        val durationSec = jsNumber(movie.js("durationSec"))
        val episode = try { readEpisodeFields(movie) } catch (_: EpisodeError) { return off }
        return base.copy(
            mode = ChannelMode.MOVIE,
            title = title,
            movie = MovieMedia(
                kinopoiskId = kinopoiskId.toLong(),
                durationSec = if (durationSec.isFinite() && durationSec > 0) jsRound(durationSec).toLong() else 0,
                durationMeasured = movie["durationMeasured"] == true,
                posterUrl = safeImageUrl(movie.js("posterUrl")),
                pausedAtSec = readPause(movie.js("pausedAtSec")),
                tmdbId = episode.tmdbId,
                mediaType = episode.mediaType,
                seasonNumber = episode.seasonNumber,
                episodeNumber = episode.episodeNumber,
                episodeTitle = episode.episodeTitle,
            ),
            startedAtMs = startedAtMs,
        )
    }
    return off
}

/** Cover image: the YouTube thumbnail or the stored movie poster (`coverUrl`). */
fun coverUrl(channel: Channel?): String = when (channel?.mode) {
    ChannelMode.YOUTUBE -> "https://i.ytimg.com/vi/${channel.youtube!!.videoId}/hqdefault.jpg"
    ChannelMode.MOVIE -> channel.movie!!.posterUrl
    else -> ""
}
