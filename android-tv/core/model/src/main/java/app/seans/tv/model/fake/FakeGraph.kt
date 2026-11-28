package app.seans.tv.model.fake

import app.seans.tv.model.AppGraph
import app.seans.tv.model.AuthRepository
import app.seans.tv.model.AuthState
import app.seans.tv.model.BookmarkStatus
import app.seans.tv.model.ServerClock
import app.seans.tv.network.SeansHttp
import app.seans.tv.model.CatalogRepository
import app.seans.tv.model.ContinueItem
import app.seans.tv.model.DeviceLogin
import app.seans.tv.model.DeviceLoginStatus
import app.seans.tv.model.EpisodeInfo
import app.seans.tv.model.EpisodeKey
import app.seans.tv.model.LibraryRepository
import app.seans.tv.model.LiveNow
import app.seans.tv.model.LiveSlot
import app.seans.tv.model.LiveSummaryProvider
import app.seans.tv.model.MediaType
import app.seans.tv.model.PlayableStream
import app.seans.tv.model.PlaybackPosition
import app.seans.tv.model.ProgressRepository
import app.seans.tv.model.ProviderId
import app.seans.tv.model.Ratings
import app.seans.tv.model.SeasonInfo
import app.seans.tv.model.SourceEvent
import app.seans.tv.model.SourceOption
import app.seans.tv.model.SourceQuery
import app.seans.tv.model.SourceResolver
import app.seans.tv.model.StreamFormat
import app.seans.tv.model.TitleDetails
import app.seans.tv.model.TitleRef
import app.seans.tv.model.TitleSummary
import app.seans.tv.model.UserProfile
import app.seans.tv.model.VoiceOption
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.flow
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.flow.map

/**
 * Sample data matching the approved mockup, so every module can build and preview its screens
 * before the real repositories exist. Never used in a release graph.
 */
object FakeData {
    private fun poster(kp: Long) = "https://st.kp.yandex.net/images/film_iphone/iphone360_$kp.jpg"

    fun title(kp: Long, name: String, kpRating: Double, type: MediaType = MediaType.MOVIE, year: Int? = null) = TitleSummary(
        ref = TitleRef(kp, type),
        title = name,
        year = year,
        posterUrl = poster(kp),
        ratings = Ratings(kinopoisk = kpRating),
    )

    val interstellar = title(258687, "Интерстеллар", 8.6, year = 2014).copy(
        ratings = Ratings(kinopoisk = 8.6, imdb = 8.7, mine = 10), genres = listOf("фантастика", "драма"),
    )
    val breakingBad = title(404900, "Во все тяжкие", 8.9, MediaType.SERIES, 2008).copy(
        originalTitle = "Breaking Bad", ratings = Ratings(kinopoisk = 8.9, imdb = 9.5, mine = 10, community = 9.2),
        genres = listOf("драма", "криминал", "триллер"),
    )
    val friends = title(77044, "Друзья", 9.2, MediaType.SERIES, 1994)
    val got = title(464963, "Игра престолов", 9.0, MediaType.SERIES, 2011)
    val knivesOut = title(1188529, "Достать ножи", 7.8, year = 2019)
    val fightClub = title(361, "Бойцовский клуб", 8.7, year = 1999)

    val watchlist = listOf(
        title(841700, "Марсианин", 7.7), knivesOut, title(840152, "Изгой-один", 7.5),
        title(5492, "Вечное сияние чистого разума", 8.0), title(679486, "Тайна Коко", 8.7),
        title(329, "Список Шиндлера", 8.8), title(41519, "Брат", 8.3),
    )
    val popular = listOf(
        title(326, "Побег из Шоушенка", 9.1), title(435, "Зелёная миля", 9.1), title(448, "Форрест Гамп", 8.9),
        title(535341, "1+1", 8.8), title(1143242, "Джентльмены", 8.6), title(342, "Криминальное чтиво", 8.6), fightClub,
    )

    private val s2Titles = listOf(
        "Seven Thirty-Seven", "Grilled", "Bit by a Dead Bee", "Down", "Breakage", "Peekaboo", "Negro y Azul",
        "Better Call Saul", "4 Days Out", "Over", "Mandala", "Phoenix", "ABQ",
    )
    val breakingBadSeasons = listOf(7, 13, 13, 13, 16).mapIndexed { i, count ->
        val season = i + 1
        SeasonInfo(season, (1..count).map { e ->
            EpisodeInfo(EpisodeKey(season, e), if (season == 2) s2Titles[e - 1] else "Серия $e", 47 * 60)
        })
    }

    fun position(summary: TitleSummary, episode: EpisodeKey?, positionMin: Int, durationMin: Int) = PlaybackPosition(
        ref = summary.ref, episode = episode, positionMs = positionMin * 60_000L, durationMs = durationMin * 60_000L,
        updatedAt = System.currentTimeMillis(),
    )

    val continueItems = listOf(
        ContinueItem(breakingBad, position(breakingBad, EpisodeKey(2, 5), 14, 47)),
        ContinueItem(interstellar, position(interstellar, null, 72, 169)),
        ContinueItem(friends, position(friends, EpisodeKey(4, 11), 17, 22)),
        ContinueItem(got, position(got, EpisodeKey(1, 3), 7, 55)),
        ContinueItem(knivesOut, position(knivesOut, null, 79, 130)),
    )

    val profile = UserProfile(uid = "fake-uid", displayName = "Ираклий")
}

