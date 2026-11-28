package app.seans.tv.player.engine

import android.content.Context
import android.net.Uri
import android.util.Log
import androidx.annotation.OptIn
import androidx.media3.common.C
import androidx.media3.common.MediaItem
import androidx.media3.common.MimeTypes
import androidx.media3.common.PlaybackException
import androidx.media3.common.Player
import androidx.media3.common.TrackSelectionOverride
import androidx.media3.common.text.CueGroup
import androidx.media3.common.util.UnstableApi
import androidx.media3.datasource.HttpDataSource
import androidx.media3.datasource.okhttp.OkHttpDataSource
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.exoplayer.source.DefaultMediaSourceFactory
import androidx.media3.exoplayer.upstream.DefaultLoadErrorHandlingPolicy
import androidx.media3.exoplayer.upstream.LoadErrorHandlingPolicy
import app.seans.tv.model.PlayableStream
import app.seans.tv.model.StreamFormat
import app.seans.tv.network.SeansHttp

private const val TAG = "SeansPlayer"

/** CDN answers that mean the signed URL expired; never retried by ExoPlayer, handled by the session (N5). */
internal val EXPIRED_HTTP_CODES = setOf(401, 403, 404, 410)

/**
 * [PlaybackEngine] on the [SharedPlayer]. Every request goes through `SeansHttp.mediaClient`
 * (DNS-over-HTTPS, no HTTP cache) with the stream's headers (risk N1); Media3's default HTTP source is
 * never used. Construct it, then [attach] when the screen starts and [detach] when it stops.
 */
