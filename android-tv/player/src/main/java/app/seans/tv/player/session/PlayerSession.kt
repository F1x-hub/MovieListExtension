package app.seans.tv.player.session

import app.seans.tv.model.CatalogRepository
import app.seans.tv.model.EpisodeKey
import app.seans.tv.model.MediaType
import app.seans.tv.model.PlayableStream
import app.seans.tv.model.PlaybackPosition
import app.seans.tv.model.PlaybackRequest
import app.seans.tv.model.ProgressRepository
import app.seans.tv.model.ProviderId
import app.seans.tv.model.SeasonInfo
import app.seans.tv.model.SelectionReason
import app.seans.tv.model.SourceEvent
import app.seans.tv.model.SourceOption
import app.seans.tv.model.SourceQuery
import app.seans.tv.model.SourceResolver
import app.seans.tv.model.SubtitleTrack
import app.seans.tv.model.VoiceOption
import app.seans.tv.player.PlayerLog
import app.seans.tv.player.engine.EngineError
import app.seans.tv.player.engine.EngineListener
import app.seans.tv.player.engine.PlaybackEngine
import app.seans.tv.player.engine.PlayerBudget
import app.seans.tv.player.progress.ProgressIdentity
import app.seans.tv.player.progress.ProgressWriter
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.catch
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.onCompletion
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.coroutines.withTimeoutOrNull

private const val TAG = "SeansPlayer"

internal sealed interface Phase {
    /** Asking the providers. */
    data object Searching : Phase
    /** A source was chosen; resolving or buffering its stream. */
    data object Loading : Phase
    data object Playing : Phase
    /** No provider has this title or episode. Never an endless spinner. */
    data object NoSource : Phase
    /** Playback of [failed] broke; [offer] is the next source to try, when there is one. */
    data class Failed(val failed: ProviderId?, val offer: SourceOption?) : Phase
}

internal data class PlayerUiState(
    val title: String,
    val episode: EpisodeKey? = null,
    val episodeTitle: String? = null,
    val phase: Phase = Phase.Searching,
    val options: List<SourceOption> = emptyList(),
    val option: SourceOption? = null,
    val voices: List<VoiceOption> = emptyList(),
    val voiceId: String? = null,
    val subtitles: List<SubtitleTrack> = emptyList(),
    val subtitleUrl: String? = null,
    /** Quality labels the viewer can pick, best first; index -1 is automatic. */
    val qualities: List<String> = emptyList(),
    val qualityIndex: Int = -1,
    /** True when [qualities] are separate streams (Kodik) rather than variants of one. */
    val qualitiesAreStreams: Boolean = false,
    val seasons: List<SeasonInfo> = emptyList(),
    val episodeProgress: Map<EpisodeKey, PlaybackPosition> = emptyMap(),
    val next: EpisodeKey? = null,
    /** Seconds left before auto-next, while its countdown runs. */
    val autoNextIn: Int? = null,
    val ended: Boolean = false,
    val cues: List<String> = emptyList(),
) {
    val isSeries: Boolean get() = episode != null
}

/**
 * Personal playback without the UI: chooses and resolves sources, drives a [PlaybackEngine],
 * retries expired URLs, steps Kodik qualities down, runs auto-next and writes progress through
 * [ProgressWriter]. Every user selection bumps a version that is checked after each suspend point
 * (risk P3), so a slow resolve never overrides a newer choice.
 *
 * The screen calls [onStart]/[onStop] with the lifecycle (the engine is released on stop) and
 * [close] when it leaves.
 */
