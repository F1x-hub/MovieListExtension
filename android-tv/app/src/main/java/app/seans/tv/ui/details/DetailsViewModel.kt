package app.seans.tv.ui.details

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import app.seans.tv.model.AppGraph
import app.seans.tv.model.AuthState
import app.seans.tv.model.BookmarkStatus
import app.seans.tv.model.EpisodeKey
import app.seans.tv.model.PlaybackPosition
import app.seans.tv.model.PlaybackRequest
import app.seans.tv.model.ProviderId
import app.seans.tv.model.SeasonInfo
import app.seans.tv.model.SelectionReason
import app.seans.tv.model.SourceEvent
import app.seans.tv.model.SourceKind
import app.seans.tv.model.SourceOption
import app.seans.tv.model.SourceQuery
import app.seans.tv.model.TitleDetails
import app.seans.tv.model.TitleRef
import app.seans.tv.model.TitleSummary
import app.seans.tv.ui.common.bookmarkToast
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

sealed interface DetailsLoad {
    data object Loading : DetailsLoad
    data class Ready(val details: TitleDetails) : DetailsLoad
    data object Failed : DetailsLoad
}

/** The «Источник» panel: what each provider answered, in arrival order. */
data class SourcesState(
    val options: List<SourceOption> = emptyList(),
    val failed: List<ProviderId> = emptyList(),
    val done: Boolean = false,
)

/** Where the viewer's progress stands for this title (TV-local, see `ProgressRepository`). */
data class ProgressState(
    val latest: PlaybackPosition? = null,
    val episodes: Map<EpisodeKey, PlaybackPosition> = emptyMap(),
    /** False until the first read answered; the sources wait for it to know the episode. */
    val loaded: Boolean = false,
)

/**
 * Details reads the catalogue once when the screen opens (never on focus). The sources are asked
 * for the episode the screen is about (the main button's, or the selected season's landing
 * episode): availability is per episode, and providers cache their offers per episode.
 * Progress is re-read each time the screen comes back (after the player).
 */
class DetailsViewModel(private val graph: AppGraph, val ref: TitleRef) : ViewModel() {
    private val _load = MutableStateFlow<DetailsLoad>(DetailsLoad.Loading)
    val load: StateFlow<DetailsLoad> = _load.asStateFlow()

    private val _progress = MutableStateFlow(ProgressState())
    val progress: StateFlow<ProgressState> = _progress.asStateFlow()

    private val _sources = MutableStateFlow(SourcesState())
    val sources: StateFlow<SourcesState> = _sources.asStateFlow()

    private val _bookmark = MutableStateFlow<BookmarkStatus?>(null)
    val bookmark: StateFlow<BookmarkStatus?> = _bookmark.asStateFlow()

    /**
     * The viewer's explicit choice in the panel; null means no choice (the panel then shows the
     * first playable source, and the player picks its own).
     */
    private val _provider = MutableStateFlow<ProviderId?>(null)
    val provider: StateFlow<ProviderId?> = _provider.asStateFlow()
    private val _voice = MutableStateFlow<String?>(null)
    val voice: StateFlow<String?> = _voice.asStateFlow()

    private val _season = MutableStateFlow<Int?>(null)
    val season: StateFlow<Int?> = _season.asStateFlow()

    val signedIn: Boolean get() = graph.auth.state.value is AuthState.SignedIn

    /** Focus memory for coming back from the player: a key like `main`, `tab:2`, `ep:2:5`. */
    var lastFocus: String? = null

    private var sourcesJob: Job? = null
    /** The episode the current [sources] answer is for; [NOT_ASKED] before the first query. */
    private var sourcesEpisode: Any? = NOT_ASKED

    /** Seasons a source listed, kept across per-episode queries so the season row never blinks out. */
    private val _sourceSeasons = MutableStateFlow<List<SeasonInfo>>(emptyList())
    val sourceSeasons: StateFlow<List<SeasonInfo>> = _sourceSeasons.asStateFlow()

    init {
        loadDetails()
    }

    fun loadDetails() {
        _load.value = DetailsLoad.Loading
        viewModelScope.launch {
            val result = runCatching { graph.catalog.details(ref) }
            _load.value = result.fold({ DetailsLoad.Ready(it) }, { DetailsLoad.Failed })
            result.getOrNull()?.let { d ->
                if (d.bookmark != null) {
                    _bookmark.value = d.bookmark
                    bookmarkKnown = true
                } else if (signedIn) {
                    currentBookmark()
                }
                refreshProgress()
            }
        }
    }

