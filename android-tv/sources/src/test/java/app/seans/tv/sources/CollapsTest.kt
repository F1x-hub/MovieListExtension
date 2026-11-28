package app.seans.tv.sources

import app.seans.tv.model.EpisodeKey
import app.seans.tv.model.MediaType
import app.seans.tv.model.ProviderId
import app.seans.tv.model.SeansError
import app.seans.tv.model.SourceQuery
import app.seans.tv.model.StreamFormat
import app.seans.tv.model.TitleRef
import app.seans.tv.network.SeansHttp
import app.seans.tv.sources.collaps.BalancerDomains
import app.seans.tv.sources.collaps.CollapsPage
import app.seans.tv.sources.collaps.CollapsProvider
import app.seans.tv.sources.collaps.VoiceLanguages
import app.seans.tv.sources.collaps.signedExpiryMillis
import app.seans.tv.sources.internal.HttpResult
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test

class CollapsTest {
    private val film = SourceQuery(TitleRef(258687, MediaType.MOVIE), "Интерстеллар", year = 2014)
    private val series = SourceQuery(TitleRef(404900, MediaType.SERIES), "Во все тяжкие", episode = EpisodeKey(2, 1))

    @Test
    fun `film page gives manifests, voices and subtitles`() {
        val page = CollapsPage.parse(fixture("collaps/film.html"))!!
        assertFalse(page.isSeries)
        assertFalse(page.blocked)
        val media = page.film!!
        assertTrue(media.hls!!.endsWith("t=1796668851") && media.hls!!.contains("/master.m3u8?"))
        assertTrue(media.dash!!.contains(".mpd?"))
        assertTrue(media.dashAv1!!.contains(".mpd?"))
        assertEquals(listOf("Рус. Дублированный", "Омикрон", "Ю. Сербин", "Ю. Живов", "Д. Есарев", "Укр. Дубльований", "Eng.Original"), media.voices)
        assertEquals((0..6).toList(), media.voiceOrder)
        assertEquals(listOf("uk", "ru"), media.subtitles.map { it.language }.take(2))
        assertEquals("Рус. полные - 2", media.subtitles[1].label)
        assertTrue(media.subtitles.all { it.url.startsWith("https://") })
        assertEquals(1796668851000L, signedExpiryMillis(media.hls!!))
    }

    @Test
    fun `series page sorts seasons, drops blocked ones and reads string episode numbers`() {
        val page = CollapsPage.parse(fixture("collaps/series.html"))!!
        assertTrue(page.isSeries)
        assertEquals(
            listOf(1 to 1, 1 to 2, 1 to 3, 2 to 1, 2 to 2, 2 to 3),
            page.episodes.map { it.season to it.episode },
        )
        val first = page.episodes.first().media
        assertEquals("Кубик в кубе", first.voices.first())
        assertEquals(3486, first.durationSec)
        assertTrue(first.hls != null && first.dash != null)
    }

    @Test
    fun `a page without a player call is not a page`() {
        assertNull(CollapsPage.parse("<html><body>Not found</body></html>"))
        assertNull(CollapsPage.parse("<script>function makePlayer(opts){}</script>"))
    }

    @Test
    fun `actualize script names the current domain`() {
        assertEquals("api.corevia.ws", BalancerDomains.parseScript(fixture("collaps/actualize.js")))
        assertNull("not the script we know", BalancerDomains.parseScript("var actual = \"https://evil.example\""))
        assertTrue(BalancerDomains.isBalancerHost("api.corevia.ws"))
        assertTrue(BalancerDomains.isBalancerHost("mm.next.ws"))
        assertFalse(BalancerDomains.isBalancerHost("corevia.ws"))
    }

