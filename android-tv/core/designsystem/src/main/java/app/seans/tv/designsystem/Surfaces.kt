package app.seans.tv.designsystem

import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.draw.drawWithCache
import androidx.compose.ui.draw.drawWithContent
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Rect
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp

/*
 * Cheap rounded surfaces. On the TCL the RenderThread and GPU set the frame time, so a control is
 * drawn with as few layers as possible: a rounded fill and line are draw calls on the control's
 * own node, and no surface uses a rounded `clip` (pictures get corner masks instead).
 */

/** A rounded fill behind the content, without a clip layer. */
fun Modifier.roundedFill(color: Color, radius: Dp): Modifier = drawBehind {
    drawRoundRect(color, cornerRadius = CornerRadius(radius.toPx()))
}

/** The same, for an animated colour: [color] is read in the draw phase, so a fade only redraws. */
fun Modifier.roundedFill(color: () -> Color, radius: Dp): Modifier = drawBehind {
    val c = color()
    if (c.alpha > 0f) drawRoundRect(c, cornerRadius = CornerRadius(radius.toPx()))
}

/** A 1 dp line inside the edge, drawn over the content (the mockup's `inset 0 0 0 1px`). */
fun Modifier.roundedLine(color: Color, radius: Dp, width: Dp = 1.dp): Modifier = drawWithContent {
    drawContent()
    insetLine(color, radius, width)
}

/**
 * A picture's frame: the empty-state fill under it, the inset line over it, and rounded corners
 * made by four small corner masks in the [page] colour, not by a clip. Measured on the TCL's
 * Mali-G31: a rounded clip per picture doubled the GPU time of a frame (p50 15 ms → 5–9 ms without
 * it). Pictures always sit on the plain page background, so the masks are invisible. The picture's
 * own `Image` still clips to its bounds (a cheap rectangle clip).
 */
fun Modifier.pictureFrame(
    radius: Dp,
    fill: Color = SeansColors.Bg3,
    line: Color? = SeansColors.Line,
    page: Color = SeansColors.Bg,
): Modifier = drawWithCache {
    val corners = cornerMask(size, radius.toPx())
    onDrawWithContent {
        drawRect(fill)
        drawContent()
        if (line != null) insetLine(line, radius, 1.dp)
        drawPath(corners, page)
    }
}

/** The four spandrels outside a rounded rectangle of [size] with corner radius [r]. */
private fun cornerMask(size: Size, r: Float): Path = Path().apply {
    val w = size.width
    val h = size.height
    val d = 2 * r
    // Each corner: from the corner point along one edge, back along the quarter arc, close.
    moveTo(0f, 0f); lineTo(r, 0f); arcTo(Rect(0f, 0f, d, d), 270f, -90f, false); close()
    moveTo(w, 0f); lineTo(w, r); arcTo(Rect(w - d, 0f, w, d), 0f, -90f, false); close()
    moveTo(w, h); lineTo(w - r, h); arcTo(Rect(w - d, h - d, w, h), 90f, -90f, false); close()
    moveTo(0f, h); lineTo(0f, h - r); arcTo(Rect(0f, h - d, d, h), 180f, -90f, false); close()
}

/** A thin bar: track and the played part as two rounded rects, [fraction] read in the draw phase. */
fun Modifier.progressBar(fraction: () -> Float, track: Color, fill: Color = Color.White): Modifier = drawBehind {
    val r = CornerRadius(size.height / 2)
    drawRoundRect(track, cornerRadius = r)
    val f = fraction().coerceIn(0f, 1f)
    if (f > 0f) drawRoundRect(fill, size = Size(size.width * f, size.height), cornerRadius = r)
}

private fun DrawScope.insetLine(color: Color, radius: Dp, width: Dp) {
    val w = width.toPx()
    drawRoundRect(
        color,
        topLeft = Offset(w / 2, w / 2),
        size = Size(size.width - w, size.height - w),
        cornerRadius = CornerRadius((radius.toPx() - w / 2).coerceAtLeast(0f)),
        style = Stroke(w),
    )
}
