package app.seans.tv.player.session

/**
 * For qualities that come as separate streams (Kodik, risk N6), which the player cannot switch
 * between by itself: says when the connection does not keep the one playing. Same thresholds as
 * the extension's `HlsPlaybackFactory.watchStalls`: two stalls of 2.5 s or more within two
 * minutes, or a start that takes longer than 12 s. Stalls right after a seek do not count.
 */
internal class StallWatch(private val now: () -> Long) {
    private var started = false
    private var startAt: Long? = null
    private var stallAt: Long? = null
    private val stalls = ArrayDeque<Long>()

    /** A new URL starts loading and should play. */
    fun onLoad() {
        started = false
        startAt = now()
        stallAt = null
        stalls.clear()
    }

    fun onPlaying() {
        started = true
        startAt = null
        stallAt = null
    }

    /** The viewer paused or seeked: whatever was waiting is not the connection's fault. */
    fun onPauseOrSeek() {
        startAt = null
        stallAt = null
    }

    fun onBuffering() {
        if (started && stallAt == null) stallAt = now()
    }

    fun stop() {
        started = false
        startAt = null
        stallAt = null
        stalls.clear()
    }

    /** Polled about once a second; true when the stream should step down one quality. */
    fun check(): Boolean {
        val t = now()
        startAt?.let { if (t - it >= START_LIMIT_MS) return persistent() }
        stallAt?.let {
            if (t - it >= STALL_MS) {
                stallAt = null
                stalls.addLast(t)
                while (stalls.isNotEmpty() && t - stalls.first() > STALL_WINDOW_MS) stalls.removeFirst()
                if (stalls.size >= 2) return persistent()
            }
        }
        return false
    }

    private fun persistent(): Boolean {
        stop()
        return true
    }

    companion object {
        const val STALL_MS = 2_500L
        const val STALL_WINDOW_MS = 120_000L
        const val START_LIMIT_MS = 12_000L
    }
}
