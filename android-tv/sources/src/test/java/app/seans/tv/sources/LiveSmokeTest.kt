package app.seans.tv.sources

import app.seans.tv.model.EpisodeKey
import app.seans.tv.model.MediaType
import app.seans.tv.model.SourceQuery
import app.seans.tv.model.TitleRef
import app.seans.tv.network.SeansHttp
import app.seans.tv.sources.animego.AnimeGoProvider
import app.seans.tv.sources.collaps.CollapsProvider
import app.seans.tv.sources.internal.OkHttpFetcher
import app.seans.tv.sources.internal.Provider
import app.seans.tv.sources.internal.hostOf
import app.seans.tv.sources.rutube.RutubeProvider
import app.seans.tv.sources.seasonvar.SeasonvarProvider
import java.nio.file.Files
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withContext
import okhttp3.Request
import org.junit.Assume.assumeTrue
import org.junit.Test

/**
 * MANUAL live smoke: one title per provider, through the real `SeansHttp` (DoH, Chrome UA,
 * denylist), then the first KB of the resolved manifest/file through `mediaClient`. Skipped
 * unless `SEANS_SMOKE=1`; never part of a normal test run. Prints hosts only, never URLs.
 *
 *     SEANS_SMOKE=1 ./gradlew :sources:testDebugUnitTest --tests "*LiveSmokeTest*" --rerun -i
 *
 * The PC and the TV share one IP; none of these hosts belongs to the linkpp network.
 */
class LiveSmokeTest {
    private val http by lazy { SeansHttp(Files.createTempDirectory("seans-smoke").toFile()) }
    private val fetcher by lazy { OkHttpFetcher(http.client) }

    private fun smoke(provider: Provider, query: SourceQuery, episode: EpisodeKey?) = runBlocking {
        assumeTrue("set SEANS_SMOKE=1 to run the live smoke", System.getenv("SEANS_SMOKE") == "1")
        val started = System.currentTimeMillis()
        val option = provider.find(query) ?: error("${provider.id.key}: not found")
        val stream = provider.resolve(option, episode, null)
        val probe = withContext(Dispatchers.IO) {
            http.mediaClient.newCall(
                Request.Builder().url(stream.url).header("Range", "bytes=0-1023")
                    .apply { stream.headers.forEach { (k, v) -> header(k, v) } }.build(),
            ).execute().use { "${it.code} ${it.header("Content-Type")}" }
        }
        println(
            "SMOKE ${provider.id.key}: voices=${option.voices.size} seasons=${option.seasons.size} " +
                "format=${stream.format} host=${hostOf(stream.url)} episode=${stream.episode?.shortLabel()} " +
                "voice=${stream.voiceId?.let { "set" }} qualities=${stream.alternatives.map { it.first.label }} " +
                "subtitles=${stream.subtitles.size} probe=[$probe] in ${System.currentTimeMillis() - started} ms",
        )
        check(probe.startsWith("200") || probe.startsWith("206")) { "${provider.id.key}: stream answered $probe" }
    }

    @Test
    fun collaps() = smoke(CollapsProvider(fetcher), SourceQuery(TitleRef(258687, MediaType.MOVIE), "Интерстеллар", year = 2014), null)

    @Test
    fun seasonvar() = smoke(
        SeasonvarProvider(fetcher),
        SourceQuery(TitleRef(404900, MediaType.SERIES), "Во все тяжкие", "Breaking Bad", 2008, EpisodeKey(5, 2)),
        EpisodeKey(5, 2),
    )

    @Test
    fun animego() = smoke(
        AnimeGoProvider(fetcher),
        SourceQuery(TitleRef(1236063, MediaType.SERIES), "Магическая битва", "Jujutsu Kaisen", 2020, EpisodeKey(1, 2), isAnime = true),
        EpisodeKey(1, 2),
    )

    @Test
    fun rutube() = smoke(RutubeProvider(fetcher), SourceQuery(TitleRef(301, MediaType.MOVIE), "Матрица", year = 1999), null)
}
