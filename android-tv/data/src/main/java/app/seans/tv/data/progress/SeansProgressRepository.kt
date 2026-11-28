package app.seans.tv.data.progress

import app.seans.tv.data.store.JsonFile
import app.seans.tv.model.EpisodeKey
import app.seans.tv.model.MediaType
import app.seans.tv.model.PlaybackPosition
import app.seans.tv.model.ProgressRepository
import app.seans.tv.model.TitleRef
import java.io.File
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.filterNotNull
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.onStart
import kotlinx.serialization.Serializable

/** `latest` of the P1 shape (risks.md): times in seconds, as the later `watchProgress` sync stores them. */
@Serializable
internal data class LatestPosition(
    val season: Int? = null,
    val episode: Int? = null,
    val timestamp: Long = 0,
    val duration: Long? = null,
    val completed: Boolean = false,
    val providerId: String? = null,
    val voiceId: String? = null,
    val updatedAt: Long = 0,
)

/** One episode in `episodes["S:E"]`: t, d in seconds, c completed, u updatedAt (ms). */
@Serializable
internal data class EpisodePosition(val t: Long = 0, val d: Long? = null, val c: Boolean = false, val u: Long = 0)

/**
 * `watchProgress/{uid}_{kpId}` as P1 defines it, kept on the TV for now. Films have
 * null season/episode in [latest] and no [episodes].
 */
@Serializable
internal data class TitleProgress(
    val userId: String? = null,
    val movieId: Long,
    val mediaType: String,
    val latest: LatestPosition,
    val episodes: Map<String, EpisodePosition> = emptyMap(),
    val updatedAt: Long = 0,
    val schemaVersion: Int = 1,
)

@Serializable
internal data class ProgressFile(val titles: Map<Long, TitleProgress> = emptyMap(), val schemaVersion: Int = 1)

/**
 * Local progress, keyed by `kinopoiskId` and [EpisodeKey] only (P4): two refs of one title that
 * differ in `tmdbId` share their progress. Rules kept here, whoever writes:
 * - a 0 never replaces a real position of the same episode (a mount that has not played);
 * - `completed` is monotonic per episode;
 * - at most [MAX_EPISODES] episodes per title, the oldest pruned; at most [MAX_TITLES] titles.
 * Throttling and flush points are the player's job (`ProgressRules`).
 */
class SeansProgressRepository internal constructor(dir: File) : ProgressRepository {
    private val file = JsonFile(File(dir, "progress.json"), ProgressFile.serializer()) { ProgressFile() }
    private val changes = MutableStateFlow<ProgressFile?>(null)

    override suspend fun get(ref: TitleRef, episode: EpisodeKey?): PlaybackPosition? {
        val title = file.read().titles[ref.kinopoiskId] ?: return null
        if (episode == null) {
            if (title.mediaType == SERIES_VALUE) return null
            return title.latestPosition(ref)
        }
        val stored = title.episodes[episode.storageKey()] ?: return null
        val latestIsThis = title.latest.season == episode.season && title.latest.episode == episode.episode
        return PlaybackPosition(
            ref = ref,
            episode = episode,
            positionMs = stored.t * 1000,
            durationMs = (stored.d ?: 0) * 1000,
            updatedAt = stored.u,
            completed = stored.c,
            providerKey = if (latestIsThis) title.latest.providerId else null,
            voiceId = if (latestIsThis) title.latest.voiceId else null,
        )
    }

    override suspend fun latestFor(ref: TitleRef): PlaybackPosition? =
        file.read().titles[ref.kinopoiskId]?.latestPosition(ref)

    override suspend fun episodesOf(ref: TitleRef): Map<EpisodeKey, PlaybackPosition> {
        val title = file.read().titles[ref.kinopoiskId] ?: return emptyMap()
        return title.episodes.mapNotNull { (key, e) ->
            val episode = EpisodeKey.fromStorageKey(key) ?: return@mapNotNull null
            episode to PlaybackPosition(ref, episode, e.t * 1000, (e.d ?: 0) * 1000, e.u, e.c)
        }.toMap()
    }

    override suspend fun save(position: PlaybackPosition) {
        val next = file.update { current -> current.copy(titles = merge(current.titles, position)) }
        changes.value = next
    }

