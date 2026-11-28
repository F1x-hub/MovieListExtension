package app.seans.tv.sources.animego

import app.seans.tv.model.EpisodeInfo
import app.seans.tv.model.EpisodeKey
import app.seans.tv.model.PlayableStream
import app.seans.tv.model.ProviderId
import app.seans.tv.model.QualityOption
import app.seans.tv.model.SeansError
import app.seans.tv.model.SeasonInfo
import app.seans.tv.model.SourceKind
import app.seans.tv.model.SourceOption
import app.seans.tv.model.SourceQuery
import app.seans.tv.model.StreamFormat
import app.seans.tv.model.VoiceOption
import app.seans.tv.network.SeansHttp
import app.seans.tv.sources.internal.Fetcher
import app.seans.tv.sources.internal.NO_EPISODE
import app.seans.tv.sources.internal.Provider
import app.seans.tv.sources.internal.SourcesJson
import app.seans.tv.sources.internal.requireUsable
import java.net.URLEncoder
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.intOrNull
import kotlinx.serialization.json.jsonObject

/**
 * AnimeGo + Kodik, anime only. AnimeGo is found by title and year (it has no Kinopoisk ID)
 * and lists embeds per dub; a Kodik embed is resolved to HLS by [KodikResolver] and played
 * natively, one manifest per quality ([PlayableStream.alternatives]).
 *
 * Asked only for titles the catalogue marks as anime ([SourceQuery.isAnime]).
 *
 * Seasons, as the extension's `resolveSeasonEpisodes` (without its continuation into the next
 * AnimeGo titles): season 1 plays the base title; a later season plays AnimeGo's own title
 * for it («… 2», «Season 2», «второй сезон») when the catalogue has one, else the base
 * title's absolute numbers mapped through [SourceQuery.seasonEpisodeCounts]. Without the
 * counts of every earlier season such a season is reported missing, never guessed.
 */
