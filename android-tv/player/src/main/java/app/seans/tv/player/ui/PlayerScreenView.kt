package app.seans.tv.player.ui

import android.os.SystemClock
import android.view.KeyEvent as AndroidKeyEvent
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.focusable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.runtime.withFrameNanos
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.input.key.Key
import androidx.compose.ui.input.key.KeyEvent
import androidx.compose.ui.input.key.KeyEventType
import androidx.compose.ui.input.key.key
import androidx.compose.ui.input.key.onPreviewKeyEvent
import androidx.compose.ui.input.key.type
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.LifecycleStartEffect
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.media3.exoplayer.ExoPlayer
import app.seans.tv.designsystem.BottomPanel
import app.seans.tv.designsystem.EpisodeCard
import app.seans.tv.designsystem.PanelList
import app.seans.tv.designsystem.PanelOption
import app.seans.tv.designsystem.PanelScrim
import app.seans.tv.designsystem.PanelTitle
import app.seans.tv.designsystem.PinToStart
import app.seans.tv.designsystem.SText
import app.seans.tv.designsystem.SeansButton
import app.seans.tv.designsystem.SeansColors
import app.seans.tv.designsystem.SeansIcons
import app.seans.tv.designsystem.SeansRadius
import app.seans.tv.designsystem.SeansSpace
import app.seans.tv.designsystem.SeansText
import app.seans.tv.designsystem.SeasonTab
import app.seans.tv.designsystem.SidePanel
import app.seans.tv.designsystem.TimelineBar
import app.seans.tv.designsystem.tryRequestFocus
import app.seans.tv.model.AppGraph
import app.seans.tv.model.EpisodeKey
import app.seans.tv.model.PlaybackRequest
import app.seans.tv.model.SourceKind
import app.seans.tv.model.SourceOption
import app.seans.tv.player.engine.ExoEngine
import app.seans.tv.player.engine.PlaybackEngine
import app.seans.tv.player.engine.PlayerBudget
import app.seans.tv.player.progress.ProgressWriter
import app.seans.tv.player.session.Phase
import app.seans.tv.player.session.PlayerSession
import app.seans.tv.player.session.PlayerUiState
import app.seans.tv.player.session.BarAction
import app.seans.tv.player.session.BarKeys
import app.seans.tv.player.session.Scrubber
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.delay

/** Outlives every screen, so a progress write queued on exit still reaches the store. */
private val ProgressScope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)

private const val CONTROLS_TIMEOUT_MS = 5_000L

private enum class Overlay { None, Episodes, Sources, Subtitles, Quality, Settings }

@Composable
internal fun PlayerScreenView(request: PlaybackRequest, graph: AppGraph, onExit: () -> Unit) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val engine = remember(graph) { ExoEngine(context.applicationContext, graph.http) }
    val session = remember(request, graph) {
        PlayerSession(
            request = request,
            sources = graph.sources,
            progress = graph.progress,
            catalog = graph.catalog,
            engine = engine,
            scope = scope,
            writer = ProgressWriter(ProgressScope, System::currentTimeMillis) { graph.progress.save(it) },
            elapsed = SystemClock::elapsedRealtime,
        )
    }
    var player by remember { mutableStateOf<ExoPlayer?>(null) }

    LifecycleStartEffect(session) {
        player = engine.attach()
        session.onStart()
        onStopOrDispose {
            // Flush first: the low-RAM TV kills the app soon after Home (risk M5).
            session.onStop()
            engine.detach()
            player = null
        }
    }
    DisposableEffect(session) { onDispose { session.close() } }

    val state by session.state.collectAsStateWithLifecycle()
    PlayerContent(
        state = state,
        player = player,
        engine = engine,
        session = session,
        onExit = {
            session.close()
            onExit()
        },
    )
}

