package app.seans.tv.ui.common

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyListState
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.derivedStateOf
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import app.seans.tv.designsystem.tryRequestFocus
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.focus.focusRestorer
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import app.seans.tv.designsystem.PinToStart
import app.seans.tv.designsystem.SText
import app.seans.tv.designsystem.SeansText

/** The track's inner padding: room for the focus scale and ring, as the mockup's `.row-track`. */
private val TrackPadStart = 12.dp
private val TrackPadTop = 8.dp
private val TrackPadBottom = 12.dp

/**
 * Focus handles of one row: a requester per composed card, keyed like the list. A card's requester
 * is registered while the card is composed, so [request] never hits an unattached node.
 */
class RowFocus {
    internal val items = mutableMapOf<Any, FocusRequester>()

    fun register(key: Any, requester: FocusRequester) { items[key] = requester }

    fun unregister(key: Any, requester: FocusRequester) { if (items[key] === requester) items.remove(key) }

    /** Focuses the card with [key] if it is composed. */
    fun request(key: Any?): Boolean = key != null && items[key]?.tryRequestFocus() == true
}

/**
 * A titled horizontal row of the mockup (`.row` + `.row-track`): the focused card moves to the
 * row's start; entering the row lands on the card [landingKey] names (the card left last, or the
 * current episode) instead of the nearest one, when that card is composed.
 *
 * @param start where the cards begin (104 dp beside the rail, 48 dp elsewhere).
 */
@Composable
fun <T> TvRow(
    title: String?,
    items: List<T>,
    key: (T) -> Any,
    state: LazyListState,
    focus: RowFocus,
    landingKey: Any?,
    onItemFocused: (Any) -> Unit,
    modifier: Modifier = Modifier,
    start: Dp = 104.dp,
    gap: Dp = 14.dp,
    itemContent: @Composable (item: T, modifier: Modifier) -> Unit,
) {
    // The fallback of `focusRestorer` is used only while the landing card is composed: a requester
    // with no node behind it would make the restore fail.
    val landingRequester = remember { FocusRequester() }
    val landingVisible by remember(landingKey, state) {
        derivedStateOf { landingKey != null && state.layoutInfo.visibleItemsInfo.any { it.key == landingKey } }
    }
    Column(modifier) {
        if (title != null) {
            SText(title, SeansText.Section, Modifier.padding(start = start, bottom = 10.dp - TrackPadTop), maxLines = 1)
        }
        PinToStart(TrackPadStart) {
            LazyRow(
                state = state,
                modifier = Modifier
                    .padding(start = start - TrackPadStart)
                    .focusRestorer(if (landingVisible) landingRequester else FocusRequester.Default),
                contentPadding = PaddingValues(start = TrackPadStart, end = 48.dp, top = TrackPadTop, bottom = TrackPadBottom),
                horizontalArrangement = Arrangement.spacedBy(gap),
            ) {
                items(items, key = key) { item ->
                    val k = key(item)
                    val requester = remember(k) { FocusRequester() }
                    DisposableEffect(k) {
                        focus.register(k, requester)
                        onDispose { focus.unregister(k, requester) }
                    }
                    val m = Modifier
                        .then(if (k == landingKey) Modifier.focusRequester(landingRequester) else Modifier)
                        .focusRequester(requester)
                        .onFocusChanged { if (it.isFocused) onItemFocused(k) }
                    itemContent(item, m)
                }
            }
        }
        Spacer(Modifier.height(22.dp - TrackPadBottom))
    }
}

/** An empty or error state with a focusable action, so the D-pad never ends up on nothing. */
@Composable
fun StateMessage(
    text: String,
    modifier: Modifier = Modifier,
    action: (@Composable () -> Unit)? = null,
) {
    Column(modifier, verticalArrangement = Arrangement.spacedBy(14.dp)) {
        SText(text, SeansText.Subtitle)
        action?.invoke()
    }
}
