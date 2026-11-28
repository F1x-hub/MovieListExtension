package app.seans.tv.ui.home

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.background
import androidx.compose.foundation.focusGroup
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.wrapContentHeight
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.runtime.withFrameNanos
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusDirection
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusProperties
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.input.key.Key
import androidx.compose.ui.input.key.KeyEventType
import androidx.compose.ui.input.key.key
import androidx.compose.ui.input.key.onKeyEvent
import androidx.compose.ui.input.key.type
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import app.seans.tv.designsystem.FadedArt
import app.seans.tv.designsystem.ImageSizes
import app.seans.tv.designsystem.LiveNowCard
import app.seans.tv.designsystem.NoAutoScroll
import app.seans.tv.designsystem.PanelList
import app.seans.tv.designsystem.PanelOption
import app.seans.tv.designsystem.PanelTitle
import app.seans.tv.designsystem.PosterCard
import app.seans.tv.designsystem.RailItem
import app.seans.tv.designsystem.RailUserItem
import app.seans.tv.designsystem.RatingBadges
import app.seans.tv.designsystem.SText
import app.seans.tv.designsystem.SeansButton
import app.seans.tv.designsystem.SeansColors
import app.seans.tv.designsystem.SeansIcons
import app.seans.tv.designsystem.SeansRail
import app.seans.tv.designsystem.SeansSpace
import app.seans.tv.designsystem.SeansText
import app.seans.tv.designsystem.SidePanel
import app.seans.tv.designsystem.SlotCard
import app.seans.tv.designsystem.ToastHost
import app.seans.tv.designsystem.WideCard
import app.seans.tv.designsystem.cropAlignment
import app.seans.tv.designsystem.rememberToastState
import app.seans.tv.designsystem.tryRequestFocus
import app.seans.tv.model.AppGraph
import app.seans.tv.model.AuthState
import app.seans.tv.model.ContinueItem
import app.seans.tv.model.EpisodeKey
import app.seans.tv.model.LiveNow
import app.seans.tv.model.LiveSlot
import app.seans.tv.model.MediaType
import app.seans.tv.model.PlaybackRequest
import app.seans.tv.model.SelectionReason
import app.seans.tv.model.ServerClock
import app.seans.tv.model.TitleRef
import app.seans.tv.model.TitleSummary
import app.seans.tv.ui.common.BookmarkButton
import app.seans.tv.ui.common.BookmarkClick
import app.seans.tv.ui.common.BookmarkPanel
import app.seans.tv.ui.common.Format
import app.seans.tv.ui.common.bookmarkClick
import app.seans.tv.ui.common.RowFocus
import app.seans.tv.ui.common.StateMessage
import app.seans.tv.ui.common.TvRow
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

private const val ROW_HERO = "hero"
private const val ROW_CONTINUE = "continue"
private const val ROW_LIVE = "live"
private const val ROW_WATCHLIST = "watchlist"
private const val ROW_POPULAR = "popular"
private const val ROW_MESSAGE = "message"

/** The focused row sits at this height from the top (`top - 40` in the mockup). */
private val RowTopOffset = 40.dp

private sealed interface HomeRow {
    val key: String

    data class HeroRow(val hero: Hero) : HomeRow { override val key = ROW_HERO }
    data class ContinueRow(val items: List<ContinueItem>) : HomeRow { override val key = ROW_CONTINUE }
    data class LiveRow(val now: LiveNow?, val slots: List<LiveSlot>) : HomeRow { override val key = ROW_LIVE }
    data class PosterRow(override val key: String, val title: String, val items: List<TitleSummary>) : HomeRow
    data class Message(val text: String, val retry: Boolean) : HomeRow { override val key = ROW_MESSAGE }
}

/**
 * Home: the hero, then «Продолжить», «Эфир», «Буду смотреть», «Популярное». A guest has all but
 * «Буду смотреть» (progress is TV-local). The focused row moves to a fixed height near the top; Left at a row's
 * start opens the rail; Up and Down never fall into it. Coming back from Details or the player
 * lands on the card left last (D1).
 */
