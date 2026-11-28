package app.seans.tv.sources

import app.seans.tv.model.EpisodeKey
import app.seans.tv.model.MediaType
import app.seans.tv.model.PlayableStream
import app.seans.tv.model.ProviderId
import app.seans.tv.model.SeansError
import app.seans.tv.model.SourceEvent
import app.seans.tv.model.SourceOption
import app.seans.tv.model.SourceQuery
import app.seans.tv.model.StreamFormat
import app.seans.tv.model.TitleRef
import app.seans.tv.sources.internal.Challenge
import app.seans.tv.sources.internal.HttpResult
import app.seans.tv.sources.internal.Provider
import app.seans.tv.sources.internal.requireUsable
import java.util.concurrent.atomic.AtomicInteger
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.async
import kotlinx.coroutines.flow.toList
import kotlinx.coroutines.job
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test

class ProviderResolverTest {
    private val query = SourceQuery(TitleRef(42, MediaType.MOVIE), "Фильм")

    private class Scripted(
        override val id: ProviderId,
        private val accept: Boolean = true,
        private val answer: suspend (SourceQuery) -> SourceOption?,
    ) : Provider {
        val calls = AtomicInteger()
        override fun accepts(query: SourceQuery) = accept
        override fun cacheKey(query: SourceQuery) = "kp${query.ref.kinopoiskId}"
        override suspend fun find(query: SourceQuery): SourceOption? { calls.incrementAndGet(); return answer(query) }
        var lastFresh: Boolean? = null
        override suspend fun resolve(option: SourceOption, episode: EpisodeKey?, voiceId: String?, fresh: Boolean): PlayableStream {
            lastFresh = fresh
            return PlayableStream(url = "https://cdn.example/${option.handle}.m3u8", format = StreamFormat.HLS, providerId = id)
        }
    }

    private fun option(id: ProviderId) = SourceOption(providerId = id, handle = id.key)

    /** Like the module's own scope: a failed lookup stays in its Deferred instead of failing the scope. */
    private fun TestScope.lookups() = CoroutineScope(backgroundScope.coroutineContext + SupervisorJob(backgroundScope.coroutineContext.job))

    private fun TestScope.resolver(vararg providers: Provider) =
        ProviderResolver(providers.toList(), log = {}, scope = lookups(), clock = { testScheduler.currentTime })

    @Test
    fun `answers arrive as they come and Done is last`() = runTest {
        val slow = CompletableDeferred<SourceOption?>()
        val a = Scripted(ProviderId.SEASONVAR) { slow.await() }
        val b = Scripted(ProviderId.COLLAPS) { option(ProviderId.COLLAPS) }
        val c = Scripted(ProviderId.RUTUBE) { throw SeansError(SeansError.Code.PROVIDER_BLOCKED) }
        val skipped = Scripted(ProviderId.ANIMEGO, accept = false) { fail("not accepted"); null }
        val events = async { resolver(a, b, c, skipped).find(query).toList() }
        testScheduler.runCurrent() // advanceUntilIdle would skip the background lookups
        assertFalse("Done waits for every provider", events.isCompleted)
        slow.complete(option(ProviderId.SEASONVAR))
        val list = events.await()
        assertEquals(SourceEvent.Done, list.last())
        assertEquals(5, list.size)
        assertEquals("the skipped provider answers first", SourceEvent.Failed::class, list.first()::class)
        assertTrue(list.toString(), list.indexOfFirst { it is SourceEvent.Found && it.option.providerId == ProviderId.COLLAPS } <
            list.indexOfFirst { it is SourceEvent.Found && it.option.providerId == ProviderId.SEASONVAR })
        val failures = list.filterIsInstance<SourceEvent.Failed>().associate { it.providerId to it.error.code }
        assertEquals(mapOf(ProviderId.RUTUBE to SeansError.Code.PROVIDER_BLOCKED, ProviderId.ANIMEGO to SeansError.Code.UNSUPPORTED), failures)
        assertEquals(0, skipped.calls.get())
    }

    private fun idsOf(events: List<SourceEvent>) = events.mapNotNull {
        when (it) {
            is SourceEvent.Found -> it.option.providerId
            is SourceEvent.Failed -> it.providerId
            SourceEvent.Done -> null
        }
    }

    /** Never answers: whatever arrives before cancelling did not wait for the network. */
    private class SilentFetcher : app.seans.tv.sources.internal.Fetcher {
        override suspend fun get(url: String, headers: Map<String, String>): HttpResult = kotlinx.coroutines.awaitCancellation()
        override suspend fun postForm(url: String, form: List<Pair<String, String>>, headers: Map<String, String>): HttpResult =
            kotlinx.coroutines.awaitCancellation()
    }

    @Test
    fun `a film query hears from Seasonvar and AnimeGo at once, before any network answer`() = runTest {
        val resolver = ProviderResolver(SourcesModule.defaultProviders(SilentFetcher()), log = {}, scope = lookups())
        val received = mutableListOf<SourceEvent>()
        val collecting = launch { resolver.find(query).collect { received += it } }
        testScheduler.runCurrent()
        val early = received.filterIsInstance<SourceEvent.Failed>().associate { it.providerId to it.error.code }
        assertEquals(mapOf(ProviderId.SEASONVAR to SeansError.Code.UNSUPPORTED, ProviderId.ANIMEGO to SeansError.Code.UNSUPPORTED), early)
        assertFalse("Collaps and Rutube are still asking", received.contains(SourceEvent.Done))
        collecting.cancel()
    }

