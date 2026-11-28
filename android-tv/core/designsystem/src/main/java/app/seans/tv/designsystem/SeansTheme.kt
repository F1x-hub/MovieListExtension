package app.seans.tv.designsystem

import androidx.compose.runtime.Composable
import androidx.tv.material3.MaterialTheme
import androidx.tv.material3.darkColorScheme

/**
 * Wraps tv-material so its default components already follow the tokens. Dark only:
 * a TV interface has no light theme. Text uses Inter ([SeansFontFamily], downloadable, Roboto as
 * fallback) through [SeansText] and [SText].
 */
@Composable
fun SeansTheme(content: @Composable () -> Unit) {
    MaterialTheme(
        colorScheme = darkColorScheme(
            primary = SeansColors.Text,
            onPrimary = SeansColors.OnFocus,
            secondary = SeansColors.Text2,
            background = SeansColors.Bg,
            onBackground = SeansColors.Text,
            surface = SeansColors.Bg2,
            onSurface = SeansColors.Text,
            surfaceVariant = SeansColors.Bg3,
            onSurfaceVariant = SeansColors.Text2,
            border = SeansColors.Line2,
            error = SeansColors.Danger,
        ),
        content = content,
    )
}
