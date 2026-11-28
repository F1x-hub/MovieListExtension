package app.seans.tv.sources

import app.seans.tv.model.EpisodeKey
import app.seans.tv.model.MediaType
import app.seans.tv.model.SeansError
import app.seans.tv.model.SourceQuery
import app.seans.tv.model.StreamFormat
import app.seans.tv.model.TitleRef
import app.seans.tv.sources.animego.AnimeGoParser
import app.seans.tv.sources.animego.AnimeGoProvider
import app.seans.tv.sources.animego.KodikResolver
import app.seans.tv.sources.internal.HttpResult
import app.seans.tv.sources.internal.SourcesJson
import java.util.Base64
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.jsonObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test

/** Ports of `tests/kodikStreamResolver.test.js` and `tests/animegoParser.test.js`, on captured fixtures. */
class KodikAnimeGoTest {
    /** Inverse of Kodik's obfuscation: base64, then letters shifted back. */
    private fun encode(url: String, shift: Int = 18): String =
        Base64.getEncoder().encodeToString(url.toByteArray(Charsets.ISO_8859_1)).map { c ->
            when (c) {
                in 'A'..'Z' -> 'A' + (c - 'A' - shift + 26) % 26
                in 'a'..'z' -> 'a' + (c - 'a' - shift + 26) % 26
                else -> c
            }
        }.joinToString("")

    private fun cdn(q: Int) = "//cloud.solodcdn.com/useruploads/x/$q.mp4:hls:manifest.m3u8"

    @Test
    fun `decodeSource accepts every shift and only solodcdn HTTPS manifests`() {
        assertEquals(cdn(720), KodikResolver.decodeSource(encode(cdn(720))))
        assertEquals("https://cloud.solodcdn.com/a.m3u8", KodikResolver.decodeSource("https://cloud.solodcdn.com/a.m3u8"))
        for (shift in 0 until 26) assertEquals("shift $shift", cdn(720), KodikResolver.decodeSource(encode(cdn(720), shift)))
        val invalid = listOf(
            "https://cloud.solodcdn.com/video.mp4?next=manifest.m3u8",
            "https://cloud.solodcdn.com/video.m3u8/extra",
            "https://solodcdn.com.evil.example/a.m3u8",
            "https://evil-solodcdn.com/a.m3u8",
            "https://localhost/a.m3u8",
            "https://127.0.0.1/a.m3u8",
            "http://cloud.solodcdn.com/a.m3u8",
            "https://user:secret@cloud.solodcdn.com/a.m3u8",
            "payload-secret-%%%",
        )
        for (value in invalid) for (source in listOf(value, encode(value))) {
            try {
                KodikResolver.decodeSource(source)
                fail("$value must be rejected")
            } catch (e: IllegalArgumentException) {
                assertEquals("the rejection never carries the payload", "decode_failed", e.message)
            }
        }
    }

    @Test
    fun `page URL, embed page, ftor body and links`() {
        assertEquals(
            "https://kodikplayer.com/seria/476323/b7ceac/720p?translations=false&min_age=16",
            KodikResolver.toPageUrl("https://kodikplayer.com/seria/476323/b7ceac/720p?translations=false&min_age=16&movieExtensionSite=animego.me"),
        )
        assertEquals("https://kodikplayer.com/video/1/a/720p", KodikResolver.toPageUrl("//kodikplayer.com/video/1/a/720p"))
        assertNull(KodikResolver.toPageUrl("https://evil.example/seria/1"))
        assertNull(KodikResolver.toPageUrl("not a url"))

        val info = KodikResolver.parseEmbedPage(fixture("kodik/embed.html"))
        assertEquals("seria", info.type)
        assertEquals("733694", info.id)
        assertEquals("0000:2611290646", info.params.toMap()["d_sign"])
        try {
            KodikResolver.parseEmbedPage("<html>Извините, но данной страницы не существует</html>")
            fail()
        } catch (e: SeansError) {
            assertEquals(SeansError.Code.PROVIDER_CHANGED, e.code)
        }

        val body = KodikResolver.buildFtorBody(info).toMap()
        assertEquals("false", body["translations"])
        assertEquals("18", body["min_age"])
        assertEquals("00000000000000000000000000000000", body["hash"])
        assertEquals("733694", body["id"])
        assertEquals("false", body["bad_user"])
        assertEquals("true", body["cdn_is_working"])

        val streams = KodikResolver.parseLinks(SourcesJson.parseToJsonElement(fixture("kodik/ftor.json")).jsonObject)
        assertEquals(listOf(720, 480, 360), streams.map { it.height })
        assertEquals("https://p12.solodcdn.com/s/m/fixture/0000/720.mp4:hls:manifest.m3u8", streams[0].url)

        val dropped = """{"links":{"720":[{"src":"${encode("http://insecure.example/a.m3u8")}"}],"480":[{"src":"%%%"}],"auto":[{"src":"${encode(cdn(1080))}"}]}}"""
        assertTrue(KodikResolver.parseLinks(SourcesJson.parseToJsonElement(dropped).jsonObject).isEmpty())
    }