internal class AnimeGoProvider(
    private val fetcher: Fetcher,
    private val kodik: KodikResolver = KodikResolver(fetcher),
    private val base: String = AnimeGoParser.BASE_URL,
) : Provider {
    override val id = ProviderId.ANIMEGO

    override fun accepts(query: SourceQuery): Boolean = query.isAnime && query.title.isNotBlank()

    override fun cacheKey(query: SourceQuery): String =
        "kp${query.ref.kinopoiskId}:s${query.episode?.season ?: "-"}:e${query.episode?.episode ?: "-"}"

    @Serializable
    internal data class Player(val translationId: String?, val name: String, val url: String)

    @Serializable
    internal data class Handle(
        val animeId: String,
        val season: Int? = null,
        /** Episode number → AnimeGo episode id; empty for a film. */
        val episodes: Map<Int, String> = emptyMap(),
        /** A film's Kodik embeds, one per dub. */
        val players: List<Player> = emptyList(),
    )

    override suspend fun find(query: SourceQuery): SourceOption? {
        val season = query.episode?.season ?: 1
        // AnimeGo has no specials season.
        if (season < 1) return null
        val found = search(query.title, query.year)
            ?: query.originalTitle?.takeIf { it.isNotBlank() && it != query.title }?.let { search(it, query.year) }
            ?: return null
        val (cards, baseResult) = found
        val seasonTitle = if (season > 1) AnimeGoParser.findSeasonResult(cards, baseResult, season) else null
        val target = seasonTitle ?: baseResult

        val first = playerJson("/player/${target.animeId}") ?: return null
        val content = AnimeGoParser.parsePlayerContent(first.content, first.total, first.pageSize)
        val voices = kodikPlayers(content.players)

        if (content.episodes.isEmpty()) {
            // A film: no seasons to map.
            if (voices.isEmpty() || season > 1) return null
            val handle = Handle(animeId = target.animeId, players = voices)
            return SourceOption(
                providerId = id, kind = SourceKind.DIRECT, handle = encode(handle),
                voices = voices.map { VoiceOption(it.translationId ?: it.url, it.name) }.distinctBy { it.id },
                // A film never stands in for an episode.
                unavailableReason = if (query.episode != null) NO_EPISODE else null,
            )
        }

        val episodes = content.episodes.toMutableList()
        for (page in 1 until minOf(content.pageCount, MAX_EPISODE_PAGES)) {
            // A failed page throws: a truncated list would be cached and later episodes read «Этой серии нет».
            val more = playerJson("/player/${target.animeId}/episodes?page=$page")
                ?: throw SeansError(SeansError.Code.PROVIDER_CHANGED, "AnimeGo episode page $page is gone")
            episodes += AnimeGoParser.parsePlayerContent(more.content).episodes
        }
        val absolute = episodes.distinctBy { it.id }.sortedBy { it.number }.filter { it.number >= 1 }
            .associate { it.number to it.id }
        val byNumber = if (season > 1 && seasonTitle == null) {
            seasonSlice(absolute, season, query.seasonEpisodeCounts) ?: return null
        } else {
            absolute
        }
        if (byNumber.isEmpty()) return null
        val seasonNumber = season
        val handle = Handle(animeId = target.animeId, season = seasonNumber, episodes = byNumber)
        return SourceOption(
            providerId = id,
            kind = SourceKind.DIRECT,
            handle = encode(handle),
            voices = voices.map { VoiceOption(it.translationId ?: it.url, it.name) }.distinctBy { it.id },
            seasons = listOf(SeasonInfo(seasonNumber, byNumber.keys.map { EpisodeInfo(EpisodeKey(seasonNumber, it)) })),
            unavailableReason = query.episode?.takeIf { it.episode !in byNumber }?.let { NO_EPISODE },
        )
    }

    override suspend fun resolve(option: SourceOption, episode: EpisodeKey?, voiceId: String?, fresh: Boolean): PlayableStream {
        val handle = runCatching { SourcesJson.decodeFromString(Handle.serializer(), option.handle) }
            .getOrElse { throw SeansError(SeansError.Code.PROVIDER_CHANGED, "Bad AnimeGo handle") }

        val (key, players) = if (handle.episodes.isEmpty()) {
            if (episode != null) throw SeansError(SeansError.Code.NOT_FOUND, NO_EPISODE)
            null to handle.players
        } else {
            val number = episode?.episode ?: handle.episodes.keys.min()
            if (episode != null && handle.season != null && episode.season != handle.season) {
                throw SeansError(SeansError.Code.NOT_FOUND, NO_EPISODE)
            }
            val episodeId = handle.episodes[number] ?: throw SeansError(SeansError.Code.NOT_FOUND, NO_EPISODE)
            val json = playerJson("/player/videos/$episodeId") ?: throw SeansError(SeansError.Code.NOT_FOUND, NO_EPISODE)
            EpisodeKey(handle.season ?: 1, number) to kodikPlayers(AnimeGoParser.parsePlayerContent(json.content).players)
        }
        if (players.isEmpty()) throw SeansError(SeansError.Code.NOT_FOUND, "No Kodik player for this episode")

        // The chosen dub first; an unknown one, or one without this episode, falls back to the
        // episode's own order. The stream's voiceId says which dub actually plays.
        val chosen = players.filter { voiceId != null && (it.translationId ?: it.url) == voiceId }
        val ordered = chosen + players.filter { it !in chosen }
        var last: SeansError? = null
        for (player in ordered.take(chosen.size + MAX_PLAYER_TRIES)) {
            val streams = try {
                kodik.resolve(player.url, forceRefresh = fresh)
            } catch (e: SeansError) {
                last = e
                continue
            }
            return PlayableStream(
                url = streams.first().url,
                format = StreamFormat.HLS,
                // Kodik's CDN wants no Referer; the UA matches the one /ftor saw.
                headers = mapOf("User-Agent" to SeansHttp.USER_AGENT),
                episode = key,
                providerId = id,
                voiceId = player.translationId ?: player.url,
                alternatives = streams.map { QualityOption(it.height, "${it.height}p") to it.url },
            )
        }
        throw last ?: SeansError(SeansError.Code.NOT_FOUND, "No Kodik stream")
    }

    /** The base title and the search page's cards (later seasons are looked up among them). */
    private suspend fun search(title: String, year: Int?): Pair<List<AgCard>, AgResult>? {
        for (query in AnimeGoParser.buildTitleVariants(title)) {
            val q = URLEncoder.encode(query, "UTF-8").replace("+", "%20")
            val page = fetcher.get("$base/search/anime?q=$q", HTML).requireUsable("AnimeGo search") ?: continue
            val cards = AnimeGoParser.parseSearchCards(page.body)
            val baseResult = AnimeGoParser.bestResult(cards, query, year) ?: continue
            return cards to baseResult
        }
        return null
    }

    internal companion object {
        /**
         * Season [season] of one long title numbered absolutely: episodes after the earlier
         * seasons' counts, renumbered from 1. Null when an earlier season's count is unknown.
         * A season without a count of its own takes everything after the offset, as in the extension.
         */
        fun seasonSlice(absolute: Map<Int, String>, season: Int, counts: Map<Int, Int>): Map<Int, String>? {
            var offset = 0
            for (previous in 1 until season) offset += counts[previous]?.takeIf { it > 0 } ?: return null
            val count = counts[season]?.takeIf { it > 0 }
            return absolute.filterKeys { it > offset && (count == null || it <= offset + count) }
                .mapKeys { it.key - offset }
                .takeIf { it.isNotEmpty() }
        }
    }

    private class PlayerJson(val content: String, val total: Int?, val pageSize: Int?)

    /** AnimeGo serves player JSON only to XHR-style requests; anything else gets the full HTML page. */
    private suspend fun playerJson(path: String): PlayerJson? {
        val result = fetcher.get("$base$path", JSON_HEADERS).requireUsable("AnimeGo player") ?: return null
        val root = runCatching { SourcesJson.parseToJsonElement(result.body).jsonObject }
            .getOrElse { throw SeansError(SeansError.Code.PROVIDER_CHANGED, "AnimeGo player answer is not JSON") }
        if ((root["status"] as? JsonPrimitive)?.contentOrNull != "success") {
            throw SeansError(SeansError.Code.PROVIDER_CHANGED, "AnimeGo player answer was not successful")
        }
        val data = root["data"] as? JsonObject ?: throw SeansError(SeansError.Code.PROVIDER_CHANGED, "AnimeGo player answer has no data")
        return PlayerJson(
            content = (data["content"] as? JsonPrimitive)?.contentOrNull.orEmpty(),
            total = (data["total"] as? JsonPrimitive)?.intOrNull,
            pageSize = (data["pageSize"] as? JsonPrimitive)?.intOrNull,
        )
    }

    private fun kodikPlayers(players: List<AgPlayer>): List<Player> = players
        .filter { AnimeGoParser.isKodikUrl(it.url) }
        .map { Player(it.translationId, it.translation ?: "Озвучка", it.url) }
        .distinctBy { it.translationId ?: it.url }

    private fun encode(handle: Handle) = SourcesJson.encodeToString(Handle.serializer(), handle)

}

private const val MAX_EPISODE_PAGES = 20
private const val MAX_PLAYER_TRIES = 2
private val HTML = mapOf("Accept" to "text/html,application/xhtml+xml,*/*;q=0.8", "Accept-Language" to "ru-RU,ru;q=0.9")
private val JSON_HEADERS = mapOf("Accept" to "application/json", "X-Requested-With" to "XMLHttpRequest")
