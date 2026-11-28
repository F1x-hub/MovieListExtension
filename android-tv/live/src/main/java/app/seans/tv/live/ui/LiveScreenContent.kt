package app.seans.tv.live.ui

import android.util.Log
import android.view.KeyEvent as AndroidKeyEvent
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInHorizontally
import androidx.compose.animation.slideOutHorizontally
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxScope
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
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
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.input.key.KeyEventType
import androidx.compose.ui.input.key.onPreviewKeyEvent
import androidx.compose.ui.input.key.type
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.tv.material3.ClickableSurfaceDefaults
import androidx.tv.material3.Icon
import androidx.tv.material3.Surface
import androidx.tv.material3.Text
import app.seans.tv.designsystem.SeansColors
import app.seans.tv.designsystem.SeansRadius
import app.seans.tv.designsystem.SeansSpace
import app.seans.tv.designsystem.SeansType
import app.seans.tv.live.LiveData
import app.seans.tv.live.LiveModule
import app.seans.tv.live.LiveModule.Companion.episodeKey
import app.seans.tv.live.LiveModule.Companion.titleRef
import app.seans.tv.live.channel.Channel
import app.seans.tv.live.channel.ChannelMode
import app.seans.tv.live.channel.LiveStrings
import app.seans.tv.live.channel.Position
import app.seans.tv.live.channel.PositionState
import app.seans.tv.live.channel.SlotStatus
import app.seans.tv.live.channel.StandbyModel
import app.seans.tv.live.channel.channelKey
import app.seans.tv.live.channel.computePosition
import app.seans.tv.live.channel.displayTitle
import app.seans.tv.live.channel.formatClock
import app.seans.tv.live.channel.formatLength
import app.seans.tv.live.channel.getScheduleBounds
import app.seans.tv.live.channel.lengthIsExact
import app.seans.tv.live.channel.nextScheduled
import app.seans.tv.live.channel.playbackAnchorMs
import app.seans.tv.live.channel.playbackBounds
import app.seans.tv.live.channel.programmeModel
import app.seans.tv.live.channel.projectPausedSchedule
import app.seans.tv.live.channel.resolveChannel
import app.seans.tv.live.channel.slotCaption
import app.seans.tv.live.channel.standbyModel
import app.seans.tv.model.AppGraph
import app.seans.tv.model.BroadcastLock
import app.seans.tv.model.PlaybackRequest
import app.seans.tv.model.SelectionReason
import app.seans.tv.model.ServerClock
import app.seans.tv.model.TitleDetails
import app.seans.tv.model.TitleRef
import app.seans.tv.model.TitleSummary
import app.seans.tv.player.BroadcastPlaybackState
import app.seans.tv.player.BroadcastPlayer
import app.seans.tv.player.broadcast.BroadcastControls
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.withTimeoutOrNull

/** What the screen shows; equal values do not recompose (offsets and countdowns live in leaves). */
private sealed interface LiveView {
    data object Connecting : LiveView
    data class Standby(val model: StandbyModel) : LiveView
    data class OnAir(val channel: Channel, val key: String, val confirmed: Boolean) : LiveView
}

/** The player reported the end of the file for this exact playback (`mediaEnded` of `live.js`). */
private data class EndedMark(val identity: String, val atSec: Long)

private fun playbackIdentity(channel: Channel): String {
    val anchor = if (channel.playbackStartedAtMs.isFinite()) channel.playbackStartedAtMs else channel.startedAtMs
    return "${channelKey(channel)}|$anchor|${channel.mediaPausedAtSec}"
}

/** `currentPosition` of `live.js`: the channel position plus what the player itself reported. */
private fun currentPosition(channel: Channel, nowMs: Double, ended: EndedMark?, youtubeLength: Pair<String, Double>?): Position {
    val position = computePosition(channel, nowMs)
    if (ended != null && ended.identity == playbackIdentity(channel) && position.onAir) return Position(PositionState.ENDED, ended.atSec)
    val youtube = channel.youtube
    if (channel.mode != ChannelMode.YOUTUBE || youtube == null || youtube.live || youtube.durationSec > 0 || position.state != PositionState.LIVE) return position
    val sec = if (youtubeLength?.first == channelKey(channel)) youtubeLength.second else 0.0
    return if (sec > 0 && position.offsetSec >= sec) Position(PositionState.ENDED, sec.toLong()) else position
}

