package app.seans.tv.ui.details

import androidx.compose.foundation.background
import androidx.compose.foundation.focusGroup
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.derivedStateOf
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.runtime.withFrameNanos
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.focus.focusRestorer
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.layout.onPlaced
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.layout.positionInParent
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import app.seans.tv.designsystem.EpisodeCard
import app.seans.tv.designsystem.FadedArt
import app.seans.tv.designsystem.ImageSizes
import app.seans.tv.designsystem.NoAutoScroll
import app.seans.tv.designsystem.PanelList
import app.seans.tv.designsystem.PanelOption
import app.seans.tv.designsystem.PanelTitle
import app.seans.tv.designsystem.PinToStart
import app.seans.tv.designsystem.RatingBadges
import app.seans.tv.designsystem.SText
import app.seans.tv.designsystem.SeansButton
import app.seans.tv.designsystem.SeansColors
import app.seans.tv.designsystem.SeansIcons
import app.seans.tv.designsystem.SeansSpace
import app.seans.tv.designsystem.SeansText
import app.seans.tv.designsystem.SeansValueButton
import app.seans.tv.designsystem.SeasonTab
import app.seans.tv.designsystem.SidePanel
import app.seans.tv.designsystem.ToastHost
import app.seans.tv.designsystem.cropAlignment
import app.seans.tv.designsystem.rememberToastState
import app.seans.tv.designsystem.tryRequestFocus
import app.seans.tv.model.AppGraph
import app.seans.tv.model.EpisodeInfo
import app.seans.tv.model.EpisodeKey
import app.seans.tv.model.MediaType
import app.seans.tv.model.PlaybackRequest
import app.seans.tv.model.ProviderId
import app.seans.tv.model.SeasonInfo
import app.seans.tv.model.SelectionReason
import app.seans.tv.model.SourceKind
import app.seans.tv.model.TitleDetails
import app.seans.tv.model.TitleRef
import app.seans.tv.ui.common.BookmarkButton
import app.seans.tv.ui.common.BookmarkClick
import app.seans.tv.ui.common.BookmarkPanel
import app.seans.tv.ui.common.Format
import app.seans.tv.ui.common.bookmarkClick
import app.seans.tv.ui.common.RowFocus
import app.seans.tv.ui.common.StateMessage
import app.seans.tv.ui.common.TvRow
import kotlinx.coroutines.launch

/** Distance kept below the episodes row when it is focused (the mockup's `bottom - 540 + 40`). */
private val EpisodesBottomGap = 40.dp

/**
 * A film or a series: title, ratings, the main button («С2 · Е5 с 14:20»), «Источник», the
 * bookmark, and for series the season tabs and the episode row. The catalogue is read once when
 * the screen opens; focus never triggers a request.
 */
@Composable
fun DetailsScreen(
    ref: TitleRef,
    graph: AppGraph,
    onPlay: (PlaybackRequest) -> Unit,
) {
    val vm: DetailsViewModel = viewModel { DetailsViewModel(graph, ref) }
    val load by vm.load.collectAsStateWithLifecycle()
    // Coming back from the player: progress may have moved.
    LaunchedEffect(Unit) { vm.refreshProgress() }

    Box(Modifier.fillMaxSize()) {
        when (val state = load) {
            DetailsLoad.Loading -> SText("Загрузка…", SeansText.Subtitle, Modifier.padding(start = SeansSpace.SafeX, top = 60.dp))
            DetailsLoad.Failed -> {
                val retry = remember { FocusRequester() }
                LaunchedEffect(Unit) { withFrameNanos { }; retry.tryRequestFocus() }
                StateMessage(
                    "Не удалось загрузить страницу. Проверьте интернет.",
                    Modifier.padding(start = SeansSpace.SafeX, top = 60.dp),
                ) { SeansButton("Повторить", vm::loadDetails, Modifier.focusRequester(retry), primary = true) }
            }
            is DetailsLoad.Ready -> DetailsContent(vm, state.details, onPlay)
        }
    }
}

