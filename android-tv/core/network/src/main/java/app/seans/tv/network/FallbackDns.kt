package app.seans.tv.network

import java.net.InetAddress
import java.net.UnknownHostException
import okhttp3.Dns

/**
 * Asks [resolvers] in order and returns the first non-empty answer; the last resolver's
 * error is thrown when all fail. Names for the LAN (`localhost`, `*.local`) skip straight to
 * [local]: public DoH servers cannot know them.
 *
 * Answers are kept for [ttlMillis] (at most [maxEntries] names): DoH costs a round trip, and
 * one stream opens many connections to the same CDN host. A failure is never cached.
 *
 * Names matching [refuse] fail before any resolver is asked. OkHttp resolves every hop of a
 * redirect chain, so this also stops a redirect into the aggregator network, which an
 * application interceptor never sees.
 */
internal class FallbackDns(
    private val resolvers: List<Dns>,
    private val refuse: (String) -> Boolean = { false },
    private val local: Dns = Dns.SYSTEM,
    private val ttlMillis: Long = 5 * 60 * 1000L,
    private val maxEntries: Int = 64,
    private val clock: () -> Long = System::currentTimeMillis,
) : Dns {
    init { require(resolvers.isNotEmpty()) { "at least one resolver" } }

    private class Entry(val addresses: List<InetAddress>, val at: Long)

    private val cache = object : LinkedHashMap<String, Entry>(16, 0.75f, true) {
        override fun removeEldestEntry(eldest: MutableMap.MutableEntry<String, Entry>?): Boolean = size > maxEntries
    }

    override fun lookup(hostname: String): List<InetAddress> {
        val host = hostname.lowercase()
        if (refuse(host)) throw UnknownHostException("Refused: $host is on the aggregator denylist")
        if (host == "localhost" || host.endsWith(".local")) return local.lookup(hostname)

        synchronized(cache) {
            val hit = cache[host]
            if (hit != null && clock() - hit.at < ttlMillis) return hit.addresses
        }

        var last: Exception? = null
        for (resolver in resolvers) {
            try {
                val answer = resolver.lookup(hostname)
                if (answer.isNotEmpty()) {
                    synchronized(cache) { cache[host] = Entry(answer, clock()) }
                    return answer
                }
                last = UnknownHostException("No addresses for $hostname")
            } catch (e: Exception) {
                last = e
            }
        }
        throw (last as? UnknownHostException) ?: UnknownHostException("Cannot resolve $hostname").apply { initCause(last) }
    }
}