@Composable
fun HomeScreen(
    graph: AppGraph,
    onOpenDetails: (TitleRef) -> Unit,
    onPlay: (PlaybackRequest) -> Unit,
    onOpenSearch: () -> Unit,
    onOpenLive: () -> Unit,
) {
    val vm: HomeViewModel = viewModel { HomeViewModel(graph) }
    val auth by vm.auth.collectAsStateWithLifecycle()
    val hero by vm.hero.collectAsStateWithLifecycle()
    val cont by vm.continueItems.collectAsStateWithLifecycle()
    val watchlist by vm.watchlist.collectAsStateWithLifecycle()
    val liveNow by vm.liveNow.collectAsStateWithLifecycle()
    val programme by vm.programme.collectAsStateWithLifecycle()
    val popular by vm.popular.collectAsStateWithLifecycle()
    val memory = vm.focus
    val signedIn = auth is AuthState.SignedIn

    val scope = rememberCoroutineScope()
    val toast = rememberToastState()
    val focusManager = LocalFocusManager.current
    val density = LocalDensity.current
    val rowTopPx = with(density) { RowTopOffset.roundToPx() }

    val clockNow = vm.clock
    val upcoming = remember(programme, liveNow) {
        val now = clockNow.nowMs()
        // The channel's current item may itself be upcoming (a countdown); it is not repeated as a slot.
        programme.filter { it.startsAt > now && it.startsAt != liveNow?.startsAt }.take(6)
    }
    val onAir = liveNow?.let { isOnAir(it, clockNow.nowMs()) } == true

    // Rows appear together once the hero and «Популярное» have answered, so nothing is inserted
    // above a focused row later (the column keeps its first visible item when the list changes).
    val ready = hero != null && popular != null
    val rows: List<HomeRow> = if (!ready) listOf(HomeRow.Message("Загрузка…", retry = false)) else buildList {
        hero?.value?.let { add(HomeRow.HeroRow(it)) }
        cont?.value?.takeIf { it.isNotEmpty() }?.let { add(HomeRow.ContinueRow(it)) }
        if (liveNow != null || upcoming.isNotEmpty()) add(HomeRow.LiveRow(liveNow, upcoming))
        if (signedIn && watchlist.isNotEmpty()) add(HomeRow.PosterRow(ROW_WATCHLIST, "Буду смотреть", watchlist))
        popular?.value?.takeIf { it.isNotEmpty() }?.let { add(HomeRow.PosterRow(ROW_POPULAR, "Популярное", it)) }
        if (isEmpty()) add(HomeRow.Message("Нет связи с сервером. Проверьте интернет и попробуйте снова.", retry = true))
    }

    // Focus handles: hero buttons and each row's cards.
    val rowFocus = remember { mutableMapOf<String, RowFocus>() }
    fun focusOf(row: String) = rowFocus.getOrPut(row) { RowFocus() }
    val railCurrent = remember { FocusRequester() }
    var railActive by remember { mutableStateOf(false) }
    // The rail took focus because the content had nothing focusable yet (not the viewer's choice).
    var railAuto by remember { mutableStateOf(false) }
    var railFocused by remember { mutableStateOf(false) }
    var accountOpen by remember { mutableStateOf(false) }
    // The hero title whose bookmark the viewer is choosing (it has a status other than «Буду смотреть»).
    var bookmarkFor by remember { mutableStateOf<TitleSummary?>(null) }
    val accountOpener = remember { FocusRequester() }

    fun firstKey(row: HomeRow): Any? = when (row) {
        is HomeRow.HeroRow -> "play"
        is HomeRow.ContinueRow -> row.items.firstOrNull()?.summary?.ref?.kinopoiskId
        is HomeRow.LiveRow -> if (row.now != null) "now" else row.slots.firstOrNull()?.startsAt
        is HomeRow.PosterRow -> row.items.firstOrNull()?.ref?.kinopoiskId
        is HomeRow.Message -> "retry"
    }

    fun focusRow(key: String): Boolean {
        val row = rows.firstOrNull { it.key == key } ?: return false
        val f = focusOf(key)
        return f.request(memory.lastKey[key]) || f.request(firstKey(row))
    }

    /** Back to where the viewer was: the remembered row, else the first row. */
    fun restoreFocus(): Boolean {
        val remembered = memory.row?.takeIf { r -> rows.any { it.key == r } }
        return (remembered != null && focusRow(remembered)) || rows.any { focusRow(it.key) }
    }

    fun scrollToRow(key: String) {
        val index = rows.indexOfFirst { it.key == key }
        if (index < 0) return
        scope.launch {
            // Instant, not animated: on the TV the response matters more than the motion.
            if (index == 0) memory.column.scrollToItem(0)
            else memory.column.scrollToItem(index, -rowTopPx)
        }
    }

    fun onFocused(row: String, item: Any) {
        val changed = memory.row != row
        memory.row = row
        memory.lastKey[row] = item
        if (changed) scrollToRow(row)
    }

    // Initial focus, and focus after coming back from another screen: once rows exist.
    val firstRowKey = rows.firstOrNull()?.key
    val stillLoading = (rows.singleOrNull() as? HomeRow.Message)?.retry == false
    LaunchedEffect(firstRowKey, stillLoading) {
        if (firstRowKey == null || stillLoading) return@LaunchedEffect
        withFrameNanos { }
        if (railActive && !railAuto) return@LaunchedEffect
        if (restoreFocus()) {
            railActive = false
            railAuto = false
        } else {
            railAuto = true
            railActive = true
        }
    }
    LaunchedEffect(railActive) {
        if (railActive) {
            withFrameNanos { }
            railCurrent.tryRequestFocus()
        }
    }

    BackHandler(enabled = !railActive && !accountOpen && bookmarkFor == null) {
        if (memory.row != null && memory.row != ROW_HERO && rows.any { it.key == ROW_HERO }) {
            memory.row = ROW_HERO
            scrollToRow(ROW_HERO)
            focusRow(ROW_HERO)
        } else {
            railAuto = false
            railActive = true
        }
    }

    Box(Modifier.fillMaxSize()) {
        // Content. Left at the start of a row opens the rail (the rail cannot take focus otherwise).
        NoAutoScroll {
            LazyColumn(
                state = memory.column,
                modifier = Modifier
                    .fillMaxSize()
                    .onKeyEvent { e ->
                        if (e.type == KeyEventType.KeyDown && e.key == Key.DirectionLeft && !railActive) {
                            if (!focusManager.moveFocus(FocusDirection.Left)) { railAuto = false; railActive = true }
                            true
                        } else {
                            false
                        }
                    }
                    .focusGroup(),
                contentPadding = PaddingValues(bottom = 60.dp),
            ) {
                items(rows, key = { it.key }) { row ->
                    when (row) {
                        is HomeRow.HeroRow -> HeroBlock(
                            hero = row.hero,
                            signedIn = signedIn,
                            focus = focusOf(ROW_HERO),
                            onFocused = { onFocused(ROW_HERO, it) },
                            onShown = { vm.ensureHeroDetails(row.hero.summary.ref) },
                            onPlay = { onPlay(heroRequest(row.hero)) },
                            onDetails = { onOpenDetails(row.hero.summary.ref) },
                            onBookmark = {
                                val summary = row.hero.summary
                                scope.launch {
                                    vm.currentBookmark(summary).fold(
                                        { current ->
                                            when (val click = bookmarkClick(current)) {
                                                is BookmarkClick.Set -> toast.show(vm.setBookmark(summary, click.status))
                                                BookmarkClick.Choose -> bookmarkFor = summary
                                            }
                                        },
                                        { toast.show("Не удалось проверить закладку") },
                                    )
                                }
                            },
                        )
                        is HomeRow.ContinueRow -> TvRow(
                            title = "Продолжить",
                            items = row.items,
                            key = { it.summary.ref.kinopoiskId },
                            state = memory.rowState(ROW_CONTINUE),
                            focus = focusOf(ROW_CONTINUE),
                            landingKey = memory.lastKey[ROW_CONTINUE],
                            onItemFocused = { onFocused(ROW_CONTINUE, it) },
                        ) { item, m ->
                            val p = item.position
                            val subtitle = listOfNotNull(p.episode?.shortLabel(), Format.remaining(p.remainingMs)).joinToString(" · ")
                            WideCard(
                                title = item.summary.title,
                                subtitle = subtitle,
                                imageUrl = item.summary.backdropUrl ?: item.summary.posterUrl,
                                progress = p.fraction,
                                onClick = {
                                    if (item.summary.ref.mediaType == MediaType.SERIES) onOpenDetails(item.summary.ref)
                                    else onPlay(PlaybackRequest(item.summary, p.episode, SelectionReason.RESUME))
                                },
                                modifier = m,
                            )
                        }
                        is HomeRow.LiveRow -> TvRow(
                            title = "Эфир",
                            items = buildList<Any> { row.now?.let { add(it) }; addAll(row.slots) },
                            key = { if (it is LiveNow) "now" else (it as LiveSlot).startsAt },
                            state = memory.rowState(ROW_LIVE),
                            focus = focusOf(ROW_LIVE),
                            landingKey = memory.lastKey[ROW_LIVE],
                            onItemFocused = { onFocused(ROW_LIVE, it) },
                        ) { item, m ->
                            if (item is LiveNow) LiveCard(item, vm.clock, onOpenLive, m)
                            else {
                                val slot = item as LiveSlot
                                SlotCard(
                                    time = Format.clock(slot.startsAt),
                                    title = slot.title,
                                    caption = slot.caption ?: slot.endsAt?.let { Format.duration(((it - slot.startsAt) / 60_000).toInt()) },
                                    onClick = onOpenLive,
                                    modifier = m,
                                )
                            }
                        }
                        is HomeRow.PosterRow -> TvRow(
                            title = row.title,
                            items = row.items,
                            key = { it.ref.kinopoiskId },
                            state = memory.rowState(row.key),
                            focus = focusOf(row.key),
                            landingKey = memory.lastKey[row.key],
                            onItemFocused = { onFocused(row.key, it) },
                        ) { item, m ->
                            PosterCard(
                                title = item.title,
                                imageUrl = item.posterUrl,
                                kpRating = item.ratings.kinopoisk,
                                onClick = { onOpenDetails(item.ref) },
                                modifier = m,
                            )
                        }
                        is HomeRow.Message -> MessageBlock(row, focusOf(ROW_MESSAGE), onRetry = { vm.load() })
                    }
                }
            }
        }

        // The rail: focusable only while active, so Up/Down in the content never land in it.
        SeansRail(
            open = railFocused,
            modifier = Modifier
                .align(Alignment.CenterStart)
                .onFocusChanged {
                    val had = railFocused
                    railFocused = it.hasFocus
                    if (had && !it.hasFocus) railActive = false
                }
                .onKeyEvent { e ->
                    if (e.key == Key.DirectionRight && e.type == KeyEventType.KeyDown) {
                        railActive = false
                        restoreFocus()
                        true
                    } else {
                        false
                    }
                }
                .focusProperties {
                    canFocus = railActive
                    // Directional moves stay in the rail (Right is handled above); requestFocus may leave.
                    onExit = { if (requestedFocusDirection != FocusDirection.Enter) cancelFocusChange() }
                }
                .focusGroup(),
        ) { open ->
            val railItem = Modifier.focusProperties { canFocus = railActive }
            RailItem(SeansIcons.Search, "Поиск", current = false, open = open, onClick = onOpenSearch, modifier = railItem)
            RailItem(
                SeansIcons.Film, "Главная", current = true, open = open,
                onClick = { railActive = false; restoreFocus() },
                modifier = railItem.focusRequester(railCurrent),
            )
            RailItem(SeansIcons.Live, "Эфир", current = false, open = open, onClick = onOpenLive, modifier = railItem, dot = onAir)
            if (signedIn) {
                RailItem(
                    SeansIcons.Bookmark, "Буду смотреть", current = false, open = open,
                    onClick = {
                        railActive = false
                        if (rows.any { it.key == ROW_WATCHLIST }) {
                            memory.row = ROW_WATCHLIST
                            scrollToRow(ROW_WATCHLIST)
                            scope.launch { delay(120); focusRow(ROW_WATCHLIST) }
                        } else {
                            restoreFocus()
                            toast.show("В «Буду смотреть» пока пусто")
                        }
                    },
                    modifier = railItem,
                )
            }
            Spacer(Modifier.weight(1f))
            val user = (auth as? AuthState.SignedIn)?.profile
            if (user != null) {
                RailUserItem(
                    initial = user.displayName.trim().take(1).uppercase().ifEmpty { "?" },
                    label = user.displayName,
                    open = open,
                    onClick = { accountOpen = true },
                    modifier = railItem.focusRequester(accountOpener),
                )
            } else {
                RailItem(SeansIcons.User, "Войти", current = false, open = open, onClick = { vm.signOut() }, modifier = railItem)
            }
        }

        SidePanel(
            visible = accountOpen,
            onDismiss = { accountOpen = false; scope.launch { withFrameNanos { }; accountOpener.tryRequestFocus() } },
        ) {
            PanelTitle((auth as? AuthState.SignedIn)?.profile?.displayName ?: "Аккаунт")
            PanelList {
                PanelOption(
                    title = "Выйти из аккаунта",
                    subtitle = "Закладки останутся в расширении",
                    onClick = { accountOpen = false; vm.signOut() },
                )
                PanelOption(title = "Отмена", onClick = { accountOpen = false; scope.launch { withFrameNanos { }; accountOpener.tryRequestFocus() } })
            }
        }

        BookmarkPanel(
            visible = bookmarkFor != null,
            current = (hero?.value)?.takeIf { it.summary.ref.kinopoiskId == bookmarkFor?.ref?.kinopoiskId }?.bookmark,
            onPick = { status ->
                val summary = bookmarkFor
                bookmarkFor = null
                if (summary != null) {
                    scope.launch {
                        toast.show(vm.setBookmark(summary, status))
                        withFrameNanos { }
                        focusOf(ROW_HERO).request("bookmark")
                    }
                }
            },
            onDismiss = {
                bookmarkFor = null
                scope.launch { withFrameNanos { }; focusOf(ROW_HERO).request("bookmark") }
            },
        )
        ToastHost(toast)
    }
}

