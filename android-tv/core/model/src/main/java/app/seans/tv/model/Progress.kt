package app.seans.tv.model

import kotlinx.coroutines.flow.Flow
import kotlinx.serialization.Serializable

/**
 * Where the viewer stopped. Rules carried over from the extension (`.agents/rules/agent.md`,
 * "Selection and progress"):
 * - films have `episode == null`; a series position always names its episode;
 * - [ProgressRules.WRITE_THROTTLE_MS] between periodic writes, and an immediate flush on pause,
 *   end, source switch, episode change (old episode first), `ON_STOP` and destroy;
 * - a position is never overwritten with 0 by a mount that has not played;
 * - completion follows [ProgressRules.isCompleted], only from a source whose
 *   [ProviderId.marksCompletion] is true, and stays true for that episode on later writes;
 * - a broadcast («Эфир») writes no progress.
 */
@Serializable
data class PlaybackPosition(
    val ref: TitleRef,
    val episode: EpisodeKey?,
    val positionMs: Long,
    val durationMs: Long,
    /** Epoch millis of the last write; the newest wins when two copies disagree. */
    val updatedAt: Long,
    val completed: Boolean = false,
    /**
     * The extension's lowercase provider key (`seasonvar`, `kodik`, `rutube`, `collaps`, ...).
     * A String, so an unknown key from the extension or a later version never fails decoding;
     * map with [ProviderId.fromKey].
     */
    val providerKey: String? = null,
    val voiceId: String? = null,
) {
    val fraction: Float get() = if (durationMs > 0) (positionMs.toFloat() / durationMs).coerceIn(0f, 1f) else 0f
    val remainingMs: Long get() = (durationMs - positionMs).coerceAtLeast(0)
}

object ProgressRules {
    const val WRITE_THROTTLE_MS = 15_000L

    /** Content over 120 s is complete at 90%; shorter content only on a real `ended`. */
    fun isCompleted(positionMs: Long, durationMs: Long, endedEvent: Boolean): Boolean {
        if (endedEvent) return true
        if (durationMs <= 120_000L) return false
        return positionMs >= durationMs * 9 / 10
    }
}

/**
 * Stores positions, keyed by `kinopoiskId` (+ [EpisodeKey]) only, never by the whole [TitleRef].
 *
 * v1 keeps them on the TV, in the shape the later Firestore sync will use
 * (`watchProgress/{uid}_{kpId}`: `latest` + an `episodes` map keyed `"S:E"`, times in seconds;
 * see `android-tv/docs/risks.md`, P1), so adding the sync changes the transport, not the data.
 */
interface ProgressRepository {
    suspend fun get(ref: TitleRef, episode: EpisodeKey?): PlaybackPosition?

    /** The latest position of any episode of this title (for «Смотреть С2 · Е5 с 14:20»). */
    suspend fun latestFor(ref: TitleRef): PlaybackPosition?

    /** All stored episode positions of a series, for watched marks and progress bars in Details. */
    suspend fun episodesOf(ref: TitleRef): Map<EpisodeKey, PlaybackPosition>

    suspend fun save(position: PlaybackPosition)

    /** Unfinished titles, newest first, one entry per title. */
    fun recent(limit: Int = 20): Flow<List<PlaybackPosition>>
}
