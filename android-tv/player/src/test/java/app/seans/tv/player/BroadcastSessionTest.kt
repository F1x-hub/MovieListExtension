package app.seans.tv.player

import app.seans.tv.model.BroadcastLock
import app.seans.tv.model.EpisodeKey
import app.seans.tv.model.MediaType
import app.seans.tv.model.PlaybackRequest
import app.seans.tv.model.ProviderId
import app.seans.tv.model.SelectionReason
import app.seans.tv.model.ServerClock
import app.seans.tv.model.SourceEvent
import app.seans.tv.model.TitleRef
import app.seans.tv.model.TitleSummary
import app.seans.tv.model.VoiceOption
import app.seans.tv.player.broadcast.BroadcastPrefs
import app.seans.tv.player.broadcast.BroadcastSession
import app.seans.tv.player.engine.EngineError
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.advanceTimeBy
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class BroadcastSessionTest {
    private val ref = TitleRef(77044, MediaType.SERIES)
    private val ep = EpisodeKey(1, 2)

    private class Rig(scope: TestScope, val resolver: FakeResolver, episode: EpisodeKey?, anchor: Long = 0L) {
        var serverNow = 1_000_000L
        val engine = FakeEngine()
        val states = mutableListOf<BroadcastPlaybackState>()
        val lock = MutableStateFlow(BroadcastLock(anchorServerMs = anchor))
        val session = BroadcastSession(
            request = PlaybackRequest(TitleSummary(TitleRef(77044, MediaType.SERIES), "Друзья"), episode, SelectionReason.BROADCAST),
            lock = lock,
            clock = ServerClock { serverNow },
            sources = resolver,
            engine = engine,
            scope = scope.backgroundScope,
            prefs = BroadcastPrefs(),
            onState = { states += it },
            elapsed = { scope.testScheduler.currentTime },
        )
    }

    @Test
    fun `plays the scheduled episode at the channel position and corrects drift only past 3 s`() = runTest {
        val rig = Rig(this, FakeResolver(listOf(SourceEvent.Found(option(ProviderId.SEASONVAR)), SourceEvent.Done)), ep, anchor = 400_000)
        rig.session.start()
        runCurrent()
        val load = rig.engine.loads.single()
        assertEquals(ep, load.episode)
        assertEquals(600_000, load.startMs)
        assertTrue(load.playWhenReady)
        rig.engine.ready()
        assertEquals(BroadcastPlaybackState.Playing(ProviderId.SEASONVAR), rig.states.last())

        // 2 s behind: tolerated.
        rig.serverNow += 1_000
        rig.engine.positionMs = 599_000
        advanceTimeBy(1_100)
        assertTrue(rig.engine.seeks.isEmpty())
        // 4 s behind: pulled to the channel.
        rig.engine.positionMs = 597_000
        rig.serverNow += 0
        advanceTimeBy(1_000)
        assertEquals(601_000, rig.engine.seeks.single())
        rig.session.stop()
    }

    @Test
    fun `follows the admin pause with a 1 s tolerance and resumes with the channel`() = runTest {
        val rig = Rig(this, FakeResolver(listOf(SourceEvent.Found(option(ProviderId.SEASONVAR)), SourceEvent.Done)), ep, anchor = 400_000)
        rig.session.start()
        runCurrent()
        rig.engine.ready()
        rig.engine.positionMs = 600_000
        rig.lock.value = BroadcastLock(anchorServerMs = 400_000, pausedAtMs = 601_500)
        runCurrent()
        assertFalse(rig.engine.playWhenReady)
        assertEquals(601_500, rig.engine.seeks.last())
        rig.lock.value = BroadcastLock(anchorServerMs = 398_500)
        runCurrent()
        assertTrue(rig.engine.playWhenReady)
        rig.session.stop()
    }

    @Test
    fun `a file that ends before the slot reports Ended, and an admin seek back plays again`() = runTest {
        val rig = Rig(this, FakeResolver(listOf(SourceEvent.Found(option(ProviderId.SEASONVAR)), SourceEvent.Done)), ep, anchor = 0)
        rig.lock.value = BroadcastLock(anchorServerMs = 0, endsAtServerMs = 5_000_000)
        rig.session.start()
        runCurrent()
        rig.engine.ready(durationMs = 1_200_000)
        rig.engine.end()
        assertEquals(BroadcastPlaybackState.Ended(1_200_000), rig.states.last())
        rig.lock.value = BroadcastLock(anchorServerMs = rig.serverNow - 600_000, endsAtServerMs = 5_000_000)
        runCurrent()
        assertEquals(600_000, rig.engine.seeks.last())
        rig.engine.ready(durationMs = 1_200_000)
        assertEquals(BroadcastPlaybackState.Playing(ProviderId.SEASONVAR), rig.states.last())
        rig.session.stop()
    }

    @Test
    fun `after a permanent audio focus loss the broadcast never takes focus back`() = runTest {
        val rig = Rig(this, FakeResolver(listOf(SourceEvent.Found(option(ProviderId.SEASONVAR)), SourceEvent.Done)), ep, anchor = 0)
        rig.session.start()
        runCurrent()
        rig.engine.ready()
        val before = rig.engine.playCalls
        rig.engine.loseFocus()
        advanceTimeBy(5_000)
        assertEquals("no play() while another app holds focus", before, rig.engine.playCalls)
        assertFalse(rig.engine.playWhenReady)
        rig.session.stop()
    }

    @Test
    fun `a stream that does not confirm the scheduled episode is refused`() = runTest {
        val resolver = FakeResolver(listOf(SourceEvent.Found(option(ProviderId.SEASONVAR)), SourceEvent.Found(option(ProviderId.COLLAPS)), SourceEvent.Done))
        resolver.resolveHook = { option, _, voice -> FakeResolver.stream(option.providerId, EpisodeKey(1, 3), voice) }
        val rig = Rig(this, resolver, ep)
        rig.session.start()
        runCurrent()
        assertTrue(rig.engine.loads.isEmpty())
        assertEquals(BroadcastPlaybackState.NoSource, rig.states.last())
        rig.session.stop()
    }

    @Test
    fun `nothing found reports no source within the search timeout`() = runTest {
        val rig = Rig(this, FakeResolver(listOf(SourceEvent.Done)), ep)
        rig.session.start()
        runCurrent()
        assertEquals(BroadcastPlaybackState.NoSource, rig.states.last())
        rig.session.stop()
    }

    @Test
    fun `expired urls resolve again at the channel position, and voice is the viewer's`() = runTest {
        val voices = listOf(VoiceOption("lf", "LostFilm"), VoiceOption("kb", "Кубик"))
        val rig = Rig(this, FakeResolver(listOf(SourceEvent.Found(option(ProviderId.SEASONVAR, voices = voices)), SourceEvent.Done)), ep, anchor = 0)
        rig.session.start()
        runCurrent()
        rig.engine.ready()
        rig.serverNow += 5_000
        rig.engine.fail(EngineError(expired = true, httpCode = 403, code = "IO_BAD_HTTP_STATUS"))
        runCurrent()
        assertEquals(1_005_000, rig.engine.loads.last().startMs)
        assertEquals("the retry bypasses the resolver's cache", listOf(false, true), rig.resolver.freshFlags)
        rig.session.selectVoice("kb")
        runCurrent()
        assertEquals("kb", rig.resolver.resolves.last().third)
        rig.session.setMuted(true)
        assertTrue(rig.engine.mutedNow)
        rig.session.stop()
    }
}
