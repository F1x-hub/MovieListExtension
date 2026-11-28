package app.seans.tv.player.engine

import android.content.Context
import android.os.Looper
import androidx.annotation.OptIn
import androidx.media3.common.AudioAttributes
import androidx.media3.common.C
import androidx.media3.common.Player
import androidx.media3.common.util.UnstableApi
import androidx.media3.exoplayer.DefaultRenderersFactory
import androidx.media3.exoplayer.ExoPlayer

/**
 * The one `ExoPlayer` of the process (risk M2: the TV's SoC may allow one video decoder).
 *
 * A screen acquires it with an owner token and a listener. A second owner (the next screen during a
 * navigation transition) takes the same instance over: the media is cleared and the old listener
 * detached, and the old owner's later [release] does nothing. The instance is released when its
 * owner leaves or stops (`ON_STOP`), and built again on the next acquire. Main thread only.
 */
internal object SharedPlayer {
    private var player: ExoPlayer? = null
    private var owner: Any? = null
    private var listener: Player.Listener? = null

    fun acquire(context: Context, owner: Any, listener: Player.Listener): ExoPlayer {
        check(Looper.myLooper() == Looper.getMainLooper()) { "SharedPlayer is main-thread only" }
        val current = player ?: build(context.applicationContext).also { player = it }
        if (this.owner !== owner) {
            current.stop()
            current.clearMediaItems()
            current.volume = 1f
            this.owner = owner
        }
        this.listener?.let(current::removeListener)
        this.listener = listener
        current.addListener(listener)
        return current
    }

    fun isOwner(owner: Any): Boolean = this.owner === owner && player != null

    /** Releases the decoder if [owner] still holds the player; a stale owner changes nothing. */
    fun release(owner: Any) {
        if (this.owner !== owner) return
        listener?.let { player?.removeListener(it) }
        player?.release()
        player = null
        listener = null
        this.owner = null
    }

    @OptIn(UnstableApi::class)
    private fun build(context: Context): ExoPlayer {
        val renderers = DefaultRenderersFactory(context).setEnableDecoderFallback(true)
        val player = ExoPlayer.Builder(context, renderers)
            .setLoadControl(PlayerBudget.loadControl())
            .setAudioAttributes(
                AudioAttributes.Builder().setUsage(C.USAGE_MEDIA).setContentType(C.AUDIO_CONTENT_TYPE_MOVIE).build(),
                /* handleAudioFocus = */ true,
            )
            .setHandleAudioBecomingNoisy(true)
            .setSeekBackIncrementMs(PlayerBudget.SEEK_STEP_MS)
            .setSeekForwardIncrementMs(PlayerBudget.SEEK_STEP_MS)
            .build()
        player.trackSelectionParameters = player.trackSelectionParameters.buildUpon()
            .setMaxVideoSize(PlayerBudget.MAX_VIDEO_WIDTH, PlayerBudget.MAX_VIDEO_HEIGHT)
            .setPreferredAudioLanguage("ru")
            .setTrackTypeDisabled(C.TRACK_TYPE_TEXT, true)
            .build()
        return player
    }
}
