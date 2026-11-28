package app.seans.tv.designsystem

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInHorizontally
import androidx.compose.animation.slideInVertically
import androidx.compose.animation.slideOutHorizontally
import androidx.compose.animation.slideOutVertically
import androidx.compose.foundation.background
import androidx.compose.foundation.focusGroup
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxScope
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.runtime.withFrameNanos
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.focus.FocusDirection
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusProperties
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.input.key.Key
import androidx.compose.ui.input.key.KeyEventType
import androidx.compose.ui.input.key.key
import androidx.compose.ui.input.key.onKeyEvent
import androidx.compose.ui.input.key.type
import androidx.compose.ui.unit.dp

private val PanelEnter = tween<androidx.compose.ui.unit.IntOffset>(SeansMotion.Screen, easing = SeansMotion.Ease)

/**
 * Focus stays inside an open panel (no direction leaves it), Back closes it through [onDismiss],
 * and [initialFocus] (or the panel's first control) takes focus when it opens. Returning focus to
 * the control that opened the panel is the caller's job.
 */
@Composable
private fun Modifier.panelFocus(onDismiss: () -> Unit, initialFocus: FocusRequester?): Modifier {
    val group = remember { FocusRequester() }
    LaunchedEffect(Unit) {
        withFrameNanos { }
        if (initialFocus == null || !initialFocus.tryRequestFocus()) group.tryRequestFocus()
    }
    return this
        .onKeyEvent {
            if (it.key == Key.Back || it.key == Key.Escape) {
                if (it.type == KeyEventType.KeyUp) onDismiss()
                true
            } else {
                false
            }
        }
        .focusRequester(group)
        .focusProperties { onExit = { if (requestedFocusDirection != FocusDirection.Enter) cancelFocusChange() } }
        .focusGroup()
}

/** The right-hand panel (380 dp): «Источник», «Озвучка», «Программа». Slides in from the right. */
@Composable
fun BoxScope.SidePanel(
    visible: Boolean,
    onDismiss: () -> Unit,
    modifier: Modifier = Modifier,
    initialFocus: FocusRequester? = null,
    content: @Composable ColumnScope.() -> Unit,
) {
    AnimatedVisibility(
        visible = visible,
        modifier = Modifier.align(Alignment.CenterEnd),
        enter = slideInHorizontally(PanelEnter) { 40 } + fadeIn(tween(SeansMotion.Screen)),
        exit = slideOutHorizontally(PanelEnter) { 40 } + fadeOut(tween(160)),
    ) {
        Column(
            modifier
                .width(380.dp)
                .fillMaxHeight()
                .background(SeansColors.Panel)
                .panelFocus(onDismiss, initialFocus)
                .padding(start = 24.dp, end = SeansSpace.SafeX, top = SeansSpace.SafeY, bottom = SeansSpace.SafeY),
            content = content,
        )
    }
}

/** The bottom sheet (the player's «Серии»): full width, rounded top corners. */
@Composable
fun BoxScope.BottomPanel(
    visible: Boolean,
    onDismiss: () -> Unit,
    modifier: Modifier = Modifier,
    initialFocus: FocusRequester? = null,
    content: @Composable ColumnScope.() -> Unit,
) {
    AnimatedVisibility(
        visible = visible,
        modifier = Modifier.align(Alignment.BottomCenter),
        enter = slideInVertically(PanelEnter) { 40 } + fadeIn(tween(SeansMotion.Screen)),
        exit = slideOutVertically(PanelEnter) { 40 } + fadeOut(tween(160)),
    ) {
        Column(
            modifier
                .fillMaxWidth()
                .clip(RoundedCornerShape(topStart = SeansRadius.Xl, topEnd = SeansRadius.Xl))
                .background(SeansColors.Panel)
                .panelFocus(onDismiss, initialFocus)
                .padding(top = 20.dp, bottom = SeansSpace.SafeY),
            content = content,
        )
    }
}

@Composable
fun PanelTitle(text: String, modifier: Modifier = Modifier) {
    SText(text, SeansText.PanelTitle, modifier.padding(bottom = 10.dp), maxLines = 1)
}

/** A list inside a panel: 4 dp between options, 20 dp after the list. */
@Composable
fun PanelList(modifier: Modifier = Modifier, content: @Composable ColumnScope.() -> Unit) {
    Column(modifier.padding(bottom = 20.dp), verticalArrangement = Arrangement.spacedBy(4.dp), content = content)
}

/**
 * An option in a panel: title, an optional second line, a check when [current]. [off] options
 * stay focusable (they explain why: «Этой серии нет») but are dimmed.
 */
@Composable
fun PanelOption(
    title: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    subtitle: String? = null,
    current: Boolean = false,
    off: Boolean = false,
    trailing: (@Composable (Color) -> Unit)? = null,
) {
    val interaction = rememberFocusInteraction()
    val focused = interaction.focused
    val fill by animateColorAsState(
        when {
            focused -> SeansColors.Text
            current -> SeansColors.Current
            else -> Color.Transparent
        },
        tween(SeansMotion.Focus), label = "opt",
    )
    val content = if (focused) SeansColors.OnFocus else SeansColors.Text
    Row(
        modifier
            .fillMaxWidth()
            .seansClickable(interaction, 1f, description = listOfNotNull(title, subtitle).joinToString(", "), onClick = onClick)
            .heightIn(min = 44.dp)
            .alpha(if (off && !focused) 0.45f else 1f)
            .roundedFill({ fill }, SeansRadius.Md)
            .padding(horizontal = 12.dp, vertical = 6.dp),
        horizontalArrangement = Arrangement.spacedBy(10.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(1.dp)) {
            SText(title, SeansText.Button, color = content, maxLines = 1)
            if (subtitle != null) {
                SText(subtitle, SeansText.Micro.copy(fontWeight = androidx.compose.ui.text.font.FontWeight.Normal), color = if (focused) SeansColors.OnFocusMuted else SeansColors.Text3, maxLines = 2)
            }
        }
        trailing?.invoke(content)
        if (current) SeansIcon(SeansIcons.Check, tint = content)
    }
}

/** A dim full-screen layer under a panel; it keeps the page visible but quiet. */
@Composable
fun PanelScrim(visible: Boolean) {
    AnimatedVisibility(visible, enter = fadeIn(tween(SeansMotion.Screen)), exit = fadeOut(tween(160))) {
        Box(Modifier.fillMaxSize().background(Color(0x33000000)))
    }
}
