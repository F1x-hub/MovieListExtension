package app.seans.tv.player.ui

import androidx.compose.animation.core.animateDpAsState
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.focusable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxScope
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusProperties
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import app.seans.tv.designsystem.SText
import app.seans.tv.designsystem.SeansIcons
import app.seans.tv.designsystem.SeansRadius
import app.seans.tv.designsystem.SeansSpace
import app.seans.tv.designsystem.SeansText
import app.seans.tv.player.engine.PlaybackEngine
import app.seans.tv.player.session.PlayerUiState
import java.time.LocalTime
import java.time.format.DateTimeFormatter
import kotlinx.coroutines.delay

/** Focus targets of the controls, owned by the screen so it can move focus between them. */
internal class ControlFocus {
    val bar = FocusRequester()
    val menu = FocusRequester()
    val play = FocusRequester()
    val quality = FocusRequester()
    val gear = FocusRequester()
}

/**
 * The controls in the ergonomics of Lampa's player (the owner's reference photo): the title and
 * small labels at the top left, the clock and «Конец в …» at the top right, a thin progress bar the
 * width of the safe area, and one row under it: «≡» on the left, play/pause in the centre,
 * quality and settings on the right. Seeking is done on the bar, not with buttons.
 */
@Composable
internal fun BoxScope.LampaControls(
    state: PlayerUiState,
    engine: PlaybackEngine,
    focus: ControlFocus,
    scrubTargetMs: Long?,
    onBarFocused: (Boolean) -> Unit,
    onMenu: () -> Unit,
    onTogglePause: () -> Unit,
    onQuality: () -> Unit,
    onSettings: () -> Unit,
) {
    Box(
        Modifier.fillMaxSize().background(
            Brush.verticalGradient(
                0f to Color(0xB8000000), 0.26f to Color.Transparent, 0.6f to Color.Transparent, 1f to Color(0xE0000000),
            ),
        ),
    )
    TopInfo(state, engine)
    Column(
        Modifier
            .align(Alignment.BottomStart)
            .fillMaxWidth()
            .padding(start = SeansSpace.SafeX, end = SeansSpace.SafeX, bottom = SeansSpace.SafeY),
    ) {
        ProgressSection(engine, focus, scrubTargetMs, onBarFocused)
        Spacer(Modifier.height(12.dp))
        Box(Modifier.fillMaxWidth()) {
            PlayerButton(
                onClick = onMenu,
                modifier = Modifier.align(Alignment.CenterStart).focusRequester(focus.menu).focusProperties { up = focus.bar },
                icon = SeansIcons.List,
            )
            PlayPause(
                engine = engine,
                ended = state.ended,
                onClick = onTogglePause,
                modifier = Modifier.align(Alignment.Center).focusRequester(focus.play).focusProperties { up = focus.bar },
            )
            Row(Modifier.align(Alignment.CenterEnd), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                PlayerButton(
                    onClick = onQuality,
                    modifier = Modifier.focusRequester(focus.quality).focusProperties { up = focus.bar },
                    text = state.qualities.getOrNull(state.qualityIndex) ?: "AUTO",
                )
                PlayerButton(
                    onClick = onSettings,
                    modifier = Modifier.focusRequester(focus.gear).focusProperties { up = focus.bar },
                    icon = SeansIcons.Settings,
                )
            }
        }
    }
}

@Composable
private fun BoxScope.TopInfo(state: PlayerUiState, engine: PlaybackEngine) {
    Row(
        Modifier.align(Alignment.TopStart).fillMaxWidth().padding(horizontal = SeansSpace.SafeX, vertical = SeansSpace.SafeY),
        verticalAlignment = Alignment.Top,
    ) {
        Column(Modifier.weight(1f)) {
            SText(state.title, SeansText.Heading.copy(fontSize = 28.sp), maxLines = 1)
            Spacer(Modifier.height(10.dp))
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
                state.episode?.let { ep ->
                    Chip(listOfNotNull("С${ep.season}", "Е${ep.episode}", state.episodeTitle).joinToString(" · "))
                }
                PlayingHeight(engine)
                state.option?.providerId?.label?.let { Chip(it) }
                state.voices.firstOrNull { it.id == state.voiceId }?.name?.let { Chip(it) }
            }
        }
        Column(horizontalAlignment = Alignment.End) {
            PlayerClock()
            Spacer(Modifier.height(2.dp))
            EndsAt(engine)
        }
    }
}

/** A small translucent label (radius 4): «1080p», «Collaps», «LostFilm». */
@Composable
private fun Chip(text: String) {
    Box(
        Modifier
            .clip(RoundedCornerShape(SeansRadius.Sm))
            .background(Color(0x33FFFFFF))
            .padding(horizontal = 8.dp, vertical = 3.dp),
    ) {
        SText(text, SeansText.CaptionStrong.copy(fontSize = 13.sp), color = Color.White, maxLines = 1)
    }
}

/** The height of the variant playing now, polled once a second. */
@Composable
private fun PlayingHeight(engine: PlaybackEngine) {
    var height by remember { mutableIntStateOf(engine.videoHeight) }
    LaunchedEffect(engine) {
        while (true) {
            height = engine.videoHeight
            delay(1_000)
        }
    }
    if (height > 0) Chip("${height}p")
}

/** «Конец в 03:37»: now plus the time left, at the playback speed. */
@Composable
private fun EndsAt(engine: PlaybackEngine) {
    var text by remember { mutableStateOf<String?>(null) }
    LaunchedEffect(engine) {
        while (true) {
            val left = engine.durationMs - engine.positionMs
            text = if (engine.durationMs > 0 && left > 0) {
                val speed = engine.speed.takeIf { it > 0f } ?: 1f
                "Конец в " + LocalTime.now().plusSeconds((left / 1000 / speed).toLong()).format(HourMinute)
            } else {
                null
            }
            delay(10_000)
        }
    }
    text?.let { SText(it, SeansText.CaptionStrong.copy(fontSize = 13.sp), color = Color(0xD9FFFFFF), maxLines = 1) }
}

