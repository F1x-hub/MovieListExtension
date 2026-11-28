package app.seans.tv.sources

import app.seans.tv.model.EpisodeKey
import app.seans.tv.model.PlayableStream
import app.seans.tv.model.ProviderId
import app.seans.tv.model.SeansError
import app.seans.tv.model.SourceEvent
import app.seans.tv.model.SourceOption
import app.seans.tv.model.SourceQuery
import app.seans.tv.model.SourceResolver
import app.seans.tv.network.SeansHttp
import app.seans.tv.sources.animego.AnimeGoProvider
import app.seans.tv.sources.collaps.BalancerDomains
import app.seans.tv.sources.collaps.CollapsProvider
import java.io.File
import app.seans.tv.sources.internal.Fetcher
import app.seans.tv.sources.internal.OkHttpFetcher
import app.seans.tv.sources.internal.Provider
import app.seans.tv.sources.internal.hostOf
import app.seans.tv.sources.internal.toSeansError
import app.seans.tv.sources.rutube.RutubeProvider
import app.seans.tv.sources.seasonvar.SeasonvarProvider
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Deferred
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.async
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.channelFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeoutOrNull

/**
 * Entry point of `:sources`: `SourcesModule(graph.http).resolver` is the app's [SourceResolver].
 *
 * v1 providers: Seasonvar (series), Collaps by Kinopoisk ID (films and series), AnimeGo/Kodik
 * (anime) and Rutube (films, position only). All are played natively; none needs a WebView.
 *
 * The constructor does no I/O.
 *
 * @param stateDir where small provider state survives a restart (today: the Collaps balancer's
 *   current domain, one line). Read lazily off the main thread on first use. Null keeps it in
 *   memory, so a cold start may pay one 422 + actualize.js after the balancer moves.
 */
class SourcesModule(http: SeansHttp, stateDir: File? = null) {
    val resolver: SourceResolver = ProviderResolver(defaultProviders(OkHttpFetcher(http.client), stateDir))

    internal companion object {
        fun defaultProviders(fetcher: Fetcher, stateDir: File? = null): List<Provider> = listOf(
            SeasonvarProvider(fetcher),
            CollapsProvider(fetcher, BalancerDomains(fetcher, stateDir?.let { File(it, "collaps-domain.txt") })),
            AnimeGoProvider(fetcher),
            RutubeProvider(fetcher),
        )
    }
}

/**
 * Asks every provider that [Provider.accepts] the query at once and emits each answer as it
 * arrives, then [SourceEvent.Done]. A provider without the title answers
 * [SourceEvent.Failed] with [SeansError.Code.NOT_FOUND].
 *
 * Offers are cached per provider and query for [ttlMillis]; a «no such title» or an error is
 * never cached, so the next call asks again. Two calls for the same query while the first is
 * still asking share one request.
 */
