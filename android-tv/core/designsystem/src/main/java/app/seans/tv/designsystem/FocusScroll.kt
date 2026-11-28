package app.seans.tv.designsystem

import androidx.compose.animation.core.AnimationSpec
import androidx.compose.animation.core.snap
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.gestures.BringIntoViewSpec
import androidx.compose.foundation.gestures.LocalBringIntoViewSpec
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.remember
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.unit.Dp

/**
 * How a scrolling container follows focus.
 *
 * - Rows ([PinToStart]): the focused card moves to the row's start, as in the mockup, at once
 *   (no scroll animation: on the TCL each animated frame costs more than a frame's budget, and the
 *   owner prefers instant response to smoothness).
 * - Screens of rows ([NoAutoScroll]): the screen positions the focused row itself (a fixed height
 *   near the top), so the column must not also scroll on its own.
 */
@OptIn(ExperimentalFoundationApi::class)
private class PinToStartSpec(private val startPx: Float) : BringIntoViewSpec {
    @Suppress("OVERRIDE_DEPRECATION")
    override val scrollAnimationSpec: AnimationSpec<Float> = snap()

    override fun calculateScrollDistance(offset: Float, size: Float, containerSize: Float): Float = offset - startPx
}

@OptIn(ExperimentalFoundationApi::class)
private object NoAutoScrollSpec : BringIntoViewSpec {
    override fun calculateScrollDistance(offset: Float, size: Float, containerSize: Float): Float = 0f
}

/** Content inside follows focus by pinning the focused item [start] from the container's edge. */
@OptIn(ExperimentalFoundationApi::class)
@Composable
fun PinToStart(start: Dp, content: @Composable () -> Unit) {
    val px = with(LocalDensity.current) { start.toPx() }
    val spec = remember(px) { PinToStartSpec(px) }
    CompositionLocalProvider(LocalBringIntoViewSpec provides spec, content = content)
}

/** Content inside does not scroll by itself when focus moves; the caller scrolls explicitly. */
@OptIn(ExperimentalFoundationApi::class)
@Composable
fun NoAutoScroll(content: @Composable () -> Unit) {
    CompositionLocalProvider(LocalBringIntoViewSpec provides NoAutoScrollSpec, content = content)
}