private val HourMinute: DateTimeFormatter = DateTimeFormatter.ofPattern("HH:mm")

/**
 * The times above the bar and the bar itself. Focusable: the screen handles Left/Right (scrubbing)
 * and OK (pause) while it has focus. While scrubbing, the target time floats above its marker.
 */
@Composable
private fun ProgressSection(
    engine: PlaybackEngine,
    focus: ControlFocus,
    scrubTargetMs: Long?,
    onBarFocused: (Boolean) -> Unit,
) {
    var position by remember { mutableLongStateOf(engine.positionMs) }
    var duration by remember { mutableLongStateOf(engine.durationMs) }
    var buffered by remember { mutableLongStateOf(engine.bufferedMs) }
    var focused by remember { mutableStateOf(false) }
    LaunchedEffect(engine) {
        while (true) {
            position = engine.positionMs
            duration = engine.durationMs
            buffered = engine.bufferedMs
            delay(250)
        }
    }
    Row(Modifier.fillMaxWidth().padding(bottom = 8.dp), verticalAlignment = Alignment.Bottom) {
        // While scrubbing, the target time above the marker takes the elapsed time's place.
        SText(
            formatClockTime(position), SeansText.CaptionStrong.copy(fontSize = 14.sp),
            Modifier.alpha(if (scrubTargetMs == null) 1f else 0f), color = Color.White, maxLines = 1,
        )
        Spacer(Modifier.weight(1f))
        if (duration > 0) {
            SText(
                "${formatClockTime(duration)} · Осталось ${formatLeft(duration - position)}",
                SeansText.CaptionStrong.copy(fontSize = 14.sp), color = Color.White, maxLines = 1,
            )
        }
    }
    val barHeight by animateDpAsState(if (focused) 6.dp else 4.dp, tween(150), label = "bar")
    BoxWithConstraints(
        Modifier
            .fillMaxWidth()
            .height(22.dp)
            .focusRequester(focus.bar)
            .focusProperties {
                down = focus.play
                up = FocusRequester.Cancel
            }
            .onFocusChanged {
                focused = it.isFocused
                onBarFocused(it.isFocused)
            }
            .focusable(),
        contentAlignment = Alignment.CenterStart,
    ) {
        val d = duration.coerceAtLeast(1).toFloat()
        val played = if (duration > 0) position / d else 0f
        val loaded = if (duration > 0) buffered / d else 0f
        val target = scrubTargetMs?.let { if (duration > 0) it / d else null }
        Box(
            Modifier
                .fillMaxWidth()
                .height(barHeight)
                .drawBehind {
                    val r = CornerRadius(size.height / 2)
                    drawRoundRect(Color(0x3DFFFFFF), cornerRadius = r)
                    drawRoundRect(Color(0x66FFFFFF), size = Size(size.width * loaded.coerceIn(0f, 1f), size.height), cornerRadius = r)
                    drawRoundRect(Color.White, size = Size(size.width * played.coerceIn(0f, 1f), size.height), cornerRadius = r)
                    val markerAt = target ?: played.takeIf { focused }
                    if (markerAt != null) {
                        val k = 14.dp.toPx()
                        drawRoundRect(
                            Color.White,
                            topLeft = Offset(size.width * markerAt.coerceIn(0f, 1f) - k / 2, size.height / 2 - k / 2),
                            size = Size(k, k),
                            cornerRadius = CornerRadius(SeansRadius.Xs.toPx()),
                        )
                    }
                },
        )
        if (target != null && scrubTargetMs != null) {
            // The target time above the marker, kept inside the bar's width.
            val labelWidth = 92.dp
            val x = (maxWidth * target.coerceIn(0f, 1f) - labelWidth / 2).coerceIn(0.dp, maxWidth - labelWidth)
            Box(
                Modifier
                    .offset(x = x, y = (-30).dp)
                    .clip(RoundedCornerShape(SeansRadius.Sm))
                    .background(Color.White)
                    .padding(horizontal = 8.dp, vertical = 3.dp),
                contentAlignment = Alignment.Center,
            ) {
                SText(formatClockTime(scrubTargetMs), SeansText.Button.copy(fontSize = 14.sp, fontWeight = FontWeight.Bold), color = Color(0xFF09090B), maxLines = 1)
            }
        }
    }
}

@Composable
private fun PlayPause(engine: PlaybackEngine, ended: Boolean, onClick: () -> Unit, modifier: Modifier) {
    var playing by remember { mutableStateOf(engine.playWhenReady) }
    LaunchedEffect(engine) {
        while (true) {
            playing = engine.playWhenReady
            delay(200)
        }
    }
    PlayerButton(onClick = onClick, modifier = modifier, icon = if (playing && !ended) SeansIcons.Pause else SeansIcons.Play, main = true)
}

/** «00:00:20», «02:29:41». */
internal fun formatClockTime(ms: Long): String {
    val total = (ms / 1000).coerceAtLeast(0)
    return "%02d:%02d:%02d".format(total / 3600, (total % 3600) / 60, total % 60)
}

/** «2 ч 29 мин», «12 мин», «40 с». */
internal fun formatLeft(ms: Long): String {
    val total = (ms / 1000).coerceAtLeast(0)
    val h = total / 3600
    val m = (total % 3600) / 60
    return when {
        h > 0 -> "$h ч $m мин"
        m > 0 -> "$m мин"
        else -> "$total с"
    }
}
