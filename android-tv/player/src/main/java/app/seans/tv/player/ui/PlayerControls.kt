package app.seans.tv.player.ui

import androidx.annotation.DrawableRes
import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.scale
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import app.seans.tv.designsystem.SText
import app.seans.tv.designsystem.SeansColors
import app.seans.tv.designsystem.SeansIcon
import app.seans.tv.designsystem.SeansMotion
import app.seans.tv.designsystem.SeansRadius
import app.seans.tv.designsystem.SeansText
import app.seans.tv.designsystem.rememberFocusInteraction
import app.seans.tv.designsystem.seansClickable
import java.time.LocalTime
import java.time.format.DateTimeFormatter
import kotlinx.coroutines.delay

/**
 * The mockup's `.pbtn`: 40 dp (48 dp for the main one), translucent at rest, white with
 * `scale 1.08` when focused. Private to the player until `:core:designsystem` has one.
 */
@Composable
internal fun PlayerButton(
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    @DrawableRes icon: Int? = null,
    text: String? = null,
    main: Boolean = false,
    flipIcon: Boolean = false,
) {
    val interaction = rememberFocusInteraction()
    val focused = interaction.focused
    val fill by animateColorAsState(if (focused) Color.White else Color(0x1AFFFFFF), tween(SeansMotion.Focus), label = "pbtn")
    val content = if (focused) SeansColors.OnFocus else Color.White
    val size: Dp = if (main) 48.dp else 40.dp
    Box(
        modifier
            .seansClickable(interaction, 1.08f, onClick = onClick)
            .height(size)
            .widthIn(min = size)
            .clip(RoundedCornerShape(SeansRadius.Md))
            .background(fill)
            .padding(horizontal = if (text != null) 14.dp else 0.dp),
        contentAlignment = Alignment.Center,
    ) {
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
            if (icon != null) {
                SeansIcon(icon, Modifier.then(if (flipIcon) Modifier.scale(scaleX = -1f, scaleY = 1f) else Modifier), tint = content, size = if (main) 24.dp else 20.dp)
            }
            if (text != null) SText(text, SeansText.Button.copy(fontSize = app.seans.tv.designsystem.SeansType.Small), color = content, maxLines = 1)
        }
    }
}

/** The clock at the top right; ticks in its own scope so nothing else recomposes. */
@Composable
internal fun PlayerClock(modifier: Modifier = Modifier) {
    var now by remember { mutableStateOf(LocalTime.now()) }
    LaunchedEffect(Unit) {
        while (true) {
            now = LocalTime.now()
            delay(((60 - now.second) * 1_000L).coerceAtLeast(1_000L))
        }
    }
    SText(now.format(ClockFormat), SeansText.Brand.copy(fontWeight = androidx.compose.ui.text.font.FontWeight.SemiBold), modifier, color = Color(0xE6FFFFFF), maxLines = 1)
}

private val ClockFormat: DateTimeFormatter = DateTimeFormatter.ofPattern("HH:mm")

/** A spinner (one of the two allowed circles besides the avatar). */
@Composable
internal fun Spinner(modifier: Modifier = Modifier, size: Dp = 36.dp) {
    val transition = rememberInfiniteTransition(label = "spin")
    val angle by transition.animateFloat(0f, 360f, infiniteRepeatable(tween(900, easing = LinearEasing), RepeatMode.Restart), label = "angle")
    Canvas(modifier.size(size)) {
        val stroke = 3.dp.toPx()
        drawArc(Color(0x33FFFFFF), 0f, 360f, false, style = Stroke(stroke))
        drawArc(Color.White, angle, 90f, false, style = Stroke(stroke, cap = StrokeCap.Round))
    }
}

/** «14:20», «1:12:40». */
internal fun formatTime(ms: Long): String {
    val total = (ms / 1000).coerceAtLeast(0)
    val h = total / 3600
    val m = (total % 3600) / 60
    val s = total % 60
    return if (h > 0) "%d:%02d:%02d".format(h, m, s) else "%d:%02d".format(m, s)
}
