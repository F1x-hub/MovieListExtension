package app.seans.tv.live.ui

import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.PathFillType
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.vector.addPathNodes
import androidx.compose.ui.unit.dp

/**
 * The few mockup icons the Live screen needs (`temp/tv-mockup/icons.js`, 20x20 grid: filled parts
 * and 2-unit strokes). `:core:designsystem` has no icon set yet; move these there when it does.
 * Drawn black and tinted by `Icon` with the current content colour.
 */
internal object LiveIcons {
    val List = icon(
        fill = "M4 3.5A1.5 1.5 0 1 0 4 6.5A1.5 1.5 0 1 0 4 3.5ZM4 8.5A1.5 1.5 0 1 0 4 11.5A1.5 1.5 0 1 0 4 8.5ZM4 13.5A1.5 1.5 0 1 0 4 16.5A1.5 1.5 0 1 0 4 13.5Z",
        stroke = listOf("M9 5H17M9 10H17M9 15H17"),
    )
    val Headphones = icon(
        fill = "M3.5 11H4.5A1.5 1.5 0 0 1 6 12.5V15.5A1.5 1.5 0 0 1 4.5 17H3.5A1.5 1.5 0 0 1 2 15.5V12.5A1.5 1.5 0 0 1 3.5 11ZM15.5 11H16.5A1.5 1.5 0 0 1 18 12.5V15.5A1.5 1.5 0 0 1 16.5 17H15.5A1.5 1.5 0 0 1 14 15.5V12.5A1.5 1.5 0 0 1 15.5 11Z",
        stroke = listOf("M3 13V10A7 7 0 0 1 17 10V13"),
    )
    val Subtitles = icon(
        stroke = listOf("M5.5 4H14.5A2.5 2.5 0 0 1 17 6.5V13.5A2.5 2.5 0 0 1 14.5 16H5.5A2.5 2.5 0 0 1 3 13.5V6.5A2.5 2.5 0 0 1 5.5 4Z", "M6 8H7M10 8H14M6 12H10M13 12H14"),
    )
    val Volume = icon(
        fill = "M2 8A1 1 0 0 1 3 7H5.4L9.3 3.4A1 1 0 0 1 11 4.1V15.9A1 1 0 0 1 9.3 16.6L5.4 13H3A1 1 0 0 1 2 12Z",
        stroke = listOf("M13.6 7.4A3.8 3.8 0 0 1 13.6 12.6M15.8 4.6A7.6 7.6 0 0 1 15.8 15.4"),
    )
    val VolumeOff = icon(
        fill = "M2 8A1 1 0 0 1 3 7H5.4L9.3 3.4A1 1 0 0 1 11 4.1V15.9A1 1 0 0 1 9.3 16.6L5.4 13H3A1 1 0 0 1 2 12Z",
        stroke = listOf("M13.5 7.5L18 12M18 7.5L13.5 12"),
    )
    val Info = icon(
        fill = "M10 5.5A1.3 1.3 0 1 0 10 8.1A1.3 1.3 0 1 0 10 5.5Z",
        stroke = listOf("M6 3H14A3 3 0 0 1 17 6V14A3 3 0 0 1 14 17H6A3 3 0 0 1 3 14V6A3 3 0 0 1 6 3Z", "M10 10V13.4"),
    )
    val Lock = icon(
        fill = "M5.5 8H14.5A2.5 2.5 0 0 1 17 10.5V15.5A2.5 2.5 0 0 1 14.5 18H5.5A2.5 2.5 0 0 1 3 15.5V10.5A2.5 2.5 0 0 1 5.5 8ZM10 11H10A1 1 0 0 1 11 12V14A1 1 0 0 1 10 15H10A1 1 0 0 1 9 14V12A1 1 0 0 1 10 11Z",
        stroke = listOf("M6 8V6A4 4 0 0 1 14 6V8"),
    )

    private fun icon(fill: String? = null, stroke: List<String> = emptyList()): ImageVector {
        val builder = ImageVector.Builder(defaultWidth = 20.dp, defaultHeight = 20.dp, viewportWidth = 20f, viewportHeight = 20f)
        stroke.forEach { d ->
            builder.addPath(
                pathData = addPathNodes(d),
                stroke = SolidColor(Color.Black),
                strokeLineWidth = 2f,
                strokeLineCap = StrokeCap.Round,
                strokeLineJoin = StrokeJoin.Round,
            )
        }
        if (fill != null) {
            builder.addPath(pathData = addPathNodes(fill), fill = SolidColor(Color.Black), pathFillType = PathFillType.EvenOdd)
        }
        return builder.build()
    }
}
