package app.seans.tv.player

import app.seans.tv.model.EpisodeInfo
import app.seans.tv.model.EpisodeKey
import app.seans.tv.model.MediaType
import app.seans.tv.model.PlayableStream
import app.seans.tv.model.PlaybackPosition
import app.seans.tv.model.PlaybackRequest
import app.seans.tv.model.ProviderId
import app.seans.tv.model.SeansError
import app.seans.tv.model.SeasonInfo
import app.seans.tv.model.SelectionReason
import app.seans.tv.model.SourceEvent
import app.seans.tv.model.SourceOption
import app.seans.tv.model.TitleRef
import app.seans.tv.model.TitleSummary
import app.seans.tv.player.engine.EngineError
import app.seans.tv.player.progress.ProgressWriter
import app.seans.tv.player.session.Phase
import app.seans.tv.player.session.PlayerSession
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.advanceTimeBy
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Session behaviour on a fake engine, including the ports of
 * `tests/playbackSwitchPendingProgress.test.cjs`.
 */
class PlayerSessionTest {
    private val seriesRef = TitleRef(101, MediaType.SERIES)
    private val seasons = listOf(SeasonInfo(2, (1..6).map { EpisodeInfo(EpisodeKey(2, it), "Ep $it") }))

    private fun seasonvar() = SourceOption(ProviderId.SEASONVAR, handle = "sv", seasons = seasons)
    private fun collaps() = SourceOption(ProviderId.COLLAPS, handle = "cl", seasons = seasons)
    private fun kodik() = SourceOption(ProviderId.ANIMEGO, handle = "kd", seasons = seasons)

    private class Rig(
        scope: TestScope,
        val request: PlaybackRequest,
        val resolver: FakeResolver,
        val progress: FakeProgress = FakeProgress(),
    ) {
        val engine = FakeEngine()
        val session = PlayerSession(
            request = request,
            sources = resolver,
            progress = progress,
            catalog = null,
            engine = engine,
            scope = scope.backgroundScope,
            writer = ProgressWriter(scope.backgroundScope, { scope.testScheduler.currentTime }) { progress.save(it) },
            elapsed = { scope.testScheduler.currentTime },
        )
    }

    private fun seriesRequest(ep: EpisodeKey = EpisodeKey(2, 4), reason: SelectionReason = SelectionReason.RESUME, preferred: ProviderId? = null) =
        PlaybackRequest(TitleSummary(seriesRef, "Outgoing"), ep, reason, preferredProvider = preferred)

    private fun events(vararg options: SourceOption) = options.map { SourceEvent.Found(it) } + SourceEvent.Done

    @Test
    fun `resume starts at the stored position with the stored provider`() = runTest {
        val stored = PlaybackPosition(seriesRef, EpisodeKey(2, 4), 187_000, 1_200_000, 5, providerKey = "kodik")
        val rig = Rig(this, seriesRequest(), FakeResolver(events(seasonvar(), kodik())), FakeProgress(listOf(stored)))
        rig.session.onStart()
        runCurrent()
        val load = rig.engine.loads.single()
        assertEquals(ProviderId.ANIMEGO, load.providerId)
        assertEquals(187_000, load.startMs)
        assertEquals(EpisodeKey(2, 4), load.episode)
    }

    @Test
    fun `a pending progress write does not block a source switch, and captures the outgoing identity`() = runTest {
        val stored = PlaybackPosition(seriesRef, EpisodeKey(2, 4), 187_000, 1_200_000, 5, providerKey = "seasonvar")
        val rig = Rig(this, seriesRequest(), FakeResolver(events(seasonvar(), collaps())), FakeProgress(listOf(stored)))
        rig.session.onStart()
        runCurrent()
        rig.engine.ready(1_200_000)
        rig.progress.gate = CompletableDeferred()
        rig.session.selectSource(collaps())
        runCurrent()

        val write = rig.progress.saves.single()
        assertEquals(EpisodeKey(2, 4), write.episode)
        assertEquals(187_000, write.positionMs)
        assertEquals("seasonvar", write.providerKey)
        val load = rig.engine.loads.last()
        assertEquals("the new source mounts before storage settles", ProviderId.COLLAPS, load.providerId)
        assertEquals(187_000, load.startMs)
        rig.progress.gate!!.complete(Unit)
        runCurrent()
    }

