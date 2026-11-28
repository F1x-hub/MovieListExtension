package app.seans.tv.sources

import app.seans.tv.model.MediaType
import app.seans.tv.model.SourceQuery
import app.seans.tv.model.StreamFormat
import app.seans.tv.model.TitleRef
import app.seans.tv.sources.rutube.RtItem
import app.seans.tv.sources.rutube.RutubeParser
import app.seans.tv.sources.rutube.RutubeProvider
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** Ports of `tests/rutubeParser.test.js`, plus the provider on captured fixtures. */
class RutubeTest {
    @Test
    fun `query cascade`() {
        assertEquals(listOf("Матрица 1999", "Матрица фильм", "Матрица"), RutubeParser.buildSearchQueries("Матрица", 1999))
        assertEquals(listOf("Интерстеллар фильм", "Интерстеллар"), RutubeParser.buildSearchQueries("Интерстеллар", null))
        assertEquals(
            listOf("Гарри Поттер Философский камень 2001", "Гарри Поттер Философский камень фильм", "Гарри Поттер Философский камень"),
            RutubeParser.buildSearchQueries("Гарри Поттер: Философский камень", 2001),
        )
    }

    @Test
    fun `UGC noise is flagged, real uploads are not`() {
        val g = RutubeParser::isUgcGarbage
        assertTrue(g("Обзор на фильм Матрица 1999", ""))
        assertTrue(g("Матрица (1999) - Разбор сюжета и скрытый смысл", ""))
        assertTrue(g("Матрица 1999 Реакция блогера", ""))
        assertTrue(g("Прохождение игры The Matrix Path of Neo стрим 1", ""))
        assertTrue(g("Матрица 1999 Трейлер на русском", ""))
        assertTrue(g("Матрица 1999 Саундтрек OST Clubbed to Death", ""))
        assertTrue(g("Саундтреки из фильма \"Амели\" 2004 г.", "Амели"))
        assertTrue(g("Музыка из фильма Амели", "Амели"))
        assertTrue(g("Матрица 1999 Топ 10 фактов и пасхалок", ""))
        assertFalse(g("Матрица / The Matrix (1999)", ""))
        assertFalse(g("Матрица (1999) Full HD", ""))
        assertFalse(g("Амели (2001) смотреть онлайн в Full HD", "Амели"))
    }

    @Test
    fun `scorer prefers the full same-year film`() {
        fun item(title: String, duration: Int, category: Int? = null) = RtItem("a1b2c3d4e5f6", title, duration, categoryId = category)
        val full = RutubeParser.score(item("Матрица (1999) Фильм в HD", 8160, 4), "Матрица", 1999)
        val review = RutubeParser.score(item("Подробный обзор фильма Матрица 1999 на 2 часа", 7200), "Матрица", 1999)
        val trailer = RutubeParser.score(item("Матрица (1999) Официальный трейлер", 150), "Матрица", 1999)
        val gameplay = RutubeParser.score(item("Матрица 1999 геймплей игры на стриме", 9000), "Матрица", 1999)
        val wrongYear = RutubeParser.score(item("Матрица: Воскрешение (2021) Фильм", 8800, 4), "Матрица", 1999)
        assertTrue(full > 200)
        assertTrue(review < 0)
        assertTrue(trailer < 0)
        assertTrue(gameplay < 0)
        assertTrue(full > wrongYear)
    }

    @Test
    fun `page titles parse season, episode and channel`() {
        val parsed = RutubeParser.parsePageTitle("Магическая битва / Jujutsu Kaisen 2 сезон 5 серия [DubLikTV] — смотреть онлайн")
        assertEquals("Магическая битва", parsed.title)
        assertEquals(2, parsed.season)
        assertEquals(5, parsed.episode)
        assertEquals("DubLikTV", parsed.channelName)
    }

    private val matrix = SourceQuery(TitleRef(301, MediaType.MOVIE), "Матрица", year = 1999)

    @Test
    fun `year gate drops another year's film before scoring`() {
        val items = listOf(
            RtItem("aaaaaaaaaaaa", "Матрица: Перезагрузка (фильм, 2003)", 8296, categoryId = 4),
            RtItem("bbbbbbbbbbbb", "Матрица (фильм, 1999)", 8178),
        )
        assertEquals("bbbbbbbbbbbb", RutubeParser.pickBest(items, "Матрица", 1999)?.first?.id)
        assertNull(RutubeParser.pickBest(items.take(1), "Матрица", 1999))
    }

    @Test
    fun `fixture search picks a full upload, resolve gives its HLS`() = runTest {
        val fetcher = FakeFetcher(
            "https://rutube.ru/api/search/video/?query=%D0%9C%D0%B0%D1%82%D1%80%D0%B8%D1%86%D0%B0%201999&page=1&per_page=25" to fixture("rutube/search.json"),
            "https://rutube.ru/api/play/options/*" to fixture("rutube/options.json"),
        )
        val provider = RutubeProvider(fetcher)
        val option = provider.find(matrix)!!
        val picked = fetcher.requests.size
        assertEquals("a strong first answer stops the cascade", 1, picked)
        val title = Regex("\"id\": \"${option.handle}\",\\s*\"title\": \"([^\"]*)\"").find(fixture("rutube/search.json"))!!.groupValues[1]
        assertTrue(title, title.contains("1999") && !title.contains("Перезагрузка") && !title.lowercase().contains("трейлер"))

        val stream = provider.resolve(option, null, null)
        assertEquals(StreamFormat.HLS, stream.format)
        assertTrue(stream.url.startsWith("https://bl.rutube.ru/"))
        assertNull(stream.episode)
        assertFalse("series are not Rutube's", provider.accepts(matrix.copy(ref = TitleRef(301, MediaType.SERIES))))
        assertFalse("nor is any episode request", provider.accepts(matrix.copy(episode = app.seans.tv.model.EpisodeKey(1, 3))))
        try {
            provider.resolve(option, app.seans.tv.model.EpisodeKey(1, 3), null)
            org.junit.Assert.fail("an upload never plays as an episode")
        } catch (e: app.seans.tv.model.SeansError) {
            assertEquals(app.seans.tv.model.SeansError.Code.NOT_FOUND, e.code)
        }
    }
}
