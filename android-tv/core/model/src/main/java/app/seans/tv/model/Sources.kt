package app.seans.tv.model

import kotlinx.coroutines.flow.Flow
import kotlinx.serialization.Serializable

/**
 * Providers of v1, in priority order. [key] is the extension's lowercase provider ID and is
 * what gets stored. Capabilities follow the extension:
 * - [supportsEpisodes]: the provider can play a chosen season/episode directly;
 * - [supportsAutoNext]: auto-next may run (needs direct episodes and a real `ended`);
 * - [marksCompletion]: its progress may mark an episode watched by itself (`RELIABLE`).
 * Rutube is user uploads: position only, never auto-next or automatic «watched».
 */
@Serializable
enum class ProviderId(
    val key: String,
    val label: String,
    val supportsEpisodes: Boolean,
    val supportsAutoNext: Boolean,
    val marksCompletion: Boolean,
) {
    SEASONVAR("seasonvar", "Seasonvar", supportsEpisodes = true, supportsAutoNext = true, marksCompletion = true),
    COLLAPS("collaps", "Collaps", supportsEpisodes = true, supportsAutoNext = true, marksCompletion = true),
    ANIMEGO("animego", "Kodik", supportsEpisodes = true, supportsAutoNext = true, marksCompletion = true),
    RUTUBE("rutube", "Rutube", supportsEpisodes = false, supportsAutoNext = false, marksCompletion = false);

    companion object {
        fun fromKey(key: String?): ProviderId? = when (key?.lowercase()) {
            null -> null
            "kodik" -> ANIMEGO
            else -> entries.firstOrNull { it.key == key.lowercase() }
        }
    }
}

/** DIRECT: a stream URL for ExoPlayer. WEB: a provider page that needs a WebView (not played in v1). */
@Serializable
enum class SourceKind { DIRECT, WEB }

/** What a provider needs to find a title. Search by Kinopoisk ID where the provider allows it, never by a name alone. */
@Serializable
data class SourceQuery(
    val ref: TitleRef,
    val title: String,
    val originalTitle: String? = null,
    val year: Int? = null,
    val episode: EpisodeKey? = null,
    /** From the Kinopoisk genres («аниме»); AnimeGo is asked only when true. */
    val isAnime: Boolean = false,
    /**
     * Episode count per season, when the catalogue knows it. AnimeGo needs it for the extension's
     * absolute-numbering fallback; without it a season with no AnimeGo title of its own is missing.
     */
    val seasonEpisodeCounts: Map<Int, Int> = emptyMap(),
) {
    companion object {
        /**
         * The one way to build a query from catalogue data, used by Details and the player alike:
         * the anime flag from the genres (all of them), episode counts from the known seasons.
         */
        fun forTitle(summary: TitleSummary, episode: EpisodeKey?, seasons: List<SeasonInfo>): SourceQuery = SourceQuery(
            ref = summary.ref,
            title = summary.title,
            originalTitle = summary.originalTitle,
            year = summary.year,
            episode = episode,
            isAnime = summary.genres.any { it.contains("аниме", ignoreCase = true) || it.equals("anime", ignoreCase = true) },
            seasonEpisodeCounts = seasons.filter { it.episodes.isNotEmpty() }.associate { it.number to it.episodes.size },
        )
    }
}

/**
 * A dub or voice-over. [id] is stable across episodes and sessions (a normalized name key, never a
 * track position: Collaps orders its tracks differently per episode), because it is stored with
 * progress and carried into the next episode.
 */
@Serializable
data class VoiceOption(val id: String, val name: String)

/** A quality the provider offers as a separate stream (Kodik): the player steps down on stalls. */
@Serializable
data class QualityOption(val height: Int, val label: String)

/** One provider's offer for a title, shown in the «Источник» panel. */
@Serializable
data class SourceOption(
    val providerId: ProviderId,
    val kind: SourceKind = SourceKind.DIRECT,
    /** Opaque provider handle (page URL, playlist id). Never shown to the user, never logged in full. */
    val handle: String,
    /** Best known quality, «1080p». */
    val quality: String? = null,
    val voices: List<VoiceOption> = emptyList(),
    /** Seasons this source has, with their episodes, when it knows them. */
    val seasons: List<SeasonInfo> = emptyList(),
    /** A line for the panel when the source cannot play this episode («Этой серии нет»). */
    val unavailableReason: String? = null,
)

@Serializable
enum class StreamFormat { HLS, MP4, DASH }

@Serializable
data class SubtitleTrack(val url: String, val language: String, val label: String)

/**
 * A resolved, playable stream. Signed URLs expire: never persist one; on 401/403/404/410 the
 * player calls [SourceResolver.resolve] again and seeks back.
 */
@Serializable
data class PlayableStream(
    val url: String,
    val format: StreamFormat,
    /** Headers the CDN requires (Referer, User-Agent). The player sends them on every request. */
    val headers: Map<String, String> = emptyMap(),
    val episode: EpisodeKey? = null,
    val providerId: ProviderId,
    val voiceId: String? = null,
    val subtitles: List<SubtitleTrack> = emptyList(),
    /** Other qualities as separate streams, best first, when the provider has no master playlist. */
    val alternatives: List<Pair<QualityOption, String>> = emptyList(),
    /**
     * 0-based index of the chosen voice among the manifest's audio tracks, for providers whose
     * voices are renditions of one manifest (Collaps: HLS `EXT-X-MEDIA` order, the digit of the
     * DASH `lang="ruN"`). Null when the provider resolved the voice into the URL itself.
     */
    val audioTrackIndex: Int? = null,
    /** Same content in another format to try when [url] fails to start (Collaps: DASH first, HLS fallback). */
    val fallback: StreamFallback? = null,
    /** Epoch millis after which the URL is expected to fail; null when unknown. */
    val expiresAt: Long? = null,
)

@Serializable
data class StreamFallback(val url: String, val format: StreamFormat)

sealed interface SourceEvent {
    data class Found(val option: SourceOption) : SourceEvent
    data class Failed(val providerId: ProviderId, val error: SeansError) : SourceEvent
    /** Every provider has answered. */
    data object Done : SourceEvent
}

interface SourceResolver {
    /**
     * Asks every provider at once and emits options as they arrive. Completes after
     * [SourceEvent.Done]. Results are cached per query (never an empty list as a success).
     * Every [ProviderId] answers exactly once before [SourceEvent.Done]: [SourceEvent.Found] or
     * [SourceEvent.Failed]. A provider that does not take the query (Seasonvar for a film, AnimeGo
     * without the anime flag, Rutube for a series) answers `Failed(UNSUPPORTED)` at once, so
     * callers never wait for a provider that was not asked.
     */
    fun find(query: SourceQuery): Flow<SourceEvent>

    /**
     * Turns an option into a stream for one episode (null for films) and voice.
     *
     * - [fresh] bypasses every provider cache: the player passes it when retrying after
     *   `STREAM_EXPIRED`, otherwise a cached signed URL would fail the same way again.
     * - An unknown [voiceId] falls back to the provider's default voice rather than failing;
     *   `PlayableStream.voiceId` is always the voice actually chosen, so the UI can say so.
     * - `PlayableStream.episode` is the episode the provider confirmed, or null when it cannot
     *   confirm one; callers never play a stream confirmed for another episode.
     */
    suspend fun resolve(option: SourceOption, episode: EpisodeKey?, voiceId: String?, fresh: Boolean = false): PlayableStream
}