@Composable
private fun PlayerContent(
    state: PlayerUiState,
    player: ExoPlayer?,
    engine: PlaybackEngine,
    session: PlayerSession,
    onExit: () -> Unit,
) {
    var controlsVisible by remember { mutableStateOf(true) }
    var lastInput by remember { mutableLongStateOf(SystemClock.elapsedRealtime()) }
    var overlay by remember { mutableStateOf(Overlay.None) }
    /** The control that opened the panel; focus returns there when it closes. */
    var overlayOrigin by remember { mutableStateOf<FocusRequester?>(null) }
    var swallowUp by remember { mutableStateOf<Key?>(null) }
    var barFocused by remember { mutableStateOf(false) }
    var scrubTarget by remember { mutableStateOf<Long?>(null) }
    val rootFocus = remember { FocusRequester() }
    val focus = remember { ControlFocus() }
    val playing = state.phase == Phase.Playing
    val latestState by rememberUpdatedState(state)
    val latestExit by rememberUpdatedState(onExit)
    var backArmed by remember { mutableStateOf(false) }
    val scrubber = remember(session) { Scrubber(SystemClock::elapsedRealtime) { session.seekTo(it) } }

    fun wake() {
        lastInput = SystemClock.elapsedRealtime()
        if (!controlsVisible) controlsVisible = true
        // Any wake lands on the progress bar, as in Lampa.
        focus.bar.tryRequestFocus()
    }

    fun open(target: Overlay, origin: FocusRequester?) {
        overlay = target
        overlayOrigin = origin
        if (target == Overlay.Episodes) session.refreshEpisodeProgress()
    }

    fun closeOverlay() {
        val back = overlayOrigin
        overlay = Overlay.None
        overlayOrigin = null
        lastInput = SystemClock.elapsedRealtime()
        (back ?: focus.bar).tryRequestFocus()
    }

    fun scrub(direction: Int, repeat: Boolean) {
        scrubber.press(direction, engine.positionMs, engine.durationMs, repeat)
        scrubTarget = scrubber.targetMs
        lastInput = SystemClock.elapsedRealtime()
    }

    // The scrubber jumps once, about 0.6 s after the last press.
    LaunchedEffect(scrubTarget != null) {
        while (scrubTarget != null) {
            delay(100)
            scrubber.poll()
            scrubTarget = scrubber.targetMs
        }
    }

    // Hide the controls 5 s after the last key while the video plays; never while scrubbing, while a
    // panel is open, while paused or at the end.
    LaunchedEffect(controlsVisible, lastInput, overlay, playing, scrubTarget != null) {
        if (!controlsVisible || overlay != Overlay.None || !playing || scrubTarget != null) return@LaunchedEffect
        delay(CONTROLS_TIMEOUT_MS)
        if (engine.playWhenReady && !latestState.ended && scrubTarget == null) controlsVisible = false
    }
    LaunchedEffect(state.phase) {
        if (state.phase == Phase.Playing || state.phase == Phase.Loading) {
            withFrameNanos { }
            if (overlay == Overlay.None) focus.bar.tryRequestFocus()
        } else {
            controlsVisible = true
        }
    }
    LaunchedEffect(state.ended) { if (state.ended) wake() }
    LaunchedEffect(Unit) {
        withFrameNanos { }
        rootFocus.tryRequestFocus()
    }

    // The key modifier may keep an old instance of the handler, so it reads everything through State.
    fun onKey(event: KeyEvent): Boolean {
        val s = latestState
        val down = event.type == KeyEventType.KeyDown
        val code = event.nativeKeyEvent.keyCode
        if (!down && swallowUp == event.key) {
            swallowUp = null
            return true
        }
        if (event.key == Key.Back) {
            // Act on Back's KeyUp only when its KeyDown reached the player itself: the press that
            // closed a panel must not also hide the controls or leave the screen.
            if (down) backArmed = overlay == Overlay.None && s.autoNextIn == null
            else if (!backArmed) return overlay == Overlay.None
            else backArmed = false
        }
        if (down) lastInput = SystemClock.elapsedRealtime()
        if (s.autoNextIn != null) {
            // Any key cancels the countdown, and does nothing else.
            if (down) {
                session.cancelAutoNext()
                swallowUp = event.key
                wake()
            }
            return true
        }
        if (overlay != Overlay.None) return false
        if (s.phase != Phase.Playing && s.phase != Phase.Loading) {
            if (event.key == Key.Back) {
                if (!down) latestExit()
                return true
            }
            return false
        }
        when (code) {
            AndroidKeyEvent.KEYCODE_MEDIA_PLAY_PAUSE -> { if (down) { session.togglePause(); wake() }; return true }
            AndroidKeyEvent.KEYCODE_MEDIA_PLAY -> { if (down) { session.play(); wake() }; return true }
            AndroidKeyEvent.KEYCODE_MEDIA_PAUSE -> { if (down) { session.pause(); wake() }; return true }
            AndroidKeyEvent.KEYCODE_MEDIA_FAST_FORWARD -> { if (down) { session.seekBy(PlayerBudget.SEEK_STEP_MS); wake() }; return true }
            AndroidKeyEvent.KEYCODE_MEDIA_REWIND -> { if (down) { session.seekBy(-PlayerBudget.SEEK_STEP_MS); wake() }; return true }
            AndroidKeyEvent.KEYCODE_MEDIA_NEXT -> { if (down) session.nextEpisode(); return true }
        }
        if (event.key == Key.Back) {
            if (!down) {
                when {
                    scrubTarget != null -> { scrubber.cancel(); scrubTarget = null }
                    controlsVisible && s.phase == Phase.Playing && engine.playWhenReady -> controlsVisible = false
                    else -> latestExit()
                }
            }
            return true
        }
        val action = BarKeys.action(code)
        if (!controlsVisible) {
            // Controls hidden: OK pauses, Left/Right start scrubbing; every key shows the controls.
            if (down) {
                when (action) {
                    BarAction.TogglePause -> session.togglePause()
                    BarAction.SeekBack -> scrub(-1, repeat = false)
                    BarAction.SeekForward -> scrub(+1, repeat = false)
                    BarAction.None -> Unit
                }
                if (action != BarAction.SeekBack && action != BarAction.SeekForward) swallowUp = event.key
                wake()
            }
            return true
        }
        if (barFocused) {
            val repeat = event.nativeKeyEvent.repeatCount > 0
            when (action) {
                BarAction.SeekBack -> { if (down) scrub(-1, repeat); return true }
                BarAction.SeekForward -> { if (down) scrub(+1, repeat); return true }
                BarAction.TogglePause -> { if (down) session.togglePause(); return true }
                BarAction.None -> Unit
            }
        }
        return false
    }

    Box(
        Modifier
            .fillMaxSize()
            .background(Color.Black)
            .focusRequester(rootFocus)
            .onPreviewKeyEvent { onKey(it) }
            .focusable(),
    ) {
        VideoSurface(player)
        val controlsAlpha by animateFloatAsState(if (controlsVisible) 1f else 0f, tween(300), label = "controls")
        SubtitleLines(state.cues, bottomPadding = if (controlsAlpha > 0.5f) 150.dp else 40.dp)

        if (state.phase == Phase.Playing || state.phase == Phase.Loading) {
            Box(Modifier.fillMaxSize().alpha(controlsAlpha)) {
                LampaControls(
                    state = state,
                    engine = engine,
                    focus = focus,
                    scrubTargetMs = scrubTarget,
                    onBarFocused = { barFocused = it },
                    onMenu = { open(if (state.isSeries) Overlay.Episodes else Overlay.Sources, focus.menu) },
                    onTogglePause = session::togglePause,
                    onQuality = { open(Overlay.Quality, focus.quality) },
                    onSettings = { open(Overlay.Settings, focus.gear) },
                )
            }
        }
        if (state.phase == Phase.Loading) Spinner(Modifier.align(Alignment.Center))
        StatusCard(state, session, onExit)
        AutoNextCard(state)

        PanelScrim(overlay != Overlay.None)
        EpisodesDrawer(
            visible = overlay == Overlay.Episodes,
            state = state,
            onDismiss = ::closeOverlay,
            onPick = { key ->
                closeOverlay()
                if (key != state.episode) session.selectEpisode(key)
            },
        )
        SourcesPanel(
            visible = overlay == Overlay.Sources,
            state = state,
            onDismiss = ::closeOverlay,
            onSource = { option ->
                closeOverlay()
                if (option != state.option) session.selectSource(option)
            },
            onVoice = { id ->
                closeOverlay()
                session.selectVoice(id)
            },
        )
        SidePanel(visible = overlay == Overlay.Settings, onDismiss = ::closeOverlay) {
            PanelTitle("Настройки")
            PanelList {
                val voice = state.voices.firstOrNull { it.id == state.voiceId }?.name
                PanelOption("Озвучка", onClick = { overlay = Overlay.Sources }, subtitle = voice ?: "—")
                PanelOption(
                    "Субтитры", onClick = { overlay = Overlay.Subtitles },
                    subtitle = state.subtitles.firstOrNull { it.url == state.subtitleUrl }?.label ?: "Выкл",
                )
                PanelOption("Источник", onClick = { overlay = Overlay.Sources }, subtitle = state.option?.providerId?.label ?: "—")
                PanelOption("Качество", onClick = { overlay = Overlay.Quality }, subtitle = state.qualities.getOrNull(state.qualityIndex) ?: "Автоматически")
            }
        }
        SidePanel(visible = overlay == Overlay.Subtitles, onDismiss = ::closeOverlay) {
            PanelTitle("Субтитры")
            PanelList {
                PanelOption("Выкл", onClick = { session.selectSubtitle(null); closeOverlay() }, current = state.subtitleUrl == null)
                state.subtitles.forEach { track ->
                    PanelOption(track.label, onClick = { session.selectSubtitle(track.url); closeOverlay() }, current = state.subtitleUrl == track.url)
                }
            }
        }
        SidePanel(visible = overlay == Overlay.Quality, onDismiss = ::closeOverlay) {
            PanelTitle("Качество")
            PanelList {
                if (!state.qualitiesAreStreams) {
                    PanelOption("Автоматически", onClick = { session.selectQuality(-1); closeOverlay() }, current = state.qualityIndex < 0)
                }
                state.qualities.forEachIndexed { index, label ->
                    PanelOption(label, onClick = { session.selectQuality(index); closeOverlay() }, current = state.qualityIndex == index)
                }
            }
        }
    }
}