    private val kodikPage = "https://kodikplayer.com/seria/733694/00000000000000000000000000000000/720p?translations=false&min_age=18"

    @Test
    fun `resolve sends no Referer, posts the XHR form and caches`() = runTest {
        var now = 0L
        val fetcher = FakeFetcher(kodikPage to fixture("kodik/embed.html"), "https://kodikplayer.com/ftor" to fixture("kodik/ftor.json"))
        val resolver = KodikResolver(fetcher, clock = { now })
        assertEquals(listOf(720, 480, 360), resolver.resolve("//kodikplayer.com/seria/733694/00000000000000000000000000000000/720p?translations=false&min_age=18").map { it.height })
        assertEquals(2, fetcher.requests.size)
        fetcher.requests.forEach { assertNull("Kodik rejects a foreign Referer", it.headers.keys.firstOrNull { k -> k.equals("Referer", true) }) }
        val post = fetcher.requests[1]
        assertEquals("POST", post.method)
        assertEquals("XMLHttpRequest", post.headers["X-Requested-With"])
        assertEquals("00000000000000000000000000000000", post.form.toMap()["hash"])

        resolver.resolve(kodikPage)
        assertEquals("cached", 2, fetcher.requests.size)
        resolver.resolve(kodikPage, forceRefresh = true)
        assertEquals(4, fetcher.requests.size)
        now = KodikResolver.CACHE_TTL_MS
        resolver.resolve(kodikPage)
        assertEquals("expired", 6, fetcher.requests.size)

        fetcher.route("https://kodikplayer.com/ftor", """{"links":{}}""")
        try {
            resolver.resolve(kodikPage, forceRefresh = true)
            fail()
        } catch (e: SeansError) {
            assertEquals(SeansError.Code.NOT_FOUND, e.code)
        }
        try {
            KodikResolver(FakeFetcher(kodikPage to HttpResult(500, "", kodikPage))).resolve(kodikPage)
            fail()
        } catch (e: SeansError) {
            assertEquals(SeansError.Code.NETWORK, e.code)
        }
    }

    // ── AnimeGo ──────────────────────────────────────────────────────────────

    private fun card(id: Int, slug: String, title: String, original: String, kind: String, year: Int) = """
        <div class="ani-grid__item">
            <a class="ani-grid__item-picture" href="/anime/$slug-$id"><img alt="$title"></a>
            <div class="ani-grid__item-body pt-2">
                <div class="fw-lighter small mb-1">$original</div>
                <div class="ani-grid__item-title h5"><a title="$title" href="/anime/$slug-$id">$title</a></div>
                <div class="ani-grid__item-genres">
                    <span><span class="ani-grid__item-genres__link">$kind</span></span><span>/</span>
                    <span><span class="ani-grid__item-genres__link">$year</span></span>
                </div>
            </div>
        </div>"""

    private val naruto = "<html><body>" +
        card(385, "boruto-film-naruto", "Боруто: Фильм Наруто", "Boruto: Naruto the Movie", "Фильм", 2015) +
        card(103, "naruto-uragannye-hroniki", "Наруто: Ураганные хроники", "Naruto: Shippuuden", "ТВ Сериал", 2007) +
        card(999, "naruto-uragannye-hroniki-remake", "Наруто: Ураганные хроники", "Naruto: Shippuuden Remake", "ТВ Сериал", 2030) +
        "</body></html>"

