package app.seans.tv.ui.home

import androidx.compose.foundation.lazy.LazyListState
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import app.seans.tv.model.AppGraph
import app.seans.tv.model.AuthState
import app.seans.tv.model.BookmarkStatus
import app.seans.tv.model.ContinueItem
import app.seans.tv.model.LiveNow
import app.seans.tv.model.LiveSlot
import app.seans.tv.model.PlaybackPosition
import app.seans.tv.model.TitleDetails
import app.seans.tv.model.TitleRef
import app.seans.tv.model.TitleSummary
import app.seans.tv.ui.common.bookmarkToast
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.catch
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.flowOn
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

/** What the hero shows: the latest «Продолжить» item, otherwise the catalogue's featured title. */
data class Hero(
    val summary: TitleSummary,
    val position: PlaybackPosition?,
    val details: TitleDetails? = null,
    val bookmark: BookmarkStatus? = null,
)

/** Loading stays distinct from empty, so an empty row is hidden and a failed Home offers «Повторить». */
data class Loaded<T>(val value: T, val failed: Boolean = false)

/**
 * Where focus was on Home, kept across Details/Player and back (D1): the row and, per row, the key
 * of the card left last. Scroll states live here too, so the rows come back where they were.
 */
class HomeFocusMemory {
    var row: String? = null
    val lastKey = mutableMapOf<String, Any>()
    val column = LazyListState()
    private val rows = mutableMapOf<String, LazyListState>()
    fun rowState(row: String): LazyListState = rows.getOrPut(row) { LazyListState() }
}

private const val STOP_TIMEOUT_MS = 5_000L
private const val CONTINUE_GRACE_MS = 2_500L

@OptIn(ExperimentalCoroutinesApi::class)
class HomeViewModel(private val graph: AppGraph) : ViewModel() {
    val focus = HomeFocusMemory()

    val auth: StateFlow<AuthState> = graph.auth.state

    private val signedIn = auth.map { it is AuthState.SignedIn }.distinctUntilChanged()

    /**
     * «Продолжить» is TV-local progress, so a guest has it too. Re-subscribed when the account
     * changes (the summaries come from that account's bookmarks). «Буду смотреть» stays signed-in only.
     */
    val continueItems: StateFlow<Loaded<List<ContinueItem>>?> = signedIn.flatMapLatest {
        graph.library.continueWatching().map { Loaded(it) }.catch { emit(Loaded(emptyList(), failed = true)) }
    }.flowOn(Dispatchers.Default).stateIn(viewModelScope, SharingStarted.WhileSubscribed(STOP_TIMEOUT_MS), null)

    val watchlist: StateFlow<List<TitleSummary>> = signedIn.flatMapLatest { signed ->
        if (!signed) flowOf(emptyList())
        else graph.library.bookmarks(BookmarkStatus.PLAN_TO_WATCH).catch { emit(emptyList()) }
    }.flowOn(Dispatchers.Default).stateIn(viewModelScope, SharingStarted.WhileSubscribed(STOP_TIMEOUT_MS), emptyList())