/** Searching, no source and failure: always with a focusable button, never an endless spinner. */
@Composable
private fun StatusCard(state: PlayerUiState, session: PlayerSession, onExit: () -> Unit) {
    val phase = state.phase
    if (phase == Phase.Playing || phase == Phase.Loading) return
    val firstFocus = remember { FocusRequester() }
    LaunchedEffect(phase) {
        withFrameNanos { }
        firstFocus.tryRequestFocus()
    }
    Box(Modifier.fillMaxSize().background(Color(0xCC000000)), contentAlignment = Alignment.Center) {
        Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(10.dp)) {
            when (phase) {
                Phase.Searching -> {
                    Spinner()
                    SText("Ищем источник…", SeansText.Section)
                    SText(state.title, SeansText.Meta, maxLines = 1)
                    Spacer(Modifier.height(6.dp))
                    SeansButton("Назад", onClick = onExit, modifier = Modifier.focusRequester(firstFocus))
                }
                Phase.NoSource -> {
                    SText("Нет источника", SeansText.Heading)
                    SText(
                        if (state.episode != null) "Ни один источник не нашёл эту серию" else "Ни один источник не нашёл этот фильм",
                        SeansText.Meta,
                    )
                    Spacer(Modifier.height(6.dp))
                    SeansButton("Назад", onClick = onExit, modifier = Modifier.focusRequester(firstFocus))
                }
                is Phase.Failed -> {
                    SText("Не удалось воспроизвести", SeansText.Heading)
                    phase.failed?.let { SText("Источник: ${it.label}", SeansText.Meta) }
                    Spacer(Modifier.height(6.dp))
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        val offer = phase.offer
                        if (offer != null) {
                            SeansButton("Следующий источник: ${offer.providerId.label}", onClick = session::tryOffered, modifier = Modifier.focusRequester(firstFocus))
                            SeansButton("Повторить", onClick = session::retry)
                        } else {
                            SeansButton("Повторить", onClick = session::retry, modifier = Modifier.focusRequester(firstFocus))
                        }
                        SeansButton("Назад", onClick = onExit)
                    }
                }
                else -> Unit
            }
        }
    }
}