    @Test
    fun `title scorer matches the exact title and year, not a remake or a prefix`() {
        val cards = AnimeGoParser.parseSearchCards(naruto)
        val result = AnimeGoParser.bestResult(cards, "Наруто: Ураганные хроники", 2007)!!
        assertEquals("103", result.animeId)
        assertEquals("https://animego.me/anime/naruto-uragannye-hroniki-103", result.url)
        assertEquals(true, result.isSeries)
        assertEquals("385", AnimeGoParser.bestResult(cards, "Boruto: Naruto the Movie", 2015)?.animeId)
        assertEquals(false, AnimeGoParser.bestResult(cards, "Boruto: Naruto the Movie", 2015)?.isSeries)
        assertNull(AnimeGoParser.bestResult(cards, "Наруто", 2007))
        assertEquals("103", AnimeGoParser.bestResult(cards, "Naruto: Shippuuden TV", 2007)?.animeId)
        assertNull(AnimeGoParser.bestResult(cards, "Naruto: Shippuuden TV", 2012))
        assertNull(AnimeGoParser.bestResult(cards, "Ван-Пис", 1999))
        assertNull(AnimeGoParser.bestResult(cards, "Боруто: Фильм Наруто", 2010))
        assertEquals(
            listOf("Solo Leveling: Поднятие уровня в одиночку", "Solo Leveling", "Поднятие уровня в одиночку"),
            AnimeGoParser.buildTitleVariants("Solo Leveling: Поднятие уровня в одиночку"),
        )
        assertEquals(listOf("Ван-Пис"), AnimeGoParser.buildTitleVariants("Ван-Пис"))
    }

    @Test
    fun `fixture search finds the series and its second season`() {
        val cards = AnimeGoParser.parseSearchCards(fixture("animego/search.html"))
        val base = AnimeGoParser.bestResult(cards, "Магическая битва", 2020)!!
        assertEquals("1635", base.animeId)
        assertEquals("Jujutsu Kaisen", base.originalTitle)
        assertEquals("2332", AnimeGoParser.findSeasonResult(cards, base, 2)?.animeId)
        assertNull(AnimeGoParser.findSeasonResult(cards, base, 7))
        assertTrue(AnimeGoParser.seasonMarker(2).containsMatchIn(" 2"))
        assertTrue(AnimeGoParser.seasonMarker(2).containsMatchIn(": второй сезон"))
        assertTrue(AnimeGoParser.seasonMarker(3).containsMatchIn(" III"))
        assertTrue(AnimeGoParser.seasonMarker(2).containsMatchIn(" season 2"))
    }

    @Test
    fun `player markup gives episodes and Kodik embeds first, unknown hosts dropped`() {
        val content = (SourcesJson.parseToJsonElement(fixture("animego/player_series.json")).jsonObject["data"]!!
            .jsonObject["content"] as kotlinx.serialization.json.JsonPrimitive).content
        val player = AnimeGoParser.parsePlayerContent(content)
        assertEquals(listOf(1, 2, 3), player.episodes.map { it.number })
        assertEquals("21684", player.episodes[0].id)
        assertEquals(1, player.pageCount)
        assertTrue(AnimeGoParser.isKodikUrl(player.players.first().url))
        assertTrue(player.players.all { it.url.startsWith("https://kodikplayer.com/") || it.url.startsWith("https://video.sibnet.ru/") })
        assertEquals(listOf("71", "59"), player.players.map { it.translationId })

        assertNull(AnimeGoParser.toProviderFrameUrl("//evil.example/embed"))
        assertNull(AnimeGoParser.toProviderFrameUrl("javascript:alert(1)"))
        assertEquals("https://video.sibnet.ru/shell.php?videoid=1", AnimeGoParser.toProviderFrameUrl("//video.sibnet.ru/shell.php?videoid=1"))
        assertEquals(2, AnimeGoParser.parsePlayerContent("<div data-anime-player-episodes-total-value=\"150\" data-anime-player-episodes-page-size-value=\"100\"></div>").pageCount)
    }

