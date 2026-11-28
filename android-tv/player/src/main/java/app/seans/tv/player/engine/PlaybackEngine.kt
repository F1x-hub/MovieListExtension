package app.seans.tv.player.engine

import app.seans.tv.model.PlayableStream
import app.seans.tv.model.StreamFormat

/**
 * What the playback sessions need from a player. [ExoEngine] implements it on the shared
 * `ExoPlayer`; unit tests use a fake, so the source, retry and progress logic runs on the JVM.
 */
internal interface PlaybackEngine {
    /**
     * Replaces the media with [url] (one of [stream]'s URLs: the main one, a Kodik quality or the
     * fallback) in [format] at [startPositionMs].
     */
    fun load(stream: PlayableStream, url: String, format: StreamFormat, startPositionMs: Long, playWhenReady: Boolean)

    /**
     * Picks the voice among the manifest's audio tracks (Collaps, [PlayableStream.audioTrackIndex]):
     * HLS renditions in manifest order, DASH by the digit of `lang="ruN"`. Null leaves the default.
     */
    fun selectAudioTrack(index: Int?)
    fun play()
    fun pause()
    fun seekTo(positionMs: Long)
    /** Stops loading and drops the media; the player itself stays for the next [load]. */
    fun stop()

    val hasMedia: Boolean
    val positionMs: Long
    /** 0 while unknown. */
    val durationMs: Long
    val bufferedMs: Long
    val isPlaying: Boolean
    val playWhenReady: Boolean
    val isBuffering: Boolean
    /** Height of the video variant playing now; 0 while unknown. */
    val videoHeight: Int
    /** Playback speed (1.0 normally), for «Конец в …». */
    val speed: Float

    fun setMuted(muted: Boolean)
    /** A side-loaded subtitle by its URL; null turns subtitles off. */
    fun selectSubtitle(url: String?)
    /** Heights of the video variants of an adaptive stream, best first; empty for a single variant. */
    fun videoHeights(): List<Int>
    /** Pins a variant height of an adaptive stream; null returns to automatic selection. */
    fun selectHeight(height: Int?)

    var listener: EngineListener?
}

internal interface EngineListener {
    fun onReady() {}
    fun onBuffering() {}
    fun onPlayingChanged(playing: Boolean) {}
    /** A real end of the media (not a stop or an error). */
    fun onEnded() {}
    /** A seek finished its discontinuity (the session ignores the buffering that follows it). */
    fun onSeek() {}
    fun onError(error: EngineError) {}
    fun onTracksChanged() {}
    fun onCues(lines: List<String>) {}
    /** Another app took audio focus for good; the player paused itself (a transient loss only ducks or mutes). */
    fun onAudioFocusLost() {}
}

/** Why playback failed, reduced to what the sessions act on. */
internal data class EngineError(
    /** 401/403/404/410 from the CDN: the signed URL expired (risk N5). */
    val expired: Boolean,
    val httpCode: Int? = null,
    /** The format cannot be played by this build (DASH before its module is added). */
    val unsupported: Boolean = false,
    /** For logs: a short code, never a URL. */
    val code: String,
)
