package app.seans.tv.ui.search

import android.app.Activity
import android.content.Intent
import android.speech.RecognizerIntent
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.keyframes
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.runtime.withFrameNanos
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import app.seans.tv.designsystem.PosterCard
import app.seans.tv.designsystem.SText
import app.seans.tv.designsystem.SeansButton
import app.seans.tv.designsystem.SeansColors
import app.seans.tv.designsystem.SeansIcon
import app.seans.tv.designsystem.SeansIcons
import app.seans.tv.designsystem.SeansMotion
import app.seans.tv.designsystem.SeansRadius
import app.seans.tv.designsystem.SeansSizes
import app.seans.tv.designsystem.SeansSpace
import app.seans.tv.designsystem.SeansText
import app.seans.tv.designsystem.rememberFocusInteraction
import app.seans.tv.designsystem.roundedFill
import app.seans.tv.designsystem.roundedLine
import app.seans.tv.designsystem.seansClickable
import app.seans.tv.designsystem.tryRequestFocus
import app.seans.tv.model.AppGraph
import app.seans.tv.model.TitleRef
import app.seans.tv.model.TitleSummary
import app.seans.tv.ui.common.RowFocus

private val LetterRows = listOf("АБВГДЕЁЖ", "ЗИЙКЛМНО", "ПРСТУФХЦ", "ЧШЩЪЫЬЭЮ").map { row -> row.map { it.toString() } }

/** Search: the mockup's Russian keyboard on the left, a grid of posters on the right. */
@Composable
fun SearchScreen(graph: AppGraph, onOpenDetails: (TitleRef) -> Unit) {
    val vm: SearchViewModel = viewModel { SearchViewModel(graph) }
    val query by vm.query.collectAsStateWithLifecycle()
    val state by vm.state.collectAsStateWithLifecycle()
    val popular by vm.popular.collectAsStateWithLifecycle()

    val keys = remember { RowFocus() }
    val results = remember { RowFocus() }
    val memory = vm
    LaunchedEffect(Unit) {
        withFrameNanos { }
        val last = memory.lastFocus
        val ok = when {
            last == null -> false
            last.startsWith("kp:") -> results.request(last.removePrefix("kp:").toLongOrNull())
            else -> keys.request(last)
        }
        if (!ok) keys.request("А")
    }

    val voice = rememberVoiceSearch { vm.set(it) }

    Box(Modifier.fillMaxSize()) {
        Column(
            Modifier
                .padding(start = SeansSpace.SafeX, top = SeansSpace.SafeY, bottom = SeansSpace.SafeY)
                .width(340.dp)
                .fillMaxHeight(),
        ) {
            SearchField(query)
            Column(Modifier.padding(top = 16.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                LetterRows.forEach { row ->
                    Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                        row.forEach { k -> Key(k, keys, memory, weight = 1f) { vm.type(k) } }
                    }
                }
                Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    Key("Я", keys, memory, weight = 1f) { vm.type("Я") }
                    Key("Пробел", keys, memory, weight = 3f, muted = true, id = "space") { vm.type(" ") }
                    Key("Стереть", keys, memory, weight = 2f, muted = true, id = "back") { vm.backspace() }
                    Key("Очистить", keys, memory, weight = 2f, muted = true, id = "clear") { vm.clear() }
                }
            }
            Spacer(Modifier.weight(1f))
            if (voice != null) {
                val requester = remember { FocusRequester() }
                DisposableEffect(Unit) {
                    keys.register("voice", requester)
                    onDispose { keys.unregister("voice", requester) }
                }
                SeansButton(
                    "Голосовой поиск", onClick = voice, icon = SeansIcons.Mic,
                    modifier = Modifier.focusRequester(requester).onFocusChanged { if (it.isFocused) memory.lastFocus = "voice" },
                )
            }
        }

        Column(Modifier.padding(start = 420.dp, top = SeansSpace.SafeY, end = SeansSpace.SafeX).fillMaxSize()) {
            val letters = query.count { it.isLetterOrDigit() }
            val (title, items) = when (val s = state) {
                is SearchState.Results -> (if (s.items.isEmpty()) "Ничего не нашлось" else "Найдено: ${s.items.size}") to s.items
                SearchState.Loading -> "Ищем…" to emptyList()
                is SearchState.Failed -> "Не удалось выполнить поиск" to emptyList()
                SearchState.Idle -> when {
                    letters in 1 until MIN_LETTERS -> "Нужно хотя бы $MIN_LETTERS буквы" to popular
                    popular.isNotEmpty() -> "Популярное" to popular
                    else -> "Введите название" to emptyList()
                }
            }
            SText(title, SeansText.Section, Modifier.padding(bottom = 10.dp), maxLines = 1)
            if (state is SearchState.Failed) {
                SeansButton("Повторить", onClick = vm::retry, primary = true)
            }
            ResultGrid(items, results, memory, onOpenDetails)
        }
    }
}

