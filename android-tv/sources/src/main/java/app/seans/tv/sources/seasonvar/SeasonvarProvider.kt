package app.seans.tv.sources.seasonvar

import app.seans.tv.model.EpisodeInfo
import app.seans.tv.model.EpisodeKey
import app.seans.tv.model.MediaType
import app.seans.tv.model.PlayableStream
import app.seans.tv.model.ProviderId
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

/**
 * Seasonvar: series only, found by title (it has no Kinopoisk ID). One page per season;
 * each translation of a season is a separate JSON playlist of MP4 links.
 *
 * The site and its CDN (`*.11cdn.org`) answer over HTTPS (measured 2026-11-27: `http://`
 * redirects to `https://`), so no cleartext exception is needed.
 *
 * [SourceOption.seasons] lists every season; only the season asked for carries its episodes,
 * the others carry the episode count the page prints (`1..n`) or nothing when it prints none.
 */
internal class SeasonvarProvider(
    private val fetcher: Fetcher,
    private val base: String = SeasonvarParser.BASE_URL,
    private val clock: () -> Long = System::currentTimeMillis,
) : Provider {
    override val id = ProviderId.SEASONVAR

    override fun accepts(query: SourceQuery): Boolean = query.ref.mediaType == MediaType.SERIES && query.title.isNotBlank()

    override fun cacheKey(query: SourceQuery): String =
        "kp${query.ref.kinopoiskId}:s${query.episode?.season ?: "-"}:e${query.episode?.episode ?: "-"}"

    @Serializable
    internal data class Handle(val seasons: Map<Int, String>, val guessedSeason: Boolean = false)

    private class Entry<T>(val value: T, val at: Long)

    /** Raw pages and parsed playlists, a few entries each; parsed documents are never kept. */
    private val pages = lru<String, Entry<String>>(PAGE_CACHE_SIZE)
    private val playlists = lru<String, Entry<List<SvEpisode>>>(PLAYLIST_CACHE_SIZE)

    override suspend fun find(query: SourceQuery): SourceOption? {
        val search = fetcher.get("$base/search?q=${URLEncoder.encode(query.title, "UTF-8").replace("+", "%20")}", HTML)
            .requireUsable("Seasonvar search") ?: return null
        val results = SeasonvarParser.parseSearchResults(search.body, base)
        val best = SeasonvarParser.selectBest(results, query.title, query.originalTitle, query.year) ?: return null

        val firstPage = page(best.url) ?: return null
        val tabs = SeasonvarParser.parseSeasons(firstPage, base)
        val printedSeason = if (tabs.isEmpty()) SeasonvarParser.pageSeasonNumber(firstPage) else null
        // A page with neither season tabs nor a season in its title is taken as season 1, unconfirmed.
        val guessedSeason = tabs.isEmpty() && printedSeason == null
        val seasons = tabs.ifEmpty { listOf(SvSeason(printedSeason ?: 1, best.url, 0)) }
        val wantedSeason = query.episode?.season ?: seasons.first().number
        val season = seasons.firstOrNull { it.number == wantedSeason }
        val handle = SourcesJson.encodeToString(Handle.serializer(), Handle(seasons.associate { it.number to it.url }, guessedSeason))

        if (season == null) {
            return SourceOption(
                providerId = id, kind = SourceKind.DIRECT, handle = handle,
                seasons = seasons.map { it.toInfo(null) },
                unavailableReason = NO_EPISODE,
            )
        }

        val (translations, episodes) = seasonContent(season.url, voiceId = null)
        val numbers = episodes.mapNotNull { SeasonvarParser.extractEpisodeNumber(it.title) }.distinct().sorted()
        if (numbers.isEmpty()) return null
        val activeName = translations.first { it.active }.let { active ->
            if (active.name.equals("Стандартный", ignoreCase = true)) SeasonvarParser.studioOf(episodes)?.let { "Стандартный ($it)" } else null
        }
        return SourceOption(
            providerId = id,
            kind = SourceKind.DIRECT,
            handle = handle,
            voices = translations.map { VoiceOption(it.id, if (it.active && activeName != null) activeName else it.name) },
            seasons = seasons.map { if (it.number == season.number) it.toInfo(numbers) else it.toInfo(null) },
            unavailableReason = query.episode?.takeIf { it.episode !in numbers }?.let { NO_EPISODE },
        )
    }

    override suspend fun resolve(option: SourceOption, episode: EpisodeKey?, voiceId: String?, fresh: Boolean): PlayableStream {
        val handle = runCatching { SourcesJson.decodeFromString(Handle.serializer(), option.handle) }
            .getOrElse { throw SeansError(SeansError.Code.PROVIDER_CHANGED, "Bad Seasonvar handle") }
        val seasonNumber = episode?.season ?: handle.seasons.keys.minOrNull()
        val seasonUrl = seasonNumber?.let { handle.seasons[it] } ?: throw SeansError(SeansError.Code.NOT_FOUND, NO_EPISODE)
        val html = page(seasonUrl, fresh) ?: throw SeansError(SeansError.Code.NOT_FOUND, "Seasonvar season page is gone")
        val translations = translationsOf(html)

        fun pick(list: List<SvEpisode>) = if (episode == null) list.firstOrNull()
        else list.firstOrNull { SeasonvarParser.extractEpisodeNumber(it.title) == episode.episode }

        // The chosen voice first; an unknown one, or one without this episode, falls back to the
        // page's default voice. Never a positional guess: no voice with this episode is «not here».
        val active = translations.first { it.active }
        val wanted = translations.firstOrNull { it.id == voiceId }
        var translation = wanted ?: active
        var target = pick(playlist(translation.url, fresh))
        if (target == null && translation.id != active.id) {
            translation = active
            target = pick(playlist(active.url, fresh))
        }
        target ?: throw SeansError(SeansError.Code.NOT_FOUND, NO_EPISODE)
        // The episode the playlist lists this file under; null (unknown) when its title names none.
        val confirmed = if (handle.guessedSeason) null
        else SeasonvarParser.extractEpisodeNumber(target.title)?.let { EpisodeKey.ofOrNull(seasonNumber, it) }

        return PlayableStream(
            url = target.url,
            format = StreamFormat.MP4,
            headers = mapOf("User-Agent" to SeansHttp.USER_AGENT),
            episode = confirmed,
            providerId = id,
            voiceId = translation.id,
            subtitles = SeasonvarParser.parseSubtitles(target.subtitle),
        )
    }

    /** Translations of a season page and the episodes of [voiceId] (the page's active one when null or unknown). */
    private suspend fun seasonContent(seasonUrl: String, voiceId: String?): Pair<List<SvTranslation>, List<SvEpisode>> {
        val html = page(seasonUrl) ?: throw SeansError(SeansError.Code.NOT_FOUND, "Seasonvar season page is gone")
        val translations = translationsOf(html)
        val translation = translations.firstOrNull { it.id == voiceId } ?: translations.first { it.active }
        return translations to playlist(translation.url)
    }

    private fun translationsOf(html: String): List<SvTranslation> = runCatching { SeasonvarParser.parseTranslations(html, base) }
        .getOrElse { throw SeansError(SeansError.Code.PROVIDER_CHANGED, "Seasonvar page has no playlist") }

    /** [fresh] skips the cache: playlist paths are signed per page visit, so a retry needs the page too. */
    private suspend fun page(url: String, fresh: Boolean = false): String? {
        if (!fresh) cached(pages, url)?.let { return it }
        val result = fetcher.get(url, HTML).requireUsable("Seasonvar page") ?: return null
        synchronized(pages) { pages[url] = Entry(result.body, clock()) }
        return result.body
    }

    private suspend fun playlist(url: String, fresh: Boolean = false): List<SvEpisode> {
        if (!fresh) cached(playlists, url)?.let { return it }
        val result = fetcher.get(url, JSON).requireUsable("Seasonvar playlist")
            ?: throw SeansError(SeansError.Code.NOT_FOUND, "Seasonvar playlist is gone")
        val episodes = runCatching { SeasonvarParser.parsePlaylist(result.body) }
            .getOrElse { throw SeansError(SeansError.Code.PROVIDER_CHANGED, "Seasonvar playlist is not JSON") }
        // An empty playlist is never kept as an answer.
        if (episodes.isNotEmpty()) synchronized(playlists) { playlists[url] = Entry(episodes, clock()) }
        return episodes
    }

    private fun <T> cached(cache: LinkedHashMap<String, Entry<T>>, key: String): T? = synchronized(cache) {
        cache[key]?.takeIf { clock() - it.at < TTL_MS }?.value
    }

    private fun SvSeason.toInfo(numbers: List<Int>?): SeasonInfo = SeasonInfo(
        number = number,
        episodes = (numbers ?: (1..episodesCount).toList()).map { EpisodeInfo(EpisodeKey(number, it)) },
    )

    private companion object {
        // Playlist paths are signed per visit (`/playls2/<hash>/…?time=`); keep them briefly.
        const val TTL_MS = 10 * 60 * 1000L
        const val PAGE_CACHE_SIZE = 6
        const val PLAYLIST_CACHE_SIZE = 6
        val HTML = mapOf("Accept" to "text/html,application/xhtml+xml,*/*;q=0.8", "Accept-Language" to "ru-RU,ru;q=0.9")
        val JSON = mapOf("Accept" to "application/json, text/plain, */*")

        fun <K, V> lru(size: Int) = object : LinkedHashMap<K, V>(size, 0.75f, true) {
            override fun removeEldestEntry(eldest: MutableMap.MutableEntry<K, V>?) = this.size > size
        }
    }
}
