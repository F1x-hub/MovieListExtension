package app.seans.tv.designsystem

import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.BiasAlignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.draw.drawWithContent
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.zIndex

private val CardShape = RoundedCornerShape(SeansRadius.Lg)

/** `background-position: 50% y%` as a Compose alignment (y in 0..1). */
fun cropAlignment(y: Float): Alignment = BiasAlignment(0f, y * 2f - 1f)

/** A thin progress bar laid over a picture (wide cards, episodes, the live card). */
@Composable
fun ImageProgressBar(fraction: Float, modifier: Modifier = Modifier, track: Color = SeansColors.TrackOnImage) {
    Box(modifier.height(4.dp).progressBar({ fraction }, track))
}

/**
 * Poster 112x168 with the KP score; the caption appears on focus ([alwaysCaption] in grids).
 * Focus: `scale 1.08` and the white ring.
 */
@Composable
fun PosterCard(
    title: String,
    imageUrl: String?,
    kpRating: Double?,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    alwaysCaption: Boolean = false,
) {
    val interaction = rememberFocusInteraction()
    val focused = interaction.focused
    val captionAlpha by animateFloatAsState(if (focused || alwaysCaption) 1f else 0f, tween(SeansMotion.Focus, easing = SeansMotion.Ease), label = "cap")
    Column(
        modifier
            .zIndex(if (focused) 1f else 0f)
            .width(SeansSizes.PosterW)
            .seansClickable(interaction, SeansFocus.PosterScale, description = title, onClick = onClick),
    ) {
        Box(
            Modifier
                .size(SeansSizes.PosterW, SeansSizes.PosterH)
                .focusRing(focused, SeansRadius.Lg)
                .pictureFrame(SeansRadius.Lg),
        ) {
            SeansImage(imageUrl, ImageSizes.POSTER_W, ImageSizes.POSTER_H, Modifier.fillMaxSize())
            if (kpRating != null && kpRating > 0) KpMark(kpRating, Modifier.padding(6.dp))
        }
        Spacer(Modifier.height(8.dp))
        SText(
            title,
            SeansText.CaptionStrong,
            Modifier.graphicsLayer { alpha = captionAlpha }, // read in the layer: no recomposition per frame
            color = if (focused) SeansColors.Text else SeansColors.Text2,
            maxLines = 1,
        )
    }
}

/** The «Продолжить» card: 212x119 picture, a progress bar, title and «С2 · Е5 · осталось 32 мин». */
@Composable
fun WideCard(
    title: String,
    subtitle: String,
    imageUrl: String?,
    progress: Float,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    imageAlignmentY: Float = 0.3f,
) {
    val interaction = rememberFocusInteraction()
    val focused = interaction.focused
    Column(
        modifier
            .zIndex(if (focused) 1f else 0f)
            .width(SeansSizes.WideW)
            .seansClickable(interaction, SeansFocus.CardScale, description = "$title, $subtitle", onClick = onClick),
    ) {
        Box(
            Modifier
                .size(SeansSizes.WideW, SeansSizes.WideH)
                .focusRing(focused, SeansRadius.Lg)
                .pictureFrame(SeansRadius.Lg),
        ) {
            SeansImage(imageUrl, ImageSizes.STILL_W, ImageSizes.STILL_H, Modifier.fillMaxSize(), cropAlignment(imageAlignmentY))
            ImageProgressBar(progress, Modifier.padding(start = 10.dp, end = 10.dp).offset(y = 106.dp).fillMaxWidth())
        }
        Spacer(Modifier.height(8.dp))
        Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
            SText(title, SeansText.CardTitle, color = if (focused) SeansColors.Text else SeansColors.Text2, maxLines = 1)
            SText(subtitle, SeansText.Caption, maxLines = 1)
        }
    }
}

/**
 * An episode: 196x110 still with the number badge, a watched check and the progress of an
 * unfinished episode. Watched episodes are dimmed until focused.
 */
@Composable
fun EpisodeCard(
    number: String,
    title: String,
    subtitle: String,
    imageUrl: String?,
    watched: Boolean,
    progress: Float?,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    imageAlignmentY: Float = 0.5f,
) {
    val interaction = rememberFocusInteraction()
    val focused = interaction.focused
    Column(
        modifier
            .zIndex(if (focused) 1f else 0f)
            .width(SeansSizes.EpisodeW)
            .seansClickable(interaction, SeansFocus.CardScale, description = "$number $title, $subtitle", onClick = onClick),
    ) {
        Box(
            Modifier
                .size(SeansSizes.EpisodeW, SeansSizes.EpisodeH)
                .focusRing(focused, SeansRadius.Lg)
                .pictureFrame(SeansRadius.Lg),
        ) {
            SeansImage(
                imageUrl, ImageSizes.STILL_W, ImageSizes.STILL_H, Modifier.fillMaxSize(), cropAlignment(imageAlignmentY),
                colorFilter = if (watched && !focused) WatchedFilter else null,
            )
            Box(Modifier.fillMaxSize().background(Brush.verticalGradient(0.45f to Color.Transparent, 1f to Color(0x8C000000))))
            Box(
                Modifier
                    .padding(8.dp)
                    .height(20.dp)
                    .roundedFill(SeansColors.Scrim, SeansRadius.Sm)
                    .padding(horizontal = 6.dp),
                contentAlignment = Alignment.Center,
            ) { SText(number, SeansText.Micro, maxLines = 1) }
            if (watched) {
                Box(
                    Modifier
                        .align(Alignment.TopEnd)
                        .padding(8.dp)
                        .size(22.dp)
                        .roundedFill(Color(0xEBFFFFFF), SeansRadius.Sm),
                    contentAlignment = Alignment.Center,
                ) { SeansIcon(SeansIcons.Check, tint = SeansColors.Bg, size = 14.dp) }
            }
            if (progress != null && progress > 0f) {
                ImageProgressBar(progress, Modifier.align(Alignment.BottomStart).padding(start = 10.dp, end = 10.dp, bottom = 9.dp).fillMaxWidth())
            }
        }
        Spacer(Modifier.height(8.dp))
        Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
            SText(title, SeansText.CardTitle, color = if (focused) SeansColors.Text else SeansColors.Text2, maxLines = 1)
            SText(subtitle, SeansText.Caption, maxLines = 1)
        }
    }
}