@OptIn(UnstableApi::class)
internal class ExoEngine(
    private val context: Context,
    private val http: SeansHttp,
) : PlaybackEngine {
    override var listener: EngineListener? = null

    private var player: ExoPlayer? = null
    private var pendingSubtitle: String? = null
    private var subtitleChosen = false
    private var pendingAudio: Int? = null
    private var audioChosen = false
    private var loadedFormat: StreamFormat = StreamFormat.HLS
    private var muted = false

    /** The player while this engine owns it, for the video surface. */
    val exoPlayer: ExoPlayer? get() = player?.takeIf { SharedPlayer.isOwner(this) }

    private val playerListener = object : Player.Listener {
        override fun onPlaybackStateChanged(playbackState: Int) {
            when (playbackState) {
                Player.STATE_READY -> listener?.onReady()
                Player.STATE_BUFFERING -> listener?.onBuffering()
                Player.STATE_ENDED -> listener?.onEnded()
            }
        }

        override fun onIsPlayingChanged(isPlaying: Boolean) {
            listener?.onPlayingChanged(isPlaying)
        }

        override fun onPlayWhenReadyChanged(playWhenReady: Boolean, reason: Int) {
            if (!playWhenReady && reason == Player.PLAY_WHEN_READY_CHANGE_REASON_AUDIO_FOCUS_LOSS) listener?.onAudioFocusLost()
        }

        override fun onPositionDiscontinuity(oldPosition: Player.PositionInfo, newPosition: Player.PositionInfo, reason: Int) {
            if (reason == Player.DISCONTINUITY_REASON_SEEK) listener?.onSeek()
        }

        override fun onPlayerError(error: PlaybackException) {
            val mapped = map(error)
            Log.w(TAG, "playback error ${mapped.code} http=${mapped.httpCode}")
            listener?.onError(mapped)
        }

        override fun onTracksChanged(tracks: androidx.media3.common.Tracks) {
            if (subtitleChosen) applySubtitle(pendingSubtitle)
            if (audioChosen) applyAudio(pendingAudio)
            listener?.onTracksChanged()
        }

        override fun onCues(cueGroup: CueGroup) {
            listener?.onCues(cueGroup.cues.mapNotNull { it.text?.toString()?.takeIf(String::isNotBlank) })
        }
    }

    /** Takes the shared player over; any other owner's media stops. */
    fun attach(): ExoPlayer {
        val p = SharedPlayer.acquire(context, this, playerListener)
        p.volume = if (muted) 0f else 1f
        player = p
        return p
    }

    /** Releases the decoder if this engine still owns it (`ON_STOP`, leaving the screen). */
    fun detach() {
        SharedPlayer.release(this)
        player = null
    }

    private fun owned(): ExoPlayer? = player?.takeIf { SharedPlayer.isOwner(this) }

    override fun load(stream: PlayableStream, url: String, format: StreamFormat, startPositionMs: Long, playWhenReady: Boolean) {
        val p = owned() ?: return
        subtitleChosen = false
        pendingSubtitle = null
        audioChosen = false
        pendingAudio = null
        loadedFormat = format
        val source = try {
            mediaSourceFactory(stream).createMediaSource(mediaItem(stream, url, format))
        } catch (e: IllegalStateException) {
            // DefaultMediaSourceFactory throws when the format's module is not in the build.
            listener?.onError(EngineError(expired = false, unsupported = true, code = "UNSUPPORTED_$format"))
            return
        }
        Log.i(TAG, "load ${stream.providerId.key} $format host=${Uri.parse(url).host}")
        p.trackSelectionParameters = p.trackSelectionParameters.buildUpon()
            .clearOverridesOfType(C.TRACK_TYPE_VIDEO)
            .clearOverridesOfType(C.TRACK_TYPE_AUDIO)
            .clearOverridesOfType(C.TRACK_TYPE_TEXT)
            .setTrackTypeDisabled(C.TRACK_TYPE_TEXT, true)
            .build()
        p.setMediaSource(source, startPositionMs.coerceAtLeast(0))
        p.playWhenReady = playWhenReady
        p.prepare()
    }

    override fun play() { owned()?.play() }
    override fun pause() { owned()?.pause() }
    override fun seekTo(positionMs: Long) { owned()?.seekTo(positionMs.coerceAtLeast(0)) }

    override fun stop() {
        owned()?.let { it.stop(); it.clearMediaItems() }
    }

    override val hasMedia: Boolean get() = (owned()?.mediaItemCount ?: 0) > 0
    override val positionMs: Long get() = owned()?.currentPosition ?: 0L
    override val durationMs: Long get() = owned()?.duration?.takeIf { it != C.TIME_UNSET && it > 0 } ?: 0L
    override val bufferedMs: Long get() = owned()?.bufferedPosition ?: 0L
    override val isPlaying: Boolean get() = owned()?.isPlaying == true
    override val playWhenReady: Boolean get() = owned()?.playWhenReady == true
    override val isBuffering: Boolean get() = owned()?.playbackState == Player.STATE_BUFFERING
    override val videoHeight: Int get() = owned()?.videoSize?.height ?: 0
    override val speed: Float get() = owned()?.playbackParameters?.speed ?: 1f

    override fun setMuted(muted: Boolean) {
        this.muted = muted
        owned()?.volume = if (muted) 0f else 1f
    }

    override fun selectSubtitle(url: String?) {
        subtitleChosen = true
        pendingSubtitle = url
        applySubtitle(url)
    }

    private fun applySubtitle(url: String?) {
        val p = owned() ?: return
        val builder = p.trackSelectionParameters.buildUpon().clearOverridesOfType(C.TRACK_TYPE_TEXT)
        if (url == null) {
            p.trackSelectionParameters = builder.setTrackTypeDisabled(C.TRACK_TYPE_TEXT, true).build()
            return
        }
        val group = p.currentTracks.groups.firstOrNull { g ->
            g.type == C.TRACK_TYPE_TEXT && (0 until g.length).any { i -> g.getTrackFormat(i).id?.let { it == url || it.endsWith(url) } == true }
        } ?: return // Tracks not known yet; applied again on onTracksChanged.
        p.trackSelectionParameters = builder
            .setTrackTypeDisabled(C.TRACK_TYPE_TEXT, false)
            .setOverrideForType(TrackSelectionOverride(group.mediaTrackGroup, 0))
            .build()
    }

    override fun selectAudioTrack(index: Int?) {
        audioChosen = index != null
        pendingAudio = index
        if (index != null) applyAudio(index)
    }

    private fun applyAudio(index: Int?) {
        val p = owned() ?: return
        if (index == null) return
        val groups = p.currentTracks.groups.filter { it.type == C.TRACK_TYPE_AUDIO }
        if (groups.isEmpty()) return // Tracks not known yet; applied again on onTracksChanged.
        val group = if (loadedFormat == StreamFormat.DASH) {
            // Collaps shuffles the AdaptationSet ids; the voice index is the digit of lang="ruN".
            groups.firstOrNull { g -> (0 until g.length).any { i -> dashVoiceIndex(g.getTrackFormat(i)) == index } }
        } else {
            groups.getOrNull(index)
        } ?: return
        val override = TrackSelectionOverride(group.mediaTrackGroup, (0 until group.length).filter { group.isTrackSupported(it) }.ifEmpty { listOf(0) })
        if (p.trackSelectionParameters.overrides[group.mediaTrackGroup] == override) return
        p.trackSelectionParameters = p.trackSelectionParameters.buildUpon()
            .clearOverridesOfType(C.TRACK_TYPE_AUDIO)
            .setOverrideForType(override)
            .build()
    }

    private fun dashVoiceIndex(format: androidx.media3.common.Format): Int? =
        listOfNotNull(format.language, format.id, format.label)
            .firstNotNullOfOrNull { Regex("^ru-?(\\d+)$", RegexOption.IGNORE_CASE).find(it.trim())?.groupValues?.get(1)?.toIntOrNull() }

    override fun videoHeights(): List<Int> {
        val p = owned() ?: return emptyList()
        return p.currentTracks.groups
            .filter { it.type == C.TRACK_TYPE_VIDEO }
            .flatMap { g -> (0 until g.length).filter { g.isTrackSupported(it) }.map { g.getTrackFormat(it).height } }
            .filter { it > 0 && it <= PlayerBudget.MAX_VIDEO_HEIGHT }
            .distinct()
            .sortedDescending()
            .takeIf { it.size > 1 }
            .orEmpty()
    }

    override fun selectHeight(height: Int?) {
        val p = owned() ?: return
        val builder = p.trackSelectionParameters.buildUpon().clearOverridesOfType(C.TRACK_TYPE_VIDEO)
        if (height != null) {
            val group = p.currentTracks.groups.firstOrNull { g ->
                g.type == C.TRACK_TYPE_VIDEO && (0 until g.length).any { g.getTrackFormat(it).height == height }
            }
            if (group != null) {
                val indices = (0 until group.length).filter { group.getTrackFormat(it).height == height }
                builder.setOverrideForType(TrackSelectionOverride(group.mediaTrackGroup, indices))
            }
        }
        p.trackSelectionParameters = builder.build()
    }

    private fun mediaSourceFactory(stream: PlayableStream): DefaultMediaSourceFactory {
        // mediaClient sets the desktop Chrome UA, which CDNs bind tokens to; a stream never overrides it.
        val headers = stream.headers.filterKeys { !it.equals("User-Agent", ignoreCase = true) }
        val dataSource = OkHttpDataSource.Factory(http.mediaClient)
            .setDefaultRequestProperties(headers)
        return DefaultMediaSourceFactory(dataSource).setLoadErrorHandlingPolicy(ExpiredFailsFast)
    }

    private fun mediaItem(stream: PlayableStream, url: String, format: StreamFormat): MediaItem = MediaItem.Builder()
        .setUri(url)
        .setMimeType(
            when (format) {
                StreamFormat.HLS -> MimeTypes.APPLICATION_M3U8
                StreamFormat.MP4 -> MimeTypes.VIDEO_MP4
                StreamFormat.DASH -> MimeTypes.APPLICATION_MPD
            },
        )
        .setSubtitleConfigurations(
            stream.subtitles.map { track ->
                MediaItem.SubtitleConfiguration.Builder(Uri.parse(track.url))
                    .setId(track.url)
                    .setLanguage(track.language)
                    .setLabel(track.label)
                    .setMimeType(subtitleMime(track.url))
                    .build()
            },
        )
        .build()

    private fun subtitleMime(url: String): String {
        val path = Uri.parse(url).path.orEmpty().lowercase()
        return when {
            path.endsWith(".srt") -> MimeTypes.APPLICATION_SUBRIP
            path.endsWith(".ass") || path.endsWith(".ssa") -> MimeTypes.TEXT_SSA
            else -> MimeTypes.TEXT_VTT
        }
    }

    private fun map(error: PlaybackException): EngineError {
        var cause: Throwable? = error
        while (cause != null) {
            if (cause is HttpDataSource.InvalidResponseCodeException) {
                return EngineError(expired = cause.responseCode in EXPIRED_HTTP_CODES, httpCode = cause.responseCode, code = error.errorCodeName)
            }
            cause = cause.cause
        }
        val unsupported = error.errorCode == PlaybackException.ERROR_CODE_PARSING_CONTAINER_UNSUPPORTED ||
            error.errorCode == PlaybackException.ERROR_CODE_DECODING_FORMAT_UNSUPPORTED
        return EngineError(expired = false, unsupported = unsupported, code = error.errorCodeName)
    }
}

/** Default retries, except an expired URL fails at once so the session can resolve it again. */
@OptIn(UnstableApi::class)
private object ExpiredFailsFast : DefaultLoadErrorHandlingPolicy() {
    override fun getRetryDelayMsFor(loadErrorInfo: LoadErrorHandlingPolicy.LoadErrorInfo): Long {
        val e = loadErrorInfo.exception
        if (e is HttpDataSource.InvalidResponseCodeException && e.responseCode in EXPIRED_HTTP_CODES) return C.TIME_UNSET
        return super.getRetryDelayMsFor(loadErrorInfo)
    }
}
