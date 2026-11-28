package app.seans.tv.player.engine

import androidx.annotation.OptIn
import androidx.media3.common.C
import androidx.media3.common.util.UnstableApi
import androidx.media3.exoplayer.DefaultLoadControl
import androidx.media3.exoplayer.upstream.DefaultAllocator

/**
 * Every memory and buffer constant of the player, in one place (risk M1).
 *
 * The TCL G13 has a 128 MB Java heap and `DefaultAllocator` keeps the buffer as Java `byte[]`.
 * Media3's default target for video is sized from the tracks and can reach about 128 MB, so it is
 * capped here by bytes, and the byte cap wins over the time thresholds.
 */
internal object PlayerBudget {
    /** Bytes the buffer may hold; loading stops here even below [MIN_BUFFER_MS]. */
    const val TARGET_BUFFER_BYTES = 36 * 1024 * 1024
    const val MIN_BUFFER_MS = 15_000
    const val MAX_BUFFER_MS = 30_000
    const val BUFFER_FOR_PLAYBACK_MS = 2_500
    const val BUFFER_FOR_PLAYBACK_AFTER_REBUFFER_MS = 5_000
    /** Kept behind the playhead for short seeks back; the extension's 300 s would not fit. */
    const val BACK_BUFFER_MS = 10_000

    /** Largest video the track selector picks on its own: the panel is 1920x1080. */
    const val MAX_VIDEO_WIDTH = 1920
    const val MAX_VIDEO_HEIGHT = 1080

    const val SEEK_STEP_MS = 10_000L

    @OptIn(UnstableApi::class)
    fun loadControl(): DefaultLoadControl = DefaultLoadControl.Builder()
        .setAllocator(DefaultAllocator(true, C.DEFAULT_BUFFER_SEGMENT_SIZE))
        .setBufferDurationsMs(MIN_BUFFER_MS, MAX_BUFFER_MS, BUFFER_FOR_PLAYBACK_MS, BUFFER_FOR_PLAYBACK_AFTER_REBUFFER_MS)
        .setTargetBufferBytes(TARGET_BUFFER_BYTES)
        .setPrioritizeTimeOverSizeThresholds(false)
        .setBackBuffer(BACK_BUFFER_MS, true)
        .build()
}
