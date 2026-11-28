package app.seans.tv.ui.login

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.requiredWidth
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.runtime.withFrameNanos
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.CompositingStrategy
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import app.seans.tv.designsystem.ImageSizes
import app.seans.tv.designsystem.SText
import app.seans.tv.designsystem.SeansButton
import app.seans.tv.designsystem.SeansColors
import app.seans.tv.designsystem.SeansIcon
import app.seans.tv.designsystem.SeansIcons
import app.seans.tv.designsystem.SeansImage
import app.seans.tv.designsystem.SeansRadius
import app.seans.tv.designsystem.SeansSpace
import app.seans.tv.designsystem.SeansText
import app.seans.tv.designsystem.saturationFilter
import app.seans.tv.designsystem.tryRequestFocus
import app.seans.tv.model.AppGraph
import app.seans.tv.model.AuthState
import app.seans.tv.model.DeviceLogin
import com.google.zxing.BarcodeFormat
import com.google.zxing.EncodeHintType
import com.google.zxing.qrcode.QRCodeWriter
import com.google.zxing.qrcode.decoder.ErrorCorrectionLevel
import kotlinx.coroutines.delay
import androidx.compose.foundation.text.BasicText

/**
 * Sign-in on the TV: a QR for the phone and a 6-character code for the extension's
 * Settings → «Телевизор». No email sign-in. «Продолжить без входа» opens the guest mode.
 */
