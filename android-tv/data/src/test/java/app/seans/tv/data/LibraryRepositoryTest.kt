package app.seans.tv.data

import app.seans.tv.data.catalog.CatalogCache
import app.seans.tv.data.catalog.KinopoiskApi
import app.seans.tv.data.catalog.KinopoiskQuotaGuard
import app.seans.tv.data.catalog.MovieMapper
import app.seans.tv.data.catalog.SeansCatalogRepository
import app.seans.tv.data.catalog.TmdbApi
import app.seans.tv.data.library.SeansLibraryRepository
import app.seans.tv.data.progress.SeansProgressRepository
import app.seans.tv.data.store.InMemoryKeyValueStore
import app.seans.tv.data.store.ServerTimestamp
import app.seans.tv.model.AuthState
import app.seans.tv.model.BookmarkStatus
import app.seans.tv.model.EpisodeKey
import app.seans.tv.model.MediaType
import app.seans.tv.model.PlaybackPosition
import app.seans.tv.model.Ratings
import app.seans.tv.model.SeansError
import app.seans.tv.model.TitleRef
import app.seans.tv.model.TitleSummary
import app.seans.tv.model.UserProfile
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.runTest
import okhttp3.OkHttpClient
import okhttp3.mockwebserver.MockWebServer
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder

class LibraryRepositoryTest {
    @get:Rule val tmp = TemporaryFolder()
    private val server = MockWebServer()
    private val store = FakeDocumentStore()
    private val clock = FakeClock()
    private val auth = MutableStateFlow<AuthState>(AuthState.SignedIn(UserProfile("alice", "Alice")))

    @Before fun start() = server.start()
    @After fun stop() = server.shutdown()

    private lateinit var progress: SeansProgressRepository

    private fun TestScope.repo(): SeansLibraryRepository {
        val catalog = SeansCatalogRepository(
            store = store,
            projected = FakeProjectedQueries(store),
            kinopoisk = KinopoiskApi(OkHttpClient(), server.url("/kp").toString(), { "t" }, KinopoiskQuotaGuard(InMemoryKeyValueStore(), clock)),
            tmdb = TmdbApi(OkHttpClient(), server.url("/tmdb").toString()),
            cache = CatalogCache(tmp.newFolder(), clock),
            uid = { (auth.value as? AuthState.SignedIn)?.profile?.uid },
            scope = supervisedBackground(),
            clock = clock,
        )
        progress = SeansProgressRepository(tmp.newFolder())
        return SeansLibraryRepository(store, auth, catalog, progress, backgroundScope)
    }

    private val summary = TitleSummary(
        ref = TitleRef(258687, MediaType.MOVIE),
        title = "Интерстеллар",
        year = 2014,
        posterUrl = "https://avatars.mds.yandex.net/get-kinopoisk-image/1/x/600x900",
        ratings = Ratings(kinopoisk = 8.6, imdb = 8.7),
        genres = listOf("фантастика"),
    )

    @Test fun `a new bookmark carries FavoriteService's full field set`() = runTest {
        val repo = repo()
        repo.setBookmarkStatus(summary, BookmarkStatus.PLAN_TO_WATCH)
        val (path, data, merge) = store.writes.single()
        assertEquals("favorites/alice_258687", path)
        assertTrue(merge)
        assertEquals(
            setOf("userId", "movieId", "movieTitle", "movieTitleRu", "posterPath", "releaseYear", "genres", "description",
                "kpRating", "imdbRating", "avgRating", "userRating", "notes", "type", "status", "seasonsInfo", "updatedAt",
                "createdAt", "favoritedAt"),
            data.keys,
        )
        assertEquals("alice", data["userId"])
        assertEquals(258687L, data["movieId"])
        assertEquals("plan_to_watch", data["status"])
        assertEquals("movie", data["type"])
        assertEquals(ServerTimestamp, data["updatedAt"])
        assertEquals(ServerTimestamp, data["createdAt"])
        assertEquals(BookmarkStatus.PLAN_TO_WATCH, repo.bookmarkStatus(summary.ref))
    }