    override fun recent(limit: Int): Flow<List<PlaybackPosition>> = changes
        .onStart { if (changes.value == null) changes.value = file.read() }
        .filterNotNull()
        .map { current ->
            current.titles.values
                .filter { it.isUnfinished() }
                .sortedByDescending { it.updatedAt }
                .take(limit)
                .mapNotNull { it.latestPosition(null) }
        }

    internal companion object {
        const val MAX_EPISODES = 100
        const val MAX_TITLES = 200
        const val SERIES_VALUE = "tv-series"

        fun merge(titles: Map<Long, TitleProgress>, position: PlaybackPosition): Map<Long, TitleProgress> {
            val kp = position.ref.kinopoiskId
            val existing = titles[kp]
            val episode = position.episode
            val seconds = position.positionMs / 1000
            val durationSec = (position.durationMs / 1000).takeIf { it > 0 }
            val mediaType = if (episode != null || position.ref.mediaType == MediaType.SERIES) SERIES_VALUE else "movie"

            val previousOfThis: EpisodePosition? = when {
                existing == null -> null
                episode != null -> existing.episodes[episode.storageKey()]
                existing.latest.episode == null -> existing.latest.let { EpisodePosition(it.timestamp, it.duration, it.completed, it.updatedAt) }
                else -> null
            }
            // Never a 0 over a real position of the same episode.
            val keepOld = seconds <= 0 && (previousOfThis?.t ?: 0) > 0
            val t = if (keepOld) previousOfThis!!.t else seconds.coerceAtLeast(0)
            val d = durationSec ?: previousOfThis?.d
            val completed = position.completed || (previousOfThis?.c ?: false)

            val latest = LatestPosition(
                season = episode?.season,
                episode = episode?.episode,
                timestamp = t,
                duration = d,
                completed = completed,
                providerId = position.providerKey ?: existing?.latest?.providerId,
                voiceId = position.voiceId ?: existing?.latest?.voiceId,
                updatedAt = position.updatedAt,
            )
            val episodes = if (episode == null) existing?.episodes.orEmpty() else {
                val updated = existing?.episodes.orEmpty() + (episode.storageKey() to EpisodePosition(t, d, completed, position.updatedAt))
                if (updated.size <= MAX_EPISODES) updated
                else updated.entries.sortedByDescending { it.value.u }.take(MAX_EPISODES).associate { it.key to it.value }
            }
            val title = TitleProgress(
                movieId = kp,
                mediaType = mediaType,
                latest = latest,
                episodes = episodes,
                updatedAt = maxOf(position.updatedAt, existing?.updatedAt ?: 0),
            )
            val all = titles + (kp to title)
            return if (all.size <= MAX_TITLES) all
            else all.entries.sortedByDescending { it.value.updatedAt }.take(MAX_TITLES).associate { it.key to it.value }
        }
    }
}

private fun TitleProgress.mediaTypeEnum(): MediaType = if (mediaType == SeansProgressRepository.SERIES_VALUE) MediaType.SERIES else MediaType.MOVIE

/** Films that are complete leave «Продолжить»; a series stays (its next episode is the next step). */
private fun TitleProgress.isUnfinished(): Boolean =
    if (mediaTypeEnum() == MediaType.SERIES) latest.timestamp > 0 || latest.completed else !latest.completed && latest.timestamp > 0

private fun TitleProgress.latestPosition(ref: TitleRef?): PlaybackPosition? {
    val titleRef = ref?.takeIf { it.kinopoiskId == movieId } ?: TitleRef.ofOrNull(movieId, mediaTypeEnum()) ?: return null
    val episode = EpisodeKey.ofOrNull(latest.season, latest.episode)
    if (mediaTypeEnum() == MediaType.SERIES && episode == null) return null
    return PlaybackPosition(
        ref = titleRef,
        episode = episode,
        positionMs = latest.timestamp * 1000,
        durationMs = (latest.duration ?: 0) * 1000,
        updatedAt = latest.updatedAt,
        completed = latest.completed,
        providerKey = latest.providerId,
        voiceId = latest.voiceId,
    )
}
