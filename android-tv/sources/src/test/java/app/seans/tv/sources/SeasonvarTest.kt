package app.seans.tv.sources

import app.seans.tv.model.EpisodeKey
import app.seans.tv.model.MediaType
import app.seans.tv.model.SeansError
import app.seans.tv.model.SourceQuery
import app.seans.tv.model.StreamFormat
import app.seans.tv.model.TitleRef
import app.seans.tv.sources.seasonvar.SeasonvarParser
import app.seans.tv.sources.seasonvar.SeasonvarProvider
import app.seans.tv.sources.seasonvar.SvSearchResult
import java.util.Base64
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test

/** Ports of `tests/seasonvar*.test.js` parser cases, plus the provider on captured fixtures. */
class SeasonvarTest {
    private val searchUrl = "https://seasonvar.ru/search?q=%D0%92%D0%BE%20%D0%B2%D1%81%D0%B5%20%D1%82%D1%8F%D0%B6%D0%BA%D0%B8%D0%B5"
    private val season5 = "https://seasonvar.ru/serial-4448--Vo_vse_tyazhkie-_psizfyu-5--season.html"
    private val defaultPlaylist = "https://seasonvar.ru/playls2/00000000000000000000000000000000/trans/4448/plist.txt?time=1700000000"
    private val query = SourceQuery(TitleRef(404900, MediaType.SERIES), "Во все тяжкие", originalTitle = "Breaking Bad", episode = EpisodeKey(5, 2))

    private fun fetcher() = FakeFetcher(
        searchUrl to fixture("seasonvar/search.html"),
        season5 to fixture("seasonvar/season5.html"),
        defaultPlaylist to fixture("seasonvar/plist.json"),
    )

    @Test
    fun `extractEpisodeNumber handles every label format`() {
        val n = SeasonvarParser::extractEpisodeNumber
        assertEquals(1, n("1 серия"))
        assertEquals(3, n("3 серия"))
        assertEquals(3, n("3 сезон - 3 серия"))
        assertEquals(12, n("Серия 12"))
        assertEquals(5, n("Эпизод 5"))
        assertEquals(10, n("10"))
        assertEquals(8, n("2 сезон, 8 серия"))
        assertEquals(4, n("4 серия (озвучка TVShows)"))
        assertNull(n(null))
        assertNull(n(""))
        assertNull(n("Трейлер"))
    }

    @Test
    fun `search ranking keeps whole words and rejects embedded matches`() {
        val candidates = listOf(
            SvSearchResult("http://seasonvar.ru/serial-43755-Dikie_Skrichery-5-season.html", "Дикие Скричеры", "Wild Screechers"),
            SvSearchResult("http://seasonvar.ru/serial-32100-Jack_Reacher-4-season.html", "Джек Ричер", "Jack Reacher"),
        )
        assertEquals("Джек Ричер", SeasonvarParser.selectBest(candidates, "Ричер", "Jack Reacher", 2022)?.title)
        assertNull("an embedded-word-only result is rejected", SeasonvarParser.selectBest(candidates.take(1), "Ричер", "", 2022))
    }

    @Test
    fun `translations from var pl and pl index assignments, trailers dropped`() {
        val html = """
            <script>var pl = {'0': "/playls2/hash123/trans/10449/plist.txt?time=1789775811"};</script>
            <ul class="pgs-trans">
                <li data-click="translate" data-translate="0" data-translate-percent="85.46" class="act">Стандартный</li>
                <li data-click="translate" data-translate="1" data-translate-percent="14.5">Субтитры</li>
                <script>pl[1] = "/playls2/hash123/trans%D0%A1%D1%83%D0%B1%D1%82%D0%B8%D1%82%D1%80%D1%8B/10449/plist.txt?time=1789775811";</script>
                <li data-click="translate" data-translate="68">Трейлеры</li>
                <script>pl[68] = "/playls2/hash123/trans%D0%A2%D1%80%D0%B5%D0%B9%D0%BB%D0%B5%D1%80%D1%8B/10449/plist.txt?time=1789775811";</script>
            </ul>"""
        val translations = SeasonvarParser.parseTranslations(html)
        assertEquals(listOf("0", "1"), translations.map { it.id })
        assertEquals("https://seasonvar.ru/playls2/hash123/trans/10449/plist.txt?time=1789775811", translations[0].url)
        assertEquals("Субтитры", translations[1].name)
        assertTrue(translations[1].url.contains("trans%D0%A1%D1%83%D0%B1%D1%82%D0%B8%D1%82%D1%80%D1%8B"))
        assertEquals(listOf(true, false), translations.map { it.active })
    }

