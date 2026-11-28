package app.seans.tv.ui.common

import app.seans.tv.model.BookmarkStatus
import org.junit.Assert.assertEquals
import org.junit.Test

class BookmarksTest {
    @Test fun noBookmarkAddsPlanToWatch() =
        assertEquals(BookmarkClick.Set(BookmarkStatus.PLAN_TO_WATCH), bookmarkClick(null))

    @Test fun planToWatchIsRemoved() =
        assertEquals(BookmarkClick.Set(null), bookmarkClick(BookmarkStatus.PLAN_TO_WATCH))

    @Test fun anotherStatusIsNeverOverwrittenByAClick() {
        for (status in listOf(BookmarkStatus.FAVORITE, BookmarkStatus.WATCHED, BookmarkStatus.WATCHING)) {
            assertEquals(BookmarkClick.Choose, bookmarkClick(status))
        }
    }

    @Test fun toastsNameTheResult() {
        assertEquals("Добавлено в «Буду смотреть»", bookmarkToast(BookmarkStatus.PLAN_TO_WATCH))
        assertEquals("Убрано из закладок", bookmarkToast(null))
        assertEquals("В закладках: Любимое", bookmarkToast(BookmarkStatus.FAVORITE))
    }
}
