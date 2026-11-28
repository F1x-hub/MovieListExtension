package app.seans.tv.designsystem

import androidx.annotation.DrawableRes
import androidx.compose.foundation.Image
import androidx.compose.foundation.layout.size
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.ColorFilter
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp

/** Icons of the mockup (`temp/tv-mockup/icons.js`), converted to vector drawables. */
object SeansIcons {
    val Search = R.drawable.ic_search
    val Bookmark = R.drawable.ic_bookmark
    val BookmarkFilled = R.drawable.ic_bookmark_filled
    val Live = R.drawable.ic_live
    val User = R.drawable.ic_user
    val Users = R.drawable.ic_users
    val Settings = R.drawable.ic_settings
    val Play = R.drawable.ic_play
    val Pause = R.drawable.ic_pause
    val Star = R.drawable.ic_star
    val Film = R.drawable.ic_film
    val Clock = R.drawable.ic_clock
    val ChevronDown = R.drawable.ic_chevron_down
    val ChevronRight = R.drawable.ic_chevron_right
    val Subtitles = R.drawable.ic_subtitles
    val Headphones = R.drawable.ic_headphones
    val Skip = R.drawable.ic_skip
    val FastForward = R.drawable.ic_fast_forward
    val List = R.drawable.ic_list
    val Lock = R.drawable.ic_lock
    val Check = R.drawable.ic_check
    val Volume = R.drawable.ic_volume_high
    val Key = R.drawable.ic_key
    val Info = R.drawable.ic_info
    val Camera = R.drawable.ic_camera
    val Close = R.drawable.ic_close
    val ArrowLeft = R.drawable.ic_arrow_left
    val Mic = R.drawable.ic_mic
    /** The app logo (white), from `src/shared/assets/icons/app/icon128-white.png`. */
    val Logo = R.drawable.seans_logo
}

@Composable
fun SeansIcon(
    @DrawableRes id: Int,
    modifier: Modifier = Modifier,
    tint: Color = SeansColors.Text,
    size: Dp = 20.dp,
) {
    Image(
        painter = painterResource(id),
        contentDescription = null,
        modifier = modifier.size(size),
        colorFilter = ColorFilter.tint(tint),
    )
}
