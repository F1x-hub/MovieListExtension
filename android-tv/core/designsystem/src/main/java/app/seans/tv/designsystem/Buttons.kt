package app.seans.tv.designsystem

import androidx.annotation.DrawableRes
import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.State
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp

/** Colours a control hands to its content: white text at rest, near-black once focused. */
class ControlColors(val content: Color, val muted: Color)

@Composable
private fun controlFill(focused: Boolean, primary: Boolean): State<Color> {
    val target = when {
        focused && primary -> Color.White
        focused -> SeansColors.Text
        primary -> SeansColors.ControlStrong
        else -> SeansColors.Control
    }
    return animateColorAsState(target, tween(SeansMotion.Focus, easing = SeansMotion.Ease), label = "fill")
}

/**
 * The mockup's `.btn`: 40 dp high, translucent at rest, white when focused (`scale 1.05`).
 * [primary] is a little brighter at rest; on a TV the main action is told by its icon and
 * progress, never by colour. [progress] draws the thin bar of «Смотреть с 1:12:40».
 */
@Composable
fun SeansButton(
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    primary: Boolean = false,
    progress: Float? = null,
    square: Boolean = false,
    enabled: Boolean = true,
    description: String? = null,
    content: @Composable RowScope.(ControlColors) -> Unit,
) {
    val interaction = rememberFocusInteraction()
    val focused = interaction.focused
    val colors = ControlColors(
        content = if (focused) SeansColors.OnFocus else SeansColors.Text,
        muted = if (focused) SeansColors.OnFocusMuted else SeansColors.Text2,
    )
    val fill = controlFill(focused, primary)
    Box(
        modifier
            .seansClickable(interaction, SeansFocus.ButtonScale, enabled, description, onClick)
            .height(SeansSizes.ButtonH)
            .then(if (square) Modifier.width(SeansSizes.ButtonH) else Modifier)
            .roundedFill({ fill.value }, SeansRadius.Md),
        contentAlignment = Alignment.Center,
    ) {
        Row(
            Modifier
                .fillMaxHeight()
                .padding(horizontal = if (square) 0.dp else 18.dp)
                .padding(bottom = if (progress != null) 2.dp else 0.dp),
            horizontalArrangement = Arrangement.spacedBy(8.dp, Alignment.CenterHorizontally),
            verticalAlignment = Alignment.CenterVertically,
        ) { content(colors) }
        if (progress != null) {
            // matchParentSize: the bar follows the button's width instead of stretching it.
            Box(
                Modifier
                    .matchParentSize()
                    .padding(start = 12.dp, end = 12.dp, bottom = 6.dp),
                contentAlignment = Alignment.BottomStart,
            ) {
                Box(
                    Modifier
                        .fillMaxWidth()
                        .height(3.dp)
                        .progressBar({ progress }, track = colors.content.copy(alpha = 0.22f), fill = colors.content),
                )
            }
        }
    }
}

/** A text button with an optional leading icon. */
@Composable
fun SeansButton(
    text: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    @DrawableRes icon: Int? = null,
    primary: Boolean = false,
    progress: Float? = null,
) {
    SeansButton(onClick = onClick, modifier = modifier, primary = primary, progress = progress, description = text) { colors ->
        if (icon != null) SeansIcon(icon, tint = colors.content)
        SText(text, SeansText.Button, color = colors.content, maxLines = 1)
    }
}

/** The square 40 dp icon button (bookmark, rating). */
@Composable
fun SeansIconButton(
    @DrawableRes icon: Int,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    description: String? = null,
) {
    SeansButton(onClick = onClick, modifier = modifier, square = true, description = description ?: "") { colors ->
        SeansIcon(icon, tint = colors.content)
    }
}

/** «Источник  Seasonvar · 1080p ⌄»: a muted key, the value and a chevron. */
@Composable
fun SeansValueButton(
    label: String,
    value: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
) {
    SeansButton(onClick = onClick, modifier = modifier, description = "$label: $value") { colors ->
        Row(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalAlignment = Alignment.CenterVertically) {
            SText(label, SeansText.Button.copy(fontWeight = androidx.compose.ui.text.font.FontWeight.Medium), color = colors.muted, maxLines = 1)
            SText(value, SeansText.Button, color = colors.content, maxLines = 1)
            SeansIcon(SeansIcons.ChevronDown, tint = colors.content, size = 16.dp)
        }
    }
}