@Composable
private fun SearchField(query: String) {
    val shape = RoundedCornerShape(SeansRadius.Md)
    Row(
        Modifier
            .fillMaxWidth()
            .height(48.dp)
            .clip(shape)
            .background(SeansColors.Bg3)
            .border(1.dp, SeansColors.Line2, shape)
            .padding(horizontal = 14.dp),
        horizontalArrangement = Arrangement.spacedBy(10.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        SeansIcon(SeansIcons.Search, tint = SeansColors.Text2)
        if (query.isEmpty()) {
            Caret()
            SText("Название фильма или сериала", SeansText.Field.copy(fontWeight = androidx.compose.ui.text.font.FontWeight.Medium), color = SeansColors.Text3, maxLines = 1)
        } else {
            Row(verticalAlignment = Alignment.CenterVertically) {
                SText(query, SeansText.Field, maxLines = 1)
                Caret()
            }
        }
    }
}

@Composable
private fun Caret() {
    val t = rememberInfiniteTransition(label = "caret")
    val a = t.animateFloat(1f, 0f, infiniteRepeatable(keyframes { durationMillis = 1000; 1f at 0; 1f at 499; 0f at 500; 0f at 999 }), label = "a")
    Box(Modifier.padding(start = 2.dp).width(2.dp).height(22.dp).graphicsLayer { alpha = a.value }.background(SeansColors.Text))
}

@Composable
private fun RowScope.Key(
    label: String,
    keys: RowFocus,
    memory: SearchViewModel,
    weight: Float,
    muted: Boolean = false,
    id: String = label,
    onClick: () -> Unit,
) {
    val requester = remember { FocusRequester() }
    DisposableEffect(id) {
        keys.register(id, requester)
        onDispose { keys.unregister(id, requester) }
    }
    val interaction = rememberFocusInteraction()
    val focused = interaction.focused
    val fill by animateColorAsState(if (focused) SeansColors.Text else SeansColors.Bg2, tween(SeansMotion.Focus), label = "key")
    val shape = RoundedCornerShape(SeansRadius.Md)
    Box(
        Modifier
            .weight(weight)
            .focusRequester(requester)
            .onFocusChanged { if (it.isFocused) memory.lastFocus = id }
            .seansClickable(interaction, 1.08f, description = label, onClick = onClick)
            .height(36.dp)
            .roundedFill({ fill }, SeansRadius.Md)
            .then(if (focused) Modifier else Modifier.roundedLine(SeansColors.Line, SeansRadius.Md)),
        contentAlignment = Alignment.Center,
    ) {
        SText(
            label,
            if (muted) SeansText.Tab else SeansText.Key,
            color = when {
                focused -> SeansColors.OnFocus
                muted -> SeansColors.Text2
                else -> SeansColors.Text
            },
            maxLines = 1,
        )
    }
}

@Composable
private fun ResultGrid(items: List<TitleSummary>, results: RowFocus, memory: SearchViewModel, onOpenDetails: (TitleRef) -> Unit) {
    LazyVerticalGrid(
        columns = GridCells.Fixed(4),
        modifier = Modifier.offset(x = (-8).dp).width(SeansSizes.PosterW * 4 + 18.dp * 3 + 16.dp).fillMaxHeight(),
        contentPadding = PaddingValues(start = 8.dp, end = 8.dp, top = 8.dp, bottom = 40.dp),
        horizontalArrangement = Arrangement.spacedBy(18.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp),
    ) {
        items(items, key = { it.ref.kinopoiskId }) { item ->
            val requester = remember { FocusRequester() }
            DisposableEffect(item.ref.kinopoiskId) {
                results.register(item.ref.kinopoiskId, requester)
                onDispose { results.unregister(item.ref.kinopoiskId, requester) }
            }
            PosterCard(
                title = item.title,
                imageUrl = item.posterUrl,
                kpRating = item.ratings.kinopoisk,
                onClick = { onOpenDetails(item.ref) },
                modifier = Modifier
                    .focusRequester(requester)
                    .onFocusChanged { if (it.isFocused) memory.lastFocus = "kp:${item.ref.kinopoiskId}" },
                alwaysCaption = true,
            )
        }
    }
}

/**
 * Voice input through the system recogniser (`RecognizerIntent`, no microphone permission). Null
 * when the TV has no recogniser, and then the button is not shown.
 */
@Composable
private fun rememberVoiceSearch(onText: (String) -> Unit): (() -> Unit)? {
    val context = LocalContext.current
    val intent = remember {
        Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH)
            .putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
            .putExtra(RecognizerIntent.EXTRA_LANGUAGE, "ru-RU")
            .putExtra(RecognizerIntent.EXTRA_PROMPT, "Название фильма или сериала")
    }
    val available = remember { intent.resolveActivity(context.packageManager) != null }
    val launcher = rememberLauncherForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
        if (result.resultCode == Activity.RESULT_OK) {
            result.data?.getStringArrayListExtra(RecognizerIntent.EXTRA_RESULTS)?.firstOrNull()?.let(onText)
        }
    }
    return if (available) ({ runCatching { launcher.launch(intent) } }) else null
}