@Composable
private fun AutoNextCard(state: PlayerUiState) {
    val left = state.autoNextIn ?: return
    val next = state.next
    Box(Modifier.fillMaxSize().padding(end = SeansSpace.SafeX, bottom = 120.dp), contentAlignment = Alignment.BottomEnd) {
        Column(
            Modifier
                .clip(RoundedCornerShape(SeansRadius.Lg))
                .background(SeansColors.Panel)
                .padding(horizontal = 18.dp, vertical = 14.dp),
            verticalArrangement = Arrangement.spacedBy(2.dp),
        ) {
            SText("Следующая серия через $left", SeansText.Section, maxLines = 1)
            next?.let { SText("Сезон ${it.season} · Серия ${it.episode} · любая кнопка — отмена", SeansText.Caption, maxLines = 1) }
        }
    }
}

@Composable
private fun androidx.compose.foundation.layout.BoxScope.EpisodesDrawer(
    visible: Boolean,
    state: PlayerUiState,
    onDismiss: () -> Unit,
    onPick: (EpisodeKey) -> Unit,
) {
    val current = state.episode
    var season by remember(visible, current) { mutableStateOf(current?.season ?: state.seasons.firstOrNull()?.number ?: 1) }
    val currentFocus = remember { FocusRequester() }
    BottomPanel(visible = visible, onDismiss = onDismiss, initialFocus = currentFocus) {
        Row(
            Modifier.fillMaxWidth().padding(horizontal = SeansSpace.SafeX),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            if (state.seasons.size > 1) {
                Row(Modifier.weight(1f), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    state.seasons.forEach { s ->
                        SeasonTab(if (s.number == 0) "Спецвыпуски" else "Сезон ${s.number}", current = s.number == season, onClick = { season = s.number })
                    }
                }
            } else {
                SText("Сезон $season", SeansText.Section, Modifier.weight(1f), maxLines = 1)
            }
            SText("◄ ► выбор серии · OK — смотреть", SeansText.Caption, maxLines = 1)
        }
        Spacer(Modifier.height(14.dp))
        val episodes = state.seasons.firstOrNull { it.number == season }?.episodes.orEmpty()
        val currentIndex = episodes.indexOfFirst { it.key == current }.coerceAtLeast(0)
        val listState = rememberLazyListState(initialFirstVisibleItemIndex = currentIndex)
        if (episodes.isEmpty()) {
            SText("Список серий недоступен", SeansText.Meta, Modifier.padding(horizontal = SeansSpace.SafeX).focusRequester(currentFocus).focusable())
        } else PinToStart(SeansSpace.SafeX) {
            // The focused episode sits at the row's start, as in the mockup (the current one first).
            LazyRow(
                state = listState,
                contentPadding = PaddingValues(horizontal = SeansSpace.SafeX),
                horizontalArrangement = Arrangement.spacedBy(SeansSpace.RowGap),
            ) {
                itemsIndexed(episodes, key = { _, e -> e.key.storageKey() }) { index, info ->
                    val stored = state.episodeProgress[info.key]
                    val isCurrent = info.key == current
                    val minutes = info.durationSec?.let { (it + 59) / 60 }
                    val subtitle = when {
                        stored != null && !stored.completed && stored.positionMs > 0 && stored.durationMs > 0 ->
                            "осталось ${(stored.remainingMs / 60_000).coerceAtLeast(1)} мин"
                        minutes != null -> "$minutes мин"
                        else -> ""
                    }
                    EpisodeCard(
                        number = "E${info.key.episode}",
                        title = info.title ?: "Серия ${info.key.episode}",
                        subtitle = subtitle,
                        imageUrl = info.stillUrl,
                        watched = stored?.completed == true,
                        progress = stored?.takeIf { !it.completed }?.fraction,
                        onClick = { onPick(info.key) },
                        modifier = if (isCurrent || (current == null && index == 0)) Modifier.focusRequester(currentFocus) else Modifier,
                    )
                }
            }
        }
    }
}

