package app.seans.tv.model

import kotlinx.coroutines.flow.Flow
import kotlinx.serialization.Serializable

/** What Home's «Эфир» row shows. The full Live screen lives in `:live`. */
@Serializable
data class LiveNow(
    val title: String,
    val ref: TitleRef? = null,
    val episode: EpisodeKey? = null,
    val posterUrl: String? = null,
    /** Server-time millis of the slot's start and end; end is null when unknown (live YouTube). */
    val startsAt: Long,
    val endsAt: Long? = null,
    /** True for a YouTube item (played in a WebView, not ExoPlayer). */
    val isYoutube: Boolean = false,
)

@Serializable
data class LiveSlot(
    val title: String,
    val startsAt: Long,
    val endsAt: Long? = null,
    val ref: TitleRef? = null,
    val episode: EpisodeKey? = null,
    /** «С1 · Е1–Е3», «2 ч 24 мин». */
    val caption: String? = null,
)

interface LiveSummaryProvider {
    /** Null when the channel is off. */
    fun now(): Flow<LiveNow?>

    /** Today's programme from now on, current slot first. */
    fun programme(): Flow<List<LiveSlot>>

    /** The server clock the channel maths use, for countdowns in Home. */
    val clock: ServerClock
}
