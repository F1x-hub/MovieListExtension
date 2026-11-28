package app.seans.tv.player

import app.seans.tv.model.EpisodeKey
import app.seans.tv.model.MediaType
import app.seans.tv.model.PlaybackPosition
import app.seans.tv.model.ProviderId
import app.seans.tv.model.TitleRef
import app.seans.tv.player.progress.ProgressIdentity
import app.seans.tv.player.progress.ProgressWriter
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Ports `tests/playbackProgressEpisodeIdentity.test.cjs` (the cases that apply to a native
 * player) plus the writer rules of risks P1-P3.
 */
class ProgressWriterTest {
    private val series = TitleRef(412344, MediaType.SERIES)
    private val film = TitleRef(301, MediaType.MOVIE)

    private class Harness(scope: TestScope) {
        var clock = 1_000_000L
        val saves = mutableListOf<PlaybackPosition>()
        val writer = ProgressWriter(scope.backgroundScope, { clock }) { saves += it }
        val last get() = saves.last()
    }

    private fun id(ep: Int?, provider: ProviderId? = ProviderId.SEASONVAR, ref: TitleRef = series) =
        ProgressIdentity(ref, ep?.let { EpisodeKey(1, it) }, provider, null)

    @Test
    fun `a time report keeps the episode of the selection`() = runTest {
        val h = Harness(this)
        val v = h.writer.begin(id(7), 0, null)
        h.writer.report(v, 22_000, 2_400_000, playing = true)
        h.writer.flush()
        runCurrent()
        assertEquals(EpisodeKey(1, 7), h.last.episode)
        assertEquals(22_000, h.last.positionMs)
    }

    @Test
    fun `a film's report stays a film's`() = runTest {
        val h = Harness(this)
        val v = h.writer.begin(id(null, ref = film), 0, null)
        h.writer.report(v, 1_200_000, 7_200_000, playing = true)
        h.writer.flush()
        runCurrent()
        assertNull(h.last.episode)
        assertEquals(1_200_000, h.last.positionMs)
    }

    @Test
    fun `moving to another episode does not give it the old episode's time`() = runTest {
        val h = Harness(this)
        val v1 = h.writer.begin(id(1), 0, null)
        h.writer.report(v1, 133_000, 2_400_000, playing = true)
        h.writer.end()
        h.writer.begin(id(2), 0, null)
        runCurrent()
        assertEquals(EpisodeKey(1, 1), h.last.episode)
        assertEquals("the old episode keeps its time", 133_000, h.last.positionMs)
        // A late report of episode 1 arrives after the switch: dropped.
        h.writer.report(v1, 140_000, 2_400_000, playing = true)
        h.writer.flush()
        runCurrent()
        assertTrue(h.saves.none { it.episode == EpisodeKey(1, 2) && it.positionMs == 133_000L })
        assertTrue(h.saves.none { it.episode == EpisodeKey(1, 1) && it.positionMs == 140_000L })
        assertTrue("an unplayed mount never writes 0", h.saves.none { it.episode == EpisodeKey(1, 2) })
    }

    @Test
    fun `a resume selection keeps its own position until the episode reports`() = runTest {
        val h = Harness(this)
        val v = h.writer.begin(id(3), 0, null)
        h.writer.report(v, 50_000, 2_400_000, playing = true)
        h.writer.begin(id(6), 1_335_000, null)
        h.writer.flush()
        runCurrent()
        assertEquals(EpisodeKey(1, 6), h.last.episode)
        assertEquals(1_335_000, h.last.positionMs)
    }

    @Test
    fun `an in-place episode change resets the position`() = runTest {
        val h = Harness(this)
        val v = h.writer.begin(id(4), 0, null)
        h.writer.report(v, 610_000, 2_400_000, playing = true)
        h.writer.end()
        val v5 = h.writer.begin(id(5), 0, null)
        h.writer.report(v5, 0, 2_400_000, playing = true)
        h.writer.flush()
        runCurrent()
        assertEquals(EpisodeKey(1, 5), h.last.episode)
        assertEquals(0, h.last.positionMs)
    }