    @Test
    fun `a single string playlist is the standard translation`() {
        val translations = SeasonvarParser.parseTranslations("""<script>var pl = "/playls2/h/trans/1/plist.txt";</script>""")
        assertEquals(listOf("0" to "Стандартный"), translations.map { it.id to it.name })
        try {
            SeasonvarParser.parseTranslations("<html></html>")
            fail("a page without a playlist must throw")
        } catch (_: IllegalStateException) {
        }
    }

    @Test
    fun `links decode through the junk and get https`() {
        val raw = Base64.getEncoder().encodeToString("//data01-cdn.11cdn.org/a/b.mp4".toByteArray())
        val obfuscated = "#2" + raw.take(10) + "//b2xvbG8=" + raw.drop(10)
        assertEquals("https://data01-cdn.11cdn.org/a/b.mp4", SeasonvarParser.decodeUrl(obfuscated))
        assertEquals("not base64 stays as given", "%%%", SeasonvarParser.decodeUrl("%%%"))
    }

    @Test
    fun `fixture pages parse`() {
        val results = SeasonvarParser.parseSearchResults(fixture("seasonvar/search.html"))
        assertEquals(listOf("Во все тяжкие", "Во все тяжкие: Медведи"), results.map { it.title })
        assertEquals("Breaking Bad", results[0].originalTitle)
        assertEquals(season5, results[0].url)
        assertEquals("Во все тяжкие", SeasonvarParser.selectBest(results, "Во все тяжкие", "Breaking Bad", null)?.title)

        val html = fixture("seasonvar/season5.html")
        val seasons = SeasonvarParser.parseSeasons(html)
        assertEquals(listOf(1, 2, 3, 4, 5), seasons.map { it.number })
        assertEquals(16, seasons.last().episodesCount)
        assertEquals(season5, seasons.last().url)

        val translations = SeasonvarParser.parseTranslations(html)
        assertEquals(listOf("0", "6", "1", "223"), translations.map { it.id })
        assertEquals("0", translations.single { it.active }.id)

        val episodes = SeasonvarParser.parsePlaylist(fixture("seasonvar/plist.json"))
        assertEquals(listOf(1, 2, 3, 16), episodes.map { SeasonvarParser.extractEpisodeNumber(it.title) })
        assertEquals("1 серия", episodes[0].title)
        assertTrue(episodes[3].title.startsWith("Бонусы - "))
        assertTrue(episodes.all { it.url.startsWith("https://") && "11cdn.org" in it.url })
        assertEquals("LostFilm", SeasonvarParser.studioOf(episodes))

        val subtitles = SeasonvarParser.parseSubtitles(episodes[0].subtitle)
        assertEquals(listOf("ru", "en"), subtitles.map { it.language })
        assertEquals(listOf("Русский", "English"), subtitles.map { it.label })
    }

    @Test
    fun `find gives seasons, the asked season's episodes and voices`() = runTest {
        val fetcher = fetcher()
        val option = SeasonvarProvider(fetcher).find(query)!!
        assertEquals(listOf(1, 2, 3, 4, 5), option.seasons.map { it.number })
        assertEquals(listOf(1, 2, 3, 16), option.seasons.last().episodes.map { it.key.episode })
        assertTrue("seasons without a printed count list no episodes", option.seasons.first().episodes.isEmpty())
        assertEquals("Стандартный (LostFilm)", option.voices.first().name)
        assertEquals(listOf("0", "6", "1", "223"), option.voices.map { it.id })
        assertNull(option.unavailableReason)
        assertEquals("one search, one page, one playlist", 3, fetcher.requests.size)
        assertEquals(searchUrl, fetcher.requests.first().url)

        assertEquals("Этой серии нет", SeasonvarProvider(fetcher()).find(query.copy(episode = EpisodeKey(5, 9)))!!.unavailableReason)
    }

