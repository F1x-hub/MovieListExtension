package app.seans.tv.live.channel

/*
 * Position, slot bounds and resolution of the channel: a line-by-line port of the viewer
 * functions in `src/shared/services/CinemaChannelService.js`. Every function takes the server
 * time explicitly; callers pass `ServerClock.nowMs()`, never the TV's wall clock (L1).
 */

/** Seconds a legacy schedule entry without a length occupies on the grid. */
internal const val SCHEDULE_FALLBACK_SEC = 4 * 3600L

enum class PositionState { OFF, LIVE, PAUSED, UPCOMING, ENDED }

/** `{ state, offsetSec }` of `computePosition`. For UPCOMING [offsetSec] is the countdown. */
data class Position(val state: PositionState, val offsetSec: Long) {
    val onAir: Boolean get() = state == PositionState.LIVE || state == PositionState.PAUSED
}

/** `{ startMs, endMs, explicitEnd }`; [endMs] may be `Infinity` (no end) or NaN. */
data class Bounds(val startMs: Double, val endMs: Double, val explicitEnd: Boolean)

private fun ceilSec(ms: Double): Long = Math.ceil(ms / 1000).toLong()

/** Where the broadcast is right now (`computePosition`). */
fun computePosition(channel: Channel?, nowMs: Double): Position {
    if (channel == null || channel.mode == ChannelMode.OFF) return Position(PositionState.OFF, 0)
    val duration = channel.mediaDurationSec
    val pausedAt = channel.mediaPausedAtSec
    if (channel.scheduled && channel.explicitEnd) {
        if (nowMs < channel.startedAtMs) return Position(PositionState.UPCOMING, ceilSec(channel.startedAtMs - nowMs))
        // A paused show holds its slot: resuming extends the end by the pause.
        if (nowMs >= channel.endsAtMs && !pausedAt.isFinite()) return Position(PositionState.ENDED, duration)
    }
    val anchorMs = if (channel.scheduled && channel.playbackStartedAtMs.isFinite()) channel.playbackStartedAtMs else channel.startedAtMs
    // A live YouTube stream is always «now»: there is nothing to seek to.
    if (channel.isLiveStream) {
        if (channel.startedAtMs.isFinite() && nowMs < channel.startedAtMs) {
            return Position(PositionState.UPCOMING, ceilSec(channel.startedAtMs - nowMs))
        }
        if (duration > 0 && channel.startedAtMs.isFinite() && nowMs - channel.startedAtMs >= duration * 1000.0) {
            return Position(PositionState.ENDED, 0)
        }
        return Position(PositionState.LIVE, 0)
    }
    if (pausedAt.isFinite()) return Position(PositionState.PAUSED, Math.floor(pausedAt).toLong())
    if (!anchorMs.isFinite()) return Position(PositionState.LIVE, 0)

    val elapsed = Math.floor((nowMs - anchorMs) / 1000).toLong()
    if (elapsed < 0) return Position(PositionState.UPCOMING, -elapsed)
    if (duration > 0 && elapsed >= duration && lengthIsExact(channel)) return Position(PositionState.ENDED, duration)
    return Position(PositionState.LIVE, elapsed)
}

/**
 * Whether the stored source length is the real file length (`lengthIsExact`). A catalogue
 * runtime never ends a fixed slot early: the slot end does, or the player's own end of media.
 */
fun lengthIsExact(channel: Channel?): Boolean =
    channel?.mode != ChannelMode.MOVIE || channel.movie?.durationMeasured == true ||
        !(channel.scheduled && channel.explicitEnd)

/** The furthest position the timeline accepts (`playableSec`). */
fun playableSec(channel: Channel): Long {
    val duration = channel.mediaDurationSec
    if (lengthIsExact(channel)) return duration
    val anchorMs = if (channel.playbackStartedAtMs.isFinite()) channel.playbackStartedAtMs else channel.startedAtMs
    val slotSec = if (channel.endsAtMs.isFinite() && anchorMs.isFinite()) Math.floor((channel.endsAtMs - anchorMs) / 1000).toLong() else 0
    return maxOf(duration, slotSec)
}

