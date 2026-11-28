package app.seans.tv.player

import app.seans.tv.model.EpisodeInfo
import app.seans.tv.model.EpisodeKey
import app.seans.tv.model.MediaType
import app.seans.tv.model.PlaybackPosition
import app.seans.tv.model.ProviderId
import app.seans.tv.model.SeasonInfo
import app.seans.tv.model.SelectionReason
import app.seans.tv.model.SourceEvent
import app.seans.tv.model.SourceKind
import app.seans.tv.model.SourceOption
import app.seans.tv.model.TitleRef
import app.seans.tv.model.VoiceOption
import app.seans.tv.player.session.QualityLadder
import app.seans.tv.player.session.Selection
import app.seans.tv.player.session.SourcePicker
import app.seans.tv.player.session.StallWatch
import app.seans.tv.model.PlayableStream
import app.seans.tv.model.QualityOption
import app.seans.tv.model.StreamFormat
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class SelectionTest {
    private val ref = TitleRef(1, MediaType.SERIES)
    private fun stored(pos: Long, dur: Long = 2_400_000, completed: Boolean = false) =
        PlaybackPosition(ref, EpisodeKey(1, 6), pos, dur, 0, completed)

    @Test
    fun `explicit reasons override stored progress`() {
        assertEquals(1_335_000, Selection.startPosition(SelectionReason.RESUME, null, stored(1_335_000)))
        assertEquals(1_335_000, Selection.startPosition(SelectionReason.EPISODE_PICK, null, stored(1_335_000)))
        assertEquals(0, Selection.startPosition(SelectionReason.NEXT_EPISODE, null, stored(1_335_000)))
        assertEquals(0, Selection.startPosition(SelectionReason.BROADCAST, null, stored(1_335_000)))
        assertEquals("a source switch keeps its known position", 90_000, Selection.startPosition(SelectionReason.PROVIDER_SWITCH, 90_000, stored(1_335_000)))
        assertEquals(0, Selection.startPosition(SelectionReason.RESUME, null, stored(2_000_000, completed = true)))
        assertEquals("a position at the very end restarts", 0, Selection.startPosition(SelectionReason.RESUME, null, stored(2_395_000)))
        assertEquals(0, Selection.startPosition(SelectionReason.RESUME, null, null))
    }

    @Test
    fun `the selection's episode is canonical`() {
        assertEquals(EpisodeKey(1, 7), Selection.canonicalEpisode(EpisodeKey(1, 7), null))
        assertEquals(EpisodeKey(1, 7), Selection.canonicalEpisode(EpisodeKey(1, 7), EpisodeKey(1, 3)))
        // Nothing canonical yet: the stream's own episode is accepted.
        assertEquals(EpisodeKey(1, 3), Selection.canonicalEpisode(null, EpisodeKey(1, 3)))
    }

    private fun season(n: Int, count: Int) = SeasonInfo(n, (1..count).map { EpisodeInfo(EpisodeKey(n, it)) })

    @Test
    fun `next episode crosses seasons but season 0 never leads into season 1`() {
        val seasons = listOf(season(0, 2), season(1, 3), season(2, 2))
        assertEquals(EpisodeKey(1, 3), Selection.nextEpisode(seasons, EpisodeKey(1, 2))?.key)
        assertEquals(EpisodeKey(2, 1), Selection.nextEpisode(seasons, EpisodeKey(1, 3))?.key)
        assertNull(Selection.nextEpisode(seasons, EpisodeKey(2, 2)))
        assertEquals(EpisodeKey(0, 2), Selection.nextEpisode(seasons, EpisodeKey(0, 1))?.key)
        assertNull(Selection.nextEpisode(seasons, EpisodeKey(0, 2)))
        val guess = Selection.nextEpisode(emptyList(), EpisodeKey(3, 4))!!
        assertEquals(EpisodeKey(3, 5), guess.key)
        assertFalse(guess.known)
        assertEquals(EpisodeKey(1, 1), Selection.firstEpisode(seasons))
    }

    @Test
    fun `picker waits for better providers and follows preference`() {
        val picker = SourcePicker(preferred = null, stored = ProviderId.ANIMEGO, episode = EpisodeKey(1, 1))
        picker.onEvent(SourceEvent.Found(SourceOption(ProviderId.SEASONVAR, handle = "a")))
        assertNull("the stored provider has not answered yet", picker.next(emptyList()))
        picker.onEvent(SourceEvent.Failed(ProviderId.ANIMEGO, app.seans.tv.model.SeansError(app.seans.tv.model.SeansError.Code.NETWORK)))
        assertEquals(ProviderId.SEASONVAR, picker.next(emptyList())?.providerId)

        val pref = SourcePicker(preferred = ProviderId.COLLAPS, stored = null, episode = null)
        pref.onEvent(SourceEvent.Found(SourceOption(ProviderId.SEASONVAR, handle = "s")))
        pref.onEvent(SourceEvent.Found(SourceOption(ProviderId.COLLAPS, handle = "c")))
        assertEquals(ProviderId.COLLAPS, pref.next(emptyList())?.providerId)
        assertEquals("no better provider is still out", ProviderId.SEASONVAR, pref.next(listOf(pref.options.first()))?.providerId)
        assertEquals(ProviderId.SEASONVAR, pref.next(listOf(pref.options.first()), force = true)?.providerId)
    }

    @Test
    fun `web options, missing episodes and Rutube for series are never played`() {
        val picker = SourcePicker(null, null, EpisodeKey(2, 5))
        assertFalse(picker.isPlayable(SourceOption(ProviderId.COLLAPS, SourceKind.WEB, "w")))
        assertFalse(picker.isPlayable(SourceOption(ProviderId.RUTUBE, handle = "r")))
        assertFalse(picker.isPlayable(SourceOption(ProviderId.SEASONVAR, handle = "s", unavailableReason = "Этой серии нет")))
        assertFalse(picker.isPlayable(SourceOption(ProviderId.SEASONVAR, handle = "s", seasons = listOf(season(1, 7)))))
        assertTrue(picker.isPlayable(SourceOption(ProviderId.SEASONVAR, handle = "s", seasons = listOf(season(2, 7)))))
        picker.onEvent(SourceEvent.Done)
        assertTrue(picker.exhausted(emptyList()))
    }

    @Test
    fun `voice follows preference, then storage, then the first`() {
        val opt = SourceOption(ProviderId.SEASONVAR, handle = "s", voices = listOf(VoiceOption("lf", "LostFilm"), VoiceOption("kb", "Кубик")))
        assertEquals("kb", SourcePicker.voiceFor(opt, "kb", "lf"))
        assertEquals("lf", SourcePicker.voiceFor(opt, "zz", "lf"))
        assertEquals("lf", SourcePicker.voiceFor(opt, null, null))
    }

    @Test
    fun `kodik ladder starts at the best quality the panel shows`() {
        val stream = PlayableStream(
            url = "u720", format = StreamFormat.HLS, providerId = ProviderId.ANIMEGO,
            alternatives = listOf(QualityOption(480, "480p") to "u480", QualityOption(2160, "2160p") to "u2160"),
        )
        val ladder = QualityLadder.of(stream, "720p")
        assertEquals(listOf("2160p", "720p", "480p"), ladder.map { it.option.label })
        assertEquals(1, QualityLadder.startIndex(ladder))
        assertTrue(QualityLadder.of(stream.copy(alternatives = emptyList()), "720p").isEmpty())
    }

    @Test
    fun `stall watch reports two long stalls in two minutes or a slow start`() {
        var now = 0L
        val watch = StallWatch { now }
        watch.onLoad()
        now += 12_000
        assertTrue("a start over 12 s", watch.check())

        watch.onLoad()
        watch.onPlaying()
        watch.onBuffering(); now += 2_600
        assertFalse(watch.check())
        watch.onPlaying(); now += 30_000
        watch.onBuffering(); now += 1_000
        assertFalse("a short stall does not count yet", watch.check())
        watch.onPauseOrSeek(); now += 5_000
        assertFalse("waiting after a seek is not a stall", watch.check())
        watch.onPlaying(); watch.onBuffering(); now += 2_500
        assertTrue(watch.check())
    }
}