private fun resolveView(data: LiveData, nowMs: Double, ended: EndedMark?, youtubeLength: Pair<String, Double>?): LiveView {
    if (data.unavailable) return LiveView.Standby(standbyModel(null, null, null, nowMs, unavailable = true).copy(countdownSec = null))
    val manual = data.manual ?: return LiveView.Connecting
    val channel = resolveChannel(manual, data.schedule, nowMs)
    val position = currentPosition(channel, nowMs, ended, youtubeLength)
    if (channel.mode != ChannelMode.OFF && position.onAir) return LiveView.OnAir(channel, channelKey(channel), data.confirmed)
    val next = nextScheduled(data.schedule, nowMs)
    return LiveView.Standby(standbyModel(channel, position, next, nowMs, unavailable = false).copy(countdownSec = null))
}

/** The lock the broadcast player obeys, derived from the channel item on air. */
internal fun broadcastLockOf(channel: Channel, nowMs: Double): BroadcastLock {
    val anchor = playbackAnchorMs(channel, nowMs)
    val pausedAt = channel.mediaPausedAtSec
    val duration = channel.mediaDurationSec
    val endsAt = when {
        channel.scheduled && channel.explicitEnd -> channel.endsAtMs
        duration > 0 && lengthIsExact(channel) -> anchor + duration * 1000.0
        else -> Double.NaN
    }
    return BroadcastLock(
        anchorServerMs = anchor.toLong(),
        pausedAtMs = if (pausedAt.isFinite()) Math.round(pausedAt * 1000) else null,
        endsAtServerMs = if (endsAt.isFinite()) endsAt.toLong() else null,
    )
}

/** Remote keys that would pause, seek or skip: swallowed on the Live screen (D5). */
private val LOCKED_KEYS = setOf(
    AndroidKeyEvent.KEYCODE_MEDIA_PLAY, AndroidKeyEvent.KEYCODE_MEDIA_PAUSE, AndroidKeyEvent.KEYCODE_MEDIA_PLAY_PAUSE,
    AndroidKeyEvent.KEYCODE_MEDIA_STOP, AndroidKeyEvent.KEYCODE_HEADSETHOOK,
    AndroidKeyEvent.KEYCODE_MEDIA_FAST_FORWARD, AndroidKeyEvent.KEYCODE_MEDIA_REWIND,
    AndroidKeyEvent.KEYCODE_MEDIA_NEXT, AndroidKeyEvent.KEYCODE_MEDIA_PREVIOUS,
    AndroidKeyEvent.KEYCODE_MEDIA_SKIP_FORWARD, AndroidKeyEvent.KEYCODE_MEDIA_SKIP_BACKWARD,
    AndroidKeyEvent.KEYCODE_MEDIA_STEP_FORWARD, AndroidKeyEvent.KEYCODE_MEDIA_STEP_BACKWARD,
)

private val timeFormat = DateTimeFormatter.ofPattern("HH:mm")
private fun hhmm(ms: Double): String = Instant.ofEpochMilli(ms.toLong()).atZone(ZoneId.systemDefault()).format(timeFormat)

/** The server time, refreshed on each server second. Read it only in small leaf composables (M6). */
@Composable
private fun rememberServerNow(clock: ServerClock): Double {
    val now by produceState(clock.nowMs().toDouble(), clock) {
        while (true) {
            val ms = clock.nowMs()
            value = ms.toDouble()
            delay(1000 - ms % 1000)
        }
    }
    return now
}

private enum class Panel { PROGRAMME, VOICE, SUBTITLES }