class FakeGraph(override val http: SeansHttp) : AppGraph {
    override val auth = object : AuthRepository {
        private val _state = MutableStateFlow<AuthState>(AuthState.SignedOut)
        override val state: StateFlow<AuthState> = _state.asStateFlow()
        override suspend fun startDeviceLogin() =
            DeviceLogin("K7Q4MD", "https://movielistdb-13208.web.app/tv?c=K7Q4MD", System.currentTimeMillis() + 600_000, 5)
        override fun awaitDeviceLogin(login: DeviceLogin): Flow<DeviceLoginStatus> = flow {
            emit(DeviceLoginStatus.Waiting)
        }
        override suspend fun continueAsGuest() { _state.value = AuthState.Guest }
        override suspend fun signOut() { _state.value = AuthState.SignedOut }
        override suspend fun idToken(): String? = null
    }

    override val catalog = object : CatalogRepository {
        override suspend fun details(ref: TitleRef): TitleDetails {
            val all = FakeData.watchlist + FakeData.popular + FakeData.continueItems.map { it.summary }
            val summary = all.firstOrNull { it.ref.kinopoiskId == ref.kinopoiskId } ?: FakeData.breakingBad
            val series = summary.ref.mediaType == MediaType.SERIES
            return TitleDetails(
                summary = summary,
                description = "Школьный учитель химии узнаёт, что смертельно болен, и начинает варить метамфетамин, чтобы обеспечить семью.",
                countries = listOf("США"),
                durationMinutes = if (series) 47 else 120,
                ageRating = "18+",
                seasons = if (series) FakeData.breakingBadSeasons else emptyList(),
            )
        }
        override suspend fun search(query: String): List<TitleSummary> {
            val q = query.trim().lowercase()
            if (q.isEmpty()) return emptyList()
            return (FakeData.watchlist + FakeData.popular + FakeData.continueItems.map { it.summary })
                .distinctBy { it.ref.kinopoiskId }
                .filter { s -> s.title.lowercase().split(' ', '-').any { it.startsWith(q) } }
        }
        override suspend fun popularInCommunity() = FakeData.popular
        override suspend fun featured() = FakeData.interstellar
    }

    override val library = object : LibraryRepository {
        private val marks = MutableStateFlow(FakeData.watchlist.associate { it.ref.kinopoiskId to (it to BookmarkStatus.PLAN_TO_WATCH) })
        override fun bookmarks(status: BookmarkStatus): Flow<List<TitleSummary>> =
            marks.map { all -> all.values.filter { it.second == status }.map { it.first } }
        override suspend fun bookmarkStatus(ref: TitleRef) = marks.value[ref.kinopoiskId]?.second
        override suspend fun setBookmarkStatus(summary: TitleSummary, status: BookmarkStatus?) {
            val id = summary.ref.kinopoiskId
            marks.value = if (status == null) marks.value - id else marks.value + (id to (summary to status))
        }
        override fun continueWatching(): Flow<List<ContinueItem>> = flowOf(FakeData.continueItems)
    }

    override val progress = object : ProgressRepository {
        private val store = MutableStateFlow(FakeData.continueItems.map { it.position })
        // Keyed by Kinopoisk ID only, as the contract requires.
        private fun same(a: TitleRef, b: TitleRef) = a.kinopoiskId == b.kinopoiskId
        override suspend fun get(ref: TitleRef, episode: EpisodeKey?) = store.value.firstOrNull { same(it.ref, ref) && it.episode == episode }
        override suspend fun latestFor(ref: TitleRef) = store.value.filter { same(it.ref, ref) }.maxByOrNull { it.updatedAt }
        override suspend fun episodesOf(ref: TitleRef) =
            store.value.filter { same(it.ref, ref) && it.episode != null }.associateBy { it.episode!! }
        override suspend fun save(position: PlaybackPosition) {
            store.value = listOf(position) + store.value.filterNot { same(it.ref, position.ref) && it.episode == position.episode }
        }
        override fun recent(limit: Int): Flow<List<PlaybackPosition>> = store.map { it.take(limit) }
    }

    override val sources = object : SourceResolver {
        override fun find(query: SourceQuery): Flow<SourceEvent> = flow {
            delay(300)
            emit(SourceEvent.Found(SourceOption(ProviderId.SEASONVAR, handle = "fake", quality = "1080p",
                voices = listOf(VoiceOption("lostfilm", "LostFilm"), VoiceOption("kubik", "Кубик в Кубе")))))
            emit(SourceEvent.Found(SourceOption(ProviderId.ANIMEGO, handle = "fake", quality = "720p",
                voices = listOf(VoiceOption("anilibria", "AniLibria")))))
            emit(SourceEvent.Done)
        }
        // A public HLS test stream, so the player can be tried without the real parsers.
        override suspend fun resolve(option: SourceOption, episode: EpisodeKey?, voiceId: String?, fresh: Boolean) = PlayableStream(
            url = "https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8",
            format = StreamFormat.HLS,
            episode = episode,
            providerId = option.providerId,
            voiceId = voiceId,
        )
    }

    override val live = object : LiveSummaryProvider {
        override val clock = ServerClock { System.currentTimeMillis() }
        override fun now(): Flow<LiveNow?> = flowOf(
            LiveNow("Бойцовский клуб", FakeData.fightClub.ref, null, FakeData.fightClub.posterUrl,
                System.currentTimeMillis() - 55 * 60_000, System.currentTimeMillis() + 64 * 60_000),
        )
        override fun programme(): Flow<List<LiveSlot>> {
            val now = System.currentTimeMillis()
            return flowOf(listOf(
                LiveSlot("Бойцовский клуб", now - 55 * 60_000, now + 64 * 60_000, FakeData.fightClub.ref),
                LiveSlot("Друзья", now + 64 * 60_000, now + 134 * 60_000, FakeData.friends.ref, caption = "С1 · Е1–Е3"),
                LiveSlot("Марсианин", now + 134 * 60_000, now + 278 * 60_000, caption = "2 ч 24 мин"),
            ))
        }
    }
}