@Composable
private fun DetailsContent(vm: DetailsViewModel, details: TitleDetails, onPlay: (PlaybackRequest) -> Unit) {
    val progress by vm.progress.collectAsStateWithLifecycle()
    val sources by vm.sources.collectAsStateWithLifecycle()
    val bookmark by vm.bookmark.collectAsStateWithLifecycle()
    val chosenProvider by vm.provider.collectAsStateWithLifecycle()
    val chosenVoice by vm.voice.collectAsStateWithLifecycle()
    val seasonState by vm.season.collectAsStateWithLifecycle()

    val s = details.summary
    val isSeries = s.ref.mediaType == MediaType.SERIES
    val sourceSeasons by vm.sourceSeasons.collectAsStateWithLifecycle()
    val seasons = vm.seasonsOf(details, sourceSeasons)
    val season: SeasonInfo? = seasons.firstOrNull { it.number == seasonState } ?: firstWatchableSeason(seasons)
    val option = vm.currentOption(sources, chosenProvider)

    val scope = rememberCoroutineScope()
    val toast = rememberToastState()
    val density = LocalDensity.current
    val scroll = rememberScrollState()
    var viewportH by remember { mutableIntStateOf(0) }
    var episodesBottom by remember { mutableIntStateOf(0) }

    val mainFocus = remember { FocusRequester() }
    val sourceFocus = remember { FocusRequester() }
    val bookmarkFocus = remember { FocusRequester() }
    val tabsFocus = remember { RowFocus() }
    val episodesFocus = remember { RowFocus() }
    var panelOpen by remember { mutableStateOf(false) }
    var bookmarkPanelOpen by remember { mutableStateOf(false) }

    // The episode the row lands on: the one being watched, else the first unwatched.
    val landing: EpisodeKey? = season?.let { landingEpisode(it, progress) }
    val main = mainAction(details, seasons, progress)

    // The episode the «Источник» panel speaks for: the main button's, or — when another season is
    // selected — that season's landing episode. A source without S5E2 may still have S3E1.
    val sourceEpisode: EpisodeKey? = when {
        !isSeries -> null
        season != null && main.episode?.season != season.number -> landing
        else -> main.episode
    }
    LaunchedEffect(sourceEpisode, progress.loaded) {
        if (!isSeries || progress.loaded) vm.findSources(sourceEpisode)
    }

    // Initial focus, or the control left last when coming back from the player.
    LaunchedEffect(Unit) {
        withFrameNanos { }
        val last = vm.lastFocus
        val restored = when {
            last == null || last == "main" -> false
            last == "source" -> sourceFocus.tryRequestFocus()
            last == "bookmark" -> bookmarkFocus.tryRequestFocus()
            last.startsWith("tab:") -> tabsFocus.request(last.removePrefix("tab:").toIntOrNull())
            last.startsWith("ep:") -> episodesFocus.request(last)
            else -> false
        }
        if (!restored) mainFocus.tryRequestFocus()
    }

    // Instant, not animated (the TV responds faster than it can animate).
    fun scrollTop() = scope.launch { scroll.scrollTo(0) }
    fun scrollToEpisodes() = scope.launch {
        val gap = with(density) { EpisodesBottomGap.roundToPx() }
        scroll.scrollTo((episodesBottom - viewportH + gap).coerceAtLeast(0))
    }

    Box(Modifier.fillMaxSize()) {
        FadedArt(
            url = s.backdropUrl ?: s.posterUrl,
            widthPx = ImageSizes.BACKDROP_W,
            heightPx = ImageSizes.BACKDROP_H,
            modifier = Modifier.align(Alignment.TopEnd).size(620.dp, 420.dp),
            alignment = cropAlignment(0.3f),
            // A longer fade stands in for the mockup's separate text shade (one GPU layer less).
            fadeInX = 0.6f,
            fadeBottomFrom = 0.22f,
            fadeBottomTo = 0.62f,
        )

        NoAutoScroll {
            Column(
                Modifier
                    .fillMaxSize()
                    .onSizeChanged { viewportH = it.height }
                    .verticalScroll(scroll),
            ) {
                // Head: title, meta, ratings, text, actions.
                Column(
                    Modifier
                        .padding(start = SeansSpace.SafeX, top = 40.dp)
                        .width(560.dp)
                        .heightIn(min = 312.dp - 40.dp),
                ) {
                    SText(s.title, SeansText.Title, maxLines = 2)
                    val orig = listOfNotNull(s.originalTitle?.takeIf { it != s.title }, s.year?.toString())
                    if (orig.isNotEmpty()) SText(orig.joinToString(" · "), SeansText.Subtitle, Modifier.padding(top = 4.dp), maxLines = 1)
                    val meta = listOfNotNull(
                        details.countries.take(2).takeIf { it.isNotEmpty() }?.joinToString(", "),
                        s.genres.take(3).takeIf { it.isNotEmpty() }?.joinToString(", "),
                        if (isSeries) seasons.count { it.number > 0 }.takeIf { it > 0 }?.let { Format.seasons(it) }
                        else details.durationMinutes?.let { Format.duration(it) },
                        details.ageRating,
                    )
                    if (meta.isNotEmpty()) SText(meta.joinToString(" · "), SeansText.Meta, Modifier.padding(top = 6.dp), maxLines = 1)
                    RatingBadges(s.ratings.kinopoisk, s.ratings.imdb, s.ratings.mine, s.ratings.community, Modifier.padding(top = 10.dp))
                    details.description?.let {
                        SText(it, SeansText.Description, Modifier.padding(top = 12.dp).width(480.dp), maxLines = 2)
                    }
                    Row(
                        Modifier
                            .padding(top = 18.dp)
                            .onFocusChanged { if (it.hasFocus) scrollTop() }
                            .focusGroup(),
                        horizontalArrangement = Arrangement.spacedBy(10.dp),
                    ) {
                        SeansButton(
                            text = main.label,
                            onClick = { onPlay(vm.request(details, main.episode, main.reason)) },
                            modifier = Modifier.focusRequester(mainFocus).onFocusChanged { if (it.isFocused) vm.lastFocus = "main" },
                            icon = SeansIcons.Play,
                            primary = true,
                            progress = main.progress,
                        )
                        SeansValueButton(
                            label = "Источник",
                            value = sourceValue(option, sources),
                            onClick = { panelOpen = true },
                            modifier = Modifier.focusRequester(sourceFocus).onFocusChanged { if (it.isFocused) vm.lastFocus = "source" },
                        )
                        if (vm.signedIn) {
                            BookmarkButton(
                                status = bookmark,
                                onClick = {
                                    scope.launch {
                                        vm.currentBookmark().fold(
                                            { current ->
                                                when (val click = bookmarkClick(current)) {
                                                    is BookmarkClick.Set -> toast.show(vm.setBookmark(details, click.status))
                                                    BookmarkClick.Choose -> bookmarkPanelOpen = true
                                                }
                                            },
                                            { toast.show("Не удалось проверить закладку") },
                                        )
                                    }
                                },
                                modifier = Modifier.focusRequester(bookmarkFocus).onFocusChanged { if (it.isFocused) vm.lastFocus = "bookmark" },
                            )
                        }
                    }
                }

                if (isSeries && season != null) {
                    // Season tabs. Entering them lands on the current season's tab.
                    val tabsState = rememberLazyListState()
                    val currentTab = remember { FocusRequester() }
                    val currentTabVisible by remember(season.number) {
                        derivedStateOf { tabsState.layoutInfo.visibleItemsInfo.any { it.key == season.number } }
                    }
                    PinToStart(0.dp) {
                        LazyRow(
                            state = tabsState,
                            modifier = Modifier
                                .padding(top = 8.dp, bottom = 22.dp - 6.dp)
                                .onFocusChanged { if (it.hasFocus) scrollTop() }
                                .focusRestorer(if (currentTabVisible) currentTab else FocusRequester.Default),
                            contentPadding = PaddingValues(start = SeansSpace.SafeX, end = SeansSpace.SafeX, top = 4.dp, bottom = 6.dp),
                            horizontalArrangement = Arrangement.spacedBy(8.dp),
                        ) {
                            items(seasons, key = { it.number }) { info ->
                                val requester = remember { FocusRequester() }
                                DisposableEffect(info.number) {
                                    tabsFocus.register(info.number, requester)
                                    onDispose { tabsFocus.unregister(info.number, requester) }
                                }
                                SeasonTab(
                                    text = if (info.number == 0) "Спецвыпуски" else "Сезон ${info.number}",
                                    current = info.number == season.number,
                                    onClick = { vm.selectSeason(info.number) },
                                    modifier = Modifier
                                        .then(if (info.number == season.number) Modifier.focusRequester(currentTab) else Modifier)
                                        .focusRequester(requester)
                                        .onFocusChanged { if (it.isFocused) vm.lastFocus = "tab:${info.number}" },
                                )
                            }
                        }
                    }

                    // Episodes of the selected season. A new season gets a fresh row (scroll and
                    // focus memory), starting with its landing episode pinned at the start.
                    key(season.number) {
                        val landingIndex = season.episodes.indexOfFirst { it.key == landing }.coerceAtLeast(0)
                        val episodesState = rememberLazyListState(initialFirstVisibleItemIndex = landingIndex)
                        LaunchedEffect(landingIndex) {
                            // Progress can arrive after the row; follow it unless the viewer is in the row.
                            if (vm.lastFocus?.startsWith("ep:") != true) episodesState.scrollToItem(landingIndex)
                        }
                        TvRow(
                            title = null,
                            items = season.episodes,
                            key = { "ep:${it.key.season}:${it.key.episode}" },
                            state = episodesState,
                            focus = episodesFocus,
                            landingKey = landing?.let { "ep:${it.season}:${it.episode}" },
                            onItemFocused = { k -> vm.lastFocus = k as String; scrollToEpisodes() },
                            modifier = Modifier.onPlaced { episodesBottom = (it.positionInParent().y + it.size.height).toInt() },
                            start = SeansSpace.SafeX,
                        ) { episode, m ->
                            EpisodeItem(episode, details, progress, m, onClick = {
                                onPlay(vm.request(details, episode.key, SelectionReason.EPISODE_PICK))
                            })
                        }
                    }
                }
            }
        }

        SourcePanel(
            visible = panelOpen,
            sources = sources,
            current = option?.providerId,
            chosenVoice = chosenVoice,
            onPickSource = { id ->
                vm.selectProvider(id)
                toast.show("Источник: ${id.label}")
            },
            onPickVoice = { providerId, id, name ->
                vm.selectVoice(providerId, id)
                toast.show("Озвучка: $name")
            },
            onRetry = vm::retrySources,
            onDismiss = {
                panelOpen = false
                scope.launch { withFrameNanos { }; sourceFocus.tryRequestFocus() }
            },
        )
        BookmarkPanel(
            visible = bookmarkPanelOpen,
            current = bookmark,
            onPick = { status ->
                bookmarkPanelOpen = false
                scope.launch {
                    toast.show(vm.setBookmark(details, status))
                    withFrameNanos { }
                    bookmarkFocus.tryRequestFocus()
                }
            },
            onDismiss = {
                bookmarkPanelOpen = false
                scope.launch { withFrameNanos { }; bookmarkFocus.tryRequestFocus() }
            },
        )
        ToastHost(toast)
    }
}

