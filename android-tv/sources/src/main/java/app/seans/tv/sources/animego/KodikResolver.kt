package app.seans.tv.sources.animego

import app.seans.tv.model.SeansError
import app.seans.tv.sources.internal.Fetcher
import app.seans.tv.sources.internal.SourcesJson
import app.seans.tv.sources.internal.requireUsable
import java.util.Base64
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonObject
import okhttp3.HttpUrl.Companion.toHttpUrlOrNull

internal data class KodikStream(val height: Int, val url: String)

/**
 * Port of `KodikStreamResolver.js`: a Kodik embed page carries signed parameters
 * (`urlParams`, `vInfo`); posting them to `/ftor` returns one HLS manifest per quality with
 * obfuscated `src` values (base64 after a letter shift).
 *
 * Both requests go with **no** Referer: a foreign one makes `/ftor` fail. Only HTTPS
 * manifests on `solodcdn.com` are accepted. The CDN redirects a manifest to the server
 * holding it; Media3 follows that and resolves segments against the final address, so the
 * extension's redirect settling is not needed here.
 */
internal class KodikResolver(
    private val fetcher: Fetcher,
    private val clock: () -> Long = System::currentTimeMillis,
) {
    private class Entry(val streams: List<KodikStream>, val at: Long)

    private val cache = object : LinkedHashMap<String, Entry>(8, 0.75f, true) {
        override fun removeEldestEntry(eldest: MutableMap.MutableEntry<String, Entry>?) = size > CACHE_SIZE
    }

    /** HLS manifests of one embed, best quality first. Never empty: no stream is an error. */
    suspend fun resolve(embedUrl: String, forceRefresh: Boolean = false): List<KodikStream> {
        val pageUrl = toPageUrl(embedUrl) ?: throw SeansError(SeansError.Code.PROVIDER_CHANGED, "Not a Kodik embed URL")
        if (!forceRefresh) synchronized(cache) {
            cache[pageUrl]?.takeIf { clock() - it.at < CACHE_TTL_MS }?.let { return it.streams }
        }
        val page = fetcher.get(pageUrl, mapOf("Accept" to "text/html,application/xhtml+xml,*/*;q=0.8"))
            .requireUsable("Kodik page") ?: throw SeansError(SeansError.Code.NOT_FOUND, "Kodik page is gone")
        val info = parseEmbedPage(page.body)
        val host = pageUrl.toHttpUrlOrNull()!!.host
        val ftor = fetcher.postForm(
            "https://$host$FTOR_PATH",
            buildFtorBody(info),
            mapOf("Accept" to "application/json", "X-Requested-With" to "XMLHttpRequest"),
        ).requireUsable("Kodik /ftor") ?: throw SeansError(SeansError.Code.NOT_FOUND, "Kodik stream request failed")
        val json = runCatching { SourcesJson.parseToJsonElement(ftor.body).jsonObject }
            .getOrElse { throw SeansError(SeansError.Code.PROVIDER_CHANGED, "Kodik /ftor is not JSON") }
        val streams = parseLinks(json)
        if (streams.isEmpty()) throw SeansError(SeansError.Code.NOT_FOUND, "Kodik returned no streams")
        synchronized(cache) { cache[pageUrl] = Entry(streams, clock()) }
        return streams
    }

    internal data class EmbedInfo(val params: List<Pair<String, String>>, val type: String, val hash: String, val id: String)

    companion object {
        const val FTOR_PATH = "/ftor"
        const val CACHE_TTL_MS = 10 * 60 * 1000L
        private const val CACHE_SIZE = 8

        /** HTTPS on a Kodik host, without the extension's Referer-rule marker; null for anything else. */
        fun toPageUrl(embedUrl: String): String? {
            val value = embedUrl.trim()
            val url = (if (value.startsWith("//")) "https:$value" else value).toHttpUrlOrNull() ?: return null
            val host = url.host.lowercase()
            if (host != "kodikplayer.com" && !host.endsWith(".kodikplayer.com")) return null
            return url.newBuilder().scheme("https").removeAllQueryParameters("movieExtensionSite").build().toString()
        }

        fun parseEmbedPage(html: String): EmbedInfo {
            val params = Regex("""var\s+urlParams\s*=\s*'([^']+)'""").find(html)?.groupValues?.get(1)
            fun vInfo(key: String) = Regex("""vInfo\.$key\s*=\s*'([^']+)'""").find(html)?.groupValues?.get(1)
            val type = vInfo("type")
            val hash = vInfo("hash")
            val id = vInfo("id")
            if (params == null || type == null || hash == null || id == null) {
                throw SeansError(SeansError.Code.PROVIDER_CHANGED, "Kodik embed page has no player parameters")
            }
            val obj = runCatching { SourcesJson.parseToJsonElement(params) as JsonObject }
                .getOrElse { throw SeansError(SeansError.Code.PROVIDER_CHANGED, "Kodik player parameters are not valid JSON") }
            val pairs = obj.entries.mapNotNull { (key, value) ->
                val text = when (value) {
                    is JsonNull -> null
                    is JsonPrimitive -> value.contentOrNull
                    else -> value.toString()
                }
                text?.let { key to it }
            }
            return EmbedInfo(pairs, type, hash, id)
        }

        /** The form the Kodik player itself posts to `/ftor`. */
        fun buildFtorBody(info: EmbedInfo): List<Pair<String, String>> {
            val fixed = listOf(
                "type" to info.type, "hash" to info.hash, "id" to info.id,
                "bad_user" to "false", "info" to "{}", "cdn_is_working" to "true",
            )
            val keys = fixed.map { it.first }.toSet()
            return info.params.filter { it.first !in keys } + fixed
        }

        fun isManifestSource(value: String): Boolean {
            val url = (if (value.startsWith("//")) "https:$value" else value).toHttpUrlOrNull() ?: return false
            if (url.scheme != "https" || url.username.isNotEmpty() || url.password.isNotEmpty()) return false
            if (!url.encodedPath.endsWith(".m3u8", ignoreCase = true)) return false
            if (!value.substringBefore('?').substringBefore('#').endsWith(".m3u8", ignoreCase = true)) return false
            val host = url.host.lowercase()
            return host == "solodcdn.com" || host.endsWith(".solodcdn.com")
        }

        /** Plain or shifted-base64 `src`; throws with a fixed message (never the payload) when nothing decodes. */
        fun decodeSource(value: String): String {
            val text = value.trim()
            if (isManifestSource(text)) return text
            for (shift in 0 until 26) {
                val shifted = buildString(text.length) {
                    for (c in text) append(
                        when (c) {
                            in 'A'..'Z' -> 'A' + (c - 'A' + shift) % 26
                            in 'a'..'z' -> 'a' + (c - 'a' + shift) % 26
                            else -> c
                        },
                    )
                }
                val decoded = runCatching {
                    String(Base64.getDecoder().decode(pad(shifted)), Charsets.ISO_8859_1).trim()
                }.getOrNull() ?: continue
                if (isManifestSource(decoded)) return decoded
            }
            throw IllegalArgumentException("decode_failed")
        }

        private fun pad(value: String): String {
            val trimmed = value.trimEnd('=')
            return trimmed + "=".repeat((4 - trimmed.length % 4) % 4)
        }

        /** HTTPS manifests by quality, best first; undecodable, insecure and unnumbered entries dropped. */
        fun parseLinks(response: JsonObject): List<KodikStream> {
            val links = response["links"] as? JsonObject ?: return emptyList()
            return links.entries.mapNotNull { (quality, entries) ->
                val height = Regex("""^\d+""").find(quality)?.value?.toIntOrNull()?.takeIf { it > 0 } ?: return@mapNotNull null
                val src = (entries as? JsonArray)?.firstNotNullOfOrNull {
                    ((it as? JsonObject)?.get("src") as? JsonPrimitive)?.contentOrNull?.takeIf(String::isNotBlank)
                } ?: return@mapNotNull null
                val decoded = runCatching { decodeSource(src) }.getOrNull() ?: return@mapNotNull null
                val url = (if (decoded.startsWith("//")) "https:$decoded" else decoded).toHttpUrlOrNull() ?: return@mapNotNull null
                if (url.scheme != "https") return@mapNotNull null
                KodikStream(height, if (decoded.startsWith("//")) "https:$decoded" else decoded)
            }.sortedByDescending { it.height }
        }
    }
}
