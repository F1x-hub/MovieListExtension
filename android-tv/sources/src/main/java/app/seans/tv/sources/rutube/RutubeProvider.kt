package app.seans.tv.sources.rutube

import app.seans.tv.model.EpisodeKey
import app.seans.tv.model.MediaType
import app.seans.tv.model.PlayableStream
import app.seans.tv.model.ProviderId
import app.seans.tv.model.SeansError
import app.seans.tv.model.SourceKind
import app.seans.tv.model.SourceOption
import app.seans.tv.model.SourceQuery
import app.seans.tv.model.StreamFormat
import app.seans.tv.network.SeansHttp
import app.seans.tv.sources.internal.Fetcher
import app.seans.tv.sources.internal.NO_EPISODE
import app.seans.tv.sources.internal.Provider
import app.seans.tv.sources.internal.SourcesJson
import app.seans.tv.sources.internal.requireUsable
import java.net.URLEncoder
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject

/**
 * Rutube: user uploads, found by title and year with the extension's scorer. Films only:
 * Rutube has no reliable season/episode model, and [ProviderId.RUTUBE] never auto-advances
 * or marks anything watched. The handle is the video ID; [resolve] asks the play options
 * for the HLS master each time (it is signed).
 */
internal class RutubeProvider(
    private val fetcher: Fetcher,
    private val base: String = RutubeParser.BASE_URL,
) : Provider {
    override val id = ProviderId.RUTUBE

    /** Films only, and never for an episode request: a Rutube upload is never played as an episode. */
    override fun accepts(query: SourceQuery): Boolean =
        query.ref.mediaType == MediaType.MOVIE && query.episode == null && query.title.isNotBlank()

    override fun cacheKey(query: SourceQuery): String = "kp${query.ref.kinopoiskId}"

    override suspend fun find(query: SourceQuery): SourceOption? {
        val year = query.year ?: RutubeParser.extractYear(query.title)
        val candidates = LinkedHashMap<String, RtItem>()
        var answered = false
        var lastError: SeansError? = null
        for (q in RutubeParser.buildSearchQueries(query.title, year)) {
            val url = "$base/api/search/video/?query=${URLEncoder.encode(q, "UTF-8").replace("+", "%20")}&page=1&per_page=25"
            val result = try {
                fetcher.get(url, JSON).requireUsable("Rutube search")
            } catch (e: SeansError) {
                // One failed query of the cascade does not sink the others, as in the extension.
                if (e.code == SeansError.Code.PROVIDER_BLOCKED) throw e
                lastError = e
                continue
            } ?: continue
            answered = true
            val root = runCatching { SourcesJson.parseToJsonElement(result.body) as JsonObject }.getOrNull() ?: continue
            val items = (root["results"] as? JsonArray) ?: (root["items"] as? JsonArray) ?: continue
            items.mapNotNull(RtItem::of).forEach { candidates.putIfAbsent(it.id, it) }
            val best = RutubeParser.pickBest(candidates.values, query.title, year)
            if (best != null && best.second >= 140) break
        }
        if (!answered && lastError != null) throw lastError
        val best = RutubeParser.pickBest(candidates.values, query.title, year) ?: return null
        if (best.second <= 0) return null
        return SourceOption(providerId = id, kind = SourceKind.DIRECT, handle = best.first.id)
    }

    /** Nothing cached here: every call asks the play options, so [fresh] changes nothing. */
    override suspend fun resolve(option: SourceOption, episode: EpisodeKey?, voiceId: String?, fresh: Boolean): PlayableStream {
        if (episode != null) throw SeansError(SeansError.Code.NOT_FOUND, NO_EPISODE)
        val videoId = option.handle.takeIf { Regex("^[a-z0-9_-]{8,80}$", RegexOption.IGNORE_CASE).matches(it) }
            ?: throw SeansError(SeansError.Code.PROVIDER_CHANGED, "Bad Rutube handle")
        var lastError: SeansError? = null
        for (path in listOf("/api/play/options/$videoId/?format=json", "/api/play/options/$videoId/")) {
            val result = try {
                fetcher.get(base + path, JSON).requireUsable("Rutube play options")
            } catch (e: SeansError) {
                lastError = e
                continue
            } ?: continue
            val options = runCatching { SourcesJson.parseToJsonElement(result.body) as JsonObject }.getOrNull() ?: continue
            val m3u8 = RutubeParser.m3u8Of(options)?.takeIf { it.startsWith("https://") } ?: continue
            return PlayableStream(
                url = m3u8,
                format = StreamFormat.HLS,
                headers = mapOf("User-Agent" to SeansHttp.USER_AGENT),
                episode = null,
                providerId = id,
            )
        }
        throw lastError ?: SeansError(SeansError.Code.NOT_FOUND, "Rutube has no stream for this video")
    }

    private companion object {
        val JSON = mapOf("Accept" to "application/json")
    }
}