private val WatchedFilter = saturationFilter(0.55f, 0.8f)

/**
 * The «Эфир» card on Home: 400x119, the badge, title, time left and a progress bar.
 * [progress] and [meta] change over time; keep the ticking in the caller's small scope.
 */
@Composable
fun LiveNowCard(
    title: String,
    meta: String,
    imageUrl: String?,
    progress: () -> Float,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    onAir: Boolean = true,
) {
    val interaction = rememberFocusInteraction()
    val focused = interaction.focused
    Box(
        modifier
            .zIndex(if (focused) 1f else 0f)
            .seansClickable(interaction, 1.04f, description = "$title, $meta", onClick = onClick)
            .size(400.dp, SeansSizes.WideH)
            .focusRing(focused, SeansRadius.Lg)
            .pictureFrame(SeansRadius.Lg, line = null),
    ) {
        // The shade only over the picture (the right 260 dp): the card's own fill is the same colour
        // on the left, so a full-width gradient was one blended layer too many.
        Box(
            Modifier
                .align(Alignment.CenterEnd)
                .width(260.dp)
                .fillMaxHeight()
                .drawWithContent {
                    drawContent()
                    drawRect(LiveShade)
                },
        ) {
            SeansImage(imageUrl, ImageSizes.STILL_W + 30, ImageSizes.STILL_H - 21, Modifier.fillMaxSize(), cropAlignment(0.3f))
        }
        Column(Modifier.padding(start = 16.dp, top = 14.dp, end = 16.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
            if (onAir) LiveBadge() else LiveBadge(label = "Далее", onAir = false)
            SText(title, SeansText.Heading.copy(fontSize = 19.sp), Modifier.padding(top = 4.dp), maxLines = 1)
            SText(meta, SeansText.Caption, color = SeansColors.Text2, maxLines = 1)
            Box(
                Modifier
                    .padding(top = 6.dp)
                    .width(180.dp)
                    .height(4.dp)
                    .progressBar(progress, SeansColors.Track),
            )
        }
    }
}

/** `linear-gradient(90deg, bg-3 38%, rgba(24,24,27,.4) 75%, .1)` of the 400 dp card, mapped onto its picture part (x ≥ 140 dp). */
private val LiveShade = Brush.horizontalGradient(0.046f to SeansColors.Bg3, 0.615f to Color(0x6618181B), 1f to Color(0x1A18181B))

/** A programme slot next to the live card: time, title, caption. */
@Composable
fun SlotCard(
    time: String,
    title: String,
    caption: String?,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val interaction = rememberFocusInteraction()
    val focused = interaction.focused
    val fill by animateColorAsState(if (focused) SeansColors.Bg4 else SeansColors.Bg2, tween(SeansMotion.Focus), label = "slot")
    Column(
        modifier
            .zIndex(if (focused) 1f else 0f)
            .seansClickable(interaction, SeansFocus.CardScale, description = listOfNotNull(time, title, caption).joinToString(", "), onClick = onClick)
            .size(150.dp, SeansSizes.WideH)
            .focusRing(focused, SeansRadius.Lg)
            .roundedFill({ fill }, SeansRadius.Lg)
            .roundedLine(SeansColors.Line, SeansRadius.Lg)
            .padding(14.dp),
        verticalArrangement = Arrangement.spacedBy(3.dp),
    ) {
        SText(time, SeansText.CaptionStrong.copy(fontWeight = FontWeight.Bold), maxLines = 1)
        SText(title, SeansText.Button, Modifier.padding(top = 8.dp), maxLines = 1)
        if (caption != null) SText(caption, SeansText.Caption, maxLines = 1)
    }
}

/** «Сезон 2»: outlined at rest, filled when current, white when focused. */
@Composable
fun SeasonTab(
    text: String,
    current: Boolean,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val interaction = rememberFocusInteraction()
    val focused = interaction.focused
    val fill = when {
        focused -> SeansColors.Text
        current -> SeansColors.CurrentTab
        else -> Color.Transparent
    }
    Box(
        modifier
            .seansClickable(interaction, SeansFocus.ButtonScale, description = text, onClick = onClick)
            .height(34.dp)
            .roundedFill(fill, SeansRadius.Md)
            .then(if (!focused && !current) Modifier.roundedLine(SeansColors.Line, SeansRadius.Md) else Modifier)
            .padding(horizontal = 14.dp),
        contentAlignment = Alignment.Center,
    ) {
        SText(
            text,
            SeansText.Tab,
            color = when {
                focused -> SeansColors.OnFocus
                current -> SeansColors.Text
                else -> SeansColors.Text2
            },
            maxLines = 1,
        )
    }
}

/** A row heading («Продолжить», «Эфир»): 17 sp, 10 dp above the cards. */
@Composable
fun RowTitle(text: String, modifier: Modifier = Modifier) {
    SText(text, SeansText.Section, modifier.padding(bottom = 10.dp), maxLines = 1)
}
