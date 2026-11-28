package app.seans.tv.live.channel

import java.util.Date
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** Vectors of `tests/cinemaChannel.test.cjs` and the viewer parts of `tests/cinemaScheduleTransactions.test.cjs`. */
class CinemaChannelTest {
    private val start = java.time.Instant.parse("2026-10-19T18:00:00Z").toEpochMilli().toDouble()
    private val hour = 3_600_000.0

    private fun date(ms: Double) = Date(ms.toLong())
    private fun pos(state: PositionState, offset: Long) = Position(state, offset)

    @Test fun `unknown or broken documents fall back to an off channel`() {
        assertEquals(ChannelMode.OFF, normalizeChannel(null).mode)
        assertEquals(ChannelMode.OFF, normalizeChannel(mapOf("mode" to "stream")).mode)
        assertEquals(ChannelMode.OFF, normalizeChannel(mapOf("mode" to "youtube", "youtube" to mapOf("videoId" to "<script>"))).mode)
        assertEquals(ChannelMode.OFF, normalizeChannel(mapOf("mode" to "movie", "movie" to mapOf("kinopoiskId" to -3L))).mode)
    }

    @Test fun `a late viewer joins at the broadcast position`() {
        val channel = normalizeChannel(mapOf("mode" to "movie", "movie" to mapOf("kinopoiskId" to 301L, "durationSec" to 8160L), "startedAt" to date(start)))
        assertEquals(pos(PositionState.LIVE, 47 * 60 + 12L), computePosition(channel, start + 47 * 60 * 1000 + 12_000))
        assertEquals(PositionState.ENDED, computePosition(channel, start + 8160 * 1000).state)
        assertEquals(pos(PositionState.UPCOMING, 30), computePosition(channel, start - 30_000))
    }

    @Test fun `Firestore timestamps and live YouTube streams`() {
        val vod = normalizeChannel(mapOf("mode" to "youtube", "youtube" to mapOf("videoId" to "dQw4w9WgXcQ"),
            "startedAt" to mapOf("seconds" to (start / 1000).toLong(), "nanoseconds" to 0)))
        assertEquals(90L, computePosition(vod, start + 90_000).offsetSec)
        val live = normalizeChannel(mapOf("mode" to "youtube", "youtube" to mapOf("videoId" to "dQw4w9WgXcQ", "live" to true), "startedAt" to date(start)))
        assertEquals(pos(PositionState.LIVE, 0), computePosition(live, start + 9_999_000))
    }

    @Test fun `episode documents keep a complete canonical selection and the episode runtime`() {
        val stored = mapOf("kinopoiskId" to 301L, "durationSec" to 2550L, "posterUrl" to "", "pausedAtSec" to null,
            "tmdbId" to 1399L, "mediaType" to "tv-series", "seasonNumber" to 0L, "episodeNumber" to 2L, "episodeTitle" to " Спецвыпуск ")
        val normalized = normalizeChannel(mapOf("mode" to "movie", "movie" to stored, "startedAt" to date(start)))
        assertEquals(MovieMedia(301, 2550, false, "", Double.NaN, 1399, "tv-series", 0, 2, "Спецвыпуск"), normalized.movie)
        assertEquals(PositionState.ENDED, computePosition(normalized, start + 2_550_000).state)
        val legacy = normalizeChannel(mapOf("mode" to "movie", "movie" to mapOf("kinopoiskId" to 301L)))
        assertNull(legacy.movie!!.mediaType)
        assertNull(legacy.movie!!.seasonNumber)
        assertNull(legacy.movie!!.tmdbId)
        assertEquals(12L, normalizeChannel(mapOf("mode" to "movie", "movie" to mapOf("kinopoiskId" to 301L, "tmdbId" to 12L))).movie!!.tmdbId)
        // Number(...) coercion of the extension: a numeric string ID is still the film.
        assertEquals(301L, normalizeChannel(mapOf("mode" to "movie", "movie" to mapOf("kinopoiskId" to "301"))).movie!!.kinopoiskId)
    }