internal class PlayerSession(
    private val request: PlaybackRequest,
    private val sources: SourceResolver,
    private val progress: ProgressRepository,
    private val catalog: CatalogRepository?,
    private val engine: PlaybackEngine,
    private val scope: CoroutineScope,
    private val writer: ProgressWriter,
    private val elapsed: () -> Long,
    private val searchTimeoutMs: Long = SEARCH_TIMEOUT_MS,
) : EngineListener {
    private val _state = MutableStateFlow(PlayerUiState(title = request.summary.title, episode = request.episode))
    val state: StateFlow<PlayerUiState> = _state.asStateFlow()

    private val ref = request.summary.ref
    private val isSeries = request.episode != null || ref.mediaType == MediaType.SERIES

    private var selectionVersion = 0
    private var selectionJob: Job? = null
    private var searchJob: Job? = null
    private var tickJob: Job? = null
    private var autoNextJob: Job? = null

    private var picker: SourcePicker? = null
    private val pickerUpdates = MutableStateFlow(0)
    private var pickerEpisode: EpisodeKey? = null
    private var searchForced = false
    private val tried = mutableListOf<SourceOption>()

    private var episode: EpisodeKey? = request.episode
    private var option: SourceOption? = null
    private var stream: PlayableStream? = null
    private var voiceId: String? = null
    private var storedProvider: ProviderId? = null
    private var storedVoice: String? = null

    private var ladder: List<QualityStep> = emptyList()
    private var step = -1
    /** The viewer picked a quality: never stepped down automatically (risk N6). */
    private var qualityPinned = false
    private var expiredRetries = 0
    private var everReady = false
    private var started = false
    private var stopped = false
    private var writerVersion = 0
    /** Where the pending or failed selection starts; what a switch keeps before anything mounted. */
    private var resumeAtMs = 0L
    /** The stream's [PlayableStream.fallback] is playing (Collaps HLS after its DASH failed). */
    private var usingFallback = false
    private val stalls = StallWatch(elapsed)

    // Lifecycle

    fun onStart() {
        engine.listener = this
        tickJob = scope.launch {
            while (true) {
                delay(TICK_MS)
                tick()
            }
        }
        if (!started) {
            started = true
            launchSelection { v -> initial(v) }
        } else if (stopped) {
            // Back from the background: the decoder was released and the signed URL may have
            // expired, so resolve again and wait paused where the viewer left (risk M5).
            stopped = false
            val current = option
            if (current != null) {
                val at = writer.currentPositionMs
                launchSelection { v -> play(v, current, voiceId, at, SelectionReason.PROVIDER_SWITCH, playWhenReady = false) }
            }
        }
    }

    fun onStop() {
        stopped = true
        cancelAutoNext()
        writer.flush()
        tickJob?.cancel()
        stalls.stop()
        if (engine.listener === this) engine.listener = null
    }

    /** Leaving the screen: flush, stop every job. The writer's queue still drains. */
    fun close() {
        cancelAutoNext()
        selectionJob?.cancel()
        searchJob?.cancel()
        tickJob?.cancel()
        writer.close()
        engine.stop()
        if (engine.listener === this) engine.listener = null
    }

    // Viewer actions

    fun togglePause() {
        if (engine.playWhenReady) pause() else play()
    }

    fun play() {
        if (_state.value.ended) {
            engine.seekTo(0)
            _state.update { it.copy(ended = false) }
        }
        engine.play()
    }

    fun pause() {
        engine.pause()
        writer.flush(writerVersion)
    }

    fun seekBy(deltaMs: Long) {
        if (!engine.hasMedia) return
        val duration = engine.durationMs
        val target = (engine.positionMs + deltaMs).coerceAtLeast(0).let { if (duration > 0) it.coerceAtMost(duration - 1_000) else it }
        engine.seekTo(target)
        if (_state.value.ended && deltaMs < 0) _state.update { it.copy(ended = false) }
    }

    /** A jump chosen on the progress bar (the scrubber commits it once). */
    fun seekTo(positionMs: Long) {
        if (!engine.hasMedia) return
        val duration = engine.durationMs
        engine.seekTo(if (duration > 0) positionMs.coerceIn(0, duration - 1_000) else positionMs.coerceAtLeast(0))
        if (_state.value.ended) _state.update { it.copy(ended = false) }
    }

    fun selectEpisode(key: EpisodeKey, reason: SelectionReason = SelectionReason.EPISODE_PICK) {
        cancelAutoNext()
        writer.end()
        launchSelection { v -> openEpisode(v, key, reason) }
    }

    fun nextEpisode() {
        val next = _state.value.next ?: return
        selectEpisode(next, SelectionReason.NEXT_EPISODE)
    }

    fun selectSource(target: SourceOption) {
        if (picker?.isPlayable(target) == false) return
        switchTo(target, voiceId)
    }

    /**
     * Another voice. Where voices are audio tracks of one manifest (Collaps,
     * [PlayableStream.audioTrackIndex]) it is a track switch without a reload; otherwise the
     * source is resolved again for that voice at the same position.
     */
    fun selectVoice(id: String) {
        val opt = option ?: return
        if (id == voiceId) return
        val playing = stream
        if (playing?.audioTrackIndex == null) {
            switchTo(opt, id)
            return
        }
        cancelAutoNext()
        launchSelection { v ->
            val fresh = try {
                sources.resolve(opt, episode, id)
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                PlayerLog.w(TAG, "voice resolve failed: ${opt.providerId.key}")
                return@launchSelection
            }
            if (!current(v)) return@launchSelection
            val index = fresh.audioTrackIndex
            if (index == null || !sameManifest(fresh, playing)) {
                switchTo(opt, id)
                return@launchSelection
            }
            val at = positionToKeep()
            writer.end()
            voiceId = id
            stream = playing.copy(audioTrackIndex = index, voiceId = id)
            writerVersion = writer.begin(ProgressIdentity(ref, episode, opt.providerId, id), at, null)
            engine.selectAudioTrack(index)
            _state.update { it.copy(voiceId = id) }
            publishEpisode()
        }
    }

    private fun sameManifest(a: PlayableStream, b: PlayableStream): Boolean =
        a.url.substringBefore('?') == b.url.substringBefore('?') && a.format == b.format

    /** «Следующий источник» on the failure card. */
    fun tryOffered() {
        val offer = (_state.value.phase as? Phase.Failed)?.offer ?: return
        switchTo(offer, voiceId)
    }

    /** «Повторить» on the failure card: the same source again, resolved anew. */
    fun retry() {
        val current = option ?: return
        switchTo(current, voiceId)
    }

    fun selectSubtitle(url: String?) {
        engine.selectSubtitle(url)
        _state.update { it.copy(subtitleUrl = url) }
    }

    /** [index] into [PlayerUiState.qualities]; -1 is automatic. */
    fun selectQuality(index: Int) {
        if (ladder.isNotEmpty()) {
            if (index !in ladder.indices) return
            qualityPinned = true
            if (index == step) return
            step = index
            reloadAtCurrentPosition()
            _state.update { it.copy(qualityIndex = step) }
            return
        }
        val heights = engine.videoHeights()
        engine.selectHeight(heights.getOrNull(index))
        _state.update { it.copy(qualityIndex = if (index in heights.indices) index else -1) }
    }

    fun cancelAutoNext() {
        autoNextJob?.cancel()
        autoNextJob = null
        if (_state.value.autoNextIn != null) _state.update { it.copy(autoNextIn = null) }
    }

    /** Refreshes the watched marks and bars of the drawer. */
    fun refreshEpisodeProgress() {
        if (!isSeries) return
        scope.launch {
            val map = runCatching { progress.episodesOf(ref) }.getOrNull() ?: return@launch
            _state.update { it.copy(episodeProgress = map) }
        }
    }

    // Selection pipeline

    private fun launchSelection(block: suspend (Int) -> Unit) {
        val v = ++selectionVersion
        selectionJob?.cancel()
        selectionJob = scope.launch {
            try {
                block(v)
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                PlayerLog.w(TAG, "selection failed: ${e.javaClass.simpleName}")
                if (v == selectionVersion) _state.update { it.copy(phase = Phase.Failed(option?.providerId, null)) }
            }
        }
    }

    private fun current(v: Int) = v == selectionVersion

    private suspend fun initial(v: Int) {
        _state.update { it.copy(phase = Phase.Searching) }
        loadSeasonsInBackground()
        var key = request.episode
        var stored: PlaybackPosition? = null
        if (isSeries && key == null) {
            val latest = runCatching { progress.latestFor(ref) }.getOrNull()
            if (!current(v)) return
            key = latest?.episode ?: Selection.firstEpisode(awaitSeasons())
            if (!current(v)) return
            if (latest?.episode == key) stored = latest
        }
        if (stored == null) stored = runCatching { progress.get(ref, key) }.getOrNull()
        if (!current(v)) return
        storedProvider = ProviderId.fromKey(stored?.providerKey)
        storedVoice = stored?.voiceId
        episode = key
        val start = Selection.startPosition(request.reason, request.startPositionMs, stored)
        publishEpisode()
        val chosen = pickSource(v, key) ?: return
        val voice = SourcePicker.voiceFor(chosen, request.preferredVoiceId, storedVoice)
        play(v, chosen, voice, start, request.reason, playWhenReady = true, stored = stored)
    }

    private suspend fun openEpisode(v: Int, key: EpisodeKey, reason: SelectionReason) {
        _state.update { it.copy(phase = Phase.Loading, ended = false) }
        val stored = runCatching { progress.get(ref, key) }.getOrNull()
        if (!current(v)) return
        episode = key
        publishEpisode()
        val start = Selection.startPosition(reason, null, stored)
        val keep = option?.takeIf { opt -> opt.seasons.isEmpty() || opt.seasons.any { s -> s.episodes.any { it.key == key } } }
        val chosen = if (keep != null && pickerEpisode?.season == key.season) keep else {
            tried.clear()
            pickSource(v, key, preferred = option?.providerId) ?: return
        }
        val voice = SourcePicker.voiceFor(chosen, voiceId, storedVoice)
        play(v, chosen, voice, start, reason, playWhenReady = true, stored = stored)
    }

    /**
     * Switches source or voice on the same episode, keeping the position. [voice] is the wanted
     * one; a source without it gets the stored voice or its first one.
     */
    private fun switchTo(target: SourceOption, voice: String?) {
        cancelAutoNext()
        val at = positionToKeep()
        writer.end()
        launchSelection { v ->
            _state.update { it.copy(phase = Phase.Loading) }
            val resolvedVoice = SourcePicker.voiceFor(target, voice, storedVoice)
            play(v, target, resolvedVoice, at, SelectionReason.PROVIDER_SWITCH, playWhenReady = true)
        }
    }

    /** The position a switch keeps: the mounted selection's, else the one the pending selection starts at. */
    private fun positionToKeep(): Long = if (writer.identity != null) writer.currentPositionMs else resumeAtMs

    /** Runs a search for [key] when needed and waits for the best source. Null: no source (state set). */
    private suspend fun pickSource(v: Int, key: EpisodeKey?, preferred: ProviderId? = null): SourceOption? {
        _state.update { it.copy(phase = Phase.Searching) }
        if (picker == null || pickerEpisode != key) {
            // AnimeGo needs the per-season episode counts; the catalogue answers from its cache.
            val seasons = awaitSeasons()
            if (!current(v)) return null
            startSearch(key, preferred, seasons)
        }
        val p = picker ?: return null
        val chosen = withTimeoutOrNull(searchTimeoutMs) {
            pickerUpdates.first { p.next(tried, force = true) != null || p.exhausted(tried) }
            // The viewer's explicit choice is never passed over: wait for it to answer or fail.
            pickerUpdates.first { !p.waitingForPreferred() || p.exhausted(tried) }
            // Something playable is in. A better-ranked provider gets a short grace: one that cannot
            // serve this title may never answer before the resolver's Done.
            withTimeoutOrNull(BETTER_SOURCE_WAIT_MS) { pickerUpdates.first { p.next(tried) != null || p.exhausted(tried) } }
            p.next(tried) ?: p.next(tried, force = true)
        } ?: run {
            searchForced = true
            p.next(tried, force = true)
        }
        if (!current(v)) return null
        if (chosen == null) {
            // Nothing playable yet. If the search is still running, a later answer can still play.
            _state.update { it.copy(phase = Phase.NoSource) }
            if (!p.done) {
                pickerUpdates.first { p.next(tried, force = true) != null || p.exhausted(tried) }
                if (!current(v)) return null
                return p.next(tried, force = true)
            }
            return null
        }
        return chosen
    }

    private fun startSearch(key: EpisodeKey?, preferred: ProviderId?, seasons: List<SeasonInfo>) {
        searchJob?.cancel()
        val p = SourcePicker(preferred ?: request.preferredProvider, storedProvider, key)
        picker = p
        pickerEpisode = key
        searchForced = false
        val summary = request.summary.copy(genres = (request.summary.genres + catalogGenres).distinct())
        val query = SourceQuery.forTitle(summary, key, seasons)
        searchJob = scope.launch {
            sources.find(query)
                .catch { e -> if (e is CancellationException) throw e; PlayerLog.w(TAG, "find failed: ${e.javaClass.simpleName}") }
                .onCompletion { cause -> if (cause == null) p.onEvent(SourceEvent.Done) }
                .collect { event ->
                    p.onEvent(event)
                    _state.update { it.copy(options = p.options) }
                    pickerUpdates.value++
                }
            _state.update { it.copy(options = p.options) }
            pickerUpdates.value++
        }
    }

    /** Resolves [target] for the current episode and loads it at [startMs]. */
    private suspend fun play(
        v: Int,
        target: SourceOption,
        voice: String?,
        startMs: Long,
        reason: SelectionReason,
        playWhenReady: Boolean,
        stored: PlaybackPosition? = null,
    ) {
        if (target !in tried) tried += target
        resumeAtMs = startMs
        option = target
        voiceId = voice
        everReady = false
        expiredRetries = 0
        _state.update { it.copy(phase = Phase.Loading, option = target, voices = target.voices, voiceId = voice) }
        val resolved = try {
            sources.resolve(target, episode, voice)
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            if (!current(v)) return
            PlayerLog.w(TAG, "resolve failed: ${target.providerId.key}")
            sourceFailed(v, target, automatic = true, atMs = startMs)
            return
        }
        if (!current(v)) return
        val wanted = episode
        val otherEpisode = resolved.episode != null && resolved.episode != wanted
        // A provider that plays chosen episodes must confirm one: a stream without it is a film or
        // some other title (Collaps with a wrong Kinopoisk ID gave a film as С1·Е3).
        val unconfirmed = resolved.episode == null && target.providerId.supportsEpisodes
        if (wanted != null && (otherEpisode || unconfirmed)) {
            // Never play it under this episode's progress.
            PlayerLog.w(TAG, "${target.providerId.key} did not confirm the episode")
            sourceFailed(v, target, automatic = true, atMs = startMs)
            return
        }
        episode = Selection.canonicalEpisode(episode, resolved.episode)
        stream = resolved
        val newLadder = QualityLadder.of(resolved, target.quality)
        val keepPinned = qualityPinned && ladder.isNotEmpty() && newLadder.size == ladder.size
        ladder = newLadder
        step = if (keepPinned) step.coerceIn(0, newLadder.lastIndex) else QualityLadder.startIndex(newLadder).also { qualityPinned = false }
        if (ladder.isEmpty()) qualityPinned = false
        writerVersion = writer.begin(ProgressIdentity(ref, episode, target.providerId, voice), startMs, stored)
        publishEpisode()
        _state.update {
            it.copy(
                subtitles = resolved.subtitles,
                subtitleUrl = it.subtitleUrl?.takeIf { url -> resolved.subtitles.any { s -> s.url == url } },
                qualities = ladder.map { s -> s.option.label },
                qualityIndex = step,
                qualitiesAreStreams = ladder.isNotEmpty(),
                ended = false,
            )
        }
        usingFallback = false
        load(resolved, startMs, playWhenReady)
        _state.value.subtitleUrl?.let(engine::selectSubtitle)
        PlayerLog.i(TAG, "playing ${target.providerId.key} reason=$reason")
    }

    private fun load(s: PlayableStream, startMs: Long, playWhenReady: Boolean) {
        val fallback = s.fallback?.takeIf { usingFallback }
        val url = fallback?.url ?: ladder.getOrNull(step)?.url ?: s.url
        engine.load(s, url, fallback?.format ?: s.format, startMs, playWhenReady)
        engine.selectAudioTrack(s.audioTrackIndex)
        if (playWhenReady && ladder.isNotEmpty() && !qualityPinned) stalls.onLoad() else stalls.stop()
    }

    private fun reloadAtCurrentPosition() {
        val s = stream ?: return
        val at = engine.positionMs
        val wasPlaying = engine.playWhenReady
        load(s, at, wasPlaying)
    }

    /**
     * [target] cannot play. Before anything played, the next source is tried at once (part of
     * finding one); after playback had started, the next source is offered instead.
     */
    private suspend fun sourceFailed(v: Int, target: SourceOption, automatic: Boolean, atMs: Long) {
        val p = picker
        val nextOption = p?.next(tried, force = true)
        if (automatic && nextOption != null) {
            writer.end()
            val voice = SourcePicker.voiceFor(nextOption, voiceId, storedVoice)
            play(v, nextOption, voice, atMs, SelectionReason.PROVIDER_SWITCH, playWhenReady = true)
            return
        }
        resumeAtMs = atMs
        stream = null
        engine.stop()
        stalls.stop()
        _state.update {
            it.copy(phase = if (nextOption == null && p?.exhausted(tried) == true && !everReady) Phase.NoSource else Phase.Failed(target.providerId, nextOption))
        }
    }

    // Engine events

    override fun onReady() {
        everReady = true
        if (_state.value.phase != Phase.Playing) _state.update { it.copy(phase = Phase.Playing) }
        if (ladder.isEmpty()) {
            val heights = engine.videoHeights()
            _state.update { st ->
                st.copy(qualities = heights.map { h -> "${h}p" }, qualitiesAreStreams = false, qualityIndex = st.qualityIndex.takeIf { it < heights.size } ?: -1)
            }
        }
    }

    override fun onTracksChanged() {
        if (ladder.isEmpty() && everReady) onReady()
    }

    override fun onPlayingChanged(playing: Boolean) {
        if (playing) {
            stalls.onPlaying()
        } else if (!engine.playWhenReady) {
            stalls.onPauseOrSeek()
            writer.flush(writerVersion)
        }
    }

    override fun onBuffering() {
        stalls.onBuffering()
    }

    override fun onSeek() {
        stalls.onPauseOrSeek()
    }

    override fun onCues(lines: List<String>) {
        _state.update { it.copy(cues = lines) }
    }

    override fun onEnded() {
        writer.ended(writerVersion)
        stalls.stop()
        _state.update { it.copy(ended = true) }
        val provider = option?.providerId ?: return
        val next = episode?.let { Selection.nextEpisode(_state.value.seasons, it) } ?: return
        // Auto-next needs a provider with direct episodes and a real `ended`, and a known next episode.
        if (!provider.supportsAutoNext || !next.known || stopped) return
        autoNextJob?.cancel()
        autoNextJob = scope.launch {
            for (left in AUTO_NEXT_SECONDS downTo 1) {
                _state.update { it.copy(autoNextIn = left) }
                delay(1_000)
            }
            _state.update { it.copy(autoNextIn = null) }
            autoNextJob = null
            selectEpisode(next.key, SelectionReason.NEXT_EPISODE)
        }
    }

    override fun onError(error: EngineError) {
        val target = option ?: return
        val v = selectionVersion
        val s = stream
        if (!error.expired && s?.fallback != null && !usingFallback) {
            // Collaps: the DASH (VP9/AV1) did not start or broke; its HLS twin at the same position.
            usingFallback = true
            val at = maxOf(positionToKeep(), engine.positionMs)
            PlayerLog.i(TAG, "${error.code} on ${s.format}, trying the ${s.fallback?.format} fallback")
            load(s, at, playWhenReady = true)
            return
        }
        if (error.expired && expiredRetries < MAX_EXPIRED_RETRIES) {
            expiredRetries++
            val at = maxOf(positionToKeep(), engine.positionMs)
            PlayerLog.i(TAG, "stream expired (${error.httpCode}), resolving again ($expiredRetries)")
            val retries = expiredRetries
            launchSelection { nv ->
                val fresh = try {
                    sources.resolve(target, episode, voiceId, fresh = true)
                } catch (e: CancellationException) {
                    throw e
                } catch (e: Exception) {
                    if (current(nv)) sourceFailed(nv, target, automatic = true, atMs = at)
                    return@launchSelection
                }
                if (!current(nv)) return@launchSelection
                stream = fresh
                expiredRetries = retries
                load(fresh, at, playWhenReady = true)
            }
            return
        }
        val at = maxOf(positionToKeep(), engine.positionMs)
        // Expired twice: the next source at the same position (N5). Other errors before the first
        // frame: the next source too. After playback had started: offer it.
        val automatic = error.expired || !everReady
        writer.end()
        launchSelection { nv -> sourceFailed(nv, target, automatic, at) }
        if (v != selectionVersion) PlayerLog.i(TAG, "error during selection ${error.code}")
    }

    // Ticks

    private fun tick() {
        if (!engine.hasMedia) return
        writer.report(writerVersion, engine.positionMs, engine.durationMs, engine.isPlaying)
        if (step >= 0 && !qualityPinned && stalls.check() && step < ladder.lastIndex) {
            step++
            PlayerLog.i(TAG, "stepping down to ${ladder[step].option.label}")
            reloadAtCurrentPosition()
            _state.update { it.copy(qualityIndex = step) }
        }
    }

    // Seasons and labels

    private val seasonsReady = MutableStateFlow<List<SeasonInfo>?>(null)

    /** Genres the catalogue knows for the title; the request's summary may carry none (anime flag). */
    private var catalogGenres: List<String> = emptyList()

    private fun loadSeasonsInBackground() {
        scope.launch {
            // The catalogue answers from its cache (Details just read it): seasons for series, genres for all.
            val details = runCatching { catalog?.details(ref) }.getOrNull()
            catalogGenres = details?.summary?.genres.orEmpty()
            val fromCatalog = if (isSeries) details?.seasons.orEmpty() else emptyList()
            seasonsReady.value = fromCatalog
            if (_state.value.seasons.isEmpty()) _state.update { it.copy(seasons = fromCatalog) }
            publishEpisode()
        }
        refreshEpisodeProgress()
    }

    private suspend fun awaitSeasons(): List<SeasonInfo> =
        withTimeoutOrNull(SEASONS_TIMEOUT_MS) { seasonsReady.first { it != null } }.orEmpty()

    private fun publishEpisode() {
        val fromOption = option?.seasons.orEmpty()
        val seasons = fromOption.ifEmpty { seasonsReady.value.orEmpty() }
        val key = episode
        val info = key?.let { k -> seasons.firstOrNull { it.number == k.season }?.episodes?.firstOrNull { it.key == k } }
        _state.update {
            it.copy(
                episode = key,
                episodeTitle = info?.title?.takeUnless { title -> title.startsWith("Серия ") },
                seasons = seasons.ifEmpty { it.seasons },
                next = key?.let { k -> Selection.nextEpisode(seasons, k)?.key }?.takeIf { option?.providerId?.supportsEpisodes != false },
            )
        }
    }

    companion object {
        const val TICK_MS = 1_000L
        const val SEARCH_TIMEOUT_MS = 12_000L
        const val SEASONS_TIMEOUT_MS = 5_000L
        /** How long a found source waits for a better-ranked provider still out. */
        const val BETTER_SOURCE_WAIT_MS = 3_000L
        const val MAX_EXPIRED_RETRIES = 2
        const val AUTO_NEXT_SECONDS = 10
        val SEEK_STEP_MS = PlayerBudget.SEEK_STEP_MS
    }
}