    @Test
    fun `a delayed resolve never supersedes a newer switch, even with failing storage`() = runTest {
        val slow = CompletableDeferred<PlayableStream>()
        val resolver = FakeResolver(events(seasonvar(), collaps(), kodik()))
        resolver.resolveHook = { option, episode, voice ->
            if (option.providerId == ProviderId.COLLAPS) slow.await() else FakeResolver.stream(option.providerId, episode, voice)
        }
        val rig = Rig(this, seriesRequest(), resolver)
        rig.session.onStart()
        runCurrent()
        rig.engine.ready()
        rig.progress.gate = CompletableDeferred()
        rig.session.selectSource(collaps())
        runCurrent()
        rig.session.selectSource(kodik())
        runCurrent()
        slow.complete(FakeResolver.stream(ProviderId.COLLAPS, EpisodeKey(2, 4)))
        rig.progress.gate!!.completeExceptionally(IllegalStateException("Storage unavailable"))
        runCurrent()
        assertEquals(ProviderId.ANIMEGO, rig.engine.loads.last().providerId)
        assertTrue(rig.engine.loads.none { it.providerId == ProviderId.COLLAPS })
        assertEquals(ProviderId.ANIMEGO, rig.session.state.value.option?.providerId)
    }

    @Test
    fun `an episode change stores the old episode first and starts the new one at its own position`() = runTest {
        val rig = Rig(this, seriesRequest(EpisodeKey(2, 1), SelectionReason.EPISODE_PICK), FakeResolver(events(seasonvar())))
        rig.session.onStart()
        runCurrent()
        rig.engine.ready()
        rig.engine.positionMs = 133_000
        advanceTimeBy(1_100)
        rig.session.selectEpisode(EpisodeKey(2, 2))
        runCurrent()
        val save = rig.progress.saves.last()
        assertEquals(EpisodeKey(2, 1), save.episode)
        assertEquals(133_000, save.positionMs)
        val load = rig.engine.loads.last()
        assertEquals(EpisodeKey(2, 2), load.episode)
        assertEquals(0, load.startMs)
        rig.session.close()
        runCurrent()
        assertTrue(rig.progress.saves.none { it.episode == EpisodeKey(2, 2) && it.positionMs == 133_000L })
    }

    @Test
    fun `expired urls are resolved again twice, then the next source plays at the same position`() = runTest {
        val rig = Rig(this, seriesRequest(EpisodeKey(2, 1), SelectionReason.EPISODE_PICK), FakeResolver(events(seasonvar(), collaps())))
        rig.session.onStart()
        runCurrent()
        rig.engine.ready()
        rig.engine.positionMs = 600_000
        advanceTimeBy(1_100)
        repeat(2) {
            rig.engine.fail(EngineError(expired = true, httpCode = 403, code = "IO_BAD_HTTP_STATUS"))
            runCurrent()
            val load = rig.engine.loads.last()
            assertEquals(ProviderId.SEASONVAR, load.providerId)
            assertEquals(600_000, load.startMs)
            rig.engine.ready()
        }
        rig.engine.fail(EngineError(expired = true, httpCode = 410, code = "IO_BAD_HTTP_STATUS"))
        runCurrent()
        val load = rig.engine.loads.last()
        assertEquals(ProviderId.COLLAPS, load.providerId)
        assertEquals(600_000, load.startMs)
        assertEquals(4, rig.engine.loads.size)
        assertEquals("the retries bypass the resolver's cache", listOf(false, true, true, false), rig.resolver.freshFlags)
    }

    @Test
    fun `a stream without an episode from a provider with episodes is a source failure`() = runTest {
        val resolver = FakeResolver(events(seasonvar(), collaps()))
        resolver.resolveHook = { option, episode, voice ->
            // Seasonvar answers with a film-like stream that names no episode.
            if (option.providerId == ProviderId.SEASONVAR) FakeResolver.stream(option.providerId, null, voice)
            else FakeResolver.stream(option.providerId, episode, voice)
        }
        val rig = Rig(this, seriesRequest(EpisodeKey(2, 3), SelectionReason.EPISODE_PICK), resolver)
        rig.session.onStart()
        runCurrent()
        val load = rig.engine.loads.single()
        assertEquals(ProviderId.COLLAPS, load.providerId)
        assertEquals(EpisodeKey(2, 3), load.episode)
        rig.session.close()
    }