    private fun agFetcher() = FakeFetcher(
        "https://animego.me/search/anime?q=%D0%9C%D0%B0%D0%B3%D0%B8%D1%87%D0%B5%D1%81%D0%BA%D0%B0%D1%8F%20%D0%B1%D0%B8%D1%82%D0%B2%D0%B0" to fixture("animego/search.html"),
        "https://animego.me/player/1635" to fixture("animego/player_series.json"),
        "https://animego.me/player/videos/21685" to fixture("animego/episode_videos.json"),
        kodikPage to fixture("kodik/embed.html"),
        "https://kodikplayer.com/ftor" to fixture("kodik/ftor.json"),
    )

    private val anime = SourceQuery(TitleRef(1236063, MediaType.SERIES), "Магическая битва", year = 2020, episode = EpisodeKey(1, 2), isAnime = true)

    @Test
    fun `AnimeGo is asked only for anime`() {
        val provider = AnimeGoProvider(FakeFetcher())
        assertTrue(provider.accepts(anime))
        assertTrue(!provider.accepts(anime.copy(isAnime = false)))
    }

    @Test
    fun `absolute numbering slices one long title by the season counts`() {
        val absolute = (1..30).associateWith { "id$it" }
        assertEquals((1..12).associateWith { "id${it + 12}" }, AnimeGoProvider.seasonSlice(absolute, 2, mapOf(1 to 12, 2 to 12)))
        assertEquals("no count of its own: the rest", (1..18).associateWith { "id${it + 12}" }, AnimeGoProvider.seasonSlice(absolute, 2, mapOf(1 to 12)))
        assertNull("an earlier season's count is unknown", AnimeGoProvider.seasonSlice(absolute, 3, mapOf(1 to 12)))
        assertNull("past the end", AnimeGoProvider.seasonSlice(absolute, 2, mapOf(1 to 30)))
    }

    @Test
    fun `a season without its own AnimeGo title maps through the counts`() = runTest {
        val fetcher = agFetcher()
        fetcher.route("https://animego.me/player/videos/21686", fixture("animego/episode_videos.json"))
        fetcher.route(
            "https://kodikplayer.com/seria/733694/00000000000000000000000000000000/720p?translations=false&min_age=18",
            fixture("kodik/embed.html"),
        )
        val provider = AnimeGoProvider(fetcher)
        val query = anime.copy(episode = EpisodeKey(3, 1), seasonEpisodeCounts = mapOf(1 to 1, 2 to 1))
        val option = provider.find(query)!!
        assertEquals(3, option.seasons.single().number)
        assertEquals(listOf(1), option.seasons.single().episodes.map { it.key.episode })
        assertNull(option.unavailableReason)
        assertEquals("the confirmed season-relative episode", EpisodeKey(3, 1), provider.resolve(option, EpisodeKey(3, 1), null).episode)
        assertTrue(fetcher.requests.any { it.url == "https://animego.me/player/videos/21686" })
    }

    @Test
    fun `find and resolve an episode through Kodik`() = runTest {
        val fetcher = agFetcher()
        val provider = AnimeGoProvider(fetcher)
        val option = provider.find(anime)!!
        assertEquals(listOf(1, 2, 3), option.seasons.single().episodes.map { it.key.episode })
        assertEquals(listOf("71", "59"), option.voices.map { it.id })
        assertEquals("JAM CLUB", option.voices[1].name)
        val playerRequest = fetcher.requests.first { it.url == "https://animego.me/player/1635" }
        assertEquals("XMLHttpRequest", playerRequest.headers["X-Requested-With"])

        val stream = provider.resolve(option, EpisodeKey(1, 2), "71")
        assertEquals(StreamFormat.HLS, stream.format)
        assertEquals(EpisodeKey(1, 2), stream.episode)
        assertEquals("71", stream.voiceId)
        assertEquals(listOf(720, 480, 360), stream.alternatives.map { it.first.height })
        assertEquals(stream.url, stream.alternatives.first().second)
        assertTrue(stream.url.startsWith("https://p12.solodcdn.com/"))

        val fallback = provider.resolve(option, EpisodeKey(1, 2), "12345")
        assertEquals("an unknown dub falls back to the episode's first one", "71", fallback.voiceId)

        // fresh = true asks Kodik again instead of reusing its 10-minute stream cache.
        val before = fetcher.requests.size
        provider.resolve(option, EpisodeKey(1, 2), "71")
        val cachedKodik = fetcher.requests.drop(before).count { "kodikplayer.com" in it.url }
        provider.resolve(option, EpisodeKey(1, 2), "71", fresh = true)
        val freshKodik = fetcher.requests.drop(before).count { "kodikplayer.com" in it.url } - cachedKodik
        assertEquals("cached Kodik streams are reused", 0, cachedKodik)
        assertEquals("fresh asks the embed page and /ftor again", 2, freshKodik)
        try {
            provider.resolve(option, EpisodeKey(1, 30), null)
            fail("an episode AnimeGo does not list")
        } catch (e: SeansError) {
            assertEquals(SeansError.Code.NOT_FOUND, e.code)
        }
    }