    // The live flows tick every second over the whole schedule: compute off the main thread.
    val liveNow: StateFlow<LiveNow?> = graph.live.now().catch { emit(null) }.flowOn(Dispatchers.Default)
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(STOP_TIMEOUT_MS), null)

    val programme: StateFlow<List<LiveSlot>> = graph.live.programme().catch { emit(emptyList()) }.flowOn(Dispatchers.Default)
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(STOP_TIMEOUT_MS), emptyList())

    val clock = graph.live.clock

    // One-off catalogue reads: loaded once per ViewModel (never on focus), kept across navigation.
    private val _popular = MutableStateFlow<Loaded<List<TitleSummary>>?>(null)
    val popular: StateFlow<Loaded<List<TitleSummary>>?> = _popular.asStateFlow()
    private val featured = MutableStateFlow<Loaded<TitleSummary?>?>(null)

    private val heroDetails = MutableStateFlow<Map<Long, TitleDetails>>(emptyMap())
    private val heroBookmarks = MutableStateFlow<Map<Long, BookmarkStatus?>>(emptyMap())
    private val requestedDetails = mutableSetOf<Long>()

    /** «Продолжить» gets this long to answer before the hero falls back to the featured title. */
    private val continueGraceOver = MutableStateFlow(false)

    val hero: StateFlow<Loaded<Hero?>?> = combine(continueItems, featured, heroDetails, heroBookmarks, continueGraceOver) { cont, feat, details, marks, graceOver ->
        val first = cont?.value?.firstOrNull()
        val base = when {
            first != null -> Hero(first.summary, first.position)
            cont == null && !graceOver -> return@combine null // still loading
            feat == null -> return@combine null
            feat.value != null -> Hero(feat.value, null)
            else -> return@combine Loaded<Hero?>(null, failed = feat.failed)
        }
        val kp = base.summary.ref.kinopoiskId
        Loaded<Hero?>(base.copy(details = details[kp], bookmark = marks[kp]))
    }.flowOn(Dispatchers.Default).stateIn(viewModelScope, SharingStarted.WhileSubscribed(STOP_TIMEOUT_MS), null)

    init {
        load()
        viewModelScope.launch {
            delay(CONTINUE_GRACE_MS)
            continueGraceOver.value = true
        }
    }

    /** Loads the one-off parts; also the «Повторить» action of an offline Home. */
    fun load() {
        viewModelScope.launch {
            if (_popular.value?.failed != false) {
                _popular.value = runCatching { graph.catalog.popularInCommunity() }
                    .fold({ Loaded(it) }, { Loaded(emptyList(), failed = true) })
            }
        }
        viewModelScope.launch {
            if (featured.value?.failed != false) {
                featured.value = runCatching { graph.catalog.featured() }
                    .fold({ Loaded(it) }, { Loaded(null, failed = true) })
            }
        }
    }

    /**
     * The hero's description, duration and age come from `details()`: one read per hero title per
     * ViewModel (the data layer serves it from Firestore and its cache first). Failures are ignored.
     */
    fun ensureHeroDetails(ref: TitleRef) {
        val kp = ref.kinopoiskId
        if (!requestedDetails.add(kp)) return
        viewModelScope.launch {
            runCatching { graph.catalog.details(ref) }.onSuccess { d -> heroDetails.value = heroDetails.value + (kp to d) }
            if (auth.value is AuthState.SignedIn) {
                runCatching { graph.library.bookmarkStatus(ref) }.onSuccess { s -> heroBookmarks.value = heroBookmarks.value + (kp to s) }
            }
        }
    }

    /**
     * The hero title's bookmark status, read from Firestore when it is not known yet, so a click
     * never overwrites a status it has not seen. A failed read is a failure, not «no bookmark».
     */
    suspend fun currentBookmark(summary: TitleSummary): Result<BookmarkStatus?> {
        val kp = summary.ref.kinopoiskId
        if (heroBookmarks.value.containsKey(kp)) return Result.success(heroBookmarks.value[kp])
        return runCatching { graph.library.bookmarkStatus(summary.ref) }
            .onSuccess { s -> heroBookmarks.value = heroBookmarks.value + (kp to s) }
    }

    /** Writes [status] (null removes the bookmark) and returns the toast text. */
    suspend fun setBookmark(summary: TitleSummary, status: BookmarkStatus?): String {
        val kp = summary.ref.kinopoiskId
        return runCatching { graph.library.setBookmarkStatus(summary, status) }.fold(
            { heroBookmarks.value = heroBookmarks.value + (kp to status); bookmarkToast(status) },
            { "Не удалось сохранить закладку" },
        )
    }

    fun signOut() {
        viewModelScope.launch { runCatching { graph.auth.signOut() } }
    }
}
