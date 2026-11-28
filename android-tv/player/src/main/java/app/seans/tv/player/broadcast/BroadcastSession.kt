package app.seans.tv.player.broadcast

import app.seans.tv.player.PlayerLog
import app.seans.tv.model.BroadcastLock
import app.seans.tv.model.PlayableStream
import app.seans.tv.model.PlaybackRequest
import app.seans.tv.model.SeansError
import app.seans.tv.model.ServerClock
import app.seans.tv.model.SourceOption
import app.seans.tv.model.CatalogRepository
import app.seans.tv.model.SourceQuery
import app.seans.tv.model.SourceResolver
import app.seans.tv.model.SubtitleTrack
import app.seans.tv.model.VoiceOption
import app.seans.tv.player.BroadcastController
import app.seans.tv.player.BroadcastPlaybackState
import app.seans.tv.player.engine.EngineError
import app.seans.tv.player.engine.EngineListener
import app.seans.tv.player.engine.PlaybackEngine
import app.seans.tv.player.session.QualityLadder
import app.seans.tv.player.session.QualityStep
import app.seans.tv.player.session.SourcePicker
import app.seans.tv.player.session.StallWatch
import kotlin.math.abs
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.catch
import kotlinx.coroutines.flow.onCompletion
import kotlinx.coroutines.launch
import kotlinx.coroutines.withTimeoutOrNull

private const val TAG = "SeansBroadcast"

/** The viewer's own broadcast settings; they outlive a session (the app going to the background). */
internal class BroadcastPrefs {
    var voiceId: String? = null
    var subtitleUrl: String? = null
    var muted: Boolean = false
}

/**
 * Locked playback for «Эфир» (risk L2, D5). Plays only the scheduled title and episode, at the
 * channel's position: no pause, seek, episode change, auto-next or progress writes. Follows
 * admin pause, resume and seek through [lock], and corrects drift only by seeking (more than
 * [DRIFT_PLAYING_MS] off while playing, [DRIFT_PAUSED_MS] while paused). There is no
 * `MediaSession`, so the remote's media keys, HDMI-CEC and the Assistant cannot reach the player.
 *
 * One session lives for one started period of the screen; [BroadcastPrefs] carry the viewer's
 * voice, subtitles and mute across sessions.
 */