    @Test
    fun `a stream confirmed for another episode is a source failure, never played under this one`() = runTest {
        val resolver = FakeResolver(events(seasonvar(), collaps()))
        resolver.resolveHook = { option, episode, voice ->
            if (option.providerId == ProviderId.SEASONVAR) FakeResolver.stream(option.providerId, EpisodeKey(2, 5), voice)
            else FakeResolver.stream(option.providerId, episode, voice)
        }
        val rig = Rig(this, seriesRequest(EpisodeKey(2, 4), SelectionReason.EPISODE_PICK), resolver)
        rig.session.onStart()
        runCurrent()
        val load = rig.engine.loads.single()
        assertEquals(ProviderId.COLLAPS, load.providerId)
        assertEquals(EpisodeKey(2, 4), load.episode)
        rig.session.close()
    }

    @Test
    fun `a failure after playback started offers the next source instead of switching`() = runTest {
        val rig = Rig(this, seriesRequest(EpisodeKey(2, 1), SelectionReason.EPISODE_PICK), FakeResolver(events(seasonvar(), collaps())))
        rig.session.onStart()
        runCurrent()
        rig.engine.ready()
        rig.engine.positionMs = 300_000
        advanceTimeBy(1_100)
        rig.engine.fail(EngineError(expired = false, code = "DECODING_FAILED"))
        runCurrent()
        val phase = rig.session.state.value.phase as Phase.Failed
        assertEquals(ProviderId.COLLAPS, phase.offer?.providerId)
        assertEquals(1, rig.engine.loads.size)
        rig.session.tryOffered()
        runCurrent()
        assertEquals(ProviderId.COLLAPS, rig.engine.loads.last().providerId)
        assertEquals(300_000, rig.engine.loads.last().startMs)
    }

    @Test
    fun `a found source waits only a short grace for a better provider that never answers`() = runTest {
        val film = PlaybackRequest(TitleSummary(TitleRef(301, MediaType.MOVIE), "Film"), null, SelectionReason.RESUME)
        val resolver = FakeResolver(listOf(SourceEvent.Found(SourceOption(ProviderId.COLLAPS, handle = "cl"))))
        resolver.hang = true // Seasonvar (ranked higher) never answers for a film.
        val rig = Rig(this, film, resolver)
        rig.session.onStart()
        advanceTimeBy(2_500)
        assertTrue(rig.engine.loads.isEmpty())
        advanceTimeBy(1_000)
        assertEquals(ProviderId.COLLAPS, rig.engine.loads.single().providerId)
        rig.session.close()
    }

    @Test
    fun `the grace never passes over the viewer's explicit choice`() = runTest {
        val film = PlaybackRequest(
            TitleSummary(TitleRef(301, MediaType.MOVIE), "Film"), null, SelectionReason.RESUME,
            preferredProvider = ProviderId.ANIMEGO,
        )
        val resolver = FakeResolver(emptyList())
        resolver.timed = listOf(
            1_000L to SourceEvent.Found(SourceOption(ProviderId.SEASONVAR, handle = "sv")),
            6_000L to SourceEvent.Found(SourceOption(ProviderId.ANIMEGO, handle = "kd")),
            6_000L to SourceEvent.Done,
        )
        val rig = Rig(this, film, resolver)
        rig.session.onStart()
        advanceTimeBy(5_000)
        assertTrue("nothing plays while the chosen source is still out", rig.engine.loads.isEmpty())
        advanceTimeBy(1_500)
        assertEquals(ProviderId.ANIMEGO, rig.engine.loads.single().providerId)
        rig.session.close()
    }

    @Test
    fun `no provider means a no-source state, not a spinner`() = runTest {
        val rig = Rig(this, seriesRequest(), FakeResolver(listOf(SourceEvent.Failed(ProviderId.SEASONVAR, SeansError(SeansError.Code.NOT_FOUND)), SourceEvent.Done)))
        rig.session.onStart()
        runCurrent()
        assertEquals(Phase.NoSource, rig.session.state.value.phase)
        assertTrue(rig.engine.loads.isEmpty())
    }

