package app.seans.tv.data

import app.seans.tv.data.catalog.CatalogCache
import app.seans.tv.data.catalog.KinopoiskApi
import app.seans.tv.data.catalog.KinopoiskQuotaGuard
import app.seans.tv.data.catalog.SeansCatalogRepository
import app.seans.tv.data.catalog.TmdbApi
import app.seans.tv.data.store.InMemoryKeyValueStore
import app.seans.tv.model.BookmarkStatus
import app.seans.tv.model.MediaType
import app.seans.tv.model.SeansError
import app.seans.tv.model.TitleRef
import java.io.File
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.runTest
import okhttp3.OkHttpClient
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder

class CatalogRepositoryTest {
    @get:Rule val tmp = TemporaryFolder()
    private val server = MockWebServer()
    private val store = FakeDocumentStore()
    private val prefs = InMemoryKeyValueStore()
    private val clock = FakeClock()
    private var uid: String? = "alice"

    @Before fun start() = server.start()
    @After fun stop() = server.shutdown()

    private fun TestScope.repo(scope: CoroutineScope = supervisedBackground(), dir: File = tmp.root) = SeansCatalogRepository(
        store = store,
        projected = FakeProjectedQueries(store),
        kinopoisk = KinopoiskApi(OkHttpClient(), server.url("/kinopoiskProxy").toString(), { uid?.let { "token-of-$it" } }, KinopoiskQuotaGuard(prefs, clock)),
        tmdb = TmdbApi(OkHttpClient(), server.url("/tmdbProxy").toString()),
        cache = CatalogCache(dir, clock),
        uid = { uid },
        scope = scope,
        clock = clock,
    )

    private fun json(body: String, code: Int = 200) = MockResponse().setResponseCode(code).setHeader("Content-Type", "application/json").setBody(body)

    private val kpMovie = """
        {"id":404900,"name":"Во все тяжкие","alternativeName":"Breaking Bad","year":2008,"type":"tv-series","isSeries":true,
         "description":"Учитель химии...","poster":{"url":"https://image.openmoviedb.com/kinopoisk-images/1/x/orig"},
         "backdrop":{"url":"https://image.tmdb.org/t/p/original/bd.jpg"},"rating":{"kp":8.9,"imdb":9.5},
         "genres":[{"name":"драма"},{"name":"криминал"},{"name":"триллер"},{"name":"комедия"},{"name":"аниме"}],"countries":[{"name":"США"}],"seriesLength":47,"ageRating":18,
         "seasonsInfo":[{"number":1,"episodesCount":7},{"number":2,"episodesCount":13}],"externalId":{"tmdb":999999}}
    """.trimIndent()

    @Test fun `a complete movies document needs no proxy call`() = runTest {
        store.put("movies", "1008113", mapOf(
            "kinopoiskId" to 1008113L, "name" to "Таксист", "description" to "В результате переворота...", "year" to 2017L,
            "posterUrl" to "https://avatars.mds.yandex.net/get-kinopoisk-image/1/x/600x900", "kpRating" to 8.244, "imdbRating" to 7.9,
            "avgRating" to 7.6, "type" to "movie", "genres" to listOf("история", "драма"), "countries" to listOf("Корея Южная"),
            "duration" to 137L, "ageRating" to 18L,
        ))
        store.put("ratings", "alice_1008113", mapOf("rating" to 9L))
        store.put("favorites", "alice_1008113", mapOf("status" to "plan_to_watch"))
        val details = repo().details(TitleRef(1008113, MediaType.MOVIE))
        assertEquals(0, server.requestCount)
        assertEquals("Таксист", details.summary.title)
        assertEquals(8.244, details.summary.ratings.kinopoisk!!, 0.0001)
        assertEquals(7.6, details.summary.ratings.community!!, 0.0001)
        assertEquals(9, details.summary.ratings.mine)
        assertEquals(BookmarkStatus.PLAN_TO_WATCH, details.bookmark)
        assertEquals(listOf("Корея Южная"), details.countries)
        assertEquals("18+", details.ageRating)
        assertEquals(137, details.durationMinutes)
    }

