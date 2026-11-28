package app.seans.tv.network

import java.io.File
import java.io.IOException
import java.net.InetAddress
import java.util.concurrent.TimeUnit
import okhttp3.Cache
import okhttp3.Dns
import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.Interceptor
import okhttp3.OkHttpClient
import okhttp3.dnsoverhttps.DnsOverHttps

/**
 * The one HTTP stack of the app.
 *
 * - Names resolve over DNS-over-HTTPS (Cloudflare, then Google), the system resolver last: the
 *   owner's router cannot resolve `seasonvar.ru` or `hdrezka.co`, and anything on the system
 *   resolver (Media3's `DefaultHttpDataSource`, `HttpURLConnection`, Coil's default fetcher)
 *   fails for them. Never use those; use [client] or [mediaClient].
 * - [client] has a small HTTP cache for API and page requests. [mediaClient] has none: video
 *   segments and images must not evict API entries or write video to flash (Coil keeps its own
 *   disk cache). Use `OkHttpDataSource.Factory(mediaClient)` and Coil's OkHttp fetcher on it.
 * - Hosts of the linkpp aggregator network are refused before any byte leaves the TV: one
 *   non-browser request blocks the owner's IP for about 30 minutes. An interceptor refuses
 *   the first request; [dns] refuses every redirect hop, which interceptors do not see.
 */
class SeansHttp(cacheDir: File) {
    private val base = OkHttpClient.Builder()
        .connectTimeout(10, TimeUnit.SECONDS)
        .readTimeout(20, TimeUnit.SECONDS)
        .addInterceptor(DenylistInterceptor)
        .build()

    /** DoH queries give up after [DOH_CALL_TIMEOUT_MS], so a hung DoH server hands over to the next resolver quickly. */
    internal val doh: OkHttpClient = base.newBuilder()
        .callTimeout(DOH_CALL_TIMEOUT_MS, TimeUnit.MILLISECONDS)
        .build()

    private val cloudflare = DnsOverHttps.Builder()
        .client(doh)
        .url("https://cloudflare-dns.com/dns-query".toHttpUrl())
        .bootstrapDnsHosts(InetAddress.getByName("1.1.1.1"), InetAddress.getByName("1.0.0.1"))
        .build()

    private val google = DnsOverHttps.Builder()
        .client(doh)
        .url("https://dns.google/dns-query".toHttpUrl())
        .bootstrapDnsHosts(InetAddress.getByName("8.8.8.8"), InetAddress.getByName("8.8.4.4"))
        .build()

    /**
     * Cloudflare DoH, then Google DoH, then the system resolver (needed for `localhost` and
     * the LAN), with a short answer cache. OkHttp never calls Dns for IP literals.
     */
    val dns: Dns = FallbackDns(listOf(cloudflare, google, Dns.SYSTEM), refuse = ::isDenied)

    private val userAgent = Interceptor { chain ->
        val request = chain.request()
        if (request.header("User-Agent") != null) chain.proceed(request)
        else chain.proceed(request.newBuilder().header("User-Agent", USER_AGENT).build())
    }

    /** API, proxy and provider page requests. */
    val client: OkHttpClient = base.newBuilder()
        .dns(dns)
        .cache(Cache(File(cacheDir, "http"), 10L * 1024 * 1024))
        .addInterceptor(userAgent)
        .build()

    /** Media segments and images: same DNS, UA and denylist, no HTTP cache. */
    val mediaClient: OkHttpClient = client.newBuilder().cache(null).build()

    companion object {
        /** A desktop Chrome UA: several providers answer differently to anything else, and some CDNs bind tokens to it. */
        const val USER_AGENT =
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36"

        internal const val DOH_CALL_TIMEOUT_MS = 4_000L

        /** Substrings of hosts the app must never contact (see `android-tv/AGENTS.md`, hard rules). */
        val DENIED_HOST_PARTS = listOf("linkpp", "kinopoisk.cx", "troutcdn")

        fun isDenied(host: String): Boolean = DENIED_HOST_PARTS.any { host.lowercase().contains(it) }

        /** Body-free check for a whole URL: a malformed one is refused too. */
        fun isDeniedUrl(url: String): Boolean =
            runCatching { url.toHttpUrl().host }.map(::isDenied).getOrDefault(true)
    }

    private object DenylistInterceptor : Interceptor {
        override fun intercept(chain: Interceptor.Chain): okhttp3.Response {
            val host = chain.request().url.host
            if (isDenied(host)) throw IOException("Refused: $host is on the aggregator denylist")
            return chain.proceed(chain.request())
        }
    }
}