    @Test
    fun `film find and resolve`() = runTest {
        val fetcher = FakeFetcher("https://api.corevia.ws/embed/kp/258687" to fixture("collaps/film.html"))
        val provider = CollapsProvider(fetcher)
        val option = provider.find(film)!!
        assertEquals(ProviderId.COLLAPS, option.providerId)
        assertEquals("kp:258687", option.handle)
        assertEquals("рус дублированный", option.voices.first().id)
        assertEquals("Рус. Дублированный", option.voices.first().name)
        assertEquals("https://ex-fs.net/", fetcher.pages().single().headers["Referer"])

        val stream = provider.resolve(option, null, "ю сербин")
        assertEquals("VP9 DASH first", StreamFormat.DASH, stream.format)
        assertTrue(stream.url.contains(".mpd?"))
        assertEquals(StreamFormat.HLS, stream.fallback?.format)
        assertTrue(stream.fallback!!.url.contains("/master.m3u8?"))
        assertEquals(2, stream.audioTrackIndex)
        assertEquals("ю сербин", stream.voiceId)
        assertEquals(SeansHttp.USER_AGENT, stream.headers["User-Agent"])
        assertNull("the CDN needs no Referer", stream.headers["Referer"])
        assertEquals(1796668851000L, stream.expiresAt)
        assertNull("a film has no episode", stream.episode)
        assertTrue(stream.alternatives.isEmpty())
        assertEquals(1, fetcher.pages().size)

        val unknownVoice = provider.resolve(option, null, "99")
        assertEquals("an unknown voice falls back to the first one", 0, unknownVoice.audioTrackIndex)
        assertEquals("рус дублированный", unknownVoice.voiceId)
    }

    @Test
    fun `a voice keeps its name key across episodes whose track order differs`() = runTest {
        val provider = CollapsProvider(FakeFetcher("https://api.corevia.ws/embed/kp/404900" to fixture("collaps/series.html")))
        val option = provider.find(series)!!
        assertTrue("ids are name keys, not indexes", option.voices.any { it.id == "lostfilm" && it.name == "LostFilm" })
        val s1 = provider.resolve(option, EpisodeKey(1, 1), "lostfilm")
        val s2 = provider.resolve(option, EpisodeKey(2, 1), "lostfilm")
        assertEquals("LostFilm is track 2 in season 1", 2, s1.audioTrackIndex)
        assertEquals("and track 1 in season 2", 1, s2.audioTrackIndex)
        assertEquals("lostfilm", s1.voiceId)
        assertEquals("lostfilm", s2.voiceId)
        assertEquals("рус дублированный", provider.resolve(option, EpisodeKey(2, 1), "рус дублированный").voiceId)

        val unknown = provider.resolve(option, EpisodeKey(2, 1), "0")
        assertEquals("an unknown voice plays the episode's default", 0, unknown.audioTrackIndex)
        assertEquals("рус дублированный", unknown.voiceId)
    }

    @Test
    fun `voice keys are normalized names, repeated names numbered`() {
        val media = CollapsPage.parse(fixture("collaps/film.html"))!!.film!!
        assertEquals(listOf("рус дублированный", "омикрон", "ю сербин", "ю живов", "д есарев", "укр дубльований", "eng original"), media.voiceKeys())
        val twice = media.copy(voices = listOf("Eng.Original", "Eng.Original", ""))
        assertEquals(listOf("eng original", "eng original#2", "track3"), twice.voiceKeys())
    }

    @Test
    fun `fresh skips the cached page`() = runTest {
        val fetcher = FakeFetcher("https://api.corevia.ws/embed/kp/258687" to fixture("collaps/film.html"))
        val provider = CollapsProvider(fetcher)
        val option = provider.find(film)!!
        val cached = provider.resolve(option, null, null)
        fetcher.route("https://api.corevia.ws/embed/kp/258687", fixture("collaps/film.html").replace("/fixture/", "/renewed/"))
        assertEquals("a plain call reuses the page", cached.url, provider.resolve(option, null, null).url)
        val fresh = provider.resolve(option, null, null, fresh = true)
        assertTrue("a fresh call reads the page again", fresh.url.contains("/renewed/") && fresh.url != cached.url)
        assertEquals(2, fetcher.pages().size)
    }

    @Test
    fun `a film page never stands in for an episode`() = runTest {
        // A wrong KP ID for a series lands on a film page («SYNCOPY», 2.5 h, seen on the TV).
        val provider = CollapsProvider(FakeFetcher("https://api.corevia.ws/embed/kp/258687" to fixture("collaps/film.html")))
        val episodeQuery = SourceQuery(TitleRef(258687, MediaType.SERIES), "Магическая битва", episode = EpisodeKey(1, 3))
        val option = provider.find(episodeQuery)!!
        assertEquals("Этой серии нет", option.unavailableReason)
        try {
            provider.resolve(option, EpisodeKey(1, 3), null)
            fail("the film must not play as С1·Е3")
        } catch (e: SeansError) {
            assertEquals(SeansError.Code.NOT_FOUND, e.code)
        }
        assertNull("without an episode the film itself still plays", provider.resolve(option, null, null).episode)
    }