    @Test fun `an unknown title asks the proxy once, then the disk cache answers`() = runTest {
        server.enqueue(json(kpMovie))
        val repo = repo()
        val details = repo.details(TitleRef(404900, MediaType.MOVIE))
        val request = server.takeRequest()
        assertEquals("Bearer token-of-alice", request.getHeader("Authorization"))
        assertEquals("/v1.4/movie/404900", request.requestUrl!!.queryParameter("path"))
        assertEquals(MediaType.SERIES, details.summary.ref.mediaType)
        assertNull("Kinopoisk's externalId.tmdb is not an identity (K3)", details.summary.ref.tmdbId)
        assertEquals(listOf(1, 2), details.seasons.map { it.number })
        assertEquals(13, details.seasons[1].episodes.size)
        assertEquals("every genre is kept (anime routing)", "аниме", details.summary.genres.last())
        assertEquals("https://image.tmdb.org/t/p/w1280/bd.jpg", details.summary.backdropUrl)

        // Another screen open, and a restart (a new repository on the same cache directory).
        repo.details(TitleRef(404900, MediaType.SERIES))
        repo().details(TitleRef(404900, MediaType.SERIES))
        assertEquals(1, server.requestCount)
    }

    @Test fun `a verified TMDB identity fills missing seasons from TMDB`() = runTest {
        store.put("movies", "464963", mapOf(
            "kinopoiskId" to 464963L, "name" to "Игра престолов", "description" to "…", "isSeries" to true,
            "posterUrl" to "https://avatars.mds.yandex.net/x/600x900",
            "identity" to mapOf("status" to "VERIFIED", "tmdbId" to 1399L), "externalId" to mapOf("tmdb" to 5L),
        ))
        server.enqueue(json("""{"id":1399,"seasons":[{"season_number":0,"episode_count":2},{"season_number":1,"episode_count":10}]}"""))
        val details = repo().details(TitleRef(464963, MediaType.SERIES))
        assertEquals(1399L, details.summary.ref.tmdbId)
        assertEquals(listOf(0, 1), details.seasons.map { it.number })
        val request = server.takeRequest()
        assertEquals("/tmdbProxy", request.requestUrl!!.encodedPath)
        assertEquals("https://api.themoviedb.org/3/tv/1399?language=ru-RU", request.requestUrl!!.queryParameter("url"))
    }

    @Test fun `quota exhaustion stops Kinopoisk for six hours`() = runTest {
        server.enqueue(json("""{"error":{"code":"KP_QUOTA_EXHAUSTED","message":"x","retryable":true}}""", 503))
        val repo = repo()
        val error = runCatching { repo.details(TitleRef(1, MediaType.MOVIE)) }.exceptionOrNull() as SeansError
        assertEquals(SeansError.Code.QUOTA_EXHAUSTED, error.code)
        val again = runCatching { repo.details(TitleRef(2, MediaType.MOVIE)) }.exceptionOrNull() as SeansError
        assertEquals(SeansError.Code.QUOTA_EXHAUSTED, again.code)
        assertEquals("no request while the stop is active", 1, server.requestCount)

        clock.now += KinopoiskQuotaGuard.STOP_MS
        server.enqueue(json(kpMovie.replace("404900", "3")))
        repo.details(TitleRef(3, MediaType.MOVIE))
        assertEquals(2, server.requestCount)
    }

    @Test fun `quota trouble falls back to a partial movies document`() = runTest {
        store.put("movies", "7", mapOf("kinopoiskId" to 7L, "name" to "Без описания", "avgRating" to 8L))
        server.enqueue(json("""{"error":{"code":"KP_QUOTA_EXHAUSTED"}}""", 503))
        val details = repo().details(TitleRef(7, MediaType.MOVIE))
        assertEquals("Без описания", details.summary.title)
        assertEquals(8.0, details.summary.ratings.community!!, 0.0)
    }

    @Test fun `guests never call Kinopoisk`() = runTest {
        uid = null
        try {
            repo().details(TitleRef(5, MediaType.MOVIE))
            fail("expected UNAUTHORIZED")
        } catch (e: SeansError) {
            assertEquals(SeansError.Code.UNAUTHORIZED, e.code)
        }
        assertEquals(0, server.requestCount)
    }