private fun heroRequest(hero: Hero): PlaybackRequest {
    val p = hero.position
    if (p != null) return PlaybackRequest(hero.summary, p.episode, SelectionReason.RESUME)
    val episode = if (hero.summary.ref.mediaType == MediaType.SERIES) EpisodeKey(1, 1) else null
    return PlaybackRequest(hero.summary, episode, if (episode != null) SelectionReason.EPISODE_PICK else SelectionReason.RESUME)
}

/** «Смотреть с 1:12:40», «С2 · Е5 с 14:20» or «Смотреть». */
private fun heroPlayLabel(hero: Hero): String {
    val p = hero.position ?: return "Смотреть"
    val at = Format.position(p.positionMs)
    return p.episode?.let { "${it.shortLabel()} с $at" } ?: "Смотреть с $at"
}

@Composable
private fun HeroBlock(
    hero: Hero,
    signedIn: Boolean,
    focus: RowFocus,
    onFocused: (String) -> Unit,
    onShown: () -> Unit,
    onPlay: () -> Unit,
    onDetails: () -> Unit,
    onBookmark: () -> Unit,
) {
    LaunchedEffect(hero.summary.ref.kinopoiskId) { onShown() }
    val s = hero.summary
    val d = hero.details
    Box(Modifier.fillMaxWidth().height(330.dp)) {
        // The art is 640x400 and overflows the hero by 70 dp under the first row, fading out.
        Box(Modifier.align(Alignment.TopEnd).wrapContentHeight(Alignment.Top, unbounded = true)) {
            FadedArt(
                url = s.backdropUrl ?: s.posterUrl,
                widthPx = ImageSizes.BACKDROP_W,
                heightPx = ImageSizes.BACKDROP_H,
                modifier = Modifier.size(640.dp, 400.dp),
                alignment = cropAlignment(0.22f),
                // A longer fade stands in for the mockup's separate text shade: one blended layer
                // less over the hero (the TV's GPU is the frame-time bottleneck).
                fadeInX = 0.58f,
            )
        }
        Column(Modifier.padding(start = SeansSpace.ContentStart, top = 46.dp).width(420.dp)) {
            SText(if (hero.position != null) "ПРОДОЛЖИТЬ ПРОСМОТР" else "РЕКОМЕНДУЕМ", SeansText.Eyebrow, Modifier.padding(bottom = 6.dp), maxLines = 1)
            SText(s.title, SeansText.Display, maxLines = 2)
            val meta = listOfNotNull(
                s.year?.toString(),
                s.genres.take(2).takeIf { it.isNotEmpty() }?.joinToString(", "),
                d?.let { det ->
                    if (s.ref.mediaType == MediaType.SERIES) det.seasons.size.takeIf { it > 0 }?.let { Format.seasons(it) }
                    else det.durationMinutes?.let { Format.duration(it) }
                },
                d?.ageRating,
            )
            if (meta.isNotEmpty()) SText(meta.joinToString(" · "), SeansText.Meta, Modifier.padding(top = 6.dp), maxLines = 1)
            RatingBadges(s.ratings.kinopoisk, s.ratings.imdb, s.ratings.mine, s.ratings.community, Modifier.padding(top = 10.dp))
            d?.description?.let { SText(it, SeansText.Description, Modifier.padding(top = 12.dp), maxLines = 2) }
            Row(Modifier.padding(top = 18.dp), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                HeroButton(focus, "play", onFocused) { m ->
                    SeansButton(heroPlayLabel(hero), onPlay, m, icon = SeansIcons.Play, primary = true, progress = hero.position?.fraction)
                }
                HeroButton(focus, "more", onFocused) { m -> SeansButton("Подробнее", onDetails, m) }
                if (signedIn) {
                    HeroButton(focus, "bookmark", onFocused) { m ->
                        BookmarkButton(hero.bookmark, onBookmark, m)
                    }
                }
            }
        }
    }
}

