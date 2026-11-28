package app.seans.tv.sources.collaps

import app.seans.tv.sources.internal.Fetcher
import java.io.File
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext

/**
 * Where the Venom balancer behind Collaps lives today. It keeps moving to new domains; a
 * domain it has left answers every embed with HTTP 422. Its own script `actualize.js`
 * (read as text, never run) names the current one, as in the extension's `BalancerDomains`.
 *
 * The script is read only after a 422, at most once a minute. A learned domain is kept in
 * [file] (one line), read lazily on first use off the main thread, so a cold start does not
 * pay a 422 for a move it already knows about. Without a file the domain lives in memory.
 */
internal class BalancerDomains(
    private val fetcher: Fetcher,
    private val file: File? = null,
    private val defaultHost: String = DEFAULT_HOST,
    private val clock: () -> Long = System::currentTimeMillis,
) {
    private val mutex = Mutex()
    private var actualHost: String = defaultHost
    private var loaded = file == null
    private var lastForcedAt = Long.MIN_VALUE / 2

    /** The domain to ask now. */
    suspend fun host(): String = mutex.withLock {
        ensureLoaded()
        actualHost
    }

    /**
     * Reads actualize.js again, at most once a minute; call it only after a 422.
     * @return whether the balancer turned out to have moved.
     */
    suspend fun refresh(): Boolean = mutex.withLock {
        ensureLoaded()
        val now = clock()
        if (now - lastForcedAt < FORCED_REFRESH_GAP_MS) return false
        lastForcedAt = now
        val text = runCatching { fetcher.get(SCRIPT_URL) }.getOrNull()?.takeIf { it.ok }?.body ?: return false
        val next = parseScript(text) ?: return false
        if (next == actualHost) return false
        actualHost = next
        file?.let { target ->
            withContext(Dispatchers.IO) {
                runCatching {
                    target.parentFile?.mkdirs()
                    val temp = File(target.parentFile, target.name + ".tmp")
                    temp.writeText(next + "\n")
                    if (!temp.renameTo(target)) { target.delete(); temp.renameTo(target) }
                }
            }
        }
        true
    }

    private suspend fun ensureLoaded() {
        if (loaded) return
        loaded = true
        val stored = withContext(Dispatchers.IO) { runCatching { file?.takeIf { it.isFile }?.readText()?.trim() }.getOrNull() }
        if (stored != null && isBalancerHost(stored)) actualHost = stored
    }

    companion object {
        /** As published by actualize.js on 2026-11-27. */
        const val DEFAULT_HOST = "api.corevia.ws"
        const val SCRIPT_URL = "https://kodir2.github.io/actualize.js"
        private const val FORCED_REFRESH_GAP_MS = 60_000L

        /** The shape the balancer's own script looks for: `mm.` or `api*.` on some domain. */
        private val HOST_PATTERN = Regex("""^(?:mm|app?i\w*)\.((?:[a-z0-9-]+\.)+[a-z]{2,})$""")

        fun isBalancerHost(host: String): Boolean = HOST_PATTERN.matches(host.lowercase())

        /** The `actual = "https://<host>"` of actualize.js, or null when the script is not the one we know. */
        fun parseScript(text: String): String? {
            val host = Regex("""\bactual\s*=\s*["']https://([a-z0-9.-]+?)/?["']""", RegexOption.IGNORE_CASE)
                .find(text)?.groupValues?.get(1)?.lowercase() ?: return null
            return host.takeIf(::isBalancerHost)
        }
    }
}
