package app.seans.tv.ui.common

import androidx.compose.foundation.layout.BoxScope
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import app.seans.tv.designsystem.PanelList
import app.seans.tv.designsystem.PanelOption
import app.seans.tv.designsystem.PanelTitle
import app.seans.tv.designsystem.SText
import app.seans.tv.designsystem.SeansButton
import app.seans.tv.designsystem.SeansIcon
import app.seans.tv.designsystem.SeansIconButton
import app.seans.tv.designsystem.SeansIcons
import app.seans.tv.designsystem.SeansText
import app.seans.tv.designsystem.SidePanel
import app.seans.tv.model.BookmarkStatus

/**
 * What one press of the bookmark button does. «Буду смотреть» toggles on and off; a title that
 * already has another status (Любимое, Смотрю, Просмотрено) is never overwritten by a click: the
 * screen opens [BookmarkPanel] so the viewer chooses.
 */
sealed interface BookmarkClick {
    data class Set(val status: BookmarkStatus?) : BookmarkClick
    data object Choose : BookmarkClick
}

fun bookmarkClick(current: BookmarkStatus?): BookmarkClick = when (current) {
    null -> BookmarkClick.Set(BookmarkStatus.PLAN_TO_WATCH)
    BookmarkStatus.PLAN_TO_WATCH -> BookmarkClick.Set(null)
    else -> BookmarkClick.Choose
}

fun bookmarkToast(status: BookmarkStatus?): String = when (status) {
    null -> "Убрано из закладок"
    BookmarkStatus.PLAN_TO_WATCH -> "Добавлено в «Буду смотреть»"
    else -> "В закладках: ${status.label}"
}

/**
 * The bookmark control: an outline icon without a bookmark, a filled icon for «Буду смотреть», and
 * the filled icon with the status name («Любимое») for any other status, so it is visible.
 */
@Composable
fun BookmarkButton(status: BookmarkStatus?, onClick: () -> Unit, modifier: Modifier = Modifier) {
    when (status) {
        null -> SeansIconButton(SeansIcons.Bookmark, onClick, modifier, description = "Добавить в «Буду смотреть»")
        BookmarkStatus.PLAN_TO_WATCH -> SeansIconButton(SeansIcons.BookmarkFilled, onClick, modifier, description = "В «Буду смотреть», убрать")
        else -> SeansButton(onClick = onClick, modifier = modifier, description = "В закладках: ${status.label}") { colors ->
            SeansIcon(SeansIcons.BookmarkFilled, tint = colors.content)
            SText(status.label, SeansText.Button, color = colors.content, maxLines = 1)
        }
    }
}

/** «Закладки»: the four statuses of the extension and «Убрать из закладок». Opens on the current one. */
@Composable
fun BoxScope.BookmarkPanel(
    visible: Boolean,
    current: BookmarkStatus?,
    onPick: (BookmarkStatus?) -> Unit,
    onDismiss: () -> Unit,
) {
    val initial = remember { FocusRequester() }
    SidePanel(visible = visible, onDismiss = onDismiss, initialFocus = initial) {
        PanelTitle("Закладки")
        PanelList {
            BookmarkStatus.entries.forEach { status ->
                PanelOption(
                    title = status.label,
                    current = status == current,
                    onClick = { onPick(status) },
                    modifier = if (status == current) Modifier.focusRequester(initial) else Modifier,
                )
            }
            PanelOption(
                title = "Убрать из закладок",
                subtitle = "Пропадёт и в расширении",
                onClick = { onPick(null) },
                modifier = if (current == null) Modifier.focusRequester(initial) else Modifier,
            )
        }
    }
}