    @Test
    fun `without DASH the HLS plays and there is no fallback`() = runTest {
        val html = fixture("collaps/film.html").replace(Regex("""\s+dash: "[^"]*",\s+dasha: "[^"]*","""), "")
        val provider = CollapsProvider(FakeFetcher("https://api.corevia.ws/embed/kp/258687" to html))
        val stream = provider.resolve(provider.find(film)!!, null, null)
        assertEquals(StreamFormat.HLS, stream.format)
        assertNull(stream.fallback)
    }

    @Test
    fun `a learned domain survives a restart through its file`() = runTest {
        val file = java.io.File(java.nio.file.Files.createTempDirectory("collaps").toFile(), "domain.txt")
        val fetcher = FakeFetcher(
            "https://api.corevia.ws/embed/kp/258687" to 422,
            BalancerDomains.SCRIPT_URL to "var actual = \"https://api.newhome.ws\"",
            "https://api.newhome.ws/embed/kp/258687" to fixture("collaps/film.html"),
        )
        assertTrue(CollapsProvider(fetcher, BalancerDomains(fetcher, file)).find(film) != null)
        assertEquals("api.newhome.ws", file.readText().trim())

        val restarted = FakeFetcher("https://api.newhome.ws/embed/kp/258687" to fixture("collaps/film.html"))
        assertTrue(CollapsProvider(restarted, BalancerDomains(restarted, file)).find(film) != null)
        assertEquals("no 422 and no script after a restart", 1, restarted.pages().size)

        file.writeText("evil.example\n")
        assertEquals("a stored value of another shape is ignored", BalancerDomains.DEFAULT_HOST, BalancerDomains(restarted, file).host())
    }

    @Test
    fun `actualize js is read at most once a minute`() = runTest {
        var now = 0L
        val fetcher = FakeFetcher(BalancerDomains.SCRIPT_URL to "var actual = \"https://api.corevia.ws\"")
        val domains = BalancerDomains(fetcher, clock = { now })
        assertFalse("same domain: no move", domains.refresh())
        assertFalse(domains.refresh())
        assertEquals(1, fetcher.requests.size)
        now = 60_000
        domains.refresh()
        assertEquals(2, fetcher.requests.size)
    }

    @Test
    fun `series find lists seasons and marks a missing episode`() = runTest {
        val fetcher = FakeFetcher("https://api.corevia.ws/embed/kp/404900" to fixture("collaps/series.html"))
        val provider = CollapsProvider(fetcher)
        val option = provider.find(series)!!
        assertEquals(listOf(1, 2), option.seasons.map { it.number })
        assertEquals(3, option.seasons[1].episodes.size)
        assertNull(option.unavailableReason)

        val missing = provider.find(series.copy(episode = EpisodeKey(2, 40)))!!
        assertEquals("Этой серии нет", missing.unavailableReason)

        val stream = provider.resolve(option, EpisodeKey(2, 3), null)
        assertEquals(EpisodeKey(2, 3), stream.episode)
        try {
            provider.resolve(option, EpisodeKey(9, 1), null)
            fail("a blocked season is not playable")
        } catch (e: SeansError) {
            assertEquals(SeansError.Code.NOT_FOUND, e.code)
        }
    }

    @Test
    fun `no such title is null, a challenge is PROVIDER_BLOCKED`() = runTest {
        assertNull(CollapsProvider(FakeFetcher("https://api.corevia.ws/embed/kp/258687" to 404)).find(film))
        val challenge = FakeFetcher(
            "https://api.corevia.ws/embed/kp/258687" to HttpResult(403, "<html><title>Just a moment...</title><script src=\"https://challenges.cloudflare.com/x.js\"></script>", ""),
        )
        try {
            CollapsProvider(challenge).find(film)
            fail("expected PROVIDER_BLOCKED")
        } catch (e: SeansError) {
            assertEquals(SeansError.Code.PROVIDER_BLOCKED, e.code)
        }
    }

