package app.seans.tv.designsystem

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxScope
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.Stable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.delay

/** A short message at the bottom centre, gone after 1.8 s. One at a time; a new one replaces it. */
@Stable
class ToastState {
    var message by mutableStateOf<String?>(null)
        private set
    internal var serial by mutableLongStateOf(0L)
        private set

    fun show(text: String) {
        message = text
        serial++
    }

    internal fun hide() { message = null }
}

@Composable
fun rememberToastState(): ToastState = remember { ToastState() }

@Composable
fun BoxScope.ToastHost(state: ToastState) {
    val message = state.message
    LaunchedEffect(state.serial) {
        if (state.message != null) {
            delay(1800)
            state.hide()
        }
    }
    AnimatedVisibility(
        visible = message != null,
        modifier = Modifier.align(Alignment.BottomCenter).padding(bottom = 28.dp),
        enter = fadeIn(tween(160)),
        exit = fadeOut(tween(160)),
    ) {
        Box(
            Modifier
                .clip(RoundedCornerShape(SeansRadius.Md))
                .background(SeansColors.Toast)
                .padding(horizontal = 16.dp, vertical = 10.dp),
        ) {
            SText(message ?: "", SeansText.Button.copy(fontSize = SeansType.Small), maxLines = 1)
        }
    }
}

/**
 * The player timeline: track, buffered part, played part and an optional square knob, with the
 * two time labels under it. Fractions are lambdas read in the draw phase, so a playing video
 * redraws the bar without recomposing the controls.
 */
@Composable
fun TimelineBar(
    played: () -> Float,
    modifier: Modifier = Modifier,
    buffered: (() -> Float)? = null,
    knob: Boolean = true,
    startLabel: String? = null,
    endLabel: String? = null,
) {
    Column(modifier.padding(bottom = 14.dp)) {
        Box(
            Modifier
                .fillMaxWidth()
                .height(5.dp)
                .drawBehind {
                    val r = CornerRadius(size.height / 2)
                    drawRoundRect(Color(0x3DFFFFFF), cornerRadius = r)
                    buffered?.let { b -> drawRoundRect(Color(0x66FFFFFF), size = Size(size.width * b().coerceIn(0f, 1f), size.height), cornerRadius = r) }
                    val p = played().coerceIn(0f, 1f)
                    drawRoundRect(Color.White, size = Size(size.width * p, size.height), cornerRadius = r)
                    if (knob) {
                        val k = 14.dp.toPx()
                        drawRoundRect(
                            Color.White,
                            topLeft = Offset(size.width * p - k / 2, size.height / 2 - k / 2),
                            size = Size(k, k),
                            cornerRadius = CornerRadius(SeansRadius.Xs.toPx()),
                        )
                    }
                },
        )
        if (startLabel != null || endLabel != null) {
            Spacer(Modifier.height(8.dp))
            Row(Modifier.fillMaxWidth()) {
                SText(startLabel ?: "", SeansText.CaptionStrong, color = Color(0xD1FFFFFF), maxLines = 1)
                Spacer(Modifier.weight(1f))
                SText(endLabel ?: "", SeansText.CaptionStrong, color = Color(0xD1FFFFFF), maxLines = 1)
            }
        }
    }
}