/** Fixed slot bounds; legacy lengths are display estimates (`getScheduleBounds`). */
fun getScheduleBounds(item: Channel): Bounds {
    val startMs = item.startedAtMs
    val explicitEnd = item.scheduled && item.explicitEnd && item.endsAtMs.isFinite() && item.endsAtMs > startMs
    val duration = item.mediaDurationSec.takeIf { it > 0 } ?: if (item.scheduled) SCHEDULE_FALLBACK_SEC else 0
    val endMs = when {
        explicitEnd -> item.endsAtMs
        duration > 0 -> startMs + duration * 1000.0
        else -> Double.POSITIVE_INFINITY
    }
    return Bounds(startMs, endMs, explicitEnd)
}

/**
 * Where a scheduled show sits on the programme while on air: from the moment its playback clock
 * started (moved by seeks; a paused show slides) to its end (`playbackBounds`).
 */
fun playbackBounds(item: Channel, nowMs: Double): Bounds {
    val bounds = getScheduleBounds(item)
    if (!item.scheduled || item.isLiveStream || !(nowMs >= item.startedAtMs)) return bounds
    val position = computePosition(item, nowMs)
    if (!position.onAir) return bounds
    val pausedAt = item.mediaPausedAtSec
    val anchorMs = when {
        pausedAt.isFinite() -> nowMs - pausedAt * 1000
        item.playbackStartedAtMs.isFinite() -> item.playbackStartedAtMs
        else -> item.startedAtMs
    }
    if (pausedAt.isFinite()) return bounds.copy(startMs = anchorMs, endMs = shiftedEnd(item, anchorMs))
    val duration = item.mediaDurationSec
    val endMs = when {
        item.explicitEnd -> item.endsAtMs
        duration > 0 -> anchorMs + duration * 1000.0
        else -> bounds.endMs
    }
    return bounds.copy(startMs = anchorMs, endMs = endMs)
}

/** New fixed end after a scheduled show's playback clock moves to [anchorMs] (`shiftedEnd`). */
fun shiftedEnd(item: Channel, anchorMs: Double): Double {
    val previousAnchor = if (item.playbackStartedAtMs.isFinite()) item.playbackStartedAtMs else item.startedAtMs
    val duration = item.mediaDurationSec
    val previousEnd = if (item.explicitEnd) item.endsAtMs
    else previousAnchor + (duration.takeIf { it > 0 } ?: SCHEDULE_FALLBACK_SEC) * 1000.0
    val endMs = previousEnd + (anchorMs - previousAnchor)
    return jsRound(maxOf(maxOf(endMs, item.startedAtMs + 1000), if (duration > 0) anchorMs + duration * 1000.0 else 0.0))
}

data class Shift(val item: Channel, val delta: Double)

/** Later shows that a new end would overlap, with how far each moves (`followingShifts`). */
fun followingShifts(item: Channel, endMs: Double, items: List<Channel>): List<Shift> {
    val shifts = mutableListOf<Shift>()
    var occupiedUntil = endMs
    val following = items.filter { it.id != item.id && it.mode != ChannelMode.OFF && it.startedAtMs > item.startedAtMs }
        .sortedWith { a, b -> a.startedAtMs.compareTo(b.startedAtMs) }
    for (other in following) {
        val bounds = getScheduleBounds(other)
        if (bounds.startMs >= occupiedUntil) break
        val delta = occupiedUntil - bounds.startMs
        shifts += Shift(other, delta)
        occupiedUntil = bounds.endMs + delta
    }
    return shifts
}

/** Read-only preview of the programme a paused show postpones (`projectPausedSchedule`). */
fun projectPausedSchedule(items: List<Channel>, channel: Channel?, nowMs: Double): List<Channel> {
    val pausedAt = channel?.mediaPausedAtSec ?: Double.NaN
    if (channel == null || !channel.scheduled || !pausedAt.isFinite() || nowMs < channel.startedAtMs) return items
    val endMs = shiftedEnd(channel, nowMs - pausedAt * 1000)
    val shifts = followingShifts(channel, endMs, items).associate { it.item.id to it.delta }
    return items.map { item ->
        if (item.docPath == channel.docPath) {
            return@map item.copy(endsAtMs = endMs, explicitEnd = true, playbackStartedAtMs = nowMs - pausedAt * 1000)
        }
        val delta = shifts[item.id]
        if (delta == null || delta == 0.0) item
        else item.copy(
            startedAtMs = item.startedAtMs + delta,
            endsAtMs = item.endsAtMs + delta,
            playbackStartedAtMs = (if (item.playbackStartedAtMs.isFinite()) item.playbackStartedAtMs else item.startedAtMs) + delta,
        )
    }
}

