package app.seans.tv.player.progress

import app.seans.tv.model.EpisodeKey
import app.seans.tv.model.PlaybackPosition
import app.seans.tv.model.ProgressRules
import app.seans.tv.model.ProviderId
import app.seans.tv.model.TitleRef
import app.seans.tv.player.PlayerLog
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.launch

/** What a position is saved under: the canonical selection, never what a stream reports. */
internal data class ProgressIdentity(
    val ref: TitleRef,
    val episode: EpisodeKey?,
    val providerId: ProviderId?,
    val voiceId: String?,
)

/**
 * The only writer of progress (risks P1-P3, M5), following the extension's `PlaybackController`:
 *
 * - periodic writes at most every [ProgressRules.WRITE_THROTTLE_MS]; [flush] writes at once
 *   (pause, end, source switch, episode change, exit, `ON_STOP`);
 * - [begin] flushes the outgoing selection first, then nothing reported for it is accepted
 *   (each selection has a version);
 * - a mount that has not played writes its selection's start position, and never a 0;
 * - completion follows [ProgressRules.isCompleted] only for a provider whose
 *   [ProviderId.marksCompletion] is true, and once true stays true for that episode;
 * - writes go out in order through one queue on [scope], which outlives the screen, so a slow
 *   store never blocks a switch and the old episode is always stored before the new one.
 */
internal class ProgressWriter(
    private val scope: CoroutineScope,
    private val now: () -> Long,
    private val save: suspend (PlaybackPosition) -> Unit,
) {
    private val queue = Channel<PlaybackPosition>(Channel.UNLIMITED)

    init {
        scope.launch {
            for (position in queue) {
                try {
                    save(position)
                } catch (e: CancellationException) {
                    throw e
                } catch (e: Exception) {
                    PlayerLog.w(TAG, "progress save failed: ${e.javaClass.simpleName}")
                }
            }
        }
    }

    /** Version of the current selection; reports carrying another one are dropped. */
    var version: Int = 0
        private set

    var identity: ProgressIdentity? = null
        private set

    /** The last selection begun; kept after [end] so a switch on the same episode keeps its state. */
    private var lastMedia: ProgressIdentity? = null
    private var startMs = 0L
    private var played = false
    private var positionMs = 0L
    private var durationMs = 0L
    private var completed = false
    private var lastWriteAt = 0L

    /** The position to resume at when the same selection is mounted again (provider switch, restart). */
    val currentPositionMs: Long get() = if (played) positionMs else startMs
    val currentDurationMs: Long get() = durationMs
    val hasPlayed: Boolean get() = played

    /**
     * Starts a new selection after flushing the outgoing one. [stored] is what the store holds for
     * this exact identity's episode (its duration and completion carry over).
     */
    fun begin(identity: ProgressIdentity, startPositionMs: Long, stored: PlaybackPosition?): Int {
        flush()
        val previous = lastMedia
        val sameMedia = previous != null && previous.ref.kinopoiskId == identity.ref.kinopoiskId && previous.episode == identity.episode
        val matchingStored = stored?.takeIf { it.ref.kinopoiskId == identity.ref.kinopoiskId && it.episode == identity.episode }
        version++
        this.identity = identity
        lastMedia = identity
        startMs = startPositionMs.coerceAtLeast(0)
        played = false
        positionMs = startMs
        when {
            matchingStored != null -> {
                durationMs = matchingStored.durationMs
                completed = matchingStored.completed || (sameMedia && completed)
            }
            // Another source or voice for the same episode: duration and completion carry over.
            sameMedia -> Unit
            else -> {
                durationMs = 0L
                completed = false
            }
        }
        lastWriteAt = now()
        return version
    }

    /** Flushes and forgets the selection; later reports are dropped (switching, leaving the screen). */
    fun end() {
        flush()
        version++
        identity = null
    }

    /** Leaving for good: flushes, then lets the queue drain and its coroutine finish. */
    fun close() {
        end()
        queue.close()
    }

    /**
     * A sample from the player. [playing] means the media is actually advancing; until it has, the
     * mount counts as not played and only its start position may be written.
     */
    fun report(version: Int, positionMs: Long, durationMs: Long, playing: Boolean) {
        if (version != this.version || identity == null) return
        if (playing) played = true
        if (durationMs > 0) this.durationMs = durationMs
        if (!played) return
        this.positionMs = positionMs.coerceAtLeast(0)
        if (now() - lastWriteAt >= ProgressRules.WRITE_THROTTLE_MS) write(ended = false)
    }

    /** Writes the current position at once. A [version] other than the current one is ignored. */
    fun flush(version: Int = this.version) {
        if (version != this.version) return
        write(ended = false)
    }

    /** A real `ended` of the media. */
    fun ended(version: Int) {
        if (version != this.version || identity == null) return
        played = true
        if (durationMs > 0) positionMs = durationMs
        write(ended = true)
    }

    private fun write(ended: Boolean) {
        val id = identity ?: return
        val position = if (played) positionMs else startMs
        if (!played && position <= 0L) return
        if (id.providerId?.marksCompletion == true && ProgressRules.isCompleted(position, durationMs, ended)) completed = true
        val at = now()
        lastWriteAt = at
        queue.trySend(
            PlaybackPosition(
                ref = id.ref,
                episode = id.episode,
                positionMs = position,
                durationMs = durationMs,
                updatedAt = at,
                completed = completed,
                providerKey = id.providerId?.key,
                voiceId = id.voiceId,
            ),
        )
    }

    private companion object {
        const val TAG = "SeansProgress"
    }
}