    @Test
    fun `a retired domain answers 422 and actualize js moves the balancer`() = runTest {
        val fetcher = FakeFetcher(
            "https://api.corevia.ws/embed/kp/258687" to 422,
            BalancerDomains.SCRIPT_URL to "var actual = \"https://api.newhome.ws\"\n,re=/x/",
            "https://api.newhome.ws/embed/kp/258687" to fixture("collaps/film.html"),
        )
        val domains = BalancerDomains(fetcher)
        val option = CollapsProvider(fetcher, domains).find(film)
        assertTrue(option != null)
        assertEquals("api.newhome.ws", domains.host())
        assertEquals(
            listOf("https://api.corevia.ws/embed/kp/258687", BalancerDomains.SCRIPT_URL, "https://api.newhome.ws/embed/kp/258687"),
            fetcher.requests.map { it.url }.filterNot { it.contains("/master.m3u8") },
        )
    }

    @Test
    fun `names from another release move onto the renditions of their language`() = runTest {
        // «Мстители» (KP 263531): the dub name sat on an English rendition and played English.
        val names = """["Рус. Дублированный","Омикрон","Ю. Сербин","Ю. Живов","Д. Есарев","Укр. Дубльований","Eng.Original"]"""
        val avengers = """["Рус. Дублированный","Укр. Дубльований","Ю. Сербин","Eng.Original"]"""
        val html = fixture("collaps/film.html").replace(names, avengers)
        val fetcher = FakeFetcher(
            "https://api.corevia.ws/embed/kp/258687" to html,
            "https://hye1eaipby4w.interkh.com/fixture/master.m3u8*" to master("eng0" to "en", "eng1" to "en", "rus2" to "ru", "rus3" to "ru"),
        )
        val provider = CollapsProvider(fetcher)
        val option = provider.find(film)!!
        assertEquals(listOf("Eng.Original", "Дорожка 2 (en)", "Рус. Дублированный", "Ю. Сербин"), option.voices.map { it.name })
        assertEquals("the CDN needs the browser UA", SeansHttp.USER_AGENT, fetcher.requests.last().headers["User-Agent"])

        val dub = provider.resolve(option, null, "рус дублированный")
        assertEquals("the dub plays the Russian rendition", 2, dub.audioTrackIndex)
        assertEquals("рус дублированный", dub.voiceId)
        assertEquals("the master is read once", 1, fetcher.requests.count { it.url.contains("/master.m3u8") })
    }

    @Test
    fun `names that agree with their tags, or no tags at all, stay`() = runTest {
        val agreeing = CollapsProvider(FakeFetcher(
            "https://api.corevia.ws/embed/kp/258687" to fixture("collaps/film.html"),
            "https://hye1eaipby4w.interkh.com/fixture/master.m3u8*" to
                master("rus0" to "ru", "rus1" to "ru", "rus2" to "ru", "rus3" to "ru", "rus4" to "ru", "ukr5" to "uk", "eng6" to "en"),
        ))
        val option = agreeing.find(film)!!
        assertEquals("Рус. Дублированный", option.voices.first().name)
        assertEquals(0, agreeing.resolve(option, null, null).audioTrackIndex)

        assertNull("all one language says nothing", VoiceLanguages.namesForTracks(listOf("Рус. Дублированный", "Eng.Original"), listOf("ru", "ru")))
        assertNull("one stray tag is not enough",
            VoiceLanguages.namesForTracks(listOf("Рус. Дублированный", "Укр. Дубльований", "Eng.Original"), listOf("ru", "en", "en")))
        assertNull("counts must match", VoiceLanguages.namesForTracks(listOf("Рус. Дублированный", "Eng.Original"), listOf("en", "en", "ru", "ru")))
        val failover = master("eng0" to "en", "eng1" to "en", "rus2" to "ru", "rus3" to "ru") +
            "\n#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID=\"failover\",NAME=\"ukr0\",LANGUAGE=\"uk\",URI=\"f\""
        assertEquals("only the first group counts", listOf("en", "en", "ru", "ru"), VoiceLanguages.trackLanguages(failover))
        assertEquals("NAME stands in for a missing LANGUAGE", listOf("ru"),
            VoiceLanguages.trackLanguages("#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID=\"a\",NAME=\"rus0\",URI=\"x\""))
    }

    private fun master(vararg tracks: Pair<String, String>): String =
        tracks.withIndex().joinToString("\n", prefix = "#EXTM3U\n") { (index, track) ->
            "#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID=\"audio0\",NAME=\"${track.first}\",LANGUAGE=\"${track.second}\",URI=\"a${index + 1}.m3u8\""
        }
}

private fun FakeFetcher.pages() = requests.filter { it.url.contains("/embed/") }
