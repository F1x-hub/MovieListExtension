package app.seans.tv.designsystem

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.drawWithCache
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.ColorFilter
import androidx.compose.ui.graphics.ColorMatrix
import androidx.compose.ui.layout.ContentScale
import coil3.compose.AsyncImage
import coil3.compose.LocalPlatformContext
import coil3.request.ImageRequest
import coil3.request.crossfade

/**
 * Decode sizes in pixels (the TV draws 1280x720 px). Every image is decoded at display size,
 * never at the CDN's original size (see `android-tv/AGENTS.md`, the 1 GB device rules).
 */
object ImageSizes {
    const val POSTER_W = 240
    const val POSTER_H = 360
    const val STILL_W = 320
    const val STILL_H = 180
    const val HERO_W = 1280
    const val HERO_H = 720
    const val BACKDROP_W = 880
    const val BACKDROP_H = 560
}

/**
 * A network picture through the app's single Coil `ImageLoader` (built in `:app` on
 * `AppGraph.http.mediaClient`). [widthPx]/[heightPx] are the decode size.
 */
@Composable
fun SeansImage(
    url: String?,
    widthPx: Int,
    heightPx: Int,
    modifier: Modifier = Modifier,
    alignment: Alignment = Alignment.Center,
    colorFilter: ColorFilter? = null,
) {
    if (url.isNullOrBlank()) {
        Box(modifier)
        return
    }
    val context = LocalPlatformContext.current
    val request = remember(url, widthPx, heightPx) {
        ImageRequest.Builder(context).data(url).size(widthPx, heightPx).crossfade(false).build()
    }
    AsyncImage(
        model = request,
        contentDescription = null,
        modifier = modifier,
        contentScale = ContentScale.Crop,
        alignment = alignment,
        colorFilter = colorFilter,
    )
}

/** `filter: saturate(s) brightness(b)` as a colour matrix (watched episodes, the login wall). */
fun saturationFilter(saturation: Float, brightness: Float = 1f): ColorFilter {
    val m = ColorMatrix().apply { setToSaturation(saturation) }
    if (brightness != 1f) m.timesAssign(ColorMatrix().apply { setToScale(brightness, brightness, brightness, 1f) })
    return ColorFilter.colorMatrix(m)
}

/**
 * A wide picture that fades into the page (the mockup's `mask-image`), so no edge of it shows.
 * The page behind it is the solid [background], so the fade is drawn as two gradients of that
 * colour over the picture: no offscreen layer, no blend mode, no blur. (A `DstIn` mask needed an
 * offscreen buffer the size of the art, composited on every frame — too much for the TV's GPU.)
 *
 * @param fadeInX fraction of the width over which the left edge fades in (page colour → picture).
 * @param fadeBottomFrom fraction of the height (from the bottom) that is fully page colour.
 * @param fadeBottomTo fraction of the height (from the bottom) where the picture is fully visible.
 */
@Composable
fun FadedArt(
    url: String?,
    widthPx: Int,
    heightPx: Int,
    modifier: Modifier = Modifier,
    alignment: Alignment = Alignment.Center,
    fadeInX: Float = 0.48f,
    fadeBottomFrom: Float = 0.08f,
    fadeBottomTo: Float = 0.52f,
    background: Color = SeansColors.Bg,
) {
    Box(
        // Each gradient is drawn only over the band where it has colour: blending fully
        // transparent pixels over the whole art made this region 4x overdraw on the TV.
        modifier.drawWithCache {
            val w = size.width
            val h = size.height
            val leftW = w * fadeInX
            val y0 = h * (1f - fadeBottomTo)
            val y1 = h * (1f - fadeBottomFrom)
            val left = Brush.horizontalGradient(listOf(background, background.copy(alpha = 0f)), startX = 0f, endX = leftW)
            val bottom = Brush.verticalGradient(listOf(background.copy(alpha = 0f), background), startY = y0, endY = y1)
            onDrawWithContent {
                drawContent()
                drawRect(left, size = Size(leftW, h))
                drawRect(bottom, topLeft = Offset(0f, y0), size = Size(w, y1 - y0))
                drawRect(background, topLeft = Offset(0f, y1), size = Size(w, h - y1))
            }
        },
    ) {
        SeansImage(url, widthPx, heightPx, Modifier.fillMaxSize(), alignment)
    }
}
