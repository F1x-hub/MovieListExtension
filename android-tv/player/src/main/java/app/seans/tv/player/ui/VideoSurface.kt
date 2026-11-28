package app.seans.tv.player.ui

import androidx.annotation.OptIn
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.media3.common.util.UnstableApi
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.ui.compose.ContentFrame
import androidx.media3.ui.compose.SURFACE_TYPE_SURFACE_VIEW
import androidx.tv.material3.Text
import app.seans.tv.designsystem.SeansRadius

/** The video on a SurfaceView (hardware overlay, no GPU copy), letterboxed on black. */
@OptIn(UnstableApi::class)
@Composable
internal fun VideoSurface(player: ExoPlayer?, modifier: Modifier = Modifier) {
    Box(modifier.fillMaxSize().background(Color.Black)) {
        if (player != null) {
            ContentFrame(
                player = player,
                modifier = Modifier.fillMaxSize(),
                surfaceType = SURFACE_TYPE_SURFACE_VIEW,
                contentScale = ContentScale.Fit,
            )
        }
    }
}

/** Subtitle lines, drawn by Compose from the player's cues. */
@Composable
internal fun SubtitleLines(lines: List<String>, bottomPadding: androidx.compose.ui.unit.Dp, modifier: Modifier = Modifier) {
    if (lines.isEmpty()) return
    Box(modifier.fillMaxSize().padding(start = 64.dp, end = 64.dp, bottom = bottomPadding), contentAlignment = Alignment.BottomCenter) {
        Column(horizontalAlignment = Alignment.CenterHorizontally) {
            lines.forEach { line ->
                Text(
                    text = line,
                    color = Color.White,
                    fontSize = 20.sp,
                    fontWeight = FontWeight.Medium,
                    textAlign = TextAlign.Center,
                    modifier = Modifier
                        .background(Color(0xB3000000), RoundedCornerShape(SeansRadius.Sm))
                        .padding(horizontal = 8.dp, vertical = 2.dp),
                )
            }
        }
    }
}