@Composable
internal fun LiveScreenContent(
    module: LiveModule,
    graph: AppGraph,
    onOpenDetails: (TitleRef) -> Unit,
    onExit: () -> Unit,
) {
    val data by module.data.collectAsStateWithLifecycle()
    val clock = module.clock
    LaunchedEffect(Unit) { module.syncClock() }
    val lifecycleState by LocalLifecycleOwner.current.lifecycle.currentStateFlow.collectAsState()
    val started = lifecycleState.isAtLeast(Lifecycle.State.STARTED)

    var ended by remember { mutableStateOf<EndedMark?>(null) }
    var youtubeLength by remember { mutableStateOf<Pair<String, Double>?>(null) }
    val view by produceState<LiveView>(LiveView.Connecting, data, ended, youtubeLength) {
        while (true) {
            val ms = clock.nowMs()
            value = resolveView(data, ms.toDouble(), ended, youtubeLength)
            delay(1000 - ms % 1000)
        }
    }

    var panel by remember { mutableStateOf<Panel?>(null) }
    var overlayVisible by remember { mutableStateOf(true) }
    var interactions by remember { mutableIntStateOf(0) }
    var playing by remember { mutableStateOf(false) }
    var muted by rememberSaveable { mutableStateOf(false) }
    val mainFocus = remember { FocusRequester() }

    // The overlay hides while the picture plays and nobody touches the remote.
    LaunchedEffect(interactions, panel, playing, view is LiveView.OnAir) {
        overlayVisible = true
        if (playing && panel == null && view is LiveView.OnAir) {
            delay(OVERLAY_HIDE_MS)
            overlayVisible = false
        }
    }

    Box(
        Modifier
            .fillMaxSize()
            .background(Color.Black)
            .onPreviewKeyEvent { event ->
                val code = event.nativeKeyEvent.keyCode
                if (code in LOCKED_KEYS) return@onPreviewKeyEvent true
                if (code == AndroidKeyEvent.KEYCODE_BACK) {
                    if (event.type == KeyEventType.KeyUp) {
                        if (panel != null) panel = null else onExit()
                    }
                    return@onPreviewKeyEvent true
                }
                if (event.type == KeyEventType.KeyDown) {
                    interactions++
                    if (!overlayVisible) {
                        overlayVisible = true
                        return@onPreviewKeyEvent true
                    }
                }
                false
            },
    ) {
        when (val current = view) {
            LiveView.Connecting -> CenterNote(LiveStrings.CONNECTING)
            is LiveView.Standby -> {
                LaunchedEffect(Unit) { playing = false }
                StandbyLayer(current.model, clock, mainFocus, clockVisible = panel == null, onProgramme = { panel = Panel.PROGRAMME })
            }
            is LiveView.OnAir -> key(current.key) {
                OnAirLayer(
                    view = current,
                    clock = clock,
                    graph = graph,
                    started = started,
                    muted = muted,
                    overlayVisible = overlayVisible,
                    mainFocus = mainFocus,
                    onMute = { muted = !muted },
                    onPanel = { panel = it },
                    panel = panel,
                    onPlaying = { playing = it },
                    onEnded = { ended = EndedMark(playbackIdentity(current.channel), it) },
                    onYoutubeLength = { youtubeLength = current.key to it },
                    onOpenDetails = onOpenDetails,
                )
            }
        }

        AnimatedVisibility(
            visible = panel == Panel.PROGRAMME,
            modifier = Modifier.align(Alignment.CenterEnd),
            enter = slideInHorizontally { it / 10 } + fadeIn(),
            exit = slideOutHorizontally { it / 10 } + fadeOut(),
        ) {
            ProgrammePanel(data, clock, onOpenDetails)
        }
    }

    // Focus lands on «Программа» whenever the layer changes or a panel closes (D1, D2).
    val focusKey = (view as? LiveView.OnAir)?.key ?: view::class.simpleName
    LaunchedEffect(focusKey, panel) {
        if (panel == null) {
            withFrameNanos { }
            runCatching { mainFocus.requestFocus() }
        }
    }
}

