package app.seans.tv.ui.search

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import app.seans.tv.model.AppGraph
import app.seans.tv.model.TitleSummary
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.FlowPreview
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.debounce
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.flow
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch

sealed interface SearchState {
    /** Fewer than [MIN_LETTERS] letters: the screen shows the community's popular titles. */
    data object Idle : SearchState
    data object Loading : SearchState
    data class Results(val query: String, val items: List<TitleSummary>) : SearchState
    data class Failed(val query: String) : SearchState
}

/** The catalogue shares the extension's Kinopoisk quota: wait 600 ms after typing, 3+ letters. */
const val SEARCH_DEBOUNCE_MS = 600L
const val MIN_LETTERS = 3

@OptIn(FlowPreview::class, ExperimentalCoroutinesApi::class)
class SearchViewModel(private val graph: AppGraph) : ViewModel() {
    private val _query = MutableStateFlow("")
    val query: StateFlow<String> = _query.asStateFlow()

    private val retry = MutableStateFlow(0)

    /** Where focus was (`А`, `space`, `kp:326`), for coming back from Details. */
    var lastFocus: String? = null

    /** Answers per query, so editing back to an earlier query costs no request. */
    private val cache = object : LinkedHashMap<String, List<TitleSummary>>(16, 0.75f, true) {
        override fun removeEldestEntry(eldest: MutableMap.MutableEntry<String, List<TitleSummary>>?) = size > 30
    }

    val state: StateFlow<SearchState> = _query
        .map { it.trim().lowercase() }
        .debounce(SEARCH_DEBOUNCE_MS)
        .distinctUntilChanged()
        .flatMapLatest { q -> retry.map { q } }
        .flatMapLatest { q ->
            if (q.count { it.isLetterOrDigit() } < MIN_LETTERS) flowOf<SearchState>(SearchState.Idle)
            else flow<SearchState> {
                cache[q]?.let { emit(SearchState.Results(q, it)); return@flow }
                emit(SearchState.Loading)
                emit(
                    runCatching { graph.catalog.search(q) }.fold(
                        { cache[q] = it; SearchState.Results(q, it) },
                        { SearchState.Failed(q) },
                    ),
                )
            }
        }
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), SearchState.Idle)

    private val _popular = MutableStateFlow<List<TitleSummary>>(emptyList())
    val popular: StateFlow<List<TitleSummary>> = _popular.asStateFlow()

    init {
        viewModelScope.launch { _popular.value = runCatching { graph.catalog.popularInCommunity() }.getOrDefault(emptyList()) }
    }

    fun type(key: String) { _query.value = (_query.value + key).take(60) }
    fun backspace() { _query.value = _query.value.dropLast(1) }
    fun clear() { _query.value = "" }
    fun set(text: String) { _query.value = text.uppercase().take(60) }
    fun retry() { retry.value++ }
}