/** Registers a hero button in the row's focus handles, like a card of a [TvRow]. */
@Composable
private fun HeroButton(focus: RowFocus, key: String, onFocused: (String) -> Unit, content: @Composable (Modifier) -> Unit) {
    val requester = remember { FocusRequester() }
    androidx.compose.runtime.DisposableEffect(key) {
        focus.register(key, requester)
        onDispose { focus.unregister(key, requester) }
    }
    content(Modifier.focusRequester(requester).onFocusChanged { if (it.isFocused) onFocused(key) })
}

/** The live card's time left and progress tick in this leaf only (every 30 s). */
/** The channel's item is playing now (not a countdown to it, not finished). */
private fun isOnAir(now: LiveNow, t: Long): Boolean = t >= now.startsAt && (now.endsAt == null || t < now.endsAt!!)

@Composable
private fun LiveCard(now: LiveNow, clock: ServerClock, onClick: () -> Unit, modifier: Modifier) {
    val t by produceState(clock.nowMs(), now) {
        while (true) {
            value = clock.nowMs()
            delay(30_000)
        }
    }
    val end = now.endsAt
    val started = t >= now.startsAt
    val meta = when {
        !started -> "начнётся в ${Format.clock(now.startsAt)}"
        end != null -> Format.timeLeft(end - t)
        else -> "сейчас"
    }
    LiveNowCard(
        title = now.title,
        meta = meta,
        imageUrl = now.posterUrl,
        progress = { if (started && end != null && end > now.startsAt) (t - now.startsAt).toFloat() / (end - now.startsAt) else 0f },
        onClick = onClick,
        modifier = modifier,
        onAir = isOnAir(now, t),
    )
}

@Composable
private fun MessageBlock(row: HomeRow.Message, focus: RowFocus, onRetry: () -> Unit) {
    Box(Modifier.fillMaxWidth().height(330.dp).padding(start = SeansSpace.ContentStart, top = 120.dp)) {
        StateMessage(
            text = row.text,
            action = if (row.retry) {
                {
                    HeroButton(focus, "retry", onFocused = {}) { m -> SeansButton("Повторить", onRetry, m, primary = true) }
                }
            } else {
                null
            },
        )
    }
}