    @Test fun `invalid or half-specified episode fields become off instead of a different episode`() {
        val episode = mapOf("mediaType" to "tv-series", "seasonNumber" to 1L, "episodeNumber" to 2L)
        val invalid: List<Map<String, Any?>> = listOf(
            mapOf("seasonNumber" to 1L), mapOf("episodeNumber" to 2L), mapOf("episodeTitle" to "Series"), mapOf("mediaType" to "movie"),
            mapOf("mediaType" to "tv-series"), mapOf("mediaType" to "tv-series", "seasonNumber" to 1L),
            episode + ("seasonNumber" to -1L), episode + ("seasonNumber" to 1.5), episode + ("seasonNumber" to true),
            episode + ("episodeNumber" to 0L), episode + ("episodeNumber" to ""), episode + ("episodeNumber" to null),
            episode + ("episodeNumber" to "1e3"), episode + ("episodeNumber" to 9_007_199_254_740_992.0),
            episode + ("episodeTitle" to 123L), episode + ("episodeTitle" to "x".repeat(201)),
            episode + ("tmdbId" to 0L), episode + ("tmdbId" to true), mapOf("tmdbId" to -2L),
            episode + ("seasonNumber" to "1"),
        )
        for (fields in invalid) {
            val channel = normalizeChannel(mapOf("mode" to "movie", "movie" to mapOf("kinopoiskId" to 301L) + fields))
            assertEquals(fields.toString(), ChannelMode.OFF, channel.mode)
        }
        assertEquals(ChannelMode.MOVIE, normalizeChannel(mapOf("mode" to "movie", "movie" to mapOf("kinopoiskId" to 301L) + episode)).mode)
        // A whole Double from Firestore is an integer for Number.isSafeInteger.
        assertEquals(1, normalizeChannel(mapOf("mode" to "movie", "movie" to mapOf("kinopoiskId" to 301L) + episode + ("seasonNumber" to 1.0))).movie!!.seasonNumber)
    }

    @Test fun `an admin pause freezes every viewer at the same second`() {
        val paused = normalizeChannel(mapOf("mode" to "movie", "movie" to mapOf("kinopoiskId" to 301L, "durationSec" to 8160L, "pausedAtSec" to 397L), "startedAt" to date(start)))
        assertEquals(pos(PositionState.PAUSED, 397), computePosition(paused, start + 3_600_000))
        val running = normalizeChannel(mapOf("mode" to "movie", "movie" to mapOf("kinopoiskId" to 301L, "pausedAtSec" to null), "startedAt" to date(start)))
        assertEquals(PositionState.LIVE, computePosition(running, start + 10_000).state)
    }

    @Test fun `YouTube videos can be paused by the admin, live streams never`() {
        val vod = normalizeChannel(mapOf("mode" to "youtube", "youtube" to mapOf("videoId" to "dQw4w9WgXcQ", "pausedAtSec" to 61L), "startedAt" to date(start)))
        assertEquals(pos(PositionState.PAUSED, 61), computePosition(vod, start + 999_000))
        val live = normalizeChannel(mapOf("mode" to "youtube", "youtube" to mapOf("videoId" to "dQw4w9WgXcQ", "live" to true, "pausedAtSec" to 61L), "startedAt" to date(start)))
        assertEquals(PositionState.LIVE, computePosition(live, start).state)
    }

    @Test fun `clock formatting`() {
        assertEquals("1:15", formatClock(75))
        assertEquals("3:00:05", formatClock(3 * 3600 + 5L))
    }

    @Test fun `unsafe poster URLs are dropped`() {
        assertEquals("https://st.kp.yandex.net/301.jpg", normalizeChannel(mapOf("mode" to "movie", "movie" to mapOf("kinopoiskId" to 301L, "posterUrl" to "https://st.kp.yandex.net/301.jpg"))).movie!!.posterUrl)
        assertEquals("", normalizeChannel(mapOf("mode" to "movie", "movie" to mapOf("kinopoiskId" to 301L, "posterUrl" to "javascript:alert(1)"))).movie!!.posterUrl)
    }

    private fun sched(id: String, startMs: Double, extra: Map<String, Any?> = emptyMap()) = normalizeChannel(
        mapOf("mode" to "movie", "title" to id, "movie" to mapOf("kinopoiskId" to 301L, "durationSec" to 7200L) + extra, "startedAt" to date(startMs)),
        ChannelMeta.schedule(id),
    )

