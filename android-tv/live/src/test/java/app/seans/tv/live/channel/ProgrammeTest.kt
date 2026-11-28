package app.seans.tv.live.channel

import java.time.LocalDate
import java.time.LocalDateTime
import java.time.ZoneId
import java.util.Date
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/**
 * Vectors of `tests/liveProgramme.test.cjs`, `tests/liveStandby.test.cjs` and the viewer part of
 * `tests/liveSchedulePlanner.test.cjs` (the on-air block follows its playback clock).
 */
class ProgrammeTest {
    private val zone = ZoneId.of("Europe/Moscow")

    /** Local wall time on 2026-10-25; hours past 23 run into the next days, as `new Date(2026, 9, 25, 24, 42)` does. */
    private fun at(hour: Int, minute: Int = 0): Double =
        LocalDateTime.of(2026, 10, 25, 0, 0).plusHours(hour.toLong()).plusMinutes(minute.toLong())
            .atZone(zone).toInstant().toEpochMilli().toDouble()

    private val now = at(19, 12)

    private fun show(id: String, from: Double, to: Double, durationSec: Long = ((to - from) / 1000).toLong()) = normalizeChannel(
        mapOf("mode" to "movie", "title" to "Показ $id", "startedAt" to Date(from.toLong()), "endsAt" to Date(to.toLong()),
            "movie" to mapOf("kinopoiskId" to 301L, "durationSec" to durationSec, "posterUrl" to "https://example.com/$id.jpg")),
        ChannelMeta.schedule(id),
    )

    private fun fixtures() = listOf(show("past", at(14), at(15)), show("current", at(18), at(20, 35)),
        show("next", at(21), at(22, 40)), show("late", at(22, 55), at(24, 42)))

    private val live = Position(PositionState.LIVE, 0)

    @Test fun `programme includes overlapping local-day slots and identifies actual resolved playback`() {
        val items = fixtures() + listOf(show("carry-in", at(-1), at(1)), show("tomorrow", at(24, 42), at(26)), show("ends-at-midnight", at(-2), at(0)))
        val current = items[1]
        val model = programmeModel(items, current, live, now, zone)
        assertEquals(listOf("carry-in", "past", "current", "next", "late"), model.rows.map { it.item.id })
        assertEquals(SlotStatus.CURRENT, model.rows.first { it.item.id == "current" }.status)
        assertEquals("next", model.next!!.id)
        val stopped = programmeModel(items, normalizeChannel(mapOf("mode" to "off", "startedAt" to Date(at(19).toLong()))), Position(PositionState.OFF, 0), now, zone)
        assertEquals(SlotStatus.NOT_ON_AIR, stopped.rows.first { it.item.id == "current" }.status)
        val earlyEnd = programmeModel(items, current, Position(PositionState.ENDED, 0), now, zone)
        assertEquals(SlotStatus.FINISHED, earlyEnd.rows.first { it.item.id == "current" }.status)
        assertEquals(at(20, 35), earlyEnd.rows.first { it.item.id == "current" }.endMs, 0.0)
    }

    @Test fun `manual on-air show is included, while schedule IDs cannot impersonate it`() {
        val manual = normalizeChannel(mapOf("mode" to "youtube", "title" to "Live", "startedAt" to Date(at(19).toLong()),
            "youtube" to mapOf("videoId" to "dQw4w9WgXcQ", "live" to true)), ChannelMeta(id = "current"))
        val model = programmeModel(fixtures(), manual, live, now, zone)
        val current = model.rows.filter { it.status == SlotStatus.CURRENT }
        assertEquals(1, current.size)
        assertEquals("settings/cinemaChannel", current[0].item.docPath)
        assertEquals(SlotStatus.NOT_ON_AIR, model.rows.first { it.item.docPath == "cinemaSchedule/current" }.status)
        assertEquals(Double.POSITIVE_INFINITY, current[0].endMs, 0.0)
    }

