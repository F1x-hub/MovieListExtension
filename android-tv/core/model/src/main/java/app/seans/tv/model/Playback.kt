package app.seans.tv.model

import kotlinx.serialization.Serializable

/**
 * Why playback starts where it does. Explicit choices (everything except [RESUME]) override
 * stored progress, as `PlaybackController` does in the extension.
 */
@Serializable
enum class SelectionReason {
    /** «Смотреть с 14:20» or a «Продолжить» card: start from the stored position. */
    RESUME,
    /** An episode picked in Details or in the player's drawer: start at 0 unless that episode has a position. */
    EPISODE_PICK,
    /** Auto-next or «Следующая серия». */
    NEXT_EPISODE,
    /** Another source for the same episode: keep the current position. */
    PROVIDER_SWITCH,
    /** «Эфир»: position comes from the channel clock; see [BroadcastLock]. */
    BROADCAST,
}

/** Everything the player needs to open a title. Passed through navigation, so keep it serializable and small. */
@Serializable
data class PlaybackRequest(
    val summary: TitleSummary,
    /** Null for films. */
    val episode: EpisodeKey?,
    val reason: SelectionReason,
    /** Set only when the caller already knows the position (provider switch). */
    val startPositionMs: Long? = null,
    /**
     * Set only when the viewer explicitly picked this source (the «Источник» panel), never as a
     * default. An explicit pick always wins: the player never plays a lower-ranked source over it
     * because the picked one answers later.
     */
    val preferredProvider: ProviderId? = null,
    val preferredVoiceId: String? = null,
)

/**
 * Server time. Channel maths never use `System.currentTimeMillis()` directly: the TV clock can
 * be minutes off. `:live` implements it from the HTTP `Date` header, as `CinemaChannelService` does.
 */
fun interface ServerClock {
    fun nowMs(): Long
}

/**
 * The broadcast lock the player obeys in «Эфир». The viewer cannot pause, seek, change episode
 * or auto-advance; the player writes no progress and corrects drift only by seeking
 * (more than 3 s off while playing, 1 s while paused).
 */
@Serializable
data class BroadcastLock(
    /** Server-time millis at which media position 0 plays (from `playbackStartedAt`, else `startedAt`). */
    val anchorServerMs: Long,
    /** When the admin paused the broadcast: the media position it holds, in ms. */
    val pausedAtMs: Long? = null,
    /** The slot ends here (server ms); null when unknown. */
    val endsAtServerMs: Long? = null,
) {
    /** The media position everyone should be at now. */
    fun targetPositionMs(clock: ServerClock): Long =
        pausedAtMs ?: (clock.nowMs() - anchorServerMs).coerceAtLeast(0)
}