private data class MainAction(val label: String, val episode: EpisodeKey?, val reason: SelectionReason, val progress: Float?)

/** «Смотреть с 1:12:40», «С2 · Е5 с 14:20», «Смотреть С2 · Е6» or «Смотреть». */
private fun mainAction(details: TitleDetails, seasons: List<SeasonInfo>, progress: ProgressState): MainAction {
    val latest = progress.latest
    if (details.summary.ref.mediaType != MediaType.SERIES) {
        return if (latest != null && !latest.completed && latest.positionMs > 0) {
            MainAction("Смотреть с ${Format.position(latest.positionMs)}", null, SelectionReason.RESUME, latest.fraction)
        } else {
            MainAction("Смотреть", null, SelectionReason.RESUME, null)
        }
    }
    val episode = latest?.episode
    if (latest != null && episode != null) {
        if (!latest.completed) {
            return MainAction("${episode.shortLabel()} с ${Format.position(latest.positionMs)}", episode, SelectionReason.RESUME, latest.fraction)
        }
        val next = seasons.filter { it.number >= episode.season }.flatMap { it.episodes }.map { it.key }.sorted().firstOrNull { it > episode }
        return if (next != null) MainAction("Смотреть ${next.shortLabel()}", next, SelectionReason.EPISODE_PICK, null)
        else MainAction("Смотреть ${episode.shortLabel()}", episode, SelectionReason.EPISODE_PICK, null)
    }
    val first = firstWatchableSeason(seasons)?.episodes?.firstOrNull()?.key ?: EpisodeKey(1, 1)
    return MainAction("Смотреть ${first.shortLabel()}", first, SelectionReason.EPISODE_PICK, null)
}