    @Test fun `upcoming filter and an empty or last show`() {
        val model = programmeModel(fixtures(), fixtures()[1], live, now, zone)
        assertEquals(4, model.rows.size)
        assertEquals(3, model.rows.count { it.status in setOf(SlotStatus.CURRENT, SlotStatus.NEXT, SlotStatus.LATER) })
        assertEquals(SlotStatus.LATER, model.rows.first { it.item.id == "late" }.status)
        val lastOnly = programmeModel(fixtures().take(2), fixtures()[1], live, now, zone)
        assertNull(lastOnly.next)
        assertEquals(0, programmeModel(emptyList(), null, null, now, zone).rows.size)
    }

    @Test fun `the day turns at local midnight`() {
        val items = fixtures()
        val model = programmeModel(items, items[3], live, at(24, 10), zone)
        assertEquals(1, model.rows.size)
        assertEquals(SlotStatus.CURRENT, model.rows[0].status)
        assertEquals("Показ late", model.rows[0].item.title)
    }

    @Test fun `calendar-day bounds respect 23 and 25 hour daylight-saving days`() {
        val newYork = ZoneId.of("America/New_York")
        val hours = listOf(LocalDate.of(2026, 3, 8), LocalDate.of(2026, 11, 1)).map { day ->
            val noon = day.atTime(12, 0).atZone(newYork).toInstant().toEpochMilli().toDouble()
            val m = programmeModel(emptyList(), null, null, noon, newYork)
            (m.dayEnd - m.dayStart) / 3_600_000
        }
        assertEquals(listOf(23L, 25L), hours)
    }

    @Test fun `the show on air moves in the programme with a seek and while paused`() {
        val items = fixtures().toMutableList()
        val seeked = items[1].copy(playbackStartedAtMs = at(17))
        items[1] = seeked
        val row = programmeModel(items, seeked, live, now, zone).rows.first { it.item.id == "current" }
        assertEquals("a seek one hour ahead moves the start one hour back", at(17), row.startMs, 0.0)
        assertEquals(at(20, 35), row.endMs, 0.0)
        assertEquals(Math.floor((now - at(17)) / (at(20, 35) - at(17)) * 100).toInt(), row.progress)

        val base = fixtures()
        val paused = base[1].copy(movie = base[1].movie!!.copy(pausedAtSec = 3000.0))
        val projected = projectPausedSchedule(listOf(base[0], paused) + base.drop(2), paused, now)
        val pausedRow = programmeModel(projected, paused, Position(PositionState.PAUSED, 3000), now, zone).rows.first { it.item.id == "current" }
        assertEquals("paused at 50 minutes: the show started 50 minutes before now", at(18, 22), pausedRow.startMs, 0.0)
        assertEquals(at(20, 57), pausedRow.endMs, 0.0)
        val other = programmeModel(items, seeked, live, now, zone).rows.first { it.item.id == "next" }
        assertEquals("other shows keep their slot", at(21), other.startMs, 0.0)
    }

    // ---- tests/liveSchedulePlanner.test.cjs: the on-air block follows its playback clock ----

    private fun slot(id: String, startHour: Int, endHour: Int, extra: Map<String, Any?> = emptyMap(), movie: Map<String, Any?> = emptyMap()) =
        normalizeChannel(mapOf("mode" to "movie", "title" to "Показ $id", "startedAt" to Date(at(startHour).toLong()), "endsAt" to Date(at(endHour).toLong()),
            "movie" to mapOf("kinopoiskId" to 301L, "durationSec" to (endHour - startHour) * 3600L, "posterUrl" to "", "pausedAtSec" to null) + movie) + extra,
            ChannelMeta.schedule(id))

    @Test fun `planner - a seek draws the running show from where the film began, a pause slides it`() {
        val seeked = slot("live", 11, 13, mapOf("playbackStartedAt" to Date(at(10).toLong())))
        val bounds = playbackBounds(seeked, at(12))
        assertEquals(at(10), bounds.startMs, 0.0)
        assertEquals(at(13), bounds.endMs, 0.0)
        val paused = slot("paused", 11, 13, movie = mapOf("durationSec" to 7200L, "pausedAtSec" to 1800L))
        assertEquals(at(11, 30), playbackBounds(paused, at(12)).startMs, 0.0)
        assertEquals("the paused block slides with the clock", at(11, 40), playbackBounds(paused, at(12, 10)).startMs, 0.0)
    }

    // ---- tests/liveStandby.test.cjs ----