@Composable
private fun OnAirLayer(
    view: LiveView.OnAir,
    clock: ServerClock,
    graph: AppGraph,
    started: Boolean,
    muted: Boolean,
    overlayVisible: Boolean,
    mainFocus: FocusRequester,
    onMute: () -> Unit,
    onPanel: (Panel?) -> Unit,
    panel: Panel?,
    onPlaying: (Boolean) -> Unit,
    onEnded: (Long) -> Unit,
    onYoutubeLength: (Double) -> Unit,
    onOpenDetails: (TitleRef) -> Unit,
) {
    val channel = view.channel
    val ref = remember(view.key) { channel.titleRef() }
    var details by remember(view.key) { mutableStateOf<TitleDetails?>(null) }
    var detailsDone by remember(view.key) { mutableStateOf(ref == null) }
    LaunchedEffect(view.key) {
        if (ref != null) {
            // Gives the sources a title and year to search by; Details reads `movies/{kp}` first.
            details = withTimeoutOrNull(DETAILS_WAIT_MS) { runCatching { graph.catalog.details(ref) }.getOrNull() }
            detailsDone = true
        }
    }
    val lock = remember(view.key) { MutableStateFlow(broadcastLockOf(channel, clock.nowMs().toDouble())) }
    LaunchedEffect(channel) { lock.value = broadcastLockOf(channel, clock.nowMs().toDouble()) }

    var playback by remember(view.key) { mutableStateOf<BroadcastPlaybackState>(BroadcastPlaybackState.Searching) }
    var youtubeError by remember(view.key) { mutableStateOf(false) }
    var captions by remember(view.key) { mutableStateOf<List<CaptionTrack>>(emptyList()) }
    var captionLanguage by remember(view.key) { mutableStateOf<String?>(null) }
    // The viewer's own sound, voice and subtitles; the player binds them to whatever plays.
    val controls = remember(view.key) { BroadcastControls() }
    val voices by controls.voicesFlow.collectAsStateWithLifecycle()
    val subtitles by controls.subtitlesFlow.collectAsStateWithLifecycle()
    val selectedVoice by controls.selectedVoice.collectAsStateWithLifecycle()
    val selectedSubtitle by controls.selectedSubtitle.collectAsStateWithLifecycle()
    LaunchedEffect(controls, muted) { controls.setMuted(muted) }
    val mount = view.confirmed && detailsDone && started
    LaunchedEffect(mount) { if (!mount) onPlaying(false) }

    Box(Modifier.fillMaxSize()) {
        if (mount) {
            if (channel.mode == ChannelMode.YOUTUBE) {
                LiveYoutubePlayer(
                    channel = channel,
                    clock = clock,
                    muted = muted,
                    captionLanguage = captionLanguage,
                    onEvent = { event ->
                        when (event) {
                            YoutubeEvent.Playing -> { youtubeError = false; onPlaying(true) }
                            is YoutubeEvent.Ended -> { onPlaying(false); onEnded(event.atSec) }
                            is YoutubeEvent.Duration -> if (event.sec <= 12 * 3600) onYoutubeLength(event.sec)
                            YoutubeEvent.IsLive -> Unit
                            is YoutubeEvent.Error -> { Log.w("LiveScreen", "YouTube error ${event.code}"); youtubeError = true; onPlaying(false) }
                            is YoutubeEvent.Captions -> captions = event.tracks
                        }
                    },
                    modifier = Modifier.fillMaxSize(),
                )
            } else {
                val request = remember(view.key, details) {
                    val summary = details?.summary ?: TitleSummary(
                        ref = ref!!,
                        title = displayTitle(channel),
                        posterUrl = channel.movie?.posterUrl?.ifEmpty { null },
                    )
                    PlaybackRequest(summary = summary, episode = channel.episodeKey(), reason = SelectionReason.BROADCAST)
                }
                BroadcastPlayer(
                    request = request,
                    lock = lock,
                    clock = clock,
                    graph = graph,
                    onState = { state ->
                        playback = state
                        onPlaying(state is BroadcastPlaybackState.Playing)
                    },
                    modifier = Modifier.fillMaxSize(),
                    controller = controls,
                )
            }
        } else {
            CenterNote(LiveStrings.CONNECTING)
        }

        val problem = when {
            channel.mode == ChannelMode.YOUTUBE && youtubeError -> LiveStrings.YOUTUBE_BLOCKED to null
            playback is BroadcastPlaybackState.NoSource -> LiveStrings.NO_SOURCE_TITLE to LiveStrings.NO_SOURCE_TEXT
            playback is BroadcastPlaybackState.Failed -> LiveStrings.NO_SOURCE_TITLE to LiveStrings.NO_SOURCE_TEXT
            else -> null
        }
        if (problem != null) {
            Box(Modifier.fillMaxSize().background(SeansColors.Bg), contentAlignment = Alignment.Center) {
                InfoCard(problem.first, problem.second)
            }
        }

        val youtube = channel.mode == ChannelMode.YOUTUBE
        val subtitleOptions: List<Option> = if (youtube) captions.map { Option(it.languageCode, it.name) } else subtitles.map { Option(it.url, it.label) }
        val subtitleSelected = if (youtube) captionLanguage else selectedSubtitle
        val subtitleLabel = subtitleSelected?.let { id -> subtitleOptions.firstOrNull { it.id == id }?.label } ?: LiveStrings.SUBTITLES_OFF
        val voiceLabel = voices.firstOrNull { it.id == selectedVoice }?.name ?: LiveStrings.VOICE
        Box(Modifier.fillMaxSize().alpha(if (overlayVisible || problem != null) 1f else 0f)) {
            Box(Modifier.fillMaxSize().background(OVERLAY_GRADIENT))
            OnAirHeader(channel, details, clock, clockVisible = panel == null, modifier = Modifier.align(Alignment.TopStart))
            Column(
                Modifier
                    .align(Alignment.BottomStart)
                    .fillMaxWidth()
                    .padding(horizontal = SeansSpace.SafeX, vertical = SeansSpace.SafeY),
            ) {
                LockedTimeline(channel, clock)
                LockLine()
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
                    LiveButton(LiveIcons.List, LiveStrings.PROGRAMME, Modifier.focusRequester(mainFocus)) { onPanel(Panel.PROGRAMME) }
                    if (!youtube && voices.size > 1) {
                        LiveButton(LiveIcons.Headphones, voiceLabel) { onPanel(Panel.VOICE) }
                    }
                    if (subtitleOptions.isNotEmpty()) {
                        LiveButton(LiveIcons.Subtitles, subtitleLabel) { onPanel(Panel.SUBTITLES) }
                    }
                    LiveButton(if (muted) LiveIcons.VolumeOff else LiveIcons.Volume, if (muted) LiveStrings.SOUND_OFF else LiveStrings.SOUND, onClick = onMute)
                    Spacer(Modifier.weight(1f))
                    if (ref != null) LiveButton(LiveIcons.Info, LiveStrings.ABOUT) { onOpenDetails(ref) }
                }
            }
        }

        AnimatedVisibility(
            visible = panel == Panel.VOICE || panel == Panel.SUBTITLES,
            modifier = Modifier.align(Alignment.CenterEnd),
            enter = slideInHorizontally { it / 10 } + fadeIn(),
            exit = slideOutHorizontally { it / 10 } + fadeOut(),
        ) {
            if (panel == Panel.VOICE) {
                OptionPanel(LiveStrings.VOICE, voices.map { Option(it.id, it.name) }, selectedVoice, allowOff = false) { id ->
                    if (id != null) controls.selectVoice(id)
                    onPanel(null)
                }
            } else {
                OptionPanel(LiveStrings.SUBTITLES, subtitleOptions, subtitleSelected, allowOff = true) { id ->
                    if (youtube) captionLanguage = id else controls.selectSubtitle(id)
                    onPanel(null)
                }
            }
        }
    }
}