    @Test fun `changing a status keeps createdAt and the extension's own fields`() = runTest {
        store.put("favorites", "alice_258687", mapOf(
            "userId" to "alice", "movieId" to 258687L, "status" to "favorite", "notes" to "пересмотреть",
            "description" to "Фантастика", "createdAt" to 1L, "favoritedAt" to 1L, "type" to "movie",
            "posterPath" to "https://image.tmdb.org/t/p/w500/own.jpg", "movieId" to "258687",
        ))
        val repo = repo()
        repo.setBookmarkStatus(summary, BookmarkStatus.WATCHED)
        val (_, data, _) = store.writes.single()
        assertFalse(data.containsKey("createdAt"))
        assertFalse(data.containsKey("favoritedAt"))
        assertEquals("пересмотреть", data["notes"])
        assertEquals("Фантастика", data["description"])
        assertEquals("https://image.tmdb.org/t/p/w500/own.jpg", data["posterPath"])
        assertEquals("258687", data["movieId"])
        assertEquals(1L, store["favorites/alice_258687"]!!["createdAt"])
        assertEquals("watched", store["favorites/alice_258687"]!!["status"])

        repo.setBookmarkStatus(summary, null)
        assertNull(store["favorites/alice_258687"])
        assertNull(repo.bookmarkStatus(summary.ref))
    }

    @Test fun `bookmarks are read by userId and sorted on the client`() = runTest {
        store.put("favorites", "alice_1", mapOf("userId" to "alice", "movieId" to 1L, "movieTitle" to "Старый", "status" to "plan_to_watch", "updatedAt" to 100L))
        store.put("favorites", "alice_2", mapOf("userId" to "alice", "movieId" to 2L, "movieTitle" to "Новый", "status" to "plan_to_watch", "updatedAt" to 300L))
        store.put("favorites", "alice_3", mapOf("userId" to "alice", "movieId" to 3L, "movieTitle" to "Любимый", "status" to "favorite", "favoritedAt" to 200L))
        store.put("favorites", "bob_4", mapOf("userId" to "bob", "movieId" to 4L, "movieTitle" to "Чужой", "status" to "plan_to_watch"))
        store.put("favorites", "alice_0", mapOf("userId" to "alice", "movieId" to 0L, "movieTitle" to "Битый", "status" to "plan_to_watch"))
        val repo = repo()
        assertEquals(listOf(2L, 1L), repo.bookmarks(BookmarkStatus.PLAN_TO_WATCH).first().map { it.ref.kinopoiskId })
        assertEquals(listOf("Любимый"), repo.bookmarks(BookmarkStatus.FAVORITE).first().map { it.title })
    }

    @Test fun `guests have no bookmarks and cannot write`() = runTest {
        auth.value = AuthState.Guest
        val repo = repo()
        assertTrue(repo.bookmarks(BookmarkStatus.WATCHING).first().isEmpty())
        assertNull(repo.bookmarkStatus(summary.ref))
        val error = runCatching { repo.setBookmarkStatus(summary, BookmarkStatus.WATCHING) }.exceptionOrNull() as SeansError
        assertEquals(SeansError.Code.UNAUTHORIZED, error.code)
        assertTrue(store.writes.isEmpty())
    }

    @Test fun `continue watching joins progress with summaries the TV already has`() = runTest {
        store.put("favorites", "alice_404900", mapOf(
            "userId" to "alice", "movieId" to 404900L, "movieTitle" to "Во все тяжкие", "status" to "watching",
            "posterPath" to "https://avatars.mds.yandex.net/x/600x900", "kpRating" to 8.9, "type" to "anime",
        ))
        store.put("movies", "258687", mapOf("kinopoiskId" to 258687L, "name" to "Интерстеллар", "posterUrl" to "https://avatars.mds.yandex.net/y/600x900"))
        val repo = repo()
        progress.save(PlaybackPosition(TitleRef(404900, MediaType.SERIES), EpisodeKey(2, 5), 860_000, 2_820_000, 2))
        progress.save(PlaybackPosition(TitleRef(258687, MediaType.MOVIE), null, 4_320_000, 10_140_000, 1))
        progress.save(PlaybackPosition(TitleRef(999, MediaType.MOVIE), null, 5_000, 6_000_000, 3)) // nothing known: skipped
        val items = repo.continueWatching().first { it.size == 2 }
        assertEquals(listOf(404900L, 258687L), items.map { it.summary.ref.kinopoiskId })
        assertEquals(MediaType.SERIES, items[0].summary.ref.mediaType)
        assertEquals(8.9, items[0].summary.ratings.kinopoisk!!, 0.0)
        assertEquals(EpisodeKey(2, 5), items[0].position.episode)
        assertEquals(0, server.requestCount)
    }

    @Test fun `the favorites document ID gives the Kinopoisk ID when movieId is missing`() {
        val doc = app.seans.tv.data.store.Doc("alice_77044", mapOf("movieTitle" to "Друзья", "seasonsInfo" to listOf(mapOf("number" to 1L, "episodesCount" to 24L))))
        val parsed = SeansLibraryRepository.summaryOf(doc)!!
        assertEquals(77044L, parsed.ref.kinopoiskId)
        assertEquals(MediaType.SERIES, parsed.ref.mediaType)
        assertNull(MovieMapper.summary(mapOf("movieTitle" to "без ID")))
    }
}
