package app.seans.tv.sources

import app.seans.tv.sources.internal.Fetcher
import app.seans.tv.sources.internal.HttpResult

/** Reads a fixture from `src/test/resources`. */
fun fixture(path: String): String =
    requireNotNull(Thread.currentThread().contextClassLoader!!.getResource(path)) { "missing fixture $path" }
        .readText(Charsets.UTF_8)

/** One recorded request. */
data class Recorded(val method: String, val url: String, val headers: Map<String, String>, val form: List<Pair<String, String>> = emptyList())

/**
 * Answers from fixtures by URL; anything unknown is a 404, so a test can never reach a
 * real site. Routes match the whole URL, or a prefix ending in `*`.
 */
internal class FakeFetcher(vararg routes: Pair<String, Any>) : Fetcher {
    val requests = mutableListOf<Recorded>()
    private val routes = routes.toMutableList()

    fun route(pattern: String, answer: Any) { routes.add(0, pattern to answer) }

    override suspend fun get(url: String, headers: Map<String, String>): HttpResult {
        requests += Recorded("GET", url, headers)
        return answer(url)
    }

    override suspend fun postForm(url: String, form: List<Pair<String, String>>, headers: Map<String, String>): HttpResult {
        requests += Recorded("POST", url, headers, form)
        return answer(url)
    }

    private fun answer(url: String): HttpResult {
        val match = routes.firstOrNull { (pattern, _) ->
            if (pattern.endsWith("*")) url.startsWith(pattern.dropLast(1)) else url == pattern
        } ?: return HttpResult(404, "Not found", url)
        return when (val value = match.second) {
            is HttpResult -> value
            is Int -> HttpResult(value, "", url)
            is String -> HttpResult(200, value, url)
            else -> error("bad route value")
        }
    }
}