private data class Option(val id: String?, val label: String)

/** A side panel of choices (voice, subtitles), the current one marked, focus on it. */
@Composable
private fun OptionPanel(title: String, options: List<Option>, selected: String?, allowOff: Boolean, onPick: (String?) -> Unit) {
    val all = if (allowOff) listOf(Option(null, LiveStrings.SUBTITLES_OFF)) + options else options
    val focusIndex = all.indexOfFirst { it.id == selected }.coerceAtLeast(0)
    val focus = remember { FocusRequester() }
    Column(
        Modifier
            .fillMaxHeight()
            .width(380.dp)
            .background(Color(0xF7121214))
            .padding(start = 24.dp, end = SeansSpace.SafeX, top = SeansSpace.SafeY, bottom = SeansSpace.SafeY),
    ) {
        Text(title, color = SeansColors.Text, fontSize = SeansType.Section, fontWeight = FontWeight.Bold, modifier = Modifier.padding(bottom = 10.dp))
        LazyColumn(verticalArrangement = Arrangement.spacedBy(4.dp)) {
            itemsIndexed(all, key = { _, option -> option.id ?: "off" }) { index, option ->
                Surface(
                    onClick = { onPick(option.id) },
                    modifier = Modifier.fillMaxWidth().heightIn(min = 44.dp).then(if (index == focusIndex) Modifier.focusRequester(focus) else Modifier),
                    shape = ClickableSurfaceDefaults.shape(RoundedCornerShape(SeansRadius.Md)),
                    scale = ClickableSurfaceDefaults.scale(focusedScale = 1f),
                    colors = ClickableSurfaceDefaults.colors(
                        containerColor = if (option.id == selected) Color.White.copy(alpha = 0.08f) else Color.Transparent,
                        contentColor = SeansColors.Text,
                        focusedContainerColor = SeansColors.Text,
                        focusedContentColor = SeansColors.OnFocus,
                        pressedContainerColor = SeansColors.Text,
                        pressedContentColor = SeansColors.OnFocus,
                    ),
                ) {
                    Row(Modifier.padding(horizontal = 12.dp, vertical = 6.dp), verticalAlignment = Alignment.CenterVertically) {
                        Text(option.label, fontSize = SeansType.Body, fontWeight = FontWeight.SemiBold, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f))
                        if (option.id == selected) Text("✓", fontSize = SeansType.Body, fontWeight = FontWeight.Bold)
                    }
                }
            }
        }
    }
    LaunchedEffect(Unit) {
        withFrameNanos { }
        runCatching { focus.requestFocus() }
    }
}

@Composable
private fun OnAirHeader(channel: Channel, details: TitleDetails?, clock: ServerClock, clockVisible: Boolean, modifier: Modifier = Modifier) {
    Row(modifier.fillMaxWidth().padding(horizontal = SeansSpace.SafeX, vertical = SeansSpace.SafeY), verticalAlignment = Alignment.Top) {
        Column(Modifier.weight(1f)) {
            LiveBadge(paused = channel.mediaPausedAtSec.isFinite())
            Spacer(Modifier.height(8.dp))
            Text(displayTitle(channel), color = Color.White, fontSize = SeansType.Heading, fontWeight = FontWeight.Bold, maxLines = 1, overflow = TextOverflow.Ellipsis)
            val line = listOfNotNull(
                details?.summary?.year?.toString(),
                details?.summary?.genres?.firstOrNull(),
                slotCaption(channel)?.takeIf { channel.movie?.isEpisode == true || channel.isLiveStream },
            ).joinToString(" · ")
            if (line.isNotEmpty()) {
                Text(line, color = Color.White.copy(alpha = 0.78f), fontSize = SeansType.Small, modifier = Modifier.padding(top = 3.dp), maxLines = 1)
            }
        }
        // A side panel covers the top-right corner; the clock steps aside instead of showing through.
        if (clockVisible) WallClock(clock)
    }
}