    @Test fun `guest search maps TMDB hits to Kinopoisk IDs through movies tmdbId`() = runTest {
        uid = null
        store.put("movies", "258687", mapOf("kinopoiskId" to 258687L, "tmdbId" to 157336L, "name" to "Интерстеллар", "type" to "movie"))
        store.put("movies", "1", mapOf("kinopoiskId" to 1L, "tmdbId" to 157336L, "name" to "Сериал с тем же номером", "isSeries" to true))
        server.enqueue(json("""{"results":[{"media_type":"movie","id":157336},{"media_type":"person","id":1},{"media_type":"tv","id":42}]}"""))
        val repo = repo()
        val results = repo.search("интерстеллар")
        assertEquals(listOf(258687L), results.map { it.ref.kinopoiskId })
        assertTrue(server.takeRequest().requestUrl!!.queryParameter("url")!!.startsWith("https://api.themoviedb.org/3/search/multi?"))
        repo.search("  Интерстеллар ")
        assertEquals("results are cached", 1, server.requestCount)
        assertEquals(emptyList<Any>(), repo.search("ин"))
    }

    @Test fun `signed-in search adds one Kinopoisk search`() = runTest {
        server.dispatcher = object : okhttp3.mockwebserver.Dispatcher() {
            override fun dispatch(request: okhttp3.mockwebserver.RecordedRequest) =
                if (request.path!!.startsWith("/kinopoiskProxy")) json("""{"docs":[$kpMovie,{"id":0,"name":"broken"}]}""")
                else json("""{"results":[]}""")
        }
        val results = repo().search("во все тяжкие")
        assertEquals(listOf(404900L), results.map { it.ref.kinopoiskId })
        assertEquals(2, server.requestCount)
    }

    @Test fun `community uses the avgRating query shape and is cached`() = runTest {
        store.put("movies", "10", mapOf("kinopoiskId" to 10L, "name" to "A", "avgRating" to 9.0, "ratingsCount" to 3L, "hasCommunityRating" to true, "backdropUrl" to "https://image.tmdb.org/t/p/original/a.jpg"))
        store.put("movies", "11", mapOf("kinopoiskId" to 11L, "name" to "B", "avgRating" to 9.5, "ratingsCount" to 0L, "hasCommunityRating" to true))
        store.put("movies", "12", mapOf("kinopoiskId" to 12L, "name" to "C", "avgRating" to 8.0, "ratingsCount" to 1L, "hasCommunityRating" to true))
        val repo = repo()
        assertEquals(listOf(10L, 12L), repo.popularInCommunity().map { it.ref.kinopoiskId })
        assertTrue(store.reads.contains("movies?hasCommunityRating==true orderBy avgRating desc"))
        store.reads.clear()
        repo.popularInCommunity()
        assertTrue("the second call is served from the disk cache", store.reads.isEmpty())
        assertEquals(10L, repo.featured()!!.ref.kinopoiskId)
    }

    @Test fun `an old community row is returned at once and refreshed in the background`() = runTest {
        store.put("movies", "10", mapOf("kinopoiskId" to 10L, "name" to "A", "avgRating" to 9.0, "ratingsCount" to 3L, "hasCommunityRating" to true))
        val repo = repo()
        assertEquals(listOf(10L), repo.popularInCommunity().map { it.ref.kinopoiskId })

        store.put("movies", "20", mapOf("kinopoiskId" to 20L, "name" to "B", "avgRating" to 9.8, "ratingsCount" to 9L, "hasCommunityRating" to true))
        clock.now += CatalogCache.COMMUNITY_TTL_MS + 1
        store.reads.clear()
        assertEquals("the stale row comes back without waiting", listOf(10L), repo.popularInCommunity().map { it.ref.kinopoiskId })
        repo.awaitCommunityRefresh()
        assertEquals(1, store.reads.count { it.startsWith("movies?hasCommunityRating") })
        assertEquals("the next open shows the refreshed row", listOf(20L, 10L), repo.popularInCommunity().map { it.ref.kinopoiskId })
    }
}
