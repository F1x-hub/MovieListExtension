package app.seans.tv.data

import app.seans.tv.data.progress.SeansProgressRepository
import app.seans.tv.model.EpisodeKey
import app.seans.tv.model.MediaType
import app.seans.tv.model.PlaybackPosition
import app.seans.tv.model.TitleRef
import java.io.File
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.long
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder

/**
 * Store-level cases of `tests/playbackProgressEpisodeIdentity.test.cjs` and the P1/P4 rules.
 * The player-side cases (selection reasons, flush timing) belong to `:player`.
 */
class ProgressRepositoryTest {
    @get:Rule val tmp = TemporaryFolder()

    private val series = TitleRef(412344, MediaType.SERIES)
    private val film = TitleRef(301, MediaType.MOVIE)

    private fun repo(dir: File = tmp.root) = SeansProgressRepository(dir)

    private fun pos(ref: TitleRef, episode: EpisodeKey?, seconds: Long, at: Long, duration: Long = 2700, completed: Boolean = false, provider: String? = "seasonvar") =
        PlaybackPosition(ref, episode, seconds * 1000, duration * 1000, at, completed, provider)

    @Test fun `a film's position stays a film's`() = runTest {
        val repo = repo()
        repo.save(pos(film, null, 1200, at = 1))
        val saved = repo.latestFor(film)!!
        assertNull(saved.episode)
        assertEquals(1_200_000, saved.positionMs)
        assertEquals(1_200_000, repo.get(film, null)!!.positionMs)
        assertTrue(repo.episodesOf(film).isEmpty())
    }

    @Test fun `moving to another episode does not give it the old episode's time`() = runTest {
        val repo = repo()
        val e1 = EpisodeKey(1, 1)
        val e2 = EpisodeKey(1, 2)
        repo.save(pos(series, e1, 133, at = 1))
        repo.save(pos(series, e2, 0, at = 2))
        assertEquals(133_000, repo.get(series, e1)!!.positionMs)
        assertEquals(0, repo.get(series, e2)!!.positionMs)
        assertEquals(e2, repo.latestFor(series)!!.episode)
        assertEquals(0, repo.latestFor(series)!!.positionMs)
    }

    @Test fun `a zero never replaces a real position of the same episode`() = runTest {
        val repo = repo()
        val e6 = EpisodeKey(1, 6)
        repo.save(pos(series, e6, 1335, at = 1))
        repo.save(pos(series, e6, 0, at = 2))
        assertEquals(1_335_000, repo.get(series, e6)!!.positionMs)
        assertEquals(1_335_000, repo.latestFor(series)!!.positionMs)
    }

    @Test fun `completed is monotonic per episode`() = runTest {
        val repo = repo()
        val e = EpisodeKey(2, 5)
        repo.save(pos(series, e, 2600, at = 1, completed = true))
        repo.save(pos(series, e, 300, at = 2, completed = false))
        val saved = repo.get(series, e)!!
        assertTrue(saved.completed)
        assertEquals(300_000, saved.positionMs)
        assertNull(repo.get(series, EpisodeKey(2, 6)))
    }

    @Test fun `progress is keyed by the Kinopoisk ID only`() = runTest {
        val repo = repo()
        val withTmdb = series.copy(tmdbId = 1396)
        repo.save(pos(withTmdb, EpisodeKey(1, 3), 50, at = 1))
        assertEquals(50_000, repo.get(series, EpisodeKey(1, 3))!!.positionMs)
        assertEquals(50_000, repo.latestFor(series)!!.positionMs)
        assertEquals(series, repo.latestFor(series)!!.ref)
    }

    @Test fun `season 0 is a real season`() = runTest {
        val repo = repo()
        repo.save(pos(series, EpisodeKey(0, 1), 90, at = 1))
        assertEquals(EpisodeKey(0, 1), repo.latestFor(series)!!.episode)
        assertEquals(setOf(EpisodeKey(0, 1)), repo.episodesOf(series).keys)
    }

    @Test fun `recent lists unfinished titles newest first and drops finished films`() = runTest {
        val repo = repo()
        val other = TitleRef(77044, MediaType.SERIES)
        repo.save(pos(film, null, 6000, at = 1, duration = 6100, completed = true))
        repo.save(pos(series, EpisodeKey(1, 2), 100, at = 2))
        repo.save(pos(other, EpisodeKey(4, 11), 1000, at = 3))
        val recent = repo.recent(10).first()
        assertEquals(listOf(77044L, 412344L), recent.map { it.ref.kinopoiskId })
        assertEquals(MediaType.SERIES, recent.first().ref.mediaType)
    }

    @Test fun `positions survive a restart in the P1 shape`() = runTest {
        repo().save(pos(series, EpisodeKey(2, 5), 860, at = 42, provider = "kodik"))
        val reopened = repo()
        val latest = reopened.latestFor(series)!!
        assertEquals(EpisodeKey(2, 5), latest.episode)
        assertEquals(860_000, latest.positionMs)
        assertEquals("kodik", latest.providerKey)

        val json = Json.parseToJsonElement(File(tmp.root, "progress.json").readText()).jsonObject
        val title = json["titles"]!!.jsonObject["412344"]!!.jsonObject
        assertEquals("tv-series", title["mediaType"]!!.jsonPrimitive.content)
        val stored = title["latest"]!!.jsonObject
        assertEquals(860, stored["timestamp"]!!.jsonPrimitive.long)
        assertEquals(2700, stored["duration"]!!.jsonPrimitive.long)
        assertEquals(860, title["episodes"]!!.jsonObject["2:5"]!!.jsonObject["t"]!!.jsonPrimitive.long)
    }

    @Test fun `episodes are pruned to the newest 100 and titles to 200`() = runTest {
        val repo = repo()
        for (i in 1..105) repo.save(pos(series, EpisodeKey(1, i), 10, at = i.toLong()))
        val episodes = repo.episodesOf(series)
        assertEquals(100, episodes.size)
        assertNull(episodes[EpisodeKey(1, 1)])
        assertTrue(episodes.containsKey(EpisodeKey(1, 105)))
        for (kp in 1L..205L) repo.save(pos(TitleRef(kp, MediaType.MOVIE), null, 10, at = 1000 + kp))
        assertNull(repo.latestFor(TitleRef(1, MediaType.MOVIE)))
        assertEquals(10_000, repo.latestFor(TitleRef(205, MediaType.MOVIE))!!.positionMs)
    }

    @Test fun `a damaged file falls back to the backup and is kept aside`() = runTest {
        val first = repo()
        first.save(pos(film, null, 100, at = 1))
        first.save(pos(film, null, 200, at = 2)) // the 100 s version is now progress.json.bak
        File(tmp.root, "progress.json").writeText("{\"titles\": {\"301\": {tru") // torn by a power cut
        val reopened = repo()
        assertEquals(100_000, reopened.latestFor(film)!!.positionMs)
        assertTrue(File(tmp.root, "progress.json.corrupt").exists())
        assertFalse(File(tmp.root, "progress.json.tmp").exists())
    }

    @Test fun `a missing main file falls back to the backup`() = runTest {
        val first = repo()
        first.save(pos(film, null, 100, at = 1))
        first.save(pos(film, null, 200, at = 2))
        File(tmp.root, "progress.json").delete() // a cut between the two renames
        assertEquals(100_000, repo().latestFor(film)!!.positionMs)
    }
}