/** Season 1 and on come first; specials (season 0) only when nothing else exists. */
private fun firstWatchableSeason(seasons: List<SeasonInfo>): SeasonInfo? =
    seasons.filter { it.number > 0 && it.episodes.isNotEmpty() }.minByOrNull { it.number }
        ?: seasons.firstOrNull { it.episodes.isNotEmpty() }

private fun landingEpisode(season: SeasonInfo, progress: ProgressState): EpisodeKey? {
    val latest = progress.latest?.episode
    if (latest != null && latest.season == season.number && progress.latest?.completed == false) return latest
    return season.episodes.firstOrNull { progress.episodes[it.key]?.completed != true }?.key ?: season.episodes.firstOrNull()?.key
}

private fun sourceValue(option: app.seans.tv.model.SourceOption?, state: SourcesState): String = when {
    option != null -> listOfNotNull(option.providerId.label, option.quality).joinToString(" · ")
    !state.done -> "Ищем…"
    else -> "Нет источника"
}

@Composable
private fun EpisodeItem(
    episode: EpisodeInfo,
    details: TitleDetails,
    progress: ProgressState,
    modifier: Modifier,
    onClick: () -> Unit,
) {
    val pos = progress.episodes[episode.key]
    val watched = pos?.completed == true
    val unfinished = pos != null && !pos.completed && pos.positionMs > 0
    val subtitle = when {
        unfinished -> Format.remaining(pos!!.remainingMs)
        episode.durationSec != null && episode.durationSec!! > 0 -> Format.duration(episode.durationSec!! / 60)
        else -> ""
    }
    val k = episode.key
    EpisodeCard(
        number = "Е${k.episode}",
        title = episode.title?.takeIf { it.isNotBlank() } ?: "Серия ${k.episode}",
        subtitle = subtitle,
        imageUrl = episode.stillUrl ?: details.summary.backdropUrl ?: details.summary.posterUrl,
        watched = watched,
        progress = if (unfinished) pos!!.fraction else null,
        onClick = onClick,
        modifier = modifier,
        // Without a still, the shared picture is cropped differently per episode, as in the mockup.
        imageAlignmentY = if (episode.stillUrl != null) 0.5f else ((k.episode * 23 + k.season * 11) % 100) / 100f,
    )
}

