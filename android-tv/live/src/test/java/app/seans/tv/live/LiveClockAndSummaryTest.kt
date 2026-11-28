package app.seans.tv.live

import app.seans.tv.live.channel.ChannelMeta
import app.seans.tv.live.channel.normalizeChannel
import app.seans.tv.model.EpisodeKey
import app.seans.tv.model.MediaType
import java.util.Date
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class LiveClockAndSummaryTest {
    @Test fun `offset aims at the middle of the Date second and the round trip`() {
        val sample = LiveClock.offsetFrom(serverMs = 10_000, sentAt = 4_000, receivedAt = 4_200)
        assertEquals(10_000 + 500 - 4_100.0, sample.offsetMs, 0.0)
        assertEquals(200L, sample.rttMs)
    }

    @Test fun `a viewer with a wrong TV clock still lands on the server time`() = runTest {
        var wall = 1_000_000L
        var mono = 50L
        val skew = 5 * 60_000L // the server is 5 minutes ahead of the TV
        val rtts = ArrayDeque(listOf(300L, 40L, 900L))
        val clock = LiveClock(
            sampler = { val rtt = rtts.removeFirst(); LiveClock.offsetFrom(wall + skew - 500 + rtt / 2, wall, wall + rtt).copy() },
            wallMs = { wall },
            monotonicMs = { mono },
            log = {},
        )
        assertEquals("before a sync the TV clock is used", wall, clock.nowMs())
        clock.sync()
        assertTrue(Math.abs(clock.nowMs() - (wall + skew)) < 1500)
        // An NTP jump of the wall clock does not move the channel; the monotonic clock does.
        wall += 120_000
        assertEquals(1_000_000L + skew, clock.nowMs())
        mono += 1_000
        assertEquals(1_000_000L + skew + 1_000, clock.nowMs())
    }

    @Test fun `the lowest round trip wins and sub-second offsets are ignored`() = runTest {
        val samples = ArrayDeque(listOf(ClockSample(5_000.0, 900), ClockSample(800.0, 20), ClockSample(9_000.0, 400)))
        val clock = LiveClock(sampler = { samples.removeFirst() }, wallMs = { 1_000L }, monotonicMs = { 0L }, log = {})
        clock.sync()
        assertEquals(0L, clock.offsetMs)
        assertEquals(1_000L, clock.nowMs())
    }

    @Test fun `offline keeps the TV clock and a fresh sync is not repeated`() = runTest {
        var calls = 0
        val clock = LiveClock(sampler = { calls++; throw java.io.IOException("offline") }, wallMs = { 7L }, monotonicMs = { 0L }, log = {})
        clock.sync()
        assertEquals(3, calls)
        assertEquals(7L, clock.nowMs())
        var ok = 0
        val good = LiveClock(sampler = { ok++; ClockSample(3_000.0, 10) }, wallMs = { 0L }, monotonicMs = { 0L }, log = {})
        good.sync(); good.sync()
        assertEquals(3, ok)
        assertEquals(3_000L, good.offsetMs)
    }

    private val start = java.time.Instant.parse("2026-10-19T18:00:00Z").toEpochMilli().toDouble()
    private val hour = 3_600_000.0

    private fun slot(id: String, from: Double, to: Double, movie: Map<String, Any?> = emptyMap()) = normalizeChannel(
        mapOf("mode" to "movie", "title" to "Показ $id", "startedAt" to Date(from.toLong()), "endsAt" to Date(to.toLong()),
            "movie" to mapOf("kinopoiskId" to 301L, "durationSec" to 3600L, "posterUrl" to "https://example.com/$id.jpg") + movie),
        ChannelMeta.schedule(id),
    )

    @Test fun `Home summary shows the show on air, then the next one, nothing when off`() {
        val manual = normalizeChannel(mapOf("mode" to "off", "startedAt" to Date((start - hour).toLong())))
        val one = slot("one", start, start + hour, mapOf("mediaType" to "tv-series", "seasonNumber" to 2L, "episodeNumber" to 5L))
        val two = slot("two", start + 2 * hour, start + 3 * hour)
        val data = LiveData(manual = manual, schedule = listOf(one, two), scheduleReady = true, confirmed = true)

        val onAir = LiveModule.liveNow(data, start + 600_000)!!
        assertEquals("Показ one", onAir.title)
        assertEquals(MediaType.SERIES, onAir.ref!!.mediaType)
        assertEquals(301L, onAir.ref!!.kinopoiskId)
        assertEquals(EpisodeKey(2, 5), onAir.episode)
        assertEquals(start.toLong(), onAir.startsAt)
        assertEquals((start + hour).toLong(), onAir.endsAt)

        val upcoming = LiveModule.liveNow(data, start + 1.5 * hour)!!
        assertEquals("Показ two", upcoming.title)
        assertEquals((start + 2 * hour).toLong(), upcoming.startsAt)

        assertNull(LiveModule.liveNow(data, start + 4 * hour))
        assertNull(LiveModule.liveNow(LiveData(), start))

        val slots = LiveModule.programmeSlots(data, start + 600_000, java.time.ZoneOffset.UTC)
        assertEquals(listOf("Показ one", "Показ two"), slots.map { it.title })
        assertEquals("С2 · Е5", slots[0].caption)
        assertEquals("1 ч", slots[1].caption)
    }
}