@Composable
fun LoginScreen(graph: AppGraph) {
    val vm: LoginViewModel = viewModel { LoginViewModel(graph) }
    val ui by vm.ui.collectAsStateWithLifecycle()
    val auth by vm.auth.collectAsStateWithLifecycle()
    val wall by vm.wall.collectAsStateWithLifecycle()
    val guest = remember { FocusRequester() }
    LaunchedEffect(Unit) {
        withFrameNanos { }
        guest.tryRequestFocus()
    }

    Box(Modifier.fillMaxSize()) {
        PosterWall(wall)
        Box(
            Modifier.fillMaxSize().background(
                Brush.horizontalGradient(
                    0.38f to SeansColors.Bg,
                    0.62f to SeansColors.Bg.copy(alpha = 0.86f),
                    1f to SeansColors.Bg.copy(alpha = 0.55f),
                ),
            ),
        )

        Column(Modifier.padding(start = SeansSpace.SafeX, top = 46.dp).width(470.dp)) {
            Row(horizontalArrangement = Arrangement.spacedBy(10.dp), verticalAlignment = Alignment.CenterVertically) {
                Image(painterResource(SeansIcons.Logo), null, Modifier.size(28.dp))
                SText("Сеанс", SeansText.Brand)
            }
            SText("Вход на телевизоре", SeansText.LoginTitle, Modifier.padding(top = 34.dp))
            SText(
                "Закладки и ваши оценки — из того же аккаунта, что в расширении.",
                SeansText.Lead,
                Modifier.padding(top = 10.dp),
            )
            Column(Modifier.padding(top = 22.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                Step(SeansIcons.Camera, "Наведите камеру телефона на код справа")
                Step(SeansIcons.Key, "или в расширении: Настройки → «Телевизор» и введите код")
            }

            when (val state = ui) {
                is LoginUi.Code -> {
                    CodeText(state.login.userCode, Modifier.padding(top = 22.dp))
                    Countdown(state.login)
                }
                LoginUi.Loading -> SText("Получаем код…", SeansText.Subtitle, Modifier.padding(top = 30.dp))
                is LoginUi.Error -> SText(state.message, SeansText.Subtitle, Modifier.padding(top = 30.dp))
            }

            (auth as? AuthState.NotApproved)?.let { NotApprovedNotice(it.status) }

            Row(Modifier.padding(top = 26.dp), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                SeansButton("Продолжить без входа", onClick = vm::continueAsGuest, modifier = Modifier.focusRequester(guest))
            }
        }

        (ui as? LoginUi.Code)?.let { code ->
            Column(
                Modifier.align(Alignment.CenterEnd).padding(end = 96.dp),
                horizontalAlignment = Alignment.CenterHorizontally,
            ) {
                Box(
                    Modifier
                        .size(236.dp)
                        .clip(RoundedCornerShape(SeansRadius.Xl))
                        .background(Color.White)
                        .padding(14.dp),
                ) { QrCode(code.login.verificationUrl, Modifier.fillMaxSize()) }
                SText(displayUrl(code.login.verificationUrl), SeansText.Meta, Modifier.padding(top = 12.dp), maxLines = 1)
            }
        }
    }
}

@Composable
private fun Step(icon: Int, text: String) {
    Row(horizontalArrangement = Arrangement.spacedBy(12.dp), verticalAlignment = Alignment.CenterVertically) {
        val shape = RoundedCornerShape(SeansRadius.Md)
        Box(
            Modifier.size(36.dp).clip(shape).background(SeansColors.Bg3).border(1.dp, SeansColors.Line, shape),
            contentAlignment = Alignment.Center,
        ) { SeansIcon(icon) }
        SText(text, SeansText.Body)
    }
}

/** «K7Q·4MD»: the code in two halves around a dim dot. */
@Composable
private fun CodeText(code: String, modifier: Modifier) {
    val text = buildAnnotatedString {
        if (code.length == 6) {
            append(code.take(3))
            withStyle(SpanStyle(color = SeansColors.Text3, letterSpacing = 0.sp)) { append("\u2009·\u2009") }
            append(code.drop(3))
        } else {
            append(code)
        }
    }
    BasicText(text, modifier, style = SeansText.Code, maxLines = 1)
}

@Composable
private fun Countdown(login: DeviceLogin) {
    val left by produceState((login.expiresAt - System.currentTimeMillis()).coerceAtLeast(0), login) {
        while (true) {
            value = (login.expiresAt - System.currentTimeMillis()).coerceAtLeast(0)
            delay(1_000)
        }
    }
    val total = left / 1000
    Row(Modifier.padding(top = 2.dp), horizontalArrangement = Arrangement.spacedBy(6.dp), verticalAlignment = Alignment.CenterVertically) {
        SeansIcon(SeansIcons.Clock, tint = SeansColors.Text3, size = 16.dp)
        SText(
            if (total > 0) "Код обновится через ${total / 60}:${(total % 60).toString().padStart(2, '0')}" else "Обновляем код…",
            SeansText.Caption,
            maxLines = 1,
        )
    }
}

@Composable
private fun NotApprovedNotice(status: String) {
    val text = when (status.lowercase()) {
        "pending" -> "Этот аккаунт ещё ждёт одобрения администратора. Войдите снова, когда его одобрят."
        "rejected", "blocked", "denied" -> "Для этого аккаунта доступ закрыт. Войдите другим аккаунтом."
        else -> "Аккаунт не одобрен. Войдите другим аккаунтом или продолжите без входа."
    }
    Row(Modifier.padding(top = 16.dp).fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        SeansIcon(SeansIcons.Info, Modifier.padding(top = 1.dp), tint = SeansColors.Text, size = 18.dp)
        SText(text, SeansText.Body.copy(lineHeight = 21.sp), Modifier.weight(1f))
    }
}

/** `https://host/tv?c=K7Q4MD` → `host/tv`, the caption under the QR. */
private fun displayUrl(url: String): String = url.substringAfter("://").substringBefore('?')

/** The QR of [url], drawn module by module (no bitmap). */
@Composable
private fun QrCode(url: String, modifier: Modifier) {
    val matrix = remember(url) {
        runCatching {
            QRCodeWriter().encode(
                url, BarcodeFormat.QR_CODE, 0, 0,
                mapOf(EncodeHintType.MARGIN to 0, EncodeHintType.ERROR_CORRECTION to ErrorCorrectionLevel.M),
            )
        }.getOrNull()
    }
    Canvas(modifier) {
        val m = matrix ?: return@Canvas
        val cell = size.minDimension / m.width
        val dark = SeansColors.Bg
        for (y in 0 until m.height) for (x in 0 until m.width) {
            if (m.get(x, y)) drawRect(dark, Offset(x * cell, y * cell), Size(cell + 0.5f, cell + 0.5f))
        }
    }
}

/** The dim, tilted wall of posters behind the sign-in text (`.login-wall`). */
@Composable
private fun PosterWall(urls: List<String>) {
    if (urls.isEmpty()) return
    val filter = remember { saturationFilter(0.6f) }
    Box(
        Modifier
            .offset(x = 380.dp, y = (-80).dp)
            .requiredWidth(640.dp)
            .graphicsLayer { rotationZ = -8f; alpha = 0.22f; compositingStrategy = CompositingStrategy.ModulateAlpha },
    ) {
        Column(verticalArrangement = Arrangement.spacedBy(14.dp)) {
            urls.chunked(3).forEach { line ->
                Row(horizontalArrangement = Arrangement.spacedBy(14.dp)) {
                    line.forEach { url ->
                        SeansImage(
                            url, ImageSizes.POSTER_W, ImageSizes.POSTER_H,
                            Modifier.weight(1f).aspectRatio(2f / 3f).clip(RoundedCornerShape(SeansRadius.Lg)),
                            colorFilter = filter,
                        )
                    }
                    repeat(3 - line.size) { Box(Modifier.weight(1f)) }
                }
            }
        }
    }
}