    @Test fun `schedule - planned shows start on their own and later starts supersede earlier ones`() {
        val manualOff = normalizeChannel(mapOf("mode" to "off", "startedAt" to date(start - hour)))
        val evening = sched("evening", start + 2 * hour)
        val night = sched("night", start + 5 * hour)
        var shown = resolveChannel(manualOff, listOf(evening, night), start)
        assertEquals("evening", shown.id)
        assertEquals(PositionState.UPCOMING, computePosition(shown, start).state)
        shown = resolveChannel(manualOff, listOf(evening, night), start + 2 * hour + 60_000)
        assertEquals("evening", shown.id)
        assertEquals(pos(PositionState.LIVE, 60), computePosition(shown, start + 2 * hour + 60_000))
        assertEquals("night", resolveChannel(manualOff, listOf(evening, night), start + 4 * hour + 1000).id)
        val stopped = normalizeChannel(mapOf("mode" to "off", "startedAt" to date(start + 3 * hour)))
        assertEquals(ChannelMode.OFF, resolveChannel(stopped, listOf(evening), start + 3 * hour + 1000).mode)
        assertEquals("cinemaSchedule/evening", evening.docPath)
    }

    // ---- tests/cinemaScheduleTransactions.test.cjs (viewer functions) ----

    private fun slotDoc(startH: Double, endH: Double?, extra: Map<String, Any?> = emptyMap(), movie: Map<String, Any?> = emptyMap()): Map<String, Any?> =
        mapOf<String, Any?>(
            "mode" to "movie", "title" to "Movie", "startedAt" to date(start + startH * hour),
            "youtube" to null, "movie" to mapOf("kinopoiskId" to 301L, "durationSec" to 3600L, "pausedAtSec" to null, "posterUrl" to "") + movie,
        ).let { if (endH != null) it + ("endsAt" to date(start + endH * hour)) else it } + extra

    @Test fun `explicit fixed slots hold while paused and a catalogue length never ends them early`() {
        val current = normalizeChannel(slotDoc(0.0, 2.0, mapOf("playbackStartedAt" to date(start + 0.25 * hour))), ChannelMeta("one", null, true))
        val paused = current.copy(movie = current.movie!!.copy(pausedAtSec = 30.0))
        assertEquals(PositionState.UPCOMING, computePosition(paused, start - 1000).state)
        assertEquals("a pause holds the slot past its end", pos(PositionState.PAUSED, 30), computePosition(paused, start + 2 * hour))
        assertEquals(900L, computePosition(current, start + 0.5 * hour).offsetSec)
        assertEquals(PositionState.LIVE, computePosition(current, start + 1.5 * hour).state)
        val measured = current.copy(movie = current.movie!!.copy(durationMeasured = true))
        assertEquals(PositionState.ENDED, computePosition(measured, start + 1.5 * hour).state)
        assertEquals(PositionState.ENDED, computePosition(current, start + 2 * hour).state)
        val next = normalizeChannel(slotDoc(2.0, 3.0), ChannelMeta("next", null, true))
        val older = normalizeChannel(slotDoc(-1.0, 4.0), ChannelMeta("old", null, true))
        assertEquals("one", resolveChannel(null, listOf(older, current, next), start + 1.5 * hour).id)
        assertEquals("next", resolveChannel(null, listOf(older, current, next), start + 2 * hour).id)
        assertEquals("next", nextScheduled(listOf(next, current), start + hour)!!.id)
        val stream = normalizeChannel(slotDoc(0.0, 1.0, mapOf("mode" to "youtube", "movie" to null,
            "youtube" to mapOf("videoId" to "dQw4w9WgXcQ", "live" to true))), ChannelMeta(scheduled = true))
        assertEquals(PositionState.ENDED, computePosition(stream, start + hour).state)
    }

    @Test fun `legacy display bounds use runtime or 4h, manual streams play indefinitely`() {
        val legacy = normalizeChannel(slotDoc(0.0, null), ChannelMeta(scheduled = true))
        assertEquals(Bounds(start, start + hour, false), getScheduleBounds(legacy))
        val noLength = legacy.copy(movie = legacy.movie!!.copy(durationSec = 0))
        assertEquals(start + 4 * hour, getScheduleBounds(noLength).endMs, 0.0)
        assertEquals(PositionState.LIVE, computePosition(noLength, start + 10 * hour).state)
        val stream = normalizeChannel(mapOf("mode" to "youtube", "startedAt" to date(start), "youtube" to mapOf("videoId" to "dQw4w9WgXcQ", "live" to true)))
        assertEquals(Double.POSITIVE_INFINITY, getScheduleBounds(stream).endMs, 0.0)
        assertEquals(PositionState.LIVE, computePosition(stream, start + 100 * hour).state)
    }