/** The next show that has not started yet (`nextScheduled`). */
fun nextScheduled(items: List<Channel>, nowMs: Double): Channel? =
    items.filter { it.mode != ChannelMode.OFF && it.startedAtMs.isFinite() && it.startedAtMs > nowMs }
        .sortedWith(compareBy<Channel> { it.startedAtMs }.thenBy { it.id })
        .firstOrNull()

/**
 * Picks what the Live screen shows from the manual channel plus the schedule
 * (`resolveChannel`): a held (paused) show wins, otherwise the latest started item; a fixed slot
 * holds until its end; with nothing on air the next upcoming item is returned for its countdown.
 */
fun resolveChannel(manual: Channel?, scheduleItems: List<Channel>, nowMs: Double): Channel {
    val items = listOfNotNull(manual).plus(scheduleItems).filter { it.startedAtMs.isFinite() }
    // A pause postpones the programme until resume can move its boundaries atomically.
    // A later manual start/stop still deliberately overrides it.
    val manualStart = manual?.startedAtMs?.takeIf { it.isFinite() && it <= nowMs } ?: Double.NEGATIVE_INFINITY
    val held = scheduleItems.filter {
        it.mode != ChannelMode.OFF && it.startedAtMs <= nowMs && it.startedAtMs > manualStart && it.mediaPausedAtSec.isFinite()
    }.sortedWith { a, b -> a.startedAtMs.compareTo(b.startedAtMs) }.firstOrNull()
    if (held != null) return held
    val started = items.filter { it.startedAtMs <= nowMs }.sortedWith { a, b -> b.startedAtMs.compareTo(a.startedAtMs) }
    val latest = started.firstOrNull()
    if (latest != null && latest.mode != ChannelMode.OFF) {
        // Media may finish before the allotted slot: keep its reservation until the fixed end.
        if (latest.scheduled && latest.explicitEnd && nowMs < latest.endsAtMs) return latest
        val position = computePosition(latest, nowMs)
        val capped = latest.scheduled && latest.mediaDurationSec == 0L && !latest.mediaPausedAtSec.isFinite() &&
            nowMs - latest.startedAtMs > SCHEDULE_FALLBACK_SEC * 1000
        if (position.state != PositionState.ENDED && !capped) return latest
    }
    val upcoming = nextScheduled(scheduleItems, nowMs)
    if (upcoming != null) return upcoming
    if (latest != null && latest.mode != ChannelMode.OFF) return latest // «Показ завершился»
    return normalizeChannel(null)
}

/** `1:15`, `3:00:05` (`formatClock`). */
fun formatClock(totalSec: Long): String {
    val sec = maxOf(0, totalSec)
    val h = sec / 3600
    val m = (sec % 3600) / 60
    val s = sec % 60
    return if (h > 0) "$h:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}"
    else "$m:${s.toString().padStart(2, '0')}"
}

/** The player is remounted only when WHAT is on air changes (`channelKey` of `live.js`). */
fun channelKey(channel: Channel?): String {
    if (channel == null || channel.mode == ChannelMode.OFF) return "off"
    val movie = channel.movie
    return if (channel.mode == ChannelMode.MOVIE && movie != null) {
        val episode = if (movie.isEpisode) ":S${movie.seasonNumber}E${movie.episodeNumber}" else ""
        "movie:${channel.docPath}:${movie.kinopoiskId}$episode"
    } else "youtube:${channel.docPath}:${channel.youtube?.videoId}"
}

/** Server ms at which media position 0 plays (`localStartMs` of `live.js`, before the local shift). */
fun playbackAnchorMs(channel: Channel, nowMs: Double): Double {
    val anchor = if (channel.playbackStartedAtMs.isFinite()) channel.playbackStartedAtMs else channel.startedAtMs
    return if (anchor.isFinite()) anchor else nowMs - computePosition(channel, nowMs).offsetSec * 1000.0
}
