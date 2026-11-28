package app.seans.tv.data.catalog

import app.seans.tv.data.net.HttpResult
import app.seans.tv.data.net.getJson
import app.seans.tv.data.net.toPlain
import app.seans.tv.data.store.Clock
import app.seans.tv.data.store.KeyValueStore
import app.seans.tv.model.SeansError
import kotlinx.serialization.json.JsonObject
import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.OkHttpClient

/**
 * Six-hour stop after `KP_QUOTA_EXHAUSTED`, kept across restarts: the key pool is shared with
 * the extension, and retrying an exhausted pool only burns what the extension has left (K1).
 */
internal class KinopoiskQuotaGuard(private val prefs: KeyValueStore, private val clock: Clock) {
    suspend fun check() {
        val until = prefs.getLong(KEY) ?: return
        if (clock.nowMs() < until) throw SeansError(SeansError.Code.QUOTA_EXHAUSTED, "Kinopoisk quota stop is active")
        prefs.putLong(KEY, null)
    }

    suspend fun trip() = prefs.putLong(KEY, clock.nowMs() + STOP_MS)

    companion object {
        const val KEY = "catalog.kpQuotaUntil"
        const val STOP_MS = 6 * 60 * 60 * 1000L
    }
}

/**
 * `kinopoiskProxy` (functions/kinopoiskProxy.js): `GET ?path=/v1.4/...` with a Firebase ID
 * token. Never called without a signed-in user, never on focus; callers cache.
 */
internal class KinopoiskApi(
    private val client: OkHttpClient,
    private val proxyUrl: String,
    private val idToken: suspend () -> String?,
    private val quota: KinopoiskQuotaGuard,
) {
    /** The movie, as plain maps for [MovieMapper]. */
    suspend fun movie(kinopoiskId: Long): Map<String, Any?> =
        call("/v1.4/movie/$kinopoiskId").obj?.toPlainMap() ?: throw SeansError(SeansError.Code.PROVIDER_CHANGED, "No movie body")

    /** `/v1.4/movie/search` → its `docs`. */
    suspend fun search(query: String, limit: Int = 20): List<Map<String, Any?>> {
        val path = "/v1.4/movie/search?page=1&limit=$limit&query=" + java.net.URLEncoder.encode(query, "UTF-8").replace("+", "%20")
        val docs = call(path).obj?.get("docs").toPlain() as? List<*> ?: return emptyList()
        @Suppress("UNCHECKED_CAST")
        return docs.mapNotNull { it as? Map<String, Any?> }
    }

    private suspend fun call(path: String): HttpResult {
        quota.check()
        val token = idToken() ?: throw SeansError(SeansError.Code.UNAUTHORIZED, "Kinopoisk needs a signed-in user")
        val url = proxyUrl.toHttpUrl().newBuilder().addQueryParameter("path", path).build().toString()
        val result = client.getJson(url, mapOf("Authorization" to "Bearer $token"))
        if (result.ok) return result
        val code = result.errorCode
        throw when {
            code == "KP_QUOTA_EXHAUSTED" -> {
                quota.trip()
                SeansError(SeansError.Code.QUOTA_EXHAUSTED, "KP_QUOTA_EXHAUSTED")
            }
            result.code == 401 || code == "AUTH_REQUIRED" -> SeansError(SeansError.Code.UNAUTHORIZED, "Kinopoisk proxy refused the token")
            result.code == 404 -> SeansError(SeansError.Code.NOT_FOUND, "Kinopoisk has no such title")
            result.code == 429 -> SeansError(SeansError.Code.NETWORK, "Kinopoisk rate limit")
            else -> SeansError(SeansError.Code.NETWORK, "Kinopoisk proxy HTTP ${result.code} ${code ?: ""}".trim())
        }
    }
}

/** `tmdbProxy` (functions/tmdbProxy.js): `GET ?url=https://api.themoviedb.org/3/...`; no token, guests too. */
internal class TmdbApi(private val client: OkHttpClient, private val proxyUrl: String) {
    suspend fun get(pathAndQuery: String): Map<String, Any?> {
        val target = "https://api.themoviedb.org/3/" + pathAndQuery.trimStart('/')
        val url = proxyUrl.toHttpUrl().newBuilder().addQueryParameter("url", target).build().toString()
        val result = client.getJson(url)
        if (!result.ok) {
            throw SeansError(
                if (result.code == 404) SeansError.Code.NOT_FOUND else SeansError.Code.NETWORK,
                "TMDB proxy HTTP ${result.code}",
            )
        }
        return result.obj?.toPlainMap() ?: emptyMap()
    }

    /** `search/multi` → movie and TV hits as (mediaType, tmdbId). */
    suspend fun searchMulti(query: String): List<Pair<String, Long>> {
        val q = java.net.URLEncoder.encode(query, "UTF-8").replace("+", "%20")
        val results = get("search/multi?language=ru-RU&include_adult=false&page=1&query=$q")["results"] as? List<*> ?: return emptyList()
        return results.mapNotNull { item ->
            @Suppress("UNCHECKED_CAST")
            val m = item as? Map<String, Any?> ?: return@mapNotNull null
            val type = m["media_type"] as? String
            val id = (m["id"] as? Number)?.toLong()
            if ((type == "movie" || type == "tv") && id != null && id > 0) type to id else null
        }
    }
}

@Suppress("UNCHECKED_CAST")
private fun JsonObject.toPlainMap(): Map<String, Any?> = toPlain() as Map<String, Any?>
