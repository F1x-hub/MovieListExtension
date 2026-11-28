package app.seans.tv.player

import app.seans.tv.model.EpisodeKey
import app.seans.tv.model.PlayableStream
import app.seans.tv.model.PlaybackPosition
import app.seans.tv.model.ProgressRepository
import app.seans.tv.model.ProviderId
import app.seans.tv.model.SourceEvent
import app.seans.tv.model.SourceOption
import app.seans.tv.model.SourceQuery
import app.seans.tv.model.SourceResolver
import app.seans.tv.model.StreamFormat
import app.seans.tv.model.SubtitleTrack
import app.seans.tv.model.TitleRef
import app.seans.tv.player.engine.EngineError
import app.seans.tv.player.engine.EngineListener
import app.seans.tv.player.engine.PlaybackEngine
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.flow

/** A scripted player: tests move its position and fire its events. */
internal class FakeEngine : PlaybackEngine {
    data class Load(val url: String, val providerId: ProviderId, val episode: EpisodeKey?, val startMs: Long, val playWhenReady: Boolean, val format: StreamFormat = StreamFormat.HLS)

    val loads = mutableListOf<Load>()
    val seeks = mutableListOf<Long>()
    var mutedNow = false
    var subtitle: String? = "unset"
    override var listener: EngineListener? = null

    override var hasMedia = false
    override var positionMs = 0L
    override var durationMs = 0L
    override var bufferedMs = 0L
    override var isPlaying = false
    override var playWhenReady = false
    override var isBuffering = false
    override var videoHeight = 0
    override var speed = 1f

    val audioTracks = mutableListOf<Int?>()

    override fun selectAudioTrack(index: Int?) { audioTracks += index }

    override fun load(stream: PlayableStream, url: String, format: StreamFormat, startPositionMs: Long, playWhenReady: Boolean) {
        loads += Load(url, stream.providerId, stream.episode, startPositionMs, playWhenReady, format)
        hasMedia = true
        positionMs = startPositionMs
        this.playWhenReady = playWhenReady
        isPlaying = false
    }

    /** The media became ready and (if asked) plays. */
    fun ready(durationMs: Long = 2_820_000L) {
        this.durationMs = durationMs
        isBuffering = false
        listener?.onReady()
        if (playWhenReady) {
            isPlaying = true
            listener?.onPlayingChanged(true)
        }
    }

    fun buffering() {
        isBuffering = true
        listener?.onBuffering()
    }

    fun end() {
        positionMs = durationMs
        isPlaying = false
        listener?.onPlayingChanged(false)
        listener?.onEnded()
    }

    fun fail(error: EngineError) {
        isPlaying = false
        listener?.onError(error)
    }

    var playCalls = 0
    override fun play() { playCalls++; playWhenReady = true; if (hasMedia) isPlaying = true }

    /** Another app takes audio focus for good: the player pauses itself. */
    fun loseFocus() {
        playWhenReady = false
        isPlaying = false
        listener?.onPlayingChanged(false)
        listener?.onAudioFocusLost()
    }
    override fun pause() {
        playWhenReady = false
        val was = isPlaying
        isPlaying = false
        if (was) listener?.onPlayingChanged(false)
    }
    override fun seekTo(positionMs: Long) { seeks += positionMs; this.positionMs = positionMs; listener?.onSeek() }
    override fun stop() { hasMedia = false; isPlaying = false }
    override fun setMuted(muted: Boolean) { mutedNow = muted }
    override fun selectSubtitle(url: String?) { subtitle = url }
    override fun videoHeights(): List<Int> = emptyList()
    override fun selectHeight(height: Int?) {}
}

/** Resolver whose options and resolve results tests control. */
internal class FakeResolver(
    var events: List<SourceEvent>,
) : SourceResolver {
    val resolves = mutableListOf<Triple<ProviderId, EpisodeKey?, String?>>()
    val queries = mutableListOf<SourceQuery>()
    /** The `fresh` argument of every resolve call, in order. */
    val freshFlags = mutableListOf<Boolean>()
    /** Per provider: what resolve returns or throws. Default: a stream for the asked episode. */
    var resolveHook: suspend (SourceOption, EpisodeKey?, String?) -> PlayableStream = { option, episode, voice ->
        stream(option.providerId, episode, voice)
    }

    /** A provider that never answers: the flow stays open after [events]. */
    var hang = false
    var timed: List<Pair<Long, SourceEvent>> = emptyList()

    override fun find(query: SourceQuery): Flow<SourceEvent> = flow {
        queries += query
        events.forEach { emit(it) }
        // Events at their own times (ms since the search started), in order.
        var at = 0L
        timed.forEach { (time, event) ->
            kotlinx.coroutines.delay(time - at)
            at = time
            emit(event)
        }
        if (hang) kotlinx.coroutines.awaitCancellation()
    }

    override suspend fun resolve(option: SourceOption, episode: EpisodeKey?, voiceId: String?, fresh: Boolean): PlayableStream {
        resolves += Triple(option.providerId, episode, voiceId)
        freshFlags += fresh
        return resolveHook(option, episode, voiceId)
    }

    companion object {
        var counter = 0
        fun stream(provider: ProviderId, episode: EpisodeKey?, voice: String? = null, subtitles: List<SubtitleTrack> = emptyList()) = PlayableStream(
            url = "https://cdn.test/${provider.key}/${episode?.storageKey() ?: "film"}/${++counter}.m3u8",
            format = StreamFormat.HLS,
            episode = episode,
            providerId = provider,
            voiceId = voice,
            subtitles = subtitles,
        )
    }
}

internal class FakeProgress(initial: List<PlaybackPosition> = emptyList()) : ProgressRepository {
    val stored = initial.toMutableList()
    val saves = mutableListOf<PlaybackPosition>()
    /** When set, save suspends until the test completes it. */
    var gate: kotlinx.coroutines.CompletableDeferred<Unit>? = null

    override suspend fun get(ref: TitleRef, episode: EpisodeKey?) =
        stored.lastOrNull { it.ref.kinopoiskId == ref.kinopoiskId && it.episode == episode }

    override suspend fun latestFor(ref: TitleRef) = stored.filter { it.ref.kinopoiskId == ref.kinopoiskId }.maxByOrNull { it.updatedAt }

    override suspend fun episodesOf(ref: TitleRef) =
        stored.filter { it.ref.kinopoiskId == ref.kinopoiskId && it.episode != null }.associateBy { it.episode!! }

    override suspend fun save(position: PlaybackPosition) {
        saves += position
        gate?.await()
        stored += position
    }

    override fun recent(limit: Int): Flow<List<PlaybackPosition>> = MutableStateFlow(stored.toList())
}

internal fun option(provider: ProviderId, handle: String = provider.key, voices: List<app.seans.tv.model.VoiceOption> = emptyList()) =
    SourceOption(provider, handle = handle, voices = voices)
