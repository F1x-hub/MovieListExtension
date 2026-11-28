package app.seans.tv.live.ui

import app.seans.tv.live.channel.ChannelMeta
import app.seans.tv.live.channel.normalizeChannel
import app.seans.tv.model.ServerClock
import java.util.Date
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class BroadcastLockTest {
    private val start = 1_800_000_000_000L
    private val hour = 3_600_000L

    private fun doc(movie: Map<String, Any?> = emptyMap(), extra: Map<String, Any?> = emptyMap()) = mapOf(
        "mode" to "movie", "startedAt" to Date(start), "endsAt" to Date(start + 2 * hour),
        "movie" to mapOf("kinopoiskId" to 301L, "durationSec" to 3600L) + movie,
    ) + extra

    @Test fun `the lock anchors on the playback clock, not the grid start`() {
        val seeked = normalizeChannel(doc(extra = mapOf("playbackStartedAt" to Date(start - 600_000))), ChannelMeta.schedule("a"))
        val lock = broadcastLockOf(seeked, (start + hour).toDouble())
        assertEquals(start - 600_000, lock.anchorServerMs)
        assertNull(lock.pausedAtMs)
        assertEquals("a fixed slot ends at its end, not at the catalogue length", start + 2 * hour, lock.endsAtServerMs)
        assertEquals(hour + 600_000, lock.targetPositionMs(ServerClock { start + hour }))
    }

    @Test fun `a paused show holds its position and a manual film ends with its length`() {
        val paused = normalizeChannel(doc(movie = mapOf("pausedAtSec" to 397.5)), ChannelMeta.schedule("a"))
        val lock = broadcastLockOf(paused, (start + hour).toDouble())
        assertEquals(397_500L, lock.pausedAtMs)
        assertEquals(397_500L, lock.targetPositionMs(ServerClock { start + 5 * hour }))
        val manual = normalizeChannel(doc())
        val manualLock = broadcastLockOf(manual, start.toDouble())
        assertEquals(start, manualLock.anchorServerMs)
        assertEquals(start + hour, manualLock.endsAtServerMs)
    }
}