@Composable
private fun WallClock(clock: ServerClock) {
    val now = rememberServerNow(clock)
    Text(hhmm(now), color = Color.White.copy(alpha = 0.9f), fontSize = 18.sp, fontWeight = FontWeight.SemiBold)
}

@Composable
private fun LiveBadge(paused: Boolean, small: Boolean = false) {
    Row(
        Modifier
            .height(if (small) 20.dp else 22.dp)
            .clip(RoundedCornerShape(SeansRadius.Sm))
            .background(Color(0xB8090909))
            .padding(horizontal = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        Box(Modifier.size(8.dp).clip(RoundedCornerShape(SeansRadius.Xs)).background(if (paused) SeansColors.Text2 else SeansColors.Danger))
        Text(
            (if (paused) LiveStrings.BADGE_PAUSED else if (small) LiveStrings.TITLE else LiveStrings.BADGE_LIVE).uppercase(),
            color = Color.White, fontSize = if (small) 11.sp else SeansType.Micro, fontWeight = FontWeight.Bold, letterSpacing = 0.7.sp,
        )
    }
}

/** From the slot's start to its end, no knob: nobody can seek a broadcast. */
@Composable
private fun LockedTimeline(channel: Channel, clock: ServerClock) {
    val now = rememberServerNow(clock)
    val bounds = remember(channel, now.toLong() / 1000) {
        if (channel.scheduled) playbackBounds(channel, now) else {
            val start = playbackAnchorMs(channel, now)
            getScheduleBounds(channel).copy(startMs = start, endMs = if (channel.mediaDurationSec > 0) start + channel.mediaDurationSec * 1000.0 else Double.POSITIVE_INFINITY)
        }
    }
    val fraction = if (bounds.endMs.isFinite() && bounds.endMs > bounds.startMs) ((now - bounds.startMs) / (bounds.endMs - bounds.startMs)).coerceIn(0.0, 1.0).toFloat() else 0f
    Column(Modifier.fillMaxWidth().padding(bottom = 14.dp)) {
        Box(Modifier.fillMaxWidth().height(5.dp).clip(RoundedCornerShape(50)).background(Color.White.copy(alpha = 0.24f))) {
            if (fraction > 0f) Box(Modifier.fillMaxWidth(fraction).fillMaxHeight().clip(RoundedCornerShape(50)).background(Color.White))
        }
        Row(Modifier.fillMaxWidth().padding(top = 8.dp)) {
            val paused = channel.mediaPausedAtSec
            val startLabel = when {
                channel.isLiveStream && bounds.startMs.isFinite() -> "${hhmm(bounds.startMs)} ${LiveStrings.STARTS}"
                paused.isFinite() -> "${LiveStrings.PAUSED_AT} ${formatClock(Math.floor(paused).toLong())}"
                bounds.startMs.isFinite() -> "${hhmm(bounds.startMs)} ${LiveStrings.STARTS}"
                else -> ""
            }
            Text(startLabel, color = Color.White.copy(alpha = 0.82f), fontSize = SeansType.Caption, fontWeight = FontWeight.SemiBold)
            Spacer(Modifier.weight(1f))
            val endLabel = if (bounds.endMs.isFinite()) "${hhmm(bounds.endMs)} ${LiveStrings.ENDS}" else if (channel.isLiveStream) LiveStrings.STREAM else ""
            Text(endLabel, color = Color.White.copy(alpha = 0.82f), fontSize = SeansType.Caption, fontWeight = FontWeight.SemiBold)
        }
    }
}

@Composable
private fun LockLine() {
    Row(Modifier.padding(bottom = 14.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        Icon(LiveIcons.Lock, contentDescription = null, tint = Color.White.copy(alpha = 0.72f), modifier = Modifier.size(16.dp))
        Text(LiveStrings.LOCK_LINE, color = Color.White.copy(alpha = 0.72f), fontSize = SeansType.Caption, maxLines = 1, overflow = TextOverflow.Ellipsis)
    }
}

@Composable
private fun LiveButton(icon: ImageVector, label: String, modifier: Modifier = Modifier, onClick: () -> Unit) {
    Surface(
        onClick = onClick,
        modifier = modifier.height(40.dp),
        shape = ClickableSurfaceDefaults.shape(RoundedCornerShape(SeansRadius.Md)),
        scale = ClickableSurfaceDefaults.scale(focusedScale = 1.08f),
        colors = ClickableSurfaceDefaults.colors(
            containerColor = SeansColors.Control,
            contentColor = Color.White,
            focusedContainerColor = Color.White,
            focusedContentColor = SeansColors.OnFocus,
            pressedContainerColor = Color.White,
            pressedContentColor = SeansColors.OnFocus,
        ),
    ) {
        Row(Modifier.fillMaxHeight().padding(horizontal = 14.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Icon(icon, contentDescription = null, modifier = Modifier.size(20.dp))
            Text(label, fontSize = SeansType.Small, fontWeight = FontWeight.SemiBold, maxLines = 1)
        }
    }
}

@Composable
private fun CenterNote(text: String) {
    Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
        Text(text, color = SeansColors.Text2, fontSize = SeansType.Body)
    }
}

@Composable
private fun InfoCard(title: String, text: String?) {
    Column(
        Modifier
            .widthIn(max = 440.dp)
            .clip(RoundedCornerShape(SeansRadius.Lg))
            .background(SeansColors.Bg3)
            .padding(24.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Text(title, color = SeansColors.Text, fontSize = SeansType.Section, fontWeight = FontWeight.Bold)
        if (text != null) Text(text, color = SeansColors.Text2, fontSize = SeansType.Small, modifier = Modifier.padding(top = 8.dp))
    }
}

/** Off air: the channel's standby card, with the next show's countdown when one is planned. */
@Composable
private fun BoxScope.StandbyLayer(model: StandbyModel, clock: ServerClock, mainFocus: FocusRequester, clockVisible: Boolean, onProgramme: () -> Unit) {
    Box(Modifier.fillMaxSize().background(Brush.verticalGradient(listOf(SeansColors.Bg2, SeansColors.Bg))))
    if (clockVisible) {
        Row(Modifier.align(Alignment.TopEnd).padding(horizontal = SeansSpace.SafeX, vertical = SeansSpace.SafeY)) { WallClock(clock) }
    }
    Column(
        Modifier.align(Alignment.CenterStart).padding(horizontal = SeansSpace.SafeX).widthIn(max = 560.dp),
        verticalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        Text(model.label.uppercase(), color = SeansColors.Text3, fontSize = SeansType.Micro, fontWeight = FontWeight.Bold, letterSpacing = 0.7.sp)
        Text(model.title, color = SeansColors.Text, fontSize = 32.sp, fontWeight = FontWeight.Bold)
        Text(model.text, color = SeansColors.Text2, fontSize = SeansType.Body)
        val next = model.next
        if (next != null) {
            Spacer(Modifier.height(10.dp))
            Text(LiveStrings.COUNTDOWN, color = SeansColors.Text3, fontSize = SeansType.Caption)
            Countdown(next.startedAtMs, clock)
            Text("${LiveStrings.NEXT} · ${hhmm(next.startedAtMs)}", color = SeansColors.Text3, fontSize = SeansType.Caption)
            Text(displayTitle(next), color = SeansColors.Text, fontSize = SeansType.Section, fontWeight = FontWeight.SemiBold)
            slotCaption(next)?.let { Text(it, color = SeansColors.Text2, fontSize = SeansType.Small) }
        } else if (model.noTimeHint != null) {
            Text(model.noTimeHint, color = SeansColors.Text3, fontSize = SeansType.Small)
        }
    }
    Row(Modifier.align(Alignment.BottomStart).padding(horizontal = SeansSpace.SafeX, vertical = SeansSpace.SafeY)) {
        LiveButton(LiveIcons.List, LiveStrings.PROGRAMME, Modifier.focusRequester(mainFocus), onClick = onProgramme)
    }
}

@Composable
private fun Countdown(targetMs: Double, clock: ServerClock) {
    val now = rememberServerNow(clock)
    val seconds = maxOf(0L, Math.ceil((targetMs - now) / 1000).toLong())
    Text(formatClock(seconds), color = SeansColors.Text, fontSize = SeansType.Display, fontWeight = FontWeight.Bold)
}

/** «Программа на сегодня»: today's slots, the one on air marked (mockup screen 10). */
@Composable
private fun ProgrammePanel(data: LiveData, clock: ServerClock, onOpenDetails: (TitleRef) -> Unit) {
    val now = rememberServerNow(clock)
    val minute = now.toLong() / 60_000
    val model = remember(data, minute) {
        val manual = data.manual
        if (manual == null) null else {
            val channel = resolveChannel(manual, data.schedule, now)
            val position = computePosition(channel, now)
            programmeModel(projectPausedSchedule(data.schedule, channel, now), channel, position, now)
        }
    }
    val rows = model?.rows.orEmpty()
    val listState = rememberLazyListState()
    val firstFocus = remember { FocusRequester() }
    val focusIndex = rows.indexOfFirst { it.status == SlotStatus.CURRENT }.takeIf { it >= 0 }
        ?: rows.indexOfFirst { it.status == SlotStatus.NEXT || it.status == SlotStatus.LATER }.takeIf { it >= 0 } ?: 0

    Column(
        Modifier
            .fillMaxHeight()
            .width(380.dp)
            .background(Color(0xF7121214))
            .padding(start = 24.dp, end = SeansSpace.SafeX, top = SeansSpace.SafeY, bottom = SeansSpace.SafeY),
    ) {
        Text(LiveStrings.PROGRAMME_TODAY, color = SeansColors.Text, fontSize = SeansType.Section, fontWeight = FontWeight.Bold, modifier = Modifier.padding(bottom = 10.dp))
        if (data.scheduleError && data.scheduleReady) {
            Text(LiveStrings.PROGRAMME_STALE, color = SeansColors.Text3, fontSize = SeansType.Micro, modifier = Modifier.padding(bottom = 8.dp))
        }
        if (rows.isEmpty()) {
            val (title, text) = if (!data.scheduleReady) LiveStrings.PROGRAMME_LOADING to null else LiveStrings.PROGRAMME_EMPTY to LiveStrings.PROGRAMME_EMPTY_TEXT
            Text(title, color = SeansColors.Text2, fontSize = SeansType.Body)
            if (text != null) Text(text, color = SeansColors.Text3, fontSize = SeansType.Small, modifier = Modifier.padding(top = 4.dp))
            // Something must hold focus while the panel is open (D2).
            Surface(onClick = {}, modifier = Modifier.size(1.dp).focusRequester(firstFocus)) {}
        } else {
            LazyColumn(state = listState, verticalArrangement = Arrangement.spacedBy(4.dp)) {
                itemsIndexed(rows, key = { _, row -> row.item.identity }) { index, row ->
                    ProgrammeRowItem(
                        startMs = row.startMs,
                        title = displayTitle(row.item),
                        caption = if (row.status == SlotStatus.CURRENT) currentCaption(row.endMs, now) else slotCaption(row.item),
                        status = row.status,
                        modifier = if (index == focusIndex) Modifier.focusRequester(firstFocus) else Modifier,
                        onClick = { row.item.titleRef()?.let(onOpenDetails) },
                    )
                }
            }
        }
    }
    LaunchedEffect(Unit) {
        if (rows.isNotEmpty()) listState.scrollToItem(focusIndex)
        runCatching { firstFocus.requestFocus() }
    }
}

private fun currentCaption(endMs: Double, nowMs: Double): String =
    if (endMs.isFinite()) "сейчас · ещё ${formatLength(maxOf(0L, ((endMs - nowMs) / 1000).toLong()))}" else "сейчас · ${LiveStrings.STREAM}"

@Composable
private fun ProgrammeRowItem(startMs: Double, title: String, caption: String?, status: SlotStatus, modifier: Modifier, onClick: () -> Unit) {
    val past = status == SlotStatus.FINISHED || status == SlotStatus.NOT_ON_AIR
    Surface(
        onClick = onClick,
        modifier = modifier.fillMaxWidth().heightIn(min = 50.dp).alpha(if (past) 0.4f else 1f),
        shape = ClickableSurfaceDefaults.shape(RoundedCornerShape(SeansRadius.Md)),
        scale = ClickableSurfaceDefaults.scale(focusedScale = 1f),
        colors = ClickableSurfaceDefaults.colors(
            containerColor = if (status == SlotStatus.CURRENT) Color.White.copy(alpha = 0.08f) else Color.Transparent,
            contentColor = SeansColors.Text,
            focusedContainerColor = SeansColors.Text,
            focusedContentColor = SeansColors.OnFocus,
            pressedContainerColor = SeansColors.Text,
            pressedContentColor = SeansColors.OnFocus,
        ),
    ) {
        Row(Modifier.padding(horizontal = 12.dp, vertical = 6.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            Text(hhmm(startMs), fontSize = SeansType.Small, fontWeight = FontWeight.SemiBold, modifier = Modifier.width(42.dp))
            Column(Modifier.weight(1f)) {
                Text(title, fontSize = SeansType.Body, fontWeight = FontWeight.SemiBold, maxLines = 1, overflow = TextOverflow.Ellipsis)
                if (caption != null) Text(caption, fontSize = SeansType.Micro, maxLines = 1, overflow = TextOverflow.Ellipsis,
                    modifier = Modifier.alpha(0.75f))
            }
            if (status == SlotStatus.CURRENT) LiveBadge(paused = false, small = true)
        }
    }
}

private const val OVERLAY_HIDE_MS = 6_000L
private const val DETAILS_WAIT_MS = 4_000L
private val OVERLAY_GRADIENT = Brush.verticalGradient(
    0f to Color.Black.copy(alpha = 0.72f),
    0.28f to Color.Transparent,
    0.52f to Color.Transparent,
    1f to Color.Black.copy(alpha = 0.86f),
)