internal class BroadcastSession(
    private val request: PlaybackRequest,
    private val lock: StateFlow<BroadcastLock>,
    private val clock: ServerClock,
    private val sources: SourceResolver,
    private val engine: PlaybackEngine,
    private val scope: CoroutineScope,
    private val prefs: BroadcastPrefs,
    private val onState: (BroadcastPlaybackState) -> Unit,
    private val elapsed: () -> Long,
    private val searchTimeoutMs: Long = SEARCH_TIMEOUT_MS,
    private val catalog: CatalogRepository? = null,
) : BroadcastController, EngineListener {
    private val picker = SourcePicker(request.preferredProvider, stored = null, episode = request.episode)
    private val tried = mutableListOf<SourceOption>()
    private var option: SourceOption? = null
    private var stream: PlayableStream? = null
    private var ladder: List<QualityStep> = emptyList()
    private var step = -1
    private var expiredRetries = 0
    /** The stream's fallback is playing (Collaps HLS after its DASH failed). */
    private var usingFallback = false
    /** Bumped on every resolve or load; an async answer for an older one is dropped. */
    private var generation = 0
    private var forced = false
    private var graceJob: Job? = null
    /** Another app took audio focus for good; set until this session ends (the next ON_START). */
    private var focusLost = false
    private var ready = false
    private var seekPending = false
    private var seekStartedAt = 0L
    private var seekLatencyMs = 0L
    private var reported: BroadcastPlaybackState? = null
    private val stalls = StallWatch(elapsed)
    private val jobs = mutableListOf<Job>()

    private val _voices = MutableStateFlow<List<VoiceOption>>(emptyList())
    private val _subtitles = MutableStateFlow<List<SubtitleTrack>>(emptyList())
    val voicesFlow: StateFlow<List<VoiceOption>> = _voices.asStateFlow()
    val subtitlesFlow: StateFlow<List<SubtitleTrack>> = _subtitles.asStateFlow()
    private val _voice = MutableStateFlow<String?>(null)
    /** The voice the playing stream was resolved with. */
    val voiceFlow: StateFlow<String?> = _voice.asStateFlow()
    private val _cues = MutableStateFlow<List<String>>(emptyList())
    /** Subtitle lines on screen now. */
    val cuesFlow: StateFlow<List<String>> = _cues.asStateFlow()

    fun start() {
        engine.listener = this
        engine.setMuted(prefs.muted)
        report(BroadcastPlaybackState.Searching)
        jobs += scope.launch { search() }
        jobs += scope.launch {
            delay(searchTimeoutMs)
            forced = true
            advance()
            if (option == null && reported == BroadcastPlaybackState.Searching) report(BroadcastPlaybackState.NoSource)
        }
        jobs += scope.launch { lock.collect { sync() } }
        jobs += scope.launch {
            while (true) {
                delay(TICK_MS)
                sync()
                if (step >= 0 && stalls.check()) stepDown()
            }
        }
    }

    fun stop() {
        jobs.forEach { it.cancel() }
        jobs.clear()
        generation++
        stalls.stop()
        if (engine.listener === this) engine.listener = null
    }

    private suspend fun search() {
        // AnimeGo needs the per-season episode counts; the catalogue answers from its cache.
        val seasons = if (request.episode != null && catalog != null) {
            withTimeoutOrNull(SEASONS_TIMEOUT_MS) { runCatching { catalog.details(request.summary.ref).seasons }.getOrNull() }.orEmpty()
        } else {
            emptyList()
        }
        val query = SourceQuery.forTitle(request.summary, request.episode, seasons)
        sources.find(query)
            .catch { e -> if (e is CancellationException) throw e; PlayerLog.w(TAG, "find failed: ${e.javaClass.simpleName}") }
            .onCompletion { cause -> if (cause == null) picker.onEvent(app.seans.tv.model.SourceEvent.Done) }
            .collect { event ->
                picker.onEvent(event)
                advance()
            }
        advance()
    }

    /** Plays the next option when nothing is playing or loading. */
    private fun advance() {
        if (option != null) return
        val next = picker.next(tried, forced)
        if (next != null) {
            tryOption(next)
            return
        }
        // Something playable waits for a better-ranked provider: give that one a short grace only,
        // and never pass over the request's preferred provider before it answers.
        if (graceJob == null && picker.next(tried, force = true) != null && !picker.waitingForPreferred()) {
            graceJob = scope.launch {
                delay(BETTER_SOURCE_WAIT_MS)
                forced = true
                advance()
            }.also { jobs += it }
        }
        if (picker.exhausted(tried)) {
            report(
                if (tried.isEmpty() && picker.options.isEmpty() && picker.anyFailed) BroadcastPlaybackState.Failed(SeansError(SeansError.Code.NETWORK))
                else BroadcastPlaybackState.NoSource,
            )
        }
    }

    private fun tryOption(next: SourceOption) {
        tried += next
        option = next
        expiredRetries = 0
        _voices.value = next.voices
        resolveAndLoad()
    }

    /** [trackSwitch]: only the voice changes; a voice that is an audio track of the playing manifest switches without a reload. */
    private fun resolveAndLoad(trackSwitch: Boolean = false, fresh: Boolean = false) {
        val current = option ?: return
        val gen = ++generation
        if (!trackSwitch) ready = false
        val voice = SourcePicker.voiceFor(current, prefs.voiceId, request.preferredVoiceId)
        _voice.value = voice
        scope.launch {
            val result = runCatching { sources.resolve(current, request.episode, voice, fresh) }
            if (gen != generation) return@launch
            val resolved = result.getOrElse { e ->
                if (e is CancellationException) throw e
                PlayerLog.w(TAG, "resolve failed: ${current.providerId.key} ${(e as? SeansError)?.code}")
                // A failed voice change keeps the voice that plays.
                if (trackSwitch && stream != null && engine.hasMedia) return@launch
                optionFailed()
                return@launch
            }
            // A broadcast plays only the scheduled episode: a stream that does not confirm it is refused.
            if (request.episode != null && resolved.episode != request.episode) {
                PlayerLog.w(TAG, "episode not confirmed by ${current.providerId.key}")
                optionFailed()
                return@launch
            }
            val playing = stream
            if (trackSwitch && playing != null && resolved.audioTrackIndex != null &&
                resolved.url.substringBefore('?') == playing.url.substringBefore('?') && resolved.format == playing.format
            ) {
                stream = playing.copy(audioTrackIndex = resolved.audioTrackIndex, voiceId = resolved.voiceId)
                engine.selectAudioTrack(resolved.audioTrackIndex)
                return@launch
            }
            val keepStep = playing?.let { it.providerId == resolved.providerId } == true && step >= 0
            usingFallback = false
            stream = resolved
            _subtitles.value = resolved.subtitles
            val newLadder = QualityLadder.of(resolved, current.quality)
            step = if (keepStep && step < newLadder.size) step else QualityLadder.startIndex(newLadder)
            ladder = newLadder
            load()
        }
    }

    private fun load() {
        val s = stream ?: return
        val fallback = s.fallback?.takeIf { usingFallback }
        val url = fallback?.url ?: ladder.getOrNull(step)?.url ?: s.url
        val target = lock.value.targetPositionMs(clock)
        val paused = lock.value.pausedAtMs != null
        ready = false
        seekPending = false
        engine.load(s, url, fallback?.format ?: s.format, target + if (paused) 0 else seekLatencyMs, playWhenReady = !paused)
        engine.selectAudioTrack(s.audioTrackIndex)
        if (!paused && step >= 0) stalls.onLoad()
        prefs.subtitleUrl?.takeIf { sub -> s.subtitles.any { it.url == sub } }?.let(engine::selectSubtitle)
    }

    private fun optionFailed() {
        option = null
        stream = null
        ladder = emptyList()
        step = -1
        stalls.stop()
        engine.stop()
        advance()
    }

    private fun stepDown() {
        if (step < 0 || step >= ladder.lastIndex) return
        step++
        PlayerLog.i(TAG, "stepping down to ${ladder[step].option.label}")
        load()
    }

    /** Pulls the player to the channel position. Called on every lock change and tick. */
    private fun sync() {
        if (stream == null || !ready || !engine.hasMedia) return
        val l = lock.value
        val paused = l.pausedAtMs != null
        if (paused && engine.playWhenReady) engine.pause()
        // After a permanent audio focus loss the viewer is elsewhere: never grab focus back. The
        // next ON_START starts a new session; drift is still corrected by seeking meanwhile.
        if (!paused && !engine.playWhenReady && !focusLost) engine.play()
        if (seekPending) {
            if (engine.isBuffering) return
            seekLatencyMs = (elapsed() - seekStartedAt).coerceIn(0, MAX_SEEK_LEAD_MS)
            seekPending = false
        }
        val duration = engine.durationMs
        val target = l.targetPositionMs(clock)
        // Past the end of this file (the slot runs longer): nothing to seek to.
        if (duration > 0 && target >= duration) return
        val tolerance = if (paused) DRIFT_PAUSED_MS else DRIFT_PLAYING_MS
        if (abs(engine.positionMs - target) > tolerance) {
            val lead = if (paused) 0 else seekLatencyMs
            val to = if (duration > 0) (target + lead).coerceAtMost(duration - 1_000) else target + lead
            engine.seekTo(to)
            seekPending = true
            seekStartedAt = elapsed()
        }
    }

    private fun report(state: BroadcastPlaybackState) {
        if (state == reported) return
        reported = state
        onState(state)
    }

    // EngineListener

    override fun onReady() {
        ready = true
        option?.let { report(BroadcastPlaybackState.Playing(it.providerId)) }
        sync()
    }

    override fun onPlayingChanged(playing: Boolean) {
        if (playing) stalls.onPlaying()
    }

    override fun onBuffering() {
        if (!seekPending) stalls.onBuffering()
    }

    override fun onSeek() {
        stalls.onPauseOrSeek()
    }

    override fun onAudioFocusLost() {
        focusLost = true
    }

    override fun onCues(lines: List<String>) {
        _cues.value = lines
    }

    override fun onEnded() {
        stalls.stop()
        // The file ended before the slot did (the extension's BROADCAST_ENDED): `:live` shows its standby.
        val endsAt = lock.value.endsAtServerMs
        if (endsAt == null || clock.nowMs() < endsAt) report(BroadcastPlaybackState.Ended(engine.positionMs))
    }

    override fun onError(error: EngineError) {
        val s = stream
        if (!error.expired && s?.fallback != null && !usingFallback) {
            usingFallback = true
            PlayerLog.i(TAG, "${error.code} on ${s.format}, trying the ${s.fallback?.format} fallback")
            load()
            return
        }
        if (error.expired && expiredRetries < MAX_EXPIRED_RETRIES && option != null) {
            expiredRetries++
            PlayerLog.i(TAG, "stream expired (${error.httpCode}), resolving again ($expiredRetries)")
            resolveAndLoad(fresh = true)
            return
        }
        optionFailed()
    }

    // BroadcastController

    override fun voices(): List<VoiceOption> = _voices.value

    override fun selectVoice(id: String) {
        prefs.voiceId = id
        if (option != null) {
            expiredRetries = 0
            resolveAndLoad(trackSwitch = true)
        }
    }

    override fun subtitles(): List<SubtitleTrack> = _subtitles.value

    override fun selectSubtitle(url: String?) {
        prefs.subtitleUrl = url
        engine.selectSubtitle(url)
    }

    override fun setMuted(muted: Boolean) {
        prefs.muted = muted
        engine.setMuted(muted)
    }

    companion object {
        const val DRIFT_PLAYING_MS = 3_000L
        const val DRIFT_PAUSED_MS = 1_000L
        const val MAX_EXPIRED_RETRIES = 2
        const val TICK_MS = 1_000L
        const val SEARCH_TIMEOUT_MS = 15_000L
        const val SEASONS_TIMEOUT_MS = 3_000L
        const val BETTER_SOURCE_WAIT_MS = 3_000L
        /** A seek is aimed this far ahead at most, to land on the moving channel position. */
        const val MAX_SEEK_LEAD_MS = 5_000L
    }
}
