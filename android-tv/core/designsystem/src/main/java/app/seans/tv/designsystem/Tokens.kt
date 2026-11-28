package app.seans.tv.designsystem

import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

/**
 * Tokens from the approved mockup (`temp/tv-mockup/tv.css`) and the extension's dark theme
 * (Obsidian-Zinc). The interface is neutral; colour comes only from content (posters), provider
 * badges (KP, IMDb) and the red «В эфире» marker, which is always next to its text.
 * The canvas is 960x540 dp (the TCL renders 1280x720 at density 213).
 */
object SeansColors {
    val Bg = Color(0xFF09090B)
    val Bg2 = Color(0xFF121214)
    val Bg3 = Color(0xFF18181B)
    val Bg4 = Color(0xFF27272A)
    val Text = Color(0xFFF4F4F5)
    val Text2 = Color(0xFFA1A1AA)
    val Text3 = Color(0xFF85858E)
    /** Text on a focused (white) control. */
    val OnFocus = Color(0xFF09090B)
    val OnFocusMuted = Color(0xFF52525B)
    val Line = Color(0x14FFFFFF)
    val Line2 = Color(0x29FFFFFF)
    /** Resting fill of a control; only the focused control is white. */
    val Control = Color(0x1AFFFFFF)
    val ControlStrong = Color(0x33FFFFFF)
    val Danger = Color(0xFFDC3545)
    val Kinopoisk = Color(0xFFFF5500)
    val Imdb = Color(0xFFF5C518)
    /** Text on the KP and IMDb badges (white on KP orange fails contrast). */
    val OnBrand = Color(0xFF111111)
    /** Fill of a current (not focused) option or tab. */
    val Current = Color(0x14FFFFFF)
    val CurrentTab = Color(0x1AFFFFFF)
    /** Badges laid over pictures (episode number, «В эфире»). */
    val Scrim = Color(0xB809090B)
    /** Panels over the screen (`rgba(18,18,20,.97)`). */
    val Panel = Color(0xF7121214)
    val Toast = Color(0xF527272A)
    /** Progress tracks over pictures and on buttons. */
    val TrackOnImage = Color(0x47FFFFFF)
    val Track = Color(0x33FFFFFF)
}

/** Motion from the mockup: `cubic-bezier(0.2, 0.8, 0.2, 1)`. */
object SeansMotion {
    val Ease = androidx.compose.animation.core.CubicBezierEasing(0.2f, 0.8f, 0.2f, 1f)
    /**
     * Focus fades (fill colour, ring, caption). Measured on the TCL: these frames are cheap and not
     * janky (with them 18 of 94 frames were janky; without them 18 of 58), so they stay. The focus
     * scale and the scrolls are instant instead (see `seansClickable`, `PinToStart`).
     */
    const val Focus = 180
    const val Screen = 220
    const val Scroll = 320
}

/** The product's shape is a rounded square. The only circle is a user's avatar. */
object SeansRadius {
    val Xs = 2.dp   // dots, the timeline knob
    val Sm = 4.dp   // labels, number badges
    val Md = 8.dp   // anything focusable
    val Lg = 12.dp  // cards, posters, panels
    val Xl = 16.dp  // sheets, the QR card
}

object SeansSpace {
    /** TV safe area. */
    val SafeX = 48.dp
    val SafeY = 27.dp
    /** Left edge of content beside the collapsed rail. */
    val ContentStart = 104.dp
    val RailCollapsed = 72.dp
    val RailOpen = 220.dp
    val RowGap = 14.dp
}

object SeansSizes {
    val PosterW = 112.dp
    val PosterH = 168.dp
    val WideW = 212.dp
    val WideH = 119.dp
    val EpisodeW = 196.dp
    val EpisodeH = 110.dp
    val ButtonH = 40.dp
    val PlayerButton = 40.dp
    val PlayerButtonMain = 48.dp
}

/** Focus feedback: white fill or ring plus a small scale, as in the mockup. */
object SeansFocus {
    const val ButtonScale = 1.05f
    const val CardScale = 1.06f
    const val PosterScale = 1.08f
    val Ring = 2.dp
    val RingGap = 2.dp
}

object SeansType {
    val Display = 38.sp   // Home hero title
    val Title = 36.sp     // Details title
    val Heading = 24.sp   // player title
    val Section = 17.sp   // row titles, panel titles
    val Body = 15.sp      // buttons, list items
    val Small = 14.sp     // meta, descriptions
    val Caption = 13.sp   // card captions, times
    val Micro = 12.sp     // badges, eyebrow
}