    private val standbyNow = at(12)

    private fun scheduled(id: String, atMs: Double, youtube: Boolean = false) = normalizeChannel(
        mapOf("mode" to if (youtube) "youtube" else "movie", "title" to "Показ $id", "startedAt" to Date(atMs.toLong()), "endsAt" to Date((atMs + 3_600_000).toLong()),
            "movie" to if (youtube) null else mapOf("kinopoiskId" to 301L, "durationSec" to 1800L, "posterUrl" to "https://example.com/$id.jpg"),
            "youtube" to if (youtube) mapOf("videoId" to "dQw4w9WgXcQ", "live" to false, "durationSec" to 900L) else null),
        ChannelMeta.schedule(id),
    )

    private val off = normalizeChannel(mapOf("mode" to "off"))
    private val offPosition = Position(PositionState.OFF, 0)

    @Test fun `standby shows the next show and a ceil-rounded countdown`() {
        val next = scheduled("next", standbyNow + 30_100)
        val model = standbyModel(off, offPosition, next, standbyNow, unavailable = false)
        assertEquals("0:31", formatClock(model.countdownSec!!))
        assertEquals(StandbyKind.GAP, model.kind)
        assertEquals(LiveStrings.GAP_TITLE, model.title)
        assertEquals("Показ next", model.next!!.title)
        assertEquals("https://example.com/next.jpg", coverUrl(model.next))
        assertEquals("0:20", formatClock(standbyModel(off, offPosition, next, standbyNow + 10_100, false).countdownSec!!))
    }

    @Test fun `an early-ended show announces its next show without changing the allotted slot`() {
        val channel = scheduled("current", standbyNow - 10_000)
        val next = scheduled("next", channel.endsAtMs)
        val model = standbyModel(channel, Position(PositionState.ENDED, 9), next, standbyNow, false)
        assertEquals(StandbyKind.ENDED_WITH_NEXT, model.kind)
        assertEquals(LiveStrings.ENDED_NEXT_TITLE, model.title)
        assertEquals(LiveStrings.ENDED_NEXT_TEXT, model.text)
        assertEquals("59:50", formatClock(model.countdownSec!!))
        assertEquals(channel.endsAtMs, next.startedAtMs, 0.0)
    }

    @Test fun `an empty or ended schedule hides the next show and countdown`() {
        val empty = standbyModel(off, offPosition, null, standbyNow, false)
        assertEquals(StandbyKind.EMPTY, empty.kind)
        assertEquals(LiveStrings.EMPTY_TITLE, empty.title)
        assertNull(empty.countdownSec)
        assertNull(empty.next)
        assertEquals(LiveStrings.NO_SHOWS, empty.noTimeHint)
        val ended = standbyModel(scheduled("ended", standbyNow - 3_600_000), Position(PositionState.ENDED, 1800), null, standbyNow, false)
        assertEquals(LiveStrings.ENDED_TITLE, ended.title)
    }

    @Test fun `a connection error overrides stale upcoming metadata`() {
        val model = standbyModel(off, offPosition, scheduled("next", standbyNow + 60_000), standbyNow, unavailable = true)
        assertEquals(StandbyKind.UNAVAILABLE, model.kind)
        assertEquals(LiveStrings.UNAVAILABLE_TITLE, model.title)
        assertNull(model.countdownSec)
        assertEquals(LiveStrings.CONNECTION_HINT, model.noTimeHint)
    }

    @Test fun `a YouTube next show uses its thumbnail`() {
        assertEquals("https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg", coverUrl(scheduled("two", standbyNow + 120_000, youtube = true)))
    }

    @Test fun `captions and lengths`() {
        assertEquals("2 ч 24 мин", formatLength(144 * 60))
        assertEquals("1 ч 04 мин", formatLength(64 * 60))
        assertEquals("45 мин", formatLength(45 * 60))
        val episode = normalizeChannel(mapOf("mode" to "movie", "movie" to mapOf("kinopoiskId" to 1L, "mediaType" to "tv-series",
            "seasonNumber" to 1L, "episodeNumber" to 2L, "episodeTitle" to "Пилот")))
        assertEquals("С1 · Е2 · Пилот", slotCaption(episode))
    }
}