    @Test
    fun `periodic writes are throttled to 15 s and pause flushes at once`() = runTest {
        val h = Harness(this)
        val v = h.writer.begin(id(1), 0, null)
        for (s in 1..14) {
            h.clock += 1_000
            h.writer.report(v, s * 1_000L, 2_400_000, playing = true)
        }
        runCurrent()
        assertEquals(0, h.saves.size)
        h.clock += 1_000
        h.writer.report(v, 15_000, 2_400_000, playing = true)
        runCurrent()
        assertEquals(1, h.saves.size)
        h.clock += 2_000
        h.writer.report(v, 17_000, 2_400_000, playing = false)
        h.writer.flush(v)
        runCurrent()
        assertEquals(2, h.saves.size)
        assertEquals(17_000, h.last.positionMs)
    }

    @Test
    fun `a mount that has not played writes its start, never 0`() = runTest {
        val h = Harness(this)
        val v = h.writer.begin(id(2), 0, null)
        h.writer.report(v, 0, 2_400_000, playing = false)
        h.writer.flush()
        runCurrent()
        assertTrue(h.saves.isEmpty())
        h.writer.begin(id(3), 600_000, null)
        h.writer.flush()
        runCurrent()
        assertEquals(600_000, h.last.positionMs)
    }

    @Test
    fun `completion only from a provider that marks it, and it stays`() = runTest {
        val h = Harness(this)
        val rutube = h.writer.begin(id(1, ProviderId.RUTUBE), 0, null)
        h.writer.report(rutube, 2_300_000, 2_400_000, playing = true)
        h.writer.ended(rutube)
        runCurrent()
        assertFalse("Rutube never marks watched", h.last.completed)

        val v = h.writer.begin(id(2), 0, null)
        h.writer.report(v, 2_200_000, 2_400_000, playing = true)
        h.writer.flush()
        runCurrent()
        assertTrue("92% of 40 min is complete", h.last.completed)
        h.writer.report(v, 60_000, 2_400_000, playing = true)
        h.writer.flush()
        runCurrent()
        assertTrue("completed stays true for the episode", h.last.completed)

        // Another source for the same episode keeps it too.
        h.writer.end()
        val other = h.writer.begin(id(2, ProviderId.ANIMEGO), 60_000, null)
        h.writer.report(other, 70_000, 2_400_000, playing = true)
        h.writer.flush()
        runCurrent()
        assertTrue(h.last.completed)
        assertEquals("animego", h.last.providerKey)
    }

    @Test
    fun `short content completes only on a real end`() = runTest {
        val h = Harness(this)
        val v = h.writer.begin(id(1), 0, null)
        h.writer.report(v, 110_000, 115_000, playing = true)
        h.writer.flush()
        runCurrent()
        assertFalse(h.last.completed)
        h.writer.ended(v)
        runCurrent()
        assertTrue(h.last.completed)
        assertEquals(115_000, h.last.positionMs)
    }

    @Test
    fun `writes keep their order even when the store is slow`() = runTest {
        val order = mutableListOf<EpisodeKey?>()
        val writer = ProgressWriter(backgroundScope, { 0L }) { kotlinx.coroutines.delay(100); order += it.episode }
        val v1 = writer.begin(id(1), 0, null)
        writer.report(v1, 10_000, 100_000, playing = true)
        writer.end()
        val v2 = writer.begin(id(2), 0, null)
        writer.report(v2, 5_000, 100_000, playing = true)
        writer.flush()
        testScheduler.advanceTimeBy(1_000)
        testScheduler.runCurrent()
        assertEquals(listOf(EpisodeKey(1, 1), EpisodeKey(1, 2)), order)
    }
}