internal class ProviderResolver(
    private val providers: List<Provider>,
    private val ttlMillis: Long = 30 * 60 * 1000L,
    private val timeoutMillis: Long = 30_000L,
    private val maxEntries: Int = 48,
    private val clock: () -> Long = System::currentTimeMillis,
    private val log: (String) -> Unit = ::logInfo,
    /** Where shared lookups run; they outlive a cancelled collector so a second caller can still use them. */
    private val scope: CoroutineScope = CoroutineScope(SupervisorJob() + Dispatchers.IO),
) : SourceResolver {
    private class Entry(val option: SourceOption, val at: Long)

    private val cache = object : LinkedHashMap<String, Entry>(16, 0.75f, true) {
        override fun removeEldestEntry(eldest: MutableMap.MutableEntry<String, Entry>?) = size > maxEntries
    }
    private val inFlight = HashMap<String, Deferred<SourceOption?>>()

    override fun find(query: SourceQuery): Flow<SourceEvent> = channelFlow {
        // One line per provider and query: ids and outcomes only, never titles or URLs.
        val tag = "kp${query.ref.kinopoiskId} ${query.ref.mediaType} ${query.episode?.storageKey() ?: "-"} anime=${query.isAnime}"
        val (asked, skipped) = providers.partition { it.accepts(query) }
        skipped.forEach { log("${it.id.key}: skipped $tag") }
        // Every ProviderId answers exactly once before Done: a provider that cannot have this
        // title (or that this module does not have) says so at once, so nobody waits for it.
        val known = providers.map { it.id }.toSet()
        val unsupported = skipped.map { it.id } + ProviderId.entries.filter { it !in known }
        unsupported.distinct().forEach { send(SourceEvent.Failed(it, SeansError(SeansError.Code.UNSUPPORTED))) }
        val jobs = asked.map { provider ->
            launch {
                val started = clock()
                val event = try {
                    val option = lookup(provider, query)
                    if (option != null) {
                        log("${provider.id.key}: found $tag voices=${option.voices.size} seasons=${option.seasons.size}" +
                            (option.unavailableReason?.let { " unavailable" } ?: "") + " ${clock() - started} ms")
                        SourceEvent.Found(option)
                    } else {
                        log("${provider.id.key}: nothing $tag ${clock() - started} ms")
                        SourceEvent.Failed(provider.id, SeansError(SeansError.Code.NOT_FOUND))
                    }
                } catch (e: CancellationException) {
                    throw e
                } catch (e: Throwable) {
                    val error = e.toSeansError()
                    log("${provider.id.key}: error ${error.code} (${error.message}) $tag ${clock() - started} ms")
                    SourceEvent.Failed(provider.id, error)
                }
                send(event)
            }
        }
        jobs.forEach { it.join() }
        send(SourceEvent.Done)
    }

    /** [fresh] bypasses every provider cache (page, playlist, Kodik streams): a retry after `STREAM_EXPIRED`. */
    override suspend fun resolve(option: SourceOption, episode: EpisodeKey?, voiceId: String?, fresh: Boolean): PlayableStream {
        val provider = providers.firstOrNull { it.id == option.providerId }
            ?: throw SeansError(SeansError.Code.UNSUPPORTED, "No provider ${option.providerId.key}")
        return withContext(Dispatchers.IO) {
            try {
                val stream = withTimeoutOrNull(timeoutMillis) { provider.resolve(option, episode, voiceId, fresh) }
                    ?: throw SeansError(SeansError.Code.TIMEOUT, "${provider.id.key} resolve timed out")
                log("${provider.id.key}: resolved ${stream.format} on ${hostOf(stream.url)}")
                stream
            } catch (e: CancellationException) {
                throw e
            } catch (e: Throwable) {
                throw e.toSeansError()
            }
        }
    }

    /** Clears every cached offer (for a «Искать заново»). */
    fun clear() = synchronized(cache) { cache.clear() }

    private suspend fun lookup(provider: Provider, query: SourceQuery): SourceOption? {
        val key = "${provider.id.key}|${provider.cacheKey(query)}"
        val shared = synchronized(cache) {
            cache[key]?.takeIf { clock() - it.at < ttlMillis }?.let { return it.option }
            inFlight.getOrPut(key) {
                scope.async {
                    try {
                        val found = withTimeoutOrNull(timeoutMillis) { Answer(provider.find(query)) }
                            ?: throw SeansError(SeansError.Code.TIMEOUT, "${provider.id.key} find timed out")
                        found.option?.also { option ->
                            synchronized(cache) { cache[key] = Entry(option, clock()) }
                        }
                    } finally {
                        synchronized(cache) { inFlight.remove(key) }
                    }
                }
            }
        }
        return shared.await()
    }

    /** Tells «no such title» (null) apart from a timeout (no answer). */
    private class Answer(val option: SourceOption?)
}

private fun logInfo(message: String) {
    // android.util.Log is a stub in JVM unit tests; logging must never fail a lookup.
    runCatching { android.util.Log.i("SeansSources", message) }
}