    @Test fun `the show on air is placed by its playback clock`() {
        val current = normalizeChannel(slotDoc(0.0, 2.0, mapOf("playbackStartedAt" to date(start - hour))), ChannelMeta.schedule("one"))
        assertEquals(Bounds(start - hour, start + 2 * hour, true), playbackBounds(current, start + 0.5 * hour))
        val paused = current.copy(movie = current.movie!!.copy(pausedAtSec = 600.0))
        val anchor = start + hour - 600_000
        assertEquals(Bounds(anchor, start + 2 * hour + (anchor - (start - hour)), true), playbackBounds(paused, start + hour))
        assertEquals(getScheduleBounds(current), playbackBounds(current, start - 1000))
        val projected = projectPausedSchedule(listOf(paused), paused, start + hour)[0]
        assertEquals(playbackBounds(paused, start + hour), playbackBounds(projected, start + hour))
    }

    @Test fun `a catalogue length does not limit the playable range of a fixed slot, a measured one does`() {
        val unmeasured = normalizeChannel(slotDoc(0.0, 2.0), ChannelMeta.schedule("one"))
        assertEquals(7200L, playableSec(unmeasured))
        assertEquals(3600L, playableSec(unmeasured.copy(movie = unmeasured.movie!!.copy(durationMeasured = true))))
        assertFalse(lengthIsExact(unmeasured))
        assertTrue(lengthIsExact(normalizeChannel(slotDoc(0.0, null))))
    }

    @Test fun `a pause holds the programme, the preview postpones following shows, a manual stop overrides`() {
        // one [0h,1h] paused at 30 min, two and three back to back, a free gap before «gap».
        val one = normalizeChannel(slotDoc(0.0, 1.0, movie = mapOf("pausedAtSec" to 1800L)), ChannelMeta.schedule("one"))
        val two = normalizeChannel(slotDoc(1.0, 2.0), ChannelMeta.schedule("two"))
        val three = normalizeChannel(slotDoc(2.0, 3.0), ChannelMeta.schedule("three"))
        val gap = normalizeChannel(slotDoc(5.5, 6.5), ChannelMeta.schedule("gap"))
        val manual = normalizeChannel(mapOf("mode" to "off", "startedAt" to date(start - 0.5 * hour)))
        val now = start + 2.5 * hour
        val queued = listOf(one, two, three, gap)
        assertEquals("one", resolveChannel(manual, queued, now).id)
        assertEquals(pos(PositionState.PAUSED, 1800), computePosition(one, now))
        val preview = projectPausedSchedule(queued, one, now)
        assertEquals(now + 1_800_000, preview[0].endsAtMs, 0.0)
        assertEquals(preview[0].endsAtMs, preview[1].startedAtMs, 0.0)
        assertEquals(preview[1].endsAtMs, preview[2].startedAtMs, 0.0)
        assertEquals("an unoccupied gap absorbs the delay", gap.startedAtMs, preview[3].startedAtMs, 0.0)
        assertEquals("two", nextScheduled(preview, now)!!.id)
        assertEquals("preview never mutates the snapshot", start + hour, two.startedAtMs, 0.0)
        val stoppedWhilePaused = normalizeChannel(mapOf("mode" to "off", "startedAt" to date(now)))
        assertNotEquals(one.docPath, resolveChannel(stoppedWhilePaused, queued, now).docPath)
    }

    @Test fun `channel key changes only with what is on air`() {
        val film = sched("a", start)
        assertEquals("movie:cinemaSchedule/a:301", channelKey(film))
        assertEquals(channelKey(film), channelKey(film.copy(movie = film.movie!!.copy(pausedAtSec = 10.0))))
        val episode = sched("a", start, mapOf("mediaType" to "tv-series", "seasonNumber" to 1L, "episodeNumber" to 3L))
        assertEquals("movie:cinemaSchedule/a:301:S1E3", channelKey(episode))
        assertEquals("off", channelKey(normalizeChannel(null)))
    }
}
