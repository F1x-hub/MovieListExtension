package app.seans.tv.designsystem

import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.tween
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsFocusedAsState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.State
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.drawWithContent
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.role
import androidx.compose.ui.unit.Dp

/**
 * The one focus behaviour of the app: the focused control turns white (or gets a white ring, for
 * pictures) and grows a little. Everything focusable is built on [rememberFocusInteraction] and
 * [seansClickable], so every screen behaves the same.
 */
class FocusInteraction(val source: MutableInteractionSource, focused: State<Boolean>) {
    val focused: Boolean by focused
}

@Composable
fun rememberFocusInteraction(): FocusInteraction {
    val source = remember { MutableInteractionSource() }
    val focused = source.collectIsFocusedAsState()
    return remember(source) { FocusInteraction(source, focused) }
}

/**
 * Scale on focus plus a click on OK/Enter (foundation's `clickable` handles the D-pad centre key).
 * The scale is read in the layer, so a focus change redraws without recomposing the parent.
 *
 * The scale snaps instead of animating. Measured on the TCL (release, atrace): with an animated
 * scale, every text inside the control was re-rasterised at a new size on each animation frame
 * (Skia `AtlasTextOp`, ~30 ms of RenderThread time per frame), the main jank source on Home. The
 * fill colour and the picture ring still fade; colour changes do not re-rasterise glyphs.
 *
 * [description] makes the control one accessibility node (its texts and badges are cleared below
 * it). The TCL TV keeps a vendor accessibility service on, so Compose diffs the whole semantics tree
 * on the main thread after every focus change and scroll frame; one node per control instead of
 * one per text keeps that cheap, and a screen reader still reads the description.
 */
@Composable
fun Modifier.seansClickable(
    interaction: FocusInteraction,
    focusedScale: Float,
    enabled: Boolean = true,
    description: String? = null,
    onClick: () -> Unit,
): Modifier {
    val focused = interaction.focused
    val scale = if (focused) focusedScale else 1f
    return this
        .then(if (description != null) Modifier.clearAndSetSemantics { contentDescription = description; role = Role.Button } else Modifier)
        .graphicsLayer { scaleX = scale; scaleY = scale }
        .clickable(interactionSource = interaction.source, indication = null, enabled = enabled, onClick = onClick)
}

/**
 * The picture focus ring of the mockup (`0 0 0 2px bg, 0 0 0 4px text`): a 2 dp white ring drawn
 * 2 dp outside the picture, which keeps its rounded-square shape.
 */
@Composable
fun Modifier.focusRing(focused: Boolean, radius: Dp, gap: Dp = SeansFocus.RingGap, width: Dp = SeansFocus.Ring): Modifier {
    val alpha by animateFloatAsState(if (focused) 1f else 0f, tween(SeansMotion.Focus, easing = SeansMotion.Ease), label = "ring")
    return drawWithContent {
        drawContent()
        if (alpha > 0f) {
            val o = (gap + width / 2).toPx()
            drawRoundRect(
                color = SeansColors.Text,
                topLeft = Offset(-o, -o),
                size = Size(size.width + 2 * o, size.height + 2 * o),
                cornerRadius = CornerRadius(radius.toPx() + o),
                style = Stroke(width.toPx()),
                alpha = alpha,
            )
        }
    }
}

/** Requests focus and swallows the error a requester throws when its node is not attached yet. */
fun FocusRequester.tryRequestFocus(): Boolean = runCatching { requestFocus() }.isSuccess
