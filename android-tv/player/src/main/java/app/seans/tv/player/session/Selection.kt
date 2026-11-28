package app.seans.tv.player.session

import app.seans.tv.model.EpisodeKey
import app.seans.tv.model.PlaybackPosition
import app.seans.tv.model.SeasonInfo
import app.seans.tv.model.SelectionReason

/** Pure selection rules, kept apart so the unit tests can pin them down. */
internal object Selection {
    /** A stored position this close to the end restarts the episode instead. */
    const val END_GUARD_MS = 10_000L

    /**
     * Where a selection starts. A known position ([requestedMs], a provider switch) always wins.
     * Then: «Продолжить» and an episode pick resume a stored unfinished position; «Следующая серия»
     * starts at 0 (an explicit choice overrides stored progress, as in the extension).
     */
    fun startPosition(reason: SelectionReason, requestedMs: Long?, stored: PlaybackPosition?): Long {
        if (requestedMs != null) return requestedMs.coerceAtLeast(0)
        val usable = stored?.takeIf {
            !it.completed && it.positionMs > 0 && (it.durationMs <= 0 || it.remainingMs > END_GUARD_MS)
        }
        return when (reason) {
            SelectionReason.RESUME, SelectionReason.EPISODE_PICK, SelectionReason.PROVIDER_SWITCH -> usable?.positionMs ?: 0L
            SelectionReason.NEXT_EPISODE, SelectionReason.BROADCAST -> 0L
        }
    }

    /**
     * The episode progress is saved under. The selection's episode is canonical; only when nothing
     * canonical exists yet (a series opened without an episode) does the stream's own episode count.
     */
    fun canonicalEpisode(selected: EpisodeKey?, fromStream: EpisodeKey?): EpisodeKey? = selected ?: fromStream

    /** The first episode to play of a series with no stored progress: Season 1 (or the lowest regular season). */
    fun firstEpisode(seasons: List<SeasonInfo>): EpisodeKey {
        val season = seasons.filter { it.number >= 1 && it.episodes.isNotEmpty() }.minByOrNull { it.number }
            ?: seasons.filter { it.episodes.isNotEmpty() }.minByOrNull { it.number }
        return season?.episodes?.minOfOrNull { it.key } ?: EpisodeKey(1, 1)
    }

    /**
     * The episode after [current]. Season 0 (specials) never leads into Season 1. With no season
     * list the next number of the same season is assumed ([known] tells the caller it is a guess).
     */
    fun nextEpisode(seasons: List<SeasonInfo>, current: EpisodeKey): Next? {
        if (seasons.isEmpty()) return Next(EpisodeKey(current.season, current.episode + 1), known = false)
        val season = seasons.firstOrNull { it.number == current.season }
        season?.episodes?.map { it.key }?.filter { it.episode > current.episode }?.minOrNull()?.let { return Next(it, known = true) }
        if (current.season == 0) return null
        val later = seasons.filter { it.number > current.season && it.episodes.isNotEmpty() }.minByOrNull { it.number }
        return later?.episodes?.minOfOrNull { it.key }?.let { Next(it, known = true) }
    }

    data class Next(val key: EpisodeKey, val known: Boolean)
}