    @Test
    fun `an AnimeGo film never stands in for an episode`() = runTest {
        val film = """{"status":"success","data":{"content":${SourcesJson.encodeToString(
            kotlinx.serialization.json.JsonPrimitive.serializer(),
            kotlinx.serialization.json.JsonPrimitive(
                "<div><button data-player=\"//kodikplayer.com/seria/733694/00000000000000000000000000000000/720p?translations=false&amp;min_age=18\" " +
                    "data-translation-id=\"71\" data-translation-title=\"Многоголосый\"></button></div>",
            ),
        )}}}"""
        val fetcher = agFetcher()
        fetcher.route("https://animego.me/player/1635", film)
        val provider = AnimeGoProvider(fetcher)
        val option = provider.find(anime.copy(episode = EpisodeKey(1, 3)))!!
        assertEquals("Этой серии нет", option.unavailableReason)
        try {
            provider.resolve(option, EpisodeKey(1, 3), null)
            fail("a film must not play as an episode")
        } catch (e: SeansError) {
            assertEquals(SeansError.Code.NOT_FOUND, e.code)
        }
        assertEquals("the film itself plays without an episode", null, provider.resolve(option, null, null).episode)
    }

    @Test
    fun `a failed episode page fails the lookup instead of truncating it`() = runTest {
        val paged = """{"status":"success","data":{"content":${SourcesJson.encodeToString(
            kotlinx.serialization.json.JsonPrimitive.serializer(),
            kotlinx.serialization.json.JsonPrimitive(
                "<div data-anime-player-episodes-total-value=\"150\" data-anime-player-episodes-page-size-value=\"100\">" +
                    "<div data-episode-number=\"1\" data-episode=\"5001\"></div>" +
                    "<button data-player=\"//kodikplayer.com/seria/1/a/720p\" data-translation-id=\"9\" data-translation-title=\"2x2\"></button></div>",
            ),
        )}}}"""
        val fetcher = agFetcher()
        fetcher.route("https://animego.me/player/1635", paged)
        fetcher.route("https://animego.me/player/1635/episodes?page=1", HttpResult(500, "", ""))
        try {
            AnimeGoProvider(fetcher).find(anime)
            fail("a truncated episode list must not become an offer")
        } catch (e: SeansError) {
            assertEquals(SeansError.Code.NETWORK, e.code)
        }
        fetcher.route("https://animego.me/player/1635/episodes?page=1", 404)
        try {
            AnimeGoProvider(fetcher).find(anime)
            fail("a missing episode page is a changed provider, not a shorter list")
        } catch (e: SeansError) {
            assertEquals(SeansError.Code.PROVIDER_CHANGED, e.code)
        }
    }

    @Test
    fun `a later season without its own title is missing, not guessed`() = runTest {
        val fetcher = agFetcher()
        assertNull(AnimeGoProvider(fetcher).find(anime.copy(episode = EpisodeKey(7, 1))))
        assertNull(AnimeGoProvider(FakeFetcher()).find(anime))
    }

    @Test
    fun `a challenge page is PROVIDER_BLOCKED`() = runTest {
        val blocked = FakeFetcher("https://animego.me/search/anime?*" to HttpResult(403, "<html><head><title>DDoS-Guard</title></head><script src=\"https://check.ddos-guard.net/check.js\"></script></html>", ""))
        try {
            AnimeGoProvider(blocked).find(anime)
            fail()
        } catch (e: SeansError) {
            assertEquals(SeansError.Code.PROVIDER_BLOCKED, e.code)
        }
    }
}