    @Test
    fun `a failing first source falls through to the next one automatically`() = runTest {
        val resolver = FakeResolver(events(seasonvar(), collaps()))
        resolver.resolveHook = { option, episode, voice ->
            if (option.providerId == ProviderId.SEASONVAR) throw SeansError(SeansError.Code.PROVIDER_BLOCKED)
            FakeResolver.stream(option.providerId, episode, voice)
        }
        val rig = Rig(this, seriesRequest(), resolver)
        rig.session.onStart()
        runCurrent()
        assertEquals(ProviderId.COLLAPS, rig.engine.loads.single().providerId)
    }

    @Test
    fun `auto-next runs after a real end with a countdown, and any key cancels it`() = runTest {
        val rig = Rig(this, seriesRequest(EpisodeKey(2, 1), SelectionReason.EPISODE_PICK), FakeResolver(events(seasonvar())))
        rig.session.onStart()
        runCurrent()
        rig.engine.ready(1_200_000)
        rig.engine.end()
        runCurrent()
        assertEquals(10, rig.session.state.value.autoNextIn)
        rig.session.cancelAutoNext()
        advanceTimeBy(11_000)
        assertNull(rig.session.state.value.autoNextIn)
        assertEquals(1, rig.engine.loads.size)
        val ended = rig.progress.saves.last()
        assertTrue("a real end marks a reliable episode watched", ended.completed)

        rig.engine.end()
        runCurrent()
        advanceTimeBy(10_500)
        val load = rig.engine.loads.last()
        assertEquals(EpisodeKey(2, 2), load.episode)
        assertEquals(0, load.startMs)
    }

    @Test
    fun `collaps dash that fails to start falls back to its hls at the same position, voices switch as tracks`() = runTest {
        val voices = listOf(app.seans.tv.model.VoiceOption("v0", "LostFilm"), app.seans.tv.model.VoiceOption("v1", "Кубик"))
        val collapsOption = SourceOption(ProviderId.COLLAPS, handle = "cl", seasons = seasons, voices = voices)
        val resolver = FakeResolver(events(collapsOption))
        resolver.resolveHook = { option, episode, voice ->
            PlayableStream(
                url = "https://cdn.test/collaps/manifest.mpd?token=${voice}",
                format = app.seans.tv.model.StreamFormat.DASH,
                episode = episode,
                providerId = option.providerId,
                voiceId = voice,
                audioTrackIndex = voices.indexOfFirst { it.id == voice },
                fallback = app.seans.tv.model.StreamFallback("https://cdn.test/collaps/master.m3u8", app.seans.tv.model.StreamFormat.HLS),
            )
        }
        val rig = Rig(this, seriesRequest(EpisodeKey(2, 1), SelectionReason.EPISODE_PICK), resolver)
        rig.session.onStart()
        runCurrent()
        assertEquals(app.seans.tv.model.StreamFormat.DASH, rig.engine.loads.single().format)
        assertEquals(0, rig.engine.audioTracks.last())
        rig.engine.positionMs = 12_000
        rig.engine.fail(EngineError(expired = false, code = "ERROR_CODE_DECODER_INIT_FAILED"))
        runCurrent()
        val fallback = rig.engine.loads.last()
        assertEquals(app.seans.tv.model.StreamFormat.HLS, fallback.format)
        assertEquals("https://cdn.test/collaps/master.m3u8", fallback.url)
        assertEquals(12_000, fallback.startMs)

        rig.engine.ready()
        rig.session.selectVoice("v1")
        runCurrent()
        assertEquals("a voice of the same manifest is a track switch, not a reload", 2, rig.engine.loads.size)
        assertEquals(1, rig.engine.audioTracks.last())
        assertEquals("v1", rig.session.state.value.voiceId)
    }

    @Test
    fun `stopping the app flushes and cancels auto-next, starting again resolves anew paused`() = runTest {
        val rig = Rig(this, seriesRequest(EpisodeKey(2, 1), SelectionReason.EPISODE_PICK), FakeResolver(events(seasonvar())))
        rig.session.onStart()
        runCurrent()
        rig.engine.ready()
        rig.engine.positionMs = 420_000
        advanceTimeBy(1_100)
        rig.session.onStop()
        runCurrent()
        assertEquals(420_000, rig.progress.saves.last().positionMs)
        rig.session.onStart()
        runCurrent()
        val load = rig.engine.loads.last()
        assertEquals(2, rig.resolver.resolves.size)
        assertEquals(420_000, load.startMs)
        assertEquals(false, load.playWhenReady)
    }
}