    @Test
    fun `every ProviderId answers exactly once before Done`() = runTest {
        val all = SourcesModule.defaultProviders(FakeFetcher())
        for (q in listOf(query, query.copy(ref = TitleRef(42, MediaType.SERIES), isAnime = true), query.copy(isAnime = true))) {
            val events = ProviderResolver(all, log = {}, scope = lookups()).find(q).toList()
            assertEquals(SourceEvent.Done, events.last())
            assertEquals(ProviderId.entries.sorted(), idsOf(events).sorted())
        }
        val one = ProviderResolver(listOf(Scripted(ProviderId.COLLAPS) { null }), log = {}, scope = lookups()).find(query).toList()
        assertEquals("ids the module has no provider for answer too", ProviderId.entries.sorted(), idsOf(one).sorted())
    }

    @Test
    fun `offers are cached, misses and errors are not`() = runTest {
        var fail = true
        val found = Scripted(ProviderId.COLLAPS) { option(ProviderId.COLLAPS) }
        val missing = Scripted(ProviderId.RUTUBE) { null }
        val flaky = Scripted(ProviderId.SEASONVAR) { if (fail) throw IllegalStateException("markup") else option(ProviderId.SEASONVAR) }
        val resolver = resolver(found, missing, flaky)
        val first = resolver.find(query).toList()
        assertEquals(SeansError.Code.PROVIDER_CHANGED, first.filterIsInstance<SourceEvent.Failed>().single { it.providerId == ProviderId.SEASONVAR }.error.code)
        fail = false
        resolver.find(query).toList()
        resolver.find(query).toList()
        assertEquals(1, found.calls.get())
        assertEquals("a «no such title» is asked again", 3, missing.calls.get())
        assertEquals("an error is asked again, then the success is kept", 2, flaky.calls.get())

        testScheduler.advanceTimeBy(30 * 60 * 1000L + 1)
        resolver.find(query).toList()
        assertEquals("expired", 2, found.calls.get())
    }

    @Test
    fun `parallel finds for one query share one lookup`() = runTest {
        val gate = CompletableDeferred<Unit>()
        val provider = Scripted(ProviderId.COLLAPS) { gate.await(); option(ProviderId.COLLAPS) }
        val resolver = resolver(provider)
        val one = async { resolver.find(query).toList() }
        val two = async { resolver.find(query).toList() }
        testScheduler.runCurrent() // advanceUntilIdle would skip the background lookups
        gate.complete(Unit)
        fun shape(events: List<SourceEvent>) = events.map {
            when (it) {
                is SourceEvent.Found -> "found ${it.option}"
                is SourceEvent.Failed -> "failed ${it.providerId} ${it.error.code}"
                SourceEvent.Done -> "done"
            }
        }
        assertEquals(shape(one.await()), shape(two.await()))
        assertEquals(1, provider.calls.get())
    }

    @Test
    fun `a hung provider times out`() = runTest {
        val hung = Scripted(ProviderId.COLLAPS) { CompletableDeferred<SourceOption?>().await() }
        val resolver = ProviderResolver(listOf(hung), timeoutMillis = 1_000, log = {}, scope = lookups())
        val events = resolver.find(query).toList()
        val collaps = events.filterIsInstance<SourceEvent.Failed>().single { it.providerId == ProviderId.COLLAPS }
        assertEquals(SeansError.Code.TIMEOUT, collaps.error.code)
    }

    @Test
    fun `resolve goes to the option's provider`() = runTest {
        val collaps = Scripted(ProviderId.COLLAPS) { null }
        val resolver = resolver(collaps)
        assertEquals("https://cdn.example/collaps.m3u8", resolver.resolve(option(ProviderId.COLLAPS), null, null).url)
        assertEquals(false, collaps.lastFresh)
        resolver.resolve(option(ProviderId.COLLAPS), null, null, fresh = true)
        assertEquals("fresh reaches the provider", true, collaps.lastFresh)
        try {
            resolver.resolve(option(ProviderId.RUTUBE), null, null)
            fail()
        } catch (e: SeansError) {
            assertEquals(SeansError.Code.UNSUPPORTED, e.code)
        }
    }

    @Test
    fun `challenge pages and statuses map to SeansError codes`() {
        fun code(result: HttpResult) = try { result.requireUsable("x"); null } catch (e: SeansError) { e.code }
        assertEquals(SeansError.Code.PROVIDER_BLOCKED, code(HttpResult(200, "<html><head><title>DDoS-Guard</title></head></html>", "")))
        assertEquals(SeansError.Code.PROVIDER_BLOCKED, code(HttpResult(403, "Forbidden", "")))
        assertEquals(SeansError.Code.PROVIDER_BLOCKED, code(HttpResult(429, "", "")))
        assertEquals(SeansError.Code.NETWORK, code(HttpResult(502, "", "")))
        assertEquals(SeansError.Code.PROVIDER_CHANGED, code(HttpResult(400, "", "")))
        assertEquals(null, code(HttpResult(404, "", "")))
        assertEquals(null, HttpResult(410, "", "").requireUsable("x"))
        assertFalse("a real AnimeGo page behind DDoS-Guard is not a challenge", Challenge.isChallenge(HttpResult(200, fixture("animego/search.html"), "", server = "ddos-guard")))
    }

    @Test
    fun `the default module has the four v1 providers`() {
        val ids = SourcesModule.defaultProviders(FakeFetcher()).map { it.id }
        assertEquals(listOf(ProviderId.SEASONVAR, ProviderId.COLLAPS, ProviderId.ANIMEGO, ProviderId.RUTUBE), ids)
    }
}