@Composable
private fun androidx.compose.foundation.layout.BoxScope.SourcesPanel(
    visible: Boolean,
    state: PlayerUiState,
    onDismiss: () -> Unit,
    onSource: (SourceOption) -> Unit,
    onVoice: (String) -> Unit,
) {
    val currentFocus = remember { FocusRequester() }
    SidePanel(visible = visible, onDismiss = onDismiss, initialFocus = currentFocus) {
        Column(Modifier.verticalScroll(rememberScrollState())) {
            PanelTitle("Источник")
            PanelList {
                state.options.forEach { option ->
                    val playable = option.kind == SourceKind.DIRECT && option.unavailableReason == null &&
                        (state.episode == null || option.providerId.supportsEpisodes)
                    val isCurrent = option == state.option
                    PanelOption(
                        title = option.providerId.label,
                        subtitle = optionLine(option),
                        current = isCurrent,
                        off = !playable,
                        onClick = { if (playable) onSource(option) },
                        modifier = if (isCurrent) Modifier.focusRequester(currentFocus) else Modifier,
                    )
                }
                if (state.options.isEmpty()) SText("Источники ещё ищутся…", SeansText.Meta)
            }
            if (state.voices.isNotEmpty()) {
                PanelTitle("Озвучка")
                PanelList {
                    state.voices.forEach { voice ->
                        PanelOption(title = voice.name, current = voice.id == state.voiceId, onClick = { onVoice(voice.id) })
                    }
                }
            }
            Spacer(Modifier.width(1.dp))
        }
    }
}

private fun optionLine(option: SourceOption): String {
    option.unavailableReason?.let { return it }
    val parts = mutableListOf<String>()
    option.quality?.let { parts += it }
    if (option.voices.isNotEmpty()) parts += voicesLabel(option.voices.size)
    if (option.kind == SourceKind.WEB) parts += "через веб-плеер"
    return parts.joinToString(" · ")
}

private fun voicesLabel(n: Int): String {
    val mod10 = n % 10
    val mod100 = n % 100
    val word = when {
        mod10 == 1 && mod100 != 11 -> "озвучка"
        mod10 in 2..4 && mod100 !in 12..14 -> "озвучки"
        else -> "озвучек"
    }
    return "$n $word"
}
