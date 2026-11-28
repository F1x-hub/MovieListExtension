package app.seans.tv.designsystem

import androidx.compose.foundation.text.BasicText
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.DeviceFontFamilyName
import androidx.compose.ui.text.font.Font
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.googlefonts.Font as GoogleFontFont
import androidx.compose.ui.text.googlefonts.GoogleFont
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.TextUnit
import androidx.compose.ui.unit.em
import androidx.compose.ui.unit.sp

private val fontProvider = GoogleFont.Provider(
    providerAuthority = "com.google.android.gms.fonts",
    providerPackage = "com.google.android.gms",
    certificates = R.array.com_google_android_gms_fonts_certs,
)

private val inter = GoogleFont("Inter")
private val weights = listOf(FontWeight.Normal, FontWeight.Medium, FontWeight.SemiBold, FontWeight.Bold)

/**
 * Inter from Google downloadable fonts (the APK carries no font file). Until the provider answers,
 * or when it cannot, the device's sans-serif (Roboto) of the same weight is used.
 */
val SeansFontFamily: FontFamily = FontFamily(
    weights.map { GoogleFontFont(googleFont = inter, fontProvider = fontProvider, weight = it) } +
        weights.map { Font(DeviceFontFamilyName("sans-serif"), weight = it) },
)

/** Text styles of the mockup (`tv.css`); sizes in sp equal the mockup's px on the 960x540 canvas. */
object SeansText {
    private fun style(size: TextUnit, weight: FontWeight, color: Color = SeansColors.Text, lineHeight: TextUnit = TextUnit.Unspecified, spacing: TextUnit = TextUnit.Unspecified) =
        TextStyle(fontFamily = SeansFontFamily, fontSize = size, fontWeight = weight, color = color, lineHeight = lineHeight, letterSpacing = spacing)

    val Display = style(38.sp, FontWeight.Bold, lineHeight = 40.sp, spacing = (-0.01).em)
    val Title = style(36.sp, FontWeight.Bold, lineHeight = 38.sp)
    val LoginTitle = style(34.sp, FontWeight.Bold, lineHeight = 37.sp)
    val Code = style(40.sp, FontWeight.Bold, spacing = 0.12.em)
    val Heading = style(24.sp, FontWeight.Bold)
    val Brand = style(18.sp, FontWeight.Bold)
    val Field = style(18.sp, FontWeight.SemiBold)
    val Section = style(17.sp, FontWeight.SemiBold)
    val PanelTitle = style(17.sp, FontWeight.Bold)
    val Lead = style(16.sp, FontWeight.Normal, SeansColors.Text2, lineHeight = 23.sp)
    val Key = style(16.sp, FontWeight.SemiBold)
    val Button = style(15.sp, FontWeight.SemiBold)
    val Body = style(15.sp, FontWeight.Normal)
    val Subtitle = style(15.sp, FontWeight.Normal, SeansColors.Text2)
    val CardTitle = style(14.sp, FontWeight.SemiBold, SeansColors.Text2)
    val Meta = style(14.sp, FontWeight.Normal, SeansColors.Text2)
    val Description = style(14.sp, FontWeight.Normal, SeansColors.Text2, lineHeight = 20.sp)
    val Tab = style(14.sp, FontWeight.SemiBold, SeansColors.Text2)
    val Caption = style(13.sp, FontWeight.Normal, SeansColors.Text3)
    val CaptionStrong = style(13.sp, FontWeight.SemiBold, SeansColors.Text2)
    val Badge = style(13.sp, FontWeight.Bold)
    val Eyebrow = style(12.sp, FontWeight.SemiBold, SeansColors.Text2, spacing = 0.08.em)
    val Micro = style(12.sp, FontWeight.Bold)
}

/** Plain text in the design-system styles. [color] overrides the style's colour. */
@Composable
fun SText(
    text: String,
    style: TextStyle,
    modifier: Modifier = Modifier,
    color: Color = Color.Unspecified,
    maxLines: Int = Int.MAX_VALUE,
) {
    BasicText(
        text = text,
        modifier = modifier,
        style = if (color != Color.Unspecified) style.copy(color = color) else style,
        maxLines = maxLines,
        overflow = if (maxLines == Int.MAX_VALUE) TextOverflow.Clip else TextOverflow.Ellipsis,
        softWrap = maxLines != 1,
    )
}