    fun refreshProgress() {
        viewModelScope.launch {
            val latest = runCatching { graph.progress.latestFor(ref) }.getOrNull()
            val episodes = runCatching { graph.progress.episodesOf(ref) }.getOrDefault(emptyMap())
            _progress.value = ProgressState(latest, episodes, loaded = true)
            if (_season.value == null) latest?.episode?.let { _season.value = it.season }
        }
    }

    /**
     * Asks the sources for [episode] (null for films) unless the current answer is already for it.
     * [force] asks again (the panel's «поискать снова»).
     */
    fun findSources(episode: EpisodeKey?, force: Boolean = false) {
        val d = (load.value as? DetailsLoad.Ready)?.details ?: return
        if (!force && sourcesEpisode == episode) return
        sourcesEpisode = episode
        sourcesJob?.cancel()
        _sources.value = SourcesState()
        sourcesJob = viewModelScope.launch {
            runCatching {
                graph.sources.find(SourceQuery.forTitle(d.summary, episode, d.seasons))
                    .collect { e ->
                        when (e) {
                            is SourceEvent.Found -> {
                                _sources.update { it.copy(options = it.options + e.option) }
                                if (_sourceSeasons.value.isEmpty() && e.option.seasons.isNotEmpty()) _sourceSeasons.value = e.option.seasons
                            }
                            is SourceEvent.Failed -> _sources.update { it.copy(failed = it.failed + e.providerId) }
                            SourceEvent.Done -> _sources.update { it.copy(done = true) }
                        }
                    }
            }
            _sources.update { it.copy(done = true) }
        }
    }

    fun selectProvider(id: ProviderId) {
        _provider.value = id
        _voice.value = null
    }

    /** Picking a voice picks its source too: the voice belongs to that source's list. */
    fun selectVoice(providerId: ProviderId, id: String) {
        _provider.value = providerId
        _voice.value = id
    }

    fun selectSeason(number: Int) { _season.value = number }

    /** The option the main button plays: the viewer's pick, else the first playable one. */
    fun currentOption(state: SourcesState = sources.value, chosen: ProviderId? = provider.value): SourceOption? {
        val playable = state.options.filter { it.isPlayable() }
        return playable.firstOrNull { it.providerId == chosen } ?: playable.firstOrNull()
    }

    fun retrySources() {
        val episode = sourcesEpisode
        if (episode !== NOT_ASKED) findSources(episode as EpisodeKey?, force = true)
    }

    fun seasonsOf(details: TitleDetails, fromSources: List<SeasonInfo> = sourceSeasons.value): List<SeasonInfo> =
        details.seasons.ifEmpty { fromSources }

    /** The request carries only what the viewer explicitly picked; see [playbackRequestFor]. */
    fun request(details: TitleDetails, episode: EpisodeKey?, reason: SelectionReason): PlaybackRequest =
        playbackRequestFor(details.summary, episode, reason, provider.value, voice.value)

    /** True once the bookmark status was read; until then a click reads it first. */
    private var bookmarkKnown = false

    /** The bookmark status, read again if the first read failed: a click never overwrites an unseen status. */
    suspend fun currentBookmark(): Result<BookmarkStatus?> {
        if (bookmarkKnown) return Result.success(_bookmark.value)
        return runCatching { graph.library.bookmarkStatus(ref) }
            .onSuccess { s -> _bookmark.value = s; bookmarkKnown = true }
    }

    /** Writes [status] (null removes the bookmark) and returns the toast text. */
    suspend fun setBookmark(details: TitleDetails, status: BookmarkStatus?): String =
        runCatching { graph.library.setBookmarkStatus(details.summary, status) }.fold(
            { _bookmark.value = status; bookmarkKnown = true; bookmarkToast(status) },
            { "Не удалось сохранить закладку" },
        )
}

private val NOT_ASKED = Any()

/**
 * `PlaybackRequest.preferredProvider`/`preferredVoiceId` are set only when the viewer explicitly
 * picked a source (or a voice of it) in the «Источник» panel, never from the panel's default: the
 * player gives an explicit pick priority over its own ranking.
 */
fun playbackRequestFor(
    summary: TitleSummary,
    episode: EpisodeKey?,
    reason: SelectionReason,
    pickedProvider: ProviderId?,
    pickedVoice: String?,
): PlaybackRequest = PlaybackRequest(
    summary = summary,
    episode = episode,
    reason = reason,
    preferredProvider = pickedProvider,
    preferredVoiceId = if (pickedProvider != null) pickedVoice else null,
)

fun SourceOption.isPlayable(): Boolean = kind == SourceKind.DIRECT && unavailableReason == null
