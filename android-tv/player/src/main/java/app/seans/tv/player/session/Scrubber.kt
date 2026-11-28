package app.seans.tv.player.session

/**
 * Seeking on the progress bar, as in Lampa's player: each Left/Right moves a target time, the step
 * grows while the key is held (10 s, then 30 s, then 60 s), and the player jumps there once, about
 * [COMMIT_DELAY_MS] after the last press, so it does not load at every step. Pure and clock-driven
 * so the unit tests pin it down; the screen calls [poll] a few times a second.
 */
internal class Scrubber(
    private val now: () -> Long,
    private val seek: (Long) -> Unit,
) {
    /** The time the viewer is choosing, or null when not scrubbing. */
    var targetMs: Long? = null
        private set

    val isScrubbing: Boolean get() = targetMs != null

    private var direction = 0
    private var steps = 0
    private var lastPressAt = 0L
    private var lastStepAt = 0L

    /**
     * One press (or a key repeat) toward [direction] (-1 back, +1 forward) from [positionMs] when
     * scrubbing starts. [durationMs] 0 means unknown (no upper bound).
     */
    fun press(direction: Int, positionMs: Long, durationMs: Long, repeat: Boolean = false) {
        val t = now()
        val start = targetMs ?: positionMs
        if (direction != this.direction || t - lastPressAt > STREAK_GAP_MS) steps = 0
        lastPressAt = t
        this.direction = direction
        // A held key repeats about 20 times a second; one step per REPEAT_STEP_MS keeps it usable.
        if (repeat && steps > 0 && t - lastStepAt < REPEAT_STEP_MS) {
            targetMs = start
            return
        }
        steps++
        lastStepAt = t
        val moved = start + direction * stepFor(steps)
        val upper = if (durationMs > 0) (durationMs - END_MARGIN_MS).coerceAtLeast(0) else Long.MAX_VALUE
        targetMs = moved.coerceIn(0, upper)
    }

    /** Seeks once when the viewer has stopped pressing; true when it did. */
    fun poll(): Boolean {
        val target = targetMs ?: return false
        if (now() - lastPressAt < COMMIT_DELAY_MS) return false
        targetMs = null
        steps = 0
        direction = 0
        seek(target)
        return true
    }

    fun cancel() {
        targetMs = null
        steps = 0
        direction = 0
    }

    companion object {
        const val COMMIT_DELAY_MS = 600L
        /** Presses closer than this continue a streak (a held key or quick repeated presses). */
        const val STREAK_GAP_MS = 450L
        const val REPEAT_STEP_MS = 120L
        /** A seek never lands in the last second (it would end the media at once). */
        const val END_MARGIN_MS = 1_000L

        /** 10 s for the first three steps, 30 s up to the eighth, then 60 s. */
        fun stepFor(step: Int): Long = when {
            step <= 3 -> 10_000L
            step <= 8 -> 30_000L
            else -> 60_000L
        }
    }
}

/** What a key does on the focused progress bar. */
internal enum class BarAction { SeekBack, SeekForward, TogglePause, None }

internal object BarKeys {
    fun action(keyCode: Int): BarAction = when (keyCode) {
        android.view.KeyEvent.KEYCODE_DPAD_LEFT -> BarAction.SeekBack
        android.view.KeyEvent.KEYCODE_DPAD_RIGHT -> BarAction.SeekForward
        android.view.KeyEvent.KEYCODE_DPAD_CENTER, android.view.KeyEvent.KEYCODE_ENTER,
        android.view.KeyEvent.KEYCODE_NUMPAD_ENTER -> BarAction.TogglePause
        else -> BarAction.None
    }
}