    @Test
    fun `resolve plays the exact episode of the chosen voice`() = runTest {
        val fetcher = fetcher()
        val provider = SeasonvarProvider(fetcher)
        val option = provider.find(query)!!
        val stream = provider.resolve(option, EpisodeKey(5, 2), null)
        assertEquals(StreamFormat.MP4, stream.format)
        assertEquals(EpisodeKey(5, 2), stream.episode)
        assertEquals("0", stream.voiceId)
        assertTrue(stream.url.startsWith("https://data02-cdn.11cdn.org/"))

        val gobline = "https://seasonvar.ru/playls2/00000000000000000000000000000000/trans%D0%93%D0%BE%D0%B1%D0%BB%D0%B8%D0%BD/4448/plist.txt?time=1700000000"
        fetcher.route(gobline, """[{"title":"1 серия","file":"https://data05-cdn.11cdn.org/g1.mp4"}]""")
        assertEquals("223", provider.resolve(option, EpisodeKey(5, 1), "223").voiceId)
        val fallback = provider.resolve(option, EpisodeKey(5, 2), "223")
        assertEquals("a voice without the episode falls back to the default voice", "0", fallback.voiceId)
        assertEquals("never another episode", EpisodeKey(5, 2), fallback.episode)
        assertEquals("an unknown voice falls back too", "0", provider.resolve(option, EpisodeKey(5, 2), "nope").voiceId)
        try {
            provider.resolve(option, EpisodeKey(5, 9), null)
            fail("no voice has E9")
        } catch (e: SeansError) {
            assertEquals(SeansError.Code.NOT_FOUND, e.code)
        }
        try {
            provider.resolve(option, EpisodeKey(7, 1), null)
            fail("a season Seasonvar does not have")
        } catch (e: SeansError) {
            assertEquals(SeansError.Code.NOT_FOUND, e.code)
        }
    }

    @Test
    fun `http links are upgraded to https, other schemes dropped`() {
        val plain = Base64.getEncoder().encodeToString("http://data03-cdn.11cdn.org/a/b.mp4".toByteArray())
        val episodes = SeasonvarParser.parsePlaylist(
            """[{"title":"1 серия","file":"#2$plain","subtitle":"[ru]http://data03-cdn.11cdn.org/a/b.vtt"},
                {"title":"2 серия","file":"ftp://evil.example/x.mp4"},
                {"title":"3 серия","file":"http://data04-cdn.11cdn.org/c.mp4"}]""",
        )
        assertEquals(listOf("https://data03-cdn.11cdn.org/a/b.mp4", "https://data04-cdn.11cdn.org/c.mp4"), episodes.map { it.url })
        assertEquals("https://data03-cdn.11cdn.org/a/b.vtt", SeasonvarParser.parseSubtitles(episodes[0].subtitle).single().url)
        assertNull(SeasonvarParser.toHttps("javascript:alert(1)"))
    }

    @Test
    fun `fresh reads the page and the playlist again`() = runTest {
        val fetcher = fetcher()
        val provider = SeasonvarProvider(fetcher)
        val option = provider.find(query)!!
        val cached = provider.resolve(option, EpisodeKey(5, 2), null)
        fetcher.route(defaultPlaylist, """[{"title":"2 серия","file":"https://data09-cdn.11cdn.org/renewed.mp4"}]""")
        assertEquals(cached.url, provider.resolve(option, EpisodeKey(5, 2), null).url)
        val before = fetcher.requests.size
        val fresh = provider.resolve(option, EpisodeKey(5, 2), null, fresh = true)
        assertEquals("https://data09-cdn.11cdn.org/renewed.mp4", fresh.url)
        assertEquals("page and playlist asked again", 2, fetcher.requests.size - before)
    }

    @Test
    fun `films are never asked, and no hit is null`() = runTest {
        val provider = SeasonvarProvider(FakeFetcher(searchUrl to "<html><body>Ничего не найдено</body></html>"))
        assertFalse(provider.accepts(query.copy(ref = TitleRef(1, MediaType.MOVIE))))
        assertNull(provider.find(query))
    }
}