@Composable
private fun androidx.compose.foundation.layout.BoxScope.SourcePanel(
    visible: Boolean,
    sources: SourcesState,
    current: ProviderId?,
    chosenVoice: String?,
    onPickSource: (ProviderId) -> Unit,
    onPickVoice: (ProviderId, String, String) -> Unit,
    onRetry: () -> Unit,
    onDismiss: () -> Unit,
) {
    val initial = remember { FocusRequester() }
    SidePanel(visible = visible, onDismiss = onDismiss, initialFocus = initial) {
        PanelTitle("Источник")
        PanelList {
            var initialUsed = false
            fun Modifier.initialIf(cond: Boolean): Modifier =
                if (cond && !initialUsed) { initialUsed = true; this.focusRequester(initial) } else this
            sources.options.forEach { opt ->
                val playable = opt.isPlayable()
                val subtitle = listOfNotNull(
                    opt.quality,
                    opt.voices.size.takeIf { it > 0 }?.let { Format.voices(it) },
                    if (opt.kind == SourceKind.WEB) "через веб-плеер — пока не поддерживается" else null,
                    opt.unavailableReason,
                ).joinToString(" · ").ifEmpty { null }
                PanelOption(
                    title = opt.providerId.label,
                    subtitle = subtitle,
                    current = opt.providerId == current,
                    off = !playable,
                    onClick = { if (playable) onPickSource(opt.providerId) },
                    modifier = Modifier.initialIf(opt.providerId == current),
                )
            }
            sources.failed.filter { id -> sources.options.none { it.providerId == id } }.forEach { id ->
                PanelOption(title = id.label, subtitle = "Не ответил", off = true, onClick = {})
            }
            when {
                !sources.done -> PanelOption(title = "Ищем источники…", off = true, onClick = {}, modifier = Modifier.initialIf(true))
                sources.options.isEmpty() -> PanelOption(
                    title = "Источников не нашлось",
                    subtitle = "Нажмите, чтобы поискать снова",
                    onClick = onRetry,
                    modifier = Modifier.initialIf(true),
                )
            }
        }
        val opt = sources.options.firstOrNull { it.providerId == current }
        if (opt != null && opt.voices.isNotEmpty()) {
            PanelTitle("Озвучка")
            PanelList {
                val selected = chosenVoice ?: opt.voices.first().id
                opt.voices.forEach { v ->
                    PanelOption(title = v.name, current = v.id == selected, onClick = { onPickVoice(opt.providerId, v.id, v.name) })
                }
            }
        }
    }
}
