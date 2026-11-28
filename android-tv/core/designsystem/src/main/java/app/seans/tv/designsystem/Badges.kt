package app.seans.tv.designsystem

import androidx.annotation.DrawableRes
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.em
import androidx.compose.ui.unit.sp
import java.util.Locale

/** «8.6», one decimal with a dot, as the extension prints ratings. */
fun formatRating(value: Double): String = String.format(Locale.US, "%.1f", value)

@Composable
private fun Badge(
    background: Color,
    content: Color,
    text: String,
    @DrawableRes icon: Int? = null,
    bold: Boolean = true,
) {
    Row(
        Modifier
            .height(22.dp)
            .roundedFill(background, SeansRadius.Sm)
            .padding(horizontal = 7.dp),
        horizontalArrangement = Arrangement.spacedBy(4.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        if (icon != null) SeansIcon(icon, tint = content, size = 16.dp)
        SText(text, SeansText.Badge.copy(fontWeight = if (bold) SeansText.Badge.fontWeight else androidx.compose.ui.text.font.FontWeight.SemiBold), color = content, maxLines = 1)
    }
}

/**
 * The ratings line: KP (orange) and IMDb (yellow) with near-black text, the viewer's own score
 * and the community average in neutral badges. Missing values are left out.
 */
@Composable
fun RatingBadges(
    kinopoisk: Double?,
    imdb: Double?,
    mine: Int?,
    community: Double?,
    modifier: Modifier = Modifier,
) {
    val description = listOfNotNull(
        kinopoisk?.takeIf { it > 0 }?.let { "Кинопоиск ${formatRating(it)}" },
        imdb?.takeIf { it > 0 }?.let { "IMDb ${formatRating(it)}" },
        mine?.takeIf { it > 0 }?.let { "Ваша оценка $it" },
        community?.takeIf { it > 0 }?.let { "Сообщество ${formatRating(it)}" },
    ).joinToString(", ")
    Row(modifier.clearAndSetSemantics { contentDescription = description }, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
        if (kinopoisk != null && kinopoisk > 0) Badge(SeansColors.Kinopoisk, SeansColors.OnBrand, "КП ${formatRating(kinopoisk)}")
        if (imdb != null && imdb > 0) Badge(SeansColors.Imdb, SeansColors.OnBrand, "IMDb ${formatRating(imdb)}")
        if (mine != null && mine > 0) Badge(Color(0x1FFFFFFF), SeansColors.Text, "Ваша $mine", SeansIcons.Star, bold = false)
        if (community != null && community > 0) Badge(Color(0x1FFFFFFF), SeansColors.Text, "Сообщество ${formatRating(community)}", SeansIcons.Users, bold = false)
    }
}

/** The KP score in the poster's corner. */
@Composable
fun KpMark(value: Double, modifier: Modifier = Modifier) {
    Box(
        modifier
            .height(20.dp)
            .roundedFill(SeansColors.Kinopoisk, SeansRadius.Sm)
            .padding(horizontal = 6.dp),
        contentAlignment = Alignment.Center,
    ) {
        SText(formatRating(value), SeansText.Micro, color = SeansColors.OnBrand, maxLines = 1)
    }
}

/**
 * «В ЭФИРЕ»: the red square dot is always next to its label (colour is never the only signal).
 * [onAir] false draws the same badge without the dot, for what is coming next («Далее»).
 */
@Composable
fun LiveBadge(modifier: Modifier = Modifier, small: Boolean = false, label: String = "В эфире", onAir: Boolean = true) {
    Row(
        modifier
            .height(if (small) 20.dp else 22.dp)
            .roundedFill(SeansColors.Scrim, SeansRadius.Sm)
            .roundedLine(SeansColors.Line2, SeansRadius.Sm)
            .padding(horizontal = 8.dp),
        horizontalArrangement = Arrangement.spacedBy(6.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        if (onAir) LiveDot()
        SText(
            label.uppercase(),
            SeansText.Micro.copy(fontSize = if (small) 11.sp else 12.sp, letterSpacing = 0.06.em),
            color = Color.White,
            maxLines = 1,
        )
    }
}

/**
 * The red square dot. Static on purpose: the mockup pulses it, but on the TCL a running animation
 * redraws the whole screen on every frame (its GPU has no buffer-age support, so HWUI cannot redraw
 * only the badge), ~26 ms each, keeping the GPU busy and delaying the frames that answer the remote.
 */
@Composable
private fun LiveDot() {
    Box(Modifier.size(8.dp).roundedFill(SeansColors.Danger, SeansRadius.Xs))
}
